import React from 'react';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { TRIPLANIO_BOT_USER_ID } from '@/lib/triplanio';

/**
 * Avatar for the Triplanio AI assistant. Renders the bot's uploaded avatar
 * if available, otherwise falls back to a branded robot SVG on a gradient circle.
 *
 * Props:
 *   - size: 'xs' | 'sm' | 'md' | 'lg'  (default 'md')
 *
 * `ring`, `className`, `tripId` and `avatarUrl` were dropped — no call site ever
 * passed them, so the pre-resolved-URL branch of the lookup was unreachable too.
 */
// Mirrors the chat design's avatar scale — chat is this component's only
// consumer, so the two scales are kept identical on purpose.
// `xs` is the disc INSIDE a 26px status pill: the design draws it as a 26px
// avatar with a 2px surface ring, i.e. 22px of visible gradient with room to
// breathe. Without that step the disc filled the pill edge to edge and looked
// like it was bursting out of it.
const SIZE_PX = {
  xs: 22,   // inside the "Triplanio печатает" pill
  sm: 26,
  md: 32,   // stream + assistant reply + mention row
  lg: 36,
};

const SVG_SIZE = {
  xs: 12,
  sm: 14,
  md: 20,
  lg: 22,
};

export default function TriplanioAvatar({ size = 'md' }) {
  const profiles  = useUserProfiles([TRIPLANIO_BOT_USER_ID]);
  const avatarUrl = profiles?.[TRIPLANIO_BOT_USER_ID]?.avatar_url || '';
  const px        = SIZE_PX[size] || SIZE_PX.md;
  const svgPx     = SVG_SIZE[size] || SVG_SIZE.md;
  const baseStyle = { width: px, height: px, borderRadius: '9999px', flex: 'none' };

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt="Triplanio"
        style={{ ...baseStyle, objectFit: 'cover' }}
      />
    );
  }

  return (
    <div
      style={{ ...baseStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--assistant-grad)' }}
      aria-label="Triplanio"
    >
      <svg width={svgPx} height={svgPx} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* antenna */}
        <path d="M24 7V12" stroke="white" strokeWidth="3" strokeLinecap="round" />
        <circle cx="24" cy="6" r="2.6" fill="white" />
        {/* head */}
        <rect x="9" y="13" width="30" height="26" rx="9" fill="white" />
        {/* eyes */}
        <circle cx="18.5" cy="25" r="3" fill="#8b3dff" />
        <circle cx="29.5" cy="25" r="3" fill="#8b3dff" />
        {/* smile */}
        <path d="M19 32 Q24 35.5 29 32" stroke="#8b3dff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      </svg>
    </div>
  );
}
