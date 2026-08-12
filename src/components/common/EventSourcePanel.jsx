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
import { Btn, Severity, Skeleton, useToast } from '@/design/index';
import EventEditDialog from '@/components/common/EventEditDialog';
import { useEntitySource, useEntityDocs, EventViewSections, eventTheme, eventHeader } from '@/components/common/EventViewBody';
import { PanelShell, kindIcon } from '@/components/common/EventPanels';
import { getSourceDocuments } from '@/lib/documents';
import { collectDocPaths } from '@/lib/storageCleanup';
import { ENTITY_TABLE_BY_KIND, deleteSourceEntity } from '@/lib/trip-entities';
import { errorText } from '@/lib/errorText';
import { cityLabel } from '@/lib/trip-cities';
const LABEL_KEY = { hotel: 'budget.cat_accommodation', activity: 'budget.source_activity', service: 'service.car_default_name' };

export default function EventSourcePanel({ tripId, kind, id, canEdit = false, warning = null, autoEdit = false, onClose }) {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(autoEdit);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset view/edit state when a different entity is opened. Skip the first run
  // so an autoEdit intent (edit-from-timeline) isn't immediately cleared.
  const firstRef = React.useRef(true);
  React.useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    setEditMode(false); setConfirmDel(false);
  }, [kind, id]);

  // Reads the row from the getTripDetails cache (TRIP-405): a live edit invalidates
  // that cache and this hook re-derives — no manual re-read key needed anymore.
  const { data, visit, fromVisit, toVisit } = useEntitySource(kind, id, { tripId, open: true, onError: () => onClose?.() });
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
        onOpenChange={(o) => { if (!o) { setEditMode(false); invalidate(); } }}
      />
    );
  }

  const themeLabel = kind === 'transfer'
    ? t(data.transport_type === 'plane' ? 'trip.tl_flight' : 'trip.tl_transfer')
    : t(LABEL_KEY[kind] || 'budget.source_activity');
  // city_visits has no `city_name` column — resolve the localized name from
  // name_i18n/city_name_en (raw rows from useEntitySource aren't pre-localized).
  const visitCity = cityLabel(visit, lang);
  // Шапка - ОБЩИЙ шов `eventHeader`, тот же у создания и у редактирования.
  // Своя сборка здесь была ЧЕТВЁРТОЙ и давала «Перелёт / перевозчик» там, где
  // создание писало «Трансфер / Барселона → Мадрид».
  const hdr = eventHeader({ kind, visit, fromVisit, toVisit, entity: data, t, lang });
  const isSvc = kind === 'service';
  const eyebrow = isSvc ? themeLabel : hdr.eyebrow;
  const title = isSvc ? (data.name || themeLabel) : (hdr.title || themeLabel);
  const sub = isSvc ? (visitCity || '') : hdr.sub;

  const CACHE_KIND = { hotel: 'hotels', transfer: 'transfers', activity: 'activities', service: 'services' };
  const doDelete = async () => {
    if (!ENTITY_TABLE_BY_KIND[kind]) return;
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
        const { error, deleted, code } = await deleteSourceEntity(kind, data.id, tripId, orphanPaths);
        // error OR 0-row reject (deleted:false) → undo the optimistic removal so
        // the entity doesn't vanish on a write that never happened.
        if (error || !deleted) {
          if (prev !== undefined) qc.setQueryData(TRIP_CONTENT_KEY(tripId), prev);
          toast({ description: error ? errorText(t, code) : t('event.delete_failed'), variant: 'destructive' });
        }
        invalidate();
      })();
      return;
    }
    setDeleting(true);
    const { error, deleted, code } = await deleteSourceEntity(kind, data.id, tripId, orphanPaths);
    setDeleting(false);
    if (error || !deleted) { toast({ description: error ? errorText(t, code) : t('event.delete_failed'), variant: 'destructive' }); return; }
    invalidate();
    onClose?.();
  };

  return (
    <PanelShell
      kind={kind}
      icon={kindIcon(kind, data)}
      eyebrow={eyebrow}
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
        <Severity level="error" icon="trash" title={t('event.delete_q', { label: themeLabel.toLowerCase() })}>
          <div className="t-meta">{t('event.delete_irreversible')}</div>
        </Severity>
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
