/**
 * proAddons — canonical list of Pro-only trip addons (Deno edge runtime).
 *
 * Single source for the edge functions (copyTrip strips these on copy;
 * updateTripSettings gates enabling them on a non-Pro trip). The frontend mirror
 * lives in src/lib/tripAddons.js (PRO_ONLY_ADDONS) — a cross-runtime import is
 * not possible (Vite/JS vs Deno), so the FE value is locked against this list by
 * src/lib/tripAddons.test.js. Keep the two identical.
 *
 * NOTE: `calendar` is intentionally NOT here — the calendar view is a free,
 * always-available lens (see TRIP-165). Only budget / chat / telegram_assistant
 * are Pro.
 */
export const PRO_ONLY_ADDONS = ['budget', 'chat', 'telegram_assistant'] as const;
export type ProAddonKey = typeof PRO_ONLY_ADDONS[number];
export const PRO_ADDON_SET: ReadonlySet<string> = new Set(PRO_ONLY_ADDONS);
