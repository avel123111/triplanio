// @ts-check
import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { TRIP_SHELL_KEY } from '@/lib/trip-data';
import { track } from '@/lib/analytics';
import { invokeFn } from '@/lib/invokeFn';
import { errorText } from '@/lib/errorText';
import { useAuth } from '@/lib/AuthContext';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';
import { isProActive } from '@/lib/subscription';
import { Icon } from '@/design/icons';
import { Btn, Card, Col, Cover, Grow, Row, Skeleton, Severity, Trunc } from '@/design/index';
import AppHeader from '@/components/AppHeader';

// Full-screen Pro / Pricing page. Replaces the previous UpgradePlanDialog
// modal - callers navigate here with `/pro?tripId=...&hidePerTrip=1`.
// Layout (TRIP-229): three compare cards (Free / Monthly / Yearly), each with
// its OWN action button — no radio-select, no sticky footer.
//
// ★ ПОРЯДОК ЭКРАНА ЗАВИСИТ ОТ ТОГО, ОТКУДА ПРИШЛИ. Разовый Pro для одного
// путешествия стоял ПОД тарифной сеткой (на телефоне — 1498px вниз от верха) и
// назывался «для этого путешествия», нигде не показывая, для какого именно.
// Теперь при заходе из трипа страница открывается ПЛАШКОЙ этого оффера с
// обложкой и названием путешествия, а тарифы идут ниже под вопросом «Часто
// путешествуете?». Вне трипа порядок прежний: герой → тарифы.
//
// Имя и обложку приносит `checkSubscriptionStatus` — та же дверь, что уже
// отвечает «владелец ли ты» и «трип уже Pro»; отдельного запроса под витрину
// нет (см. её комментарий про две колонки в select).
export default function Pro() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { t, fmtMoney } = useI18nFormat();
  const { isDark, toggle: toggleTheme } = useTheme();
  const isPro = isProActive(user);

  const tripId = searchParams.get('tripId') || null;
  // `from` lets callers tag WHY pricing opened — a feature gate passes
  // ?from=paywall so we can tell an intentional pricing visit from a blocked one.
  const from = searchParams.get('from') || null;
  // pro_trip may only be bought by the trip OWNER. If a non-owner lands here with
  // a tripId (e.g. a leaked link from a shared trip), the offer plaque is hidden —
  // they can still subscribe, but can't buy Pro for someone else's trip. Purchase
  // is blocked server-side regardless.
  //
  // Ответ храним ЦЕЛИКОМ, а не одним булевым: у экрана три вопроса про один и
  // тот же трип — «владелец ли я» (право покупать pro_trip), «как называется и
  // как выглядит» (плашка) и «не Pro ли он уже» — и один запрос на все три.
  /** @typedef {{ isPro?: boolean, isOwner?: boolean, reason?: string,
   *              trip?: { title?: string|null, coverImageUrl?: string|null } }} TripProState */
  const [tripState, setTripState] = useState(/** @type {TripProState|null} */ (null)); // null = ещё не знаем
  useEffect(() => {
    if (!tripId) return undefined;
    let cancelled = false;
    invokeFn('checkSubscriptionStatus', { body: { tripId } })
      .then((res) => { if (!cancelled) setTripState(res.data || {}); })
      .catch(() => { if (!cancelled) setTripState({}); });
    return () => { cancelled = true; };
  }, [tripId]);
  // Плашку показываем ОПТИМИСТИЧНО, пока владение неизвестно (null), и снимаем
  // только когда проверка явно вернула false: каждый внутренний CTA с tripId уже
  // гейтится владельцем, так что владелец — единственный реальный посетитель, а
  // покупка режется сервером в любом случае.
  // `isPro` того же ответа закрывает живой дефект: у трипа, который УЖЕ Pro,
  // кнопка покупки оставалась активной и приносила 409 TRIP_ALREADY_PRO в лицо.
  const showTripOffer = !!tripId
    && searchParams.get('hidePerTrip') !== '1'
    && tripState?.isOwner !== false
    && tripState?.isPro !== true;

  // ★ ВИТРИНА НЕ ЖДЁТ ДВЕРЬ. Имя и обложку экран трипа уже держит в кэше
  // (`['trip-shell', tripId]` — тот же ключ, что читает сам трип), а внутрь Pro
  // ведут только его кнопки. Читаем этот кэш НАБЛЮДАТЕЛЕМ (`enabled: false` —
  // никогда не фетчит, владелец запроса — экран трипа; тот же приём, что в
  // `useEntitySource`), поэтому плашка рисуется с названием в ПЕРВОМ кадре, без
  // единого лишнего запроса. Копии данных не заводим: как только приезжает
  // ответ двери, он и становится источником — кэш лишь закрывает ожидание.
  // Наблюдатель без `queryFn` типизируется как `unknown` — форму читаемого куска
  // объявляем здесь (нужны ровно два поля строки трипа, оба в snake_case из БД).
  /** @typedef {{ trip?: { title?: string|null, cover_image_url?: string|null } }} TripShellCache */
  const shellQuery = useQuery({ queryKey: TRIP_SHELL_KEY(tripId), enabled: false });
  const shell = /** @type {TripShellCache|undefined} */ (shellQuery.data);
  const offerTrip = tripState?.trip
    || (shell?.trip ? { title: shell.trip.title, coverImageUrl: shell.trip.cover_image_url } : null);

  // Revenue funnel top: every pricing view + a distinct paywall impression when a
  // feature gate sent the user here (?from=paywall). Fire once per mount.
  useEffect(() => {
    track('pricing_viewed', { trip_id: tripId || undefined, from: from || undefined });
    if (from === 'paywall') {
      track('paywall_viewed', { trip_id: tripId || undefined, feature: searchParams.get('feature') || undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    // `plan` = normalized dimension for dashboards (monthly|yearly|trip);
    // `product_code` stays the exact Stripe id for reconciliation.
    const plan = { account_pro_monthly: 'monthly', account_pro_yearly: 'yearly', trip_pro_lifetime: 'trip' }[productCode] || productCode;
    track('pro_upgrade_initiated', { product_code: productCode, plan, trip_id: tripId || undefined });
    try {
      setLoadingPlan(productCode);
      let isIframe = false;
      try { isIframe = window.self !== window.top; } catch { isIframe = true; }
      if (isIframe) {
        track('checkout_error', { plan, product_code: productCode, reason: 'iframe' });
        setErrorMsg(t('sub.iframe_alert')); setLoadingPlan(null); return;
      }

      // landing-path (trip_pro_lifetime → /trip/<id>, sub → /settings) деривируется НА
      // СЕРВЕРЕ из (productCode, tripId) — returnPath клиента не шлём (ломал детерминизм
      // тела под нативную идемпотентность Stripe). Result-модалка глобальная, откроется на любом роуте.
      // invokeFn парсит {error, code} тела один раз и возвращает code/message (не throw).
      const { data, error, code } = await invokeFn('createStripeCheckout', { body: { tripId, productCode } });
      if (error || data?.error) {
        if (code === 'SUBSCRIPTION_ALREADY_ACTIVE') {
          const portal = await invokeFn('createBillingPortal', { body: { returnPath: '/settings' } });
          if (portal.data?.url) { window.location.href = portal.data.url; return; }
          setErrorMsg(t('sub.already_active_msg'));
          setLoadingPlan(null);
          return;
        }
        track('checkout_error', { plan, product_code: productCode, reason: code || 'create_failed' });
        // Коды createStripeCheckout могут быть вне реестра → generic (ок, лучше
        // сырого). Серверную прозу пользователю не показываем (TRIP-423).
        setErrorMsg(errorText(t, code));
        setLoadingPlan(null);
        return;
      }
      if (data?.url) {
        // Between "pressed buy" (pro_upgrade_initiated) and the failure events
        // there was no "reached Stripe" — so a session that quietly died on the
        // way looked exactly like one that made it to the payment page.
        track('checkout_redirected', { plan, product_code: productCode, trip_id: tripId || undefined });
        window.location.href = data.url; return;
      }
      // Server answered without an error AND without a url — the rarest branch,
      // and until now the only silent one: the person just sees the button stop
      // spinning. Same event as the other failures, own reason.
      track('checkout_error', { plan, product_code: productCode, reason: 'no_url' });
      setLoadingPlan(null);
    } catch (error) {
      console.error('Upgrade error:', error);
      track('checkout_error', { plan, product_code: productCode, reason: 'exception' });
      // Клиентское исключение (сеть/JS) — кода нет → общий фолбэк, не сырой message.
      setErrorMsg(errorText(t, null));
      setLoadingPlan(null);
    }
  };

  const renderPrice = (productCode) => {
    const p = prices?.[productCode];
    if (!p) return '-';
    return fmtMoney((p.unit_amount || 0) / 100, p.currency, { minFraction: 0, maxFraction: 2 });
  };

  // Currency + derived yearly savings, all from the live Stripe prices.
  const currency = prices?.account_pro_yearly?.currency || prices?.account_pro_monthly?.currency || 'usd';
  const monthlyAmt = prices?.account_pro_monthly?.unit_amount || null;
  const yearlyAmt = prices?.account_pro_yearly?.unit_amount || null;
  const yearStrike = monthlyAmt ? fmtMoney((monthlyAmt * 12) / 100, currency, { minFraction: 0, maxFraction: 2 }) : null;
  const yearPerMonth = yearlyAmt ? fmtMoney(yearlyAmt / 12 / 100, currency, { minFraction: 0, maxFraction: 2 }) : null;
  const savePct = (monthlyAmt && yearlyAmt) ? Math.round((1 - yearlyAmt / (monthlyAmt * 12)) * 100) : null;

  // Feature matrix (TRIP-229). Same six rows in the same order for both columns —
  // one array of keys removes any risk of the columns drifting apart. Free unlocks
  // only rows 1-2; every Pro plan unlocks all. Row 1 is trip count: with the Free
  // active-trip cap lifted (TRIP-503) both columns now truthfully show it as ✓, so
  // the Free/Pro contrast comes from rows 3-6.
  const FEATURE_ROWS = ['feat_unlimited_trips', 'feat_basic', 'feat_budget',
                        'feat_ai_recognition', 'feat_ai_assistant', 'feat_group_chat'];
  const freeFeatures = FEATURE_ROWS.map((k, i) => ({ text: t(`sub.${k}`), on: i < 2 }));
  const proFeatures = FEATURE_ROWS.map((k) => ({ text: t(`sub.${k}`), on: true }));

  const monthly = renderPrice('account_pro_monthly');
  const yearly = renderPrice('account_pro_yearly');
  /**
   * Тариф — ДАННЫЕ, а не разметка: карточка рисуется одним куском JSX по этому
   * списку. `variant` берёт закрытый набор кнопки (`BtnVariant`), иначе из
   * литерала выводится `string` и `<Btn variant={…}>` краснеет под `@ts-check`.
   * @type {{ key: string, name: string, price: string, oldPrice?: string|null,
   *          save?: number|null, caption: string, featured?: boolean,
   *          features: { text: string, on: boolean }[],
   *          cta: { label: string, variant: import('@/design/index').BtnVariant,
   *                 star?: boolean, code?: string, onClick?: () => void } }[]}
   */
  const cards = [
    {
      key: 'free', name: t('sub.plan_free_title'),
      price: fmtMoney(0, currency, { minFraction: 0, maxFraction: 0 }),
      caption: t('sub.free_forever'), features: freeFeatures,
      cta: { label: t('sub.stay_free'), variant: 'secondary', onClick: () => nav(-1) },
    },
    {
      key: 'monthly', name: t('sub.plan_monthly_short'),
      price: monthly,
      caption: t('sub.caption_monthly'), features: proFeatures,
      cta: { label: t('sub.subscribe_monthly'), variant: 'primary', code: 'account_pro_monthly' },
    },
    {
      key: 'yearly', name: t('sub.plan_yearly_short'), featured: true,
      price: yearly, oldPrice: yearStrike, save: savePct,
      caption: yearPerMonth ? t('sub.caption_yearly', { perMonth: yearPerMonth }) : '',
      features: proFeatures,
      cta: { label: t('sub.subscribe_yearly'), variant: 'pro', star: true, code: 'account_pro_yearly' },
    },
  ];

  const tripPrice = renderPrice('trip_pro_lifetime');
  const busy = !!loadingPlan;
  // Плашка-скелетон стоит, пока НЕ ЗНАЕМ, о каком путешествии речь: фоллбек-обложка
  // с пустым заголовком рядом со скелетонами тарифов — враньё картинкой. Ответ двери
  // снимает ожидание В ЛЮБОМ случае (в том числе неуспехом), иначе сбой сети оставил
  // бы вечный скелетон и убил единственный вход в покупку pro_trip; без имени плашка
  // просто теряет строку заголовка, подзаголовок договаривает смысл сам.
  const offerPending = (pricesLoading && !prices) || (!offerTrip && tripState === null);

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

      {/* ── Main content zone — natural height, centered (canonical standalone shell) ── */}
      <main className="pro-main">

        {/* Hero. Заголовок КОНТЕКСТНЫЙ: пришёл из трипа — «Открой Pro в этом
            путешествии» над плашкой оффера; зашёл вне трипа — общий оффер Pro.
            В трип-состоянии он на кегль ниже (`.t-title` вместо
            `.pro-hero__title`) и без подзаголовка: под ним сразу стоит плашка,
            которая договаривает остальное, а полный герой выносил бы её за
            первый экран на 1366×768. */}
        <div className="pro-hero">
          <div className="pro-hero-eyebrow">
            <img src="/triplanio-logo.svg" alt="" />
            Triplanio Pro
          </div>
          {showTripOffer ? (
            <h1 className="t-title">{t('sub.hero_title_trip')}</h1>
          ) : (
            <>
              <h1 className="pro-hero__title">{t('sub.hero_title')}</h1>
              <p className="pro-hero__sub">{t('sub.hero_sub')}</p>
              {tripId === null && (
                <div className="pro-hero__note">
                  <Icon name="info" size={12} />
                  {t('sub.per_trip_note')}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Плашка «Pro для этого путешествия» ── Скелетон повторяет её
            геометрию, чтобы при подстановке настоящей ничего не прыгало. */}
        {showTripOffer && (offerPending ? (
          <Card radius="btn" className="pro-offer">
            <Row gap="g7" wrap>
              {/* Обложка тоже ЗАГЛУШКА, а не пустой <Cover>: у примитива нижним
                  слоем всегда лежит фоллбек-картинка из бандла, поэтому пустой
                  <Cover> посреди скелетонов показывал чужое фото как обложку
                  этого путешествия. Размер и радиус — те же 62×46/--r-sm. */}
              <Skeleton w={62} h={46} r={'var(--r-sm)'} />
              <Grow fit>
                <Col gap="g1">
                  <Skeleton w="34%" h={9} />
                  <Skeleton w="44%" h={18} />
                  <Skeleton w="68%" h={11} />
                </Col>
              </Grow>
              <Row gap="g7" justify="j-between" className="pro-offer__buy">
                <Col gap="g1">
                  <Skeleton w={62} h={22} />
                  <Skeleton w={78} h={11} />
                </Col>
                <Skeleton w={140} h={40} r={'var(--r-btn)'} />
              </Row>
            </Row>
          </Card>
        ) : (
          <Card radius="btn" featured className="pro-offer">
            <Row gap="g7" wrap>
              <Cover image={offerTrip?.coverImageUrl} />
              <Grow fit>
                <Col gap="g1">
                  {/* Надзаголовок называет ТОВАР («Pro для этого путешествия»),
                      строка под ним — само путешествие. Без него название трипа
                      висит первой строкой и плашка читается как карточка трипа,
                      а не как оффер. Типографика — канон `.t-micro`, свой класс
                      несёт только Pro-чернила (см. комментарий у правила). */}
                  <div className="pro-offer__kicker t-micro">{t('sub.trip_offer_kicker')}</div>
                  {offerTrip?.title && <Trunc className="t-heading">{offerTrip.title}</Trunc>}
                  <div className="t-meta muted">{t('sub.plan_trip_subtitle')}</div>
                </Col>
              </Grow>
              <Row gap="g7" justify="j-between" className="pro-offer__buy">
                <Col gap="g1">
                  <span className="t-title">{tripPrice}</span>
                  <span className="t-meta muted">{t('sub.trip_offer_terms')}</span>
                </Col>
                <Btn
                  variant="pro"
                  loading={loadingPlan === 'trip_pro_lifetime'}
                  disabled={busy}
                  onClick={() => handleUpgrade('trip_pro_lifetime')}
                >
                  <span aria-hidden="true">★</span>
                  {t('sub.buy_for_trip')}
                </Btn>
              </Row>
            </Row>
          </Card>
        ))}

        {/* Подводка к тарифам — вопросом, и только когда выше стоит оффер трипа:
            без него тарифы и так первые, и подводить к ним не от чего. */}
        {showTripOffer && (
          <Col gap="g1" className="pro-orsub">
            <div className="t-heading">{t('sub.subs_q')}</div>
            <p className="t-meta muted">{t('sub.subs_q_sub')}</p>
          </Col>
        )}

        {/* Plans grid */}
        <div className="pro-plans" aria-label={t('sub.choose_plan')}>
          {pricesLoading && !prices
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card radius="btn" key={i} className="plan-card-skel" data-i={i}>
                  <Col gap="g7">
                    <Skeleton w="55%" h={20} />
                    <Skeleton w="75%" h={11} />
                    <Skeleton w="48%" h={34} />
                    <Col gap="g4">
                      {[0, 1, 2, 3].map((j) => <Skeleton key={j} w={`${88 - j * 7}%`} h={11} />)}
                    </Col>
                    <Skeleton w="100%" h={40} r={'var(--r-btn)'} />
                  </Col>
                </Card>
              ))
            : cards.map((c) => (
                <Card
                  radius="btn"
                  featured={c.featured}
                  key={c.key}
                  className="plan-card"
                >
                  {c.featured && c.save != null && (
                    <div className="plan-popular-badge">{t('sub.save_pct', { pct: c.save })}</div>
                  )}

                  <div className="plan-card__body">
                    {/* Plan name */}
                    <div className="plan-card__top">
                      <div className="plan-card__name" data-plan={c.key}>{c.name}</div>
                    </div>

                    {/* Price */}
                    <div className="plan-price">
                      <span className="plan-price__amount">{c.price}</span>
                      {c.oldPrice && (
                        <s className="plan-price__period">{c.oldPrice}</s>
                      )}
                    </div>
                    <div className="t-meta muted">{c.caption}</div>

                    <div className="plan-divider" />

                    {/* Feature list — ON: filled accent circle + check; OFF: outlined
                        muted circle + minus (design okBox/noBox). Выключенное состояние
                        помечается АТРИБУТОМ `data-off`, а не инлайном: это состояние
                        строки, и его облик — дело таблицы стилей, а не экрана. */}
                    <ul className="plan-features">
                      {c.features.map((f, j) => (
                        <li key={j} className="plan-feature" data-off={f.on ? undefined : ''}>
                          <div className="plan-feature__check" data-off={f.on ? undefined : ''}>
                            <Icon name={f.on ? 'check' : 'minus'} size={12} />
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
                      {c.cta.star && <span aria-hidden="true">★</span>}
                      {c.cta.label}
                    </Btn>
                  </div>
                </Card>
              ))
          }
        </div>

        {/* Trust line — small reassurance at the very bottom, below everything. */}
        {!pricesLoading && (
          <div className="pro-hero__note">
            <Icon name="lock" size={12} />
            {t('sub.secure_checkout')}{t('sub.secure_checkout_meta')}
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
