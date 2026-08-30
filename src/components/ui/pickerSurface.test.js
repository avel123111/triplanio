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

/** Полноэкранные фиксированные поверхности приложения. Их ДВЕ, и это одна и та
 *  же вещь: шторка пикера с поиском и оболочка панелей редактора. */
const FULL_SURFACES = ['.sheet--full', '.lp-sheet'];

/** Правила, объявляющие КОРОБКУ (`top`/`bottom`/`height`) у названного субъекта.
 *  Субъект — точное совпадение части селектора: `.lp-sheet > .lp` это ПОТОМОК,
 *  у него своя коробка (`height: 100%`) и к вьюпорту она отношения не имеет.
 *  Комментарии снимаются до разбора: маркеры обходов сами содержат `{…}`. */
function boxRules(css, subjects) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: sel.trim(), body }))
    .filter((r) => r.sel.split(',').some((s) => subjects.includes(s.trim()))
      && /(^|[;{\s])(top|bottom|height)\s*:/.test(r.body));
}

test('коробка ПОЛНОЭКРАННОЙ поверхности берётся у ВИЗУАЛЬНОГО вьюпорта, и правило ОДНО', () => {
  const css = readFileSync(join(SRC, 'design/app.css'), 'utf8');
  const rules = boxRules(css, FULL_SURFACES);

  // ★ ЕДИНСТВЕННОСТЬ — ЭТО И ЕСТЬ ПРОВЕРЯЕМОЕ. Поверхностей две, и они уже
  // разъезжались: коробку от визуального вьюпорта получила только шторка пикера,
  // а панель редактора осталась на раскладке и на iOS уходила за оба края
  // видимой полосы (замер: панель 0→844 при видимом 120→600, поле в её низу —
  // целиком под клавиатурой). Второе правило разъедется так же и так же молча.
  assert.equal(rules.length, 1,
    `коробку полноэкранной поверхности объявляет ровно одно правило; найдено ${rules.length}: ${rules.map((r) => r.sel).join(' | ')}`);

  const [rule] = rules;
  for (const s of FULL_SURFACES) {
    assert.ok(rule.sel.split(',').map((x) => x.trim()).includes(s),
      `${s} обязана брать коробку из ОБЩЕГО правила, а не из своего`);
  }

  // Прод-баг, стоивший двух заходов: `100dvh` и пара `top/bottom` считаются от
  // вьюпорта РАСКЛАДКИ, а его сжимает под клавиатуру только Chrome. На iOS
  // раскладка остаётся во весь экран, и Safari панорамирует визуальный вьюпорт к
  // полю в фокусе — унося приклеенную поверхность вверх. Единственная величина,
  // верная на обеих платформах, — сам visualViewport.
  assert.ok(rule.body.includes('var(--vv-h'), 'высота от раскладки врёт на iOS: там её клавиатура не сжимает');
  assert.ok(rule.body.includes('var(--vv-top'), 'без смещения поверхность не догонит уже случившееся панорамирование');
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

test('каретку ставит ШТАТНЫЙ хук диалога, а не ручная машинерия', () => {
  const surface = readFileSync(join(UI, 'PickerSheet.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // У задачи «поле в фокусе при открытии» есть штатный хук Radix. vaul гасит
  // автофокус диалога по умолчанию, и, пока шов не пробрасывал хук, поверх
  // подавления фокус ставился руками — эффектом, потом синхронным коммитом,
  // потом ещё и повторной попыткой на кадре. Три захода воевали с настройкой,
  // которую достаточно было не включать.
  assert.ok(surface.includes('onOpenAutoFocus='), 'фокус при открытии — штатный хук, не эффект');
  assert.ok(!/useEffect|useLayoutEffect|requestAnimationFrame|setTimeout/.test(surface),
    'ручная постановка фокуса вернулась — значит хук снова обходят, а не используют');

  // Хук обязан ЗАБРАТЬ решение у Radix: иначе фокус уйдёт первому подходящему
  // элементу шторки, а первый там — крестик закрытия.
  // ⚠️ Срез ограничен СВОИМ обработчиком: сквозная регулярка дотягивалась до
  // `preventDefault()` соседнего `onCloseAutoFocus` и зеленела, даже когда из
  // этого хука его убрали (поймано мутацией).
  const openHook = surface.slice(surface.indexOf('onOpenAutoFocus='), surface.indexOf('onCloseAutoFocus='));
  assert.ok(openHook.includes('preventDefault()'),
    'без этого Radix отдаст фокус первому подходящему элементу — крестику закрытия');
});

test('машинерия под клавиатуру не возвращается ни в один движок', () => {
  for (const rel of ['SearchSelect.jsx', '../common/Autocomplete.jsx']) {
    const engine = readFileSync(join(UI, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!engine.includes('flushSync'),
      `${rel}: синхронный коммит был подпоркой под ручной фокус; хук в подпорках не нуждается`);
  }
});

test('правило «есть поиск -> полный рост» записано условием, а не прибито намертво', () => {
  const src = readFileSync(join(UI, 'PickerSheet.jsx'), 'utf8');
  // Скин обязан зависеть от `search`: безусловный `sheet--full` растянул бы во
  // весь экран и список из трёх ролей, безусловное его отсутствие вернуло бы
  // дёрганье поисковым шторкам. Обе половины правила - в одном выражении.
  assert.match(src, /search\s*\?\s*'sheet--full'\s*:/);
});
