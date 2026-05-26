/**
 * Sidebar budget card on TripView.
 *
 * v4 (this revision):
 *  - Always visible (no longer gated by the budget addon — TripView controls
 *    only the click behaviour).
 *  - Big total in main currency + segmented progress bar showing each
 *    category's share + list of all categories that have spending > 0,
 *    sorted by amount (descending). Includes custom categories.
 *  - "See details" link with a chevron, separated by a divider, at the bottom.
 *    When the addon is enabled it navigates to /trip/:id/budget; otherwise the
 *    parent (TripView) catches the click via `onSeeDetails` and shows the
 *    "enable addon" modal.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { ChevronRight, BedDouble, Plane, Camera, Smartphone, AlertTriangle } from 'lucide-react';
import { useFxRates } from '@/lib/fx';
import { fmtMoney, toMain } from '@/lib/budget/money';
import { useT } from '@/lib/i18n/I18nContext';
import { SYSTEM_CATEGORY_NAME_KEY } from '@/lib/budget/constants';
import { resolveCustomCategoryStyle, CUSTOM_COLOR_DOTS, DEFAULT_CUSTOM_COLOR } from '@/lib/budget/categoryStyles';

// Solid bar/dot colors per system category — match the budget page palette.
const SYSTEM_SOLID = {
  accommodation: 'bg-blue-500',
  transport:     'bg-primary',
  activities:    'bg-violet-500',
  services:      'bg-emerald-500',
};
const SYSTEM_ICON = {
  accommodation: BedDouble,
  transport:     Plane,
  activities:    Camera,
  services:      Smartphone,
};

export default function TripBudgetCard({ trip, noFrame = false, hideHeader = false, onSeeDetails }) {
  const t = useT();
  const tripId = trip.id;

  const { data: budgets = [] } = useQuery({
    queryKey: ['trip-budget', tripId],
    queryFn: () => base44.entities.TripBudget.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });
  const { data: categories = [] } = useQuery({
    queryKey: ['budget-categories', tripId],
    queryFn: () => base44.entities.BudgetCategory.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ['budget-expenses', tripId],
    queryFn: () => base44.entities.BudgetExpense.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });

  const budget = budgets[0] || null;
  const mainCurrency = budget?.currency || 'EUR';
  const fxOverrides = budget?.fx_overrides || null;
  // FX rates load asynchronously after the trip data — without waiting for
  // them we'd briefly render the total with foreign-currency expenses
  // dropped (and a misleading "missing FX" warning), then jump to the
  // correct value once rates arrive. Keep the card in a stable skeleton
  // state until FX is ready.
  const { data: fx, isLoading: fxLoading } = useFxRates(mainCurrency);

  // Aggregate per category, drop zero-spend, sort by amount desc. Also collect
  // a set of currencies that couldn't be converted (no FX rate / no override)
  // so we can surface a warning chip.
  const { rows, total, missingCurrencies } = useMemo(() => {
    const byCat = new Map();
    const missing = new Set();
    expenses.forEach((e) => {
      const cur = e.original_currency || mainCurrency;
      const { value, ok } = toMain(
        e.original_amount,
        cur,
        mainCurrency,
        fx,
        fxOverrides,
      );
      if (!ok) {
        if (cur && cur !== mainCurrency) missing.add(cur);
        return;
      }
      byCat.set(e.category_id, (byCat.get(e.category_id) || 0) + value);
    });

    const catsById = new Map(categories.map(c => [c.id, c]));
    const arr = [];
    let sum = 0;
    for (const [catId, amount] of byCat.entries()) {
      if (!(amount > 0)) continue;
      const cat = catsById.get(catId);
      if (!cat) continue;
      sum += amount;
      arr.push({ category: cat, amount });
    }
    arr.sort((a, b) => b.amount - a.amount);
    return { rows: arr, total: sum, missingCurrencies: Array.from(missing) };
  }, [expenses, categories, mainCurrency, fx, fxOverrides]);

  // Color/icon resolution per category row.
  const getRowVisual = (cat) => {
    if (cat.kind === 'system') {
      return {
        dotClass: SYSTEM_SOLID[cat.system_key] || 'bg-muted-foreground',
        label: t(SYSTEM_CATEGORY_NAME_KEY[cat.system_key] || cat.name),
        Icon: SYSTEM_ICON[cat.system_key] || null,
      };
    }
    const style = resolveCustomCategoryStyle(cat);
    return {
      dotClass: CUSTOM_COLOR_DOTS[style.colorKey] || CUSTOM_COLOR_DOTS[DEFAULT_CUSTOM_COLOR],
      label: cat.name,
      Icon: style.Icon,
    };
  };

  const Wrapper = noFrame ? React.Fragment : 'div';
  const wrapperProps = noFrame ? {} : { className: 'rounded-2xl border bg-card p-4' };

  // "See details" — single source of truth for the click. Parent passes
  // onSeeDetails when the addon is OFF (shows the enable-addon modal); when
  // it's not passed we navigate to the budget page.
  // Layout: label LEFT, chevron RIGHT, with the divider row stretched to
  // full width so there's visible space between them.
  const seeDetailsContent = (
    <span className="flex items-center justify-between w-full text-sm font-medium text-muted-foreground group-hover:text-foreground transition">
      <span>{t('budget.see_details')}</span>
      <ChevronRight className="w-4 h-4 transition group-hover:translate-x-0.5" />
    </span>
  );

  return (
    <Wrapper {...wrapperProps}>
      {!hideHeader && (
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
            {t('budget.title')}
          </span>
        </div>
      )}

      {fxLoading ? (
        // Skeleton matching the real card height — total + bar + 3 rows.
        <div className="animate-pulse">
          <div className="h-8 w-32 rounded bg-muted mb-3" />
          <div className="h-2 w-full rounded-full bg-muted mb-3" />
          <div className="space-y-2">
            <div className="h-4 w-full rounded bg-muted" />
            <div className="h-4 w-5/6 rounded bg-muted" />
            <div className="h-4 w-2/3 rounded bg-muted" />
          </div>
        </div>
      ) : total > 0 ? (
        <>
          {/* Big total */}
          <div className="font-display text-3xl font-bold tabular-nums leading-none mb-3">
            {fmtMoney(total, mainCurrency)}
          </div>

          {/* Segmented progress bar.
              Tiny categories (e.g. 200₽ out of 85k) would otherwise compute
              to ~0.2% width and disappear; we give every visible row a
              minimum 4px slice so its color is always perceivable. */}
          <div className="flex h-2 w-full rounded-full overflow-hidden bg-muted mb-3">
            {rows.map(({ category, amount }) => {
              const pct = (amount / total) * 100;
              const { dotClass } = getRowVisual(category);
              return (
                <div
                  key={category.id}
                  className={dotClass}
                  style={{ width: `${pct}%`, minWidth: '4px' }}
                />
              );
            })}
          </div>

          {/* Category list */}
          <ul className="space-y-1.5">
            {rows.map(({ category, amount }) => {
              const { dotClass, label } = getRowVisual(category);
              return (
                <li key={category.id} className="flex items-center gap-2 text-sm">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotClass}`} />
                  <span className="flex-1 min-w-0 truncate text-foreground/90">{label}</span>
                  <span className="font-semibold tabular-nums shrink-0">
                    {fmtMoney(amount, mainCurrency)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <div className="text-xs text-muted-foreground py-1">{t('budget.empty_hint')}</div>
      )}

      {/* Missing-FX warning: some expenses use currencies we couldn't convert
          into the main one (no live rate AND no manual override). They are
          silently excluded from the total — surface this so the user knows. */}
      {missingCurrencies.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span className="leading-snug">
            {t('budget.missing_fx_warning', { currencies: missingCurrencies.join(', ') })}
          </span>
        </div>
      )}

      {/* Divider + See details (stretched to full width: label left, chevron right) */}
      <div className="border-t mt-3 pt-2">
        {onSeeDetails ? (
          <button type="button" onClick={onSeeDetails} className="group w-full">
            {seeDetailsContent}
          </button>
        ) : (
          <Link to={`/trip/${tripId}/budget`} className="group block w-full">
            {seeDetailsContent}
          </Link>
        )}
      </div>
    </Wrapper>
  );
}