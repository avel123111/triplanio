/**
 * Периметр зоны — ОДИН на все её гарды (TRIP-445).
 *
 * ЧТО ИМЕННО СТОРОЖИТ ЭТОТ ТЕСТ. Не «список правильный» (это вкус), а «список
 * ОДИН». Периметр был выписан трижды и все три раза по-разному: 2ad знал семь
 * путей, 2ab — пять, 2ae — два. Каждый PR Ф6 дописывал себя в тот гард, который
 * в тот день покраснел, и расхождение молча становилось вердиктом: гард отвечал
 * «чисто» про дерево, половину которого не открывал. Прогон 2ae с полным
 * периметром сразу дал две настоящие утечки в PublicTrip.jsx.
 *
 * Поэтому здесь два разных предиката:
 *   · периметр цел (пути существуют) — иначе гард смотрит в пустую комнату;
 *   · НИ ОДИН гард зоны не держит собственного списка путей — иначе завтра
 *     они разойдутся ровно так же, и тест про «список правильный» это пропустит.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SITE_ZONE } from './zone-perimeter.mjs';

/** Гарды, судящие дерево зоны. Все обязаны читать периметр отсюда. */
const ZONE_GUARDS = [
  'scripts/ci/check-site-nav.mjs',
  'scripts/ci/check-ds-boundary.mjs',
  'scripts/ci/check-site-primitive-dup.mjs',
];

test('★ ПЕРИМЕТР ЦЕЛ: каждый путь существует (пустая комната = красный, не пропуск)', () => {
  assert.ok(SITE_ZONE.length >= 7, `периметр из ${SITE_ZONE.length} путей — зону тихо сузили?`);
  const missing = SITE_ZONE.filter((p) => !existsSync(p));
  assert.deepEqual(missing, [], `путей нет: ${missing.join(', ')}`);
});

test('периметр покрывает ВСЕ восемь маршрутов зоны', () => {
  // Один путь на страницу; каталоги покрывают по нескольку файлов сразу.
  for (const page of ['src/pages/Landing', 'src/pages/Demo', 'src/pages/Legal.jsx',
    'src/pages/PublicTrip.jsx', 'src/pages/Login.jsx', 'src/pages/JoinTrip.jsx',
    'src/components/site']) {
    assert.ok(SITE_ZONE.includes(page), `${page} вне периметра — его гарды не судят`);
  }
});

test('★★★ НИ ОДИН гард зоны не держит СВОЙ список путей', () => {
  const offenders = [];
  for (const g of ZONE_GUARDS) {
    const src = readFileSync(g, 'utf8');
    assert.match(src, /from '\.\/zone-perimeter\.mjs'/, `${g} не импортирует общий периметр`);
    // Собственный массив путей — то, из-за чего списки и разошлись. Ищем
    // литерал `src/pages/…` или `src/components/site` в КОДЕ, не в комментарии.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const own = [...code.matchAll(/'(src\/(?:pages|components)\/[^']+)'/g)].map((m) => m[1]);
    if (own.length) offenders.push(`${g}: ${own.join(', ')}`);
  }
  assert.deepEqual(
    offenders,
    [],
    'гард выписал путь зоны у себя — так списки и разъезжаются:\n  ' + offenders.join('\n  '),
  );
});

test('исчезнувший путь роняет гард кодом 2, а не проходит молча', () => {
  // Предикат зовёт process.exit — значит проверяется подпроцессом (шаблон
  // check-inline-styles.test.mjs): зелёный тест на такой вещи ничего не значит,
  // пока не увидел её красной.
  const dir = mkdtempSync(join(tmpdir(), 'zone-perim-'));
  const probe = join(dir, 'probe.mjs');
  const mod = join(process.cwd(), 'scripts/ci/zone-perimeter.mjs');
  writeFileSync(probe, `import { assertZonePerimeter } from ${JSON.stringify(mod)};\n`
    + "assertZonePerimeter('probe', ['src/pages/ThisDoesNotExist.jsx']);\n"
    + "console.log('НЕ ДОЛЖНО ДОЙТИ');\n");
  let code = 0, out = '';
  try {
    out = execFileSync(process.execPath, [probe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    code = e.status; out = String(e.stderr || '') + String(e.stdout || '');
  }
  assert.equal(code, 2, `ожидался код 2, получен ${code}\n${out}`);
  assert.match(out, /не существует/);
  assert.doesNotMatch(out, /НЕ ДОЛЖНО ДОЙТИ/);
});
