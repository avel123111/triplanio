#!/usr/bin/env node
/**
 * Тесты CI-гарда 2s (scripts/ci/check-ts-check.mjs).
 *
 * Форма — та же, что у шаблона `check-inline-styles.test.mjs` (TRIP-282):
 * поднять временный git-репо, запустить гард ПОДПРОЦЕССОМ, проверить код
 * выхода. Не юнит-тест на внутреннюю функцию: у 2l все три обхода жили в
 * I/O-обвязке, а не в логике подсчёта.
 *
 * ★ Отдельно от кодов выхода здесь стоит тест «предикат совпадает с НАСТОЯЩИМ
 * tsc»: пятнадцать написаний прагмы прогоняются пинованным `node_modules/.bin/tsc`,
 * и множество файлов, которые ругнулись у tsc, сверяется с множеством, которое
 * насчитал гард. Без него предикат — правдоподобная догадка о чужой семантике
 * (TRIP-388: «инструмент проверяется мутацией РАНЬШЕ, чем на него ссылаются»).
 * У этого теста есть свой ДАТЧИК СЛЕПОТЫ: если tsc не ругнулся НИ НА ЧТО,
 * сверка пустых множеств зелена по построению — такое падает явно.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('./check-ts-check.mjs', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TSC = join(REPO_ROOT, 'node_modules/.bin/tsc');

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function put(dir, path, body) {
  const full = join(dir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

/** Репо с двумя коммитами: `base` — база PR, `head` накатывается поверх. */
function fixture(t, { base = {}, head = {}, renames = [], removes = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'guard2s-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'guard@test']);
  git(dir, ['config', 'user.name', 'guard']);
  // Глобальные gpgsign / hooksPath разработчика иначе ломают фикстуру, и это
  // выглядит как падение гарда.
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);

  for (const [p, body] of Object.entries(base)) put(dir, p, body);
  put(dir, '.keep', '');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();

  for (const [from, to] of renames) {
    mkdirSync(dirname(join(dir, to)), { recursive: true });
    git(dir, ['mv', from, to]);
  }
  for (const p of removes) git(dir, ['rm', '-q', p]);
  for (const [p, body] of Object.entries(head)) put(dir, p, body);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);

  return { dir, baseRef };
}

function run({ dir, baseRef }, { args = [], ref, cwd } = {}) {
  const r = spawnSync(process.execPath, [GUARD, ...args], {
    cwd: cwd ? join(dir, cwd) : dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Тело с заведомой ошибкой типов — под прагмой обязано краснеть у tsc. */
const BODY = 'const n = 1;\nn.toUpperCase();\nexport default n;\n';
const checked = (body = BODY) => `// @ts-check\n${body}`;
const plain = (body = BODY) => body;

/* ───────────────────────────── сам храповик ─────────────────────────────── */

test('файл потерял прагму → красный, файл назван', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    head: { 'src/a.js': plain() },
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /src\/a\.js/);
});

test('прагма уехала НИЖЕ первой строки кода → красный (инертная, но текст на месте)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    head: { 'src/a.js': `import './b.js';\n// @ts-check\n${BODY}` },
  });
  const r = run(f);
  assert.equal(r.code, 1, 'сдвиг прагмы выключает проверку — текстовый счёт этого не видит');
  assert.match(r.out, /директивой не является/);
});

test('`@ts-nocheck` дописан ниже `@ts-check` → красный (побеждает последняя)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    head: { 'src/a.js': `// @ts-check\n// @ts-nocheck\n${BODY}` },
  });
  assert.equal(run(f).code, 1);
});

test('прагма переписана БЛОЧНЫМ комментарием → красный (TS такую не читает)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    head: { 'src/a.js': `/* @ts-check */\n${BODY}` },
  });
  assert.equal(run(f).code, 1);
});

test('прагма на месте → зелёный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked() },
    head: { 'src/a.js': `// @ts-check\n// правка ниже\n${BODY}` },
  });
  assert.equal(run(f).code, 0);
});

