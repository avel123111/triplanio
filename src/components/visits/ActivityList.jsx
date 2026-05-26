import React, { useState } from 'react';
import { MoreVertical, Trash2, Plus, AlertTriangle, MapPin, Utensils, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { formatInTz } from '@/lib/time';
import { activityWarnings } from '@/lib/validation';
import { base44 } from '@/api/base44Client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import ConfirmDialog from '@/components/common/ConfirmDialog';

/** Picks a category-ish icon for an activity (consistent violet tone) */
function iconForActivity(title = '') {
  const t = title.toLowerCase();
  const tone = 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300';
  if (/(dinner|lunch|breakfast|food|restaurant|trattoria|cafe|brunch)/.test(t)) return { Icon: Utensils, tone };
  if (/(tour|museum|gallery|colosseum|temple|monument|sight|park)/.test(t)) return { Icon: Camera, tone };
  return { Icon: MapPin, tone };
}

export default function ActivityList({ visit, activities, onAdd, onEdit, onView, hideAddButton = false }) {
  const { t } = useI18nFormat();
  const qc = useQueryClient();
  const [confirmDel, setConfirmDel] = useState({ open: false, activity: null });
  const del = useMutation({
    mutationFn: (id) => base44.entities.Activity.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activities', visit.trip_id] }),
  });

  const tz = visit.timezone || 'UTC';
  const sorted = [...activities].sort((a, b) => new Date(a.start_datetime) - new Date(b.start_datetime));

  return (
    <div className="space-y-1.5">
      {sorted.map(a => {
        const warns = activityWarnings(a, visit);
        const { Icon, tone } = iconForActivity(a.title);
        return (
          <div
            key={a.id}
            onClick={() => onView ? onView(a) : onEdit(a)}
            className="group flex items-center gap-3 p-2.5 rounded-lg bg-secondary/50 hover:bg-secondary transition cursor-pointer"
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{a.title}</span>
                {warns.length > 0 && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                <span>{formatInTz(a.start_datetime, tz, 'd LLL')} · {formatInTz(a.start_datetime, tz, 'HH:mm')} - {formatInTz(a.end_datetime, tz, 'HH:mm')}</span>
                {a.location_name && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{a.location_name}</span>}
              </div>
            </div>
            <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="w-8 h-8 opacity-60 group-hover:opacity-100">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setConfirmDel({ open: true, activity: a })} className="text-destructive focus:text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-2" />{t('activity.delete_short')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          </div>
        );
      })}
      {!hideAddButton && (
        <button onClick={onAdd} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
          <Plus className="w-3 h-3" />{t('activity.add_btn')}
        </button>
      )}
      <ConfirmDialog
        open={confirmDel.open}
        onOpenChange={(o) => setConfirmDel((s) => ({ ...s, open: o }))}
        title={t('common.delete_confirm_title')}
        description={confirmDel.activity ? t('activity.delete_prompt', { title: confirmDel.activity.title }) : ''}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={() => {
          if (confirmDel.activity) del.mutate(confirmDel.activity.id);
          setConfirmDel({ open: false, activity: null });
        }}
      />
    </div>
  );
}