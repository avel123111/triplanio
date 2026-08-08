#!/usr/bin/env node
/**
 * Тесты CI-гарда 2q (scripts/ci/check-design-axes.mjs) — оси канон-объекта,
 * TRIP-364.
 *
 * Шаблон тот же, что у 2l/2o/2p: одноразовое дерево во временной папке, гард
 * запускается ПОДПРОЦЕССОМ из её корня, проверяется код выхода. Git тут не
 * нужен — 2q сверяет три источника фактов на HEAD и с базой не разговаривает.
 *
 * ★ Каждое поведение пинится ОТДЕЛЬНОЙ фикстурой: зелёный тест ничего не значит,
 * пока не увидел его красным. Гард был зелёным на реальном репо с первого
 * прогона, и это ровно то состояние, в котором «проверено, чисто» неотличимо от
 * «не проверено ничего».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-design-axes.mjs', import.meta.url));

/** Каталог-минимум: ряд с одной осью «зазор» (значения g1/g2, дефолт g5). */
const CATALOG = {
  families: { row: 'canon', btn: 'canon', te: 'triage' },
  axes: { row: { зазор: { значения: ['g1', 'g2'], дефолт: 'g5' } } },
};

function fixture(t, files, catalog = CATALOG) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2q-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (p, body) => {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  put('src/design/catalog.json', JSON.stringify(catalog, null, 2));
  for (const [p, body] of Object.entries(files)) put(p, body);
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const LADDER = '.row { gap: 10px; }\n.row--g1 { gap: 2px; }\n.row--g2 { gap: 4px; }\n';

/* ───────────── обрубок составного имени и периметр эпика (TRIP-364 PR-G) ───────────── */

test('★★★ C · ОБРУБОК составного имени — не класс, а шаблон: не краснеет', (t) => {
  // `` `row row--${gap}` `` оставляет в разметке токен `row--` с ПУСТЫМ хвостом
  // (регулярка пробега тянет дефис), и C печатала про него `значения нет ни на
  // одной оси … элемент МОЛЧА получит дефолт`. Это ЛОЖНОЕ сообщение: класса
  // `row--` в DOM нет и быть не может. Ложь тут хуже пропуска - она посылает
  // следующего чинить не то, и именно она заблокировала шесть семей с
  // рантайм-именами (btn/badge/tile/sev/avatar/dlg), то есть все оставшиеся.
  const dir = fixture(t, { 'src/a.css': LADDER, 'src/a.jsx': 'const c = `row row--${gap}`;\n' });
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
  assert.match(out, /составных имён \(C не видит\): 1/);
  // ★ И «сверено» обязано остаться НУЛЁМ: обрубок не проверен, а пропущен.
  // Без этой строки перенос `checkedUses += 1` ВЫШЕ пропуска не ловился ничем -
  // счётчик врал бы, что обрубок сверен, а это ровно то враньё, против которого
  // и заведено отдельное число. Нашёл `code-simplifier`, не мой мутационный
  // проход: я ломал сам пропуск и ни разу его СЧЁТЧИК.
  assert.match(out, /имён в разметке 0/);
});

test('★★★ C · разметка ВНЕ ПЕРИМЕТРА эпика не судится', (t) => {
  // §10: лендинг и вход не трогаем до фазы 10, и `audit-design.mjs` объявляет
  // это предикатом OUT_OF_SCOPE. У 2q такого предиката не было, поэтому он судил
  // разметку, которую эпик из периметра ИСКЛЮЧИЛ: `btn--lg`/`btn--white`
  // (LandingPage, PublicTrip) и `card--wide` краснели как несуществующие, хотя
  // правило у них есть - в `public/landing.css`, инжектируемом рантаймом.
  const dir = fixture(t, {
    'src/a.css': LADDER,
    'src/pages/Landing/LandingPage.jsx': 'const x = "row row--g9";\n',
    'src/pages/PublicTrip.jsx': 'const y = "row row--g9";\n',
  });
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
  assert.match(out, /вне периметра эпика: 2/);
});

test('★ C · тот же несуществующий класс В ПЕРИМЕТРЕ по-прежнему красный', (t) => {
  // Парный к предыдущему: предикат обязан снимать наблюдение с ЛЕНДИНГА, а не
  // с проверки вообще. Без этой пары «зелёный» выше не отличим от снятой сверки.
  const dir = fixture(t, { 'src/a.css': LADDER, 'src/pages/TripView.jsx': 'const x = "row row--g9";\n' });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /row--g9 в разметке/);
});

/* ─────────── дефолт: один голос, и он не может стоять в apart ─────────── */

