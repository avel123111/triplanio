import * as Dialog from '@radix-ui/react-dialog';
import { pointType, TONE } from '@/lib/travel-stats';
import { getGradientById } from '@/lib/trip-gradients';
import { Icon } from '@/design/icons';

// Visit panel for the "My statistics" screen — opens when a country/city/pin is
// selected and lists every visit at that place (newest first). Reuses Radix
// Dialog (focus-trap / Esc / scroll-lock / outside-click) exactly like the
// canonical Sheet; the `.vpanel` CSS makes it a right slide-over on desktop and a
// bottom sheet under 640px (same breakpoint as the rest of the app). Read-only:
// manual visits show an "added manually" tag — editing lands in the later PR.
//
// Props:
//   open, onOpenChange  — controlled visibility
//   kind                — 'country' | 'city' (icon + accent)
//   name, sub           — header title / subtitle (already localized by caller)
//   visits              — point rows for this place, pre-sorted desc by date:
//                         { city_name, country_code, kind, trip_id, start_date, end_date }
//   trips               — { [trip_id]: { title, cover_gradient } } from the RPC
//   t, lang             — i18n
//   onOpenTrip(tripId)  — navigate to a trip

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

function VisitRow({ v, trips, t, lang, onOpenTrip, onEditManual }) {
  const type = pointType(v);
  const color = TONE[type] || TONE.trip;
  const yr = new Date(v.start_date || v.end_date).getFullYear();
  const trip = v.kind === 'trip' && v.trip_id ? trips?.[v.trip_id] : null;
  const grad = trip?.cover_gradient ? getGradientById(trip.cover_gradient) : null;
  return (
    <div className="visit">
      <div className="when">
        <div className="mo">{monthShort(v.start_date || v.end_date, lang)}</div>
        <div className="yr">{Number.isFinite(yr) ? yr : '—'}</div>
      </div>
      <div className="info">
        <div className="dt">{v.city_name}</div>
        <div className="rng">{dateRange(v.start_date, v.end_date, lang)}</div>
        <div className="vbottom">
          <span className="vpill" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
            <i className="d" style={{ background: color }} />{t(`stats.type_${type}`)}
          </span>
          {trip ? (
            <button type="button" className="triplink" onClick={() => onOpenTrip?.(v.trip_id)}>
              <span className="d" style={{ background: grad ? grad.css : 'var(--primary)' }} />
              {trip.title || t('stats.open_trip')}
              <Icon name="arrowR" />
            </button>
          ) : v.kind === 'custom' ? (
            onEditManual ? (
              <button type="button" className="triplink" onClick={() => onEditManual(v)}>
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
  open, onOpenChange, kind = 'country', name, sub, visits = [], trips = {}, t, lang, onOpenTrip, onEditManual,
}) {
  const isCity = kind === 'city';
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vscrim" />
        <Dialog.Content
          className="vpanel"
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="vp-grip" />
          <div className={`vp-h${isCity ? ' city' : ''}`}>
            <div className="ic">{isCity ? <Icon name="buildings" /> : <Icon name="globe" />}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Dialog.Title asChild><h3>{name}</h3></Dialog.Title>
              <div className="s">{sub}</div>
            </div>
            <Dialog.Close asChild>
              <button className="vp-x" aria-label={t('common.close') || 'Close'}><Icon name="close" /></button>
            </Dialog.Close>
          </div>
          <div className="vp-b">
            {visits.map((v, i) => (
              <VisitRow key={`${v.city_name}-${v.start_date}-${i}`} v={v} trips={trips} t={t} lang={lang} onOpenTrip={onOpenTrip} onEditManual={onEditManual} />
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
