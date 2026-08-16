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
// Uncontrolled by default (own open state); pass `defaultOpen` to start expanded.
//
// Props:
//   icon      — optional icon name → leading <Tile size="lg" tone={tone}>.
//   tone      — tile tone for `icon` (default 'info').
//   title     — header title (.t-label).
//   subtitle  — optional secondary line (.t-meta).
//   badge     — a number (renders the count pill when > 0) OR any ReactNode
//               (e.g. <Badge>), shown right-aligned before the chevron.
//   defaultOpen, children.
/**
 * @param {{
 *   icon?: string,
 *   tone?: string,
 *   title?: any,
 *   subtitle?: any,
 *   badge?: number | import('react').ReactNode,
 *   defaultOpen?: boolean,
 *   children?: any,
 * }} p
 */
export default function Accordion({ icon, tone = 'info', title, subtitle, badge = 0, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card radius="btn" pad="none" className={'acc' + (open ? ' is-open' : '')}>
      {/* .acc__head — ЗАГОЛОВОК аккордеона (full-bleed раскрывашка, hover --wash),
          не примитив-кнопка. */}
      <button type="button" className="acc__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon ? <Tile size="lg" tone={tone} icon={icon} /> : null}
        <span className="acc__titles">
          <span className="acc__title t-label">{title}</span>
          {subtitle ? <span className="acc__sub t-meta">{subtitle}</span> : null}
        </span>
        {typeof badge === 'number'
          ? (badge > 0 ? <span className="acc__badge t-meta">{badge}</span> : null)
          : badge}
        {/* Шеврон: вправо (свёрнут) → вниз (раскрыт), поворот в CSS (.acc.is-open). */}
        <span className="acc__chev"><Icon name="chevron" size={15} /></span>
      </button>
      {open ? <div className="acc__body">{children}</div> : null}
    </Card>
  );
}
