// Человеческий текст ошибки Supabase Auth (GoTrue) → локализованная строка
// namespace `auth.err_*` (TRIP-276). Зеркалит конвенцию `errorText.js`: чистая
// функция + свой тест, ОДНА дверь на весь клиент.
//
// Клиент НИКОГДА не показывает `error.message` GoTrue — это сырой английский
// текст сервера («Invalid login credentials»…): не локализован, не вычитан и
// течёт деталью реализации (правило #4). Вместо этого дискриминируем ТОЛЬКО по
// стабильному API auth-js, никогда по `error.message`:
//   • основной ключ — `error.code` (`AuthApiError.code`, supabase-js 2.106.2);
//   • «recovery-сессии нет» — типизированная `AuthSessionMissingError`, у которой
//     `.code` может быть `undefined`, поэтому распознаём её по `.name` (стабильно
//     и без импорта auth-js, как `errorText.js` ни от чего не зависит).
//
// Это ОТДЕЛЬНАЯ поверхность от edge-контракта `errorText.js`/`err.*`: там наши
// UPPER-коды бизнес-логики, здесь — коды GoTrue. Общего только приём (карта
// код→ключ + фолбэк), словари не смешиваются.

const FALLBACK_KEY = 'auth.err_generic';
const RESET_LINK_KEY = 'auth.err_reset_link';

// Только коды, достижимые из наших 5 auth-флоу (signInWithPassword, signUp,
// signInWithOAuth, signInWithIdToken, updateUser), сверено с типом `ErrorCode`
// пакета `@supabase/auth-js` (2.106.2). Значения — ключи
// `auth.err_*` (часть уже существовала: `err_email_exists`, `err_rate_limited`,
// `err_reset_link`). Незнакомый/отсутствующий код молча уходит в фолбэк —
// пользователю НИКОГДА не показываем ни `auth.err_<code>`, ни серверную прозу.
export const GOTRUE_CODE_TO_KEY = {
  // signInWithPassword
  invalid_credentials: 'auth.err_invalid_credentials',
  email_not_confirmed: 'auth.err_email_not_confirmed',
  // signUp (email уже существует — обычно ловится precheck'ом раньше, но код
  // приходит и напрямую; оба варианта GoTrue → одна строка).
  user_already_exists: 'auth.err_email_exists',
  email_exists: 'auth.err_email_exists',
  // Лимиты запросов/писем — общий «попробуй позже».
  over_email_send_rate_limit: 'auth.err_rate_limited',
  over_request_rate_limit: 'auth.err_rate_limited',
  // signUp / updateUser — политика пароля.
  weak_password: 'auth.err_weak_password',
  email_address_invalid: 'auth.err_email_invalid',
  // updateUser в recovery-сессии: новый пароль совпал со старым.
  same_password: 'auth.err_same_password',
  // recovery-ссылка протухла / сессия потеряна на verify. Сама
  // AuthSessionMissingError разруливается веткой по `.name` выше; эти коды —
  // когда GoTrue возвращает их вместо типизированной ошибки.
  session_not_found: RESET_LINK_KEY,
  session_expired: RESET_LINK_KEY,
  otp_expired: RESET_LINK_KEY,
  // Слишком общий код валидации: конкретнее «что-то пошло не так» честно не
  // скажешь, поэтому намеренно = фолбэк (перечислен, чтобы задокументировать,
  // что код рассмотрен, а не забыт).
  validation_failed: FALLBACK_KEY,
};

/**
 * @param {(key: string, vars?: Record<string, any>) => string} t  из `useI18n()`
 * @param {unknown} error  ошибка Supabase Auth (`{ code?, name?, message }`)
 * @returns {string} локализованная, безопасная для показа строка
 */
export function authErrorText(t, error) {
  // Типизированная ветка: у AuthSessionMissingError `.code` может быть undefined.
  if (error?.name === 'AuthSessionMissingError') return t(RESET_LINK_KEY);

  const code = error?.code;
  if (code && typeof code === 'string') {
    const key = GOTRUE_CODE_TO_KEY[code];
    if (key) {
      // `t()` возвращает сам адрес при промахе (нет строки → en-фолбэк → сырой
      // ключ). Совпадение = строки нет → в общий фолбэк, чтобы даже при дыре в
      // локали не показать пользователю `auth.err_<key>`.
      const msg = t(key);
      if (msg !== key) return msg;
    }
  }
  return t(FALLBACK_KEY);
}
