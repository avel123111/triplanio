// @ts-check
/**
 * Примитивы раскладки как КОМПОНЕНТЫ (TRIP-388, 05b).
 *
 * ★ ЗАЧЕМ ЭТО СУЩЕСТВУЕТ. Главное число эпика — доля элементов интерфейса,
 * взятых из ДС (`dsshare`, девятая строка пола 2o). Оно растёт ровно тогда,
 * когда сырой тег становится КОМПОНЕНТОМ: `<div className="row">` — это
 * по-прежнему сырой `div`, класс его в числитель не переводит. Масса лежит в
 * `<div>` (1538 штук = +44.1 п.п. потолка), и единственный ход к ней —
 * раскладка компонентами. До TRIP-388 в `src/design/` не было НИ ОДНОГО
 * экспорта про раскладку — оттого `display:flex` и написан руками сотни раз.
 *
 * ★★ НОВОГО CSS ЗДЕСЬ НОЛЬ. Компоненты только ЭМИТЯТ классы, которые уже
 * существуют, схлопнуты фазой 05 и стоят каноном в `catalog.json`. Отсюда:
 * новых классов 0, новых токенов 0, новых префиксов 0, а гард 2p зелёный ПО
 * ПОСТРОЕНИЮ — объявления CSS не меняются ни на байт. ⚠️ И ровно поэтому 2p
 * ничего не доказывает на пересадке экранов: он сравнивает CSS, а меняется
 * РАЗМЕТКА. Доказательство там — поэлементная сверка и скриншот секции.
 *
 * ── НАБОР ЗНАЧЕНИЙ ЗАКРЫТ ТИПОМ, И ТИП — ЭТО КАТАЛОГ ──
 * Значения пропов записаны БУКВАЛЬНО так же, как объявлены оси в
 * `src/design/catalog.json` (`gap="g4"`, а не `gap={4}`). Это не буквоедство:
 *   • перевода нет — значит нечему разъезжаться между типом и каталогом, и
 *     тест `Layout.test.js` сверяет их напрямую;
 *   • ДЕФОЛТ НЕВЫРАЗИМ ПО ПОСТРОЕНИЮ. `gap="g5"` не существует как значение
 *     типа, потому что `.row--g5` не существует как класс: g5 — собственный
 *     зазор `.row`. Написать «дефолт явно» нельзя даже случайно, а это ровно
 *     то, что сверка B гарда 2q требует от разметки.
 *
 * ⚠️ ГРАНИЦА ТИПИЗАЦИИ, НАЗВАННАЯ ВСЛУХ (замерено прогоном `tsc` с опциями
 * репозитория): ошибка `<Row gap="g9">` появляется ТОЛЬКО если сам файл-вызыватель
 * стоит под `// @ts-check`. При `checkJs: false` файл без прагмы не проверяется
 * вовсе — «набор закрыт типом» держится ровно на тех экранах, которые прагму
 * добавили. Поэтому PR пересадки обязан ставить `// @ts-check` в экран, который
 * трогает (храповик TRIP-93 растёт файл за файлом ровно так).
 *
 * ⚠️⚠️ И ЗДЕСЬ БЫЛА ЦЕНА, КОТОРУЮ ПРИШЛОСЬ СНЯТЬ ДО ПЕРВОГО ЖЕ ЭКРАНА. Форма
 * `@param {object} props` + `@param {…} [props.<имя>]` даёт TS объект РОВНО из
 * перечисленных ключей, то есть ЗАПЕЧАТЫВАЕТ набор: под `// @ts-check` проезжали
 * только оси, `as`, `className` и дефисные атрибуты, а `id`, `onClick`, `role`,
 * `style` давали TS2322 — хотя рантайм их пробрасывает через `...rest`. Первый же
 * интерактивный ряд ронял БЛОКИРУЮЩИЙ typecheck, а шапка при этом требует ставить
 * прагму в пересаживаемый экран: правило и инструмент противоречили друг другу.
 * Поэтому собственные пропы объявлены `@typedef` и пересечены с
 * `ComponentPropsWithoutRef<'div'>` — оси остаются закрытым набором, DOM-атрибуты
 * проезжают. Проверено прогоном: `<Row id onClick role ref as>` чист, `gap="g9"`
 * по-прежнему TS2322.
 *
 * ★ `ref` СТОИТ ОСОБНЯКОМ и поэтому все пять одеты в `forwardRef`: у обычной
 * функции React 18 его ПРОГЛАТЫВАЕТ — в dev с варнингом, в проде молча, — то есть
 * измерение, автоскролл, фокус и DnD у пересаженного узла тихо перестают работать,
 * и ни один гард этого не видит. Замер: 33 файла в `src/pages`+`src/components`
 * пишут `ref={`. Молчаливый no-op — ровно тот класс дефекта, против которого
 * заведён весь эпик, поэтому это не «проп на будущее», а обязательная дверь.
 *
 * ── ПРОБРОС `className` — ОБЪЯВЛЕННАЯ ДВЕРЬ С ПРАВИЛОМ ──
 * Без него пересадка невозможна: экранный крючок (цвет, фон, анимация, тест-хук)
 * должен доехать. Но ПРИМИТИВ ВЛАДЕЕТ `display`, `gap`, `align-items`,
 * `justify-content`, `flex-direction`: класс, приехавший через `className` и
 * всё ещё объявляющий хоть одно из них, — это не пересадка, а второй источник
 * раскладки под новым именем.
 *
 * ⚠️ И ЗДЕСЬ НАДО НАЗВАТЬ, ЧТО ИЗ ЭТОГО ПРАВИЛА ПРОВЕРЯЕТ МАШИНА, А ЧТО - НЕТ.
 * Машина видит РОВНО `display: flex|grid`: `audit-design.mjs` §3a печатает
 * `приватных классов раскладки`, это десятая строка пола 2o, и PR пересадки
 * обязан уронить её на те классы, которые тронул. Остальные четыре свойства
 * НЕ ПОД НАБЛЮДЕНИЕМ: класс, приехавший через `className` к `.row` и
 * объявляющий только `gap`/`align-items`/`justify-content`/`flex-direction`,
 * получает `display` от примитива и в число НЕ ПОПАДАЕТ. Их не единицы: мой
 * разовый прогон дал 89 таких классов в периметре, но точного числа тут нет и
 * быть не может, пока предикат не стал кодом (закон 8) - счёт зависит от того,
 * как берётся подлежащее, и разовый скрипт разошёлся с аудитом на два класса
 * уже на соседнем вопросе. Расширять предикат - отдельное решение с отдельным
 * замером; пока эта половина правила держится РЕВЬЮ, а не гардом, и читать
 * «число упало» как «раскладка точно уехала» нельзя.
 */
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Собственные пропы ряда. ⚠️ ОНИ ИДУТ ЧЕРЕЗ `@typedef`, А НЕ ЧЕРЕЗ `@param {object}`:
 * форма с перечислением ключей у одного объекта ЗАПЕЧАТЫВАЕТ набор, и экран под
 * `// @ts-check` получал TS2322 на `id`, `onClick`, `role`, `style` — то есть
 * первый же интерактивный ряд ронял блокирующий typecheck, а шапка при этом
 * ТРЕБУЕТ ставить прагму в пересаживаемый экран. Замерено прогоном, не выведено.
 *
 * @typedef {object} RowOwn
 * @property {'g1'|'g2'|'g3'|'g4'|'g6'|'g7'|'g8'} [gap] зазор; дефолт g5 = сам `.row`
 * @property {'a-start'|'a-baseline'} [align] поперёк; дефолт a-center
 * @property {'j-between'|'j-center'} [justify] вдоль; дефолт j-start
 * @property {boolean} [wrap] перенос; дефолт nowrap
 * @property {boolean} [inline] поток inline-flex; дефолт block
 * @property {any} [as] тег-носитель: раскладка не диктует семантику
 */

