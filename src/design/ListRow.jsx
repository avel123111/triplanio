// @ts-check
import React from 'react';
import { Tile } from './Tile';
import { Icon } from './icons';

// ----- ListRow ----- (TRIP-413, объект «строка списка»)
// Строка списка: [лид] заголовок + подпись [трейл]. Лид и трейл — слоты
// (иконка-плитка / цветная точка / бейдж слева; сумма / поле / действия справа).
//
// ★ ЗАЧЕМ. Одна и та же строка рисовалась 4 раза под своими именами: траты
// (bgt-exrow), курсы (bgt-fxrow), категории (bgt-glist__row), легенда доната
// (bgt-dleg__row). Структура одна — отличались только СКИН и взаимодействие.
// Здесь структура одна, скин — ось `variant`, выбор — `selected`, клик — `onClick`.
//
// ★ СКИНЫ (`variant`): raised — приподнятая карточка (траты, hover-подъём);
// select — плоская выбираемая (категории, состояние on); divider — с нижней
// границей (курсы); compact — тесная (легенда); add — пунктирный add-плейсхолдер
// «создать ещё» (та же форма и высота, что у заполненного ряда, поэтому «добавить
// сервис/эвент» встаёт РОВНО в высоту карточки наличия — TRIP-337 visual-fixes;
// тон ховера — канал `--a`). Дефолт — без скина (голая строка).
//
// ★ ЗАГОЛОВОК/ПОДПИСЬ — канон текста (.t-label/.t-meta + .muted), не свои классы.
// Заголовок был на `.t-strong` — а это ОРТО-МОДИФИКАТОР (только вес), размер он
// не задаёт, поэтому строка наследовала кегль body: 15px/700 вместо канона
// подписи. Канон-инспектор TRIP-175 репортил это как `.lrow .t-strong` → Label;
// линза «Календарь» успела обойти титл вручную (`children` + `.t-meta`, см.
// CalendarLens.jsx) — обход по той же причине. Чиним в примитиве: 13px/600 у всех
// читателей сразу, форк ради одного экрана правилу #6 противоречит (апрув Pavel).
//
// ★ `trailSub` — ВТОРОСТЕПЕННАЯ половина трейла: она прячется на узком экране
// (≤600px), тогда как `trail` остаётся всегда. Заведено вместе со сносом
// `.tr*` — строка прошедшего трипа на главной несла дату, стопку аватаров и
// бейджи, и прятала их своей приватной утилитой `.tr-hideS` с `!important`.
// Прятать «всё лишнее на телефоне» приходится КАЖДОЙ насыщенной строке (те же
// ряды бюджета), поэтому это ось строки, а не утилита одного экрана.
//
// ★ `muted` — приглушённая строка (архив, неактивное). Скин один: opacity на
// строке целиком, чтобы приглушались и обложка, и бейджи, а не только текст.
/** @typedef {'raised'|'select'|'divider'|'compact'|'add'} ListRowVariant */
export const ListRow = React.forwardRef(
  /**
   * @param {{
   *   lead?: any, title?: any, sub?: any, trail?: any, trailSub?: any,
   *   variant?: ListRowVariant, muted?: boolean,
   *   onClick?: any, selected?: boolean, className?: string, children?: any,
   * } & Record<string, any>} p
   */
  ({ lead, title, sub, trail, trailSub, variant, muted, onClick, selected, className = "", children, ...rest }, ref) => {
    const clickable = !!onClick;
    const El = /** @type {any} */ (clickable ? "button" : "div");
    return (
      <El
        ref={ref}
        type={clickable ? "button" : undefined}
        onClick={onClick}
        className={[
          "lrow",
          variant && `lrow--${variant}`,
          clickable && "lrow--clickable",
          selected && "lrow--on",
          muted && "lrow--muted",
          className,
        ].filter(Boolean).join(" ")}
        {...rest}
      >
        {lead}
        <div className="lrow__body">
          {title != null && <div className="t-label">{title}</div>}
          {sub != null && <div className="t-meta muted">{sub}</div>}
          {children}
        </div>
        {(trail != null || trailSub != null) && (
          <div className="lrow__trail">
            {trailSub != null && <span className="lrow__trail-s">{trailSub}</span>}
            {trail}
          </div>
        )}
      </El>
    );
  },
);
ListRow.displayName = "ListRow";

/** @type {readonly ListRowVariant[]} */
export const LISTROW_VARIANTS = ["raised", "select", "divider", "compact", "add"];

// ----- AddRow ----- «этого ещё нет»
// Сведение трёх одинаковых локальных обёрток над `<ListRow variant="add">`
// (панель города, сервисы, «Подготовка»). Тон ховера `--a` приходит из данных
// (вид того, чего не хватает: отель · переезд · сервис), поэтому стиль — функцией.
/** @param {string} [accent] */
const addTone = (accent) => ({ "--a": accent || "var(--brand)" });

export const AddRow = React.forwardRef(
  /**
   * @param {{ icon?: string, title?: any, sub?: any, accent?: string,
   *   onClick?: any, className?: string }} p
   */
  ({ icon = "plus", title, sub, accent, onClick, className = "" }, ref) => (
    <ListRow
      ref={ref}
      variant="add"
      className={className}
      lead={<Tile tone="quiet" icon={icon} />}
      title={title}
      sub={sub || undefined}
      trail={<Icon name="plus" size={16} />}
      style={addTone(accent)}
      onClick={onClick}
    />
  ),
);
AddRow.displayName = "AddRow";
