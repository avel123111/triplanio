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
import { Btn } from '@/design/index';
import { fmtDate, fmtTime, fmtPrice } from '@/components/common/EventViewBody';

const TKIND = {
  plane: { icon: 'plane', labelKey: 'tse.tk_plane' }, train: { icon: 'train', labelKey: 'transfer.train' },
  bus: { icon: 'bus', labelKey: 'transfer.bus' }, car: { icon: 'car', labelKey: 'event.tk_car' },
  ferry: { icon: 'ferry', labelKey: 'transfer.ferry' }, taxi: { icon: 'car', labelKey: 'event.tk_car' },
};
const ACT_ICON = { food: 'cup', sight: 'cam', experience: 'spark', sport: 'walk' };
const money = (p, c) => fmtPrice(p, c) || '';
function rangeText(a, b) { const da = fmtDate(a), db = fmtDate(b); if (!da) return ''; return db && db !== da ? `${da} – ${db}` : da; }

// Lumo section label: coloured uppercase tag (.sl) + optional addmini action.
function SectionLabel({ children, color, action }) {
  return (
    <div className="sec-lbl" style={{ marginTop: 6 }}>
      <span className="sl" style={{ color: color || 'var(--muted)' }}>{children}</span>
      {action}
    </div>
  );
}
// Lumo ghost-add row (.gadd): dashed, filled secondary icon, muted text.
function GhostAdd({ icon, label, sub, accent, onClick }) {
  const a = accent || 'var(--primary)';
  return (
    <button className="gadd" onClick={onClick} style={{ '--a': a }}>
      <span className="gi"><Icon name={icon || 'plus'} size={17} /></span>
      <span className="gt">
        <b>{label}</b>
        {sub && <span>{sub}</span>}
      </span>
    </button>
  );
}
// Lumo booking row (.bookrow): tinted icon + bt(title/mono-sub) + chevron.
function BookRow({ tone = 'hotel', icon, title, sub, warn, onClick }) {
  const bg = warn ? 'var(--warning-soft)' : `var(--ev-${tone}-soft)`;
  const fg = warn ? 'var(--warning-ink)' : `var(--ev-${tone}-ink)`;
  return (
    <button className="bookrow" onClick={onClick}>
      <span className="bi" style={{ background: bg, color: fg }}><Icon name={icon} size={18} /></span>
      <div className="bt">
        <b>{title}</b>
        {sub && <span>{sub}</span>}
      </div>
      {warn && <Icon name="warning" size={15} style={{ color: 'var(--warning-ink)', flexShrink: 0 }} />}
      <Icon name="chev" size={16} className="chev" style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
    </button>
  );
}
function FlightLine({ transfer, dir, warn, onClick, t }) {
  const meta = TKIND[transfer.transport_type] || TKIND.plane;
  const when = dir === 'in' ? transfer.end_datetime : transfer.start_datetime;
  const time = fmtTime(when);
  const word = dir === 'in' ? t('tse.arrival_word') : t('tse.departure_word');
  return (
    <BookRow
      tone="transfer"
      icon={meta.icon}
      title={transfer.carrier || t(meta.labelKey)}
      sub={`${word} · ${fmtDate(when)}${time ? ' ' + time : ''}`}
      warn={warn}
      onClick={onClick}
    />
  );
}

