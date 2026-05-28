import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, SlidersHorizontal, Sparkles, Wallet, Calendar as CalendarIcon, Hotel as HotelIcon, Send, MessageSquare } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import TripAccessDenied from '@/components/TripAccessDenied';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import AddonRow from '@/components/settings/AddonRow';
import TelegramAssistantPanel from '@/components/settings/TelegramAssistantPanel';
import { ADDON_KEYS, getAddons } from '@/lib/tripAddons';
import TripShell from '@/components/trips/TripShell';
import TripHeader from '@/components/trips/TripHeader';

export default function TripSettings() {
  const { tripId } = useParams();
  const qc = useQueryClient();
  const t = useT();
  const { user } = useAuth();

  // Trip + access + budget + members
  const { data: trip, isLoading: tripLoading } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => base44.entities.Trip.get(tripId),
  });
  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['trip-members', tripId],
    queryFn: () => base44.entities.TripMember.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });
  // Cities for the static TripHeader on top of the page.
  const { data: visits = [] } = useQuery({
    queryKey: ['trip-visits', tripId],
    queryFn: () => base44.entities.CityVisit.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });
  const { data: budgets = [] } = useQuery({
    queryKey: ['trip-budget', tripId],
    queryFn: () => base44.entities.TripBudget.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });

  // Owner's personal Pro status (used to unlock Pro-only addons even if the trip itself isn't Pro).
  const { data: myProStatus } = useQuery({
    queryKey: ['my-pro-status'],
    queryFn: async () => {
      const res = await base44.functions.invoke('checkSubscriptionStatus', {});
      return !!res?.data?.isPro;
    },
  });

  // Trip-level Pro (is_pro_trip OR owner subscription).
  const { data: tripPro } = useQuery({
    queryKey: ['trip-pro', tripId],
    queryFn: async () => {
      const res = await base44.functions.invoke('checkSubscriptionStatus', { tripId });
      return !!res?.data?.isPro;
    },
    enabled: !!tripId,
  });

  const access = useMemo(() => {
    if (!trip || !user) return { loading: true, allowed: false, role: null };
    if (trip.created_by === user.email) return { loading: false, allowed: true, role: 'owner' };
    if (membersLoading) return { loading: true, allowed: false, role: null };
    const me = members.find(m => m.user_email === user.email && m.status === 'active');
    return { loading: false, allowed: !!me, role: me?.role || null };
  }, [trip, user, members, membersLoading]);

  const nav = useNavigate();
  const openUpgrade = () => nav(`/pro?tripId=${tripId}`);

  // Mutations
  // Optimistic update: write the new `details` into both ['trip', tripId] and
  // ['trip-shell', tripId] BEFORE the network call returns. Without this, the
  // user toggles an addon, navigates back to TripView, and has to wait for
  // the refetch round-trip before the sidebar card reflects the new state
  // (e.g. the "See details" click would briefly still open the upsell modal).
  const updateTripMut = useMutation({
    mutationFn: (patch) => base44.entities.Trip.update(tripId, patch),
    onMutate: async (patch) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ['trip', tripId] }),
        qc.cancelQueries({ queryKey: ['trip-shell', tripId] }),
      ]);
      const prevTrip = qc.getQueryData(['trip', tripId]);
      const prevShell = qc.getQueryData(['trip-shell', tripId]);
      if (prevTrip) {
        qc.setQueryData(['trip', tripId], { ...prevTrip, ...patch });
      }
      if (prevShell?.trip) {
        qc.setQueryData(['trip-shell', tripId], {
          ...prevShell,
          trip: { ...prevShell.trip, ...patch },
        });
      }
      return { prevTrip, prevShell };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prevTrip) qc.setQueryData(['trip', tripId], ctx.prevTrip);
      if (ctx?.prevShell) qc.setQueryData(['trip-shell', tripId], ctx.prevShell);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['trip', tripId] });
      qc.invalidateQueries({ queryKey: ['trip-shell', tripId] });
    },
  });

  const updateBudgetCurrencyMut = useMutation({
    mutationFn: async (currency) => {
      const existing = budgets[0];
      // fx_overrides are tied to the OLD main currency — once the main
      // currency changes, they become meaningless. Reset them.
      if (existing) {
        return base44.entities.TripBudget.update(existing.id, { currency, fx_overrides: {} });
      }
      return base44.entities.TripBudget.create({ trip_id: tripId, currency, fx_overrides: {} });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-budget', tripId] });
    },
  });

  // Loading / access gate
  if (tripLoading || !trip || access.loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  const canEdit = access.role === 'owner' || access.role === 'admin';
  if (!access.allowed || !canEdit) {
    return <TripAccessDenied />;
  }

  const addons = getAddons(trip);
  const budget = budgets[0] || null;
  const mainCurrency = budget?.currency || 'EUR';

  // A Pro-only addon is unlocked if the trip itself is Pro OR the user has personal Pro.
  const proUnlocked = !!tripPro || !!myProStatus;

  const handleAddonToggle = (key, proOnly, value) => {
    if (proOnly && !proUnlocked && value === true) {
      openUpgrade();
      return;
    }
    const nextAddons = { ...addons, [key]: value };
    const nextDetails = { ...(trip.details || {}), addons: nextAddons };
    updateTripMut.mutate({ details: nextDetails });
  };

  return (
    <TripShell trip={trip} tripId={tripId} access={access}>
    <div className="max-w-4xl mx-auto pb-12">
      <TripHeader trip={trip} visits={visits} />
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display font-bold text-3xl sm:text-4xl tracking-tight">
          {t('trip.settings_title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('trip.settings_subtitle')}
        </p>
      </div>

      {/* SECTION: Preferences */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b">
          <SlidersHorizontal className="w-4 h-4 text-foreground" />
          <h2 className="font-semibold text-base">{t('trip.section_preferences')}</h2>
        </div>
        <div className="space-y-2.5">
          {/* Trip Currency (= TripBudget.currency) — horizontal row */}
          <div className="rounded-xl border bg-card px-4 py-3 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{t('trip.display_currency')}</div>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                {t('trip.display_currency_hint')}
              </p>
            </div>
            <div className="shrink-0 w-48 max-w-[55%]">
              <CurrencyCombobox
                value={mainCurrency}
                onChange={(c) => updateBudgetCurrencyMut.mutate(c)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* SECTION: Addons */}
      <div>
        <div className="flex items-center gap-2 mb-3 pb-2 border-b">
          <Sparkles className="w-4 h-4 text-foreground" />
          <h2 className="font-semibold text-base">{t('trip.section_addons')}</h2>
        </div>
        <div className="space-y-2.5">
          <AddonRow
            icon={CalendarIcon}
            title={t('trip.addon_calendar_title')}
            description={t('trip.addon_calendar_desc')}
            enabled={addons[ADDON_KEYS.CALENDAR_VIEW]}
            onToggle={(v) => handleAddonToggle(ADDON_KEYS.CALENDAR_VIEW, false, v)}
            disabled={updateTripMut.isPending}
          />
          <AddonRow
            icon={Wallet}
            title={t('trip.addon_budget_title')}
            description={t('trip.addon_budget_desc')}
            enabled={addons[ADDON_KEYS.BUDGET]}
            proOnly
            proLocked={!proUnlocked && !addons[ADDON_KEYS.BUDGET]}
            onProLockedClick={openUpgrade}
            onToggle={(v) => handleAddonToggle(ADDON_KEYS.BUDGET, true, v)}
            disabled={updateTripMut.isPending}
          />
          <AddonRow
            icon={HotelIcon}
            title={t('trip.addon_hotels_title')}
            description={t('trip.addon_hotels_desc')}
            enabled={false}
            onToggle={() => {}}
            disabled
            comingSoon
          />
          <AddonRow
            icon={Send}
            title={t('trip.addon_telegram_title')}
            description={t('trip.addon_telegram_desc')}
            enabled={addons[ADDON_KEYS.TELEGRAM_ASSISTANT]}
            proOnly
            proLocked={!proUnlocked && !addons[ADDON_KEYS.TELEGRAM_ASSISTANT]}
            onProLockedClick={openUpgrade}
            onToggle={(v) => handleAddonToggle(ADDON_KEYS.TELEGRAM_ASSISTANT, true, v)}
            disabled={updateTripMut.isPending}
            expandableContent={<TelegramAssistantPanel tripId={tripId} />}
          />
          <AddonRow
            icon={MessageSquare}
            title={t('trip.addon_chat_title')}
            description={t('trip.addon_chat_desc')}
            enabled={addons[ADDON_KEYS.CHAT]}
            proOnly
            proLocked={!proUnlocked && !addons[ADDON_KEYS.CHAT]}
            onProLockedClick={openUpgrade}
            onToggle={(v) => handleAddonToggle(ADDON_KEYS.CHAT, true, v)}
            disabled={updateTripMut.isPending}
          />
        </div>
      </div>

    </div>
    </TripShell>
  );
}