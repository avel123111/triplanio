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

export default function TripShell({
  tripId,
  trip,
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
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const isPhone = useIsPhone();
  // Ступень доступа — из единого канала права, не пропом (см. useTripMenu).
  const { step: myStep } = useTripAccess();
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

  // Бейдж непрочитанного на кнопке «Ещё» мобильного дока (TRIP-354): ВНУТРИ трипа
  // это СУММА двух каналов — непрочитанные сообщения чата трипа + непрочитанные
  // inapp-уведомления (глобальные). Оба счётчика уже канон-хуки; считаем их
  // здесь, где на руках tripId и роль, и передаём числом в регистрацию дока —
  // сам док (`MobileBottomNav`) живёт выше `TripShell` и tripId не знает. Чат
  // считаем только когда линза чата доступна, иначе — ноль подписок.
  const chatUnread = useUnreadChatCount(tripId, { enabled: isSectionAvailable('chat', trip, myStep) });
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
    <div className="trip-shell">
      <div className="trip-body">
        {/* Рейл рисуется и НА ЗАГРУЗКЕ — своего скелетон-двойника у него больше
            нет. Отдельный скелетон был копией раскладки и врал составом (девять
            серых пунктов, столько не бывает ни у кого), а шесть секций из десяти
            не гейтованы вовсе и известны без данных: рейл рисует их живыми и
            кликабельными, а место держит только под ролевыми (см.
            `loadingSections`). Шит телефона в этой фазе по-прежнему не монтируется:
            открывает его «Ещё» мобильного дока, и до ответа открывать нечего. */}
        <TripSidebar
          tripId={tripId}
          trip={trip}
          lens={section}
          isPro={isPro}
          proResolved={proResolved}
          onProUpsell={onProUpsell}
          onNavigate={(id) => onNavigate?.(id)}
          onShare={onShare}
          onBack={goBack}
          backTitle={backTitle}
          loading={loading}
        />
        {/* Телефоны: то же меню канон-шитом из мобильного дока. Рейла на
            этой ширине нет (CSS), выезжающего ящика больше нет нигде. */}
        {!loading && (
          <TripSidebarSheet
            tripId={tripId}
            trip={trip}
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
        {/* Шапка — СОСЕД контента, а не его потомок: к `.trip-content` абсолютом
            привязан хост выдвижных панелей (EventDrawerHost), и внутри шапки он
            поехал бы из-под неё. Сетка ставит её правой верхней ячейкой, на одну
            линию с бренд-слотом рейла. */}
        <AppHeader
          isTrip
          user={user}
          isPro={isProActive(user)}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          // Кнопка «назад» — только на телефоне: на остальных ширинах выход
          // из трипа живёт в бренд-слоте рейла, и вторая кнопка была бы
          // дублем того же действия.
          onBack={isPhone ? goBack : undefined}
          backTitle={backTitle}
          title={loading ? <Skeleton w={190} h={18} r={6} /> : title}
          meta={loading ? <Skeleton w={150} h={12} r={5} /> : meta}
        />
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
