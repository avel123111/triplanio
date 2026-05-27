/**
 * ChatLens — group chat tab inside TripView.
 *
 * Real-time via Supabase Realtime on trip_messages table.
 * Supports @mention dropdown, message send/receive.
 *
 * Props:
 *   tripId  — string
 *   members — array of trip member rows (for @mention list)
 *   myRole  — string
 */
import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Card } from '../design/index';

// ─── Query key ────────────────────────────────────────────────────────────────

const MSGS_KEY = (tripId) => ['trip-messages', tripId];

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
  // Parse @mentions and **bold** from text
  const html = text
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/@(\S+)/g, '<span style="color:var(--brand);font-weight:500">@$1</span>');

  return (
    <div style={{ display: 'flex', gap: 10, marginTop: grouped ? 2 : 0 }}>
      <div style={{ width: 30, flexShrink: 0 }}>
        {!grouped && <Avatar name={who} kind={isAi ? 'ai' : undefined} />}
      </div>
      <div style={{ flex: 1 }}>
        {!grouped && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 3 }}>
            <span style={{ fontWeight: 600, fontSize: 13, color: isAi ? 'var(--ai)' : 'var(--ink)' }}>{who}</span>
            <span className="muted" style={{ fontSize: 11 }}>{time}</span>
          </div>
        )}
        <div style={{
          display: 'inline-block', padding: '8px 12px',
          background: isMe ? 'var(--brand-soft)' : isAi ? 'var(--ai-soft)' : 'var(--wash)',
          color: 'var(--ink)', fontSize: 13.5, borderRadius: 10, maxWidth: '78%', lineHeight: 1.45,
        }} dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

// ─── ChatMember ───────────────────────────────────────────────────────────────

function ChatMember({ name, role, online, ai }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <Avatar name={name} kind={ai ? 'ai' : undefined} size="sm" />
        {online && (
          <span style={{ position: 'absolute', bottom: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', border: '2px solid var(--surface)' }} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div className="muted" style={{ fontSize: 11 }}>{role}</div>
      </div>
    </div>
  );
}

// ─── Helper: format time ──────────────────────────────────────────────────────

function fmtMsgTime(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

function fmtMsgDate(isoStr) {
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'long' });
  } catch { return ''; }
}

function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  return da.toDateString() === db.toDateString();
}

// ─── ChatLens (main export) ───────────────────────────────────────────────────

