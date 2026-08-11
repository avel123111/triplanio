#!/usr/bin/env node
/**
 * CI guard 2w (TRIP-400, контракт ошибок 1а эпика TRIP-374).
 *
 * Дискриминант ОТКАЗА edge-вызова живёт в КОРНЕ результата `invokeFn`
 * (`{ data, error, code, message }`), НЕ внутри `data`. `data` — это форма
 * УСПЕШНОГО тела функции; читать статус ошибки как `res.data.code` / `res.data.ok`
 * — значит смотреть не туда: на сетевом/relay-сбое `data === null`, и `.data.ok`
 * молча падает в `undefined` (= «не ok») даже когда функция ответила успешно.
 * Типизация `invokeFn<T>` уже краснит `res.data.code` под `// @ts-check`, но
 * покрытие прагмой — храповик на 9 файлах; этот гард — механический бэкстоп на
 * ВЕСЬ `src/**`.
 *
 * ПОЧЕМУ ХРАПОВИК ПО ДИФФУ, А НЕ БЛАНКЕТНЫЙ ЗАПРЕТ. `.data.code` — не всегда
 * анти-паттерн: `ShareDialog` читает `last?.data?.code` как КОД ШАРИНГА (QR), а
 * не как дискриминант ошибки. Бланкетный греп покрасил бы легаси-поле. Поэтому,
 * как гард 2l, сверяем ТОЛЬКО тронутые файлы против их версии на `BASE_REF`:
 * существующие вхождения грандфазерятся, краснеет лишь РОСТ (в т.ч. новый файл =
 * база 0 — новый код не рождается грязным).
 *
 * ЕДИНИЦА СЧЁТА: `.data.code` / `.data?.code` / `.data.ok` / `.data?.ok` —
 * двухуровневый доступ через `.data`. Голый `data?.ok` (деструктуризация
 * результата) НЕ ловится намеренно: это ДРУГОЙ, легаси-контракт (`updateTripSettings`
 * отдаёт `{ ok }` телом), его свод к корню — отдельный доменный заход.
 * Комментарии гасятся (иначе строка-пример в шапке `invokeFn.js` считалась бы
 * эмиссией).
 *
 * Escape: `// invoke-discriminant-exempt: <причина>` на строке доступа или
 * следующей — для законного `.data.code`-поля (как QR у шаринга), видимо в диффе.
 *
 * Env: BASE_REF (default origin/dev). Неразрешимый ref → skip, не догадка.
 * Exit: 0 ok, 1 рост, 2 внутренняя ошибка.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'invoke-discriminant-exempt';
const SCANNED = /\.(jsx|tsx|js)$/;
// `.data.ok` / `.data?.code` — доступ к дискриминанту ЧЕРЕЗ `.data`.
const PATTERN = /\.data\??\.(?:code|ok)\b/g;

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-invoke-discriminant: unknown flag ${unknown.join(' ')}.`);
  process.exit(2);
}

const git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

/** Гасит комментарии, сохраняя длину/переводы строк (offsets валидны). */
function blankComments(src) {
  const out = src.split('');
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '/' && src[i + 1] === '/' && ![':', '"', "'", '`'].includes(src[i - 1])) {
      while (i < src.length && src[i] !== '\n') out[i++] = ' ';
    } else if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] !== '\n') out[i] = ' ';
      i--;
    }
  }
  return out.join('');
}

/** Число НЕ-освобождённых `.data.(code|ok)` в файле (комментарии погашены). */
function scan(src) {
  if (!src) return 0;
  const masked = blankComments(src);
  const lines = src.split('\n');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length - 1;
  let count = 0;
  for (const m of masked.matchAll(PATTERN)) {
    const from = lineOf(m.index);
    const to = lineOf(m.index + m[0].length);
    if (lines.slice(from, to + 2).some((l) => l.includes(EXEMPT))) continue;
    count++;
  }
  return count;
}

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  console.log(`check-invoke-discriminant: BASE_REF ${BASE_REF} not resolvable — skipped.`);
  process.exit(0);
}

process.chdir(git(['rev-parse', '--show-toplevel']).trim());

let touched;
try {
  touched = git(['diff', '--name-status', '--find-renames', `${BASE_REF}...HEAD`, '--', 'src/'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, a, b] = line.split('\t');
      if (status.startsWith('R')) return { path: b, base: a };
      if (status.startsWith('D')) return null;
      return { path: a, base: status === 'A' ? null : a };
    })
    .filter((f) => f && SCANNED.test(f.path));
} catch (e) {
  console.error(`::error::check-invoke-discriminant: cannot diff against ${BASE_REF}: ${e.stderr || e.message}`);
  process.exit(2);
}

const baseContent = (path) => {
  if (!path) return null;
  try { return git(['show', `${BASE_REF}:${path}`]); } catch { return null; }
};

const errors = [];
let scanned = 0;
for (const file of touched) {
  if (!existsSync(file.path)) continue;
  const now = scan(readFileSync(file.path, 'utf8'));
  const was = scan(baseContent(file.base));
  scanned++;
  if (now > was) {
    errors.push(
      `${file.path}: ${now} доступ(ов) .data.code/.data.ok, ${file.base ? `${was} на ${BASE_REF}` : 'новый файл (база 0)'}` +
      '\n    → дискриминант отказа в КОРНЕ результата invokeFn: читай `const { data, error, code } = await invokeFn(…)`' +
      `\n      и ветвись по \`code\`/\`error\`, не по \`res.data.code\`. Легаси-поле (QR и т.п.) освободи: // ${EXEMPT}: <причина>`,
    );
  }
}

if (errors.length) {
  console.error('::error::check-invoke-discriminant: дискриминант читается из .data — см. контракт ошибок TRIP-400');
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}

console.log(
  scanned
    ? `check-invoke-discriminant (2w): ${scanned} changed file(s) checked against ${BASE_REF} — OK`
    : `check-invoke-discriminant (2w): no source files touched against ${BASE_REF} — nothing to check`,
);
process.exit(0);
