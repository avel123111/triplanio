#!/usr/bin/env node
/**
 * Тесты яруса SPACING в scripts/check-design-tokens.mjs (TRIP-339).
 *
 * ЗАЧЕМ. Эпик TRIP-337 §9: «каждый новый гард едет со своим тестом», и 2l уехал
 * зелёным с тремя обходами именно потому, что теста не было. У самого
 * check-design-tokens.mjs тестов не было ни на один из четырёх прежних ярусов —
 * этот файл заводит их для пятого и служит точкой роста для остальных.
 *
 * ЧТО ИМЕННО ПИНИТСЯ. Ярус SPACING устроен как мультимножество по РЕПОЗИТОРИЮ,
 * а не счётчик по файлу, и каждое следствие этого выбора — отдельная фикстура:
 *
 *   перенос правила между файлами            → зелёный   (ради этого репо-область)
 *   схлопывание двух правил в одно           → зелёный
 *   сырое → var(--sp-N)                      → зелёный
 *   новая величина                           → КРАСНЫЙ
 *   прогон 11px → 12px                       → КРАСНЫЙ   (сумма та же!)
 *
 * Плюс сам предикат: shorthand позначенно, отрицательное отдельной величиной,
 * ноль не в счёт, px в calc() и в фолбэке var() считается, `grid-gap` не ловится,
 * комментарий не считается, инлайны в JSX не наши (их держит 2l).
 *
 * ★ ЗЕЛЁНЫЙ ТЕСТ НИЧЕГО НЕ ЗНАЧИТ, ПОКА НЕ УВИДЕЛ ЕГО КРАСНЫМ. Прогнаны девять
 * мутаций, и каждая свалила ИМЕННО тот тест, который её называет:
 *   1. shorthand считается одной единицей          → «shorthand позначенно»
 *   2. ноль считается ступенью                     → «ноль не считается»
 *   3. знак отброшен, -8px = 8px                   → «отрицательное отдельно»
 *   4. комментарии гасятся без сохранения длины    → «многострочный комментарий»
 *   5. база собирается по именам файлов HEAD       → «переименованный файл»
 *   6. настоящий пофайловый храповик               → «перенос между файлами»
 *   7. строка считается от НАЧАЛА МАТЧА, а не от   → «свойство в нулевой
 *      имени свойства                                 колонке»
 *   8. база спрашивает у git только ROOT           → «базовая сторона видит те
 *      (без SCAN_EXTRA)                                же пути, что и HEAD»
 *   9. виноватыми зовутся все файлы с величиной,   → «отчёт называет файл, где
 *      а не те, где счётчик поднялся                  величина прибавилась»
 *
 * ★★ Мутация 4 сначала НЕ ЛОВИЛАСЬ: тестов было 23 и все зелёные, потому что
 * во всех фикстурах маркер `design-token-exempt` стоял на первых строках файла,
 * где номеру строки некуда съезжать. Дыру нашла мутация, а не прогон — тест
 * «многострочный комментарий выше» дописан после неё. Это ровно тот случай,
 * ради которого мутации и гоняются: набор тестов был зелёным при инварианте,
 * который сам же и декларировал.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-design-tokens.mjs', import.meta.url));

/**
 * COLOR_WHITELIST читается ИЗ САМОГО ГАРДА, а не копируется сюда. Список — тоже
 * храповик, и у него есть правило «файла нет → строку удалить»: захардкоженная
 * копия разъехалась бы с оригиналом, и тесты SPACING начали бы падать по чужой
 * причине — самый неприятный вид ложной красноты.
 */
