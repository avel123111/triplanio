import * as Dialog from '@radix-ui/react-dialog';
import { pointType } from '@/lib/travel-stats';
import { getGradientById } from '@/lib/trip-gradients';

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

const TYPE_COLOR = { trip: 'var(--primary)', manual: 'var(--ev-car)', future: 'var(--ai)' };

const IconGlobe = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 0 0 18" /></svg>
);
const IconCity = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V8l5-3v16M14 21V10l5-2v13" /></svg>
);
const IconX = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
const IconArrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
const IconEdit = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);

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
  const color = TYPE_COLOR[type] || TYPE_COLOR.trip;
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
              <IconArrow />
            </button>
          ) : v.kind === 'custom' ? (
            onEditManual ? (
              <button type="button" className="triplink" onClick={() => onEditManual(v)}>
                <IconEdit />{t('stats.edit_place')}
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
            <div className="ic">{isCity ? <IconCity /> : <IconGlobe />}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Dialog.Title asChild><h3>{name}</h3></Dialog.Title>
              <div className="s">{sub}</div>
            </div>
            <Dialog.Close asChild>
              <button className="vp-x" aria-label={t('common.close') || 'Close'}><IconX /></button>
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
