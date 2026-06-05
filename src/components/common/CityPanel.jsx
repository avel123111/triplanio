/**
 * CityPanel - in-place LEFT panel for a city stop (design mockup CityPanel),
 * wired to the real id-based model. Shows: gradient hero, nights stepper
 * (structure → draft), arrival/departure transfers, hotel, activities.
 *
 * Pure presentational: all data + handlers come from TripStructureEdit so the
 * structural edits keep flowing through the editor's draft/recompute, and
 * bookings open the same view/create panels as the list.
 */
import React from 'react';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { Btn, CityPhoto } from '@/design/index';
import { PanelShell } from '@/components/common/EventPanels';
import { fmtDate, fmtTime, fmtPrice } from '@/components/common/EventViewBody';

const TKIND = {
  plane: { icon: 'plane', labelKey: 'tse.tk_plane' }, train: { icon: 'train', labelKey: 'transfer.train' },
  bus: { icon: 'bus', labelKey: 'transfer.bus' }, car: { icon: 'car', labelKey: 'event.tk_car' },
  ferry: { icon: 'ferry', labelKey: 'transfer.ferry' }, taxi: { icon: 'car', labelKey: 'event.tk_car' },
};
const ACT_ICON = { food: 'cup', sight: 'cam', experience: 'spark', sport: 'walk' };
const money = (p, c) => fmtPrice(p, c) || '';
function rangeText(a, b) { const da = fmtDate(a), db = fmtDate(b); if (!da) return ''; return db && db !== da ? `${da} – ${db}` : da; }
function nightWord(n, t) { return n === 1 ? t('tse.day_one') : n >= 2 && n <= 4 ? t('tse.day_few') : t('tse.day_many'); }