const colorWhitelist = () => {
  const src = readFileSync(GUARD, 'utf8');
  const block = src.match(/const COLOR_WHITELIST = \[([\s\S]*?)\n\];/)[1];
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
};

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/**
 * Минимальное дерево, на котором ЧЕТЫРЕ прежних яруса молчат, а пятый может
 * говорить. Без него любой тест SPACING падал бы на чужом ярусе:
 *   • каждый файл из COLOR_WHITELIST обязан существовать И нести сырой цвет —
 *     иначе срабатывают правила «stale» и «clean» и гард краснеет всегда;
 *   • public/site.css сканируется по имени, его отсутствие роняет чтение;
 *   • scripts/check-design-tokens.mjs обязан быть в БАЗЕ: по нему гард решает,
 *     достижим ли BASE_REF вообще.
 */
function scaffold(dir) {
  for (const f of colorWhitelist()) {
    put(dir, f, f.endsWith('.css') ? '.seed{color:#123456}\n' : "export const seed = '#123456';\n");
  }
  put(dir, 'scripts/check-design-tokens.mjs', '// stub — гард ищет себя на базе\n');
}

/** Репо с двумя коммитами: base → head. Возвращает каталог и sha базы. */
function fixture(t, { base = {}, head = {}, renames = {}, deletes = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'spacing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  scaffold(dir);
  put(dir, 'src/.keep', '');
  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const [from, to] of Object.entries(renames)) git(dir, ['mv', from, to]);
  for (const p of deletes) git(dir, ['rm', '-q', p]);
  for (const [p, body] of Object.entries(head)) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);

  return { dir, baseRef };
}

function run({ dir, baseRef }, { ref } = {}) {
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Секция SPACING из вывода — чтобы утверждать о ней, а не обо всём отчёте. */
const spacingSection = (out) => out.split('\nSPACING')[1]?.split('\n\n')[0] ?? '';

// ─────────────────────────── база: ходы из таблицы ───────────────────────────

test('одинаковые деревья → зелёный, и он это говорит', (t) => {
  const f = fixture(t, { base: { 'src/a.css': '.a{padding:13px}\n' }, head: {} });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.match(spacingSection(r.out), /ratchet intact/);
});

test('★ перенос правила МЕЖДУ ФАЙЛАМИ нейтрален — ради этого область репо, а не файл', (t) => {
  // Ровно то, чем заняты фазы 04–09: правило уезжает из экрана в базу.
  // Пофайловый счётчик покраснел бы на файле-приёмнике при каждом таком ходе.
  const f = fixture(t, {
    base: { 'src/screen.css': '.s{padding:13px}\n', 'src/base.css': '.b{margin:4px}\n' },
    head: { 'src/screen.css': '\n', 'src/base.css': '.b{margin:4px}\n.s{padding:13px}\n' },
  });
  const r = run(f);
  assert.equal(r.code, 0, r.out);
});

test('два правила схлопнулись в одно → вниз, зелёный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:13px}\n.b{padding:13px}\n' },
    head: { 'src/a.css': '.a,.b{padding:13px}\n' },
  });
  assert.equal(run(f).code, 0);
});

test('сырое значение заменено на var(--sp-N) → вниз, зелёный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{gap:12px}\n' },
    head: { 'src/a.css': '.a{gap:var(--sp-6)}\n' },
  });
  assert.equal(run(f).code, 0);
});

test('★ НОВАЯ величина → красный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:12px}\n' },
    head: { 'src/a.css': '.a{padding:12px}\n.b{padding:19px}\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /19px ×1 \(было ×0 — НОВАЯ величина\)/);
});

test('★ прогон 11px → 12px краснеет, хотя СУММА сырых не изменилась', (t) => {
  // §10 «никаких прогонов по значениям»: именно такой прогон сделал .checkbox
  // круглым (TRIP-321 Ф3b). Счётчик суммы этот ход пропустил бы — 2 и 2.
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:11px}\n.b{padding:12px}\n' },
    head: { 'src/a.css': '.a{padding:12px}\n.b{padding:12px}\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /12px ×2 \(было ×1\)/);
});

// ───────────────────────────── предикат ─────────────────────────────

