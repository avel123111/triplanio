import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { isProActive } from '@/lib/subscription';
import { cityKey, localizeVisits } from '@/lib/trip-cities';
import { continentOf, COUNTRIES_PER_CONTINENT } from '@/lib/continents';
import {
  statisticsBundle, availableYears, filterByYear, dominantTone, TONE, countVisitUnits,
} from '@/lib/travel-stats';
import StatsMap from '@/components/views/StatsMap';
import VisitPanel from '@/components/stats/VisitPanel';
import AddPlaceDialog from '@/components/stats/AddPlaceDialog';
import {
  SummaryTiles, WorldRing, ContinentBars, Records, YearChart, VisitList,
} from '@/components/stats/widgets';
import { Btn, Skeleton } from '@/design/index';
import { Icon } from '@/design/icons';
import AppHeader from '@/components/AppHeader';
import '../design/app.css';

// "Моя статистика" — full Ф5 screen. Reads the same get_user_travel_stats RPC the
// home screen uses, year-filters + aggregates entirely on the client via
// travel-stats, and lays the result out with the shared stats widgets + the
// singleton StatsMap. Visited places come from trips and manual visits; manual
// places can be added / edited / deleted via AddPlaceDialog (free — no Pro gate).

// Continent display order + colours (existing event tokens — no new tokens).
// Antarctica (AN) is intentionally omitted — it has no travel destinations, so a
// permanent "0" bar only adds noise.
const CONT_ORDER = ['EU', 'AS', 'NA', 'AF', 'SA', 'OC'];
const CONT_COLOR = {
  EU: 'hsl(var(--primary))', AS: 'var(--ev-activity)', NA: 'var(--ev-car)',
  AF: 'var(--warm)', SA: 'var(--ev-transfer)', OC: 'var(--ai)',
};

// First-load skeleton — mirrors the real /stats layout blocks (head, map hero,
// 6-tile summary, world+continents panel, list, 4 records, year chart) using the
// shared Skeleton + the same .summary/.records/.sec-head grids so columns match.
function StatsScreenSkeleton() {
  return (
    <>
      <div className="head">
        <div className="head__row">
          <div className="grow">
            <Skeleton w={210} h={30} r={8} style={{ marginBottom: 10 }} />
            <Skeleton w={280} h={15} r={6} />
          </div>
          <Skeleton w={220} h={40} r={12} />
        </div>
      </div>
      <Skeleton w="100%" h={420} r={24} style={{ marginTop: 18 }} />
      <div className="summary" style={{ marginTop: 18 }}>
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} w="100%" h={92} r={20} />)}
      </div>
      <Skeleton w="100%" h={220} r={24} style={{ marginTop: 18 }} />
      <div className="sec-head" style={{ marginTop: 10 }}><Skeleton w={180} h={22} r={6} /></div>
      <Skeleton w="100%" h={240} r={24} />
      <div className="sec-head" style={{ marginTop: 10 }}><Skeleton w={140} h={22} r={6} /></div>
      <div className="records">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} w="100%" h={120} r={20} />)}
      </div>
      <div className="sec-head" style={{ marginTop: 10 }}><Skeleton w={160} h={22} r={6} /></div>
      <Skeleton w="100%" h={220} r={24} />
    </>
  );
}

