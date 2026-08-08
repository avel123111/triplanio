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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
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
  // Тип их тоже пропускает — это пиньет прогон `tsc` в конце файла.
  for (const comp of ['Row', 'Col', 'Grid', 'Trunc', 'Grow']) {
    assert.match(bodyOf(comp), /\.\.\.rest[\s\S]*\{\.\.\.rest\}/, `${comp} не пробрасывает остальные пропы на носитель`);
  }
});

test('★ все пять одеты в forwardRef: иначе ref молча проглатывается', () => {
  // React 18 у обычной функции ref ПРОГЛАТЫВАЕТ — в dev варнинг, в проде тишина,
  // и у пересаженного узла тихо умирают измерение, автоскролл, фокус и DnD. Ни
  // один гард этого не видит, поэтому дверь проверяется тестом.
  // ⚠️ Между `=` и `forwardRef(` стоит каст носителя (`/** @type {any} */ (`),
  // поэтому окно, а не стык: пиньется НАЛИЧИЕ обёртки, а не её орфография.
  for (const comp of ['Row', 'Col', 'Grid', 'Trunc', 'Grow']) {
    assert.match(SRC, new RegExp(`export const ${comp} =[^;]{0,80}?forwardRef\\(`), `${comp} не обёрнут в forwardRef`);
    assert.match(bodyOf(comp), /ref=\{ref\}/, `${comp} не отдаёт ref носителю`);
  }
});

