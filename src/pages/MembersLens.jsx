// @ts-check
/**
 * MembersLens - members tab inside TripView.
 *
 * Props: tripId, members, profiles, trip, user, isLoading
 *
 * members - trip_members rows from getTripDetails (include: ['content'])
 *   columns: id, trip_id, user_id, invite_email, user_full_name, role, status, invite_token, ...
 * profiles - id → { full_name, avatar_url, … } from the SAME payload, so names
 *   land with the rows; covers the owner, who has no trip_members row (TRIP-230)
 */
import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { track } from '@/lib/analytics';
import { withViralMarks } from '@/lib/viralLink';
import { classifyError } from '@/lib/errorText';
import { invokeFn } from '@/lib/invokeFn';
import { tripContentBinding, formWrite, reconcileWriteRow } from '@/lib/trip-data';
import { refusalError } from '@/lib/refusalError';
import { resolveAuthor } from '@/lib/resolveAuthor';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Dialog, IconBtn, EmptyState, Field, Input, RoleBadge, Seg, Severity, Skeleton, Textarea, ActionMenu, Tile, useToast } from '../design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
import { withOwnerRow } from '@/lib/members';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { useIsPhone } from '@/hooks/use-mobile';
import { FieldError, IssuesPanel, fieldState, useHybridValidation } from '@/components/common/ValidationUI';
import { useTripAccess } from '@/components/trips/TripAccessContext';

// ─── role helpers ─────────────────────────────────────────────────────────────
// Real roles are owner / admin / viewer. owner is assigned only at creation and
// is never selectable here. There is no "editor" role on the backend.

// Status column. Active members show no status text (the role badge already
// conveys they're in the trip). Offline placeholders show nothing here (the
// "Офлайн" badge sits in the role column). Only pending and declined invites
// carry a status pill.
function StatusDot({ status }) {
  const { t } = useI18n();
  if (status === 'pending') return <span className="m-status m-status--pending">{t('member.status_pending')}</span>;
  if (status === 'declined') return <span className="m-status m-status--declined">{t('member.status_declined')}</span>;
  return null;
}

// ─── InviteDialog ─────────────────────────────────────────────────────────────

const ROLES = [
  { value: 'admin',  labelKey: 'member.role_admin_desc' },
  { value: 'viewer', labelKey: 'member.role_viewer_desc' },
];

