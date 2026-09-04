// @ts-check
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Btn, Card, Skeleton } from '@/design/index';
import { Icon } from '@/design/icons';
import MapView from '@/components/views/MapView';
import TripStatRow from '@/components/trips/TripStatRow';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { computeTripRange, currentCityVisit, formatDateRange, tripPhase, tripProgress } from '@/lib/trip-dates';
import { naiveDayKey } from '@/lib/naive-time';
import { DateTime } from 'luxon';

// ГЕРОЙ ЭКРАНА ПОЕЗДКИ — карта во всю ширину, состояние одной панелью поверх неё.
//
// ★ ОДИН ГЕРОЙ, И ЭТО МАРШРУТ. Смелость экрана потрачена ровно здесь: карта
// занимает всю ширину и 440 px высоты, без шапки, без рамки, без соседей по
// строке. Всё остальное на экране — тихие типографические секции. Прежняя
// редакция склеивала в один ряд ТРИ разные плотности (фото · текст · карта)
// жёсткими швами: это не композиция, это три панели, свинченные вместе.
//
// ★ ОБЛОЖКИ ЗДЕСЬ НЕТ НАМЕРЕННО. У поездки без своего фото она подставляет
// стоковый фоллбек — картинку, не имеющую отношения к этому маршруту, — и
// занимает под неё треть героя. Случайная картинка хуже, чем её отсутствие.
// Обложка остаётся там, где опознаёт поездку среди других: на карточках главной.
//
// ★ ПОЛОСЫ ГОТОВНОСТИ ЗДЕСЬ НЕТ. Она про ПОДГОТОВКУ и живёт в её виджете, рядом
// со списком, который объясняет число. Стоя в панели над картой, она оказывалась
// в полэкрана от того, что считает.
//
// ★ ПАНЕЛЬ СОСТОЯНИЯ — КАНОН-ПОВЕРХНОСТЬ (`<Card raised>`), положенная поверх
// карты, а не сшитая с ней встык. Поэтому у неё свои углы, своя тень и свой
// фон: она читается как предмет НА карте, и никакого шва не возникает.
//
// ★ НАД КАРТОЙ ЛЕЖИТ РОВНО ОДИН ПРЕДМЕТ, И ОН НАВЕРХУ. Причин две, и обе
// вынужденные:
//   1. НИЗ КАДРА ПРИНАДЛЕЖИТ АТРИБУЦИИ. Логотип mapbox и копирайт стоят по
//      нижним углам холста, показывать их обязывает лицензия, и снять их
//      нельзя. Панель, прижатая к левому нижнему углу, ложилась ровно на
//      логотип — это не «мелкое пересечение», это нарушение условий карты.
//   2. Кнопка «Открыть» вторым плавающим предметом в правом верхнем углу
//      разводила один смысл («вот эта поездка, вот что с ней делать») по двум
//      разным местам кадра. Теперь она — действие ПАНЕЛИ, а кадр держит один
//      объект вместо двух.
//
// ★ ПАНЕЛЬ ОБЪЯВЛЯЕТ СЕБЯ ЗАКРЫТОЙ ПЛОЩАДЬЮ (`view`), а не просто лежит сверху.
// Иначе `fitToPoints` вписывает маршрут в ВЕСЬ кадр, и первые города честно
// уезжают под панель. Величина берётся ИЗМЕРЕНИЕМ живой панели, а не вторым
// экземпляром числа из CSS: у отступов панели есть контейнерный порог, и копия
// числа здесь разъехалась бы с ним молча. Механика закрытой площади — общая с
// `<MapShell>` (`lib/map/insets.js`), своей тут нет.

// «У узла есть координаты» — ОДИН предикат на оба вопроса кадра: рисовать ли
// карту вообще и в какой проекции. Двумя чтениями (`v.latitude` на истинность и
// `v.latitude != null` на наличие) они расходились ровно на нулевой широте.
const hasCoords = (v) => v?.latitude != null && v?.longitude != null;

/** @param {{ trip?: any, visits?: any[], transfers?: any[],
 *            active?: boolean, isLoading?: boolean, onOpenMap?: any }} p */