test('★★ дефолт, объявленный ЕЩЁ И в apart, — код 2 (каталог неудовлетворим)', (t) => {
  // apart требует, чтобы правило СУЩЕСТВОВАЛО; дефолт требует, чтобы его НЕ
  // было. Обе проверки в B, обе про один класс, друг другу противоречат - это
  // структурная ошибка каталога, а не вердикт по коду. До TRIP-364 PR-G такой
  // каталог принимался, а A при нём МОЛЧАЛА (`known` истинно через apart).
  const dir = fixture(
    t,
    { 'src/a.css': LADDER },
    { ...CATALOG, apart: { row: { g5: 'и дефолт, и исключение разом' } } },
  );
  const { code, out } = run(dir);
  assert.equal(code, 2, out);
  assert.match(out, /дефолт .* и в apart|apart .* дефолт/);
});

test('★★ класс под дефолт называется РОВНО ОДИН раз, а не двумя сверками', (t) => {
  // A и B печатали один и тот же дефект двумя строками, вдвое раздувая счётчик
  // расхождений. Цикл дефолтов в B снят как поглощённый веткой в A (у A и
  // формулировка точнее), а случай «дефолт ещё и в apart», который один только
  // и держал этот цикл, закрыт структурной проверкой выше.
  const dir = fixture(t, { 'src/a.css': `${LADDER}.row--g5 { gap: 10px; }\n` });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.equal(out.match(/row--g5/g).length, 1, `дефект назван больше одного раза:\n${out}`);
  assert.match(out, /расхождений 1\./);
});

/* ───────────────────────── ЖИВОЙ репозиторий ───────────────────────── */

test('★★ объявленные оси сходятся с ЖИВЫМ репо, а не только с фикстурами', (t) => {
  // Фикстуры пинят ПОВЕДЕНИЕ гарда; этот тест пинит СОДЕРЖАНИЕ каталога. Оси -
  // утверждение о реальном коде («у toast ровно четыре тона»), и утверждение
  // имеет цену, только пока кто-то его проверяет: правка app.css или карты
  // компонента в соседнем PR расходится с каталогом молча, а `npm test` про это
  // молчал бы до самого CI. Тест дешёвый - гард не запускает сборку (0.7 с).
  //
  // ★★★ ЧИСЛА В АССЕРТЕ - НЕ УКРАШЕНИЕ, А ВЕСЬ ТЕСТ. Первая редакция проверяла
  // только `code === 0`, и это был ЗЕЛЁНЫЙ ПРОГОН НАД ПУСТОЙ КОМНАТОЙ этажом
  // выше самого гарда: у 2q есть законный выход 0 «ни одна семья не объявила
  // оси - сверять нечего», поэтому удаление ключа `axes` целиком ИЛИ одного
  // `axes.toast` (то есть всего содержания вводящего PR) оставляло все тесты
  // зелёными. Замерено обеими правками, а не выведено. Мутации по ГАРДУ этого
  // не ловят по построению - ловит только мутация по КАТАЛОГУ.
  // Цена: каждая следующая семья обновляет эту строку. Это и есть храповик -
  // ровно та цена, на которой стоит остальной эпик, и она видна в диффе.
  const repo = fileURLToPath(new URL('../..', import.meta.url));
  const { code, out } = run(repo);
  assert.equal(code, 0, out);
  assert.match(out, /семей с осями: 5 · осей: 12 · значений: 39/, 'состав осей разошёлся с каталогом');
  assert.match(out, /оси, CSS и разметка сходятся/);
});

/* ───────────────────────── согласованное состояние ───────────────────────── */

test('оси, CSS и разметка сходятся — зелёный, и он это НАЗЫВАЕТ', (t) => {
  const dir = fixture(t, { 'src/a.css': LADDER, 'src/a.jsx': 'const x = "row row--g1";\n' });
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
  assert.match(out, /сходятся/);
});

/* ─────────────────────────── A · CSS → каталог ─────────────────────────── */

test('A · новое обличье в CSS вне объявленных осей — красный', (t) => {
  // Ровно то, что 2m пропускает: новое имя ВНУТРИ существующего семейства.
  const dir = fixture(t, { 'src/a.css': `${LADDER}.row--cozy { gap: 3px; }\n` });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /A · .*\.row--cozy — обличье вне объявленных осей/);
});

test('A · класс под ДЕФОЛТ оси — красный (no-op, который врёт)', (t) => {
  const dir = fixture(t, { 'src/a.css': `${LADDER}.row--g5 { gap: 10px; }\n` });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /ДЕФОЛТ оси «зазор»/);
});

