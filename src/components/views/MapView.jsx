import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { mapboxgl, fitToPoints } from '@/lib/mapbox';
import { useMapSurface } from '@/lib/map/useMapSurface';
import { drawRouteLinesCached, drawRouteReveal, legPointAt, drawRouteHighlight, clearRouteHighlight, clearRouteLines } from '@/lib/map/routeLines';
import { groupByLocation, createMarkerEl, createHotelBadgeEl, createClusterBubbleEl, iconForKinds } from '@/lib/map/markers';
import { buildClusterIndex, queryViewport, isIrreducible, expansionZoom, isolationZoom, spiderfyLayout } from '@/lib/map/cluster';
import { calmFlyTo, calmFit } from '@/lib/map/camera';
import MapControls from '@/lib/map/MapControls';
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
  // Optional progressive reveal (public shared-trip reader). When `revealActiveId`
  // is set, the route is NOT drawn whole: only the legs UP TO the active city are
  // painted and markers past it are hidden. When the active city ADVANCES to the
  // next one, the connecting leg is animated growing 0→1 over the reveal leg
  // duration — in lockstep with the camera flyTo — and the next marker appears once the line
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
  // ── Hotel-pick overlay (editor fork panel, TRIP-140 + clustering TRIP-141) ──
  // Off by default; only the editor's open hotel panel flips these on, so every
  // other surface (sharing the map singleton) is untouched. When `hideRoute` is
  // true the whole trip route — city markers, lines, the selected-leg highlight
  // and the auto-fit — is suppressed and `hotelPins` (the WHOLE city pool) are
  // CLIENT-CLUSTERED (supercluster) into DOM bubbles (count + cheapest "от $X")
  // and single supplier badges, recomputed per viewport on move/zoom. selected/
  // hovered ids + click/hover callbacks wire the badges to the list both ways;
  // selecting a stay buried in a cluster zooms the cluster open until the stay
  // surfaces as its own badge (Способ A).
  hideRoute = false,
  hotelPins = null,
  selectedHotelId = null,
  hoveredHotelId = null,
  onHotelClick,
  onHotelHover,
  children,
}) {
  const containerRef = useRef(null);
  const markersRef = useRef([]);
  const hotelMarkersRef = useRef([]);
  const prevHideRouteRef = useRef(false);
  const fittedSigRef = useRef('');
  // Clustering state (TRIP-141), all imperative so move/zoom never re-renders:
  //   hotelRenderRef    — id → { kind:'badge'|'cluster', el, clusterId } for the
  //                       CURRENT viewport (powers list↔map hover/select)
  //   hotelMoveHandlerRef — the moveend listener currently attached (so we detach it)
  //   hadHotelPinsRef   — fit-to-pool happened for this city (don't re-fit on growth)
  //   pendingSelectRef  — a stay we're zooming toward (Способ A doniryvanie)
  //   selectedHotelIdRef / hoveredHotelIdRef — latest ids for the imperative render
  const hotelRenderRef = useRef(new globalThis.Map());
  const hotelMoveHandlerRef = useRef(null);
  const lastViewSigRef = useRef('');
  const hadHotelPinsRef = useRef(false);
  const pendingSelectRef = useRef(null);
  const lastSelActedRef = useRef(null);
  const selectedHotelIdRef = useRef(null);
  const hoveredHotelIdRef = useRef(null);
  useEffect(() => { selectedHotelIdRef.current = selectedHotelId != null ? String(selectedHotelId) : null; }, [selectedHotelId]);
  useEffect(() => { hoveredHotelIdRef.current = hoveredHotelId != null ? String(hoveredHotelId) : null; }, [hoveredHotelId]);

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

  // Same for the hotel-badge callbacks (stable across renders → badges aren't
  // rebuilt just because the parent passes a fresh closure).
  const onHotelClickRef = useRef(onHotelClick);
  const onHotelHoverRef = useRef(onHotelHover);
  useEffect(() => { onHotelClickRef.current = onHotelClick; }, [onHotelClick]);
  useEffect(() => { onHotelHoverRef.current = onHotelHover; }, [onHotelHover]);

  // Stable signature of the hotel pins so the cluster/build effects only re-run
  // when the actual pin set/price/logo changes, not on every parent render.
  const hotelPins2 = Array.isArray(hotelPins) ? hotelPins : null;
  const hotelPinsSig = useMemo(
    () => (hotelPins2 ? hotelPins2.map((h) => `${h.id}:${h.lat},${h.lng}:${h.priceLabel || ''}:${h.supplierLogo || ''}`).join('|') : ''),
    [hotelPins2],
  );

  // Reusable cluster index over the WHOLE pool — built once per pool/filters change
  // (src/lib/map/cluster.js, shareable by any map surface). Stays without coords are
  // excluded (list-only). Keyed on hotelPinsSig (hotelPins2 is a fresh array each
  // render); eslint can't see that the sig captures the data it reads.
  const clusterIndex = useMemo(() => {
    if (!hotelPins2 || hotelPins2.length === 0) return null;
    const features = hotelPins2
      .filter((h) => h.lat != null && h.lng != null)
      .map((h) => ({
        type: 'Feature',
        properties: { hotelId: h.id },
        geometry: { type: 'Point', coordinates: [Number(h.lng), Number(h.lat)] },
      }));
    if (features.length === 0) return null;
    return buildClusterIndex(features);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelPinsSig]);

  // id → pin lookup (coords/logo/price/name) for the imperative cluster render +
  // Способ A flyTo. Same sig key as the index.
  const hotelPinById = useMemo(() => {
    const m = new globalThis.Map();
    (hotelPins2 || []).forEach((h) => m.set(String(h.id), h));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotelPinsSig]);

  // Visual-only highlight pass: toggles .is-sel / .is-hover (+ z-index) on the
  // CURRENT viewport elements from the latest selected/hovered ids. A stay inside a
  // cluster lights up its bubble (a bubble is never the final selection — Способ A
  // zooms it open first). Reads refs so move/zoom can call it without re-rendering.
  const applyHotelHighlight = useCallback(() => {
    const index = hotelRenderRef.current;
    const sel = selectedHotelIdRef.current;
    const hov = hoveredHotelIdRef.current;
    index.forEach((entry) => { entry.el.classList.remove('is-sel', 'is-hover'); entry.el.style.zIndex = ''; });
    if (hov) {
      const e = index.get(hov);
      if (e) { e.el.classList.add('is-hover'); if (e.kind === 'badge') e.el.style.zIndex = '2'; }
    }
    if (sel) {
      const e = index.get(sel);
      if (e) {
        if (e.kind === 'badge') { e.el.classList.remove('is-hover'); e.el.classList.add('is-sel'); e.el.style.zIndex = '3'; }
        else { e.el.classList.add('is-hover'); } // selected but still clustered → cue the bubble
      }
    }
  }, []);

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
    // Hotel-pick overlay owns the map: don't draw the trip route at all.
    if (hideRoute) { cancelAnimationFrame(rafRef.current); pumpingRef.current = false; clearRouteLines(map); return undefined; }

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
  }, [ready, revealing, revealActiveIdx, legs, lineSig, orderIndexById, ordered, hideRoute]);

  // Abort any in-flight reveal pump on unmount (the scroll effect intentionally
  // does NOT cancel on every re-render, so the queue can run across re-renders).
  useEffect(() => () => { genRef.current += 1; cancelAnimationFrame(rafRef.current); }, []);

  // Remove any hotel badges on unmount (useMapSurface only owns markersRef).
  useEffect(() => () => { hotelMarkersRef.current.forEach((m) => m.remove()); hotelMarkersRef.current = []; }, []);

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
        calmFlyTo(map, { center: focus[0], zoom: 9.5 });
      } else {
        calmFit(map, focus, { padding: 110, maxZoom: 9 });
      }
    } else if (hadFocusRef.current) {
      hadFocusRef.current = false;
      if (ordered.length > 0) {
        calmFit(map, ordered.map((v) => [v.longitude, v.latitude]), { padding: 60, maxZoom: 8 });
      }
    }
  }, [ready, focusSig, revealActiveId]);

  // --- Draw markers + route lines whenever the data changes ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;

    // Hotel-pick overlay: the trip route is suppressed entirely — drop every city
    // marker + route line (the hotel badges + their own camera fit take over in the
    // effect below). Leaving the route up would clutter the badge overlay.
    // NB: fittedSigRef is left untouched so that, on the way BACK, the rebuilt route
    // is NOT instant-fitted here — the focus effect's eased fit owns the camera and
    // the return animates like every other panel close.
    if (hideRoute) {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      clearRouteLines(map);
      return undefined;
    }

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
      const el = createMarkerEl(g.labels.filter((l) => l != null), {
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
      const pts = ordered.map((v) => [v.longitude, v.latitude]);
      if (fittedSigRef.current === '') {
        fitToPoints(map, pts, { padding: 60, maxZoom: 8, duration: 0 }); // first frame after load: snap
      } else if (revealActiveId == null) {
        calmFit(map, pts, { padding: 60, maxZoom: 8 }); // non-public: adaptive calm tempo
      } else {
        fitToPoints(map, pts, { padding: 60, maxZoom: 8, duration: 650 }); // public reveal: its own tempo
      }
      fittedSigRef.current = visitsSignature;
    }

    return undefined;
  }, [ready, ordered, transfers, visitsSignature, hideRoute]);

  // --- Hotel-pick overlay clustering (TRIP-141) -----------------------------
  // Owns the hotel markers while the overlay is open: builds a moveend listener
  // that recomputes the visible clusters/badges for the current viewport, fits the
  // camera to the pool once per city, and tears everything down (with a dissolve)
  // when the overlay closes. Re-runs when the pool changes (hotelPinsSig) so the
  // background tail pages appear progressively without a camera jump.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;

    // Leaving the overlay (hideRoute true→false): dissolve current markers (opacity
    // only — NEVER transform: Mapbox owns the marker root's inline translate). A
    // pool change WITHIN the overlay removes instantly.
    const leavingOverlay = prevHideRouteRef.current && !hideRoute;
    const teardown = () => {
      hotelMarkersRef.current.forEach((m) => {
        const el = m.getElement();
        if (leavingOverlay && el.animate) {
          const anim = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out' });
          anim.finished.then(() => m.remove(), () => m.remove());
        } else { m.remove(); }
      });
      hotelMarkersRef.current = [];
    };
    if (hotelMoveHandlerRef.current) {
      map.off('move', hotelMoveHandlerRef.current.onMove);
      map.off('moveend', hotelMoveHandlerRef.current.onMoveEnd);
      hotelMoveHandlerRef.current = null;
    }
    teardown();
    prevHideRouteRef.current = hideRoute;

    if (!hideRoute || !clusterIndex) {
      hadHotelPinsRef.current = false;
      hotelRenderRef.current = new globalThis.Map();
      pendingSelectRef.current = null;
      lastSelActedRef.current = null;
      return undefined;
    }

    // Rebuild the DOM markers for the current (padded) viewport from the index.
    // `onMove` calls this only when the integer zoom changes (so clusters split
    // smoothly DURING a single zoom animation — live declustering — without
    // rebuilding on every pan frame); `onMoveEnd` always refreshes for the final
    // position (handles panning).
    const renderViewport = () => {
      lastViewSigRef.current = Math.round(map.getZoom());
      const features = queryViewport(clusterIndex, map);

      hotelMarkersRef.current.forEach((m) => m.remove());
      hotelMarkersRef.current = [];
      const index = new globalThis.Map();

      // One supplier badge (wired to the list both ways) for a single stay.
      const addBadge = (id, lngLat) => {
        const pin = hotelPinById.get(String(id));
        const el = createHotelBadgeEl(
          { supplierLogo: pin?.supplierLogo, priceLabel: pin?.priceLabel },
          {
            title: pin?.name,
            onClick: () => onHotelClickRef.current?.(id),
            onHover: (entering) => onHotelHoverRef.current?.(entering ? id : null),
          },
        );
        el.dataset.hotelId = String(id);
        hotelMarkersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat(lngLat).addTo(map));
        index.set(String(id), { kind: 'badge', el });
      };

      features.forEach((f) => {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        if (!p.cluster) { addBadge(p.hotelId, [lng, lat]); return; }
        const clusterId = p.cluster_id;
        // Coincident pins no zoom can split → fan them into a ring of real badges
        // (each individually selectable) instead of an undivable bubble.
        if (isIrreducible(clusterIndex, clusterId)) {
          spiderfyLayout(map, [lng, lat], clusterIndex.getLeaves(clusterId, Infinity))
            .forEach(({ leaf, lngLat }) => addBadge(leaf.properties.hotelId, lngLat));
          return;
        }
        // Otherwise a count bubble; clicking zooms (calmly) to where it splits.
        const el = createClusterBubbleEl(p.point_count, {
          onClick: () => calmFlyTo(map, { center: [lng, lat], zoom: expansionZoom(clusterIndex, clusterId) }),
        });
        hotelMarkersRef.current.push(new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map));
        // Map every leaf id to this bubble (§4 index) for list↔map hover/select.
        clusterIndex.getLeaves(clusterId, Infinity).forEach((leaf) => {
          index.set(String(leaf.properties.hotelId), { kind: 'cluster', el, clusterId });
        });
      });

      hotelRenderRef.current = index;
      applyHotelHighlight();
      // Способ A finishes here: the select effect issues ONE smooth flyTo to the
      // stay's isolation zoom; live declustering (above) surfaces it as a badge mid-
      // animation, applyHotelHighlight styles it — just drop the pending flag.
      if (pendingSelectRef.current != null) {
        const e = index.get(String(pendingSelectRef.current));
        if (!e || e.kind === 'badge') pendingSelectRef.current = null;
      }
    };

    const onMove = () => { if (Math.round(map.getZoom()) !== lastViewSigRef.current) renderViewport(); };
    const onMoveEnd = () => renderViewport();
    hotelMoveHandlerRef.current = { onMove, onMoveEnd };
    lastViewSigRef.current = '';
    map.on('move', onMove);
    map.on('moveend', onMoveEnd);

    // First paint for this city → fit the camera to the WHOLE pool once. Later pool
    // growth (tail pages) must NOT jump the camera, so guard with hadHotelPinsRef.
    if (!hadHotelPinsRef.current) {
      hadHotelPinsRef.current = true;
      const pts = (hotelPins2 || []).filter((h) => h.lat != null && h.lng != null).map((h) => [h.lng, h.lat]);
      if (pts.length) calmFit(map, pts, { padding: 80, maxZoom: 15 });
    }
    renderViewport();

    return () => {
      if (hotelMoveHandlerRef.current) {
        map.off('move', hotelMoveHandlerRef.current.onMove);
        map.off('moveend', hotelMoveHandlerRef.current.onMoveEnd);
        hotelMoveHandlerRef.current = null;
      }
    };
  }, [ready, hideRoute, hotelPinsSig, clusterIndex, hotelPinById, applyHotelHighlight]);

  // Hotel selection + hover highlight (no rebuild) + Способ A. Hover/selection just
  // re-toggle classes; a NEW selection buried in a cluster (or off the current
  // viewport) flies in ONE smooth zoom to the stay's isolation zoom — the zoom at
  // which it's its own pin. Live declustering (renderViewport on each integer-zoom
  // step) splits the clusters smoothly during that single animation, and the
  // pending flag resolves when the badge surfaces. Guarded by lastSelActedRef so
  // pool growth / hover changes don't re-fire the flyTo for an unchanged selection.
  useEffect(() => {
    if (!ready || !hideRoute) return;
    applyHotelHighlight();
    const sel = selectedHotelId != null ? String(selectedHotelId) : null;
    if (sel == null) { pendingSelectRef.current = null; lastSelActedRef.current = null; return; }
    if (sel === lastSelActedRef.current) return; // unchanged selection — don't re-fly
    lastSelActedRef.current = sel;
    const e = hotelRenderRef.current.get(sel);
    const pin = hotelPinById.get(sel);
    const map = mapRef.current;
    if (e && e.kind === 'badge') {
      pendingSelectRef.current = null; // already a visible badge — applyHotelHighlight styled it, don't move the camera
    } else if (map && pin && clusterIndex) {
      pendingSelectRef.current = sel;
      const targetZoom = isolationZoom(clusterIndex, sel, [pin.lng, pin.lat], { minZoom: map.getZoom() });
      calmFlyTo(map, { center: [pin.lng, pin.lat], zoom: targetZoom });
    } else {
      pendingSelectRef.current = null;
    }
  }, [ready, hideRoute, selectedHotelId, hoveredHotelId, hotelPinsSig, clusterIndex, hotelPinById, applyHotelHighlight]);

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
    if (hideRoute || !selectedLegKey) { clearRouteHighlight(map); return undefined; }
    const sep = selectedLegKey.indexOf('__');
    const fromId = sep === -1 ? '' : selectedLegKey.slice(0, sep);
    const toId = sep === -1 ? '' : selectedLegKey.slice(sep + 2);
    const from = ordered.find((v) => String(v.id) === fromId);
    const to = ordered.find((v) => String(v.id) === toId);
    if (!from || !to) { clearRouteHighlight(map); return undefined; }
    drawRouteHighlight(map, { from, to, kind: transferKindByPair.get(selectedLegKey) });
    return undefined;
  }, [ready, selectedLegKey, ordered, transferKindByPair, visitsSignature, hideRoute]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: ready ? 1 : 0, transition: 'opacity .3s ease' }} />
      {!ready && (
        <div className="t-body" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--muted)', background: 'var(--surface)', zIndex: 2 }}>
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
