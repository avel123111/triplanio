import React, { useState } from 'react';
import { DateTime } from 'luxon';
import { Icon } from '../../design/icons';
import { useT } from '@/lib/i18n/I18nContext';

// The one picker panel of the app (TRIP-277). Three modes, one grammar:
//   date      month grid            (trip start, insurance, budget, stats)
//   datetime  month grid + clock    (hotel / transfer / car rental)
//   time      clock                 (activity start & end)
// The clock is built from the SAME parts as the month: a head with the current
// value, a caption row, and a grid of `.ts-cal__day` chips. Hours and minutes
// are grids, not scroll columns — everything is on screen at once, and a chip
// of time is the same object as a chip of date. Odd minutes (14:37) are typed
// into the head, which is why the minute grid can stay a clean 5-minute step.
// Mon-first, localized weekday/month names. `onPick` gets an ISO date,
// `onTimeChange` an "HH:mm" string.

const pad2 = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 12 }, (_, i) => pad2(i * 5));

// One typed segment of the head clock. Digits only; two digits commit on their
// own so "1430" flows through both boxes without the user reaching for Tab.
function TimeSeg({ value, max, onCommit, label }) {
  const [draft, setDraft] = useState(null);
  const commit = (raw) => {
    setDraft(null);
    if (raw === '' || raw == null) return;
    onCommit(pad2(Math.min(max, Number(raw))));
  };
  return (
    <input
      className="ts-time__seg"
      inputMode="numeric"
      aria-label={label}
      placeholder="--"
      value={draft ?? value}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 2);
        if (digits.length === 2) commit(digits); else setDraft(digits);
      }}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => commit(draft ?? e.target.value)}
      onKeyDown={(e) => {
        // Enter inside a form would submit it — here it just commits the digits.
        if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); return; }
        const delta = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        const base = Number(draft ?? value ?? 0) || 0;
        commit(String(Math.min(max, Math.max(0, base + delta))));
      }}
    />
  );
}

function TimeGrid({ label, values, selected, onPick }) {
  return (
    <>
      <span className="ts-cal__wdc ts-time__lbl">{label}</span>
      <div className="ts-cal__grid ts-time__grid">
        {values.map((v) => (
          <button
            key={v}
            type="button"
            className={'ts-cal__day' + (v === selected ? ' on' : '')}
            onClick={() => onPick(v)}
          >{v}</button>
        ))}
      </div>
    </>
  );
}

function TimePanel({ value, onChange }) {
  const t = useT();
  const [hh = '', mm = ''] = String(value || '').split(':');
  const set = (h, m) => onChange?.(`${h || '00'}:${m || '00'}`);
  return (
    <div className="ts-time">
      <div className="ts-cal__head ts-time__head">
        <TimeSeg value={hh} max={23} label={t('common.hours')} onCommit={(h) => set(h, mm)} />
        <span className="ts-cal__title">:</span>
        <TimeSeg value={mm} max={59} label={t('common.minutes')} onCommit={(m) => set(hh, m)} />
      </div>
      <TimeGrid label={t('common.hours')} values={HOURS} selected={hh} onPick={(h) => set(h, mm)} />
      <TimeGrid label={t('common.minutes')} values={MINUTES} selected={mm} onPick={(m) => set(hh, m)} />
    </div>
  );
}

export default function StartCalendar({ value, onPick, lang = 'ru', mode = 'date', time = '', onTimeChange }) {
  const sel = value ? DateTime.fromISO(value, { zone: 'utc' }) : null; // null → nothing highlighted
  const [view, setView] = useState((sel || DateTime.utc()).startOf('month'));
  const monday = DateTime.utc(2024, 1, 1); // a known Monday → localized weekday heads
  const lead = (view.weekday + 6) % 7;     // cells before day 1 (Mon-first)
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= view.daysInMonth; d++) cells.push(d);
  return (
    <div className={`ts-cal ts-cal--${mode}`}>
      {mode !== 'time' && (
        <div className="ts-cal__date">
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
                  className={'ts-cal__day' + (sel?.hasSame(view.set({ day: d }), 'day') ? ' on' : '')}
                  onClick={() => onPick(view.set({ day: d }).toISODate())}
                >{d}</button>
            ))}
          </div>
        </div>
      )}
      {mode !== 'date' && <TimePanel value={time} onChange={onTimeChange} />}
    </div>
  );
}
