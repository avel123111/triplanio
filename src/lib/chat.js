// Helpers for the trip chat: chat_id lookup, message paging, sending, unread
// counter and the shared realtime channel. Read markers are written inline by
// the lens and the widget (a plain upsert), so this module no longer wraps them.
//
// All queries pivot on chat_id (from the chats table - one "group" chat per
// trip) and on user_id (uuid) rather than user_email.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { displayName } from '@/lib/displayName';
import { pluralCategory } from '@/lib/i18n/format';
import { Sentry } from '@/lib/sentry';
import { withOwnerRow } from '@/lib/members';
import { mergeIncomingMessage } from '@/lib/chat-merge';

// Keyed by chat_id (not tripId): the chat widget and the chat lens are never
// mounted together, so ONE cache per chat_id is shared between them — switching
// lenses reuses it instead of refetching (TRIP-208: was 3 separate caches).
export const CHAT_MESSAGES_KEY = (chatId) => ['chat-msgs', chatId];
// Not exported: only this module builds these keys.
const CHAT_ID_KEY     = (tripId) => ['chat-id', tripId];
const CHAT_UNREAD_KEY = (tripId, userId) => ['chat-unread', tripId, userId];

// ── Resolve group chat id from tripId ─────────────────────────────────────────

export function useChatId(tripId, { enabled = true } = {}) {
  return useQuery({
    queryKey: CHAT_ID_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chats')
        .select('id')
        .eq('trip_id', tripId)
        .eq('type', 'group')
        .single();
      if (error) throw error;
      return data?.id || null;
    },
    enabled: !!tripId && enabled,
    staleTime: Infinity,
  });
}

// ── Participant helpers ───────────────────────────────────────────────────────
//
// Chat participants = trip owner + every *active* member (admins + viewers),
// excluding offline / pending / declined rows. The owner often isn't a
// trip_members row (it's tracked on trips.created_by), so synthesize it when
// missing. The AI assistant is shown separately and is NOT counted here.

export function chatParticipants(members = [], ownerId = '') {
  // withOwnerRow drops any stray creator row and prepends a single owner, so the
  // creator is never listed as a viewer in chat (TRIP-143).
  return withOwnerRow((members || []).filter((m) => m.status === 'active'), ownerId);
}

// Locale-aware "N people" (ru few/many via Intl.PluralRules; en/es collapse to one/many).
export function pluralPeople(n, t, lang) {
  const cat = pluralCategory(n, lang);
  return `${n} ${t(`chat.people_${cat}`)}`;
}

// ── Fetch messages ────────────────────────────────────────────────────────────
//
// ONE shared message cache per chat_id (TRIP-208): both the chat widget and the
// chat lens use this hook, so they no longer keep two independent caches of the
// same rows. `enabled` lets the widget stay lazy (fetch only when opened) while
// the lens fetches on mount.

// One page of history. The lens opens on the newest page and walks backwards on
// demand; anything older is fetched by fetchOlderMessages.
export const CHAT_PAGE = 200;

export function useChatMessages(chatId, { enabled = true } = {}) {
  return useQuery({
    queryKey: CHAT_MESSAGES_KEY(chatId),
    queryFn: async () => {
      // NEWEST page: order DESC + limit, then reverse for display. The old
      // `.limit(200)` with ASC order returned the OLDEST 200 rows, so past 200
      // messages every newer one silently stopped loading (TRIP-292) — that fix
      // dropped the cap entirely; this restores it on the correct end.
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: false })
        .limit(CHAT_PAGE);
      if (error) throw error;
      return (data || []).reverse();
    },
    enabled: !!chatId && enabled,
    // Catch up any messages missed while unmounted on (re)mount; realtime keeps
    // it live thereafter. No refetchOnWindowFocus — respect the app-wide default
    // (query-client.js sets it false) since realtime already delivers new rows.
    refetchOnMount: 'always',
  });
}

