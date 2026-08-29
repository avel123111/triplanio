/**
 * ChatLens - the group chat lens of TripView, rendered as a full-bleed room:
 * header / scrolling stream / pinned composer. The stream and the composer are
 * the shared ChatStream + ChatComposer, so the floating widget stays identical.
 *
 * Real-time via Supabase Realtime on chat_messages (filtered by chat_id).
 * Owns what the widget does not: day dividers, older-history paging and the
 * "new messages" pill. Sending (and retry) is the shared useChatSend seam.
 *
 * Props:
 *   tripId  - string
 *   members - trip member rows (member list + author resolution)
 *   myRole  - string, used only for the solo-owner fallback row
 *   ownerId - trips.created_by; the owner usually has no trip_members row
 */
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { resolveMembers } from '@/lib/resolveAuthor';
import ChatStream from '@/components/chat/ChatStream';
import ChatComposer from '@/components/chat/ChatComposer';
import { Avatar, AvatarStack, EmptyState, RoleBadge, Severity, Skeleton, Btn, Chip, Grow, Popover, PopoverTrigger, PopoverContent, Sheet } from '../design/index';
import { useIsPhone } from '@/hooks/use-mobile';
import { chatParticipants, pluralPeople, useChatId, useChatRows, useChatMessages, useChatSend, useMarkChatRead, applyChatRow, isAiThinking, fetchOlderMessages, prependChatMessages, CHAT_PAGE } from '@/lib/chat';


// ─── ChatMember ───────────────────────────────────────────────────────────────

function ChatMember({ name, role, ai, avatarUrl, isDeleted, seed }) {
  return (
    <div className="row chat-member">
      {ai
        ? <Avatar kind="ai" />
        : <Avatar name={name} photo={avatarUrl || ''} deleted={isDeleted} seed={seed} />}
      <div className="grow--fit">
        <div className="chat-member__nm trunc">{name}</div>
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
      <div className="row row--g7 chat-head">
        <div className="col col--g1 col--j-center grow--fit chat-head__id">
          <Skeleton w={150} h={15} r={5} />
          <Skeleton w={92} h={11} r={4} />
        </div>
        <Skeleton w={128} h={38} r={'var(--r-pill)'} style={{ flexShrink: 0 }} />
      </div>
      <div className="col col--g1 chat-msgs scrollbar-thin"><ChatSkeleton /></div>
      <div className="chat-composer">
        <div className="col col--g4 chat-composer__in">
          <Skeleton h={56} r={'var(--r-xl)'} />
        </div>
      </div>
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="col chat-msgs__in" aria-hidden>
      {[{ w: '58%' }, { w: '42%', me: true }, { w: '72%' }, { w: '38%', me: true }].map(({ w, me }, i) => (
        <div key={i} className={'row row--a-start row--g6 chat-run' + (me ? ' chat-run--me' : '')}>
          {!me && <Skeleton w={32} h={32} r={'var(--r-pill)'} style={{ flexShrink: 0 }} />}
          <Skeleton w={w} h={me ? 40 : 56} r={'var(--r-md)'} />
        </div>
      ))}
    </div>
  );
}

// ─── ChatLens (main export) ───────────────────────────────────────────────────

