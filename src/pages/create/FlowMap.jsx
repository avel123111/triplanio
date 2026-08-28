import React, { useRef, useEffect, useState } from 'react';
import { calmFit } from '@/lib/map/camera';
import { markFramed } from '@/lib/map/framed';
import { getMapInsets } from '@/lib/map/insets';
import { GLOBE_START_CENTER, startGlobeZoom } from '@/lib/map/globeStart';
import { PHONE_MAX_W } from '@/hooks/use-mobile';
import { useCanFrame, useMapInsets } from '@/lib/map/useMapInsets';
import { SURFACE_SETTLE_MS, surfaceEasing } from '@/lib/surfaceMotion';
import { useMapSurface } from '@/lib/map/useMapSurface';
import { drawRouteLinesCached } from '@/lib/map/routeLines';
import { useCityMarkers } from '@/lib/map/useCityMarkers';
import { useCityBadge } from '@/lib/map/useCityBadge';
import { useMapClick } from '@/lib/map/useMapClick';
import MapControls from '@/lib/map/MapControls';
import { useT } from '@/lib/i18n/I18nContext';

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

// ★ ЗДЕСЬ — ТОЛЬКО ВОЗДУХ КАДРА. Закрытую площадь карта знает сама
// (`lib/map/insets.js`: панель приезжает в `left`, шит — в `bottom`), поэтому здесь
// нет ни места под панель в отступе кадра, ни сдвига камеры: остался только
// ВОЗДУХ вокруг маршрута. Раньше ширина панели считалась ЗДЕСЬ (`min(550, 44vw)`
// и брейкпоинт 960) — вторая копия числа из CSS, которая расходилась с ним
// на первой же правке раскладки.
//
// ⚠️ ПУСТОЙ ГЛОБУС — ЕДИНСТВЕННОЕ ИСКЛЮЧЕНИЕ: диаметр шара Mapbox считает
// от размеров КАНВАСА, а не от свободной его части — то есть канвас во весь
// экран даёт шар МЕНЬШЕ свободного окна, и вокруг него видно дымку и космос.
// Замер по пикселям: канвас во весь экран телефона — 22.9 % дымки и все четыре
// угла вне планеты. Поэтому его зум считается от СВОБОДНОГО ОКНА: `startGlobeZoom`
// вычитает и отступ, и воздух из размеров холста (`lib/map/globeStart.js`).

function fitPaddingFor(w) {
  return w > PHONE_MAX_W ? { top: 48, right: 48, bottom: 48, left: 48 } : { top: 32, right: 40, bottom: 32, left: 40 };
}

