// ★ КНОПКА — ОТДЕЛЬНЫМ МОДУЛЕМ, А НЕ ВНУТРИ БАРРЕЛЯ (TRIP-475).
//
// `Btn` жил в `design/index.jsx` — файле на 1000 строк, который первой же
// строкой импортирует `@/components/ui/dialog`, а тот через `sheetShell` тянет
// `vaul`. Значит любой, кому нужна ОДНА КНОПКА, получал вместе с ней весь слой
// оверлеев: диалоги, шторки, radix. Для куки-баннера и страницы 404 — а они
// стоят на ЛЕНДИНГЕ — это десятки килобайт на критическом пути ни за что.
//
// Здесь только то, что кнопке действительно нужно: `Icon` и `Tooltip`, оба и так
// самостоятельные модули и ничего тяжёлого не тянут (`Tooltip` — свой, на
// портале, без radix и floating-ui).
//
// Баррель переэкспортирует `Btn` и `BTN_VARIANTS`, поэтому ~50 существующих
// вызывающих не тронуты: у них `import { Btn } from '@/design/index'` работает
// как работал. Прямой импорт `@/design/Btn` нужен только тем, кто живёт в
// синхронном графе лендинга.

import React from 'react';
import { Icon } from './icons';
import { Tooltip } from './Tooltip';

/**
 * @typedef {'primary'|'secondary'|'soft'|'quiet'|'link'|'dashed'|'danger'
 *   |'danger-solid'|'pro'|'ai'} BtnVariant
 */
// ── Карта оси `variant` — источник витрины `/kit` (TRIP-344). Тот же union,
// что типизирует проп: `variant="compact"` — ошибка типа у вызывателя под
// `// @ts-check`, а страница объекта полна по построению. Истинно единый
// источник (литеральный кортеж) даст перевод ДС в `.ts` — будущий шаг; в
// `.jsx` `as const` запрещён (TS8016), typedef+массив — компромисс.
// ⚠️ index.jsx без `// @ts-check`, поэтому `@type` тут не проверяется НА МЕСТЕ —
// проверка живёт у потребителя (`Kit` под прагмой) и в тесте дрейфа (сверка с CSS).
/** @type {readonly BtnVariant[]} */
export const BTN_VARIANTS = ["primary", "secondary", "soft", "quiet", "link", "dashed", "danger", "danger-solid", "pro", "ai"];
// ★★ ТОН ТЕПЕРЬ НАЗЫВАЕТСЯ ЯВНО, И ЭТО РЕШЕНИЕ, А НЕ ПОБОЧНЫЙ ЭФФЕКТ. Дефолтом
// был `ghost` — тон, который разбор УДАЛЯЕТ. Оставить дефолтом что угодно молча
// значило бы перекрасить каждый вызов без пропа, ничего не написав в дифф.
// Поэтому:
//   · в ТИПЕ `variant` обязателен — пропущенный проп краснеет у вызывающего под
//     `// @ts-check` и в пробе `props.test.js` (закрытый юнион ловит НЕВЕРНОЕ
//     значение, но НЕ ловит ОТСУТСТВИЕ: замерено на PR 2, где снятие `size`/
//     `tone` прошло lint, tsc и все тесты зелёными);
//   · в РАНТАЙМЕ остаётся `secondary` — файлов без прагмы в репозитории
//     большинство, и там пропущенный проп обязан дать рабочую кнопку, а не
//     `btn--undefined`. Значение выбрано не наугад: `secondary` — это ровно то,
//     куда разбор увёл `ghost`, и его объявления В ПОКОЕ побайтово совпадают с
//     базовым `.btn`, то есть до наведения «кнопка без тона» и «кнопка
//     secondary» неотличимы. ⚠️ Ровно до наведения: `.btn--secondary:hover`
//     заливается `--wash` и притемняет рамку, у голого `.btn` этого нет —
//     поэтому «одна и та же кнопка» тут сказать нельзя.
//
// ★ ФОРМА ПЛЕЙСХОЛДЕРА (`variant="dashed"`) СОБИРАЕТСЯ ЗДЕСЬ, А НЕ НА ЭКРАНЕ.
// Пунктирная «добавить» бывает ДВУХ обличий, и до разбора каждое было своим
// классом на своём экране (`.gadd`, `.te-cellbtn--ghost`, `.gadd--center`,
// `.bgt-glist__add`):
//   · с ПЛИТКОЙ-иконкой слева и растущей подписью (панель города, сервисы) —
//     `tile` + при необходимости `sub` со второй строкой;
//   · без плитки — иконка и подпись по центру («Добавить ещё город», «Трата»)
//     либо две иконки в размере `sm` (пустая ячейка редактора маршрута).
// Выравнивание НЕ задаётся `justify-content` (оно сломало бы центрированную
// форму): подпись в `.gt` растягивается сама, и содержимое встаёт слева ровно
// тогда, когда подпись есть.
/**
 * @param {{ variant: BtnVariant, size?: 'sm', icon?: string, iconRight?: string,
 *   tile?: boolean, sub?: any, block?: boolean, disabled?: boolean, loading?: boolean,
 *   children?: any, onClick?: any, onMouseDown?: any, className?: string, ariaLabel?: string,
 *   title?: string, ariaPressed?: boolean, ariaDisabled?: boolean, style?: any,
 *   locked?: boolean, lockedHint?: any }} p
 */
