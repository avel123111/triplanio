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
import { useNavigate } from 'react-router-dom';
import { invokeFn } from '@/lib/invokeFn';
import { track } from '@/lib/analytics';
import { useAuth } from '@/lib/AuthContext';
import { useProUpsell } from '@/components/common/ProUpsellProvider';
import { classifyError } from '@/lib/errorText';
import { resolveOwnerName } from '@/lib/resolveAuthor';
import { useI18n } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { useIsMobile } from '@/hooks/use-mobile';
import { useFxRates } from '@/lib/fx';
import { toMain as toMainCur } from '@/lib/budget/money';
import { currencySymbol } from '@/lib/budget/currencies';
import { CATEGORY_HEXES, DEFAULT_CATEGORY_HEX } from '@/lib/budget/category-colors';
import { budgetCategoryOptions, categoryDisplayName } from '@/lib/budget/constants';
import { getActiveLocale, fmtMoneyActive } from '@/lib/i18n/format';
import { countTripMembers, roleCanEdit } from '@/lib/members';
import { Icon } from '../design/icons';
import { Badge, Btn, Card, CardHeader, Dialog, Field, EmptyState, Input, InputGroup, Seg, Sheet, Skeleton, Severity, ReadOnlyBanner, Swatch, Textarea, fmtDate, CurrencyCombobox, PageHead, Stat, ListRow, Donut } from '../design/index';
import DateTimeInput from '@/components/common/DateTimeInput';
import { FieldError, IssuesPanel, fieldState, useHybridValidation } from '@/components/common/ValidationUI';

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

// Единая обработка отказа записи бюджета — локальной карты кодов больше нет,
// трактовку даёт общий `classifyError`. Из UI достижим прежде всего PRO_REQUIRED
// (аддон бюджета включали на Pro-трипе, трип мог потерять Pro — редактор всё ещё
// видит экран, но новая запись отбивается 402): он открывает Pro-апселл (модалку
// закрываем — ProUpsell живёт в корне и не должна висеть над диалогом), как в
// SettingsLens. Остальные коды (FORBIDDEN/NOT_FOUND/*_NOT_MANUAL/*_SYSTEM) —
// инлайн-текст `err.*`. `onProRefusal` приходит от родителя, у которого есть
// контекст владельца (isOwner/ownerName/upgrade); нет его → безопасный текст.
function handleBudgetWriteError(t, code, { setErr, close, onProRefusal }) {
  const { kind, text } = classifyError(t, code);
  if (kind === 'upsell' && onProRefusal) { onProRefusal(); close(); return; }
  setErr(text);
}

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

// ─── AddExpenseDialog (create + edit manual expense) ────────────────────────────

// Picker value for an expense that carries only a legacy city string, with no
// visit to point at — distinct from '' ("no city"), which clears it.
const ORPHAN_CITY = '__orphan_city__';

