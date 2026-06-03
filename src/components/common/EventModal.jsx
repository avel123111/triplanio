/**
 * EventModal - unified, new-design read view for a timeline event
 * (hotel / transfer / activity / car rental). Wraps a shadcn Dialog so it
 * composes cleanly inside ordinary React trees.
 *
 * Accepts TWO call shapes so the migration is incremental:
 *
 *   New (preferred):
 *     <EventModal open onOpenChange entity kind visit fromVisit toVisit onEdit readOnly />
 *
 *   Legacy (still used by SourceViewLoader + a few proto screens):
 *     <EventModal event={{ kind, entity, visit, fromVisit, toVisit }}
 *                 canEdit onClose onEdit onDelete />
 *
 * Visual reference: designer prototype `event-view.jsx`.
 */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/api/supabaseClient';
import { safeStorageName } from '@/lib/storage';
import { parseNaive } from '@/lib/naive-time';
import { utcToLocalInput } from '@/lib/time';
import { getEntityDocuments, getDetailsDocuments } from '@/lib/documents';
import { optimisticContentUpdate } from '@/lib/trip-data';
import { BOOKING_PLATFORMS, platformLogoUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import {
  Edit2, Trash2, ExternalLink, Map as MapIcon, Calendar, FileText,
  Bed, Plane, Train, Bus, Car as CarIcon, Ship, Footprints, Camera, Upload,
  RefreshCw,
} from 'lucide-react';

const TABLE_BY_KIND = {
  hotel: 'hotel_stays',
  transfer: 'transfers',
  activity: 'activities',
  service: 'trip_services',
};

const TRANSPORT_ICONS = {
  plane: Plane, train: Train, bus: Bus, car: CarIcon, taxi: CarIcon,
  ferry: Ship, walk: Footprints, own_transport: CarIcon, other: CarIcon,
};

function eventTheme(kind, entity) {
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

function fmtDT(iso) {
  const d = parseNaive(iso);
  return d ? d.setLocale('ru').toFormat('d MMM, HH:mm') : '';
}
function fmtDate(iso) {
  const d = parseNaive(iso);
  return d ? d.setLocale('ru').toFormat('d MMM') : '';
}
function fmtTime(iso) {
  const d = parseNaive(iso);
  return d ? d.toFormat('HH:mm') : '';
}
function fmtPrice(price, cur) {
  if (price == null || price === '') return '';
  const c = cur || 'EUR';
  try {
    return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(Number(price));
  } catch {
    return `${price} ${c}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Section primitives (3px accent bar + body)
// ─────────────────────────────────────────────────────────────────────────────

function Section({ title, accent, count, children, first }) {
  return (
    <div className={first ? 'mt-3' : 'mt-4 pt-4 border-t'}>
      <div className="flex items-center gap-2 mb-2.5">
        <div style={{ width: 3, height: 12, background: accent, borderRadius: 2 }} />
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground flex-1">{title}</span>
        {count != null && count > 0 && (
          <span className="text-xs text-muted-foreground">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function KV({ label, children, mono }) {
  if (children == null || children === '') return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm leading-tight ${mono ? 'font-mono text-xs' : ''}`}>{children}</div>
    </div>
  );
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

function paymentLabel(t, status) {
  if (status === 'paid') return t('event.paid');
  if (status === 'partial') return t('event.partial');
  if (status === 'pay_on_arrival') return t('event.on_arrival');
  return status || null;
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
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{entity.from_address}</div>
          )}
        </div>
        <div className="text-center">
          <Ic className="w-5 h-5 mx-auto" style={{ color: accent }} />
        </div>
        <div className="text-right">
          <div className="font-display font-bold text-2xl leading-tight">{fmtTime(entity.end_datetime)}</div>
          {toCity && <div className="text-sm font-semibold mt-1">{toCity}</div>}
          {entity.to_address && (
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{entity.to_address}</div>
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
  // Prefer top-level UTC columns added with get_pending_reminders; fall back
  // to the legacy *_at_local fields for records written before the migration.
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
//  Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function EventModal(props) {
  const { t } = useI18n();
  // Adapt the two call shapes into a single internal shape.
  const legacy = !!props.event;
  const kind = legacy ? props.event.kind : props.kind;
  const entity = legacy ? props.event.entity : props.entity;
  const visit = legacy ? props.event.visit : props.visit;
  const fromVisit = legacy ? props.event.fromVisit : props.fromVisit;
  const toVisit = legacy ? props.event.toVisit : props.toVisit;
  const canEdit = legacy ? !!props.canEdit : !props.readOnly;
  const onEdit = props.onEdit;
  const onDelete = legacy ? props.onDelete : undefined;
  // Optional conflict banner shown at the very top (Edit Mode → click a conflict).
  const warning = props.warning ?? (legacy ? props.event?.warning : undefined) ?? null;

  // Open/close: new API uses open/onOpenChange; legacy uses onClose.
  // When no `open` is passed (some legacy proto callers conditionally mount
  // the modal), default to true.
  const controlled = typeof props.open !== 'undefined';
  const open = controlled ? !!props.open : true;
  const setOpen = (next) => {
    if (controlled) {
      props.onOpenChange?.(next);
    } else if (!next) {
      props.onClose?.();
    }
  };

  const qc = useQueryClient();
  const [docs, setDocs] = useState(() => {
    if (!entity) return [];
    return kind === 'service' ? getDetailsDocuments(entity.details || {}) : getEntityDocuments(entity);
  });
  const [uploading, setUploading] = useState(false);
  // Inline delete-confirm state - same UX as EventEditDialog so the user
  // sees one consistent confirm flow regardless of where they hit Delete.
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset confirm state when the modal closes so the next open starts fresh.
  React.useEffect(() => {
    if (!open) { setConfirmDel(false); setDeleting(false); }
  }, [open]);

  // Re-sync docs when the entity prop changes (e.g. dialog re-opens with a
  // different event).
  React.useEffect(() => {
    if (!entity) return;
    setDocs(kind === 'service' ? getDetailsDocuments(entity.details || {}) : getEntityDocuments(entity));
  }, [entity?.id, kind]); // eslint-disable-line

  if (!entity || !kind) return null;
  const theme = eventTheme(kind, entity);
  const themeLabel = t(theme.labelKey);

  // Title + meta strip values
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

  // Date / route summary for the meta strip
  const metaItems = [];
  if (kind === 'hotel') {
    if (entity.check_in_datetime && entity.check_out_datetime) {
      metaItems.push({ icon: Calendar, text: `${fmtDate(entity.check_in_datetime)} → ${fmtDate(entity.check_out_datetime)}` });
    }
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

  // "Show on map" address per kind
  const mapAddress = kind === 'hotel' ? entity.address
    : kind === 'transfer' ? (entity.from_address || entity.to_address)
    : kind === 'activity' ? entity.location_address
    : entity.details?.pickup_address;

  // Upload more files inline (only when editable).
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
          // Patch the trip-content cache OPTIMISTICALLY so a re-open of this
          // modal reads the fresh entity immediately. An invalidate here would
          // trigger an async refetch; reopening before it lands shows the stale
          // (doc-less) entity - the "appears → gone → appears" flicker.
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="p-0 max-w-xl max-h-[90vh] overflow-y-auto gap-0 w-[calc(100%-1rem)] sm:w-full">
        {/* 4px colour stripe */}
        <div style={{ height: 4, background: theme.color }} />

        {/* Header */}
        <div
          className="border-b"
          style={{ padding: '16px 22px 14px', background: theme.soft, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
        >
          <div
            style={{
              width: 40, height: 40, borderRadius: 10,
              background: theme.color, color: 'white',
              display: 'grid', placeItems: 'center', flexShrink: 0,
            }}
          >
            <theme.Icon className="w-5 h-5" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{themeLabel}</div>
            <h2 className="font-display text-xl leading-tight" style={{ letterSpacing: '-0.02em' }}>{title || themeLabel}</h2>
          </div>
        </div>

        {/* Key meta strip */}
        {(metaItems.length > 0 || priceText || platformInfo) && (
          <div
            className="border-b bg-secondary/30 text-xs text-muted-foreground"
            style={{ padding: '10px 22px', display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 6, alignItems: 'center' }}
          >
            {metaItems.map((m, i) => {
              const Ic = m.icon;
              return (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <Ic className="w-3 h-3" />{m.text}
                </span>
              );
            })}
            {priceText && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                {priceText}
              </span>
            )}
            {platformInfo && (
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium ${platformInfo.color}`}>
                {platformLogo && <img src={platformLogo} alt="" className="w-3.5 h-3.5 rounded-sm" />}
                {platformInfo.labelKey ? t(platformInfo.labelKey) : platformInfo.label}
              </span>
            )}
          </div>
        )}

        {/* Conflict plate (Edit Mode) - below the date/meta strip */}
        {warning && (
          <div style={{ margin: '12px 22px 0', display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 12px', borderRadius: 10, background: 'var(--warning-soft)', border: '1px solid color-mix(in srgb, var(--warning) 40%, transparent)', color: 'var(--ink)' }}>
            <span style={{ width: 22, height: 22, borderRadius: 6, background: 'color-mix(in srgb, var(--warning) 22%, transparent)', color: 'var(--warning)', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 12 }}>⚠️</span>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, alignSelf: 'center' }}>{warning}</div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ padding: '12px 22px', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {bookingUrl && (
            <Button
              size="sm"
              onClick={() => window.open(normalizeExternalUrl(bookingUrl), '_blank', 'noopener,noreferrer')}
              style={{ background: theme.color, borderColor: theme.color }}
            >
              <ExternalLink className="w-3.5 h-3.5 mr-1.5" />{t('event.view_booking')}
            </Button>
          )}
          {mapAddress && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapAddress)}`, '_blank', 'noopener,noreferrer')}
            >
              <MapIcon className="w-3.5 h-3.5 mr-1.5" />{t('event.show_on_map')}
            </Button>
          )}
        </div>

        {/* Body - either the inline delete confirm or the normal sections. */}
        {confirmDel ? (
          <div style={{ padding: 22 }}>
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-destructive/15 text-destructive grid place-items-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-semibold text-base">{t('event.delete_q', { label: themeLabel.toLowerCase() })}</div>
                <div className="text-sm text-muted-foreground mt-1">
                  {t('event.delete_irreversible')}
                </div>
              </div>
            </div>
          </div>
        ) : (
        <div style={{ padding: '0 22px 22px' }}>
          {kind === 'hotel' && <HotelBody entity={entity} accent={theme.color} />}
          {kind === 'transfer' && <TransferBody entity={entity} fromVisit={fromVisit} toVisit={toVisit} accent={theme.color} />}
          {kind === 'activity' && <ActivityBody entity={entity} accent={theme.color} />}
          {kind === 'service' && <ServiceBody entity={entity} accent={theme.color} />}

          {/* Documents */}
          <Section title={t('activity.documents_label')} accent={theme.color} count={docs.length}>
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
            <Section title={t('activity.view_notes')} accent={theme.color}>
              <div className="text-sm leading-relaxed whitespace-pre-wrap break-words">{entity.notes || entity.details?.notes}</div>
            </Section>
          )}
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDel(false)}
                disabled={deleting}
              >
                {t('trip.form_cancel')}
              </Button>
              <Button
                size="sm"
                disabled={deleting}
                onClick={async () => {
                  if (!onDelete) return;
                  try {
                    setDeleting(true);
                    await onDelete();
                  } finally {
                    // Parent should close the modal; if it doesn't (error),
                    // restore the view so the user isn't stuck on the confirm.
                    setDeleting(false);
                    setConfirmDel(false);
                  }
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />{deleting ? t('event.deleting') : t('trip.delete')}
              </Button>
            </>
          ) : (
            <>
              {canEdit && onDelete && (
                <Button variant="ghost" size="sm" onClick={() => setConfirmDel(true)} className="text-destructive hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />{t('trip.delete')}
                </Button>
              )}
              <div style={{ flex: 1 }} />
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{t('common.close')}</Button>
              {canEdit && onEdit && (
                <Button
                  size="sm"
                  onClick={onEdit}
                  style={{ background: theme.color, borderColor: theme.color }}
                >
                  <Edit2 className="w-3.5 h-3.5 mr-1.5" />{t('trip.edit_trip')}
                </Button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
