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

/** Файлы дерева `src/` с нужным расширением — периметр, в котором проверяемое
 *  могло бы всплыть вторым экземпляром.
 *
 *  ⚠️ САМИ ТЕСТЫ ИЗ ПЕРИМЕТРА ИСКЛЮЧЕНЫ, И ЭТО НЕ УДОБСТВО. Проверка ищет строки
 *  кода, а этот файл их ЦИТИРУЕТ — то есть без исключения он находил бы сам себя
 *  и краснел на собственном утверждении. Поймано трижды подряд (на `autoFocus`,
 *  на `transitionend`, на `setProperty`), поэтому вырезано ОДИН раз здесь, а не
 *  заплаткой в каждой проверке. Периметр — это продуктовый исходник. */
function filesWithExt(dir, ext, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) filesWithExt(full, ext, acc);
    else if (name.endsWith(ext) && !/\.test\.[jt]sx?$/.test(name)) acc.push(full);
  }
  return acc;
}
const jsxFiles = (dir) => filesWithExt(dir, '.jsx');
const jsFiles = (dir) => filesWithExt(dir, '.js');

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

test('коробка полноростной шторки берётся у ВИЗУАЛЬНОГО вьюпорта', () => {
  const css = readFileSync(join(SRC, 'design/app.css'), 'utf8');
  const rule = css.slice(css.indexOf('.sheet--full {'), css.indexOf('\n', css.indexOf('.sheet--full {')));
  // Прод-баг, стоивший двух заходов: `100dvh` и пара `top/bottom` считаются от
  // вьюпорта РАСКЛАДКИ, а его сжимает под клавиатуру только Chrome. На iOS
  // раскладка остаётся во весь экран, и Safari панорамирует визуальный вьюпорт к
  // полю в фокусе — унося приклеенную шторку вверх. Единственная величина,
  // верная на обеих платформах, — сам visualViewport.
  assert.ok(rule.includes('var(--vv-h'), 'высота от раскладки врёт на iOS: там её клавиатура не сжимает');
  assert.ok(rule.includes('var(--vv-top'), 'без смещения шторка не догонит уже случившееся панорамирование');
});

test('видимую область публикует ОДИН наблюдатель visualViewport', () => {
  const owner = readFileSync(join(SRC, 'lib/keyboardOpen.js'), 'utf8');
  assert.ok(owner.includes("setProperty('--vv-h'") && owner.includes("setProperty('--vv-top'"),
    'геометрию публикует тот же модуль, что уже слушает visualViewport');
  assert.ok(owner.includes("vv.addEventListener('scroll'"),
    'панорамирование меняет смещение БЕЗ resize — без этой подписки шторка узнает о сдвиге слишком поздно');

  // Второй ПУБЛИКАТОР разъедётся с первым молча: оба будут «работать», а числа
  // разойдутся — у них разные пороги, разная реакция на поворот и разный гейт по
  // типу указателя. Проверяется именно публикация, а не всякое чтение
  // `visualViewport`: `PeekSheet` читает его сам под свои детенты (высота нужна
  // ему числом в JS, а не переменной в CSS), и это отдельный, более старый долг —
  // не предмет этой проверки.
  const publishers = jsxFiles(SRC)
    .concat(jsFiles(SRC))
    .filter((f) => readFileSync(f, 'utf8').includes("setProperty('--vv-"))
    .map((f) => f.slice(SRC.length));
  assert.deepEqual(publishers, ['lib/keyboardOpen.js'], 'видимую область публикует ровно один модуль');
});

