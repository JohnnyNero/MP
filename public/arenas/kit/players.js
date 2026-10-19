// Character seam. Arenas never import a character module directly; the runner asks this file.
// Default: the real active-ragdoll character (kit/ragdoll.js wrapping kit/character.js).
// `?character=standin` falls back to the capsule stand-in (kit/standin.js). `?character=<url>` (relative to kit/,
// e.g. ./standin.js) loads any module that exports createPlayers({ THREE, RAPIER, world, scene, hero, SkeletonUtils,
// slots, options }) with the kit player interface (see KIT.md "Characters"). The hero model (blob.glb) is shared.
import { HERO_GLB } from './hero.js';

const NAMED = { standin: './standin.js', ragdoll: './ragdoll.js' };
export async function loadCharacter(url = null) {
  if (url && NAMED[url]) url = NAMED[url];
  // only relative, same-origin module paths: a crafted link must never pull in outside code
  if (url && !/^\.{1,2}\/[\w./-]+\.js$/.test(url)) { console.warn('ignoring character module:', url); url = null; }
  const mod = await import(url || './ragdoll.js');
  if (typeof mod.createPlayers !== 'function') throw new Error('character module has no createPlayers: ' + url);
  return mod.createPlayers;
}
export async function loadHero(GLTFLoader) {
  const buf = Uint8Array.from(atob(HERO_GLB), (c) => c.charCodeAt(0)).buffer;
  return new GLTFLoader().parseAsync(buf, '');
}
