/**
 * ChatWidget - floating chat button + collapsible panel.
 *
 * Mounted by TripView on every lens *except* the dedicated chat lens.
 * Design matches DockedChat from the reference prototype (dock.jsx).
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, X, ExternalLink, Sparkles } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { TRIPLANIO_BOT_USER_ID, TRIPLANIO_BOT_NAME, highlightMentions } from '@/lib/triplanio';
import { useChatId, useUnreadChatCount, useChatInserts, useChatMessages, appendChatMessage, CHAT_MESSAGES_KEY, chatParticipants, pluralPeople } from '@/lib/chat';
import { useI18n } from '@/lib/i18n/I18nContext';
import TriplanioAvatar from './TriplanioAvatar';
import ChatMarkdown from './ChatMarkdown';
import ChatReply from './ChatReply';
import { Avatar, AvatarStack, EmptyState } from '@/design/index';
import { Icon } from '@/design/icons';
import { displayName } from '@/lib/displayName';
import { useUserProfiles } from '@/lib/useUserProfiles';

export default function ChatWidget({ tripId, members = [], tripTitle, ownerId }) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [failedAiIds, setFailedAiIds] = useState(() => new Set());
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const ovRef = useRef(null);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chatId, user?.id]);

  // ── Display names ── include the owner: they usually have NO trip_members
  // row, so without this the owner's name/avatar never resolve in the chat.
  const profileIds = [...members.map((m) => m.user_id), ownerId].filter(Boolean);
  const profiles = useUserProfiles(profileIds, tripId);
  const nameFor = (userId) => {
    let real = profiles[userId]?.full_name;
    let email = profiles[userId]?.email || '';
    if (!real) {
      const mm = members.find((m) => m.user_id === userId);
      real = mm?.user_full_name || '';
      email = email || mm?.invite_email || '';
    }
    if (!real && user?.id && userId === user.id) {
      real = user.full_name || '';
      email = email || user.email || '';
    }
    return displayName(email, real);
  };

  // ── Thinking state ──
  const isThinking = useMemo(() => {
    if (!msgs.length) return false;
    const last = msgs[msgs.length - 1];
    if (!last || last.user_id === TRIPLANIO_BOT_USER_ID) return false;
    if (failedAiIds.has(last.id)) return false;
    return /@triplanio\b/i.test(last.text || '');
  }, [msgs, failedAiIds]);

  // ── Send ──
  async function sendMessage() {
    const content = text.trim();
    if (!content || sending || !chatId) return;
    setText('');
    setShowMention(false);
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

    const mentionsAi = /@triplanio\b/i.test(content);
    // Tagged @Triplanio → tripl_message_sent; plain message → chat_message_sent.
    track(mentionsAi ? 'tripl_message_sent' : 'chat_message_sent', { trip_id: tripId });

    if (mentionsAi) {
      const realId = created?.id;
      invokeFn('callTriplanioAi', { body: { chat_id: chatId, user_message: content } })
        .catch((err) => {
          console.error('callTriplanioAi failed', err);
          if (realId) setFailedAiIds((p) => new Set([...p, realId]));
        });
    }
  }

  const activeMembers = chatParticipants(members, ownerId);

  // Completes a trailing @token, or inserts the mention when there is none (the
  // "@" button on an empty field) — a bare .replace() would no-op there.
  function applyMention(handle) {
    setText((prev) => (/@(\w*)$/.test(prev)
      ? prev.replace(/@(\w*)$/, '@' + handle + ' ')
      : (prev && !prev.endsWith(' ') ? prev + ' ' : prev) + '@' + handle + ' '));
    setShowMention(false);
  }

  // Auto-grow the composer up to ~4 lines, then scroll; keep the highlight
  // overlay's scroll offset in lockstep with the textarea.
  const COMPOSER_MAX_H = 90; // ≈ 4 lines @ 13px / 1.4
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, COMPOSER_MAX_H);
    ta.style.height = next + 'px';
    ta.style.overflowY = ta.scrollHeight > COMPOSER_MAX_H ? 'auto' : 'hidden';
  }, [text, open]);
  // Re-attach on `open` - the composer (and its refs) only mount when the
  // widget is open, so an empty-deps effect would never bind the scroll sync.
  useEffect(() => {
    const ta = taRef.current;
    const ov = ovRef.current;
    if (!ta || !ov) return undefined;
    const sync = () => { ov.scrollTop = ta.scrollTop; };
    ta.addEventListener('scroll', sync);
    return () => ta.removeEventListener('scroll', sync);
  }, [open]);

  // Memoized message elements - typing in the composer (same component) must
  // NOT rebuild every bubble on each keystroke (that caused the typing lag).
  const messageEls = useMemo(() => msgs.map((m, i) => {
    let time = '';
    try { time = new Date(m.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }); } catch { /* ignore */ }
    // Same assistant-as-document rendering as the lens, just a narrower column.
    if (m.user_id === TRIPLANIO_BOT_USER_ID) return <ChatReply key={m.id} text={m.text || ''} time={time} />;
    const prev = i > 0 ? msgs[i - 1] : null;
    const next = i < msgs.length - 1 ? msgs[i + 1] : null;
    const isMe = m.user_id === user?.id;
    const grouped = prev && prev.user_id === m.user_id &&
      new Date(m.created_at).toDateString() === new Date(prev.created_at).toDateString();
    const lastOfRun = !(next && next.user_id === m.user_id &&
      new Date(m.created_at).toDateString() === new Date(next.created_at).toDateString());
    const who = nameFor(m.user_id);
    const bubbleMod = isMe ? 'chat-bubble--me' : 'chat-bubble--them';
    return (
      <div key={m.id} className={'chat-row' + (isMe ? ' chat-row--me' : '') + (grouped ? ' chat-row--grouped' : '')}>
        {!isMe && (
          <div className="chat-row__sp">
            {lastOfRun && <Avatar name={who} photo={profiles[m.user_id]?.avatar_url || ''} deleted={profiles[m.user_id]?.is_deleted} />}
          </div>
        )}
        <div className="chat-col">
          {!grouped && !isMe && (
            <div className="chat-name">
              <b>{who}</b>
              <span className="tm">{time}</span>
            </div>
          )}
          <div className={'chat-bubble ' + bubbleMod + (m.__pending ? ' chat-bubble--pending' : '')}>
            <ChatMarkdown
              text={m.text || ''}
              mentionStyle={isMe ? { color: 'rgba(255,255,255,0.9)', fontWeight: 700 /* design-token-exempt: inline mention emphasis */ } : { color: 'var(--ai)', fontWeight: 700 /* design-token-exempt: inline mention emphasis */ }}
            />
          </div>
          {isMe && !grouped && (
            <div className="chat-time">{time}</div>
          )}
        </div>
      </div>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [msgs, profiles, user?.id]);

  // ── Closed: floating button (rendered when the panel/sheet is shut) ──
  const closedFab = (
    <button
      className="dock dock--ai"
      onClick={() => setOpen(true)}
      aria-label={t('chat.open_aria')}
    >
      <MessageCircle size={22} />
      {unread > 0 && (
        <div className="dock__count">{unread > 99 ? '99+' : unread}</div>
      )}
      {/* Sparkles sub-badge - purely decorative, signals AI is part of the chat */}
      <span style={{
        position: 'absolute', bottom: -3, right: -3,
        width: 22, height: 22, borderRadius: '50%',
        background: 'var(--ai-gradient)', color: 'white',
        border: '2px solid var(--surface)',
        display: 'grid', placeItems: 'center',
        pointerEvents: 'none',
      }}>
        <Sparkles size={11} />
      </span>
    </button>
  );

  // ── Open panel ──
  const headInner = (
    <div className="dock-panel__head">
      {/* Was a hand-rolled stack of <Avatar>s with inline negative margins —
          the same thing AvatarStack already draws (TRIP-296). */}
      <AvatarStack
        people={activeMembers.map((m) => ({
          name: nameFor(m.user_id),
          photo: profiles[m.user_id]?.avatar_url,
          deleted: profiles[m.user_id]?.is_deleted,
        }))}
      />
      <div className="nm">
        {tripTitle ? <><b>{tripTitle}</b>{' · '}</> : ''}{pluralPeople(activeMembers.length, t, lang)}
      </div>
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        onClick={() => navigate(`/trip/${tripId}?lens=chat`)}
        aria-label={t('chat.open_full_aria')}
      >
        <ExternalLink size={14} />
      </button>
    </div>
  );

  const messagesInner = (
    <div ref={scrollRef} className="chat-msgs scrollbar-thin">
      {msgs.length === 0 ? (
        <div style={{ margin: 'auto' }}>
          <EmptyState icon="chat" title={t('chat.write_first')} />
        </div>
      ) : messageEls}
      {isThinking && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
          <TriplanioAvatar size="sm" />
          <span className="t-meta" style={{ color: 'var(--ai)' }}>{t('chat.typing')}</span>
          <span className="ai-dots"><span /><span /><span /></span>
        </div>
      )}
    </div>
  );

  const composerInner = (
    <div className="chat-composer">
      {showMention && (
        <div className="chat-mention" style={{ left: 10, width: 240 }}>
          {/* Only @Triplanio is actionable - members aren't mentionable, so the
              popup lists just the assistant. */}
          <button
            onMouseDown={(e) => { e.preventDefault(); applyMention(TRIPLANIO_BOT_NAME); }}
            className="chat-mention__row"
          >
            <TriplanioAvatar />
            <span style={{ flex: 1 }}>
              <b>{TRIPLANIO_BOT_NAME}</b>
              <span>{t('chat.mention_all_hint')}</span>
            </span>
          </button>
        </div>
      )}
      <div className="chat-composer__row">
        <button
          type="button"
          className="chat-at"
          onClick={() => { applyMention(TRIPLANIO_BOT_NAME); taRef.current?.focus(); }}
          title={t('chat.mention_all_hint')}
          aria-label={t('chat.mention')}
        >
          <Icon name="at" size={16} />
        </button>
        <div className="chat-composer__field">
          {/* No .textarea class: the row is the bordered surface. Both layers
              must keep identical metrics or the caret drifts. */}
          <div
            ref={ovRef}
            aria-hidden="true"
            className="chat-ov"
            dangerouslySetInnerHTML={{ __html: highlightMentions(text) + '​' }}
          />
          <textarea
            ref={taRef}
            className="chat-ta"
            placeholder={t('chat.widget_composer_ph')}
            value={text}
            rows={1}
            onChange={(e) => {
              const v = e.target.value;
              setText(v);
              setShowMention(/(^|\s)@(\w*)$/.test(v));
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            style={{ minHeight: 40, maxHeight: 90 }}
          />
        </div>
        <button
          type="button"
          className="chat-send"
          onClick={sendMessage}
          disabled={sending || !text.trim() || !chatId}
          aria-label={t('chat.send')}
        >
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  );

  // ── Closed: floating button ──
  if (!open) return closedFab;

  // ── Open: docked panel ──
  return (
    <div className="dock-panel">
      {/* Tab bar - single "group chat" tab + close */}
      <div className="dock-panel__tabs">
        <button className="dock-panel__tab active" style={{ flex: 1, justifyContent: 'flex-start' }}>
          <MessageCircle size={14} />
          {t('chat.group_title')}
          {unread > 0 && (
            <span className="t-micro" style={{
              marginLeft: 4, background: 'var(--warm)', color: 'white',
              borderRadius: 999,
              minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 4px',
            }}>{unread > 99 ? '99+' : unread}</span>
          )}
        </button>
        <button
          className="icon-btn"
          style={{ width: 32, height: 32, flexShrink: 0, marginBottom: 6 }}
          onClick={() => setOpen(false)}
          aria-label={t('common.close')}
        >
          <X size={14} />
        </button>
      </div>

      {headInner}

      {/* Thinking shimmer bar */}
      {isThinking && <div className="chat-thinking-bar" />}

      {messagesInner}

      {composerInner}
    </div>
  );
}
