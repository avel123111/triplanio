// @ts-check
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
import { invokeFn } from '@/lib/invokeFn';
import { track } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFxRates } from '@/lib/fx';
import { toMain as toMainCur } from '@/lib/budget/money';
import { currencySymbol } from '@/lib/budget/currencies';
import { CATEGORY_HEXES, DEFAULT_CATEGORY_HEX } from '@/lib/budget/category-colors';
import { budgetCategoryOptions, categoryDisplayName } from '@/lib/budget/constants';
import { getActiveLocale, fmtMoneyActive } from '@/lib/i18n/format';
import { countTripMembers, roleCanEdit } from '@/lib/members';
import { Icon } from '../design/icons';
import { Badge, Btn, Dialog, IconBtn, Field, EmptyState, Input, InputGroup, Skeleton, Severity, ReadOnlyBanner, Textarea, fmtDate, CurrencyCombobox } from '../design/index';
import DateTimeInput from '@/components/common/DateTimeInput';
import { FieldError, IssuesPanel, fieldState, useHybridValidation } from '@/components/common/ValidationUI';
import './BudgetLens.css';

// ─── запись бюджета: клиентская половина единой двери (TRIP-394) ──────────────
//
// Все записи бюджета идут ЧЕРЕЗ ЭТУ ДВЕРЬ, не прямым PostgREST: право (editor),
// Pro-гейт, скоуп строки и кэпы длины держит сервер (`trip-budget` + шов
// `_shared/mutate.ts`). Действие — сегмент пути; SDK сохраняет слэш в имени, так
// что `trip-budget/expense` даёт `/functions/v1/trip-budget/expense`.
//
// invokeFn НЕ бросает на не-2xx (functions-js отдаёт {data:null,error}), поэтому
// проверяем `error`/`code` из НЕГО, а не `data.code` (handoff блок 0). tripId в
// теле у КАЖДОГО вызова — по нему сервер и проверяет право, и скоупит строку.
const budgetMutate = (action, body) => invokeFn(`trip-budget/${action}`, { body });

// Отказ → локализованный текст. Из UI достижим только PRO_REQUIRED (аддон
// бюджета включали на Pro-трипе, трип мог потерять Pro — редактор всё ещё видит
// экран, но новая запись отбивается 402). FORBIDDEN/NOT_FOUND/*_NOT_MANUAL/
// *_SYSTEM из гейтованного UI не приходят → общий «не удалось сохранить».
const BUDGET_REFUSAL = { PRO_REQUIRED: 'sub.locked_desc' };
const budgetErrText = (t, code) =>
  t(code && Object.hasOwn(BUDGET_REFUSAL, code) ? BUDGET_REFUSAL[code] : 'common.write_failed');

// ─── icon helpers ─────────────────────────────────────────────────────────────

const SOURCE_ICON = {
  hotel:    'bed',
  transfer: 'plane',
  activity: 'ticket',
  service:  'esim',
  manual:   'edit',
};

// Seeded categories store an icon slug (TRIP-230); older rows may still hold the
// emoji the previous seeder wrote, which is not a design-system icon — those
// land on the neutral wallet rather than rendering as a broken glyph.
function catIcon(cat) {
  return cat.icon && /^[a-z]+$/i.test(cat.icon) ? cat.icon : 'wallet';
}

// Identity of the city an expense belongs to, used as the "by city" group key.
// geonameid comes first so a city the trip visits twice stays ONE budget group;
// a visit without a geonameid stands for itself; an expense with no visit at all
// still groups on its frozen string, as it always did.
function cityGroupKey(expense, visit) {
  if (visit?.geonameid != null) return `g:${visit.geonameid}`;
  if (visit) return `v:${visit.id}`;
  return `s:${expense.city_name || ''}`;
}

// Budget amounts follow the Lumo design: rounded to whole units with the
// currency symbol as a prefix (e.g. €1 487). Grouping uses the active locale.
const money = (value, cur) => {
  const sym = currencySymbol(cur);
  const n = Math.round(Number(value) || 0);
  const grouped = new Intl.NumberFormat(getActiveLocale() || undefined, { maximumFractionDigits: 0 }).format(n);
  return sym ? `${sym}${grouped}` : `${grouped}${cur ? ' ' + cur : ''}`;
};

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
        {/* TRIP-225: центр кольца — компактный формат (₽1,3 млн), переиспуем общий
            fmtMoneyActive({compact}); детализация/легенда ниже остаются полными. */}
        <span className="v">{fmtMoneyActive(total, mainCurrency, { compact: true })}</span>
        <span className="l">{centerLabel}</span>
      </div>
    </div>
  );
}

// ─── AddExpenseDialog (create + edit manual expense) ────────────────────────────

// Picker value for an expense that carries only a legacy city string, with no
// visit to point at — distinct from '' ("no city"), which clears it.
const ORPHAN_CITY = '__orphan_city__';