test('новый файл с прагмой → зелёный и напечатан плюсом', (t) => {
  const f = fixture(t, { base: { 'src/a.js': checked() }, head: { 'src/new.js': checked() } });
  const r = run(f);
  assert.equal(r.code, 0);
  assert.match(r.out, /1 на \S+ → 2 на HEAD \(\+1\)/);
  assert.match(r.out, /\+ src\/new\.js/);
});

/* ───────── почему правило ПОФАЙЛОВОЕ, а агрегат только печатается ───────── */

test('агрегат плоский, но один файл потерял прагму → красный', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    head: { 'src/a.js': plain(), 'src/c.js': checked() },
  });
  const r = run(f);
  assert.equal(r.code, 1, 'счёт 2 → 2 держится новой работой, регресс покрытия остаётся регрессом');
  assert.match(r.out, /src\/a\.js/);
});

/* ──────────────── законные ходы, на которых гард обязан молчать ──────────── */

test('переименование файла с прагмой → зелёный (прагму спрашиваем по новому пути)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    renames: [['src/a.js', 'src/moved/a.js']],
  });
  assert.equal(run(f).code, 0);
});

test('переехавший файл не печатается как НОВЫЙ (иначе строка врёт при верном числе)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    renames: [['src/a.js', 'src/moved/a.js']],
  });
  const r = run(f);
  assert.equal(r.code, 0);
  assert.match(r.out, /2 на \S+ → 2 на HEAD \(\+0\)/);
  assert.doesNotMatch(r.out, /^ {2}\+ /m, 'переезд — не появление нового файла под прагмой');
});

test('переименование СО СНЯТОЙ прагмой → красный, и преемник НАЗВАН', (t) => {
  // Тест «переезд с прагмой → зелёный» этого не ловит ПО ПОСТРОЕНИЮ (оба
  // поведения зелены). Ловит только этот: иначе `git mv` + снятие прагмы в одном
  // PR отмывали бы регресс. Связка нужна не для вердикта (его даёт счёт), а
  // чтобы сообщение назвало, КУДА возвращать прагму.
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    renames: [['src/a.js', 'src/moved/a.js']],
    head: { 'src/moved/a.js': plain() },
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /похоже, переехал в src\/moved\/a\.js/);
});

test('ОБХОД: `git mv` + снятие прагмы + прагма на ДРУГОМ файле → красный', (t) => {
  // Правило A заявлено как «ловит подмену: сняли с одного, поставили на другой».
  // Переезд выводил файл из-под него ЦЕЛИКОМ (путь на HEAD не существует), и
  // дальше работало только счётное B, которое закрывается ЛЮБОЙ новой работой:
  // замерено — `2 → 2 (+0)` и exit 0, тогда как редакция ДО разделения правил
  // ловила это поимённо. То есть достаточно было добавить в PR `git mv`.
  // Тест «переезд СО СНЯТОЙ прагмой» этого не ловит ПО ПОСТРОЕНИЮ: там нет
  // компенсации, и красным его делает B.
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    renames: [['src/a.js', 'src/moved/a.js']],
    head: {
      'src/moved/a.js': plain(),
      'src/z.js': `// @ts-check\nexport function unrelated(q) {\n  return q.length + 7;\n}\n`,
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, 'переезд не выводит файл из-под пофайлового правила');
  assert.match(r.out, /src\/moved\/a\.js \(был src\/a\.js\)/);
});

test('путь с не-ASCII именем НАБЛЮДАЕТСЯ (иначе тихий зелёный ровно на предмете гарда)', (t) => {
  // git по умолчанию печатает такие пути C-квотированными («"src/\303\274ber.js"»),
  // фильтр расширений спотыкается о завершающую кавычку, файл выпадает из
  // наблюдения ЦЕЛИКОМ — и снятие прагмы проезжает с exit 0. Лечится
  // `core.quotePath=false` в обёртке git.
  const f = fixture(t, {
    base: { 'src/über.js': checked(), 'src/b.js': checked() },
    head: { 'src/über.js': plain() },
  });
  const r = run(f);
  assert.equal(r.code, 1, 'не-ASCII путь обязан судиться так же, как ASCII');
  assert.match(r.out, /über\.js/);
});

