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
 *
 * Layout: Lumo redesign (2026-06-07). Summary band (category donut + total /
 * per-person / FX stat cards), a two-pane drill-down (categories ⇄ cities) and
 * richly tagged expense rows. The shell (sidebar, header, lens tabs, Pro gate)
 * is owned by TripView; this component renders only the budget body. Styling
 * lives in BudgetLens.css (page-scoped `.bgt-*` classes on Lumo tokens).
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
import { countTripMembers } from '@/lib/members';
import { Icon } from '../design/icons';
import { Badge, Btn, Dialog, Field, EmptyState, Skeleton, Severity, fmtDate } from '../design/index';
import CurrencySelect from '@/components/budget/CurrencySelect';
import SourceViewLoader from '@/components/budget/SourceViewLoader';
import { FieldError, IssuesPanel, fieldHasError, useHybridValidation } from '@/components/common/ValidationUI';
import './BudgetLens.css';

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
  return SYS_ICON[cat.system_key] || SYS_ICON[cat.icon] || cat.icon || 'wallet';
}

// money formatting helper (2 decimals, active locale)
const money = (value, cur) => fmtMoney(value, cur, getActiveLocale());

// ─── DonutChart ─────────────────────────────────────────────────────────────
// Pure-SVG ring driven by real category spend. `segments` = [{id,color,value}].
// Hovered segment thickens; the rest dim, kept in sync with the legend.

const DONUT_R = 40;
const DONUT_C = 2 * Math.PI * DONUT_R; // ≈ 251.33

function DonutChart({ segments, total, mainCurrency, hoveredId, centerLabel }) {
  let acc = 0;
  const arcs = segments.map(s => {
    const frac = total > 0 ? s.value / total : 0;
    const arc = frac * DONUT_C;
    const out = { ...s, arc, offset: -acc };
    acc += arc;
    return out;
  });
  return (
    <div className="bgt-donut">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={DONUT_R} fill="none" stroke="var(--surface-2)" strokeWidth="14" />
        {total > 0 && arcs.map(s => {
          const dim = hoveredId && hoveredId !== s.id;
          const hot = hoveredId === s.id;
          return (
            <circle
              key={s.id}
              className="bgt-donseg"
              cx="50" cy="50" r={DONUT_R} fill="none"
              stroke={s.color} strokeWidth={hot ? 20 : 16}
              strokeDasharray={`${s.arc} ${DONUT_C - s.arc}`}
              strokeDashoffset={s.offset}
              style={{ opacity: dim ? 0.4 : 1 }}
            />
          );
        })}
      </svg>
      <div className="bgt-donut__c">
        <span className="v">{money(total, mainCurrency)}</span>
        <span className="l">{centerLabel}</span>
      </div>
    </div>
  );
}

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
          <div className="bgt-amtgrp" data-vfield="amount" >
            <input className={`input num ${inv('amount')}`} type="number" placeholder="0" value={amount} onChange={e => { setAmount(e.target.value); v.markTouched('amount'); }} />
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

// ─── Delete confirm (manual expense, inline trash) ─────────────────────────────

