// @ts-check
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { invokeFn } from '@/lib/invokeFn';
import { errorText } from '@/lib/errorText';
import { toast } from '@/components/ui/use-toast';
// Файл напрямую, НЕ через `@/design/index`: тот импортирует `useT` отсюда,
// и обращение через индекс замкнуло бы цикл. Разбор — в шапке AppLoading.jsx.
import AppLoading from '@/design/AppLoading';
import { hasLang, loadLocale, loadedLocale, zoneLoaded } from './dictionary';
import { ZONE_NAMESPACES } from './zoneNamespaces';
import {
  LANGUAGES, FALLBACK_LANG, visitorLang, initialLang, rememberLang,
  publishLang, clearLangParam, localeTag,
} from './translations';
import { localeOf, splitLangPath } from '@/lib/routePaths';
import { tolgee, ensureTolgeeRunning, addLocaleToTolgee, IN_CONTEXT } from './tolgee';
import {
  applyLuxonLocale,
  formatDayMonth,
  localizeCountry,
  localizeCurrencyName,
  formatMoney,
  formatNumber,
  formatRelativeTime,
  pluralize,
} from './format';

const I18nContext = createContext({
  lang: 'en',
  /** @type {(next: string) => void} */
  setLang: () => {},
  /** @type {(pathname: string) => void} */
  applyRoute: () => {},
  /** @type {'en'|'es'|'ru'|null} */
  routeLocale: null,
  units: 'metric',
  // ⚠️ Тот же случай, что у `t` ниже, и он ПОВТОРИЛСЯ в этом же объекте: голая
  // заглушка объявляла функцию без параметров, а живой `setUnits('metric')`
  // давал TS2554. Аннотируется КАЖДАЯ функция дефолта, а не только та, из-за
  // которой пришли: соседние молчат ровно до первого вызывателя под прагмой.
  /** @type {(next: string) => void} */
  setUnits: () => {},
  // ⚠️ ТИП `t` БЕРЁТСЯ ОТСЮДА, А НЕ С РЕАЛИЗАЦИИ. `createContext` выводит форму
  // из ЗНАЧЕНИЯ ПО УМОЛЧАНИЮ, поэтому голая заглушка `(key) => key` объявляла
  // функцию ОДНОГО аргумента, и живой вызов с подстановкой
  // (`t('doc.upload_formats', { mb })`, реализация ниже принимает `vars`)
  // давал TS2554 «Expected 0-1 arguments, but got 2» на каждом экране под
  // `// @ts-check`. Заглушка и реализация разъехались молча — annotation
  // приводит заглушку к реальной сигнатуре.
  /** @type {(key: string, vars?: Record<string, any>) => string} */
  t: (key) => key,
  // ⚠️ Третий случай той же болезни, и он не про сигнатуру, а про ОТСУТСТВИЕ:
  // провайдер отдаёт `locale` и `languages` (см. `value` ниже), а в дефолте их
  // не было — значит их не было и в ТИПЕ. Живой `const { locale } = useI18n()`
  // краснел как «свойства не существует», хотя в рантайме оно есть всегда.
  // Дефолт обязан перечислять ВСЁ, что отдаёт провайдер, иначе он описывает не
  // тот объект, который приходит потребителю.
  locale: localeTag('en'),
  languages: LANGUAGES,
  // Загружены ли ВСЕ словари активного языка. Первый кадр зоны его не ждёт
  // (ей хватает шести), а экраны приложения ждут — гейт в `App.jsx`.
  dictFull: false,
});

// Active locale falls back to this one (then to the raw key) for missing strings,
// so it is always loaded alongside whatever language is active. 'en' matches the
// Tolgee project's base language, so a missing key resolves the same way here and
// in Tolgee (and never shows Russian to an en/es user).
// FALLBACK_LANG живёт в `translations.js` — там же, где список языков.

// Resolve a dotted address `namespace.bareKey` against a nested locale dict
// ({ namespace: { bareKey: value } }). Split on the FIRST dot only: the namespace
// is the file stem (dot-free), while a bare key may itself contain dots
// (e.g. 'notif.all_read' → ns 'notif', key 'all_read'). Every real address is
// dotted; a dotless/leading-dot key has no namespace and no value here, so we
// return undefined (→ fallback → raw key) rather than the namespace object.
function lookup(nsDict, key) {
  if (!nsDict) return undefined;
  const dot = key.indexOf('.');
  if (dot <= 0) return undefined;
  const rec = nsDict[key.slice(0, dot)];
  return rec ? rec[key.slice(dot + 1)] : undefined;
}

