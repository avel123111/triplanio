import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { parseEdgeError } from '@/lib/edgeError';
import { Icon } from '@/design/icons';
import { Btn, Skeleton, Severity } from '@/design/index';
import AppHeader from '@/components/AppHeader';
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
  // a tripId (e.g. a leaked link from a shared trip), hide the per-trip plan —
  // they can still buy a subscription, but can't buy Pro for someone else's trip.
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

      // pro_trip returns to the trip itself (not the profile) — the result modal is
      // global and opens on any route; subscriptions return to settings.
      const returnPath = (planType === 'pro_trip' && tripId) ? `/trip/${tripId}` : '/settings';
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
      if (code === 'CHECKOUT_PROCESSING') {
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
      badge: t('sub.badge_once') || 'one-time',
      features: [t('sub.plan_trip_feat_1'), t('sub.plan_trip_feat_2'), t('sub.plan_trip_feat_3')],
    },
    {
      type: 'pro_monthly', title: t('sub.plan_monthly_title'),
      caption: t('sub.plan_monthly_desc'), popular: true,
      badge: t('sub.badge_sub') || 'subscription',
      features: [t('sub.plan_monthly_feat_1'), t('sub.plan_monthly_feat_2'), t('sub.plan_monthly_feat_3'), t('sub.plan_monthly_feat_4')],
    },
    {
      type: 'pro_yearly', title: t('sub.plan_yearly_title'),
      caption: t('sub.plan_yearly_desc'), save: '−33%',
      badge: t('sub.badge_sub') || 'subscription',
      features: [t('sub.plan_yearly_feat_1'), t('sub.plan_yearly_feat_2')],
    },
  ];

  const plans = hidePerTrip ? allPlans.filter(p => p.type !== 'pro_trip') : allPlans;

  return (
    <div className="pro-page app-shell">

      {/* ── App header ── */}
      <AppHeader
        user={user}
        isPro={isPro}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onBack={() => nav(-1)}
        backTitle={t('common.back')}
        title="Pro"
      />

      {/* ── Scrollable main zone ── */}
      <main className="pro-main">

        {/* Hero */}
        <div className="pro-hero">
          <div className="pro-hero-eyebrow">
            <img src="/triplanio-logo.svg" alt="" style={{ width: 22, height: 22, borderRadius: 8, flexShrink: 0 }} />
            Triplanio Pro
          </div>
          <h1 className="pro-hero__title">{t('sub.hero_title')}</h1>
          <p className="pro-hero__sub">{t('sub.hero_sub')}</p>
          {hidePerTrip && tripId === null && (
            <div className="pro-hero__note">
              <Icon name="info" size={12} />
              {t('sub.per_trip_note')}
            </div>
          )}
        </div>

        {/* Plans grid */}
        <div
          className={`pro-plans${plans.length === 2 ? ' pro-plans--2' : ''}`}
          role="radiogroup"
          aria-label={t('sub.choose_plan')}
        >
          {pricesLoading && !prices
            ? Array.from({ length: plans.length }).map((_, i) => (
                <div
                  key={i}
                  className="plan-card-skel"
                  style={{ '--card-delay': `${0.04 + i * 0.09}s` }}
                >
                  <Skeleton w="55%" h={20} />
                  <div style={{ marginTop: 8 }}><Skeleton w="75%" h={11} /></div>
                  <div style={{ marginTop: 20 }}><Skeleton w="48%" h={34} /></div>
                  <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[0, 1, 2, 3].map((j) => <Skeleton key={j} w={`${88 - j * 7}%`} h={11} />)}
                  </div>
                  <div style={{ marginTop: 22 }}><Skeleton w="100%" h={40} r={11} /></div>
                </div>
              ))
            : plans.map((p, i) => {
                const { price, period } = renderPrice(p.type);
                const selected = picked === p.type;
                return (
                  <div
                    key={p.type}
                    className={[
                      'plan-card',
                      p.popular ? 'plan-card--featured' : '',
                      selected ? 'plan-card--selected' : '',
                    ].filter(Boolean).join(' ')}
                    style={{ '--card-delay': `${0.04 + i * 0.09}s` }}
                    role="radio"
                    aria-checked={selected}
                    aria-label={p.title}
                    tabIndex={0}
                    onClick={() => setPicked(p.type)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(p.type); }
                    }}
                  >
                    {/* Accent ribbon for featured plan */}
                    {p.popular && <div className="plan-ribbon" />}
                    {p.popular && (
                      <div className="plan-popular-badge">
                        ★ {t('sub.most_popular')}
                      </div>
                    )}

                    <div className="plan-card__body">
                      {/* Card header: name + type chip */}
                      <div className="plan-card__top">
                        <div className="plan-card__name">{p.title}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 'none' }}>
                          <span className="plan-type-chip">{p.badge}</span>
                          {p.save && <span className="plan-save-tag">{p.save}</span>}
                        </div>
                      </div>

                      {/* Price */}
                      <div className="plan-price">
                        <span className="plan-price__amount">{price}</span>
                        <span className="plan-price__period">{period}</span>
                      </div>

                      <div className="plan-divider" />

                      {/* Feature list */}
                      <ul className="plan-features">
                        {p.features.map((f, j) => (
                          <li key={j} className="plan-feature">
                            <div className="plan-feature__check">
                              <Icon name="check" size={9} />
                            </div>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Select button */}
                    <div className="plan-card__footer">
                      <button
                        className={`plan-select-btn${selected ? ' plan-select-btn--active' : ''}`}
                        tabIndex={-1}
                      >
                        {selected ? (
                          <>
                            <span className="plan-select-btn__check">
                              <Icon name="check" size={10} />
                            </span>
                            {t('sub.selected')}
                          </>
                        ) : (
                          t('sub.select')
                        )}
                      </button>
                    </div>
                  </div>
                );
              })
          }
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="pro-error">
            <Severity level="error">{errorMsg}</Severity>
          </div>
        )}

      </main>

      {/* ── Sticky CTA strip ── */}
      <footer className="pro-cta-strip">
        <div className="pro-cta-strip__icon">
          <Icon name="lock" size={15} />
        </div>
        <div className="pro-cta-strip__text">
          <strong>{t('sub.secure_checkout')}</strong>
          {t('sub.secure_checkout_meta')}
        </div>
        <Btn
          variant="primary"
          size="lg"
          iconRight="arrow"
          disabled={loading}
          onClick={() => !loading && handleUpgrade(picked)}
        >
          {loading ? t('sub.processing') : t('sub.go_to_payment')}
        </Btn>
      </footer>

    </div>
  );
}
