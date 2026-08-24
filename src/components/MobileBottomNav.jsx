// @ts-check
/**
 * MobileBottomNav — custom mobile-only bottom navigation (≤640px).
 *
 * A floating frosted-glass "capsule dock" with a raised, glowing primary "+" in
 * the centre. Two context-aware variants:
 *   • trip — Обзор · Маршрут · (+) · Хронология · Ещё
 *   • app  — Поездки · (+) · Профиль
 *
 * Какой вариант показать, решает РЕГИСТРАЦИЯ, а не разбор адреса: пока на
 * экране живёт `TripShell`, он объявляет себя через `MobileNavContext`
 * (текущая секция, переход, открытие меню и «+»). Раньше половина этого ехала
 * через ГЛОБАЛ `window.__navigate` (TripView вешал функцию на window, док её
 * дёргал), а вторая половина — через этот самый контекст: два канала на одну
 * работу, и один из них мутируемый глобал, пересоздаваемый на каждой
 * навигации. Теперь канал один.
 *
 * Подписи, иконки и активность пунктов берутся из реестра секций
 * (`src/lib/tripMenu.js`), а не переписываются здесь заново.
 *
 * ── Объявление изменений для гарда 2p (визуальный дифф CSS) ──────────────────
 * Маркеры здесь, а не в app.css: блок с `{@media …}` внутри CSS гард разбирает
 * как правила (грабля разобрана в шапке EditLens.jsx).
 *
 * Док теперь ПРИЕЗЖАЕТ, а не возникает рывком. Правило общее, не «только на
 * одном переходе»: элемент с двумя поведениями по origin — узаконенная точка
 * расхождения. Кейфрейм существующий (`dockUp`). Апрув Pavel.
 * visual-diff-exempt: .mbnav__dock {@media (max-width: 640px)} animation — док приезжает при появлении, реюз кейфрейма dockUp, апрув Pavel
 * visual-diff-exempt: .mbnav__dock {@media (max-width: 640px) @media (prefers-reduced-motion: reduce)} animation — тот же вход гасится при снижении движения
 */
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '@/design/icons';
import { Avatar, IconBtn, UnreadBadge } from '@/design/index';
import { useAuth } from '@/lib/AuthContext';
import { displayName } from '@/lib/displayName';
import { useUnreadNotificationCount } from '@/lib/useNotifications';
import { useT } from '@/lib/i18n/I18nContext';
import { useCreateTrip } from '@/components/create/CreateTripProvider';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { DOCK_SECTIONS, sectionById } from '@/lib/tripMenu';

// ─── Context bridge ──────────────────────────────────────────────────────────
// TripShell регистрирует { current, onNavigate, openMenu, hidesDock } пока
// смонтирован; null = экрана трипа сейчас нет.
// `addActions` — ОТДЕЛЬНЫЙ канал «+»-меню: список дескрипторов действий
// `{ id, icon, tone, labelKey, onSelect }`, который собирает ЭКРАН (трип-линза
// знает роль/аддон, Stats — свой набор). Держится отдельно от `tripNav`, потому
// что регистрируют его и НЕ-трип экраны (Stats под app-вариантом дока). Есть
// список → «+» открывает ActionMenu; нет → фолбэк `openChoice()`.
// ⚠️ Тип контекста TS берёт с ДЕФОЛТНОГО ЗНАЧЕНИЯ, а не с реализации: заглушка
// `() => {}` объявляла сеттер БЕЗ аргументов, и настоящий `setTripNav` из
// `useState` в него не влезал. Долг был невидим при `checkJs:false` и вскрылся
// ровно тогда, когда в файл поставили прагму.
/** @type {React.Context<{ tripNav: any, setTripNav: (v: any) => void, addActions: any, setAddActions: (v: any) => void }>} */
const MobileNavContext = createContext({ tripNav: null, setTripNav: () => {}, addActions: null, setAddActions: () => {} });

