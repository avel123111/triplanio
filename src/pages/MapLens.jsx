import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker as LeafletMarker, Polyline, useMap as useLeafletMap } from 'react-leaflet';
import L from 'leaflet';
import { APIProvider, Map as GMap, Marker as GMarker, useMap as useGMap, useApiLoadingStatus } from '@vis.gl/react-google-maps';
import { Icon } from '../design/icons';
import { EmptyState, Skeleton, fmt } from '../design/index';
import { parseNaive } from '@/lib/naive-time';

const GKEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
const PIN_COLOR = '#2167e2'; // matches --brand / the Leaflet markers

const TRANSPORT_ICONS = { plane: 'plane', train: 'train', bus: 'bus', car: 'car', ferry: 'ferry', walk: 'walk' };
const TRANSPORT_LABELS = { plane: 'Перелёт', train: 'Поезд', bus: 'Автобус', car: 'Авто', ferry: 'Паром', walk: 'Пешком' };

function fmtShort(iso) {
  const d = parseNaive(iso);
  return d ? d.setLocale('ru').toFormat('d MMM') : '';
}
function fmtTime(iso) {
  const d = parseNaive(iso);
  return d ? d.setLocale('ru').toFormat('d MMM, HH:mm') : '';
}
function nightsBetween(a, b) {
  const s = parseNaive(a), e = parseNaive(b);
  if (!s || !e) return 0;
  return Math.max(0, Math.round(e.diff(s, 'days').days));
}
function cityDates(v) {
  const a = fmtShort(v.start_datetime), b = fmtShort(v.end_datetime);
  return a && b ? `${a} — ${b}` : (a || b || '');
}

// ─── Leaflet helpers ──────────────────────────────────────────────────────────

function FitBounds({ positions }) {
  const map = useLeafletMap();
  useEffect(() => {
    if (!positions.length) return;
    if (positions.length === 1) { map.setView(positions[0], 8, { animate: true }); return; }
    try { map.fitBounds(L.latLngBounds(positions).pad(0.3), { maxZoom: 8, animate: true }); } catch { /* ignore */ }
  }, [JSON.stringify(positions)]); // eslint-disable-line
  return null;
}

