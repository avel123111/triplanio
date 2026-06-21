/**
 * CalendarLens — Lumo redesign (ncal-* system).
 *
 * Month view: 7-column grid where each day cell carries an inline city strip
 * (solid for single city, split segments for transit days) at the top.
 * City name appears only on the first day of each visit within the visible month.
 *
 * Week view: 7 agenda cards (ncal-wdc) — no time grid, events listed
 * chronologically with time label above each entry.
 *
 * Props:
 *   stream      - array of stream events (from buildEventStream)
 *   visits      - array of cityVisit rows (sorted by start_date)
 *   trip        - trip object with start_date / end_date
 *   isLoading   - boolean
 *   onOpenEvent - (streamEvent) => void
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Info, DateTime } from 'luxon';
import { Skeleton } from '../design/index';
import { parseNaive, naiveDayKey } from '@/lib/naive-time';
import { useI18n } from '@/lib/i18n/I18nContext';
import { localeTag } from '@/lib/i18n/translations';
import './CalendarLens.css';

// Localized names
const monthNames   = (lang) => ['', ...Info.months('long',  { locale: localeTag(lang) })];
const weekdayNames = (lang) => Info.weekdays('short', { locale: localeTag(lang) });

// ── City colour palette (Lumo event-type tokens, 6 distinct) ────────────────
// Colours are drawn from existing ev-* tokens so they stay coherent with the
// timeline and event panels — no new hues introduced.
const CITY_BG   = ['var(--ev-activity)','var(--ev-hotel)','var(--ev-car)','var(--ai)','var(--warm)','var(--ev-transfer)'];
const CITY_SOFT = ['var(--ev-activity-soft)','var(--ev-hotel-soft)','var(--ev-car-soft)','var(--ai-soft)','var(--warm-soft)','var(--ev-transfer-soft)'];
const CITY_INK  = ['var(--ev-activity-ink)','var(--ev-hotel-ink)','var(--ev-car-ink)','var(--ai-ink)','var(--warm-ink)','var(--ev-transfer-ink)'];

const cityBg   = (idx) => CITY_BG  [idx % CITY_BG.length];
const citySoft = (idx) => CITY_SOFT[idx % CITY_SOFT.length];
const cityInk  = (idx) => CITY_INK [idx % CITY_INK.length];

// ── Event-type → CSS class mapping ──────────────────────────────────────────
const EV_CLS_MAP = {
  'hotel-checkin':  'ev-hotel',
  'hotel-checkout': 'ev-hotel',
  'hotel-deadline': 'ev-deadline',
  activity:         'ev-activity',
  flight:           'ev-transfer',
  transfer:         'ev-transfer',
  car:              'ev-car',
};
const evCls = (type) => EV_CLS_MAP[type] || '';

// ── Inline SVG icons (no extra dependency) ──────────────────────────────────
const IcoBack = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M15 18l-6-6 6-6"/>
  </svg>
);
const IcoFwd = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M9 6l6 6-6 6"/>
  </svg>
);
const IcoPin = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-5.7-7-11a7 7 0 0114 0c0 5.3-7 11-7 11z"/>
    <circle cx="12" cy="10" r="2"/>
  </svg>
);

// ─── MonthView ────────────────────────────────────────────────────────────────

function MonthView({ weeks, eventsByDay, cityRanges, inTripDays, todayDay, onOpenEvent, lang }) {
  const { t } = useI18n();
  const WD_NAMES = weekdayNames(lang);
  const [expanded, setExpanded] = useState(() => new Set());

  const toggle = useCallback((day) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(day) ? next.delete(day) : next.add(day);
      return next;
    });
  }, []);

  // Returns city ranges that are active on the given calendar day.
  const citiesForDay = useCallback((day) => {
    if (day == null) return [];
    return cityRanges
      .filter(r => day >= r.startDay && day <= r.endDay)
      .sort((a, b) => a.startDay - b.startDay || a.colorIdx - b.colorIdx);
  }, [cityRanges]);

  return (
    <div className="ncal-month">
      {/* Weekday header */}
      <div className="ncal-wd-row" role="row">
        {WD_NAMES.map(w => (
          <div key={w} className="ncal-wd" role="columnheader">{w}</div>
        ))}
      </div>

      {/* Week rows */}
      {weeks.map((week, wi) => (
        <div key={wi} className="ncal-wk">
          <div className="ncal-dgrid" role="row">
            {week.map((d, ci) => {
              const inTrip = d != null && inTripDays.has(d);
              const isToday = d === todayDay;
              const ev     = d != null ? (eventsByDay[d] || []) : [];
              const cities = citiesForDay(d);
              const isOpen = d != null && expanded.has(d);
              const shown  = isOpen ? ev : ev.slice(0, 2);

              const cls = ['ncal-dc'];
              if (d == null)  cls.push('is-out');
              else {
                if (inTrip)      cls.push('is-trip');
                if (isToday)     cls.push('is-today');
                if (ev.length > 0) cls.push('has-ev');
              }

              // ── City strip at top of cell ─────────────────────
              let cityStrip;
              if (!cities.length) {
                cityStrip = <div className="ncal-cstrip cs-empty" />;
              } else if (cities.length === 1) {
                const c = cities[0];
                // Show city name only on the first day of this visit in the month
                const showLabel = d === c.startDay;
                cityStrip = (
                  <div
                    className="ncal-cstrip"
                    style={{ background: cityBg(c.colorIdx) }}
                  >
                    {showLabel ? c.label : ''}
                  </div>
                );
              } else {
                // Transit day: split strip — always show all city names
                cityStrip = (
                  <div className="ncal-cstrip is-split">
                    {cities.map((c, si) => (
                      <span
                        key={si}
                        className="ncal-cstrip-seg"
                        style={{ background: cityBg(c.colorIdx), flex: 1 }}
                      >
                        {c.label}
                      </span>
                    ))}
                  </div>
                );
              }

              return (
                <div key={ci} className={cls.join(' ')} role="gridcell">
                  {cityStrip}

                  {d != null && (
                    <div className="ncal-dn-wrap">
                      <span className="ncal-dn">{d}</span>
                    </div>
                  )}

                  {d != null && ev.length > 0 && (
                    <div className="ncal-evl">
                      {shown.map((e, ei) => (
                        <button
                          key={ei}
                          type="button"
                          className={`ncal-ev ${evCls(e.type)}`}
                          onClick={() => onOpenEvent?.(e)}
                          aria-label={`${e.time ? e.time + ' ' : ''}${e.title}`}
                        >
                          <span className="dot" />
                          {e.time && <span className="tm">{e.time}</span>}
                          <span className="t">{e.title}</span>
                        </button>
                      ))}
                      {ev.length > 2 && (
                        <button type="button" className="ncal-more" onClick={() => toggle(d)}>
                          {isOpen ? '−' : `+${ev.length - 2} ${t('calendar.more_count')}`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── WeekView ─────────────────────────────────────────────────────────────────
// Agenda-card design: one ncal-wdc per day, events listed chronologically.
// Replaces the hour-grid approach — simpler, matches Lumo design language.

function WeekView({ days, eventsByDayArr, onOpenEvent }) {
  const { t } = useI18n();

  if (!days.length) {
    return <div className="ncal-empty">{t('calendar.week_no_data')}</div>;
  }

  return (
    <div className="ncal-wv-scroll">
      <div className="ncal-wcols">
        {days.map((d, di) => {
          const events = eventsByDayArr[di] || [];
          const cities = d.cities || [];

          // ── Colour bar at top of card ─────────────────────────
          let cbar;
          if (!cities.length) {
            cbar = <div className="ncal-wdc-cbar" />;
          } else if (cities.length === 1) {
            cbar = (
              <div
                className="ncal-wdc-cbar"
                style={{ background: cityBg(cities[0].colorIdx) }}
              />
            );
          } else {
            cbar = (
              <div className="ncal-wdc-cbar is-split">
                {cities.map((c, ci) => (
                  <span
                    key={ci}
                    className="ncal-cstrip-seg"
                    style={{ background: cityBg(c.colorIdx), flex: 1 }}
                  />
                ))}
              </div>
            );
          }

          return (
            <div key={di} className={`ncal-wdc${d.isToday ? ' is-today' : ''}`}>
              {cbar}

              <div className="ncal-wdc-h">
                <div className="ncal-wdc-num">{d.date}</div>
                <div className="ncal-wdc-wd">{d.wd}</div>
              </div>

              <div className="ncal-wdc-b">
                {events.length === 0 ? (
                  <div className="ncal-wdc-empty">
                    {cities.length > 0 ? t('calendar.free_day') : '—'}
                  </div>
                ) : (
                  events.map((e, ei) => (
                    <button
                      key={ei}
                      type="button"
                      className={`ncal-aev ${evCls(e.type)}`}
                      onClick={() => onOpenEvent?.(e)}
                      aria-label={`${e.time ? e.time + ' ' : ''}${e.title}`}
                    >
                      {e.time && <div className="atm">{e.time}</div>}
                      <div className="atl">{e.title}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Legend ──────────────────────────────────────────────────────────────────
// Two groups: Cities (dynamic, from visits) + Event types (static).

function Legend({ visits }) {
  const { t } = useI18n();

  // Deduplicate cities by name, preserving colour index from visit order
  const uniqueCities = useMemo(() => {
    const seen = new Set();
    return visits
      // colorIdx must stay tied to the original visit index so colours match
      // the timeline; map first (keeps idx), then filter.
      .map((v, idx) => ({ name: v.city_name, colorIdx: idx, kind: v.kind }))
      .filter(({ name, kind }) => {
        if (kind === 'start' || kind === 'end') return false; // anchors hidden in calendar
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
  }, [visits]);

  const eventTypes = [
    { color: 'var(--ev-hotel-ink)',    label: t('calendar.legend_hotel')     },
    { color: 'var(--ev-activity-ink)', label: t('calendar.legend_activity')  },
    { color: 'var(--ev-transfer-ink)', label: t('calendar.legend_transport') },
    { color: 'var(--ev-deadline-ink)', label: t('calendar.legend_deadline')  },
  ];

  return (
    <div className="ncal-legend">
      {uniqueCities.length > 0 && (
        <div className="ncal-legend-group">
          <span className="ncal-legend-lbl">{t('calendar.legend_group_cities')}</span>
          {uniqueCities.map((c, i) => (
            <span key={i} className="ncal-leg">
              <span className="ncal-leg-sw" style={{ background: cityBg(c.colorIdx) }} />
              {c.name}
            </span>
          ))}
        </div>
      )}
      <div className="ncal-legend-group">
        <span className="ncal-legend-lbl">{t('calendar.legend_group_events')}</span>
        {eventTypes.map(({ color, label }) => (
          <span key={label} className="ncal-leg">
            <span className="ncal-leg-sw" style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── CalendarLens (main export) ───────────────────────────────────────────────

export default function CalendarLens({ stream, visits, trip, isLoading, onOpenEvent }) {
  const { t, lang } = useI18n();
  const MONTH_NAMES = useMemo(() => monthNames(lang),   [lang]);
  const WD_NAMES    = useMemo(() => weekdayNames(lang), [lang]);

  const [view,        setView]        = useState('month');
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset,  setWeekOffset]  = useState(0);

  // Base date: first dated visit
  const firstDatedVisit = visits.find(v => v.start_date);
  const baseDateStr = firstDatedVisit ? naiveDayKey(firstDatedVisit.start_date) : null;
  const baseDate     = baseDateStr ? parseNaive(baseDateStr + 'T00:00:00') : null;
  const currentMonth = baseDate ? baseDate.plus({ months: monthOffset }) : null;
  const today        = DateTime.now();

  // ── Month grid ───────────────────────────────────────────────────────────
  const month = useMemo(() => {
    if (!currentMonth) return null;
    const y      = currentMonth.year;
    const m      = currentMonth.month;
    const first  = currentMonth.startOf('month');
    const dim    = currentMonth.daysInMonth;
    const offset = first.weekday - 1; // Luxon 1=Mon → 0-based
    const total  = Math.ceil((offset + dim) / 7) * 7;
    const cells  = [];
    for (let i = 0; i < total; i++) {
      const day = i - offset + 1;
      cells.push(day >= 1 && day <= dim ? day : null);
    }
    const weeks = [];
    for (let w = 0; w < total / 7; w++) weeks.push(cells.slice(w * 7, w * 7 + 7));
    return { y, m, offset, dim, weeks };
  }, [currentMonth]);

  // City ranges clamped to the visible month, with colour index.
  // startDay here is the first day of the visit visible in this month
  // (used to decide when to render the city label in the strip).
  const cityRanges = useMemo(() => {
    if (!month) return [];
    const out = [];
    visits.forEach((v, idx) => {
      if (v.kind === 'start' || v.kind === 'end') return; // anchors hidden in calendar
      const s = parseNaive(v.start_date);
      const e = parseNaive(v.end_date);
      if (!s || !e) return;
      const mStart = currentMonth.startOf('month');
      const mEnd   = currentMonth.endOf('month');
      const cs = s < mStart ? mStart : s;
      const ce = e > mEnd   ? mEnd   : e;
      if (cs > ce) return;
      out.push({
        startDay: cs.day,
        endDay:   ce.day,
        label:    v.city_name || '—',
        colorIdx: idx,
      });
    });
    return out;
  }, [visits, currentMonth, month]);

  // Events keyed by day number for the visible month
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

  // Set of trip-days in the visible month (for the blue cell tint)
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

  const todayDay = month && today.year === month.y && today.month === month.m
    ? today.day
    : null;

  // ── Week view data ───────────────────────────────────────────────────────
  const week = useMemo(() => {
    if (!baseDate) return { days: [], eventsByDayArr: [], title: '', label: '' };

    const weekStart = baseDate.startOf('week').plus({ weeks: weekOffset });
    const weekEnd   = weekStart.plus({ days: 6 });
    const todayStr  = naiveDayKey(today.toISO());

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d      = weekStart.plus({ days: i });
      const dayStr = naiveDayKey(d.toISO());

      // All visits active on this day — sorted by start date (L→R = chronological)
      const activeCities = visits
        .map((v, idx) => {
          const s = parseNaive(v.start_date);
          const e = parseNaive(v.end_date);
          return { v, idx, s, e };
        })
        .filter(({ v, s, e }) => v.kind !== 'start' && v.kind !== 'end' && s && e && d >= s && d <= e)
        .map(({ v, idx, s }) => ({
          name:     v.city_name || '—',
          colorIdx: idx,
          startMs:  s.toMillis(),
        }))
        .sort((a, b) => a.startMs - b.startMs || a.colorIdx - b.colorIdx);

      days.push({
        wd:       WD_NAMES[i],
        date:     d.day,
        dateStr:  dayStr,
        cities:   activeCities,
        isToday:  dayStr === todayStr,
      });
    }

    // Events per day — timed events sorted by time, allDay appended after
    const eventsByDayArr = Array.from({ length: 7 }, () => []);
    for (const e of stream) {
      if (!e.date) continue;
      const dayIdx = days.findIndex(d => d.dateStr === e.date);
      if (dayIdx < 0) continue;
      eventsByDayArr[dayIdx].push(e);
    }
    eventsByDayArr.forEach(arr =>
      arr.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
    );

    return {
      days,
      eventsByDayArr,
      title: `${MONTH_NAMES[weekStart.month]} ${weekStart.year}`,
      label: `${weekStart.day} – ${weekEnd.day}`,
    };
  }, [stream, visits, baseDate, weekOffset, WD_NAMES, MONTH_NAMES, today]);

  // ── Navigation ───────────────────────────────────────────────────────────
  const goBack  = () => view === 'month' ? setMonthOffset(o => o - 1) : setWeekOffset(o => o - 1);
  const goFwd   = () => view === 'month' ? setMonthOffset(o => o + 1) : setWeekOffset(o => o + 1);
  const goHome  = () => { setMonthOffset(0); setWeekOffset(0); };
  const goToday = () => {
    const now = today.startOf('day');
    if (view === 'month') {
      setMonthOffset((now.year - baseDate.year) * 12 + (now.month - baseDate.month));
    } else {
      const diff = now.startOf('week').diff(baseDate.startOf('week'), 'weeks').weeks;
      setWeekOffset(Math.round(diff));
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
          <Skeleton w={200} h={32} r={8} />
          <div style={{ flex: 1 }} />
          <Skeleton w={220} h={32} r={20} />
        </div>
        <Skeleton w="100%" h={500} r={16} />
      </div>
    );
  }

  // ── No dates ─────────────────────────────────────────────────────────────
  if (!baseDate) {
    return <div className="ncal-empty">{t('calendar.no_dates')}</div>;
  }

  const headerTitle = view === 'month'
    ? `${MONTH_NAMES[currentMonth.month]} ${currentMonth.year}`
    : week.title;

  const headerYear = view === 'month'
    ? String(currentMonth.year)
    : week.label ? `· ${t('calendar.week_word')} ${week.label}` : '';

  return (
    <div className="ov-anim--cal">
      {/* ── Toolbar ────────────────────────────────────────────── */}
      <div className="ncal-hd">
        <div className="ncal-hd-l">
          <div className="ncal-title-row">
            <span className="ncal-month-lbl">{MONTH_NAMES[
              view === 'month' ? currentMonth.month : (baseDate.startOf('week').plus({ weeks: weekOffset }).month)
            ]}</span>
            <span className="ncal-year-lbl">
              {view === 'month'
                ? currentMonth.year
                : `${baseDate.startOf('week').plus({ weeks: weekOffset }).year}`
              }
              {view === 'week' && week.label && (
                <span style={{ fontWeight: 400, fontSize: '0.7em', marginLeft: 10, color: 'var(--muted-2)' }}>
                  · {t('calendar.week_word')} {week.label}
                </span>
              )}
            </span>
          </div>
        </div>

        <div className="ncal-hd-r">
          {/* Nav pill */}
          <div className="ncal-nav">
            <button className="ncal-nav-ico" aria-label={t('calendar.prev')} onClick={goBack}>
              <IcoBack />
            </button>
            <button className="ncal-nav-txt" onClick={goToday}>{t('calendar.today')}</button>
            <span className="ncal-nav-div" aria-hidden="true" />
            <button className="ncal-nav-trip" onClick={goHome}>
              <IcoPin />
              <span className="ncal-trip-label">{t('calendar.to_trip_start')}</span>
            </button>
            <button className="ncal-nav-ico" aria-label={t('calendar.next')} onClick={goFwd}>
              <IcoFwd />
            </button>
          </div>

          {/* View toggle */}
          <div className="ncal-vtgl" role="group" aria-label={`${t('calendar.month')} / ${t('calendar.week')}`}>
            <button
              className={`ncal-vtgl-btn${view === 'month' ? ' is-on' : ''}`}
              aria-pressed={view === 'month'}
              onClick={() => setView('month')}
            >
              {t('calendar.month')}
            </button>
            <button
              className={`ncal-vtgl-btn${view === 'week' ? ' is-on' : ''}`}
              aria-pressed={view === 'week'}
              onClick={() => setView('week')}
            >
              {t('calendar.week')}
            </button>
          </div>
        </div>
      </div>

      {/* ── Views ──────────────────────────────────────────────── */}
      {view === 'month' ? (
        <MonthView
          weeks={month.weeks}
          eventsByDay={eventsByDay}
          cityRanges={cityRanges}
          inTripDays={inTripDays}
          todayDay={todayDay}
          onOpenEvent={onOpenEvent}
          lang={lang}
        />
      ) : (
        <WeekView
          days={week.days}
          eventsByDayArr={week.eventsByDayArr}
          onOpenEvent={onOpenEvent}
        />
      )}

      {/* ── Legend ─────────────────────────────────────────────── */}
      <Legend visits={visits} />
    </div>
  );
}