test('A · семья БЕЗ объявленных осей не проверяется вовсе', (t) => {
  // Вход под жёсткую проверку добровольный и поштучный: разбор обличий на оси —
  // содержательное решение по каждому объекту, а гард обязан приехать раньше.
  const dir = fixture(t, { 'src/a.css': `${LADDER}.btn--whatever { color: red; }\n` });
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
});

test('A · обличье в apart не краснеет, но печатается числом', (t) => {
  const dir = fixture(
    t,
    { 'src/a.css': `${LADDER}.row--div { padding: 13px 0; }\n` },
    { ...CATALOG, apart: { row: { div: 'строка списка с разделителем, разбирается в 08' } } },
  );
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
  assert.match(out, /apart, ждут разбора\): 1/);
});

/* ─────────────────────────── B · каталог → CSS ─────────────────────────── */

test('B · объявленное значение без правила — красный (каталог врёт)', (t) => {
  const dir = fixture(t, { 'src/a.css': '.row { gap: 10px; }\n.row--g1 { gap: 2px; }\n' });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /B · ось «зазор» объявляет row--g2, а правила \.row--g2 нет/);
});

test('★ B · класс, упомянутый ТОЛЬКО в комментарии CSS, не считается существующим', (t) => {
  // Грабля `--sp-9` на полу 2o: в app.css есть комментарий про выпиленные
  // ступени, и наивный греп находит в нём `.row--g2` как «объявленный».
  // ★ Комментарий стоит ПЕРЕД правилом — так он и стоит в app.css, и только так
  // фикстура различает: разбор берёт селектор как `[^{}]+` до `{`, поэтому
  // комментарий перед правилом ПОПАДАЕТ в захват селектора, а после последнего
  // правила — нет. Первая проба ставила его в конец файла и была зелёной при
  // снятой очистке комментариев, то есть мутацию не ловила.
  const dir = fixture(t, {
    'src/a.css': '.row { gap: 10px; }\n/* выпилен .row--g2 — ноль вызовов */\n.row--g1 { gap: 2px; }\n',
  });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /правила \.row--g2 нет/);
});

test('★★ A · правило СРАЗУ ЗА `@import` не исчезает из наблюдения', (t) => {
  // Захват селектора начинается за предыдущим `}`, поэтому бесблочное at-правило
  // въезжает в него целиком и `startsWith('@')` выбрасывал СЛЕДУЮЩЕЕ правило.
  // Это не гипотеза: `@import './design/fonts.css';` - первая строка index.css.
  const dir = fixture(t, { 'src/a.css': `@import url("fonts.css");\n.row--cozy { gap: 3px; }\n${LADDER}` });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /\.row--cozy — обличье вне объявленных осей/);
});

test('★ место называется строкой САМОГО класса, а не началом матча', (t) => {
  // Весь вывод гарда - «сходи посмотри на эту строку». Отсчёт от начала матча
  // съедает перевод строки после предыдущего `}` и погашенный комментарий перед
  // правилом, поэтому адрес уезжает вверх - на app.css на десятки строк.
  const dir = fixture(t, {
    'src/a.css': `${LADDER}\n/* многострочный\n   комментарий\n   про ряд */\n.row--cozy { gap: 3px; }\n`,
  });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /src\/a\.css:8 {2}\.row--cozy/);
});

/* ───────────────────────── C · разметка → каталог ───────────────────────── */

test('★★ C · несуществующая ступень в разметке — КРАСНЫЙ, а не тишина', (t) => {
  // Половинчатая лестница молчалива: класса нет, элемент получает дефолт, и об
  // этом не узнаёт никто. Выстрелило дважды и оба раза ловилось замером в
  // браузере. Это главный тест файла.
  const dir = fixture(t, { 'src/a.css': LADDER, 'src/a.jsx': 'const x = "row row--g3";\n' });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /C · .*row--g3 в разметке — значения нет ни на одной оси row/);
  assert.match(out, /МОЛЧА получит дефолт/);
});

test('C · дефолт, написанный в разметке, — красный с внятной причиной', (t) => {
  const dir = fixture(t, { 'src/a.css': LADDER, 'src/a.jsx': 'const x = "row row--g5";\n' });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /класса нет и не будет, элемент и так его получает/);
});