function markerIcon(label, active) {
  const size = active ? 34 : 28;
  return L.divIcon({
    className: '',
    html: `<div style="background:${PIN_COLOR};color:white;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${active ? 13 : 12}px;box-shadow:0 3px 8px rgba(0,0,0,.3);border:${active ? 3 : 2}px solid white;">${label}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

class MapErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  render() { return this.state.hasError ? (this.props.fallback || null) : this.props.children; }
}

// ─── Google helpers ─────────────────────────────────────────────────────────────

function GPolyline({ positions }) {
  const map = useGMap();
  useEffect(() => {
    if (!map || !window.google || positions.length < 2) return;
    const line = new window.google.maps.Polyline({
      path: positions.map(p => ({ lat: p[0], lng: p[1] })),
      strokeColor: PIN_COLOR, strokeOpacity: 0.85, strokeWeight: 2.5, map,
    });
    return () => line.setMap(null);
  }, [map, JSON.stringify(positions)]); // eslint-disable-line
  return null;
}

function GFitBounds({ positions }) {
  const map = useGMap();
  useEffect(() => {
    if (!map || !window.google || !positions.length) return;
    if (positions.length === 1) { map.setCenter({ lat: positions[0][0], lng: positions[0][1] }); map.setZoom(8); return; }
    try {
      const bounds = new window.google.maps.LatLngBounds();
      positions.forEach(p => bounds.extend({ lat: p[0], lng: p[1] }));
      map.fitBounds(bounds);
    } catch { /* ignore */ }
  }, [map, JSON.stringify(positions)]); // eslint-disable-line
  return null;
}

// Custom branded circle marker (matches the Leaflet pins) instead of the
// default red Google pin.
function googleIcon(active) {
  const g = window.google;
  if (!g?.maps) return undefined;
  return {
    path: g.maps.SymbolPath.CIRCLE,
    fillColor: PIN_COLOR,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: active ? 3 : 2,
    scale: active ? 16 : 13,
  };
}

function GoogleMapInner({ pts, positions, activeIdx, setActiveIdx, onError }) {
  const map = useGMap();
  const status = useApiLoadingStatus();

  useEffect(() => {
    if (status === 'FAILED') { onError(); return; }
    if (!map) return;
    const timer = setTimeout(() => {
      try {
        const div = map.getDiv?.();
        if (div && div.querySelector('.gm-err-container, .gm-err-content')) onError();
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
          icon={googleIcon(i === activeIdx)}
          label={{ text: p.label, color: 'white', fontWeight: 'bold', fontSize: '11px' }}
          zIndex={i === activeIdx ? 999 : i}
          onClick={() => setActiveIdx(i)}
        />
      ))}
      {positions.length >= 2 && <GPolyline positions={positions} />}
    </>
  );
}

// ─── Sidebar pieces ─────────────────────────────────────────────────────────────

function RouteStepper({ pts, activeIdx, setActiveIdx }) {
  return (
    <div style={{ padding: '14px 14px 12px', borderBottom: '1px solid var(--line-2)', background: 'var(--surface)' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Маршрут · {pts.length} {pts.length < 5 ? 'города' : 'городов'}
      </div>
      <div className="scrollbar-thin" style={{ display: 'flex', alignItems: 'flex-start', gap: 0, overflowX: 'auto' }}>
        {pts.map((p, i) => (
          <React.Fragment key={i}>
            <button onClick={() => setActiveIdx(i)} style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '4px 2px', background: 'transparent', border: 'none', cursor: 'pointer',
              flex: '0 0 auto', minWidth: 58,
            }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                background: activeIdx === i ? 'var(--brand)' : 'var(--brand-soft)',
                color: activeIdx === i ? 'white' : 'var(--brand)',
                display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
                boxShadow: activeIdx === i ? '0 0 0 4px var(--brand-soft)' : 'none',
                transition: 'all .15s ease',
              }}>{i + 1}</div>
              <div style={{ fontSize: 11, fontWeight: activeIdx === i ? 600 : 500, color: activeIdx === i ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'nowrap', maxWidth: 72, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.name}
              </div>
            </button>
            {i < pts.length - 1 && (
              <div style={{ flex: 1, minWidth: 14, height: 2, marginTop: 17, borderTop: p.nextMissing ? '2px dashed var(--warning)' : '2px solid var(--brand-soft-12)' }} />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function ActiveCityCard({ p }) {
  if (!p) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line-2)' }}>
        <div className="eyebrow" style={{ color: 'var(--brand)', marginBottom: 4 }}>
          <Icon name="pin" size={11} style={{ verticalAlign: -1, marginRight: 3 }} /> Город {p.index + 1}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 22 }}>{p.name}</h2>
          {p.dates && <span className="muted num" style={{ fontSize: 12.5 }}>{p.dates}</span>}
          {p.nights > 0 && <span className="muted" style={{ fontSize: 12.5 }}>· {p.nights} ноч.</span>}
        </div>
      </div>

      {/* Inbound transfer */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-2)' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Как добраться</div>
        {p.transfer ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--ev-transfer-soft)', color: 'var(--ev-transfer)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name={TRANSPORT_ICONS[p.transfer.transport_type] || 'car'} size={16} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{p.transfer.carrier || TRANSPORT_LABELS[p.transfer.transport_type] || 'Переезд'}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{fmtTime(p.transfer.start_datetime)}</div>
            </div>
            {p.transfer.price != null && <span className="num" style={{ fontWeight: 600, fontSize: 13 }}>{fmt(p.transfer.price, p.transfer.currency || 'EUR')}</span>}
          </div>
        ) : p.index === 0 ? (
          <div className="muted" style={{ fontSize: 12.5 }}>Точка старта маршрута.</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--warning)', fontWeight: 600 }}>
            <Icon name="warning" size={14} /> Переезд не добавлен
          </div>
        )}
      </div>

      {/* Hotels */}
      <div style={{ padding: '12px 16px', borderBottom: p.activities.length ? '1px solid var(--line-2)' : 'none' }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Проживание</div>
        {p.hotels.length ? p.hotels.map((h, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--ev-hotel-soft)', color: 'var(--ev-hotel)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="bed" size={15} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</div>
              {h.check_in_datetime && <div className="muted num" style={{ fontSize: 11 }}>{fmtShort(h.check_in_datetime)} → {fmtShort(h.check_out_datetime)}</div>}
            </div>
            {h.price != null && <span className="num" style={{ fontWeight: 600, fontSize: 13 }}>{fmt(h.price, h.currency || 'EUR')}</span>}
          </div>
        )) : <div className="muted" style={{ fontSize: 12.5 }}>Отель не добавлен.</div>}
      </div>

      {/* Activities */}
      {p.activities.length > 0 && (
        <div style={{ padding: '12px 16px' }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Активности · {p.activities.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {p.activities.map((a, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ev-activity-soft)', color: 'var(--ev-activity)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                  <Icon name={a.category === 'food' ? 'cup' : a.category === 'sight' ? 'cam' : 'spark'} size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</div>
                  {a.start_datetime && <div className="muted num" style={{ fontSize: 11 }}>{fmtTime(a.start_datetime)}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MapLens ─────────────────────────────────────────────────────────────────

export default function MapLens({ visits = [], hotels = [], activities = [], transfers = [], trip, isLoading }) {
  const [gmapFailed, setGmapFailed] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (!GKEY) return;
    const prev = window.gm_authFailure;
    window.gm_authFailure = () => setGmapFailed(true);
    return () => { window.gm_authFailure = prev; };
  }, []);

  const pts = useMemo(() => {
    const geo = visits
      .filter(v => v.latitude != null && v.longitude != null)
      .slice()
      .sort((a, b) => (a.start_datetime || '').localeCompare(b.start_datetime || ''));
    return geo.map((v, i) => {
      const cityHotels = hotels.filter(h => h.city_visit_id === v.id);
      const cityActs = activities.filter(a => a.city_visit_id === v.id)
        .slice().sort((a, b) => (a.start_datetime || '').localeCompare(b.start_datetime || ''));
      const inbound = transfers.find(t => t.to_city_visit_id === v.id) || null;
      return {
        index: i,
        visitId: v.id,
        lat: v.latitude, lng: v.longitude,
        label: String(i + 1),
        name: v.city_name || `Город ${i + 1}`,
        dates: cityDates(v),
        nights: nightsBetween(v.start_datetime, v.end_datetime),
        hotels: cityHotels,
        activities: cityActs,
        transfer: inbound,
      };
    });
  }, [visits, hotels, activities, transfers]);

  // Mark, for the stepper, which segments are missing a transfer.
  const ptsWithSeg = useMemo(() => pts.map((p, i) => ({
    ...p, nextMissing: i < pts.length - 1 ? !pts[i + 1].transfer : false,
  })), [pts]);

  useEffect(() => { if (activeIdx >= pts.length) setActiveIdx(0); }, [pts.length]); // eslint-disable-line

  if (isLoading) return <Skeleton w="100%" h={480} r={14} />;

  if (pts.length === 0) {
    return (
      <EmptyState
        icon="map"
        title="Карта недоступна"
        body="У городов трипа пока нет координат. Добавь города с местоположением — и маршрут появится на карте."
      />
    );
  }

  const positions = pts.map(p => [p.lat, p.lng]);
  const totalNights = pts.reduce((n, p) => n + p.nights, 0);

  const leafletMap = (
    <MapContainer center={positions[0]} zoom={5} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
      <FitBounds positions={positions} />
      {pts.map((p, i) => (
        <LeafletMarker key={i} position={[p.lat, p.lng]} icon={markerIcon(p.label, i === activeIdx)}
          eventHandlers={{ click: () => setActiveIdx(i) }} />
      ))}
      {positions.length >= 2 && (
        <Polyline positions={positions} color={PIN_COLOR} weight={2.5} dashArray="6 8" opacity={0.75} />
      )}
    </MapContainer>
  );

  const mapEl = (GKEY && !gmapFailed) ? (
    <MapErrorBoundary fallback={leafletMap}>
      <APIProvider apiKey={GKEY}>
        <GMap
          style={{ height: '100%', width: '100%' }}
          defaultCenter={{ lat: positions[0][0], lng: positions[0][1] }}
          defaultZoom={5}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          mapTypeId="roadmap"
        >
          <GoogleMapInner pts={pts} positions={positions} activeIdx={activeIdx} setActiveIdx={setActiveIdx} onError={() => setGmapFailed(true)} />
        </GMap>
      </APIProvider>
    </MapErrorBoundary>
  ) : leafletMap;

  return (
    <div className="trip-map-shell" style={{
      margin: '-28px -28px -60px',
      height: 'calc(100vh - 56px)',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 360px',
      background: 'var(--surface)',
    }}>
      {/* MAP */}
      <div style={{ position: 'relative', overflow: 'hidden', borderRight: '1px solid var(--line)', minWidth: 0 }}>
        {mapEl}

        {/* Trip identity (top-left) */}
        <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 500, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-soft)', maxWidth: 280 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="map" size={14} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{trip?.title || 'Маршрут'}</div>
            <div className="num muted" style={{ fontSize: 11, lineHeight: 1.2, marginTop: 1 }}>{pts.length} {pts.length < 5 ? 'города' : 'городов'} · {totalNights} ноч.</div>
          </div>
        </div>

        {/* Legend (bottom-left) */}
        <div style={{ position: 'absolute', bottom: 16, left: 16, zIndex: 500, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 11, padding: '10px 14px', fontSize: 11.5, boxShadow: 'var(--shadow-soft)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>Маршрут</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 18, height: 0, borderTop: `2px solid ${PIN_COLOR}` }} /> Города по порядку
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 18, height: 0, borderTop: '2px dashed var(--warning)' }} /> Нет переезда
            </div>
          </div>
        </div>
      </div>

      {/* SIDEBAR */}
      <aside style={{ display: 'flex', flexDirection: 'column', background: 'var(--surface)', overflow: 'hidden', minWidth: 0 }}>
        <RouteStepper pts={ptsWithSeg} activeIdx={activeIdx} setActiveIdx={setActiveIdx} />
        <div className="scrollbar-thin" style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          <ActiveCityCard p={pts[activeIdx]} />
        </div>
      </aside>
    </div>
  );
}
