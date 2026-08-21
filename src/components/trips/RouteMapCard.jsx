// @ts-check
import React from 'react';
import { Btn, Card } from '@/design/index';
import { Icon } from '@/design/icons';
import MapView from '@/components/views/MapView';
import { useI18n } from '@/lib/i18n/I18nContext';
import { useTheme } from '@/lib/ThemeContext';

// Карта-КАНВАС «командного центра» Обзора. Reuses the same Mapbox MapView as
// every other map in the app (no schematic/SVG), with on-map controls off; в
// колонке .ov-col--map растягивается на всю высоту вьюпорта (sticky-панель),
// на мобиле — прежняя фикс-высота. The header "Open" button jumps to the full
// map lens. `active` mirrors whether the Overview lens is visible so MapView
// can resize() when the panel regains size. Выделение остановки двустороннее:
// selectedVisitId/focus приходят из ленты маршрута, клик по пину на карте
// уходит наверх через onCityClick.
export default function RouteMapCard({
  visits = [], transfers = [], active = true, onOpen,
  selectedVisitId = null, focus = null, onCityClick = null,
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const colorScheme = theme === 'dark' ? 'DARK' : 'LIGHT';
  const hasRoute = (visits || []).some((v) => v?.latitude && v?.longitude);

  return (
    <Card radius="lg" pad="none" raised className="ov-mapcard">
      <div className="wdg-h">
        <span className="wi"><Icon name="map" size={17} /></span>
        <h4>{t('overview.map_title')}</h4>
        {/* Была сырая разметка с классами системы (`btn btn--ghost`) — теперь
            сам примитив: тон `ghost` удалён, а класс кнопки собирает <Btn>. */}
        <Btn variant="secondary" className="ov-openbtn" iconRight="chev" onClick={onOpen}>
          {t('overview.open')}
        </Btn>
      </div>

      <div className="ov-maparea">
        {hasRoute ? (
          <MapView
            visits={visits}
            transfers={transfers}
            colorScheme={colorScheme}
            mapControls={false}
            active={active}
            selectedVisitId={selectedVisitId}
            focus={focus}
            onCityClick={onCityClick}
          />
        ) : (
          <div className="ov-map-empty muted">
            <Icon name="map" size={22} />
            <span>{t('overview.map_empty')}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
