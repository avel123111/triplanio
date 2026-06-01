import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { Sparkles, Info, AlertTriangle, ChevronDown } from 'lucide-react';
import { APIProvider, Map as GMap, Marker as GMarker, useMap as useGMap, useApiIsLoaded } from '@vis.gl/react-google-maps';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { isTripInPast } from '@/lib/trip-dates';
import { searchCities, getTimezone } from '@/lib/geo';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { useToast } from '@/components/ui/use-toast';
import { Icon } from '../design/icons';
import { Btn } from '@/design/index';
import HeaderActions from '@/components/HeaderActions';
import TripLimitDialog from '@/components/subscriptions/TripLimitDialog';
import TriplanioAvatar from '@/components/chat/TriplanioAvatar';
import { groupMarkers, markerSvg, svgDataUri, markerPixelSize, MISSING_COLOR } from '@/lib/mapRoute';
import '../design/app.css';

const GKEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

// ── Map helpers ───────────────────────────────────────────────────────────────

function GFitBounds({ positions }) {
  const map = useGMap();
  useEffect(() => {
    if (!map || !window.google || positions.length === 0) return;
    if (positions.length === 1) { map.setCenter({ lat: positions[0][0], lng: positions[0][1] }); map.setZoom(7); return; }
    try {
      const bounds = new window.google.maps.LatLngBounds();
      positions.forEach(p => bounds.extend({ lat: p[0], lng: p[1] }));
      map.fitBounds(bounds);
    } catch {}
  }, [map, JSON.stringify(positions)]); // eslint-disable-line
  return null;
}

function gIcon(labels) {
  const g = window.google;
  if (!g?.maps) return undefined;
  const d = markerPixelSize(false);
  return { url: svgDataUri(markerSvg(labels, false)), scaledSize: new g.maps.Size(d, d), anchor: new g.maps.Point(d / 2, d / 2) };
}

// Markers are deferred until the Maps JS API is fully loaded — otherwise
// gIcon() runs before window.google exists and the pins never appear.
function GMarkersLayer({ groups }) {
  const isLoaded = useApiIsLoaded();
  if (!isLoaded) return null;
  return groups.map((grp, i) => (
    <GMarker key={i} position={{ lat: grp.lat, lng: grp.lng }} icon={gIcon(grp.labels)} />
  ));
}

function GDashedLines({ pts }) {
  const map = useGMap();
  const ptsKey = pts.map(p => `${p.lat},${p.lng}`).join('|');
  useEffect(() => {
    if (!map || !window.google || pts.length < 2) return;
    const gmaps = window.google.maps;
    const polylines = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const pl = new gmaps.Polyline({
        path: [{ lat: pts[i].lat, lng: pts[i].lng }, { lat: pts[i + 1].lat, lng: pts[i + 1].lng }],
        geodesic: false, strokeOpacity: 0, strokeWeight: 2,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.45, scale: 3, strokeColor: MISSING_COLOR, strokeWeight: 2 }, offset: '0', repeat: '14px' }],
        map,
      });
      polylines.push(pl);
    }
    return () => polylines.forEach(p => p.setMap(null));
  }, [map, ptsKey]); // eslint-disable-line
  return null;
}

