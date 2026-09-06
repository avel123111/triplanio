import test from 'node:test';
import assert from 'node:assert/strict';
import { postLoginNavStep } from './postLoginNav.js';

// Состояние «человек открыл /login, ещё не входил»: сессии нет, INITIAL_SESSION
// уже отработал, поэтому authChecked=true, а isAuthenticated=false.
const beforeLogin = {
  navPending: false,
  isLoadingAuth: false,
  isAuthenticated: false,
  hasUser: false,
  authChecked: true,
  bootstrapSeen: false,
};

test('до входа уходить некуда', () => {
  assert.equal(postLoginNavStep(beforeLogin), 'idle');
});

test('устаревший authChecked НЕ выпускает со страницы сразу после входа', () => {
  // Ровно тот кадр, в котором ломалось: вход прошёл, AuthContext ещё не успел
  // выставить isLoadingAuth, а authChecked остался true с загрузки страницы.
  // Прочитать его как «бутстрап закончился» значит уйти немедленно — то есть
  // вернуть исходный баг.
  assert.equal(postLoginNavStep({ ...beforeLogin, navPending: true }), 'wait');
});

test('пошёл бутстрап — вызывающий обязан это запомнить', () => {
  assert.equal(
    postLoginNavStep({ ...beforeLogin, navPending: true, isLoadingAuth: true }),
    'bootstrapping',
  );
});

test('во время бутстрапа со страницы не уходим', () => {
  const during = postLoginNavStep({
    ...beforeLogin,
    navPending: true,
    isLoadingAuth: true,
    bootstrapSeen: true,
  });
  assert.notEqual(during, 'go');
});

test('профиль загружен — уходим (событие регистрации уже отправлено)', () => {
  assert.equal(
    postLoginNavStep({
      navPending: true,
      isLoadingAuth: false,
      isAuthenticated: true,
      hasUser: true,
      authChecked: true,
      bootstrapSeen: true,
    }),
    'go',
  );
});

test('isAuthenticated без профиля — ещё не готово', () => {
  // Полусостояние: сеттеры контекста прилетели не все. Уходить рано, иначе
  // возвращается та же гонка, только уже с 15 fps.
  assert.equal(
    postLoginNavStep({
      navPending: true,
      isLoadingAuth: false,
      isAuthenticated: true,
      hasUser: false,
      authChecked: true,
      bootstrapSeen: false,
    }),
    'wait',
  );
});

test('бутстрап отработал и не смог — уходим так же, как уходили раньше', () => {
  assert.equal(
    postLoginNavStep({
      navPending: true,
      isLoadingAuth: false,
      isAuthenticated: false,
      hasUser: false,
      authChecked: true,
      bootstrapSeen: true,
    }),
    'go',
  );
});
