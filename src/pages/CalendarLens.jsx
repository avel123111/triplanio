// @ts-check
/**
 * CalendarLens — календарь путешествия (ncal-*). Два вида, оба СЕТКИ.
 *
 * ★ ПОЧЕМУ НЕДЕЛЯ — СЕТКА ЧАСОВ, А НЕ СПИСОК. Список «день → события» в
 * продукте уже есть: это лента таймлайна. Второй такой же экран не добавляет
 * ничего, кроме имени в меню. Календарь отвечает на другой вопрос — «сколько
 * времени занято и что с чем стыкуется», — и ответ на него даёт только ось
 * времени: колонка на день, час по вертикали, блок высотой в длительность.
 * Модель данных к этому готова: `buildEventStream` кладёт `endTime` именно
 * «to size blocks by real duration instead of a fixed guess».
 *
 * ★ ГОРОД — МНОГОДНЕВНОЕ СОБЫТИЕ. Визит рисуется ОДНОЙ полосой поверх ряда
 * (месяц) или над сеткой часов (неделя), `grid-column` span, имя на полосе.
 * Прежняя редакция красила каждую ячейку непрозрачной плашкой, имя печатала
 * ЛИШЬ в первый день визита, на телефоне текст гасила (`font-size: 0`) — и
 * держала под сеткой ЛЕГЕНДУ, чтобы расшифровать оставшиеся цветные слэбы.
 * Легенда удалена как объект: имя едет с полосой в каждую неделю.
 *
 * ★ ЦВЕТ ГОРОДА — `--cat-*`, ЦВЕТ СОБЫТИЯ — `--ev-*`. Раньше города красились
 * теми же токенами, что и типы событий, и розовая плашка «Мадрид» стояла над
 * розовым чипом «активность»: два разных языка одним словарём.
 *
 * ★ ЯРУСОВ ЦВЕТА РОВНО ДВА. Полоса города — насыщенная (она одна на ряд),
 * событие — точка плюс текст. Заливки у события нет: тридцать пастельных
 * прямоугольников на экране читаются как шум, а не как список.
 *
 * Props:
 *   stream      - массив событий потока (buildEventStream)
 *   visits      - массив city_visits (отсортирован по start_date)
 *   isLoading   - boolean
 *   onOpenEvent - (streamEvent) => void
 */
import React, { useState, useMemo, useCallback, useRef, useLayoutEffect } from 'react';
import { Info, DateTime } from 'luxon';
import { Skeleton, IconBtn, Seg, Chip, Btn, Card, EmptyState, eventFamily } from '../design/index';
import { Row, Col, Grow, Trunc } from '../design/Layout';
import { parseNaive } from '@/lib/naive-time';
import { useI18n } from '@/lib/i18n/I18nContext';
import { localeTag } from '@/lib/i18n/translations';
import './CalendarLens.css';

// Дни недели пн→вс — тот же порядок, что у сетки (luxon: 1 = понедельник).
const weekdayNames = (lang) => Info.weekdays('short', { locale: localeTag(lang) });

// ── Цвет города ──────────────────────────────────────────────────────────────
// Палитра категорий из `:root` (ею живут категории бюджета). Восьмой тон —
// служебный серый «прочее», городом он не бывает: берём первые семь.
const CITY_TONES = 7;
const cityTone = (idx) => `var(--cat-${(idx % CITY_TONES) + 1})`;

// Классификатор семейства — общий с таймлайном (design/index.jsx). Своей копии
// словаря типов тут нет: она разъезжалась с потоком (ключ `car` вместо
// car-pickup/car-return → аренда рендерилась без цвета).
const evCls = (type) => `ev-${eventFamily(type)}`;

/** Ключ дня `yyyy-LL-dd` — формат, в котором `buildEventStream` кладёт `e.date`. */
const key = (dt) => dt.toFormat('yyyy-LL-dd');

/** «HH:mm» → минуты от полуночи; null, если времени нет. */
const minutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? +m[1] * 60 + +m[2] : null;
};

const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99');

// ─── Полосы города ───────────────────────────────────────────────────────────
// Отрезки визитов, пересечённые с окном из семи дней, в колонках сетки.

/**
 * Дорожки — страховка, а не основной ход. После подрезки (`cityAt.rail`)
 * полосы соседних визитов не пересекаются и дорожка одна; дорожки нужны на
 * КРИВЫХ данных, где визиты налезают друг на друга не пограничным днём.
 */
