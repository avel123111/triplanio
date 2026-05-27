import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker as LeafletMarker, Polyline, Popup, useMap as useLeafletMap } from 'react-leaflet';
import L from 'leaflet';
import { APIProvider, Map as GMap, Marker as GMarker, InfoWindow, useMap as useGMap, useApiLoadingStatus } from '@vis.gl/react-google-maps';
import { Icon } from '../design/icons';
import { EmptyState, Skeleton } from '../design/index';
import { parseNaive } from '@/lib/naive-time';

const GKEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

function fmtShort(iso) {
  const d = parseNaive(iso);
  return d ? d.setLocale('ru').toFormat('d MMM') : '';
}

function cityDates(v) {
  const a = fmtShort(v.start_datetime);
  const b = fmtShort(v.end_datetime);
  if (a && b) return `${a} — ${b}`;
  return a || b || '';
}

// ─── Leaflet helpers ──────────────────────────────────────────────────────────

function FitBounds({ positions }) {
  const map = useLeafletMap();
  useEffect(() => {
    if (!positions.length) return;
    if (positions.length === 1) { map.setView(positions[0], 8, { animate: true }); return; }
    try { map.fitBounds(L.latLngBounds(positions).pad(0.35), { maxZoom: 8, animate: true }); } catch { /* ignore */ }
  }, [JSON.stringify(positions)]); // eslint-disable-line
  return null;
}

function markerIcon(label) {
  return L.divIcon({
    className: '',
    html: `<div style="background:#2167e2;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;box-shadow:0 3px 8px rgba(0,0,0,.25);border:2px solid white;">${label}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
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
      strokeColor: '#2167e2', strokeOpacity: 0.8, strokeWeight: 2.5, map,
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

function GoogleMapInner({ pts, positions, onError }) {
  const map = useGMap();
  const status = useApiLoadingStatus();
  const [openIdx, setOpenIdx] = useState(null);

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
          label={{ text: p.label, color: 'white', fontWeight: 'bold', fontSize: '11px' }}
          onClick={() => setOpenIdx(i)}
        />
      ))}
      {openIdx !== null && pts[openIdx] && (
        <InfoWindow position={{ lat: pts[openIdx].lat, lng: pts[openIdx].lng }} onCloseClick={() => setOpenIdx(null)}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{pts[openIdx].name}</div>
          {pts[openIdx].dates && <div style={{ fontSize: 12, color: '#64748b' }}>{pts[openIdx].dates}</div>}
        </InfoWindow>
      )}
      {positions.length >= 2 && <GPolyline positions={positions} />}
    </>
  );
}

// ─── MapLens ─────────────────────────────────────────────────────────────────

export default function MapLens({ visits = [], trip, isLoading }) {
  const [gmapFailed, setGmapFailed] = useState(false);

  if (isLoading) return <Skeleton w="100%" h={420} r={14} />;

  const geo = visits
    .filter(v => v.latitude != null && v.longitude != null)
    .slice()
    .sort((a, b) => (a.start_datetime || '').localeCompare(b.start_datetime || ''));

  if (geo.length === 0) {
    return (
      <EmptyState
        icon="map"
        title="Карта недоступна"
        body="У городов трипа пока нет координат. Добавь города с местоположением — и маршрут появится на карте."
      />
    );
  }

  const pts = geo.map((v, i) => ({
    lat: v.latitude, lng: v.longitude,
    label: String(i + 1),
    name: v.city_name || `Город ${i + 1}`,
    dates: cityDates(v),
  }));
  const positions = pts.map(p => [p.lat, p.lng]);

  const leafletMap = (
    <MapContainer center={positions[0]} zoom={5} style={{ height: 480, width: '100%' }} scrollWheelZoom={false}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap' />
      <FitBounds positions={positions} />
      {pts.map((p, i) => (
        <LeafletMarker key={i} position={[p.lat, p.lng]} icon={markerIcon(p.label)}>
          <Popup>
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            {p.dates && <div style={{ color: '#64748b' }}>{p.dates}</div>}
          </Popup>
        </LeafletMarker>
      ))}
      {positions.length >= 2 && (
        <Polyline positions={positions} color="#2167e2" weight={2.5} dashArray="6 8" opacity={0.75} />
      )}
    </MapContainer>
  );

  const body = (GKEY && !gmapFailed) ? (
    <MapErrorBoundary fallback={leafletMap}>
      <APIProvider apiKey={GKEY}>
        <GMap
          style={{ height: 480, width: '100%' }}
          defaultCenter={{ lat: positions[0][0], lng: positions[0][1] }}
          defaultZoom={5}
          gestureHandling="cooperative"
          disableDefaultUI={false}
          mapTypeId="roadmap"
        >
          <GoogleMapInner pts={pts} positions={positions} onError={() => setGmapFailed(true)} />
        </GMap>
      </APIProvider>
    </MapErrorBoundary>
  ) : leafletMap;

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="map" size={16} style={{ color: 'var(--brand)' }} />
        <div style={{ fontWeight: 600, fontSize: 14 }}>Маршрут трипа</div>
        <span className="muted" style={{ fontSize: 12.5, marginLeft: 'auto' }}>
          {geo.length} {geo.length === 1 ? 'город' : geo.length < 5 ? 'города' : 'городов'}
        </span>
      </div>
      {body}
    </div>
  );
}
