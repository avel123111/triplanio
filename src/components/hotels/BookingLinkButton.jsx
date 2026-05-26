import React from 'react';
import { ExternalLink } from 'lucide-react';
import { BOOKING_PLATFORMS, platformLogoUrl, normalizeExternalUrl } from '@/lib/booking-platforms';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Small button that links to a booking URL with the platform's logo + label.
 * Returns null if no URL is present.
 */
export default function BookingLinkButton({ url, platform, size = 'sm', variant = 'outline', className = '' }) {
  const t = useT();
  const href = normalizeExternalUrl(url);
  if (!href) return null;
  const info = platform ? BOOKING_PLATFORMS[platform] : null;
  const logo = platformLogoUrl(platform, href);

  const sizing = size === 'xs'
    ? 'h-7 px-2 text-xs gap-1.5'
    : 'h-9 px-3 text-sm gap-2';

  const variantCls = variant === 'ghost'
    ? 'hover:bg-secondary text-foreground'
    : 'border border-input bg-card hover:bg-secondary text-foreground';

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={e => e.stopPropagation()}
      className={`inline-flex items-center rounded-md font-medium transition shrink-0 ${sizing} ${variantCls} ${className}`}
    >
      {logo ? (
        <img src={logo} alt="" className="w-4 h-4 rounded-sm" />
      ) : (
        <ExternalLink className="w-3.5 h-3.5" />
      )}
      <span className="truncate">
        {t('hotel.book_link_label')}
        {info && platform !== 'other' ? ` · ${info.label}` : ''}
      </span>
    </a>
  );
}