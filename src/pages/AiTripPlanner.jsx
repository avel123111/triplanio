import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Loader2, Bot, Save, RefreshCw, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { searchCities, getTimezone } from '@/lib/geo';
import { useT, useI18n } from '@/lib/i18n/I18nContext';
import { useToast } from '@/components/ui/use-toast';
import AiTripDraftPreview from '@/components/trips/AiTripDraftPreview';
import TripLimitDialog from '@/components/subscriptions/TripLimitDialog';
import { useAuth } from '@/lib/AuthContext';

/**
 * Full-page AI trip planner.
 * Flow:
 *  1. Check Pro status and trip limit
 *  2. User enters prompt → backend returns draft + ai_comment
 *  3. User can refine via more prompts
 *  4. On save: create Trip + CityVisit + Activity records
 */
export default function AiTripPlanner() {
  const t = useT();
  const { lang } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const { toast } = useToast();

  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState(null);
  const [aiComment, setAiComment] = useState('');
  const [history, setHistory] = useState([]);
  const [saveError, setSaveError] = useState(null);
  const [isPro, setIsPro] = useState(false);
  const [loadingCheck, setLoadingCheck] = useState(true);
  const [showLimitDialog, setShowLimitDialog] = useState(false);
  const [activeCount, setActiveCount] = useState(0);

  // Check Pro status and trip limit on mount
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const res = await base44.functions.invoke('checkSubscriptionStatus', { tripId: null });
        setIsPro(res.data.isPro || false);
        
        // If not Pro, check trip count and show limit dialog if needed
        if (!res.data.isPro) {
          const tripsRes = await base44.functions.invoke('getActiveTrips', {});
          const count = tripsRes.data?.activeCount || 0;
          setActiveCount(count);
          
          // Block access if free user already has 1 active trip
          if (count >= 1) {
            setShowLimitDialog(true);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingCheck(false);
      }
    };
    checkAccess();
  }, []);

  const resetAll = () => {
    setPrompt('');
    setDraft(null);
    setAiComment('');
    setHistory([]);
    setSaveError(null);
  };

  // AI call
  const planMut = useMutation({
    mutationFn: async ({ promptText, draftSnapshot, historySnapshot }) => {
      const res = await base44.functions.invoke('planTripWithAi', {
        prompt: promptText,
        currentDraft: draftSnapshot,
        history: historySnapshot,
        language: lang || 'ru',
      });
      return res.data;
    },
    onSuccess: (data, vars) => {
      if (data?.draft) setDraft(data.draft);
      const comment = data?.ai_comment || '';
      setAiComment(comment);
      setHistory(h => [...h, { role: 'user', text: vars.promptText }, { role: 'ai', text: comment }]);
      setPrompt('');
    },
    onError: (err) => {
      toast({
        title: t('ai_plan.error_plan_title'),
        description: err?.message || t('ai_plan.error_plan_desc'),
        variant: 'destructive',
      });
    },
  });

  // Save draft as real trip
  const saveMut = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error(t('ai_plan.no_draft_error'));
      const cities = draft.cities || [];

      // 1. Create trip
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
            location_name: a.location_name || '',
            location_address: a.location_address || '',
            currency: 'EUR',
          });
        }
      }

      return trip;
    },
    onSuccess: (trip) => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      nav(`/trip/${trip.id}`);
    },
    onError: (err) => {
      setSaveError(err?.message || t('ai_plan.error_save'));
    },
  });

  const isLoading = planMut.isPending || saveMut.isPending;
  const canPlan = prompt.trim().length > 0 && !planMut.isPending;
  const isGenerating = planMut.isPending;

  if (loadingCheck) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="border-b bg-card sticky top-0 z-40">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-6">
            <div className="flex items-start gap-4 mb-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary via-purple-500 to-accent text-white flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-2xl sm:text-3xl font-bold">{t('ai_plan.page_title')}</h1>
                <p className="text-sm text-muted-foreground mt-1">{t('ai_plan.page_desc')}</p>
              </div>
              <button
                onClick={() => nav('/')}
                className="text-muted-foreground hover:text-foreground transition text-sm whitespace-nowrap"
              >
                {t('ai_plan.start_over')}
              </button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            {/* Left: Prompt input */}
            <div className="space-y-4">
              {/* AI comment */}
              {aiComment && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 flex gap-2.5">
                  <Bot className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <div className="text-sm leading-snug whitespace-pre-wrap">{aiComment}</div>
                </div>
              )}

              {/* Prompt input */}
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">
                  {draft ? t('ai_plan.prompt_label_refine') : t('ai_plan.prompt_label_initial')}
                </label>
                <Textarea
                  rows={draft ? 4 : 6}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={draft ? t('ai_plan.prompt_placeholder_refine') : t('ai_plan.prompt_placeholder_initial')}
                  disabled={isGenerating || saveMut.isPending}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canPlan) {
                      planMut.mutate({ promptText: prompt, draftSnapshot: draft, historySnapshot: history });
                    }
                  }}
                  className="text-base"
                />
                <div className="text-[11px] text-muted-foreground">
                  {t('ai_plan.shortcut_hint')}
                </div>
              </div>

              {/* Error */}
              {saveError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {saveError}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => nav('/')}
                  disabled={isLoading}
                  size="sm"
                >
                  {t('common.cancel')}
                </Button>
                {draft && (
                  <Button
                    variant="ghost"
                    onClick={resetAll}
                    disabled={isLoading}
                    className="text-muted-foreground"
                    size="sm"
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    {t('ai_plan.restart')}
                  </Button>
                )}
                <div className="flex-1" />
                <Button
                  onClick={() => planMut.mutate({ promptText: prompt, draftSnapshot: draft, historySnapshot: history })}
                  disabled={!canPlan || isGenerating}
                  className="gap-2"
                  size="sm"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t('ai_plan.thinking')}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      {draft ? t('ai_plan.refine') : t('ai_plan.plan')}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Right: Draft preview / skeleton / empty */}
            <div className="lg:sticky lg:top-24">
              {isGenerating && !draft ? (
                <div className="bg-card rounded-xl border border-border p-8">
                  <AiTripDraftPreview draft={null} loading />
                </div>
              ) : draft ? (
                <div className="bg-card rounded-xl border border-border p-8">
                  <AiTripDraftPreview draft={draft} />
                  <Button
                    onClick={() => saveMut.mutate()}
                    disabled={isLoading || !draft.cities?.length}
                    className="w-full mt-4 h-11 text-base"
                  >
                    {saveMut.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t('ai_plan.saving')}
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4 mr-2" />
                        {t('ai_plan.save_trip')}
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="bg-card rounded-xl border border-dashed border-border p-8">
                  <div className="text-center space-y-3">
                    <Sparkles className="w-12 h-12 text-muted-foreground mx-auto" />
                    <div>
                      <p className="text-sm text-muted-foreground">{t('ai_plan.draft_placeholder')}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <TripLimitDialog
        open={showLimitDialog}
        onOpenChange={setShowLimitDialog}
        onProceed={() => {
          setShowLimitDialog(false);
        }}
        activeCount={activeCount}
        isPro={isPro}
      />
    </>
  );
}