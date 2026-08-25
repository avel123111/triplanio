import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { invokeFn } from '@/lib/invokeFn';
import { track, setRefTripId, withVisitCampaign } from '@/lib/analytics';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import {
  SiteHeader, SiteFooter, useSiteCss, useSiteTheme, useDocumentMeta,
} from '@/components/site/SiteChrome';
import { SiteHero, SiteSummary, SiteCta } from '@/components/site/SiteTrip';
import MapView from '@/components/views/MapView';
import { Icon } from '@/design/icons';
import { transferKind } from '@/lib/transport';
import { sortVisits } from '@/lib/validation';
import { localizeVisits } from '@/lib/trip-cities';
import { tripStats, tripDateSpan } from '@/lib/trip-stats';
import { formatDuration } from '@/lib/time';
import { formatDateRange } from '@/lib/trip-dates';

// floor-exempt: dsshare +43 — эта страница переехала с app-ДС (Avatar/Card) на
// сайтовую ДС прототипа (public/site.css, pt-*): доля app-ДС падает намеренно —
// это направление неавторизованной зоны, а не регресс. Апрув Pavel (1в1
// прототип, TRIP-461). Маркер живёт в src/ (гард 2o читает только src/).

// Prototype v5.7 carried the cover inline; the fallback is a repo asset
// (TRIP-451 §11). No design-system import — the literal path is the reuse.
const COVER_FALLBACK = '/covers/fallback.webp';

// Where the marketing chrome's brand / CTAs point when this page renders off
// the landing route: our OWN origin (the campaign mark is stored per host —
// analytics.js — so a link leaving for another host strands it). Every host
// serving this route serves the landing at `/` too (one SPA). Every link built
// off SITE replaces the document, dropping the in-memory attribution snapshot —
// and a visitor here arrived on a marked share link, exactly the new person the
// mark exists for, so the marks ride the address across (TRIP-329).
const SITE = withVisitCampaign(`${window.location.origin}/`);

// Avatar colour = one of six contrast-safe pairs (defined as .pt-av--0..5 in
// site.css; white initials on the orange gradient gave 2.05 on prod, TRIP-451
// §13). Prototype's avatarOf hash, but the colour rides a class, not inline hex.
const AV_COUNT = 6;
function avatarPair(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ini = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return { idx: h % AV_COUNT, ini };
}

const Ic = ({ id }) => <svg aria-hidden="true"><use href={`#${id}`} /></svg>;

function FlagImg({ cc }) {
  const code = (cc || '').trim().toLowerCase();
  if (!code) return null;
  return (
    <img className="cflag" src={`/flags/${code}.svg`} alt="" loading="lazy"
      onError={(e) => { e.currentTarget.style.display = 'none'; }} />
  );
}

// Role badge glyph for map-anchor stops — the flag symbol shared with the map
// pins. (Prototype renders `#i-flag` inside the numbered pin for start/end.)
const FlagGlyph = () => <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-flag" /></svg>;

