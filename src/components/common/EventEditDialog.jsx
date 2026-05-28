/**
 * EventEditDialog — unified create/edit modal for hotel / transfer / activity /
 * car-rental (service kind="car_rental"). Replaces the four legacy dialogs
 * (HotelDialog, TransferDialog, ActivityDialog, CarRentalDialog).
 *
 * The four "kinds" share a single chrome (colour stripe + header + footer +
 * shared AI block) but each renders its own field group. In create mode the
 * top type-picker lets the user switch between kinds — the form is reset to
 * the new kind's EMPTY shape on switch.
 *
 * Simple service kinds (esim, insurance) still go through the legacy
 * ServiceDialog — they're a single name+price form and don't fit this layout.
 *
 * Visual reference: designer's prototype `event-edit.jsx`.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CurrencyCombobox from '@/components/ui/CurrencyCombobox';
import AiField from '@/components/ui/AiField';
import {
  Loader2, Sparkles, Trash2, ExternalLink, AlertTriangle,
  Bed, Plane, Camera, Car as CarIcon, Train, Bus, Ship, Footprints,
} from 'lucide-react';
import { DateTime } from 'luxon';

import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localToUtc, utcToLocalInput } from '@/lib/time';
import { hotelWarnings, transferWarnings, activityWarnings } from '@/lib/validation';
import { detectPlatformFromUrl, BOOKING_PLATFORMS, platformLogoUrl } from '@/lib/booking-platforms';
import { getEntityDocuments, getDetailsDocuments } from '@/lib/documents';
import { invalidateTripData, optimisticContentUpdate } from '@/lib/trip-data';
import { resolveTimezoneFromCoords } from '@/lib/timezone-resolver';
import { useToast } from '@/components/ui/use-toast';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

import DateTimeInput from '@/components/common/DateTimeInput';
import TimezoneHint from '@/components/common/TimezoneHint';
import DocumentsField from '@/components/common/DocumentsField';
import AddressAutocomplete from '@/components/common/AddressAutocomplete';
import EventAiBlock from '@/components/common/EventAiBlock';

// ─────────────────────────────────────────────────────────────────────────────
//  Type metadata — colours, icons, copy
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_META = {
  hotel: {
    color: 'var(--ev-hotel)', soft: 'var(--ev-hotel-soft)',
    Icon: Bed, label: 'Отель',
    titleNew: 'Новый отель', titleEdit: 'Редактировать отель',
  },
  transfer: {
    color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)',
    Icon: Plane, label: 'Трансфер',
    titleNew: 'Новый переезд', titleEdit: 'Редактировать переезд',
  },
  activity: {
    color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)',
    Icon: Camera, label: 'Активность',
    titleNew: 'Новая активность', titleEdit: 'Редактировать активность',
  },
  service: {
    color: 'var(--ev-car)', soft: 'var(--ev-car-soft)',
    Icon: CarIcon, label: 'Аренда авто',
    titleNew: 'Новая аренда авто', titleEdit: 'Редактировать аренду',
  },
};

const TABLE_BY_KIND = {
  hotel: 'hotel_stays',
  transfer: 'transfers',
  activity: 'activities',
  service: 'trip_services',
};

const TRANSPORT_KINDS = [
  { id: 'plane', Icon: Plane,      label: 'Самолёт' },
  { id: 'train', Icon: Train,      label: 'Поезд' },
  { id: 'bus',   Icon: Bus,        label: 'Автобус' },
  { id: 'car',   Icon: CarIcon,    label: 'На авто' },
  { id: 'ferry', Icon: Ship,       label: 'Паром' },
  { id: 'walk',  Icon: Footprints, label: 'Пешком' },
];

// ─────────────────────────────────────────────────────────────────────────────
//  Empty form factories — one per kind. Edit mode hydrates from the entity.
// ─────────────────────────────────────────────────────────────────────────────

function emptyHotelForm() {
  return {
    name: '', address: '',
    latitude: null, longitude: null,
    checkInLocal: '', checkOutLocal: '',
    booking_reference: '', payment_status: '', price: '', currency: 'EUR',
    free_cancellation: false, free_cancellation_until_local: '',
    phone: '', email: '',
    booking_url: '', booking_platform: '',
    documents: [], notes: '',
  };
}

function emptyTransferForm() {
  return {
    transport_type: 'plane',
    startLocal: '', endLocal: '',
    from_address: '', from_latitude: null, from_longitude: null,
    to_address: '',   to_latitude: null,   to_longitude: null,
    carrier: '',
    flight_number: '',
    booking_reference: '',
    booking_url: '', booking_platform: '',
    price: '', currency: 'EUR',
    documents: [], notes: '',
  };
}

function emptyActivityForm() {
  return {
    title: '',
    startLocal: '', endLocal: '',
    location_address: '',
    location_latitude: null,
    location_longitude: null,
    price: '', currency: 'EUR',
    documents: [], notes: '',
  };
}

function emptyServiceForm() {
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
    price: '', currency: 'EUR',
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

// New-mode date defaults — same logic as the legacy dialogs.
function defaultsForNewHotel(visit, tz) {
  if (!visit?.start_datetime || !visit?.end_datetime) return emptyHotelForm();
  const vs = DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz);
  const ve = DateTime.fromISO(visit.end_datetime, { zone: 'utc' }).setZone(tz);
  const ci = vs.set({ hour: Math.max(vs.hour, 15), minute: 0 });
  let co = ve.set({ hour: Math.min(ve.hour, 11), minute: 0 });
  if (co <= ci) co = ci.plus({ hours: 1 });
  return {
    ...emptyHotelForm(),
    checkInLocal: ci.toFormat("yyyy-LL-dd'T'HH:mm"),
    checkOutLocal: co.toFormat("yyyy-LL-dd'T'HH:mm"),
  };
}

function defaultsForNewTransfer(fromVisit, toVisit, startTz, endTz) {
  const baseStart = fromVisit?.end_datetime || toVisit?.start_datetime;
  const baseEnd = toVisit?.start_datetime || fromVisit?.end_datetime;
  const startDt = baseStart
    ? DateTime.fromISO(baseStart, { zone: 'utc' }).setZone(startTz).set({ hour: 12, minute: 0 })
    : null;
  const endDt = baseEnd
    ? DateTime.fromISO(baseEnd, { zone: 'utc' }).setZone(endTz).set({ hour: 15, minute: 0 })
    : null;
  return {
    ...emptyTransferForm(),
    startLocal: startDt ? startDt.toFormat("yyyy-LL-dd'T'HH:mm") : '',
    endLocal: endDt ? endDt.toFormat("yyyy-LL-dd'T'HH:mm") : '',
  };
}

function defaultsForNewActivity(visit, tz, defaultStart) {
  if (!visit?.start_datetime) return emptyActivityForm();
  const visitStart = DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz);
  const proposed = defaultStart
    ? DateTime.fromISO(defaultStart, { zone: 'utc' }).setZone(tz)
    : visitStart.set({ hour: 10, minute: 0 });
  const start = proposed < visitStart ? visitStart : proposed;
  const end = start.plus({ hours: 2 });
  return {
    ...emptyActivityForm(),
    startLocal: start.toFormat("yyyy-LL-dd'T'HH:mm"),
    endLocal: end.toFormat("yyyy-LL-dd'T'HH:mm"),
  };
}

function buildInitialForm(kind, entity, ctx) {
  const { visit, fromVisit, toVisit, defaultStart } = ctx;
  const tz = visit?.timezone || 'UTC';
  const startTz = fromVisit?.timezone || 'UTC';
  const endTz = toVisit?.timezone || 'UTC';
  if (entity) {
    if (kind === 'hotel') return hotelToForm(entity, tz);
    if (kind === 'transfer') return transferToForm(entity, startTz, endTz);
    if (kind === 'activity') return activityToForm(entity, tz);
    if (kind === 'service') return serviceToForm(entity);
  }
  if (kind === 'hotel') return defaultsForNewHotel(visit, tz);
  if (kind === 'transfer') return defaultsForNewTransfer(fromVisit, toVisit, startTz, endTz);
  if (kind === 'activity') return defaultsForNewActivity(visit, tz, defaultStart);
  return emptyServiceForm();
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
}) {
  const { t } = useI18nFormat();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();

  // currentKind defaults to the prop in create mode, or to the prop in edit mode
  // too (the parent always tells us the right kind for the entity it passed).
  const [currentKind, setCurrentKind] = useState(initialKind || 'hotel');
  const isEdit = !!entity;
  const meta = TYPE_META[currentKind] || TYPE_META.hotel;
  const tripId = tripIdProp || entity?.trip_id || visit?.trip_id || fromVisit?.trip_id;

  // Timezones — kept for compatibility but the time helpers ignore them
  // since the app now stores naive wall-clock values. Still passed to the
  // TimezoneHint component so the hint label shows the right city.
  const tz = visit?.timezone || 'UTC';
  const startTz = fromVisit?.timezone || 'UTC';
  const endTz = toVisit?.timezone || 'UTC';

  const [form, setForm] = useState(() =>
    buildInitialForm(initialKind || 'hotel', entity, { visit, fromVisit, toVisit, defaultStart })
  );
  const [aiFields, setAiFields] = useState(new Set());
  // Six-state AI flow per the prototype: locked / available / idle /
  // uploaded / parsing / parsed. Starts as 'available' for Pro users once
  // checkSubscriptionStatus resolves; non-Pro lands in 'locked'.
  const [aiState, setAiState] = useState('available');

  // Pro state: null = checking, true/false = resolved.
  const [isPro, setIsPro] = useState(null);

  const [confirmDel, setConfirmDel] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Extra transfer segments captured from AI parsing (the AI may detect a
  // multi-leg booking; the additional legs get inserted as separate Transfer
  // rows on save). Empty when AI returns a single segment.
  const [extraSegments, setExtraSegments] = useState([]);

  // Time-missing flags for individual datetime-local inputs (the native input
  // returns "" when only a date is entered — DateTimeInput reports this so we
  // can keep Save disabled until a time is also picked).
  const [timeMissing, setTimeMissing] = useState({});
  const anyTimeMissing = Object.values(timeMissing).some(Boolean);

  // Re-hydrate form whenever the dialog opens or the entity prop changes.
  useEffect(() => {
    if (!open) return;
    const k = initialKind || 'hotel';
    setCurrentKind(k);
    setForm(buildInitialForm(k, entity, { visit, fromVisit, toVisit, defaultStart }));
    setAiFields(new Set());
    setExtraSegments([]);
    setTimeMissing({});
  }, [open, entity?.id, initialKind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pro check — runs whenever the dialog opens with a tripId we can verify.
  useEffect(() => {
    if (!open) { setIsPro(null); return; }
    if (!tripId) { setIsPro(false); return; }
    let cancelled = false;
    setIsPro(null);
    supabase.functions.invoke('checkSubscriptionStatus', { body: { tripId } })
      .then((res) => { if (!cancelled) setIsPro(!!res.data?.isPro); })
      .catch((e) => { console.error(e); if (!cancelled) setIsPro(false); });
    return () => { cancelled = true; };
  }, [open, tripId]);

  // Sync AI block to Pro state — only when not mid-flow (idle/uploaded/parsing/parsed).
  useEffect(() => {
    if (isPro === null) return;
    setAiState((prev) => {
      if (prev === 'idle' || prev === 'uploaded' || prev === 'parsing' || prev === 'parsed') return prev;
      return isPro ? 'available' : 'locked';
    });
  }, [isPro]);

  // Auto-detect booking platform when URL changes.
  useEffect(() => {
    if (!form.booking_url) return;
    const p = detectPlatformFromUrl(form.booking_url);
    if (p && p !== form.booking_platform) {
      setForm((prev) => ({ ...prev, booking_platform: p }));
    }
  }, [form.booking_url]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setAiFields((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev); next.delete(key); return next;
    });
  };

  const setTime = (key, missing) => {
    setTimeMissing((prev) => (prev[key] === missing ? prev : { ...prev, [key]: missing }));
  };

  // Type switcher — only enabled in create mode.
  const switchKind = (k) => {
    if (isEdit) return;
    setCurrentKind(k);
    setForm(buildInitialForm(k, null, { visit, fromVisit, toVisit, defaultStart }));
    setAiFields(new Set());
    setExtraSegments([]);
    setTimeMissing({});
  };

  const openUpgrade = () => {
    onOpenChange?.(false);
    nav(`/pro?tripId=${tripId || ''}`);
  };

  // ── Date order validation per kind ─────────────────────────────────────
  const dateOrderError = useMemo(() => {
    if (currentKind === 'hotel') {
      const a = localToUtc(form.checkInLocal, tz);
      const b = localToUtc(form.checkOutLocal, tz);
      return a && b && new Date(a).getTime() >= new Date(b).getTime();
    }
    if (currentKind === 'transfer' || currentKind === 'activity') {
      const a = localToUtc(form.startLocal, tz);
      const b = localToUtc(form.endLocal, tz);
      return a && b && new Date(a).getTime() >= new Date(b).getTime();
    }
    if (currentKind === 'service') {
      if (!form.pickup_at_local || !form.dropoff_at_local) return false;
      return new Date(form.pickup_at_local).getTime() >= new Date(form.dropoff_at_local).getTime();
    }
    return false;
  }, [currentKind, form, tz]);

  // Hotel-specific: warn if dates fall outside visit window (in tz days).
  const hotelRangeError = useMemo(() => {
    if (currentKind !== 'hotel' || !visit) return null;
    const dayOf = (iso) => iso
      ? DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd')
      : null;
    const ci = localToUtc(form.checkInLocal, tz);
    const co = localToUtc(form.checkOutLocal, tz);
    const ciDay = dayOf(ci), coDay = dayOf(co);
    const vsDay = dayOf(visit.start_datetime), veDay = dayOf(visit.end_datetime);
    if (ciDay && vsDay && ciDay < vsDay) return t('hotel.range_checkin_before');
    if (coDay && veDay && coDay > veDay) return t('hotel.range_checkout_after');
    return null;
  }, [currentKind, form.checkInLocal, form.checkOutLocal, visit, tz, t]);

  // Soft warnings — same helpers the legacy dialogs use.
  const warnings = useMemo(() => {
    if (currentKind === 'hotel') {
      const draft = {
        id: entity?.id,
        check_in_datetime: localToUtc(form.checkInLocal, tz),
        check_out_datetime: localToUtc(form.checkOutLocal, tz),
        name: form.name,
      };
      return hotelWarnings(draft, visit, []);
    }
    if (currentKind === 'transfer') {
      const draft = {
        id: entity?.id,
        start_datetime: localToUtc(form.startLocal, startTz),
        end_datetime: localToUtc(form.endLocal, endTz),
      };
      return transferWarnings(draft, fromVisit, toVisit);
    }
    if (currentKind === 'activity') {
      const draft = {
        id: entity?.id,
        start_datetime: localToUtc(form.startLocal, tz),
        end_datetime: localToUtc(form.endLocal, tz),
      };
      return activityWarnings(draft, visit);
    }
    return [];
  }, [currentKind, form, tz, startTz, endTz, entity, visit, fromVisit, toVisit]);

  // ── Save validity ──────────────────────────────────────────────────────
  const canSave = useMemo(() => {
    if (dateOrderError || anyTimeMissing || uploading) return false;
    if (currentKind === 'hotel') {
      return !!form.name?.trim() && !hotelRangeError;
    }
    if (currentKind === 'transfer') {
      return !!form.startLocal && !!form.endLocal;
    }
    if (currentKind === 'activity') {
      return !!form.title?.trim() && !!form.startLocal;
    }
    if (currentKind === 'service') {
      return !!form.name?.trim() && (isEdit || !!form.pickup_address?.trim());
    }
    return false;
  }, [currentKind, form, dateOrderError, anyTimeMissing, uploading, hotelRangeError, isEdit]);

  // ── Save mutation ──────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: async () => {
      if (currentKind === 'hotel') {
        const payload = buildHotelPayload(form, visit, tz);
        return upsert('hotel_stays', entity, payload, user);
      }
      if (currentKind === 'transfer') {
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
              start_datetime: localToUtc(seg.start_datetime, startTz),
              end_datetime: localToUtc(seg.end_datetime, endTz),
              carrier: seg.carrier || undefined,
              booking_reference: seg.booking_reference || undefined,
              booking_url: form.booking_url || undefined,
              booking_platform: form.booking_platform || undefined,
              from_address: seg.from_address || undefined,
              to_address: seg.to_address || undefined,
              price: seg.price === '' || seg.price == null ? undefined : Number(seg.price),
              currency: seg.currency || 'EUR',
              details: {},
              created_by: user?.email,
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
        title: 'Не удалось сохранить',
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
        title: 'Не удалось удалить',
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
    if (typeof data.price === 'number') setIf('price', data.price);
    setIf('currency', data.currency);
    if (typeof data.free_cancellation === 'boolean') {
      upd.free_cancellation = data.free_cancellation;
      filled.add('free_cancellation');
    }
    setIf('phone', data.phone);
    setIf('email', data.email);
    setIf('booking_url', data.booking_url);
    setIf('booking_platform', data.booking_platform);
    const combine = (d, t2) => {
      if (!d) return '';
      const time = t2 && /^\d{1,2}:\d{2}/.test(t2) ? t2.padStart(5, '0').slice(0, 5) : '00:00';
      return `${d}T${time}`;
    };
    if (data.check_in_date)  { upd.checkInLocal = combine(data.check_in_date,  data.check_in_time);  filled.add('checkInLocal'); }
    if (data.check_out_date) { upd.checkOutLocal = combine(data.check_out_date, data.check_out_time); filled.add('checkOutLocal'); }
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

  const handleTransferExtract = (data, fileUrl, fileName) => {
    const filled = new Set();
    const upd = { ...form };
    const setIf = (k, v) => { if (v != null && v !== '') { upd[k] = v; filled.add(k); } };
    setIf('booking_url', data.booking_url);
    setIf('booking_platform', data.booking_platform);
    const segments = Array.isArray(data.segments) && data.segments.length > 0 ? data.segments : [data];
    const first = segments[0] || {};
    setIf('carrier', first.carrier);
    setIf('booking_reference', first.booking_reference);
    setIf('from_address', first.from_address);
    setIf('to_address', first.to_address);
    if (typeof first.price === 'number') setIf('price', first.price);
    setIf('currency', first.currency);
    const combine = (d, t2) => {
      if (!d) return '';
      const time = t2 && /^\d{1,2}:\d{2}/.test(t2) ? t2.padStart(5, '0').slice(0, 5) : '00:00';
      return `${d}T${time}`;
    };
    if (first.departure_date) { upd.startLocal = combine(first.departure_date, first.departure_time); filled.add('startLocal'); }
    if (first.arrival_date)   { upd.endLocal   = combine(first.arrival_date,   first.arrival_time);   filled.add('endLocal'); }
    if (Array.isArray(data.documents) && data.documents.length > 0) {
      upd.documents = [...(upd.documents || []), ...data.documents].slice(0, 50);
      filled.add('documents');
    } else if (fileUrl) {
      upd.documents = [...(upd.documents || []), { file_url: fileUrl, file_name: fileName || '' }];
      filled.add('documents');
    }
    if (first.transport_type && TRANSPORT_KINDS.some((k) => k.id === first.transport_type)) {
      upd.transport_type = first.transport_type;
      filled.add('transport_type');
    }
    // Stash additional segments — created as their own rows on save.
    setExtraSegments(segments.slice(1, 6).map((s) => ({
      transport_type: TRANSPORT_KINDS.some((k) => k.id === s.transport_type) ? s.transport_type : (first.transport_type || 'plane'),
      start_datetime: s.departure_date ? combine(s.departure_date, s.departure_time) : '',
      end_datetime:   s.arrival_date   ? combine(s.arrival_date,   s.arrival_time)   : '',
      carrier: s.carrier || '',
      booking_reference: s.booking_reference || '',
      from_address: s.from_address || '',
      to_address: s.to_address || '',
      price: typeof s.price === 'number' ? s.price : '',
      currency: s.currency || first.currency || 'EUR',
    })));
    setForm(upd);
    setAiFields(filled);
    setAiState('parsed');
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="p-0 max-w-2xl max-h-[90vh] overflow-y-auto gap-0 w-[calc(100%-1rem)] sm:w-full">
          {/* 4px colour stripe */}
          <div style={{ height: 4, background: meta.color }} />

          {/* Header */}
          <div
            className="border-b"
            style={{ padding: '16px 22px 14px', background: meta.soft, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
          >
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
              <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                {meta.label}
              </div>
              <h2 className="font-display text-xl leading-tight" style={{ letterSpacing: '-0.02em' }}>
                {isEdit ? meta.titleEdit : meta.titleNew}
              </h2>
            </div>
          </div>

          {/* Inline delete-confirm view — replaces the form when active to
              avoid nesting Radix modals (which would intercept pointer
              events on the inner buttons). */}
          {confirmDel ? (
            <div style={{ padding: 22 }}>
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-destructive/15 text-destructive grid place-items-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-semibold text-base">Удалить {meta.label.toLowerCase()}?</div>
                  <div className="text-sm text-muted-foreground mt-1">
                    Это действие необратимо. Запись будет удалена из трипа и хронологии.
                  </div>
                </div>
              </div>
            </div>
          ) : (
          /* Body */
          <div style={{ padding: 22 }}>
            {/* AI block — only for hotel & transfer (the kinds with parsers). */}
            {(currentKind === 'hotel' || currentKind === 'transfer') && (
              <EventAiBlock
                kind={currentKind}
                state={aiState}
                setState={setAiState}
                onExtract={currentKind === 'hotel' ? handleHotelExtract : handleTransferExtract}
                onUpgrade={openUpgrade}
                parsedFieldCount={aiFields.size}
                onReset={() => { setAiFields(new Set()); setExtraSegments([]); }}
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
                  dateOrderError={dateOrderError}
                  hotelRangeError={hotelRangeError}
                  setUploading={setUploading}
                />
              )}
              {currentKind === 'transfer' && (
                <TransferFields
                  form={form}
                  setField={setField}
                  aiFields={aiFields}
                  fromVisit={fromVisit}
                  toVisit={toVisit}
                  startTz={startTz}
                  endTz={endTz}
                  setTime={setTime}
                  dateOrderError={dateOrderError}
                  extraSegments={extraSegments}
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
                  dateOrderError={dateOrderError}
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
                  dateOrderError={dateOrderError}
                  isEdit={isEdit}
                  setUploading={setUploading}
                />
              )}

              {warnings.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-3 text-sm text-amber-900 dark:text-amber-200 space-y-1">
                  {warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{w}
                    </div>
                  ))}
                </div>
              )}
            </fieldset>
          </div>
          )}

          {/* Footer */}
          <div
            className="border-t bg-secondary/30"
            style={{ padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            {confirmDel ? (
              <>
                <div style={{ flex: 1 }} />
                <Button variant="outline" onClick={() => setConfirmDel(false)} disabled={deleteMut.isPending}>
                  Отмена
                </Button>
                <Button
                  onClick={() => deleteMut.mutate()}
                  disabled={deleteMut.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleteMut.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />Удалить
                </Button>
              </>
            ) : (
              <>
                {isEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDel(true)}
                    disabled={deleteMut.isPending}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />Удалить
                  </Button>
                )}
                <div style={{ flex: 1 }} />
                <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
                <Button
                  onClick={() => saveMut.mutate()}
                  disabled={!canSave || saveMut.isPending}
                  style={{ background: meta.color, borderColor: meta.color }}
                >
                  {saveMut.isPending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
                  {isEdit ? 'Сохранить' : 'Создать'}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Payload builders — one per kind. Mirrors the legacy dialogs' columns plus
//  the new lat/lng + flight_number additions.
// ─────────────────────────────────────────────────────────────────────────────

async function upsert(table, entity, payload, user) {
  if (entity) {
    const { data, error } = await supabase.from(table).update(payload).eq('id', entity.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase.from(table).insert({ ...payload, created_by: user?.email }).select().single();
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
    booking_url: form.booking_url || undefined,
    booking_platform: form.booking_platform || undefined,
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
    booking_url: form.booking_url || undefined,
    booking_platform: form.booking_platform || undefined,
    price: form.price === '' ? null : Number(form.price),
    currency: form.currency || 'EUR',
    documents: Array.isArray(form.documents) ? form.documents : [],
    voucher_file_url: '',
    voucher_file_name: '',
    notes: form.notes,
    details: {},
  };
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
    // Top-level UTC columns mirror details.pickup_at_local/dropoff_at_local —
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
      booking_url: form.booking_url || undefined,
      booking_platform: form.booking_platform || undefined,
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

function SectionHeader({ children, color }) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-3">
      <div style={{ width: 3, height: 14, background: color, borderRadius: 2 }} />
      <h3 className="text-sm font-semibold m-0">{children}</h3>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Field groups per kind
// ─────────────────────────────────────────────────────────────────────────────

function HotelFields({ form, setField, aiFields, tz, setTime, dateOrderError, hotelRangeError, setUploading }) {
  const platformInfo = form.booking_platform ? BOOKING_PLATFORMS[form.booking_platform] : null;
  const platformLogo = platformLogoUrl(form.booking_platform, form.booking_url);
  const color = TYPE_META.hotel.color;
  return (
    <>
      <SectionHeader color={color}>Об отеле</SectionHeader>
      <div className="space-y-3">
        <div>
          <Label>Название *</Label>
          <AiField active={aiFields.has('name')}>
            <Input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Memmo Alfama" />
          </AiField>
        </div>
        <div>
          <Label>Адрес</Label>
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

      <SectionHeader color={color}>Заезд и выезд</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <Label>Заезд *</Label>
          <AiField active={aiFields.has('checkInLocal')}>
            <DateTimeInput
              value={form.checkInLocal}
              onChange={(v) => setField('checkInLocal', v)}
              onTimeMissingChange={(v) => setTime('checkIn', v)}
              className="w-full"
            />
          </AiField>
          <TimezoneHint tz={tz} />
        </div>
        <div className="min-w-0">
          <Label>Выезд *</Label>
          <AiField active={aiFields.has('checkOutLocal')}>
            <DateTimeInput
              value={form.checkOutLocal}
              onChange={(v) => setField('checkOutLocal', v)}
              onTimeMissingChange={(v) => setTime('checkOut', v)}
              className="w-full"
            />
          </AiField>
          <TimezoneHint tz={tz} />
        </div>
      </div>
      {dateOrderError && (
        <p className="mt-1 text-xs text-destructive">Дата выезда должна быть после заезда.</p>
      )}
      {hotelRangeError && (
        <p className="mt-1 text-xs text-destructive">{hotelRangeError}</p>
      )}

      <SectionHeader color={color}>Финансы и отмена</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <Label>Цена</Label>
          <AiField active={aiFields.has('price')}>
            <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
          </AiField>
        </div>
        <div>
          <Label>Валюта</Label>
          <AiField active={aiFields.has('currency')}>
            <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
          </AiField>
        </div>
        <div>
          <Label>Статус оплаты</Label>
          <AiField active={aiFields.has('payment_status')}>
            <Select value={form.payment_status} onValueChange={(v) => setField('payment_status', v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="paid">Оплачено</SelectItem>
                <SelectItem value="partial">Частично</SelectItem>
                <SelectItem value="pay_on_arrival">По прибытии</SelectItem>
              </SelectContent>
            </Select>
          </AiField>
        </div>
      </div>
      <AiField active={aiFields.has('free_cancellation')}>
        <div className="rounded-lg border bg-secondary/30 p-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <Checkbox checked={form.free_cancellation} onCheckedChange={(v) => setField('free_cancellation', !!v)} />
            <div className="flex-1">
              <div className="text-sm font-medium">Есть бесплатная отмена</div>
              <div className="text-xs text-muted-foreground">До какой даты можно отменить без штрафа</div>
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

      <SectionHeader color={color}>Бронирование</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>Ссылка на бронирование</Label>
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
                {platformInfo.label}
              </span>
              {form.booking_url && (
                <a href={form.booking_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />Открыть
                </a>
              )}
            </div>
          )}
        </div>
        <div>
          <Label>Номер брони</Label>
          <AiField active={aiFields.has('booking_reference')}>
            <Input className="font-mono" value={form.booking_reference} onChange={(e) => setField('booking_reference', e.target.value)} placeholder="—" />
          </AiField>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>Телефон</Label>
          <AiField active={aiFields.has('phone')}>
            <Input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+351 …" />
          </AiField>
        </div>
        <div>
          <Label>E-mail</Label>
          <AiField active={aiFields.has('email')}>
            <Input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)} placeholder="—" />
          </AiField>
        </div>
      </div>

      <SectionHeader color={color}>Документы и заметки</SectionHeader>
      <AiField active={aiFields.has('documents')}>
        <DocumentsField
          value={form.documents}
          onChange={(docs) => setField('documents', docs)}
          onUploadingChange={setUploading}
          label="Документы"
          iconColor="text-primary"
        />
      </AiField>
      <div className="mt-3">
        <Label>Заметки</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Свободные заметки…" />
      </div>
    </>
  );
}

function TransferFields({ form, setField, aiFields, fromVisit, toVisit, startTz, endTz, setTime, dateOrderError, extraSegments, setUploading }) {
  const platformInfo = form.booking_platform ? BOOKING_PLATFORMS[form.booking_platform] : null;
  const platformLogo = platformLogoUrl(form.booking_platform, form.booking_url);
  const color = TYPE_META.transfer.color;
  return (
    <>
      <SectionHeader color={color}>Вид транспорта</SectionHeader>
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
                fontWeight: 500, fontSize: 11.5,
              }}
            >
              <Ic className="w-4 h-4" />
              {k.label}
            </button>
          );
        })}
      </div>

      <SectionHeader color={color}>Откуда и куда</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color }}>Откуда</div>
          <div>
            <Label>Адрес / станция</Label>
            <AiField active={aiFields.has('from_address')}>
              <AddressAutocomplete
                value={form.from_address}
                onChange={(v) => setField('from_address', v)}
                onPlaceSelected={(p) => {
                  setField('from_address', p.formatted_address || p.description || form.from_address);
                  if (p.latitude != null) setField('from_latitude', p.latitude);
                  if (p.longitude != null) setField('from_longitude', p.longitude);
                }}
                placeholder="Аэропорт, станция, адрес"
              />
            </AiField>
          </div>
          <div>
            <Label>Отправление *</Label>
            <AiField active={aiFields.has('startLocal')}>
              <DateTimeInput
                value={form.startLocal}
                onChange={(v) => setField('startLocal', v)}
                onTimeMissingChange={(v) => setTime('start', v)}
                className="w-full"
              />
            </AiField>
            <TimezoneHint tz={startTz} />
          </div>
        </div>
        <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wider font-semibold" style={{ color }}>Куда</div>
          <div>
            <Label>Адрес / станция</Label>
            <AiField active={aiFields.has('to_address')}>
              <AddressAutocomplete
                value={form.to_address}
                onChange={(v) => setField('to_address', v)}
                onPlaceSelected={(p) => {
                  setField('to_address', p.formatted_address || p.description || form.to_address);
                  if (p.latitude != null) setField('to_latitude', p.latitude);
                  if (p.longitude != null) setField('to_longitude', p.longitude);
                }}
                placeholder="Аэропорт, станция, адрес"
              />
            </AiField>
          </div>
          <div>
            <Label>Прибытие *</Label>
            <AiField active={aiFields.has('endLocal')}>
              <DateTimeInput
                value={form.endLocal}
                onChange={(v) => setField('endLocal', v)}
                onTimeMissingChange={(v) => setTime('end', v)}
                className="w-full"
              />
            </AiField>
            <TimezoneHint tz={endTz} />
          </div>
        </div>
      </div>
      {dateOrderError && (
        <p className="mt-1 text-xs text-destructive">Прибытие должно быть позже отправления.</p>
      )}

      <SectionHeader color={color}>Перевозчик и бронь</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>Перевозчик</Label>
          <AiField active={aiFields.has('carrier')}>
            <Input value={form.carrier} onChange={(e) => setField('carrier', e.target.value)} placeholder="TAP Air Portugal" />
          </AiField>
        </div>
        <div>
          <Label>Номер рейса / поезда</Label>
          <AiField active={aiFields.has('flight_number')}>
            <Input className="font-mono" value={form.flight_number} onChange={(e) => setField('flight_number', e.target.value)} placeholder="TP 1379" />
          </AiField>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>Ссылка на бронирование</Label>
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
                {platformInfo.label}
              </span>
              {form.booking_url && (
                <a href={form.booking_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />Открыть
                </a>
              )}
            </div>
          )}
        </div>
        <div>
          <Label>Номер брони</Label>
          <AiField active={aiFields.has('booking_reference')}>
            <Input className="font-mono" value={form.booking_reference} onChange={(e) => setField('booking_reference', e.target.value)} placeholder="—" />
          </AiField>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>Цена</Label>
          <AiField active={aiFields.has('price')}>
            <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
          </AiField>
        </div>
        <div>
          <Label>Валюта</Label>
          <AiField active={aiFields.has('currency')}>
            <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
          </AiField>
        </div>
      </div>

      {extraSegments.length > 0 && (
        <div className="mt-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-primary">
            <Sparkles className="w-4 h-4" />ИИ нашёл ещё {extraSegments.length} {extraSegments.length === 1 ? 'сегмент' : 'сегмента'}
          </div>
          <div className="text-xs text-muted-foreground">
            Дополнительные участки маршрута будут созданы как отдельные переезды при сохранении.
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

      <SectionHeader color={color}>Документы и заметки</SectionHeader>
      <AiField active={aiFields.has('documents')}>
        <DocumentsField
          value={form.documents}
          onChange={(docs) => setField('documents', docs)}
          onUploadingChange={setUploading}
          label="Документы"
          iconColor="text-primary"
        />
      </AiField>
      <div className="mt-3">
        <Label>Заметки</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Свободные заметки…" />
      </div>
    </>
  );
}

