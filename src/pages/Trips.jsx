import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, LayoutGrid, List, Sparkles } from 'lucide-react';
import TripCardGrid from '@/components/trips/TripCardGrid';
import TripListRow from '@/components/trips/TripListRow';
import TripListSkeleton from '@/components/trips/TripListSkeleton';
import TripFormDialog from '@/components/trips/TripFormDialog';
import NewTripModal from '@/components/trips/NewTripModal';
import TripLimitDialog from '@/components/subscriptions/TripLimitDialog';
import UpgradePlanDialog from '@/components/subscriptions/UpgradePlanDialog';
import PullToRefresh from '@/components/common/PullToRefresh';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { isTripInPast } from '@/lib/trip-dates';
import { cn } from '@/lib/utils';

export default function Trips() {
  const { t } = useI18nFormat();
  const { user } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();

  const handleRefresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['trips'] }),
      qc.invalidateQueries({ queryKey: ['my-memberships'] }),
      qc.invalidateQueries({ queryKey: ['all-city-visits-by-trips'] }),
    ]);
  };

  const [showNewTripModal, setShowNewTripModal] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showLimitDialog, setShowLimitDialog] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [allowCreate, setAllowCreate] = useState(false);
  const [pendingPick, setPendingPick] = useState(null);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('active'); // 'active' | 'past'
  const [viewMode, setViewMode] = useState(() => {
    try {
      const stored = localStorage.getItem('trips:viewMode');
      return stored === 'list' ? 'list' : 'grid';
    } catch {return 'grid';}
  });

  React.useEffect(() => {
    try {localStorage.setItem('trips:viewMode', viewMode);} catch {/* ignore */}
  }, [viewMode]);

  // All accessible trips (RLS handles own + shared filtering via is_trip_participant)
  const { data: allTrips = [], isLoading } = useQuery({
    queryKey: ['trips', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Active memberships for this user (to detect shared trips and get role)
  const { data: myMemberships = [] } = useQuery({
    queryKey: ['my-memberships', user?.email],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trip_members')
        .select('*')
        .eq('user_email', user.email)
        .eq('status', 'active');
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.email,
  });

  const ownTrips = allTrips.filter((t) => t.created_by === user?.email);
  const sharedOnly = allTrips.filter((t) => t.created_by !== user?.email);

  const tripIdsKey = [...ownTrips.map((t) => t.id), ...sharedOnly.map((t) => t.id)].join(',');
  const hasAnyTrip = ownTrips.length + sharedOnly.length > 0;

  const { data: allVisits = [], isLoading: isLoadingVisits } = useQuery({
    queryKey: ['all-city-visits-by-trips', tripIdsKey],
    queryFn: async () => {
      const ids = [...ownTrips.map((t) => t.id), ...sharedOnly.map((t) => t.id)];
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from('city_visits')
        .select('*')
        .in('trip_id', ids);
      if (error) throw error;
      return data || [];
    },
    enabled: hasAnyTrip,
  });

  const visitsByTrip = useMemo(() => {
    const m = {};
    allVisits.forEach((v) => {(m[v.trip_id] ||= []).push(v);});
    return m;
  }, [allVisits]);

  const matches = (tr) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return tr.title?.toLowerCase().includes(q) || tr.description?.toLowerCase().includes(q);
  };

  const partition = (trips) => {
    const active = [],past = [];
    trips.forEach((tr) => {
      if (isTripInPast(visitsByTrip[tr.id] || [])) past.push(tr);else
      active.push(tr);
    });
    return { active, past };
  };

  const filteredOwnAll = ownTrips.filter(matches);
  const filteredSharedAll = sharedOnly.filter(matches);
  const ownSplit = partition(filteredOwnAll);
  const sharedSplit = partition(filteredSharedAll);

  const activeTrips = filterMode === 'active' ?
  [...ownSplit.active, ...sharedSplit.active] :
  [...ownSplit.past, ...sharedSplit.past];

  const totalCount = ownTrips.length + sharedOnly.length;

  // Pro status — derived from user profile (no separate request needed)
  const isPro = ['pro_monthly', 'pro_yearly', 'pro_trip'].includes(user?.subscription_status);

  const checkLimitAndProceed = (pick, callback) => {
    const allActive = [...ownSplit.active, ...sharedSplit.active];
    if (!isPro && allActive.length > 0) {
      setPendingPick(pick);
      setShowLimitDialog(true);
    } else {
      callback();
    }
  };

  const handleManualPick = () => {
    const allActive = [...ownSplit.active, ...sharedSplit.active];
    if (!isPro && allActive.length > 0) {
      setPendingPick('manual');
      setShowLimitDialog(true);
    } else {
      setAllowCreate(true);
      setShowCreate(true);
    }
  };

  const handleAiPick = () => {
    const allActive = [...ownSplit.active, ...sharedSplit.active];
    if (!isPro && allActive.length > 0) {
      setPendingPick('ai');
      setShowLimitDialog(true);
    } else {
      nav('/plan-trip-ai');
    }
  };

  const handleProceedCreate = () => {
    setShowLimitDialog(false);
    if (pendingPick === 'ai') {
      nav('/plan-trip-ai');
    } else {
      setAllowCreate(true);
      setShowCreate(true);
    }
    setPendingPick(null);
  };

  // Handler for empty state "Start with AI" button — checks limit before navigating
  const handleEmptyStateAi = () => {
    const allActive = [...ownSplit.active, ...sharedSplit.active];
    if (!isPro && allActive.length > 0) {
      setPendingPick('ai');
      setShowLimitDialog(true);
    } else {
      nav('/plan-trip-ai');
    }
  };

  const isLoadingData = isLoading || hasAnyTrip && isLoadingVisits;
  const gridCls = viewMode === 'list' ?
  'flex flex-col gap-2' :
  'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5';

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight">{t('trips.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {ownSplit.active.length + sharedSplit.active.length} {t('trips.active').toLowerCase()} · {ownSplit.past.length + sharedSplit.past.length} {t('trips.past').toLowerCase()}
            </p>
          </div>
          <Button size="lg" onClick={() => setShowNewTripModal(true)} className="shadow-lg shadow-primary/20">
            <Plus className="w-4 h-4 mr-1.5" />{t('trips.new')}
          </Button>
        </div>

        {/* Filter & Search & View Mode */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="inline-flex border border-border rounded-xl p-1 bg-card shrink-0">
            <button
              onClick={() => setFilterMode('active')}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap rounded-md",
                filterMode === 'active' ?
                'bg-background shadow-sm text-foreground' :
                'text-muted-foreground hover:text-foreground'
              )}>
              
              {t('trips.active')} · {ownSplit.active.length + sharedSplit.active.length}
            </button>
            <button
              onClick={() => setFilterMode('past')}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap rounded-md",
                filterMode === 'past' ?
                'bg-background shadow-sm text-foreground' :
                'text-muted-foreground hover:text-foreground'
              )}>
              
              {t('trips.past')} · {ownSplit.past.length + sharedSplit.past.length}
            </button>
          </div>

          <div className="flex-1 relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('common.search')} className="pl-9 h-10 bg-white dark:bg-card" />
          </div>

          <div className="inline-flex border border-border rounded-lg p-0.5 bg-card shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label={t('trips.view_grid')}
              title={t('trips.view_grid')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label={t('trips.view_list')}
              title={t('trips.view_list')}
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}>
              
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        {isLoadingData ?
        <TripListSkeleton viewMode={viewMode} /> :
        activeTrips.length === 0 ?
        filterMode === 'active' ?
        <div className="rounded-2xl overflow-hidden border border-primary/20">
            {/* Light theme */}
            <div className="dark:hidden rounded-2xl bg-gradient-to-br from-blue-50 via-blue-100 to-blue-50">
              <div className="py-12 px-6 text-center">
                <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                  <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </div>
                <h3 className="font-display font-bold text-xl mb-2 text-foreground">{t('trips.empty_title')}</h3>
                <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-7 leading-relaxed">{t('trips.empty_subtitle')}</p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <Button size="lg" className="shadow-md shadow-primary/25 gap-2 bg-primary hover:bg-primary/90" onClick={() => setShowNewTripModal(true)}>
                    <Plus className="w-4 h-4" />{t('trips.new')}
                  </Button>
                  <Button size="lg" variant="outline" className="gap-2 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100" onClick={handleEmptyStateAi}>
                    <Sparkles className="w-4 h-4 text-violet-600" />{t('trips.start_with_ai')}
                  </Button>
                </div>
              </div>
            </div>
            {/* Dark theme */}
            <div className="hidden dark:block rounded-2xl bg-gradient-to-br from-slate-800 via-slate-750 to-slate-800">
              <div className="py-12 px-6 text-center">
                <div className="mx-auto mb-6 w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
                  <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </div>
                <h3 className="font-display font-bold text-xl mb-2 text-white">{t('trips.empty_title')}</h3>
                <p className="text-sm text-slate-300 max-w-xs mx-auto mb-7 leading-relaxed">{t('trips.empty_subtitle')}</p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <Button size="lg" className="shadow-md shadow-primary/25 gap-2 bg-primary hover:bg-primary/90" onClick={() => setShowNewTripModal(true)}>
                    <Plus className="w-4 h-4" />{t('trips.new')}
                  </Button>
                  <Button size="lg" variant="outline" className="gap-2 border-violet-700 bg-violet-900/40 text-violet-300 hover:bg-violet-900/60" onClick={handleEmptyStateAi}>
                    <Sparkles className="w-4 h-4 text-violet-400" />{t('trips.start_with_ai')}
                  </Button>
                </div>
              </div>
            </div>
          </div> :

        <div className="rounded-2xl border-2 border-dashed border-border bg-card/40 p-8 sm:p-12 text-center">
            <h3 className="font-display text-lg font-semibold mb-2">{t('trips.no_trips')}</h3>
            <p className="text-muted-foreground">{t('trips.no_past_trips')}</p>
          </div> :


        <div className={gridCls}>
            {activeTrips.map((trip) => {
            const isShared = myMemberships.some((m) => m.trip_id === trip.id);
            const membership = myMemberships.find((m) => m.trip_id === trip.id);
            const cities = visitsByTrip[trip.id] || [];
            return (
              <div key={trip.id}>
                  {viewMode === 'list' ?
                <TripListRow
                  trip={trip}
                  cities={cities}
                  isInvited={isShared}
                  role={membership?.role} /> :


                <TripCardGrid
                  trip={trip}
                  cities={cities}
                  isInvited={isShared}
                  role={membership?.role} />

                }
                </div>);

          })}

            {/* Add trip placeholder (only in grid) */}
            {viewMode === 'grid' &&
          <button
            type="button"
            onClick={() => setShowNewTripModal(true)}
            className="rounded-2xl border-2 border-dashed border-border bg-card/40 hover:bg-card/60 transition flex flex-col items-center justify-center gap-4 p-8 h-full">
            
                <Plus className="w-8 h-8 text-muted-foreground" />
                <div className="text-center">
                  <div className="font-semibold text-foreground">{t('trips.new')}</div>
                  <div className="text-xs text-muted-foreground mt-1">{t('trips.manual_desc')}</div>
                </div>
              </button>
          }
          </div>
        }

        {/* Free-plan banner — shown only when user is non-Pro AND has at least 1 active trip */}
        {!isPro && ownSplit.active.length + sharedSplit.active.length >= 1 &&
        <div className="rounded-2xl bg-gradient-to-r from-violet-100 via-purple-50 to-violet-100 dark:from-violet-950/50 dark:via-purple-950/30 dark:to-violet-950/50 border border-violet-200/40 dark:border-violet-800/30 p-6 flex items-center justify-between gap-4 mt-4">
            <div>
              <h3 className="font-semibold text-foreground mb-1">{t('trips.free_limit_title')}</h3>
              <p className="text-sm text-muted-foreground">{t('trips.free_limit_desc')}</p>
            </div>
            <Button size="lg" onClick={() => setShowUpgradeDialog(true)} className="shrink-0 bg-primary hover:bg-primary/90">
              {t('trips.upgrade_to_pro')}
            </Button>
          </div>
        }

        {/* Dialogs */}
        <NewTripModal
          open={showNewTripModal}
          onOpenChange={setShowNewTripModal}
          onManualPick={handleManualPick}
          onAiPick={handleAiPick} />
        
        <TripLimitDialog
          open={showLimitDialog}
          onOpenChange={setShowLimitDialog}
          onProceed={handleProceedCreate}
          activeCount={ownSplit.active.length + sharedSplit.active.length}
          isPro={isPro} />
        
        <UpgradePlanDialog
          open={showUpgradeDialog}
          onOpenChange={setShowUpgradeDialog}
          hidePerTrip
          onUpgradeComplete={() => {
            qc.invalidateQueries({ queryKey: ['me'] });
            setShowUpgradeDialog(false);
          }} />
        
        
        <TripFormDialog open={showCreate} onOpenChange={setShowCreate} />
      </div>
    </PullToRefresh>);

}