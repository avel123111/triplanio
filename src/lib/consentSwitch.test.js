// Порядок на границе согласия — на фейковом SDK, который сбрасывается так же,
// как настоящий (TRIP-502).
//
// Фейк ниже — не заглушка «чтобы вызвалось»: он повторяет ровно ту механику
// posthog-js 1.402.0, из-за которой воронка и рвалась, и снята она с исходника
// отгружаемого бандла, а не с документации:
//
//   • `identify(uid)` шлёт `$identify` ТОЛЬКО если персона сейчас анонимна и
//     `uid` отличается от текущего id; иначе тихий no-op.
//   • «в безкуковом режиме» = `cookieless_mode === 'on_reject'` И согласие
//     отвергнуто; а «не ответил» при `opt_out_capturing_by_default: true` —
//     это тоже «отвергнуто».
//   • `opt_in_capturing()` из безкукового состояния начинается с `reset(true)`:
//     новый id, персона снова анонимна, супер-свойства снесены. Не из
//     безкукового — сброса нет.
//   • `opt_out_capturing()` сбрасывает, только если клиент БЫЛ opted-in.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { identifyUnderConsent, preservingOwnProps } from './consentSwitch.js';

const OWNED = ['env', 'camp_source', 'camp_ts', 'ref_trip_id'];

function fakePosthog({ answered = null } = {}) {
  let seq = 0;
  const ph = {
    // -1 не ответил, 0 отказ, 1 согласие — как хранит сам SDK.
    consent: answered === null ? -1 : answered ? 1 : 0,
    distinctId: '$posthog_cookieless',
    personMode: 'anonymous',
    props: {},
    events: [],
    recording: false,

    rejected() { return ph.consent === 0 || ph.consent === -1; },
    inCookieless() { return ph.rejected(); },

    reset() {
      ph.props = {};
      ph.distinctId = `uuid-${++seq}`;
      ph.personMode = 'anonymous';
    },

    identify(uid) {
      if (ph.personMode === 'anonymous' && uid !== ph.distinctId) {
        ph.events.push({ event: '$identify', distinct_id: uid, $anon_distinct_id: ph.distinctId, props: { ...ph.props } });
        ph.distinctId = uid;
        ph.personMode = 'identified';
      }
    },
    capture(event) {
      ph.events.push({ event, distinct_id: ph.distinctId, props: { ...ph.props } });
    },
    register(props) { Object.assign(ph.props, props); },
    get_property(key) { return ph.props[key]; },
    opt_in_capturing() {
      if (ph.inCookieless()) ph.reset();
      ph.consent = 1;
    },
    opt_out_capturing() {
      if (!ph.rejected()) ph.reset();
      ph.consent = 0;
    },
    startSessionRecording() { ph.recording = true; },
  };
  return ph;
}

/** Персоны, которые получились: у кого какая цепочка склеек. */
function chains(ph) {
  return ph.events.filter((e) => e.event === '$identify').map((e) => [e.$anon_distinct_id, e.distinct_id]);
}

test('баннер не тронут: приход и регистрация — одна персона, сброса нет', () => {
  const ph = fakePosthog();
  ph.register({ env: 'prod', camp_source: 'google' });
  ph.capture('$pageview');
  ph.capture('cta_clicked');

  identifyUnderConsent(ph, 'uid-1', { granted: false, ownedKeys: OWNED });
  ph.capture('user_signed_up');

  assert.deepEqual(chains(ph), [['$posthog_cookieless', 'uid-1']],
    'ровно одна склейка: безкуковая персона визита → аккаунт');
  const ids = new Set(ph.events.map((e) => e.distinct_id));
  assert.deepEqual([...ids], ['$posthog_cookieless', 'uid-1'], 'два id за визит, больше неоткуда');
  assert.equal(ph.props.camp_source, 'google', 'без переключения свойства никто не трогает');
});

