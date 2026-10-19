// Arcade "fragile" rule on top of the destruction engine: chunks of registered pieces (plates, mugs, jars...) take
// damage when something heavy touches them fast (relative point velocity), because Rapier's soft contacts spread a
// toppling box's hit over several steps and the engine's impulse model under-reads it.
//   const smash = createSmash({ THREE, minSpeed: 1.6, minMass: 30 });  smash.add(piece);  smash.update(ctx) after world.step
export function createSmash({ THREE, minSpeed = 1.6, minMass = 30, playerSpeed = 6, damage = 9, spread = 1.0, every = 2 } = {}) {
  const list = []; let step = 0; const V = new THREE.Vector3(), W = new THREE.Vector3();
  const pv = (rb, p, out) => {
    const lv = rb.linvel(), av = rb.angvel(), c = rb.worldCom ? rb.worldCom() : rb.translation();
    const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z;
    return out.set(lv.x + av.y * rz - av.z * ry, lv.y + av.z * rx - av.x * rz, lv.z + av.x * ry - av.y * rx);
  };
  return {
    add(piece) { list.push(piece); },
    clear() { list.length = 0; step = 0; },
    count: 0,
    update(ctx) {
      if (++step % every) return;
      const world = ctx.world;
      for (const piece of list) for (const ch of piece.chunks) {
        if (!ch.alive || !ch.collider || !ch.body) continue;
        const own = ch.body.rb; const e = ch.mesh?.matrix.elements; if (!e) continue;
        const p = { x: e[12], y: e[13], z: e[14] };
        world.contactPairsWith(ch.collider, (other) => {
          const ob = other.parent(); if (!ob || ob.handle === own.handle || ob.isFixed()) return;
          if (ob.userData?.piece === piece.name) return;                                  // its own shards
          const isPlayer = !!ob.userData?.player;
          if (!ob.isKinematic() && !isPlayer && ob.mass() < minMass) return;
          const rel = pv(ob, p, V).sub(own.isDynamic() ? pv(own, p, W) : W.set(0, 0, 0)).length();
          if (rel < (isPlayer ? playerSpeed : minSpeed)) return;
          let touching = false; world.contactPair(ch.collider, other, (m) => { if (m.numContacts() > 0) touching = true; }); if (!touching) return;
          const iv = V.clone().normalize().multiplyScalar(Math.min(4, rel) * ch.mass * 0.5);
          ctx.D.damageChunk(ch, damage * rel / minSpeed, iv);
          // the crack spreads: nearby chunks (its neighbours in the stack) take a share, so it shatters, not chips
          ctx.D.damageSphere(new THREE.Vector3(p.x, p.y, p.z), spread, damage * 0.8 * rel / minSpeed, 1.5);
          ctx.fx?.sfx('shatter');
          this.count++;
        });
      }
    },
  };
}
