import React, { useRef, useEffect, useState } from 'react';
import { mapboxgl } from '@/lib/mapbox';
import { calmFit } from '@/lib/map/camera';
import { addPadding } from '@/lib/map/padding';
import { setMapInsets } from '@/lib/map/insets';
import { useMapSurface } from '@/lib/map/useMapSurface';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { groupByLocation, createMarkerEl, createCityBadgeEl, iconForKinds } from '@/lib/map/markers';
import MapControls from '@/lib/map/MapControls';
import { useT } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';

// Build ordered legs (home → cities → finish) - self-contained so the map has
// no dependency on the planner's save logic. The finish leg is drawn only when
// `drawFinish` (the finish/review steps), so the default never pre-draws a line
// to the finish on the earlier steps.
function buildLegs(home, cities, finishCity, isStay, drawFinish) {
  const stops = [];
  if (home?.latitude) stops.push(home);
  cities.forEach((c) => { if (c.latitude) stops.push(c); });
  const lastCity = cities[cities.length - 1];
  // Не тянем нулевое плечо, если финиш совпадает по координате с последним городом.
  const sameSpot = (a, b) => a && b && a.latitude === b.latitude && a.longitude === b.longitude;
  if (!isStay && drawFinish && finishCity?.latitude && !sameSpot(finishCity, lastCity)) {
    stops.push(finishCity);
  }
  const legs = [];
  for (let i = 0; i < stops.length - 1; i++) legs.push({ id: `leg_${i}`, from: stops[i], to: stops[i + 1] });
  return legs;
}

// ВОЗДУХ вокруг маршрута — и только он. Сколько места закрыто панелью или шитом,
// решает `<MapShell>` и сообщает отступами (`insets`); складывает их с этим
// воздухом сама камера. Прежняя редакция считала ширину панели ЗДЕСЬ
// (`min(550, w*0.44)`, брейкпоинт 960) — то есть дублировала CSS числом в JS,
// и любая правка раскладки молча разъезжалась с кадрированием.
const ROUTE_AIR = 48;