export default function PublicTrip() {
  const { lang, setLang } = useI18n();
  const { t, fmtDate, plural, fmtDistance, fmtCountry } = useI18nFormat();
  const cssReady = useSiteCss();
  // The public reader follows the landing: light-only, restored on exit.
  useSiteTheme();

  const { tripId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t') || '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-trip', tripId, token],
    queryFn: async () => {
      const res = await invokeFn('getPublicTrip', { body: { tripId, token } });
      if (res.error) throw res.error;
      return res.data;
    },
    enabled: !!tripId && !!token,
    retry: false,
  });

  const trip = data?.trip;

  // Virality: public view + remember the trip as a referral source (K-factor).
  useEffect(() => {
    if (!tripId || !trip) return;
    setRefTripId(tripId);
    track('public_trip_viewed', { trip_id: tripId });
  }, [tripId, trip]);

  useDocumentMeta(trip?.title ? `${trip.title} · Triplanio` : null, null);

  const owner = data?.owner || null;
  const members = useMemo(() => data?.members || [], [data]);
  const visits = useMemo(() => localizeVisits(data?.visits || [], lang), [data, lang]);
  const transfers = useMemo(() => data?.transfers || [], [data]);
  const ordered = useMemo(() => sortVisits(visits), [visits]);

  const fmt = (d) => (d ? fmtDate(d, 'utc', 'd MMM') : '');

  // Participants = owner first, then active members (deduping the owner, matched
  // by name — the payload gives the owner no id). Names become prototype avatars:
  // first name, plus a last initial ONLY when the first name repeats.
  const people = useMemo(() => {
    const raw = [];
    if (owner?.display_name) raw.push({ full: owner.display_name, photo: owner.avatar_url || '' });
    members.forEach((m) => {
      if (owner?.display_name && m.display_name === owner.display_name) return;
      if (m.display_name) raw.push({ full: m.display_name, photo: m.avatar_url || '' });
    });
    const firsts = raw.map((p) => p.full.trim().split(/\s+/)[0]);
    return raw.map((p, i) => {
      const parts = p.full.trim().split(/\s+/);
      const dup = firsts.filter((f) => f === firsts[i]).length > 1;
      const name = dup && parts[1] ? `${firsts[i]} ${parts[1][0]}.` : firsts[i];
      return { ...avatarPair(p.full), photo: p.photo, name, title: p.full };
    });
  }, [owner, members]);

  // The whole route in trip order: start anchor, transit cities (numbered),
  // pass-through waypoints, end anchor. Only transit cities carry a number.
  const stops = useMemo(() => {
    let transitNo = 0;
    return ordered.map((v) => {
      const kind = v.kind === 'start' || v.kind === 'end' || v.kind === 'waypoint' ? v.kind : 'transit';
      const isTransit = kind === 'transit';
      const start = v.start_date;
      const end = v.end_date;
      const nights = start && end ? Math.max(0, Math.round((new Date(end) - new Date(start)) / 86_400_000)) : 0;
      return {
        id: v.id,
        kind,
        isTransit,
        n: isTransit ? ++transitNo : null,
        city: v.city_name,
        country: fmtCountry(v.country_code) || '',
        cc: v.country_code || '',
        start,
        end,
        nights,
      };
    });
  }, [ordered, fmtCountry]);

  // Incoming transfer leg between the previous stop and this one, for the pill.
  const legFor = (a, b) => {
    const tr = transfers.find((x) => x.from_city_visit_id === a.id && x.to_city_visit_id === b.id && x.start_datetime);
    if (!tr) return null;
    const type = tr.transport_type || 'other';
    const fromV = ordered.find((v) => v.id === a.id);
    const toV = ordered.find((v) => v.id === b.id);
    // Transport glyph from the real app icon set (shared with the planner/map),
    // not a prototype-only sprite — via the design <Icon> allowed off @/design/icons.
    return {
      icon: transferKind(type).icon,
      label: t(`public.mode_${type}`) || type,
      dur: formatDuration(tr.start_datetime, tr.end_datetime, fromV?.timezone, toV?.timezone),
    };
  };

  const stats = useMemo(() => tripStats({ visits, transfers, trip, orderedVisits: ordered }), [visits, transfers, trip, ordered]);
  const [spanStart, spanEnd] = useMemo(() => tripDateSpan(trip, visits), [trip, visits]);

  // Map ↔ list two-way sync (canonical, like the Overview map): hovering/clicking
  // a pin lifts the city badge; clicking a pin or a stop selects it (toggle),
  // clicking empty map clears. The active stop gets `.is-on`.
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const badgeId = hoveredId ?? selectedId;
  const cityBadge = useMemo(() => {
    if (badgeId == null) return null;
    const v = visits.find((x) => String(x.id) === String(badgeId));
    if (!v || v.latitude == null || v.longitude == null) return null;
    return {
      lng: v.longitude, lat: v.latitude, countryCode: v.country_code, name: v.city_name,
      dates: formatDateRange(v.start_date, v.end_date, (iso) => fmtDate(iso, undefined, 'd MMM')),
    };
  }, [badgeId, visits, fmtDate]);

  // Selecting a city (from either side) scrolls its stop into view.
  useEffect(() => {
    if (selectedId == null) return;
    const el = document.querySelector(`.pt-stop[data-id="${selectedId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedId]);

  // Prototype toggles `body.pt-open` (mist page background). Ported as a body
  // class the way SiteHeader ports `body.mobile-open`.
  useEffect(() => {
    document.body.classList.add('pt-open');
    return () => document.body.classList.remove('pt-open');
  }, []);

  // Reveal .rv blocks (the shared final CTA) — the SAME one-shot fade the landing
  // uses; without it .rv stays at opacity:0 and the CTA renders blank.
  useEffect(() => {
    if (!cssReady) return undefined;
    const targets = [...document.querySelectorAll('.rv,.rv-l,.rv-r')];
    if (!targets.length) return undefined;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) en.target.classList.add('in');
        else if (en.boundingClientRect.top > 0) en.target.classList.remove('in');
      });
    }, { threshold: 0.16, rootMargin: '0px 0px -5% 0px' });
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cssReady, trip]);

  // The route rail must start at the first pin and END at the last — a fixed
  // top/bottom inset overshoots past the finish pin (variable stop heights). We
  // measure the first/last pin centres and drive the rail via CSS vars.
  const routeRef = useRef(null);
  useEffect(() => {
    const route = routeRef.current;
    if (!route) return undefined;
    const measure = () => {
      const pins = route.querySelectorAll('.pt-pin');
      if (!pins.length) return;
      const r = route.getBoundingClientRect();
      const first = pins[0].getBoundingClientRect();
      const last = pins[pins.length - 1].getBoundingClientRect();
      const top = first.top + first.height / 2 - r.top;
      const bottom = last.top + last.height / 2 - r.top;
      route.style.setProperty('--pt-rail-top', `${Math.round(top)}px`);
      route.style.setProperty('--pt-rail-h', `${Math.max(0, Math.round(bottom - top))}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(route);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [stops]);

  if (!cssReady) return null;
  if (!token) return <Shell lang={lang} setLang={setLang}><NotFound message={t('public.invalid_link')} t={t} /></Shell>;
  if (isLoading) return <Shell lang={lang} setLang={setLang}><div className="pt-center"><div className="pt-spin" /></div></Shell>;
  if (error || !trip) return <Shell lang={lang} setLang={setLang}><NotFound message={t('public.not_found')} t={t} /></Shell>;

  // Within one month the mockup drops the repeated month ("4 – 16 Jul"); across
  // months both ends are spelled out ("28 Jun – 4 Jul").
  const dateRange = (() => {
    if (!spanStart || !spanEnd) return '';
    const full = formatDateRange(spanStart, spanEnd, fmt);
    if (full === fmt(spanEnd)) return full;
    const a = new Date(spanStart);
    const b = new Date(spanEnd);
    const sameMonth = a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
    return sameMonth ? `${a.getUTCDate()} – ${fmt(spanEnd)}` : full;
  })();

  const dist = stats.distanceKm > 0 ? fmtDistance(stats.distanceKm) : null;
  const statTiles = [
    { icon: 'i-globe2', n: stats.countries, k: t('public.meta_countries') },
    { icon: 'i-pin2', n: stats.cities, k: t('public.meta_cities') },
    { icon: 'i-swap', n: stats.transfers, k: t('public.meta_transfers') },
    { icon: 'i-cal2', n: stats.days, k: plural(stats.days, 'public.subtitle_days') },
    ...(dist ? [{ icon: 'i-route', n: dist.value, unit: dist.unit, k: t('public.meta_distance') }] : []),
  ];

  const onCityClick = (pts) => { const v = pts?.[0]; if (v) setSelectedId((cur) => (cur === v.id ? null : v.id)); };
  const pickStop = (id) => setSelectedId((cur) => (cur === id ? null : id));

  return (
    <>
      <SiteHeader lang={lang} setLang={setLang} variant="cta" themed navBase={SITE} brandHref={SITE} />

      <main className="pt">
        <SiteHero
          cover={trip.cover_image_url || COVER_FALLBACK}
          kicker={t('public.mast_kick')}
          title={trip.title}
          dates={dateRange}
        />

        <SiteSummary
          stats={statTiles}
          peopleTitle={t('public.people_title')}
          peopleCount={people.length > 0 ? `${people.length} ${plural(people.length, 'public.people')}` : ''}
          people={people}
        />

        <div className="wrap">
          <div className="pt-grid">
            <section>
              <div className="pt-colh">
                <h2>{t('public.route')}</h2>
                <span className="pt-c">{stops.filter((s) => s.isTransit).length} {plural(stops.filter((s) => s.isTransit).length, 'public.stops')}</span>
              </div>
              <div className="pt-route" ref={routeRef}>
                {stops.map((s, i) => {
                  const leg = i > 0 ? legFor(stops[i - 1], s) : null;
                  const on = selectedId === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      {leg && (
                        <div className="pt-leg">
                          <span className="pt-legic"><Icon name={leg.icon} size={16} /></span>
                          <b>{leg.label}</b>
                          {leg.dur && <><span className="pt-dot" /><span className="tnum">{leg.dur}</span></>}
                        </div>
                      )}
                      {s.kind === 'waypoint' ? (
                        <div className={`pt-stop pt-stop--wp${on ? ' is-on' : ''}`} data-id={s.id} tabIndex={0} role="button"
                          onClick={() => pickStop(s.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickStop(s.id); } }}>
                          <span className="pt-pin" />
                          <FlagImg cc={s.cc} />
                          <span className="pt-city">{s.city}</span>
                          <span className="pt-wptag">{t('public.role_waypoint')}</span>
                        </div>
                      ) : (
                        <article className={`pt-stop${s.isTransit ? '' : ' pt-stop--anchor'}${on ? ' is-on' : ''}`} data-id={s.id} tabIndex={0} role="button"
                          onClick={() => pickStop(s.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickStop(s.id); } }}>
                          <span className="pt-pin">{s.isTransit ? s.n : <FlagGlyph />}</span>
                          <div className="pt-top">
                            <h3 className="pt-city">{s.city}</h3>
                          </div>
                          <div className="pt-meta">
                            <span className="pt-country"><FlagImg cc={s.cc} />{s.country}</span>
                            {(s.start || s.end) && <><span className="pt-dot" /><span className="pt-when tnum">{fmt(s.start)} → {fmt(s.end)}</span></>}
                            {s.nights > 0 && (
                              <span className="pt-nights"><Ic id="i-moon" /><span className="tnum">{s.nights}</span> {plural(s.nights, 'public.nights')}</span>
                            )}
                            {/* Роль-бейдж (Старт/Финиш) — внизу карточки, в одном ряду с бейджем ночей (фидбэк Pavel) */}
                            {!s.isTransit && <span className={`pt-tag pt-tag--${s.kind}`}>{t(`public.role_${s.kind}`)}</span>}
                          </div>
                        </article>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </section>

            <aside className="pt-mapcol">
              <div className="pt-mapbox">
                <MapView
                  visits={visits}
                  transfers={transfers}
                  colorScheme="LIGHT"
                  initialProjection="globe"
                  mapControls={false}
                  active
                  hoveredVisitId={hoveredId}
                  selectedVisitId={selectedId}
                  cityBadge={cityBadge}
                  onCityHover={(pts) => setHoveredId(pts ? (pts[0]?.id ?? null) : null)}
                  onCityClick={onCityClick}
                  onMapClick={() => setSelectedId(null)}
                />
              </div>
            </aside>
          </div>
        </div>

        <SiteCta />
      </main>

      <SiteFooter lang={lang} setLang={setLang} brandHref={SITE} />
    </>
  );
}

function Shell({ lang, setLang, children }) {
  return (
    <>
      <SiteHeader lang={lang} setLang={setLang} variant="cta" navBase={SITE} brandHref={SITE} />
      <main className="pt">{children}</main>
      <SiteFooter lang={lang} setLang={setLang} brandHref={SITE} />
    </>
  );
}

function NotFound({ message, t }) {
  return (
    <div className="pt-center">
      <div>
        <svg width="26" height="26" aria-hidden="true"><use href="#i-pinoff" /></svg>
        <h1>{t('public.oops')}</h1>
        <p className="muted">{message}</p>
      </div>
    </div>
  );
}
