import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Users, Plus, MoreVertical, Crown, Shield, Eye, LogOut, Send, Check, Loader2, UserCheck, UserMinus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import InviteMemberDialog from '@/components/members/InviteMemberDialog';
import PromoteOfflineDialog from '@/components/members/PromoteOfflineDialog';
import ConfirmDialog from '@/components/common/ConfirmDialog';
import UserAvatar from '@/components/UserAvatar';
import { useUserProfiles } from '@/lib/useUserProfiles';

function RoleIcon({ role }) {
  if (role === 'owner') return <Crown className="w-3 h-3 text-amber-500" />;
  if (role === 'admin') return <Shield className="w-3 h-3 text-primary" />;
  return <Eye className="w-3 h-3 text-muted-foreground" />;
}

export default function TripMembersCard({ trip, readOnly = false, noFrame = false, hideHeader = false }) {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [promoteMember, setPromoteMember] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState({ open: false, member: null, isLeave: false });

  const { data: members = [] } = useQuery({
    queryKey: ['trip-members', trip?.id],
    queryFn: () => base44.entities.TripMember.filter({ trip_id: trip.id }),
    enabled: !!trip?.id,
  });

  const ownerEntry = trip ? {
    id: `owner-${trip.id}`,
    user_email: trip.created_by,
    user_full_name: trip.created_by === user?.email ? (user?.full_name || '') : '',
    role: 'owner',
    status: 'active',
    isVirtual: true,
  } : null;

  const allMembers = ownerEntry ? [ownerEntry, ...members] : members;
  const visible = allMembers.filter(m => m.status === 'active' || m.status === 'offline');
  const pending = members.filter(m => m.status === 'pending');

  const profiles = useUserProfiles(allMembers.map(m => m.user_email), trip?.id);

  const isOwner = trip?.created_by === user?.email;
  const myMember = members.find(m => m.user_email === user?.email && m.status === 'active');
  const iAmAdmin = isOwner || myMember?.role === 'admin';
  const canManage = iAmAdmin && !readOnly;
  const canResendInvites = iAmAdmin;

  const removeMut = useMutation({
    mutationFn: async (member) => {
      if (member.status === 'offline') return base44.entities.TripMember.delete(member.id);
      const res = await base44.functions.invoke('removeTripMember', { member_id: member.id });
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip-members', trip.id] }),
  });
  const updateRoleMut = useMutation({
    mutationFn: async ({ memberId, role }) => {
      const res = await base44.functions.invoke('updateTripMemberRole', { member_id: memberId, role });
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trip-members', trip.id] }),
  });
  const resendMut = useMutation({
    mutationFn: async (memberId) => {
      const res = await base44.functions.invoke('resendTripInvite', { member_id: memberId });
      return res.data;
    },
  });

  const Wrapper = noFrame ? React.Fragment : 'div';
  const wrapperProps = noFrame ? {} : { className: 'rounded-2xl border bg-card p-4' };

  return (
    <Wrapper {...wrapperProps}>
      {!hideHeader && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
              {t('members.title')} ({visible.length})
            </span>
          </div>
          {pending.length > 0 && (
            <span className="text-[10px] text-muted-foreground">
              +{pending.length} {t('members.pending')}
            </span>
          )}
        </div>
      )}

      <div className="flex items-center">
        <div className="flex -space-x-2">
          {visible.slice(0, 8).map(m => {
            const profile = profiles[m.user_email];
            const displayName = profile?.full_name || m.user_full_name || m.user_email;
            const showRoleBadge = m.role === 'owner' || m.role === 'admin';
            return (
              <div key={m.id} className="relative ring-2 ring-card rounded-full" title={`${displayName} (${t(`members.role_${m.role}`)})`}>
                <UserAvatar
                  name={profile?.full_name || m.user_full_name}
                  email={m.user_email}
                  avatarUrl={profile?.avatar_url || m.avatar_url}
                  size="sm"
                />
                {showRoleBadge && (
                  <span
                    className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-card border border-border flex items-center justify-center shadow-sm"
                    aria-hidden="true"
                  >
                    <RoleIcon role={m.role} />
                  </span>
                )}
              </div>
            );
          })}
          {visible.length > 8 && (
            <div className="w-7 h-7 rounded-full bg-secondary text-foreground flex items-center justify-center text-[10px] font-semibold ring-2 ring-card">
              +{visible.length - 8}
            </div>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="ml-2 w-7 h-7 rounded-full border-2 border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground flex items-center justify-center transition"
              aria-label={t('common.open')}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80 p-2">
            <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">{t('members.title')}</div>
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {allMembers.length === 0 ? (
                <div className="text-xs text-muted-foreground px-2 py-3">{t('members.empty')}</div>
              ) : (
                allMembers.map(m => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    profile={profiles[m.user_email]}
                    isMe={m.user_email === user?.email}
                    canManage={canManage}
                    canResend={canResendInvites}
                    onRemove={() => setConfirmRemove({ open: true, member: m, isLeave: false })}
                    onChangeRole={(role) => updateRoleMut.mutate({ memberId: m.id, role })}
                    onResend={() => resendMut.mutate(m.id)}
                    onPromote={() => setPromoteMember(m)}
                    resending={resendMut.isPending && resendMut.variables === m.id}
                    resent={resendMut.isSuccess && resendMut.variables === m.id}
                    t={t}
                  />
                ))
              )}
            </div>
            {canManage && (
              <>
                <div className="my-2 h-px bg-border" />
                <button
                  type="button"
                  onClick={() => setInviteOpen(true)}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
                >
                  <Plus className="w-3.5 h-3.5" />{t('members.add')}
                </button>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} tripId={trip.id} />
      <PromoteOfflineDialog
        open={!!promoteMember}
        onOpenChange={(o) => { if (!o) setPromoteMember(null); }}
        member={promoteMember}
        tripId={trip.id}
      />
      <ConfirmDialog
        open={confirmRemove.open}
        onOpenChange={(o) => setConfirmRemove((s) => ({ ...s, open: o }))}
        title={t('common.delete_confirm_title')}
        description={confirmRemove.isLeave ? t('members.leave_confirm') : t('members.remove_confirm')}
        confirmLabel={confirmRemove.isLeave ? t('members.leave') || t('common.delete') : t('common.delete')}
        variant="destructive"
        onConfirm={() => {
          if (confirmRemove.member) removeMut.mutate(confirmRemove.member);
          setConfirmRemove({ open: false, member: null, isLeave: false });
        }}
      />
    </Wrapper>
  );
}

function MemberRow({ member, profile, isMe, canManage, canResend = false, onRemove, onChangeRole, onResend, onPromote, resending, resent, t }) {
  const isOwner = member.role === 'owner';
  const isOffline = member.status === 'offline';
  const displayName = profile?.full_name || member.user_full_name || member.user_email;
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/50">
      <UserAvatar name={displayName} email={member.user_email} avatarUrl={profile?.avatar_url} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate flex items-center gap-1.5">
          {displayName}
          {isMe && <span className="text-[10px] text-muted-foreground">({t('members.you')})</span>}
          {isOffline && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {t('members.offline_badge')}
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-1 min-w-0">
          <span className="shrink-0"><RoleIcon role={member.role} /></span>
          <span className="truncate">{t(`members.role_${member.role}`)}</span>
        </div>
        {member.status === 'pending' && (
          <div className="text-[11px] text-amber-600 truncate mt-0.5">
            {t('members.pending')}
          </div>
        )}
      </div>
      {(canManage || canResend) && !isOwner && member.status === 'pending' && (
        <Button
          variant={resent ? 'outline' : 'ghost'}
          size="icon"
          className="w-7 h-7 shrink-0"
          onClick={(e) => { e.stopPropagation(); onResend(); }}
          disabled={resending}
          title={resent ? t('members.resent') : t('members.resend')}
          aria-label={t('members.resend')}
        >
          {resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> :
            resent ? <Check className="w-3.5 h-3.5 text-green-600" /> :
            <Send className="w-3.5 h-3.5" />}
        </Button>
      )}
      {canManage && !isOwner && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0"><MoreVertical className="w-3.5 h-3.5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isOffline && (
              <DropdownMenuItem onClick={onPromote}>
                <UserCheck className="w-3.5 h-3.5 mr-2" />{t('members.promote')}
              </DropdownMenuItem>
            )}
            {!isOffline && member.status === 'pending' && (
              <DropdownMenuItem onClick={onResend}>
                <Send className="w-3.5 h-3.5 mr-2" />{t('members.resend')}
              </DropdownMenuItem>
            )}
            {!isOffline && member.role !== 'admin' && (
              <DropdownMenuItem onClick={() => onChangeRole('admin')}>
                <Shield className="w-3.5 h-3.5 mr-2" />{t('members.role_admin')}
              </DropdownMenuItem>
            )}
            {!isOffline && member.role !== 'viewer' && (
              <DropdownMenuItem onClick={() => onChangeRole('viewer')}>
                <Eye className="w-3.5 h-3.5 mr-2" />{t('members.role_viewer')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
              <UserMinus className="w-3.5 h-3.5 mr-2" />{t('members.remove')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {isMe && !isOwner && !canManage && (
        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={onRemove}>
          <LogOut className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}