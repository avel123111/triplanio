import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Loader2, Mail, Shield, Eye, Send } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Promote an offline (placeholder) member into a real online invitation.
 * Strategy: delete the offline placeholder, then create a normal invitation
 * via the existing `inviteTripMember` backend function.
 */
export default function PromoteOfflineDialog({ open, onOpenChange, member, tripId }) {
  const t = useT();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('viewer');
      setError('');
    }
  }, [open]);

  const mut = useMutation({
    mutationFn: async () => {
      // First send the invitation (will fail early on duplicate email etc.)
      const res = await base44.functions.invoke('inviteTripMember', {
        trip_id: tripId,
        email,
        role,
      });
      // Then remove the offline placeholder
      await base44.entities.TripMember.delete(member.id);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trip-members', tripId] });
      onOpenChange(false);
    },
    onError: (err) => {
      setError(err?.response?.data?.error || err?.message || t('members.error_generic'));
    },
  });

  const handleSubmit = () => {
    setError('');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError(t('members.invalid_email'));
      return;
    }
    mut.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            {t('members.promote_title')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {member && (
            <div className="p-3 rounded-lg bg-secondary text-sm">
              {t('members.promote_subtitle')}: <span className="font-semibold">{member.user_full_name}</span>
            </div>
          )}
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
          {error && <div className="text-sm text-destructive">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={mut.isPending}>
            {mut.isPending ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <Send className="w-3 h-3 mr-1.5" />}
            {t('members.send_invite')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}