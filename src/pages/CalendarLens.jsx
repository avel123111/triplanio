// @ts-check
/**
 * CalendarLens — редизайн (ncal-* namespace).
 *
 * Хедер: заголовок месяц/год + подзаголовок поездки; справа — сегмент
 * месяц/неделя, группа навигации (‹ Сегодня ›) и иконка «к поездке».
 *
 * Месяц: доска 7×N. У каждого дня поездки — СПЛОШНАЯ цветная полоса ГОРОДА в
 * верхней части ячейки; соседние дни одного города визуально сливаются в
 * непрерывную полосу. Транзитный день (2+ города) делит полосу поровну. Имя
 * города — в первый день визита. События: чипы (десктоп) / точки (мобайл).
 *
 * Неделя: колонки + ось времени на ВЕСЬ день (00–24) со скроллом внутри
 * (не выше экрана); в шапке каждого дня — полоса города с НАЗВАНИЕМ.
 *
 * Сводка: счётчики (дни/города/события) + список городов с датами.
 *
 * Цвета/радиусы/тени/кегли — только токены app.css.
 *
 * Props: stream, visits, isLoading, onOpenEvent.
 */
import React, { useState, useMemo, useRef, useLayoutEffect } from 'react';
import { Info, DateTime } from 'luxon';
import { Skeleton, IconBtn, Seg, eventFamily } from '../design/index';
import { Grow } from '../design/Layout';
import { parseNaive, naiveDayKey } from '@/lib/naive-time';
import { useI18n } from '@/lib/i18n/I18nContext';
import { localeTag } from '@/lib/i18n/translations';
import './CalendarLens.css';

const monthNames   = (lang) => ['', ...Info.months('long',  { locale: localeTag(lang) })];
const monthShort   = (lang) => ['', ...Info.months('short', { locale: localeTag(lang) })];
const weekdayNames = (lang) => Info.weekdays('short', { locale: localeTag(lang) });

// City palette — existing ev-*/ai/warm tokens (no new hues).
const CITY_PALETTE = [
  { c: 'var(--ev-activity)', soft: 'var(--ev-activity-soft)', ink: 'var(--ev-activity-ink)' },
  { c: 'var(--ev-hotel)',    soft: 'var(--ev-hotel-soft)',    ink: 'var(--ev-hotel-ink)'    },
  { c: 'var(--ev-car)',      soft: 'var(--ev-car-soft)',      ink: 'var(--ev-car-ink)'      },
  { c: 'var(--ai)',          soft: 'var(--ai-soft)',          ink: 'var(--ai-ink)'          },
  { c: 'var(--warm)',        soft: 'var(--warm-soft)',        ink: 'var(--warm-ink)'        },
  { c: 'var(--ev-transfer)', soft: 'var(--ev-transfer-soft)', ink: 'var(--ev-transfer-ink)' },
];
const cityPal  = (idx) => CITY_PALETTE[idx % CITY_PALETTE.length];
const cityVars = (idx) => { const p = cityPal(idx); return { '--cc': p.c, '--cc-soft': p.soft, '--cc-ink': p.ink }; };

const evCls = (type) => `ev-${eventFamily(type)}`;

const IcoPin = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 21s-7-5.7-7-11a7 7 0 0114 0c0 5.3-7 11-7 11z"/><circle cx="12" cy="10" r="2"/>
  </svg>
);

