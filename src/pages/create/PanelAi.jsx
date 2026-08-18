import React, { useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, Card, Chip, Tile } from '../../design/index';
import CountryFlag from '@/components/common/CountryFlag';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import { useT } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_NAME } from '@/lib/triplanio';

// =====================================================================
// AI ENTRY PANEL — the CONVERSATION (transcript only). The composer is pinned by
// ManualPlanner as a separate <ChatComposer> bar below this scroller. Sides mirror
// the trip chat (Pavel): the BOT is left (avatar + tinted card), the USER is right
// (avatar + own bubble). Vertical rhythm comes from the chat's own per-message
// margins (.chat-reply / .chat-run), NOT a wrapping gap — a wrapping gap stacked on
// top of them read as double spacing.
//   ctx: { aiMessages, onGenerate(promptText), userName, userPhoto, userSeed }
// =====================================================================

// The itinerary the bot proposed on a turn — a light list (start → cities), reusing
// the editor's name/number primitives + CountryFlag; no new classes.
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

// Assistant turn — LEFT: avatar + name + tinted card. Same shell/skin as the trip
// chat's ChatReply.
function BotMessage({ children }) {
  return (
    <div className="chat-reply">
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

// User turn — RIGHT: the outgoing bubble (chat-run--me / chat-bubble--me), with the
// user's avatar + name (row-reverse puts the avatar on the right).
function UserMessage({ text, name, photo, seed }) {
  return (
    // The row IS the .chat-run (its margin-top spaces messages, and .chat-run--me
    // justify-ends it); row-reverse puts the avatar on the right.
    <div className="row row--g6 chat-run chat-run--me" style={{ flexDirection: 'row-reverse' }}>
      <div className="chat-run__av"><Avatar name={name} photo={photo} seed={seed} /></div>
      <div className="col col--g4 col--a-end grow--fit">
        <div className="row row--g4 chat-reply__who"><b>{name}</b></div>
        <div className="chat-bubble chat-bubble--me"><span style={{ whiteSpace: 'pre-wrap' }}>{text}</span></div>
      </div>
    </div>
  );
}

export default function PanelAi({ ctx }) {
  const t = useT();
  const { aiMessages = [], onGenerate, userName, userPhoto, userSeed } = ctx;

  // Auto-scroll the transcript to the newest message (the panel body is the scroller).
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [aiMessages.length]);

  // Quick-start chips only on the opening turn (nothing sent yet). They live INSIDE
  // the welcome message so they align with the bot's text and inherit its font;
  // tapping one sends it straight to the bot.
  const showChips = aiMessages.length <= 1;
  const chips = showChips ? (
    <div className="row row--wrap row--g4" style={{ marginTop: 10 }}>
      {[t('ai_plan.chip_italy'), t('ai_plan.chip_japan'), t('ai_plan.chip_balkans')].map((p) => (
        <Chip key={p} onClick={() => onGenerate(p)}>{p}</Chip>
      ))}
    </div>
  ) : null;

  return (
    <div>
      {aiMessages.map((m) => {
        if (m.role === 'user') return <UserMessage key={m.id} text={m.text} name={userName} photo={userPhoto} seed={userSeed} />;
        if (m.kind === 'welcome') {
          return (
            <BotMessage key={m.id}>
              <span className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{t('ai_plan.status_waiting')}</span>
              {chips}
            </BotMessage>
          );
        }
        if (m.kind === 'error') return <BotMessage key={m.id}><span className="t-body">{t('ai_plan.error_plan_title')}</span></BotMessage>;
        return (
          <BotMessage key={m.id}>
            {m.text ? <div className="chat-reply__text"><ChatMarkdown text={m.text} linkClassName="cm-a cm-a--brand" /></div> : null}
            <DraftItinerary draft={m.draft} />
          </BotMessage>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
