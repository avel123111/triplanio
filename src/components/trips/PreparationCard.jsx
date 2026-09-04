// @ts-check
import React, { useMemo, useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn, ListRow, Skeleton, Tile, Tooltip, Row, Col } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { buildPreparation } from '@/lib/trip-preparation';
import { primaryIssues, validateTrip } from '@/lib/validation';
import { transferKind } from '@/lib/transport';
import { formatDateRange } from '@/lib/trip-dates';
import { formatNaive, naiveDayKey } from '@/lib/naive-time';

// Виджет «Подготовка» — сколько из ТОГО, ЧТО ТРЕБУЕТ МАРШРУТ, уже забронировано,
// и одним списком: что забронировано, что нет.
//
// ★ ДОЛЯ ГОТОВНОСТИ ЖИВЁТ НЕ ЗДЕСЬ. Одно число «насколько готово» печатает блок
// состояния поездки наверху экрана; у виджета своей полосы нет — иначе одна и та
// же доля стояла бы на экране дважды. Виджет отвечает на другой вопрос: не
// «сколько», а «что именно осталось».
//
// ★ ЗНАМЕНАТЕЛЬ СЧИТАЕТ МАРШРУТ, А НЕ БРОНИ — правило и его следствие
// («отмершая бронь не учитывается») живут в `lib/trip-preparation.js`, здесь
// только показ. Те же предикаты питают варнинги ленты, поэтому «нет отеля» в
// ленте и «не забронировано» здесь не могут разъехаться.
//
// ★ ЗАМЕЧАНИЯ К БРОНЯМ БЕРУТСЯ У ЕДИНОГО ДВИЖКА (`validateTrip` +
// `primaryIssues`) — того же, что рисует конфликты в редакторе маршрута. Своей
// проверки дат у виджета нет и быть не должно: это был бы второй источник
// правды о том, что с бронью не так.
//
// ★ ЕСТЬ И НЕТ — РАЗНЫЕ ПО ФОРМЕ, А НЕ ПО ЗАЛИВКЕ. Забронированное — плотная
// карточка (`raised`) с цветной плиткой вида события; незабронированное — тихая
// компактная строка (`compact`) с серой плиткой вдвое меньше. До этого оба были
// одной коробкой, отличаясь только пунктиром рамки, и на живом трипе список
// читался однородной серой стеной, где Рим ничем не отличался от Флоренции.
// Побочно это вдвое режет высоту незабронированных рядов, которых на длинном
// маршруте большинство. Значок — `<Tile>` в тоне
// события, полоса — `<Meter>`, замечание — `.wrn` + `<Tooltip>`. Своих имён у
// виджета ровно два, и оба про одно: `.prep` (карточка объявляет себя единицей
// измерения ширины) и `.prep-cols` (две колонки секций, когда ширины хватает).

// Тон ховера add-строки (канал `--a` у `.lrow--add`) — ОБЪЯВЛЕННЫМИ объектами, а
// не литералами в JSX: значение приходит из роли события, классом его не
// выразить, а литерал в разметке — ровно тот инлайн, который считает гард 2l.
const ADD_TONE_STAY = { '--a': 'var(--ev-hotel-ink)' };
const ADD_TONE_LEG = { '--a': 'var(--ev-transfer-ink)' };

// Дата события — ВСЕГДА дневным ключом (`YYYY-MM-DD`). Наивное «дата+время»,
// прогнанное через форматтер без зоны, читается как локальное и печатается в
// UTC — то есть у половины планеты съезжает на сутки. Дневной ключ этой ветки
// не касается по построению (см. `dayMonth`: `SHORT_DATE_ONLY`).
function day1(fmt, iso) {
  return iso ? fmt(naiveDayKey(iso)) : '';
}

function dayRange(fmt, from, to) {
  return formatDateRange(naiveDayKey(from), naiveDayKey(to), fmt);
}

/**
 * Трейл строки брони: замечание (если есть) + шеврон.
 *
 * ★ ЗАМЕЧАНИЕ СТОИТ В `trail`, А НЕ В `trailSub` — И ЭТО НЕ КОСМЕТИКА.
 * `trailSub` — объявленная ВТОРОСТЕПЕННАЯ половина трейла: примитив прячет её
 * на ≤600px. Предупреждение о броне на телефоне пропадать не имеет права —
 * именно телефон и есть тот экран, где эту бронь смотрят в дороге.
 */
