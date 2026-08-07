/**
 * MobileBottomNav — custom mobile-only bottom navigation (≤640px).
 *
 * A floating frosted-glass "capsule dock" with a raised, glowing primary "+" in
 * the centre. Two context-aware variants:
 *   • trip — Обзор · Хронология · (+) · Календарь · Ещё
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
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Icon } from '@/design/icons';
import { Avatar } from '@/design/index';
import { useAuth } from '@/lib/AuthContext';
import { displayName } from '@/lib/displayName';
import { useT } from '@/lib/i18n/I18nContext';
import { useCreateTrip } from '@/components/create/CreateTripProvider';
import { DOCK_SECTIONS, sectionById } from '@/lib/tripMenu';

// ─── Context bridge ──────────────────────────────────────────────────────────
// TripShell регистрирует { current, onNavigate, openMenu, openAdd,
// ownsBottomEdge } пока смонтирован; null = экрана трипа сейчас нет.
const MobileNavContext = createContext({ tripNav: null, setTripNav: () => {} });

export function MobileNavProvider({ children }) {
  const [tripNav, setTripNav] = useState(null);
  const value = useMemo(() => ({ tripNav, setTripNav }), [tripNav]);
  return <MobileNavContext.Provider value={value}>{children}</MobileNavContext.Provider>;
}

export const useMobileNav = () => useContext(MobileNavContext);

// ─── Items ───────────────────────────────────────────────────────────────────
function NavItem({ icon, label, active, onClick, avatar }) {
  return (
    <button
      type="button"
      className={'mbnav__item' + (active ? ' is-active' : '')}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      <span className="mbnav__ico">{avatar || <Icon name={icon} size={21} />}</span>
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
  const { tripNav } = useMobileNav();
  const { openChoice } = useCreateTrip();
  const path = loc.pathname;

  // Секция забирает нижнюю кромку экрана (композер чата) → плавающий док сел бы
  // на кнопку отправки. Флаг объявлен в реестре секций, а не разобран здесь по
  // адресу.
  const sectionOwnsBottom = tripNav?.ownsBottomEdge === true;

  // Роуты, которые владеют своей навигацией / не являются экранами приложения.
  // Первые четыре — пояс поверх ремня: до них исполнение не доходит, App.jsx
  // возвращает эти ветки ДО аут-гейта, под которым живёт этот док.
  const hidden =
    path.startsWith('/login') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/public') ||
    path.startsWith('/join') ||
    path === '/' ||
    path.startsWith('/new-trip') ||
    path.startsWith('/plan-trip-ai') ||
    // Структурный редактор — пока отдельный роут со своей оболочкой, поэтому
    // `TripShell` там не смонтирован и решить по регистрации нельзя. Строка
    // уходит вторым PR TRIP-349, когда редактор станет секцией.
    /^\/trip\/[^/]+\/edit\/?$/.test(path) ||
    sectionOwnsBottom;

  // Помечаем корень, пока нижней кромкой кто-то владеет — этим доком либо
  // композером на той секции, что его прячет. Консент-баннер живёт соседом
  // роутера и не видит ни того, ни другого, поэтому читает класс (TRIP-311).
  // Класс, а не `:has()`: цель сборки включает Firefox 104, где его ещё нет.
  const bottomOwned = !hidden || sectionOwnsBottom;
  useEffect(() => {
    document.documentElement.classList.toggle('has-bottom-dock', bottomOwned);
    return () => document.documentElement.classList.remove('has-bottom-dock');
  }, [bottomOwned]);

  if (hidden) return null;

  const avatarEl = (
    <Avatar className="mbnav__avatar" name={displayName(user?.email, user?.full_name)} photo={user?.avatar_url} size="sm" />
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
      <nav className="mbnav" aria-label={t('nav.trips')}>
        <div className="mbnav__dock">
          {sectionItems(DOCK_SECTIONS.left)}
          <span className="mbnav__center">
            <button type="button" className="mbnav__fab" aria-label={t('common.add')} onClick={() => tripNav.openAdd?.()}>
              <Icon name="plus" size={26} />
            </button>
          </span>
          {sectionItems(DOCK_SECTIONS.right)}
          <NavItem icon="more" label={t('common.more')} active={false} onClick={() => tripNav.openMenu?.()} />
        </div>
      </nav>
    );
  }

  // App (non-trip) variant.
  return (
    <nav className="mbnav" aria-label={t('nav.trips')}>
      <div className="mbnav__dock mbnav__dock--app">
        <NavItem icon="grid" label={t('nav.trips')} active={path.startsWith('/trips')} onClick={() => nav('/trips')} />
        <span className="mbnav__center">
          <button type="button" className="mbnav__fab" aria-label={t('trips.new')} onClick={() => openChoice()}>
            <Icon name="plus" size={26} />
          </button>
        </span>
        <NavItem label={t('nav.account')} active={path.startsWith('/settings')} avatar={avatarEl} onClick={() => nav('/settings')} />
      </div>
    </nav>
  );
}
