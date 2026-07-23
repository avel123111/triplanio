import React, { forwardRef } from 'react';
import { ExternalLink } from 'lucide-react';

// Shared result card for the fork partner lists (Stay22 hotels + Viator
// activities) — these are the SAME element and must behave identically (TRIP-140
// unification). ONE interaction model lives here so the two lists can never drift
// apart again:
//   • click an unselected card        → select it (onSelect)
//   • click an already-selected card  → open the partner link (same as Book)
//   • the explicit Book button        → always opens the link
//   • hover                           → onHover(id | null) for map/list sync
//   • Enter/Space                     → same as click
// The visual shell (.pcard, in app.css) is shared; per-list content is injected
// through slots so hotels and activities keep their own body while sharing
// behaviour + chrome. `ref` forwards to the root so a list can scrollIntoView the
// selected card.
//
// TRIP-287 layout — CSS grid [photo | text] + full-width footer (price ↔ Book):
//   ┌──────────┬────────────────────────┐
//   │  thumb    │  name                 │   the score badge sits ON the photo;
//   │  (score   │  meta (stars · reviews)│   the footer spans both columns so the
//   │  badge)   │  subline (addr / …)   │   supplier logo · price ↔ Book stay one
//   ├──────────┴────────────────────────┤   row at any container width (26cqw thumb).
//   │  [logo] price        [ Book ↗ ]   │
//   └───────────────────────────────────┘
const PartnerResultCard = forwardRef(function PartnerResultCard({
  id,
  name,
  accent,            // CSS colour token for the thumb gradient (e.g. 'var(--ev-hotel)')
  icon,              // placeholder glyph shown under/instead of the image
  image,             // optional thumbnail src
  score = null,      // optional score badge pinned top-left on the photo
  supplier = null,   // optional supplier logo shown in the footer, left of the price
  meta = null,       // optional meta line under the name (stars · reviews / duration · reviews)
  subline = null,    // optional secondary line node (e.g. address / free cancellation)
  price = null,      // optional price node (rendered in the footer, left of Book)
  link,
  bookLabel,
  selected = false,
  hovered = false,
  onSelect,
  onHover,
  onOpen,            // called whenever the link is opened (click logging)
}, ref) {
  const open = () => {
    onOpen?.();
    if (link) window.open(link, '_blank', 'noopener,noreferrer');
  };
  // Second click on the already-selected card opens the link; first click selects.
  const handleCardClick = () => { if (selected) open(); else onSelect?.(id); };

  return (
    <div
      ref={ref}
      className={`pcard${selected ? ' is-sel' : ''}${hovered ? ' is-hover' : ''}`}
      role="button"
      tabIndex={0}
      onClick={handleCardClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick(); } }}
      onMouseEnter={() => onHover?.(id)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="pcard__thumb" style={{ '--pc-accent': accent }}>
        <div className="pcard__ph">{icon}</div>
        {image && <img src={image} alt={name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
        {score}
      </div>
      <div className="pcard__body">
        <div className="pcard__name">{name}</div>
        {meta}
        {subline}
      </div>
      {/* Footer spans both columns: supplier logo · price ↔ Book on one line at any
          width. Book always opens the link; stopPropagation so it never doubles as
          a card select/open. */}
      <div className="pcard__bar">
        {supplier}
        {price}
        <span className="pcard__spacer" />
        <a
          className="btn btn--primary btn--sm pcard__go"
          href={link}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
        >{bookLabel}<ExternalLink size={13} /></a>
      </div>
    </div>
  );
});

export default PartnerResultCard;
