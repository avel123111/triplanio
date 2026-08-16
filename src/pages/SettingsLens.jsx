// @ts-check
/**
 * SettingsLens - trip settings tab inside TripView.
 *
 * Props:
 *   tripId      - string
 *   trip        - trip object
 *   members     - array of trip member rows
 *   isOwner     - boolean (ступень owner лестницы, из TripView)
 *   canEdit     - boolean (ступень editor лестницы, из TripView)
 *   isPro       - boolean
 *   queryClient - react-query QueryClient (for invalidation)
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Row, Col, Grid, Grow } from '../design/Layout';
import { invokeFn } from '@/lib/invokeFn';
import { track } from '@/lib/analytics';
import { classifyError } from '@/lib/errorText';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { TRIP_SHELL_KEY } from '@/lib/trip-data';
import { resolveOwnerName } from '@/lib/resolveAuthor';
import { invalidateActiveTripsLimit } from '@/hooks/useActiveTripsLimit';
import { Icon } from '../design/icons';
import { Badge, Btn, Card, CardHeader, Dialog, EmptyState, Field, Severity, Skeleton, Textarea, Toggle, useToast, CurrencyCombobox } from '../design/index';
import { useProUpsell } from '@/components/common/ProUpsellProvider';
import { useCreateTrip } from '@/components/create/CreateTripProvider';
import TelegramUnlinkDialog from '@/components/common/TelegramUnlinkDialog';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { telegram as tgBrand } from '@/lib/externalBrands';
import TripCoverPicker from '@/components/trips/TripCoverPicker';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { DEFAULT_GRADIENT_ID } from '@/lib/trip-gradients';

// ─── Feature flags ────────────────────────────────────────────────────────────
// `addon` is the key persisted under trip.details.addons (matches TripView lens ids
// for the gateable lenses: budget / chat).

// Pro flags MUST match the backend definition (lib/tripAddons.js PRO_ONLY_ADDONS):
// pro = budget, chat, telegram_assistant. There is no personal-AI addon. docs and
// calendar are core lenses (always visible), not optional addons, so not listed.
const FEATURES = [
  { id: 'budget', addon: 'budget',              icon: 'wallet',    color: 'var(--success)', labelKey: 'settings.feat_budget_title', descKey: 'settings.feat_budget_desc',             pro: true  },
  { id: 'chat',   addon: 'chat',                icon: 'chat',      color: 'var(--ai)',      labelKey: 'chat.group_title',          descKey: 'settings.feat_chat_desc',              pro: true  },
  { id: 'tg',     addon: 'telegram_assistant',  icon: 'telegram',  color: tgBrand.fg,        labelKey: 'settings.feat_tg_title',    descKey: 'settings.feat_tg_desc',                pro: true  },
];

// Тон плитки Telegram. Цвет обязан приходить из ЕДИНСТВЕННОГО реестра брендов
// (src/lib/externalBrands.js, TRIP-321 Ф2) - CSS-токенов у брендов нет намеренно,
// заводить их значило бы завести второй источник правды. Поэтому тон не может быть
// классом, но и повторяться не должен: объект объявлен ОДИН раз и переиспользуется.
// inline-style-exempt: цвет бренда - данные из реестра, не оформление.
const TG_TILE = { background: tgBrand.bg, color: tgBrand.fg };

// ─── Отказы edge-функций ──────────────────────────────────────────────────────
// `updateTripSettings` и `deleteTrip` отвечают на отказ НАСТОЯЩИМ статусом
// (403 / 402 / 404; сбой - 500) и машинным `code` (TRIP-378). Читать надо
// `code` от `invokeFn` (не `data.code`: у не-2xx `data` равен null). Текст
// причины даёт общий `classifyError`/`err.*` — локальной карты клауз здесь
// больше НЕТ (FORBIDDEN на правке и удалении сведён к одному нейтральному
// `err.FORBIDDEN`: «нет прав менять настройки» про удаление всё равно врало).
// Клауза подставляется в обёртку `settings.save_error*` ("Не удалось
// сохранить: {message}"). PRO_REQUIRED — единственный код, что НЕ идёт в тост,
// а открывает Pro-апселл (ветка в `toggleFeature`).
//
// ⚠️ Долг (не этот PR): `telegramSetActive` (~:354), `telegramDisconnect`
// (~:364) и `removeTripMember` (~:708) всё ещё печатают в тост `error?.message`
// (сырую строку SDK). Их источник кода не заполняет — ратчет сырых клиентских
// ошибок (гард 3b) держит это число и не даёт ему расти.

// Default OFF unless explicitly enabled (addons[key] === true). New trips start
// with every optional/pro feature off - they never auto-enable for anyone.
function featuresFromTrip(trip) {
  const addons = trip?.details?.addons || {};
  const state = {};
  for (const f of FEATURES) state[f.id] = f.locked ? false : (addons[f.addon] === true);
  return state;
}

// ─── FeatureCard ──────────────────────────────────────────────────────────────

// Addon widget card (Lumo DS §D1 `.addon-card`). Icon + switch on top, title +
// description below, optional upgrade CTA in the foot. The accent colour is
// passed through the `--ac` custom property.
function FeatureCard({ feat, on, onChange, hasPro, busy }) {
  const { t } = useI18n();
  const proLocked = feat.pro && !hasPro;
  const cls = 'col addon-card'
    + (on ? ' addon-card--on' : '')
    + (feat.locked ? ' addon-card--locked' : '');
  return (
    <Card radius="md" className={cls} style={{ '--ac': feat.color || 'var(--brand)' }}>
      <Row align="a-start" justify="j-between" className="addon-card__top">
        <div className="addon-card__ic"><Icon name={feat.icon} size={20} /></div>
        {feat.locked
          ? <Badge variant="quiet">{t('trip.addon_coming_soon')}</Badge>
          : proLocked
            ? <Badge variant="pro" icon="pro">PRO</Badge>
            : (
              <Row wrap className="addon-card__status">
                {feat.pro && hasPro && <Badge variant="success" icon="check">{t('settings.feat_available')}</Badge>}
                <Toggle on={on} busy={busy} onChange={onChange} />
              </Row>
            )}
      </Row>
      <Row wrap className="addon-card__title">
        {t(feat.labelKey)}
      </Row>
      <div className="addon-card__desc">{t(feat.descKey)}</div>
      {proLocked && !feat.locked && (
        <Row gap="g4" className="addon-card__foot">
          <Btn variant="soft" icon="lock" onClick={onChange} block>{t('settings.feat_enable')}</Btn>
        </Row>
      )}
    </Card>
  );
}

// ─── TelegramConnectDialog ────────────────────────────────────────────────────
// Real binding flow: telegramStartLink → open deep link → poll telegramGetIntegration
// until a new binding appears (user pressed Start in Telegram).

function TelegramConnectDialog({ tripId, onLinked, open, onOpenChange }) {
  const { t } = useI18n();
  const [stage, setStage] = useState('generating'); // generating | idle | connecting | connected | error
  const [url, setUrl] = useState('');
  const [errText, setErrText] = useState('');
  const [countdown, setCountdown] = useState(600);
  const [copied, setCopied] = useState(false);
  const baselineRef = React.useRef(0);

  // Snapshot current bindings, then generate the one-time deep link on open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: cur } = await invokeFn('telegramGetIntegration', { body: { tripId } });
      baselineRef.current = cur?.integrations?.length ?? 0;
      const { data, error } = await invokeFn('telegramStartLink', { body: { tripId } });
      if (cancelled) return;
      if (error || !data?.url) {
        setErrText(t('settings.tg_link_error'));
        setStage('error');
        return;
      }
      setUrl(data.url);
      setStage('idle');
    })();
    return () => { cancelled = true; };
  }, [tripId]);

  // Countdown while waiting for Start.
  useEffect(() => {
    if (stage !== 'connecting') return;
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  // Poll for the new binding while waiting.
  useEffect(() => {
    if (stage !== 'connecting') return;
    const id = setInterval(async () => {
      const { data } = await invokeFn('telegramGetIntegration', { body: { tripId } });
      if ((data?.integrations?.length ?? 0) > baselineRef.current) {
        clearInterval(id);
        onLinked?.();
        setStage('connected');
      }
    }, 3000);
    return () => clearInterval(id);
  }, [stage, tripId, onLinked]);

  const openBot = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
    setCountdown(600);
    setStage('connecting');
  };
  const checkNow = async () => {
    const { data } = await invokeFn('telegramGetIntegration', { body: { tripId } });
    if ((data?.integrations?.length ?? 0) > baselineRef.current) { onLinked?.(); setStage('connected'); }
  };
  const copyLink = () => { navigator.clipboard?.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const mmss = `${String(Math.floor(countdown / 60)).padStart(2, '0')}:${String(countdown % 60).padStart(2, '0')}`;

  const closeConnect = () => onOpenChange?.(false);
  return (
    <Dialog title={t('telegram.connect_title')} icon="telegram" size=""
      open={open} onOpenChange={onOpenChange}
      foot={<Btn variant="secondary" onClick={closeConnect}>{t('common.close')}</Btn>}>
      {/* Ритм окна - ступень шкалы у колонки, а не marginBottom у каждого соседа
          (тот же ход, что у диалогов Бюджета). Отступы были 16/16/16/14/14/14 -
          три разных мнения об одном ритме в одном окне. */}
      <Col gap="g7">
      <div className="muted t-body">
        {t('settings.tg_connect_desc')}
      </div>

      {stage === 'generating' && (
        <EmptyState
          /* inline-style-exempt: цвета бренда Telegram из реестра tgBrand (данные) */
          boxed icon="telegram" iconStyle={TG_TILE}
          title={<>
            {t('settings.tg_generating')}
            <span className="ai-dots" style={{ marginLeft: 6 }}><span /><span /><span /></span>
          </>}
          body={t('settings.tg_creating')}
        />
      )}

      {stage === 'error' && (
        <Severity level="error">{errText}</Severity>
      )}

      {stage === 'idle' && (
        <>
          {/* inline-style-exempt: цвета бренда Telegram приходят из реестра tgBrand (данные) */}
          <Severity
            level="quiet" align="mid" icon="telegram" iconStyle={TG_TILE}
            title={t('telegram.not_connected_title')}
            action={<Badge variant="quiet">{t('settings.tg_not_connected_badge')}</Badge>}
          >
            <div className="muted t-meta">{t('settings.tg_for_trip')}</div>
          </Severity>

          <Col gap="g4">
            <div className="field__label">{t('telegram.link_label')}</div>
            <Row gap="g3">
              <input className="input mono grow--fit" value={url} readOnly />
              <Btn variant="secondary" icon="copy" onClick={copyLink}>{copied ? '✓' : t('settings.tg_copy')}</Btn>
            </Row>
          </Col>

          <div className="t-body">
            {t('settings.tg_press_below')}
          </div>

          <Col gap="g4">
            <Btn variant="primary" icon="telegram" block onClick={openBot}>
              {t('telegram.open_bot')}
            </Btn>
            <div className="muted t-meta" style={{ textAlign: 'center' }}>
              {t('settings.tg_after_start')}
            </div>
          </Col>
        </>
      )}

      {stage === 'connecting' && (
        <>
          {/* inline-style-exempt: цвета бренда Telegram приходят из реестра tgBrand (данные) */}
          <Severity
            level="quiet" align="mid" icon="telegram" iconStyle={TG_TILE}
            title={t('settings.tg_waiting')}
          >
            {/* TRIP-410: t-meta теперь Geologica (single-font); отдельный отменяющий
                модификатор больше не нужен — числа держат моно через .num. */}
            <div className="muted t-meta">
              <span className="ai-dots" style={{ marginRight: 6 }}><span /><span /><span /></span>
              {t('settings.tg_link_valid')} <span className="num">{mmss}</span>
            </div>
          </Severity>

          {/* TRIP-343 объект 2 (канал 3): утоплённая поверхность (--wash) снята с
              инлайна на <Card recessed>; колоночная раскладка сохранена классом .col. */}
          <Card recessed radius="md" pad="none" className="col t-meta" style={{ padding: 14 }}>
            <Row align="a-start">
              <span className="badge badge--count">1</span>
              <div>{t('settings.tg_step1_pre')} <strong>«Start»</strong>.</div>
            </Row>
            <Row align="a-start">
              <span className="badge badge--count">2</span>
              <div>{t('settings.tg_step2')}</div>
            </Row>
          </Card>

          <Row gap="g4">
            <Btn variant="secondary" icon="telegram" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>{t('settings.tg_open_again')}</Btn>
            <Grow />
            <Btn variant="primary" icon="check" onClick={checkNow}>{t('settings.tg_pressed_start')}</Btn>
          </Row>
        </>
      )}

      {stage === 'connected' && (
        <>
          <Severity
            level="success" align="mid"
            title={t('settings.tg_linked')}
            action={<Badge variant="success" icon="check">{t('settings.tg_active')}</Badge>}
          >
            <div className="muted t-meta">{t('settings.tg_just_now')}</div>
          </Severity>
          <div className="muted t-meta">
            {t('settings.tg_connected_desc')}
          </div>
          <Btn variant="primary" icon="check" block onClick={closeConnect}>{t('view.edit_mode_done')}</Btn>
        </>
      )}
      </Col>
    </Dialog>
  );
}