// `cities` — the trip's city_visits (already localized). The picker stores the
// VISIT, not its label: a label frozen at save time is stuck in whatever language
// the UI was in, and the two writers disagreed on that (TRIP-230).
export function AddExpenseDialog({ tripId, categories, mainCurrency, cities = [], existing = null, onSaved, open, onOpenChange }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);
  const isEdit = !!existing;
  const [title, setTitle] = useState(existing?.title || '');
  const [amount, setAmount] = useState(existing?.original_amount != null ? String(existing.original_amount) : '');
  const [currency, setCurrency] = useState(existing?.original_currency || mainCurrency || 'EUR');
  const [categoryId, setCategoryId] = useState(existing?.category_id || categories[0]?.id || '');
  const [date, setDate] = useState(existing?.spent_on || '');
  // An expense saved before TRIP-230 (or one the backfill couldn't resolve
  // unambiguously) remembers only a city STRING. Offer it as its own option:
  // without it the picker would open on "-" and the next Save would silently
  // wipe the city the user never touched.
  const orphanCity = !existing?.city_visit_id ? (existing?.city_name || '') : '';
  const [cityVisitId, setCityVisitId] = useState(existing?.city_visit_id || (orphanCity ? ORPHAN_CITY : ''));
  const [notes, setNotes] = useState(existing?.notes || '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const v = useHybridValidation('expense', { title, amount, categoryId });
  const st = (f) => fieldState(v.displayIssues, f);

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
      city_visit_id: cityVisitId === ORPHAN_CITY ? null : (cityVisitId || null),
      // Kept in step as a fallback label for anything reading the row without
      // the visit (and for rows whose visit is later deleted).
      city_name: cityVisitId === ORPHAN_CITY
        ? orphanCity
        : (cities.find((c) => c.id === cityVisitId)?.city_name || null),
    };
    // source_kind/source_id/created_by ставит сервер (ручная дверь рождает
    // только ручную трату) — клиент их больше не шлёт.
    const { error, code } = await budgetMutate('expense',
      isEdit ? { tripId, id: existing.id, ...row } : { tripId, ...row });
    if (error) {
      setSaving(false);
      setErr(budgetErrText(t, code));
      return;
    }
    setSaving(false);
    if (!isEdit) {
      track('budget_expense_added', { trip_id: tripId, has_fx: currency !== (mainCurrency || 'EUR') });
    }
    onSaved?.();
    close();
  }

  async function remove() {
    if (!isEdit) return;
    setDeleting(true);
    const { error, code } = await budgetMutate('expense/delete', { tripId, id: existing.id });
    if (error) {
      setDeleting(false);
      setErr(budgetErrText(t, code));
      return;
    }
    setDeleting(false);
    onSaved?.();
    close();
  }

  return (
    <Dialog title={isEdit ? t('budget.edit_expense') : t('budget.manual_expense')} icon="wallet" size="" open={open} onOpenChange={onOpenChange}
      foot={<>
        {isEdit && (
          <Btn variant="danger" icon="trash" onClick={remove} disabled={deleting || saving}>{deleting ? t('budget.deleting') : t('trip.delete')}</Btn>
        )}
        <div className="grow" />
        <Btn variant="ghost" onClick={close}>{t('trip.form_cancel')}</Btn>
        <Btn variant="primary" icon="check" onClick={() => v.attemptSubmit(save)} disabled={saving} aria-disabled={!v.canSubmit}>
          {saving ? t('member.saving') : isEdit ? t('trip.form_save') : t('members.add')}
        </Btn>
      </>}>
      {/* Вертикальный ритм тела диалога - одна колонка со ступенью шкалы вместо
          marginTop на каждом соседе (было 14/14/14/12/10 вручную). */}
      <div className="col col--g7">
      <Field label={t('trip.description')} required={v.isRequired('title')}>
        {/* Обёртка остаётся ради `[data-vfield]` - по ней прокручивает к первой
            ошибке `focusField`. Красит теперь само поле. */}
        <div data-vfield="title">
          <Input {...st('title')} value={title} onChange={e => { setTitle(e.target.value); v.markTouched('title'); }} placeholder={t('budget.desc_ph')} autoFocus={!isMobile} />
        </div>
        <FieldError issues={v.displayIssues} field="title" />
      </Field>
      <div className="field-row cols-2">
        <Field label={t('budget.field_amount')} required={v.isRequired('amount')}>
          {/* Состояние - на ГРУППЕ, а не на поле внутри: рамку держит
              контейнер, у детей её нет. Заодно подсвечивается вся группа, а не
              половина того, что читается как одно поле. */}
          <InputGroup {...st('amount')} data-vfield="amount">
            <Input num type="number" placeholder="0" value={amount} onChange={e => { setAmount(e.target.value); v.markTouched('amount'); }} />
            <CurrencyCombobox value={currency} onChange={setCurrency} className="bgt-amtgrp__cur input-unit num" />
          </InputGroup>
          <FieldError issues={v.displayIssues} field="amount" />
        </Field>
        <Field label={t('budget.field_date')}>
          {/* Не нативный `type="date"`: тот рисуется по локали ОС - см. DateTimeInput.jsx */}
          <DateTimeInput withTime={false} value={date} onChange={setDate} />
        </Field>
      </div>
      <div className="field-row cols-2">
        <Field label={t('budget.field_category')} required={v.isRequired('categoryId')}>
          <div data-vfield="categoryId">
            <select className="select" {...st('categoryId')} value={categoryId} onChange={e => { setCategoryId(e.target.value); v.markTouched('categoryId'); }}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.displayName || c.name}</option>)}
            </select>
          </div>
          <FieldError issues={v.displayIssues} field="categoryId" />
        </Field>
        <Field label={t('visit.city')}>
          <select className="select" value={cityVisitId} onChange={e => setCityVisitId(e.target.value)}>
            <option value="">-</option>
            {orphanCity && <option value={ORPHAN_CITY}>{orphanCity}</option>}
            {cities.map((c) => <option key={c.id} value={c.id}>{c.city_name}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t('doc.notes_label')}>
        <Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('budget.free_text')} />
      </Field>
      <IssuesPanel issues={v.panelIssues} />
      {err && <Severity level="error">{err}</Severity>}
      </div>
    </Dialog>
  );
}

