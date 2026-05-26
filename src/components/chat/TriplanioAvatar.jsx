import React from 'react';
import { Bot } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserProfiles } from '@/lib/useUserProfiles';
import { TRIPLANIO_BOT_EMAIL } from '@/lib/triplanio';

/**
 * Avatar for the Triplanio AI assistant. Renders the bot's uploaded avatar
 * if available, otherwise falls back to a branded robot icon on a
 * primary-tinted circle.
 *
 * Props:
 *   - size:      'xs' | 'sm' | 'md'  (default 'sm')
 *   - ring:      boolean — adds a soft ring around the avatar
 *   - tripId:    trip context for the avatar lookup (passed to resolveProfiles)
 *   - avatarUrl: optional pre-resolved URL — if provided, skips the lookup.
 *                Pass this when the parent already has the bot profile cached
 *                so multiple avatars don't fire duplicate resolveProfiles
 *                calls (which caused intermittent "blank" renders due to
 *                race conditions between separate React Query subscriptions).
 *   - className: extra classes for the outer element
 */
const SIZE_CLASSES = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
};

const ICON_SIZE = {
  xs: 'w-3 h-3',
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
};

// Internal: only fetches when no pre-resolved avatarUrl was provided.
function useBotAvatar(tripId, providedUrl) {
  const shouldFetch = providedUrl == null;
  const profiles = useUserProfiles(shouldFetch ? [TRIPLANIO_BOT_EMAIL] : [], tripId);
  if (!shouldFetch) return providedUrl;
  return profiles?.[TRIPLANIO_BOT_EMAIL]?.avatar_url || '';
}

export default function TriplanioAvatar({
  size = 'sm',
  ring = false,
  tripId,
  avatarUrl: providedAvatarUrl,
  className = '',
}) {
  const avatarUrl = useBotAvatar(tripId, providedAvatarUrl);

  const sizeCls = SIZE_CLASSES[size] || SIZE_CLASSES.sm;
  const ringCls = ring ? 'ring-2 ring-primary/30' : '';

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt="Triplanio"
        className={cn('rounded-full object-cover shrink-0', sizeCls, ringCls, className)}
      />
    );
  }

  return (
    <div
      className={cn(
        'rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0',
        sizeCls,
        ringCls,
        className,
      )}
      aria-label="Triplanio"
    >
      <Bot className={ICON_SIZE[size] || ICON_SIZE.sm} />
    </div>
  );
}