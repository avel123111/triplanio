import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plane } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { SiteHeader, SiteFooter, useLandingCss } from '@/components/site/SiteChrome';
import MapView from '@/components/views/MapView';
import { sortVisits } from '@/lib/validation';
import { localizeVisits } from '@/lib/trip-cities';
import { tripStats, tripDateSpan } from '@/lib/trip-stats';
import { transportInfo } from '@/lib/transport';
import { formatDuration } from '@/lib/time';
import './PublicTrip.css';

// Where the marketing chrome's section anchors / brand should point when this
// page is rendered off the landing route.
const SITE = 'https://triplanio.com/';
// Per-city accent cycle — all existing Lumo event/accent tokens (no new tokens).
const ACCENTS = ['var(--brand)', 'var(--ev-activity)', 'var(--ev-car)', 'var(--ai)', 'var(--pro)', 'var(--ev-transfer)'];

const initials = (name = '') =>
  name.split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();

// Role badge glyph for the anchors / waypoint — the SAME paths the map markers
// use (src/lib/map/markers.js), so the timeline badge and the map pin read as the
// same symbol. start/end = flag; waypoint = interchange arrows.
function RoleGlyph({ kind }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === 'waypoint' ? (
        <path d="M7 7h13l-4-4M17 17H4l4 4" />
      ) : (
        <><path d="M5 3v18" /><path d="M5 4h12l-2 4 2 4H5" /></>
      )}
    </svg>
  );
}

function FlagImg({ cc, className }) {
  const code = (cc || '').trim().toLowerCase();
  if (!code) return null;
  return (
    <img
      src={`/flags/${code}.svg`}
      alt=""
      loading="lazy"
      className={className}
      onError={(e) => { e.currentTarget.style.display = 'none'; }}
    />
  );
}

