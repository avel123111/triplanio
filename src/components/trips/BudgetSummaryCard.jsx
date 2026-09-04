import React, { useMemo } from 'react';
import { Icon } from '@/design/icons';
import { Card, CardHeader, IconBtn, Meter, Skeleton } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
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
  const { t, locale } = useI18nFormat();
  const mainCurrency = trip?.details?.main_currency || budget?.currency || 'EUR';
  const { data: fx } = useFxRates(mainCurrency);
  const overrides = budget?.fx_overrides || {};

  const money = (v) => fmtMoney(v, mainCurrency, locale);
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
    <Card className="col col--g6">
      <CardHeader
        title={t('trip.sidebar_budget')}
        action={canManage && (
          <IconBtn
            icon="chev"
            tone="outline"
            size="sm"
            onClick={openBudget}
            title={budgetEnabled ? t('trip.open_budget') : t('trip.enable_budget_addon')}
            ariaLabel={budgetEnabled ? t('trip.open_budget') : t('trip.enable_budget_addon')}
          />
        )}
      />

      <div>
        {isLoading ? (
          <>
            <Skeleton w="55%" h={26} r="var(--r-sm)" />
            <Skeleton w="100%" h={11} r="var(--r-pill)" style={{ marginTop: 14 }} />
            <Skeleton w="100%" h={14} r="var(--r-sm)" style={{ marginTop: 12 }} />
            <Skeleton w="100%" h={14} r="var(--r-sm)" style={{ marginTop: 8 }} />
            <Skeleton w="100%" h={14} r="var(--r-sm)" style={{ marginTop: 8 }} />
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
                {/* ПОЛОСА ПОЯВЛЯЕТСЯ, КОГДА ЕСТЬ ЧТО СРАВНИВАТЬ. На одной
                    категории она заполнена целиком и не сообщает ничего: это
                    цветная плашка, повторяющая строку легенды под ней. Доля
                    имеет смысл только против других долей. */}
                {catBreakdown.length > 1 && (
                  <Meter
                    segments={catBreakdown.map((c) => ({
                      key: c.id, value: c.spent, color: c.color, title: c.name,
                    }))}
                  />
                )}
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
    </Card>
  );
}
