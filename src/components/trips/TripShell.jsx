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
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import TripSidebar, { TripSidebarSheet } from '@/components/trips/TripSidebar';
import { useMobileNav } from '@/components/MobileBottomNav';
import { DEFAULT_SECTION, sectionById } from '@/lib/tripMenu';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { useT } from '@/lib/i18n/I18nContext';
import { useIsPhone } from '@/hooks/use-mobile';
import { isProActive } from '@/lib/subscription';
import { Skeleton } from '@/design/index';

// Скелетон меню на время загрузки shell-запроса. Реальный TripSidebar тут
// нельзя: его состав зависит от аддонов и роли, а они приезжают тем же
// запросом - подставив его раньше, мы бы показали чужой набор пунктов и
// перерисовали меню под пользователем.
function SidebarSkeleton() {
  const t = useT();
  // Ширины полос — как были: у разделов своя формула, у управления своя. Свести
  // их в одну значило бы поменять картинку загрузки без повода.
  const row = (w) => (i) => (
    <div key={i} className="app-side__item">
      <Skeleton w={15} h={15} r={4} />
      <Skeleton w={w(i)} h={12} r={4} />
    </div>
  );
  return (
    <aside className="app-side">
      <div className="app-side__group">
        <div className="app-side__group-label">{t('trip.sections_title')}</div>
        {[1, 2, 3, 4, 5, 6].map(row((i) => 80 + (i % 3) * 15))}
      </div>
      <div className="app-side__group">
        <div className="app-side__group-label">{t('trip_menu.section_manage')}</div>
        {[1, 2, 3, 4].map(row((i) => 70 + (i % 3) * 10))}
      </div>
    </aside>
  );
}

export default function TripShell({
  tripId,
  trip,
  section = DEFAULT_SECTION,
  myRole,
  isOwner,
  isPro,
  proResolved = true,
  title,
  meta,
  onNavigate,
  onShare,
  onUpgrade,
  onProInfo,
  bodyRef,
  loading = false,
  children,
  drawer = null,
  overlays = null,
}) {
  const t = useT();
  const nav = useNavigate();
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const isPhone = useIsPhone();
  const [sideOpen, setSideOpen] = useState(false);
  const { setTripNav } = useMobileNav();

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
    };
    setTripNav(mine);
    // Снимаем ТОЛЬКО свою регистрацию: когда экранов с оболочкой станет два
    // (редактор во втором PR), порядок «размонтировался старый после того, как
    // смонтировался новый» иначе оставил бы док в общем варианте при живом трипе.
    return () => setTripNav((cur) => (cur === mine ? null : cur));
  }, [setTripNav, section, hidesDock]);

  // Дефолтная секция - «вверх» из трипа, любая другая - «вверх» в трип.
  const backTo = section === DEFAULT_SECTION ? '/trips' : `/trip/${tripId}`;

  // Секция сама владеет своим скроллом (карта, чат, редактор): тело без
  // паддинга и без скролла, поверхность в край.
  const flush = sectionById(section)?.flush === true;

  const menuProps = {
    tripId, trip, lens: section, isPro, proResolved, isOwner, myRole,
    onUpgrade, onProInfo,
  };

  return (
    <div className="trip-shell">
      <AppHeader
        isTrip
        user={user}
        isPro={isProActive(user)}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onBack={() => nav(backTo)}
        backTitle={t('trip.back')}
        // Пока грузимся, бургера нет - как и было. Открывать нечего: меню ещё
        // скелетон, а скрим и телефонный шит в этой ветке не отрисованы, то
        // есть выехавший ящик было бы нечем закрыть.
        onMenu={loading ? undefined : () => setSideOpen(true)}
        title={loading ? <Skeleton w={190} h={18} r={6} /> : title}
        meta={loading ? <Skeleton w={150} h={12} r={5} /> : meta}
      />
      <div className={'trip-body' + (sideOpen ? ' is-menu-open' : '')}>
        {loading ? <SidebarSkeleton /> : (
          <>
            <TripSidebar
              {...menuProps}
              onNavigate={(id) => { setSideOpen(false); onNavigate?.(id); }}
              onShare={onShare}
            />
            <div className="trip-side-scrim" onClick={() => setSideOpen(false)} />
            {/* Телефоны: то же меню канон-шитом. Выезжающий drawer и его скрим
                на этом брейкпоинте гасятся в CSS. */}
            <TripSidebarSheet
              {...menuProps}
              open={isPhone && sideOpen}
              onOpenChange={setSideOpen}
              onNavigate={(id) => { setSideOpen(false); onNavigate?.(id); }}
              onShare={onShare && (() => { setSideOpen(false); onShare(); })}
              onUpgrade={onUpgrade && (() => { setSideOpen(false); onUpgrade(); })}
              onProInfo={onProInfo && (() => { setSideOpen(false); onProInfo(); })}
              user={user}
              onAccount={() => { setSideOpen(false); nav('/settings'); }}
            />
          </>
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
