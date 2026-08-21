/**
 * AppShell — оболочка standalone-экранов приложения (Путешествия · Статистика ·
 * Входящие · Аккаунт · Pro). Половина «rail everywhere»: тот же узкий
 * полновысотный икон-рейл, что у трип-экранов (TripShell), но с app-уровневой
 * навигацией. На десктопе/планшете ВЕРХНЕЙ ШАПКИ НЕТ — глобальный хром целиком
 * живёт в рейле (лого · разделы · PRO · тема · уведомления · аккаунт), контент
 * открывается собственным заголовком экрана (Greeting / .head / PageHead), и
 * дубль «название в шапке + название в контенте» исчезает.
 *
 * Телефон (≤640) не меняется: прежний AppHeader (бренд/назад/заголовок) +
 * плавающий док. Гейт — JS (useIsPhone), НЕ новый брейкпоинт: рейл на телефоне
 * просто не рендерится, шапка рендерится только на телефоне.
 *
 * DOM: .app-shell > [AppHeader (телефон)] + .app-frame (ряд) > [AppRail] + children.
 * Скролл на десктопе остаётся ДОКУМЕНТНЫМ (как был у этих экранов) — рейл
 * прилипает sticky на всю высоту вьюпорта; на телефоне работает прежний
 * фикс-шелл ≤640 (скроллится main внутри .app-frame).
 *
 * Экраны передают children цельными: свой <main class="page-main [page-main--wide]">
 * + свои панели/диалоги (VisitPanel и т.п. — позиционируются fixed, ряд им не мешает).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import NotificationsBell from '@/components/notifications/NotificationsBell';
import { useAccountMenuItems } from '@/components/HeaderActions';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { Icon } from '@/design/icons';
import { Avatar, Badge, Grow, UnreadBadge } from '@/design/index';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { useT } from '@/lib/i18n/I18nContext';
import { useIsPhone } from '@/hooks/use-mobile';
import { isProActive } from '@/lib/subscription';
import { useUnreadNotificationCount } from '@/lib/useNotifications';
import { displayName } from '@/lib/displayName';

// Плитка рейла — ЕДИНСТВЕННАЯ реализация пункта для обоих рейлов (app и трип):
// вертикальная «остановка маршрута» (иконка в круге на нити + подпись .t-tiny).
// title дублирует подпись на случай эллипсиса длинной локали; бейдж — канон
// .badge--unread оверлеем (ко-селектор владельца в app.css).
// ⚠️ aria-label НЕ ставим: он перекрыл бы имя-из-контента и скрыл от скринридера
// ЧИСЛО непрочитанного в бейдже — имя кнопки = подпись + счётчик (TRIP-354).
export function RailItem({ icon, label, active = false, onClick, badge = 0 }) {
  return (
    <button
      type="button"
      className={'app-side__item' + (active ? ' active' : '')}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={label}
    >
      <Icon name={icon} size={20} />
      <span className="app-side__label t-tiny">{label}</span>
      <UnreadBadge count={badge} />
    </button>
  );
}

// Нижний кластер ОБОИХ рейлов: тема · [уведомления] · аккаунт (канон-меню:
// Профиль / Выйти — тот же состав, что в шапке: useAccountMenuItems). Кластер
// ПРИШПИЛЕН к низу рейла (секции скроллятся отдельно, .app-side__scroll).
// `bell=false` у app-рейла: там «Входящие» — первоклассный пункт навигации,
// второй колокольчик с тем же бейджем рядом сбивал бы с толку.
export function RailUtilities({ bell = true }) {
  const t = useT();
  const { user } = useAuth();
  const { isDark, toggle } = useTheme();
  const accountItems = useAccountMenuItems();
  const accountName = displayName(user?.email, user?.full_name);
  return (
    <div className="app-side__group">
      <button
        type="button"
        className="app-side__item"
        onClick={toggle}
        title={t('nav.toggle_theme')}
        aria-label={t('nav.toggle_theme')}
      >
        <Icon name={isDark ? 'sun' : 'moon'} size={20} />
        <span className="app-side__label t-tiny">{t('settings.theme')}</span>
      </button>
      {bell && <NotificationsBell side="right" align="end" railItem />}
      <ActionMenu
        side="right"
        align="end"
        title={t('nav.account')}
        trigger={(
          // Без aria-label: доступное имя = видимая подпись «Аккаунт» (WCAG 2.5.3
          // Label in Name — голосовое управление говорит то, что написано);
          // имя пользователя остаётся в title-подсказке.
          <button
            type="button"
            className="app-side__item"
            title={accountName || t('nav.account')}
          >
            <Avatar name={accountName} photo={user?.avatar_url} seed={user?.id} size="sm" />
            <span className="app-side__label t-tiny">{t('nav.account')}</span>
          </button>
        )}
        items={accountItems}
      />
    </div>
  );
}

// Разделы app-уровня. Как и у трип-рейла, состав НАЗВАН явно — это продуктовый
// выбор, а не вывод из роутов. «Входящие» — первоклассный пункт с бейджем
// (раньше экран прятался за поповером колокольчика).
const APP_SECTIONS = [
  { id: 'trips', icon: 'suitcase', labelKey: 'nav.trips', to: '/trips' },
  { id: 'stats', icon: 'globe', labelKey: 'stats.nav', to: '/stats' },
  { id: 'inbox', icon: 'mail', labelKey: 'notif.inbox_title', to: '/inbox' },
];

function AppRail({ active }) {
  const t = useT();
  const nav = useNavigate();
  const { user } = useAuth();
  const isPro = isProActive(user);
  const inboxUnread = useUnreadNotificationCount();
  return (
    // <nav>, не <aside>: на десктопе это ЕДИНСТВЕННЫЙ навигационный лендмарк
    // экрана (шапки нет) — complementary-роль прятала его от ротора скринридера.
    // Секции — в скролл-регионе (.app-side__scroll); utilities пришпилены к низу
    // и видимы всегда, даже на коротких вьюпортах.
    <nav className="app-side" aria-label={t('nav.aria_primary')}>
      <button type="button" className="app-side__brand" onClick={() => nav('/trips')} title={t('nav.trips')} aria-label={t('nav.trips')}>
        <img src="/triplanio-logo.svg" alt="" />
      </button>
      <div className="app-side__scroll">
        <div className="app-side__group">
          {APP_SECTIONS.map((s) => (
            <RailItem
              key={s.id}
              icon={s.icon}
              label={t(s.labelKey)}
              active={active === s.id}
              onClick={() => nav(s.to)}
              badge={s.id === 'inbox' ? inboxUnread : 0}
            />
          ))}
        </div>
        <Grow />
        {/* Вход в Pro: компакт-чип, как у трип-рейла (там — апгрейд трипа). */}
        {!isPro && (
          <button
            type="button"
            className="app-side__item"
            onClick={() => nav('/pro')}
            title={t('trips.go_pro')}
            aria-label={t('trips.go_pro')}
          >
            <Badge variant="pro" icon="pro">PRO</Badge>
          </button>
        )}
      </div>
      <RailUtilities bell={false} />
    </nav>
  );
}

/**
 * ⚠️ Аннотация обязательна (та же ловушка, что у AppHeader): без неё TS выводит
 * тип из деструктуризации и делает каждый проп без дефолта ОБЯЗАТЕЛЬНЫМ —
 * законный вызов без title/onBack (главная: телефонная шапка без заголовка)
 * краснел бы TS2739 у экранов под `// @ts-check`.
 * @param {{ active?: string|null, title?: any, onBack?: () => void, backTitle?: string,
 *           ghost?: boolean, className?: string, children?: any }} p
 */
export default function AppShell({ active = null, title, onBack, backTitle, ghost = false, className = '', children }) {
  const isPhone = useIsPhone();
  const { user } = useAuth();
  const { isDark, toggle } = useTheme();
  const isPro = isProActive(user);
  return (
    <div className={'app-shell' + (ghost ? ' stats-ghost' : '') + (className ? ' ' + className : '')}>
      {isPhone && (
        <AppHeader
          user={user}
          isPro={isPro}
          isDark={isDark}
          onToggleTheme={toggle}
          onBack={onBack}
          backTitle={backTitle}
          title={title}
        />
      )}
      <div className="app-frame">
        {!isPhone && <AppRail active={active} />}
        {children}
      </div>
    </div>
  );
}
