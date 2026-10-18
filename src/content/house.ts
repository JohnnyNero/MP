import type { HouseDef, RoomDef } from '../core/types';

// A fixed, hand-made house on the procedural grid (6 x 4, row 0 at the top).
// Used as a test fixture and as the generator's last-resort fallback.
const room = (id: string, name: string, gx: number, gy: number, gw: number, color: number): RoomDef => ({
  id, name, gx, gy, gw, gh: 1, col: gx, floor: 3 - gy, theme: id, color,
});

export const HOUSE: HouseDef = {
  cols: 6,
  rows: 4,
  rooms: [
    room('attic', 'Attic', 1, 0, 2, 0x7a6a52),
    room('study', 'Study', 3, 0, 2, 0x2f6a5a),
    room('bedroom', 'Bedroom', 0, 1, 2, 0xa8507a),
    room('bathroom', 'Bathroom', 2, 1, 2, 0x3a6a9a),
    room('nursery', 'Nursery', 4, 1, 2, 0x7aa0b8),
    room('kitchen', 'Kitchen', 0, 2, 2, 0xb8682a),
    room('living', 'Living Room', 2, 2, 2, 0x5a48a0),
    room('garage', 'Garage', 4, 2, 2, 0x5a5a64),
    room('cellar', 'Cellar', 0, 3, 3, 0x3a3028),
    room('boiler', 'Boiler Room', 3, 3, 3, 0x5a3a2a),
  ],
  connections: [
    { id: 'd-attic-study', kind: 'door', a: 'attic', b: 'study', wallX: 3, row: 0 },
    { id: 'd-bedroom-bathroom', kind: 'door', a: 'bedroom', b: 'bathroom', wallX: 2, row: 1 },
    { id: 'd-bathroom-nursery', kind: 'door', a: 'bathroom', b: 'nursery', wallX: 4, row: 1 },
    { id: 'd-kitchen-living', kind: 'door', a: 'kitchen', b: 'living', wallX: 2, row: 2 },
    { id: 'd-living-garage', kind: 'door', a: 'living', b: 'garage', wallX: 4, row: 2 },
    { id: 'd-cellar-boiler', kind: 'door', a: 'cellar', b: 'boiler', wallX: 3, row: 3 },
    { id: 's-kitchen-bedroom', kind: 'stairs', a: 'kitchen', b: 'bedroom', colX: 0, frac: 0.5 },
    { id: 's-cellar-kitchen', kind: 'stairs', a: 'cellar', b: 'kitchen', colX: 1, frac: 0.5 },
    { id: 'l-boiler-garage', kind: 'ladder', a: 'boiler', b: 'garage', colX: 4, frac: 0.5 },
    { id: 'l-garage-nursery', kind: 'ladder', a: 'garage', b: 'nursery', colX: 5, frac: 0.5 },
    { id: 'l-bathroom-attic', kind: 'ladder', a: 'bathroom', b: 'attic', colX: 2, frac: 0.5 },
    { id: 'l-bathroom-study', kind: 'ladder', a: 'bathroom', b: 'study', colX: 3, frac: 0.5 },
    // One-way laundry chute: bedroom hatch down to the kitchen (a = lower end).
    { id: 'c-bedroom-kitchen', kind: 'chute', a: 'kitchen', b: 'bedroom', colX: 1, frac: 0.5 },
    { id: 'p-attic-boiler', kind: 'portal', a: 'attic', b: 'boiler', fracA: 0.3, fracB: 0.7 },
  ],
  props: [{ id: 'sw-living', kind: 'switch', room: 'living', frac: 0.2 }],
  boardRoom: 'living',
  features: ['chute', 'portal', 'switch'],
  name: 'The Ordinary House',
  seed: 0,
  goofiness: 0,
  gaps: ['0,0', '5,0'],
};
