/**
 * EventPanels - in-place LEFT-PANEL view layouts, ported 1:1 from the design
 * mockup (trip-editor-panels.jsx), wired to the REAL entity fields + i18n.
 *
 * Faithful to the design: PanelShell with a back button + accent stripe + icon
 * + title/sub, te-metastrip, accent Sections, te-bookrow/te-actrow/te-flightline.
 * (The legacy EventModal look is NOT reused here — modals are being retired.)
 *
 * Used by EventSourcePanel (view shell) and, later, CityPanel.
 */
import React from 'react';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { getEntityDocuments } from '@/lib/documents';
import { BOOKING_PLATFORMS, platformLogoUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import { fmtDT, fmtDate, fmtTime, fmtPrice } from '@/components/common/EventViewBody';

export const ACCENT = { hotel: 'var(--ev-hotel)', transfer: 'var(--ev-transfer)', activity: 'var(--ev-activity)', service: 'var(--ev-car)' };
export const SOFT = { hotel: 'var(--ev-hotel-soft)', transfer: 'var(--ev-transfer-soft)', activity: 'var(--ev-activity-soft)', service: 'var(--ev-car-soft)' };
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
function rangeText(a, b) {
  const da = fmtDate(a), db = fmtDate(b);
  if (!da) return '';
  return db && db !== da ? `${da} – ${db}` : da;
}
function paymentLabel(t, status) {
  if (status === 'paid') return t('event.paid');
  if (status === 'partial') return t('event.partial');
  if (status === 'pay_on_arrival') return t('event.on_arrival');
  return null;
}

// ── shared primitives (mockup-faithful) ──────────────────────────────────────
export function PanelShell({ kind = 'hotel', icon, title, sub, onBack, foot, children }) {
  const { t } = useI18n();
  const accent = ACCENT[kind] || 'var(--brand)';
  return (
    <div className="te-panel">
      <div className="te-panel__top">
        <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
        <button className="te-back" onClick={onBack} title={t('common.back')}><Icon name="back" size={16} /></button>
        <span className="te-panel__icon" style={{ background: SOFT[kind] || 'var(--brand-soft)', color: accent }}><Icon name={icon || kindIcon(kind)} size={16} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="te-panel__title">{title}</div>
          {sub && <div className="te-panel__sub">{sub}</div>}
        </div>
      </div>
      <div className="te-panel__body scrollbar-thin">{children}</div>
      {foot && <div className="te-panel__foot">{foot}</div>}
    </div>
  );
}

function Section({ accent, title, count, children }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ width: 3, height: 12, background: accent || 'var(--brand)', borderRadius: 2 }} />
        <span className="eyebrow" style={{ flex: 1 }}>{title}</span>
        {count != null && count > 0 && <span className="muted" style={{ fontSize: 11 }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}
function KV({ label, children, mono }) {
  if (children == null || children === '' || children === '—') return null;
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{label}</div>
      <div className={mono ? 'num' : ''} style={{ fontSize: 13.5, color: 'var(--ink)', lineHeight: 1.4 }}>{children}</div>
    </div>
  );
}
const KVGrid = ({ children }) => <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>{children}</div>;

function AddressBlock({ address, accent }) {
  if (!address) return null;
  return (
    <div style={{ display: 'flex', gap: 10, padding: 12, background: 'var(--wash)', borderRadius: 10, marginTop: 14 }}>
      <Icon name="pin" size={15} style={{ color: accent, marginTop: 2, flexShrink: 0 }} />
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>{address}</div>
    </div>
  );
}
function PartnerPill({ platform, url }) {
  const { t } = useI18n();
  const info = platform ? BOOKING_PLATFORMS[platform] : null;
  const logo = platformLogoUrl(platform, url);
  if (!info && !url) return null;
  const label = info ? (info.labelKey ? t(info.labelKey) : info.label) : url;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {logo && <img src={logo} alt="" style={{ width: 14, height: 14, borderRadius: 3 }} />}
      {url ? <a href={normalizeExternalUrl(url)} target="_blank" rel="noreferrer" className="num" style={{ color: 'var(--ink-2)' }}>{label}</a> : label}
    </span>
  );
}
function DocsList({ docs }) {
  const { t } = useI18n();
  if (!docs || docs.length === 0) return <div className="muted" style={{ fontSize: 12.5, padding: '2px 0' }}>{t('doc.tab_empty_title')}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {docs.map((d, i) => (
        <a key={`${d.file_url}-${i}`} href={d.file_url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: '1px solid var(--line-2)', borderRadius: 9, textDecoration: 'none', color: 'var(--ink)' }}>
          <Icon name="file" size={14} style={{ color: 'var(--muted)' }} />
          <span style={{ flex: 1, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name || t('event.file_word')}</span>
          <Icon name="external" size={12} style={{ color: 'var(--muted-2)' }} />
        </a>
      ))}
    </div>
  );
}
function Notes({ accent, notes, t }) {
  if (!notes) return null;
  return (
    <Section accent={accent} title={t('activity.view_notes')}>
      <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{notes}</div>
    </Section>
  );
}

