/* global __SENTRY_RELEASE__ */
/**
 * Обратная связь / баг-репорты (TRIP-232).
 *
 * Байты скриншотов уходят браузером НАПРЯМУЮ в приватный бакет `support` — тот же
 * объявленный шов, что и загрузка файлов документов (documentMutations §G). Сама
 * строка тикета пишется сервис-ролью в edge `supportTicketCreate` (в БД из браузера
 * не пишем). Здесь — только загрузка/подметание файлов и сбор meta сессии.
 */
import { supabase } from '@/api/supabaseClient';
import { safeStorageName } from '@/lib/storage';

export const SUPPORT_BUCKET = 'support';
export const SUPPORT_MAX_FILES = 3;
export const SUPPORT_MAX_FILE_MB = 5;
export const SUPPORT_MAX_TEXT = 1000;
/** Совпадает с allowed_mime_types бакета `support` (migration 20260816184953). */
export const SUPPORT_ACCEPT = 'image/png,image/jpeg,image/webp';
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** Тип файла в allow-list бакета (drag-and-drop мимо `accept`, поэтому проверяем сами). */
export function isAllowedSupportFile(file) {
  return Boolean(file) && ALLOWED_MIME.has(file.type);
}

/** Компактный размер файла для строки: «412 KB» / «2.1 MB». */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Загрузить локальные File[] в приватный бакет `support`. Возвращает и успешные
 * дескрипторы `{ path, name, size, mime }` (их путь едет в edge → колонку files),
 * и пофайловые ошибки — чтобы вызывающий показал их, не потеряв остальные.
 * Ключ — `<uuid>/<safeName>`: uuid даёт уникальность, имя санитизируется (Storage
 * не принимает не-ASCII ключи), оригинальное имя хранится отдельно для показа.
 */
export async function uploadSupportFiles(files) {
  const uploaded = [];
  const errors = [];
  for (const file of Array.from(files || [])) {
    const path = `${crypto.randomUUID()}/${safeStorageName(file.name)}`;
    const { error } = await supabase.storage
      .from(SUPPORT_BUCKET)
      .upload(path, file, { contentType: file.type || undefined });
    if (error) { errors.push({ file }); continue; }
    uploaded.push({ path, name: file.name, size: file.size, mime: file.type });
  }
  return { uploaded, errors };
}

/** Подмести осиротевшие объекты (тикет не сохранился). Best-effort, не бросает. */
export function removeSupportFiles(paths) {
  if (!paths?.length) return;
  supabase.storage.from(SUPPORT_BUCKET).remove(paths).then(() => {}, () => {});
}

/**
 * Дешёвый контекст сессии/устройства для колонки meta — то, что делает баг-репорт
 * полезным (адрес экрана, версия сборки, размер вьюпорта, техника). Скрин экрана
 * силами браузера молча снять нельзя — это на будущее.
 */
export function buildFeedbackMeta() {
  try {
    return {
      url: window.location.href,
      // SHA сборки — тот же глобал, что Sentry использует как release.
      app_version: (typeof __SENTRY_RELEASE__ !== 'undefined' && __SENTRY_RELEASE__) || null,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      user_agent: navigator.userAgent,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
    };
  } catch {
    return {};
  }
}
