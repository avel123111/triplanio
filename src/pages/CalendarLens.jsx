// @ts-check
/**
 * CalendarLens — редизайн (ncal-* namespace).
 *
 * Хедер: заголовок месяц/год + подзаголовок поездки; справа — сегмент
 * месяц/неделя, группа навигации (‹ Сегодня ›) и иконка «к поездке».
 *
 * ★ ПОЛОСА ГОРОДА — ОДНА НА ВИЗИТ, И В ОБОИХ ВИДАХ ОДИНАКОВАЯ. Она цельная от
 * заезда до выезда и несёт имя внутри себя; день пересадки делится между
 * городами, поэтому границы ДРОБНЫЕ (модель — `lib/calendar-bands.js`, под
 * тестом). Прежняя редакция собирала полосы из «дней с одним городом» и писала
 * имя только над ними: город с ОДНОЙ ночью между двумя другими таких дней не
 * имеет вовсе — его имя не печаталось нигде.
 *
 * Месяц: доска 7×N, полосы — одним слоем поверх недельного ряда.
 * События: чипы (десктоп) / точки (мобайл).
 *
 * Неделя: колонки + ось времени на дневное окно 06–23 (растягивается под
 * ранние/поздние события). Десктоп — внутренний скролл, не выше экрана; мобайл
 * — скроллит страница, колонки свайпаются по горизонтали. Полосы городов —
 * отдельным рядом под шапкой дней. Цвет города — по имени (синхронно со сводкой).
 *
 * Сводка: счётчики (дни/города/события) + список городов с датами.
 *
 * Цвета/радиусы/тени/кегли — только токены app.css.
 *
 * Props: stream, visits, isLoading, onOpenEvent.
 */
import React, { useState, useMemo, useRef, useLayoutEffect, useCallback } from 'react';
import { Info, DateTime } from 'luxon';
import { Skeleton, IconBtn, Seg, Btn, Card, ListRow, Chip, CityBar, EventChip, cityTone, eventFamily } from '../design/index';
import { Row, Col, Grow } from '../design/Layout';
import { parseNaive, naiveDayKey } from '@/lib/naive-time';
import { isTransitVisit } from '@/lib/trip-cities';
import { cityBands, bandStyle } from '@/lib/calendar-bands';
import { useI18n } from '@/lib/i18n/I18nContext';
import { localeTag } from '@/lib/i18n/translations';
import './CalendarLens.css';

const monthNames   = (lang) => ['', ...Info.months('long',  { locale: localeTag(lang) })];
const monthShort   = (lang) => ['', ...Info.months('short', { locale: localeTag(lang) })];
const weekdayNames = (lang) => Info.weekdays('short', { locale: localeTag(lang) });

/** День попадает в окно визита (границы включительно). ОДИН предикат на оба
 *  вида: месяц и неделя спрашивали одно и то же двумя копиями строки. */
const visitCoversDay = (v, dt) => dt >= v.s.startOf('day') && dt <= v.e.startOf('day'); // i18n-ignore: не UI-строка — сравнение дат; `>=` в стрелке гард 2d читает как закрытие тега и принимает хвост выражения за текст JSX

