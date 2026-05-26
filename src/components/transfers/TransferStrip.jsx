import React, { useState } from 'react';
import { Plus, AlertTriangle, ChevronRight, ArrowRight, ExternalLink, ArrowLeftRight } from 'lucide-react';
import { transportInfo } from '@/lib/transport';
import { formatInTz } from '@/lib/time';
import { transferWarnings } from '@/lib/validation';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreVertical, Trash2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BOOKING_PLATFORMS, platformLogoUrl } from '@/lib/booking-platforms';
import BookingChoiceDialog from '@/components/bookings/BookingChoiceDialog';
import { transferPlatforms } from '@/components/bookings/buildBookingPlatforms';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import ConfirmDialog from '@/components/common/ConfirmDialog';

function durationLabel(startIso, endIso) {
  if (!startIso || !endIso) return '';
  const mins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60),m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function TransferStrip({ fromVisit, toVisit, transfer, tripId, onAdd, onEdit, onView }) {
  const { t } = useI18nFormat();
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState(false);
  const del = useMutation({
    mutationFn: (id) => base44.entities.Transfer.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfers', tripId] })
  });

  if (!transfer) {
    return <EmptyTransferStrip fromVisit={fromVisit} toVisit={toVisit} onAdd={onAdd} />;
  }

  const info = transportInfo(transfer.transport_type);
  const Icon = info.Icon;
  const warns = transferWarnings(transfer, fromVisit, toVisit);
  const startTz = fromVisit.timezone || 'UTC';
  const endTz = toVisit.timezone || 'UTC';
  const platformInfo = transfer.booking_platform ? BOOKING_PLATFORMS[transfer.booking_platform] : null;
  const platformLogo = platformLogoUrl(transfer.booking_platform, transfer.booking_url);

  return (
    <>
    <button
      onClick={() => (onView || onEdit)(transfer)}
      className="group w-full flex items-center gap-3 p-3 rounded-xl bg-primary/10 hover:bg-primary/15 text-left transition">
      
      <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium flex items-center gap-1.5">
          <span>{fromVisit.city_name}</span>
          <ArrowRight className="w-3 h-3 text-muted-foreground" />
          <span>{toVisit.city_name}</span>
          {transfer.carrier &&
          <span className="text-xs text-muted-foreground font-normal">· {transfer.carrier}</span>
          }
        </div>
        <div className="text-[11px] text-muted-foreground">
          {formatInTz(transfer.start_datetime, startTz, 'd LLL HH:mm')}
          {' → '}
          {formatInTz(transfer.end_datetime, endTz, 'd LLL HH:mm')}
          {' · '}{durationLabel(transfer.start_datetime, transfer.end_datetime)}
        </div>
        {transfer.booking_url &&
        <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <a
            href={transfer.booking_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-card hover:bg-secondary border border-border transition">
            
              {platformLogo ?
            <img src={platformLogo} alt="" className="w-3 h-3 rounded-sm" /> :

            <ExternalLink className="w-3 h-3" />
            }
              {platformInfo && transfer.booking_platform !== 'other' ? platformInfo.label : t('transfer.view_link_label')}
            </a>
          </div>
        }
      </div>
      {warns.length > 0 && <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />}
      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="w-8 h-8 opacity-60 group-hover:opacity-100">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setConfirmDel(true)} className="text-destructive focus:text-destructive">
              <Trash2 className="w-3.5 h-3.5 mr-2" />{t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
    <ConfirmDialog
      open={confirmDel}
      onOpenChange={setConfirmDel}
      title={t('common.delete_confirm_title')}
      description={t('transfer.delete_confirm')}
      confirmLabel={t('common.delete')}
      variant="destructive"
      onConfirm={() => { del.mutate(transfer.id); setConfirmDel(false); }}
    />
    </>);

}

function EmptyTransferStrip({ fromVisit, toVisit, onAdd }) {
  const { t } = useI18nFormat();
  const [choiceOpen, setChoiceOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setChoiceOpen(true)}
        className="w-full inline-flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-dashed border-border bg-card hover:bg-secondary/40 text-sm transition">
        
        <span className="inline-flex items-center gap-2 text-muted-foreground flex-wrap">
          <Plus className="w-3.5 h-3.5" />
          <ArrowLeftRight className="w-3.5 h-3.5 plane" />
          <span>{t('transfer.add')}</span>
          <span className="font-medium text-foreground">{fromVisit.city_name}</span>
          <ArrowRight className="w-3 h-3" />
          <span className="font-medium text-foreground">{toVisit.city_name}</span>
        </span>
        <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
      </button>
      <BookingChoiceDialog
        open={choiceOpen}
        onOpenChange={setChoiceOpen}
        title={t('transfer.add_dialog_title')}
        description={`${fromVisit.city_name} → ${toVisit.city_name}`}
        manualLabel={t('transfer.manual_short')}
        manualHint={t('transfer.manual_hint_tickets')}
        onManual={() => onAdd(fromVisit, toVisit)}
        platforms={transferPlatforms(fromVisit, toVisit)} />
      
    </>);

}