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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Row, Col, Grid, Grow } from '../design/Layout';
import { invokeFn } from '@/lib/invokeFn';
import { getAddons } from '@/lib/tripAddons';
import { track } from '@/lib/analytics';
import { classifyError, errorText } from '@/lib/errorText';
import { goPro } from '@/lib/goPro';
import { useAuth } from '@/lib/AuthContext';
import { useI18n } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { TRIP_SHELL_KEY, listBinding } from '@/lib/trip-data';
import { TG_TRIP_KEY, fetchTripIntegrations, disconnectTelegram, setTelegramActive, startTelegramLink, invalidateTelegram } from '@/lib/telegramMutations';
import { resolveOwnerName } from '@/lib/resolveAuthor';
import { invalidateActiveTripsLimit } from '@/hooks/useActiveTripsLimit';
import { Icon } from '../design/icons';
import { Badge, Btn, Card, CardHeader, Dialog, EmptyState, Field, IconBtn, Severity, Skeleton, Toggle, useToast, CurrencyCombobox } from '../design/index';
import { proRole } from '@/lib/proUpsell';
import { useProUpsell } from '@/components/common/ProUpsellProvider';
import { useCreateTrip } from '@/components/create/CreateTripProvider';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { telegram as tgBrand } from '@/lib/externalBrands';
import TripCoverPicker from '@/components/trips/TripCoverPicker';
import { collectDocPaths, removeTripFiles } from '@/lib/storageCleanup';
import { useTripAccess } from '@/components/trips/TripAccessContext';

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
// Telegram-привязки (`telegramDisconnect`/`telegramSetActive`, TRIP-439) идут
// через data-access слой `telegramMutations.js`: отказ приходит `code`, а тост
// его словами через `errorText`/`classifyError` — сырой `error?.message` больше
// не показывается. Остаток долга: `removeTripMember` (~:708) — ратчет сырых
// клиентских ошибок (гард 3b) держит это число и не даёт ему расти.

