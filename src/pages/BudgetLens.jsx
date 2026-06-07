/**
 * BudgetLens - budget tab inside TripView.
 *
 * Props:
 *   tripId, trip, budget, budgetCategories, budgetExpenses, members, cityVisits, isLoading, isPro, queryClient
 *
 * budget          - trip_budgets row (or null if not seeded)
 * budgetCategories - budget_categories rows
 * budgetExpenses   - budget_expenses rows (original_amount, original_currency, source_kind, source_id)
 *
 * Display currency = trip.details.main_currency (default EUR). All sums are
 * converted into it via money.js `toMain` (override-aware). Amounts are
 * formatted with `fmtMoney` (2 decimals). Manual FX overrides persist on
 * trip_budgets.fx_overrides.
 */
import React, { useState, useMemo } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useFxRates } from '@/lib/fx';
import { useTripScreenActions } from '@/components/trips/TripScreenBar';
import { toMain as toMainCur, fmtMoney } from '@/lib/budget/money';
import { CATEGORY_HEXES, DEFAULT_CATEGORY_HEX } from '@/lib/budget/category-colors';
import { getActiveLocale } from '@/lib/i18n/format';
import { Icon } from '../design/icons';
import { Badge, Btn, Card, Dialog, Field, EmptyState, Skeleton, Severity } from '../design/index';
import CurrencySelect from '@/components/budget/CurrencySelect';
import SourceViewLoader from '@/components/budget/SourceViewLoader';
import { FieldError, IssuesPanel, fieldHasError, useHybridValidation } from '@/components/common/ValidationUI';

// ─── icon helpers ─────────────────────────────────────────────────────────────

const SYS_ICON = {
  accommodation: 'bed',
  transport:     'plane',
  activities:    'spark',
  services:      'esim',
  food:          'cup',
  shopping:      'spark',
  entertainment: 'spark',
  souvenirs:     'gift',
  other:         'wallet',
};

const SOURCE_ICON = {
  hotel:    'bed',
  transfer: 'plane',
  activity: 'spark',
  service:  'esim',
  manual:   'edit',
};

function catIcon(cat) {
  return SYS_ICON[cat.system_key] || SYS_ICON[cat.icon] || 'wallet';
}

// money formatting helper (2 decimals, locale ru)
const money = (value, cur) => fmtMoney(value, cur, getActiveLocale());

// ─── AddExpenseDialog (create + edit manual expense) ────────────────────────────

