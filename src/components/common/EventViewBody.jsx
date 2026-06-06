/**
 * EventViewBody - SHARED read-view layer for a timeline event
 * (hotel / transfer / activity / car-rental service).
 *
 * One logic, two shells: this module owns the per-kind display computation
 * (`useEventViewModel`), the document state + inline upload (`useEntityDocs`)
 * and the section renderer (`EventViewSections`). Both the Dialog shell
 * (`EventModal`) and the in-place left-panel shell (trip-editor panels)
 * render the SAME sections, so a fix here lands in both surfaces.
 *
 * Chrome that legitimately differs between shells (Dialog header + meta strip
 * + footer vs PanelShell back-button + footer) stays in each shell; the shared
 * view-model exposes the derived values both shells need to build it.
 */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n/I18nContext';
import { supabase } from '@/api/supabaseClient';
import { safeStorageName } from '@/lib/storage';
import { parseNaive } from '@/lib/naive-time';
import { fmtMoneyActive } from '@/lib/i18n/format';
import { utcToLocalInput } from '@/lib/time';
import { getEntityDocuments, getDetailsDocuments } from '@/lib/documents';
import { optimisticContentUpdate } from '@/lib/trip-data';
import { BOOKING_PLATFORMS, platformLogoUrl } from '@/lib/booking-platforms';
import {
  ExternalLink, Map as MapIcon, Calendar, FileText,
  Bed, Plane, Train, Bus, Car as CarIcon, Ship, Footprints, Camera, Upload,
  RefreshCw,
} from 'lucide-react';

export const TABLE_BY_KIND = {
  hotel: 'hotel_stays',
  transfer: 'transfers',
  activity: 'activities',
  service: 'trip_services',
};

export const TRANSPORT_ICONS = {
  plane: Plane, train: Train, bus: Bus, car: CarIcon, taxi: CarIcon,
  ferry: Ship, walk: Footprints, own_transport: CarIcon, other: CarIcon,
};

export function eventTheme(kind, entity) {
  if (kind === 'hotel') {
    return { color: 'var(--ev-hotel)', soft: 'var(--ev-hotel-soft)', Icon: Bed, labelKey: 'budget.cat_accommodation' };
  }
  if (kind === 'activity') {
    const Icon = entity?.category === 'food' ? Camera : entity?.category === 'sight' ? Camera : Camera;
    return { color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', Icon, labelKey: 'budget.source_activity' };
  }
  if (kind === 'service') {
    return { color: 'var(--ev-car)', soft: 'var(--ev-car-soft)', Icon: CarIcon, labelKey: 'service.car_default_name' };
  }
  // transfer
  const tt = entity?.transport_type;
  const Icon = TRANSPORT_ICONS[tt] || Plane;
  return {
    color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)',
    Icon, labelKey: tt === 'plane' ? 'trip.tl_flight' : 'trip.tl_transfer',
  };
}

export function fmtDT(iso) {
  const d = parseNaive(iso);
  return d ? d.toFormat('d MMM, HH:mm') : '';
}
export function fmtDate(iso) {
  const d = parseNaive(iso);
  return d ? d.toFormat('d MMM') : '';
}
export function fmtTime(iso) {
  const d = parseNaive(iso);
  return d ? d.toFormat('HH:mm') : '';
}
export function fmtPrice(price, cur) {
  if (price == null || price === '') return '';
  return fmtMoneyActive(Number(price), cur || 'EUR');
}

// ─────────────────────────────────────────────────────────────────────────────
//  Section primitives (3px accent bar + body)
// ─────────────────────────────────────────────────────────────────────────────

