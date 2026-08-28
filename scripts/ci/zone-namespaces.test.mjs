/**
 * Набор словарей, который ждёт первый кадр зоны, обязан покрывать всё, что зона
 * рисует (TRIP-445).
 *
 * ЗАЧЕМ. Готовность языка была «все 48 словарей загружены», и это ждал каждый
 * первый кадр, включая лендинг. Теперь первый кадр отпускается после ШЕСТИ
 * (`src/lib/i18n/zoneNamespaces.js`), остальные догружаются фоном, а экраны
 * приложения ждут полного словаря отдельным гейтом в `App.jsx`.
 *
 * Цена ошибки в наборе — сырой ключ на экране у посетителя, и увидеть его можно
 * только глазами на нужном языке в нужный момент. Поэтому набор сверяется с
 * ДЕРЕВОМ, а не поддерживается вручную.
 *
 * ПРЕДИКАТ. Считаем не вызовы `t('ns.key')`, а ВСЕ строковые литералы вида
 * `ns.key`, где `ns` — имя реального файла словаря. Так в счёт попадают ключи,
 * лежащие в данных (`demoTrip.js`: `{ tKey: 'landing.demo.…' }`) и собираемые в
 * рантайме из префикса (`` t(`${ns}.eyebrow`) `` при `ns = 'landing.fin'`).
 * Замерено: вызовов `t()` с нелитеральным аргументом в зоне 52 — предикат по
 * вызовам не увидел бы ни одного из них.
 *
 * ПЕРИМЕТР — общий (`zone-perimeter.mjs`), плюс баннер согласия: он компонент
 * ПРИЛОЖЕНИЯ, но смонтирован вне роутера и стоит на каждой странице зоны, и
 * `authErrorText.js` — тексты ошибок входа живут там.
 *
 * ⚠️ МУТАЦИИ, КОТОРЫМИ ТЕСТ ПРОВЕРЕН КРАСНЫМ: убрать `consent` из набора —
 * падает («зона рисует, набор не покрывает»); дописать в набор несуществующий
 * словарь — падает вторая проверка; сузить периметр до одного файла — падает
 * проверка достижимости.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_ZONE, assertZonePerimeter } from './zone-perimeter.mjs';
import { ZONE_NAMESPACES } from '../../src/lib/i18n/zoneNamespaces.js';

const EXTRA = ['src/components/ConsentBanner.jsx', 'src/lib/authErrorText.js'];
const LOCALES = 'src/lib/i18n/locales/en';

const filesOf = (p) => {
  if (!existsSync(p)) return [];
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p).flatMap((f) => filesOf(join(p, f)));
};

const allFiles = [...SITE_ZONE, ...EXTRA]
  .flatMap(filesOf)
  .filter((f) => /\.(jsx?|mjs)$/.test(f) && !f.endsWith('.test.js'));

const known = new Set(readdirSync(LOCALES).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));

/** Все namespace'ы, встречающиеся в дереве зоны как литерал `ns.что-то`. */
function usedNamespaces() {
  const out = new Map(); // ns -> файлы
  for (const f of allFiles) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/['"`]([a-z_0-9]+)\.([a-z_0-9.]+)['"`]/g)) {
      if (known.has(m[1])) {
        if (!out.has(m[1])) out.set(m[1], new Set());
        out.get(m[1]).add(f);
      }
    }
  }
  return out;
}

test('★ БАЗА ДОСТИЖИМА: периметр цел, словари на месте, файлы читаются', () => {
  assertZonePerimeter();
  assert.ok(known.size > 20, `в ${LOCALES} найдено ${known.size} словарей — путь сломан`);
  assert.ok(allFiles.length > 10, `в периметре зоны ${allFiles.length} файлов — периметр сузился`);
  assert.ok(usedNamespaces().size > 0, 'в дереве зоны не нашлось ни одного ключа i18n — предикат сломан');
});

test('★★★ набор покрывает КАЖДЫЙ словарь, который зона реально рисует', () => {
  const used = usedNamespaces();
  const missing = [...used.keys()].filter((ns) => !ZONE_NAMESPACES.includes(ns)).sort();
  assert.deepEqual(
    missing,
    [],
    `зона рисует ключи из ${missing.join(', ')}, а первый кадр их не ждёт — на экране будут СЫРЫЕ КЛЮЧИ.\n`
    + missing.map((ns) => `  ${ns}: ${[...used.get(ns)].join(' ')}`).join('\n')
    + '\n  Лечение: дописать словарь в ZONE_NAMESPACES (src/lib/i18n/zoneNamespaces.js).',
  );
});

test('★★ в наборе нет лишнего: каждое имя — реальный файл словаря и правда используется', () => {
  const used = usedNamespaces();
  const unknown = ZONE_NAMESPACES.filter((ns) => !known.has(ns));
  assert.deepEqual(unknown, [], `в наборе имена, которых нет в словаре: ${unknown.join(', ')}`);

  // Лишнее имя не ломает экран, но возвращает в первый кадр лишний чанк —
  // то есть тихо отменяет смысл всей правки.
  const unused = ZONE_NAMESPACES.filter((ns) => !used.has(ns));
  assert.deepEqual(unused, [],
    `набор ждёт ${unused.join(', ')}, чего зона не рисует — лишний чанк в первом кадре`);
});