test('★★ C · хвост ЧУЖОГО семейства не читается как обличье (te-row--plan)', (t) => {
  // Предикат по подстроке назвал шесть чужих классов обличьями ряда на первом
  // же прогоне — `te-row--plan`, `doc-row--ai`, `sheet-row--danger`. Пробег
  // обязан быть МАКСИМАЛЬНЫМ, иначе гард краснеет на чужой семье.
  const dir = fixture(t, {
    'src/a.css': `${LADDER}.te-row--plan { color: red; }\n`,
    'src/a.jsx': 'const x = "te-row te-row--plan";\n',
  });
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
});

test('★ C · комментарий в разметке — не вызов', (t) => {
  const dir = fixture(t, {
    'src/a.css': LADDER,
    'src/a.jsx': '// тут был row--g3, его выпилили\n/* и row--g4 тоже */\nconst x = "row";\n',
  });
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
});

test('★ C · protocol-relative URL не съедает остаток строки', (t) => {
  // Дыра, которую тест поймал у 2l: `//cdn…` читался как начало комментария и
  // гасил то, что стояло за ним на той же строке.
  const dir = fixture(t, {
    'src/a.css': LADDER,
    'src/a.jsx': 'const s = "//cdn.example.com/x.png"; const bad = "row--g3";\n',
  });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /row--g3 в разметке/);
});

/* ──────────── структурные ошибки каталога — код 2, а не вердикт ──────────── */

test('оси у семьи не canon — код 2', (t) => {
  const dir = fixture(t, { 'src/a.css': LADDER }, { ...CATALOG, axes: { te: { ось: { значения: ['x'] } } } });
  const { code, out } = run(dir);
  assert.equal(code, 2, out);
  assert.match(out, /статусом "triage"/);
});

test('один хвост в двух осях — код 2 (обличье не может принадлежать двум)', (t) => {
  const dir = fixture(
    t,
    { 'src/a.css': LADDER },
    { ...CATALOG, axes: { row: { зазор: { значения: ['g1'] }, другая: { значения: ['g1'] } } } },
  );
  const { code, out } = run(dir);
  assert.equal(code, 2, out);
  assert.match(out, /объявлен и в оси/);
});

test('ось с пустым списком значений — код 2', (t) => {
  const dir = fixture(t, { 'src/a.css': LADDER }, { ...CATALOG, axes: { row: { зазор: { значения: [] } } } });
  const { code, out } = run(dir);
  assert.equal(code, 2, out);
  assert.match(out, /ось без значений не ось/);
});

test('дефолт, стоящий и в значениях своей оси, — код 2', (t) => {
  const dir = fixture(
    t,
    { 'src/a.css': LADDER },
    { ...CATALOG, axes: { row: { зазор: { значения: ['g1', 'g2'], дефолт: 'g2' } } } },
  );
  const { code, out } = run(dir);
  assert.equal(code, 2, out);
  assert.match(out, /дефолт это то, чего класс НЕ имеет/);
});

test('хвост и в apart, и в оси — код 2', (t) => {
  const dir = fixture(t, { 'src/a.css': LADDER }, { ...CATALOG, apart: { row: { g1: 'зачем-то' } } });
  const { code, out } = run(dir);
  assert.equal(code, 2, out);
  assert.match(out, /и значением оси .*, и в apart/);
});

test('apart без axes — код 2 (исключения без правил, из которых исключают)', (t) => {
  const dir = fixture(t, { 'src/a.css': LADDER }, { ...CATALOG, apart: { btn: { x: 'что-то' } } });
  const { code, out } = run(dir);
  assert.equal(code, 2, out);
  assert.match(out, /apart объявлен без axes/);
});

test('★ каталог не читается — код 2, а не зелёный над пустой комнатой', (t) => {
  const dir = fixture(t, { 'src/a.css': LADDER });
  writeFileSync(join(dir, 'src/design/catalog.json'), '{ это не json');
  const { code, out } = run(dir);
  assert.equal(code, 2, out);
  assert.match(out, /не читается/);
});

test('★ периметр без единого .css — код 2, а не «OK»', (t) => {
  // «Нечего проверять» и «проверено, чисто» не должны печатать один вердикт.
  const dir = fixture(t, { 'src/a.jsx': 'const x = "row row--g1";\n' });
  const { code, out } = run(dir);
  assert.equal(code, 2, out);
  assert.match(out, /периметр скана пуст/);
});

test('★ осей не объявил никто — зелёный, но СЛОВАМИ, а не «сходятся»', (t) => {
  const dir = fixture(t, { 'src/a.css': LADDER }, { families: { row: 'canon' } });
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
  assert.match(out, /сверять нечего/);
});