export default function ChatLens({ tripId, members = [], myRole }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const scrollRef  = useRef(null);
  const channelRef = useRef(null);

  const [text,        setText]        = useState('');
  const [sending,     setSending]     = useState(false);
  const [showMention, setShowMention] = useState(false);

  const myName = user?.user_metadata?.full_name || user?.email || 'Я';

  // ── Load initial messages ──
  const { data: msgs = [], isLoading } = useQuery({
    queryKey: MSGS_KEY(tripId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trip_messages')
        .select('*')
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!tripId,
  });

  // ── Realtime subscription ──
  useEffect(() => {
    if (!tripId) return;

    const channel = supabase
      .channel('chat-' + tripId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trip_messages', filter: `trip_id=eq.${tripId}` },
        payload => {
          qc.setQueryData(MSGS_KEY(tripId), (old = []) => {
            // Avoid duplicates (optimistic message already there)
            if (old.find(m => m.id === payload.new.id)) return old;
            return [...old, payload.new];
          });
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [tripId, qc]);

  // ── Auto-scroll ──
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [msgs]);

  // ── Send message ──
  async function sendMessage() {
    const content = text.trim();
    if (!content || sending) return;
    setText('');
    setShowMention(false);
    setSending(true);

    // Optimistic insert
    const optimistic = {
      id:         'opt-' + Date.now(),
      trip_id:    tripId,
      user_name:  myName,
      user_email: user?.email,
      user_id:    user?.id,
      content,
      created_at: new Date().toISOString(),
    };
    qc.setQueryData(MSGS_KEY(tripId), (old = []) => [...old, optimistic]);

    const { error } = await supabase.from('trip_messages').insert({
      trip_id:    tripId,
      user_name:  myName,
      user_email: user?.email,
      user_id:    user?.id,
      content,
    });

    setSending(false);
    if (error) {
      console.error('Chat send error:', error);
      // Remove optimistic on error
      qc.setQueryData(MSGS_KEY(tripId), (old = []) => old.filter(m => m.id !== optimistic.id));
    }
    // Realtime subscription handles adding the real message — no invalidateQueries needed.
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  function handleTextChange(e) {
    const v = e.target.value;
    setText(v);
    const last = v.slice(-1);
    if (last === '@') setShowMention(true);
    else if (last === ' ' || v === '') setShowMention(false);
  }

  // Build mention list from members + AI
  const mentionList = [
    { name: 'ИИ-помощник', desc: '@assistant — отвечает всем', ai: true, handle: 'assistant' },
    ...members
      .filter(m => m.status === 'active')
      .map(m => ({
        name:   m.user_full_name || m.user_email || '—',
        desc:   m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Админ' : 'Зритель',
        handle: (m.user_full_name || m.user_email || 'user').split(/[\s@]/)[0],
      })),
  ];

  // Render messages with date dividers
  const messageRows = [];
  let prevDate = null;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const prev = i > 0 ? msgs[i - 1] : null;
    const dateStr = fmtMsgDate(m.created_at);

    if (!isSameDay(m.created_at, prev?.created_at)) {
      messageRows.push(<DateDivider key={'div-' + m.id} date={dateStr} />);
    }

    const isMe     = m.user_email === user?.email || m.user_id === user?.id;
    const grouped  = prev && isSameDay(m.created_at, prev.created_at) && prev.user_id === m.user_id;

    messageRows.push(
      <Msg
        key={m.id}
        who={m.user_name || m.user_email || '—'}
        isMe={isMe}
        isAi={m.is_ai || false}
        text={m.content || ''}
        time={fmtMsgTime(m.created_at)}
        grouped={grouped}
      />
    );
  }

  // Build active members list; if empty (owner has no trip_members row), show current user as owner
  const activeMembers = (() => {
    const list = members.filter(m => m.status === 'active');
    if (list.length === 0 && user) {
      return [{
        id: 'self',
        user_full_name: user.user_metadata?.full_name || null,
        user_email: user.email,
        role: myRole || 'owner',
        status: 'active',
      }];
    }
    return list;
  })();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, height: 'calc(100vh - 300px)', minHeight: 500 }}>
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
              {activeMembers.length} участников
            </div>
          )}
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="scrollbar-thin" style={{ flex: 1, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
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

        {/* Input */}
        <div style={{ borderTop: '1px solid var(--line-2)', padding: 12, position: 'relative' }}>
          {/* @mention dropdown */}
          {showMention && (
            <div style={{
              position: 'absolute', bottom: 'calc(100% + 4px)', left: 12,
              background: 'var(--surface)', border: '1px solid var(--line)',
              borderRadius: 12, boxShadow: 'var(--shadow-pop)', padding: 6,
              width: 280, zIndex: 5,
            }}>
              <div className="eyebrow" style={{ padding: '6px 10px 8px' }}>Упомянуть</div>
              {mentionList.map((m, i) => (
                <button key={i}
                  onClick={() => {
                    setText(t => t.replace(/@$/, '@' + m.handle + ' '));
                    setShowMention(false);
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', width: '100%', border: 'none', background: 'transparent', borderRadius: 7, cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <Avatar name={m.name} kind={m.ai ? 'ai' : undefined} size="sm" />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: m.ai ? 'var(--ai)' : 'var(--ink)' }}>{m.name}</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>{m.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              className="textarea"
              placeholder="Напиши сообщение — @ открывает упоминание"
              value={text}
              onChange={handleTextChange}
              onKeyDown={handleKey}
              style={{ minHeight: 38, maxHeight: 120, flex: 1, padding: '8px 12px' }}
            />
            <Btn variant="primary" icon="send" onClick={sendMessage} disabled={sending || !text.trim()}>
              Отправить
            </Btn>
          </div>
        </div>
      </div>

      {/* Right sidebar */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Card title="Участники чата">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeMembers.length === 0 ? (
              <div className="muted" style={{ fontSize: 12.5 }}>Нет участников</div>
            ) : (
              activeMembers.map(m => (
                <ChatMember
                  key={m.id}
                  name={m.user_full_name || m.user_email || '—'}
                  role={m.role === 'owner' ? 'Владелец' : m.role === 'admin' ? 'Админ' : 'Зритель'}
                  online
                />
              ))
            )}
            <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 8, marginTop: 4 }}>
              <ChatMember name="ИИ-помощник" role="@assistant — общий" ai />
            </div>
          </div>
        </Card>

        <Card variant="soft" title="Что умеет @assistant">
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontSize: 12.5, color: 'var(--muted)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>Отвечает всем участникам</li>
            <li>Предлагает отели, перелёты, активности</li>
            <li>Может править трип — с согласия владельца</li>
            <li>Личный диалог — <a href="#" onClick={e => { e.preventDefault(); window.__navigate?.('ai'); }}>ИИ-помощник</a></li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}