/** Ряд. Эмитит `.row` (`display:flex`, `gap:--sp-5`, `align-items:center`). */
/** @type {import('react').ForwardRefExoticComponent<RowOwn & import('react').ComponentPropsWithoutRef<'div'> & import('react').RefAttributes<any>>} */
export const Row = forwardRef(({ gap, align, justify, wrap, inline, as: T = 'div', className, ...rest }, ref) => (
  <T
    ref={ref}
    className={cn(
      'row',
      gap && `row--${gap}`,
      align && `row--${align}`,
      justify && `row--${justify}`,
      wrap && 'row--wrap',
      inline && 'row--inline',
      className,
    )}
    {...rest}
  />
));

/**
 * Колонка. Эмитит `.col`. ⚠️ Дефолты у колонки ДРУГИЕ, чем у ряда: `align-items`
 * в `.col` не объявлен вовсе (то есть `stretch`), а набор значений оси другой —
 * `a-baseline` у колонки не зовут, `a-end` у ряда тоже. Асимметрия объявлена в
 * каталоге, а не молчит, и «восстановить как было» на одном примитиве no-op, а
 * на другом ломает геометрию (`.tv-conncell` 33 → 18 px, TRIP-388).
 *
 * @typedef {object} ColOwn
 * @property {'g1'|'g2'|'g3'|'g4'|'g6'|'g7'|'g8'} [gap] зазор; дефолт g5
 * @property {'a-start'|'a-end'} [align] поперёк; дефолт stretch
 * @property {'j-center'} [justify] вдоль; дефолт j-start
 * @property {any} [as] тег-носитель
 */

