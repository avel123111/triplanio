// ═══════════════════════════════════════════════════════════════════════════
// Предикат Ф1.2 (TRIP-475): печатает СИНХРОННЫЕ цепочки импорта от main.jsx до
// любого файла, который статически тянет `@/design` (или `@/design/index`).
//
// ЗАЧЕМ. `app.css` попадает в render-blocking entry-CSS не по РЕНДЕРУ компонента,
// а по ИМПОРТУ: достаточно статического `import { X } from '@/design'` где-то в
// синхронном графе от `main.jsx`, и весь слой ДС приезжает в главный чанк — даже
// если X никогда не отрисуется на лендинге. Поэтому Ф1.1 (перенос `app.css` в ДС
// одной строкой) физически не сработает, пока этот список не станет ПУСТ.
//
// Выход 1 при непустом списке → кандидат в CI-гард после Ф1.1: первый же
// `import { Btn }` в синхронном графе тихо вернёт `app.css` в entry, и без этой
// проверки никто не заметит.
//
// ★ Только СТАТИКА: `import()` рвёт чанк и нас не касается — он намеренно вне.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('../../src/', import.meta.url).pathname;
const resolve = (from, spec) => {
  let p = spec.startsWith('@/') ? path.join(root, spec.slice(2))
    : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!p) return null;
  for (const e of ['', '.jsx', '.js', '.ts', '.tsx', '/index.jsx', '/index.js']) {
    const c = p + e;
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
};
const parent = new Map(), seen = new Set(), hits = [];
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
function walk(file) {
  if (seen.has(file) || file.endsWith('.css')) return;
  seen.add(file);
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  // import И export-from: `export { X } from '@/design'` — такой же синхронный
  // вход в чанк, как import; слепота к ре-экспорту = латентная дыра ценой 8 байт.
  for (const m of strip(raw).matchAll(/^\s*(?:import|export)\s+(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm)) {
    if (/^@\/design(\/index)?$/.test(m[1])) hits.push(file);
    const t = resolve(file, m[1]);
    if (t && !parent.has(t)) parent.set(t, file);
    if (t) walk(t);
  }
}
const entry = path.join(root, 'main.jsx');
walk(entry);
const chain = (f) => {
  const c = [];
  let x = f;
  while (x && x !== entry) { c.unshift(path.relative(root, x)); x = parent.get(x); }
  return 'main.jsx → ' + c.join(' → ');
};
const uniq = [...new Set(hits)].sort();
console.log(uniq.length ? uniq.map(chain).join('\n') : 'синхронных потребителей @/design: 0');
process.exit(uniq.length ? 1 : 0);
