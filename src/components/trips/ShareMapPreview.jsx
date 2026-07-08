import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, SHARE_MAP_STYLE, baseConfig, applyBasemapConfig, fitToPoints } from '@/lib/mapbox';
import { buildRoute, drawTripRoute } from '@/lib/map/captureMap';
import { prewarmRoadGeometry } from '@/lib/map/routeLines';
import { Btn, Skeleton } from '@/design/index';
import { useI18n } from '@/lib/i18n/I18nContext';

// Interactive live map for the share card (TRIP-193). The map sits in the card
// frame's "hole" and the frame SVG (transparent where the map goes) is laid on
// top with pointer-events:none, so the map spins behind while the frame owns all
// the framing (rounding/border/shape). The user composes the shot with native
// gestures (drag/pinch/rotate/tilt) - NO movement buttons; only theme (light/dark)
// and projection (flat/globe) toggles. getComposition() hands the composed camera
// to renderCardMapPng, which re-renders the map at full card resolution.
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
  // Latest slot/card geometry, read inside the create-once map effect (whose
  // closure would otherwise see only the first render's values).
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const cardWRef = useRef(cardW);
  cardWRef.current = cardW;
  const [scheme, setScheme] = useState('LIGHT');
  const [projection, setProjection] = useState('mercator');
  const [fontTick, setFontTick] = useState(0);

  // The frame SVG carries its fonts as @font-face (embedded data URIs). They load
  // from the data URI ~instantly, but font-display:block hides the text until the
  // face is ready; nudge a repaint once fonts settle so the frame paints with the
  // real glyphs (never a device fallback) - this is what keeps it identical across
  // devices instead of "разъезжается".
  useEffect(() => {
    if (!overlaySvg || !document?.fonts?.ready) return undefined;
    let alive = true;
    document.fonts.ready.then(() => { if (alive) setFontTick((n) => n + 1); });
    return () => { alive = false; };
  }, [overlaySvg]);

  useEffect(() => {
    if (!MAPBOX_TOKEN || !holderRef.current || mapRef.current) return undefined;
    const { ordered, legs } = buildRoute(visits, transfers, showSE);
    const pts = ordered.map((v) => [v.longitude, v.latitude]);
    const map = new mapboxgl.Map({
      container: holderRef.current,
      style: SHARE_MAP_STYLE,
      config: baseConfig(scheme),
      ...(lang ? { language: lang } : {}),
      projection,
      center: ordered[0] ? [ordered[0].longitude, ordered[0].latitude] : [0, 20],
      zoom: 2,
      attributionControl: false,
    });
    mapRef.current = map;

    let userMoved = false;
    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach((e) => map.on(e, () => { userMoved = true; }));
    const fit = () => { if (!userMoved && pts.length) fitToPoints(map, pts, { padding: 40, maxZoom: 9 }); };

    // Draw the route only once the map is FULLY ready to accept sources+layers.
    // On the Mapbox Standard style, 'style.load' (and even isStyleLoaded()===true)
    // can be reached BEFORE the style is ready - addLayer then silently does
    // nothing and the preview route never appears. The main app map avoids this
    // by waiting for 'load'/'idle'; mirror that here. Idempotent: once sc-solid
    // exists we only refit, and 'idle'/'styledata' re-add it if a later style
    // re-eval (theme/projection toggle) drops it.
    // The preview canvas is far smaller than the final card canvas, so the fixed-px
    // markers/lines look proportionally THICKER here than in the rasterised card
    // (TRIP-193). Scale them by (preview css width / card slot width) so preview ==
    // final. Re-applied on every settle so it self-corrects once the slot geometry
    // arrives after the overlay loads (the hole resizes → idle → this runs again).
    const applyWeights = () => {
      const cw = holderRef.current?.clientWidth || 0;
      const sw = slotRef.current?.w || cardWRef.current || 0;
      if (!cw || !sw) return;
      const s = Math.min(1.5, Math.max(0.15, cw / sw));
      if (map.getLayer('sc-points-halo')) map.setPaintProperty('sc-points-halo', 'circle-radius', 9 * s);
      if (map.getLayer('sc-points-dot')) map.setPaintProperty('sc-points-dot', 'circle-radius', 5.5 * s);
      if (map.getLayer('sc-solid')) map.setPaintProperty('sc-solid', 'line-width', 3.5 * s);
      if (map.getLayer('sc-dashed')) map.setPaintProperty('sc-dashed', 'line-width', 2 * s);
    };
    const drawIfNeeded = () => {
      if (!pts.length) return;
      if (map.getSource('sc-solid')) { applyWeights(); fit(); return; }
      try { drawTripRoute(map, ordered, legs); } catch (err) { console.error('share preview draw failed', err); }
      applyWeights();
      prewarmRoadGeometry(legs); // warm the shared road cache so the capture gets curves
      fit();
    };
    map.once('load', drawIfNeeded);
    map.on('idle', drawIfNeeded);
    map.on('styledata', drawIfNeeded);

    // The dialog animates open and the hole box resizes with the overlay load, so
    // resize + refit once it settles (until the user takes over).
    const ro = new ResizeObserver(() => { map.resize(); fit(); });
    ro.observe(holderRef.current);

    return () => {
      ro.disconnect();
      map.off('idle', drawIfNeeded);
      map.off('styledata', drawIfNeeded);
      map.remove();
      mapRef.current = null;
    };
    // Create once per mount; visits/transfers are stable for an open dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    // Camera + theme the user composed, so the final card can re-render the route
    // map at full card resolution with the SAME framing (see renderCardMapPng).
    getComposition() {
      const m = mapRef.current;
      if (!m) return null;
      const c = m.getCenter();
      return {
        center: [c.lng, c.lat],
        zoom: m.getZoom(),
        bearing: m.getBearing(),
        pitch: m.getPitch(),
        projection,
        scheme,
        previewCssWidth: m.getContainer()?.clientWidth || 0,
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
          key={`frame-${fontTick}`}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: frameSvg }}
        />
      )}
      {/* Until the frame SVG arrives the map would sit BARE in the box; cover it
          with a loader so the user never sees a frameless map (TRIP-193). */}
      {!frameSvg && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <Skeleton w="100%" h="100%" r={0} />
        </div>
      )}
      {frameSvg && (
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Btn variant="ghost" size="sm" icon={scheme === 'DARK' ? 'sun' : 'moon'} ariaLabel={t('share.map_theme')} ariaPressed={scheme === 'LIGHT'} onClick={toggleTheme} style={btnStyle} />
          <Btn variant="ghost" size="sm" icon={projection === 'globe' ? 'map' : 'globe'} ariaLabel={t('share.map_projection')} ariaPressed={projection === 'globe'} onClick={toggleProjection} style={btnStyle} />
        </div>
      )}
    </div>
  );
});

export default ShareMapPreview;
