import React, { useState, useMemo } from 'react';
import { Icon } from '../design/icons';
import { Btn } from '../design/index';
import MapView from '@/components/views/MapView';
import { useI18n } from '@/lib/i18n/I18nContext';
import { DateTime } from 'luxon';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import EventEditDialog from '@/components/common/EventEditDialog';
import { sortVisits } from '@/lib/validation';
import CountryFlag from '@/components/common/CountryFlag';
import { uniqueCityCount } from '@/lib/trip-cities';

// =====================================================================
// TRIP MAP - geographic lens - full-bleed Google Maps + scrollable sidebar
// =====================================================================

// Pretty short date "16 июл" - used in stepper / city card subtitles.
// Short localized date "16 июл" / "16 Jul" — Luxon uses the app-wide active
// locale (Settings.defaultLocale, set on language change), so no hardcoded tag.
function fmtShortDate(iso) {
  if (!iso) return '';
  try {
    const dt = DateTime.fromISO(iso);
    return dt.isValid ? dt.toFormat('d LLL') : '';
  } catch { return ''; }
}

// Whole-night count between two ISO timestamps.
function nightsBetween(a, b) {
  if (!a || !b) return 0;
  const s = new Date(a).getTime();
  const e = new Date(b).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return 0;
  return Math.max(0, Math.round((e - s) / 86_400_000));
}