function ActivityFields({ form, setField, setForm, aiFields, tz, setTime, dateOrderError, setUploading }) {
  const color = TYPE_META.activity.color;
  return (
    <>
      <SectionHeader color={color}>Об активности</SectionHeader>
      <div>
        <Label>Название *</Label>
        <Input value={form.title} onChange={(e) => setField('title', e.target.value)} placeholder="Время Фаду в Bairro Alto" />
      </div>
      <div className="mt-3">
        <Label>Адрес</Label>
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

      <SectionHeader color={color}>Когда</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-lg border bg-secondary/30 p-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color }}>Начало</div>
          <DateTimeInput
            value={form.startLocal}
            onChange={(v) => setField('startLocal', v)}
            onTimeMissingChange={(v) => setTime('start', v)}
            className="w-full"
          />
          <TimezoneHint tz={tz} />
        </div>
        <div className="rounded-lg border bg-secondary/30 p-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold mb-1" style={{ color }}>Конец</div>
          <DateTimeInput
            value={form.endLocal}
            onChange={(v) => setField('endLocal', v)}
            onTimeMissingChange={(v) => setTime('end', v)}
            className="w-full"
          />
          <TimezoneHint tz={tz} />
        </div>
      </div>
      {dateOrderError && (
        <p className="mt-1 text-xs text-destructive">Конец должен быть позже начала.</p>
      )}

      <SectionHeader color={color}>Стоимость</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Цена</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>Валюта</Label>
          <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
        </div>
      </div>

      <SectionHeader color={color}>Документы и заметки</SectionHeader>
      <DocumentsField
        value={form.documents}
        onChange={(docs) => setField('documents', docs)}
        onUploadingChange={setUploading}
        label="Документы"
        iconColor="text-violet-600 dark:text-violet-300"
      />
      <div className="mt-3">
        <Label>Заметки</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Свободные заметки…" />
      </div>
    </>
  );
}

