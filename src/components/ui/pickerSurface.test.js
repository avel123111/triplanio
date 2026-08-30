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

/** Код без комментариев. ⚠️ Отдельная функция, а не `includes` по файлу: имя
 *  скина УПОМИНАЕТСЯ в прозе тех файлов, что о нём рассказывают (движок пикера
 *  объясняет, кто задаёт геометрию встроенному режиму), и грубый греп читал бы
 *  объяснение как второго носителя. Это ровно та же грабля, что уже поймана в
 *  `sentry.test.js`: проверять надо КОД, а не текст. */
const codeOf = (file) => readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

test('скин полноростной шторки объявлен РОВНО В ОДНОЙ разметке — PickerSheet', () => {
  const carriers = jsxFiles(SRC).filter((f) => codeOf(f).includes('sheet--full'));
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

test('коробка ПОЛНОЭКРАННОЙ поверхности НЕ зависит от клавиатуры, и правило ОДНО', () => {
  const css = readFileSync(join(SRC, 'design/app.css'), 'utf8');
  const rules = boxRules(css, FULL_SURFACES);

  // ★ ЕДИНСТВЕННОСТЬ — ЭТО И ЕСТЬ ПРОВЕРЯЕМОЕ. Поверхностей две, и они уже
  // разъезжались: коробку от визуального вьюпорта получила только шторка пикера,
  // а панель редактора осталась на раскладке и на iOS уходила за оба края
  // видимой полосы (замер: панель 0→844 при видимом 120→600, поле в её низу — под клавиатурой).
  assert.equal(rules.length, 1,
    `коробку полноэкранной поверхности объявляет ровно одно правило; найдено ${rules.length}: ${rules.map((r) => r.sel).join(' | ')}`);

  const [rule] = rules;
  for (const s of FULL_SURFACES) {
    assert.ok(rule.sel.split(',').map((x) => x.trim()).includes(s),
      `${s} обязана брать коробку из ОБЩЕГО правила, а не из своего`);
  }

  // ⚠️ НАЗВАНИЕ ЭТОГО ТЕСТА РАНЬШЕ ГОВОРИЛО «от ВИЗУАЛЬНОГО вьюпорта» — то есть
  // ПРОТИВОПОЛОЖНОЕ тому, что он проверяет (`height: 100dvh` — это раскладочный).
  assert.ok(!/--vv-h|--vv-top/.test(rule.body),
    'высота коробки от клавиатуры пересчитывает процентный трансформ въезда — каретка едет вместе с поверхностью');
  assert.match(rule.body, /height:\s*100dvh/, 'коробка — вьюпорт раскладки и только он');

  const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(bareCss, /padding-bottom:\s*var\(--kb-h/,
    'клавиатура обязана резервировать место внутри неподвижной коробки, у скроллера');
});

test('видимую область публикует ОДИН наблюдатель visualViewport', () => {
  const owner = readFileSync(join(SRC, 'lib/keyboardOpen.js'), 'utf8');
  assert.ok(owner.includes("setProperty('--kb-h'"),
    'инсет публикует тот же модуль, что уже слушает visualViewport');
  assert.ok(owner.includes("vv.addEventListener('scroll'"),
    'панорамирование меняет смещение БЕЗ resize — без этой подписки шторка узнает о сдвиге слишком поздно');

  // Второй ПУБЛИКАТОР разъедётся с первым молча: оба будут «работать», а числа
  // разойдутся — у них разные пороги, разная реакция на поворот и разный гейт по
  // типу указателя. Проверяется именно публикация, а не всякое чтение
  // `visualViewport`: `PeekSheet` читает его сам под свои детенты (высота нужна числом в JS, а не переменной в CSS) — отдельный, более старый долг.
  const publishers = jsxFiles(SRC)
    .concat(jsFiles(SRC))
    .filter((f) => readFileSync(f, 'utf8').includes("setProperty('--kb-h'"))
    .map((f) => f.slice(SRC.length));
  assert.deepEqual(publishers, ['lib/keyboardOpen.js'], 'инсет клавиатуры публикует ровно один модуль');
});

test('НИ ОДИН пикер не вешает текстовое поле-триггер на страницу', () => {
  // ★ ЧТО ИМЕННО ПИННИТСЯ И ПОЧЕМУ. Текстовое поле НА СТРАНИЦЕ, открывающее
  // шторку, тревожит саму страницу, и неизбежно: тап фокусирует его, платформа
  // поднимает клавиатуру, вьюпорт раскладки ужимается и браузер доскролливает
  // страницу к полю — ВСЁ ЭТО ДО того, как шторка появилась. Шторка накрывает уже уехавшую страницу, на закрытии та возвращается.
  const branchOf = (file, from, to) => {
    const src = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const a = src.indexOf(from);
    assert.ok(a >= 0, `ветка ${from} не найдена в ${file} — тест обязан читать то, что проверяет`);
    const b = src.indexOf(to, a);
    return src.slice(a, b > a ? b : undefined);
  };

  const engines = [
    ['Autocomplete', branchOf(join(UI, '../common/Autocomplete.jsx'), 'if (isPhone)', '<PickerSheet')],
    ['SearchSelect', branchOf(join(UI, 'SearchSelect.jsx'), 'const trigger =', ');')],
  ];

  for (const [name, branch] of engines) {
    assert.match(branch, /as="button"/,
      `${name}: триггер обязан быть КНОПКОЙ — у поля ввода клавиатура поднимается на СТРАНИЦЕ`);
    assert.ok(!/onFocus=/.test(branch),
      `${name}: открытие по фокусу возвращает поле-триггер вместе со всей его ценой`);
    // `value=`/`placeholder=` на триггере означали бы, что контрол снова `<input>`:
    // у кнопки нет ни того, ни другого, подпись приезжает детьми.
    assert.ok(!/\bvalue=/.test(branch), `${name}: у кнопки-триггера нет value — подпись идёт детьми`);
  }
});

test('поверхность реагирует ТОЛЬКО на СВОЮ клавиатуру', () => {
  // ★ ЦЕНА ГЛОБАЛЬНОГО ФЛАГА, ЗАМЕРЕННАЯ НА УСТРОЙСТВЕ. `useKeyboardOpen()` —
  // признак документа: «клавиатура где-то поднята». `PeekSheet` (трёхдетентный
  // шит над картой в планировщике и редакторе маршрута) считал его СВОИМ и на
  // любую клавиатуру прыгал на верхний детент, а заодно пересчитывал детенты от сжатой видимой области.
  const src = readFileSync(join(UI, 'PeekSheet.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.ok(!/\bindex\s*=\s*keyboard\s*\?/.test(src),
    'детент не смеет зависеть от ГОЛОГО флага документа — только от своей клавиатуры');
  assert.match(src, /keyboardMine\s*=\s*keyboardOpen\s*&&\s*focusInside/,
    'признак «клавиатура моя» = открыта И фокус в моём поддереве');
  // Владение — ПОДПИСКА, а не чтение в рендере: иначе признак устареет ровно
  // тогда, когда фокус переезжает без смены флага клавиатуры (из поля шторки в
  // поле этого шита — клавиатура не опускается, перерисовки нет).
  assert.match(src, /addEventListener\('focusin'/,
    'без подписки на фокус признак «моя клавиатура» устаревает молча');
  assert.match(src, /index\s*=\s*keyboardMine\s*\?/,
    'на верхний детент поднимает СВОЯ клавиатура');

  // Вторая половина: `vh`/`vTop` под чужой клавиатурой не обновляются. Детенты —
  // доли от `vh`, поэтому одна усадка меняет и высоту шита, и его положение.
  const from = src.indexOf('const measure =');
  assert.ok(from > 0, 'measure не найден — тест обязан читать то, что проверяет');
  const measure = src.slice(from, src.indexOf('useLayoutEffect(', from));
  assert.ok(measure.includes('isMine('),
    'пересчёт вьюпорта обязан спрашивать, чья клавиатура: иначе шит едет и без смены детента');
});

test('вход в шторку ОДИН — тап; правило в движке, а не флажком у вызывателей', () => {
  // ★ ВХОДОВ БЫЛО ДВА, И ВТОРОЙ НЕ РАБОТАЛ ПО ПОСТРОЕНИЮ. Поле живёт в портале
  // vaul; портал монтируется НЕ в том же кадре, поэтому «открыться на
  // монтировании» фокусить нечего, а когда поле появится — жест уже кончился, и
  // платформа клавиатуру не отдаст. Наблюдалось так: в планировщике каретка появлялась, а ввода за ней не было.
  const engine = readFileSync(join(UI, '../common/Autocomplete.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(engine, /const \[sheetOpen, setSheetOpen\] = useState\(false\)/,
    'шторка не смеет открывать себя сама: этот вход не может дать клавиатуру');
  assert.ok(!/focusOnMount/.test(engine), 'фокус на монтировании — тот же мёртвый путь');

  // ⚠️ И ВТОРАЯ ПОЛОВИНА: правило платформенное, значит живёт В ДВИЖКЕ. Пока оно
  // жило флажком у вызывателей, их было пять, с ДВУМЯ соглашениями (`autoFocus`
  // против `autoFocus={!isPhone}`) и двумя комментариями, объясняющими платформу
  // на месте вызова. Это и есть расхождение поведения между экранами.
  const callers = ['../../pages/ManualPlanner.jsx', '../../pages/EditLens.jsx',
    '../../pages/create/anchors.jsx', '../../components/stats/AddPlaceDialog.jsx'];
  for (const rel of callers) {
    const src = readFileSync(join(UI, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/(CitySearch|CityPicker)[^>]*autoFocus=\{!isPhone\}/s.test(src),
      `${rel}: платформенное правило не место вызова — оно в движке`);
  }
});

test('дисциплина фокуса записана ОДИН раз, движки её зовут', () => {
  // ★ ПРАВИЛО ЦЕЛИКОМ: «поверхность открывается и её поле получает фокус В ОДНОМ
  // ЖЕСТЕ; выбор сделан — поле отпускает фокус». Оно платформенное (WebKit даёт
  // клавиатуру только на фокус внутри жеста), а не про данные, поэтому
  // принадлежит поверхности. Движка два, и записать его у каждого значило бы завести второй экземпляр — тот самый дубль.
  const surface = readFileSync(join(UI, 'PickerSheet.jsx'), 'utf8');
  assert.match(surface, /export function usePickerFocus/, 'дом правила — поверхность');

  for (const rel of ['SearchSelect.jsx', '../common/Autocomplete.jsx']) {
    const src = readFileSync(join(UI, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.match(src, /usePickerFocus/, `${rel}: движок обязан ЗВАТЬ правило`);
    for (const [needle, why] of [
      ['flushSync', 'синхронный коммит — часть правила «в одном жесте», не дело движка'],
      ['.focus(', 'фокус ставит правило, иначе у него появится второй экземпляр'],
      // `.blur(` здесь НЕ запрещён, и это не послабление: движок отпускает СВОЁ
      // поле по своему же факту «выбор состоялся» (`searchRef.current?.blur()`),
      // а у поверхности такого факта нет — она знает только «закрываюсь».
    ]) {
      assert.ok(!src.includes(needle), `${rel}: ${why}`);
    }
  }

  // ⚠️ ЗАПРЕТ НА ФОКУС ВНЕ ЖЕСТА ОСТАЁТСЯ. Он и был причиной каретки без ввода:
  // `onOpenAutoFocus` срабатывает при монтировании поверхности, то есть уже после
  // тапа, и WebKit каретку рисует, а клавиатуру не даёт. Ожидание анимации лечило
  // бы симптом — момент тут ни при чём, важна принадлежность жесту.
  const bare = surface.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!bare.includes('onOpenAutoFocus'), 'фокус на монтировании даёт каретку без клавиатуры');
  assert.ok(!/setTimeout|transitionend|animationend/.test(bare),
    'ожидание анимации — лечение симптома: решает принадлежность жесту, а не момент');
  // ⚠️ ЗДЕСЬ БЫЛ ЗАПРЕТ НА `useEffect` ЦЕЛИКОМ, И ОН ОХРАНЯЛ НЕ ТО СВОЙСТВО.
  // Защищаем мы «фокус не СТАВИТСЯ вне жеста». Запрет же был на механизм — и
  // заодно запрещал противоположное по смыслу: СНЯТЬ фокус на закрытии (то
  // самое, из-за отсутствия чего клавиатура опаздывала на полсекунды). Правило сужено до свойства: эффектам можно всё, кроме постановки фокуса.
  for (const body of bare.split(/use(?:Layout)?Effect\(/).slice(1)) {
    assert.ok(!/\.focus\(|(?:^|[^.\w])focus\(\)/.test(body.slice(0, body.indexOf('}, ['))),
      'фокус из эффекта — это фокус вне жеста: каретка есть, клавиатуры нет');
  }
});

test('машинерия под клавиатуру не возвращается ни в один движок', () => {
  for (const rel of ['SearchSelect.jsx', '../common/Autocomplete.jsx']) {
    const engine = readFileSync(join(UI, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!engine.includes('flushSync'),
      `${rel}: синхронный коммит был подпоркой под ручной фокус; хук в подпорках не нуждается`);
  }
});

test('панель едет, поле стоит — обе группы объявлены явно', () => {
  // ★ ЗАМЕР НА ЖИВОМ КОМПОНЕНТЕ (/kit, покадрово), размахи за въезд:
  //     заливка 844 · лист 844 · грип 0 · шапка 0 · ПОЛЕ 0
  // Требований два, и они не размен: шторка обязана ВЫЕЗЖАТЬ (появляющаяся
  // шторка — не поведение приложения) и поле обязано СТОЯТЬ (иначе каретке достаётся 840 px пути за полсекунды).
  const css = readFileSync(join(SRC, 'design/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const sel = css.split('\n').find((l) => l.includes('.sheet--full[data-vaul-drawer]') && l.includes("data-state='open'"));
  assert.ok(sel, 'правило въезда полноростной шторки не найдено');
  // ★★ СПЕЦИФИЧНОСТЬ — ЧАСТЬ ПРАВИЛА. Свой въезд vaul объявляет ЧЕТЫРЬМЯ
  // атрибутами; правило класс+два (0,3,0) ему проигрывает и не применяется
  // ВООБЩЕ — молча. Ровно это один раз уже уехало на превью как «фикс».
  for (const attr of ['data-vaul-snap-points', 'data-vaul-drawer-direction']) {
    assert.ok(sel.includes(attr),
      `без ${attr} селектор проигрывает vaul по специфичности — фикс станет невидимым`);
  }
  const rise = css.slice(css.indexOf('@keyframes sheetPanelRise'));
  assert.match(rise.slice(0, rise.indexOf('}\n')), /translateY\(100vh\)/,
    'едущие стартуют с ОДНОГО смещения — так они идут жёсткой группой, и высот не знает никто');

  const ride = css.slice(css.indexOf("[data-state='open']::before"));
  const block = ride.slice(0, ride.indexOf('}') + 1);
  for (const [who, why] of [['::before', 'сама поверхность'], ['.ss-list', 'лист']]) {
    assert.ok(block.includes(who), `${why} обязан ехать: без него шторка появляется, а не выезжает`);
  }
  assert.ok(!block.includes('.ss-search'), 'поле в едущей группе = каретка снова пассажир');
  assert.ok(!block.includes('.sheet-h'), 'шапка в едущей группе проходит СКВОЗЬ неподвижное поле');

  const fade = css.slice(css.indexOf("[data-state='open'] .sheet-grip"));
  const fadeBlock = fade.slice(0, fade.indexOf('}') + 1);
  assert.match(fadeBlock, /sheetFade[^;]*\bboth\b/,
    'без `both` хром виден до начала своей анимации — то есть поверх живой страницы');
  assert.match(fadeBlock, /sheetFade[^;]*\.1\ds/,
    'задержка не украшение: до неё под хромом ещё нет поверхности');
  assert.equal((css.match(/@keyframes sheetFade/g) || []).length, 1,
    'кадр проявления в файле уже есть — второй экземпляр это дубль (правило #6)');
});

test('движки берут у хука только то, что он отдаёт', () => {
  // ★★ ЭТОТ ТЕСТ НАПИСАН ПОСЛЕ ПАДЕНИЯ В ПРОДЕ, И ВОТ ПОЧЕМУ ИМЕННО ТАК.
  // Правило «закрытие снимает фокус» переехало из хука к поверхности, и `release`
  // из `usePickerFocus` исчез. В `Autocomplete` вызов убрали, в `SearchSelect`
  // ЗАБЫЛИ — там осталось `release()`, то есть вызов `undefined`. Каждый клик по пункту валился TypeError, выбор не работал вовсе.
  const surface = readFileSync(join(UI, 'PickerSheet.jsx'), 'utf8');
  const body = surface.slice(surface.indexOf('export function usePickerFocus'));
  const returned = new Set(
    [...body.slice(0, body.indexOf('\n}')).matchAll(/^\s{4}([A-Za-z_$][\w$]*)\s*[:,]/gm)].map((m) => m[1]),
  );
  assert.ok(returned.size > 0, 'не разобрал, что возвращает хук — тест обязан читать то, что проверяет');

  for (const rel of ['SearchSelect.jsx', '../common/Autocomplete.jsx']) {
    const src = readFileSync(join(UI, rel), 'utf8');
    const m = src.match(/const\s*\{([^}]*)\}\s*=\s*usePickerFocus\(\)/);
    if (!m) continue;
    for (const name of m[1].split(',').map((x) => x.trim().split(':')[0].trim()).filter(Boolean)) {
      assert.ok(returned.has(name),
        `${rel}: берёт у usePickerFocus «${name}», а хук такого не отдаёт — это вызов undefined в рантайме`);
    }
  }
});

test('закрытие снимает фокус — у ПОВЕРХНОСТИ, а не у одной из четырёх дверей', () => {
  // ★ ЗАМЕР: закрытий четыре (выбор, Esc, тап мимо, свайп), блюр стоял на одном.
  //   было  фокус жил ВСЕ 500 мс выезда, узел уходил из DOM на 543-м мс
  //   стало focusout на 9-м мс, выезд остаётся штатным
  // Клавиатуру держит сфокусированное поле — отсюда «шит уехал, клавиатура через полсекунды».
  const surface = readFileSync(join(UI, 'PickerSheet.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(surface, /useEffect/, 'правило висит на ПЕРЕХОДЕ open -> false, а не на четырёх обработчиках');
  assert.match(surface, /contains\(el\)/, 'блюрить можно только СВОЁ поддерево: чужой фокус не наш');
  assert.match(surface, /\.blur\(\)/, 'закрытие обязано снимать фокус');

  for (const rel of ['SearchSelect.jsx', '../common/Autocomplete.jsx']) {
    const engine = readFileSync(join(UI, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // ⚠️ ЗАПРЕТ СУЖЕН ДО НАСТОЯЩЕГО СВОЙСТВА, А НЕ ОСЛАБЛЕН. Движку можно
    // отпустить СВОЁ поле (`searchRef.current?.blur()`) — это его собственный
    // факт «выбор состоялся», у поверхности такого факта нет (она знает только
    // «закрываюсь»). Нельзя другое: трогать ЧУЖОЙ фокус. Именно так был написан снятый `blurOnPick`: глобальный блюр через кадр.
    assert.ok(!/activeElement/.test(engine),
      `${rel}: чужой фокус — не дело движка; отпускать можно только своё поле`);
  }
});

test('чужой фокус не трогает НИКТО, кроме поверхности', () => {
  // ★ ГДЕ ЭТО БЫЛО: `CityPicker` носил флаг `blurOnPick` и по нему звал
  // `document.activeElement.blur()` через `requestAnimationFrame` — третий дом
  // правила «снять фокус», причём глобальный и на кадр позже, то есть по узлу,
  // которому Radix уже вернул фокус. Нужда была настоящей (на шаге визарда `:focus-within` прячет дату), но это свойство ПИКЕРА.
  const files = jsxFiles(SRC).filter((f) => !f.endsWith('PickerSheet.jsx'));
  const guilty = files.filter((f) => {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return /document\.activeElement[\s\S]{0,40}\.blur\(\)/.test(src);
  }).map((f) => f.slice(SRC.length));
  assert.deepEqual(guilty, [], `глобальный блюр вне поверхности: ${guilty.join(', ')}`);
});

test('правило «есть поиск -> полный рост» записано условием, а не прибито намертво', () => {
  const src = codeOf(join(UI, 'PickerSheet.jsx'));
  // Скин обязан быть УСЛОВНЫМ: безусловный `sheet--full` растянул бы во весь
  // экран и список из трёх ролей, безусловное его отсутствие вернуло бы
  // дёрганье поисковым шторкам.
  // ⚠️ Условий у правила ДВА, и это не послабление. Поиск можно отдать слотом
  // (`search`) — так делают оба движка выбора; а можно нести ВНУТРИ содержимого
  // и заявить полный рост явно (`full`) — так делает поверхность с несколькими
  // фазами (композер города: найти город -> выбрать вид точки), у которой на
  // второй фазе поля нет вовсе, а коробка обязана остаться той же. Само правило
  // «есть поиск -> полный рост» не изменилось, изменился способ его заявить.
  assert.match(src, /\(\s*search\s*\|\|\s*full\s*\)\s*\?\s*'sheet--full'\s*:/);
});

test('★★ композер города НЕ вкладывает шторку в шторку', () => {
  // ★ ЦЕНА ВЛОЖЕННОСТИ, ЗАМЕРЕННАЯ РУКАМИ. Композер открывал МАЛЕНЬКУЮ шторку, в
  // ней стоял триггер, тап по триггеру открывал ВТОРУЮ во весь рост, выбор
  // возвращал в первую — две поверхности и лишний тап на одно действие, и та же
  // лестница ещё раз на «изменить город». Флоу читался как «мелкий шит -> большой
  // шит -> мелкий шит».
  // Теперь коробка одна на обе фазы. Сторожим три половины: поверхность взята у
  // общего примитива, полный рост заявлен явно (иначе коробка сожмётся на второй
  // фазе — тот самый дефект, ради которого полный рост и заведён), и движок
  // поиска работает БЕЗ своей шторки (`embedded`), а не через триггер.
  const src = codeOf(join(UI, '../cities/CityAdder.jsx'));
  const phone = src.slice(src.indexOf('if (isPhone)'), src.indexOf('return (', src.indexOf('if (isPhone)')) + 4000);
  assert.match(phone, /<PickerSheet[\s\S]*?\bfull\b/, 'фазы обязаны жить в ОДНОЙ полноростной коробке');
  assert.ok(!/<Sheet\b/.test(phone), 'своя вторая поверхность = возврат к вложенности');
  assert.match(src, /embedded/, 'движок поиска обязан работать без своей шторки');
  assert.ok(!/as="button"/.test(src), 'триггер-поле внутри композера = вторая шторка по тапу');
});

test('★★ открытость композера — ОДИН канал, и у него два читателя', () => {
  // ★ ЧТО ЛОМАЛОСЬ. «Далее» уводило со шага при ОТКРЫТОМ композере, бросая
  // наполовину введённый город: он нигде не сохранён и просто исчезал. И на
  // десктопе открытый композер выезжал ПОД пустым состоянием «Куда едем?» — то
  // есть экран одновременно звал добавить город и показывал форму добавления.
  // Оба дефекта — про один факт «композер сейчас открыт», поэтому и канал один:
  // второй способ это узнать разъехался бы с первым.
  const adder = codeOf(join(UI, '../cities/CityAdder.jsx'));
  assert.match(adder, /onOpenChange\?\.\(open\)/, 'композер обязан сообщать открытость наружу');

  const planner = codeOf(join(UI, '../../pages/ManualPlanner.jsx'));
  assert.match(planner, /primaryDisabled\s*=\s*!citiesValid\s*\|\|\s*composing/,
    '«Далее» обязана ждать, пока работа с городом закончена');
  assert.match(planner, /nodes\.length === 0 && !composing/,
    'пустое состояние обязано уступать композеру место, а не вставать над ним');
  // Флаг не должен пережить уход со шага: иначе «Далее» выключено и дальше.
  assert.match(planner, /setComposing\(false\)/, 'смена шага обязана сбрасывать флаг композера');
});

test('★ удаление города в планировщике СПРАШИВАЕТ, и своим текстом', () => {
  const planner = codeOf(join(UI, '../../pages/ManualPlanner.jsx'));
  assert.match(planner, /confirm\(\{[\s\S]{0,200}tse\.delete_city_q/,
    'удаление города обязано идти через общую дверь confirm');
  // ⚠️ Описание СВОЁ, а не редакторское: `tse.delete_city_desc` обещает каскадное
  // удаление броней, а до создания трипа броней не существует.
  assert.ok(!/tse\.delete_city_desc/.test(planner),
    'редакторское описание обещает удалить брони, которых в визарде ещё нет');
  assert.match(planner, /planner\.delete_city_desc/, 'у планировщика своё описание');
});
