/**
 * ChatWidget — floating chat button + collapsible panel.
 *
 * Mounted by TripView on every lens *except* the dedicated chat lens.
 * Design matches DockedChat from the reference prototype (dock.jsx).
 */
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, X, ExternalLink, Sparkles } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { TRIPLANIO_BOT_EMAIL, TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { useChatId, useUnreadChatCount, chatParticipants, pluralPeople } from '@/lib/chat';
import TriplanioAvatar from './TriplanioAvatar';
import ChatMarkdown from './ChatMarkdown';
import { Avatar } from '@/design/index';
import { displayName } from '@/lib/displayName';
import { useUserProfiles } from '@/lib/useUserProfiles';

const MSGS_KEY = (cid) => ['chat-widget-msgs', cid];

function highlightMentions(val) {
  return (val || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
    .replace(/@triplanio\b/gi, '<b style="color:var(--ai);font-weight:700">$&</b>');
}

export default function ChatWidget({ tripId, members = [], tripTitle, ownerEmail }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [showMention, setShowMention] = useState(false);
  const [failedAiIds, setFailedAiIds] = useState(() => new Set());
  const scrollRef = useRef(null);

  const myName = user?.user_metadata?.full_name || user?.full_name || user?.email || '';
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

  // ── Realtime ──
  useEffect(() => {
    if (!chatId) return;
    const ch = supabase.channel('chat-widget-' + chatId + '-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          const msg = payload.new;
          qc.setQueryData(MSGS_KEY(chatId), (old = []) => {
            if (old.find((m) => m.id === msg.id)) return old;
            const filtered = old.filter((m) =>
              !(String(m.id).startsWith('opt-') && (m.user_id === msg.user_id || m.user_email === msg.user_email)),
            );
            return [...filtered, msg];
          });
          qc.invalidateQueries({ queryKey: ['chat-unread', tripId] });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chatId, qc, tripId]);

  // ── Auto-scroll ──
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, open]);

  // ── Mark read on open ──
  useEffect(() => {
    if (!open || !chatId || !user?.id) return;
    supabase.from('chat_reads').upsert(
      { chat_id: chatId, user_id: user.id, trip_id: tripId, user_email: user.email, last_read_at: new Date().toISOString() },
      { onConflict: 'chat_id,user_id' },
    ).then(() => qc.invalidateQueries({ queryKey: ['chat-unread', tripId] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chatId, user?.id]);

  // ── Display names ──
  const profileEmails = members.map((m) => m.user_email).filter(Boolean);
  const profiles = useUserProfiles(profileEmails, tripId);
  const nameFor = (email) => {
    const lower = (email || '').toLowerCase();
    let real = profiles[lower]?.full_name;
    if (!real) {
      const mm = members.find((m) => m.user_email?.toLowerCase() === lower);
      real = mm?.user_full_name || '';
    }
    if (!real && user?.email && lower === user.email.toLowerCase()) real = user.full_name || '';
    return displayName(email, real);
  };

  // ── Thinking state ──
  const isThinking = useMemo(() => {
    if (!msgs.length) return false;
    const last = msgs[msgs.length - 1];
    if (!last || last.user_email === TRIPLANIO_BOT_EMAIL) return false;
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
      user_id: user?.id, user_email: user?.email,
      user_full_name: myName, text: content,
      created_at: new Date().toISOString(), __pending: true,
    }]);

    const { data: created, error } = await supabase.from('chat_messages')
      .insert({
        chat_id: chatId, trip_id: tripId,
        user_id: user?.id, user_full_name: myName, user_email: user?.email,
        text: content, created_by: user?.email,
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

  const activeMembers = chatParticipants(members, ownerEmail);

  // Active @token being typed, and the helper that completes it on select.
  const mentionToken = (/(^|\s)@(\w*)$/.exec(text)?.[2] || '').toLowerCase();
  function applyMention(handle) {
    setText((t) => t.replace(/@(\w*)$/, '@' + handle + ' '));
    setShowMention(false);
  }
  const mentionMembers = mentionToken
    ? activeMembers.filter((m) => (nameFor(m.user_email) || '').toLowerCase().startsWith(mentionToken))
    : activeMembers;
  const triplanioMatches = !mentionToken || 'triplanio'.startsWith(mentionToken);

  // ── Closed: floating button ──
  if (!open) {
    return (
      <button
        className="dock"
        onClick={() => setOpen(true)}
        aria-label="Открыть чат"
        style={{ background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand) 50%, #6a3ee2 100%)' }}
      >
        <MessageCircle size={22} />
        {unread > 0 && (
          <div className="dock__count">{unread > 99 ? '99+' : unread}</div>
        )}
        {/* Sparkles sub-badge — purely decorative, signals AI is part of the chat */}
        <span style={{
          position: 'absolute', bottom: -3, right: -3,
          width: 22, height: 22, borderRadius: '50%',
          background: 'linear-gradient(135deg, #6a3ee2, #c66ce2)', color: 'white',
          border: '2px solid var(--surface)',
          display: 'grid', placeItems: 'center',
          pointerEvents: 'none',
        }}>
          <Sparkles size={11} />
        </span>
      </button>
    );
  }

  // ── Open: panel ──
  return (
    <div className="dock-panel">
      {/* Tab bar — single "group chat" tab + close */}
      <div className="dock-panel__tabs">
        <button className="dock-panel__tab active" style={{ flex: 1, justifyContent: 'flex-start' }}>
          <MessageCircle size={14} />
          Чат группы
          {unread > 0 && (
            <span style={{
              marginLeft: 4, background: 'var(--warm)', color: 'white',
              borderRadius: 999, fontSize: 10, fontWeight: 700,
              minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 4px',
            }}>{unread > 99 ? '99+' : unread}</span>
          )}
        </button>
        <button
          className="icon-btn"
          style={{ width: 32, height: 32, flexShrink: 0, marginBottom: 6 }}
          onClick={() => setOpen(false)}
          aria-label="Закрыть"
        >
          <X size={14} />
        </button>
      </div>

      {/* Head: member avatars + trip name + navigate to full chat */}
      <div className="dock-panel__head">
        <div style={{ display: 'flex' }}>
          {activeMembers.slice(0, 4).map((m, i) => (
            <Avatar
              key={m.id || i}
              name={nameFor(m.user_email)}
              size="sm"
              style={{ marginLeft: i === 0 ? 0 : -8, border: '1.5px solid var(--surface)', borderRadius: '50%', zIndex: 4 - i }}
            />
          ))}
        </div>
        <div style={{ flex: 1, fontSize: 12.5 }}>
          {tripTitle ? <><b>{tripTitle}</b>{' · '}</> : ''}{pluralPeople(activeMembers.length)}
        </div>
        <button
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          onClick={() => navigate(`/trip/${tripId}?lens=chat`)}
          aria-label="Открыть полный чат"
        >
          <ExternalLink size={14} />
        </button>
      </div>

      {/* Thinking shimmer bar */}
      {isThinking && (
        <div style={{ position: 'relative', height: 3, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent 0%, var(--ai) 50%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s linear infinite' }} />
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="scrollbar-thin" style={{ flex: 1, overflow: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {msgs.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '24px 0', fontSize: 13 }}>Напиши первым 💬</div>
        ) : msgs.map((m, i) => {
          const prev = i > 0 ? msgs[i - 1] : null;
          const isMe = m.user_id === user?.id || m.user_email === user?.email;
          const isAi = m.user_email === TRIPLANIO_BOT_EMAIL;
          const grouped = prev && prev.user_email === m.user_email &&
            new Date(m.created_at).toDateString() === new Date(prev.created_at).toDateString();
          const who = isAi ? TRIPLANIO_BOT_NAME : nameFor(m.user_email);
          const time = (() => {
            try { return new Date(m.created_at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }); }
            catch { return ''; }
          })();
          const bubbleBg = isMe ? 'var(--brand)' : isAi ? 'var(--ai-soft)' : 'var(--wash)';
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start', marginTop: grouped ? 2 : 0 }}>
              {!grouped && !isMe && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2, paddingLeft: 2 }}>
                  {isAi ? <TriplanioAvatar size="xs" /> : <Avatar name={who} style={{ width: 22, height: 22, fontSize: 10 }} />}
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: isAi ? 'var(--ai)' : 'var(--ink)' }}>{who}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>{time}</span>
                </div>
              )}
              <div style={{
                padding: '7px 11px', background: bubbleBg, color: isMe ? '#fff' : 'var(--ink)',
                fontSize: 13, borderRadius: isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                maxWidth: '82%', lineHeight: 1.45, wordBreak: 'break-word',
                opacity: m.__pending ? 0.7 : 1,
              }}>
                <ChatMarkdown
                  text={m.text || ''}
                  mentionStyle={isMe ? { color: 'rgba(255,255,255,0.9)', fontWeight: 700 } : { color: 'var(--ai)', fontWeight: 700 }}
                />
              </div>
              {isMe && !grouped && (
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1, paddingRight: 2 }}>{time}</div>
              )}
            </div>
          );
        })}
        {isThinking && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
            <TriplanioAvatar size="xs" />
            <span style={{ fontSize: 12, color: 'var(--ai)', fontWeight: 500 }}>Triplanio печатает</span>
            <span className="ai-dots"><span /><span /><span /></span>
          </div>
        )}
      </div>

      {/* Composer */}
      <div style={{ borderTop: '1px solid var(--line-2)', padding: 10, position: 'relative' }}>
        {showMention && (
          <div style={{
            position: 'absolute', bottom: 'calc(100% + 4px)', left: 10,
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 10, boxShadow: 'var(--shadow-pop)', padding: 4,
            width: 240, zIndex: 5,
          }}>
            {triplanioMatches && (
              <button
                onMouseDown={(e) => { e.preventDefault(); applyMention('Triplanio'); }}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', width: '100%', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', textAlign: 'left' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--wash)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <TriplanioAvatar size="xs" />
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ai)' }}>Triplanio</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>@Triplanio — отвечает всем</div>
                </div>
              </button>
            )}
            {mentionMembers.map((m, i) => {
              const n = nameFor(m.user_email);
              return (
                <button
                  key={i}
                  onMouseDown={(e) => { e.preventDefault(); applyMention(n.split(/[\s@]/)[0]); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', width: '100%', border: 'none', background: 'transparent', borderRadius: 6, cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--wash)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Avatar name={n} style={{ width: 22, height: 22, fontSize: 10 }} />
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{n}</div>
                </button>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <div
              aria-hidden="true"
              style={{
                position: 'absolute', inset: 0,
                padding: '8px 10px', font: 'inherit', fontSize: 13, lineHeight: 1.4,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                color: 'var(--ink)', pointerEvents: 'none',
                borderRadius: 8, overflow: 'hidden',
              }}
              dangerouslySetInnerHTML={{ __html: highlightMentions(text) + '​' }}
            />
            <textarea
              className="textarea"
              placeholder="Сообщение группе... (@упоминание)"
              value={text}
              onChange={(e) => {
                const v = e.target.value;
                setText(v);
                setShowMention(/(^|\s)@(\w*)$/.test(v));
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              style={{
                position: 'relative', zIndex: 1, background: 'transparent',
                color: 'transparent', caretColor: 'var(--ink)',
                height: 38, minHeight: 38, maxHeight: 100, width: '100%',
                padding: '8px 10px', fontSize: 13, lineHeight: 1.4, resize: 'none',
              }}
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={sending || !text.trim() || !chatId}
            aria-label="Отправить"
            style={{
              width: 34, height: 34, borderRadius: '50%', border: 'none',
              background: 'linear-gradient(135deg, #2167e2 0%, #8b3dff 100%)',
              cursor: sending || !text.trim() || !chatId ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: (!text.trim() || !chatId) ? 0.4 : 1, flexShrink: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path d="M22 2L11 13M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
