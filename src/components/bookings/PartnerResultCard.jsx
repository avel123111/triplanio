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
// through slots (thumb overlay, rating, subline, price) so hotels and activities
// keep their own body while sharing behaviour + chrome. `ref` forwards to the root
// so a list can scrollIntoView the selected card.
const PartnerResultCard = forwardRef(function PartnerResultCard({
  id,
  name,
  accent,            // CSS colour token for the thumb gradient (e.g. 'var(--ev-hotel)')
  icon,              // placeholder glyph shown under/instead of the image
  image,             // optional thumbnail src
  thumbOverlay = null, // optional node pinned in the thumb (e.g. supplier logo)
  rating = null,     // optional rating row node
  subline = null,    // optional secondary line node (e.g. address)
  price = null,      // optional price node (rendered on the left of the foot)
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
        {thumbOverlay}
      </div>
      <div className="pcard__body">
        <div className="pcard__name">{name}</div>
        {rating}
        {subline}
        <div className="pcard__foot">
          {price ?? <span />}
          {/* Book always opens the link; stopPropagation so it never doubles as a
              card select/open. */}
          <a
            className="btn btn--primary btn--sm"
            href={link}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => { e.stopPropagation(); onOpen?.(); }}
          >{bookLabel}<ExternalLink size={13} /></a>
        </div>
      </div>
    </div>
  );
});

export default PartnerResultCard;
