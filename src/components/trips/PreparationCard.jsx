// @ts-check
import React, { useMemo, useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn, IconBtn, ListRow, Meter, Skeleton, Tile, Tooltip, Row, Col } from '@/design/index';
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
// ★★ ФОРМЫ НЕ СВОИ — КАНОН ИЗ `CityPanel`, ОДИН НА ПРОЕКТ. Отсутствие =
// `<ListRow variant="add">` с ПОЛНОЙ плиткой `tone="quiet"` и плюсом (встаёт ровно
// в высоту карточки наличия); наличие = `variant="raised"` с плиткой в тоне
// события и шевроном. Вес работе даёт ПОРЯДОК (см. `Section`), а не размер плашки.

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


/**
 * Секция подготовки: подпись со счётом, ряды и свёртка.
 *
 * ★★ СНАЧАЛА ТО, ЧЕГО НЕТ, ПОТОМ ТО, ЧТО ЕСТЬ (внутри группы — порядок маршрута):
 * виджет отвечает на «что осталось», поэтому работа стоит первой.
 * ★★ «ЕЩЁ N» ПРЯЧЕТ ЗАКРЫТОЕ, А НЕ РАБОТУ — тогда N значит одно и то же в обеих
 * колонках. Потолка по числу рядов нет: он давал «Ещё 1» и «Ещё 4» про разное.
 * Работы нет вовсе — показываем закрытое, иначе секция пуста.
 */
function Section({ label, rows, done, total, t }) {
  const [expanded, setExpanded] = useState(false);
  const pending = rows.filter((r) => !r.booked);
  const closed = rows.filter((r) => r.booked);
  const ordered = [...pending, ...closed];
  const shown = expanded || !pending.length ? ordered : pending;
  const hidden = ordered.length - shown.length;
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
  const todoRow = (key, accent, icon, title, sub, add) => ({
    key,
    booked: false,
    node: (
      <ListRow
        key={key}
        variant="add"
        lead={<Tile tone="quiet" icon={icon} />}
        title={title}
        sub={sub || undefined}
        trail={<Icon name="plus" size={16} />}
        style={accent}
        onClick={add}
      />
    ),
  });
  const dotted = (...parts) => parts.filter(Boolean).join(' · ');

  const stayRows = stays.flatMap((s) => (s.booked
    ? s.bookings.map((h) => doneRow(
      h.id, 'hotel', 'bed', h.name,
      dotted(s.visit.city_name, dayRange(fmtDate, h.check_in_datetime, h.check_out_datetime)),
      () => onOpenEvent?.({ kind: 'hotel', id: h.id }),
    ))
    : [todoRow(
      s.key, ADD_TONE_STAY, 'bed', s.visit.city_name,
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
      : [todoRow(l.key, ADD_TONE_LEG, 'route', pair, day1(fmtDate, l.from.end_date), () => onAddTransfer?.(l.from, l.to))];
  });

  return (
    <section className="ovsec prep">
      <div className="ovsec__h">
        <h3 className="t-heading">{t('overview.prep_title')}</h3>
        <IconBtn
          icon="chev"
          tone="outline"
          size="sm"
          onClick={onOpenRoute}
          title={t('overview.prep_route')}
          ariaLabel={t('overview.prep_route')}
        />
      </div>

      <div>
        {total === 0 ? (
          <div className="muted ov-empty-line">{t('overview.prep_empty')}</div>
        ) : (
          <>
            {/* Полоса считает ровно то, что перечислено под ней. */}
            <div className="prep-head">
              <span className="t-support">{t('overview.prep_sub', { done, total })}</span>
              <span className="prep-head__pct t-strong num">{Math.round((done / total) * 100)}%</span>
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
      {/* Геометрия один в один с живым виджетом: иначе содержимое прыгает. */}
      <div className="ovsec__h">
        <Skeleton w={180} h={20} r={6} />
        <Skeleton w={32} h={32} r="var(--r-btn)" />
      </div>
      <div className="prep-head">
        <Skeleton w={170} h={14} r={5} />
        <Skeleton w={38} h={14} r={5} />
        <Skeleton w="100%" h={11} r="var(--r-pill)" />
      </div>
      <div className="prep-cols">
        {[0, 1].map((c) => (
          <Col gap="g4" key={c}>
            <Skeleton w="35%" h={12} r={5} />
            {[0, 1, 2].map((r) => <Skeleton key={r} w="100%" h={64} r="var(--r-btn)" />)}
          </Col>
        ))}
      </div>
    </section>
  );
}