// Apply an incoming row (realtime INSERT or UPDATE, or the row the send RPC
// returned) to the shared message cache. Shared by the widget and the lens so
// the merge lives in ONE place (TRIP-208); the rule itself is pure and
// unit-tested in chat-merge.js.
export function applyChatRow(qc, chatId, msg) {
  reportFailedRun(msg);
  qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) => mergeIncomingMessage(old, msg));
}

// An assistant run that ends badly is reported from HERE, and not from where it
// actually fails, because nobody at the failure site can report it usefully:
//   • the edge function answers before the assistant even starts (the n8n webhook
//     ACKs on receipt), so its request is a success by the time things break;
//   • the watchdog that closes a hung run lives in SQL, where the environment
//     name cannot be derived (both databases are called `postgres`) — it only
//     writes a Postgres log warning;
//   • n8n reports to Sentry itself, but under its own environment, so a broken
//     dev run looks like a production event.
// This module sees every terminal status through the same realtime seam AND runs
// in the browser, where Sentry already carries the right environment and release.
// Reported once per message (a redelivered row must not re-fire).
const REPORTED_RUNS = new Set();
// Refusals are the system working as intended, not failures to alert on.
const EXPECTED_REFUSALS = new Set(['PRO_REQUIRED', 'RATE_LIMITED']);

function reportFailedRun(msg) {
  if (!aiRunFailed(msg) || !msg.id || REPORTED_RUNS.has(msg.id)) return;
  if (EXPECTED_REFUSALS.has(msg.ai_error)) return;
  REPORTED_RUNS.add(msg.id);
  Sentry.captureMessage(`chat assistant run ${msg.ai_status}`, {
    level: 'error',
    tags: { surface: 'chat', ai_status: msg.ai_status, ai_error: msg.ai_error || 'UNKNOWN' },
    extra: { message_id: msg.id, trip_id: msg.trip_id, attempts: msg.ai_attempts },
  });
}

// One page of history older than `beforeIso`, oldest→newest (display order).
export async function fetchOlderMessages(chatId, beforeIso) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('chat_id', chatId)
    .lt('created_at', beforeIso)
    .order('created_at', { ascending: false })
    .limit(CHAT_PAGE);
  if (error) throw error;
  return (data || []).reverse();
}

// ── Sending ───────────────────────────────────────────────────────────────────
//
// ONE send path for the lens and the widget (they used to carry two copies that
// had already drifted: a failed send kept the text in the lens and silently
// dropped it in the widget).
//
// The client no longer writes the row: it calls send_chat_message and passes
// only the text. The server sets the author from auth.uid(), the timestamp, the
// name, caps the length, dedupes by client_msg_id and — in the SAME transaction —
// marks the row as awaiting the assistant when the text addresses it. That last
// part is why the decision moved server-side: writing the message and asking the
// assistant used to be two client operations, so a tab closed in between left a
// message that would never be answered (TRIP-296).

/** Assistant-run statuses, split by what the UI does with them. */
const AI_RUN_OPEN = new Set(['queued', 'running']);
const AI_RUN_BAD  = new Set(['failed', 'timeout']);

/** Is the assistant working on any message in this list? The "Triplanio typing"
 *  indicator reads server state now, so every participant sees the same thing,
 *  it survives a reload, and only a terminal status can switch it off. */
export function isAiThinking(msgs = []) {
  return msgs.some((m) => AI_RUN_OPEN.has(m.ai_status));
}

/** Is this message's assistant run finished badly (refused, failed, timed out)? */
export function aiRunFailed(msg) {
  return AI_RUN_BAD.has(msg?.ai_status);
}

/** Nudge the edge function to run the assistant for an already-queued message.
 *  Nothing is reported back here on purpose: the outcome is written to the row
 *  by the server (failed / done), and a nudge that never arrives is closed by the
 *  watchdog — so there is no client-side state left to get out of sync. */
function nudgeAssistant(messageId) {
  invokeFn('callTriplanioAi', { body: { message_id: messageId } })
    .catch((err) => console.error('callTriplanioAi failed', err));
}

