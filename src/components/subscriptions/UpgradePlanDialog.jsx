import React, { useState, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { Btn, Badge, Skeleton } from '@/design/index';

/**
 * UpgradePlanDialog - the production "Стать PRO" screen, rendered as a
 * self-contained controlled overlay in the new design system (no shadcn).
 * API is unchanged so every existing call site keeps working.
 *
 * Props: open, onOpenChange, tripId?, onUpgradeComplete?, hidePerTrip?
 */
export default function UpgradePlanDialog({ open, onOpenChange, tripId, onUpgradeComplete, hidePerTrip = false }) {
  const { t, lang, fmtMoney } = useI18nFormat();
  const [loading, setLoading] = useState(false);
  const [prices, setPrices] = useState(null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [picked, setPicked] = useState('pro_monthly');
  const [errorMsg, setErrorMsg] = useState('');

  // Load live prices from Stripe whenever the dialog opens (once per open).
  useEffect(() => {
    if (!open || prices) return;
    let cancelled = false;
    setPricesLoading(true);
    supabase.functions.invoke('getStripePrices', { body: {} })
      .then((res) => { if (!cancelled) setPrices(res.data?.prices || {}); })
      .catch((err) => { console.error('Failed to load Stripe prices:', err); })
      .finally(() => { if (!cancelled) setPricesLoading(false); });
    return () => { cancelled = true; };
  }, [open, prices]);

  // Keep the picked plan valid when per-trip is hidden.
  useEffect(() => {
    if (hidePerTrip && picked === 'pro_trip') setPicked('pro_monthly');
  }, [hidePerTrip, picked]);

  const handleUpgrade = async (planType) => {
    setErrorMsg('');
    try {
      setLoading(true);
      let isIframe = false;
      try { isIframe = window.self !== window.top; } catch { isIframe = true; }
      if (isIframe) { setErrorMsg(t('sub.iframe_alert')); setLoading(false); return; }

      const returnPath = window.location.pathname + window.location.search;
      const response = await supabase.functions.invoke('createStripeCheckout', { body: { tripId, planType, returnPath, locale: lang } });
      if (response.error) throw response.error;
      if (response.data?.url) { window.location.href = response.data.url; return; }
      setLoading(false);
    } catch (error) {
      console.error('Upgrade error:', error);
      const code = error?.response?.data?.code;
      if (code === 'SUBSCRIPTION_ALREADY_ACTIVE') {
        try {
          const portal = await supabase.functions.invoke('createBillingPortal', { body: { returnPath: '/settings' } });
          if (portal.data?.url) { window.location.href = portal.data.url; return; }
        } catch (e) { console.error('Billing portal fallback failed:', e); }
        setErrorMsg(t('sub.already_active_msg'));
        setLoading(false);
        return;
      }
      if (code === 'RECENT_CHECKOUT_PENDING') {
        setErrorMsg(t('sub.recent_pending_msg'));
        setLoading(false);
        return;
      }
      const msg = error?.response?.data?.error || error.message;
      setErrorMsg(t('sub.upgrade_error', { message: msg }));
      setLoading(false);
    }
  };

  const renderPrice = (planType) => {
    const p = prices?.[planType];
    if (!p) return { price: '-', period: '' };
    const amount = (p.unit_amount || 0) / 100;
    const price = fmtMoney(amount, p.currency, { minFraction: 0, maxFraction: 2 });
    let period = '';
    if (p.recurring_interval === 'month') period = t('sub.period_month');
    else if (p.recurring_interval === 'year') period = t('sub.period_year');
    return { price, period };
  };

  const allPlans = [
    {
      type: 'pro_trip', icon: 'rocket', title: t('sub.plan_trip_title'),
      description: t('sub.plan_trip_desc'),
      features: [t('sub.plan_trip_feat_1'), t('sub.plan_trip_feat_2'), t('sub.plan_trip_feat_3')],
      badge: null,
    },
    {
      type: 'pro_monthly', icon: 'crown', title: t('sub.plan_monthly_title'),
      description: t('sub.plan_monthly_desc'),
      features: [t('sub.plan_monthly_feat_1'), t('sub.plan_monthly_feat_2'), t('sub.plan_monthly_feat_3'), t('sub.plan_monthly_feat_4')],
      badge: { variant: 'solid', text: t('sub.badge_popular') },
    },
    {
      type: 'pro_yearly', icon: 'crown', title: t('sub.plan_yearly_title'),
      description: t('sub.plan_yearly_desc'),
      features: [t('sub.plan_yearly_feat_1'), t('sub.plan_yearly_feat_2')],
      badge: { variant: 'success', text: '−33%' },
    },
  ];

  const plans = hidePerTrip ? allPlans.filter(p => p.type !== 'pro_trip') : allPlans;

  if (!open) return null;
  const close = () => { if (!loading) onOpenChange?.(false); };

  return (
    <div className="dlg-backdrop" style={{ zIndex: 300 }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dlg dlg--wide">
        <div className="dlg__head">
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="crown" size={17} />
          </div>
          <h2>{t('sub.upgrade_title')}</h2>
          <button className="icon-btn" onClick={close}><Icon name="close" size={16} /></button>
        </div>

        <div className="dlg__body">
          <div className="muted" style={{ fontSize: 13.5, marginBottom: 18, lineHeight: 1.5 }}>
            {t('sub.upgrade_desc')}
          </div>

          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${plans.length}, minmax(0, 1fr))` }}>
            {plans.map((plan) => {
              const { price, period } = renderPrice(plan.type);
              const selected = picked === plan.type;
              return (
                <button
                  key={plan.type}
                  type="button"
                  onClick={() => setPicked(plan.type)}
                  style={{
                    position: 'relative', textAlign: 'left', cursor: 'pointer',
                    borderRadius: 14, padding: '18px 16px',
                    background: selected ? 'var(--brand-soft)' : 'var(--surface)',
                    border: selected ? '2px solid var(--brand)' : '1px solid var(--line)',
                    boxShadow: selected ? '0 6px 20px -8px var(--brand)' : 'none',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}
                >
                  {plan.badge && (
                    <span style={{ position: 'absolute', top: -10, right: 14 }}>
                      <Badge variant={plan.badge.variant}>{plan.badge.text}</Badge>
                    </span>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--brand-soft)', color: 'var(--brand)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <Icon name={plan.icon} size={16} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{plan.title}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minHeight: 34 }}>
                    {pricesLoading && !prices
                      ? <Skeleton w={80} h={26} r={6} />
                      : <>
                          <span className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 28, letterSpacing: '-0.02em' }}>{price}</span>
                          {period && <span className="muted" style={{ fontSize: 12.5 }}>{period}</span>}
                        </>}
                  </div>
                  <div className="muted" style={{ fontSize: 12, minHeight: 32 }}>{plan.description}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>
                    {plan.features.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12.5 }}>
                        <Icon name="check" size={14} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 1 }} />
                        <span>{f}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 'auto', paddingTop: 4 }}>
                    <Badge variant={selected ? 'success' : 'quiet'} icon={selected ? 'check' : undefined}>
                      {selected ? 'Выбран' : 'Выбрать'}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>

          {errorMsg && (
            <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 12.5, lineHeight: 1.5 }}>
              {errorMsg}
            </div>
          )}

          <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, marginTop: 14, justifyContent: 'center' }}>
            <Icon name="shield" size={13} /> Оплата через Stripe · отмена в любой момент
          </div>
        </div>

        <div className="dlg__foot">
          <Btn variant="ghost" onClick={close} disabled={loading}>{t('common.cancel')}</Btn>
          <Btn variant="primary" icon="card" disabled={loading} onClick={() => !loading && handleUpgrade(picked)}>
            {loading ? t('sub.processing') : 'Перейти к оплате'}
          </Btn>
        </div>
      </div>
    </div>
  );
}
