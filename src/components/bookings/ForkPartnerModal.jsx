import React, { useMemo } from 'react';
import { ExternalLink, Bed, Plane, Car, Wifi, ShieldCheck, Info, ArrowLeft } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  hotelPlatforms,
  transferPlatforms,
  carRentalPlatforms,
  esimPlatforms,
  insurancePlatforms,
} from '@/components/bookings/buildBookingPlatforms';
import { usePartnerLogger } from '@/lib/partnerTracking';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

// Visual + copy metadata per fork type. Colors map to existing event palette
// CSS vars (--ev-*) so the modal stays aligned with timeline event colors.
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
    color: 'var(--ev-car)',
    colorSoft: 'var(--ev-car-soft)',
  },
  esim: {
    titleKey: 'service.esim_choice_title',
    manualKey: 'service.esim_choice_manual',
    manualSubKey: 'fork.manual_sub_esim',
    Icon: Wifi,
    color: 'var(--success)',
    colorSoft: 'rgba(31,138,91,.10)',
  },
  insurance: {
    titleKey: 'service.insurance_choice_title',
    manualKey: 'service.insurance_choice_manual',
    manualSubKey: 'fork.manual_sub_insurance',
    Icon: ShieldCheck,
    color: 'var(--ai)',
    colorSoft: 'var(--ai-soft)',
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
  const { t } = useI18nFormat();
  const logClick = usePartnerLogger(tripId);
  const meta = TYPE_META[type] || TYPE_META.hotel;

  const platforms = useMemo(() => {
    if (type === 'hotel') return hotelPlatforms(visit, t);
    if (type === 'transfer') return transferPlatforms(fromVisit, toVisit, t);
    if (type === 'car_rental') return carRentalPlatforms(trip, t);
    if (type === 'esim') return esimPlatforms(visits, t);
    if (type === 'insurance') return insurancePlatforms(t);
    return [];
  }, [type, visit, fromVisit, toVisit, visits, trip, t]);

  const count = platforms.length;
  const isSingle = count === 1;

  const handleManual = () => {
    onOpenChange(false);
    onManual?.();
  };

  const handlePartnerClick = (p) => {
    logClick({ partner: p.key, type: CLICK_TYPE[type] || type, link: p.url });
    // Browser still follows the anchor's href to open the new tab.
  };

  const eyebrow = isSingle
    ? t('fork.eyebrow_one')
    : t('fork.eyebrow_many', {
        count,
        // Russian needs 2-4 → "варианта", 5+ → "вариантов". For other locales
        // both keys return the same plural word (e.g. "options").
        variants: count < 5 ? t('fork.variants_few') : t('fork.variants_many'),
      });

  const ManualIcon = meta.Icon;

  const body = (
    <>
        <div className="fork-grid">
          {/* LEFT - manual */}
          <button
            type="button"
            onClick={handleManual}
            style={{
              padding: 18,
              textAlign: 'left',
              background: 'var(--surface)',
              border: `1.5px solid ${meta.color}`,
              borderRadius: 12,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: `0 0 0 3px ${meta.colorSoft}`,
              minHeight: 0,
            }}
          >
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 11,
                background: meta.color,
                color: 'white',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <ManualIcon size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-strong)', marginBottom: 4 }}>
                {t(meta.manualKey)}
              </div>
              <div
                style={{
                  fontSize: 'var(--fs-meta)',
                  lineHeight: 1.45,
                  color: 'var(--muted)',
                }}
              >
                {t(meta.manualSubKey)}
              </div>
            </div>
            <div
              style={{
                marginTop: 'auto',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                color: meta.color,
                fontSize: 'var(--fs-meta)',
                fontWeight: 600,
              }}
            >
              {t('fork.open_form')}
            </div>
          </button>

          {/* RIGHT - partners */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              {eyebrow}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {platforms.map((p) => (
                <a
                  key={p.key}
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => handlePartnerClick(p)}
                  className="fork-partner-card"
                  style={{
                    display: 'flex',
                    alignItems: isSingle ? 'flex-start' : 'center',
                    gap: 14,
                    padding: isSingle ? '16px 18px' : '12px 14px',
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 12,
                    textDecoration: 'none',
                    color: 'inherit',
                    transition: 'all .15s ease',
                  }}
                >
                  {p.logo ? (
                    <img
                      src={p.logo}
                      alt=""
                      style={{
                        width: isSingle ? 56 : 38,
                        height: isSingle ? 56 : 38,
                        borderRadius: isSingle ? 12 : 9,
                        flexShrink: 0,
                        background: 'var(--wash)',
                      }}
                    />
                  ) : (
                    <ExternalLink size={isSingle ? 22 : 16} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: isSingle ? 16 : 13.5,
                      }}
                    >
                      {p.label}
                    </div>
                    {p.hint && (
                      <div
                        style={{
                          fontSize: isSingle ? 13 : 11.5,
                          color: 'var(--muted)',
                          lineHeight: 1.4,
                        }}
                      >
                        {p.hint}
                      </div>
                    )}
                  </div>
                  <ExternalLink
                    size={14}
                    style={{
                      color: 'var(--muted-2)',
                      flexShrink: 0,
                      marginTop: isSingle ? 4 : 0,
                    }}
                  />
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Info note */}
        <div
          style={{
            marginTop: 4,
            padding: '10px 14px',
            background: 'var(--wash)',
            border: '1px solid var(--line-2, var(--line))',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <Info
            size={14}
            style={{ color: 'var(--muted)', marginTop: 2, flexShrink: 0 }}
          />
          <div
            style={{ fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: 1.5 }}
          >
            {t('fork.info')}
          </div>
        </div>

    </>
  );

  const styleTag = (
    <style>{`
      .fork-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 14px; }
      @media (max-width: 480px) { .fork-grid { grid-template-columns: 1fr; } }
      .fork-partner-card:hover { border-color: var(--line-hover) !important; transform: translateY(-1px); box-shadow: var(--shadow-soft); }
    `}</style>
  );

  if (variant === 'panel') {
    return (
      <div className="te-panel">
        <div className="te-panel__top">
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: meta.color }} />
          <button className="te-back" onClick={() => onOpenChange(false)} title={t('fork.cancel')}><ArrowLeft className="w-4 h-4" /></button>
          <span className="te-panel__icon" style={{ background: meta.colorSoft, color: meta.color }}><ManualIcon className="w-4 h-4" /></span>
          <div style={{ flex: 1, minWidth: 0 }}><div className="te-panel__title">{t(meta.titleKey)}</div></div>
        </div>
        <div className="te-panel__body scrollbar-thin">{body}</div>
        <div className="te-panel__foot"><Button variant="outline" onClick={() => onOpenChange(false)}>{t('fork.cancel')}</Button></div>
        {styleTag}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-md grid place-items-center shrink-0 text-white" style={{ background: meta.color }}>
              <ManualIcon className="w-4 h-4" />
            </span>
            <span>{t(meta.titleKey)}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="dlg__body">{body}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('fork.cancel')}</Button>
        </DialogFooter>
        {styleTag}
      </DialogContent>
    </Dialog>
  );
}
