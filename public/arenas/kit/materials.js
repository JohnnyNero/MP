// Destruction material table, shared by the bake scripts and the runtime (kit copy).
// Units: density kg/m^3, health in damage points, bondStrength in N per m^2 of
// contact area (a game value, not real-world), impactForce in N (contact force
// above which a chunk starts taking damage), fatigue = how fast quakes wear bonds.
// The first six are the engine originals (ship); the rest are kitchen "toy physics" materials:
// light enough that toy-sized players and fruit can shove them, fragile where it reads (ceramic, glass).
export const MATERIALS = {
  wood:    { density: 600,  health: 60,  bondStrength: 4.0e5, impactForce: 4.5e4, fatigue: 1.0, color: 0xa87a4f, inner: 0xd9b48a, roughness: 0.85, metalness: 0.0 },
  crate:   { density: 110,  health: 45,  bondStrength: 3.0e5, impactForce: 3.0e4, fatigue: 1.0, color: 0xa87a4f, inner: 0xd9b48a, roughness: 0.85, metalness: 0.0 },   // hollow cargo (ship crates/barrels): light enough to throw
  stone:   { density: 2200, health: 110, bondStrength: 1.5e6, impactForce: 1.2e5, fatigue: 0.8, color: 0x9b958c, inner: 0xc9c2b4, roughness: 0.95, metalness: 0.0 },
  glass:   { density: 2500, health: 12,  bondStrength: 3.0e5, impactForce: 1.5e3, fatigue: 0.6, color: 0x9fd6ee, inner: 0xe6f7ff, roughness: 0.08, metalness: 0.1, opacity: 0.55 },
  metal:   { density: 7800, health: 260, bondStrength: 3.0e6, impactForce: 4.0e5, fatigue: 0.35, color: 0x6e7a86, inner: 0xb8c2cc, roughness: 0.45, metalness: 0.7 },
  ceramic: { density: 2300, health: 10,  bondStrength: 4.0e4, impactForce: 1.5e3, fatigue: 0.5, color: 0xf2efe6, inner: 0xd8cfc0, roughness: 0.35, metalness: 0.0 },
  hull:    { density: 900,  health: 140, bondStrength: 8.0e5, impactForce: 1.5e5, fatigue: 0.7, color: 0x5c3d2e, inner: 0x9a6b4b, roughness: 0.8, metalness: 0.05 },
  // kitchen: cardboard boxes (break into big chunks), porcelain plates + mug (shatter), jars (glass, shatter)
  card_red:    { density: 60, health: 34, bondStrength: 1.2e5, impactForce: 2.6e4, fatigue: 1.0, color: 0xe2553f, inner: 0xc9a46c, roughness: 0.8, metalness: 0.0 },
  card_yellow: { density: 60, health: 34, bondStrength: 1.2e5, impactForce: 2.6e4, fatigue: 1.0, color: 0xf4c442, inner: 0xc9a46c, roughness: 0.8, metalness: 0.0 },
  card_blue:   { density: 60, health: 34, bondStrength: 1.2e5, impactForce: 2.6e4, fatigue: 1.0, color: 0x4f8fd6, inner: 0xc9a46c, roughness: 0.8, metalness: 0.0 },
  card_green:  { density: 60, health: 34, bondStrength: 1.2e5, impactForce: 2.6e4, fatigue: 1.0, color: 0x5fb36a, inner: 0xc9a46c, roughness: 0.8, metalness: 0.0 },
  card_cream:  { density: 60, health: 34, bondStrength: 1.2e5, impactForce: 2.6e4, fatigue: 1.0, color: 0xf6e7c8, inner: 0xc9a46c, roughness: 0.8, metalness: 0.0 },
  porcelain:   { density: 160, health: 6, bondStrength: 2.4e4, impactForce: 1.5e3, fatigue: 0.5, color: 0xfaf6ee, inner: 0xe6dccb, roughness: 0.3, metalness: 0.0 },
  porcelain_blue: { density: 160, health: 6, bondStrength: 2.4e4, impactForce: 1.5e3, fatigue: 0.5, color: 0x78aee0, inner: 0xe6dccb, roughness: 0.3, metalness: 0.0 },
  mug_red:     { density: 160, health: 6, bondStrength: 2.4e4, impactForce: 1.5e3, fatigue: 0.5, color: 0xe8665a, inner: 0xf3e6d6, roughness: 0.3, metalness: 0.0 },
  cocoa:       { density: 160, health: 6, bondStrength: 2.4e4, impactForce: 1.5e3, fatigue: 0.5, color: 0x6b3f2a, inner: 0x8a5a3c, roughness: 0.2, metalness: 0.0 },
  jar_jam:     { density: 170, health: 5, bondStrength: 2.0e4, impactForce: 2.2e3, fatigue: 0.6, color: 0xd8455a, inner: 0xffc2cc, roughness: 0.12, metalness: 0.05, opacity: 0.82 },
  jar_honey:   { density: 170, health: 5, bondStrength: 2.0e4, impactForce: 2.2e3, fatigue: 0.6, color: 0xf0a830, inner: 0xffe2a0, roughness: 0.12, metalness: 0.05, opacity: 0.82 },
  jar_lid:     { density: 170, health: 30, bondStrength: 2.5e4, impactForce: 2.0e4, fatigue: 0.6, color: 0xd9dfe6, inner: 0xb0b8c0, roughness: 0.35, metalness: 0.6 },
  enamel:      { density: 260, health: 150, bondStrength: 6.0e5, impactForce: 3.0e5, fatigue: 0.4, color: 0x8fd3c1, inner: 0xc9d2d8, roughness: 0.3, metalness: 0.25 },
  chrome:      { density: 260, health: 150, bondStrength: 6.0e5, impactForce: 3.0e5, fatigue: 0.4, color: 0xe4e9ee, inner: 0xb8c2cc, roughness: 0.25, metalness: 0.8 },
};
