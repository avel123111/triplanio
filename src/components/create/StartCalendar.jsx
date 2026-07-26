import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { Icon } from '../../design/icons';
import { useT } from '@/lib/i18n/I18nContext';

// The one picker panel of the app (TRIP-277). Three modes, one grammar:
//   date      month grid only            (trip start, insurance, budget, stats)
//   datetime  month grid + time columns  (hotel / transfer / car rental)
//   time      time columns only          (activity start & end)
// The time side deliberately mirrors the month grid — column head + tappable
// cells with the same hover/selected skin — so date and time read as the same
// element rather than two aesthetics glued together (the native time input that
// used to sit here opened the OS widget inside our own popover).
// Mon-first, localized weekday/month names. `onPick` gets an ISO date,
// `onTimeChange` an "HH:mm" string.

const pad2 = (n) => String(n).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i));
const MOVES = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };

// One scrollable column (hours or minutes). The LIST is the single tab stop and
// arrows walk the values — 84 focusable cells would otherwise bury every other
// control in the form behind them. The selected cell is centred on mount and on
// arrow moves, but NOT on a click: re-centring under the cursor would slide the
// next value away mid-click.
function TimeColumn({ head, values, selected, onPick, idBase }) {
  const listRef = useRef(null);
  const selRef = useRef(null);
  const center = () => {
    const list = listRef.current;
    const cell = selRef.current;
    if (!list || !cell) return;
    list.scrollTop = cell.offsetTop - (list.clientHeight - cell.offsetHeight) / 2;
  };
  useLayoutEffect(center, []);
  // Keyboard moves keep the new value in view; a click deliberately does not.
  const pickAndCenter = (v) => { onPick(v); requestAnimationFrame(center); };
  const onKeyDown = (e) => {
    if (e.key in MOVES) {
      e.preventDefault();
      const i = values.indexOf(selected);
      const target = i < 0 ? 0 : i + MOVES[e.key]; // nothing picked yet → first value
      pickAndCenter(values[Math.min(values.length - 1, Math.max(0, target))]);
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      pickAndCenter(e.key === 'Home' ? values[0] : values[values.length - 1]);
    }
  };
  return (
    <div className="ts-time__col">
      <span className="ts-cal__wdc">{head}</span>
      <div
        className="ts-time__list" ref={listRef}
        // Inside the phone Sheet this column scrolls; without the opt-out vaul
        // reads the same drag as "dismiss the sheet".
        data-vaul-no-drag
        role="listbox" aria-label={head} tabIndex={0}
        aria-activedescendant={selected ? `${idBase}-${selected}` : undefined}
        onKeyDown={onKeyDown}
      >
        {values.map((v) => (
          <button
            key={v}
            id={`${idBase}-${v}`}
            type="button"
            tabIndex={-1}
            role="option"
            aria-selected={v === selected}
            ref={v === selected ? selRef : undefined}
            className={'ts-time__cell' + (v === selected ? ' on' : '')}
            onClick={() => onPick(v)}
          >{v}</button>
        ))}
      </div>
    </div>
  );
}

function TimePanel({ value, onChange }) {
  const t = useT();
  const id = useId();
  const [hh = '', mm = ''] = String(value || '').split(':');
  return (
    <div className="ts-time">
      {/* Same three rows as the month side: title · column heads · cells. */}
      <div className="ts-cal__head ts-time__head">
        <span className="ts-cal__title">{hh && mm ? `${hh}:${mm}` : '—:—'}</span>
      </div>
      <div className="ts-time__cols">
        <TimeColumn
          head={t('common.hours')} values={HOURS} selected={hh} idBase={`${id}h`}
          onPick={(h) => onChange?.(`${h}:${mm || '00'}`)}
        />
        <TimeColumn
          head={t('common.minutes')} values={MINUTES} selected={mm} idBase={`${id}m`}
          onPick={(m) => onChange?.(`${hh || '00'}:${m}`)}
        />
      </div>
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
