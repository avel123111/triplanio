import React from 'react';
import { Settings2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useI18nFormat } from '@/lib/i18n/I18nContext';

/**
 * Compact "map settings" strip rendered above the map, under the tabs.
 *
 * Props:
 * - showStartEnd (bool)
 * - onToggleShowStartEnd(next)
 * - mapTheme: 'auto' | 'light' | 'dark'
 * - onMapThemeChange(next)
 */
export default function MapSettingsBar({ showStartEnd, onToggleShowStartEnd, mapTheme = 'auto', onMapThemeChange }) {
  const { t } = useI18nFormat();
  return (
    <div className="mb-3 rounded-xl border bg-card px-3 py-2 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
        <Settings2 className="w-3.5 h-3.5" />
        {t('visit.map_settings')}
      </div>
      <div className="h-4 w-px bg-border hidden sm:block" />
      <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
        <Checkbox
          checked={showStartEnd}
          onCheckedChange={(v) => onToggleShowStartEnd(!!v)}
        />
        <span>{t('visit.map_show_anchors')}</span>
      </label>
      <div className="h-4 w-px bg-border hidden sm:block" />
      <label className="flex items-center gap-2 text-sm select-none">
        <span className="text-muted-foreground">{t('visit.map_theme')}:</span>
        <Select value={mapTheme} onValueChange={(v) => onMapThemeChange?.(v)}>
          <SelectTrigger className="h-7 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t('visit.map_theme_auto')}</SelectItem>
            <SelectItem value="light">{t('visit.map_theme_light')}</SelectItem>
            <SelectItem value="dark">{t('visit.map_theme_dark')}</SelectItem>
          </SelectContent>
        </Select>
      </label>
    </div>
  );
}