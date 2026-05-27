import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { BedDouble, MoreVertical, Trash2, Plus, AlertTriangle } from 'lucide-react';
import { formatInTz } from '@/lib/time';
import { hotelWarnings } from '@/lib/validation';
import { supabase } from '@/api/supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import BookingLinkButton from '@/components/hotels/BookingLinkButton';
import { DateTime } from 'luxon';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import ConfirmDialog from '@/components/common/ConfirmDialog';

export default function HotelTimeline({ visit, hotels, onAdd, onEdit, onView }) {
  const { t } = useI18nFormat();
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState({ open: false, hotel: null });
  const del = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('hotel_stays').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hotels', visit.trip_id] }),
  });

  const sorted = [...hotels].sort((a, b) => new Date(a.check_in_datetime) - new Date(b.check_in_datetime));
  const tz = visit.timezone || 'UTC';

  // Build hotel rows + "no hotel" gap rows.
  // Skip the initial gap on the arrival day (it's expected — you arrive,
  // sightsee, then check in later). Also skip gaps shorter than 12h.
  const rows = [];
  let cursor = visit.start_datetime ? new Date(visit.start_datetime).getTime() : null;
  let isFirstHotel = true;
  for (const h of sorted) {
    const ci = new Date(h.check_in_datetime).getTime();
    if (cursor !== null) {
      const gapHours = (ci - cursor) / 3_600_000;
      const checkInDay = DateTime.fromISO(h.check_in_datetime, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd');
      const visitStartDay = visit.start_datetime
        ? DateTime.fromISO(visit.start_datetime, { zone: 'utc' }).setZone(tz).toFormat('yyyy-LL-dd')
        : null;
      const isFirstDayCheckIn = isFirstHotel && checkInDay === visitStartDay;
      if (gapHours >= 24 && !isFirstDayCheckIn) {
        rows.push({ kind: 'gap', from: cursor, to: ci });
      }
    }
    rows.push({ kind: 'hotel', hotel: h });
    cursor = new Date(h.check_out_datetime).getTime();
    isFirstHotel = false;
  }

  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        if (r.kind === 'gap') {
          const hours = (r.to - r.from) / 3_600_000;
          return (
            <div key={`gap-${i}`} className="rounded-lg border border-dashed border-border bg-muted/30 text-[11px] text-muted-foreground px-3 py-2">
              {t('hotel.gap_no_hotel_hours', { hours: Math.round(hours) })}
            </div>
          );
        }
        const h = r.hotel;
        const warns = hotelWarnings(h, visit, sorted);
        return (
          <div
            key={h.id}
            onClick={() => onView?.(h)}
            className={`group flex items-center gap-3 p-2.5 rounded-lg bg-secondary/50 hover:bg-secondary transition ${onView ? 'cursor-pointer' : ''}`}
          >
            <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 flex items-center justify-center shrink-0">
              <BedDouble className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{h.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {formatInTz(h.check_in_datetime, tz, 'd LLL HH:mm')} → {formatInTz(h.check_out_datetime, tz, 'd LLL HH:mm')}
              </div>
              {h.booking_url && (
                <div className="mt-1">
                  <BookingLinkButton url={h.booking_url} platform={h.booking_platform} size="xs" />
                </div>
              )}
            </div>
            {warns.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="w-8 h-8 opacity-60 group-hover:opacity-100" onClick={e => e.stopPropagation()}>
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => setConfirmDel({ open: true, hotel: h })} className="text-destructive focus:text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-2" />{t('hotel.delete_short')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      <button onClick={onAdd} className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary/8 hover:bg-primary/15 px-2.5 py-1.5 rounded-lg transition">
        <Plus className="w-3 h-3" />{t('hotel.add_hotel')}
      </button>
      <ConfirmDialog
        open={confirmDel.open}
        onOpenChange={(o) => setConfirmDel((s) => ({ ...s, open: o }))}
        title={t('common.delete_confirm_title')}
        description={confirmDel.hotel ? t('hotel.delete_prompt', { name: confirmDel.hotel.name }) : ''}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={() => {
          if (confirmDel.hotel) del.mutate(confirmDel.hotel.id);
          setConfirmDel({ open: false, hotel: null });
        }}
      />
    </div>
  );
}