import React from 'react';
import { Icon } from '@/design/icons';
import { Badge, Btn, DialogRoot as Dialog, DialogContent, DialogTitle } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

/**
 * PaymentResultDialog — единый диалог исхода оплаты (Ф5, P5 design).
 * Radix Dialog: focus-trap, Esc, ARIA. Иконка 52px (per .modal--confirm spec).
 *
 * Props:
 *   open          – boolean
 *   onOpenChange  – (open: boolean) => void
 *   status        – 'success' | 'fail'
 *   planLabel     – optional plan name (success only, e.g. "Pro Monthly")
 *   priceLabel    – optional price string (success only, e.g. "€9.99/мес")
 *   code          – optional Stripe decline code (fail only)
 *   onRetry       – called when user taps retry (fail only)
 *
 * Replaces: PaymentSuccessDialog + PaymentFailDialog.
 */
export default function PaymentResultDialog({
  open, onOpenChange,
  status,
  variant = 'sub',           // 'sub' | 'trip' — picks copy/CTA for the success state
  planLabel, priceLabel,
  code, onRetry,
}) {
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);
  const isSuccess = status === 'success';
  const isTrip = variant === 'trip';

  // Per-trip purchase has no subscription → never show a plan/price chip.
  const chip = isSuccess && !isTrip && planLabel
    ? (priceLabel ? `${planLabel} · ${priceLabel}` : planLabel)
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dlg--sm" aria-describedby={undefined}>

            {/* ── Body: centred icon + title + desc (P5 .modal--confirm style) ── */}
            <div className="dlg__body" style={{ textAlign: 'center', padding: '32px 24px 8px' }}>

              {/* Status icon — 52px per P5 spec */}
              <div style={{
                width: 52, height: 52, borderRadius: 15,
                background: isSuccess ? 'var(--success-soft)' : 'var(--danger-soft)',
                color: isSuccess ? 'var(--success-ink)' : 'var(--danger-ink)',
                display: 'grid', placeItems: 'center', margin: '0 auto 16px',
              }}>
                <Icon name={isSuccess ? 'check' : 'error'} size={26} />
              </div>

              <DialogTitle asChild>
                <h2 className="t-subheading" style={{ marginBottom: 8 }}>
                  {isSuccess ? t(isTrip ? 'sub.success_title_trip' : 'sub.success_title') : t('sub.fail_title')}
                </h2>
              </DialogTitle>

              <div className="muted t-body" style={{ maxWidth: 340, margin: '0 auto 14px' }}>
                {isSuccess
                  ? t(isTrip ? 'sub.success_desc_trip' : 'sub.success_desc')
                  : code
                    ? <>{t('sub.fail_declined_pre')}<span className="mono t-mono" style={{ color: 'var(--ink-2)' }}>{code}</span>{t('sub.fail_declined_post')}</>
                    : t('sub.fail_cancelled')
                }
              </div>

              {/* Success: plan chip */}
              {chip && (
                <Badge variant="pro" icon="pro" style={{ marginBottom: 6 }}>{chip}</Badge>
              )}

              {/* Fail: help note */}
              {!isSuccess && (
                <div className="t-meta" style={{ background: 'var(--wash)', padding: '9px 12px', borderRadius: 8, color: 'var(--muted)', maxWidth: 340, margin: '0 auto' }}>
                  {t('sub.fail_help')}
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="dlg__foot" style={{ justifyContent: 'center' }}>
              {isSuccess ? (
                <Btn variant="primary" onClick={close} style={{ minWidth: 160 }}>
                  {t(isTrip ? 'sub.success_cta_trip' : 'sub.success_cta')}
                </Btn>
              ) : (
                <>
                  <Btn variant="ghost" onClick={close}>{t('common.close')}</Btn>
                  <Btn variant="primary" icon="refresh" onClick={() => { close(); onRetry?.(); }}>
                    {t('sub.fail_retry')}
                  </Btn>
                </>
              )}
            </div>

      </DialogContent>
    </Dialog>
  );
}
