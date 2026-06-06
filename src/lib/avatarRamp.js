import { hashStr } from '@/lib/hash';

/**
 * SINGLE SOURCE OF TRUTH for avatar colours.
 *
 * 8 sanctioned gradient pairs [base, lighter]. A user's colour is picked
 * deterministically from a seed (name/email) so the same person is always the
 * same colour everywhere. Both <Avatar> (design/index.jsx) and <UserAvatar>
 * render from this ramp — do not introduce a second palette.
 *
 * (Kept in JS rather than CSS tokens because the gradient is composed in JS;
 * JS cannot cleanly read CSS custom properties at render time.)
 */
export const AVATAR_RAMP = [
  ['#2167e2', '#5a8ff0'],
  ['#c9603a', '#e08158'],
  ['#1f8a5b', '#4ab98a'],
  ['#9c4ad9', '#c66ce2'],
  ['#c98a1a', '#e0a64b'],
  ['#4a6cd9', '#7a92e8'],
  ['#a83e6a', '#c96792'],
  ['#3d8aa8', '#5fadc9'],
];

/** Deterministic [base, lighter] pair for a seed (name/email). */
export function avatarPair(seed) {
  return AVATAR_RAMP[hashStr((seed || '?').toLowerCase().trim()) % AVATAR_RAMP.length];
}

/** Deterministic avatar background gradient for a seed. */
export function avatarGradient(seed) {
  const [a, b] = avatarPair(seed);
  return `linear-gradient(135deg, ${a}, ${b})`;
}