test('shorthand разбирается ПОЗНАЧЕННО: правка второго значения видна', (t) => {
  // Если бы объявление считалось одной единицей, «8px 12px» → «8px 10px»
  // прошло бы незамеченным: деклараций как была одна, так и осталась.
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px 12px}\n.b{padding:10px}\n' },
    head: { 'src/a.css': '.a{padding:8px 10px}\n.b{padding:10px}\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /10px ×2 \(было ×1\)/);
});

test('отрицательное — ОТДЕЛЬНАЯ величина, смена знака не проходит', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{margin:8px}\n' },
    head: { 'src/a.css': '.a{margin:8px}\n.b{margin:-8px}\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /-8px ×1 \(было ×0 — НОВАЯ величина\)/);
});

test('ноль не считается: 0px не ступень и роли не несёт', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '.a{padding:8px}\n.b{padding:0px}\n.c{margin:0}\n' },
  });
  assert.equal(run(f).code, 0);
});

test('px внутри calc() считается — скобка не отмывает литерал', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '.a{padding:8px}\n.b{padding-bottom:calc(19px + 1em)}\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /19px/);
});

test('px в ФОЛБЭКЕ var(--x, 19px) считается — это тоже сырой литерал', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '.a{padding:8px}\n.b{padding:var(--hero,19px)}\n' },
  });
  assert.equal(run(f).code, 1);
});

test('grid-gap / scroll-padding НЕ ловятся — перед именем дефис, а не граница', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '.a{padding:8px}\n.b{grid-gap:19px;scroll-padding:21px}\n' },
  });
  assert.equal(run(f).code, 0);
});

test('longhand ловится, хотя начинается с имени shorthand-а', (t) => {
  // Альтернатива `padding` не должна съедать префикс `padding-inline-start`.
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '.a{padding:8px}\n.b{padding-inline-start:19px}\n' },
  });
  assert.equal(run(f).code, 1);
});

test('величина в КОММЕНТАРИИ не считается', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '/* было padding:19px, стало ступенью */\n.a{padding:8px}\n' },
  });
  assert.equal(run(f).code, 0);
});

test('инлайновый отступ в JSX не наш — его держит храповик 2l', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '.a{padding:8px}\n', 'src/X.jsx': 'export const X = () => <i style={{ padding: 19 }} />;\n' },
  });
  assert.equal(run(f).code, 0);
});

test('public/site.css вне периметра до подзадачи 10', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'public/site.css': '.seed{color:#123456}\n.l{padding:19px}\n' },
  });
  assert.equal(run(f).code, 0);
});

// ───────────────────────── escape и обвязка ─────────────────────────

test('design-token-exempt на строке снимает её со счёта', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '.a{padding:8px}\n.b{padding:19px} /* design-token-exempt: причина */\n' },
  });
  assert.equal(run(f).code, 0);
});

test('★ МНОГОСТРОЧНЫЙ комментарий выше не сбивает адрес строки у exempt', (t) => {
  // Тест, которого сначала не было, и его отсутствие поймала мутация, а не
  // прогон: гасить комментарии надо ПРОБЕЛАМИ ТОЙ ЖЕ ДЛИНЫ с сохранением
  // переводов строк. Схлопни комментарий в один пробел — номер строки уедет
  // вверх, маркер начнут искать на чужой строке, и работающий escape-люк
  // молча перестанет работать. Все прочие фикстуры этого не видят: у них
  // маркер стоит на первых строках файла, куда съезжать некуда.
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: {
      'src/a.css': '.a{padding:8px}\n'
        + '/* причина в три строки,\n   чтобы номер строки\n   было куда сдвинуть */\n'
        + '.b{padding:19px} /* design-token-exempt: причина */\n',
    },
  });
  assert.equal(run(f).code, 0, 'exempt обязан сработать под многострочным комментарием');
});

