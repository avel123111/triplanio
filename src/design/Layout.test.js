/**
 * Контракт примитивов раскладки: ТИП КОМПОНЕНТА == ОСИ КАТАЛОГА (TRIP-388).
 *
 * ЗАЧЕМ. `catalog.json` объявляет набор обличий (гард 2q проверяет по нему CSS и
 * разметку), а `Layout.jsx` объявляет тот же набор ТИПОМ. Два объявления одного
 * набора — это ровно та конструкция, которая расходится молча: каталог правит
 * один PR, тип — другой, и «набор закрыт» перестаёт быть правдой без единого
 * красного прогона. Здесь они сверяются напрямую.
 *
 * ЧИТАЕТСЯ ИМЕННО ТИП, А НЕ ПАРАЛЛЕЛЬНАЯ КОНСТАНТА. Соблазн — завести в
 * `Layout.jsx` рантайм-массив значений и сверять его; тогда тест зелен, а
 * JSDoc-юнион (то, что реально ограничивает автора в редакторе) может уехать
 * куда угодно. Поэтому файл читается ТЕКСТОМ и разбирается его комментарий —
 * приём из `fileType.test.js`, где серверный файл тоже читается как текст.
 *
 * ⚠️ ЗАЩИТА ОТ ИНЕРТНОСТИ. Разбор регуляркой по комментарию обязан падать
 * ГРОМКО: если компонент не найден или ось не найдена, тест красный, а не
 * «нечего сверять — значит сошлось». Именно так этот файл ловит переименование
 * пропа и удаление оси, а не только смену значений.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('./Layout.jsx', import.meta.url)), 'utf8');
const CATALOG = JSON.parse(readFileSync(fileURLToPath(new URL('./catalog.json', import.meta.url)), 'utf8'));

/** компонент → семья каталога + какие пропы каким осям соответствуют. */
const CONTRACT = [
  { comp: 'Row', family: 'row', string: { gap: 'зазор', align: 'поперёк', justify: 'вдоль' }, flag: { wrap: 'перенос', inline: 'поток' } },
  { comp: 'Col', family: 'col', string: { gap: 'зазор', align: 'поперёк', justify: 'вдоль' }, flag: {} },
  { comp: 'Grid', family: 'grid', string: { gap: 'зазор', cols: 'колонки' }, flag: {} },
];

/** JSDoc-блок, стоящий прямо перед `export const <Имя> =`.
 *  ⚠️ Тело блока не имеет права содержать закрывашку комментария — иначе ленивый
 *  поиск начинает матч от ПЕРВОГО комментария файла и утаскивает шапку вместе с
 *  чужими `@param`. Первая редакция была именно такой: `Col.align` сверялся с
 *  юнионом `Row`, и тест покраснел на верном коде. */
function docOf(comp) {
  const m = SRC.match(new RegExp(`/\\*\\*((?:(?!\\*/)[\\s\\S])*)\\*/\\s*export const ${comp} =`));
  assert.ok(m, `в Layout.jsx нет компонента ${comp} с JSDoc-блоком — тест не имеет права молча пройти`);
  return m[1];
}

/** Тело компонента: от его `export const` до следующего. ⚠️ Сверять по ВСЕМУ
 *  файлу нельзя: строка `wrap && 'row--wrap'` есть в файле ровно один раз, и
 *  общий поиск зеленел бы, даже если бы её эмитил не тот компонент. */
function bodyOf(comp) {
  const body = SRC.split(`export const ${comp} =`)[1]?.split('\nexport const ')[0];
  assert.ok(body, `в Layout.jsx нет компонента ${comp} — тест не имеет права молча пройти`);
  return body;
}

/** Значения юниона у `@property {…} [<имя>]` в typedef собственных пропов.
 *  ⚠️ Читается ИМЕННО typedef, а не `@param`: форма с `@param {object} props`
 *  запечатывала набор пропов целиком и роняла typecheck экрана на `id`/`onClick`
 *  (замерено прогоном). Смена формы обязана ломать этот тест, а не проходить
 *  молча, - поэтому имя typedef тоже проверяется. */
