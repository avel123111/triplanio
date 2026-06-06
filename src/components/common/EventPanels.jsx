/**
 * EventPanels - in-place LEFT-PANEL view layouts, ported 1:1 from the design
 * mockup (trip-editor-panels.jsx), wired to the REAL entity fields + i18n.
 *
 * Faithful to the Lumo design system (C5 "Редактор · левые панели"): lpanel /
 * lp-h / lp-b / lp-f, seclabel+sl2, bookrow (bi/bt), metastrip+ch, route, kvgrid.
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
  const accent = ACCENT[kind] || 'var(--primary)';
  const soft = SOFT[kind] || 'var(--brand-soft)';
  return (
    <div className="lpanel lpanel--wide">
      <div className="lp-h">
        <button className="lp-back" onClick={onBack} title={t('common.back')}><Icon name="back" size={16} /></button>
        <span className="lp-ic" style={{ background: soft, color: accent }}><Icon name={icon || kindIcon(kind)} size={18} /></span>
        <div className="ti">
          <b>{title}</b>
          {sub && <span>{sub}</span>}
        </div>
      </div>
      <div className="lp-b scrollbar-thin">{children}</div>
      {foot && <div className="lp-f">{foot}</div>}
    </div>
  );
}

function Section({ accent, title, count, children }) {
  return (
    <div className="lp-sec">
      <div className="seclabel">
        <span className="sl2" style={{ color: accent || 'var(--primary)' }}>{title}{count != null && count > 0 ? ` · ${count}` : ''}</span>
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
const KVGrid = ({ children }) => <div className="kvgrid">{children}</div>;

function AddressBlock({ address }) {
  if (!address) return null;
  return (
    <div className="addr">
      <Icon name="pin" size={16} />
      <div>{address}</div>
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
  if (!docs || docs.length === 0) return <div className="muted" style={{ fontSize: 'var(--fs-meta)', padding: '2px 0' }}>{t('doc.tab_empty_title')}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {docs.map((d, i) => (
        <a key={`${d.file_url}-${i}`} href={d.file_url} target="_blank" rel="noreferrer" className="docrow">
          <span className="di"><Icon name="file" size={15} /></span>
          <b>{d.file_name || t('event.file_word')}</b>
          <Icon name="external" size={13} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
        </a>
      ))}
    </div>
  );
}
function Notes({ accent, notes, t }) {
  if (!notes) return null;
  return (
    <Section accent={accent} title={t('activity.view_notes')}>
      <div style={{ fontSize: 'var(--fs-base)', color: 'var(--ink-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{notes}</div>
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
      <div className="metastrip">
        <span className="ch"><Icon name="calendar" size={13} /> {rangeText(entity.check_in_datetime, entity.check_out_datetime)}</span>
        {entity.price != null && <span className="ch"><Icon name="wallet" size={13} /> {money(entity.price, entity.currency)}</span>}
        {(entity.booking_platform || entity.booking_url) && <span className="ch ch--p"><PartnerPill platform={entity.booking_platform} url={entity.booking_url} /></span>}
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
      <div className="route">
        <div>
          {depDate && <div className="rd">{depDate}</div>}
          <div className="rt num">{dep || '—'}</div>
          <div className="rc">{fromVisit?.city_name || '—'}</div>
          {entity.from_address && <div className="ra">{entity.from_address}</div>}
        </div>
        <div className="rmid">
          <Icon name={meta.icon} size={20} />
        </div>
        <div className="end">
          {arrDate && <div className="rd">{arrDate}</div>}
          <div className="rt num">{arr || '—'}</div>
          <div className="rc">{toVisit?.city_name || '—'}</div>
          {entity.to_address && <div className="ra">{entity.to_address}</div>}
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
      <div className="metastrip">
        <span className="ch"><Icon name="calendar" size={13} /> {fmtDT(entity.start_datetime)}</span>
        {entity.price != null && <span className="ch"><Icon name="wallet" size={13} /> {money(entity.price, entity.currency)}</span>}
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
