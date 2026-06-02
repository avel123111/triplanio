import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Building2, MoreVertical, Pencil, Trash2, AlertTriangle, Plus, BedDouble } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { formatInTz } from '@/lib/time';
import { countryFlag } from '@/lib/geo';
import HotelTimeline from './HotelTimeline';
import ActivityList from './ActivityList';
import CityWeather from './CityWeather';
import ForkPartnerModal from '@/components/bookings/ForkPartnerModal';
import CityNotesBlock from '@/components/views/CityNotesBlock';
import { parseNaive } from '@/lib/naive-time';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

// Naive wall-clock difference - timezone is intentionally ignored.
function nightsBetween(startIso, endIso) {
  const s = parseNaive(startIso)?.startOf('day');
  const e = parseNaive(endIso)?.startOf('day');
  if (!s || !e) return 0;
  return Math.max(0, Math.round(e.diff(s, 'days').days));
}

export default function CityVisitCard({
  visit, hotels, activities,
  hasNextVisit, hasTransferToNext,
  onEdit, onDelete,
  onAddHotel, onEditHotel, onViewHotel,
  onAddActivity, onEditActivity, onViewActivity,
}) {
  const { t, plural } = useI18nFormat();
  // Cities start collapsed in the edit view so the timeline stays compact;
  // user clicks the header to expand the details (hotels / activities / notes).
  const [open, setOpen] = useState(false);
  const nights = nightsBetween(visit.start_datetime, visit.end_datetime);
  // Same-day visits (0 nights) don't need lodging - hide the "no hotel" warning.
  const showNoHotelChip = nights >= 1 && hotels.length === 0;
  // For same-day visits we also hide the inline empty-hotel prompt below.
  const isSameDayVisit = nights === 0;
  const showNoTransferChip = hasNextVisit && !hasTransferToNext;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-3 p-4 text-left hover:bg-secondary/30 transition"
      >
        <Building2 className="w-5 h-5 text-primary mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-lg leading-tight flex items-center gap-2 flex-wrap">
            <span>{visit.city_name}{visit.country ? `, ${visit.country}` : ''}</span>
            {visit.country_code && <span className="text-xl leading-none">{countryFlag(visit.country_code)}</span>}
          </h3>
          <div className="text-xs text-muted-foreground mt-0.5">
            {formatInTz(visit.start_datetime, null, 'd LLL')}
            {' → '}
            {formatInTz(visit.end_datetime, null, 'd LLL')}
            {nights > 0 && <span> · {nights} {plural(nights, 'view.nights')}</span>}
          </div>

          {/* Always-visible status chips */}
          {(showNoHotelChip || showNoTransferChip) && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {showNoHotelChip && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-destructive/10 text-destructive text-[11px] font-medium">
                  <BedDouble className="w-3 h-3" />{t('visit.no_hotel_chip')}
                </span>
              )}
              {showNoTransferChip && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-destructive/10 text-destructive text-[11px] font-medium">
                  <AlertTriangle className="w-3 h-3" />{t('visit.no_transfer_chip')}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="w-8 h-8"><MoreVertical className="w-4 h-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}><Pencil className="w-3.5 h-3.5 mr-2" />{t('visit.edit_visit')}</DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="w-3.5 h-3.5 mr-2" />{t('visit.delete_visit')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {open ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border">
          <div className="pt-3">
            <CityWeather visit={visit} />
          </div>

          {/* Hotels - hide entirely for same-day visits (no overnight). */}
          {!isSameDayVisit && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{t('visit.section_stay')}</div>
              {hotels.length > 0 ? (
                <HotelTimeline visit={visit} hotels={hotels} onAdd={() => onAddHotel(visit)} onEdit={(h) => onEditHotel(visit, h)} onView={onViewHotel ? (h) => onViewHotel(visit, h) : undefined} />
              ) : (
                <EmptyHotel onAdd={() => onAddHotel(visit)} visit={visit} />
              )}
            </div>
          )}

          {/* Activities */}
          {activities.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{t('visit.activities')}</div>
              <ActivityList
                visit={visit}
                activities={activities}
                onAdd={() => onAddActivity(visit)}
                onEdit={(a) => onEditActivity(visit, a)}
                onView={onViewActivity ? (a) => onViewActivity(visit, a) : undefined}
                hideAddButton
              />
            </div>
          )}

          {/* Action chips */}
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => onAddActivity(visit)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition"
            >
              <Plus className="w-3 h-3" />{t('visit.activity_short')}
            </button>
          </div>

          {/* Notes - always visible (with edit affordance) */}
          <CityNotesBlock
            notes={visit.notes}
            canEdit
            onEdit={onEdit}
          />
        </div>
      )}
    </div>
  );
}

function EmptyHotel({ onAdd, visit }) {
  const { t } = useI18nFormat();
  const [choiceOpen, setChoiceOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setChoiceOpen(true)}
        className="w-full inline-flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-dashed border-border bg-card hover:bg-secondary/40 text-sm transition"
      >
        <span className="inline-flex items-center gap-2 text-muted-foreground">
          <Plus className="w-3.5 h-3.5" />
          <BedDouble className="w-3.5 h-3.5" />
          <span>{t('visit.add_stay_to')}</span>
          <span className="font-medium text-foreground">{visit.city_name}</span>
        </span>
      </button>
      <ForkPartnerModal
        open={choiceOpen}
        onOpenChange={setChoiceOpen}
        type="hotel"
        visit={visit}
        tripId={visit?.trip_id}
        onManual={onAdd}
      />
    </>
  );
}