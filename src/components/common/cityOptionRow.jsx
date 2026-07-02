import React from 'react';
import { countryFlag } from '@/lib/geo';

/**
 * Canonical city option row for the shared <Autocomplete> dropdown — flag + city
 * name + secondary line. ONE renderer for every city picker (CitySearch, the
 * ManualPlanner create-flow rows, and the EventEditDialog layover/waypoint
 * picker) so the rows can never drift apart again. Used as `renderRow`.
 */
export default function cityOptionRow(c) {
  return (
    <>
      <span className="t-label" style={{ lineHeight: 1, flex: 'none' }}>{countryFlag(c.country_code)}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.city_name}</span>
        <span className="t-meta" style={{ display: 'block', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.display_name || c.country}</span>
      </span>
    </>
  );
}