// `cities` — the trip's city_visits (already localized). The picker stores the
// VISIT, not its label: a label frozen at save time is stuck in whatever language
// the UI was in, and the two writers disagreed on that (TRIP-230).
export function AddExpenseDialog({ tripId, categories, mainCurrency, cities = [], existing = null, onSaved, open, onOpenChange, onProRefusal }) {
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
      handleBudgetWriteError(t, code, { setErr, close, onProRefusal });
      return;
    }
    setSaving(false);
    if (!isEdit) {
      track('budget_expense_added', { trip_id: tripId, has_fx: currency !== (mainCurrency || 'EUR') });
    }
    successToast(t, isEdit ? 'expense_updated' : 'expense_added');
    onSaved?.();
    close();
  }

  async function remove() {
    if (!isEdit) return;
    setDeleting(true);
    const { error, code } = await budgetMutate('expense/delete', { tripId, id: existing.id });
    if (error) {
      setDeleting(false);
      handleBudgetWriteError(t, code, { setErr, close, onProRefusal });
      return;
    }
    setDeleting(false);
    successToast(t, 'expense_deleted');
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
        <Btn variant="secondary" onClick={close}>{t('trip.form_cancel')}</Btn>
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
            <CurrencyCombobox value={currency} onChange={setCurrency} className="input-unit input-unit--ccy num" />
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

// ─── FxRatesDialog ──────────────────────────────────────────────────────────────
// Lists every non-main currency present in expenses. Input prefilled with the
// override (or the live rate). On "Применить" writes the override map.

function liveRateToMain(fx, code) {
  const r = fx?.rates?.[code];
  if (!r || !Number.isFinite(Number(r)) || Number(r) <= 0) return null;
  return 1 / Number(r);
}

function FxRatesDialog({ tripId, mainCurrency, currencies, currentOverrides, fx, onSaved, open, onOpenChange, onProRefusal }) {
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
      handleBudgetWriteError(t, code, { setErr, close, onProRefusal });
      return;
    }
    setSaving(false);
    successToast(t, 'rate_updated');
    onSaved?.();
    close();
  }

  return (
    <Dialog title={t('budget.fx_button')} icon="arrowSwap" size="" open={open} onOpenChange={onOpenChange} foot={<>
      <div className="grow" />
      <Btn variant="secondary" onClick={close}>{t('trip.form_cancel')}</Btn>
      <Btn variant="primary" icon="check" onClick={() => v.attemptSubmit(apply)} disabled={saving} aria-disabled={!v.canSubmit}>{saving ? t('member.saving') : t('budget.apply')}</Btn>
    </>}>
      <div className="col col--g4">
      <div className="t-body">
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
            const hint = hasOverride
              ? t('budget.fx_manual', { cur: mainCurrency })
              : live != null
                ? t('budget.fx_auto', { cur: mainCurrency })
                : t('budget.fx_not_found', { cur: mainCurrency });
            return (
              <ListRow key={code} variant="divider" data-vfield={`rate.${code}`}
                lead={<span className={known ? 'tile tile--xl' : 'tile tile--xl tile--danger'}>{currencySymbol(code) || code}</span>}
                title={<>1 {code} = <b>{known ? Number(shown.toFixed(4)) : '?'}</b> {mainCurrency}</>}
                sub={<span className={known ? undefined : 'miss'}>{hint}</span>}
                trail={
                  <input className="input num" {...st(`rate.${code}`)} type="number" step="0.0001" value={values[code] ?? ''}
                    onChange={e => { const val = e.target.value; setValues(s => ({ ...s, [code]: val })); v.markTouched(`rate.${code}`); }} placeholder="0.00" aria-label={`${code} → ${mainCurrency}`} />
                }
              />
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

export function AddCategoryDialog({ tripId, existing, onSaved, open, onOpenChange, onProRefusal }) {
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
      handleBudgetWriteError(t, code, { setErr, close, onProRefusal });
      return;
    }
    setSaving(false);
    successToast(t, existing ? 'category_updated' : 'category_added');
    onSaved?.();
    close();
  }

  return (
    <Dialog title={existing ? t('budget.edit_category') : t('budget.category_new')} icon="grid" size="sm" open={open} onOpenChange={onOpenChange}
      foot={<>
        <div className="grow" />
        <Btn variant="secondary" onClick={close}>{t('trip.form_cancel')}</Btn>
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
            <Swatch key={c} on={color === c} onClick={() => setColor(c)} style={{ background: c }} />
          ))}
        </div>
      </div>
      <div className="col col--g4">
        <div className="field__label">{t('budget.icon_label')}</div>
        <div className="row row--g4 row--wrap" role="group" aria-label={t('budget.icon_label')}>
          {CAT_ICONS_BUDGET.map(ic => (
            <Swatch key={ic} variant="icon" icon={ic} on={icon === ic} tint={color} onClick={() => setIcon(ic)} />
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
// `cityName` is resolved by the caller from the expense's visit (falling back to
// the frozen string), so the row shows the city in the current language.
// Строка списка = канон <ListRow variant="raised">. Правка/удаление больше НЕ
// инлайн-кнопками строки: тап открывает трату (у ручной — диалог с «Изменить» и
// «Удалить», у брони — её событие). `mainAmount` — сконвертированное значение;
// `ok=false` = курса нет. `mode` решает мету: категория показывает город+дату,
// город — чип категории + дату.
/** @param {{ expense: any, catColor?: any, catIcon?: any, mode?: string, catName?: any, cityName?: any, loc?: any, mainCurrency?: any, mainAmount?: any, ok?: boolean, onOpen?: any }} p */
function ExpenseRow({ expense, catColor, catIcon: icon, mode, catName, cityName, loc, mainCurrency, mainAmount, ok, onOpen }) {
  const { t } = useI18n();
  const src = expense.source_kind || 'manual';
  const isManual = src === 'manual';
  const dateStr = expense.spent_on ? fmtDate(expense.spent_on, loc) : '';
  const color = catColor || 'var(--brand)';
  const metaText = [mode !== 'city' ? cityName : null, dateStr].filter(Boolean).join(' · ');
  return (
    <ListRow
      variant="raised"
      onClick={() => onOpen?.(expense)}
      lead={<span className="tile tile--lg" style={{ background: color + '22', color }}><Icon name={icon || SOURCE_ICON[src] || 'wallet'} size={18} /></span>}
      title={expense.title || '-'}
      sub={
        <span className="row row--g4 row--wrap">
          {mode === 'city' && catName && <Badge variant="outline" size="xs">{catName}</Badge>}
          {metaText && <span>{metaText}</span>}
          {isManual
            ? <Badge variant="quiet" size="xs">{t('budget.manual_badge')}</Badge>
            : <Badge variant="brand" size="xs" icon="link">{t('budget.booking_badge')}</Badge>}
        </span>
      }
      trail={
        <span className={ok ? 't-strong' : 't-strong miss'}>
          {ok ? money(mainAmount, mainCurrency)
            : <span title={t('budget.rate_missing')}>{money(expense.original_amount || 0, expense.original_currency || mainCurrency)} ?</span>}
        </span>
      }
    />
  );
}

// ─── BudgetLens ───────────────────────────────────────────────────────────────

export default function BudgetLens({ tripId, trip, budget, budgetCategories = [], budgetExpenses = [], members = [], cityVisits = [], isLoading, isPro, role, queryClient, onOpenSource }) {
  const { t } = useI18n();
  const loc = getActiveLocale();
  const isMobile = useIsMobile();
  // Viewer = строго только чтение (серверная защита — RLS _can_edit_trip, TRIP-124).
  // UI прячет мутации, чтобы прямые записи не падали молчаливым 403.
  const readOnly = !roleCanEdit(role);
  // Pro-отказ записи открывает единый app-level апселл (как SettingsLens): владелец
  // видит апгрейд, участник — «подключает владелец». Контекст владельца есть только
  // здесь (у диалогов его нет), поэтому хендлер даём вниз пропом `onProRefusal`.
  const { user } = useAuth();
  const nav = useNavigate();
  const { openProUpsell } = useProUpsell();
  const isOwner = !!user?.id && user.id === trip?.created_by;
  const ownerName = resolveOwnerName({ trip, members, selfUser: user, deletedLabel: t('common.deleted_user') });
  const onProRefusal = () => openProUpsell({
    mode: isOwner ? 'upgrade' : 'info',
    feature: t('budget.title'),
    ownerName,
    onUpgrade: () => nav(`/pro?tripId=${tripId}`),
  });
  const [grouping, setGrouping] = useState('category');
  const [activeCatId, setActiveCatId] = useState(null);
  const [hoveredSeg, setHoveredSeg] = useState(null);
  const [expenseModal, setExpenseModal] = useState(null); // null | { existing?: row }
  const [categoryModal, setCategoryModal] = useState(null); // null | { existing?: row }
  const [fxOpen, setFxOpen] = useState(false);
  const [catSheet, setCatSheet] = useState(false); // мобиль: деталь категории в боттом-шите (#4)

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
      <div className="col col--g6">
        {[1, 2, 3].map(i => <Skeleton key={i} h={80} r="var(--r-sm)" />)}
      </div>
    );
  }

  const noExpenses = budgetExpenses.length === 0;

  return (
    <div className="col col--g7 ov-anim">
      {readOnly && (
        <ReadOnlyBanner>{t('budget.readonly_banner_desc')}</ReadOnlyBanner>
      )}
      {/* ░ HEADER: screen title + primary actions relocated from the removed
          per-screen bar. On phones the buttons hide (see BudgetLens.css): "add
          expense" becomes the FAB below and "rates" is the FX stat card. ░ */}
      {/* На мобиле действия шапки скрыты (как было): «трата» живёт в «+» нижней
          навигации, «курсы» — в стат-плитке FX. */}
      <PageHead
        title={t('trip.sidebar_budget')}
        actions={!readOnly && !isMobile && (
          <>
            <Btn variant="secondary" icon="arrowSwap" onClick={openFxDialog}>{t('budget.fx_button')}</Btn>
            <Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.manual_expense')}</Btn>
          </>
        )}
      />
      {/* ░ SUMMARY BAND ░ */}
      <div className="grid grid--split grid--g7">
        <Card>
          <CardHeader title={t('budget.by_category_title')} />
          {/* мобиль: донат сверху, легенда под ним (колонка) — иначе легенда режется */}
          <div className={isMobile ? 'col col--g6' : 'row row--g8 row--wrap'}>
            <Donut
              segments={donutSegments}
              total={totalSpent}
              hoveredId={hoveredSeg}
              onHover={setHoveredSeg}
              center={fmtMoneyActive(totalSpent, mainCurrency, { compact: true })}
              label={t('budget.donut_total')}
            />
            <div className="col col--g1 grow--fit">
              {donutSegments.length === 0 && (
                <div className="muted t-meta">{t('budget.no_expenses')}</div>
              )}
              {donutSegments.map(s => {
                const pct = totalSpent > 0 ? Math.round((s.value / totalSpent) * 100) : 0;
                return (
                  <ListRow key={s.id} variant="compact"
                    onMouseEnter={() => setHoveredSeg(s.id)} onMouseLeave={() => setHoveredSeg(null)}
                    lead={<span style={{ width: 10, height: 10, borderRadius: 4, background: s.color, flexShrink: 0 }} />} /* inline-style-exempt: цветная точка легенды — динамический цвет категории из данных */
                    title={s.name}
                    trail={<><span className="t-strong">{money(s.value, mainCurrency)}</span><span className="muted">{pct}%</span></>}
                  />
                );
              })}
            </div>
          </div>
        </Card>

        <div className="col col--g6">
          <Stat tone="brand" icon="wallet" label={t('budget.total_spent')} value={money(totalSpent, mainCurrency)}
            sub={noExpenses ? t('trip.budget_empty')
              : <>{budgetExpenses.length} {expensesPlural(budgetExpenses.length)}{missingTotal > 0 && <> · {t('budget.no_rate_count', { n: missingTotal })}</>}</>} />

          <Stat tone="activity" icon="user" label={t('budget.per_person_label')}
            value={money(memberCount > 0 ? totalSpent / memberCount : totalSpent, mainCurrency)}
            sub={<><b>{memberCount} {memberCount === 1 ? t('trip.members_count_one') : t('trip.members_count_few')}</b> · {t('budget.split_evenly')}</>} />

          <Stat tone="transfer" icon="arrowSwap" label={t('budget.fx_button')} onClick={readOnly ? undefined : openFxDialog}
            sub={foreignCurrencies.length === 0 ? t('budget.fx_empty') : (
              <span className="col col--g1">
                <span className="row row--wrap row--g6">
                  {foreignCurrencies.map(cur => {
                    const ov = overrides[cur];
                    const rate = ov != null ? Number(ov) : liveRateToMain(fx, cur);
                    return rate != null
                      ? <span key={cur}>1 {cur} ≈ {Number(rate.toFixed(4))} {mainCurrency}</span>
                      : <span key={cur} className="miss">1 {cur} — {t('budget.fx_rate_unset')}</span>;
                  })}
                </span>
                {!readOnly && <span>{t('budget.fx_tap_edit')}</span>}
              </span>
            )} />
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
        <Card tone="brand" radius="md" className="empty-note row row--g7 row--wrap" style={{ marginTop: missingCurrencies.length > 0 ? 16 : 4 }}>
          <span className="en-ic tile tile--lg"><Icon name="wallet" /></span>
          <span className="en-tx grow--fit">
            <b>{t('budget.no_expenses')}</b>
            <span>{t('budget.no_expenses_desc')}</span>
          </span>
          {!readOnly && <Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.first_expense')}</Btn>}
        </Card>
      )}

      {/* ░ CONTROLS ░ */}
      <div className="row row--g6 row--wrap">
        <Seg
          ariaLabel={t('budget.group_by_category')}
          value={grouping}
          onChange={setGrouping}
          variant={isMobile ? 'fill' : 'auto'}
          className={isMobile ? 'grow' : ''}
          options={[
            { value: 'category', label: <><Icon name="grid" size={14} />{t('budget.group_by_category')}</> },
            { value: 'city', label: <><Icon name="pin" size={14} />{t('budget.group_by_city')}</> },
          ]}
        />
        {/* Распорка нужна только десктопу — толкает кнопку «Категория» вправо. На
            мобиле кнопки нет, а второй `grow` делил бы ширину с сегментом пополам. */}
        {!isMobile && <div className="grow" />}
        {grouping === 'category' && !readOnly && !isMobile && (
          <Btn variant="soft" icon="plus" onClick={openAddCategory}>{t('budget.field_category')}</Btn>
        )}
      </div>

      {/* ░ DRILLDOWN ░ (десктоп: список + деталь двумя колонками; мобиль: только
          список, деталь открывается боттом-шитом по тапу — #4) */}
      {grouping === 'category' ? (() => {
        const detailInner = activeCat && (
          <div className="col col--g6">
            <div className="row row--g6">
              <span className="tile tile--xl" style={{ background: activeCat.color + '22', color: activeCat.color }}><Icon name={catIcon(activeCat)} size={22} /></span>
              <div className="grow--fit">
                <div className="t-title row row--g4">{activeCat.displayName}{activeCat.kind === 'custom' && <Badge variant="quiet" size="xs">{t('budget.custom_short')}</Badge>}</div>
                <div className="t-meta muted">{activeCat.itemCount} {expensesPlural(activeCat.itemCount)}</div>
              </div>
              <div className="col col--g1">
                <div className="t-title">{money(activeCat.spent, mainCurrency)}</div>
                <div className="t-meta muted">{t('budget.spent_label')}</div>
              </div>
              {activeCat.kind === 'custom' && !readOnly && (
                <Btn variant="secondary" size="sm" icon="edit" ariaLabel={t('visit.change')} onClick={() => openEditCategory(activeCat)} />
              )}
            </div>
            {activeCat.items.length === 0 ? (
              <EmptyState icon={catIcon(activeCat)} title={t('budget.cat_empty', { name: activeCat.displayName })}
                action={readOnly ? undefined : <Btn variant="primary" icon="plus" onClick={openAddExpense}>{t('budget.add_first')}</Btn>} />
            ) : (
              <div className="col col--g4">
                {activeCat.items.map(exp => {
                  const r = conv(exp);
                  return (
                    <ExpenseRow key={exp.id} expense={exp} catColor={activeCat.color} catIcon={catIcon(activeCat)}
                      cityName={cityLabelOf(exp)}
                      mode="category" loc={loc} mainCurrency={mainCurrency} mainAmount={r.value} ok={r.ok}
                      onOpen={openExpense} />
                  );
                })}
              </div>
            )}
          </div>
        );
        return (
          <>
            <div className={isMobile ? '' : 'grid grid--split grid--g7'}>
              <Card>
                <div className="col col--g2">
                  {cats.map(c => {
                    const active = activeCat?.id === c.id;
                    const empty = c.itemCount === 0;
                    return (
                      <ListRow key={c.id} variant="select" selected={active && !isMobile}
                        role="tab" aria-selected={active} onClick={() => { setActiveCatId(c.id); if (isMobile) setCatSheet(true); }}
                        lead={<span className="tile" style={{ background: c.color + '22', color: c.color }}><Icon name={catIcon(c)} size={17} /></span>}
                        title={<span className="row row--g4"><span className="trunc">{c.displayName}</span>{c.kind === 'custom' && <Badge variant="quiet" size="xs">{t('budget.custom_short')}</Badge>}</span>}
                        sub={<>{empty ? t('budget.empty_word') : `${c.itemCount} ${expensesPlural(c.itemCount)}`}{c.missingCount > 0 && <> · <span className="miss">{t('budget.no_rate_count', { n: c.missingCount })}</span></>}</>}
                        trail={<span className={empty ? 't-strong muted' : 't-strong'}>{money(c.spent, mainCurrency)}</span>}
                      />
                    );
                  })}
                  {!readOnly && (
                    <Btn variant="dashed" block icon="plus" onClick={openAddCategory}>
                      {t('budget.add_category')}
                    </Btn>
                  )}
                </div>
              </Card>
              {!isMobile && activeCat && <Card>{detailInner}</Card>}
            </div>
            {isMobile && (
              <Sheet open={catSheet} onOpenChange={setCatSheet} title={activeCat?.displayName}>
                {detailInner}
              </Sheet>
            )}
          </>
        );
      })() : (
        <CityGrouping cityGroups={cityGroups} mainCurrency={mainCurrency} conv={conv} loc={loc} isMobile={isMobile}
          expensesPlural={expensesPlural} onOpen={openExpense} onAdd={openAddExpense} readOnly={readOnly} />
      )}

      {expenseModal !== null && <AddExpenseDialog open={true} onOpenChange={(o) => { if (!o) setExpenseModal(null); }} tripId={tripId} categories={cats} mainCurrency={mainCurrency} cities={cityOptions} existing={expenseModal.existing ?? null} onSaved={refresh} onProRefusal={onProRefusal} />}
      {categoryModal !== null && <AddCategoryDialog open={true} onOpenChange={(o) => { if (!o) setCategoryModal(null); }} tripId={tripId} existing={categoryModal.existing ?? null} onSaved={refresh} onProRefusal={onProRefusal} />}
      <FxRatesDialog open={fxOpen} onOpenChange={setFxOpen} tripId={tripId} mainCurrency={mainCurrency} currencies={foreignCurrencies} currentOverrides={budget?.fx_overrides} fx={fx} onSaved={refresh} onProRefusal={onProRefusal} />
    </div>
  );
}

