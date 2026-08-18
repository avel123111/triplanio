import React, { useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, Card, Chip, Tile } from '../../design/index';
import CountryFlag from '@/components/common/CountryFlag';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import { useT } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_NAME } from '@/lib/triplanio';

// =====================================================================
// AI ENTRY PANEL — the CONVERSATION (transcript only). The composer is pinned by
// ManualPlanner as a separate <ChatComposer> bar below this scroller (like the trip
// chat), and the "Triplanio печатает" state lives on that composer. Every message —
// bot AND user — is rendered by ONE shell (ChatMsg), reusing the trip chat's avatar
// + name + card so the two chats can't drift.
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

// One message — avatar + name + card. The SAME shell (from ChatReply) serves the bot
// and the user; only the avatar/name and the card tone differ (`ai` = the assistant-
// tinted card, neutral = a plain surface card for the user's own message).
function ChatMsg({ avatar, name, tone, children }) {
  return (
    <div className="col col--g4 chat-reply">
      <div className="row row--g6">
        <div className="chat-run__av">{avatar}</div>
        <div className="col col--g4 grow--fit">
          <div className="row row--g4 chat-reply__who"><b>{name}</b></div>
          <Card radius="md" className={tone === 'ai' ? 'chat-reply__card' : undefined}>{children}</Card>
        </div>
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

  // Quick-start chips only on the opening turn (nothing sent yet) — tapping one sends
  // it straight to the bot.
  const showChips = aiMessages.length <= 1;

  return (
    <div className="col col--g6">
      {aiMessages.map((m) => {
        if (m.role === 'user') {
          return (
            <ChatMsg key={m.id} avatar={<Avatar name={userName} photo={userPhoto} seed={userSeed} />} name={userName}>
              <span className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</span>
            </ChatMsg>
          );
        }
        let body;
        if (m.kind === 'welcome') body = <span className="t-body" style={{ whiteSpace: 'pre-wrap' }}>{t('ai_plan.status_waiting')}</span>;
        else if (m.kind === 'error') body = <span className="t-body">{t('ai_plan.error_plan_title')}</span>;
        else body = (
          <>
            {m.text ? <div className="chat-reply__text"><ChatMarkdown text={m.text} linkClassName="cm-a cm-a--brand" /></div> : null}
            <DraftItinerary draft={m.draft} />
          </>
        );
        return <ChatMsg key={m.id} avatar={<Avatar kind="ai" />} name={TRIPLANIO_BOT_NAME} tone="ai">{body}</ChatMsg>;
      })}

      {showChips && (
        <div className="row row--wrap row--g4">
          {[t('ai_plan.chip_italy'), t('ai_plan.chip_japan'), t('ai_plan.chip_balkans')].map((p) => (
            <Chip key={p} onClick={() => onGenerate(p)}>{p}</Chip>
          ))}
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
