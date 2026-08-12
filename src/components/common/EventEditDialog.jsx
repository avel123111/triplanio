/**
 * EventEditDialog - unified create/edit form for ALL kinds: hotel / transfer /
 * activity, and every service subtype (car_rental / esim / insurance). It is
 * the single edit engine — the legacy per-kind dialogs
 * (Hotel/Transfer/Activity/CarRental/Esim/Insurance) are gone.
 *
 * One shared chrome — the `.lp-*` canon (tinted header + body + footer), themed
 * per kind/subtype via `meta` (TYPE_META / SERVICE_META →
 * --hl/--hl-soft/--hl-ink). TRIP-333 §4: the chrome is literally the same
 * in both shells; before that the dialog branch drew its own `.ev-dlg-*` family.
 * Each kind renders its own field group; service dispatches on form.service_kind.
 *
 * Shells differ only by CONTAINER: `variant="dialog"` = Radix Dialog overlay
 * (app-wide modal, auto bottom-sheet ≤640px, container carries `.ev-dlg`).
 * `variant="panel"` = same content inline for the trip-editor left panel
 * (hotel/transfer create/edit live here).
 *
 * Visual reference: EVENTS_SERVICES_REDESIGN_LUMO design system.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DialogRoot as Dialog, DialogContent, DialogTitle, CurrencyCombobox, AiField, AiBadge, Toggle, Btn, Card, IconBtn, Seg, Severity, useToast } from '@/design/index';
import {
  Trash2, ExternalLink, ChevronDown, ArrowRight, Repeat,
  Plane, Car as CarIcon, Moon, ShieldCheck,
  BedDouble, Ticket,
} from 'lucide-react';
import { CardSim } from '@/design/icons';
import { EDITABLE_TRANSPORT_TYPES, transferKind } from '@/lib/transport';
import { DateTime } from 'luxon';

// ── Design-system form primitives ──────────────────────────────────────────
// Thin shims that render the app's design-system markup (.input/.field__label/
// .textarea) while accepting the same props the field groups already pass, so
// the form JSX is ported to the design system without touching its logic.
// Обязательность полей ЭТОЙ формы - ответ валидатора, розданный по дереву
// контекстом (TRIP-333). Контекстом, а не пропом: подписи живут в четырёх
// вложенных под-формах, и проп пришлось бы протаскивать через каждую, то есть
// в четырёх местах помнить про него - ровно так звёздочки и разъезжаются.
const RequiredFieldsCtx = React.createContext(null);
const useFieldRequired = (field) => {
  const ask = React.useContext(RequiredFieldsCtx);
  return !!(field && ask && ask(field));
};

// `field` - токен валидации (тот же, что у `data-vfield` и `fieldState`).
// Звёздочку рисует CSS по `[data-required]`, поэтому она не может разъехаться с
// остальным приложением ни знаком, ни цветом: до этого она была вшита прямо в
// строку перевода и потому была ЧЁРНОЙ.
function Label({ children, className = '', field }) {
  const required = useFieldRequired(field);
  // Разметка ровно как у `<Field>`: звёздочка на спане с текстом, а не на самом
  // `<label>` (тот флексит со своим `gap`, и отбивка знака разъехалась бы).
  // `display` инлайном тоже не задаём - канон `.field__label` уже флекс.
  return (
    <label className={`field__label ${className}`} style={{ marginBottom: 5 }}>
      <span data-required={required || undefined}>{children}</span>
    </label>
  );
}
function Input({ className = '', ...p }) {
  return <input className={`input ${className}`} {...p} />;
}
function Textarea({ className = '', ...p }) {
  return <textarea className={`textarea ${className}`} {...p} />;
}

// A boolean row: switch + title/hint, optionally revealing a dependent field.
// Both booleans in this dialog (hotel "free cancellation", car-rental "return
// elsewhere") are this exact shape, so they share one shell and stay identical.
// The title/hint toggle on click — `.eed-fclabel` has always advertised
// `cursor: pointer`, and the car-rental row was a real <label> before. `children`
// sits OUTSIDE that hit area so a nested input never flips the switch.
function SwitchRow({ on, onChange, title, hint, children }) {
  const flip = () => onChange(!on);
  return (
    <Card radius="md" className="eed-fcbox">
      <div className="row row--a-start row--g4 eed-fclabel">
        <Toggle on={on} onChange={onChange} label={title} />
        <div className="eed-fcbody">
          <div className="eed-fctitle" onClick={flip}>{title}</div>
          {hint && <div className="eed-fchint" onClick={flip}>{hint}</div>}
          {children}
        </div>
      </div>
    </Card>
  );
}

// City autocomplete for layover (waypoint) cities — resolves a full city object
// (coords + IANA timezone) so the saved waypoint city_visit has real geo data.
// Thin facade over the shared <Autocomplete> engine (identical field/dropdown/
// scroll/hover as every other city & address picker).
function CityPicker({ value, onPick, placeholder, ...rest }) {
  const { t } = useI18nFormat();
  const [q, setQ] = useState(value?.city_name || '');
  useEffect(() => { setQ(value?.city_name || ''); }, [value?.city_name]);
  return (
    <Autocomplete
      inputProps={rest}
      inputValue={q}
      onInputChange={(val) => { setQ(val); if (value) onPick(null); }}
      search={(query, lang) => searchCities(query, lang)}
      getKey={(c) => c.geonameid ?? c.external_city_id ?? c.city_name}
      onPick={(c) => {
        setQ(c.city_name);
        onPick({ city_name: c.city_name, city_name_en: c.city_name_en, geonameid: c.geonameid ?? null, name_i18n: c.name_i18n || null, country: c.country, country_code: c.country_code, latitude: c.latitude, longitude: c.longitude, timezone: tzFromCoords(c.latitude, c.longitude), external_city_id: c.external_city_id });
      }}
      renderRow={cityOptionRow}
      placeholder={placeholder || t('event.layover_city_ph')}
      icon="pin"
    />
  );
}

let __segUid = 1;
function makeSegment(defCur = 'EUR') {
  return {
    id: 'seg-' + (__segUid++), transport_type: 'plane',
    from_address: '', to_address: '', startLocal: '', endLocal: '',
    // Endpoint coords are set only when an AI-parsed address resolves to a
    // house-level match (geocodeAddress); otherwise stay null (address as text,
    // no map point) — same rule as the hotel / single-leg transfer.
    from_latitude: null, from_longitude: null, to_latitude: null, to_longitude: null,
    carrier: '', flight_number: '', booking_reference: '',
    price: '', currency: defCur, toCity: null,
  };
}

import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { searchCities, resolveCities, geocodeAddress } from '@/lib/geo';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localToUtc, utcToLocalInput } from '@/lib/time';
import { validateEntity, transferAiCityAdvisories, issuesToShow, isFieldRequired } from '@/lib/validation';
import { FieldError, IssuesPanel, fieldState } from '@/components/common/ValidationUI';
import { faviconUrl, hostnameFromUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import { getEntityDocuments, getDetailsDocuments } from '@/lib/documents';
import { collectDocPaths, removeTripFiles, removeOrphanedFiles } from '@/lib/storageCleanup';
import { aiField } from '@/lib/ai-values';
import { ENTITY_TABLE_BY_KIND, deleteSourceEntity } from '@/lib/trip-entities';
import { track } from '@/lib/analytics';
import { invalidateTripData, optimisticContentUpdate, TRIP_CONTENT_KEY, writeRows } from '@/lib/trip-data';
import { tzFromCoords } from '@/lib/timezone';
import './EventEditDialog.css';

// Codes that BLOCK the save (kept at 'error'); all other verdicts are advisory
// (downgraded to 'warn' below). Only the logical date-ORDER family qualifies —
// a booking whose end precedes its start is nonsense to persist.
const BLOCKING_CODES = new Set(['HOTEL_ORDER', 'ACT_ORDER', 'TR_ORDER', 'SVC_ORDER', 'SEG_ORDER', 'SEG_BACKSTEP']);

// A transfer is "overnight" (day_change) IFF its arrival lands on a later calendar
// day than its departure — nothing else. day_change is therefore fully DERIVED from
// the dates, never an independent user flag: it is the single bit the server's
// recompute_trip reads to add a +1 gap to the arrival city, so storing anything
// other than (arrivalDay > departureDay) would desync the city layout from the
// actual travel dates. Compares the wall-clock date parts (the "YYYY-MM-DD" slice
// of the local datetime), matching validation.calDay and the server's day math.
const isOvernightLocal = (startLocal, endLocal) => {
  const sd = (startLocal || '').slice(0, 10), ed = (endLocal || '').slice(0, 10);
  return !!(sd && ed && ed > sd);
};

// Assigns an AI-parsed value onto the form draft and records the key, so the
// field gets the violet "AI filled" tint. `aiField` (lib/ai-values.js) is the
// one gate for "did the model actually give us this?" — every merge path below
// goes through it, keyed by the form field name.
const makeAiSetter = (upd, filled) => (k, v) => {
  const clean = aiField(k, v);
  if (clean == null) return;
  upd[k] = clean;
  filled.add(k);
};

// Shared "Booking URL" field: input with a favicon overlay (derived from the
// URL's domain — works for any site) + a pill (favicon + host) and an "Open"
// link. Used by hotel / transfer / activity-service branches (one source,
// no copy-paste).
function BookingUrlField({ value, onChange, aiActive, t }) {
  const logo = faviconUrl(value);
  const label = hostnameFromUrl(value);
  return (
    <div>
      <Label>{t('event.booking_url')}</Label>
      <AiField active={aiActive}>
        <div className="eed-inwrap">
          {logo && <img src={logo} alt="" className="eed-inlogo" />}
          <Input
            type="url"
            inputMode="url"
            value={value}
            onChange={onChange}
            placeholder="https://..."
            className={logo ? 'eed-in--logo' : ''}
          />
        </div>
      </AiField>
      {value && (
        <div className="row row--g4 eed-bkmeta">
          <span className="row row--inline row--g3 eed-bkpill">
            {logo && <img src={logo} alt="" className="eed-bkpill__logo" />}
            {label}
          </span>
          <a href={normalizeExternalUrl(value)} target="_blank" rel="noreferrer" className="row row--inline row--g2 eed-bkopen">
            <ExternalLink size={12} />{t('common.open')}
          </a>
        </div>
      )}
    </div>
  );
}
import { useI18nFormat, useI18n } from '@/lib/i18n/I18nContext';
import { eventHeader } from '@/components/common/EventViewBody';

import DateTimeInput from '@/components/common/DateTimeInput';
import TimezoneHint from '@/components/common/TimezoneHint';
import DocumentsField from '@/components/common/DocumentsField';
import Accordion from '@/components/common/Accordion';
import AddressAutocomplete from '@/components/common/AddressAutocomplete';
import Autocomplete from '@/components/common/Autocomplete';
import cityOptionRow from '@/components/common/cityOptionRow';
import EventAiBlock from '@/components/common/EventAiBlock';
import { useProUpsell } from '@/components/common/ProUpsellProvider';

// ─────────────────────────────────────────────────────────────────────────────
//  Type metadata - colours, icons, copy
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_META = {
  hotel: {
    color: 'var(--ev-hotel)', soft: 'var(--ev-hotel-soft)', ink: 'var(--ev-hotel-ink)',
    Icon: BedDouble, labelKey: 'event.type_hotel',
  },
  transfer: {
    color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)',
    Icon: Plane, labelKey: 'event.type_transfer',
  },
  activity: {
    color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)',
    Icon: Ticket, labelKey: 'event.type_activity',
  },
  service: {
    color: 'var(--ev-car)', soft: 'var(--ev-car-soft)', ink: 'var(--ev-car-ink)',
    Icon: CarIcon, labelKey: 'event.type_car',
    titleNewKey: 'event.title_new_car', titleEditKey: 'event.title_edit_car',
  },
};

// Per-subtype header theming for `service` rows. The unified EventEditDialog
// keys its header (icon / colour / title) off currentKind, but for services the
// concrete subtype (esim / insurance / car_rental) decides the look. Without
// this, esim/insurance render with the car-rental header (icon + "Аренда авто").
const SERVICE_META = {
  esim: {
    color: 'var(--ev-esim)', soft: 'var(--ev-esim-soft)', ink: 'var(--ev-esim-ink)',
    Icon: CardSim, labelKey: 'service.kind.esim',
    titleNewKey: 'service.esim_new', titleEditKey: 'service.esim_edit',
  },
  insurance: {
    color: 'var(--ev-insurance)', soft: 'var(--ev-insurance-soft)', ink: 'var(--ev-insurance-ink)',
    Icon: ShieldCheck, labelKey: 'service.kind.insurance',
    titleNewKey: 'service.insurance_new', titleEditKey: 'service.insurance_edit',
  },
  car_rental: TYPE_META.service,
};

// Editor transport picker — derived from the canonical transfer-kind source so
// icon + label stay in lockstep with every render map (single source of truth).
const TRANSPORT_KINDS = EDITABLE_TRANSPORT_TYPES.map((id) => ({ id, ...transferKind(id) }));

// ─────────────────────────────────────────────────────────────────────────────
//  Empty form factories - one per kind. Edit mode hydrates from the entity.
// ─────────────────────────────────────────────────────────────────────────────

function emptyHotelForm(defCur = 'EUR') {
  return {
    name: '', address: '',
    latitude: null, longitude: null,
    checkInLocal: '', checkOutLocal: '',
    booking_reference: '', payment_status: '', price: '', currency: defCur,
    free_cancellation: false, free_cancellation_until_local: '',
    phone: '', email: '',
    booking_url: '',
    documents: [], notes: '',
  };
}

function emptyTransferForm(defCur = 'EUR') {
  return {
    transport_type: 'plane',
    startLocal: '', endLocal: '',
    from_address: '', from_latitude: null, from_longitude: null,
    to_address: '',   to_latitude: null,   to_longitude: null,
    carrier: '',
    flight_number: '',
    booking_reference: '',
    booking_url: '',
    price: '', currency: defCur,
    documents: [], notes: '',
    // Layover (multi-leg) support - create mode only. When hasLayovers is on,
    // `segments` is the source of truth and the flat fields above are ignored.
    hasLayovers: false,
    segments: [],
  };
}

function emptyActivityForm(defCur = 'EUR') {
  return {
    title: '',
    startLocal: '', endLocal: '',
    location_address: '',
    location_latitude: null,
    location_longitude: null,
    price: '', currency: defCur,
    documents: [], notes: '',
  };
}

function emptyServiceForm(defCur = 'EUR', svcKind = 'car_rental') {
  const base = { service_kind: svcKind, name: '', price: '', currency: defCur, documents: [], notes: '' };
  if (svcKind === 'esim') return base;
  if (svcKind === 'insurance') return { ...base, policy_number: '', date_start: '', date_finish: '' };
  // car_rental
  return {
    ...base,
    service_kind: 'car_rental',
    pickup_at_local: '',
    pickup_address: '',
    pickup_latitude: null, pickup_longitude: null,
    pickup_timezone: '',
    dropoff_at_local: '',
    dropoff_address: '',
    dropoff_latitude: null, dropoff_longitude: null,
    dropoff_timezone: '',
    return_different_location: false,
    booking_reference: '',
    booking_url: '',
  };
}

function hotelToForm(h, tz) {
  if (!h) return emptyHotelForm();
  return {
    name: h.name || '', address: h.address || '',
    latitude: h.latitude ?? null, longitude: h.longitude ?? null,
    checkInLocal: utcToLocalInput(h.check_in_datetime, tz) || '',
    checkOutLocal: utcToLocalInput(h.check_out_datetime, tz) || '',
    booking_reference: h.booking_reference || '',
    payment_status: h.payment_status || '',
    price: h.price ?? '', currency: h.currency || 'EUR',
    free_cancellation: !!h.free_cancellation,
    free_cancellation_until_local: utcToLocalInput(h.free_cancellation_until, tz) || '',
    phone: h.phone || '', email: h.email || '',
    booking_url: h.booking_url || '',
    documents: getEntityDocuments(h), notes: h.notes || '',
  };
}

function transferToForm(tr, startTz, endTz) {
  if (!tr) return emptyTransferForm();
  return {
    ...emptyTransferForm(),
    transport_type: tr.transport_type || 'plane',
    startLocal: utcToLocalInput(tr.start_datetime, startTz) || '',
    endLocal: utcToLocalInput(tr.end_datetime, endTz) || '',
    from_address: tr.from_address || '',
    from_latitude: tr.from_latitude ?? null,
    from_longitude: tr.from_longitude ?? null,
    to_address: tr.to_address || '',
    to_latitude: tr.to_latitude ?? null,
    to_longitude: tr.to_longitude ?? null,
    carrier: tr.carrier || '',
    flight_number: tr.flight_number || '',
    booking_reference: tr.booking_reference || '',
    booking_url: tr.booking_url || '',
    price: tr.price ?? '', currency: tr.currency || 'EUR',
    documents: getEntityDocuments(tr), notes: tr.notes || '',
  };
}

function activityToForm(a, tz) {
  if (!a) return emptyActivityForm();
  return {
    title: a.title || '',
    startLocal: utcToLocalInput(a.start_datetime, tz) || '',
    endLocal: utcToLocalInput(a.end_datetime, tz) || '',
    location_address: a.location_address || '',
    location_latitude: a.location_latitude ?? null,
    location_longitude: a.location_longitude ?? null,
    price: a.price ?? '', currency: a.currency || 'EUR',
    documents: getEntityDocuments(a), notes: a.notes || '',
  };
}

function serviceToForm(svc) {
  if (!svc) return emptyServiceForm();
  const d = svc.details || {};
  const svcKind = svc.kind || 'car_rental';
  const base = {
    service_kind: svcKind,
    name: svc.name || '',
    price: svc.price ?? d.price ?? '',
    currency: svc.currency || d.currency || 'EUR',
    documents: getDetailsDocuments(d),
    notes: d.notes || '',
  };
  if (svcKind === 'esim') return base;
  if (svcKind === 'insurance') {
    return {
      ...base,
      policy_number: d.policy_number || '',
      date_start: d.date_start || '',
      date_finish: d.date_finish || '',
    };
  }
  // car_rental
  const hasDifferentDropoff = !!(
    (d.dropoff_address && d.dropoff_address !== d.pickup_address) ||
    (d.dropoff_timezone && d.dropoff_timezone !== d.pickup_timezone)
  );
  return {
    ...base,
    service_kind: 'car_rental',
    pickup_at_local: d.pickup_at_local || '',
    pickup_address: d.pickup_address || '',
    pickup_latitude: d.pickup_latitude ?? null,
    pickup_longitude: d.pickup_longitude ?? null,
    pickup_timezone: d.pickup_timezone || '',
    dropoff_at_local: d.dropoff_at_local || '',
    dropoff_address: d.dropoff_address || '',
    dropoff_latitude: d.dropoff_latitude ?? null,
    dropoff_longitude: d.dropoff_longitude ?? null,
    dropoff_timezone: d.dropoff_timezone || '',
    return_different_location: hasDifferentDropoff,
    booking_reference: d.booking_reference || '',
    booking_url: d.booking_url || '',
  };
}

// New-mode date defaults - same logic as the legacy dialogs.
function defaultsForNewHotel(visit, tz, defCur = 'EUR') {
  if (!visit?.start_date || !visit?.end_date) return emptyHotelForm(defCur);
  const vs = DateTime.fromISO(visit.start_date, { zone: tz });
  const ve = DateTime.fromISO(visit.end_date, { zone: tz });
  const ci = vs.set({ hour: 15, minute: 0 });
  let co = ve.set({ hour: 11, minute: 0 });
  if (co <= ci) co = ci.plus({ hours: 1 });
  return {
    ...emptyHotelForm(defCur),
    checkInLocal: ci.toFormat("yyyy-LL-dd'T'HH:mm"),
    checkOutLocal: co.toFormat("yyyy-LL-dd'T'HH:mm"),
  };
}

function defaultsForNewTransfer(fromVisit, toVisit, startTz, endTz, defCur = 'EUR') {
  const baseStart = fromVisit?.end_date || toVisit?.start_date;
  const baseEnd = toVisit?.start_date || fromVisit?.end_date;
  const startDt = baseStart
    ? DateTime.fromISO(baseStart, { zone: startTz }).set({ hour: 12, minute: 0 })
    : null;
  const endDt = baseEnd
    ? DateTime.fromISO(baseEnd, { zone: endTz }).set({ hour: 15, minute: 0 })
    : null;
  return {
    ...emptyTransferForm(defCur),
    startLocal: startDt ? startDt.toFormat("yyyy-LL-dd'T'HH:mm") : '',
    endLocal: endDt ? endDt.toFormat("yyyy-LL-dd'T'HH:mm") : '',
  };
}

function defaultsForNewActivity(visit, tz, defaultStart, defCur = 'EUR') {
  if (!visit?.start_date) return emptyActivityForm(defCur);
  const visitStart = DateTime.fromISO(visit.start_date, { zone: tz });
  const proposed = defaultStart
    ? DateTime.fromISO(defaultStart, { zone: 'utc' }).setZone(tz)
    : visitStart.set({ hour: 10, minute: 0 });
  const start = proposed < visitStart ? visitStart : proposed;
  const end = start.plus({ hours: 2 });
  return {
    ...emptyActivityForm(defCur),
    startLocal: start.toFormat("yyyy-LL-dd'T'HH:mm"),
    endLocal: end.toFormat("yyyy-LL-dd'T'HH:mm"),
  };
}

function buildInitialForm(kind, entity, ctx) {
  const { visit, fromVisit, toVisit, defaultStart, defaultCurrency, initialServiceKind } = ctx;
  const defCur = defaultCurrency || 'EUR';
  const tz = visit?.timezone || 'UTC';
  const startTz = fromVisit?.timezone || 'UTC';
  const endTz = toVisit?.timezone || 'UTC';
  if (entity) {
    if (kind === 'hotel') return hotelToForm(entity, tz);
    if (kind === 'transfer') return transferToForm(entity, startTz, endTz);
    if (kind === 'activity') return activityToForm(entity, tz);
    if (kind === 'service') return serviceToForm(entity);
  }
  if (kind === 'hotel') return defaultsForNewHotel(visit, tz, defCur);
  if (kind === 'transfer') return defaultsForNewTransfer(fromVisit, toVisit, startTz, endTz, defCur);
  if (kind === 'activity') return defaultsForNewActivity(visit, tz, defaultStart, defCur);
  return emptyServiceForm(defCur, initialServiceKind || 'car_rental');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function EventEditDialog({
  open,
  onOpenChange,
  kind: initialKind,
  tripId: tripIdProp,
  visit,
  fromVisit,
  toVisit,
  entity = null,
  defaultStart = null,
  defaultCurrency = 'EUR',
  // For service create mode: 'car_rental' | 'esim' | 'insurance'. Ignored in edit mode (subtype comes from entity).
  initialServiceKind = 'car_rental',
  // Shell variant. 'dialog' (default) = the shadcn Dialog overlay used app-wide.
  // 'panel' = render the SAME content inline (no overlay) for the trip-editor
  // left panel. Behaviour/state are identical; only the outer wrapper differs.
  variant = 'dialog',
  // Optional (trip editor only): report the in-progress transfer so the map can
  // draw a live route preview shaped by the picked transport type.
  onPreviewTransfer = null,
  // TRIP-176: 'embedded' renders body + footer only (no .lp shell, no header) so
  // the shared AddBookingPanel tab wrapper can host it under an "I have a
  // booking" tab. Panel-mode chrome (lp-b / lp-f) is kept; the wrapper supplies
  // the .lp shell and the shared header.
  embedded = false,
}) {
  const { t } = useI18nFormat();
  const { lang } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();

  // currentKind defaults to the prop in create mode, or to the prop in edit mode
  // too (the parent always tells us the right kind for the entity it passed).
  const [currentKind, setCurrentKind] = useState(initialKind || 'hotel');
  const isEdit = !!entity;
  const baseMeta = TYPE_META[currentKind] || TYPE_META.hotel;
  const tripId = tripIdProp || entity?.trip_id || visit?.trip_id || fromVisit?.trip_id;

  // Timezones - kept for compatibility but the time helpers ignore them
  // since the app now stores naive wall-clock values. Still passed to the
  // TimezoneHint component so the hint label shows the right city.
  const tz = visit?.timezone || 'UTC';
  const startTz = fromVisit?.timezone || 'UTC';
  const endTz = toVisit?.timezone || 'UTC';

  const [form, setForm] = useState(() =>
    buildInitialForm(initialKind || 'hotel', entity, { visit, fromVisit, toVisit, defaultStart, defaultCurrency, initialServiceKind })
  );

  // ── Storage cleanup bookkeeping (TRIP-117) ──────────────────────────────
  // Files attach to the live entity immediately on upload (uuid-unique keys,
  // single reference each). Track which object keys we've seen so dropped/
  // abandoned ones can be swept best-effort once their reference is gone:
  //   • originalDocPaths — the entity's files when the dialog opened.
  //   • seenDocPaths     — every key that has appeared in the form (originals
  //                        + uploads staged this session).
  //   • committedRef     — set once we save/delete, so the unmount sweep skips
  //                        a successful flow.
  const originalDocPaths = useRef(collectDocPaths(form.documents));
  const seenDocPaths = useRef(new Set(originalDocPaths.current));
  const committedRef = useRef(false);
  useEffect(() => {
    for (const p of collectDocPaths(form.documents)) seenDocPaths.current.add(p);
  }, [form.documents]);
  // Dialog dismissed without saving/deleting → sweep uploads staged this session
  // that never got persisted (originals stay; they're still referenced).
  useEffect(() => () => {
    if (committedRef.current) return;
    const original = new Set(originalDocPaths.current);
    removeTripFiles([...seenDocPaths.current].filter((p) => !original.has(p)));
  }, []);

  // For services, the header (icon / colour / title) follows the concrete
  // subtype (esim / insurance / car_rental), not the generic `service` kind.
  const meta = (currentKind === 'service' && SERVICE_META[form.service_kind])
    ? SERVICE_META[form.service_kind]
    : baseMeta;
  const [aiFields, setAiFields] = useState(new Set());
  // Whole-form snapshot taken right before a parse merges its result in, so
  // "Reset" can undo the parse. A per-key walk over `aiFields` would not be
  // enough: the merge also writes keys it never records there (geocoded
  // lat/lng, `hasLayovers`, the rebuilt `segments` array), which would survive
  // the reset and leave a map pin or a leg chain from a booking that is no
  // longer on screen.
  const preAiForm = useRef(null);
  // Six-state AI flow per the prototype: locked / available / idle /
  // uploaded / parsing / parsed. Starts as 'checking' (non-interactive) until
  // checkSubscriptionStatus resolves — then Pro → 'available', non-Pro → 'locked'.
  // This prevents a non-Pro user from opening/using the parser during the gap.
  const [aiState, setAiState] = useState('checking');

  // Pro state: null = checking, true/false = resolved. isOwner tells whether the
  // caller owns this trip - only the owner may be sent to checkout; a participant
  // is shown the "ask the owner" info dialog instead.
  const [isPro, setIsPro] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const { openProUpsell } = useProUpsell();

  const [confirmDel, setConfirmDel] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Soft note when an AI-parsed multi-leg booking's endpoints differ from the
  // trip leg the modal was opened for (we keep the trip's endpoints).
  // AI-highlighted fields inside layover segments - keyed `${seg.id}.${field}`.
  // Cleared per field when the user edits it (mirrors single-leg aiFields).
  const [aiSegFields, setAiSegFields] = useState(() => new Set());
  // Ephemeral parse-time advisories (city mismatch AI vs trip). Not persisted,
  // not gating - cleared on reset/save. Shown in the same IssuesPanel.
  const [aiAdvisories, setAiAdvisories] = useState([]);

  // Time-missing flags for individual datetime-local inputs (the native input
  // returns "" when only a date is entered - DateTimeInput reports this so we
  // can keep Save disabled until a time is also picked).
  const [timeMissing, setTimeMissing] = useState({});
  const anyTimeMissing = Object.values(timeMissing).some(Boolean);

  // Touched-field / save-attempt tracking. Drives the reveal policy below
  // (see `revealAll`): a fresh CREATE form stays clean until touch/submit.
  const [touched, setTouched] = useState(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const markTouched = (token) => {
    if (!token) return;
    setTouched((prev) => (prev.has(token) ? prev : new Set(prev).add(token)));
  };

  // Re-hydrate form whenever the dialog opens or the entity prop changes.
  useEffect(() => {
    if (!open) return;
    const k = initialKind || 'hotel';
    setCurrentKind(k);
    setForm(buildInitialForm(k, entity, { visit, fromVisit, toVisit, defaultStart, defaultCurrency, initialServiceKind }));
    setAiFields(new Set());    setAiSegFields(new Set()); setAiAdvisories([]); preAiForm.current = null;
    setTimeMissing({});
    setTouched(new Set()); setSubmitted(false);
    setAiState('checking'); // re-gate the parser on every open until Pro is re-checked
  }, [open, entity?.id, initialKind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pro check - runs whenever the dialog opens with a tripId we can verify.
  useEffect(() => {
    if (!open) { setIsPro(null); return; }
    if (!tripId) { setIsPro(false); return; }
    let cancelled = false;
    setIsPro(null);
    invokeFn('checkSubscriptionStatus', { body: { tripId } })
      .then((res) => { if (!cancelled) { setIsPro(!!res.data?.isPro); setIsOwner(!!res.data?.isOwner); } })
      .catch((e) => { console.error(e); if (!cancelled) { setIsPro(false); setIsOwner(false); } });
    return () => { cancelled = true; };
  }, [open, tripId]);

  // Sync AI block to Pro state - only when not mid-flow (idle/uploaded/parsing/parsed).
  useEffect(() => {
    if (isPro === null) return;
    setAiState((prev) => {
      if (prev === 'idle' || prev === 'uploaded' || prev === 'parsing' || prev === 'parsed') return prev;
      return isPro ? 'available' : 'locked';
    });
  }, [isPro]);

  // Map a form key to its canonical validation field token (for touched-state).
  const FIELD_TOKEN = {
    name: 'name', title: 'title', checkInLocal: 'checkIn', checkOutLocal: 'checkOut',
    startLocal: 'start', endLocal: 'end', pickup_address: 'pickupAddress',
    pickup_at_local: 'pickup', dropoff_at_local: 'dropoff',
  };
  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    markTouched(FIELD_TOKEN[key]);
    setAiFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev); next.delete(key); return next;
    });
  };

  const setTime = (key, missing) => {
    setTimeMissing((prev) => (prev[key] === missing ? prev : { ...prev, [key]: missing }));
  };

  // Type switcher - only enabled in create mode.
  const switchKind = (k) => {
    if (isEdit) return;
    setCurrentKind(k);
    setForm(buildInitialForm(k, null, { visit, fromVisit, toVisit, defaultStart, defaultCurrency }));
    // Drop the snapshot too: switching kind rebuilds the form but leaves aiState
    // at 'parsed', so the block still offers "Reset" — without this it would
    // restore a hotel-shaped snapshot into a transfer form.
    setAiFields(new Set());    setAiSegFields(new Set()); setAiAdvisories([]); preAiForm.current = null;
    setTimeMissing({});
    setTouched(new Set()); setSubmitted(false);
  };

  const openUpgrade = () => {
    // Only the owner can upgrade this trip → checkout. A participant can't unlock
    // someone else's trip by paying, so show the "ask the owner" dialog instead.
    // Апселл рендерит app-level ProUpsellProvider (не вложенная модаль) — TRIP-225.
    if (!isOwner) { openProUpsell({ mode: 'info' }); return; }
    onOpenChange?.(false);
    nav(`/pro?tripId=${tripId || ''}&from=paywall&feature=event_pro`);
  };

  // ── Unified validation (Ф2): one engine, emits CODES; text via t('validation.'+code).
  // Modal & Edit Mode share the same rules, so the verdict matches by construction.
  const vctx = useMemo(() => {
    if (currentKind === 'hotel' || currentKind === 'activity') return { visit };
    if (currentKind === 'transfer') return { fromVisit, toVisit };
    return {};
  }, [currentKind, visit, fromVisit, toVisit]);

  // Normalize the form to the engine's draft shape using the SAME localToUtc that
  // the save payloads use, so OOB/order verdicts equal what actually gets stored.
  const vdraft = useMemo(() => {
    if (currentKind === 'hotel') {
      return { id: entity?.id, name: form.name, checkIn: localToUtc(form.checkInLocal, tz), checkOut: localToUtc(form.checkOutLocal, tz) };
    }
    if (currentKind === 'activity') {
      return { id: entity?.id, title: form.title, start: localToUtc(form.startLocal, tz), end: localToUtc(form.endLocal, tz) };
    }
    if (currentKind === 'transfer') {
      if (form.hasLayovers) {
        return {
          id: entity?.id, hasLayovers: true,
          segments: (form.segments || []).map((s) => ({
            start: localToUtc(s.startLocal, startTz), end: localToUtc(s.endLocal, endTz), toCity: s.toCity,
          })),
        };
      }
      return { id: entity?.id, start: localToUtc(form.startLocal, startTz), end: localToUtc(form.endLocal, endTz) };
    }
    if (currentKind === 'service') {
      return {
        id: entity?.id, service_kind: form.service_kind || 'car_rental', name: form.name,
        pickupAddress: form.pickup_address, isEdit,
        pickup: localToUtc(form.pickup_at_local, tz), dropoff: localToUtc(form.dropoff_at_local, tz),
        date_start: form.date_start || null, date_finish: form.date_finish || null,
      };
    }
    return {};
  }, [currentKind, form, tz, startTz, endTz, entity, isEdit]);

  // Обязательность считается по ТОМУ ЖЕ гейту, который держит кнопку сохранения
  // (`BLOCKING_CODES`, объявлен в шапке модуля), а не по сырому вердикту
  // валидатора. Иначе звёздочка врёт: у аренды авто название - ошибка
  // валидатора, но эта форма понижает её до совета и сохраняется без названия.
  // ★Предикат не проверяет `level`, а `hasBlockingError` ниже требует и код из
  // списка, И `level === 'error'`. Сегодня это одно и то же: все шесть кодов
  // списка выдаются ТОЛЬКО как `error`. Появится среди них warning - гейты
  // разъедутся молча, и звёздочка снова начнёт врать.
  const askRequired = useCallback(
    (field) => isFieldRequired(currentKind, vdraft, vctx, field, (i) => BLOCKING_CODES.has(i.code)),
    [currentKind, vdraft, vctx],
  );

  // Verdict policy: only the logical-ORDER family truly BLOCKS the save (dates in
  // the wrong order make no sense to persist). Everything else — required
  // name/title, out-of-bounds vs city dates, transfer day mismatch — stays
  // advisory: it surfaces (inline + summary) without blocking. Required date/time
  // is guarded separately by `anyTimeMissing`.
  const issues = useMemo(
    () => validateEntity(currentKind, vdraft, vctx).map((i) => (BLOCKING_CODES.has(i.code) ? i : { ...i, level: 'warn' })),
    [currentKind, vdraft, vctx],
  );
  const hasBlockingError = useMemo(() => issues.some((i) => i.level === 'error'), [issues]);

  // day_change is no longer a form field the user toggles: it is derived from the
  // dates at every seam (badge display + buildTransferPayload / layover segments via
  // isOvernightLocal), so there is nothing to auto-raise here anymore.

  // Live map route preview while creating a transfer (shaped by transport type).
  useEffect(() => {
    if (!onPreviewTransfer) return undefined;
    if (currentKind === 'transfer' && !form.hasLayovers && fromVisit?.id && toVisit?.id) {
      onPreviewTransfer({ id: 'preview', from_city_visit_id: fromVisit.id, to_city_visit_id: toVisit.id, transport_type: form.transport_type });
    } else {
      onPreviewTransfer(null);
    }
    return () => onPreviewTransfer(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKind, form.hasLayovers, form.transport_type, fromVisit?.id, toVisit?.id]);

  // ── Save validity ──────────────────────────────────────────────────────
  // Blocked by: an in-flight upload, a half-entered time (date without time), or
  // a blocking validation error (the ORDER family). Everything else is advisory.
  const canSave = useMemo(
    () => !uploading && !anyTimeMissing && !hasBlockingError,
    [uploading, anyTimeMissing, hasBlockingError],
  );

  // Reveal policy (display only — blocking stays with canSave/ORDER); the rule
  // itself lives in `issuesToShow` (validation.js), where it is testable. A
  // parse fills the form without touching any field, so without `aiParsed` a
  // parsed create form would show none of its issues (TRIP-277).
  const aiParsed = aiState === 'parsed';
  const displayIssues = useMemo(
    () => issuesToShow(issues, { isEdit, submitted, aiParsed, touched }),
    [issues, isEdit, submitted, aiParsed, touched],
  );
  // The summary panel is the same policy with nothing touched: everything once
  // revealed, silence before that. Going through the same helper rather than
  // re-testing the condition here is deliberate — holding the predicate in two
  // places is exactly how the AI-parse case got lost from one of them.
  const panelIssues = useMemo(
    () => issuesToShow(issues, { isEdit, submitted, aiParsed }),
    [issues, isEdit, submitted, aiParsed],
  );
  // Build the DB payload for the current single entity (mirrors saveMut's branches).
  const buildCurrentPayload = () => {
    if (currentKind === 'hotel') return buildHotelPayload(form, visit, tz);
    if (currentKind === 'activity') return buildActivityPayload(form, visit, tz);
    if (currentKind === 'transfer') return buildTransferPayload(form, fromVisit, toVisit, tripId, startTz, endTz);
    return buildServicePayload(form, tripId, t);
  };
  const OPT_CACHE = { hotel: 'hotels', transfer: 'transfers', activity: 'activities', service: 'services' };
  // A create that touches several rows/cities (layover chain or AI extra segments)
  // can't be cleanly mirrored optimistically — keep the awaited path for those.
  const isComplexTransferCreate = currentKind === 'transfer' && !entity
    && (form.hasLayovers && Array.isArray(form.segments) && form.segments.length >= 2);

  const handleSaveClick = () => {
    if (!canSave) {
      setSubmitted(true);
      const f = issues.find((i) => i.field)?.field;
      if (f) document.querySelector(`[data-vfield="${CSS.escape(f)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // A valid CREATE of a real booking (services are opened, not "booked").
    // One distinct event per booking type so it's clear what was added. Fired at
    // submit — the create commits optimistically below.
    if (!entity) {
      if (currentKind === 'transfer') track('transfer_added', { trip_id: tripId });
      else if (currentKind === 'hotel') track('hotel_added', { trip_id: tripId });
      else if (currentKind === 'activity') track('activity_added', { trip_id: tripId });
    }
    // Optimistic CREATE of a single booking: show it immediately, close the panel,
    // write to the DB in the background and reconcile. qc is app-level, so this
    // completes even though the dialog unmounts on close. Edits + complex transfer
    // creates keep the awaited mutation (avoids the view-panel read race / multi-row).
    const optimistic = !entity && tripId && OPT_CACHE[currentKind] && !isComplexTransferCreate;
    if (!optimistic) { saveMut.mutate(); return; }
    const table = ENTITY_TABLE_BY_KIND[currentKind];
    const cacheKind = OPT_CACHE[currentKind];
    const payload = buildCurrentPayload();
    const tempId = 'tmp-' + Math.random().toString(36).slice(2);
    const row = { id: tempId, trip_id: tripId, created_by: user?.id, ...payload };
    const prev = qc.getQueryData(TRIP_CONTENT_KEY(tripId));
    optimisticContentUpdate(qc, tripId, cacheKind, 'add', row);
    // We're committing optimistically and the dialog unmounts now — mark it so
    // the unmount sweep won't delete the staged files this create is about to
    // reference (TRIP-117). On insert failure we sweep them explicitly below.
    committedRef.current = true;
    onOpenChange(false);
    (async () => {
      try {
        await writeRows(supabase.from(table).insert({ ...payload, created_by: user?.id }));
        invalidateTripData(qc, tripId);
        // Same commit point as saveMut below (see removeOrphanedFiles).
        removeOrphanedFiles(seenDocPaths.current, form.documents);
      } catch (err) {
        if (prev !== undefined) qc.setQueryData(TRIP_CONTENT_KEY(tripId), prev);
        invalidateTripData(qc, tripId);
        removeTripFiles(collectDocPaths(form.documents));
        toast({ title: t('event.save_failed'), description: err?.message || String(err), variant: 'destructive' });
      }
    })();
  };

  // ── Save mutation ──────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: async () => {
      if (currentKind === 'hotel') {
        const payload = buildHotelPayload(form, visit, tz);
        return upsert('hotel_stays', entity, payload, user);
      }
      if (currentKind === 'transfer') {
        // Layover transfer (create mode): build a chain of separate transfer
        // rows through waypoint city_visits (TRIP_EDIT_MODE_TZ §11).
        if (!entity && form.hasLayovers && Array.isArray(form.segments) && form.segments.length >= 2) {
          return saveLayoverChain(form, fromVisit, toVisit, tripId, user, t);
        }
        const payload = buildTransferPayload(form, fromVisit, toVisit, tripId, startTz, endTz);
        const created = await upsert('transfers', entity, payload, user);
        return created;
      }
      if (currentKind === 'activity') {
        const payload = buildActivityPayload(form, visit, tz);
        return upsert('activities', entity, payload, user);
      }
      // service / car_rental
      const payload = buildServicePayload(form, tripId, t);
      return upsert('trip_services', entity, payload, user);
    },
    onSuccess: () => {
      // Commit point: every file staged this session that the saved form no
      // longer references is orphaned — sweep best-effort (TRIP-117). Anchored
      // on `seenDocPaths`, not `originalDocPaths`, so a file uploaded THIS
      // session and then detached (AI reset, or by hand) is swept too; the
      // unmount sweep skips a successful save by design (TRIP-277).
      committedRef.current = true;
      removeOrphanedFiles(seenDocPaths.current, form.documents);
      if (tripId) invalidateTripData(qc, tripId);
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: t('event.save_failed'),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    },
  });

  // ── Delete mutation ────────────────────────────────────────────────────
  const deleteMut = useMutation({
    mutationFn: async () => {
      // Entity gone → every file it referenced (originals + any staged this
      // session) is orphaned. deleteSourceEntity sweeps best-effort on success
      // (TRIP-117); seenDocPaths is the dialog's broader set (originals + staged).
      const { error, deleted } = await deleteSourceEntity(currentKind, entity.id, [...seenDocPaths.current]);
      if (error) throw error;
      // 0 rows removed = RLS hid the row (session expired / not permitted) or it
      // was already gone → surface (onError), don't close as a phantom success.
      if (!deleted) throw new Error('write_rejected');
    },
    onSuccess: () => {
      committedRef.current = true;
      if (tripId) invalidateTripData(qc, tripId);
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: t('event.delete_failed'),
        description: err?.message && err.message !== 'write_rejected' ? err.message : undefined,
        variant: 'destructive',
      });
    },
  });

  // ── AI extract handlers ────────────────────────────────────────────────
  const handleHotelExtract = async (data, fileUrl, fileName) => {
    preAiForm.current = form;
    const filled = new Set();
    const upd = { ...form };
    const setIf = makeAiSetter(upd, filled);
    setIf('name', data.name);
    setIf('address', data.address);
    setIf('booking_reference', data.booking_reference);
    // payment_status is a closed-type control with a DB CHECK (paid/partial/
    // pay_on_arrival). LLM output is non-deterministic (e.g. "Paid", "N/A"), so
    // normalize + whitelist; anything else is ignored (field stays empty) rather
    // than poisoning the save on hotel_stays_payment_status_check. TRIP-75.
    const ps = String(data.payment_status ?? '').trim().toLowerCase();
    if (ps === 'paid' || ps === 'partial' || ps === 'pay_on_arrival') {
      upd.payment_status = ps;
      filled.add('payment_status');
    }
    // No type guard: AI often returns price as a string - populate it, the engine
    // validates downstream. (§12: don't drop AI values on type/validity.)
    setIf('price', data.price);
    setIf('currency', data.currency);
    if (data.free_cancellation != null) {
      upd.free_cancellation = !!data.free_cancellation; // closed-type control -> coerce to bool
      filled.add('free_cancellation');
    }
    setIf('phone', data.phone);
    setIf('email', data.email);
    setIf('booking_url', data.booking_url);
    // date+time -> local string. Reject a malformed DATE part so a bad AI value
    // never blanks a prefilled field (datetime-local can't hold an invalid value).
    const combine = (d, t2) => {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return null;
      const time = t2 && /^\d{1,2}:\d{2}/.test(t2) ? t2.padStart(5, '0').slice(0, 5) : '00:00';
      return `${d}T${time}`;
    };
    const ci = combine(data.check_in_date, data.check_in_time);
    if (ci) { upd.checkInLocal = ci; filled.add('checkInLocal'); }
    const co = combine(data.check_out_date, data.check_out_time);
    if (co) { upd.checkOutLocal = co; filled.add('checkOutLocal'); }
    // Typed as `datetime` in ai-values.js: the reshape below hands the
    // datetime-local input whatever the model sent, and that input silently
    // blanks itself on anything malformed.
    setIf('free_cancellation_until_local', data.free_cancellation_until?.replace(' ', 'T').slice(0, 16));
    if (Array.isArray(data.documents) && data.documents.length > 0) {
      upd.documents = [...(upd.documents || []), ...data.documents].slice(0, 50);
      filled.add('documents');
    } else if (fileUrl) {
      upd.documents = [...(upd.documents || []), { file_url: fileUrl, file_name: fileName || '' }];
      filled.add('documents');
    }
    // Geocode the hotel address → coords, ONLY on a house-level match; otherwise
    // leave coords null and keep the address as text (no map point, never the
    // city center). TRIP-145.
    if (data.address) {
      const geo = await geocodeAddress(data.address, lang);
      if (geo) { upd.latitude = geo.latitude; upd.longitude = geo.longitude; }
    }
    setForm(upd);
    setAiFields(filled);
    setAiState('parsed');
  };

  const handleTransferExtract = async (data, fileUrl, fileName) => {
    preAiForm.current = form;
    // New parser shape: data.transfers[] (legs) + data.waypoints[] (intermediate
    // layover cities, each with a date). Fall back to the legacy data.segments[].
    const segs = Array.isArray(data.transfers) && data.transfers.length > 0
      ? data.transfers
      : (Array.isArray(data.segments) && data.segments.length > 0 ? data.segments : [data]);
    const wps = Array.isArray(data.waypoints) ? data.waypoints : [];
    // Reject a malformed DATE part (return ''), so a bad AI date never produces
    // an invalid local value. Callers coalesce to '' / skip.
    const combine = (d, t2) => {
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(String(d))) return '';
      const time = t2 && /^\d{1,2}:\d{2}/.test(t2) ? t2.padStart(5, '0').slice(0, 5) : '00:00';
      return `${d}T${time}`;
    };
    const normType = (tt, fb = 'plane') => (TRANSPORT_KINDS.some((k) => k.id === tt) ? tt : fb);
    const docs = (Array.isArray(data.documents) && data.documents.length)
      ? data.documents
      : (fileUrl ? [{ file_url: fileUrl, file_name: fileName || '' }] : []);

    // Ephemeral parse advisory: AI-read cities vs the trip route. Endpoints are
    // taken from the trip (not AI), so this is informational only - shown in the
    // panel, never persisted, does not gate save. Computed from the raw payload.
    setAiAdvisories(transferAiCityAdvisories(data, fromVisit, toVisit));

    // ── Multi-leg booking (create mode) → layover form (waypoint chain) ──
    if (segs.length > 1 && !isEdit) {
      // Same `aiField` gate as the flat paths, keyed by the same form field
      // names — so `price` / `currency` are shape-checked here too.
      const formSegs = segs.map((s) => ({
        ...makeSegment(aiField('currency', s.currency) || aiField('currency', data.currency) || 'EUR'),
        transport_type: normType(s.transport_type),
        from_address: aiField('from_address', s.from_address) || '',
        to_address: aiField('to_address', s.to_address) || '',
        startLocal: s.departure_date ? combine(s.departure_date, s.departure_time) : '',
        endLocal: s.arrival_date ? combine(s.arrival_date, s.arrival_time) : '',
        carrier: aiField('carrier', s.carrier) || '',
        flight_number: aiField('flight_number', s.flight_number) || '',
        booking_reference: aiField('booking_reference', s.booking_reference) || '',
        price: aiField('price', s.price) || '',
        toCity: null,
      }));
      // Resolve the intermediate layover cities (to_city of all but the last leg)
      // to full city objects (coords + tz) so saveLayoverChain can create
      // waypoints. ONE `search_gazetteer_batch` RPC (TRIP-214): the whole chain
      // resolves server-side in a single round-trip, no per-city burst. Names
      // that don't resolve surface as an advisory instead of a silent null — the
      // user then picks the layover city manually.
      const lvIdx = [];
      const lvQ = [];
      for (let i = 0; i < formSegs.length - 1; i++) {
        // Prefer the explicit waypoints[] entry; fall back to the leg's to_city.
        const name = wps[i]?.city || segs[i].to_city;
        if (!name) continue;
        const code = wps[i]?.country_code || segs[i].to_country_code;
        lvIdx.push(i);
        lvQ.push(`${name}${code ? ', ' + code : ''}`);
      }
      if (lvQ.length) {
        const lvLists = await resolveCities(lvQ, lang);
        const unresolved = [];
        lvIdx.forEach((segIdx, k) => {
          const best = lvLists[k]?.[0];
          if (best?.latitude) {
            const tz = tzFromCoords(best.latitude, best.longitude);
            formSegs[segIdx].toCity = { city_name: best.city_name, city_name_en: best.city_name_en, geonameid: best.geonameid ?? null, name_i18n: best.name_i18n || null, country: best.country, country_code: best.country_code, latitude: best.latitude, longitude: best.longitude, timezone: tz, external_city_id: best.external_city_id };
          } else {
            unresolved.push(lvQ[k]);
          }
        });
        if (unresolved.length) {
          setAiAdvisories((prev) => [
            ...(prev || []),
            { level: 'warning', code: 'AI_LAYOVER_UNRESOLVED', scope: 'entity', values: { cities: unresolved.join(', ') } },
          ]);
        }
      }
      // Geocode each segment's endpoint addresses → coords, ONLY on a house-
      // level match; otherwise leave coords null and keep the address as text
      // (no map point, never the city center). Same geocodeAddress used for the
      // hotel and single-leg transfer. Dedup identical strings so a shared
      // layover address (one leg's to == next leg's from) costs one lookup.
      const segAddrs = [...new Set(
        formSegs.flatMap((s) => [s.from_address, s.to_address]).filter((a) => a && a.trim()),
      )];
      if (segAddrs.length) {
        const geos = await Promise.all(segAddrs.map((a) => geocodeAddress(a, lang)));
        const coordByAddr = new Map(segAddrs.map((a, i) => [a, geos[i]]));
        formSegs.forEach((s) => {
          const gf = s.from_address && coordByAddr.get(s.from_address);
          if (gf) { s.from_latitude = gf.latitude; s.from_longitude = gf.longitude; }
          const gt = s.to_address && coordByAddr.get(s.to_address);
          if (gt) { s.to_latitude = gt.latitude; s.to_longitude = gt.longitude; }
        });
      }

      // Endpoints stay the trip's fromVisit/toVisit. Mismatches (wrong dates /
      // cities) are NOT soft-warned here anymore - the parsed chain is a normal
      // draft and goes through the same validateEntity gate (TR_DEP_DAY /
      // TR_ARR_DAY block save, SEG_* cover segments).

      // Mark AI-filled segment fields for the purple highlight (+ field count).
      const segAi = new Set();
      formSegs.forEach((s) => {
        ['transport_type', 'from_address', 'to_address', 'startLocal', 'endLocal', 'carrier', 'flight_number', 'price'].forEach((k) => {
          if (s[k] !== '' && s[k] != null) segAi.add(`${s.id}.${k}`);
        });
        if (s.toCity) segAi.add(`${s.id}.toCity`);
      });

      const bookingUrl = aiField('booking_url', data.booking_url);
      const topFilled = new Set();
      if (bookingUrl) topFilled.add('booking_url');

      setForm((prev) => ({
        ...prev,
        hasLayovers: true,
        segments: formSegs,
        booking_url: bookingUrl || prev.booking_url,
        documents: docs.length ? [...(prev.documents || []), ...docs].slice(0, 50) : prev.documents,
      }));
      setAiFields(topFilled);
      setAiSegFields(segAi);
      setAiState('parsed');
      return;
    }

    // ── Single leg - flat-form fill (unchanged behavior) ──
    const filled = new Set();
    const upd = { ...form, hasLayovers: false, segments: [] };
    const setIf = makeAiSetter(upd, filled);
    const first = segs[0] || {};
    setIf('booking_url', data.booking_url);
    setIf('carrier', first.carrier);
    setIf('flight_number', first.flight_number);
    setIf('booking_reference', first.booking_reference);
    setIf('from_address', first.from_address);
    setIf('to_address', first.to_address);
    setIf('price', first.price);
    setIf('currency', first.currency);
    const sDep = combine(first.departure_date, first.departure_time);
    if (sDep) { upd.startLocal = sDep; filled.add('startLocal'); }
    const sArr = combine(first.arrival_date, first.arrival_time);
    if (sArr) { upd.endLocal = sArr; filled.add('endLocal'); }
    if (docs.length) { upd.documents = [...(upd.documents || []), ...docs].slice(0, 50); filled.add('documents'); }
    if (first.transport_type && TRANSPORT_KINDS.some((k) => k.id === first.transport_type)) {
      upd.transport_type = first.transport_type;
      filled.add('transport_type');
    }
    // Geocode single-leg transfer endpoints → coords, ONLY on a house-level
    // match; otherwise keep the address as text with no coords (no map point,
    // never the city center). TRIP-145.
    if (first.from_address) {
      const g = await geocodeAddress(first.from_address, lang);
      if (g) { upd.from_latitude = g.latitude; upd.from_longitude = g.longitude; }
    }
    if (first.to_address) {
      const g = await geocodeAddress(first.to_address, lang);
      if (g) { upd.to_latitude = g.latitude; upd.to_longitude = g.longitude; }
    }
    setForm(upd);
    setAiFields(filled);
    setAiSegFields(new Set()); // advisories already set above - keep them
    setAiState('parsed');
  };

  // ── Render ─────────────────────────────────────────────────────────────
  // Оболочка события ОДНА (TRIP-333 §4). Раньше этот же компонент рисовал две:
  // в панели - `.lp-*`, в диалоге - собственное семейство `.ev-dlg-*`, и ветка
  // стояла у каждой из четырёх частей (шапка, плитка типа, тело, футер). Тело
  // при этом было общим всегда - расходился только хром вокруг него.
  // Различаются оболочки теперь только КОНТЕЙНЕРОМ (модалка против панели) и
  // способом ухода, как и задумано.
  const isPanel = variant === 'panel' || embedded;
  const bodyCls = 'lp-b scrollbar-thin';
  // Шапка - ОБЩИЙ шов `eventHeader`, тот же, что у создания и у просмотра.
  // Прежние `event.title_edit_*` («Проживание в Барселона», «Переезд A → B»)
  // были ТРЕТЬИМ способом назвать то же самое и умерли вместе со сборкой.
  // ⚠Сервисы (eSIM / страховка / аренда авто) сюда НЕ входят: у них нет ни
  // города, ни окна проживания, и заголовок у них - название услуги. Общий шов
  // покрывает три вида, которые везде показывают МЕСТО и КОГДА.
  const isSvcKind = currentKind === 'service';
  const hdr = isSvcKind
    ? { eyebrow: t(meta.labelKey), title: t(isEdit ? meta.titleEditKey : meta.titleNewKey), sub: '' }
    : eventHeader({ kind: currentKind, visit, fromVisit, toVisit, entity, t, lang });
  const title = hdr.title;

  const inner = (
    <>
          {/* Header — hidden when embedded (AddBookingPanel owns the shared header).
              TRIP-186: шапка edit унифицирована с остальными состояниями (канон
              PanelShell / view): eyebrow сверху, .t-title, крестик справа — без
              левой стрелки-назад. TRIP-333 §4: диалог рисует ЕЁ ЖЕ, своей у него
              больше нет; отличается только подпись крестика (уход из панели -
              «назад», из модалки - «отмена»). */}
          {embedded ? null : (
            <div className="lp-h lp-h--ev">
              <span className="lp-ic"><meta.Icon /></span>
              <div className="lp-ti">
                <div className="eyebrow">{hdr.eyebrow}</div>
                <div className="lp-tirow">
                  <b className="t-title">{title}</b>
                  {hdr.sub && <span className="t-meta">{hdr.sub}</span>}
                </div>
              </div>
              <IconBtn
                icon="close"
                tone="soft"
                round
                onClick={() => onOpenChange?.(false)}
                title={isPanel ? t('common.back') : undefined}
                ariaLabel={isPanel ? t('common.back') : t('common.cancel')}
              />
            </div>
          )}

          {/* Inline delete-confirm view - replaces the form when active to
              avoid nesting Radix modals (which would intercept pointer
              events on the inner buttons). */}
          {confirmDel ? (
            <div className={bodyCls}>
              <Severity level="error" icon="trash" title={t('event.delete_q', { label: t(meta.labelKey).toLowerCase() })}>
                <div className="t-meta">{t('event.delete_irreversible')}</div>
              </Severity>
            </div>
          ) : (
          /* Body */
          <div className={bodyCls}>
            {/* AI block - only for hotel & transfer (the kinds with parsers). */}
            {(currentKind === 'hotel' || currentKind === 'transfer') && (
              <EventAiBlock
                kind={currentKind}
                tripId={tripId}
                state={aiState}
                setState={setAiState}
                onExtract={currentKind === 'hotel' ? handleHotelExtract : handleTransferExtract}
                onUpgrade={openUpgrade}
                parsedFieldCount={aiFields.size + aiSegFields.size}
                onReset={() => {
                  // Undo the parse itself, not just its highlight. Restoring the
                  // pre-parse snapshot empties the form in create mode (nothing
                  // was there before) and puts the saved values back in edit mode,
                  // instead of blanking data the parse merely overwrote.
                  // Documents parsed in are unlinked here too; the uploaded files
                  // themselves stay in Storage - removing them is a separate call.
                  if (preAiForm.current) setForm(preAiForm.current);
                  preAiForm.current = null;
                  setAiFields(new Set());
                  setAiSegFields(new Set());
                  setAiAdvisories([]);
                }}
              />
            )}

            <RequiredFieldsCtx.Provider value={askRequired}>
            <fieldset
              disabled={aiState === 'parsing'}
              style={{
                border: 'none', margin: 0, padding: 0, minWidth: 0,
                display: 'flex', flexDirection: 'column', gap: 11,
                ...(aiState === 'parsing' ? { opacity: 0.5, pointerEvents: 'none', userSelect: 'none' } : {}),
              }}
            >
              {currentKind === 'hotel' && (
                <HotelFields
                  form={form}
                  setField={setField}
                  aiFields={aiFields}
                  tz={tz}
                  setTime={setTime}
                  issues={displayIssues}
                  onTouch={markTouched}
                  setUploading={setUploading}
                  tripId={tripId}
                />
              )}
              {currentKind === 'transfer' && (
                <TransferFields
                  form={form}
                  setField={setField}
                  setForm={setForm}
                  aiFields={aiFields}
                  aiSegFields={aiSegFields}
                  setAiSegFields={setAiSegFields}
                  fromVisit={fromVisit}
                  toVisit={toVisit}
                  startTz={startTz}
                  endTz={endTz}
                  setTime={setTime}
                  issues={displayIssues}
                  onTouch={markTouched}
                  isEdit={isEdit}
                  setUploading={setUploading}
                  tripId={tripId}
                />
              )}
              {currentKind === 'activity' && (
                <ActivityFields
                  form={form}
                  setField={setField}
                  setForm={setForm}
                  aiFields={aiFields}
                  tz={tz}
                  setTime={setTime}
                  issues={displayIssues}
                  onTouch={markTouched}
                  setUploading={setUploading}
                  tripId={tripId}
                />
              )}
              {currentKind === 'service' && (
                <ServiceFields
                  form={form}
                  setField={setField}
                  setForm={setForm}
                  aiFields={aiFields}
                  setTime={setTime}
                  issues={displayIssues}
                  onTouch={markTouched}
                  isEdit={isEdit}
                  setUploading={setUploading}
                  tripId={tripId}
                />
              )}

              {/* Summary panel: revealed on edit-open, save attempt or AI parse. Click row -> field. */}
              <IssuesPanel issues={[...panelIssues, ...aiAdvisories]} style={{ marginTop: 12 }} />
            </fieldset>
            </RequiredFieldsCtx.Provider>
          </div>
          )}

          {/* Footer — TRIP-186: единый канон с event view / city view (lp-f--ratio
              + <Btn>): удалить (danger, схлоп на мобиле) + primary. Pinned снизу
              в панельном режиме. TRIP-333 §4: класс один на оба режима, своим у
              диалога остался только прилипший низ, и тот не нужен модалке -
              она и так не прокручивает футер. */}
          <div
            className={'lp-f' + (confirmDel ? '' : ' lp-f--ratio')}
            style={isPanel ? { position: 'sticky', bottom: 0, zIndex: 3 } : undefined}
          >
            {confirmDel ? (
              <>
                <Btn variant="secondary" onClick={() => setConfirmDel(false)} disabled={deleteMut.isPending}>{t('common.cancel')}</Btn>
                <Btn variant="danger-solid" icon="trash" loading={deleteMut.isPending} disabled={deleteMut.isPending} onClick={() => deleteMut.mutate()}>{t('common.delete')}</Btn>
              </>
            ) : (
              <>
                {isEdit && (
                  <Btn variant="danger" icon="trash" onClick={() => setConfirmDel(true)} disabled={deleteMut.isPending} ariaLabel={t('common.delete')}>
                    <span className="btn-label-collapse">{t('common.delete')}</span>
                  </Btn>
                )}
                <Btn
                  variant="primary"
                  icon={isEdit ? 'check' : 'plus'}
                  onClick={handleSaveClick}
                  loading={saveMut.isPending}
                  disabled={uploading || saveMut.isPending}
                  ariaDisabled={!canSave}
                >
                  {isEdit ? t('common.save') : t('event.create')}
                </Btn>
              </>
            )}
          </div>
    </>
  );

  const evVars = { '--hl': meta.color, '--hl-soft': meta.soft, '--hl-ink': meta.ink || meta.color };

  // TRIP-176: embedded — body + footer only (no .lp shell / header). The
  // AddBookingPanel wrapper provides the .lp shell + shared header + tabs.
  if (embedded) return inner;

  // Панельная ветка больше НЕ возвращает себе фон инлайном: она берёт его из
  // роли поверхности, как модалка и как панель создания. Прежний
  // `background: var(--surface)` был поправкой к `.lp`, который заливался
  // фоном приложения, - из-за него одна и та же форма выглядела по-разному
  // при создании и при редактировании события.
  return (
    <>
      {variant === 'panel' ? (
        <div className="te-edit-panel-body lp lp--wide" style={{ ...evVars, minHeight: 0, height: '100%' }}>
          {inner}
        </div>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="dlg--wide ev-dlg" aria-describedby={undefined} style={{ ...evVars, padding: 0 }}>
            {/* Accessible name for the dialog. The visible <h2> lives inside the shared
                `inner` (also used by the non-dialog panel variant), so a dedicated
                sr-only Title carries the contract only in this Radix-dialog branch. */}
            <DialogTitle className="sr-only">{title}</DialogTitle>
            {inner}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Payload builders - one per kind. Mirrors the legacy dialogs' columns plus
//  the new lat/lng + flight_number additions.
// ─────────────────────────────────────────────────────────────────────────────

async function upsert(table, entity, payload, user) {
  // Single write contract (writeRows): throws on error AND on a silent 0-row
  // RLS reject. By-id update / insert always affects exactly one row, so we
  // return the first (was .select().single()).
  const builder = entity
    ? supabase.from(table).update(payload).eq('id', entity.id)
    : supabase.from(table).insert({ ...payload, created_by: user?.id });
  const [row] = await writeRows(builder);
  return row;
}

function buildHotelPayload(form, visit, tz) {
  return {
    city_visit_id: visit.id,
    trip_id: visit.trip_id,
    name: form.name || 'Hotel',
    address: form.address,
    latitude: form.latitude ?? null,
    longitude: form.longitude ?? null,
    check_in_datetime: localToUtc(form.checkInLocal, tz),
    check_out_datetime: localToUtc(form.checkOutLocal, tz),
    booking_reference: form.booking_reference || undefined,
    payment_status: form.payment_status || undefined,
    price: form.price === '' ? null : Number(form.price),
    currency: form.currency || 'EUR',
    free_cancellation: !!form.free_cancellation,
    free_cancellation_until: form.free_cancellation && form.free_cancellation_until_local
      ? localToUtc(form.free_cancellation_until_local, tz)
      : null,
    phone: form.phone || undefined,
    email: form.email || undefined,
    booking_url: normalizeExternalUrl(form.booking_url),
    documents: Array.isArray(form.documents) ? form.documents : [],
    notes: form.notes,
    details: {},
  };
}

function buildTransferPayload(form, fromVisit, toVisit, tripId, startTz, endTz) {
  return {
    trip_id: tripId || fromVisit?.trip_id,
    from_city_visit_id: fromVisit?.id,
    to_city_visit_id: toVisit?.id,
    transport_type: form.transport_type,
    day_change: isOvernightLocal(form.startLocal, form.endLocal),
    start_datetime: localToUtc(form.startLocal, startTz),
    end_datetime: localToUtc(form.endLocal, endTz),
    carrier: form.carrier || undefined,
    flight_number: form.flight_number || null,
    from_address: form.from_address || undefined,
    from_latitude: form.from_latitude ?? null,
    from_longitude: form.from_longitude ?? null,
    to_address: form.to_address || undefined,
    to_latitude: form.to_latitude ?? null,
    to_longitude: form.to_longitude ?? null,
    booking_reference: form.booking_reference || undefined,
    booking_url: normalizeExternalUrl(form.booking_url),
    price: form.price === '' ? null : Number(form.price),
    currency: form.currency || 'EUR',
    documents: Array.isArray(form.documents) ? form.documents : [],
    notes: form.notes,
    details: {},
  };
}

// Layover transfer → waypoint chain (TRIP_EDIT_MODE_TZ §11).
// segments[i].toCity (for i < N-1) is a chosen layover city → one waypoint
// city_visit each. Then one transfer row per segment, between adjacent nodes:
//   fromVisit → wp1 → … → wp(N-1) → toVisit.
// Layover transfer (create) → ONE atomic server RPC (migration 0029). The server
// inserts the N-1 waypoint city_visits with CORRECT positions BEFORE writing the
// transfer rows, so the Ф2 recompute-on-transfer trigger lays dates by the right
// chain order, then runs a final recompute_trip. This replaces the old client
// insert→trigger→renumber sequence, which raced the trigger (waypoint at provisional
// position 0 was laid first and its date/order got corrupted).
async function saveLayoverChain(form, fromVisit, toVisit, tripId, user, t) {
  const segs = form.segments;
  const N = segs.length;

  // N-1 intermediate layover cities (each segment's toCity, except the last leg).
  const waypoints = [];
  for (let i = 0; i < N - 1; i++) {
    const c = segs[i].toCity;
    if (!c?.city_name) throw new Error(t('event.err_layover_city'));
    waypoints.push({
      external_city_id: c.external_city_id || null,
      geonameid: c.geonameid ?? null,
      name_i18n: c.name_i18n || null,
      city_name_en: c.city_name_en || null,
      country_code: c.country_code || null,
      latitude: c.latitude ?? null,
      longitude: c.longitude ?? null,
      timezone: c.timezone || 'UTC',
    });
  }

  // One leg per segment. Booking link is shared; documents/notes ride the first leg.
  const segments = segs.map((s, i) => ({
    transport_type: s.transport_type,
    day_change: isOvernightLocal(s.startLocal, s.endLocal),
    start_datetime: localToUtc(s.startLocal, 'UTC'),
    end_datetime: localToUtc(s.endLocal, 'UTC'),
    carrier: s.carrier || null,
    flight_number: s.flight_number || null,
    from_address: s.from_address || null,
    to_address: s.to_address || null,
    from_latitude: s.from_latitude ?? null,
    from_longitude: s.from_longitude ?? null,
    to_latitude: s.to_latitude ?? null,
    to_longitude: s.to_longitude ?? null,
    booking_reference: s.booking_reference || null,
    booking_url: normalizeExternalUrl(form.booking_url),
    price: s.price === '' || s.price == null ? null : Number(s.price),
    currency: s.currency || 'EUR',
    documents: i === 0 && Array.isArray(form.documents) ? form.documents : [],
    notes: i === 0 ? (form.notes || null) : null,
  }));

  const { error } = await supabase.rpc('add_layover_transfer', {
    p_trip: tripId,
    p_from: fromVisit?.id,
    p_to: toVisit?.id,
    p_waypoints: waypoints,
    p_segments: segments,
  });
  if (error) throw error;
  return null;
}

function buildActivityPayload(form, visit, tz) {
  return {
    city_visit_id: visit.id,
    trip_id: visit.trip_id,
    title: form.title || 'Activity',
    start_datetime: localToUtc(form.startLocal, tz),
    end_datetime: localToUtc(form.endLocal, tz),
    location_address: form.location_address,
    location_latitude: form.location_latitude ?? null,
    location_longitude: form.location_longitude ?? null,
    price: form.price === '' ? null : Number(form.price),
    currency: form.currency || 'EUR',
    documents: Array.isArray(form.documents) ? form.documents : [],
    notes: form.notes,
    details: {},
  };
}

function buildServicePayload(form, tripId, t) {
  const svcKind = form.service_kind || 'car_rental';
  if (svcKind === 'esim') {
    return {
      trip_id: tripId,
      kind: 'esim',
      name: form.name.trim() || 'eSIM',
      price: form.price === '' ? null : Number(form.price),
      currency: form.currency || 'EUR',
      details: {
        documents: Array.isArray(form.documents) ? form.documents : [],
        notes: form.notes || undefined,
      },
    };
  }
  if (svcKind === 'insurance') {
    return {
      trip_id: tripId,
      kind: 'insurance',
      name: form.name.trim() || t('service.kind.insurance'),
      price: form.price === '' ? null : Number(form.price),
      currency: form.currency || 'EUR',
      details: {
        policy_number: form.policy_number || undefined,
        date_start: form.date_start || undefined,
        date_finish: form.date_finish || undefined,
        documents: Array.isArray(form.documents) ? form.documents : [],
        notes: form.notes || undefined,
      },
    };
  }
  // car_rental
  const useSame = !form.return_different_location;
  const dropoffAddress = useSame ? form.pickup_address : form.dropoff_address;
  const dropoffLat = useSame ? form.pickup_latitude  : form.dropoff_latitude;
  const dropoffLng = useSame ? form.pickup_longitude : form.dropoff_longitude;
  const dropoffTz  = useSame ? form.pickup_timezone  : form.dropoff_timezone;
  const pickupTz   = form.pickup_timezone || 'UTC';
  return {
    trip_id: tripId,
    kind: 'car_rental',
    name: form.name.trim() || t('service.car_default_name'),
    price: form.price === '' ? null : Number(form.price),
    currency: form.currency || 'EUR',
    // Top-level UTC columns mirror details.pickup_at_local/dropoff_at_local -
    // used by get_pending_reminders to query upcoming car rentals without
    // scanning JSONB. Legacy *_at_local stays in details for backward
    // compatibility with older records and existing display paths.
    pickup_datetime:  form.pickup_at_local  ? localToUtc(form.pickup_at_local,  pickupTz)              : null,
    dropoff_datetime: form.dropoff_at_local ? localToUtc(form.dropoff_at_local, dropoffTz || pickupTz) : null,
    details: {
      pickup_at_local: form.pickup_at_local || undefined,
      pickup_address: form.pickup_address || undefined,
      pickup_latitude: form.pickup_latitude ?? undefined,
      pickup_longitude: form.pickup_longitude ?? undefined,
      pickup_timezone: form.pickup_timezone || undefined,
      dropoff_at_local: form.dropoff_at_local || undefined,
      dropoff_address: dropoffAddress || undefined,
      dropoff_latitude: dropoffLat ?? undefined,
      dropoff_longitude: dropoffLng ?? undefined,
      dropoff_timezone: dropoffTz || undefined,
      booking_reference: form.booking_reference || undefined,
      booking_url: normalizeExternalUrl(form.booking_url),
        documents: Array.isArray(form.documents) ? form.documents : [],
      price: undefined,
      currency: undefined,
      notes: form.notes || undefined,
    },
  };
}


// ─────────────────────────────────────────────────────────────────────────────
//  Section heading + colored-bar variant used inside the field groups
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ children }) {
  // Lumo form section header: coloured uppercase label + trailing rule.
  // Colour comes from the --hl set on the shell root — `.ev-dlg` in the
  // dialog branch, `.lp` in the panel branch (both get it from `evVars`).
  return <div className="f-sec">{children}</div>;
}


// ─────────────────────────────────────────────────────────────────────────────
//  Field groups per kind
// ─────────────────────────────────────────────────────────────────────────────

function HotelFields({ form, setField, aiFields, tz, setTime, issues, onTouch, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const color = TYPE_META.hotel.color;
  const st = (f) => fieldState(issues, f);
  // Filled-field counts drive the accordion badges (how many booking details /
  // documents are set without expanding the group).
  const bookingFilled = [form.booking_url, form.booking_reference, form.phone, form.email].filter(Boolean).length;
  const docCount = Array.isArray(form.documents) ? form.documents.length : 0;
  return (
    <>
      <div className="col col--g6">
        <div data-vfield="name">
          <Label field="name">{t('event.name')}</Label>
          <AiField active={aiFields.has('name')}>
            <Input {...st('name')} value={form.name} onChange={(e) => setField('name', e.target.value)} onBlur={() => onTouch?.('name')} placeholder={t('event.ph_hotel_example')} />
          </AiField>
          <FieldError issues={issues} field="name" />
        </div>
        <div>
          <Label>{t('event.address')}</Label>
          <AiField active={aiFields.has('address')}>
            <AddressAutocomplete
              value={form.address}
              onChange={(v) => setField('address', v)}
              onPlaceSelected={(p) => {
                setField('address', p.formatted_address || p.description || form.address);
                if (p.latitude != null) setField('latitude', p.latitude);
                if (p.longitude != null) setField('longitude', p.longitude);
              }}
              placeholder="Travessa das Merceeiras 27, Lisboa"
            />
          </AiField>
        </div>
      </div>

      {(() => {
        const ci = DateTime.fromISO(form.checkInLocal), co = DateTime.fromISO(form.checkOutLocal);
        const n = (ci.isValid && co.isValid) ? Math.max(0, Math.round(co.startOf('day').diff(ci.startOf('day'), 'days').days)) : 0;
        return (
          <DateRangeBlock
            label={t('event.stay_dates')} accent={color} issues={issues}
            startLabel={t('event.checkin')} startValue={form.checkInLocal} onStart={(v) => setField('checkInLocal', v)} onStartMissing={(v) => setTime('checkIn', v)} startVField="checkIn" startTz={tz} startAi={aiFields.has('checkInLocal')}
            endLabel={t('event.checkout')} endValue={form.checkOutLocal} onEnd={(v) => setField('checkOutLocal', v)} onEndMissing={(v) => setTime('checkOut', v)} endVField="checkOut" endTz={tz} endAi={aiFields.has('checkOutLocal')}
            midText={n > 0 ? t('fork.stay22_nights', { count: n }) : null}
          />
        );
      })()}

      {/* Price + currency + payment pills (design: "Стоимость за всё") */}
      <div className="eed-finance">
        <div className="hv-lbl">{t('event.price_total')}</div>
        <div className="grid grid--g4 eed-pricerow">
          <AiField active={aiFields.has('price')}>
            <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0" />
          </AiField>
          <AiField active={aiFields.has('currency')}>
            <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
          </AiField>
        </div>
        <AiField active={aiFields.has('payment_status')}>
          <Seg
            variant="fill"
            ariaLabel={t('event.payment_status')}
            value={form.payment_status}
            onChange={(v) => setField('payment_status', form.payment_status === v ? '' : v)}
            options={[
              { value: 'paid', label: t('event.paid') },
              { value: 'partial', label: t('event.partial') },
              { value: 'pay_on_arrival', label: t('event.on_arrival') },
            ]}
          />
        </AiField>
      </div>
      <AiField active={aiFields.has('free_cancellation')}>
        <SwitchRow
          on={!!form.free_cancellation}
          onChange={(v) => setField('free_cancellation', !!v)}
          title={t('event.free_cancel_have')}
          hint={t('event.free_cancel_hint')}
        >
          {form.free_cancellation && (
            <div className="eed-fcdate">
              <AiField active={aiFields.has('free_cancellation_until_local')}>
                <DateTimeInput
                  value={form.free_cancellation_until_local}
                  onChange={(v) => setField('free_cancellation_until_local', v)}
                  onTimeMissingChange={(v) => setTime('freeCancel', !!form.free_cancellation && v)}
                />
              </AiField>
              <TimezoneHint tz={tz} />
            </div>
          )}
        </SwitchRow>
      </AiField>

      <Accordion title={t('event.booking_details')} subtitle={t('event.booking_details_hint')} badge={bookingFilled}>
        <div className="fld-grid grid grid--2">
          <BookingUrlField
            value={form.booking_url}
            onChange={(e) => setField('booking_url', e.target.value)}
            aiActive={aiFields.has('booking_url')}
            t={t}
          />
          <div>
            <Label>{t('event.booking_ref')}</Label>
            <AiField active={aiFields.has('booking_reference')}>
              <Input className="t-mono" value={form.booking_reference} onChange={(e) => setField('booking_reference', e.target.value)} placeholder="-" />
            </AiField>
          </div>
        </div>
        <div className="fld-grid eed-accrow grid grid--2">
          <div>
            <Label>{t('event.phone')}</Label>
            <AiField active={aiFields.has('phone')}>
              <Input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+351 …" />
            </AiField>
          </div>
          <div>
            <Label>E-mail</Label>
            <AiField active={aiFields.has('email')}>
              <Input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="-" />
            </AiField>
          </div>
        </div>
      </Accordion>

      <Accordion title={t('event.docs_notes')} badge={docCount}>
        <AiField active={aiFields.has('documents')}>
          <DocumentsField
            value={form.documents}
            onChange={(docs) => setField('documents', docs)}
            onUploadingChange={setUploading}
            tripId={tripId}
            bare
          />
        </AiField>
        <div className="eed-accrow">
          <Label>{t('event.notes')}</Label>
          <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('event.notes_ph')} />
        </div>
      </Accordion>
    </>
  );
}

function TransferFields({ form, setField, setForm, aiFields, aiSegFields, setAiSegFields, fromVisit, toVisit, startTz, endTz, setTime, issues, onTouch, isEdit, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const color = TYPE_META.transfer.color;
  const docCount = Array.isArray(form.documents) ? form.documents.length : 0;
  return (
    <>
      {!isEdit && <LayoverToggle form={form} setForm={setForm} />}

      {form.hasLayovers ? (
        <SegmentsEditor form={form} setForm={setForm} fromVisit={fromVisit} toVisit={toVisit} setTime={setTime} color={color} aiSegFields={aiSegFields} setAiSegFields={setAiSegFields} issues={issues} onTouch={onTouch} />
      ) : (
        <TransferLegCard
          leg={form}
          patch={(p) => Object.entries(p).forEach(([k, v]) => setField(k, v))}
          aiHas={(f) => aiFields.has(f)}
          vf={(name) => name}
          onTimeMissing={(which, v) => setTime(which === 'dep' ? 'start' : 'end', v)}
          legNumber={null}
          isMulti={false}
          collapsible={false}
          fromName={fromVisit?.city_name || '-'}
          toName={toVisit?.city_name || '-'}
          toCityEditable={false}
          startTz={startTz}
          endTz={endTz}
          issues={issues}
          color={color}
          t={t}
        />
      )}

      {/* Booking link — shared across the whole transfer (not per leg; the mockup
          keeps only № брони on each card). Kept so the field is not dropped. */}
      <div style={{ marginTop: 14 }}>
        <BookingUrlField
          value={form.booking_url}
          onChange={(e) => setField('booking_url', e.target.value)}
          aiActive={aiFields.has('booking_url')}
          t={t}
        />
      </div>

      <Accordion title={t('event.docs_notes')} badge={docCount}>
        <AiField active={aiFields.has('documents')}>
          <DocumentsField
            value={form.documents}
            onChange={(docs) => setField('documents', docs)}
            onUploadingChange={setUploading}
            tripId={tripId}
            bare
          />
        </AiField>
        <div className="eed-accrow">
          <Label>{t('event.notes')}</Label>
          <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('event.notes_ph')} />
        </div>
      </Accordion>
    </>
  );
}

// ── Unified transfer leg card (mockup) — one renderer for the direct leg AND
// each layover segment. Works on a plain `leg` values object + a `patch(partial)`
// callback; the two call-sites (direct = flat form, layover = segment) adapt the
// AI-highlight check (`aiHas`), the validation field name (`vf`), and the
// time-missing key (`onTimeMissing`). No save-path changes — purely presentational.
function TransferLegCard({
  leg, patch, aiHas, vf, onTimeMissing,
  legNumber, isMulti, collapsible, open, onToggleOpen, onRemove,
  fromName, toName, toCityEditable, layoverCityPh,
  startTz, endTz, issues, color, t,
}) {
  const stF = (name) => fieldState(issues, vf(name));
  const tk = TRANSPORT_OF(leg.transport_type);
  const TIcon = tk.Icon;
  // Within-leg duration (departure → arrival) for the date-block hint —
  // same "minutes between two ISO locals, non-negative or null" as the layover gap.
  const durMin = layoverMins(leg.startLocal, leg.endLocal);
  const isOpen = collapsible ? open : true;
  // TRIP-186/343: сегмент «с пересадками» (isMulti) — поверхность-аккордеон, идёт
  // через `<Card radius="md" pad="none" className="acc">` (рамку/заливку/скругление/
  // обрезку держит Card + класс-остаток .acc). Одиночный (direct) трансфер оголён —
  // обычный div без скина. Носитель поэтому ДИНАМИЧЕСКИЙ (не-Card ветка без скина).
  const Seg = isMulti ? Card : 'div';
  const segProps = isMulti ? { radius: 'md', pad: 'none', className: 'acc' } : {};
  return (
    <Seg {...segProps}>
      {isMulti && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        <button type="button" onClick={collapsible ? onToggleOpen : undefined}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 11, background: 'transparent', border: 'none', cursor: collapsible ? 'pointer' : 'default', textAlign: 'left', padding: 0, minWidth: 0 }}>
          <span style={{ width: 34, height: 34, borderRadius: 'var(--r-sm)', flexShrink: 0, background: TYPE_META.transfer.soft, color, display: 'grid', placeItems: 'center' }}>
            <TIcon size={16} />
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="eyebrow" style={{ color, display: 'block' }}>{`${t('event.segment_n', { n: legNumber })} · ${t(tk.labelKey)}`}</span>
            <span className="t-ui" style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--ink)', marginTop: 2 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fromName}</span>
              <ArrowRight size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toName}</span>
            </span>
          </span>
          {collapsible && <span className="muted t-meta" style={{ flexShrink: 0 }}>{isOpen ? t('event.collapse') : t('event.expand')}</span>}
          {collapsible && <ChevronDown size={16} style={{ color: 'var(--muted)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />}
        </button>
        {onRemove && (
          <Btn variant="quiet" onClick={onRemove} title={t('event.remove_segment')} style={{ flexShrink: 0 }}>
            <Trash2 size={14} />
          </Btn>
        )}
      </div>
      )}

      <div style={{ display: isOpen ? 'block' : 'none', padding: isMulti ? '4px 14px 14px' : 0, borderTop: isMulti ? '1px solid var(--line)' : 'none' }}>
        {isMulti && <div style={{ height: 10 }} />}
        <div className="field__label" style={{ margin: '2px 0 8px', color }}>{t('event.transport_kind')}</div>
        <SegTransportGrid value={leg.transport_type} onChange={(k) => patch({ transport_type: k })} color={color} />

        {/* From / To — city (readonly endpoint, or layover picker) + address */}
        <div className="fld-grid grid grid--2" style={{ marginTop: 14 }}>
          <div>
            <div className="eed-fromto" style={{ color }}>{t('event.from')}</div>
            <div className="eed-accrow">
              <Label>{t('event.city')}</Label>
              <input className="input" value={fromName} readOnly tabIndex={-1} title={t('event.city_from_route_title')} />
            </div>
            <div className="eed-accrow">
              <Label>{t('event.addr_station')}</Label>
              <AiField active={aiHas('from_address')}>
                <AddressAutocomplete
                  value={leg.from_address}
                  onChange={(v) => patch({ from_address: v })}
                  onPlaceSelected={(p) => patch({ from_address: p.formatted_address || p.description || leg.from_address, ...(p.latitude != null ? { from_latitude: p.latitude } : {}), ...(p.longitude != null ? { from_longitude: p.longitude } : {}) })}
                  placeholder={t('event.addr_ph')}
                />
              </AiField>
            </div>
          </div>
          <div>
            <div className="eed-fromto" style={{ color }}>{t('event.to')}</div>
            <div className="eed-accrow" data-vfield={toCityEditable ? vf('toCity') : undefined}>
              <Label>{t('event.city')}</Label>
              {toCityEditable ? (
                <>
                  <AiField active={aiHas('toCity')}>
                    <CityPicker {...stF('toCity')} value={leg.toCity} onPick={(c) => patch({ toCity: c })} placeholder={layoverCityPh} />
                  </AiField>
                  <FieldError issues={issues} field={vf('toCity')} />
                </>
              ) : (
                <input className="input" value={toName} readOnly tabIndex={-1} title={t('event.city_arrival_title')} />
              )}
            </div>
            <div className="eed-accrow">
              <Label>{t('event.addr_station')}</Label>
              <AiField active={aiHas('to_address')}>
                <AddressAutocomplete
                  value={leg.to_address}
                  onChange={(v) => patch({ to_address: v })}
                  onPlaceSelected={(p) => patch({ to_address: p.formatted_address || p.description || leg.to_address, ...(p.latitude != null ? { to_latitude: p.latitude } : {}), ...(p.longitude != null ? { to_longitude: p.longitude } : {}) })}
                  placeholder={t('event.addr_ph')}
                />
              </AiField>
            </div>
          </div>
        </div>

        {/* Departure & arrival — bordered block (dates + duration + overnight) */}
        <DateRangeBlock
          style={{ marginTop: 14 }}
          label={t('event.dep_arr')} accent={color} issues={issues}
          startLabel={t('event.departure')} startValue={leg.startLocal} onStart={(v) => patch({ startLocal: v })} onStartMissing={(v) => onTimeMissing('dep', v)} startVField={vf('start')} startTz={startTz} startAi={aiHas('startLocal')}
          endLabel={t('event.arrival')} endValue={leg.endLocal} onEnd={(v) => patch({ endLocal: v })} onEndMissing={(v) => onTimeMissing('arr', v)} endVField={vf('end')} endTz={endTz} endAi={aiHas('endLocal')}
          midText={durMin != null ? fmtDur(durMin, t) : null}
        />
        {/* Overnight — DERIVED from the dates, not a user toggle. day_change is a pure
            function of (arrival day > departure day): the single bit recompute_trip
            reads to add the +1 arrival-day gap, so it must always equal the actual
            dates. Shown as a passive badge the moment the arrival date is a later day. */}
        {isOvernightLocal(leg.startLocal, leg.endLocal) && (
          <Card radius="md" className="row eed-nightrow">
            <span className="row row--g4 eed-nightrow__l">
              <Moon size={16} />
              <span className="t-ui">{t('event.overnight_label')}</span>
            </span>
          </Card>
        )}

        {/* Carrier / flight no. */}
        <div className="fld-grid grid grid--2" style={{ marginTop: 14 }}>
          <div>
            <Label>{t('event.carrier')}</Label>
            <AiField active={aiHas('carrier')}>
              <Input value={leg.carrier} onChange={(e) => patch({ carrier: e.target.value })} placeholder={t('event.carrier_ph')} />
            </AiField>
          </div>
          <div>
            <Label>{t('event.flight_train_no')}</Label>
            <AiField active={aiHas('flight_number')}>
              <Input className="t-mono" value={leg.flight_number} onChange={(e) => patch({ flight_number: e.target.value })} placeholder="TP 1379" /* i18n-ignore: пример формата номера рейса, не переводится */ />
            </AiField>
          </div>
        </div>
        {/* Booking ref / price + currency */}
        <div className="fld-grid eed-accrow grid grid--2">
          <div>
            <Label>{t('event.booking_ref')}</Label>
            <AiField active={aiHas('booking_reference')}>
              <Input className="t-mono" value={leg.booking_reference} onChange={(e) => patch({ booking_reference: e.target.value })} placeholder="-" />
            </AiField>
          </div>
          <div>
            <Label>{t('event.price')}</Label>
            <div style={{ display: 'flex', gap: 8 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <AiField active={aiHas('price')}>
                  <Input type="number" step="0.01" value={leg.price} onChange={(e) => patch({ price: e.target.value })} placeholder="0.00" />
                </AiField>
              </span>
              <span style={{ width: 104, flexShrink: 0 }}>
                <CurrencyCombobox value={leg.currency} onChange={(v) => patch({ currency: v })} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </Seg>
  );
}

// ── Layover (multi-segment) transfer UI ─────────────────────────────────────
function LayoverToggle({ form, setForm }) {
  const { t } = useI18nFormat();
  const enable = () => setForm((prev) => {
    const seg0 = { ...makeSegment(prev.currency), transport_type: prev.transport_type, from_address: prev.from_address, startLocal: prev.startLocal, carrier: prev.carrier, flight_number: prev.flight_number, booking_reference: prev.booking_reference, price: prev.price, currency: prev.currency };
    const seg1 = { ...makeSegment(prev.currency), to_address: prev.to_address, endLocal: prev.endLocal };
    return { ...prev, hasLayovers: true, segments: [seg0, seg1] };
  });
  const disable = () => setForm((prev) => {
    const segs = prev.segments || []; const first = segs[0] || {}; const last = segs[segs.length - 1] || {};
    return { ...prev, hasLayovers: false, segments: [], transport_type: first.transport_type || prev.transport_type, from_address: first.from_address || '', startLocal: first.startLocal || '', to_address: last.to_address || '', endLocal: last.endLocal || '', carrier: first.carrier || '', flight_number: first.flight_number || '', price: first.price || '', currency: first.currency || prev.currency, booking_reference: first.booking_reference || '' };
  });
  const n = (form.segments || []).length;
  return (
    <>
      <SectionHeader>{t('trip.sidebar_route')}</SectionHeader>
      {/* Direct / With-layovers switch — reuses the design-system .seg (+ shared
          .seg--fill), same primitive as the fork tabs. */}
      <Seg
        variant="fill"
        ariaLabel={t('trip.sidebar_route')}
        style={{ marginBottom: form.hasLayovers ? 8 : 14 }}
        value={form.hasLayovers ? 'layovers' : 'direct'}
        onChange={(v) => { if (v === 'layovers' && !form.hasLayovers) enable(); else if (v === 'direct' && form.hasLayovers) disable(); }}
        options={[
          { value: 'direct', label: t('event.route_direct') },
          { value: 'layovers', label: t('event.with_layovers') },
        ]}
      />
      {form.hasLayovers && (
        <div className="muted t-meta" style={{ marginBottom: 14 }}>{t('event.seg_count', { n, c: Math.max(0, n - 1) })}</div>
      )}
    </>
  );
}

// Helpers for the layover segment cards.
const TRANSPORT_OF = (id) => TRANSPORT_KINDS.find((k) => k.id === id) || TRANSPORT_KINDS[0];
const fmtLocalDate = (local) => {
  if (!local) return '';
  const [y, mo, da] = String(local).slice(0, 10).split('-');
  return (y && mo && da) ? `${da}.${mo}.${y}` : '';
};
const layoverMins = (arr, dep) => {
  if (!arr || !dep) return null;
  const a = DateTime.fromISO(arr), d = DateTime.fromISO(dep);
  if (!a.isValid || !d.isValid) return null;
  const m = Math.round(d.diff(a, 'minutes').minutes);
  return m >= 0 ? m : null;
};
const fmtDur = (m, t) => {
  const h = Math.floor(m / 60), mm = m % 60;
  const parts = [];
  if (h) parts.push(t('event.dur_h', { h }));
  if (mm || !h) parts.push(t('event.dur_m', { m: mm }));
  return parts.join(' ');
};
// Date-range block (TRIP-176 design): bordered block + 3-column summary card
// (start cell · arrow + duration/nights · end cell). Each cell is a clickable
// DateTimeInput trigger opening the shared calendar. Reused by hotel/transfer/
// activity so the layout stays identical across all three forms.
function DateRangeBlock({
  label, accent, midText, issues, style,
  startLabel, startValue, onStart, onStartMissing, startVField, startTz, startAi,
  endLabel, endValue, onEnd, onEndMissing, endVField, endTz, endAi,
}) {
  // Обязательность у каждого конца СВОЯ и адресуется своим токеном (у переезда с
  // пересадками это `seg0.start` и т.п.), поэтому спрашиваем по отдельности.
  const startRequired = useFieldRequired(startVField);
  const endRequired = useFieldRequired(endVField);
  // Состояние ПАРЫ «начало+конец» - теми же атрибутами, что и у одиночного поля,
  // только на блоке: цвет несёт рамка `.stay-dates` внутри, у самих ячеек её нет.
  // Day-tolerance warnings (TR_DEP_DAY / TR_ARR_DAY) land on these two fields;
  // a hard error on either end outranks them, so only one tint shows at a time.
  return (
    <div className="eed-dateblock" {...fieldState(issues, [startVField, endVField])} style={style}>
      {/* The badge marks the pair, the tint marks the end: <AiField> can't be
          used here because it would tint BOTH cells when only one came from the
          parse, and its badge would be clipped by `.stay-dates` (overflow:hidden
          for the rounded border). So the shared `.ai-filled` class stays on each
          cell and the shared <AiBadge> pins to this block, which does not clip. */}
      {(startAi || endAi) && <AiBadge />}
      <div className="eed-dateblock__lbl">{label}</div>
      <div className="stay-dates">
        <div className={`sd-cellwrap${startAi ? ' ai-filled' : ''}`} data-vfield={startVField}>
          <DateTimeInput variant="cell" cellLabel={startLabel} cellRequired={startRequired} value={startValue} onChange={onStart} onTimeMissingChange={onStartMissing} />
        </div>
        <div className="stay-dates__mid">
          <ArrowRight size={14} style={{ color: accent || 'var(--muted-2)' }} />
          {midText && <span className="t-meta">{midText}</span>}
        </div>
        <div className={`sd-cellwrap${endAi ? ' ai-filled' : ''}`} data-vfield={endVField}>
          <DateTimeInput variant="cell" cellLabel={endLabel} cellRequired={endRequired} value={endValue} onChange={onEnd} onTimeMissingChange={onEndMissing} />
        </div>
      </div>
      {(startTz || endTz) && (
        <div className="row row--g6 eed-drange-tz">
          <TimezoneHint tz={startTz} />
          <TimezoneHint tz={endTz} />
        </div>
      )}
      {startVField && <FieldError issues={issues} field={startVField} />}
      {endVField && <FieldError issues={issues} field={endVField} />}
    </div>
  );
}

function SegTransportGrid({ value, onChange, color }) {
  const { t } = useI18nFormat();
  return (
    <div className="grid grid--g4 eed-typegrid">
      {TRANSPORT_KINDS.map((k) => {
        const active = value === k.id; const Ic = k.Icon;
        return (
          <button key={k.id} type="button" className="t-meta" onClick={() => onChange(k.id)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 6px', background: active ? TYPE_META.transfer.soft : 'var(--surface)', border: '1px solid ' + (active ? color : 'var(--line)'), color: active ? color : 'var(--ink)', borderRadius: 'var(--r-sm)', cursor: 'pointer' }}>
            <Ic size={16} />{t(k.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function SegmentsEditor({ form, setForm, fromVisit, toVisit, setTime, color, aiSegFields, setAiSegFields, issues, onTouch }) {
  const { t } = useI18nFormat();
  const SEG_TOKEN = { startLocal: 'start', endLocal: 'end', toCity: 'toCity' };
  const segs = form.segments || [];
  const N = segs.length;
  const aiOn = (seg, field) => !!aiSegFields && aiSegFields.has(`${seg.id}.${field}`);
  const patchSeg = (i, partial) => {
    const id = segs[i]?.id;
    Object.keys(partial).forEach((k) => { if (SEG_TOKEN[k]) onTouch?.(`seg${i}.${SEG_TOKEN[k]}`); });
    setForm((prev) => ({ ...prev, segments: prev.segments.map((s, idx) => {
      if (idx !== i) return s;
      const merged = { ...s, ...partial };
      return merged;
    }) }));
    // Editing a field clears its AI highlight (mirrors single-leg setField).
    if (id && setAiSegFields) {
      setAiSegFields((prev) => {
        if (!prev || !prev.size) return prev;
        let next = null;
        Object.keys(partial).forEach((k) => {
          const key = `${id}.${k}`;
          if (prev.has(key)) { next = next || new Set(prev); next.delete(key); }
        });
        return next || prev;
      });
    }
  };
  const addSegment = () => setForm((prev) => {
    const ss = prev.segments; const last = ss[ss.length - 1];
    const reLast = { ...last, to_address: '', endLocal: '', toCity: null };
    const newFinal = { ...makeSegment(prev.currency), to_address: last.to_address, endLocal: last.endLocal };
    return { ...prev, segments: [...ss.slice(0, -1), reLast, newFinal] };
  });
  const removeSegment = (i) => setForm((prev) => (prev.segments.length <= 2 ? prev : { ...prev, segments: prev.segments.filter((_, idx) => idx !== i) }));

  // Expandable cards, COLLAPSED by default (TRIP-230) — a chain opened fully
  // expanded buries the route itself under stacked forms; a newly added segment
  // is no exception. A segment with an active error is always forced open so
  // the inline message can't be hidden.
  const [openMap, setOpenMap] = useState({});
  const segHasErr = (i) => (issues || []).some((it) => it.level === 'error' && typeof it.field === 'string' && it.field.startsWith(`seg${i}.`));
  const isOpen = (seg, i) => {
    if (segHasErr(i)) return true;
    if (openMap[seg.id] !== undefined) return openMap[seg.id];
    return false;
  };
  const toggleOpen = (seg, i) => setOpenMap((m) => ({ ...m, [seg.id]: !isOpen(seg, i) }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {segs.map((seg, i) => {
        const isFirst = i === 0; const isLast = i === N - 1;
        const fromName = isFirst ? (fromVisit?.city_name || '-') : (segs[i - 1].toCity?.city_name || '…');
        const toName = isLast ? (toVisit?.city_name || '-') : (seg.toCity?.city_name || '…');
        const open = isOpen(seg, i);
        const layCity = seg.toCity?.city_name || '…';
        const layDate = fmtLocalDate(seg.endLocal);
        const layMins = isLast ? null : layoverMins(seg.endLocal, segs[i + 1]?.startLocal);
        const layDur = layMins != null ? fmtDur(layMins, t) : '';
        return (
          <React.Fragment key={seg.id}>
            <TransferLegCard
              leg={seg}
              patch={(p) => patchSeg(i, p)}
              aiHas={(f) => aiOn(seg, f)}
              vf={(name) => `seg${i}.${name}`}
              onTimeMissing={(which, v) => setTime(`seg${i}-${which}`, v)}
              legNumber={i + 1}
              isMulti
              collapsible
              open={open}
              onToggleOpen={() => toggleOpen(seg, i)}
              onRemove={N > 2 ? () => removeSegment(i) : null}
              fromName={fromName}
              toName={toName}
              toCityEditable={!isLast}
              layoverCityPh={t('event.layover_city_ph')}
              startTz={undefined}
              endTz={undefined}
              issues={issues}
              color={color}
              t={t}
            />

            {!isLast && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                <span style={{ width: 1, height: 14, background: 'var(--line)', marginLeft: 16 }} />
                <span className="t-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 'var(--r-pill)', whiteSpace: 'nowrap', background: TYPE_META.transfer.soft, color }}>
                  <Repeat size={12} style={{ flexShrink: 0 }} />
                  {t('event.layover_in', { city: '' }).replace(/\s*$/, '')}&nbsp;<span>{layCity}</span>
                  {layDate && <span className="num" style={{ opacity: 0.7 }}>· {layDate}</span>}
                  {layDur && <span className="num" style={{ opacity: 0.7 }}>· {layDur}</span>}
                </span>
                <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* Плейсхолдер «добавить пересадку» — канон `<Btn variant="dashed">`. Цвет
          транспорта сохранён, но подан контекстным каналом (не инлайном): оболочки
          события несут `--hl` = цвет типа (`evVars`), а ховер `.btn--dashed` берёт
          `var(--a, var(--hl, var(--brand)))` (см. app.css) — своего `--a` тут нет,
          поэтому падаем на `--hl`. Прежний внешний отступ (marginTop) снят вместе с
          инлайном: спейсинг несёт сам ряд, отдельный per-screen отступ не нужен. */}
      <Btn variant="dashed" block onClick={addSegment}>{t('event.add_layover')}</Btn>
    </div>
  );
}

function ActivityFields({ form, setField, setForm, aiFields, tz, setTime, issues, onTouch, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const color = TYPE_META.activity.color;
  const st = (f) => fieldState(issues, f);
  const docCount = Array.isArray(form.documents) ? form.documents.length : 0;
  // Start → end duration for the date-block hint — the same helper the transfer
  // uses, so "end earlier than start" stays a blank hint here too instead of
  // reading "0 мин".
  const durMin = layoverMins(form.startLocal, form.endLocal);
  return (
    <>
      <div data-vfield="title">
        {/* Токен активности - `title` (у отеля и услуги то же поле зовётся
            `name`). Спрашивать надо ровно тем именем, которым валидатор метит
            ошибку, иначе на обязательном поле приходит «не обязательно». */}
        <Label field="title">{t('event.name')}</Label>
        <Input {...st('title')} value={form.title} onChange={(e) => setField('title', e.target.value)} onBlur={() => onTouch?.('title')} placeholder={t('event.ph_activity_example')} />
        <FieldError issues={issues} field="title" />
      </div>
      <div>
        <Label>{t('event.address')}</Label>
        <AddressAutocomplete
          value={form.location_address}
          onChange={(v) => setField('location_address', v)}
          onPlaceSelected={(p) => {
            setForm((prev) => ({
              ...prev,
              location_address: p.formatted_address || p.description || prev.location_address,
              location_latitude: p.latitude ?? prev.location_latitude,
              location_longitude: p.longitude ?? prev.location_longitude,
            }));
          }}
          placeholder="Rua do Norte 91, Lisboa"
        />
      </div>

      {/* Тот же блок дат, что у отеля и переезда (§5 ТЗ). Раньше у активности
          стояла СВОЯ сборка: одна общая дата + два голых `<input type="time">`,
          из-за чего у неё был свой скин `.sd-timeinput` и нативные виджеты
          времени, которые Chrome рисует по локали ОС. Модель не меняется -
          `startLocal`/`endLocal` как были, просто теперь у каждого конца свой
          полноценный выбор даты и времени, а не общая дата на двоих. */}
      <DateRangeBlock
        label={t('event.date_time')} accent={color} issues={issues}
        midText={durMin != null ? fmtDur(durMin, t) : null}
        startLabel={t('activity.start')} startValue={form.startLocal} onStart={(v) => setField('startLocal', v)} onStartMissing={(v) => setTime('start', v)} startVField="start" startTz={tz} startAi={aiFields.has('startLocal')}
        endLabel={t('event.end')} endValue={form.endLocal} onEnd={(v) => setField('endLocal', v)} onEndMissing={(v) => setTime('end', v)} endVField="end" endTz={tz} endAi={aiFields.has('endLocal')}
      />


      <SectionHeader color={color}>{t('event.cost')}</SectionHeader>
      <div className="fld-grid grid grid--2">
        <div>
          <Label>{t('event.price')}</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>{t('event.currency')}</Label>
          <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
        </div>
      </div>

      <Accordion title={t('event.docs_notes')} badge={docCount}>
        <DocumentsField
          value={form.documents}
          onChange={(docs) => setField('documents', docs)}
          onUploadingChange={setUploading}
          tripId={tripId}
          bare
        />
        <div className="eed-accrow">
          <Label>{t('event.notes')}</Label>
          <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('event.notes_ph')} />
        </div>
      </Accordion>
    </>
  );
}

function EsimServiceFields({ form, setField, issues, onTouch, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const st = (f) => fieldState(issues, f);
  return (
    <>
      <SectionHeader>{t('service.kind.esim')}</SectionHeader>
      <div data-vfield="name">
        <Label field="name">{t('service.name')}</Label>
        <Input {...st('name')} value={form.name} onChange={(e) => setField('name', e.target.value)} onBlur={() => onTouch?.('name')} placeholder={t('service.name_ph')} />
        <FieldError issues={issues} field="name" />
      </div>

      <SectionHeader>{t('service.esim_cost_section')}</SectionHeader>
      <div className="fld-grid grid grid--2">
        <div>
          <Label>{t('service.price')}</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>{t('service.currency')}</Label>
          <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
        </div>
      </div>

      <SectionHeader>{t('service.esim_docs_section')}</SectionHeader>
      <DocumentsField
        value={form.documents}
        onChange={(docs) => setField('documents', docs)}
        onUploadingChange={setUploading}
        tripId={tripId}
        bare
      />
      <div>
        <Label>{t('service.notes')}</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('service.esim_notes_ph')} />
      </div>
    </>
  );
}

function InsuranceServiceFields({ form, setField, issues, onTouch, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const st = (f) => fieldState(issues, f);
  return (
    <>
      <SectionHeader>{t('service.kind.insurance')}</SectionHeader>
      <div data-vfield="name">
        <Label field="name">{t('service.name')}</Label>
        <Input {...st('name')} value={form.name} onChange={(e) => setField('name', e.target.value)} onBlur={() => onTouch?.('name')} placeholder={t('service.name_ph')} />
        <FieldError issues={issues} field="name" />
      </div>

      <SectionHeader>{t('service.insurance_section')}</SectionHeader>
      <div>
        <Label>{t('service.policy_number')}</Label>
        <Input className="t-mono" value={form.policy_number} onChange={(e) => setField('policy_number', e.target.value)} placeholder={t('service.policy_number_ph')} />
      </div>
      <div className="fld-grid grid grid--2">
        <div data-vfield="date_start">
          <Label>{t('service.date_start')}</Label>
          {/* Не нативный `type="date"`: тот рисуется по локали ОС - см. DateTimeInput.jsx */}
          <DateTimeInput {...st('date_start')} withTime={false} value={form.date_start} onChange={(d) => setField('date_start', d)} />
        </div>
        <div data-vfield="date_finish">
          <Label>{t('service.date_finish')}</Label>
          <DateTimeInput {...st('date_finish')} withTime={false} value={form.date_finish} onChange={(d) => setField('date_finish', d)} />
          <FieldError issues={issues} field="date_finish" />
        </div>
      </div>

      <SectionHeader>{t('service.insurance_cost_section')}</SectionHeader>
      <div className="fld-grid grid grid--2">
        <div>
          <Label>{t('service.price')}</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>{t('service.currency')}</Label>
          <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
        </div>
      </div>

      <SectionHeader>{t('service.insurance_docs_section')}</SectionHeader>
      <DocumentsField
        value={form.documents}
        onChange={(docs) => setField('documents', docs)}
        onUploadingChange={setUploading}
        tripId={tripId}
        bare
      />
      <div>
        <Label>{t('service.notes')}</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('service.insurance_notes_ph')} />
      </div>
    </>
  );
}

function ServiceFields({ form, setField, setForm, aiFields, setTime, issues, onTouch, isEdit, setUploading, tripId }) {
  const svcKind = form.service_kind || 'car_rental';
  if (svcKind === 'esim') return <EsimServiceFields form={form} setField={setField} issues={issues} onTouch={onTouch} setUploading={setUploading} tripId={tripId} />;
  if (svcKind === 'insurance') return <InsuranceServiceFields form={form} setField={setField} issues={issues} onTouch={onTouch} setUploading={setUploading} tripId={tripId} />;
  return <CarRentalServiceFields form={form} setField={setField} setForm={setForm} aiFields={aiFields} setTime={setTime} issues={issues} onTouch={onTouch} isEdit={isEdit} setUploading={setUploading} tripId={tripId} />;
}

function CarRentalServiceFields({ form, setField, setForm, aiFields, setTime, issues, onTouch, isEdit, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const color = TYPE_META.service.color;
  const st = (f) => fieldState(issues, f);
  return (
    <>
      <SectionHeader color={color}>{t('event.car_section')}</SectionHeader>
      <div data-vfield="name">
        <Label field="name">{t('event.company_name')}</Label>
        <Input {...st('name')} value={form.name} onChange={(e) => setField('name', e.target.value)} onBlur={() => onTouch?.('name')} placeholder={t('event.ph_car_example')} />
        <FieldError issues={issues} field="name" />
      </div>

      <SectionHeader color={color}>{t('event.pickup')}</SectionHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div data-vfield="pickupAddress">
          {/* Одна подпись: обязательность зависит от создания/редактирования, но
              это знает валидатор, а не разметка (раньше тут была вилка по двум
              ключам, отличавшимся ровно звёздочкой). */}
          <Label field="pickupAddress">{t('event.pickup_addr')}</Label>
          <AddressAutocomplete
            {...st('pickupAddress')}
            value={form.pickup_address}
            onChange={(v) => setField('pickup_address', v)}
            onPlaceSelected={async (p) => {
              setForm((prev) => ({
                ...prev,
                pickup_address: p.formatted_address || p.description || prev.pickup_address,
                pickup_latitude: p.latitude ?? null,
                pickup_longitude: p.longitude ?? null,
                pickup_timezone: '',
              }));
              const tzResolved = tzFromCoords(p.latitude, p.longitude);
              if (tzResolved) setField('pickup_timezone', tzResolved);
            }}
            placeholder={t('event.ph_pickup_example')}
          />
          <FieldError issues={issues} field="pickupAddress" />
        </div>
        <div data-vfield="pickup">
          <Label>{t('event.date_time')}</Label>
          <DateTimeInput
            {...st('pickup')}
            value={form.pickup_at_local}
            onChange={(v) => setField('pickup_at_local', v)}
            onTimeMissingChange={(v) => setTime('pickup', v)}
          />
          <TimezoneHint tz={form.pickup_timezone} />
          <FieldError issues={issues} field="pickup" />
        </div>
      </div>

      <SectionHeader color={color}>{t('event.return_section')}</SectionHeader>
      <SwitchRow
        on={!!form.return_different_location}
        onChange={(v) => setField('return_different_location', !!v)}
        title={t('event.return_diff_place')}
        hint={form.return_different_location ? null : t('event.return_same_suffix')}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {form.return_different_location && (
          <div>
            <Label>{t('event.return_addr')}</Label>
            <AddressAutocomplete
              value={form.dropoff_address}
              onChange={(v) => setField('dropoff_address', v)}
              onPlaceSelected={async (p) => {
                setForm((prev) => ({
                  ...prev,
                  dropoff_address: p.formatted_address || p.description || prev.dropoff_address,
                  dropoff_latitude: p.latitude ?? null,
                  dropoff_longitude: p.longitude ?? null,
                  dropoff_timezone: '',
                }));
                const tzResolved = tzFromCoords(p.latitude, p.longitude);
                if (tzResolved) setField('dropoff_timezone', tzResolved);
              }}
              placeholder={t('event.ph_return_example')}
            />
          </div>
        )}
        <div data-vfield="dropoff">
          <Label>{t('event.date_time_return')}</Label>
          <DateTimeInput
            {...st('dropoff')}
            value={form.dropoff_at_local}
            onChange={(v) => setField('dropoff_at_local', v)}
            onTimeMissingChange={(v) => setTime('dropoff', v)}
          />
          <TimezoneHint tz={form.return_different_location ? form.dropoff_timezone : form.pickup_timezone} />
          <FieldError issues={issues} field="dropoff" />
        </div>
      </div>

      <SectionHeader color={color}>{t('event.finance_booking')}</SectionHeader>
      <div className="fld-grid grid grid--2">
        <div>
          <Label>{t('event.price')}</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>{t('event.currency')}</Label>
          <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
        </div>
      </div>
      <div className="fld-grid grid grid--2">
        <BookingUrlField
          value={form.booking_url}
          onChange={(e) => setField('booking_url', e.target.value)}
          aiActive={aiFields.has('booking_url')}
          t={t}
        />
        <div>
          <Label>{t('event.booking_ref')}</Label>
          <Input className="t-mono" value={form.booking_reference} onChange={(e) => setField('booking_reference', e.target.value)} placeholder="-" />
        </div>
      </div>

      <SectionHeader color={color}>{t('event.docs_notes')}</SectionHeader>
      <DocumentsField
        value={form.documents}
        onChange={(docs) => setField('documents', docs)}
        onUploadingChange={setUploading}
        tripId={tripId}
        bare
      />
      <div>
        <Label>{t('event.notes')}</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('event.notes_ph_car')} />
      </div>
    </>
  );
}
