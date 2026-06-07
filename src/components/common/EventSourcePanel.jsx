/**
 * EventSourcePanel - in-place LEFT-PANEL view/edit/delete of a booking, shown
 * in the trip-editor's left column (design mockup: HotelView / TransferView /
 * ActivityView). Controller only:
 *   - load by id (useEntitySource)
 *   - view   -> PanelShell + EventPanelBody (design-faithful, EventPanels.jsx)
 *   - edit   -> EventEditDialog variant="panel"
 *   - delete -> inline confirm -> delete row -> invalidate -> onClose()
 */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, optimisticContentUpdate } from '@/lib/trip-data';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { Btn, Skeleton } from '@/design/index';
import EventEditDialog from '@/components/common/EventEditDialog';
import { useEntitySource } from '@/components/common/EventViewBody';
import { PanelShell, EventPanelBody, kindIcon } from '@/components/common/EventPanels';
import { useToast } from '@/components/ui/use-toast';

const TABLE_BY_KIND = { hotel: 'hotel_stays', transfer: 'transfers', activity: 'activities', service: 'trip_services' };
const LABEL_KEY = { hotel: 'budget.cat_accommodation', activity: 'budget.source_activity', service: 'service.car_default_name' };

export default function EventSourcePanel({ kind, id, canEdit = false, warning = null, autoEdit = false, onClose }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(autoEdit);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Bumped after a live edit so the view re-reads the row (this panel loads the
  // entity directly, so react-query invalidation alone wouldn't refresh it).
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset view/edit state when a different entity is opened. Skip the first run
  // so an autoEdit intent (edit-from-timeline) isn't immediately cleared.
  const firstRef = React.useRef(true);
  React.useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    setEditMode(false); setConfirmDel(false);
  }, [kind, id]);

  const { data, visit, fromVisit, toVisit } = useEntitySource(kind, id, { open: true, onError: () => onClose?.(), refreshKey });

  const invalidate = () => {
    const tripId = data?.trip_id;
    if (tripId) {
      qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) });
      qc.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    }
  };

  // Loading - keep the column from going blank.
  if (!data) {
    return (
      <div style={{ padding: 20 }}>
        <Skeleton w="55%" h={22} style={{ marginBottom: 14 }} />
        <Skeleton w="100%" h={90} style={{ marginBottom: 10 }} />
        <Skeleton w="100%" h={120} />
      </div>
    );
  }

  // EDIT - shared edit body inline (no overlay).
  if (editMode) {
    return (
      <EventEditDialog
        open variant="panel" kind={kind} tripId={data.trip_id} entity={data}
        visit={visit} fromVisit={fromVisit} toVisit={toVisit}
        onOpenChange={(o) => { if (!o) { setEditMode(false); invalidate(); setRefreshKey((k) => k + 1); } }}
      />
    );
  }

  const themeLabel = kind === 'transfer'
    ? t(data.transport_type === 'plane' ? 'trip.tl_flight' : 'trip.tl_transfer')
    : t(LABEL_KEY[kind] || 'budget.source_activity');
  const title = kind === 'hotel' ? (data.name || themeLabel)
    : kind === 'activity' ? (data.title || themeLabel)
    : kind === 'service' ? (data.name || themeLabel)
    : (data.carrier || [fromVisit?.city_name, toVisit?.city_name].filter(Boolean).join(' → ') || themeLabel);
  const sub = kind === 'transfer'
    ? [fromVisit?.city_name, toVisit?.city_name].filter(Boolean).join(' → ') || themeLabel
    : (visit?.city_name || themeLabel);

  const CACHE_KIND = { hotel: 'hotels', transfer: 'transfers', activity: 'activities', service: 'services' };
  const doDelete = async () => {
    const table = TABLE_BY_KIND[kind];
    if (!table) return;
    const tripId = data.trip_id;
    const cacheKind = CACHE_KIND[kind];
    // Optimistic: drop it from the content cache + close immediately, then delete
    // in the DB in the background and reconcile (rollback on error).
    if (tripId && cacheKind) {
      const prev = qc.getQueryData(TRIP_CONTENT_KEY(tripId));
      optimisticContentUpdate(qc, tripId, cacheKind, 'remove', { id: data.id });
      onClose?.();
      (async () => {
        const { error } = await supabase.from(table).delete().eq('id', data.id);
        if (error && prev !== undefined) qc.setQueryData(TRIP_CONTENT_KEY(tripId), prev);
        invalidate();
      })();
      return;
    }
    setDeleting(true);
    const { error } = await supabase.from(table).delete().eq('id', data.id);
    setDeleting(false);
    if (error) { toast({ description: t('event.delete_failed') + ': ' + error.message, variant: 'destructive' }); return; }
    invalidate();
    onClose?.();
  };

  return (
    <PanelShell
      kind={kind}
      icon={kindIcon(kind, data)}
      title={title}
      sub={sub}
      onBack={onClose}
      foot={confirmDel ? (
        <>
          <Btn variant="ghost" onClick={() => setConfirmDel(false)} disabled={deleting}>{t('common.cancel')}</Btn>
          <Btn variant="danger-solid" icon="trash" onClick={doDelete} disabled={deleting}>{deleting ? t('event.deleting') : t('common.delete')}</Btn>
        </>
      ) : (
        <>
          {canEdit && <Btn variant="ghost" icon="trash" onClick={() => setConfirmDel(true)}>{t('common.delete')}</Btn>}
          <span style={{ flex: 1 }} />
          {canEdit && <Btn variant="primary" icon="edit" onClick={() => setEditMode(true)}>{t('trip.edit_trip')}</Btn>}
        </>
      )}
    >
      {warning && (
        <div className="lp-warn" style={{ marginBottom: 4 }}>
          <Icon name="warning" size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-meta)', lineHeight: 1.45 }}>{warning}</div>
        </div>
      )}
      {confirmDel ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 12, border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--line))', background: 'var(--danger-soft)', marginTop: 8 }}>
          <span style={{ width: 36, height: 36, borderRadius: 9, background: 'color-mix(in srgb, var(--danger) 16%, transparent)', color: 'var(--danger)', display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon name="trash" size={17} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-strong)' }}>{t('event.delete_q', { label: themeLabel.toLowerCase() })}</div>
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--ink-2)', marginTop: 3, lineHeight: 1.5 }}>{t('event.delete_irreversible')}</div>
          </div>
        </div>
      ) : (
        <EventPanelBody kind={kind} entity={data} fromVisit={fromVisit} toVisit={toVisit} />
      )}
    </PanelShell>
  );
}