function packLanes(segs) {
  /** @type {number[]} */
  const lastCol = [];
  return segs.map((s) => {
    let lane = 0;
    while (lane < lastCol.length && lastCol[lane] >= s.col) lane++;
    lastCol[lane] = s.col + s.span - 1;
    return { ...s, lane };
  });
}

/** Отрезки визитов, пересечённые с окном из семи дней, в колонках сетки. */
function railSegs(cities, days) {
  const ws = days[0], we = days[6];
  const segs = [];
  for (const c of cities) {
    if (c.e < ws || c.s > we) continue;
    const from = c.s < ws ? 0 : Math.round(c.s.diff(ws, 'days').days);
    const to   = c.e > we ? 6 : Math.round(c.e.diff(ws, 'days').days);
    segs.push({ ...c, col: from + 1, span: to - from + 1, openStart: c.s < ws, openEnd: c.e > we });
  }
  return packLanes(segs.sort((a, b) => a.col - b.col || a.idx - b.idx));
}

function CityRail({ segs }) {
  if (!segs.length) return null;
  const lanes = Math.max(...segs.map((s) => s.lane)) + 1;
  return (
    // aria-hidden: имя города уже едет в подпись ячейки/колонки дня, а полоса —
    // вторая, ГРАФИЧЕСКАЯ подача того же факта.
    <div className="ncal-rail" style={{ '--lanes': lanes }} aria-hidden="true">
      {segs.map((s) => (
        <span
          key={s.idx}
          className={`ncal-rail__seg t-meta${s.openStart ? ' is-cont' : ''}${s.openEnd ? ' is-goes' : ''}`}
          style={{ '--c': cityTone(s.tone), gridColumn: `${s.col} / span ${s.span}`, gridRow: s.lane + 1 }}
        >
          {s.name}
        </span>
      ))}
    </div>
  );
}

// ─── Месяц ───────────────────────────────────────────────────────────────────

