// @ts-check
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn, IconBtn, Card, Sheet } from '@/design/index';
import { Row, Col, Trunc } from '@/design/Layout';
import { useT } from '@/lib/i18n/I18nContext';
import { useIsPhone } from '@/hooks/use-mobile';
import CitySearch from '@/components/cities/CitySearch';
import CountryFlag from '@/components/common/CountryFlag';

/**
 * КОМПОЗЕР ДОБАВЛЕНИЯ ГОРОДА — ОДИН НА РЕДАКТОР МАРШРУТА И ВИЗАРД (TRIP-484 §4).
 *
 * ★ ПОЧЕМУ ОН ОБЩИЙ. Добавить город в маршрут — одно действие, и до переезда оно
 * было написано ДВАЖДЫ и по-разному. В редакторе: город -> ВИД ТОЧКИ -> кнопка
 * «Добавить». В визарде: ряд открывался пикером, а подтверждала галочка «✓» в том
 * же ряду — то есть переспрашивала ТОТ ЖЕ город, который только что выбрали;
 * между выбором и записью не происходило ничего, а вид точки не выбирался вовсе
 * (он выводился из числа ночей). Разница была не во вкусе: у визарда просто не
 * было понятия «вид точки», хотя сохранял он ровно те же четыре вида.
 *
 * ★★ ПОДТВЕРЖДЕНИЕ НЕ УБРАНО, ОНО ПЕРЕЕХАЛО. Тап по городу по-прежнему не пишет
 * в маршрут: он заполняет слот и открывает выбор вида. Записывает кнопка внизу.
 * Разница с прежним «✓» в том, что теперь между выбором и записью стоит РЕШЕНИЕ,
 * а не пауза.
 *
 * ★ ПЛАТФОРМА — ЗАБОТА КОМПОЗЕРА, А НЕ ЭКРАНА. Десктоп: инлайн-карточка в конце
 * списка (клавиатуры нет — проблем нет). Телефон: канон-шит <Sheet>, и
 * КЛАВИАТУРЫ В НЁМ НЕТ ВООБЩЕ — поле города здесь триггер, ввод уезжает в свою
 * полноростную шторку поверх этой (движок <Autocomplete>, поверхность
 * <PickerSheet>). Поэтому композер не поверхность, высоту которой меняет
 * клавиатура: у него только собственное содержимое. Вызывателю знать про
 * платформу нечего — он передаёт `onAdd` и получает (город, вид).
 *
 * `renderTrigger` отдаёт наружу только ОТКРЫТИЕ: плитка «Старт» на шаге городов —
 * тот же вход, просто выглядит рядом маршрута, а не кнопкой под списком.
 *
 * `defaultKind` называет НАМЕРЕНИЕ ВХОДА: с кнопки «добавить город» открывается
 * посещение, с плейсхолдера «Старт» — старт. Это предвыбор плитки, а не запрет:
 * человек волен выбрать другой вид. Занятые виды гасит `disabledFor`.
 */

export const POINT_TYPES = [
  { id: 'transit', labelKey: 'event.city', icon: 'bed', subKey: 'tse.pt_transit_sub' },
  { id: 'waypoint', labelKey: 'tse.pt_waypoint', icon: 'arrowSwap', subKey: 'tse.pt_waypoint_sub' },
  { id: 'start', labelKey: 'ai_plan.start', icon: 'flag', subKey: 'tse.pt_start_sub' },
  { id: 'end', labelKey: 'ai_plan.end', icon: 'flag', subKey: 'tse.pt_end_sub' },
];

/**
 * @param {{ onAdd: (city: any, kind: string) => void, hasStart?: boolean,
 *   hasEnd?: boolean, defaultKind?: string,
 *   renderTrigger?: (api: { open: () => void }) => any }} p
 */
