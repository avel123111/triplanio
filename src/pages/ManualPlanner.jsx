import React, { useState, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { track } from '@/lib/analytics';
import { invokeFn } from '@/lib/invokeFn';
import { invokeGetTripDetails } from '@/lib/invokeTripFn';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, TRIP_SHELL_INCLUDE, TRIP_CONTENT_INCLUDE } from '@/lib/trip-data';
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
import { Badge, Btn, Card, EmptyState, IconBtn, Severity, Tile, useToast } from '../design/index';
import CityRowBase from '@/components/trip/CityRow';
import NightsStepper from '@/components/trip/NightsStepper';
import TripStartControl from '@/components/trip/TripStartControl';
import AppHeader from '@/components/AppHeader';
import TripCoverPicker from '@/components/trips/TripCoverPicker';
import { finalizeDraftCover } from '@/lib/coverStorage';
import { coverGradientCss, DEFAULT_GRADIENT_ID } from '@/lib/trip-gradients';
import FlowProgress from '@/pages/create/FlowProgress';
import FlowMap from '@/pages/create/FlowMap';
import PanelAi from '@/pages/create/PanelAi';
import { CityPicker, CityAnchorRow } from '@/pages/create/anchors';
import { useRouteDnD } from '@/lib/useRouteDnD';
import { useConfirm } from '@/components/common/ConfirmProvider';
// StartCalendar / Popover / Sheet / DateTime are now encapsulated in the shared TripStartControl.

// Навигация с нативным View-Transition. Классический BrowserRouter (не data-router)
// НЕ умеет флаг `viewTransition` у navigate — он молча игнорируется, и переход
// получается жёстким «cut». Поэтому запускаем переход сами: startViewTransition
// снимает снапшот «до», а flushSync СИНХРОННО коммитит новый роут внутри колбэка
// (без него React отрисовал бы редактор уже ПОСЛЕ снапшота «после», и твинить было
// бы нечего). Браузер интерполирует общие по имени элементы. Нет поддержки VT
// (Safari<18) → обычная навигация.
function navWithTransition(navigate, to, options) {
  if (typeof document === 'undefined' || typeof document.startViewTransition !== 'function') {
    navigate(to, options);
    return;
  }
  document.startViewTransition(() => flushSync(() => navigate(to, options)));
}

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
const storageKey = (userId, method = 'manual') => `triplanio-planner-${method}-${userId || 'guest'}`;

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
        <div className="col">
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
                // Skip enter-hover mid-drag: a FLIP reorder slides rows under a
                // held pointer, which would otherwise churn the highlight.
                onMouseEnter={onHover ? () => { if (!draggingId) onHover(rowId); } : undefined}
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
// домой / в другой город / останусь (финиш, возврата нет). «Финиш» ЖИВЁТ ТОЛЬКО
// ЗДЕСЬ (тумблер с шага 2 убран) — одна точка правды. finalPoint остаётся общим
// стейтом (карту/сохранение не трогаем), но пишется только этими карточками.
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

