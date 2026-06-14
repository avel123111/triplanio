import React from 'react';

// Required attribution for the LocationIQ Free plan (data is OpenStreetMap /
// ODbL). Rendered in the footer of geocoder search dropdowns — the conventional
// "Search by <provider>" placement, shown wherever LocationIQ results appear.
export default function GeoAttribution({ className = '' }) {
  return (
    <div className={`px-3 py-1.5 text-[11px] text-muted-foreground border-t border-border ${className}`}>
      <a
        href="https://locationiq.com"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
      >
        Search by LocationIQ
      </a>
    </div>
  );
}
