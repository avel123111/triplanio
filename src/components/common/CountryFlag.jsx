import React from 'react';

/**
 * CountryFlag — THE single source for rendering a country flag in the UI.
 * Renders the SVG from /public/flags/<iso2>.svg (ISO 3166-1 alpha-2, lowercase
 * filenames) instead of a Unicode emoji flag, so flags look identical on every
 * platform/browser. Replaces the old `countryFlag()` / `flagEmoji()` emoji
 * helpers wherever a flag is actually drawn.
 *
 * Sizing is font-relative: height = 1em (see `.cflag` in app.css), so the flag
 * scales with whatever text style it sits next to — no per-call-site px.
 *
 * Renders nothing when the code is missing or isn't a 2-letter code (no 🌍
 * fallback, no broken-image icon); a valid-but-missing file is hidden onError.
 */
export default function CountryFlag({ code, className = '', style }) {
  const cc = typeof code === 'string' && code.trim().length === 2 ? code.trim().toLowerCase() : '';
  if (!cc) return null;
  return (
    <img
      src={`/flags/${cc}.svg`}
      alt=""
      aria-hidden="true"
      loading="lazy"
      className={`cflag${className ? ` ${className}` : ''}`}
      style={style}
      onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
    />
  );
}
