/**
 * EventEditDialog - unified create/edit modal for hotel / transfer / activity /
 * car-rental (service kind="car_rental"). Replaces the four legacy dialogs
 * (HotelDialog, TransferDialog, ActivityDialog, CarRentalDialog).
 *
 * The four "kinds" share a single chrome (colour stripe + header + footer +
 * shared AI block) but each renders its own field group. In create mode the
 * top type-picker lets the user switch between kinds - the form is reset to
 * the new kind's EMPTY shape on switch.
 *
 * Simple service kinds (esim, insurance) still go through the legacy
 * ServiceDialog - they're a single name+price form and don't fit this layout.
 *
 * Visual reference: designer's prototype `event-edit.jsx`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import AiField from '@/components/ui/AiField';
import {
  Loader2, Sparkles, Trash2, ExternalLink, ChevronDown, ArrowRight, Repeat, ArrowLeft,
  Bed, Plane, Camera, Car as CarIcon, Train, Bus, Ship, Footprints, Moon,
} from 'lucide-react';
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

// City autocomplete for layover (waypoint) cities - resolves a full city object
// (coords + IANA timezone) so the saved waypoint city_visit has real geo data.
function CityPicker({ value, onPick, placeholder }) {
  const { t } = useI18nFormat();
  const { lang } = useI18n();
  const [q, setQ] = useState(value?.city_name || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const tRef = useRef(null);
  useEffect(() => { setQ(value?.city_name || ''); }, [value?.city_name]);
  const run = (query) => {
    clearTimeout(tRef.current);
    if (query.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    tRef.current = setTimeout(async () => {
      try { const r = await searchCities(query.trim(), lang); setResults(r || []); setOpen((r || []).length > 0); }
      catch { setResults([]); setOpen(false); }
      finally { setLoading(false); }
    }, 300);
  };
  const pick = async (c) => {
    setOpen(false); setResults([]); setQ(c.city_name); setLoading(true);
    let tz = null; try { tz = await getTimezone(c.latitude, c.longitude); } catch { /* ignore */ }
    setLoading(false);
    onPick({ city_name: c.city_name, country: c.country, country_code: c.country_code, latitude: c.latitude, longitude: c.longitude, timezone: tz, external_city_id: c.external_city_id });
  };
  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input"
        value={q}
        placeholder={placeholder || t('event.layover_city_ph')}
        onChange={(e) => { setQ(e.target.value); if (value) onPick(null); run(e.target.value); }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        autoComplete="off"
      />
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />}
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 60, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', maxHeight: 240, overflowY: 'auto' }}>
          {results.map((c) => (
            <button key={c.external_city_id || c.city_name} type="button" onMouseDown={() => pick(c)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid var(--line-2)', background: 'transparent', cursor: 'pointer' }}>
              <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600 }}>{c.city_name}</div>
              <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.display_name || c.country}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

let __segUid = 1;
function makeSegment(defCur = 'EUR') {
  return {
    id: 'seg-' + (__segUid++), transport_type: 'plane',
    from_address: '', to_address: '', startLocal: '', endLocal: '',
    carrier: '', flight_number: '', booking_reference: '',
    price: '', currency: defCur, toCity: null, day_change: false,
  };
}

import { supabase } from '@/api/supabaseClient';
import { searchCities, getTimezone } from '@/lib/geo';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localToUtc, utcToLocalInput } from '@/lib/time';
import { validateEntity, normalizePositions, transferAiCityAdvisories } from '@/lib/validation';
import { FieldError, IssuesPanel, fieldHasError } from '@/components/common/ValidationUI';
import { detectPlatformFromUrl, BOOKING_PLATFORMS, platformLogoUrl } from '@/lib/booking-platforms';
import { getEntityDocuments, getDetailsDocuments } from '@/lib/documents';
import { invalidateTripData, optimisticContentUpdate, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { resolveTimezoneFromCoords } from '@/lib/timezone-resolver';

// Ensure a user-entered URL like "booking.com" opens absolutely (otherwise the
// browser treats it as relative and prepends the current app path → /trip/.../booking.com).
const withScheme = (u) => {
  if (!u) return u;
  const s = String(u).trim();
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};
import { useToast } from '@/components/ui/use-toast';
import { useI18nFormat, useI18n } from '@/lib/i18n/I18nContext';

import DateTimeInput from '@/components/common/DateTimeInput';
import TimezoneHint from '@/components/common/TimezoneHint';
import DocumentsField from '@/components/common/DocumentsField';
import AddressAutocomplete from '@/components/common/AddressAutocomplete';
import EventAiBlock from '@/components/common/EventAiBlock';
import TripProInfoDialog from '@/components/common/TripProInfoDialog';

// ─────────────────────────────────────────────────────────────────────────────
//  Type metadata - colours, icons, copy
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_META = {
  hotel: {
    color: 'var(--ev-hotel)', soft: 'var(--ev-hotel-soft)',
    Icon: Bed, labelKey: 'event.type_hotel',
    titleNewKey: 'event.title_new_hotel', titleEditKey: 'event.title_edit_hotel',
  },
  transfer: {
    color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)',
    Icon: Plane, labelKey: 'event.type_transfer',
    titleNewKey: 'event.title_new_transfer', titleEditKey: 'event.title_edit_transfer',
  },
  activity: {
    color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)',
    Icon: Camera, labelKey: 'event.type_activity',
    titleNewKey: 'event.title_new_activity', titleEditKey: 'event.title_edit_activity',
  },
  service: {
    color: 'var(--ev-car)', soft: 'var(--ev-car-soft)',
    Icon: CarIcon, labelKey: 'event.type_car',
    titleNewKey: 'event.title_new_car', titleEditKey: 'event.title_edit_car',
  },
};

