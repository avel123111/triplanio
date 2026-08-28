// @ts-check
import { useCallback, useEffect, useRef, useState } from 'react';
import { NO_INSETS, canFrame, getMapInsets, setMapInsets, toBox } from './insets';
import { SURFACE_SETTLE_MS, surfaceEasing } from '@/lib/surfaceMotion';

/**
 * Отступ как СТРОКА-КЛЮЧ зависимостей: свободное окно целиком выражено им, обе
 * оси одной величиной (панель приезжает в `left`, шит — в `bottom`). Объявление
 * одно на оба хука — разъехавшись, они реагировали бы на разные события.
 * @param {any} insets
 */
function insetsKey(insets) {
  const b = toBox(insets);
  return `${b.top}|${b.right}|${b.bottom}|${b.left}`;
}

/**
 * Механика закрытой площади для экрана с картой (TRIP-422).
 *
 * ★ Три правила обращения, и на каждом легко ошибиться:
 *   1. объявить отступ ДО первого кадрирования;
 *   2. на ПЕРВОМ применении поставить его без анимации (базовая точка отсчёта);
 *   3. снимать отступ РОВНО на размонтировании.
 *
 * Правило 3 — самое коварное: сложи уборку с применением в один эффект, и React
 * позовёт её перед каждым перезапуском, то есть на каждой смене отступа —
 * отступ рывком уйдёт в ноль.
 *
 * ★★ КАРТА ПОД НОВОЕ ОКНО ПОДСТРАИВАЕТСЯ, НО МАРШРУТ НЕ ПЕРЕКАДРИРУЕТ. Это две
 * РАЗНЫЕ вещи, и их легко склеить в одну — так тут и было:
 *   ПОДСТРОЙКА  — отступ доезжает до нового свободного окна: вид переезжает
 *                 вместе с панелью или шитом, ЗУМ И ГРАНИЦЫ НЕ ТРОГАЮТСЯ.
 *                 Без неё свёрнутая панель открывает пустую площадь, а карта
 *                 остаётся прижатой туда, где панель стояла.
 *   АВТОФОКУС   — вписать МАРШРУТ в окно заново, то есть пересчитать зум и центр
 *                 по его границам. Ему место ровно одно — изменение маршрута.
 * Прежде смена окна делала ВТОРОЕ (`reframeTo` вписывал маршрут), и со стороны
 * это читалось как «карта сама наводится», хотя маршрут не менялся. Теперь
 * эффект объявляет закрытую площадь и доводит до неё ОТСТУП — не более.
 *
 * `onReframe` — необязательная дверь для цели, РАЗМЕР которой считается от
 * СВОБОДНОГО ОКНА, а не от маршрута (пустой глобус планировщика: диаметр шара —
 * доля высоты окна, и при смене отступа он обязан пересчитаться, иначе шар не
 * попадает в окно). Вернула `true` — доехала сама, отступ трогать не нужно.
 * Кадрировать в ней МАРШРУТ нельзя: это и был бы тот самый автофокус.
 *
 * @param {{ current: any }} mapRef ссылка на инстанс (общий синглтон)
 * `focusing` — камерой СЕЙЧАС правит focus (открыта панель, идёт/предстоит её
 * flyTo). Тогда отступ применяем СИНХРОННО и мгновенно, а не отложенным на 2
 * кадра `easeTo`: иначе тот easeTo прилетает ПОСЛЕ старта focus-flyTo и обрывает
 * его — зум «начинается и через долю секунды заканчивается». Синхронное
 * применение идёт в этом же эффекте (он объявлен ВЫШЕ focus-эффекта), поэтому
 * focus стартует уже с новым отступом (`calmFlyTo` читает его) и не прерывается.
 *
 * @param {{
 *   ready: boolean,
 *   insets: any,
 *   live?: { subscribe: (fn: (px: number, phase: string) => void) => (() => void) } | null,
 *   focusing?: boolean,
 *   onReframe?: (map: any, opts?: { instant?: boolean }) => boolean | void,
 * }} p
 */