test('★ свойство в НУЛЕВОЙ КОЛОНКЕ не сбивает адрес строки у exempt', (t) => {
  // Вторая половина той же дыры, что и мутация 4, только с другого конца.
  // Матч объявления СЪЕДАЕТ граничный символ `[;{\s]`, и когда свойство стоит
  // в нулевой колонке, этим символом оказывается сам перевод строки: отсчёт от
  // начала матча дал бы строку ВЫШЕ, маркер искали бы на строке `{`, и
  // работающий escape-люк молча перестал бы работать. Отсчёт идёт от имени
  // свойства. Все прочие фикстуры этого не видят: у них объявление либо с
  // отступом, либо на одной строке с селектором.
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '.a{padding:8px}\n.b{\npadding:19px /* design-token-exempt: причина */\n}\n' },
  });
  assert.equal(run(f).code, 0, 'exempt обязан сработать у свойства в нулевой колонке');
});

test('exempt на ДРУГОЙ строке не покрывает — маркер построчный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:8px}\n' },
    head: { 'src/a.css': '/* design-token-exempt: причина */\n.a{padding:8px}\n.b{padding:19px}\n' },
  });
  assert.equal(run(f).code, 1);
});

test('★ ПЕРЕИМЕНОВАННЫЙ файл не читается как источник новых величин', (t) => {
  // База берётся списком файлов из дерева BASE_REF. Если бы она собиралась по
  // именам файлов HEAD, у переименованного файла база оказалась бы пустой и все
  // его значения посчитались бы новыми — красный на голом `git mv`.
  const f = fixture(t, {
    base: { 'src/old.css': '.a{padding:13px;margin:17px}\n' },
    renames: { 'src/old.css': 'src/new.css' },
  });
  assert.equal(run(f).code, 0);
});

test('удаление файла целиком — величины исчезли, это направление вниз', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:13px}\n', 'src/b.css': '.b{padding:17px}\n' },
    deletes: ['src/b.css'],
  });
  assert.equal(run(f).code, 0);
});

