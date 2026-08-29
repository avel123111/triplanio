import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Отметка «прочитано» у чата — ОДНА реализация на обе поверхности (линзу и
 * виджет).
 *
 * ЗАЧЕМ ТЕСТ. Сам upsert в `chat_reads` тривиален, и именно поэтому его дважды
 * писали прямо в экранах. Нетривиально другое — КОГДА двигать метку, — и вот на
 * этом две копии молча разъехались: линза перечитывала метку на каждое новое
 * сообщение, а виджет ставил её один раз, в момент раскрытия панели. Открытый
 * виджет в переписке с ассистентом (каждый ответ бота = сообщение ОТ ДРУГОГО
 * автора) продолжал копить непрочитанные прямо под носом у читателя, и бейдж в
 * левом меню рос до тех пор, пока виджет не свернут и не развёрнут заново.
 *
 * Увидеть такой регресс глазами нельзя: чат при нём работает, врёт только цифра
 * рядом. Скриншота у поведения нет, поэтому гейт здесь — исходники текстом
 * (приём `Layout.test.js` / `ErrorBoundary.test.js`): проверяется не значение, а
 * КОНСТРУКЦИЯ, из-за которой баг стал возможен.
 *
 * ⚠️ ЗАЩИТА ОТ ИНЕРТНОСТИ: каждый разбор обязан падать громко. Не нашли хук, не
 * нашли список зависимостей — тест красный, а не «нечего сверять, значит сошлось».
 */

const SURFACES = {
  'линза': 'src/pages/ChatLens.jsx',
  'виджет': 'src/components/chat/ChatWidget.jsx',
};
const SEAM = 'src/lib/chat.js';

function jsFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.jsx?$/.test(e.name) && !e.name.endsWith('.test.js'))
    .map((e) => join(e.parentPath ?? e.path, e.name));
}

test('писатель метки прочтения в src/** ровно один — шов chat.js', () => {
  const writers = jsFiles('src').filter((f) => readFileSync(f, 'utf8').includes("from('chat_reads')"));

  assert.deepEqual(writers, [SEAM],
    `отметку «прочитано» пишет не только шов: ${writers.join(', ')}. `
    + 'Собственный upsert в экране — это вторая копия правила «когда двигать метку», '
    + 'ровно та конструкция, из-за которой открытый виджет копил непрочитанные.');
});

test('обе поверхности чата отмечают прочтение через общий хук и ведут его за хвостом ленты', () => {
  for (const [name, path] of Object.entries(SURFACES)) {
    const call = readFileSync(path, 'utf8').match(/useMarkChatRead\([^;]*\);/)?.[0];
    assert.ok(call, `${name} (${path}) не зовёт useMarkChatRead — отметка прочтения уехала из шва`);
    assert.ok(call.includes('tailId'),
      `${name} не передаёт tailId: метка обязана ехать за ХВОСТОМ ленты. `
      + 'Ключ на msgs.length двигал её и при подгрузке старой страницы (запись без причины), '
      + 'а без ключа вовсе — не двигал при новом сообщении (тот самый баг).');
  }

  // У виджета есть закрытое состояние, и в нём отмечать прочтение нельзя —
  // иначе бейдж не загорится никогда. У линзы поверхность всегда активна.
  assert.ok(readFileSync(SURFACES['виджет'], 'utf8').match(/useMarkChatRead\([^;]*active:[^;]*\);/),
    'виджет не передаёт active — закрытая панель начнёт гасить непрочитанные');
});

test('эффект useMarkChatRead перезапускается на новое сообщение и на смену активности', () => {
  const seam = readFileSync(SEAM, 'utf8');
  const start = seam.indexOf('export function useMarkChatRead');
  assert.notEqual(start, -1, 'в шве нет useMarkChatRead — форма файла изменилась, сверка ослепла');
  const body = seam.slice(start, seam.indexOf('\n}', start));

  const deps = body.match(/\}, \[([^\]]*)\]\);/)?.[1];
  assert.ok(deps, 'не найден список зависимостей эффекта в useMarkChatRead');

  const named = deps.split(',').map((d) => d.trim());
  for (const dep of ['active', 'tailId']) {
    assert.ok(named.includes(dep),
      `${dep} выпал из зависимостей эффекта: метка перестанет двигаться `
      + `${dep === 'tailId' ? 'на новое сообщение' : 'при появлении/уходе поверхности'}`);
  }
});