// ─── TelegramSection ──────────────────────────────────────────────────────────
// Lists all Telegram bindings of the trip (many chats per trip). Real API:
// telegramGetIntegration / telegramSetActive / telegramDisconnect.
// The remove flow uses the shared TelegramUnlinkDialog (same modal as the
// account-level "Подключённые аккаунты" section - single source of truth).

function TelegramSection({ tripId }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState(null); // null = loading
  const [connectOpen, setConnectOpen] = useState(false);
  const [unlinkState, setUnlinkState] = useState(null); // null | { account }
  const [busyId, setBusyId] = useState(null); // integration id with an in-flight toggle/disconnect

  const load = React.useCallback(async () => {
    const { data, error } = await invokeFn('telegramGetIntegration', { body: { tripId } });
    setAccounts(error ? [] : (data?.integrations ?? []));
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

  // Formats a Telegram ACCOUNT, not a person — named apart from the shared
  // people-name helpers so it cannot silently shadow one of them.
  const tgName = (a) =>
    a.telegram_first_name || (a.telegram_username ? `@${a.telegram_username}` : t('telegram.unknown_user'));
  const handle = (a) => (a.telegram_username ? `@${a.telegram_username}` : '');

  // Not optimistic: an optimistic flip here misleads (the bot keeps/stops
  // notifying based on the server state). Show a spinner on the row and only
  // reflect the new state once the edge call confirms it.
  const toggle = async (a) => {
    if (busyId) return;
    setBusyId(a.id);
    const { error, code } = await invokeFn('telegramSetActive', {
      body: { tripId, integrationId: a.id, isActive: !a.is_active },
    });
    if (error) toast({ description: classifyError(t, code).text, variant: 'destructive' });
    else setAccounts(list => list.map(x => x.id === a.id ? { ...x, is_active: !x.is_active } : x));
    setBusyId(null);
  };

  const doRemove = async (a) => {
    setBusyId(a.id);
    const { error, code } = await invokeFn('telegramDisconnect', {
      body: { tripId, integrationId: a.id },
    });
    if (error) toast({ description: classifyError(t, code).text, variant: 'destructive' });
    else setAccounts(list => list.filter(x => x.id !== a.id));
    setBusyId(null);
  };
  const remove = (a) => setUnlinkState({ account: a });
  const openConnect = () => setConnectOpen(true);

  if (accounts === null) {
    return <div className="muted t-body" style={{ padding: 8 }}>{t('common.loading')}</div>;
  }

  if (accounts.length === 0) {
    return (
      <>
        <EmptyState
          /* inline-style-exempt: цвета бренда Telegram из реестра tgBrand (данные) */
          boxed icon="telegram" iconStyle={TG_TILE}
          title={t('telegram.not_connected_title')}
          body={t('settings.tg_section_empty_desc')}
          action={
            <Btn variant="primary" icon="telegram" onClick={openConnect}>
              {t('telegram.connect_title')}
            </Btn>
          }
        />
        <TelegramConnectDialog open={connectOpen} onOpenChange={setConnectOpen} tripId={tripId} onLinked={load} />
      </>
    );
  }

  return (
    <Col gap="g6">
      {accounts.map(a => (
        /* TRIP-343 объект 2 (канал 3): скин поверхности снят с инлайна на Card. */
        <Card key={a.id} radius="md" pad="none" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12 }}>
          {/* inline-style-exempt: цвета бренда Telegram приходят из реестра tgBrand (данные) */}
          <div className="tile" style={TG_TILE}>
            <Icon name="telegram" size={17} />
          </div>
          <Grow fit>
            <div className="t-subheading">{tgName(a)}</div>
            {handle(a) && <div className="muted mono t-mono">{handle(a)}</div>}
          </Grow>
          <Toggle on={!!a.is_active} busy={busyId === a.id} onChange={() => toggle(a)} />
          <Btn variant="quiet" icon="trash" loading={busyId === a.id} onClick={() => remove(a)} />
        </Card>
      ))}
      <Btn variant="secondary" icon="plus" onClick={openConnect}>
        {t('telegram.connect_another')}
      </Btn>
      <TelegramConnectDialog open={connectOpen} onOpenChange={setConnectOpen} tripId={tripId} onLinked={load} />
      {unlinkState && (
        <TelegramUnlinkDialog
          open={true}
          onOpenChange={(o) => { if (!o) setUnlinkState(null); }}
          handle={handle(unlinkState.account) || tgName(unlinkState.account)}
          onConfirm={() => doRemove(unlinkState.account)}
        />
      )}
    </Col>
  );
}

