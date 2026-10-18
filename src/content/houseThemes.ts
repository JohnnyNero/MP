import type { ConnectionKind, Goofiness, PropKind } from '../core/types';

// Room themes for procedural houses. `key` is stable (art + room ids),
// `level` is the goofiness a house needs before the theme can appear.
export interface ThemeDef {
  key: string;
  name: string;
  color: number;
  level: Goofiness;
}

export const THEMES: ThemeDef[] = [
  // 0 = Sensible
  { key: 'kitchen', name: 'Kitchen', color: 0xb8682a, level: 0 },
  { key: 'bathroom', name: 'Bathroom', color: 0x3a6a9a, level: 0 },
  { key: 'bedroom', name: 'Bedroom', color: 0xa8507a, level: 0 },
  { key: 'living', name: 'Living Room', color: 0x5a48a0, level: 0 },
  { key: 'pantry', name: 'Pantry', color: 0x8a6a3a, level: 0 },
  { key: 'study', name: 'Study', color: 0x2f6a5a, level: 0 },
  { key: 'garage', name: 'Garage', color: 0x5a5a64, level: 0 },
  { key: 'laundry', name: 'Laundry', color: 0x3a3a52, level: 0 },
  { key: 'dining', name: 'Dining Room', color: 0x8a3a3a, level: 0 },
  { key: 'hallway', name: 'Hallway', color: 0x6a5a4a, level: 0 },
  { key: 'nursery', name: 'Nursery', color: 0x7aa0b8, level: 0 },
  { key: 'library', name: 'Library', color: 0x5a3a22, level: 0 },
  { key: 'attic', name: 'Attic', color: 0x7a6a52, level: 0 },
  { key: 'cellar', name: 'Cellar', color: 0x3a3028, level: 0 },
  { key: 'workshop', name: 'Workshop', color: 0x6a4a2a, level: 0 },
  { key: 'guest', name: 'Guest Room', color: 0x8a5a8a, level: 0 },
  { key: 'playroom', name: 'Playroom', color: 0xb85a5a, level: 0 },
  { key: 'music', name: 'Music Room', color: 0x4a5a8a, level: 0 },
  { key: 'office', name: 'Office', color: 0x4a6a6a, level: 0 },
  { key: 'sunroom', name: 'Sunroom', color: 0xb8a03a, level: 0 },
  { key: 'mudroom', name: 'Mudroom', color: 0x5a4a32, level: 0 },
  { key: 'den', name: 'Den', color: 0x6a3a5a, level: 0 },
  { key: 'boiler', name: 'Boiler Room', color: 0x5a3a2a, level: 0 },
  { key: 'gamesroom', name: 'Games Room', color: 0x2a5a3a, level: 0 },
  // 1 = Silly
  { key: 'ballpit', name: 'Ball Pit', color: 0xc84a8a, level: 1 },
  { key: 'bouncycastle', name: 'Bouncy Castle', color: 0xe0a030, level: 1 },
  { key: 'knitting', name: "Grandma's Knitting Room", color: 0x9a5a7a, level: 1 },
  { key: 'aquarium', name: 'Aquarium Lounge', color: 0x2a7aa0, level: 1 },
  { key: 'trophy', name: 'Trophy Hall', color: 0xa8862a, level: 1 },
  { key: 'catroom', name: 'Cat Room', color: 0x7a5a9a, level: 1 },
  { key: 'disco', name: 'Disco Basement', color: 0x8a2aa8, level: 1 },
  { key: 'greenhouse', name: 'Indoor Greenhouse', color: 0x3a8a3a, level: 1 },
  { key: 'arcade', name: 'Arcade Nook', color: 0x3a2a8a, level: 1 },
  { key: 'karaoke', name: 'Karaoke Closet', color: 0xc83a6a, level: 1 },
  { key: 'hatroom', name: 'Hat Room', color: 0x8a6a2a, level: 1 },
  { key: 'snackvault', name: 'Snack Vault', color: 0xa85a2a, level: 1 },
  // 2 = Nonsense
  { key: 'sockdrawer', name: 'Sock Drawer (room-sized)', color: 0x6a7aa8, level: 2 },
  { key: 'upsidedown', name: 'Upside-Down Parlour', color: 0x4a3a8a, level: 2 },
  { key: 'hallofdoors', name: 'Hall of Doors', color: 0x7a3a3a, level: 2 },
  { key: 'wardrobe', name: 'Room Inside a Wardrobe', color: 0x5a3a2a, level: 2 },
  { key: 'giantfridge', name: 'Giant Fridge', color: 0xa0c0d8, level: 2 },
  { key: 'bathtubboat', name: 'Bathtub Boat Room', color: 0x3a8ab8, level: 2 },
  { key: 'pianostairs', name: 'Piano Stairwell', color: 0x2a2a3a, level: 2 },
  { key: 'pillowfort', name: 'Pillow Fort', color: 0xc8a8d8, level: 2 },
  { key: 'clockinside', name: 'Inside the Clock', color: 0x8a7a3a, level: 2 },
  { key: 'jellyroom', name: 'Jelly Room', color: 0xc84a4a, level: 2 },
  { key: 'tinyroom', name: 'Very Small Room', color: 0x5a8a7a, level: 2 },
  { key: 'moonroom', name: 'Room on the Moon', color: 0x5a6a7a, level: 2 },
];

export const THEME_BY_KEY: Record<string, ThemeDef> = Object.fromEntries(THEMES.map((t) => [t.key, t]));

/** Signature features shown to players. */
export type FeatureId = 'portal' | 'tramp' | 'chute' | 'pole' | 'slide' | 'lift' | 'bookcase' | 'switch' | 'trapdoor';

export const FEATURES: Record<FeatureId, { name: string; color: number; kind: ConnectionKind | PropKind }> = {
  portal: { name: 'Portal paintings', color: 0xc060ff, kind: 'portal' },
  tramp: { name: 'Trampoline bed', color: 0xff7aa0, kind: 'tramp' },
  chute: { name: 'Laundry chute', color: 0x7a8aa8, kind: 'chute' },
  pole: { name: "Fireman's pole", color: 0xe0e0f0, kind: 'pole' },
  slide: { name: 'Banister slide', color: 0xffb040, kind: 'slide' },
  lift: { name: 'Dumbwaiter', color: 0x8ad0ff, kind: 'lift' },
  bookcase: { name: 'Revolving bookcase', color: 0xc89a5a, kind: 'bookcase' },
  switch: { name: 'Light switch', color: 0xffe060, kind: 'switch' },
  trapdoor: { name: 'Trapdoor rug', color: 0xe05050, kind: 'trapdoor' },
};

export const HOUSE_NAMES_1 = ['The Wobbly', 'The Crooked', 'The Upside', 'The Leaning', 'The Squeaky', 'The Mostly', 'The Suspicious', 'The Bouncy'];
export const HOUSE_NAMES_2 = ['Manor', 'Bungalow', 'Townhouse', 'Mansion', 'Cottage', 'Villa', 'Semi-Detached', 'Homestead'];
