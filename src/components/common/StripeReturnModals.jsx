import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { track } from '@/lib/analytics';
import { invokeFn } from '@/lib/invokeFn';
import PaymentResultDialog from '@/components/common/PaymentResultDialog';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import { fmtMoneyActive } from '@/lib/i18n/format';

/**
 * Global Stripe-checkout return handler. Mounted ONCE above all authenticated
 * routes (App.jsx), so the success / fail modal shows no matter which screen
 * Stripe redirected back to (trip, settings, pro, …). Screens must NOT duplicate.
 *
 * The return URL carries `kind` (trip|sub) and, for a per-trip purchase, `pt`
 * (the trip id), set by createStripeCheckout, so we show the right copy and
 * route retry correctly:
 *   • sub   → subscription success (plan + price chip), retry → /pro
 *   • trip  → "this trip is now Pro" copy, NO subscription chip / plan fetch,
 *             retry → /pro?tripId=<pt>
 */
export default function StripeReturnModals() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { checkUserAuth } = useAuth();
  const handledRef = useRef(null); // run-once guard per checkout return
  const [payModal, setPayModal] = useState(null); // 'success' | 'fail' | null
  const [variant, setVariant] = useState('sub');   // 'sub' | 'trip'
  const [retryTo, setRetryTo] = useState('/pro');
  const [planLabel, setPlanLabel] = useState(null);
  const [priceLabel, setPriceLabel] = useState(null);

  useEffect(() => {
    const status = searchParams.get('stripe_status');
    if (!status) return;
    // Run once per return: a re-render or StrictMode double-mount must not
    // restart the poll. Key on session_id (unique per checkout) or status.
    const runKey = searchParams.get('session_id') || status;
    if (handledRef.current === runKey) return;
    handledRef.current = runKey;

    const kind = searchParams.get('kind') === 'trip' ? 'trip' : 'sub';
    const pt = searchParams.get('pt');
    setVariant(kind);
    setRetryTo(kind === 'trip' && pt ? `/pro?tripId=${pt}` : '/pro');

    // Strip return params from the URL. Deferred until the entitlement has been
    // polled (success) so a screen that reads `stripe_status` to gate its own UI
    // (the Account upgrade button) keeps the signal until the webhook flips Pro.
    const stripParams = () => {
      const sp = new URLSearchParams(searchParams);
      sp.delete('stripe_status');
      sp.delete('session_id');
      sp.delete('kind');
      sp.delete('pt');
      setSearchParams(sp, { replace: true });
    };

    if (status === 'cancel') {
      track('pro_payment_failed', { kind, trip_id: pt || undefined, reason: 'cancelled' });
      setPayModal('fail');
      stripParams();
      return;
    }

    // success — revenue truth now comes from the Stripe webhook (purchase_completed,
    // $lib=edge). The client redirect is lost on closed tabs / ad-blockers, so we
    // no longer emit a client purchase event here to avoid double-counting revenue.
    setPayModal('success');
    qc.invalidateQueries({ queryKey: ['my-pro-status'] });
    qc.invalidateQueries({ queryKey: ['me'] });
    qc.invalidateQueries({ queryKey: ['trips'] });

    let cancelled = false;
    (async () => {
      // Subscription return: fetch the success chip (plan + price, best-effort),
      // then poll getUserPlan until the webhook flips the cache to Pro (capped
      // backoff, bounded budget). A per-trip purchase has its is_pro_trip set by
      // the webhook before redirect, so we don't poll — just refresh the user.
      if (kind === 'sub') {
        try {
          const planRes = await invokeFn('getUserPlan');
          const productCode = planRes.data?.productCode;
          setPlanLabel(productCode === 'account_pro_monthly' ? t('sub.plan_monthly_title') : productCode === 'account_pro_yearly' ? t('sub.plan_yearly_title') : null);
          if (productCode) {
            const priceRes = await invokeFn('getStripePrices', { body: {} });
            const p = priceRes.data?.prices?.[productCode];
            if (p?.unit_amount != null) {
              setPriceLabel(fmtMoneyActive(p.unit_amount / 100, p.currency || 'usd'));
            }
          }
        } catch { /* chip is optional */ }

        const deadline = Date.now() + 20000;
        let delay = 1000;
        while (!cancelled && Date.now() < deadline) {
          try {
            const { data } = await invokeFn('getUserPlan'); // eslint-disable-line no-await-in-loop
            if (data?.plan === 'pro') break;
          } catch { /* transient — keep polling within budget */ }
          await new Promise(r => setTimeout(r, delay)); // eslint-disable-line no-await-in-loop
          delay = Math.min(delay + 500, 3000);
        }
      }
      if (cancelled) return;
      // Refresh AuthContext.user so isProActive(user) flips app-wide — the cache
      // columns are read from `user`, not react-query. Then drop the URL params.
      try { await checkUserAuth(); } catch { /* non-fatal — reconcile-on-read covers it */ }
      if (cancelled) return;
      stripParams();
    })();

    return () => { cancelled = true; };
  }, [searchParams, setSearchParams, qc]); // eslint-disable-line

  return (
    <PaymentResultDialog
      open={!!payModal}
      status={payModal}
      variant={variant}
      onOpenChange={(o) => { if (!o) setPayModal(null); }}
      planLabel={planLabel}
      priceLabel={priceLabel}
      onRetry={() => { setPayModal(null); nav(retryTo); }}
    />
  );
}
