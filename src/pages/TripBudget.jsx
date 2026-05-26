/**
 * Trip Budget page — v4.
 *
 * Layout: full-width adaptive (matches TripShell).
 *
 * Top: 3 summary cards — total, per-person, FX rates (first 2 + edit button).
 * Warning row if any currency has no rate.
 * Controls row: groupBy toggle (categories / cities) + add category + add expense.
 * Master–detail split: left list of categories (or cities), right panel of expenses.
 */
import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Loader2, AlertTriangle, Pencil, Plus, BedDouble, Plane, Camera,
  Smartphone, Car, Wallet } from
'lucide-react';
import { Button } from '@/components/ui/button';
import TripAccessDenied from '@/components/TripAccessDenied';
import { useTripAccess } from '@/lib/useTripAccess';
import { useT } from '@/lib/i18n/I18nContext';
import { useFxRates } from '@/lib/fx';
import { fmtMoney, toMain } from '@/lib/budget/money';
import { SYSTEM_KEY_ORDER, SYSTEM_CATEGORY_NAME_KEY } from '@/lib/budget/constants';
import { resolveCustomCategoryStyle } from '@/lib/budget/categoryStyles';
import ExpenseDialog from '@/components/budget/ExpenseDialog';
import CategoryNameDialog from '@/components/budget/CategoryNameDialog';
import FxOverridesDialog from '@/components/budget/FxOverridesDialog';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import TripShell from '@/components/trips/TripShell';
import TripPageHeader from '@/components/trips/TripPageHeader';
import SourceViewLoader from '@/components/budget/SourceViewLoader';