function unionOf(comp, prop) {
  const td = SRC.match(new RegExp(`@typedef \\{object\\} ${comp}Own([\\s\\S]*?)\\*/`));
  assert.ok(td, `в Layout.jsx нет typedef ${comp}Own - тест не имеет права молча пройти`);
  const m = td[1].match(new RegExp(`@property \\{([^}]+)\\} \\[${prop}\\]`));
  assert.ok(m, `у ${comp}Own нет @property для пропа ${prop}`);
  const values = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(values.length > 0, `@property ${prop} у ${comp}Own не юнион строк: ${m[1]}`);
  return values;
}

for (const { comp, family, string: strings, flag: flags } of CONTRACT) {
  test(`${comp}: значения пропов совпадают с осями catalog.json (семья ${family})`, () => {
    const axes = CATALOG.axes?.[family];
    assert.ok(axes, `в каталоге нет осей семьи ${family}`);
    const body = bodyOf(comp);

    for (const [prop, axis] of Object.entries(strings)) {
      assert.ok(axes[axis], `в каталоге у ${family} нет оси «${axis}»`);
      assert.deepEqual(
        unionOf(comp, prop).sort(),
        [...axes[axis].значения].sort(),
        `${comp}.${prop} разошёлся с осью «${axis}» семьи ${family}`,
      );
      // ⚠️ ТИП СОШЁЛСЯ С КАТАЛОГОМ - ЭТО ЕЩЁ НЕ КЛАСС НА ЭЛЕМЕНТЕ. Без этой
      // строки подмена `align && \`col--${align}\`` внутри `Row` проходит
      // насквозь: юнион на месте, каталог на месте, а разметка получает класс
      // ЧУЖОЙ семьи, которого в CSS нет, - то есть молчаливый дефолт.
      assert.match(
        body,
        new RegExp(`${prop} && \`${family}--\\$\\{${prop}\\}\``),
        `${comp} не эмитит ${family}--<${prop}>`,
      );
    }

    for (const [prop, axis] of Object.entries(flags)) {
      const values = axes[axis]?.значения ?? [];
      assert.equal(values.length, 1, `ось «${axis}» перестала быть одноз­начной — булев проп ${prop} больше не выражает её`);
      assert.match(body, new RegExp(`${prop} && '${family}--${values[0]}'`), `${comp} не эмитит ${family}--${values[0]}`);
    }
  });

  test(`${comp}: ДЕФОЛТ оси невыразим типом (класса под него нет)`, () => {
    // Половинчатая лестница молчит: `.row--g5` не существует, и если бы «g5» жил
    // в типе, автор написал бы дефолт явно и не получил НИЧЕГО. Сверка B гарда
    // 2q требует того же от разметки — здесь то же требование к типу.
    const axes = CATALOG.axes[family];
    let checked = 0;
    for (const [prop, axis] of Object.entries(strings)) {
      const def = axes[axis].дефолт;
      // Ось без дефолта законна (у `sev` его нет намеренно), но тогда проверять
      // тут нечего - и «нечего проверять» не должно печатать «проверено».
      if (!def) continue;
      checked += 1;
      assert.ok(
        !unionOf(comp, prop).includes(def),
        `${comp}.${prop} принимает дефолтное значение «${def}» — класса под него нет, вызов был бы no-op`,
      );
    }
    assert.ok(checked > 0, `ни одна ось ${family} не объявила дефолт — тест не проверил НИЧЕГО`);
  });
}

test('★ пять примитивов и ни одного сверх (состав утверждён замером форм, TRIP-388)', () => {
  const exported = [...SRC.matchAll(/^export const (\w+) =/gm)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), ['Col', 'Grid', 'Grow', 'Row', 'Trunc']);
});

