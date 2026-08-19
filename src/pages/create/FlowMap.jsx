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
// no dependency on the planner's save logic. Mirrors computeLegs ordering. The
// return leg is drawn only when `drawReturn` (the return/review steps), so the
// default round-trip never pre-draws a line back home on the earlier steps.
function buildLegs(home, cities, returnCity, finalPoint, drawReturn) {
  const stops = [];
  if (home?.latitude) stops.push(home);
  cities.forEach((c) => { if (c.latitude) stops.push(c); });
  const lastCity = cities[cities.length - 1];
  if (!finalPoint && drawReturn && returnCity?.latitude && returnCity.city_name !== lastCity?.city_name) {
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
// `bottomInset` (mobile only) = the height of the sheet currently covering the map
// from the bottom, so the route frames in the strip left VISIBLE above the sheet as
// it's dragged between detents. 0 on desktop (the sheet floats left, not bottom).
function fitPaddingFor(w, bottomInset = 0) {
  if (w > 960) {
    const panel = Math.min(550, w * 0.44);
    return { top: 48, right: 48, bottom: 48, left: Math.round(panel + 40) };
  }
  return { top: 32, right: 40, bottom: 52 + Math.max(0, bottomInset), left: 40 };
}

// The neutral "start" globe view (before any route is picked, and what a draft
// RESET returns to). Mapbox globe: at zoom z the equatorial circumference spans
// 512·2^z px, so the sphere's on-screen diameter ≈ 512·2^z/π. Invert that to the
// zoom whose globe fills ~85% of the VISIBLE area (the container minus the padding
// the caller reserved — the floating panel on desktop, the bottom sheet on phones).
// So the globe tracks the room actually left for it, on every screen: a wide desktop
// no longer shows a tiny planet, and a phone sizes + centres the globe into the strip
// above the sheet, re-fitting as the sheet is dragged (the sheet height rides in via
// `pad.bottom`). Coefficients are eyeballed; nudge them here if it reads big/small.
function startGlobeView(map, pad) {
  const center = [0, 20];
  const el = map.getContainer?.();
  const H = el?.clientHeight || 0;
  const W = el?.clientWidth || 0;
  if (!H || !W) return { center, zoom: 2 };
  const visH = Math.max(140, H - pad.top - pad.bottom);
  const visW = Math.max(280, W - pad.left - pad.right);
  const targetD = Math.min(0.85 * visH, 0.92 * visW);
  const zoom = Math.max(0.5, Math.min(5, Math.log2((targetD * Math.PI) / 512)));
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
  // `drawReturn` — draw the return pin + leg (the return/review steps). The return
  // CITY still feeds the camera framing whenever it's a distinct place (see the fit
  // effect), so stepping between steps toggles what's drawn WITHOUT re-framing.
  drawReturn = false,
  // Height (px) of the bottom sheet covering the map on the phone shell, so the fit
  // reserves it and the route stays framed above the sheet as it's dragged. 0 = no
  // reserve (desktop, or sheet at full where framing doesn't matter).
  bottomInset = 0,
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
  // The return counts as a distinct place only when it isn't the origin (a real
  // round-trip returns to home, already on the map). This gates the fit; drawing it
  // ALSO requires `drawReturn` (the step), so the pin appears without moving the camera.
  const hasDistinctReturn = !finalPoint && returnCity?.latitude != null && returnCity.city_name !== home?.city_name && showSE;
  const pts = [];
  if (home?.latitude && showSE) pts.push({ lat: home.latitude, lng: home.longitude, label: null, kind: 'start', data: 'home' });
  let transitNo = 0;
  cities.forEach((c) => {
    if (c.latitude == null) return;
    const isWaypoint = (+c.nights || 0) === 0 && !!c.city_name;
    pts.push({ lat: c.latitude, lng: c.longitude, label: isWaypoint ? null : String(++transitNo), kind: isWaypoint ? 'waypoint' : 'transit', data: String(c.id) });
  });
  if (hasDistinctReturn && drawReturn) {
    pts.push({ lat: returnCity.latitude, lng: returnCity.longitude, label: null, kind: 'end', data: 'return' });
  }

  const totalNights = cities.reduce((n, c) => n + (+c.nights || 0), 0);
  const legs = buildLegs(home, cities, returnCity, finalPoint, drawReturn);

  // DRAW key — markers rebuild when this changes (incl. the return pin appearing on
  // step 3). FIT key — the camera re-frames ONLY when this changes: the real route
  // geometry (home + cities + a distinct return, step-independent) plus the viewport
  // size. So stepping between steps rebuilds pins but never jerks the camera; only a
  // route edit / resize re-frames. (TRIP-337, Pavel)
  const ptsKey = pts.map((p) => `${p.kind || ''}:${p.label}@${p.lat},${p.lng}`).join('|');
  const fitPositions = [];
  if (home?.latitude && showSE) fitPositions.push([home.longitude, home.latitude]);
  cities.forEach((c) => { if (c.latitude != null) fitPositions.push([c.longitude, c.latitude]); });
  if (hasDistinctReturn) fitPositions.push([returnCity.longitude, returnCity.latitude]);
  const fitKey = `${fitPositions.map((p) => p.join(',')).join('|')}@${winW}x${winH}+${bottomInset}`;
  const legsKey = legs.map((l) => `${l.from?.latitude},${l.from?.longitude}|${l.to?.latitude},${l.to?.longitude}|${transport[l.id]?.kind || ''}`).join('::');

  // A FlowMap-owned handle to the (singleton) map instance. useMapSurface nulls its
  // own mapRef in cleanup, and React runs cleanups in declaration order — so the
  // unmount padding-reset below cannot rely on mapRef.current (already null by then).
  // This ref is never nulled by the hook, so the reset still reaches the instance.
  const mapForPaddingRef = useRef(null);

  // Did the previous fit draw a route? Lets the empty branch tell a fresh mount /
  // resize (snap to the start globe) apart from a draft RESET (glide back out).
  const prevHadPointsRef = useRef(false);
  // Has the idle globe been shown at least once? Lets a drag-driven re-centre glide
  // (easeTo) while the very first paint still snaps (hidden behind the reveal cover).
  const globeShownRef = useRef(false);
  // The fitKey the camera was last framed for — so a marker rebuild that leaves the
  // route geometry unchanged (a step change) doesn't re-fit. Reset when the route
  // empties, so the next real route frames again.
  const fittedSigRef = useRef('');

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
      const pad = fitPaddingFor(winW, bottomInset);
      if (fitPositions.length) {
        // Route: re-frame ONLY when the route geometry / viewport actually changed
        // (fitKey) — a step change rebuilds pins above but leaves fitKey alone, so
        // the camera holds. Clear any idle-globe viewport padding first, then fit
        // with the asymmetric reserve; offset does the same for the single-point
        // (origin-only) case, which fitBounds padding can't.
        if (fitKey !== fittedSigRef.current) {
          fittedSigRef.current = fitKey;
          try { map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 }); } catch { /* ignore */ }
          const offset = [Math.round((pad.left - pad.right) / 2), Math.round((pad.top - pad.bottom) / 2)];
          calmFit(map, fitPositions, { padding: pad, offset, maxZoom: 7, singleZoom: 8 });
        }
        prevHadPointsRef.current = true;
      } else {
        // Empty globe = the neutral START view. Offset the projection into the
        // VISIBLE area with setPadding (the sheet's covered height rides in via
        // pad.bottom on phones), recentre to the world, and size the globe to ~85%
        // of that visible area — so the planet centres in the strip above the sheet
        // and re-fits as the sheet is dragged. Clamp the reserved bottom so a tall
        // sheet always leaves a real strip for the globe (never pushes it off-screen).
        const contH = map.getContainer?.()?.clientHeight || 0;
        const spad = { ...pad, bottom: Math.min(pad.bottom, Math.max(0, contH - pad.top - 140)) };
        try { map.setPadding(spad); } catch { /* ignore */ }
        const view = startGlobeView(map, spad);
        // Route RESET (had points) glides 600ms; a drag-driven re-centre glides 300ms;
        // only the very first idle paint snaps (hidden behind the reveal cover).
        if (prevHadPointsRef.current || globeShownRef.current) {
          const duration = prevHadPointsRef.current ? 600 : 300;
          try { map.easeTo({ ...view, duration }); } catch { try { map.jumpTo(view); } catch { /* ignore */ } }
        } else {
          try { map.jumpTo(view); } catch { /* ignore */ }
        }
        globeShownRef.current = true;
        prevHadPointsRef.current = false;
        fittedSigRef.current = '';
      }
      // Our camera is now set — safe to reveal (see `framed`). Idempotent; React
      // bails on the unchanged value after the first flip.
      setFramed(true);
    }
    return undefined;
    // ptsKey → rebuild markers (incl. the step-toggled return pin); fitKey → re-frame
    // (route geometry + viewport size, so it also covers resize). fitKey can change
    // without ptsKey (a distinct return set while off the return step), so both are deps.
    // winW/winH are read directly inside (fitPaddingFor / startGlobeView) — listed so
    // exhaustive-deps stays honest, though fitKey already carries them.
  }, [ready, canFit, ptsKey, fitKey, winW, winH, bottomInset]);

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
    <div className="flow-map">
      <div ref={containerRef} className={'flow-map__canvas' + (revealed ? ' is-revealed' : '')} />
      {!revealed && (
        <div className="flow-map__cover">
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
        <div className="t-meta flow-map__stat">
          <span className="flow-map__stat-hl">{cities.length}</span> {cities.length === 1 ? t('trip.cities_count_one') : cities.length < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many')}
          <span className="muted-2">·</span>
          <span className="flow-map__stat-hl">{totalNights}</span> {totalNights === 1 ? t('view.nights_one') : totalNights < 5 ? t('view.nights_few') : t('view.nights_many')}
        </div>
      )}

    </div>
  );
}