// ─── Delete confirm (manual expense, inline trash) ─────────────────────────────

function DeleteExpenseDialog({ expense, onSaved, open, onOpenChange }) {
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  async function remove() {
    setDeleting(true);
    // tripId — из строки (её FK на трип), сервер по нему скоупит удаление.
    const { error, code } = await budgetMutate('expense/delete', {
      tripId: expense.trip_id, id: expense.id,
    });
    if (error) {
      setDeleting(false);
      setErr(budgetErrText(t, code));
      return;
    }
    setDeleting(false);
    onSaved?.();
    close();
  }
  return (
    <Dialog title={t('trip.delete')} icon="trash" size="sm" open={open} onOpenChange={onOpenChange}
      foot={<>
        <div className="grow" />
        <Btn variant="ghost" onClick={close}>{t('trip.form_cancel')}</Btn>
        <Btn variant="danger" icon="trash" onClick={remove} disabled={deleting}>{deleting ? t('budget.deleting') : t('trip.delete')}</Btn>
      </>}>
      <div className="col col--g7">
        <div className="t-body" style={{ color: 'var(--ink-2)' }}>
          {t('trip.delete')} «<b style={{ color: 'var(--ink)' }}>{expense.title || '-'}</b>»?
        </div>
        {err && <Severity level="error">{err}</Severity>}
      </div>
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

function FxRatesDialog({ tripId, mainCurrency, currencies, currentOverrides, fx, onSaved, open, onOpenChange }) {
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);
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
  const st = (f) => fieldState(v.displayIssues, f);

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
    // Self-heal строки бюджета делает СЕРВЕР (settings → ensure_trip_budget,
    // исполнима только service_role) — клиент больше не вставляет trip_budgets и
    // не пишет currency (на трипах без main_currency это роняло бы NOT NULL).
    const { error, code } = await budgetMutate('settings', { tripId, fx_overrides: next });
    if (error) {
      setSaving(false);
      setErr(budgetErrText(t, code));
      return;
    }
    setSaving(false);
    onSaved?.();
    close();
  }

  return (
    <Dialog title={t('budget.fx_button')} icon="arrowSwap" size="" open={open} onOpenChange={onOpenChange} foot={<>
      <div className="grow" />
      <Btn variant="ghost" onClick={close}>{t('trip.form_cancel')}</Btn>
      <Btn variant="primary" icon="check" onClick={() => v.attemptSubmit(apply)} disabled={saving} aria-disabled={!v.canSubmit}>{saving ? t('member.saving') : t('budget.apply')}</Btn>
    </>}>
      <div className="col col--g4">
      <div className="t-ui">
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
              <div key={code} className="bgt-fxrow row row--g6" data-vfield={`rate.${code}`}>
                <div className={`bgt-fxrow__cur tile tile--xl ${known ? '' : 'miss'}`}>{currencySymbol(code) || code}</div>
                <div className="grow--fit">
                  <div className="bgt-fxrow__eq">1 {code} = <b>{known ? Number(shown.toFixed(4)) : '?'}</b> {mainCurrency}</div>
                  <div className={`bgt-fxrow__hint ${hintCls}`}>{hint}</div>
                </div>
                <input className="input num" {...st(`rate.${code}`)} type="number" step="0.0001" value={values[code] ?? ''}
                  onChange={e => { const val = e.target.value; setValues(s => ({ ...s, [code]: val })); v.markTouched(`rate.${code}`); }} placeholder="0.00" aria-label={`${code} → ${mainCurrency}`} />
              </div>
            );
          })}
        </div>
      )}
      <IssuesPanel issues={v.panelIssues} />
      {err && <Severity level="error">{err}</Severity>}
      </div>
    </Dialog>
  );
}

// ─── AddCategoryDialog ────────────────────────────────────────────────────────

// Category palette = the Lumo --cat-1..8 tokens (single source: category-colors).
const CAT_COLORS = CATEGORY_HEXES;
const CAT_ICONS_BUDGET = ['wallet', 'bed', 'plane', 'ticket', 'cup', 'cam', 'shield', 'gift', 'esim', 'card'];