test('переезд .js → .ts при живой прагме → зелёный (покрытие ВЫРОСЛО, а не упало)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    renames: [['src/a.js', 'src/a.ts']],
  });
  const r = run(f);
  assert.equal(r.code, 0, 'у .ts прагма не нужна — файл проверяется всегда');
  assert.match(r.out, /переведено в TypeScript/);
});

test('ОБХОД ревьюера: переезд + переписывание >50% со снятой прагмой → красный', (t) => {
  // git отдаёт тут не `R`, а пару `D`/`A` (сходство ниже порога 50%), и первая
  // редакция прощала потерю по флагу `D`: печатала `-1` и выходила 0. Вердикт
  // теперь берётся из ЧИСЛА, а не из классификации диффа.
  const f = fixture(t, {
    base: { 'src/a.js': `// @ts-check\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;\n`, 'src/keep.js': checked() },
    removes: ['src/a.js'],
    head: {
      'src/moved/a.js':
        'export function totallyDifferent(x) {\n  const y = x * 42;\n  return `${y.toFixed(2)}!`;\n}\n',
    },
  });
  const r = run(f);
  assert.equal(r.code, 1, 'переписать файл при переезде не должно освобождать от прагмы');
  assert.match(r.out, /упало на 1/);
  assert.match(r.out, /src\/a\.js/);
});

test('удаление файла с прагмой → красный (прощать нечем: неотличимо от переезда)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked() },
    removes: ['src/a.js'],
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /преемник не найден/);
});

test('файл лишь УПОМИНАЛ прагму в прозе → не в наборе, снятие упоминания не красит', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/prose.js': `// см. \`// @ts-check\` в шапке\n${BODY}` },
    head: { 'src/prose.js': plain() },
  });
  const r = run(f);
  assert.equal(r.code, 0);
  assert.match(r.out, /1 на \S+ → 1 на HEAD/);
});

test('переезд .js → .ts С ПЕРЕРАБОТКОЙ (сходство 28%) → зелёный: порог связки опущен', (t) => {
  // Фикстура ОТКАЛИБРОВАНА замером, а не на глаз: 8 сохранённых строк из 12
  // дают `R028` при `--find-renames=10%` и пару `D`/`A` при дефолтных 50%.
  // Именно в этой полосе порог и виден: на дефолте вычет переезда в TypeScript
  // не срабатывает и гард краснеет на РОСТЕ покрытия. Мутация «вернуть 50%»
  // валит ровно этот тест.
  const keep = Array.from({ length: 12 }, (_, i) => `export const keep${i} = ${i};`).join('\n');
  const kept = Array.from({ length: 8 }, (_, i) => `export const keep${i} = ${i};`).join('\n');
  const extra = Array.from({ length: 10 }, (_, i) => `export function extra${i}(x) { return x * ${i} + 7; }`).join('\n');
  const f = fixture(t, {
    base: { 'src/a.js': `// @ts-check\n${keep}\n`, 'src/b.js': checked() },
    removes: ['src/a.js'],
    head: { 'src/a.ts': `${kept}\n${extra}\n` },
  });
  const r = run(f);
  assert.equal(r.code, 0, 'у .ts прагма не нужна — это рост покрытия, а не потеря');
  assert.match(r.out, /переведено в TypeScript/);
});

