/**
 * EventPanels — in-place editor LEFT-PANEL view layouts (Lumo `.lp` shell).
 *
 * Design: events-services mockup "View Panel · Hotel/Transfer/Activity".
 * Tinted header (.lp-h--ev, per-kind colour via --ev-* on the .lp root), then
 * the SAME section primitives as the modals — .sec-lbl/.sl, .kv-grid, .doc-row,
 * .notes-block, .route-block, .addr — so panels and modals stay unified.
 *
 * Used by EventSourcePanel (view shell).
 */
import React from 'react';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { getEntityDocuments } from '@/lib/documents';
import { fmtDT, fmtDate, fmtTime, fmtPrice } from '@/components/common/EventViewBody';
import { formatDuration } from '@/lib/time';

const EV = {
  hotel:    { color: 'var(--ev-hotel)',    soft: 'var(--ev-hotel-soft)',    ink: 'var(--ev-hotel-ink)' },
  transfer: { color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)' },
  activity: { color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)' },
  service:  { color: 'var(--ev-car)',      soft: 'var(--ev-car-soft)',      ink: 'var(--ev-car-ink)' },
};
const TKIND = {
  plane: { icon: 'plane', labelKey: 'tse.tk_plane' }, train: { icon: 'train', labelKey: 'transfer.train' },
  bus: { icon: 'bus', labelKey: 'transfer.bus' }, car: { icon: 'car', labelKey: 'event.tk_car' },
  ferry: { icon: 'ferry', labelKey: 'transfer.ferry' }, taxi: { icon: 'car', labelKey: 'event.tk_car' },
};
export function kindIcon(kind, entity) {
  if (kind === 'transfer') return (TKIND[entity?.transport_type] || TKIND.plane).icon;
  return kind === 'hotel' ? 'bed' : kind === 'activity' ? 'spark' : 'car';
}
function money(p, c) { return fmtPrice(p, c) || '—'; }
function paymentLabel(t, status) {
  if (status === 'paid') return t('event.paid');
  if (status === 'partial') return t('event.partial');
  if (status === 'pay_on_arrival') return t('event.on_arrival');
  return null;
}
function PaymentBadge({ t, status }) {
  const label = paymentLabel(t, status);
  if (!label) return null;
  const cls = status === 'paid' ? 'badge--paid'
    : status === 'partial' ? 'badge--partial'
    : status === 'pay_on_arrival' ? 'badge--on-arrival' : 'badge--quiet';
  return <span className={`badge ${cls}`}>{label}</span>;
}

// ── shared primitives (Lumo .lp panel, design-faithful) ──────────────────────
export function PanelShell({ kind = 'hotel', icon, title, sub, onBack, foot, children }) {
  const { t } = useI18n();
  const ev = EV[kind] || EV.hotel;
  return (
    <div className="lp lp--wide" style={{ '--ev-color': ev.color, '--ev-soft': ev.soft, '--ev-ink': ev.ink }}>
      <div className="lp-h lp-h--ev">
        <button className="lp-back" onClick={onBack} title={t('common.back')}><Icon name="back" size={14} /></button>
        <span className="lp-ic" style={{ background: ev.color, color: '#fff' }}><Icon name={icon || kindIcon(kind)} size={17} /></span>
        <div className="lp-ti">
          <b>{title}</b>
          {sub && <span>{sub}</span>}
        </div>
      </div>
      <div className="lp-b scrollbar-thin">{children}</div>
      {foot && <div className="lp-f">{foot}</div>}
    </div>
  );
}

function Section({ title, count, action, children }) {
  return (
    <div>
      <div className="sec-lbl">
        <span className="sl">{title}{count != null && count > 0 ? ` · ${count}` : ''}</span>
        {action}
      </div>
      {children}
    </div>
  );
}
function KV({ label, children, mono }) {
  if (children == null || children === '' || children === '—') return null;
  return (
    <div className="kv">
      <div className="k">{label}</div>
      <div className={'v' + (mono ? ' mono' : '')}>{children}</div>
    </div>
  );
}
const KVGrid = ({ children }) => <div className="kv-grid">{children}</div>;

function AddressBlock({ address }) {
  if (!address) return null;
  return (
    <div className="addr">
      <Icon name="pin" size={16} />
      <div>{address}</div>
    </div>
  );
}
function DocsList({ docs }) {
  const { t } = useI18n();
  if (!docs || docs.length === 0) return null;
  return (
    <div className="gy">
      {docs.map((d, i) => (
        <a key={`${d.file_url}-${i}`} href={d.file_url} target="_blank" rel="noreferrer" className="doc-row">
          <div className="di"><Icon name="file" size={13} /></div>
          <b>{d.file_name || t('event.file_word')}</b>
          {d.file_size && <span className="ds">{d.file_size}</span>}
        </a>
      ))}
    </div>
  );
}
function Notes({ notes, t }) {
  if (!notes) return null;
  return (
    <Section title={t('activity.view_notes')}>
      <div className="notes-block">{notes}</div>
    </Section>
  );
}