// ── per-kind bodies ──────────────────────────────────────────────────────────
function HotelBody({ entity, accent }) {
  const { t } = useI18n();
  const docs = getEntityDocuments(entity);
  const pay = paymentLabel(t, entity.payment_status);
  return (
    <>
      <div className="te-metastrip">
        <span><Icon name="calendar" size={12} /> {rangeText(entity.check_in_datetime, entity.check_out_datetime)}</span>
        {entity.price != null && <span><Icon name="wallet" size={12} /> {money(entity.price, entity.currency)}</span>}
        {(entity.booking_platform || entity.booking_url) && <PartnerPill platform={entity.booking_platform} url={entity.booking_url} />}
      </div>
      <AddressBlock address={entity.address} accent={accent} />
      <Section accent={accent} title={t('event.checkin_checkout')}>
        <KVGrid>
          <KV label={t('trip.hotel_check_in')} mono>{fmtDT(entity.check_in_datetime)}</KV>
          <KV label={t('trip.hotel_check_out')} mono>{fmtDT(entity.check_out_datetime)}</KV>
        </KVGrid>
      </Section>
      <Section accent={accent} title={t('event.finance_cancel')}>
        <KVGrid>
          <KV label={t('budget.field_amount')} mono>{money(entity.price, entity.currency)}</KV>
          {pay && <KV label={t('hotel.payment_status')}>{pay}</KV>}
          {entity.free_cancellation && entity.free_cancellation_until && <KV label={t('event.free_cancel_until')} mono>{fmtDT(entity.free_cancellation_until)}</KV>}
          {entity.booking_reference && <KV label={t('service.car_booking_ref')} mono>{entity.booking_reference}</KV>}
        </KVGrid>
      </Section>
      {(entity.phone || entity.email) && (
        <Section accent={accent} title={t('event.contacts')}>
          <KVGrid>
            {entity.phone && <KV label={t('hotel.view_phone')}>{entity.phone}</KV>}
            {entity.email && <KV label="E-mail"><a href={`mailto:${entity.email}`} className="num" style={{ color: 'var(--brand)' }}>{entity.email}</a></KV>}
          </KVGrid>
        </Section>
      )}
      <Section accent={accent} title={t('activity.documents_label')} count={docs.length}><DocsList docs={docs} /></Section>
      <Notes accent={accent} notes={entity.notes} t={t} />
    </>
  );
}

