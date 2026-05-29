import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { Sparkles, RefreshCw, Map as MapIcon, Info, AlertTriangle, ChevronDown } from 'lucide-react';
import { supabase } from '@/api/supabaseClient';
import { searchCities, getTimezone } from '@/lib/geo';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { useToast } from '@/components/ui/use-toast';
import { Btn } from '@/design/index';
import AiTripMiniMap from '@/components/trips/AiTripMiniMap';

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

  // ── Save draft as a real Trip (+CityVisits +Activities) ──────────────────
  const saveMut = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error(t('ai_plan.no_draft_error'));
      const cities = draft.cities || [];

      // 1. Create trip via base44 entity layer (kept untouched per spec)
      const { base44 } = await import('@/api/base44Client');
      const trip = await base44.entities.Trip.create({
        title: draft.title || t('ai_plan.default_trip_title'),
        description: draft.description || '',
      });

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

      // 3. Create city visits
      const createdVisits = [];
      for (const { c, best, tz } of resolved) {
        const kind = (c.kind === 'start' || c.kind === 'end') ? c.kind : 'transit';
        const start = DateTime.fromISO(c.start_date, { zone: tz || 'UTC' })
          .set({ hour: 12, minute: 0 });
        const end = DateTime.fromISO(c.end_date, { zone: tz || 'UTC' })
          .set({ hour: 12, minute: 0 });
        const visit = await base44.entities.CityVisit.create({
          trip_id: trip.id,
          external_city_id: best?.external_city_id || '',
          city_name: c.city_name,
          country: c.country || best?.country || '',
          country_code: (c.country_code || best?.country_code || '').toUpperCase(),
          latitude: best?.latitude || 0,
          longitude: best?.longitude || 0,
          timezone: tz || 'UTC',
          start_datetime: start.isValid ? start.toUTC().toISO() : undefined,
          end_datetime: end.isValid ? end.toUTC().toISO() : undefined,
          kind,
        });
        createdVisits.push({ visit, source: c, tz: tz || 'UTC' });
      }

      // 4. Create activities
      for (const { visit, source, tz } of createdVisits) {
        for (const a of (source.activities || [])) {
          const time = (a.start_time && /^\d{1,2}:\d{2}/.test(a.start_time))
            ? a.start_time.padStart(5, '0').slice(0, 5)
            : '10:00';
          const endTime = (a.end_time && /^\d{1,2}:\d{2}/.test(a.end_time))
            ? a.end_time.padStart(5, '0').slice(0, 5)
            : null;
          const startDt = DateTime.fromISO(`${a.date}T${time}`, { zone: tz });
          if (!startDt.isValid) continue;
          const endDt = endTime
            ? DateTime.fromISO(`${a.date}T${endTime}`, { zone: tz })
            : startDt.plus({ hours: 2 });
          await base44.entities.Activity.create({
            trip_id: trip.id,
            city_visit_id: visit.id,
            title: a.title,
            start_datetime: startDt.toUTC().toISO(),
            end_datetime: (endDt.isValid ? endDt : startDt.plus({ hours: 2 })).toUTC().toISO(),
            location_address: a.location_address || '',
            currency: 'EUR',
          });
        }
      }

      return trip;
    },
    onMutate: () => { setState('saving'); setSaveError(null); },
    onSuccess: (trip) => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      nav(`/trip/${trip.id}`);
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
  if (state === 'empty')       aiBlockText = t('ai_plan.status_waiting');
  else if (state === 'generating') aiBlockText = t('ai_plan.status_generating');
  else if (state === 'saving')     aiBlockText = t('ai_plan.status_saving');
  else                              aiBlockText = aiComment || t('ai_plan.status_ready');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, var(--ai), #c66ce2)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Sparkles size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 4 }}>{t('ai_plan.page_title')}</h1>
            <div className="muted" style={{ fontSize: 14 }}>{t('ai_plan.page_desc')}</div>
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
                <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg, var(--ai), #c66ce2)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700 }}>AI</div>
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
                <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg, var(--ai), #c66ce2)', color: 'white', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700 }}>AI</div>
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
                display: 'grid', placeItems: 'center',
                borderBottom: '1px solid var(--line-2)',
                color: 'var(--muted-2)',
              }}>
                <div style={{ textAlign: 'center', fontSize: 13 }}>
                  <MapIcon size={28} style={{ marginBottom: 6 }} />
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
              <div style={{ height: 224, borderBottom: '1px solid var(--line-2)' }}>
                <AiTripMiniMap cities={cities} />
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
            <div className="scrollbar-thin" style={{ flex: 1, padding: 14, overflow: 'auto', minHeight: 320, maxHeight: 480 }}>
              {state === 'empty' && (
                <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: 'var(--muted-2)', textAlign: 'center' }}>
                  <div>
                    <Sparkles size={28} style={{ color: 'var(--ai)', marginBottom: 6 }} />
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
    ? `${city.start_date} → ${city.end_date}`
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
              <div className="eyebrow" style={{ fontSize: 10.5, marginBottom: 6 }}>{d}</div>
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
