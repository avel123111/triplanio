// @ts-check
import React, { useMemo, useState } from 'react';
import { AddRow, Btn, Card, CardHeader, IconBtn, Meter, Skeleton, Tile, Row, Col } from '@/design/index';
import { useI18nFormat } from '@/lib/i18n/I18nContext';
import { buildPreparation } from '@/lib/trip-preparation';
import { formatDateRange } from '@/lib/trip-dates';
import { naiveDayKey } from '@/lib/naive-time';

// Виджет «Подготовка»: что из требуемого маршрутом ещё не забронировано.
// Модель — `lib/trip-preparation.js` (предикаты общие с лентой), здесь показ.
// В списках только работа: закрытое считается числом в подписи и полосой,
// рядами не повторяется (решение Pavel). Просмотр броней — в маршруте и ленте.

// Даты — дневным ключом: наивное «дата+время» через форматтер без зоны
// печатается в UTC и у части часовых поясов съезжает на сутки.
function day1(fmt, iso) {
  return iso ? fmt(naiveDayKey(iso)) : '';
}

function dayRange(fmt, from, to) {
  return formatDateRange(naiveDayKey(from), naiveDayKey(to), fmt);
}

// Итог «закрыто» — значок и фраза шириной по тексту. Коробка во всю ширину
// (`EmptyState`, `ListRow raised`) ради одной фразы читалась как недоделка.
function DoneLine({ text }) {
  return (
    <Row gap="g3">
      <Tile as="span" tone="success" size="sm" icon="check" />
      <span className="t-label">{text}</span>
    </Row>
  );
}

// Рядов в свёрнутой секции. Одно число на обе колонки, иначе «Ещё N» у ночлегов
// и переездов считались бы от разных потолков.
const CAP = 3;

function SectionHead({ children }) {
  return <Row align="a-baseline" gap="g3">{children}</Row>;
}

// Секция: подпись со счётом, незабронированные ряды, свёртка. Без работы —
// строка «всё забронировано», не пустота.
function Section({ label, rows, done, total }) {
  const { t } = useI18nFormat();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, CAP);
  const hidden = rows.length - shown.length;
  return (
    <Col gap="g4">
      <SectionHead>
        <span className="t-meta muted">{label}</span>
        <span className="t-meta muted num">{done}/{total}</span>
      </SectionHead>
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

function SectionSkeleton() {
  return (
    <Col gap="g4">
      <SectionHead>
        <Skeleton w={70} h={18} r={5} />
        <Skeleton w={24} h={18} r={5} />
      </SectionHead>
      {Array.from({ length: CAP }, (_, i) => (
        <AddRow key={i} icon="dot" title={<Skeleton w={140} h={18} r={5} />} sub={<Skeleton w={92} h={18} r={5} />} />
      ))}
      <Row><Btn variant="link" disabled><Skeleton w={47} h={18} r={5} /></Btn></Row>
    </Col>
  );
}

// Строка готовности: слова слева, процент справа, полоса под ними.
function Progress({ children }) {
  return <Col gap="g3">{children}</Col>;
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

  // Акценты рядов — те же, что у панели города (`CityPanel`).
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

      {total === 0 ? (
        <div className="muted ov-empty-line">{t('overview.prep_empty')}</div>
      ) : (
        <Col gap="g7">
          {/* Полоса стоит во всех состояниях: на 100% зелёная полоса и есть результат. */}
          <Progress>
            <Row align="a-baseline" justify="j-between">
              <span className="t-support">{t('overview.prep_sub', { done, total })}</span>
              <span className="t-strong num">{Math.round((done / total) * 100)}%</span>
            </Row>
            <Meter
              ariaLabel={t('overview.prep_sub', { done, total })}
              segments={[
                { key: 'done', value: done, color: done === total ? 'var(--success)' : 'var(--brand)' },
                { key: 'rest', value: total - done, color: 'transparent' },
              ]}
            />
          </Progress>
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
        </Col>
      )}
    </Card>
  );
}

// Та же карточка из тех же узлов; заголовок настоящий (известен до данных).
export function PreparationSkeleton() {
  const { t } = useI18nFormat();
  return (
    <Card className="col col--g6 prep" aria-busy="true">
      <CardHeader title={t('overview.prep_title')} action={<Skeleton w={32} h={32} r="var(--r-btn)" />} />
      <Col gap="g7">
        <Progress>
          <Row align="a-baseline" justify="j-between">
            <Skeleton w={190} h={19} r={5} />
            <Skeleton w={35} h={23} r={6} />
          </Row>
          <Meter />
        </Progress>
        <div className="prep-cols">
          <SectionSkeleton />
          <SectionSkeleton />
        </div>
      </Col>
    </Card>
  );
}
