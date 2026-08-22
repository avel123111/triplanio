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
// (own bubble only — no avatar, no name, exactly like the sender's own message in
// the trip chat). Vertical rhythm comes from the chat's own per-message margins
// (.chat-reply / .chat-run), NOT a wrapping gap — a wrapping gap stacked on top of
// them read as double spacing.
//   props: aiMessages[], onGenerate(promptText) — direct props, like its sibling
//   flow panels (FlowMap / FlowProgress / StepHome), not a ctx bag.
// =====================================================================

// Anchor row (start / finish) — the AI-tinted node tile + city name + a meta label
// on the right. The tint travels as CSS channels on the inline style (the sanctioned
// call-site входная точка тона для `.te-row__node`); shared by start and finish so
// the inline lives ONCE, not once per anchor.
function AnchorRow({ code, name, label }) {
  return (
    <div className="row row--g4">
      <Tile as="span" round className="te-row__node" style={{ '--hl-soft': 'var(--ai-soft)', '--hl-ink': 'var(--ai-ink)' }}>
        {code ? <CountryFlag code={code} /> : <Icon name="flag" size={11} />}
      </Tile>
      <span className="te-cityname trunc grow">{name}</span>
      <span className="muted t-meta">{label}</span>
    </div>
  );
}

// The itinerary the bot proposed on a turn — a light list (start → cities → finish),
// reusing the editor's name/number primitives + CountryFlag; no new classes.
function DraftItinerary({ draft }) {
  const t = useT();
  const home = draft?.home;
  const cities = draft?.cities || [];
  const end = draft?.end;
  if (!home?.city_name && cities.length === 0 && !end?.city_name) return null;
  return (
    <div className="col col--g3 pl-ai-draft">
      {home?.city_name && <AnchorRow code={home.country_code} name={home.city_name} label={t('ai_plan.start')} />}
      {cities.map((c, i) => (
        <div key={c.id} className="row row--g4">
          <Tile as="span" round className="te-row__num">{i + 1}</Tile>
          <span className="te-cityname trunc grow">{c.city_name}{c.country ? <span className="muted t-meta"> {c.country}</span> : null}</span>
          <span className="muted num t-meta">{c.nights} {t('ai_plan.unit_nights_short')}</span>
        </div>
      ))}
      {/* Финиш-узел из ответа ИИ (kind:'end') — тот же примитив, что и старт. */}
      {end?.city_name && <AnchorRow code={end.country_code} name={end.city_name} label={t('planner.sub_finish')} />}
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

// User turn — RIGHT: the trip chat's own-message SHELL (chat-run--me /
// chat-run__col / chat-bubble--me). In the trip chat the sender's own message has
// NO avatar and NO name (`{!isMe && avatar}`, `{!isMe && name}`), so neither is
// drawn here either — just the bubble, right-aligned by `.chat-run--me`. The body
// is a plain pre-wrap span, NOT the chat's ChatMarkdown: a user's typed prompt is
// literal text, so `*`/`_`/`` ` `` must stay as typed, not turn into formatting.
function UserMessage({ text }) {
  return (
    <div className="row row--a-start row--g6 chat-run chat-run--me">
      <div className="col col--g2 chat-run__col">
        <div className="chat-bubble chat-bubble--me"><span style={{ whiteSpace: 'pre-wrap' }}>{text}</span></div>
      </div>
    </div>
  );
}

export default function PanelAi({ aiMessages = [], onGenerate }) {
  const t = useT();

  // Auto-scroll the transcript to the newest message (the panel body is the scroller).
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [aiMessages.length]);

  // Quick-start chips only on the opening turn (nothing sent yet); tapping one sends
  // it straight to the bot. They sit UNDER the welcome message, indented by an
  // avatar-width spacer so they line up with the message body (not the panel edge);
  // `.pl-ai-chips` binds their font to the Meta canon.
  const showChips = aiMessages.length <= 1;

  // `.pl-ai` — лента сообщений РАСТЁТ и занимает свободный остаток виджета;
  // композер стоит следом и оказывается прижат к низу. Раньше это держала
  // оболочка панели, удалённая вместе со старой раскладкой, — и композер повисал
  // сразу под приветствием. Правило на СВОЁМ классе шага, а не селектором в
  // чужой примитив (`.chat-composer`), — такое дотягивание запрещает пол.
  return (
    <div className="pl-ai">
      {aiMessages.map((m) => {
        if (m.role === 'user') return <UserMessage key={m.id} text={m.text} />;
        if (m.kind === 'welcome') return <BotMessage key={m.id}><span className="t-support" style={{ whiteSpace: 'pre-wrap' }}>{t('ai_plan.status_waiting')}</span></BotMessage>;
        if (m.kind === 'error') return <BotMessage key={m.id}><span className="t-support">{t('ai_plan.error_plan_title')}</span></BotMessage>;
        return (
          <BotMessage key={m.id}>
            {m.text ? <div className="chat-reply__text"><ChatMarkdown text={m.text} linkClassName="cm-a cm-a--brand" /></div> : null}
            <DraftItinerary draft={m.draft} />
          </BotMessage>
        );
      })}

      {showChips && (
        <div className="row row--g6 pl-ai-chips">
          <div className="chat-run__av" aria-hidden="true" />
          <div className="row row--wrap row--g4 grow--fit">
            {[t('ai_plan.chip_italy'), t('ai_plan.chip_japan'), t('ai_plan.chip_balkans')].map((p) => (
              <Chip key={p} onClick={() => onGenerate(p)}>{p}</Chip>
            ))}
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
