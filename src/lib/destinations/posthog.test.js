// Slim-бандл несёт реплей только вместе с классами расширения (TRIP-500).
//
// `posthog-js/dist/module.slim.js` — это ЯДРО: capture / identify / group. Всё
// остальное существует, только если передать классы в `__extensionClasses`. И не
// передать НЕ значит «выключено»: значит расширения нет, а `startSessionRecording()`
// тогда выставляет флаг, который внутри SDK читает `this.sessionRecording?.…` —
// undefined. Ни ошибки, ни сетевого запроса, ни строки в логе; запись просто не
// начинается. Именно так реплей и не работал: настройки в PostHog были верны,
// событие-триггер приходило, а рекордер не грузился никогда.
//
// Разрыв этой пары — правка ОДНОЙ строки в другом файле (сменить импорт на slim,
// убрать `__extensionClasses`), и она не роняет ни сборку, ни один другой тест.
// Поэтому пара пиниться здесь: тест читает исходник, а не поведение, потому что
// поведение видно только в браузере после согласия.
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SRC = readFileSync(new URL('./posthog.js', import.meta.url), 'utf8');

test('slim-импорт SDK сопровождается классами реплея', () => {
  if (!/posthog-js\/dist\/module\.slim/.test(SRC)) return; // полный бандл несёт их сам
  assert.match(SRC, /import \{ SessionReplayExtensions \} from 'posthog-js\/dist\/extension-bundles'/,
    'slim-бандл без импорта SessionReplayExtensions = реплея нет молча');
  assert.match(SRC, /__extensionClasses:\s*\{\s*\.\.\.SessionReplayExtensions\s*\}/,
    'импортировать мало — классы должны уехать в init через __extensionClasses');
});

test('реплей стартует только на согласии и глушится на отзыве', () => {
  assert.match(SRC, /disable_session_recording:\s*true/, 'до согласия запись обязана быть выключена в init');
  // По КОДУ, не по тексту файла: докблок рядом называет вызов по имени, и на нём
  // проверка проходила бы даже со снесённым вызовом (поймано мутацией).
  const code = SRC.replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /export function onConsent[\s\S]*?startSessionRecording\?\.\(\)/,
    'старт записи живёт в onConsent — иначе гейт согласия обходится');
  // Отзыв = `opt_out_capturing()` SDK: он сам останавливает рекордер и стирает
  // записанное на устройстве. Своя остановка рядом = второй путь.
  assert.match(SRC, /export function onConsent[\s\S]*?opt_out_capturing\(\)/,
    'отзыв согласия — родной opt_out_capturing(), не свой стоп');
});

// ★★ ВСЯ ПОЛИТИКА СОГЛАСИЯ — ДВЕ СТРОКИ КОНФИГА, И ОБЕ НЕСУЩИЕ (TRIP-502).
//
// Первая держит сбор выключенным до ответа. Вторая держит выключенным ХРАНИЛИЩЕ
// и делает отзыв настоящим — её дефолт `false`, и без неё SDK пишет в localStorage
// ещё до того, как человек ответил. Потерять любую из них — одна строка, которая
// ничего не роняет: ни один тест, ни один гард, ни сборка. Поэтому пины.
test('согласие объявлено двумя строками конфига, обе на месте', () => {
  assert.match(SRC, /opt_out_capturing_by_default:\s*true/,
    'без этого SDK собирает до ответа на баннер');
  assert.match(SRC, /opt_out_persistence_by_default:\s*true/,
    'без этого SDK ПИШЕТ НА УСТРОЙСТВО до ответа, и отзыв ничего не стирает');
});

// Режим клиента не переключается руками ни в одну сторону. Оба режима, которые
// это делали, уже стоили эпику по заходу: `persistence:'memory'` + `set_config`
// рвали личность на каждом документе (TRIP-407), а `cookieless_mode:'on_reject'`
// сбрасывал клиент на «Принять всё» и рождал лишний id — и безкуковая персона
// всё равно не сшивалась с аккаунтом, потому что она выводится сервером и строки
// в `person_distinct_ids` у неё нет (замер превью 05.09).
test('режим клиента не переключается руками — ни память, ни безкуковый', () => {
  const code = SRC.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bpersistence\s*:/, "`persistence:'memory'` рвал личность на каждом документе");
  assert.doesNotMatch(code, /set_config\s*\(/, 'переключение согласия — opt_in/opt_out SDK, не set_config');
  assert.doesNotMatch(code, /cookieless_mode/, 'безкуковая персона не сшивается с аккаунтом — замер 05.09');
});

test('грант — родной opt_in_capturing без события $opt_in', () => {
  assert.match(SRC, /export function onConsent[\s\S]*?opt_in_capturing\(\{\s*captureEventName:\s*false\s*\}\)/,
    'без captureEventName:false SDK шлёт $opt_in и засоряет воронку');
});

// Приход считает РОДНОЙ `$pageview`. Явная строка `capture_pageview: false`
// оставляла пустыми все отчёты, которым он нужен, а главное — он единственное
// событие, которое SDK досылает после согласия, то есть единственная надёжная
// первая ступень воронки.
test('нативный просмотр страницы не выключен вручную', () => {
  const code = SRC.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /capture_pageview:\s*false/,
    'дефолт набора defaults — history_change; выключать его значит гасить половину продукта');
});

test('пол приватности записи объявлен в коде, а не только в UI', () => {
  assert.match(SRC, /maskTextSelector:\s*'\*'/, 'текст маскируется целиком');
  assert.match(SRC, /maskAllInputs:\s*true/);
  assert.match(SRC, /blockSelector:\s*'\.avatar'/, 'аватары — фото людей, текстовая маскировка их не трогает');
  assert.match(SRC, /disable_capture_url_hashes:\s*true/,
    'фрагмент адреса несёт токены Supabase после OAuth-редиректа');
});
