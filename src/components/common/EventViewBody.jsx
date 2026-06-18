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
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/api/supabaseClient';
import { safeStorageName } from '@/lib/storage';
import { parseNaive } from '@/lib/naive-time';
import { fmtMoneyActive } from '@/lib/i18n/format';
import { utcToLocalInput } from '@/lib/time';
import { getEntityDocuments, getDetailsDocuments } from '@/lib/documents';
import { optimisticContentUpdate } from '@/lib/trip-data';
import { BOOKING_PLATFORMS, platformLogoUrl } from '@/lib/booking-platforms';
import {
  Map as MapIcon, Calendar, FileText,
  BedDouble, Plane, Train, Bus, Car as CarIcon, Ship, Footprints, Ticket,
  ShieldCheck,
} from 'lucide-react';
import { CardSim } from '@/design/icons';

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
    return { color: 'var(--ev-hotel)', soft: 'var(--ev-hotel-soft)', ink: 'var(--ev-hotel-ink)', Icon: BedDouble, labelKey: 'budget.cat_accommodation' };
  }
  if (kind === 'activity') {
    return { color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)', Icon: Ticket, labelKey: 'budget.source_activity' };
  }
  if (kind === 'service') {
    if (entity?.kind === 'esim') {
      return { color: 'var(--ev-esim)', soft: 'var(--ev-esim-soft)', ink: 'var(--ev-esim-ink)', Icon: CardSim, labelKey: 'service.kind.esim' };
    }
    if (entity?.kind === 'insurance') {
      return { color: 'var(--ev-insurance)', soft: 'var(--ev-insurance-soft)', ink: 'var(--ev-insurance-ink)', Icon: ShieldCheck, labelKey: 'service.kind.insurance' };
    }
    return { color: 'var(--ev-car)', soft: 'var(--ev-car-soft)', ink: 'var(--ev-car-ink)', Icon: CarIcon, labelKey: 'service.car_default_name' };
  }
  // transfer
  const tt = entity?.transport_type;
  const Icon = TRANSPORT_ICONS[tt] || Plane;
  return {
    color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)',
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

export function Section({ title, accent, count, children }) {
  return (
    <div className="ev-sec" style={accent ? { '--ev-color': accent } : undefined}>
      <div className="ev-sec-lbl">
        {title}{count != null && count > 0 ? ` · ${count}` : ''}
      </div>
      {children}
    </div>
  );
}

export function KV({ label, children, mono }) {
  if (children == null || children === '') return null;
  return (
    <div className="kv">
      <div className="k">{label}</div>
      <div className={mono ? 'v mono' : 'v'}>{children}</div>
    </div>
  );
}

function paymentLabel(t, status) {
  if (status === 'paid') return t('event.paid');
  if (status === 'partial') return t('event.partial');
  if (status === 'pay_on_arrival') return t('event.on_arrival');
  return status || null;
}

