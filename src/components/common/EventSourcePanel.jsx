/**
 * EventSourcePanel - in-place LEFT-PANEL view/edit/delete of a booking, shown
 * in the trip-editor's left column (design mockup: HotelView / TransferView /
 * ActivityView). Controller only:
 *   - load by id (useEntitySource)
 *   - view   -> PanelShell (chrome) + EventViewSections (canonical shared body)
 *   - edit   -> EventEditDialog variant="panel"
 *   - delete -> inline confirm -> optimistic dim -> drop on success -> onClose()
 */
import React, { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, tripContentBinding, withOptimism, reconcileCityChain } from '@/lib/trip-data';
import { useI18n } from '@/lib/i18n/I18nContext';
import { successToast } from '@/lib/successToast';
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
const CACHE_KIND = { hotel: 'hotels', transfer: 'transfers', activity: 'activities', service: 'services' };

export default function EventSourcePanel({ tripId, kind, id, canEdit = false, warning = null, autoEdit = false, onClose }) {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(autoEdit);
  const [confirmDel, setConfirmDel] = useState(false);

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

  // Delete: same optimistic dim-then-drop as EventEditDialog / documents. The panel
  // stays open with the button in its loading state (`deleteMut.isPending`) — no
  // early close, so no survive-unmount engine — the row greys out (`_pending`) while
  // the write runs, then drops on success or un-dims on refusal. Defined as a hook
  // (before the early returns); the id + orphan file keys travel via mutate vars, so
  // it needs no `data` from the render closure.
  const delBinding = tripContentBinding(qc, tripId, CACHE_KIND[kind]);
  const deleteMut = useMutation({
    mutationFn: async ({ id: rowId, orphanPaths }) => {
      const { data: res, error, deleted, code } = await deleteSourceEntity(kind, rowId, tripId, orphanPaths);
      if (error) throw Object.assign(new Error('delete_failed'), { code });
      // deleted:false = already gone / RLS hid it — surface so the row rolls back.
      if (!deleted) throw Object.assign(new Error('write_rejected'), { code: 'NOT_FOUND' });
      // Transfer delete un-shifts downstream city dates on the server; reconcile the
      // returned chain into the shell so the timeline updates without a reload.
      if (kind === 'transfer' && res?.cities) reconcileCityChain(qc, tripId, res.cities);
    },
    ...withOptimism(delBinding, {
      op: 'update',     // dim the row (`_pending`), don't yank it yet
      reconcile: false, // delete returns nothing — no row to reconcile from
      onSuccess: (_d, { id: rowId }) => {
        delBinding.remove(rowId); // now drop the dimmed row
        successToast(t, 'booking_deleted');
        onClose?.();
      },
      onError: (err) => toast({ description: err?.code ? errorText(t, err.code) : t('event.delete_failed'), variant: 'destructive' }),
    }),
  });

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

  const startDelete = () => {
    if (!ENTITY_TABLE_BY_KIND[kind]) return;
    // Entity gone → its attachments are orphaned. Capture their object keys before
    // delete; deleteSourceEntity sweeps best-effort only once the row is actually
    // gone, never on rollback (TRIP-117). The mutation owns the optimistic dim,
    // the write and the reconcile.
    const orphanPaths = collectDocPaths(getSourceDocuments(kind, data));
    deleteMut.mutate({ id: data.id, orphanPaths, row: { id: data.id, _pending: true } });
  };

  return (
    <PanelShell
      kind={kind}
      icon={kindIcon(kind, data)}
      eyebrow={eyebrow}
      title={title}
      sub={sub}
      onBack={onClose}
      // Футер рисуется ТОЛЬКО когда в нём есть кнопки: у наблюдателя (`!canEdit`)
      // действий нет, поэтому `foot` = null и PanelShell вообще не выводит `.lp-f`
      // (иначе пустой фрагмент оставался тонкой полоской с border-top).
      foot={confirmDel ? (
        <>
          <Btn variant="secondary" onClick={() => setConfirmDel(false)} disabled={deleteMut.isPending}>{t('common.cancel')}</Btn>
          <Btn variant="danger-solid" icon="trash" loading={deleteMut.isPending} disabled={deleteMut.isPending} onClick={startDelete}>{t('common.delete')}</Btn>
        </>
      ) : canEdit ? (
        <>
          <Btn variant="danger" icon="trash" onClick={() => setConfirmDel(true)} ariaLabel={t('common.delete')}>{t('common.delete')}</Btn>
          <Btn variant="primary" icon="edit" onClick={() => setEditMode(true)}>{t('trip.edit_trip')}</Btn>
        </>
      ) : null}
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
