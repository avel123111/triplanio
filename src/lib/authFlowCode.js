// Коды ФЛОУ наших auth-precheck edge-функций (`requestPasswordReset`,
// `signupPrecheck`) → что экрану делать. Третья дверь того же приёма, что
// `errorText.js` и `authErrorText.js`: чистая функция + свой тест, ОДНА карта
// на весь клиент.
//
// Три поверхности, три словаря, намеренно НЕ смешиваются:
//   • `errorText.js`     — UPPER-коды edge-контракта бизнес-логики (`err.*`),
//                          реестр `_shared/errorCodes.ts`, гарды 2v + 3a;
//   • `authErrorText.js` — коды GoTrue (`auth.err_*`);
//   • ЭТОТ файл          — наши lowercase-коды в ответе 200 обеих precheck-
//                          функций. Это НЕ ошибки транспорта: 200 + `{code}` —
//                          это СОСТОЯНИЕ флоу, и половина кодов ведёт не к
//                          ошибке, а к смене экрана.
//
// ЗАЧЕМ КАРТА. До неё три обработчика `Login.jsx` (`handleReset`,
// `handleResend`, `handleSignup`) ветвились по одним и тем же кодам каждый
// по-своему, и расхождение уже случилось, причём молча:
//   • `send_failed` (письмо физически не ушло) в `handleReset` схлопывался в
//     «что-то пошло не так» — человек шёл ждать письмо, которого не будет;
//   • в `handleResend` тот же `send_failed` проваливался в ветку УСПЕХА —
//     кнопка блокировалась таймером на 60 секунд, а сообщения не было вовсе.
// Один код — три поведения в трёх функциях. Карта делает набор явным, а
// добавление кода — одной строкой в одном месте.
//
// ★ ГРАНИЦА: карта отдаёт ФАКТЫ о коде, а решение принимает вызывающий. Она
// не зовёт `setError`, не двигает экран и не трогает таймер — иначе её нельзя
// проверить чистым тестом, а именно тест здесь и есть гейт (поведение этих
// веток невозможно увидеть глазами: чтобы воспроизвести `send_failed`, нужен
// сломанный почтовый провайдер).

/** Ключ, которым отвечаем на код, которого нет в словаре флоу. */
const FALLBACK_KEY = 'auth.err_generic';

/**
 * @typedef {object} AuthFlowResult
 * @property {boolean} sent      письмо ушло → экран «проверь почту» / рестарт таймера
 * @property {boolean} resent    письмо было ПОВТОРНЫМ (подтверждение выслали заново)
 * @property {boolean} proceed   precheck разрешил идти дальше и создавать аккаунт
 * @property {string|null} errorKey  i18n-ключ ошибки, если код — отказ
 * @property {boolean} cooldown  код означает «подожди ~60 c» → запустить таймер
 * @property {string|null} reason метка причины для `signup_failed` (только signup)
 */

// `requestPasswordReset` — восстановление пароля.
const RESET_CODES = {
  reset_sent: { sent: true },
  account_not_found: { errorKey: 'auth.err_account_not_found' },
  // Наш лимит 5/час на адрес — ждать долго, поэтому свой текст, не общий.
  rate_limited: { errorKey: 'auth.err_reset_rate_limited' },
  // Минимальный интервал Supabase между письмами (~60 c) — ждать минуту.
  retry_soon: { errorKey: 'auth.err_retry_soon', cooldown: true },
  // Письмо НЕ отправилось: сбой почтового провайдера. Отдельный текст —
  // иначе человек уходит ждать письмо, которого не будет.
  send_failed: { errorKey: 'auth.err_send_failed' },
};

// `signupPrecheck` — проверка адреса перед регистрацией. Тот же `rate_limited`
// значит здесь ДРУГОЕ (лимит на IP, а не на сброс пароля) и несёт свой текст:
// это не рассинхрон, а разная предметная область, поэтому словари раздельные.
const SIGNUP_CODES = {
  ok: { proceed: true },
  confirmation_resent: { sent: true, resent: true },
  email_exists: { errorKey: 'auth.err_email_exists', reason: 'email_exists' },
  rate_limited: { errorKey: 'auth.err_rate_limited', reason: 'rate_limited' },
  retry_soon: { errorKey: 'auth.err_retry_soon', reason: 'retry_soon', cooldown: true },
};

const FLOWS = { reset: RESET_CODES, signup: SIGNUP_CODES };

/** Пустой результат — все факты выключены; ветки-успехи их включают точечно. */
const NONE = { sent: false, resent: false, proceed: false, errorKey: null, cooldown: false, reason: null };

/**
 * @param {'reset'|'signup'} flow  какая функция отвечала
 * @param {unknown} code           `data.code` из её ответа
 * @returns {AuthFlowResult}
 */
export function authFlowResult(flow, code) {
  const table = FLOWS[flow];
  const hit = table && typeof code === 'string' ? table[code] : undefined;
  // Незнакомый (или отсутствующий) код — общий отказ. Экран НИКОГДА не должен
  // молча продолжать на коде, которого не знает: ровно так `send_failed`
  // проезжал как успех.
  if (!hit) {
    return { ...NONE, errorKey: FALLBACK_KEY, reason: flow === 'signup' ? 'precheck_failed' : null };
  }
  return { ...NONE, ...hit };
}
