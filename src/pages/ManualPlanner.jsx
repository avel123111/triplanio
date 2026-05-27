import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker as LeafletMarker, Polyline, useMap as useLeafletMap } from 'react-leaflet';
import L from 'leaflet';
import { APIProvider, Map as GMap, Marker as GMarker, useMap as useGMap, useApiLoadingStatus } from '@vis.gl/react-google-maps';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { isTripInPast } from '@/lib/trip-dates';
import { searchCities, getTimezone, countryFlag, reverseGeocode } from '@/lib/geo';
import { Icon } from '../design/icons';
import { Btn } from '../design/index';
import '../design/app.css';

// ─── Static data ──────────────────────────────────────────────────────────────

const STEPS = [
  { id: 'home',   num: 1, label: 'Откуда' },
  { id: 'cities', num: 2, label: 'Скелет трипа' },
  { id: 'return', num: 3, label: 'Возврат' },
  { id: 'review', num: 4, label: 'Финальный драфт' },
];

// Storage key is user-specific to prevent draft leaking between accounts
const storageKey = (userId) => `triplanio-planner-${userId || 'guest'}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function Stepper({ currentId, onJump }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
      {STEPS.map((s, i) => {
        const isCurrent = s.id === currentId;
        const isPast = STEPS.findIndex(x => x.id === currentId) > i;
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
            {i < STEPS.length - 1 && (
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

// ─── Leaflet helpers ──────────────────────────────────────────────────────────

function FitBounds({ positions }) {
  const map = useLeafletMap();
  useEffect(() => {
    if (positions.length === 0) return;
    if (positions.length === 1) {
      map.setView(positions[0], 8, { animate: true });
    } else {
      try {
        map.fitBounds(L.latLngBounds(positions).pad(0.35), { maxZoom: 7, animate: true });
      } catch { /* ignore invalid bounds */ }
    }
  }, [JSON.stringify(positions)]); // eslint-disable-line
  return null;
}

function makeMarkerIcon(label, color, textColor = 'white') {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};color:${textColor};border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;box-shadow:0 3px 8px rgba(0,0,0,.25);border:2px solid white;white-space:nowrap;">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

// ─── Google Maps helpers ──────────────────────────────────────────────────────

// ErrorBoundary — if Google Maps crashes, falls back to Leaflet
class MapErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return this.props.fallback || null;
    return this.props.children;
  }
}

// Draws a dashed polyline using raw Google Maps JS API
function GPolyline({ positions }) {
  const map = useGMap();
  useEffect(() => {
    if (!map || !window.google || positions.length < 2) return;
    const line = new window.google.maps.Polyline({
      path: positions.map(p => ({ lat: p[0], lng: p[1] })),
      strokeColor: '#2167e2',
      strokeOpacity: 0,
      strokeWeight: 0,
      icons: [{
        icon: {
          path: 'M 0,-1 0,1',
          strokeOpacity: 0.7,
          strokeColor: '#2167e2',
          strokeWeight: 2.5,
          scale: 4,
        },
        offset: '0',
        repeat: '20px',
      }],
      map,
    });
    return () => line.setMap(null);
  }, [map, JSON.stringify(positions)]); // eslint-disable-line
  return null;
}

// Fit Google Map to bounds
function GFitBounds({ positions }) {
  const map = useGMap();
  useEffect(() => {
    if (!map || !window.google || positions.length === 0) return;
    if (positions.length === 1) {
      map.setCenter({ lat: positions[0][0], lng: positions[0][1] });
      map.setZoom(8);
    } else {
      try {
        const bounds = new window.google.maps.LatLngBounds();
        positions.forEach(p => bounds.extend({ lat: p[0], lng: p[1] }));
        map.fitBounds(bounds);
      } catch { /* ignore */ }
    }
  }, [map, JSON.stringify(positions)]); // eslint-disable-line
  return null;
}

// Google Maps inner content — also watches for Google's error overlay and calls onError
function GoogleMapInner({ pts, positions, onError }) {
  const map = useGMap();
  const status = useApiLoadingStatus();

  // Detect the Google Maps DOM error overlay (appears when key is invalid/restricted)
  useEffect(() => {
    if (status === 'FAILED') { onError(); return; }
    if (!map) return;
    const timer = setTimeout(() => {
      try {
        const div = map.getDiv?.();
        if (div && div.querySelector('.gm-err-container, .gm-err-content')) {
          onError();
        }
      } catch { /* ignore */ }
    }, 2500);
    return () => clearTimeout(timer);
  }, [map, status]); // eslint-disable-line

  return (
    <>
      <GFitBounds positions={positions} />
      {pts.map((p, i) => (
        <GMarker
          key={i}
          position={{ lat: p.lat, lng: p.lng }}
          label={{
            text: p.label,
            color: 'white',
            fontWeight: 'bold',
            fontSize: '11px',
          }}
        />
      ))}
      {positions.length >= 2 && <GPolyline positions={positions} />}
    </>
  );
}

// ─── PlannerMap ───────────────────────────────────────────────────────────────

const GKEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

function PlannerMap({ home, cities, returnCity }) {
  // If Google Maps fails (bad key, billing, restrictions) — fall back to Leaflet
  const [gmapFailed, setGmapFailed] = useState(false);

  const pts = [];
  if (home?.latitude) pts.push({ lat: home.latitude, lng: home.longitude, label: '🏠', color: '#2167e2', name: home.city_name });
  cities.forEach((c, i) => {
    if (c.latitude) pts.push({ lat: c.latitude, lng: c.longitude, label: String(i + 1), color: '#2167e2', name: c.city_name });
  });
  if (returnCity?.latitude && returnCity.city_name !== home?.city_name) {
    pts.push({ lat: returnCity.latitude, lng: returnCity.longitude, label: '↩', color: '#c9603a', name: returnCity.city_name });
  }

  const positions = pts.map(p => [p.lat, p.lng]);
  const totalNights = cities.reduce((n, c) => n + (+c.nights || 0), 0);

  const leafletMap = (
    <MapContainer
      center={positions[0] || [50, 15]}
      zoom={4}
      style={{ height: 320 }}
      scrollWheelZoom={false}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <FitBounds positions={positions} />
      {pts.map((p, i) => (
        <LeafletMarker key={i} position={[p.lat, p.lng]} icon={makeMarkerIcon(p.label, p.color)} />
      ))}
      {positions.length >= 2 && (
        <Polyline positions={positions} color="#2167e2" weight={2.5} dashArray="6 8" opacity={0.7} />
      )}
    </MapContainer>
  );

  const googleMap = GKEY && !gmapFailed ? (
    <MapErrorBoundary fallback={leafletMap}>
      <APIProvider apiKey={GKEY}>
        <GMap
          style={{ height: 320, width: '100%' }}
          defaultCenter={positions[0] ? { lat: positions[0][0], lng: positions[0][1] } : { lat: 50, lng: 15 }}
          defaultZoom={4}
          gestureHandling="cooperative"
          disableDefaultUI
          mapTypeId="roadmap"
        >
          <GoogleMapInner pts={pts} positions={positions} onError={() => setGmapFailed(true)} />
        </GMap>
      </APIProvider>
    </MapErrorBoundary>
  ) : null;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="map" size={14} style={{ color: 'var(--brand)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>Маршрут · предпросмотр</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>{cities.length} городов</span>
      </div>

      {pts.length === 0 ? (
        <div style={{ height: 320, display: 'grid', placeItems: 'center', background: 'var(--wash)', color: 'var(--muted)' }}>
          <div style={{ textAlign: 'center' }}>
            <Icon name="map" size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
            <div style={{ fontSize: 13 }}>Добавь города —<br />маршрут появится здесь</div>
          </div>
        </div>
      ) : (
        GKEY && !gmapFailed ? googleMap : leafletMap
      )}

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

function CityRow({ idx, total, city, isDragging, isOver, onDragStart, onDragOver, onDrop, onDragEnd, onChange, onRemove, onMoveUp, onMoveDown }) {
  return (
    <div
      className="planner-city-row"
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        padding: '10px 12px',
        background: isOver ? 'var(--brand-soft)' : 'var(--surface)',
        border: '1px solid ' + (isOver ? 'var(--brand)' : 'var(--line)'),
        borderRadius: 12,
        opacity: isDragging ? 0.45 : 1,
        transition: 'background .15s, border-color .15s, opacity .15s',
      }}
    >
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

      {/* Number badge */}
      <div className="planner-city-row__num" style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
        {idx + 1}
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

      {/* Date */}
      <input
        className="input num planner-city-row__date"
        type="date"
        value={city.startDate || ''}
        onChange={(e) => onChange({ startDate: e.target.value })}
        style={{ fontSize: 12.5 }}
      />

      {/* Nights */}
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
  );
}

// ─── Step 1: Home ─────────────────────────────────────────────────────────────

function StepHome({ home, setHome, goNext }) {
  const [geoState, setGeoState] = useState('ask'); // ask | loading | allowed | denied
  const [nearbyCity, setNearbyCity] = useState(null); // detected city from GPS

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

      <div className="field">
        <label className="field__label">Город старта</label>
        <CityPicker value={home} onChange={setHome} placeholder="Москва, Тбилиси, Стамбул…" autoFocus />
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

function StepCities({ cities, setCities, home, goPrev, goNext }) {
  const [hasError, setHasError] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  const addCity = (preset = null) => {
    const base = preset || { external_city_id: null, city_name: '', country: '', country_code: '', latitude: null, longitude: null, timezone: null };
    setCities(cs => recomputeDates([...cs, { id: Date.now(), ...base, startDate: cs[0]?.startDate || '', nights: preset?.nights || 3 }]));
  };

  const remove = (id) => setCities(cs => recomputeDates(cs.filter(c => c.id !== id)));

  const update = (id, patch) => setCities(cs => {
    const next = cs.map(c => c.id === id ? { ...c, ...patch } : c);
    if ('nights' in patch || ('startDate' in patch && cs[0]?.id === id)) {
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
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={() => { if (cities.length === 0) { setHasError(true); return; } goNext(); }}>Дальше →</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 3: Return ───────────────────────────────────────────────────────────

function StepReturn({ home, lastCityName, returnMode, setReturnMode, returnCity, setReturnCity, goPrev, goNext }) {
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
        <div style={{ flex: 1 }} />
        <Btn variant="primary" onClick={goNext}>Дальше →</Btn>
      </FooterNav>
    </div>
  );
}

// ─── Step 4: Review ───────────────────────────────────────────────────────────

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

function StepReview({ home, cities, returnCity, tripTitle, setTripTitle, onStartDateChange, saving, savedOk, savedTripId, goPrev, onSave, error }) {
  const nav = useNavigate();
  const totalNights = cities.reduce((n, c) => n + (Number(c.nights) || 0), 0);
  const autoTitle = cities.length === 0 ? 'Новый трип' : cities.length === 1 ? cities[0].city_name : `${cities[0]?.city_name} → ${cities[cities.length - 1]?.city_name}`;
  const displayTitle = tripTitle || autoTitle;

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
        <div style={{ height: 120, background: 'linear-gradient(135deg, hsl(210, 60%, 55%) 0%, hsl(195, 55%, 50%) 40%, hsl(25, 65%, 60%) 100%)', position: 'relative' }}>
          <svg viewBox="0 0 800 200" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }}>
            <path d="M0 130 Q 200 80 400 110 T 800 95 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.5)" />
            <path d="M0 160 Q 250 110 450 140 T 800 130 L 800 200 L 0 200 Z" fill="rgba(255,255,255,.3)" />
          </svg>
          <div style={{ position: 'absolute', left: 20, bottom: 14, color: 'white', fontWeight: 700, fontSize: 26, letterSpacing: '-0.03em', textShadow: '0 2px 12px rgba(0,0,0,.3)' }}>
            {displayTitle}
          </div>
        </div>

        <div style={{ padding: 18 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Маршрут · {2 + cities.length} точек</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 13, top: 14, bottom: 14, width: 2, background: 'var(--line-2)' }} />
            <ReviewRow icon="flag" iconColor="var(--brand)" name={home?.city_name} sub={`${home?.country || ''} · старт`} muted />
            {cities.map((c, i) => (
              <ReviewRow key={c.id} num={i + 1} name={c.city_name} sub={`${c.country || '—'} · ${c.nights} ${c.nights == 1 ? 'ночь' : c.nights < 5 ? 'ночи' : 'ночей'}${c.startDate ? ` · с ${c.startDate}` : ''}`} />
            ))}
            <ReviewRow icon={returnCity?.city_name === home?.city_name ? 'flag' : 'globe'} iconColor={returnCity?.city_name === home?.city_name ? 'var(--brand)' : 'var(--warm, #e67e22)'} name={returnCity?.city_name} sub={`${returnCity?.country || ''} · возврат`} muted />
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

  const isPro = ['pro_monthly', 'pro_yearly', 'pro_trip'].includes(user?.subscription_status);

  // ── Free-plan limit check ─────────────────────────────────────────────────
  const { data: allTrips = [], isLoading: checkingLimit } = useQuery({
    queryKey: ['trips-limit-check', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('trips').select('id').eq('created_by', user.email);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email && !isPro,
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
  const [cities, setCities]         = useState([]);
  const [returnMode, setReturnMode] = useState('home');
  const [returnCity, setReturnCity] = useState(null);
  const [tripTitle, setTripTitle]   = useState('');
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
      }
    } catch {}
    setRestored(true);
  }, [user?.id]); // re-run if user changes (e.g. account switch in same tab)

  // Persist to sessionStorage on every change
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(storageKey(user?.id), JSON.stringify({ step, home, cities, returnMode, returnCity, tripTitle }));
    } catch {}
  }, [step, home, cities, returnMode, returnCity, tripTitle, restored, user?.id]);

  const goNext = () => {
    const i = STEPS.findIndex(s => s.id === step);
    if (i < STEPS.length - 1) setStep(STEPS[i + 1].id);
  };
  const goPrev = () => {
    const i = STEPS.findIndex(s => s.id === step);
    if (i > 0) setStep(STEPS[i - 1].id);
  };

  // Allow setting trip start date from the Review step — cascades to all cities
  const handleStartDateChange = (dateStr) => {
    setCities(cs => {
      if (cs.length === 0) return cs;
      const next = cs.map((c, i) => i === 0 ? { ...c, startDate: dateStr } : c);
      return recomputeDates(next);
    });
  };

  const effectiveReturn = returnMode === 'home' ? home : returnCity;
  const mapHighlight = step === 'home' ? 'home' : step === 'return' ? 'return' : 'cities';
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
      // RLS requires created_by = auth.jwt() ->> 'email'. The profiles table
      // may diverge from the JWT, so always pull email straight from the JWT.
      const { data: authUser, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authUser?.user?.email) {
        throw new Error('Не удалось получить email из сессии. Перезайди в аккаунт.');
      }
      const authEmail = authUser.user.email;

      // 1. Create trip via SECURITY DEFINER RPC (bypasses RLS caching issues)
      const { data: tripId, error: tripErr } = await supabase
        .rpc('create_trip', { p_title: title, p_description: '' });
      if (tripErr) throw tripErr;
      const trip = { id: tripId };

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
          start_datetime: cities[0]?.startDate ? cities[0].startDate + 'T08:00:00' : null,
          created_by: authEmail,
        });
      }

      // Transit cities → kind: 'transit'
      cities.forEach((c) => {
        if (!c.city_name) return;
        visitsToInsert.push({
          trip_id: trip.id,
          external_city_id: c.external_city_id || null,
          city_name: c.city_name,
          country: c.country || null,
          country_code: c.country_code || null,
          latitude: c.latitude || null,
          longitude: c.longitude || null,
          timezone: c.timezone || null,
          kind: 'transit',
          start_datetime: c.startDate ? c.startDate + 'T12:00:00' : null,
          end_datetime: c.startDate && c.nights ? addDays(c.startDate, +c.nights) + 'T11:00:00' : null,
          created_by: authEmail,
        });
      });

      // Return city → kind: 'end' (only if different from home)
      if (effectiveReturn?.city_name && effectiveReturn.city_name !== home?.city_name) {
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
          created_by: authEmail,
        });
      }

      if (visitsToInsert.length > 0) {
        const { error: visitErr } = await supabase.from('city_visits').insert(visitsToInsert);
        if (visitErr) throw visitErr;
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
          <div className="app-header__brand"><span className="app-header__brand-name">Triplanio</span></div>
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
              <Btn variant="primary" onClick={() => nav('/settings')}>Перейти на Pro</Btn>
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
        <div className="app-header__brand">
          <span className="app-header__brand-name">Triplanio</span>
        </div>
      </header>

      {/* Sub-header: back link + stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 24px', borderBottom: '1px solid var(--line-2)', background: 'var(--surface)' }}>
        <Btn variant="ghost" size="sm" icon="back" onClick={() => nav('/trips')}>К коллекции</Btn>
        <div style={{ flex: 1 }} />
        <Stepper currentId={step} onJump={setStep} />
      </div>

      {/* Body */}
      <div style={{ flex: 1, padding: '32px 24px', maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div className="planner-grid">
          {/* Form column */}
          <div style={{ minWidth: 0 }}>
            {step === 'home' && (
              <StepHome home={home} setHome={setHome} goNext={goNext} />
            )}
            {step === 'cities' && (
              <StepCities cities={cities} setCities={setCities} home={home} goPrev={goPrev} goNext={goNext} />
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
              />
            )}
            {step === 'review' && (
              <StepReview
                home={home}
                cities={cities}
                returnCity={effectiveReturn}
                tripTitle={tripTitle}
                setTripTitle={setTripTitle}
                onStartDateChange={handleStartDateChange}
                saving={saving}
                savedOk={savedOk}
                savedTripId={savedTripId}
                goPrev={goPrev}
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
            />
          </div>
        </div>
      </div>
    </div>
  );
}
