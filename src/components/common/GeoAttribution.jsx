import React from 'react';

// Required attribution for the LocationIQ Free plan (data is OpenStreetMap /
// ODbL). Rendered in the footer of geocoder search dropdowns — the conventional
// "Search by <provider>" placement, shown wherever LocationIQ results appear.
export default function GeoAttribution({ className = '' }) {
  return (
    <div
      className={className}
      style={{ padding: '6px 12px', fontSize: 'var(--fs-micro)', fontWeight: 600, color: 'var(--muted)', borderTop: '1px solid var(--line)' }}
    >
      <a href="https://locationiq.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
        Search by LocationIQ
      </a>
    </div>
  );
}
