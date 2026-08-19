import React, { useState } from 'react';
import { Card, Tile } from '@/design/index';
import { Icon } from '@/design/icons';

// Collapsible section (TRIP-176 event-form redesign; extended TRIP-337). A header
// row — optional leading tile-icon + title + optional subtitle + optional badge
// (count OR any node, e.g. a status pill) + chevron — toggles the body. Kept
// generic and bound to the design tokens (.acc*) so it can group any set of
// fields; the event editor uses it for "Booking details" / "Documents & notes",
// the account screen for the Telegram reminder channel.
//
// ОДИН канон-аккордеон на всё. TRIP-337 №4: layover-сегмент трансфера раньше
// повторял `.acc`-скин, но рисовал СВОЮ шапку/тело инлайн-стилями + lucide-шеврон;
// теперь он тоже проходит через этот компонент — через слоты `header`/`trailing`
// и управляемое состояние, без второй реализации.
//
// Uncontrolled by default (own open state); pass `defaultOpen` to start expanded,
// или `open` + `onToggle` для управляемого режима.
//
// Props:
//   icon      — optional icon name → leading <Tile size="lg" tone={tone}>.
//   tone      — tile tone for `icon` (default 'info').
//   title     — header title (.t-label).
//   subtitle  — optional secondary line (.t-meta).
//   badge     — a number (renders the count pill when > 0) OR any ReactNode
//               (e.g. <Badge>), shown right-aligned before the chevron.
//   header    — произвольная шапка ВМЕСТО icon/title/subtitle/badge (для богатых
//               заголовков вроде сегмента: плитка-тинт + eyebrow + маршрут). Должна
//               содержать растягивающийся элемент (`.grow`), чтобы шеврон ушёл вправо.
//   trailing  — узел СПРАВА ОТ переключателя, вне кнопки-заголовка (кнопка удаления
//               сегмента): её нельзя вложить внутрь <button> заголовка.
//   open, onToggle — управляемое состояние (если задан `open`, компонент им
//               управляется, а defaultOpen игнорируется).
//   defaultOpen, children.
/**
 * @param {{
 *   icon?: string,
 *   tone?: string,
 *   title?: any,
 *   subtitle?: any,
 *   badge?: number | import('react').ReactNode,
 *   header?: any,
 *   trailing?: any,
 *   open?: boolean,
 *   onToggle?: () => void,
 *   defaultOpen?: boolean,
 *   style?: any,
 *   children?: any,
 * }} p
 */
export default function Accordion({ icon, tone = 'info', title, subtitle, badge = 0, header, trailing, open: openProp, onToggle, defaultOpen = false, style, children }) {
  const [openState, setOpenState] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const toggle = () => { if (controlled) onToggle?.(); else setOpenState((o) => !o); };

  // .acc__head — ЗАГОЛОВОК аккордеона (full-bleed раскрывашка, hover --wash),
  // не примитив-кнопка.
  const head = (
    <button type="button" className={'acc__head' + (trailing ? ' grow' : '')} aria-expanded={open} onClick={toggle}>
      {header ?? (
        <>
          {icon ? <Tile size="lg" tone={tone} icon={icon} /> : null}
          <span className="acc__titles">
            <span className="acc__title t-label">{title}</span>
            {subtitle ? <span className="acc__sub t-meta">{subtitle}</span> : null}
          </span>
          {typeof badge === 'number'
            ? (badge > 0 ? <span className="acc__badge t-meta">{badge}</span> : null)
            : badge}
        </>
      )}
      {/* Шеврон: вправо (свёрнут) → вниз (раскрыт), поворот в CSS (.acc.is-open). */}
      <span className="acc__chev"><Icon name="chevron" size={15} /></span>
    </button>
  );

  return (
    <Card radius="btn" pad="none" style={style} className={'acc' + (open ? ' is-open' : '')}>
      {/* trailing (действие вне переключателя) → примитив `.row`: заголовок
          растягивается (scoped `.acc > .row > .acc__head`), действие прижато справа.
          Без trailing разметка байт-в-байт прежняя (голый `.acc__head`). */}
      {trailing ? <div className="row">{head}{trailing}</div> : head}
      {open ? <div className="acc__body">{children}</div> : null}
    </Card>
  );
}
