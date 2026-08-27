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

/* ★ ФИКСТУРА ОБЯЗАНА ПОДКЛЮЧАТЬ СВОЙ CSS. Гард не считает каскадом таблицу, на
 * которую в дереве не осталось ни одной ссылки (мёртвый файл не приезжает в
 * браузер и ничего не выигрывает — см. докблок `listCss`). Репозиторий из
 * одного `.css` и никого больше — это не «репозиторий без импортов», это
 * репозиторий, где ВЕСЬ CSS мёртв: без этой строки все тесты ниже мерили бы
 * пустую карту и были бы зелёными по любой мутации.
 *
 * Файл-загрузчик пишется РЯДОМ и перечисляет то, что фикстура создала на этой
 * стороне, — ровно так же, как это делает `main.jsx` в настоящем дереве. Тесты
 * на сам предикат достижимости от него отказываются (`loadCss: false`). */
function loaders(dir, files) {
  const css = Object.keys(files).filter((p) => p.endsWith('.css'));
  put(dir, 'src/__loaders.jsx', css.map((p) => `import '${p}';`).join('\n') + '\n');
}

function fixture(t, { base = {}, head = {}, commitHead = true, loadCss = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2p-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  put(dir, '.keep', '');
  if (loadCss) loaders(dir, base);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const [p, body] of Object.entries(head)) put(dir, p, body);
  if (loadCss) loaders(dir, { ...base, ...head });
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

/* ── добавление на НОВЫЙ класс vs добавление к СУЩЕСТВУЮЩЕМУ (TRIP-460 Ф6) ── */

test('★ ПОЛНОСТЬЮ новый класс — ЗЕЛЁНЫЙ (новому элементу нечему регрессировать)', (t) => {
  // Без этой ветки public/site.css заморожен на добавление: новая страница зоны
  // = сотни ложных «+». Класс, которого на базе не было ни в одном свойстве, —
  // новый элемент, а не правка старого.
  const f = fixture(t, {
    base: { 'public/site.css': '.hero { padding: 8px; }\n' },
    head: { 'public/site.css': '.hero { padding: 8px; }\n.pane-form { padding: 20px; gap: 11px; color: red; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /добавлений на новые классы-ключи пропущено/);
});

test('★ ДОБАВЛЕНИЕ свойства к СУЩЕСТВУЮЩЕМУ классу — КРАСНЫЙ (элемент сменил облик)', (t) => {
  // Гарантия, что новый пропуск не проделал дыру: `.checkbox` был на базе, ему
  // дорисовали background — это регресс существующего элемента, блок цел.
  const f = fixture(t, {
    base: { 'public/site.css': '.checkbox { gap: 9px; }\n' },
    head: { 'public/site.css': '.checkbox { gap: 9px; background: red; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.checkbox background/);
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

/** ★TRIP-344: ТОТ ЖЕ ЗАКОН, ДРУГАЯ ФОРМА ЗАПИСИ. Состояние бывает выражено
 *  атрибутом (`[disabled]`, `[data-state=open]`, `[aria-pressed=true]`), весит
 *  столько же (0,2,0), сколько `:hover`, — и до этой правки предикат его не
 *  видел, поэтому атрибутное состояние попадало в БАЗОВЫЙ ключ и выигрывало
 *  его. Дыра, ради которой состояние вообще попало в ключ, была закрыта ровно
 *  наполовину: правка ПОКОЯ пряталась за состоянием и не печаталась.
 *  Проверяется ИМЕННО правка покоя, а не появление состояния: мутация «вернуть
 *  прежний stateOf» обязана ронять этот тест, а тест на «состояние напечатано»
 *  она бы прошла. */
test('★ [data-state] не вытесняет базовое значение — атрибутное состояние это тоже состояние', (t) => {
  const f = fixture(t, {
    base: {
      'src/a.css': '.btn { background: transparent; }\n.btn[data-state="open"] { background: red; }\n',
    },
    head: {
      'src/a.css': '.btn { background: blue; }\n.btn[data-state="open"] { background: red; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  // Правка ПОКОЯ обязана быть напечатана и адресуема базовым ключом.
  assert.match(out, /\.btn background: transparent → blue/);
});

/** ⚠️ Прежняя редакция этого теста БЫЛА ИНЕРТНА и это поймал ревьюер, а не
 *  прогон: она сверяла «обе формы записи дают код 0», а при СТАРОМ предикате
 *  атрибут не попадал в состояние вовсе, обе стороны давали пустое состояние —
 *  и результат совпадал при обеих реализациях. Тест, проходящий при возвращённом
 *  дефекте, ничего не пинит. Дискриминирует ИМЕННО ПЕЧАТАЕМЫЙ КЛЮЧ: без снятия
 *  кавычек `[data-state="open"]` и `[data-state=open]` стали бы РАЗНЫМИ
 *  состояниями, и вместо одной строки `9px → 12px` гард напечатал бы пару
 *  «ушло/появилось»; при старом предикате в ключе не было бы атрибута вообще. */
test('★ форма записи атрибута ключ не меняет — [x="a"] и [x=a] это одно состояние', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.btn[data-state="open"] { gap: 9px; }\n' },
    head: { 'src/a.css': '.btn[data-state=open] { gap: 12px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.btn\[data-state=open\] gap: 9px → 12px/);
  assert.doesNotMatch(out, /gap: [−+]/);
});

/** ★★TRIP-344: ОБЪЯВЛЕНИЕ ПОТОМКА-ТЕГА НЕ ПРИНАДЛЕЖИТ КЛАССУ ПРЕДКА.
 *  Фикстура — ровно замер из коммита: `.icon-btn > svg` специфичнее, поэтому
 *  при склеенном ключе ОН выигрывал, и правка стороны САМОЙ кнопки не
 *  печаталась вовсе («итоговые объявления не изменились ни у одного класса»).
 *  Мутация «вернуть `unitsOf` к классам всего селектора» обязана ронять этот
 *  тест: при ней обе стороны читают 16px и изменений нет.
 *  ⚠️ Правка уехала БЕЗ теста и была поймана откатом ревьюера, а не прогоном —
 *  тот случай, когда «мутационно доказано» относилось к соседней половине
 *  правки. */
test('★★ правка стороны предка видна при живом правиле потомка-тега', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.icon-btn { width: 40px; }\n.icon-btn > svg { width: 16px; }\n' },
    head: { 'src/a.css': '.icon-btn { width: 999px; }\n.icon-btn > svg { width: 16px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.icon-btn width: 40px → 999px/);
});

/** Обратная сторона той же развилки: правило потомка НЕ исчезает из наблюдения,
 *  а получает СВОЮ единицу — целый селектор. Это и отличает правку от
 *  отвергнутой в TRIP-363 «единицы = подлежащее», которая уносила ключи совсем.
 *  Мутация «вернуть прежний `unitsOf`» печатает здесь `.icon-btn width`, то есть
 *  приписывает правку иконки КНОПКЕ — ассерт на имя единицы это ловит. */
test('★★ правило потомка-тега наблюдается под своей единицей, а не под классом предка', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.icon-btn { width: 40px; }\n.icon-btn > svg { width: 16px; }\n' },
    head: { 'src/a.css': '.icon-btn { width: 40px; }\n.icon-btn > svg { width: 20px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.icon-btn > svg width: 16px → 20px/);
});

/** ★ ГРАНИЦА ПРАВКИ: у `.a .b` подлежащее НЕСЁТ класс, поэтому ключи остаются на
 *  ВСЕХ классах селектора — ровно как решено в TRIP-363. Без этого теста правка
 *  незаметно съехала бы в отвергнутый там вариант («единица = подлежащее»,
 *  −1926 ключей): первая редакция этой правки именно так и была написана. */
test('★ у составного селектора с классом-подлежащим ключи остаются на ВСЕХ классах', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.pro-up .pu-body { flex: 1; }\n' },
    head: { 'src/a.css': '.pro-up .pu-body { flex: 2; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.pu-body flex: 1 → 2/);
  assert.match(out, /\.pro-up flex: 1 → 2/);
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
  assert.match(out, /у цели \.grow--ftt на HEAD нет ни одного объявления/);
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

/* ───────── источник переноса называется ЦЕЛИКОМ (TRIP-363) ─────────
 * Объявление составного правила приписывается ВСЕМ классам селектора, поэтому
 * однословный маркер закрывал только половину ключей, и зелёным гард становился
 * от ВТОРОГО маркера — заведомо ложного («уехал и предок»). Проверяется, что
 * одной правдивой строки достаточно И что она не гасит ничего сверх своего
 * правила.                                                                  */

const TARGET = '.grow--fit { flex: 1; min-width: 0; }\n';

test('★★ перенос из СОСТАВНОГО селектора объявляется ОДНОЙ строкой — зелёный', (t) => {
  // Воспроизведение из тикета (`app.css:1867`): раскладку отдаёт `.pu-body`
  // внутри `.pro-up--inline`, а ключи заводятся на ОБА класса — четыре штуки.
  const f = fixture(t, {
    base: { 'src/a.css': `.pro-up--inline .pu-body { flex: 1; min-width: 0; }\n${TARGET}` },
    head: { 'src/a.css': `/* visual-diff-move: .pro-up--inline .pu-body -> grow--fit */\n${TARGET}` },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /перенос \.pro-up--inline \.pu-body → \.grow--fit: объявлений 4/);
});

test('★★ маркер на СОСТАВНОЙ не гасит снос ОДИНОЧНОГО правила того же класса', (t) => {
  // ★ Ради этого перенос скоупится СЕЛЕКТОРОМ, а не набором его классов.
  // `.pu { flex: 1 }` живёт своей жизнью, и его снос — не объявленный перенос,
  // хотя значение совпадает с целью. Мутация «сверять набор классов маркера»
  // проходит все прочие фикстуры насквозь и валится только здесь.
  const f = fixture(t, {
    base: { 'src/a.css': `.wrap .pu { min-width: 0; }\n.pu { flex: 1; }\n${TARGET}` },
    head: { 'src/a.css': `/* visual-diff-move: .wrap .pu -> grow--fit */\n${TARGET}` },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.pu flex: − 1/);
});

test('★ маркер на ДРУГОЙ составной селектор не гасит — сверяется сам селектор', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': `.pu .pu-body { flex: 1; min-width: 0; }\n${TARGET}` },
    head: { 'src/a.css': `/* visual-diff-move: .other .pu-body -> grow--fit */\n${TARGET}` },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.pu flex: − 1/);
});

test('★ перенос из составного СО СМЕНОЙ значения — красный (регрессия TRIP-351)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.pu .pu-body { flex: 1; }\n.grow--fit { flex: 1; }\n' },
    head: { 'src/a.css': '/* visual-diff-move: .pu .pu-body -> grow--fit */\n.grow--fit { flex: 2; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /flex: 1 → 2 — перенос на \.grow--fit СО СМЕНОЙ значения/);
});

test('★ перенос из составного на несуществующую цель — красный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.pu .pu-body { flex: 1; }\n' },
    head: { 'src/a.css': '/* visual-diff-move: .pu .pu-body -> grow--ftt */\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /у цели \.grow--ftt на HEAD нет ни одного объявления/);
});

test('★ `.a.b` — обе половины закрывает один маркер (подлежащего у него нет)', (t) => {
  // У селектора на ОДНОМ элементе правого класса-подлежащего не существует:
  // объявление получают оба. 92 таких селектора в репо.
  const f = fixture(t, {
    base: { 'src/a.css': `.field-row.cols-2 { display: flex; gap: 8px; }\n.row--split { display: flex; gap: 8px; }\n` },
    head: { 'src/a.css': '/* visual-diff-move: .field-row.cols-2 -> row--split */\n.row--split { display: flex; gap: 8px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /объявлений 4/);
});

test('★ комбинатор: `.a>.b` в файле и `.a > .b` в маркере — одна орфография', (t) => {
  // Пробел возле `>` на рендер не влияет вообще. Маркер, отвергнутый из-за него,
  // удаляют в раздражении, а с ним и проверку.
  const f = fixture(t, {
    base: { 'src/a.css': `.sc-actions-sec>.btn { flex: 1; min-width: 0; }\n${TARGET}` },
    head: { 'src/a.css': `/* visual-diff-move: .sc-actions-sec > .btn -> grow--fit */\n${TARGET}` },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★★ печать НАЗЫВАЕТ правило-источник — иначе маркер не из чего составить', (t) => {
  // Автор видит ключ `.pro-up--inline flex` и без источника не знает, из какого
  // правила объявление пришло: форма маркера ему известна, а содержание — нет.
  // Мутация «не печатать источник» валит ровно этот тест.
  const f = fixture(t, {
    base: { 'src/a.css': '.pro-up--inline .pu-body { flex: 1; }\n' },
    head: { 'src/a.css': '' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.pro-up--inline flex: − 1 {3}\(правило \.pro-up--inline \.pu-body\)/);
  assert.match(out, /\.pu-body flex: − 1 {3}\(правило \.pro-up--inline \.pu-body\)/);
});

test('★ у одноклассового правила источник НЕ печатается — это был бы шум на 2595 строках', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '.checkbox { gap: 17px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.doesNotMatch(out, /\(правило/);

  // ★ Состояние УЖЕ напечатано слева от двоеточия (`.btn:hover gap`), поэтому
  // подсказка `(правило .btn:hover)` была бы дословным повтором ключа — а таких
  // правил в репо сотни, и шум съел бы ровно те строки, ради которых источник и
  // печатается. Сверять с единицей БЕЗ состояния — значит печатать его всегда.
  const h = fixture(t, {
    base: { 'src/a.css': '.btn:hover { gap: 8px; }\n' },
    head: { 'src/a.css': '.btn:hover { gap: 9px; }\n' },
  });
  const r = run(h);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /\.btn:hover gap: 8px → 9px$/m);
  assert.doesNotMatch(r.out, /\(правило/);
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

test('visual-diff-move про КЛАССЫ — источник БЕЗ единого класса не разбирается (код 2)', (t) => {
  // Перенос — это «разметка уехала с класса на класс». Целый селектор источником
  // законен (TRIP-363), но только если в нём есть класс: маркер с `:root` не
  // должен молча превращаться в неработающий — неразобранный маркер = код 2.
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

/* ──────────── сторона ЦЕЛИ: набор целей и разворачивание токенов ────────────
 * Зеркало TRIP-363. Там маркер, названный не целиком, вынуждал ЛГАТЬ про
 * источник; здесь цель нельзя назвать целиком по двум независимым причинам —
 * раскладка уезжает на КОМПОЗИЦИЮ классов, а значения сверяются текстом, из-за
 * чего перенос сырого `16px` на `var(--sp-7)` читался как смена значения.     */

test('★ перенос сырого значения на ТОКЕН той же величины — ЗЕЛЁНЫЙ', (t) => {
  // Ровно то, ради чего шкала и заведена: `16px` уезжает на `var(--sp-7)`.
  // Текстовое сравнение читало это как «перенос СО СМЕНОЙ значения», и цена
  // была 117 непроверяемых исключений на одну зону.
  const f = fixture(t, {
    base: {
      'src/design/app.css': ':root { --sp-7: 16px; }\n.brow__body { gap: 16px; }\n.grow--fit { flex: 1; }\n',
    },
    head: {
      'src/design/app.css':
        ':root { --sp-7: 16px; }\n.grow--fit { flex: 1; gap: var(--sp-7); }\n' +
        '/* visual-diff-move: brow__body -> grow--fit */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /сошлись через токен/);
});

test('★★ перенос на токен ДРУГОЙ величины — КРАСНЫЙ (резолв не ослабляет сверку значений)', (t) => {
  const f = fixture(t, {
    base: {
      'src/design/app.css': ':root { --sp-6: 12px; }\n.brow__body { gap: 16px; }\n.grow--fit { flex: 1; }\n',
    },
    head: {
      'src/design/app.css':
        ':root { --sp-6: 12px; }\n.grow--fit { flex: 1; gap: var(--sp-6); }\n' +
        '/* visual-diff-move: brow__body -> grow--fit */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /СО СМЕНОЙ значения/);
});

test('★ резолв НЕ глобальный: правка самого токена по-прежнему блокирует', (t) => {
  // Разверни `var()` во всём сравнении — и правка одного токена зажгла бы всех
  // его потребителей, у которых в тексте не изменилось ничего. Потребитель
  // молчит, токен краснеет.
  const f = fixture(t, {
    base: { 'src/a.css': ':root { --sp-7: 16px; }\n.pad { gap: var(--sp-7); }\n' },
    head: { 'src/a.css': ':root { --sp-7: 20px; }\n.pad { gap: var(--sp-7); }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /:root --sp-7: 16px → 20px/);
  assert.doesNotMatch(out, /\.pad/);
});

test('★ неизвестный токен оставляет var() в тексте — сверка остаётся строгой', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { gap: 16px; }\n.grow--fit { flex: 1; }\n' },
    head: {
      'src/a.css':
        '.grow--fit { flex: 1; gap: var(--nope); }\n/* visual-diff-move: brow__body -> grow--fit */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /СО СМЕНОЙ значения/);
});

test('★ фолбэк var(--нет, 16px) берётся, когда имени нет в :root', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { gap: 16px; }\n.grow--fit { flex: 1; }\n' },
    head: {
      'src/a.css':
        '.grow--fit { flex: 1; gap: var(--nope, 16px); }\n/* visual-diff-move: brow__body -> grow--fit */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★ тёмный :root в словарь резолва НЕ входит (тема — второй словарь)', (t) => {
  // Сверять перенос по двум словарям сразу значило бы выбирать, какой из них
  // «настоящий». Берётся ровно `:root` в базовом контексте.
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { color: red; }\n.grow--fit { flex: 1; }\n' },
    head: {
      'src/a.css':
        ':root[data-theme=dark] { --c: red; }\n.grow--fit { flex: 1; color: var(--c); }\n' +
        '/* visual-diff-move: brow__body -> grow--fit */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /СО СМЕНОЙ значения/);
});

test('★ ОДИН маркер называет НАБОР целей — раскладка уезжает на композицию', (t) => {
  const f = fixture(t, {
    base: {
      'src/design/app.css':
        '.brow__body { flex: 1; gap: 12px; }\n.row { flex: 1; }\n.row--g3 { gap: 12px; }\n',
    },
    head: {
      'src/design/app.css':
        '.row { flex: 1; }\n.row--g3 { gap: 12px; }\n' +
        '/* visual-diff-move: brow__body -> row row--g3 */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /перенос \.brow__body → \.row \.row--g3: объявлений 2/);
});

test('★★ покрывает ПОБЕДИТЕЛЬ ПО ВЕСУ среди целей, а не «есть хоть у одной»', (t) => {
  // Дыра ровно того класса, что нашла мутация в TRIP-363: значение совпало у
  // ПРОИГРАВШЕЙ цели, а элементу достаётся значение победителя.
  // ★ Фикстура специально разводит цели по РАЗНЫМ единицам и разным правилам.
  // Первая проба писала `.row` + `.row.row--g3`, и она была зелёной при
  // сломанном гарде: составное правило заводит ключ и на `.row` тоже, поэтому
  // «первая попавшаяся цель» тоже давала 99px. Мутация «есть хоть у одной» её не
  // ловила — тест проходил по неверной причине. Здесь `.hit` объявлен ПЕРВЫМ и
  // совпадает с ушедшим значением, `.win` стоит ниже при той же специфичности,
  // поэтому каскад отдаёт элементу именно его 99px.
  const f = fixture(t, {
    base: { 'src/design/app.css': '.brow__body { gap: 12px; }\n.hit { gap: 12px; }\n.win { gap: 99px; }\n' },
    head: {
      'src/design/app.css':
        '.hit { gap: 12px; }\n.win { gap: 99px; }\n/* visual-diff-move: brow__body -> hit win */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /СО СМЕНОЙ значения/);
});

test('★ пустая цель в наборе называется поимённо, а не «одна из»', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.brow__body { flex: 1; }\n.row { flex: 1; }\n' },
    head: { 'src/a.css': '.row { flex: 1; }\n/* visual-diff-move: brow__body -> row nosuch */\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /у цели \.nosuch на HEAD нет ни одного объявления/);
});

/* ───────── TRIP-366: бесклассовая единица из нескольких лексем ───────── */

test('★ visual-diff-exempt адресует единицу из НЕСКОЛЬКИХ лексем (h1 em color)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': 'h1 em { color: blue; }\n' },
    head: {
      'src/a.css': 'h1 em { color: red; }\n/* visual-diff-exempt: h1 em color — снят второй канон */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /h1 em color — изменение объявлено намеренным/);
});

test('★ маркер БЕЗ причины — код 2 с подсказкой, а не разбор не туда', (t) => {
  // Причиной кончается КЛЮЧ: без неё «последняя лексема» не определена, и
  // `h1 em color` разобрался бы как единица `h1` + свойство `em`.
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '.checkbox { gap: 17px; }\n/* visual-diff-exempt: .checkbox gap */\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 2, out);
  assert.match(out, /не разобран/);
});

test('★ ASCII-дефис в пробелах годится разделителем причины', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: {
      'src/a.css': '.checkbox { gap: 17px; }\n/* visual-diff-exempt: .checkbox gap - ступень шкалы */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★ маркер БЕЗ единицы (одно свойство) — код 2, а не маркер-пустышка', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.checkbox { gap: 9px; }\n' },
    head: { 'src/a.css': '.checkbox { gap: 17px; }\n/* visual-diff-exempt: gap — причина */\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 2, out);
  assert.match(out, /не разобран/);
});

test('★ media остаётся частью ключа при разборе справа налево', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '@media (max-width: 640px) { h1 em { color: blue; } }\n' },
    head: {
      'src/a.css':
        '@media (max-width: 640px) { h1 em { color: red; } }\n' +
        '/* visual-diff-exempt: h1 em {@media (max-width: 640px)} color — мобильная правка */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★★ каждая сторона разворачивается по СВОЕМУ :root — правку токена перенос не маскирует', (t) => {
  // Источник на базе — `var(--x)` при `--x: 16px`; цель на HEAD — сырые 20px, и
  // `--x` в этом же PR стал 20px. Разверни обе стороны по словарю HEAD — и
  // перенос сойдётся, спрятав смену величины под маркером переноса.
  const f = fixture(t, {
    base: { 'src/a.css': ':root { --x: 16px; }\n.brow__body { gap: var(--x); }\n.grow--fit { flex: 1; }\n' },
    head: {
      'src/a.css':
        ':root { --x: 20px; }\n.grow--fit { flex: 1; gap: 20px; }\n' +
        '/* visual-diff-move: brow__body -> grow--fit */\n' +
        '/* visual-diff-exempt: :root --x — правка токена объявлена отдельно */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /СО СМЕНОЙ значения/);
});

test('★★ составная единица С КЛАССОМ в exempt — код 2, а не гашение предка', (t) => {
  // Дыру открыл разбор справа налево, нашёл её `code-simplifier` прогоном:
  // `unitOf` берёт ПЕРВЫЙ класс, поэтому маркер «про .pu-body» молча гасил бы
  // правку на ПРЕДКЕ — общем классе. Тот же класс дефекта, от которого лечит
  // TRIP-363: маркер гасит не то, что удостоверяет. Правило: единица = то, что
  // гард НАПЕЧАТАЛ, а у правила с классами он печатает по одному классу.
  const f = fixture(t, {
    base: { 'src/a.css': '.pro-up--inline { color: blue; }\n.pro-up--inline .pu-body { flex: 1; }\n' },
    head: {
      'src/a.css':
        '.pro-up--inline { color: red; }\n.pro-up--inline .pu-body { flex: 1; }\n' +
        '/* visual-diff-exempt: .pro-up--inline .pu-body color — я думал это про .pu-body */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 2, out);
  assert.match(out, /не разобран/);
});

test('★ бесклассовая единица из лексем по-прежнему законна (границу не перекрыли)', (t) => {
  // Проверка предиката с другой стороны: запрет обязан бить по «пробел + класс»,
  // а не по «пробел» — иначе он отменил бы ровно то, ради чего TRIP-366 делался.
  const f = fixture(t, {
    base: { 'src/a.css': 'h1 em { color: blue; }\n' },
    head: { 'src/a.css': 'h1 em { color: red; }\n/* visual-diff-exempt: h1 em color — граница жива */\n' },
  });
  const { code } = run(f);
  assert.equal(code, 0);
});

/* ───────── TRIP-366 (2-й заход): единица с КЛАССАМИ-ПРЕДКАМИ, но бесклассовым
 * ПОДЛЕЖАЩИМ. Ровно случай `.lockmsg`: правило `.pro-up .lockmsg svg` действует
 * на `svg`, класса не несущий, поэтому гард печатает его ЦЕЛЫМ селектором — а
 * прежний предикат `classesOf(u).length > 0` отвергал такой маркер как
 * составной, и снос правила нечем было объявить (красный 2p без выхода). ────── */

test('★★ visual-diff-exempt адресует единицу с классами-ПРЕДКАМИ (.pro-up .lockmsg svg)', (t) => {
  // Мутация «вернуть предикат на classesOf(u).length > 0» роняет ЭТОТ тест:
  // маркер уходит в malformed (код 2), а гард печатает «маркер не разобран».
  const f = fixture(t, {
    base: { 'src/a.css': '.pro-up .lockmsg svg { color: blue; }\n' },
    head: {
      'src/a.css':
        '.pro-up .lockmsg svg { color: red; }\n' +
        '/* visual-diff-exempt: .pro-up .lockmsg svg color — снят кликабельный апселл */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /\.pro-up \.lockmsg svg color — изменение объявлено намеренным/);
});

test('★★ снос правила с классами-предками и бесклассовым подлежащим ОБЪЯВЛЯЕМ', (t) => {
  // Снос (`to === null`) — форма из тикета: `.lockmsg` уезжает на `<Btn>`.
  const f = fixture(t, {
    base: { 'src/a.css': '.pro-up .lockmsg svg { width: 14px; }\n' },
    head: {
      'src/a.css': '/* visual-diff-exempt: .pro-up .lockmsg svg width — .lockmsg удалён */\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

/** ★★TRIP-344 (ревью Codex, P1): СОСТОЯНИЕ ПРИВЯЗАНО К СВОЕМУ КОМПАУНДУ.
 *  Пока оно собиралось в один отсортированный хвост на ВЕСЬ селектор,
 *  `.a[data-x] .b` и `.a .b[data-x]` давали один и тот же ключ на оба класса —
 *  из ключа не следовало, ЧЕЙ это компаунд, и правка одного пряталась за
 *  другим. Третья форма закона «неполный ключ склеивает разное»: сперва
 *  `@media`, потом подлежащее, теперь привязка состояния. */
test('★★ состояние принадлежит СВОЕМУ компаунду — .a[data-x] .b ≠ .a .b[data-x]', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.a[data-x] .b { color: red; }\n.a .b[data-x] { color: blue; }\n' },
    head: { 'src/a.css': '.a[data-x] .b { color: green; }\n.a .b[data-x] { color: blue; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /color: red → green/);
});

/** ★★TRIP-344 (ревью Codex, P1): класс внутри `:not()` НЕ делает компаунд
 *  «несущим класс». `.icon-btn > svg:not(.decorative)` действует на `svg`;
 *  пока классы искались текстом, `.decorative` читался как класс подлежащего,
 *  правило приписывалось `.icon-btn` — и правка предка снова пряталась за
 *  потомком, то есть ровно тот дефект, который эта правка и чинила. */
test('★★ класс внутри :not() не делает подлежащее классовым — правка предка видна', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.icon-btn { width: 40px; }\n.icon-btn > svg:not(.decorative) { width: 16px; }\n' },
    head: { 'src/a.css': '.icon-btn { width: 999px; }\n.icon-btn > svg:not(.decorative) { width: 16px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.icon-btn width: 40px → 999px/);
});

/* ─────────── ручки плитки: резолв ВЫЧИСЛЕННОГО в переносе (TRIP-391 объект 3) ───────────
 * Канон переводит скин `.ctx .ic{width;bg}` на примитив `.tile` (читает
 * `var(--tile)`/`var(--hl-soft)`), контекст задаёт РУЧКУ `.ctx .tile{--tile}`.
 * Перенос обязан сойтись ВЫЧИСЛЕННЫМ (текст меняется, значение — нет) И покраснеть
 * на смене значения ручки/тона (Г37: умнее, не слепее). */
const TILE_PRELUDE =
  ':root { --hl-soft: rgba(1,2,3,.1); --hl-ink: #123; --brand-soft: rgba(1,2,3,.1); --brand: #123;' +
  ' --act-soft: rgba(170,17,17,.12); --act-ink: #700; --r-sm: 8px; }\n' +
  '.tile { width: var(--tile, 34px); height: var(--tile, 34px); border-radius: var(--tile-r, var(--r-sm));' +
  ' background: var(--hl-soft); color: var(--hl-ink); }\n' +
  '.tile > svg { width: var(--tile-ic, 17px); height: var(--tile-ic, 17px); }\n';
const TILE_BASE =
  TILE_PRELUDE +
  '.statbar .ic { width: 42px; height: 42px; border-radius: 8px; background: var(--brand-soft); color: var(--brand); }\n' +
  '.statbar .ic svg { width: 20px; height: 20px; }\n' +
  '.statbar .s.c-city .ic { background: var(--act-soft); color: var(--act-ink); }\n';
// HEAD: .ic уехал на .tile; тон-вариант БЕЗ пер-вариантного маркера (канал-проход
// гасит background↔--hl-soft), иконка БЕЗ .ic svg (svg-ступень гасит через --tile-ic).
const tileHead = ({ tile = '42px', tileIc = '20px', citySoft = 'var(--act-soft)' } = {}) =>
  TILE_PRELUDE +
  '/* visual-diff-move: .statbar .ic -> .statbar .tile — плитка на примитив <Tile> */\n' +
  `.statbar .tile { --tile: ${tile}; --tile-ic: ${tileIc}; --tile-r: 8px; }\n` +
  `.statbar .s.c-city .tile { --hl-soft: ${citySoft}; --hl-ink: var(--act-ink); }\n`;

test('★ канон-миграция плитки: базовый маркер + канал-move тона + svg-ступень — всё сходится ВЫЧИСЛЕННЫМ → зелёный', (t) => {
  const f = fixture(t, { base: { 'src/design/app.css': TILE_BASE }, head: { 'src/design/app.css': tileHead() } });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★★ мутация: --tile 42px → 40px (реальный сдвиг размера) → КРАСНЫЙ (не ослеп по значению)', (t) => {
  const f = fixture(t, { base: { 'src/design/app.css': TILE_BASE }, head: { 'src/design/app.css': tileHead({ tile: '40px' }) } });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /СО СМЕНОЙ значения/);
});

test('★★ мутация: тон --hl-soft подменён (act → brand) → КРАСНЫЙ (канал-move НЕ гасит смену значения)', (t) => {
  const f = fixture(t, { base: { 'src/design/app.css': TILE_BASE }, head: { 'src/design/app.css': tileHead({ citySoft: 'var(--brand-soft)' }) } });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /c-city|background/);
});

test('★★ мутация: размер иконки --tile-ic 20px → 18px → КРАСНЫЙ (svg-ступень НЕ гасит смену размера)', (t) => {
  const f = fixture(t, { base: { 'src/design/app.css': TILE_BASE }, head: { 'src/design/app.css': tileHead({ tileIc: '18px' }) } });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /svg/);
});

// Тон-вариант с модификатором в ТОМ ЖЕ компаунде, что и `ic` (`.rec .ic.r-days`,
// не отдельным `.rec.c-city`). Канал-move обязан найти цель `.rec .tile.r-days`
// (tileTargetSel сохраняет сиблинг `.r-days`), иначе тон варианта не сойдётся —
// баг #821, чинится этим коммитом.
const REC_BASE =
  TILE_PRELUDE +
  '.rec .ic { width: 34px; height: 34px; background: var(--brand-soft); color: var(--brand); }\n' +
  '.rec .ic.r-days { background: var(--act-soft); color: var(--act-ink); }\n';
const recHead = (daysSoft = 'var(--act-soft)') =>
  TILE_PRELUDE +
  '/* visual-diff-move: .rec .ic -> .rec .tile — плитка на <Tile> */\n' +
  '.rec .tile { --tile: 34px; --hl-soft: var(--brand-soft); --hl-ink: var(--brand); }\n' +
  `.rec .tile.r-days { --hl-soft: ${daysSoft}; --hl-ink: var(--act-ink); }\n`;

test('★ канал-move варианта с модификатором в компаунде (.ic.r-days → .tile.r-days) → зелёный (баг #821)', (t) => {
  const f = fixture(t, { base: { 'src/design/app.css': REC_BASE }, head: { 'src/design/app.css': recHead() } });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★★ мутация: тон .tile.r-days подменён → КРАСНЫЙ (сиблинг-цель сверяется, не гасится вслепую)', (t) => {
  const f = fixture(t, { base: { 'src/design/app.css': REC_BASE }, head: { 'src/design/app.css': recHead('var(--brand-soft)') } });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /r-days|background/);
});

// Шаблон «КЛАСС-САМ-ПЛИТКА»: приватный класс не заменяется на .tile, а НЕСЁТ его
// (`<Tile className="flagchip">` → `.tile.flagchip`), ручка --tile на самом классе.
// tileCtxOf обязан взять контекст с СЕЛЕКТОРА-КАК-ЕСТЬ (не только .ic→.tile).
const FLAG_BASE =
  TILE_PRELUDE +
  '.flagchip { width: 24px; height: 24px; border-radius: 7px; background: var(--brand-soft); color: var(--brand); }\n';
const flagHead = (tile = '24px') =>
  TILE_PRELUDE +
  '/* visual-diff-move: flagchip -> tile — класс-сам-плитка на <Tile className="flagchip"> */\n' +
  `.flagchip { --tile: ${tile}; --tile-r: 7px; }\n`;

test('★ класс-сам-плитка (.flagchip несёт .tile, ручка на себе) — перенос сходится ВЫЧИСЛЕННЫМ → зелёный', (t) => {
  const f = fixture(t, { base: { 'src/design/app.css': FLAG_BASE }, head: { 'src/design/app.css': flagHead() } });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
});

test('★★ мутация: --tile класс-сам-плитки 24px → 20px → КРАСНЫЙ', (t) => {
  const f = fixture(t, { base: { 'src/design/app.css': FLAG_BASE }, head: { 'src/design/app.css': flagHead('20px') } });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /СО СМЕНОЙ значения/);
});

/* ─────────── удалённый в рабочем дереве файл — замер, а не авария ─────────── */

test('★ CSS-файл СНЕСЁН в рабочем дереве (ещё не застейджен) — «ушло», а не ENOENT', (t) => {
  // Ровно случай PR, который переносит правила из файла компонента в `app.css`
  // и сам файл удаляет. `git ls-files` перечисляет ОТСЛЕЖИВАЕМЫЕ пути, поэтому
  // снесённый, но не застейдженный файл в списке остаётся, и чтение падало
  // ENOENT со стек-трейсом. В CI (там удаление закоммичено) гард при этом
  // выглядел исправным — то есть ломался ровно там, где им пользуются руками.
  // Код выхода 1 у аварии и у честного «красного» ОДИНАКОВ, поэтому судим по
  // выводу: должна быть названа ушедшая декларация и не быть ENOENT.
  const f = fixture(t, {
    base: { 'src/design/app.css': '.stay { color: red; }\n', 'src/gone.css': '.gone { display: flex; }\n' },
    head: {},
    commitHead: false,
  });
  rmSync(join(f.dir, 'src/gone.css'));
  const { code, out } = run(f);
  assert.doesNotMatch(out, /ENOENT/, out);
  assert.equal(code, 1, out);
  assert.match(out, /\.gone display/, out);
});

/* ─────────── достижимость: мёртвая таблица стилей не входит в каскад ─────────
 * Гард моделировал каскад «все .css периметра», и это неверно ровно для одного
 * случая — таблицы, на которую не осталось ссылок. В этом дереве такой файл был
 * один (`src/pages/login.css`, 705 строк, мёртв с Ф6.5) и держал ПОБЕДИТЕЛЯ у
 * 472 ключей: гард печатал не то значение, которое видит человек, и настоящая
 * правка в `app.css` по этим ключам проходила ЗЕЛЁНОЙ. Тесты ниже пинят обе
 * половины: что мёртвое не считается и что живое считается по-прежнему.        */

test('★★ мёртвая таблица НЕ выигрывает ключ — правка живого файла КРАСНАЯ', (t) => {
  // Ровно форма дефекта: dead.css выиграл бы `.field gap` (ранг выше при равной
  // специфичности), и подмена значения в app.css была бы невидима.
  const f = fixture(t, {
    base: {
      'src/main.jsx': "import 'src/design/app.css';\n",
      'src/design/app.css': '.field { gap: 7px; }\n',
      'src/pages/dead.css': '.field { gap: 6px; }\n',
    },
    head: { 'src/design/app.css': '.field { gap: 77px; }\n' },
    loadCss: false,
  });
  const { code, out } = run(f);
  assert.equal(code, 1, 'правка живого значения обязана краснеть, а не прятаться за мёртвым файлом');
  assert.match(out, /\.field gap: 7px → 77px/);
});

test('★★ снос мёртвой таблицы — ЗЕЛЁНЫЙ, без единого маркера-обхода', (t) => {
  // Иначе выпил 705 мёртвых строк стоит 472 `visual-diff-exempt` — то есть
  // уборка увеличивает ровно тот долг, ради которого затевалась.
  const f = fixture(t, {
    base: {
      'src/main.jsx': "import 'src/design/app.css';\n",
      'src/design/app.css': '.field { gap: 7px; }\n',
      'src/pages/dead.css': '.field { gap: 6px; }\n',
    },
    head: {},
    commitHead: false,
    loadCss: false,
  });
  rmSync(join(f.dir, 'src/pages/dead.css'));
  git(f.dir, ['add', '-A']);
  git(f.dir, ['commit', '-qm', 'drop dead css']);
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /не изменились/);
});

test('★ ссылка из HTML — файл ЖИВОЙ (так подключён fonts.css)', (t) => {
  const f = fixture(t, {
    base: {
      'index.html': '<link rel="stylesheet" href="/src/design/fonts.css">\n',
      'src/design/fonts.css': '.brand { letter-spacing: 1px; }\n',
    },
    head: { 'src/design/fonts.css': '.brand { letter-spacing: 9px; }\n' },
    loadCss: false,
  });
  const { code, out } = run(f);
  assert.equal(code, 1, 'таблица, подключённая из HTML, обязана остаться под наблюдением');
  assert.match(out, /\.brand letter-spacing: 1px → 9px/);
});

test('★ подключение рантайм-тегом по ИМЕНИ — файл живой (так подключён site.css)', (t) => {
  // Предикат по имени файла, а не по разбору `import`: `useSiteCss()` вешает
  // <link> сама, и разбор импортов похоронил бы всю сайтовую зону разом.
  const f = fixture(t, {
    base: {
      'src/useSiteCss.js': "const HREF = '/site.css';\nexport default HREF;\n",
      'public/site.css': '.hero { padding: 10px; }\n',
    },
    head: { 'public/site.css': '.hero { padding: 40px; }\n' },
    loadCss: false,
  });
  const { code, out } = run(f);
  assert.equal(code, 1, 'site.css приезжает рантайм-тегом и обязан остаться под наблюдением');
  assert.match(out, /\.hero padding: 10px → 40px/);
});

/* ──────────────── периметр: две папки, и `public` в их числе ────────────────
 * Периметр — отдельная проверка от «работает ли гард»: спрашивать надо не
 * «краснеет ли», а «всю ли зону он видит». До TRIP-460 стояло `-- src`, и
 * `public/site.css` — единственный CSS сайтовой зоны, 92 КБ — не сторожил
 * никто: 2ac ловит имена, 2ad ссылки, 2k сырые кегли, а подмена ЗНАЧЕНИЯ
 * ступени шкалы (15px → 14.72px) не ловилась ничем и уехала в dev молча.
 * Поэтому обе папки пинятся тестом, а не только поведение.                */

test('★ периметр включает public/site.css — подмена значения там КРАСНАЯ', (t) => {
  const f = fixture(t, {
    base: { 'public/site.css': 'html.site { --fs-body: 14px; }\n' },
    head: { 'public/site.css': 'html.site { --fs-body: 13.6px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /--fs-body: 14px → 13\.6px/, out);
});

test('★ периметр НЕ потерял src — правка там по-прежнему красная', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '.card { gap: 8px; }\n', 'public/site.css': 'html.site { --x: 1px; }\n' },
    head: { 'src/a.css': '.card { gap: 12px; }\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.card gap: 8px → 12px/, out);
});

test('★ каскад: public/site.css подключается ПОСЛЕ бандла и выигрывает у app.css', (t) => {
  // Зона грузит site.css рантайм-тегом <link> из useSiteCss, то есть после
  // всего бандла. Значит «итоговое объявление» для общего имени берётся из
  // site.css. Если ранг файла поставить ниже, гард будет считать победителем
  // проигравшее правило — и правка в site.css станет для него невидимой,
  // хотя файл уже в периметре.
  const f = fixture(t, {
    base: {
      'src/design/app.css': '.btn { border-radius: 12px; }\n',
      'public/site.css': '.btn { border-radius: 99px; }\n',
    },
    head: {
      'src/design/app.css': '.btn { border-radius: 12px; }\n',
      'public/site.css': '.btn { border-radius: 40px; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.btn border-radius: 99px → 40px/, out);
});

test('★ каскад: site.css выигрывает и у src/index.css — самого позднего в бандле', (t) => {
  // Соседний тест с app.css пинит только «site.css позже базы», и мутация
  // ранга в 1 проходила его зелёной, хотя site.css при этом проигрывал бы
  // index.css (999). Один тест на каскад давал ложную уверенность — поэтому
  // пинится ОБА конца: позже базы И позже самого позднего файла бандла.
  const f = fixture(t, {
    base: {
      'src/index.css': '.wrap { max-width: 1180px; }\n',
      'public/site.css': '.wrap { max-width: 1200px; }\n',
    },
    head: {
      'src/index.css': '.wrap { max-width: 1180px; }\n',
      'public/site.css': '.wrap { max-width: 1120px; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 1, out);
  assert.match(out, /\.wrap max-width: 1200px → 1120px/, out);
});

test('★ ложное срабатывание: маркер в public/ принимается так же, как в src/', (t) => {
  const f = fixture(t, {
    base: { 'public/site.css': 'html.site { --fs-body: 14px; }\n' },
    head: {
      'public/site.css':
        '/* visual-diff-exempt: .site --fs-body — ступень шкалы */\nhtml.site { --fs-body: 13px; }\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /объявлено намеренным/, out);
});
