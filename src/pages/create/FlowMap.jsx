import React, { useRef, useEffect, useState } from 'react';
import { mapboxgl } from '@/lib/mapbox';
import { calmFit } from '@/lib/map/camera';
import { useMapSurface } from '@/lib/map/useMapSurface';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { groupByLocation, createMarkerEl, createCityBadgeEl, iconForKinds } from '@/lib/map/markers';
import MapControls from '@/lib/map/MapControls';
import { useT } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';

// Build ordered legs (home → cities → return) - self-contained so the map has
// no dependency on the planner's save logic. Mirrors computeLegs ordering.
function buildLegs(home, cities, returnCity, finalPoint) {
  const stops = [];
  if (home?.latitude) stops.push(home);
  cities.forEach((c) => { if (c.latitude) stops.push(c); });
  const lastCity = cities[cities.length - 1];
  if (!finalPoint && returnCity?.latitude && returnCity.city_name !== lastCity?.city_name) {
    stops.push(returnCity);
  }
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) legs.push({ id: `leg_${i}`, from: stops[i], to: stops[i + 1] });
  return legs;
}

// Desktop: the step panel FLOATS over the left of the full-bleed map, so the route
// must be framed in the VISIBLE area (right of the panel) — reserve the panel's
// width on the left. On phones (≤960) the map is its own top band with the sheet
// below it, so only a little bottom room is reserved for the sheet's overlap.
// Mirror the CSS: .flow-editcol width = min(550px, 44vw); breakpoint 960.
function fitPaddingFor(w) {
  if (w > 960) {
    const panel = Math.min(550, w * 0.44);
    return { top: 48, right: 48, bottom: 48, left: Math.round(panel + 40) };
  }
  return { top: 32, right: 40, bottom: 52, left: 40 };
}

// The neutral "start" globe view (before any route is picked, and what a draft
// RESET returns to). Mapbox globe: at zoom z the equatorial circumference spans
// 512·2^z px, so the sphere's on-screen diameter ≈ 512·2^z/π. Invert that to the
// zoom whose globe fills ~85% of the MAP's height — clamped so it never grows wider
// than the strip left visible beside the floating panel (else it tucks behind it).
// This is why a wide screen no longer shows a tiny planet: the size now tracks the
// container, not a fixed zoom. Phones keep a fixed start zoom — their short map band
// already frames the globe and Pavel asked to leave mobile un-adaptive. Coefficients
// are eyeballed; nudge them here if the globe reads a touch big/small.
function startGlobeView(map, pad, winW) {
  const center = [0, 20];
  if (winW <= 960) return { center, zoom: 2 };
  const el = map.getContainer?.();
  const H = el?.clientHeight || 0;
  const W = el?.clientWidth || 0;
  if (!H || !W) return { center, zoom: 2.4 };
  const visW = Math.max(360, W - pad.left - pad.right); // room right of the panel
  const targetD = Math.min(0.85 * H, 0.92 * visW);
  const zoom = Math.max(0.8, Math.min(5, Math.log2((targetD * Math.PI) / 512)));
  return { center, zoom };
}

