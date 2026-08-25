// @ts-check
import React, { useMemo, useState } from 'react';
import { Btn, Card } from '@/design/index';
import { Icon } from '@/design/icons';
import MapView from '@/components/views/MapView';
import { useI18n, useI18nFormat } from '@/lib/i18n/I18nContext';
import { formatDateRange } from '@/lib/trip-dates';
import { useTheme } from '@/lib/ThemeContext';

// Route-map preview for the Overview screen. Reuses the same Mapbox MapView as
// every other map in the app (no schematic/SVG), with on-map controls off, in a
// rounded fixed-height panel. The header "Open" button jumps to the full map
// lens. `active` mirrors whether the Overview lens is visible so MapView can
// resize() when the panel regains size.
//
// Попапы города — как в планировщике: ховер/клик по пину показывают плашку
// «город + даты» (клик — тоггл, клик по пустой карте снимает). Панели у превью
// нет, поэтому это чистый peek — без CTA «открыть» на самой плашке (для полной
// карты есть кнопка «Открыть» в шапке).
export default function RouteMapCard({ visits = [], transfers = [], active = true, onOpen }) {
  const { t } = useI18n();
  const { fmtDate } = useI18nFormat();
  // `isDark`, а не `theme`: последний бывает `system`, и сравнение с 'dark'
  // давало СВЕТЛУЮ карту в тёмной теме ОС — при тёмном интерфейсе вокруг.
  const { isDark } = useTheme();
  const colorScheme = isDark ? 'DARK' : 'LIGHT';
  const hasRoute = (visits || []).some((v) => v?.latitude && v?.longitude);

  const [hoveredId, setHoveredId] = useState(/** @type {any} */ (null));
  const [selectedId, setSelectedId] = useState(/** @type {any} */ (null));
  // Плашка следует за наведением, иначе за выбранным (как в планировщике).
  const badgeId = hoveredId ?? selectedId;
  const cityBadge = useMemo(() => {
    if (badgeId == null) return null;
    const v = (visits || []).find((x) => String(x.id) === String(badgeId));
    if (!v || v.latitude == null || v.longitude == null) return null;
    return {
      lng: v.longitude, lat: v.latitude, countryCode: v.country_code, name: v.city_name,
      dates: formatDateRange(v.start_date, v.end_date, (iso) => fmtDate(iso, undefined, 'd MMM')),
    };
  }, [badgeId, visits, fmtDate]);

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
            hoveredVisitId={hoveredId}
            selectedVisitId={selectedId}
            cityBadge={cityBadge}
            onCityHover={(pts) => setHoveredId(pts ? (pts[0]?.id ?? null) : null)}
            onCityClick={(pts) => { const v = pts?.[0]; if (v) setSelectedId((cur) => (cur === v.id ? null : v.id)); }}
            onMapClick={() => setSelectedId(null)}
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
