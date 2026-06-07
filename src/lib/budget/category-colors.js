// Single source of truth for the budget / chart category palette.
//
// The canonical palette lives in CSS as the Lumo tokens --cat-1..8
// (src/design/app.css). This module mirrors those values so code that needs a
// concrete color — chart fills, and the `+ '22'` alpha-tint backgrounds that a
// CSS variable can't produce — stays in sync with the tokens.
//
// `token` → use in CSS-driven contexts (style={{ background: c.token }}).
// `hex`   → use where a literal color is required (alpha tints, canvas charts).
//
// budget_categories.color stores a literal hex (picked from CATEGORY_HEXES).
// Older rows may hold a legacy hex that's no longer in the palette; callers fall
// back to the stored value so existing categories keep rendering, while new
// picks use this Lumo palette. The old slate/blue Tailwind palette is retired.

export const CATEGORY_PALETTE = [
  { token: 'var(--cat-1)', hex: '#5470E6' },
  { token: 'var(--cat-2)', hex: '#15A2B0' },
  { token: 'var(--cat-3)', hex: '#E0568F' },
  { token: 'var(--cat-4)', hex: '#2FA866' },
  { token: 'var(--cat-5)', hex: '#E6A21E' },
  { token: 'var(--cat-6)', hex: '#8A6BF0' },
  { token: 'var(--cat-7)', hex: '#E07A4E' },
  { token: 'var(--cat-8)', hex: '#9AA1AD' },
];

/** Hex values, in palette order — the picker swatches + new-category default. */
export const CATEGORY_HEXES = CATEGORY_PALETTE.map((c) => c.hex);

/** Default color for a freshly created category. */
export const DEFAULT_CATEGORY_HEX = CATEGORY_HEXES[0];

/**
 * Resolve a category's stored color to a usable CSS color string.
 * Returns the stored value as-is when present (covers both palette hexes and
 * legacy hexes); falls back to --muted for color-less rows.
 */
export function categoryColor(category) {
  const c = category?.color;
  return c && typeof c === 'string' ? c : 'var(--muted)';
}
