import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { mapboxgl, MAPBOX_TOKEN, MAP_STYLE, baseConfig, applyBasemapConfig, fitToPoints, loadMapboxGl } from '@/lib/mapbox';
import { buildRoute, drawTripRoute, SC_WEIGHTS, rescaleZoom } from '@/lib/map/captureMap';
import { prewarmRoadGeometry } from '@/lib/map/routeLines';
import { Skeleton } from '@/design/index';
import MapControls from '@/lib/map/MapControls';

// Live map for the share card (TRIP-193). The map sits in the card frame's
// "hole" and the frame SVG (transparent where the map goes) is laid on top with
// pointer-events:none, so the map spins behind while the frame owns all the
// framing (rounding/border/shape). The user composes the shot with native
// gestures (drag/pinch/rotate/tilt) - NO movement buttons; управление — общая
// плашка `<MapControls>` (тема / проекция / старт-финиш), та же, что у остальных
// карт приложения. getComposition() hands the composed camera (вместе с составом
// маршрута) to renderCardMapPng, which re-renders the map at full card resolution.
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
// контейнер (пропорцию слота держит вызыватель), плашка контролов живёт без
// рамки; cardW при этом = ширина СЛОТА, чтобы веса линий/бейджей масштабились
// от финального разрешения карты.
const ShareMapPreview = forwardRef(function ShareMapPreview(
  { visits = [], transfers = [], lang, showSE = true, overlaySvg, slot, cardW = 1080, cardH = 1920, interactive = true, camera = null, bare = false },
  ref,
) {
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  // Latest slot/card geometry, read inside the create-once map effect (whose
  // closure would otherwise see only the first render's values).
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const cardWRef = useRef(cardW);
  cardWRef.current = cardW;
  // Preview shrink factor: the preview canvas is far smaller than the full card,
  // so fixed-px markers/lines are scaled by (preview width / card width) to keep
  // preview == final.
  const currentScale = () => {
    const cw = holderRef.current?.clientWidth || 0;
    const sw = slotRef.current?.w || cardWRef.current || 0;
    const s = cw && sw ? Math.min(1.5, Math.max(0.15, cw / sw)) : 1;
    return { cw, s };
  };
  const [scheme, setScheme] = useState(camera?.scheme || 'LIGHT');
  const [projection, setProjection] = useState(camera?.projection || 'mercator');
  const [fontTick, setFontTick] = useState(0);
  // Свежая камера для замыканий create-once эффекта (как slotRef выше).
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  // applyCameraRef — ПРИНУДИТЕЛЬНО применить приехавшую камеру (Done в редакторе):
  // это явное решение пользователя, оно ОБЯЗАНО примениться даже если превью-карту
  // кто-то трогал. Авто-фит по точкам живёт отдельной функцией `fit` внутри эффекта.
  const applyCameraRef = useRef(/** @type {null | (() => void)} */ (null));
  // Показ старта/финиша — состояние ЭТОЙ поверхности (кнопка в плашке карты), а
  // проп `showSE` только задаёт начальное значение. `redrawRef` пересобирает
  // маршрут под новый состав: набор точек меняется, а карта создаётся один раз.
  const [se, setSe] = useState(camera?.showSE ?? showSE);
  const seRef = useRef(se);
  seRef.current = se;
  const redrawRef = useRef(/** @type {null | ((v: boolean) => void)} */ (null));

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
    // Библиотека карты приезжает ПО ТРЕБОВАНИЮ (TRIP-445): без неё нет ни
    // `mapboxgl`, ни `mapbox-gl.css`, а калька карточки открывается и с линзы,
    // где карты не было. Поэтому установка целиком уехала в `start()` и зовётся
    // только после загрузки; её уборка хранится в `teardown` и срабатывает
    // независимо от того, успела ли библиотека приехать до размонтирования.
    let alive = true;
    let teardown = null;
    const start = () => {
      let { ordered, legs } = buildRoute(visits, transfers, seRef.current);
      let pts = ordered.map((v) => [v.longitude, v.latitude]);
      const map = new mapboxgl.Map({
        container: holderRef.current,
        style: MAP_STYLE,
        config: baseConfig(scheme),
        // Токен СВОЕЙ опцией: раньше он прилетал сюда побочным эффектом импорта
        // `@/lib/mapbox` (глобальный `mapboxgl.accessToken`). Библиотека грузится
        // по требованию (TRIP-445), порядок загрузки больше не гарантирован —
        // поэтому каждый, кто создаёт карту, называет токен сам.
        ...(MAPBOX_TOKEN ? { accessToken: MAPBOX_TOKEN } : {}),
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

      // Mapbox-логотип — DOM-оверлей (не часть WebGL-canvas): в финальный PNG,
      // снимаемый с canvas, он НЕ попадает, а в превью-кальке висел поверх
      // стилизованной карточки (Pavel: «аттрибуция посередине карты»). Снимаем его
      // в превью, чтобы превью == финал. LogoControl добавляется синхронно в
      // конструкторе Map; на всякий случай повторяем на 'load' (переинициализация
      // стиля могла бы вернуть узел).
      const stripMapboxChrome = () => {
        holderRef.current?.querySelectorAll('.mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib').forEach((el) => el.remove());
      };
      stripMapboxChrome();
      map.once('load', stripMapboxChrome);

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
          map.jumpTo({
            center: cam.center,
            zoom: rescaleZoom(cam.zoom, cam.previewCssWidth, holderRef.current?.clientWidth),
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

      // Принудительно применить приехавшую камеру: НЕ гейтится userMoved (Done —
      // явное решение), ширину берём с фолбэком на previewCssWidth (если контейнер
      // ещё не измерен — на мобиле шит редактора только что закрылся). ResizeObserver
      // затем до-уточнит зум под реальную ширину, но кадр меняется сразу.
      const applyCamera = () => {
        const cam = cameraRef.current;
        if (!cam) { fit(); return; }
        const w = holderRef.current?.clientWidth || cam.previewCssWidth;
        map.jumpTo({
          center: cam.center,
          zoom: rescaleZoom(cam.zoom, cam.previewCssWidth, w),
          bearing: cam.bearing || 0,
          pitch: cam.pitch || 0,
        });
      };
      applyCameraRef.current = applyCamera;

      // Draw the route only once the map is FULLY ready to accept sources+layers.
      // On the Mapbox Standard style, 'style.load' (and even isStyleLoaded()===true)
      // can be reached BEFORE the style is ready - addLayer then silently does
      // nothing and the preview route never appears. The main app map avoids this
      // by waiting for 'load'/'idle'; mirror that here. Idempotent: once sc-solid
      // exists we only refit, and 'idle'/'styledata' re-add it if a later style
      // re-eval (theme/projection toggle) drops it.
      // Scale the fixed-px markers/lines for the small preview so it matches the
      // full-res card (TRIP-193). Re-applied on every settle so it self-corrects once
      // the slot geometry arrives after the overlay loads (hole resizes → idle → here).
      const applyWeights = () => {
        const { cw, s } = currentScale();
        if (!cw) return;
        if (map.getLayer('sc-points-halo')) map.setPaintProperty('sc-points-halo', 'circle-radius', SC_WEIGHTS.halo * s);
        if (map.getLayer('sc-points-dot')) map.setPaintProperty('sc-points-dot', 'circle-radius', SC_WEIGHTS.dot * s);
        if (map.getLayer('sc-solid')) map.setPaintProperty('sc-solid', 'line-width', SC_WEIGHTS.solid * s);
        if (map.getLayer('sc-dashed')) map.setPaintProperty('sc-dashed', 'line-width', SC_WEIGHTS.dashed * s);
      };
      const drawIfNeeded = () => {
        if (!pts.length) return;
        // На уже нарисованном маршруте только доводим веса под текущий размер; фит
        // зовётся лишь по реальным поводам (первый рендер ниже, resize, смена камеры).
        if (map.getSource('sc-solid')) { applyWeights(); return; }
        try { drawTripRoute(map, ordered, legs); } catch (err) { console.error('share preview draw failed', err); }
        applyWeights();
        prewarmRoadGeometry(legs); // warm the shared road cache so the capture gets curves
        fit();
      };
      map.once('load', drawIfNeeded);
      map.on('idle', drawIfNeeded);
      map.on('styledata', drawIfNeeded);

      // Смена состава маршрута (кнопка «старт/финиш»): пересобираем набор и
      // перерисовываем на МЕСТЕ — карта создаётся один раз за монтирование.
      // Кадр не трогаем, если пользователь уже скомпоновал его сам (`fit` знает).
      redrawRef.current = (nextSe) => {
        ({ ordered, legs } = buildRoute(visits, transfers, nextSe));
        pts = ordered.map((v) => [v.longitude, v.latitude]);
        if (!pts.length) return;
        try { drawTripRoute(map, ordered, legs); } catch (err) { console.error('share preview redraw failed', err); }
        applyWeights();
        prewarmRoadGeometry(legs);
        fit();
      };

      // The dialog animates open and the hole box resizes with the overlay load, so
      // resize + refit once it settles (until the user takes over).
      const ro = new ResizeObserver(() => { map.resize(); fit(); });
      ro.observe(holderRef.current);

      return () => {
        ro.disconnect();
        map.off('idle', drawIfNeeded);
        map.off('styledata', drawIfNeeded);
        map.remove();
        mapRef.current = null;
        applyCameraRef.current = null;
        redrawRef.current = null;
      };
    };
    loadMapboxGl().then(() => {
      if (!alive || !holderRef.current || mapRef.current) return;
      teardown = start();
    }).catch(() => { /* сеть: калька останется пустой, как и без токена */ });
    return () => {
      alive = false;
      if (teardown) teardown();
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
        // Состав маршрута — часть композиции: финальный PNG рисуется по ней
        // (`renderCardMapPng`), и без этого поля картинка разошлась бы с превью.
        showSE: se,
        previewCssWidth: m.getContainer()?.clientWidth || 0,
      };
    },
  }), [scheme, projection, se]);

  function applyScheme(next) {
    setScheme(next);
    const m = mapRef.current;
    if (!m) return;
    applyBasemapConfig(m, next); // in-place day/night — маркеры и линии темы не зависят
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
    if (typeof camera.showSE === 'boolean' && camera.showSE !== se) {
      setSe(camera.showSE);
      redrawRef.current?.(camera.showSE);
    }
    // Применяем в СЛЕДУЮЩЕМ кадре: на мобиле Done закрывает шит редактора, и
    // контейнер главного превью измеряется (clientWidth) только после рефлоу —
    // синхронный jumpTo здесь взял бы нулевую ширину. rAF ждёт этот кадр.
    let raf = requestAnimationFrame(() => { raf = 0; applyCameraRef.current?.(); });
    return () => { if (raf) cancelAnimationFrame(raf); };
    // scheme/projection здесь — производные той же камеры, не отдельные триггеры.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  function toggleSE() {
    const next = !se;
    setSe(next);
    redrawRef.current?.(next);
  }

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
      {/* Кнопки карты — ОБЩАЯ плашка `<MapControls>`, та же, что на всех
          остальных картах приложения: своя пара кнопок здесь была вторым
          комплектом (другой примитив, свой угол инлайном, свои ключи перевода)
          при одинаковом смысле. Своя карта (не синглтон) этому не мешает —
          плашка чистое представление, состояние живёт тут. */}
      {interactive && (frameSvg || bare) && (
        <MapControls
          controls={['theme', 'projection', 'se']}
          scheme={scheme}
          onToggleScheme={toggleTheme}
          projection={projection}
          onToggleProjection={toggleProjection}
          showSE={se}
          onToggleSE={toggleSE}
        />
      )}
    </div>
  );
});

export default ShareMapPreview;