/** @type {import('react').ForwardRefExoticComponent<ColOwn & import('react').ComponentPropsWithoutRef<'div'> & import('react').RefAttributes<any>>} */
export const Col = forwardRef(({ gap, align, justify, as: T = 'div', className, ...rest }, ref) => (
  <T
    ref={ref}
    className={cn('col', gap && `col--${gap}`, align && `col--${align}`, justify && `col--${justify}`, className)}
    {...rest}
  />
));

/**
 * Сетка. Эмитит `.grid`. ⚠️ Ступени `g1` у сетки НЕТ — она не объявлена в CSS и
 * названа дырой в `app.css`; в типе её нет, поэтому `<Grid gap="g1">` — ошибка
 * редактора, а не молчаливый дефолт 10px.
 *
 * @typedef {object} GridOwn
 * @property {'g2'|'g3'|'g4'|'g6'|'g7'|'g8'} [gap] зазор; дефолт g5
 * @property {'2'} [cols] колонки; дефолт 1
 * @property {any} [as] тег-носитель
 */

/** @type {import('react').ForwardRefExoticComponent<GridOwn & import('react').ComponentPropsWithoutRef<'div'> & import('react').RefAttributes<any>>} */
export const Grid = forwardRef(({ gap, cols, as: T = 'div', className, ...rest }, ref) => (
  <T ref={ref} className={cn('grid', gap && `grid--${gap}`, cols && `grid--${cols}`, className)} {...rest} />
));

/**
 * Обрезка в одну строку. Эмитит `.trunc` (`overflow` + `text-overflow` +
 * `white-space`). Складывается с `Grow fit`: «разрешено ужаться» — это другое
 * свойство, чем «обрезать хвост».
 *
 */
/** @type {import('react').ForwardRefExoticComponent<{ as?: any } & import('react').ComponentPropsWithoutRef<'div'> & import('react').RefAttributes<any>>} */
export const Trunc = forwardRef(({ as: T = 'div', className, ...rest }, ref) => (
  <T ref={ref} className={cn('trunc', className)} {...rest} />
));

/**
 * Растяжка. Эмитит `.grow` (`flex:1`), с `fit` — `.grow--fit` (`flex:1` +
 * `min-width:0`), тот самый набор, который написан руками десятки раз.
 *
 */
/** @type {import('react').ForwardRefExoticComponent<{ fit?: boolean, as?: any } & import('react').ComponentPropsWithoutRef<'div'> & import('react').RefAttributes<any>>} */
export const Grow = forwardRef(({ fit, as: T = 'div', className, ...rest }, ref) => (
  <T ref={ref} className={cn(fit ? 'grow--fit' : 'grow', className)} {...rest} />
));