function AiPlannerMap({ cities }) {
  const [pts, setPts] = useState([]);
  const citiesKey = cities.map(c => c.city_name).join(',');

  useEffect(() => {
    if (!cities.length) { setPts([]); return; }
    let cancelled = false;
    (async () => {
      const resolved = await Promise.all(cities.map(async (c, i) => {
        try {
          const results = await searchCities(`${c.city_name}${c.country ? ', ' + c.country : ''}`);
          const best = results[0];
          if (!best?.latitude) return null;
          return { lat: best.latitude, lng: best.longitude, label: String(i + 1), color: '#2167e2', name: c.city_name };
        } catch { return null; }
      }));
      if (!cancelled) setPts(resolved.filter(Boolean));
    })();
    return () => { cancelled = true; };
  }, [citiesKey]); // eslint-disable-line

  if (!pts.length) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: 'var(--wash)', color: 'var(--muted-2)' }}>
        <div style={{ textAlign: 'center', fontSize: 12.5 }}>
          <Icon name="map" size={22} style={{ marginBottom: 6, opacity: 0.4 }} />
          <div>Загрузка…</div>
        </div>
      </div>
    );
  }

  const positions = pts.map(p => [p.lat, p.lng]);
  const groups = groupMarkers(pts);

  return (
    <APIProvider apiKey={GKEY}>
      <GMap
        style={{ height: '100%', width: '100%' }}
        defaultCenter={{ lat: positions[0][0], lng: positions[0][1] }}
        defaultZoom={4}
        gestureHandling="cooperative"
        disableDefaultUI
        mapTypeId="roadmap"
      >
        <GFitBounds positions={positions} />
        <GMarkersLayer groups={groups} />
        <GDashedLines pts={pts} />
      </GMap>
    </APIProvider>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * AI trip planner — Layout L3 from src/pages/redesign/ScreenAiPlanner.jsx.
 *
 * Both columns share an identical shell across all four UI states
 * (empty / generating / draft / saving) so nothing reflows between transitions.
 *
 *   Left  (sticky) — prompt textarea + AI status block + chips/hint
 *   Right          — map + draft header + city list + save CTA
 *
 * n8n stores per-session history (keyed by `sessionId`), so the request body
 * stays minimal: `{ sessionId, prompt, language }`. The N8N_SECRET bearer is
 * held only as a Supabase Edge Function env var — never reaches the browser.
 */
export default function AiTripPlanner() {
  const t = useT();
  const { lang } = useI18n();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();

  const isPro = isProActive(user);

  // ── Free-plan limit check (same pattern as ManualPlanner) ──────────────────
  const { data: allTrips = [], isLoading: checkingLimit } = useQuery({
    queryKey: ['trips-limit-check', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('trips').select('id').eq('created_by', user.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id && !isPro,
  });

  const { data: allVisits = [] } = useQuery({
    queryKey: ['trips-limit-visits', user?.id, allTrips.length],
    queryFn: async () => {
      const ids = allTrips.map(t => t.id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase.from('city_visits').select('*').in('trip_id', ids);
      if (error) throw error;
      return data || [];
    },
    enabled: !isPro && allTrips.length > 0,
  });

  const visitsByTrip = allVisits.reduce((acc, v) => {
    if (!acc[v.trip_id]) acc[v.trip_id] = [];
    acc[v.trip_id].push(v);
    return acc;
  }, {});
  const activeTrips = allTrips.filter(tr => !isTripInPast(visitsByTrip[tr.id] || []));
  const isOverLimit = !isPro && !checkingLimit && activeTrips.length >= 1;

  const [prompt, setPrompt]       = useState('');
  const [draft, setDraft]         = useState(null);
  const [aiComment, setAiComment] = useState('');
  const [saveError, setSaveError] = useState(null);
  const [state, setState]         = useState('empty'); // empty | generating | draft | saving
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());

  const resetAll = () => {
    setPrompt('');
    setDraft(null);
    setAiComment('');
    setSaveError(null);
    setState('empty');
    setSessionId(crypto.randomUUID());
  };

  // ── AI call ───────────────────────────────────────────────────────────────
  const planMut = useMutation({
    mutationFn: async ({ promptText }) => {
      const { data, error } = await supabase.functions.invoke('planTripWithAi', {
        body: { sessionId, prompt: promptText, language: lang || 'ru' },
      });
      if (error) throw error;
      return data;
    },
    onMutate: () => { setState('generating'); setSaveError(null); },
    onSuccess: (data) => {
      const out = data?.output || {};
      if (out.draft) setDraft(out.draft);
      setAiComment(out.ai_comment || '');
      setState('draft');
    },
    onError: (err) => {
      setState(draft ? 'draft' : 'empty');
      toast({
        title: t('ai_plan.error_plan_title'),
        description: err?.message || t('ai_plan.error_plan_desc'),
        variant: 'destructive',
      });
    },
  });

  // ── Save draft as a real Trip (+CityVisits +Activities) via Supabase ──────
  const saveMut = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error(t('ai_plan.no_draft_error'));

      // RLS requires created_by = auth.uid(). Always pull the id straight from
      // the session (profiles table may diverge).
      const { data: authUser, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authUser?.user?.id) throw new Error('Не удалось получить идентификатор из сессии');
      const authId = authUser.user.id;

      const cities = draft.cities || [];

      // 1. Create trip via SECURITY DEFINER RPC (bypasses RLS caching issues)
      const { data: tripId, error: tripErr } = await supabase
        .rpc('create_trip', { p_title: draft.title || t('ai_plan.default_trip_title'), p_description: draft.description || '' });
      if (tripErr) throw tripErr;

      // 2. Resolve each city's coordinates + timezone
      const resolved = await Promise.all(cities.map(async (c) => {
        try {
          const results = await searchCities(`${c.city_name}, ${c.country || ''}`);
          const best = results[0] || null;
          const tz = best?.latitude
            ? await getTimezone(best.latitude, best.longitude).catch(() => 'UTC')
            : 'UTC';
          return { c, best, tz };
        } catch {
          return { c, best: null, tz: 'UTC' };
        }
      }));

      // 3. Batch insert city_visits
      const visitsToInsert = resolved.map(({ c, best, tz }) => {
        const kind = (c.kind === 'start' || c.kind === 'end') ? c.kind : 'transit';
        const start = DateTime.fromISO(c.start_date, { zone: tz }).set({ hour: 12, minute: 0 });
        const end   = DateTime.fromISO(c.end_date,   { zone: tz }).set({ hour: 12, minute: 0 });
        return {
          trip_id:          tripId,
          external_city_id: best?.external_city_id || null,
          city_name:        c.city_name,
          country:          c.country || best?.country || '',
          country_code:     (c.country_code || best?.country_code || '').toUpperCase(),
          latitude:         best?.latitude  || 0,
          longitude:        best?.longitude || 0,
          timezone:         tz,
          start_datetime:   start.isValid ? start.toUTC().toISO() : null,
          end_datetime:     end.isValid   ? end.toUTC().toISO()   : null,
          kind,
          created_by:       authId,
        };
      });

      // position = array index: visitsToInsert is built in itinerary order, so
      // (start_datetime, position) reproduces it. Order preserved (ids mapped back by index).
      const withPos = visitsToInsert.map((v, i) => ({ ...v, position: i }));
      const { data: insertedVisits, error: visitErr } = await supabase
        .from('city_visits').insert(withPos).select('id');
      if (visitErr) throw visitErr;

      // 4. Batch insert activities
      const activitiesToInsert = [];
      resolved.forEach(({ c, tz }, idx) => {
        const visitId = insertedVisits[idx]?.id;
        if (!visitId) return;
        for (const a of (c.activities || [])) {
          const time    = (a.start_time && /^\d{1,2}:\d{2}/.test(a.start_time)) ? a.start_time.padStart(5, '0').slice(0, 5) : '10:00';
          const endTime = (a.end_time   && /^\d{1,2}:\d{2}/.test(a.end_time))   ? a.end_time.padStart(5, '0').slice(0, 5)   : null;
          const startDt = DateTime.fromISO(`${a.date}T${time}`, { zone: tz });
          if (!startDt.isValid) continue;
          const endDt = endTime
            ? DateTime.fromISO(`${a.date}T${endTime}`, { zone: tz })
            : startDt.plus({ hours: 2 });
          activitiesToInsert.push({
            trip_id:          tripId,
            city_visit_id:    visitId,
            title:            a.title,
            start_datetime:   startDt.toUTC().toISO(),
            end_datetime:     (endDt.isValid ? endDt : startDt.plus({ hours: 2 })).toUTC().toISO(),
            location_address: a.location_address || null,
            currency:         'EUR',
            details:          {},
            created_by:       authId,
          });
        }
      });

      if (activitiesToInsert.length > 0) {
        const { error: actErr } = await supabase.from('activities').insert(activitiesToInsert);
        if (actErr) throw actErr;
      }

      return tripId;
    },
    onMutate: () => { setState('saving'); setSaveError(null); },
    onSuccess: (tripId) => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      nav(`/trip/${tripId}`);
    },
    onError: (err) => {
      setSaveError(err?.message || t('ai_plan.error_save'));
      setState('draft');
    },
  });

  const cities          = draft?.cities || [];
  const totalNights     = cities.reduce((s, c) => s + (c.nights ?? c.n ?? 0), 0);
  const totalActivities = cities.reduce((s, c) => s + (c.activities?.length || 0), 0);
  const hasDraft        = state === 'draft' || state === 'saving';
  const canPrompt       = prompt.trim().length > 0 && state !== 'generating' && state !== 'saving';

  const submitPrompt = () => {
    if (!canPrompt) return;
    planMut.mutate({ promptText: prompt.trim() });
  };

  // Status block text per state
  const aiBlockBg   = state === 'saving' ? 'var(--brand-soft)' : 'var(--ai-soft)';
  const aiBlockNote = state === 'saving' ? 'var(--brand)' : 'var(--ai)';
  let aiBlockText;
  if (state === 'empty')           aiBlockText = t('ai_plan.status_waiting');
  else if (state === 'generating') aiBlockText = t('ai_plan.status_generating');
  else if (state === 'saving')     aiBlockText = t('ai_plan.status_saving');
  else                             aiBlockText = aiComment || t('ai_plan.status_ready');

  // ── Limit guards ───────────────────────────────────────────────────────────
  if (!isPro && checkingLimit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid var(--brand)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
      </div>
    );
  }

  if (isOverLimit) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
        <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
          <button className="app-header__crumb-back" onClick={() => nav('/trips')} title="К трипам"><Icon name="back" size={14} /></button>
          <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
            <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
            <span className="app-header__brand-name">Triplanio</span>
          </div>
          <div className="app-header__crumb">
            <span className="app-header__crumb-sep">/</span>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)' }}>{t('ai_plan.page_title')}</span>
          </div>
          <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />
        </header>
        {/* Full-screen blocker — same UX as the manual planner on direct entry. */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--warning-soft, #fff3cd)', color: 'var(--warning, #e6a817)', display: 'grid', placeItems: 'center', margin: '0 auto 18px' }}>
              <Icon name="lock" size={28} />
            </div>
            <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>Достигнут лимит</h2>
            <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, marginBottom: 24 }}>
              На Free плане доступен только <strong>1 активный трип</strong>. Дождись окончания текущего или перейди на Pro.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Btn variant="ghost" onClick={() => nav('/trips')}>← К трипам</Btn>
              <Btn variant="primary" onClick={() => nav('/pro?hidePerTrip=1')}>Перейти на Pro</Btn>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      {/* Header — same structure as ManualPlanner */}
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <button className="app-header__crumb-back" onClick={() => nav('/trips')} title="К трипам">
          <Icon name="back" size={14} />
        </button>
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__crumb">
          <span className="app-header__crumb-sep">/</span>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-2)' }}>{t('ai_plan.page_title')}</span>
        </div>
        <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />
      </header>

      {/* Body */}
      <div style={{ flex: 1, padding: '32px 24px', maxWidth: 1280, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* Page title — icon + heading + subtitle, with "restart" opposite (matches design) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, var(--ai), #c66ce2)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="sparkles" size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ marginBottom: 6 }}>{t('ai_plan.title')}</h1>
            <div className="muted" style={{ fontSize: 15 }}>{t('ai_plan.page_subtitle')}</div>
          </div>
          <Btn variant="ghost" icon="refresh" onClick={resetAll}>{t('ai_plan.restart')}</Btn>
        </div>

        {/* 50/50 shell — identical across all four states */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }} className="ai-planner-grid">
          {/* ── LEFT — prompt + AI status + chips/hint ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, position: 'sticky', top: 72 }}>
            <div style={{
              background: 'var(--surface)', border: '1.5px solid var(--ai-soft-12)', borderRadius: 14,
              padding: 16,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <TriplanioAvatar size="sm" />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ai)' }}>{t('ai_plan.assistant_label')}</div>
                <span className="muted" style={{ fontSize: 11.5, marginLeft: 'auto' }}>{t('ai_plan.assistant_hint')}</span>
              </div>
              <textarea
                className="textarea"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submitPrompt(); }
                }}
                disabled={state === 'generating' || state === 'saving'}
                placeholder={hasDraft ? t('ai_plan.prompt_placeholder_refine') : t('ai_plan.prompt_placeholder_initial')}
                style={{ minHeight: 130, border: 'none', padding: 0, background: 'transparent', fontSize: 14.5, lineHeight: 1.55, width: '100%', resize: 'none' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end', alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 11, flex: 1 }}>{t('ai_plan.shortcut_hint')}</span>
                {state === 'empty' && (
                  <Btn variant="primary" icon="sparkles" disabled={!canPrompt} onClick={submitPrompt}>
                    {t('ai_plan.generate_draft')}
                  </Btn>
                )}
                {state === 'generating' && (
                  <Btn variant="primary" disabled>
                    {t('ai_plan.thinking')}{' '}
                    <span className="ai-dots" style={{ marginLeft: 6 }}><span /><span /><span /></span>
                  </Btn>
                )}
                {(state === 'draft' || state === 'saving') && (
                  <Btn variant="ai" icon="refresh" disabled={!canPrompt} onClick={submitPrompt}>
                    {t('ai_plan.regenerate')}
                  </Btn>
                )}
              </div>
            </div>

            {/* AI status block — always rendered, content + bg per state */}
            <div style={{
              padding: 14, background: aiBlockBg, borderRadius: 12,
              fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55,
              minHeight: 100, display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TriplanioAvatar size="xs" />
                <b style={{ color: aiBlockNote }}>{t('ai_plan.assistant_label')}</b>
                {state === 'generating' && (
                  <span className="ai-dots" style={{ marginLeft: 'auto', color: 'var(--ai)' }}><span /><span /><span /></span>
                )}
              </div>
              <span style={{ whiteSpace: 'pre-wrap' }}>{aiBlockText}</span>
            </div>

            {/* Save error */}
            {saveError && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 10, background: 'var(--danger-soft, rgba(220,38,38,.08))', color: 'var(--danger, #dc2626)', fontSize: 13 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{saveError}</span>
              </div>
            )}

            {/* Chips / hint — same vertical space across states */}
            <div style={{ minHeight: 40, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {state === 'empty' && [
                t('ai_plan.chip_italy'),
                t('ai_plan.chip_japan'),
                t('ai_plan.chip_balkans'),
              ].map(p => (
                <button key={p} onClick={() => setPrompt(p)} style={{
                  padding: '6px 12px', background: 'var(--surface)',
                  border: '1px solid var(--line)', borderRadius: 999,
                  fontSize: 12.5, cursor: 'pointer', color: 'var(--ink-2)',
                }}>{p}</button>
              ))}
              {state === 'draft' && (
                <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <Info size={12} /> {t('ai_plan.refine_hint')}
                </span>
              )}
            </div>
          </div>

          {/* ── RIGHT — map + draft header + city list + save CTA ── */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Map area */}
            {state === 'empty' && (
              <div style={{
                height: 224, background: 'var(--wash)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderBottom: '1px solid var(--line-2)',
                color: 'var(--muted-2)',
              }}>
                <div style={{ textAlign: 'center', fontSize: 13 }}>
                  <Icon name="map" size={28} style={{ marginBottom: 6, opacity: 0.4 }} />
                  <div>{t('ai_plan.map_placeholder')}</div>
                </div>
              </div>
            )}
            {state === 'generating' && (
              <div style={{ height: 224, position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--line-2)' }}>
                <div style={{ position: 'absolute', inset: 0, background: '#dceaf5' }} />
                <div style={{
                  position: 'absolute', inset: 0,
                  background: 'linear-gradient(90deg, transparent, var(--ai-soft) 50%, transparent)',
                  backgroundSize: '200% 100%', animation: 'shimmer 1.6s linear infinite',
                }} />
              </div>
            )}
            {hasDraft && (
              <div style={{ height: 224, borderBottom: '1px solid var(--line-2)', overflow: 'hidden' }}>
                <AiPlannerMap cities={cities} />
              </div>
            )}

            {/* Header — same height across states */}
            <div style={{ padding: '14px 18px 10px', borderBottom: '1px solid var(--line-2)', minHeight: 64 }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>{t('ai_plan.draft_label')}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                <h2 style={{ marginBottom: 0, fontSize: 20, fontWeight: 700, letterSpacing: '-0.01em' }}>
                  {state === 'empty' ? '—'
                    : state === 'generating' ? <SkeletonBar width={150} />
                      : (draft?.title || t('ai_plan.default_trip_title'))}
                </h2>
                {hasDraft && cities.length > 0 && (
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {totalNights} {t('ai_plan.unit_nights')} · {cities.length} {t('ai_plan.unit_cities')} · {totalActivities} {t('ai_plan.unit_activities')}
                  </span>
                )}
              </div>
            </div>

            {/* Body — list area */}
            <div className="scrollbar-thin" style={{ flex: 1, padding: 14, overflow: 'auto', minHeight: 0, maxHeight: 480, display: 'flex', flexDirection: 'column' }}>
              {state === 'empty' && (
                <div style={{ flex: 1, minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-2)', textAlign: 'center' }}>
                  <div>
                    <Sparkles size={28} style={{ color: 'var(--ai)', marginBottom: 6, display: 'block', marginLeft: 'auto', marginRight: 'auto' }} />
                    <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--muted)' }}>{t('ai_plan.draft_placeholder')}</div>
                    <div style={{ fontSize: 12, marginTop: 4, maxWidth: 260, marginInline: 'auto' }}>{t('ai_plan.draft_placeholder_sub')}</div>
                  </div>
                </div>
              )}
              {state === 'generating' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ padding: 12, border: '1px solid var(--line-2)', borderRadius: 10, display: 'flex', gap: 12, alignItems: 'center' }}>
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--wash)' }} />
                      <div style={{ flex: 1 }}>
                        <SkeletonBar width="60%" height={12} />
                        <div style={{ height: 4 }} />
                        <SkeletonBar width="40%" height={9} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {hasDraft && cities.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {cities.map((c, i) => (
                    <DraftCityCard key={i} city={c} num={i + 1} startCollapsed={cities.length > 3} />
                  ))}
                </div>
              )}
              {hasDraft && cities.length === 0 && (
                <div className="muted" style={{ textAlign: 'center', padding: '32px 0', fontSize: 13 }}>
                  {t('ai_plan.empty_draft_cities')}
                </div>
              )}
            </div>

            {/* Footer — CTA enabled only in draft */}
            <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line-2)' }}>
              <Btn
                variant="primary" block icon="check"
                disabled={state !== 'draft' || cities.length === 0}
                onClick={() => saveMut.mutate()}
              >
                {state === 'saving' ? t('ai_plan.saving')
                  : state === 'draft' ? t('ai_plan.save_trip')
                    : t('ai_plan.save_disabled_hint')}
              </Btn>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 880px) {
          .ai-planner-grid { grid-template-columns: 1fr !important; }
          .ai-planner-grid > div:first-child { position: static !important; top: auto !important; }
        }
      `}</style>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDraftDate(iso) {
  if (!iso) return '';
  const dt = DateTime.fromISO(iso);
  return dt.isValid ? dt.toFormat('d LLL') : iso;
}

function SkeletonBar({ width = '60%', height = 12 }) {
  return (
    <div style={{
      width, height, borderRadius: 4,
      background: 'var(--wash)',
      backgroundImage: 'linear-gradient(90deg, var(--wash), var(--line-2), var(--wash))',
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.6s linear infinite',
    }} />
  );
}

function DraftCityCard({ city, num, startCollapsed }) {
  const [expanded, setExpanded] = useState(!startCollapsed);
  const t = useT();

  // Group activities by date
  const byDay = {};
  (city.activities || []).forEach((a) => {
    const key = a.date || a.day || '';
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(a);
  });
  const days = Object.keys(byDay).sort();

  const nights = city.nights ?? city.n ?? 0;
  const datesLabel = city.start_date && city.end_date
    ? `${fmtDraftDate(city.start_date)} → ${fmtDraftDate(city.end_date)}`
    : (city.dates || '');

  return (
    <div style={{ border: '1px solid var(--line-2)', borderRadius: 12, overflow: 'hidden', background: 'var(--surface)' }}>
      <button onClick={() => setExpanded((e) => !e)} style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '12px 14px',
        background: expanded ? 'var(--wash)' : 'var(--surface)',
        border: 'none', textAlign: 'left', cursor: 'pointer',
      }}>
        <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{num}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            {city.city_name || city.city}
            {city.country && <span className="muted" style={{ fontWeight: 500, fontSize: 12 }}> · {city.country}</span>}
          </div>
          <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>
            {datesLabel}
            {nights ? ` · ${nights} ${t('ai_plan.unit_nights_short')}` : ''}
            {city.activities?.length ? ` · ${city.activities.length} ${t('ai_plan.unit_activities_short')}` : ''}
          </div>
        </div>
        <ChevronDown size={14} style={{ color: 'var(--muted-2)', transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s ease' }} />
      </button>
      {expanded && days.length > 0 && (
        <div style={{ padding: '8px 14px 12px' }}>
          {days.map((d) => (
            <div key={d} style={{ marginTop: 8 }}>
              <div className="eyebrow" style={{ fontSize: 10.5, marginBottom: 6 }}>{fmtDraftDate(d)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
                <div style={{ position: 'absolute', left: 32, top: 8, bottom: 8, width: 2, background: 'var(--line-2)' }} />
                {byDay[d].map((a, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', position: 'relative', zIndex: 1 }}>
                    <div className="num" style={{ width: 44, fontSize: 12, fontWeight: 600, color: 'var(--muted)', flexShrink: 0 }}>
                      {a.start_time || a.time || '—'}
                    </div>
                    <div style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: 'var(--surface)',
                      border: '2px solid var(--ev-activity)',
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, fontSize: 13, lineHeight: 1.35 }}>{a.title || a.name}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