function SectionLabel({ children, action }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '18px 2px 9px' }}>
      <span className="eyebrow">{children}</span>
      <span style={{ flex: 1, height: 1, background: 'var(--line-2)' }} />
      {action}
    </div>
  );
}
function GhostAdd({ icon, label, sub, accent, onClick }) {
  const a = accent || 'var(--brand)';
  return (
    <button className="te-ghostadd" onClick={onClick} style={{ '--a': a }}>
      <span className="te-ghostadd__ic"><Icon name={icon || 'plus'} size={16} /></span>
      <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
        <span style={{ display: 'block', fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
        {sub && <span style={{ display: 'block', fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginTop: 1 }}>{sub}</span>}
      </span>
      <Icon name="plus" size={15} style={{ color: a, flexShrink: 0 }} />
    </button>
  );
}
function FlightLine({ transfer, dir, warn, onClick, t }) {
  const meta = TKIND[transfer.transport_type] || TKIND.plane;
  const when = dir === 'in' ? transfer.end_datetime : transfer.start_datetime;
  const time = fmtTime(when);
  return (
    <button className={'te-flightline' + (warn ? ' is-warn' : '')} onClick={onClick}>
      <span className="te-flightline__ic" style={{ background: 'var(--ev-transfer-soft)', color: 'var(--ev-transfer)' }}>
        <Icon name={meta.icon} size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 'var(--fs-base)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{transfer.carrier || t(meta.labelKey)}</span>
        </span>
        <span className="num muted" style={{ fontSize: 'var(--fs-micro)', display: 'block', marginTop: 2 }}>
          {dir === 'in' ? t('tse.arrival_word') : t('tse.departure_word')} · {fmtDate(when)}{time ? ' ' + time : ''}
        </span>
      </span>
      {warn && <Icon name="warning" size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
      <Icon name="chev" size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
    </button>
  );
}

export default function CityPanel({
  node, meta, hotel, acts = [], arrival, departure, prevCity, nextCity,
  hotelWarn, isActWarn, arrivalWarn = false, departureWarn = false, onBack, onRemove,
  onNightsMinus, onNightsPlus,
  onOpenHotel, onAddHotel, onOpenActivity, onAddActivity, onOpenTransfer, onAddArrival, onAddDeparture,
}) {
  const { t } = useI18n();
  // Waypoint = a 0-night transit stop: it has arrival/departure transfers and
  // activities like a normal city, but NO hotel (no overnight stay); the nights
  // stepper turns it back into a city when raised above 0.
  const isWaypoint = node.kind === 'waypoint';
  const nights = isWaypoint ? 0 : (node.nights || 0);

  return (
    <PanelShell
      kind="city" icon="pin" title={node.city_name} sub={meta?.country || ''}
      onBack={onBack}
      foot={<>
        <Btn variant="ghost" icon="trash" onClick={onRemove}>{t('tse.remove')}</Btn>
        <span style={{ flex: 1 }} />
        <Btn variant="primary" icon="check" onClick={onBack}>{t('common.done')}</Btn>
        {/* common.done / tse.* keys added to ru/en/es locales */}
      </>}
    >
      {/* hero */}
      <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', marginBottom: 16 }}>
        <CityPhoto city={node.city_name} h={132} w="100%" radius={0} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(8,15,30,.72))' }} />
        <div style={{ position: 'absolute', left: 14, right: 14, bottom: 12, color: 'white' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-2xl)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>{node.city_name}</div>
          <div className="num" style={{ fontSize: 'var(--fs-meta)', marginTop: 5, opacity: 0.92 }}>{rangeText(node.start_date, node.end_date)}{nights ? ` · ${nights} ${nightWord(nights, t)}` : ''}</div>
        </div>
      </div>

      {/* nights stepper */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span className="muted" style={{ fontSize: 'var(--fs-meta)' }}>{t('tse.nights_label')}</span>
        <span className="te-stepper te-stepper--solid" title={t('tse.nights_label')}>
          <button className="te-step" onClick={onNightsMinus} disabled={nights <= 0} aria-label={t('tse.nights_remove')}><Icon name="close" size={11} style={{ transform: 'rotate(45deg)' }} /></button>
          <span className="num te-nights">{nights}</span>
          <button className="te-step" onClick={onNightsPlus} aria-label={t('tse.nights_add')}><Icon name="plus" size={11} /></button>
        </span>
      </div>

      {/* arrival / departure — both cities AND waypoints (a transit stop still
          arrives and leaves; only the hotel is omitted for waypoints). */}
      <SectionLabel>{t('tse.section_road')}</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {arrival
          ? <FlightLine transfer={arrival} dir="in" warn={arrivalWarn} onClick={() => onOpenTransfer(arrival)} t={t} />
          : prevCity && <GhostAdd icon="plane" accent="var(--muted-2)" label={t('tse.add_arrival')} sub={prevCity} onClick={onAddArrival} />}
        {departure
          ? <FlightLine transfer={departure} dir="out" warn={departureWarn} onClick={() => onOpenTransfer(departure)} t={t} />
          : nextCity && <GhostAdd icon="plane" accent="var(--muted-2)" label={t('tse.add_departure')} sub={nextCity} onClick={onAddDeparture} />}
      </div>

      {/* hotel — cities only (a 0-night waypoint has no overnight stay) */}
      {!isWaypoint && <>
      <SectionLabel>{t('budget.cat_accommodation')}</SectionLabel>
      {hotel ? (
        <button className={'te-bookrow' + (hotelWarn ? ' is-warn' : '')} onClick={() => onOpenHotel(hotel.id)}>
          <span style={{ width: 38, height: 38, borderRadius: 10, background: hotelWarn ? 'var(--warning-soft)' : 'var(--ev-hotel-soft)', color: hotelWarn ? 'var(--warning)' : 'var(--ev-hotel)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="bed" size={18} /></span>
          <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <span style={{ display: 'block', fontSize: 'var(--fs-strong)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hotel.name}</span>
            <span className="num muted" style={{ display: 'block', fontSize: 'var(--fs-meta)', marginTop: 3 }}>{rangeText(hotel.check_in_datetime, hotel.check_out_datetime)}{hotel.price != null ? ' · ' + money(hotel.price, hotel.currency) : ''}</span>
          </span>
          {hotelWarn && <Icon name="warning" size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
          <Icon name="chev" size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
        </button>
      ) : (
        <GhostAdd icon="bed" accent="var(--muted-2)" label={t('hotel.add')} sub={rangeText(node.start_date, node.end_date)} onClick={onAddHotel} />
      )}
      </>}

      {/* activities */}
      <SectionLabel action={<button className="te-addmini" onClick={onAddActivity}><Icon name="plus" size={13} /></button>}>
        {t('budget.source_activity')} · {acts.length}
      </SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {acts.length === 0 && <div className="muted" style={{ fontSize: 'var(--fs-meta)', padding: '2px 2px 6px' }}>{t('tse.no_activities')}</div>}
        {acts.map((a) => {
          const warn = isActWarn ? isActWarn(a) : false;
          return (
            <button key={a.id} className={'te-actrow' + (warn ? ' is-warn' : '')} onClick={() => onOpenActivity(a.id)}>
              <span className="te-actrow__ic"><Icon name={ACT_ICON[a.category] || 'spark'} size={14} /></span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: 'var(--fs-base)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title}</span>
                <span className="num muted" style={{ fontSize: 'var(--fs-micro)' }}>{fmtDate(a.start_datetime)}{fmtTime(a.start_datetime) ? ' · ' + fmtTime(a.start_datetime) : ''}</span>
              </span>
              {warn && <Icon name="warning" size={12} title={t('validation.ACT_START_OOB') || ''} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
              <Icon name="chev" size={13} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
            </button>
          );
        })}
      </div>
    </PanelShell>
  );
}