// Нейтральный СТАРТОВЫЙ вид глобуса (до выбора маршрута; сюда же возвращает
// RESET черновика). Всё, что можно посчитать без DOM, — в `lib/map/globeStart.js`;
// там же разбор и там же тест: у правила «какого размера шар» нет ни скриншота в
// CI, ни гарда, и его уже дважды ломали. Здесь остаётся снять размеры холста.
function startGlobeView(map, insets) {
  const el = map?.getContainer?.();
  return {
    center: GLOBE_START_CENTER,
    zoom: startGlobeZoom({ W: el?.clientWidth || 0, H: el?.clientHeight || 0, insets }),
  };
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
  // Закрытая площадь — приезжает от `<MapShell>` ОДНОЙ величиной на обе оси:
  // канвас всегда во всю площадь (карта видна и под виджетом, и под шитом), а
  // кадр уходит в свободное окно. Разбор — в `mapShellInsets`.
  camera = null,
  // Подписка на закрытую площадь ВО ВРЕМЯ ЖЕСТА (кадр в кадр, мимо React) —
  // ею камера едет за пальцем, а не только на осадке детента.
  live = null,
  home, cities = [], finishCity, transport = {}, isStay = false,
  // `drawFinish` — draw the finish pin + leg (the finish/review steps). The finish
  // CITY still feeds the camera framing, so stepping between steps toggles what's
  // drawn WITHOUT re-framing.
  drawFinish = false,
  // Тема приложения приезжает ПРОПОМ (как у `MapView`) — один способ «следовать
  // теме» на обе карты. Родитель считает `isDark` и отдаёт 'LIGHT'|'DARK'; свой
  // `useTheme()` здесь больше не читаем.
  colorScheme = 'LIGHT',
  // Map-lens-style interactivity (all optional — omit for a passive preview):
  hoveredId = null, selectedId = null, cityBadge = null,
  onCityHover, onCityClick, onMapClick,
}) {
  const t = useT();
  const containerRef = useRef(null);
  const markersRef = useRef([]);

  // Контролы поверх карты: проекция + тема. Старт-финиша здесь НЕТ (решение
  // Pavel): в создании маршрута дом и финиш — это то, что пользователь прямо
  // сейчас выбирает, прятать их нечем и незачем; вместе с кнопкой ушла и ручка
  // `showSE` — мёртвая развилка была бы вторым правилом показа якорей.
  // Планировщик (оба флоу) открывается на глобусе (запрос Pavel, TRIP-337).
  const [projection, setProjection] = useState('globe');
  // Seed from the app theme prop and follow it live (mirrors MapView): the on-map
  // toggle can still override until the next app-theme change.
  const [scheme, setScheme] = useState(colorScheme);
  useEffect(() => { setScheme(colorScheme); }, [colorScheme]);

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

  // Свежесть колбэков (клик/ховер/клик по пустой карте) держат сами хуки
  // `useCityMarkers` / `useMapClick` — отдельных рефов здесь больше нет.

  // Unified with the trip MapView: home → start flag, finish → finish flag, transit
  // cities numbered 1..N, a 0-night stop → waypoint glyph (NOT a number, same as the
  // editor / Map lens). Each pin carries a stable id ('home' | city.id | 'finish')
  // so hover/click can address it and the tooltip can be looked up by the parent.
  // The finish pin is drawn whenever a finish node exists (кроме «останусь»); a
  // round-trip finish that coincides with the start is deduped by the по-координате
  // pin grouping — no start↔finish name compare. Drawing it requires `drawFinish`.
  // id === data здесь: колбэк планировщика хочет ровно этот ключ ('home' | id |
  // 'finish'), а `useCityMarkers` тегает им `data-mids` для тогла выделения.
  const hasFinish = !isStay && finishCity?.latitude != null;
  const pts = [];
  if (home?.latitude) pts.push({ id: 'home', lat: home.latitude, lng: home.longitude, label: null, kind: 'start', data: 'home' });
  let transitNo = 0;
  cities.forEach((c) => {
    if (c.latitude == null) return;
    const isWaypoint = (+c.nights || 0) === 0 && !!c.city_name;
    pts.push({ id: String(c.id), lat: c.latitude, lng: c.longitude, label: isWaypoint ? null : String(++transitNo), kind: isWaypoint ? 'waypoint' : 'transit', data: String(c.id) });
  });
  if (hasFinish && drawFinish) {
    pts.push({ id: 'finish', lat: finishCity.latitude, lng: finishCity.longitude, label: null, kind: 'end', data: 'finish' });
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
  if (home?.latitude) fitPositions.push([home.longitude, home.latitude]);
  cities.forEach((c) => { if (c.latitude != null) fitPositions.push([c.longitude, c.latitude]); });
  if (hasFinish) fitPositions.push([finishCity.longitude, finishCity.latitude]);
  // ★ ЗАКРЫТАЯ ПЛОЩАДЬ В `fitKey` НЕ ВХОДИТ, и теперь по более простой причине,
  // чем раньше: смена свободного окна камеру НЕ ДВИГАЕТ ВОВСЕ (★★ ниже). Детент —
  // не новая цель кадра, а та же самая, снятая в другое окно; положи её сюда, и
  // каждая осадка шита заново вписывала бы маршрут — ровно то, что этот PR снял.
  const fitKey = `${fitPositions.map((p) => p.join(',')).join('|')}@${winW}x${winH}`;
  const legsKey = legs.map((l) => `${l.from?.latitude},${l.from?.longitude}|${l.to?.latitude},${l.to?.longitude}|${transport[l.id]?.kind || ''}`).join('::');

  // Did the previous fit draw a route? Lets the empty branch tell a fresh mount /
  // resize (snap to the start globe) apart from a draft RESET (glide back out).
  const prevHadPointsRef = useRef(false);
  // The fitKey the camera was last framed for — so a marker rebuild that leaves the
  // route geometry unchanged (a step change) doesn't re-fit. Reset when the route
  // empties, so the next real route frames again.
  const fittedSigRef = useRef('');

  // ═════════════════════════════════════════════════════════════════════════
  // ЗАКРЫТАЯ ПЛОЩАДЬ — ТА ЖЕ ДВЕРЬ, ЧТО У `MapView` (TRIP-422)
  // Объявлена ДО эффекта маркеров намеренно: React зовёт эффекты в порядке
  // объявления, и первый же фит обязан считаться по уже известному отступу.
  // ═════════════════════════════════════════════════════════════════════════
  // ★ МАРШРУТ НА СМЕНУ СВОБОДНОГО ОКНА НЕ ПЕРЕКАДРИРУЕТСЯ (решение Pavel):
  // автофокус случается ТОЛЬКО при изменении маршрута (`fitKey` ниже). Прежде
  // осадка детента и сворачивание панели вписывали маршрут заново — со стороны
  // это «карта сама наводится», хотя ничего не менялось. Под РАЗМЕР окна карта
  // при этом подстраивается по-прежнему: отступ доводит сам хук, без зума.
  //
  // ★★ ПУСТОЙ ГЛОБУС — ИСКЛЮЧЕНИЕ, И ЭТО НЕ ПОБЛАЖКА. Здесь нет маршрута, и
  // кадрировать нечего: ДИАМЕТР ШАРА считается от высоты СВОБОДНОГО ОКНА
  // (`startGlobeZoom` вычитает отступ), поэтому смена отступа меняет не кадр, а
  // размер самого предмета. Оставь зум как есть — и шар, посчитанный для окна в
  // 700px, не поместится в окно 250px. Это ровно тот случай, ради которого у
  // `useMapInsets` осталась дверь: цель считается от окна, а не от точек.
  //
  // Ref'а под цель здесь НЕТ, и это не упущение: `useMapInsets` переприсваивает
  // `reframeRef.current` в теле КАЖДОГО рендера, то есть зовёт самое свежее
  // замыкание. Прежней конструкции ref был нужен, пока из эффекта читали цель
  // маршрута; теперь он фиксировал бы ровно то, что и так актуально.
  //
  // ★ ГЕЙТ — «ЕСТЬ КУДА ВПИСЫВАТЬ», А НЕ «ХОЛСТ ИЗМЕРЕН» (разбор — `useMapInsets`).
  // Объявлен ВЫШЕ `useMapInsets` намеренно: его ответ читает `onReframe` ниже.
  const canFrameNow = useCanFrame(mapRef, { ready: canFit, insets: camera });

  useMapInsets(mapRef, {
    ready,
    insets: camera,
    live,
    onReframe: (map, { instant = false } = {}) => {
      // Маршрут есть — подстройку под новое окно делает сам хук отступом, и это
      // НЕ перекадрирование: зум и границы маршрута он не трогает.
      if (!canFrameNow || fitPositions.length) return false;
      const view = startGlobeView(map, getMapInsets(map));
      const move = { ...view, padding: getMapInsets(map) };
      // Кадр жеста — мгновенно (шар растёт вместе с окном, за пальцем); осадка —
      // тем же темпом и кривой, что и шит.
      try {
        if (instant) map.jumpTo(move);
        else map.easeTo({ ...move, duration: SURFACE_SETTLE_MS, easing: surfaceEasing });
      } catch { /* ignore */ }
      return true; // отступ уехал вместе с видом — хуку добавлять нечего
    },
  });

  // Пины — общий шов `useCityMarkers` (сборка + тогл выделения). Планировщик
  // вынимает из группы ПЕРВЫЙ id ('home' | city.id | 'finish'). rebuildKey =
  // ptsKey (перестройка на смену набора точек, вкл. финиш-пин на шаге 3).
  useCityMarkers(mapRef, ready, {
    points: pts,
    markersRef,
    rebuildKey: ptsKey,
    onClick: onCityClick || null,
    onHover: onCityHover ? (entering, d) => onCityHover(entering ? d : null) : null,
    selectedId,
    hoveredId,
  });

  // City tooltip + клик по пустой карте — те же швы, что у `MapView`.
  useCityBadge(mapRef, ready, cityBadge);
  useMapClick(mapRef, ready, onMapClick);

  // Fit (камера) — маркеры теперь строит хук выше, здесь только кадрирование.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    // Fit only when there IS a free window — deferred otherwise; the effect re-runs
    // when it comes back. Markers draw on `ready` via the hook. (TRIP-202/484)
    if (canFrameNow) {
      // ВОЗДУХ кадра, и только он: закрытую площадь карта знает сама
      // (`lib/map/insets.js`), поэтому складывать её здесь не нужно и нельзя.
      const air = fitPaddingFor(winW);
      if (fitPositions.length) {
        // Route: re-frame ONLY when the route geometry / viewport actually changed
        // (fitKey) — a step change rebuilds pins above but leaves fitKey alone, so
        // the camera holds. Отступ вьюпорта тут всегда нулевой: место под панель
        // отдаёт САМ СЛОТ, а воздух кадра несёт `padding` самого фита.
        if (fitKey !== fittedSigRef.current) {
          fittedSigRef.current = fitKey;
          calmFit(map, fitPositions, { padding: air, maxZoom: 7, singleZoom: 8 });
          // Отмечаем на ИНСТАНСЕ, что камеру уже ставили по месту: следующий
          // экран с картой (редактор маршрута сразу после создания трипа) возьмёт
          // этот факт и доедет плавно вместо скачка. См. `lib/map/framed.js`.
          markFramed(map);
        }
        prevHadPointsRef.current = true;
      } else {
        // Empty globe = the neutral START view. Шар встаёт по центру СЛОТА и
        // сайзится от него (~85% высоты на десктопе), поэтому отступ вьюпорта не
        // нужен и здесь. Returning here from a route (draft RESET) glides back
        // out; a fresh mount / resize just snaps (the fade-in hides it).
        const view = { ...startGlobeView(map, getMapInsets(map)), padding: getMapInsets(map) };
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
    // fitKey → re-frame (route geometry + viewport size, so it also covers resize).
    // Пересборку пинов делает `useCityMarkers` по ptsKey — здесь его нет.
    // winW/winH читаются внутри (fitPaddingFor / startGlobeView) — перечислены для
    // честности exhaustive-deps, хотя fitKey их и так несёт.
  }, [ready, canFrameNow, fitKey, winW, winH]);

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
          controls={['projection', 'theme']}
          projection={projection}
          onToggleProjection={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
          scheme={scheme}
          onToggleScheme={() => setScheme((s) => (s === 'DARK' ? 'LIGHT' : 'DARK'))}
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