export function MobileNavProvider({ children }) {
  const [tripNav, setTripNav] = useState(null);
  const [addActions, setAddActions] = useState(null);
  const value = useMemo(() => ({ tripNav, setTripNav, addActions, setAddActions }), [tripNav, addActions]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export const useMobileNav = () => useContext(MobileNavContext);

// ─── Items ───────────────────────────────────────────────────────────────────
// Аннотация обязательна не для красоты: без неё TS выводит тип из
// деструктуризации и делает КАЖДЫЙ проп без дефолта обязательным - вызов
// «иконка без аватара» и вызов «аватар без иконки» краснели оба, хотя оба
// законны и оба живые.
/** @param {{ icon?: string, label: string, active: boolean, onClick: () => any, avatar?: any, badge?: number }} p */
function NavItem({ icon, label, active, onClick, avatar, badge = 0 }) {
  return (
    <button
      type="button"
      className={'mbnav__item' + (active ? ' is-active' : '')}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      {/* Бейдж непрочитанного — внутри иконки: ко-селектор `.mbnav__ico >
          .badge--unread` сажает его оверлеем в угол (TRIP-354). */}
      <span className="mbnav__ico">{avatar || <Icon name={icon} size={21} />}<UnreadBadge count={badge} /></span>
      <span className="mbnav__lbl">{label}</span>
    </button>
  );
}

// ─── Bottom nav ──────────────────────────────────────────────────────────────
export default function MobileBottomNav() {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const { user } = useAuth();
  const { tripNav, addActions } = useMobileNav();
  const { openChoice } = useCreateTrip();
  // Вне трипа бейдж «Профиль» = только непрочитанные inapp-уведомления (глобально).
  // Внутри трипа бейдж «Ещё» = СУММА чат+inapp, её считает TripShell и кладёт в
  // `tripNav.moreBadge` (там на руках tripId). TRIP-354.
  const inappUnread = useUnreadNotificationCount();
  const path = loc.pathname;

  // Один аффорданс «+»: если экран объявил `addActions`, «+» = триггер ActionMenu
  // (на мобиле — его Sheet со строками-плитками); иначе фолбэк — создать трип.
  // Подпись: есть меню действий → общая «Добавить»; фолбэк-создание → своя подпись.
  const addMenu = (fallbackAria) => {
    const hasActions = !!addActions?.length;
    const trigger = (
      <IconBtn
        icon="plus"
        size="fab"
        className="mbnav__fab"
        ariaLabel={hasActions ? t('common.add') : fallbackAria}
        onClick={hasActions ? undefined : () => openChoice()}
      />
    );
    if (!hasActions) return trigger;
    return (
      <ActionMenu
        trigger={trigger}
        title={t('common.add')}
        items={addActions.map((a) => ({ ...a, label: t(a.labelKey) }))}
      />
    );
  };

  // Секция сама объявляет, что дока на ней быть не должно — сегодня это только
  // чат, у которого нижнюю кромку забрал композер. Редактор из этого списка
  // ВЫШЕЛ: его причина ('pending-layout') закрыта общим шеллом карты — шит сам
  // резервирует полосу нава и поднимает на неё минимальный детент. Причина живёт
  // в реестре секций строкой — здесь нужен только факт, поэтому приводим к
  // булеву, а не сверяем с true.
  const sectionHidesDock = !!tripNav?.hidesDock;

  // Роуты, которые владеют своей навигацией / не являются экранами приложения.
  // Первые четыре — пояс поверх ремня: до них исполнение не доходит, App.jsx
  // возвращает эти ветки ДО аут-гейта, под которым живёт этот док.
  // Строки про /trip/:id/edit тут больше НЕТ: редактор стал секцией и прячет
  // док сам, объявлением в реестре.
  const hidden =
    path.startsWith('/login') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/public') ||
    path.startsWith('/join') ||
    path === '/' ||
    path.startsWith('/new-trip') ||
    path.startsWith('/plan-trip-ai') ||
    sectionHidesDock;

  // Помечаем корень, пока нижней кромкой кто-то владеет — этим доком либо
  // композером на той секции, что его прячет. Консент-баннер живёт соседом
  // роутера и не видит ни того, ни другого, поэтому читает класс (TRIP-311).
  // Класс, а не `:has()`: цель сборки включает Firefox 104, где его ещё нет.
  const bottomOwned = !hidden || sectionHidesDock;
  useEffect(() => {
    document.documentElement.classList.toggle('has-bottom-dock', bottomOwned);
    return () => document.documentElement.classList.remove('has-bottom-dock');
  }, [bottomOwned]);

  // ★ ВЫСОТУ ДОКА ПУБЛИКУЕТ САМ ДОК — и не числом, а ИЗМЕРЕНИЕМ себя.
  // Полосу, которую он занимает, обязаны обходить трое: отступ снизу у контента
  // экрана, футер peek-шита и минимальный детент этого шита. Раньше каждый знал
  // её по-своему — `calc(84px + safe-area)` в `app.css`, `60px + 8px + safe-area`
  // здесь и `const NAV_DOCK_PX = 68` в JS линзы карты, причём последний терял
  // safe-area и сажал футер шита под домашнюю полоску. Теперь источник один, и
  // он не число: если док станет выше, все трое узнают об этом сами.
  // Прецедент рядом — класс `has-bottom-dock`: док уже сообщает о себе корню.
  const navRef = useRef(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = navRef.current;
    if (hidden || !el) { root.style.removeProperty('--nav-dock-h'); return undefined; }
    const publish = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      root.style.setProperty('--nav-dock-h', `${h > 0 ? h : 0}px`);
    };
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    // ★ border-box, А НЕ content-box (дефолт). Полоса дока растёт ИМЕННО
    // отступом — `padding-bottom: env(safe-area-inset-bottom)`, — а content-box
    // на смену отступа не реагирует вовсе: на телефоне с домашней полоской
    // токен молча остался бы прежним. Поймано подстановкой отступа на живом
    // экране: нав 68 → 102, токен стоял на 68.
    if (ro) ro.observe(el, { box: 'border-box' });
    window.addEventListener('resize', publish);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', publish);
      root.style.removeProperty('--nav-dock-h');
    };
  }, [hidden, tripNav]);

  if (hidden) return null;

  const avatarEl = (
    <Avatar className="mbnav__avatar" name={displayName(user?.email, user?.full_name)} photo={user?.avatar_url} seed={user?.id} size="sm" />
  );

  if (tripNav) {
    const sectionItems = (ids) => ids.map((id) => {
      const s = sectionById(id);
      return (
        <NavItem
          key={id}
          icon={s.icon}
          label={t(s.labelKey)}
          active={tripNav.current === id}
          onClick={() => tripNav.onNavigate?.(id)}
        />
      );
    });
    return (
      <nav className="mbnav" ref={navRef} aria-label={t('nav.trips')}>
        <div className="mbnav__dock">
          {sectionItems(DOCK_SECTIONS.left)}
          <span className="mbnav__center">
            {addMenu(t('common.add'))}
          </span>
          {sectionItems(DOCK_SECTIONS.right)}
          <NavItem icon="more" label={t('common.more')} active={false} badge={tripNav.moreBadge || 0} onClick={() => tripNav.openMenu?.()} />
        </div>
      </nav>
    );
  }

  // App (non-trip) variant.
  return (
    <nav className="mbnav" ref={navRef} aria-label={t('nav.trips')}>
      <div className="mbnav__dock mbnav__dock--app">
        <NavItem icon="grid" label={t('nav.trips')} active={path.startsWith('/trips')} onClick={() => nav('/trips')} />
        <span className="mbnav__center">
          {addMenu(t('trips.new'))}
        </span>
        <NavItem label={t('nav.account')} active={path.startsWith('/settings')} avatar={avatarEl} badge={inappUnread} onClick={() => nav('/settings')} />
      </div>
    </nav>
  );
}
