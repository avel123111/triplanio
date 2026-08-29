/**
 * ПОВЕРХНОСТЬ ПИКЕРА ОДНА (TRIP-484 §4).
 *
 * ★ ЗАЧЕМ ЭТОТ ФАЙЛ. Правило «есть поиск -> шторка во весь рост, поле пришпилено»
 * не имеет ни скриншота, ни гарда: оно живёт в ОДНОЙ строке `PickerSheet` и в
 * одном скине `.sheet--full`. Ровно поэтому оно и разъедется молча - как уже
 * разъехались две копии `CityPicker`, отличавшиеся ключом строки и страной. Тут
 * пиннится не вид (его проверяют глазами на превью), а ЕДИНСТВЕННОСТЬ дома
 * правила: пока `sheet--full` пишется в одном месте, а оба движка выбора ходят
 * через одну поверхность, разъехаться нечему.
 *
 * ⚠️ Проверка СТАТИЧЕСКАЯ, по исходникам, и это её граница: она докажет, что
 * второго дома у правила нет, и НЕ докажет, что шторка выглядит верно. Второе -
 * задача глаз на превью, и подменять его зелёным тестом нельзя.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const UI = fileURLToPath(new URL('.', import.meta.url));

/** Все `.jsx` дерева `src/` — периметр разметки, в котором скин мог бы всплыть. */
function jsxFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) jsxFiles(full, acc);
    else if (name.endsWith('.jsx')) acc.push(full);
  }
  return acc;
}

test('скин полноростной шторки объявлен РОВНО В ОДНОЙ разметке — PickerSheet', () => {
  const carriers = jsxFiles(SRC).filter((f) => readFileSync(f, 'utf8').includes('sheet--full'));
  assert.deepEqual(
    carriers.map((f) => f.slice(SRC.length)),
    ['components/ui/PickerSheet.jsx'],
    'второй носитель `sheet--full` = второе место, где записано правило «поиск -> полный рост»',
  );
});

test('оба движка выбора берут мобильную поверхность у PickerSheet, а не собирают свою', () => {
  for (const rel of ['SearchSelect.jsx', '../common/Autocomplete.jsx']) {
    const src = readFileSync(join(UI, rel), 'utf8');
    assert.ok(
      src.includes("from '@/components/ui/PickerSheet'"),
      `${rel}: мобильная поверхность обязана приходить из PickerSheet`,
    );
    assert.ok(
      !src.includes("from '@/components/ui/Sheet'"),
      `${rel}: прямой <Sheet> в движке выбора = своя сборка поверхности в обход правила`,
    );
  }
});

test('корень шторки выбирается по ГЛУБИНЕ вложенности, а не берётся один на всех', () => {
  const src = readFileSync(join(UI, 'sheetShell.jsx'), 'utf8');
  // Промах здесь не падает и не краснеет ни в одном прогоне: `NestedRoot` вне
  // родителя не бросает (в дефолтном контексте vaul нужный колбэк — заглушка),
  // а обычный корень внутри родителя просто не сообщает ему об открытии. Ровно
  // поэтому выбор пиннится тут: у него нет другого свидетеля.
  assert.match(src, /depth\s*>\s*0\s*\?\s*Drawer\.NestedRoot\s*:\s*Drawer\.Root/);
  assert.ok(
    src.includes('SheetDepth.Provider'),
    'без провайдера глубина не растёт, и вложенная шторка навсегда останется «первой»',
  );
});

test('правило «есть поиск -> полный рост» записано условием, а не прибито намертво', () => {
  const src = readFileSync(join(UI, 'PickerSheet.jsx'), 'utf8');
  // Скин обязан зависеть от `search`: безусловный `sheet--full` растянул бы во
  // весь экран и список из трёх ролей, безусловное его отсутствие вернуло бы
  // дёрганье поисковым шторкам. Обе половины правила - в одном выражении.
  assert.match(src, /search\s*\?\s*'sheet--full'\s*:/);
});
