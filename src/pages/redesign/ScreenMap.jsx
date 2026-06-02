import React, { useState, useMemo } from 'react';
import { Icon } from '../../design/icons';
import { Btn } from '../../design/index';
import MapView from '@/components/views/MapView';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import EventEditDialog from '@/components/common/EventEditDialog';
import { sortVisits } from '@/lib/validation';
import { countryFlag } from '@/lib/geo';
import { uniqueCityCount } from '@/lib/trip-cities';

// =====================================================================
// TRIP MAP - geographic lens - full-bleed Google Maps + scrollable sidebar
// =====================================================================

// Pretty short date "16 июл" - used in stepper / city card subtitles.
function fmtShortDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
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

function ScreenMap({ trip, visits = [], transfers = [], hotels = [], activities = [], canEdit = false, openEvent }) {
  const [theme, setTheme] = useState('auto');
  const [anchorsOff, setAnchorsOff] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [editMode, setEditMode] = useState(false);

  // Real route - visits with coordinates, in trip order. Filter out anchors
  // when the user hides them via the checkbox.
  const route = useMemo(() => {
    const all = sortVisits(visits).filter(v => v.latitude && v.longitude);
    return anchorsOff ? all.filter(v => v.kind !== 'start' && v.kind !== 'end') : all;
  }, [visits, anchorsOff]);
  const cityCount = useMemo(() => uniqueCityCount(route), [route]); // dedup repeated cities for the count

  // Reset active when the underlying route shrinks (e.g. anchors toggled off).
  React.useEffect(() => {
    if (activeIdx >= route.length) setActiveIdx(0);
  }, [route.length, activeIdx]);

  const isDark = (theme === 'auto' && document.documentElement.dataset.theme === 'dark') || theme === 'dark';
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
        background: isDark ? '#0e1a2e' : '#dceaf5',
        overflow: 'hidden',
        borderRight: '1px solid var(--line)',
      }}>
        <MapView
          visits={visits}
          transfers={transfers}
          visitsById={Object.fromEntries(visits.map(v => [v.id, v]))}
          showStartEnd={!anchorsOff}
          colorScheme={isDark ? 'DARK' : 'LIGHT'}
          onCityClick={(visitsAtPoint) => {
            const idx = route.findIndex(v => v.id === visitsAtPoint[0]?.id);
            if (idx !== -1) setActiveIdx(idx);
          }}
        />

        {/* Top-left: trip identity + theme + anchors */}
        <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360, zIndex: 5 }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12,
            padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: 'var(--shadow-soft)',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <Icon name="map" size={14} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                {trip?.title || 'Путешествие'}
              </div>
              <div className="num muted" style={{ fontSize: 11, lineHeight: 1.2, marginTop: 1 }}>
                {cityCount} {cityCount === 1 ? 'город' : cityCount < 5 ? 'города' : 'городов'}
              </div>
            </div>
          </div>

          {/* Theme controls */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 11, padding: 5, display: 'flex', gap: 3 }}>
            {[['auto', 'Авто'], ['light', 'День'], ['dark', 'Ночь']].map(([t, l]) => (
              <button key={t} onClick={() => setTheme(t)} style={{
                padding: '5px 9px', borderRadius: 6, border: 'none',
                background: theme === t ? 'var(--wash)' : 'transparent',
                fontSize: 11.5, fontWeight: 500, cursor: 'pointer', color: 'var(--ink)',
              }}>{l}</button>
            ))}
          </div>

          <label style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 11, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" checked={!anchorsOff} onChange={() => setAnchorsOff(!anchorsOff)} />
            <span>Якоря старта/финиша</span>
          </label>
        </div>

        {/* Top-right: edit mode toggle */}
        {canEdit && (
          <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', zIndex: 5 }}>
            <Btn variant={editMode ? 'primary' : 'ghost'} size="sm" icon="edit" onClick={() => setEditMode(!editMode)}
              style={{ background: editMode ? undefined : 'var(--surface)', boxShadow: editMode ? undefined : 'var(--shadow-soft)' }}>
              {editMode ? 'Готово' : 'Редактировать'}
            </Btn>
          </div>
        )}

        {/* Legend */}
        <div style={{
          position: 'absolute', bottom: 16, left: 16, zIndex: 5,
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 11,
          padding: '10px 14px', fontSize: 11.5, boxShadow: 'var(--shadow-soft)',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}>Линии маршрута</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Legend color="var(--brand)" dashed={false}>Запланирован</Legend>
            <Legend color="var(--success)" dashed={false}>Наземный (известный)</Legend>
            <Legend color="var(--warning)" dashed>Не запланирован</Legend>
          </div>
        </div>
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
          editMode={editMode}
          transfers={transfers}
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
              <div style={{ fontSize: 13 }}>Нет городов на карте</div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

// ----- Route stepper - adaptive: horizontal for ≤5 cities, compact list for >5 -----
function RouteStepper({ route, activeIdx, setActiveIdx, editMode, transfers }) {
  const isLong = route.length > 5;
  const nCities = uniqueCityCount(route); // dedup repeated cities for the count
  // Has-transfer lookup between consecutive route items (used for the
  // dashed/solid connector line between pills).
  const transferBetween = (a, b) => transfers.some(t => t.from_city_visit_id === a?.id && t.to_city_visit_id === b?.id);

  if (!isLong) {
    return (
      <div style={{
        padding: '14px 14px 12px',
        borderBottom: '1px solid var(--line-2)',
        background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <span className="eyebrow" style={{ flex: 1 }}>
            Маршрут · {nCities} {nCities === 1 ? 'город' : nCities < 5 ? 'города' : 'городов'}
          </span>
        </div>
        <div className="scrollbar-thin" style={{ display: 'flex', alignItems: 'center', gap: 0, position: 'relative', overflowX: 'auto' }}>
          {route.map((c, i) => (
            <React.Fragment key={c.id}>
              <button onClick={() => setActiveIdx(i)} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '6px 4px', background: 'transparent', border: 'none', cursor: 'pointer',
                flex: '0 0 auto', minWidth: 60,
              }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: activeIdx === i ? 'var(--brand)' : 'var(--brand-soft)',
                  color: activeIdx === i ? 'white' : 'var(--brand)',
                  display: 'grid', placeItems: 'center',
                  fontSize: 12, fontWeight: 700,
                  boxShadow: activeIdx === i ? '0 0 0 4px var(--brand-soft)' : 'none',
                  transition: 'all .15s ease',
                }}>{i + 1}</div>
                <div style={{ fontSize: 11, fontWeight: activeIdx === i ? 600 : 500, color: activeIdx === i ? 'var(--ink)' : 'var(--muted)', whiteSpace: 'nowrap', maxWidth: 78, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
        <span className="eyebrow" style={{ flex: 1 }}>Маршрут · {nCities} {nCities === 1 ? 'город' : nCities < 5 ? 'города' : 'городов'}</span>
      </div>
      <div className="scrollbar-thin" style={{ flex: 1, overflow: 'auto', padding: '0 14px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, position: 'relative' }}>
          <div style={{ position: 'absolute', left: 11, top: 12, bottom: 12, width: 2, background: 'var(--brand-soft-12)' }} />
          {route.map((c, i) => {
            const nights = nightsBetween(c.start_datetime, c.end_datetime);
            return (
              <button key={c.id} onClick={() => setActiveIdx(i)} style={{
                display: 'grid', gridTemplateColumns: '24px 1fr auto', alignItems: 'center', gap: 10,
                width: '100%', padding: '6px 6px 6px 0',
                background: activeIdx === i ? 'var(--brand-soft)' : 'transparent',
                border: 'none', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                position: 'relative', zIndex: 1,
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  background: activeIdx === i ? 'var(--brand)' : 'var(--surface)',
                  color: activeIdx === i ? 'white' : 'var(--brand)',
                  border: activeIdx === i ? 'none' : '2px solid var(--brand-soft-12)',
                  display: 'grid', placeItems: 'center',
                  fontSize: 10, fontWeight: 700, flexShrink: 0,
                }}>{i + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.city_name}</div>
                  {nights > 0 && (
                    <div className="muted num" style={{ fontSize: 10.5 }}>{nights} ноч.</div>
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
  plane: { icon: 'plane', label: 'Перелёт' },
  train: { icon: 'train', label: 'Поезд' },
  bus:   { icon: 'bus',   label: 'Автобус' },
  car:   { icon: 'car',   label: 'На авто' },
  walk:  { icon: 'walk',  label: 'Пешком' },
  bike:  { icon: 'walk',  label: 'Велосипед' },
  ferry: { icon: 'ferry', label: 'Паром' },
};

function ActiveCityCard({ visit, prevVisit, transfers, hotels, activities, activeIdx, canEdit, openEvent }) {
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

  const nights = nightsBetween(visit?.start_datetime, visit?.end_datetime);
  const primaryHotel = cityHotels[0] || null;

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
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: isStart || isEnd ? 'var(--ink-2)' : 'var(--brand)',
            color: 'white',
            display: 'grid', placeItems: 'center',
            fontSize: 17, fontWeight: 700, flexShrink: 0,
          }}>
            {isStart || isEnd ? <Icon name={isStart ? 'flag' : 'check'} size={18} /> : (activeIdx + 1)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22, letterSpacing: '-0.02em', lineHeight: 1.15 }}>
              {visit?.city_name}
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              {countryFlag(visit?.country_code)} {visit?.country || ''}
              {isStart && <> · старт</>}
              {isEnd && <> · финиш</>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {nights > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999, fontSize: 12, fontWeight: 500 }}>
              <Icon name="moon" size={12} style={{ color: 'var(--muted)' }} /> {nights} {nights === 1 ? 'ночь' : nights < 5 ? 'ночи' : 'ночей'}
            </span>
          )}
          {cityActivities.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', background: 'var(--surface)', border: '1px solid var(--line-2)', borderRadius: 999, fontSize: 12, fontWeight: 500 }}>
              <Icon name="cam" size={12} style={{ color: 'var(--warm)' }} /> {cityActivities.length} активн.
            </span>
          )}
        </div>
      </div>

      {/* Transfer row - real "From → To" or "Нет переезда" warning */}
      {showTransfer && (
        <TransferRow
          transfer={transferIn}
          prevVisit={prevVisit}
          toCity={visit}
          onOpen={transferIn && openEvent ? () => openEvent('transfer', transferIn.id) : undefined}
        />
      )}

      {/* Hotel row - real hotel or "Нет отеля" warning */}
      {showHotel && (
        <HotelRow
          hotel={primaryHotel}
          visit={visit}
          onOpen={primaryHotel && openEvent ? () => openEvent('hotel', primaryHotel.id) : undefined}
        />
      )}

      {/* Activities */}
      {cityActivities.length > 0 && (
        <div style={{ padding: '14px 16px 4px' }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>В этом городе</div>
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
                  <Icon name="cam" size={11} />
                </div>
                <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.35 }}>
                    {a.title}
                  </div>
                  {a.start_datetime && (
                    <div className="muted num" style={{ fontSize: 11.5, marginTop: 2 }}>{fmtShortDate(a.start_datetime)}{a.start_datetime?.slice(11, 16) ? ` · ${a.start_datetime.slice(11, 16)}` : ''}</div>
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
            Активность
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

function TransferRow({ transfer, prevVisit, toCity, onOpen }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const fromName = prevVisit?.city_name || 'Предыдущий город';
  const toName = toCity?.city_name || '';

  if (!transfer) {
    const canFork = !!(prevVisit && toCity);
    // No inbound transfer - show warning row that opens ForkPartnerModal.
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
            <div style={{ fontSize: 14, fontWeight: 600 }}>Нет переезда</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>
              Из «{fromName}» - добавить
            </div>
          </div>
          <Btn variant="ghost" size="sm" icon="plus">Найти</Btn>
        </button>
        {canFork && (
          <>
            <ForkPartnerModal
              open={modalOpen}
              onOpenChange={setModalOpen}
              type="transfer"
              fromVisit={prevVisit}
              toVisit={toCity}
              tripId={prevVisit?.trip_id || toCity?.trip_id}
              onManual={() => setCreateOpen(true)}
            />
            <EventEditDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              kind="transfer"
              fromVisit={prevVisit}
              toVisit={toCity}
              tripId={prevVisit?.trip_id || toCity?.trip_id}
              entity={null}
            />
          </>
        )}
      </>
    );
  }

  const meta = KIND_META[transfer.transport_type] || KIND_META.car;
  const subtitle = [
    meta.label,
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
        <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span>{fromName}</span>
          <Icon name="arrowR" size={12} style={{ color: 'var(--muted-2)' }} />
          <span>{toName}</span>
        </div>
        <div className="muted num" style={{ fontSize: 12, marginTop: 2 }}>{subtitle}</div>
      </div>
      <Icon name="chev" size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
    </button>
  );
}

function HotelRow({ hotel, visit, onOpen }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  if (!hotel) {
    const canFork = !!visit;
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
            <div style={{ fontSize: 14, fontWeight: 600 }}>Нет отеля</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 2, lineHeight: 1.4 }}>Не забронирован - нужно выбрать</div>
          </div>
          <Btn variant="ghost" size="sm" icon="plus">Найти</Btn>
        </button>
        {canFork && (
          <>
            <ForkPartnerModal
              open={modalOpen}
              onOpenChange={setModalOpen}
              type="hotel"
              visit={visit}
              tripId={visit?.trip_id}
              onManual={() => setCreateOpen(true)}
            />
            <EventEditDialog
              open={createOpen}
              onOpenChange={setCreateOpen}
              kind="hotel"
              visit={visit}
              tripId={visit?.trip_id}
              entity={null}
            />
          </>
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
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {hotel.name}
        </div>
        <div className="muted num" style={{ fontSize: 12, marginTop: 2 }}>
          {[fmtShortDate(hotel.check_in_datetime), fmtShortDate(hotel.check_out_datetime)].filter(Boolean).join(' → ') || 'Заезд → выезд'}
        </div>
      </div>
      <Icon name="chev" size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />
    </button>
  );
}

function Legend({ color, dashed, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width="30" height="2"><line x1="0" y1="1" x2="30" y2="1" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '4 3' : '0'} /></svg>
      <span>{children}</span>
    </div>
  );
}

export default ScreenMap;
