import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, MAP_STYLE, baseConfig, applyBasemapConfig, fitToPoints } from '@/lib/mapbox';
import { buildRoute, drawTripRoute } from '@/lib/map/captureMap';
import { prewarmRoadGeometry } from '@/lib/map/routeLines';
import { Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

// Interactive live map for the share card (TRIP-193). The user composes the shot
// with native gestures (drag = pan, pinch/scroll = zoom, two-finger / right-drag
// = rotate + tilt/3D) - NO on-screen movement buttons. Only two toggles: theme
// (light/dark, Standard lightPreset) and projection (flat map / globe). The
// parent reads the composed camera via the imperative `getState()` and hands it
// to captureRouteMapBlob so the snapshot mirrors exactly this view.
const ShareMapPreview = forwardRef(function ShareMapPreview({ visits = [], transfers = [], lang, showSE = false }, ref) {
  const { t } = useI18n();
  const holderRef = useRef(null);
  const mapRef = useRef(null);
  const [scheme, setScheme] = useState('DARK');
  const [projection, setProjection] = useState('mercator');

  useEffect(() => {
    if (!MAPBOX_TOKEN || !holderRef.current || mapRef.current) return undefined;
    const { ordered, legs } = buildRoute(visits, transfers, showSE);
    const pts = ordered.map((v) => [v.longitude, v.latitude]);
    const map = new mapboxgl.Map({
      container: holderRef.current,
      style: MAP_STYLE,
      config: baseConfig(scheme),
      ...(lang ? { language: lang } : {}),
      projection,
      center: ordered[0] ? [ordered[0].longitude, ordered[0].latitude] : [0, 20],
      zoom: 2,
      attributionControl: false,
    });
    mapRef.current = map;

    // Auto-fit until the user composes their own view (a resize otherwise fights
    // their pan/zoom).
    let userMoved = false;
    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((e) => map.on(e, () => { userMoved = true; }));
    const fit = () => { if (!userMoved && pts.length) fitToPoints(map, pts, { padding: 40, maxZoom: 9 }); };

    const draw = () => {
      if (!pts.length) return;
      try { drawTripRoute(map, ordered, legs); } catch (err) { console.error('share preview draw failed', err); }
      prewarmRoadGeometry(legs); // warm the shared road cache so the capture gets curves
      fit();
    };
    if (map.isStyleLoaded()) draw(); else map.once('style.load', draw);

    // The dialog animates open, so the container is often mis-sized when the map
    // is created - resize + refit once it settles (until the user takes over).
    const ro = new ResizeObserver(() => { map.resize(); fit(); });
    ro.observe(holderRef.current);

    return () => { ro.disconnect(); map.remove(); mapRef.current = null; };
    // Create once per mount; visits/transfers are stable for an open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose the composed camera + look so the parent can capture the same view.
  useImperativeHandle(ref, () => ({
    getState() {
      const m = mapRef.current;
      if (!m) return null;
      const c = m.getCenter();
      return {
        camera: { center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() },
        scheme,
        projection,
      };
    },
  }), [scheme, projection]);

  function toggleTheme() {
    const next = scheme === 'DARK' ? 'LIGHT' : 'DARK';
    setScheme(next);
    if (mapRef.current) applyBasemapConfig(mapRef.current, next);
  }

  function toggleProjection() {
    const next = projection === 'globe' ? 'mercator' : 'globe';
    setProjection(next);
    if (mapRef.current) {
      try { mapRef.current.setProjection(next); } catch { /* projection unsupported */ }
    }
  }

  const btnStyle = { background: 'var(--surface)', boxShadow: 'var(--shadow-1, 0 1px 4px rgba(0,0,0,.2))' };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={holderRef} style={{ position: 'absolute', inset: 0 }} />
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Btn variant="ghost" size="sm" icon={scheme === 'DARK' ? 'sun' : 'moon'} ariaLabel={t('share.map_theme')} ariaPressed={scheme === 'LIGHT'} onClick={toggleTheme} style={btnStyle} />
        <Btn variant="ghost" size="sm" icon={projection === 'globe' ? 'map' : 'globe'} ariaLabel={t('share.map_projection')} ariaPressed={projection === 'globe'} onClick={toggleProjection} style={btnStyle} />
      </div>
    </div>
  );
});

export default ShareMapPreview;
