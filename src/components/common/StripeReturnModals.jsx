import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import PaymentSuccessDialog from '@/components/common/PaymentSuccessDialog';
import PaymentFailDialog from '@/components/common/PaymentFailDialog';
import { useI18n } from '@/lib/i18n/I18nContext';

/**
 * Global Stripe-checkout return handler. Mounted ONCE above all authenticated
 * routes, so the success / fail modal shows no matter which screen Stripe
 * redirected back to (trip, settings, pro, admin, …) - the return path is the
 * caller's current page (see createStripeCheckout success_url/cancel_url with
 * `stripe_status`). Screens must NOT duplicate this.
 */
export default function StripeReturnModals() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [payModal, setPayModal] = useState(null); // 'success' | 'fail' | null
  const [planLabel, setPlanLabel] = useState(null);
  const [priceLabel, setPriceLabel] = useState(null);

  useEffect(() => {
    const status = searchParams.get('stripe_status');
    if (!status) return;
    if (status === 'success') {
      setPayModal('success');
      qc.invalidateQueries({ queryKey: ['my-pro-status'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['trips'] });
      // Best-effort plan + price for the success chip (optional).
      (async () => {
        try {
          const planRes = await supabase.functions.invoke('getUserPlan');
          const type = planRes.data?.subscriptionType;
          setPlanLabel(type === 'pro_monthly' ? t('sub.plan_monthly_title') : type === 'pro_yearly' ? t('sub.plan_yearly_title') : null);
          if (type) {
            const priceRes = await supabase.functions.invoke('getStripePrices', { body: {} });
            const p = priceRes.data?.prices?.[type];
            if (p?.unit_amount != null) {
              const amt = new Intl.NumberFormat('ru-RU', {
                style: 'currency', currency: (p.currency || 'eur').toUpperCase(),
                minimumFractionDigits: 0, maximumFractionDigits: 2,
              }).format(p.unit_amount / 100);
              const per = p.recurring_interval === 'month' ? t('sub.period_month') : p.recurring_interval === 'year' ? t('sub.period_year') : '';
              setPriceLabel(amt + per);
            }
          }
        } catch { /* chip is optional */ }
      })();
    } else if (status === 'cancel') {
      setPayModal('fail');
    }
    // Strip the params so a refresh / back doesn't re-trigger the modal.
    const sp = new URLSearchParams(searchParams);
    sp.delete('stripe_status');
    sp.delete('session_id');
    setSearchParams(sp, { replace: true });
  }, [searchParams, setSearchParams, qc]);

  return (
    <>
      <PaymentSuccessDialog
        open={payModal === 'success'}
        onOpenChange={(o) => { if (!o) setPayModal(null); }}
        planLabel={planLabel}
        priceLabel={priceLabel}
      />
      <PaymentFailDialog
        open={payModal === 'fail'}
        onOpenChange={(o) => { if (!o) setPayModal(null); }}
        onRetry={() => { setPayModal(null); nav('/pro'); }}
      />
    </>
  );
}