// The neutral "start" globe view (before any route is picked, and what a draft
// RESET returns to). Mapbox globe: at zoom z the equatorial circumference spans
// 512·2^z px, so the sphere's on-screen diameter ≈ 512·2^z/π. Invert that to the
// zoom whose globe fills ~85% of the MAP's height — clamped so it never grows wider
// than the strip left visible beside the floating panel (else it tucks behind it).
// This is why a wide screen no longer shows a tiny planet: the size now tracks the
// container, not a fixed zoom. Phones keep a fixed start zoom — their short map band
// already frames the globe and Pavel asked to leave mobile un-adaptive. Coefficients
// are eyeballed; nudge them here if the globe reads a touch big/small.
function startGlobeView(map, pad) {
  const center = [0, 20];
  const el = map.getContainer?.();
  const H = el?.clientHeight || 0;
  const W = el?.clientWidth || 0;
  if (!H || !W) return { center, zoom: 2.4 };
  // Глобус вписывается в СВОБОДНОЕ окно — и по ширине, и по высоте. Раньше
  // высота бралась целиком (шит стоял отдельной полосой под картой); теперь шит
  // лежит ПОВЕРХ карты, и не вычесть его высоту значило бы прятать пол-планеты
  // под ним.
  const visW = Math.max(320, W - pad.left - pad.right);
  const visH = Math.max(240, H - pad.top - pad.bottom);
  const targetD = Math.min(0.85 * visH, 0.92 * visW);
  // Пол зума — не вкусовщина: ниже ~2 глобус вырождается в одноцветный круг
  // (тайлов такого масштаба нет), и это ровно то, что было видно на телефоне,
  // где свободное окно маленькое и расчёт уводил зум вниз.
  const zoom = Math.max(2, Math.min(5, Math.log2((targetD * Math.PI) / 512)));
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
// ScreenMap drives MapView. Marker ids: 'home', the city's own id, 'finish'.
// =====================================================================
export default function FlowMap({
  home, cities = [], finishCity, transport = {}, isStay = false,
  // `drawFinish` — draw the finish pin + leg (the finish/review steps). The finish
  // CITY still feeds the camera framing, so stepping between steps toggles what's
  // drawn WITHOUT re-framing.
  drawFinish = false,
  // Map-lens-style interactivity (all optional — omit for a passive preview):
  hoveredId = null, selectedId = null, cityBadge = null,
  onCityHover, onCityClick, onMapClick,
  // Закрытая площадь канваса (панель / шит) — приходит от `<MapShell>`.
  insets = null,
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

  // Unified with the trip MapView: home → start flag, finish → finish flag, transit
  // cities numbered 1..N, a 0-night stop → waypoint glyph (NOT a number, same as the
  // editor / Map lens). Each pin carries a stable id ('home' | city.id | 'finish')
  // so hover/click can address it and the tooltip can be looked up by the parent.
  // The finish pin is drawn whenever a finish node exists (кроме «останусь»); a
  // round-trip finish that coincides with the start is deduped by the по-координате
  // pin grouping — no start↔finish name compare. Drawing it requires `drawFinish`.
  const hasFinish = !isStay && finishCity?.latitude != null && showSE;
  const pts = [];
  if (home?.latitude && showSE) pts.push({ lat: home.latitude, lng: home.longitude, label: null, kind: 'start', data: 'home' });
  let transitNo = 0;
  cities.forEach((c) => {
    if (c.latitude == null) return;
    const isWaypoint = (+c.nights || 0) === 0 && !!c.city_name;
    pts.push({ lat: c.latitude, lng: c.longitude, label: isWaypoint ? null : String(++transitNo), kind: isWaypoint ? 'waypoint' : 'transit', data: String(c.id) });
  });
  if (hasFinish && drawFinish) {
    pts.push({ lat: finishCity.latitude, lng: finishCity.longitude, label: null, kind: 'end', data: 'finish' });
  }

  const totalNights = cities.reduce((n, c) => n + (+c.nights || 0), 0);
  const legs = buildLegs(home, cities, finishCity, isStay, drawFinish);

  // DRAW key — markers rebuild when this changes (incl. the finish pin appearing on
  // step 3). FIT key — the camera re-frames ONLY when this changes: the real route
  // geometry (home + cities + finish, step-independent) plus the viewport size. So
  // stepping between steps rebuilds pins but never jerks the camera; only a route
  // edit / resize re-frames. (TRIP-337, Pavel)
  const ptsKey = pts.map((p) => `${p.kind || ''}:${p.label}@${p.lat},${p.lng}`).join('|');
  const fitPositions = [];
  if (home?.latitude && showSE) fitPositions.push([home.longitude, home.latitude]);
  cities.forEach((c) => { if (c.latitude != null) fitPositions.push([c.longitude, c.latitude]); });
  if (hasFinish) fitPositions.push([finishCity.longitude, finishCity.latitude]);
  // Закрытая площадь — часть КЛЮЧА кадрирования: подняли шит, свернули панель —
  // свободное окно другое, значит кадр обязан пересчитаться. Без этого камера
  // держалась бы за старую рамку и город оставался бы под шитом.
  const insetsRef = useRef(null);
  insetsRef.current = insets;
  const insetsKey = [insets?.top, insets?.right, insets?.bottom, insets?.left]
    .map((n) => Math.round(n || 0)).join(',');
  const fitKey = `${fitPositions.map((p) => p.join(',')).join('|')}@${winW}x${winH}@${insetsKey}`;
  const legsKey = legs.map((l) => `${l.from?.latitude},${l.from?.longitude}|${l.to?.latitude},${l.to?.longitude}|${transport[l.id]?.kind || ''}`).join('::');

  // A FlowMap-owned handle to the (singleton) map instance. useMapSurface nulls its
  // own mapRef in cleanup, and React runs cleanups in declaration order — so the
  // unmount padding-reset below cannot rely on mapRef.current (already null by then).
  // This ref is never nulled by the hook, so the reset still reaches the instance.
  const mapForPaddingRef = useRef(null);

  // Did the previous fit draw a route? Lets the empty branch tell a fresh mount /
  // resize (snap to the start globe) apart from a draft RESET (glide back out).
  const prevHadPointsRef = useRef(false);
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
      // ★ ОТСТУПЫ ОБЪЯВЛЯЕМ ЗДЕСЬ, А НЕ ОТДЕЛЬНЫМ ЭФФЕКТОМ. Эффекты бегут в
      // порядке объявления: отдельный эффект отработал бы ПОСЛЕ кадрирования, и
      // камера каждый раз вставала бы по ПРЕЖНЕЙ закрытой площади — то есть
      // карта «не реагировала бы» на движение шита ровно так, как это и
      // выглядело.
      setMapInsets(map, insetsRef.current);
      const pad = addPadding(ROUTE_AIR, insetsRef.current);
      if (fitPositions.length) {
        // Route: re-frame ONLY when the route geometry / viewport actually changed
        // (fitKey) — a step change rebuilds pins above but leaves fitKey alone, so
        // the camera holds. Clear any idle-globe viewport padding first, then fit
        // with the asymmetric reserve; offset does the same for the single-point
        // (origin-only) case, which fitBounds padding can't.
        if (fitKey !== fittedSigRef.current) {
          fittedSigRef.current = fitKey;
          try { map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 }); } catch { /* ignore */ }
          // Отдаём ТОЛЬКО воздух: закрытую площадь камера добавит сама (её
          // единственный владелец — `setMapInsets` ниже), и одиночную точку она
          // так же сама уведёт из-под панели.
          calmFit(map, fitPositions, { padding: ROUTE_AIR, maxZoom: 7, singleZoom: 8 });
        }
        prevHadPointsRef.current = true;
      } else {
        // Empty globe = the neutral START view. Offset the projection into the
        // visible area (setPadding), recentre to the world, and size the globe to
        // ~85% of the map's height (desktop) so a wide screen no longer shows a
        // tiny planet. Returning here from a route (draft RESET) glides back out;
        // a fresh mount / resize just snaps (the fade-in hides it).
        try { map.setPadding(pad); } catch { /* ignore */ }
        const view = startGlobeView(map, pad);
        if (prevHadPointsRef.current) {
          try { map.easeTo({ ...view, duration: 600 }); } catch { try { map.jumpTo(view); } catch { /* ignore */ } }
        } else {
          try { map.jumpTo(view); } catch { /* ignore */ }
        }
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
    // winW/winH are read directly inside (startGlobeView) — listed so
    // exhaustive-deps stays honest, though fitKey already carries them.
  }, [ready, canFit, ptsKey, fitKey, winW, winH]);

  // Снятие на выходе: карта — синглтон, и закрытая площадь этого экрана не имеет
  // права диктовать камеру следующему.
  useEffect(() => () => setMapInsets(mapRef.current, null), []);

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