test('ОБХОД: снос файла + ПОСТОРОННИЙ новый .ts → красный, а не «перевод в TypeScript»', (t) => {
  // При пороге связки 10% git спаривает снос с любым похожим новым файлом
  // (замерено: `R043`), и вычет конверсии по СВЯЗКЕ печатал `-1`, объявлял
  // посторонний `.ts` преемником и выходил 0 — тот же обход, что чинил ревьюер,
  // с другой стороны. Конверсия признаётся ПО ПУТИ, поэтому здесь её нет.
  const f = fixture(t, {
    base: {
      'src/a.js': `// @ts-check\nexport const a = 1;\nexport const b = 2;\nexport const c = 3;\nexport const d = 4;\n`,
      'src/keep.js': checked(),
    },
    removes: ['src/a.js'],
    head: { 'src/brandnew.ts': 'export const a = 1;\nexport const b = 2;\nexport const zz = 9;\n' },
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.out, /переведено в TypeScript/, 'посторонний .ts — не конверсия');
  // …и при этом гард не должен советовать поставить прагму В `.ts`-ФАЙЛ: она там
  // не нужна и ничего не включает. Ложная инструкция — не мелочь: она посылает
  // следующего чинить не то (тот же класс, что «ложное сообщение хуже пропуска»).
  assert.doesNotMatch(r.out, /brandnew\.ts \(был/, 'прагму в .ts возвращать некуда');
});

test('нарушены ОБА правила → напечатаны ОБА диагноза, а не первый', (t) => {
  // Ранний `exit` в счётном правиле прятал бы пофайловое, и автор чинил бы
  // половину. Мутация «вернуть process.exit(1) в блок B» валит ровно этот тест.
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/b.js': checked(), 'src/c.js': checked() },
    removes: ['src/c.js'],
    head: { 'src/a.js': plain() },
  });
  const r = run(f);
  assert.equal(r.code, 1);
  assert.match(r.out, /преемник не найден/, 'счётное правило обязано отчитаться');
  assert.match(r.out, /src\/a\.js: на \S+ прагма действовала/, 'пофайловое — тоже');
});

test('ОБХОД ревьюера: @ts-nocheck за терминатором U+2028/U+2029/CR → красный', (t) => {
  // Терминаторов строки в JS четыре, а поиск конца комментария шёл по одному
  // `\n`: `// @ts-check⟨U+2028⟩// @ts-nocheck` склеивался в ОДИН комментарий, и
  // гард считал файл покрытым, тогда как tsc проверку ВЫКЛЮЧАЕТ. Символы здесь
  // записаны ЭКРАНИРОВАННО: литеральный U+2028 в исходнике завершает строку и
  // ломает сам тест (проверено — `node --check` падает на нём).
  for (const [name, sep] of [['LSEP', '\u2028'], ['PSEP', '\u2029'], ['CR', '\r']]) {
    const f = fixture(t, {
      base: { 'src/a.js': checked(), 'src/b.js': checked() },
      head: { 'src/a.js': `// @ts-check${sep}// @ts-nocheck\n${BODY}` },
    });
    const r = run(f);
    assert.equal(r.code, 1, `${name}: за терминатором стоит @ts-nocheck — покрытия нет`);
    assert.match(r.out, /директивой не является/);
  }
});

test('прагма в .d.ts не считается (такие файлы проверяются и без неё)', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked() },
    head: { 'src/t.d.ts': '// @ts-check\nexport {};\n' },
  });
  const r = run(f);
  assert.equal(r.code, 0);
  assert.match(r.out, /1 на \S+ → 1 на HEAD/);
});

/* ─────────── «нечего проверять» ≠ «проверено, чисто» (TRIP-282) ─────────── */

test('на HEAD НОЛЬ файлов с действующей прагмой → код 2, а не OK', (t) => {
  const f = fixture(t, { base: { 'src/a.js': plain() }, head: { 'src/a.js': `${BODY}// правка\n` } });
  const r = run(f);
  assert.equal(r.code, 2);
  assert.match(r.out, /НИ ОДНОГО файла/);
});

test('недостижимая база → код 2 (храповик, который ничего не измерил, не печатает OK)', (t) => {
  const f = fixture(t, { base: { 'src/a.js': checked() }, head: {} });
  const r = run(f, { ref: 'origin/nope' });
  assert.equal(r.code, 2);
  assert.match(r.out, /не разрешается/);
});

test('неизвестный флаг → код 2 (потолка, который правит PR, у гарда нет)', (t) => {
  const f = fixture(t, { base: { 'src/a.js': checked() }, head: { 'src/a.js': plain() } });
  const r = run(f, { args: ['--write'] });
  assert.equal(r.code, 2);
  assert.match(r.out, /unknown flag/);
});

test('запуск из подкаталога судит весь репо, а не пустоту', (t) => {
  const f = fixture(t, {
    base: { 'src/a.js': checked(), 'src/deep/keep.js': checked() },
    head: { 'src/a.js': plain() },
  });
  const r = run(f, { cwd: 'src/deep' });
  assert.equal(r.code, 1, 'из подкаталога гард обязан находить те же файлы');
});