export function useMapInsets(mapRef, { ready, insets, live = null, focusing = false, onReframe = null }) {
  // ★ КЛЮЧ — ОТСТУП, И ЭТОГО ДОСТАТОЧНО: он и есть всё свободное окно. Прежде
  // высота ехала отдельным каналом (размером слота), и ключ обязан был знать оба.
  const key = insetsKey(insets);
  const seenRef = useRef(false);
  // ★ СОБСТВЕННАЯ ССЫЛКА НА ИНСТАНС, И ЭТО НЕ ДУБЛЬ. `useMapSurface` обнуляет
  // свой `mapRef` в СВОЁМ cleanup, а объявлен он раньше — React зовёт cleanup'ы
  // в порядке объявления, поэтому к нашей уборке `mapRef.current` уже `null`.
  // Опереться на него значит НЕ СНЯТЬ отступ вовсе: карта общая, и следующий
  // экран получил бы её с отрезанной полосой — без единой ошибки в консоли.
  const liveRef = useRef(/** @type {any} */ (null));
  // Свежий колбэк для эффекта, который зависит только от отступа: перекадрирование
  // обязано брать АКТУАЛЬНУЮ цель, но само по смене цели не запускаться.
  const reframeRef = useRef(onReframe);
  reframeRef.current = onReframe;
  // Держим камеру за focus-эффектом не только ПОКА панель открыта, но и на кадре
  // её ЗАКРЫТИЯ: focus тогда уходит на полный маршрут (тоже зум), и наш свой
  // easeTo оборвал бы его. Смена отступа на закрытии совпадает с
  // `focusing: true → false`, поэтому «был ли focus в прошлый раз» это закрывает.
  // ★ Тот же фронт «focus гаснет» отдельно ловит `hadFocusRef` в MapView (там он
  // ЗАПУСКАЕТ обратный `calmFit`); две реакции на одно событие в двух эффектах,
  // связывать их — только жёстче сцепить. Здесь — «отступ не трогаем сам».
  const wasFocusing = useRef(false);
  // Свежий отступ для живого канала: он меняет ОДНУ сторону (низ), остальные
  // обязан взять актуальные, а сам по их смене не перезапускаться.
  const insetsRef = useRef(insets);
  insetsRef.current = insets;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    liveRef.current = map;
    setMapInsets(map, insets);
    if (!seenRef.current) {
      seenRef.current = true;
      try { map.easeTo({ padding: getMapInsets(map), duration: 0 }); } catch { /* ignore */ }
      return undefined;
    }
    // ★ Панель правит камерой (focus) или ТОЛЬКО ЧТО правила (её закрытие уводит
    // focus на полный маршрут): отступ УЖЕ сохранён (`setMapInsets` выше), а саму
    // камеру мы НЕ трогаем ВООБЩЕ. Её ведёт focus-эффект (`calmFlyTo`/`calmFit`
    // ниже по дереву, эффект объявлен ПОЗЖЕ нашего), и он передаёт наш отступ в
    // ту же команду (`padding: getMapInsets(map)`) — центр, зум И отступ едут
    // ОДНОЙ плавной анимацией. Любой свой `easeTo` тут — вторая команда на ту же
    // камеру: она и рвала зум (мгновенная — рывок на открытии, обрыв на закрытии).
    const focusDriven = focusing || wasFocusing.current;
    wasFocusing.current = focusing;
    if (focusDriven) return undefined;
    const el = map.getContainer?.();
    // ★ ЕДЕМ В ТОТ ЖЕ КАДР, ЧТО И ПОВЕРХНОСТЬ. Ждать `requestAnimationFrame` и
    // звать `resize()` было нужно, пока высоту забирал СЛОТ: mapbox узнавал о
    // новом размере холста от ResizeObserver, то есть позже нашего рендера, и
    // посчитать раньше значило посчитать по старому. Холст больше не меняется —
    // ждать нечего, а задержка в два кадра сдвигала старт камеры относительно
    // старта шита, то есть ровно та рассинхронизация, ради которой заведён
    // единый темп.
    if (!canFrame(el?.clientWidth || 0, el?.clientHeight || 0, getMapInsets(map))) return undefined;
    // Цель, размер которой считается от свободного окна, обслуживает себя сама.
    if (reframeRef.current?.(map)) return undefined;
    // Иначе доезжает ТОЛЬКО отступ — тем же временем и той же кривой, что и
    // поверхность, которая поехала (шит встаёт на детент за `SURFACE_SETTLE_MS`,
    // панель уезжает за него же). Ни `center`, ни `zoom` тут не передаются, и
    // это ГЛАВНОЕ: mapbox сам сдвигает вид в новое свободное окно, а границы
    // маршрута в расчёт не входят — подстройка есть, автофокуса нет.
    try { map.easeTo({ padding: getMapInsets(map), duration: SURFACE_SETTLE_MS, easing: surfaceEasing }); } catch { /* ignore */ }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, focusing]);

  // ★ КАМЕРА ЗА ПАЛЬЦЕМ — ОТДЕЛЬНЫЙ КАНАЛ, МИМО REACT. Пока шит едет, свободное
  // окно меняется каждый кадр; состояние на кадр жеста стоило бы перекладки всей
  // панели, поэтому шелл отдаёт живую величину подпиской, а мы двигаем ОТСТУП
  // немедленно. `setPadding` здесь — не ошибка, а ровно то, чем он и является:
  // мгновенная установка. Рывком он был бы ВМЕСТО анимации; здесь он и есть
  // слежение 1:1, кадр в кадр, как на десктопе за краем окна.
  //
  // Ни `center`, ни `zoom` не трогаем — это по-прежнему подстройка, а не
  // автофокус. Исключение то же, что и у осадки: цель, размер которой считается
  // от свободного окна (пустой глобус), обязана пересчитаться, иначе шар
  // «прыгнет» в конце жеста вместо того, чтобы расти вместе с окном.
  useEffect(() => {
    if (!live?.subscribe || !ready) return undefined;
    return live.subscribe((bottom, phase) => {
      const map = mapRef.current;
      if (!map) return;
      const box = { ...toBox(insetsRef.current), bottom: Math.max(0, Math.round(bottom)) };
      setMapInsets(map, box);
      const el = map.getContainer?.();
      if (!canFrame(el?.clientWidth || 0, el?.clientHeight || 0, box)) return;
      const instant = phase !== 'end';
      if (reframeRef.current?.(map, { instant })) return;
      try {
        if (instant) map.setPadding(box);
        else map.easeTo({ padding: box, duration: SURFACE_SETTLE_MS, easing: surfaceEasing });
      } catch { /* ignore */ }
    });
  }, [live, ready, mapRef]);

  // Уборка — ОТДЕЛЬНЫМ эффектом с пустыми зависимостями (правило 3 выше).
  // Инстанс карты общий и живёт дольше экрана: не снять отступ значит отрезать
  // полосу у следующего.
  useEffect(() => () => {
    const map = liveRef.current;
    if (!map) return;
    setMapInsets(map, null);
    try { map.easeTo({ padding: NO_INSETS, duration: 0 }); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * ЕСТЬ ЛИ КУДА КАДРИРОВАТЬ — реактивный ответ того же закона (`canFrame`).
 *
 * ★ ЗАЧЕМ ОТДЕЛЬНО ОТ `canFit`. `canFit` (`useMapSurface`) отвечает на вопрос
 * «холст измерен», и до этой задачи разницы не было: на телефоне свободное окно
 * И БЫЛО холстом, поэтому «холст ненулевой» означало «есть куда вписывать».
 * Теперь холст всегда во всю площадь, а свободное окно режет ОТСТУП — и на
 * верхнем детенте (шит во весь экран) `canFit` по-прежнему `true`, хотя
 * вписывать некуда. Фит, посчитанный в этот момент, уходит в предельный зум и
 * ТАМ ОСТАЁТСЯ: он помечает себя сделанным и не повторяется.
 *
 * ★★ ОТВЕТ ОБЯЗАН БЫТЬ ЗАВИСИМОСТЬЮ ЭФФЕКТА, А НЕ ПРОВЕРКОЙ ВНУТРИ НЕГО. Тогда
 * заблокированный фит не теряется, а откладывается: окно вернулось — эффект
 * перезапустился и вписал. Проверка внутри дала бы «фит пропущен навсегда».
 *
 * ★★★ ОТСТУП БЕРЁТСЯ ИЗ АРГУМЕНТА, А НЕ С ИНСТАНСА (`getMapInsets`). На инстанс
 * его кладёт эффект `useMapInsets` — то есть ПОРЯДКОМ ОБЪЯВЛЕНИЯ хуков решалось
 * бы, свежий отступ мы читаем или прошлый: в `FlowMap` этот хук стоит РАНЬШЕ
 * (его значение читает `onReframe`), и на инстансе в тот момент лежит ещё старая
 * величина. Аргумент — та же величина без этой зависимости.
 *
 * @param {{ current: any }} mapRef
 * @param {{ ready: boolean, insets: any }} p `ready` — холст измерен (`canFit`).
 * @returns {boolean}
 */
export function useCanFrame(mapRef, { ready, insets }) {
  const key = insetsKey(insets);
  const [ok, setOk] = useState(false);
  const measure = useCallback(() => {
    const el = mapRef.current?.getContainer?.();
    setOk(!!(ready && canFrame(el?.clientWidth || 0, el?.clientHeight || 0, toBox(insets))));
    // `insets` читается ПО ЗНАЧЕНИЮ (ключ выше), а не по ссылке: объект приезжает
    // новым на каждый рендер, и по ссылке пересчёт шёл бы вхолостую всегда.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRef, ready, key]);
  useEffect(() => {
    measure();
    // Вьюпорт — вторая величина в ответе (первая — отступ): поворот экрана и
    // схлопывание адресной строки меняют его, отступ при этом не двигая.
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);
  return ok;
}

export default useMapInsets;