function DeleteExpenseDialog({ expense, onSaved }) {
  const { t } = useI18n();
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  async function remove() {
    setDeleting(true);
    const { error } = await supabase.from('budget_expenses').delete().eq('id', expense.id);
    setDeleting(false);
    if (error) { setErr(error.message); return; }
    onSaved?.();
    window.__closeModal?.();
  }
  return (
    <Dialog title={t('trip.delete')} icon="trash" size="sm"
      foot={<>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('trip.form_cancel')}</Btn>
        <Btn variant="danger" icon="trash" onClick={remove} disabled={deleting}>{deleting ? t('budget.deleting') : t('trip.delete')}</Btn>
      </>}>
      <div style={{ fontSize: 'var(--fs-base)', color: 'var(--ink-2)' }}>
        {t('trip.delete')} «<b style={{ color: 'var(--ink)' }}>{expense.title || '-'}</b>»?
      </div>
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
    <Dialog title={t('budget.fx_button')} icon="arrowSwap" size="" foot={<>
      <div style={{ flex: 1 }} />
      <Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('trip.form_cancel')}</Btn>
      <Btn variant="primary" icon="check" onClick={() => v.attemptSubmit(apply)} disabled={saving} aria-disabled={!v.canSubmit}>{saving ? t('member.saving') : t('budget.apply')}</Btn>
    </>}>
      <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginBottom: 8 }}>
        {t('budget.fx_intro')}
      </div>
      {others.length === 0 ? (
        <EmptyState icon="wallet" title={t('budget.fx_no_other')} body={t('budget.fx_empty')} />
      ) : (
        <div>
          {others.map(code => {
            const live = liveRateToMain(fx, code);
            const hasOverride = currentOverrides?.[code] != null;
            const known = hasOverride || live != null;
            const shown = hasOverride ? Number(currentOverrides[code]) : live;
            const hintCls = hasOverride ? 'man' : (live == null ? 'miss' : '');
            const hint = hasOverride
              ? t('budget.fx_manual', { cur: mainCurrency })
              : live != null
                ? t('budget.fx_auto', { cur: mainCurrency })
                : t('budget.fx_not_found', { cur: mainCurrency });
            return (
              <div key={code} className="bgt-fxrow" data-vfield={`rate.${code}`}>
                <div className={`bgt-fxrow__cur ${known ? '' : 'miss'}`}>{code}</div>
                <div className="bgt-fxrow__m">
                  <div className="bgt-fxrow__eq">1 {code} = <b>{known ? Number(shown.toFixed(4)) : '?'}</b> {mainCurrency}</div>
                  <div className={`bgt-fxrow__hint ${hintCls}`}>{hint}</div>
                </div>
                <input className={`input num ${inv(`rate.${code}`)}`} type="number" step="0.0001" value={values[code] ?? ''}
                  onChange={e => { const val = e.target.value; setValues(s => ({ ...s, [code]: val })); v.markTouched(`rate.${code}`); }} placeholder="0.00" aria-label={`${code} → ${mainCurrency}`} />
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
    <Dialog title={existing ? t('budget.edit_category') : t('budget.category_new')} icon="grid" size="sm"
      foot={<>
        <div style={{ flex: 1 }} />
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
        <div className="bgt-swatches" role="group" aria-label={t('budget.color_label')}>
          {CAT_COLORS.map(c => (
            <button key={c} type="button" className={`bgt-swatch ${color === c ? 'on' : ''}`} style={{ background: c }}
              aria-pressed={color === c} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{t('budget.icon_label')}</div>
        <div className="bgt-iconpick" role="group" aria-label={t('budget.icon_label')}>
          {CAT_ICONS_BUDGET.map(ic => (
            <button key={ic} type="button" className={icon === ic ? 'on' : ''} aria-pressed={icon === ic}
              style={icon === ic ? { background: color + '22', borderColor: color, color } : undefined}
              onClick={() => setIcon(ic)}><Icon name={ic} size={18} /></button>
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
// `mode` decides the meta line: in category view we show city + date; in city
// view we show the category chip + date. Manual rows expose inline edit/delete;
// booking-linked rows open their source event (chevron).

function ExpenseRow({ expense, catColor, catIcon: icon, mode, catName, loc, mainCurrency, mainAmount, ok, onOpen, onEdit, onDelete }) {
  const { t } = useI18n();
  const src = expense.source_kind || 'manual';
  const isManual = src === 'manual';
  const dateStr = expense.spent_on ? fmtDate(expense.spent_on, loc) : '';
  const color = catColor || 'var(--brand)';
  return (
    <div className="bgt-exrow" onClick={() => onOpen?.(expense)}>
      <div className="bgt-exrow__d" style={{ background: color + '22', color }}>
        <Icon name={icon || SOURCE_ICON[src] || 'wallet'} size={18} />
      </div>
      <div className="bgt-exrow__m">
        <div className="bgt-exrow__t">{expense.title || '-'}</div>
        <div className="bgt-exrow__s">
          {mode === 'city' && catName && <span className="bgt-tagx bgt-tagx--cat">{catName}</span>}
          {mode !== 'city' && expense.city_name && <span>{expense.city_name}</span>}
          {dateStr && <><span className="sep" />{dateStr}</>}
          {isManual
            ? <span className="bgt-tagx bgt-tagx--manual">{t('budget.manual_badge')}</span>
            : <span className="bgt-tagx bgt-tagx--link"><Icon name="link" size={10} />{t('budget.booking_badge')}</span>}
        </div>
      </div>
      <div className={`bgt-exrow__amt ${ok ? '' : 'miss'}`}>
        {ok ? money(mainAmount, mainCurrency)
          : <span title={t('budget.rate_missing')}>{money(expense.original_amount || 0, expense.original_currency || mainCurrency)} ?</span>}
      </div>
      {isManual ? (
        <div className="bgt-exrow__acts">
          <button className="bgt-iconbtn" aria-label={t('trip.form_save')} onClick={e => { e.stopPropagation(); onEdit?.(expense); }}><Icon name="edit" size={15} /></button>
          <button className="bgt-iconbtn bgt-iconbtn--danger" aria-label={t('trip.delete')} onClick={e => { e.stopPropagation(); onDelete?.(expense); }}><Icon name="trash" size={15} /></button>
        </div>
      ) : (
        <svg className="bgt-exrow__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
      )}
    </div>
  );
}

// ─── BudgetLens ───────────────────────────────────────────────────────────────

export default function BudgetLens({ tripId, trip, budget, budgetCategories = [], budgetExpenses = [], members = [], cityVisits = [], isLoading, isPro, queryClient }) {
  const { t } = useI18n();
  const loc = getActiveLocale();
  const [grouping, setGrouping] = useState('category');
  const [activeCatId, setActiveCatId] = useState(null);
  const [hoveredSeg, setHoveredSeg] = useState(null);
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
  function openDeleteExpense(expense) {
    window.__openModal?.(<DeleteExpenseDialog expense={expense} onSaved={refresh} />);
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
      let spent = 0, missingCount = 0;
      for (const e of items) { const r = conv(e); if (r.ok) spent += r.value; else missingCount += 1; }
      return { ...cat, items, spent, itemCount: items.length, missingCount };
    });
  }, [budgetCategories, budgetExpenses, mainCurrency, fx, overrides]);

  const activeCat = cats.find(c => c.id === (activeCatId || cats[0]?.id)) || cats[0];

  // Summary totals (only convertible expenses are summed).
  const totalSpent = useMemo(() => cats.reduce((s, c) => s + c.spent, 0), [cats]);
  const memberCount = countTripMembers(members, trip?.created_by) || 1;

  // Donut segments — categories with spend, in category order.
  const donutSegments = useMemo(
    () => cats.filter(c => c.spent > 0).map(c => ({ id: c.id, color: c.color, value: c.spent, name: c.name })),
    [cats]
  );

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
  const missingTotal = useMemo(() => Object.values(missing).reduce((s, n) => s + n, 0), [missing]);

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

  const expensesPlural = (n) => n === 1 ? t('budget.expenses_count_one') : t('budget.expenses_count_many');

  // Primary actions live in the global screen-title bar (the per-screen header).
  useTripScreenActions(
    <>
      <Btn variant="ghost" size="sm" icon="arrowSwap" onClick={openFxDialog}>{t('budget.fx_button')}</Btn>
      <Btn variant="primary" size="sm" icon="plus" onClick={openAddExpense}>{t('budget.manual_expense')}</Btn>
    </>,
    [tripId, t, mainCurrency, budgetExpenses, budgetCategories],
  );

  // Skeleton
  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
        {[1, 2, 3].map(i => <Skeleton key={i} style={{ height: 80, borderRadius: 12 }} />)}
      </div>
    );
  }

  const noExpenses = budgetExpenses.length === 0;

  return (
    <div className="bgt">
      {/* ░ SUMMARY BAND ░ */}
      <div className="bgt-sumband">
        <div className="card bgt-donutcard">
          <div className="bgt-donutcard__h"><b>{t('budget.by_category_title')}</b></div>
          <div className="bgt-donutwrap">
            <DonutChart segments={donutSegments} total={totalSpent} mainCurrency={mainCurrency}
              hoveredId={hoveredSeg} centerLabel={t('budget.donut_total')} />
            <div className="bgt-dleg">
              {donutSegments.length === 0 && (
                <div className="muted" style={{ fontSize: 'var(--fs-meta)', padding: '6px 8px' }}>{t('budget.no_expenses')}</div>
              )}
              {donutSegments.map(s => {
                const pct = totalSpent > 0 ? Math.round((s.value / totalSpent) * 100) : 0;
                return (
                  <div key={s.id} className="bgt-dleg__row"
                    onMouseEnter={() => setHoveredSeg(s.id)} onMouseLeave={() => setHoveredSeg(null)}>
                    <span className="bgt-dleg__d" style={{ background: s.color }} />
                    <span className="bgt-dleg__n">{s.name}</span>
                    <span className="bgt-dleg__v">{money(s.value, mainCurrency)}</span>
                    <span className="bgt-dleg__p">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="bgt-statstack">
          {/* Всего потрачено */}
          <div className="card bgt-stat bgt-stat--total">
            <div className="bgt-stat__ic"><Icon name="wallet" size={21} /></div>
            <div className="bgt-stat__m">
              <div className="bgt-stat__l">{t('budget.total_spent')}</div>
              <div className="bgt-stat__v">{money(totalSpent, mainCurrency)}</div>
              <div className="bgt-stat__s">
                {noExpenses ? t('trip.budget_empty')
                  : <>{budgetExpenses.length} {expensesPlural(budgetExpenses.length)}{missingTotal > 0 && <> · {t('budget.no_rate_count', { n: missingTotal })}</>}</>}
              </div>
            </div>
          </div>

          {/* На одного */}
          <div className="card bgt-stat bgt-stat--ppl">
            <div className="bgt-stat__ic"><Icon name="users" size={21} /></div>
            <div className="bgt-stat__m">
              <div className="bgt-stat__l">{t('budget.per_person_label')}</div>
              <div className="bgt-stat__v">{money(memberCount > 0 ? totalSpent / memberCount : totalSpent, mainCurrency)}</div>
              <div className="bgt-stat__s">
                <b>{memberCount} {memberCount === 1 ? t('trip.members_count_one') : t('trip.members_count_few')}</b> · {t('budget.split_evenly')}
              </div>
            </div>
          </div>

          {/* Курсы валют */}
          <button type="button" className="card bgt-stat bgt-stat--fx" onClick={openFxDialog}>
            <div className="bgt-stat__ic"><Icon name="arrowSwap" size={21} /></div>
            <div className="bgt-stat__m">
              <div className="bgt-stat__l">{t('budget.fx_button')}</div>
              {foreignCurrencies.length === 0 ? (
                <div className="bgt-stat__s" style={{ marginTop: 4 }}>{t('budget.fx_empty')}</div>
              ) : (
                <>
                  <div className="bgt-fxlist">
                    {foreignCurrencies.map(cur => {
                      const ov = overrides[cur];
                      const rate = ov != null ? Number(ov) : liveRateToMain(fx, cur);
                      return rate != null
                        ? <span key={cur}>1 {cur} ≈ {Number(rate.toFixed(4))} {mainCurrency}</span>
                        : <span key={cur} className="miss">1 {cur} — {t('budget.fx_rate_unset')}</span>;
                    })}
                  </div>
                  <div className="bgt-stat__s" style={{ marginTop: 4 }}>{t('budget.fx_tap_edit')}</div>
                </>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* ░ MISSING-RATE WARNING ░ */}
      {missingCurrencies.length > 0 && (
        <Severity level="warning" title={t('budget.rates_missing', { currencies: missingCurrencies.join(', ') })}
          action={<Btn variant="quiet" size="sm" onClick={openFxDialog}>{t('budget.set_rate_manual')}</Btn>}>
          {missingCurrencies.map(cur => `${missing[cur]} ${expensesPlural(missing[cur])} · ${cur}`).join(', ')} {t('budget.not_in_total')}
        </Severity>
      )}

      {/* ░ NO-EXPENSES HERO ░ */}
      {noExpenses && (
        <div style={{
          marginTop: missingCurrencies.length > 0 ? 14 : 4, marginBottom: 18, padding: 24,
          background: 'var(--surface)', border: '1.5px dashed var(--line-strong)', borderRadius: 14,
          display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--primary-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="wallet" size={24} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-strong)', marginBottom: 4, color: 'var(--ink)' }}>{t('budget.no_expenses')}</div>
            <div className="muted" style={{ fontSize: 'var(--fs-base)', lineHeight: 1.5 }}>{t('budget.no_expenses_desc')}</div>
          </div>
          <Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.first_expense')}</Btn>
        </div>
      )}

      {/* ░ CONTROLS ░ */}
      <div className="bgt-ctl">
        <div className="tweaks__seg">
          <button className={grouping === 'category' ? 'active' : ''} onClick={() => setGrouping('category')}>{t('budget.group_by_category')}</button>
          <button className={grouping === 'city' ? 'active' : ''} onClick={() => setGrouping('city')}>{t('budget.group_by_city')}</button>
        </div>
        <div className="bgt-ctl__spacer" />
        {grouping === 'category' && (
          <Btn variant="soft" size="sm" icon="plus" onClick={openAddCategory}>{t('budget.field_category')}</Btn>
        )}
      </div>

      {/* ░ DRILLDOWN ░ */}
      {grouping === 'category' ? (
        <div className="bgt-drill">
          {/* categories */}
          <div className="card bgt-glist" role="tablist" aria-label={t('budget.group_by_category')}>
            {cats.map(c => {
              const active = activeCat?.id === c.id;
              const empty = c.itemCount === 0;
              return (
                <button key={c.id} type="button" role="tab" aria-selected={active}
                  className={`bgt-glist__row ${active ? 'on' : ''}`} onClick={() => setActiveCatId(c.id)}>
                  <span className="bgt-glist__ic" style={{ background: c.color + '22', color: c.color }}>
                    <Icon name={catIcon(c)} size={17} />
                  </span>
                  <span className="bgt-glist__m">
                    <span className="bgt-glist__n">
                      <span className="t">{c.name}</span>
                      {c.kind === 'custom' && <Badge variant="quiet">{t('budget.custom_short')}</Badge>}
                    </span>
                    <span className="bgt-glist__c">
                      {empty ? t('budget.empty_word') : `${c.itemCount} ${expensesPlural(c.itemCount)}`}
                      {c.missingCount > 0 && <> · <span className="miss">{t('budget.no_rate_count', { n: c.missingCount })}</span></>}
                    </span>
                  </span>
                  <span className="bgt-glist__r">
                    <span className={`bgt-glist__v ${empty ? 'muted' : ''}`}>{money(c.spent, mainCurrency)}</span>
                  </span>
                </button>
              );
            })}
            <button type="button" className="bgt-glist__add" onClick={openAddCategory}>
              <Icon name="plus" size={15} /> {t('budget.add_category')}
            </button>
          </div>

          {/* detail */}
          {activeCat && (
            <div className="card bgt-detail">
              <div className="bgt-detail__h">
                <div className="bgt-detail__ic" style={{ background: activeCat.color + '22', color: activeCat.color }}>
                  <Icon name={catIcon(activeCat)} size={22} />
                </div>
                <div className="bgt-detail__ti">
                  <div className="bgt-detail__n">
                    {activeCat.name}
                    {activeCat.kind === 'custom' && <Badge variant="quiet">{t('budget.custom_short')}</Badge>}
                  </div>
                  <div className="bgt-detail__s">{activeCat.itemCount} {expensesPlural(activeCat.itemCount)}</div>
                </div>
                <div className="bgt-detail__amt">
                  <div className="v">{money(activeCat.spent, mainCurrency)}</div>
                  <div className="l">{t('budget.spent_label')}</div>
                </div>
              </div>
              {activeCat.kind === 'custom' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
                  <Btn variant="ghost" size="sm" icon="edit" onClick={() => openEditCategory(activeCat)}>{t('visit.change')}</Btn>
                </div>
              )}
              {activeCat.items.length === 0 ? (
                <EmptyState icon={catIcon(activeCat)} title={t('budget.cat_empty', { name: activeCat.name })}
                  action={<Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.add_first')}</Btn>} />
              ) : (
                <div className="bgt-exlist">
                  {activeCat.items.map(exp => {
                    const r = conv(exp);
                    return (
                      <ExpenseRow key={exp.id} expense={exp} catColor={activeCat.color} catIcon={catIcon(activeCat)}
                        mode="category" loc={loc} mainCurrency={mainCurrency} mainAmount={r.value} ok={r.ok}
                        onOpen={openExpense} onEdit={openEditExpense} onDelete={openDeleteExpense} />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <CityGrouping cityGroups={cityGroups} mainCurrency={mainCurrency} conv={conv} loc={loc}
          expensesPlural={expensesPlural} onOpen={openExpense} onEdit={openEditExpense} onDelete={openDeleteExpense} onAdd={openAddExpense} />
      )}

      {/* Source event view (clicking a system expense) */}
      <SourceViewLoader
        kind={sourceView.kind}
        id={sourceView.id}
        open={sourceView.open}
        onOpenChange={(o) => setSourceView(s => ({ ...s, open: o }))}
        canEdit={true}
      />
    </div>
  );
}

// ─── CityGrouping ─────────────────────────────────────────────────────────────

function CityGrouping({ cityGroups, mainCurrency, conv, loc, expensesPlural, onOpen, onEdit, onDelete, onAdd }) {
  const { t } = useI18n();
  const [activeCity, setActiveCity] = useState(cityGroups[0]?.city || '');
  const cur = cityGroups.find(g => g.city === activeCity) || cityGroups[0];

  if (cityGroups.length === 0) {
    return (
      <EmptyState icon="pin" title={t('budget.cities_empty')} body={t('budget.cities_empty_desc')}
        action={<Btn variant="primary" icon="plus" onClick={onAdd}>{t('budget.add_expense')}</Btn>} />
    );
  }
  if (!cur) return null;
  const cityLabel = (c) => c === '-' ? t('budget.no_city') : c;

  return (
    <div className="bgt-drill">
      <div className="card bgt-glist" role="tablist" aria-label={t('budget.group_by_city')}>
        {cityGroups.map(g => {
          const active = g.city === activeCity;
          return (
            <button key={g.city} type="button" role="tab" aria-selected={active}
              className={`bgt-glist__row ${active ? 'on' : ''}`} onClick={() => setActiveCity(g.city)}>
              <span className="bgt-glist__ic" style={{ background: 'var(--primary-soft)', color: 'var(--brand)' }}>
                <Icon name="pin" size={17} />
              </span>
              <span className="bgt-glist__m">
                <span className="bgt-glist__n"><span className="t">{cityLabel(g.city)}</span></span>
                <span className="bgt-glist__c">{g.items.length} {expensesPlural(g.items.length)}</span>
              </span>
              <span className="bgt-glist__r"><span className="bgt-glist__v">{money(g.total, mainCurrency)}</span></span>
            </button>
          );
        })}
      </div>
      <div className="card bgt-detail">
        <div className="bgt-detail__h">
          <div className="bgt-detail__ic" style={{ background: 'var(--primary-soft)', color: 'var(--brand)' }}>
            <Icon name="pin" size={22} />
          </div>
          <div className="bgt-detail__ti">
            <div className="bgt-detail__n">{cityLabel(cur.city)}</div>
            <div className="bgt-detail__s">{cur.items.length} {expensesPlural(cur.items.length)}</div>
          </div>
          <div className="bgt-detail__amt">
            <div className="v">{money(cur.total, mainCurrency)}</div>
            <div className="l">{t('budget.spent_label')}</div>
          </div>
        </div>
        <div className="bgt-exlist">
          {cur.items.map(it => {
            const r = conv(it);
            return (
              <ExpenseRow key={it.id} expense={it} catColor={it.catColor} catIcon={it.catIcon} catName={it.catName}
                mode="city" loc={loc} mainCurrency={mainCurrency} mainAmount={r.value} ok={r.ok}
                onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
