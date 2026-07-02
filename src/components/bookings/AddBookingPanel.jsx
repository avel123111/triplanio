import React, { useState } from 'react';
import { Search, FileText, BedDouble, Plane, Ticket, X } from 'lucide-react';
import { fmtDate } from '@/design';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import EventEditDialog from '@/components/common/EventEditDialog';

// TRIP-176: unified "add booking" panel for the trip editor. Merges the partner
// fork (ForkPartnerModal) and the manual create form (EventEditDialog) into a
// single panel with a segmented tab on top — "Find …" (partners + live list)
// vs "I have a booking" (manual form). Both children render body-only (embedded)
// so this wrapper owns the shared .lp shell + contextual header + the tabs.
// Scope: hotel / activity / transfer (services keep the standalone fork/form).
// Only the active tab is mounted, so heavy form state / map preview side-effects
// don't run while the "Find" tab is showing.
const KIND_META = {
  hotel:    { Icon: BedDouble, color: 'var(--ev-hotel)',    soft: 'var(--ev-hotel-soft)',    eyebrowKey: 'event.type_hotel',    findKey: 'fork.tab_find_hotel' },
  activity: { Icon: Ticket,    color: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', eyebrowKey: 'event.type_activity', findKey: 'fork.tab_find_activity' },
  transfer: { Icon: Plane,     color: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', eyebrowKey: 'event.type_transfer', findKey: 'fork.tab_find_transfer' },
};

export default function AddBookingPanel({
  kind,
  tripId,
  trip,
  visit,
  fromVisit,
  toVisit,
  stay22,
  defaultCurrency = 'EUR',
  // 'find' (partners, default) | 'manual' (I have a booking)
  initialTab = 'find',
  onPreviewTransfer,
  // Close the whole panel (and sync). Wired to the header ×, the fork Cancel and
  // the manual Cancel — only one child is visible at a time.
  onClose,
}) {
  const { t } = useI18nFormat();
  const [tab, setTab] = useState(initialTab === 'manual' ? 'manual' : 'find');
  const meta = KIND_META[kind] || KIND_META.hotel;
  const HeaderIcon = meta.Icon;

  // Contextual header: eyebrow = kind, title = city (or "from → to" for a
  // transfer), subtitle = the city's stay window · nights (hotel/activity only).
  const isTransfer = kind === 'transfer';
  const title = isTransfer
    ? `${fromVisit?.city_name || '?'} → ${toVisit?.city_name || '?'}`
    : (visit?.city_name || '');
  let subtitle = '';
  if (!isTransfer && visit) {
    const range = [fmtDate(visit.start_date), fmtDate(visit.end_date)].filter(Boolean).join(' — ');
    const nights = visit.nights > 0 ? t('fork.stay22_nights', { count: visit.nights }) : '';
    subtitle = [range, nights].filter(Boolean).join(' · ');
  }

  const close = () => onClose?.();

  return (
    <div className="lp lp--wide abp" style={{ '--ev-soft': meta.soft, '--ev-ink': meta.color }}>
      {/* Shared contextual header (× closes the panel). */}
      <div className="lp-h abp-h">
        <span className="lp-ic" style={{ background: meta.soft, color: meta.color }}><HeaderIcon size={18} /></span>
        <div className="lp-ti">
          <div className="eyebrow" style={{ color: meta.color }}>{t(meta.eyebrowKey)}</div>
          <div className="abp-tirow">
            <b>{title}</b>
            {subtitle && <span>{subtitle}</span>}
          </div>
        </div>
        <button className="abp-x" onClick={close} aria-label={t('fork.cancel')} title={t('fork.cancel')}>
          <X size={15} />
        </button>
      </div>

      {/* Segmented tabs (reuses the design-system .seg, full-width). */}
      <div className="abp-tabwrap">
        <div className="seg abp-tabs" role="group" aria-label={t(meta.eyebrowKey)}>
          <button type="button" aria-pressed={tab === 'find'} onClick={() => setTab('find')}>
            <Search size={14} />{t(meta.findKey)}
          </button>
          <button type="button" aria-pressed={tab === 'manual'} onClick={() => setTab('manual')}>
            <FileText size={14} />{t('fork.tab_have_booking')}
          </button>
        </div>
      </div>

      {/* Active tab body + its own footer (only one tab is mounted at a time). */}
      {tab === 'find' ? (
        <ForkPartnerModal
          embedded open variant="panel" type={kind} tripId={tripId} trip={trip}
          visit={visit} fromVisit={fromVisit} toVisit={toVisit}
          stay22={stay22}
          onOpenChange={(o) => { if (!o) close(); }}
        />
      ) : (
        <EventEditDialog
          embedded open variant="panel" kind={kind} tripId={tripId}
          visit={visit} fromVisit={fromVisit} toVisit={toVisit}
          defaultCurrency={defaultCurrency}
          onPreviewTransfer={onPreviewTransfer}
          onOpenChange={(o) => { if (!o) { onPreviewTransfer?.(null); close(); } }}
        />
      )}

      <style>{`
        .abp-tirow { display: flex; align-items: baseline; gap: 8px; min-width: 0; margin-top: 2px; }
        .abp-tirow b { flex: 0 1 auto; }
        .abp-tirow span { flex: none; }
        .abp-x { width: 34px; height: 34px; border-radius: var(--r-pill); background: var(--surface); border: 1px solid var(--line); color: var(--muted); display: grid; place-items: center; cursor: pointer; flex: none; transition: color .14s, border-color .14s; }
        .abp-x:hover { color: var(--ink); border-color: var(--line-hover); }
        .abp-tabwrap { flex: none; padding: 12px 15px 2px; }
        .abp-tabs { display: flex; width: 100%; }
        .abp-tabs button { flex: 1; justify-content: center; }
      `}</style>
    </div>
  );
}
