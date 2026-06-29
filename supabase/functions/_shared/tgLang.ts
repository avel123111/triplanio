/**
 * tgLang — единый резолв языка для Telegram-флоу (telegramWebhook + aiGate).
 *
 * Язык берётся из users.language привязавшего юзера; фолбэк — language_code
 * из Telegram-апдейта. Поддерживаемые языки: ru / en / es (как везде в UI).
 * Вынесено в _shared, чтобы правки логики языка не разъезжались между ботом
 * и привратником.
 */
import { supabaseAdmin } from './supabaseAdmin.ts';

export type Lang = 'ru' | 'en' | 'es';

export function pickLang(code?: string | null): Lang {
  const c = (code || '').slice(0, 2).toLowerCase();
  return c === 'ru' || c === 'es' || c === 'en' ? (c as Lang) : 'en';
}

export async function resolveLang(userId?: string | null, fallbackCode?: string | null): Promise<Lang> {
  if (userId) {
    const { data } = await supabaseAdmin.from('users').select('language').eq('id', userId).maybeSingle();
    const l = data?.language;
    if (l === 'ru' || l === 'en' || l === 'es') return l;
  }
  return pickLang(fallbackCode);
}
