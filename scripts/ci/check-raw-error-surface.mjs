#!/usr/bin/env node
/**
 * CI guard 3b (TRIP-408 PR#2, контракт ошибок эпика TRIP-374).
 *
 * Клиент НИКОГДА не показывает пользователю сырой текст ошибки — `error.message`
 * (строка SDK «Edge Function returned a non-2xx…» или английский текст БД).
 * Канон — `classifyError(t, code)` / `errorText(t, code)`: машинный `code` →
 * вычитанная локализованная строка. Сырых показов в дереве ещё несколько (долг:
 * auth-флоу Login, телеграм-тумблеры Settings, аплоад обложки и т.п.); этот гард
 * делает их ЧИСЛО видимым и не даёт ему расти — новый сырой показ в тронутом
 * файле краснеет.
 *
 * ── ЕДИНИЦА СЧЁТА (форма показа, не семантика) ──────────────────────────────
 * СТРОКА, где сырой `<expr>.message` попадает в пользовательский слот текста:
 *   • `{ message: … x.message }`         — интерполяция в i18n-обёртку / тост
 *   • `description: … x.message`         — тело тоста
 *   • `setErr…(… x.message …)`           — инлайн-состояние ошибки (setErr/setError/
 *                                          setErrorMsg/setAuthError)
 * Дедуп по СТРОКЕ: `{ message: … }` внутри `setErrorMsg(…)` — один показ, не два.
 * Комментарии гасятся (пример в шапке не считается показом).
 *
 * ── ХРАПОВИК ПО ДИФФУ, КАК 2w ───────────────────────────────────────────────
 * Бланкетный запрет покрасил бы легаси-долг на вводе. Поэтому сверяем ТОЛЬКО
 * тронутые файлы против их версии на BASE_REF: существующие показы
 * грандфазерятся, краснеет лишь РОСТ (новый файл = база 0). FP-чистота предиката
 * тут не критична — важен ДЕТЕРМИНИЗМ: один и тот же файл даёт одно и то же число
 * на обеих сторонах, поэтому ложный «показ» всё равно заморожен и растить его
 * нельзя. Whole-tree итог печатается для видимости (не ратчетится сам по себе).
 *
 * Escape: `// raw-error-exempt: <причина>` на строке показа или следующей — для
 * законного сырого текста (напр. диагностика разработчику), видимо в диффе.
 *
 * ★ГРАНИЦА ВСЛУХ: гард ловит `.message`-ФОРМУ показа, не всякий сырой текст
 * (напр. `data.code`-ветвление уже держит 2w; голый серверный `message`-var без
 * `.message` — отдельный заход). Названо здесь, не спрятано.
 *
 * Стандартная библиотека + git (джоба `guards` без `npm ci`).
 * Env: BASE_REF (default origin/dev). Неразрешимый ref → skip. Exit: 0/1/2.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BASE_REF = process.env.BASE_REF || 'origin/dev';
const EXEMPT = 'raw-error-exempt';
const SCANNED = /\.(jsx|tsx|js)$/;
const ROOT = 'src';
// Сырой `<expr>.message` в пользовательском слоте текста.
const PATTERNS = [
  /\b(?:message|description)\s*:\s*[^,}\n]*?\b\w+\??\.message\b/g,
  /\bset\w*[Ee]rr\w*\([^)\n]*?\b\w+\??\.message\b/g,
];

// TRIP-423 — ДОМЕНЫ С ЗАКРЫТОЙ ДВЕРЬЮ: экраны, полностью переведённые на контракт
// ошибок (`classifyError`/`errorText`/`uploadErrorText`). Здесь ноль АБСОЛЮТНЫЙ,
// не ратчет: любой сырой показ краснит PR, даже если файл не тронут. Сырьё тут
// двух форм — `.message` (PATTERNS выше) И голый серверный `message`,
// деструктуренный из `invokeFn` (эту форму PATTERNS не ловит: она без `.message`,
// см. «ГРАНИЦА ВСЛУХ» — invokeFn кладёт серверную прозу в корневой `message`).
const ZERO_TOLERANCE = [
  /^src\/pages\/MembersLens\.jsx$/,
  /^src\/pages\/SettingsLens\.jsx$/,
  /^src\/pages\/Pro\.jsx$/,
  /^src\/pages\/ManualPlanner\.jsx$/,
  /^src\/components\/create\/CreateTripProvider\.jsx$/,
  /^src\/pages\/DocsLens\.jsx$/,
];
// Деструктуринг `const { …, message } = await invokeFn(…)` — чтение серверной
// прозы в этих доменах запрещено (бери `code`, не `message`).
const INVOKE_MSG = /const\s*\{[^}]*\bmessage\b[^}]*\}\s*=\s*await\s+invokeFn/g;

const unknown = process.argv.slice(2).filter((a) => a !== '--');
if (unknown.length) {
  console.error(`::error::check-raw-error-surface: unknown flag ${unknown.join(' ')}.`);
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

/** Число НЕ-освобождённых строк-показов сырого `.message` (дедуп по строке). */
function scan(src, patterns = PATTERNS) {
  if (!src) return 0;
  const masked = blankComments(src);
  const lines = src.split('\n');
  const hitLines = new Set();
  for (const re of patterns) {
    for (const m of masked.matchAll(re)) {
      const from = masked.slice(0, m.index).split('\n').length - 1;
      if (lines.slice(from, from + 2).some((l) => l.includes(EXEMPT))) continue;
      hitLines.add(from);
    }
  }
  return hitLines.size;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SCANNED.test(name) && !/\.test\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

try {
  git(['rev-parse', '--verify', `${BASE_REF}^{commit}`]);
} catch {
  console.log(`check-raw-error-surface: BASE_REF ${BASE_REF} not resolvable — skipped.`);
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
  console.error(`::error::check-raw-error-surface: cannot diff against ${BASE_REF}: ${e.stderr || e.message}`);
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
      `${file.path}: ${now} сырых показов .message, ${file.base ? `${was} на ${BASE_REF}` : 'новый файл (база 0)'}` +
      '\n    → показывай текст через `classifyError(t, code).text` / `errorText(t, code)` из @/lib/errorText,' +
      `\n      а не \`error.message\`. Законный сырой текст освободи: // ${EXEMPT}: <причина>`,
    );
  }
}