// ─── MonthView ────────────────────────────────────────────────────────────────
function MonthView({ cells, weekdays, onOpenEvent, onOpenCity, t }) {
  // Раскрытые дни (по ключу день+месяц). «+N ещё» разворачивает ячейку и
  // показывает ВСЕ события дня; повторный клик сворачивает. Не мёртвая кнопка.
  const [open, setOpen] = useState(() => new Set());
  const toggle = useCallback((key) => setOpen(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  }), []);

  // Доска рисуется НЕДЕЛЬНЫМИ рядами: так название города можно вести СПЛОШНЫМ
  // поверх всего прогона одинакового города (по центру), а не втискивать в первую
  // узкую ячейку (где на мобиле оно превращалось в «В..»). Полосы-цвета остаются
  // по ячейкам (непрерывность + деление дня-пересадки), имена — отдельным слоем.
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <Card radius="md" pad="none" className="ncal-month">
      <div className="ncal-wdrow">
        {weekdays.map(w => <div key={w} className="ncal-wd t-micro">{w}</div>)}
      </div>
      <div className="ncal-grid">
        {weeks.map((week, wi) => {
          const bands = cityBands(week);
          return (
            <div key={wi} className="ncal-wk-row">
              {week.map((c, di) => {
                const ci = wi * 7 + di;
                const cls = ['ncal-dc'];
                if (c.day == null) cls.push('is-out');
                else {
                  if (c.isToday) cls.push('is-today');
                  if (c.events.length) cls.push('has-ev');
                  if (c.cities.length) cls.push('is-trip');
                }
                const isOpen = open.has(ci);
                const shown = isOpen ? c.events : c.events.slice(0, 2);
                return (
                  <div key={di} className={`${cls.join(' ')}${isOpen ? ' is-open' : ''}`}>
                    {/* Полос города в ЯЧЕЙКЕ больше нет: они рисуются одним слоем
                        поверх всего ряда (`.ncal-daytop` ниже), чтобы полоса была
                        цельной на весь визит и несла его имя. */}

                    <Row gap="g3" className="ncal-dc-top">
                      {c.day != null && <Row as="span" inline justify="j-center" className="ncal-dn t-label">{c.day}</Row>}
                    </Row>

                    {c.events.length > 0 && (
                      <>
                        <div className="ncal-evl">
                          {shown.map((e, ei) => (
                            <EventChip key={ei} variant="inline" type={e.type} time={e.time} title={e.title}
                              onClick={() => onOpenEvent?.(e)} ariaLabel={`${e.time ? e.time + ' ' : ''}${e.title}`} className="t-tiny" />
                          ))}
                          {c.events.length > 2 && (
                            <Chip variant="soft" sm square className="t-tiny" onClick={() => toggle(ci)}>
                              {isOpen ? t('calendar.collapse') : `+${c.events.length - 2} ${t('calendar.more_count')}`}
                            </Chip>
                          )}
                        </div>
                        <div className="ncal-dots" aria-hidden="true">
                          {c.events.slice(0, 5).map((e, ei) => <span key={ei} className={`ncal-dot ev-${eventFamily(e.type)}`} />)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              {/* Полосы городов — ОДИН слой на весь ряд: полоса цельная на весь
                  визит и несёт его имя. Границы дробные (день пересадки делится
                  между городами), поэтому позиция приходит процентами, а не
                  грид-спаном: спан умеет только целые дни, а у города с одной
                  ночью тело полосы — ровно от середины до середины. */}
              {bands.length > 0 && (
                <div className="ncal-daytop">
                  {bands.map((b, bi) => (
                    <CityBar key={bi} variant="strip" tone={b.city.colorIdx} label={b.city.name}
                      className="t-tiny" style={bandStyle(b)}
                      onClick={() => onOpenCity?.(b.city.v)} ariaLabel={b.city.name} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── WeekGrid — columns + full-day time axis ──────────────────────────────────
const HOUR_H = 44;

function WeekGrid({ days, hours, lines, gridH, startHour, hasAllDay, scrollToHour, weekKey, onOpenEvent, onOpenCity, t }) {
  const scrollRef = useRef(/** @type {HTMLDivElement | null} */(null));

  // Фокус на 08:00 ТОЛЬКО при смене недели (стабильный weekKey), не на каждом
  // ре-рендере: открытие панели события ре-рендерит родителя и раньше сбрасывало
  // скролл сетки. Зависимость — weekKey, а не свежая ссылка `days`.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = Math.max(0, (scrollToHour - startHour - 0.5) * HOUR_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey]);

  return (
    <Card radius="md" pad="none" className="ncal-week">
      <div className="ncal-wk-head">
        <Row justify="j-center" className="ncal-wk-gut" />
        {days.map((d, di) => (
          <div key={di} className={`ncal-wk-hcell${d.isToday ? ' is-today' : ''}`}>
            <div className="ncal-wk-hd">
              <span className="ncal-wk-wd t-micro">{d.wd}</span>
              <Row as="span" inline justify="j-center" className="ncal-wk-dn t-heading">{d.date}</Row>
            </div>
          </div>
        ))}
      </div>

      {/* Полоса городов — ОТДЕЛЬНЫЙ ряд под шапкой дней, и плашка ЦЕЛЬНАЯ на
          весь прогон, а не нарезанная по дням. Имя стоит ВНУТРИ неё и печатается
          один раз: в колонку 96px на телефоне название не влезало и рвалось в
          «Мад…» семь раз подряд, а нарезка по дням делала прогон рваным.
          День-пересадка — свой сегмент шириной в день, поделённый между
          городами: там имя не печатается, деление видно цветом. */}
      {days.some(d => d.cities.length > 0) && (
        <div className="ncal-wk-cities">
          <div className="ncal-wk-gut" />
          {/* Тот же слой полос, что в месяце: полоса цельная на весь визит,
              имя внутри неё, день пересадки делится между городами. */}
          <div className="ncal-daytop">
            {cityBands(days).map((b, bi) => (
              <CityBar key={bi} variant="strip" tone={b.city.colorIdx} label={b.city.name}
                className="t-tiny" style={bandStyle(b)}
                onClick={() => onOpenCity?.(b.city.v)} ariaLabel={b.city.name} />
            ))}
          </div>
        </div>
      )}

      {hasAllDay && (
        <div className="ncal-wk-allday">
          <Row justify="j-center" className="ncal-wk-gut t-tiny">{t('calendar.all_day')}</Row>
          {days.map((d, di) => (
            <div key={di} className={`ncal-wk-adcell${d.isToday ? ' is-today' : ''}`}>
              {d.allDay.map((e, ei) => (
                <EventChip key={ei} variant="allday" type={e.type} title={e.title}
                  onClick={() => onOpenEvent?.(e)} ariaLabel={e.title} className="t-tiny" />
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="ncal-wk-scroll" ref={scrollRef}>
        <div className="ncal-wk-body" style={{ height: gridH }}>
          <div className="ncal-wk-times">
            {hours.map(h => (
              <div key={h} className="ncal-wk-time" style={{ top: (h - startHour) * HOUR_H }}>
                <span className="t-tiny">{String(h).padStart(2, '0')}:00</span>
              </div>
            ))}
          </div>
          <div className="ncal-wk-cols">
            <div className="ncal-wk-lines" aria-hidden="true">
              {lines.map(h => <div key={h} className="ncal-wk-line" style={{ top: (h - startHour) * HOUR_H }} />)}
            </div>
            {days.map((d, di) => (
              <div key={di} className={`ncal-wk-col${d.isToday ? ' is-today' : ''}`}>
                {d.timed.map((it, ii) => (
                  <EventChip key={ii} variant="block" type={it.ev.type} time={it.ev.time} title={it.ev.title}
                    className="t-tiny"
                    style={{
                      top: it.top, height: Math.max(it.height, 30),
                      left: `calc(${(it.lane / it.lanes) * 100}% + 2px)`,
                      width: `calc(${(1 / it.lanes) * 100}% - 4px)`,
                    }}
                    onClick={() => onOpenEvent?.(it.ev)} ariaLabel={`${it.ev.time} ${it.ev.title}`} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── Cities aside ─────────────────────────────────────────────────────────────
// Правый виджет городов поездки — список «цвет · город · даты», синхронный с
// полосами календаря (цвет по имени). Строка кликабельна — открывает панель
// города. Только города (по ресурсу), без счётчиков-статистики (она в шапке).
function CitiesAside({ cities, onOpenCity, t }) {
  if (!cities.length) return null;
  return (
    <Card as="aside" radius="md" pad="none" className="col col--g2 ncal-aside">
      <div className="ncal-aside-h t-label">{t('calendar.legend_group_cities')}</div>
      <div className="ncal-aside-list">
        {cities.map((c, i) => (
          <ListRow key={i} variant="compact" className="ncal-ci" onClick={() => onOpenCity?.(c.v)}
            lead={<span className="ncal-ci-dot" style={{ background: cityTone(c.colorIdx).bar }} />}
            trail={<span className="ncal-ci-range t-tiny">{c.range}</span>}
            aria-label={`${c.name}${c.range ? ', ' + c.range : ''}`}>
            {/* имя города — канон .t-meta (не bold .t-strong заголовка ListRow: канон-инспектор TRIP-175); .trunc — канон-обрезка */}
            <span className="t-meta trunc">{c.name}</span>
          </ListRow>
        ))}
      </div>
    </Card>
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

export default function CalendarLens({ stream, visits, isLoading, onOpenEvent, onOpenCity }) {
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

  // Города календаря = РЕАЛЬНЫЕ пункты со ночёвкой. Убираем:
  //   • якоря (start/end) и waypoints — через канон isTransitVisit (kind==='transit');
  //   • пересадки/pass-through БЕЗ ночёвки (start_date === end_date) — даже если
  //     помечены transit: это проезд насквозь, а не остановка (напр. Москва 21–21
  //     перед Ярославлем). «Нет ночёвки» = не показываем в календаре.
  const tripVisits = useMemo(() => visits
    .map((v, idx) => ({ ...v, idx, s: parseNaive(v.start_date), e: parseNaive(v.end_date) }))
    .filter(v => isTransitVisit(v) && v.s && v.e && !v.s.hasSame(v.e, 'day')), [visits]);

  // Цвет города — по ИМЕНИ, а не по индексу визита: один город (напр. возврат
  // в Рим) должен быть одного цвета в календаре И в сводке. Иначе цвета
  // рассинхронятся (сводка дедуплицирует по имени, календарь красил по idx).
  const cityColorMap = useMemo(() => {
    const m = new Map(); let n = 0;
    tripVisits.forEach(v => { const name = v.city_name || '—'; if (!m.has(name)) m.set(name, n++); });
    return m;
  }, [tripVisits]);
  const cityColor = (name) => cityColorMap.get(name ?? '—') ?? 0;

  // ── Month grid ───────────────────────────────────────────────────────────────
  const monthData = useMemo(() => {
    if (!currentMonth) return null;
    const y = currentMonth.year, m = currentMonth.month;
    const first = currentMonth.startOf('month');
    const dim = currentMonth.daysInMonth;
    const offset = first.weekday - 1;
    const totalCells = Math.ceil((offset + dim) / 7) * 7;

    const evByDay = {};
    for (const e of stream) {
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
        .filter(v => visitCoversDay(v, dayDt))
        .sort((a, b) => a.s - b.s || a.idx - b.idx)
        .map(v => ({ colorIdx: cityColor(v.city_name), name: v.city_name || '—', v }));
      cells.push({ day, isToday: day === todayDay, events: evByDay[day] || [], cities });
    }
    return { y, m, cells };
  }, [currentMonth, stream, tripVisits, cityColorMap, today]);

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
        .filter(v => visitCoversDay(v, dd))
        .sort((a, b) => a.s - b.s || a.idx - b.idx)
        .map(v => ({ colorIdx: cityColor(v.city_name), name: v.city_name || '—', v }));
      days.push({ wd: WD_NAMES[i], date: d.day, dateStr: naiveDayKey(d.toISO()), isToday: naiveDayKey(d.toISO()) === todayStr, cities, allDay: [], timed: [] });
    }

    for (const e of stream) {
      if (!e.date) continue;
      const di = days.findIndex(d => d.dateStr === e.date);
      if (di < 0) continue;
      const mt = /^(\d{1,2}):(\d{2})/.exec(e.time || '');
      if (mt) { const h = +mt[1]; days[di].timed.push({ ev: e, startMin: h * 60 + +mt[2] }); }
      else days[di].allDay.push(e);
    }

    // Полные сутки 00–24 — событие в 2 ночи видно так же, как в 2 дня. При
    // открытии фокус встаёт на 08:00 (scrollToHour), ночь — прокруткой вверх.
    const startHour = 0, endHour = 24;
    const hours = []; for (let h = startHour; h < endHour; h++) hours.push(h);
    const lines = []; for (let h = startHour; h <= endHour; h++) lines.push(h);
    const gridH = (endHour - startHour) * HOUR_H;

    days.forEach(day => {
      day.timed.sort((a, b) => a.startMin - b.startMin);
      const laneEnds = [];
      day.timed.forEach(it => {
        const top = (it.startMin / 60 - startHour) * HOUR_H;
        const endMin = it.startMin + 60;
        let lane = laneEnds.findIndex(end => end <= it.startMin);
        if (lane < 0) { lane = laneEnds.length; laneEnds.push(endMin); } else laneEnds[lane] = endMin;
        it.top = top; it.height = HOUR_H; it.lane = lane;
      });
      const lanes = Math.max(1, day.timed.reduce((mx, it) => Math.max(mx, it.lane + 1), 1));
      day.timed.forEach(it => { it.lanes = lanes; });
    });

    return { days, hours, lines, gridH, startHour, hasAllDay: days.some(d => d.allDay.length > 0), weekStart, weekKey: naiveDayKey(weekStart.toISO()), scrollToHour: 8 };
  }, [baseDate, weekOffset, stream, tripVisits, cityColorMap, WD_NAMES, today]);

  // ── Города поездки (для правого виджета) — по имени, дедуп, в порядке визита.
  //    Каждый несёт представительный визит `v` (первое вхождение) для панели. ──
  const tripMeta = useMemo(() => {
    if (!tripVisits.length) return null;
    const fmt = (a, b) => a.month === b.month
      ? `${a.day}–${b.day} ${MONTH_SHORT[a.month]}`
      : `${a.day} ${MONTH_SHORT[a.month]} – ${b.day} ${MONTH_SHORT[b.month]}`;
    const seen = new Set();
    const cities = [];
    tripVisits.forEach(v => {
      const name = v.city_name || '—';
      if (seen.has(name)) return;
      seen.add(name);
      cities.push({ name, colorIdx: cityColor(name), range: fmt(v.s, v.e), v });
    });
    return { cities };
  }, [tripVisits, cityColorMap, MONTH_SHORT]);

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
  if (!baseDate)  return <div className="ncal-empty t-body">{t('calendar.no_dates')}</div>;

  const headMonth = view === 'month' ? currentMonth.month : weekData.weekStart.month;
  const headYear  = view === 'month' ? currentMonth.year  : weekData.weekStart.year;

  return (
    <Col gap="g7" className="ncal ov-anim--cal">
      {/* ── Header — календарный паттерн: стрелки по бокам месяца, «Сегодня»
          рядом; справа — переключатель вида и «К поездке». ── */}
      <Row as="header" wrap>
        {/* Навигатор месяца: ‹ Август 2026 › */}
        <Row gap="g2" className="ncal-hd-nav">
          <IconBtn icon="chevL" tone="quiet" size="md" round ariaLabel={t('calendar.prev')} onClick={goBack} className="ncal-navbtn" />
          <Row as="h2" align="a-baseline" gap="g4" className="ncal-title-row">
            <span className="ncal-month-lbl t-title">{MONTH_NAMES[headMonth]}</span>
            {/* Год — ярус НИЖЕ месяца. В ветке 983 тут стоял `t-title`, но на
                экран он не попадал: `app.css` держал `.ncal-year-lbl` в
                ко-селекторе Subheading, и тот перебивал класс разметки — год
                рисовался мельче, чем написано. PR 972 эту перебивку снял, так
                что теперь класс исполняется буквально; ставим ЯВНО тот ярус,
                который и был на экране, вместо возврата молчаливой перебивки. */}
            <span className="ncal-year-lbl t-subheading">{headYear}</span>
          </Row>
          <IconBtn icon="chev" tone="quiet" size="md" round ariaLabel={t('calendar.next')} onClick={goFwd} className="ncal-navbtn" />
        </Row>

        {/* «Сегодня» — канон <Btn variant="secondary"> (не самодельная пилюля) */}
        {/* размера `md` у Btn нет — класса `.btn--md` не существует, и проп эмитил
            мёртвое имя; высоту держит сам `.btn` (--ctl-h), как у соседей шапки. */}
        <Btn variant="secondary" onClick={goToday} className="ncal-today">{t('calendar.today')}</Btn>

        {/* Переключатель вида — на всю ширину row2 на мобиле */}
        <Seg
          className="ncal-seg"
          ariaLabel={`${t('calendar.month')} / ${t('calendar.week')}`}
          value={view}
          onChange={setView}
          options={[{ value: 'month', label: t('calendar.month') }, { value: 'week', label: t('calendar.week') }]}
        />

        <Btn variant="soft" icon="pin" onClick={goHome} className="ncal-trip" ariaLabel={t('calendar.to_trip_start')}>
          <span className="ncal-trip-lbl">{t('calendar.to_trip_start')}</span>
        </Btn>
      </Row>

      {/* ── Тело: календарь + правый виджет городов (на мобиле — под ним) ── */}
      <div className="ncal-body">
        <Col className="ncal-main">
          {view === 'month'
            ? <MonthView cells={monthData.cells} weekdays={WD_NAMES} onOpenEvent={onOpenEvent} onOpenCity={onOpenCity} t={t} />
            : <WeekGrid days={weekData.days} hours={weekData.hours} lines={weekData.lines} gridH={weekData.gridH} startHour={weekData.startHour} hasAllDay={weekData.hasAllDay} scrollToHour={weekData.scrollToHour} weekKey={weekData.weekKey} onOpenEvent={onOpenEvent} onOpenCity={onOpenCity} t={t} />}
        </Col>
        <CitiesAside cities={tripMeta?.cities || []} onOpenCity={onOpenCity} t={t} />
      </div>
    </Col>
  );
}
