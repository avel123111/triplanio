/**
 * supportTicketCreate (TRIP-232)
 *
 * POST body: { text?, files?: [{ path, name, size, mime }], lang?, meta?, source? }
 *
 * Пишет строку обратной связи в `support_tickets` сервис-ролью — из браузера в
 * БД не пишем. Файлы (скриншоты) браузер уже загрузил напрямую в приватный бакет
 * `support`; сюда приходят только их пути, которые кладём в `files`.
 *
 * Отправка требует непустой текст И/ИЛИ хотя бы один файл (тот же инвариант, что
 * и CHECK в БД, и что у AI-парсера). Авторизованная зона: user_id берём из JWT
 * (не из тела — не доверяем клиенту), lang шлёт клиент. trip_id/неавторизованная
 * зона — на будущее (сейчас всегда NULL / всегда с сессией).
 *
 * verify_jwt = true по умолчанию (в config.toml не пинуем): функция и так требует
 * валидную сессию через getRequestUser.
 */

import { withHandler, HttpError, readJson } from '../_shared/http.ts';
import { supabaseAdmin, requireUser } from '../_shared/supabaseAdmin.ts';

const MAX_FILES = 3;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 1000;
const MAX_LANG = 16;
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const ALLOWED_SOURCE = new Set(['settings']);

type FileEntry = { path: string; name: string; size: number; mime: string };

/** Валидация массива files из тела — форма, лимиты, mime. Бросает HttpError(400,'INVALID_INPUT'). */
function parseFiles(raw: unknown): FileEntry[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new HttpError(400, 'files must be an array', 'INVALID_INPUT');
  if (raw.length > MAX_FILES) throw new HttpError(400, `At most ${MAX_FILES} files`, 'INVALID_INPUT');
  return raw.map((f) => {
    const o = (f ?? {}) as Partial<FileEntry>;
    const path = typeof o.path === 'string' ? o.path.trim() : '';
    const name = typeof o.name === 'string' ? o.name.slice(0, 256) : '';
    const size = Number(o.size) || 0;
    const mime = typeof o.mime === 'string' ? o.mime : '';
    if (!path || path.length > 512) throw new HttpError(400, 'Bad file path', 'INVALID_INPUT');
    if (!ALLOWED_MIME.has(mime)) throw new HttpError(400, 'Unsupported file type', 'INVALID_INPUT');
    if (size > MAX_FILE_BYTES) throw new HttpError(400, 'File too large', 'INVALID_INPUT');
    return { path, name, size, mime };
  });
}

Deno.serve(withHandler('supportTicketCreate', async (req, corsHeaders) => {
  const user = await requireUser(req);

  const body = await readJson(req);

  const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_TEXT) : '';
  const files = parseFiles(body.files);

  // Тот же инвариант, что и CHECK support_tickets_text_or_files.
  if (!text && files.length === 0) {
    throw new HttpError(400, 'Provide a message or at least one screenshot', 'INVALID_INPUT');
  }

  const source = typeof body.source === 'string' && ALLOWED_SOURCE.has(body.source) ? body.source : 'settings';
  const lang = typeof body.lang === 'string' && body.lang ? body.lang.slice(0, MAX_LANG) : null;
  const meta = body.meta != null && typeof body.meta === 'object' && !Array.isArray(body.meta)
    ? body.meta
    : {};

  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .insert({
      source,
      user_id: user.id,
      lang,
      text: text || null,
      files,
      meta,
    })
    .select('number')
    .single();

  if (error) throw error; // → 500 INTERNAL, reported by withHandler

  return Response.json({ ok: true, number: data?.number ?? null }, { headers: corsHeaders });
}));