// ─── CityGrouping ─────────────────────────────────────────────────────────────

function CityGrouping({ cityGroups, mainCurrency, conv, loc, expensesPlural, onOpen, onAdd, readOnly, isMobile }) {
  const { t } = useI18n();
  // A group is keyed by city identity (`id`); `label` is what to show.
  const [activeCityId, setActiveCityId] = useState(cityGroups[0]?.id || '');
  const [citySheet, setCitySheet] = useState(false); // мобиль: траты города в боттом-шите (#4)
  const cur = cityGroups.find(g => g.id === activeCityId) || cityGroups[0];

  if (cityGroups.length === 0) {
    return (
      <EmptyState icon="pin" title={t('budget.cities_empty')} body={t('budget.cities_empty_desc')}
        action={readOnly ? undefined : <Btn variant="primary" icon="plus" onClick={onAdd}>{t('budget.add_expense')}</Btn>} />
    );
  }
  if (!cur) return null;
  const cityLabel = (g) => g.label || t('budget.no_city');

  const detailInner = (
    <div className="col col--g6">
      <div className="row row--g6">
        <span className="tile tile--xl" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="pin" size={22} /></span>
        <div className="grow--fit">
          <div className="t-title">{cityLabel(cur)}</div>
          <div className="t-meta muted">{cur.items.length} {expensesPlural(cur.items.length)}</div>
        </div>
        <div className="col col--g1">
          <div className="t-title">{money(cur.total, mainCurrency)}</div>
          <div className="t-meta muted">{t('budget.spent_label')}</div>
        </div>
      </div>
      <div className="col col--g4">
        {cur.items.map(it => {
          const r = conv(it);
          return (
            <ExpenseRow key={it.id} expense={it} catColor={it.catColor} catIcon={it.catIcon} catName={it.catName}
              mode="city" loc={loc} mainCurrency={mainCurrency} mainAmount={r.value} ok={r.ok}
              onOpen={onOpen} />
          );
        })}
      </div>
    </div>
  );
  return (
    <>
      <div className={isMobile ? '' : 'grid grid--split grid--g7'}>
        <Card>
          <div className="col col--g2">
            {cityGroups.map(g => {
              const active = g.id === activeCityId;
              return (
                <ListRow key={g.id} variant="select" selected={active && !isMobile}
                  role="tab" aria-selected={active} onClick={() => { setActiveCityId(g.id); if (isMobile) setCitySheet(true); }}
                  lead={<span className="tile" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}><Icon name="pin" size={17} /></span>}
                  title={<span className="trunc">{cityLabel(g)}</span>}
                  sub={`${g.items.length} ${expensesPlural(g.items.length)}`}
                  trail={<span className="t-strong">{money(g.total, mainCurrency)}</span>}
                />
              );
            })}
          </div>
        </Card>
        {!isMobile && <Card>{detailInner}</Card>}
      </div>
      {isMobile && (
        <Sheet open={citySheet} onOpenChange={setCitySheet} title={cityLabel(cur)}>
          {detailInner}
        </Sheet>
      )}
    </>
  );
}
