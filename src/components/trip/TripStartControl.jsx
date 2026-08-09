import React, { useState } from 'react';
import { DateTime } from 'luxon';
import StartCalendar from '@/components/create/StartCalendar';
import { Popover, PopoverTrigger, PopoverContent, Sheet, Stepper } from '@/design/index';
import { useIsPhone } from '@/hooks/use-mobile';
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
  const isSheet = useIsPhone();
  const pick = (iso) => { if (iso) onPickDate?.(iso); setCalOpen(false); };

  // Дата — центр степпера. НЕ `<button>` (иначе её задело бы `.stepper button`),
  // а `<span role=button>` со своей клавиатурой; на десктопе триггер Popover'а,
  // на телефоне открывает Sheet.
  const onDateKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } };
  const dateProps = { className: 'ts-startctl__date', role: 'button', tabIndex: 0, 'aria-label': t('planner.trip_start'), onKeyDown: onDateKey };
  const dateBtn = isSheet
    ? <span {...dateProps} onClick={() => setCalOpen(true)}>{fmtDW(date, lang)}</span>
    : (
      <Popover open={calOpen} onOpenChange={setCalOpen}>
        <PopoverTrigger asChild>
          <span {...dateProps}>{fmtDW(date, lang)}</span>
        </PopoverTrigger>
        <PopoverContent align={popoverAlign} className="ts-startcal-pop">
          <StartCalendar value={date} lang={lang} onPick={pick} />
        </PopoverContent>
      </Popover>
    );

  const stepper = (
    <Stepper
      variant={block ? 'block' : 'bare'}
      title={t('planner.trip_start')}
      onMinus={() => onStep?.(-1)} minusLabel={t('planner.day_earlier')}
      onPlus={() => onStep?.(1)} plusLabel={t('planner.day_later')}
    >{dateBtn}</Stepper>
  );

  return (
    <>
      {block ? stepper : (
        <span className="ts-startctl">
          {label ? <span className="ts-startctl__lbl">{label}</span> : null}
          {stepper}
        </span>
      )}
      {isSheet && (
        <Sheet open={calOpen} onOpenChange={setCalOpen} title={t('planner.trip_start')}>
          <StartCalendar value={date} lang={lang} onPick={pick} />
        </Sheet>
      )}
    </>
  );
}
