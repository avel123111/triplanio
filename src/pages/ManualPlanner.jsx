import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams, useLocation, useNavigationType } from 'react-router-dom';
import { track } from '@/lib/analytics';
import { Sentry } from '@/lib/sentry';
import { invokeFn } from '@/lib/invokeFn';
import { tripShellQuery, tripContentQuery } from '@/lib/invokeTripFn';
import { refusalError } from '@/lib/refusalError';
import { goPro } from '@/lib/goPro';
import { errorText } from '@/lib/errorText';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT, useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useActiveTripsLimit, invalidateActiveTripsLimit } from '@/hooks/useActiveTripsLimit';
import { isProActive } from '@/lib/subscription';
import { useTheme } from '@/lib/ThemeContext';
import { resolveCities, nearbyCities } from '@/lib/geo';
import { haversineKm } from '@/lib/trip-stats';
import { Icon } from '../design/icons';
import { Badge, Btn, Card, Country, EditableText, EmptyState, IconBtn, Severity, Tile, useToast } from '../design/index';
import CityRowBase from '@/components/trip/CityRow';
import NightsStepper from '@/components/trip/NightsStepper';
import TripStartControl from '@/components/trip/TripStartControl';
import TripCoverPicker from '@/components/trips/TripCoverPicker';
import { finalizeDraftCover } from '@/lib/coverStorage';
import FlowProgress from '@/pages/create/FlowProgress';
import { normalizeStep, stepEntryFrom, resolveBack, nextStepState } from '@/pages/create/stepUrl';
import { draftStorageKey, removeDraft, draftHref, draftDoorMismatch, parseDraft } from '@/lib/planner-draft';
import { ShellSlot, useShellFacts, useShellSurface } from '@/components/trips/TripShellContext';
import { sameCity } from '@/lib/validation';
import { cityUnderPin } from '@/lib/map/markers';
import PanelAi from '@/pages/create/PanelAi';
import ChatComposer from '@/components/chat/ChatComposer';
import { CityAnchorRow } from '@/pages/create/anchors';
import CityAdder from '@/components/cities/CityAdder';
import CityPicker from '@/components/cities/CityPicker';
import { resolveCity } from '@/components/cities/resolveCity';
import {
  startOf, endOf, cityNodesOf, hasExplicitEnd, isAnchorNode,
  insertNode, withNights, recomputeDates, toCitiesPayload, toDraftPayload, makeNode, visitNumbers,
} from '@/pages/create/routeModel';
import { applyOps, citiesInOps } from '@/pages/create/aiOps';
import { useRouteDnD } from '@/lib/useRouteDnD';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { addDays, cityDateRange, ymdLocal } from '@/lib/tripDates';
import { pluralize } from '@/lib/i18n/format';
// StartCalendar / Popover / Sheet / DateTime are now encapsulated in the shared TripStartControl.

// Monotonic clock for measuring a plan call's duration (n8n + LLM). performance
// where available, Date otherwise — a plain elapsed number for analytics.
const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const elapsedMs = (startedAt) => Math.round(nowMs() - (startedAt ?? nowMs()));

// ─── Static data ──────────────────────────────────────────────────────────────
// Unified create-flow steps. The "Транспорт" step was removed - transfers are
// no longer collected at creation time (added later in the timeline / Edit
// Mode). "Возврат" is skipped when the last city is marked as the finish point.
const STEPS = [
  { id: 'home',   num: 1, labelKey: 'planner.step_home' },
  { id: 'cities', num: 2, labelKey: 'planner.step_cities' },
  { id: 'return', num: 3, labelKey: 'planner.step_return' },
  { id: 'review', num: 4, labelKey: 'planner.step_review' },
];

// Ключ черновика, предикат «есть ли работа» и стирание записи живут в
// `@/lib/planner-draft` (там же — почему ключ собран из человека и ИМЕНИ
// черновика, дверь при этом уехала в поле записи, и почему версия ключа
// поднимается, а не мигрируется): читателей стало двое (визард и карточка
// черновика на главной), а копия ключа расходится молча — карточка просто не
// появится, ничего при этом не сломав.

// Стабильные ссылки для пропов карты: новый массив на каждый рендер заставлял бы
// карту перестраивать линии и контролы на каждом нажатии в шаге.
const NO_TRANSFERS = Object.freeze([]);
const MAP_CONTROLS = Object.freeze(['projection', 'theme']);

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Календарная арифметика показа (`ymdLocal` / `addDays` / `cityDateRange`)
// живёт в `@/lib/tripDates` — её читают три экрана; формат даты — общая дверь
// `fmtDate` из `useI18nFormat()`.

// Default trip start = one month ahead of today (local), YYYY-MM-DD.
function defaultStartISO() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return ymdLocal(d);
}

// Auto trip title: start city → last real destination ("предпоследний" узел
// маршрута, т.к. последним идёт возврат). Falls back gracefully.
function computeAutoTitle(home, cities, t) {
  const startName = home?.city_name || cities[0]?.city_name || '';
  const lastName = cities[cities.length - 1]?.city_name || '';
  if (startName && lastName && startName !== lastName) return `${startName} → ${lastName}`;
  return startName || lastName || t('trips.new');
}

// Вид узла объявлен НА УЗЛЕ (`kind`), а не выводится из ночей: связь «ноль ночей
// = пересадка» держит `routeModel.withNights` — одно место, поэтому степпер в
// ряду и плитка вида в шторке разойтись не могут.
// Прежний предикат `isPlannerWaypoint(city)` был вторым толкованием того же
// факта и удалён вместе с моделью, которая его требовала.

// CityPicker + CityAnchorRow live in ./create/anchors (shared by the planner
// steps and the AI panel — one picker/anchor, no circular import).

// floor-exempt: dsshare +15 — замер на origin/dev: 42.78% → 42.64% (4278 → 4264
// bp, просадка 14). Числитель 1439 → 1426, знаменатель 3364 → 3344 — упали ОБА,
// разметки стало меньше. Причины — известные слепые зоны метрики, не сырая
// разметка: (1) удалены дубли (режим правки в ряду, инлайн-пикер плитки старта),
// они были плотнее по ДС среднего; (2) композер сменил `Sheet` (ДС) на
// `PickerSheet` — `components/ui/` считается легаси, он в знаменателе, но не в
// числителе; (3) якорь маршрута рисовали два компонента, второй был собран из
// восьми примитивов ДС — схлопнут в один вызов общего `CityAnchorRow`; (4) ряд
// «город + изменить» диалог статистики собирал заново — теперь общий
// `SelectedCity`. Лечится переездом общих поверхностей в `src/design/` —
// отдельная задача. Остальные девять чисел не выросли ни одно. Апрув Pavel.
//
// Построчные `//`, а не блок: гард i18n признаёт комментарием строку, начатую с
// `//`, `*` или `/*`, — у блока продолжения без звёздочки читаются как код.

// ─── CityRow ──────────────────────────────────────────────────────────────────

// City row built from the EDITOR's primitives (.te-row / .te-grip / .te-row__num /
// .te-citycell / .te-cityname / .te-dts + <Stepper> nights) so the planner route
// looks and behaves identically to the structural editor — same bold city
// names, same nights stepper, same lift-on-drag. No bespoke steppers/fonts.
//
// ★ РЯД БОЛЬШЕ НЕ РЕДАКТИРУЕТ, И ЭТО НЕСУЩЕЕ (TRIP-484 §4). Раньше он держал
// собственный режим `editing` со своим пикером внутри, собственный `staged`
// (выбранный, но ещё не записанный город) и кнопку «✓» — то есть ПОДТВЕРЖДЕНИЕ
// ТОГО ЖЕ ГОРОДА, который только что выбрали: между выбором и записью не
// происходило ничего. Добавление уехало в общий композер (`cities/CityAdder`,
// тот же, что в редакторе маршрута), где между выбором и записью стоит выбор
// ВИДА точки, — и подтверждение стало осмысленным вместо переспроса.
// Ряд теперь показывает готовый узел и правит у него ровно две вещи: ночи и
// порядок. Смена города = удалить и добавить заново — ровно как в редакторе.
function CityRow({ num, node, isDragging, isPressing, active = false, onArm, onChange, onRemove, onMove }) {
  const t = useT();
  const { lang } = useI18n();
  const invalid = !!node.city_name && node.latitude == null;
  const nights = +node.nights || 0;
  // Вид приходит С УЗЛА, а не выводится из ночей: у пересадки пунктирный узел с
  // тоном переезда и бейдж вместо диапазона дат — как в редакторе.
  const isWaypoint = node.kind === 'waypoint';
  const dateRange = cityDateRange(node, lang);
  const stopArm = (e) => e.stopPropagation();

  const grip = (
    <span className="te-grip" role="button" tabIndex={0} aria-label={t('planner.drag')} title={t('planner.drag')}
      onClick={stopArm}
      onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); onMove(-1); } else if (e.key === 'ArrowDown') { e.preventDefault(); onMove(1); } }}>
      <Icon name="drag" size={14} />
    </span>
  );
  // Узел пересадки — тон `transfer` плитки, пунктирный контур даёт правило
  // `.te-row__node.tile--transfer` (одно на все ряды маршрута).
  const lead = isWaypoint
    ? <Tile as="span" tone="transfer" className="te-row__node"><Icon name="arrowSwap" size={11} /></Tile>
    : <Tile as="span" className={'te-row__num' + (invalid ? ' is-warn' : '')}>{num}</Tile>;
  const dates = isWaypoint
    ? <><Badge size="tiny">{t('tse.layover')}</Badge>{dateRange}</>
    : dateRange;

  return (
    <CityRowBase
      variant="planner"
      // `is-hover` mirrors the map pin's hover/selected state (Map-lens parity).
      className={active ? 'is-hover' : ''}
      dragging={isDragging}
      pressing={isPressing}
      invalid={invalid}
      onArm={onArm}
      grip={grip}
      lead={lead}
      name={node.city_name}
      country={node.country}
      countryCode={node.country_code}
      dates={dates}
    >
      {/* Степпер ночей — ЕДИНСТВЕННАЯ ручка вида в ряду: ноль ночей и есть
          пересадка, и связь эту держит модель (`withNights`), а не этот файл.
          Поэтому плитка вида в композере и степпер здесь не могут разойтись —
          они пишут через одну функцию. */}
      <NightsStepper
        value={nights}
        onMinus={() => onChange(withNights(node, nights - 1))}
        onPlus={() => onChange(withNights(node, nights + 1))}
        minusDisabled={nights <= 0}
        plusDisabled={nights >= 30}
      />
      <button className="te-step te-step--del" onPointerDown={stopArm} onClick={(e) => { e.stopPropagation(); onRemove(); }} title={t('common.delete')} aria-label={t('common.delete')}><Icon name="trash" size={13} /></button>
    </CityRowBase>
  );
}

// TripStartControl extracted to a shared component: src/components/trip/TripStartControl.jsx
// (used by both the create-flow planner and the structural editor — one element).

// ─── Step 1: Home ─────────────────────────────────────────────────────────────

