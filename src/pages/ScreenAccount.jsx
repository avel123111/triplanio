// @ts-check
import React, { useState, useEffect, useRef } from 'react';
import { Row, Col, Grid, Trunc, Grow } from '../design/Layout';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Icon } from '../design/icons';
import {
  Badge, Btn, Card, IconBtn, Seg, Severity, SearchSelect, Tile, useToast,
} from '../design/index';
import { useAuth } from '@/lib/AuthContext';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { useTheme } from '@/lib/ThemeContext';
import { useProStatus } from '@/lib/useProStatus';
import { useUnreadNotificationCount } from '@/lib/useNotifications';
import { displayName } from '@/lib/displayName';
import { supabase } from '@/api/supabaseClient';
import { invokeFn } from '@/lib/invokeFn';
import { errorText } from '@/lib/errorText';
import { track } from '@/lib/analytics';
import { openConsentBanner } from '@/lib/consent';
import AppHeader from '@/components/AppHeader';
import Accordion from '@/components/common/Accordion';
import TelegramUnlinkDialog from '@/components/common/TelegramUnlinkDialog';
import { avatarGradient } from '@/lib/avatarRamp';
import { coverGradientCss } from '@/lib/trip-gradients';
import { isAllowedUpload, ALLOWED_IMAGE_EXTENSIONS, IMAGE_ACCEPT } from '@/lib/fileType';

// Cover background for a linked-trip thumbnail: the photo wins (rendered as an
// <img> over a null background); otherwise the trip's stored gradient (always
// one of the built-in set, default-backed). Mirrors coverBg() on the Trips page.
const coverBg = (a) => (a.cover_image_url ? null : coverGradientCss(a.cover_gradient));

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Mirrors the `avatars` bucket's own file_size_limit — keep the two in step. */
const MAX_AVATAR_MB = 5;

// Searchable, scalable language list (Pavel: not fixed-3 — popover with search).
// Only languages with a real locale bundle are listed; the search/popover UI is
// ready to scale as more bundles land.
const LANGS = [
  { code: 'ru', native: 'Русский', flag: 'RU', sub: 'Russian' },
  { code: 'en', native: 'English', flag: 'EN', sub: 'English' },
  { code: 'es', native: 'Español', flag: 'ES', sub: 'Spanish' },
];

// Plan face for the plaque. The Pro/Free VERDICT comes from `isPro` (the cached
// users row, same source as the badge + gates) — NEVER from getUserPlan, so a
// getUserPlan failure can't silently downgrade a Pro user to "Free" (TRIP-135).
// getUserPlan only refines the Pro face (monthly / yearly / cancelled). When the
// verdict is Pro but the billing details aren't available yet (loading or error),
// we show a 'pro-pending' face — a Pro plaque with a retry, not "Free".
// → 'no-sub' | 'pro-pending' | 'with-sub' | 'annual' | 'cancelled'
function derivePlanState(isPro, plan) {
  if (!isPro) return 'no-sub';
  if (!plan || plan.plan !== 'pro') return 'pro-pending';
  if (plan.cancelled) return 'cancelled';
  if (plan.productCode === 'account_pro_yearly') return 'annual';
  return 'with-sub';
}

function fmtDate(iso, locale) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale || 'ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// floor-exempt: dsshare +23 — две причины, обе — правильный реюз (rule #6), не долг:
// (1) плашка/каналы вынесены в общие <Plaque>/<ChannelCard> — DS-элементы считаются
//     ОДИН раз, а не N по числу состояний/каналов (handoff: своя композиция вне
//     знаменателя, декомпозиция опускает долю);
// (2) привязанные трипы рисуются КАНОННОЙ строкой трипа `.tr` (та же, что список
//     путешествий) — она span-based по построению, поэтому реюз реальной строки
//     вместо самодельных DS-карточек (их Pavel отклонил как «уёбищные») опускает
//     долю. Апрув Pavel на дизайн-направление ТГ-канала.

// ─── Subscription plaque («Плитка», TRIP-337) ─────────────────────────────────
// Одна строка внутри карточки: плитка тарифа (цвет живёт ТОЛЬКО здесь и в точке
// статус-бейджа) → название + статус → дата → сумма справа → ОДНО действие.
// Отмена и смена тарифа живут внутри «Биллинг-портала» Stripe, поэтому плитка
// несёт ровно один CTA (решение Pavel). Собрана из примитивов ДС —
// Card/Row/Col/Grow/Tile/Badge/Btn, без своего namespace и инлайнов.

/** @param {{ tile: any, name: any, badge?: any, sub?: any, price?: any, per?: any, action?: any }} p */
function Plaque({ tile, name, badge, sub, price, per, action }) {
  return (
    <Card>
      <Row gap="g7" wrap>
        {tile}
        {/* id держит content-ширину (`.grow`, min-width auto — НЕ `fit`): на узком
            это переносит цену+кнопку на след. строку, а не схлопывает id до нуля,
            от чего цена наезжала на подпись (замер скриншотом на 358). */}
        <Grow>
          <Row gap="g4" wrap>
            <div className="t-heading">{name}</div>
            {badge}
          </Row>
          {sub && <div className="t-meta muted">{sub}</div>}
        </Grow>
        {price && (
          <Col align="a-end" gap="g1">
            <div className="t-title">{price}</div>
            {per && <div className="t-meta muted">{per}</div>}
          </Col>
        )}
        {action}
      </Row>
    </Card>
  );
}