export const Btn = ({ variant = "secondary", size, icon, iconRight, tile, sub, block, disabled, loading, children, onClick, onMouseDown, className = "", ariaLabel, title, ariaPressed, ariaDisabled, style, locked, lockedHint }) => {
  // `locked` — действие недоступно текущей роли (наблюдателю). Не плодит класс:
  // приглушённый вид даёт существующий `.btn[aria-disabled]`, справа — замок,
  // клик подавлен, а причина висит тултипом. Один кирпич на все «viewer'у нельзя»
  // по всему приложению (TRIP-274 Ф2.2).
  // Правая иконка считается ЗДЕСЬ через if/else, а НЕ тернарником: `<Icon/> : …`
  // (элемент рядом с `:`) i18n-гард принимает за JSX-текст (ложное срабатывание).
  let rightIcon = null;
  if (locked) rightIcon = <Icon name="lock" size={14} />;
  else if (iconRight && !loading) rightIcon = <Icon name={iconRight} size={16} />;
  const btn = (
  <button
    // Дефолт <button> внутри формы — submit, поэтому любой вызов Btn, попавший
    // в <form>, отправлял бы её в довесок к своему onClick. Соседний Toggle
    // type="button" ставит и объясняет зачем — то есть про грабли знали, а на
    // самой кнопке системы их не закрыли (TRIP-344 PR 1).
    // ⚠️ Правка ПРОФИЛАКТИЧЕСКАЯ, живого дефекта не чинит и поведение сегодня не
    // меняет: <form> в репозитории ровно четыре (все в Login.jsx), и отправляют
    // их сырые <button type="submit">, а не Btn. Проверено грепом по всему src.
    type="button"
    className={`btn btn--${variant} ${size ? `btn--${size}` : ""} ${block ? "btn--block" : ""} ${className}`}
    onClick={locked ? undefined : onClick}
    // Forwarded so callers can suppress focus-steal (`e.preventDefault()` on a
    // mousedown keeps the on-screen keyboard up between sends) — без него проп
    // молча терялся и типы ругались (TS2322).
    onMouseDown={onMouseDown}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    aria-label={ariaLabel}
    aria-pressed={ariaPressed}
    // Полу-disabled: примитив выглядит приглушённым (`.btn[aria-disabled]`), но
    // НЕ получает атрибут `disabled` — остаётся кликабельным (клик раскрывает
    // валидацию). Заменяет инлайн `opacity` у вызывателя (TRIP-344). `locked`
    // тоже сюда: приглушён, но hover жив — иначе тултип-причина не всплыл бы.
    aria-disabled={ariaDisabled || locked || undefined}
    title={title}
    style={style}
  >
    {loading
      ? <span className="spin" />
      : (icon && (tile
        // Плитка красится вместе с рамкой сама: `.btn--dashed .gi` читает те же
        // `--bd`/`--fg`, которые ховер тона и меняет.
        ? <span className="gi"><Icon name={icon} size={17} /></span>
        : <Icon name={icon} size={16} />))}
    {/* Подпись растёт (`.gt` = flex:1 + min-width:0) ВСЕГДА, когда слева стоит
        плитка, а не только когда есть вторая строка: иначе форма с плиткой и
        однострочной подписью («Добавить активность») схлопнулась бы в центр. */}
    {(tile || sub) ? <span className="gt"><b>{children}</b>{sub && <span>{sub}</span>}</span> : children}
    {rightIcon}
  </button>
  );
  return locked && lockedHint ? <Tooltip content={lockedHint}>{btn}</Tooltip> : btn;
};
