// @ts-check
/**
 * CalendarLens — полный редизайн (ncal-* namespace).
 *
 * Экран собран как страница из трёх зон:
 *   • Командная панель (ncal-bar): крупный месяц/год, подзаголовок поездки
 *     (диапазон дат · города · события), навигация и переключатель вида.
 *   • Календарь (ncal-main):
 *       — Месяц: доска 7×N с НЕПРЕРЫВНЫМИ лентами городов, тянущимися через
 *         подряд идущие дни недели (как многодневные события в Google/Notion),
 *         под ними — точечные события дня.
 *       — Неделя: настоящая сетка колонок с осью времени слева, all-day полосой
 *         сверху и позиционированными по часам блоками событий.
 *   • Сводка поездки (ncal-aside): статистика + список городов с датами.
 *
 * Цвета/радиусы/тени/кегли — только токены app.css. Новых цветов ноль.
 *
 * Props:
 *   stream      - array of stream events (from buildEventStream)
 *   visits      - array of cityVisit rows (sorted by start_date)
 *   isLoading   - boolean
 *   onOpenEvent - (streamEvent) => void
 */
import React, { useState, useMemo } from 'react';
import { Info, DateTime } from 'luxon';
import { Skeleton, IconBtn, Seg, eventFamily } from '../design/index';
import { Row, Grow } from '../design/Layout';
import { parseNaive, naiveDayKey } from '@/lib/naive-time';
import { useI18n } from '@/lib/i18n/I18nContext';
import { localeTag } from '@/lib/i18n/translations';
import './CalendarLens.css';

// Localized names
const monthNames   = (lang) => ['', ...Info.months('long',  { locale: localeTag(lang) })];
const monthShort   = (lang) => ['', ...Info.months('short', { locale: localeTag(lang) })];
const weekdayNames = (lang) => Info.weekdays('short', { locale: localeTag(lang) });

// ── City colour palette (existing ev-*/ai/warm tokens — no new hues) ────────
// Каждый город — триада (акцент / soft-фон / ink-текст).
const CITY_PALETTE = [
  { c: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)' },
  { c: 'var(--ev-hotel)',    soft: 'var(--ev-hotel-soft)',    ink: 'var(--ev-hotel-ink)'    },
  { c: 'var(--ev-car)',      soft: 'var(--ev-car-soft)',      ink: 'var(--ev-car-ink)'      },
  { c: 'var(--ai)',          soft: 'var(--ai-soft)',          ink: 'var(--ai-ink)'          },
  { c: 'var(--warm)',        soft: 'var(--warm-soft)',        ink: 'var(--warm-ink)'        },
  { c: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)' },
];
const cityPal  = (idx) => CITY_PALETTE[idx % CITY_PALETTE.length];
const cityVars = (idx) => {
  const p = cityPal(idx);
  return { '--cc': p.c, '--cc-soft': p.soft, '--cc-ink': p.ink };
};

// Раскраска события — через общий классификатор семейства (тот же, что красит
// таймлайн). Своей копии словаря типов тут нет.
const evCls = (type) => `ev-${eventFamily(type)}`;

const IcoPin = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-5.7-7-11a7 7 0 0114 0c0 5.3-7 11-7 11z"/>
    <circle cx="12" cy="10" r="2"/>
  </svg>
);

// ─── MonthView ────────────────────────────────────────────────────────────────
// weeksData: [{ cells:[{day,inTrip,isToday,events}], bands:[{startCol,span,label,
//   colorIdx,roundStart,roundEnd,lane}], lanes:Number }]

