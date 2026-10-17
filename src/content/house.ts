import type { HouseDef } from '../core/types';

// An ordinary suburban home: 3 floors x 3 rooms. Floor 0 is the ground.
export const HOUSE: HouseDef = {
  rooms: [
    { id: 'kitchen', name: 'Kitchen', floor: 0, col: 0 },
    { id: 'living', name: 'Living Room', floor: 0, col: 1 },
    { id: 'garage', name: 'Garage', floor: 0, col: 2 },
    { id: 'bedroom', name: 'Bedroom', floor: 1, col: 0 },
    { id: 'bathroom', name: 'Bathroom', floor: 1, col: 1 },
    { id: 'kids', name: "Kids' Room", floor: 1, col: 2 },
    { id: 'attic', name: 'Attic', floor: 2, col: 0 },
    { id: 'study', name: 'Study', floor: 2, col: 1 },
    { id: 'storage', name: 'Storage', floor: 2, col: 2 },
  ],
  connections: [
    { id: 'd-kitchen-living', kind: 'door', a: 'kitchen', b: 'living' },
    { id: 'd-living-garage', kind: 'door', a: 'living', b: 'garage' },
    { id: 'd-bedroom-bathroom', kind: 'door', a: 'bedroom', b: 'bathroom' },
    { id: 'd-bathroom-kids', kind: 'door', a: 'bathroom', b: 'kids' },
    { id: 'd-attic-study', kind: 'door', a: 'attic', b: 'study' },
    { id: 'd-study-storage', kind: 'door', a: 'study', b: 'storage' },
    { id: 's-kitchen-bedroom', kind: 'stairs', a: 'kitchen', b: 'bedroom' },
    { id: 'l-garage-kids', kind: 'ladder', a: 'garage', b: 'kids' },
    { id: 'l-bathroom-study', kind: 'ladder', a: 'bathroom', b: 'study' },
    { id: 'l-kids-storage', kind: 'ladder', a: 'kids', b: 'storage' },
    { id: 'v-living-attic', kind: 'vent', a: 'living', b: 'attic' },
  ],
  boardRoom: 'living',
};

export const ROOM_BY_ID = Object.fromEntries(HOUSE.rooms.map((r) => [r.id, r]));
