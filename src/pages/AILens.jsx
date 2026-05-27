/**
 * AILens — personal AI assistant tab inside TripView.
 *
 * Implements the "VariantFull" layout from the design (§22 — full-screen chat).
 * Sends messages to the `triplanioAiReply` Supabase edge function.
 *
 * Props:
 *   tripId   — string
 *   trip     — trip object (for context display)
 *   myRole   — 'owner' | 'admin' | 'viewer'
 */
import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { Icon } from '../design/icons';
import { Avatar, Btn, BookingSuggestionCard } from '../design/index';

// ─── HINTS (quick prompts) ────────────────────────────────────────────────────

const HINTS = [
  'Сколько ночей мы в каждом городе?',
  'Сделай день свободнее, убери одну активность',
  'Раздели перелёт с пересадкой',
  'Найди свободные дни без активностей',
  'Удали все вечерние активности',
];

// ─── AiProposalCard ───────────────────────────────────────────────────────────

function AiProposalCard({ proposal, applied, onApply, onCancel, onTogglePick, picked }) {
  return (
    <div style={{ padding: 16, background: 'var(--surface)', border: '1.5px solid var(--ai-soft-12)', borderRadius: 14, marginTop: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon name="sparkles" size={16} style={{ color: 'var(--ai)' }} />
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>Предложение изменений</div>
        <span style={{ fontSize: 12, background: 'var(--ai-soft)', color: 'var(--ai)', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
          {proposal.changes?.length || 0} изменения
        </span>
      </div>
      {proposal.intro && (
        <div style={{ fontSize: 13, marginBottom: 14, lineHeight: 1.5 }}>{proposal.intro}</div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {(proposal.changes || []).map((c, i) => (
          <div key={i} style={{
            padding: 12, border: '1px solid var(--line)', borderRadius: 10,
            display: 'flex', gap: 10, alignItems: 'flex-start',
            background: picked[i] ? 'var(--ai-soft)' : 'var(--wash)',
            opacity: applied ? 0.6 : 1,
          }}>
            <input type="checkbox" checked={picked[i]} onChange={() => onTogglePick?.(i)} style={{ marginTop: 2 }} disabled={applied} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{c.title}</div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>{c.sub}</div>
              {c.details && <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>{c.details}</div>}
            </div>
          </div>
        ))}
      </div>
      {proposal.note && (
        <div className="muted" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.5 }}>{proposal.note}</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
        {applied ? (
          <Btn variant="ghost" icon="refresh">Откатить изменения</Btn>
        ) : (
          <>
            <Btn variant="quiet" onClick={onCancel}>Не применять</Btn>
            <Btn variant="primary" icon="check" onClick={onApply}>
              Применить {picked.filter(Boolean).length}
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Message components ───────────────────────────────────────────────────────

function UserMsg({ text }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ padding: '9px 14px', background: 'var(--brand)', color: 'white', fontSize: 13.5, borderRadius: 14, borderBottomRightRadius: 4, maxWidth: '75%', lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
}

function AiMsg({ text }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <Avatar kind="ai" />
      <div style={{ padding: '9px 14px', background: 'var(--ai-soft)', color: 'var(--ink)', fontSize: 13.5, borderRadius: 14, borderBottomLeftRadius: 4, maxWidth: '75%', lineHeight: 1.5 }}>
        {text}
      </div>
    </div>
  );
}

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <Avatar kind="ai" />
      <div style={{ padding: '10px 14px', background: 'var(--ai-soft)', borderRadius: 10, color: 'var(--ai)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <span>ИИ думает</span>
        <span className="ai-dots"><span /><span /><span /></span>
      </div>
    </div>
  );
}

// ─── Composer ─────────────────────────────────────────────────────────────────

function AiComposer({ onSend, disabled }) {
  const [val, setVal] = useState('');
  const taRef = useRef(null);

  function handleSend() {
    const text = val.trim();
    if (!text || disabled) return;
    setVal('');
    onSend(text);
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  return (
    <div style={{ borderTop: '1px solid var(--line-2)', padding: 14, background: 'var(--surface)' }}>
      <div style={{ position: 'relative' }}>
        <textarea
          ref={taRef}
          className="textarea"
          placeholder="Попроси изменить что-нибудь в трипе…"
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={handleKey}
          style={{ paddingRight: 50, minHeight: 60, fontSize: 13.5 }}
          disabled={disabled}
        />
        <Btn variant="primary" icon="send" onClick={handleSend}
          style={{ position: 'absolute', right: 6, bottom: 6 }} disabled={disabled || !val.trim()} />
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {HINTS.map((h, i) => (
          <button key={i} onClick={() => { setVal(h); taRef.current?.focus(); }} style={{
            padding: '5px 10px', fontSize: 12, borderRadius: 999,
            border: '1px solid var(--line)', background: 'var(--surface)',
            color: 'var(--muted)', cursor: 'pointer', transition: 'border-color .1s',
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--brand)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--line)'}>
            {h}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── AILens (main export) ─────────────────────────────────────────────────────

export default function AILens({ tripId, trip }) {
  const { user } = useAuth();
  const [messages,  setMessages]  = useState([]);
  const [thinking,  setThinking]  = useState(false);
  const [error,     setError]     = useState('');
  const scrollRef = useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, thinking]);

  async function sendMessage(text) {
    const userMsg = { id: Date.now(), who: 'me', text };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);
    setError('');

    try {
      const history = [...messages, userMsg].map(m => ({
        role:    m.who === 'me' ? 'user' : 'assistant',
        content: m.text || m.reply || '',
      }));

      const { data, error: fnError } = await supabase.functions.invoke('triplanioAiReply', {
        body: { tripId, messages: history },
      });

      if (fnError) throw fnError;

      const reply = data?.reply || data?.content || 'Не смог получить ответ от ИИ.';
      const changes = data?.changes || null;

      setMessages(prev => [
        ...prev,
        {
          id:      Date.now() + 1,
          who:     'ai',
          text:    reply,
          changes,
        },
      ]);
    } catch (err) {
      setError('Ошибка: ' + (err.message || String(err)));
      setMessages(prev => [
        ...prev,
        { id: Date.now() + 1, who: 'ai', text: 'Произошла ошибка. Попробуй ещё раз.' },
      ]);
    } finally {
      setThinking(false);
    }
  }

  function clearHistory() {
    if (messages.length === 0) return;
    if (window.confirm('Очистить историю диалога?')) setMessages([]);
  }

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)',
      borderRadius: 16, display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      height: 'calc(100vh - 240px)', minHeight: 600,
      maxWidth: 920, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar kind="ai" size="lg" />
        <div style={{ flex: 1 }}>
          <h2 style={{ marginBottom: 2 }}>ИИ-помощник</h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Личный диалог про этот трип · только ты его видишь
          </div>
        </div>
        <Btn variant="ghost" icon="trash" onClick={clearHistory}>Очистить историю</Btn>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="scrollbar-thin" style={{ flex: 1, overflow: 'auto', padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {messages.length === 0 && !thinking && (
          <div style={{ display: 'flex', gap: 10 }}>
            <Avatar kind="ai" />
            <div style={{ padding: '10px 14px', background: 'var(--ai-soft)', fontSize: 13.5, borderRadius: 14, borderBottomLeftRadius: 4, maxWidth: '75%', lineHeight: 1.5 }}>
              Привет! Я знаю всё про этот трип. Спроси что угодно — про маршрут, время, расходы. Или попроси изменить что-нибудь.
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.who === 'me') return <UserMsg key={m.id || i} text={m.text} />;
          if (m.who === 'ai') {
            return (
              <div key={m.id || i} style={{ display: 'flex', gap: 10 }}>
                <Avatar kind="ai" />
                <div style={{ flex: 1, maxWidth: 720 }}>
                  <AiMsg text={m.text} />
                  {m.changes && m.changes.length > 0 && (
                    <AiProposalCard
                      proposal={{ intro: m.text, changes: m.changes, note: 'Цены и времена ориентировочные.' }}
                      applied={false}
                      picked={m.changes.map(() => true)}
                      onTogglePick={() => {}}
                      onApply={() => {}}
                      onCancel={() => {}}
                    />
                  )}
                </div>
              </div>
            );
          }
          return null;
        })}

        {thinking && <ThinkingDots />}
        {error && (
          <div style={{ color: 'var(--danger)', fontSize: 12.5, textAlign: 'center', padding: '8px 0' }}>{error}</div>
        )}
      </div>

      {/* Composer */}
      <AiComposer onSend={sendMessage} disabled={thinking} />
    </div>
  );
}
