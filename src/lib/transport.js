import { Plane, Train, Bus, Car, ShipWheel, Footprints, CircleHelp, Camera, Navigation } from 'lucide-react';

export const TRANSPORT_TYPES = [
  { value: 'plane', label: 'Flight', Icon: Plane },
  { value: 'train', label: 'Train', Icon: Train },
  { value: 'bus', label: 'Bus', Icon: Bus },
  { value: 'car', label: 'Car', Icon: Car },
  { value: 'taxi', label: 'Taxi', Icon: Car },
  { value: 'ferry', label: 'Ferry', Icon: ShipWheel },
  { value: 'walk', label: 'Walk', Icon: Footprints },
  { value: 'own_transport', label: 'Own transport', Icon: Navigation },
  { value: 'other', label: 'Other', Icon: CircleHelp },
];

// Types that DON'T support detailed booking fields / AI (only datetime + notes)
export const SIMPLE_TRANSPORT_TYPES = new Set(['own_transport', 'walk']);

export function transportInfo(type) {
  return TRANSPORT_TYPES.find(t => t.value === type) || TRANSPORT_TYPES.at(-1);
}

export const ACTIVITY_ICON = Camera;