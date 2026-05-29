import React, { useEffect, useRef, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquare } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { useT } from '@/lib/i18n/I18nContext';
import {
  useChatMessages,
  useMyChatRead,
  useChatLiveSubscription,
  markChatRead,
  CHAT_MESSAGES_KEY,
  CHAT_READ_KEY,
} from '@/lib/chat';
import ChatMessageBubble from './ChatMessageBubble';
import ChatComposer from './ChatComposer';
import { DateTime } from 'luxon';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { startsWithTriplanioMention, TRIPLANIO_BOT_USER_ID, mentionsTriplanio } from '@/lib/triplanio';
import { useToast } from '@/components/ui/use-toast';
import TriplanioAvatar from './TriplanioAvatar.jsx';

/**
 * Trip chat — one chat per trip. All active members can read & write.
 * Plain text messages only for now.
 *
 * Layout: full-height column inside the tab — messages scroll, composer pinned
 * to the bottom. We auto-scroll to the bottom on new messages and mark the
 * chat as read whenever the user is looking at it.
 */
export default function TripChatTab({ tripId, trip }) {
  const t = useT();
  const { locale } = useI18nFormat();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: messages, isLoading } = useChatMessages(tripId);
  const { data: read } = useMyChatRead(tripId);
  useChatLiveSubscription(tripId);

  // IDs of messages whose AI call failed (callTriplanioAi rejected). Used to
  // hide the "Triplanio is thinking…" strip — the bot will never reply for
  // these, so showing the indicator forever is wrong.
  const [failedAiMessageIds, setFailedAiMessageIds] = useState(() => new Set());

  // Resolve author profiles (avatar_url + full_name) so chat avatars match the
  // ones shown in the Members card. We ALWAYS include the Triplanio bot
  // email so the bot avatar is resolved exactly once per trip — this
  // eliminates a race where multiple <TriplanioAvatar> instances issued
  // parallel resolveProfiles requests and intermittently rendered the
  // fallback robot icon.
  const authorIds = useMemo(() => {
    const set = new Set((messages || []).map((m) => m.user_id).filter(Boolean));
    if (TRIPLANIO_BOT_USER_ID) set.add(TRIPLANIO_BOT_USER_ID);
    return Array.from(set);
  }, [messages]);
  const profiles = useUserProfiles(authorIds, tripId);
  const botAvatarUrl = profiles?.[TRIPLANIO_BOT_USER_ID]?.avatar_url || '';

  const scrollRef = useRef(null);

  // Auto-scroll to the bottom whenever the message list grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages?.length]);

  // Mark as read on mount + whenever new messages arrive while this tab is open.
  useEffect(() => {
    if (!user?.id || !tripId) return;
    if (!messages || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    const lastTs = lastMsg.created_date;
    const myTs = read?.last_read_at;
    // Normalize: Base44 sometimes returns ISO strings without "Z" suffix
    // which JS would interpret as local time. Treat naive strings as UTC.
    const toMs = (s) => {
      if (!s) return 0;
      const str = String(s);
      return new Date(/[zZ]$/.test(str) || /[+-]\d{2}:?\d{2}$/.test(str) ? str : str + 'Z').getTime();
    };
    if (myTs && toMs(myTs) >= toMs(lastTs)) return;
    // OPTIMISTIC: update the local read-marker cache immediately so the
    // unread badge clears instantly (before the server round-trip). This
    // prevents the chat icon from showing a stale "X new messages" badge
    // while the user is actively reading the chat — useChatLiveSubscription
    // and useUnreadChatCount both recompute against this cached value.
    qc.setQueryData(CHAT_READ_KEY(tripId, user.id), (prev) => ({
      ...(prev || { trip_id: tripId, user_id: user.id }),
      last_read_at: lastTs,
    }));
    markChatRead(tripId, user.id, lastTs).then(() => {
      qc.invalidateQueries({ queryKey: CHAT_READ_KEY(tripId, user.id) });
    });
  }, [messages, read, tripId, user?.id, qc]);

  const sendMut = useMutation({
    mutationFn: async (text) => {
      const created = await base44.entities.ChatMessage.create({
        trip_id: tripId,
        user_id: user.id,
        user_full_name: user.full_name || user.email,
        text,
      });
      // Bump my own read marker so I don't see my own message as "unread".
      await markChatRead(tripId, user.id, created.created_date || new Date().toISOString());

      // If the message starts with @Triplanio — trigger the AI assistant.
      // Fire-and-forget on the client (the backend is what actually posts to
      // n8n and waits); errors are surfaced as a toast but don't roll back
      // the user message. On failure we also flag the message id so the
      // "Triplanio is thinking…" strip stops being shown for it.
      if (startsWithTriplanioMention(text)) {
        const failedMsgId = created.id;
        base44.functions
          .invoke('callTriplanioAi', { trip_id: tripId, user_message: text })
          .catch((err) => {
            console.error('callTriplanioAi failed', err);
            toast({ description: t('chat.ai_error'), variant: 'destructive' });
            setFailedAiMessageIds((prev) => {
              const next = new Set(prev);
              next.add(failedMsgId);
              return next;
            });
          });
      }
      return created;
    },
    // Optimistic update: append a temporary message to the cache immediately
    // so the bubble appears in the chat without waiting for the network
    // round-trip. We tag the temp row with `__pending=true` so the bubble
    // renders at 70% opacity until the real row arrives via the live
    // subscription / settle invalidation.
    onMutate: async (text) => {
      await qc.cancelQueries({ queryKey: CHAT_MESSAGES_KEY(tripId) });
      const previous = qc.getQueryData(CHAT_MESSAGES_KEY(tripId));
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tempMsg = {
        id: tempId,
        trip_id: tripId,
        user_id: user.id,
        user_full_name: user.full_name || user.email,
        text,
        created_date: new Date().toISOString(),
        __pending: true,
      };
      qc.setQueryData(CHAT_MESSAGES_KEY(tripId), (old) => [...(old || []), tempMsg]);
      return { previous, tempId };
    },
    onError: (_err, _text, ctx) => {
      // Roll back to the previous list if the create failed.
      if (ctx?.previous !== undefined) {
        qc.setQueryData(CHAT_MESSAGES_KEY(tripId), ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CHAT_MESSAGES_KEY(tripId) });
      qc.invalidateQueries({ queryKey: CHAT_READ_KEY(tripId, user.id) });
    },
  });

  // "Triplanio is thinking" — true when the most recent message in the chat
  // mentions @Triplanio AND was not sent by the bot AND the AI call for it
  // hasn't already failed (failedAiMessageIds is populated by sendMut on
  // callTriplanioAi rejection). As soon as the bot's reply (or a non-bot
  // message after the mention) arrives, the strip hides automatically.
  const isTriplanioThinking = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    const last = messages[messages.length - 1];
    if (!last) return false;
    if (last.user_id === TRIPLANIO_BOT_USER_ID) return false;
    if (failedAiMessageIds.has(last.id)) return false;
    return mentionsTriplanio(last.text || '');
  }, [messages, failedAiMessageIds]);

  // Group messages by local day for date separators.
  const grouped = useMemo(() => {
    if (!messages) return [];
    const out = [];
    let curKey = null;
    for (const m of messages) {
      const dt = DateTime.fromISO(m.created_date).setLocale(locale);
      const key = dt.toFormat('yyyy-LL-dd');
      if (key !== curKey) {
        out.push({ type: 'day', key, label: dt.toFormat('cccc, LLL d') });
        curKey = key;
      }
      out.push({ type: 'msg', message: m });
    }
    return out;
  }, [messages, locale]);

  return (
    <div className="flex flex-col bg-muted/40 dark:bg-muted/20 border rounded-xl overflow-hidden" style={{ height: 'calc(100vh - 220px)', minHeight: '420px' }}>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2">
        {isLoading && (
          <div className="flex justify-center py-10">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && (!messages || messages.length === 0) && (
          <div className="flex flex-col items-center justify-center text-center py-16 text-muted-foreground">
            <MessageSquare className="w-10 h-10 mb-3 opacity-50" />
            <div className="text-sm font-medium">{t('chat.empty_title')}</div>
            <div className="text-xs mt-1 max-w-xs">{t('chat.empty_desc')}</div>
          </div>
        )}
        {!isLoading && grouped.map((item, idx) => {
          if (item.type === 'day') {
            return (
              <div key={`day-${item.key}`} className="flex items-center justify-center py-2">
                <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground bg-secondary px-2.5 py-0.5 rounded-full">
                  {item.label}
                </span>
              </div>
            );
          }
          const m = item.message;
          const prev = grouped[idx - 1];
          const showAuthor = !prev || prev.type === 'day' || prev.message.user_id !== m.user_id;
          const profile = profiles[m.user_id];
          return (
            <ChatMessageBubble
              key={m.id}
              message={m}
              isMine={m.user_id === user?.id}
              showAuthor={showAuthor}
              authorName={profile?.full_name || m.user_full_name}
              authorAvatarUrl={profile?.avatar_url}
              tripId={tripId}
              botAvatarUrl={botAvatarUrl}
            />
          );
        })}
      </div>

      {/* "Triplanio is thinking…" strip — shown when the most recent message
          in the chat mentions @Triplanio AND was NOT sent by the bot itself
          (i.e. there's a pending request the bot hasn't answered yet). */}
      {isTriplanioThinking && (
        <div className="border-t bg-accent/40 px-3 sm:px-4 py-1.5 flex items-center gap-2 text-xs text-primary">
          <TriplanioAvatar size="xs" ring={false} tripId={tripId} avatarUrl={botAvatarUrl} />
          <span className="font-medium">{t('chat.ai_thinking')}</span>
          <span className="inline-flex gap-0.5 ml-0.5">
            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '120ms' }} />
            <span className="w-1 h-1 rounded-full bg-primary animate-bounce" style={{ animationDelay: '240ms' }} />
          </span>
        </div>
      )}

      {/* Composer */}
      <ChatComposer
        onSend={(text) => sendMut.mutateAsync(text)}
        sending={sendMut.isPending}
        tripId={tripId}
        botAvatarUrl={botAvatarUrl}
      />
    </div>
  );
}