export default function Statistics() {
  const { t, locale, lang } = useI18n();
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const nav = useNavigate();
  const isPro = isProActive(user);
  const scheme = isDark ? 'DARK' : 'LIGHT';

  // Localised country names from ISO-3166-1 alpha-2 (no country-name data table).
  const regionName = useMemo(() => {
    let dn = null;
    try { dn = new Intl.DisplayNames([locale || 'en'], { type: 'region' }); } catch { dn = null; }
    return (cc) => {
      if (!cc) return '';
      try { return (dn && dn.of(String(cc).toUpperCase())) || String(cc).toUpperCase(); }
      catch { return String(cc).toUpperCase(); }
    };
  }, [locale]);

  // ── data ────────────────────────────────────────────────────────────────────
  const { data: travelStats, isLoading } = useQuery({
    queryKey: ['travel-stats', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_user_travel_stats');
      if (error) throw error;
      return data || { points: [], trips: {}, transfers_total: 0 };
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
  const showSkeleton = isLoading && !travelStats;
  const allPoints = useMemo(() => localizeVisits(travelStats?.points || [], lang), [travelStats, lang]);
  const trips = travelStats?.trips || {};
  const isEmpty = allPoints.length === 0;

  // ── year filter (client-side; no network on switch) ──────────────────────────
  const [year, setYear] = useState('all');
  const years = useMemo(() => availableYears(allPoints), [allPoints]);
  const points = useMemo(() => filterByYear(allPoints, year), [allPoints, year]);
  const bundle = useMemo(() => statisticsBundle(points, trips), [points, trips]);

  // ── map UI state ──────────────────────────────────────────────────────────────
  const [showMap, setShowMap] = useState(false);
  const [globe, setGlobe] = useState(false);
  const [fs, setFs] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShowMap(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    if (!fs) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFs(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fs]);

  // ── list + panel state ────────────────────────────────────────────────────────
  const [listMode, setListMode] = useState('countries');
  const [panel, setPanel] = useState(null); // { kind, key }

  // ── add / edit manual place ─────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState(null);
  const openAdd = useCallback(() => { setEditingPoint(null); setAddOpen(true); }, []);
  const openEditManual = useCallback((p) => { setPanel(null); setEditingPoint(p); setAddOpen(true); }, []);

  // Dominant visit type per country — drives the map legend tally only (the
  // country/city lists show real flags, no tone tint).
  const countryTone = useMemo(() => {
    const byCountry = new Map();
    for (const p of points) {
      const cc = p?.country_code ? String(p.country_code).toUpperCase() : '';
      if (cc) { let a = byCountry.get(cc); if (!a) { a = []; byCountry.set(cc, a); } a.push(p); }
    }
    const cT = {}; for (const [cc, ps] of byCountry) cT[cc] = dominantTone(ps);
    return cT;
  }, [points]);

  // distinct cities per country (list sub-label)
  const citiesPerCountry = useMemo(() => {
    const m = new Map();
    for (const p of points) {
      const cc = p?.country_code ? String(p.country_code).toUpperCase() : '';
      const ck = cityKey(p);
      if (!cc || !ck) continue;
      let s = m.get(cc); if (!s) { s = new Set(); m.set(cc, s); }
      s.add(ck);
    }
    return m;
  }, [points]);

  // ── derived view models ─────────────────────────────────────────────────────
  const summaryItems = useMemo(() => [
    { key: 'countries', value: bundle.countries, label: t('stats.sb_countries'), icon: <Icon name="globe" /> },
    { key: 'cities', value: bundle.cities, tone: 'city', label: t('stats.sb_cities'), icon: <Icon name="buildings" /> },
    { key: 'continents', value: bundle.continents, tone: 'cont', label: t('stats.sb_continents'), icon: <Icon name="layers" /> },
    { key: 'trips', value: bundle.trips, tone: 'trip', label: t('stats.sb_trips'), icon: <Icon name="suitcase" /> },
    { key: 'flights', value: '—', soon: true, tone: 'flight', label: t('stats.sb_flights'), icon: <Icon name="plane" /> },
    { key: 'ground', value: '—', soon: true, tone: 'transfer', label: t('stats.sb_ground'), icon: <Icon name="arrowSwap" /> },
  ], [bundle.countries, bundle.cities, bundle.continents, bundle.trips, t]);

  const contRows = useMemo(() => {
    const bd = bundle.continentsBreakdown || {};
    // Show only VISITED continents (unvisited are hidden, not rendered as 0). The
    // breakdown is computed over the already year-filtered points, so this list
    // follows the year filter like the rest of the screen.
    // Bar = continent COVERAGE: countries visited / total countries on that
    // continent. So equal counts on differently-sized continents read different,
    // and no continent is forced to 100% just for being the most-visited one.
    return CONT_ORDER.filter((c) => (bd[c] || 0) > 0).map((c) => {
      const visited = bd[c] || 0;
      const total = COUNTRIES_PER_CONTINENT[c] || 1;
      return {
        key: c, label: t(`stats.cont_${c}`), count: visited, color: CONT_COLOR[c],
        pct: Math.min(100, Math.round((visited / total) * 100)), countLabel: t('stats.cont_countries'),
      };
    });
  }, [bundle.continentsBreakdown, t]);

  const listRows = useMemo(() => {
    if (listMode === 'countries') {
      return bundle.countriesList.map((c) => {
        const nCities = citiesPerCountry.get(c.code)?.size || 0;
        const cont = continentOf(c.code);
        return {
          type: 'country', key: c.code, cc: String(c.code).toLowerCase(), badge: c.code, name: regionName(c.code),
          sub: `${cont ? t(`stats.cont_${cont}`) : ''}${cont ? ' · ' : ''}${t('stats.n_cities', { n: nCities })}`,
          count: c.count,
          selected: panel?.kind === 'country' && panel.key === c.code,
        };
      });
    }
    return bundle.citiesList.map((c) => ({
      type: 'city', key: c.key, cc: c.country_code ? String(c.country_code).toLowerCase() : '', badge: <Icon name="buildings" />, name: c.city_name,
      sub: regionName(c.country_code), count: c.count,
      selected: panel?.kind === 'city' && panel.key === c.key,
    }));
  }, [listMode, bundle.countriesList, bundle.citiesList, citiesPerCountry, panel, regionName, t]);

  const recordItems = useMemo(() => {
    const r = bundle.records;
    const soon = t('stats.rec_soon');
    return [
      { key: 'days', iconClass: 'r-days', icon: <Icon name="calendar" />, label: t('stats.rec_days'), value: r.days ? r.days.toLocaleString(locale) : '—', sub: r.days ? t('stats.rec_days_sub') : soon },
      { key: 'favcity', iconClass: 'r-fav', icon: <Icon name="heart" />, label: t('stats.rec_fav_city'), value: r.favoriteCity?.city_name || '—', sub: r.favoriteCity ? `${t('stats.visits_count')}: ${r.favoriteCity.count}` : soon },
      { key: 'favcountry', iconClass: 'r-star', icon: <Icon name="star" />, label: t('stats.rec_fav_country'), value: r.favoriteCountry ? regionName(r.favoriteCountry.code) : '—', sub: r.favoriteCountry ? `${t('stats.visits_count')}: ${r.favoriteCountry.count}` : soon },
      { key: 'longest', iconClass: 'r-route', icon: <Icon name="pin" />, label: t('stats.rec_longest'), value: r.longestTrip?.title || '—', sub: r.longestTrip ? `${t('stats.rec_cities')}: ${r.longestTrip.cities}` : soon },
    ];
  }, [bundle.records, regionName, locale, t]);

  const yearBars = useMemo(() => {
    const by = bundle.byYear || {};
    const ys = Object.keys(by).map(Number).sort((a, b) => a - b);
    if (ys.length === 0) return { bars: [], caption: t('stats.chart_empty') };
    const max = Math.max(1, ...ys.map((y) => by[y]));
    let best = ys[0]; ys.forEach((y) => { if (by[y] > by[best]) best = y; });
    const bars = ys.map((y) => ({ year: y, value: by[y], height: Math.max(10, (by[y] / max) * 128), on: y === best }));
    return { bars, caption: t('stats.chart_active', { year: best, count: by[best] }) };
  }, [bundle.byYear, t]);

  // map type legend (countries by dominant tone)
  const legendRows = useMemo(() => {
    const tally = { trip: 0, manual: 0, future: 0 };
    Object.values(countryTone).forEach((tn) => { tally[tn] = (tally[tn] || 0) + 1; });
    return ['trip', 'manual', 'future'].map((tn) => ({ tone: tn, color: TONE[tn], label: t(`stats.type_${tn}`), count: tally[tn] }));
  }, [countryTone, t]);

  // ── panel open/close ──────────────────────────────────────────────────────────
  const openCountry = useCallback((code) => {
    const cc = String(code).toUpperCase();
    if (!points.some((p) => String(p.country_code).toUpperCase() === cc)) return;
    setPanel({ kind: 'country', key: cc });
  }, [points]);
  const openCityGroup = useCallback((group) => {
    const first = Array.isArray(group) ? group[0] : group;
    const ck = cityKey(first);
    if (ck) setPanel({ kind: 'city', key: ck });
  }, []);
  const onListSelect = useCallback((row) => {
    setPanel({ kind: row.type, key: row.key });
  }, []);

  const panelData = useMemo(() => {
    if (!panel) return null;
    let visits; let name; let sub;
    if (panel.kind === 'country') {
      visits = points.filter((p) => String(p.country_code).toUpperCase() === panel.key);
      const nCities = new Set(visits.map((p) => cityKey(p)).filter(Boolean)).size;
      name = regionName(panel.key);
      sub = `${t('stats.n_cities', { n: nCities })} · ${t('stats.visits_count')}: ${countVisitUnits(visits)}`;
    } else {
      visits = points.filter((p) => cityKey(p) === panel.key);
      name = visits[0]?.city_name || '';
      sub = `${regionName(visits[0]?.country_code)} · ${t('stats.visits_count')}: ${countVisitUnits(visits)}`;
    }
    visits = visits.slice().sort((a, b) => new Date(b.start_date || 0) - new Date(a.start_date || 0));
    const cc = panel.kind === 'country' ? panel.key : visits[0]?.country_code;
    return { kind: panel.kind, name, sub, visits, cc };
  }, [panel, points, regionName, t]);

  const headSub = t('stats.stats_sub', { countries: bundle.countries, cities: bundle.cities, continents: bundle.continents });

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className={`app-shell${isEmpty ? ' stats-ghost' : ''}`} style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <AppHeader user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} onBack={() => nav('/trips')} backTitle={t('telegram.go_to_trips')} title={t('stats.page_title')} />
      <main style={{ flex: 1, padding: '32px 28px', maxWidth: 1240, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {showSkeleton ? <StatsScreenSkeleton /> : (<>

        {/* head: title + sub + year filter */}
        <div className="head">
          <div className="blob b1" /><div className="blob b2" />
          <div className="head__row" style={{ position: 'relative', zIndex: 1 }}>
            <div className="grow">
              <h1>{t('stats.page_title')}</h1>
              <div className="sub">{headSub}</div>
            </div>
            <div className="sec-actions">
              {years.length > 0 && (
                <div className="seg" role="group" aria-label={t('stats.period')}>
                  <button aria-pressed={year === 'all'} onClick={() => { setYear('all'); setPanel(null); }}>{t('stats.year_all')}</button>
                  {years.map((y) => (
                    <button key={y} aria-pressed={year === y} onClick={() => { setYear(y); setPanel(null); }}>{y}</button>
                  ))}
                </div>
              )}
              <Btn variant="soft" size="sm" icon="plus" onClick={openAdd}>{t('stats.add_place')}</Btn>
            </div>
          </div>
        </div>

        {/* empty-state note */}
        {isEmpty && (
          <div className="empty-note" style={{ marginTop: 18 }}>
            <span className="en-ic"><Icon name="globe" /></span>
            <span className="en-tx">
              <b>{t('stats.empty_title')}</b>
              <span>{t('stats.empty_sub')}</span>
            </span>
            <Btn variant="primary" size="sm" icon="plus" onClick={openAdd}>{t('stats.empty_cta')}</Btn>
          </div>
        )}

        {/* map hero */}
        <div className={`mapwrap${fs ? ' is-fs' : ''}${isEmpty ? ' is-ghost' : ''}`} style={{ minHeight: fs ? 0 : 420, marginTop: fs ? 0 : 18 }}>
          {showMap
            ? (
              <StatsMap
                points={points}
                colorScheme={scheme}
                projection={globe ? 'globe' : 'mercator'}
                onPointClick={openCityGroup}
                onCountryClick={openCountry}
                sizeSignal={fs ? 'fs' : 'win'}
                selected={panel ? { kind: panel.kind, key: panel.key } : null}
              >
                <div className="map-ctl">
                  <button className={globe ? 'on' : ''} onClick={() => setGlobe((g) => !g)} aria-label={t('stats.map_globe')}><Icon name="globe" /></button>
                  <button onClick={() => setFs((v) => !v)} aria-label={t('stats.map_fullscreen')}><Icon name="expand" /></button>
                </div>
                {fs && <button className="mapfs-close" onClick={() => setFs(false)} aria-label={t('common.close') || 'Close'}><Icon name="close" /></button>}
                <div className="map-legend">
                  {legendRows.map((r) => (
                    <span className="c" key={r.tone}>
                      <i className="d" style={r.tone === 'manual' ? { background: 'var(--surface)', boxShadow: 'inset 0 0 0 2px hsl(var(--primary))' } : { background: r.color }} />
                      {r.label}{r.count ? ` · ${r.count}` : ''}
                    </span>
                  ))}
                </div>
              </StatsMap>
            )
            : <div className="map-skel"><Icon name="globe" /><div>{t('stats.map_loading')}</div></div>}
        </div>

        {/* summary */}
        <SummaryTiles items={summaryItems} />

        {/* world ring + continents */}
        <div className="panel world">
          <div className="blob b1" />
          <WorldRing
            world={bundle.world}
            label={t('stats.world_label')}
            caption={<><b>{bundle.world.visited}</b> {t('stats.world_cap', { total: bundle.world.total })}</>}
          />
          <ContinentBars title={t('stats.continents_title')} rows={contRows} />
        </div>

        {/* country / city lists */}
        <div className="sec-head">
          <h2 className="t-subheading">{t('stats.places_title')}</h2>
          <div className="grow" />
          <div className="seg" role="group" aria-label={t('stats.places_title')}>
            <button aria-pressed={listMode === 'countries'} onClick={() => setListMode('countries')}>{t('stats.tab_countries')} · {bundle.countries}</button>
            <button aria-pressed={listMode === 'cities'} onClick={() => setListMode('cities')}>{t('stats.tab_cities')} · {bundle.cities}</button>
          </div>
        </div>
        <div className="panel" style={{ padding: '16px 18px' }}>
          <VisitList
            rows={listRows}
            emptyText={listMode === 'countries' ? t('stats.list_empty_countries') : t('stats.list_empty_cities')}
            onSelect={onListSelect}
          />
        </div>

        {/* records */}
        <div className="sec-head"><h2 className="t-subheading">{t('stats.records_title')}</h2></div>
        <Records items={recordItems} />

        {/* trips per year */}
        <div className="sec-head"><h2 className="t-subheading">{t('stats.byyear_title')}</h2></div>
        <YearChart bars={yearBars.bars} caption={yearBars.caption} />
        </>)}
      </main>

      <VisitPanel
        open={!!panelData}
        onOpenChange={(o) => { if (!o) setPanel(null); }}
        kind={panelData?.kind || 'country'}
        cc={panelData?.cc}
        name={panelData?.name}
        sub={panelData?.sub}
        visits={panelData?.visits || []}
        trips={trips}
        t={t}
        lang={locale}
        onOpenTrip={(id) => nav(`/trip/${id}`)}
        onEditManual={openEditManual}
      />

      <AddPlaceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        editing={editingPoint}
        onSaved={() => setEditingPoint(null)}
      />
    </div>
  );
}
