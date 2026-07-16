import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePostHog } from '@posthog/react';
import { invokeFn } from '@/lib/invokeFn';
import { useAuth } from '@/lib/AuthContext';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { Icon } from '@/design/icons';
import { Btn, Skeleton, Severity } from '@/design/index';
import AppHeader from '@/components/AppHeader';
import '../design/app.css';

// Full-screen Pro / Pricing page. Replaces the previous UpgradePlanDialog
// modal - callers navigate here with `/pro?tripId=...&hidePerTrip=1`.
// Layout (TRIP-229): three compare cards (Free / Monthly / Yearly), each with
// its OWN action button — no radio-select, no sticky footer. The one-time
// per-trip pass is a separate banner below the grid, shown only to the owner.
export default function Pro() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { t, fmtMoney } = useI18nFormat();
  const { isDark, toggle: toggleTheme } = useTheme();
  const isPro = isProActive(user);
  const posthog = usePostHog();

  const tripId = searchParams.get('tripId') || null;
  // pro_trip may only be bought by the trip OWNER. If a non-owner lands here with
  // a tripId (e.g. a leaked link from a shared trip), hide the per-trip banner —
  // they can still subscribe, but can't buy Pro for someone else's trip. Every
  // in-app CTA carrying a tripId is already owner-gated, so the owner is the only
  // realistic visitor: show the banner OPTIMISTICALLY while ownership is unknown
  // (null) and only drop it once the check explicitly returns false. Purchase is
  // blocked server-side regardless.
  const [tripOwner, setTripOwner] = useState(null); // null = unknown
  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    invokeFn('checkSubscriptionStatus', { body: { tripId } })
      .then((res) => { if (!cancelled) setTripOwner(!!res.data?.isOwner); })
      .catch(() => { if (!cancelled) setTripOwner(false); });
    return () => { cancelled = true; };
  }, [tripId]);
  const hidePerTrip = searchParams.get('hidePerTrip') === '1' || !tripId || tripOwner === false;

  const [prices, setPrices] = useState(null);
  // Start in the loading state: prices are always fetched on mount, so the very
  // first paint should already show skeletons (not a one-frame flash of "-" cards).
  const [pricesLoading, setPricesLoading] = useState(true);
  // productCode currently being checked out (null = idle). Drives the per-card
  // spinner and disables the other buttons while one purchase is in flight.
  const [loadingPlan, setLoadingPlan] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    setPricesLoading(true);
    invokeFn('getStripePrices', { body: {} })
      .then((res) => { if (!cancelled) setPrices(res.data?.prices || {}); })
      .catch((err) => { console.error('Failed to load Stripe prices:', err); })
      .finally(() => { if (!cancelled) setPricesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleUpgrade = async (productCode) => {
    setErrorMsg('');
    posthog?.capture('pro_upgrade_initiated', { product_code: productCode, trip_id: tripId || undefined });
    try {
      setLoadingPlan(productCode);
      let isIframe = false;
      try { isIframe = window.self !== window.top; } catch { isIframe = true; }
      if (isIframe) { setErrorMsg(t('sub.iframe_alert')); setLoadingPlan(null); return; }

      // landing-path (trip_pro_lifetime → /trip/<id>, sub → /settings) деривируется НА
      // СЕРВЕРЕ из (productCode, tripId) — returnPath клиента не шлём (ломал детерминизм
      // тела под нативную идемпотентность Stripe). Result-модалка глобальная, откроется на любом роуте.
      // invokeFn парсит {error, code} тела один раз и возвращает code/message (не throw).
      const { data, error, code, message } = await invokeFn('createStripeCheckout', { body: { tripId, productCode } });
      if (error || data?.error) {
        if (code === 'SUBSCRIPTION_ALREADY_ACTIVE') {
          const portal = await invokeFn('createBillingPortal', { body: { returnPath: '/settings' } });
          if (portal.data?.url) { window.location.href = portal.data.url; return; }
          setErrorMsg(t('sub.already_active_msg'));
          setLoadingPlan(null);
          return;
        }
        setErrorMsg(t('sub.upgrade_error', { message: message || error?.message }));
        setLoadingPlan(null);
        return;
      }
      if (data?.url) { window.location.href = data.url; return; }
      setLoadingPlan(null);
    } catch (error) {
      console.error('Upgrade error:', error);
      setErrorMsg(t('sub.upgrade_error', { message: error.message }));
      setLoadingPlan(null);
    }
  };

  const renderPrice = (productCode) => {
    const p = prices?.[productCode];
    if (!p) return { price: '-', period: '' };
    const amount = (p.unit_amount || 0) / 100;
    const price = fmtMoney(amount, p.currency, { minFraction: 0, maxFraction: 2 });
    let period = '';
    if (p.recurring_interval === 'month') period = t('sub.period_month');
    else if (p.recurring_interval === 'year') period = t('sub.period_year');
    else period = t('sub.period_once');
    return { price, period };
  };

  // Currency + derived yearly savings, all from the live Stripe prices.
  const currency = prices?.account_pro_yearly?.currency || prices?.account_pro_monthly?.currency || 'usd';
  const monthlyAmt = prices?.account_pro_monthly?.unit_amount || null;
  const yearlyAmt = prices?.account_pro_yearly?.unit_amount || null;
  const yearStrike = monthlyAmt ? fmtMoney((monthlyAmt * 12) / 100, currency, { minFraction: 0, maxFraction: 2 }) : null;
  const yearPerMonth = yearlyAmt ? fmtMoney(yearlyAmt / 12 / 100, currency, { minFraction: 0, maxFraction: 2 }) : null;
  const savePct = (monthlyAmt && yearlyAmt) ? Math.round((1 - yearlyAmt / (monthlyAmt * 12)) * 100) : null;

  // Feature matrix (TRIP-229). Free unlocks only rows 1-2; every Pro plan unlocks all.
  const freeFeatures = [
    { text: t('sub.feat_free_active1'), on: true },
    { text: t('sub.feat_basic'), on: true },
    { text: t('sub.feat_budget'), on: false },
    { text: t('sub.feat_ai_recognition'), on: false },
    { text: t('sub.feat_ai_assistant'), on: false },
    { text: t('sub.feat_group_chat'), on: false },
  ];
  const proFeatures = [
    { text: t('sub.feat_unlimited_active'), on: true },
    { text: t('sub.feat_basic'), on: true },
    { text: t('sub.feat_budget'), on: true },
    { text: t('sub.feat_ai_recognition'), on: true },
    { text: t('sub.feat_ai_assistant'), on: true },
    { text: t('sub.feat_group_chat'), on: true },
  ];

  const monthly = renderPrice('account_pro_monthly');
  const yearly = renderPrice('account_pro_yearly');
  const cards = [
    {
      key: 'free', name: t('sub.plan_free_title'),
      price: fmtMoney(0, currency, { minFraction: 0, maxFraction: 0 }),
      caption: t('sub.free_forever'), features: freeFeatures,
      cta: { label: t('sub.stay_free'), variant: 'secondary', onClick: () => nav(-1) },
    },
    {
      key: 'monthly', name: t('sub.plan_monthly_short'),
      price: monthly.price, period: monthly.period,
      caption: t('sub.caption_monthly'), features: proFeatures,
      cta: { label: t('sub.subscribe_monthly'), variant: 'secondary', code: 'account_pro_monthly' },
    },
    {
      key: 'yearly', name: t('sub.plan_yearly_short'), featured: true,
      price: yearly.price, period: yearly.period, oldPrice: yearStrike, save: savePct,
      caption: yearPerMonth ? t('sub.caption_yearly', { perMonth: yearPerMonth }) : t('sub.period_year'),
      features: proFeatures,
      cta: { label: t('sub.subscribe_yearly'), variant: 'primary', code: 'account_pro_yearly' },
    },
  ];

  const tripPrice = renderPrice('trip_pro_lifetime');
  const busy = !!loadingPlan;

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
          {tripId === null && (
            <div className="pro-hero__note">
              <Icon name="info" size={12} />
              {t('sub.per_trip_note')}
            </div>
          )}
        </div>

        {/* Plans grid */}
        <div className="pro-plans" aria-label={t('sub.choose_plan')}>
          {pricesLoading && !prices
            ? Array.from({ length: 3 }).map((_, i) => (
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
            : cards.map((c) => (
                <div
                  key={c.key}
                  className={`plan-card${c.featured ? ' plan-card--featured' : ''}`}
                >
                  {c.featured && <div className="plan-ribbon" />}
                  {c.featured && c.save != null && (
                    <div className="plan-popular-badge">★ {t('sub.save_pct', { pct: c.save })}</div>
                  )}

                  <div className="plan-card__body">
                    {/* Plan name */}
                    <div className="plan-card__top">
                      <div className="plan-card__name">{c.name}</div>
                    </div>

                    {/* Price */}
                    <div className="plan-price">
                      <span className="plan-price__amount">{c.price}</span>
                      {c.period && <span className="plan-price__period">{c.period}</span>}
                      {c.oldPrice && (
                        <span className="plan-price__period" style={{ textDecoration: 'line-through' }}>{c.oldPrice}</span>
                      )}
                    </div>
                    <div className="t-meta" style={{ color: 'var(--muted)', marginBottom: 11 }}>{c.caption}</div>

                    <div className="plan-divider" />

                    {/* Feature list */}
                    <ul className="plan-features">
                      {c.features.map((f, j) => (
                        <li key={j} className="plan-feature" style={f.on ? undefined : { color: 'var(--muted)' }}>
                          <div
                            className="plan-feature__check"
                            style={f.on ? undefined : { background: 'var(--surface-2)', color: 'var(--muted)' }}
                          >
                            <Icon name={f.on ? 'check' : 'minus'} size={9} />
                          </div>
                          <span>{f.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Action button */}
                  <div className="plan-card__footer">
                    <Btn
                      variant={c.cta.variant}
                      block
                      loading={loadingPlan === c.cta.code}
                      disabled={busy}
                      onClick={() => (c.cta.code ? handleUpgrade(c.cta.code) : c.cta.onClick())}
                    >
                      {c.cta.label}
                    </Btn>
                  </div>
                </div>
              ))
          }
        </div>

        {/* Trust line (replaces the old sticky checkout strip) */}
        {!pricesLoading && (
          <div className="pro-hero__note" style={{ marginTop: 2 }}>
            <Icon name="lock" size={12} />
            {t('sub.secure_checkout')}{t('sub.secure_checkout_meta')}
          </div>
        )}

        {/* One-time per-trip pass — owner only */}
        {!hidePerTrip && !pricesLoading && (
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
              marginTop: 16, padding: '18px 22px', borderRadius: 'var(--r-card)',
              border: '1.5px dashed var(--line)', background: 'var(--surface)',
            }}
          >
            <span style={{
              width: 44, height: 44, flex: 'none', borderRadius: 'var(--r-sm)',
              background: 'var(--primary-soft)', color: 'var(--brand)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="ticket" size={21} />
            </span>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div className="t-title" style={{ color: 'var(--ink)' }}>{t('sub.plan_trip_title')}</div>
              <div className="t-meta" style={{ color: 'var(--muted)', marginTop: 3 }}>{t('sub.plan_trip_subtitle')}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span className="t-title" style={{ color: 'var(--ink)' }}>{tripPrice.price}</span>
              <Btn
                variant="secondary"
                loading={loadingPlan === 'trip_pro_lifetime'}
                disabled={busy}
                onClick={() => handleUpgrade('trip_pro_lifetime')}
              >
                {t('sub.buy_for_trip')}
              </Btn>
            </div>
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="pro-error">
            <Severity level="error">{errorMsg}</Severity>
          </div>
        )}

      </main>

    </div>
  );
}
