/**
 * EventEditDialog - unified create/edit modal (Lumo `.ev-dlg`) for ALL kinds:
 * hotel / transfer / activity, and every service subtype
 * (car_rental / esim / insurance). It is the single edit engine — the legacy
 * per-kind dialogs (Hotel/Transfer/Activity/CarRental/Esim/Insurance) are gone.
 *
 * One shared chrome (tinted header + body + footer), themed per kind/subtype via
 * `meta` (TYPE_META / SERVICE_META → --ev-color/--ev-soft/--ev-ink). Each kind
 * renders its own field group; service dispatches on form.service_kind.
 *
 * Shells: `variant="dialog"` = Radix Dialog overlay (app-wide modal, auto
 * bottom-sheet ≤640px). `variant="panel"` = same content inline for the
 * trip-editor left panel (hotel/transfer create/edit live here).
 *
 * Visual reference: EVENTS_SERVICES_REDESIGN_LUMO design system.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DialogRoot as Dialog, DialogContent, CurrencyCombobox, AiField, Toggle, useToast } from '@/design/index';
import {
  Loader2, Trash2, ExternalLink, ChevronDown, ArrowRight, Repeat, ArrowLeft, X,
  Plane, Car as CarIcon, Train, Bus, Ship, Footprints, Moon, ShieldCheck,
  BedDouble, Ticket,
} from 'lucide-react';
import { CardSim } from '@/design/icons';
import { DateTime } from 'luxon';

// ── Design-system form primitives ──────────────────────────────────────────
// Thin shims that render the app's design-system markup (.input/.field__label/
// .textarea) while accepting the same props the field groups already pass, so
// the form JSX is ported to the design system without touching its logic.
function Label({ children, className = '' }) {
  return <label className={`field__label ${className}`} style={{ display: 'block', marginBottom: 5 }}>{children}</label>;
}
function Input({ className = '', ...p }) {
  return <input className={`input ${className}`} {...p} />;
}
function Textarea({ className = '', ...p }) {
  return <textarea className={`textarea ${className}`} {...p} />;
}
function Checkbox({ checked, onCheckedChange, className = '' }) {
  return (
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      className={className}
      style={{ width: 16, height: 16, accentColor: 'var(--brand)', cursor: 'pointer', flexShrink: 0 }}
    />
  );
}

// City autocomplete for layover (waypoint) cities — resolves a full city object
// (coords + IANA timezone) so the saved waypoint city_visit has real geo data.
// Thin facade over the shared <Autocomplete> engine (identical field/dropdown/
// scroll/hover as every other city & address picker).
function CityPicker({ value, onPick, placeholder }) {
  const { t } = useI18nFormat();
  const [q, setQ] = useState(value?.city_name || '');
  useEffect(() => { setQ(value?.city_name || ''); }, [value?.city_name]);
  return (
    <Autocomplete
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
      iconActive={!!value}
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
    price: '', currency: defCur, toCity: null, day_change: false,
  };
}

import { supabase } from '@/api/supabaseClient';
import { searchCities, resolveCities, geocodeAddress } from '@/lib/geo';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localToUtc, utcToLocalInput } from '@/lib/time';
import { validateEntity, transferAiCityAdvisories } from '@/lib/validation';
import { FieldError, IssuesPanel, fieldHasError } from '@/components/common/ValidationUI';
import { faviconUrl, hostnameFromUrl } from '@/lib/booking-platforms';
import { getEntityDocuments, getDetailsDocuments } from '@/lib/documents';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { ENTITY_TABLE_BY_KIND, deleteSourceEntity } from '@/lib/trip-entities';
import { invalidateTripData, optimisticContentUpdate, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { tzFromCoords } from '@/lib/timezone';
import './EventEditDialog.css';

// Ensure a user-entered URL like "booking.com" opens absolutely (otherwise the
// browser treats it as relative and prepends the current app path → /trip/.../booking.com).
const withScheme = (u) => {
  if (!u) return u;
  const s = String(u).trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
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
            value={value}
            onChange={onChange}
            placeholder="https://..."
            className={logo ? 'eed-in--logo' : ''}
          />
        </div>
      </AiField>
      {value && (
        <div className="eed-bkmeta">
          <span className="eed-bkpill">
            {logo && <img src={logo} alt="" className="eed-bkpill__logo" />}
            {label}
          </span>
          <a href={withScheme(value)} target="_blank" rel="noreferrer" className="eed-bkopen">
            <ExternalLink size={12} />{t('common.open')}
          </a>
        </div>
      )}
    </div>
  );
}
import { useI18nFormat, useI18n } from '@/lib/i18n/I18nContext';

import DateTimeInput from '@/components/common/DateTimeInput';
import TimezoneHint from '@/components/common/TimezoneHint';
import DocumentsField from '@/components/common/DocumentsField';
import Accordion from '@/components/common/Accordion';
import AddressAutocomplete from '@/components/common/AddressAutocomplete';
import Autocomplete from '@/components/common/Autocomplete';
import cityOptionRow from '@/components/common/cityOptionRow';
import EventAiBlock from '@/components/common/EventAiBlock';
import ProUpsellModal from '@/components/common/ProUpsellModal';

// ─────────────────────────────────────────────────────────────────────────────
//  Type metadata - colours, icons, copy
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_META = {
  hotel: {
    color: 'var(--ev-hotel)', soft: 'var(--ev-hotel-soft)', ink: 'var(--ev-hotel-ink)',
    Icon: BedDouble, labelKey: 'event.type_hotel',
    titleNewKey: 'event.title_new_hotel', titleEditKey: 'event.title_edit_hotel',
  },
  transfer: {
    color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)',
    Icon: Plane, labelKey: 'event.type_transfer',
    titleNewKey: 'event.title_new_transfer', titleEditKey: 'event.title_edit_transfer',
  },
  activity: {
    color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)',
    Icon: Ticket, labelKey: 'event.type_activity',
    titleNewKey: 'event.title_new_activity', titleEditKey: 'event.title_edit_activity',
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

const TRANSPORT_KINDS = [
  { id: 'plane', Icon: Plane,      labelKey: 'event.tk_plane' },
  { id: 'train', Icon: Train,      labelKey: 'event.tk_train' },
  { id: 'bus',   Icon: Bus,        labelKey: 'event.tk_bus' },
  { id: 'car',   Icon: CarIcon,    labelKey: 'event.tk_car' },
  { id: 'ferry', Icon: Ship,       labelKey: 'event.tk_ferry' },
  { id: 'walk',  Icon: Footprints, labelKey: 'event.tk_walk' },
];

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
    // Overnight / day-change: this leg crosses into the next day, so the
    // destination city (and all following) shift +1 in the trip editor.
    day_change: false,
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
    day_change: !!tr.day_change,
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
  // City-contextual header: "Проживание в Париже" / "Переезд Париж → Рим" /
  // "Активность в Риме". Falls back to the generic new/edit title when the
  // city context is unknown (e.g. orphan entity or service without a visit).
  const ctxTitle = useMemo(() => {
    if ((currentKind === 'hotel' || currentKind === 'activity') && visit?.city_name) {
      return t(currentKind === 'hotel' ? 'event.title_ctx_hotel' : 'event.title_ctx_activity', { city: visit.city_name });
    }
    if (currentKind === 'transfer' && (fromVisit?.city_name || toVisit?.city_name)) {
      return t('event.title_ctx_transfer', { from: fromVisit?.city_name || '?', to: toVisit?.city_name || '?' });
    }
    return null;
  }, [currentKind, visit, fromVisit, toVisit, t]);
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
  const [tripProInfoOpen, setTripProInfoOpen] = useState(false);

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

  // Hybrid error display: inline error/border appears once a field is TOUCHED;
  // the summary panel appears only after a SAVE attempt. Fresh form stays clean.
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
    setAiFields(new Set());    setAiSegFields(new Set()); setAiAdvisories([]);
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
    supabase.functions.invoke('checkSubscriptionStatus', { body: { tripId } })
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
    setAiFields(new Set());    setAiSegFields(new Set()); setAiAdvisories([]);
    setTimeMissing({});
    setTouched(new Set()); setSubmitted(false);
  };

  const openUpgrade = () => {
    // Only the owner can upgrade this trip → checkout. A participant can't unlock
    // someone else's trip by paying, so show the "ask the owner" dialog instead.
    if (!isOwner) { setTripProInfoOpen(true); return; }
    onOpenChange?.(false);
    nav(`/pro?tripId=${tripId || ''}`);
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

  // Every validation verdict is ADVISORY now: errors are downgraded to 'warn' so
  // they surface (inline + summary) but never block saving — matching the trip
  // editor (e.g. a transfer whose dates don't line up with its cities still saves).
  const issues = useMemo(
    () => validateEntity(currentKind, vdraft, vctx).map((i) => ({ ...i, level: 'warn' })),
    [currentKind, vdraft, vctx],
  );

  // Auto-mark a single transfer as overnight when its arrival calendar day is
  // after its departure day (raise-only — the user can still switch it off).
  useEffect(() => {
    if (currentKind !== 'transfer' || form.hasLayovers || form.day_change) return;
    const sd = (form.startLocal || '').slice(0, 10), ed = (form.endLocal || '').slice(0, 10);
    if (sd && ed && ed > sd) setForm((f) => ({ ...f, day_change: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKind, form.hasLayovers, form.startLocal, form.endLocal]);

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
  // Validation never blocks; only genuinely incomplete input does (a half-entered
  // time that would persist as garbage) or an in-flight file upload.
  const canSave = useMemo(
    () => !uploading && !anyTimeMissing,
    [uploading, anyTimeMissing],
  );

  // Hybrid display: inline issues show for touched fields (or after a save attempt);
  // the summary panel only after a save attempt.
  const displayIssues = useMemo(
    () => issues.filter((i) => submitted || (i.field && touched.has(i.field))),
    [issues, submitted, touched],
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
        const { error } = await supabase.from(table).insert({ ...payload, created_by: user?.id });
        if (error) throw error;
        invalidateTripData(qc, tripId);
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
      // Files detached during this edit (present originally, gone from the saved
      // form) are now orphaned — sweep them best-effort (TRIP-117).
      committedRef.current = true;
      const finalPaths = new Set(collectDocPaths(form.documents));
      removeTripFiles(originalDocPaths.current.filter((p) => !finalPaths.has(p)));
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
      const { error } = await deleteSourceEntity(currentKind, entity.id, [...seenDocPaths.current]);
      if (error) throw error;
    },
    onSuccess: () => {
      committedRef.current = true;
      if (tripId) invalidateTripData(qc, tripId);
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: t('event.delete_failed'),
        description: err?.message || String(err),
        variant: 'destructive',
      });
    },
  });

  // ── AI extract handlers ────────────────────────────────────────────────
  const handleHotelExtract = async (data, fileUrl, fileName) => {
    const filled = new Set();
    const upd = { ...form };
    // Drop literal "N/A" the LLM emits for absent fields (it otherwise lands as
    // garbage text in booking_reference/phone/email…). TRIP-75.
    const setIf = (k, v) => { if (v != null && v !== '' && v !== 'N/A') { upd[k] = v; filled.add(k); } };
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
    if (data.free_cancellation_until && data.free_cancellation_until !== 'N/A') {
      upd.free_cancellation_until_local = data.free_cancellation_until.replace(' ', 'T').slice(0, 16);
      filled.add('free_cancellation_until_local');
    }
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
      const formSegs = segs.map((s) => ({
        ...makeSegment(s.currency || data.currency || 'EUR'),
        transport_type: normType(s.transport_type),
        from_address: s.from_address || '',
        to_address: s.to_address || '',
        startLocal: s.departure_date ? combine(s.departure_date, s.departure_time) : '',
        endLocal: s.arrival_date ? combine(s.arrival_date, s.arrival_time) : '',
        // Auto-flag overnight per segment: AI gave an arrival date later than departure.
        day_change: !!(s.departure_date && s.arrival_date && s.arrival_date > s.departure_date),
        carrier: s.carrier || '',
        flight_number: s.flight_number || '',
        booking_reference: s.booking_reference || '',
        price: typeof s.price === 'number' ? String(s.price) : (s.price || ''),
        currency: s.currency || data.currency || 'EUR',
        toCity: null,
      }));
      // Resolve the intermediate layover cities (to_city of all but the last leg)
      // to full city objects (coords + tz) so saveLayoverChain can create
      // waypoints. ONE batch call (TRIP-145 P2): dedup + shared cache + token-
      // bucket safe. Names that don't resolve surface as an advisory instead of a
      // silent null — the user then picks the layover city manually.
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

      const topFilled = new Set();
      if (data.booking_url) topFilled.add('booking_url');

      setForm((prev) => ({
        ...prev,
        hasLayovers: true,
        segments: formSegs,
        booking_url: data.booking_url || prev.booking_url,
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
    const setIf = (k, v) => { if (v != null && v !== '') { upd[k] = v; filled.add(k); } };
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
    // Overnight: AI parsed an arrival date later than the departure date → flag it
    // explicitly at parse time (the form effect is a backup for manual date entry).
    if (first.departure_date && first.arrival_date && first.arrival_date > first.departure_date) upd.day_change = true;
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
  // Editor panel uses the Lumo `.lp` shell; the app-wide modal uses `.ev-dlg`.
  // Body content (AI block + fields + IssuesPanel) is identical for both.
  const isPanel = variant === 'panel' || embedded;
  const bodyCls = isPanel ? 'lp-b scrollbar-thin' : 'ev-dlg-body';
  const title = ctxTitle || (isEdit ? t(meta.titleEditKey) : t(meta.titleNewKey));

  const inner = (
    <>
          {/* Header — hidden when embedded (AddBookingPanel owns the shared header). */}
          {embedded ? null : isPanel ? (
            <div className="lp-h lp-h--ev">
              <button className="lp-back" onClick={() => onOpenChange?.(false)} title={t('common.back')}>
                <ArrowLeft style={{ width: 14, height: 14 }} />
              </button>
              <span className="lp-ic" style={{ background: meta.color, color: '#fff' }}><meta.Icon /></span>
              <div className="lp-ti">
                <b>{title}</b>
                <span>{t(meta.labelKey)}</span>
              </div>
            </div>
          ) : (
            <div className="ev-dlg-hd">
              <div className="ev-dlg-ic"><meta.Icon /></div>
              <div className="ev-dlg-info">
                <div className="ev-dlg-eyebrow">{t(meta.labelKey)}</div>
                <h2>{title}</h2>
              </div>
              <button className="ev-dlg-close" onClick={() => onOpenChange(false)} aria-label={t('common.cancel')}>
                <X style={{ width: 15, height: 15 }} />
              </button>
            </div>
          )}

          {/* Inline delete-confirm view - replaces the form when active to
              avoid nesting Radix modals (which would intercept pointer
              events on the inner buttons). */}
          {confirmDel ? (
            <div className={bodyCls}>
              <div className="del-confirm">
                <div className="del-confirm-ic"><Trash2 style={{ width: 20, height: 20 }} /></div>
                <div>
                  <div className="t-ui">{t('event.delete_q', { label: t(meta.labelKey).toLowerCase() })}</div>
                  <div className="t-meta" style={{ color: 'var(--muted)', marginTop: 4 }}>{t('event.delete_irreversible')}</div>
                </div>
              </div>
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
                onReset={() => { setAiFields(new Set()); setAiSegFields(new Set()); setAiAdvisories([]); }}
              />
            )}

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
                  isEdit={isEdit}
                  setUploading={setUploading}
                  tripId={tripId}
                />
              )}

              {/* Summary panel: shown only after a save attempt (hybrid). Click row -> field. */}
              <IssuesPanel issues={[...(submitted ? issues : []), ...aiAdvisories]} style={{ marginTop: 12 }} />
            </fieldset>
          </div>
          )}

          {/* Footer — pinned to the bottom of the column in panel mode */}
          <div
            className={(isPanel ? 'lp-f' : 'ev-dlg-ft') + ' lp-f--edit'}
            style={isPanel ? { position: 'sticky', bottom: 0, zIndex: 3 } : undefined}
          >
            {confirmDel ? (
              <>
                <div style={{ flex: 1 }} />
                <button className="btn btn--secondary" onClick={() => setConfirmDel(false)} disabled={deleteMut.isPending}>
                  {t('common.cancel')}
                </button>
                <button
                  className="btn btn--danger-solid"
                  onClick={() => deleteMut.mutate()}
                  disabled={deleteMut.isPending}
                >
                  {deleteMut.isPending && <Loader2 className="spin" size={12} style={{ marginRight: 6 }} />}
                  <Trash2 size={14} style={{ marginRight: 6 }} />{t('common.delete')}
                </button>
              </>
            ) : (
              <>
                {isEdit && (
                  <button
                    className="btn btn--danger-ghost ev-del"
                    onClick={() => setConfirmDel(true)}
                    disabled={deleteMut.isPending}
                    aria-label={t('common.delete')}
                    title={t('common.delete')}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <button className="btn btn--secondary" onClick={() => onOpenChange(false)}>{t('common.cancel')}</button>
                <button
                  className="btn btn--primary ev-save"
                  onClick={handleSaveClick}
                  disabled={uploading || saveMut.isPending}
                  aria-disabled={!canSave}
                  style={{ '--bg': meta.color, opacity: canSave ? 1 : 0.6 }}
                >
                  {saveMut.isPending && <Loader2 className="spin" size={12} style={{ marginRight: 6 }} />}
                  {isEdit ? t('common.save') : t('event.create')}
                </button>
              </>
            )}
          </div>
    </>
  );

  const evVars = { '--ev-color': meta.color, '--ev-soft': meta.soft, '--ev-ink': meta.ink || meta.color };

  // TRIP-176: embedded — body + footer only (no .lp shell / header). The
  // AddBookingPanel wrapper provides the .lp shell + shared header + tabs.
  if (embedded) return inner;

  return (
    <>
      {variant === 'panel' ? (
        <div className="te-edit-panel-body lp lp--wide" style={{ ...evVars, minHeight: 0, height: '100%', background: 'var(--surface)' }}>
          {inner}
        </div>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="dlg--wide ev-dlg" style={{ ...evVars, padding: 0 }}>
            {inner}
          </DialogContent>
        </Dialog>
      )}

      <ProUpsellModal
        open={tripProInfoOpen}
        mode={isOwner ? 'upgrade' : 'info'}
        onOpenChange={setTripProInfoOpen}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Payload builders - one per kind. Mirrors the legacy dialogs' columns plus
//  the new lat/lng + flight_number additions.
// ─────────────────────────────────────────────────────────────────────────────

async function upsert(table, entity, payload, user) {
  if (entity) {
    const { data, error } = await supabase.from(table).update(payload).eq('id', entity.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from(table).insert({ ...payload, created_by: user?.id }).select().single();
  if (error) throw error;
  return data;
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
    booking_url: form.booking_url || null,
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
    day_change: !!form.day_change,
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
    booking_url: form.booking_url || null,
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
      country: c.country || null,
      country_code: c.country_code || null,
      latitude: c.latitude ?? null,
      longitude: c.longitude ?? null,
      timezone: c.timezone || 'UTC',
    });
  }

  // One leg per segment. Booking link is shared; documents/notes ride the first leg.
  const segments = segs.map((s, i) => ({
    transport_type: s.transport_type,
    day_change: !!s.day_change,
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
    booking_url: form.booking_url || null,
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
      booking_url: form.booking_url || null,
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
  // Colour comes from the --ev-color set on the .ev-dlg root.
  return <div className="f-sec">{children}</div>;
}


// ─────────────────────────────────────────────────────────────────────────────
//  Field groups per kind
// ─────────────────────────────────────────────────────────────────────────────

function HotelFields({ form, setField, aiFields, tz, setTime, issues, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const color = TYPE_META.hotel.color;
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
  // Filled-field counts drive the accordion badges (how many booking details /
  // documents are set without expanding the group).
  const bookingFilled = [form.booking_url, form.booking_reference, form.phone, form.email].filter(Boolean).length;
  const docCount = Array.isArray(form.documents) ? form.documents.length : 0;
  return (
    <>
      <SectionHeader color={color}>{t('event.hotel_about')}</SectionHeader>
      <div className="eed-stack">
        <div data-vfield="name" className={inv('name')}>
          <Label>{t('event.name_req')}</Label>
          <AiField active={aiFields.has('name')}>
            <Input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Memmo Alfama" />
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

      <div className="eed-dateblock">
        <div className="eed-dateblock__lbl t-ui">{t('event.stay_dates')}</div>
        <div className="fld-grid">
          <div className={`eed-minw0 ${inv('checkIn')}`} data-vfield="checkIn">
            <Label>{t('event.checkin_req')}</Label>
            <AiField active={aiFields.has('checkInLocal')}>
              <DateTimeInput
                value={form.checkInLocal}
                onChange={(v) => setField('checkInLocal', v)}
                onTimeMissingChange={(v) => setTime('checkIn', v)}
              />
            </AiField>
            <TimezoneHint tz={tz} />
            <FieldError issues={issues} field="checkIn" />
          </div>
          <div className={`eed-minw0 ${inv('checkOut')}`} data-vfield="checkOut">
            <Label>{t('event.checkout_req')}</Label>
            <AiField active={aiFields.has('checkOutLocal')}>
              <DateTimeInput
                value={form.checkOutLocal}
                onChange={(v) => setField('checkOutLocal', v)}
                onTimeMissingChange={(v) => setTime('checkOut', v)}
              />
            </AiField>
            <TimezoneHint tz={tz} />
            <FieldError issues={issues} field="checkOut" />
          </div>
        </div>
        {(() => {
          const ci = DateTime.fromISO(form.checkInLocal), co = DateTime.fromISO(form.checkOutLocal);
          const n = (ci.isValid && co.isValid) ? Math.max(0, Math.round(co.startOf('day').diff(ci.startOf('day'), 'days').days)) : 0;
          return n > 0 ? <DateSubline>{t('fork.stay22_nights', { count: n })}</DateSubline> : null;
        })()}
      </div>

      <SectionHeader color={color}>{t('event.finance_cancel')}</SectionHeader>
      <div className="eed-grid3">
        <div>
          <Label>{t('event.price')}</Label>
          <AiField active={aiFields.has('price')}>
            <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
          </AiField>
        </div>
        <div>
          <Label>{t('event.currency')}</Label>
          <AiField active={aiFields.has('currency')}>
            <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
          </AiField>
        </div>
        <div>
          <Label>{t('event.payment_status')}</Label>
          <AiField active={aiFields.has('payment_status')}>
            {/* Segmented pills (design) — reuse .seg; click active pill to clear. */}
            <div className="seg seg--fill" role="group" aria-label={t('event.payment_status')}>
              {[['paid', 'event.paid'], ['partial', 'event.partial'], ['pay_on_arrival', 'event.on_arrival']].map(([v, k]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={form.payment_status === v}
                  onClick={() => setField('payment_status', form.payment_status === v ? '' : v)}
                >
                  {t(k)}
                </button>
              ))}
            </div>
          </AiField>
        </div>
      </div>
      <AiField active={aiFields.has('free_cancellation')}>
        <div className="eed-fcbox">
          <div className="eed-fclabel">
            <Toggle on={!!form.free_cancellation} onChange={(v) => setField('free_cancellation', !!v)} label={t('event.free_cancel_have')} />
            <div className="eed-fcbody">
              <div className="eed-fctitle">{t('event.free_cancel_have')}</div>
              <div className="eed-fchint">{t('event.free_cancel_hint')}</div>
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
            </div>
          </div>
        </div>
      </AiField>

      <Accordion title={t('event.booking_details')} subtitle={t('event.booking_details_hint')} badge={bookingFilled}>
        <div className="fld-grid">
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
        <div className="fld-grid eed-accrow">
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
  const invF = (name) => (fieldHasError(issues, vf(name)) ? 'tv-invalid' : '');
  const tk = TRANSPORT_OF(leg.transport_type);
  const TIcon = tk.Icon;
  // Within-leg duration (departure → arrival) for the date-block hint —
  // same "minutes between two ISO locals, non-negative or null" as the layover gap.
  const durMin = layoverMins(leg.startLocal, leg.endLocal);
  const isOpen = collapsible ? open : true;
  return (
    <div style={{ border: '1px solid var(--line-2)', borderRadius: 12, background: 'var(--wash-2)', overflow: 'hidden' }}>
      {/* Card header — icon, route, collapse chevron (multi only), remove (multi>2) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        <button type="button" onClick={collapsible ? onToggleOpen : undefined}
          style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 11, background: 'transparent', border: 'none', cursor: collapsible ? 'pointer' : 'default', textAlign: 'left', padding: 0, minWidth: 0 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: TYPE_META.transfer.soft, color, display: 'grid', placeItems: 'center' }}>
            <TIcon size={16} />
          </span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span className="eyebrow" style={{ color, display: 'block' }}>{isMulti ? `${t('event.segment_n', { n: legNumber })} · ${t(tk.labelKey)}` : t(tk.labelKey)}</span>
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
          <button type="button" className="btn btn--quiet btn--sm" onClick={onRemove} title={t('event.remove_segment')} style={{ flexShrink: 0 }}>
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div style={{ display: isOpen ? 'block' : 'none', padding: '4px 14px 14px', borderTop: '1px solid var(--line-2)' }}>
        <div style={{ height: 10 }} />
        <div className="eyebrow" style={{ margin: '2px 0 8px', color }}>{t('event.transport_kind')}</div>
        <SegTransportGrid value={leg.transport_type} onChange={(k) => patch({ transport_type: k })} color={color} />

        {/* From / To — city (readonly endpoint, or layover picker) + address */}
        <div className="fld-grid" style={{ marginTop: 14 }}>
          <div>
            <div className="eed-fromto" style={{ color }}>{t('event.from')}</div>
            <div className="eed-accrow">
              <Label>{t('event.city')}</Label>
              <input className="input" value={fromName} readOnly tabIndex={-1} style={{ background: 'var(--wash)', color: 'var(--ink-2)', cursor: 'default' }} title={t('event.city_from_route_title')} />
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
            <div className={`eed-accrow ${toCityEditable ? invF('toCity') : ''}`} data-vfield={toCityEditable ? vf('toCity') : undefined}>
              <Label>{t('event.city')}</Label>
              {toCityEditable ? (
                <>
                  <AiField active={aiHas('toCity')}>
                    <CityPicker value={leg.toCity} onPick={(c) => patch({ toCity: c })} placeholder={layoverCityPh} />
                  </AiField>
                  <FieldError issues={issues} field={vf('toCity')} />
                </>
              ) : (
                <input className="input" value={toName} readOnly tabIndex={-1} style={{ background: 'var(--wash)', color: 'var(--ink-2)', cursor: 'default' }} title={t('event.city_arrival_title')} />
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
        <div className="eed-dateblock" style={{ marginTop: 14 }}>
          <div className="eed-dateblock__lbl t-ui">{t('event.dep_arr')}</div>
          <div className="fld-grid">
            <div className={`eed-minw0 ${invF('start')}`} data-vfield={vf('start')}>
              <Label>{t('event.departure_req')}</Label>
              <AiField active={aiHas('startLocal')}>
                <DateTimeInput value={leg.startLocal} onChange={(v) => patch({ startLocal: v })} onTimeMissingChange={(v) => onTimeMissing('dep', v)} />
              </AiField>
              <TimezoneHint tz={startTz} />
              <FieldError issues={issues} field={vf('start')} />
            </div>
            <div className={`eed-minw0 ${invF('end')}`} data-vfield={vf('end')}>
              <Label>{t('event.arrival_req')}</Label>
              <AiField active={aiHas('endLocal')}>
                <DateTimeInput value={leg.endLocal} onChange={(v) => patch({ endLocal: v })} onTimeMissingChange={(v) => onTimeMissing('arr', v)} />
              </AiField>
              <TimezoneHint tz={endTz} />
              <FieldError issues={issues} field={vf('end')} />
            </div>
          </div>
          {durMin != null && <DateSubline>{fmtDur(durMin, t)}</DateSubline>}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px', marginTop: 12, borderRadius: 10, border: '1px solid var(--line, hsl(var(--border)))' }}>
            <Toggle on={!!leg.day_change} onChange={(v) => patch({ day_change: !!v })} label={t('event.overnight_label')} />
            <span style={{ minWidth: 0 }}>
              <span className="t-ui" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Moon size={16} /> {t('event.overnight_label')}
              </span>
              <span className="t-meta" style={{ display: 'block', color: 'var(--muted)', marginTop: 2 }}>{t('event.overnight_hint')}</span>
            </span>
          </div>
        </div>

        {/* Carrier / flight no. */}
        <div className="fld-grid" style={{ marginTop: 14 }}>
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
        <div className="fld-grid eed-accrow">
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
    </div>
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
      <div className="seg seg--fill" role="group" aria-label={t('trip.sidebar_route')} style={{ marginBottom: form.hasLayovers ? 8 : 14 }}>
        <button type="button" aria-pressed={!form.hasLayovers} onClick={() => { if (form.hasLayovers) disable(); }}>{t('event.route_direct')}</button>
        <button type="button" aria-pressed={form.hasLayovers} onClick={() => { if (!form.hasLayovers) enable(); }}>{t('event.with_layovers')}</button>
      </div>
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
// Centered subline under a date pair (duration / nights). Same markup everywhere.
const DateSubline = ({ children }) => (
  <div className="muted t-meta" style={{ marginTop: 8, textAlign: 'center' }}>{children}</div>
);

function SegTransportGrid({ value, onChange, color }) {
  const { t } = useI18nFormat();
  return (
    <div className="eed-typegrid">
      {TRANSPORT_KINDS.map((k) => {
        const active = value === k.id; const Ic = k.Icon;
        return (
          <button key={k.id} type="button" className="t-meta" onClick={() => onChange(k.id)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 6px', background: active ? TYPE_META.transfer.soft : 'var(--surface)', border: '1.5px solid ' + (active ? color : 'var(--line-2)'), color: active ? color : 'var(--ink)', borderRadius: 10, cursor: 'pointer' }}>
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
      // Auto-mark this segment overnight when its arrival day moves past its
      // departure day (raise-only — the per-segment toggle can switch it back off).
      if ('startLocal' in partial || 'endLocal' in partial) {
        const sd = (merged.startLocal || '').slice(0, 10), ed = (merged.endLocal || '').slice(0, 10);
        if (sd && ed && ed > sd) merged.day_change = true;
      }
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

  // Expandable cards (default expanded, like the design). A segment with an
  // active error is always forced open so the inline message can't be hidden.
  const [openMap, setOpenMap] = useState({});
  const segHasErr = (i) => (issues || []).some((it) => it.level === 'error' && typeof it.field === 'string' && it.field.startsWith(`seg${i}.`));
  const isOpen = (seg, i) => {
    if (segHasErr(i)) return true;
    if (openMap[seg.id] !== undefined) return openMap[seg.id];
    return true;
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
                <span className="t-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 999, whiteSpace: 'nowrap', background: TYPE_META.transfer.soft, color }}>
                  <Repeat size={12} style={{ flexShrink: 0 }} />
                  {t('event.layover_in', { city: '' }).replace(/\s*$/, '')}&nbsp;<span>{layCity}</span>
                  {layDate && <span className="num" style={{ opacity: 0.7 }}>· {layDate}</span>}
                  {layDur && <span className="num" style={{ opacity: 0.7 }}>· {layDur}</span>}
                </span>
                <span style={{ flex: 1, height: 1, background: 'var(--line-2)' }} />
              </div>
            )}
          </React.Fragment>
        );
      })}

      <button type="button" className="t-meta" onClick={addSegment}
        style={{ marginTop: 6, padding: '11px 14px', border: '1.5px dashed ' + color, borderRadius: 10, background: TYPE_META.transfer.soft, color, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
        {t('event.add_layover')}
      </button>
    </div>
  );
}

function ActivityFields({ form, setField, setForm, aiFields, tz, setTime, issues, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const color = TYPE_META.activity.color;
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
  const docCount = Array.isArray(form.documents) ? form.documents.length : 0;
  return (
    <>
      <SectionHeader color={color}>{t('event.activity_about')}</SectionHeader>
      <div data-vfield="title" className={inv('title')}>
        <Label>{t('event.name_req')}</Label>
        <Input value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder={t('event.ph_activity_example')} />
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

      <div className="eed-dateblock">
        <div className="eed-dateblock__lbl t-ui">{t('event.when')}</div>
        <div className="fld-grid">
          <div className={`field ${inv('start')}`} data-vfield="start">
            <Label>{t('event.start')}</Label>
            <DateTimeInput
              value={form.startLocal}
              onChange={(v) => setField('startLocal', v)}
              onTimeMissingChange={(v) => setTime('start', v)}
            />
            <TimezoneHint tz={tz} />
            <FieldError issues={issues} field="start" />
          </div>
          <div className={`field ${inv('end')}`} data-vfield="end">
            <Label>{t('event.end')}</Label>
            <DateTimeInput
              value={form.endLocal}
              onChange={(v) => setField('endLocal', v)}
              onTimeMissingChange={(v) => setTime('end', v)}
            />
            <TimezoneHint tz={tz} />
            <FieldError issues={issues} field="end" />
          </div>
        </div>
        {(() => {
          const m = layoverMins(form.startLocal, form.endLocal);
          return m != null ? <DateSubline>{fmtDur(m, t)}</DateSubline> : null;
        })()}
      </div>

      <SectionHeader color={color}>{t('event.cost')}</SectionHeader>
      <div className="fld-grid">
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

function EsimServiceFields({ form, setField, issues, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
  return (
    <>
      <SectionHeader>{t('service.kind.esim')}</SectionHeader>
      <div data-vfield="name" className={inv('name')}>
        <Label>{t('service.name')}</Label>
        <Input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder={t('service.name_ph')} />
        <FieldError issues={issues} field="name" />
      </div>

      <SectionHeader>{t('service.esim_cost_section')}</SectionHeader>
      <div className="fld-grid">
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

function InsuranceServiceFields({ form, setField, issues, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
  return (
    <>
      <SectionHeader>{t('service.kind.insurance')}</SectionHeader>
      <div data-vfield="name" className={inv('name')}>
        <Label>{t('service.name')}</Label>
        <Input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder={t('service.name_ph')} />
        <FieldError issues={issues} field="name" />
      </div>

      <SectionHeader>{t('service.insurance_section')}</SectionHeader>
      <div>
        <Label>{t('service.policy_number')}</Label>
        <Input className="t-mono" value={form.policy_number} onChange={(e) => setField('policy_number', e.target.value)} placeholder={t('service.policy_number_ph')} />
      </div>
      <div className="fld-grid">
        <div data-vfield="date_start" className={inv('date_start')}>
          <Label>{t('service.date_start')}</Label>
          <Input type="date" value={form.date_start} onChange={(e) => setField('date_start', e.target.value)} />
        </div>
        <div data-vfield="date_finish" className={inv('date_finish')}>
          <Label>{t('service.date_finish')}</Label>
          <Input type="date" value={form.date_finish} onChange={(e) => setField('date_finish', e.target.value)} />
          <FieldError issues={issues} field="date_finish" />
        </div>
      </div>

      <SectionHeader>{t('service.insurance_cost_section')}</SectionHeader>
      <div className="fld-grid">
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

function ServiceFields({ form, setField, setForm, aiFields, setTime, issues, isEdit, setUploading, tripId }) {
  const svcKind = form.service_kind || 'car_rental';
  if (svcKind === 'esim') return <EsimServiceFields form={form} setField={setField} issues={issues} setUploading={setUploading} tripId={tripId} />;
  if (svcKind === 'insurance') return <InsuranceServiceFields form={form} setField={setField} issues={issues} setUploading={setUploading} tripId={tripId} />;
  return <CarRentalServiceFields form={form} setField={setField} setForm={setForm} aiFields={aiFields} setTime={setTime} issues={issues} isEdit={isEdit} setUploading={setUploading} tripId={tripId} />;
}

function CarRentalServiceFields({ form, setField, setForm, aiFields, setTime, issues, isEdit, setUploading, tripId }) {
  const { t } = useI18nFormat();
  const color = TYPE_META.service.color;
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
  return (
    <>
      <SectionHeader color={color}>{t('event.car_section')}</SectionHeader>
      <div data-vfield="name" className={inv('name')}>
        <Label>{t('event.company_name_req')}</Label>
        <Input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder={t('event.ph_car_example')} />
        <FieldError issues={issues} field="name" />
      </div>

      <SectionHeader color={color}>{t('event.pickup')}</SectionHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        <div data-vfield="pickupAddress" className={inv('pickupAddress')}>
          <Label>{isEdit ? t('event.pickup_addr') : t('event.pickup_addr_req')}</Label>
          <AddressAutocomplete
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
        <div data-vfield="pickup" className={inv('pickup')}>
          <Label>{t('event.date_time')}</Label>
          <DateTimeInput
            value={form.pickup_at_local}
            onChange={(v) => setField('pickup_at_local', v)}
            onTimeMissingChange={(v) => setTime('pickup', v)}
          />
          <TimezoneHint tz={form.pickup_timezone} />
          <FieldError issues={issues} field="pickup" />
        </div>
      </div>

      <SectionHeader color={color}>{t('event.return_section')}</SectionHeader>
      <label className="ch-row">
        <input
          type="checkbox"
          checked={!!form.return_different_location}
          onChange={(e) => setField('return_different_location', e.target.checked)}
        />
        <div className="cr-b">
          <b>{t('event.return_diff_place')}</b>
          {!form.return_different_location && <span>{t('event.return_same_suffix')}</span>}
        </div>
      </label>
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
        <div data-vfield="dropoff" className={inv('dropoff')}>
          <Label>{t('event.date_time_return')}</Label>
          <DateTimeInput
            value={form.dropoff_at_local}
            onChange={(v) => setField('dropoff_at_local', v)}
            onTimeMissingChange={(v) => setTime('dropoff', v)}
          />
          <TimezoneHint tz={form.return_different_location ? form.dropoff_timezone : form.pickup_timezone} />
          <FieldError issues={issues} field="dropoff" />
        </div>
      </div>

      <SectionHeader color={color}>{t('event.finance_booking')}</SectionHeader>
      <div className="fld-grid">
        <div>
          <Label>{t('event.price')}</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>{t('event.currency')}</Label>
          <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
        </div>
      </div>
      <div className="fld-grid">
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
