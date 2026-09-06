import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Гард — код, у него тест: временное дерево, гард подпроцессом, код выхода.
// Зелёный тест ничего не значит, пока не увидел красным — здесь оба случая.
// Отдельно пинуется ПЕРИМЕТР («что гард видит и что НЕ видит»), а не только
// «падает ли он»: у этого гарда именно граница единиц и есть всё содержание.
const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'check-time-arithmetic.mjs');

// Дом правила обязан существовать под корнем скана, иначе гард отказывается
// мерить (код 2) — поэтому кладём его в каждое дерево, кроме теста про отказ.
const HOME = { 'lib/time.js': 'export const durationMinutes = () => null;\n' };
// Пустой корпус гард считает сломанным предикатом (код 2), поэтому в деревьях,
// где проверяется ЗЕЛЁНЫЙ исход, всегда лежит невинный файл корпуса.
const PLAIN = { 'Plain.jsx': 'export const x = 1;\n' };

function runGuard(files) {
  const dir = mkdtempSync(join(tmpdir(), 'timearith-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      const p = join(dir, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
    try {
      return { code: 0, out: execFileSync('node', [GUARD, dir], { encoding: 'utf8' }) };
    } catch (e) {
      return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('КРАСНЫЙ: люксоновская разность в минутах вне дома', () => {
  // Ровно та строка, которой панель трансфера показывала 2 ч 10 мин вместо 1 ч 10.
  const r = runGuard({ ...HOME, 'Panel.jsx': "const m = Math.round(e.diff(s, 'minutes').minutes);\n" });
  assert.equal(r.code, 1);
  assert.match(r.out, /Panel\.jsx:1/);
});

test('КРАСНЫЙ: разность в часах — та же единица беды', () => {
  const r = runGuard({ ...HOME, 'Row.jsx': 'const h = b.diff(a, "hours").hours;\n' });
  assert.equal(r.code, 1);
});

test('КРАСНЫЙ: своя пара скобок в первом аргументе не прячет единицу', () => {
  // Предикат «от .diff( до первой )» на такой строке молчал — единица лежит за
  // скобкой вложенного вызова.
  const r = runGuard({ ...HOME, 'Nested.jsx': "const m = e.diff(s.startOf('hour'), 'minutes').minutes;\n" });
  assert.equal(r.code, 1);
});

test('КРАСНЫЙ: те же минуты, посчитанные делением миллисекунд', () => {
  const r = runGuard({ ...HOME, 'Row.jsx': 'const m = (b.toMillis() - a.toMillis()) / 60000;\n' });
  assert.equal(r.code, 1);
  const underscored = runGuard({ ...HOME, 'Row.jsx': 'const h = (b - a) / 3_600_000;\n' });
  assert.equal(underscored.code, 1);
});

test('ЗЕЛЁНЫЙ: то же самое В ДОМЕ правила — это и есть его работа', () => {
  const r = runGuard({ ...PLAIN, 'lib/time.js': "const m = Math.round(e.diff(s, 'minutes').minutes);\n" });
  assert.equal(r.code, 0);
});

test('ЗЕЛЁНЫЙ: вызов двери длительности вместо своей арифметики', () => {
  const r = runGuard({ ...HOME, 'Panel.jsx': "const dur = transferDuration(tr, fromVisit, toVisit, t);\n" });
  assert.equal(r.code, 0);
});

test('ПЕРИМЕТР: сутки и недели — мимо НАМЕРЕННО (их пояса как раз портят)', () => {
  const r = runGuard({
    ...HOME,
    'Days.jsx': "const n = co.startOf('day').diff(ci.startOf('day'), 'days').days;\n"
              + 'const d = (new Date(b) - new Date(a)) / 86_400_000;\n'
              + "const w = a.diff(b, 'weeks').weeks;\n",
  });
  assert.equal(r.code, 0);
});

test('ПЕРИМЕТР: сортировочный компаратор дат — не длительность', () => {
  const r = runGuard({ ...HOME, 'Sort.jsx': 'rows.sort((a, b) => new Date(b.start) - new Date(a.start));\n' });
  assert.equal(r.code, 0);
});

test('ПЕРИМЕТР: упоминание в комментарии не считается кодом', () => {
  const r = runGuard({ ...HOME, 'Doc.jsx': "// раньше тут было diff(s, 'minutes') и деление / 60000\n" });
  assert.equal(r.code, 0);
});

test('ПЕРИМЕТР: тесты вне корпуса — фикстуре можно называть запрещённое', () => {
  const r = runGuard({ ...HOME, ...PLAIN, 'Panel.test.js': "assert.equal(e.diff(s, 'minutes').minutes, 70);\n" });
  assert.equal(r.code, 0);
});

test('ЗЕЛЁНЫЙ: маркер-исключение снимает строку', () => {
  const r = runGuard({
    ...HOME,
    'Anim.jsx': 'const frames = (end - start) / 60000; // time-arith-exempt: длительность анимации, не даты\n',
  });
  assert.equal(r.code, 0);
});

test('ОТКАЗ (2): дом правила уехал — мерить нечем, это не «чисто»', () => {
  const r = runGuard({ 'Panel.jsx': 'const x = 1;\n' });
  assert.equal(r.code, 2);
  assert.match(r.out, /дом правила/);
});

test('ОТКАЗ (2): пустой корпус — сломанный предикат, а не зелёный прогон', () => {
  const r = runGuard({ ...HOME, 'readme.md': 'нет исходников\n' });
  assert.equal(r.code, 2);
});
