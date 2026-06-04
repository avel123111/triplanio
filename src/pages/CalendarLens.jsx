/**
 * CalendarLens - calendar tab inside TripView (§15).
 *
 * Month view: weekday grid where each week is its own relative row, so a city
 * stay that crosses a week boundary wraps into a fresh bar per row instead of
 * overflowing horizontally. Day events are real buttons (open the event panel).
 *
 * Week view: a time grid whose hour range adapts to the events present (so an
 * 06:30 flight or a 23:50 train is never clipped), with an all-day strip for
 * untimed events and blocks sized by real duration.
 *
 * Props:
 *   stream      - array of stream events (from buildEventStream)
 *   visits      - array of cityVisit rows
 *   trip        - trip object with start_date / end_date
 *   isLoading   - boolean
 *   onOpenEvent - (streamEvent) => void  opens the read/edit panel (TripView.openEventView)
 */
import React, { useState, useMemo } from 'react';
import { Info, DateTime } from 'luxon';
import { Btn, Skeleton } from '../design/index';
import { parseNaive, naiveDayKey } from '@/lib/naive-time';
import { useI18n } from '@/lib/i18n/I18nContext';
import { localeTag } from '@/lib/i18n/translations';
import './CalendarLens.css';

// Localized month names (1-indexed) and weekday short names (Mon..Sun) via Luxon.
const monthNames = (lang) => ['', ...Info.months('long', { locale: localeTag(lang) })];
const weekdayNames = (lang) => Info.weekdays('short', { locale: localeTag(lang) });

// ─── palette ────────────────────────────────────────────────────────────────
// Aligned with the app's unified event-type tokens (app.css §"Event-type
// unified palette") so the calendar matches the timeline / editor.
const EVENT_COLOR = {
  'hotel-checkin':  'var(--ev-hotel)',
  'hotel-checkout': 'var(--ev-hotel)',
  'hotel-deadline': 'var(--ev-deadline)',
  activity:         'var(--ev-activity)',
  flight:           'var(--ev-transfer)',
  transfer:         'var(--ev-transfer)',
};
const eventColor = (type) => EVENT_COLOR[type] || 'var(--muted)';

// City bars use shades derived from the primary (no rainbow) so consecutive
// cities read as distinct without introducing unrelated hues.
const CITY_SHADES = [
  'var(--brand)',
  'var(--brand-700)',
  'color-mix(in srgb, var(--brand) 60%, var(--ink) 40%)',
  'color-mix(in srgb, var(--brand) 82%, var(--ai) 18%)',
  'color-mix(in srgb, var(--brand) 68%, #000 32%)',
];

const BAR_H = 17;   // city bar height (px) — keep in sync with .cal-span
const BAR_GAP = 2;

// ─── MonthView ────────────────────────────────────────────────────────────────

