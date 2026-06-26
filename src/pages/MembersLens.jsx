/**
 * MembersLens - members tab inside TripView.
 *
 * Props: tripId, members, trip, user, role, isLoading, queryClient
 *
 * members - trip_members rows from getTripDetails (include: ['content'])
 *   columns: id, trip_id, user_id, invite_email, user_full_name, role, status, invite_token, ...
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { displayName } from '@/lib/displayName';
import { Icon } from '../design/icons';
import { Avatar, Badge, Btn, Dialog, EmptyState, Field, Severity, Skeleton } from '../design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import { edgeErrorMessage } from '@/lib/edgeError';
import { useConfirm } from '@/components/common/ConfirmProvider';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/components/ui/use-toast';
import { FieldError, IssuesPanel, fieldHasError, useHybridValidation } from '@/components/common/ValidationUI';

// ─── role helpers ─────────────────────────────────────────────────────────────
// Real roles are owner / admin / viewer. owner is assigned only at creation and
// is never selectable here. There is no "editor" role on the backend.

// Role badge colours unified with the Overview "who's going" card
// (MembersSummaryCard): owner=warning, admin=brand, viewer=outline.
function RoleBadge({ role }) {
  const { t } = useI18n();
  if (role === 'owner') return <Badge variant="warning">{t('members.role_owner')}</Badge>;
  if (role === 'admin') return <Badge variant="brand">{t('trips.role_admin')}</Badge>;
  return <Badge variant="outline" icon="eye">{t('trips.role_viewer')}</Badge>;
}

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

export function InviteDialog({ tripId, onSaved, promoteMember, open, onOpenChange }) {
  const isMobile = useIsMobile();
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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const v = useHybridValidation('invite', tab === 'offline' ? { mode: 'offline', name: offlineName } : tab === 'email' ? { mode: 'email', email } : { mode: 'link' });
  const inv = (f) => (fieldHasError(v.displayIssues, f) ? 'tv-invalid' : '');

  // Generate (or reuse) a real invite link when the "link" tab is active.
  // The role is bound to the token server-side, so switching role re-fetches.
  useEffect(() => {
    if (!open || tab !== 'link' || !tripId) return;
    let cancelled = false;
    setLinkLoading(true);
    setLinkErr('');
    setLinkUrl('');
    supabase.functions.invoke('createTripInviteLink', { body: { trip_id: tripId, role } })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || data?.error || !data?.token) { setLinkErr(t('trip.link_error')); return; }
        setLinkUrl(`${window.location.origin}/join/${data.token}`);
      })
      .catch(() => { if (!cancelled) setLinkErr(t('trip.link_error')); })
      .finally(() => { if (!cancelled) setLinkLoading(false); });
    return () => { cancelled = true; };
  }, [open, tab, role, tripId, t]);

  function copyLink() {
    if (!linkUrl) return;
    navigator.clipboard?.writeText(linkUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  async function inviteByEmail() {
    const trimmed = email.trim().toLowerCase();
    setSaving(true);
    setErr('');
    const { data, error } = await supabase.functions.invoke('inviteTripMember', {
      body: { trip_id: tripId, email: trimmed, role },
    });
    setSaving(false);
    if (error || data?.error) { setErr(await edgeErrorMessage(error, data, t('members.error_generic'))); return; }
    // Promoting an offline placeholder → remove it now that a real invite exists.
    if (promoteMember?.id) {
      await supabase.functions.invoke('removeTripMember', { body: { member_id: promoteMember.id } });
    }
    onSaved?.();
    close();
  }

  async function addOffline() {
    const name = offlineName.trim();
    setSaving(true);
    setErr('');
    const { data, error } = await supabase.functions.invoke('addOfflineTripMember', {
      body: { tripId, name },
    });
    setSaving(false);
    if (error || data?.error) { setErr((data?.error || error?.message) || t('members.error_generic')); return; }
    onSaved?.();
    close();
  }

  return (
    <Dialog title={t('member.invite_to_trip')} icon="users" size="" open={open} onOpenChange={onOpenChange}
      foot={<>
        <Btn variant="ghost" onClick={close}>{t('common.close')}</Btn>
        {tab === 'email' && <Btn variant="primary" icon="send" onClick={() => v.attemptSubmit(inviteByEmail)} disabled={saving} aria-disabled={!v.canSubmit}>{saving ? t('member.sending') : t('members.send_invite')}</Btn>}
        {tab === 'offline' && <Btn variant="primary" icon="user" onClick={() => v.attemptSubmit(addOffline)} disabled={saving} aria-disabled={!v.canSubmit}>{saving ? t('member.adding') : t('members.add')}</Btn>}
      </>}>
      <div className="tweaks__seg" style={{ marginBottom: 14, display: 'flex' }}>
        <button className={tab === 'email' ? 'active' : ''} onClick={() => setTab('email')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Icon name="send" size={12} />{t('member.tab_email')}
        </button>
        <button className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Icon name="link" size={12} />{t('trip.copy_link')}
        </button>
        <button className={tab === 'offline' ? 'active' : ''} onClick={() => setTab('offline')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <Icon name="user" size={12} />{t('trip.member_offline')}
        </button>
      </div>

      {tab !== 'offline' && (
        <Field label={t('member.invitee_role')}>
          <div className="tweaks__seg" style={{ display: 'flex' }}>
            {[['viewer', t('trips.role_viewer'), t('member.role_viewer_short')], ['admin', t('trips.role_admin'), t('member.role_admin_short')]].map(([k, lab, sub]) =>
              <button key={k} className={role === k ? 'active' : ''} onClick={() => setRole(k)}
                style={{ flex: 1, flexDirection: 'column', gap: 0, padding: '8px 10px' }}>
                <div style={{ fontWeight: 500 }}>{lab}</div>
                <div className="muted" style={{ fontSize: 'var(--fs-micro)' }}>{sub}</div>
              </button>
            )}
          </div>
        </Field>
      )}

      {tab !== 'offline' && <hr className="hr" style={{ margin: '16px 0' }} />}
      {tab === 'offline' && <div style={{ marginTop: 4 }} />}

      {tab === 'email' && <>
        <Field label="E-mail">
          <div data-vfield="email" className={inv('email')}>
            <input className="input" type="email" value={email} onChange={e => { setEmail(e.target.value); v.markTouched('email'); }} placeholder="name@example.com" autoFocus={!isMobile} />
          </div>
          <FieldError issues={v.displayIssues} field="email" />
        </Field>
        <Field label={t('member.message_label')} hint={t('member.message_hint')}>
          <textarea className="textarea" value={message} onChange={e => setMessage(e.target.value)} placeholder={t('member.message_ph')} rows={3} />
        </Field>
        <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 6 }}>
          {t('member.invite_email_note')}
        </div>
      </>}

      {tab === 'link' && <>
        <Field label={t('member.invite_link_label')}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input mono" value={linkLoading ? '' : linkUrl}
              placeholder={linkLoading ? t('share.generating') : ''}
              readOnly style={{ flex: 1 }}
              onClick={(e) => e.target.select()} />
            <Btn variant="primary" icon="copy" onClick={copyLink} disabled={linkLoading || !linkUrl}>
              {copied ? t('common.copied') : t('share.copy')}
            </Btn>
          </div>
          {linkErr && <div style={{ marginTop: 8 }}><Severity level="error">{linkErr}</Severity></div>}
        </Field>
        <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 8, lineHeight: 1.5 }}>
          {t('member.invite_link_note')}
        </div>
      </>}

      {tab === 'offline' && <>
        <Field label={t('members.offline_name')} hint={t('member.offline_name_hint')}>
          <div data-vfield="name" className={inv('name')}>
            <input className="input" value={offlineName} onChange={e => { setOfflineName(e.target.value); v.markTouched('name'); }} placeholder={t('member.offline_name_ph')} autoFocus={!isMobile} />
          </div>
          <FieldError issues={v.displayIssues} field="name" />
        </Field>
        <div className="muted" style={{ fontSize: 'var(--fs-meta)', marginTop: 8, lineHeight: 1.5 }}>
          {t('member.offline_note')}
        </div>
      </>}

      <IssuesPanel issues={v.panelIssues} style={{ marginTop: 12 }} />
      {err && <div style={{ marginTop: 10 }}><Severity level="error">{err}</Severity></div>}
    </Dialog>
  );
}

// ─── ChangeRoleDialog ─────────────────────────────────────────────────────────

function ChangeRoleDialog({ member, tripId, onSaved, open, onOpenChange }) {
  const { t } = useI18n();
  const close = () => onOpenChange?.(false);
  const [role, setRole] = useState(member.role || 'viewer');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setSaving(true);
    setErr('');
    const { data, error } = await supabase.functions.invoke('updateTripMemberRole', {
      body: { member_id: member.id, role },
    });
    setSaving(false);
    if (error || data?.error) { setErr((data?.error || error?.message) || t('members.error_generic')); return; }
    onSaved?.();
    close();
  }

  return (
    <Dialog title={t('members.change_role')} icon="edit" size="sm" open={open} onOpenChange={onOpenChange}
      foot={<>
        <Btn variant="ghost" onClick={close}>{t('trip.form_cancel')}</Btn>
        <Btn variant="primary" onClick={save} disabled={saving}>{saving ? t('member.saving') : t('trip.form_save')}</Btn>
      </>}>
      <div style={{ marginBottom: 14, fontSize: 'var(--fs-base)', color: 'var(--muted)' }}>
        {member.user_full_name || member.invite_email}
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

export default function MembersLens({ tripId, members = [], trip, user, role: myRole, isLoading, queryClient }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { toast } = useToast();
  const nav = useNavigate();
  const [removing, setRemoving] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [promoteState, setPromoteState] = useState(null); // null | { member }
  const [roleState, setRoleState] = useState(null); // null | { member }

  const canManage = myRole === 'owner' || myRole === 'admin';
  // Resolve display names from profiles. Include the trip owner - they often
  // have no trip_members row, so members.map alone misses them and the owner
  // ends up showing the email twice.
  const profileIds = [
    ...members.map(m => m.user_id),
    trip?.created_by,
  ].filter(Boolean);
  const profiles = useUserProfiles(profileIds, tripId);

  function refresh() {
    // B5: invalidate both content (members list) and shell (header avatar row)
    queryClient?.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) });
    queryClient?.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
  }

  async function resend(memberId) {
    await supabase.functions.invoke('resendTripInvite', { body: { member_id: memberId } });
  }

  // Re-invite a member who declined: restart the invite flow on the SAME row.
  // inviteTripMember resets a declined row back to pending and re-sends the
  // notification + email (reusing the existing role).
  async function reinvite(member) {
    setRemoving(member.id);
    const { data, error } = await supabase.functions.invoke('inviteTripMember', {
      body: { trip_id: tripId, email: member.invite_email, role: member.role || 'viewer' },
    });
    setRemoving(null);
    if (error || data?.error) { toast({ description: await edgeErrorMessage(error, data, t('member.err_send_invite')), variant: 'destructive' }); return; }
    refresh();
  }

  async function removeMember(memberId) {
    if (!(await confirm({ title: t('member.remove_confirm'), variant: 'destructive' }))) return;
    setRemoving(memberId);
    const { data, error } = await supabase.functions.invoke('removeTripMember', { body: { member_id: memberId } });
    setRemoving(null);
    if (error || !data?.ok) { toast({ description: await edgeErrorMessage(error, data, t('member.err_remove')), variant: 'destructive' }); return; }
    refresh();
  }

  // Leaving the trip = self-removal. removeTripMember allows a member to remove
  // their own row (isSelf path). Once gone the user loses access, so navigate
  // back to the trips collection rather than refreshing the now-forbidden lens.
  async function leaveTrip(member) {
    if (!(await confirm({ title: t('settings.leave_confirm'), variant: 'destructive' }))) return;
    setRemoving(member.id);
    const { data, error } = await supabase.functions.invoke('removeTripMember', { body: { member_id: member.id } });
    setRemoving(null);
    if (error || !data?.ok) { toast({ description: await edgeErrorMessage(error, data, t('settings.leave_error')), variant: 'destructive' }); return; }
    nav('/trips');
  }

  // Invite lives inline in the body (the "invite more" banner at the end of the
  // member list), so the removed per-screen bar's invite button — which merely
  // duplicated it — needed no replacement.

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1,2,3].map(i => <Skeleton key={i} style={{ height: 64, borderRadius: 12 }} />)}
      </div>
    );
  }

  // Add trip owner as first "member" if not already in list. Don't seed
  // user_full_name with the email - leave it empty so the profile resolver
  // (or the auth user's own name when they are the owner) wins the fallback.
  const ownerId = trip?.created_by || '';
  const allMembers = [...members];
  const hasOwner = allMembers.some(m => m.user_id === ownerId || m.role === 'owner');
  if (!hasOwner && ownerId) {
    const isMeOwner = user?.id && ownerId === user.id;
    allMembers.unshift({
      id: '__owner__',
      trip_id: tripId,
      user_id: ownerId,
      user_full_name: isMeOwner ? (user?.full_name || '') : '',
      role: 'owner',
      status: 'active',
    });
  }

  return (
    <>
      <div className="mlist ov-anim">
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
          const isRemoving = removing === m.id;
          const profile = profiles[m.user_id];
          // Display name = real name when known. When nothing is recorded,
          // displayName() returns a Title-cased email local-part so the row
          // never shows the same email twice. The email line below is only
          // rendered when we actually have a separate name to put on top.
          const realName = profile?.full_name || m.user_full_name
            || (m.user_id && user?.id && m.user_id === user.id ? user.full_name : '')
            || '';
          const name = displayName(m.invite_email, realName);
          const hasRealName = !!realName;
          // Email line: invite_email for invited members, else the resolved
          // account email (covers the owner, who has no trip_members row).
          const emailLine = m.invite_email || profile?.email || '';

          return (
            <div key={m.id || i} className={`mbrow${isRemoving ? ' mbrow--busy' : ''}`}>
              <Avatar name={name} photo={profile?.avatar_url || ''} deleted={profile?.is_deleted} size="lg" />
              <div className="mbrow__id">
                <div className="mbrow__name">
                  {name}
                  {m.user_id === user?.id && <Badge variant="quiet" style={{ fontSize: 'var(--fs-micro)' }}>{t('member.you_self')}</Badge>}
                </div>
                {hasRealName && emailLine && (
                  <div className="mbrow__email">{emailLine}</div>
                )}
              </div>

              <div className="mbrow__meta">
                {m.status === 'offline'
                  ? <Badge variant="quiet" icon="user">{t('trip.member_offline')}</Badge>
                  : <RoleBadge role={m.role} />}
                <StatusDot status={m.status} />
              </div>

              {/* Actions */}
              <div className="mbrow__acts">
                {m.status === 'offline' && canManage && (
                  <Btn variant="ghost" size="sm" icon="send"
                    onClick={() => setPromoteState({ member: m })}>
                    {t('members.invite')}
                  </Btn>
                )}
                {canActOnRow && (
                  <ActionMenu
                    align="end"
                    width={220}
                    title={t('member.actions')}
                    trigger={
                      <button
                        className="icon-btn menu-trig"
                        style={{ width: 30, height: 30, color: 'var(--muted)', border: '1px solid transparent' }}
                        title={t('member.actions')}
                      >
                        <Icon name="more" size={15} />
                      </button>
                    }
                    items={isSelf
                      // Your own row: the only self-action is leaving the trip.
                      ? [{ icon: 'arrow', label: t('members.leave'), danger: true, onSelect: () => leaveTrip(m) }]
                      : [
                          m.status === 'pending' && { icon: 'send', label: t('members.resend'), onSelect: () => resend(m.id) },
                          m.status === 'declined' && { icon: 'send', label: t('member.invite_again'), onSelect: () => reinvite(m) },
                          m.status === 'active' && { icon: 'edit', label: t('members.change_role'), onSelect: () => setRoleState({ member: m }) },
                          { icon: 'trash', label: m.status === 'pending' ? t('member.cancel_invite') : t('members.remove'), danger: true, onSelect: () => removeMember(m.id) },
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
        <div className="invite-banner">
          <div className="invite-banner__ic">
            <Icon name="users" size={20} />
          </div>
          <div className="invite-banner__txt">
            <div className="invite-banner__title">{t('member.invite_more_title')}</div>
            <div className="invite-banner__desc">{t('member.invite_more_desc')}</div>
          </div>
          <Btn variant="primary" icon="plus" onClick={() => setInviteOpen(true)}>{t('members.invite')}</Btn>
        </div>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} tripId={tripId} onSaved={refresh} />
      {promoteState && <InviteDialog open={!!promoteState} onOpenChange={(o) => { if (!o) setPromoteState(null); }} tripId={tripId} promoteMember={promoteState.member} onSaved={refresh} />}
      {roleState && <ChangeRoleDialog open={!!roleState} onOpenChange={(o) => { if (!o) setRoleState(null); }} member={roleState.member} tripId={tripId} onSaved={refresh} />}
    </>
  );
}
