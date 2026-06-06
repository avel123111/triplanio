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
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { getActiveLocale } from '@/lib/i18n/format';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_USER_ID, TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { displayName } from '@/lib/displayName';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import TriplanioAvatar from '@/components/chat/TriplanioAvatar.jsx';
import { Avatar, Card, EmptyState } from '../design/index';
import { Icon } from '../design/icons';
import { chatParticipants, pluralPeople } from '@/lib/chat';

// ─── Query keys ───────────────────────────────────────────────────────────────

const CHAT_ID_KEY = (tripId) => ['chat-id', tripId];
const MSGS_KEY    = (chatId)  => ['chat-messages-lens', chatId];

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

// HTML-escape user input, then wrap @triplanio in a colored bold span. Used in
// the input overlay only - never inside dangerouslySetInnerHTML on user-facing
// content that's been roundtripped through the DB.
function highlightMentions(val) {
  const escaped = (val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  // Keep the mention BOLD but without a font-weight change: a heavier weight
  // widens the glyph run, so the textarea (normal weight, drives the caret)
  // and the overlay diverge and the caret drifts. -webkit-text-stroke thickens
  // the strokes WITHOUT changing advance width → looks bold, caret stays put.
  return escaped.replace(
    /@triplanio\b/gi,
    '<span style="color:var(--ai);-webkit-text-stroke:0.7px var(--ai)">$&</span>',
  );
}

// ─── DateDivider ──────────────────────────────────────────────────────────────

function DateDivider({ date }) {
  return (
    <div style={{ textAlign: 'center', margin: '12px 0', fontSize: 'var(--fs-micro)', color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
      <span style={{ background: 'var(--wash)', padding: '3px 10px', borderRadius: 999 }}>{date}</span>
    </div>
  );
}

// ─── Msg ──────────────────────────────────────────────────────────────────────

function Msg({ who, isMe, isAi, text, time, grouped, avatarUrl }) {
  const bubbleBg    = isMe ? 'var(--brand)' : isAi ? 'var(--ai-soft)' : 'var(--wash)';
  const bubbleColor = isMe ? '#fff' : 'var(--ink)';
  const nameColor   = isAi ? 'var(--ai)' : 'var(--ink)';
  const radius      = isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px';

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: isMe ? 'flex-end' : 'flex-start', marginTop: grouped ? 0 : 12 }}>
      {/* Incoming: avatar in its own left column; a spacer keeps grouped bubbles aligned. */}
      {!isMe && (
        grouped
          ? <div style={{ width: 22, flexShrink: 0 }} aria-hidden />
          : (isAi ? <TriplanioAvatar size="sm" /> : <Avatar name={who} photo={avatarUrl || ''} size="sm" style={{ flexShrink: 0 }} />)
      )}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', minWidth: 0, maxWidth: '78%' }}>
        {!grouped && !isMe && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3, paddingLeft: 2 }}>
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-meta)', color: nameColor }}>{who}</span>
            <span style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)' }}>{time}</span>
          </div>
        )}
        <div style={{
          padding: '8px 12px',
          background: bubbleBg,
          color: bubbleColor,
          fontSize: 'var(--fs-base)',
          borderRadius: radius,
          lineHeight: 1.45,
          wordBreak: 'break-word',
        }}>
          <ChatMarkdown
            text={text}
            mentionStyle={isMe ? { color: 'rgba(255,255,255,0.9)', fontWeight: 700 } : { color: 'var(--ai)', fontWeight: 700 }}
            linkClassName={isMe ? 'underline' : 'underline text-primary'}
          />
        </div>
        {isMe && !grouped && (
          <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginTop: 2, paddingRight: 2 }}>{time}</div>
        )}
      </div>
    </div>
  );
}

// ─── ChatMember ───────────────────────────────────────────────────────────────

