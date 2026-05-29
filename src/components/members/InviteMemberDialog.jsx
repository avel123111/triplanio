import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Mail, Shield, Eye, Check, UserPlus, Users } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Add a trip member. Two modes:
 *  - "invite"  → send an email invitation (existing flow, calls backend function)
 *  - "offline" → create a placeholder TripMember (no email, no notification)
 */
export default function InviteMemberDialog({ open, onOpenChange, tripId }) {
  const t = useT();
  const qc = useQueryClient();
  const [mode, setMode] = useState('invite'); // 'invite' | 'offline'
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const handleClose = (o) => {
    if (!o) {
      setMode('invite'); setEmail(''); setRole('viewer'); setName(''); setError(''); setSent(false);
    }
    onOpenChange(o);
  };

  const inviteMut = useMutation({
    mutationFn: async () => {
      const res = await base44.functions.invoke('inviteTripMember', { trip_id: tripId, email, role });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-members', tripId] });
      setSent(true);
      setTimeout(() => handleClose(false), 1500);
    },
    onError: (err) => {
      setError(err?.response?.data?.error || err?.message || t('members.error_generic'));
    },
  });

  const offlineMut = useMutation({
    mutationFn: async () => {
      return base44.entities.TripMember.create({
        trip_id: tripId,
        user_id: null,
        invite_email: null,
        user_full_name: name.trim(),
        role: 'viewer',
        status: 'offline',
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-members', tripId] });
      setSent(true);
      setTimeout(() => handleClose(false), 1200);
    },
    onError: (err) => {
      setError(err?.message || t('members.error_generic'));
    },
  });

  const handleSubmit = () => {
    setError('');
    if (mode === 'invite') {
      if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError(t('members.invalid_email'));
        return;
      }
      inviteMut.mutate();
    } else {
      if (!name.trim()) {
        setError(t('members.offline_name_required'));
        return;
      }
      offlineMut.mutate();
    }
  };

  const pending = inviteMut.isPending || offlineMut.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            {t('members.add_title')}
          </DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="py-6 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-3">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <div className="font-medium">
              {mode === 'invite' ? t('members.invite_sent') : t('members.offline_added')}
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Mode picker */}
            <div className="grid grid-cols-2 gap-2">
              <ModeButton
                active={mode === 'invite'}
                onClick={() => { setMode('invite'); setError(''); }}
                Icon={Mail}
                label={t('members.mode_invite')}
                hint={t('members.mode_invite_hint')}
              />
              <ModeButton
                active={mode === 'offline'}
                onClick={() => { setMode('offline'); setError(''); }}
                Icon={Users}
                label={t('members.mode_offline')}
                hint={t('members.mode_offline_hint')}
              />
            </div>

            {mode === 'invite' ? (
              <>
                <div>
                  <Label>{t('members.invite_email')}</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="friend@example.com"
                    autoFocus
                  />
                </div>
                <div>
                  <Label>{t('members.invite_role')}</Label>
                  <Select value={role} onValueChange={setRole}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">
                        <span className="flex items-center gap-2"><Eye className="w-3.5 h-3.5" />{t('members.role_viewer')}</span>
                      </SelectItem>
                      <SelectItem value="admin">
                        <span className="flex items-center gap-2"><Shield className="w-3.5 h-3.5" />{t('members.role_admin')}</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            ) : (
              <div>
                <Label>{t('members.offline_name')}</Label>
                <Input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('members.offline_name_placeholder')}
                  autoFocus
                />
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  {t('members.offline_hint')}
                </p>
              </div>
            )}

            {error && <div className="text-sm text-destructive">{error}</div>}
          </div>
        )}

        {!sent && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleClose(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSubmit} disabled={pending}>
              {pending && <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />}
              {mode === 'invite' ? t('members.send_invite') : t('members.add_offline')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ModeButton({ active, onClick, Icon, label, hint }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 p-3 rounded-lg border text-left transition ${
        active ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/60'
      }`}
    >
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="w-3.5 h-3.5" />{label}
      </div>
      <span className="text-[11px] text-muted-foreground leading-tight">{hint}</span>
    </button>
  );
}