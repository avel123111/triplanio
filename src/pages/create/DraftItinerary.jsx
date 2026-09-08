// @ts-check
import React from 'react';
import { Icon } from '../../design/icons';
import { Badge, Col, Country, Row, Tile } from '../../design/index';
import { useT, useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { pluralize } from '@/lib/i18n/format';
import { startOf, endOf, cityNodesOf, visitNumbers } from '@/pages/create/routeModel';
import { addDays, cityDateRange } from '@/lib/tripDates';

// =====================================================================
// ЧЕРНОВИК МАРШРУТА — СОДЕРЖИМОЕ, У КОТОРОГО ДВЕ ОБОЛОЧКИ (TRIP-535).
// На широком десктопе он живёт во ВТОРОЙ КОЛОНКЕ шелла (слоты
// `sideHead`/`sideBody`), ниже порога двух колонок и на телефоне — во ВКЛАДКЕ
// шапки той же панели. Оболочки разные, список один: у него нет ни своего
// заголовка, ни своей поверхности — их даёт то место, куда его положили.
//
// ★ МАРШРУТ ОДИН И ЖИВОЙ (TRIP-527). Рисуется от тех же узлов, что видит карта
// и шаг 2, а не от снимка из сообщения: после «поставь 4 ночи в Лиссабоне»
// правдив только текущий `nodes`.
// =====================================================================

// ─── Ряд черновика — свой, а не ряд шага 2 ──────────────────────────────────
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

export default DraftItinerary;