// ─── SettingsLens (main export) ───────────────────────────────────────────────

// Скелетон настроек — PURE, зеркалит РЕАЛЬНУЮ разметку экрана теми же классами:
// (1) карточка «General» = CardHeader + `.settings-identity` (обложка `__cover`
// слева | форма `__fields` справа), (2) «Optional features» = `.addon-grid` из
// тоггл-карточек, (3) `.settings-grid` в 2 колонки. Не сетка одинаковых карточек
// (то был «выдуманный» layout). Один источник для обеих фаз загрузки. TRIP-337.
export function SettingsSkeleton() {
  return (
    <Col gap="g7" className="settings-lens" aria-busy="true">
      {/* 1. General: заголовок + Save + identity-grid (обложка | форма) */}
      <Card>
        <CardHeader title={<Skeleton w={120} h={22} r={6} />} action={<Skeleton w={130} h={40} r={'var(--r-btn)'} />} />
        <Grid className="settings-identity">
          <div className="settings-identity__cover">
            <Skeleton w="100%" h={150} r={'var(--r-md)'} />
            <div className="row row--g4 row--wrap" style={{ marginTop: 12 }}>
              {Array.from({ length: 16 }).map((_, i) => <Skeleton key={i} w={32} h={32} r="50%" />)}
            </div>
          </div>
          <Col gap="g7" className="settings-identity__fields">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="col col--g3">
                <Skeleton w="35%" h={13} r={5} />
                <Skeleton w="100%" h={i === 3 ? 120 : 44} r={'var(--r-btn)'} />
              </div>
            ))}
          </Col>
        </Grid>
      </Card>
      {/* 2. Optional features: заголовок + addon-grid (3 тоггл-карточки в ряд) */}
      <Card>
        <div className="card-h"><Skeleton w={190} h={22} r={6} /></div>
        <Grid className="addon-grid">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <div className="col col--g4">
                <div className="row row--j-between">
                  <Skeleton w={36} h={36} r={'var(--r-sm)'} />
                  <Skeleton w={44} h={24} r={'var(--r-pill)'} />
                </div>
                <Skeleton w="60%" h={16} r={5} />
                <Skeleton w="90%" h={12} r={5} />
              </div>
            </Card>
          ))}
        </Grid>
      </Card>
      {/* 3. settings-grid: 2 колонки настроек */}
      <Grid cols="2" gap="g7" className="settings-grid">
        {[0, 1].map((c) => (
          <Col key={c} gap="g7" className="settings-col">
            <Card>
              <CardHeader title={<Skeleton w="45%" h={18} r={6} />} />
              <div className="row row--j-between" style={{ marginTop: 8 }}>
                <div className="col col--g2 grow"><Skeleton w="50%" h={13} r={5} /><Skeleton w="70%" h={11} r={5} /></div>
                <Skeleton w={44} h={24} r={'var(--r-pill)'} style={{ flex: 'none' }} />
              </div>
            </Card>
          </Col>
        ))}
      </Grid>
    </Col>
  );
}