// ─── MonthView ────────────────────────────────────────────────────────────────
function MonthView({ cells, weekdays, onOpenEvent, t }) {
  return (
    <div className="ncal-month">
      <div className="ncal-wdrow">
        {weekdays.map(w => <div key={w} className="ncal-wd t-micro">{w}</div>)}
      </div>
      <div className="ncal-grid">
        {cells.map((c, ci) => {
          const cls = ['ncal-dc'];
          if (c.day == null) cls.push('is-out');
          else {
            if (c.isToday) cls.push('is-today');
            if (c.events.length) cls.push('has-ev');
            if (c.cities.length) cls.push('is-trip');
          }
          const labelCity = c.cities.find(x => x.first);
          return (
            <div key={ci} className={cls.join(' ')}>
              {/* город(а) дня — сплошная полоса сверху, транзит делит поровну */}
              {c.cities.length > 0 && (
                <div className="ncal-daytop" aria-hidden="true">
                  {c.cities.map((x, xi) => (
                    <span key={xi} className="ncal-daytop-s" style={{ background: cityPal(x.colorIdx).c }} />
                  ))}
                </div>
              )}

              <div className="ncal-dc-top">
                {c.day != null && <span className="ncal-dn t-label">{c.day}</span>}
                {labelCity && <span className="ncal-dc-city t-tiny" style={{ color: cityPal(labelCity.colorIdx).ink }}>{labelCity.name}</span>}
              </div>

              {c.events.length > 0 && (
                <>
                  <div className="ncal-evl">
                    {c.events.slice(0, 2).map((e, ei) => (
                      <button key={ei} type="button" className={`ncal-ev t-tiny ${evCls(e.type)}`}
                        onClick={() => onOpenEvent?.(e)} aria-label={`${e.time ? e.time + ' ' : ''}${e.title}`}>
                        {e.time && <span className="tm">{e.time}</span>}
                        <span className="t">{e.title}</span>
                      </button>
                    ))}
                    {c.events.length > 2 && <div className="ncal-more t-tiny">+{c.events.length - 2} {t('calendar.more_count')}</div>}
                  </div>
                  <div className="ncal-dots" aria-hidden="true">
                    {c.events.slice(0, 5).map((e, ei) => <span key={ei} className={`ncal-dot ${evCls(e.type)}`} />)}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── WeekGrid — columns + full-day time axis ──────────────────────────────────
const HOUR_H = 44;

function WeekGrid({ days, hours, lines, hasAllDay, scrollToHour, onOpenEvent, t }) {
  const gridH = 24 * HOUR_H;
  const scrollRef = useRef(/** @type {HTMLDivElement | null} */(null));

  // Прокрутить к первому событию (или к утру) при монтировании/смене недели.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (scrollToHour - 0.5) * HOUR_H);
  }, [scrollToHour, days]);

  return (
    <div className="ncal-week">
      <div className="ncal-wk-head">
        <div className="ncal-wk-gut" />
        {days.map((d, di) => (
          <div key={di} className={`ncal-wk-hcell${d.isToday ? ' is-today' : ''}`}>
            <div className="ncal-wk-hd">
              <span className="ncal-wk-wd t-micro">{d.wd}</span>
              <span className="ncal-wk-dn t-heading">{d.date}</span>
            </div>
            <div className="ncal-wk-city">
              {d.cities.map((c, ci) => (
                <span key={ci} className="ncal-wk-cseg t-tiny" style={cityVars(c.colorIdx)}>{c.name}</span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasAllDay && (
        <div className="ncal-wk-allday">
          <div className="ncal-wk-gut t-tiny">{t('calendar.all_day')}</div>
          {days.map((d, di) => (
            <div key={di} className={`ncal-wk-adcell${d.isToday ? ' is-today' : ''}`}>
              {d.allDay.map((e, ei) => (
                <button key={ei} type="button" className={`ncal-chip t-tiny ${evCls(e.type)}`}
                  onClick={() => onOpenEvent?.(e)} aria-label={e.title}><span className="t">{e.title}</span></button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="ncal-wk-scroll" ref={scrollRef}>
        <div className="ncal-wk-body" style={{ height: gridH }}>
          <div className="ncal-wk-times">
            {hours.map(h => (
              <div key={h} className="ncal-wk-time" style={{ top: h * HOUR_H }}>
                <span className="t-tiny">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>
          <div className="ncal-wk-cols">
            <div className="ncal-wk-lines" aria-hidden="true">
              {lines.map(h => <div key={h} className="ncal-wk-line" style={{ top: h * HOUR_H }} />)}
            </div>
            {days.map((d, di) => (
              <div key={di} className={`ncal-wk-col${d.isToday ? ' is-today' : ''}`}>
                {d.timed.map((it, ii) => (
                  <button key={ii} type="button" className={`ncal-tev ${evCls(it.ev.type)}`}
                    style={{
                      top: it.top, height: Math.max(it.height, 30),
                      left: `calc(${(it.lane / it.lanes) * 100}% + 2px)`,
                      width: `calc(${(1 / it.lanes) * 100}% - 4px)`,
                    }}
                    onClick={() => onOpenEvent?.(it.ev)} aria-label={`${it.ev.time} ${it.ev.title}`}>
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
          <div className="ncal-stat"><span className="ncal-stat-n t-heading">{stats.days}</span><span className="ncal-stat-l t-tiny">{t('calendar.stat_days')}</span></div>
          <div className="ncal-stat"><span className="ncal-stat-n t-heading">{stats.cities}</span><span className="ncal-stat-l t-tiny">{t('calendar.stat_cities')}</span></div>
          <div className="ncal-stat"><span className="ncal-stat-n t-heading">{stats.events}</span><span className="ncal-stat-l t-tiny">{t('calendar.stat_events')}</span></div>
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

// ─── Skeleton ─────────────────────────────────────────────────────────────────
export function CalendarSkeleton() {
  return (
    <div className="col col--g6 ov-anim" aria-busy="true">
      <div className="row row--g4">
        <Skeleton w={220} h={34} r={'var(--r-sm)'} /><Grow /><Skeleton w={230} h={36} r={'var(--r-pill)'} />
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

  const firstDatedVisit = visits.find(v => v.start_date);
  const baseDateStr = firstDatedVisit ? naiveDayKey(firstDatedVisit.start_date) : null;
  const baseDate    = baseDateStr ? parseNaive(baseDateStr + 'T00:00:00') : null;
  const currentMonth = baseDate ? baseDate.plus({ months: monthOffset }) : null;
  const today        = DateTime.now();

  const tripVisits = useMemo(() => visits
    .map((v, idx) => ({ ...v, idx, s: parseNaive(v.start_date), e: parseNaive(v.end_date) }))
    .filter(v => v.kind !== 'start' && v.kind !== 'end' && v.s && v.e), [visits]);

  // Пересадки/переезды в календаре не показываем — только «содержательные»
  // события (отели, активности, дедлайны и т.п.). Семейство transfer отсеиваем.
  const calStream = useMemo(() => stream.filter(e => eventFamily(e.type) !== 'transfer'), [stream]);

  // ── Month grid ───────────────────────────────────────────────────────────────
  const monthData = useMemo(() => {
    if (!currentMonth) return null;
    const y = currentMonth.year, m = currentMonth.month;
    const first = currentMonth.startOf('month');
    const dim = currentMonth.daysInMonth;
    const offset = first.weekday - 1;
    const totalCells = Math.ceil((offset + dim) / 7) * 7;

    const evByDay = {};
    for (const e of calStream) {
      if (!e.date) continue;
      const dt = parseNaive(e.date + 'T00:00:00');
      if (!dt || dt.year !== y || dt.month !== m) continue;
      (evByDay[dt.day] ||= []).push(e);
    }
    Object.values(evByDay).forEach(arr => arr.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')));

    const todayDay = today.year === y && today.month === m ? today.day : null;

    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const day = i - offset + 1;
      if (day < 1 || day > dim) { cells.push({ day: null, cities: [], events: [] }); continue; }
      const dayDt = currentMonth.set({ day }).startOf('day');
      const cities = tripVisits
        .filter(v => dayDt >= v.s.startOf('day') && dayDt <= v.e.startOf('day'))
        .sort((a, b) => a.s - b.s || a.idx - b.idx)
        .map(v => ({ colorIdx: v.idx, first: v.s.hasSame(dayDt, 'day'), name: v.city_name || '—' }));
      cells.push({ day, isToday: day === todayDay, events: evByDay[day] || [], cities });
    }
    return { y, m, cells };
  }, [currentMonth, calStream, tripVisits, today]);

  // ── Week time-grid (full day) ─────────────────────────────────────────────────
  const weekData = useMemo(() => {
    if (!baseDate) return null;
    const weekStart = baseDate.startOf('week').plus({ weeks: weekOffset });
    const todayStr  = naiveDayKey(today.toISO());

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = weekStart.plus({ days: i });
      const dd = d.startOf('day');
      const cities = tripVisits
        .filter(v => dd >= v.s.startOf('day') && dd <= v.e.startOf('day'))
        .sort((a, b) => a.s - b.s || a.idx - b.idx)
        .map(v => ({ colorIdx: v.idx, name: v.city_name || '—' }));
      days.push({ wd: WD_NAMES[i], date: d.day, dateStr: naiveDayKey(d.toISO()), isToday: naiveDayKey(d.toISO()) === todayStr, cities, allDay: [], timed: [] });
    }

    let firstHour = 8;
    let any = false;
    for (const e of calStream) {
      if (!e.date) continue;
      const di = days.findIndex(d => d.dateStr === e.date);
      if (di < 0) continue;
      const mt = /^(\d{1,2}):(\d{2})/.exec(e.time || '');
      if (mt) { const h = +mt[1]; days[di].timed.push({ ev: e, startMin: h * 60 + +mt[2] }); if (!any || h < firstHour) firstHour = h; any = true; }
      else days[di].allDay.push(e);
    }

    // full day 00..24
    const hours = []; for (let h = 0; h <= 23; h++) hours.push(h);
    const lines = []; for (let h = 0; h <= 24; h++) lines.push(h);

    days.forEach(day => {
      day.timed.sort((a, b) => a.startMin - b.startMin);
      const laneEnds = [];
      day.timed.forEach(it => {
        const top = (it.startMin / 60) * HOUR_H;
        const endMin = it.startMin + 60;
        let lane = laneEnds.findIndex(end => end <= it.startMin);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(endMin); } else laneEnds[lane] = endMin;
        it.top = top; it.height = HOUR_H; it.lane = lane;
      });
      const lanes = Math.max(1, day.timed.reduce((mx, it) => Math.max(mx, it.lane + 1), 1));
      day.timed.forEach(it => { it.lanes = lanes; });
    });

    return { days, hours, lines, hasAllDay: days.some(d => d.allDay.length > 0), weekStart, scrollToHour: any ? Math.max(0, firstHour - 1) : 7 };
  }, [baseDate, weekOffset, stream, tripVisits, WD_NAMES, today]);

  // ── Trip meta ────────────────────────────────────────────────────────────────
  const tripMeta = useMemo(() => {
    if (!tripVisits.length) return null;
    const start = tripVisits.reduce((mn, v) => v.s < mn ? v.s : mn, tripVisits[0].s);
    const end   = tripVisits.reduce((mx, v) => v.e > mx ? v.e : mx, tripVisits[0].e);
    const fmt = (a, b) => a.month === b.month
      ? `${a.day}–${b.day} ${MONTH_SHORT[a.month]}`
      : `${a.day} ${MONTH_SHORT[a.month]} – ${b.day} ${MONTH_SHORT[b.month]}`;
    const seen = new Set();
    const cities = [];
    tripVisits.forEach(v => {
      const name = v.city_name || '—';
      if (seen.has(name)) return;
      seen.add(name);
      cities.push({ name, colorIdx: v.idx, range: fmt(v.s, v.e) });
    });
    const days = Math.round(end.diff(start, 'days').days) + 1;
    return { cities, stats: { days, cities: cities.length, events: calStream.length }, rangeLabel: fmt(start, end) };
  }, [tripVisits, stream, MONTH_SHORT]);

  // ── Navigation ────────────────────────────────────────────────────────────────
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
      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="ncal-bar">
        <div className="ncal-bar-title">
          <h2 className="ncal-title-row">
            <span className="ncal-month-lbl t-title">{MONTH_NAMES[headMonth]}</span>
            <span className="ncal-year-lbl t-subheading">{headYear}</span>
          </h2>
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
          <Seg
            className="ncal-seg"
            ariaLabel={`${t('calendar.month')} / ${t('calendar.week')}`}
            value={view}
            onChange={setView}
            options={[{ value: 'month', label: t('calendar.month') }, { value: 'week', label: t('calendar.week') }]}
          />
          <div className="ncal-nav">
            <IconBtn icon="chevL" tone="soft" size="sm" round ariaLabel={t('calendar.prev')} onClick={goBack} />
            <button className="ncal-today t-label" onClick={goToday}>{t('calendar.today')}</button>
            <IconBtn icon="chev" tone="soft" size="sm" round ariaLabel={t('calendar.next')} onClick={goFwd} />
          </div>
          <button className="ncal-trip-btn" onClick={goHome} aria-label={t('calendar.to_trip_start')} title={t('calendar.to_trip_start')}>
            <IcoPin />
          </button>
        </div>
      </header>

      {/* ── Body ─────────────────────────────────────────────────── */}
      <div className="ncal-body">
        <div className="ncal-main">
          {view === 'month'
            ? <MonthView cells={monthData.cells} weekdays={WD_NAMES} onOpenEvent={onOpenEvent} t={t} />
            : <WeekGrid days={weekData.days} hours={weekData.hours} lines={weekData.lines} hasAllDay={weekData.hasAllDay} scrollToHour={weekData.scrollToHour} onOpenEvent={onOpenEvent} t={t} />}
        </div>
        <TripAside cities={tripMeta?.cities || []} stats={tripMeta?.stats} t={t} />
      </div>
    </div>
  );
}
