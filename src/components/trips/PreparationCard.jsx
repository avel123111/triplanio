// @ts-check
import React, { useMemo, useState } from 'react';
import { Icon } from '@/design/icons';
import { AddRow, Btn, Card, CardHeader, IconBtn, ListRow, Meter, Skeleton, Tile, Tooltip, Row, Col } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { buildPreparation } from '@/lib/trip-preparation';
import { primaryIssues, validateTrip } from '@/lib/validation';
import { transferKind } from '@/lib/transport';
import { formatDateRange } from '@/lib/trip-dates';
import { formatNaive, naiveDayKey } from '@/lib/naive-time';

// Виджет «Подготовка» — сколько из ТОГО, ЧТО ТРЕБУЕТ МАРШРУТ, уже забронировано,
// и одним списком: что забронировано, что нет.
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
// ★★ ФОРМЫ НЕ СВОИ. Отсутствие — примитив ДС `<AddRow>` (он же в панели города и
// в сервисах); наличие — `<ListRow variant="raised">` с плиткой в тоне события и
// шевроном. Вес работе даёт ПОРЯДОК (см. `Section`), а не размер плашки.

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


// Сколько рядов видно в свёрнутой секции. Одно число на обе колонки — иначе
// «Ещё N» у ночлегов и у переездов считались бы от разных потолков.
const CAP = 3;

/**
 * Секция подготовки: подпись со счётом, ряды и свёртка.
 *
 * ★ ПОРЯДОК: сначала то, чего НЕТ, потом то, что есть (внутри группы — порядок
 * маршрута): виджет отвечает на «что осталось», поэтому работа стоит первой.
 * ★ ВИДНО ПЕРВЫЕ `CAP` РЯДОВ ПО ЭТОМУ ПОРЯДКУ, независимо от статуса; остальное
 * — за «Ещё N». Потолок держит высоту секции постоянной: список длиной с
 * маршрут иначе растит экран без предела.
 */