// Default OFF unless explicitly enabled (addons[key] === true). New trips start
// with every optional/pro feature off - they never auto-enable for anyone.
function featuresFromTrip(trip) {
  // Предикат «аддон включён» — общий (`getAddons` → `normalizeAddons`), тот же,
  // которым состав меню решает, показывать ли Бюджет и Чат. Своя копия `=== true`
  // тут была третьей и держалась только на том, что её никто не трогал: разойдись
  // они — тоггл показывал бы «включено» там, где раздел в меню не появляется.
  const addons = getAddons(trip);
  const state = {};
  for (const f of FEATURES) state[f.id] = f.locked ? false : addons[f.addon] === true;
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

  // Generate the one-time deep link when the dialog OPENS. The dialog stays mounted
  // at a stable position (so the empty→list flip on the first link can't remount it),
  // therefore a mount-time effect would fire on page load and go stale — gate on
  // `open` instead. Closing resets the stage so the next open mints a fresh link.
  useEffect(() => {
    if (!open) { setStage('generating'); return; }
    let cancelled = false;
    (async () => {
      try {
        const cur = await fetchTripIntegrations(tripId);
        baselineRef.current = cur.length;
        const link = await startTelegramLink(tripId);
        if (cancelled) return;
        setUrl(link);
        setStage('idle');
      } catch {
        if (cancelled) return;
        setErrText(t('settings.tg_link_error'));
        setStage('error');
      }
    })();
    return () => { cancelled = true; };
  }, [open, tripId]);

  // Countdown while waiting for Start.
  useEffect(() => {
    if (stage !== 'connecting') return;
    const id = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [stage]);

  // Poll for the new binding while waiting (best-effort: a transient poll error
  // just keeps polling).
  useEffect(() => {
    if (stage !== 'connecting') return;
    const id = setInterval(async () => {
      try {
        const list = await fetchTripIntegrations(tripId);
        if (list.length > baselineRef.current) {
          clearInterval(id);
          onLinked?.();
          setStage('connected');
        }
      } catch { /* keep polling */ }
    }, 3000);
    return () => clearInterval(id);
  }, [stage, tripId, onLinked]);

  const openBot = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
    setCountdown(600);
    setStage('connecting');
  };
  const checkNow = async () => {
    try {
      const list = await fetchTripIntegrations(tripId);
      if (list.length > baselineRef.current) { onLinked?.(); setStage('connected'); }
    } catch { /* ignore — user can press again */ }
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
// Lists all Telegram bindings of the trip (many chats per trip) via the Telegram
// data-access layer (telegramMutations.js). Unlink runs through the shared
// async-confirm (useConfirm) — the SAME seam as the account-level "Подключённые
// аккаунты" section, so both surfaces behave identically.

function TelegramSection({ tripId }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [connectOpen, setConnectOpen] = useState(false);
  const [busyId, setBusyId] = useState(null); // integration id with an in-flight toggle

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: TG_TRIP_KEY(tripId),
    queryFn: () => fetchTripIntegrations(tripId),
    enabled: !!tripId,
  });
  const binding = listBinding(qc, TG_TRIP_KEY(tripId));

  // Formats a Telegram ACCOUNT, not a person — named apart from the shared
  // people-name helpers so it cannot silently shadow one of them.
  const tgName = (a) =>
    a.telegram_first_name || (a.telegram_username ? `@${a.telegram_username}` : t('telegram.unknown_user'));
  const handle = (a) => (a.telegram_username ? `@${a.telegram_username}` : '');

  // Toggle notifications for one chat. Not optimistic: the flip drives whether the
  // bot notifies, so reflecting it before the server confirms would mislead. Show a
  // spinner on the row and reflect the new state only once the edge call lands.
  const toggle = async (a) => {
    if (busyId) return;
    const next = !a.is_active;
    setBusyId(a.id);
    try {
      await setTelegramActive(tripId, a.id, next);
      binding.update({ id: a.id, is_active: next });
      successToast(t, next ? 'tg_reminders_on' : 'tg_reminders_off');
    } catch (err) {
      toast({ description: errorText(t, err?.code), variant: 'destructive' });
    } finally {
      setBusyId(null);
    }
  };

  // Unlink is a real teardown (the bot stops), so it mirrors the document-delete
  // canon: shared async-confirm (button spins until it lands) + a pessimistic drop
  // on the response — the same seam and feel as the account screen.
  const unlinkMut = useMutation({
    mutationFn: (/** @type {any} */ { account }) => disconnectTelegram(tripId, account.id),
    onSuccess: (/** @type {any} */ _d, /** @type {any} */ { account }) => {
      binding.remove(account.id);
      successToast(t, 'tg_unlinked');
      invalidateTelegram(qc, tripId); // reconcile the account-screen projection too
    },
    onError: (/** @type {any} */ err) => {
      toast({ description: errorText(t, err?.code), variant: 'destructive' });
      invalidateTelegram(qc, tripId); // row may already be gone → reconcile
    },
  });
  const remove = (a) => confirm({
    title: t('telegram.unlink_title'),
    description: t('telegram.unlink_body', { handle: handle(a) || tgName(a) }),
    variant: 'destructive',
    confirmLabel: t('telegram.unlink_confirm'),
    onConfirm: () => unlinkMut.mutateAsync({ account: a }),
  });
  const openConnect = () => setConnectOpen(true);
  // Memoized: the connect dialog's poll effect depends on it — a new identity each
  // render would reset the 3s interval and it could never fire.
  const onLinked = React.useCallback(() => invalidateTelegram(qc, tripId), [qc, tripId]);

  // ONE dialog instance at a stable tree position (not duplicated per branch): a
  // per-branch copy would remount on the empty→list flip that the FIRST successful
  // link triggers, re-running its "generate link" effect and re-opening generation.
  /* floor-exempt: dsshare +4 - удалён дубль-компонент TelegramUnlinkDialog (Dialog+2×Btn)
     и схлопнут двойной <TelegramConnectDialog> в один узел → отвязка на каноне useConfirm;
     это чистка дублей по rule #6, апрув Pavel TRIP-439. */
  return (
    <>
      {isLoading ? (
        <div className="muted t-body" style={{ padding: 8 }}>{t('common.loading')}</div>
      ) : accounts.length === 0 ? (
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
      ) : (
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
              {/* Отвязка = канон icon-only `<IconBtn>` (danger), та же реализация, что на
                  экране аккаунта (ScreenAccount): один объект — одна кнопка. Спиннер живёт
                  на кнопке подтверждения общего async-confirm, а не на строке. */}
              <IconBtn icon="close" tone="danger" size="sm" ariaLabel={t('telegram.unlink')} disabled={busyId === a.id} onClick={() => remove(a)} />
            </Card>
          ))}
          <Btn variant="secondary" icon="plus" onClick={openConnect}>
            {t('telegram.connect_another')}
          </Btn>
        </Col>
      )}
      <TelegramConnectDialog open={connectOpen} onOpenChange={setConnectOpen} tripId={tripId} onLinked={onLinked} />
    </>
  );
}