function MonthView({ weeks, offset, dim, eventsByDay, cityRanges, inTripDays, todayDay, onOpenEvent }) {
  const { t, lang } = useI18n();
  const WD_NAMES = weekdayNames(lang);
  const [expanded, setExpanded] = useState(() => new Set());
  const colOf = (day) => (offset + day - 1) % 7;

  const toggle = (day) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(day) ? next.delete(day) : next.add(day);
    return next;
  });

  // For each week row: clamp every city range to the row and lane-stack overlaps.
  const barsForWeek = (weekIdx) => {
    const rowStart = Math.max(1, weekIdx * 7 - offset + 1);
    const rowEnd = Math.min(dim, weekIdx * 7 + 7 - offset);
    if (rowStart > rowEnd) return { bars: [], lanes: 0 };
    const items = [];
    for (const r of cityRanges) {
      const a = Math.max(r.startDay, rowStart);
      const b = Math.min(r.endDay, rowEnd);
      if (a > b) continue;
      items.push({ startCol: colOf(a), endCol: colOf(b), label: r.label, color: r.color });
    }
    items.sort((x, y) => x.startCol - y.startCol || y.endCol - x.endCol);
    const laneEnds = [];
    for (const it of items) {
      let lane = laneEnds.findIndex(end => end < it.startCol);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.endCol); }
      else laneEnds[lane] = it.endCol;
      it.lane = lane;
    }
    return { bars: items, lanes: laneEnds.length };
  };

  return (
    <div className="cal-scroll">
      <div className="cal-card cal-month" role="grid" aria-label={t('calendar.month')}>
        {/* Weekday header */}
        <div className="cal-wdhead" role="row">
          {WD_NAMES.map(w => <div key={w} className="cal-wd" role="columnheader">{w}</div>)}
        </div>

        {/* One relative row per week */}
        {weeks.map((week, wi) => {
          const { bars, lanes } = barsForWeek(wi);
          const band = lanes * (BAR_H + BAR_GAP);
          return (
            <div key={wi} className="cal-week" role="row" style={{ '--cal-band': `${band}px` }}>
              {week.map((d, ci) => {
                const inTrip = d != null && inTripDays.has(d);
                const ev = d != null ? (eventsByDay[d] || []) : [];
                const isOpen = d != null && expanded.has(d);
                const shown = isOpen ? ev : ev.slice(0, 2);
                const cls = ['cal-cell'];
                if (d == null) cls.push('cal-cell--out');
                if (inTrip) cls.push('cal-cell--trip');
                if (d === todayDay) cls.push('cal-cell--today');
                return (
                  <div key={ci} className={cls.join(' ')} role="gridcell">
                    {d != null && <div className="cal-daynum">{d}</div>}
                    <div className="cal-events">
                      {shown.map((e, ei) => (
                        <button
                          key={ei}
                          type="button"
                          className="cal-ev"
                          onClick={() => onOpenEvent?.(e)}
                          aria-label={`${e.time ? e.time + ' ' : ''}${e.title}`}
                        >
                          <span className="cal-ev__dot" style={{ background: eventColor(e.type) }} />
                          <span className="cal-ev__txt num">
                            {e.time && <span className="cal-ev__time">{e.time} </span>}{e.title}
                          </span>
                        </button>
                      ))}
                      {ev.length > 2 && (
                        <button type="button" className="cal-more" onClick={() => toggle(d)}>
                          {isOpen ? '−' : `+${ev.length - 2} ${t('calendar.more_count')}`}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* City bars overlay — wrapped to this week row */}
              {bars.length > 0 && (
                <div className="cal-spans" aria-hidden="true">
                  {bars.map((b, bi) => (
                    <div key={bi} className="cal-span" style={{
                      left: `calc(${(b.startCol / 7) * 100}% + 4px)`,
                      width: `calc(${((b.endCol - b.startCol + 1) / 7) * 100}% - 8px)`,
                      top: b.lane * (BAR_H + BAR_GAP),
                      background: b.color,
                    }}>{b.label}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── WeekView ─────────────────────────────────────────────────────────────────

const HOUR_HEIGHT = 36;

function WeekView({ days, timed, allDay, hourStart, hourEnd, onOpenEvent }) {
  const { t } = useI18n();
  if (!days.length) {
    return <div className="cal-card cal-empty">{t('calendar.week_no_data')}</div>;
  }
  const HOURS = [];
  for (let h = hourStart; h <= hourEnd; h++) HOURS.push(h);

  return (
    <div className="cal-scroll">
      <div className="cal-card cal-week-grid">
        {/* Day header */}
        <div className="cal-week-head">
          <div className="cal-week-head__gutter" />
          {days.map((d, i) => (
            <div key={i} className={`cal-week-day${d.isToday ? ' cal-week-day--today' : ''}`}>
              <div className="cal-wdnum num">{d.date}</div>
              <div className="cal-wdname">{d.wd}</div>
              <div className="cal-wdcity">{d.city}</div>
            </div>
          ))}
        </div>

        {/* All-day strip — only when there are untimed events this week */}
        {allDay.some(c => c.length > 0) && (
          <div className="cal-allday">
            <div className="cal-allday__label">{t('calendar.all_day')}</div>
            {allDay.map((col, di) => (
              <div key={di} className="cal-allday__col">
                {col.map((e, ei) => (
                  <button
                    key={ei}
                    type="button"
                    className="cal-allday__chip"
                    style={{ background: eventColor(e.type) }}
                    onClick={() => onOpenEvent?.(e)}
                    aria-label={e.title}
                  >{e.title}</button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Hour grid + timed events */}
        <div className="cal-week-body">
          <div className="cal-hours">
            {HOURS.map(h => (
              <div key={h} className="cal-hour num" style={{ height: HOUR_HEIGHT }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {days.map((d, di) => (
            <div key={di} className="cal-daycol" style={{
              backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent ${HOUR_HEIGHT - 1}px, var(--line-2) ${HOUR_HEIGHT - 1}px, var(--line-2) ${HOUR_HEIGHT}px)`,
              minHeight: HOURS.length * HOUR_HEIGHT,
            }}>
              {timed.filter(e => e.day === di).map((e, ei) => {
                const top = (e.start - hourStart) * HOUR_HEIGHT;
                const h = Math.max((e.end - e.start) * HOUR_HEIGHT, 22);
                const mm = String(Math.round((e.start % 1) * 60)).padStart(2, '0');
                return (
                  <button key={ei} type="button" className="cal-block" style={{
                    top, height: h, background: eventColor(e.type),
                  }} onClick={() => onOpenEvent?.(e.ev)} aria-label={`${Math.floor(e.start)}:${mm} ${e.t}`}>
                    <div className="cal-block__time num">{Math.floor(e.start)}:{mm}</div>
                    <div className="cal-block__txt">{e.t}</div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Legend ─────────────────────────────────────────────────────────────────

function Legend() {
  const { t } = useI18n();
  const items = [
    ['var(--brand)',        t('calendar.legend_city')],
    ['var(--ev-hotel)',     t('calendar.legend_hotel')],
    ['var(--ev-activity)',  t('calendar.legend_activity')],
    ['var(--ev-transfer)',  t('calendar.legend_transport')],
    ['var(--ev-deadline)',  t('calendar.legend_deadline')],
  ];
  return (
    <div className="cal-legend">
      {items.map(([c, label]) => (
        <span key={label} className="cal-legend__item">
          <span className="cal-legend__sw" style={{ background: c }} />{label}
        </span>
      ))}
    </div>
  );
}

// ─── CalendarLens (main export) ───────────────────────────────────────────────

export default function CalendarLens({ stream, visits, trip, isLoading, onOpenEvent }) {
  const { t, lang } = useI18n();
  const MONTH_NAMES = useMemo(() => monthNames(lang), [lang]);
  const WD_NAMES = useMemo(() => weekdayNames(lang), [lang]);
  const [view, setView] = useState('month');
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset, setWeekOffset]   = useState(0);

  // Base start date from trip or first visit that actually has a date
  // (kind='start' cities have start_date=null, so we must skip them).
  const firstDatedVisit = visits.find(v => v.start_date);
  const baseDateStr = trip?.start_date
    || (firstDatedVisit ? naiveDayKey(firstDatedVisit.start_date) : null);
  const baseDate = baseDateStr ? parseNaive(baseDateStr + 'T00:00:00') : null;
  const currentMonth = baseDate ? baseDate.plus({ months: monthOffset }) : null;
  const today = DateTime.now();

  // ── Month grid: weeks + per-city ranges clamped to the month ──
  const month = useMemo(() => {
    if (!currentMonth) return null;
    const y = currentMonth.year;
    const m = currentMonth.month;
    const first = currentMonth.startOf('month');
    const dim = currentMonth.daysInMonth;
    const offset = first.weekday - 1; // Luxon 1=Mon → offset 0=Mon
    const total = Math.ceil((offset + dim) / 7) * 7;
    const cells = [];
    for (let i = 0; i < total; i++) {
      const day = i - offset + 1;
      cells.push(day >= 1 && day <= dim ? day : null);
    }
    const weeks = [];
    for (let w = 0; w < total / 7; w++) weeks.push(cells.slice(w * 7, w * 7 + 7));
    return { y, m, offset, dim, weeks };
  }, [currentMonth]);

  const cityRanges = useMemo(() => {
    if (!month) return [];
    const out = [];
    visits.forEach((v, idx) => {
      const s = parseNaive(v.start_date);
      const e = parseNaive(v.end_date);
      if (!s || !e) return;
      const mStart = currentMonth.startOf('month');
      const mEnd = currentMonth.endOf('month');
      const cs = s < mStart ? mStart : s;
      const ce = e > mEnd ? mEnd : e;
      if (cs > ce) return;
      out.push({
        startDay: cs.day, endDay: ce.day,
        label: v.city_name || '—',
        color: CITY_SHADES[idx % CITY_SHADES.length],
      });
    });
    return out;
  }, [visits, currentMonth, month]);

  const eventsByDay = useMemo(() => {
    const map = {};
    if (!month) return map;
    for (const e of stream) {
      if (!e.date) continue;
      const dt = parseNaive(e.date + 'T00:00:00');
      if (!dt || dt.year !== month.y || dt.month !== month.m) continue;
      (map[dt.day] ||= []).push(e);
    }
    return map;
  }, [stream, month]);

  const inTripDays = useMemo(() => {
    const set = new Set();
    if (!month) return set;
    for (const v of visits) {
      const s = parseNaive(v.start_date);
      const e = parseNaive(v.end_date);
      if (!s || !e) continue;
      let cur = s;
      while (cur <= e) {
        if (cur.year === month.y && cur.month === month.m) set.add(cur.day);
        cur = cur.plus({ days: 1 });
      }
    }
    return set;
  }, [visits, month]);

  const todayDay = month && today.year === month.y && today.month === month.m ? today.day : null;

  // ── Week view data ──
  const week = useMemo(() => {
    if (!baseDate) return { days: [], timed: [], allDay: [], hourStart: 8, hourEnd: 22, title: '', label: '' };
    const weekStart = baseDate.startOf('week').plus({ weeks: weekOffset });
    const weekEnd = weekStart.plus({ days: 6 });
    const todayStr = naiveDayKey(today.toISO());

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = weekStart.plus({ days: i });
      const dayStr = naiveDayKey(d.toISO());
      const city = visits.find(v => {
        const s = parseNaive(v.start_date);
        const e = parseNaive(v.end_date);
        return s && e && d >= s && d <= e;
      });
      days.push({ wd: WD_NAMES[i], date: d.day, dateStr: dayStr, city: city?.city_name || '', isToday: dayStr === todayStr });
    }

    const parseH = (hhmm) => {
      const [h, m] = hhmm.split(':');
      return Number(h) + Number(m || 0) / 60;
    };

    const timed = [];
    const allDay = Array.from({ length: 7 }, () => []);
    let minH = 24, maxH = 0;
    for (const e of stream) {
      if (!e.date) continue;
      const dayIdx = days.findIndex(d => d.dateStr === e.date);
      if (dayIdx < 0) continue;
      if (!e.time) { allDay[dayIdx].push(e); continue; }
      const start = parseH(e.time);
      let end = e.endTime ? parseH(e.endTime) : start + 1;
      if (end <= start) end = start + 1;           // guard cross-midnight / equal
      end = Math.min(end, 24);
      timed.push({ day: dayIdx, start, end, t: e.title, type: e.type, ev: e });
      minH = Math.min(minH, Math.floor(start));
      maxH = Math.max(maxH, Math.ceil(end));
    }

    // Adapt the visible hour range to the events; fall back to a daytime window.
    let hourStart = 8, hourEnd = 22;
    if (timed.length) {
      hourStart = Math.max(0, Math.min(minH, 8));
      hourEnd = Math.min(24, Math.max(maxH, 20));
    }

    return {
      days, timed, allDay, hourStart, hourEnd,
      title: `${MONTH_NAMES[weekStart.month]} ${weekStart.year}`,
      label: `${weekStart.day} – ${weekEnd.day}`,
    };
  }, [stream, visits, baseDate, weekOffset, WD_NAMES, MONTH_NAMES, today]);

  // ── Loading ──
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

  // ── Empty: no usable dates ──
  if (!baseDate) {
    return <div className="cal-card cal-empty">{t('calendar.no_dates')}</div>;
  }

  const goBack = () => view === 'month' ? setMonthOffset(o => o - 1) : setWeekOffset(o => o - 1);
  const goFwd  = () => view === 'month' ? setMonthOffset(o => o + 1) : setWeekOffset(o => o + 1);
  const goHome = () => { setMonthOffset(0); setWeekOffset(0); };
  const goToday = () => {
    const now = today.startOf('day');
    if (view === 'month') {
      setMonthOffset((now.year - baseDate.year) * 12 + (now.month - baseDate.month));
    } else {
      const diff = now.startOf('week').diff(baseDate.startOf('week'), 'weeks').weeks;
      setWeekOffset(Math.round(diff));
    }
  };

  const headerTitle = view === 'month'
    ? `${MONTH_NAMES[currentMonth.month]} ${currentMonth.year}`
    : week.title;

  return (
    <>
      {/* Toolbar */}
      <div className="cal-toolbar">
        <h2 className="cal-toolbar__title">
          {headerTitle}
          {view === 'week' && week.label && (
            <span className="cal-toolbar__sub num">· {t('calendar.week_word')} {week.label}</span>
          )}
        </h2>
        <div className="cal-nav">
          <Btn variant="ghost" size="sm" icon="back" onClick={goBack} ariaLabel={t('calendar.prev')} />
          <Btn variant="ghost" size="sm" onClick={goToday}>{t('calendar.today')}</Btn>
          <Btn variant="ghost" size="sm" onClick={goHome}>{t('calendar.to_trip_start')}</Btn>
          <Btn variant="ghost" size="sm" icon="chev" onClick={goFwd} ariaLabel={t('calendar.next')} />
        </div>
        <div className="tweaks__seg" role="group" aria-label={t('calendar.month') + ' / ' + t('calendar.week')} style={{ marginLeft: 6 }}>
          <button className={view === 'month' ? 'active' : ''} aria-pressed={view === 'month'} onClick={() => setView('month')}>{t('calendar.month')}</button>
          <button className={view === 'week'  ? 'active' : ''} aria-pressed={view === 'week'}  onClick={() => setView('week')}>{t('calendar.week')}</button>
        </div>
      </div>

      {view === 'month'
        ? <MonthView
            weeks={month.weeks} offset={month.offset} dim={month.dim}
            eventsByDay={eventsByDay} cityRanges={cityRanges}
            inTripDays={inTripDays} todayDay={todayDay} onOpenEvent={onOpenEvent}
          />
        : <WeekView
            days={week.days} timed={week.timed} allDay={week.allDay}
            hourStart={week.hourStart} hourEnd={week.hourEnd} onOpenEvent={onOpenEvent}
          />}

      <Legend />
    </>
  );
}
