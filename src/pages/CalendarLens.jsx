/**
 * CalendarLens - calendar tab inside TripView.
 *
 * Props:
 *   stream   - array of stream events (from buildEventStream)
 *   visits   - array of cityVisit rows
 *   trip     - trip object with start_date / end_date
 *   isLoading - boolean
 */
import React, { useState, useMemo } from 'react';
import { Info } from 'luxon';
import { Icon } from '../design/icons';
import { Btn, Badge, Skeleton } from '../design/index';
import { parseNaive, naiveDayKey } from '@/lib/naive-time';
import { useI18n } from '@/lib/i18n/I18nContext';
import { localeTag } from '@/lib/i18n/translations';

// Localized month names (1-indexed) and weekday short names (Mon..Sun) via Luxon.
const monthNames = (lang) => ['', ...Info.months('long', { locale: localeTag(lang) })];
const weekdayNames = (lang) => Info.weekdays('short', { locale: localeTag(lang) });

// ─── constants ────────────────────────────────────────────────────────────────

const EVENT_COLOR = {
  'hotel-checkin':  'var(--success)',
  'hotel-checkout': 'var(--success)',
  activity:         'var(--ai)',
  flight:           'var(--brand)',
  transfer:         'var(--brand)',
};


// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend({ color, children }) {
  return (
    <span>
      <span style={{ display: 'inline-block', width: 10, height: 10, background: color, borderRadius: 2, marginRight: 6, verticalAlign: -1 }} />
      {children}
    </span>
  );
}

// ─── MonthView ────────────────────────────────────────────────────────────────

