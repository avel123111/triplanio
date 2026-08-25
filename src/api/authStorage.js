// Хранилище сессии Supabase с поддержкой «запомнить меня» (TRIP-464).
//
// По умолчанию supabase-js держит сессию в localStorage (persistSession) — она
// переживает закрытие вкладки. Это и есть «запомнить». Если пользователь снял
// галочку — сессия должна жить только до закрытия вкладки, то есть в
// sessionStorage. supabase-js выбирает хранилище ОДИН раз при создании клиента,
// поэтому переключение делаем внутри самого адаптера по флагу, который логин
// выставляет ДО входа.
//
// Обратная совместимость: флага нет → localStorage (как сейчас), поэтому уже
// живущие сессии и текущее поведение не меняются.

const FLAG = 'tpl_remember';

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** true = запоминать (localStorage), false = только на вкладку (sessionStorage). */
const rememberOn = () => safe(() => localStorage.getItem(FLAG) !== '0', true);

/** Логин зовёт это ДО signIn: решает, куда ляжет свежая сессия. */
export const setRemember = (on) => {
  safe(() => localStorage.setItem(FLAG, on ? '1' : '0'));
};

export const rememberStorage = {
  // читаем из обоих — сессия могла лечь в любое из хранилищ
  getItem: (key) =>
    safe(() => localStorage.getItem(key) ?? sessionStorage.getItem(key), null),
  // пишем в выбранное флагом, чистим второе, чтобы не осталось двух копий
  setItem: (key, value) =>
    safe(() => {
      if (rememberOn()) {
        localStorage.setItem(key, value);
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
        localStorage.removeItem(key);
      }
    }),
  removeItem: (key) =>
    safe(() => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    }),
};