function Trail({ issue }) {
  return (
    <>
      {issue && (
        <Tooltip content={issue}>
          <span className="wrn" aria-label={issue}><Icon name="warning" size={13} /></span>
        </Tooltip>
      )}
      <Icon name="chev" size={16} className="chev" />
    </>
  );
}

// Сколько рядов показывает свёрнутая секция.
//
// ★★ ПОЧЕМУ ЭТО ЕСТЬ. Виджет проектировался на трёх городах, а на живом трипе из
// восьми даёт 11 ночлегов и 12 переездов — 23 одинаковых ряда, из которых 21
// пустой плейсхолдер. Это не список, это стена: то, что надо сделать, тонет в
// том, что уже сделано, и наоборот. Список без потолка растёт линейно по длине
// маршрута, то есть чем крупнее поездка, тем бесполезнее виджет.
const CAP = 5;

/**
 * Секция подготовки: заголовок со счётом, ряды и свёртка.
 *
 * ★ СВЁРНУТАЯ СЕКЦИЯ ПОКАЗЫВАЕТ РАБОТУ, А НЕ НАЧАЛО СПИСКА. Пока есть
 * незабронированное — видно именно его (в порядке маршрута); всё забронировано —
 * видно первые ряды. Иначе на длинном трипе в потолок попадали бы первые пять
 * городов, которые чаще всего уже закрыты, и виджет показывал бы «всё хорошо»
 * ровно там, где работы больше всего.
 *
 * Развёрнутая секция показывает ВСЁ и в порядке маршрута — забронированное тоже
 * кликается, оно не спрятано, а убрано на один тап.
 */
function Section({ label, rows, done, total, t }) {
  const [expanded, setExpanded] = useState(false);
  const pending = rows.filter((r) => !r.booked);
  const shown = expanded ? rows : (pending.length ? pending : rows).slice(0, CAP);
  const hidden = rows.length - shown.length;
  return (
    <Col gap="g4">
      <Row justify="j-between" align="a-baseline">
        <span className="t-meta muted">{label}</span>
        <span className="t-meta muted num">{done}/{total}</span>
      </Row>
      {shown.map((r) => r.node)}
      {(hidden > 0 || expanded) && (
        <Row>
          <Btn variant="link" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('overview.prep_less') : t('overview.prep_more', { count: hidden })}
          </Btn>
        </Row>
      )}
    </Col>
  );
}