// Whole-tree проход: итог для видимости (сам по себе не ратчетится) + абсолютный
// ноль для закрытых доменов (base-independent, TRIP-423 — краснит и нетронутый файл).
let total = 0;
const zeroErrors = [];
try {
  for (const f of walk(ROOT)) {
    const src = readFileSync(f, 'utf8');
    total += scan(src);
    if (ZERO_TOLERANCE.some((re) => re.test(f))) {
      const z = scan(src, [...PATTERNS, INVOKE_MSG]);
      if (z > 0) {
        zeroErrors.push(
          `${f}: ${z} сырых показов серверного message — домен закрыт (TRIP-423), здесь ноль абсолютный` +
          '\n    → показывай текст через `classifyError(t, code).text` / `errorText(t, code)`; бери `code`, не `message`.',
        );
      }
    }
  }
} catch { /* ignore */ }

if (errors.length || zeroErrors.length) {
  console.error('::error::check-raw-error-surface (3b): сырой error.message показан пользователю — см. контракт ошибок TRIP-400/423');
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  zeroErrors.forEach((e) => console.error(`  ✗ ${e}`));
  console.error(`  Всего сырых показов в ${ROOT}/: ${total} (цель — вниз).`);
  process.exit(1);
}

console.log(
  `check-raw-error-surface (3b): ${scanned} changed file(s) vs ${BASE_REF} — OK · сырых показов в ${ROOT}/: ${total} (не растёт) · ${ZERO_TOLERANCE.length} закрытых доменов = 0`,
);
process.exit(0);
