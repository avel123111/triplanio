/**
 * Loads a source entity (HotelStay / Transfer / Activity / TripService) by id
 * and opens the unified EventModal (new design). Used both from the timeline
 * (tap an event) and the budget (tap a system expense to see what created it).
 *
 * - View → EventModal (new design).
 * - Edit (canEdit) → the existing create/edit Dialog for that entity.
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
import ServiceDialog from '@/components/services/ServiceDialog';

const TABLE_BY_KIND = {
  hotel: 'hotel_stays',
  transfer: 'transfers',
  activity: 'activities',
  service: 'trip_services',
};

export default function SourceViewLoader({ kind, id, open, onOpenChange, canEdit = false, warning = null }) {
  const t = useT();
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

  // Edit mode - swap in the unified create/edit dialog. Non-car-rental
  // services (esim, insurance) stay on the simple ServiceDialog since the
  // unified one only models the rich car-rental shape.
  if (editMode) {
    const closeEdit = (o) => {
      if (!o) { setEditMode(false); onOpenChange(false); invalidate(); }
    };
    if (kind === 'service' && data.kind && data.kind !== 'car_rental') {
      return <ServiceDialog open onOpenChange={closeEdit} tripId={data.trip_id} kind={data.kind} service={data} />;
    }
    if ((kind === 'hotel' && visit)
        || (kind === 'transfer' && fromVisit && toVisit)
        || (kind === 'activity' && visit)
        || kind === 'service') {
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
    return null;
  }

  const handleDelete = async () => {
    const table = TABLE_BY_KIND[kind];
    if (!table) return;
    const { error } = await supabase.from(table).delete().eq('id', data.id);
    if (error) { alert(t('event.delete_failed') + ': ' + error.message); throw error; }
    onOpenChange(false);
    invalidate();
  };

  return (
    <EventModal
      event={{ kind, entity: data, visit, fromVisit, toVisit, tripId: data.trip_id }}
      warning={warning}
      canEdit={canEdit}
      onClose={() => onOpenChange(false)}
      onEdit={() => setEditMode(true)}
      onDelete={handleDelete}
    />
  );
}
