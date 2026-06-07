import React, { useMemo } from 'react';
import { Icon } from '@/design/icons';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useFxRates } from '@/lib/fx';
import { toMain as toMainCur, fmtMoney } from '@/lib/budget/money';
import { categoryColor } from '@/lib/budget/category-colors';

// Budget summary widget (Lumo .wdg) — total + per-category segmented bar +
// legend. Shared by the trip Overview and (previously) the timeline rail, so the
// per-category breakdown lives here once. Self-contained: owns its fx context.
export default function BudgetSummaryCard({
  trip,
  budget,
  budgetExpenses = [],
  budgetCategories = [],
  canManage = false,
  budgetEnabled = false,
  isLoading = false,
  onOpen,
  onLocked,
}) {
  const { t } = useI18n();
  const mainCurrency = trip?.details?.main_currency || budget?.currency || 'EUR';
  const { data: fx } = useFxRates(mainCurrency);
  const overrides = budget?.fx_overrides || {};

  const money = (v) => fmtMoney(v, mainCurrency, 'ru-RU');
  const conv = (e) =>
    toMainCur(e.original_amount, e.original_currency || mainCurrency, mainCurrency, fx, overrides);

  // Per-category breakdown (converted to main currency) — drives bar + legend.
  const catBreakdown = useMemo(
    () =>
      (budgetCategories || [])
        .map((cat) => {
          const spent = (budgetExpenses || [])
            .filter((e) => e.category_id === cat.id)
            .reduce((s, e) => {
              const r = conv(e);
              return s + (r.ok ? r.value : 0);
            }, 0);
          return { id: cat.id, name: cat.name, color: categoryColor(cat), spent };
        })
        .filter((c) => c.spent > 0)
        .sort((a, b) => b.spent - a.spent),
    [budgetCategories, budgetExpenses, fx, overrides],
  );

  const totalSpent = catBreakdown.reduce((s, c) => s + c.spent, 0);
  const hasMissingRate = (budgetExpenses || []).some(
    (e) => e.original_currency && e.original_currency !== mainCurrency && !conv(e).ok,
  );

  const openBudget = () => (budgetEnabled ? onOpen?.() : onLocked?.());

  return (
    <div className="wdg ov-wdg">
      <div className="wdg-h">
        <span className="wi wi--primary"><Icon name="wallet" size={17} /></span>
        <h4>{t('trip.sidebar_budget')}</h4>
        {canManage && (
          <button
            className="wdg-act"
            onClick={openBudget}
            title={budgetEnabled ? t('trip.open_budget') : t('trip.enable_budget_addon')}
            aria-label={budgetEnabled ? t('trip.open_budget') : t('trip.enable_budget_addon')}
          >
            <Icon name="chev" size={14} />
          </button>
        )}
      </div>

      <div className="wdg-b">
        {isLoading ? (
          <>
            <div className="ov-bar" style={{ width: '55%', height: 26, borderRadius: 8 }} />
            <div className="ov-bar" style={{ width: '100%', height: 11, borderRadius: 999, marginTop: 14 }} />
            <div className="ov-bar" style={{ width: '100%', height: 14, borderRadius: 8, marginTop: 12 }} />
            <div className="ov-bar" style={{ width: '100%', height: 14, borderRadius: 8, marginTop: 8 }} />
            <div className="ov-bar" style={{ width: '100%', height: 14, borderRadius: 8, marginTop: 8 }} />
          </>
        ) : budget ? (
          <>
            <div className="bud-total num">{money(totalSpent)}</div>

            {hasMissingRate && (
              <div className="ov-warn">
                <Icon name="warning" size={12} />
                <span>{t('trip.budget_no_rate')}</span>
              </div>
            )}

            {catBreakdown.length > 0 ? (
              <>
                <div className="bud-bar" role="presentation">
                  {catBreakdown.map((c) => (
                    <i
                      key={c.id}
                      title={c.name}
                      style={{ flexGrow: c.spent, minWidth: 4, background: c.color }}
                    />
                  ))}
                </div>
                <div className="bud-legs">
                  {catBreakdown.map((c) => (
                    <div className="bud-leg" key={c.id}>
                      <span className="d" style={{ background: c.color }} />
                      <span className="nm">{c.name}</span>
                      <span className="v num">{money(c.spent)}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="muted ov-empty-line">{t('trip.budget_empty')}</div>
            )}
          </>
        ) : (
          <div className="muted ov-empty-line">{t('trip.budget_none')}</div>
        )}
      </div>
    </div>
  );
}
