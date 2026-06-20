import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Icon } from '@/design/icons';
import { Dialog } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import TripLimitDialog from '@/components/subscriptions/TripLimitDialog';

/**
 * Global "create / copy trip" flow.
 *
 * One instance, mounted high in the authenticated app, so the create sheet and
 * the free-tier limit gate can be triggered in place on ANY screen (Trips,
 * Statistics, Account, Inbox, a trip screen's "…" menu) — driven by the mobile
 * bottom-nav "+", the in-page create buttons, and the per-trip "Copy" action.
 *
 * The free-tier limit check is delegated to <TripLimitDialog>, which self-fetches
 * the authoritative count from the `getActiveTrips` edge function (→ DB
 * active_owned_trips() helper, migration 0045). So creating AND copying run the
 * exact same gate: at the cap → the Pro upsell modal; under the cap → proceed.
 *
 * API (useCreateTrip):
 *   openChoice()      — open the manual/AI choice sheet
 *   startCreate(pick) — 'manual' | 'ai': run the limit gate, then open the planner
 *   startCopy(tripId) — run the SAME limit gate, then duplicate the trip
 *   copying           — true while a copy is in flight (disable the menu item)
 */
const CreateTripContext = createContext({
  openChoice: () => {},
  startCreate: () => {},
  startCopy: () => {},
  copying: false,
});

export const useCreateTrip = () => useContext(CreateTripContext);

// ─── Trip-creation choice card (shared: empty screen + new-trip dialog) ───────
export function ChoiceCard({ variant = 'man', icon, title, sub, onClick }) {
  const isAi = variant === 'ai';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`choice-card${isAi ? ' choice-card--ai' : ''}`}
    >
      <div className={`choice-card__ic choice-card__ic--${isAi ? 'ai' : 'man'}`}>
        <Icon name={icon} size={23} />
      </div>
      <div className="choice-card__tx">
        <div className="choice-card__ttl">{title}</div>
        <div className="choice-card__sub">{sub}</div>
      </div>
      <span className="choice-card__arr"><Icon name="arrowR" size={20} /></span>
    </button>
  );
}

// ─── New Trip Dialog (manual / AI choice) ─────────────────────────────────────
function NewTripDialog({ onClose, onManual, onAi }) {
  const { t } = useI18n();
  return (
    <Dialog
      title={t('trips.new')}
      subtitle={t('trips.choice_subtitle')}
      icon="plane"
      iconTone="activity"
      size="sm"
      open={true}
      onOpenChange={(o) => { if (!o) onClose(); }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ChoiceCard variant="man" icon="edit" title={t('trips.start_manual')} sub={t('trips.manual_desc_short')} onClick={onManual} />
        <ChoiceCard variant="ai" icon="sparkles" title={t('trips.start_with_ai')} sub={t('trips.ai_desc_short')} onClick={onAi} />
      </div>
    </Dialog>
  );
}

export function CreateTripProvider({ children }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { t } = useI18n();

  const [choiceOpen, setChoiceOpen] = useState(false);
  const [limitOpen, setLimitOpen]   = useState(false);
  const [pending, setPending]       = useState(null); // { kind:'create'|'copy', pick?, tripId? }
  const [copying, setCopying]       = useState(false);

  const openChoice = useCallback(() => setChoiceOpen(true), []);

  // Run the limit gate for a concrete method. TripLimitDialog self-fetches the
  // authoritative count and auto-proceeds when the user is under the cap.
  const startCreate = useCallback((pick) => {
    setPending({ kind: 'create', pick });
    setLimitOpen(true);
  }, []);

  // Copy goes through the exact same gate as create.
  const startCopy = useCallback((tripId) => {
    if (!tripId) return;
    setPending({ kind: 'copy', tripId });
    setLimitOpen(true);
  }, []);

  // Server enforces the limit again inside copyTrip; this client gate just keeps
  // the UX consistent with create (Pro modal instead of a destructive toast).
  const doCopy = useCallback(async (tripId) => {
    setCopying(true);
    try {
      const { data, error } = await supabase.functions.invoke('copyTrip', { body: { tripId } });
      // Non-2xx → supabase-js puts the response in error.context; pull the real
      // server message out of it so failures aren't masked by a generic toast.
      let serverMsg = data?.error || null;
      if (!serverMsg && error?.context && typeof error.context.json === 'function') {
        try { serverMsg = (await error.context.json())?.error || null; } catch { /* ignore */ }
      }
      if (error || data?.error) throw new Error(serverMsg || error?.message || 'copy failed');
      qc.invalidateQueries({ queryKey: ['trips', user?.id] });
      toast({ description: t('trip.copy_done'), variant: 'success' });
      if (data?.tripId) nav(`/trip/${data.tripId}`);
    } catch (e) {
      toast({ description: e?.message || t('trip.copy_error'), variant: 'destructive' });
    } finally {
      setCopying(false);
    }
  }, [qc, user?.id, toast, t, nav]);

  // TripLimitDialog calls this only when the user is UNDER the cap (or Pro).
  const proceed = useCallback(() => {
    setLimitOpen(false);
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === 'copy') { doCopy(p.tripId); return; }
    nav(p.pick === 'ai' ? '/plan-trip-ai' : '/new-trip');
  }, [nav, pending, doCopy]);

  const value = useMemo(
    () => ({ openChoice, startCreate, startCopy, copying }),
    [openChoice, startCreate, startCopy, copying],
  );

  return (
    <CreateTripContext.Provider value={value}>
      {children}

      {choiceOpen && (
        <NewTripDialog
          onClose={() => setChoiceOpen(false)}
          onManual={() => { setChoiceOpen(false); startCreate('manual'); }}
          onAi={() => { setChoiceOpen(false); startCreate('ai'); }}
        />
      )}

      <TripLimitDialog
        open={limitOpen}
        onOpenChange={(o) => { setLimitOpen(o); if (!o) setPending(null); }}
        onProceed={proceed}
      />
    </CreateTripContext.Provider>
  );
}