export default function PreparationCard({
  visits = [],
  hotels = [],
  transfers = [],
  isLoading = false,
  onAddHotel,
  onAddTransfer,
  onOpenEvent,
}) {
  const { t, fmtDate } = useI18nFormat();

  const prep = useMemo(
    () => buildPreparation({ visits, hotels, transfers }),
    [visits, hotels, transfers],
  );

  // Замечание на КОНКРЕТНОЙ броне: `primaryIssues` уже схлопывает пачку до одной
  // претензии на сущность, поэтому карта id → текст однозначна.
  const issueByEntity = useMemo(() => {
    const map = new Map();
    if (isLoading) return map;
    for (const i of primaryIssues(validateTrip({ visits, hotels, transfers }))) {
      if (i.entityId != null && !map.has(i.entityId)) {
        map.set(i.entityId, t(`validation.${i.code}`, i.values));
      }
    }
    return map;
  }, [visits, hotels, transfers, isLoading, t]);

  if (isLoading) return <PreparationSkeleton />;

  const { stays, legs, total } = prep;

  const stayRows = stays.flatMap((s) =>
    s.booked
      ? s.bookings.map((h) => ({ key: `h-${h.id}`, booked: true, node: (
        <ListRow
          key={`h-${h.id}`}
          variant="raised"
          lead={<Tile tone="hotel" icon="bed" />}
          title={h.name}
          sub={[s.visit.city_name, dayRange(fmtDate, h.check_in_datetime, h.check_out_datetime)]
            .filter(Boolean).join(' · ')}
          trail={<Trail issue={issueByEntity.get(h.id)} />}
          onClick={() => onOpenEvent?.({ kind: 'hotel', id: h.id })}
        />
      ) }))
      : [{ key: s.key, booked: false, node: (
        <ListRow
          key={s.key}
          variant="compact"
          lead={<Tile tone="quiet" size="sm" icon="bed" />}
          title={s.visit.city_name}
          sub={[dayRange(fmtDate, s.visit.start_date, s.visit.end_date),
            `${s.nights} ${nightsWord(t, s.nights)}`].filter(Boolean).join(' · ')}
          trail={<Icon name="plus" size={16} />}
          style={ADD_TONE_STAY}
          onClick={() => onAddHotel?.(s.visit)}
        />
      ) }],
  );

  const legRows = legs.flatMap((l) => {
    const pair = `${l.from.city_name} → ${l.to.city_name}`;
    return l.booked
      ? l.bookings.map((tr) => {
        const kind = transferKind(tr.transport_type);
        const day = day1(fmtDate, tr.start_datetime || l.from.end_date);
        const time = tr.start_datetime ? formatNaive(tr.start_datetime, 'HH:mm') : '';
        return { key: `t-${tr.id}`, booked: true, node: (
          <ListRow
            key={`t-${tr.id}`}
            variant="raised"
            lead={<Tile tone="transfer" icon={kind.icon} />}
            title={pair}
            sub={[day, time, t(kind.labelKey)].filter(Boolean).join(' · ')}
            trail={<Trail issue={issueByEntity.get(tr.id)} />}
            onClick={() => onOpenEvent?.({ kind: 'transfer', id: tr.id })}
          />
        ) };
      })
      : [{ key: l.key, booked: false, node: (
        <ListRow
          key={l.key}
          variant="compact"
          lead={<Tile tone="quiet" size="sm" icon="route" />}
          title={pair}
          sub={day1(fmtDate, l.from.end_date) || undefined}
          trail={<Icon name="plus" size={16} />}
          style={ADD_TONE_LEG}
          onClick={() => onAddTransfer?.(l.from, l.to)}
        />
      ) }];
  });

  return (
    <section className="ovsec prep">
      {/* ★ ПЕРЕХОДА В МАРШРУТ ЗДЕСЬ НЕТ, И ЭТО НЕ ПОТЕРЯ. Он ведёт ровно туда же,
          куда «Открыть» в кадре поездки прямо над этой секцией, — то есть был
          вторым входом в одну линзу на одном экране. Плюс на полосе во всю
          ширину такая кнопка висит в тысяче пикселей от заголовка, одна в
          пустоте: элемент, которому нечего делать, но который нужно чем-то
          уравновесить. Строки списка ведут каждая в своё, и этого достаточно. */}
      <div className="ovsec__h">
        <h3 className="t-heading">{t('overview.prep_title')}</h3>
      </div>

      <div>
        {total === 0 ? (
          <div className="muted ov-empty-line">{t('overview.prep_empty')}</div>
        ) : (
          <>
            {/* Своей полосы готовности у виджета НЕТ: доля печатается ОДИН раз,
                в блоке состояния поездки наверху экрана. Здесь — другой вопрос:
                не «сколько», а «что именно осталось». */}
            <div className="prep-cols">
              {stays.length > 0 && (
                <Section
                  t={t}
                  label={t('overview.prep_stays')}
                  rows={stayRows}
                  done={stays.filter((s) => s.booked).length}
                  total={stays.length}
                />
              )}
              {legs.length > 0 && (
                <Section
                  t={t}
                  label={t('overview.prep_legs')}
                  rows={legRows}
                  done={legs.filter((l) => l.booked).length}
                  total={legs.length}
                />
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// Та же тернарная плюрализация ночей, что у ленты/FlowMap/ManualPlanner.
function nightsWord(t, n) {
  if (n === 1) return t('view.nights_one');
  return n < 5 ? t('view.nights_few') : t('view.nights_many');
}

// Скелетон повторяет геометрию виджета: шапка → две колонки строк, у каждой своя
// подпись секции. Строки счёта и полосы готовности здесь нет ровно потому, что их
// нет и в живом виджете: доля печатается один раз, в панели состояния поездки.
// Один источник для обеих фаз загрузки, как у Обзора в целом.
export function PreparationSkeleton() {
  return (
    <section className="ovsec prep" aria-busy="true">
      <div className="ovsec__h"><Skeleton w={180} h={20} r={6} /></div>
      <Col gap="g4">
        <div className="prep-cols">
          {[0, 1].map((c) => (
            <Col gap="g4" key={c}>
              <Skeleton w="40%" h={11} r={5} />
              <Skeleton w="100%" h={52} r="var(--r-btn)" />
              <Skeleton w="100%" h={52} r="var(--r-btn)" />
            </Col>
          ))}
        </div>
      </Col>
    </section>
  );
}