function Section({ label = null, rows = [], done = 0, total = 0, isLoading = false }) {
  const { t } = useI18nFormat();
  const [expanded, setExpanded] = useState(false);
  const ordered = [...rows.filter((r) => !r.booked), ...rows.filter((r) => r.booked)];
  const shown = expanded ? ordered : ordered.slice(0, CAP);
  const hidden = ordered.length - shown.length;
  if (isLoading) return <SectionSkeleton />;
  return (
    <Col gap="g4">
      {/* ★ СЧЁТ СТОИТ У СВОЕЙ ПОДПИСИ. Разнесённые по краям колонки «Проживание»
          и «2/11» оказывались в четырёхстах пикселях друг от друга — на таком
          расстоянии число перестаёт читаться как счёт ЭТОЙ секции и висит само
          по себе, тем более что справа от него сразу начинается вторая колонка
          со своим числом у левого края. */}
      <Row align="a-baseline" gap="g3">
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

/**
 * Фаза загрузки секции. ★ СОБРАНА ИЗ ТЕХ ЖЕ ЭЛЕМЕНТОВ, что живая: подпись —
 * тот же `<Row align="a-baseline" gap="g3">`, ряд — тот же `<AddRow>` с
 * заглушками вместо заголовка и подписи, «Ещё» — та же `<Btn variant="link">`.
 * Прямоугольники «примерно такого размера» на их месте разъезжались с живой
 * раскладкой на десятки пикселей (ряд 64 против 66, подпись 12 против 18,
 * строка «Ещё» отсутствовала вовсе) — и это ровно то, что видно как прыжок
 * содержимого в момент, когда данные приехали.
 */
function SectionSkeleton() {
  return (
    <Col gap="g4">
      <Row align="a-baseline" gap="g3">
        <Skeleton w={70} h={18} r={5} />
        <Skeleton w={24} h={18} r={5} />
      </Row>
      {Array.from({ length: CAP }, (_, i) => (
        <AddRow key={i} icon="dot" title={<Skeleton w={140} h={18} r={5} />} sub={<Skeleton w={92} h={18} r={5} />} />
      ))}
      <Row><Btn variant="link" disabled><Skeleton w={47} h={18} r={5} /></Btn></Row>
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
  onOpenRoute,
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

  const { stays, legs, total, done } = prep;

  // ★ ФОРМА ОБЪЯВЛЕНА ОДИН РАЗ. Четыре ряда виджета (ночлег/переезд × есть/нет)
  // отличаются только СОДЕРЖИМЫМ; собранные четырьмя копиями `<ListRow>`, они
  // немедленно разъезжаются при первой же правке облика — это и произошло дважды.
  const doneRow = (id, tone, icon, title, sub, open) => ({
    key: `d-${id}`,
    booked: true,
    node: (
      <ListRow
        key={`d-${id}`}
        variant="raised"
        lead={<Tile tone={tone} icon={icon} />}
        title={title}
        sub={sub || undefined}
        trail={<Trail issue={issueByEntity.get(id)} />}
        onClick={open}
      />
    ),
  });
  // Тон ховера (`accent` → канал `--a`) — ТЕ ЖЕ значения, что в панели города
  // (`CityPanel`): у одного и того же ряда «добавить бронь» не может быть двух
  // разных акцентов на двух экранах.
  const todoRow = (key, accent, icon, title, sub, add) => ({
    key,
    booked: false,
    node: <AddRow key={key} icon={icon} accent={accent} title={title} sub={sub} onClick={add} />,
  });
  const dotted = (...parts) => parts.filter(Boolean).join(' · ');

  const stayRows = stays.flatMap((s) => (s.booked
    ? s.bookings.map((h) => doneRow(
      h.id, 'hotel', 'bed', h.name,
      dotted(s.visit.city_name, dayRange(fmtDate, h.check_in_datetime, h.check_out_datetime)),
      () => onOpenEvent?.({ kind: 'hotel', id: h.id }),
    ))
    : [todoRow(
      s.key, 'var(--ev-hotel)', 'bed', s.visit.city_name,
      dotted(dayRange(fmtDate, s.visit.start_date, s.visit.end_date), `${s.nights} ${nightsWord(t, s.nights)}`),
      () => onAddHotel?.(s.visit),
    )]));

  const legRows = legs.flatMap((l) => {
    const pair = `${l.from.city_name} → ${l.to.city_name}`;
    return l.booked
      ? l.bookings.map((tr) => {
        const kind = transferKind(tr.transport_type);
        return doneRow(
          tr.id, 'transfer', kind.icon, pair,
          dotted(
            day1(fmtDate, tr.start_datetime || l.from.end_date),
            tr.start_datetime ? formatNaive(tr.start_datetime, 'HH:mm') : '',
            t(kind.labelKey),
          ),
          () => onOpenEvent?.({ kind: 'transfer', id: tr.id }),
        );
      })
      : [todoRow(l.key, 'var(--ev-transfer)', 'route', pair, day1(fmtDate, l.from.end_date), () => onAddTransfer?.(l.from, l.to))];
  });

  return (
    <Card className="col col--g6 prep">
      <CardHeader
        title={t('overview.prep_title')}
        action={(
          <IconBtn
            icon="chev"
            tone="outline"
            size="sm"
            onClick={onOpenRoute}
            title={t('overview.prep_route')}
            ariaLabel={t('overview.prep_route')}
          />
        )}
      />

      <div>
        {total === 0 ? (
          <div className="muted ov-empty-line">{t('overview.prep_empty')}</div>
        ) : (
          <>
            {/* Полоса считает ровно то, что перечислено под ней. */}
            <div className="prep-head">
              <span className="t-support">{t('overview.prep_sub', { done, total })}</span>
              <span className="t-strong num">{Math.round((done / total) * 100)}%</span>
              <Meter
                ariaLabel={t('overview.prep_sub', { done, total })}
                segments={[
                  { key: 'done', value: done, color: done === total ? 'var(--success)' : 'var(--brand)' },
                  { key: 'rest', value: total - done, color: 'transparent' },
                ]}
              />
            </div>
            <div className="prep-cols">
              {stays.length > 0 && (
                <Section
                  label={t('overview.prep_stays')}
                  rows={stayRows}
                  done={stays.filter((s) => s.booked).length}
                  total={stays.length}
                />
              )}
              {legs.length > 0 && (
                <Section
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
    </Card>
  );
}

// Та же тернарная плюрализация ночей, что у ленты/FlowMap/ManualPlanner.
function nightsWord(t, n) {
  if (n === 1) return t('view.nights_one');
  return n < 5 ? t('view.nights_few') : t('view.nights_many');
}

// Скелетон = ТА ЖЕ карточка, та же шапка, та же строка готовности и те же две
// секции — только с заглушками вместо чисел и названий. Полоса-доля рисуется
// НАСТОЯЩИМ `<Meter>` без сегментов: пустая дорожка и есть её состояние
// «данных пока нет», и она сама занимает обе колонки строки готовности.
export function PreparationSkeleton() {
  const { t } = useI18nFormat();
  return (
    <Card className="col col--g6 prep" aria-busy="true">
      {/* Заголовок раздела — НАСТОЯЩИЙ: он известен до данных, и три соседние
          карточки в фазе загрузки показывают свой. Серая полоска на его месте
          делала «Подготовку» единственной безымянной карточкой на экране. */}
      <CardHeader title={t('overview.prep_title')} action={<Skeleton w={32} h={32} r="var(--r-btn)" />} />
      <div>
        <div className="prep-head">
          <Skeleton w={190} h={19} r={5} />
          <Skeleton w={35} h={23} r={6} />
          <Meter />
        </div>
        <div className="prep-cols">
          <Section isLoading />
          <Section isLoading />
        </div>
      </div>
    </Card>
  );
}