/** @param {{ tripId: any, promoteMember?: any, open: boolean, onOpenChange?: any }} p */
export function InviteDialog({ tripId, promoteMember, open, onOpenChange }) {
  const isMobile = useIsPhone();
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);
  const [tab, setTab] = useState('email');
  const [role, setRole] = useState('viewer');
  const [copied, setCopied] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkErr, setLinkErr] = useState('');
  const [email, setEmail] = useState('');
  const [offlineName, setOfflineName] = useState('');
  const [message, setMessage] = useState('');
  const [err, setErr] = useState('');
  const v = useHybridValidation('invite', tab === 'offline' ? { mode: 'offline', name: offlineName } : tab === 'email' ? { mode: 'email', email } : { mode: 'link' });
  const st = (f) => fieldState(v.displayIssues, f);

  const qc = useQueryClient();
  const membersBinding = tripContentBinding(qc, tripId, 'members');
  // Both writes route a member refusal (code) to the same inline field text.
  const showErr = (/** @type {any} */ e) => setErr(classifyError(t, e?.code).text);
  // Invite / add-offline on the shared form path: button spinner, close on success,
  // reconcile the returned member row into the members slice (invite unwraps the
  // .member row; a reactivated declined invite upserts in place). Member refusals
  // (ALREADY_MEMBER / INVITE_SELF / INVITE_OWNER …) arrive as codes → inline text.
  const inviteMut = useMutation({
    mutationFn: async () => {
      setErr('');
      const { data, error, code } = await invokeFn('trip-member/invite', { body: { trip_id: tripId, email: email.trim().toLowerCase(), role } });
      if (error || data?.error) throw refusalError(code);
      // Promoting an offline placeholder → drop it now that a real invite exists.
      if (promoteMember?.id) await invokeFn('trip-member/remove', { body: { id: promoteMember.id, trip_id: tripId } });
      return data; // the invited / reactivated member row
    },
    ...formWrite({
      reconcile: (/** @type {any} */ data) => {
        reconcileWriteRow(membersBinding, 'add', data);
        if (promoteMember?.id) membersBinding.remove(promoteMember.id);
      },
      onDone: () => { track('email_invited', { role, trip_id: tripId }); successToast(t, 'invite_sent'); close(); },
      onFail: showErr,
    }),
  });
  const offlineMut = useMutation({
    mutationFn: async () => {
      setErr('');
      const { data, error, code } = await invokeFn('trip-member/add-offline', { body: { trip_id: tripId, user_full_name: offlineName.trim() } });
      if (error || data?.error) throw refusalError(code);
      return data;
    },
    ...formWrite({
      reconcile: (/** @type {any} */ data) => reconcileWriteRow(membersBinding, 'add', data),
      onDone: () => { track('member_invited', { role: 'offline', trip_id: tripId }); successToast(t, 'member_added'); close(); },
      onFail: showErr,
    }),
  });

  // Generate (or reuse) a real invite link when the "link" tab is active.
  // The role is bound to the token server-side, so switching role re-fetches.
  useEffect(() => {
    if (!open || tab !== 'link' || !tripId) return;
    let cancelled = false;
    setLinkLoading(true);
    setLinkErr('');
    setLinkUrl('');
    invokeFn('trip-invite-link/create', { body: { trip_id: tripId, role } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || data?.error || !data?.token) { setLinkErr(t('trip.link_error')); return; }
        // location.origin, not a constant: the campaign mark is stored per host,
        // so the link must point at the host it was copied from.
        setLinkUrl(withViralMarks(`${window.location.origin}/join/${data.token}`, 'invite_link', tripId));
      })
      .catch(() => { if (!cancelled) setLinkErr(t('trip.link_error')); })
      .finally(() => { if (!cancelled) setLinkLoading(false); });
    return () => { cancelled = true; };
  }, [open, tab, role, tripId, t]);

  function copyLink() {
    if (!linkUrl) return;
    track('link_invited', { role, trip_id: tripId });
    navigator.clipboard?.writeText(linkUrl).then(() => {
      setCopied(true);
      successToast(t, 'link_copied');
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog title={t('member.invite_to_trip')} icon="users" size="" open={open} onOpenChange={onOpenChange}
      foot={<>
        <Btn variant="secondary" onClick={close}>{t('common.close')}</Btn>
        {tab === 'email' && <Btn variant="primary" icon="send" loading={inviteMut.isPending} onClick={() => v.attemptSubmit(() => inviteMut.mutate())} aria-disabled={!v.canSubmit}>{t('members.send_invite')}</Btn>}
        {tab === 'offline' && <Btn variant="primary" icon="user" loading={offlineMut.isPending} onClick={() => v.attemptSubmit(() => offlineMut.mutate())} aria-disabled={!v.canSubmit}>{t('members.add')}</Btn>}
      </>}>
      <Seg
        variant="fill"
        style={{ marginBottom: 14 }}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'email', label: <><Icon name="send" size={12} />{t('member.tab_email')}</> },
          { value: 'link', label: <><Icon name="link" size={12} />{t('trip.copy_link')}</> },
          { value: 'offline', label: <><Icon name="user" size={12} />{t('trip.member_offline')}</> },
        ]}
      />

      {tab !== 'offline' && (
        <Field label={t('member.invitee_role')}>
          <Seg
            variant="fill"
            value={role}
            onChange={setRole}
            options={[['viewer', t('trips.role_viewer'), t('member.role_viewer_short')], ['admin', t('trips.role_admin'), t('member.role_admin_short')]].map(([k, lab, sub]) => ({
              value: k,
              label: <span className="col" style={{ gap: 0, alignItems: 'center' }}><span className="t-label">{lab}</span><span className="muted t-meta">{sub}</span></span>,
            }))}
          />
        </Field>
      )}

      {tab !== 'offline' && <hr className="hr" style={{ margin: '16px 0' }} />}
      {tab === 'offline' && <div style={{ marginTop: 4 }} />}

      {tab === 'email' && <>
        <Field label="E-mail" required={v.isRequired('email')}>
          <div data-vfield="email">
            <Input {...st('email')} type="email" value={email} onChange={e => { setEmail(e.target.value); v.markTouched('email'); }} placeholder="name@example.com" autoFocus={!isMobile} />
          </div>
          <FieldError issues={v.displayIssues} field="email" />
        </Field>
        <Field label={t('member.message_label')} hint={t('member.message_hint')}>
          <Textarea value={message} onChange={e => setMessage(e.target.value)} placeholder={t('member.message_ph')} rows={3} />
        </Field>
        <div className="muted t-meta" style={{ marginTop: 6 }}>
          {t('member.invite_email_note')}
        </div>
      </>}

      {tab === 'link' && <>
        <Field label={t('member.invite_link_label')}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input mono" value={linkLoading ? '' : linkUrl}
              placeholder={linkLoading ? t('share.generating') : ''}
              readOnly style={{ flex: 1 }}
              onClick={(e) => e.currentTarget.select()} />
            <Btn variant="primary" icon="copy" loading={linkLoading} onClick={copyLink} disabled={!linkUrl}>
              {linkLoading ? t('share.generating') : (copied ? t('common.copied') : t('share.copy'))}
            </Btn>
          </div>
          {linkErr && <div style={{ marginTop: 8 }}><Severity level="error">{linkErr}</Severity></div>}
        </Field>
        <div className="muted t-meta" style={{ marginTop: 8 }}>
          {t('member.invite_link_note')}
        </div>
      </>}

      {tab === 'offline' && <>
        <Field label={t('members.offline_name')} hint={t('member.offline_name_hint')} required={v.isRequired('name')}>
          <div data-vfield="name">
            <Input {...st('name')} value={offlineName} onChange={e => { setOfflineName(e.target.value); v.markTouched('name'); }} placeholder={t('member.offline_name_ph')} autoFocus={!isMobile} />
          </div>
          <FieldError issues={v.displayIssues} field="name" />
        </Field>
        <div className="muted t-meta" style={{ marginTop: 8 }}>
          {t('member.offline_note')}
        </div>
      </>}

      <IssuesPanel issues={v.panelIssues} style={{ marginTop: 12 }} />
      {err && <div style={{ marginTop: 10 }}><Severity level="error">{err}</Severity></div>}
    </Dialog>
  );
}

