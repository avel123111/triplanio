import React, { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Plane } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { BRAND_LOGO_URL, BRAND_NAME } from '@/lib/brand';
import ReadOnlyTimelineView from '@/components/views/ReadOnlyTimelineView';
import MapView from '@/components/views/MapView';
import EventModal from '@/components/common/EventModal';
import { computeTripRange, latestEventDate } from '@/lib/trip-dates';
import { uniqueCityCount } from '@/lib/trip-cities';
import { getCityFallbackImage } from '@/lib/city-image';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

function useTripSubtitle() {
  const { fmtDate, plural } = useI18nFormat();
  return (range, visits) => {
    if (!range?.start || !range?.end) return null;
    const start = fmtDate(range.start, 'utc', 'd LLL');
    const end = fmtDate(range.end, 'utc', 'd LLL');
    const msPerDay = 1000 * 60 * 60 * 24;
    const days = Math.max(1, Math.round((new Date(range.end) - new Date(range.start)) / msPerDay) + 1);
    const cityCount = uniqueCityCount(visits);
    const cityStr = cityCount > 0 ? ` • ${cityCount} ${plural(cityCount, 'trip.cities_count')}` : '';
    return `${start} – ${end} • ${days} ${plural(days, 'public.subtitle_days')}${cityStr}`;
  };
}

export default function PublicTrip() {
  const { t } = useI18nFormat();
  const TABS = [
    { id: 'timeline', label: t('public.tab_timeline') },
    { id: 'map',      label: t('public.tab_map') },
  ];
  const buildSubtitle = useTripSubtitle();
  const { tripId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('t') || '';

  const [tab, setTab] = useState('timeline');
  // Single unified view-modal state — one of { kind, data } when open.
  const [viewing, setViewing] = useState(null);

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
  const visits = data?.visits || [];
  const hotels = data?.hotels || [];
  const transfers = data?.transfers || [];
  const activities = data?.activities || [];
  const carRentals = data?.carRentals || [];

  const visitsById = useMemo(() => Object.fromEntries(visits.map(v => [v.id, v])), [visits]);
  const range = useMemo(() => computeTripRange(visits), [visits]);
  const subtitle = useMemo(() => buildSubtitle(range, visits), [range, visits, buildSubtitle]);
  const coverImg = trip?.cover_image_url || getCityFallbackImage(visits);

  if (!token) {
    return <NotFound message={t('public.invalid_link')} />;
  }
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !trip) {
    return <NotFound message={t('public.not_found')} />;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar — minimal branding, no auth UI. Sticky so it stays on top while scrolling. */}
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-2">
          <a
            href="http://triplanio.com/"
            className="flex items-center gap-2 hover:opacity-80 transition"
            aria-label={BRAND_NAME}
          >
            <img src={BRAND_LOGO_URL} alt={BRAND_NAME} className="w-8 h-8" />
            <span className="font-display font-semibold">{t('public.brand')}</span>
          </a>
          <span className="ml-auto text-xs text-muted-foreground">{t('public.read_only')}</span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Cover */}
        {coverImg && (
          <div className="relative aspect-[16/6] sm:aspect-[16/5] rounded-2xl overflow-hidden mb-5 bg-secondary">
            <img src={coverImg} alt={trip.title} className="absolute inset-0 w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          </div>
        )}

        {/* Title */}
        <div className="mb-4">
          <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">{trip.title}</h1>
          {subtitle && <div className="mt-1.5 text-sm text-muted-foreground">{subtitle}</div>}
        </div>

        {/* Tabs */}
        <div className="mb-5 border-b border-border">
          <div className="flex gap-6">
            {TABS.map(tabItem => {
              const active = tab === tabItem.id;
              return (
                <button
                  key={tabItem.id}
                  onClick={() => setTab(tabItem.id)}
                  className={`relative pb-2.5 text-sm font-medium transition ${
                    active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tabItem.label}
                  {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-primary rounded-full" />}
                </button>
              );
            })}
          </div>
        </div>

        {tab === 'timeline' && (
          <ReadOnlyTimelineView
            visits={visits}
            hotels={hotels}
            activities={activities}
            transfers={transfers}
            carRentals={carRentals}
            onClickHotel={(h) => setViewing({ kind: 'hotel', data: h })}
            onClickTransfer={(t) => setViewing({ kind: 'transfer', data: t })}
            onClickActivity={(a) => setViewing({ kind: 'activity', data: a })}
            onClickCarRental={(s) => setViewing({ kind: 'service', data: s })}
            canEdit={false}
          />
        )}
        {tab === 'map' && (
          <MapView visits={visits} transfers={transfers} visitsById={visitsById} />
        )}
      </main>

      {/* Unified read-only event modal — kind dispatches to the right body. */}
      <EventModal
        open={!!viewing}
        onOpenChange={(o) => { if (!o) setViewing(null); }}
        entity={viewing?.data}
        kind={viewing?.kind}
        visit={viewing?.kind === 'hotel' || viewing?.kind === 'activity'
          ? visitsById[viewing?.data?.city_visit_id]
          : null}
        fromVisit={viewing?.kind === 'transfer' ? visitsById[viewing?.data?.from_city_visit_id] : null}
        toVisit={viewing?.kind === 'transfer' ? visitsById[viewing?.data?.to_city_visit_id] : null}
        readOnly
      />
    </div>
  );
}

function NotFound({ message }) {
  const { t } = useI18nFormat();
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
          <Plane className="w-6 h-6 text-muted-foreground" />
        </div>
        <h1 className="font-display font-bold text-2xl mb-2">{t('public.oops')}</h1>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}