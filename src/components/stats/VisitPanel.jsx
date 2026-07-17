import * as Dialog from '@radix-ui/react-dialog';
import { Drawer } from 'vaul';
import { pointType, TONE } from '@/lib/travel-stats';
import { coverGradientCss } from '@/lib/trip-gradients';
import { keepFocusInDialog } from '@/lib/dialogFocus';
import { useIsPhone } from '@/hooks/use-mobile';
import { Icon } from '@/design/icons';

// ≤640px the panel is a bottom sheet — render it through vaul (native swipe +
// keyboard-safe) instead of the CSS-restyled Radix drawer. Above 640 it stays
// the desktop right slide-over. Uses the shared ≤640px sheet breakpoint hook
// (src/hooks/use-mobile), matching the `.vpanel` breakpoint in app.css.

// Visit panel for the "My statistics" screen — opens when a country/city/pin is
// selected and lists the visits at that place. Reuses Radix Dialog (focus-trap /
// Esc / scroll-lock / outside-click) exactly like the canonical Sheet; the
// `.vpanel` CSS makes it a right slide-over on desktop and a bottom sheet under
// 640px (same breakpoint as the rest of the app).
//
// Visits are GROUPED BY TRIP — one trip = one row. On a country panel the row
// lists the cities visited on that trip ("Мадрид, Барселона +2", same shape as a
// trip card); on a city panel it is one deduped row per trip (a city visited
// twice in the same trip no longer doubles). Manual visits each render as their
// own editable row (onEditManual → AddPlaceDialog).
//
// Props:
//   open, onOpenChange  — controlled visibility
//   kind                — 'country' | 'city'
//   cc                  — ISO-3166-1 alpha-2 for the header flag (country / city's country)
//   name, sub           — header title / subtitle (already localized by caller)
//   visits              — point rows for this place: { city_name, country_code,
//                         kind, trip_id, start_date, end_date }
//   trips               — { [trip_id]: { title, cover_gradient, cover_image_url } }
//   t, lang             — i18n
//   onOpenTrip(tripId)  — navigate to a trip
//   onEditManual(point) — open AddPlaceDialog for a manual visit

function monthShort(dateStr, lang) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleDateString(lang || 'en', { month: 'short' }).replace('.', ''); }
  catch { return d.toLocaleDateString('en', { month: 'short' }); }
}

function dateRange(a, b, lang) {
  const A = new Date(a);
  const B = new Date(b || a);
  const fmtDM = (d) => `${d.getDate()} ${monthShort(d.toISOString(), lang)}`;
  if (Number.isNaN(A.getTime())) return '';
  if (Number.isNaN(B.getTime())) return `${fmtDM(A)} ${A.getFullYear()}`;
  return `${fmtDM(A)} – ${fmtDM(B)} ${B.getFullYear()}`;
}

// "Мадрид, Барселона +2" — same convention as the trip card's scope label.
function citiesLabel(cities, t) {
  if (!cities.length) return '';
  if (cities.length <= 3) return cities.join(', ');
  return `${cities.slice(0, 2).join(', ')} ${t('trips.cities_more', { count: cities.length - 2 })}`;
}

// Collapse a place's visits into display rows: one per trip (date span + deduped
// cities for that trip) + one per manual visit. Newest first.
function groupVisits(visits = []) {
  const tripMap = new Map();
  const manual = [];
  for (const v of visits) {
    if (v.kind === 'trip' && v.trip_id) {
      let g = tripMap.get(v.trip_id);
      if (!g) { g = { trip_id: v.trip_id, items: [] }; tripMap.set(v.trip_id, g); }
      g.items.push(v);
    } else if (v.kind === 'custom') {
      manual.push(v);
    }
  }
  const tripRows = [...tripMap.values()].map((g) => {
    const starts = g.items.map((x) => x.start_date).filter(Boolean).sort();
    const ends = g.items.map((x) => x.end_date || x.start_date).filter(Boolean).sort();
    const cities = [...new Set(g.items.map((x) => x.city_name).filter(Boolean))];
    return { rowType: 'trip', trip_id: g.trip_id, start: starts[0] || null, end: ends[ends.length - 1] || null, cities, rep: g.items[0] };
  });
  const manualRows = manual.map((v) => ({ rowType: 'manual', start: v.start_date || null, end: v.end_date || null, cities: [v.city_name].filter(Boolean), v }));
  return [...tripRows, ...manualRows].sort((a, b) => new Date(b.start || 0) - new Date(a.start || 0));
}

