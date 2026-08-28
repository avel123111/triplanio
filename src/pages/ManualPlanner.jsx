import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '@/lib/analytics';
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
import CountryFlag from '@/components/common/CountryFlag';
import { tzFromCoords } from '@/lib/timezone';
import { haversineKm } from '@/lib/trip-stats';
import { localizeCountry } from '@/lib/i18n/format';
import { layoutDates } from '@/lib/tripDates';
import { Icon } from '../design/icons';
import { Badge, Btn, Card, EditableText, EmptyState, IconBtn, Severity, Tile, useToast } from '../design/index';
import CityRowBase from '@/components/trip/CityRow';
import NightsStepper from '@/components/trip/NightsStepper';
import TripStartControl from '@/components/trip/TripStartControl';
import AppHeader from '@/components/AppHeader';
import TripCoverPicker from '@/components/trips/TripCoverPicker';
import { finalizeDraftCover } from '@/lib/coverStorage';
import FlowProgress from '@/pages/create/FlowProgress';
import FlowMap from '@/pages/create/FlowMap';
import { MapShell } from '@/design/index';
import PanelAi from '@/pages/create/PanelAi';
import ChatComposer from '@/components/chat/ChatComposer';
import { CityPicker, CityAnchorRow } from '@/pages/create/anchors';
import { useRouteDnD } from '@/lib/useRouteDnD';
import { useConfirm } from '@/components/common/ConfirmProvider';
// StartCalendar / Popover / Sheet / DateTime are now encapsulated in the shared TripStartControl.

// Whole days between two ISO date strings (b - a). 0 on bad input.
function daysBetweenISO(a, b) {
  if (!a || !b) return 0;
  const da = new Date(a + 'T00:00:00');
  const db = new Date(b + 'T00:00:00');
  if (isNaN(da) || isNaN(db)) return 0;
  return Math.round((db - da) / 86400000);
}

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

// Storage key is user- and method-specific so the manual and AI drafts don't
// leak into each other (the same flow component serves both routes).
// `-v2-`: the draft shape changed (returnMode/returnCity/finalPoint → single `end`
// node). Bumping the key invalidates any old-shape draft still in sessionStorage
// instead of shipping a one-off migration mapper for a minutes-lived cache.
const storageKey = (userId, method = 'manual') => `triplanio-planner-v2-${method}-${userId || 'guest'}`;

// Same physical city (external directory id / geonameid, else name — тёзки-города в
// разных странах ≠ один город). Used by StepReturn to decide which return card looks
// active (cosmetic only — not part of the finish derive).
function sameCity(a, b) {
  if (!a?.city_name || !b?.city_name) return false;
  if (a.external_city_id != null && b.external_city_id != null) return a.external_city_id === b.external_city_id;
  if (a.geonameid != null && b.geonameid != null) return a.geonameid === b.geonameid;
  return a.city_name === b.city_name;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Local YYYY-MM-DD (NOT toISOString - that converts to UTC and, in positive
// timezones, shifts the date back a day, which broke the ±1-day stepper).
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return ymdLocal(d);
}

function shortDateLabel(iso, locale = 'ru') {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return '';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' }).format(d);
  }
}

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

// A 0-night stop is a same-day layover/waypoint (mirrors the editor's
// kind:'waypoint') — one predicate, so the row, the map pin and the save payload
// can't drift on what counts as a waypoint.
function isPlannerWaypoint(city) {
  return (+city.nights || 0) === 0 && !!city.city_name;
}

// City date-range label "1 июл – 5 июл" (a single day for a 0-night waypoint), or
// null when the trip start isn't set yet. Shared by the city row and the map
// tooltip so both read identically.
function cityDateRange(city, lang) {
  const nights = +city.nights || 0;
  const start = city.startDate ? shortDateLabel(city.startDate, lang) : null;
  const end = (city.startDate && nights) ? shortDateLabel(addDays(city.startDate, nights), lang) : null;
  return start ? (end ? `${start} – ${end}` : start) : null;
}

function recomputeDates(list, anchorISO) {
  // Chain anchor = the STABLE trip-start date (the top "Старт" control), NOT the
  // current first element's date. Mirrors the editor, which anchors on the start
  // anchor's own start_date (TripStructureEdit: layoutDates(..., d.startDate)) —
  // a value independent of city order. Deriving the anchor from list[0] re-anchored
  // the whole chain to whatever city was dragged to the top / left after deleting
  // the first one (TRIP-216). Fallback to list[0].startDate keeps callers that don't
  // yet have a trip start working; bail only when there's no anchor at all.
  const base = anchorISO || list[0]?.startDate;
  if (list.length === 0 || !base) return list;
  // Pre-creation planner cities are a flat nights-only chain (no transfers yet → no
  // gap, no waypoints/anchors). Adapt to the shared canonical layout (lib/tripDates,
  // mirroring server recompute_trip) so the planner and the editor produce identical
  // dates on identical input — one date engine, no second implementation.
  // Dates come purely from `base` + each city's nights (layoutDates walks a cursor);
  // the per-node start_date seed is unused here, so it's omitted.
  const nodes = list.map((c) => ({ kind: 'transit', nights: +c.nights || 0, gap: 0 }));
  const laid = layoutDates(nodes, base);
  // Lay out EVERY city (index 0 too) from the anchor: layoutDates puts city 0 back
  // on `base`, so no stale first-city date can leak through after a reorder.
  return list.map((c, i) => ({ ...c, startDate: laid[i].start_date }));
}

// CityPicker + CityAnchorRow live in ./create/anchors (shared by the planner
// steps and the AI panel — one picker/anchor, no circular import).

// ─── CityRow ──────────────────────────────────────────────────────────────────

