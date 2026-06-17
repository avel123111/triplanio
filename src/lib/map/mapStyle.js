// Shared geometry constants for the route lines on every map surface (trip
// Overview / Map lens / Edit mode / public trip, and the create-flow planner).
//
// Colours are NOT here anymore: the line colour comes from the Lumo design token
// `--map-route` read at draw time (src/lib/map/mapTokens.js → routeColor()), so
// the lines follow the day/night theme. Markers are styled entirely by CSS
// (.tmk* in src/design/app.css). This module owns only the widths/opacity so a
// solid route line and a faded "no transport" dashed line read consistently
// across all maps.

export const SOLID_WIDTH = 3.5;
export const DASHED_WIDTH = 2;
export const DASHED_OPACITY = 0.4; // canonical faded look for "no transport" legs
