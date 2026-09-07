import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// TRIP-520 — запись профиля имеет РОВНО ОДНУ дверь: `updateProfile` в
// AuthContext, владельце кэша `user`. Прод-дефект был в четырёх независимых
// писателях (имя, аватар ×2, язык/единицы), каждый из которых сам должен был
// помнить перечитать профиль после записи; четвёртый забыл — и смена языка
// залогиненным «ничего не делала» до перезагрузки страницы. Второй писатель
// тут не падает и не виден глазу: он молча пишет в БД мимо кэша.
//
// Тесты репо — грепы по исходникам (jsdom/react в зависимостях нет), поэтому
// инвариант держится СТРУКТУРНО: единственный вызов шва `account/profile` во
// всём src — в AuthContext. Появится второй — список перестанет быть
// одноэлементным и тест покраснеет.
function srcFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) srcFiles(full, out);
    else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\.[jt]sx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const CALLS_PROFILE_SEAM = /invokeFn\(\s*['"]account\/profile['"]/;

test('ровно одна дверь записи профиля во всём src — AuthContext.updateProfile', () => {
  const writers = srcFiles('src')
    .filter((f) => CALLS_PROFILE_SEAM.test(readFileSync(f, 'utf8')))
    .map((f) => f.split('\\').join('/'));
  assert.deepEqual(
    writers,
    ['src/lib/AuthContext.jsx'],
    'шов account/profile должен звать только AuthContext (updateProfile); найдено: ' + JSON.stringify(writers),
  );
});

// Форма ответа шва зависит от флагов действия (`mutate.ts`): с `returnChain` /
// `returnExpenses` — конверт `{ row, cities, transfers, expenses }`, без них —
// ГОЛАЯ записанная строка. Первая редакция двери читала `data.row` у действия
// без флагов, получала `undefined` и молча оставляла кэш прежним (тест на
// текст `data.row` был зелёным и доказывал не то свойство). Поэтому пинятся
// ОБЕ стороны контракта: у `account/profile` флагов нет ⇔ дверь кладёт в
// `user` сам `data`, а не `data.row`.
test('дверь сверяет кэш по ОТВЕТУ шва — голой строке действия без флагов', () => {
  const spec = readFileSync('supabase/functions/_shared/resources/account.ts', 'utf8');
  const profile = spec.slice(spec.indexOf('profile: {'), spec.indexOf('register: {'));
  assert.doesNotMatch(profile, /returnChain|returnExpenses/, 'account/profile обзавёлся флагом дочитывания — ответ стал конвертом, дверь обязана читать `data.row`');

  const src = readFileSync('src/lib/AuthContext.jsx', 'utf8');
  const body = src.slice(src.indexOf('const updateProfile'), src.indexOf('const logout'));
  assert.match(body, /setUser\([\s\S]*?\.\.\.data\s*\}/, 'updateProfile обязан класть голую строку ответа (`...data`) в `user`');
  assert.doesNotMatch(body, /data\.row/, 'у account/profile нет флагов дочитывания — `data.row` там undefined');
  assert.doesNotMatch(body, /checkUserAuth|loadUserProfile/, 'запись профиля не должна перечитывать профиль вторым кругом');
});
