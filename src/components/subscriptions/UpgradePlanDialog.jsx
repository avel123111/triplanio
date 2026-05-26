import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Check, Crown, Zap, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import ConfirmDialog from '@/components/common/ConfirmDialog';

export default function UpgradePlanDialog({ open, onOpenChange, tripId, onUpgradeComplete, hidePerTrip = false }) {
  const { t, lang, fmtMoney } = useI18nFormat();
  const [loading, setLoading] = useState(false);
  const [prices, setPrices] = useState(null); // { pro_trip: {...}, pro_monthly: {...}, pro_yearly: {...} }
  const [pricesLoading, setPricesLoading] = useState(false);
  const [alertDialog, setAlertDialog] = useState({ open: false, title: '', description: '' });
  const showAlert = (title, description) => setAlertDialog({ open: true, title, description });

  // Load live prices from Stripe whenever the dialog opens (once per open).
  useEffect(() => {
    if (!open || prices) return;
    let cancelled = false;
    setPricesLoading(true);
    base44.functions.invoke('getStripePrices', {})
      .then((res) => { if (!cancelled) setPrices(res.data?.prices || {}); })
      .catch((err) => { console.error('Failed to load Stripe prices:', err); })
      .finally(() => { if (!cancelled) setPricesLoading(false); });
    return () => { cancelled = true; };
  }, [open, prices]);

  const handleUpgrade = async (planType) => {
    try {
      setLoading(true);
      // Iframe detection — wrap in try/catch in case cross-origin access throws.
      let isIframe = false;
      try { isIframe = window.self !== window.top; } catch { isIframe = true; }
      if (isIframe) {
        showAlert(t('common.notice'), t('sub.iframe_alert'));
        setLoading(false);
        return;
      }

      const returnPath = window.location.pathname + window.location.search;
      const response = await base44.functions.invoke('createStripeCheckout', { tripId, planType, returnPath, locale: lang });
      if (response.data.url) {
        window.location.href = response.data.url;
      }
    } catch (error) {
      console.error('Upgrade error:', error);
      // If user already has an active recurring subscription, redirect them
      // straight to the billing portal to manage / change plan instead of
      // forcing a confusing error message.
      const code = error?.response?.data?.code;
      if (code === 'SUBSCRIPTION_ALREADY_ACTIVE') {
        try {
          const portal = await base44.functions.invoke('createBillingPortal', { returnPath: '/settings' });
          if (portal.data?.url) {
            window.location.href = portal.data.url;
            return;
          }
        } catch (e) { console.error('Billing portal fallback failed:', e); }
        showAlert(t('common.notice'), t('sub.already_active_msg'));
        setLoading(false);
        return;
      }
      if (code === 'RECENT_CHECKOUT_PENDING') {
        showAlert(t('common.notice'), t('sub.recent_pending_msg'));
        onOpenChange(false);
        setLoading(false);
        return;
      }
      const msg = error?.response?.data?.error || error.message;
      showAlert(t('common.notice'), t('sub.upgrade_error', { message: msg }));
      setLoading(false);
    }
  };

  // Resolve price/period from Stripe data. Returns { price, period } strings
  // ready to render. While loading or if a price is missing we render an em-dash
  // so the layout stays stable.
  const renderPrice = (planType) => {
    const p = prices?.[planType];
    if (!p) return { price: '—', period: '' };
    const amount = (p.unit_amount || 0) / 100;
    const price = fmtMoney(amount, p.currency, { minFraction: 0, maxFraction: 2 });
    let period = '';
    if (p.recurring_interval === 'month') period = t('sub.period_month');
    else if (p.recurring_interval === 'year') period = t('sub.period_year');
    return { price, period };
  };

  const tripPrice = renderPrice('pro_trip');
  const monthlyPrice = renderPrice('pro_monthly');
  const yearlyPrice = renderPrice('pro_yearly');

  const allPlans = [
    {
      type: 'pro_trip',
      icon: <Zap className="w-5 h-5" />,
      title: t('sub.plan_trip_title'),
      price: tripPrice.price,
      period: tripPrice.period,
      description: t('sub.plan_trip_desc'),
      features: [
        t('sub.plan_trip_feat_1'),
        t('sub.plan_trip_feat_2'),
        t('sub.plan_trip_feat_3'),
      ],
      badge: null,
      highlight: false
    },
    {
      type: 'pro_monthly',
      icon: <Crown className="w-5 h-5" />,
      title: t('sub.plan_monthly_title'),
      price: monthlyPrice.price,
      period: monthlyPrice.period,
      description: t('sub.plan_monthly_desc'),
      features: [
        t('sub.plan_monthly_feat_1'),
        t('sub.plan_monthly_feat_2'),
        t('sub.plan_monthly_feat_3'),
        t('sub.plan_monthly_feat_4'),
      ],
      badge: t('sub.badge_popular'),
      highlight: true
    },
    {
      type: 'pro_yearly',
      icon: <Crown className="w-5 h-5" />,
      title: t('sub.plan_yearly_title'),
      price: yearlyPrice.price,
      period: yearlyPrice.period,
      description: t('sub.plan_yearly_desc'),
      features: [
        t('sub.plan_yearly_feat_1'),
        t('sub.plan_yearly_feat_2'),
      ],
      badge: '-33%',
      highlight: false
    }
  ];

  const plans = hidePerTrip ? allPlans.filter(p => p.type !== 'pro_trip') : allPlans;
  const gridCols = plans.length === 2 ? 'md:grid-cols-2 max-w-2xl mx-auto' : 'md:grid-cols-3';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-3xl font-bold flex items-center justify-center gap-2 text-center">
            <span>{t('sub.upgrade_title')}</span>
            <span>👑</span>
          </DialogTitle>
          <DialogDescription className="text-base mt-2 text-center">
            {t('sub.upgrade_desc')}
          </DialogDescription>
        </DialogHeader>

        <div className={`grid grid-cols-1 ${gridCols} gap-4 pt-8 pb-6 items-stretch`}>
          {plans.map((plan) => (
            <div
              key={plan.type}
              className={`relative rounded-2xl border-2 transition overflow-visible flex flex-col h-full
                ${plan.highlight
                  ? 'border-primary/50 bg-gradient-to-br from-primary/5 to-accent/5 md:scale-[1.02]'
                  : 'border-border bg-card hover:border-primary/30'}`}
            >
              {plan.badge && (
                <div className={`absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-semibold px-3 py-1 rounded-full z-10 whitespace-nowrap shadow-sm
                  ${plan.badge === '-33%'
                    ? 'bg-green-600 text-white'
                    : 'bg-primary text-primary-foreground'}`}>
                  {plan.badge}
                </div>
              )}

              <div className="p-6 flex flex-col h-full">
                {/* Header: icon + title + price aligned */}
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    {plan.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-base leading-tight">{plan.title}</h3>
                  </div>
                </div>

                {/* Price row */}
                <div className="flex items-baseline gap-1 mb-2 mt-1 min-h-[2.25rem]">
                  {pricesLoading && !prices ? (
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  ) : (
                    <>
                      <span className="text-3xl font-bold">{plan.price}</span>
                      {plan.period && <span className="text-muted-foreground text-sm">{plan.period}</span>}
                    </>
                  )}
                </div>

                {/* Description — fixed min-height so all cards align */}
                <p className="text-xs text-muted-foreground mb-4 min-h-[2.5rem]">{plan.description}</p>

                {/* Features — grows to push button down */}
                <div className="space-y-2.5 border-t pt-4 flex-1">
                  {plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                      <span className="text-sm text-foreground leading-snug">{feature}</span>
                    </div>
                  ))}
                </div>

                {/* Button anchored at bottom — only this triggers the checkout now */}
                <Button
                  className="w-full mt-5"
                  disabled={loading}
                  variant={plan.highlight ? 'default' : 'outline'}
                  onClick={() => !loading && handleUpgrade(plan.type)}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t('sub.processing')}
                    </>
                  ) : (
                    t('sub.choose_plan')
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
      <ConfirmDialog
        open={alertDialog.open}
        onOpenChange={(o) => setAlertDialog((s) => ({ ...s, open: o }))}
        title={alertDialog.title}
        description={alertDialog.description}
        singleButton
      />
    </Dialog>
  );
}