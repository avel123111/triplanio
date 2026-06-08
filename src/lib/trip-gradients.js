/**
 * Built-in cover gradients for trips. Stored in `trips.cover_gradient` as the
 * `id` string ('gradient_1'..'gradient_16'). The `css` field is used for the
 * full-size cover render; `preview` is the smaller swatch used inside the
 * picker. Names are i18n-agnostic English labels.
 *
 * 16 gradients from the Lumo design system (4 groups × 4):
 *   gradient_1–4   Fire (warm oranges/reds/pinks)
 *   gradient_5–8   Water (blues/cyans)
 *   gradient_9–12  Nature (greens/earthy)
 *   gradient_13–16 Night (purples/magentas)
 *
 * Backward-compat: gradient_1–8 keep the same IDs so existing trips
 * automatically display the new Lumo covers without a DB migration.
 */
export const TRIP_GRADIENTS = [
  /* ── Fire ──────────────────────────────────────────────── */
  {
    id: 'gradient_1',
    name: 'Ember',
    css: 'linear-gradient(to bottom left, #F4A85A 0%, #C84060 100%)',
    preview: 'linear-gradient(135deg, #F4A85A, #C84060)',
  },
  {
    id: 'gradient_2',
    name: 'Golden',
    css: 'linear-gradient(to bottom left, #F2E060 0%, #D08820 100%)',
    preview: 'linear-gradient(135deg, #F2E060, #D08820)',
  },
  {
    id: 'gradient_3',
    name: 'Blossom',
    css: 'linear-gradient(to bottom left, #F09888 0%, #E03888 100%)',
    preview: 'linear-gradient(135deg, #F09888, #E03888)',
  },
  {
    id: 'gradient_4',
    name: 'Volcano',
    css: 'linear-gradient(to bottom left, #E05030 0%, #8C1A18 100%)',
    preview: 'linear-gradient(135deg, #E05030, #8C1A18)',
  },
  /* ── Water ─────────────────────────────────────────────── */
  {
    id: 'gradient_5',
    name: 'Sky',
    css: 'linear-gradient(to bottom left, #62A8F0 0%, #2050C0 100%)',
    preview: 'linear-gradient(135deg, #62A8F0, #2050C0)',
  },
  {
    id: 'gradient_6',
    name: 'Lagoon',
    css: 'linear-gradient(to bottom left, #40C8D0 0%, #0870A0 100%)',
    preview: 'linear-gradient(135deg, #40C8D0, #0870A0)',
  },
  {
    id: 'gradient_7',
    name: 'Deep Sea',
    css: 'linear-gradient(to bottom left, #5470E6 0%, #0E80A8 100%)',
    preview: 'linear-gradient(135deg, #5470E6, #0E80A8)',
  },
  {
    id: 'gradient_8',
    name: 'Twilight',
    css: 'linear-gradient(to bottom left, #9090E8 0%, #2828A0 100%)',
    preview: 'linear-gradient(135deg, #9090E8, #2828A0)',
  },
  /* ── Nature ─────────────────────────────────────────────── */
  {
    id: 'gradient_9',
    name: 'Forest',
    css: 'linear-gradient(to bottom left, #80D858 0%, #1E8840 100%)',
    preview: 'linear-gradient(135deg, #80D858, #1E8840)',
  },
  {
    id: 'gradient_10',
    name: 'Desert',
    css: 'linear-gradient(to bottom left, #F09040 0%, #A83C10 100%)',
    preview: 'linear-gradient(135deg, #F09040, #A83C10)',
  },
  {
    id: 'gradient_11',
    name: 'Jade',
    css: 'linear-gradient(to bottom left, #48D898 0%, #107858 100%)',
    preview: 'linear-gradient(135deg, #48D898, #107858)',
  },
  {
    id: 'gradient_12',
    name: 'Aurora',
    css: 'linear-gradient(to bottom left, #78E0A0 0%, #3868C8 100%)',
    preview: 'linear-gradient(135deg, #78E0A0, #3868C8)',
  },
  /* ── Night ──────────────────────────────────────────────── */
  {
    id: 'gradient_13',
    name: 'Galaxy',
    css: 'linear-gradient(to bottom left, #B080F0 0%, #5020A8 100%)',
    preview: 'linear-gradient(135deg, #B080F0, #5020A8)',
  },
  {
    id: 'gradient_14',
    name: 'Rose Night',
    css: 'linear-gradient(to bottom left, #F0A0C8 0%, #C02878 100%)',
    preview: 'linear-gradient(135deg, #F0A0C8, #C02878)',
  },
  {
    id: 'gradient_15',
    name: 'Cosmic',
    css: 'linear-gradient(to bottom left, #E070E8 0%, #8820B0 100%)',
    preview: 'linear-gradient(135deg, #E070E8, #8820B0)',
  },
  {
    id: 'gradient_16',
    name: 'Spectrum',
    css: 'linear-gradient(to bottom left, #70B0F0 0%, #E040A0 50%, #F08840 100%)',
    preview: 'linear-gradient(135deg, #70B0F0, #E040A0, #F08840)',
  },
];

export function getGradientById(id) {
  if (!id) return null;
  return TRIP_GRADIENTS.find((g) => g.id === id) || null;
}
