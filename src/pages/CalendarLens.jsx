// @ts-check
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
 *   isLoading   - boolean
 *   onOpenEvent - (streamEvent) => void
 */
import React, { useState, useMemo, useCallback } from 'react';
import { Info, DateTime } from 'luxon';
import { Skeleton, IconBtn, Seg, Chip, eventFamily } from '../design/index';
import { Row, Col, Grow } from '../design/Layout';
import { parseNaive, naiveDayKey } from '@/lib/naive-time';
import { useI18n } from '@/lib/i18n/I18nContext';
import { localeTag } from '@/lib/i18n/translations';
import './CalendarLens.css';

// Localized names
const monthNames   = (lang) => ['', ...Info.months('long',  { locale: localeTag(lang) })];
const weekdayNames = (lang) => Info.weekdays('short', { locale: localeTag(lang) });

// ── City colour palette (Lumo event-type tokens, 6 distinct) ────────────────
// Colours are drawn from existing ev-*/ai/warm tokens so they stay coherent with
// the timeline and event panels — no new hues introduced. Each city gets a triad
// (accent / soft-fill / ink-text) so strips read as soft tinted pills rather than
// saturated bars with white text.
const CITY_PALETTE = [
  { c: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)' },
  { c: 'var(--ev-hotel)',    soft: 'var(--ev-hotel-soft)',    ink: 'var(--ev-hotel-ink)'    },
  { c: 'var(--ev-car)',      soft: 'var(--ev-car-soft)',      ink: 'var(--ev-car-ink)'      },
  { c: 'var(--ai)',          soft: 'var(--ai-soft)',          ink: 'var(--ai-ink)'          },
  { c: 'var(--warm)',        soft: 'var(--warm-soft)',        ink: 'var(--warm-ink)'        },
  { c: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)' },
];

const cityPal = (idx) => CITY_PALETTE[idx % CITY_PALETTE.length];
// CSS-переменные города для инлайн-style — цвет города течёт в CSS одним носителем.
const cityVars = (idx) => {
  const p = cityPal(idx);
  return { '--cc': p.c, '--cc-soft': p.soft, '--cc-ink': p.ink };
};

// Раскраска чипа события — через общий классификатор семейства (design/index.jsx),
// тот же, что красит таймлайн. Своей копии словаря типов тут нет: она разъезжалась
// с потоком (ключ `car` вместо car-pickup/car-return → аренда рендерилась без цвета).
const evCls = (type) => `ev-${eventFamily(type)}`;