// Trip swatch in the trip-link: the cover PHOTO if uploaded, else the gradient.
function TripDot({ trip }) {
  const photo = trip?.cover_image_url;
  const style = photo
    ? { backgroundImage: `url(${photo})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: coverGradientCss(trip?.cover_gradient) };
  return <span className="d" style={style} />;
}

// Header glyph: real country flag (same source as the lists), icon fallback.
function PanelFlag({ cc, isCity }) {
  if (!cc) return isCity ? <Icon name="buildings" /> : <Icon name="globe" />;
  return (
    <img
      src={`/flags/${String(cc).toLowerCase()}.svg`}
      alt=""
      loading="lazy"
      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
      onError={(e) => { if (e.currentTarget.dataset.fb !== '1') { e.currentTarget.dataset.fb = '1'; e.currentTarget.src = '/flags/xx.svg'; } }}
    />
  );
}

function GroupedRow({ row, isCity, trips, t, lang, onOpenTrip, onEditManual }) {
  const isManual = row.rowType === 'manual';
  const type = isManual ? 'manual' : pointType(row.rep);
  const color = TONE[type] || TONE.trip;
  const yr = new Date(row.start || row.end).getFullYear();
  const trip = !isManual ? trips?.[row.trip_id] : null;
  const title = isCity ? (row.cities[0] || '') : citiesLabel(row.cities, t);
  return (
    <div className="visit">
      <div className="when">
        <div className="mo">{monthShort(row.start || row.end, lang)}</div>
        <div className="yr">{Number.isFinite(yr) ? yr : '—'}</div>
      </div>
      <div className="info">
        <div className="dt">{title}</div>
        <div className="rng">{dateRange(row.start, row.end, lang)}</div>
        <div className={`vbottom${type === 'future' ? ' vbottom--stack' : ''}`}>
          {/* "С поездкой" (type==='trip') показывает только бейдж трипа — сам
              статус-пилл скрыт. "Запланировано"/"Вручную" пилл оставляют. */}
          {type !== 'trip' && (
            <span className="vpill" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
              <i className="d" style={{ background: color }} />{t(`stats.type_${type}`)}
            </span>
          )}
          {!isManual && trip ? (
            <button type="button" className="triplink" onClick={() => onOpenTrip?.(row.trip_id)}>
              <TripDot trip={trip} />
              {trip.title || t('stats.open_trip')}
              <Icon name="chev" />
            </button>
          ) : isManual ? (
            onEditManual ? (
              <button type="button" className="triplink" onClick={() => onEditManual(row.v)}>
                <Icon name="edit" />{t('stats.edit_place')}
              </button>
            ) : (
              <span className="vmanual">{t('stats.added_manually')}</span>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function VisitPanel({
  open, onOpenChange, kind = 'country', cc, name, sub, visits = [], trips = {}, t, lang, onOpenTrip, onEditManual,
}) {
  const isCity = kind === 'city';
  const rows = groupVisits(visits);
  const isSheet = useIsPhone();

  // Shared body — the Radix Dialog.Title/Close primitives work inside either
  // Root (vaul wraps Radix Dialog), so the header is identical for both.
  const body = (
    <>
      {/* Visual drag affordance only — vaul drags the whole sheet on mobile. */}
      <div className="vp-grip" aria-hidden />
      <div className={`vp-h${isCity ? ' city' : ''}`}>
        <div className="ic" style={cc ? { background: 'transparent', borderRadius: '50%' } : undefined}><PanelFlag cc={cc} isCity={isCity} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Dialog.Title asChild><h3>{name}</h3></Dialog.Title>
          <div className="s">{sub}</div>
        </div>
        <Dialog.Close asChild>
          <button className="vp-x" aria-label={t('common.close') || 'Close'}><Icon name="close" /></button>
        </Dialog.Close>
      </div>
      <div className="vp-b">
        {rows.map((row, i) => (
          <GroupedRow
            key={`${row.rowType}-${row.trip_id || row.v?.id || i}-${row.start}`}
            row={row} isCity={isCity} trips={trips} t={t} lang={lang}
            onOpenTrip={onOpenTrip} onEditManual={onEditManual}
          />
        ))}
      </div>
    </>
  );

  if (isSheet) {
    return (
      // repositionInputs={false}: viewport meta already lifts the sheet above
      // the keyboard; vaul repositioning too would double-move it.
      <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
        <Drawer.Portal>
          <Drawer.Overlay className="vscrim" />
          <Drawer.Content className="vpanel" aria-describedby={undefined}>
            {body}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vscrim" />
        <Dialog.Content
          className="vpanel"
          aria-describedby={undefined}
          onOpenAutoFocus={keepFocusInDialog}
        >
          {body}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