// ─── SettingsLens (main export) ───────────────────────────────────────────────

// Скелетон настроек — PURE, зеркалит РЕАЛЬНУЮ разметку экрана теми же классами:
// (1) карточка «General» = CardHeader + `.settings-identity` (пикер обложки
// слева | форма `__fields` справа), (2) «Optional features» = `.addon-grid` из
// тоггл-карточек, (3) `.settings-grid` в 2 колонки. Не сетка одинаковых карточек
// (то был «выдуманный» layout). Один источник для обеих фаз загрузки. TRIP-337.
//
// ★ КЛАССЫ БЕРЁМ НАСТОЯЩИЕ, А НЕ ПОХОЖИЕ ЧИСЛА. Кадр обложки держит `.tcp__hero`
// (это он знает про 4:3), ряд — `.carousel .tcp__strip` (он знает про зазор и
// прокрутку). Иначе скелетон приходится «подгонять» высотой в пикселях, и он
// расходится с экраном на первой же правке раскладки — ровно это и случилось:
// он остался с превью 150px и ряда из 16 кружков, которых на экране больше нет.
export function SettingsSkeleton() {
  return (
    <Col gap="g7" className="settings-lens" aria-busy="true">
      {/* 1. General: заголовок + Save + identity-grid (обложка | форма) */}
      <Card>
        <CardHeader title={<Skeleton w={120} h={22} r={6} />} action={<Skeleton w={130} h={40} r={'var(--r-btn)'} />} />
        <Grid className="settings-identity">
          <div className="col col--g6 tcp">
            <div className="tcp__hero"><Skeleton w="100%" h="100%" r={0} /></div>
            <div className="carousel tcp__strip">
              {/* Первая миниатюра шире — на экране так выглядит ВЫБРАННАЯ. */}
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} w={i === 0 ? 108 : 52} h={52} r={'var(--r-xs)'} />
              ))}
            </div>
          </div>
          <Col gap="g7" className="settings-identity__fields">
            {[0, 1].map((i) => (
              <div key={i} className="col col--g3">
                <Skeleton w="35%" h={13} r={5} />
                <Skeleton w="100%" h={44} r={'var(--r-btn)'} />
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

export default function SettingsLens({ tripId, trip, members = [], isPro, isProTrip, proResolved = true, queryClient, profiles = {}, isLoading = false }) {
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
  const [coverImageUrl, setCoverImageUrl] = useState(trip?.cover_image_url || '');
  const [currency, setCurrency] = useState(trip?.details?.main_currency || trip?.main_currency || 'EUR');
  const [saving,  setSaving]  = useState(false);
  // Which display/feature toggle is mid-flight (key string or feature id) — drives
  // the in-knob spinner and blocks re-entry. Toggles persist before they flip
  // (no optimism), so this is the only "in progress" signal the user gets.
  const [busyToggle, setBusyToggle] = useState(null);
  const { toast } = useToast();

  const hasPro = isPro; // trip-level Pro (owner sub OR is_pro_trip), passed from TripView
  // Право (editor) и владелец (owner) — из единого контекста доступа (TRIP-274
  // Ф2.2). isOwner гейтит owner-only управление (удалить трип) и режим апселла;
  // readOnly=не-editor даёт viewer'у Settings только на чтение (есть «Выйти»,
  // TRIP-137). Это UI-гейт; серверная защита — edge/RLS.
  const { canEdit, isOwner } = useTripAccess();
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
  const openUpgrade = () => goPro(nav, { tripId });

  // Seed local state when the trip first loads or when switching to a different
  // trip. Keyed on trip.id (NOT the trip object): react-query hands back a fresh
  // object on every background refetch / window-focus, and depending on the whole
  // object would wipe the user's in-progress title edit right before they save it.
  useEffect(() => {
    if (trip?.title)        setTitle(trip.title);
    setCoverImageUrl(trip?.cover_image_url || '');
    if (trip?.details?.main_currency || trip?.main_currency) setCurrency(trip.details?.main_currency || trip.main_currency || 'EUR');
    setFeatures(featuresFromTrip(trip));
    setBookingWarnings(trip?.details?.display?.booking_warnings !== false);
    setChatWidget(trip?.details?.display?.chat_widget !== false);
  }, [trip?.id]);

  // Dirty state for the identity block (title / currency / cover). Toggles below
  // auto-save on click, so the Save button only governs these manually-edited
  // fields and stays disabled until something changes. Обложка тоже ждёт кнопку:
  // пикер сообщает выбор, запись идёт отсюда.
  const persistedCurrency = trip?.details?.main_currency || trip?.main_currency || 'EUR';
  const dirty =
    title.trim()    !== (trip?.title || '') ||
    coverImageUrl   !== (trip?.cover_image_url || '') ||
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

  // Save identity settings: title, cover image and main currency. Обе колонки
  // в вайтлисте `trip-settings/settings`; валюта живёт в details.main_currency.
  // Обложки нет → cover_image_url=null → фоллбек-картинка. Запись ЧАСТИЧНАЯ:
  // отсутствующий ключ колонку не трогает, поэтому description/notes (их полей
  // в форме больше нет) сохраняются как есть, а не затираются.
  async function saveSettings() {
    if (!title.trim()) return;
    setSaving(true);
    const prevCurrency = trip?.details?.main_currency || trip?.main_currency || 'EUR';
    const prevCoverUrl = trip?.cover_image_url || '';
    const fields = {
      title: title.trim(),
      cover_image_url: coverImageUrl || null,
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
        cover_image_url: fields.cover_image_url,
        details: { ...(old.trip.details || {}), main_currency: currency } } } : old);
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    queryClient?.invalidateQueries({ queryKey: ['trip-content', tripId] });
    queryClient?.invalidateQueries({ queryKey: ['trips'] }); // trips list shows title + cover
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
      openProUpsell({ role: proRole(isOwner), source: 'feature', feature: feat ? t(feat.labelKey) : '', ownerName, onUpgrade: openUpgrade });
      return;
    }
    const newVal = !features[id];
    // TRIP-415: выключение Telegram-аддона снимает ВСЕ привязки чата на сервере
    // (teardown в шве trip-settings/settings). Если живые привязки есть — просим
    // подтверждение из канона ДС (тот же useConfirm, что у выхода из трипа), чтобы
    // отвязка не случилась молча. Проверяем ровно на пути выключения.
    if (feat.addon === 'telegram_assistant' && !newVal) {
      const { data } = await invokeFn('telegramGetIntegration', { body: { tripId } });
      if ((data?.integrations?.length ?? 0) > 0 && !(await confirm({
        title: t('settings.tg_addon_off_confirm_title'),
        description: t('settings.tg_addon_off_confirm_body'),
        variant: 'destructive',
      }))) return;
    }
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
        openProUpsell({ role: proRole(isOwner), source: 'feature', feature: feat ? t(feat.labelKey) : '', ownerName, onUpgrade: openUpgrade });
      } else {
        refusalToast(code);
      }
      setBusyToggle(null);
      return;
    }
    setFeatures(s => ({ ...s, [id]: newVal }));  // reflect only after server confirms
    patchAddons(nextAddons);                      // sync the shell cache (lenses/widget)
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    // Turning the Telegram addon OFF tears down every binding on the server
    // (afterWrite seam). Reconcile both Telegram projections so the account screen
    // does not keep showing a now-dead binding — the teardown is best-effort and is
    // not surfaced to the client, so we sync to server truth rather than trust it.
    if (feat.addon === 'telegram_assistant' && !newVal && queryClient) {
      invalidateTelegram(queryClient, tripId);
    }
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
      // Purge every cache keyed to the now-deleted trip. Without this the trips
      // list keeps the deleted card for its 30s staleTime window (a tap re-opens
      // /trip/<deleted> → getTripDetails 404), and the trip's own shell/content/
      // chat caches linger so a Back navigation re-renders then refetches a dead
      // id. removeQueries (not invalidate) — there is nothing to refetch for a
      // trip that no longer exists; invalidating would re-fire the 404.
      queryClient?.removeQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
      queryClient?.removeQueries({ queryKey: ['trip-content', tripId] });
      queryClient?.removeQueries({ queryKey: ['chat-id', tripId] });
      queryClient?.invalidateQueries({ queryKey: ['trips'] }); // list drops the card now, not in 30s
      track('trip_deleted', { trip_id: tripId });
      successToast(t, 'trip_deleted');
      nav('/trips');
    };

    // Ordinary trip → ONE confirm that runs the delete. Pro trip → the first
    // confirm only gates, then a SECOND Pro-specific confirm warns that the
    // one-time purchase burns and carries the spinner while the delete runs.
    // The 2nd dialog is keyed off is_pro_trip (a one-time purchase that burns on
    // delete), NOT the merged isPro flag: an account-level subscription survives
    // the trip being deleted, so it must NOT trigger the extra warning.
    const proceed = await confirm({
      title: t('confirm.delete_trip.title'),
      description: t('confirm.delete_trip.body'),
      variant: 'destructive',
      ...(isProTrip ? {} : { onConfirm: runDelete }),
    });
    if (!proceed) return;

    if (isProTrip) {
      await confirm({
        title: t('confirm.delete_pro_trip.title'),
        description: t('confirm.delete_pro_trip.body'),
        variant: 'destructive',
        onConfirm: runDelete,
      });
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
      {/* ── Identity: обложка + название + валюта ────────────────────────────
          Save here governs only these manually-edited fields; the feature and
          display toggles below auto-save on click. Описание и заметки убраны из
          формы (решение Pavel): колонки и их данные остаются, вайтлист двери
          тоже — запись частичная, поэтому мимо формы они не затираются. */}
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
        {/* Обложка — тот же пикер, что на шаге создания: кадр 4:3, свайп/стрелки
            листают саму картинку, лента миниатюр под ней. Своей подписи у него
            нет намеренно — картинка называет себя сама, а `<Field label>` над
            ней только добавил бы колонке высоты (поля справа ниже неё).
            `savedUrl` = что сохранено сейчас: по нему пикер при уходе с экрана
            подметает залитые, но не сохранённые байты. `disabled` нужен отдельно
            от <fieldset disabled>: нативную прокрутку ленты тот не выключает. */}
        <Grid className="settings-identity">
          <TripCoverPicker
            coverImageUrl={coverImageUrl}
            savedUrl={trip?.cover_image_url || ''}
            tripId={tripId}
            disabled={readOnly}
            onChange={({ cover_image_url }) => setCoverImageUrl(cover_image_url)}
          />
          <Col gap="g7" className="settings-identity__fields">
            <Field label={t('trip.title_label')}>
              <input className="input" value={title} onChange={e => setTitle(e.target.value)} />
            </Field>
            <Field label={t('settings.main_currency_label')} sub={t('settings.main_currency_hint')}>
              <CurrencyCombobox value={currency} onChange={setCurrency} />
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
            {/* Кнопка ведёт в апселл ОБОИХ: подпись разная (владелец улучшает,
                участник просит владельца), действие одно — модалка сама решит,
                что показать. Раньше владелец уходил в чекаут мимо неё. */}
            <Btn
              variant={isOwner ? 'primary' : 'secondary'}
              icon={isOwner ? undefined : 'lock'}
              iconRight={isOwner ? 'arrowR' : undefined}
              onClick={() => openProUpsell({ role: proRole(isOwner), source: 'menu', ownerName, onUpgrade: openUpgrade })}
            >
              {isOwner ? t('trip_menu.upgrade_trip') : t('trip.pro_by_owner')}
            </Btn>
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