function AddCategoryDialog({ tripId, existing, onSaved, open, onOpenChange }) {
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);
  // Edit a seeded category and the field must start from what the user SEES —
  // the localized label, not the English `name` the seeder stored (TRIP-230).
  const [name, setName] = useState(existing ? categoryDisplayName(existing, t) : '');
  const [color, setColor] = useState(existing?.color || DEFAULT_CATEGORY_HEX);
  const [icon, setIcon] = useState(existing?.icon || CAT_ICONS_BUDGET[0]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const v = useHybridValidation('category', { name });
  const st = (f) => fieldState(v.displayIssues, f);

  async function save() {
    setSaving(true);
    setErr('');
    // Переименование СЕЯНОЙ категории делает её собственной: отвязка system_key
    // не даёт при следующей смене языка перевести поверх пользовательского
    // текста (TRIP-230). Считается это от ЛОКАЛИЗОВАННОЙ подписи, поэтому живёт
    // на клиенте — сервер языка зрителя не знает; он принимает только ОБНУЛЕНИЕ
    // ключа (clearOnly), присвоить чужой нельзя (по нему роутятся автотраты).
    // kind/order_index/created_by на вставке ставит сервер.
    const dropsSeedKey = existing?.kind === 'custom' && !!existing.system_key
      && name.trim() !== categoryDisplayName(existing, t);
    const { error, code } = await budgetMutate('category', existing
      ? { tripId, id: existing.id, name: name.trim(), color, icon,
          ...(dropsSeedKey ? { system_key: null } : {}) }
      : { tripId, name: name.trim(), icon, color });
    if (error) {
      setSaving(false);
      setErr(budgetErrText(t, code));
      return;
    }
    setSaving(false);
    onSaved?.();
    close();
  }

  return (
    <Dialog title={existing ? t('budget.edit_category') : t('budget.category_new')} icon="grid" size="sm" open={open} onOpenChange={onOpenChange}
      foot={<>
        <div className="grow" />
        <Btn variant="ghost" onClick={close}>{t('trip.form_cancel')}</Btn>
        <Btn variant="primary" icon="check" onClick={() => v.attemptSubmit(save)} disabled={saving} aria-disabled={!v.canSubmit}>{saving ? t('member.saving') : existing ? t('trip.form_save') : t('members.add')}</Btn>
      </>}>
      <div className="col col--g7">
      <Field label={t('trip.title_label')} required={v.isRequired('name')}>
        <div data-vfield="name">
          <Input {...st('name')} value={name} onChange={e => { setName(e.target.value); v.markTouched('name'); }} placeholder={t('budget.cat_name_ph')} autoFocus={!isMobile} />
        </div>
        <FieldError issues={v.displayIssues} field="name" />
      </Field>
      <div className="col col--g4">
        <div className="field__label">{t('budget.color_label')}</div>
        <div className="row row--g4 row--wrap" role="group" aria-label={t('budget.color_label')}>
          {CAT_COLORS.map(c => (
            <button key={c} type="button" className={`bgt-swatch tile tile--sm ${color === c ? 'on' : ''}`} style={{ background: c }}
              aria-pressed={color === c} onClick={() => setColor(c)} />
          ))}
        </div>
      </div>
      <div className="col col--g4">
        <div className="field__label">{t('budget.icon_label')}</div>
        <div className="bgt-iconpick row row--g4 row--wrap" role="group" aria-label={t('budget.icon_label')}>
          {CAT_ICONS_BUDGET.map(ic => (
            <button key={ic} type="button" className={`tile tile--lg ${icon === ic ? 'on' : ''}`} aria-pressed={icon === ic}
              style={icon === ic ? { background: color + '22', borderColor: color, color } : undefined}
              onClick={() => setIcon(ic)}><Icon name={ic} size={18} /></button>
          ))}
        </div>
      </div>
      <IssuesPanel issues={v.panelIssues} />
      {err && <Severity level="error">{err}</Severity>}
      </div>
    </Dialog>
  );
}

// ─── ExpenseRow ───────────────────────────────────────────────────────────────
// `mainAmount` is the converted value; `ok=false` means no rate was available.
// `mode` decides the meta line: in category view we show city + date; in city
// view we show the category chip + date. Manual rows expose inline edit/delete;
// booking-linked rows open their source event (chevron).