function SubscriptionModule({ planState, plan, detailsLoading, detailsError, awaitingWebhook, portalLoading, onUpgrade, onManage, onRetryDetails, locale, prices }) {
  const { t, fmtMoney } = useI18nFormat();
  // Tariff amounts come from Stripe in minor units; format in the active locale,
  // currency from Stripe (fallback usd = the products' real currency).
  const money = (cents, cur) =>
    cents == null ? null : fmtMoney(cents / 100, cur || 'usd', { minFraction: 0, maxFraction: 2 });
  const priceOf = (type) => {
    const p = prices?.[type];
    return (p && p.unit_amount != null) ? money(p.unit_amount, p.currency) : null;
  };
  const monthlyPrice = priceOf('account_pro_monthly');
  const yearlyPrice = priceOf('account_pro_yearly');

  // Exact billed amount from the user's Stripe subscription (preferred over catalog).
  const actual = plan?.actualPrice;
  const actualMoney = (actual && actual.amount != null) ? money(actual.amount, actual.currency) : null;

  // Единый tile активного Pro: залитый --pro-gradient (тот же источник, что несут
  // .btn--pro и .badge--pro — одна фирменная заливка Pro во всём приложении).
  const proTile = <Tile size="xl" solid tone="pro" icon="pro" />;
  const dateB = (iso) => <b>{fmtDate(iso, locale)}</b>;
  const portalBtn = (
    <Btn variant="secondary" icon="external" disabled={portalLoading} onClick={onManage}>
      {portalLoading ? t('account.opening') : t('account.billing_portal')}
    </Btn>
  );

  // Free is a VERDICT (not a getUserPlan result), so it renders instantly — no
  // spinner gating on the details fetch.
  if (planState === 'no-sub') {
    return (
      <Plaque
        tile={<Tile size="xl" tone="quiet" icon="lock" />}
        name="Free"
        badge={<Badge variant="quiet" size="tiny">{t('account.free_tariff')}</Badge>}
        sub={t('account.free_desc')}
        price={money(0, 'usd')}
        action={(
          <Btn variant="pro" icon="pro" disabled={awaitingWebhook} onClick={onUpgrade}>
            {t('account.go_to_pro')}
          </Btn>
        )}
      />
    );
  }

  // Verdict is Pro, but billing details aren't available yet (loading or error).
  // NEVER fall back to "Free" — show a Pro plaque; spinner while loading, retry on
  // error.
  if (planState === 'pro-pending') {
    return (
      <Plaque
        tile={proTile}
        name="Pro"
        badge={<Badge variant="success" size="tiny">{t('account.active')}</Badge>}
        sub={detailsError ? t('account.details_unavailable') : null}
        action={detailsError
          ? (
            <Btn variant="soft" icon="refresh" disabled={detailsLoading} onClick={onRetryDetails}>
              {t('account.details_retry')}
            </Btn>
          )
          : <div className="spin spin--ring" />}
      />
    );
  }

  if (planState === 'with-sub') {
    return (
      <Plaque
        tile={proTile}
        name="Pro"
        badge={<Badge variant="success" size="tiny">{t('account.active')}</Badge>}
        sub={plan?.subscriptionEnd ? <>{t('account.next_charge')} {dateB(plan.subscriptionEnd)}</> : null}
        price={actualMoney || monthlyPrice}
        per={t('account.per_month_short')}
        action={portalBtn}
      />
    );
  }

  if (planState === 'annual') {
    return (
      <Plaque
        tile={proTile}
        name="Pro"
        badge={<Badge variant="success" size="tiny">{t('account.active')}</Badge>}
        sub={plan?.subscriptionEnd ? <>{t('account.renews')} {dateB(plan.subscriptionEnd)}</> : null}
        price={actualMoney || yearlyPrice}
        per={t('account.per_year_short')}
        action={portalBtn}
      />
    );
  }

  // cancelled
  return (
    <Plaque
      tile={<Tile size="xl" tone="warning" icon="pro" />}
      name="Pro"
      badge={<Badge variant="warning" size="tiny">{t('account.cancelled_sub')}</Badge>}
      sub={plan?.subscriptionEnd ? t('account.access_until', { date: fmtDate(plan.subscriptionEnd, locale) }) : null}
      price={actualMoney || monthlyPrice}
      per={t('account.per_month_short')}
      action={(
        <Btn variant="primary" icon="refresh" disabled={portalLoading} onClick={onManage}>
          {portalLoading ? t('account.opening') : t('account.resume')}
        </Btn>
      )}
    />
  );
}

// ─── Reminder channel card (one row: tile + title/desc + trailing control) ────
// Единый скин канала (Telegram / WhatsApp / Push): плитка → название со статусом
// → описание → правый элемент (бейдж «Скоро», CTA или chevron). Собран из
// примитивов ДС, без своего namespace.

