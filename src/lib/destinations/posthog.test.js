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
  assert.match(SRC, /export function stopAnalytics[\s\S]*?stopSessionRecording/,
    'отзыв согласия обязан явно глушить рекордер');
});

test('пол приватности записи объявлен в коде, а не только в UI', () => {
  assert.match(SRC, /maskTextSelector:\s*'\*'/, 'текст маскируется целиком');
  assert.match(SRC, /maskAllInputs:\s*true/);
  assert.match(SRC, /blockSelector:\s*'\.avatar'/, 'аватары — фото людей, текстовая маскировка их не трогает');
  assert.match(SRC, /disable_capture_url_hashes:\s*true/,
    'фрагмент адреса несёт токены Supabase после OAuth-редиректа');
});