test('каретку ставит ПОВЕРХНОСТЬ, без доскролла и без ожиданий', () => {
  // Комментарии срезаются по той же причине, что и в проверке ниже: условия
  // ОБЪЯСНЕНЫ прозой прямо в этом файле, и сверка по сырому тексту зеленела бы от
  // объяснения даже после удаления кода (поймано мутацией, не чтением).
  const src = readFileSync(join(UI, 'PickerSheet.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /focus\(\{\s*preventScroll:\s*true\s*\}\)/,
    'фокус без preventScroll просит браузер доскроллить к полю, которое и так пришпилено');
  // ★ Ожидание анимации ЗАПРЕЩЕНО намеренно. Оно тут было и лечило симптом: пока
  // коробка считалась от раскладки, iOS уводил шторку независимо от момента
  // фокуса, поздний фокус лишь делал это реже. Вернуть таймер = вернуть веру в
  // то, что дело было в моменте.
  assert.ok(!/setTimeout|transitionend|animationend/.test(src),
    'ожидание = лечение симптома: причина в системе координат коробки, а не в моменте фокуса');
});

test('триггер пикера — НАСТОЯЩЕЕ поле: ничто не гасит клавиатуру', () => {
  const ac = readFileSync(join(UI, '../common/Autocomplete.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const branch = ac.slice(ac.indexOf('if (isPhone)'), ac.indexOf('<PickerSheet'));
  assert.ok(branch.length > 0, 'мобильная ветка не найдена — тест обязан читать то, что проверяет');
  // ОБА подавителя тут были, и оба ГАСЯТ клавиатуру на iOS: `readOnly` — прямо,
  // `preventDefault` на mousedown — косвенно (Safari читает его как отказ от
  // штатного фокуса и снимает право поднять клавиатуру с последующего focus()).
  // Именно так шторка открывалась пустой при полностью исправной геометрии.
  assert.ok(!branch.includes('readOnly'), 'в readOnly-поле клавиатуру не поднимают');
  assert.ok(!branch.includes('preventDefault'),
    'отказ от штатного фокуса снимает право поднять клавиатуру с программного focus()');
  assert.ok(branch.includes('onFocus='),
    'шторку распахивает НАТИВНЫЙ фокус поля — это и есть жест, который поднимает клавиатуру');
});

test('клавиатура поднимается ВНУТРИ ЖЕСТА: обе половины связки на месте', () => {
  // iOS Safari показывает клавиатуру, только если `focus()` вызван в обработчике
  // пользовательского события. Половины две, и каждая по отдельности бесполезна:
  // синхронный эффект без синхронного коммита фокусит несуществующее поле, а
  // синхронный коммит без синхронного эффекта откладывает фокус за пределы жеста.
  // Разрыв любой из них ТИХИЙ: шторка откроется, поля в фокусе не будет.
  const surface = readFileSync(join(UI, 'PickerSheet.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(surface.includes('useLayoutEffect('),
    'фокус обязан идти в коммите: обычный useEffect — уже отдельная задача, вне жеста');

  for (const rel of ['SearchSelect.jsx', '../common/Autocomplete.jsx']) {
    const engine = readFileSync(join(UI, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(engine, /flushSync\(\(\)\s*=>\s*set\w*Open\(true\)\)/,
      `${rel}: без синхронного коммита поля в момент тапа ещё нет в DOM`);
  }
});

test('движки не ставят фокус в шторке сами — это дело поверхности', () => {
  const ac = readFileSync(join(UI, '../common/Autocomplete.jsx'), 'utf8');
  // ⚠️ ПОРЯДОК ЗДЕСЬ — ЧАСТЬ ПРОВЕРКИ, А НЕ ОФОРМЛЕНИЕ. Комментарии срезаются
  // ПЕРВЫМИ, и только потом берётся блок: инвариант про КОД, а не про прозу, а
  // шапка компонента упоминает `<PickerSheet>` словами. Обратный порядок был
  // написан и оказался ЛОЖНО-ЗЕЛЁНЫМ по построению — срез начинался от упоминания
  // в шапке и захватывал весь файл вместе с объявлением пропа `autoFocus`.
  const code = ac.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const from = code.indexOf('<PickerSheet');
  const block = code.slice(from, code.indexOf('</PickerSheet>'));
  assert.ok(from > 0 && block.length > 0, 'блок шторки не найден — тест обязан читать то, что проверяет');
  assert.ok(!block.includes('autoFocus'),
    'autoFocus внутри шторки = фокус на монтировании, ровно тот дефект, что уносил поверхность');

  const ss = readFileSync(join(UI, 'SearchSelect.jsx'), 'utf8');
  assert.ok(ss.includes('autoFocus={!isPhone}'),
    'поле поиска общее для попапа и шторки: на десктопе каретка своя, на телефоне — от поверхности');
});

test('правило «есть поиск -> полный рост» записано условием, а не прибито намертво', () => {
  const src = readFileSync(join(UI, 'PickerSheet.jsx'), 'utf8');
  // Скин обязан зависеть от `search`: безусловный `sheet--full` растянул бы во
  // весь экран и список из трёх ролей, безусловное его отсутствие вернуло бы
  // дёрганье поисковым шторкам. Обе половины правила - в одном выражении.
  assert.match(src, /search\s*\?\s*'sheet--full'\s*:/);
});