export default function ChatLens({ tripId, members = [], myRole, ownerId, profiles = {} }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const scrollRef   = useRef(null);
  const composerRef = useRef(null);

  const isPhone = useIsPhone();

  const [membersOpen, setMembersOpen] = useState(false);
  const [newCount,    setNewCount]    = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyDone,  setHistoryDone]  = useState(false);

  // ── Resolve chatId for this trip ── (shared hook; same ['chat-id', tripId] cache)
  const { data: chatId } = useChatId(tripId);

  // ── Send ── one shared seam with the widget; the client passes text only.
  const { send, retry, sending } = useChatSend(chatId, tripId);

  // ── Participant display names ── from the ONE profile bundle shipped with the
  // trip content (getTripDetails, owner included), handed down by TripView. No
  // separate profile-fetch hop; authors who left resolve from their snapshot.

  // ── Load messages ── shared cache with the chat widget.
  const { data: msgs = [], isLoading, error: msgsError, refetch: refetchMsgs } = useChatMessages(chatId);

  // Resolving chat_id is the FIRST request, and while it runs the messages query
  // is still disabled — so `isLoading` is false and the stream would flash the
  // "no messages yet" empty state before the skeleton. Treat "no chat_id yet" as
  // loading so the very first paint is already the skeleton.
  const streamLoading = !chatId || isLoading;

  // ── Realtime ── rides the shared per-chat_id channel (TRIP-208 Ф2-2b): merge
  // the row into the lens cache. One channel per chat_id is now shared with the
  // sidebar badge + widget instead of each opening its own. UPDATEs come through
  // the same seam, which is how the assistant's state reaches every participant.
  useChatRows(chatId, (msg) => applyChatRow(qc, chatId, msg));

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

  // ── Mark read while viewing (and after each new message) ── shared seam with
  // the widget: the room is always the active surface, so `active` is constant.
  useMarkChatRead(chatId, tripId, { tailId: msgs[msgs.length - 1]?.id });

  // ── Thinking state ── read from the server: an open assistant run on any row.
  // It used to be guessed from the tail of the local cache ("the last message
  // mentions @Triplanio"), so it never survived a reload, differed between
  // participants, was silenced by the next message, and had no way to end when
  // no answer ever came — the reason it could hang for months (TRIP-296).
  const isThinking = isAiThinking(msgs);

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

  // "Ask again" under an assistant answer: seed the composer with the mention so
  // the follow-up question is one keystroke away.
  const askMore = useCallback(() => composerRef.current?.insertMention(), []);

  // Chat participants = owner + active admins/viewers (excl. offline/pending).
  // A solo trip can resolve to an empty list (no members rows, owner not loaded
  // yet) — fall back to the viewer so the header never reads "0 people".
  const participants = chatParticipants(members, ownerId);
  const activeMembers = (participants.length === 0 && user)
    ? [{ id: 'self', user_full_name: user.full_name || '', user_id: user.id, role: myRole || 'owner', status: 'active' }]
    : participants;

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
          seed={p.seed}
          role={<RoleBadge role={p.role} />}
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
    <Chip avatars onClick={onClick} aria-label={t('chat.members_title')}>
      <AvatarStack people={people} />
      <span className="chat-members-btn__lbl t-label">{t('trip.sidebar_members')}</span>
    </Chip>
  );

  return (
    <div className="chat-room ov-anim">
      {/* Tier 1 · room header */}
      <div className="row row--g7 chat-head">
        <div className="col col--g1 col--j-center grow--fit chat-head__id">
          <h3>{t('chat.group_title')}</h3>
          {activeMembers.length > 0 && (
            <div className="chat-head__sub trunc">{pluralPeople(activeMembers.length, t, lang)}</div>
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
      <div ref={scrollRef} className="col col--g1 chat-msgs scrollbar-thin" onScroll={onStreamScroll}>
        {streamLoading ? (
          <ChatSkeleton />
        ) : (msgsError && msgs.length === 0) ? (
          /* TRIP-208: a failed load shows retry, not a false "no messages yet". */
          <div style={{ margin: 'auto', maxWidth: 420, padding: 16 }}>
            <Severity
              level="error"
              title={t('sys.load_error_title')}
              action={<Btn variant="secondary" onClick={() => refetchMsgs()}>{t('sys.retry')}</Btn>}
            >
              {t('sys.load_error_desc')}
            </Severity>
          </div>
        ) : msgs.length === 0 ? (
          <div style={{ margin: 'auto' }}>
            <EmptyState icon="chat" title={t('chat.empty_title')} body={t('chat.empty_desc')} />
          </div>
        ) : (
          <div className="col chat-msgs__in">
            {!historyDone && msgs.length >= CHAT_PAGE && (
              <div className="row row--j-center chat-hist">
                <Btn variant="secondary" icon="chevU" loading={loadingOlder} onClick={loadOlder}>
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
              onRetry={retry}
              onAsk={askMore}
            />
          </div>
        )}
      </div>

      {/* Tier 3 · composer — same column and gutters as the stream */}
      <ChatComposer
        ref={composerRef}
        onSend={send}
        disabled={sending || !chatId}
        /* On a phone the field is barely wider than the hint, so the long form
           would only ever be read as its first half. The short one fits whole;
           the "@" button next to it carries the part about mentions. */
        placeholder={isPhone ? t('chat.composer_ph_short') : t('chat.composer_ph')}
        isThinking={isThinking}
        withHint
        jump={newCount > 0 ? (
          <>
            <Grow />
            <Chip onClick={jumpToBottom} count={newCount} iconRight="arrowD">
              {t("chat.new_messages")}
            </Chip>
          </>
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
