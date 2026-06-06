import React from 'react';
import { Icon } from '@/design/icons';
import MapView from '@/components/views/MapView';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';

// Route-map preview for the Overview screen. Reuses the same Mapbox MapView as
// every other map in the app (no schematic/SVG), with on-map controls off, in a
// rounded fixed-height panel. The header "Open" button jumps to the full map
// lens. `active` mirrors whether the Overview lens is visible so MapView can
// resize() when the panel regains size.
export default function RouteMapCard({ visits = [], transfers = [], active = true, onOpen }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const colorScheme = theme === 'dark' ? 'DARK' : 'LIGHT';
  const hasRoute = (visits || []).some((v) => v?.latitude && v?.longitude);

  return (
    <div className="wdg ov-mapcard">
      <div className="wdg-h">
        <span className="wi wi--primary"><Icon name="map" size={17} /></span>
        <h4>{t('overview.map_title')}</h4>
        <button className="btn btn--ghost btn--sm ov-openbtn" onClick={onOpen}>
          {t('overview.open')}
          <Icon name="chev" size={14} />
        </button>
      </div>

      <div className="ov-maparea">
        {hasRoute ? (
          <MapView
            visits={visits}
            transfers={transfers}
            colorScheme={colorScheme}
            mapControls={false}
            active={active}
          />
        ) : (
          <div className="ov-map-empty muted">
            <Icon name="map" size={22} />
            <span>{t('overview.map_empty')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
