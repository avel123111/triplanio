import React, { useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { Lock, ChevronDown, Clock } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Single addon row on the Trip Settings page.
 *
 * Visual rules (match design):
 *  - Horizontal card: tinted icon + (title + description) on the LEFT,
 *    switch on the RIGHT. PRO badge is absolutely positioned in the
 *    top-right corner of the card.
 *  - Enabled state: thicker primary border + primary-colored title.
 *  - Pro-locked state: card is dimmed; a small Lock sits next to the title;
 *    the switch is still rendered (visibly off + non-interactive). Clicking
 *    anywhere on the card forwards to onProLockedClick.
 *  - When the addon is enabled AND has an `expandableContent`, the toggle
 *    is replaced with a "Settings" button that opens the inline panel.
 */
export default function AddonRow({
  icon: Icon,
  title,
  description,
  enabled,
  onToggle,
  proOnly = false,
  proLocked = false,
  onProLockedClick,
  disabled = false,
  expandableContent = null,
  comingSoon = false,
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const hasExpandable = !!expandableContent && enabled && !proLocked && !comingSoon;

  const handleSwitchWrapperClick = (e) => {
    // When locked, we want every click on the card (including on the disabled
    // switch area) to bubble up to the upgrade flow rather than do nothing.
    if (proLocked) {
      e.preventDefault();
      e.stopPropagation();
      onProLockedClick?.();
    }
  };

  return (
    <div
      className={`relative rounded-xl bg-card overflow-hidden transition ${
        enabled && !proLocked && !comingSoon
          ? 'border-2 border-primary/60'
          : 'border border-border'
      } ${proLocked && !comingSoon ? 'opacity-60 cursor-pointer hover:opacity-75' : ''} ${comingSoon ? 'opacity-60' : ''}`}
      onClick={proLocked && !comingSoon ? onProLockedClick : undefined}
    >
      {/* PRO badge — top-right corner */}
      {proOnly && !comingSoon && (
        <span className="absolute top-0 right-0 inline-flex items-center px-1.5 py-0.5 rounded-bl-md rounded-tr-[10px] text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {t('trip.addon_pro_only')}
        </span>
      )}
      {/* Coming soon badge — overrides the PRO badge if both apply */}
      {comingSoon && (
        <span className="absolute top-0 right-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-bl-md rounded-tr-[10px] text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
          <Clock className="w-2.5 h-2.5" />
          {t('trip.addon_coming_soon')}
        </span>
      )}

      <div className="px-4 py-3 flex items-center gap-3">
        {Icon && (
          <Icon
            className={`w-5 h-5 shrink-0 ${
              enabled && !proLocked ? 'text-primary' : 'text-foreground'
            }`}
          />
        )}
        <div className="flex-1 min-w-0 pr-8">
          <div className="flex items-center gap-1.5">
            <span
              className={`font-semibold text-sm ${
                enabled && !proLocked ? 'text-primary' : ''
              }`}
            >
              {title}
            </span>
            {proLocked && <Lock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{description}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          {hasExpandable ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              {t('trip.addon_settings')}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          ) : (
            <div onClick={handleSwitchWrapperClick}>
              <Switch
                checked={enabled && !comingSoon}
                onCheckedChange={(proLocked || comingSoon) ? undefined : onToggle}
                disabled={disabled || proLocked || comingSoon}
              />
            </div>
          )}
        </div>
      </div>

      {hasExpandable && expanded && (
        <div className="border-t bg-secondary/20 px-4 py-4">
          {/* Built-in: activation switch inside the settings panel */}
          <div className="flex items-center justify-between gap-3 mb-4 pb-4 border-b">
            <div>
              <div className="text-sm font-semibold">{t('trip.addon_activation')}</div>
              <p className="text-xs text-muted-foreground mt-0.5">{t('trip.addon_activation_hint')}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={onToggle} disabled={disabled} />
          </div>
          {expandableContent}
        </div>
      )}
    </div>
  );
}