export default function CityAdder({ onAdd, hasStart, hasEnd, defaultKind = 'transit', renderTrigger }) {
  const t = useT();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [city, setCity] = useState(null);
  // Предвыбор плитки = намерение входа. Если этот вид уже занят (старт задан, а
  // открыли с плейсхолдера старта — так бывает после «назад»), падаем на
  // посещение: предвыбирать заведомо серую плитку нельзя.
  const [kind, setKind] = useState(defaultKind);
  const rootRef = useRef(null); // десктоп-композер целиком
  const footRef = useRef(null); // футер с кнопками — последний элемент композера
  const close = () => { setOpen(false); setCity(null); setKind(defaultKind); };
  const disabledFor = (id) => (id === 'start' && !!hasStart) || (id === 'end' && !!hasEnd);
  // Плитка, на которой стоит выбор, не может быть погашенной — иначе кнопка
  // «Добавить» пишет вид, которого на экране не выбрать.
  const effKind = disabledFor(kind) ? 'transit' : kind;
  const submit = () => { if (city) { onAdd(city, effKind); close(); } };
  const meta = POINT_TYPES.find((p) => p.id === effKind);

  // Докрутка тем же приёмом scrollIntoView, что и по всему аппу (ValidationUI,
  // CoverPicker, …) — в ЛЮБОМ скролл-контейнере (тело виджета на десктопе / тело
  // <Sheet> на телефоне), без платформенных веток и вычислений вьюпорта:
  //   • выбран город → появились плитки + кнопки: докручиваем К ФУТЕРУ (он
  //     последний), так в кадр попадают и плитки, и кнопки «Добавить/Отмена» —
  //     на ОБЕИХ платформах;
  //   • только открыли, города ещё нет: на десктопе — к самому композеру; на
  //     телефоне открытие ведёт <Sheet>/платформа, скролл не трогаем.
  // Небольшая задержка — дать разметке (появление плиток) осесть перед замером.
  useEffect(() => {
    if (!open) return;
    const target = city ? footRef.current : (isPhone ? null : rootRef.current);
    if (!target) return;
    const id = setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60);
    return () => clearTimeout(id);
  }, [open, city, isPhone]);

  // Общие шаги композера (город → тип → подтверждение) — без своей шапки: на
  // десктопе шапку рисует карточка ниже, на телефоне её даёт сам <Sheet>.
  const steps = (
    <>
      {/* Шаг 1 — город. Выбор заполняет слот (флаг+имя+«Изменить»), не добавляя
          сразу; это открывает шаг типа ниже. `autoFocus` — каретка в поле на
          ДЕСКТОПЕ; на телефоне шторка себя не открывает по правилу движка
          (разбор — в `common/Autocomplete`), поэтому гасить его тут не нужно. */}
      {!city ? (
        <CitySearch onSelect={setCity} />
      ) : (
        <Row gap="g3" className="te-add-city">
          <CountryFlag code={city.country_code} />
          <Trunc as="span" className="te-add-cityname">{city.city_name}</Trunc>
          <Btn variant="quiet" size="sm" icon="edit" onClick={() => setCity(null)}>{t('tse.pt_change')}</Btn>
        </Row>
      )}

      {/* Шаг 2 — тип (появляется после выбора города). aria-pressed несёт выбор
          в AT; тон активной плитки — из .te-add-type[aria-pressed="true"]. */}
      {city && (
        <Col gap="g2">
          <span className="eyebrow">{t('tse.pt_type_label')}</span>
          <div className="te-add-grid" role="group" aria-label={t('tse.pt_type_label')}>
            {POINT_TYPES.map((pt) => {
              const dis = disabledFor(pt.id);
              return (
                <button key={pt.id} type="button" className="te-add-type"
                  aria-pressed={effKind === pt.id} disabled={dis || undefined}
                  title={dis ? t('tse.already_set') : t(pt.subKey)}
                  onClick={() => setKind(pt.id)}>
                  <Icon name={pt.icon} size={17} />
                  <span className="t-label">{t(pt.labelKey)}</span>
                </button>
              );
            })}
          </div>
          <span className="t-meta muted">{meta ? t(meta.subKey) : ''}</span>
        </Col>
      )}

      {/* Шаг 3 — осознанное подтверждение, которого не было у мгновенного add. */}
      <Row gap="g3" justify="j-between" className="te-add-ft" ref={footRef}>
        <Btn variant="secondary" onClick={close}>{t('common.cancel')}</Btn>
        <Btn variant="primary" disabled={!city} onClick={submit}>
          <Icon name="plus" size={15} /> {t('common.add')}
        </Btn>
      </Row>
    </>
  );

  // Аффорданс открытия может быть чужим: плитка «Старт» на шаге городов — это
  // тот же вход в композер, только выглядит она рядом маршрута, а не кнопкой под
  // списком. Отдаём наружу ОТКРЫТИЕ, а не состояние: кто рисует триггер, тот не
  // должен знать, что у композера внутри.
  const trigger = renderTrigger
    ? renderTrigger({ open: () => setOpen(true) })
    : (
      <Btn variant="soft" block className="te-add-open" onClick={() => setOpen(true)}>
        <Icon name="plus" size={15} /> {t('tse.add_point_btn')}
      </Btn>
    );

  // Телефон: кнопка в списке + композер в КАНОН-шите <Sheet>. Держать поле над
  // клавиатурой этому шиту НЕ НАДО: полей ввода в нём нет — город выбирается в
  // своей шторке поверх (разбор в шапке компонента).
  if (isPhone) {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={(o) => { if (!o) close(); }} title={t('tse.add_point')}>
          <div className="te-add">
            <span className="t-meta muted">{t('tse.add_point_hint')}</span>
            {steps}
          </div>
        </Sheet>
      </>
    );
  }
  // Десктоп: инлайн в виджете со своей шапкой и лёгкой анимацией появления.
  if (!open) return trigger;
  return (
    <div ref={rootRef} className="te-addwrap">
      <Card recessed radius="md" pad="none" className="te-add">
        <Row justify="j-between" align="a-start">
          <Col gap="g1">
            <b>{t('tse.add_point')}</b>
            <span className="t-meta muted">{t('tse.add_point_hint')}</span>
          </Col>
          <IconBtn icon="close" onClick={close} ariaLabel={t('common.close')} />
        </Row>
        {steps}
      </Card>
    </div>
  );
}
