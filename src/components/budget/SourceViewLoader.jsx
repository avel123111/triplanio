/**
 * Loads a source entity (HotelStay / Transfer / Activity / TripService) by id
 * and opens the unified EventModal (new design). Used both from the timeline
 * (tap an event) and the budget (tap a system expense to see what created it).
 *
 * - View → EventModal (new design).
 * - Edit hotel/transfer → always navigates to edit screen (onEditInEditor).
 * - Edit activity → EventEditDialog (inline, no screen nav needed).
 * - Edit esim → EsimDialog (view→edit transition inside the dialog).
 * - Edit insurance → InsuranceDialog (view→edit transition inside the dialog).
 * - Edit car_rental → EventEditDialog.
 * - Delete (canEdit) → confirm, delete the row, invalidate trip queries.
 */
import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { TRIP_SHELL_KEY, TRIP_CONTENT_KEY } from '@/lib/trip-data';
import EventModal from '@/components/common/EventModal';
import EventEditDialog from '@/components/common/EventEditDialog';
import { useEntitySource } from '@/components/common/EventViewBody';
import { useT } from '@/lib/i18n/I18nContext';
import { useToast } from '@/components/ui/use-toast';
import EsimDialog from '@/components/services/EsimDialog';
import InsuranceDialog from '@/components/services/InsuranceDialog';

const TABLE_BY_KIND = {
  hotel: 'hotel_stays',
  transfer: 'transfers',
  activity: 'activities',
  service: 'trip_services',
};

export default function SourceViewLoader({ kind, id, open, onOpenChange, canEdit = false, warning = null, onEditInEditor = null }) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);

  // Reset edit mode whenever a fresh entity is opened.
  useEffect(() => { if (open) setEditMode(false); }, [open, kind, id]);

  // Shared loader (same fetch used by the editor's left-panel shell).
  const { data, visit, fromVisit, toVisit } = useEntitySource(kind, id, {
    open, onError: () => onOpenChange(false),
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

  // eSIM — use dedicated dialog that handles view+edit internally
  if (kind === 'service' && data.kind === 'esim') {
    return (
      <EsimDialog
        open={open}
        onOpenChange={(o) => { if (!o) { invalidate(); } onOpenChange(o); }}
        tripId={data.trip_id}
        service={data}
        canEdit={canEdit}
        defaultEditMode={editMode}
      />
    );
  }

  // Insurance — same pattern
  if (kind === 'service' && data.kind === 'insurance') {
    return (
      <InsuranceDialog
        open={open}
        onOpenChange={(o) => { if (!o) { invalidate(); } onOpenChange(o); }}
        tripId={data.trip_id}
        service={data}
        canEdit={canEdit}
        defaultEditMode={editMode}
      />
    );
  }

  // Edit mode for activity and car_rental — inline EventEditDialog
  if (editMode) {
    if ((kind === 'activity' && visit) || kind === 'service') {
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
    // hotel/transfer without onEditInEditor: shouldn't reach here normally,
    // but fall back to edit screen nav if available, otherwise close.
    if (onEditInEditor) { onEditInEditor({ kind, id: data.id }); onOpenChange(false); }
    else { setEditMode(false); }
    return null;
  }

  const handleDelete = async () => {
    const table = TABLE_BY_KIND[kind];
    if (!table) return;
    const { error } = await supabase.from(table).delete().eq('id', data.id);
    if (error) { toast({ description: t('event.delete_failed') + ': ' + error.message, variant: 'destructive' }); throw error; }
    onOpenChange(false);
    invalidate();
  };

  // Hotel and transfer: Edit button always goes to the edit screen.
  // Activity and car_rental: Edit button opens inline dialog.
  const handleEdit = () => {
    if ((kind === 'hotel' || kind === 'transfer') && onEditInEditor) {
      onOpenChange(false);
      onEditInEditor({ kind, id: data.id });
    } else {
      setEditMode(true);
    }
  };

  return (
    <EventModal
      event={{ kind, entity: data, visit, fromVisit, toVisit, tripId: data.trip_id }}
      warning={warning}
      canEdit={canEdit}
      onClose={() => onOpenChange(false)}
      onEdit={handleEdit}
      onDelete={handleDelete}
    />
  );
}
