import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/design/icons';
import { Dialog } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';
import TripLimitDialog from '@/components/subscriptions/TripLimitDialog';

/**
 * Global "create trip" flow.
 *
 * One instance, mounted high in the authenticated app, so the create sheet can
 * be opened in place on ANY screen (Trips, Statistics, Account, Inbox) — driven
 * by the mobile bottom-nav "+" and by the in-page create buttons on Trips.
 *
 * Replaces the old per-screen duplication where the off-trip "+" had to route to
 * `/trips?new=1` to reach the dialog. The free-tier limit check is delegated to
 * <TripLimitDialog>, which self-fetches the authoritative count from the
 * `getActiveTrips` edge function — so there's a single, server-backed source of
 * truth for the limit instead of a client-side copy per screen.
 *
 * API (useCreateTrip):
 *   openChoice()      — open the manual/AI choice sheet
 *   startCreate(pick) — 'manual' | 'ai': run the limit gate, then open the planner
 */
const CreateTripContext = createContext({ openChoice: () => {}, startCreate: () => {} });

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
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [limitOpen, setLimitOpen]   = useState(false);
  const [pendingPick, setPendingPick] = useState(null);

  const openChoice = useCallback(() => setChoiceOpen(true), []);

  // Run the limit gate for a concrete method. TripLimitDialog self-fetches the
  // authoritative count and auto-proceeds when the user is under the cap.
  const startCreate = useCallback((pick) => {
    setPendingPick(pick);
    setLimitOpen(true);
  }, []);

  const proceed = useCallback(() => {
    setLimitOpen(false);
    nav(pendingPick === 'ai' ? '/plan-trip-ai' : '/new-trip');
    setPendingPick(null);
  }, [nav, pendingPick]);

  const value = useMemo(() => ({ openChoice, startCreate }), [openChoice, startCreate]);

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
        onOpenChange={setLimitOpen}
        onProceed={proceed}
      />
    </CreateTripContext.Provider>
  );
}
