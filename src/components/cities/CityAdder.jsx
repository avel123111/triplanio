// @ts-check
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '@/design/icons';
import { Btn, IconBtn, Card } from '@/design/index';
import { PickerSheet, usePickerFocus } from '@/components/ui/PickerSheet';
import { Row, Col } from '@/design/Layout';
import { useT } from '@/lib/i18n/I18nContext';
import { useIsPhone } from '@/hooks/use-mobile';
import CitySearch from '@/components/cities/CitySearch';
import SelectedCity from '@/components/cities/SelectedCity';

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
 * списка (клавиатуры нет — проблем нет). Телефон: ОДНА полноростная
 * <PickerSheet> на всё действие, обе фазы внутри неё, поиск работает встроенным
 * режимом движка (<Autocomplete embedded>) — своей шторки он не поднимает.
 * Вызывателю знать про платформу нечего: он передаёт `onAdd` и получает
 * (город, вид).
 *
 * `renderTrigger` отдаёт наружу только ОТКРЫТИЕ: плитка «Старт» на шаге городов —
 * тот же вход, просто выглядит рядом маршрута, а не кнопкой под списком.
 *
 * `defaultKind` называет НАМЕРЕНИЕ ВХОДА: с кнопки «добавить город» открывается
 * посещение, с плейсхолдера «Старт» — старт. Это предвыбор плитки, а не запрет:
 * человек волен выбрать другой вид. Занятые виды гасит `disabledFor`.
 */

export const POINT_TYPES = [
  /* ⚠️ `tse.node_visit` («Посещение»), а НЕ `event.city` («Город»): панель узла
     (`CityPanel`) уже зовёт этот же узел посещением, и плитка звала его городом —
     одно понятие под двумя именами на соседних экранах. Ключ существующий, в
     Tolgee заводить нечего. `event.city` остался тем, чем и был: подписью ПОЛЯ
     города в окне события, а это другой смысл. */
  { id: 'transit', labelKey: 'tse.node_visit', icon: 'bed', subKey: 'tse.pt_transit_sub' },
  { id: 'waypoint', labelKey: 'tse.pt_waypoint', icon: 'arrowSwap', subKey: 'tse.pt_waypoint_sub' },
  { id: 'start', labelKey: 'ai_plan.start', icon: 'flag', subKey: 'tse.pt_start_sub' },
  { id: 'end', labelKey: 'ai_plan.end', icon: 'flag', subKey: 'tse.pt_end_sub' },
];

/**
 * @param {{ onAdd: (city: any, kind: string) => void, hasStart?: boolean,
 *   hasEnd?: boolean, defaultKind?: string,
 *   renderTrigger?: (api: { open: () => void }) => any,
 *   onOpenChange?: (open: boolean) => void }} p
 */
