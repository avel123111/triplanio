// @ts-check
import React, { useRef } from 'react';
import { useSheetDrag } from '@/hooks/useSheetDrag';

// Мобильная оболочка «карта-канвас + свайп-шит» (задача Pavel: Обзор и
// Статистика на телефоне живут тем же паттерном, что планер и редактор).
// Реюз flow-семьи целиком: карта — полной высоты позади шита (камера получает
// нижний padding через useSheetDrag → useMapSurface), шит — три снап-ступени
// (10 / 68 / 100) за грабер. Своей раскладки у компонента нет — только
// композиция готовых классов; контент шита кладёт вызыватель.
//
// map      — слот карты (готовый JSX: MapView / StatsMap с пропсами экрана);
// children — содержимое шита (скролл несёт .lp-b).
export default function MapSheetCanvas({ map, className = '', children }) {
  const hostRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const sheetGrip = useSheetDrag(hostRef);
  return (
    <div ref={hostRef} className={['flow-grid', 'map-sheet', className].filter(Boolean).join(' ')}>
      <div className="flow-mapcol">
        <div className="flow-mapbox">{map}</div>
      </div>
      <div className="flow-editcol">
        <div className="lp">
          <div className="sheet-grip" {...sheetGrip} aria-hidden="true" />
          <div className="lp-b scrollbar-thin">{children}</div>
        </div>
      </div>
    </div>
  );
}
