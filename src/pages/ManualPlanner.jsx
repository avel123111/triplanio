import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { mapboxgl, MAPBOX_TOKEN, styleFor, fitToPoints, htmlMarkerEl, lineFeature, setLineLayer } from '@/lib/mapbox';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { isTripInPast } from '@/lib/trip-dates';
import { isProActive } from '@/lib/subscription';
import { useTheme } from '@/lib/ThemeContext';
import { searchCities, getTimezone, countryFlag, reverseGeocode } from '@/lib/geo';
import { Icon } from '../design/icons';
import { Btn } from '../design/index';
import HeaderActions from '@/components/HeaderActions';
import { groupMarkers, markerSvg, MISSING_COLOR } from '@/lib/mapRoute';
import { fetchOsrmRoute, geodesicLine, isFlightTransport, isRoadTransport } from '@/lib/routing';
import TripCoverPicker from '@/components/trips/TripCoverPicker';
import { getGradientById } from '@/lib/trip-gradients';
import '../design/app.css';

// ─── Static data ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: 'home',      num: 1, label: 'Откуда' },
  { id: 'cities',    num: 2, label: 'Скелет трипа' },
  { id: 'return',    num: 3, label: 'Возврат' },
  { id: 'transport', num: 4, label: 'Транспорт' },
  { id: 'review',    num: 5, label: 'Финальный драфт' },
];

// Transport kinds for the per-leg picker.
const TRANSPORT_KINDS = [
  { id: 'plane', icon: 'plane', label: 'Самолёт' },
  { id: 'train', icon: 'train', label: 'Поезд'   },
  { id: 'bus',   icon: 'bus',   label: 'Автобус' },
  { id: 'ferry', icon: 'ferry', label: 'Паром'   },
  { id: 'car',   icon: 'car',   label: 'На авто' },
  { id: 'walk',  icon: 'walk',  label: 'Пешком'  },
];

// Crude default — long international hops → plane, else train.
function defaultKindFor(fromName, toName) {
  const longHaul = ['Москва','Санкт-Петербург','Дубай','Тбилиси','Стамбул','Минск','Хельсинки','Токио','Нью-Йорк','Лондон'];
  if (longHaul.includes(fromName) || longHaul.includes(toName)) return 'plane';
  return 'train';
}

