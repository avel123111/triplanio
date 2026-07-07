/**
 * EventSourcePanel - in-place LEFT-PANEL view/edit/delete of a booking, shown
 * in the trip-editor's left column (design mockup: HotelView / TransferView /
 * ActivityView). Controller only:
 *   - load by id (useEntitySource)
 *   - view   -> PanelShell (chrome) + EventViewSections (canonical shared body)
 *   - edit   -> EventEditDialog variant="panel"
 *   - delete -> inline confirm -> delete row -> invalidate -> onClose()
 */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, optimisticContentUpdate } from '@/lib/trip-data';
import { useI18n } from '@/lib/i18n/I18nContext';
import { Icon } from '@/design/icons';
import { Btn, Skeleton, useToast } from '@/design/index';
import EventEditDialog from '@/components/common/EventEditDialog';
import { useEntitySource, useEntityDocs, EventViewSections, eventTheme, fmtDate, stayNights } from '@/components/common/EventViewBody';
import { PanelShell, kindIcon } from '@/components/common/EventPanels';
import { getSourceDocuments } from '@/lib/documents';
import { collectDocPaths } from '@/lib/storageCleanup';
import { ENTITY_TABLE_BY_KIND, deleteSourceEntity } from '@/lib/trip-entities';
import { cityLabel } from '@/lib/trip-cities';
const LABEL_KEY = { hotel: 'budget.cat_accommodation', activity: 'budget.source_activity', service: 'service.car_default_name' };

export default function EventSourcePanel({ kind, id, canEdit = false, warning = null, autoEdit = false, onClose }) {
  const { t, lang } = useI18n();
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
  // Docs state for the shared view body (read-only here — no upload in view mode).
  const { docs, uploading, uploadFiles } = useEntityDocs(kind, data, canEdit);

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
  // Drawer header (redesign): eyebrow = TYPE, title = city (hotel: the name is
  // in the body name-card, not repeated here), meta/sub = stay dates.
  const hotelNights = kind === 'hotel' ? stayNights(data.check_in_datetime, data.check_out_datetime) : null;
  const hotelDates = kind === 'hotel' && data.check_in_datetime && data.check_out_datetime
    ? `${fmtDate(data.check_in_datetime)} — ${fmtDate(data.check_out_datetime)}${hotelNights != null ? ` · ${t('fork.stay22_nights', { count: hotelNights })}` : ''}`
    : '';
  // city_visits has no `city_name` column — resolve the localized name from
  // name_i18n/city_name_en (raw rows from useEntitySource aren't pre-localized).
  const visitCity = cityLabel(visit, lang);
  const routeCity = [cityLabel(fromVisit, lang), cityLabel(toVisit, lang)].filter(Boolean).join(' → ');
  const title = kind === 'hotel' ? (visitCity || themeLabel)
    : kind === 'activity' ? (data.title || themeLabel)
    : kind === 'service' ? (data.name || themeLabel)
    : (data.carrier || routeCity || themeLabel);
  const sub = kind === 'hotel' ? (hotelDates || visitCity || '')
    : kind === 'transfer'
      ? (routeCity || themeLabel)
      : (visitCity || themeLabel);

  const CACHE_KIND = { hotel: 'hotels', transfer: 'transfers', activity: 'activities', service: 'services' };
  const doDelete = async () => {
    if (!ENTITY_TABLE_BY_KIND[kind]) return;
    const tripId = data.trip_id;
    const cacheKind = CACHE_KIND[kind];
    // Entity gone → its attachments are orphaned. Capture their object keys
    // before delete; deleteSourceEntity sweeps best-effort only once the row is
    // actually gone, never on rollback (TRIP-117).
    const orphanPaths = collectDocPaths(getSourceDocuments(kind, data));
    // Optimistic: drop it from the content cache + close immediately, then delete
    // in the DB in the background and reconcile (rollback on error).
    if (tripId && cacheKind) {
      const prev = qc.getQueryData(TRIP_CONTENT_KEY(tripId));
      optimisticContentUpdate(qc, tripId, cacheKind, 'remove', { id: data.id });
      onClose?.();
      (async () => {
        const { error } = await deleteSourceEntity(kind, data.id, orphanPaths);
        if (error && prev !== undefined) qc.setQueryData(TRIP_CONTENT_KEY(tripId), prev);
        invalidate();
      })();
      return;
    }
    setDeleting(true);
    const { error } = await deleteSourceEntity(kind, data.id, orphanPaths);
    setDeleting(false);
    if (error) { toast({ description: t('event.delete_failed') + ': ' + error.message, variant: 'destructive' }); return; }
    invalidate();
    onClose?.();
  };

  return (
    <PanelShell
      kind={kind}
      icon={kindIcon(kind, data)}
      eyebrow={themeLabel}
      title={title}
      sub={sub}
      onBack={onClose}
      footClass={confirmDel ? '' : 'lp-f--ratio'}
      foot={confirmDel ? (
        <>
          <Btn variant="secondary" onClick={() => setConfirmDel(false)} disabled={deleting}>{t('common.cancel')}</Btn>
          <Btn variant="danger-solid" icon="trash" onClick={doDelete} disabled={deleting}>{deleting ? t('event.deleting') : t('common.delete')}</Btn>
        </>
      ) : (
        <>
          {canEdit && <Btn variant="danger" icon="trash" onClick={() => setConfirmDel(true)} ariaLabel={t('common.delete')}><span className="btn-label-collapse">{t('common.delete')}</span></Btn>}
          {canEdit && <Btn variant="primary" icon="edit" onClick={() => setEditMode(true)}>{t('trip.edit_trip')}</Btn>}
        </>
      )}
    >
      {confirmDel ? (
        <div className="del-confirm">
          <div className="del-confirm-ic"><Icon name="trash" size={18} /></div>
          <div>
            <div className="t-ui">{t('event.delete_q', { label: themeLabel.toLowerCase() })}</div>
            <div className="t-meta" style={{ color: 'var(--muted)', marginTop: 4 }}>{t('event.delete_irreversible')}</div>
          </div>
        </div>
      ) : (
        <EventViewSections
          kind={kind} entity={data} visit={visit} fromVisit={fromVisit} toVisit={toVisit}
          accent={eventTheme(kind, data).color}
          docs={docs} canEdit={false} uploading={uploading} uploadFiles={uploadFiles}
          externalWarning={warning}
        />
      )}
    </PanelShell>
  );
}
