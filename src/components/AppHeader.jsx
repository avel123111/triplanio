import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import HeaderActions from '@/components/HeaderActions';
import { Tooltip } from '@/design/index';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Бренд-СЛОТ — бокс `--rail-w × --header-h` в левом верхнем углу экрана.
 *
 * ДОМ У НЕГО ТЕПЕРЬ ОДИН: первая ячейка шапки, и шапка одна на все экраны,
 * включая трип. Раньше домов было два (шапка вне трипа и шапка рейла внутри
 * него), и ровно поэтому геометрия слота держалась ЧИСЛАМИ — знак обязан был не
 * прыгнуть при переходе между двумя разными узлами DOM. Инвариант больше не
 * нужен как страховка, но размер слота остаётся: он задаёт левое поле шапки на
 * всех экранах разом (у самой шапки поля слева нет).
 *
 * Второго лица (стрелки выхода по наведению) у слота больше нет: выход из трипа
 * — круглая кнопка «назад» слева от знака, на всех ширинах. Пока рейл занимал
 * весь левый борт, кнопке там было не место, и выход прятался в знак; теперь
 * шапка идёт во всю ширину, и прятать его не за чем.
 *
 * @param {{ onClick: () => void, title?: string }} p
 */
export function BrandSlot({ onClick, title }) {
  const slot = (
    <button
      className="app-header__brand"
      onClick={onClick}
      aria-label={title}
      type="button"
    >
      <span className="app-header__logo">
        <img src="/triplanio-logo.svg" alt="Triplanio" />{/* i18n-ignore — имя бренда в alt */}
      </span>
    </button>
  );
  // Подсказка — примитив ДС, а не браузерный `title`: тот рисуется системой,
  // приезжает с задержкой в секунду и не знает ни темы, ни типографики. `block`
  // обязателен — обёртка стоит колонкой в рейле и без него сожмётся по контенту.
  // Пузырь снизу: слот прижат к верхней кромке, сверху ему места нет.
  return title ? <Tooltip content={title} side="bottom" block>{slot}</Tooltip> : slot;
}

/**
 * Unified top bar (brand gradient) used across the whole app.
 *
 * Replaces the old white `.app-header` AND the separate gradient hero
 * (`.trip-hero` / TripHeaderBar): both rows collapse into a single branded
 * bar. The trip title, meta and trip-action buttons now live here, separated
 * from the brand block and from the utility cluster by vertical dividers.
 *
 *   [back*] logo · Triplanio │ <trip title + meta> │ theme · bell · account+PRO
 *     back  — round back/exit button, rendered when `onBack` is provided
 *     trip  — title / meta render only when a trip context is given
 *
 * Trip actions (Share / Edit / Settings / Members / Copy) live in the left trip
 * menu (TripSidebar), NOT in this header. PRO badge + utility icons come from
 * <HeaderActions>.
 *
 * Шапка идёт ВО ВСЮ ШИРИНУ экрана, в том числе внутри трипа: меню трипа висит
 * ПОД ней плавающим виджетом, а не занимает левый борт целиком. Поэтому бренд
 * рисуется здесь всегда, а `isTrip` остался только модификатором облика.
 *
 * Props:
 *   user, isPro, isDark, onToggleTheme — forwarded to the right-hand cluster
 *   onBrand   — click handler for the logo/brand (defaults to nav('/trips'))
 *   onBack    — optional; renders the round back button when set
 *   backTitle — tooltip / aria-label for the back button
 *   title     — optional trip title (enables the trip block)
 *   meta      — optional trip meta node (e.g. dates · days · cities)
 */
/**
 * ⚠️ Аннотация обязательна: без неё TS выводит тип из ДЕСТРУКТУРИЗАЦИИ и делает
 * КАЖДЫЙ проп без дефолта ОБЯЗАТЕЛЬНЫМ, поэтому законный вызов без `onBrand` /
 * `meta` (опциональны — у `onBrand` даже есть фолбэк
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
 * стоит под `{isPro && …}`, `onBack`/`meta` - под условием, `onBrand` и
 * `title` имеют фолбэк. Пограничный случай назван вслух: `isDark` выбирает
 * ЗНАЧОК (`isDark ? 'sun' : 'moon'`), без него кнопка работает, но может
 * показать не тот значок; все 7 вызывателей его передают, так что ужесточение
 * было бы бесплатным - оставлено необязательным намеренно, отдельным решением.
 *
 * @param {{ user?: any, isPro?: boolean, isDark?: boolean, onToggleTheme: () => void,
 *           onBrand?: () => void, onBack?: () => void, backTitle?: string,
 *           title?: any, meta?: any, isTrip?: boolean }} p
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

        {/* Знак стоит в шапке на ЛЮБОМ экране, трип не исключение: шапка идёт во
            всю ширину, и первым в ней — бренд. Подсказки у слота нет намеренно:
            рядом стоит само слово. */}
        <BrandSlot onClick={goBrand} />
        <button className="app-header__brand-name" onClick={goBrand} type="button">Triplanio</button>{/* i18n-ignore — имя бренда */}

        {hasTrip && (
          <>
            <span className="app-header__vdiv" />
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