// ── per-kind bodies ──────────────────────────────────────────────────────────
function HotelBody({ entity }) {
  const { t } = useI18n();
  const docs = getEntityDocuments(entity);
  return (
    <>
      <AddressBlock address={entity.address} />
      <Section title={t('event.checkin_checkout')}>
        <KVGrid>
          <KV label={t('trip.hotel_check_in')} mono>{fmtDT(entity.check_in_datetime)}</KV>
          <KV label={t('trip.hotel_check_out')} mono>{fmtDT(entity.check_out_datetime)}</KV>
        </KVGrid>
      </Section>
      <Section title={t('event.finance_cancel')}>
        <KVGrid>
          <KV label={t('budget.field_amount')} mono>{money(entity.price, entity.currency)}</KV>
          {entity.payment_status && <KV label={t('hotel.payment_status')}><PaymentBadge t={t} status={entity.payment_status} /></KV>}
          {entity.free_cancellation && entity.free_cancellation_until && <KV label={t('event.free_cancel_until')} mono>{fmtDT(entity.free_cancellation_until)}</KV>}
          {entity.booking_reference && <KV label={t('service.car_booking_ref')} mono>{entity.booking_reference}</KV>}
        </KVGrid>
      </Section>
      {(entity.phone || entity.email) && (
        <Section title={t('event.contacts')}>
          <KVGrid>
            {entity.phone && <KV label={t('hotel.view_phone')} mono>{entity.phone}</KV>}
            {entity.email && <KV label="E-mail"><a href={`mailto:${entity.email}`} style={{ color: 'var(--primary)' }}>{entity.email}</a></KV>}
          </KVGrid>
        </Section>
      )}
      {docs.length > 0 && <Section title={t('activity.documents_label')} count={docs.length}><DocsList docs={docs} /></Section>}
      <Notes notes={entity.notes} t={t} />
    </>
  );
}

function TransferBody({ entity, fromVisit, toVisit }) {
  const { t } = useI18n();
  const meta = TKIND[entity.transport_type] || TKIND.plane;
  const docs = getEntityDocuments(entity);
  const dep = fmtTime(entity.start_datetime), arr = fmtTime(entity.end_datetime);
  const depDate = fmtDate(entity.start_datetime), arrDate = fmtDate(entity.end_datetime);
  const dur = formatDuration(entity.start_datetime, entity.end_datetime, fromVisit?.timezone, toVisit?.timezone);
  return (
    <>
      <div className="route-block">
        <div>
          {depDate && <div className="rd">{depDate}</div>}
          <div className="rt">{dep || '—'}</div>
          <div className="rc">{fromVisit?.city_name || '—'}</div>
          {entity.from_address && <div className="ra">{entity.from_address}</div>}
        </div>
        <div className="rmid">
          <Icon name={meta.icon} size={20} />
          {dur && <div className="dur">{dur}</div>}
        </div>
        <div className="end">
          {arrDate && <div className="rd">{arrDate}</div>}
          <div className="rt">{arr || '—'}</div>
          <div className="rc">{toVisit?.city_name || '—'}</div>
          {entity.to_address && <div className="ra">{entity.to_address}</div>}
        </div>
      </div>
      <Section title={t('event.carrier_booking')}>
        <KVGrid>
          <KV label={t('transfer.carrier')}>{entity.carrier || '—'}</KV>
          {entity.flight_number && <KV label={t('event.flight_number')} mono>{entity.flight_number}</KV>}
          <KV label={t('admin.notifications.when')} mono>{fmtDT(entity.start_datetime)}</KV>
          <KV label={t('budget.field_amount')} mono>{money(entity.price, entity.currency)}</KV>
          {entity.booking_reference && <KV label={t('service.car_booking_ref')} mono>{entity.booking_reference}</KV>}
        </KVGrid>
      </Section>
      {docs.length > 0 && <Section title={t('activity.documents_label')} count={docs.length}><DocsList docs={docs} /></Section>}
      <Notes notes={entity.notes} t={t} />
    </>
  );
}

function ActivityBody({ entity }) {
  const { t } = useI18n();
  const docs = getEntityDocuments(entity);
  return (
    <>
      <AddressBlock address={entity.location_address} />
      <Section title={t('admin.notifications.when')}>
        <KVGrid>
          <KV label={t('activity.start')} mono>{fmtDT(entity.start_datetime)}</KV>
          <KV label={t('event.end')} mono>{fmtDT(entity.end_datetime)}</KV>
        </KVGrid>
      </Section>
      <Section title={t('activity.price')}>
        <KVGrid>
          <KV label={t('budget.field_amount')} mono>{money(entity.price, entity.currency)}</KV>
          {entity.booking_reference && <KV label={t('service.car_booking_ref')} mono>{entity.booking_reference}</KV>}
        </KVGrid>
      </Section>
      {docs.length > 0 && <Section title={t('activity.documents_label')} count={docs.length}><DocsList docs={docs} /></Section>}
      <Notes notes={entity.notes} t={t} />
    </>
  );
}

function ServiceBody({ entity }) {
  const { t } = useI18n();
  const d = entity.details || {};
  const docs = getEntityDocuments(entity);
  return (
    <>
      <Section title={t('service.car_pickup')}>
        <KVGrid>
          <KV label={t('event.pickup_where')}>{d.pickup_address}</KV>
          <KV label={t('admin.notifications.when')} mono>{fmtDT(entity.pickup_datetime || d.pickup_at_local)}</KV>
        </KVGrid>
      </Section>
      <Section title={t('event.finance_booking')}>
        <KVGrid>
          <KV label={t('budget.field_amount')} mono>{money(entity.price ?? d.price, entity.currency || d.currency)}</KV>
          {d.booking_reference && <KV label={t('service.car_booking_ref')} mono>{d.booking_reference}</KV>}
        </KVGrid>
      </Section>
      {docs.length > 0 && <Section title={t('activity.documents_label')} count={docs.length}><DocsList docs={docs} /></Section>}
      <Notes notes={entity.notes || d.notes} t={t} />
    </>
  );
}

export function EventPanelBody({ kind, entity, fromVisit, toVisit }) {
  if (kind === 'hotel') return <HotelBody entity={entity} />;
  if (kind === 'transfer') return <TransferBody entity={entity} fromVisit={fromVisit} toVisit={toVisit} />;
  if (kind === 'activity') return <ActivityBody entity={entity} />;
  if (kind === 'service') return <ServiceBody entity={entity} />;
  return null;
}