export default function PublicTrip() {
  const { lang, setLang } = useI18n();
  const { t, fmtDate, plural, locale, fmtDistance } = useI18nFormat();
  const cssReady = useLandingCss();

  const { tripId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t') || '';

  // The public reader follows the landing: light theme only.
  useEffect(() => {
    const r = document.documentElement;
    r.classList.remove('dark');
    r.setAttribute('data-theme', 'light');
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-trip', tripId, token],
    queryFn: async () => {
      const res = await supabase.functions.invoke('getPublicTrip', { body: { tripId, token } });
      if (res.error) throw res.error;
      return res.data;
    },
    enabled: !!tripId && !!token,
    retry: false,
  });

  const trip = data?.trip;
  const owner = data?.owner || null;
  const members = data?.members || [];
  // Participants list = trip owner FIRST, then active members (dedupe the owner
  // if they also appear among members). Owner payload has no id, so match by name.
  const people = useMemo(() => {
    const list = [];
    if (owner?.display_name) list.push({ display_name: owner.display_name, avatar_url: owner.avatar_url });
    members.forEach((m) => {
      if (owner?.display_name && m.display_name === owner.display_name) return;
      list.push(m);
    });
    return list;
  }, [owner, members]);
  const visits = useMemo(() => localizeVisits(data?.visits || [], lang), [data, lang]);
  const hotels = useMemo(() => data?.hotels || [], [data]);
  const transfers = useMemo(() => data?.transfers || [], [data]);
  const activities = useMemo(() => data?.activities || [], [data]);

  const ordered = useMemo(() => sortVisits(visits), [visits]);

  const fmt = (d) => (d ? fmtDate(d, 'utc', 'd MMM') : '');

  // Build the itinerary stops — now the WHOLE route, in trip order: the start
  // anchor, transit cities, pass-through waypoints and the end anchor. Only
  // transit cities carry a sequential number (1,2,3…); start/end render as
  // anchor pills and waypoints as a slim "ghost" row (mirrors the map markers).
  const stops = useMemo(() => {
    let transitNo = 0;
    return ordered.map((v) => {
      const kind = v.kind === 'start' || v.kind === 'end' || v.kind === 'waypoint' ? v.kind : 'transit';
      const isTransit = kind === 'transit';
      const n = isTransit ? ++transitNo : null;
      const start = v.start_date;
      const end = v.end_date;
      const nights = start && end
        ? Math.max(0, Math.round((new Date(end) - new Date(start)) / 86_400_000))
        : 0;
      const hotel = hotels.find((h) => h.city_visit_id === v.id) || null;
      const acts = activities
        .filter((a) => a.city_visit_id === v.id && a.start_datetime)
        .sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime))
        .map((a) => ({ nm: a.title, day: fmt(a.start_datetime) }));
      const hasCoords = v.latitude != null && v.longitude != null;
      // Badge colour — reused for BOTH the timeline badge and the on-map caption
      // pill so they always match. Transit cycles the Lumo accents by its own
      // number; start = brand, end = transfer-teal, waypoint = muted (ghost).
      const accent = isTransit
        ? ACCENTS[(n - 1) % ACCENTS.length]
        : kind === 'start' ? 'var(--brand)'
          : kind === 'end' ? 'var(--ev-transfer)'
            : 'var(--muted)';
      return {
        id: v.id,
        kind,
        isTransit,
        n,
        city: v.city_name,
        country: v.country || '',
        cc: v.country_code || '',
        start, end, nights,
        hotel: hotel?.name || null,
        acts,
        accent,
        coords: hasCoords ? [Number(v.longitude), Number(v.latitude)] : null,
      };
    });
  }, [ordered, hotels, activities, locale]); // eslint-disable-line react-hooks/exhaustive-deps

  // The destination strip in the masthead stays transit-only (anchors/waypoints
  // are not destinations); the full route lives in the itinerary below.
  const transitStops = useMemo(() => stops.filter((s) => s.isTransit), [stops]);

  // Transfer leg between two consecutive stops (if booked), for the pill.
  const legFor = (a, b) => {
    const tr = transfers.find((x) => x.from_city_visit_id === a.id && x.to_city_visit_id === b.id && x.start_datetime);
    if (!tr) return null;
    const info = transportInfo(tr.transport_type);
    const label = t(`public.mode_${tr.transport_type}`) || info.label;
    const fromV = ordered.find((v) => v.id === a.id);
    const toV = ordered.find((v) => v.id === b.id);
    const dur = formatDuration(tr.start_datetime, tr.end_datetime, fromV?.timezone, toV?.timezone);
    return { Icon: info.Icon, label, dur, date: fmt(tr.start_datetime) };
  };

  const stats = useMemo(
    () => tripStats({ visits, transfers, trip, orderedVisits: ordered }),
    [visits, transfers, trip, ordered],
  );
  const [spanStart, spanEnd] = useMemo(() => tripDateSpan(trip, visits), [trip, visits]);

  // Map scroll-focus: the active stop drives the camera and the progressive route
  // reveal. focusIdx = -1 means "still at the top" → the map shows the WHOLE route
  // (every marker + line) and nothing is selected. Once the first stop scrolls
  // past the anchor, focusIdx = 0 and the camera/reveal start. The active index is
  // computed deterministically as the LAST stop whose top crossed the anchor line
  // (not by IntersectionObserver toggles), so scrolling up never "skips" a city.
  // The line growth between cities is animated INSIDE MapView, in time with the
  // camera flyTo — this component only reports which city is active.
  const [focusIdx, setFocusIdx] = useState(-1);
  const itinRef = useRef(null);
  useEffect(() => {
    const itin = itinRef.current;
    if (!itin || stops.length === 0) { setFocusIdx(-1); return undefined; }
    let raf = 0;
    const measure = () => {
      raf = 0;
      const els = itin.querySelectorAll('.pt-cstop');
      if (!els.length) return;
      const anchor = window.innerHeight * 0.45;
      const tops = Array.from(els, (el) => el.getBoundingClientRect().top);
      let active = -1;
      for (let i = 0; i < tops.length; i++) {
        if (tops[i] <= anchor) active = i; else break;
      }
      setFocusIdx(active);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [stops.length]);

  // The active stop drives the map's reveal (which the map's reveal controller
  // turns into the camera flight + line growth). At the top (focusIdx < 0) nothing
  // is active and the map shows the whole route.
  const activeStop = focusIdx >= 0 ? stops[focusIdx] : null;
  const activeId = activeStop?.id ?? null;

  // Reveal-on-scroll for the participants / CTA blocks.
  useEffect(() => {
    if (!cssReady) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    document.querySelectorAll('.pt-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cssReady, people.length]);

  if (!cssReady) return null;
  if (!token) return <NotFound message={t('public.invalid_link')} t={t} />;
  if (isLoading) {
    return (
      <div className="pt-center"><div className="pt-spin" /></div>
    );
  }
  if (error || !trip) return <NotFound message={t('public.not_found')} t={t} />;

  // Collapse a same-month span to "4 – 16 Jul" (matches the mockup); keep the
  // full "28 Jun – 4 Jul" form across months.
  const dateRange = (() => {
    if (!spanStart || !spanEnd) return '';
    const a = new Date(spanStart);
    const b = new Date(spanEnd);
    const sameMonth = a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
    return sameMonth ? `${a.getUTCDate()} – ${fmt(spanEnd)}` : `${fmt(spanStart)} – ${fmt(spanEnd)}`;
  })();
  const ownerName = owner?.display_name || '';

  return (
    <div className="ptrip">
      <SiteHeader lang={lang} setLang={setLang} navBase={SITE} brandHref={SITE} />

      {/* ── Masthead: full-width title + author, then a divider. ── */}
      <section className="pt-wide pt-top">
        <header className="pt-mast">
          <span className="pt-mast__kick">{t('public.mast_kick')}</span>
          <h1>{trip.title}</h1>

          {ownerName && (
            <div className="pt-mast__by">
              <span className="pt-mast__av">
                {initials(ownerName)}
                {owner.avatar_url && <img src={owner.avatar_url} alt="" onError={(e) => e.currentTarget.remove()} />}
              </span>
              <span className="pt-mast__tx">
                <span className="pt-mast__l1">{t('public.shared_by')} <b>{ownerName}</b></span>
                <span className="pt-mast__l2">{t('public.shared_sub')}</span>
              </span>
            </div>
          )}
        </header>
      </section>

      {/* ── Reader: below the divider — left column (cities strip + stats + the
           route list), right column the sticky map lifted to just under it. ── */}
      <section className="pt-wide"><div className="pt-reader">
        <div className="pt-left">
          {transitStops.length > 0 && (
            <div className="pt-ribbon">
              {transitStops.map((s, i) => (
                <React.Fragment key={s.id}>
                  <span className="pt-rchip"><FlagImg cc={s.cc} /><b>{s.city}</b></span>
                  {i < transitStops.length - 1 && (
                    <span className="pt-rsep"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          <div className="pt-meta">
            {dateRange && (
              <div className="pt-mm"><span className="n">{dateRange}</span><span className="k">{stats.days} {plural(stats.days, 'public.subtitle_days')}</span></div>
            )}
            <div className="pt-mm"><span className="n tnum">{stats.cities}</span><span className="k">{t('public.meta_cities')}</span></div>
            <div className="pt-mm"><span className="n tnum">{stats.countries}</span><span className="k">{t('public.meta_countries')}</span></div>
            <div className="pt-mm"><span className="n tnum">{stats.transfers}</span><span className="k">{t('public.meta_transfers')}</span></div>
            {stats.distanceKm > 0 && (() => {
              const dist = fmtDistance(stats.distanceKm);
              return (
                <div className="pt-mm"><span className="n tnum">{dist.value}<small>{dist.unit}</small></span><span className="k">{t('public.meta_distance')}</span></div>
              );
            })()}
          </div>

          <div className="pt-itin" ref={itinRef}>
          {stops.map((s, i) => (
            <React.Fragment key={s.id}>
              {s.kind === 'waypoint' ? (
                <div className={`pt-cstop pt-cstop--wp${i === focusIdx ? ' is-active' : ''}`} data-i={i}>
                  <span className="pt-wp__dot" style={{ borderColor: i === focusIdx ? 'var(--brand)' : s.accent }} />
                  <FlagImg cc={s.cc} className="pt-wp__flag" />
                  <span className="pt-wp__city">{s.city}</span>
                  <span className="pt-wp__tag">{t('public.role_waypoint')}</span>
                </div>
              ) : (
                <div className={`pt-cstop${i === focusIdx ? ' is-active' : ''}${s.isTransit ? '' : ' pt-cstop--anchor'}`} data-i={i}>
                  <div className="pt-cstop__h">
                    <div className={`pt-cstop__num${s.isTransit ? '' : ' pt-cstop__num--icon'}`} style={{ background: i === focusIdx ? 'var(--brand)' : s.accent }}>
                      {s.isTransit ? s.n : <RoleGlyph kind={s.kind} />}
                    </div>
                    <div className="pt-cstop__ht">
                      <h2>
                        {s.city}
                        {!s.isTransit && (
                          <span className="pt-role" style={{ color: s.accent, background: `color-mix(in srgb, ${s.accent} 14%, transparent)` }}>
                            {t(`public.role_${s.kind}`)}
                          </span>
                        )}
                      </h2>
                      <div className="pt-cstop__sub">
                        <FlagImg cc={s.cc} />
                        {s.country && <span>{s.country}</span>}
                        {(s.start || s.end) && <span>· {fmt(s.start)} → {fmt(s.end)}</span>}
                        {s.nights > 0 && <span>· <b>{s.nights} {plural(s.nights, 'public.nights')}</b></span>}
                      </div>
                      {s.hotel && (
                        <div className="pt-cstop__hotel">
                          <span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M10 21v-4h4v4"/></svg></span>
                          {s.hotel}
                        </div>
                      )}
                    </div>
                  </div>
                  {s.acts.length > 0 && (
                    <div className="pt-acts">
                      {s.acts.map((a, ai) => (
                        <div className="pt-act" key={ai}>
                          <span className="dot" style={{ background: s.accent }} />
                          <span className="nm">{a.nm}</span>
                          {a.day && (
                            <span
                              className="day"
                              style={{ background: `color-mix(in srgb, ${s.accent} 16%, transparent)`, color: s.accent }}
                            >{a.day}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {i < stops.length - 1 && (() => {
                const leg = legFor(s, stops[i + 1]);
                if (!leg) return null;
                const { Icon } = leg;
                return (
                  <div className="pt-cleg" key={`leg-${s.id}`}>
                    <span className="pt-cleg__pill">
                      <Icon />
                      <span>{leg.label}</span>
                      {leg.dur && <span className="dur">· {leg.dur}</span>}
                      {leg.date && <><span className="sep">•</span><span className="dt">{leg.date}</span></>}
                    </span>
                  </div>
                );
              })()}
            </React.Fragment>
          ))}
          </div>
        </div>

        <div className="pt-mapcol">
          <div className="pt-mapbox">
            <MapView
              visits={visits}
              transfers={transfers}
              colorScheme="LIGHT"
              basemapTheme="monochrome"
              selectedVisitId={activeId}
              revealActiveId={activeId}
            />
            {activeStop && (
              <div className="pt-mapcap">
                <span className="pt-mapcap__pill" style={{ background: activeStop.accent }}>
                  {activeStop.isTransit ? activeStop.n : <RoleGlyph kind={activeStop.kind} />}
                </span>
                <span className="pt-mapcap__tx">
                  <b>{activeStop.city}</b>
                  {activeStop.nights > 0 && (
                    <span>· {activeStop.nights} {plural(activeStop.nights, 'public.nights')}</span>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>
      </div></section>

      {/* ── Participants ── */}
      {people.length > 0 && (
        <section className="pt-band"><div className="pt-wide pt-reveal">
          <div className="pt-eyebrow">{t('public.people_eyebrow')}</div>
          <h2 className="pt-h-lead">{t('public.people_title')}</h2>
          <div className="pt-people">
            {people.map((m, i) => (
              <div className="pt-person" key={i}>
                <span className="av" style={{ background: ACCENTS[i % ACCENTS.length] }}>
                  {initials(m.display_name)}
                  {m.avatar_url && <img src={m.avatar_url} alt="" onError={(e) => e.currentTarget.remove()} />}
                </span>
                <span className="nm">{m.display_name}</span>
              </div>
            ))}
          </div>
        </div></section>
      )}

      {/* ── CTA ── */}
      <section className="pt-cta">
        <div className="pt-cta__glow" />
        <div className="pt-wide" style={{ textAlign: 'center' }}>
          <h2>{t('public.cta_title')}</h2>
          <p>{t('public.cta_sub')}</p>
          <div className="pt-cta__act">
            <a className="btn btn--white btn--lg" href={SITE}>{t('public.cta_plan')}</a>
          </div>
        </div>
      </section>

      <SiteFooter lang={lang} setLang={setLang} navBase={SITE} brandHref={SITE} />

      {/* ── Mobile sticky CTA ── */}
      <div className="pt-scta">
        <div className="tx"><b>{t('public.scta_title')}</b><span>{t('public.scta_sub')}</span></div>
        <a className="btn btn--primary btn--sm" href={SITE}>{t('public.scta_btn')}</a>
      </div>
    </div>
  );
}

function NotFound({ message, t }) {
  return (
    <div className="ptrip"><div className="pt-center">
      <div>
        <div className="ic"><Plane size={24} /></div>
        <h1 style={{ fontSize: 'var(--fs-h2)', marginBottom: 8 }}>{t('public.oops')}</h1>
        <p style={{ color: 'var(--muted)' }}>{message}</p>
      </div>
    </div></div>
  );
}