function StepReturn({ home, lastCity, lastCityName, returnMode, setReturnMode, returnCity, setReturnCity, finalPoint, setFinalPoint }) {
  const t = useT();
  // "Домой" is only meaningful with an origin. Without a start there's nowhere to
  // return home to → the round-trip card is hidden; a default is nudged to "other"
  // only when the user hasn't chosen the "stay" finish.
  // "Домой" is meaningless when the origin IS the last city — returning "home" would
  // just duplicate that city at the end. Hide the option then (по внешнему id, а не
  // только имени: тёзки-города в разных странах — не один город).
  const homeIsLast = !!home?.city_name && !!lastCity?.city_name && (
    (home.external_city_id != null && home.external_city_id === lastCity.external_city_id) ||
    (home.geonameid != null && home.geonameid === lastCity.geonameid) ||
    home.city_name === lastCity.city_name
  );
  const canHome = !!home?.city_name && !homeIsLast;
  useEffect(() => { if (!canHome && !finalPoint && returnMode !== 'other') setReturnMode('other'); }, [canHome]);

  const onHome = returnMode === 'home' && !finalPoint;
  const onOther = returnMode === 'other' && !finalPoint;

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
              onClick={() => { setReturnMode('home'); setFinalPoint(false); }}
              icon="flag" tone="brand"
              title={t('planner.return_home', { city: home?.city_name || '…' })}
              desc={<>{t('planner.return_home_desc_1')} <b>{lastCityName}</b> {t('planner.return_home_desc_2')}</>}
            />
          )}
          <ReturnOption
            on={onOther}
            onClick={() => { setReturnMode('other'); setFinalPoint(false); }}
            icon="globe" tone="warm"
            title={t('planner.return_other')}
            desc={t('planner.return_other_desc')}
          />
          {/* «Останусь в {город}» = финиш: возврата нет (переносит смысл убранного
              тумблера шага 2). */}
          <ReturnOption
            on={finalPoint}
            onClick={() => setFinalPoint(true)}
            icon="check" tone="success"
            title={t('planner.stay_title', { city: lastCityName })}
            desc={t('planner.stay_desc', { city: lastCityName })}
          />
        </div>

        {onOther && (
          <div className="field">
            <label className="field__label">{t('planner.return_city')}</label>
            <CityPicker
              value={returnCity}
              onChange={setReturnCity}
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

function StepReview({ home, cities, returnCity, finalPoint, cover, setCover, tripTitle, setTripTitle, saving, savedOk, savedTripId, error }) {
  const nav = useNavigate();
  const t = useT();
  const { lang } = useI18n();
  const totalNights = cities.reduce((n, c) => n + (Number(c.nights) || 0), 0);
  const autoTitle = computeAutoTitle(home, cities, t);
  const displayTitle = tripTitle || autoTitle;

  const hasPhoto = !!cover?.cover_image_url;
  const heroBg = hasPhoto ? 'var(--wash)' : coverGradientCss(cover?.cover_gradient);

  if (savedOk) {
    return (
      <EmptyState
        icon="check"
        kind="success"
        title={t('planner.created_title')}
        body={t('planner.created_desc', { title: displayTitle, cities: cities.length, citiesWord: cities.length === 1 ? t('trip.cities_count_one') : cities.length < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many'), nights: totalNights, nightsWord: totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many') })}
        action={(
          <>
            {/* «Перейти в трип» ведёт в линзу edit (маршрут + карта) и запускает
                нативный View-Transition (см. navWithTransition + блок в app.css):
                карта-фон планнера сворачивается в рамочный контейнер редактора,
                слева выезжает меню, панель подтверждения перетекает в колонку
                маршрута. Без поддержки VT (Safari<18) — мгновенный переход. */}
            <Btn variant="primary" onClick={() => savedTripId && navWithTransition(nav, `/trip/${savedTripId}?lens=edit`, { state: { fromCreate: true } })}>{t('planner.open_trip')}</Btn>
            <Btn variant="secondary" onClick={() => nav('/trips')}>{t('notif.to_collection')}</Btn>
          </>
        )}
      />
    );
  }

  return (
    <div>
      <h1>{t('planner.step_review')}</h1>
      <div className="t-body">
        {t('planner.review_desc')}
      </div>

      {/* Секции шага в одну колонку с ровным шагом — иначе поля/сводка/статусы
          лежат вплотную (у `.field` своего вертикального отступа нет). */}
      <div className="col col--g7">
      {/* Редактируемое сверху — название и обложка кормят превью ниже. */}
      <div className="field">
        <label className="field__label t-label">{t('planner.title_label')}</label>
        <input
          className="input"
          value={tripTitle}
          onChange={e => setTripTitle(e.target.value)}
          placeholder={autoTitle}
          disabled={saving}
        />
      </div>

      <div className="field">
        <label className="field__label t-label">{t('planner.cover')}</label>
        <TripCoverPicker
          coverImageUrl={cover?.cover_image_url || ''}
          coverGradient={cover?.cover_gradient || ''}
          onChange={setCover}
          showPreview={false}
        />
      </div>

      {/* Сводка — ОДНА карточка с одним радиусом; hero / статы / маршрут = плоские
          секции, разделённые бордюрами. Прежде .statbar и .card лежали скруглёнными
          ВНУТРИ flush-родителя (радиус в радиусе) — это и убрано. Собрано из готового:
          обложка = постер .tc, цифры = .statbar/.v/.k, ряд точки = .pl-revrow. */}
      <Card radius="btn" pad="none" className="pl-summary">
        <div className="tc tc--band">
          {/* heroBg - ДАННЫЕ (загруженное фото или градиент обложки трипа) */}
          <div className="tc__bg" style={{ background: heroBg }}>
            {hasPhoto && <img className="tc__img" src={cover.cover_image_url} alt="" />}
          </div>
          <div className="tc__scrim" />
          <div className="tc__in">
            <div className="tc__spacer" />
            <div className="t-title tc__title">{displayTitle}</div>
          </div>
        </div>

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
          <div className="eyebrow">{t('planner.route_points', { n: (home ? 1 : 0) + cities.length + (returnCity ? 1 : 0) })}</div>
          <div className="col col--g1">
            {home?.city_name && (
              <ReviewRow icon="flag" name={home.city_name} sub={`${home.country || ''} · ${t('planner.sub_start')}`} muted />
            )}
            {cities.map((c, i) => {
              // Last city with the finish chosen on step 3 → the endpoint marker
              // (single blue flag, unified with the start), not a numbered stop.
              const isFin = finalPoint && i === cities.length - 1;
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
            {returnCity?.city_name && (
              <ReviewRow icon="flag" name={returnCity.city_name} sub={`${returnCity.country || ''} · ${t('planner.sub_return')}`} muted />
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
  const [returnMode, setReturnMode] = useState('home');
  const [returnCity, setReturnCity] = useState(null);
  const [finalPoint, setFinalPoint] = useState(false); // last city is the finish - skip "return"
  const [tripTitle, setTripTitle]   = useState('');
  const [cover, setCover]           = useState({ cover_image_url: '', cover_gradient: 'gradient_1' });
  const [saving, setSaving]         = useState(false);
  const [savedOk, setSavedOk]       = useState(false);
  const [savedTripId, setSavedTripId] = useState(null);
  const [error, setError]           = useState(null);
  const [restored, setRestored]     = useState(false);
  // Map ↔ list linking (Map-lens parity, TRIP-337): the pin/list row hovered or
  // selected. Ids match FlowMap's marker ids ('home' | city.id | 'return').
  const [hoveredMapId, setHoveredMapId]   = useState(null);
  const [selectedMapId, setSelectedMapId] = useState(null);

  // ── AI-entry state (only used when method === 'ai') ────────────────────────
  const [prompt, setPrompt]                 = useState('');
  const [aiState, setAiState]               = useState(isAi ? 'prompt' : 'draft'); // prompt | generating | draft
  const [aiComment, setAiComment]           = useState('');
  const [sessionId, setSessionId]           = useState(() => crypto.randomUUID());

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
        if (saved.returnMode) setReturnMode(saved.returnMode);
        if (saved.returnCity) setReturnCity(saved.returnCity);
        if (saved.tripTitle) setTripTitle(saved.tripTitle);
        if (saved.finalPoint) setFinalPoint(!!saved.finalPoint);
        if (saved.startDate) setStartDateRaw(saved.startDate);
        if (saved.cover) setCover(saved.cover);
        if (saved.aiState && isAi) setAiState(saved.aiState);
      }
    } catch {}
    setRestored(true);
  }, [user?.id]); // re-run if user changes (e.g. account switch in same tab)

  // Persist to sessionStorage on every change
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(storageKey(user?.id, method), JSON.stringify({ step, home, cities, returnMode, returnCity, tripTitle, finalPoint, startDate, cover, aiState }));
    } catch {}
  }, [step, home, cities, returnMode, returnCity, tripTitle, finalPoint, startDate, cover, aiState, restored, user?.id]);

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
    setHome(startCity?.city_name ? startCity : null);

    // Finish/return — mapped to the SAME model the manual flow uses (Pavel's
    // call): a one-way end (a distinct final city, not the origin) sets finalPoint
    // (the "Останусь"/finish choice on step 3) — no separate return node. A
    // round-trip (end == origin) or no end → finalPoint off, return defaults to
    // "home" (manual default). The "Возврат" step is always shown; finalPoint only
    // decides whether a return leg is created.
    const startName = startCity?.city_name || '';
    const oneWayEnd = !!endCity?.city_name && endCity.city_name !== startName;
    let finalCities = transitResolved;
    if (oneWayEnd) {
      const lastTransit = transitResolved[transitResolved.length - 1];
      // Don't duplicate when the itinerary already ends at that city — just flip
      // the switch on the existing last city; else append the end as the finish.
      if (!lastTransit || lastTransit.city_name !== endCity.city_name) {
        finalCities = [...transitResolved, { ...endCity, startDate: '', nights: 1 }];
      }
    }

    // Transit cities anchored to the first city's start_date (or default).
    const anchor = finalCities[0]?.startDate || defaultStartISO();
    setCities(recomputeDates(finalCities, anchor));
    setStartDateRaw(anchor);

    setFinalPoint(oneWayEnd);
    setReturnMode('home');
    setReturnCity(null);

    if (d?.title) setTripTitle(d.title);
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
    onMutate: () => { setAiState('generating'); setError(null); },
    onSuccess: async (data) => {
      const out = data?.output || {};
      setAiComment(out.ai_comment || '');
      await applyAiDraft(out.draft || {});
      setAiState('draft');
    },
    onError: (err) => {
      setAiState(cities.length ? 'draft' : 'prompt');
      // TRIP-111: серверный rate-limit генераций → доменная копия; прочие отказы
      // словит errorText по машинному `code` (серверную прозу не показываем).
      const description = err?.context?.status === 429
        ? t('ai_plan.error_rate_limited')
        : errorText(t, err?.code);
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
    setReturnMode('home');
    setReturnCity(null);
    setFinalPoint(false);
    setStartDateRaw(defaultStartISO());
    setTripTitle('');
    setCover({ cover_image_url: '', cover_gradient: 'gradient_1' });
    setSavedOk(false);
    setSavedTripId(null);
    setError(null);
    // AI-entry reset
    setPrompt('');
    setAiComment('');
    setAiState(isAi ? 'prompt' : 'draft');
    setSessionId(crypto.randomUUID());
    try { sessionStorage.removeItem(storageKey(user?.id, method)); } catch { /* ignore */ }
  };

  // When the user marked the last city as the finish, there's no separate
  // return city - the trip ends at the last transit city.
  const effectiveReturn = finalPoint ? null : (returnMode === 'home' ? home : returnCity);
  const autoTitle = computeAutoTitle(home, cities, t);

  // Map tooltip lookup: id → { lng, lat, countryCode, name, dates }, keyed the same
  // way FlowMap tags its pins ('home' | city.id | 'return'). A city's date range is
  // start..start+nights (single day for a 0-night waypoint); anchors show name only.
  const mapPointById = useMemo(() => {
    const m = {};
    if (home?.latitude != null) m.home = { lng: home.longitude, lat: home.latitude, countryCode: home.country_code, name: home.city_name, dates: null };
    cities.forEach((c) => { if (c.latitude != null) m[String(c.id)] = { lng: c.longitude, lat: c.latitude, countryCode: c.country_code, name: c.city_name, dates: cityDateRange(c, lang) }; });
    if (effectiveReturn?.latitude != null) m.return = { lng: effectiveReturn.longitude, lat: effectiveReturn.latitude, countryCode: effectiveReturn.country_code, name: effectiveReturn.city_name, dates: null };
    return m;
  }, [home, cities, effectiveReturn, lang]);
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
        const isFinalAnchor = finalPoint && i === cities.length - 1;
        // 0 nights = a layover/waypoint — save it with the SAME kind the editor uses
        // (kind:'waypoint'), so it's excluded from city/country counts and reopens as
        // a пересадка, not a numbered stop. A distinct final anchor stays kind:'end'.
        const id = cityIdentity(c);
        if (isFinalAnchor) citiesPayload.push({ ...id, kind: 'end' });
        else if (+c.nights === 0) citiesPayload.push({ ...id, kind: 'waypoint' });
        else citiesPayload.push({ ...id, kind: 'transit', nights: +c.nights || 0 });
      });
      // Return city → kind:'end' (created even when returnMode==='home', so the
      // cityN → end leg always exists and the "no transfer" affordance shows).
      if (effectiveReturn?.city_name) citiesPayload.push({ ...cityIdentity(effectiveReturn), kind: 'end' });

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

      // 2. Persist cover (gradient or uploaded image). create_trip_with_route
      // doesn't accept cover fields; trips is Ярус B (TRIP-190) — no direct client
      // write — so the cover goes through the updateTripSettings edge (declared
      // Storage boundary: the file lands before tripId exists, re-homed after).
      if (cover?.cover_gradient || cover?.cover_image_url) {
        // Cover was uploaded before the trip existed (draft prefix) — move it
        // under <tripId>/ and re-sign before persisting the URL.
        const finalCoverUrl = cover.cover_image_url
          ? await finalizeDraftCover(trip.id, cover.cover_image_url)
          : null;
        const { error: coverErr } = await invokeFn('trip-settings/settings', {
          body: {
            tripId: trip.id,
            fields: {
              cover_image_url: finalCoverUrl,
              // Invariant: every trip keeps a built-in gradient (photo renders on
              // top when present). Never persist null → no legacy/procedural cover.
              cover_gradient: cover.cover_gradient || DEFAULT_GRADIENT_ID,
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
      // Прогрев кэша трипа ТЕМИ ЖЕ queryFn, что использует TripView: пока показан
      // экран успеха, shell+content уже подгружаются, и к моменту тапа «Перейти в
      // трип» линза edit рисует реальную сетку (карта + маршрут) ПЕРВЫМ кадром —
      // без скелетона, а значит целевой контейнер карты существует в момент, когда
      // View-Transition снимает снапшот «после». fire-and-forget: сбой прогрева не
      // критичен (редактор всё равно дозагрузит сам), поэтому промис не ждём.
      qc.prefetchQuery({ queryKey: TRIP_SHELL_KEY(trip.id), queryFn: () => invokeGetTripDetails({ tripId: trip.id, include: TRIP_SHELL_INCLUDE }) });
      qc.prefetchQuery({ queryKey: TRIP_CONTENT_KEY(trip.id), queryFn: () => invokeGetTripDetails({ tripId: trip.id, include: TRIP_CONTENT_INCLUDE }) });
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
  const hasDraftData = !!home?.city_name || cities.length > 0 || !!returnCity?.city_name;

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
  } else if (step === 'cities') {
    primaryDisabled = !citiesValid;
  } else if (step === 'review') {
    primaryLabel = saving ? t('planner.saving_btn') : t('planner.save_trip');
    primaryAction = handleSave;
    primaryDisabled = saving;
    if (savedOk) showFooter = false; // the success screen owns its own actions
  }

  // ── Main render ───────────────────────────────────────────────────────────
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

      {/* Two framed cards (trip-edit layout): the full-bleed map and the white
          .lp panel (progress header → scroll body → sticky footer). */}
      <div className="flow-grid">
        <div className="flow-mapcol">
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
          <div className="flow-mapbox">
            <FlowMap
              home={home}
              cities={cities}
              // Always pass the return city (it feeds the camera framing), but only
              // DRAW the return pin + leg from step 3 on — so navigating steps toggles
              // what's drawn without re-framing, and the default round-trip never
              // pre-draws a line home on the earlier steps.
              returnCity={effectiveReturn}
              drawReturn={step === 'return' || step === 'review'}
              finalPoint={finalPoint}
              hoveredId={hoveredMapId}
              selectedId={selectedMapId}
              cityBadge={cityBadge}
              onCityHover={setHoveredMapId}
              onCityClick={(id) => setSelectedMapId((cur) => (cur === id ? null : id))}
              onMapClick={() => setSelectedMapId(null)}
            />
          </div>
        </div>

        <div className="flow-editcol">
          <div className="lp">
            <div className="flow-lp-h">
              {/* flex:1 + min-width:0 so the progress can shrink and its "next" hint
                  wraps INSIDE this column instead of overflowing and shoving the
                  reset control off the narrow mobile sheet header. */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <FlowProgress
                  steps={visibleSteps}
                  current={stepIdx}
                  accent={isAi ? 'var(--ai)' : 'var(--brand)'}
                  onJump={(i) => setStep(visibleSteps[i].id)}
                />
              </div>
            </div>

            <div className="lp-b scrollbar-thin flow-lp-b">
              {step === 'home' && (isAi ? (
                <PanelAi ctx={{ aiState, prompt, setPrompt, aiComment, home, setHome, returnCity: effectiveReturn, cities, onGenerate }} />
              ) : (
                <StepHome home={home} setHome={setHome} startDate={startDate} setStartDate={setStartDate} />
              ))}
              {step === 'cities' && (
                <StepCities cities={cities} setCities={setCities} home={home} setHome={setHome} startDate={startDate} setStartDate={setStartDate} hoveredId={hoveredMapId} selectedId={selectedMapId} onHover={setHoveredMapId} />
              )}
              {step === 'return' && (
                <StepReturn
                  home={home}
                  lastCity={cities[cities.length - 1] || null}
                  lastCityName={cities[cities.length - 1]?.city_name || t('planner.last_city_fallback')}
                  returnMode={returnMode}
                  setReturnMode={setReturnMode}
                  returnCity={returnCity}
                  setReturnCity={setReturnCity}
                  finalPoint={finalPoint}
                  setFinalPoint={setFinalPoint}
                />
              )}
              {step === 'review' && (
                <StepReview
                  home={home}
                  cities={cities}
                  returnCity={effectiveReturn}
                  finalPoint={finalPoint}
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

            {showFooter && (
              <div className="lp-f flow-foot">
                {!isFirstStep && <Btn variant="secondary" onClick={goPrev} disabled={saving}>{t('planner.back')}</Btn>}
                {/* Reset is a VISIBLE, low-emphasis text button here (not a hidden
                    icon in the header) — nav actions all live in the action bar. */}
                {!isFirstStep && <Btn variant="quiet" icon="refresh" onClick={requestReset} disabled={saving}>{t('planner.reset')}</Btn>}
                <div className="flow-foot__spacer grow" />
                <Btn variant={primaryVariant} onClick={primaryAction} disabled={primaryDisabled}>{primaryLabel}</Btn>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
