import React, { useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, Btn, Card, Chip, Textarea, Tile } from '../../design/index';
import CountryFlag from '@/components/common/CountryFlag';
import { useT } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_NAME } from '@/lib/triplanio';

// =====================================================================
// AI ENTRY PANEL — a CONVERSATION with the assistant, not a pink comment block
// (Pavel, TRIP-337). Reuses the trip chat's visual language wholesale: the bot
// avatar (<Avatar kind="ai">), the assistant card (.chat-reply*) and the outgoing
// bubble (.chat-run--me / .chat-bubble--me) — so the two chats can't drift. The
// planner owns the transcript + the draft; n8n keeps context by sessionId, so
// follow-up messages refine the same draft.
//   ctx: { aiState, prompt, setPrompt, aiMessages, home, setHome, returnCity,
//          cities, onGenerate(promptText) }
// =====================================================================

// The itinerary the bot proposed on a turn — a light list (start → cities), not
// nested cards, so it reads as content INSIDE the reply. Reuses the editor's
// name/number primitives + CountryFlag; no new classes.
function DraftItinerary({ draft }) {
  const t = useT();
  const home = draft?.home;
  const cities = draft?.cities || [];
  if (!home?.city_name && cities.length === 0) return null;
  return (
    <div className="col col--g3 pl-ai-draft">
      {home?.city_name && (
        <div className="row row--g4">
          <Tile as="span" round className="te-row__node" style={{ '--hl-soft': 'var(--ai-soft)', '--hl-ink': 'var(--ai-ink)' }}>
            {home.country_code ? <CountryFlag code={home.country_code} /> : <Icon name="flag" size={11} />}
          </Tile>
          <span className="te-cityname trunc grow">{home.city_name}</span>
          <span className="muted t-meta">{t('ai_plan.start')}</span>
        </div>
      )}
      {cities.map((c, i) => (
        <div key={c.id} className="row row--g4">
          <Tile as="span" round className="te-row__num">{i + 1}</Tile>
          <span className="te-cityname trunc grow">{c.city_name}{c.country ? <span className="muted t-meta"> {c.country}</span> : null}</span>
          <span className="muted num t-meta">{c.nights} {t('ai_plan.unit_nights_short')}</span>
        </div>
      ))}
    </div>
  );
}

// One assistant turn — avatar + name row + a reply card. Same shell as ChatReply
// (the trip chat), only the card body differs (welcome text / reply text + draft /
// a typing indicator / an error line).
function BotMessage({ children }) {
  return (
    <div className="col col--g4 chat-reply">
      <div className="row row--g6">
        <div className="chat-run__av"><Avatar kind="ai" /></div>
        <div className="col col--g4 grow--fit">
          <div className="row row--g4 chat-reply__who"><b>{TRIPLANIO_BOT_NAME}</b></div>
          <Card radius="md" className="chat-reply__card">{children}</Card>
        </div>
      </div>
    </div>
  );
}

// Outgoing user message — the same right-aligned bubble as the trip chat.
function UserBubble({ text }) {
  return (
    <div className="row row--a-start row--g6 chat-run chat-run--me">
      <div className="col col--g2 chat-run__col">
        <div className="col col--a-start chat-msg">
          <div className="chat-bubble chat-bubble--me"><span style={{ whiteSpace: 'pre-wrap' }}>{text}</span></div>
        </div>
      </div>
    </div>
  );
}

export default function PanelAi({ ctx }) {
  const t = useT();
  const { aiState, prompt, setPrompt, aiMessages = [], onGenerate } = ctx;
  const generating = aiState === 'generating';
  const canSend = prompt.trim().length > 0 && !generating;
  const send = () => { if (canSend) onGenerate(prompt.trim()); };

  // Auto-scroll the transcript to the newest message (the panel body is the
  // scroller). Runs on every message and while the bot is typing.
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [aiMessages.length, generating]);

  // Quick-start chips only on the opening turn (nothing sent yet): they seed the
  // composer so the user can edit before sending.
  const showChips = aiMessages.length <= 1 && !generating;

  return (
    <div className="col col--g6">
      {aiMessages.map((m) => {
        if (m.role === 'user') return <UserBubble key={m.id} text={m.text} />;
        if (m.kind === 'welcome') return <BotMessage key={m.id}><span className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{t('ai_plan.status_waiting')}</span></BotMessage>;
        if (m.kind === 'error') return <BotMessage key={m.id}><span className="t-body">{t('ai_plan.error_plan_title')}</span></BotMessage>;
        return (
          <BotMessage key={m.id}>
            {m.text ? <span className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span> : null}
            <DraftItinerary draft={m.draft} />
          </BotMessage>
        );
      })}

      {generating && (
        <BotMessage>
          <span className="ai-dots"><span /><span /><span /></span>
        </BotMessage>
      )}

      {showChips && (
        <div className="row row--wrap row--g4">
          {[t('ai_plan.chip_italy'), t('ai_plan.chip_japan'), t('ai_plan.chip_balkans')].map((p) => (
            <Chip key={p} onClick={() => setPrompt(p)}>{p}</Chip>
          ))}
        </div>
      )}

      {/* Composer — always available, muted while the bot is generating. The send
          CTA sits inside the textarea (chat-composer style); Shift+Enter sends. */}
      <div className="field" style={{ marginBottom: 0 }}>
        <div style={{ position: 'relative' }}>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); send(); } }}
            disabled={generating}
            placeholder={aiMessages.length > 1 ? t('ai_plan.prompt_placeholder_refine') : t('ai_plan.prompt_placeholder_initial')}
            rows={3}
            style={{ paddingBottom: 58 }}
          />
          <div style={{ position: 'absolute', right: 14, bottom: 14 }}>
            <Btn variant="ai" icon="send" disabled={!canSend} onClick={send}>{t('chat.send')}</Btn>
          </div>
        </div>
      </div>

      <div ref={endRef} />
    </div>
  );
}
