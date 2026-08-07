#!/usr/bin/env node
/**
 * Тесты CI-гарда 2p (scripts/ci/check-css-semantics.mjs) — ярус 2 визуального
 * гейта, TRIP-340 PR3.
 *
 * Шаблон взят у 2l/2o: одноразовый git-репо, коммит «база», коммит «HEAD»,
 * гард запускается ПОДПРОЦЕССОМ с BASE_REF на базовый коммит — то есть ровно
 * так, как его гоняет CI.
 *
 * ★ Каждое поведение пинится ОТДЕЛЬНОЙ фикстурой, потому что зелёный тест
 * ничего не значит, пока не увидел его красным. Первая редакция гарда читала
 * HEAD через `git show :<path>` — индекс, а не рабочее дерево — и молча
 * печатала «изменений нет» на любой незастейдженной правке; в CI (где всё
 * закоммичено) она выглядела бы полностью исправной. Поймано мутацией
 * `.checkbox gap: 9px → 17px`, прошедшей насквозь. Отсюда тест
 * `рабочее дерево, а не индекс`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-css-semantics.mjs', import.meta.url));

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

function fixture(t, { base = {}, head = {}, commitHead = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2p-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  put(dir, '.keep', '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const [p, body] of Object.entries(head)) put(dir, p, body);
  if (commitHead) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', 'head', '--allow-empty']);
  }
  return { dir, baseRef };
}

function run({ dir, baseRef }, { ref, args = [] } = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/* ───────────────────────── базовое поведение ───────────────────────── */

test('ничего не менялось — зелёный и НАЗЫВАЕТ это, а не молчит', (t) => {
  const css = '.btn { padding: 8px; }\n';
  const f = fixture(t, { base: { 'src/a.css': css }, head: {} });
  const { code, out } = run(f);
  assert.equal(code, 0);
  assert.match(out, /не изменились/);
});

test('изменение значения — красный, с классом и свойством в строке', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '.checkbox { gap: 17px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1);
  assert.match(out, /\.checkbox gap: 9px → 17px/);
});

