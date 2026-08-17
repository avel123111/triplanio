import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@/lib/ThemeContext';
import { useNotificationList, useUnreadNotificationCount, useNotificationActions } from '@/lib/useNotifications';
import { useAuth } from '@/lib/AuthContext';
import { useT, useI18nFormat } from '@/lib/i18n/I18nContext';
import { isProActive } from '@/lib/subscription';
import { Btn, Badge, Card, EmptyState, ListRow, NotifRow, PageHead, Seg, Skeleton, Tile } from '../design/index';
import AppHeader from '@/components/AppHeader';
import { buildNotifView } from '@/components/notifications/notifView';
import { useQueryGate } from '@/lib/useQueryGate';
import { gateStubProps } from '@/lib/loadStateClassify';
import { SystemStub } from '@/lib/PageNotFound';

function dateGroup(iso) {
  if (!iso) return 'earlier';
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startYest = new Date(startToday); startYest.setDate(startYest.getDate() - 1);
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 7);
  if (d >= startToday) return 'today';
  if (d >= startYest) return 'yesterday';
  if (d >= startWeek) return 'week';
  return 'earlier';
}
const GROUP_ORDER = ['today', 'yesterday', 'week', 'earlier'];
const GROUP_LABEL_KEY = { today: 'common.today', yesterday: 'common.yesterday', week: 'notif.this_week', earlier: 'notif.earlier' };

