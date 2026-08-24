/**
 * TripShell - оболочка ЛЮБОГО экрана трипа.
 *
 * До TRIP-349 оболочки было ДВЕ, собранные руками врозь: `.trip-shell/.trip-body/
 * .trip-content` у экранов трипа и `.ts-screen/.ts-sidecol/.ts-drawer` у
 * структурного редактора. `app.css` это прямо признавал ("живые оболочки - ...").
 * Цена такого дубля уже дважды оплачена: TRIP-211 сводил лестницу брейкпоинтов
 * (редактор уходил в drawer на 760 вместо 880), а на ≤640 они разъехались
 * заново - трип-экраны получили канон-шит меню, редактор остался на выезжающем
 * drawer'е. Один и тот же элемент, два поведения.
 *
 * Поэтому оболочка тут КОМПОНЕНТ, а не узор для копирования: у неё один хозяин,
 * и разъехаться ей больше негде.
 *
 * Три слота - потому что позиция в DOM у них несущая, а не косметическая:
 *   children       - тело секции, внутри скроллящегося <main>
 *   drawer         - внутри `.trip-content` ПОСЛЕ <main>: EventDrawerHost
 *                    позиционируется абсолютом относительно `.trip-content`
 *                    (уже ниже шапки и правее меню) и НЕ должен скроллиться с
 *                    содержимым, поэтому он сосед <main>, а не его потомок
 *   overlays       - внутри `.trip-shell` после `.trip-body`: диалоги, шиты,
 *                    плавающий виджет чата
 *
 * Кнопка «назад» ВЫВОДИТСЯ здесь, а не приходит пропом. Проп-колбэк - это
 * узаконенная точка расхождения: шов гарантирует КНОПКУ, но не ДЕЙСТВИЕ, и
 * именно так стрелка с любой линзы выкидывала из трипа целиком на `/trips`.
 * Правило одно: дефолтная секция ведёт на список трипов, любая другая - на
 * дефолтную секцию этого же трипа (TRIP-349 п.3).
 *
 * ── Объявление изменений для гарда 2p (визуальный дифф CSS) ──────────────────
 * Маркеры лежат ЗДЕСЬ, а не в app.css: внутри CSS многострочный блок с
 * `{@media …}` гард начинает разбирать как правила и выдаёт ложные ключи
 * (та же грабля разобрана в шапке EditLens.jsx). Гард читает маркеры из
 * ДОБАВЛЕННЫХ строк диффа, поэтому файл значения не имеет.
 *
 * ── ВИЗУАЛЬНЫЙ ЭКСПЕРИМЕНТ: ШАПКА ВО ВСЮ ШИРИНУ, МЕНЮ — ВИДЖЕТ (запрос Pavel) ──
 * Было: рейл занимал ЛЕВЫЙ БОРТ от кромки до кромки, его первые --header-h были
 * бренд-слотом со знаком, а шапка начиналась правее рейла — то есть знак стоял
 * не в шапке, и шапка не была шапкой ЭКРАНА.
 * Стало: шапка идёт во всю ширину и держит знак, как на всех прочих экранах;
 * меню лежит ПОД ней плавающим виджетом с зазором со всех сторон.
 * Следствия, каждое намеренное: выход из трипа стал видимой кнопкой (раньше
 * прятался в знак и проступал по наведению), сетка тела схлопнулась в один ряд,
 * а на телефоне вордмарк и разделитель уходят — иначе название трипа остаётся
 * без ширины.
 *
 * Вход оболочки при приходе из создания трипа: выезжает рейл. Апрув Pavel.
 * visual-diff-exempt: .app-side animation — рейл выезжает при приходе из создания трипа, апрув Pavel
 * visual-diff-exempt: .app-side {@media (prefers-reduced-motion: reduce)} animation — тот же вход гасится при снижении движения
 * visual-diff-exempt: .trip-shell[data-entering=create] animation — вторая единица наблюдения того же правила (селектор из двух частей)
 * visual-diff-exempt: .trip-shell[data-entering=create] {@media (prefers-reduced-motion: reduce)} animation — то же при снижении движения
 * visual-diff-exempt: from {@keyframes railIn} transform — кейфрейм выезда рейла из-за левой кромки
 * visual-diff-exempt: to {@keyframes railIn} transform — то же, конечное состояние
 *
 * Раскладочный эксперимент, по одному объявлению на строку (апрув Pavel):
 * visual-diff-exempt: .app-header__brand--back:focus-visible outline — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brand--back:focus-visible outline-offset — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brand--back:hover background — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brand--back:hover opacity — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brand--back:hover transform — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brand--back transition — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brand--back width — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brand-name {@media (max-width: 640px)} display — телефон: вордмарк и разделитель уходят, чтобы ширину забрало название трипа
 * visual-diff-exempt: .app-header__brandback background — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback border-radius — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback display — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback height — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback left — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback opacity — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback place-items — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback position — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback top — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback transform — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback transition — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback translate — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brandback width — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__brand width — в трипе слот это просто знак: ширину борта он больше не держит, иначе сложилась бы с полем шапки
 * visual-diff-exempt: .app-header__logo opacity — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__logo transform — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__logo transition — снято второе лицо бренд-слота: выход из трипа теперь обычная кнопка в шапке, а не стрелка по наведению
 * visual-diff-exempt: .app-header__vdiv {@media (max-width: 640px)} display — телефон: вордмарк и разделитель уходят, чтобы ширину забрало название трипа
 * visual-diff-exempt: .app-header--trip {@media (max-width: 640px)} display — телефон: вордмарк и разделитель уходят, чтобы ширину забрало название трипа
 * visual-diff-exempt: .app-header--trip {@media (max-width: 640px)} padding-left — телефон: вордмарк и разделитель уходят, чтобы ширину забрало название трипа
 * visual-diff-exempt: .app-header--trip padding-left — трип-шапка получила своё поле, равное зазору виджета меню под ней
 * visual-diff-exempt: .app-header--trip width — в трипе слот это просто знак: ширину борта он больше не держит, иначе сложилась бы с полем шапки
 * visual-diff-exempt: .app-header {@media (max-width: 640px)} grid-column — шапка вышла из сетки тела наверх и идёт во всю ширину
 * visual-diff-exempt: .app-header grid-column — шапка вышла из сетки тела наверх и идёт во всю ширину
 * visual-diff-exempt: .app-header grid-row — шапка вышла из сетки тела наверх и идёт во всю ширину
 * visual-diff-exempt: .app-side align-self — рейл стал плавающим виджетом: зазор, скругление, тень, своя высота
 * visual-diff-exempt: .app-side border-radius — рейл стал плавающим виджетом: зазор, скругление, тень, своя высота
 * visual-diff-exempt: .app-side box-shadow — рейл стал плавающим виджетом: зазор, скругление, тень, своя высота
 * visual-diff-exempt: .app-side grid-row — рейл стал плавающим виджетом: зазор, скругление, тень, своя высота
 * visual-diff-exempt: .app-side margin — рейл стал плавающим виджетом: зазор, скругление, тень, своя высота
 * visual-diff-exempt: .app-side max-height — рейл стал плавающим виджетом: зазор, скругление, тень, своя высота
 * visual-diff-exempt: .app-side padding — рейл стал плавающим виджетом: зазор, скругление, тень, своя высота
 * visual-diff-exempt: .app-side width — рейл стал плавающим виджетом: зазор, скругление, тень, своя высота
 * visual-diff-exempt: .trip-body {@media (max-width — сетка тела осталась одним рядом: шапки в ней больше нет
 * visual-diff-exempt: .trip-body grid-row — сетка тела осталась одним рядом: шапки в ней больше нет
 * visual-diff-exempt: .trip-body grid-template-columns — сетка тела осталась одним рядом: шапки в ней больше нет
 * visual-diff-exempt: .trip-body {@media (max-width: 640px)} grid-template-columns — телефонная колонка приведена к той же форме minmax(0,1fr), что и десктопная: голый 1fr не удерживает широкое содержимое
 * visual-diff-exempt: .trip-body grid-template-rows — сетка тела осталась одним рядом: шапки в ней больше нет
 * visual-diff-exempt: .trip-content grid-row — сетка тела осталась одним рядом: шапки в ней больше нет
 * visual-diff-exempt: from {@keyframes railIn} transform — въезд рейла уводит его за кромку вместе с зазором
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import TripSidebar, { TripSidebarSheet } from '@/components/trips/TripSidebar';
import { useMobileNav } from '@/components/MobileBottomNav';
import { DEFAULT_SECTION, sectionById, isSectionAvailable } from '@/lib/tripMenu';
import { useUnreadChatCount } from '@/lib/chat';
import { useUnreadNotificationCount } from '@/lib/useNotifications';
import { useAuth } from '@/lib/AuthContext';
import { useTripAccess } from '@/components/trips/TripAccessContext';
import { useTheme } from '@/lib/ThemeContext';
import { useT } from '@/lib/i18n/I18nContext';
import { useIsPhone } from '@/hooks/use-mobile';
import { isProActive } from '@/lib/subscription';
import { Skeleton } from '@/design/index';
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

export default function TripShell({
  tripId,
  // Обвязке нужен НЕ трип, а два факта состава меню: включённые аддоны (сюда) и
  // ступень (из контекста доступа). Проп `trip` тут был лишней зависимостью —
  // рейл читал из него ровно `details.addons`.
  addons,
  section = DEFAULT_SECTION,
  isPro,
  proResolved = true,
  title,
  meta,
  onNavigate,
  onShare,
  onProUpsell,
  bodyRef,
  loading = false,
  children,
  drawer = null,
  overlays = null,
}) {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const isPhone = useIsPhone();
  // Ступень доступа — из единого канала права, не пропом (см. useTripMenu).
  const { step: myStep } = useTripAccess();
  const [sideOpen, setSideOpen] = useState(false);
  const { setTripNav } = useMobileNav();

  // «КАК СЮДА ПОПАЛИ» — ФАКТ НА ОБОЛОЧКЕ, а не анимация, прописанная в детали:
  // оболочка объявляет `data-entering`, а CSS решает, что с ним делать.
  //
  // Сегодня единственный читатель этого факта — РЕЙЛ: он появляется только на
  // этом переходе, поэтому и въезд у него условный. Нижний док читателем НЕ
  // является намеренно: он монтируется на десятке других границ, и вход у него
  // безусловный и свой (обоснование — у его правила в app.css). Раскладки эти
  // двое не делят: рейла ниже 640 нет вовсе, дока выше 640 нет вовсе, — то есть
  // одновременно они не едут никогда и общий темп им не нужен.
  //
  // Читаем ОДИН РАЗ, на маунте (`useState` с инициализатором), и по двум причинам:
  //   • `location.state` живёт, пока живёт запись истории, — без снимка вход
  //     переигрывался бы при каждом ререндере этой же локации;
  //   • `!loading` — вход играем только когда оболочке УЖЕ ЕСТЬ ЧТО ПОКАЗАТЬ.
  //     Изначально условие защищало от ДВУХ выездов подряд: рейл менял
  //     реализацию на границе загрузки (скелетон → живой TripSidebar), то есть
  //     монтировался дважды, а CSS-анимация играет на каждом маунте. С переходом
  //     обвязки на один круг (PR 955) скелетона рейла больше нет и второго
  //     маунта тоже — но условие остаётся осмысленным: въезд поверх ещё
  //     незаполненной шапки читался бы как отдельный, второй переход. На пути из
  //     создания кэш прогрет (ManualPlanner), и ветка всегда тёплая.
  const [entering, setEntering] = useState(() => (loc.state?.from === 'create' && !loading ? 'create' : null));
  // ★ ФЛАГ СНИМАЕТСЯ ПОСЛЕ ОСАДКИ, И ЭТО НЕ УБОРКА РАДИ УБОРКИ. `data-entering`
  // читается как СОСТОЯНИЕ («сейчас входим»), а без снятия он оставался бы на
  // оболочке до размонтирования — то есть означал бы «когда-то входили». Сегодня
  // разницы не видно: единственный читатель — CSS-анимация, а она играет один раз
  // на маунт элемента. Но следующий, кто повесит на этот атрибут правило,
  // ожидающее временного состояния, получит вечное — и узнает об этом не сразу.
  // Ловушка снимается здесь, а не комментарием.
  useEffect(() => {
    if (!entering) return undefined;
    const id = setTimeout(() => setEntering(null), SURFACE_SETTLE_MS);
    return () => clearTimeout(id);
  }, [entering]);

  // Тело - постоянный скролл-контейнер (сама оболочка не скроллится), поэтому
  // при смене секции его надо вернуть наверх. Свой ref, если снаружи не дали:
  // ленте он нужен для рейла городов, остальным секциям - нет.
  const ownBodyRef = useRef(null);
  const mainRef = bodyRef || ownBodyRef;
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [section, mainRef]);

  // Мост к мобильному доку. Раньше это был ГЛОБАЛ `window.__navigate`, который
  // TripView вешал на window, а док дёргал, - при том что рядом уже стоял
  // контекст, через который тот же док получал «+» и «Ещё». Два канала на одну
  // работу, один из них мутируемый глобал. Регистрирует оболочка: у неё на
  // руках и текущая секция, и переход, и открытие меню.
  //
  // Колбэк держим в ref, а зависимости - только по ЗНАЧЕНИЯМ: вызыватель даёт
  // свежую стрелку на каждый рендер, и эффект на ней перерегистрировал бы док
  // каждый раз. «+» ехал этим же каналом (`openAdd`), но с TRIP-350 «+»-меню
  // питается отдельным `addActions` (экран регистрирует его сам), поэтому здесь
  // остался только переход между секциями.
  const navCbs = useRef({ onNavigate });
  navCbs.current = { onNavigate };
  // Значение флага — ПРИЧИНА (строка), поэтому приводим к булеву, а не сверяем
  // с true: `=== true` тихо вернул бы false на любой живой причине.
  const hidesDock = !!sectionById(section)?.hidesDock;

  // Бейдж непрочитанного на кнопке «Ещё» мобильного дока (TRIP-354): ВНУТРИ трипа
  // это СУММА двух каналов — непрочитанные сообщения чата трипа + непрочитанные
  // inapp-уведомления (глобальные). Оба счётчика уже канон-хуки; считаем их
  // здесь, где на руках tripId и роль, и передаём числом в регистрацию дока —
  // сам док (`MobileBottomNav`) живёт выше `TripShell` и tripId не знает. Чат
  // считаем только когда линза чата доступна, иначе — ноль подписок.
  const chatUnread = useUnreadChatCount(tripId, { enabled: isSectionAvailable('chat', addons, myStep) });
  const inappUnread = useUnreadNotificationCount();
  const moreBadge = chatUnread + inappUnread;
  // useLayoutEffect, а не useEffect: пассивный эффект выполняется ПОСЛЕ отрисовки,
  // и док успевал показать один кадр общего варианта («Поездки · + · Профиль»)
  // поверх открывшегося трипа - а тап, попавший в этот кадр, открывал создание
  // трипа вместо добавления в трип. Раньше вариант решался синхронно по адресу.
  useLayoutEffect(() => {
    const mine = {
      current: section,
      onNavigate: (id) => navCbs.current.onNavigate?.(id),
      openMenu: () => setSideOpen(true),
      hidesDock,
      moreBadge,
    };
    setTripNav(mine);
    // Снимаем ТОЛЬКО свою регистрацию: когда экранов с оболочкой станет два
    // (редактор во втором PR), порядок «размонтировался старый после того, как
    // смонтировался новый» иначе оставил бы док в общем варианте при живом трипе.
    return () => setTripNav((cur) => (cur === mine ? null : cur));
  }, [setTripNav, section, hidesDock, moreBadge]);

  // Состояние меню теперь ЧИСТО ТЕЛЕФОННОЕ: выезжающего ящика нет, шит открывается
  // только под `isPhone`. Не сбросив флаг на уходе с телефона, мы оставили бы его
  // висеть - и шит сам собой открылся бы при возврате на узкую ширину.
  useEffect(() => { if (!isPhone) setSideOpen(false); }, [isPhone]);

  // Дефолтная секция - «вверх» из трипа, любая другая - «вверх» в трип.
  const backTo = section === DEFAULT_SECTION ? '/trips' : `/trip/${tripId}`;

  // Секция сама владеет своим скроллом (карта, чат, редактор): тело без
  // паддинга и без скролла, поверхность в край.
  const flush = sectionById(section)?.flush === true;

  const goBack = () => nav(backTo);
  const backTitle = t('trip.back');

  return (
    <div className="trip-shell" data-entering={entering || undefined} style={MOTION_STYLE}>
      {/* ★ ШАПКА — ПЕРВЫЙ РЕБЁНОК ОБОЛОЧКИ, А НЕ ЯЧЕЙКА СЕТКИ ТЕЛА. Она идёт ВО
          ВСЮ ШИРИНУ экрана, поэтому и стоять обязана НАД телом, а не рядом с
          рейлом. Прежнее место (правая верхняя ячейка сетки 2×2) и было тем, что
          обрезало её слева на ширину рейла.
          Условие «шапка — СОСЕД `.trip-content`, а не его потомок» соблюдено и
          усилено: к `.trip-content` абсолютом привязан хост выдвижных панелей
          (`.evd-drawer`), и внутри шапки он поехал бы из-под неё. Здесь шапка
          вообще не предок `.trip-content` — она этажом выше. */}
      <AppHeader
        isTrip
        user={user}
        isPro={isProActive(user)}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        /* Выход из трипа — круглая кнопка на ВСЕХ ширинах. Раньше выше 640 его
           прятало второе лицо бренд-слота в рейле; бренд-слота у рейла больше
           нет, а прятать выход в знак, когда рядом есть место, незачем. */
        onBack={goBack}
        backTitle={backTitle}
        title={loading ? <Skeleton w={190} h={18} r={6} /> : title}
        meta={loading ? <Skeleton w={150} h={12} r={5} /> : meta}
      />
      <div className="trip-body">
        {/* Рейл и шит собирают состав САМИ — из фактов (аддоны + ступень), одной
            функцией `menuSections`. Отдельного «идёт загрузка» у меню больше нет:
            известен факт — пункт живой, неизвестен — место под него. Поэтому и шит
            телефона монтируется всегда: если факты уже на руках (переход с главной),
            «Ещё» открывает ГОТОВОЕ меню, а не заглушки. */}
        <TripSidebar
          tripId={tripId}
          addons={addons}
          lens={section}
          isPro={isPro}
          proResolved={proResolved}
          onProUpsell={onProUpsell}
          onNavigate={(id) => onNavigate?.(id)}
          onShare={onShare}
        />
        {/* Телефоны: то же меню канон-шитом из мобильного дока. Рейла на
            этой ширине нет (CSS), выезжающего ящика больше нет нигде. */}
        {(
          <TripSidebarSheet
            tripId={tripId}
            addons={addons}
            lens={section}
            isPro={isPro}
            proResolved={proResolved}
            open={isPhone && sideOpen}
            onOpenChange={setSideOpen}
            onNavigate={(id) => { setSideOpen(false); onNavigate?.(id); }}
            onShare={onShare && (() => { setSideOpen(false); onShare(); })}
            onProUpsell={onProUpsell && (() => { setSideOpen(false); onProUpsell(); })}
            user={user}
            onAccount={() => { setSideOpen(false); nav('/settings'); }}
          />
        )}
        <div className="trip-content">
          <main ref={mainRef} className={'trip-screen-body' + (flush ? ' trip-screen-body--flush' : '')}>
            {children}
          </main>
          {drawer}
        </div>
      </div>
      {overlays}
    </div>
  );
}
