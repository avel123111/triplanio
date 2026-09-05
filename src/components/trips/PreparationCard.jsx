// @ts-check
import React, { useMemo, useState } from 'react';
import { AddRow, Btn, Card, CardHeader, IconBtn, Meter, Skeleton, Tile, Row, Col } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { buildPreparation } from '@/lib/trip-preparation';
import { formatDateRange } from '@/lib/trip-dates';
import { naiveDayKey } from '@/lib/naive-time';

// Виджет «Подготовка» — что из ТРЕБУЕМОГО МАРШРУТОМ ещё не забронировано.
//
// ★ ЗНАМЕНАТЕЛЬ СЧИТАЕТ МАРШРУТ, А НЕ БРОНИ — правило и его следствие
// («отмершая бронь не учитывается») живут в `lib/trip-preparation.js`, здесь
// только показ. Те же предикаты питают варнинги ленты, поэтому «нет отеля» в
// ленте и «не забронировано» здесь не могут разъехаться.
//
// ★★ В КОЛОНКАХ ТОЛЬКО РАБОТА — забронированного здесь нет вовсе (решение
// Pavel). Закрытое считается числом в подписи секции и полосой готовности,
// списком не повторяется. Отсюда ряд у виджета ОДИН — примитив ДС `<AddRow>`
// (он же в панели города и в сервисах). Вместе с рядами броней у виджета нет и
// замечаний к ним: их показывают лента и маршрут, где эти брони и лежат.
//
// ★ ЗАКРЫТОЕ СОСТОЯНИЕ — не пустое: и секция, и виджет целиком говорят об этом
// строкой `DoneLine`. Полоса готовности при этом остаётся — см. её комментарий.

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
 * Итог «закрыто» — СТРОКА ПО СОДЕРЖИМОМУ, а не коробка во всю ширину.
 *
 * ★★ ПУСТАЯ КОРОБКА ХУЖЕ ПУСТОГО МЕСТА. Пройдено три вида, все забракованы на
 * живом экране: `EmptyState boxed` — серая плита ВНУТРИ белой карточки (коробка
 * в коробке, читается как выключенная заглушка); `EmptyState` без `boxed` — 48
 * px полей, карточка на 340 px ради одной фразы; `ListRow raised` — ящик во всю
 * ширину с двумя словами внутри, то есть ровно «недоделка». Общее у всех трёх:
 * ЁМКОСТЬ БОЛЬШЕ СОДЕРЖИМОГО.
 *
 * Здесь ёмкости нет вовсе: значок плюс фраза, ширина по тексту. Пустота вокруг
 * тогда читается как «здесь больше нечего делать», а не как незаполненное поле.
 * Текст — `t-label` цветом `--ink`, а не приглушённый: это утверждение, а не
 * отсутствие.
 */
function DoneLine({ text }) {
  return (
    <Row gap="g3">
      <Tile as="span" tone="success" size="sm" icon="check" />
      <span className="t-label">{text}</span>
    </Row>
  );
}

// Сколько рядов видно в свёрнутой секции. Одно число на обе колонки — иначе
// «Ещё N» у ночлегов и у переездов считались бы от разных потолков.
const CAP = 3;

/**
 * Секция подготовки: подпись со счётом, ряды работы и свёртка.
 *
 * ★ В СПИСКЕ ТОЛЬКО НЕЗАБРОНИРОВАННОЕ. Закрытое живёт числом в подписи
 * (`2/5`) и в полосе готовности — списком его никто не ищет.
 * ★ ВИДНО ПЕРВЫЕ `CAP` РЯДОВ, остальное — за «Ещё N»: потолок держит высоту
 * секции постоянной, иначе список длиной с маршрут растит экран без предела.
 * ★ РАБОТЫ НЕТ — секция закрыта, и это НЕ пустое состояние: она говорит об
 * этом строкой, а не оставляет под подписью пустоту.
 */
function Section({ label, rows, done, total }) {
  const { t } = useI18nFormat();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, CAP);
  const hidden = rows.length - shown.length;
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
      {rows.length === 0 ? <DoneLine text={t('overview.prep_sec_done')} /> : shown}
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
  onOpenRoute,
}) {
  const { t, fmtDate, plural } = useI18nFormat();

  const prep = useMemo(
    () => buildPreparation({ visits, hotels, transfers }),
    [visits, hotels, transfers],
  );

  if (isLoading) return <PreparationSkeleton />;

  const { stays, legs, total, done } = prep;

  // Ряд у виджета ОДИН — примитив `<AddRow>` напрямую. Обёртка над ним была
  // остатком от времён, когда рядов было два: с одним она превратилась в шесть
  // позиционных аргументов, то есть читалась хуже самого примитива.
  //
  // Тон (`accent` → канал `--a`) — ТЕ ЖЕ значения, что в панели города
  // (`CityPanel`): у одного и того же ряда «добавить бронь» не может быть двух
  // разных акцентов на двух экранах.
  const dotted = (...parts) => parts.filter(Boolean).join(' · ');

  const stayRows = stays.filter((s) => !s.booked).map((s) => (
    <AddRow
      key={s.key} icon="bed" accent="var(--ev-hotel)"
      title={s.visit.city_name}
      sub={dotted(dayRange(fmtDate, s.visit.start_date, s.visit.end_date), `${s.nights} ${plural(s.nights, 'view.nights')}`)}
      onClick={() => onAddHotel?.(s.visit)}
    />
  ));

  const legRows = legs.filter((l) => !l.booked).map((l) => (
    <AddRow
      key={l.key} icon="route" accent="var(--ev-transfer)"
      title={`${l.from.city_name} → ${l.to.city_name}`}
      sub={day1(fmtDate, l.from.end_date)}
      onClick={() => onAddTransfer?.(l.from, l.to)}
    />
  ));

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
            {/* Полоса считает ровно то, что перечислено под ней, и стоит во ВСЕХ
                состояниях: на 100% зелёная полоса — это и есть добытый результат,
                она даёт карточке тело и повод существовать. Ветвится только тело
                под ней: список работы либо строка «всё закрыто». */}
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
            {done === total ? <DoneLine text={t('overview.prep_done_title')} /> : (
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
            )}
          </>
        )}
      </div>
    </Card>
  );
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
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      </div>
    </Card>
  );
}
