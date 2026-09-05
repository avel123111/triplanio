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
  assert.match(SRC, /export function onConsent[\s\S]*?startSessionRecording/,
    'старт записи живёт в onConsent, иначе гейт согласия обходится');
  // Отзыв = `opt_out_capturing()` SDK: он сам останавливает рекордер, сбрасывает
  // клиент и стирает записанное на устройстве. Своя остановка рядом = второй путь.
  assert.match(SRC, /export function onConsent[\s\S]*?opt_out_capturing\(\)/,
    'отзыв согласия — родной opt_out_capturing(), не свой стоп');
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
  assert.match(SRC, /export function onConsent[\s\S]*?opt_in_capturing\(\{\s*captureEventName:\s*false\s*\}\)/,
    'грант — родной opt_in_capturing без события $opt_in');
});

test('пол приватности записи объявлен в коде, а не только в UI', () => {
  assert.match(SRC, /maskTextSelector:\s*'\*'/, 'текст маскируется целиком');
  assert.match(SRC, /maskAllInputs:\s*true/);
  assert.match(SRC, /blockSelector:\s*'\.avatar'/, 'аватары — фото людей, текстовая маскировка их не трогает');
  assert.match(SRC, /disable_capture_url_hashes:\s*true/,
    'фрагмент адреса несёт токены Supabase после OAuth-редиректа');
});
