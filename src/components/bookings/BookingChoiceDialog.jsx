import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Plus, ExternalLink } from 'lucide-react';
import { useT } from '@/lib/i18n/I18nContext';

/**
 * Universal choice dialog: "Add booking manually" vs "Book on an external platform".
 *
 * Props:
 *  - title, description
 *  - manualLabel — label for the "add manually" option
 *  - onManual — invoked when user picks the manual option
 *  - platforms: [{ key, label, url, logo, color }]
 */
export default function BookingChoiceDialog({
  open, onOpenChange,
  title,
  description,
  manualLabel,
  manualHint,
  onManual,
  onPlatformClick,
  platforms = [],
}) {
  const t = useT();
  const resolvedTitle = title || t('view.booking_choice_default_title');
  const resolvedManualLabel = manualLabel || t('view.booking_choice_default_manual');
  const handleManual = () => {
    onOpenChange(false);
    onManual?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{resolvedTitle}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-2 pt-2">
          {/* Manual option */}
          <button
            type="button"
            onClick={handleManual}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition text-left"
          >
            <div className="w-8 h-8 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
              <Plus className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{resolvedManualLabel}</div>
              {manualHint && <div className="text-xs opacity-70 truncate">{manualHint}</div>}
            </div>
          </button>

          {/* OR divider */}
          {platforms.length > 0 && (
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-medium">{t('view.booking_choice_or')}</span>
              <div className="flex-1 h-px bg-border" />
            </div>
          )}

          {/* External platforms */}
          {platforms.map(p => (
            <a
              key={p.key}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              onClick={() => {
                onPlatformClick?.(p);
                onOpenChange(false);
              }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition ${p.color || 'border-border bg-card hover:bg-secondary'}`}
            >
              {p.logo ? (
                <img src={p.logo} alt={p.label} className="w-7 h-7 rounded" />
              ) : (
                <ExternalLink className="w-5 h-5" />
              )}
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-semibold">{p.label}</div>
                {p.hint && <div className="text-xs opacity-70 truncate">{p.hint}</div>}
              </div>
              <ExternalLink className="w-4 h-4 opacity-60" />
            </a>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}