const UNITS_STORAGE_KEY = 'travel-planner-units';
const UNIT_SYSTEMS = ['metric', 'imperial'];

// Distance unit system. Authoritative source = users.unit_system once signed in,
// else localStorage, else 'metric'. Anonymous public-trip viewers fall back to
// their own localStorage / default — never the trip owner's setting.
function detectInitialUnits(user) {
  if (user?.unit_system && UNIT_SYSTEMS.includes(user.unit_system)) return user.unit_system;
  try {
    const stored = localStorage.getItem(UNITS_STORAGE_KEY);
    if (stored && UNIT_SYSTEMS.includes(stored)) return stored;
  } catch (e) { /* ignore */ }
  return 'metric';
}

export function I18nProvider({ children }) {
  const { user } = useAuth();

  // ★★ ЯЗЫК СКЛАДЫВАЕТСЯ ИЗ ТРЁХ СЛОЁВ, А НЕ ПЕРЕУТВЕРЖДАЕТСЯ ЭФФЕКТАМИ
  // (TRIP-520). Разбор слоёв — в шапке `visitorLang` (translations.js):
  //
  //     цель = локаль маршрута ?? язык профиля ?? язык посетителя
  //
  // Это ВЫЧИСЛЕНИЕ, а не последовательность записей, и именно поэтому у языка
  // больше нет утечек. Прежняя редакция вместо этого держала одно состояние и
  // переписывала его отовсюду — с адреса при монтировании, с адреса на каждой
  // навигации в зоне, с профиля при приезде сессии. Побеждал тот, кто написал
  // последним, а «вернуть как было» не умел никто: вошедший с русским профилем
  // открывал английский лендинг и уходил в приложение НАВСЕГДА английским.
  // Со слоями возврат происходит сам: ушёл с адреса, у которого есть локаль, —
  // слой перестал действовать, и ответ снова даёт профиль.
  const [routeLocale, setRouteLocale] = useState(() => localeOf(
    typeof window !== 'undefined' ? window.location.pathname : '/',
  ));
  const [visitor, setVisitor] = useState(() => visitorLang());
  const profileLang = user?.language && hasLang(user.language) ? user.language : null;
  const target = routeLocale ?? profileLang ?? visitor;

  // `lang` — язык, КОТОРЫЙ УЖЕ МОЖНО РИСОВАТЬ: он догоняет `target` только после
  // того, как приехал словарь. Без этого разрыва смена языка показывала бы кадр
  // из сырых ключей.
  const [lang, setLangState] = useState(() => initialLang());
  const [units, setUnitsState] = useState(() => detectInitialUnits(null));

  // Our baked dictionaries are the authoritative reader for NORMAL users:
  // { [lang]: { [namespace]: { [bareKey]: value } } }, kept in a ref so t() reads
  // the latest without being re-created. `ready` tracks WHICH locales are loaded
  // (to gate the first paint) and the active language. `loadingRef` holds the
  // in-flight load promise per locale so each is fetched at most once.
  // ★ НАЧАЛЬНАЯ ГОТОВНОСТЬ ЧИТАЕТСЯ ИЗ КЭША, А НЕ ЖДЁТ ЭФФЕКТА (TRIP-520). На
  // испечённой странице словарь зоны прогрет ещё до монтирования (`main.jsx`),
  // и без этой строки первый кадр всё равно был бы ожиданием: готовый текст
  // сменялся спиннером на 156 мс и возвращался.
  const [ready, setReady] = useState(() => {
    const initial = initialLang();
    const needed = initial === FALLBACK_LANG ? [initial] : [initial, FALLBACK_LANG];
    return new Set(needed.every(zoneLoaded) ? [initial] : []);
  });
  // Языки, у которых загружены ВСЕ словари. `ready` — «можно рисовать зону»,
  // `full` — «можно рисовать приложение»; это два разных вопроса.
  const [full, setFull] = useState(() => new Set());
  // Тот же кэш — источник самого словаря: иначе `ready` сказал бы «готово», а
  // читать было бы нечего, и первый кадр вышел бы из сырых ключей.
  const dictsRef = useRef(Object.fromEntries(
    LANGUAGES.map(({ code }) => [code, loadedLocale(code)]).filter(([, dict]) => dict),
  ));
  const loadingRef = useRef({});

  // Load a language (and the fallback) exactly once into our dictionary. Only in
  // an in-context editing session do we ALSO mirror it into Tolgee (so the observer
  // can wrap these strings) — normal users never put anything in Tolgee.
  // Одна фаза загрузки одного языка. `only` — подмножество словарей: с ним
  // грузится зонный набор (шесть из 48), без него — всё остальное. Результат
  // МЕРДЖИТСЯ в тот же словарь, поэтому вторая фаза дополняет первую, а не
  // заменяет её. Ключ кэша учитывает фазу: иначе фоновая догрузка вернула бы
  // промис первой и «полный словарь» никогда бы не наступил.
  const loadPhase = useCallback((l, only) => {
    const key = only ? `${l}:zone` : `${l}:full`;
    if (!loadingRef.current[key]) {
      loadingRef.current[key] = loadLocale(l, only).then((d) => {
        dictsRef.current[l] = { ...dictsRef.current[l], ...d };
        // Зеркалим в Tolgee только на ПОЛНОЙ фазе: сессия in-context — режим
        // разработки, и половинчатый словарь там был бы хуже, чем поздний.
        if (!only && IN_CONTEXT) addLocaleToTolgee(l, dictsRef.current[l]); // BEFORE ensureTolgeeRunning()
        return dictsRef.current[l];
      });
    }
    return loadingRef.current[key];
  }, []);

  const langsFor = (target) => (target === FALLBACK_LANG ? [FALLBACK_LANG] : [target, FALLBACK_LANG]);

  const ensureLoaded = useCallback(
    (target, only) => Promise.all(langsFor(target).map((l) => loadPhase(l, only))),
    [loadPhase],
  );

  // Make a language usable, then expose it. Tolgee is started either way so the
  // browser extension can detect the page and offer in-context editing. In an
  // editing session we also switch Tolgee to the active language BEFORE exposing it
  // (so tolgee.t() resolves the right language with no wrong-language frame); normal
  // users never call tolgee.t(), so no language switch is needed for them.
  const activate = useCallback(async (target, { fast = false } = {}) => {
    // `fast` — только первое монтирование: ждём шесть словарей зоны, остальные
    // догружаем фоном. Переключение языка руками идёт ПОЛНЫМ путём: оно бывает
    // и на экране приложения, где половина словаря — это сырые ключи на экране.
    await ensureLoaded(target, fast ? ZONE_NAMESPACES : undefined);
    ensureTolgeeRunning();
    if (IN_CONTEXT) await tolgee.changeLanguage(target);
    setReady((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
    const rest = fast ? ensureLoaded(target) : Promise.resolve();
    await rest.then(() => setFull((prev) => (prev.has(target) ? prev : new Set(prev).add(target))));
  }, [ensureLoaded]);

  // ★ ЦЕЛЬ МЕНЯЕТСЯ — ГРУЗИМ СЛОВАРЬ И ТОЛЬКО ПОТОМ ПОКАЗЫВАЕМ.
  //
  // Единственное место, где `lang` вообще меняется. Пока новый словарь едет, на
  // экране остаётся прежний язык — смена языка не показывает кадра из сырых
  // ключей. `fast` только на первом заходе: там ждём шесть словарей зоны, а
  // остальные догружаем фоном; последующие смены идут полным путём, потому что
  // случаются и на экранах приложения.
  //
  // `?lang=` стирается из адреса здесь же, где язык применён (TRIP-511): иначе
  // ручное переключение + перезагрузка молча откатывались бы к языку из адреса.
  const firstRun = useRef(true);
  useEffect(() => {
    let alive = true;
    const fast = firstRun.current;
    firstRun.current = false;
    activate(target, { fast }).then(() => { if (alive) setLangState(target); });
    if (fast) clearLangParam();
    return () => { alive = false; };
  }, [target, activate]);

  // ★ ЧТО СКАЗАЛ МАРШРУТ — ЕДИНСТВЕННАЯ ДВЕРЬ ДЛЯ ВЕРХНЕГО СЛОЯ.
  //
  // Зовёт её один вызыватель — `useRouteLocale` ниже, из корня роутера. Провайдер
  // стоит ВЫШЕ роутера (он нужен и до него), поэтому сам маршрут прочитать не
  // может: факт приезжает сюда, а не вычитывается отсюда.
  //
  // Языковой ПРЕФИКС здесь ещё и запоминается на устройстве — как выбор
  // человека: `/ru` это такое же прямое утверждение о языке, как клик по
  // переключателю, и оно обязано доехать до входа, у которого языкового адреса
  // нет. Беспрефиксный `/` не запоминается: он английский по построению файла, а
  // не по выбору, и записью стёр бы настоящий выбор посетителя.
  const applyRoute = useCallback((pathname) => {
    setRouteLocale(localeOf(pathname));
    const explicit = splitLangPath(pathname).lang;
    if (explicit) setVisitor(rememberLang(explicit));
  }, []);

  // Apply Luxon default locale on mount and whenever lang changes,
  // so every DateTime.toFormat('LLLL') / .toFormat('ccc') picks up the right names.
  useEffect(() => { applyLuxonLocale(lang); }, [lang]);

  // ★ ЕДИНСТВЕННЫЙ ВЛАДЕЛЕЦ <html lang> (TRIP-515). Атрибут управляет переносами
  // (app.css ссылается на него), произношением в скринридерах и предложением
  // перевода в браузере. Раньше его ставил только SiteChrome — и его же очистка
  // при уходе с лендинга возвращала атрибут на "en", то есть в приложении lang
  // всегда оставался английским (повод для перевода). Теперь владелец один: слой
  // i18n ставит атрибут на монтировании и при каждой смене языка. Пре-пейнт
  // скрипт в index.html выставляет то же значение ещё до кадра, поэтому
  // неверного-языка-кадра нет.
  useEffect(() => { document.documentElement.setAttribute('lang', lang); }, [lang]);

  // Тот же язык — читателям ВНЕ дерева React (язык регистрации в AuthContext).
  // Публикует один писатель, поэтому второй копии лестницы больше нет.
  useEffect(() => { publishLang(lang); }, [lang]);

  useEffect(() => {
    if (user) setUnitsState(detectInitialUnits(user));
  }, [user?.unit_system]); // eslint-disable-line

  // setLang/setUnits объявлены НИЖЕ, после `t`: их обработчик провала edge-записи
  // зовёт errorText(t, code) для тоста, а `t` — const, объявленный дальше по телу
  // (в его dep-массиве до объявления был бы TDZ).

  // Conditional resolution:
  //  - In-context editing session (only you, locally): route through Tolgee so the
  //    observer marker-wraps the string for editing.
  //  - Everyone else: resolve straight from the baked dictionary (active lang →
  //    en fallback → raw key) and do the {var} interpolation ourselves — zero
  //    Tolgee overhead on the hot path. Mirrors the pre-Tolgee behaviour exactly.
  // Re-created on `lang` change so consumers re-render with the new language.
  const t = useCallback((key, vars) => {
    if (IN_CONTEXT) {
      // Tolgee stores keys namespaced (namespace = the first dot segment, e.g.
      // 'account'); split the dotted address so the SDK resolves the right
      // (namespace, key) and the observer marker-wraps it for the editor. A dotless
      // address has no namespace (mirrors the baked-dict `lookup` split below).
      const dot = key.indexOf('.');
      if (dot > 0) return tolgee.t({ key: key.slice(dot + 1), ns: key.slice(0, dot), params: vars });
      return tolgee.t({ key, params: vars });
    }
    const dicts = dictsRef.current;
    let str = lookup(dicts[lang], key) || lookup(dicts[FALLBACK_LANG], key) || key;
    if (vars && typeof str === 'string') {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  }, [lang]);

  // Обе настройки ОПТИМИСТИЧНЫ: экран и localStorage меняются мгновенно, edge-
  // запись профиля не блокирует UI. Запись идёт единой дверью (шов
  // account/profile), не прямым REST в users; общий хвост — здесь. Провал edge-
  // записи обрабатывается ЧЕСТНО — тост через errorText, а не `catch{/*ignore*/}`
  // (контракт ошибок TRIP-400). Аноним (нет user) — только локально, без двери.
  const persistProfile = useCallback(async (patch) => {
    if (!user) return;
    const { error, code } = await invokeFn('account/profile', { body: patch });
    if (error || code) toast({ description: errorText(t, code), variant: 'destructive' });
  }, [user, t]);

  // ★ «ЧЕЛОВЕК ВЫБРАЛ ЯЗЫК» — ЭТО ЗАПИСЬ В ДВА НИЖНИХ СЛОЯ, И БОЛЬШЕ НИЧЕГО.
  //
  // Экран переключится сам: слои пересчитаются, эффект выше догрузит словарь и
  // покажет. Отдельного «применить язык» больше не существует — оно и было тем
  // вторым способом менять язык, через который он утекал.
  //
  // На лендинге и демо у выбора есть ЕЩЁ и адрес (`useZoneLang` уводит на
  // `/es`, `/ru`) — верхний слой; здесь мы про него ничего не знаем и знать не
  // должны.
  const setLang = useCallback(async (newLang) => {
    if (!hasLang(newLang)) return;
    setVisitor(rememberLang(newLang));
    await persistProfile({ language: newLang });
  }, [persistProfile]);

  const setUnits = useCallback(async (newUnits) => {
    if (!UNIT_SYSTEMS.includes(newUnits)) return;
    setUnitsState(newUnits);
    try { localStorage.setItem(UNITS_STORAGE_KEY, newUnits); } catch (e) { /* ignore */ }
    await persistProfile({ unit_system: newUnits });
  }, [persistProfile]);

  const dictFull = full.has(lang);

  // ★ `dictFull` ОБЯЗАН быть в зависимостях мемо. `t` — стабильный колбэк, он
  // читает словарь через ref и при фоновой догрузке НЕ меняется; без этой
  // зависимости объект контекста остался бы тем же, потребители не
  // перерисовались бы, и строки, приехавшие второй фазой, не появились бы до
  // следующего рендера по другой причине.
  const value = useMemo(() => ({
    lang,
    setLang,
    applyRoute,
    // ★ Локаль маршрута отдаётся наружу — из неё строятся ссылки внутри зоны.
    //
    // Своего источника у них быть не может: страницы зоны рисуются под
    // ПОДМЕНЁННОЙ локацией (`<Routes location>` в App.jsx снимает языковой
    // префикс, чтобы таблица маршрутов была одна), поэтому `useLocation()`
    // внутри них префикса уже не видит. Прежний код обходил это чтением
    // `window.location` — вторым, нереактивным ответом на тот же вопрос, и
    // именно оно позволило закэшировать адрес главной на весь документ.
    //
    // Владелец факта один: сюда его кладёт `useRouteLocale` из корня роутера,
    // где путь ещё настоящий.
    routeLocale,
    units,
    setUnits,
    t,
    languages: LANGUAGES,
    locale: localeTag(lang),
    dictFull,
  }), [lang, setLang, applyRoute, routeLocale, units, setUnits, t, dictFull]);

  // Gate the first paint until the active locale is ready. «Готов» теперь значит
  // «загружены словари ЗОНЫ» — шесть из 48 (`zoneNamespaces.js`): маркетинговой
  // странице остальные 42 не нужны, а ждала она их все. Экраны приложения ждут
  // ПОЛНОГО словаря — их гейт в `App.jsx`, там же, где ожидание авторизации.
  // Сырых ключей это не добавляет: ни один экран приложения не рисуется, пока
  // `dictFull` не станет true.
  if (!ready.has(lang)) {
    return <AppLoading />;
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

/**
 * ★★ МОСТ «МАРШРУТ → ЯЗЫК». Один вызыватель, в корне роутера (`App.jsx`).
 *
 * Провайдер стоит ВЫШЕ роутера — он нужен и до него (экран загрузки, тосты), —
 * поэтому сам прочитать маршрут не может. Факт о маршруте приезжает сюда одной
 * дверью, а не выуживается из `window.location` теми, кому он понадобился.
 *
 * Владелец ОДИН и стоит в корне, а не на страницах: страницу можно забыть
 * добавить, корень — нет. Адреса без локали (вход, приглашение, юр-документы,
 * экраны приложения) отдают `null` — верхний слой на них просто не действует.
 *
 * @param {string} pathname текущий путь из роутера
 */
export function useRouteLocale(pathname) {
  const { applyRoute } = useI18n();
  useEffect(() => { applyRoute(pathname); }, [pathname, applyRoute]);
}

export function useT() {
  return useI18n().t;
}

// Convenience hook that bundles t() + locale-aware formatters.
// Usage: const { t, fmtDate, fmtCountry, fmtMoney, plural } = useI18nFormat();
export function useI18nFormat() {
  const { lang, units, t } = useI18n();
  return useMemo(() => ({
    lang,
    units,
    locale: localeTag(lang),
    t,
    fmtDate: (value, tz) => formatDayMonth(value, tz, lang),
    fmtCountry: (code, fallback) => localizeCountry(code, lang, fallback),
    fmtCurrencyName: (code) => localizeCurrencyName(code, lang),
    fmtMoney: (amount, currency, opts) => formatMoney(amount, currency, lang, opts),
    fmtNumber: (value, opts) => formatNumber(value, lang, opts),
    fmtRelative: (value) => formatRelativeTime(value, lang),
    plural: (count, keyPrefix, vars) => pluralize(t, count, keyPrefix, lang, vars),
    // Distance is always stored/computed in km; convert to the user's unit system
    // ONLY at the output layer. Returns { value, unit } — value is a locale-formatted
    // integer string, unit the localized label ('units.km' / 'units.mi').
    fmtDistance: (km) => {
      const n = Number(km);
      if (km == null || isNaN(n)) return { value: '', unit: '' };
      const imperial = units === 'imperial';
      const converted = imperial ? n * 0.621371 : n;
      return {
        value: formatNumber(Math.round(converted), lang),
        unit: t(imperial ? 'units.mi' : 'units.km'),
      };
    },
  }), [lang, units, t]);
}
