import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import PaymentResultDialog from '@/components/common/PaymentResultDialog';
import { useI18n } from '@/lib/i18n/I18nContext';
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
  const [payModal, setPayModal] = useState(null); // 'success' | 'fail' | null
  const [variant, setVariant] = useState('sub');   // 'sub' | 'trip'
  const [retryTo, setRetryTo] = useState('/pro');
  const [planLabel, setPlanLabel] = useState(null);
  const [priceLabel, setPriceLabel] = useState(null);

  useEffect(() => {
    const status = searchParams.get('stripe_status');
    if (!status) return;
    const kind = searchParams.get('kind') === 'trip' ? 'trip' : 'sub';
    const pt = searchParams.get('pt');
    setVariant(kind);
    setRetryTo(kind === 'trip' && pt ? `/pro?tripId=${pt}` : '/pro');

    if (status === 'success') {
      setPayModal('success');
      qc.invalidateQueries({ queryKey: ['my-pro-status'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['trips'] });
      // Subscription only: fetch plan + price for the success chip. A per-trip
      // purchase has no subscription, so we skip it — no plan label, no polling
      // for an "activating subscription" that will never come.
      if (kind === 'sub') {
        (async () => {
          try {
            const planRes = await supabase.functions.invoke('getUserPlan');
            const type = planRes.data?.subscriptionType;
            setPlanLabel(type === 'pro_monthly' ? t('sub.plan_monthly_title') : type === 'pro_yearly' ? t('sub.plan_yearly_title') : null);
            if (type) {
              const priceRes = await supabase.functions.invoke('getStripePrices', { body: {} });
              const p = priceRes.data?.prices?.[type];
              if (p?.unit_amount != null) {
                const amt = fmtMoneyActive(p.unit_amount / 100, p.currency || 'usd');
                const per = p.recurring_interval === 'month' ? t('sub.period_month') : p.recurring_interval === 'year' ? t('sub.period_year') : '';
                setPriceLabel(amt + per);
              }
            }
          } catch { /* chip is optional */ }
        })();
      }
    } else if (status === 'cancel') {
      setPayModal('fail');
    }
    // Strip the params so a refresh / back doesn't re-trigger the modal.
    const sp = new URLSearchParams(searchParams);
    sp.delete('stripe_status');
    sp.delete('session_id');
    sp.delete('kind');
    sp.delete('pt');
    setSearchParams(sp, { replace: true });
  }, [searchParams, setSearchParams, qc]);

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
