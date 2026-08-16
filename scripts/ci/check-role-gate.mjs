#!/usr/bin/env node
// ГАРД (блокирующий, TRIP-274 Ф2.1): на фронте право по трипу выводится ТОЛЬКО
// через лестницу доступа `src/lib/tripStep.js` (`resolveMyStep` + `clearsStep`),
// зеркало серверного `_shared/tripStep.ts`. Ни один компонент не решает право
// сам — сравнением роли со строкой (`myRole === 'admin'`) или владением
// (`x === trip.created_by`). Гейты сведены (метрика дошла до нуля), и этот гард
// НЕ ДАЁТ зоопарку вернуться: следующий PR с рукописным гейтом падает в CI.
//
// Что ловит:
//   • голый `role`/`myRole`/`myStep` == строка роли (viewer/admin/owner/editor/participant)
//   • сравнение с `trip.created_by` (владелец мимо ступени owner)
// Что НЕ ловит (по построению — это НЕ гейты права вызывающего):
//   • `.role` РЯДА (`m.role`, `member.role`) — показ/сортировка/поиск участника
//   • `d.created_by === user.id` — принадлежность КОНТЕНТА (свои доки), не роль
//   • канонические резолверы `src/lib/tripStep.js` и `src/lib/members.js`
//   • строки с маркером `role-gate-exempt` — легитимный показ роли (ярлык/бейдж)
//
// Escape: `// role-gate-exempt: <причина>` в той же строке. Маркер живёт в диффе,
// каждое исключение видно на ревью (та же конвенция, что inline-style-exempt).
//
// Гард — код, у него есть тест: `check-role-gate.test.mjs` (temp-дерево,
// подпроцесс, код выхода). Зелёный тест ничего не значит, пока не увидел красным.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, basename, resolve } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// argv[2] — необязательный корень скана (для теста гарда); по умолчанию `src`.
const TARGET = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'src');

// Канонические резолверы: тут право и ЖИВЁТ, им сравнивать роль/владение можно.
const CANON = new Set(['tripStep.js', 'members.js']);

// Голый идентификатор role/myRole/myStep (НЕ `.role` ряда) == строка роли.
const ROLE_GATE = /(?<![\w.])(?:myRole|myStep|role)\s*[!=]==\s*['"](?:viewer|admin|owner|editor|participant)['"]/;
// Сравнение с владельцем трипа (не `d.created_by` контента).
const OWN_GATE = /trip\??\.created_by\s*===|===\s*[\w?.]*trip\??\.created_by/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of walk(TARGET)) {
  if (CANON.has(basename(file))) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    if (line.includes('role-gate-exempt')) return;
    if (ROLE_GATE.test(line) || OWN_GATE.test(line)) {
      violations.push(`${relative(ROOT, file)}:${i + 1}: ${trimmed}`);
    }
  });
}

if (violations.length) {
  console.error(
    `[check-role-gate] ${violations.length} рукописный гейт права мимо лестницы ` +
    `src/lib/tripStep.js (clearsStep). Сведи в лестницу или, если это ПОКАЗ роли ` +
    `(а не гейт), пометь строку \`// role-gate-exempt: <причина>\`:\n`,
  );
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}

console.log('[check-role-gate] OK — гейтов права мимо лестницы нет.');
