/**
 * ChatWidget - floating chat button + collapsible panel.
 *
 * Mounted by TripView on every lens *except* the dedicated chat lens.
 * Design matches DockedChat from the reference prototype (dock.jsx).
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, X, ExternalLink, Sparkles } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { TRIPLANIO_BOT_USER_ID, TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { useChatId, useUnreadChatCount, useChatInserts, chatParticipants, pluralPeople } from '@/lib/chat';
import { useI18n } from '@/lib/i18n/I18nContext';
import TriplanioAvatar from './TriplanioAvatar';
import ChatMarkdown from './ChatMarkdown';
import { Avatar, EmptyState, Sheet } from '@/design/index';
import { displayName } from '@/lib/displayName';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { useIsMobile } from '@/hooks/use-mobile';

const MSGS_KEY = (cid) => ['chat-widget-msgs', cid];

function highlightMentions(val) {
  // Bold look WITHOUT a font-weight change (which would widen the run and drift
  // the caret): -webkit-text-stroke thickens glyphs but keeps advance width, so
  // the transparent textarea (caret source) and this overlay stay in lockstep.
  return (val || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
    .replace(/@triplanio\b/gi, '<span style="color:var(--ai);-webkit-text-stroke:0.7px var(--ai)">$&</span>');
}

export default function ChatWidget({ tripId, members = [], tripTitle, ownerId }) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
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

  // ── Load messages (only when open) ──
  const { data: msgs = [] } = useQuery({
    queryKey: MSGS_KEY(chatId),
    queryFn: async () => {
      const { data } = await supabase.from('chat_messages').select('*')
        .eq('chat_id', chatId).order('created_at', { ascending: true }).limit(100);
      return data || [];
    },
    enabled: !!chatId && open,
  });

  // ── Realtime ── rides the shared per-chat_id channel (TRIP-208 Ф2-2b): append
  // the new message to this widget's own cache + refresh unread. No standalone
  // channel anymore, so the widget no longer duplicates the sidebar/lens ones.
  useChatInserts(chatId, (msg) => {
    qc.setQueryData(MSGS_KEY(chatId), (old = []) => {
      if (old.find((m) => m.id === msg.id)) return old;
      const filtered = old.filter((m) =>
        !(String(m.id).startsWith('opt-') && m.user_id === msg.user_id),
      );
      return [...filtered, msg];
    });
    qc.invalidateQueries({ queryKey: ['chat-unread', tripId] });
  });

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
    qc.setQueryData(MSGS_KEY(chatId), (old = []) => [...old, {
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
      qc.setQueryData(MSGS_KEY(chatId), (old = []) => old.filter((m) => m.id !== optId));
      return;
    }

    if (/@triplanio\b/i.test(content)) {
      const realId = created?.id;
      supabase.functions.invoke('callTriplanioAi', { body: { chat_id: chatId, user_message: content } })
        .catch((err) => {
          console.error('callTriplanioAi failed', err);
          if (realId) setFailedAiIds((p) => new Set([...p, realId]));
        });
    }
  }

  const activeMembers = chatParticipants(members, ownerId);

  // Active @token being typed, and the helper that completes it on select.
  const mentionToken = (/(^|\s)@(\w*)$/.exec(text)?.[2] || '').toLowerCase();
  function applyMention(handle) {
    setText((t) => t.replace(/@(\w*)$/, '@' + handle + ' '));
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
  const mentionMembers = mentionToken
    ? activeMembers.filter((m) => (nameFor(m.user_id) || '').toLowerCase().startsWith(mentionToken))
    : activeMembers;
  const triplanioMatches = !mentionToken || 'triplanio'.startsWith(mentionToken);

  // Memoized message elements - typing in the composer (same component) must
  // NOT rebuild every bubble on each keystroke (that caused the typing lag).
  const messageEls = useMemo(() => msgs.map((m, i) => {
    const prev = i > 0 ? msgs[i - 1] : null;
    const isMe = m.user_id === user?.id;
    const isAi = m.user_id === TRIPLANIO_BOT_USER_ID;
    const grouped = prev && prev.user_id === m.user_id &&
      new Date(m.created_at).toDateString() === new Date(prev.created_at).toDateString();
    const who = isAi ? TRIPLANIO_BOT_NAME : nameFor(m.user_id);
    let time = '';
    try { time = new Date(m.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }); } catch { /* ignore */ }
    const bubbleMod = isMe ? 'chat-bubble--me' : isAi ? 'chat-bubble--ai' : 'chat-bubble--them';
    return (
      <div key={m.id} className={'chat-row' + (isMe ? ' chat-row--me' : '') + (grouped ? ' chat-row--grouped' : '')}>
        {!isMe && (
          grouped
            ? <div className="chat-row__sp" aria-hidden />
            : (isAi
                ? <TriplanioAvatar size="sm" />
                : <Avatar name={who} photo={profiles[m.user_id]?.avatar_url || ''} deleted={profiles[m.user_id]?.is_deleted} size="sm" style={{ flexShrink: 0 }} />)
        )}
        <div className="chat-col">
          {!grouped && !isMe && (
            <div className="chat-name">
              <b className={isAi ? 'ai' : ''}>{who}</b>
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
        background: 'var(--ai-grad)', color: 'white',
        border: '2px solid var(--surface)',
        display: 'grid', placeItems: 'center',
        pointerEvents: 'none',
      }}>
        <Sparkles size={11} />
      </span>
    </button>
  );

  // ── Open panel — shared inner parts (identical markup + logic on desktop
  //    dock-panel and inside the mobile bottom-sheet, so chat logic is never
  //    duplicated). ──
  const headInner = (
    <div className="dock-panel__head">
      <div style={{ display: 'flex' }}>
        {activeMembers.slice(0, 4).map((m, i) => (
          <Avatar
            key={m.id || i}
            name={nameFor(m.user_id)}
            photo={profiles[m.user_id]?.avatar_url || ''}
            deleted={profiles[m.user_id]?.is_deleted}
            size="sm"
            style={{ marginLeft: i === 0 ? 0 : -8, border: '1.5px solid var(--surface)', borderRadius: '50%', zIndex: 4 - i }}
          />
        ))}
      </div>
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
          <TriplanioAvatar size="xs" />
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
            onMouseDown={(e) => { e.preventDefault(); applyMention('Triplanio'); }}
            className="chat-mention__row"
          >
            <TriplanioAvatar size="sm" />
            <span style={{ flex: 1 }}>
              <b>Triplanio</b>
              <span>{t('chat.mention_all_hint')}</span>
            </span>
          </button>
        </div>
      )}
      <div className="chat-composer__row">
        <div className="chat-composer__field">
          <div
            ref={ovRef}
            aria-hidden="true"
            className="chat-ov"
            dangerouslySetInnerHTML={{ __html: highlightMentions(text) + '​' }}
          />
          <textarea
            ref={taRef}
            className="textarea chat-ta"
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
          className="chat-send"
          onClick={sendMessage}
          disabled={sending || !text.trim() || !chatId}
          aria-label={t('chat.send')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );

  // ── Mobile: open in the canonical bottom-sheet (swipe-to-dismiss, 86dvh,
  //    scroll-lock). The FAB stays mounted so Radix can play the sheet's
  //    enter/exit animation cleanly. ──
  if (isMobile) {
    return (
      <>
        {!open && closedFab}
        <Sheet
          open={open}
          onOpenChange={setOpen}
          titleText={t('chat.group_title')}
          className="sheet--chat"
          bodyClassName="sheet-b--chat"
        >
          {headInner}
          {isThinking && <div className="chat-thinking-bar" />}
          {messagesInner}
          {composerInner}
        </Sheet>
      </>
    );
  }

  // ── Closed (desktop): floating button ──
  if (!open) return closedFab;

  // ── Open (desktop): docked panel ──
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