export default function Inbox() {
  const nav = useNavigate();
  const { user } = useAuth();
  const t = useT();
  const { fmtRelative } = useI18nFormat();
  const isPro = isProActive(user);
  const { isDark, toggle: toggleTheme } = useTheme();

  const [filter, setFilter] = useState('all');

  // Shared seam (src/lib/useNotifications.js) — the same single list the bell
  // renders the head of.
  const {
    data: notifications = [], isLoading,
    error: notifError, isPending: notifPending, fetchStatus: notifFetchStatus, refetch: refetchNotifs,
  } = useNotificationList();
  const { markAllRead, markOneRead, respondInvite } = useNotificationActions();

  const unreadCount = useUnreadNotificationCount();
  const inviteCount = notifications.filter(n => n.type === 'trip_invite').length;

  const filtered = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    if (filter === 'invites') return n.type === 'trip_invite';
    return true;
  });

  // Group by date bucket, keeping order.
  const groups = GROUP_ORDER
    .map(label => ({ label, items: filtered.filter(n => dateGroup(n.created_at) === label) }))
    .filter(g => g.items.length > 0);

  const TABS = [
    ['all', t('notif.all'), 0],
    ['unread', t('notif.unread'), unreadCount],
    ['invites', t('notif.invitations'), inviteCount],
  ];

  // ── Load gate (TRIP-208) ──────────────────────────────────────────────────────
  // A failed notifications load must surface an error + retry, not silently render
  // the "inbox empty" screen. Cached list wins (hasData) — a background refetch
  // error never blanks an already-shown inbox.
  // Collection: empty = "nothing yet" via useQueryGate's fail-safe default; a
  // real load failure still gates via the thrown-error path below (TRIP-220).
  const inboxGate = useQueryGate(
    { isPending: notifPending, fetchStatus: notifFetchStatus, error: notifError },
    notifications.length > 0,
  );
  if (inboxGate === 'temporary' || inboxGate === 'access' || inboxGate === 'not_found') {
    const stub = gateStubProps(inboxGate);
    const isTemporary = inboxGate === 'temporary';
    return (
      <div className="app-shell">
        <SystemStub
          icon={stub.icon}
          tone={stub.tone}
          title={t(stub.title)}
          body={t(stub.body)}
          primary={isTemporary
            ? { label: t('sys.retry'), onClick: () => refetchNotifs() }
            : { label: t('sys.to_my_trips'), onClick: () => nav('/trips') }}
          secondary={isTemporary ? { label: t('sys.to_my_trips'), onClick: () => nav('/trips') } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <AppHeader
        user={user}
        isPro={isPro}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onBack={() => nav('/trips')}
        backTitle={t('telegram.go_to_trips')}
        title={t('notif.inbox_title')}
      />

      <main className="ov-anim page-main">
        <PageHead
          title={t('notif.inbox_title')}
          actions={notifications.length > 0 && unreadCount > 0 && (
            <Btn variant="link" onClick={() => markAllRead.mutate()}>{t('notif.mark_all_read')}</Btn>
          )}
        />

        {/* Фильтр + содержимое — одна колонка с шагом (был margin-класс .nfilters). */}
        <div className="col col--g8">
          {notifications.length > 0 && (
            // `.row` — чтобы Seg (inline-flex) сжался по контенту слева, а не
            // растянулся на всю ширину колонки (`.col` тянет прямых детей).
            <div className="row">
              <Seg
                value={filter}
                onChange={setFilter}
                ariaLabel={t('notif.title')}
                options={TABS.map(([k, l, c]) => ({ value: k, label: c > 0 ? <>{l} <b>{c}</b></> : l }))}
              />
            </div>
          )}

          {isLoading ? (
            <div className="col">
              {[1, 2, 3, 4].map(i => <Skeleton key={i} w="100%" h={64} r={'var(--r-sm)'} />)}
            </div>
          ) : notifications.length === 0 ? (
            <InboxEmpty onCollection={() => nav('/trips')} />
          ) : filtered.length === 0 ? (
            <EmptyState icon="bell" title={t('notif.filter_empty')} />
          ) : (
            <div className="col col--g8">
              {groups.map((g) => (
              <div key={g.label} className="col col--g4">
                <div className="ngrp__label">{t(GROUP_LABEL_KEY[g.label])}</div>
                {/* Дата-группа — ОДНА карточка-поверхность, строки вплотную с
                    хайрлайнами; прочитанная строка на цвете карточки, непрочитанная
                    — мягкая подложка поверх. */}
                <Card pad="none" radius="md">
                  {g.items.map((n) => (
                    <InboxRow
                      key={n.id}
                      n={n}
                      t={t}
                      nav={nav}
                      fmtRelative={fmtRelative}
                      pendingAction={respondInvite.isPending && respondInvite.variables?.memberId === n.trip_member_id ? respondInvite.variables.action : null}
                      onRespond={(action) => {
                        if (!n.read) markOneRead.mutate(n.id);
                        respondInvite.mutate({ memberId: n.trip_member_id, tripId: n.trip_id, action });
                      }}
                      onMarkRead={() => { if (!n.read) markOneRead.mutate(n.id); }}
                    />
                  ))}
                </Card>
              </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function InboxEmpty({ onCollection }) {
  const t = useT();
  // «Что здесь появится» — канон `<ListRow variant="divider">` (плитка-иконка +
  // заголовок + подпись, хайрлайн между строками, последняя без него — сам
  // вариант). Никакого своего скина: строки, отступы и текст несут примитивы ДС
  // (`ListRow`/`Tile`), все они есть на витрине `/kit`.
  const rows = [
    { icon: 'users', title: t('notif.invitations'), sub: t('notif.invitations_desc') },
    { icon: 'refresh', title: t('notif.updates'), sub: t('notif.updates_desc') },
    { icon: 'file', title: t('notif.whats_new'), sub: t('notif.whats_new_desc') },
  ];
  return (
    <EmptyState
      icon="bell"
      title={t('notif.inbox_empty')}
      body={t('notif.inbox_empty_lead')}
      action={
        <div className="col col--g6 grow--fit">
          <div>
            {rows.map((r) => (
              <ListRow key={r.icon} variant="divider" lead={<Tile icon={r.icon} />} title={r.title} sub={r.sub} />
            ))}
          </div>
          <Btn variant="primary" icon="plus" block onClick={onCollection}>{t('notif.to_collection')}</Btn>
        </div>
      }
    />
  );
}

// Строка экрана = канон `<NotifRow>` (полноразмерный) + слоты действий. Резолв —
// тот же `buildNotifView`, что у поповера: одна строка, две поверхности.
function InboxRow({ n, t, nav, fmtRelative, pendingAction, onRespond, onMarkRead }) {
  // Invite status comes with the row now (getInbox joins trip_members) — no
  // per-row `.from('trip_members')` waterfall (TRIP-408).
  const memberStatus = n.member_status;
  const { glyph, isInvite, titleNode, messageText, messageNode } = buildNotifView(n, t, { deletedLabel: t('common.deleted_user') });
  const showPending = isInvite && memberStatus === 'pending';
  const showLink = n.trip_id && (memberStatus === 'active' || n.type !== 'trip_invite');
  const status = isInvite && memberStatus === 'active'
    ? <Badge variant="success" icon="check">{t('notif.accepted')}</Badge>
    : isInvite && memberStatus === 'declined'
      ? <Badge variant="quiet">{t('notif.declined')}</Badge>
      : null;
  const hasActions = showPending || status || showLink;

  const actions = hasActions ? (
    <>
      {showPending && (
        <>
          <Btn variant="primary" icon="check" loading={pendingAction === 'accept'} disabled={!!pendingAction} onClick={() => onRespond('accept')}>{t('notif.accept')}</Btn>
          <Btn variant="secondary" loading={pendingAction === 'decline'} disabled={!!pendingAction} onClick={() => onRespond('decline')}>{t('notif.decline')}</Btn>
        </>
      )}
      {status}
      {showLink && (
        <Btn variant="link" icon="pin" onClick={() => nav(`/trip/${n.trip_id}`)}>{t('notif.view_trip')}</Btn>
      )}
    </>
  ) : null;

  return (
    <NotifRow
      glyph={glyph}
      unread={!n.read}
      title={titleNode}
      message={messageText ? messageNode : null}
      time={fmtRelative(n.created_at)}
      actions={actions}
      onClick={() => { if (!n.read) onMarkRead?.(); }}
    />
  );
}