export default function CityAdder({ onAdd, hasStart, hasEnd, defaultKind = 'transit', renderTrigger, onOpenChange }) {
  const t = useT();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  /* ★ ОТКРЫТОСТЬ СООБЩАЕТСЯ НАРУЖУ ОДНИМ КАНАЛОМ, и читателей у неё два: шаг
     визарда не даёт нажать «Далее», пока работа с городом не закончена
     (сохранена или отменена), и пустое состояние списка уступает композеру
     место, а не встаёт над ним. Оба факта — про «композер сейчас открыт», и
     второго способа это узнать заводить незачем.
     Эффект, а не вызов в обработчиках: закрытий у композера три (подтверждение,
     отмена, «×»), и обработчиков пришлось бы обвешивать все три.

     ⚠️ ЧЕТВЁРТАЯ ДВЕРЬ — РАЗМОНТИРОВАНИЕ, И ОНА НЕ ПРОХОДИТ ЧЕРЕЗ `open`.
     Композер плитки «Старт» стоит под условием `{!hasStart && …}`: подтверждение
     задаёт старт, и тем же кадром компонент исчезает. Своего `setOpen(false)`
     он не успевает донести — эффект размонтированного узла React не запускает, —
     и наружу оставалось «композер открыт» НАВСЕГДА: «Далее» на шаге городов
     выключалась у готового маршрута, а снять её было нечем, кроме открыть-и-
     закрыть второй композер. Поэтому закрытие несёт УБОРКА эффекта: она бежит на
     любом уходе, включая тот, которого компонент не переживает.

     ★★ КАНАЛ СООБЩАЕТ ПЕРЕХОДЫ, А НЕ ТЕКУЩЕЕ ЗНАЧЕНИЕ, и это условие того, чтобы
     его можно было СКЛАДЫВАТЬ. Композеров на шаге бывает ДВА одновременно
     (плитка «Старт» и пустое состояние, пока нет ни старта, ни городов), и оба
     пишут в один факт. Пока канал слал текущее `open`, закрытие одного гасило
     факт, при котором второй ещё открыт, — «Далее» пускала дальше при открытом
     композере, ровно от чего флаг и заведён. Теперь у каждого `true` РОВНО ОДИН
     парный `false` (открытие → уборка), и вызыватель считает открытые, а не
     хранит последнее услышанное. */
  useEffect(() => {
    if (!open) return undefined;
    onOpenChange?.(true);
    return () => onOpenChange?.(false);
  }, [open, onOpenChange]);
  const [city, setCity] = useState(null);
  // Предвыбор плитки = намерение входа. Если этот вид уже занят (старт задан, а
  // открыли с плейсхолдера старта — так бывает после «назад»), падаем на
  // посещение: предвыбирать заведомо серую плитку нельзя.
  const [kind, setKind] = useState(defaultKind);
  /* Открыть поверхность и сфокусировать её поле, не выходя из жеста: на тач-
     платформе клавиатуру поднимает только `focus()` внутри пользовательского
     жеста. Правило живёт у поверхности (`usePickerFocus`), здесь только вызовы. */
  const { searchRef, inGesture } = usePickerFocus();
  const rootRef = useRef(null); // десктоп-композер целиком
  const footRef = useRef(null); // футер с кнопками — последний элемент композера
  const close = () => { setOpen(false); setCity(null); setKind(defaultKind); };
  /* На телефоне открытие обязано ПОСТАВИТЬ ФОКУС в поле шторки тем же жестом —
     иначе человек видит поиск, но клавиатуру ему надо вызывать вторым тапом.
     На десктопе поверхности нет, каретку ставит `autoFocus` поля. */
  const openComposer = () => (isPhone ? inGesture(() => setOpen(true)) : setOpen(true));
  /* «Изменить город» — та же шторка возвращается к поиску. Не вторая шторка и не
     переоткрытие: коробка остаётся на месте, меняется её содержимое. Хук зовём
     тем же входом — ему всё равно, что именно переключает жест. */
  const backToSearch = () => (isPhone ? inGesture(() => setCity(null)) : setCity(null));
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

  // ── Фазы композера ────────────────────────────────────────────────────────
  // Их две, и на телефоне они обязаны жить в ОДНОЙ коробке: «найди город» и
  // «выбери вид точки». Разводить их по двум шторкам (как было) — это лишняя
  // поверхность и лишний тап на каждое действие, включая «изменить город».
  const cityStep = isPhone
    ? <CitySearch embedded fieldRef={searchRef} onSelect={setCity} />
    : <CitySearch onSelect={setCity} />;

  const typeStep = city ? (
    <>
      {/* «Изменить» возвращает ТУ ЖЕ шторку к поиску — не открывает вторую. Фокус
          ставится в этом же жесте, иначе поле получит каретку без клавиатуры
          (разбор — в шапке `ui/PickerSheet`). Сам ряд общий: тот же, что в
          диалоге «добавить место» (`cities/SelectedCity`). */}
      <SelectedCity city={city} onChange={backToSearch} />

      {/* Вид точки. aria-pressed несёт выбор в AT; тон активной плитки — из
          .te-add-type[aria-pressed="true"]. */}
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
    </>
  ) : null;

  // Подтверждение. Осмысленное: между выбором города и записью стоит выбор вида.
  const footer = (
    <Row gap="g3" justify="j-between" className="te-add-ft" ref={footRef}>
      <Btn variant="secondary" onClick={close}>{t('common.cancel')}</Btn>
      <Btn variant="primary" disabled={!city} onClick={submit}>
        <Icon name="plus" size={15} /> {t('common.add')}
      </Btn>
    </Row>
  );

  // Десктоп: обе фазы подряд в одной карточке — поверхностей там нет вовсе,
  // прятать одну за другой незачем.
  const steps = (
    <>
      {!city ? cityStep : typeStep}
      {footer}
    </>
  );

  const trigger = renderTrigger
    ? renderTrigger({ open: openComposer })
    : (
      <Btn variant="soft" block className="te-add-open" onClick={openComposer}>
        <Icon name="plus" size={15} /> {t('tse.add_point_btn')}
      </Btn>
    );

  /* ★ ТЕЛЕФОН — ОДНА ПОВЕРХНОСТЬ НА ВСЁ ДЕЙСТВИЕ (TRIP-484 §4).
     Было две вложенных: маленькая шторка композера, в ней ТРИГГЕР, тап по
     триггеру открывал вторую во весь рост, выбор возвращал в первую. То есть
     «добавить город» стоило четырёх тапов и двух поверхностей, а «изменить
     город» гоняло по той же лестнице второй раз.
     Теперь коробка одна и она не меняет высоту между фазами: открылась — уже
     ищешь (поле пришпилено, фокус в жесте, клавиатура сразу), выбрал — та же
     коробка показывает город и виды точки, «изменить» возвращает её к поиску.
     Полный рост заявлен явно (`full`), потому что поле здесь не в слоте
     поверхности, а внутри содержимого: на второй фазе его нет вовсе, а коробка
     обязана остаться прежней — сжимать её между фазами и есть тот дефект, ради
     которого полный рост заведён.
     Подтверждение прижато книзу: `.te-add` растёт (`grow`), футер идёт следом. */
  if (isPhone) {
    return (
      <>
        {trigger}
        <PickerSheet
          open={open}
          onOpenChange={(o) => { if (!o) close(); }}
          title={t('tse.add_point')}
          full
        >
          <div className="te-add grow">
            {!city ? cityStep : typeStep}
          </div>
          {/* Футер — только когда есть что подтверждать. На фазе поиска
              «Добавить» всё равно выключена, а «Отмена» повторяет «×» в шапке:
              две мёртвые кнопки под списком результатов. */}
          {city ? footer : null}
        </PickerSheet>
      </>
    );
  }

  // Десктоп: инлайн в виджете со своей шапкой и лёгкой анимацией появления.
  if (!open) return trigger;
  return (
    <div ref={rootRef} className="te-addwrap">
      <Card recessed radius="md" pad="none" className="te-add">
        <Row justify="j-between" align="a-start">
          <b>{t('tse.add_point')}</b>
          <IconBtn icon="close" onClick={close} ariaLabel={t('common.close')} />
        </Row>
        {steps}
      </Card>
    </div>
  );
}
