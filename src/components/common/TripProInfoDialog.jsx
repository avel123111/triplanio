import React, { useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

/**
 * TripProInfoDialog - shown to a NON-OWNER participant who hits a Pro gate
 * inside a shared trip. Pro for a trip is controlled by the trip owner
 * (owner subscription OR a one-time pro_trip purchase), so a participant must
 * NOT be routed to checkout - they're told to ask the owner instead.
 *
 * Props:
 *   open          - boolean
 *   onOpenChange  - (open: boolean) => void
 *   feature       - optional feature name to mention
 *   ownerName     - optional owner display name
 */
export default function TripProInfoDialog({ open, onOpenChange, feature, ownerName }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  if (!open) return null;
  const close = () => onOpenChange?.(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable - ignore */ }
  };

  return (
    <div className="dlg-backdrop" style={{ zIndex: 320 }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dlg dlg--sm">
        <div className="dlg__head">
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--pro-gradient)', color: 'var(--pro-fg)', display: 'grid', placeItems: 'center', flexShrink: 0, boxShadow: '0 4px 10px -4px var(--pro)' }}>
            <Icon name="crown" size={17} />
          </div>
          <h2>{t('sub.trip_pro_heading')}</h2>
          <button className="icon-btn" onClick={close}><Icon name="close" size={16} /></button>
        </div>
        <div className="dlg__body">
          <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--pro-soft-2)', color: 'var(--pro-ink)', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}>
              <Icon name="crown" size={24} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 'var(--fs-h4)', marginBottom: 8 }}>
              {feature ? t('sub.trip_pro_feature_named', { feature }) : t('sub.trip_pro_generic')}
            </div>
            <div className="muted" style={{ fontSize: 'var(--fs-base)', lineHeight: 1.6, maxWidth: 340, margin: '0 auto' }}>
              {t('sub.trip_pro_desc_pre')}{ownerName ? <b>{ownerName}</b> : t('sub.trip_owner_fallback')}{t('sub.trip_pro_desc_post')}
            </div>
          </div>
        </div>
        <div className="dlg__foot">
          <Btn variant="ghost" icon={copied ? 'check' : 'copy'} onClick={copyLink}>
            {copied ? t('common.copied') : t('trip.copy_link')}
          </Btn>
          <Btn variant="primary" onClick={close}>{t('common.got_it')}</Btn>
        </div>
      </div>
    </div>
  );
}