// Storage key is user-specific to prevent draft leaking between accounts
const storageKey = (userId) => `triplanio-planner-${userId || 'guest'}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Build ordered legs for the transport step and save function.
function computeLegs(home, cities, effectiveReturn, finalPoint) {
  const stops = [];
  if (home?.city_name) stops.push(home);
  cities.forEach(c => stops.push(c));
  // If not finalPoint and there's a meaningful return city, append it
  const lastCity = cities[cities.length - 1];
  if (!finalPoint && effectiveReturn?.city_name && effectiveReturn.city_name !== lastCity?.city_name) {
    stops.push(effectiveReturn);
  }
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) {
    legs.push({ id: `leg_${i}`, from: stops[i], to: stops[i + 1] });
  }
  return legs;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function recomputeDates(list) {
  // Only recompute if the first city has an anchor date — otherwise leave dates alone
  if (list.length === 0 || !list[0].startDate) return list;
  let cursor = new Date(list[0].startDate + 'T00:00:00');
  return list.map((c, i) => {
    if (i === 0) {
      cursor.setDate(cursor.getDate() + (+c.nights || 0));
      return c;
    }
    const d = new Date(cursor);
    cursor.setDate(cursor.getDate() + (+c.nights || 0));
    return { ...c, startDate: d.toISOString().slice(0, 10) };
  });
}

// ─── Stepper ─────────────────────────────────────────────────────────────────

function Stepper({ currentId, onJump, finalPoint }) {
  const visibleSteps = finalPoint ? STEPS.filter(s => s.id !== 'return') : STEPS;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {visibleSteps.map((s, i) => {
        const isCurrent = s.id === currentId;
        const myIdx = STEPS.findIndex(x => x.id === s.id);
        const curIdx = STEPS.findIndex(x => x.id === currentId);
        const isPast = curIdx > myIdx;
        return (
          <React.Fragment key={s.id}>
            <button
              onClick={() => isPast && onJump(s.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 10px',
                background: isCurrent ? 'var(--brand-soft)' : 'transparent',
                border: 'none', borderRadius: 999,
                cursor: isPast ? 'pointer' : 'default',
              }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: '50%',
                background: isCurrent ? 'var(--brand)' : isPast ? 'var(--success)' : 'var(--wash)',
                color: isCurrent || isPast ? 'white' : 'var(--muted-2)',
                display: 'grid', placeItems: 'center',
                fontSize: 11, fontWeight: 700, flexShrink: 0,
                border: isPast || isCurrent ? 'none' : '1px solid var(--line)',
              }}>
                {isPast ? <Icon name="check" size={11} /> : s.num}
              </div>
              <span style={{ fontSize: 12.5, fontWeight: isCurrent ? 600 : 500, color: isCurrent ? 'var(--brand)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
                {s.label}
              </span>
            </button>
            {i < visibleSteps.length - 1 && (
              <div style={{ width: 16, height: 2, background: isPast ? 'var(--success)' : 'var(--line)', margin: '0 2px' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── CityPicker ──────────────────────────────────────────────────────────────

function CityPicker({ value, onChange, placeholder, autoFocus, style: extStyle }) {
  const [q, setQ] = useState(value?.city_name || '');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);

  // Sync display when value changes externally
  useEffect(() => {
    setQ(value?.city_name || '');
  }, [value?.city_name]);

  const runSearch = (query) => {
    clearTimeout(timerRef.current);
    if (query.length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const r = await searchCities(query, 'ru');
      setResults(r);
      setLoading(false);
      setOpen(r.length > 0);
    }, 350);
  };

  const handleChange = (e) => {
    const val = e.target.value;
    setQ(val);
    if (value) onChange(null); // clear selection when user types
    runSearch(val);
  };

  const handleSelect = async (city) => {
    setOpen(false);
    setResults([]);
    setQ(city.city_name);
    setLoading(true);
    const tz = await getTimezone(city.latitude, city.longitude);
    setLoading(false);
    onChange({ ...city, timezone: tz });
  };

  const handleBlur = () => {
    // Delay to allow mousedown on dropdown items
    setTimeout(() => setOpen(false), 200);
  };

  return (
    <div style={{ position: 'relative', ...extStyle }}>
      <div style={{ position: 'relative' }}>
        <Icon
          name="pin" size={15}
          style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: value ? 'var(--brand)' : 'var(--muted-2)', pointerEvents: 'none' }}
        />
        <input
          className="input"
          value={q}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={handleBlur}
          placeholder={placeholder || 'Поиск города…'}
          style={{ paddingLeft: 36, paddingRight: loading ? 36 : 12, fontSize: 15 }}
          autoFocus={autoFocus}
        />
        {loading && (
          <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, border: '2px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
        )}
      </div>
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,.12)', overflow: 'hidden', maxHeight: 260, overflowY: 'auto',
        }}>
          {results.map((c) => (
            <button
              key={c.external_city_id}
              onMouseDown={() => handleSelect(c)}
              style={{
                width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none',
                borderBottom: '1px solid var(--line-2)', background: 'transparent', cursor: 'pointer',
                display: 'flex', gap: 10, alignItems: 'center',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--wash)'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{countryFlag(c.country_code)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.city_name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.display_name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Map (Mapbox GL) ──────────────────────────────────────────────────────────

const PLANNER_ROUTE_COLOR = '#5b6cff';

function PlannerMap({ home, cities, returnCity, transport = {}, finalPoint = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const readyRef = useRef(false);

  const pts = [];
  if (home?.latitude) pts.push({ lat: home.latitude, lng: home.longitude, label: '🏠', name: home.city_name });
  cities.forEach((c, i) => {
    if (c.latitude) pts.push({ lat: c.latitude, lng: c.longitude, label: String(i + 1), name: c.city_name });
  });
  if (returnCity?.latitude && returnCity.city_name !== home?.city_name) {
    pts.push({ lat: returnCity.latitude, lng: returnCity.longitude, label: '↩', name: returnCity.city_name });
  }

  const positions = pts.map((p) => [p.lng, p.lat]); // [lng, lat] for Mapbox
  const groups = groupMarkers(pts);
  const totalNights = cities.reduce((n, c) => n + (+c.nights || 0), 0);
  // Legs match the IDs used by StepTransport so the picker's choice maps to the
  // right polyline. computeLegs already knows how to handle finalPoint.
  const legs = computeLegs(home, cities, returnCity, finalPoint);

  const ptsKey = pts.map((p) => `${p.lat},${p.lng}`).join('|');
  const legsKey = legs.map((l) => `${l.from?.latitude},${l.from?.longitude}|${l.to?.latitude},${l.to?.longitude}|${transport[l.id]?.kind || ''}`).join('::');

  // Init map once (container is always mounted; empty-state overlays on top).
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !MAPBOX_TOKEN) return undefined;
    const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleFor(dark ? 'DARK' : 'LIGHT'),
      center: positions[0] || [15, 50],
      zoom: 4,
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;
    map.on('load', () => { readyRef.current = true; });
    return () => { map.remove(); mapRef.current = null; readyRef.current = false; };
  }, []);

  // Numbered markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const draw = () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      groups.forEach((g) => {
        const marker = new mapboxgl.Marker({ element: htmlMarkerEl(markerSvg(g.labels, false)) }).setLngLat([g.lng, g.lat]).addTo(map);
        markersRef.current.push(marker);
      });
      if (positions.length) fitToPoints(map, positions, { padding: 28, maxZoom: 7, singleZoom: 8 });
    };
    if (readyRef.current) draw(); else map.once('load', draw);
    return undefined;
  }, [ptsKey]);

  // Route lines: dashed = no transport, solid = flight/road/other; road via OSRM.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let cancelled = false;
    const draw = () => {
      const dashed = [];
      const solid = [];
      const roadTasks = [];
      legs.forEach((leg) => {
        if (!leg.from?.latitude || !leg.to?.latitude) return;
        const straight = [[leg.from.longitude, leg.from.latitude], [leg.to.longitude, leg.to.latitude]];
        const kind = transport[leg.id]?.kind;
        if (!kind) { dashed.push(lineFeature(straight)); return; }
        if (isFlightTransport(kind)) {
          const arc = geodesicLine(leg.from.latitude, leg.from.longitude, leg.to.latitude, leg.to.longitude).map(([la, lo]) => [lo, la]);
          solid.push(lineFeature(arc));
        } else if (isRoadTransport(kind)) {
          const idx = solid.length;
          solid.push(lineFeature(straight));
          roadTasks.push({ idx, leg, kind });
        } else {
          solid.push(lineFeature(straight));
        }
      });
      setLineLayer(map, 'planner-dashed', dashed, { color: MISSING_COLOR, width: 2, dashed: true, opacity: 0.5 });
      setLineLayer(map, 'planner-solid', solid, { color: PLANNER_ROUTE_COLOR, width: 3.5 });
      (async () => {
        for (const task of roadTasks) {
          const route = await fetchOsrmRoute(task.leg.from.latitude, task.leg.from.longitude, task.leg.to.latitude, task.leg.to.longitude, task.kind);
          if (cancelled || !mapRef.current) return;
          const coords = route && route.length > 1 ? route.map(([la, lo]) => [lo, la]) : null;
          if (coords) { solid[task.idx] = lineFeature(coords); setLineLayer(map, 'planner-solid', solid, { color: PLANNER_ROUTE_COLOR, width: 3.5 }); }
        }
      })();
    };
    if (readyRef.current) draw(); else map.once('load', draw);
    return () => { cancelled = true; };
  }, [legsKey]);

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="map" size={14} style={{ color: 'var(--brand)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>Маршрут · предпросмотр</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{cities.length} городов</span>
      </div>

      <div style={{ position: 'relative', height: 320 }}>
        <div ref={containerRef} style={{ height: 320, width: '100%' }} />
        {pts.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--wash)', color: 'var(--muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <Icon name="map" size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
              <div style={{ fontSize: 13 }}>Добавь города —<br />маршрут появится здесь</div>
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line-2)', background: 'var(--wash)', fontSize: 11.5, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {home?.city_name && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2167e2', display: 'inline-block' }} />
            {home.city_name}
          </span>
        )}
        {cities.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2167e2', display: 'inline-block' }} />
            {cities.length} {cities.length < 5 ? 'города' : 'городов'}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {totalNights > 0 && <span style={{ fontWeight: 600 }}>{totalNights} ночей</span>}
      </div>
    </div>
  );
}

// ─── FooterNav ────────────────────────────────────────────────────────────────

function FooterNav({ children }) {
  return (
    <div style={{ marginTop: 28, paddingTop: 18, borderTop: '1px solid var(--line-2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

// ─── CityAnchorRow ────────────────────────────────────────────────────────────

function CityAnchorRow({ label, city_name, country, kind }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', background: kind === 'home' ? 'var(--brand)' : 'var(--ink-2)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={kind === 'home' ? 'flag' : 'check'} size={14} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="eyebrow" style={{ fontSize: 10, marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>
          {city_name || <span style={{ color: 'var(--muted)' }}>не указан</span>}
          {country && <span className="muted" style={{ fontWeight: 500, marginLeft: 6 }}>{country}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── CityRow ──────────────────────────────────────────────────────────────────

function CityRow({ idx, total, city, isDragging, isOver, isLast, finalPoint, onToggleFinalPoint, onDragStart, onDragOver, onDrop, onDragEnd, onChange, onRemove, onMoveUp, onMoveDown }) {
  // When the last city is also the final point, the card switches to an
  // "end-anchor" look — warm orange tones, flag icon, and the date/nights
  // inputs disappear (the end visit is computed, not entered).
  const isFinalAnchor = isLast && finalPoint;
  const accentColor = isFinalAnchor ? 'var(--warm, #c9603a)' : 'var(--brand)';
  const accentSoft = isFinalAnchor ? 'var(--warm-tint, color-mix(in oklab, var(--warm, #c9603a) 14%, transparent))' : 'var(--brand-soft)';
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        background: isOver ? 'var(--brand-soft)' : isFinalAnchor ? accentSoft : 'var(--surface)',
        border: '1px solid ' + (isOver ? 'var(--brand)' : isFinalAnchor ? accentColor : 'var(--line)'),
        borderRadius: 12,
        opacity: isDragging ? 0.45 : 1,
        transition: 'background .15s, border-color .15s, opacity .15s',
        overflow: 'hidden',
      }}
    >
    <div className="planner-city-row" style={{ padding: '10px 12px' }}>
      {/* Drag handle */}
      <div
        className="planner-city-row__handle"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        title="Перетащить"
        style={{ width: 22, height: 22, borderRadius: 5, display: 'grid', placeItems: 'center', color: 'var(--muted-2)', cursor: 'grab' }}
      >
        <Icon name="drag" size={14} />
      </div>

      {/* Number badge — flag icon when this is the final anchor */}
      <div className="planner-city-row__num" style={{ width: 28, height: 28, borderRadius: '50%', background: accentColor, color: 'white', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
        {isFinalAnchor ? <Icon name="flag" size={13} /> : (idx + 1)}
      </div>

      {/* City search */}
      <div className="planner-city-row__picker" style={{ minWidth: 0 }}>
        <CityPicker
          value={city.city_name ? city : null}
          onChange={(picked) => {
            if (picked) {
              onChange({ city_name: picked.city_name, country: picked.country, country_code: picked.country_code, latitude: picked.latitude, longitude: picked.longitude, timezone: picked.timezone, external_city_id: picked.external_city_id });
            } else {
              onChange({ city_name: '', country: '', country_code: '', latitude: null, longitude: null, timezone: null, external_city_id: null });
            }
          }}
          placeholder="Город"
          style={{ fontSize: 13.5 }}
        />
      </div>

      {/* Date — hidden when this is the final anchor (its date is computed
          from the previous city, not entered) */}
      {!isFinalAnchor && (
        <input
          className="input num planner-city-row__date"
          type="date"
          value={city.startDate || ''}
          onChange={(e) => onChange({ startDate: e.target.value })}
          style={{ fontSize: 12.5 }}
        />
      )}

      {/* Nights — hidden for the final anchor */}
      {!isFinalAnchor && (
        <div className="planner-city-row__nights" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            className="input num"
            type="number" min={1} max={30}
            value={city.nights || ''}
            onChange={(e) => onChange({ nights: Math.max(1, +e.target.value || 1) })}
            style={{ width: 50, padding: '8px 10px', fontSize: 12.5, textAlign: 'center' }}
          />
          <span className="muted" style={{ fontSize: 11 }}>ноч</span>
        </div>
      )}

      {/* Actions */}
      <div className="planner-city-row__actions" style={{ display: 'flex', gap: 2 }}>
        <button onClick={onMoveUp} disabled={idx === 0} title="Выше" style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.3 : 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
          <Icon name="chevU" size={12} />
        </button>
        <button onClick={onMoveDown} disabled={idx === total - 1} title="Ниже" style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent', cursor: idx === total - 1 ? 'default' : 'pointer', opacity: idx === total - 1 ? 0.3 : 1, display: 'grid', placeItems: 'center', color: 'var(--muted)' }}>
          <Icon name="chevD" size={12} />
        </button>
        <button onClick={onRemove} title="Удалить" style={{ width: 26, height: 26, borderRadius: 6, border: 'none', background: 'transparent', cursor: 'pointer', display: 'grid', placeItems: 'center', color: 'var(--muted)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--danger, #e74c3c)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--muted)'}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </div>
    {isLast && (
      <div style={{
        borderTop: '1px dashed ' + (isFinalAnchor ? accentColor : 'var(--line-2)'),
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <button
          type="button"
          role="switch"
          aria-checked={!!finalPoint}
          onClick={() => onToggleFinalPoint?.(!finalPoint)}
          style={{
            width: 36, height: 20, borderRadius: 999,
            border: 'none', cursor: 'pointer', padding: 2,
            background: finalPoint ? accentColor : 'var(--line)',
            transition: 'background .15s', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center',
          }}
        >
          <span style={{
            width: 16, height: 16, borderRadius: '50%',
            background: 'white',
            transform: `translateX(${finalPoint ? 16 : 0}px)`,
            transition: 'transform .15s',
            boxShadow: '0 1px 2px rgba(0,0,0,.15)',
          }} />
        </button>
        <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.4 }}>
          <span style={{ fontWeight: 600 }}>
            <Icon name="flag" size={12} style={{ verticalAlign: -1, marginRight: 4, color: accentColor }} />
            Это финальная точка трипа
          </span>
          <span className="muted" style={{ marginLeft: 6 }}>
            — возврат не нужен, шаг «Возврат» будет пропущен
          </span>
        </div>
      </div>
    )}
    </div>
  );
}

// ─── Step 1: Home ─────────────────────────────────────────────────────────────

function StepHome({ home, setHome, startDate, setStartDate, goNext }) {
  const [geoState, setGeoState] = useState('ask'); // ask | loading | allowed | denied
  const [nearbyCity, setNearbyCity] = useState(null); // detected city from GPS

  const startDateLabel = useMemo(() => {
    if (!startDate) return null;
    try {
      const d = new Date(startDate + 'T00:00:00');
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
        .replace(',', ' ·');
    } catch { return null; }
  }, [startDate]);

  const requestGeo = () => {
    if (!navigator.geolocation) { setGeoState('denied'); return; }
    setGeoState('loading');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const city = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
        if (city) {
          const tz = await getTimezone(city.latitude, city.longitude);
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
      <h1 style={{ marginBottom: 10 }}>Откуда вы вылетаете?</h1>
      <div className="muted" style={{ fontSize: 15, marginBottom: 22, maxWidth: 540 }}>
        Это твой дом — точка старта и (обычно) возврата. Из него Triplanio покажет переезды и стоимость билетов.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 200px)', gap: 14, alignItems: 'start' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field__label">Город старта</label>
          <CityPicker value={home} onChange={setHome} placeholder="Москва, Тбилиси, Стамбул…" autoFocus />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field__label">Дата вылета</label>
          <div style={{ position: 'relative' }}>
            <Icon name="calendar" size={15}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: startDate ? 'var(--brand)' : 'var(--muted-2)', pointerEvents: 'none' }} />
            <input
              className="input num"
              type="date"
              value={startDate || ''}
              onChange={e => setStartDate?.(e.target.value)}
              style={{ paddingLeft: 36, fontSize: 14, width: '100%' }}
            />
          </div>
          {startDateLabel && (
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{startDateLabel}</div>
          )}
        </div>
      </div>

      {/* "Рядом" section */}
      <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <span className="eyebrow" style={{ flex: 1 }}>Рядом</span>
      </div>

      {geoState === 'ask' && (
        <div style={{ padding: 18, borderRadius: 12, border: '1.5px dashed var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="pin" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>Подсказать города рядом</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Разреши доступ к геолокации — определим твой город автоматически. Можно отказаться и ввести вручную.</div>
          </div>
          <Btn variant="primary" size="sm" onClick={requestGeo}>Разрешить</Btn>
        </div>
      )}

      {geoState === 'loading' && (
        <div style={{ padding: 18, borderRadius: 12, border: '1.5px dashed var(--line)', background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 20, height: 20, border: '3px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
          <span style={{ fontSize: 13, color: 'var(--muted)' }}>Определяем местоположение…</span>
        </div>
      )}

      {geoState === 'allowed' && nearbyCity && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <button onClick={() => setHome(nearbyCity)} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
            background: home?.city_name === nearbyCity.city_name ? 'var(--brand-soft)' : 'var(--surface)',
            border: '1.5px solid ' + (home?.city_name === nearbyCity.city_name ? 'var(--brand)' : 'var(--line)'),
            borderRadius: 11, cursor: 'pointer', textAlign: 'left', transition: 'all .15s',
          }}
            onMouseEnter={e => { if (home?.city_name !== nearbyCity.city_name) e.currentTarget.style.borderColor = '#dbe1ec'; }}
            onMouseLeave={e => { if (home?.city_name !== nearbyCity.city_name) e.currentTarget.style.borderColor = 'var(--line)'; }}
          >
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="plane" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{nearbyCity.city_name}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{countryFlag(nearbyCity.country_code)} {nearbyCity.country} · ваш город</div>
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
        <div style={{ padding: 18, borderRadius: 12, background: 'var(--wash)', border: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 11, background: 'var(--warning-soft)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="lock" size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 2 }}>Геолокация отключена</div>
            <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Воспользуйся поиском выше — введи название города-хаба или ближайший аэропорт.</div>
          </div>
          <Btn variant="ghost" size="sm" onClick={() => setGeoState('ask')}>Запросить снова</Btn>
        </div>
      )}

      <FooterNav>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={goNext} disabled={!home?.city_name}>Дальше →</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 2: Cities ───────────────────────────────────────────────────────────

function StepCities({ cities, setCities, home, finalPoint, setFinalPoint, startDate, goPrev, goNext, onReset }) {
  const [hasError, setHasError] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const addCity = (preset = null) => {
    const base = preset || { external_city_id: null, city_name: '', country: '', country_code: '', latitude: null, longitude: null, timezone: null };
    setCities(cs => recomputeDates([...cs, { id: Date.now(), ...base, startDate: cs[0]?.startDate || startDate || '', nights: preset?.nights || 3 }]));
  };

  const remove = (id) => setCities(cs => recomputeDates(cs.filter(c => c.id !== id)));

  const update = (id, patch) => setCities(cs => {
    const next = cs.map(c => c.id === id ? { ...c, ...patch } : c);
    // Always cascade from the first city's anchor whenever nights or any
    // city's startDate changes — so city[i+1].start always equals city[i].end
    // and you can't end up with a gap or overlap between consecutive cities.
    if ('nights' in patch || 'startDate' in patch) {
      return recomputeDates(next);
    }
    return next;
  });

  const onDragStart = (id) => (e) => { setDragId(id); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (id) => (e) => { e.preventDefault(); if (overId !== id) setOverId(id); };
  const onDrop = (id) => (e) => {
    e.preventDefault();
    if (dragId == null || dragId === id) { setDragId(null); setOverId(null); return; }
    setCities(cs => {
      const fromIdx = cs.findIndex(c => c.id === dragId);
      const toIdx = cs.findIndex(c => c.id === id);
      if (fromIdx < 0 || toIdx < 0) return cs;
      const ns = [...cs];
      const [moved] = ns.splice(fromIdx, 1);
      ns.splice(toIdx, 0, moved);
      // Never recompute dates on drag-drop — user set them explicitly
      return ns;
    });
    setDragId(null);
    setOverId(null);
  };
  const onDragEnd = () => { setDragId(null); setOverId(null); };

  const totalNights = cities.reduce((n, c) => n + (Number(c.nights) || 0), 0);

  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>Скелет трипа</h1>
      <div className="muted" style={{ fontSize: 15, marginBottom: 22, maxWidth: 620 }}>
        Перечисли города в порядке поездки. <b style={{ color: 'var(--ink)' }}>Перетащи</b> карточку за ручку слева — даты пересчитаются автоматически.
      </div>

      <CityAnchorRow label="Старт" city_name={home?.city_name} country={home?.country} kind="home" />

      {cities.length === 0 ? (
        <div style={{ marginTop: 12, padding: 28, border: '1.5px dashed var(--line)', borderRadius: 12, textAlign: 'center', color: 'var(--muted)' }}>
          <Icon name="pin" size={22} style={{ marginBottom: 8, opacity: 0.5 }} />
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Куда поедем?</div>
          <div style={{ fontSize: 12.5, marginBottom: 14 }}>Добавь первый город маршрута.</div>
          <Btn variant="primary" onClick={() => addCity()}>+ Добавить город</Btn>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          {cities.map((c, i) => (
            <CityRow
              key={c.id}
              idx={i}
              total={cities.length}
              city={c}
              isDragging={dragId === c.id}
              isOver={overId === c.id && dragId !== c.id}
              isLast={i === cities.length - 1}
              finalPoint={finalPoint}
              onToggleFinalPoint={setFinalPoint}
              onDragStart={onDragStart(c.id)}
              onDragOver={onDragOver(c.id)}
              onDrop={onDrop(c.id)}
              onDragEnd={onDragEnd}
              onChange={(patch) => update(c.id, patch)}
              onRemove={() => remove(c.id)}
              onMoveUp={() => setCities(cs => { if (i === 0) return cs; const ns = [...cs]; [ns[i-1], ns[i]] = [ns[i], ns[i-1]]; return ns[0]?.startDate ? recomputeDates(ns) : ns; })}
              onMoveDown={() => setCities(cs => { if (i === cs.length-1) return cs; const ns = [...cs]; [ns[i], ns[i+1]] = [ns[i+1], ns[i]]; return ns[0]?.startDate ? recomputeDates(ns) : ns; })}
            />
          ))}
          <button onClick={() => addCity()} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 16px', background: 'transparent',
            border: '1.5px dashed var(--line)', borderRadius: 12, cursor: 'pointer',
            color: 'var(--muted)', fontSize: 13, fontWeight: 500,
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--brand)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.color = 'var(--muted)'; }}
          >
            <Icon name="plus" size={14} /> Добавить ещё город
          </button>
        </div>
      )}

      {hasError && (
        <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--warning-soft, #fff3cd)', border: '1px solid var(--warning, #e6a817)', borderRadius: 10, fontSize: 13, color: 'var(--ink)' }}>
          ⚠️ Добавь хотя бы один город маршрута.
        </div>
      )}

      {cities.length > 0 && (
        <div style={{ marginTop: 22, padding: '12px 16px', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12, rgba(59,91,219,.12))', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Icon name="calendar" size={16} style={{ color: 'var(--brand)' }} />
          <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>
            <b>{cities.length}</b> {cities.length < 5 ? 'города' : 'городов'} · <span className="num">{totalNights}</span> ночей в дороге
          </div>
          <span className="num" style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {cities[0]?.startDate || '—'} → +{totalNights}д
          </span>
        </div>
      )}

      <FooterNav>
        <Btn variant="ghost" onClick={goPrev}>← Назад</Btn>
        <Btn variant="ghost" icon="refresh" onClick={onReset}>Сбросить</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={() => { if (cities.length === 0) { setHasError(true); return; } goNext(); }}>Дальше →</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 3: Return ───────────────────────────────────────────────────────────

function StepReturn({ home, lastCityName, returnMode, setReturnMode, returnCity, setReturnCity, goPrev, goNext, onReset }) {
  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>
        Куда возвращаетесь после <span style={{ color: 'var(--brand)' }}>{lastCityName}</span>?
      </h1>
      <div className="muted" style={{ fontSize: 15, marginBottom: 22, maxWidth: 540 }}>
        Чаще всего домой — но иногда удобнее вылететь в другую точку.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <button onClick={() => setReturnMode('home')} style={{ padding: 16, textAlign: 'left', background: returnMode === 'home' ? 'var(--brand-soft)' : 'var(--surface)', border: '1.5px solid ' + (returnMode === 'home' ? 'var(--brand)' : 'var(--line)'), borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="flag" size={16} />
            </div>
            <div style={{ fontWeight: 600 }}>Домой — в {home?.city_name || '…'}</div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
            Обычный возврат. Triplanio добавит обратный переезд от <b>{lastCityName}</b> в трип.
          </div>
        </button>

        <button onClick={() => setReturnMode('other')} style={{ padding: 16, textAlign: 'left', background: returnMode === 'other' ? 'var(--brand-soft)' : 'var(--surface)', border: '1.5px solid ' + (returnMode === 'other' ? 'var(--brand)' : 'var(--line)'), borderRadius: 12, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--warm, #e67e22)', color: 'white', display: 'grid', placeItems: 'center' }}>
              <Icon name="globe" size={16} />
            </div>
            <div style={{ fontWeight: 600 }}>В другой город</div>
          </div>
          <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
            Если едешь дальше или вылетаешь в другую точку — укажи куда.
          </div>
        </button>
      </div>

      {returnMode === 'other' && (
        <div className="field">
          <label className="field__label">Город возврата</label>
          <CityPicker
            value={returnCity}
            onChange={setReturnCity}
            placeholder="Куда летишь после трипа?"
            autoFocus
          />
        </div>
      )}

      <div style={{ marginTop: 18, padding: '10px 14px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <Icon name="info" size={14} style={{ color: 'var(--muted)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          Можно оставить пустым и добавить обратный переезд позже из таймлайна.
        </div>
      </div>

      <FooterNav>
        <Btn variant="ghost" onClick={goPrev}>← Назад</Btn>
        <Btn variant="ghost" icon="refresh" onClick={onReset}>Сбросить</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={goNext}>Дальше →</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 4: Transport ────────────────────────────────────────────────────────

function StepTransport({ home, cities, effectiveReturn, finalPoint, transport, setTransport, goPrev, goNext, onReset }) {
  const legs = computeLegs(home, cities, effectiveReturn, finalPoint);

  const setLegKind = (legId, kind) => {
    setTransport(t => ({ ...t, [legId]: { kind } }));
  };

  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>Транспорт</h1>
      <div className="muted" style={{ fontSize: 15, marginBottom: 22, maxWidth: 540 }}>
        Выбери, как добираться между городами. Это обновит маршрут на карте и поможет посчитать бюджет.
      </div>

      {legs.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', border: '1.5px dashed var(--line)', borderRadius: 12 }}>
          Нет переездов для выбора транспорта.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {legs.map((leg, i) => {
            const chosen = transport[leg.id]?.kind;
            return (
              <div key={leg.id} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-2)', background: 'var(--wash)', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{leg.from.city_name}</span>
                  <Icon name="chev" size={12} style={{ color: 'var(--muted-2)' }} />
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{leg.to.city_name}</span>
                  {chosen && (
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--success, #27ae60)', fontWeight: 500 }}>
                      {TRANSPORT_KINDS.find(k => k.id === chosen)?.label}
                    </span>
                  )}
                </div>
                <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {TRANSPORT_KINDS.map(k => {
                    const isSelected = chosen === k.id;
                    return (
                      <button
                        key={k.id}
                        onClick={() => setLegKind(leg.id, k.id)}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                          padding: '12px 8px', borderRadius: 10, cursor: 'pointer',
                          background: isSelected ? 'var(--brand-soft)' : 'var(--wash)',
                          border: '1.5px solid ' + (isSelected ? 'var(--brand)' : 'var(--line-2)'),
                          color: isSelected ? 'var(--brand)' : 'var(--ink-2)',
                          fontWeight: isSelected ? 700 : 500, fontSize: 12,
                          transition: 'all .12s',
                        }}
                        onMouseEnter={e => { if (!isSelected) { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.color = 'var(--brand)'; } }}
                        onMouseLeave={e => { if (!isSelected) { e.currentTarget.style.borderColor = 'var(--line-2)'; e.currentTarget.style.color = 'var(--ink-2)'; } }}
                      >
                        <Icon name={k.icon} size={20} />
                        {k.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <FooterNav>
        <Btn variant="ghost" onClick={goPrev}>← Назад</Btn>
        <Btn variant="ghost" icon="refresh" onClick={onReset}>Сбросить</Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={goNext}>Дальше →</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 5: Review ───────────────────────────────────────────────────────────

function ReviewRow({ num, name, sub, icon, iconColor, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0', position: 'relative', zIndex: 1 }}>
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: icon ? (iconColor || 'var(--brand)') : 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0, border: '3px solid var(--surface)' }}>
        {icon ? <Icon name={icon} size={12} /> : num}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: muted ? 'var(--muted)' : 'var(--ink)' }}>{name || '—'}</div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{sub}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 3, fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

function StepReview({ home, cities, returnCity, cover, setCover, tripTitle, setTripTitle, onStartDateChange, saving, savedOk, savedTripId, goPrev, onReset, onSave, error }) {
  const nav = useNavigate();
  const totalNights = cities.reduce((n, c) => n + (Number(c.nights) || 0), 0);
  const autoTitle = cities.length === 0 ? 'Новый трип' : cities.length === 1 ? cities[0].city_name : `${cities[0]?.city_name} → ${cities[cities.length - 1]?.city_name}`;
  const displayTitle = tripTitle || autoTitle;

  const gradient = cover?.cover_gradient ? getGradientById(cover.cover_gradient) : null;
  const hasPhoto = !!cover?.cover_image_url;
  const hasGradient = !hasPhoto && !!gradient;
  const heroBg = hasGradient
    ? gradient.css
    : !hasPhoto
      ? 'linear-gradient(135deg, hsl(210, 60%, 55%) 0%, hsl(195, 55%, 50%) 40%, hsl(25, 65%, 60%) 100%)'
      : 'var(--wash)';

  if (savedOk) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <div style={{ width: 72, height: 72, margin: '0 auto 18px', borderRadius: 18, background: 'var(--success-soft, #d4edda)', color: 'var(--success, #27ae60)', display: 'grid', placeItems: 'center' }}>
          <Icon name="check" size={36} />
        </div>
        <h1 style={{ marginBottom: 8 }}>Трип создан</h1>
        <div className="muted" style={{ fontSize: 15, maxWidth: 460, margin: '0 auto 22px' }}>
          «{displayTitle}» — {cities.length} {cities.length < 5 ? 'города' : 'городов'}, {totalNights} ночей. Можно добавлять отели, переезды и активности.
        </div>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <Btn variant="primary" onClick={() => savedTripId && nav(`/trip/${savedTripId}`)}>Открыть трип →</Btn>
          <Btn variant="ghost" onClick={() => nav('/trips')}>К коллекции</Btn>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ marginBottom: 10 }}>Финальный драфт</h1>
      <div className="muted" style={{ fontSize: 15, marginBottom: 22, maxWidth: 620 }}>
        Проверь, всё ли на месте. После сохранения трип появится в коллекции, и можно будет добавлять детали.
      </div>

      {/* Trip card preview */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ height: 120, background: heroBg, position: 'relative' }}>
          {hasPhoto && (
            <img src={cover.cover_image_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
          {!hasPhoto && !hasGradient && (
            <svg viewBox="0 0 800 200" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}>
              <path d="M0 130 Q 200 80 400 110 T 800 95 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.5)" />
              <path d="M0 160 Q 250 110 450 140 T 800 130 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.3)" />
            </svg>
          )}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,.35) 100%)' }} />
          <div style={{ position: 'absolute', left: 20, bottom: 14, color: 'white', fontWeight: 700, fontSize: 26, letterSpacing: '-0.03em', textShadow: '0 2px 12px rgba(0,0,0,.3)' }}>
            {displayTitle}
          </div>
        </div>

        <div style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Маршрут · {(home ? 1 : 0) + cities.length + (returnCity ? 1 : 0)} точек</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 13, top: 14, bottom: 14, width: 2, background: 'var(--line-2)' }} />
            <ReviewRow icon="flag" iconColor="var(--brand)" name={home?.city_name} sub={`${home?.country || ''} · старт`} muted />
            {cities.map((c, i) => (
              <ReviewRow key={c.id} num={i + 1} name={c.city_name} sub={`${c.country || '—'} · ${c.nights} ${c.nights == 1 ? 'ночь' : c.nights < 5 ? 'ночи' : 'ночей'}${c.startDate ? ` · с ${c.startDate}` : ''}`} />
            ))}
            {returnCity?.city_name && (
              <ReviewRow icon={returnCity.city_name === home?.city_name ? 'flag' : 'globe'} iconColor={returnCity.city_name === home?.city_name ? 'var(--brand)' : 'var(--warm, #e67e22)'} name={returnCity.city_name} sub={`${returnCity.country || ''} · возврат`} muted />
            )}
          </div>

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-2)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 3, fontSize: 10 }}>Начало</div>
              <input
                className="input num"
                type="date"
                value={cities[0]?.startDate || ''}
                onChange={e => onStartDateChange && onStartDateChange(e.target.value)}
                disabled={saving}
                style={{ fontSize: 13, padding: '5px 8px', minWidth: 130 }}
              />
              {!cities[0]?.startDate && (
                <div style={{ fontSize: 10.5, color: 'var(--warning, #e6a817)', marginTop: 3 }}>Укажи дату — иначе даты не сохранятся</div>
              )}
            </div>
            <Stat label="Длительность" value={`${totalNights} ноч.`} />
            <Stat label="Городов" value={cities.length} />
            <Stat label="Бюджет" value="—" hint="Можно указать позже" />
          </div>
        </div>
      </div>

      <div className="field">
        <label className="field__label">Обложка трипа</label>
        <TripCoverPicker
          coverImageUrl={cover?.cover_image_url || ''}
          coverGradient={cover?.cover_gradient || ''}
          onChange={setCover}
        />
      </div>

      <div className="field">
        <label className="field__label">Название трипа</label>
        <input
          className="input"
          value={tripTitle}
          onChange={e => setTripTitle(e.target.value)}
          placeholder={autoTitle}
          disabled={saving}
        />
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: '12px 14px', background: 'var(--danger-soft, #fde8e8)', border: '1px solid var(--danger, #e74c3c)', borderRadius: 10, fontSize: 13, color: 'var(--danger, #e74c3c)' }}>
          {error}
        </div>
      )}

      {saving && (
        <div style={{ marginTop: 14, padding: '12px 14px', background: 'var(--brand-soft)', border: '1px solid var(--brand-soft-12, rgba(59,91,219,.12))', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 16, height: 16, border: '2px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite', flexShrink: 0 }} />
          <div style={{ flex: 1, fontSize: 13, color: 'var(--ink-2)' }}>Сохраняем трип — секунду…</div>
        </div>
      )}

      <FooterNav>
        <Btn variant="ghost" onClick={goPrev} disabled={saving}>← Назад</Btn>
        <Btn variant="ghost" icon="refresh" onClick={onReset} disabled={saving}>Сбросить</Btn>
        <div style={{ flex: 1 }} />
        {saving ? (
          <Btn variant="primary" disabled>Сохраняем…</Btn>
        ) : (
          <Btn variant="primary" onClick={onSave}>Сохранить трип</Btn>
        )}
      </FooterNav>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ManualPlanner() {
  const nav = useNavigate();
  const { user } = useAuth();

  const isPro = isProActive(user);
  const { isDark, toggle: toggleTheme } = useTheme();

  // ── Free-plan limit check ─────────────────────────────────────────────────
  const { data: allTrips = [], isLoading: checkingLimit } = useQuery({
    queryKey: ['trips-limit-check', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('trips').select('id').eq('created_by', user.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id && !isPro,
  });

  const { data: allVisits = [] } = useQuery({
    queryKey: ['visits-limit-check', allTrips.map(t => t.id).join(',')],
    queryFn: async () => {
      const ids = allTrips.map(t => t.id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from('city_visits').select('*').in('trip_id', ids);
      if (error) throw error;
      return data || [];
    },
    enabled: !isPro && allTrips.length > 0,
  });

  const visitsByTrip = React.useMemo(() => {
    const m = {};
    allVisits.forEach(v => { (m[v.trip_id] ||= []).push(v); });
    return m;
  }, [allVisits]);

  const activeTrips = allTrips.filter(t => !isTripInPast(visitsByTrip[t.id] || []));
  const isOverLimit = !isPro && !checkingLimit && activeTrips.length >= 1;

  // ── Wizard state ─────────────────────────────────────────────────────────
  const [step, setStep]             = useState('home');
  const [home, setHome]             = useState(null);
  const [startDate, setStartDateRaw] = useState(''); // YYYY-MM-DD, departure date from home
  const [cities, setCities]         = useState([]);
  const [returnMode, setReturnMode] = useState('home');
  const [returnCity, setReturnCity] = useState(null);
  const [finalPoint, setFinalPoint] = useState(false); // last city is the finish — skip "return"
  const [transport, setTransport]   = useState({});    // legId -> { kind }
  const [tripTitle, setTripTitle]   = useState('');
  const [cover, setCover]           = useState({ cover_image_url: '', cover_gradient: 'gradient_1' });
  const [saving, setSaving]         = useState(false);
  const [savedOk, setSavedOk]       = useState(false);
  const [savedTripId, setSavedTripId] = useState(null);
  const [error, setError]           = useState(null);
  const [restored, setRestored]     = useState(false);

  // Restore from sessionStorage on mount — only for the current user
  useEffect(() => {
    try {
      const key = storageKey(user?.id);
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
        if (saved.transport) setTransport(saved.transport);
        if (saved.startDate) setStartDateRaw(saved.startDate);
        if (saved.cover) setCover(saved.cover);
      }
    } catch {}
    setRestored(true);
  }, [user?.id]); // re-run if user changes (e.g. account switch in same tab)

  // Persist to sessionStorage on every change
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(storageKey(user?.id), JSON.stringify({ step, home, cities, returnMode, returnCity, tripTitle, finalPoint, transport, startDate, cover }));
    } catch {}
  }, [step, home, cities, returnMode, returnCity, tripTitle, finalPoint, transport, startDate, cover, restored, user?.id]);

  // setStartDate also cascades to cities (first city anchors all subsequent dates).
  const setStartDate = (dateStr) => {
    setStartDateRaw(dateStr);
    setCities(cs => {
      if (cs.length === 0) return cs;
      const next = cs.map((c, i) => i === 0 ? { ...c, startDate: dateStr } : c);
      return recomputeDates(next);
    });
  };

  // Skip "return" step when the last city is marked as the finish point.
  const goNext = () => {
    if (step === 'cities' && finalPoint) { setStep('transport'); return; }
    const i = STEPS.findIndex(s => s.id === step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1].id);
  };
  const goPrev = () => {
    if (step === 'transport' && finalPoint) { setStep('cities'); return; }
    const i = STEPS.findIndex(s => s.id === step);
    if (i > 0) setStep(STEPS[i - 1].id);
  };

  // Reset draft and go back to step 1
  const resetToStart = () => {
    setStep('home');
    setHome(null);
    setCities([]);
    setReturnMode('home');
    setReturnCity(null);
    setFinalPoint(false);
    setTransport({});
    setStartDateRaw('');
    setTripTitle('');
    setCover({ cover_image_url: '', cover_gradient: 'gradient_1' });
    setSavedOk(false);
    setSavedTripId(null);
    setError(null);
    try { sessionStorage.removeItem(storageKey(user?.id)); } catch { /* ignore */ }
  };

  // Allow setting trip start date from the Review step — cascades to all cities
  const handleStartDateChange = (dateStr) => {
    setCities(cs => {
      if (cs.length === 0) return cs;
      const next = cs.map((c, i) => i === 0 ? { ...c, startDate: dateStr } : c);
      return recomputeDates(next);
    });
  };

  // When the user marked the last city as the finish, there's no separate
  // return city — the trip ends at the last transit city.
  const effectiveReturn = finalPoint ? null : (returnMode === 'home' ? home : returnCity);
  const mapHighlight = step === 'home' ? 'home' : step === 'return' ? 'return' : step === 'transport' ? 'all' : 'cities';
  const autoTitle = cities.length === 0 ? 'Новый трип' : cities.length === 1 ? cities[0].city_name : `${cities[0]?.city_name} → ${cities[cities.length - 1]?.city_name}`;

  // ── Supabase save ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user) return;

    const title = (tripTitle || autoTitle).trim();
    // Pre-flight validation
    if (cities.length === 0) {
      setError('Добавь хотя бы один город маршрута.');
      return;
    }
    if (!title) {
      setError('Укажи название трипа.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // RLS requires created_by = auth.uid(). The profiles table may diverge
      // from the session, so always pull the id straight from the session.
      const { data: authUser, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authUser?.user?.id) {
        throw new Error('Не удалось получить идентификатор из сессии. Перезайди в аккаунт.');
      }
      const authId = authUser.user.id;

      // 1. Create trip via SECURITY DEFINER RPC (bypasses RLS caching issues)
      const { data: tripId, error: tripErr } = await supabase
        .rpc('create_trip', { p_title: title, p_description: '' });
      if (tripErr) throw tripErr;
      const trip = { id: tripId };

      // 1b. Persist cover (gradient or uploaded image). The RPC doesn't accept
      // cover fields, so update the row immediately after creation.
      if (cover?.cover_gradient || cover?.cover_image_url) {
        const { error: coverErr } = await supabase
          .from('trips')
          .update({
            cover_image_url: cover.cover_image_url || null,
            cover_gradient: cover.cover_gradient || null,
          })
          .eq('id', trip.id);
        if (coverErr) console.error('Failed to set cover:', coverErr);
      }

      // 2. Build city_visits list with full data
      const visitsToInsert = [];

      // Home city → kind: 'start'
      if (home?.city_name) {
        visitsToInsert.push({
          trip_id: trip.id,
          external_city_id: home.external_city_id || null,
          city_name: home.city_name,
          country: home.country || null,
          country_code: home.country_code || null,
          latitude: home.latitude || null,
          longitude: home.longitude || null,
          timezone: home.timezone || null,
          kind: 'start',
          start_datetime: null,
          end_datetime: null,
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
          city_name: c.city_name,
          country: c.country || null,
          country_code: c.country_code || null,
          latitude: c.latitude || null,
          longitude: c.longitude || null,
          timezone: c.timezone || null,
          kind: isFinalAnchor ? 'end' : 'transit',
          start_datetime: isFinalAnchor ? null : (c.startDate ? c.startDate + 'T12:00:00' : null),
          end_datetime: isFinalAnchor ? null : (c.startDate && c.nights ? addDays(c.startDate, +c.nights) + 'T11:00:00' : null),
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
          city_name: effectiveReturn.city_name,
          country: effectiveReturn.country || null,
          country_code: effectiveReturn.country_code || null,
          latitude: effectiveReturn.latitude || null,
          longitude: effectiveReturn.longitude || null,
          timezone: effectiveReturn.timezone || null,
          kind: 'end',
          created_by: authId,
        });
      }

      let insertedVisits = [];
      if (visitsToInsert.length > 0) {
        // position = array index: visitsToInsert is built in itinerary order, so
        // (start_datetime, position) reproduces it. Order is preserved (NOT
        // reordered) because the returned ids are mapped back by index for transfers.
        const withPos = visitsToInsert.map((v, i) => ({ ...v, position: i }));
        const { data: vd, error: visitErr } = await supabase.from('city_visits').insert(withPos).select('id');
        if (visitErr) throw visitErr;
        insertedVisits = vd || [];
      }

      // 3. Create transfers for legs that have a transport kind selected
      if (insertedVisits.length >= 2) {
        const legs = computeLegs(home, cities, effectiveReturn, finalPoint);
        const transfersToInsert = legs
          .map((leg, i) => {
            const kind = transport[leg.id]?.kind;
            if (!kind) return null;
            const fromVisit = insertedVisits[i];
            const toVisit = insertedVisits[i + 1];
            if (!fromVisit || !toVisit) return null;
            return {
              trip_id: trip.id,
              from_city_visit_id: fromVisit.id,
              to_city_visit_id: toVisit.id,
              transport_type: kind,
              created_by: authId,
            };
          })
          .filter(Boolean);
        if (transfersToInsert.length > 0) {
          const { error: transferErr } = await supabase.from('transfers').insert(transfersToInsert);
          if (transferErr) console.error('Failed to create transfers:', transferErr);
        }
      }

      sessionStorage.removeItem(storageKey(user?.id));
      setSavedOk(true);
      setSavedTripId(trip.id);
    } catch (err) {
      console.error('Failed to save trip:', err);
      setError(err.message || 'Не удалось сохранить трип. Попробуй ещё раз.');
    } finally {
      setSaving(false);
    }
  };

  // ── Limit guard ───────────────────────────────────────────────────────────
  if (!isPro && checkingLimit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      </div>
    );
  }

  if (isOverLimit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
        <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
          <button className="app-header__crumb-back" onClick={() => nav('/trips')} title="К коллекции">
            <Icon name="back" size={14} />
          </button>
          <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}><img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} /><span className="app-header__brand-name">Triplanio</span></div>
          <HeaderActions
            user={user}
            isPro={isPro}
            isDark={isDark}
            onToggleTheme={toggleTheme}
          />
        </header>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--warning-soft, #fff3cd)', color: 'var(--warning, #e6a817)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>
              <Icon name="lock" size={28} />
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>Достигнут лимит</h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 24 }}>
              На Free плане доступен только <strong>1 активный трип</strong>. Дождись окончания текущего или перейди на Pro.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Btn variant="ghost" onClick={() => nav('/trips')}>← К трипам</Btn>
              <Btn variant="primary" onClick={() => nav('/pro?hidePerTrip=1')}>Перейти на Pro</Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      {/* Header */}
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <button className="app-header__crumb-back" onClick={() => nav('/trips')} title="К коллекции">
          <Icon name="back" size={14} />
        </button>
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__crumb">
          <span className="app-header__crumb-sep">/</span>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)' }}>Новый трип</span>
        </div>
        <HeaderActions
          user={user}
          isPro={isPro}
          isDark={isDark}
          onToggleTheme={toggleTheme}
        />
      </header>

      {/* Sub-header: stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 24px', borderBottom: '1px solid var(--line-2)', background: 'var(--surface)' }}>
        <div style={{ flex: 1 }} />
        <Stepper currentId={step} onJump={setStep} finalPoint={finalPoint} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: '32px 24px', maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div className="planner-grid">
          {/* Form column */}
          <div style={{ minWidth: 0 }}>
            {step === 'home' && (
              <StepHome home={home} setHome={setHome} startDate={startDate} setStartDate={setStartDate} goNext={goNext} />
            )}
            {step === 'cities' && (
              <StepCities cities={cities} setCities={setCities} home={home} startDate={startDate} finalPoint={finalPoint} setFinalPoint={setFinalPoint} goPrev={goPrev} goNext={goNext} onReset={resetToStart} />
            )}
            {step === 'transport' && (
              <StepTransport
                home={home}
                cities={cities}
                effectiveReturn={effectiveReturn}
                finalPoint={finalPoint}
                transport={transport}
                setTransport={setTransport}
                goPrev={goPrev}
                goNext={goNext}
                onReset={resetToStart}
              />
            )}
            {step === 'return' && (
              <StepReturn
                home={home}
                lastCityName={cities[cities.length - 1]?.city_name || 'последний город'}
                returnMode={returnMode}
                setReturnMode={setReturnMode}
                returnCity={returnCity}
                setReturnCity={setReturnCity}
                goPrev={goPrev}
                goNext={goNext}
                onReset={resetToStart}
              />
            )}
            {step === 'review' && (
              <StepReview
                home={home}
                cities={cities}
                returnCity={effectiveReturn}
                cover={cover}
                setCover={setCover}
                tripTitle={tripTitle}
                setTripTitle={setTripTitle}
                onStartDateChange={handleStartDateChange}
                saving={saving}
                savedOk={savedOk}
                savedTripId={savedTripId}
                goPrev={goPrev}
                onReset={resetToStart}
                onSave={handleSave}
                error={error}
              />
            )}
          </div>

          {/* Map column — sticky on desktop, static on mobile */}
          <div className="planner-map-col">
            <PlannerMap
              home={home}
              cities={cities}
              returnCity={effectiveReturn}
              transport={transport}
              finalPoint={finalPoint}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
