/**
 * envTag() — единственный TS-источник метки окружения для edge-рантайма
 * (TRIP-284, свод rule 6). Раньше дефолт `SENTRY_ENVIRONMENT ?? 'production'`
 * жил тремя копиями: `sentry.ts` (тег `environment`), `emit.ts` (`env` на wire в
 * n8n) и `analytics.ts` (PostHog `env`, ещё и своей формой `=== 'development'`).
 * Копии дрейфуют независимо; здесь — одна.
 *
 * Значение окружения задаётся секретом функции `SENTRY_ENVIRONMENT` по проекту
 * (development | production). Отсутствует/пусто → 'production' (dev-проекты метку
 * задают; безымянный проект — прод по умолчанию). Пустой/пробельный секрет
 * трактуется как незаданный.
 *
 * Модуль намеренно БЕЗ сайд-эффект-импортов (в отличие от `sentry.ts`, тянущего
 * `npm:@sentry/deno`), поэтому чистый `resolveEnvTag` импортируется под
 * `deno test` без флагов — env читает только `envTag()`, а его тесты не зовут.
 */

/** Чистая нормализация сырого значения секрета в метку окружения. Тестируема
 *  без доступа к `Deno.env`. */
export function resolveEnvTag(raw: string | null | undefined): string {
  const v = raw?.trim();
  return v ? v : 'production';
}

/** Метка окружения текущего проекта из секрета `SENTRY_ENVIRONMENT`. */
export function envTag(): string {
  return resolveEnvTag(Deno.env.get('SENTRY_ENVIRONMENT'));
}
