/**
 * Compact picker for the icon + color of a custom BudgetCategory.
 * Used inside CategoryNameDialog. Stateless — controlled by parent.
 */
import React from 'react';
import {
  CUSTOM_ICONS, CUSTOM_ICON_KEYS,
  CUSTOM_COLORS, CUSTOM_COLOR_KEYS, CUSTOM_COLOR_DOTS,
} from '@/lib/budget/categoryStyles';
import { useT } from '@/lib/i18n/I18nContext';
import { Check } from 'lucide-react';

export default function IconColorPicker({ icon, color, onIconChange, onColorChange }) {
  const t = useT();

  const PreviewIcon = CUSTOM_ICONS[icon] || CUSTOM_ICONS.folder;
  const previewClass = CUSTOM_COLORS[color] || CUSTOM_COLORS.slate;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${previewClass}`}>
          <PreviewIcon className="w-5 h-5" />
        </div>
        <div className="text-xs text-muted-foreground">{t('budget.icon_color_preview')}</div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
          {t('budget.color_label')}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CUSTOM_COLOR_KEYS.map((c) => {
            const active = c === color;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onColorChange(c)}
                aria-label={c}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition ${CUSTOM_COLOR_DOTS[c]} ${
                  active ? 'ring-2 ring-offset-2 ring-foreground/30 dark:ring-offset-card' : 'hover:scale-110'
                }`}
              >
                {active && <Check className="w-3.5 h-3.5 text-white" />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
          {t('budget.icon_label')}
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {CUSTOM_ICON_KEYS.map((k) => {
            const Cmp = CUSTOM_ICONS[k];
            const active = k === icon;
            return (
              <button
                key={k}
                type="button"
                onClick={() => onIconChange(k)}
                className={`w-9 h-9 rounded-lg flex items-center justify-center transition ${
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:bg-secondary/70 hover:text-foreground'
                }`}
              >
                <Cmp className="w-4 h-4" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}