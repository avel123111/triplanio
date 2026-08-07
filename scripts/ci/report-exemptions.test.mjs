#!/usr/bin/env node
/**
 * Тесты репортёра обходов (scripts/ci/report-exemptions.mjs), TRIP-364.
 *
 * Он ничего не блокирует, но печатает числа В ТЕЛО ПРОГОНА, и неверное число
 * там - это ложь в ревью, которую никто не перепроверяет. Главное, что пинится:
 * ДВА ЧИСЛА ПРО РАЗНОЕ. Первая редакция ТЗ делила маркеры ровно наоборот
 * (`visual-diff-exempt` числился накапливающимся), и это выяснилось прогоном
 * гарда, а не чтением кода.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./report-exemptions.mjs', import.meta.url));
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function fixture(t, { base = {}, head = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'exempt-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const put = (p, body) => {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  };
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'g@t']);
  git(dir, ['config', 'user.name', 'g']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);
  put('src/.keep', '');
  for (const [p, b] of Object.entries(base)) put(p, b);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const baseRef = git(dir, ['rev-parse', 'HEAD']).trim();
  for (const [p, b] of Object.entries(head)) put(p, b);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'head', '--allow-empty']);
  return { dir, baseRef };
}

const run = ({ dir, baseRef }, ref) => {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, BASE_REF: ref ?? baseRef },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

test('★★ два числа про РАЗНОЕ: потраченное в PR и накопленное в дереве', (t) => {
  // `visual-diff-exempt` гард читает из ДОБАВЛЕННЫХ строк диффа - он живёт один
  // PR. `inline-style-exempt` гард читает ИЗ ФАЙЛА при каждом прогоне - он
  // копится. Смешать их значит либо храповить мусор в комментариях, либо
  // потерять настоящую накопленную цену.
  const f = fixture(t, {
    base: { 'src/old.jsx': '// inline-style-exempt: ширина из данных\n' },
    head: {
      'src/a.css': '/* visual-diff-exempt: .checkbox gap — ступень шкалы */\n',
      'src/b.jsx': '// inline-style-exempt: цвет категории\n',
    },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /потрачено в этом PR: 2/);
  assert.match(out, /visual-diff-exempt 1/);
  // Накоплено — ОБА построчных, и старый, и новый; маркера 2p тут нет.
  assert.match(out, /накоплено в дереве: 2 {2}\(inline-style-exempt 2/);
});

test('★ маркер, приехавший в БАЗЕ, в «потрачено этим PR» не попадает', (t) => {
  const f = fixture(t, {
    base: { 'src/a.css': '/* visual-diff-exempt: .checkbox gap — приехало раньше */\n' },
    head: { 'src/b.css': '.x { color: red; }\n' },
  });
  const { out } = run(f);
  assert.match(out, /потрачено в этом PR: 0/);
  // …но справочная строка про инертные его видит - именно затем она и есть.
  assert.match(out, /ИНЕРТНЫ/);
});

test('★ недостижимая база — «не измерено», а не «0»', (t) => {
  // «Нечего проверять» и «проверено, чисто» не должны печатать один вердикт -
  // общее правило гардов этого репо, и репортёр от него не освобождён.
  const f = fixture(t, { base: {}, head: {} });
  const { code, out } = run(f, 'refs/heads/no-such-branch');
  assert.equal(code, 0, out);
  assert.match(out, /не измерено/);
  assert.doesNotMatch(out, /потрачено в этом PR: 0/);
});

test('репортёр НИКОГДА не блокирует', (t) => {
  const f = fixture(t, {
    base: {},
    head: { 'src/a.css': '/* visual-diff-exempt: .a b — раз */\n/* floor-exempt: classes +9 — два */\n' },
  });
  const { code, out } = run(f);
  assert.equal(code, 0, out);
  assert.match(out, /потрачено в этом PR: 2/);
});
