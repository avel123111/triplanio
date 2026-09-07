import React, { useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, Card, Chip, Col, Row, Tile } from '../../design/index';
import CountryFlag from '@/components/common/CountryFlag';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import { useT, useI18nFormat } from '@/lib/i18n/I18nContext';
import { TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { startOf, endOf, cityNodesOf } from '@/pages/create/routeModel';

// =====================================================================
// AI ENTRY PANEL — the CONVERSATION (transcript only). The composer is pinned by
// ManualPlanner as a separate <ChatComposer> bar below this scroller. Sides mirror
// the trip chat (Pavel): the BOT is left (avatar + tinted card), the USER is right
// (own bubble only — no avatar, no name, exactly like the sender's own message in
// the trip chat). Vertical rhythm comes from the chat's own per-message margins
// (.chat-reply / .chat-run), NOT a wrapping gap — a wrapping gap stacked on top of
// them read as double spacing.
//   props: aiMessages[], onGenerate(promptText), nodes[] — direct props, like its
//   sibling flow panels (FlowMap / FlowProgress / StepHome), not a ctx bag.
//
// ★ МАРШРУТ В ЛЕНТЕ ОДИН И ЖИВОЙ (TRIP-527). Раньше каждый ответ бота нёс
// СНИМОК маршрута, который он предложил. С переходом на операции снимок стал
// бы враньём: после «поставь 4 ночи в Лиссабоне» правдив только текущий
// `nodes`, а не то, что бот предлагал два хода назад. Поэтому в сообщении —
// текст и строки «что сделал», а маршрут рисуется ОДИН раз, под лентой, от
// тех же узлов, что видит карта и шаг 2. Второго источника правды по маршруту
// в ленте больше нет.
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

// The live itinerary (start → cities → finish) from the planner's own nodes —
// reusing the editor's name/number primitives + CountryFlag; no new classes.
function DraftItinerary({ nodes }) {
  const t = useT();
  const home = startOf(nodes);
  const cities = cityNodesOf(nodes);
  const end = endOf(nodes);
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
      {end?.city_name && <AnchorRow code={end.country_code} name={end.city_name} label={t('planner.sub_finish')} />}
    </div>
  );
}

// Причины отказа применятора → ключ строки. Две технические причины (незнакомая
// операция, битая форма) для человека одно и то же: «непонятная инструкция».
const FAIL_KEY = {
  unknown_ref: 'ai_plan.fail_unknown_ref',
  route_not_empty: 'ai_plan.fail_route_not_empty',
  past_date: 'ai_plan.fail_past_date',
  anchor: 'ai_plan.fail_anchor',
};

// Строки «что сделал» / «не смог» под текстом бота. Ключи составные
// (`ai_plan.did_<op>`), семья защищена в гарде 2x (`PROTECTED_KEYS`), потому
// что литералом в коде не встречается ни один из них.
function OpLines({ applied = [], rejected = [] }) {
  const t = useT();
  const { fmtDate } = useI18nFormat();
  if (!applied.length && !rejected.length) return null;
  const line = (a) => {
    if (a.op === 'set_route') return t('ai_plan.did_set_route', { n: a.count });
    if (a.op === 'add_city') return a.after ? t('ai_plan.did_add_city_after', { city: a.city, after: a.after }) : t('ai_plan.did_add_city', { city: a.city });
    if (a.op === 'replace_city') return t('ai_plan.did_replace_city', { from: a.from, to: a.to });
    if (a.op === 'set_nights') return t('ai_plan.did_set_nights', { city: a.city, n: a.nights });
    if (a.op === 'set_start_date') return t('ai_plan.did_set_start_date', { date: fmtDate(a.date) });
    if (a.op === 'set_title') return t('ai_plan.did_set_title', { title: a.title });
    return t(`ai_plan.did_${a.op}`, { city: a.city });
  };
  return (
    <Col gap="g2" className="pl-ai-draft">
      {applied.map((a, i) => (
        <Row as="span" gap="g4" key={`a${i}`} className="t-meta"><Icon name="check" size={12} /> {line(a)}</Row>
      ))}
      {rejected.map((r, i) => (
        <Row as="span" gap="g4" key={`r${i}`} className="t-meta muted"><Icon name="warning" size={12} /> {t(FAIL_KEY[r.reason] || 'ai_plan.fail_invalid')}</Row>
      ))}
    </Col>
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

export default function PanelAi({ aiMessages = [], onGenerate, nodes = [] }) {
  const t = useT();

  // Auto-scroll the transcript to the newest message (the panel body is the scroller).
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [aiMessages.length]);

  // Quick-start chips only on the opening turn (nothing sent yet); tapping one sends
  // it straight to the bot. They sit UNDER the welcome message, indented by an
  // avatar-width spacer so they line up with the message body (not the panel edge);
  // `.pl-ai-chips` binds their font to the Meta canon.
  const showChips = aiMessages.length <= 1;

  // Лента — просто содержимое тела виджета: скроллит его ТЕЛО, а композер стоит
  // в слоте действий шелла (снаружи скролла), поэтому расти и прижимать здесь
  // больше нечему.
  return (
    <div>
      {aiMessages.map((m) => {
        if (m.role === 'user') return <UserMessage key={m.id} text={m.text} />;
        if (m.kind === 'welcome') return <BotMessage key={m.id}><span className="t-support" style={{ whiteSpace: 'pre-wrap' }}>{t('ai_plan.status_waiting')}</span></BotMessage>;
        if (m.kind === 'error') return <BotMessage key={m.id}><span className="t-support">{t('ai_plan.error_plan_title')}</span></BotMessage>;
        return (
          <BotMessage key={m.id}>
            {m.text ? <div className="chat-reply__text"><ChatMarkdown text={m.text} linkClassName="cm-a cm-a--brand" /></div> : null}
            <OpLines applied={m.applied} rejected={m.rejected} />
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

      {/* Живой маршрут — последний в ленте, у композера: тот же список узлов,
          что на карте и на шаге 2, а не снимок из сообщения. Отступ слева тот
          же, что у чипов (пустой аватар-спейсер), чтобы стоять в колонке текста. */}
      {cityNodesOf(nodes).length > 0 && (
        <Row gap="g6" align="a-start">
          <div className="chat-run__av" aria-hidden="true" />
          <Col className="grow--fit"><DraftItinerary nodes={nodes} /></Col>
        </Row>
      )}

      <div ref={endRef} />
    </div>
  );
}
