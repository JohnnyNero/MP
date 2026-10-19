// Loose grabbable props (fruit chunks, cannonballs, corks…): simple dynamic bodies the players can pick up and throw.
// Arenas list them in `props: [{ name, shape: 'sphere'|'box'|'cyl', size, mass, pos: [x, y, z] (local), mesh(THREE) -> Object3D }]`.
// Every body is flagged userData.grabbable (the character grabs it) and userData.loose (debris knocks + bots see it).
// The runner owns one set per round: build after the arena, update() before the step (water), sync() after it.
export function createLooseProps(ctx, specs = []) {
  const { THREE, RAPIER, world, scene, frame } = ctx;
  const group = new THREE.Group(); group.name = 'loose-props'; scene.add(group);
  const items = [];
  for (const s of specs) {
    const w = frame.toWorld(...s.pos);
    const rb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(w.x, w.y, w.z).setLinearDamping(0.05).setAngularDamping(0.3).setCcdEnabled(true));
    let cd, vol;
    if (s.shape === 'box') { const [x, y, z] = s.size; cd = RAPIER.ColliderDesc.cuboid(x / 2, y / 2, z / 2); vol = x * y * z; }
    else if (s.shape === 'cyl') { const [r, h] = s.size; cd = RAPIER.ColliderDesc.cylinder(h / 2, r); vol = Math.PI * r * r * h; }
    else { const r = s.size; cd = RAPIER.ColliderDesc.ball(r); vol = 4 / 3 * Math.PI * r ** 3; }
    const col = world.createCollider(cd.setMass(s.mass).setFriction(s.friction ?? 0.7).setRestitution(s.bounce ?? 0.15)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(1e9), rb);
    rb.userData = { grabbable: true, loose: true, mass: s.mass, name: s.name };
    const mesh = s.mesh(THREE); mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(mesh);
    items.push({ spec: s, rb, col, mesh, vol, r: s.shape === 'sphere' ? s.size : Math.max(...[].concat(s.size)) / 2 });
  }
  return {
    items, group,
    bodies: () => items.filter((it) => !it.gone).map((it) => it.rb),
    update(dt) {
      for (const it of items) {
        if (it.gone) continue; const t = it.rb.translation();
        if (t.y < (ctx.arena.surfaces.killY ?? -20) - 25) { world.removeRigidBody(it.rb); group.remove(it.mesh); it.gone = true; continue; }
        if (!ctx.water) continue;
        const sub = Math.max(0, Math.min(1, (ctx.water.height(t.x, t.z) - t.y) / (2 * it.r) + 0.5)); if (sub <= 0) continue;
        const v = it.rb.linvel(), m = it.spec.mass;
        const up = Math.min(1000 * 9.81 * it.vol * 0.9, m * 9.81 * 1.6) * sub;   // light things bob, cannonballs sink slowly
        it.rb.applyImpulse({ x: -v.x * m * 1.2 * sub * dt, y: (up - v.y * m * 1.5 * sub) * dt, z: -v.z * m * 1.2 * sub * dt }, true);
      }
    },
    sync() { for (const it of items) { if (it.gone) continue; const t = it.rb.translation(), q = it.rb.rotation(); it.mesh.position.set(t.x, t.y, t.z); it.mesh.quaternion.set(q.x, q.y, q.z, q.w); } },
    dispose() { scene.remove(group); group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose?.(); } }); },
  };
}
