import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import HeaderActions from '@/components/HeaderActions';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Бренд-СЛОТ — бокс `--rail-w × --header-h` в левом верхнем углу экрана.
 * Единственная реализация на два дома: первая ячейка шапки на экранах вне трипа
 * и шапка рейла внутри трипа. Второй экземпляр разъехался бы по геометрии на
 * первой же правке, а знак при переходе между экранами прыгнул бы - роуты это
 * разные ветки дерева, узел логотипа всё равно перемонтируется, и на месте его
 * держат ЧИСЛА, а не общий DOM.
 *
 * `back` включает второе лицо слота (стрелка выхода), которое проступает по
 * наведению - в рейле оно заменяет круглую кнопку «назад» в шапке.
 *
 * @param {{ onClick: () => void, title?: string, back?: boolean }} p
 */
export function BrandSlot({ onClick, title, back = false }) {
  return (
    <button className={'app-header__brand' + (back ? ' app-header__brand--back' : '')} onClick={onClick} title={title} type="button">
      <span className="app-header__logo">
        <img src="/triplanio-logo.svg" alt="Triplanio" />
      </span>
      {back && (
        <span className="app-header__brandback" aria-hidden="true">
          <Icon name="back" size={17} />
        </span>
      )}
    </button>
  );
}


/**
 * Unified top bar (brand gradient) used across the whole app.
 *
 * Replaces the old white `.app-header` AND the separate gradient hero
 * (`.trip-hero` / TripHeaderBar): both rows collapse into a single branded
 * bar. The trip title, meta and trip-action buttons now live here, separated
 * from the brand block and from the utility cluster by vertical dividers.
 *
 *   [menu*][back*] logo · Triplanio │ <trip title + meta> │ theme · bell · account+PRO
 *     menu  — burger, shown ONLY on mobile (opens the trip sidebar drawer)
 *     back  — round back/exit button, rendered when `onBack` is provided
 *     trip  — title / meta render only when a trip context is given
 *
 * Trip actions (Share / Edit / Settings / Members / Copy) live in the left trip
 * menu (TripSidebar), NOT in this header. PRO badge + utility icons come from
 * <HeaderActions>.
 *
 * Props:
 *   user, isPro, isDark, onToggleTheme — forwarded to the right-hand cluster
 *   onBrand   — click handler for the logo/brand (defaults to nav('/trips'))
 *   onBack    — optional; renders the round back button when set
 *   backTitle — tooltip / aria-label for the back button
 *   onMenu    — optional; renders the mobile-only burger (trip sidebar)
 *   title     — optional trip title (enables the trip block)
 *   meta      — optional trip meta node (e.g. dates · days · cities)
 */
/**
 * ⚠️ Аннотация обязательна: без неё TS выводит тип из ДЕСТРУКТУРИЗАЦИИ и делает
 * КАЖДЫЙ проп без дефолта ОБЯЗАТЕЛЬНЫМ, поэтому законный вызов без `onBrand` /
 * `onMenu` / `meta` (все три опциональны — у `onBrand` даже есть фолбэк
 * `nav('/trips')` строкой ниже) краснел TS2739 у экрана под `// @ts-check`.
 * Тот же запечатанный набор, что у компонентов `src/design/**`.
 *
 * ⚠️ `onToggleTheme` ОБЯЗАТЕЛЕН, и это не педантизм: он уходит в `onClick`
 * кнопки внутри `<HeaderActions>`, которая рендерится БЕЗУСЛОВНО. Вызыватель без
 * него получает видимую кнопку темы, которая ничего не делает, - молчаливый
 * дефект без единого признака. Ослабление типа есть СНЯТИЕ ПОКРЫТИЯ: каждый `?`
 * это заявление «без этого компонент работает», и здесь оно было бы неправдой.
 *
 * Остальные три пропа того же вызова проверены тем же вопросом и необязательны
 * ПО УСТРОЙСТВУ, а не по недосмотру: `user` читается только через `?.`, `isPro`
 * стоит под `{isPro && …}`, `onBack`/`onMenu`/`meta` - под условием, `onBrand` и
 * `title` имеют фолбэк. Пограничный случай назван вслух: `isDark` выбирает
 * ЗНАЧОК (`isDark ? 'sun' : 'moon'`), без него кнопка работает, но может
 * показать не тот значок; все 7 вызывателей его передают, так что ужесточение
 * было бы бесплатным - оставлено необязательным намеренно, отдельным решением.
 *
 * @param {{ user?: any, isPro?: boolean, isDark?: boolean, onToggleTheme: () => void,
 *           onBrand?: () => void, onBack?: () => void, backTitle?: string,
 *           onMenu?: () => void, title?: any, meta?: any, isTrip?: boolean }} p
 */
export default function AppHeader({
  user,
  isPro,
  isDark,
  onToggleTheme,
  onBrand,
  onBack,
  backTitle,
  onMenu,
  title,
  meta,
  isTrip = false,
}) {
  const nav = useNavigate();
  const t = useT();
  const goBrand = onBrand || (() => nav('/trips'));
  const hasTrip = title != null || meta != null;

  return (
    <header className={'app-header' + (isTrip ? ' app-header--trip' : '')}>
      <div className="app-header__left">
        {onBack && (
          <button className="app-header__gbtn" onClick={onBack} title={backTitle} aria-label={backTitle || t('common.back')} type="button">
            <Icon name="back" size={17} />
          </button>
        )}
        {onMenu && (
          <button className="app-header__gbtn app-header__menu" onClick={onMenu} aria-label={t('common.menu')} type="button">
            <Icon name="list" size={18} />
          </button>
        )}

        {/* Внутри трипа слот тут НЕ рисуется: он уехал в шапку рейла (TripSidebar),
            где та же геометрия --rail-w × --header-h держит знак на месте. */}
        {!isTrip && (
          <>
            <BrandSlot onClick={goBrand} title="Triplanio" />
            <span className="app-header__brand-name" onClick={goBrand}>Triplanio</span>
          </>
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

      <div className="app-header__right">
        <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={onToggleTheme} />
      </div>
    </header>
  );
}
