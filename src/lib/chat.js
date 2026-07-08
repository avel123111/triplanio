import { pluralCategory } from '@/lib/i18n/format';
// Helpers for the trip chat: queries, read-markers, unread counters.
//
// All queries pivot on chat_id (from the chats table - one "group" chat per
// trip) and on user_id (uuid) rather than user_email.

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { withOwnerRow } from '@/lib/members';

// Keyed by chat_id (not tripId): the chat widget and the chat lens are never
// mounted together, so ONE cache per chat_id is shared between them — switching
// lenses reuses it instead of refetching (TRIP-208: was 3 separate caches).
export const CHAT_MESSAGES_KEY = (chatId) => ['chat-msgs', chatId];
export const CHAT_READ_KEY     = (tripId, userId) => ['chat-read', tripId, userId];
export const CHAT_ID_KEY       = (tripId) => ['chat-id', tripId];
export const CHAT_UNREAD_KEY   = (tripId, userId) => ['chat-unread', tripId, userId];

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

// ── Timestamp helpers ─────────────────────────────────────────────────────────

function parseUtcMs(s) {
  if (!s) return 0;
  if (s instanceof Date) return s.getTime();
  let str = String(s);
  if (!/[zZ]$/.test(str) && !/[+-]\d{2}:?\d{2}$/.test(str)) str += 'Z';
  const t = new Date(str).getTime();
  return Number.isFinite(t) ? t : 0;
}

function toUtcIso(s) {
  if (!s) return new Date().toISOString();
  const ms = parseUtcMs(s);
  return ms ? new Date(ms).toISOString() : new Date().toISOString();
}

// ── Count unread (used by tests / local computation) ─────────────────────────

export function countUnread(messages, lastReadAt, myUserId) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  const cutoff = parseUtcMs(lastReadAt);
  let n = 0;
  for (const m of messages) {
    if (m.user_id === myUserId) continue;
    const t = parseUtcMs(m.created_at);
    if (t > cutoff) n += 1;
  }
  return n;
}

// ── Fetch messages ────────────────────────────────────────────────────────────
//
// ONE shared message cache per chat_id (TRIP-208): both the chat widget and the
// chat lens use this hook, so they no longer keep two independent caches of the
// same rows. `enabled` lets the widget stay lazy (fetch only when opened) while
// the lens fetches on mount.
export function useChatMessages(chatId, { enabled = true } = {}) {
  return useQuery({
    queryKey: CHAT_MESSAGES_KEY(chatId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!chatId && enabled,
    // Catch up any messages missed while unmounted on (re)mount; realtime keeps
    // it live thereafter. No refetchOnWindowFocus — respect the app-wide default
    // (query-client.js sets it false) since realtime already delivers new rows.
    refetchOnMount: 'always',
  });
}

// Apply an incoming realtime INSERT to the shared message cache: de-dupe by id,
// drop this user's optimistic ('opt-') placeholder, append. Shared by the widget
// and the lens so the append logic lives in ONE place (TRIP-208).
export function appendChatMessage(qc, chatId, msg) {
  qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) => {
    if (old.find((m) => m.id === msg.id)) return old;
    const filtered = old.filter((m) =>
      !(String(m.id).startsWith('opt-') && m.user_id === msg.user_id),
    );
    return [...filtered, msg];
  });
}

// ── Fetch my read marker ──────────────────────────────────────────────────────

export function useMyChatRead(tripId, { enabled = true } = {}) {
  const { user } = useAuth();
  const { data: chatId } = useChatId(tripId, { enabled: !!tripId && !!user?.id && enabled });
  return useQuery({
    queryKey: CHAT_READ_KEY(tripId, user?.id),
    queryFn: async () => {
      const { data } = await supabase
        .from('chat_reads')
        .select('*')
        .eq('chat_id', chatId)
        .eq('user_id', user.id)
        .maybeSingle();
      return data || null;
    },
    enabled: !!chatId && !!user?.id && enabled,
    refetchOnMount: 'always',
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
// Every chat consumer needs the SAME event: "a row was INSERTed into
// chat_messages for this chat". Previously each consumer opened its own
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
const chatInsertRegistry = new Map(); // chatId -> { channel, subscribers:Set<fn> }

export function subscribeChatInserts(chatId, onInsert) {
  if (!chatId) return () => {};
  let entry = chatInsertRegistry.get(chatId);
  if (!entry) {
    const subscribers = new Set();
    const channel = supabase
      .channel(`chat-inserts-${chatId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `chat_id=eq.${chatId}`,
      }, (payload) => {
        for (const fn of subscribers) fn(payload.new);
      })
      .subscribe();
    entry = { channel, subscribers };
    chatInsertRegistry.set(chatId, entry);
  }
  entry.subscribers.add(onInsert);
  return () => {
    entry.subscribers.delete(onInsert);
    if (entry.subscribers.size === 0) {
      supabase.removeChannel(entry.channel);
      chatInsertRegistry.delete(chatId);
    }
  };
}

/** Register `onInsert(newRow)` for a chat's inserts for the life of the
 *  component, sharing one underlying channel per chat_id (see registry above).
 *  `onInsert` may change every render without re-subscribing (held in a ref). */
export function useChatInserts(chatId, onInsert, { enabled = true } = {}) {
  const cbRef = useRef(onInsert);
  cbRef.current = onInsert;
  // Deps are ONLY [chatId, enabled] by design: onInsert is read through cbRef, so
  // a caller passing a fresh inline callback (closing over tripId/qc) every render
  // does NOT re-subscribe. Don't add onInsert here. `enabled` is destructured to a
  // primitive, so the options-object identity never triggers a re-subscribe.
  useEffect(() => {
    if (!chatId || !enabled) return undefined;
    return subscribeChatInserts(chatId, (msg) => cbRef.current?.(msg));
  }, [chatId, enabled]);
}

// ── Live subscription (badge engine) ──────────────────────────────────────────
//
// Keeps the unread badge live by refreshing the count on a new message. Rides the
// shared channel above (mounting it in both the sidebar and the widget no longer
// opens two channels). It does NOT touch the message cache: the widget/lens each
// append to the shared cache via their own useChatInserts, so the badge only
// needs to invalidate unread.
export function useChatLiveSubscription(tripId, { enabled = true } = {}) {
  const { data: chatId } = useChatId(tripId, { enabled: !!tripId && enabled });
  const qc = useQueryClient();
  useChatInserts(chatId, () => {
    qc.invalidateQueries({ queryKey: ['chat-unread', tripId] });
  }, { enabled: !!chatId && enabled });
}

// ── Mark read ─────────────────────────────────────────────────────────────────

export async function markChatRead(tripId, userId, lastReadAt) {
  const ts = toUtcIso(lastReadAt);
  const { data: chat } = await supabase
    .from('chats').select('id').eq('trip_id', tripId).eq('type', 'group').single();
  if (!chat?.id || !userId) return null;
  const { data, error } = await supabase
    .from('chat_reads')
    .upsert(
      { chat_id: chat.id, user_id: userId, trip_id: tripId, last_read_at: ts },
      { onConflict: 'chat_id,user_id' },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}
