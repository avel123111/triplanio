import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// TRIP-515, п.2 — <html lang> имеет РОВНО ОДНОГО владельца: слой i18n
// (I18nContext). Прод-дефект был в двух владельцах: SiteChrome ставил атрибут для
// зоны, а его очистка при уходе с лендинга ВОЗВРАЩАЛА его на "en" — и в
// приложении lang навсегда оставался английским (повод для автоперевода, который
// ломал DOM). Второй владелец тут не падает и не виден глазу: он просто тихо
// перетирает язык. Поэтому инвариант держит тест, а не внимательность.
//
// Тесты репо — грепы по исходникам (jsdom/react в зависимостях нет), поэтому
// проверяем СТРУКТУРНО: единственная запись documentElement.lang во всём src —
// в I18nContext. Появится второй писатель — этот список перестанет быть
// одноэлементным и тест покраснеет.
function srcFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) srcFiles(full, out);
    else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name)) out.push(full);
  }
  return out;
}

// Любая запись атрибута lang на корне документа: setAttribute('lang', …),
// removeAttribute('lang') или documentElement.lang = …
const WRITES_LANG =
  /documentElement\s*\.\s*setAttribute\(\s*['"]lang['"]|documentElement\s*\.\s*removeAttribute\(\s*['"]lang['"]|documentElement\s*\.\s*lang\s*=/;

test('ровно один владелец <html lang> во всём src — I18nContext', () => {
  const owners = srcFiles('src')
    .filter((f) => WRITES_LANG.test(readFileSync(f, 'utf8')))
    .map((f) => f.split('\\').join('/'));
  assert.deepEqual(
    owners,
    ['src/lib/i18n/I18nContext.jsx'],
    'владельцев <html lang> должно быть ровно один (I18nContext); найдено: ' + JSON.stringify(owners),
  );
});

test('SiteChrome больше не трогает <html lang> (снят второй владелец)', () => {
  const src = readFileSync('src/components/site/SiteChrome.jsx', 'utf8');
  assert.equal(
    /['"]lang['"]\s*\)/.test(src.match(/setAttribute\([^)]*\)|removeAttribute\([^)]*\)/g)?.join(' ') || ''),
    false,
    'SiteChrome снова пишет <html lang> — вернулся дефект «уход с лендинга откатывает язык на en»',
  );
});
