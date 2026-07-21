import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { track } from '@/lib/analytics';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { writeRows } from '@/lib/trip-data';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { useActiveTripsLimit, invalidateActiveTripsLimit } from '@/hooks/useActiveTripsLimit';
import { isProActive } from '@/lib/subscription';
import { useTheme } from '@/lib/ThemeContext';
import { resolveCities, reverseGeocode } from '@/lib/geo';
import CountryFlag from '@/components/common/CountryFlag';
import { tzFromCoords } from '@/lib/timezone';
import { localizeCountry } from '@/lib/i18n/format';
import { layoutDates } from '@/lib/tripDates';
import { Icon } from '../design/icons';
import { Btn, EmptyState, Severity, Toggle, useToast } from '../design/index';
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
import '../design/app.css';

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
// .te-citycell / .te-cityname / .te-dts / .te-stepper / .te-step) so the planner
// route looks and behaves identically to the structural editor — same bold city
// names, same nights stepper, same lift-on-drag. No bespoke steppers/fonts. The
// final-point toggle lives once in StepCities (not per row).
// Planner route row. Owns its editing state + pick/remove/nights handlers, then
// delegates LAYOUT to the shared <CityRowBase> (variant="planner") so the planner
// list and the structural editor render the SAME row skeleton — one component,
// two variants. The trailing actions (nights stepper + delete) are the only
// per-screen difference; the final-point toggle still lives on the last card.
function CityRow({ idx, city, isDragging, isPressing, isFinalAnchor, isLast, finalPoint, onToggleFinalPoint, onArm, onChange, onRemove, onMove }) {
  const t = useT();
  const { lang } = useI18n();
  const invalid = !!city.city_name && city.latitude == null;
  const nights = +city.nights || 1;
  const startLabel = city.startDate ? shortDateLabel(city.startDate, lang) : null;
  const endLabel = (city.startDate && city.nights) ? shortDateLabel(addDays(city.startDate, +city.nights), lang) : null;
  // Empty rows open in the picker; once a city is chosen it shows read-only
  // (change a city by deleting + re-adding) so it can never get stuck as an input.
  const [editing, setEditing] = useState(!city.city_name);
  const stopArm = (e) => e.stopPropagation();
  const pick = (picked) => {
    if (picked) {
      onChange({ city_name: picked.city_name, city_name_en: picked.city_name_en, geonameid: picked.geonameid ?? null, name_i18n: picked.name_i18n || null, country: picked.country || localizeCountry(picked.country_code, lang), country_code: picked.country_code, latitude: picked.latitude, longitude: picked.longitude, timezone: picked.timezone, external_city_id: picked.external_city_id });
      setEditing(false);
    } else {
      onChange({ city_name: '', city_name_en: '', geonameid: null, name_i18n: null, country: '', country_code: '', latitude: null, longitude: null, timezone: null, external_city_id: null });
    }
  };

  const grip = (
    <span className="te-grip" role="button" tabIndex={0} aria-label={t('planner.drag')} title={t('planner.drag')}
      onClick={stopArm}
      onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); onMove(-1); } else if (e.key === 'ArrowDown') { e.preventDefault(); onMove(1); } }}>
      <Icon name="drag" size={14} />
    </span>
  );
  const lead = <span className={'te-row__num' + (invalid ? ' is-warn' : '')}>{isFinalAnchor ? <Icon name="flag" size={13} /> : (idx + 1)}</span>;
  const dates = isFinalAnchor
    ? t('planner.final_point')
    : (startLabel ? `${startLabel}${endLabel ? ` – ${endLabel}` : ''}` : null);

  const row = (
    <CityRowBase
      variant="planner"
      className={isFinalAnchor ? 'te-row--fin' : ''}
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
        ? <CityPicker value={city.city_name ? city : null} onChange={pick} placeholder={t('planner.city_ph')} autoFocus={!!city.city_name} />
        : undefined}
    >
      {!isFinalAnchor && (
        <NightsStepper
          value={nights}
          onMinus={() => onChange({ nights: Math.max(1, nights - 1) })}
          onPlus={() => onChange({ nights: Math.min(30, nights + 1) })}
          minusDisabled={nights <= 1}
          plusDisabled={nights >= 30}
        />
      )}
      <button className="te-step te-step--del" onPointerDown={stopArm} onClick={(e) => { e.stopPropagation(); onRemove(); }} title={t('common.delete')} aria-label={t('common.delete')}><Icon name="trash" size={13} /></button>
    </CityRowBase>
  );

  if (!isLast) return row;
  // Last city — its card carries the final-point toggle (the "finish" applies to
  // THIS city), so the control stays attached to the city it governs.
  return (
    <div className={'pl-lastcard' + (finalPoint ? ' is-fin' : '')}>
      {row}
      <div className="pl-fin-sub" onPointerDown={stopArm} onClick={stopArm}>
        <Toggle on={finalPoint} onChange={onToggleFinalPoint} label={t('planner.final_point')} />
        <Icon name="flag" size={13} style={{ color: 'var(--muted)', flexShrink: 0 }} />
        <div className="t-meta" style={{ flex: 1, minWidth: 0 }}>
          <span className="t-ui">{t('planner.final_point')}</span>{' '}
          <span className="muted">{t('planner.final_point_hint')}</span>
        </div>
      </div>
    </div>
  );
}

