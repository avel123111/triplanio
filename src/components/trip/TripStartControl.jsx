import React, { useState } from 'react';
import { DateTime } from 'luxon';
import { Icon } from '../../design/icons';
import StartCalendar from '@/components/create/StartCalendar';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Sheet } from '@/components/ui/Sheet';
import { useT, useI18n } from '@/lib/i18n/I18nContext';

// ─── TripStartControl ─────────────────────────────────────────────────────────
// Shared trip-start control (.ts-startctl): a ±1-day stepper + the shared
// StartCalendar (Popover on desktop, Sheet on phones). PRESENTATIONAL — the host
// owns the date math via two callbacks, so the same control drives both the
// create-flow planner (anchors the first city) and the structural editor (shifts
// the whole itinerary). Collapses the former duplicate (TripStartControl inline
// in ManualPlanner + startDateControl inline in TripStructureEdit, both drawing
// the same .ts-startctl markup) into ONE element.
//
// Props:
//   date         current trip-start ISO (YYYY-MM-DD).
//   onStep(dir)  dir ∈ {-1, +1} — step the start one day earlier / later.
//   onPickDate(iso)  jump to an explicit date from the calendar.
//   label        optional eyebrow shown before the stepper (.ts-startctl__lbl).
//   block        full-width, input-height variant (create-flow step-1 form row)
//                so the control matches the adjacent .input; the compact inline
//                variant (header / review) is the default.
//   popoverAlign Popover alignment ('start' planner | 'end' editor header).
function fmtDW(iso, loc = 'ru') {
  if (!iso) return '—';
  const d = DateTime.fromISO(iso, { zone: 'utc' });
  return d.isValid ? d.setLocale(loc).toFormat('d MMM, ccc') : '—';
}

export default function TripStartControl({ date, onStep, onPickDate, label, block = false, popoverAlign = 'start' }) {
  const t = useT();
  const { lang } = useI18n();
  const [calOpen, setCalOpen] = useState(false);
  const isSheet = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
  const pick = (iso) => { if (iso) onPickDate?.(iso); setCalOpen(false); };

  return (
    <div className={'ts-startctl' + (block ? ' ts-startctl--block' : '')} title={t('planner.trip_start')}>
      {label ? <span className="ts-startctl__lbl">{label}</span> : null}
      <button type="button" className="ts-step" onClick={() => onStep?.(-1)} title={t('planner.day_earlier')} aria-label={t('planner.day_earlier')}>
        <Icon name="chev" size={13} style={{ transform: 'rotate(180deg)' }} />
      </button>
      {isSheet ? (
        <button type="button" className="ts-startctl__date" aria-label={t('planner.trip_start')} onClick={() => setCalOpen(true)}>{fmtDW(date, lang)}</button>
      ) : (
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <button type="button" className="ts-startctl__date" aria-label={t('planner.trip_start')}>{fmtDW(date, lang)}</button>
          </PopoverTrigger>
          <PopoverContent align={popoverAlign} className="ts-startcal-pop">
            <StartCalendar value={date} lang={lang} onPick={pick} />
          </PopoverContent>
        </Popover>
      )}
      <button type="button" className="ts-step" onClick={() => onStep?.(1)} title={t('planner.day_later')} aria-label={t('planner.day_later')}>
        <Icon name="chev" size={13} />
      </button>
      {isSheet && (
        <Sheet open={calOpen} onOpenChange={setCalOpen} title={t('planner.trip_start')}>
          <StartCalendar value={date} lang={lang} onPick={pick} />
        </Sheet>
      )}
    </div>
  );
}
