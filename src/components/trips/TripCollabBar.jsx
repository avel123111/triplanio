import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import {
  Users, Plus, MoreVertical, Crown, Shield, Eye, LogOut, Send, Check, Loader2, UserCheck, UserMinus, Wallet, ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useT } from '@/lib/i18n/I18nContext';
import { useAuth } from '@/lib/AuthContext';
import InviteMemberDialog from '@/components/members/InviteMemberDialog';
import PromoteOfflineDialog from '@/components/members/PromoteOfflineDialog';
import UserAvatar from '@/components/UserAvatar';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { useFxRates } from '@/lib/fx';
import { fmtMoney, toMain } from '@/lib/budget/money';
import TripServicesRow from '@/components/services/TripServicesRow';

function RoleIcon({ role }) {
  if (role === 'owner') return <Crown className="w-3 h-3 text-amber-500" />;
  if (role === 'admin') return <Shield className="w-3 h-3 text-primary" />;
  return <Eye className="w-3 h-3 text-muted-foreground" />;
}

/**
 * Combined "Members + Budget" bar.
 * Two rows in a single card with consistent styling (icons, height, radius).
 */
export default function TripCollabBar({ trip, readOnly = false }) {
  if (!trip?.id) return null;
  return <TripCollabBarInner trip={trip} readOnly={readOnly} />;
}

function TripCollabBarInner({ trip, readOnly }) {
  const t = useT();
  return (
    <div className="rounded-2xl border bg-card mb-3 overflow-hidden">
      <div className="px-4 pt-3 pb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {t('trips.section_label')}
      </div>
      <MembersRow trip={trip} readOnly={readOnly} />
      <div className="h-px bg-border" />
      <BudgetRow trip={trip} />
      <div className="h-px bg-border" />
      <TripServicesRow tripId={trip.id} readOnly={readOnly} />
    </div>
  );
}

/* ---------------------------------- Members ---------------------------------- */

function MembersRow({ trip, readOnly }) {
  const t = useT();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [promoteMember, setPromoteMember] = useState(null);

  const { data: members = [], isLoading } = useQuery({
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

  if (isLoading) {
    return <div className="px-4 py-3 h-[60px]" />;
  }

  return (
    <div className="px-4 py-3 min-h-[64px] flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Users className="w-4 h-4 text-primary" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{t('members.title')}</span>
          <span className="text-xs text-muted-foreground">· {visible.length}</span>
          {pending.length > 0 && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              · {pending.length} {t('members.pending')}
            </span>
          )}
        </div>
        <div className="mt-1 flex -space-x-2 overflow-hidden">
          {visible.slice(0, 6).map(m => {
            const profile = profiles[m.user_email];
            const displayName = profile?.full_name || m.user_full_name || m.user_email;
            return (
              <div key={m.id} title={`${displayName} (${t(`members.role_${m.role}`)})`}>
                <UserAvatar
                  name={profile?.full_name || m.user_full_name}
                  email={m.user_email}
                  avatarUrl={profile?.avatar_url || m.avatar_url}
                  size="sm"
                />
              </div>
            );
          })}
          {visible.length > 6 && (
            <div className="w-7 h-7 rounded-full bg-secondary text-foreground flex items-center justify-center text-[10px] font-semibold ring-2 ring-background">
              +{visible.length - 6}
            </div>
          )}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs shrink-0">
            {t('common.open')}
          </Button>
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
                  onRemove={() => { if (confirm(t('members.remove_confirm'))) removeMut.mutate(m); }}
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

      <InviteMemberDialog open={inviteOpen} onOpenChange={setInviteOpen} tripId={trip.id} />
      <PromoteOfflineDialog
        open={!!promoteMember}
        onOpenChange={(o) => { if (!o) setPromoteMember(null); }}
        member={promoteMember}
        tripId={trip.id}
      />
    </div>
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
        <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
          <RoleIcon role={member.role} />
          {t(`members.role_${member.role}`)}
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
        <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => { if (confirm(t('members.leave_confirm'))) onRemove(); }}>
          <LogOut className="w-3.5 h-3.5" />
        </Button>
      )}
    </div>
  );
}

/* ---------------------------------- Budget ---------------------------------- */

function BudgetRow({ trip }) {
  const tripId = trip.id;

  const t = useT();
  const { data: budgets = [] } = useQuery({
    queryKey: ['trip-budget', tripId],
    queryFn: () => base44.entities.TripBudget.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ['budget-expenses', tripId],
    queryFn: () => base44.entities.BudgetExpense.filter({ trip_id: tripId }),
    enabled: !!tripId,
  });


  const budget = budgets[0] || null;
  const mainCurrency = budget?.currency || 'EUR';
  const fxOverrides = budget?.fx_overrides || null;
  const { data: fx } = useFxRates(mainCurrency);

  // v3: BudgetExpense already mirrors all source entities via backend
  // automations, so we just sum expenses. No more dedup against hotels/transfers.
  const total = useMemo(() => {
    let sum = 0;
    expenses.forEach((e) => {
      const { value, ok } = toMain(
        e.original_amount,
        e.original_currency || mainCurrency,
        mainCurrency,
        fx,
        fxOverrides,
      );
      if (ok) sum += value;
    });
    return sum;
  }, [expenses, mainCurrency, fx, fxOverrides]);

  return (
    <Link
      to={`/trip/${tripId}/budget`}
      className="block hover:bg-secondary/40 transition"
    >
      <div className="px-4 py-3 min-h-[64px] flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
          <Wallet className="w-4 h-4 text-emerald-700 dark:text-emerald-300" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{t('budget.title')}</span>
            {total > 0 ? (
              <span className="text-sm tabular-nums text-muted-foreground">
                {fmtMoney(total, mainCurrency)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">{t('budget.collab_empty_hint')}</span>
            )}
          </div>
        </div>

        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}