export function useChatSend(chatId, tripId) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [sending, setSending] = useState(false);
  const myName = displayName(user?.email, user?.user_metadata?.full_name || user?.full_name);

  const patchRow = useCallback((id, fields) => {
    qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) =>
      old.map((m) => (m.id === id ? { ...m, ...fields } : m)));
  }, [qc, chatId]);

  // `retryOf` re-sends an existing failed row (same client_msg_id → the server
  // returns the original row if the first attempt actually landed).
  const send = useCallback(async (text, retryOf) => {
    const content = (text || '').trim();
    if (!chatId || !content) return;
    const clientId = retryOf?.client_msg_id || crypto.randomUUID();

    if (retryOf) {
      patchRow(clientId, { __pending: true, __failed: false });
    } else {
      setSending(true);
      qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) => [...old, {
        id: clientId,
        client_msg_id: clientId,
        chat_id: chatId,
        trip_id: tripId,
        user_id: user?.id,
        user_full_name: myName,
        text: content,
        created_at: new Date().toISOString(),
        __pending: true,
      }]);
    }

    const { data, error } = await supabase.rpc('send_chat_message', {
      p_chat_id: chatId,
      p_text: content,
      p_client_msg_id: clientId,
    });
    if (!retryOf) setSending(false);

    if (error || !data) {
      // Keep the message ON SCREEN, marked "not sent" with a retry action: the
      // composer has already been cleared, so dropping the row would lose the
      // user's text with nothing to tell them.
      console.error('Chat send failed:', error);
      patchRow(clientId, { __pending: false, __failed: true });
      return;
    }

    applyChatRow(qc, chatId, data);
    // Tagged @Triplanio → tripl_message_sent; plain message → chat_message_sent.
    // The server decided which it is, so the event can no longer disagree with
    // whether the assistant was actually called.
    track(data.ai_status ? 'tripl_message_sent' : 'chat_message_sent', { trip_id: tripId });
    if (data.ai_status === 'queued') nudgeAssistant(data.id);
  }, [chatId, tripId, qc, patchRow, user?.id, myName]);

  // "Retry" under a message: re-send it if it never reached the server, or ask
  // the assistant again if it was the ANSWER that failed.
  const retry = useCallback((msg) => {
    if (msg.__failed) return send(msg.text, msg);
    patchRow(msg.id, { ai_status: 'queued', ai_error: null });
    return nudgeAssistant(msg.id);
  }, [send, patchRow]);

  return { send, retry, sending };
}

// Prepend an older page to the shared cache, skipping rows we already hold. The
// cache stays a FLAT oldest→newest array — no infinite-query page shape — so
// applyChatRow, the widget and the unread counter are untouched.
export function prependChatMessages(qc, chatId, older) {
  qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) => {
    const have = new Set(old.map((m) => m.id));
    return [...older.filter((m) => !have.has(m.id)), ...old];
  });
}

// ── Unread count ──────────────────────────────────────────────────────────────
//
// Direct COUNT-query against the DB - independent of any chat-messages cache.
// Different views (ChatLens, ChatWidget, etc.) load messages under their own
// query keys; we don't want the badge to depend on which view is mounted.

