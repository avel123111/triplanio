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
            {/* ★ ФАЗА ЗАГРУЗКИ — ТЕ ЖЕ ЭЛЕМЕНТЫ, ЧТО У ЗАПОЛНЕННОЙ КАРТОЧКИ: итог,
                полоса и три строки легенды. Стопка заглушек со своими `marginTop`
                была второй геометрией: отступы и высоты она задавала руками и
                разъехалась с настоящими на 36 px, как только карточка переехала
                на канон-обёртку. Полоса — настоящий `Meter` без сегментов:
                пустая дорожка и есть «данных пока нет».
                ⚠️ Угловых скобок в JSX-комментарии быть не должно: гард i18n
                читает текст между ними как строку разметки (это и уронило CI). */}
            <div className="bud-total"><Skeleton w="55%" h={28} r="var(--r-sm)" /></div>
            <Meter />
            <div className="bud-legs">
              {[0, 1, 2].map((i) => (
                <div className="bud-leg" key={i}>
                  <Skeleton w={10} h={10} r={4} />
                  <Skeleton w={i === 0 ? 96 : 72} h={18} r={5} />
                </div>
              ))}
            </div>
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