export default function TripFrame({
  trip, visits = [], transfers = [], active = true, isLoading = false, onOpenMap,
}) {
  const { t } = useI18n();
  const { fmtDate, plural } = useI18nFormat();
  const { isDark } = useTheme();

  const [hoveredId, setHoveredId] = useState(/** @type {any} */ (null));
  const [selectedId, setSelectedId] = useState(/** @type {any} */ (null));
  const badgeId = hoveredId ?? selectedId;
  const cityBadge = useMemo(() => {
    if (badgeId == null) return null;
    const v = (visits || []).find((x) => String(x.id) === String(badgeId));
    if (!v || v.latitude == null || v.longitude == null) return null;
    return {
      lng: v.longitude, lat: v.latitude, countryCode: v.country_code, name: v.city_name,
      dates: formatDateRange(v.start_date, v.end_date, (iso) => fmtDate(iso)),
    };
  }, [badgeId, visits, fmtDate]);

  const when = useMemo(() => {
    const startKey = naiveDayKey(computeTripRange(visits).start);
    return {
      phase: tripPhase(visits),
      progress: tripProgress(visits),
      nowCity: currentCityVisit(visits),
      startKey,
      // Дней до старта — по КАЛЕНДАРНЫМ дням: «через 1 день» обязано смениться
      // на «стартует сегодня» в полночь, а не через 24 часа.
      daysToStart: startKey
        ? Math.round(DateTime.fromISO(startKey).diff(DateTime.now().startOf('day'), 'days').days)
        : null,
    };
  }, [visits]);

  // Закрытая панелью площадь кадра. Панель либо стоит колонкой слева (широкий
  // кадр), либо растянута полосой по верху (узкий) — какой из двух случаев
  // сейчас, решает ЗАМЕР, а не копия порога: панель шире двух третей кадра =
  // полоса, значит закрыт ВЕРХ; иначе закрыт ЛЕВЫЙ край.
  const frameRef = useRef(/** @type {any} */ (null));
  const mapRef = useRef(/** @type {any} */ (null));
  const panelRef = useRef(/** @type {any} */ (null));
  const [closed, setClosed] = useState(/** @type {any} */ (null));
  const measure = useCallback(() => {
    const f = mapRef.current; const p = panelRef.current;
    if (!f || !p) return;
    const fr = f.getBoundingClientRect(); const pr = p.getBoundingClientRect();
    if (!fr.width || !pr.width) return;
    // ★ ЗАКРЫТО ТОЛЬКО ТО, ЧТО ПАНЕЛЬ РЕАЛЬНО ПЕРЕКРЫВАЕТ. Мерим против КАРТЫ, а
    // не против кадра: на телефоне панель стоит под картой в потоке, пересечения
    // нет — и закрытой площади нет тоже. Считать её от кадра значило бы объявить
    // карте, что у неё отрезан весь низ, и загнать маршрут в верхнюю треть.
    if (pr.bottom <= fr.top + 1 || pr.top >= fr.bottom - 1) {
      setClosed((cur) => (cur === null ? cur : null));
      return;
    }
    const box = pr.width > fr.width * 0.66
      ? { top: Math.round(pr.bottom - fr.top) }
      : { left: Math.round(pr.right - fr.left) };
    // Сравнение держится на том, что ОТСУТСТВУЮЩАЯ сторона — `undefined` с обеих
    // сторон (`undefined === undefined`). Заведёшь третью сторону (`right`/
    // `bottom`) — сравнение молча перестанет её покрывать: правь и здесь.
    setClosed((cur) => (cur && cur.top === box.top && cur.left === box.left ? cur : box));
  }, []);
  // ★★ `isLoading` В ДЕПАХ — НЕ ПЕРЕСТРАХОВКА, БЕЗ НЕГО ЗАМЕР НЕ СЛУЧАЕТСЯ ВООБЩЕ.
  // `measure` стабилен (`useCallback([])`), поэтому эффект с депами `[measure]`
  // отрабатывал РОВНО ОДИН РАЗ — на монтировании. А монтируется кадр в фазе
  // загрузки содержимого: скелетон рисует свой `.tframe` БЕЗ ссылок, значит оба
  // рефа пусты, `measure()` выходит по первому гарду, `observe` не зовётся ни
  // разу — и эффект больше не переигрывается. Закрытая площадь оставалась
  // `null` навсегда, то есть на ПЕРВОМ открытии трипа маршрут вписывался во
  // весь кадр и первые города уезжали под панель — ровно то, что этот блок и
  // должен был починить. Работало только при возврате на обзор с другой линзы
  // (там кадр монтируется уже с данными). Ни один гард такого не видит.
  useEffect(() => {
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    if (mapRef.current) ro.observe(mapRef.current);
    if (panelRef.current) ro.observe(panelRef.current);
    return () => ro.disconnect();
  }, [measure, isLoading]);
  const view = useMemo(() => (closed ? { camera: closed, fit: closed } : null), [closed]);

  // Проекция — от РАЗМАХА МАРШРУТА, а не от экрана. Плоская меркаторская карта
  // на трёх городах по Италии читается лучше глобуса; она же на маршруте
  // Италия→Россия→Япония превращается в карту мира с булавками по три пикселя
  // и половиной кадра под океаном. Порог — по градусам охвата; линзы карты и
  // редактора открываются на глобусе всегда (TRIP-337), обзор — только когда
  // маршруту действительно тесно на плоскости.
  const projection = useMemo(() => {
    const pts = (visits || []).filter(hasCoords);
    if (pts.length < 2) return 'mercator';
    const lngs = pts.map((v) => Number(v.longitude));
    const lats = pts.map((v) => Number(v.latitude));
    const dLng = Math.max(...lngs) - Math.min(...lngs);
    const dLat = Math.max(...lats) - Math.min(...lats);
    return dLng > 60 || dLat > 40 ? 'globe' : 'mercator';
  }, [visits]);

  if (isLoading) return <TripFrameSkeleton />;

  const hasRoute = (visits || []).some(hasCoords);
  const { phase, progress, nowCity, startKey, daysToStart } = when;
  let headline = t('overview.state_undated');
  let sub = '';
  if (phase === 'ongoing' && progress) {
    headline = t('overview.state_ongoing', { day: progress.day, total: progress.total });
    sub = nowCity ? t('overview.state_now_city', { city: nowCity.city_name }) : '';
  } else if (phase === 'upcoming') {
    headline = daysToStart != null && daysToStart <= 0
      ? t('overview.state_today')
      : plural(daysToStart ?? 0, 'overview.state_upcoming', { count: daysToStart });
    sub = startKey ? fmtDate(startKey) : '';
  } else if (phase === 'past') {
    headline = t('overview.state_past');
    sub = startKey ? fmtDate(startKey) : '';
  }

  return (
    <>
      <div className="tframe" ref={frameRef}>
        <div className="tframe__map" ref={mapRef}>
          {hasRoute ? (
            <MapView
              visits={visits}
              transfers={transfers}
              view={view}
              initialProjection={projection}
              colorScheme={isDark ? 'DARK' : 'LIGHT'}
              active={active}
              hoveredVisitId={hoveredId}
              selectedVisitId={selectedId}
              cityBadge={cityBadge}
              onCityHover={(pts) => setHoveredId(pts ? (pts[0]?.id ?? null) : null)}
              onCityClick={(pts) => { const v = pts?.[0]; if (v) setSelectedId((cur) => (cur === v.id ? null : v.id)); }}
              onMapClick={() => setSelectedId(null)}
            />
          ) : (
            <div className="tframe__mapempty muted">
              <Icon name="map" size={22} />
              <span>{t('overview.map_empty')}</span>
            </div>
          )}
        </div>

        <div className="tframe__state" ref={panelRef}>
          <Card radius="lg" raised className="col col--g3">
            <div className="t-title">{headline}</div>
            {sub && <div className="t-support muted">{sub}</div>}
            <Btn variant="secondary" block iconRight="chev" onClick={onOpenMap}>
              {t('overview.open')}
            </Btn>
          </Card>
        </div>
      </div>

      <TripStatRow visits={visits} transfers={transfers} trip={trip} />
    </>
  );
}

export function TripFrameSkeleton() {
  return (
    <>
      {/* Кадр + панель состояния на своём месте: без неё скелетон обещает пустой
          прямоугольник, а приезжает карта с карточкой в левом верхнем углу. */}
      <div className="tframe">
        <div className="tframe__map"><Skeleton w="100%" h="100%" r={0} /></div>
        <div className="tframe__state"><Skeleton w="100%" h={132} r="var(--r-lg)" /></div>
      </div>
      {/* Полоса чисел — отдельный блок под кадром, ровно её высота. */}
      <Skeleton w="100%" h={84} r="var(--r-xl)" />
    </>
  );
}