function ChatMember({ name, role, ai, avatarUrl }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {ai
        ? <TriplanioAvatar size="sm" />
        : <Avatar name={name} photo={avatarUrl || ''} size="sm" style={{ width: 28, height: 28 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-meta)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{role}</div>
      </div>
    </div>
  );
}

// ─── ChatLens (main export) ───────────────────────────────────────────────────

export default function ChatLens({ tripId, members = [], myRole, ownerId }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const scrollRef  = useRef(null);
  const channelRef = useRef(null);
  const taRef      = useRef(null);
  const ovRef      = useRef(null);

  const [text,        setText]        = useState('');
  const [sending,     setSending]     = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [failedAiIds, setFailedAiIds] = useState(() => new Set());

  const myName = user?.user_metadata?.full_name || user?.full_name || user?.email || t('member.you_self');

  // ── Resolve chatId for this trip ──
  const { data: chatId } = useQuery({
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
    enabled: !!tripId,
    staleTime: Infinity,
  });

  // ── Resolve participant display names ──
  const profileIds = [
    ...members.map(m => m.user_id),
    ownerId,          // owner often has no trip_members row → resolve explicitly
    user?.id,
  ].filter(Boolean);
  const profiles = useUserProfiles(profileIds, tripId);
  const nameFor = (userId) => {
    let real = profiles[userId]?.full_name;
    let email = '';
    if (!real) {
      const mm = members.find(m => m.user_id === userId);
      real = mm?.user_full_name || '';
      email = mm?.invite_email || '';
    }
    if (!real && user?.id && userId === user.id) {
      real = user.full_name || '';
    }
    return displayName(email, real);
  };

  // ── Load messages ──
  const { data: msgs = [], isLoading } = useQuery({
    queryKey: MSGS_KEY(chatId),
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
    enabled: !!chatId,
  });

  // ── Realtime subscription (deduplicated) ──
  useEffect(() => {
    if (!chatId) return;
    const channel = supabase
      .channel('chat-lens-' + chatId + '-' + Math.random().toString(36).slice(2))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const msg = payload.new;
          qc.setQueryData(MSGS_KEY(chatId), (old = []) => {
            // already present
            if (old.find((m) => m.id === msg.id)) return old;
            // remove optimistic from same user
            const filtered = old.filter((m) => {
              if (!String(m.id).startsWith('opt-')) return true;
              return m.user_id !== msg.user_id;
            });
            return [...filtered, msg];
          });
        },
      )
      .subscribe();
    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [chatId, qc]);

  // ── Auto-scroll ──
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs]);

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

  // ── Send message ──
  async function sendMessage() {
    const content = text.trim();
    if (!content || sending || !chatId) return;
    setText('');
    setShowMention(false);
    setSending(true);

    const optId = 'opt-' + Date.now();
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
    qc.setQueryData(MSGS_KEY(chatId), (old = []) => [...old, optimistic]);

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

    setSending(false);

    if (error) {
      console.error('Chat send error:', error);
      qc.setQueryData(MSGS_KEY(chatId), (old = []) => old.filter((m) => m.id !== optId));
      return;
    }

    // Trigger Triplanio AI if mention anywhere in message
    if (/@triplanio\b/i.test(content)) {
      const realId = created?.id;
      supabase.functions
        .invoke('callTriplanioAi', { body: { chat_id: chatId, user_message: content } })
        .catch((err) => {
          console.error('callTriplanioAi failed', err);
          if (realId) setFailedAiIds((prev) => new Set([...prev, realId]));
        });
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleTextChange(e) {
    const v = e.target.value;
    setText(v);
    // Show the mention popup whenever the text ends with an @token
    // (`@`, `@t`, `@tri`, …) at the start or after whitespace.
    setShowMention(/(^|\s)@(\w*)$/.test(v));
  }

  // Active @token being typed (used to filter + replace on select).
  const mentionToken = (/(^|\s)@(\w*)$/.exec(text)?.[2] || '').toLowerCase();

  function applyMention(handle) {
    // Replace the trailing @token (even a partial one like "@tri") with the
    // full handle, so picking the suggestion always completes the name.
    setText((t) => t.replace(/@(\w*)$/, '@' + handle + ' '));
    setShowMention(false);
  }

  // Auto-grow the composer up to ~4 lines, then scroll. The highlight overlay
  // (position:absolute inset:0) matches the textarea box automatically; we only
  // keep its scroll offset in lockstep with the textarea.
  const COMPOSER_MAX_H = 100; // ≈ 4 lines @ 13.5px / 1.4
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

  // Mention list - Triplanio first, then participants (owner + admins + viewers)
  const mentionList = [
    { name: 'Triplanio', desc: t('chat.mention_all_hint'), ai: true, handle: 'Triplanio' },
    ...chatParticipants(members, ownerId).map((m) => {
      const resolved = nameFor(m.user_id);
      return {
        name:   resolved,
        desc:   m.role === 'owner' ? t('members.role_owner') : m.role === 'admin' ? t('trips.role_admin') : t('trips.role_viewer'),
        handle: resolved.split(/[\s@]/)[0],
        ai:     false,
      };
    }),
  ];
  const filteredMentionList = mentionToken
    ? mentionList.filter((m) =>
        m.handle.toLowerCase().startsWith(mentionToken) || m.name.toLowerCase().startsWith(mentionToken))
    : mentionList;

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
      const isMe    = m.user_id === user?.id;
      const grouped = prev && isSameDay(m.created_at, prev.created_at) && prev.user_id === m.user_id;
      rows.push(
        <Msg
          key={m.id}
          who={m.user_id === TRIPLANIO_BOT_USER_ID ? TRIPLANIO_BOT_NAME : nameFor(m.user_id)}
          isMe={isMe}
          isAi={m.user_id === TRIPLANIO_BOT_USER_ID}
          text={m.text || ''}
          time={fmtMsgTime(m.created_at)}
          grouped={grouped}
          avatarUrl={profiles[m.user_id]?.avatar_url}
        />,
      );
    }
    return rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs, profiles, user?.id]);

  // Chat participants = owner + active admins/viewers (excl. offline/pending).
  const activeMembers = (() => {
    const list = chatParticipants(members, ownerId);
    if (list.length === 0 && user) {
      return [{ id: 'self', user_full_name: user.full_name || '', user_id: user.id, role: myRole || 'owner', status: 'active' }];
    }
    return list;
  })();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, height: '100%', minHeight: 0 }}>
      {/* Chat area */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 16, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <h3 style={{ flex: 1, marginBottom: 0 }}>{t('chat.group_title')}</h3>
          {activeMembers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontSize: 'var(--fs-meta)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
              {pluralPeople(activeMembers.length, t, lang)}
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="scrollbar-thin" style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>{t('chat.loading_messages')}</div>
          ) : msgs.length === 0 ? (
            <div style={{ margin: 'auto' }}>
              <EmptyState icon="chat" title={t('chat.empty_title')} body={t('chat.empty_desc')} />
            </div>
          ) : messageRows}
        </div>

        {/* Thinking strip */}
        {isThinking && (
          <div style={{
            padding: '6px 14px',
            background: 'var(--ai-soft)',
            borderTop: '1px solid var(--line-2)',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 'var(--fs-meta)', color: 'var(--ai)',
          }}>
            {/* shimmer bar */}
            <div style={{
              position: 'absolute', left: 0, right: 0, top: 0, height: 2,
              background: 'linear-gradient(90deg, transparent 0%, var(--ai) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.4s linear infinite',
            }} />
            <TriplanioAvatar size="xs" />
            <span style={{ fontWeight: 500 }}>{t('chat.typing')}</span>
            <span className="ai-dots" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <span /><span /><span />
            </span>
          </div>
        )}

        {/* Input */}
        <div style={{ borderTop: '1px solid var(--line-2)', padding: 12, position: 'relative' }}>
          {showMention && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 4px)', left: 12,
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 12, boxShadow: 'var(--shadow-pop)', padding: 6,
              width: 280, zIndex: 5,
            }}>
              <div className="eyebrow" style={{ padding: '0 10px 2px', margin: 0 }}>{t('chat.mention')}</div>
              {/* Only @Triplanio is actionable - mentioning a member does nothing,
                  so the popup lists just the assistant. */}
              <button
                onMouseDown={(e) => { e.preventDefault(); applyMention('Triplanio'); }}
                className="dz-rowhover"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', width: '100%', border: 'none', borderRadius: 7, cursor: 'pointer', textAlign: 'left' }}
              >
                <TriplanioAvatar size="sm" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--fs-base)', fontWeight: 500, color: 'var(--ai)' }}>Triplanio</div>
                  <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{t('chat.mention_all_hint')}</div>
                </div>
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              {/* Overlay (visible) sits BEHIND a transparent-text textarea: the
                  overlay renders the full text with @Triplanio in bold purple,
                  the textarea shows only the caret - no double glyphs. */}
              <div
                ref={ovRef}
                aria-hidden="true"
                style={{
                  position: 'absolute', inset: 0,
                  padding: '11px 14px',
                  font: 'inherit', fontSize: 'var(--fs-base)', lineHeight: 1.4,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  color: 'var(--ink)',
                  pointerEvents: 'none',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
                dangerouslySetInnerHTML={{ __html: highlightMentions(text) + '​' }}
              />
              <textarea
                ref={taRef}
                className="textarea"
                placeholder={t('chat.composer_ph')}
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKey}
                rows={1}
                style={{
                  position: 'relative', zIndex: 1,
                  background: 'transparent',
                  color: 'transparent', caretColor: 'var(--ink)',
                  minHeight: 44, maxHeight: 100, width: '100%',
                  padding: '11px 14px', fontSize: 'var(--fs-base)', lineHeight: 1.4,
                  resize: 'none', overflowY: 'hidden', display: 'block',
                }}
              />
            </div>
            <button
              type="button"
              className="btn btn--primary"
              onClick={sendMessage}
              disabled={sending || !text.trim() || !chatId}
              style={{ height: 44, flexShrink: 0, padding: '0 18px' }}
            >
              <Icon name="send" size={16} /> {t('chat.send')}
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="scrollbar-thin" style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', minHeight: 0 }}>
        <Card title={t('chat.members_title')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeMembers.length === 0 ? (
              <EmptyState icon="users" title={t('member.empty')} />
            ) : (
              activeMembers.map((m) => (
                <ChatMember
                  key={m.id}
                  name={nameFor(m.user_id)}
                  avatarUrl={profiles[m.user_id]?.avatar_url}
                  role={m.role === 'owner' ? t('members.role_owner') : m.role === 'admin' ? t('trips.role_admin') : t('trips.role_viewer')}
                />
              ))
            )}
            <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8, marginTop: 4 }}>
              <ChatMember name="Triplanio" role={t('chat.ai_general')} ai />
            </div>
          </div>
        </Card>

        <Card variant="soft" title={t('chat.ai_can_title')}>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 'var(--fs-meta)', color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>{t('chat.ai_can_1')}</li>
            <li>{t('chat.ai_can_2')}</li>
            <li>{t('chat.ai_can_3')}</li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}