function ScreenMap({ visits = [], transfers = [], hotels = [], activities = [], canEdit = false, openEvent, active = true }) {
  const { t } = useI18n();
  const [activeIdx, setActiveIdx] = useState(0);
  const [hoverIdx, setHoverIdx] = useState(null); // stepper row hovered → highlight its map marker

  // Real route - visits with coordinates, in trip order. (Theme + start/finish
  // visibility are now toggled on the map itself via MapView's control buttons.)
  const route = useMemo(() => sortVisits(visits).filter(v => v.latitude && v.longitude), [visits]);

  React.useEffect(() => {
    if (activeIdx >= route.length) setActiveIdx(0);
  }, [route.length, activeIdx]);

  const isDark = document.documentElement.dataset.theme === 'dark';
  const activeVisit = route[activeIdx] || null;

  return (
    // The parent <main> in TripView is padding:0 + overflow:hidden when the
    // map lens is shown, so this grid fills the lens viewport completely.
    <div style={{
      height: '100%',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 360px',
      background: 'var(--surface)',
    }} className="trip-map-shell">

      {/* MAP - full-bleed Google Maps */}
      <div style={{
        position: 'relative',
        background: isDark ? '#0e1a2e' : '#dceaf5', // design-token-exempt: map backdrop tint behind the canvas
        overflow: 'hidden',
        borderRight: '1px solid var(--line)',
      }}>
        <MapView
          visits={visits}
          transfers={transfers}
          visitsById={Object.fromEntries(visits.map(v => [v.id, v]))}
          showStartEnd
          mapControls
          active={active}
          colorScheme={isDark ? 'DARK' : 'LIGHT'}
          selectedVisitId={activeVisit?.id}
          hoveredVisitId={hoverIdx != null ? route[hoverIdx]?.id : null}
          onCityClick={(visitsAtPoint) => {
            const idx = route.findIndex(v => v.id === visitsAtPoint[0]?.id);
            if (idx !== -1) setActiveIdx(idx);
          }}
        />
      </div>

      {/* SIDEBAR - sticky stepper + scrolling active city detail */}
      <aside style={{
        display: 'flex', flexDirection: 'column',
        background: 'var(--surface)',
        overflow: 'hidden',
        minWidth: 0,
      }}>
        <RouteStepper
          route={route}
          activeIdx={activeIdx}
          setActiveIdx={setActiveIdx}
          transfers={transfers}
          onHover={setHoverIdx}
        />

        <div className="scrollbar-thin" style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          {activeVisit ? (
            <ActiveCityCard
              visit={activeVisit}
              prevVisit={activeIdx > 0 ? route[activeIdx - 1] : null}
              transfers={transfers}
              hotels={hotels}
              activities={activities}
              activeIdx={activeIdx}
              canEdit={canEdit}
              openEvent={openEvent}
            />
          ) : (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--muted)' }}>
              <Icon name="pin" size={28} style={{ opacity: 0.4, marginBottom: 10 }} />
              <div className="t-body">{t('view.map_no_cities')}</div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ----- Route stepper - adaptive: horizontal for ≤5 cities, compact list for >5 -----
function RouteStepper({ route, activeIdx, setActiveIdx, transfers, onHover }) {
  const hoverProps = (i) => (onHover ? { onMouseEnter: () => onHover(i), onMouseLeave: () => onHover(null) } : {});
  const { t } = useI18n();
  const isLong = route.length > 5;
  const nCities = uniqueCityCount(route); // dedup repeated cities for the count
  const citiesWord = nCities === 1 ? t('trip.cities_count_one') : nCities < 5 ? t('trip.cities_count_few') : t('trip.cities_count_many');
  // Has-transfer lookup between consecutive route items (used for the
  // dashed/solid connector line between pills).
  const transferBetween = (a, b) => transfers.some(x => x.from_city_visit_id === a?.id && x.to_city_visit_id === b?.id);

  if (!isLong) {
    return (
      <div style={{
        padding: '14px 14px 12px',
        borderBottom: '1px solid var(--line-2)',
        background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <span className="eyebrow" style={{ flex: 1 }}>
            {t('trip.sidebar_route')} · {nCities} {citiesWord}
          </span>
        </div>
        <div className="scrollbar-thin" style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative', overflowX: 'auto' }}>
          {route.map((c, i) => (
            <React.Fragment key={c.id}>
              <button onClick={() => setActiveIdx(i)} {...hoverProps(i)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '6px 4px', background: 'transparent', border: 'none', cursor: 'pointer',
                flex: '0 0 auto', minWidth: 60,
              }}>
                <div className="t-meta" style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: activeIdx === i ? 'var(--brand)' : 'var(--brand-soft)',
                  color: activeIdx === i ? 'white' : 'var(--brand)',
                  display: 'grid', placeItems: 'center',
                  boxShadow: activeIdx === i ? '0 0 0 4px var(--brand-soft)' : 'none',
                  transition: 'all .15s ease',
                }}>{i + 1}</div>
                <div className="t-meta" style={{ color: activeIdx === i ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'nowrap', maxWidth: 78, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {c.city_name}
                </div>
              </button>
              {i < route.length - 1 && (
                <div style={{ flex: 1, minWidth: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: -16 }}>
                  <div style={{ height: 2, width: '100%', borderTop: transferBetween(c, route[i + 1]) ? '2px solid var(--brand-soft-12)' : '2px dashed var(--warning)' }} />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  // Long-route compact list
  return (
    <div style={{
      borderBottom: '1px solid var(--line-2)',
      background: 'var(--surface)',
      maxHeight: 280, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="eyebrow" style={{ flex: 1 }}>{t('trip.sidebar_route')} · {nCities} {citiesWord}</span>
      </div>
      <div className="scrollbar-thin" style={{ flex: 1, overflow: 'auto', padding: '0 14px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 11, top: 12, bottom: 12, width: 2, background: 'var(--brand-soft-12)' }} />
          {route.map((c, i) => {
            const nights = nightsBetween(c.start_date, c.end_date);
            return (
              <button key={c.id} onClick={() => setActiveIdx(i)} {...hoverProps(i)} style={{
                display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: 10,
                width: '100%', padding: '6px 6px 6px 0',
                background: activeIdx === i ? 'var(--brand-soft)' : 'transparent',
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                position: 'relative', zIndex: 1,
              }}>
                <div className="t-meta" style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: activeIdx === i ? 'var(--brand)' : 'var(--surface)',
                  color: activeIdx === i ? 'white' : 'var(--brand)',
                  border: activeIdx === i ? 'none' : '2px solid var(--brand-soft-12)',
                  display: 'grid', placeItems: 'center',
                  flexShrink: 0,
                }}>{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="t-meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.city_name}</div>
                  {nights > 0 && (
                    <div className="muted num t-meta">{nights} {t('ai_plan.unit_nights_short')}</div>
                  )}
                </div>
                <Icon name="chev" size={11} style={{ color: activeIdx === i ? 'var(--brand)' : 'var(--muted-2)' }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ----- Active city card - real data -----
const KIND_META = {
  plane: { icon: 'plane', labelKey: 'trip.tl_flight' },
  train: { icon: 'train', labelKey: 'transfer.train' },
  bus:   { icon: 'bus',   labelKey: 'transfer.bus' },
  car:   { icon: 'car',   labelKey: 'transfer.car' },
  walk:  { icon: 'walk',  labelKey: 'transfer.walk' },
  bike:  { icon: 'walk',  labelKey: 'transfer.bike' },
  ferry: { icon: 'ferry', labelKey: 'transfer.ferry' },
};

function ActiveCityCard({ visit, prevVisit, transfers, hotels, activities, activeIdx, canEdit, openEvent }) {
  const { t } = useI18n();
  const [activityCreateOpen, setActivityCreateOpen] = useState(false);
  // Per-city slices of the trip data.
  const cityHotels = hotels.filter(h => h.city_visit_id === visit?.id);
  const cityActivities = activities
    .filter(a => a.city_visit_id === visit?.id)
    .slice()
    .sort((a, b) => (a.start_datetime || '').localeCompare(b.start_datetime || ''));
  const transferIn = transfers.find(t => t.to_city_visit_id === visit?.id) || null;
  const isStart = visit?.kind === 'start';
  const isEnd = visit?.kind === 'end';
  // The very first stop on the route never has an inbound transfer to show.
  // Anchor visits (start/end) don't get the hotel row either.
  const showTransfer = !isStart;
  const showHotel = !isStart && !isEnd;

  const nights = nightsBetween(visit?.start_date, visit?.end_date);

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14,
      overflow: 'hidden',
    }}>
      {/* Hero header */}
      <div style={{
        padding: '16px 16px 14px',
        background: 'linear-gradient(135deg, var(--brand-soft) 0%, var(--wash) 100%)',
        borderBottom: '1px solid var(--line-2)',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
          <div className="t-subheading" style={{
            width: 44, height: 44, borderRadius: 10,
            background: isStart || isEnd ? 'var(--ink-2)' : 'var(--brand)',
            color: 'white',
            display: 'grid', placeItems: 'center',
            flexShrink: 0,
          }}>
            {isStart || isEnd ? <Icon name={isStart ? 'flag' : 'check'} size={18} /> : (activeIdx + 1)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-heading">
              {visit?.city_name}
            </div>
            <div className="muted t-body" style={{ marginTop: 4 }}>
              <CountryFlag code={visit?.country_code} /> {visit?.country || ''}
              {isStart && <> {t('view.map_start_suffix')}</>}
              {isEnd && <> {t('view.map_finish_suffix')}</>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {nights > 0 && (
            <span className="t-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999 }}>
              <Icon name="moon" size={12} style={{ color: 'var(--muted)' }} /> {nights} {nights === 1 ? t('trip.nights_one') : nights < 5 ? t('trip.nights_few') : t('trip.nights_many')}
            </span>
          )}
          {cityActivities.length > 0 && (
            <span className="t-meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999 }}>
              <Icon name="ticket" size={12} style={{ color: 'var(--warm)' }} /> {cityActivities.length} {t('view.map_activities_short')}
            </span>
          )}
        </div>
      </div>

      {/* Transfer row - real "From → To" or "Нет переезда" warning (warning
          only shown to users who can edit; viewers don't get the nag). */}
      {showTransfer && (
        <TransferRow
          transfer={transferIn}
          prevVisit={prevVisit}
          toCity={visit}
          canEdit={canEdit}
          onOpen={transferIn && openEvent ? () => openEvent('transfer', transferIn.id) : undefined}
        />
      )}

      {/* Hotel rows - every booked hotel for this city; if none, a single
          "Нет отеля" warning (shown to editors only). */}
      {showHotel && (
        cityHotels.length > 0
          ? cityHotels.map(h => (
              <HotelRow
                key={h.id}
                hotel={h}
                visit={visit}
                canEdit={canEdit}
                onOpen={openEvent ? () => openEvent('hotel', h.id) : undefined}
              />
            ))
          : <HotelRow hotel={null} visit={visit} canEdit={canEdit} />
      )}

      {/* Activities */}
      {cityActivities.length > 0 && (
        <div style={{ padding: '14px 16px 4px' }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>{t('view.map_in_this_city')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, position: 'relative' }}>
            <div style={{ position: 'absolute', left: 11, top: 6, bottom: 6, width: 2, background: 'var(--line-2)' }} />
            {cityActivities.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={openEvent ? () => openEvent('activity', a.id) : undefined}
                disabled={!openEvent}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '8px 0', position: 'relative', zIndex: 1,
                  background: 'transparent', border: 'none', textAlign: 'left',
                  cursor: openEvent ? 'pointer' : 'default', width: '100%',
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: 'var(--surface)',
                  border: '2px solid var(--ev-activity)',
                  color: 'var(--ev-activity)',
                  display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                  <Icon name="ticket" size={11} />
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                  <div className="t-body" style={{ color: 'var(--ink)' }}>
                    {a.title}
                  </div>
                  {a.start_datetime && (
                    <div className="muted num t-meta" style={{ marginTop: 2 }}>{fmtShortDate(a.start_datetime)}{a.start_datetime?.slice(11, 16) ? ` · ${a.start_datetime.slice(11, 16)}` : ''}</div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer - "+ Активность" opens EventEditDialog in activity-create mode */}
      {!isStart && !isEnd && (
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center',
          padding: '10px 12px',
          borderTop: '1px solid var(--line-2)',
          background: 'var(--wash)',
        }}>
          <Btn variant="primary" size="sm" icon="plus" onClick={() => setActivityCreateOpen(true)} style={{ flex: 1 }} disabled={!canEdit}>
            {t('budget.source_activity')}
          </Btn>
        </div>
      )}

      {visit && (
        <EventEditDialog
          open={activityCreateOpen}
          onOpenChange={setActivityCreateOpen}
          kind="activity"
          visit={visit}
          tripId={visit.trip_id}
          entity={null}
        />
      )}
    </div>
  );
}

function TransferRow({ transfer, prevVisit, toCity, onOpen, canEdit = false }) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const fromName = prevVisit?.city_name || t('view.map_prev_city');
  const toName = toCity?.city_name || '';

  if (!transfer) {
    // Viewers (no edit rights) never see the "no transfer" warning - they can't
    // add bookings, so it's just noise that exposes planning gaps.
    if (!canEdit) return null;
    const canFork = !!(prevVisit && toCity);
    const tripId = prevVisit?.trip_id || toCity?.trip_id;
    // No inbound transfer - warning row → ForkPartnerModal; the manual branch
    // opens the Edit screen with the transfer-create panel pre-selected (same
    // flow as the timeline), instead of an inline create dialog.
    return (
      <>
        <button
          type="button"
          onClick={canFork ? () => setModalOpen(true) : undefined}
          disabled={!canFork}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            width: '100%', padding: '14px 16px',
            background: 'transparent', cursor: canFork ? 'pointer' : 'default', textAlign: 'left',
            borderTop: 'none', borderLeft: '3px solid var(--warning)',
            borderRight: 'none', borderBottom: '1px solid var(--line-2)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--wash)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <div style={{
            width: 40, height: 40, borderRadius: 9,
            background: 'var(--warning-soft)', color: 'var(--warning)',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            <Icon name="warning" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-ui">{t('view.map_no_transfer')}</div>
            <div className="muted t-meta" style={{ marginTop: 2 }}>
              {t('view.map_from_add', { city: fromName })}
            </div>
          </div>
          <Btn variant="ghost" size="sm" icon="plus">{t('view.map_find')}</Btn>
        </button>
        {canFork && (
          <ForkPartnerModal
            open={modalOpen}
            onOpenChange={setModalOpen}
            type="transfer"
            fromVisit={prevVisit}
            toVisit={toCity}
            tripId={tripId}
            onManual={() => { setModalOpen(false); setCreateOpen(true); }}
          />
        )}
        {createOpen && (
          <EventEditDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            kind="transfer"
            fromVisit={prevVisit}
            toVisit={toCity}
            tripId={tripId}
          />
        )}
      </>
    );
  }

  const meta = KIND_META[transfer.transport_type] || KIND_META.car;
  const subtitle = [
    t(meta.labelKey),
    transfer.duration,
    transfer.carrier,
  ].filter(Boolean).join(' · ') || '-';

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '14px 16px',
        background: 'transparent', cursor: onOpen ? 'pointer' : 'default', textAlign: 'left',
        borderTop: 'none', borderLeft: '3px solid var(--ev-transfer)',
        borderRight: 'none', borderBottom: '1px solid var(--line-2)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--wash)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 9,
        background: 'var(--ev-transfer-soft)', color: 'var(--ev-transfer)',
        display: 'grid', placeItems: 'center', flexShrink: 0,
      }}>
        <Icon name={meta.icon} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-ui" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{fromName}</span>
          <Icon name="arrowR" size={12} style={{ color: 'var(--muted-2)' }} />
          <span>{toName}</span>
        </div>
        <div className="muted num t-meta" style={{ marginTop: 2 }}>{subtitle}</div>
      </div>
      <Icon name="chev" size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
    </button>
  );
}

function HotelRow({ hotel, visit, onOpen, canEdit = false }) {
  const { t } = useI18n();
  const [modalOpen, setModalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  if (!hotel) {
    // Viewers don't see the "no hotel" warning (can't act on it).
    if (!canEdit) return null;
    const canFork = !!visit;
    const tripId = visit?.trip_id;
    return (
      <>
        <button
          type="button"
          onClick={canFork ? () => setModalOpen(true) : undefined}
          disabled={!canFork}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            width: '100%', padding: '14px 16px',
            background: 'transparent', cursor: canFork ? 'pointer' : 'default', textAlign: 'left',
            borderTop: 'none', borderLeft: '3px solid var(--warning)',
            borderRight: 'none', borderBottom: '1px solid var(--line-2)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--wash)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          <div style={{
            width: 40, height: 40, borderRadius: 9,
            background: 'var(--warning-soft)', color: 'var(--warning)',
            display: 'grid', placeItems: 'center', flexShrink: 0,
          }}>
            <Icon name="warning" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="t-ui">{t('hotel.no_hotel_gap')}</div>
            <div className="muted t-meta" style={{ marginTop: 2 }}>{t('view.map_hotel_not_booked')}</div>
          </div>
          <Btn variant="ghost" size="sm" icon="plus">{t('view.map_find')}</Btn>
        </button>
        {canFork && (
          <ForkPartnerModal
            open={modalOpen}
            onOpenChange={setModalOpen}
            type="hotel"
            visit={visit}
            tripId={tripId}
            onManual={() => { setModalOpen(false); setCreateOpen(true); }}
          />
        )}
        {createOpen && (
          <EventEditDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            kind="hotel"
            visit={visit}
            tripId={tripId}
          />
        )}
      </>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={!onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '14px 16px',
        background: 'transparent', cursor: onOpen ? 'pointer' : 'default', textAlign: 'left',
        borderTop: 'none', borderLeft: '3px solid transparent',
        borderRight: 'none', borderBottom: '1px solid var(--line-2)',
      }}
      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--wash)'}
      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{
        width: 40, height: 40, borderRadius: 9,
        background: 'var(--ev-hotel-soft)', color: 'var(--ev-hotel)',
        display: 'grid', placeItems: 'center', flexShrink: 0,
      }}>
        <Icon name="bed" size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-ui" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {hotel.name}
        </div>
        <div className="muted num t-meta" style={{ marginTop: 2 }}>
          {[fmtShortDate(hotel.check_in_datetime), fmtShortDate(hotel.check_out_datetime)].filter(Boolean).join(' → ') || t('view.map_checkin_checkout')}
        </div>
      </div>
      <Icon name="chev" size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
    </button>
  );
}


export default ScreenMap;
