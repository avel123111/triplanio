/**
 * Компактный размер файла для строки: «412 KB» / «2.1 MB».
 *
 * Единый источник — раньше та же тройка веток жила локальными копиями в
 * EventAiBlock (AI-парсер) и в поддержке (TRIP-232); один формат на оба.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