test('★ перенос правила между файлами при том же значении — ЗЕЛЁНЫЙ', (t) => {
  // Это главный инвариант: фазы 04–09 переносят правила в общие классы. Гард,
  // красный на каждом правильном ходе, будет выключен — и тогда он не поймает
  // ничего вообще.
  const f = fixture(t, {
    base: { 'src/design/app.css': '.trunc { overflow: hidden; }\n', 'src/b.css': '' },
    head: { 'src/design/app.css': '', 'src/b.css': '.trunc { overflow: hidden; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★ косметическая перезапись селектора — НЕ изменение (единица наблюдения = КЛАСС)', (t) => {
  // Вторая половина того же решения, что и тест выше: ключ строится по КЛАССУ, а
  // не по тексту правила. Порядок классов в составном селекторе и пробелы вокруг
  // комбинатора на рендер не влияют ВООБЩЕ, но текст селектора меняют — гард,
  // ключующийся на тексте, краснел бы на чистом форматировании, а красный на
  // правильном ходе гард выключают. Мутация «ключевать целым селектором» проходит
  // все остальные 47 фикстур насквозь и валится только на этой.
  const f = fixture(t, {
    base: { 'src/a.css': '.a.b { gap: 1px; }\n.x>.y { padding: 2px; }\n' },
    head: { 'src/a.css': '.b.a { gap: 1px; }\n.x > .y { padding: 2px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('удаление правила — красный (минус тоже изменение)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.card { border-radius: 20px; }\n' },
    head: { 'src/a.css': '' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1);
  assert.match(out, /\.card border-radius/);
});

/* ─────────────────── ключ: состояние и media отдельно ─────────────────── */

test('★ :hover не вытесняет базовое значение — состояние это часть ключа', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.btn { gap: 9px; }\n' },
    head: { 'src/a.css': '.btn { gap: 9px; }\n.btn:hover { gap: 99px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1);
  assert.match(out, /\.btn:hover gap/);
  // База не тронута: про `.btn gap` без состояния строки быть не должно.
  assert.doesNotMatch(out, /\n\s+\.btn gap/);
});

test('★ @media — отдельный контекст, мобильное значение не схлопывается с базой', (t) => {
  // ★ Меняется ДЕСКТОПНОЕ значение, а мобильное правило стоит НИЖЕ в файле и
  // при той же специфичности перекрыло бы его. Если media выкинуть из ключа,
  // победителем с обеих сторон окажется 4px, правка 8px→10px станет НЕВИДИМОЙ
  // и гард напечатает «чисто». Прежняя редакция этого теста меняла мобильное
  // значение и оставалась зелёной при выкинутом media — то есть пиннила не то.
  const f = fixture(t, {
    base: { 'src/a.css': '.x { padding: 8px; }\n@media (max-width: 640px) { .x { padding: 4px; } }\n' },
    head: { 'src/a.css': '.x { padding: 10px; }\n@media (max-width: 640px) { .x { padding: 4px; } }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /padding: 8px → 10px/);
});

/* ──────────────────────────── каскад и вес ──────────────────────────── */

test('!important побеждает более специфичный селектор', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a.b { color: red; }\n.a { color: blue !important; }\n' },
    head: { 'src/a.css': '.a.b { color: red; }\n.a { color: green !important; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1);
  assert.match(out, /color: blue → green/);
});

/* ───────────────────── «нечего проверять» ≠ «чисто» ───────────────────── */

test('недостижимая база — код 2, а не зелёный', (t) => {
  const f = fixture(t, { base: { 'src/a.css': '.x { gap: 1px; }\n' }, head: {} });
  const { code } = run(f, { ref: 'refs/heads/no-such-branch' });
  assert.equal(code, 2);
});

test('нераспознанный CSS — код 2, гард не печатает «чисто» по занижённому замеру', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.x { gap: 1px; }\n' },
    head: { 'src/a.css': '.x { gap: 1px;\n@media {{{\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 2, out);
});

test('неизвестный флаг отвергается — обновлять потолок нечем', (t) => {
  const f = fixture(t, { base: { 'src/a.css': '.x { gap: 1px; }\n' }, head: {} });
  const { code, out } = run(f, { args: ['--write'] });
  assert.equal(code, 2);
  assert.match(out, /visual-diff-exempt/);
});

/* ──────────────────────────── escape-маркер ──────────────────────────── */

test('visual-diff-exempt на названный ключ пропускает намеренное изменение', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: .checkbox gap — ступень шкалы, апрув Pavel */\n.checkbox { gap: 12px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /изменение объявлено намеренным/);
});

test('★ маркер гасит РОВНО свой ключ — соседнее изменение продолжает блокировать', (t) => {
  // Та самая дыра TRIP-351: бланкетный `if (exempt) exit(0)` пропускал в этом
  // прогоне ВСЁ. Мутация «вернуть бланкетность» валит именно этот тест.
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n.card { padding: 4px; }\n' },
    head: {
      'src/a.css':
        '/* visual-diff-exempt: .checkbox gap — ступень шкалы, апрув Pavel */\n' +
        '.checkbox { gap: 12px; }\n.card { padding: 999px; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.card padding: 4px → 999px/);
  assert.doesNotMatch(out, /\n\s+\.checkbox gap: 9px → 12px/);
});

test('маркер на другое свойство не гасит — совпадать обязаны класс, состояние и свойство', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: .checkbox padding — не тот ключ */\n.checkbox { gap: 12px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /под маркером изменений нет/);
});

test('★ маркер на другой КЛАСС не гасит — иначе он бланкет по свойству', (t) => {
  // Класс — половина ключа, и без него маркер `.checkbox gap` тушил бы `gap` у
  // любого класса разом. Мутация «выкинуть сверку класса» валит только этот
  // тест: во всех остальных фикстурах класс совпадает, и они остаются зелёными.
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n.card { gap: 9px; }\n' },
    head: {
      'src/a.css': '/* visual-diff-exempt: .checkbox gap — ступень шкалы */\n.checkbox { gap: 12px; }\n.card { gap: 99px; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.card gap: 9px → 99px/);
});

test('★ маркер на базовое состояние не гасит :hover — ховер не прячется за базой', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.btn:hover { gap: 9px; }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: .btn gap — база */\n.btn:hover { gap: 12px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
});

test('★ маркер без @media НЕ гасит изменение внутри @media — мобильное называется отдельно', (t) => {
  // ★ Ровно та дыра, ради которой media попал в КЛЮЧ: мобильное правило стоит
  // ниже по файлу и прячет правку десктопного. Escape без media частично
  // возвращал бы её — автор объявляет «поменял padding у .x», а вместе с этим
  // молча проезжает правка того же свойства в самой узкой ветке вёрстки.
  const f = fixture(t, {
    base: { 'src/a.css': '@media (max-width: 640px) { .x { padding: 4px; } }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: .x padding — база */\n@media (max-width: 640px) { .x { padding: 9px; } }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /max-width: 640px.*padding: 4px → 9px/);
});

test('★ маркер С @media гасит ровно свою ветку — базовая правка того же свойства блокирует', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.x { padding: 8px; }\n@media (max-width: 640px) { .x { padding: 4px; } }\n' },
    head: {
      'src/a.css':
        '/* visual-diff-exempt: .x {@media (max-width: 640px)} padding — ступень шкалы на телефоне */\n' +
        '.x { padding: 10px; }\n@media (max-width: 640px) { .x { padding: 9px; } }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.x padding: 8px → 10px/); // база — блокирует
  assert.doesNotMatch(out, /padding: 4px → 9px/); // мобильная — объявлена
});

test('маркер на ДРУГОЙ media-запрос не гасит — сверяется сам запрос, а не «хоть какой-то»', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '@media (max-width: 640px) { .x { padding: 4px; } }\n' },
    head: {
      'src/a.css':
        '/* visual-diff-exempt: .x {@media (min-width: 900px)} padding — не та ветка */\n' +
        '@media (max-width: 640px) { .x { padding: 9px; } }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /под маркером изменений нет/);
});

test('пробелы внутри media-запроса маркера не значат ничего', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '@media (max-width: 640px) { .x { padding: 4px; } }\n' },
    head: {
      'src/a.css':
        '/* visual-diff-exempt: .x {@media (max-width:640px)} padding — ступень */\n' +
        '@media (max-width: 640px) { .x { padding: 9px; } }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('маркер на БАЗЕ не действует — исключение живёт ровно один PR', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '/* visual-diff-exempt: .checkbox gap — старое */\n.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: .checkbox gap — старое */\n.checkbox { gap: 12px; }\n' },
  });
  const { code } = run(f);
  assert.equal(code, 1);
});

test('неразобранный маркер — код 2, а не тихо-красный прогон', (t) => {
  // Свободный текст был ПРЕЖНИМ синтаксисом. Молчать про него нельзя: автор
  // считает маркер работающим, а PR краснеет по причине, которой нет в выводе.
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: ступень шкалы */\n.checkbox { gap: 12px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 2, out);
  assert.match(out, /не разобран/);
});

/* ─────────── visual-diff-move: перенос разметки ≠ удаление правила ─────────── */

test('★ объявленный перенос на класс с теми же значениями — ЗЕЛЁНЫЙ', (t) => {
  // Канонический ход фаз 04–06: класс отдаёт раскладку, разметка уезжает на
  // общий .grow--fit. Без маркера это неотличимо от сноса правила (≈380 правил
  // раскладки — гард был бы красным на каждом правильном ходе).
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { flex: 1; min-width: 0; }\n.grow--fit { flex: 1; min-width: 0; }\n' },
    head: { 'src/a.css': '/* visual-diff-move: brow__body -> grow--fit */\n.grow--fit { flex: 1; min-width: 0; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /перенос \.brow__body → \.grow--fit: объявлений 2/);
});

test('★ перенос СО СМЕНОЙ значения — красный, печатает «было → стало»', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { flex: 1; }\n.grow--fit { flex: 1; }\n' },
    head: { 'src/a.css': '/* visual-diff-move: brow__body -> grow--fit */\n.grow--fit { flex: 2; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.brow__body flex: 1 → 2 — перенос на \.grow--fit СО СМЕНОЙ значения/);
});

test('★ перенос на несуществующую цель — красный (иначе маркер = бланкет под другим именем)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { flex: 1; }\n' },
    head: { 'src/a.css': '/* visual-diff-move: brow__body -> grow--ftt */\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /у цели на HEAD нет ни одного объявления/);
});

test('★ цель есть, но НУЖНОГО объявления на ней нет — красный', (t) => {
  // Цель существует (значит, проверки «класс есть» мало): перенесли flex, а
  // min-width на цели никто не объявил — элемент потерял «разрешено ужаться».
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { flex: 1; min-width: 0; }\n.grow--fit { flex: 1; }\n' },
    head: { 'src/a.css': '/* visual-diff-move: brow__body -> grow--fit */\n.grow--fit { flex: 1; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /min-width: 0 — на \.grow--fit этого объявления нет/);
});

test('★ перенос на НОВЫЙ класс — плюсы на цели покрыты тем же маркером', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { flex: 1; }\n' },
    head: { 'src/a.css': '/* visual-diff-move: brow__body -> grow--fit */\n.grow--fit { flex: 1; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★ перенос НЕ гасит правку живой цели — у цели было другое значение', (t) => {
  // .grow--fit уже жил со своим flex:2 и его меняют на 1 «заодно с переносом».
  // Это правка ОБЩЕГО класса: она задевает всех, кто на нём уже сидит.
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { flex: 1; }\n.grow--fit { flex: 2; }\n' },
    head: { 'src/a.css': '/* visual-diff-move: brow__body -> grow--fit */\n.grow--fit { flex: 1; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.grow--fit flex: 2 → 1/);
});

test('★ перенос не гасит СОСЕДНЕЕ изменение — маркер точечный и здесь', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { flex: 1; }\n.grow--fit { flex: 1; }\n.card { padding: 4px; }\n' },
    head: {
      'src/a.css':
        '/* visual-diff-move: brow__body -> grow--fit */\n.grow--fit { flex: 1; }\n.card { padding: 999px; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.card padding: 4px → 999px/);
});

test('★ media и состояние переезжают вместе с объявлением', (t) => {
  // Мобильное значение источника обязано найтись на цели В ТОМ ЖЕ @media:
  // иначе «перенёс» означало бы «на телефоне пропало».
  const f = fixture(t, {
    base: {
      'src/a.css':
        '.brow__body { flex: 1; }\n@media (max-width: 640px) { .brow__body { flex: 3; } }\n' +
        '.grow--fit { flex: 1; }\n',
    },
    head: { 'src/a.css': '/* visual-diff-move: brow__body -> grow--fit */\n.grow--fit { flex: 1; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /max-width: 640px.*flex: 3 — на \.grow--fit этого объявления нет/);
});

test('★ НЕЗАКОММИЧЕННЫЙ маркер действует — иначе локально гард врёт про свой же вывод', (t) => {
  // Замер CSS берётся из рабочего дерева; если маркеры читать только из
  // коммитов, локальный прогон печатает красноту на правке, которую сам же
  // рядом и объявили. Ровно этот разъезд источников уже стоил гарду тихого
  // «изменений нет» (см. тест про индекс ниже).
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: .checkbox gap — ступень */\n.checkbox { gap: 12px; }\n' },
    commitHead: false,
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('маркер переноса на БАЗЕ не действует — как и exempt, живёт один PR', (t) => {
  const css = (extra) => `/* visual-diff-move: brow__body -> grow--fit */\n.grow--fit { flex: 1; }\n${extra}`;
  const f = fixture(t, {
    base: { 'src/a.css': css('.brow__body { flex: 1; }\n') },
    head: { 'src/a.css': css('') },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
});

/* ─────────── значения токенов: правило без класса тоже под наблюдением ───────────
 * TRIP-360. Гард ключевался на классе, а у `:root` класса нет — правка альфы в
 * семь раз проезжала зелёной, и не ловил её при этом НИ ОДИН гард репо.
 * Каждое поведение пинится своей фикстурой: мутация «вернуть `if (!cls.length)
 * continue`» обязана валить первые четыре теста и не трогать остальные.      */

test('★ смена ЗНАЧЕНИЯ токена в :root[data-theme=dark] — красный, с «было → стало»', (t) => {
  // Ровно воспроизведение из тикета: `background: var(--brand-soft)` у всех
  // потребителей побайтово одинаков с обеих сторон, поэтому увидеть правку
  // можно ТОЛЬКО на строке самого токена.
  const consumer = '.tile { background: var(--brand-soft); }\n';
  const f = fixture(t, {
    base: { 'src/a.css': `:root[data-theme="dark"] { --brand-soft: rgba(111,178,255,.14); }\n${consumer}` },
    head: { 'src/a.css': `:root[data-theme="dark"] { --brand-soft: rgba(111,178,255,.99); }\n${consumer}` },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /:root\[data-theme=dark\] --brand-soft: rgba\(111,178,255,\.14\) → rgba\(111,178,255,\.99\)/);
});

test('★ добавление имени в :root — красный (2o видит только СОСТАВ, значения не читает)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': ':root { --a: 1px; }\n' },
    head: { 'src/a.css': ':root { --a: 1px; --b: 2px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /:root --b: \+ 2px/);
});

test('★ удаление имени из :root — красный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': ':root { --a: 1px; --b: 2px; }\n' },
    head: { 'src/a.css': ':root { --a: 1px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /:root --b: − 2px/);
});

test('★ светлый и тёмный :root — РАЗНЫЕ единицы, правка одного не прячется за другим', (t) => {
  // Селектор целиком и есть ключ. Схлопни их в одну единицу — победит тот, что
  // ниже по файлу, и правка светлой темы станет невидимой.
  const f = fixture(t, {
    base: { 'src/a.css': ':root { --brand: #111; }\n:root[data-theme="dark"] { --brand: #eee; }\n' },
    head: { 'src/a.css': ':root { --brand: #222; }\n:root[data-theme="dark"] { --brand: #eee; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /:root --brand: #111 → #222/);
  assert.equal(out.match(/изменений: 1 /)?.length, 1); // тёмная ветка не задета
  assert.doesNotMatch(out, /:root\[data-theme=dark\] --brand:/);
});

test('★ островной словарь на КЛАССЕ (login.css .auth) — под наблюдением', (t) => {
  // Он был под наблюдением всегда (`.auth` — класс), и именно поэтому его надо
  // запинить: единица наблюдения переписана, и обратный ход обязан покраснеть.
  const f = fixture(t, {
    base: { 'src/pages/login.css': '.auth { --brand-soft: rgba(33,103,226,.08); }\n' },
    head: { 'src/pages/login.css': '.auth { --brand-soft: rgba(33,103,226,.99); }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.auth --brand-soft: rgba\(33,103,226,\.08\) → rgba\(33,103,226,\.99\)/);
});

test('★ visual-diff-exempt гасит РОВНО свой токен — соседний продолжает блокировать', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': ':root { --brand-soft: rgba(1,1,1,.14); --brand-soft-12: rgba(1,1,1,.24); }\n' },
    head: {
      'src/a.css':
        '/* visual-diff-exempt: :root --brand-soft — выравнивание тинта, апрув Pavel */\n' +
        ':root { --brand-soft: rgba(1,1,1,.99); --brand-soft-12: rgba(1,1,1,.88); }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /:root --brand-soft-12: rgba\(1,1,1,\.24\) → rgba\(1,1,1,\.88\)/);
  assert.doesNotMatch(out, /--brand-soft: rgba\(1,1,1,\.14\) → /);
  assert.match(out, /изменение объявлено намеренным/);
});

test('★ маркер на СВЕТЛЫЙ :root не гасит тёмный — селектор целиком часть ключа', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': ':root[data-theme="dark"] { --brand: #eee; }\n' },
    head: {
      'src/a.css': '/* visual-diff-exempt: :root --brand — не та ветка */\n:root[data-theme="dark"] { --brand: #fff; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /под маркером изменений нет/);
});

test('кавычки в атрибуте маркера не значат ничего — обе орфографии адресуют один ключ', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': ':root[data-theme="dark"] { --brand: #eee; }\n' },
    head: {
      'src/a.css':
        '/* visual-diff-exempt: :root[data-theme="dark"] --brand — апрув */\n' +
        ':root[data-theme="dark"] { --brand: #fff; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★ маркер в ОРФОГРАФИИ ГАРДА (без кавычек) гасит правило С кавычками', (t) => {
  // Контракт один: ключ маркера = то, что гард НАПЕЧАТАЛ. Печатает он
  // `:root[data-theme=dark]`, а в файле стоит `[data-theme="dark"]` — автор
  // копирует строку прямо из вывода, и она обязана сработать. Тест выше берёт
  // кавычки С ОБЕИХ сторон и остаётся зелёным, даже если снять нормализацию
  // совсем (обе стороны врут одинаково), — эту половину контракта пинит только
  // здешняя фикстура.
  const f = fixture(t, {
    base: { 'src/a.css': ':root[data-theme="dark"] { --brand: #eee; }\n' },
    head: {
      'src/a.css':
        '/* visual-diff-exempt: :root[data-theme=dark] --brand — апрув Pavel */\n' +
        ':root[data-theme="dark"] { --brand: #fff; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★ пробелы ВНУТРИ бесклассового селектора — не смысл: переформатирование не изменение', (t) => {
  // У бесклассовой единицы ключ — сам ТЕКСТ селектора, поэтому `html   body` и
  // `html body` разъехались бы на два ключа и гард напечатал бы пару «− red /
  // + red» на чистом форматировании. Это ровно то ложное срабатывание, из-за
  // которого гард выключают; держит его нормализация пробелов в normSel, и без
  // неё все остальные фикстуры остаются зелёными.
  const f = fixture(t, {
    base: { 'src/a.css': 'html   body { color: red; }\n' },
    head: { 'src/a.css': 'html body { color: red; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★ алиас var() НЕ резолвится по цепочке — сравнивается текст, значение ловится на своей строке', (t) => {
  // Граница, названная в шапке: `--hl-soft: var(--brand-soft)` не меняется ни на
  // байт, и красным становится строка самого `--brand-soft`. Иначе гарду
  // пришлось бы считать вычисленный цвет — это уже не «два своих замера».
  const f = fixture(t, {
    base: { 'src/a.css': ':root { --brand-soft: #111; --hl-soft: var(--brand-soft); }\n' },
    head: { 'src/a.css': ':root { --brand-soft: #222; --hl-soft: var(--brand-soft); }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /:root --brand-soft: #111 → #222/);
  assert.doesNotMatch(out, /--hl-soft/);
});

test('★ токен в @media — отдельный контекст (у --ctl-h в репо ровно так)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': ':root { --ctl-h: 40px; }\n@media (max-width: 640px) { :root { --ctl-h: 44px; } }\n' },
    head: { 'src/a.css': ':root { --ctl-h: 41px; }\n@media (max-width: 640px) { :root { --ctl-h: 44px; } }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /:root --ctl-h: 40px → 41px/);
});

test('★ ГЕОМЕТРИЯ голого тега — тоже под наблюдением: `h2 {}` шире любого токена', (t) => {
  // Довод, отвергнувший «только токены»: голый тег бьёт по всему приложению
  // разом. Живой дефект уже на руках — index.css держит второй канон
  // типографики на `h2`/`h4`, и его снос обязан быть красным и объявленным.
  const f = fixture(t, {
    base: { 'src/a.css': 'h2 { font-weight: 600; }\n' },
    head: { 'src/a.css': 'h2 { font-weight: 800; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /h2 font-weight: 600 → 800/);
});

test('★★ шаг кейфрейма ключуется ВМЕСТЕ С ИМЕНЕМ анимации — иначе from у двух анимаций один ключ', (t) => {
  // В репо 19 анимаций, `from`/`to` повторяются в них по многу раз. Мутация
  // «выкинуть имя анимации из контекста» склеивает fadeIn и dockUp: правка
  // одной либо краснеет ложно, либо гасится маркером на другую.
  const two = (a, b) => `@keyframes fadeIn { from { opacity: ${a}; } }\n@keyframes dockUp { from { opacity: ${b}; } }\n`;
  const f = fixture(t, { base: { 'src/a.css': two('0', '0') }, head: { 'src/a.css': two('0', '.5') } });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /from \{@keyframes dockUp\} opacity: 0 → \.5/);
  assert.doesNotMatch(out, /fadeIn/);
});

test('★★ маркер на ОДНУ анимацию не гасит правку в ДРУГОЙ', (t) => {
  // Та же мутация с другой стороны: при ключе по одному шагу этот маркер
  // потушил бы обе анимации разом — «один маркер гасит две вещи».
  const two = (a, b) => `@keyframes fadeIn { from { opacity: ${a}; } }\n@keyframes dockUp { from { opacity: ${b}; } }\n`;
  const f = fixture(t, {
    base: { 'src/a.css': two('0', '0') },
    head: {
      'src/a.css': '/* visual-diff-exempt: from {@keyframes fadeIn} opacity — плавнее вход */\n' + two('.2', '.5'),
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /@keyframes dockUp\} opacity: 0 → \.5/);
  assert.doesNotMatch(out, /@keyframes fadeIn\} opacity: 0 → \.2/);
});

test('★ маркер БЕЗ точки адресует голый тег, а не класс — ключ = то, что напечатано', (t) => {
  // Прежняя вольность (`checkbox` = `.checkbox`) стала неоднозначной, как
  // только под наблюдение попали голые теги: `button` — законная единица.
  // Догадка за автора гасила бы не то, поэтому правило одно и проверяемое.
  const f = fixture(t, {
    base: { 'src/a.css': '.button { gap: 1px; }\n' },
    head: { 'src/a.css': '/* visual-diff-exempt: button gap — без точки */\n.button { gap: 9px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /под маркером изменений нет/);
});

test('★ отчёт печатает бесклассовый ярус ОТДЕЛЬНО и с разбивкой «токены · прочие»', (t) => {
  // Числа отчёта — единственный признак того, что ветка ещё МЕРЯЕТСЯ: ноль в
  // любой половине означает, что наблюдение отвалилось, и суммарное число такую
  // пропажу растворило бы в тысяче классов. Без этой фикстуры строку отчёта
  // можно удалить целиком (проверено мутацией) — все остальные тесты остаются
  // зелёными, то есть гард молча перестаёт отчитываться о том, что он сравнил.
  const css = '.x { gap: 1px; }\n:root { --a: 1px; }\nh2 { font-weight: 600; }\n';
  const f = fixture(t, { base: { 'src/a.css': css }, head: {} });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /классов под наблюдением: 1/);
  assert.match(out, /бесклассовых селекторов: 2 \(объявлений 2: токенов 1 · прочих 1\)/);
});

test('★ `|` в селекторе не режет ключ — разделитель обязан быть тем, чего в CSS нет', (t) => {
  // `[lang|="en"]` — легальный CSS-оператор. Пока единицей был класс, `|` в
  // ключе был безопасен: в имени класса его не бывает. С бесклассовыми
  // единицами он стал третьим за день случаем «ключ, названный не целиком» —
  // ключ порезался бы по чужой границе, изменение напечаталось бы мусором и не
  // гасилось бы НИКАКИМ маркером. Мутация «вернуть `|` разделителем» валит
  // ровно этот тест.
  const f = fixture(t, {
    base: { 'src/a.css': '[lang|="en"] { letter-spacing: 0; }\n' },
    head: {
      'src/a.css':
        '/* visual-diff-exempt: [lang|=en] letter-spacing — апрув */\n[lang|="en"] { letter-spacing: 2px; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /изменение объявлено намеренным/);
});

test('visual-diff-move про КЛАССЫ — селектор в маркере переноса не разбирается (код 2)', (t) => {
  // Перенос — это «разметка уехала с класса на класс». Маркер с `:root` не
  // должен молча превращаться в неработающий: неразобранный маркер = код 2.
  const f = fixture(t, {
    base: { 'src/a.css': ':root { --x: 1px; }\n' },
    head: { 'src/a.css': '/* visual-diff-move: :root -> grow--fit */\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 2, out);
  assert.match(out, /не разобран/);
});

/* ───────────────── рабочее дерево, а не индекс (та самая дыра) ───────────────── */

test('★ гард видит НЕЗАСТЕЙДЖЕННУЮ правку — читает рабочее дерево, не индекс', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '.checkbox { gap: 17px; }\n' },
    commitHead: false,
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /gap: 9px → 17px/);
});
