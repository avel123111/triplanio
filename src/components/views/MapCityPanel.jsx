import React, { useEffect, useState } from 'react';
import { X, BedDouble, Camera, Calendar, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { countryFlag } from '@/lib/geo';
import { formatInTz } from '@/lib/time';
import { parseNaive, naiveMillis } from '@/lib/naive-time';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { useCityImageForVisits } from '@/lib/city-image';

/**
 * Side / bottom panel shown over the map when a city marker is clicked.
 *
 * Accepts an array of visits (a city may appear more than once — e.g. start
 * and finish in the same place — and then we render one block per visit).
 *
 * Sections "Проживание" and "Активности" are hidden for visits with
 * kind === 'start' or 'end' — those points are not meant to host bookings.
 *
 * Edit / view of hotels & activities is handled in their own dialogs; visit
 * editing happens in TripEdit. So this panel only shows data + "add" buttons
 * (when canEdit) and opens VIEW dialogs on item click — no pencils here.
 */
export default function MapCityPanel({
  visits,
  hotelsByVisitId,
  activitiesByVisitId,
  canEdit,
  onClose,
  onViewHotel,
  onAddHotel,
  onViewActivity,
  onAddActivity,
}) {
  const { t } = useI18nFormat();
  const list = (visits || []).filter(Boolean);
  const idsKey = list.map(v => v.id).join('|');

  // Which visit's body is currently expanded (when there are 2+ visits).
  const [activeId, setActiveId] = useState(list[0]?.id || null);
  useEffect(() => {
    // Reset when the user picks a different city marker.
    if (list[0]) setActiveId(list[0].id);
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = list[0] || null;
  const cityImg = useCityImageForVisits(head ? [head] : []);
  if (list.length === 0) return null;

  return (
    <div
      className="
        absolute z-10 flex flex-col rounded-2xl border bg-card shadow-xl overflow-hidden
        inset-x-3 bottom-3 max-h-[70%]
        md:inset-x-auto md:bottom-3 md:top-3 md:left-3 md:right-auto
        md:w-[300px] md:max-w-[calc(100%-1.5rem)] md:max-h-none
      "
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 py-3 border-b">
        <div
          className="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-secondary flex items-center justify-center"
          aria-hidden="true"
        >
          {cityImg ? (
            <img src={cityImg} alt="" className="w-full h-full object-cover" />
          ) : (
            <MapPin className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-base font-semibold">
            <span className="truncate">{head.city_name}</span>
            <span>{countryFlag(head.country_code)}</span>
          </div>
          {head.country && (
            <div className="text-[11px] text-muted-foreground mt-0.5">{head.country}</div>
          )}
          {list.length > 1 && (
            <div className="text-[11px] text-muted-foreground mt-1">
              {t('visit.multiple_visits', { count: list.length })}
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0" onClick={onClose} aria-label={t('common.close')}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Body — one block per visit */}
      <div className="flex-1 overflow-y-auto">
        {list.map((visit, idx) => (
          <VisitBlock
            key={visit.id}
            visit={visit}
            hotels={hotelsByVisitId[visit.id] || []}
            activities={activitiesByVisitId[visit.id] || []}
            canEdit={canEdit}
            isOpen={list.length === 1 ? true : activeId === visit.id}
            isMulti={list.length > 1}
            isLast={idx === list.length - 1}
            onToggle={() => setActiveId(visit.id)}
            onViewHotel={onViewHotel}
            onAddHotel={onAddHotel}
            onViewActivity={onViewActivity}
            onAddActivity={onAddActivity}
          />
        ))}
      </div>

      {/* Footer — close */}
      <div className="border-t p-3">
        <Button variant="outline" size="sm" className="w-full" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
    </div>
  );
}

function VisitBlock({
  visit, hotels, activities, canEdit, isOpen, isMulti, isLast,
  onToggle, onViewHotel, onAddHotel, onViewActivity, onAddActivity,
}) {
  const { t } = useI18nFormat();
  // Naive wall-clock — visit.timezone is intentionally ignored.
  const start = parseNaive(visit.start_datetime);
  const end = parseNaive(visit.end_datetime);
  const range = start && end
    ? (start.hasSame(end, 'day')
        ? start.toFormat('d LLL yyyy')
        : `${start.toFormat('d LLL')} → ${end.toFormat('d LLL yyyy')}`)
    : null;

  const isEndpoint = visit.kind === 'start' || visit.kind === 'end';
  const endpointLabel = visit.kind === 'start' ? t('visit.point_start') : visit.kind === 'end' ? t('visit.point_end') : null;

  const sortedHotels = [...hotels].sort(
    (a, b) => naiveMillis(a.check_in_datetime) - naiveMillis(b.check_in_datetime)
  );
  const sortedActs = [...activities].sort(
    (a, b) => naiveMillis(a.start_datetime) - naiveMillis(b.start_datetime)
  );

  return (
    <div className={`px-4 py-3 ${!isLast ? 'border-b' : ''}`}>
      {/* Header per visit (clickable only when there are multiple visits) */}
      <button
        type="button"
        onClick={isMulti ? onToggle : undefined}
        className={`w-full text-left ${isMulti ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-2">
          {range ? (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{range}</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">{t('visit.no_dates')}</div>
          )}
          {endpointLabel && (
            <span className="ml-auto text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground">
              {endpointLabel}
            </span>
          )}
        </div>
      </button>

      {isOpen && (
        <div className="mt-3 space-y-4">
          {visit.notes && (
            <div className="text-xs text-muted-foreground whitespace-pre-wrap line-clamp-6">
              {visit.notes}
            </div>
          )}

          {/* Hotels & activities are only relevant for transit visits. */}
          {!isEndpoint && (
            <>
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                    <BedDouble className="w-3.5 h-3.5" />
                    <span>{t('visit.section_stay')}</span>
                  </div>
                  {canEdit && onAddHotel && (
                    <Button
                      variant="ghost" size="sm" className="h-6 px-2 text-xs"
                      onClick={() => onAddHotel(visit)}
                    >
                      + {t('visit.add_short')}
                    </Button>
                  )}
                </div>
                {sortedHotels.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t('visit.empty_bookings')}</div>
                ) : (
                  <ul className="space-y-1.5">
                    {sortedHotels.map((h) => (
                      <li
                        key={h.id}
                        className="flex items-start gap-2 p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition cursor-pointer"
                        onClick={() => onViewHotel?.(h)}
                      >
                        <div className="w-7 h-7 rounded-md bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-300 flex items-center justify-center shrink-0">
                          <BedDouble className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{h.name}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {formatInTz(h.check_in_datetime, null, 'd LLL')} → {formatInTz(h.check_out_datetime, null, 'd LLL')}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                    <Camera className="w-3.5 h-3.5" />
                    <span>{t('visit.section_activities')}</span>
                  </div>
                  {canEdit && onAddActivity && (
                    <Button
                      variant="ghost" size="sm" className="h-6 px-2 text-xs"
                      onClick={() => onAddActivity(visit)}
                    >
                      + {t('visit.add_short')}
                    </Button>
                  )}
                </div>
                {sortedActs.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t('visit.empty_activities')}</div>
                ) : (
                  <ul className="space-y-1.5">
                    {sortedActs.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-start gap-2 p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition cursor-pointer"
                        onClick={() => onViewActivity?.(a)}
                      >
                        <div className="w-7 h-7 rounded-md bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 flex items-center justify-center shrink-0">
                          <MapPin className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{a.title}</div>
                          <div className="text-[10px] text-muted-foreground truncate">
                            {formatInTz(a.start_datetime, null, 'd LLL HH:mm')}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}