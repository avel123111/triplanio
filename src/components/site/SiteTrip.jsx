import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { useT } from '@/lib/i18n/I18nContext';
import { track, withVisitCampaign } from '@/lib/analytics';
import { hashStr } from '@/lib/hash';
import { Icon } from '@/design/icons';

/* =========================================================================
   SiteTrip — three prototype sections of the public shared-trip page, born
   here (TRIP-461) under ONE real consumer (PublicTrip). No "future" props:
   each takes exactly the data the prototype's markup binds. The second
   consumer is the demo (TRIP-462), where the real commonality is measured —
   if it turns out small, these stay concrete rather than growing flag props.

   Markup + class names are the prototype v5.7 verbatim (`pt-*`); the sprite
   symbols (`#i-*`, `#tl-logo`) already live in the DOM via <SiteHeader>'s
   <LandingSprite>. No `@/design/*` imports (check-ds-boundary).
   ========================================================================= */

const APP_URL = '/login';
// Stat-strip icons from the app design system (@/design/icons — allowed off
// check-ds-boundary), so the shared summary matches the product, not a sprite.
const STAT_ICON = { 'i-globe2': 'globe', 'i-pin2': 'pin', 'i-swap': 'arrowSwap', 'i-cal2': 'calendar', 'i-route': 'route' };
const Ic = ({ id }) => <Icon name={STAT_ICON[id] || 'info'} size={20} />;

// Avatar fallback (no photo): initials + a deterministic colour by name.
// Colour uses the SAME hash primitive as the app's <Avatar> (src/lib/hash), so
// the seam is shared — only the PALETTE differs (.pt-av--0..5 in site.css are
// AA-safe pale-bg/dark-ink pairs; the app's avatarRamp is white-on-gradient,
// which failed contrast at 2.05 on prod — TRIP-451 §13). We cannot reuse
// <Avatar> itself: check-ds-boundary bans @/design in the zone, and the public
// payload strips user_id (no stable seed), so name is the only seed available.
const AV_COUNT = 6;
function avatarFace(name) {
  const ini = String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return { idx: hashStr(name) % AV_COUNT, ini };
}

/**
 * Cover masthead — dark hero photo + gradient, eyebrow, title, date line.
 * `data-hdr="dark"` makes the themed SiteHeader tint itself over the cover.
 */
export function SiteHero({ cover, kicker, title, dates }) {
  return (
    <section className="pt-hero" data-hdr="dark">
      <img className="pt-hero-img" alt="" src={cover} />
      <div className="wrap">
        <span className="brow">{kicker}</span>
        <h1>{title}</h1>
        {dates && <div className="pt-dates">{dates}</div>}
      </div>
    </section>
  );
}

/**
 * Summary card floating over the cover: five stat tiles, then the travellers
 * row. `stats` = [{ icon, n, unit?, k }]; `people` = [{ photo, name, title }]
 * (title = full name → avatar seed + tooltip; face colour/initials via avatarFace).
 */
export function SiteSummary({ stats, peopleTitle, peopleCount, people }) {
  return (
    <div className="wrap pt-summary">
      <div className="pt-card">
        <div className="pt-stats">
          {stats.map((s, i) => (
            <div className="pt-stat" key={i}>
              <span className="pt-stat-ic"><Ic id={s.icon} /></span>
              <span>
                <span className="pt-n tnum">{s.n}{s.unit && <small>{s.unit}</small>}</span>
                <span className="pt-k">{s.k}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {people.length > 0 && (
        <div className="pt-people">
          <div className="pt-people-hd">
            <h2>{peopleTitle}</h2>
            <span className="pt-c">{peopleCount}</span>
          </div>
          <ul className="pt-plist">
            {people.map((p, i) => {
              const face = avatarFace(p.title);
              return (
              <li className="pt-person" title={p.title} key={i}>
                <span className={`pt-av pt-av--${face.idx}`}>
                  {/* Реальное фото участника, если есть (getPublicTrip отдаёт avatar_url);
                      иначе инициалы на контрастной паре (цвет по хэшу имени — тот же
                      примитив hashStr, что у app-<Avatar>). Без user_id сид = имя. */}
                  {p.photo ? <img src={p.photo} alt="" loading="lazy" onError={(e) => { e.currentTarget.remove(); }} /> : face.ini}
                </span>
                <span>{p.name}</span>
              </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Final call-to-action — the SAME accent sheet as the landing (`fin.*` keys,
 * `data-hdr="accent"` is the one producer of the 9 on-accent header rules).
 * Parameterless: the prototype reuses the landing's CTA verbatim on this page.
 */
export function SiteCta() {
  const t = useT();
  const nav = useNavigate();
  const { isAuthenticated } = useAuth();
  const ctaTarget = isAuthenticated ? '/trips' : withVisitCampaign(APP_URL);
  return (
    <section className="final dark sheet-pane section-pad" data-hdr="accent" id="cta">
      <span className="horizon" aria-hidden="true" />
      <div className="wrap inner">
        <div className="rv">
          <span className="brow" style={{ justifyContent: 'center' }}>{t('landing.fin.eyebrow')}</span>{/* inline-style-exempt: prototype's own one-off centering */}
          <h2 style={{ marginTop: '14px' }} dangerouslySetInnerHTML={{ __html: t('landing.fin.h2') }} />{/* inline-style-exempt: prototype's own one-off spacing */}
          <p>{t('landing.fin.sub')}</p>
          <div className="ctas">
            <a className="btn btn-light" href={ctaTarget} onClick={(e) => { e.preventDefault(); track('cta_clicked', { location: 'final' }); nav(ctaTarget); }}>
              <span>{t('landing.fin.cta1')}</span>
              <svg width="18" height="18" aria-hidden="true"><use href="#i-arrow-r" /></svg>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