function MonthView({ cells, eventsByDay, spans, inTripDays }) {
  const { t, lang } = useI18n();
  const WD_NAMES = weekdayNames(lang);
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      {/* Weekday header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
        {WD_NAMES.map(w => (
          <div key={w} style={{
            padding: '10px 12px', fontSize: 11.5, color: 'var(--muted-2)',
            letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600,
            borderRight: '1px solid var(--line-2)',
          }}>{w}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 112 }}>
        {cells.map((d, i) => {
          const inTrip = d != null && inTripDays.has(d);
          const ev = d != null ? (eventsByDay[d] || []) : [];
          const cellSpans = d != null ? spans.filter(s => s.from === d) : [];

          return (
            <div key={i} style={{
              borderRight: '1px solid var(--line-2)',
              borderBottom: '1px solid var(--line-2)',
              padding: '8px 8px 6px',
              position: 'relative',
              background: inTrip ? 'var(--brand-soft)' : 'var(--surface)',
              opacity: d != null ? 1 : 0.3,
              overflow: 'visible',
            }}>
              {d != null && (
                <div style={{
                  fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13.5,
                  color: inTrip ? 'var(--brand)' : 'var(--ink-2)',
                }}>{d}</div>
              )}

              {/* City span bars - start on this day, extend right */}
              {cellSpans.map((s, si) => (
                <div key={si} style={{
                  position: 'absolute', left: 4, top: 28,
                  padding: '2px 6px', fontSize: 10.5, fontWeight: 500,
                  background: s.c, color: 'white', borderRadius: 4,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  width: `calc(${(s.to - s.from + 1) * 100}% + ${(s.to - s.from) * 1}px - 8px)`,
                  zIndex: 2,
                }}>{s.label}</div>
              ))}

              {/* Event dots */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 50, position: 'relative', zIndex: 3 }}>
                {ev.slice(0, 2).map((e, ei) => (
                  <div key={ei} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5 }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: e.c, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} className="num">
                      {e.time && <span className="muted">{e.time} </span>}{e.t}
                    </span>
                  </div>
                ))}
                {ev.length > 2 && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', paddingLeft: 9 }}>+{ev.length - 2} {t('calendar.more_count')}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── WeekView ─────────────────────────────────────────────────────────────────

function WeekView({ days, events }) {
  const { t } = useI18n();
  const HOURS = [];
  for (let h = 8; h <= 22; h++) HOURS.push(h);
  const HOUR_HEIGHT = 36;

  if (!days.length) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', border: '1px solid var(--line)', borderRadius: 14 }}>
        {t('calendar.week_no_data')}
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden' }}>
      {/* Day header */}
      <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', borderBottom: '1px solid var(--line)' }}>
        <div style={{ borderRight: '1px solid var(--line-2)' }} />
        {days.map((d, i) => (
          <div key={i} style={{ padding: '10px 8px', borderRight: i < 6 ? '1px solid var(--line-2)' : 'none', textAlign: 'center' }}>
            <div className="num" style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 19, letterSpacing: '-0.02em' }}>{d.date}</div>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', marginTop: 2 }}>{d.wd}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.city}</div>
          </div>
        ))}
      </div>

      {/* Hour grid + events */}
      <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', position: 'relative' }}>
        {/* Hours column */}
        <div style={{ borderRight: '1px solid var(--line-2)' }}>
          {HOURS.map(h => (
            <div key={h} style={{ height: HOUR_HEIGHT, fontSize: 10.5, color: 'var(--muted-2)', padding: '2px 6px', textAlign: 'right' }} className="num">
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* 7 day columns */}
        {days.map((d, di) => (
          <div key={di} style={{
            position: 'relative',
            borderRight: di < 6 ? '1px solid var(--line-2)' : 'none',
            backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent ${HOUR_HEIGHT - 1}px, var(--line-2) ${HOUR_HEIGHT - 1}px, var(--line-2) ${HOUR_HEIGHT}px)`,
            minHeight: HOURS.length * HOUR_HEIGHT,
          }}>
            {events.filter(e => e.day === di).map((e, ei) => {
              const top = (e.start - HOURS[0]) * HOUR_HEIGHT;
              const h = (e.end - e.start) * HOUR_HEIGHT;
              return (
                <div key={ei} style={{
                  position: 'absolute', left: 4, right: 4,
                  top, height: Math.max(h, 22),
                  background: e.c, color: 'white',
                  borderRadius: 5, padding: '3px 6px',
                  fontSize: 11, fontWeight: 500,
                  overflow: 'hidden', lineHeight: 1.3, cursor: 'pointer',
                }}>
                  <div className="num" style={{ fontSize: 10, opacity: 0.85 }}>
                    {Math.floor(e.start)}:{String(Math.round((e.start % 1) * 60)).padStart(2, '0')}
                  </div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.t}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── CalendarLens (main export) ───────────────────────────────────────────────

export default function CalendarLens({ stream, visits, trip, isLoading }) {
  const { t, lang } = useI18n();
  const MONTH_NAMES = useMemo(() => monthNames(lang), [lang]);
  const WD_NAMES = useMemo(() => weekdayNames(lang), [lang]);
  const [view, setView] = useState('month');
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset]   = useState(0);

  // Base start date from trip or first visit that actually has a date
  // (kind='start' cities have start_date=null, so we must skip them)
  const firstDatedVisit = visits.find(v => v.start_date);
  const baseDateStr = trip?.start_date
    || (firstDatedVisit ? naiveDayKey(firstDatedVisit.start_date) : null);
  const baseDate = baseDateStr ? parseNaive(baseDateStr + 'T00:00:00') : null;

  // Current month for display (with navigation offset)
  const currentMonth = baseDate ? baseDate.plus({ months: monthOffset }) : null;

  // Month grid data
  const { cells, year, monthNum, monthLabel } = useMemo(() => {
    if (!currentMonth) return { cells: [], year: 0, monthNum: 0, monthLabel: '-' };
    const y = currentMonth.year;
    const m = currentMonth.month;
    const firstDay = currentMonth.startOf('month');
    const daysInMonth = currentMonth.daysInMonth;
    const offset = firstDay.weekday - 1; // Luxon 1=Mon → offset 0=Mon
    const result = [];
    for (let i = 0; i < offset; i++) result.push(null);
    for (let d = 1; d <= daysInMonth; d++) result.push(d);
    return { cells: result, year: y, monthNum: m, monthLabel: `${MONTH_NAMES[m]} ${y}` };
  }, [currentMonth, MONTH_NAMES]);

  // Events keyed by day-of-month for current month
  const eventsByDay = useMemo(() => {
    const map = {};
    for (const e of stream) {
      if (!e.date) continue;
      const dt = parseNaive(e.date + 'T00:00:00');
      if (!dt || dt.year !== year || dt.month !== monthNum) continue;
      const d = dt.day;
      if (!map[d]) map[d] = [];
      map[d].push({ t: e.title, c: EVENT_COLOR[e.type] || 'var(--muted)', time: e.time || '' });
    }
    return map;
  }, [stream, year, monthNum]);

  // City span bars for current month (from visits, clamped to month bounds)
  const spans = useMemo(() => {
    if (!currentMonth) return [];
    return visits.flatMap(v => {
      const start = parseNaive(v.start_date);
      const end   = parseNaive(v.end_date);
      if (!start || !end) return [];
      const mStart = currentMonth.startOf('month');
      const mEnd   = currentMonth.endOf('month');
      const cStart = start < mStart ? mStart : start;
      const cEnd   = end   > mEnd   ? mEnd   : end;
      if (cStart > cEnd) return [];
      return [{ from: cStart.day, to: cEnd.day, label: v.city_name || '-', c: 'var(--brand)' }];
    });
  }, [visits, currentMonth]);

  // Set of day-of-month numbers that are within any city visit
  const inTripDays = useMemo(() => {
    const set = new Set();
    for (const v of visits) {
      const start = parseNaive(v.start_date);
      const end   = parseNaive(v.end_date);
      if (!start || !end) continue;
      let cur = start;
      while (cur <= end) {
        if (cur.year === year && cur.month === monthNum) set.add(cur.day);
        cur = cur.plus({ days: 1 });
      }
    }
    return set;
  }, [visits, year, monthNum]);

  // Week view data
  const { weekDays, weekEvents, weekLabel } = useMemo(() => {
    if (!baseDateStr) return { weekDays: [], weekEvents: [], weekLabel: '' };
    const tripStart = parseNaive(baseDateStr + 'T00:00:00');
    if (!tripStart) return { weekDays: [], weekEvents: [], weekLabel: '' };
    const weekStart = tripStart.startOf('week').plus({ weeks: weekOffset });
    const weekEnd   = weekStart.plus({ days: 6 });

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d      = weekStart.plus({ days: i });
      const dayStr = naiveDayKey(d.toISO());
      const city   = visits.find(v => {
        const s = parseNaive(v.start_date);
        const e = parseNaive(v.end_date);
        return s && e && d >= s && d <= e;
      });
      days.push({ wd: WD_NAMES[i], date: d.day, dateStr: dayStr, city: city?.city_name || '' });
    }

    const wEvents = [];
    for (const e of stream) {
      if (!e.date || !e.time) continue;
      const dayIdx = days.findIndex(d => d.dateStr === e.date);
      if (dayIdx < 0) continue;
      const [hStr, mStr] = e.time.split(':');
      const startH = Number(hStr) + Number(mStr || 0) / 60;
      if (startH < 8 || startH > 22) continue;
      wEvents.push({
        day: dayIdx, date: days[dayIdx].date,
        start: startH, end: Math.min(startH + 1.5, 22),
        t: e.title, c: EVENT_COLOR[e.type] || 'var(--muted)',
      });
    }

    return {
      weekDays:  days,
      weekEvents: wEvents,
      weekLabel: `${weekStart.day} - ${weekEnd.day}`,
    };
  }, [stream, visits, baseDateStr, weekOffset, WD_NAMES]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
          <Skeleton w={160} h={28} r={8} />
          <div style={{ flex: 1 }} />
          <Skeleton w={200} h={28} r={8} />
        </div>
        <Skeleton w="100%" h={500} r={14} />
      </div>
    );
  }

  const goBack = () => view === 'month' ? setMonthOffset(o => o - 1) : setWeekOffset(o => o - 1);
  const goFwd  = () => view === 'month' ? setMonthOffset(o => o + 1) : setWeekOffset(o => o + 1);
  const goHome = () => { setMonthOffset(0); setWeekOffset(0); };

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ flex: 1, marginBottom: 0 }}>
          {monthLabel}
          {view === 'week' && weekLabel && (
            <span className="muted num" style={{ fontSize: 16, fontWeight: 400, marginLeft: 12 }}>
              · {t('calendar.week_word')} {weekLabel}
            </span>
          )}
        </h2>
        <Btn variant="ghost" size="sm" icon="back" onClick={goBack} />
        <Btn variant="ghost" size="sm" onClick={goHome}>{t('calendar.to_trip_start')}</Btn>
        <Btn variant="ghost" size="sm" icon="chev" onClick={goFwd} />
        <div className="tweaks__seg" style={{ marginLeft: 6 }}>
          <button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>{t('calendar.month')}</button>
          <button className={view === 'week'  ? 'active' : ''} onClick={() => setView('week')}>{t('calendar.week')}</button>
        </div>
      </div>

      {view === 'month'
        ? <MonthView cells={cells} eventsByDay={eventsByDay} spans={spans} inTripDays={inTripDays} />
        : <WeekView days={weekDays} events={weekEvents} />}

      {/* Legend */}
      <div style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Legend color="var(--brand)">{t('calendar.legend_city')}</Legend>
        <Legend color="var(--success)">{t('budget.cat_accommodation')}</Legend>
        <Legend color="var(--ai)">{t('budget.cat_activities')}</Legend>
        <Legend color="var(--brand)">{t('calendar.legend_transport')}</Legend>
      </div>
    </>
  );
}