test('при переименовании ВЕРДИКТ чист, а в отчёте путь помечен новым — так и задумано', (t) => {
  // Названный шум, а не дефект (нашёл code-simplifier). Пути сопоставляются по
  // имени, поэтому в СПИСКЕ ВИНОВНЫХ переименованный файл выглядит новым. Виден
  // он только когда отчёт и без того красный от настоящего роста в другом
  // файле, и настоящий виновник стоит ВЫШЕ — сортировка по дельте. Тест
  // существует, чтобы это встречали как известное поведение, а не как загадку.
  const f = fixture(t, {
    base: { 'src/old.css': '.o{padding:12px}\n', 'src/b.css': '.b1{padding:12px}\n' },
    renames: { 'src/old.css': 'src/new.css' },
    head: { 'src/b.css': '.b1{padding:12px}\n.b2{padding:12px}\n' },   // настоящий +1
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  const lines = r.out.split('\n').filter((l) => /×\d+ \(было ×\d+/.test(l));
  assert.match(lines[1], /src\/b\.css/, 'настоящий виновник — первым');
  assert.match(lines[2], /src\/new\.css: ×1 \(было ×0 — путь новый\)/);
});

test('недостижимый BASE_REF — состав не сверяется, и вывод это ГОВОРИТ', (t) => {
  // «Нечего проверять» и «проверено, чисто» не должны читаться одинаково.
  const f = fixture(t, { base: { 'src/a.css': '.a{padding:13px}\n' } });
  const r = run(f, { ref: 'refs/heads/no-such-branch' });
  assert.match(spacingSection(r.out), /состав не сверялся/);
  assert.doesNotMatch(spacingSection(r.out), /ratchet intact/);
});

test('гард печатает ЧИСЛО от предиката, а не из ТЗ', (t) => {
  // TRIP-337 §12: три прогона дали три разных числа, потому что предикат не был
  // кодом. Число обязано приходить из измерения — и быть видно в отчёте.
  const f = fixture(t, { base: {}, head: { 'src/a.css': '.a{padding:8px 12px;margin:-4px}\n' } });
  const r = run(f);
  assert.match(spacingSection(r.out), /3 сырых значений отступа, 3 уникальных/);
});

test('★ отчёт называет ФАЙЛ, где величина прибавилась, а не случайные адреса', (t) => {
  // Нашёл Pavel на живом прогоне. Вердикт репозиторный, но плоская карта
  // «величина → адреса» на ЧАСТОЙ величине печатала шесть мест из ста
  // двенадцати, выбранных произвольно, — и ни одно не было тронуто тем PR.
  // Здесь 12px растёт в Б и убывает в А: суммарно рост, и назван обязан быть
  // ИМЕННО Б. Вердикт при этом остаётся репозиторным — см. соседний тест про
  // перенос между файлами, который по-прежнему зелёный.
  const f = fixture(t, {
    base: {
      'src/a.css': '.a1{padding:12px}\n.a2{padding:12px}\n.a3{padding:12px}\n',
      'src/b.css': '.b1{padding:12px}\n',
    },
    head: {
      'src/a.css': '.a1{padding:12px}\n.a2{padding:12px}\n',                     // 3 → 2
      'src/b.css': '.b1{padding:12px}\n.b2{padding:12px}\n.b3{padding:12px}\n',  // 1 → 3
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /12px ×5 \(было ×4\)/);
  assert.match(r.out, /src\/b\.css: ×3 \(было ×1\)/, 'назван обязан быть файл, где счётчик поднялся');
  assert.doesNotMatch(r.out, /src\/a\.css/, 'файл, где величина УБЫЛА, в отчёте не при чём');
});

test('★ базовая сторона видит ТЕ ЖЕ пути, что и HEAD — иначе периметр расширить нельзя', (t) => {
  // Нашёл code-simplifier. HEAD обходит `walk(src)` ПЛЮС SCAN_EXTRA, а база
  // берётся `git ls-tree`. Стоит спискам разъехаться — и файл, которого нет на
  // базовой стороне, читается «новым» ЦЕЛИКОМ. Это ждало бы подзадачу 10: она
  // всего лишь выводит site.css из SPACING_ALLOW, а гард отдал бы все её 30
  // величин как новые. Проверяем на файле ВНЕ `src`, который в периметре.
  const f = fixture(t, {
    base: { 'public/extra.css': '.e{padding:13px}\n' },
    head: { 'public/extra.css': '.e{padding:13px}\n' },
  });
  // Утверждаем о ДВУХ КОНСТРУКЦИЯХ, а не о числе вхождений пути: списки
  // исключений ярусов (SPACING_ALLOW и прочие) живут своей жизнью, и подзадача
  // 10 выведет site.css как раз оттуда — счётчик вхождений покраснел бы на
  // этом по ложной причине.
  const src = readFileSync(GUARD, 'utf8');
  assert.match(
    src, /const SCANNED = \[\.\.\.walk\(ROOT\), \.\.\.SCAN_EXTRA\]/,
    'HEAD-сторона обязана собираться из SCAN_EXTRA, а не из литерала',
  );
  assert.match(
    src, /'ls-tree'[^\n]*BASE_REF[^\n]*ROOT, \.\.\.SCAN_EXTRA/,
    'базовая сторона обязана спрашивать git ТЕ ЖЕ пути, что обходит HEAD',
  );
  assert.equal(run(f).code, 0);
});

test('★ сверка идёт ПО РЕПО: рост в одном файле не гасится падением в другом по ДРУГОЙ величине', (t) => {
  // Обратная сторона репо-области: она прощает перенос ОДНОЙ И ТОЙ ЖЕ величины,
  // но не размен «убрал 13, добавил 19» — иначе словарь не сокращался бы никогда.
  const f = fixture(t, {
    base: { 'src/a.css': '.a{padding:13px}\n', 'src/b.css': '.b{margin:4px}\n' },
    head: { 'src/a.css': '\n', 'src/b.css': '.b{margin:4px}\n.c{padding:19px}\n' },
  });
  assert.equal(run(f).code, 1);
});