/* ──────── предикат против НАСТОЯЩЕГО tsc (иначе это догадка о TS) ───────── */

test('предикат совпадает с tsc: пятнадцать написаний прагмы судятся одинаково', (t) => {
  assert.ok(
    existsSync(TSC),
    `нет ${TSC}: без пинованного tsc эта сверка ничего не доказывает (npm ci)`,
  );

  // Ключ — ожидание, но проверяет его не оно, а сам tsc двумя строками ниже.
  const forms = {
    'src/a_top.js': `// @ts-check\n${BODY}`,
    'src/b_nospace.js': `//@ts-check\n${BODY}`,
    'src/c_triple.js': `/// @ts-check\n${BODY}`,
    'src/d_trailing.js': `// @ts-check и почему\n${BODY}`,
    'src/e_after_block.js': `/** шапка */\n\n// @ts-check\n${BODY}`,
    'src/f_block.js': `/* @ts-check */\n${BODY}`,
    'src/g_below_code.js': `const x = 1;\n// @ts-check\n${BODY}`,
    'src/h_prose.js': `// TODO @ts-check\n${BODY}`,
    'src/i_suffix.js': `// @ts-check-foo\n${BODY}`,
    'src/j_nocheck_last.js': `// @ts-check\n// @ts-nocheck\n${BODY}`,
    // ↓ пять написаний, на которых предикат РАСХОДИЛСЯ с tsc (нашёл
    //   code-simplifier). Стоят здесь, а не отдельным ассертом, ровно затем,
    //   чтобы судил их сам tsc, а не моё представление о нём.
    'src/k_bom.js': `\uFEFF// @ts-check\n${BODY}`,
    'src/l_nbsp.js': `\u00A0// @ts-check\n${BODY}`,
    'src/m_nel.js': `\u0085// @ts-check\n${BODY}`,
    'src/n_shebang.js': `#!/usr/bin/env node\n// @ts-check\n${BODY}`,
    'src/o_case.js': `// @TS-Check\n${BODY}`,
  };
  const f = fixture(t, { base: { 'src/keep.js': `// @ts-check\nexport default 1;\n` }, head: forms });
  writeFileSync(
    join(f.dir, 'jsconfig.json'),
    JSON.stringify({ compilerOptions: { checkJs: false, skipLibCheck: true, types: [] }, include: ['src/*.js'] }),
  );

  const tsc = spawnSync(TSC, ['-p', './jsconfig.json'], { cwd: f.dir, encoding: 'utf8' });
  const byTsc = new Set(
    `${tsc.stdout}`
      .split('\n')
      .map((l) => /^(src\/[\w.]+\.js)\(/.exec(l)?.[1])
      .filter(Boolean),
  );
  // ДАТЧИК СЛЕПОТЫ: пустое множество сошлось бы с пустым и напечатало зелёное.
  assert.ok(byTsc.size > 0, `tsc не ругнулся ни на что — проба слепая:\n${tsc.stdout}${tsc.stderr}`);

  const r = run(f);
  const added = /^ {2}\+ (.+)$/m.exec(r.out)?.[1] ?? '';
  const byGuard = new Set(added.split(' · ').filter(Boolean));

  assert.deepEqual([...byGuard].sort(), [...byTsc].sort(), 'гард и tsc обязаны считать одни и те же файлы');
});

/* ─────────────── сверка с ЖИВЫМ деревом (данные тоже мутируются) ────────── */

test('на живом репо набор непустой и печатается числом', () => {
  const r = spawnSync(process.execPath, [GUARD], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: 'HEAD' },
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  const n = Number(/→ (\d+) на HEAD/.exec(`${r.stdout}`)?.[1]);
  // Ассерт на НАПЕЧАТАННОЕ ЧИСЛО, а не на код 0: у гарда есть законный выход 0,
  // и тест «сходится с живым деревом» без этого зелен ровно тогда, когда
  // проверять стало нечего (урок 2q, TRIP-364 PR-F).
  assert.ok(n >= 9, `в src/ ожидались минимум 9 файлов с действующей прагмой, насчитано ${n}`);
});
