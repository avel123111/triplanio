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
