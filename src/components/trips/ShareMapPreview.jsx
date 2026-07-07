import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, MAP_STYLE, baseConfig, applyBasemapConfig, fitToPoints } from '@/lib/mapbox';
import { buildRoute, drawTripRoute } from '@/lib/map/captureMap';
import { prewarmRoadGeometry } from '@/lib/map/routeLines';
import { Btn } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

// Interactive live map for the share card (TRIP-193). The map sits in the card
// frame's "hole" and the frame PNG (server-rendered, transparent where the map
// goes) is laid on top with pointer-events:none, so the map spins behind while
// the frame owns all the framing (rounding/border/shape). The user composes the
// shot with native gestures (drag/pinch/rotate/tilt) - NO movement buttons; only
// theme (light/dark) and projection (flat/globe) toggles. The parent snapshots
// this exact live canvas via captureBlob() (WYSIWYG) - no camera transfer.
//
// slot/cardW/cardH come from the overlay render (source of truth for the hole
// geometry); until they arrive the map fills the whole box.
const ShareMapPreview = forwardRef(function ShareMapPreview(
  { visits = [], transfers = [], lang, showSE = false, overlaySvg, slot, cardW = 1080, cardH = 1920 },
  ref,
) {
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
      preserveDrawingBuffer: true, // so captureBlob() can read the canvas
    });
    mapRef.current = map;

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

    // Keep the route ALIVE across style/config churn. Toggling theme/projection
    // (and Standard's own async style settling) can re-evaluate the style and, in
    // some states, drop our custom source+layers - which is the "route line
    // sometimes shows, sometimes doesn't" flicker, on both the preview and the
    // captured card. On every styledata tick, once the style is ready, redraw if
    // our layers went missing (idempotent: a no-op while they're present).
    const heal = () => { if (pts.length && map.isStyleLoaded() && !map.getSource('sc-solid')) draw(); };
    map.on('styledata', heal);

    // The dialog animates open and the hole box resizes with the overlay load, so
    // resize + refit once it settles (until the user takes over).
    const ro = new ResizeObserver(() => { map.resize(); fit(); });
    ro.observe(holderRef.current);

    return () => { ro.disconnect(); map.off('styledata', heal); map.remove(); mapRef.current = null; };
    // Create once per mount; visits/transfers are stable for an open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    // Snapshot the map EXACTLY as composed (WYSIWYG) - captures this live canvas,
    // no camera transfer to a second instance. Bounded to <=600px wide to keep
    // the server resvg render under the edge limit.
    captureBlob() {
      const m = mapRef.current;
      if (!m) return Promise.resolve(null);
      const grab = () => {
        const src = m.getCanvas();
        const w = Math.min(600, src.width);
        const h = Math.round(src.height * (w / src.width));
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        out.getContext('2d').drawImage(src, 0, 0, w, h);
        return new Promise((res) => out.toBlob((b) => res(b), 'image/png'));
      };
      // Snapshot only once the map has fully settled (tiles + route painted). The
      // canvas is read synchronously, so grabbing mid-render is exactly how the
      // final card ended up with missing / half-drawn route lines - wait for idle.
      if (m.isStyleLoaded() && m.areTilesLoaded?.()) return grab();
      return new Promise((res) => { m.once('idle', () => grab().then(res)); });
    },
  }), []);

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

  const pct = (v, total) => `${(v / total) * 100}%`;
  const holeStyle = slot
    ? { left: pct(slot.x, cardW), top: pct(slot.y, cardH), width: pct(slot.w, cardW), height: pct(slot.h, cardH) }
    : { inset: 0 };
  const btnStyle = { background: 'var(--surface)', boxShadow: 'var(--shadow-1, 0 1px 4px rgba(0,0,0,.2))' };
  // The frame SVG comes from the edge function as markup; render it inline (so it
  // uses the app's loaded fonts) and stretch it to fill the box. Its transparent
  // blob hole reveals the live map behind. pointer-events:none lets gestures pass.
  const frameSvg = overlaySvg
    ? overlaySvg.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block" ')
    : null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={holderRef} style={{ position: 'absolute', overflow: 'hidden', ...holeStyle }} />
      {frameSvg && (
        <div
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: frameSvg }}
        />
      )}
      <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Btn variant="ghost" size="sm" icon={scheme === 'DARK' ? 'sun' : 'moon'} ariaLabel={t('share.map_theme')} ariaPressed={scheme === 'LIGHT'} onClick={toggleTheme} style={btnStyle} />
        <Btn variant="ghost" size="sm" icon={projection === 'globe' ? 'map' : 'globe'} ariaLabel={t('share.map_projection')} ariaPressed={projection === 'globe'} onClick={toggleProjection} style={btnStyle} />
      </div>
    </div>
  );
});

export default ShareMapPreview;
