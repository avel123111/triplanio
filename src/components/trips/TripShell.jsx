/**
 * TripShell - оболочка ЛЮБОГО экрана трипа, включая создание трипа.
 *
 * До TRIP-349 оболочки было ДВЕ, собранные руками врозь: `.trip-shell/.trip-body/
 * .trip-content` у экранов трипа и `.ts-screen/.ts-sidecol/.ts-drawer` у
 * структурного редактора. `app.css` это прямо признавал ("живые оболочки - ...").
 * Цена такого дубля уже дважды оплачена: TRIP-211 сводил лестницу брейкпоинтов
 * (редактор уходил в drawer на 760 вместо 880), а на ≤640 они разъехались
 * заново - трип-экраны получили канон-шит меню, редактор остался на выезжающем
 * drawer'е. Один и тот же элемент, два поведения.
 *
 * ★ С TRIP-520 оболочка — ЭЛЕМЕНТ РАСКЛАДКИ РОУТЕРА (layout route) на три
 * адреса: `/new-trip`, `/plan-trip-ai`, `/trip/:tripId`. Визард создания живёт в
 * той же оболочке, что и трип: та же шапка, тот же шелл карты, та же карта. Экран
 * под оболочкой ничего из этого не рисует — он публикует факты и рендерит своё
 * содержимое в слоты (контракт — `TripShellContext.jsx`). Поэтому на переходе
 * «создан → маршрут» не размонтируется ничего общего: шапка, панель над картой и
 * карта живут дальше и меняют содержимое, а не рождаются заново. Это единственный
 * способ сделать такой переход плавным: анимация есть только у живого элемента,
 * а не у пары «старый снесён / новый смонтирован».
 *
 * ★★ РЕЙЛ — СЛОЙ НАД ВСЕМ, И В ВИЗАРДЕ ЕГО НЕТ. Логотип, выход и меню
 * принадлежат рейлу; в визарде он убран за левую кромку (шапка визарда — во всю
 * ширину, со своей кнопкой «назад»), а на переходе в трип ВЫЕЗЖАЕТ. Полоса,
 * которую он закрывает, — одно число `--rail-inset` (0 в визарде, ширина рейла в
 * трипе): по нему едут сам рейл (transform), отступ шапки (padding), панель и
 * тумблер шелла карты (left) и камера (доезд отступа) — одним темпом поверхности.
 * Холст карты не меняет размер ни на кадр: рейл лежит над ним, как панель и шит.
 *
 * Три слота DOM - потому что позиция в DOM у них несущая, а не косметическая:
 *   main           - тело секции (сюда рендерится `<Outlet/>`); в секции с
 *                    картой здесь же стоит шелл карты, а тело экрана пусто
 *   `content`      - внутри `.trip-content` ПОСЛЕ <main>: EventDrawerHost
 *                    позиционируется абсолютом относительно `.trip-content`
 *                    (уже ниже шапки и правее меню) и НЕ должен скроллиться с
 *                    содержимым, поэтому он сосед <main>, а не его потомок
 *   `shell`        - внутри `.trip-shell` после `.trip-body`: диалоги, шиты,
 *                    плавающий виджет чата
 *
 * Кнопка «назад» ВЫВОДИТСЯ здесь, а не приходит пропом. Проп-колбэк - это
 * узаконенная точка расхождения: шов гарантирует КНОПКУ, но не ДЕЙСТВИЕ, и
 * именно так стрелка с любой линзы выкидывала из трипа целиком на `/trips`.
 * Правило одно: дефолтная секция ведёт на список трипов, любая другая - на
 * дефолтную секцию этого же трипа (TRIP-349 п.3). Визард — исключение по
 * построению: у него «назад» — шаг истории с конфирмом ухода, и это его
 * собственное действие (`onBack` в колбэках фактов).
 *
 * ── Объявление изменений для гарда 2p (визуальный дифф CSS) ──────────────────
 * Маркеры лежат ЗДЕСЬ, а не в app.css: внутри CSS многострочный блок с
 * `{@media …}` гард начинает разбирать как правила и выдаёт ложные ключи
 * (та же грабля разобрана в шапке EditLens.jsx). Гард читает маркеры из
 * ДОБАВЛЕННЫХ строк диффа, поэтому файл значения не имеет.
 *
 * Вход из создания трипа: рейл выезжает, шапка отодвигается, заголовок проступает.
 * Апрув Pavel (TRIP-520).
 * visual-diff-exempt: .app-side animation — рейл больше не анимируется кейфреймом: его положение — транзишн по полосе `--rail-inset`
 * visual-diff-exempt: .app-side {@media (prefers-reduced-motion: reduce)} animation — то же
 * visual-diff-exempt: .trip-shell[data-entering=create] animation — вход оболочки: остаётся только проступание заголовка шапки
 * visual-diff-exempt: .app-side transform — рейл убран за кромку в визарде и выезжает на полосу `--rail-inset`
 * visual-diff-exempt: .trip-body transform — тот же ключ со стороны родителя (составной селектор)
 * visual-diff-exempt: from {@keyframes railIn} transform — кейфрейм выезда снят: рейл едет транзишном по полосе
 * visual-diff-exempt: to {@keyframes railIn} transform — то же
 * visual-diff-exempt: .app-side transition — выезд рейла в темп поверхности
 * visual-diff-exempt: .app-side visibility — убранный рейл вне таба и дерева доступности
 * visual-diff-exempt: .trip-shell[data-mode=create] visibility — то же со стороны оболочки
 * visual-diff-exempt: .app-side z-index — рейл лежит над шапкой и контентом (шапка теперь во всю ширину)
 * visual-diff-exempt: .app-header grid-column — шапка во всю ширину сетки: полосу рейла она отдаёт отступом
 * visual-diff-exempt: .app-header--trip padding-left — отступ шапки под рейл едет по `--rail-inset`
 * visual-diff-exempt: .trip-content[data-bleed] --mapshell-inset-left — полоса рейла уходит шеллу карты числом от оболочки, не переменной CSS
 * visual-diff-exempt: .trip-body --mapshell-inset-left — то же (составной селектор)
 * visual-diff-exempt: .mapshell__panel transition — панель отодвигается на полосу рейла тем же темпом
 * visual-diff-exempt: .app-header__trip animation — заголовок шапки проступает при приходе из создания трипа
 * visual-diff-exempt: .app-header__trip {@media (prefers-reduced-motion: reduce)} animation — то же при снижении движения
 * visual-diff-exempt: .trip-body transition — шапка едет: на телефоне въезжает сверху, на десктопе отодвигает отступ под рейл (составной селектор)
 * visual-diff-exempt: .app-header transition — то же со стороны шапки
 * visual-diff-exempt: .trip-body {@media (max-width: 640px)} transform — шапка на телефоне в визарде убрана за верхний край (составной селектор)
 * visual-diff-exempt: .app-header {@media (max-width: 640px)} transform — то же со стороны шапки
 * visual-diff-exempt: .trip-shell[data-mode=create][data-surface] {@media (max-width: 640px)} transform — то же со стороны оболочки
 * visual-diff-exempt: .app-header z-index — шапка лежит над контентом в общей ячейке сетки
 * visual-diff-exempt: .trip-body {@media (max-width: 640px)} grid-row — секция с картой на телефоне лежит и под шапкой: холст одной высоты в визарде и трипе
 * visual-diff-exempt: .trip-content[data-bleed] {@media (max-width: 640px)} grid-row — то же (составной селектор)
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import TripSidebar, { TripSidebarSheet } from '@/components/trips/TripSidebar';
import { TripAccessProvider } from '@/components/trips/TripAccessContext';
import { ShellProvider, createStore, useShellMapProps } from '@/components/trips/TripShellContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import MapView from '@/components/views/MapView';
import { useMobileNav } from '@/components/MobileBottomNav';
import { DEFAULT_SECTION, sectionById, isSectionAvailable } from '@/lib/tripMenu';
import { useUnreadChatCount } from '@/lib/chat';
import { useUnreadNotificationCount } from '@/lib/useNotifications';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { useT } from '@/lib/i18n/I18nContext';
import { useIsPhone } from '@/hooks/use-mobile';
import { isProActive } from '@/lib/subscription';
import { withLeaveGuard } from '@/lib/withLeaveGuard';
import { cssPx } from '@/lib/cssPx';
import { MapShell, Skeleton } from '@/design/index';
import { SURFACE_EASE_CSS, SURFACE_SETTLE_MS } from '@/lib/surfaceMotion';

// Темп входа берётся из ОБЩЕГО контракта движения (`lib/surfaceMotion.js`), а не
// пишется числом в CSS: тем же временем и той же кривой едут шит, камера карты и
// плавающие контролы. Публикуем переменными на корне оболочки — ровно тем приёмом,
// каким это делают MapShell и PeekSheet, и каким нав публикует свою высоту.
// Константа МОДУЛЬНАЯ: значения приходят из модуля, зависимостей нет, и `useMemo`
// над таким объектом только делает вид, что что-то считает.
const MOTION_STYLE = {
  '--surface-settle': `${SURFACE_SETTLE_MS}ms`,
  '--surface-ease': SURFACE_EASE_CSS,
};

const NO_FACTS = /** @type {import('./TripShellContext').ShellFacts} */ ({ mode: 'trip' });

