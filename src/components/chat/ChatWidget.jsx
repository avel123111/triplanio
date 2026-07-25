/**
 * ChatWidget - floating chat button + docked panel.
 *
 * Mounted by TripView on every lens *except* the dedicated chat lens, and never
 * on phones (there the room itself is the whole screen).
 *
 * A denser shell around the SAME ChatStream + ChatComposer the lens uses: it
 * keeps only what genuinely differs — the dock chrome, the unread badge and the
 * lazy "fetch on open" message query.
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { TRIPLANIO_BOT_USER_ID } from '@/lib/triplanio';
import { mentionsTriplanio } from '@/lib/mention';
import { useChatId, useUnreadChatCount, useChatInserts, useChatMessages, appendChatMessage, askAssistant, CHAT_MESSAGES_KEY, chatParticipants, pluralPeople } from '@/lib/chat';
import { useI18n } from '@/lib/i18n/I18nContext';
import { AvatarStack, EmptyState } from '@/design/index';
import { resolveMembers } from '@/lib/resolveAuthor';
import ChatStream from './ChatStream';
import ChatComposer from './ChatComposer';
import { Icon } from '@/design/icons';
import { displayName } from '@/lib/displayName';
import { useUserProfiles } from '@/lib/useUserProfiles';

export default function ChatWidget({ tripId, members = [], tripTitle, ownerId }) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [failedAiIds, setFailedAiIds] = useState(() => new Set());
  const scrollRef = useRef(null);

  const myName = displayName(user?.email, user?.user_metadata?.full_name || user?.full_name);
  const unread = useUnreadChatCount(tripId);
  const { data: chatId } = useChatId(tripId);

  // ── Load messages (only when open) ── shared cache with the chat lens.
  const { data: msgs = [] } = useChatMessages(chatId, { enabled: open });

  // ── Realtime ── rides the shared per-chat_id channel (TRIP-208 Ф2-2b): append
  // the new message to this widget's own cache + refresh unread. No standalone
  // channel anymore, so the widget no longer duplicates the sidebar/lens ones.
  // Only maintain the message cache while OPEN: a closed widget doesn't render
  // messages, and priming the shared cache with a partial list would flash on
  // next open. Unread stays live regardless via useUnreadChatCount's own sub.
  useChatInserts(chatId, (msg) => {
    appendChatMessage(qc, chatId, msg);
    qc.invalidateQueries({ queryKey: ['chat-unread', tripId] });
  }, { enabled: open });

  // ── Auto-scroll ──
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, open]);

  // ── Mark read on open ──
  useEffect(() => {
    if (!open || !chatId || !user?.id) return;
    supabase.from('chat_reads').upsert(
      { chat_id: chatId, user_id: user.id, trip_id: tripId, last_read_at: new Date().toISOString() },
      { onConflict: 'chat_id,user_id' },
    ).then(() => qc.invalidateQueries({ queryKey: ['chat-unread', tripId] }));
  }, [open, chatId, user?.id]);

  // ── Display names ── include the owner: they usually have NO trip_members
  // row, so without this the owner's name/avatar never resolve in the chat.
  const profileIds = [...members.map((m) => m.user_id), ownerId].filter(Boolean);
  const profiles = useUserProfiles(profileIds, tripId);

  // ── Thinking state ──
  const isThinking = useMemo(() => {
    if (!msgs.length) return false;
    const last = msgs[msgs.length - 1];
    if (!last || last.user_id === TRIPLANIO_BOT_USER_ID) return false;
    if (failedAiIds.has(last.id)) return false;
    return mentionsTriplanio(last.text);
  }, [msgs, failedAiIds]);

  // ── Send ──
  async function sendMessage(content) {
    if (!content || sending || !chatId) return;
    setSending(true);

    const optId = 'opt-' + Date.now();
    qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) => [...old, {
      id: optId, chat_id: chatId, trip_id: tripId,
      user_id: user?.id,
      user_full_name: myName, text: content,
      created_at: new Date().toISOString(), __pending: true,
    }]);

    const { data: created, error } = await supabase.from('chat_messages')
      .insert({
        chat_id: chatId, trip_id: tripId,
        user_id: user?.id, user_full_name: myName,
        text: content, created_by: user?.id,
      })
      .select('id').single();

    setSending(false);
    if (error) {
      console.error('ChatWidget send error', error);
      qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) => old.filter((m) => m.id !== optId));
      return;
    }
    // Settle from the INSERT result — waiting for the realtime echo left the
    // row dimmed as "sending" until a reload (see the lens for the full note).
    qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) =>
      old.map((m) => (m.id === optId ? { ...m, id: created?.id || optId, __pending: false } : m)));

    const mentionsAi = mentionsTriplanio(content);
    // Tagged @Triplanio → tripl_message_sent; plain message → chat_message_sent.
    track(mentionsAi ? 'tripl_message_sent' : 'chat_message_sent', { trip_id: tripId });

    if (mentionsAi) {
      const realId = created?.id;
      askAssistant({
        chatId,
        userMessage: content,
        onFailed: () => { if (realId) setFailedAiIds((p) => new Set([...p, realId])); },
      });
    }
  }

  const activeMembers = chatParticipants(members, ownerId);

  // ── Closed: floating button ──
  if (!open) {
    return (
      <button
        className="dock"
        onClick={() => setOpen(true)}
        aria-label={t('chat.open_aria')}
      >
        <Icon name="chat" size={22} />
        {unread > 0 && (
          <div className="dock__count">{unread > 99 ? '99+' : unread}</div>
        )}
      </button>
    );
  }

  // ── Open: docked panel ──
  return (
    <div className="dock-panel">
      {/* One header row: who is in the chat, where it is, and the two ways out
          (full screen / collapse). The old tab strip above it listed a single
          always-active tab, so it was chrome with nothing to switch. */}
      <div className="dock-panel__head">
        <AvatarStack people={resolveMembers(activeMembers, { profiles, selfUser: user, deletedLabel: t('common.deleted_user') })} />
        <div className="dock-panel__id">
          <b>{t('chat.group_title')}</b>
          <span>{tripTitle ? `${tripTitle} · ` : ''}{pluralPeople(activeMembers.length, t, lang)}</span>
        </div>
        <button
          className="icon-btn"
          onClick={() => navigate(`/trip/${tripId}?lens=chat`)}
          aria-label={t('chat.open_full_aria')}
        >
          <Icon name="expand" size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => setOpen(false)}
          aria-label={t('common.close')}
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      <div ref={scrollRef} className="chat-msgs scrollbar-thin">
        {msgs.length === 0 ? (
          <div style={{ margin: 'auto' }}>
            <EmptyState icon="chat" title={t('chat.write_first')} />
          </div>
        ) : (
          <ChatStream messages={msgs} selfUser={user} profiles={profiles} members={members} />
        )}
      </div>

      <div className="dock-panel__dock">
        <ChatComposer
          onSend={sendMessage}
          disabled={sending || !chatId}
          placeholder={t('chat.widget_composer_ph')}
          isThinking={isThinking}
          maxHeight={90}
        />
      </div>
    </div>
  );
}
