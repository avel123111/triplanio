// Shared trip-menu data — used by the TripView sidebar AND the trip-editor rail
// so the two menus never drift. Pure data + the addon-visibility helper; the
// actual <button> rendering lives in each surface (full sidebar vs icon rail).

export const LENS_ITEMS = [
  { id: 'timeline', labelKey: 'trip_menu.timeline', icon: 'list' },
  { id: 'map', labelKey: 'trip_menu.map', icon: 'map' },
  { id: 'calendar', labelKey: 'trip_menu.calendar', icon: 'calendar' },
  { id: 'budget', labelKey: 'trip.sidebar_budget', icon: 'wallet' },
  { id: 'docs', labelKey: 'trip_menu.documents', icon: 'file' },
  { id: 'chat', labelKey: 'trip_menu.chat', icon: 'chat' },
];

export const MGMT_ITEMS = [
  { id: 'members', labelKey: 'trip.sidebar_members', icon: 'users' },
  { id: 'settings', labelKey: 'nav.settings', icon: 'settings' },
];

// Structure editor — its own route (/trip/:id/edit), shown in the manage group
// only to owner/admin (mirrors who _can_edit_trip lets into the editor).
export const EDIT_ITEM = { id: 'edit', labelKey: 'trip.edit_structure', icon: 'edit' };

// Addon-gated lenses: hidden unless the trip explicitly enabled them.
export const GATED_LENS_ADDON = { calendar: 'calendar', budget: 'budget', chat: 'chat' };

export function isLensVisible(trip, lensId) {
  const key = GATED_LENS_ADDON[lensId];
  if (!key) return true;
  return trip?.details?.addons?.[key] === true;
}

export function canEditStructure(myRole) {
  return myRole === 'owner' || myRole === 'admin';
}