// =====================================================================
// FLOW MAP - full-bleed Mapbox route preview that fills its container.
// Shared across every step of the unified create flow so the map is the
// constant spatial anchor (vs. the old small map card). Same singleton
// instance, markers, route lines, controls, tooltip and hover/select wiring
// as the trip MapView / Map lens — only the data source (home/cities/transport)
// and the pre-save id scheme differ.
//
// Interactivity mirrors the Map lens (Pavel, TRIP-337): each pin is hoverable +
// clickable, a glass tooltip (createCityBadgeEl) shows the active city's name +
// dates, and hover/selection is mirrored BOTH ways with the step's city list —
// the parent owns `hoveredId`/`selectedId` and feeds `cityBadge` back, exactly as
// ScreenMap drives MapView. Marker ids: 'home', the city's own id, 'return'.
// =====================================================================
export default function FlowMap({
  home, cities = [], returnCity, transport = {}, finalPoint = false,
  // Map-lens-style interactivity (all optional — omit for a passive preview):
  hoveredId = null, selectedId = null, cityBadge = null,
  onCityHover, onCityClick, onMapClick,
}) {
  const t = useT();
  const { isDark } = useTheme();
  const containerRef = useRef(null);
  const markersRef = useRef([]);
  const cityBadgePopupRef = useRef(null);

  // On-map controls (same set as MapView): projection / theme / start-finish.
  // Планировщик (оба флоу) открывается на глобусе (запрос Pavel, TRIP-337).
  const [projection, setProjection] = useState('globe');
  // Seed from the app theme and follow it live (mirrors MapView): the on-map
  // toggle can still override until the next app-theme change.
  const [scheme, setScheme] = useState(isDark ? 'DARK' : 'LIGHT');
  useEffect(() => { setScheme(isDark ? 'DARK' : 'LIGHT'); }, [isDark]);
  const [showSE, setShowSE] = useState(true);

  // Track viewport width so the fit re-frames when the layout crosses the
  // desktop↔mobile breakpoint or the panel width (40vw) changes on resize.
  const [winW, setWinW] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1200));
  // Height too: the idle-globe zoom is derived from the map's height, so a taller
  // window must re-frame it (width alone would miss a height-only resize).
  const [winH, setWinH] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 800));
  useEffect(() => {
    let raf = 0;
    const onResize = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { setWinW(window.innerWidth); setWinH(window.innerHeight); }); };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); };
  }, []);

  // Shared singleton lifecycle (acquire/release, ready-seed, theme, projection,
  // marker cleanup on unmount).
  // cooperativeGestures off — no "use two fingers to move the map" gate on the
  // planner (same as the Map lens): the map is the primary surface here.
  const { mapRef, ready, canFit } = useMapSurface(containerRef, { markersRef, scheme, projection, cooperativeGestures: false });

  // `framed` gates the fade-in: the singleton is SHARED, so on entry it still shows
  // the previous screen's camera + basemap (e.g. the far, monochrome Trips/stats
  // map). Seeding `ready` from a reused style would reveal that stale frame for a
  // beat before this screen's camera re-asserts — the jerky "far grey → my globe"
  // flip. So hold the reveal behind a surface cover until OUR camera has been set
  // (the flag flips in the fit effect below, a frame after jumpTo — by then the
  // basemap theme has re-applied too). NB: gate on "camera set", NOT Mapbox 'idle':
  // 'idle' also waits for every tile of the view to finish loading, and a whole-
  // earth globe has enough tiles that that takes SECONDS — the tiles stream in on
  // the already-revealed map, exactly like every other map screen. (TRIP-337)
  const [framed, setFramed] = useState(false);

  // Latest interactivity callbacks kept in refs so passing fresh closures doesn't
  // rebuild the markers (mirrors MapView).
  const onCityHoverRef = useRef(onCityHover);
  const onCityClickRef = useRef(onCityClick);
  const onMapClickRef = useRef(onMapClick);
  useEffect(() => { onCityHoverRef.current = onCityHover; }, [onCityHover]);
  useEffect(() => { onCityClickRef.current = onCityClick; }, [onCityClick]);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);

  // Unified with the trip MapView: home → start flag, return → finish flag, transit
  // cities numbered 1..N, a 0-night stop → waypoint glyph (NOT a number, same as the
  // editor / Map lens). Each pin carries a stable id ('home' | city.id | 'return')
  // so hover/click can address it and the tooltip can be looked up by the parent.
  const pts = [];
  if (home?.latitude && showSE) pts.push({ lat: home.latitude, lng: home.longitude, label: null, kind: 'start', data: 'home' });
  let transitNo = 0;
  cities.forEach((c) => {
    if (c.latitude == null) return;
    const isWaypoint = (+c.nights || 0) === 0 && !!c.city_name;
    pts.push({ lat: c.latitude, lng: c.longitude, label: isWaypoint ? null : String(++transitNo), kind: isWaypoint ? 'waypoint' : 'transit', data: String(c.id) });
  });
  if (!finalPoint && returnCity?.latitude && returnCity.city_name !== home?.city_name && showSE) {
    pts.push({ lat: returnCity.latitude, lng: returnCity.longitude, label: null, kind: 'end', data: 'return' });
  }

  const positions = pts.map((p) => [p.lng, p.lat]);
  const totalNights = cities.reduce((n, c) => n + (+c.nights || 0), 0);
  const legs = buildLegs(home, cities, returnCity, finalPoint);

  const ptsKey = pts.map((p) => `${p.kind || ''}:${p.label}@${p.lat},${p.lng}`).join('|');
  const legsKey = legs.map((l) => `${l.from?.latitude},${l.from?.longitude}|${l.to?.latitude},${l.to?.longitude}|${transport[l.id]?.kind || ''}`).join('::');

  // A FlowMap-owned handle to the (singleton) map instance. useMapSurface nulls its
  // own mapRef in cleanup, and React runs cleanups in declaration order — so the
  // unmount padding-reset below cannot rely on mapRef.current (already null by then).
  // This ref is never nulled by the hook, so the reset still reaches the instance.
  const mapForPaddingRef = useRef(null);

  // Did the previous fit draw a route? Lets the empty branch tell a fresh mount /
  // resize (snap to the start globe) apart from a draft RESET (glide back out).
  const prevHadPointsRef = useRef(false);

  // Markers + fit.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    mapForPaddingRef.current = map;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    const points = pts.map((p) => ({ lng: p.lng, lat: p.lat, label: p.label, kind: p.kind, data: p.data }));
    groupByLocation(points).forEach((g) => {
      const el = createMarkerEl(g.labels.filter((l) => l != null), {
        icon: iconForKinds(g.kinds),
        onClick: onCityClick ? () => { const cb = onCityClickRef.current; if (cb) cb(g.data[0]); } : undefined,
        onHover: onCityHover ? (entering) => { const cb = onCityHoverRef.current; if (cb) cb(entering ? g.data[0] : null); } : undefined,
      });
      // Tag the element with the ids at this spot so the hover/select effect can
      // toggle .is-sel / .is-hover without rebuilding the markers.
      el.dataset.mid = g.data.filter(Boolean).join(',');
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map);
      markersRef.current.push(marker);
    });
    // Fit only when the slot is measured (canFit) — deferred otherwise; the effect
    // re-runs when canFit flips. Markers above draw on `ready`. (TRIP-202)
    if (canFit) {
      const pad = fitPaddingFor(winW);
      if (positions.length) {
        // Route: clear any idle-globe viewport padding first, then fit with the
        // asymmetric reserve. Offset does the same for the single-point (origin-only)
        // case, which fitBounds padding can't.
        try { map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 }); } catch { /* ignore */ }
        const offset = [Math.round((pad.left - pad.right) / 2), Math.round((pad.top - pad.bottom) / 2)];
        calmFit(map, positions, { padding: pad, offset, maxZoom: 7, singleZoom: 8 });
      } else {
        // Empty globe = the neutral START view. Offset the projection into the
        // visible area (setPadding), recentre to the world, and size the globe to
        // ~85% of the map's height (desktop) so a wide screen no longer shows a
        // tiny planet. Returning here from a route (draft RESET) glides back out;
        // a fresh mount / resize just snaps (the fade-in hides it).
        try { map.setPadding(pad); } catch { /* ignore */ }
        const view = startGlobeView(map, pad, winW);
        if (prevHadPointsRef.current) {
          try { map.easeTo({ ...view, duration: 600 }); } catch { try { map.jumpTo(view); } catch { /* ignore */ } }
        } else {
          try { map.jumpTo(view); } catch { /* ignore */ }
        }
      }
      prevHadPointsRef.current = positions.length > 0;
      // Our camera is now set — safe to reveal (see `framed`). Idempotent; React
      // bails on the unchanged value after the first flip.
      setFramed(true);
    }
    return undefined;
  }, [ready, canFit, ptsKey, winW, winH]);

  // Selection + hover highlight — toggled on the existing marker elements (no
  // rebuild, so hovering the city list is cheap). Re-runs after a rebuild too
  // (ptsKey) so the state survives a redraw. Mirrors MapView.
  useEffect(() => {
    if (!ready) return;
    const sel = selectedId != null ? String(selectedId) : null;
    const hov = hoveredId != null ? String(hoveredId) : null;
    markersRef.current.forEach((m) => {
      const el = m.getElement();
      const ids = (el.dataset.mid || '').split(',').filter(Boolean);
      const isSel = sel != null && ids.includes(sel);
      el.classList.toggle('is-sel', isSel);
      el.classList.toggle('is-hover', !isSel && hov != null && ids.includes(hov));
    });
  }, [ready, selectedId, hoveredId, ptsKey]);

  // City tooltip — one glass label (flag + name + dates) at the active city,
  // carried by a mapboxgl.Popup so it auto-anchors on-screen. Same primitive +
  // skin as the Map lens (createCityBadgeEl / .cbadge / .cbadge-popup); the parent
  // feeds `cityBadge` from the hovered-or-selected city.
  useEffect(() => {
    const map = mapRef.current;
    if (cityBadgePopupRef.current) { cityBadgePopupRef.current.remove(); cityBadgePopupRef.current = null; }
    if (!map || !ready || !cityBadge || cityBadge.lng == null || cityBadge.lat == null) return undefined;
    const el = createCityBadgeEl({ countryCode: cityBadge.countryCode, name: cityBadge.name, dates: cityBadge.dates });
    cityBadgePopupRef.current = new mapboxgl.Popup({
      closeButton: false, closeOnClick: false, focusAfterOpen: false,
      className: 'cbadge-popup', offset: 16, maxWidth: 'none',
    })
      .setLngLat([cityBadge.lng, cityBadge.lat])
      .setDOMContent(el)
      .addTo(map);
    return () => { if (cityBadgePopupRef.current) { cityBadgePopupRef.current.remove(); cityBadgePopupRef.current = null; } };
  }, [ready, cityBadge?.lng, cityBadge?.lat, cityBadge?.name, cityBadge?.dates, cityBadge?.countryCode]);

  // Click on empty map → let the parent clear the selection. Mapbox fires 'click'
  // only for a real canvas click (a drag emits move events; HTML markers swallow
  // their own click in a separate DOM layer), so this never fires for pins or pans.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    const handler = (e) => { const cb = onMapClickRef.current; if (cb) cb(e); };
    map.on('click', handler);
    return () => { try { map.off('click', handler); } catch { /* ignore */ } };
  }, [ready]);

  // The map is a shared singleton — hand it back with zero viewport padding so the
  // planner's idle-globe offset never leaks onto another screen (MapView / stats).
  // Uses the FlowMap-owned ref (mapRef.current is already null at unmount, see above).
  useEffect(() => () => {
    try { mapForPaddingRef.current?.setPadding({ top: 0, right: 0, bottom: 0, left: 0 }); } catch { /* ignore */ }
  }, []);

  // Route lines: dashed = no transport, solid = flight/road/other; road via Mapbox.
  // Same shared rule + colours as the trip MapView (only the layer ids differ).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    const drawLegs = legs.map((leg) => ({ from: leg.from, to: leg.to, kind: transport[leg.id]?.kind }));
    // Cached by legs: reopening with the same route is a no-op (no rebuild, no
    // road refetch, no straight→road flicker).
    drawRouteLinesCached(map, `create:${legsKey}`, drawLegs, { dashedId: 'flow-dashed', solidId: 'flow-solid' });
    return undefined;
  }, [ready, legsKey]);

  const revealed = ready && framed;
  return (
    <div className="flow-map" style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: revealed ? 1 : 0, transition: 'opacity .3s ease' }} />
      {!revealed && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--surface)', zIndex: 2 }}>
          {/* Spinner only before the style loads; once ready we just hold a plain
              cover until our camera is set (framed), so there is no spinner flash
              on a warm singleton — only the stale frame stays hidden, and we never
              wait on tile loading. */}
          {!ready && <div className="spin spin--ring spin--lg spin--ink" />}
        </div>
      )}

      {revealed && (
        <MapControls
          projection={projection}
          onToggleProjection={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
          scheme={scheme}
          onToggleScheme={() => setScheme((s) => (s === 'DARK' ? 'LIGHT' : 'DARK'))}
          showSE={showSE}
          onToggleSE={() => setShowSE((v) => !v)}
        />
      )}

      {totalNights > 0 && (
        <div className="t-meta" style={{
          position: 'absolute', bottom: 14, right: 14,
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-pill)',
          color: 'var(--muted)', boxShadow: 'var(--sh-1)',
        }}>
          <span style={{ color: 'var(--ink-2)' }}>{cities.length}</span> {cities.length === 1 ? t('trip.cities_count_one') : cities.length < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many')}
          <span className="muted-2">·</span>
          <span style={{ color: 'var(--ink-2)' }}>{totalNights}</span> {totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many')}
        </div>
      )}

    </div>
  );
}
