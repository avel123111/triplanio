import React, { useState } from 'react';
import { DateTime } from 'luxon';
import { Icon } from '../../design/icons';
import { useT } from '@/lib/i18n/I18nContext';

// Shared month-grid calendar — extracted verbatim from TripStructureEdit so the
// editor and the trip-creation flow render the SAME mini calendar (one copy, one
// look). Mon-first, localized weekday/month names. `onPick` gets an ISO date.
//
// Two states, one calendar (TRIP-176): date-only (default) and date+time. When
// `withTime` is set a time row appears under the grid; `time` is an "HH:mm"
// string and `onTimeChange` reports edits. Callers that only need a date (trip
// start) simply omit these props and get the original date-only calendar.
export default function StartCalendar({ value, onPick, lang = 'ru', withTime = false, time = '', onTimeChange }) {
  const t = useT();
  const sel = value ? DateTime.fromISO(value, { zone: 'utc' }) : DateTime.utc();
  const [view, setView] = useState(sel.startOf('month'));
  const monday = DateTime.utc(2024, 1, 1); // a known Monday → localized weekday heads
  const lead = (view.weekday + 6) % 7;     // cells before day 1 (Mon-first)
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= view.daysInMonth; d++) cells.push(d);
  return (
    <div className="ts-cal">
      <div className="ts-cal__head">
        <button type="button" className="ts-step" onClick={() => setView(view.minus({ months: 1 }))} aria-label="←"><Icon name="chev" size={13} style={{ transform: 'rotate(180deg)' }} /></button>
        <span className="ts-cal__title">{view.setLocale(lang).toFormat('LLLL yyyy')}</span>
        <button type="button" className="ts-step" onClick={() => setView(view.plus({ months: 1 }))} aria-label="→"><Icon name="chev" size={13} /></button>
      </div>
      <div className="ts-cal__grid ts-cal__wd">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <span key={i} className="ts-cal__wdc">{monday.plus({ days: i }).setLocale(lang).toFormat('ccc')}</span>
        ))}
      </div>
      <div className="ts-cal__grid">
        {cells.map((d, i) => (d === null
          ? <span key={`e${i}`} />
          : <button
              key={d}
              type="button"
              className={'ts-cal__day' + (sel.hasSame(view.set({ day: d }), 'day') ? ' on' : '')}
              onClick={() => onPick(view.set({ day: d }).toISODate())}
            >{d}</button>
        ))}
      </div>
      {withTime && (
        <div className="ts-cal__time">
          <span className="ts-cal__time-lbl">{t('common.time')}</span>
          <input
            type="time"
            className="input ts-cal__time-in"
            value={time || ''}
            onChange={(e) => onTimeChange?.(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