export default function SettingsLens({ tripId, trip, members = [], isOwner = false, canEdit = false, isPro, isProTrip, proResolved = true, queryClient, profiles = {}, isLoading = false }) {
  // Profiles ride in the trip content bundle (getTripDetails), handed down by
  // TripView — no separate profile-fetch hop for the owner name.
  const { t } = useI18n();
  const confirm = useConfirm();
  const { user } = useAuth();
  const nav = useNavigate();
  // Copy trip — moved here from the old header "…" menu. Delegates to
  // CreateTripProvider so it runs the SAME free-tier gate as creating a new trip.
  const { startCopy, copying } = useCreateTrip();

  const [title,   setTitle]   = useState(trip?.title        || '');
  const [description, setDescription] = useState(trip?.description || '');
  const [notes,   setNotes]   = useState(trip?.notes        || '');
  const [coverImageUrl, setCoverImageUrl] = useState(trip?.cover_image_url || '');
  const [coverGradient, setCoverGradient] = useState(trip?.cover_gradient || '');
  const [currency, setCurrency] = useState(trip?.details?.main_currency || trip?.main_currency || 'EUR');
  const [saving,  setSaving]  = useState(false);
  // Which display/feature toggle is mid-flight (key string or feature id) — drives
  // the in-knob spinner and blocks re-entry. Toggles persist before they flip
  // (no optimism), so this is the only "in progress" signal the user gets.
  const [busyToggle, setBusyToggle] = useState(null);
  const { toast } = useToast();

  const hasPro = isPro; // trip-level Pro (owner sub OR is_pro_trip), passed from TripView
  // isOwner — ступень owner лестницы (строго created_by), решено в TripView.
  // Гейтит owner-only управление (удалить трип) и режим апселла (upgrade/info).
  // Viewers get Settings in read-only mode: identity fields muted, management
  // cards hidden, only "Leave trip" stays active (TRIP-137). NOTE: this is a UI
  // guard only — server-side write protection is TRIP-136 (RLS), not this.
  // Право — единая лестница доступа (ступень editor), решено выше в TripView.
  const readOnly = !canEdit;
  const [features, setFeatures] = useState(() => featuresFromTrip(trip));
  // Trip-level display toggles (default ON when the flag is absent).
  const [bookingWarnings, setBookingWarnings] = useState(() => trip?.details?.display?.booking_warnings !== false);
  const [chatWidget, setChatWidget] = useState(() => trip?.details?.display?.chat_widget !== false);
  // Pro-апселл — единый app-level хост (TRIP-225), открывается императивно.
  const { openProUpsell } = useProUpsell();
  const ownerName = resolveOwnerName({ trip, members, profiles, selfUser: user, deletedLabel: t('common.deleted_user') });
  // Owner upgrade from Settings shows the SAME 3 offers as the sidebar / AI-block
  // (per-trip + monthly + yearly). No hidePerTrip here: Pro.jsx already hides the
  // per-trip offer for non-owners (tripOwner check), so the flag only created an
  // owner-vs-owner inconsistency between Settings and the sidebar (TRIP-63 №2).
  const openUpgrade = () => nav(`/pro?tripId=${tripId}`);

  // Seed local state when the trip first loads or when switching to a different
  // trip. Keyed on trip.id (NOT the trip object): react-query hands back a fresh
  // object on every background refetch / window-focus, and depending on the whole
  // object would wipe the user's in-progress title edit right before they save it.
  useEffect(() => {
    if (trip?.title)        setTitle(trip.title);
    setDescription(trip?.description || '');
    setNotes(trip?.notes || '');
    setCoverImageUrl(trip?.cover_image_url || '');
    setCoverGradient(trip?.cover_gradient || '');
    if (trip?.details?.main_currency || trip?.main_currency) setCurrency(trip.details?.main_currency || trip.main_currency || 'EUR');
    setFeatures(featuresFromTrip(trip));
    setBookingWarnings(trip?.details?.display?.booking_warnings !== false);
    setChatWidget(trip?.details?.display?.chat_widget !== false);
  }, [trip?.id]);

  // Dirty state for the identity block (title / description / currency / cover /
  // notes). Toggles below auto-save on click, so the Save button only governs
  // these manually-edited fields and stays disabled until something changes.
  const persistedCurrency = trip?.details?.main_currency || trip?.main_currency || 'EUR';
  const dirty =
    title.trim()    !== (trip?.title || '') ||
    description     !== (trip?.description || '') ||
    notes           !== (trip?.notes || '') ||
    coverImageUrl   !== (trip?.cover_image_url || '') ||
    coverGradient   !== (trip?.cover_gradient || '') ||
    currency        !== persistedCurrency;

  // ЕДИНСТВЕННОЕ место, где отказ edge-функции превращается в текст тоста:
  // обёртка (`save_error` "Не удалось сохранить: …" / `save_error2` "Ошибка: …")
  // плюс текст причины из общего `classifyError` (одна карта код→текст на весь
  // клиент). Инвариант: серверная проза пользователю не показывается НИКОГДА.
  /**
   * @param {string|null} code машинный `code` от `invokeFn`, не `data.code`
   * @param {string} [wrapKey] обёртка: `save_error` | `save_error2`
   */
  const refusalToast = (code, wrapKey = 'settings.save_error') =>
    toast({
      description: t(wrapKey, { message: classifyError(t, code).text }),
      variant: 'destructive',
    });

  // Trip-level display toggle. Persisted under details.display via the edge
  // function (trips RLS is owner-only). Architecture note: `display` is an
  // extensible bag - adding another visibility flag later is just another key.
  async function toggleBookingWarnings() {
    if (busyToggle) return;
    const next = !bookingWarnings;
    setBusyToggle('booking_warnings');
    const { error, code } = await invokeFn('trip-settings/settings', {
      body: { tripId, display: { booking_warnings: next } },
    });
    if (error) {
      refusalToast(code);
    } else {
      setBookingWarnings(next); // reflect only after the server confirms
      queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
      successToast(t, 'settings_saved');
    }
    setBusyToggle(null);
  }

  // Trip-level toggle for the floating chat widget (the dock button shown on
  // every trip page). Persisted under details.display.chat_widget, same path as
  // booking_warnings. Independent of the per-user nothing - it's a trip setting.
  // NOTE: the actual widget is ALSO gated by the `chat` addon in TripView, so
  // turning the addon off hides the widget regardless of this flag.
  async function toggleChatWidget() {
    if (busyToggle) return;
    const next = !chatWidget;
    setBusyToggle('chat_widget');
    const { error, code } = await invokeFn('trip-settings/settings', {
      body: { tripId, display: { chat_widget: next } },
    });
    if (error) {
      refusalToast(code);
    } else {
      setChatWidget(next); // reflect only after the server confirms
      queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
      successToast(t, 'settings_saved');
    }
    setBusyToggle(null);
  }

  // Save identity settings: title, description, notes, cover (gradient/image)
  // and main currency. All these columns are whitelisted by trip-settings/settings
  // (title/description/cover_image_url/cover_gradient/notes); currency lives
  // under details.main_currency.
  async function saveSettings() {
    if (!title.trim()) return;
    setSaving(true);
    const prevCurrency = trip?.details?.main_currency || trip?.main_currency || 'EUR';
    const prevCoverUrl = trip?.cover_image_url || '';
    const fields = {
      title: title.trim(),
      description: description.trim() || null,
      notes: notes || null,
      cover_image_url: coverImageUrl || null,
      // Invariant: keep a built-in gradient even when a photo is set (photo just
      // renders on top). Never persist null → no legacy/procedural fallback.
      cover_gradient: coverGradient || DEFAULT_GRADIENT_ID,
    };
    // trips RLS is owner-only → write via edge function so admins can save too.
    // Смена главной валюты обесценивает fx_overrides (они заданы против СТАРОЙ
    // валюты). Сброс делает СЕРВЕР в той же транзакции — второй клиентской
    // до-записи в trip_budgets больше нет (единая дверь, TRIP-394).
    const { error, code } = await invokeFn('trip-settings/settings', {
      body: { tripId, fields, main_currency: currency },
    });
    setSaving(false);
    if (error) { refusalToast(code, 'settings.save_error2'); return; }
    // Cover replaced/cleared → the previously persisted object is now orphaned.
    // Delete it best-effort, comparing object KEYS (signed-URL tokens differ but
    // the key is stable) so we never delete the key the new cover still uses (TRIP-117).
    const prevPath = collectDocPaths([{ file_url: prevCoverUrl }])[0];
    const newPath = collectDocPaths([{ file_url: fields.cover_image_url }])[0];
    if (prevPath && prevPath !== newPath) removeTripFiles([prevPath]);
    track('settings_saved', {
      trip_id: tripId,
      currency_changed: currency !== prevCurrency,
      cover_changed: prevPath !== newPath,
    });
    // Optimistically patch the shell cache so the header title + cover update
    // instantly, then invalidate to reconcile with the server.
    queryClient?.setQueryData(TRIP_SHELL_KEY(tripId), (old) =>
      old?.trip ? { ...old, trip: { ...old.trip,
        title: fields.title,
        description: fields.description,
        notes: fields.notes,
        cover_image_url: fields.cover_image_url,
        cover_gradient: fields.cover_gradient,
        details: { ...(old.trip.details || {}), main_currency: currency } } } : old);
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
    queryClient?.invalidateQueries({ queryKey: ['trips'] }); // trips list shows title/cover/description
    successToast(t, 'settings_saved');
  }

  // Toggle feature → persist to trip.details.addons, then invalidate shell query.
  async function toggleFeature(id, pro) {
    const feat = FEATURES.find(f => f.id === id);
    if (feat?.locked) return;
    if (busyToggle) return;
    if (pro && !hasPro) {
      // Trip is not Pro. Only the owner can upgrade it → owner sees the upgrade
      // path; a non-owner (admin) is told to ask the owner instead of being sent
      // to checkout (their payment wouldn't unlock THIS trip).
      openProUpsell({ mode: isOwner ? 'upgrade' : 'info', feature: feat ? t(feat.labelKey) : '', ownerName, onUpgrade: openUpgrade });
      return;
    }
    const newVal = !features[id];
    const prevAddons = trip?.details?.addons || {};
    const nextAddons = { ...prevAddons, [feat.addon]: newVal };
    setBusyToggle(id);
    // No optimism: a feature flip drives gating (chat widget, lenses) — flipping
    // before the server confirms misleads. The toggle shows a spinner instead.
    const patchAddons = (addons) => queryClient?.setQueryData(TRIP_SHELL_KEY(tripId), (old) =>
      old?.trip ? { ...old, trip: { ...old.trip, details: { ...(old.trip.details || {}), addons } } } : old);
    // trips RLS is owner-only → write via edge function (owner+admin, pro-gated).
    const { error, code } = await invokeFn('trip-settings/settings', {
      body: { tripId, addons: nextAddons },
    });
    if (error) {
      // Единственная ветка, ЗАВИСЯЩАЯ от кода: Pro-отказ открывает апселл, а не
      // тост (kind==='upsell' у classifyError). Читается `code` от invokeFn, не
      // `data.code` - 402 оставляет `data` пустым.
      if (code === 'PRO_REQUIRED') {
        openProUpsell({ mode: isOwner ? 'upgrade' : 'info', feature: feat ? t(feat.labelKey) : '', ownerName, onUpgrade: openUpgrade });
      } else {
        refusalToast(code);
      }
      setBusyToggle(null);
      return;
    }
    setFeatures(s => ({ ...s, [id]: newVal }));  // reflect only after server confirms
    patchAddons(nextAddons);                      // sync the shell cache (lenses/widget)
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    successToast(t, newVal ? 'addon_enabled' : 'addon_disabled', { addon: feat ? t(feat.labelKey) : '' });
    setBusyToggle(null);
  }

  // Leave trip — runs through the async confirm so the confirm button shows a
  // spinner while removeTripMember is in flight (the edge call is not instant).
  async function leaveTrip() {
    const myMember = members.find(m => m.user_id === user?.id && m.status === 'active');
    if (!myMember) { toast({ description: t('settings.leave_not_found'), variant: 'destructive' }); return; }
    await confirm({
      title: t('settings.leave_confirm'),
      description: t('confirm.leave_trip.body'),
      variant: 'destructive',
      onConfirm: async () => {
        // Only leave (navigate away) once the backend actually removed the row.
        // The leave action (trip-member-self/leave) now returns a non-2xx with the
        // reason on failure, so we must read the response - navigating on a silent
        // failure left the user still in the trip ("выход" перебрасывал на /trips,
        // но не выходил).
        const { error, code } = await invokeFn('trip-member-self/leave', {
          body: { id: myMember.id, trip_id: tripId },
        });
        if (error) {
          // Причина отказа приходит машинным `code`; текст даёт общий refusalToast
          // (одна карта код→текст). Серверный `message` не показываем НИКОГДА.
          refusalToast(code, 'settings.save_error2');
          return;
        }
        successToast(t, 'trip_left');
        nav('/trips');
      },
    });
  }

  // Delete trip (owner only). Routed through the trip-owner/delete seam action;
  // FK cascade wipes child rows, then Telegram teardown + Storage purge run
  // best-effort in afterWrite (post-delete).
  async function deleteTrip() {
    if (!(await confirm({ title: t('settings.delete_confirm1'), variant: 'destructive' }))) return;

    // The actual irreversible delete; attached to the LAST confirm shown so its
    // button carries the spinner while trip-owner/delete (DELETE + best-effort
    // Telegram teardown + Storage purge) runs.
    const runDelete = async () => {
      const { error, code } = await invokeFn('trip-owner/delete', { body: { tripId } });
      if (error) {
        // Нейтральный `err.FORBIDDEN` покрывает и «не владелец» на удалении, и
        // отказ правки — отдельной клаузы удаления больше нет (серверный
        // `message` пользователю не показываем НИКОГДА).
        refusalToast(code, 'settings.save_error2');
        return;
      }
      // Deleting an owned trip lowers the active-trip count — drop the gate cache
      // so the planner can't read a stale count and flash the limit guard.
      invalidateActiveTripsLimit(queryClient);
      track('trip_deleted', { trip_id: tripId });
      successToast(t, 'trip_deleted');
      nav('/trips');
    };

    // 3rd confirm — ONLY for a trip carrying a one-time Pro purchase
    // (is_pro_trip), which burns on delete. NOT shown when Pro comes from an
    // account-level subscription (that survives the trip being deleted), so we
    // key off is_pro_trip, not the merged isPro flag.
    if (isProTrip) {
      if (!(await confirm({ title: t('settings.delete_confirm2'), variant: 'destructive' }))) return;
      await confirm({
        title: t('confirm.delete_pro_trip.title'),
        description: t('confirm.delete_pro_trip.body'),
        variant: 'destructive',
        onConfirm: runDelete,
      });
    } else {
      await confirm({ title: t('settings.delete_confirm2'), variant: 'destructive', onConfirm: runDelete });
    }
  }

  if (isLoading) return <SettingsSkeleton />;

  return (
    <Col gap="g7" className="settings-lens">
      {/* Viewer read-only notice — only this banner + the Leave button are
          interactive for a viewer (TRIP-137). */}
      {readOnly && (
        <Severity level="info" title={t('settings.readonly_banner_title')}>{t('settings.readonly_banner_desc')}</Severity>
      )}
      {/* ── Identity: cover + name / description / currency / notes ──────────
          Save here governs only these manually-edited fields; the feature and
          display toggles below auto-save on click. */}
      <Card>
        <CardHeader
          title={t('settings.section_basic')}
          action={readOnly ? null : (
            <Row>
              <Btn variant="primary" loading={saving} disabled={!dirty || !title.trim()} onClick={saveSettings}>
                {t('trip.form_save')}
              </Btn>
            </Row>
          )}
        />
        {/* Read-only: native fieldset disables inputs/buttons/file input/combobox;
            pointer-events + opacity mute the whole block visually. */}
        <fieldset disabled={readOnly}>
        <Grid className="settings-identity">
          <div className="settings-identity__cover">
            <Field label={t('trip.form_cover')}>
              <TripCoverPicker
                coverImageUrl={coverImageUrl}
                coverGradient={coverGradient}
                tripId={tripId}
                onChange={({ cover_image_url, cover_gradient }) => {
                  setCoverImageUrl(cover_image_url);
                  setCoverGradient(cover_gradient);
                }}
              />
            </Field>
          </div>
          <Col gap="g7" className="settings-identity__fields">
            <Field label={t('trip.title_label')}>
              <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
            </Field>
            <Field label={t('trip.description')}>
              <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder={t('trip.form_description_placeholder')} />
            </Field>
            <Field label={t('settings.main_currency_label')} sub={t('settings.main_currency_hint')}>
              <CurrencyCombobox value={currency} onChange={setCurrency} />
            </Field>
            <Field label={t('trip.form_notes')}>
              <Textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('trip.form_notes_placeholder')} />
            </Field>
          </Col>
        </Grid>
        </fieldset>
      </Card>

      {/* Management cards (features, integrations, warnings) stay
          VISIBLE for a read-only viewer (TRIP-63 №5) but disabled: a native
          <fieldset disabled> switches off every control inside (toggles, inputs,
          file pickers and buttons are all native), and opacity + pointer-events
          mute the block visually — the SAME proven pattern as the identity
          fieldset above. The viewer now SEES the budget addon exists (just can't
          flip it), so the budget-lock modal's "Open settings" CTA is no longer a
          dead end. Only "Leave trip" (Danger zone, OUTSIDE this fieldset) stays
          interactive. flex+gap mirrors the .settings-lens spacing so wrapping the
          cards doesn't collapse the 16px gaps. */}
      <Col as="fieldset" gap="g7" disabled={readOnly}>
      {/* ── Features: addon widget cards (Lumo DS §D1), full width ──
          The Pro upgrade banner lives INSIDE this panel, above the heading
          (matches the approved prototype). Shown on the same condition as the
          right-menu plate (TripSidebar `showUpgrade`): trip not Pro and Pro
          status resolved (avoids a flash on Pro trips). Gated by owner /
          non-owner, NOT by a specific role: the owner gets the upgrade CTA, any
          non-owner gets the "enabled by owner" button that opens the same info
          modal as the sidebar plate. Card title is rendered manually (via the
          shared .card-h) so the banner can sit above it. Reuses the EXACT
          sidebar-plate elements — .pro-up / .pi / .pt / .pro-up p + the same
          <Btn> non-owner CTA — so it looks identical to the right-menu plate,
          just horizontal. */}
      <Card>
        {/* TRIP-343 объект 2 (F): скин brand-плашки апгрейда несёт примитив Card тоном brand (прежде сырая плашка без поверхности); класс pro-up остаётся раскладкой. */}
        {proResolved && !hasPro && (
          <Card tone="brand" radius="md" className="pro-up pro-up--inline" style={{ marginBottom: 16 }}>
            <Badge variant="pro" icon="pro">PRO</Badge>
            <div className="pu-body">
              <div className="pt">{t('trip_menu.free_trip_title')}</div>
              <p style={{ margin: 0 }}>{t('trip.pro_locked_lenses')}</p>
            </div>
            {isOwner ? (
              <Btn variant="primary" iconRight="arrowR" onClick={openUpgrade}>{t('trip_menu.upgrade_trip')}</Btn>
            ) : (
              <Btn variant="secondary" icon="lock" onClick={() => openProUpsell({ mode: 'info', ownerName, onUpgrade: openUpgrade })}>{t('trip.pro_by_owner')}</Btn>
            )}
          </Card>
        )}
        <div className="card-h">
          <Grow><h3>{t('settings.optional_features')}</h3></Grow>
        </div>
        <Grid className="addon-grid">
          {FEATURES
            .map(f => (
              <FeatureCard key={f.id} feat={f} on={features[f.id]} hasPro={hasPro}
                busy={busyToggle === f.id}
                onChange={() => toggleFeature(f.id, f.pro)} />
            ))}
        </Grid>
      </Card>

      {/* ── Integrations · warnings (2-col → 1-col on mobile) ── */}
      <Grid cols="2" gap="g7" className="settings-grid">
        <Col gap="g7" className="settings-col">
          {/* Chat widget - trip-level toggle for the floating dock button.
              Only shown when the Group Chat addon is on. */}
          {features.chat && (
            <Card>
              <CardHeader title={t('settings.chat_widget_title')} />
              <Row gap="g7">
                <Grow fit>
                  <div className="t-label">{t('settings.chat_widget_label')}</div>
                  <div className="muted t-meta">
                    {t('settings.chat_widget_desc')}
                  </div>
                </Grow>
                <Toggle on={chatWidget} busy={busyToggle === 'chat_widget'} onChange={toggleChatWidget} />
              </Row>

              <Row gap="g6" className="settings-plate" style={{ marginTop: 12 }}>
                {/* inline-style-exempt: градиент и гашение - состояние виджета (данные), не скин */}
                <div className="tile tile--xl" style={{
                  background: 'linear-gradient(135deg, var(--brand) 0%, var(--brand) 50%, var(--ai) 100%)',
                  color: '#fff',
                  opacity: chatWidget ? 1 : 0.35, transition: 'opacity .15s ease',
                }}>
                  <Icon name="chat" size={20} />
                </div>
                <div className="muted t-meta">
                  {chatWidget
                    ? t('settings.chat_widget_on')
                    : t('settings.chat_widget_off')}
                </div>
              </Row>
            </Card>
          )}

          {/* Warnings / display - extensible bag of trip-level display toggles. */}
          <Card>
            <CardHeader title={t('settings.warnings_title')} subtitle={t('settings.warnings_desc')} />
            <Row gap="g6" className="settings-plate">
              <Grow fit>
                <div className="t-label">{t('settings.warn_bookings_title')}</div>   {/* TRIP-175 инсп.: UI→Label */}
                <div className="muted t-meta">{t('settings.warn_bookings_desc')}</div>
              </Grow>
              <Toggle on={bookingWarnings} busy={busyToggle === 'booking_warnings'} onChange={toggleBookingWarnings} />
            </Row>
          </Card>
        </Col>

        <Col gap="g7" className="settings-col">
          {/* Telegram - only when the Telegram addon is enabled. */}
          {features.tg && (
            <Card>
              <CardHeader title={t('settings.feat_tg_title')} subtitle={t('settings.feat_tg_desc')} />
              <TelegramSection tripId={tripId} />
            </Card>
          )}
        </Col>
      </Grid>
      </Col>

      {/* ── Copy trip (full width) ────────────────────────────────────────────
          Moved here from the old header "…" menu. Copy creates a NEW trip owned
          by the caller and runs the SAME free-tier gate as creating one from
          scratch (startCopy → CreateTripProvider); it never touches THIS trip,
          so it sits OUTSIDE the read-only fieldset and stays available to every
          participant, including a viewer. Pro status + Pro-only addons and
          documents are stripped from the copy server-side. */}
      {/* Копия - такая же строка списка, как строки опасной зоны ниже и строки
          аккаунта: значок + (заголовок · описание) + действие СПРАВА. Раньше
          заголовок с описанием отдавались шапке карточки, а кнопка клалась в
          тело - поэтому она уезжала ПОД текст и ярус заголовка был крупнее
          соседних. Одна деталь - одна раскладка. */}
      <Card>
        <Row gap="g7" className="row--flush">
          <span className="tile tile--lg tile--brand"><Icon name="copy" size={18} /></span>
          <Grow>
            <div className="row__t">{t('settings.copy_trip_title')}</div>
            <div className="row__s">{t('settings.copy_trip_desc')}</div>
          </Grow>
          <Btn variant="soft" icon="copy" loading={copying} onClick={() => void startCopy(tripId)}>
            {t('settings.copy_trip_btn')}
          </Btn>
        </Row>
      </Card>

      {/* ── Danger zone (full width) ── */}
      <Card style={{ borderColor: 'var(--danger-soft)' }}>
        <CardHeader title={t('settings.danger_zone')} />
        {!isOwner && (
          <Row gap="g7" className="row--flush">
            <span className="tile tile--lg tile--danger"><Icon name="arrow" size={18} /></span>
            <Grow>
              <div className="row__t">{t('settings.leave_trip')}</div>
              <div className="row__s">{t('settings.leave_desc')}</div>
            </Grow>
            <Btn variant="danger" onClick={leaveTrip}>{t('settings.leave_btn')}</Btn>
          </Row>
        )}
        {isOwner && (
          <>
            {/* Линейку между строками несёт сама строка (.row--div), поэтому
                отдельный <hr> больше не нужен - его сброс был ещё одним инлайном. */}
            <Row gap="g7" className="row--div">
              <span className="tile tile--lg tile--quiet"><Icon name="arrow" size={18} /></span>
              <Grow>
                <div className="row__t">{t('settings.leave_trip')}</div>
                <div className="row__s">{t('settings.leave_owner_blocked')}</div>
              </Grow>
              <Btn variant="danger" disabled>{t('settings.leave_btn')}</Btn>
            </Row>
            <Row gap="g7" className="row--div">
              <span className="tile tile--lg tile--danger"><Icon name="trash" size={18} /></span>
              <Grow>
                <div className="row__t">{t('settings.delete_trip')}</div>
                <div className="row__s">{t('settings.delete_desc')}</div>
              </Grow>
              <Btn variant="danger-solid" onClick={deleteTrip}>{t('settings.delete_trip')}</Btn>
            </Row>
          </>
        )}
      </Card>
    </Col>
  );
}