// `cityName` is resolved by the caller from the expense's visit (falling back to
// the frozen string), so the row shows the city in the current language.
/** @param {{ expense: any, catColor?: any, catIcon?: any, mode?: string, catName?: any, cityName?: any, loc?: any, mainCurrency?: any, mainAmount?: any, ok?: boolean, onOpen?: any, onEdit?: any, onDelete?: any, readOnly?: boolean }} p */
function ExpenseRow({ expense, catColor, catIcon: icon, mode, catName, cityName, loc, mainCurrency, mainAmount, ok, onOpen, onEdit, onDelete, readOnly }) {
  const { t } = useI18n();
  const src = expense.source_kind || 'manual';
  const isManual = src === 'manual';
  const dateStr = expense.spent_on ? fmtDate(expense.spent_on, loc) : '';
  const color = catColor || 'var(--brand)';
  return (
    <div className="bgt-exrow row row--g6" onClick={() => onOpen?.(expense)}>
      <div className="tile tile--lg" style={{ background: color + '22', color }}>
        <Icon name={icon || SOURCE_ICON[src] || 'wallet'} size={18} />
      </div>
      <div className="grow--fit">
        <div className="bgt-exrow__t trunc">{expense.title || '-'}</div>
        <div className="bgt-exrow__s row row--g4 row--wrap">
          {mode === 'city' && catName && <span className="badge badge--xs bgt-tagx--cat">{catName}</span>}
          {mode !== 'city' && cityName && <span>{cityName}</span>}
          {dateStr && <><span className="sep" />{dateStr}</>}
          {isManual
            ? <span className="badge badge--xs bgt-tagx--manual">{t('budget.manual_badge')}</span>
            : <span className="badge badge--xs bgt-tagx--link"><Icon name="link" />{t('budget.booking_badge')}</span>}
        </div>
      </div>
      <div className={`bgt-exrow__amt ${ok ? '' : 'miss'}`}>
        {ok ? money(mainAmount, mainCurrency)
          : <span title={t('budget.rate_missing')}>{money(expense.original_amount || 0, expense.original_currency || mainCurrency)} ?</span>}
      </div>
      {isManual ? (
        !readOnly && (
          <div className="bgt-exrow__acts row row--g2">
            {/* ★TRIP-344: `tile--sm` был ТРЕТЬЕЙ стороной (28px) — ступень
                ПЛИТКИ на контроле, мимо обеих ступеней кнопки. Опасный ховер
                больше не экранное имя: тон `danger` теперь есть в каноне. */}
            <IconBtn icon="edit" size="sm" ariaLabel={t('trip.form_save')} onClick={e => { e.stopPropagation(); onEdit?.(expense); }} />
            <IconBtn icon="trash" size="sm" tone="danger" ariaLabel={t('trip.delete')} onClick={e => { e.stopPropagation(); onDelete?.(expense); }} />
          </div>
        )
      ) : (
        <svg className="bgt-exrow__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg>
      )}
    </div>
  );
}

// ─── BudgetLens ───────────────────────────────────────────────────────────────

