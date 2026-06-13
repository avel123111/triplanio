import React, { useMemo } from 'react';
import { ExternalLink, Bed, Plane, Car, Wifi, ShieldCheck, ArrowLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Btn } from '@/design/index';
import {
  hotelPlatforms,
  transferPlatforms,
  carRentalPlatforms,
  esimPlatforms,
  insurancePlatforms,
} from '@/components/bookings/buildBookingPlatforms';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { SERVICE_KINDS } from '@/lib/serviceKinds';
import Stay22HotelList from '@/components/bookings/Stay22HotelList';

// Visual + copy metadata per fork type. Service colours (esim/car/insurance)
// come from the shared SERVICE_KINDS source so the fork modal matches the
// service cards and view/edit dialogs; hotel/transfer use the event palette.
const TYPE_META = {
  hotel: {
    titleKey: 'hotel.choice_title',
    manualKey: 'hotel.choice_manual',
    manualSubKey: 'fork.manual_sub_hotel',
    Icon: Bed,
    color: 'var(--ev-hotel)',
    colorSoft: 'var(--ev-hotel-soft)',
  },
  transfer: {
    titleKey: 'transfer.add_dialog_title',
    manualKey: 'transfer.manual_short',
    manualSubKey: 'fork.manual_sub_transfer',
    Icon: Plane,
    color: 'var(--ev-transfer)',
    colorSoft: 'var(--ev-transfer-soft)',
  },
  car_rental: {
    titleKey: 'service.car_choice_title',
    manualKey: 'service.car_choice_manual',
    manualSubKey: 'fork.manual_sub_car',
    Icon: Car,
    color: SERVICE_KINDS.car_rental.color,
    colorSoft: SERVICE_KINDS.car_rental.soft,
  },
  esim: {
    titleKey: 'service.esim_choice_title',
    manualKey: 'service.esim_choice_manual',
    manualSubKey: 'fork.manual_sub_esim',
    Icon: Wifi,
    color: SERVICE_KINDS.esim.color,
    colorSoft: SERVICE_KINDS.esim.soft,
  },
  insurance: {
    titleKey: 'service.insurance_choice_title',
    manualKey: 'service.insurance_choice_manual',
    manualSubKey: 'fork.manual_sub_insurance',
    Icon: ShieldCheck,
    color: SERVICE_KINDS.insurance.color,
    colorSoft: SERVICE_KINDS.insurance.soft,
  },
};

// Map fork type → enum value stored in partner_clicks.type (note: 'carrental').
const CLICK_TYPE = {
  hotel: 'hotel',
  transfer: 'transfer',
  car_rental: 'carrental',
  esim: 'esim',
  insurance: 'insurance',
};

// Brand display name per partner key (bold title in the new partner card).
const PARTNER_NAME = {
  booking: 'Booking.com', airbnb: 'Airbnb', skyscanner: 'Skyscanner', omio: 'Omio', kiwi: 'Kiwi.com',
  rentalcars: 'Rentalcars', discovercars: 'DiscoverCars', airalo: 'Airalo', yesim: 'Yesim',
  safetywing: 'SafetyWing', ektatraveling: 'Ekta Traveling',
};

/**
 * Two-column "Add manually OR pick a partner" dialog.
 * Replaces BookingChoiceDialog with a richer layout and per-type theming.
 */