function StepHome({ home, setHome, startDate, setStartDate }) {
  const t = useT();
  const { lang } = useI18n();
  const { fmtDistance } = useI18nFormat();
  const [geoState, setGeoState] = useState('ask'); // ask | loading | allowed | denied
  const [candidates, setCandidates] = useState([]); // 2-3 nearest cities from GPS

  const requestGeo = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('loading');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Inhouse reverse geocode → up to 3 nearest gazetteer cities (TRIP-226).
        // The closest point is often a suburb, so we let the user pick.
        const found = await nearbyCities(pos.coords.latitude, pos.coords.longitude, lang);
        if (found.length) {
          // Подсказка по геолокации приходит ТОЙ ЖЕ строкой справочника, что и
          // выбор в пикере, поэтому и доводится тем же общим шагом
          // (`cities/resolveCity`): имя страны из кода, таймзона из координат.
          setCandidates(found.map((c) => ({
            ...resolveCity(c, lang),
            // Distance from the user's GPS point to the gazetteer city (its
            // centroid) — shown in the chip so a suburb-vs-city pick is informed.
            distanceKm: haversineKm(pos.coords.latitude, pos.coords.longitude, c.latitude, c.longitude),
          })));
          setGeoState('allowed');
        } else {
          setGeoState('denied');
        }
      },
      () => setGeoState('denied'),
      { timeout: 8000 }
    );
  };

  return (
    <div>
      <h1>{t('planner.home_title')}</h1>
      <div className="t-body">
        {t('planner.home_desc')}
      </div>

      <h2 className="section-sub">{t('ai_plan.start')}</h2>
      <div className="field-row field-row--aside">
        <div className="field">
          <label className="field__label">{t('planner.start_city')} <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 /* design-token-exempt: caps-reset for optional suffix */ }}>· {t('planner.optional')}</span></label>
          <CityPicker value={home} onChange={setHome} placeholder={t('planner.start_city_ph')} />
        </div>
        <div className="field">
          <label className="field__label">{t('planner.departure_date')}</label>
          <TripStartControl date={startDate} onStep={(d) => startDate && setStartDate(addDays(startDate, d))} onPickDate={setStartDate} block />
        </div>
      </div>

      {/* "Рядом" — такой же заголовок раздела, что и «Старт» выше: одна роль на
          экране = один класс. Раньше он был собран руками из капс-эйбрау и двух
          полей отступа. */}
      <h2 className="section-sub">{t('planner.nearby')}</h2>

      {geoState === 'ask' && (
        <Severity
          level="info"
          dashed
          icon="pin"
          align="mid"
          title={t('planner.suggest_nearby')}
          action={<Btn variant="primary" onClick={requestGeo}>{t('planner.allow')}</Btn>}
        >
          <div className="muted t-meta">{t('planner.geo_hint')}</div>
        </Severity>
      )}

      {geoState === 'loading' && (
        <Severity level="info" loading align="mid">
          <span className="t-body muted">{t('planner.detecting')}</span>
        </Severity>
      )}

      {geoState === 'allowed' && candidates.length > 0 && (
        <div className="col col--g4">
          {candidates.map((c) => {
            const selected = home?.external_city_id != null && home.external_city_id === c.external_city_id;
            const dist = fmtDistance(c.distanceKm);
            // Rounded 0 km (standing inside the city centroid) reads wrong → "<1".
            const distLabel = dist.value === '0' ? `<1 ${dist.unit}` : `${dist.value} ${dist.unit}`;
            return (
              <Card
                as="button"
                radius="card"
                interactive
                key={c.external_city_id}
                onClick={() => setHome(c)}
                className={`choice-card choice-card--sm${selected ? ' choice-card--on' : ''}`}
              >
                <div className="tile tile--brand">
                  <Icon name="plane" size={17} />
                </div>
                <div className="grow--fit">
                  <div className="t-subheading">{c.city_name}</div>
                  <div className="muted t-meta"><Country code={c.country_code} name={c.country} /> · {distLabel}</div>
                </div>
                {selected && (
                  <span className="tile tile--sm tile--solid tile--brand tile--round">
                    <Icon name="check" size={11} />
                  </span>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {geoState === 'denied' && (
        <Severity
          level="quiet"
          icon="lock"
          align="mid"
          title={t('planner.geo_off')}
          action={<Btn variant="secondary" onClick={requestGeo}>{t('planner.retry_request')}</Btn>}
        >
          <div className="muted t-meta">{t('planner.geo_off_hint')}</div>
        </Severity>
      )}

    </div>
  );
}

// ─── Step 2: Cities ───────────────────────────────────────────────────────────

function StepCities({ nodes, setNodes, startDate, setStartDate, hoveredId = null, selectedId = null, onHover, onComposingChange }) {
  const t = useT();
  const { toast } = useToast();
  const confirm = useConfirm();

  // Все три ручки бьют в ОДИН список и гоняют ОДНУ раскладку дат — как в
  // редакторе. Якоря в цепочку дат не входят: это знает модель, не эта функция.
  const patch = (node) => setNodes(ns => recomputeDates(ns.map(n => (n.id === node.id ? node : n)), startDate));
  const drop = (id) => setNodes(ns => recomputeDates(ns.filter(n => n.id !== id), startDate));
  /* Удаление города спрашивает — так же, как в редакторе маршрута, и той же
     дверью (`useConfirm`). Описание своё: редакторское говорит про каскадное
     удаление броней, а до создания трипа броней не существует, и обещать
     удаление того, чего нет, нельзя. */
  const remove = (node) => {
    if (!node.city_name) { drop(node.id); return; }   // ряд без города спрашивать не о чем
    confirm({
      title: t('tse.delete_city_q', { city: node.city_name }),
      description: t('planner.delete_city_desc'),
      confirmLabel: t('tse.delete_city'),
      variant: 'destructive',
      onConfirm: () => drop(node.id),
    });
  };

  // Добавление из общего композера: он отдаёт (город, вид), вставку делает модель
  // по правилам редактора — старт в начало, финиш в конец, остальное ПЕРЕД
  // финишем. Занятый якорь отказывает тем же тостом, что и редактор.
  const add = (city, kind) => setNodes(ns => {
    const next = insertNode(ns, makeNode(city, kind));
    if (!next) {
      toast({ description: kind === 'start' ? t('tse.start_already_set') : t('tse.end_already_set'), variant: 'warning' });
      return ns;
    }
    return recomputeDates(next, startDate);
  });

  // Reorder via the SAME engine as the structural editor (useRouteDnD): pointer
  // drag (mouse-immediate / touch-long-press), FLIP slide, keyboard a11y — one
  // implementation, no second copy to drift.
  // ★ ЯКОРЯ ТЕПЕРЬ НАСТОЯЩИЕ. Здесь стояла заглушка `isAnchor: () => false` —
  // у визарда просто не было якорей в списке, чтобы их пиннить. Теперь они в
  // списке, и хук пиннит их сам, тем же кодом, что в редакторе.
  const { draggingId, pressingId, displayNodes, setRowRef, armDrag, moveNodeById } = useRouteDnD({
    ordered: nodes,
    isAnchor: isAnchorNode,
    onCommitOrder: (ids) => setNodes(ns => {
      const byId = new Map(ns.map(n => [n.id, n]));
      return recomputeDates(ids.map(id => byId.get(id)).filter(Boolean), startDate);
    }),
  });

  // Добавили город → докручиваем к концу списка, чтобы новый ряд не оставался за
  // кадром. Тот же приём scrollIntoView, что у композера — одна логика скролла на
  // оба флоу. Скроллим ПОСЛЕДНИЙ элемент контейнера (композер), который стоит
  // сразу под новым рядом — без отдельного якоря в разметке.
  const listRef = useRef(/** @type {HTMLDivElement | null} */(null));
  const prevCount = useRef(nodes.length);
  useEffect(() => {
    const grew = nodes.length > prevCount.current;
    prevCount.current = nodes.length;
    if (!grew) return;
    const id = setTimeout(() => listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    return () => clearTimeout(id);
  }, [nodes.length]);

  const hasStart = !!startOf(nodes);
  /* ⚠️ «ПУСТО» — ЭТО НЕТ ГОРОДОВ, А НЕ НЕТ УЗЛОВ. Предикат СМЕНИЛ СМЫСЛ под
     переездом на один список: раньше он читал `cities` (только города, старт
     лежал отдельной переменной), а `nodes` включает и якоря — поэтому заданный
     старт молча выключал приглашение «Куда едем?», хотя маршрута ещё нет.
     Старт городом не является: из него выезжают, в нём не ночуют. */
  const hasCities = cityNodesOf(nodes).length > 0;
  const hasEnd = hasExplicitEnd(nodes);
  // Номера — ОДНОЙ картой на отрисовку (правило общее с лентой ИИ, обзором и
  // редактором); по ЗАФИКСИРОВАННОМУ порядку, не по превью перетаскивания.
  const cityNums = visitNumbers(nodes);

  return (
    <div>
      <h1>{t('planner.step_cities')}</h1>
      <div className="t-body">
        {t('planner.cities_desc_1')} <b>{t('planner.cities_desc_drag')}</b> {t('planner.cities_desc_2')}
      </div>

      {/* "Города" header — section sub-heading + the shared start control on the
          right in one row (mirrors the editor's .ts-routehead: title + control). */}
      <h2 className="section-sub section-sub--row">
        <span className="grow">{t('planner.cities_heading')}</span>
        <TripStartControl date={startDate} onStep={(d) => startDate && setStartDate(addDays(startDate, d))} onPickDate={setStartDate} label={t('ai_plan.start')} />
      </h2>

      {/* ★ ОДИН СПИСОК: старт, города и финиш — РЯДЫ одного и того же перечня,
          как в редакторе маршрута. Прежде старт стоял отдельной плиткой НАД
          списком, а финиша в нём не было вовсе — из-за этого его нельзя было ни
          показать на своём месте, ни задать иначе как отдельным шагом. */}
      <div className="col" ref={listRef}>
        {/* ПЛИТКА «СТАРТ» — ВХОД В ТОТ ЖЕ КОМПОЗЕР, а не свой пикер. Старт
            необязателен (шаг 1 можно пропустить), поэтому место под него на шаге
            городов есть всегда, пока он не задан. Вид точки в композере
            предвыбран стартом — это намерение входа, а не запрет: плитку можно
            сменить. */}
        {!hasStart && (
          <CityAdder
            onAdd={add}
            hasStart={hasStart}
            hasEnd={hasEnd}
            defaultKind="start"
            onOpenChange={onComposingChange}
            renderTrigger={({ open }) => (
              <CityAnchorRow label={t('ai_plan.start')} city={null} editable onAdd={open} />
            )}
          />
        )}

        {displayNodes.map((n) => {
          const rowId = String(n.id);
          // Якорь — плитка старта/финиша (тот же элемент, что `.te-end` редактора).
          if (isAnchorNode(n)) {
            return (
              <div key={n.id} ref={setRowRef(n.id)}>
                <CityAnchorRow
                  label={n.kind === 'start' ? t('ai_plan.start') : t('ai_plan.end')}
                  city={n}
                  editable
                  onRemove={() => remove(n)}
                />
              </div>
            );
          }
          return (
            <div
              key={n.id}
              ref={setRowRef(n.id)}
              /* Ряд без координат ховер карты не забирает: показывать нечего,
                 пина у него нет (тот же предикат, по которому карта его и не
                 рисует). Въезд во время перетаскивания пропускаем — FLIP возит
                 ряды под удержанным пальцем и иначе дёргал бы подсветку. */
              onMouseEnter={onHover ? () => { if (!draggingId && n.latitude != null) onHover(rowId); } : undefined}
              onMouseLeave={onHover ? () => onHover(null) : undefined}
            >
              <CityRow
                /* Номер считается по ЗАФИКСИРОВАННОМУ порядку (`nodes`), а не по
                   превью перетаскивания (`displayNodes`) — иначе цифры прыгали бы
                   под пальцем. Правило одно с картой и лентой ИИ (`visitNumbers`:
                   якоря и пересадки номера не получают). */
                num={cityNums[n.id]}
                node={n}
                isDragging={draggingId === n.id}
                isPressing={pressingId === n.id}
                active={hoveredId === rowId || selectedId === rowId}
                onArm={(e) => armDrag(e, n.id)}
                onChange={patch}
                onRemove={() => remove(n)}
                onMove={(dir) => moveNodeById(n.id, dir)}
              />
            </div>
          );
        })}

        {/* Композер — ТОТ ЖЕ, что в редакторе маршрута: город, затем вид точки,
            затем подтверждение. Он и решает, что показать на телефоне (шторка) и
            на десктопе (инлайн-карточка) — этому экрану знать про платформу
            нечего. `defaultKind` называет НАМЕРЕНИЕ входа: с этой кнопки
            добавляют город посещения.

            ★ ПУСТОЕ СОСТОЯНИЕ — ЭТО И ЕСТЬ ЕГО ТРИГГЕР, а не сосед сверху. Пока
            они стояли рядом, экран показывал приглашение «Куда едем?» И
            отдельную кнопку во всю ширину под ним: два зова одного действия, с
            дырой между ними. Теперь зов один — кнопка живёт В приглашении, как
            обычная кнопка пустого состояния. Композер при этом ОДИН и тот же:
            меняется только облик его триггера, а не число композеров (иначе на
            переключении сбрасывалось бы его состояние).
            Прятать приглашение на время работы не нужно: на десктопе композер
            открывается ВМЕСТО триггера (`if (!open) return trigger`), на
            телефоне лежит под своей шторкой. */}
        <CityAdder
          onAdd={add}
          hasStart={hasStart}
          hasEnd={hasEnd}
          defaultKind="transit"
          onOpenChange={onComposingChange}
          renderTrigger={hasCities ? undefined : ({ open }) => (
            <EmptyState
              icon="pin"
              title={t('planner.where_to')}
              body={t('planner.add_first_city')}
              action={<Btn variant="primary" icon="plus" onClick={open}>{t('planner.add_city')}</Btn>}
            />
          )}
        />
      </div>
    </div>
  );
}

// ─── Step 3: Return ───────────────────────────────────────────────────────────

// Один выбор возврата — вертикальный список из трёх взаимоисключающих карточек:
// домой / в другой город / останусь (финиш, возврата нет). Это тонкий контрол над
// узлом `end` (продуктовая обёртка): клик просто пишет `end`, отдельного состояния
// «способа возврата» нет.
function ReturnOption({ on, onClick, icon, tone, title, desc }) {
  return (
    <Card
      as="button"
      radius="btn"
      interactive
      onClick={onClick}
      className={`choice-card choice-card--sm${on ? ' choice-card--on' : ''}`}
    >
      <div className={`tile tile--lg tile--${tone} tile--solid`}>
        <Icon name={icon} size={19} />
      </div>
      <div className="grow--fit">
        <div className="t-subheading">{title}</div>
        <div className="muted t-meta">{desc}</div>
      </div>
    </Card>
  );
}

// ★ ШАГ ВОЗВРАТА ПИШЕТ В ТОТ ЖЕ СПИСОК, ЧТО И ШАГ ГОРОДОВ (TRIP-484 §4). Раньше
// он владел собственной переменной `end` со своим алфавитом (`null | город |
// 'stay'`) — третьим представлением конца маршрута вдобавок к списку и к
// полезной нагрузке. Теперь у него нет своего состояния вовсе: три карточки —
// это три способа записать ОДИН узел `kind:'end'`, и ровно поэтому шаг можно
// пропустить, когда тот же узел уже задан плиткой на шаге городов.
//   «домой»    → узел-клон старта;
//   «другой»   → узел выбранного города;
//   «останусь» → узла НЕТ (маршрут кончается последним городом).
// ★ ПОДСВЕЧЕННАЯ КАРТОЧКА ВЫВОДИТСЯ ИЗ УЗЛА, А НЕ ИЗ СВОЕГО СОСТОЯНИЯ. Раз
// «останусь» — это отсутствие узла, дефолтом (ничего не выбрано) становится
// ИМЕННО «останусь»: подсвечивать «домой», не записав его, значило бы показать
// один выбор и сохранить другой.
function StepReturn({ home, lastCityName, endNode, onFinishHome, onFinishCity, onClearFinish }) {
  const t = useT();
  // «Домой» (финиш = город старта) доступен, если старт вообще есть. Никаких сравнений
  // старт↔последний-город — финиш это самостоятельный узел.
  const canHome = !!home?.city_name;

  const endIsHome = !!endNode && sameCity(endNode, home);
  const endIsOther = !!endNode && !endIsHome;
  // `otherMode` — ЛОКАЛЬНЫЙ флаг вида карточки «другой», а не данные: сам город
  // едет в список. Нужен, чтобы поле выбора осталось открытым, пока в нём ещё
  // ничего не выбрали.
  const [otherMode, setOtherMode] = useState(endIsOther);

  const onHome = endIsHome;
  const onOther = endIsOther || (otherMode && !endIsHome);
  const onStayCard = !endNode && !otherMode;

  return (
    <div>
      <h1>
        {t('planner.return_title_pre')} <em>{lastCityName}</em>?
      </h1>
      <div className="t-body">
        {t('planner.return_desc')}
      </div>

      <h2 className="section-sub">{t('planner.step_return')}</h2>
      <div className="col col--g7">
        {/* Вертикальный список вариантов (было двумя карточками в ряд). */}
        <div className="col col--g4">
          {canHome && (
            <ReturnOption
              on={onHome}
              onClick={() => { onFinishHome(); setOtherMode(false); }}
              icon="flag" tone="brand"
              title={t('planner.return_home', { city: home?.city_name || '…' })}
              desc={<>{t('planner.return_home_desc_1')} <b>{lastCityName}</b> {t('planner.return_home_desc_2')}</>}
            />
          )}
          <ReturnOption
            on={onOther}
            onClick={() => { onClearFinish(); setOtherMode(true); }}
            icon="globe" tone="warm"
            title={t('planner.return_other')}
            desc={t('planner.return_other_desc')}
          />
          {/* «Останусь в {город}» = финиша НЕТ. Единственная запись — снять узел;
              последний город остаётся обычным последним городом. */}
          <ReturnOption
            on={onStayCard}
            onClick={() => { onClearFinish(); setOtherMode(false); }}
            icon="check" tone="success"
            title={t('planner.stay_title', { city: lastCityName })}
            desc={t('planner.stay_desc', { city: lastCityName })}
          />
        </div>

        {onOther && (
          <div className="field">
            <label className="field__label">{t('planner.return_city')}</label>
            <CityPicker
              value={endIsOther ? endNode : null}
              onChange={(c) => (c ? onFinishCity(c) : onClearFinish())}
              placeholder={t('planner.return_city_ph')}
              autoFocus
            />
          </div>
        )}

        <Severity level="quiet">
          <div className="t-meta muted">{t('planner.return_info')}</div>
        </Severity>
      </div>
    </div>
  );
}

// ─── Step 5: Review ───────────────────────────────────────────────────────────

// Приглушение - модификатором РЯДА, а не классом .muted на тексте: у
// .te-cityname свой цвет тем же весом селектора, и кто победит, решал бы
// порядок правил в файле.
function ReviewRow({ num, name, sub, icon, muted }) {
  return (
    <div className={`row row--g7 pl-revrow${muted ? ' pl-revrow--muted' : ''}`}>
      <span className="tile tile--sm tile--round tile--solid tile--brand t-meta">
        {icon ? <Icon name={icon} size={12} /> : num}
      </span>
      <div className="grow--fit">
        <div className="trunc te-cityname">{name || '-'}</div>
        <div className="muted t-meta">{sub}</div>
      </div>
    </div>
  );
}

// Пара «значение + ярлык» - это .v/.k полосы статистики, ровно как её рисует
// общий <StatBar>. Своих имён у цифры в превью нет.
function Stat({ label, value, hint, warn }) {
  return (
    <div>
      <div className="v">{value}</div>
      <div className="k">{label}</div>
      {hint && <div className="muted t-meta">{hint}</div>}
      {warn && <div className="wrn t-meta">{warn}</div>}
    </div>
  );
}

function StepReview({ home, cities, finishCity, cover, setCover, tripTitle, setTripTitle, saving, error }) {
  const t = useT();
  const { lang } = useI18n();
  // «12 окт.» — общая дверь формата (`formatDayMonth` за `fmtDate`), не своя копия.
  const { fmtDate } = useI18nFormat();
  const totalNights = cities.reduce((n, c) => n + (Number(c.nights) || 0), 0);
  const cityNums = visitNumbers(cities);
  const autoTitle = computeAutoTitle(home, cities, t);
  // Экран успеха живёт не здесь, а развилкой по `savedOk` в теле панели
  // ManualPlanner (TRIP-520): он терминален и не должен зависеть от того, на
  // каком шаге стоит адрес.

  return (
    <div className="col col--g6 pl-review">
      {/* Обложка во всю ширину сразу под разделителем прогресса, без радиусов
          (full-bleed из падинга .lp-b, класс .pl-cover перебивает кадр 4:3 ДС на
          полосу 200px). Пикер рисует: фото/пресет/фоллбек, кнопку загрузки в
          правом верхнем углу, стрелки по бокам, название трипа с карандашом
          (наш <EditableText> как overlay) и ленту миниатюр под обложкой.
          `autoSelect` — шаг открывается без обложки, уехать с пустой нельзя. */}
      <TripCoverPicker
        coverImageUrl={cover?.cover_image_url || ''}
        onChange={setCover}
        autoSelect
        className="pl-cover"
        overlay={(
          <EditableText
            value={tripTitle}
            onChange={setTripTitle}
            placeholder={autoTitle}
            ariaLabel={t('planner.title_label')}
            editLabel={t('planner.title_edit')}
            confirmLabel={t('common.done')}
          />
        )}
      />

      {/* Сводка под обложкой — без изменений: статы + маршрут плоскими секциями. */}
      <Card radius="btn" pad="none" className="pl-summary">
        {/* statbar is card-homed (its skin lives on the Card primitive) — kept on the
            Card for the surface-registry guard; flattened to a divided section below. */}
        <Card pad="none" className="statbar">
          <div className="s">
            <Stat
              label={t('event.start')}
              value={cities[0]?.startDate ? fmtDate(cities[0].startDate) : '—'}
              warn={!cities[0]?.startDate ? t('planner.date_required_hint') : null}
            />
          </div>
          <div className="s">
            <Stat label={t('planner.duration')} value={`${totalNights} ${pluralize(t, totalNights, 'view.nights', lang)}`} />
          </div>
          <div className="s">
            <Stat label={t('planner.cities_stat')} value={cities.length} />
          </div>
        </Card>

        <div className="pl-summary__route">
          <div className="eyebrow">{t('planner.route_points', { n: (home ? 1 : 0) + cities.length + (finishCity?.city_name ? 1 : 0) })}</div>
          <div className="col col--g1">
            {home?.city_name && (
              <ReviewRow icon="flag" name={home.city_name} sub={`${home.country || ''} · ${t('ai_plan.start')}`} muted />
            )}
            {/* Финиша-города не бывает: конец маршрута — отдельный узел (ниже)
                либо его нет вовсе. Номер — та же `visitNumbers`, что у шага 2
                и ленты ИИ: пересадка номера не получает, у неё значок переезда. */}
            {cities.map((c) => {
              const wp = c.kind === 'waypoint';
              const stay = wp ? t('tse.layover') : `${c.nights} ${pluralize(t, c.nights, 'view.nights', lang)}`;
              return (
                <ReviewRow
                  key={c.id}
                  num={wp ? undefined : cityNums[c.id]}
                  icon={wp ? 'arrowSwap' : undefined}
                  name={c.city_name}
                  sub={`${c.country || '-'} · ${stay}${c.startDate ? ` · ${t('planner.from_date_prefix')} ${fmtDate(c.startDate)}` : ''}`}
                />
              );
            })}
            {finishCity?.city_name && (
              <ReviewRow icon="flag" name={finishCity.city_name} sub={`${finishCity.country || ''} · ${t('ai_plan.end')}`} muted />
            )}
          </div>
        </div>
      </Card>

      {error && <Severity level="error">{error}</Severity>}

      {saving && (
        <Severity level="info" loading align="mid">
          <div className="t-body">{t('planner.saving_msg')}</div>
        </Severity>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ManualPlanner({ initialMethod = 'manual' }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const { lang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const confirm = useConfirm();

  // Детент шита и свёрнутость панели — состояние ЭКРАНА, а не шелла: шаг может
  // осознанно опустить шит (например, когда просит выбрать город на карте).
  const [detent, setDetent] = useState(1);
  const [collapsed, setCollapsed] = useState(false);

  const isPro = isProActive(user);
  const { isDark } = useTheme();

  // NB: no <body> scroll-lock here. Оболочка трипа (`.trip-shell`) — фикс-шелл
  // 100dvh с overflow:hidden: документ не скроллится, шапка стоит и при открытой
  // клавиатуре. A body position:fixed lock (tried earlier) was what made the
  // header fly up on keyboard, so it was removed.

  // 'manual' | 'ai' - only the entry screen differs; from the skeleton onward
  // both methods share the same steps.
  const method = initialMethod;
  const isAi = method === 'ai';

  // ── Free-plan limit check — single source: getActiveTrips → active_owned_trips() ──
  // Pro users skip the fetch; the server is the one definition of "active owned trip".
  const { isBlocked, isLoading: checkingLimit } = useActiveTripsLimit(isPro ? undefined : user?.id);
  const isOverLimit = isBlocked;

  // ── Wizard state ─────────────────────────────────────────────────────────
  // NB: `step` больше НЕ состояние — это адрес (`?step=`, ниже, TRIP-520).
  const [startDate, setStartDateRaw] = useState(defaultStartISO()); // YYYY-MM-DD, trip start; prefilled +1 month
  // ★ МАРШРУТ — ОДИН СПИСОК УЗЛОВ, КАК В РЕДАКТОРЕ (TRIP-484 §4). Было три
  // переменные: `home` (старт), `cities` (список) и `end` (`null | город |
  // 'stay'`). Старт и финиш при этом не были рядами списка — их нельзя было ни
  // перетащить, ни занумеровать вместе с остальными, а «вставить перед финишем»
  // выражалось тем, что финиша в списке просто нет.
  // Все прежние величины стали ВЫВОДОМ (ниже, у `routeModel`): второго источника
  // правды по маршруту в этом файле больше нет.
  const [nodes, setNodes] = useState([]);
  const [tripTitle, setTripTitle]   = useState('');
  const [cover, setCover]           = useState({ cover_image_url: '' });
  const [saving, setSaving]         = useState(false);
  const [savedOk, setSavedOk]       = useState(false);
  const [savedTripId, setSavedTripId] = useState(null);
  const [error, setError]           = useState(null);
  const [restored, setRestored]     = useState(false);
  /* Композер города открыт — шаг не завершён. «Далее» с открытым композером
     уводило бы с шага, бросив наполовину введённый город: он нигде не
     сохранён и просто исчезал. Факт приходит из шага одним каналом
     (`CityAdder.onOpenChange`), второго способа его узнать нет.
     ⚠️ СЧЁТЧИК, А НЕ ФЛАГ: композеров на шаге городов бывает ДВА одновременно
     (плитка «Старт» и пустое состояние, пока нет ни старта, ни городов), и оба
     пишут сюда. С булевым закрытие одного гасило факт при втором ОТКРЫТОМ.
     Канал шлёт переходы парно (открытие → уборка эффекта, в том числе на
     размонтировании), поэтому складывать их законно. */
  const [composingCount, setComposingCount] = useState(0);
  const onComposingChange = useCallback((open) => setComposingCount((c) => c + (open ? 1 : -1)), []);
  const composing = composingCount > 0;
  // Map ↔ list linking (Map-lens parity, TRIP-337): the pin/list row hovered or
  // selected. Ids — id узлов маршрута (ими же карта адресует пины).
  const [hoveredMapId, setHoveredMapId]   = useState(null);
  const [selectedMapId, setSelectedMapId] = useState(null);

  // ── AI-entry state (only used when method === 'ai') ────────────────────────
  // The prompt text lives in <ChatComposer> (it owns its own field); the flow keeps
  // only the transcript + generation state.
  const [aiState, setAiState]               = useState(isAi ? 'prompt' : 'draft'); // prompt | generating | draft
  const [sessionId, setSessionId]           = useState(() => crypto.randomUUID());
  // Chat transcript for the AI flow (Pavel, TRIP-337): a conversation with the bot,
  // not one pink comment. `kind:'welcome'`/`'error'` render their text from i18n (so a
  // language switch re-localizes them); an assistant turn stores the bot's `text` +
  // a `draft` snapshot of the itinerary it proposed. n8n keeps context by sessionId,
  // so follow-up messages refine the draft.
  const [aiMessages, setAiMessages]         = useState(() => (isAi ? [{ id: 'welcome', role: 'assistant', kind: 'welcome' }] : []));

  // ★ МАРШРУТ — ВЫВОД ИЗ СПИСКА УЗЛОВ (перенесено к началу: нормализация шага из
  // адреса читает `citiesValid`, а он выводится из городов). Карта, ревью и
  // сохранение читают ЭТИ узлы — второго источника правды по маршруту нет.
  const home = startOf(nodes);
  const endNode = endOf(nodes);
  // Города для карты и ревью — всё, кроме якорей. «Останусь» отдельным узлом не
  // лежит, поэтому и вычитать из списка нечего: последний город остаётся городом.
  const cities = cityNodesOf(nodes);
  const lastCity = cities[cities.length - 1] || null;
  /* Финиш — ЭТО УЗЕЛ `end`, и другого его вида не бывает. Нет узла — маршрут
     кончается последним городом («останусь»), и рисовать нечего. */
  const finishCity = endNode;
  const citiesValid = cities.length > 0 && cities.every((c) => c.city_name && c.latitude != null);

  // ── Шаг визарда = АДРЕС, а не useState (TRIP-520) ──────────────────────────
  // `?step=` — единственный источник позиции; из этого браузерная / аппаратная /
  // свайп-назад сами ходят по шагам. Пишет адрес ОДНА функция (`writeStep`), как
  // `?lens=` на экране трипа. Дефолтный `home` в адрес не пишется.
  const [sp, setSearchParams] = useSearchParams();
  const location = useLocation();
  const step = normalizeStep(sp.get('step'), { citiesValid });
  /* ★ У ЧЕРНОВИКА ЕСТЬ ИМЯ, И ЕГО НАЗЫВАЕТ АДРЕС.
     Пока черновик был одним слотом на дверь, «создать новое» было некуда
     положить: планировщик писал в тот же слот и затирал начатое, а прикрыть это
     вопросом «продолжить или заново» не выходило — у вопроса нет честного ответа
     «какой из них», и вход по прямому адресу он не покрывал (дверью тот не
     является, а от перезагрузки неотличим).
     Теперь: `?draft=<id>` — правим этот; имени в адресе нет — заводим НОВЫЙ, и
     соседние целы. Спрашивать стало не о чем, поэтому забыть покрыть дверь
     больше нельзя по построению.
     Имя берётся на ПЕРВОМ рендере (реф), чтобы запись в хранилище никогда не
     ушла под `undefined` — эффект, который допишет имя в адрес, бежит позже. */
  const draftIdRef = useRef('');
  if (!draftIdRef.current) draftIdRef.current = sp.get('draft') || crypto.randomUUID();
  const draftId = draftIdRef.current;
  // Пришли ПО ИМЕНИ — значит продолжаем начатое (для аналитики воронки).
  const resumed = useRef(!!sp.get('draft')).current;
  // ★ ЕДИНСТВЕННЫЙ писатель адреса шага. Все три места (переход, восстановление
  // черновика, сброс) идут сюда, поэтому `state.depth` не теряется ни на одном
  // `replace` — иначе «назад» снова путает шаг с выходом (`resolveBack`).
  // `advance` = переход на новый шаг (push, глубина +1); restore/reset — replace
  // в ту же запись с сохранением глубины. `state.from` — намерение для аналитики
  // (на POP его не читаем).
  const writeStep = (id, { intent, replace = false, advance = false } = {}) => {
    const next = new URLSearchParams(sp);
    if (id === 'home') next.delete('step'); else next.set('step', id);
    // Имя черновика едет в адресе ВСЕГДА: иначе перезагрузка или «назад» на
    // запись без него завели бы второй черновик под тем же экраном.
    next.set('draft', draftId);
    setSearchParams(next, { replace, state: nextStepState(location.state, { intent, advance }) });
  };
  // Переход между шагами (goNext / onJump) — единственный push-писатель.
  const setStep = (id, intent) => writeStep(id, { intent, advance: true });

  // Restore from sessionStorage on mount - only for the current user
  useEffect(() => {
    // Адрес за этот проход пишется РОВНО ОДИН раз: обе ветки ниже зовут одного и
    // того же писателя, а `sp` между ними не обновляется — вторая записала бы
    // ТЕКУЩИЙ (довосстановительный) шаг поверх восстановленного. Сегодня они
    // исключают друг друга по построению (без `?draft=` имя свежее, записи под
    // ним нет), но это свойство минтинга имени, а не этого эффекта.
    let addressWritten = false;
    try {
      const raw = sessionStorage.getItem(draftStorageKey(user?.id, draftId));
      const saved = parseDraft(raw);
      /* ★ ЗАПИСЬ ПРАВИТ ТОЛЬКО СВОЯ ДВЕРЬ.
         Ручная дверь восстановила бы всё, кроме переписки (она под `isAi`), и
         следующей же записью сохранила бы `aiMessages: []` — переписка ИИ
         уничтожена беззвучно. Поэтому при несовпадении уходим на дверь самой
         записи, ничего не прочитав и не записав: `restored` остаётся false, а
         значит эффект записи не побежит. Роуты обеих дверей несут разный `key`,
         иначе React переиспользовал бы тот же компонент и этот эффект (деп
         `user?.id`) второй раз бы не сработал. */
      if (draftDoorMismatch(saved, method)) {
        nav(draftHref(draftId, saved.method), { replace: true });
        return;
      }
      if (saved) {
        // Адрес главнее хранилища: сохранённый шаг въезжает в URL только если в
        // адресе шага ещё нет, и через replace (восстановление, не переход) —
        // глубину текущей записи `writeStep` при этом сохраняет.
        if (saved.step && saved.step !== 'home' && !sp.get('step')) {
          writeStep(saved.step, { replace: true });   // адрес получает и шаг, и имя
          addressWritten = true;
        }
        if (saved.nodes?.length) setNodes(saved.nodes);
        if (saved.tripTitle) setTripTitle(saved.tripTitle);
        if (saved.startDate) setStartDateRaw(saved.startDate);
        if (saved.cover) setCover(saved.cover);
        if (saved.aiState && isAi) setAiState(saved.aiState);
        if (saved.aiMessages?.length && isAi) setAiMessages(saved.aiMessages);
      }
    } catch {}
    // Имя черновика — в адрес, если его там ещё нет (тем же единственным
    // писателем, replace: это не переход, а называние того, что уже открыто).
    if (!addressWritten && !sp.get('draft')) writeStep(step, { replace: true });
    setRestored(true);
  }, [user?.id]); // re-run if user changes (e.g. account switch in same tab)

  // Persist to sessionStorage on every change
  useEffect(() => {
    if (!restored) return;
    try {
      // `method` и `savedAt` — ПОЛЯ записи: дверь ушла из ключа вместе с приходом
      // имени, а время нужно, чтобы карточки на главной шли свежими сверху.
      sessionStorage.setItem(draftStorageKey(user?.id, draftId), JSON.stringify({
        method, savedAt: Date.now(), step, nodes, tripTitle, startDate, cover, aiState, aiMessages,
      }));
    } catch {}
  }, [step, nodes, tripTitle, startDate, cover, aiState, aiMessages, restored, user?.id]);

  // ── Аналитика воронки создания (TRIP-520) ──────────────────────────────────
  // Вход в мастер живёт ЗДЕСЬ, а не на клике по карточке метода: там фри-юзер на
  // кэпе давал событие, а планировщик не открывался, и со второй двери (ссылка,
  // история, возврат к черновику) событие не рождалось вовсе.
  const navType = useNavigationType();
  // Признак «вошли в мастер PUSH-ом» — тип навигации НА МОНТИРОВАНИИ (useRef берёт
  // значение первого рендера). Нужен `requestBack` ниже; объявлен здесь, до любых
  // ранних return, чтобы порядок хуков не зависел от ветки. Счётчик своих пушей не
  // подошёл бы: на первом шаге он дал бы nav('/trips') PUSH-ом, и следующий
  // аппаратный «назад» вернул бы человека обратно во флоу.
  const enteredByPush = useRef(navType === 'PUSH').current;
  // Флоу действительно ОТКРЫТ только когда лимит-гейт пропустил: у фри-юзера на
  // кэпе прямой заход на /new-trip рисует апселл, а не мастер — события входа и
  // шага там были бы фантомом (item 9 ревью). Pro лимит-гейт не проходит вовсе
  // (запрос выключен), поэтому для него флоу открыт сразу — тот же `!isPro`, что
  // гейтит спиннер лимита ниже.
  const flowOpen = restored && (isPro || (!checkingLimit && !isOverLimit));
  const startedRef = useRef(false);
  useEffect(() => {
    if (!flowOpen || startedRef.current) return;
    startedRef.current = true;
    track('trip_creation_started', { method, resumed });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowOpen]);

  // Открытие шага — ОДНА дверь (смена адреса): без Ф1 писателей было бы четыре и
  // четвёртого забыли бы. Гард от двойного огня на восстановлении — пара
  // `step + location.key`; шлём только когда флоу открыт и на НОРМАЛИЗОВАННОМ шаге.
  const stepSeenRef = useRef({ key: null, fired: false });
  useEffect(() => {
    if (!flowOpen || savedOk) return; // после сохранения смена адреса — не открытие шага
    const evKey = `${step}|${location.key}`;
    if (stepSeenRef.current.key === evKey) return;
    const isFirst = !stepSeenRef.current.fired;
    stepSeenRef.current = { key: evKey, fired: true };
    track('trip_creation_step_opened', {
      method, step,
      from: stepEntryFrom({ isFirst, navType, intent: location.state?.from }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, flowOpen, location.key]);

  // setStartDate cascades to cities (first city anchors all subsequent dates).
  // Empty/invalid values are IGNORED - the trip start is required and can't be
  // cleared from any date control (step 1, step 2 or review).
  const setStartDate = (dateStr) => {
    if (!dateStr) return;
    setStartDateRaw(dateStr);
    // Re-anchor the whole chain on the new trip start (recomputeDates forces city 0
    // onto the anchor, so no manual first-city patch is needed). Якоря в цепочку
    // не входят — за это отвечает сама модель, а не эта строка.
    setNodes(ns => (ns.length === 0 ? ns : recomputeDates(ns, dateStr)));
  };

  // ── ИИ правит черновик ОПЕРАЦИЯМИ (TRIP-527) ──────────────────────────────
  // Драфт живёт здесь и уходит в модель каждой репликой как данность; модель
  // отвечает списком операций над ним (или только текстом), применяет их чистый
  // `aiOps.applyOps` поверх той же модели маршрута, что у ручных шагов. Полной
  // замены `setNodes(resolved)` больше нет — «поменяй один город» больше не
  // пересобирает всё.
  //
  // ⚠️ СОСТОЯНИЕ ДЛЯ ПРИМЕНЕНИЯ БЕРЁТСЯ ИЗ РЕФА, а не из замыкания колбэка:
  // `useMutation` зовёт onSuccess с опциями ТОГО рендера, где вызвали mutate,
  // а операции применяются к тому, что на экране СЕЙЧАС. Три величины уезжают
  // одним объектом, потому что применятор меняет их вместе (даты городов
  // выводятся из startDate).
  const draftRef = useRef({ nodes, startDate, title: tripTitle });
  draftRef.current = { nodes, startDate, title: tripTitle };

  // Shape one AI city into the planner shape (coords + timezone) from an already
  // resolved gazetteer row `best`. Pure shaping — no network here.
  const shapeAiCity = (c, idx, best) => resolveCity({
    id: Date.now() + idx,
    external_city_id: best?.external_city_id || null,
    geonameid: best?.geonameid ?? null,
    name_i18n: best?.name_i18n || null,
    // Имя от ИИ выигрывает: его человек и видел в ответе бота.
    city_name: c.city_name || '',
    // English name kept for partner links (Stay22/Viator) and the directory:
    // prefer the AI's city_name_en, else the geocoder's canonical en name.
    city_name_en: c.city_name_en || best?.city_name_en || '',
    country: c.country || best?.country || '',
    country_code: (c.country_code || best?.country_code || '').toUpperCase(),
    latitude: best?.latitude ?? null,
    longitude: best?.longitude ?? null,
  }, lang);
  /* ⚠️ ДОВОДКА (имя страны из кода + таймзона из координат) НЕ ПИШЕТСЯ ЗДЕСЬ, а
     идёт общим шагом `cities/resolveCity` — тем же, что у пикеров. Нерезолвнутый
     город (ИИ назвал, справочник не нашёл) остаётся без таймзоны и координат,
     как при ручном вводе, и краснеет на шаге 2 — а не получает выдуманный UTC. */

  // Города из операций → ОДИН заход в газеттир, в порядке потребления
  // применятором (`citiesInOps` и `applyOps` обходят операции одинаково, это
  // запинено тестом). Не нашёлся — `null`, применятор возьмёт имя из операции.
  //
  // ★ ГОРОД МОЖЕТ ПРИЕХАТЬ С КЛЮЧОМ (TRIP-524), и это НЕ вторая дорога: ключ —
  // просто самая точная форма того же вопроса «резолвни этот город». Дверь одна
  // (`resolveCities`), и она сама берёт строку по ключу вместо поиска, когда
  // ключ есть. Модель выбирает город инструментом справочника, ВИДЯ кандидатов
  // вместе с регионом и координатами, — выбор по контексту маршрута резолверу
  // недоступен по построению: он видит одно имя и страну.
  const resolveOpCities = async (ops) => {
    const want = citiesInOps(ops);
    if (want.length === 0) return [];
    const lists = await resolveCities(want, lang || 'ru');
    return want.map((c, i) => {
      const best = lists[i]?.[0];
      return best ? shapeAiCity(c, i, best) : null;
    });
  };

  const planMut = useMutation({
    mutationFn: async ({ promptText }) => {
      const draft = draftRef.current;
      const { data, error: fnErr, code } = await invokeFn('planTripWithAi', {
        body: {
          sessionId, prompt: promptText, language: lang || 'ru',
          draft: toDraftPayload(draft.nodes, draft.startDate, draft.title),
        },
      });
      if (fnErr) {
        // Attach the machine `code` and throw the ORIGINAL error: invokeFn stamped
        // it __seamHandled, so MutationCache.onError won't double-report (a fresh
        // Error would lose the stamp). onError words it — the 429 rate-limit gets
        // domain copy, everything else goes through errorText (never raw prose).
        fnErr.code = code;
        throw fnErr;
      }
      return data;
    },
    onMutate: (vars) => {
      // `refine` — черновик уже был (повторный прогон), а не первая генерация.
      const refine = aiState === 'draft';
      const startedAt = nowMs();
      track('ai_plan_requested', { refine });
      setAiState('generating'); setError(null);
      // The prompt becomes an outgoing chat message (the composer clears itself).
      setAiMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', text: vars.promptText }]);
      return { refine, startedAt };
    },
    onSuccess: async (data, _vars, ctx) => {
      const out = data?.output || {};
      const ops = Array.isArray(out.ops) ? out.ops : [];
      const resolved = await resolveOpCities(ops);
      const r = applyOps(draftRef.current, ops, { cities: resolved, today: ymdLocal(new Date()) });
      setNodes(r.nodes);
      setStartDateRaw(r.startDate);
      setTripTitle(r.title);
      // Ответ бота = его текст. Снимка маршрута в сообщении нет: маршрут в
      // ленте один и живой (`PanelAi`, от `nodes`).
      setAiMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', text: out.ai_comment || '' }]);
      // Отказ применятора — расхождение с тем, что бот назвал сделанным. Человеку
      // под чужим текстом его не дописываем (TRIP-527, разбор с Pavel): это
      // сигнал для нас — в PostHog и в Sentry, с причинами и операциями.
      if (r.rejected.length) {
        track('ai_ops_rejected', { reasons: r.rejected.map((x) => `${x.op}:${x.reason}`) });
        Sentry.captureException(new Error('ai planner: ops rejected by applicator'), {
          tags: { feature: 'ai_planner' },
          contexts: { ops: { rejected: r.rejected, count: ops.length } },
        });
      }
      // «Далее» открыто, когда в маршруте есть город — независимо от того, был
      // ли последний ответ с операциями или просто разговором.
      const cityCount = cityNodesOf(r.nodes).length;
      setAiState(cityCount ? 'draft' : 'prompt');
      track('ai_plan_returned', {
        result: 'ok', refine: ctx?.refine, city_count: cityCount, duration_ms: elapsedMs(ctx?.startedAt),
        ops_applied: r.applied.length, ops_rejected: r.rejected.length, comment_only: ops.length === 0,
      });
    },
    onError: (err, _vars, ctx) => {
      setAiState(cities.length ? 'draft' : 'prompt');
      // TRIP-111: серверный rate-limit генераций → доменная копия; прочие отказы
      // словит errorText по машинному `code` (серверную прозу не показываем).
      const rateLimited = err?.context?.status === 429;
      const description = rateLimited
        ? t('ai_plan.error_rate_limited')
        : errorText(t, err?.code);
      // A bot bubble closes the turn so the outgoing message isn't left hanging; the
      // toast still carries the specific reason. Text is from i18n (never raw server prose).
      setAiMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', kind: 'error' }]);
      toast({ title: t('ai_plan.error_plan_title'), description, variant: 'destructive' });
      // duration отличает `error` от таймаута: вызов платный (n8n + LLM).
      track('ai_plan_returned', {
        result: rateLimited ? 'rate_limited' : 'error', refine: ctx?.refine,
        city_count: 0, duration_ms: elapsedMs(ctx?.startedAt),
      });
    },
  });
  const onGenerate = (promptText) => { if (promptText) planMut.mutate({ promptText }); };

  // The entry step's label depends on the method (origin vs AI prompt).
  const entryLabel = isAi ? t('planner.step_home_ai') : t('planner.step_home');
  /* ★ ШАГ ВОЗВРАТА ПРОПУСКАЕТСЯ ХОДОМ, НО НЕ ИСЧЕЗАЕТ ИЗ РЕЙЛА (TRIP-484).
     Финиш выбран на шаге городов -> спрашивать «чем закончим?» отдельным шагом
     значит переспрашивать решённое, и «Далее» через него перешагивает.
     ⚠️ НО УБИРАТЬ ЕГО ИЗ СПИСКА НЕЛЬЗЯ, И ЭТО НЕ ВКУС. Шаг — ЕДИНСТВЕННОЕ место,
     где финиш меняют («домой» / «останусь» / другой город). Пока он вычитался
     из `visibleSteps`, выбор становился НЕОБРАТИМЫМ: выбрал «останусь» — шаг
     исчез, плитка «финиш» в композере погасла (финиш уже есть), и поменять было
     нечем. Ступень остаётся в рейле и доступна тапом (`FlowProgress` пускает на
     пройденные), а «пропускается» относится к ходу, а не к существованию.
     Предикат — `hasExplicitEnd(nodes)`, то есть «узел `end` в списке ЕСТЬ».
     Молчаливого финиша не бывает (дефолт «домой» снят), поэтому и пропускать
     шаг у того, кто ничего не выбирал, нечему. */
  const finishDecided = hasExplicitEnd(nodes);
  const visibleSteps = STEPS
    .map(s => ({ ...s, label: s.id === 'home' ? entryLabel : t(s.labelKey) }));
  // Ход перешагивает решённую ступень в ОБЕ стороны — одним правилом, а не двумя.
  const stepAt = (from, dir) => {
    let i = from + dir;
    if (visibleSteps[i]?.id === 'return' && finishDecided && step !== 'return') i += dir;
    return visibleSteps[i] || null;
  };
  const goNext = () => {
    const next = stepAt(visibleSteps.findIndex(s => s.id === step), +1);
    if (next) setStep(next.id, 'next');
  };
  // `goPrev` удалён (TRIP-520): шаг назад делает история браузера (`nav(-1)` в
  // `requestBack`), а пройденная ступень уже лежит записью — своего кода нет.

  // Reset draft and go back to step 1
  const resetToStart = () => {
    // Возврат на шаг 1 через REPLACE (тем же единственным писателем): «назад» не
    // воскрешает стёртый шаг, а глубина СОХРАНЯЕТСЯ — сброс это действие внутри
    // шага, а не навигация, поэтому «назад» после него остаётся шагом (и лейбл
    // «Назад», а не ложный выход в никуда). `intent:'reset'` — чтобы аналитика
    // не слила сброс с восстановлением (оба REPLACE-ом).
    writeStep('home', { replace: true, intent: 'reset' });
    setNodes([]);
    setStartDateRaw(defaultStartISO());
    setTripTitle('');
    setCover({ cover_image_url: '' });
    setSavedOk(false);
    setSavedTripId(null);
    setError(null);
    // AI-entry reset — fresh transcript (back to the welcome) + a new n8n session.
    setAiMessages(isAi ? [{ id: 'welcome', role: 'assistant', kind: 'welcome' }] : []);
    setAiState(isAi ? 'prompt' : 'draft');
    setSessionId(crypto.randomUUID());
    removeDraft(user?.id, draftId);
  };

  // Маршрут (home/endNode/cities/finishCity/citiesValid) выведен из `nodes` выше,
  // у деривации шага. Автозаголовок читает те же узлы.
  const autoTitle = computeAutoTitle(home, cities, t);
  const totalNights = cities.reduce((n, c) => n + (Number(c.nights) || 0), 0);

  // ── Ручки записи маршрута ──────────────────────────────────────────────────
  // Шаги 1 и 3 пишут в ТОТ ЖЕ список, что шаг 2. Своих переменных у них больше
  // нет: «старт» и «финиш» — это узлы, а не состояния шагов.
  const setHome = (city) => setNodes(ns => {
    const rest = ns.filter(n => n.kind !== 'start');
    if (!city?.city_name) return rest;
    return insertNode(rest, makeNode(city, 'start')) || rest;
  });
  // Снять финиш = удалить узел. Метить и размечать больше нечего, поэтому и
  // «останусь», и «сейчас выберу другой город» — ОДНА запись: узла нет.
  const clearFinish = (ns) => ns.filter(n => n.kind !== 'end');
  const setFinishCity = (city) => setNodes(ns => {
    const rest = clearFinish(ns);
    if (!city?.city_name) return recomputeDates(rest, startDate);
    return recomputeDates(insertNode(rest, makeNode(city, 'end')) || rest, startDate);
  });
  // «Останусь в X» и «сейчас выберу другой» — одно и то же состояние МОДЕЛИ
  // (финиша нет); различаются они только видом карточки на шаге, и этот вид —
  // локальный флаг шага, а не факт маршрута.
  const clearFinishNode = () => setNodes(ns => recomputeDates(clearFinish(ns), startDate));

  // Map tooltip lookup: id → { lng, lat, countryCode, name, dates }, keyed by NODE
  // id — тем же, которым карта (`MapView`, общий с трипом) адресует пины. Даты — у
  // городов (start..start+nights, один день у пересадки); якоря — только имя.
  const mapPointById = useMemo(() => {
    const m = {};
    nodes.forEach((n) => {
      if (n.latitude == null) return;
      m[String(n.id)] = { lng: n.longitude, lat: n.latitude, countryCode: n.country_code, name: n.city_name, dates: isAnchorNode(n) ? null : cityDateRange(n, lang) };
    });
    return m;
  }, [nodes, lang]);
  // The tooltip follows the hovered pin/row, otherwise the selected one.
  const activeMapId = hoveredMapId || selectedMapId;
  const cityBadge = activeMapId ? mapPointById[activeMapId] || null : null;
  // Clear map selection/hover on step change: a pin drawn on one step (e.g. the
  // return pin, only shown on return/review) must not leave a tooltip floating at
  // its coordinate once the step no longer renders it.
  useEffect(() => { setHoveredMapId(null); setSelectedMapId(null); }, [step]);
  // Шаг сменился — композеров на нём больше нет, и счёт не должен пережить уход:
  // иначе «Далее» осталось бы выключенным на следующем шаге. (Уборка эффекта
  // тоже отсчитает своё, но обнуление здесь — не дубль, а гарантия: считает
  // шаг, и обнулить счёт при смене того, что считается, обязан он.)
  useEffect(() => { setComposingCount(0); }, [step]);

  // ── Supabase save ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;

    const title = (tripTitle || autoTitle).trim();
    // Pre-flight validation
    if (cities.length === 0) {
      setError(t('planner.err_no_cities'));
      return;
    }
    if (!startDate || !cities[0]?.startDate) {
      setError(t('planner.err_no_date'));
      return;
    }
    if (!title) {
      setError(t('planner.err_no_title'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // 1. Полезная нагрузка маршрута — ОДНА проекция списка узлов
      // (`create/routeModel.toCitiesPayload`). Даты здесь не считаются: их кладёт
      // СЕРВЕР (`create_trip_with_route` → `recompute_trip`), тем же движком, что
      // и живое редактирование. Правило «якорь едет без ночей» живёт в модели и
      // запинено тестом — здесь его копии нет; финиша по умолчанию нет вовсе,
      // маршрут без узла `end` кончается последним городом.
      const citiesPayload = toCitiesPayload(nodes);

      // Atomic create through the single door (TRIP-406): trips + city_visits +
      // recompute in one transaction. The seam authenticates (JWT), gates the
      // free/Pro limit (trip_quota → honest 402 TRIP_LIMIT_REACHED), and stamps
      // created_by = actor — the client sends neither the owner nor the dates. A
      // refusal is a generic code → errorText (never raw server prose, TRIP-378).
      const { data: newTripId, error: createErr, code } = await invokeFn('trip/create', {
        body: { title, startDate, cities: citiesPayload },
      });
      if (createErr) throw refusalError(code);
      const trip = { id: newTripId };

      // 2. Persist the uploaded cover photo (if any). create_trip_with_route
      // doesn't accept cover fields; trips is Ярус B (TRIP-190) — no direct client
      // write — so the cover goes through the updateTripSettings edge (declared
      // Storage boundary: the file lands before tripId exists, re-homed after).
      // Без фото сохранять нечего: обложки нет → рендерится фоллбек-картинка
      // (градиентов больше нет, cover_image_url остаётся null).
      if (cover?.cover_image_url) {
        // Cover was uploaded before the trip existed (draft prefix) — move it
        // under <tripId>/ and re-sign before persisting the URL.
        const finalCoverUrl = await finalizeDraftCover(trip.id, cover.cover_image_url);
        const { error: coverErr } = await invokeFn('trip-settings/settings', {
          body: {
            tripId: trip.id,
            fields: {
              cover_image_url: finalCoverUrl,
            },
          },
        });
        // Обложка не критична: трип уже создан, а обложку можно поменять в
        // настройках, - поэтому отказ НЕ роняет создание. Но и молчать нельзя:
        // раньше отказ уходил только в консоль, и человек оставался с трипом без
        // выбранной им обложки, не зная, что её не сохранили. Ветка `!data?.ok`
        // тут не нужна: после TRIP-378 отказ - настоящий не-2xx, то есть `coverErr`.
        if (coverErr) {
          console.error('Failed to set cover:', coverErr);
          toast({ description: t('planner.err_cover_not_saved'), variant: 'warning' });
        }
      }

      // Transfers and activities are intentionally NOT created at trip-creation
      // time. The "Транспорт" step was removed; the timeline shows a "Нет
      // переезда" affordance. AI now returns a cities-only skeleton (no
      // activities) - both are added later in the trip view / Edit Mode.

      removeDraft(user?.id, draftId);
      // Creating a trip raises the active-trip count — drop the limit gate cache
      // too, so a follow-up create reads the fresh (at-cap) count, not a stale 0.
      invalidateActiveTripsLimit(qc);
      // "first trip ever" is derived in PostHog from the user's first trip_created
      // event (authoritative history) — the client trips cache is unreliable here
      // (may be unloaded, and includes trips the user only participates in).
      track('trip_created', { method, city_count: citiesPayload.length, trip_id: trip.id });
      setSavedOk(true);
      setSavedTripId(trip.id);
      // ★ ПРОГРЕВ КЭША — В МОМЕНТ СОЗДАНИЯ, А НЕ В МОМЕНТ НАЖАТИЯ. Экран успеха
      // человек читает секунду-другую; это и есть окно, в которое влезают оба
      // запроса трипа. К нажатию «Открыть трип» записи уже в кэше и свежие
      // (staleTime 30s), поэтому TripView рисует редактор ПЕРВЫМ кадром — без
      // скелетона рейла и без скелетона редактора, то есть шов не виден.
      //
      // Запрос собирает ДЕСКРИПТОР, а не этот экран: `include` тут не называется
      // вовсе, поэтому прогретая запись гарантированно той же формы, что и
      // запрос самого TripView (TRIP-277 — прогрев чужой формой обнулил бы
      // бюджет ровно так же, как это делал прежний второй читатель).
      //
      // Fire-and-forget и БЕЗ await: экран успеха обязан появиться сразу, а
      // отказ прогрева ничего не ломает — TripView сходит за данными сам, как
      // ходил всегда. `prefetchQuery` ошибку не пробрасывает.
      qc.prefetchQuery(tripShellQuery(trip.id));
      qc.prefetchQuery(tripContentQuery(trip.id));
      // Тот же прогрев — для КОДА экрана: TripView едет отдельным чанком
      // (TRIP-445), и без этого первый вход в трип за сессию ждал бы его под
      // Suspense. Vite склеивает динамические импорты одного модуля в один чанк.
      // Ошибку глотаем намеренно (как в `prefetchZoneNeighbours` сайтовой зоны):
      // предзагрузка — ускорение, а не функция, и упавший чанк обязан молчать
      // здесь, а не всплывать необработанным реджектом — за экран отвечает
      // Suspense самого TripView.
      import('@/pages/TripView').catch(() => {});
    } catch (err) {
      console.error('Failed to save trip:', err);
      track('trip_create_failed', { method, reason: err?.message || 'unknown' });
      // refusalError несёт машинный `code` (message = сам код) → словим текст
      // через errorText; серверную/сырую прозу не показываем (TRIP-378/423).
      setError(errorText(t, err?.code));
    } finally {
      setSaving(false);
    }
  };

  // ── Footer (single, lifted out of the steps) ───────────────────────────────
  // One Back / Reset / Next|Save bar pinned to the bottom of the right card,
  // driven by a per-step descriptor. The step bodies no longer carry their own
  // footer; the gating (Next disabled, Save spinner) lives here and stays
  // identical to the old per-step logic.
  const stepIdx = Math.max(0, visibleSteps.findIndex((s) => s.id === step));
  const isFirstStep = stepIdx === 0;
  // `citiesValid` выведен выше, у деривации шага (нужен нормализации адреса).
  const hasDraftData = !!home?.city_name || cities.length > 0 || !!finishCity?.city_name;

  // Reset asks for confirmation only when there's something to lose.
  const requestReset = async () => {
    if (hasDraftData) {
      const ok = await confirm({
        title: t('planner.reset_confirm_title'),
        description: t('planner.reset_confirm_desc'),
        confirmLabel: t('planner.reset'),
        variant: 'destructive',
      });
      if (!ok) return;
    }
    resetToStart();
  };

  // ── Одна «назад» на все двери (TRIP-520) ───────────────────────────────────
  // Переписка с ботом — тоже работа, и она стоила денег: без второго слагаемого
  // неудачная генерация «работой» не считается.
  // После сохранения терять нечего: уход из флоу не спрашивает.
  const hasWork = !savedOk && (hasDraftData || (isAi && aiMessages.length > 1));
  // Уход из флоу спрашивает, переход между шагами — нет. Один гейт на все девять
  // дверей; механика конфирма — та же, что у `requestReset`.
  const confirmLeave = async () => !hasWork || await confirm({
    title: t('planner.leave_confirm_title'),
    description: t('planner.leave_confirm_desc'),
    variant: 'destructive',
  });
  // Глубина текущей записи истории решает, «назад» это шаг или выход (а не
  // `isFirstStep`: он врёт после прыжка по рейлу на home и на прямом заходе по
  // `?step=`). `savedOk` глушит глубину: у успеха «назад» всегда выход на `/trips`.
  const backDepth = savedOk ? 0 : (location.state?.depth ?? 0);
  // Тултип/aria стрелки честны к тому, что она делает: на дне флоу — выход «К
  // коллекции», глубже — «Назад» (шаг). Иначе скринридер объявлял бы «К
  // коллекции» для кнопки, делающей шаг назад (item 5 ревью).
  const backLabel = backDepth > 0 ? t('planner.back') : t('notif.to_collection');
  const requestBack = async () => {
    if (savedOk) return nav('/trips');
    const action = resolveBack({ depth: backDepth, enteredByPush });
    if (action === 'step') return nav(-1);          // шаг назад внутри флоу, без конфирма
    if (!(await confirmLeave())) return;             // выход — спрашиваем, если есть что терять
    return action === 'exit-history' ? nav(-1) : nav('/trips');
  };

  // ── Оболочка (TripShell, TRIP-520) ──────────────────────────────────────────
  // Визард — экран трипа, у которого трипа ещё нет: шапку, рейл и шелл карты
  // рисует общая оболочка, сюда уходят факты. «Назад» — своё действие визарда
  // (шаг истории с конфирмом ухода внутри), поэтому едет колбэком целиком.
  // Экран лимита/проверки лимита поверхности не объявляет — карты там нет.
  const blocked = !savedOk && (isOverLimit || (!isPro && checkingLimit));
  useShellFacts(
    { mode: 'create', title: isAi ? t('planner.step_home_ai') : t('trips.new'), backTitle: blocked ? t('notif.to_collection') : backLabel },
    { onBack: blocked ? () => nav('/trips') : requestBack, confirmLeave },
  );
  // Поверхность карты: конфиг шелла (детент/свёрнутость — состояние ЭКРАНА: шаг
  // может осознанно опустить шит) и пропы общего `MapView`. Узлы маршрута едут в
  // карту КАК ЕСТЬ (тот же вид, что у визитов трипа: `kind`/координаты/id), без
  // переездов — все плечи пунктирные, транспорт добавляется уже в трипе.
  useShellSurface(
    blocked ? null : {
      panelLabel: t('trips.new'),
      detent, onDetentChange: setDetent,
      collapsed, onCollapsedChange: setCollapsed,
      collapseLabel: t('common.panel_collapse'), expandLabel: t('common.panel_expand'),
    },
    {
      visits: nodes, transfers: NO_TRANSFERS,
      // Контролы поверх карты: проекция + тема. Старт-финиша здесь НЕТ (решение
      // Pavel): в создании маршрута дом и финиш — то, что пользователь прямо сейчас
      // выбирает, прятать их нечем и незачем. Открывается на глобусе (TRIP-337).
      mapControls: MAP_CONTROLS, initialProjection: 'globe',
      // Карта — основная поверхность экрана: гейта «двумя пальцами» тут нет.
      cooperativeGestures: false,
      colorScheme: isDark ? 'DARK' : 'LIGHT',
      hoveredVisitId: hoveredMapId, selectedVisitId: selectedMapId, cityBadge,
      // Двусторонняя связка с рядами шага: карта отдаёт узлы под пином, ряды
      // держат id. Повторный клик по тому же пину снимает выбор; клик по пустой
      // карте — тоже (общее поведение всех карт).
      onCityHover: (pts) => { const v = cityUnderPin(pts); setHoveredMapId(v ? String(v.id) : null); },
      onCityClick: (pts) => { const v = cityUnderPin(pts); if (v) setSelectedMapId((cur) => (cur === String(v.id) ? null : String(v.id))); },
      onMapClick: () => setSelectedMapId(null),
    },
  );

  // ── Экран успеха — ТЕРМИНАЛЬНОЕ состояние, не шаг (TRIP-520) ────────────────
  // `savedOk` живёт в памяти визарда, а не в адресе: пока визард смонтирован,
  // «назад» по записям шагов меняет `?step=`, но рисуется по-прежнему успех —
  // форма «Создать» над созданным трипом не оживает ни на одном шаге. Рисуется
  // он В ТОЙ ЖЕ ОБОЛОЧКЕ, что и шаги (карта + панель/шит + прогресс): успех —
  // финал флоу, а не отдельная страница; своя обвязка (AppHeader на пустом
  // листе) была регрессом облика. Ниже он входит в BODY, а не ранним return.

  // ── Limit guard ───────────────────────────────────────────────────────────
  // The guard gates ENTERING / continuing creation while a free user is at the
  // cap — it must NOT override the terminal success screen. Saving the trip
  // raises the active count and invalidates the limit cache (see above), so the
  // refetch flips isOverLimit→true a moment after savedOk. Without `!savedOk`
  // the success screen would be replaced by the "limit reached" blocker a second
  // after it appears. savedOk can only be true if the user was UNDER the limit
  // at save time (the blocker returns before the form), so suppressing it here is
  // safe by construction.
  // Шапка и рейл здесь — от оболочки (факты опубликованы выше); экран рисует
  // только своё содержимое в теле. Условие — тот же `blocked`, которым снята
  // поверхность: ответ про лимит ещё едет — спиннер, приехал и лимит выбран —
  // заглушка (порядок ветвей тот же, что был у двух отдельных return'ов).
  if (blocked) {
    if (!isPro && checkingLimit) {
      return (
        <div className="row row--j-center">
          <div className="spin spin--ring spin--xl" />
        </div>
      );
    }
    return (
      <div className="row row--j-center">
        <EmptyState
          icon="lock"
          kind="warning"
          title={t('planner.limit_title')}
          body={<>{t('planner.limit_desc_pre')} <strong>{t('planner.limit_desc_strong')}</strong>{t('planner.limit_desc_post')}</>}
          action={(
            <>
              <Btn variant="secondary" onClick={() => nav('/trips')}>{t('planner.to_trips')}</Btn>
              <Btn variant="primary" onClick={() => goPro(nav, { hidePerTrip: true, from: 'paywall', feature: 'trip_limit' })}>{t('sub.go_pro')}</Btn>
            </>
          )}
        />
      </div>
    );
  }

  let primaryLabel = t('planner.next');
  let primaryAction = goNext;
  let primaryDisabled = false;
  let showFooter = true;
  // On the AI entry step the primary CTA is the AI gradient button (design A6),
  // not the brand primary — keeps the whole AI screen on the --ai layer.
  let primaryVariant = (step === 'home' && isAi) ? 'ai' : 'primary';
  if (step === 'home') {
    // Origin is OPTIONAL now (can be added on step 2 or later from the timeline);
    // the trip start DATE is the only hard requirement of the manual entry step.
    primaryDisabled = isAi ? aiState !== 'draft' : !startDate;
    // Make the optionality discoverable: with no origin picked the primary CTA
    // reads "Пропустить" (not "Дальше"), so the user knows the step is skippable.
    if (!isAi && !home?.city_name) primaryLabel = t('planner.skip');
    // AI-вход: отдельного футер-ряда нет — Reset убран, а «Далее» слито в кнопку
    // композера (пусто → Далее, есть текст → Отправить). Так внизу один ряд.
    if (isAi) showFooter = false;
  } else if (step === 'cities') {
    primaryDisabled = !citiesValid || composing;
  } else if (step === 'review') {
    primaryLabel = saving ? t('planner.saving_btn') : t('planner.save_trip');
    primaryAction = handleSave;
    primaryDisabled = saving;
  }
  if (savedOk) showFooter = false; // успех владеет своими действиями, шаг адреса не важен

  // ── Main render ───────────────────────────────────────────────────────────
  // Содержимое панели разложено по слотам шелла: ШАПКА (прогресс) всегда на
  // виду — по ней читается шаг даже у опущенного шита; ТЕЛО скроллится; ФУТЕР с
  // действиями шага стоит вне скролла, иначе кнопка «Далее» уезжает вместе со
  // списком ровно тогда, когда она нужна.
  const BODY = (
    // `.flow-lp-b` — типографский контекст шага (ритм заголовков/подзаголовков),
    // а не раскладка: раскладку и скролл держит тело шелла.
    <div className="flow-lp-b">
      {/* Успех ЗАМЕЩАЕТ шаг, а не встаёт над ним, поэтому шаги — вторая ветка
          одной развилки: условие `savedOk` названо ОДИН раз, и ни один шаг не
          может забыть его повторить. */}
      {savedOk ? (
        <EmptyState
          art="trip-created"
          kind="success"
          title={t('planner.created_title')}
          body={t('planner.created_desc', { title: tripTitle || autoTitle, cities: cities.length, citiesWord: pluralize(t, cities.length, 'trip.cities_count', lang), nights: totalNights, nightsWord: pluralize(t, totalNights, 'view.nights', lang) })}
          action={(
            <>
              {/* Ведёт в СЕКЦИЮ РЕДАКТОРА (маршрут только собран, дальше брони);
                  `?lens=` пишем адресом. Чанк TripView и его запросы прогреты при
                  сохранении, переход идёт транзишном роутера в ТОЙ ЖЕ оболочке:
                  рейл, шапка, панель и карта живут дальше, а вход оболочка
                  распознаёт сама по смене режима (`data-entering`). */}
              <Btn variant="primary" onClick={() => savedTripId && nav(`/trip/${savedTripId}?lens=route`)}>{t('planner.open_trip')}</Btn>
              <Btn variant="secondary" onClick={() => nav('/trips')}>{t('notif.to_collection')}</Btn>
            </>
          )}
        />
      ) : (
        <>
          {step === 'home' && (isAi ? (
            <PanelAi aiMessages={aiMessages} onGenerate={onGenerate} nodes={nodes} />
          ) : (
            <StepHome home={home} setHome={setHome} startDate={startDate} setStartDate={setStartDate} />
          ))}
          {step === 'cities' && (
            <StepCities nodes={nodes} setNodes={setNodes} startDate={startDate} setStartDate={setStartDate} hoveredId={hoveredMapId} selectedId={selectedMapId} onHover={setHoveredMapId} onComposingChange={onComposingChange} />
          )}
          {step === 'return' && (
            <StepReturn
              home={home}
              lastCityName={lastCity?.city_name || t('planner.last_city_fallback')}
              endNode={endNode}
              onFinishHome={() => setFinishCity(home)}
              onFinishCity={setFinishCity}
              onClearFinish={clearFinishNode}
            />
          )}
          {step === 'review' && (
            <StepReview
              home={home}
              cities={cities}
              finishCity={finishCity}
              cover={cover}
              setCover={setCover}
              tripTitle={tripTitle}
              setTripTitle={setTripTitle}
              saving={saving}
              error={error}
            />
          )}
        </>
      )}
    </div>
  );
  // ★ КОМПОЗЕР — В СЛОТЕ ДЕЙСТВИЙ, А НЕ В ТЕЛЕ. Тело виджета СКРОЛЛИТСЯ, и всё,
  // что лежит в нём, уезжает вместе с лентой: замерено — на диалоге в 12 реплик
  // поле ввода оказывалось на 1300 px ниже видимой полосы, то есть чтобы
  // ответить боту, надо было сначала домотать до конца разговора. Слот действий
  // для того и заведён: он стоит СНАРУЖИ скролла и держит док снизу.
  // На AI-шаге кнопок шага нет (`showFooter === false`) — «Далее» слита в сам
  // композер, — поэтому слот занимает он один, а не они вдвоём.
  // После сохранения слот пуст: успех владеет своими действиями (см. `showFooter`).
  const FOOTER = (step === 'home' && isAi && !savedOk) ? (
    <ChatComposer
      className="chat-composer--ai"
      hideMention
      onSend={onGenerate}
      disabled={aiState === 'generating'}
      isThinking={aiState === 'generating'}
      placeholder={aiMessages.length > 1 ? t('ai_plan.prompt_placeholder_refine') : t('ai_plan.prompt_placeholder_initial')}
      /* Слитая кнопка: пусто → «Далее» (переход к шагу 2, доступен когда бот
         собрал черновик), есть текст → «Отправить». Gate тот же, что был у
         футер-кнопки Next на AI-шаге (aiState==='draft'). */
      nextAction={goNext}
      nextLabel={t('planner.next')}
      nextDisabled={aiState !== 'draft'}
    />
  ) : (
    <>
      {showFooter && (
        <div className="lp-f flow-foot">
          {/* Видимость футерной «Назад» — по ГЛУБИНЕ истории (как её действие),
              а не по `isFirstStep` (адрес): иначе на прыжке рейлом на home кнопка
              пряталась бы, хотя шаг назад есть. Тот же разлом «я в начале», что
              порождал блокер 1. */}
          {backDepth > 0 && <Btn variant="secondary" onClick={requestBack} disabled={saving}>{t('planner.back')}</Btn>}
          {/* Reset is a VISIBLE, low-emphasis text button here (not a hidden
              icon in the header) — nav actions all live in the action bar. На
              AI-шаге футера нет (его место занимает композер), там сброс стоит
              в шапке панели рядом с прогрессом. */}
          {!isFirstStep && <Btn variant="quiet" icon="refresh" onClick={requestReset} disabled={saving}>{t('planner.reset')}</Btn>}
          <div className="flow-foot__spacer grow" />
          <Btn variant={primaryVariant} onClick={primaryAction} disabled={primaryDisabled}>{primaryLabel}</Btn>
        </div>
      )}
    </>
  );

  // ★ ВСЁ СОДЕРЖИМОЕ — В СЛОТЫ ОБОЛОЧКИ. Своей разметки страницы у визарда нет:
  // шапка/рейл/шелл карты — у `TripShell`, карта — общий `MapView` (пропы
  // опубликованы выше). Здесь только то, что принадлежит шагу: прогресс в шапке
  // панели, тело, футер с действиями, круглая «назад» над картой (телефон, где
  // шапки нет) и пилюля статуса.
  return (
    <>
      <ShellSlot name="panelHead">
        <div className="flow-lp-h">
          {/* grow--fit (flex:1 + min-width:0) so the progress can shrink and its
              "next" hint wraps INSIDE this column instead of overflowing and
              shoving the reset control off the narrow mobile sheet header. */}
          <div className="grow--fit">
            <FlowProgress
              steps={visibleSteps}
              current={savedOk ? visibleSteps.length - 1 : stepIdx}
              accent={isAi ? 'var(--ai)' : 'var(--brand)'}
              onJump={savedOk ? undefined : (i) => setStep(visibleSteps[i].id, 'jump')}
            />
          </div>
          {/* Сброс на AI-шаге (TRIP-527): футер здесь занят композером, а
              переписка уже могла собрать маршрут, который хочется стереть.
              Та же ручка `requestReset` (с подтверждением), что у футера
              остальных шагов — второго сброса нет. */}
          {isAi && step === 'home' && !savedOk && (
            <IconBtn icon="refresh" tone="outline" ariaLabel={t('planner.reset')} onClick={requestReset} disabled={saving} />
          )}
        </div>
      </ShellSlot>
      <ShellSlot name="panelBody">{BODY}</ShellSlot>
      <ShellSlot name="panelFoot">{FOOTER}</ShellSlot>
      <ShellSlot name="mapOverlay">
        {/* Floating round back control — shown only on the phone shell (the app
            header is off-screen there); the canon `.map-back` position/visibility
            live in CSS. */}
        <IconBtn
          className="map-back"
          icon="back"
          round
          tone="outline"
          ariaLabel={backLabel}
          onClick={requestBack}
        />
      </ShellSlot>
      {/* Пилюля «N городов · M ночей» — в полосе статуса шелла: он её меряет и
          отдаёт кадру как закрытое снизу, чтобы нижний город не уезжал под неё. */}
      <ShellSlot name="status">
        {totalNights > 0 && (
          <>
            <b>{cities.length}</b> {pluralize(t, cities.length, 'trip.cities_count', lang)}
            <span className="muted-2">·</span>
            <b>{totalNights}</b> {pluralize(t, totalNights, 'view.nights', lang)}
          </>
        )}
      </ShellSlot>
    </>
  );
}