function ServiceFields({ form, setField, setForm, aiFields, setTime, dateOrderError, isEdit, setUploading }) {
  const platformInfo = form.booking_platform ? BOOKING_PLATFORMS[form.booking_platform] : null;
  const platformLogo = platformLogoUrl(form.booking_platform, form.booking_url);
  const color = TYPE_META.service.color;
  return (
    <>
      <SectionHeader color={color}>Авто</SectionHeader>
      <div>
        <Label>Компания / название *</Label>
        <Input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Sixt · VW Polo (или аналог)" autoFocus />
      </div>

      <SectionHeader color={color}>Получение</SectionHeader>
      <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
        <div>
          <Label>{isEdit ? 'Адрес получения' : 'Адрес получения *'}</Label>
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
            placeholder="Аэропорт Лиссабон (LIS), Sixt Terminal 1"
          />
          {!isEdit && !form.pickup_address?.trim() && (
            <p className="mt-1 text-xs text-destructive">Укажите адрес получения.</p>
          )}
        </div>
        <div>
          <Label>Дата · время</Label>
          <DateTimeInput
            value={form.pickup_at_local}
            onChange={(v) => setField('pickup_at_local', v)}
            onTimeMissingChange={(v) => setTime('pickup', v)}
          />
          <TimezoneHint tz={form.pickup_timezone} />
        </div>
      </div>

      <SectionHeader color={color}>Возврат</SectionHeader>
      <div className="rounded-lg border bg-secondary/30 p-3 mb-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={form.return_different_location}
            onCheckedChange={(v) => setField('return_different_location', v === true)}
          />
          <span className="text-sm font-medium">Вернуть в другом месте</span>
          {!form.return_different_location && (
            <span className="text-xs text-muted-foreground">— возврат в том же месте, что и получение</span>
          )}
        </label>
      </div>
      <div className="rounded-lg border bg-secondary/30 p-3 space-y-2">
        {form.return_different_location && (
          <div>
            <Label>Адрес возврата</Label>
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
              placeholder="Барселона · Sixt Sants Estació"
            />
          </div>
        )}
        <div>
          <Label>Дата · время возврата</Label>
          <DateTimeInput
            value={form.dropoff_at_local}
            onChange={(v) => setField('dropoff_at_local', v)}
            onTimeMissingChange={(v) => setTime('dropoff', v)}
          />
          <TimezoneHint tz={form.return_different_location ? form.dropoff_timezone : form.pickup_timezone} />
        </div>
        {dateOrderError && (
          <p className="text-xs text-destructive">Возврат должен быть позже получения.</p>
        )}
      </div>

      <SectionHeader color={color}>Финансы и бронь</SectionHeader>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>Цена</Label>
          <Input type="number" step="0.01" value={form.price} onChange={(e) => setField('price', e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label>Валюта</Label>
          <CurrencyCombobox value={form.currency} onChange={(v) => setField('currency', v)} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <Label>Ссылка на бронирование</Label>
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
                {platformInfo.label}
              </span>
              {form.booking_url && (
                <a href={form.booking_url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" />Открыть
                </a>
              )}
            </div>
          )}
        </div>
        <div>
          <Label>Номер брони</Label>
          <Input className="font-mono" value={form.booking_reference} onChange={(e) => setField('booking_reference', e.target.value)} placeholder="—" />
        </div>
      </div>

      <SectionHeader color={color}>Документы и заметки</SectionHeader>
      <DocumentsField
        value={form.documents}
        onChange={(docs) => setField('documents', docs)}
        onUploadingChange={setUploading}
        label="Документы"
        iconColor="text-emerald-700 dark:text-emerald-300"
      />
      <div className="mt-3">
        <Label>Заметки</Label>
        <Textarea rows={3} value={form.notes} onChange={(e) => setField('notes', e.target.value)} placeholder="Например: дополнительный водитель, страховка full…" />
      </div>
    </>
  );
}