/** @param {{ icon: string, tone: import('../design/Tile').TileTone, name: any, desc: any, titleBadge?: any, trailing?: any }} p */
function ChannelCard({ icon, tone, name, desc, titleBadge, trailing }) {
  return (
    <Card radius="btn">
      <Row gap="g6" wrap>
        <Tile size="lg" tone={tone} icon={icon} />
        <Grow fit>
          <Row gap="g4" wrap>
            <div className="t-label">{name}</div>
            {titleBadge}
          </Row>
          <div className="t-meta muted">{desc}</div>
        </Grow>
        {trailing}
      </Row>
    </Card>
  );
}

// ─── Reminder channels (Telegram integrations + future channels) ──────────────
// Data: telegramGetMyIntegrations (one row per binding). Connected → collapsible
// list of linked trips; empty → prompt to connect from a trip. The owner unlinks
// via the shared TelegramUnlinkDialog (same as Trip settings).

function ReminderChannels() {
  const { t } = useI18n();
  const nav = useNavigate();
  const [items, setItems] = useState(null); // null = loading
  const [unlinkState, setUnlinkState] = useState(null); // null | { account }

  const load = React.useCallback(async () => {
    const { data, error } = await invokeFn('telegramGetMyIntegrations');
    setItems(error ? [] : (data?.integrations ?? []));
  }, []);
  useEffect(() => { load(); }, [load]);

  const nick = (a) =>
    a.telegram_username ? `@${a.telegram_username}` : (a.telegram_first_name || t('telegram.unknown_user'));

  const doUnlink = async (a) => {
    setItems(list => list.filter(x => x.id !== a.id)); // optimistic
    const { error } = await invokeFn('telegramDisconnect', {
      body: { tripId: a.trip_id, integrationId: a.id },
    });
    if (error) load();
  };
  const unlink = (a) => setUnlinkState({ account: a });

  const connected = Array.isArray(items) && items.length > 0;

  return (
    <Card>
      <Col gap="g6">
        <Col gap="g1">
          <div className="t-subheading">{t('account.channels_title')}</div>
          <div className="t-meta muted">{t('account.channels_desc')}</div>
        </Col>

        <Col gap="g4">
          {items === null ? (
            <div className="t-body muted">{t('common.loading')}</div>
          ) : connected ? (
            /* Канал Telegram — раскрывашка <Accordion> (радиус 10, кликабельная
               шапка с ховером, шеврон вправо→вниз): привязанные трипы ВЛОЖЕНЫ в
               тело канала. Каждый трип = его КАНОННАЯ строка `.tr` (обложка +
               название + ТГ-логин получателя), отвязка — иконка справа по центру. */
            <Accordion
              icon="telegram" tone="info"
              title={'Telegram'/* i18n-ignore: имя бренда, не переводится */}
              subtitle={t('telegram.account_section_subtitle')}
              badge={<Badge variant="success" size="tiny">{t('telegram.connected')}</Badge>}
              defaultOpen
            >
              <Col gap="g2">
                {items.map((a) => (
                  <Row gap="g2" key={a.id}>
                    {/* Трип = его канонная строка `.tr` (обложка + название + ТГ-логин)
                        как <Card radius="btn"> (радиус 10, ховер) — вся строка ведёт
                        в трип. Отвязка — иконка справа по центру строки (sibling, т.к.
                        кнопку в кнопку вкладывать нельзя).
                        `grow--fit` (flex:1 + min-width:0), НЕ `grow`: без min-width:0
                        карточка не ужимается ниже min-content, длинное название её
                        распирает и иконка отвязки уезжает вправо (замерено: 292 vs 317px,
                        икона на разных x). С fit все карточки равной ширины → иконки
                        строго выровнены. */}
                    <Card as="button" radius="btn" interactive className="tr grow--fit" onClick={() => nav(`/trip/${a.trip_id}?lens=settings`)}>
                      <span className="tr__thumb" style={{ background: coverBg(a) || undefined }}>
                        {a.cover_image_url && <img className="tc__img" src={a.cover_image_url} alt="" />}
                        <span className="tc__blob" />
                      </span>
                      <span className="tr__main">
                        <span className="tr__title">{a.trip_title}</span>
                        <span className="tr__sub"><Trunc as="span">{nick(a)}</Trunc></span>
                      </span>
                    </Card>
                    <IconBtn icon="unlink" tone="danger" size="sm" ariaLabel={t('telegram.unlink')} onClick={() => unlink(a)} />
                  </Row>
                ))}
                <Row gap="g4" align="a-start"><Icon name="info" size={13} className="muted" /><span className="t-meta muted">{t('telegram.account_hint')}</span></Row>
              </Col>
            </Accordion>
          ) : (
            <ChannelCard
              icon="telegram" tone="info" name="Telegram"
              desc={t('telegram.account_empty_desc')}
              trailing={<Btn variant="soft" onClick={() => nav('/trips')}>{t('telegram.go_to_trips')}</Btn>}
            />
          )}

          <ChannelCard
            icon="whatsapp" tone="success" name="WhatsApp"
            desc={t('account.channel_whatsapp_desc')}
            trailing={<Badge variant="quiet" size="tiny">{t('trip.addon_coming_soon')}</Badge>}
          />
          <ChannelCard
            icon="bell" tone="ai" name={t('account.channel_push')}
            desc={t('account.channel_push_desc')}
            trailing={<Badge variant="quiet" size="tiny">{t('trip.addon_coming_soon')}</Badge>}
          />
        </Col>

        {unlinkState && (
          <TelegramUnlinkDialog
            open={true}
            onOpenChange={(o) => { if (!o) setUnlinkState(null); }}
            handle={nick(unlinkState.account)}
            onConfirm={() => doUnlink(unlinkState.account)}
          />
        )}
      </Col>
    </Card>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ScreenAccount() {
  const { user, checkUserAuth, logout } = useAuth();
  const { t } = useI18nFormat();
  const { lang, setLang, units, setUnits } = useI18n();
  const { theme, setTheme } = useTheme();
  const nav = useNavigate();

  // In-app notifications — the card needs ONE number, so it asks for one number
  // (shared seam, head-only count) instead of pulling 30 full rows to filter
  // them client-side.
  const unreadCount = useUnreadNotificationCount();

  let searchParams;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    [searchParams] = useSearchParams();
  } catch {
    searchParams = new URLSearchParams();
  }

  const avatarInputRef = useRef(null);

  // ── Plan (unified Pro status, TRIP-135) ──────────────────────────────────────
  // ONE source: verdict (isPro) from the cached users row — same as the Pro badge
  // and gates — plus billing details (plan) + freshness/reconcile, all from the
  // shared hook. The plaque can no longer contradict the badge, and a getUserPlan
  // failure degrades only the details (retry), never the verdict.
  const { isPro, plan, detailsLoading, detailsError, refetchDetails } = useProStatus();
  const [prices, setPrices] = useState(null);

  // ── Profile form ───────────────────────────────────────────────────────────
  const [fullName, setFullName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // ── UI ─────────────────────────────────────────────────────────────────────
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [activeSec, setActiveSec] = useState('profile');
  const openUpgrade = () => nav('/pro?hidePerTrip=1');
  const [errorMsg, setErrorMsg] = useState(null);

  // Delete account flow: null | 'confirm' | 'blocked'
  const [deleteState, setDeleteState] = useState(null);
  const [deleteInput, setDeleteInput] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  const planState = derivePlanState(isPro, plan);

  const localeMap = { ru: 'ru-RU', en: 'en-US', es: 'es-ES' };
  const locale = localeMap[lang] || 'ru-RU';

  // Hero identity (name + avatar gradient/initials) reflects the SAVED profile,
  // not the in-progress edit — the draft lives in the input only and is applied
  // on Save (checkUserAuth then refreshes `user`).
  const avatarName = displayName(user?.email, user?.full_name);
  const avatarInitials = avatarName.split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
  const avatarBgStyle = avatarUrl
    ? { backgroundImage: `url(${avatarUrl})` }
    : { background: avatarGradient(avatarName) };

  // Save stays disabled until something actually changed (mirrors trip Settings).
  // Avatar is deliberately NOT part of this: upload/remove persist immediately
  // on their own (DB write + checkUserAuth), so the Save button never governs the
  // avatar — including it here made the button blink active→inactive for the
  // moment between the optimistic setAvatarUrl and `user` refreshing. Save only
  // governs the display name.
  const profileDirty = fullName !== (user?.full_name || '');

  // ── Seed form from user profile ────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name || '');
    setAvatarUrl(user.avatar_url || '');
  }, [user]); // eslint-disable-line

  // Stripe-return polling + user refresh is owned globally by StripeReturnModals
  // (single handler). It keeps `stripe_status` in the URL until the webhook flips
  // Pro, then refreshes AuthContext.user (→ isPro flips) AND invalidates the
  // ['my-pro-status'] query that useProStatus reads (→ billing details refresh).
  // We only read that URL flag (below) to disable the upgrade button meanwhile,
  // so a double-tap can't trigger a second checkout.

  // ── Scroll-spy: highlight the nav item for the section in view ──────────────
  useEffect(() => {
    const ids = ['profile', 'plan', 'appearance', 'notify', 'help', 'session'];
    const els = ids.map(id => document.getElementById(`acct-${id}`)).filter(Boolean);
    if (!els.length) return;
    const obs = new IntersectionObserver((ents) => {
      ents.forEach(en => { if (en.isIntersecting) setActiveSec(en.target.id.replace('acct-', '')); });
    }, { rootMargin: '-20% 0px -70% 0px' });
    els.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [user, detailsLoading]);

  // ── API ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    invokeFn('getStripePrices', { body: {} })
      .then((res) => { if (!cancelled) setPrices(res.data?.prices || null); })
      .catch((e) => console.error('getStripePrices error:', e));
    return () => { cancelled = true; };
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setErrorMsg(null);
    // Запись профиля идёт единой дверью (шов account/profile), не прямым REST в
    // users. Отказ приезжает машинным `code` в КОРНЕ результата (не в data);
    // пользователю показываем локализованный текст через errorText, НЕ серверную
    // прозу (контракт ошибок TRIP-400).
    try {
      const { error, code } = await invokeFn('account/profile', {
        body: { full_name: fullName, avatar_url: avatarUrl || null },
      });
      if (error || code) {
        setErrorMsg(errorText(t, code));
      } else {
        await checkUserAuth?.();
        successToast(t, 'account_saved');
      }
    } finally {
      // invokeFn по контракту не бросает (отказ приходит значением), но finally
      // держит кнопку от залипания в «Сохранение…» при неожиданном throw из SDK.
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (file) => {
    if (!file || !user) return;
    if (!isAllowedUpload(file, ALLOWED_IMAGE_EXTENSIONS)) {
      setErrorMsg(t('doc.bad_format', { name: file.name }));
      return;
    }
    // Same ceiling the `avatars` bucket enforces: without this the upload came
    // back as a raw storage error with nothing the user could act on.
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setErrorMsg(t('doc.max_size', { mb: MAX_AVATAR_MB }));
      return;
    }
    setUploadingAvatar(true);
    setErrorMsg(null);
    try {
      // TRIP-367 root-cause: «new row violates row-level security policy» при
      // аплоаде = `auth.uid()` NULL, т.е. storage-запрос ушёл без валидного
      // токена (сессия ещё не восстановилась после загрузки страницы или токен
      // протух). Глобальный createAuthRetryFetch лечит только 401, а storage-RLS-
      // отказ приходит НЕ-401 и проходит мимо него. Форсим восстановление сессии
      // ДО загрузки байтов: getSession() дожидается восстановления и обновляет
      // протухший access-token, поэтому следующий storage-запрос уходит с живым
      // токеном. Нет живой сессии вовсе — честный UNAUTHENTICATED, а не сырой
      // storage-отказ «violates RLS».
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErrorMsg(errorText(t, 'UNAUTHENTICATED')); return; }
      // Deterministic key: one object per user, no extension. upsert overwrites
      // it in place, so stale variants can never accumulate and no listing sweep
      // is needed (TRIP-48). The browser renders <img> by the stored Content-Type,
      // not the URL suffix, and avatar_url carries a ?t= cache-buster. That type
      // comes from the multipart part the browser builds out of `file` — passing
      // a `contentType` option here would do nothing (storage-js only applies it
      // to non-Blob bodies), so the MIME allow-list on the bucket is the gate.
      const path = `${user.id}/avatar`;
      // Байты аватара — прямо в Storage (намеренно разрешённое прямое обращение,
      // handoff). Только ссылка `avatar_url` идёт через шов.
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = `${publicUrl}?t=${Date.now()}`;
      const { error, code } = await invokeFn('account/profile', { body: { avatar_url: url } });
      if (error || code) { setErrorMsg(errorText(t, code)); return; }
      setAvatarUrl(url);
      await checkUserAuth?.();
    } catch (e) {
      // Сбой загрузки байтов в Storage (не edge) — кода нет, показываем общий
      // текст, не прозу клиента/сервера.
      console.error('avatar upload error:', e);
      setErrorMsg(errorText(t, null));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user) return;
    setErrorMsg(null);
    const prev = avatarUrl;
    setAvatarUrl(''); // optimistic
    const { error, code } = await invokeFn('account/profile', { body: { avatar_url: null } });
    if (error || code) {
      setAvatarUrl(prev);
      setErrorMsg(errorText(t, code));
      return;
    }
    // Байты — best-effort прямо в Storage (own-folder DELETE policy); провал не
    // откатывает уже снятую ссылку.
    try {
      await supabase.storage.from('avatars').remove([`${user.id}/avatar`]);
    } catch { /* ignore */ }
    await checkUserAuth?.();
  };

  const handleManageSubscription = async () => {
    try { if (window.self !== window.top) {
      setErrorMsg(t('account.err_portal_iframe'));
      return;
    }} catch { return; }
    setPortalLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await invokeFn('createBillingPortal', {
        body: { returnPath: '/settings' },
      });
      if (error) throw error;
      if (data?.url) window.open(data.url, '_blank', 'noopener');
      else setErrorMsg(t('account.err_portal_open'));
    } catch (e) {
      console.error('billing portal error:', e);
      setErrorMsg(t('account.err_billing') + (e.message || String(e)));
    } finally {
      setPortalLoading(false);
    }
  };

  const handleDeleteAccount = () => {
    // Block when the user is Pro and the sub isn't already cancelled. Verdict from
    // the unified source; if details are unknown we still block on the verdict (safe
    // direction). deleteMyAccount enforces this server-side regardless.
    const hasActiveSub = isPro && !plan?.cancelled;
    setDeleteState(hasActiveSub ? 'blocked' : 'confirm');
    setDeleteInput('');
  };

  const performDeleteAccount = async () => {
    setDeletingAccount(true);
    setErrorMsg(null);
    try {
      const { data, error, code } = await invokeFn('deleteMyAccount');
      if (error) {
        // `code` is already parsed by invokeFn (it read error.context once — a
        // Response body can only be read one time, so we must NOT re-read it here).
        if (code === 'active_subscription') { setDeleteState('blocked'); return; }
        setErrorMsg(t(code === 'unauthorized' ? 'account.err_delete_unauthorized' : 'account.err_delete_failed'));
        setDeleteState(null);
        return;
      }
      if (data?.code && data.code !== 'ok') {
        setErrorMsg(t('account.err_delete_failed'));
        setDeleteState(null);
        return;
      }
      // Capture BEFORE logout — logout resets PostHog identity, so firing after
      // would attach the event to an anonymous id.
      track('account_deleted');
      await logout();
    } catch (e) {
      console.error('deleteMyAccount error:', e);
      setErrorMsg(t('account.err_delete_failed'));
      setDeleteState(null);
    } finally {
      setDeletingAccount(false);
    }
  };

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <Row justify="j-center" style={{ paddingTop: 60 }}>
        <div className="spin spin--ring spin--lg" />
      </Row>
    );
  }

  // Checkout just returned and the webhook hasn't flipped Pro yet: StripeReturnModals
  // holds `stripe_status` in the URL while it polls. Disable the upgrade button in
  // this window so a second tap can't start another checkout (no own poller).
  // isPro comes from useProStatus (the unified verdict) above.
  const awaitingWebhook = searchParams?.get('stripe_status') === 'success' && !isPro;
  const isDark = theme === 'dark';

  const planBadge =
    planState === 'with-sub' ? <Badge variant="pro" icon="pro">{t('account.badge_pro_sub')}</Badge>
    : planState === 'annual' ? <Badge variant="pro" icon="pro">{t('account.badge_pro_yearly')}</Badge>
    : planState === 'pro-pending' ? <Badge variant="pro" icon="pro">PRO</Badge>
    : planState === 'cancelled' ? <Badge variant="quiet" icon="warning">{t('account.badge_pro_cancelled')}</Badge>
    : null;

  const NAV = [
    { id: 'profile', label: t('account.identity'), icon: 'user' },
    // Outline 'star', not the filled 'pro' ProStar: this is a nav row like its
    // neighbours, not a Pro marker, so it keeps their outline weight.
    { id: 'plan', label: t('account.subscription'), icon: 'star' },
    { id: 'appearance', label: t('account.preferences'), icon: 'globe' },
    { id: 'notify', label: t('account.email_notifs'), icon: 'bell' },
    { id: 'help', label: t('account.nav_help'), icon: 'shield' },
    { id: 'session', label: t('account.nav_session'), icon: 'trash' },
  ];
  const go = (id) => {
    setActiveSec(id);
    document.getElementById(`acct-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">

      {/* ── APP HEADER ── */}
      <AppHeader
        user={user}
        isPro={isPro}
        isDark={isDark}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onBack={() => nav('/trips')}
        backTitle={t('notif.to_collection')}
        title={t('account.title')}
      />

      {/* Payment / action error banner (full width, above the workspace) */}
      {errorMsg && (
        <div style={{ maxWidth: 1120, margin: '16px auto 0', padding: '0 24px', width: '100%', boxSizing: 'border-box' }}>
          <Severity level="error" title={t('account.error_title')}
            action={<Btn variant="secondary" onClick={() => setErrorMsg(null)}>{t('common.close')}</Btn>}>
            {errorMsg}
          </Severity>
        </div>
      )}

      {/* ── TWO-PANE WORKSPACE ── */}
      <Grid className="acct-shell">
        <h1 className="sr-only">{t('account.title')}</h1>

        {/* LEFT NAV (sticky, scroll-spy) */}
        <nav className="acct-nav" aria-label={t('account.title')}>
          {NAV.map(item => (
            <a key={item.id} className={`row${activeSec === item.id ? ' active' : ''}`} onClick={() => go(item.id)}>
              <Icon name={item.icon} size={17} /> {item.label}
            </a>
          ))}
        </nav>

        {/* CONTENT */}
        <Col className="acct-content">

          {/* ░░ PROFILE ░░ */}
          <section id="acct-profile">
            <Row as="h2" className="acct-sectitle">{t('account.identity')}</Row>
            <Card radius="lg" pad="none" className="acct-hero">
              <div className="acct-hero__band" aria-hidden="true"><span className="blob b1" /><span className="blob b2" /></div>
              {planBadge && <div className="acct-hero__plan">{planBadge}</div>}
              <Row gap="g7" className="acct-hero__row">
                <div
                  className="acct-hero__av"
                  role="button" tabIndex={0}
                  aria-label={t('account.remove_avatar')}
                  style={avatarBgStyle}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {!avatarUrl && avatarInitials}
                  {uploadingAvatar
                    ? <span className="ov" style={{ opacity: 1 }}><div className="spin spin--ring spin--onscrim" /></span>
                    : <span className="ov"><Icon name="cam" size={18} /></span>}
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  style={{ display: 'none' }}
                  onChange={e => handleAvatarUpload(e.target.files?.[0])}
                />
                <div className="acct-hero__id">
                  <Trunc className="acct-hero__name">{displayName(user.email, user.full_name)}</Trunc>
                  <div className="acct-hero__mail">{user.email}</div>
                  <Row wrap gap="g3" className="acct-hero__actions">
                    <Btn variant="secondary" icon="cam" onClick={() => avatarInputRef.current?.click()}>{t('common.upload')}</Btn>
                    {avatarUrl && (
                      <Btn variant="danger" icon="trash" onClick={handleRemoveAvatar}>{t('account.remove_avatar')}</Btn>
                    )}
                  </Row>
                </div>
              </Row>
              <Grid className="acct-hero__edit">
                <div>
                  <label className="acct-flabel" htmlFor="acct-dispname">{t('account.display_name')}</label>
                  <input id="acct-dispname" className="input" value={fullName} onChange={e => setFullName(e.target.value)} />
                </div>
                <div>
                  <label className="acct-flabel" htmlFor="acct-mail">E-mail <Badge variant="quiet">{t('account.readonly')}</Badge></label>
                  <input id="acct-mail" className="input" value={user.email} readOnly />
                </div>
                <Btn variant="primary" icon="check" loading={saving} disabled={!profileDirty} onClick={handleSave}>
                  {saving ? t('auth.saving') : t('common.save')}
                </Btn>
              </Grid>
            </Card>
          </section>

          {/* ░░ SUBSCRIPTION ░░ */}
          <section id="acct-plan">
            <Row as="h2" className="acct-sectitle">{t('account.subscription')}</Row>
            <SubscriptionModule
              planState={planState}
              plan={plan}
              detailsLoading={detailsLoading}
              detailsError={detailsError}
              awaitingWebhook={awaitingWebhook}
              portalLoading={portalLoading}
              locale={locale}
              prices={prices}
              onUpgrade={openUpgrade}
              onManage={handleManageSubscription}
              onRetryDetails={refetchDetails}
            />
          </section>

          {/* ░░ PREFERENCES (variant C — single-card list) ░░ */}
          <section id="acct-appearance">
            <Row as="h2" className="acct-sectitle">{t('account.preferences')}</Row>
            <div className="card">

              {/* Language */}
              <Row gap="g7" className="row--div">
                <span className="tile tile--lg tile--brand"><Icon name="globe" size={16} /></span>
                <Grow fit>
                  <div className="row__t">{t('account.pref_language')}</div>
                  <div className="row__s">{t('account.pref_language_sub')}</div>
                </Grow>
                <div className="acct-prefctl">
                  <SearchSelect
                    value={lang}
                    onChange={setLang}
                    options={LANGS}
                    getKey={(l) => l.code}
                    matches={(l, q) => l.native.toLowerCase().includes(q) || l.sub.toLowerCase().includes(q) || l.code.includes(q)}
                    renderValue={(l) => (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Tile as="span" className="acct-lang__flag">{l.flag}</Tile>{l.native}
                      </span>
                    )}
                    renderOption={(l) => (
                      <>
                        <Tile as="span" className="acct-lang__flag">{l.flag}</Tile>
                        <span>{l.native}</span>
                        <span className="t-meta muted">{l.sub}</span>
                      </>
                    )}
                    searchPlaceholder={t('common.search')}
                    emptyText={t('common.not_found')}
                    title={t('settings.language')}
                    triggerClassName="input"
                    width={240}
                  />
                </div>
              </Row>

              {/* Theme */}
              <Row gap="g7" className="row--div">
                <span className="tile tile--lg tile--ai"><Icon name="sun" size={16} /></span>
                <Grow fit>
                  <div className="row__t">{t('settings.theme')}</div>
                  <div className="row__s">{t('account.pref_theme_sub')}</div>
                </Grow>
                <div className="acct-prefctl">
                  <Seg
                    ariaLabel={t('settings.theme')}
                    value={theme}
                    onChange={setTheme}
                    options={[
                      { value: 'light', label: t('settings.theme_light') },
                      { value: 'dark', label: t('settings.theme_dark') },
                      { value: 'system', label: t('settings.theme_system') },
                    ]}
                  />
                </div>
              </Row>

              {/* Unit system */}
              <Row gap="g7" className="row--div">
                <span className="tile tile--lg tile--brand"><Icon name="route" size={16} /></span>
                <Grow fit>
                  <div className="row__t">{t('account.units')}</div>
                  <div className="row__s">{t('account.units_sub')}</div>
                </Grow>
                <div className="acct-prefctl">
                  <Seg
                    ariaLabel={t('account.units')}
                    value={units}
                    onChange={setUnits}
                    options={[
                      { value: 'metric', label: t('units.km') },
                      { value: 'imperial', label: t('units.mi') },
                    ]}
                  />
                </div>
              </Row>
            </div>
          </section>

          {/* ░░ NOTIFICATIONS + CHANNELS ░░ */}
          <section id="acct-notify">
            <Row as="h2" className="acct-sectitle">{t('account.email_notifs')}</Row>

            {/* In-app notifications — quick link to the inbox with unread count.
                Same row grammar as every other navigational row on this screen
                (Privacy / Terms / cookie settings below): a .card holding
                .row--div, not a bespoke card-shaped button. */}
            <div className="card" style={{ marginBottom: 16 }}>
              <button type="button" className="row--div row row--g7" onClick={() => nav('/inbox')}>
                <span className="tile tile--lg tile--brand"><Icon name="bell" size={18} /></span>
                <Grow>
                  <div className="row__t">{t('account.inbox_title')}</div>
                  <div className="row__s">{t('account.inbox_sub')}</div>
                </Grow>
                {/* The button's accessible name comes from its subtree, so the
                    count is spoken as part of the row. (The old markup carried an
                    aria-label on a bare <span> — a generic role takes no
                    name-from-author, so it was never announced.) */}
                {unreadCount > 0 && (
                  <Badge variant="count">{unreadCount > 99 ? '99+' : unreadCount}</Badge>
                )}
                <Icon name="arrowR" size={16} className="muted-2" />
              </button>
            </div>

            <ReminderChannels />
          </section>

          {/* ░░ HELP & LEGAL ░░ */}
          <section id="acct-help">
            <Row as="h2" className="acct-sectitle">{t('account.nav_help')}</Row>
            <div className="card">
              <Row gap="g7" className="row--div">
                <span className="tile tile--lg tile--brand"><Icon name="chat" size={18} /></span>
                <Grow>
                  <div className="row__t">{t('account.contact_us')}</div>
                  <div className="row__s">
                    <a href="mailto:support@triplanio.com" style={{ color: 'var(--brand)' }}>support@triplanio.com</a> · {t('account.support_reply')}
                  </div>
                </Grow>
                <Btn variant="secondary" icon="send" onClick={() => { window.location.href = 'mailto:support@triplanio.com'; }}>{t('account.write')}</Btn>
              </Row>
              <a className="row--div row row--g7" href="/privacy" target="_blank" rel="noreferrer noopener">
                <span className="tile tile--lg tile--quiet"><Icon name="shield" size={18} /></span>
                <Grow>
                  <div className="row__t">{t('account.privacy_title')}</div>
                  <div className="row__s">{t('account.privacy_desc')}</div>
                </Grow>
                <Icon name="external" size={13} className="muted-2" />
              </a>
              <a className="row--div row row--g7" href="/terms" target="_blank" rel="noreferrer noopener">
                <span className="tile tile--lg tile--quiet"><Icon name="file" size={18} /></span>
                <Grow>
                  <div className="row__t">{t('account.terms_title')}</div>
                  <div className="row__s">{t('account.terms_desc')}</div>
                </Grow>
                <Icon name="external" size={13} className="muted-2" />
              </a>
              {/* Same entry for signed-in people. Reopens the panel rather than acting:
                  "settings" that silently wipe your choice are not settings. */}
              <button
                type="button"
                className="row--div row row--g7"
                onClick={openConsentBanner}
              >
                <span className="tile tile--lg tile--quiet"><Icon name="settings" size={18} /></span>
                <Grow>
                  <div className="row__t">{t('consent.settings')}</div>
                  <div className="row__s">{t('consent.state')}</div>
                </Grow>
              </button>
            </div>
          </section>

          {/* ░░ SESSION & DANGER ░░ */}
          <section id="acct-session">
            <Row as="h2" className="acct-sectitle">{t('account.nav_session')}</Row>

            <div className="card card--danger" style={{ marginBottom: 16 }}>
              {/* Рамку целиком задаёт карточка, поэтому строка своей отбивки не
                  добавляет. Раньше это делало правило по ПОЗИЦИИ в дереве, и оно
                  разваливалось, как только под строкой раскрывалась плашка
                  подтверждения - отбивку приходилось гасить инлайном. */}
              <Row gap="g7" className="row--flush">
                <span className="tile tile--lg tile--danger"><Icon name="trash" size={18} /></span>
                <Grow>
                  <div className="row__t">{t('settings.delete_account')}</div>
                  <div className="row__s">{t('account.delete_desc')}</div>
                </Grow>
                <Btn variant="danger" disabled={deletingAccount} onClick={handleDeleteAccount}>{t('settings.delete_account')}</Btn>
              </Row>

              {deleteState === 'blocked' && (
                <Severity level="warning" title={t('account.cancel_sub_first')}>
                  {t('account.delete_blocked_desc')}
                  <div style={{ marginTop: 8 }}>
                    <Btn variant="secondary" icon="external" loading={portalLoading} onClick={handleManageSubscription}>
                      {portalLoading ? t('account.opening') : t('account.open_billing_portal')}
                    </Btn>
                  </div>
                </Severity>
              )}

              {deleteState === 'confirm' && (
                <Severity level="error" icon="trash" title={t('account.confirm_delete')}>
                  {t('account.confirm_delete_desc_1')} <b>{t('account.delete_word')}</b> {t('account.confirm_delete_desc_2')}
                  <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <input className="input" placeholder={t('account.delete_word')} value={deleteInput} onChange={e => setDeleteInput(e.target.value)} style={{ flex: 1, minWidth: 150 }} />
                    <Btn variant="danger-solid" loading={deletingAccount} disabled={deleteInput !== t('account.delete_word')} onClick={performDeleteAccount}>
                      {deletingAccount ? t('account.deleting') : t('account.delete_forever')}
                    </Btn>
                    <Btn variant="secondary" onClick={() => setDeleteState(null)}>{t('common.cancel')}</Btn>
                  </div>
                </Severity>
              )}
            </div>

            <div className="card">
              <Row gap="g7" className="row--div">
                <span className="tile tile--lg tile--quiet"><Icon name="arrow" size={18} /></span>
                <Grow>
                  <div className="row__t">{t('account.logout_title')}</div>
                  <div className="row__s">{t('account.logout_desc')}</div>
                </Grow>
                <Btn variant="secondary" icon="arrow" onClick={logout}>{t('auth.logout')}</Btn>
              </Row>
            </div>
          </section>

        </Col>
      </Grid>
    </div>
  );
}
