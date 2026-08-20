/**
 * getCoverPresets
 *
 * GET/POST — no body required.
 *
 * Витрина каталога обложек трипа: отдаёт активные пресеты (публичные URL картинок
 * из бакета `trip-cover-presets`), отсортированные по `sort`. Клиент показывает их
 * в пикере обложки; выбор пресета копирует его URL в `trips.cover_image_url`.
 *
 * Дверь `auth` (см. DOORS в security-tiers): любой залогиненный, трип не при чём —
 * это общий справочник. Таблица `cover_presets` — ярус D (deny-all), поэтому читаем
 * под service_role; прямого клиентского SELECT нет (эпик «единая дверь» TRIP-374).
 *
 * Ошибки — через `throw HttpError` (рендерит `withHandler` каноном `{error,code}`),
 * не сырым `Response.json({error})`: так гард 2r не считает лишний «сырой ответ».
 */

import { HttpError, withHandler } from '../_shared/http.ts';
import { getRequestUser, supabaseAdmin } from '../_shared/supabaseAdmin.ts';

Deno.serve(withHandler('getCoverPresets', async (req, corsHeaders) => {
    const user = await getRequestUser(req);
    if (!user) throw new HttpError(401, 'Unauthorized', 'UNAUTHENTICATED');

    const { data, error } = await supabaseAdmin
      .from('cover_presets')
      .select('id, image_url')
      .eq('active', true)
      .order('sort', { ascending: true });

    if (error) throw new HttpError(500, 'Failed to load cover presets', 'INTERNAL');

    // select('id, image_url') уже отдаёт ровно нужную форму — лишней проекции нет.
    return Response.json({ presets: data ?? [] }, { headers: corsHeaders });
}));
