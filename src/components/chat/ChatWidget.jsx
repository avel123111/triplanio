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
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useChatId, useUnreadChatCount, useChatRows, useChatMessages, useChatSend, applyChatRow, isAiThinking, chatParticipants, pluralPeople } from '@/lib/chat';
import { useI18n } from '@/lib/i18n/I18nContext';
import { AvatarStack, EmptyState } from '@/design/index';
import { resolveMembers } from '@/lib/resolveAuthor';
import ChatStream from './ChatStream';
import ChatComposer from './ChatComposer';
import { Icon } from '@/design/icons';
import { useUserProfiles } from '@/lib/useUserProfiles';

export default function ChatWidget({ tripId, members = [], tripTitle, ownerId }) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const scrollRef = useRef(null);

  const unread = useUnreadChatCount(tripId);
  const { data: chatId } = useChatId(tripId);

  // ── Send ── the SAME seam the lens uses (the widget used to carry its own copy,
  // which had already drifted: a failed send silently dropped the user's text).
  const { send, retry, sending } = useChatSend(chatId, tripId);

  // ── Load messages (only when open) ── shared cache with the chat lens.
  const { data: msgs = [] } = useChatMessages(chatId, { enabled: open });

  // ── Realtime ── rides the shared per-chat_id channel (TRIP-208 Ф2-2b): append
  // the new message to this widget's own cache + refresh unread. No standalone
  // channel anymore, so the widget no longer duplicates the sidebar/lens ones.
  // Only maintain the message cache while OPEN: a closed widget doesn't render
  // messages, and priming the shared cache with a partial list would flash on
  // next open. Unread stays live regardless via useUnreadChatCount's own sub.
  useChatRows(chatId, (msg, ev) => {
    applyChatRow(qc, chatId, msg);
    if (ev === 'INSERT') qc.invalidateQueries({ queryKey: ['chat-unread', tripId] });
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

  // ── Thinking state ── server state, same as the lens (see useChatSend).
  const isThinking = isAiThinking(msgs);

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
          <ChatStream messages={msgs} selfUser={user} profiles={profiles} members={members} onRetry={retry} />
        )}
      </div>

      <div className="dock-panel__dock">
        <ChatComposer
          onSend={send}
          disabled={sending || !chatId}
          placeholder={t('chat.widget_composer_ph')}
          isThinking={isThinking}
          maxHeight={90}
        />
      </div>
    </div>
  );
}
