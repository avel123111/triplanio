// Предикат «этот адрес можно отдать браузеру» — гейт шва авторизации.
//
// Пока он жил внутри Login.jsx, проверить его было нечем, а стоил он открытого
// редиректа: `startsWith('/')` пропускал `//evil.com`, и вызыватель уводил
// человека с домена через `window.location.href`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSafeInternalPath, PENDING_KEY, APP_HOME,
  rememberPostLogin, postLoginPath, takePostLoginPath, forgetPostLoginOnArrival,
} from './postLoginPath.js';

/** Подменяет `sessionStorage` минимальной рабочей копией: модуль под тестом, а
 *  `node --test` браузерных хранилищ не имеет. Свой, а не общий с
 *  `plannerDraft.test.js`: там подменяется ДРУГОЕ хранилище (`localStorage`), и
 *  общий хелпер пришлось бы параметризовать именем — больше механики, чем
 *  экономии. */
function withStorage(run) {
  const map = new Map();
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    },
  });
  try { run(); } finally {
    if (prev) Object.defineProperty(globalThis, 'sessionStorage', prev);
    else delete globalThis.sessionStorage;
  }
}

test('★★★ protocol-relative НЕ проходит — это и есть уход с домена', () => {
  for (const bad of ['//evil.com', '//evil.com/join/x', '/\\evil.com', '//', '/\\']) {
    assert.equal(isSafeInternalPath(bad), false, bad);
  }
});

test('внутренний путь проходит', () => {
  for (const ok of ['/trips', '/join/abc', '/trip/1?lens=route', '/x#y', '/']) {
    assert.equal(isSafeInternalPath(ok), true, ok);
  }
});

test('внешний адрес и мусор не проходят', () => {
  for (const bad of ['https://evil.com', 'http://evil.com', 'evil.com', 'javascript:alert(1)',
    '', ' ', null, undefined, 42, {}, ['/trips']]) {
    assert.equal(isSafeInternalPath(bad), false, String(bad));
  }
});

test('ключ хранилища и дом объявлены здесь — оба берутся отсюда, а не переписываются', () => {
  assert.equal(PENDING_KEY, 'postLoginRedirect');
  assert.equal(APP_HOME, '/trips');
});

test('★★★ отложенный адрес ОДНОРАЗОВЫЙ — иначе один вход уводит туда и все следующие', () => {
  // Намерение «верни меня сюда после входа» живёт до входа, а не до конца
  // сессии вкладки. Пока запись переживала вход, один клик «Создать аккаунт» на
  // шаге «Обзор» уводил в планировщик КАЖДЫЙ следующий вход в этой вкладке —
  // даже совсем не связанный с черновиком (TRIP-505).
  withStorage(() => {
    rememberPostLogin('/trip/abc?lens=route');
    assert.equal(takePostLoginPath(), '/trip/abc?lens=route');
    assert.equal(takePostLoginPath(), '/trips', 'адрес пережил собственную трату');
    assert.equal(postLoginPath(), '/trips');
  });
});

test('★★ чтение БЕЗ траты остаётся — его зовёт тот, чей переход может не случиться', () => {
  // `postLoginRedirectTo()` отдаёт адрес Supabase (письмо, OAuth): человек
  // может закрыть окно провайдера, а письмо ещё и переотправляют — потрать
  // запись там, и вторая отправка уедет на домашнюю.
  withStorage(() => {
    rememberPostLogin('/trip/abc');
    assert.equal(postLoginPath(), '/trip/abc');
    assert.equal(postLoginPath(), '/trip/abc', 'чтение потратило запись');
  });
});


// ── трата ПО ПРИБЫТИЮ ────────────────────────────────────────────────────────
// Второй способ прибытия: от провайдера браузер приезжает СРАЗУ на отложенный
// адрес (`redirectTo` собран из него же), и `takePostLoginPath` там никто не
// зовёт. Предикат обязан быть «пришёл», а не «есть сессия» — иначе он тратит
// запись на чужой странице.
//
// ⚠️ МУТАЦИИ, КОТОРЫМИ ЭТИ ТРИ ПРОВЕРЕНЫ КРАСНЫМИ: вернуть безусловный
// `forgetPostLogin()` — падают обе «не тратит»; сравнивать адрес целиком, а не
// путь — падает проверка со строкой запроса.

test('★★★ пришёл по отложенному адресу — запись потрачена', () => {
  withStorage(() => {
    rememberPostLogin('/trip/abc');
    assert.equal(forgetPostLoginOnArrival('/trip/abc'), true);
    assert.equal(postLoginPath(), APP_HOME, 'после прибытия запись обязана исчезнуть');
  });
});

test('★★★ НЕ пришёл — запись цела (письмо восстановления и гонка с Login)', () => {
  for (const here of ['/reset-password', '/login', '/trips']) {
    withStorage(() => {
      rememberPostLogin('/trip/abc');
      assert.equal(forgetPostLoginOnArrival(here), false, here);
      assert.equal(postLoginPath(), '/trip/abc',
        `на ${here} человек ещё не пришёл — тратить запись нечем и незачем`);
    });
  }
});

test('★★ строка запроса частью адреса прибытия не считается', () => {
  withStorage(() => {
    rememberPostLogin('/trip/abc?lens=route');
    assert.equal(forgetPostLoginOnArrival('/trip/abc'), true);
    assert.equal(postLoginPath(), APP_HOME);
  });
});

test('пустое хранилище тратить нечего', () => {
  withStorage(() => {
    assert.equal(forgetPostLoginOnArrival('/trips'), false);
  });
});
