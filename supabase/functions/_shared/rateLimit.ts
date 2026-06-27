/**
 * rateLimit — тонкая обёртка над SQL-функцией check_and_bump_rate_limit
 * (миграция 20260627162140_ai_rate_limits). Единый серверный примитив для
 * всех AI-флоу (TRIP-111): planTripWithAi / parseBookingWithAi / callTriplanioAi
 * / aiGate (TG-бот). Пороги задаются на месте вызова (аргументы), вся логика
 * окна — в SQL.
 *
 * fail-open: при ошибке RPC (транзиентный сбой БД) НЕ блокируем юзера —
 * лучше пропустить вызов, чем положить фичу из-за глюка счётчика. Стоимость
 * единичного «проскочившего» вызова мала; ошибка логируется.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfter: number; // секунд до конца окна
};

export type RateSubject = 'user' | 'trip' | 'chat';

export async function checkRateLimit(
  admin: SupabaseClient,
  subjectType: RateSubject,
  subjectId: string,
  flow: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  const { data, error } = await admin.rpc('check_and_bump_rate_limit', {
    p_subject_type: subjectType,
    p_subject_id: subjectId,
    p_flow: flow,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error('check_and_bump_rate_limit rpc error:', error.message, { flow, subjectType });
    return { allowed: true, remaining: limit, retryAfter: 0 }; // fail-open
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    remaining: row?.remaining ?? 0,
    retryAfter: row?.retry_after ?? windowSeconds,
  };
}

/** Минуты до конца окна, округлённые вверх (для текста «попробуй через ~N мин»). */
export function retryMinutes(retryAfterSeconds: number): number {
  return Math.max(1, Math.ceil((retryAfterSeconds || 0) / 60));
}