// Payment status as a Lumo badge (design: badge--paid / --partial / --on-arrival).
function PaymentBadge({ t, status }) {
  const label = paymentLabel(t, status);
  if (!label) return null;
  const cls = status === 'paid' ? 'badge--paid'
    : status === 'partial' ? 'badge--partial'
    : status === 'pay_on_arrival' ? 'badge--on-arrival' : 'badge--quiet';
  return <span className={`badge ${cls}`}>{label}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Per-kind body
// ─────────────────────────────────────────────────────────────────────────────

function HotelBody({ entity, accent }) {
  const { t } = useI18n();
  return (
    <>
      {entity.address && (
        <div className="addr">
          <MapIcon style={{ width: 16, height: 16, color: accent, flexShrink: 0, marginTop: 1 }} />
          <div>{entity.address}</div>
        </div>
      )}
      <Section title={t('event.checkin_checkout')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('trip.hotel_check_in')}>{fmtDT(entity.check_in_datetime)}</KV>
          <KV label={t('trip.hotel_check_out')}>{fmtDT(entity.check_out_datetime)}</KV>
        </div>
      </Section>
      <Section title={t('event.finance_cancel')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('budget.field_amount')}>{fmtPrice(entity.price, entity.currency)}</KV>
          <KV label={t('hotel.payment_status')}><PaymentBadge t={t} status={entity.payment_status} /></KV>
          {entity.free_cancellation && entity.free_cancellation_until && (
            <KV label={t('event.free_cancel_until')}>{fmtDT(entity.free_cancellation_until)}</KV>
          )}
          <KV label={t('service.car_booking_ref')} mono>{entity.booking_reference}</KV>
        </div>
      </Section>
      {(entity.phone || entity.email) && (
        <Section title={t('event.contacts')} accent={accent}>
          <div className="kv-grid">
            <KV label={t('hotel.view_phone')}>{entity.phone}</KV>
            <KV label="E-mail">{entity.email ? <a href={`mailto:${entity.email}`} style={{ color: 'var(--primary)' }}>{entity.email}</a> : null}</KV>
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
      <div className="route-block" style={{ '--ev-color': accent }}>
        <div>
          <div className="rd">{fmtDate(entity.start_datetime)}</div>
          <div className="rt">{fmtTime(entity.start_datetime)}</div>
          {fromCity && <div className="rc">{fromCity}</div>}
          {entity.from_address && <div className="ra">{entity.from_address}</div>}
        </div>
        <div className="rmid">
          <Ic />
        </div>
        <div className="end">
          <div className="rd">{fmtDate(entity.end_datetime)}</div>
          <div className="rt">{fmtTime(entity.end_datetime)}</div>
          {toCity && <div className="rc">{toCity}</div>}
          {entity.to_address && <div className="ra">{entity.to_address}</div>}
        </div>
      </div>
      <Section title={t('event.carrier_booking')} accent={accent}>
        <div className="kv-grid">
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
        <div className="addr">
          <MapIcon style={{ width: 16, height: 16, color: accent, flexShrink: 0, marginTop: 1 }} />
          <div>{entity.location_address}</div>
        </div>
      )}
      <Section title={t('admin.notifications.when')} accent={accent}>
        <div className="kv-grid">
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

function EsimBody({ entity, accent }) {
  const { t } = useI18n();
  const d = entity.details || {};
  const price = fmtPrice(entity.price, entity.currency);
  return (
    <>
      <Section title={t('service.esim_cost_section')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('budget.field_amount')} mono>{price}</KV>
          <KV label={t('service.currency')}>{entity.currency}</KV>
        </div>
      </Section>
    </>
  );
}

function InsuranceBody({ entity, accent }) {
  const { t } = useI18n();
  const d = entity.details || {};
  const fmtInsDate = (iso) => {
    if (!iso) return null;
    try { return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return iso; }
  };
  const price = fmtPrice(entity.price, entity.currency);
  return (
    <>
      <Section title={t('service.insurance_section')} accent={accent}>
        <div className="kv-grid">
          {d.policy_number && <KV label={t('service.policy_number')} mono>{d.policy_number}</KV>}
          {d.date_start && <KV label={t('service.date_start')} mono>{fmtInsDate(d.date_start)}</KV>}
          {d.date_finish && <KV label={t('service.date_finish')} mono>{fmtInsDate(d.date_finish)}</KV>}
        </div>
      </Section>
      <Section title={t('service.insurance_cost_section')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('budget.field_amount')} mono>{price}</KV>
          <KV label={t('service.currency')}>{entity.currency}</KV>
        </div>
      </Section>
    </>
  );
}

function ServiceBody({ entity, accent }) {
  const { t } = useI18n();
  // Route esim/insurance to their own bodies
  if (entity.kind === 'esim') return <EsimBody entity={entity} accent={accent} />;
  if (entity.kind === 'insurance') return <InsuranceBody entity={entity} accent={accent} />;
  // car_rental
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
        <div className="kv-grid">
          <KV label={t('event.pickup_where')}><div className="leading-snug">{d.pickup_address}</div></KV>
          <KV label={t('admin.notifications.when')}>{fmtDT(pickupDisplay)}</KV>
        </div>
      </Section>
      <Section title={sameLocation ? t('service.car_dropoff') : t('event.return_elsewhere')} accent={accent}>
        <div className="kv-grid">
          <KV label={t('event.pickup_where')}>
            {sameLocation ? (
              <span style={{ fontSize: 'var(--fs-meta)', color: 'var(--muted)' }}>{t('event.return_same')}</span>
            ) : (
              <div className="leading-snug">{d.dropoff_address}</div>
            )}
          </KV>
          <KV label={t('admin.notifications.when')}>{fmtDT(dropoffDisplay)}</KV>
        </div>
      </Section>
      <Section title={t('event.finance_booking')} accent={accent}>
        <div className="kv-grid">
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
    // car_rental: show pickup→dropoff date range in meta strip
    // esim/insurance: no datetime meta — they're not time-bound events
    if (entity.kind === 'car_rental') {
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
  }
  const priceText = fmtPrice(price, cur);

  const mapAddress = kind === 'hotel' ? entity.address
    : kind === 'transfer' ? (entity.from_address || entity.to_address)
    : kind === 'activity' ? entity.location_address
    : (entity.kind === 'car_rental' ? entity.details?.pickup_address : null);

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
  // State is TAGGED with the id it belongs to. A persistently-mounted consumer
  // (SourceViewLoader lives for the whole TripView) keeps this state between
  // opens, so without the tag the next open would briefly render the PREVIOUS
  // entity before the effect runs — flashing stale content and forcing a
  // remount (the "appears → disappears → appears" flicker).
  const [src, setSrc] = useState({ id: null, data: null, visit: null, fromVisit: null, toVisit: null });

  React.useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    (async () => {
      try {
        // Gather the row AND its related city_visit(s) before publishing, so the
        // view shell mounts ONCE with complete data instead of re-laying-out in
        // two passes.
        const next = { id, data: null, visit: null, fromVisit: null, toVisit: null };
        if (kind === 'hotel') {
          next.data = await getEntityRow('hotel_stays', id);
          if (next.data?.city_visit_id) next.visit = await getEntityRow('city_visits', next.data.city_visit_id).catch(() => null);
        } else if (kind === 'transfer') {
          next.data = await getEntityRow('transfers', id);
          const [fv, tv] = await Promise.all([
            next.data?.from_city_visit_id ? getEntityRow('city_visits', next.data.from_city_visit_id).catch(() => null) : null,
            next.data?.to_city_visit_id ? getEntityRow('city_visits', next.data.to_city_visit_id).catch(() => null) : null,
          ]);
          next.fromVisit = fv; next.toVisit = tv;
        } else if (kind === 'activity') {
          next.data = await getEntityRow('activities', id);
          if (next.data?.city_visit_id) next.visit = await getEntityRow('city_visits', next.data.city_visit_id).catch(() => null);
        } else if (kind === 'service') {
          next.data = await getEntityRow('trip_services', id);
        }
        if (!cancelled) setSrc(next);
      } catch {
        if (!cancelled) onError?.();
      }
    })();
    return () => { cancelled = true; };
    // refreshKey lets callers force a re-fetch after a live edit/toggle (this hook
    // reads rows directly, not via react-query, so cache invalidation alone misses it).
  }, [open, kind, id, refreshKey]);

  // Only expose data once it belongs to the currently-requested id; otherwise the
  // consumer would render the stale previous entity until the effect resolves.
  const fresh = src.id === id;
  return {
    data:      fresh ? src.data : null,
    visit:     fresh ? src.visit : null,
    fromVisit: fresh ? src.fromVisit : null,
    toVisit:   fresh ? src.toVisit : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  Documents state + inline upload (shared)
// ─────────────────────────────────────────────────────────────────────────────

export function useEntityDocs(kind, entity, canEdit) {
  const { t } = useI18n();
  const { toast } = useToast();
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
    if (tooBig) { toast({ description: t('event.file_too_big10'), variant: 'warning' }); return; }
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

      {/* Documents — view is READ-ONLY: list only, no upload zone (design). */}
      {docs.length > 0 && (
        <Section title={`${t('activity.documents_label')} · ${docs.length}`} accent={accent}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {docs.map((d, i) => (
              <a
                key={`${d.file_url}-${i}`}
                href={d.file_url}
                target="_blank"
                rel="noreferrer"
                className="doc-row"
              >
                <div className="di"><FileText /></div>
                <b>{d.file_name || t('event.file_word')}</b>
                {d.file_size && <span className="ds">{d.file_size}</span>}
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* Notes */}
      {(entity.notes || entity.details?.notes) && (
        <Section title={t('activity.view_notes')} accent={accent}>
          <div className="notes-block" style={{ background: 'transparent', border: 'none', padding: 0 }}>
            {entity.notes || entity.details?.notes}
          </div>
        </Section>
      )}
    </>
  );
}
