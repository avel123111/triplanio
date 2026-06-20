import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plane } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { SiteHeader, SiteFooter, useLandingCss } from '@/components/site/SiteChrome';
import MapView from '@/components/views/MapView';
import { sortVisits } from '@/lib/validation';
import { transitVisits } from '@/lib/trip-cities';
import { tripStats, tripDateSpan } from '@/lib/trip-stats';
import { transportInfo } from '@/lib/transport';
import { formatDuration } from '@/lib/time';
import './PublicTrip.css';

// Where the marketing chrome's section anchors / brand should point when this
// page is rendered off the landing route.
const SITE = 'https://triplanio.com/';
// Per-city accent cycle — all existing Lumo event/accent tokens (no new tokens).
const ACCENTS = ['var(--primary)', 'var(--ev-activity)', 'var(--ev-car)', 'var(--ai)', 'var(--pro)', 'var(--ev-transfer)'];

const initials = (name = '') =>
  name.split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();

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
  const { t, fmtDate, plural, locale } = useI18nFormat();
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
  const visits = useMemo(() => data?.visits || [], [data]);
  const hotels = useMemo(() => data?.hotels || [], [data]);
  const transfers = useMemo(() => data?.transfers || [], [data]);
  const activities = useMemo(() => data?.activities || [], [data]);

  const ordered = useMemo(() => sortVisits(visits), [visits]);

  const fmt = (d) => (d ? fmtDate(d, 'utc', 'd MMM') : '');

  // Build the city stops (transit cities only, in trip order) with their hotel,
  // activities, nights and coordinates.
  const stops = useMemo(() => {
    return transitVisits(ordered).map((v, i) => {
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
      return {
        id: v.id,
        n: i + 1,
        city: v.city_name,
        country: v.country || '',
        cc: v.country_code || '',
        start, end, nights,
        hotel: hotel?.name || null,
        acts,
        accent: ACCENTS[i % ACCENTS.length],
        coords: hasCoords ? [Number(v.longitude), Number(v.latitude)] : null,
      };
    });
  }, [ordered, hotels, activities, locale]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Map scroll-focus: the active city stop drives the map camera.
  const [focusIdx, setFocusIdx] = useState(0);
  const itinRef = useRef(null);
  useEffect(() => {
    if (!itinRef.current || stops.length === 0) return;
    const els = itinRef.current.querySelectorAll('.pt-cstop');
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setFocusIdx(Number(e.target.dataset.i)); });
    }, { rootMargin: '-45% 0px -45% 0px', threshold: 0 });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [stops]);

  const focusPts = useMemo(() => {
    const c = stops[focusIdx]?.coords;
    return c ? [c] : null;
  }, [stops, focusIdx]);

  // Reveal-on-scroll for the participants / CTA blocks.
  useEffect(() => {
    if (!cssReady) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.15 });
    document.querySelectorAll('.pt-reveal').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [cssReady, members.length]);

  if (!cssReady) return null;
  if (!token) return <NotFound message={t('public.invalid_link')} t={t} />;
  if (isLoading) {
    return (
      <div className="pt-center"><div className="pt-spin" /></div>
    );
  }
  if (error || !trip) return <NotFound message={t('public.not_found')} t={t} />;

  const dateRange = spanStart && spanEnd ? `${fmt(spanStart)} – ${fmt(spanEnd)}` : '';
  const ownerName = owner?.display_name || '';

  return (
    <div className="ptrip">
      <SiteHeader lang={lang} setLang={setLang} navBase={SITE} brandHref={SITE} />

      {/* ── Masthead ── */}
      <section className="pt-mast"><div className="pt-wide">
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

        {stops.length > 0 && (
          <div className="pt-ribbon">
            {stops.map((s, i) => (
              <React.Fragment key={s.id}>
                <span className="pt-rchip"><FlagImg cc={s.cc} /><b>{s.city}</b></span>
                {i < stops.length - 1 && (
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
          {stats.distanceKm > 0 && (
            <div className="pt-mm"><span className="n tnum">{stats.distanceKm.toLocaleString(locale)}<small>{t('public.km')}</small></span><span className="k">{t('public.meta_distance')}</span></div>
          )}
        </div>
      </div></section>

      {/* ── Reader: itinerary + sticky map ── */}
      <section className="pt-wide"><div className="pt-reader">
        <div className="pt-itin" ref={itinRef}>
          {stops.map((s, i) => (
            <React.Fragment key={s.id}>
              <div className="pt-cstop" data-i={i}>
                <div className="pt-cstop__h">
                  <div className="pt-cstop__num" style={{ background: s.accent }}>{s.n}</div>
                  <div className="pt-cstop__ht">
                    <h2>{s.city}</h2>
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
                        {a.day && <span className="day">{a.day}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
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

        <div className="pt-mapcol">
          <div className="pt-mapbox">
            <MapView
              visits={visits}
              transfers={transfers}
              colorScheme="LIGHT"
              basemapTheme="monochrome"
              focus={focusPts}
            />
          </div>
        </div>
      </div></section>

      {/* ── Participants ── */}
      {members.length > 0 && (
        <section className="pt-band"><div className="pt-wide pt-reveal">
          <div className="pt-eyebrow">{t('public.people_eyebrow')}</div>
          <h2 className="pt-h-lead">{t('public.people_title')}</h2>
          <div className="pt-people">
            {members.map((m, i) => (
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
            <a className="pt-btn pt-btn--glass" href={SITE} style={{ fontSize: '15.5px', padding: '14px 24px' }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
              {t('public.cta_copy')}
            </a>
            <a className="pt-btn pt-btn--white" href={SITE} style={{ fontSize: '15.5px', padding: '14px 24px' }}>{t('public.cta_plan')}</a>
          </div>
        </div>
      </section>

      <SiteFooter lang={lang} setLang={setLang} navBase={SITE} brandHref={SITE} />

      {/* ── Mobile sticky CTA ── */}
      <div className="pt-scta">
        <div className="tx"><b>{t('public.scta_title')}</b><span>{t('public.scta_sub')}</span></div>
        <a className="pt-btn pt-btn--primary pt-btn--sm" href={SITE}>{t('public.scta_btn')}</a>
      </div>
    </div>
  );
}

function NotFound({ message, t }) {
  return (
    <div className="ptrip"><div className="pt-center">
      <div>
        <div className="ic"><Plane className="w-6 h-6" /></div>
        <h1 style={{ fontSize: 'var(--fs-h2)', marginBottom: 8 }}>{t('public.oops')}</h1>
        <p style={{ color: 'var(--muted)' }}>{message}</p>
      </div>
    </div></div>
  );
}
