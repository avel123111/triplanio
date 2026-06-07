import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Btn, Dialog, Severity } from '@/design/index';

// Shared trip "Share link" dialog. Supports both controlled (open/onOpenChange)
// and legacy ModalHost usage.
export default function ShareDialog({ trip, open, onOpenChange }) {
  const { t } = useI18n();
  const [shareUrl, setShareUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!trip?.id) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    supabase.functions.invoke('ensureShareToken', { body: { tripId: trip.id } })
      .then(({ data, error: invokeErr }) => {
        if (cancelled) return;
        if (invokeErr) { console.error('ensureShareToken error:', invokeErr); setError(t('trip.link_error')); return; }
        const token = data?.shareToken || data?.token;
        if (token) {
          setShareUrl(`${window.location.origin}/public/trip/${trip.id}?t=${token}`);
        } else {
          setError(t('trip.link_error'));
        }
      })
      .catch((err) => { if (!cancelled) { console.error('ensureShareToken error:', err); setError(t('trip.link_error')); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [trip?.id]);

  function copyLink() {
    if (!shareUrl) return;
    navigator.clipboard?.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <Dialog
      title={t('share.dialog_title')}
      icon="share"
      size="sm"
      open={open}
      onOpenChange={onOpenChange}
      foot={<Btn variant="ghost" onClick={() => onOpenChange?.(false) ?? window.__closeModal?.()}>{t('common.close')}</Btn>}
    >
      <div className="muted" style={{ fontSize: 'var(--fs-base)', marginBottom: 18 }}>{t('trip.share_desc')}</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input className="input" readOnly value={loading ? '' : shareUrl} placeholder={loading ? t('share.generating') : ''} style={{ flex: 1, fontSize: 'var(--fs-meta)' }} onClick={(e) => e.target.select()} />
        {loading ? (
          <Btn variant="primary" disabled>
            <span className="spin-mini" style={{
              display: 'inline-block', width: 14, height: 14,
              border: '2px solid currentColor', borderRightColor: 'transparent',
              borderRadius: '50%', animation: 'spin .7s linear infinite',
              marginRight: 6, verticalAlign: -2,
            }} />
            {t('share.generating')}
          </Btn>
        ) : (
          <Btn variant="primary" icon="check" onClick={copyLink} disabled={!shareUrl}>
            {copied ? t('trip.link_copied') : t('share.copy')}
          </Btn>
        )}
      </div>
      {error && <div style={{ marginTop: 10 }}><Severity level="error">{error}</Severity></div>}
    </Dialog>
  );
}
