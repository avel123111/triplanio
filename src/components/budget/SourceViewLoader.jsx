/**
 * Loads a source entity (HotelStay / Transfer / Activity / TripService) by id
 * and opens the unified EventModal (new design). Used both from the timeline
 * (tap an event) and the budget (tap a system expense to see what created it).
 *
 * - View → EventModal (new design).
 * - Edit (all kinds) → EventEditDialog (inline). Live-edit model (TRIP-126):
 *   hotel/transfer no longer redirect into the structure editor. onEditInEditor
 *   is a legacy fallback used only for orphan entities lacking city context.
 * - Delete (canEdit) → confirm, delete the row, invalidate trip queries.
 */
import React, { useEffect, useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY, tripContentBinding, withOptimism } from '@/lib/trip-data';
import EventModal from '@/components/common/EventModal';
import EventEditDialog from '@/components/common/EventEditDialog';
import { useEntitySource } from '@/components/common/EventViewBody';
import { useT } from '@/lib/i18n/I18nContext';
import { useToast } from '@/design/index';
import { successToast } from '@/lib/successToast';
import { refusalError } from '@/lib/refusalError';
import { getSourceDocuments } from '@/lib/documents';
import { collectDocPaths } from '@/lib/storageCleanup';
import { ENTITY_TABLE_BY_KIND, deleteSourceEntity } from '@/lib/trip-entities';
import { errorText } from '@/lib/errorText';

const CACHE_KIND = { hotel: 'hotels', transfer: 'transfers', activity: 'activities', service: 'services' };

export default function SourceViewLoader({ tripId, kind, id, open, onOpenChange, canEdit = false, warning = null, subEvent = null, onEditInEditor = null }) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);

  // Reset edit mode whenever a fresh entity is opened.
  useEffect(() => { if (open) setEditMode(false); }, [open, kind, id]);

  // Shared loader (same fetch used by the editor's left-panel shell).
  const { data, visit, fromVisit, toVisit } = useEntitySource(kind, id, {
    tripId, open, onError: () => onOpenChange(false),
  });

  // Delete on the seam — INSTANT (SourceViewLoader stays mounted, so onError can roll
  // back): the row drops, the modal closes and the success toast fire TOGETHER at T0
  // (onOptimistic). On the rare refusal the seam restores the row and an error toast
  // supersedes. No dim-that-never-renders, no lingering card, no lagging toast.
  // Defined before the early return; id + orphan keys travel via mutate vars.
  const delBinding = tripContentBinding(qc, tripId, CACHE_KIND[kind]);
  const deleteMut = useMutation({
    mutationFn: async (/** @type {any} */ { id: rowId, tripId: tId, orphanPaths }) => {
      const { error, deleted, code } = await deleteSourceEntity(kind, rowId, tId, orphanPaths);
      if (error) throw refusalError(code);
      if (!deleted) throw Object.assign(new Error('write_rejected'), { code: 'NOT_FOUND' });
    },
    ...withOptimism(delBinding, {
      op: 'remove',
      onOptimistic: () => { onOpenChange(false); successToast(t, 'booking_deleted'); },
      onError: (/** @type {any} */ e) => toast({ description: e?.code ? errorText(t, e.code) : t('event.delete_failed'), variant: 'destructive' }),
    }),
  });

  if (!open || !data) return null;

  const invalidate = () => {
    const tripId = data.trip_id;
    if (tripId) {
      qc.invalidateQueries({ queryKey: TRIP_CONTENT_KEY(tripId) });
      qc.invalidateQueries({ queryKey: TRIP_SHELL_KEY(tripId) });
    }
  };

  const closeEdit = (o) => {
    if (!o) { setEditMode(false); onOpenChange(false); invalidate(); }
  };

  // Edit mode — inline EventEditDialog for every kind. hotel/activity use
  // `visit`, transfer uses `fromVisit`/`toVisit`, service stands alone; all
  // supplied by useEntitySource. Live-edit model (TRIP-126): editing a
  // hotel/transfer no longer redirects into the structure editor.
  if (editMode) {
    const haveCtx = (kind === 'hotel' && visit)
      || (kind === 'transfer' && (fromVisit || toVisit))
      || (kind === 'activity' && visit)
      || kind === 'service';
    if (haveCtx) {
      return (
        <EventEditDialog
          open
          onOpenChange={closeEdit}
          kind={kind}
          tripId={data.trip_id}
          entity={data}
          visit={visit}
          fromVisit={fromVisit}
          toVisit={toVisit}
        />
      );
    }
    // Orphan entity (no city context): fall back to the legacy editor nav if a
    // handler was provided, otherwise just leave edit mode.
    if (onEditInEditor) { onEditInEditor({ kind, id: data.id }); onOpenChange(false); }
    else { setEditMode(false); }
    return null;
  }

  const handleDelete = () => {
    if (!ENTITY_TABLE_BY_KIND[kind]) return;
    // Capture attachment object keys before delete; deleteSourceEntity sweeps
    // best-effort only after the row is actually gone (TRIP-117).
    const orphanPaths = collectDocPaths(getSourceDocuments(kind, data));
    deleteMut.mutate({ id: data.id, tripId: data.trip_id, orphanPaths });
  };

  // All kinds edit inline via EventEditDialog (live-edit model, TRIP-126).
  const handleEdit = () => setEditMode(true);

  return (
    <EventModal
      event={{ kind, entity: data, visit, fromVisit, toVisit, subEvent, tripId: data.trip_id }}
      warning={warning}
      canEdit={canEdit}
      onClose={() => onOpenChange(false)}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  );
}