const TABLE_BY_KIND = {
  hotel: 'hotel_stays',
  transfer: 'transfers',
  activity: 'activities',
  service: 'trip_services',
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
    booking_url: '', booking_platform: '',
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
    booking_url: '', booking_platform: '',
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

function emptyServiceForm(defCur = 'EUR') {
  return {
    name: '',
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
    booking_url: '', booking_platform: '',
    price: '', currency: defCur,
    documents: [], notes: '',
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
    booking_url: h.booking_url || '', booking_platform: h.booking_platform || '',
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
    booking_platform: tr.booking_platform || '',
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
  const hasDifferentDropoff = !!(
    (d.dropoff_address && d.dropoff_address !== d.pickup_address) ||
    (d.dropoff_timezone && d.dropoff_timezone !== d.pickup_timezone)
  );
  return {
    name: svc.name || '',
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
    booking_platform: d.booking_platform || '',
    price: svc.price ?? d.price ?? '',
    currency: svc.currency || d.currency || 'EUR',
    documents: getDetailsDocuments(d),
    notes: d.notes || '',
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
  const { visit, fromVisit, toVisit, defaultStart, defaultCurrency } = ctx;
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
  return emptyServiceForm(defCur);
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
  // Shell variant. 'dialog' (default) = the shadcn Dialog overlay used app-wide.
  // 'panel' = render the SAME content inline (no overlay) for the trip-editor
  // left panel. Behaviour/state are identical; only the outer wrapper differs.
  variant = 'dialog',
  // Optional (trip editor only): report the in-progress transfer so the map can
  // draw a live route preview shaped by the picked transport type.
  onPreviewTransfer = null,
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
  const meta = TYPE_META[currentKind] || TYPE_META.hotel;
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
    buildInitialForm(initialKind || 'hotel', entity, { visit, fromVisit, toVisit, defaultStart, defaultCurrency })
  );
  const [aiFields, setAiFields] = useState(new Set());
  // Six-state AI flow per the prototype: locked / available / idle /
  // uploaded / parsing / parsed. Starts as 'available' for Pro users once
  // checkSubscriptionStatus resolves; non-Pro lands in 'locked'.
  const [aiState, setAiState] = useState('available');

  // Pro state: null = checking, true/false = resolved. isOwner tells whether the
  // caller owns this trip - only the owner may be sent to checkout; a participant
  // is shown the "ask the owner" info dialog instead.
  const [isPro, setIsPro] = useState(null);
  const [isOwner, setIsOwner] = useState(false);
  const [tripProInfoOpen, setTripProInfoOpen] = useState(false);

  const [confirmDel, setConfirmDel] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Extra transfer segments captured from AI parsing (the AI may detect a
  // multi-leg booking; the additional legs get inserted as separate Transfer
  // rows on save). Empty when AI returns a single segment.
  const [extraSegments, setExtraSegments] = useState([]);
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
    setForm(buildInitialForm(k, entity, { visit, fromVisit, toVisit, defaultStart, defaultCurrency }));
    setAiFields(new Set());
    setExtraSegments([]);
    setAiSegFields(new Set()); setAiAdvisories([]);
    setTimeMissing({});
    setTouched(new Set()); setSubmitted(false);
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

  // Auto-detect booking platform when URL changes; clear it when URL is removed.
  useEffect(() => {
    if (!form.booking_url) {
      if (form.booking_platform) setForm((prev) => ({ ...prev, booking_platform: '' }));
      return;
    }
    const p = detectPlatformFromUrl(form.booking_url);
    if (p && p !== form.booking_platform) {
      setForm((prev) => ({ ...prev, booking_platform: p }));
    }
  }, [form.booking_url]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setAiFields(new Set());
    setExtraSegments([]);
    setAiSegFields(new Set()); setAiAdvisories([]);
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
        id: entity?.id, name: form.name, pickupAddress: form.pickup_address, isEdit,
        pickup: localToUtc(form.pickup_at_local, tz), dropoff: localToUtc(form.dropoff_at_local, tz),
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
  const OPT_TABLE = { hotel: 'hotel_stays', transfer: 'transfers', activity: 'activities', service: 'trip_services' };
  const OPT_CACHE = { hotel: 'hotels', transfer: 'transfers', activity: 'activities', service: 'services' };
  // A create that touches several rows/cities (layover chain or AI extra segments)
  // can't be cleanly mirrored optimistically — keep the awaited path for those.
  const isComplexTransferCreate = currentKind === 'transfer' && !entity
    && ((form.hasLayovers && Array.isArray(form.segments) && form.segments.length >= 2) || extraSegments.length > 0);

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
    const table = OPT_TABLE[currentKind];
    const cacheKind = OPT_CACHE[currentKind];
    const payload = buildCurrentPayload();
    const tempId = 'tmp-' + Math.random().toString(36).slice(2);
    const row = { id: tempId, trip_id: tripId, created_by: user?.id, ...payload };
    const prev = qc.getQueryData(TRIP_CONTENT_KEY(tripId));
    optimisticContentUpdate(qc, tripId, cacheKind, 'add', row);
    onOpenChange(false);
    (async () => {
      try {
        const { error } = await supabase.from(table).insert({ ...payload, created_by: user?.id });
        if (error) throw error;
        invalidateTripData(qc, tripId);
      } catch (err) {
        if (prev !== undefined) qc.setQueryData(TRIP_CONTENT_KEY(tripId), prev);
        invalidateTripData(qc, tripId);
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
        // If AI returned extra segments, create each as its own Transfer row.
        if (!entity && extraSegments.length > 0) {
          for (const seg of extraSegments) {
            if (!seg.start_datetime || !seg.end_datetime) continue;
            await supabase.from('transfers').insert({
              trip_id: tripId,
              from_city_visit_id: fromVisit?.id,
              to_city_visit_id: toVisit?.id,
              transport_type: seg.transport_type,
              day_change: !!((seg.end_datetime || '').slice(0, 10) && (seg.end_datetime || '').slice(0, 10) > (seg.start_datetime || '').slice(0, 10)),
              start_datetime: localToUtc(seg.start_datetime, startTz),
              end_datetime: localToUtc(seg.end_datetime, endTz),
              carrier: seg.carrier || undefined,
              flight_number: seg.flight_number || undefined,
              booking_reference: seg.booking_reference || undefined,
              booking_url: form.booking_url || undefined,
              booking_platform: form.booking_platform || undefined,
              from_address: seg.from_address || undefined,
              to_address: seg.to_address || undefined,
              price: seg.price === '' || seg.price == null ? undefined : Number(seg.price),
              currency: seg.currency || 'EUR',
              details: {},
              created_by: user?.id,
            });
          }
        }
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
      const table = TABLE_BY_KIND[currentKind];
      const { error } = await supabase.from(table).delete().eq('id', entity.id);
      if (error) throw error;
    },
    onSuccess: () => {
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
  const handleHotelExtract = (data, fileUrl, fileName) => {
    const filled = new Set();
    const upd = { ...form };
    const setIf = (k, v) => { if (v != null && v !== '') { upd[k] = v; filled.add(k); } };
    setIf('name', data.name);
    setIf('address', data.address);
    setIf('booking_reference', data.booking_reference);
    setIf('payment_status', data.payment_status);
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
    setIf('booking_platform', data.booking_platform);
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
    if (data.free_cancellation_until) {
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
      // to full city objects (coords + tz) so saveLayoverChain can create waypoints.
      for (let i = 0; i < formSegs.length - 1; i++) {
        // Prefer the explicit waypoints[] entry; fall back to the leg's to_city.
        const name = wps[i]?.city || segs[i].to_city;
        const code = wps[i]?.country_code || segs[i].to_country_code;
        if (!name) continue;
        try {
          const cc = code ? ', ' + code : '';
          const r = await searchCities(`${name}${cc}`, lang);
          const best = r?.[0];
          if (best?.latitude) {
            let tz = null; try { tz = await getTimezone(best.latitude, best.longitude); } catch { /* ignore */ }
            formSegs[i].toCity = { city_name: best.city_name, country: best.country, country_code: best.country_code, latitude: best.latitude, longitude: best.longitude, timezone: tz, external_city_id: best.external_city_id };
          }
        } catch { /* leave null - user picks the layover city manually */ }
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
      if (data.booking_platform) topFilled.add('booking_platform');

      setForm((prev) => ({
        ...prev,
        hasLayovers: true,
        segments: formSegs,
        booking_url: data.booking_url || prev.booking_url,
        booking_platform: data.booking_platform || prev.booking_platform,
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
    setIf('booking_platform', data.booking_platform);
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
    setForm(upd);
    setAiFields(filled);
    setAiSegFields(new Set()); // advisories already set above - keep them
    setAiState('parsed');
  };

  // ── Render ─────────────────────────────────────────────────────────────
  const inner = (
    <>
          {/* 4px colour stripe */}
          <div style={{ height: 4, background: meta.color }} />

          {/* Header */}
          <div
            className="border-b"
            style={{ padding: '16px 22px 14px', background: meta.soft, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
          >
            {variant === 'panel' && (
              <button
                onClick={() => onOpenChange?.(false)}
                title={t('common.back')}
                style={{ width: 28, height: 28, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--secondary)', color: 'var(--secondary-ink)', cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            <div
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: meta.color, color: 'white',
                display: 'grid', placeItems: 'center', flexShrink: 0,
              }}
            >
              <meta.Icon className="w-5 h-5" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="text-[length:var(--fs-micro)] uppercase tracking-wider font-semibold text-muted-foreground">
                {t(meta.labelKey)}
              </div>
              <h2 className="font-display text-xl leading-tight" style={{ letterSpacing: '-0.02em' }}>
                {ctxTitle || (isEdit ? t(meta.titleEditKey) : t(meta.titleNewKey))}
              </h2>
            </div>
          </div>

          {/* Inline delete-confirm view - replaces the form when active to
              avoid nesting Radix modals (which would intercept pointer
              events on the inner buttons). */}
          {confirmDel ? (
            <div style={{ padding: 22 }}>
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-destructive/15 text-destructive grid place-items-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-semibold text-base">{t('event.delete_q', { label: t(meta.labelKey).toLowerCase() })}</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {t('event.delete_irreversible')}
                  </div>
                </div>
              </div>
            </div>
          ) : (
          /* Body */
          <div style={{ padding: 22 }}>
            {/* AI block - only for hotel & transfer (the kinds with parsers). */}
            {(currentKind === 'hotel' || currentKind === 'transfer') && (
              <EventAiBlock
                kind={currentKind}
                state={aiState}
                setState={setAiState}
                onExtract={currentKind === 'hotel' ? handleHotelExtract : handleTransferExtract}
                onUpgrade={openUpgrade}
                parsedFieldCount={aiFields.size + aiSegFields.size}
                onReset={() => { setAiFields(new Set()); setExtraSegments([]); setAiSegFields(new Set()); setAiAdvisories([]); }}
              />
            )}

            <fieldset disabled={aiState === 'parsing'} className={aiState === 'parsing' ? 'opacity-50 pointer-events-none select-none' : ''}>
              {currentKind === 'hotel' && (
                <HotelFields
                  form={form}
                  setField={setField}
                  aiFields={aiFields}
                  tz={tz}
                  setTime={setTime}
                  issues={displayIssues}
                  setUploading={setUploading}
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
                  extraSegments={extraSegments}
                  isEdit={isEdit}
                  setUploading={setUploading}
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
                />
              )}

              {/* Summary panel: shown only after a save attempt (hybrid). Click row -> field. */}
              <IssuesPanel issues={[...(submitted ? issues : []), ...aiAdvisories]} style={{ marginTop: 12 }} />
            </fieldset>
          </div>
          )}

          {/* Footer — pinned to the bottom of the column in panel mode (like CityView) */}
          <div
            className="border-t bg-secondary/30"
            style={{ padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 8,
              ...(variant === 'panel' ? { position: 'sticky', bottom: 0, background: 'var(--wash-2)', zIndex: 3 } : {}) }}
          >
            {confirmDel ? (
              <>
                <div style={{ flex: 1 }} />
                <button className="btn btn--ghost" onClick={() => setConfirmDel(false)} disabled={deleteMut.isPending}>
                  {t('common.cancel')}
                </button>
                <button
                  className="btn"
                  onClick={() => deleteMut.mutate()}
                  disabled={deleteMut.isPending}
                  style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' }}
                >
                  {deleteMut.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />{t('common.delete')}
                </button>
              </>
            ) : (
              <>
                {isEdit && (
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => setConfirmDel(true)}
                    disabled={deleteMut.isPending}
                    style={{ color: 'var(--danger)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />{t('common.delete')}
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button className="btn btn--ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</button>
                <button
                  className="btn btn--primary"
                  onClick={handleSaveClick}
                  disabled={uploading || saveMut.isPending}
                  aria-disabled={!canSave}
                  style={{ background: meta.color, borderColor: meta.color, color: '#fff', opacity: canSave ? 1 : 0.6 }}
                >
                  {saveMut.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                  {isEdit ? t('common.save') : t('event.create')}
                </button>
              </>
            )}
          </div>
    </>
  );

  return (
    <>
      {variant === 'panel' ? (
        <div className="te-edit-panel-body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', overflowY: 'auto', background: 'var(--surface)' }}>
          {inner}
        </div>
      ) : (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="p-0 max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden gap-0 w-[calc(100%-1rem)] sm:w-full" style={{ background: 'var(--surface)' }}>
            {inner}
          </DialogContent>
        </Dialog>
      )}

      <TripProInfoDialog
        open={tripProInfoOpen}
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
    booking_platform: form.booking_platform || null,
    documents: Array.isArray(form.documents) ? form.documents : [],
    voucher_file_url: '',
    voucher_file_name: '',
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
    booking_platform: form.booking_platform || null,
    price: form.price === '' ? null : Number(form.price),
    currency: form.currency || 'EUR',
    documents: Array.isArray(form.documents) ? form.documents : [],
    voucher_file_url: '',
    voucher_file_name: '',
    notes: form.notes,
    details: {},
  };
}

// Layover transfer → waypoint chain (TRIP_EDIT_MODE_TZ §11).
// segments[i].toCity (for i < N-1) is a chosen layover city → one waypoint
// city_visit each. Then one transfer row per segment, between adjacent nodes:
//   fromVisit → wp1 → … → wp(N-1) → toVisit.
async function saveLayoverChain(form, fromVisit, toVisit, tripId, user, t) {
  const segs = form.segments;
  const N = segs.length;

  // Waypoint NODE ordering must place each layover strictly between fromVisit
  // and toVisit, because the timeline/edit-mode sort cities by their own
  // start_datetime and only draw a transfer between CONSECUTIVE nodes. The
  // node date is decoupled from the (possibly later) segment-leg times: we
  // distribute the N-1 waypoints evenly in the gap between the two endpoints.
  const ms = (iso) => { const x = iso ? Date.parse(iso) : NaN; return Number.isNaN(x) ? null : x; };
  const fromMs = ms(fromVisit?.end_date) ?? ms(fromVisit?.start_date);
  const toMs = ms(toVisit?.start_date) ?? ms(toVisit?.end_date);
  const MIN = 60000;
  const nodeMsAt = (i) => { // i: 0..N-2
    if (fromMs != null && toMs != null && toMs > fromMs) return fromMs + ((toMs - fromMs) * (i + 1)) / N;
    if (toMs != null) return toMs - (N - 1 - i + 1) * MIN;   // just before toVisit, ascending
    if (fromMs != null) return fromMs + (i + 1) * MIN;        // just after fromVisit, ascending
    return ms(localToUtc(segs[i].endLocal, 'UTC')) ?? Date.now() + i * MIN; // fallback
  };

  // 1. Create the N-1 waypoint nodes (one per intermediate boundary).
  const wpRows = [];
  for (let i = 0; i < N - 1; i++) {
    const c = segs[i].toCity;
    if (!c?.city_name) throw new Error(t('event.err_layover_city'));
    const tz = c.timezone || 'UTC';
    const at = new Date(nodeMsAt(i)).toISOString();
    wpRows.push({
      trip_id: tripId,
      external_city_id: c.external_city_id || null,
      city_name: c.city_name,
      country: c.country || null,
      country_code: c.country_code || null,
      latitude: c.latitude ?? null,
      longitude: c.longitude ?? null,
      timezone: tz,
      kind: 'waypoint',
      start_date: at.slice(0, 10),
      end_date: at.slice(0, 10),
      // Provisional - renumbered authoritatively by normalizePositions below.
      position: 0,
      created_by: user?.id,
    });
  }
  let wpIds = [];
  if (wpRows.length) {
    const { data, error } = await supabase.from('city_visits').insert(wpRows).select('id');
    if (error) throw error;
    wpIds = (data || []).map((x) => x.id);
  }

  // 2. node id chain: from → waypoints… → to
  const nodeIds = [fromVisit?.id, ...wpIds, toVisit?.id];

  // 3. One transfer per segment between adjacent nodes.
  const trRows = segs.map((s, i) => ({
    trip_id: tripId,
    from_city_visit_id: nodeIds[i],
    to_city_visit_id: nodeIds[i + 1],
    transport_type: s.transport_type,
    // Per-segment overnight flag (auto-raised from this segment's dates, toggle in the editor).
    day_change: !!s.day_change,
    start_datetime: localToUtc(s.startLocal, 'UTC'),
    end_datetime: localToUtc(s.endLocal, 'UTC'),
    carrier: s.carrier || undefined,
    flight_number: s.flight_number || null,
    from_address: s.from_address || undefined,
    to_address: s.to_address || undefined,
    booking_reference: s.booking_reference || undefined,
    // Booking link is shared across the whole itinerary; documents/notes go on
    // the first leg to avoid duplication.
    booking_url: form.booking_url || null,
    booking_platform: form.booking_platform || null,
    price: s.price === '' || s.price == null ? null : Number(s.price),
    currency: s.currency || 'EUR',
    documents: i === 0 && Array.isArray(form.documents) ? form.documents : [],
    voucher_file_url: '',
    voucher_file_name: '',
    notes: i === 0 ? (form.notes || null) : null,
    details: {},
    created_by: user?.id,
  }));
  const { data, error } = await supabase.from('transfers').insert(trRows).select();
  if (error) throw error;

  // 4. Renumber positions across the WHOLE trip so the new waypoint(s) thread
  // cleanly into the node order (no collisions/duplicates) - authoritative for
  // both the timeline (sort tie-break) and Edit Mode (position-driven recompute).
  try {
    const { data: allVisits } = await supabase
      .from('city_visits')
      .select('id, kind, start_date, end_date, position')
      .eq('trip_id', tripId);
    if (allVisits?.length) {
      const normalized = normalizePositions(allVisits);
      const byId = new Map(allVisits.map((v) => [v.id, v.position]));
      const changed = normalized.filter((v) => byId.get(v.id) !== v.position);
      await Promise.all(changed.map((v) =>
        supabase.from('city_visits').update({ position: v.position }).eq('id', v.id)
      ));
    }
  } catch (e) {
    console.error('waypoint position renumber failed', e);
  }

  return data?.[0];
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
    // Top-level UTC columns mirror details.pickup_at_local/dropoff_at_local -     // used by get_pending_reminders to query upcoming car rentals without
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
      booking_platform: form.booking_platform || null,
      documents: Array.isArray(form.documents) ? form.documents : [],
      voucher_file_url: undefined,
      voucher_file_name: undefined,
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
  // Plain heading per the design spec (event-edit.jsx) - no colour bar.
  return <h3 style={{ margin: '22px 0 14px', fontSize: 'var(--fs-strong)', fontWeight: 600 }}>{children}</h3>;
}


// ─────────────────────────────────────────────────────────────────────────────
//  Field groups per kind
// ─────────────────────────────────────────────────────────────────────────────

function HotelFields({ form, setField, aiFields, tz, setTime, issues, setUploading }) {
  const { t } = useI18nFormat();
  const platformInfo = form.booking_platform ? BOOKING_PLATFORMS[form.booking_platform] : null;
  const platformLogo = platformLogoUrl(form.booking_platform, form.booking_url);
  const color = TYPE_META.hotel.color;
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
  return (
    <>
      <SectionHeader color={color}>{t('event.hotel_about')}</SectionHeader>
      <div className="space-y-3">
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

      <SectionHeader color={color}>{t('event.checkin_checkout')}</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={`min-w-0 ${inv('checkIn')}`} data-vfield="checkIn">
          <Label>{t('event.checkin_req')}</Label>
          <AiField active={aiFields.has('checkInLocal')}>
            <DateTimeInput
              value={form.checkInLocal}
              onChange={(v) => setField('checkInLocal', v)}
              onTimeMissingChange={(v) => setTime('checkIn', v)}
              className="w-full"
            />
          </AiField>
          <TimezoneHint tz={tz} />
          <FieldError issues={issues} field="checkIn" />
        </div>
        <div className={`min-w-0 ${inv('checkOut')}`} data-vfield="checkOut">
          <Label>{t('event.checkout_req')}</Label>
          <AiField active={aiFields.has('checkOutLocal')}>
            <DateTimeInput
              value={form.checkOutLocal}
              onChange={(v) => setField('checkOutLocal', v)}
              onTimeMissingChange={(v) => setTime('checkOut', v)}
              className="w-full"
            />
          </AiField>
          <TimezoneHint tz={tz} />
          <FieldError issues={issues} field="checkOut" />
        </div>
      </div>

      <SectionHeader color={color}>{t('event.finance_cancel')}</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
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
            <select className="select" value={form.payment_status} onChange={(e) => setField('payment_status', e.target.value)}>
              <option value="">-</option>
              <option value="paid">{t('event.paid')}</option>
              <option value="partial">{t('event.partial')}</option>
              <option value="pay_on_arrival">{t('event.on_arrival')}</option>
            </select>
          </AiField>
        </div>
      </div>
      <AiField active={aiFields.has('free_cancellation')}>
        <div className="rounded-lg border bg-secondary/30 p-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox checked={form.free_cancellation} onCheckedChange={(v) => setField('free_cancellation', !!v)} />
            <div className="flex-1">
              <div className="text-sm font-medium">{t('event.free_cancel_have')}</div>
              <div className="text-xs text-muted-foreground">{t('event.free_cancel_hint')}</div>
              {form.free_cancellation && (
                <div className="mt-2">
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
          </label>
        </div>
      </AiField>

      <SectionHeader color={color}>{t('event.booking_section')}</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>{t('event.booking_url')}</Label>
          <AiField active={aiFields.has('booking_url')}>
            <div className="relative">
              {platformLogo && (
                <img src={platformLogo} alt="" className="w-5 h-5 absolute left-2.5 top-1/2 -translate-y-1/2 rounded-sm" />
              )}
              <Input
                value={form.booking_url}
                onChange={(e) => setField('booking_url', e.target.value)}
                placeholder="https://..."
                className={platformLogo ? 'pl-9' : ''}
              />
            </div>
          </AiField>
          {platformInfo && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${platformInfo.color}`}>
                {platformLogo && <img src={platformLogo} alt="" className="w-3.5 h-3.5 rounded-sm" />}
                {platformInfo.labelKey ? t(platformInfo.labelKey) : platformInfo.label}
              </span>
              {form.booking_url && (
                <a href={withScheme(form.booking_url)} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />{t('common.open')}
                </a>
              )}
            </div>
          )}
        </div>
        <div>
          <Label>{t('event.booking_ref')}</Label>
          <AiField active={aiFields.has('booking_reference')}>
            <Input className="font-mono" value={form.booking_reference} onChange={(e) => setField('booking_reference', e.target.value)} placeholder="-" />
          </AiField>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
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

      <SectionHeader color={color}>{t('event.docs_notes')}</SectionHeader>
      <AiField active={aiFields.has('documents')}>
        <DocumentsField
          value={form.documents}
          onChange={(docs) => setField('documents', docs)}
          onUploadingChange={setUploading}
          bare
        />
      </AiField>
      <div className="mt-3">
        <Label>{t('event.notes')}</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('event.notes_ph')} />
      </div>
    </>
  );
}

function TransferFields({ form, setField, setForm, aiFields, aiSegFields, setAiSegFields, fromVisit, toVisit, startTz, endTz, setTime, issues, onTouch, extraSegments, isEdit, setUploading }) {
  const { t } = useI18nFormat();
  const platformInfo = form.booking_platform ? BOOKING_PLATFORMS[form.booking_platform] : null;
  const platformLogo = platformLogoUrl(form.booking_platform, form.booking_url);
  const color = TYPE_META.transfer.color;
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
  return (
    <>
      {!isEdit && <LayoverToggle form={form} setForm={setForm} color={color} />}

      {form.hasLayovers ? (
        <SegmentsEditor form={form} setForm={setForm} fromVisit={fromVisit} toVisit={toVisit} setTime={setTime} color={color} aiSegFields={aiSegFields} setAiSegFields={setAiSegFields} issues={issues} onTouch={onTouch} />
      ) : (
      <>
      <SectionHeader color={color}>{t('event.transport_kind')}</SectionHeader>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
        {TRANSPORT_KINDS.map((k) => {
          const active = form.transport_type === k.id;
          const Ic = k.Icon;
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => setField('transport_type', k.id)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 4, padding: '10px 6px',
                background: active ? TYPE_META.transfer.soft : 'transparent',
                border: '1.5px solid ' + (active ? color : 'var(--border, hsl(var(--border)))'),
                color: active ? color : 'inherit',
                borderRadius: 10, cursor: 'pointer',
                fontWeight: 500, fontSize: 'var(--fs-micro)',
              }}
            >
              <Ic className="w-4 h-4" />
              {t(k.labelKey)}
            </button>
          );
        })}
      </div>

      <SectionHeader color={color}>{t('event.from_to')}</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
          <div className="text-[length:var(--fs-micro)] uppercase tracking-wider font-semibold" style={{ color }}>{t('event.from')}</div>
          <div>
            <Label>{t('event.addr_station')}</Label>
            <AiField active={aiFields.has('from_address')}>
              <AddressAutocomplete
                value={form.from_address}
                onChange={(v) => setField('from_address', v)}
                onPlaceSelected={(p) => {
                  setField('from_address', p.formatted_address || p.description || form.from_address);
                  if (p.latitude != null) setField('from_latitude', p.latitude);
                  if (p.longitude != null) setField('from_longitude', p.longitude);
                }}
                placeholder={t('event.addr_ph')}
              />
            </AiField>
          </div>
          <div className={inv('start')} data-vfield="start">
            <Label>{t('event.departure_req')}</Label>
            <AiField active={aiFields.has('startLocal')}>
              <DateTimeInput
                value={form.startLocal}
                onChange={(v) => setField('startLocal', v)}
                onTimeMissingChange={(v) => setTime('start', v)}
                className="w-full"
              />
            </AiField>
            <TimezoneHint tz={startTz} />
            <FieldError issues={issues} field="start" />
          </div>
        </div>
        <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
          <div className="text-[length:var(--fs-micro)] uppercase tracking-wider font-semibold" style={{ color }}>{t('event.to')}</div>
          <div>
            <Label>{t('event.addr_station')}</Label>
            <AiField active={aiFields.has('to_address')}>
              <AddressAutocomplete
                value={form.to_address}
                onChange={(v) => setField('to_address', v)}
                onPlaceSelected={(p) => {
                  setField('to_address', p.formatted_address || p.description || form.to_address);
                  if (p.latitude != null) setField('to_latitude', p.latitude);
                  if (p.longitude != null) setField('to_longitude', p.longitude);
                }}
                placeholder={t('event.addr_ph')}
              />
            </AiField>
          </div>
          <div className={inv('end')} data-vfield="end">
            <Label>{t('event.arrival_req')}</Label>
            <AiField active={aiFields.has('endLocal')}>
              <DateTimeInput
                value={form.endLocal}
                onChange={(v) => setField('endLocal', v)}
                onTimeMissingChange={(v) => setTime('end', v)}
                className="w-full"
              />
            </AiField>
            <TimezoneHint tz={endTz} />
            <FieldError issues={issues} field="end" />
          </div>
        </div>
      </div>

      {/* Overnight / day-change toggle. When on, the destination city (and every
          city after it) shifts +1 day in the trip editor. Auto-checked when the
          arrival date is later than the departure date. */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '11px 12px', marginBottom: 12, borderRadius: 10, border: '1px solid var(--line, hsl(var(--border)))', cursor: 'pointer' }}>
        <Checkbox checked={!!form.day_change} onCheckedChange={(v) => setField('day_change', !!v)} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'var(--fs-base)' }}>
            <Moon className="w-4 h-4" /> {t('event.overnight_label')}
          </span>
          <span style={{ display: 'block', fontSize: 'var(--fs-micro)', color: 'var(--muted, #888)', marginTop: 2, lineHeight: 1.4 }}>{t('event.overnight_hint')}</span>
        </span>
      </label>

      <SectionHeader color={color}>{t('event.carrier_booking')}</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>{t('event.carrier')}</Label>
          <AiField active={aiFields.has('carrier')}>
            <Input value={form.carrier} onChange={(e) => setField('carrier', e.target.value)} placeholder="TAP Air Portugal" />
          </AiField>
        </div>
        <div>
          <Label>{t('event.flight_train_no')}</Label>
          <AiField active={aiFields.has('flight_number')}>
            <Input className="font-mono" value={form.flight_number} onChange={(e) => setField('flight_number', e.target.value)} placeholder="TP 1379" />
          </AiField>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>{t('event.booking_url')}</Label>
          <AiField active={aiFields.has('booking_url')}>
            <div className="relative">
              {platformLogo && (
                <img src={platformLogo} alt="" className="w-5 h-5 absolute left-2.5 top-1/2 -translate-y-1/2 rounded-sm" />
              )}
              <Input
                value={form.booking_url}
                onChange={(e) => setField('booking_url', e.target.value)}
                placeholder="https://..."
                className={platformLogo ? 'pl-9' : ''}
              />
            </div>
          </AiField>
          {platformInfo && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${platformInfo.color}`}>
                {platformLogo && <img src={platformLogo} alt="" className="w-3.5 h-3.5 rounded-sm" />}
                {platformInfo.labelKey ? t(platformInfo.labelKey) : platformInfo.label}
              </span>
              {form.booking_url && (
                <a href={withScheme(form.booking_url)} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />{t('common.open')}
                </a>
              )}
            </div>
          )}
        </div>
        <div>
          <Label>{t('event.booking_ref')}</Label>
          <AiField active={aiFields.has('booking_reference')}>
            <Input className="font-mono" value={form.booking_reference} onChange={(e) => setField('booking_reference', e.target.value)} placeholder="-" />
          </AiField>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
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
      </div>

      {extraSegments.length > 0 && (
        <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-primary">
            <Sparkles className="w-4 h-4" />{t('event.ai_found_more', { count: extraSegments.length, seg: extraSegments.length === 1 ? t('event.seg_one') : t('event.seg_few') })}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('event.extra_segs_hint')}
          </div>
          <ul className="text-xs space-y-0.5 mt-1">
            {extraSegments.map((s, i) => (
              <li key={i} className="text-muted-foreground">
                • {s.from_address || '?'} → {s.to_address || '?'} {s.carrier ? `(${s.carrier})` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      </>
      )}

      <SectionHeader color={color}>{t('event.docs_notes')}</SectionHeader>
      <AiField active={aiFields.has('documents')}>
        <DocumentsField
          value={form.documents}
          onChange={(docs) => setField('documents', docs)}
          onUploadingChange={setUploading}
          bare
        />
      </AiField>
      <div className="mt-3">
        <Label>{t('event.notes')}</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('event.notes_ph')} />
      </div>
    </>
  );
}

// ── Layover (multi-segment) transfer UI ─────────────────────────────────────
function LayoverToggle({ form, setForm, color }) {
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
      <div style={{ padding: '10px 14px', background: 'var(--wash)', border: '1px solid var(--line-2)', borderRadius: 10, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 }}>
          <span style={{ position: 'relative', display: 'inline-block', width: 32, height: 18, flexShrink: 0 }}>
            <input type="checkbox" checked={form.hasLayovers} onChange={(e) => (e.target.checked ? enable() : disable())} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', margin: 0 }} />
            <span style={{ position: 'absolute', inset: 0, background: form.hasLayovers ? color : 'var(--line)', borderRadius: 999, transition: 'background .15s' }} />
            <span style={{ position: 'absolute', top: 2, left: form.hasLayovers ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: 'white', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.15)' }} />
          </span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 'var(--fs-base)', fontWeight: 500 }}>{t('event.with_layovers')}</span>
            <span className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{t('event.layovers_hint')}</span>
          </span>
        </label>
        {form.hasLayovers && (
          <span className="num" style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>{t('event.seg_count', { n, c: Math.max(0, n - 1) })}</span>
        )}
      </div>
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

function SegTransportGrid({ value, onChange, color }) {
  const { t } = useI18nFormat();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 14 }}>
      {TRANSPORT_KINDS.map((k) => {
        const active = value === k.id; const Ic = k.Icon;
        return (
          <button key={k.id} type="button" onClick={() => onChange(k.id)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '10px 6px', background: active ? TYPE_META.transfer.soft : 'var(--surface)', border: '1.5px solid ' + (active ? color : 'var(--line-2)'), color: active ? color : 'var(--ink)', borderRadius: 10, cursor: 'pointer', fontWeight: 500, fontSize: 'var(--fs-micro)' }}>
            <Ic className="w-4 h-4" />{t(k.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function SegmentsEditor({ form, setForm, fromVisit, toVisit, setTime, color, aiSegFields, setAiSegFields, issues, onTouch }) {
  const { t } = useI18nFormat();
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
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

  const cardField = (node) => <div style={{ marginTop: 10 }}>{node}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {segs.map((seg, i) => {
        const isFirst = i === 0; const isLast = i === N - 1;
        const fromName = isFirst ? (fromVisit?.city_name || '-') : (segs[i - 1].toCity?.city_name || '…');
        const toName = isLast ? (toVisit?.city_name || '-') : (seg.toCity?.city_name || '…');
        const open = isOpen(seg, i);
        const tk = TRANSPORT_OF(seg.transport_type);
        const TIcon = tk.Icon;
        const layCity = seg.toCity?.city_name || '…';
        const layDate = fmtLocalDate(seg.endLocal);
        const layMins = isLast ? null : layoverMins(seg.endLocal, segs[i + 1]?.startLocal);
        const layDur = layMins != null ? fmtDur(layMins, t) : '';
        return (
          <React.Fragment key={seg.id}>
            <div style={{ border: '1px solid var(--line-2)', borderRadius: 12, background: 'var(--wash-2)', overflow: 'hidden' }}>
              {/* Collapsible header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
                <button type="button" onClick={() => toggleOpen(seg, i)}
                  style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 11, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, minWidth: 0 }}>
                  <span style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: TYPE_META.transfer.soft, color, display: 'grid', placeItems: 'center' }}>
                    <TIcon className="w-4 h-4" />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="eyebrow" style={{ color, display: 'block' }}>{t('event.segment_n', { n: i + 1 })} · {t(tk.labelKey)}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 'var(--fs-strong)', fontWeight: 600, color: 'var(--ink)', marginTop: 2 }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fromName}</span>
                      <ArrowRight className="w-3 h-3" style={{ color: 'var(--muted)', flexShrink: 0 }} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{toName}</span>
                    </span>
                  </span>
                  <span className="muted" style={{ fontSize: 'var(--fs-micro)', flexShrink: 0 }}>{open ? t('event.collapse') : t('event.expand')}</span>
                  <ChevronDown className="w-4 h-4" style={{ color: 'var(--muted)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
                </button>
                {N > 2 && (
                  <button type="button" className="btn btn--quiet btn--sm" onClick={() => removeSegment(i)} title={t('event.remove_segment')} style={{ flexShrink: 0 }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div style={{ display: open ? 'block' : 'none', padding: '4px 14px 14px', borderTop: '1px solid var(--line-2)' }}>
                <div style={{ height: 10 }} />
                <div className="eyebrow" style={{ margin: '2px 0 8px', color }}>{t('event.transport_kind')}</div>
                <SegTransportGrid value={seg.transport_type} onChange={(k) => patchSeg(i, { transport_type: k })} color={color} />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 14 }}>
                  <div style={{ padding: 14, background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--line-2)' }}>
                    <div className="eyebrow" style={{ marginBottom: 8, color }}>{t('event.from')}</div>
                    <div>
                      <Label>{t('event.city')}</Label>
                      <input className="input" value={fromName} readOnly tabIndex={-1} style={{ background: 'var(--wash)', color: 'var(--ink-2)', cursor: 'default' }} title={t('event.city_from_route_title')} />
                    </div>
                    {cardField(<><Label>{t('event.addr_station')}</Label><AiField active={aiOn(seg, 'from_address')}><AddressAutocomplete value={seg.from_address} onChange={(v) => patchSeg(i, { from_address: v })} placeholder={t('event.addr_ph')} /></AiField></>)}
                    {cardField(<div className={inv(`seg${i}.start`)} data-vfield={`seg${i}.start`}><Label>{t('event.departure_req')}</Label><AiField active={aiOn(seg, 'startLocal')}><DateTimeInput value={seg.startLocal} onChange={(v) => patchSeg(i, { startLocal: v })} onTimeMissingChange={(v) => setTime(`seg${i}-dep`, v)} className="w-full" /></AiField><FieldError issues={issues} field={`seg${i}.start`} /></div>)}
                  </div>
                  <div style={{ padding: 14, background: 'var(--surface)', borderRadius: 10, border: '1px solid var(--line-2)' }}>
                    <div className="eyebrow" style={{ marginBottom: 8, color }}>{t('event.to')}</div>
                    <div className={isLast ? '' : inv(`seg${i}.toCity`)} data-vfield={isLast ? undefined : `seg${i}.toCity`}>
                      <Label>{t('event.city')}</Label>
                      {isLast ? (
                        <input className="input" value={toName} readOnly tabIndex={-1} style={{ background: 'var(--wash)', color: 'var(--ink-2)', cursor: 'default' }} title={t('event.city_arrival_title')} />
                      ) : (
                        <>
                          <AiField active={aiOn(seg, 'toCity')}>
                            <CityPicker value={seg.toCity} onPick={(c) => patchSeg(i, { toCity: c })} placeholder={t('event.layover_city_ph')} />
                          </AiField>
                          <FieldError issues={issues} field={`seg${i}.toCity`} />
                        </>
                      )}
                    </div>
                    {cardField(<><Label>{t('event.addr_station')}</Label><AiField active={aiOn(seg, 'to_address')}><AddressAutocomplete value={seg.to_address} onChange={(v) => patchSeg(i, { to_address: v })} placeholder={t('event.addr_ph')} /></AiField></>)}
                    {cardField(<div className={inv(`seg${i}.end`)} data-vfield={`seg${i}.end`}><Label>{t('event.arrival_req')}</Label><AiField active={aiOn(seg, 'endLocal')}><DateTimeInput value={seg.endLocal} onChange={(v) => patchSeg(i, { endLocal: v })} onTimeMissingChange={(v) => setTime(`seg${i}-arr`, v)} className="w-full" /></AiField><FieldError issues={issues} field={`seg${i}.end`} /></div>)}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div><Label>{t('event.carrier')}</Label><AiField active={aiOn(seg, 'carrier')}><Input value={seg.carrier} onChange={(e) => patchSeg(i, { carrier: e.target.value })} placeholder={t('event.carrier_ph')} /></AiField></div>
                  <div><Label>{t('event.flight_train_no')}</Label><AiField active={aiOn(seg, 'flight_number')}><Input className="font-mono" value={seg.flight_number} onChange={(e) => patchSeg(i, { flight_number: e.target.value })} placeholder="TP 1379" /></AiField></div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 0.5fr', gap: 12 }}>
                  <div><Label>{t('event.price')}</Label><AiField active={aiOn(seg, 'price')}><Input type="number" step="0.01" value={seg.price} onChange={(e) => patchSeg(i, { price: e.target.value })} placeholder="0.00" /></AiField></div>
                  <div><Label>{t('event.currency')}</Label><CurrencyCombobox value={seg.currency} onChange={(v) => patchSeg(i, { currency: v })} /></div>
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', marginTop: 12, borderRadius: 10, border: '1px solid var(--line, hsl(var(--border)))', cursor: 'pointer' }}>
                  <Checkbox checked={!!seg.day_change} onCheckedChange={(v) => patchSeg(i, { day_change: !!v })} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600, fontSize: 'var(--fs-base)' }}>
                      <Moon className="w-4 h-4" /> {t('event.overnight_label')}
                    </span>
                    <span style={{ display: 'block', fontSize: 'var(--fs-micro)', color: 'var(--muted, #888)', marginTop: 2, lineHeight: 1.4 }}>{t('event.overnight_hint')}</span>
                  </span>
                </label>
              </div>
            </div>

            {!isLast && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
                <span style={{ width: 1, height: 14, background: 'var(--line)', marginLeft: 16 }} />
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 12px', borderRadius: 999, whiteSpace: 'nowrap', background: TYPE_META.transfer.soft, color, fontSize: 'var(--fs-meta)', fontWeight: 600 }}>
                  <Repeat className="w-3 h-3" style={{ flexShrink: 0 }} />
                  {t('event.layover_in', { city: '' }).replace(/\s*$/, '')}&nbsp;<span style={{ fontWeight: 700 }}>{layCity}</span>
                  {layDate && <span className="num" style={{ fontWeight: 600, opacity: 0.7 }}>· {layDate}</span>}
                  {layDur && <span className="num" style={{ fontWeight: 600, opacity: 0.7 }}>· {layDur}</span>}
                </span>
                <span style={{ flex: 1, height: 1, background: 'var(--line-2)' }} />
              </div>
            )}
          </React.Fragment>
        );
      })}

      <button type="button" onClick={addSegment}
        style={{ marginTop: 6, padding: '11px 14px', border: '1.5px dashed ' + color, borderRadius: 10, background: TYPE_META.transfer.soft, color, cursor: 'pointer', fontWeight: 600, fontSize: 'var(--fs-meta)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
        {t('event.add_layover')}
      </button>
    </div>
  );
}

function ActivityFields({ form, setField, setForm, aiFields, tz, setTime, issues, setUploading }) {
  const { t } = useI18nFormat();
  const color = TYPE_META.activity.color;
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
  return (
    <>
      <SectionHeader color={color}>{t('event.activity_about')}</SectionHeader>
      <div data-vfield="title" className={inv('title')}>
        <Label>{t('event.name_req')}</Label>
        <Input value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder={t('event.ph_activity_example')} />
        <FieldError issues={issues} field="title" />
      </div>
      <div className="mt-3">
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

      <SectionHeader color={color}>{t('event.when')}</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={`rounded-lg border bg-secondary/30 p-3 ${inv('start')}`} data-vfield="start">
          <div className="text-[length:var(--fs-micro)] uppercase tracking-wider font-semibold mb-1" style={{ color }}>{t('event.start')}</div>
          <DateTimeInput
            value={form.startLocal}
            onChange={(v) => setField('startLocal', v)}
            onTimeMissingChange={(v) => setTime('start', v)}
            className="w-full"
          />
          <TimezoneHint tz={tz} />
          <FieldError issues={issues} field="start" />
        </div>
        <div className={`rounded-lg border bg-secondary/30 p-3 ${inv('end')}`} data-vfield="end">
          <div className="text-[length:var(--fs-micro)] uppercase tracking-wider font-semibold mb-1" style={{ color }}>{t('event.end')}</div>
          <DateTimeInput
            value={form.endLocal}
            onChange={(v) => setField('endLocal', v)}
            onTimeMissingChange={(v) => setTime('end', v)}
            className="w-full"
          />
          <TimezoneHint tz={tz} />
          <FieldError issues={issues} field="end" />
        </div>
      </div>

      <SectionHeader color={color}>{t('event.cost')}</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>{t('event.price')}</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>{t('event.currency')}</Label>
          <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
        </div>
      </div>

      <SectionHeader color={color}>{t('event.docs_notes')}</SectionHeader>
      <DocumentsField
        value={form.documents}
        onChange={(docs) => setField('documents', docs)}
        onUploadingChange={setUploading}
        bare
        iconColor="text-violet-600 dark:text-violet-300"
      />
      <div className="mt-3">
        <Label>{t('event.notes')}</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('event.notes_ph')} />
      </div>
    </>
  );
}

function ServiceFields({ form, setField, setForm, aiFields, setTime, issues, isEdit, setUploading }) {
  const { t } = useI18nFormat();
  const platformInfo = form.booking_platform ? BOOKING_PLATFORMS[form.booking_platform] : null;
  const platformLogo = platformLogoUrl(form.booking_platform, form.booking_url);
  const color = TYPE_META.service.color;
  const inv = (f) => (fieldHasError(issues, f) ? 'tv-invalid' : '');
  return (
    <>
      <SectionHeader color={color}>{t('event.car_section')}</SectionHeader>
      <div data-vfield="name" className={inv('name')}>
        <Label>{t('event.company_name_req')}</Label>
        <Input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder={t('event.ph_car_example')} autoFocus />
        <FieldError issues={issues} field="name" />
      </div>

      <SectionHeader color={color}>{t('event.pickup')}</SectionHeader>
      <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
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
              const tzResolved = await resolveTimezoneFromCoords(p.latitude, p.longitude);
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
      <div className="rounded-lg border bg-secondary/30 p-3 mb-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={form.return_different_location}
            onCheckedChange={(v) => setField('return_different_location', v === true)}
          />
          <span className="text-sm font-medium">{t('event.return_diff_place')}</span>
          {!form.return_different_location && (
            <span className="text-xs text-muted-foreground">{t('event.return_same_suffix')}</span>
          )}
        </label>
      </div>
      <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
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
                const tzResolved = await resolveTimezoneFromCoords(p.latitude, p.longitude);
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>{t('event.price')}</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>{t('event.currency')}</Label>
          <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>{t('event.booking_url')}</Label>
          <div className="relative">
            {platformLogo && (
              <img src={platformLogo} alt="" className="w-5 h-5 absolute left-2.5 top-1/2 -translate-y-1/2 rounded-sm" />
            )}
            <Input
              value={form.booking_url}
              onChange={(e) => setField('booking_url', e.target.value)}
              placeholder="https://..."
              className={platformLogo ? 'pl-9' : ''}
            />
          </div>
          {platformInfo && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${platformInfo.color}`}>
                {platformLogo && <img src={platformLogo} alt="" className="w-3.5 h-3.5 rounded-sm" />}
                {platformInfo.labelKey ? t(platformInfo.labelKey) : platformInfo.label}
              </span>
              {form.booking_url && (
                <a href={withScheme(form.booking_url)} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />{t('common.open')}
                </a>
              )}
            </div>
          )}
        </div>
        <div>
          <Label>{t('event.booking_ref')}</Label>
          <Input className="font-mono" value={form.booking_reference} onChange={(e) => setField('booking_reference', e.target.value)} placeholder="-" />
        </div>
      </div>

      <SectionHeader color={color}>{t('event.docs_notes')}</SectionHeader>
      <DocumentsField
        value={form.documents}
        onChange={(docs) => setField('documents', docs)}
        onUploadingChange={setUploading}
        bare
        iconColor="text-emerald-700 dark:text-emerald-300"
      />
      <div className="mt-3">
        <Label>{t('event.notes')}</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder={t('event.notes_ph_car')} />
      </div>
    </>
  );
}