test('★ тип НЕ запечатывает НИ набор пропов, НИ набор носителей', () => {
  // Ловушка сработала дважды подряд. Сперва запечатался набор ПРОПОВ
  // (`@param {object}` → TS2322 на `id`/`onClick`/`role`), потом набор
  // НОСИТЕЛЕЙ: пересечение с `ComponentPropsWithoutRef<'div'>` знало только
  // `div`, поэтому `<Row as="a" href>` и `<Row as="button" type disabled>`
  // краснели — ровно на ходе, ради которого `as` заведён. Отсюда ОБА условия:
  // носитель обязан быть ПАРАМЕТРОМ типа, и он не смеет вернуться литералом.
  // ⚠️ Берётся именно `docOf` — JSDoc-блок ПЕРЕД объявлением. Ad-hoc разрез по
  // `/** @type` тут инертен наполовину: у блока есть текст до тега, разрез не
  // срабатывает, `decl` становится всем файлом до компонента, и проверка ловит
  // ПРОЗУ шапки (там `ComponentPropsWithoutRef<'div'>` упомянут как история).
  for (const comp of ['Row', 'Col', 'Grid', 'Trunc', 'Grow']) {
    const decl = docOf(comp);
    assert.match(decl, /@type \{<T extends import\('react'\)\.ElementType/, `${comp}: носитель не параметр типа — as снова врёт`);
    assert.match(decl, /Poly<T,/, `${comp} объявлен мимо Poly — DOM-атрибуты носителя не проедут`);
    assert.doesNotMatch(decl, /ComponentPropsWithoutRef<'[a-z]/, `${comp}: носитель снова запечатан литеральным тегом`);
  }
  // `Poly` обязан отдавать спорные имена НАШЕЙ оси: `align` — легальный
  // HTML-атрибут у `td`/`th`/`img`, и без `Omit` пересечение двух разных
  // union'ов схлопывает ось в `never`.
  assert.match(SRC, /Omit<import\('react'\)\.ComponentPropsWithoutRef<T>, keyof O \| 'as' \| 'ref'>/);
});

/** ★★★ ТЕКСТОВЫЙ ПИН НЕ ДОКАЗЫВАЕТ, ЧТО ТИП РАБОТАЕТ. Проверки выше сверяют
 *  ОРФОГРАФИЮ объявления, а вопрос стоит про ПОВЕДЕНИЕ: «`as="button"` пропускает
 *  `type` и `disabled`» и «`gap="g9"` по-прежнему ошибка» — на это отвечает только
 *  прогон `tsc`. Оба дефекта этого файла (запечатанный набор пропов, потом
 *  запечатанный носитель) были НЕВИДИМЫ тексту и видны прогону, причём второй
 *  проехал мимо теста, написанного специально про первый. Поэтому прогон здесь
 *  СТОЯЧИЙ, а не разовый в теле PR: одноразовое доказательство защищает ровно тот
 *  день, когда его провели.
 *
 *  Проба живёт в ВРЕМЕННОМ КАТАЛОГЕ ВНЕ репозитория намеренно: файл `.jsx` с
 *  `<Row>`, забытый внутри `src/`, попадёт в периметр `audit-design.mjs` и
 *  ПОДНИМЕТ `dsshare` — главное число эпика — не написав ни одного экрана.
 *
 *  ⚠️⚠️ КОНФИГ ПРОБЫ — `extends` НАСТОЯЩЕГО `jsconfig.json`, И ЭТО НЕСУЩЕЕ.
 *  Первая редакция выписывала опции руками и вела `react` через `paths` прямо в
 *  `node_modules/react` — то есть в НЕТИПИЗИРОВАННЫЙ JS: `@types/react` в
 *  программу не попадал (`--listFiles`: 0 совпадений), все React-типы вырождались
 *  в `any`, `Omit<any, …>` — в индекс-сигнатуру, и проба зеленела на ЧЁМ УГОДНО,
 *  включая `<Row as="div" href>`. Замер, который это вскрыл: возвращаю сам дефект
 *  P1-2 (`ComponentPropsWithoutRef<T>` → `<'div'>`) — вывод `tsc` БАЙТ В БАЙТ ТОТ
 *  ЖЕ, тест зелёный. То есть стоячий гейт, написанный против конкретной регрессии,
 *  не видел ровно её. Классический «зелёный тест над пустой комнатой», и нашёл его
 *  прогон `code-simplifier`, а не чтение. `extends` заодно чинит второе: проба
 *  судит ТЕМ ЖЕ конфигом, что настоящий гейт `npm run typecheck`, поэтому разойтись
 *  с ним она больше не может. */
test('★★★ ПРОГОН tsc: носитель пропускает свои атрибуты, ось остаётся закрытой', () => {
  const dir = mkdtempSync(join(tmpdir(), 'layout-types-'));
  try {
    const repo = fileURLToPath(new URL('../..', import.meta.url));
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      extends: join(repo, 'jsconfig.json'),
      compilerOptions: { noEmit: true, checkJs: true, baseUrl: dir, paths: { '@/*': [join(repo, 'src', '*')] } },
      include: ['probe.jsx'],
    }));

    // Слева от `//` — что проверяем. ЧИСТЫЕ и КРАСНЫЕ случаи в ОДНОМ файле:
    // так «ошибок нет» не может сойти за успех — половина строк обязана краснеть.
    const LINES = [
      ['clean', '<Row as="a" href="/x" target="_blank">a</Row>'],
      ['clean', '<Row as="button" type="button" disabled onClick={() => {}}>b</Row>'],
      ['clean', '<Col as="ul" role="list" id="q">c</Col>'],
      ['clean', '<Grid as="section" aria-label="g">d</Grid>'],
      ['clean', '<Trunc as="span" title="t">e</Trunc>'],
      ['clean', '<Grow as="li" fit>f</Grow>'],
      ['clean', '<Row gap="g4" align="a-start" justify="j-between" wrap inline className="x">g</Row>'],
      // Столкновение имён: `align` — легальный HTML-атрибут у `td`, и НАША ось
      // обязана победить. Ровно эта строка пиньет `Omit` в `Poly`: мутация «снять
      // Omit» роняет её с TS2322 «not assignable to type never».
      ['clean', '<Row as="td" align="a-start" colSpan={2}>h</Row>'],
      ['error', '<Row gap="g9">1</Row>'],
      ['error', '<Row gap="g5">2</Row>'],   // дефолт невыразим по построению
      ['error', '<Row align="a-end">3</Row>'],       // ось ряда, не колонки
      ['error', '<Col align="a-baseline">4</Col>'],  // ось колонки, не ряда
      ['error', '<Grid gap="g1">5</Grid>'],          // ступени нет в CSS
      ['error', '<Grid cols="3">6</Grid>'],
      ['error', '<Grow fit="yes">7</Grow>'],
      // ⚠️ ЭТА СТРОКА — ДАТЧИК СЛЕПОТЫ САМОЙ ПРОБЫ. `href` не бывает у `div`,
      // поэтому она обязана краснеть; на сломанном конфиге (React-типы = `any`)
      // она проезжала, и ровно по ней слепота и была поймана.
      ['error', '<Row as="div" href="/x">8</Row>'],
    ];
    const head = ["// @ts-check", "import { Row, Col, Grid, Trunc, Grow } from '@/design/Layout';", 'export const P = () => (<>'];
    const src = [...head, ...LINES.map(([, jsx]) => jsx), '</>);'].join('\n');
    writeFileSync(join(dir, 'probe.jsx'), src);

    const r = spawnSync('npx', ['tsc', '-p', join(dir, 'tsconfig.json')], { cwd: repo, encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    const bad = new Set([...out.matchAll(/probe\.jsx\((\d+),/g)].map((m) => Number(m[1])));

    LINES.forEach(([kind, jsx], i) => {
      const line = head.length + i + 1;
      if (kind === 'clean') assert.equal(bad.has(line), false, `должно быть ЧИСТО, а tsc ругается: ${jsx}\n${out}`);
      else assert.equal(bad.has(line), true, `ось не закрыта — tsc МОЛЧИТ на: ${jsx}\n${out}`);
    });
    // Защита от инертности: если tsc не запустился, «ошибок нет» = все clean
    // прошли, а все error провалились. Но пусть скажет прямо.
    assert.ok(bad.size > 0, `tsc не выдал НИ ОДНОЙ ошибки — прогон не состоялся:\n${out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