// ── Shared system icon map ────────────────────────────────────────────────
const SYSTEM_ICON = {
  accommodation: { Icon: BedDouble, color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  transport: { Icon: Plane, color: 'bg-primary/10 text-primary' },
  activities: { Icon: Camera, color: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' },
  services: { Icon: Smartphone, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' }
};
const SOURCE_ICONS = {
  hotel: { Icon: BedDouble, color: 'text-blue-600 dark:text-blue-300 bg-blue-100 dark:bg-blue-950/40' },
  transfer: { Icon: Plane, color: 'text-primary bg-primary/10' },
  activity: { Icon: Camera, color: 'text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-950/40' },
  service: { Icon: Smartphone, color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40' },
  car_rental: { Icon: Car, color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40' }
};

function getCategoryIcon(category) {
  if (category.kind === 'system') {
    const m = SYSTEM_ICON[category.system_key];
    return m ? { Icon: m.Icon, colorClass: m.color } : null;
  }
  return resolveCustomCategoryStyle(category);
}

// ── Main component ────────────────────────────────────────────────────────
export default function TripBudget() {
  const { tripId } = useParams();
  const t = useT();
  const qc = useQueryClient();

  const { data: trip, isLoading: tripLoading } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: () => base44.entities.Trip.get(tripId)
  });
  const access = useTripAccess(trip);

  const { data: visits = [] } = useQuery({
    queryKey: ['trip-visits', tripId],
    queryFn: () => base44.entities.CityVisit.filter({ trip_id: tripId }),
    enabled: !!tripId
  });
  const { data: members = [] } = useQuery({
    queryKey: ['trip-members', tripId],
    queryFn: () => base44.entities.TripMember.filter({ trip_id: tripId }),
    enabled: !!tripId
  });
  const { data: budgets = [] } = useQuery({
    queryKey: ['trip-budget', tripId],
    queryFn: () => base44.entities.TripBudget.filter({ trip_id: tripId }),
    enabled: !!tripId
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['budget-categories', tripId],
    queryFn: () => base44.entities.BudgetCategory.filter({ trip_id: tripId }),
    enabled: !!tripId
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ['budget-expenses', tripId],
    queryFn: () => base44.entities.BudgetExpense.filter({ trip_id: tripId }),
    enabled: !!tripId
  });
  // For city-grouping: hotels, activities, transfers so we can look up city_visit_id
  const { data: hotels = [] } = useQuery({
    queryKey: ['trip-hotels', tripId],
    queryFn: () => base44.entities.HotelStay.filter({ trip_id: tripId }),
    enabled: !!tripId
  });
  const { data: activities = [] } = useQuery({
    queryKey: ['trip-activities', tripId],
    queryFn: () => base44.entities.Activity.filter({ trip_id: tripId }),
    enabled: !!tripId
  });

  const budget = budgets[0] || null;
  const mainCurrency = budget?.currency || 'EUR';
  const fxOverrides = budget?.fx_overrides || {};
  const { data: fx } = useFxRates(mainCurrency);

  // Active members count — active members + owner (owner may not appear as a TripMember row)
  const activeMemberCount = useMemo(() => {
    const activeMemberEmails = new Set(
      members.filter((m) => m.status === 'active').map((m) => m.user_email)
    );
    const activeCount = activeMemberEmails.size;
    // The trip owner may not have a TripMember row (they created the trip)
    if (trip?.created_by && !activeMemberEmails.has(trip.created_by)) {
      return activeCount + 1;
    }
    return activeCount;
  }, [members, trip]);

  // ── Derived totals ────────────────────────────────────────────────────
  const { total, unconvertedCurrencies } = useMemo(() => {
    let sum = 0;
    const badCurrencies = new Set();
    expenses.forEach((e) => {
      const { value, ok } = toMain(
        e.original_amount,
        e.original_currency || mainCurrency,
        mainCurrency,
        fx,
        fxOverrides
      );
      if (ok) sum += value;else
      if (e.original_currency && e.original_currency !== mainCurrency) {
        badCurrencies.add(e.original_currency);
      }
    });
    return { total: sum, unconvertedCurrencies: [...badCurrencies] };
  }, [expenses, mainCurrency, fx, fxOverrides]);

  // Ordered categories
  const orderedCategories = useMemo(() => {
    const systems = SYSTEM_KEY_ORDER.
    map((key) => categories.find((c) => c.kind === 'system' && c.system_key === key)).
    filter(Boolean);
    const customs = categories.
    filter((c) => c.kind !== 'system').
    slice().
    sort((a, b) => {
      const ao = a.order_index ?? 0;
      const bo = b.order_index ?? 0;
      if (ao !== bo) return ao - bo;
      return (a.created_date || '').localeCompare(b.created_date || '');
    });
    return [...systems, ...customs];
  }, [categories]);

  const expensesByCategory = useMemo(() => {
    const map = new Map();
    expenses.forEach((e) => {
      if (!map.has(e.category_id)) map.set(e.category_id, []);
      map.get(e.category_id).push(e);
    });
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const ad = a.spent_on || '',bd = b.spent_on || '';
        if (ad && bd) return ad.localeCompare(bd);
        if (ad && !bd) return -1;
        if (!ad && bd) return 1;
        return (a.created_date || '').localeCompare(b.created_date || '');
      });
    }
    return map;
  }, [expenses]);

  // ── City grouping ─────────────────────────────────────────────────────
  // Build a lookup: source_kind + source_id → city_visit_id
  const sourceToCityVisit = useMemo(() => {
    const map = {};
    hotels.forEach((h) => {map[`hotel:${h.id}`] = h.city_visit_id;});
    activities.forEach((a) => {map[`activity:${a.id}`] = a.city_visit_id;});
    return map;
  }, [hotels, activities]);

  // Transit visits (ordered by start_datetime)
  const transitVisits = useMemo(() =>
  visits.
  filter((v) => v.kind !== 'start' && v.kind !== 'end').
  sort((a, b) => (a.start_datetime || '').localeCompare(b.start_datetime || '')),
  [visits]
  );

  // For each expense, resolve city_visit_id
  const expenseCity = useMemo(() => {
    const map = {};
    expenses.forEach((e) => {
      if (e.source_kind && e.source_kind !== 'manual' && e.source_id) {
        const key = `${e.source_kind}:${e.source_id}`;
        map[e.id] = sourceToCityVisit[key] || null;
      } else {
        map[e.id] = null;
      }
    });
    return map;
  }, [expenses, sourceToCityVisit]);

  // Group expenses by city
  const expensesByCity = useMemo(() => {
    const map = new Map(); // city_visit_id → [expense]
    const noCity = [];
    expenses.forEach((e) => {
      const cv = expenseCity[e.id];
      if (cv) {
        if (!map.has(cv)) map.set(cv, []);
        map.get(cv).push(e);
      } else {
        noCity.push(e);
      }
    });
    return { byCity: map, noCity };
  }, [expenses, expenseCity]);

  // FX rates display (first 2 pairs)
  const fxRateLines = useMemo(() => {
    const lines = [];
    const overrideKeys = Object.keys(fxOverrides || {});
    for (const ccy of overrideKeys) {
      if (ccy === mainCurrency) continue;
      const rate = fxOverrides[ccy];
      if (rate) lines.push(`1 ${ccy} ≈ ${rate} ${mainCurrency}`);
      if (lines.length >= 2) break;
    }
    // Fill from live fx if needed
    if (lines.length < 2 && fx?.rates) {
      for (const [ccy, r] of Object.entries(fx.rates)) {
        if (ccy === mainCurrency) continue;
        if (overrideKeys.includes(ccy)) continue;
        const displayRate = (1 / r).toFixed(2);
        lines.push(`1 ${ccy} ≈ ${displayRate} ${mainCurrency}`);
        if (lines.length >= 2) break;
      }
    }
    return lines;
  }, [fxOverrides, fx, mainCurrency]);

  const usedCurrencies = useMemo(() => {
    const set = new Set();
    expenses.forEach((e) => {if (e.original_currency) set.add(e.original_currency);});
    Object.keys(fxOverrides || {}).forEach((c) => set.add(c));
    return [...set];
  }, [expenses, fxOverrides]);

  // ── Mutations ─────────────────────────────────────────────────────────
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['trip-budget', tripId] });
    qc.invalidateQueries({ queryKey: ['budget-categories', tripId] });
    qc.invalidateQueries({ queryKey: ['budget-expenses', tripId] });
  };

  const saveExpenseMut = useMutation({
    mutationFn: async ({ id, data }) => {
      if (id) return base44.entities.BudgetExpense.update(id, data);
      return base44.entities.BudgetExpense.create({ ...data, trip_id: tripId, source_kind: 'manual' });
    },
    onSuccess: () => {invalidateAll();setExpenseDialog({ open: false, expense: null, defaultCategoryId: '' });}
  });

  const deleteExpenseMut = useMutation({
    mutationFn: (id) => base44.entities.BudgetExpense.delete(id),
    onSuccess: invalidateAll
  });

  const saveCategoryMut = useMutation({
    mutationFn: async ({ id, name, icon, color }) => {
      if (id) return base44.entities.BudgetCategory.update(id, { name, icon, color });
      const customs = categories.filter((c) => c.kind !== 'system');
      const nextOrder = customs.reduce((m, c) => Math.max(m, c.order_index ?? 0), 0) + 1;
      return base44.entities.BudgetCategory.create({
        trip_id: tripId, name, kind: 'custom', order_index: nextOrder, icon, color
      });
    },
    onSuccess: () => {invalidateAll();setCategoryDialog({ open: false, category: null });}
  });

  const deleteCategoryMut = useMutation({
    mutationFn: (id) => base44.entities.BudgetCategory.delete(id),
    onSuccess: invalidateAll
  });

  const saveFxMut = useMutation({
    mutationFn: async (overrides) => {
      if (budget) return base44.entities.TripBudget.update(budget.id, { fx_overrides: overrides });
      return base44.entities.TripBudget.create({ trip_id: tripId, currency: mainCurrency, fx_overrides: overrides });
    },
    onSuccess: () => {qc.invalidateQueries({ queryKey: ['trip-budget', tripId] });setFxOpen(false);}
  });

  // ── UI state ──────────────────────────────────────────────────────────
  const [groupBy, setGroupBy] = useState('category'); // 'category' | 'city'
  const [selectedId, setSelectedId] = useState(null); // category id or city visit id
  const [expenseDialog, setExpenseDialog] = useState({ open: false, expense: null, defaultCategoryId: '' });
  const [categoryDialog, setCategoryDialog] = useState({ open: false, category: null });
  const [deleteCatConfirm, setDeleteCatConfirm] = useState({ open: false, category: null });
  const [fxOpen, setFxOpen] = useState(false);

  // Auto-select first item when groupBy changes or data loads
  const firstCategoryId = orderedCategories[0]?.id || null;
  const firstCityId = transitVisits[0]?.id || null;
  const effectiveSelectedId = selectedId || (
  groupBy === 'category' ? firstCategoryId : firstCityId);

  // Expenses for the right panel
  const rightPanelExpenses = useMemo(() => {
    if (groupBy === 'category') {
      return expensesByCategory.get(effectiveSelectedId) || [];
    } else {
      if (effectiveSelectedId === '__other__') return expensesByCity.noCity;
      return expensesByCity.byCity.get(effectiveSelectedId) || [];
    }
  }, [groupBy, effectiveSelectedId, expensesByCategory, expensesByCity]);

  const selectedCategory = groupBy === 'category' ?
  orderedCategories.find((c) => c.id === effectiveSelectedId) :
  null;
  const selectedVisit = groupBy === 'city' ?
  effectiveSelectedId === '__other__' ? null : transitVisits.find((v) => v.id === effectiveSelectedId) :
  null;

  // Subtotal for a category
  const categorySubtotal = (catId) => {
    let sum = 0;
    (expensesByCategory.get(catId) || []).forEach((e) => {
      const { value, ok } = toMain(e.original_amount, e.original_currency || mainCurrency, mainCurrency, fx, fxOverrides);
      if (ok) sum += value;
    });
    return sum;
  };

  // Subtotal for a city
  const citySubtotal = (exps) => {
    let sum = 0;
    exps.forEach((e) => {
      const { value, ok } = toMain(e.original_amount, e.original_currency || mainCurrency, mainCurrency, fx, fxOverrides);
      if (ok) sum += value;
    });
    return sum;
  };

  // Right panel header info
  const rightHeaderTitle = groupBy === 'category' ?
  selectedCategory ?
  selectedCategory.kind === 'system' ?
  t(SYSTEM_CATEGORY_NAME_KEY[selectedCategory.system_key] || selectedCategory.name) :
  selectedCategory.name :
  '' :
  selectedVisit ? selectedVisit.city_name : t('budget.city_other');

  const rightHeaderSubtotal = useMemo(() => {
    return citySubtotal(rightPanelExpenses);
  }, [rightPanelExpenses, mainCurrency, fx, fxOverrides]);

  // Budget for selected category
  const rightHeaderBudget = null; // no budget per category for now

  // ── Guards ────────────────────────────────────────────────────────────
  if (tripLoading || !trip) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>);

  }
  if (!access.loading && !access.allowed) return <TripAccessDenied />;
  const canEdit = access.role === 'owner' || access.role === 'admin';

  const confirmDeleteCategory = () => {
    const cat = deleteCatConfirm.category;
    setDeleteCatConfirm({ open: false, category: null });
    if (!cat) return;
    const inside = expensesByCategory.get(cat.id) || [];
    if (inside.length > 0) return;
    deleteCategoryMut.mutate(cat.id);
  };
  const deletingCatHasExpenses = (expensesByCategory.get(deleteCatConfirm.category?.id) || []).length > 0;

  return (
    <TripShell trip={trip} tripId={tripId} access={access}>
      <TripPageHeader trip={trip} visits={visits} tripId={tripId} />
      <div className="pb-12">

        {/* ── 3 summary cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          {/* Total */}
          <div className="rounded-2xl border bg-card p-5">
            <div className="text-xs text-muted-foreground mb-1">{t('budget.total_label')}</div>
            <div className="font-display text-3xl font-bold tabular-nums leading-tight">
              {fmtMoney(total, mainCurrency)}
            </div>
          </div>

          {/* Per person */}
          <div className="rounded-2xl border bg-card p-5">
            <div className="text-xs text-muted-foreground mb-1">{t('budget.per_person_label')}</div>
            <div className="font-display text-3xl font-bold tabular-nums leading-tight">
              {fmtMoney(activeMemberCount > 0 ? total / activeMemberCount : total, mainCurrency)}
            </div>
            {activeMemberCount > 0 &&
            <div className="text-xs text-muted-foreground mt-1">
                {t('budget.members_count', { n: activeMemberCount })}
              </div>
            }
          </div>

          {/* FX rates */}
          <div className="rounded-2xl border bg-card p-5">
            <div className="text-xs text-muted-foreground mb-1">{t('budget.fx_rates_label')}</div>
            {fxRateLines.length === 0 ?
            <div className="text-sm text-muted-foreground">{t('budget.fx_no_other')}</div> :

            <div className="space-y-0.5">
                {fxRateLines.map((line, i) =>
              <div key={i} className="text-sm font-medium">{line}</div>
              )}
              </div>
            }
            <button
              type="button"
              onClick={() => setFxOpen(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-2.5 py-1.5 hover:bg-secondary transition">
              
              <Pencil className="w-3 h-3" />{t('budget.fx_change')}
            </button>
          </div>
        </div>

        {/* ── FX missing warning ───────────────────────────────────────── */}
        {unconvertedCurrencies.length > 0 &&
        <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  {t('budget.fx_missing_warn_title', { currencies: unconvertedCurrencies.join(', ') })}
                </div>
                <div className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
                  {t('budget.fx_missing_warn_desc', {
                  n: expenses.filter((e) => unconvertedCurrencies.includes(e.original_currency)).length,
                  currencies: unconvertedCurrencies.join(', ')
                })}
                  {' '}
                  <button
                  type="button"
                  className="underline hover:no-underline"
                  onClick={() => setFxOpen(true)}>
                  
                    {t('budget.fx_missing_set_manual')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        }

        {/* ── Controls row ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          {/* GroupBy toggle */}
          <div className="flex border bg-card p-1 gap-1 rounded-[5px]">
            <button
              type="button"
              onClick={() => {setGroupBy('category');setSelectedId(null);}}
              className={`px-3 py-1.5 text-sm font-medium transition rounded-[5px] ${
              groupBy === 'category' ?
              'bg-background shadow-sm text-foreground' :
              'text-muted-foreground hover:text-foreground'}`
              }>
              
              {t('budget.group_by_category')}
            </button>
            <button
              type="button"
              onClick={() => {setGroupBy('city');setSelectedId(null);}}
              className={`px-3 py-1.5 text-sm font-medium transition rounded-[5px] ${
              groupBy === 'city' ?
              'bg-background shadow-sm text-foreground' :
              'text-muted-foreground hover:text-foreground'}`
              }>
              
              {t('budget.group_by_city')}
            </button>
          </div>

          <div className="flex-1" />

          {/* Action buttons */}
          {canEdit &&
          <Button
            variant="outline"
            className="gap-1.5 text-sm h-9"
            onClick={() => setCategoryDialog({ open: true, category: null })}>
            
              {t('budget.add_category_short')}
            </Button>
          }
          {canEdit &&
          <Button
            className="gap-1.5 text-sm h-9"
            onClick={() => setExpenseDialog({ open: true, expense: null, defaultCategoryId: selectedCategory?.id || '' })}>
            
              {t('budget.add_expense_short')}
            </Button>
          }
        </div>

        {/* ── Master–detail ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">

          {/* LEFT: list */}
          <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="p-2 space-y-1">
            {groupBy === 'category' ?
              orderedCategories.map((cat) => {
                const meta = getCategoryIcon(cat);
                const Icon = meta?.Icon;
                const iconColor = meta?.colorClass || '';
                const name = cat.kind === 'system' ?
                t(SYSTEM_CATEGORY_NAME_KEY[cat.system_key] || cat.name) :
                cat.name;
                const sub = categorySubtotal(cat.id);
                const expList = expensesByCategory.get(cat.id) || [];
                const isSelected = effectiveSelectedId === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedId(cat.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition ${
                    isSelected ?
                    'bg-accent text-primary' :
                    'hover:bg-secondary/60 text-foreground'}`
                    }>
                    
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
                      {Icon && <Icon className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium truncate">{name}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('budget.expenses_count', { n: expList.length })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-bold tabular-nums">{fmtMoney(sub, mainCurrency)}</div>
                    </div>
                  </button>);

              }) :

              <>
                {transitVisits.map((visit) => {
                  const exps = expensesByCity.byCity.get(visit.id) || [];
                  const sub = citySubtotal(exps);
                  const isSelected = effectiveSelectedId === visit.id;
                  return (
                    <button
                      key={visit.id}
                      type="button"
                      onClick={() => setSelectedId(visit.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition ${
                      isSelected ?
                      'bg-accent text-primary' :
                      'hover:bg-secondary/60 text-foreground'}`
                      }>
                      
                      <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 text-sm font-bold text-primary">
                        {visit.city_name?.[0] || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{visit.city_name}</div>
                        <div className="text-xs text-muted-foreground">{t('budget.expenses_count', { n: exps.length })}</div>
                      </div>
                      <div className="text-sm font-bold tabular-nums shrink-0">
                        {fmtMoney(sub, mainCurrency)}
                      </div>
                    </button>);

                })}
                {/* "Other" bucket */}
                {expensesByCity.noCity.length > 0 &&
                <button
                  type="button"
                  onClick={() => setSelectedId('__other__')}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition ${
                  effectiveSelectedId === '__other__' ?
                  'bg-accent text-primary' :
                  'hover:bg-secondary/60 text-foreground'}`
                  }>
                  
                    <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Wallet className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{t('budget.city_other')}</div>
                      <div className="text-xs text-muted-foreground">{t('budget.expenses_count', { n: expensesByCity.noCity.length })}</div>
                    </div>
                    <div className="text-sm font-bold tabular-nums shrink-0">
                      {fmtMoney(citySubtotal(expensesByCity.noCity), mainCurrency)}
                    </div>
                  </button>
                }
              </>
              }
              </div>
              </div>

              {/* RIGHT: expenses panel */}
          <div className="rounded-2xl border bg-card overflow-hidden">
            {/* Right panel header */}
            <div className="flex items-center gap-3 px-5 py-4 border-b">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-base">{rightHeaderTitle}</div>
                <div className="text-sm text-muted-foreground">
                  {fmtMoney(rightHeaderSubtotal, mainCurrency)}
                  {rightHeaderBudget ?
                  <span className="text-muted-foreground/60"> {t('budget.budget_label')} {fmtMoney(rightHeaderBudget, mainCurrency)}</span> :
                  null}
                </div>
              </div>
              {/* Edit category button for custom categories */}
              {groupBy === 'category' && selectedCategory && selectedCategory.kind !== 'system' && canEdit &&
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 h-8 text-xs"
                onClick={() => setCategoryDialog({ open: true, category: selectedCategory })}>
                
                  <Pencil className="w-3 h-3" />{t('common.edit')}
                </Button>
              }
            </div>

            {/* Expenses list */}
            <div className="divide-y">
              {rightPanelExpenses.length === 0 ?
              <div className="px-5 py-8 text-sm text-muted-foreground text-center">
                  {t('budget.no_expenses')}
                </div> :

              rightPanelExpenses.map((expense) =>
              <ExpenseDetailRow
                key={expense.id}
                expense={expense}
                canEdit={canEdit}
                onEdit={(e) => setExpenseDialog({ open: true, expense: e, defaultCategoryId: e.category_id })}
                onDelete={(e) => deleteExpenseMut.mutate(e.id)}
                t={t} />

              )
              }
            </div>
          </div>
        </div>
      </div>

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}
      <ExpenseDialog
        open={expenseDialog.open}
        onOpenChange={(o) => setExpenseDialog((s) => ({ ...s, open: o }))}
        expense={expenseDialog.expense}
        defaultCategoryId={expenseDialog.defaultCategoryId}
        defaultCurrency={mainCurrency}
        categories={orderedCategories}
        isSaving={saveExpenseMut.isPending}
        onSubmit={(data) => saveExpenseMut.mutate({ id: expenseDialog.expense?.id, data })} />
      

      <CategoryNameDialog
        open={categoryDialog.open}
        onOpenChange={(o) => setCategoryDialog((s) => ({ ...s, open: o }))}
        category={categoryDialog.category}
        isSaving={saveCategoryMut.isPending}
        onSubmit={({ name, icon, color }) =>
        saveCategoryMut.mutate({ id: categoryDialog.category?.id, name, icon, color })
        } />
      

      <FxOverridesDialog
        open={fxOpen}
        onOpenChange={setFxOpen}
        mainCurrency={mainCurrency}
        currencies={usedCurrencies}
        currentOverrides={fxOverrides}
        fx={fx}
        isSaving={saveFxMut.isPending}
        onSave={(next) => saveFxMut.mutate(next)} />
      

      <ConfirmDialog
        open={deleteCatConfirm.open}
        onOpenChange={(o) => setDeleteCatConfirm((s) => ({ ...s, open: o }))}
        title={t('budget.category_delete_confirm_title')}
        description={
        deletingCatHasExpenses ?
        t('budget.category_delete_has_expenses') :
        t('budget.category_delete_confirm_msg', { name: deleteCatConfirm.category?.name || '' })
        }
        variant="destructive"
        singleButton={deletingCatHasExpenses}
        onConfirm={confirmDeleteCategory} />
      
    </TripShell>);

}

// ── Expense detail row (right panel) ─────────────────────────────────────
function ExpenseDetailRow({ expense, canEdit, onEdit, onDelete, t }) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isSystem = expense.source_kind && expense.source_kind !== 'manual';

  let Icon, iconClass;
  if (isSystem) {
    const meta = SOURCE_ICONS[expense.source_kind] || SOURCE_ICONS.service;
    Icon = meta.Icon;
    iconClass = meta.color;
  } else {
    Icon = Pencil;
    iconClass = 'text-muted-foreground bg-muted';
  }

  const amountStr = expense.original_amount != null ?
  fmtMoney(expense.original_amount, expense.original_currency || 'EUR') :
  '—';

  return (
    <>
      <div
        onClick={() => {if (isSystem) setSourceOpen(true);}}
        className={`flex items-center gap-3 px-5 py-3 group ${
        isSystem ? 'cursor-pointer hover:bg-secondary/50 transition' : 'hover:bg-secondary/30'}`
        }>
        
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconClass}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{expense.title}</div>
          {expense.spent_on &&
          <div className="text-xs text-muted-foreground">
              {new Date(expense.spent_on).toLocaleDateString('ru', { day: 'numeric', month: 'short' })}
            </div>
          }
        </div>

        {isSystem ?
        <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0">
            {t('budget.expense_auto_badge')}
          </span> :
        canEdit ?
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition"
          onClick={(e) => {e.stopPropagation();onEdit(expense);}}
          aria-label={t('common.edit')}>
          
            <Pencil className="w-3.5 h-3.5" />
          </Button> :
        null}

        <div className="text-sm font-semibold tabular-nums shrink-0 ml-1">{amountStr}</div>
      </div>

      {isSystem &&
      <SourceViewLoader
        kind={expense.source_kind}
        id={expense.source_id}
        open={sourceOpen}
        onOpenChange={setSourceOpen}
        canEdit={canEdit} />

      }

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('budget.expense_delete_confirm_title')}
        description={t('budget.expense_delete_confirm_msg', { title: expense.title })}
        variant="destructive"
        onConfirm={() => {setConfirmDelete(false);onDelete(expense);}} />
      
    </>);

}