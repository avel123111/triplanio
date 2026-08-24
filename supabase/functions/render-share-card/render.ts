/**
 * Share-card static assets (TRIP-193).
 *
 * The card is now rasterised IN THE BROWSER (no server resvg), so the edge only
 * needs to hand the client the default background as a data URI. The bytes are
 * embedded (base64) in assets_b64.ts because Supabase edge does not serve bundled
 * files via Deno.readFile(import.meta.url) - the eszip bundler ships the module
 * graph, not arbitrary files.
 */
import { BG_DEFAULT_B64 } from './assets_b64.ts';

/** The default background as a base64 data URI (no decode needed - already b64).
 *
 * ⚠️ КОНТРАКТ С ФРОНТОМ (src/lib/shareCardBg.js): этот фон обязан оставаться
 * ЕДИНСТВЕННЫМ jpeg-data-URI во всём SVG карточки — клиент подменяет его
 * регэкспом `data:image/jpeg;base64,…` на пользовательский фон (превью И
 * финальный PNG). Перегенерация фона в webp/png или второй jpeg-ассет в
 * шаблоне МОЛЧА превращают подмену в no-op (фронт кричит в Sentry сторожем в
 * ShareCardDialog): меняешь формат здесь — меняй регэксп там, либо заводи
 * bg-параметр запроса (upgrade-path описан в shareCardBg.js). */
export function defaultBgDataUri(): string {
  return `data:image/jpeg;base64,${BG_DEFAULT_B64}`;
}
