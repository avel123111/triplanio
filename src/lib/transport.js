import { Plane, Train, Bus, Car, Ship, Footprints, CircleHelp, Navigation } from 'lucide-react';

// Canonical transfer kinds — the single source of truth for how a
// `transfers.transport_type` renders across the whole app. MIRRORS the DB CHECK
// on transfers.transport_type: plane|train|bus|car|taxi|ferry|walk|own_transport|other.
// Each entry carries both icon systems so any screen can consume the same map:
//   • icon     — name for the design <Icon name="…"> system
//   • Icon     — lucide-react component
//   • labelKey — i18n key (event.tk_* namespace, matches the editor selector wording)
// Keep this map in lockstep with the DB CHECK. The n8n "AI Trip Parser" emits the
// booking-relevant subset (no walk / own_transport — those aren't parsed from tickets).
export const TRANSFER_KINDS = {
  plane:         { icon: 'plane', Icon: Plane,      labelKey: 'event.tk_plane' },
  train:         { icon: 'train', Icon: Train,      labelKey: 'event.tk_train' },
  bus:           { icon: 'bus',   Icon: Bus,        labelKey: 'event.tk_bus' },
  car:           { icon: 'car',   Icon: Car,        labelKey: 'event.tk_car' },
  taxi:          { icon: 'car',   Icon: Car,        labelKey: 'event.tk_taxi' },
  ferry:         { icon: 'ferry', Icon: Ship,       labelKey: 'event.tk_ferry' },
  walk:          { icon: 'walk',  Icon: Footprints, labelKey: 'event.tk_walk' },
  own_transport: { icon: 'car',   Icon: Navigation, labelKey: 'event.tk_own_transport' },
  other:         { icon: 'car',   Icon: CircleHelp, labelKey: 'event.tk_other' },
};

// Synonyms that may arrive from AI parsing or legacy data → canonical value.
const TRANSFER_KIND_SYNONYMS = {
  flight: 'plane', air: 'plane', airplane: 'plane',
  rail: 'train', coach: 'bus', shuttle: 'bus', boat: 'ferry', foot: 'walk',
};

// Ordered list of every valid transport_type (DB order).
export const TRANSPORT_TYPES = Object.keys(TRANSFER_KINDS);

// Subset offered in the transfer editor selector (a product choice — no taxi /
// own_transport / other picker; those only reach us via AI parse or legacy data).
export const EDITABLE_TRANSPORT_TYPES = ['plane', 'train', 'bus', 'car', 'ferry', 'walk'];

// Resolve any transport_type (or synonym / unknown) to its canonical meta.
// Fallback = plane (the DB default) so an unknown value never blanks a pill.
export function transferKind(type) {
  return TRANSFER_KINDS[TRANSFER_KIND_SYNONYMS[type] || type] || TRANSFER_KINDS.plane;
}