function MonthView({ weeksData, weekdays, onOpenEvent, t }) {
  return (
    <div className="ncal-month">
      <div className="ncal-wdrow">
        {weekdays.map(w => <div key={w} className="ncal-wd t-micro">{w}</div>)}
      </div>

      <div className="ncal-weeks">
        {weeksData.map((wk, wi) => (
          <div key={wi} className="ncal-wk" style={{ '--lanes': wk.lanes }}>
            {/* Day cells (background layer — hairlines, tint, numbers, events) */}
            <div className="ncal-cells">
              {wk.cells.map((c, ci) => {
                const cls = ['ncal-dc'];
                if (c.day == null) cls.push('is-out');
                else {
                  if (c.inTrip)  cls.push('is-trip');
                  if (c.isToday) cls.push('is-today');
                  if (c.events.length) cls.push('has-ev');
                }
                return (
                  <div key={ci} className={cls.join(' ')}>
                    <div className="ncal-dc-top">
                      {c.day != null && <span className="ncal-dn t-label">{c.day}</span>}
                    </div>
                    {/* reserve vertical room for the city-ribbon lanes */}
                    <div className="ncal-dc-lanes" aria-hidden="true" />
                    {c.day != null && c.events.length > 0 && (
                      <div className="ncal-evl">
                        {c.events.slice(0, 3).map((e, ei) => (
                          <button
                            key={ei}
                            type="button"
                            className={`ncal-ev t-tiny ${evCls(e.type)}`}
                            onClick={() => onOpenEvent?.(e)}
                            aria-label={`${e.time ? e.time + ' ' : ''}${e.title}`}
                          >
                            {e.time && <span className="tm">{e.time}</span>}
                            <span className="t">{e.title}</span>
                          </button>
                        ))}
                        {c.events.length > 3 && (
                          <div className="ncal-more t-tiny">+{c.events.length - 3} {t('calendar.more_count')}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* City ribbons — continuous multi-day bands over the week */}
            {wk.bands.length > 0 && (
              <div className="ncal-bands">
                {wk.bands.map((b, bi) => {
                  const bc = ['ncal-ribbon'];
                  if (b.roundStart) bc.push('is-start');
                  if (b.roundEnd)   bc.push('is-end');
                  return (
                    <div
                      key={bi}
                      className={bc.join(' ')}
                      style={{ ...cityVars(b.colorIdx), gridColumn: `${b.startCol + 1} / span ${b.span}`, gridRow: b.lane + 1 }}
                    >
                      {b.label && <span className="ncal-ribbon-t t-tiny">{b.label}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── WeekGrid ─────────────────────────────────────────────────────────────────
// Полноценная колоночная сетка с осью времени.
// days: [{ wd, date, dateStr, isToday, cities:[{colorIdx}], allDay:[ev], timed:[{ev,top,height,lane,lanes}] }]
// hours: [Number], hourH: px, startHour
const HOUR_H = 46;

function WeekGrid({ days, hours, startHour, hasAllDay, onOpenEvent, t }) {
  const gridH = hours.length * HOUR_H;

  return (
    <div className="ncal-week">
      {/* Header row: time-gutter spacer + day headers */}
      <div className="ncal-wk-head">
        <div className="ncal-wk-gut" />
        {days.map((d, di) => (
          <div key={di} className={`ncal-wk-hcell${d.isToday ? ' is-today' : ''}`}>
            <span className="ncal-wk-wd t-micro">{d.wd}</span>
            <span className="ncal-wk-dn t-heading">{d.date}</span>
            <div className="ncal-wk-cbar">
              {d.cities.length
                ? d.cities.map((c, ci) => <span key={ci} className="ncal-wk-cseg" style={{ background: cityPal(c.colorIdx).c }} />)
                : null}
            </div>
          </div>
        ))}
      </div>

      {/* All-day / untimed strip */}
      {hasAllDay && (
        <div className="ncal-wk-allday">
          <div className="ncal-wk-gut t-tiny">{t('calendar.all_day')}</div>
          {days.map((d, di) => (
            <div key={di} className={`ncal-wk-adcell${d.isToday ? ' is-today' : ''}`}>
              {d.allDay.map((e, ei) => (
                <button
                  key={ei}
                  type="button"
                  className={`ncal-chip t-tiny ${evCls(e.type)}`}
                  onClick={() => onOpenEvent?.(e)}
                  aria-label={e.title}
                >
                  <span className="t">{e.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Scrollable time grid */}
      <div className="ncal-wk-scroll">
        <div className="ncal-wk-body" style={{ height: gridH }}>
          {/* time gutter */}
          <div className="ncal-wk-times">
            {hours.map((h, hi) => (
              <div key={hi} className="ncal-wk-time" style={{ top: hi * HOUR_H }}>
                <span className="t-tiny">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>

          {/* day columns */}
          <div className="ncal-wk-cols">
            {/* hour gridlines (span all columns) */}
            <div className="ncal-wk-lines" aria-hidden="true">
              {hours.map((h, hi) => <div key={hi} className="ncal-wk-line" style={{ top: hi * HOUR_H }} />)}
            </div>

            {days.map((d, di) => (
              <div key={di} className={`ncal-wk-col${d.isToday ? ' is-today' : ''}`}>
                {d.timed.length === 0 && d.allDay.length === 0 && (
                  <div className="ncal-wk-free t-tiny">{d.cities.length ? '' : ''}</div>
                )}
                {d.timed.map((it, ii) => (
                  <button
                    key={ii}
                    type="button"
                    className={`ncal-tev ${evCls(it.ev.type)}`}
                    style={{
                      top: it.top,
                      height: Math.max(it.height, 34),
                      left: `calc(${(it.lane / it.lanes) * 100}% + 2px)`,
                      width: `calc(${(1 / it.lanes) * 100}% - 4px)`,
                    }}
                    onClick={() => onOpenEvent?.(it.ev)}
                    aria-label={`${it.ev.time} ${it.ev.title}`}
                  >
                    <span className="ncal-tev-tm t-tiny">{it.ev.time}</span>
                    <span className="ncal-tev-t t-tiny">{it.ev.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Aside — trip summary ─────────────────────────────────────────────────────
function TripAside({ cities, stats, t }) {
  if (!cities.length && !stats) return null;
  return (
    <aside className="ncal-aside">
      {stats && (
        <div className="ncal-card ncal-stats">
          <div className="ncal-stat">
            <span className="ncal-stat-n t-heading">{stats.days}</span>
            <span className="ncal-stat-l t-tiny">{t('calendar.stat_days')}</span>
          </div>
          <div className="ncal-stat">
            <span className="ncal-stat-n t-heading">{stats.cities}</span>
            <span className="ncal-stat-l t-tiny">{t('calendar.stat_cities')}</span>
          </div>
          <div className="ncal-stat">
            <span className="ncal-stat-n t-heading">{stats.events}</span>
            <span className="ncal-stat-l t-tiny">{t('calendar.stat_events')}</span>
          </div>
        </div>
      )}
      {cities.length > 0 && (
        <div className="ncal-card ncal-cities">
          <div className="ncal-card-h t-micro">{t('calendar.legend_group_cities')}</div>
          <ul className="ncal-clist">
            {cities.map((c, i) => (
              <li key={i} className="ncal-crow">
                <span className="ncal-cdot" style={{ background: cityPal(c.colorIdx).c }} />
                <span className="ncal-cname t-label">{c.name}</span>
                <span className="ncal-crange t-tiny">{c.range}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}

// ─── CalendarLens (main export) ───────────────────────────────────────────────

// Скелетон — командная панель + доска + сводка. Один источник для обеих фаз.
export function CalendarSkeleton() {
  return (
    <div className="col col--g6 ov-anim" aria-busy="true">
      <div className="row row--g4">
        <Skeleton w={240} h={44} r={'var(--r-md)'} />
        <Grow />
        <Skeleton w={240} h={40} r={'var(--r-pill)'} />
      </div>
      <div className="row row--g6">
        <Grow><Skeleton w="100%" h={560} r={'var(--r-md)'} /></Grow>
        <Skeleton w={260} h={560} r={'var(--r-md)'} />
      </div>
    </div>
  );
}

export default function CalendarLens({ stream, visits, isLoading, onOpenEvent }) {
  const { t, lang } = useI18n();
  const MONTH_NAMES = useMemo(() => monthNames(lang),   [lang]);
  const MONTH_SHORT = useMemo(() => monthShort(lang),   [lang]);
  const WD_NAMES    = useMemo(() => weekdayNames(lang), [lang]);

  const [view,        setView]        = useState('month');
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset,  setWeekOffset]  = useState(0);

  // Base date: first dated visit
  const firstDatedVisit = visits.find(v => v.start_date);
  const baseDateStr = firstDatedVisit ? naiveDayKey(firstDatedVisit.start_date) : null;
  const baseDate    = baseDateStr ? parseNaive(baseDateStr + 'T00:00:00') : null;
  const currentMonth = baseDate ? baseDate.plus({ months: monthOffset }) : null;
  const today        = DateTime.now();

  // Trip visits without anchors, with parsed dates.
  const tripVisits = useMemo(() => visits
    .map((v, idx) => ({ ...v, idx, s: parseNaive(v.start_date), e: parseNaive(v.end_date) }))
    .filter(v => v.kind !== 'start' && v.kind !== 'end' && v.s && v.e), [visits]);

  // ── Month grid + continuous city ribbons ────────────────────────────────────
  const monthData = useMemo(() => {
    if (!currentMonth) return null;
    const y = currentMonth.year, m = currentMonth.month;
    const first = currentMonth.startOf('month');
    const dim = currentMonth.daysInMonth;
    const offset = first.weekday - 1;
    const totalCells = Math.ceil((offset + dim) / 7) * 7;

    // events per day-number
    const evByDay = {};
    for (const e of stream) {
      if (!e.date) continue;
      const dt = parseNaive(e.date + 'T00:00:00');
      if (!dt || dt.year !== y || dt.month !== m) continue;
      (evByDay[dt.day] ||= []).push(e);
    }
    Object.values(evByDay).forEach(arr => arr.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')));

    // trip-days set
    const tripDays = new Set();
    for (const v of tripVisits) {
      let cur = v.s;
      while (cur <= v.e) { if (cur.year === y && cur.month === m) tripDays.add(cur.day); cur = cur.plus({ days: 1 }); }
    }
    const todayDay = today.year === y && today.month === m ? today.day : null;

    const weeks = [];
    const nWeeks = totalCells / 7;
    for (let w = 0; w < nWeeks; w++) {
      const cells = [];
      for (let i = 0; i < 7; i++) {
        const day = w * 7 + i - offset + 1;
        const valid = day >= 1 && day <= dim;
        cells.push({
          day: valid ? day : null,
          inTrip: valid && tripDays.has(day),
          isToday: valid && day === todayDay,
          events: valid ? (evByDay[day] || []) : [],
        });
      }
      // first / last real day-number in this week
      const dayNums = cells.map(c => c.day).filter(d => d != null);
      const wkStart = dayNums[0], wkEnd = dayNums[dayNums.length - 1];

      // bands: intersect each trip visit with this week's day span
      const bands = [];
      tripVisits.forEach((v) => {
        const vs = (v.s.year === y && v.s.month === m) ? v.s.day : -Infinity;
        const ve = (v.e.year === y && v.e.month === m) ? v.e.day : Infinity;
        const segStart = Math.max(vs, wkStart);
        const segEnd   = Math.min(ve, wkEnd);
        if (segStart > segEnd) return;
        const startCol = cells.findIndex(c => c.day === segStart);
        const endCol   = cells.findIndex(c => c.day === segEnd);
        if (startCol < 0 || endCol < 0) return;
        bands.push({
          colorIdx: v.idx,
          startCol,
          span: endCol - startCol + 1,
          // rounded end where the visit actually begins/ends (not clamped by week edge)
          roundStart: vs !== -Infinity && vs >= wkStart,
          roundEnd:   ve !== Infinity  && ve <= wkEnd,
          // label only on the true first day of the visit within the month
          label: (vs !== -Infinity && vs >= wkStart) ? (v.city_name || '—') : '',
          _sortStart: segStart,
        });
      });
      // lane assignment: sequential by start day
      bands.sort((a, b) => a._sortStart - b._sortStart || a.colorIdx - b.colorIdx);
      bands.forEach((b, i) => { b.lane = i; });
      weeks.push({ cells, bands, lanes: Math.max(bands.length, 0) });
    }
    return { y, m, weeks };
  }, [currentMonth, stream, tripVisits, today]);

  // ── Week time-grid data ─────────────────────────────────────────────────────
  const weekData = useMemo(() => {
    if (!baseDate) return null;
    const weekStart = baseDate.startOf('week').plus({ weeks: weekOffset });
    const weekEnd   = weekStart.plus({ days: 6 });
    const todayStr  = naiveDayKey(today.toISO());

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = weekStart.plus({ days: i });
      const dayStr = naiveDayKey(d.toISO());
      const cities = tripVisits
        .filter(v => d >= v.s && d <= v.e)
        .map(v => ({ colorIdx: v.idx, startMs: v.s.toMillis() }))
        .sort((a, b) => a.startMs - b.startMs || a.colorIdx - b.colorIdx);
      days.push({ wd: WD_NAMES[i], date: d.day, dateStr: dayStr, isToday: dayStr === todayStr, cities, allDay: [], timed: [] });
    }

    // distribute events
    let minH = 24, maxH = 0, anyTimed = false;
    for (const e of stream) {
      if (!e.date) continue;
      const di = days.findIndex(d => d.dateStr === e.date);
      if (di < 0) continue;
      const mt = /^(\d{1,2}):(\d{2})/.exec(e.time || '');
      if (mt) {
        const h = +mt[1]; const mi = +mt[2];
        days[di].timed.push({ ev: e, startMin: h * 60 + mi });
        minH = Math.min(minH, h); maxH = Math.max(maxH, h); anyTimed = true;
      } else {
        days[di].allDay.push(e);
      }
    }
    // hour range
    let startHour = anyTimed ? Math.max(0, minH - 1) : 8;
    let endHour   = anyTimed ? Math.min(24, maxH + 2) : 21;
    if (endHour - startHour < 6) endHour = Math.min(24, startHour + 6);
    const hours = [];
    for (let h = startHour; h <= endHour; h++) hours.push(h);

    // position timed events + lane-pack overlaps per column
    days.forEach(day => {
      day.timed.sort((a, b) => a.startMin - b.startMin);
      const laneEnds = []; // end minute per lane
      day.timed.forEach(it => {
        const top = ((it.startMin - startHour * 60) / 60) * HOUR_H;
        const durMin = 60;
        const height = (durMin / 60) * HOUR_H;
        const endMin = it.startMin + durMin;
        let lane = laneEnds.findIndex(end => end <= it.startMin);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(endMin); }
        else laneEnds[lane] = endMin;
        it.top = top; it.height = height; it.lane = lane;
      });
      const lanes = Math.max(1, day.timed.reduce((mx, it) => Math.max(mx, it.lane + 1), 1));
      day.timed.forEach(it => { it.lanes = lanes; });
    });

    const hasAllDay = days.some(d => d.allDay.length > 0);
    return { days, hours, startHour, hasAllDay, weekStart, weekEnd };
  }, [baseDate, weekOffset, stream, tripVisits, WD_NAMES, today]);

  // ── Trip meta (subtitle + aside) ────────────────────────────────────────────
  const tripMeta = useMemo(() => {
    if (!tripVisits.length) return null;
    const start = tripVisits.reduce((m, v) => v.s < m ? v.s : m, tripVisits[0].s);
    const end   = tripVisits.reduce((m, v) => v.e > m ? v.e : m, tripVisits[0].e);
    // unique cities (first occurrence order)
    const seen = new Set();
    const cities = [];
    tripVisits.forEach(v => {
      const name = v.city_name || '—';
      if (seen.has(name)) return;
      seen.add(name);
      const rs = v.s, re = v.e;
      const range = rs.month === re.month
        ? `${rs.day}–${re.day} ${MONTH_SHORT[rs.month]}`
        : `${rs.day} ${MONTH_SHORT[rs.month]} – ${re.day} ${MONTH_SHORT[re.month]}`;
      cities.push({ name, colorIdx: v.idx, range });
    });
    const days = Math.round(end.diff(start, 'days').days) + 1;
    const rangeLabel = start.month === end.month
      ? `${start.day} – ${end.day} ${MONTH_SHORT[start.month]}`
      : `${start.day} ${MONTH_SHORT[start.month]} – ${end.day} ${MONTH_SHORT[end.month]}`;
    return { cities, stats: { days, cities: cities.length, events: stream.length }, rangeLabel };
  }, [tripVisits, stream, MONTH_SHORT]);

  // ── Navigation ───────────────────────────────────────────────────────────
  const goBack  = () => view === 'month' ? setMonthOffset(o => o - 1) : setWeekOffset(o => o - 1);
  const goFwd   = () => view === 'month' ? setMonthOffset(o => o + 1) : setWeekOffset(o => o + 1);
  const goHome  = () => { setMonthOffset(0); setWeekOffset(0); };
  const goToday = () => {
    const now = today.startOf('day');
    if (view === 'month') setMonthOffset((now.year - baseDate.year) * 12 + (now.month - baseDate.month));
    else setWeekOffset(Math.round(now.startOf('week').diff(baseDate.startOf('week'), 'weeks').weeks));
  };

  if (isLoading) return <CalendarSkeleton />;
  if (!baseDate)  return <div className="ncal-empty">{t('calendar.no_dates')}</div>;

  const headMonth = view === 'month' ? currentMonth.month : weekData.weekStart.month;
  const headYear  = view === 'month' ? currentMonth.year  : weekData.weekStart.year;

  return (
    <div className="ncal ov-anim--cal">
      {/* ── Command bar ─────────────────────────────────────────── */}
      <div className="ncal-bar">
        <div className="ncal-bar-title">
          <div className="ncal-title-row">
            <span className="ncal-month-lbl t-display">{MONTH_NAMES[headMonth]}</span>
            <span className="ncal-year-lbl t-heading">{headYear}</span>
          </div>
          {tripMeta && (
            <div className="ncal-sub t-meta">
              <span className="ncal-sub-range">{tripMeta.rangeLabel}</span>
              <span className="ncal-sub-dot" />
              <span>{tripMeta.stats.cities}&nbsp;{t('calendar.stat_cities')}</span>
              <span className="ncal-sub-dot" />
              <span>{tripMeta.stats.events}&nbsp;{t('calendar.stat_events')}</span>
            </div>
          )}
        </div>

        <div className="ncal-bar-ctl">
          <Row inline gap="g1" className="ncal-nav">
            <IconBtn icon="chevL" tone="soft" size="sm" round ariaLabel={t('calendar.prev')} onClick={goBack} />
            <button className="ncal-nav-txt t-label" onClick={goToday}>{t('calendar.today')}</button>
            <span className="ncal-nav-div" aria-hidden="true" />
            <button className="row row--inline ncal-nav-trip t-label" onClick={goHome}>
              <IcoPin />
              <span className="ncal-trip-label">{t('calendar.to_trip_start')}</span>
            </button>
            <IconBtn icon="chev" tone="soft" size="sm" round ariaLabel={t('calendar.next')} onClick={goFwd} />
          </Row>
          <Seg
            ariaLabel={`${t('calendar.month')} / ${t('calendar.week')}`}
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: t('calendar.month') },
              { value: 'week', label: t('calendar.week') },
            ]}
          />
        </div>
      </div>

      {/* ── Body: calendar + aside ──────────────────────────────── */}
      <div className="ncal-body">
        <div className="ncal-main">
          {view === 'month' ? (
            <MonthView
              weeksData={monthData.weeks}
              weekdays={WD_NAMES}
              onOpenEvent={onOpenEvent}
              t={t}
            />
          ) : (
            <WeekGrid
              days={weekData.days}
              hours={weekData.hours}
              startHour={weekData.startHour}
              hasAllDay={weekData.hasAllDay}
              onOpenEvent={onOpenEvent}
              t={t}
            />
          )}
        </div>

        <TripAside cities={tripMeta?.cities || []} stats={tripMeta?.stats} t={t} />
      </div>
    </div>
  );
}