export default function CityPanel({
  node, meta, hotels = [], acts = [], arrival, departure, prevCity, nextCity,
  isHotelWarn, isActWarn, arrivalWarn = false, departureWarn = false, onBack, onRemove,
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
    <div className="lp lp--wide">
      {/* brand hero — single row: back · city name + country chip · check-in/out.
          (No photo / no emoji / no local-time / no weather.) */}
      <div className="lp-hero">
        <button className="lp-back" onClick={onBack} title={t('common.back')}><Icon name="back" size={17} /></button>
        <div className="lph-title">
          <b className="lph-name">{node.city_name}</b>
          {meta?.country && <span className="lph-fc">{meta.country}</span>}
        </div>
        <div className="lph-meta">
          <div><span className="lph-mk">{t('hotel.check_in')}</span><span className="lph-mv">{fmtDate(node.start_date) || '—'}</span></div>
          <div><span className="lph-mk">{t('hotel.check_out')}</span><span className="lph-mv">{fmtDate(node.end_date) || '—'}</span></div>
        </div>
      </div>

      <div className="lp-b scrollbar-thin">
      {/* nights stepper */}
      <div className="lp-stepper" style={{ marginBottom: 6 }}>
        <span className="muted" style={{ fontSize: '13px', fontWeight: 700 }}>{t('tse.nights_label')}</span>
        <div className="stepper" title={t('tse.nights_label')}>
          <button onClick={onNightsMinus} disabled={nights <= 0} aria-label={t('tse.nights_remove')}>−</button>
          <span className="n">{nights}</span>
          <button onClick={onNightsPlus} aria-label={t('tse.nights_add')}>+</button>
        </div>
      </div>

      {/* arrival / departure — both cities AND waypoints (a transit stop still
          arrives and leaves; only the hotel is omitted for waypoints). */}
      <div className="lp-sec">
        <SectionLabel color="var(--ev-transfer-ink)">{t('tse.section_road')}</SectionLabel>
        {arrival
          ? <FlightLine transfer={arrival} dir="in" warn={arrivalWarn} onClick={() => onOpenTransfer(arrival)} t={t} />
          : prevCity && <GhostAdd icon="plane" accent="var(--ev-transfer)" label={t('tse.add_arrival')} sub={prevCity} onClick={onAddArrival} />}
        {departure
          ? <FlightLine transfer={departure} dir="out" warn={departureWarn} onClick={() => onOpenTransfer(departure)} t={t} />
          : nextCity && <GhostAdd icon="plane" accent="var(--ev-transfer)" label={t('tse.add_departure')} sub={nextCity} onClick={onAddDeparture} />}
      </div>

      {/* hotels — cities only (a 0-night waypoint has no overnight stay). */}
      {!isWaypoint && (
      <div className="lp-sec">
        <SectionLabel color="var(--ev-hotel-ink)" action={hotels.length > 0 ? <button className="addmini" onClick={onAddHotel} aria-label={t('hotel.add')}><Icon name="plus" size={14} /></button> : null}>
          {t('budget.cat_accommodation')}{hotels.length > 0 ? ` · ${hotels.length}` : ''}
        </SectionLabel>
        {hotels.length === 0 ? (
          <GhostAdd icon="bed" accent="var(--ev-hotel)" label={t('hotel.add')} sub={rangeText(node.start_date, node.end_date)} onClick={onAddHotel} />
        ) : hotels.map((hotel) => (
          <BookRow key={hotel.id} tone="hotel" icon="bed"
            title={hotel.name}
            sub={`${rangeText(hotel.check_in_datetime, hotel.check_out_datetime)}${hotel.price != null ? ' · ' + money(hotel.price, hotel.currency) : ''}`}
            warn={isHotelWarn ? isHotelWarn(hotel) : false}
            onClick={() => onOpenHotel(hotel.id)} />
        ))}
      </div>
      )}

      {/* activities */}
      <div className="lp-sec">
        <SectionLabel color="var(--ev-activity-ink)" action={acts.length > 0 ? <button className="addmini" onClick={onAddActivity} aria-label={t('activity.add')}><Icon name="plus" size={14} /></button> : null}>
          {t('budget.source_activity')}{acts.length > 0 ? ` · ${acts.length}` : ''}
        </SectionLabel>
        {acts.map((a) => (
          <BookRow key={a.id} tone="activity" icon={ACT_ICON[a.category] || 'spark'}
            title={a.title}
            sub={`${fmtDate(a.start_datetime)}${fmtTime(a.start_datetime) ? ' · ' + fmtTime(a.start_datetime) : ''}`}
            warn={isActWarn ? isActWarn(a) : false}
            onClick={() => onOpenActivity(a.id)} />
        ))}
        <GhostAdd icon="spark" accent="var(--ev-activity)" label={t('activity.add')} onClick={onAddActivity} />
      </div>
      </div>
      <div className="lp-f">
        <Btn variant="danger" size="sm" icon="trash" onClick={onRemove}>{t('common.delete')}</Btn>
        <span style={{ flex: 1 }} />
        <Btn variant="primary" size="sm" icon="check" onClick={onBack}>{t('common.done')}</Btn>
      </div>
    </div>
  );
}