export default function BudgetLens({ tripId, trip, budget, budgetCategories = [], budgetExpenses = [], members = [], cityVisits = [], isLoading, isPro, role, queryClient, onOpenSource }) {
  const { t } = useI18n();
  const loc = getActiveLocale();
  // Viewer = строго только чтение (серверная защита — RLS _can_edit_trip, TRIP-124).
  // UI прячет мутации, чтобы прямые записи не падали молчаливым 403.
  const readOnly = !roleCanEdit(role);
  const [grouping, setGrouping] = useState('category');
  const [activeCatId, setActiveCatId] = useState(null);
  const [hoveredSeg, setHoveredSeg] = useState(null);
  const [expenseModal, setExpenseModal] = useState(null); // null | { existing?: row }
  const [deleteExpense, setDeleteExpense] = useState(null); // null | expense row
  const [categoryModal, setCategoryModal] = useState(null); // null | { existing?: row }
  const [fxOpen, setFxOpen] = useState(false);

  // Main display currency: trip settings (default EUR); trip_budgets.currency
  // is a legacy fallback.
  const mainCurrency = trip?.details?.main_currency || budget?.currency || 'EUR';
  const { data: fx } = useFxRates(mainCurrency);
  const overrides = budget?.fx_overrides || {};

  // Convert an expense → { value, ok } in main currency (override-aware).
  const conv = (e) => toMainCur(e.original_amount, e.original_currency || mainCurrency, mainCurrency, fx, overrides);

  const cityOptions = cityVisits.filter(v => v.city_name);

  function openAddExpense() {
    if (readOnly) return;
    setExpenseModal({});
  }
  function openEditExpense(expense) {
    if (readOnly) return;
    setExpenseModal({ existing: expense });
  }
  function openDeleteExpense(expense) {
    if (readOnly) return;
    setDeleteExpense(expense);
  }
  function openAddCategory() {
    if (readOnly) return;
    setCategoryModal({});
  }
  function openEditCategory(cat) {
    if (readOnly) return;
    setCategoryModal({ existing: cat });
  }
  function openFxDialog() {
    if (readOnly) return;
    setFxOpen(true);
  }

  // Open an expense - system expense → its source event view; manual → edit dialog.
  function openExpense(expense) {
    const src = expense.source_kind || 'manual';
    if (src === 'manual') { openEditExpense(expense); return; }
    if (expense.source_id && SOURCE_ICON[src]) {
      // Event view/edit is hosted centrally by TripView (drawer for
      // hotel/transfer/activity, modal for services) — TRIP-195.
      onOpenSource?.(src, expense.source_id);
    }
  }

  function refresh() {
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
  }

  // Build enriched categories with converted totals.
  // Order: the four canonical system categories first (fixed canonical
  // order), then all custom categories - including "food", which was demoted
  // from system to custom and must sit with the other custom categories.
  const cats = useMemo(() => budgetCategoryOptions(budgetCategories, t).map(cat => {
    const items = budgetExpenses.filter(e => e.category_id === cat.id);
    let spent = 0, missingCount = 0;
    for (const e of items) { const r = conv(e); if (r.ok) spent += r.value; else missingCount += 1; }
    return { ...cat, items, spent, itemCount: items.length, missingCount };
  }), [budgetCategories, budgetExpenses, mainCurrency, fx, overrides, t]);

  const activeCat = cats.find(c => c.id === (activeCatId || cats[0]?.id)) || cats[0];

  // Summary totals (only convertible expenses are summed).
  const totalSpent = useMemo(() => cats.reduce((s, c) => s + c.spent, 0), [cats]);
  const memberCount = countTripMembers(members, trip?.created_by) || 1;

  // Donut segments — categories with spend, in category order.
  const donutSegments = useMemo(
    () => cats.filter(c => c.spent > 0).map(c => ({ id: c.id, color: c.color, value: c.spent, name: c.displayName })),
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

  // City grouping — flatten all expenses with their category info.
  //
  // Grouped by the city's IDENTITY, not by the stored label: the same city used
  // to split in two whenever the two writers spelled it differently ('Moscow'
  // vs 'Moskva'). The label is re-derived from the (already localized) visit, so
  // switching language now switches the budget too.
  const visitById = useMemo(() => new Map(cityVisits.map((v) => [v.id, v])), [cityVisits]);
  const visitOf = (exp) => (exp.city_visit_id ? visitById.get(exp.city_visit_id) : null);
  // Same resolution in both views; '' means "city unknown".
  const cityLabelOf = (exp) => visitOf(exp)?.city_name || exp.city_name || '';
  const cityGroups = useMemo(() => {
    const cityMap = new Map();
    for (const cat of cats) {
      for (const exp of cat.items) {
        const key = cityGroupKey(exp, visitOf(exp));
        let g = cityMap.get(key);
        if (!g) { g = { id: key, label: cityLabelOf(exp), items: [] }; cityMap.set(key, g); }
        g.items.push({ ...exp, catColor: cat.color, catIcon: catIcon(cat), catName: cat.displayName });
      }
    }
    return [...cityMap.values()].map((g) => ({
      ...g,
      total: g.items.reduce((s, it) => { const r = conv(it); return s + (r.ok ? r.value : 0); }, 0),
    }));
  }, [cats, visitById, fx, overrides, mainCurrency]);

  const expensesPlural = (n) => n === 1 ? t('budget.expenses_count_one') : t('budget.expenses_count_many');

  // Skeleton
  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>
        {[1, 2, 3].map(i => <Skeleton key={i} style={{ height: 80, borderRadius: 'var(--r-sm)' }} />)}
      </div>
    );
  }

  const noExpenses = budgetExpenses.length === 0;

  return (
    <div className="bgt ov-anim">
      {readOnly && (
        <ReadOnlyBanner>{t('budget.readonly_banner_desc')}</ReadOnlyBanner>
      )}
      {/* ░ HEADER: screen title + primary actions relocated from the removed
          per-screen bar. On phones the buttons hide (see BudgetLens.css): "add
          expense" becomes the FAB below and "rates" is the FX stat card. ░ */}
      <div className="bgt-head row">
        <h2 className="bgt-head__title">{t('trip.sidebar_budget')}</h2>
        <span className="grow" />
        {!readOnly && (
          <>
            <Btn variant="ghost" icon="arrowSwap" onClick={openFxDialog}>{t('budget.fx_button')}</Btn>
            <Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.manual_expense')}</Btn>
          </>
        )}
      </div>
      {/* ░ SUMMARY BAND ░ */}
      <div className="bgt-sumband">
        <div className="card bgt-donutcard">
          <div className="bgt-donutcard__h row"><b>{t('budget.by_category_title')}</b></div>
          <div className="bgt-donutwrap row row--g8">
            <DonutChart segments={donutSegments} total={totalSpent} mainCurrency={mainCurrency}
              hoveredId={hoveredSeg} centerLabel={t('budget.donut_total')} />
            <div className="col col--g1 grow--fit">
              {donutSegments.length === 0 && (
                <div className="muted t-meta" style={{ padding: '6px 8px' }}>{t('budget.no_expenses')}</div>
              )}
              {donutSegments.map(s => {
                const pct = totalSpent > 0 ? Math.round((s.value / totalSpent) * 100) : 0;
                return (
                  <div key={s.id} className="bgt-dleg__row row row--g4"
                    onMouseEnter={() => setHoveredSeg(s.id)} onMouseLeave={() => setHoveredSeg(null)}>
                    <span className="bgt-dleg__d" style={{ background: s.color }} />
                    <span className="bgt-dleg__n grow--fit trunc">{s.name}</span>
                    <span className="bgt-dleg__v">{money(s.value, mainCurrency)}</span>
                    <span className="bgt-dleg__p">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="col col--g6">
          {/* Всего потрачено */}
          <div className="card bgt-stat bgt-stat--total row row--g7">
            <div className="bgt-stat__ic tile tile--xl"><Icon name="wallet" size={21} /></div>
            <div className="grow--fit">
              <div className="bgt-stat__l">{t('budget.total_spent')}</div>
              <div className="bgt-stat__v">{money(totalSpent, mainCurrency)}</div>
              <div className="bgt-stat__s">
                {noExpenses ? t('trip.budget_empty')
                  : <>{budgetExpenses.length} {expensesPlural(budgetExpenses.length)}{missingTotal > 0 && <> · {t('budget.no_rate_count', { n: missingTotal })}</>}</>}
              </div>
            </div>
          </div>

          {/* На одного */}
          <div className="card bgt-stat bgt-stat--ppl row row--g7">
            <div className="bgt-stat__ic tile tile--xl"><Icon name="user" size={21} /></div>
            <div className="grow--fit">
              <div className="bgt-stat__l">{t('budget.per_person_label')}</div>
              <div className="bgt-stat__v">{money(memberCount > 0 ? totalSpent / memberCount : totalSpent, mainCurrency)}</div>
              <div className="bgt-stat__s">
                <b>{memberCount} {memberCount === 1 ? t('trip.members_count_one') : t('trip.members_count_few')}</b> · {t('budget.split_evenly')}
              </div>
            </div>
          </div>

          {/* Курсы валют */}
          <button type="button" className="card bgt-stat bgt-stat--fx row row--g7" onClick={readOnly ? undefined : openFxDialog}>
            <div className="bgt-stat__ic tile tile--xl"><Icon name="arrowSwap" size={21} /></div>
            <div className="grow--fit">
              <div className="bgt-stat__l">{t('budget.fx_button')}</div>
              {foreignCurrencies.length === 0 ? (
                <div className="bgt-stat__s" style={{ marginTop: 4 }}>{t('budget.fx_empty')}</div>
              ) : (
                <>
                  <div className="bgt-fxlist row row--wrap">
                    {foreignCurrencies.map(cur => {
                      const ov = overrides[cur];
                      const rate = ov != null ? Number(ov) : liveRateToMain(fx, cur);
                      return rate != null
                        ? <span key={cur} >1 {cur} ≈ {Number(rate.toFixed(4))} {mainCurrency}</span>
                        : <span key={cur} className="miss">1 {cur} — {t('budget.fx_rate_unset')}</span>;
                    })}
                  </div>
                  {!readOnly && <div className="bgt-stat__s" style={{ marginTop: 4 }}>{t('budget.fx_tap_edit')}</div>}
                </>
              )}
            </div>
          </button>
        </div>
      </div>

      {/* ░ MISSING-RATE WARNING ░ */}
      {missingCurrencies.length > 0 && (
        <Severity level="warning" title={t('budget.rates_missing', { currencies: missingCurrencies.join(', ') })}
          action={readOnly ? undefined : <Btn variant="quiet" onClick={openFxDialog}>{t('budget.set_rate_manual')}</Btn>}>
          {missingCurrencies.map(cur => `${missing[cur]} ${expensesPlural(missing[cur])} · ${cur}`).join(', ')} {t('budget.not_in_total')}
        </Severity>
      )}

      {/* ░ NO-EXPENSES HERO ░ */}
      {noExpenses && (
        // inline-style-exempt: отступ сверху зависит от того, стоит ли выше
        // плашка «нет курса» — это состояние данных, а не вёрстка.
        <div className="empty-note row row--g7 row--wrap" style={{ marginTop: missingCurrencies.length > 0 ? 16 : 4 }}>
          <span className="en-ic tile tile--lg"><Icon name="wallet" /></span>
          <span className="en-tx grow--fit">
            <b>{t('budget.no_expenses')}</b>
            <span>{t('budget.no_expenses_desc')}</span>
          </span>
          {!readOnly && <Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.first_expense')}</Btn>}
        </div>
      )}

      {/* ░ CONTROLS ░ */}
      <div className="bgt-ctl row row--g6 row--wrap">
        <div className="seg" role="group" aria-label={t('budget.group_by_category')}>
          <button type="button" aria-pressed={grouping === 'category'} onClick={() => setGrouping('category')}><Icon name="grid" size={14} />{t('budget.group_by_category')}</button>
          <button type="button" aria-pressed={grouping === 'city'} onClick={() => setGrouping('city')}><Icon name="pin" size={14} />{t('budget.group_by_city')}</button>
        </div>
        <div className="grow" />
        {grouping === 'category' && !readOnly && (
          <Btn variant="soft" icon="plus" onClick={openAddCategory}>{t('budget.field_category')}</Btn>
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
                  className={`bgt-glist__row row row--g6 ${active ? 'on' : ''}`} onClick={() => setActiveCatId(c.id)}>
                  <span className="tile" style={{ background: c.color + '22', color: c.color }}>
                    <Icon name={catIcon(c)} size={17} />
                  </span>
                  <span className="grow--fit">
                    <span className="bgt-glist__n row row--g4">
                      <span className="t trunc">{c.displayName}</span>
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
            {!readOnly && (
              <button type="button" className="bgt-glist__add row row--g4" onClick={openAddCategory}>
                <Icon name="plus" size={15} /> {t('budget.add_category')}
              </button>
            )}
          </div>

          {/* detail */}
          {activeCat && (
            <div className="card bgt-detail">
              <div className="bgt-detail__h row row--g6">
                <div className="tile tile--xl" style={{ background: activeCat.color + '22', color: activeCat.color }}>
                  <Icon name={catIcon(activeCat)} size={22} />
                </div>
                <div className="grow--fit">
                  <div className="bgt-detail__n row row--g4">
                    {activeCat.displayName}
                    {activeCat.kind === 'custom' && <Badge variant="quiet">{t('budget.custom_short')}</Badge>}
                  </div>
                  <div className="bgt-detail__s">{activeCat.itemCount} {expensesPlural(activeCat.itemCount)}</div>
                </div>
                <div className="bgt-detail__amt">
                  <div className="v">{money(activeCat.spent, mainCurrency)}</div>
                  <div className="l">{t('budget.spent_label')}</div>
                </div>
              </div>
              {activeCat.kind === 'custom' && !readOnly && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 10 }}>
                  <Btn variant="ghost" icon="edit" onClick={() => openEditCategory(activeCat)}>{t('visit.change')}</Btn>
                </div>
              )}
              {activeCat.items.length === 0 ? (
                <EmptyState icon={catIcon(activeCat)} title={t('budget.cat_empty', { name: activeCat.displayName })}
                  action={readOnly ? undefined : <Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.add_first')}</Btn>} />
              ) : (
                <div className="bgt-exlist col col--g4">
                  {activeCat.items.map(exp => {
                    const r = conv(exp);
                    return (
                      <ExpenseRow key={exp.id} expense={exp} catColor={activeCat.color} catIcon={catIcon(activeCat)}
                        cityName={cityLabelOf(exp)}
                        mode="category" loc={loc} mainCurrency={mainCurrency} mainAmount={r.value} ok={r.ok}
                        onOpen={openExpense} onEdit={openEditExpense} onDelete={openDeleteExpense} readOnly={readOnly} />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <CityGrouping cityGroups={cityGroups} mainCurrency={mainCurrency} conv={conv} loc={loc}
          expensesPlural={expensesPlural} onOpen={openExpense} onEdit={openEditExpense} onDelete={openDeleteExpense} onAdd={openAddExpense} readOnly={readOnly} />
      )}

      {expenseModal !== null && <AddExpenseDialog open={true} onOpenChange={(o) => { if (!o) setExpenseModal(null); }} tripId={tripId} categories={cats} mainCurrency={mainCurrency} cities={cityOptions} existing={expenseModal.existing ?? null} onSaved={refresh} />}
      {deleteExpense && <DeleteExpenseDialog open={true} onOpenChange={(o) => { if (!o) setDeleteExpense(null); }} expense={deleteExpense} onSaved={refresh} />}
      {categoryModal !== null && <AddCategoryDialog open={true} onOpenChange={(o) => { if (!o) setCategoryModal(null); }} tripId={tripId} existing={categoryModal.existing ?? null} onSaved={refresh} />}
      <FxRatesDialog open={fxOpen} onOpenChange={setFxOpen} tripId={tripId} mainCurrency={mainCurrency} currencies={foreignCurrencies} currentOverrides={budget?.fx_overrides} fx={fx} onSaved={refresh} />
    </div>
  );
}

// ─── CityGrouping ─────────────────────────────────────────────────────────────

function CityGrouping({ cityGroups, mainCurrency, conv, loc, expensesPlural, onOpen, onEdit, onDelete, onAdd, readOnly }) {
  const { t } = useI18n();
  // A group is keyed by city identity (`id`); `label` is what to show.
  const [activeCityId, setActiveCityId] = useState(cityGroups[0]?.id || '');
  const cur = cityGroups.find(g => g.id === activeCityId) || cityGroups[0];

  if (cityGroups.length === 0) {
    return (
      <EmptyState icon="pin" title={t('budget.cities_empty')} body={t('budget.cities_empty_desc')}
        action={readOnly ? undefined : <Btn variant="primary" icon="plus" onClick={onAdd}>{t('budget.add_expense')}</Btn>} />
    );
  }
  if (!cur) return null;
  const cityLabel = (g) => g.label || t('budget.no_city');

  return (
    <div className="bgt-drill">
      <div className="card bgt-glist" role="tablist" aria-label={t('budget.group_by_city')}>
        {cityGroups.map(g => {
          const active = g.id === activeCityId;
          return (
            <button key={g.id} type="button" role="tab" aria-selected={active}
              className={`bgt-glist__row row row--g6 ${active ? 'on' : ''}`} onClick={() => setActiveCityId(g.id)}>
              <span className="tile" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                <Icon name="pin" size={17} />
              </span>
              <span className="grow--fit">
                <span className="bgt-glist__n row row--g4"><span className="t trunc">{cityLabel(g)}</span></span>
                <span className="bgt-glist__c">{g.items.length} {expensesPlural(g.items.length)}</span>
              </span>
              <span className="bgt-glist__r"><span className="bgt-glist__v">{money(g.total, mainCurrency)}</span></span>
            </button>
          );
        })}
      </div>
      <div className="card bgt-detail">
        <div className="bgt-detail__h row row--g6">
          <div className="tile tile--xl" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <Icon name="pin" size={22} />
          </div>
          <div className="grow--fit">
            <div className="bgt-detail__n row row--g4">{cityLabel(cur)}</div>
            <div className="bgt-detail__s">{cur.items.length} {expensesPlural(cur.items.length)}</div>
          </div>
          <div className="bgt-detail__amt">
            <div className="v">{money(cur.total, mainCurrency)}</div>
            <div className="l">{t('budget.spent_label')}</div>
          </div>
        </div>
        <div className="bgt-exlist col col--g4">
          {cur.items.map(it => {
            const r = conv(it);
            return (
              <ExpenseRow key={it.id} expense={it} catColor={it.catColor} catIcon={it.catIcon} catName={it.catName} readOnly={readOnly}
                mode="city" loc={loc} mainCurrency={mainCurrency} mainAmount={r.value} ok={r.ok}
                onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />
            );
          })}
        </div>
      </div>
    </div>
  );
}
