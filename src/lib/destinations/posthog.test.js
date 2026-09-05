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
  // Старт записи уехал в `consentSwitch.js` вместе с включением хранения (в
  // безкуковом режиме у SDK нет клиентской сессии, писать нечего) — но гейт
  // согласия обязан остаться: запись начинается ЗА границей, не до неё.
  // Код, не комментарии: докблок про slim-сборку называет этот вызов по имени.
  assert.doesNotMatch(SRC.replace(/^\s*\/\/.*$/gm, ''), /startSessionRecording/,
    'старт записи — часть перехода через границу согласия, а не отдельная ручка здесь');
  // Отзыв = `opt_out_capturing()` SDK: он сам останавливает рекордер, сбрасывает
  // клиент и стирает записанное на устройстве. Своя остановка рядом = второй путь.
  assert.match(SRC, /export function onConsent[\s\S]*?opt_out_capturing\(\)/,
    'отзыв согласия — родной opt_out_capturing(), не свой стоп');
});

// ★ ТА САМАЯ СТРОКА, ИЗ-ЗА КОТОРОЙ РВАЛАСЬ ВОРОНКА. Выход из безкукового режима
// = `reset(true)` внутри SDK, поэтому включать хранение по нажатию кнопки значит
// осиротить приход у всех, кто согласился. Порядок проверяется по-настоящему в
// `consentSwitch.test.js`; здесь пиним, что адаптер этот порядок не обходит —
// вернуть `opt_in_capturing()` в `onConsent` это одна строка, которая ничего не
// роняет.
test('согласие включает хранение НЕ на кнопке, а вместе с личностью', () => {
  const onConsentBody = SRC.match(/export function onConsent[\s\S]*?\n}/)[0];
  assert.doesNotMatch(onConsentBody, /opt_in_capturing/,
    'грант в onConsent только запоминается: включить хранение до identify = осиротить приход');
  assert.match(SRC, /export function onIdentified[\s\S]*?identifyUnderConsent\(/,
    'включение хранения живёт за одной дверью с identify');
  assert.match(SRC, /storageGranted = record\?\.analytics === true/,
    'ответ на баннер обязан доехать до onIdentified — иначе согласившийся никогда не получит хранения');
});

// Сброс сносит супер-свойства ЦЕЛИКОМ. `camp_*` и `env` восстановимы, а
// `ref_trip_id` ставят анонимные экраны приглашения и публичного трипа — в
// момент переключения его взять неоткуда, и потеря невидима.
test('свойства приложения перечислены одним списком и переносятся через сброс', () => {
  assert.match(SRC, /OWNED_SUPER_PROPS = \[\.\.\.CAMPAIGN_KEYS,[^\]]*'ref_trip_id',[^\]]*'env'\]/,
    'один список владения: забытая строка = свойство теряется молча');
  assert.match(SRC, /preservingOwnProps\(ph, OWNED_SUPER_PROPS, \(\) => ph\.opt_out_capturing\(\)\)/,
    'отзыв тоже сбрасывает клиент — перенос обязан стоять и там');
});

// Приход считает РОДНОЙ `$pageview`. Явная строка `capture_pageview: false`
// оставляла пустыми все отчёты, которым он нужен (источники, страницы входа,
// отказы, длительность), а верх воронки собирался своими событиями.
test('нативный просмотр страницы не выключен вручную', () => {
  const code = SRC.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /capture_pageview:\s*false/,
    'дефолт набора defaults — history_change; выключать его значит гасить половину продукта');
});

// Согласие и идентичность — механика SDK, а не наша (TRIP-502). `persistence:'memory'`
// + `set_config` на согласии — режим, которого у PostHog НЕТ: id умирал с каждым
// документом, одна сессия рождала 2–4 персоны и воронка регистрации рвалась
// (замер прода: склеено 11 из 32). Пиним конфиг, потому что откат — две строки,
// которые ничего не роняют.
test('согласие — родной cookieless-режим SDK, не память + переключение', () => {
  assert.match(SRC, /cookieless_mode:\s*'on_reject'/, 'без ответа и на отказе SDK сам cookieless');
  assert.match(SRC, /opt_out_capturing_by_default:\s*true/, 'до ответа = не согласен, иначе SDK пишет на устройство сразу');
  // Код, не комментарии: докблок называет старый режим по имени, чтобы его не вернули.
  const code = SRC.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /\bpersistence\s*:/, "`persistence:'memory'` — тот самый режим, что рвал персону");
  assert.doesNotMatch(code, /set_config\s*\(/, 'переключение согласия — opt_in/opt_out SDK, не set_config');
});

// Грант — родной `opt_in_capturing`, и вызывается он ровно в одном месте:
// в шве перехода, где вокруг него выстроен порядок (`consentSwitch.test.js`).
test('грант — родной opt_in_capturing без события $opt_in, и ровно в одном месте', () => {
  const SEAM = readFileSync(new URL('../consentSwitch.js', import.meta.url), 'utf8');
  assert.match(SEAM, /opt_in_capturing\?\.\(\{\s*captureEventName:\s*false\s*\}\)/,
    'без captureEventName:false SDK шлёт $opt_in и засоряет воронку');
  assert.equal((SEAM.match(/opt_in_capturing/g) || []).length, 1, 'вход в хранение один');
});

test('пол приватности записи объявлен в коде, а не только в UI', () => {
  assert.match(SRC, /maskTextSelector:\s*'\*'/, 'текст маскируется целиком');
  assert.match(SRC, /maskAllInputs:\s*true/);
  assert.match(SRC, /blockSelector:\s*'\.avatar'/, 'аватары — фото людей, текстовая маскировка их не трогает');
  assert.match(SRC, /disable_capture_url_hashes:\s*true/,
    'фрагмент адреса несёт токены Supabase после OAuth-редиректа');
});
