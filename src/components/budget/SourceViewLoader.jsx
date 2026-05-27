/**
 * Loads a source entity (HotelStay / Transfer / Activity / TripService) by id
 * and opens the corresponding ViewDialog. Used when the user taps a system
 * expense in the budget — to see what created it.
 *
 * If `canEdit` is true, ViewDialog shows its Edit button which swaps the view
 * for the edit Dialog — same flow as everywhere else in the app.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '@/api/supabaseClient';
import HotelViewDialog from '@/components/hotels/HotelViewDialog';
import TransferViewDialog from '@/components/transfers/TransferViewDialog';
import ActivityViewDialog from '@/components/activities/ActivityViewDialog';
import ServiceViewDialog from '@/components/services/ServiceViewDialog';
import HotelDialog from '@/components/hotels/HotelDialog';
import TransferDialog from '@/components/transfers/TransferDialog';
import ActivityDialog from '@/components/activities/ActivityDialog';
import ServiceDialog from '@/components/services/ServiceDialog';

async function getRow(table, id) {
  const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

export default function SourceViewLoader({ kind, id, open, onOpenChange, canEdit = false }) {
  const [data, setData] = useState(null);
  const [visit, setVisit] = useState(null);
  const [fromVisit, setFromVisit] = useState(null);
  const [toVisit, setToVisit] = useState(null);
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    setEditMode(false);
    (async () => {
      try {
        if (kind === 'hotel') {
          const h = await getRow('hotel_stays', id);
          if (cancelled) return;
          setData(h);
          if (h?.city_visit_id) {
            const v = await getRow('city_visits', h.city_visit_id).catch(() => null);
            if (!cancelled) setVisit(v);
          }
        } else if (kind === 'transfer') {
          const tr = await getRow('transfers', id);
          if (cancelled) return;
          setData(tr);
          const [fv, tv] = await Promise.all([
            tr?.from_city_visit_id ? getRow('city_visits', tr.from_city_visit_id).catch(() => null) : null,
            tr?.to_city_visit_id ? getRow('city_visits', tr.to_city_visit_id).catch(() => null) : null,
          ]);
          if (!cancelled) { setFromVisit(fv); setToVisit(tv); }
        } else if (kind === 'activity') {
          const a = await getRow('activities', id);
          if (cancelled) return;
          setData(a);
          if (a?.city_visit_id) {
            const v = await getRow('city_visits', a.city_visit_id).catch(() => null);
            if (!cancelled) setVisit(v);
          }
        } else if (kind === 'service') {
          const s = await getRow('trip_services', id);
          if (cancelled) return;
          setData(s);
        }
      } catch {
        if (!cancelled) onOpenChange(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, kind, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !data) return null;

  if (editMode) {
    const closeEdit = (o) => {
      if (!o) {
        setEditMode(false);
        onOpenChange(false);
      }
    };
    if (kind === 'hotel' && visit) {
      return <HotelDialog open onOpenChange={closeEdit} visit={visit} hotel={data} />;
    }
    if (kind === 'transfer' && fromVisit && toVisit) {
      return (
        <TransferDialog
          open
          onOpenChange={closeEdit}
          tripId={data.trip_id}
          fromVisit={fromVisit}
          toVisit={toVisit}
          transfer={data}
        />
      );
    }
    if (kind === 'activity' && visit) {
      return <ActivityDialog open onOpenChange={closeEdit} visit={visit} activity={data} />;
    }
    if (kind === 'service') {
      return <ServiceDialog open onOpenChange={closeEdit} tripId={data.trip_id} kind={data.kind} service={data} />;
    }
    return null;
  }

  const handleEdit = () => setEditMode(true);

  if (kind === 'hotel') {
    return <HotelViewDialog open={open} onOpenChange={onOpenChange} hotel={data} visit={visit} onEdit={canEdit ? handleEdit : undefined} readOnly={!canEdit} />;
  }
  if (kind === 'transfer') {
    if (!fromVisit || !toVisit) return null;
    return <TransferViewDialog open={open} onOpenChange={onOpenChange} transfer={data} fromVisit={fromVisit} toVisit={toVisit} onEdit={canEdit ? handleEdit : undefined} readOnly={!canEdit} />;
  }
  if (kind === 'activity') {
    if (!visit) return null;
    return <ActivityViewDialog open={open} onOpenChange={onOpenChange} activity={data} visit={visit} onEdit={canEdit ? handleEdit : undefined} readOnly={!canEdit} />;
  }
  if (kind === 'service') {
    return <ServiceViewDialog open={open} onOpenChange={onOpenChange} service={data} onEdit={canEdit ? handleEdit : undefined} readOnly={!canEdit} />;
  }
  return null;
}