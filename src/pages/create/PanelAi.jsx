// @ts-check
import React, { useEffect, useRef } from 'react';
import { Icon } from '../../design/icons';
import { Avatar, Badge, Card, Chip, Col, Country, Row, Tile } from '../../design/index';
import ChatMarkdown from '@/components/chat/ChatMarkdown';
import { useT, useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { pluralize } from '@/lib/i18n/format';
import { TRIPLANIO_BOT_NAME } from '@/lib/triplanio';
import { startOf, endOf, cityNodesOf, visitNumbers } from '@/pages/create/routeModel';
import { addDays, cityDateRange } from '@/lib/tripDates';

// =====================================================================
// AI ENTRY PANEL — the CONVERSATION (transcript only). The composer is pinned by
// ManualPlanner as a separate <ChatComposer> bar below this scroller. Sides mirror
// the trip chat (Pavel): the BOT is left (avatar + tinted card), the USER is right
// (own bubble only — no avatar, no name, exactly like the sender's own message in
// the trip chat). Vertical rhythm comes from the chat's own per-message margins
// (.chat-reply / .chat-run), NOT a wrapping gap — a wrapping gap stacked on top of
// them read as double spacing.
//   props: aiMessages[], onGenerate(promptText), nodes[] — direct props, like its
//   sibling flow panels (FlowProgress / StepHome), not a ctx bag.
//
// ★ МАРШРУТ В ЛЕНТЕ ОДИН И ЖИВОЙ (TRIP-527). Раньше каждый ответ бота нёс
// СНИМОК маршрута, который он предложил. С переходом на операции снимок стал
// бы враньём: после «поставь 4 ночи в Лиссабоне» правдив только текущий
// `nodes`, а не то, что бот предлагал два хода назад. Поэтому в сообщении —
// только текст бота, а маршрут рисуется ОДИН раз, под лентой, от тех же узлов,
// что видит карта и шаг 2. Строк «что сделал / не смог» под текстом нет: бот
// сам говорит, что сделал, а отказ применятора уходит в телеметрию вызывателя
// (бот про валидатор не знает, «не смог» под его «сделал» — противоречие).
// =====================================================================

// ─── Маршрут под лентой: свой ряд, не ряд шага 2 ────────────────────────────
// Слева номер (у старта/финиша — плитка с флажком в AI-тоне), затем название
// города и под ним флаг со страной; справа даты и число ночей (у якорей — дата
// и подпись «Старт»/«Финиш»). Собран из утилит и носителей, которые уже есть
// (`te-row__num`, `te-cityname`, `col--a-end`, `num`, `t-meta`; страна — тот же
// элемент `Country`, что у ряда шага 2 и якорей) — своих классов
// у ряда нет. Ритм: внутри ряда строки прижаты (`g1`), между рядами — линия и
// воздух (`.pl-ai-draft > * + *` в app.css): иначе подпись страны ряда N стояла
// ближе к названию ряда N+1, чем к своему названию.
function RouteRow({ lead, name, code, country, top, bottom }) {
  return (
    <Row gap="g4">
      {lead}
      <Col gap="g1" className="grow--fit">
        <span className="te-cityname trunc">{name}</span>
        <Country code={code} name={country} />
      </Col>
      <Col gap="g1" align="a-end">
        {top ? <span className="num t-meta">{top}</span> : null}
        {bottom ? <span className="muted num t-meta">{bottom}</span> : null}
      </Col>
    </Row>
  );
}

// Плитка якоря — тон `ai` плитки ДС (`.tile--ai`), без инлайна каналов.
const anchorLead = <Tile as="span" tone="ai" className="te-row__node"><Icon name="flag" size={11} /></Tile>;

// Живой маршрут (старт → города → финиш) от узлов планировщика — тех же, что
// видит карта и шаг 2; снимка из сообщения нет.
function DraftItinerary({ nodes }) {
  const t = useT();
  const { lang } = useI18n();
  // «12 окт.» — общая дверь формата (`formatDayMonth` за `fmtDate`), не своя копия.
  const { fmtDate } = useI18nFormat();
  const home = startOf(nodes);
  const cities = cityNodesOf(nodes);
  const cityNums = visitNumbers(nodes);
  const end = endOf(nodes);
  if (!home?.city_name && cities.length === 0 && !end?.city_name) return null;
  const first = cities[0];
  const last = cities[cities.length - 1];
  const startLabel = first?.startDate ? fmtDate(first.startDate) : null;
  const endLabel = last?.startDate ? fmtDate(addDays(last.startDate, +last.nights || 0)) : null;
  return (
    <Col gap="g3" className="pl-ai-draft">
      {home?.city_name && (
        <RouteRow lead={anchorLead} name={home.city_name} code={home.country_code} country={home.country} top={startLabel} bottom={t('ai_plan.start')} />
      )}
      {cities.map((c) => {
        const nights = +c.nights || 0;
        // Как на шаге 2: пересадка (`kind === 'waypoint'`) — пунктирная плитка
        // переезда и бейдж вместо ночей, номера не получает; город без координат
        // (ИИ назвал, справочник не нашёл) — плитка с предупреждением.
        const isWaypoint = c.kind === 'waypoint';
        const invalid = !!c.city_name && c.latitude == null;
        const lead = isWaypoint
          ? <Tile as="span" tone="transfer" className="te-row__node"><Icon name="arrowSwap" size={11} /></Tile>
          : <Tile as="span" className={'te-row__num' + (invalid ? ' is-warn' : '')}>{cityNums[c.id]}</Tile>;
        return (
          <RouteRow
            key={c.id}
            lead={lead}
            name={c.city_name}
            code={c.country_code}
            country={c.country}
            top={cityDateRange(c, lang)}
            bottom={isWaypoint ? <Badge size="tiny">{t('tse.layover')}</Badge> : `${nights} ${pluralize(t, nights, 'view.nights', lang)}`}
          />
        );
      })}
      {end?.city_name && (
        <RouteRow lead={anchorLead} name={end.city_name} code={end.country_code} country={end.country} top={endLabel} bottom={t('ai_plan.end')} />
      )}
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
