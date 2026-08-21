import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import HeaderActions from '@/components/HeaderActions';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Unified top bar used across the whole app.
 *
 * Standalone screens (Trips / Stats / Inbox / Account):
 *   [back*] logo · Triplanio │ <page title> │ theme · bell · account+PRO
 *
 * Trip screens (`isTrip`, внутри rail shell): шапка — тонкая КОНТЕКСТНАЯ полоса
 * [back] <trip title + meta> │ <actions>. Бренда нет (лого живёт в рейле), и
 * utilities (тема · уведомления · аккаунт) тоже — их несёт рейл (RailUtilities);
 * правый кластер трип-шапки отдан КОНТЕКСТНЫМ действиям экрана (`actions`).
 *
 * Бургер-кнопки больше нет: на телефоне меню трипа открывает мобильный док
 * («Ещё» → канон-шит), на планшете/десктопе рейл виден всегда.
 *
 * Разделы трипа (Edit / Settings / Members / Copy) живут в рейле (TripSidebar),
 * НЕ в шапке; сюда TripShell отдаёт только «Поделиться» — это ДЕЙСТВИЕ, а не
 * раздел. PRO badge + utility icons вне трипа приходят из <HeaderActions>.
 *
 * Props:
 *   user, isPro, isDark, onToggleTheme — forwarded to the right-hand cluster
 *   onBrand   — click handler for the logo/brand (defaults to nav('/trips'))
 *   onBack    — optional; renders the round back button when set
 *   backTitle — tooltip / aria-label for the back button
 *   title     — optional trip title (enables the trip block)
 *   meta      — optional trip meta node (e.g. dates · days · cities)
 *   isTrip    — trip-screen variant: НЕ рисует бренд-блок (лого живёт в рейле)
 *   actions   — узел правого кластера трип-шапки (только при isTrip)
 */
/**
 * ⚠️ Аннотация обязательна: без неё TS выводит тип из ДЕСТРУКТУРИЗАЦИИ и делает
 * КАЖДЫЙ проп без дефолта ОБЯЗАТЕЛЬНЫМ, поэтому законный вызов без `onBrand` /
 * `meta` (оба опциональны — у `onBrand` даже есть фолбэк `nav('/trips')`
 * строкой ниже) краснел TS2739 у экрана под `// @ts-check`.
 * Тот же запечатанный набор, что у компонентов `src/design/**`.
 *
 * ⚠️ `onToggleTheme` обязателен ДЛЯ НЕ-ТРИП вызывателей: он уходит в `onClick`
 * кнопки темы внутри `<HeaderActions>`, который рендерится на всех экранах,
 * кроме isTrip (у трипа utilities живут в рейле — RailUtilities). Тип ослаблен
 * до опционального ровно из-за трип-вызова (TripShell не передаёт ничего для
 * кластера); не-трип вызыватели без него получат кнопку темы, которая ничего
 * не делает, — передавать обязательно.
 *
 * Остальные пропы того же вызова проверены тем же вопросом и необязательны
 * ПО УСТРОЙСТВУ, а не по недосмотру: `user` читается только через `?.`, `isPro`
 * стоит под `{isPro && …}`, `onBack`/`meta` - под условием, `onBrand` и
 * `title` имеют фолбэк. Пограничный случай назван вслух: `isDark` выбирает
 * ЗНАЧОК (`isDark ? 'sun' : 'moon'`), без него кнопка работает, но может
 * показать не тот значок; все НЕ-ТРИП вызыватели (AppShell + два в
 * ManualPlanner) его передают, так что ужесточение было бы бесплатным -
 * оставлено необязательным намеренно, отдельным решением.
 *
 * @param {{ user?: any, isPro?: boolean, isDark?: boolean, onToggleTheme?: () => void,
 *           onBrand?: () => void, onBack?: () => void, backTitle?: string,
 *           title?: any, meta?: any, isTrip?: boolean, actions?: any }} p
 */
export default function AppHeader({
  user,
  isPro,
  isDark,
  onToggleTheme,
  onBrand,
  onBack,
  backTitle,
  title,
  meta,
  isTrip = false,
  actions = null,
}) {
  const nav = useNavigate();
  const t = useT();
  const goBrand = onBrand || (() => nav('/trips'));
  const hasTrip = title != null || meta != null;

  return (
    // Модификатор app-header--trip снят вместе с последним CSS-правилом на нём:
    // вариант шапки решает JSX (isTrip), мёртвый класс в DOM не печатаем.
    <header className="app-header">
      <div className="app-header__left">
        {onBack && (
          <button className="app-header__gbtn" onClick={onBack} title={backTitle} aria-label={backTitle || t('common.back')} type="button">
            <Icon name="back" size={17} />
          </button>
        )}

        {/* Трип-экраны бренда не несут: лого живёт наверху икон-рейла. */}
        {!isTrip && (
          <div className="app-header__brand" onClick={goBrand}>
            <span className="app-header__logo">
              <img src="/triplanio-logo.svg" alt="Triplanio" /> {/* i18n-ignore — «Triplanio» бренд, не переводится */}
            </span>
            <span className="app-header__brand-name">Triplanio</span> {/* i18n-ignore — бренд */}
          </div>
        )}

        {hasTrip && (
          <>
            {!isTrip && <span className="app-header__vdiv" />}
            <div className="app-header__trip">
              {/* div, not <h1>: a global `h1 { font-size: var(--fs-h2) !important }`
                  mobile rule would otherwise inflate the header title past desktop. */}
              <div className="app-header__trip-title">{title || '…'}</div>
              {meta && <div className="app-header__trip-meta">{meta}</div>}
            </div>
          </>
        )}
      </div>

      {/* Utilities на трип-экранах живут в рейле (RailUtilities) — правый
          кластер шапки вне трипа = HeaderActions, у трипа = контекстные
          ДЕЙСТВИЯ экрана (например, «Поделиться»). */}
      {(!isTrip || actions) && (
        <div className="app-header__right">
          {isTrip ? actions : <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={onToggleTheme} />}
        </div>
      )}
    </header>
  );
}