function AddExpenseDialog({ tripId, categories, mainCurrency, cities = [], existing = null, onSaved }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const isEdit = !!existing;
  const [title, setTitle] = useState(existing?.title || '');
  const [amount, setAmount] = useState(existing?.original_amount != null ? String(existing.original_amount) : '');
  const [currency, setCurrency] = useState(existing?.original_currency || mainCurrency || 'EUR');
  const [categoryId, setCategoryId] = useState(existing?.category_id || categories[0]?.id || '');
  const [date, setDate] = useState(existing?.spent_on || '');
  const [cityName, setCityName] = useState(existing?.city_name || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const v = useHybridValidation('expense', { title, amount, categoryId });
  const inv = (f) => (fieldHasError(v.displayIssues, f) ? 'tv-invalid' : '');

  async function save() {
    setSaving(true);
    setErr('');
    const row = {
      category_id: categoryId,
      title: title.trim(),
      original_amount: Number(amount),
      original_currency: currency,
      notes: notes.trim() || null,
      spent_on: date || null,
      city_name: cityName || null,
    };
    let error;
    if (isEdit) {
      ({ error } = await supabase.from('budget_expenses').update(row).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('budget_expenses').insert({
        ...row, trip_id: tripId, source_kind: 'manual', source_id: null, created_by: user?.id,
      }));
    }
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved?.();
    window.__closeModal?.();
  }

  async function remove() {
    if (!isEdit) return;
    setDeleting(true);
    const { error } = await supabase.from('budget_expenses').delete().eq('id', existing.id);
    setDeleting(false);
    if (error) { setErr(error.message); return; }
    onSaved?.();
    window.__closeModal?.();
  }

  return (
    <Dialog title={isEdit ? t('budget.edit_expense') : t('budget.manual_expense')} icon="wallet" size=""
      foot={<>
        {isEdit && (
          <Btn variant="danger" icon="trash" onClick={remove} disabled={deleting || saving}>{deleting ? t('budget.deleting') : t('trip.delete')}</Btn>
        )}
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('trip.form_cancel')}</Btn>
        <Btn variant="primary" icon="check" onClick={() => v.attemptSubmit(save)} disabled={saving} aria-disabled={!v.canSubmit}>
          {saving ? t('member.saving') : isEdit ? t('trip.form_save') : t('members.add')}
        </Btn>
      </>}>
      <Field label={t('trip.description')}>
        <div data-vfield="title" className={inv('title')}>
          <input className="input" value={title} onChange={e => { setTitle(e.target.value); v.markTouched('title'); }} placeholder={t('budget.desc_ph')} autoFocus />
        </div>
        <FieldError issues={v.displayIssues} field="title" />
      </Field>
      <div className="field-row cols-2" style={{ marginTop: 14 }}>
        <Field label={t('budget.field_amount')}>
          <div style={{ display: 'flex', gap: 6 }} data-vfield="amount" className={inv('amount')}>
            <input className="input num" type="number" placeholder="0" value={amount} onChange={e => { setAmount(e.target.value); v.markTouched('amount'); }} style={{ flex: 1 }} />
            <CurrencySelect value={currency} onChange={setCurrency} width={92} />
          </div>
          <FieldError issues={v.displayIssues} field="amount" />
        </Field>
        <Field label={t('budget.field_date')}>
          <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="field-row cols-2" style={{ marginTop: 14 }}>
        <Field label={t('budget.field_category')}>
          <div data-vfield="categoryId" className={inv('categoryId')}>
            <select className="select" value={categoryId} onChange={e => { setCategoryId(e.target.value); v.markTouched('categoryId'); }}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <FieldError issues={v.displayIssues} field="categoryId" />
        </Field>
        <Field label={t('visit.city')}>
          <select className="select" value={cityName} onChange={e => setCityName(e.target.value)}>
            <option value="">-</option>
            {cities.map((c, i) => <option key={i} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label={t('doc.notes_label')}>
          <textarea className="textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('budget.free_text')} />
        </Field>
      </div>
      <IssuesPanel issues={v.panelIssues} style={{ marginTop: 12 }} />
      {err && <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-meta)', marginTop: 10 }}>{err}</div>}
    </Dialog>
  );
}

// ─── FxRatesDialog ──────────────────────────────────────────────────────────────
// Lists every non-main currency present in expenses. Input prefilled with the
// override (or the live rate). On "Применить" writes the override map.

function liveRateToMain(fx, code) {
  const r = fx?.rates?.[code];
  if (!r || !Number.isFinite(Number(r)) || Number(r) <= 0) return null;
  return 1 / Number(r);
}

function FxRatesDialog({ tripId, mainCurrency, currencies, currentOverrides, fx, onSaved }) {
  const { t } = useI18n();
  const others = currencies.filter(c => c && c !== mainCurrency);
  const [values, setValues] = useState(() => {
    const init = {};
    others.forEach(c => {
      const ov = currentOverrides?.[c];
      const live = liveRateToMain(fx, c);
      init[c] = ov != null ? String(ov) : (live != null ? String(Number(live.toFixed(6))) : '');
    });
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const v = useHybridValidation('fx', { rates: values });
  const inv = (f) => (fieldHasError(v.displayIssues, f) ? 'tv-invalid' : '');

  async function apply() {
    setSaving(true);
    setErr('');
    const next = {};
    Object.entries(values).forEach(([code, raw]) => {
      const n = Number(raw);
      if (raw === '' || !Number.isFinite(n) || n <= 0) return;
      const live = liveRateToMain(fx, code);
      // Store as a manual override ONLY when there is no live rate, or the user
      // actually changed it - otherwise auto rates would get frozen.
      if (live == null || Math.abs(n - live) / live > 0.0001) next[code] = n;
    });
    const { error } = await supabase.from('trip_budgets').update({ fx_overrides: next }).eq('trip_id', tripId);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved?.();
    window.__closeModal?.();
  }

  return (
    <Dialog title={t('budget.fx_button')} icon="wallet" size="" foot={<>
      <Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('trip.form_cancel')}</Btn>
      <Btn variant="primary" icon="check" onClick={() => v.attemptSubmit(apply)} disabled={saving} aria-disabled={!v.canSubmit}>{saving ? t('member.saving') : t('budget.apply')}</Btn>
    </>}>
      <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginBottom: 14 }}>
        {t('budget.fx_intro')}
      </div>
      {others.length === 0 ? (
        <EmptyState icon="wallet" title={t('budget.fx_no_other')} body={t('budget.fx_empty')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {others.map(code => {
            const live = liveRateToMain(fx, code);
            const hasOverride = currentOverrides?.[code] != null;
            const hint = hasOverride
              ? t('budget.fx_manual', { cur: mainCurrency })
              : live != null
                ? t('budget.fx_auto', { cur: mainCurrency })
                : t('budget.fx_not_found', { cur: mainCurrency });
            const hintColor = (!hasOverride && live == null) ? 'var(--danger)' : 'var(--muted)';
            return (
              <div key={code} data-vfield={`rate.${code}`} className={inv(`rate.${code}`)}>
                <div style={{ display: 'grid', gridTemplateColumns: '60px 110px 1fr', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8 }}>
                  <div className="num" style={{ fontWeight: 600 }}>1 {code}</div>
                  <input className="input num" type="number" step="0.0001" value={values[code] ?? ''}
                    onChange={e => { const val = e.target.value; setValues(s => ({ ...s, [code]: val })); v.markTouched(`rate.${code}`); }} placeholder="0.00" />
                  <div style={{ fontSize: 'var(--fs-meta)', color: hintColor }}>{hint}</div>
                </div>
                <FieldError issues={v.displayIssues} field={`rate.${code}`} />
              </div>
            );
          })}
        </div>
      )}
      <IssuesPanel issues={v.panelIssues} style={{ marginTop: 12 }} />
      {err && <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-meta)', marginTop: 10 }}>{err}</div>}
    </Dialog>
  );
}

// ─── AddCategoryDialog ────────────────────────────────────────────────────────

// Category palette = the Lumo --cat-1..8 tokens (single source: category-colors).
const CAT_COLORS = CATEGORY_HEXES;
const CAT_ICONS_BUDGET = ['wallet', 'bed', 'plane', 'spark', 'cup', 'cam', 'shield', 'gift', 'esim', 'card'];

function AddCategoryDialog({ tripId, existing, onSaved }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [name, setName] = useState(existing?.name || '');
  const [color, setColor] = useState(existing?.color || DEFAULT_CATEGORY_HEX);
  const [icon, setIcon] = useState(existing?.icon || CAT_ICONS_BUDGET[0]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const v = useHybridValidation('category', { name });
  const inv = (f) => (fieldHasError(v.displayIssues, f) ? 'tv-invalid' : '');

  async function save() {
    setSaving(true);
    setErr('');
    let error;
    if (existing) {
      ({ error } = await supabase.from('budget_categories').update({ name: name.trim(), color, icon }).eq('id', existing.id));
    } else {
      ({ error } = await supabase.from('budget_categories').insert({
        trip_id: tripId,
        kind: 'custom',
        name: name.trim(),
        system_key: null,
        icon,
        color,
        order_index: 99,
        created_by: user?.id,
      }));
    }
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onSaved?.();
    window.__closeModal?.();
  }

  return (
    <Dialog title={existing ? t('budget.edit_category') : t('budget.category_new')} icon="wallet" size="sm"
      foot={<>
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('trip.form_cancel')}</Btn>
        <Btn variant="primary" icon="check" onClick={() => v.attemptSubmit(save)} disabled={saving} aria-disabled={!v.canSubmit}>{saving ? t('member.saving') : existing ? t('trip.form_save') : t('members.add')}</Btn>
      </>}>
      <Field label={t('trip.title_label')}>
        <div data-vfield="name" className={inv('name')}>
          <input className="input" value={name} onChange={e => { setName(e.target.value); v.markTouched('name'); }} placeholder={t('budget.cat_name_ph')} autoFocus />
        </div>
        <FieldError issues={v.displayIssues} field="name" />
      </Field>
      <div style={{ marginTop: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{t('budget.color_label')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CAT_COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} style={{
              width: 28, height: 28, borderRadius: '50%', background: c,
              border: color === c ? '2.5px solid var(--ink)' : '2px solid transparent', cursor: 'pointer'
            }} />
          ))}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{t('budget.icon_label')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CAT_ICONS_BUDGET.map(ic => (
            <button key={ic} onClick={() => setIcon(ic)} style={{
              width: 36, height: 36, borderRadius: 8,
              background: icon === ic ? color + '22' : 'var(--wash)',
              color: icon === ic ? color : 'var(--muted)',
              border: '1px solid ' + (icon === ic ? color : 'var(--line)'),
              display: 'grid', placeItems: 'center', cursor: 'pointer'
            }}><Icon name={ic} size={16} /></button>
          ))}
        </div>
      </div>
      <IssuesPanel issues={v.panelIssues} style={{ marginTop: 12 }} />
      {err && <div style={{ color: 'var(--danger)', fontSize: 'var(--fs-meta)', marginTop: 10 }}>{err}</div>}
    </Dialog>
  );
}

// ─── ExpenseRow ───────────────────────────────────────────────────────────────
// `mainAmount` is the converted value; `ok=false` means no rate was available.

function ExpenseRow({ expense, catColor, catIcon: icon, showCategory, catName, mainCurrency, mainAmount, ok, onOpen }) {
  const { t } = useI18n();
  const src = expense.source_kind || 'manual';
  const isManual = src === 'manual';
  return (
    <div
      onClick={() => onOpen?.(expense)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 12px',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 9, cursor: 'pointer',
      }}>
      <div style={{ width: 26, height: 26, borderRadius: 6, background: catColor + '22', color: catColor, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={icon || SOURCE_ICON[src] || 'wallet'} size={13} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-base)', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {expense.title || '-'}
        </div>
        <div className="muted" style={{ fontSize: 'var(--fs-micro)', display: 'flex', alignItems: 'center', gap: 6 }}>
          {expense.notes && <span>{expense.notes}</span>}
          {showCategory && <Badge variant="quiet" style={{ fontSize: 'var(--fs-micro)', padding: '1px 5px' }}>{catName}</Badge>}
          {!isManual && <Badge variant="quiet" icon="link" style={{ fontSize: 'var(--fs-micro)' }}>{t('budget.expense_auto_badge')}</Badge>}
        </div>
      </div>
      <div className="num" style={{ fontWeight: 600, fontSize: 'var(--fs-base)', minWidth: 64, textAlign: 'right', flexShrink: 0 }}>
        {ok ? money(mainAmount, mainCurrency) : (
          <span title={t('budget.rate_missing')} style={{ color: 'var(--danger)' }}>
            {money(expense.original_amount || 0, expense.original_currency || mainCurrency)} ?
          </span>
        )}
      </div>
    </div>
  );
}

// ─── BudgetLens ───────────────────────────────────────────────────────────────

export default function BudgetLens({ tripId, trip, budget, budgetCategories = [], budgetExpenses = [], members = [], cityVisits = [], isLoading, isPro, queryClient }) {
  const { t } = useI18n();
  const [grouping, setGrouping] = useState('category');
  const [activeCatId, setActiveCatId] = useState(null);
  const [sourceView, setSourceView] = useState({ open: false, kind: null, id: null });

  // Main display currency: trip settings (default EUR); trip_budgets.currency
  // is a legacy fallback.
  const mainCurrency = trip?.details?.main_currency || budget?.currency || 'EUR';
  const { data: fx } = useFxRates(mainCurrency);
  const overrides = budget?.fx_overrides || {};

  // Convert an expense → { value, ok } in main currency (override-aware).
  const conv = (e) => toMainCur(e.original_amount, e.original_currency || mainCurrency, mainCurrency, fx, overrides);

  const cityNames = cityVisits.map(v => v.city_name).filter(Boolean);

  function openAddExpense() {
    window.__openModal?.(<AddExpenseDialog tripId={tripId} categories={cats} mainCurrency={mainCurrency} cities={cityNames} onSaved={refresh} />);
  }
  function openEditExpense(expense) {
    window.__openModal?.(<AddExpenseDialog tripId={tripId} categories={cats} mainCurrency={mainCurrency} cities={cityNames} existing={expense} onSaved={refresh} />);
  }
  function openAddCategory() {
    window.__openModal?.(<AddCategoryDialog tripId={tripId} onSaved={refresh} />);
  }
  function openEditCategory(cat) {
    window.__openModal?.(<AddCategoryDialog tripId={tripId} existing={cat} onSaved={refresh} />);
  }
  function openFxDialog() {
    window.__openModal?.(
      <FxRatesDialog tripId={tripId} mainCurrency={mainCurrency} currencies={foreignCurrencies}
        currentOverrides={overrides} fx={fx} onSaved={refresh} />
    );
  }

  // Open an expense - system expense → its source event view; manual → edit dialog.
  function openExpense(expense) {
    const src = expense.source_kind || 'manual';
    if (src === 'manual') { openEditExpense(expense); return; }
    if (expense.source_id && SOURCE_ICON[src]) {
      setSourceView({ open: true, kind: src, id: expense.source_id });
    }
  }

  function refresh() {
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
  }

  // Build enriched categories with converted totals.
  // Order: the four canonical system categories first (fixed order matching
  // base44), then all custom categories - including "food", which was demoted
  // from system to custom and must sit with the other custom categories.
  const cats = useMemo(() => {
    const SYSTEM_ORDER = ['accommodation', 'transport', 'activities', 'services'];
    const rank = (cat) => {
      const i = SYSTEM_ORDER.indexOf(cat.system_key);
      return i === -1 ? SYSTEM_ORDER.length + (cat.order_index ?? 99) : i;
    };
    const sorted = [...budgetCategories].sort((a, b) => rank(a) - rank(b));
    return sorted.map(cat => {
      const items = budgetExpenses.filter(e => e.category_id === cat.id);
      const spent = items.reduce((s, e) => { const r = conv(e); return s + (r.ok ? r.value : 0); }, 0);
      return { ...cat, items, spent, itemCount: items.length };
    });
  }, [budgetCategories, budgetExpenses, mainCurrency, fx, overrides]);

  const activeCat = cats.find(c => c.id === (activeCatId || cats[0]?.id)) || cats[0];

  // Summary totals (only convertible expenses are summed).
  const totalSpent = useMemo(() => cats.reduce((s, c) => s + c.spent, 0), [cats]);
  const memberCount = members.filter(m => m.status === 'active').length || 1;

  // Foreign (non-main) currencies present in expenses.
  const foreignCurrencies = useMemo(
    () => [...new Set(budgetExpenses.map(e => e.original_currency).filter(c => c && c !== mainCurrency))],
    [budgetExpenses, mainCurrency]
  );

  // Unconvertible expenses (no live rate, no override) grouped by currency.
  const missing = useMemo(() => {
    const map = {};
    for (const e of budgetExpenses) {
      const cur = e.original_currency;
      if (!cur || cur === mainCurrency) continue;
      if (!conv(e).ok) map[cur] = (map[cur] || 0) + 1;
    }
    return map;
  }, [budgetExpenses, mainCurrency, fx, overrides]);
  const missingCurrencies = Object.keys(missing);

  // City grouping - flatten all expenses with their category info.
  const cityGroups = useMemo(() => {
    const cityMap = {};
    for (const cat of cats) {
      for (const exp of cat.items) {
        const city = exp.city_name || '-';
        if (!cityMap[city]) cityMap[city] = [];
        cityMap[city].push({ ...exp, catColor: cat.color, catIcon: catIcon(cat), catName: cat.name });
      }
    }
    return Object.entries(cityMap).map(([city, items]) => ({
      city,
      total: items.reduce((s, it) => { const r = conv(it); return s + (r.ok ? r.value : 0); }, 0),
      items,
    }));
  }, [cats, fx, overrides, mainCurrency]);

  // Primary actions live in the global screen-title bar (the per-screen header).
  useTripScreenActions(
    <>
      <Btn variant="ghost" size="sm" icon="card" onClick={openFxDialog}>{t('budget.fx_button')}</Btn>
      <Btn variant="primary" size="sm" icon="plus" onClick={openAddExpense}>{t('budget.manual_expense')}</Btn>
    </>,
    [tripId, t, mainCurrency, budgetExpenses, budgetCategories],
  );

  // Skeleton
  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
        {[1,2,3].map(i => <Skeleton key={i} style={{ height: 80, borderRadius: 12 }} />)}
      </div>
    );
  }

  const noExpenses = budgetExpenses.length === 0;

  return (
    <>
      {/* Top summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 22 }}>
        {/* Всего потрачено */}
        <Card>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('budget.total_spent')}</div>
          <div className="num" style={{ fontSize: 'var(--fs-h2)', fontFamily: 'var(--font-display)', fontWeight: 600, marginTop: 4 }}>{money(totalSpent, mainCurrency)}</div>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 4 }}>
            {noExpenses ? t('trip.budget_empty') : `${budgetExpenses.length} ${budgetExpenses.length === 1 ? t('budget.expenses_count_one') : t('budget.expenses_count_many')}`}
          </div>
        </Card>

        {/* На одного */}
        <Card>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('budget.per_person_label')}</div>
          <div className="num" style={{ fontSize: 'var(--fs-h2)', fontFamily: 'var(--font-display)', fontWeight: 600, marginTop: 4 }}>{money(memberCount > 0 ? totalSpent / memberCount : totalSpent, mainCurrency)}</div>
          <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 4 }}>{memberCount} {memberCount === 1 ? t('trip.members_count_one') : t('trip.members_count_few')} · {t('budget.split_evenly')}</div>
        </Card>

        {/* Курсы валют */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('budget.fx_button')}</span>
          </div>
          {foreignCurrencies.length === 0 ? (
            <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 8, lineHeight: 1.5 }}>
              {t('budget.fx_empty')}
            </div>
          ) : (
            <div className="num" style={{ fontSize: 'var(--fs-base)', color: 'var(--ink)', marginTop: 8, lineHeight: 1.7 }}>
              {foreignCurrencies.map(cur => {
                const ov = overrides[cur];
                const rate = ov != null ? Number(ov) : liveRateToMain(fx, cur);
                return (
                  <div key={cur}>
                    {rate != null
                      ? `1 ${cur} ≈ ${Number(rate.toFixed(4))} ${mainCurrency}`
                      : `1 ${cur} ≈ - ${mainCurrency}`}
                  </div>
                );
              })}
            </div>
          )}
          {foreignCurrencies.length > 0 && (
            <Btn variant="ghost" size="sm" icon="edit" style={{ marginTop: 8 }} onClick={openFxDialog}>{t('budget.fx_change')}</Btn>
          )}
        </Card>
      </div>

      {/* Missing-rate warning */}
      {missingCurrencies.length > 0 && (
        <Severity level="warning" title={t('budget.rates_missing', { currencies: missingCurrencies.join(', ') })}>
          {missingCurrencies.map(cur => `${missing[cur]} ${missing[cur] === 1 ? t('budget.expenses_count_one') : t('budget.expenses_count_many')} · ${cur}`).join(', ')} {t('budget.not_in_total')}{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); openFxDialog(); }} style={{ fontWeight: 500 }}>{t('budget.set_rate_manual')}</a>
        </Severity>
      )}

      {/* No-expenses hero - horizontal dashed banner (matches design) */}
      {noExpenses && (
        <div style={{
          marginTop: missingCurrencies.length > 0 ? 14 : 4, marginBottom: 18, padding: 24,
          background: 'var(--surface)', border: '1.5px dashed var(--line)', borderRadius: 14,
          display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="wallet" size={24} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-strong)', marginBottom: 4 }}>{t('budget.no_expenses')}</div>
            <div className="muted" style={{ fontSize: 'var(--fs-base)', lineHeight: 1.5 }}>
              {t('budget.no_expenses_desc')}
            </div>
          </div>
          <Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.first_expense')}</Btn>
        </div>
      )}

      {/* Grouping controls - always shown (categories exist even before any expense) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 22, marginBottom: 14, flexWrap: 'wrap' }}>
        <div className="tweaks__seg">
          <button className={grouping === 'category' ? 'active' : ''} onClick={() => setGrouping('category')}>{t('budget.group_by_category')}</button>
          <button className={grouping === 'city' ? 'active' : ''} onClick={() => setGrouping('city')}>{t('budget.group_by_city')}</button>
        </div>
        <div style={{ flex: 1 }} />
        {grouping === 'category' && (
          <Btn variant="ghost" size="sm" icon="plus" onClick={openAddCategory}>{t('budget.field_category')}</Btn>
        )}
      </div>

      {grouping === 'category' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18 }}>
          {/* Left: categories */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {cats.map(c => {
              const active = activeCat?.id === c.id;
              const empty = c.itemCount === 0;
              return (
                <button key={c.id} onClick={() => setActiveCatId(c.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '11px 13px',
                  background: active ? 'var(--brand-soft)' : 'var(--surface)',
                  border: '1px solid ' + (active ? 'var(--brand-soft-12)' : 'var(--line)'),
                  borderRadius: 10, cursor: 'pointer', textAlign: 'left', width: '100%',
                }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, background: c.color + '22', color: c.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    <Icon name={catIcon(c)} size={14} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.name}
                      {c.kind === 'custom' && <Badge variant="quiet" style={{ fontSize: 'var(--fs-micro)', padding: '1px 5px' }}>{t('budget.custom_short')}</Badge>}
                    </div>
                    <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{empty ? t('budget.empty_word') : `${c.itemCount} ${c.itemCount === 1 ? t('budget.expenses_count_one') : t('budget.expenses_count_many')}`}</div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="num" style={{ fontWeight: 600, fontSize: 'var(--fs-base)', color: empty ? 'var(--muted-2)' : 'var(--ink)' }}>{money(c.spent, mainCurrency)}</div>
                    <div className="muted num" style={{ fontSize: 'var(--fs-micro)' }}>/ {money(c.planned_amount || 0, mainCurrency)}</div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: drill-down */}
          {activeCat && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: activeCat.color + '22', color: activeCat.color, display: 'grid', placeItems: 'center' }}>
                  <Icon name={catIcon(activeCat)} size={15} />
                </div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ marginBottom: 2 }}>{activeCat.name}</h3>
                  <div className="muted num" style={{ fontSize: 'var(--fs-meta)' }}>{money(activeCat.spent, mainCurrency)}</div>
                </div>
                {activeCat.kind === 'custom' && (
                  <Btn variant="ghost" size="sm" icon="edit" onClick={() => openEditCategory(activeCat)}>{t('visit.change')}</Btn>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeCat.items.length === 0 && (
                  <EmptyState
                    icon={catIcon(activeCat)}
                    title={t('budget.cat_empty', { name: activeCat.name })}
                    action={<Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.add_first')}</Btn>}
                  />
                )}
                {activeCat.items.map(exp => {
                  const r = conv(exp);
                  return (
                    <ExpenseRow
                      key={exp.id}
                      expense={exp}
                      catColor={activeCat.color}
                      catIcon={catIcon(activeCat)}
                      mainCurrency={mainCurrency}
                      mainAmount={r.value}
                      ok={r.ok}
                      onOpen={openExpense}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <CityGrouping cityGroups={cityGroups} mainCurrency={mainCurrency} conv={conv} onOpen={openExpense} onAdd={openAddExpense} />
      )}

      {/* Source event view (clicking a system expense) */}
      <SourceViewLoader
        kind={sourceView.kind}
        id={sourceView.id}
        open={sourceView.open}
        onOpenChange={(o) => setSourceView(s => ({ ...s, open: o }))}
        canEdit={true}
      />
    </>
  );
}

// ─── CityGrouping ─────────────────────────────────────────────────────────────

function CityGrouping({ cityGroups, mainCurrency, conv, onOpen, onAdd }) {
  const { t } = useI18n();
  const [activeCity, setActiveCity] = useState(cityGroups[0]?.city || '');
  const cur = cityGroups.find(g => g.city === activeCity) || cityGroups[0];

  if (cityGroups.length === 0) {
    return (
      <EmptyState
        icon="pin"
        title={t('budget.cities_empty')}
        body={t('budget.cities_empty_desc')}
        action={<Btn variant="primary" icon="plus" onClick={onAdd}>{t('budget.add_expense')}</Btn>}
      />
    );
  }
  if (!cur) return null;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {cityGroups.map(g => {
          const isActive = g.city === activeCity;
          return (
            <button key={g.city} onClick={() => setActiveCity(g.city)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 13px',
              background: isActive ? 'var(--brand-soft)' : 'var(--surface)',
              border: '1px solid ' + (isActive ? 'var(--brand-soft-12)' : 'var(--line)'),
              borderRadius: 10, cursor: 'pointer', textAlign: 'left', width: '100%',
            }}>
              <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
                <Icon name="pin" size={14} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>{g.city === '-' ? t('budget.no_city') : g.city}</div>
                <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{g.items.length} {g.items.length === 1 ? t('budget.expenses_count_one') : t('budget.expenses_count_many')}</div>
              </div>
              <div className="num" style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{money(g.total, mainCurrency)}</div>
            </button>
          );
        })}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10, gap: 8 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center' }}>
            <Icon name="pin" size={15} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ marginBottom: 2 }}>{cur.city === '-' ? t('budget.no_city') : cur.city}</h3>
            <div className="muted num" style={{ fontSize: 'var(--fs-meta)' }}>{cur.items.length} {cur.items.length === 1 ? t('budget.expenses_count_one') : t('budget.expenses_count_many')} · {money(cur.total, mainCurrency)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cur.items.map(it => {
            const r = conv(it);
            return (
              <ExpenseRow key={it.id} expense={it} catColor={it.catColor} catIcon={it.catIcon} catName={it.catName} showCategory
                mainCurrency={mainCurrency} mainAmount={r.value} ok={r.ok} onOpen={onOpen} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