// Хост карты — ЕДИНСТВЕННЫЙ подписчик стора пропов карты: наведение на ряд
// маршрута перерисовывает его и карту, но не рейл и не шапку.
function SurfaceHost({ view }) {
  const props = useShellMapProps();
  return props ? <MapView view={view} {...props} /> : null;
}

export default function TripShell() {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const isPhone = useIsPhone();
  const [sideOpen, setSideOpen] = useState(false);
  const { setTripNav } = useMobileNav();

  // ── Что опубликовал экран (контракт — TripShellContext.jsx) ─────────────────
  const [facts, setFactsState] = useState(/** @type {import('./TripShellContext').ShellFacts | null} */ (null));
  const [surface, setSurface] = useState(/** @type {import('./TripShellContext').SurfaceConfig | null} */ (null));
  const [slots, setSlots] = useState(/** @type {Record<string, HTMLElement | null>} */ ({}));
  const cbs = useRef(/** @type {import('./TripShellContext').ShellCallbacks} */ ({}));
  const mapProps = useMemo(() => createStore(null), []);
  // Слот регистрируется callback-ref'ом: узел приезжает на маунте (`el`) и
  // снимается на анмаунте (`null`); одинаковое значение состояние не трогает.
  const registerSlot = useCallback((name, el) => {
    setSlots((cur) => (cur[name] === el ? cur : { ...cur, [name]: el }));
  }, []);
  const shellSlot = useCallback((el) => registerSlot('shell', el), [registerSlot]);
  const contentSlot = useCallback((el) => registerSlot('content', el), [registerSlot]);
  // Тело - постоянный скролл-контейнер (сама оболочка не скроллится): секции
  // получают его РЕФОМ (`host.mainRef`, рейл городов ленты следит за скроллом).
  // Реф, а не узел состоянием: узел ставится в фазе мутации коммита, то есть
  // ДО эффектов секции, смонтированной тем же коммитом — эффект видит его сразу;
  // узел состоянием приехал бы ре-рендером, и эффект с депами по данным до
  // следующей смены данных смотрел бы в null.
  const mainRef = useRef(/** @type {HTMLElement | null} */ (null));
  const host = useMemo(() => ({ setFacts: setFactsState, cbs, setSurface, mapProps, slots, mainRef }), [mapProps, slots]);

  const { mode, tripId = null, addons, section = DEFAULT_SECTION, step = null, isPro, proResolved = true, title, meta, loading = false, backTitle: factBackTitle } = facts || NO_FACTS;
  const isTrip = mode === 'trip';

  // «КАК СЮДА ПОПАЛИ» — ФАКТ НА ОБОЛОЧКЕ, а не анимация, прописанная в детали:
  // оболочка объявляет `data-entering`, а CSS решает, что с ним делать. Факт
  // выводится из СМЕНЫ РЕЖИМА у живой оболочки (`create` → `trip`), а не из
  // `location.state`: оболочка теперь одна на оба экрана и сама видит переход.
  // Читатель: заголовок шапки (проступает); рейл едет транзишном по полосе. Нижний док
  // читателем НЕ является намеренно: он монтируется на десятке других границ, и
  // вход у него безусловный и свой (обоснование — у его правила в app.css).
  const [entering, setEntering] = useState(/** @type {string | null} */ (null));
  const prevModeRef = useRef(mode);
  useLayoutEffect(() => {
    if (prevModeRef.current === 'create' && mode === 'trip') setEntering('create');
    prevModeRef.current = mode;
  }, [mode]);
  // ★ ФЛАГ СНИМАЕТСЯ ПОСЛЕ ОСАДКИ, И ЭТО НЕ УБОРКА РАДИ УБОРКИ. `data-entering`
  // читается как СОСТОЯНИЕ («сейчас входим»), а без снятия он оставался бы на
  // оболочке до размонтирования — то есть означал бы «когда-то входили». Сегодня
  // разницы не видно: единственный читатель — CSS-анимация, а она играет один раз
  // на маунт элемента. Но следующий, кто повесит на этот атрибут правило,
  // ожидающее временного состояния, получит вечное — и узнает об этом не сразу.
  useEffect(() => {
    if (!entering) return undefined;
    const id = setTimeout(() => setEntering(null), SURFACE_SETTLE_MS);
    return () => clearTimeout(id);
  }, [entering]);

  // При смене секции тело возвращается наверх.
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [section]);

  // Мост к мобильному доку. Раньше это был ГЛОБАЛ `window.__navigate`, который
  // TripView вешал на window, а док дёргал, - при том что рядом уже стоял
  // контекст, через который тот же док получал «+» и «Ещё». Два канала на одну
  // работу, один из них мутируемый глобал. Регистрирует оболочка: у неё на
  // руках и текущая секция, и переход, и открытие меню.
  // Значение флага — ПРИЧИНА (строка), поэтому приводим к булеву, а не сверяем
  // с true: `=== true` тихо вернул бы false на любой живой причине.
  const hidesDock = !!sectionById(section)?.hidesDock;

  // Бейдж непрочитанного на кнопке «Ещё» мобильного дока (TRIP-354): ВНУТРИ трипа
  // это СУММА двух каналов — непрочитанные сообщения чата трипа + непрочитанные
  // inapp-уведомления (глобальные). Оба счётчика уже канон-хуки; считаем их
  // здесь, где на руках tripId и роль, и передаём числом в регистрацию дока —
  // сам док (`MobileBottomNav`) живёт выше `TripShell` и tripId не знает. Чат
  // считаем только когда линза чата доступна, иначе — ноль подписок.
  const chatUnread = useUnreadChatCount(tripId, { enabled: isSectionAvailable('chat', addons, step) });
  const inappUnread = useUnreadNotificationCount();
  const moreBadge = chatUnread + inappUnread;
  // useLayoutEffect, а не useEffect: пассивный эффект выполняется ПОСЛЕ отрисовки,
  // и док успевал показать один кадр общего варианта («Поездки · + · Профиль»)
  // поверх открывшегося трипа - а тап, попавший в этот кадр, открывал создание
  // трипа вместо добавления в трип. Раньше вариант решался синхронно по адресу.
  // В визарде регистрации нет: дока на его адресах не бывает, а трипа — тоже.
  useLayoutEffect(() => {
    if (!isTrip) return undefined;
    const mine = {
      current: section,
      onNavigate: (id) => cbs.current.onNavigate?.(id),
      openMenu: () => setSideOpen(true),
      hidesDock,
      moreBadge,
    };
    setTripNav(mine);
    // Снимаем ТОЛЬКО свою регистрацию: порядок «размонтировался старый после
    // того, как смонтировался новый» иначе оставил бы док в общем варианте.
    return () => setTripNav((cur) => (cur === mine ? null : cur));
  }, [setTripNav, isTrip, section, hidesDock, moreBadge]);

  // Состояние меню ЧИСТО ТЕЛЕФОННОЕ: выезжающего ящика нет, шит открывается
  // только под `isPhone`. Не сбросив флаг на уходе с телефона, мы оставили бы его
  // висеть - и шит сам собой открылся бы при возврате на узкую ширину.
  useEffect(() => { if (!isPhone) setSideOpen(false); }, [isPhone]);

  // Дефолтная секция - «вверх» из трипа, любая другая - «вверх» в трип.
  // Визард отдаёт своё действие целиком (шаг истории + конфирм ухода внутри),
  // поэтому гейт ухода здесь ставится только на выведенный переход.
  const confirmLeave = cbs.current.confirmLeave;
  const goBack = cbs.current.onBack
    || withLeaveGuard(confirmLeave, () => nav(section === DEFAULT_SECTION ? '/trips' : `/trip/${tripId}`));
  const backTitle = factBackTitle || t('trip.back');
  const onNavigate = (id) => cbs.current.onNavigate?.(id);
  const onShare = cbs.current.onShare;
  const onProUpsell = cbs.current.onProUpsell;

  // Секция сама владеет своим скроллом (карта, чат, редактор): тело без
  // паддинга и без скролла, поверхность в край. Поверхность с картой — всегда.
  const flush = !!surface || sectionById(section)?.flush === true;
  // Секция с картой лежит ПОД рейлом: контент занимает обе колонки сетки, рейл
  // лежит над ним, а полосу рейла объявляет камере закрытой площадью уже сама
  // карта. На телефоне контент лежит и под ШАПКОЙ (обе строки сетки): холст тогда
  // одной высоты в визарде (шапки там нет) и в трипе — переезд без `resize()`,
  // шапка въезжает сверху над холстом. Разбор — у `.trip-content[data-bleed]`.
  // Визард без поверхности (экран лимита) на десктопе тоже в край: рейла в
  // визарде нет, и колонке под него нечего держать.
  const bleed = !!surface || (!isTrip && !isPhone);
  // Полоса шапки, закрытая над холстом, — ЧИСЛОМ шеллу карты: он ставит её
  // камере и своей раскладке из одного источника. На десктопе шапка стоит в своей
  // строке сетки, над холстом ничего не закрыто; на телефоне закрыта её высота,
  // кроме визарда, где шапки нет (ту же величину камера доводит на переходе).
  const [headerPx] = useState(() => cssPx('var(--header-h)'));
  const insetTop = isPhone && isTrip ? headerPx : 0;
  // Полоса РЕЙЛА — та же логика по горизонтали. В визарде рейла нет: он убран за
  // левую кромку, полоса 0; в трипе полоса = его ширина. Одно число ставится на
  // корень оболочки переменной `--rail-inset` (по ней едут сам рейл, отступ
  // шапки) и уходит шеллу карты (панель, тумблер, камера). На переходе всё это
  // едет одним темпом: рейл выезжает, панель отодвигается, камера доводит кадр.
  const [railPx] = useState(() => cssPx('var(--rail-w)'));
  const insetLeft = !isPhone && isTrip ? railPx : 0;
  const shellStyle = useMemo(() => ({ ...MOTION_STYLE, '--rail-inset': `${insetLeft}px` }), [insetLeft]);

  return (
    <ShellProvider value={host}>
    <TripAccessProvider step={step}>
    <div className="trip-shell" data-mode={mode} data-surface={surface ? '' : undefined} data-entering={entering || undefined} style={shellStyle} ref={shellSlot}>
      <div className="trip-body">
        {/* Рейл и шит собирают состав САМИ — из фактов (аддоны + ступень), одной
            функцией `menuSections`. Отдельного «идёт загрузка» у меню больше нет:
            известен факт — пункт живой, неизвестен — место под него. В визарде
            рейл убран за кромку (CSS по `--rail-inset`) и выезжает на переходе. */}
        <TripSidebar
          tripId={tripId}
          addons={addons}
          lens={section}
          isPro={isPro}
          proResolved={proResolved}
          onProUpsell={onProUpsell}
          onNavigate={onNavigate}
          onShare={onShare}
          onBack={goBack}
          backTitle={backTitle}
        />
        {/* Телефоны: то же меню канон-шитом из мобильного дока. Рейла на
            этой ширине нет (CSS), выезжающего ящика больше нет нигде. */}
        {isTrip && (
          <TripSidebarSheet
            tripId={tripId}
            addons={addons}
            lens={section}
            isPro={isPro}
            proResolved={proResolved}
            open={isPhone && sideOpen}
            onOpenChange={setSideOpen}
            onNavigate={(id) => { setSideOpen(false); onNavigate(id); }}
            onShare={onShare && (() => { setSideOpen(false); onShare(); })}
            onProUpsell={onProUpsell && (() => { setSideOpen(false); onProUpsell(); })}
            user={user}
            onAccount={() => { setSideOpen(false); nav('/settings'); }}
          />
        )}
        {/* Шапка — СОСЕД контента, а не его потомок: к `.trip-content` абсолютом
            привязан хост выдвижных панелей (EventDrawerHost), и внутри шапки он
            поехал бы из-под неё. Сетка ставит её правой верхней ячейкой, на одну
            линию с бренд-слотом рейла. Бренд-слот в шапке не рисуется (`isTrip`)
            и в визарде: он стоит в рейле, второй был бы дублем на том же месте. */}
        <AppHeader
          isTrip
          user={user}
          isPro={isProActive(user)}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          // Кнопка «назад» — где нет рейла: на телефоне и в визарде. В трипе на
          // десктопе выход живёт в бренд-слоте рейла, и вторая кнопка была бы
          // дублем того же действия.
          onBack={isPhone || !isTrip ? goBack : undefined}
          backTitle={backTitle}
          title={loading ? <Skeleton w={190} h={18} r={6} /> : title}
          meta={loading ? <Skeleton w={150} h={12} r={5} /> : meta}
          confirmLeave={confirmLeave}
        />
        <div className="trip-content" data-bleed={bleed || undefined} ref={contentSlot}>
          <main ref={mainRef} className={'trip-screen-body' + (flush ? ' trip-screen-body--flush' : '')}>
            {/* Шелл карты ЖИВЁТ ЗДЕСЬ, пока хоть один экран объявляет поверхность:
                на переходе визард → маршрут он не размонтируется, а меняет
                содержимое слотов. Карта внутри — один `MapView` на оба экрана. */}
            {surface && (
              /* Конфиг поверхности И ЕСТЬ пропы шелла карты (один список ключей —
                 `SURFACE_KEYS` в контракте), поэтому едет спредом: переписанный
                 сюда третий список тех же имён разъехался бы с ними молча. */
              <MapShell
                map={(view) => <SurfaceHost view={view} />}
                insetTop={insetTop}
                insetLeft={insetLeft}
                onSlot={registerSlot}
                {...surface}
              />
            )}
            {/* Граница ошибок экрана: падение одного адреса показывает фолбэк в теле,
                оболочка (рейл, шапка) и док остаются живыми. Ключ по адресу —
                уход с упавшего экрана снимает фолбэк. */}
            <ErrorBoundary key={loc.pathname} region={`route:${loc.pathname}`}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
    </TripAccessProvider>
    </ShellProvider>
  );
}
