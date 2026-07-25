/**
 * ChatLens - group chat tab inside TripView.
 *
 * Real-time via Supabase Realtime on chat_messages (filtered by chat_id).
 * Supports @Triplanio AI trigger, mention dropdown, thinking state.
 *
 * Props:
 *   tripId  - string
 *   members - array of trip member rows (for @mention list)
 *   myRole  - string
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { track } from '@/lib/analytics';
import { getActiveLocale } from '@/lib/i18n/format';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_USER_ID, TRIPLANIO_BOT_NAME, highlightMentions } from '@/lib/triplanio';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { displayName } from '@/lib/displayName';
import { resolveAuthor } from '@/lib/resolveAuthor';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import ChatReply from '@/components/chat/ChatReply';
import TriplanioAvatar from '@/components/chat/TriplanioAvatar.jsx';
import { Avatar, AvatarStack, EmptyState, Severity, Skeleton, Btn, Popover, PopoverTrigger, PopoverContent, Sheet } from '../design/index';
import { Icon } from '../design/icons';
import { useIsPhone } from '@/hooks/use-mobile';
import { chatParticipants, pluralPeople, useChatId, useChatInserts, useChatMessages, appendChatMessage, fetchOlderMessages, prependChatMessages, CHAT_MESSAGES_KEY, CHAT_PAGE } from '@/lib/chat';


// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmtMsgTime(isoStr) {
  try { return new Date(isoStr).toLocaleTimeString(getActiveLocale(), { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function fmtMsgDate(isoStr) {
  try { return new Date(isoStr).toLocaleDateString(getActiveLocale(), { day: 'numeric', month: 'long' }); }
  catch { return ''; }
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// ─── DateDivider ──────────────────────────────────────────────────────────────

function DateDivider({ date }) {
  return (
    <div className="chat-daydiv"><span>{date}</span></div>
  );
}

// ─── Msg ──────────────────────────────────────────────────────────────────────

// Human messages only — the assistant renders through ChatReply.
//
// A run of consecutive messages by one author reads as one block: the NAME row
// opens it, the avatar closes it (`lastOfRun`) so it sits next to the newest
// bubble, and the inner corners tighten.
function Msg({ who, isMe, text, time, grouped, lastOfRun, avatarUrl, isDeleted, pending, failed, onRetry, t }) {
  const bubbleMod = isMe ? 'chat-bubble--me' : 'chat-bubble--them';

  return (
    <div className={'chat-row' + (isMe ? ' chat-row--me' : '') + (grouped ? ' chat-row--grouped' : '')}>
      {!isMe && (
        <div className="chat-row__sp">
          {lastOfRun && <Avatar name={who} photo={avatarUrl || ''} deleted={isDeleted} />}
        </div>
      )}
      <div className="chat-col">
        {!grouped && !isMe && (
          <div className="chat-name">
            <b>{who}</b>
            <span className="tm">{time}</span>
          </div>
        )}
        <div className={'chat-bubble ' + bubbleMod + (pending ? ' chat-bubble--pending' : '')}>
          <ChatMarkdown
            text={text}
            mentionStyle={isMe ? { color: 'rgba(255,255,255,0.9)', fontWeight: 700 /* design-token-exempt: inline mention emphasis */ } : { color: 'var(--ai)', fontWeight: 700 /* design-token-exempt: inline mention emphasis */ }}
            linkClassName={isMe ? 'cm-a' : 'cm-a cm-a--brand'}
          />
        </div>
        {failed ? (
          <div className="chat-row__foot">
            <span className="chat-row__err">
              <Icon name="warning" size={12} />
              {t('chat.not_sent')}
            </span>
            <Btn variant="ghost" size="sm" onClick={onRetry}>{t('sys.retry')}</Btn>
          </div>
        ) : isMe && !grouped && (
          <div className="chat-time">{time}</div>
        )}
      </div>
    </div>
  );
}

// ─── ChatMember ───────────────────────────────────────────────────────────────