// ─── ChangeRoleDialog ─────────────────────────────────────────────────────────

// `name` is the identity ALREADY resolved for the row this dialog was opened
// from; the dialog must not re-derive it (TRIP-334).
function ChangeRoleDialog({ member, name, tripId, open, onOpenChange }) {
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);
  const [role, setRole] = useState(member.role || 'viewer');
  const [err, setErr] = useState('');

  const qc = useQueryClient();
  // Same form path: button spinner, close on success, reconcile the returned member
  // row (its new role) into the members slice — no full-trip refetch.
  const roleMut = useMutation({
    mutationFn: async () => {
      setErr('');
      const { data, error, code } = await invokeFn('trip-member/role', { body: { id: member.id, trip_id: tripId, role } });
      if (error || data?.error) throw refusalError(code);
      return data;
    },
    ...formWrite({
      reconcile: (/** @type {any} */ data) => reconcileWriteRow(tripContentBinding(qc, tripId, 'members'), 'update', data),
      onDone: () => { successToast(t, 'role_updated'); close(); },
      onFail: (/** @type {any} */ e) => setErr(classifyError(t, e?.code).text),
    }),
  });

  return (
    <Dialog title={t('members.change_role')} icon="edit" size="sm" open={open} onOpenChange={onOpenChange}
      foot={<>
        <Btn variant="secondary" onClick={close} disabled={roleMut.isPending}>{t('trip.form_cancel')}</Btn>
        <Btn variant="primary" loading={roleMut.isPending} onClick={() => roleMut.mutate()}>{t('trip.form_save')}</Btn>
      </>}>
      <div className="t-body" style={{ marginBottom: 14, color: 'var(--muted)' }}>
        {name}
      </div>
      <Field label={t('member.role_label')}>
        <select className="select" value={role} onChange={e => setRole(e.target.value)}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{t(r.labelKey)}</option>)}
        </select>
      </Field>
      {err && <div style={{ marginTop: 10 }}><Severity level="error">{err}</Severity></div>}
    </Dialog>
  );
}

// ─── MembersLens ──────────────────────────────────────────────────────────────

// Скелетон участников — PURE, зеркалит реальный layout: `.mlist` со строками
// `.mbrow` (аватар + имя/роль + действие), а не три генерик-полосы. Один источник
// для обеих фаз загрузки (shell в TripView.LoadingBody и content). TRIP-337.
export function MembersSkeleton() {
  return (
    <div className="mlist col col--g4 ov-anim" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="mbrow">
          <Skeleton w={38} h={38} r="50%" style={{ flex: 'none' }} />
          <div className="grow col col--g2">
            <Skeleton w="45%" h={14} r={5} />
            <Skeleton w="30%" h={11} r={5} />
          </div>
          <Skeleton w={72} h={26} r="var(--r-pill)" style={{ flex: 'none' }} />
        </div>
      ))}
    </div>
  );
}

