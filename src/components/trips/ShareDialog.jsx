import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Btn } from '@/design/index';

// Shared trip "Share link" dialog (mints/loads a public share token). Opened via
// the global ModalHost (window.__openModal). Used by the trip screens and the
// structure editor so the sidebar Share item behaves identically in both.
export default function ShareDialog({ trip }) {
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(4px)' }}
      onClick={() => window.__closeModal?.()}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 18, padding: 28, width: 420, maxWidth: 'calc(100vw - 32px)', boxShadow: 'var(--shadow-pop)' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>{t('share.dialog_title')}</h2>
        <div className="muted" style={{ fontSize: 13.5, marginBottom: 18 }}>{t('trip.share_desc')}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="input" readOnly value={loading ? '' : shareUrl} placeholder={loading ? t('share.generating') : ''} style={{ flex: 1, fontSize: 12.5 }} onClick={(e) => e.target.select()} />
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
        {error && <div style={{ color: 'var(--danger, #dc2626)', fontSize: 12.5, marginTop: 10 }}>{error}</div>}
        <div style={{ marginTop: 18, textAlign: 'right' }}>
          <Btn variant="ghost" onClick={() => window.__closeModal?.()}>{t('common.close')}</Btn>
        </div>
      </div>
    </div>
  );
}
