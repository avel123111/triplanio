import React from 'react';

/**
 * Unified user avatar.
 * - If `avatarUrl` is provided, renders the image.
 * - Otherwise, renders initials on a colored background.
 *   Color is deterministically derived from the email/name so the same
 *   user always gets the same color across the app.
 */

// Pleasant, accessible palette (bg + foreground)
const PALETTE = [
  { bg: 'bg-rose-500', fg: 'text-white' },
  { bg: 'bg-pink-500', fg: 'text-white' },
  { bg: 'bg-fuchsia-500', fg: 'text-white' },
  { bg: 'bg-purple-500', fg: 'text-white' },
  { bg: 'bg-violet-500', fg: 'text-white' },
  { bg: 'bg-indigo-500', fg: 'text-white' },
  { bg: 'bg-blue-500', fg: 'text-white' },
  { bg: 'bg-sky-500', fg: 'text-white' },
  { bg: 'bg-cyan-600', fg: 'text-white' },
  { bg: 'bg-teal-500', fg: 'text-white' },
  { bg: 'bg-emerald-500', fg: 'text-white' },
  { bg: 'bg-green-600', fg: 'text-white' },
  { bg: 'bg-lime-600', fg: 'text-white' },
  { bg: 'bg-amber-500', fg: 'text-white' },
  { bg: 'bg-orange-500', fg: 'text-white' },
  { bg: 'bg-red-500', fg: 'text-white' },
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForUser(seed) {
  const key = (seed || '?').toLowerCase().trim();
  return PALETTE[hashString(key) % PALETTE.length];
}

export function initialsFor(name, email) {
  const source = (name || '').trim() || (email || '').split('@')[0] || '?';
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0]?.slice(0, 2) || '?').toUpperCase();
}

const SIZE_CLASSES = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
  xl: 'w-16 h-16 text-xl',
};

export default function UserAvatar({
  name,
  email,
  avatarUrl,
  size = 'md',
  ring = true,
  className = '',
}) {
  const sz = SIZE_CLASSES[size] || SIZE_CLASSES.md;
  const ringCls = ring ? 'ring-2 ring-background' : '';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name || email || ''}
        className={`${sz} rounded-full object-cover ${ringCls} ${className}`}
      />
    );
  }

  const seed = (email || name || '?');
  const { bg, fg } = colorForUser(seed);
  const initials = initialsFor(name, email);

  return (
    <div
      className={`${sz} rounded-full ${bg} ${fg} flex items-center justify-center font-semibold ${ringCls} ${className}`}
      aria-label={name || email || ''}
    >
      {initials}
    </div>
  );
}