test('★ принял баннер: приход приклеен к аккаунту ДО сброса — воронка целая', () => {
  const ph = fakePosthog();
  ph.register({ env: 'prod', camp_source: 'google', ref_trip_id: 'trip-9' });
  ph.capture('$pageview');       // приход, безкуковая персона
  ph.capture('cta_clicked');

  // «Принять всё» на лендинге хранение НЕ включает — только запоминает ответ.
  // Включение приезжает вместе с личностью:
  identifyUnderConsent(ph, 'uid-1', { granted: true, ownedKeys: OWNED });
  ph.capture('user_signed_up');

  assert.deepEqual(chains(ph), [
    ['$posthog_cookieless', 'uid-1'], // приход и клик — уже на аккаунте
    ['uuid-1', 'uid-1'],              // и свежий id после сброса — туда же
  ], 'две склейки, обе в один аккаунт: осиротевшей персоны не остаётся');

  // Ровно тот дефект, из-за которого всё затевалось: событие прихода обязано
  // принадлежать той же персоне, что и регистрация.
  const pageview = ph.events.find((e) => e.event === '$pageview');
  const signup = ph.events.find((e) => e.event === 'user_signed_up');
  const merged = new Map(chains(ph));
  assert.equal(merged.get(pageview.distinct_id), signup.distinct_id,
    'приход склеен с той персоной, на которой лежит регистрация');
});

test('★ супер-свойства переживают сброс — иначе теряется ref_trip_id, восстановить его неоткуда', () => {
  const ph = fakePosthog();
  ph.register({ env: 'prod', camp_source: 'google', ref_trip_id: 'trip-9' });

  identifyUnderConsent(ph, 'uid-1', { granted: true, ownedKeys: OWNED });
  ph.capture('trip_opened');

  assert.deepEqual(ph.props, { env: 'prod', camp_source: 'google', ref_trip_id: 'trip-9' },
    'сброс снёс всё, перенос вернул');
  const second = ph.events.filter((e) => e.event === '$identify')[1];
  assert.equal(second.props.env, 'prod', 'вернуть надо ДО следующего события, а $identify — событие');
  assert.equal(ph.events.at(-1).props.ref_trip_id, 'trip-9');
});

test('запись экрана включается только по ту сторону границы', () => {
  const denied = fakePosthog();
  identifyUnderConsent(denied, 'uid-1', { granted: false, ownedKeys: OWNED });
  assert.equal(denied.recording, false, 'без согласия записи нет');

  const granted = fakePosthog();
  identifyUnderConsent(granted, 'uid-1', { granted: true, ownedKeys: OWNED });
  assert.equal(granted.recording, true);
});

test('хранение уже включено (второй вход с этого устройства): сброса нет, вторая склейка молчит', () => {
  const ph = fakePosthog({ answered: true });
  ph.distinctId = 'uuid-old';
  ph.register({ env: 'prod' });
  ph.capture('$pageview');

  identifyUnderConsent(ph, 'uid-1', { granted: true, ownedKeys: OWNED });

  assert.deepEqual(chains(ph), [['uuid-old', 'uid-1']], 'ровно одна склейка на весь вход');
  assert.equal(ph.props.env, 'prod');
});

test('без uid не делаем ничего — включать хранение некому', () => {
  const ph = fakePosthog();
  identifyUnderConsent(ph, '', { granted: true, ownedKeys: OWNED });
  assert.equal(ph.consent, -1, 'ответ на баннер сам по себе хранение не включает');
  assert.deepEqual(ph.events, []);
});

test('отзыв согласия: SDK сбрасывает, свойства переносим тем же механизмом', () => {
  const ph = fakePosthog({ answered: true });
  ph.register({ env: 'prod', camp_source: 'google' });

  preservingOwnProps(ph, OWNED, () => ph.opt_out_capturing());

  assert.equal(ph.consent, 0);
  assert.deepEqual(ph.props, { env: 'prod', camp_source: 'google' },
    'события после отзыва обязаны остаться размеченными окружением и кампанией');
});

test('перенос не выдумывает значений: пустых и отсутствующих свойств не возвращает', () => {
  const ph = fakePosthog({ answered: true });
  ph.register({ env: 'prod', camp_source: '' });

  preservingOwnProps(ph, OWNED, () => ph.opt_out_capturing());

  assert.deepEqual(ph.props, { env: 'prod' }, 'пустая строка — не значение');
});
