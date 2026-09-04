import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, changedTopics, hasChanges, TOPIC_KEYS } from './emailPrefs.js';

const [REMINDERS, UPDATES, ONBOARDING, PRODUCT, MARKETING] = Object.keys(TOPIC_KEYS);

// Живой ответ Resend приходит в порядке СОЗДАНИЯ топиков (по убыванию даты),
// то есть в обратном смысловому. Порядок экрана — наш, иначе он меняется от
// того, в каком порядке кто-то нажимал «создать» в дашборде.
test('buildRows: известные топики выстраиваются в наш порядок, а не в порядок ответа', () => {
  const rows = buildRows([
    { id: MARKETING, name: 'Marketing emails', subscription: 'opt_in' },
    { id: PRODUCT, name: 'Product updates', subscription: 'opt_in' },
    { id: ONBOARDING, name: 'Onboarding', subscription: 'opt_in' },
    { id: UPDATES, name: 'Trip updates', subscription: 'opt_in' },
    { id: REMINDERS, name: 'Trip reminders', subscription: 'opt_in' },
  ]);
  assert.deepEqual(rows.map((r) => r.id), [REMINDERS, UPDATES, ONBOARDING, PRODUCT, MARKETING]);
});

// Топик, заведённый в дашборде и ещё не переведённый, обязан остаться на экране:
// иначе человек не сможет от него отписаться, а письма по нему уже идут.
test('buildRows: незнакомый топик не пропадает — едет в конец с именем из ответа', () => {
  const rows = buildRows([
    { id: 'ffffffff-0000-0000-0000-000000000000', name: 'Beta program', subscription: 'opt_in' },
    { id: REMINDERS, name: 'Trip reminders', subscription: 'opt_in' },
  ]);
  assert.deepEqual(rows.map((r) => r.id), [REMINDERS, 'ffffffff-0000-0000-0000-000000000000']);
  assert.equal(rows[1].i18nKey, null);
  assert.equal(rows[1].name, 'Beta program');
});

// `subscription` приезжает строкой; включённым считается ВСЁ, кроме явного
// opt_out — топик с незнакомым значением лучше показать включённым (и дать
// выключить), чем молча нарисовать выключенным и врать про состояние.
test('buildRows: on = false только на явном opt_out', () => {
  const rows = buildRows([
    { id: REMINDERS, subscription: 'opt_out' },
    { id: UPDATES, subscription: 'opt_in' },
    { id: PRODUCT },
  ]);
  assert.deepEqual(rows.map((r) => r.on), [false, true, true]);
});

test('buildRows: мусор на входе не роняет экран', () => {
  assert.deepEqual(buildRows(null), []);
  assert.deepEqual(buildRows([null, {}, { id: '' }]), []);
});

// ГЛАВНЫЙ ИНВАРИАНТ. Отправлять все четыре строки нельзя: между загрузкой
// экрана и нажатием «Сохранить» человек мог отписаться из письма на телефоне —
// и слепая отправка всего вернула бы ему opt_in, который он не выбирал.
test('changedTopics: шлём только тронутое', () => {
  const initial = [{ id: REMINDERS, on: true }, { id: UPDATES, on: true }, { id: PRODUCT, on: false }];
  const current = [{ id: REMINDERS, on: false }, { id: UPDATES, on: true }, { id: PRODUCT, on: false }];
  assert.deepEqual(changedTopics(initial, current), [{ id: REMINDERS, subscription: 'opt_out' }]);
});

test('changedTopics: ничего не трогали — пустой список', () => {
  const rows = [{ id: REMINDERS, on: true }, { id: UPDATES, on: false }];
  assert.deepEqual(changedTopics(rows, rows), []);
});

test('changedTopics: включение обратно едет как opt_in', () => {
  assert.deepEqual(
    changedTopics([{ id: PRODUCT, on: false }], [{ id: PRODUCT, on: true }]),
    [{ id: PRODUCT, subscription: 'opt_in' }],
  );
});

// Глобальный флаг — не топик. Человек мог тронуть только его, и кнопка
// «Сохранить» обязана ожить.
test('hasChanges: видит правку одного лишь глобального флага', () => {
  const rows = [{ id: REMINDERS, on: true }];
  assert.equal(hasChanges(rows, rows, false, true), true);
  assert.equal(hasChanges(rows, rows, false, false), false);
});

// Подпись строки собирается как `<ключ>_sub`, то есть неявно: забыть её можно
// молча, и на экране появится сырой ключ вместо пояснения. Тест читает САМИ
// файлы локалей и требует обе половины у каждого известного топика — во всех
// трёх языках, потому что «забыли перевести» это ровно тот же дефект.
test('★ у каждого топика есть и заголовок, и пояснение во всех локалях', async () => {
  const { readFileSync } = await import('node:fs');
  for (const lang of ['ru', 'en', 'es']) {
    const dict = JSON.parse(
      readFileSync(new URL(`./i18n/locales/${lang}/email_prefs.json`, import.meta.url), 'utf8'),
    );
    for (const key of Object.values(TOPIC_KEYS)) {
      const bare = key.replace(/^email_prefs\./, '');
      assert.ok(dict[bare], `${lang}: нет заголовка ${bare}`);
      assert.ok(dict[`${bare}_sub`], `${lang}: нет пояснения ${bare}_sub`);
    }
  }
});