// City row built from the EDITOR's primitives (.te-row / .te-grip / .te-row__num /
// .te-citycell / .te-cityname / .te-dts + <Stepper> nights) so the planner route
// looks and behaves identically to the structural editor — same bold city
// names, same nights stepper, same lift-on-drag. No bespoke steppers/fonts. The
// final-point toggle lives once in StepCities (not per row).
// Planner route row. Owns its editing state + pick/remove/nights handlers, then
// delegates LAYOUT to the shared <CityRowBase> (variant="planner") so the planner
// list and the structural editor render the SAME row skeleton — one component,
// two variants. The trailing actions (nights stepper + delete) are the only
// per-screen difference; the final-point toggle still lives on the last card.
function CityRow({ idx, city, isDragging, isPressing, active = false, onArm, onChange, onRemove, onMove }) {
  const t = useT();
  const { lang } = useI18n();
  const invalid = !!city.city_name && city.latitude == null;
  const nights = +city.nights || 0;
  // 0 nights = a layover/waypoint (same-day stop) — mirrors the editor: dashed
  // transfer-tinted node + a "Пересадка" badge instead of a nights range.
  // (predicate + date range come from the shared helpers above)
  const isWaypoint = isPlannerWaypoint(city);
  const dateRange = cityDateRange(city, lang);
  // Empty rows open in the picker; once a city is chosen it shows read-only
  // (change a city by deleting + re-adding) so it can never get stuck as an input.
  const [editing, setEditing] = useState(!city.city_name);
  // Confirm-on-add: a search result is STAGED (shown in the field) and only
  // written into the plan when the user taps "Добавить" — an accidental tap on a
  // search result no longer commits a city.
  const [staged, setStaged] = useState(null);
  const stopArm = (e) => e.stopPropagation();

  const cityFields = (p) => ({ city_name: p.city_name, city_name_en: p.city_name_en, geonameid: p.geonameid ?? null, name_i18n: p.name_i18n || null, country: p.country || localizeCountry(p.country_code, lang), country_code: p.country_code, latitude: p.latitude, longitude: p.longitude, timezone: p.timezone, external_city_id: p.external_city_id });
  // Picking a result stages it (typing again clears the stage); confirm commits.
  const onSearchPick = (picked) => setStaged(picked || null);
  const confirmStaged = () => {
    if (!staged) return;
    onChange(cityFields(staged));
    setStaged(null);
    setEditing(false);
  };

  const grip = (
    <span className="te-grip" role="button" tabIndex={0} aria-label={t('planner.drag')} title={t('planner.drag')}
      onClick={stopArm}
      onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); onMove(-1); } else if (e.key === 'ArrowDown') { e.preventDefault(); onMove(1); } }}>
      <Icon name="drag" size={14} />
    </span>
  );
  const lead = isWaypoint
    ? <Tile as="span" className="te-row__node" style={{ '--hl-soft': 'transparent', '--hl-ink': 'var(--ev-transfer)', border: '1px dashed var(--ev-transfer)' }}><Icon name="arrowSwap" size={11} /></Tile>
    : <Tile as="span" className={'te-row__num' + (invalid ? ' is-warn' : '')}>{idx + 1}</Tile>;
  const dates = isWaypoint
    ? <><Badge size="tiny">{t('tse.layover')}</Badge>{dateRange}</>
    : dateRange;

  return (
    <CityRowBase
      variant="planner"
      // `is-editing` collapses the grip + number columns so the search field (and
      // its dropdown) spans the whole row — no longer cramped by the stepper/icon.
      // `is-hover` mirrors the map pin's hover/selected state (Map-lens parity).
      className={[editing ? 'is-editing' : '', active ? 'is-hover' : ''].filter(Boolean).join(' ')}
      dragging={isDragging}
      pressing={isPressing}
      invalid={invalid}
      onArm={onArm}
      stopCellPointer={editing}
      grip={grip}
      lead={lead}
      name={editing ? undefined : city.city_name}
      country={editing ? undefined : city.country}
      dates={editing ? undefined : dates}
      editingSlot={editing
        ? <CityPicker value={staged || (city.city_name ? city : null)} onChange={onSearchPick} placeholder={t('planner.city_ph')} autoFocus />
        : undefined}
    >
      {editing ? (
        // Icon-only primary button (canon <Btn>, no text) attached at the end of the
        // search field — full-height control, so it's a proper tap target on mobile
        // without being oversized. Wrapped so the row's pointerdown doesn't arm a drag
        // (Btn does not forward onPointerDown).
        <span onPointerDown={stopArm}>
          <Btn variant="primary" icon="check" ariaLabel={t('common.add')} title={t('common.add')} disabled={!staged} onClick={(e) => { e.stopPropagation(); confirmStaged(); }} />
        </span>
      ) : (
        <NightsStepper
          value={nights}
          onMinus={() => onChange({ nights: Math.max(0, nights - 1) })}
          onPlus={() => onChange({ nights: Math.min(30, nights + 1) })}
          minusDisabled={nights <= 0}
          plusDisabled={nights >= 30}
        />
      )}
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
          // Localize country from country_code like CityPicker does — mapGazCity
          // leaves country=null, but the review row + payload expect a country name.
          setCandidates(found.map((c) => ({
            ...c,
            country: c.country || localizeCountry(c.country_code, lang),
            timezone: tzFromCoords(c.latitude, c.longitude),
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
          <CityPicker value={home} onChange={setHome} placeholder={t('planner.start_city_ph')} blurOnPick />
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
                  <div className="muted t-meta"><CountryFlag code={c.country_code} /> {c.country} · {distLabel}</div>
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

function StepCities({ cities, setCities, home, setHome, startDate, setStartDate, hoveredId = null, selectedId = null, onHover }) {
  const t = useT();
  const addCity = (preset = null) => {
    const base = preset || { external_city_id: null, city_name: '', country: '', country_code: '', latitude: null, longitude: null, timezone: null };
    setCities(cs => recomputeDates([...cs, { id: Date.now(), ...base, startDate: cs[0]?.startDate || startDate || '', nights: preset?.nights || 3 }], startDate));
  };

  const remove = (id) => setCities(cs => recomputeDates(cs.filter(c => c.id !== id), startDate));

  // Cities are laid contiguously from the FIXED trip start (city N starts where
  // N-1 ends), so any nights / order change re-cascades - but the trip start
  // itself never moves (only the top date control changes it).
  const update = (id, patch) => setCities(cs => recomputeDates(cs.map(c => c.id === id ? { ...c, ...patch } : c), startDate));

  // Reorder via the SAME engine as the structural editor (useRouteDnD): pointer
  // drag (mouse-immediate / touch-long-press), FLIP slide, keyboard a11y — one
  // implementation, no second copy to drift. Creation cities have no pinned ends,
  // so every row is movable (isAnchor → false); a commit just reorders the list
  // by id and re-cascades the dates through the shared layout engine.
  const { draggingId, pressingId, displayNodes, setRowRef, armDrag, moveNodeById } = useRouteDnD({
    ordered: cities,
    isAnchor: () => false,
    onCommitOrder: (ids) => setCities(cs => {
      const byId = new Map(cs.map(c => [c.id, c]));
      return recomputeDates(ids.map(id => byId.get(id)).filter(Boolean), startDate);
    }),
  });

  // Добавили город → докручиваем к концу списка, чтобы пикер нового ряда не
  // оставался за кадром. Тот же приём scrollIntoView, что у CityAdder в
  // структурном редакторе (EditLens) — одна логика скролла на оба флоу. Скроллим
  // ПОСЛЕДНИЙ элемент существующего контейнера (кнопку «Добавить ещё город»),
  // которая стоит сразу под новым рядом — без отдельного якоря в разметке.
  const listRef = useRef(/** @type {HTMLDivElement | null} */(null));
  const prevCount = useRef(cities.length);
  useEffect(() => {
    const grew = cities.length > prevCount.current;
    prevCount.current = cities.length;
    if (!grew) return;
    const id = setTimeout(() => listRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    return () => clearTimeout(id);
  }, [cities.length]);

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

      {/* Start anchor — OPTIONAL. Empty → an inline "+ Указать старт" affordance
          (one control for both flows: manual skip + AI no-origin).
          Якорь и список - одна колонка: отступ между ними даёт шаг примитива, а
          не поле, приписанное руками обеим веткам «пусто / есть города». */}
      <div className="col">
        <CityAnchorRow label={t('ai_plan.start')} city={home} editable onPick={setHome} />

        {cities.length === 0 ? (
          <EmptyState
            icon="pin"
            title={t('planner.where_to')}
            body={t('planner.add_first_city')}
            action={<Btn variant="primary" icon="plus" onClick={() => addCity()}>{t('planner.add_city')}</Btn>}
          />
        ) : (
        <div className="col" ref={listRef}>
          {displayNodes.map((c) => {
            // dIdx = the row's index in the committed order (stable while the
            // preview reorders), used for numbering / isLast; the hook owns the
            // FLIP shuffle and commit.
            const dIdx = cities.indexOf(c);
            const rowId = String(c.id);
            // Mutual hover with the map pin. onMouseEnter/Leave live on the wrapper
            // (not the row) so they never interfere with the pointer-drag arming.
            return (
              <div
                key={c.id}
                ref={setRowRef(c.id)}
                /* ★ РЯД, КОТОРЫЙ ЕЩЁ НЕ ГОРОД, ХОВЕР КАРТЫ НЕ ЗАБИРАЕТ. Здесь
                   город ВЫДЕЛЯЛСЯ САМ сразу после добавления, и виноват не въезд
                   под курсор, а ПОРЯДОК: новый ряд открывается ПИКЕРОМ, города в
                   нём ещё нет. Чтобы ткнуть в подсказку, мышь реально въезжает в
                   ряд — ховер честно армится, но показывать нечего (координат
                   нет, маркера нет). Кнопка «✓» стоит В ТОМ ЖЕ ряду, курсор из
                   него не выходит, поэтому `mouseleave` не приходит; а когда
                   подтверждение выдаёт координаты, маркер РОЖДАЕТСЯ уже
                   наведённым — с подсветкой и плашкой. Снять это было нечем:
                   клик по карте гасит только ВЫБОР, до ховера ему дела нет.
                   Визуально `.is-hover` от `.is-sel` почти неотличим (scale 1.1
                   против 1.12) — отсюда и «город автоселектится».
                   Условие сравнивает КООРДИНАТЫ, а не режим ряда: «есть ли у него
                   точка на карте» — это ровно тот же предикат, по которому пин
                   вообще рисуется (`FlowMap`: `if (c.latitude == null) return`).
                   Ховер к пину и привязан, поэтому и спрашивать надо про пин, а
                   не про внутреннее состояние ряда, до которого этому месту дела
                   нет. Дальше всё как было: въехал мышью в готовый ряд — пин
                   подсветился, выехал — погас.
                   Пропуск въезда во время перетаскивания остаётся: FLIP-перестановка
                   возит ряды под удержанным пальцем и иначе дёргала бы подсветку. */
                onMouseEnter={onHover ? () => { if (!draggingId && c.latitude != null) onHover(rowId); } : undefined}
                onMouseLeave={onHover ? () => onHover(null) : undefined}
              >
                <CityRow
                  idx={dIdx}
                  city={c}
                  isDragging={draggingId === c.id}
                  isPressing={pressingId === c.id}
                  active={hoveredId === rowId || selectedId === rowId}
                  onArm={(e) => armDrag(e, c.id)}
                  onChange={(patch) => update(c.id, patch)}
                  onRemove={() => remove(c.id)}
                  onMove={(dir) => moveNodeById(c.id, dir)}
                />
              </div>
            );
          })}
          {/* Плейсхолдер «добавить» — тон `dashed` самой кнопки системы: серый
              пунктир в покое, акцент на ховере. Акцент тут не задаётся: здесь не
              выбирают тип, поэтому канал `--a` остаётся при умолчании (brand). */}
          <Btn variant="dashed" block icon="plus" onClick={() => addCity()}>
            {t('planner.add_more_city')}
          </Btn>
        </div>
        )}
      </div>

      {/* Finish is expressed by the last city's "финиш" switch (below) — no
          separate end/finish plate on this step, unified with the manual flow. */}
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

function StepReturn({ home, lastCityName, end, setEnd }) {
  const t = useT();
  // «Домой» (финиш = город старта) доступен, если старт вообще есть. Никаких сравнений
  // старт↔последний-город — финиш это самостоятельный узел.
  const canHome = !!home?.city_name;

  // `end` is the single source of truth (null | city | 'stay'); `otherMode` is a
  // LOCAL UI flag for the «другой» card (the picker writes the city into `end`).
  // `endIsHome` here is COSMETIC only — decides which card looks active on revisit,
  // not any data behaviour.
  const endIsCity = !!end && end !== 'stay';
  const endIsHome = endIsCity && sameCity(end, home);
  const [otherMode, setOtherMode] = useState(endIsCity && !endIsHome);
  // No origin → «домой» impossible: default the choice to «другой».
  useEffect(() => { if (!canHome && end !== 'stay') setOtherMode(true); }, [canHome]);

  const onStay = end === 'stay';
  const onOther = otherMode && !onStay;
  const onHome = !onStay && !onOther && canHome; // null default resolves to «домой» when possible

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
              onClick={() => { setEnd({ ...home }); setOtherMode(false); }}
              icon="flag" tone="brand"
              title={t('planner.return_home', { city: home?.city_name || '…' })}
              desc={<>{t('planner.return_home_desc_1')} <b>{lastCityName}</b> {t('planner.return_home_desc_2')}</>}
            />
          )}
          <ReturnOption
            on={onOther}
            onClick={() => { setEnd(null); setOtherMode(true); }}
            icon="globe" tone="warm"
            title={t('planner.return_other')}
            desc={t('planner.return_other_desc')}
          />
          {/* «Останусь в {город}» = финиш: возврата нет (переносит смысл убранного
              тумблера шага 2). */}
          <ReturnOption
            on={onStay}
            onClick={() => { setEnd('stay'); setOtherMode(false); }}
            icon="check" tone="success"
            title={t('planner.stay_title', { city: lastCityName })}
            desc={t('planner.stay_desc', { city: lastCityName })}
          />
        </div>

        {onOther && (
          <div className="field">
            <label className="field__label">{t('planner.return_city')}</label>
            <CityPicker
              value={endIsCity && !endIsHome ? end : null}
              onChange={(c) => setEnd(c)}
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

function StepReview({ home, cities, finishCity, isStay, cover, setCover, tripTitle, setTripTitle, saving, savedOk, savedTripId, error }) {
  const nav = useNavigate();
  const t = useT();
  const { lang } = useI18n();
  const totalNights = cities.reduce((n, c) => n + (Number(c.nights) || 0), 0);
  const autoTitle = computeAutoTitle(home, cities, t);
  const displayTitle = tripTitle || autoTitle;

  if (savedOk) {
    return (
      <EmptyState
        icon="check"
        kind="success"
        title={t('planner.created_title')}
        body={t('planner.created_desc', { title: displayTitle, cities: cities.length, citiesWord: cities.length === 1 ? t('trip.cities_count_one') : cities.length < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many'), nights: totalNights, nightsWord: totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many') })}
        action={(
          <>
            {/* Экран успеха ведёт в СЕКЦИЮ РЕДАКТОРА, а не на обзор: маршрут только
                что собран, и следующий шаг — брони, то есть ровно то, чем занят
                редактор. `?lens=` пишем адресом — он и есть источник истины для
                секции (единственный писатель `setLens` живёт в TripView и пишет
                туда же).
                `state.from` — канал «как сюда попали», НЕ часть адреса: по нему
                оболочка один раз проигрывает вход (рейл выезжает). Именно
                состояние навигации, а не параметр в URL и не глобал: оно не
                переживает перезагрузку — ровно то, что нужно одноразовой
                анимации, и закладка/копипаст ссылки её не тащат. */}
            <Btn variant="primary" onClick={() => savedTripId && nav(`/trip/${savedTripId}?lens=route`, { state: { from: 'create' } })}>{t('planner.open_trip')}</Btn>
            <Btn variant="secondary" onClick={() => nav('/trips')}>{t('notif.to_collection')}</Btn>
          </>
        )}
      />
    );
  }

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
              value={cities[0]?.startDate ? shortDateLabel(cities[0].startDate, lang) : '—'}
              warn={!cities[0]?.startDate ? t('planner.date_required_hint') : null}
            />
          </div>
          <div className="s">
            <Stat label={t('planner.duration')} value={`${totalNights} ${totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many')}`} />
          </div>
          <div className="s">
            <Stat label={t('planner.cities_stat')} value={cities.length} />
          </div>
        </Card>

        <div className="pl-summary__route">
          <div className="eyebrow">{t('planner.route_points', { n: (home ? 1 : 0) + cities.length + (finishCity?.city_name ? 1 : 0) })}</div>
          <div className="col col--g1">
            {home?.city_name && (
              <ReviewRow icon="flag" name={home.city_name} sub={`${home.country || ''} · ${t('planner.sub_start')}`} muted />
            )}
            {cities.map((c, i) => {
              // Last city with «останусь» chosen on step 3 → the endpoint marker
              // (single blue flag, unified with the start), not a numbered stop.
              const isFin = isStay && i === cities.length - 1;
              return (
                <ReviewRow
                  key={c.id}
                  num={isFin ? undefined : i + 1}
                  icon={isFin ? 'flag' : undefined}
                  name={c.city_name}
                  sub={isFin
                    ? `${c.country || '-'} · ${t('planner.sub_finish')}`
                    : `${c.country || '-'} · ${c.nights} ${c.nights == 1 ? t('view.nights_one') : c.nights < 5 ? t('view.nights_few') : t('view.nights_many')}${c.startDate ? ` · ${t('planner.from_date_prefix')} ${c.startDate}` : ''}`}
                  muted={isFin}
                />
              );
            })}
            {finishCity?.city_name && (
              <ReviewRow icon="flag" name={finishCity.city_name} sub={`${finishCity.country || ''} · ${t('planner.sub_finish')}`} muted />
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
  const { isDark, toggle: toggleTheme } = useTheme();

  // NB: no <body> scroll-lock here. The planner shell (.flow-page) is a 100dvh
  // overflow:hidden root — the same fixed-shell pattern as .app-shell on every
  // other screen — so the document never scrolls and the static header stays put,
  // including when the keyboard opens. A body position:fixed lock (tried earlier)
  // was what made the header fly up on keyboard, so it was removed.

  // 'manual' | 'ai' - only the entry screen differs; from the skeleton onward
  // both methods share the same steps.
  const method = initialMethod;
  const isAi = method === 'ai';

  // ── Free-plan limit check — single source: getActiveTrips → active_owned_trips() ──
  // Pro users skip the fetch; the server is the one definition of "active owned trip".
  const { isBlocked, isLoading: checkingLimit } = useActiveTripsLimit(isPro ? undefined : user?.id);
  const isOverLimit = isBlocked;

  // ── Wizard state ─────────────────────────────────────────────────────────
  const [step, setStep]             = useState('home');
  const [home, setHome]             = useState(null);
  const [startDate, setStartDateRaw] = useState(defaultStartISO()); // YYYY-MM-DD, trip start; prefilled +1 month
  const [cities, setCities]         = useState([]);
  // Finish узел — единственный источник истины по концу маршрута (заменил
  // returnMode/returnCity/finalPoint). Значения:
  //   null   — дефолт: финиш = город старта, если старт задан; иначе терминала нет;
  //   city   — узел финиша (домой = клон старта / другой город / финиш из ИИ);
  //   'stay' — «останусь»: последний город и есть терминал (kind:'end', без ночей).
  const [end, setEnd] = useState(null);
  const [tripTitle, setTripTitle]   = useState('');
  const [cover, setCover]           = useState({ cover_image_url: '' });
  const [saving, setSaving]         = useState(false);
  const [savedOk, setSavedOk]       = useState(false);
  const [savedTripId, setSavedTripId] = useState(null);
  const [error, setError]           = useState(null);
  const [restored, setRestored]     = useState(false);
  // Map ↔ list linking (Map-lens parity, TRIP-337): the pin/list row hovered or
  // selected. Ids match FlowMap's marker ids ('home' | city.id | 'finish').
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

  // Restore from sessionStorage on mount - only for the current user
  useEffect(() => {
    try {
      const key = storageKey(user?.id, method);
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.step) setStep(saved.step);
        if (saved.home) setHome(saved.home);
        if (saved.cities?.length) setCities(saved.cities);
        if (saved.end !== undefined) setEnd(saved.end);
        if (saved.tripTitle) setTripTitle(saved.tripTitle);
        if (saved.startDate) setStartDateRaw(saved.startDate);
        if (saved.cover) setCover(saved.cover);
        if (saved.aiState && isAi) setAiState(saved.aiState);
        if (saved.aiMessages?.length && isAi) setAiMessages(saved.aiMessages);
      }
    } catch {}
    setRestored(true);
  }, [user?.id]); // re-run if user changes (e.g. account switch in same tab)

  // Persist to sessionStorage on every change
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(storageKey(user?.id, method), JSON.stringify({ step, home, cities, end, tripTitle, startDate, cover, aiState, aiMessages }));
    } catch {}
  }, [step, home, cities, end, tripTitle, startDate, cover, aiState, aiMessages, restored, user?.id]);

  // setStartDate cascades to cities (first city anchors all subsequent dates).
  // Empty/invalid values are IGNORED - the trip start is required and can't be
  // cleared from any date control (step 1, step 2 or review).
  const setStartDate = (dateStr) => {
    if (!dateStr) return;
    setStartDateRaw(dateStr);
    // Re-anchor the whole chain on the new trip start (recomputeDates forces city 0
    // onto the anchor, so no manual first-city patch is needed).
    setCities(cs => (cs.length === 0 ? cs : recomputeDates(cs, dateStr)));
  };

  // ── AI draft → shared skeleton ─────────────────────────────────────────────
  // The AI returns a cities-only skeleton (no activities, no transfers) where
  // each city carries kind ∈ {start, transit, end}. We honour `kind` so the AI
  // route fills the SAME slots the manual flow uses: start → home (origin),
  // transit → the editable cities list, end → the return leg. From there the
  // user edits it like any manual trip; dates are re-anchored via recomputeDates.

  // Resolve one AI city into the planner shape (coords + timezone). Shared by
  // start / transit / end so the directory lookup lives in one place.
  // Shape one AI city into the planner shape (coords + timezone) from an already
  // resolved `best` (or null). Geocoding is now batched in applyAiDraft via
  // resolveCities (TRIP-145 P2), so this is pure shaping — no network here.
  const shapeAiCity = (c, idx, best) => {
    const tz = best?.latitude ? tzFromCoords(best.latitude, best.longitude) : null;
    return {
      id: Date.now() + idx,
      external_city_id: best?.external_city_id || null,
      geonameid: best?.geonameid ?? null,
      name_i18n: best?.name_i18n || null,
      city_name: c.city_name || '',
      // English name kept for partner links (Stay22/Viator) and the directory:
      // prefer the AI's city_name_en, else the geocoder's canonical en name.
      city_name_en: c.city_name_en || best?.city_name_en || '',
      // The gazetteer (TRIP-146) resolves country=null (only country_code), so
      // derive the localized country name from the code when neither the AI nor
      // the geocoder gave one — otherwise the review/rail shows "-".
      country: c.country || best?.country || localizeCountry(c.country_code || best?.country_code, lang) || '',
      country_code: (c.country_code || best?.country_code || '').toUpperCase(),
      latitude: best?.latitude ?? null,
      longitude: best?.longitude ?? null,
      timezone: tz || best?.timezone || null,
    };
  };

  const applyAiDraft = async (d) => {
    const dc = Array.isArray(d?.cities) ? d.cities : [];
    // Partition by kind. Missing/unknown kind defaults to transit. Only the
    // first start / last end are honoured (a trip has one origin + one return).
    const startSrc = dc.find((c) => c?.kind === 'start') || null;
    const endSrc = [...dc].reverse().find((c) => c?.kind === 'end') || null;
    const transitSrc = dc.filter((c) => c && c.kind !== 'start' && c.kind !== 'end');

    // Resolve ALL cities in ONE `search_gazetteer_batch` RPC (TRIP-214): the
    // gazetteer resolves the whole list server-side in a single round-trip/plan,
    // replacing the old per-city Promise.all burst (no concurrency limit → pool
    // storm on a long AI route). Order: [start?, end?, ...transit].
    const order = [];
    if (startSrc) order.push(startSrc);
    if (endSrc) order.push(endSrc);
    transitSrc.forEach((c) => order.push(c));
    // Resolve by English name + country_code: the gazetteer matches the English
    // name first (small towns that miss in Cyrillic still resolve) and keeps
    // same-country matches. The Russian city_name from the AI is what we
    // display/save.
    const lists = await resolveCities(
      order.map((c) => ({
        city_name: c.city_name,
        name_en: c.city_name_en,
        country: c.country,
        country_code: c.country_code,
      })),
      lang || 'ru',
    );
    let oi = 0;
    const startCity = startSrc ? shapeAiCity(startSrc, 0, lists[oi++]?.[0] || null) : null;
    const endCity = endSrc ? shapeAiCity(endSrc, 1, lists[oi++]?.[0] || null) : null;
    const transitResolved = [];
    for (let i = 0; i < transitSrc.length; i++) {
      const c = transitSrc[i];
      const base = shapeAiCity(c, i + 2, lists[oi++]?.[0] || null);
      const nights = c.start_date && c.end_date ? daysBetweenISO(c.start_date, c.end_date) : 1;
      transitResolved.push({ ...base, startDate: c.start_date || '', nights: Math.max(1, +nights || 1) });
    }

    // Start city → home (origin marker; optional, no nights/dates of its own).
    const resolvedHome = startCity?.city_name ? startCity : null;
    setHome(resolvedHome);

    // Transit cities anchored to the first city's start_date (or default).
    const anchor = transitResolved[0]?.startDate || defaultStartISO();
    const resolvedCities = recomputeDates(transitResolved, anchor);
    setCities(resolvedCities);
    setStartDateRaw(anchor);

    // Finish узел — только если ИИ дал его явно (n8n отдаёт `kind:'end'` отдельным
    // узлом). Не дал — узел не выдумываем: финиш определится на шаге 3 (дефолт
    // «домой»). Узел `end` едет насквозь и виден в чате/ревью/карте как есть.
    const endNode = endCity?.city_name ? endCity : null;
    setEnd(endNode);

    if (d?.title) setTripTitle(d.title);
    // Return the resolved draft so the caller can snapshot it into the chat message
    // (each assistant turn shows the itinerary it proposed).
    return { home: resolvedHome, cities: resolvedCities, end: endNode, title: d?.title || '' };
  };

  const planMut = useMutation({
    mutationFn: async ({ promptText }) => {
      const { data, error: fnErr, code } = await invokeFn('planTripWithAi', {
        body: { sessionId, prompt: promptText, language: lang || 'ru' },
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
      setAiState('generating'); setError(null);
      // The prompt becomes an outgoing chat message (the composer clears itself).
      setAiMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', text: vars.promptText }]);
    },
    onSuccess: async (data) => {
      const out = data?.output || {};
      const full = await applyAiDraft(out.draft || {});
      // The bot's reply = its text + a DISPLAY-ONLY snapshot of the itinerary it
      // proposed (name / country / nights only — not the full resolved city objects
      // with coords/tz/ids), so a multi-turn transcript in sessionStorage stays small.
      const draft = {
        home: full.home ? { city_name: full.home.city_name, country_code: full.home.country_code } : null,
        cities: (full.cities || []).map((c) => ({ id: c.id, city_name: c.city_name, country: c.country, nights: c.nights })),
        end: full.end ? { city_name: full.end.city_name, country: full.end.country, country_code: full.end.country_code } : null,
      };
      setAiMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', text: out.ai_comment || '', draft }]);
      setAiState('draft');
    },
    onError: (err) => {
      setAiState(cities.length ? 'draft' : 'prompt');
      // TRIP-111: серверный rate-limit генераций → доменная копия; прочие отказы
      // словит errorText по машинному `code` (серверную прозу не показываем).
      const description = err?.context?.status === 429
        ? t('ai_plan.error_rate_limited')
        : errorText(t, err?.code);
      // A bot bubble closes the turn so the outgoing message isn't left hanging; the
      // toast still carries the specific reason. Text is from i18n (never raw server prose).
      setAiMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', kind: 'error' }]);
      toast({ title: t('ai_plan.error_plan_title'), description, variant: 'destructive' });
    },
  });
  const onGenerate = (promptText) => { if (promptText) planMut.mutate({ promptText }); };

  // The entry step's label depends on the method (origin vs AI prompt).
  const entryLabel = isAi ? t('planner.step_home_ai') : t('planner.step_home');
  // The "Возврат" decision (round-trip / other city / stay = finish) now lives
  // ENTIRELY on step 3, so the step is always present — no step is ever skipped.
  const visibleSteps = STEPS
    .map(s => ({ ...s, label: s.id === 'home' ? entryLabel : t(s.labelKey) }));
  const goNext = () => {
    const i = visibleSteps.findIndex(s => s.id === step);
    if (i >= 0 && i < visibleSteps.length - 1) setStep(visibleSteps[i + 1].id);
  };
  const goPrev = () => {
    const i = visibleSteps.findIndex(s => s.id === step);
    if (i > 0) setStep(visibleSteps[i - 1].id);
  };

  // Reset draft and go back to step 1
  const resetToStart = () => {
    setStep('home');
    setHome(null);
    setCities([]);
    setEnd(null);
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
    try { sessionStorage.removeItem(storageKey(user?.id, method)); } catch { /* ignore */ }
  };

  // Финиш — самостоятельный узел (kind:'end'), а не «возврат»: 4 типа города —
  // старт / финиш / пересадка / посещение. `isStay` («останусь») = последний город
  // сам становится терминалом. Иначе финиш = явно заданный узел `end`, а если он не
  // задан — дефолт «домой» = город старта. Никаких сравнений старт↔финиш.
  const lastCity = cities[cities.length - 1] || null;
  const isStay = end === 'stay';
  const finishCity = isStay ? null : (end || home || null);
  const autoTitle = computeAutoTitle(home, cities, t);

  // Map tooltip lookup: id → { lng, lat, countryCode, name, dates }, keyed the same
  // way FlowMap tags its pins ('home' | city.id | 'finish'). A city's date range is
  // start..start+nights (single day for a 0-night waypoint); anchors show name only.
  const mapPointById = useMemo(() => {
    const m = {};
    if (home?.latitude != null) m.home = { lng: home.longitude, lat: home.latitude, countryCode: home.country_code, name: home.city_name, dates: null };
    cities.forEach((c) => { if (c.latitude != null) m[String(c.id)] = { lng: c.longitude, lat: c.latitude, countryCode: c.country_code, name: c.city_name, dates: cityDateRange(c, lang) }; });
    if (finishCity?.latitude != null) m.finish = { lng: finishCity.longitude, lat: finishCity.latitude, countryCode: finishCity.country_code, name: finishCity.city_name, dates: null };
    return m;
  }, [home, cities, finishCity, lang]);
  // The tooltip follows the hovered pin/row, otherwise the selected one.
  const activeMapId = hoveredMapId || selectedMapId;
  const cityBadge = activeMapId ? mapPointById[activeMapId] || null : null;
  // Clear map selection/hover on step change: a pin drawn on one step (e.g. the
  // return pin, only shown on return/review) must not leave a tooltip floating at
  // its coordinate once the step no longer renders it.
  useEffect(() => { setHoveredMapId(null); setSelectedMapId(null); }, [step]);

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
      // 1. Cities payload: identity (CITY_FIELDS) + role in the chain + nights
      // (span). Dates are NOT computed here — the SERVER lays them
      // (create_trip_with_route → recompute_trip), the same engine as live-edit, so
      // parity with the old client addDays is structural. Home = start anchor; the
      // final point (or return) = end anchor (no nights); the rest are transit.
      const cityIdentity = (c) => ({
        external_city_id: c.external_city_id || null,
        geonameid: c.geonameid ?? null,
        name_i18n: c.name_i18n || null,
        city_name_en: c.city_name_en || null,
        country_code: c.country_code || null,
        latitude: c.latitude || null,
        longitude: c.longitude || null,
        timezone: c.timezone || null,
      });
      const citiesPayload = [];
      if (home?.city_name) citiesPayload.push({ ...cityIdentity(home), kind: 'start' });
      cities.forEach((c, i) => {
        if (!c.city_name) return;
        const isFinalAnchor = isStay && i === cities.length - 1;
        // 0 nights = a layover/waypoint — save it with the SAME kind the editor uses
        // (kind:'waypoint'), so it's excluded from city/country counts and reopens as
        // a пересадка, not a numbered stop. A distinct final anchor stays kind:'end'.
        const id = cityIdentity(c);
        if (isFinalAnchor) citiesPayload.push({ ...id, kind: 'end' });
        else if (+c.nights === 0) citiesPayload.push({ ...id, kind: 'waypoint' });
        else citiesPayload.push({ ...id, kind: 'transit', nights: +c.nights || 0 });
      });
      // Separate finish node → kind:'end' (домой = город старта / другой город / явный
      // финиш из ИИ). «Останусь» отдельного узла не создаёт — последний город выше уже
      // помечен kind:'end' (isFinalAnchor).
      if (finishCity?.city_name) citiesPayload.push({ ...cityIdentity(finishCity), kind: 'end' });

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

      sessionStorage.removeItem(storageKey(user?.id, method));
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

  // ── Limit guard ───────────────────────────────────────────────────────────
  // The guard gates ENTERING / continuing creation while a free user is at the
  // cap — it must NOT override the terminal success screen. Saving the trip
  // raises the active count and invalidates the limit cache (see above), so the
  // refetch flips isOverLimit→true a moment after savedOk. Without `!savedOk`
  // the success screen would be replaced by the "limit reached" blocker a second
  // after it appears. savedOk can only be true if the user was UNDER the limit
  // at save time (the blocker returns before the form), so suppressing it here is
  // safe by construction.
  if (!isPro && checkingLimit && !savedOk) {
    return (
      // Оболочка маршрута - та же .flow-page, что у самого планировщика ниже.
      <div className="flow-page row row--j-center">
        <div className="spin spin--ring spin--xl" />
      </div>
    );
  }

  if (isOverLimit && !savedOk) {
    return (
      <div className="flow-page">
        <AppHeader
          user={user}
          isPro={isPro}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onBack={() => nav('/trips')}
          backTitle={t('notif.to_collection')}
        />
        <div className="grow row row--j-center">
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
      </div>
    );
  }

  // ── Footer (single, lifted out of the steps) ───────────────────────────────
  // One Back / Reset / Next|Save bar pinned to the bottom of the right card,
  // driven by a per-step descriptor. The step bodies no longer carry their own
  // footer; the gating (Next disabled, Save spinner) lives here and stays
  // identical to the old per-step logic.
  const stepIdx = Math.max(0, visibleSteps.findIndex((s) => s.id === step));
  const isFirstStep = stepIdx === 0;
  const citiesValid = cities.length > 0 && cities.every((c) => c.city_name && c.latitude != null);
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
    primaryDisabled = !citiesValid;
  } else if (step === 'review') {
    primaryLabel = saving ? t('planner.saving_btn') : t('planner.save_trip');
    primaryAction = handleSave;
    primaryDisabled = saving;
    if (savedOk) showFooter = false; // the success screen owns its own actions
  }

  // ── Main render ───────────────────────────────────────────────────────────
  // Содержимое панели разложено по слотам шелла: ШАПКА (прогресс) всегда на
  // виду — по ней читается шаг даже у опущенного шита; ТЕЛО скроллится; ФУТЕР с
  // действиями шага стоит вне скролла, иначе кнопка «Далее» уезжает вместе со
  // списком ровно тогда, когда она нужна.
  const BODY = (
    // `.flow-lp-b` — типографский контекст шага (ритм заголовков/подзаголовков),
    // а не раскладка: раскладку и скролл держит тело шелла.
    <div className="flow-lp-b">
        {step === 'home' && (isAi ? (
          <PanelAi aiMessages={aiMessages} onGenerate={onGenerate} />
        ) : (
          <StepHome home={home} setHome={setHome} startDate={startDate} setStartDate={setStartDate} />
        ))}
        {step === 'cities' && (
          <StepCities cities={cities} setCities={setCities} home={home} setHome={setHome} startDate={startDate} setStartDate={setStartDate} hoveredId={hoveredMapId} selectedId={selectedMapId} onHover={setHoveredMapId} />
        )}
        {step === 'return' && (
          <StepReturn
            home={home}
            lastCityName={lastCity?.city_name || t('planner.last_city_fallback')}
            end={end}
            setEnd={setEnd}
          />
        )}
        {step === 'review' && (
          <StepReview
            home={home}
            cities={cities}
            finishCity={finishCity}
            isStay={isStay}
            cover={cover}
            setCover={setCover}
            tripTitle={tripTitle}
            setTripTitle={setTripTitle}
            saving={saving}
            savedOk={savedOk}
            savedTripId={savedTripId}
            error={error}
          />
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
  const FOOTER = (step === 'home' && isAi) ? (
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
          {!isFirstStep && <Btn variant="secondary" onClick={goPrev} disabled={saving}>{t('planner.back')}</Btn>}
          {/* Reset is a VISIBLE, low-emphasis text button here (not a hidden
              icon in the header) — nav actions all live in the action bar. It
              also shows on the AI entry step (step 1), where a conversation can
              already have built a draft to clear. */}
          {(!isFirstStep || (isAi && step === 'home')) && <Btn variant="quiet" icon="refresh" onClick={requestReset} disabled={saving}>{t('planner.reset')}</Btn>}
          <div className="flow-foot__spacer grow" />
          <Btn variant={primaryVariant} onClick={primaryAction} disabled={primaryDisabled}>{primaryLabel}</Btn>
        </div>
      )}
    </>
  );

  return (
    <div className="flow-page">
      {/* Header */}
      <AppHeader
        user={user}
        isPro={isPro}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onBack={() => nav('/trips')}
        backTitle={t('notif.to_collection')}
        title={isAi ? t('planner.step_home_ai') : t('trips.new')}
      />

      {/* Раскладку «карта во всю площадь + панель поверх / шит на телефоне»
          держит примитив <MapShell>: он же считает, сколько места закрыто, и
          отдаёт это карте отступами камеры. Своих `.flow-grid/-mapcol/-editcol`
          у шага больше нет — они были третьей копией одной и той же раскладки. */}
      <MapShell
        panelLabel={t('trips.new')}
        detent={detent}
        onDetentChange={setDetent}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        collapseLabel={t('common.panel_collapse')}
        expandLabel={t('common.panel_expand')}
        panelHeader={(
          <div className="flow-lp-h">
            {/* grow--fit (flex:1 + min-width:0) so the progress can shrink and its
                "next" hint wraps INSIDE this column instead of overflowing and
                shoving the reset control off the narrow mobile sheet header. */}
            <div className="grow--fit">
              <FlowProgress
                steps={visibleSteps}
                current={stepIdx}
                accent={isAi ? 'var(--ai)' : 'var(--brand)'}
                onJump={(i) => setStep(visibleSteps[i].id)}
              />
            </div>
          </div>
        )}
        panelFooter={FOOTER}
        panel={BODY}
        // Закрытая площадь приезжает камере отступом вьюпорта на ОБЕИХ осях:
        // панель режет ширину (десктоп), шит — высоту (телефон), холст в обоих
        // случаях остаётся во всю площадь — разбор в `mapShellInsets`.
        map={(camera) => (
          <>
            {/* Floating round back control — shown only on the phone shell (the app
                header is removed there); the canon `.map-back` position/visibility
                live in CSS. */}
            <IconBtn
              className="map-back"
              icon="back"
              round
              tone="outline"
              ariaLabel={t('notif.to_collection')}
              onClick={() => nav('/trips')}
            />
            <FlowMap
              camera={camera}
              colorScheme={isDark ? 'DARK' : 'LIGHT'}
              home={home}
              cities={cities}
              // Always pass the finish city (it feeds the camera framing). DRAW the
              // finish pin + leg when it's ALREADY DECIDED — the AI put it in the draft,
              // or the user picked it — so a known finish shows immediately (incl. on
              // the AI chat step), not only from step 3. The manual null-default
              // (resolved to home only for display) is NOT an explicit finish, so it
              // still waits for step 3 → no pre-drawn line home on the earlier steps.
              finishCity={finishCity}
              drawFinish={(!!end && end !== 'stay') || step === 'return' || step === 'review'}
              isStay={isStay}
              hoveredId={hoveredMapId}
              selectedId={selectedMapId}
              cityBadge={cityBadge}
              onCityHover={setHoveredMapId}
              onCityClick={(id) => setSelectedMapId((cur) => (cur === id ? null : id))}
              onMapClick={() => setSelectedMapId(null)}
            />
          </>
        )}
      />
    </div>
  );
}
