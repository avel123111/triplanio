import React, { useMemo, useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { statisticsBundle } from '@/lib/travel-stats';
import StatsMap from '@/components/views/StatsMap';
import {
  Greeting, StatBar, WorldMini,
  IconGlobe, IconBuildings, IconContinent, IconSuitcase,
} from '@/components/stats/widgets';
import AppHeader from '@/components/AppHeader';
import '../design/app.css';

// "My statistics" screen (Ф4 lean version). Reuses the shared stats widgets +
// the singleton StatsMap; numbers come from travel-stats.statisticsBundle over
// the same get_user_travel_stats RPC the home screen uses. The full Ф5 layer
// (year filter, country/city side-panel, manual-add, continents, country/city
// lists, records, trips-per-year chart, fullscreen) is layered on top later.
export default function Statistics() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const isPro = !!(user && user.is_pro);
  const scheme = isDark ? 'DARK' : 'LIGHT';

  const [showMap, setShowMap] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShowMap(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const { data: travelStats } = useQuery({
    queryKey: ['travel-stats', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_travel_stats');
      if (error) throw error;
      return data || { points: [], trips: {}, transfers_total: 0 };
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
  const points = travelStats?.points || [];
  const trips  = travelStats?.trips || {};
  const bundle = useMemo(() => statisticsBundle(points, trips), [points, trips]);

  const items = [
    { key: 'countries',  value: bundle.countries,  label: t('stats.sb_countries'),  icon: <IconGlobe /> },
    { key: 'cities',     value: bundle.cities,     label: t('stats.sb_cities'),     tone: 'city', icon: <IconBuildings /> },
    { key: 'continents', value: bundle.continents, label: t('stats.sb_continents'), icon: <IconContinent /> },
    { key: 'trips',      value: bundle.trips,      label: t('stats.sb_trips'),      tone: 'trip', icon: <IconSuitcase /> },
  ];
  const sub = `${bundle.countries} ${t('stats.sb_countries')} · ${bundle.cities} ${t('stats.sb_cities')} · ${bundle.continents} ${t('stats.sb_continents')}`;

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <AppHeader user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />
      <main style={{ flex: 1, padding: '32px 28px', maxWidth: 1240, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <Greeting greeting={t('stats.page_title')} name="" photo={null} sub={sub} />
        <StatBar items={items} />
        <div className="mapwrap" style={{ minHeight: 420, marginTop: 18 }}>
          {showMap
            ? <StatsMap points={points} colorScheme={scheme} />
            : <div className="map-skel"><IconGlobe /><div>{t('stats.map_loading')}</div></div>}
        </div>
        <div style={{ marginTop: 18, maxWidth: 420 }}>
          <WorldMini
            world={bundle.world}
            title={t('stats.world_explored')}
            caption={t('stats.world_of', { visited: bundle.world.visited, total: bundle.world.total })}
          />
        </div>
      </main>
    </div>
  );
}
