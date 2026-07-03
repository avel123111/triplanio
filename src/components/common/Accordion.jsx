import React, { useState } from 'react';
import { Icon } from '@/design/icons';

// Collapsible section (TRIP-176 event-form redesign). A header row — title +
// optional subtitle + optional count badge + chevron — toggles the body. Kept
// generic and bound to the design tokens (.acc*) so it can group any set of
// fields; the event editor uses it for "Booking details" and "Documents & notes".
//
// Uncontrolled by default (own open state); pass `defaultOpen` to start expanded.
export default function Accordion({ title, subtitle, badge = 0, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={'acc' + (open ? ' is-open' : '')}>
      <button type="button" className="acc__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="acc__titles">
          <span className="acc__title t-ui">{title}</span>
          {subtitle ? <span className="acc__sub t-meta">{subtitle}</span> : null}
        </span>
        {badge > 0 ? <span className="acc__badge t-meta">{badge}</span> : null}
        <span className="acc__chev"><Icon name="chev" size={15} /></span>
      </button>
      {open ? <div className="acc__body">{children}</div> : null}
    </div>
  );
}