export default function ForkPartnerModal({
  open,
  onOpenChange,
  type,
  visit,
  fromVisit,
  toVisit,
  visits,
  trip,
  tripId,
  onManual,
  // 'dialog' (default) = modal overlay; 'panel' = render inline in the trip
  // editor's left column (same content, PanelShell-style chrome + back button).
  variant = 'dialog',
}) {
  const { t, lang } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);
  const meta = TYPE_META[type] || TYPE_META.hotel;
  const tripCurrency = trip?.details?.main_currency || 'EUR';

  const platforms = useMemo(() => {
    if (type === 'hotel') return hotelPlatforms(visit, t);
    if (type === 'transfer') return transferPlatforms(fromVisit, toVisit, t);
    if (type === 'car_rental') return carRentalPlatforms(trip, t);
    if (type === 'esim') return esimPlatforms(visits, t);
    if (type === 'insurance') return insurancePlatforms(t);
    return [];
  }, [type, visit, fromVisit, toVisit, visits, trip, t]);

  const count = platforms.length;

  const handleManual = () => {
    onOpenChange(false);
    onManual?.();
  };

  const handlePartnerClick = (p) => {
    logClick({ partner: p.key, type: CLICK_TYPE[type] || type, link: p.url });
    // Browser still follows the anchor's href to open the new tab.
  };

  const ManualIcon = meta.Icon;

  const body = (
    <>
      <div className="fork-addzone">
        {/* Manual add — redesigned horizontal CTA, ev-colored */}
        <button
          type="button"
          className="fork-manual"
          onClick={handleManual}
          style={{ '--fk': meta.color, '--fk-soft': meta.colorSoft }}
        >
          <span className="fork-manual__ic"><ManualIcon size={20} /></span>
          <span className="fork-manual__tx">
            <b>{t('fork.manual_add')}</b>
            <span>{t(meta.manualSubKey)}</span>
          </span>
          <ChevronRight size={16} className="fork-manual__chev" />
        </button>

        {count > 0 && (
          <>
            <div className="fork-or"><span>{t('fork.or_find')}</span></div>
            <div className="fork-partners">
              {platforms.map((p) => (
                <a
                  key={p.key}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => handlePartnerClick(p)}
                  className="fork-partner"
                >
                  {p.logo ? (
                    <img className="fork-partner__logo" src={p.logo} alt="" />
                  ) : (
                    <span className="fork-partner__logo fork-partner__logo--ph"><ExternalLink size={16} /></span>
                  )}
                  <span className="fork-partner__mid">
                    <b>{PARTNER_NAME[p.key] || p.label}</b>
                    {p.hint && <span>{p.hint}</span>}
                  </span>
                  <ExternalLink size={14} className="fork-partner__ext" />
                </a>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Live Stay22 stays — hotel fork, panel only. Fetched on open, FE-only. */}
      {type === 'hotel' && variant === 'panel' && (
        <Stay22HotelList visit={visit} currency={tripCurrency} lang={lang} tripId={tripId} />
      )}
    </>
  );

  const styleTag = (
    <style>{`
      .fork-addzone { border: 1px solid var(--line); border-radius: var(--r-md); background: var(--wash); padding: 11px; display: flex; flex-direction: column; gap: 11px; }
      .fork-manual { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer; padding: 10px 12px; border-radius: var(--r-sm); background: var(--surface); border: 1.5px solid var(--fk); box-shadow: 0 0 0 3px var(--fk-soft); font-family: var(--font-ui); transition: transform .16s var(--ease-spring), box-shadow .18s; }
      .fork-manual:hover { transform: translateY(-1px); box-shadow: 0 0 0 3px var(--fk-soft), var(--sh-1); }
      .fork-manual:active { transform: scale(.99); }
      .fork-manual__ic { width: 38px; height: 38px; border-radius: 11px; background: var(--fk); color: #fff; display: grid; place-items: center; flex: none; box-shadow: 0 5px 13px -6px var(--fk); }
      .fork-manual__tx { flex: 1; min-width: 0; }
      .fork-manual__tx b { display: block; font-family: var(--font-display); font-weight: 600; font-size: var(--fs-base); color: var(--ink); }
      .fork-manual__tx span { display: block; font-size: var(--fs-micro); color: var(--muted); line-height: 1.35; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fork-manual__chev { flex: none; color: var(--fk); }
      .fork-or { display: flex; align-items: center; gap: 10px; color: var(--muted); }
      .fork-or::before, .fork-or::after { content: ""; height: 1px; flex: 1; background: var(--line); }
      .fork-or span { font-size: var(--fs-micro); font-weight: 700; }
      .fork-partners { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .fork-partner { display: flex; align-items: center; gap: 10px; padding: 9px 11px; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-sm); text-decoration: none; color: inherit; cursor: pointer; min-width: 0; transition: transform .16s var(--ease-spring), border-color .16s, box-shadow .18s; }
      .fork-partner:hover { transform: translateY(-1px); border-color: var(--line-hover); box-shadow: var(--sh-1); }
      .fork-partner:active { transform: scale(.99); }
      .fork-partner__logo { width: 32px; height: 32px; border-radius: 9px; flex: none; background: var(--wash); object-fit: cover; box-shadow: var(--sh-1); }
      .fork-partner__logo--ph { display: grid; place-items: center; color: var(--muted); box-shadow: none; }
      .fork-partner__mid { flex: 1; min-width: 0; }
      .fork-partner__mid b { display: block; font-family: var(--font-display); font-weight: 600; font-size: var(--fs-meta); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fork-partner__mid span { display: block; font-size: var(--fs-nano); color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .fork-partner__ext { color: var(--muted-2); flex: none; }
      .fork-addzone { container-type: inline-size; }
      @container (max-width: 380px) { .fork-partners { grid-template-columns: 1fr; } }
      @media (max-width: 480px) { .fork-partners { grid-template-columns: 1fr; } }
    `}</style>
  );

  if (variant === 'panel') {
    return (
      <div className="lp lp--wide" style={{ '--ev-soft': meta.colorSoft, '--ev-ink': meta.color }}>
        <div className="lp-h lp-h--ev">
          <button className="lp-back" onClick={() => onOpenChange(false)} title={t('fork.cancel')}><ArrowLeft className="w-4 h-4" /></button>
          <span className="lp-ic" style={{ background: meta.colorSoft, color: meta.color }}><ManualIcon className="w-4 h-4" /></span>
          <div className="lp-ti"><b>{t(meta.titleKey)}</b></div>
        </div>
        <div className="lp-b scrollbar-thin">{body}</div>
        <div className="lp-f"><Btn variant="ghost" onClick={() => onOpenChange(false)}>{t('fork.cancel')}</Btn></div>
        {styleTag}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dlg__head">
          <span style={{ width: 36, height: 36, borderRadius: 9, background: meta.colorSoft, color: meta.color, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <ManualIcon style={{ width: 17, height: 17 }} />
          </span>
          <h2>{t(meta.titleKey)}</h2>
        </div>
        <div className="dlg__body">{body}</div>
        <div className="dlg__foot">
          <Btn variant="ghost" onClick={() => onOpenChange(false)}>{t('fork.cancel')}</Btn>
        </div>
        {styleTag}
      </DialogContent>
    </Dialog>
  );
}