// TripStartControl extracted to a shared component: src/components/trip/TripStartControl.jsx
// (used by both the create-flow planner and the structural editor — one element).

// ─── Step 1: Home ─────────────────────────────────────────────────────────────

function StepHome({ home, setHome, startDate, setStartDate }) {
  const t = useT();
  const { lang } = useI18n();
  const [geoState, setGeoState] = useState('ask'); // ask | loading | allowed | denied
  const [nearbyCity, setNearbyCity] = useState(null); // detected city from GPS

  const requestGeo = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('loading');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const city = await reverseGeocode(pos.coords.latitude, pos.coords.longitude, lang);
        if (city) {
          const tz = tzFromCoords(city.latitude, city.longitude);
          const full = { ...city, timezone: tz };
          setNearbyCity(full);
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
      <h1 style={{ marginBottom: 10 }}>{t('planner.home_title')}</h1>
      <div className="t-body" style={{ color: 'var(--ink-2)', marginBottom: 22, maxWidth: 540 }}>
        {t('planner.home_desc')}
      </div>

      <h2 className="section-sub">{t('ai_plan.start')}</h2>
      <div className="field-row cols-2" style={{ alignItems: 'end', gridTemplateColumns: '7fr 3fr' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field__label">{t('planner.start_city')} <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 /* design-token-exempt: caps-reset for optional suffix */ }}>· {t('planner.optional')}</span></label>
          <CityPicker value={home} onChange={setHome} placeholder={t('planner.start_city_ph')} autoFocus />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field__label">{t('planner.departure_date')}</label>
          <TripStartControl date={startDate} onStep={(d) => startDate && setStartDate(addDays(startDate, d))} onPickDate={setStartDate} block />
        </div>
      </div>

      {/* "Рядом" section */}
      <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span className="eyebrow" style={{ flex: 1 }}>{t('planner.nearby')}</span>
      </div>

      {geoState === 'ask' && (
        <div className="geo-prompt" style={{ border: '1.5px dashed var(--line)', background: 'var(--surface)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="pin" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-label" style={{ marginBottom: 2 }}>{t('planner.suggest_nearby')}</div>
            <div className="muted t-meta t-sans">{t('planner.geo_hint')}</div>
          </div>
          <Btn variant="primary" size="sm" onClick={requestGeo}>{t('planner.allow')}</Btn>
        </div>
      )}

      {geoState === 'loading' && (
        <div className="geo-prompt" style={{ border: '1.5px dashed var(--line)', background: 'var(--surface)' }}>
          <div style={{ width: 20, height: 20, border: '3px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
          <span className="t-body" style={{ color: 'var(--muted)' }}>{t('planner.detecting')}</span>
        </div>
      )}

      {geoState === 'allowed' && nearbyCity && (
        <div>
          <button onClick={() => setHome(nearbyCity)} style={{
            display: 'flex', width: '100%', alignItems: 'center', gap: 10, padding: '12px 14px',
            background: home?.city_name === nearbyCity.city_name ? 'var(--brand-soft)' : 'var(--surface)',
            border: '1.5px solid ' + (home?.city_name === nearbyCity.city_name ? 'var(--brand)' : 'var(--line)'),
            borderRadius: 11, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
          }}
            onMouseEnter={e => { if (home?.city_name !== nearbyCity.city_name) e.currentTarget.style.borderColor = 'var(--line-hover)'; }}
            onMouseLeave={e => { if (home?.city_name !== nearbyCity.city_name) e.currentTarget.style.borderColor = 'var(--line)'; }}
          >
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="plane" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t-subheading">{nearbyCity.city_name}</div>
              <div className="muted t-meta t-sans"><CountryFlag code={nearbyCity.country_code} /> {nearbyCity.country} · {t('planner.your_city')}</div>
            </div>
            {home?.city_name === nearbyCity.city_name && (
              <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <Icon name="check" size={11} />
              </div>
            )}
          </button>
        </div>
      )}

      {geoState === 'denied' && (
        <div className="geo-prompt" style={{ background: 'var(--wash)', border: '1px solid var(--line-2)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="lock" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-label" style={{ marginBottom: 2 }}>{t('planner.geo_off')}</div>
            <div className="muted t-meta t-sans">{t('planner.geo_off_hint')}</div>
          </div>
          <Btn variant="ghost" size="sm" onClick={requestGeo}>{t('planner.retry_request')}</Btn>
        </div>
      )}

    </div>
  );
}

// ─── Step 2: Cities ───────────────────────────────────────────────────────────

function StepCities({ cities, setCities, home, setHome, finalPoint, setFinalPoint, startDate, setStartDate }) {
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
      <h1 style={{ marginBottom: 10 }}>{t('planner.step_cities')}</h1>
      <div className="t-body" style={{ color: 'var(--ink-2)', marginBottom: 18, maxWidth: 620 }}>
        {t('planner.cities_desc_1')} <b style={{ color: 'var(--ink)' }}>{t('planner.cities_desc_drag')}</b> {t('planner.cities_desc_2')}
      </div>

      {/* "Города" header — section sub-heading + the shared start control on the
          right in one row (mirrors the editor's .ts-routehead: title + control). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 className="section-sub" style={{ margin: 0, flex: 1 }}>{t('planner.cities_heading')}</h2>
        <TripStartControl date={startDate} onStep={(d) => startDate && setStartDate(addDays(startDate, d))} onPickDate={setStartDate} label={t('ai_plan.start')} />
      </div>

      {/* Start anchor — OPTIONAL. Empty → an inline "+ Указать старт" affordance
          (one control for both flows: manual skip + AI no-origin). */}
      <CityAnchorRow label={t('ai_plan.start')} city={home} editable onPick={setHome} />

      {cities.length === 0 ? (
        <div style={{ marginTop: 12 }}>
          <EmptyState
            icon="pin"
            title={t('planner.where_to')}
            body={t('planner.add_first_city')}
            action={<Btn variant="primary" icon="plus" onClick={() => addCity()}>{t('planner.add_city')}</Btn>}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {displayNodes.map((c) => {
            // dIdx = the row's index in the committed order (stable while the
            // preview reorders), used for numbering / isLast; the hook owns the
            // FLIP shuffle and commit.
            const dIdx = cities.indexOf(c);
            return (
              <div key={c.id} ref={setRowRef(c.id)}>
                <CityRow
                  idx={dIdx}
                  city={c}
                  isDragging={draggingId === c.id}
                  isPressing={pressingId === c.id}
                  isLast={dIdx === cities.length - 1}
                  isFinalAnchor={dIdx === cities.length - 1 && finalPoint}
                  finalPoint={finalPoint}
                  onToggleFinalPoint={setFinalPoint}
                  onArm={(e) => armDrag(e, c.id)}
                  onChange={(patch) => update(c.id, patch)}
                  onRemove={() => remove(c.id)}
                  onMove={(dir) => moveNodeById(c.id, dir)}
                />
              </div>
            );
          })}
          <button onClick={() => addCity()} className="t-body" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', background: 'transparent',
            border: '1.5px dashed var(--line)', borderRadius: 12, cursor: 'pointer',
            color: 'var(--muted)',
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--brand)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}
          >
            <Icon name="plus" size={14} /> {t('planner.add_more_city')}
          </button>
        </div>
      )}

      {/* Finish is expressed by the last city's "финиш" switch (below) — no
          separate end/finish plate on this step, unified with the manual flow. */}
    </div>
  );
}

// ─── Step 3: Return ───────────────────────────────────────────────────────────

function StepReturn({ home, lastCityName, returnMode, setReturnMode, returnCity, setReturnCity }) {
  const t = useT();
  // "Домой" is only meaningful with an origin. Without a start there's nowhere
  // to return home to → the round-trip card is hidden and "другой город" is the
  // only mode (matches the optional-start model).
  const canHome = !!home?.city_name;
  useEffect(() => { if (!canHome && returnMode !== 'other') setReturnMode('other'); }, [canHome]);
  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>
        {t('planner.return_title_pre')} <span style={{ color: 'var(--brand)' }}>{lastCityName}</span>?
      </h1>
      <div className="t-body" style={{ color: 'var(--ink-2)', marginBottom: 22, maxWidth: 540 }}>
        {t('planner.return_desc')}
      </div>

      <h2 className="section-sub">{t('planner.step_return')}</h2>
      <div className={'field-row' + (canHome ? ' cols-2' : '')} style={{ marginBottom: 14 }}>
        {canHome && (
          <button onClick={() => setReturnMode('home')} style={{ padding: 16, textAlign: 'left', background: returnMode === 'home' ? 'var(--brand-soft)' : 'var(--surface)', border: '1.5px solid ' + (returnMode === 'home' ? 'var(--brand)' : 'var(--line)'), borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center' }}>
                <Icon name="flag" size={16} />
              </div>
              <div className="t-subheading">{t('planner.return_home', { city: home?.city_name || '…' })}</div>
            </div>
            <div className="muted t-meta t-sans">
              {t('planner.return_home_desc_1')} <b>{lastCityName}</b> {t('planner.return_home_desc_2')}
            </div>
          </button>
        )}

        <button onClick={() => setReturnMode('other')} style={{ padding: 16, textAlign: 'left', background: returnMode === 'other' ? 'var(--brand-soft)' : 'var(--surface)', border: '1.5px solid ' + (returnMode === 'other' ? 'var(--brand)' : 'var(--line)'), borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--warm)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="globe" size={16} />
            </div>
            <div className="t-subheading">{t('planner.return_other')}</div>
          </div>
          <div className="muted t-meta t-sans">
            {t('planner.return_other_desc')}
          </div>
        </button>
      </div>

      {returnMode === 'other' && (
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

      <div style={{ marginTop: 18, padding: '10px 14px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Icon name="info" size={14} style={{ color: 'var(--muted)', marginTop: 2, flexShrink: 0 }} />
        <div className="t-meta" style={{ color: 'var(--muted)' }}>
          {t('planner.return_info')}
        </div>
      </div>

    </div>
  );
}

// ─── Step 5: Review ───────────────────────────────────────────────────────────

function ReviewRow({ num, name, sub, icon, iconColor, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', position: 'relative', zIndex: 1 }}>
      <div className="t-meta" style={{ width: 28, height: 28, borderRadius: '50%', background: icon ? (iconColor || 'var(--brand)') : 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0, border: '3px solid var(--surface)' }}>
        {icon ? <Icon name={icon} size={12} /> : num}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="te-cityname" style={{ color: muted ? 'var(--muted)' : 'var(--ink)' }}>{name || '-'}</div>
        <div className="muted t-meta" style={{ marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 3, color: 'var(--ink)' }}>{label}</div>
      <div className="t-subheading">{value}</div>
      {hint && <div className="muted t-meta" style={{ marginTop: 1 }}>{hint}</div>}
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
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ width: 72, height: 72, margin: '0 auto 18px', borderRadius: 18, background: 'var(--success-soft)', color: 'var(--success)', display: 'grid', placeItems: 'center' }}>
          <Icon name="check" size={36} />
        </div>
        <h1 style={{ marginBottom: 8 }}>{t('planner.created_title')}</h1>
        <div className="muted t-ui" style={{ maxWidth: 460, margin: '0 auto 22px' }}>
          {t('planner.created_desc', { title: displayTitle, cities: cities.length, citiesWord: cities.length === 1 ? t('trip.cities_count_one') : cities.length < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many'), nights: totalNights, nightsWord: totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many') })}
        </div>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <Btn variant="primary" onClick={() => savedTripId && nav(`/trip/${savedTripId}`)}>{t('planner.open_trip')}</Btn>
          <Btn variant="ghost" onClick={() => nav('/trips')}>{t('notif.to_collection')}</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>{t('planner.step_review')}</h1>
      <div className="t-body" style={{ color: 'var(--ink-2)', marginBottom: 22, maxWidth: 620 }}>
        {t('planner.review_desc')}
      </div>

      {/* Trip card preview */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ height: 120, background: heroBg, position: 'relative' }}>
          {hasPhoto && (
            <img src={cover.cover_image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          <div style={{ position: 'absolute', inset: 0, background: 'var(--overlay-grad-soft)' }} />
          <div className="t-title" style={{ position: 'absolute', left: 20, bottom: 14, color: 'white', textShadow: '0 2px 12px rgba(0,0,0,.3)' }}>
            {displayTitle}
          </div>
        </div>

        {/* Stats strip — 3 tiles directly under the hero (TRIP-222) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: '1px solid var(--line-2)' }}>
          <div style={{ padding: '12px 16px', borderRight: '1px solid var(--line-2)' }}>
            <div className="eyebrow" style={{ marginBottom: 3, color: 'var(--ink)' }}>{t('event.start')}</div>
            <div className="t-subheading">{cities[0]?.startDate ? shortDateLabel(cities[0].startDate, lang) : '—'}</div>
            {!cities[0]?.startDate && (
              <div className="t-meta" style={{ color: 'var(--warning)', marginTop: 3 }}>{t('planner.date_required_hint')}</div>
            )}
          </div>
          <div style={{ padding: '12px 16px', borderRight: '1px solid var(--line-2)' }}>
            <Stat label={t('planner.duration')} value={`${totalNights} ${totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many')}`} />
          </div>
          <div style={{ padding: '12px 16px' }}>
            <Stat label={t('planner.cities_stat')} value={cities.length} />
          </div>
        </div>

        <div style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 10, color: 'var(--ink)' }}>{t('planner.route_points', { n: (home ? 1 : 0) + cities.length + (returnCity ? 1 : 0) })}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 13, top: 14, bottom: 14, width: 2, background: 'var(--line-2)' }} />
            {home?.city_name && (
              <ReviewRow icon="flag" iconColor="var(--brand)" name={home.city_name} sub={`${home.country || ''} · ${t('planner.sub_start')}`} muted />
            )}
            {cities.map((c, i) => {
              // Last city with the finish switch on → the endpoint marker (single
              // blue flag, unified with the start), not a numbered stop.
              const isFin = finalPoint && i === cities.length - 1;
              return (
                <ReviewRow
                  key={c.id}
                  num={isFin ? undefined : i + 1}
                  icon={isFin ? 'flag' : undefined}
                  iconColor={isFin ? 'var(--brand)' : undefined}
                  name={c.city_name}
                  sub={isFin
                    ? `${c.country || '-'} · ${t('planner.sub_finish')}`
                    : `${c.country || '-'} · ${c.nights} ${c.nights == 1 ? t('view.nights_one') : c.nights < 5 ? t('view.nights_few') : t('view.nights_many')}${c.startDate ? ` · ${t('planner.from_date_prefix')} ${c.startDate}` : ''}`}
                  muted={isFin}
                />
              );
            })}
            {returnCity?.city_name && (
              <ReviewRow icon="flag" iconColor="var(--brand)" name={returnCity.city_name} sub={`${returnCity.country || ''} · ${t('planner.sub_return')}`} muted />
            )}
          </div>
        </div>
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

      {error && (
        <div style={{ marginTop: 12 }}>
          <Severity level="error">{error}</Severity>
        </div>
      )}

      {saving && (
        <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12, rgba(59,91,219,.12))', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 16, height: 16, border: '2px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />
          <div className="t-body" style={{ flex: 1, color: 'var(--ink-2)' }}>{t('planner.saving_msg')}</div>
        </div>
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
    // call): a one-way end (a distinct final city, not the origin) becomes the
    // LAST city with the "финиш" switch ON (finalPoint) — the "Возврат" step is
    // then skipped, exactly like a manual finish, no separate return node. A
    // round-trip (end == origin) or no end → switch OFF, return defaults to
    // "home" (manual default) and the "Возврат" step is shown.
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
      const { data, error: fnErr } = await invokeFn('planTripWithAi', {
        body: { sessionId, prompt: promptText, language: lang || 'ru' },
      });
      if (fnErr) {
        // TRIP-111: серверный rate-limit генераций → понятное сообщение вместо
        // общего «не удалось». supabase.functions.invoke кладёт Response в .context.
        // Мутируем message и бросаем ОРИГИНАЛ (invokeFn пометил его __seamHandled),
        // иначе new Error теряет стамп → MutationCache.onError задваивает репорт.
        if (fnErr?.context?.status === 429) { fnErr.message = t('ai_plan.error_rate_limited'); throw fnErr; }
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
      toast({
        title: t('ai_plan.error_plan_title'),
        description: err?.message || t('ai_plan.error_plan_desc'),
        variant: 'destructive',
      });
    },
  });
  const onGenerate = (promptText) => { if (promptText) planMut.mutate({ promptText }); };

  // Visible steps - "Возврат" is skipped when the last city is the finish point.
  // The entry step's label depends on the method (origin vs AI prompt).
  const entryLabel = isAi ? t('planner.step_home_ai') : t('planner.step_home');
  const visibleSteps = (finalPoint ? STEPS.filter(s => s.id !== 'return') : STEPS)
    .map(s => ({ ...s, label: s.id === 'home' ? entryLabel : t(s.labelKey) }));
  const goNext = () => {
    const i = visibleSteps.findIndex(s => s.id === step);
    if (i >= 0 && i < visibleSteps.length - 1) setStep(visibleSteps[i + 1].id);
  };
  const goPrev = () => {
    const i = visibleSteps.findIndex(s => s.id === step);
    if (i > 0) setStep(visibleSteps[i - 1].id);
  };

  // If the active step becomes hidden (toggled finalPoint while on "return"),
  // fall back to the skeleton step.
  useEffect(() => {
    if (!visibleSteps.some(s => s.id === step)) setStep('cities');
  }, [finalPoint]);

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
      // RLS requires created_by = auth.uid(). The profiles table may diverge
      // from the session, so always pull the id straight from the session.
      const { data: authUser, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authUser?.user?.id) {
        throw new Error(t('planner.err_no_session'));
      }
      const authId = authUser.user.id;

      // 1. Create trip via SECURITY DEFINER RPC (bypasses RLS caching issues)
      const { data: tripId, error: tripErr } = await supabase
        .rpc('create_trip', { p_title: title, p_description: '' });
      if (tripErr) throw tripErr;
      const trip = { id: tripId };

      // 1b. Persist cover (gradient or uploaded image). The RPC doesn't accept
      // cover fields; trips is Ярус B (TRIP-190) — no direct client write — so the
      // cover goes through the updateTripSettings edge (service_role, whitelisted cols).
      if (cover?.cover_gradient || cover?.cover_image_url) {
        // Cover was uploaded before the trip existed (draft prefix) — move it
        // under <tripId>/ and re-sign before persisting the URL.
        const finalCoverUrl = cover.cover_image_url
          ? await finalizeDraftCover(trip.id, cover.cover_image_url)
          : null;
        const { error: coverErr } = await invokeFn('updateTripSettings', {
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
        if (coverErr) console.error('Failed to set cover:', coverErr);
      }

      // 2. Build city_visits list with full data
      const visitsToInsert = [];

      // Home city → kind: 'start'
      if (home?.city_name) {
        visitsToInsert.push({
          trip_id: trip.id,
          external_city_id: home.external_city_id || null,
          geonameid: home.geonameid ?? null,
          name_i18n: home.name_i18n || null,
          city_name_en: home.city_name_en || null,
          country_code: home.country_code || null,
          latitude: home.latitude || null,
          longitude: home.longitude || null,
          timezone: home.timezone || null,
          kind: 'start',
          start_date: null,
          end_date: null,
          created_by: authId,
        });
      }

      // Transit cities → kind:'transit'. When finalPoint is on, the LAST
      // city is the trip's finish anchor → save as kind:'end' with NO
      // dates at all. start/end anchors are pure markers; trip dates are
      // derived from the first/last transit city's datetimes.
      cities.forEach((c, i) => {
        if (!c.city_name) return;
        const isFinalAnchor = finalPoint && i === cities.length - 1;
        visitsToInsert.push({
          trip_id: trip.id,
          external_city_id: c.external_city_id || null,
          geonameid: c.geonameid ?? null,
          name_i18n: c.name_i18n || null,
          city_name_en: c.city_name_en || null,
          country_code: c.country_code || null,
          latitude: c.latitude || null,
          longitude: c.longitude || null,
          timezone: c.timezone || null,
          kind: isFinalAnchor ? 'end' : 'transit',
          start_date: isFinalAnchor ? null : (c.startDate || null),
          end_date: isFinalAnchor ? null : (c.startDate && c.nights ? addDays(c.startDate, +c.nights) : null),
          created_by: authId,
        });
      });

      // Return city → kind: 'end'. Created even when returnMode === 'home'
      // (home equals return), so the cityN → end leg always exists in the
      // timeline and the "no transfer" warning / route shows up correctly.
      if (effectiveReturn?.city_name) {
        visitsToInsert.push({
          trip_id: trip.id,
          external_city_id: effectiveReturn.external_city_id || null,
          geonameid: effectiveReturn.geonameid ?? null,
          name_i18n: effectiveReturn.name_i18n || null,
          city_name_en: effectiveReturn.city_name_en || null,
          country_code: effectiveReturn.country_code || null,
          latitude: effectiveReturn.latitude || null,
          longitude: effectiveReturn.longitude || null,
          timezone: effectiveReturn.timezone || null,
          kind: 'end',
          created_by: authId,
        });
      }

      if (visitsToInsert.length > 0) {
        // position = array index: visitsToInsert is built in itinerary order, so
        // (start_datetime, position) reproduces it.
        const withPos = visitsToInsert.map((v, i) => ({ ...v, position: i }));
        await writeRows(supabase.from('city_visits').insert(withPos));
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
      track('trip_created', { method, city_count: visitsToInsert.length, trip_id: trip.id });
      setSavedOk(true);
      setSavedTripId(trip.id);
    } catch (err) {
      console.error('Failed to save trip:', err);
      track('trip_create_failed', { method, reason: err?.message || 'unknown' });
      setError(err.message || t('planner.err_save_failed'));
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
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      </div>
    );
  }

  if (isOverLimit && !savedOk) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <AppHeader
          user={user}
          isPro={isPro}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onBack={() => nav('/trips')}
          backTitle={t('notif.to_collection')}
        />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>
              <Icon name="lock" size={28} />
            </div>
            <h2 className="t-heading" style={{ margin: '0 0 8px' }}>{t('planner.limit_title')}</h2>
            <p className="t-ui" style={{ color: 'var(--muted)', marginBottom: 24 }}>
              {t('planner.limit_desc_pre')} <strong>{t('planner.limit_desc_strong')}</strong>{t('planner.limit_desc_post')}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Btn variant="ghost" onClick={() => nav('/trips')}>{t('planner.to_trips')}</Btn>
              <Btn variant="primary" onClick={() => nav('/pro?hidePerTrip=1&from=paywall&feature=trip_limit')}>{t('sub.go_pro')}</Btn>
            </div>
          </div>
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
          <div className="flow-mapbox">
            <FlowMap
              home={home}
              cities={cities}
              returnCity={effectiveReturn}
              finalPoint={finalPoint}
            />
          </div>
        </div>

        <div className="flow-editcol">
          <div className="lp">
            <div className="flow-lp-h">
              <FlowProgress
                steps={visibleSteps}
                current={stepIdx}
                accent={isAi ? 'var(--ai)' : 'var(--brand)'}
                onJump={(i) => setStep(visibleSteps[i].id)}
              />
            </div>

            <div className="lp-b scrollbar-thin flow-lp-b">
              {step === 'home' && (isAi ? (
                <PanelAi ctx={{ aiState, prompt, setPrompt, aiComment, home, setHome, returnCity: effectiveReturn, cities, onGenerate }} />
              ) : (
                <StepHome home={home} setHome={setHome} startDate={startDate} setStartDate={setStartDate} />
              ))}
              {step === 'cities' && (
                <StepCities cities={cities} setCities={setCities} home={home} setHome={setHome} startDate={startDate} setStartDate={setStartDate} finalPoint={finalPoint} setFinalPoint={setFinalPoint} />
              )}
              {step === 'return' && (
                <StepReturn
                  home={home}
                  lastCityName={cities[cities.length - 1]?.city_name || t('planner.last_city_fallback')}
                  returnMode={returnMode}
                  setReturnMode={setReturnMode}
                  returnCity={returnCity}
                  setReturnCity={setReturnCity}
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
                {!isFirstStep && <Btn variant="ghost" onClick={goPrev} disabled={saving}>{t('planner.back')}</Btn>}
                {!isFirstStep && <Btn variant="ghost" icon="refresh" onClick={requestReset} disabled={saving}>{t('planner.reset')}</Btn>}
                <div className="flow-foot__spacer" style={{ flex: 1 }} />
                <Btn variant={primaryVariant} onClick={primaryAction} disabled={primaryDisabled}>{primaryLabel}</Btn>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
