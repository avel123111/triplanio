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
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import CountryFlag from '@/components/common/CountryFlag';
import { Btn, IconBtn, ListRow, Stepper, Tile } from '@/design/index';
import { fmtDate, fmtTime, fmtPrice } from '@/components/common/EventViewBody';
import { transferKind } from '@/lib/transport';
import { formatDateRange } from '@/lib/trip-dates';
const money = (p, c) => fmtPrice(p, c) || '';
const rangeText = (a, b) => formatDateRange(a, b, fmtDate);

// Lumo section label: coloured uppercase tag (.sl) + optional icon-button action.
function SectionLabel({ children, color, action }) {
  return (
    <div className="sec-lbl" style={{ marginTop: 6 }}>
      <span className="sl" style={{ color: color || 'var(--muted)' }}>{children}</span>
      {action}
    </div>
  );
}
// Пунктирный плейсхолдер «добавить» — тот же примитив `<ListRow>`, что и заполненный
// ряд (variant="add"), поэтому встаёт РОВНО в высоту карточки наличия (TRIP-337).
// Акцент ховера приходит контекстной переменной `--a` (объявление ТОНА, не оформление).
function GhostAdd({ icon, label, sub, accent, onClick }) {
  const a = accent || 'var(--brand)';
  return (
    <ListRow
      variant="add"
      lead={<Tile tone="quiet" icon={icon || 'plus'} />}
      title={label}
      sub={sub}
      trail={<Icon name="plus" size={16} />}
      onClick={onClick}
      style={{ '--a': a }}
    />
  );
}
// Booking row — канон <ListRow variant="raised">: тонированная плитка (тон эвента)
// + заголовок/подпись + опциональный warn + шеврон.
function BookRow({ tone = 'hotel', icon, title, sub, warn, onClick }) {
  return (
    <ListRow
      variant="raised"
      lead={<Tile tone={warn ? 'warning' : tone} icon={icon} />}
      title={title}
      sub={sub || undefined}
      trail={(
        <>
          {warn && <Icon name="warning" size={15} style={{ color: 'var(--warning-ink)', flexShrink: 0 }} />}
          <Icon name="chev" size={16} className="chev" />
        </>
      )}
      onClick={onClick}
    />
  );
}
function FlightLine({ transfer, dir, warn, onClick, t }) {
  const meta = transferKind(transfer.transport_type);
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
  node, cityNo, hotels = [], acts = [], arrival, departure, prevCity, nextCity,
  isHotelWarn, isActWarn, arrivalWarn = false, departureWarn = false, onBack, onRemove,
  onNightsMinus, onNightsPlus,
  onOpenHotel, onAddHotel, onOpenActivity, onAddActivity, onOpenTransfer, onAddArrival, onAddDeparture,
}) {
  const { t } = useI18n();
  // Country name is derived live from the ISO country_code (TRIP-223) — the legacy
  // denormalized node.country column was dropped. fmtCountry re-localizes on lang change.
  const { fmtCountry } = useI18nFormat();
  // Waypoint = a 0-night transit stop: it has arrival/departure transfers and
  // activities like a normal city, but NO hotel (no overnight stay); the nights
  // stepper turns it back into a city when raised above 0.
  const isWaypoint = node.kind === 'waypoint';
  const nights = isWaypoint ? 0 : (node.nights || 0);

  return (
    <div className="lp lp--wide">
      {/* Header — канон .lp-h с brand-градиентом (как остальные драйверы, но не цвет
          эвента): слева номер города / иконка пересадки, затем 3 строки.
          У города СВОЕГО тона нет, поэтому канал --hl* тут ничем не заполняется:
          значения приходят из :root, а они и есть бренд. Инлайн, который писал
          сюда ровно эти три дефолта, снят в 04 PR3 — он ничего не менял. */}
      <div className="lp-h lp-h--ev">
        <Tile as="span" className="lp-ic" style={{ '--hl-soft': 'var(--brand-soft)', '--hl-ink': 'var(--brand)' }}>
          {isWaypoint ? <Icon name="arrowSwap" size={17} /> : <b className="t-strong">{cityNo}</b>}
        </Tile>
        <div className="lp-ti col col--g1">
          <div className="eyebrow" style={{ color: 'var(--brand)' }}>{t('tse.route_city')} · {isWaypoint ? t('tse.pt_waypoint') : t('tse.node_visit')}</div>
          <b>{node.city_name}</b>
          {node.country_code && <span className="lp-country"><CountryFlag code={node.country_code} />{fmtCountry(node.country_code)}</span>}
        </div>
        <IconBtn icon="close" tone="soft" round onClick={onBack} title={t('common.back')} ariaLabel={t('common.back')} />
      </div>

      <div className="lp-b scrollbar-thin">
      {/* Nights card — иконка · (заголовок + даты) · степпер (макет CityView). */}
      <div className="lp-stepper" style={{ marginBottom: 6 }}>
        <Tile as="span" className="lp-stepper__ic"><Icon name="moon" size={17} /></Tile>
        <div className="lp-stepper__tx">
          <b className="t-strong">{t('tse.nights_in_city')}</b>
          <span className="t-meta">{rangeText(node.start_date, node.end_date) || '—'}</span>
        </div>
        <Stepper
          title={t('tse.nights_label')}
          value={nights}
          onMinus={onNightsMinus} minusDisabled={nights <= 0} minusLabel={t('tse.nights_remove')}
          onPlus={onNightsPlus} plusLabel={t('tse.nights_add')}
        />
      </div>

      {/* arrival / departure — both cities AND waypoints (a transit stop still
          arrives and leaves; only the hotel is omitted for waypoints). */}
      <div className="col col--g4">
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
      <div className="col col--g4">
        <SectionLabel color="var(--ev-hotel-ink)" action={hotels.length > 0 ? <IconBtn icon="plus" tone="soft" size="sm" onClick={onAddHotel} ariaLabel={t('hotel.add')} /> : null}>
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
      <div className="col col--g4">
        <SectionLabel color="var(--ev-activity-ink)" action={acts.length > 0 ? <IconBtn icon="plus" tone="soft" size="sm" onClick={onAddActivity} ariaLabel={t('activity.add')} /> : null}>
          {t('budget.source_activity')}{acts.length > 0 ? ` · ${acts.length}` : ''}
        </SectionLabel>
        {acts.map((a) => (
          <BookRow key={a.id} tone="activity" icon="ticket"
            title={a.title}
            sub={`${fmtDate(a.start_datetime)}${fmtTime(a.start_datetime) ? ' · ' + fmtTime(a.start_datetime) : ''}`}
            warn={isActWarn ? isActWarn(a) : false}
            onClick={() => onOpenActivity(a.id)} />
        ))}
        <GhostAdd icon="ticket" accent="var(--ev-activity)" label={t('activity.add')} onClick={onAddActivity} />
      </div>
      </div>
      <div className="lp-f lp-f--ratio">
        <Btn variant="danger" icon="trash" onClick={onRemove} ariaLabel={t('common.delete')}><span className="btn-label-collapse">{t('common.delete')}</span></Btn>
        <Btn variant="primary" icon="check" onClick={onBack}>{t('common.done')}</Btn>
      </div>
    </div>
  );
}