test('примитивы эмитят СВОЙ класс и пробрасывают className', () => {
  for (const [comp, cls] of [['Row', 'row'], ['Col', 'col'], ['Grid', 'grid'], ['Trunc', 'trunc']]) {
    assert.match(bodyOf(comp), new RegExp(`cn\\(\\s*'${cls}'`), `${comp} не эмитит .${cls}`);
  }
  // `Grow` — единственный, у кого базовый класс зависит от пропа: `.grow--fit`
  // объявляет `flex:1` сам, поэтому пишется без `.grow` (так же, как в разметке).
  assert.match(bodyOf('Grow'), /cn\(fit \? 'grow--fit' : 'grow'/);
  // Проброс проверяется У КАЖДОГО ОТДЕЛЬНО: считать совпадения по всему файлу —
  // значит зеленеть, когда пять дверей есть у трёх компонентов, а два забыли.
  for (const comp of ['Row', 'Col', 'Grid', 'Trunc', 'Grow']) {
    assert.match(bodyOf(comp), /cn\([\s\S]*?className[,)]/, `${comp} не пробрасывает className в cn()`);
  }
  // Остальные пропы уезжают на носитель через `...rest` (`onClick`, `id`, роль,
  // `data-*`): без этого примитив годится только под неинтерактивную обёртку.
  // Тип их тоже пропускает: собственные пропы пересечены с атрибутами носителя.
  for (const comp of ['Row', 'Col', 'Grid', 'Trunc', 'Grow']) {
    assert.match(bodyOf(comp), /\.\.\.rest[\s\S]*\{\.\.\.rest\}/, `${comp} не пробрасывает остальные пропы на носитель`);
  }
});

test('★ все пять одеты в forwardRef: иначе ref молча проглатывается', () => {
  // React 18 у обычной функции ref ПРОГЛАТЫВАЕТ — в dev варнинг, в проде тишина,
  // и у пересаженного узла тихо умирают измерение, автоскролл, фокус и DnD. Ни
  // один гард этого не видит, поэтому дверь проверяется тестом.
  for (const comp of ['Row', 'Col', 'Grid', 'Trunc', 'Grow']) {
    assert.match(SRC, new RegExp(`export const ${comp} = forwardRef\\(`), `${comp} не обёрнут в forwardRef`);
    assert.match(bodyOf(comp), /ref=\{ref\}/, `${comp} не отдаёт ref носителю`);
  }
});

test('★ тип НЕ запечатывает набор пропов и НЕ привязан к одному тегу', () => {
  // Форма `@param {object} props` давала TS2322 на `id`/`onClick`/`role`, то есть
  // первый же интерактивный ряд ронял блокирующий typecheck. Пересечение с
  // ComponentPropsWithoutRef — это и есть починка; её снятие должно краснеть.
  for (const comp of ['Row', 'Col', 'Grid', 'Trunc', 'Grow']) {
    const decl = SRC.split(`export const ${comp} =`)[0].split('/** @type').at(-1) ?? '';
    assert.match(decl, /HostProps/, `${comp} объявлен без атрибутов носителя — экран под @ts-check упрётся в TS2322`);
  }
});

test('★ атрибуты носителя берутся у ЛЮБОГО тега, а не у одного div', () => {
  // `as` меняет носитель, поэтому пересечение с пропами одного `div` типизировало
  // не то, ради чего проп заведён: `<Row as="a" href>` и `<Row as="button" type>`
  // давали TS2322, то есть законный ход «ряд-кнопка вместо сырого <button>»
  // упирался в блокирующий typecheck. Прогон tsc на трёх случаях — в теле PR;
  // здесь пиньется сама форма, чтобы возврат к `<'div'>` краснел.
  assert.match(SRC, /@typedef \{import\('react'\)\.AllHTMLAttributes<HTMLElement>\} HostProps/);
  assert.doesNotMatch(SRC, /ComponentPropsWithoutRef<'div'>/, 'носитель снова привязан к одному тегу');
});
