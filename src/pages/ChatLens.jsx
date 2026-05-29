/**
 * ChatLens — group chat tab inside TripView.
 *
 * Real-time via Supabase Realtime on chat_messages (filtered by chat_id).
 * Supports @Triplanio AI trigger, mention dropdown, thinking state.
 *
 * Props:
 *   tripId  — string
 *   members — array of trip member rows (for @mention list)
 *   myRole  — string
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { TRIPLANIO_BOT_EMAIL, TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { displayName } from '@/lib/displayName';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import TriplanioAvatar from '@/components/chat/TriplanioAvatar.jsx';
import { Avatar, Card } from '../design/index';
import { Icon } from '../design/icons';
import { chatParticipants, pluralPeople } from '@/lib/chat';

// ─── Query keys ───────────────────────────────────────────────────────────────

const CHAT_ID_KEY = (tripId) => ['chat-id', tripId];
const MSGS_KEY    = (chatId)  => ['chat-messages-lens', chatId];

// ─── Date helpers ─────────────────────────────────────────────────────────────

function fmtMsgTime(isoStr) {
  try { return new Date(isoStr).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function fmtMsgDate(isoStr) {
  try { return new Date(isoStr).toLocaleDateString('ru', { day: 'numeric', month: 'long' }); }
  catch { return ''; }
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// HTML-escape user input, then wrap @triplanio in a colored bold span. Used in
// the input overlay only — never inside dangerouslySetInnerHTML on user-facing
// content that's been roundtripped through the DB.
function highlightMentions(val) {
  const escaped = (val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  return escaped.replace(
    /@triplanio\b/gi,
    '<b style="color:var(--ai);font-weight:700">$&</b>',
  );
}

// ─── DateDivider ──────────────────────────────────────────────────────────────

function DateDivider({ date }) {
  return (
    <div style={{ textAlign: 'center', margin: '12px 0', fontSize: 11, color: 'var(--muted-2)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
      <span style={{ background: 'var(--wash)', padding: '3px 10px', borderRadius: 999 }}>{date}</span>
    </div>
  );
}

// ─── Msg ──────────────────────────────────────────────────────────────────────

function Msg({ who, isMe, isAi, text, time, grouped }) {
  const bubbleBg    = isMe ? 'var(--brand)' : isAi ? 'var(--ai-soft)' : 'var(--wash)';
  const bubbleColor = isMe ? '#fff' : 'var(--ink)';
  const nameColor   = isAi ? 'var(--ai)' : 'var(--ink)';
  const radius      = isMe ? '14px 14px 4px 14px' : '14px 14px 14px 4px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', marginTop: grouped ? 2 : 0 }}>
      {!grouped && !isMe && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, paddingLeft: 2 }}>
          {isAi && <TriplanioAvatar size="xs" />}
          {!isAi && <Avatar name={who} size="sm" />}
          <span style={{ fontWeight: 600, fontSize: 12, color: nameColor }}>{who}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>{time}</span>
        </div>
      )}
      <div style={{
        padding: '8px 12px',
        background: bubbleBg,
        color: bubbleColor,
        fontSize: 13.5,
        borderRadius: radius,
        maxWidth: '78%',
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
        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, paddingRight: 2 }}>{time}</div>
      )}
    </div>
  );
}

// ─── ChatMember ───────────────────────────────────────────────────────────────

function ChatMember({ name, role, ai }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {ai
        ? <TriplanioAvatar size="sm" />
        : <Avatar name={name} className="w-7 h-7" style={{ width: 28, height: 28, fontSize: 11 }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div className="muted" style={{ fontSize: 11 }}>{role}</div>
      </div>
    </div>
  );
}

// ─── ChatLens (main export) ───────────────────────────────────────────────────

export default function ChatLens({ tripId, members = [], myRole, ownerEmail }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const scrollRef  = useRef(null);
  const channelRef = useRef(null);

  const [text,        setText]        = useState('');
  const [sending,     setSending]     = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [failedAiIds, setFailedAiIds] = useState(() => new Set());

  const myName = user?.user_metadata?.full_name || user?.full_name || user?.email || 'Я';

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
  const profileEmails = [
    ...members.map(m => m.user_email),
    user?.email,
  ].filter(Boolean);
  const profiles = useUserProfiles(profileEmails, tripId);
  const nameFor = (email) => {
    const lower = (email || '').toLowerCase();
    let real = profiles[lower]?.full_name;
    if (!real) {
      const mm = members.find(m => m.user_email?.toLowerCase() === lower);
      real = mm?.user_full_name || '';
    }
    if (!real && user?.email && lower === user.email.toLowerCase()) {
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
      .channel('chat-lens-' + chatId)
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
              return m.user_id !== msg.user_id && m.user_email !== msg.user_email;
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
      { chat_id: chatId, user_id: user.id, trip_id: tripId, user_email: user.email, last_read_at: new Date().toISOString() },
      { onConflict: 'chat_id,user_id' },
    ).then(() => qc.invalidateQueries({ queryKey: ['chat-unread', tripId] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, user?.id, msgs.length]);

  // ── Thinking state ──
  const isThinking = useMemo(() => {
    if (!msgs.length) return false;
    const last = msgs[msgs.length - 1];
    if (!last) return false;
    if (last.user_email === TRIPLANIO_BOT_EMAIL) return false;
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
      user_email:     user?.email,
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
        user_email:     user?.email,
        text:           content,
        created_by:     user?.email,
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

  // Mention list — Triplanio first, then participants (owner + admins + viewers)
  const mentionList = [
    { name: 'Triplanio', desc: '@Triplanio — отвечает всем', ai: true, handle: 'Triplanio' },
    ...chatParticipants(members, ownerEmail).map((m) => {
      const resolved = nameFor(m.user_email);
      return {
        name:   resolved,
        desc:   m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Админ' : 'Зритель',
        handle: resolved.split(/[\s@]/)[0],
        ai:     false,
      };
    }),
  ];
  const filteredMentionList = mentionToken
    ? mentionList.filter((m) =>
        m.handle.toLowerCase().startsWith(mentionToken) || m.name.toLowerCase().startsWith(mentionToken))
    : mentionList;

  // Build message rows with date dividers
  const messageRows = [];
  for (let i = 0; i < msgs.length; i++) {
    const m    = msgs[i];
    const prev = i > 0 ? msgs[i - 1] : null;
    if (!isSameDay(m.created_at, prev?.created_at)) {
      messageRows.push(<DateDivider key={'div-' + m.id} date={fmtMsgDate(m.created_at)} />);
    }
    const isMe    = m.user_id === user?.id || m.user_email === user?.email;
    const grouped = prev && isSameDay(m.created_at, prev.created_at) && prev.user_email === m.user_email;
    messageRows.push(
      <Msg
        key={m.id}
        who={m.user_email === TRIPLANIO_BOT_EMAIL ? TRIPLANIO_BOT_NAME : nameFor(m.user_email)}
        isMe={isMe}
        isAi={m.user_email === TRIPLANIO_BOT_EMAIL}
        text={m.text || ''}
        time={fmtMsgTime(m.created_at)}
        grouped={grouped}
      />,
    );
  }

  // Chat participants = owner + active admins/viewers (excl. offline/pending).
  const activeMembers = (() => {
    const list = chatParticipants(members, ownerEmail);
    if (list.length === 0 && user) {
      return [{ id: 'self', user_full_name: user.full_name || '', user_email: user.email, role: myRole || 'owner', status: 'active' }];
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
          <h3 style={{ flex: 1, marginBottom: 0 }}>Групповой чат</h3>
          {activeMembers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--success)', fontSize: 12 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' }} />
              {pluralPeople(activeMembers.length)}
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="scrollbar-thin" style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {isLoading ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>Загружаем сообщения…</div>
          ) : msgs.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)', padding: 32 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>💬</div>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>Чат пуст</div>
              <div style={{ fontSize: 12.5 }}>Будь первым — напиши что-нибудь</div>
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
            fontSize: 12, color: 'var(--ai)',
          }}>
            {/* shimmer bar */}
            <div style={{
              position: 'absolute', left: 0, right: 0, top: 0, height: 2,
              background: 'linear-gradient(90deg, transparent 0%, var(--ai) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.4s linear infinite',
            }} />
            <TriplanioAvatar size="xs" />
            <span style={{ fontWeight: 500 }}>Triplanio печатает</span>
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
              <div className="eyebrow" style={{ padding: '6px 10px 8px' }}>Упомянуть</div>
              {filteredMentionList.map((m, i) => (
                <button
                  key={i}
                  onMouseDown={(e) => { e.preventDefault(); applyMention(m.handle); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', width: '100%', border: 'none', background: 'transparent', borderRadius: 7, cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--wash)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {m.ai ? <TriplanioAvatar size="sm" /> : <Avatar name={m.name} size="sm" />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: m.ai ? 'var(--ai)' : 'var(--ink)' }}>{m.name}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{m.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              {/* Overlay (visible) sits BEHIND a transparent-text textarea: the
                  overlay renders the full text with @Triplanio in bold purple,
                  the textarea shows only the caret — no double glyphs. */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute', inset: 0,
                  padding: '11px 14px',
                  font: 'inherit', fontSize: 13.5, lineHeight: 1.4,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  color: 'var(--ink)',
                  pointerEvents: 'none',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
                dangerouslySetInnerHTML={{ __html: highlightMentions(text) + '​' }}
              />
              <textarea
                className="textarea"
                placeholder="Напиши сообщение — @ открывает упоминание"
                value={text}
                onChange={handleTextChange}
                onKeyDown={handleKey}
                style={{
                  position: 'relative', zIndex: 1,
                  background: 'transparent',
                  color: 'transparent', caretColor: 'var(--ink)',
                  height: 44, minHeight: 44, maxHeight: 120, width: '100%',
                  padding: '11px 14px', fontSize: 13.5, lineHeight: 1.4,
                  resize: 'none',
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
              <Icon name="send" size={16} /> Отправить
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="scrollbar-thin" style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', minHeight: 0 }}>
        <Card title="Участники чата">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeMembers.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>Нет участников</div>
            ) : (
              activeMembers.map((m) => (
                <ChatMember
                  key={m.id}
                  name={nameFor(m.user_email)}
                  role={m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Админ' : 'Зритель'}
                />
              ))
            )}
            <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8, marginTop: 4 }}>
              <ChatMember name="Triplanio" role="@Triplanio — общий" ai />
            </div>
          </div>
        </Card>

        <Card variant="soft" title="Что умеет @Triplanio">
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Отвечает всем участникам</li>
            <li>Предлагает отели, перелёты, активности</li>
            <li>Может править трип — с согласия владельца</li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}