test('★★ B · ПОТОМКОВОЕ вхождение не доказывает, что ступень существует', (t) => {
  // `.te-x .row--g1 {}` упоминает имя, но НЕ стилизует ряд: базового правила нет,
  // и элемент с классом `row--g1` вне `.te-x` молча получит дефолт. Пока B
  // считала по любому вхождению, это была зелёная тишина — ровно та, ради
  // которой гард написан. Нашёл `code-simplifier` прогоном.
  const dir = fixture(t, { 'src/a.css': '.row { gap: 10px; }\n.row--g2 { gap: 4px; }\n.te-x .row--g1 { gap: 2px; }\n' });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /объявляет row--g1, а правила \.row--g1 нет/);
});

test('★ B · apart тоже обещает существующее, иначе «ждут разбора» — фикция', (t) => {
  const dir = fixture(t, { 'src/a.css': LADDER }, { ...CATALOG, apart: { row: { ghost: 'обещали и не завели' } } });
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /apart числит row--ghost/);
});

/* ─────────── форма «тон с дефолтом, у которого класса нет» (toast) ─────────── */

/** Каталог формы toast: одна ось «тон», дефолт БЕЗ класса. Значения доказаны
 *  только потомковыми правилами ВЕДУЩЕГО класса (`.toast--error .tic`) - сам
 *  элемент этими правилами не стилизуется, красит он значок.
 *
 *  ⚠ Зелёная половина этой формы тестом НЕ пинится, и это осознанно: мутации,
 *  которая уронила бы её и НЕ уронила бы `★★★ B · обличье, объявленное ВЕДУЩИМ
 *  классом` (:340) или `A · новое обличье` (:66), не существует - искали двумя
 *  независимыми проходами. Такой тест читается как покрытие, не будучи им.
 *  Согласованность живого toast держит тест «ЖИВОЙ репо» выше.
 *
 *  ⚠ ГРАНИЦА, которую не закрывает ни один тест: 2q проверяет, что класса под
 *  дефолт НЕ СУЩЕСТВУЕТ, но НЕ может проверить, что нейтральный тон кто-то
 *  РИСУЕТ. Семья вправе объявить `дефолт: "neutral"` при отсутствующей базе, и
 *  гард останется зелёным. Базу `.toast .tic` удостоверяет человек, читающий
 *  app.css:4384, и больше никто. Первая строка `TONE_CSS` ниже поэтому
 *  ДОКУМЕНТАЦИЯ, а не покрытие: гард читает только ИМЕНА классов и ни одного
 *  объявления, так что её удаление не меняет ни одного вердикта. */
const TONE = {
  families: { toast: 'canon' },
  axes: { toast: { тон: { значения: ['success', 'error'], дефолт: 'neutral' } } },
};
const TONE_CSS = '.toast .tic { background: var(--ink-2); }\n'
  + '.toast--success .tic { background: var(--success); }\n'
  + '.toast--error .tic { background: var(--danger); }\n';

test('★★★ форма «тон»: КЛАСС-NO-OP ДЕФОЛТА в карте компонента — красный', (t) => {
  // Первый улов 2q на живом коде: `toast--neutral` стоял в карте вариантов
  // `src/components/ui/toast.jsx`, правила у него не было НИГДЕ в репо, и он
  // молча приезжал в DOM, читаясь как «здесь особый тон». Это и есть ответ на
  // вопрос, зачем сверка C: ни A, ни B такой класс не видят - в CSS его нет.
  const dir = fixture(
    t,
    { 'src/a.css': TONE_CSS, 'src/t.jsx': 'const m = { default: "toast--neutral" };\n' },
    TONE,
  );
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /C · .*toast--neutral в разметке — это ДЕФОЛТ оси «тон»/);
  assert.match(out, /класса нет и не будет, элемент и так его получает/);
});

test('★★★ B · обличье, объявленное ВЕДУЩИМ классом, существует по-настоящему', (t) => {
  // `.toast--error .tic {}` и `.card--danger > .sev {}` не стилизуют сам элемент,
  // но работают ВЕЗДЕ, где стоит этот класс, - обличье настоящее. Требование
  // «селектор из одной части» красило их несуществующими (5 ложных краснот,
  // замерено пробным каталогом). Отличие от `.te-x .row--g1`: там класс НЕ
  // ведущий, то есть обусловлен предком и снаружи молча даёт дефолт.
  const dir = fixture(
    t,
    { 'src/a.css': '.row { gap: 10px; }\n.row--g1 .ic { color: red; }\n.row--g2 > .x { color: blue; }\n' },
    CATALOG,
  );
  const { code, out } = run(dir);
  assert.equal(code, 0, out);
});
