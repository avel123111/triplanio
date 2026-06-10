// Single source of truth for every map surface's route + marker styling.
// Mapbox paint expects concrete hex values (not CSS vars), so the brand colour
// is duplicated from the design token here on purpose — change it in ONE place
// and it propagates to the route lines AND the markers on every map (trip
// Overview / Map lens / Edit mode / public trip, and the create-flow planner).
//
// Theme-adaptive (day/night) route colour is a separate, not-yet-done lever (P1).

export const ROUTE_COLOR = '#2167e2'; // brand — solid route lines + markers
export const DASHED_COLOR = '#2167e2'; // "no transport" legs: same hue, faded
export const DASHED_OPACITY = 0.4; // canonical faded-blue dashed look

export const SOLID_WIDTH = 3.5;
export const DASHED_WIDTH = 2;

// Markers share the route colour so a city pin always matches its route line.
export const MARKER_COLOR = ROUTE_COLOR;

// Anchor / waypoint marker colours. Numbered transit pins use MARKER_COLOR; the
// start and finish flags and the waypoint (transit) pin get their own hues so
// the trip's endpoints and layovers read at a glance on every map surface.
export const MARKER_START_COLOR = ROUTE_COLOR; // start flag — brand blue
export const MARKER_END_COLOR = '#E8590C'; // finish flag — contrasting orange
export const MARKER_WAYPOINT_COLOR = ROUTE_COLOR; // layover/transit pin (icon differentiates)
