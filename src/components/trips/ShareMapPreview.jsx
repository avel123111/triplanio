import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, SHARE_MAP_STYLE, baseConfig, applyBasemapConfig, fitToPoints } from '@/lib/mapbox';
import { buildRoute, drawTripRoute, SC_WEIGHTS, buildBadgeImages, placeCityBadges } from '@/lib/map/captureMap';
import { prewarmRoadGeometry } from '@/lib/map/routeLines';
import { Btn, Skeleton } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

// Live map for the share card (TRIP-193). The map sits in the card frame's
// "hole" and the frame SVG (transparent where the map goes) is laid on top with
// pointer-events:none, so the map spins behind while the frame owns all the
// framing (rounding/border/shape). The user composes the shot with native
// gestures (drag/pinch/rotate/tilt) - NO movement buttons; only theme (light/dark)
// and projection (flat/globe) toggles. getComposition() hands the composed camera
// to renderCardMapPng, which re-renders the map at full card resolution.
//
// Two roles, one component (share-UX эксперимент): конструктор карточки рендерит
// его КАЛЬКОЙ (interactive=false — карта без жестов и тогглов, камера приезжает
// пропом `camera`), а полноэкранный редактор карты — живым (interactive). Обе
// поверхности считают зум от СВОЕЙ ширины контейнера, поэтому камера возится
// композицией {center, zoom, previewCssWidth, …} и пересчитывается на месте.
//
// slot/cardW/cardH come from the overlay render (source of truth for the hole
// geometry); until they arrive the map fills the whole box.
// bare — режим редактора карты: НЕТ рамки-SVG и лоадера под неё, карта во весь
// контейнер (пропорцию слота держит вызыватель), тогглы темы/проекции живут без
// рамки; cardW при этом = ширина СЛОТА, чтобы веса линий/бейджей масштабились
// от финального разрешения карты.
const ShareMapPreview = forwardRef(function ShareMapPreview(
  { visits = [], transfers = [], lang, showSE = false, overlaySvg, slot, cardW = 1080, cardH = 1920, interactive = true, camera = null, bare = false },
  ref,
) {
  const { t } = useI18n();
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  // Latest slot/card geometry, read inside the create-once map effect (whose
  // closure would otherwise see only the first render's values).
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const cardWRef = useRef(cardW);
  cardWRef.current = cardW;
  // Route cities, so the theme toggle + placement can reach them outside the
  // create-once map effect.
  const orderedRef = useRef([]);
  // Preview shrink factor: the preview canvas is far smaller than the full card,
  // so fixed-px markers/lines/badges are scaled by (preview width / card width) to
  // keep preview == final. Returns the container size too (for badge placement).
  const currentScale = () => {
    const cw = holderRef.current?.clientWidth || 0;
    const ch = holderRef.current?.clientHeight || 0;
    const sw = slotRef.current?.w || cardWRef.current || 0;
    const s = cw && sw ? Math.min(1.5, Math.max(0.15, cw / sw)) : 1;
    return { cw, ch, s };
  };
  const [scheme, setScheme] = useState(camera?.scheme || 'LIGHT');
  const [projection, setProjection] = useState(camera?.projection || 'mercator');
  const [fontTick, setFontTick] = useState(0);
  // Свежая камера для замыканий create-once эффекта (как slotRef выше).
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  // «Подвести карту к текущей камере/фиту» — заполняется create-once эффектом,
  // дёргается эффектом на смену пропа `camera` (apply из редактора).
  const syncRef = useRef(/** @type {null | (() => void)} */ (null));

  // The frame SVG carries its fonts as @font-face (embedded data URIs). They load
  // from the data URI ~instantly, but font-display:block hides the text until the
  // face is ready; nudge a repaint once fonts settle so the frame paints with the
  // real glyphs (never a device fallback) - this is what keeps it identical across
  // devices instead of "разъезжается".
  useEffect(() => {
    if (!overlaySvg || !document?.fonts?.ready) return undefined;
    let alive = true;
    document.fonts.ready.then(() => { if (alive) setFontTick((n) => n + 1); });
    return () => { alive = false; };
  }, [overlaySvg]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !holderRef.current || mapRef.current) return undefined;
    const { ordered, legs } = buildRoute(visits, transfers, showSE);
    orderedRef.current = ordered;
    const pts = ordered.map((v) => [v.longitude, v.latitude]);
    const map = new mapboxgl.Map({
      container: holderRef.current,
      style: SHARE_MAP_STYLE,
      config: baseConfig(scheme),
      ...(lang ? { language: lang } : {}),
      projection,
      center: ordered[0] ? [ordered[0].longitude, ordered[0].latitude] : [0, 20],
      zoom: 2,
      // Калька конструктора живёт без жестов ВООБЩЕ (жесты — в редакторе карты);
      // с `interactive: false` mapbox не вешает обработчики, и свайпы уходят
      // родителю (на мобиле — vaul-шиту).
      interactive,
      attributionControl: false,
    });
    mapRef.current = map;

    let userMoved = false;
    // ★ Жест — только событие С originalEvent: mapbox шлёт zoomstart/movestart и
    // на ПРОГРАММНОЕ движение (fitToPoints/jumpTo). Без проверки первый же
    // авто-фит взводил userMoved, и синк камеры из редактора («Done») навсегда
    // блокировался — превью карточки не обновлялось.
    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((type) => map.on(type, (e) => { if (e?.originalEvent) userMoved = true; }));
    // Пока пользователь не взялся за карту сам: с приехавшей камерой — держим её
    // (зум пересчитан под ширину ЭТОГО контейнера из previewCssWidth композиции),
    // без камеры — авто-фит по точкам маршрута.
    const fit = () => {
      if (userMoved) return;
      const cam = cameraRef.current;
      if (cam) {
        // `|| 1` в хвосте — страховка от NaN (log2(0/0)), когда и контейнер, и
        // композиция без ширины: тогда зум просто не пересчитывается.
        const w = holderRef.current?.clientWidth || cam.previewCssWidth || 1;
        map.jumpTo({
          center: cam.center,
          zoom: cam.zoom + Math.log2(w / (cam.previewCssWidth || w)),
          bearing: cam.bearing || 0,
          pitch: cam.pitch || 0,
        });
      } else if (pts.length) {
        // Отступ фита ОТНОСИТЕЛЬНЫЙ (≈14% ширины, пол 40px): в крупном редакторе
        // абсолютные 40px прижимали бы города к краям, и стартовый кадр редактора
        // расходился бы с кадром превью. Осознанный размен: на широком превью
        // (post на десктопе) авто-фит стал чуть воздушнее прежних константных 40px.
        const w = holderRef.current?.clientWidth || 0;
        fitToPoints(map, pts, { padding: Math.max(40, Math.round(w * 0.14)), maxZoom: 9 });
      }
    };
    syncRef.current = fit;

    // Draw the route only once the map is FULLY ready to accept sources+layers.
    // On the Mapbox Standard style, 'style.load' (and even isStyleLoaded()===true)
    // can be reached BEFORE the style is ready - addLayer then silently does
    // nothing and the preview route never appears. The main app map avoids this
    // by waiting for 'load'/'idle'; mirror that here. Idempotent: once sc-solid
    // exists we only refit, and 'idle'/'styledata' re-add it if a later style
    // re-eval (theme/projection toggle) drops it.
    // Scale the fixed-px markers/lines/badge for the small preview so it matches the
    // full-res card (TRIP-193). Re-applied on every settle so it self-corrects once
    // the slot geometry arrives after the overlay loads (hole resizes → idle → here).
    const applyWeights = () => {
      const { cw, s } = currentScale();
      if (!cw) return;
      if (map.getLayer('sc-points-halo')) map.setPaintProperty('sc-points-halo', 'circle-radius', SC_WEIGHTS.halo * s);
      if (map.getLayer('sc-points-dot')) map.setPaintProperty('sc-points-dot', 'circle-radius', SC_WEIGHTS.dot * s);
      if (map.getLayer('sc-solid')) map.setPaintProperty('sc-solid', 'line-width', SC_WEIGHTS.solid * s);
      if (map.getLayer('sc-dashed')) map.setPaintProperty('sc-dashed', 'line-width', SC_WEIGHTS.dashed * s);
      if (map.getLayer('sc-labels')) map.setLayoutProperty('sc-labels', 'icon-size', SC_WEIGHTS.badge * s);
    };
    // Re-run adaptive badge placement for the current camera. Kept OFF the 'idle'
    // path (placement calls setData → idle; re-placing there would loop) — 'moveend'
    // (user gesture or programmatic fit) is the cue. No-op until images exist.
    const placeNow = () => {
      const { cw, ch, s } = currentScale();
      if (cw && map.__scBadge) placeCityBadges(map, orderedRef.current, { cw, ch, iconScale: SC_WEIGHTS.badge * s });
    };
    const drawIfNeeded = () => {
      if (!pts.length) return;
      // ★ На уже нарисованном маршруте fit() с idle-пути НЕ зовётся: jumpTo шлёт
      // moveend БЕЗУСЛОВНО (даже без смены камеры) → placeNow → setData → снова
      // idle — вечный цикл. Раньше его случайно тормозил дефектный userMoved
      // (взводился программным фитом); с починкой жеста тормоза нет, поэтому у
      // фита остаются только реальные поводы: первый рендер маршрута (ниже),
      // resize (ResizeObserver) и смена камеры (эффект [camera]).
      if (map.getSource('sc-solid')) { applyWeights(); return; }
      const { cw, ch, s } = currentScale();
      try { drawTripRoute(map, ordered, legs, { scheme, cw, ch, iconScale: SC_WEIGHTS.badge * s }); } catch (err) { console.error('share preview draw failed', err); }
      applyWeights();
      prewarmRoadGeometry(legs); // warm the shared road cache so the capture gets curves
      fit();
    };
    map.once('load', drawIfNeeded);
    map.on('idle', drawIfNeeded);
    map.on('styledata', drawIfNeeded);
    map.on('moveend', placeNow);

    // The dialog animates open and the hole box resizes with the overlay load, so
    // resize + refit once it settles (until the user takes over).
    const ro = new ResizeObserver(() => { map.resize(); fit(); });
    ro.observe(holderRef.current);

    return () => {
      ro.disconnect();
      map.off('idle', drawIfNeeded);
      map.off('styledata', drawIfNeeded);
      map.off('moveend', placeNow);
      map.remove();
      mapRef.current = null;
      syncRef.current = null;
    };
    // Create once per mount; visits/transfers are stable for an open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    // Camera + theme the user composed, so the final card can re-render the route
    // map at full card resolution with the SAME framing (see renderCardMapPng).
    getComposition() {
      const m = mapRef.current;
      if (!m) return null;
      const c = m.getCenter();
      return {
        center: [c.lng, c.lat],
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        pitch: m.getPitch(),
        projection,
        scheme,
        previewCssWidth: m.getContainer()?.clientWidth || 0,
      };
    },
  }), [scheme, projection]);

  function applyScheme(next) {
    setScheme(next);
    const m = mapRef.current;
    if (!m) return;
    applyBasemapConfig(m, next);
    // Badge colours are baked into the image, so re-composite them for the flipped
    // basemap (dark ink/light halo ⇄ light ink/dark halo), then re-place.
    buildBadgeImages(m, orderedRef.current, next).then(() => {
      const { cw, ch, s } = currentScale();
      if (cw) placeCityBadges(m, orderedRef.current, { cw, ch, iconScale: SC_WEIGHTS.badge * s });
    }).catch(() => { /* keep old badges on failure */ });
  }

  function toggleTheme() {
    applyScheme(scheme === 'DARK' ? 'LIGHT' : 'DARK');
  }

  // Камера приехала/сменилась снаружи (Done в редакторе карты): подвести карту
  // и согласовать тему/проекцию с композицией.
  useEffect(() => {
    if (!camera) return;
    if (camera.projection && camera.projection !== projection) {
      setProjection(camera.projection);
      try { mapRef.current?.setProjection(camera.projection); } catch { /* projection unsupported */ }
    }
    if (camera.scheme && camera.scheme !== scheme) applyScheme(camera.scheme);
    syncRef.current?.();
    // scheme/projection здесь — производные той же камеры, не отдельные триггеры.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  function toggleProjection() {
    const next = projection === 'globe' ? 'mercator' : 'globe';
    setProjection(next);
    if (mapRef.current) {
      try { mapRef.current.setProjection(next); } catch { /* projection unsupported */ }
    }
  }

  const pct = (v, total) => `${(v / total) * 100}%`;
  const holeStyle = !bare && slot
    ? { left: pct(slot.x, cardW), top: pct(slot.y, cardH), width: pct(slot.w, cardW), height: pct(slot.h, cardH) }
    : { inset: 0 };
  // Фон задаём через КАНАЛ примитива `--bg`, а не инлайновым `background`: канон
  // «нажато» (`.btn[aria-pressed]`) красит `background` напрямую и перебивает
  // `var(--bg)`, а инлайновый `background` перебил бы САМ канон (Г22, ревью Codex)
  // — тогда нажатое состояние карты-тогглов не встаёт. Тень — для читаемости
  // кнопки поверх карты, к состоянию отношения не имеет.
  const btnStyle = { '--bg': 'var(--surface)', boxShadow: 'var(--shadow-1, 0 1px 4px rgba(0,0,0,.2))' };
  // The frame SVG comes from the edge function as markup; render it inline (so it
  // uses the app's loaded fonts) and stretch it to fill the box. Its transparent
  // blob hole reveals the live map behind. pointer-events:none lets gestures pass.
  const frameSvg = overlaySvg
    ? overlaySvg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block" ')
    : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={holderRef} style={{ position: 'absolute', overflow: 'hidden', ...holeStyle }} />
      {frameSvg && (
        <div
          key={`frame-${fontTick}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: frameSvg }}
        />
      )}
      {/* Until the frame SVG arrives the map would sit BARE in the box; cover it
          with a loader so the user never sees a frameless map (TRIP-193). В bare-
          режиме рамки нет по замыслу — карта и есть содержимое. */}
      {!frameSvg && !bare && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <Skeleton w="100%" h="100%" r={0} />
        </div>
      )}
      {interactive && (frameSvg || bare) && (
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Btn variant="secondary" icon={scheme === 'DARK' ? 'sun' : 'moon'} ariaLabel={t('share.map_theme')} ariaPressed={scheme === 'LIGHT'} onClick={toggleTheme} style={btnStyle} />
          <Btn variant="secondary" icon={projection === 'globe' ? 'map' : 'globe'} ariaLabel={t('share.map_projection')} ariaPressed={projection === 'globe'} onClick={toggleProjection} style={btnStyle} />
        </div>
      )}
    </div>
  );
});

export default ShareMapPreview;
