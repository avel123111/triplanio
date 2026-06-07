import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { parseEdgeError } from '@/lib/edgeError';
import { Icon } from '@/design/icons';
import { Btn, Skeleton } from '@/design/index';
import HeaderActions from '@/components/HeaderActions';
import '../design/app.css';

// Full-screen Pro / Pricing page. Replaces the previous UpgradePlanDialog
// modal - callers navigate here with `/pro?tripId=...&hidePerTrip=1`.
export default function Pro() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { t, lang, fmtMoney } = useI18nFormat();
  const { isDark, toggle: toggleTheme } = useTheme();
  const isPro = isProActive(user);

  const tripId = searchParams.get('tripId') || null;
  // pro_trip may only be bought by the trip OWNER. If a non-owner lands here with
  // a tripId (e.g. a leaked link from a shared trip), hide the per-trip plan -   // they can still buy a subscription, but can't buy Pro for someone else's trip.
  const [tripOwner, setTripOwner] = useState(null); // null = unknown
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    supabase.functions.invoke('checkSubscriptionStatus', { body: { tripId } })
      .then((res) => { if (!cancelled) setTripOwner(!!res.data?.isOwner); })
      .catch(() => { if (!cancelled) setTripOwner(false); });
    return () => { cancelled = true; };
  }, [tripId]);
  const hidePerTrip = searchParams.get('hidePerTrip') === '1' || !tripId || tripOwner !== true;

  const [prices, setPrices] = useState(null);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [picked, setPicked] = useState('pro_monthly');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPricesLoading(true);
    supabase.functions.invoke('getStripePrices', { body: {} })
      .then((res) => { if (!cancelled) setPrices(res.data?.prices || {}); })
      .catch((err) => { console.error('Failed to load Stripe prices:', err); })
      .finally(() => { if (!cancelled) setPricesLoading(false); });
    return () => { cancelled = true; };
  }, []);

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

      const returnPath = '/settings';
      const response = await supabase.functions.invoke('createStripeCheckout', { body: { tripId, planType, returnPath, locale: lang } });
      if (response.error) throw response.error;
      if (response.data?.url) { window.location.href = response.data.url; return; }
      setLoading(false);
    } catch (error) {
      console.error('Upgrade error:', error);
      // supabase-js: the {error, code} body is on error.context, not .response.data.
      const { code, message } = await parseEdgeError(error);
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
      setErrorMsg(t('sub.upgrade_error', { message: message || error.message }));
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
    else period = t('sub.period_once');
    return { price, period };
  };

  const allPlans = [
    {
      type: 'pro_trip', title: t('sub.plan_trip_title'),
      caption: t('sub.plan_trip_desc'),
      features: [t('sub.plan_trip_feat_1'), t('sub.plan_trip_feat_2'), t('sub.plan_trip_feat_3')],
    },
    {
      type: 'pro_monthly', title: t('sub.plan_monthly_title'),
      caption: t('sub.plan_monthly_desc'), popular: true,
      features: [t('sub.plan_monthly_feat_1'), t('sub.plan_monthly_feat_2'), t('sub.plan_monthly_feat_3'), t('sub.plan_monthly_feat_4')],
    },
    {
      type: 'pro_yearly', title: t('sub.plan_yearly_title'),
      caption: t('sub.plan_yearly_desc'), save: '−33%',
      features: [t('sub.plan_yearly_feat_1'), t('sub.plan_yearly_feat_2')],
    },
  ];

  const plans = hidePerTrip ? allPlans.filter(p => p.type !== 'pro_trip') : allPlans;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--bg, var(--wash))' }}>
      <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 50 }}>
        <button className="app-header__crumb-back" onClick={() => nav(-1)} title={t('common.back')}>
          <Icon name="back" size={14} />
        </button>
        <div className="app-header__brand" onClick={() => nav('/trips')} style={{ cursor: 'pointer' }}>
          <img src="/triplanio-logo.svg" alt="Triplanio" style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0 }} />
          <span className="app-header__brand-name">Triplanio</span>
        </div>
        <div className="app-header__crumb">
          <span className="app-header__crumb-sep">/</span>
          <span style={{ fontSize: 'var(--fs-base)', fontWeight: 500, color: 'var(--ink-2)' }}>Pro</span>
        </div>
        <HeaderActions user={user} isPro={isPro} isDark={isDark} onToggleTheme={toggleTheme} />
      </header>

      <main style={{ flex: 1, padding: '40px 24px 60px', maxWidth: 1080, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, padding: '8px 14px 8px 8px', background: 'var(--brand-soft)', color: 'var(--brand)', borderRadius: 999, fontSize: 'var(--fs-base)', fontWeight: 600, marginBottom: 18 }}>
            <img src="/triplanio-logo.svg" style={{ width: 18, height: 18 }} alt="" />
            <span>Triplanio Pro</span>
          </div>
          <h1 style={{ fontSize: 'var(--fs-display)', marginBottom: 10, maxWidth: 720, margin: '0 auto 10px', letterSpacing: '-0.02em' }}>
            {t('sub.hero_title')}
          </h1>
          <div className="muted" style={{ fontSize: 'var(--fs-h3)', maxWidth: 560, margin: '0 auto', lineHeight: 1.55 }}>
            {t('sub.hero_sub')}
          </div>
          {hidePerTrip && tripId === null && (
            <div className="muted" style={{ fontSize: 'var(--fs-base)', marginTop: 14 }}>
              <Icon name="info" size={12} style={{ verticalAlign: -1, marginRight: 4 }} />
              {t('sub.per_trip_note')}
            </div>
          )}
        </div>

        <div role="radiogroup" aria-label={t('sub.choose_plan')} style={{ display: 'grid', gridTemplateColumns: `repeat(${plans.length}, minmax(0, 1fr))`, gap: 14, maxWidth: hidePerTrip ? 760 : 'none', margin: '0 auto' }}>
          {pricesLoading && !prices
            ? Array.from({ length: plans.length }).map((_, i) => (
                <div key={i} style={{ padding: 24, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)' }}>
                  <Skeleton w="60%" h={22} />
                  <div style={{ marginTop: 8 }}><Skeleton w="80%" h={12} /></div>
                  <div style={{ marginTop: 18 }}><Skeleton w="50%" h={36} /></div>
                  <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[0, 1, 2, 3].map((j) => <Skeleton key={j} w={`${90 - j * 8}%`} h={11} />)}
                  </div>
                  <div style={{ marginTop: 22 }}><Skeleton w="100%" h={40} r={10} /></div>
                </div>
              ))
            : plans.map((p) => {
                const { price, period } = renderPrice(p.type);
                const selected = picked === p.type;
                return (
                  <div
                    key={p.type}
                    role="radio"
                    aria-checked={selected}
                    aria-label={p.title}
                    tabIndex={0}
                    onClick={() => setPicked(p.type)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(p.type); } }}
                    style={{
                      padding: 24, borderRadius: 16, cursor: 'pointer',
                      background: selected ? 'var(--brand-soft)' : 'var(--surface)',
                      border: '2px solid ' + (selected ? 'var(--brand)' : 'var(--line)'),
                      color: 'var(--ink)', position: 'relative',
                      boxShadow: selected ? '0 0 0 4px var(--brand-soft)' : 'none',
                      transition: 'all .15s ease',
                    }}
                  >
                    {p.popular && (
                      <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: 'var(--brand)', color: 'white', padding: '4px 12px', borderRadius: 999, fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.04em', boxShadow: '0 4px 14px rgba(33,103,226,.3)' }}>
                        {t('sub.most_popular')}
                      </div>
                    )}
                    {p.save && (
                      <div style={{ position: 'absolute', top: 16, right: 16, background: 'var(--success)', color: 'white', padding: '3px 10px', borderRadius: 999, fontSize: 'var(--fs-micro)', fontWeight: 700 }}>{p.save}</div>
                    )}
                    {selected && (
                      <div style={{ position: 'absolute', top: 16, left: 16, width: 22, height: 22, borderRadius: '50%', background: 'var(--brand)', color: 'white', display: 'grid', placeItems: 'center', boxShadow: '0 2px 8px rgba(33,103,226,.4)' }}>
                        <Icon name="check" size={13} />
                      </div>
                    )}
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-h2)', fontWeight: 600, letterSpacing: '-0.015em', marginBottom: 6, marginTop: selected ? 22 : 0 }}>{p.title}</div>
                    <div style={{ fontSize: 'var(--fs-base)', opacity: 0.7, marginBottom: 18 }}>{p.caption}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                      <span className="num" style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--fs-display)', fontWeight: 600, letterSpacing: '-0.03em' }}>{price}</span>
                      <span style={{ fontSize: 'var(--fs-base)', opacity: 0.7 }}>{period}</span>
                    </div>
                    <hr style={{ border: 'none', borderTop: '1px solid var(--line-2)', margin: '18px 0' }} />
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {p.features.map((f, i) => (
                        <li key={i} style={{ display: 'flex', gap: 8, fontSize: 'var(--fs-base)', lineHeight: 1.4 }}>
                          <Icon name="check" size={14} style={{ flexShrink: 0, marginTop: 2, color: 'var(--success)' }} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <button style={{
                      marginTop: 22, width: '100%', padding: '11px 14px',
                      background: selected ? 'var(--brand)' : 'var(--surface)',
                      color: selected ? 'white' : 'var(--ink)',
                      border: '1px solid ' + (selected ? 'var(--brand)' : 'var(--line)'),
                      borderRadius: 10, fontWeight: 600, fontSize: 'var(--fs-strong)', cursor: 'pointer',
                    }}>{selected ? t('sub.selected') : t('sub.select')}</button>
                  </div>
                );
              })}
        </div>

        {errorMsg && (
          <div style={{ maxWidth: 760, margin: '20px auto 0', padding: '12px 14px', borderRadius: 10, background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 'var(--fs-base)', lineHeight: 1.5 }}>
            {errorMsg}
          </div>
        )}

        <div style={{ marginTop: 30, padding: 18, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Icon name="lock" size={20} style={{ color: 'var(--muted)' }} />
          <div style={{ flex: 1, minWidth: 220, fontSize: 'var(--fs-base)' }}>
            <b>{t('sub.secure_checkout')}</b>{t('sub.secure_checkout_meta')}
          </div>
          <Btn variant="primary" size="lg" iconRight="arrow" disabled={loading} onClick={() => !loading && handleUpgrade(picked)}>
            {loading ? t('sub.processing') : t('sub.go_to_payment')}
          </Btn>
        </div>
      </main>
    </div>
  );
}