export default function MembersLens({ tripId, members = [], profiles = {}, trip, user, isLoading }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { toast } = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [promoteState, setPromoteState] = useState(null); // null | { member }
  const [roleState, setRoleState] = useState(null); // null | { member }

  // Управление участниками — ступень editor из единого контекста (TRIP-274 Ф2.2).
  const { canEdit: canManage } = useTripAccess();

  // Members live only in the CONTENT cache (header avatars / chat / access all read
  // contentData.members) — one slice, so one binding, like budget/documents.
  const membersBinding = tripContentBinding(qc, tripId, 'members');

  // Resend fires from the row's "…" menu, which closes on select — a menu item
  // can't host a spinner, so the row shows the busy state (mbrow--busy) instead.
  async function resend(memberId) {
    setRemoving(memberId);
    const { data, error, code } = await invokeFn('trip-member/resend', { body: { id: memberId, trip_id: tripId } });
    setRemoving(null);
    if (error || data?.error) { toast({ description: classifyError(t, code).text, variant: 'destructive' }); return; }
    successToast(t, 'invite_resent');
  }

  // Re-invite a member who declined: restart the invite flow on the SAME row.
  // The invite action (trip-member/invite) resets a declined row back to pending
  // and re-sends the notification + email (reusing the existing role).
  async function reinvite(member) {
    setRemoving(member.id);
    const { data, error, code } = await invokeFn('trip-member/invite', {
      body: { trip_id: tripId, email: member.invite_email, role: member.role || 'viewer' },
    });
    setRemoving(null);
    if (error || data?.error) { toast({ description: classifyError(t, code).text, variant: 'destructive' }); return; }
    // The declined row is reactivated to pending — upsert the returned member row in
    // place (swap dedups by id), no full-trip refetch.
    reconcileWriteRow(membersBinding, 'add', data);
    successToast(t, 'invite_resent');
  }

  // Remove — PESSIMISTIC (async-confirm, same shape as leaveTrip below): the confirm
  // button spins while trip-member/remove runs, and only ON THE RESPONSE does the row
  // drop from the cache and the toast fire — together. Removing a member is a real
  // server teardown (personal-docs + FK cleanup), so the UI confirms once it landed,
  // not at T0. On refusal: error toast, the row stays.
  function removeMember(memberId, status) {
    confirm({
      title: t('members.remove'),
      description: t('member.remove_confirm'),
      variant: 'destructive',
      onConfirm: async () => {
        const { error, code } = await invokeFn('trip-member/remove', { body: { id: memberId, trip_id: tripId } });
        if (error) { toast({ description: classifyError(t, code).text, variant: 'destructive' }); return; }
        membersBinding.remove(memberId);
        successToast(t, status === 'pending' ? 'invite_revoked' : 'member_removed');
      },
    });
  }

  // Leaving the trip = self-removal via trip-member-self/leave (a member removes
  // their own row). Once gone the user loses access, so navigate back to the
  // trips collection rather than refreshing the now-forbidden lens.
  async function leaveTrip(member) {
    await confirm({
      title: t('settings.leave_confirm'),
      description: t('confirm.leave_trip.body'),
      variant: 'destructive',
      onConfirm: async () => {
        const { error, code } = await invokeFn('trip-member-self/leave', { body: { id: member.id, trip_id: tripId } });
        if (error) { toast({ description: classifyError(t, code).text, variant: 'destructive' }); return; }
        successToast(t, 'trip_left');
        nav('/trips');
      },
    });
  }

  // Invite lives inline in the body (the "invite more" banner at the end of the
  // member list), so the removed per-screen bar's invite button — which merely
  // duplicated it — needed no replacement.

  if (isLoading) return <MembersSkeleton />;

  // Shared owner rule (withOwnerRow): the creator is never a real trip_members
  // row — ownership lives in trips.created_by. Drop any stray member row for the
  // creator (e.g. an invited+accepted owner from before the guard) and prepend a
  // single synthetic owner. Don't seed user_full_name with the email — leave it
  // empty so the profile resolver (or the auth user's own name when they are the
  // owner) wins the fallback (TRIP-143).
  const ownerId = trip?.created_by || '';
  const isMeOwner = !!user?.id && ownerId === user.id;
  const allMembers = withOwnerRow(members, ownerId, {
    trip_id: tripId,
    user_full_name: isMeOwner ? (user?.full_name || '') : '',
  });

  return (
    <>
      <div className="mlist col col--g4 ov-anim">
        {allMembers.length === 0 && (
          <EmptyState icon="users" title={t('member.empty')} />
        )}
        {allMembers.map((m, i) => {
          const isOwner = m.role === 'owner';
          const isSelf = !!m.user_id && m.user_id === user?.id;
          // Actions sit next to every row except the owner's: your own row gets
          // "Leave trip"; other rows get state-appropriate management actions
          // when you're an owner/admin.
          const canActOnRow = !isOwner && (isSelf || canManage);
          // Busy row = a resend/reinvite in flight (`removing`) → mbrow--busy skin.
          // (Remove is instant: the row is gone at T0, so it needs no busy state.)
          const isRemoving = removing === m.id;
          // Identity (name / email line / avatar / anonymized label) comes from
          // the SHARED resolver chat and documents already use (TRIP-334). The
          // payload now carries a profile for every row it ships, so a row that
          // still resolves to nothing means the users row is gone for good —
          // hence the deleted label as the fallback rather than a "?".
          const who = resolveAuthor({
            userId: m.user_id,
            nameSnapshot: m.user_full_name,
            member: m,
            profiles,
            selfUser: user,
            deletedLabel: t('common.deleted_user'),
            fallback: t('common.deleted_user'),
          });

          return (
            <div key={m.id || i} className={`mbrow${isRemoving ? ' mbrow--busy' : ''}`}>
              <Avatar name={who.name} photo={who.photo || ''} deleted={who.deleted} seed={who.seed} size="lg" />
              <div className="mbrow__id">
                <div className="mbrow__name row row--g4">
                  {who.name}
                  {m.user_id === user?.id && <Badge variant="quiet">{t('member.you_self')}</Badge>}
                </div>
                {who.email && (
                  <div className="mbrow__email">{who.email}</div>
                )}
              </div>

              <div className="mbrow__meta row row--g6">
                {m.status === 'offline'
                  ? <Badge variant="quiet" size="tiny">{t('trip.member_offline')}</Badge>
                  : <RoleBadge role={m.role} />}
                <StatusDot status={m.status} />
              </div>

              {/* Actions */}
              <div className="mbrow__acts">
                {m.status === 'offline' && canManage && (
                  <Btn variant="secondary" icon="send"
                    onClick={() => setPromoteState({ member: m })}>
                    {t('members.invite')}
                  </Btn>
                )}
                {canActOnRow && (
                  <ActionMenu
                    align="end"
                    width={220}
                    title={t('member.actions')}
                    /* ★TRIP-344: инлайн из четырёх объявлений умер целиком —
                       сторона 30px была третьей мимо обеих ступеней, а `color`
                       и прозрачная рамка ПОВТОРЯЛИ то, что база `.icon-btn` и
                       так объявляет. Повторённый рядом с классом инлайн — это
                       признак сломанного класса, а не образец для копирования.
                       Кнопка служит триггером Radix, поэтому примитив обязан
                       пробрасывать ref и остаток пропов (см. IconBtn). */
                    trigger={
                      <IconBtn
                        icon="more"
                        size="sm"
                        title={t('member.actions')}
                        ariaLabel={t('member.actions')}
                      />
                    }
                    items={isSelf
                      // Your own row: the only self-action is leaving the trip.
                      ? [{ icon: 'arrow', label: t('members.leave'), danger: true, onSelect: () => leaveTrip(m) }]
                      : [
                          m.status === 'pending' && { icon: 'send', label: t('members.resend'), onSelect: () => resend(m.id) },
                          m.status === 'declined' && { icon: 'send', label: t('member.invite_again'), onSelect: () => reinvite(m) },
                          m.status === 'active' && { icon: 'edit', label: t('members.change_role'), onSelect: () => setRoleState({ member: m, name: who.name }) },
                          { icon: 'trash', label: m.status === 'pending' ? t('member.cancel_invite') : t('members.remove'), danger: true, onSelect: () => removeMember(m.id, m.status) },
                        ]
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Invite banner */}
      {canManage && (
        <div className="row row--wrap invite-banner">
          <Tile as="div" className="invite-banner__ic">
            <Icon name="users" size={20} />
          </Tile>
          <div className="invite-banner__txt">
            <div className="invite-banner__title">{t('member.invite_more_title')}</div>
            <div className="invite-banner__desc">{t('member.invite_more_desc')}</div>
          </div>
          <Btn variant="primary" icon="plus" onClick={() => setInviteOpen(true)}>{t('members.invite')}</Btn>
        </div>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} tripId={tripId} />
      {promoteState && <InviteDialog open={!!promoteState} onOpenChange={(o) => { if (!o) setPromoteState(null); }} tripId={tripId} promoteMember={promoteState.member} />}
      {roleState && <ChangeRoleDialog open={!!roleState} onOpenChange={(o) => { if (!o) setRoleState(null); }} member={roleState.member} name={roleState.name} tripId={tripId} />}
    </>
  );
}
