/**
 * Когда экрану входа можно уходить со страницы.
 *
 * Правило вынесено из `Login.jsx` отдельной чистой функцией, потому что у него
 * нет ни скриншота, ни типа: это последовательность состояний во времени, и
 * единственный способ её зафиксировать — тест. Регресс здесь выглядит как
 * успех (вход по-прежнему работает, просто регистрация не доезжает в аналитику),
 * поэтому ловить его глазами на ревью бесполезно.
 *
 * Что стоит за шагами:
 *   · `idle` — уходить некуда, вход ещё не случился.
 *   · `bootstrapping` — `AuthContext` пошёл за профилем (`getMe` →
 *     `account/register`). Вызывающий обязан ЗАПОМНИТЬ этот факт и вернуть его
 *     потом в `bootstrapSeen`.
 *   · `go` — можно уходить: либо профиль загружен (а значит `user_signed_up` и
 *     рекламные конверсии уже отправлены), либо бутстрап отработал и закончился
 *     неудачей — тогда уходим ровно так же, как уходили до этой правки.
 *   · `wait` — ждём. Сюда попадает СТАРТОВОЕ состояние: до входа `authChecked`
 *     обычно уже true (INITIAL_SESSION без сессии), и без `bootstrapSeen` это
 *     устаревшее true прочиталось бы как «бутстрап закончился неудачей» в тот же
 *     кадр, то есть навигация случилась бы немедленно — ровно тот баг, который
 *     правка убирает.
 *
 * @param {object} state
 * @param {boolean} state.navPending вход прошёл, уход со страницы отложен
 * @param {boolean} state.isLoadingAuth `AuthContext` сейчас грузит профиль
 * @param {boolean} state.isAuthenticated сессия видна контексту
 * @param {boolean} state.hasUser профиль уже в состоянии контекста
 * @param {boolean} state.authChecked контекст отработал проверку сессии
 * @param {boolean} state.bootstrapSeen вызыватель уже видел шаг `bootstrapping`
 * @returns {'idle'|'bootstrapping'|'go'|'wait'}
 */
export function postLoginNavStep({
  navPending,
  isLoadingAuth,
  isAuthenticated,
  hasUser,
  authChecked,
  bootstrapSeen,
}) {
  if (!navPending) return 'idle';
  if (isLoadingAuth) return 'bootstrapping';
  if (isAuthenticated && hasUser) return 'go';
  if (bootstrapSeen && authChecked) return 'go';
  return 'wait';
}