function ChatMember({ name, role, ai, avatarUrl, isDeleted }) {
  return (
    <div className="chat-member">
      {ai
        ? <TriplanioAvatar />
        : <Avatar name={name} photo={avatarUrl || ''} deleted={isDeleted} />}
      <div className="chat-member__b">
        <div className="chat-member__nm">{name}</div>
        <div className="chat-member__rl">{role}</div>
      </div>
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
// Mirrors the real stream (avatar + bubble, alternating sides) instead of a
// centred "Loading messages…" line, so the layout doesn't jump when rows land.
function ChatSkeleton() {
  return (
    <div className="chat-msgs__in" aria-hidden>
      {[{ w: '58%' }, { w: '42%', me: true }, { w: '72%' }, { w: '38%', me: true }].map(({ w, me }, i) => (
        <div key={i} className={'chat-row' + (me ? ' chat-row--me' : '')}>
          {!me && <Skeleton w={28} h={28} r={999} style={{ flexShrink: 0 }} />}
          <Skeleton w={w} h={me ? 40 : 56} r={16} />
        </div>
      ))}
    </div>
  );
}

// ─── ChatLens (main export) ───────────────────────────────────────────────────

export default function ChatLens({ tripId, members = [], myRole, ownerId }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const scrollRef  = useRef(null);
  const taRef      = useRef(null);
  const ovRef      = useRef(null);

  const isPhone = useIsPhone();

  const [text,        setText]        = useState('');
  const [sending,     setSending]     = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [newCount,    setNewCount]    = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyDone,  setHistoryDone]  = useState(false);
  const [failedAiIds, setFailedAiIds] = useState(() => new Set());

  const myName = displayName(user?.email, user?.user_metadata?.full_name || user?.full_name);

  // ── Resolve chatId for this trip ── (shared hook; same ['chat-id', tripId] cache)
  const { data: chatId } = useChatId(tripId);

  // ── Resolve participant display names ──
  const profileIds = [
    ...members.map(m => m.user_id),
    ownerId,          // owner often has no trip_members row → resolve explicitly
    user?.id,
  ].filter(Boolean);
  const profiles = useUserProfiles(profileIds, tripId);
  const nameFor = (userId) => {
    let real = profiles[userId]?.full_name;
    let email = profiles[userId]?.email || '';
    if (!real) {
      const mm = members.find(m => m.user_id === userId);
      real = mm?.user_full_name || '';
      email = email || mm?.invite_email || '';
    }
    if (!real && user?.id && userId === user.id) {
      real = user.full_name || '';
      email = email || user.email || '';
    }
    return displayName(email, real);
  };

  // ── Load messages ── shared cache with the chat widget.
  const { data: msgs = [], isLoading, error: msgsError, refetch: refetchMsgs } = useChatMessages(chatId);

  // Resolving chat_id is the FIRST request, and while it runs the messages query
  // is still disabled — so `isLoading` is false and the stream would flash the
  // "no messages yet" empty state before the skeleton. Treat "no chat_id yet" as
  // loading so the very first paint is already the skeleton.
  const streamLoading = !chatId || isLoading;

  // ── Realtime ── rides the shared per-chat_id channel (TRIP-208 Ф2-2b): append
  // the new message to the lens cache. One channel per chat_id is now shared with
  // the sidebar badge + widget instead of each opening its own.
  useChatInserts(chatId, (msg) => appendChatMessage(qc, chatId, msg));

  // ── Auto-scroll ──
  // Only follow the stream while the reader is AT the bottom (or sent the message
  // themselves). Scrolling on every arrival yanked the viewport away from anyone
  // reading history; now they get a "new messages" pill instead.
  const atBottomRef = useRef(true);
  const lastIdRef   = useRef(null);

  const onStreamScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottomRef.current) setNewCount(0);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setNewCount(0);
  };

  // Prepending an older page grows the stream ABOVE the viewport, which would
  // shove the reader down by exactly that height — add it back so the rows they
  // were looking at stay under the cursor.
  const keepAnchorRef = useRef(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && keepAnchorRef.current != null) {
      el.scrollTop += el.scrollHeight - keepAnchorRef.current;
      keepAnchorRef.current = null;
    }
  }, [msgs]);

  useEffect(() => {
    const el = scrollRef.current;
    const last = msgs[msgs.length - 1];
    // Keyed on the TAIL id, not on length: prepending older pages (the "load
    // more" button) must not read as "a new message arrived".
    if (!el || !last || last.id === lastIdRef.current) return;
    const isFirstPaint = lastIdRef.current === null;
    lastIdRef.current = last.id;
    if (isFirstPaint || atBottomRef.current || last.user_id === user?.id) {
      el.scrollTop = el.scrollHeight;
      setNewCount(0);
    } else {
      setNewCount((n) => n + 1);
    }
  }, [msgs, user?.id]);

  // ── Mark read while viewing (and after each new message) ──
  useEffect(() => {
    if (!chatId || !user?.id) return;
    supabase.from('chat_reads').upsert(
      { chat_id: chatId, user_id: user.id, trip_id: tripId, last_read_at: new Date().toISOString() },
      { onConflict: 'chat_id,user_id' },
    ).then(() => qc.invalidateQueries({ queryKey: ['chat-unread', tripId] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, user?.id, msgs.length]);

  // ── Thinking state ──
  const isThinking = useMemo(() => {
    if (!msgs.length) return false;
    const last = msgs[msgs.length - 1];
    if (!last) return false;
    if (last.user_id === TRIPLANIO_BOT_USER_ID) return false;
    if (failedAiIds.has(last.id)) return false;
    return /@triplanio\b/i.test(last.text || '');
  }, [msgs, failedAiIds]);

  // ── Older history ──
  // The stream opens on the newest CHAT_PAGE rows; older pages come on demand.
  async function loadOlder() {
    const oldest = msgs[0]?.created_at;
    if (!oldest || loadingOlder || !chatId) return;
    setLoadingOlder(true);
    keepAnchorRef.current = scrollRef.current?.scrollHeight ?? null;
    try {
      const older = await fetchOlderMessages(chatId, oldest);
      if (older.length < CHAT_PAGE) setHistoryDone(true);
      if (older.length) prependChatMessages(qc, chatId, older);
      else keepAnchorRef.current = null;
    } catch (err) {
      console.error('Chat history load failed:', err);
      keepAnchorRef.current = null;
    } finally {
      setLoadingOlder(false);
    }
  }

  // Flip flags on one optimistic row in place (pending ⇄ failed).
  function markRow(optId, patch) {
    qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) =>
      old.map((m) => (m.id === optId ? { ...m, ...patch } : m)));
  }

  // ── Send message ──
  // `retryOf` re-sends an existing failed row instead of creating a new one.
  async function sendMessage(retryOf) {
    const content = retryOf ? (retryOf.text || '') : text.trim();
    if (!content || (!retryOf && sending) || !chatId) return;

    const optId = retryOf ? retryOf.id : 'opt-' + Date.now();
    if (retryOf) {
      markRow(optId, { __pending: true, __failed: false });
    } else {
      setText('');
      setShowMention(false);
      setSending(true);
      const optimistic = {
        id:             optId,
        chat_id:        chatId,
        trip_id:        tripId,
        user_id:        user?.id,
        user_full_name: myName,
        text:           content,
        created_at:     new Date().toISOString(),
        __pending:      true,
      };
      qc.setQueryData(CHAT_MESSAGES_KEY(chatId), (old = []) => [...old, optimistic]);
    }

    const { data: created, error } = await supabase
      .from('chat_messages')
      .insert({
        chat_id:        chatId,
        trip_id:        tripId,
        user_id:        user?.id,
        user_full_name: myName,
        text:           content,
        created_by:     user?.id,
      })
      .select('id')
      .single();

    if (!retryOf) setSending(false);

    if (error) {
      console.error('Chat send error:', error);
      // Keep the message ON SCREEN, marked "not sent" with a retry action. It
      // used to be dropped from the cache while the composer had already been
      // cleared — the user's text was simply gone, with nothing to tell them.
      markRow(optId, { __pending: false, __failed: true });
      return;
    }

    const mentionsAi = /@triplanio\b/i.test(content);
    // Tagged @Triplanio → tripl_message_sent; plain message → chat_message_sent.
    track(mentionsAi ? 'tripl_message_sent' : 'chat_message_sent', { trip_id: tripId });

    // Trigger Triplanio AI if mention anywhere in message
    if (mentionsAi) {
      const realId = created?.id;
      invokeFn('callTriplanioAi', { body: { chat_id: chatId, user_message: content } })
        .then(({ data, error }) => {
          // TRIP-111: при отказе гейта (Pro / rate-limit) edge возвращает
          // { ok:false } и сам постит реплику бота в чат. В любом случае гасим
          // индикатор «Triplanio печатает» — иначе он висит вечно (invoke не
          // бросает на не-2xx, а на ok:false ответа-бота из n8n не будет).
          if (error || data?.ok === false) {
            if (realId) setFailedAiIds((prev) => new Set([...prev, realId]));
          }
        })
        .catch((err) => {
          console.error('callTriplanioAi failed', err);
          if (realId) setFailedAiIds((prev) => new Set([...prev, realId]));
        });
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  // "Ask again" under an assistant answer: seed the composer with the mention and
  // focus it, so the follow-up question is one keystroke away. Stable identity —
  // it is a dependency of the memoized message list.
  const askMore = useCallback(() => {
    setText((prev) => (/@triplanio\b/i.test(prev) ? prev : `@${TRIPLANIO_BOT_NAME} ${prev}`.trimEnd() + ' '));
    taRef.current?.focus();
  }, []);

  function handleTextChange(e) {
    const v = e.target.value;
    setText(v);
    // Show the mention popup whenever the text ends with an @token
    // (`@`, `@t`, `@tri`, …) at the start or after whitespace.
    setShowMention(/(^|\s)@(\w*)$/.test(v));
  }

  function applyMention(handle) {
    // Complete a trailing @token ("@", "@tri") into the full handle. When there
    // is NO trailing token — the "@" toolbar button on an empty field — insert
    // the mention instead of replacing nothing: a bare `.replace()` silently
    // no-ops there, which left the button doing literally nothing.
    setText((prev) => (/@(\w*)$/.test(prev)
      ? prev.replace(/@(\w*)$/, '@' + handle + ' ')
      : (prev && !prev.endsWith(' ') ? prev + ' ' : prev) + '@' + handle + ' '));
    setShowMention(false);
  }

  // Auto-grow the composer up to ~4 lines, then scroll. The highlight overlay
  // (position:absolute inset:0) matches the textarea box automatically; we only
  // keep its scroll offset in lockstep with the textarea.
  const COMPOSER_MAX_H = 132; // ≈ 6 lines @ 22px line-height (design)
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(ta.scrollHeight, COMPOSER_MAX_H);
    ta.style.height = next + 'px';
    ta.style.overflowY = ta.scrollHeight > COMPOSER_MAX_H ? 'auto' : 'hidden';
  }, [text]);
  useEffect(() => {
    const ta = taRef.current;
    const ov = ovRef.current;
    if (!ta || !ov) return undefined;
    const sync = () => { ov.scrollTop = ta.scrollTop; };
    ta.addEventListener('scroll', sync);
    return () => ta.removeEventListener('scroll', sync);
  }, []);

  // Build message rows with date dividers. Memoized on [msgs, profiles, user]
  // so typing in the composer (which lives in this same component) does NOT
  // rebuild every bubble on each keystroke - that was the typing lag.
  const messageRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < msgs.length; i++) {
      const m    = msgs[i];
      const prev = i > 0 ? msgs[i - 1] : null;
      if (!isSameDay(m.created_at, prev?.created_at)) {
        rows.push(<DateDivider key={'div-' + m.id} date={fmtMsgDate(m.created_at)} />);
      }
      // The assistant answers as a document, not a bubble — see ChatReply.
      if (m.user_id === TRIPLANIO_BOT_USER_ID) {
        rows.push(<ChatReply key={m.id} text={m.text || ''} time={fmtMsgTime(m.created_at)} onAsk={askMore} />);
        continue;
      }
      const next      = i < msgs.length - 1 ? msgs[i + 1] : null;
      const isMe      = m.user_id === user?.id;
      const grouped   = prev && isSameDay(m.created_at, prev.created_at) && prev.user_id === m.user_id;
      const lastOfRun = !(next && isSameDay(m.created_at, next.created_at) && next.user_id === m.user_id);
      // Author identity via the shared resolver: falls back to the message's
      // user_full_name snapshot so a member who has LEFT the trip still shows
      // their name (and a gradient-initials avatar) on past messages.
      const author = resolveAuthor({
        userId: m.user_id,
        nameSnapshot: m.user_full_name,
        profiles,
        members,
        selfUser: user,
        deletedLabel: t('common.deleted_user'),
      });
      rows.push(
        <Msg
          key={m.id}
          who={author.name}
          isMe={isMe}
          text={m.text || ''}
          time={fmtMsgTime(m.created_at)}
          grouped={grouped}
          lastOfRun={lastOfRun}
          avatarUrl={author.photo}
          isDeleted={author.deleted}
          pending={m.__pending}
          failed={m.__failed}
          onRetry={() => sendMessage(m)}
          t={t}
        />,
      );
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, profiles, members, user?.id, t, askMore]);

  // Chat participants = owner + active admins/viewers (excl. offline/pending).
  const activeMembers = (() => {
    const list = chatParticipants(members, ownerId);
    if (list.length === 0 && user) {
      return [{ id: 'self', user_full_name: user.full_name || '', user_id: user.id, role: myRole || 'owner', status: 'active' }];
    }
    return list;
  })();

  // ── Member list ── the former right rail, now behind the header button:
  // Popover on desktop, canonical Sheet on phones (same pattern as
  // TripStartControl). Built once and rendered into whichever shell is active.
  const membersList = (
    <>
      {activeMembers.length === 0 ? (
        <div className="muted t-meta" style={{ padding: '8px 10px' }}>{t('member.empty')}</div>
      ) : activeMembers.map((m) => (
        <ChatMember
          key={m.id}
          name={nameFor(m.user_id)}
          avatarUrl={profiles[m.user_id]?.avatar_url}
          isDeleted={profiles[m.user_id]?.is_deleted}
          role={m.role === 'owner' ? t('members.role_owner') : m.role === 'admin' ? t('trips.role_admin') : t('trips.role_viewer')}
        />
      ))}
      <div className="chat-member-sep">
        <ChatMember name={TRIPLANIO_BOT_NAME} role={t('chat.ai_general')} ai />
      </div>
    </>
  );

  // On phones the button opens the Sheet itself; on desktop PopoverTrigger
  // (asChild) supplies the handler, so it takes `onClick` rather than owning it.
  const renderMembersBtn = (onClick) => (
    <button type="button" className="chat-members-btn" onClick={onClick} aria-label={t('chat.members_title')}>
      <AvatarStack
        people={activeMembers.map((m) => ({
          name: nameFor(m.user_id),
          photo: profiles[m.user_id]?.avatar_url,
          deleted: profiles[m.user_id]?.is_deleted,
        }))}
      />
      <span className="chat-members-btn__lbl t-ui">{t('trip.sidebar_members')}</span>
    </button>
  );

  return (
    <div className="chat-room ov-anim">
      {/* Tier 1 · room header */}
      <div className="chat-head">
        <div className="chat-head__id">
          <h3>{t('chat.group_title')}</h3>
          {activeMembers.length > 0 && (
            <div className="chat-head__sub">{pluralPeople(activeMembers.length, t, lang)}</div>
          )}
        </div>
        {isPhone ? renderMembersBtn(() => setMembersOpen(true)) : (
          <Popover open={membersOpen} onOpenChange={setMembersOpen}>
            <PopoverTrigger asChild>{renderMembersBtn()}</PopoverTrigger>
            <PopoverContent align="end" className="chat-members-pop">{membersList}</PopoverContent>
          </Popover>
        )}
      </div>

      {/* Tier 2 · stream */}
      <div ref={scrollRef} className="chat-msgs scrollbar-thin" onScroll={onStreamScroll}>
        {streamLoading ? (
          <ChatSkeleton />
        ) : (msgsError && msgs.length === 0) ? (
          /* TRIP-208: a failed load shows retry, not a false "no messages yet". */
          <div style={{ margin: 'auto', maxWidth: 420, padding: 16 }}>
            <Severity
              level="error"
              title={t('sys.load_error_title')}
              action={<Btn variant="ghost" size="sm" onClick={() => refetchMsgs()}>{t('sys.retry')}</Btn>}
            >
              {t('sys.load_error_desc')}
            </Severity>
          </div>
        ) : msgs.length === 0 ? (
          <div style={{ margin: 'auto' }}>
            <EmptyState icon="chat" title={t('chat.empty_title')} body={t('chat.empty_desc')} />
          </div>
        ) : (
          <div className="chat-msgs__in">
            {!historyDone && msgs.length >= CHAT_PAGE && (
              <div className="chat-hist">
                <Btn variant="secondary" size="sm" icon="chevU" loading={loadingOlder} onClick={loadOlder}>
                  {t('chat.load_older')}
                </Btn>
              </div>
            )}
            {messageRows}
          </div>
        )}
      </div>

      {/* Tier 3 · composer — same column and gutters as the stream */}
      <div className="chat-composer">
        <div className="chat-composer__in">
          {(isThinking || newCount > 0) && (
            <div className="chat-overline">
              {isThinking && (
                <div className="chat-thinking">
                  <TriplanioAvatar size="sm" />
                  <span>{t('chat.typing')}</span>
                  <span className="ai-dots"><span /><span /><span /></span>
                </div>
              )}
              {newCount > 0 && (
                <button type="button" className="chat-jump" onClick={jumpToBottom}>
                  {t('chat.new_messages')} <b>{newCount}</b>
                  <Icon name="arrowD" size={13} />
                </button>
              )}
            </div>
          )}
          {showMention && (
            <div className="chat-mention">
              <div className="chat-mention__lbl">{t('chat.mention')}</div>
              {/* Only @Triplanio is actionable - mentioning a member does nothing,
                  so the popup lists just the assistant. */}
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
            {/* Calling the assistant used to be discoverable only by typing "@". */}
            <button
              type="button"
              className="chat-at"
              onClick={() => { applyMention(TRIPLANIO_BOT_NAME); taRef.current?.focus(); }}
              title={t('chat.mention_all_hint')}
              aria-label={t('chat.mention')}
            >
              <Icon name="at" size={18} />
            </button>
            <div className="chat-composer__field">
              {/* Overlay (visible) sits BEHIND a transparent-text textarea: the
                  overlay renders the full text with @Triplanio in bold purple,
                  the textarea shows only the caret - no double glyphs.
                  The row itself is the bordered surface now, so the textarea
                  carries NO .textarea class — but both layers must keep the
                  SAME font metrics and padding or the caret drifts (see
                  memory/triplanio-chat-caret-drift). */}
              <div
                ref={ovRef}
                aria-hidden="true"
                className="chat-ov"
                dangerouslySetInnerHTML={{ __html: highlightMentions(text) + '​' }}
              />
              <textarea
                ref={taRef}
                className="chat-ta"
                placeholder={t('chat.composer_ph')}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKey}
                rows={1}
                style={{ minHeight: 40, maxHeight: 132 }}
              />
            </div>
            <button
              type="button"
              className="chat-send"
              onClick={() => sendMessage()}
              disabled={sending || !text.trim() || !chatId}
              aria-label={t('chat.send')}
            >
              <Icon name="send" size={17} />
            </button>
          </div>
          {/* Keyboard shortcuts — desktop only, there is no Shift+Enter on a phone. */}
          <div className="chat-composer__hint">{t('chat.send_hint')}</div>
        </div>
      </div>

      {isPhone && (
        <Sheet open={membersOpen} onOpenChange={setMembersOpen} title={t('chat.members_title')}>
          {membersList}
        </Sheet>
      )}
    </div>
  );
}