// ── Inline SVG icons (no extra dependency) ──────────────────────────────────
// `IcoBack`/`IcoFwd` УДАЛЕНЫ (TRIP-344 PR 2): стрелки навигации уехали на
// <IconBtn icon="chevL|chev" tone="soft" size="sm" round>, глиф приходит из
// реестра — именно ШЕВРОН, а не стрелка: рисованные тут пути были chevron-left
// и chevron-right, и `back`/`arrow` подменили бы глиф.
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

  const cells = weeks.flat();

  return (
    <div className="ncal-month">
      {/* Weekday header */}
      <div className="ncal-wd-row" role="row">
        {WD_NAMES.map(w => (
          <div key={w} className="ncal-wd t-micro" role="columnheader">{w}</div>
        ))}
      </div>

      {/* Single hairline day grid */}
      <div className="ncal-grid" role="rowgroup">
        {cells.map((d, ci) => {
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

          // ── City strip ────────────────────────────────────
          let cityStrip;
          if (!cities.length) {
            cityStrip = <div className="ncal-cstrip cs-empty" />;
          } else if (cities.length === 1) {
            const c = cities[0];
            // Show city name only on the first day of this visit in the month
            const showLabel = d === c.startDay;
            cityStrip = (
              <div className="ncal-cstrip t-tiny" style={cityVars(c.colorIdx)}>
                {showLabel ? c.label : ''}
              </div>
            );
          } else {
            // Transit day: split strip — always show all city names
            cityStrip = (
              <div className="ncal-cstrip is-split">
                {cities.map((c, si) => (
                  <span key={si} className="ncal-cstrip-seg t-tiny" style={cityVars(c.colorIdx)}>
                    {c.label}
                  </span>
                ))}
              </div>
            );
          }

          return (
            <div key={ci} className={cls.join(' ')} role="gridcell">
              <div className="ncal-dc-top">
                {d != null && <span className="ncal-dn t-subheading">{d}</span>}
              </div>

              {cityStrip}

              {d != null && ev.length > 0 && (
                <div className="ncal-evl">
                  {shown.map((e, ei) => (
                    <button
                      key={ei}
                      type="button"
                      className={`ncal-ev t-tiny ${evCls(e.type)}`}
                      onClick={() => onOpenEvent?.(e)}
                      aria-label={`${e.time ? e.time + ' ' : ''}${e.title}`}
                    >
                      <span className="dot" />
                      {e.time && <span className="tm">{e.time}</span>}
                      <span className="t">{e.title}</span>
                    </button>
                  ))}
                  {ev.length > 2 && (
                    <Chip sm square variant="soft" onClick={() => toggle(d)} style={{ width: '100%' }}>
                      {/* inline-style-exempt: полная ширина ячейки дня — «+N ещё»
                          встаёт четвёртой строкой в ряд с событиями (эталон секции E). */}
                      {isOpen ? '−' : `+${ev.length - 2} ${t('calendar.more_count')}`}
                    </Chip>
                  )}
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
// Agenda-card design: one ncal-wdc per day, events listed chronologically — no
// hour grid. `days` тут всегда ровно 7: пустой массив мемо отдаёт только при
// отсутствии baseDate, а этот случай отсечён экраном «нет дат» до рендера.
function WeekView({ days, eventsByDayArr, onOpenEvent }) {
  const { t } = useI18n();

  return (
    <div className="ncal-week">
      <div className="ncal-wgrid" role="row">
        {days.map((d, di) => {
          const events = eventsByDayArr[di] || [];
          const cities = d.cities || [];

          // ── City colour bar under header ──────────────────────
          const cbar = cities.length ? (
            <div className="ncal-cbar">
              {cities.map((c, ci) => (
                <span key={ci} className="ncal-cbar-seg" style={cityVars(c.colorIdx)} />
              ))}
            </div>
          ) : (
            <div className="ncal-cbar" />
          );

          return (
            <div key={di} className={`ncal-wcol${d.isToday ? ' is-today' : ''}`} role="gridcell">
              <div className="ncal-wcol-h">
                <span className="ncal-wcol-wd t-micro">{d.wd}</span>
                <span className="ncal-wcol-dn t-heading">{d.date}</span>
              </div>

              {cbar}

              <div className="ncal-wcol-b">
                {events.length === 0 ? (
                  <div className="ncal-wcol-empty t-meta">
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
                      {e.time && <div className="atm t-tiny">{e.time}</div>}
                      <div className="atl t-label">{e.title}</div>
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
// Только города: цвет полосы ↔ город. Легенда нужна, потому что имя города полоса
// печатает лишь в первый день визита, а на телефоне текст в ней скрыт совсем.
// Легенды типов событий нет — чип события несёт свой заголовок сам.

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

  if (!uniqueCities.length) return null;

  return (
    <Col className="ncal-legend">
      <Row wrap className="ncal-legend-group">
        <span className="ncal-legend-lbl">{t('calendar.legend_group_cities')}</span>
        {uniqueCities.map((c, i) => (
          <Row as="span" key={i} inline gap="g3" className="ncal-leg t-meta">
            <span className="ncal-leg-sw" style={{ background: cityPal(c.colorIdx).c }} />
            {c.name}
          </Row>
        ))}
      </Row>
    </Col>
  );
}

// ─── CalendarLens (main export) ───────────────────────────────────────────────

// Скелетон календаря — PURE (панель управления + большое поле сетки). Один
// источник для обеих фаз загрузки (shell в TripView.LoadingBody и content). TRIP-337.
export function CalendarSkeleton() {
  return (
    <div className="col col--g6 ov-anim" aria-busy="true">
      <div className="row row--g4">
        <Skeleton w={200} h={32} r={'var(--r-sm)'} />
        <Grow />
        <Skeleton w={220} h={32} r={'var(--r-xl)'} />
      </div>
      <Skeleton w="100%" h={500} r={'var(--r-md)'} />
    </div>
  );
}

export default function CalendarLens({ stream, visits, isLoading, onOpenEvent }) {
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
      // ⚠️ ТОТ ЖЕ ЗАПЕЧАТАННЫЙ НАБОР, ЧТО У КОМПОНЕНТОВ ДС, НО В ЧУЖОЙ БИБЛИОТЕКЕ.
      // luxon НЕ поставляет `.d.ts`, и TS выводит сигнатуру из его исходника:
      // `startOf(unit, {…} = {})` имеет дефолт и вызывается одним аргументом
      // спокойно, а у `endOf(unit, opts)` дефолта НЕТ - параметр выведен
      // ОБЯЗАТЕЛЬНЫМ, хотя внутри `opts` уходит в тот же `startOf`, который его
      // и подставляет. Рантайм верен, неверен только выведенный тип.
      // Взят `@ts-expect-error`, а не `@ts-ignore` и не дописанный `{}` в вызов:
      // он ЕДИНСТВЕННЫЙ маркер, который сам краснеет, когда перестаёт быть
      // нужным (появятся типы luxon - строка упадёт и её снимут). Это первое
      // подавление в репозитории; в `src` ровно ОДИН вызов `.endOf(` - вот этот.
      // @ts-expect-error luxon без типов: `endOf(unit, opts)` без дефолта у opts
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
    if (!baseDate) return { days: [], eventsByDayArr: [], label: '' };

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
      label: `${weekStart.day} – ${weekEnd.day}`,
    };
  }, [stream, visits, baseDate, weekOffset, WD_NAMES, today]);

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
  if (isLoading) return <CalendarSkeleton />;

  // ── No dates ─────────────────────────────────────────────────────────────
  if (!baseDate) {
    return <div className="ncal-empty">{t('calendar.no_dates')}</div>;
  }

  return (
    <div className="ov-anim--cal ncal">
      {/* ── Toolbar ────────────────────────────────────────────── */}
      <Row align="a-start" justify="j-between" gap="g7" wrap className="ncal-hd">
        <Grow fit className="ncal-hd-l">
          <Row align="a-baseline" wrap className="ncal-title-row">
            <span className="ncal-month-lbl t-display">{MONTH_NAMES[
              view === 'month' ? currentMonth.month : (baseDate.startOf('week').plus({ weeks: weekOffset }).month)
            ]}</span>
            <span className="ncal-year-lbl t-subheading">
              {view === 'month'
                ? currentMonth.year
                : `${baseDate.startOf('week').plus({ weeks: weekOffset }).year}`
              }
              {view === 'week' && week.label && (
                <span className="t-meta" style={{ marginLeft: 10, color: 'var(--muted-2)' }}>
                  · {t('calendar.week_word')} {week.label}
                </span>
              )}
            </span>
          </Row>
        </Grow>

        <Col align="a-end" className="ncal-hd-r">
          {/* Nav pill */}
          <Row inline gap="g1" className="ncal-nav">
            <IconBtn icon="chevL" tone="soft" size="sm" round ariaLabel={t('calendar.prev')} onClick={goBack} />
            <button className="ncal-nav-txt" onClick={goToday}>{t('calendar.today')}</button>
            <span className="ncal-nav-div" aria-hidden="true" />
            <button className="row row--inline ncal-nav-trip" onClick={goHome}>
              <IcoPin />
              <span className="ncal-trip-label">{t('calendar.to_trip_start')}</span>
            </button>
            <IconBtn icon="chev" tone="soft" size="sm" round ariaLabel={t('calendar.next')} onClick={goFwd} />
          </Row>

          {/* View toggle — канон `<Seg>` (было `.ncal-vtgl`, TRIP-344 PR 6) */}
          <Seg
            ariaLabel={`${t('calendar.month')} / ${t('calendar.week')}`}
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: t('calendar.month') },
              { value: 'week', label: t('calendar.week') },
            ]}
          />
        </Col>
      </Row>

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
