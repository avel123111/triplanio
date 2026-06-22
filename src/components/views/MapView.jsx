import React, { useEffect, useMemo, useRef, useState } from 'react';
import { mapboxgl, fitToPoints } from '@/lib/mapbox';
import { useMapSurface } from '@/lib/map/useMapSurface';
import { drawRouteLinesCached, drawRouteReveal, legPointAt, drawRouteHighlight, clearRouteHighlight } from '@/lib/map/routeLines';
import { groupByLocation, createMarkerEl, iconForKinds } from '@/lib/map/markers';
import MapControls from '@/lib/map/MapControls';
import { countryFlag } from '@/lib/geo';
import { sortVisits } from '@/lib/validation';

// Great-circle distance (km) between two visits — used to scale the reveal flyTo
// duration so a Moscow→New York leg flies for longer than a short hop.
function legKm(from, to) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(from.latitude)) * Math.cos(toRad(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Per-leg reveal animation duration (ms) from leg length: short hops ~2s,
// intercontinental legs up to ~8s. sqrt keeps very long legs from dragging on.
// The motion itself is LINEAR (no terminal slow-down), so the overall tempo is a
// touch calmer but the speed doesn't collapse before arrival.
function revealLegDuration(from, to) {
  return Math.min(8000, Math.max(2000, Math.round(1700 + Math.sqrt(legKm(from, to)) * 72)));
}

// Final camera zoom when the reveal settles on a city — deliberately pulled back
// on this reader map (a city sits in its region, not filling the frame).
const REVEAL_CITY_ZOOM = 5.6;

// Apply marker visibility (and a one-shot pop on first appearance) for a reveal
// state. `markerMax` = highest ordered-index allowed to show; revealing=false ⇒
// show all. Kept module-level so the build effect and the reveal controller share
// exactly one implementation.
function applyMarkerVisibility(markers, orderIndexById, markerMax, revealing) {
  markers.forEach((m) => {
    const el = m.getElement();
    let hide = false;
    if (revealing) {
      const ids = (el.dataset.vids || '').split(',').filter(Boolean);
      const minIdx = ids.reduce((acc, id) => {
        const i = orderIndexById.get(id);
        return i == null ? acc : Math.min(acc, i);
      }, Infinity);
      hide = minIdx > markerMax;
    }
    const wasHidden = el.style.display === 'none';
    el.style.display = hide ? 'none' : '';
    if (!hide && wasHidden) {
      const core = el.querySelector('.tmk__core');
      if (core && core.animate) {
        core.animate(
          [{ transform: 'scale(0.2)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }],
          { duration: 340, easing: 'cubic-bezier(.22,1,.36,1)' },
        );
      }
    }
  });
}

// ---------------- Main MapView ----------------
// Pure map surface - the parent supplies chrome (theme toggle, overlays) and
// MUST give this component explicit dimensions (it fills 100% × 100%). The
// singleton lifecycle (acquire/release/ready/resize/theme/projection) lives in
// useMapSurface; markers + route lines are drawn with the shared map modules so
// every map screen renders them identically.
export default function MapView({
  visits,
  transfers,
  showStartEnd = true,
  colorScheme = 'LIGHT',
  onCityClick,
  // Optional: id of the city_visit currently selected/open in the parent (the
  // editor's open panel, the Map lens' active stepper item). Its marker renders
  // in the highlighted "selected" state. Falsy ⇒ nothing selected.
  selectedVisitId = null,
  // Optional: id of the city_visit currently hovered in a parent list (stepper,
  // editor cities list). Its marker shows the selected look (no pulse) while
  // hovered. Hovering a pin on the map is handled by CSS (:hover) directly.
  hoveredVisitId = null,
  // Optional: which leg to show in the "selected route" state, as the id pair
  // "<fromVisitId>__<toVisitId>" (a transfer open in the editor). The geometry +
  // transport kind are resolved from THIS component's own visits/transfers, so
  // the highlight always matches the live base line and updates when transport
  // is added/changed (never a stale second arc). Falsy ⇒ nothing selected.
  selectedLegKey = null,
  // Optional camera focus driven by the parent (e.g. the editor's open panel):
  // array of [lng,lat] points. 1 point → flyTo the city; 2 → fit both cities.
  // Falsy/empty → no override (the whole-route auto-fit stays in charge); when
  // it clears after a focus, the camera eases back to the full route.
  focus = null,
  // Duration (ms) of the single-city focus flyTo. Default 700; the public
  // shared-trip reader passes a larger value for a slower, calmer camera.
  focusDuration = 700,
  // Optional progressive reveal (public shared-trip reader). When `revealActiveId`
  // is set, the route is NOT drawn whole: only the legs UP TO the active city are
  // painted and markers past it are hidden. When the active city ADVANCES to the
  // next one, the connecting leg is animated growing 0→1 over `focusDuration` —
  // in lockstep with the camera flyTo — and the next marker appears once the line
  // arrives. While the reader sits on a city, the leg toward the NEXT city is not
  // drawn at all (no pre-drawn future legs). `revealActiveId == null` ⇒ the whole
  // route + all markers draw normally (default — every other surface).
  revealActiveId = null,
  // When the map is kept mounted but hidden behind another tab, the parent flips
  // `active` to false. On re-show its container regains size, so the map needs a
  // resize() (handled in useMapSurface).
  active = true,
  // Show the on-map control buttons (projection, theme, start/finish toggles).
  mapControls = false,
  // Basemap variant forwarded to the shared surface (e.g. 'monochrome' for the
  // public shared-trip reader, mirroring the stats map). Defaults to the normal
  // styled basemap.
  basemapTheme = 'default',
  children,
}) {
  const containerRef = useRef(null);
  const markersRef = useRef([]);
  const fittedSigRef = useRef('');

  const [projection, setProjection] = useState('mercator');
  // Internal toggles (driven by the on-map control buttons). Seeded from props and
  // re-synced if the prop changes (e.g. the app theme), but the buttons can override.
  const [mapScheme, setMapScheme] = useState(colorScheme);
  const [showSE, setShowSE] = useState(showStartEnd);
  useEffect(() => { setMapScheme(colorScheme); }, [colorScheme]);
  useEffect(() => { setShowSE(showStartEnd); }, [showStartEnd]);

  // Shared singleton lifecycle (acquire/release, ready-seed, theme, projection,
  // resize, marker cleanup on unmount).
  const { mapRef, ready, error } = useMapSurface(containerRef, {
    markersRef, scheme: mapScheme, projection, active, basemapTheme,
  });

  // Force a re-fit on (re)mount so the first draw frames the route.
  useEffect(() => { fittedSigRef.current = ''; }, []);

  // Keep the latest onCityClick without forcing the draw effect to re-run.
  const onCityClickRef = useRef(onCityClick);
  useEffect(() => { onCityClickRef.current = onCityClick; }, [onCityClick]);

  const ordered = useMemo(() => {
    const all = sortVisits(visits).filter((v) => v.latitude && v.longitude);
    return showSE ? all : all.filter((v) => v.kind !== 'start' && v.kind !== 'end');
  }, [visits, showSE]);

  const visitsSignature = useMemo(
    () => ordered.map((v) => `${v.id}:${v.latitude.toFixed(5)},${v.longitude.toFixed(5)}`).join('|'),
    [ordered],
  );

  // Route legs (consecutive ordered visits + the transport on each pair) and the
  // line signature — shared by the line-draw effect (full vs progressive reveal).
  const legs = useMemo(() => {
    const transferByPair = new globalThis.Map();
    transfers.forEach((t) => {
      const k = `${t.from_city_visit_id}__${t.to_city_visit_id}`;
      if (!transferByPair.has(k)) transferByPair.set(k, t);
    });
    const out = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const from = ordered[i];
      const to = ordered[i + 1];
      out.push({ from, to, kind: transferByPair.get(`${from.id}__${to.id}`)?.transport_type });
    }
    return out;
  }, [ordered, transfers]);

  const lineSig = useMemo(() => {
    const transfersSig = transfers
      .map((t) => `${t.from_city_visit_id}>${t.to_city_visit_id}:${t.transport_type || ''}`)
      .join('|');
    return `trip:${visitsSignature}::${transfersSig}`;
  }, [visitsSignature, transfers]);

  // Reveal bookkeeping: index of the active city in `ordered` and an id→index map
  // (used to hide markers past the active city without rebuilding them).
  const revealActiveIdx = useMemo(
    () => (revealActiveId == null ? -1 : ordered.findIndex((v) => String(v.id) === String(revealActiveId))),
    [ordered, revealActiveId],
  );
  const orderIndexById = useMemo(() => {
    const m = new globalThis.Map();
    ordered.forEach((v, i) => m.set(String(v.id), i));
    return m;
  }, [ordered]);
  // Revealing only when the active id actually resolves to a marker on the map —
  // if the active stop has no coordinates (rare anchor), fall back to the whole
  // route instead of blanking it.
  const revealing = revealActiveId != null && revealActiveIdx >= 0;

  // Reveal controller — ONE imperative owner of the camera, the route line and
  // marker visibility for the progressive reveal. Driven by a QUEUE: the line +
  // camera animate ONE leg at a time and never skip, so fast scrolling just makes
  // the animation lag behind (each leg still plays fully) instead of snapping in.
  // Draw state lives in refs (not React state) and is painted imperatively, so the
  // per-frame camera updates never trigger re-renders and there are no effect races.
  //   reachedRef — city index the reveal has reached (line drawn up to here)
  //   targetRef  — city index the scroll wants (the active stop)
  //   genRef     — generation token; bumped to abort an in-flight pump
  const revealStateRef = useRef({ animLeg: -1, animProg: 0, fullLegs: 0, markerMax: -1, revealing: false });
  const reachedRef = useRef(-1);
  const targetRef = useRef(-1);
  const pumpingRef = useRef(false);
  const rafRef = useRef(0);
  const genRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;

    const paint = () => {
      const s = revealStateRef.current;
      if (map.__routeLines) map.__routeLines.sig = null;
      drawRouteReveal(map, legs, s.animLeg >= 0 ? s.animLeg : s.fullLegs, s.animLeg >= 0 ? s.animProg : 0, { dashedId: 'mv-dashed', solidId: 'mv-solid' });
      applyMarkerVisibility(markersRef.current, orderIndexById, s.markerMax, true);
    };
    const settle = (reached) => {
      revealStateRef.current = { animLeg: -1, animProg: 0, fullLegs: reached, markerMax: reached, revealing: true };
      paint();
    };

    // ── Not revealing (top of the page): the WHOLE route + all markers; ease the
    // camera back to the full frame if we are leaving a reveal. ──
    if (!revealing) {
      genRef.current += 1;
      cancelAnimationFrame(rafRef.current);
      pumpingRef.current = false;
      const leaving = reachedRef.current >= 0;
      reachedRef.current = -1;
      targetRef.current = -1;
      revealStateRef.current = { animLeg: -1, animProg: 0, fullLegs: 0, markerMax: -1, revealing: false };
      drawRouteLinesCached(map, lineSig, legs, { dashedId: 'mv-dashed', solidId: 'mv-solid' });
      applyMarkerVisibility(markersRef.current, orderIndexById, -1, false);
      if (leaving && ordered.length > 0) {
        fitToPoints(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 60, maxZoom: 8, animate: true });
      }
      return undefined;
    }

    targetRef.current = revealActiveIdx;

    // ── Scroll BACK: abort the pump and snap to the active city (no reverse anim). ──
    if (targetRef.current < reachedRef.current) {
      genRef.current += 1;
      cancelAnimationFrame(rafRef.current);
      pumpingRef.current = false;
      reachedRef.current = targetRef.current;
      settle(reachedRef.current);
      const dest = ordered[reachedRef.current];
      if (dest) map.flyTo({ center: [dest.longitude, dest.latitude], zoom: REVEAL_CITY_ZOOM, duration: 900, essential: true });
      return undefined;
    }

    // ── Forward: start the queue pump (if not already running). ──
    if (!pumpingRef.current && targetRef.current > reachedRef.current) {
      pumpingRef.current = true;
      const myGen = ++genRef.current;

      const animateLeg = (L, step) => {
        const from = ordered[L];
        const to = ordered[L + 1];
        if (!from || !to) { reachedRef.current = L + 1; settle(reachedRef.current); step(); return; }
        const kind = legs[L]?.kind;
        // Mid-flight zoom-out amount: long legs dip further out so the whole leg
        // is visible, short legs stay near the city zoom (dip ≈ 0).
        let dip = 0;
        try {
          const cam = map.cameraForBounds(
            new mapboxgl.LngLatBounds([from.longitude, from.latitude], [to.longitude, to.latitude]),
            { padding: 80 },
          );
          if (cam && typeof cam.zoom === 'number') dip = Math.max(0, REVEAL_CITY_ZOOM - cam.zoom);
        } catch { /* ignore */ }
        const dur = revealLegDuration(from, to);
        const t0 = performance.now();
        revealStateRef.current = { animLeg: L, animProg: 0, fullLegs: L, markerMax: L, revealing: true };
        paint();
        const frame = (now) => {
          if (myGen !== genRef.current) return;
          const p = Math.min(1, (now - t0) / dur); // LINEAR — constant tempo, no terminal slow-down
          revealStateRef.current.animProg = p;
          paint();
          const tip = legPointAt(from, to, kind, p); // camera rides the line's head
          if (tip) map.jumpTo({ center: tip, zoom: REVEAL_CITY_ZOOM - dip * Math.sin(Math.PI * p) });
          if (p < 1) { rafRef.current = requestAnimationFrame(frame); return; }
          reachedRef.current = L + 1;
          settle(reachedRef.current); // leg full + destination pin pops in
          step();
        };
        rafRef.current = requestAnimationFrame(frame);
      };

      const step = () => {
        if (myGen !== genRef.current) return;
        const reached = reachedRef.current;
        const target = targetRef.current;
        if (reached >= target) { pumpingRef.current = false; settle(reached < 0 ? 0 : reached); return; }
        if (reached < 0) {
          // Enter the first city — no leg, just fly the camera in, then continue.
          reachedRef.current = 0;
          settle(0);
          const c0 = ordered[0];
          if (c0) map.flyTo({ center: [c0.longitude, c0.latitude], zoom: REVEAL_CITY_ZOOM, duration: 1000, essential: true });
          map.once('moveend', () => { if (myGen === genRef.current) step(); });
          return;
        }
        if (reached < ordered.length - 1) { animateLeg(reached, step); return; }
        pumpingRef.current = false;
        settle(reached);
      };
      step();
      return undefined; // pump survives re-renders; aborted via genRef, not effect cleanup
    }

    // Already pumping (just keep the updated targetRef), or nothing to do for an
    // equal index — make sure the static draw is correct.
    if (!pumpingRef.current) settle(reachedRef.current < 0 ? 0 : reachedRef.current);
    return undefined;
  }, [ready, revealing, revealActiveIdx, legs, lineSig, orderIndexById, ordered]);

  // Abort any in-flight reveal pump on unmount (the scroll effect intentionally
  // does NOT cancel on every re-render, so the queue can run across re-renders).
  useEffect(() => () => { genRef.current += 1; cancelAnimationFrame(rafRef.current); }, []);

  // --- Parent-driven camera focus (panel ↔ map). Independent of the data draw
  // effect: opening a panel doesn't change `visits`, so the auto-fit won't move;
  // this flies to the focused city / fits the two transfer cities, and eases
  // back to the full route once focus clears. ---
  const focusSig = useMemo(
    () => (Array.isArray(focus) && focus.length ? focus.map((p) => p.join(',')).join('|') : ''),
    [focus],
  );
  const hadFocusRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    // While a progressive reveal is active, the reveal controller owns the camera.
    if (revealActiveId != null) return;
    if (focusSig) {
      hadFocusRef.current = true;
      if (focus.length === 1) {
        map.flyTo({ center: focus[0], zoom: 9.5, duration: focusDuration, essential: true });
      } else {
        fitToPoints(map, focus, { padding: 110, maxZoom: 9, animate: true });
      }
    } else if (hadFocusRef.current) {
      hadFocusRef.current = false;
      if (ordered.length > 0) {
        fitToPoints(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 60, maxZoom: 8, animate: true });
      }
    }
  }, [ready, focusSig, revealActiveId]);

  // --- Draw markers + route lines whenever the data changes ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;

    // Markers - clear previous, then group visits that share a location.
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    // Number ONLY transit cities (1,2,3…). start / end / waypoint carry no
    // number; they render as flags / a transit glyph (see iconForKinds). Unknown
    // kinds default to transit so legacy rows still get a number.
    let transitNo = 0;
    const points = ordered.map((v) => {
      const isTransit = v.kind !== 'start' && v.kind !== 'end' && v.kind !== 'waypoint';
      return {
        lng: v.longitude,
        lat: v.latitude,
        label: isTransit ? String(++transitNo) : null,
        kind: v.kind,
        data: v,
      };
    });
    groupByLocation(points).forEach((g) => {
      const title = g.data
        .map((v) => `${countryFlag(v.country_code)} ${v.city_name}${v.country ? ', ' + v.country : ''}`)
        .join(' • ');
      const el = createMarkerEl(g.labels.filter((l) => l != null), {
        title,
        icon: iconForKinds(g.kinds),
        onClick: () => { const cb = onCityClickRef.current; if (cb) cb(g.data); },
      });
      // Tag the element with the visit ids at this spot so the selection/hover
      // effect can toggle .is-sel / .is-hover without rebuilding the markers.
      el.dataset.vids = g.data.map((v) => v && v.id).filter(Boolean).join(',');
      // While revealing, markers past the active city must start hidden so they
      // appear only as the line reaches them (the reveal controller keeps this in
      // sync on scroll; this just avoids a flash of all pins right after a rebuild).
      const rs = revealStateRef.current;
      if (rs.revealing) {
        const ids = (el.dataset.vids || '').split(',').filter(Boolean);
        const minIdx = ids.reduce((acc, id) => {
          const i = orderIndexById.get(id);
          return i == null ? acc : Math.min(acc, i);
        }, Infinity);
        if (minIdx > rs.markerMax) el.style.display = 'none';
      }
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([g.lng, g.lat]).addTo(map);
      markersRef.current.push(marker);
    });

    // Fit once per distinct set of visits - animate the camera so the map
    // glides out/in to the route as it changes (e.g. while editing structure).
    // First fit (after load / style reload) is instant; later changes ease.
    // BUT don't override an active parent focus (e.g. landing straight on a city/
    // transfer via a create-intent) — the focus effect owns the camera then.
    if (ordered.length > 0 && fittedSigRef.current !== visitsSignature && !focusSig) {
      fitToPoints(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 60, maxZoom: 8, animate: fittedSigRef.current !== '' });
      fittedSigRef.current = visitsSignature;
    }

    return undefined;
  }, [ready, ordered, transfers, visitsSignature]);

  // Selection + hover highlight — toggled on the existing marker elements (no
  // rebuild, so hovering a list is cheap). Re-runs after a marker rebuild too
  // (visitsSignature) so the state survives a redraw.
  useEffect(() => {
    if (!ready) return;
    const sel = selectedVisitId != null ? String(selectedVisitId) : null;
    const hov = hoveredVisitId != null ? String(hoveredVisitId) : null;
    markersRef.current.forEach((m) => {
      const el = m.getElement();
      const ids = (el.dataset.vids || '').split(',').filter(Boolean);
      const isSel = sel != null && ids.includes(sel);
      el.classList.toggle('is-sel', isSel);
      el.classList.toggle('is-hover', !isSel && hov != null && ids.includes(hov));
    });
  }, [ready, selectedVisitId, hoveredVisitId, visitsSignature]);

  // Selected route segment (a transfer open in the editor) drawn over the base
  // route. The leg's geometry + transport kind are resolved HERE from the live
  // transfers, keyed by the same fromId__toId pair the base line uses — so there
  // is always exactly ONE highlighted arc and it updates in lockstep when the
  // transport is added/changed (this effect re-runs because `transferKindByPair`
  // changes), never leaving a stale second arc. Runs after the base-draw effect
  // (declared above), so the highlight ends up on top of a freshly redrawn base.
  const transferKindByPair = useMemo(() => {
    const m = new globalThis.Map();
    transfers.forEach((t) => {
      const k = `${t.from_city_visit_id}__${t.to_city_visit_id}`;
      if (!m.has(k)) m.set(k, t.transport_type);
    });
    return m;
  }, [transfers]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    if (!selectedLegKey) { clearRouteHighlight(map); return undefined; }
    const sep = selectedLegKey.indexOf('__');
    const fromId = sep === -1 ? '' : selectedLegKey.slice(0, sep);
    const toId = sep === -1 ? '' : selectedLegKey.slice(sep + 2);
    const from = ordered.find((v) => String(v.id) === fromId);
    const to = ordered.find((v) => String(v.id) === toId);
    if (!from || !to) { clearRouteHighlight(map); return undefined; }
    drawRouteHighlight(map, { from, to, kind: transferKindByPair.get(selectedLegKey) });
    return undefined;
  }, [ready, selectedLegKey, ordered, transferKindByPair, visitsSignature]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0, transition: 'opacity .3s ease' }} />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 'var(--fs-base)', color: 'var(--muted)', background: 'var(--surface)', zIndex: 2 }}>
          {error ? `Map error: ${error}` : <div style={{ width: 24, height: 24, border: '2px solid var(--line)', borderTopColor: 'var(--ink)', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />}
        </div>
      )}
      {mapControls && ready && (
        <MapControls
          projection={projection}
          onToggleProjection={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
          scheme={mapScheme}
          onToggleScheme={() => setMapScheme((s) => (s === 'DARK' ? 'LIGHT' : 'DARK'))}
          showSE={showSE}
          onToggleSE={() => setShowSE((v) => !v)}
        />
      )}
      {children}
    </div>
  );
}
