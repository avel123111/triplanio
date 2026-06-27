import React from 'react';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { TRIPLANIO_BOT_USER_ID } from '@/lib/triplanio';

/**
 * Avatar for the Triplanio AI assistant. Renders the bot's uploaded avatar
 * if available, otherwise falls back to a branded robot SVG on a gradient circle.
 *
 * Props:
 *   - size:      'xs' | 'sm' | 'md'  (default 'sm')
 *   - ring:      boolean - adds a soft ring
 *   - tripId:    trip context for the avatar lookup
 *   - avatarUrl: optional pre-resolved URL - skips the lookup
 *   - className: extra classes for the outer element
 */
// px sizes (were Tailwind w-5/w-7/w-9 = 20/28/36px)
const SIZE_PX = {
  xs: 20,
  sm: 28,
  md: 36,
};

const SVG_SIZE = {
  xs: 14,
  sm: 18,
  md: 22,
};

function useBotAvatar(tripId, providedUrl) {
  const shouldFetch = providedUrl == null;
  const profiles = useUserProfiles(shouldFetch ? [TRIPLANIO_BOT_USER_ID] : [], tripId);
  if (!shouldFetch) return providedUrl;
  return profiles?.[TRIPLANIO_BOT_USER_ID]?.avatar_url || '';
}

export default function TriplanioAvatar({
  size = 'sm',
  ring = false,
  tripId,
  avatarUrl: providedAvatarUrl,
  className = '',
}) {
  const avatarUrl = useBotAvatar(tripId, providedAvatarUrl);
  const px        = SIZE_PX[size] || SIZE_PX.sm;
  const svgPx     = SVG_SIZE[size] || SVG_SIZE.sm;
  // ring-2 ring-primary/30 → 2px soft primary ring via box-shadow
  const ringStyle = ring ? { boxShadow: '0 0 0 2px var(--primary-ring)' } : null;
  const baseStyle = { width: px, height: px, borderRadius: '9999px', flex: 'none' };

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt="Triplanio"
        className={className}
        style={{ ...baseStyle, objectFit: 'cover', ...ringStyle }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{ ...baseStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--assistant-grad)', ...ringStyle }}
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