export function Section({ title, accent, count, children, first }) {
  return (
    <div className={first ? 'mt-3' : 'mt-4 pt-4 border-t'}>
      <div className="flex items-center gap-2 mb-2.5">
        <div style={{ width: 3, height: 12, background: accent, borderRadius: 2 }} />
        <span className="text-[length:var(--fs-micro)] uppercase tracking-wider font-semibold text-muted-foreground flex-1">{title}</span>
        {count != null && count > 0 && (
          <span className="text-xs text-muted-foreground">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export function KV({ label, children, mono }) {
  if (children == null || children === '') return null;
  return (
    <div>
      <div className="text-[length:var(--fs-micro)] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm leading-tight ${mono ? 'font-mono text-xs' : ''}`}>{children}</div>
    </div>
  );
}

function paymentLabel(t, status) {
  if (status === 'paid') return t('event.paid');
  if (status === 'partial') return t('event.partial');
  if (status === 'pay_on_arrival') return t('event.on_arrival');
  return status || null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-kind body
// ─────────────────────────────────────────────────────────────────────────────

function HotelBody({ entity, accent }) {
  const { t } = useI18n();
  return (
    <>
      {entity.address && (
        <div className="mt-3 p-3 rounded-lg bg-secondary/40 flex items-start gap-2.5">
          <MapIcon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
          <div className="text-sm leading-snug">{entity.address}</div>
        </div>
      )}
      <Section title={t('event.checkin_checkout')} accent={accent}>
        <div className="grid grid-cols-2 gap-3">
          <KV label={t('trip.hotel_check_in')}>{fmtDT(entity.check_in_datetime)}</KV>
          <KV label={t('trip.hotel_check_out')}>{fmtDT(entity.check_out_datetime)}</KV>
        </div>
      </Section>
      <Section title={t('event.finance_cancel')} accent={accent}>
        <div className="grid grid-cols-2 gap-3">
          <KV label={t('budget.field_amount')}>{fmtPrice(entity.price, entity.currency)}</KV>
          <KV label={t('hotel.payment_status')}>{paymentLabel(t, entity.payment_status)}</KV>
          {entity.free_cancellation && entity.free_cancellation_until && (
            <KV label={t('event.free_cancel_until')}>{fmtDT(entity.free_cancellation_until)}</KV>
          )}
          <KV label={t('service.car_booking_ref')} mono>{entity.booking_reference}</KV>
        </div>
      </Section>
      {(entity.phone || entity.email) && (
        <Section title={t('event.contacts')} accent={accent}>
          <div className="grid grid-cols-2 gap-3">
            <KV label={t('hotel.view_phone')}>{entity.phone}</KV>
            <KV label="E-mail">{entity.email ? <a href={`mailto:${entity.email}`} className="text-primary hover:underline">{entity.email}</a> : null}</KV>
          </div>
        </Section>
      )}
    </>
  );
}

function TransferBody({ entity, fromVisit, toVisit, accent }) {
  const { t } = useI18n();
  const fromCity = fromVisit?.city_name || '';
  const toCity = toVisit?.city_name || '';
  const ttIcon = TRANSPORT_ICONS[entity.transport_type] || Plane;
  const Ic = ttIcon;
  return (
    <>
      <div className="mt-3 p-4 rounded-xl grid items-center gap-3" style={{ gridTemplateColumns: '1fr auto 1fr', background: 'var(--wash)' }}>
        <div>
          <div className="font-display font-bold text-2xl leading-tight">{fmtTime(entity.start_datetime)}</div>
          {fromCity && <div className="text-sm font-semibold mt-1">{fromCity}</div>}
          {entity.from_address && (
            <div className="text-[length:var(--fs-micro)] text-muted-foreground mt-0.5 leading-snug">{entity.from_address}</div>
          )}
        </div>
        <div className="text-center">
          <Ic className="w-5 h-5 mx-auto" style={{ color: accent }} />
        </div>
        <div className="text-right">
          <div className="font-display font-bold text-2xl leading-tight">{fmtTime(entity.end_datetime)}</div>
          {toCity && <div className="text-sm font-semibold mt-1">{toCity}</div>}
          {entity.to_address && (
            <div className="text-[length:var(--fs-micro)] text-muted-foreground mt-0.5 leading-snug">{entity.to_address}</div>
          )}
        </div>
      </div>
      <Section title={t('event.carrier_booking')} accent={accent}>
        <div className="grid grid-cols-2 gap-3">
          <KV label={t('transfer.carrier')}>{entity.carrier}</KV>
          <KV label={t('event.flight_number')} mono>{entity.flight_number}</KV>
          <KV label={t('budget.field_amount')}>{fmtPrice(entity.price, entity.currency)}</KV>
          <KV label={t('service.car_booking_ref')} mono>{entity.booking_reference}</KV>
        </div>
      </Section>
    </>
  );
}

function ActivityBody({ entity, accent }) {
  const { t } = useI18n();
  return (
    <>
      {entity.location_address && (
        <div className="mt-3 p-3 rounded-lg bg-secondary/40 flex items-start gap-2.5">
          <MapIcon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: accent }} />
          <div className="text-sm leading-snug">{entity.location_address}</div>
        </div>
      )}
      <Section title={t('admin.notifications.when')} accent={accent}>
        <div className="grid grid-cols-2 gap-3">
          <KV label={t('activity.start')}>{fmtDT(entity.start_datetime)}</KV>
          <KV label={t('event.end')}>{fmtDT(entity.end_datetime)}</KV>
        </div>
      </Section>
      <Section title={t('activity.price')} accent={accent}>
        <KV label={t('budget.field_amount')}>{fmtPrice(entity.price, entity.currency)}</KV>
      </Section>
    </>
  );
}

function ServiceBody({ entity, accent }) {
  const { t } = useI18n();
  const d = entity.details || {};
  const sameLocation = !d.dropoff_address || d.dropoff_address === d.pickup_address;
  const price = entity.price ?? d.price;
  const cur = entity.currency || d.currency;
  const pickupDisplay = entity.pickup_datetime
    ? utcToLocalInput(entity.pickup_datetime, d.pickup_timezone)
    : d.pickup_at_local;
  const dropoffDisplay = entity.dropoff_datetime
    ? utcToLocalInput(entity.dropoff_datetime, d.dropoff_timezone || d.pickup_timezone)
    : d.dropoff_at_local;
  return (
    <>
      <Section title={t('service.car_pickup')} accent={accent}>
        <div className="grid grid-cols-2 gap-3">
          <KV label={t('event.pickup_where')}><div className="leading-snug">{d.pickup_address}</div></KV>
          <KV label={t('admin.notifications.when')}>{fmtDT(pickupDisplay)}</KV>
        </div>
      </Section>
      <Section title={sameLocation ? t('service.car_dropoff') : t('event.return_elsewhere')} accent={accent}>
        <div className="grid grid-cols-2 gap-3">
          <KV label={t('event.pickup_where')}>
            {sameLocation ? (
              <span className="text-xs text-muted-foreground">{t('event.return_same')}</span>
            ) : (
              <div className="leading-snug">{d.dropoff_address}</div>
            )}
          </KV>
          <KV label={t('admin.notifications.when')}>{fmtDT(dropoffDisplay)}</KV>
        </div>
      </Section>
      <Section title={t('event.finance_booking')} accent={accent}>
        <div className="grid grid-cols-2 gap-3">
          <KV label={t('budget.field_amount')}>{fmtPrice(price, cur)}</KV>
          <KV label={t('service.car_booking_ref')} mono>{d.booking_reference}</KV>
        </div>
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Derived view-model (shared by both shells to build their own chrome)
// ─────────────────────────────────────────────────────────────────────────────

export function useEventViewModel(kind, entity, visit, fromVisit, toVisit) {
  const { t } = useI18n();
  if (!entity || !kind) return null;
  const theme = eventTheme(kind, entity);
  const themeLabel = t(theme.labelKey);

  const title = kind === 'hotel' ? entity.name
    : kind === 'activity' ? entity.title
    : kind === 'service' ? entity.name
    : (entity.carrier || (entity.flight_number ? t('event.flight_n', { number: entity.flight_number }) : themeLabel));

  const cur = (kind === 'service' ? (entity.currency || entity.details?.currency) : entity.currency) || 'EUR';
  const price = kind === 'service' ? (entity.price ?? entity.details?.price) : entity.price;

  const bookingUrl = kind === 'service' ? entity.details?.booking_url : entity.booking_url;
  const bookingPlatform = kind === 'service' ? entity.details?.booking_platform : entity.booking_platform;
  const platformInfo = bookingPlatform ? BOOKING_PLATFORMS[bookingPlatform] : null;
  const platformLogo = platformLogoUrl(bookingPlatform, bookingUrl);

  const metaItems = [];
  if (kind === 'hotel') {
    if (entity.check_in_datetime && entity.check_out_datetime) {
      metaItems.push({ icon: Calendar, text: `${fmtDate(entity.check_in_datetime)} → ${fmtDate(entity.check_out_datetime)}` });
    }
    if (visit?.city_name) metaItems.push({ icon: MapIcon, text: visit.city_name });
  } else if (kind === 'transfer') {
    if (entity.start_datetime) metaItems.push({ icon: Calendar, text: fmtDT(entity.start_datetime) });
    const route = [fromVisit?.city_name, toVisit?.city_name].filter(Boolean).join(' → ');
    if (route) metaItems.push({ icon: MapIcon, text: route });
  } else if (kind === 'activity') {
    if (entity.start_datetime) metaItems.push({ icon: Calendar, text: fmtDT(entity.start_datetime) });
    if (visit?.city_name) metaItems.push({ icon: MapIcon, text: visit.city_name });
  } else if (kind === 'service') {
    const d = entity.details || {};
    const pickupMeta = entity.pickup_datetime
      ? utcToLocalInput(entity.pickup_datetime, d.pickup_timezone)
      : d.pickup_at_local;
    const dropoffMeta = entity.dropoff_datetime
      ? utcToLocalInput(entity.dropoff_datetime, d.dropoff_timezone || d.pickup_timezone)
      : d.dropoff_at_local;
    if (pickupMeta && dropoffMeta) {
      metaItems.push({ icon: Calendar, text: `${fmtDT(pickupMeta)} → ${fmtDate(dropoffMeta)}` });
    }
  }
  const priceText = fmtPrice(price, cur);

  const mapAddress = kind === 'hotel' ? entity.address
    : kind === 'transfer' ? (entity.from_address || entity.to_address)
    : kind === 'activity' ? entity.location_address
    : entity.details?.pickup_address;

  return {
    theme, themeLabel, title, cur, price, priceText,
    bookingUrl, bookingPlatform, platformInfo, platformLogo, mapAddress, metaItems,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Entity source loader (shared by SourceViewLoader modal + editor panel)
//  Loads a row by (kind,id) plus its related city_visit(s). One loader, two
//  shells — avoids duplicating the fetch logic.
// ─────────────────────────────────────────────────────────────────────────────

export async function getEntityRow(table, id) {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export function useEntitySource(kind, id, { open = true, onError, refreshKey = 0 } = {}) {
  const [data, setData] = useState(null);
  const [visit, setVisit] = useState(null);
  const [fromVisit, setFromVisit] = useState(null);
  const [toVisit, setToVisit] = useState(null);

  React.useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setData(null); setVisit(null); setFromVisit(null); setToVisit(null);
    (async () => {
      try {
        if (kind === 'hotel') {
          const h = await getEntityRow('hotel_stays', id);
          if (cancelled) return;
          setData(h);
          if (h?.city_visit_id) { const v = await getEntityRow('city_visits', h.city_visit_id).catch(() => null); if (!cancelled) setVisit(v); }
        } else if (kind === 'transfer') {
          const tr = await getEntityRow('transfers', id);
          if (cancelled) return;
          setData(tr);
          const [fv, tv] = await Promise.all([
            tr?.from_city_visit_id ? getEntityRow('city_visits', tr.from_city_visit_id).catch(() => null) : null,
            tr?.to_city_visit_id ? getEntityRow('city_visits', tr.to_city_visit_id).catch(() => null) : null,
          ]);
          if (!cancelled) { setFromVisit(fv); setToVisit(tv); }
        } else if (kind === 'activity') {
          const a = await getEntityRow('activities', id);
          if (cancelled) return;
          setData(a);
          if (a?.city_visit_id) { const v = await getEntityRow('city_visits', a.city_visit_id).catch(() => null); if (!cancelled) setVisit(v); }
        } else if (kind === 'service') {
          const s = await getEntityRow('trip_services', id);
          if (cancelled) return;
          setData(s);
        }
      } catch {
        if (!cancelled) onError?.();
      }
    })();
    return () => { cancelled = true; };
    // refreshKey lets callers force a re-fetch after a live edit/toggle (this hook
    // reads rows directly, not via react-query, so cache invalidation alone misses it).
  }, [open, kind, id, refreshKey]);

  return { data, visit, fromVisit, toVisit };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Documents state + inline upload (shared)
// ─────────────────────────────────────────────────────────────────────────────

export function useEntityDocs(kind, entity, canEdit) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [docs, setDocs] = useState(() => {
    if (!entity) return [];
    return kind === 'service' ? getDetailsDocuments(entity.details || {}) : getEntityDocuments(entity);
  });
  const [uploading, setUploading] = useState(false);

  React.useEffect(() => {
    if (!entity) return;
    setDocs(kind === 'service' ? getDetailsDocuments(entity.details || {}) : getEntityDocuments(entity));
  }, [entity?.id, kind]);

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length || !canEdit) return;
    const tooBig = files.find((f) => f.size > 10 * 1024 * 1024);
    if (tooBig) { alert(t('event.file_too_big10')); return; }
    setUploading(true);
    try {
      const uploaded = [];
      for (const file of files) {
        const uid = (crypto?.randomUUID?.()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const path = `attachments/${uid}/${safeStorageName(file.name)}`;
        const { error: upErr } = await supabase.storage.from('documents').upload(path, file);
        if (upErr) { console.error('upload error', upErr); continue; }
        const { data: urlData } = await supabase.storage.from('documents').createSignedUrl(path, 315360000);
        uploaded.push({ file_url: urlData?.signedUrl || '', file_name: file.name, storage_path: path });
      }
      if (uploaded.length) {
        const next = [...docs, ...uploaded];
        setDocs(next);
        const table = TABLE_BY_KIND[kind];
        if (table && entity.id) {
          if (kind === 'service') {
            await supabase.from(table).update({ details: { ...(entity.details || {}), documents: next } }).eq('id', entity.id);
          } else {
            await supabase.from(table).update({ documents: next }).eq('id', entity.id);
          }
          if (entity.trip_id) {
            const COLL = { hotel: 'hotels', transfer: 'transfers', activity: 'activities', service: 'services' }[kind];
            const patch = kind === 'service'
              ? { id: entity.id, details: { ...(entity.details || {}), documents: next } }
              : { id: entity.id, documents: next };
            if (COLL) optimisticContentUpdate(qc, entity.trip_id, COLL, 'update', patch);
          }
        }
      }
    } finally {
      setUploading(false);
    }
  }

  return { docs, uploading, uploadFiles };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Section renderer: per-kind body + Documents + Notes (no chrome)
// ─────────────────────────────────────────────────────────────────────────────

export function EventViewSections({ kind, entity, fromVisit, toVisit, accent, docs, canEdit, uploading, uploadFiles }) {
  const { t } = useI18n();
  return (
    <>
      {kind === 'hotel' && <HotelBody entity={entity} accent={accent} />}
      {kind === 'transfer' && <TransferBody entity={entity} fromVisit={fromVisit} toVisit={toVisit} accent={accent} />}
      {kind === 'activity' && <ActivityBody entity={entity} accent={accent} />}
      {kind === 'service' && <ServiceBody entity={entity} accent={accent} />}

      {/* Documents */}
      <Section title={t('activity.documents_label')} accent={accent} count={docs.length}>
        {docs.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {docs.map((d, i) => (
              <a
                key={`${d.file_url}-${i}`}
                href={d.file_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 px-2.5 py-2 border rounded-md text-sm hover:bg-secondary/50 transition"
              >
                <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{d.file_name || t('event.file_word')}</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground" />
              </a>
            ))}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">{t('doc.tab_empty_title')}</div>
        )}
        {canEdit && (
          <label
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); uploadFiles(e.dataTransfer.files); }}
            className="mt-2 block cursor-pointer border-2 border-dashed rounded-md py-3 px-3 text-center text-xs text-muted-foreground hover:border-primary/60 transition"
          >
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => uploadFiles(e.target.files)}
              disabled={uploading}
            />
            {uploading ? (
              <span className="inline-flex items-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" />{t('trip.form_uploading')}</span>
            ) : (
              <span className="inline-flex items-center gap-2"><Upload className="w-3.5 h-3.5" />{t('event.drop_or_pick')}</span>
            )}
          </label>
        )}
      </Section>

      {/* Notes */}
      {(entity.notes || entity.details?.notes) && (
        <Section title={t('activity.view_notes')} accent={accent}>
          <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{entity.notes || entity.details?.notes}</div>
        </Section>
      )}
    </>
  );
}
