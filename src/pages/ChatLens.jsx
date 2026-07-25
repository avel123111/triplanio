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
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_USER_ID, TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { mentionsTriplanio } from '@/lib/mention';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { resolveMembers } from '@/lib/resolveAuthor';
import ChatStream from '@/components/chat/ChatStream';
import ChatComposer from '@/components/chat/ChatComposer';
import { displayName } from '@/lib/displayName';
import TriplanioAvatar from '@/components/chat/TriplanioAvatar.jsx';
import { Avatar, AvatarStack, EmptyState, Severity, Skeleton, Btn, Popover, PopoverTrigger, PopoverContent, Sheet } from '../design/index';
import { Icon } from '../design/icons';
import { useIsPhone } from '@/hooks/use-mobile';
import { chatParticipants, pluralPeople, useChatId, useChatInserts, useChatMessages, appendChatMessage, fetchOlderMessages, prependChatMessages, CHAT_MESSAGES_KEY, CHAT_PAGE } from '@/lib/chat';


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
//
// Opening the chat cold has TWO loading phases: the trip shell query (lens not
// mounted yet) and then the chat's own messages query. ChatLensSkeleton is what
// the shell renders, and it reproduces the FULL room geometry — header, stream,
// composer — so the stream skeleton sits at the exact same offset in both
// phases. Without the header row it started 60px higher and the whole screen
// dropped when the room header appeared, which read as two different skeletons
// of one screen.
export function ChatLensSkeleton() {
  return (
    <div className="chat-room">
      <div className="chat-head">
        <div className="chat-head__id">
          <Skeleton w={150} h={15} r={5} />
          <Skeleton w={92} h={11} r={4} />
        </div>
        <Skeleton w={128} h={38} r={999} style={{ flexShrink: 0 }} />
      </div>
      <div className="chat-msgs scrollbar-thin"><ChatSkeleton /></div>
      <div className="chat-composer">
        <div className="chat-composer__in">
          <Skeleton h={56} r={20} />
        </div>
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="chat-msgs__in" aria-hidden>
      {[{ w: '58%' }, { w: '42%', me: true }, { w: '72%' }, { w: '38%', me: true }].map(({ w, me }, i) => (
        <div key={i} className={'chat-row' + (me ? ' chat-row--me' : '')}>
          {!me && <Skeleton w={32} h={32} r={999} style={{ flexShrink: 0 }} />}
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
  const scrollRef   = useRef(null);
  const composerRef = useRef(null);

  const isPhone = useIsPhone();

  const [sending,     setSending]     = useState(false);
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
   
  }, [chatId, user?.id, msgs.length]);

  // ── Thinking state ──
  const isThinking = useMemo(() => {
    if (!msgs.length) return false;
    const last = msgs[msgs.length - 1];
    if (!last) return false;
    if (last.user_id === TRIPLANIO_BOT_USER_ID) return false;
    if (failedAiIds.has(last.id)) return false;
    return mentionsTriplanio(last.text);
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
  async function sendMessage(content, retryOf) {
    if (!content || (!retryOf && sending) || !chatId) return;

    const optId = retryOf ? retryOf.id : 'opt-' + Date.now();
    if (retryOf) {
      markRow(optId, { __pending: true, __failed: false });
    } else {
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

    // Settle the row from the INSERT's own result instead of waiting for the
    // realtime echo: the sender's own row may arrive late or not at all (the
    // channel can be mid-subscribe), and the message then sat dimmed as
    // "sending" until a page reload. Adopting the real id also lets the echo
    // de-dupe by id when it does land.
    markRow(optId, { id: created?.id || optId, __pending: false });

    const mentionsAi = mentionsTriplanio(content);
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

  // Stable callbacks for the memoized stream: sendMessage closes over state that
  // changes every render, so pass it through a ref instead of rebuilding every
  // bubble on each keystroke (that was the original typing lag).
  const sendRef = useRef(sendMessage);
  sendRef.current = sendMessage;
  const handleRetry = useCallback((m) => sendRef.current(m.text || '', m), []);

  // "Ask again" under an assistant answer: seed the composer with the mention so
  // the follow-up question is one keystroke away.
  const askMore = useCallback(() => composerRef.current?.insertMention(), []);

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
  const people = resolveMembers(activeMembers, { profiles, selfUser: user, deletedLabel: t('common.deleted_user') });

  const membersList = (
    <>
      {people.length === 0 ? (
        <div className="muted t-meta" style={{ padding: '8px 10px' }}>{t('member.empty')}</div>
      ) : people.map((p) => (
        <ChatMember
          key={p.id}
          name={p.name}
          avatarUrl={p.photo}
          isDeleted={p.deleted}
          role={p.role === 'owner' ? t('members.role_owner') : p.role === 'admin' ? t('trips.role_admin') : t('trips.role_viewer')}
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
      <AvatarStack people={people} />
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
            <ChatStream
              messages={msgs}
              selfUser={user}
              profiles={profiles}
              members={members}
              withDateDividers
              onRetry={handleRetry}
              onAsk={askMore}
            />
          </div>
        )}
      </div>

      {/* Tier 3 · composer — same column and gutters as the stream */}
      <ChatComposer
        ref={composerRef}
        onSend={(content) => sendMessage(content)}
        disabled={sending || !chatId}
        placeholder={t("chat.composer_ph")}
        isThinking={isThinking}
        withHint
        jump={newCount > 0 ? (
          <button type="button" className="chat-jump" onClick={jumpToBottom}>
            {t("chat.new_messages")} <b>{newCount}</b>
            <Icon name="arrowD" size={13} />
          </button>
        ) : null}
      />

      {isPhone && (
        <Sheet open={membersOpen} onOpenChange={setMembersOpen} title={t('chat.members_title')}>
          {membersList}
        </Sheet>
      )}
    </div>
  );
}