function TransferBody({ entity, fromVisit, toVisit, accent }) {
  const { t } = useI18n();
  const meta = TKIND[entity.transport_type] || TKIND.plane;
  const docs = getEntityDocuments(entity);
  const dep = fmtTime(entity.start_datetime), arr = fmtTime(entity.end_datetime);
  const depDate = fmtDate(entity.start_datetime), arrDate = fmtDate(entity.end_datetime);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 14, alignItems: 'center', padding: '16px', background: 'var(--wash)', borderRadius: 12 }}>
        <div>
          {depDate && <div className="num muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{depDate}</div>}
          <div className="num" style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{dep || '—'}</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{fromVisit?.city_name || '—'}</div>
          {entity.from_address && <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.3 }}>{entity.from_address}</div>}
        </div>
        <div style={{ textAlign: 'center', color: accent }}>
          <Icon name={meta.icon} size={20} />
        </div>
        <div style={{ textAlign: 'right' }}>
          {arrDate && <div className="num muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{arrDate}</div>}
          <div className="num" style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700 }}>{arr || '—'}</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>{toVisit?.city_name || '—'}</div>
          {entity.to_address && <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.3 }}>{entity.to_address}</div>}
        </div>
      </div>
      <Section accent={accent} title={t('event.carrier_booking')}>
        <KVGrid>
          <KV label={t('transfer.carrier')}>{entity.carrier || t(meta.labelKey)}</KV>
          {entity.flight_number && <KV label={t('event.flight_number')} mono>{entity.flight_number}</KV>}
          <KV label={t('admin.notifications.when')} mono>{fmtDT(entity.start_datetime)}</KV>
          <KV label={t('budget.field_amount')} mono>{money(entity.price, entity.currency)}</KV>
          {entity.booking_reference && <KV label={t('service.car_booking_ref')} mono>{entity.booking_reference}</KV>}
        </KVGrid>
      </Section>
      <Section accent={accent} title={t('activity.documents_label')} count={docs.length}><DocsList docs={docs} /></Section>
      <Notes accent={accent} notes={entity.notes} t={t} />
    </>
  );
}

function ActivityBody({ entity, accent }) {
  const { t } = useI18n();
  const docs = getEntityDocuments(entity);
  return (
    <>
      <div className="te-metastrip">
        <span><Icon name="calendar" size={12} /> {fmtDT(entity.start_datetime)}</span>
        {entity.price != null && <span><Icon name="wallet" size={12} /> {money(entity.price, entity.currency)}</span>}
      </div>
      <AddressBlock address={entity.location_address} accent={accent} />
      <Section accent={accent} title={t('admin.notifications.when')}>
        <KVGrid>
          <KV label={t('activity.start')} mono>{fmtDT(entity.start_datetime)}</KV>
          <KV label={t('event.end')} mono>{fmtDT(entity.end_datetime)}</KV>
        </KVGrid>
      </Section>
      <Section accent={accent} title={t('activity.price')}>
        <KVGrid>
          <KV label={t('budget.field_amount')} mono>{money(entity.price, entity.currency)}</KV>
          {entity.booking_reference && <KV label={t('service.car_booking_ref')} mono>{entity.booking_reference}</KV>}
        </KVGrid>
      </Section>
      <Section accent={accent} title={t('activity.documents_label')} count={docs.length}><DocsList docs={docs} /></Section>
      <Notes accent={accent} notes={entity.notes} t={t} />
    </>
  );
}

function ServiceBody({ entity, accent }) {
  const { t } = useI18n();
  const d = entity.details || {};
  const docs = getEntityDocuments(entity);
  return (
    <>
      <Section accent={accent} title={t('service.car_pickup')}>
        <KVGrid>
          <KV label={t('event.pickup_where')}>{d.pickup_address}</KV>
          <KV label={t('admin.notifications.when')} mono>{fmtDT(entity.pickup_datetime || d.pickup_at_local)}</KV>
        </KVGrid>
      </Section>
      <Section accent={accent} title={t('event.finance_booking')}>
        <KVGrid>
          <KV label={t('budget.field_amount')} mono>{money(entity.price ?? d.price, entity.currency || d.currency)}</KV>
          {d.booking_reference && <KV label={t('service.car_booking_ref')} mono>{d.booking_reference}</KV>}
        </KVGrid>
      </Section>
      <Section accent={accent} title={t('activity.documents_label')} count={docs.length}><DocsList docs={docs} /></Section>
      <Notes accent={accent} notes={entity.notes || d.notes} t={t} />
    </>
  );
}

export function EventPanelBody({ kind, entity, fromVisit, toVisit }) {
  const accent = ACCENT[kind] || 'var(--brand)';
  if (kind === 'hotel') return <HotelBody entity={entity} accent={accent} />;
  if (kind === 'transfer') return <TransferBody entity={entity} fromVisit={fromVisit} toVisit={toVisit} accent={accent} />;
  if (kind === 'activity') return <ActivityBody entity={entity} accent={accent} />;
  if (kind === 'service') return <ServiceBody entity={entity} accent={accent} />;
  return null;
}