export function useUnreadChatCount(tripId, { enabled = true } = {}) {
  const { user } = useAuth();
  const { data: chatId } = useChatId(tripId, { enabled: !!tripId && enabled });
  useChatLiveSubscription(tripId, { enabled: !!chatId && enabled });
  const q = useQuery({
    queryKey: CHAT_UNREAD_KEY(tripId, user?.id),
    queryFn: async () => {
      if (!chatId || !user?.id) return 0;
      const { data: read } = await supabase
        .from('chat_reads')
        .select('last_read_at')
        .eq('chat_id', chatId)
        .eq('user_id', user.id)
        .maybeSingle();
      const lastReadAt = read?.last_read_at || null;
      let query = supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('chat_id', chatId)
        .neq('user_id', user.id);
      if (lastReadAt) query = query.gt('created_at', lastReadAt);
      const { count } = await query;
      return count || 0;
    },
    enabled: !!chatId && !!user?.id && enabled,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  return q.data || 0;
}

// ── Shared realtime: ONE channel per chat_id per client (TRIP-208 Ф2-2b) ──────
//
// Every chat consumer needs the SAME event: "a row of this chat changed" — an
// INSERT (a message arrived) or an UPDATE (the assistant run on a message moved
// to running / done / failed / timeout, which is how every participant's
// "Triplanio typing" indicator turns on and off). Previously each consumer opened its own
// supabase.channel(), so a single trip screen held THREE duplicate channels to
// one chat_id (sidebar badge + widget unread + widget's own) and every message
// was WAL-decoded / RLS-checked / delivered 3× to the same browser. Consumers
// keep their own message caches, so we can't collapse the caches - but we can
// collapse the transport: this registry keeps exactly ONE channel per chat_id
// and fans each payload out to all local subscribers. The channel is closed when
// the LAST subscriber leaves (ref-counted → no dangling subscription). Because
// only the registry ever calls .subscribe() for a given chat_id, a stable
// channel name is safe (the old random suffix existed only to dodge the
// "can't add callbacks after subscribe()" throw from two .subscribe() calls
// sharing a name - which no longer happens).
const chatRowRegistry = new Map(); // chatId -> { channel, subscribers:Set<fn> }

function subscribeChatRows(chatId, onRow) {
  if (!chatId) return () => {};
  let entry = chatRowRegistry.get(chatId);
  if (!entry) {
    const subscribers = new Set();
    const channel = supabase
      .channel(`chat-rows-${chatId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_messages',
        filter: `chat_id=eq.${chatId}`,
      }, (payload) => {
        // A DELETE payload carries no new row — nothing to merge (and nobody can
        // delete a message any more: the grant is revoked).
        if (!payload.new?.id) return;
        for (const fn of subscribers) fn(payload.new, payload.eventType);
      })
      .subscribe();
    entry = { channel, subscribers };
    chatRowRegistry.set(chatId, entry);
  }
  entry.subscribers.add(onRow);
  return () => {
    entry.subscribers.delete(onRow);
    if (entry.subscribers.size === 0) {
      supabase.removeChannel(entry.channel);
      chatRowRegistry.delete(chatId);
    }
  };
}

/** Register `onRow(newRow, eventType)` for a chat's row changes for the life of
 *  the component, sharing one underlying channel per chat_id (see registry
 *  above). `onRow` may change every render without re-subscribing (held in a ref). */
export function useChatRows(chatId, onRow, { enabled = true } = {}) {
  const cbRef = useRef(onRow);
  cbRef.current = onRow;
  // Deps are ONLY [chatId, enabled] by design: onRow is read through cbRef, so
  // a caller passing a fresh inline callback (closing over tripId/qc) every render
  // does NOT re-subscribe. Don't add onRow here. `enabled` is destructured to a
  // primitive, so the options-object identity never triggers a re-subscribe.
  useEffect(() => {
    if (!chatId || !enabled) return undefined;
    return subscribeChatRows(chatId, (msg, ev) => cbRef.current?.(msg, ev));
  }, [chatId, enabled]);
}

// ── Live subscription (badge engine) ──────────────────────────────────────────
//
// Keeps the unread badge live by refreshing the count on a new message. Rides the
// shared channel above (mounting it in both the sidebar and the widget no longer
// opens two channels). It does NOT touch the message cache: the widget/lens each
// merge into the shared cache via their own useChatRows, so the badge only
// needs to invalidate unread — and only on an INSERT: an assistant-status UPDATE
// changes no counts, and re-counting on each would triple the queries.
function useChatLiveSubscription(tripId, { enabled = true } = {}) {
  const { data: chatId } = useChatId(tripId, { enabled: !!tripId && enabled });
  const qc = useQueryClient();
  useChatRows(chatId, (_row, ev) => {
    if (ev === 'INSERT') qc.invalidateQueries({ queryKey: ['chat-unread', tripId] });
  }, { enabled: !!chatId && enabled });
}
