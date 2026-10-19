// King of the hill: stand on the place's hill (L.HILL) to score seconds. Everyone on top scores; shove them off.
export default {
  id: 'hill', title: 'KING OF THE HILL', hint: 'Get on top and stay there', kind: 'score', time: 15,
  create(api) {
    const H = api.L.HILL, secs = [0, 0, 0, 0], top = api.node('hill');
    api.place.showHill?.(true);
    const on = (p) => { const q = p.position; return !p.isOut && !p.hanging && q.x > H.x0 && q.x < H.x1 && q.z > H.z0 && q.z < H.z1 && q.y > H.y - 0.3; };
    return {
      goal: () => [top.x, top.z, top.y],
      update(dt, t) { if (t < 0) return; for (const p of api.ctx.living()) if (on(p)) secs[p.index] += dt; },
      score: (i) => secs[i],
      scoreText: (i) => `${secs[i].toFixed(1)} s on top`,
      focus: () => [new api.THREE.Vector3(top.x, top.y, top.z)],
      dispose() { api.place.showHill?.(false); },
    };
  },
};