function MonthView({ weeks, month, eventsByKey, cityAt, todayKey, onOpenEvent, onOpenDay, lang }) {
  const { t } = useI18n();
  const WD = weekdayNames(lang);
  const loc = localeTag(lang);
  const [open, setOpen] = useState(() => new Set());

  const toggle = useCallback((k) => {
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  }, []);

  return (
    // Ролей `grid`/`row`/`gridcell` тут нет намеренно: прежняя разметка носила
    // их БЕЗ `role="grid"` над ними, то есть объявление было заведомо ложным, а
    // честное `role="grid"` — обещание навигации стрелками, которой здесь нет.
    // Скринридер получает всё из подписи кнопки дня и подписей событий.
    <Card pad="none" radius="card" className="ncal-sheet">
      <div className="ncal-wdrow" aria-hidden="true">
        {WD.map((w) => <span key={w} className="ncal-wd t-micro">{w}</span>)}
      </div>

      {weeks.map((week, wi) => (
        <div key={wi} className="ncal-wk">
          <CityRail segs={railSegs(cityAt.rail, week)} />

          <div className="ncal-days">
            {week.map((d) => {
              const k      = key(d);
              const out    = d.month !== month;
              const ev     = eventsByKey[k] || [];
              const cities = cityAt.on(d);
              const isOpen = open.has(k);
              const shown  = isOpen ? ev : ev.slice(0, 3);

              return (
                <div
                  key={k}
                  className={`ncal-dc${out ? ' is-out' : ''}${cities.length ? '' : ' is-off'}${k === todayKey ? ' is-today' : ''}`}
                >
                  {/* Номер дня — настоящая кнопка: открывает день в сетке недели.
                      На телефоне её ::after растягивается на всю ячейку (точки
                      клик не перехватывают), поэтому цель нажатия — весь день. */}
                  <button
                    type="button"
                    className="ncal-dn t-label t-flush"
                    onClick={() => onOpenDay(d)}
                    aria-label={[d.setLocale(loc).toFormat('cccc, d MMMM yyyy'), ...cities.map((c) => c.name)].join(', ')}
                  >
                    {d.day}
                  </button>

                  {ev.length > 0 && (
                    <div className="ncal-evl">
                      {shown.map((e, ei) => (
                        <button
                          key={ei}
                          type="button"
                          className={`ncal-ev ${evCls(e.type)}`}
                          onClick={() => onOpenEvent?.(e)}
                          aria-label={`${e.time ? e.time + ' ' : ''}${e.title}`}
                        >
                          <span className="ncal-ev__dot" />
                          {e.time && <span className="ncal-ev__tm t-meta">{e.time}</span>}
                          <Trunc as="span" className="ncal-ev__n t-meta">{e.title}</Trunc>
                        </button>
                      ))}
                      {ev.length > 3 && (
                        <Chip sm square className="ncal-more" onClick={() => toggle(k)}>
                          {isOpen ? '−' : `+${ev.length - 3} ${t('calendar.more_count')}`}
                        </Chip>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </Card>
  );
}

// ─── Неделя: сетка часов ─────────────────────────────────────────────────────

/** Точечное событие (заезд, дедлайн, выдача авто) без своей длительности. */
const POINT_MIN = 50;
/** Окно суток, которое сетка показывает всегда, даже если событий в нём нет. */
const DAY_FROM = 8, DAY_TO = 22;

/**
 * Раскладка пересекающихся блоков в колонке. События сортируются по началу,
 * копится КЛАСТЕР (пока следующий начинается раньше, чем кончился самый поздний
 * из накопленных), внутри кластера каждый садится в первую свободную дорожку.
 * Без этого два события на 10:00 рисуются одно поверх другого, и второго просто
 * нет на экране.
 *
 * ★ ДОРОЖКИ ДЕЛЯТ КОЛОНКУ ПОРОВНУ, А НЕ НАЕЗЖАЮТ ДРУГ НА ДРУГА. Смещение со
 * взаимным перекрытием (приём Notion Calendar) даёт верхнему блоку полную
 * ширину, но КЛАДЁТ ЕГО ПОВЕРХ ЧУЖОГО ТЕКСТА: у трёх пересекающихся событий на
 * экране остаётся одно читаемое название и два огрызка под ним. Равные доли
 * при трёх событиях тоже режут названия, но каждое остаётся в своей коробке и
 * ни одно не пропадает — а три одновременных события в поездке это край, не
 * норма. Так же поступает Google Calendar.
 */
function layoutDay(items) {
  const out = [];
  let cluster = [], lanes = [], clusterEnd = -1;

  const flush = () => {
    const n = lanes.length;
    cluster.forEach((it) => out.push({ ...it, left: (it.lane / n) * 100, width: 100 / n }));
    cluster = []; lanes = []; clusterEnd = -1;
  };

  for (const it of items) {
    if (it.from >= clusterEnd) flush();
    let lane = 0;
    while (lane < lanes.length && lanes[lane] > it.from) lane++;
    lanes[lane] = it.to;
    cluster.push({ ...it, lane });
    clusterEnd = Math.max(clusterEnd, it.to);
  }
  flush();
  return out;
}

function WeekGrid({ days, eventsByKey, cityAt, todayKey, onOpenEvent, lang }) {
  const { t } = useI18n();
  const WD = weekdayNames(lang);

  // Окно часов: базовое 8–22, расширенное ровно настолько, чтобы вместить самое
  // раннее и самое позднее событие недели. Фиксированные 0–24 дали бы две трети
  // пустой сетки, а «только по событиям» — прыгающую шкалу.
  const { from, to, cols } = useMemo(() => {
    let lo = DAY_FROM * 60, hi = DAY_TO * 60;
    const perDay = days.map((d) => {
      const items = [];
      for (const e of eventsByKey[key(d)] || []) {
        const s = minutes(e.time);
        if (s === null) continue;                       // без времени — в верхнюю полосу
        const en = minutes(e.endTime);
        const end = en !== null && en > s ? en : s + POINT_MIN;
        lo = Math.min(lo, s);
        hi = Math.max(hi, end);
        items.push({ e, from: s, to: end });
      }
      return items.sort((a, b) => a.from - b.from || a.to - b.to);
    });
    return {
      from: Math.max(0, Math.floor(lo / 60)),
      to: Math.min(24, Math.ceil(hi / 60)),
      cols: perDay.map(layoutDay),
    };
  }, [days, eventsByKey]);

  const span  = (to - from) * 60;
  const hours = Array.from({ length: to - from }, (_, i) => from + i);
  /** Момент суток → доля окна сверху. */
  const at = (min) => `${((min - from * 60) / span) * 100}%`;
  /** Длительность → доля окна по высоте (минус волосок, чтобы блоки не слипались). */
  const tall = (dur) => `calc(${(dur / span) * 100}% - 2px)`;

  // События без времени (переезд без start_datetime) — в полосу над сеткой: на
  // оси времени им места нет, а терять их нельзя.
  const untimed = days.map((d) => (eventsByKey[key(d)] || []).filter((e) => minutes(e.time) === null));
  const hasUntimed = untimed.some((a) => a.length);

  // Линия «сейчас». Считается на рендере, без таймера: минутная точность
  // календарю не нужна, а интервал ради неё пришлось бы убирать за собой.
  const now = DateTime.now();
  const nowMin = now.hour * 60 + now.minute;
  // Обе границы через `>=` НАМЕРЕННО: пара `>` … `<` в одной строке .jsx
  // читается сканером гарда 2d как JSX-текст, и он требует завернуть кусок
  // выражения в t(). Смысл тот же, ложного срабатывания нет.
  const showNow = nowMin >= from * 60 && to * 60 >= nowMin;

  // Когда семь дней не влезают в кадр (телефон), холст открывается НЕ на
  // понедельнике, а на первом дне, где что-то есть: иначе неделя поездки,
  // начавшейся в четверг, встречает пустой сеткой и требует листать вслепую.
  const pane = useRef(/** @type {any} */ (null));
  const weekKey = key(days[0]);
  const focus = useMemo(() => {
    const t = days.findIndex((d) => key(d) === todayKey);
    if (t >= 0) return t;
    const e = days.findIndex((d) => (eventsByKey[key(d)] || []).length);
    return e >= 0 ? e : 0;
  }, [days, eventsByKey, todayKey]);

  useLayoutEffect(() => {
    const el = pane.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const col = el.querySelectorAll('.ncal-tg__col')[focus];
    const gut = el.querySelector('.ncal-tg__hours');
    if (col && gut) el.scrollLeft = col.offsetLeft - gut.offsetWidth;
  }, [focus, weekKey]);

  return (
    <Card pad="none" radius="card" className="ncal-sheet ncal-tg">
      {/* ОДИН прокручиваемый холст на все три ряда — шапку дней, полосу «весь
          день» и сетку часов. Три отдельных скролла не синхронизировать: колонки
          разъезжаются с заголовками на первом же сдвиге. Жёлоб часов приколот
          слева (`sticky`), шапка — сверху, поэтому на телефоне колонка может
          быть шириной в читаемое название, а не в 46px, и неделя листается вбок,
          оставаясь СЕТКОЙ. */}
      <div className="ncal-tg__pane" ref={pane}>
        <div className="ncal-tg__corner" />
        {days.map((d, i) => {
          const k = key(d);
          return (
            <div key={`h${k}`} className={`ncal-tg__d${cityAt.on(d).length ? '' : ' is-out'}${k === todayKey ? ' is-today' : ''}`}>
              <span className="ncal-tg__wd t-micro">{WD[i]}</span>
              <span className="ncal-tg__num t-heading t-flush">{d.day}</span>
            </div>
          );
        })}

        <div className="ncal-tg__bandgut" />
        <div className="ncal-tg__band">
          <CityRail segs={railSegs(cityAt.rail, days)} />
          {hasUntimed && (
            <div className="ncal-tg__allday">
              {untimed.map((list, i) => (
                <div key={i} className="ncal-tg__adcell">
                  {list.map((e, ei) => (
                    <button
                      key={ei}
                      type="button"
                      className={`ncal-tb ncal-tb--flat ${evCls(e.type)}`}
                      onClick={() => onOpenEvent?.(e)}
                      aria-label={e.title}
                    >
                      <span className="ncal-tb__n t-meta">{e.title}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="ncal-tg__hours" style={{ '--rows': hours.length }}>
          {hours.map((h) => (
            <span key={h} className="ncal-tg__h t-micro">{String(h).padStart(2, '0')}</span>
          ))}
        </div>

        {days.map((d, di) => {
          const k = key(d);
          const isToday = k === todayKey;
          return (
            <div
              key={`c${k}`}
              className={`ncal-tg__col${cityAt.on(d).length ? '' : ' is-out'}${isToday ? ' is-today' : ''}`}
              style={{ '--rows': hours.length }}
            >
              {isToday && showNow && <span className="ncal-tg__now" aria-hidden="true" style={{ top: at(nowMin) }} />}

              {cols[di].map((it, i) => (
                <button
                  key={i}
                  type="button"
                  className={`ncal-tb ${evCls(it.e.type)}${it.to - it.from <= POINT_MIN ? ' is-tiny' : ''}`}
                  onClick={() => onOpenEvent?.(it.e)}
                  aria-label={`${it.e.time} ${it.e.title}`}
                  style={{
                    top: at(it.from),
                    height: tall(it.to - it.from),
                    left: `${it.left}%`,
                    width: `calc(${it.width}% - 3px)`,
                    zIndex: Math.min(3, it.lane + 1),
                  }}
                >
                  <span className="ncal-tb__tm t-micro">{it.e.time}</span>
                  <span className="ncal-tb__n t-meta">{it.e.title}</span>
                </button>
              ))}

              {!cols[di].length && !untimed[di].length && cityAt.on(d).length > 0 && (
                <span className="ncal-tg__free t-meta">{t('calendar.free_day')}</span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── CalendarLens ────────────────────────────────────────────────────────────

// Скелетон — PURE: панель управления + большое поле сетки. TRIP-337.
function CalendarSkeleton() {
  return (
    <Col gap="g6" className="ov-anim" aria-busy="true">
      <Row gap="g4">
        <Skeleton w={210} h={34} r={'var(--r-sm)'} />
        <Grow />
        <Skeleton w={230} h={34} r={'var(--r-btn)'} />
      </Row>
      <Skeleton w="100%" h={520} r={'var(--r-card)'} />
    </Col>
  );
}

export default function CalendarLens({ stream, visits, isLoading, onOpenEvent }) {
  const { t, lang } = useI18n();
  const loc = localeTag(lang);

  const [view,        setView]        = useState('month');
  const [monthOffset, setMonthOffset] = useState(0);
  const [weekOffset,  setWeekOffset]  = useState(0);

  const today    = DateTime.now();
  const todayKey = key(today);

  const firstDated = visits.find((v) => v.start_date);
  const baseDate   = firstDated ? parseNaive(firstDated.start_date)?.startOf('day') : null;

  // ── Города ────────────────────────────────────────────────────────────────
  // Тон закреплён за ИМЕНЕМ, а не за индексом визита: вернувшись в тот же город
  // второй раз, ты видишь тот же цвет. Якоря start/end — не города.
  const cityAt = useMemo(() => {
    const tones = new Map();
    const all = [];
    visits.forEach((v, idx) => {
      if (v.kind === 'start' || v.kind === 'end') return;
      const s = parseNaive(v.start_date)?.startOf('day');
      const e = parseNaive(v.end_date)?.startOf('day');
      if (!s || !e) return;
      const name = v.city_name || '—';
      if (!tones.has(name)) tones.set(name, tones.size);
      all.push({ idx, name, s, e, tone: tones.get(name) });
    });
    const chron = all.sort((a, b) => a.s - b.s || a.idx - b.idx);
    // ПОГРАНИЧНЫЙ ДЕНЬ. Соседние визиты делят день переезда: 7-го ты и выезжаешь
    // из Барселоны, и заезжаешь в Валенсию, поэтому на вопрос «где я» отвечают
    // ОБА (`on`). Полоса отвечает на другой — «где ночь», — и ответ у него ОДИН:
    // город прибытия. Отсюда подрезка, и ряд остаётся однодорожечным.
    const rail = chron.map((c, i) => {
      const next = chron[i + 1];
      let e = c.e;
      if (next && next.s <= e) e = next.s.minus({ days: 1 });
      return { ...c, e: e < c.s ? c.s : e };
    });
    return { rail, on: (d) => chron.filter((c) => d >= c.s && d <= c.e) };
  }, [visits]);

  // ── События по дню ────────────────────────────────────────────────────────
  const eventsByKey = useMemo(() => {
    /** @type {Record<string, any[]>} */
    const map = {};
    for (const e of stream) {
      if (!e.date) continue;
      (map[e.date] ||= []).push(e);
    }
    for (const k of Object.keys(map)) map[k].sort(byTime);
    return map;
  }, [stream]);

  // ── Периоды ───────────────────────────────────────────────────────────────
  const currentMonth = baseDate ? baseDate.plus({ months: monthOffset }).startOf('month') : null;

  const monthWeeks = useMemo(() => {
    if (!currentMonth) return [];
    const gridStart = currentMonth.minus({ days: currentMonth.weekday - 1 }); // luxon: 1 = пн
    const cells     = Math.ceil((currentMonth.weekday - 1 + currentMonth.daysInMonth) / 7) * 7;
    return Array.from({ length: cells / 7 }, (_, w) =>
      Array.from({ length: 7 }, (_, i) => gridStart.plus({ days: w * 7 + i })));
  }, [currentMonth]);

  const weekStart = baseDate ? baseDate.startOf('week').plus({ weeks: weekOffset }) : null;
  const weekDays  = useMemo(
    () => (weekStart ? Array.from({ length: 7 }, (_, i) => weekStart.plus({ days: i })) : []),
    [weekStart],
  );

  // ── Навигация ─────────────────────────────────────────────────────────────
  const isMonth = view === 'month';
  const step    = (n) => (isMonth ? setMonthOffset((o) => o + n) : setWeekOffset((o) => o + n));
  const goHome  = () => { setMonthOffset(0); setWeekOffset(0); };
  const goToday = useCallback(() => {
    if (!baseDate) return;
    if (isMonth) setMonthOffset(today.startOf('month').diff(baseDate.startOf('month'), 'months').months);
    else setWeekOffset(Math.round(today.startOf('week').diff(baseDate.startOf('week'), 'weeks').weeks));
  }, [baseDate, isMonth, today]);

  // Месяц → неделя, содержащая этот день. На телефоне это единственный путь от
  // обзора к подробностям: чип события шириной 50px нечитаем.
  const openDay = useCallback((d) => {
    if (!baseDate) return;
    setWeekOffset(Math.round(d.startOf('week').diff(baseDate.startOf('week'), 'weeks').weeks));
    setView('week');
  }, [baseDate]);

  if (isLoading) return <CalendarSkeleton />;
  if (!baseDate) return <EmptyState icon="calendar" title={t('calendar.no_dates')} />;

  // Заголовок: месяц — «Сентябрь 2026»; неделя — «1 – 7 сентября 2026»
  // (через границу месяцев печатаются оба: «31 авг. – 6 сентября»).
  const wsL = weekStart.setLocale(loc);
  const weL = weekStart.plus({ days: 6 }).setLocale(loc);
  const periodTitle = isMonth
    ? currentMonth.setLocale(loc).toFormat('LLLL')
    : `${wsL.toFormat(wsL.month === weL.month ? 'd' : 'd MMM')} – ${weL.toFormat('d MMMM')}`;

  // Возвраты гаснут, когда никуда не ведут. Сравнение периодов — своими полями,
  // а не `hasSame`: у luxon нет `.d.ts`, и TS выводит третий аргумент
  // ОБЯЗАТЕЛЬНЫМ (та же ловушка, что была у `endOf` в прежней редакции файла).
  const atToday = isMonth
    ? currentMonth.year === today.year && currentMonth.month === today.month
    : key(weekStart) === key(today.startOf('week'));
  const atStart = isMonth ? monthOffset === 0 : weekOffset === 0;

  return (
    <Col gap="g7" className="ncal ov-anim--cal">
      <Row gap="g4" wrap justify="j-between" className="ncal-bar">
        <Row gap="g2" className="ncal-per">
          <IconBtn icon="chevL" tone="soft" size="sm" round ariaLabel={t('calendar.prev')} onClick={() => step(-1)} />
          <h2 className="ncal-per__t t-title">
            {periodTitle}
            <span className="ncal-per__y t-subheading">{isMonth ? currentMonth.year : weL.year}</span>
          </h2>
          <IconBtn icon="chev" tone="soft" size="sm" round ariaLabel={t('calendar.next')} onClick={() => step(1)} />
        </Row>

        <Row gap="g3" className="ncal-acts">
          <Btn variant="quiet" size="sm" onClick={goToday} disabled={atToday} className="ncal-jump">
            {t('calendar.today')}
          </Btn>
          {/* Возврат к трипу — иконкой: подпись «К старту путешествия» длиннее
              всей остальной панели, а сам ход вторичный. Строка — в подсказке. */}
          <IconBtn
            icon="pin" tone="soft" size="sm" round
            onClick={goHome} disabled={atStart}
            title={t('calendar.to_trip_start')} ariaLabel={t('calendar.to_trip_start')}
          />
          <Seg
            ariaLabel={`${t('calendar.month')} / ${t('calendar.week')}`}
            value={view}
            onChange={setView}
            className="ncal-seg"
            options={[
              { value: 'month', label: t('calendar.month') },
              { value: 'week', label: t('calendar.week') },
            ]}
          />
        </Row>
      </Row>

      {isMonth ? (
        <MonthView
          weeks={monthWeeks}
          month={currentMonth.month}
          eventsByKey={eventsByKey}
          cityAt={cityAt}
          todayKey={todayKey}
          onOpenEvent={onOpenEvent}
          onOpenDay={openDay}
          lang={lang}
        />
      ) : (
        <WeekGrid
          days={weekDays}
          eventsByKey={eventsByKey}
          cityAt={cityAt}
          todayKey={todayKey}
          onOpenEvent={onOpenEvent}
          lang={lang}
        />
      )}
    </Col>
  );
}
