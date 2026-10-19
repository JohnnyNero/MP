// Bot routing over a map's waypoint graph (L.WAYPOINTS + L.LINKS): next-hop tables from every node to every node,
// so a bot anywhere on the map heads for the right next waypoint toward its goal.
//   const R = createRouter(L);  R.route([x, z, y], [x, z, y]) -> [x, z, y];  R.node('hill') -> { x, y, z }
export function createRouter(L) {
  const NODES = L.WAYPOINTS, IDX = new Map(NODES.map((n, k) => [n.id, k]));
  const adj = NODES.map(() => []);
  for (const [a, b, extra] of L.LINKS) { const i = IDX.get(a), j = IDX.get(b), d = Math.hypot(NODES[i].x - NODES[j].x, NODES[i].z - NODES[j].z, NODES[i].y - NODES[j].y) + extra; adj[i].push([j, d]); adj[j].push([i, d]); }
  const NEXT = NODES.map((_, s) => {                      // Dijkstra from every node: the first hop toward each other node
    const dist = NODES.map(() => Infinity), first = NODES.map(() => -1), done = NODES.map(() => false); dist[s] = 0; first[s] = s;
    for (;;) {
      let u = -1; for (let k = 0; k < NODES.length; k++) if (!done[k] && dist[k] < Infinity && (u < 0 || dist[k] < dist[u])) u = k;
      if (u < 0) break; done[u] = true;
      for (const [v, d] of adj[u]) if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; first[v] = u === s ? v : first[u]; }
    }
    return first;
  });
  const nodeNear = (x, z, y) => { let best = 0, bd = Infinity; NODES.forEach((n, k) => { const d = Math.hypot(n.x - x, n.z - z) + 2 * Math.abs(n.y - y); if (d < bd) { bd = d; best = k; } }); return best; };
  function route(from, to) {
    const [fx, fz, fy] = from, [tx, tz, ty] = to;
    if (Math.hypot(tx - fx, tz - fz) < 1.2 && Math.abs(ty - fy) < 0.5) return to;
    const a = nodeNear(fx, fz, fy), b = nodeNear(tx, tz, ty);
    if (a === b) return to;
    const n = NODES[NEXT[a][b]], na = NODES[a];
    // already past the nearest node (between it and the next one): head for the next one
    const toNext = Math.hypot(n.x - fx, n.z - fz), aToNext = Math.hypot(n.x - na.x, n.z - na.z);
    const tgt = toNext < aToNext + 0.3 || Math.hypot(na.x - fx, na.z - fz) < 0.5 ? n : na;
    return [tgt.x, tgt.z, tgt.y];
  }
  return { route, node: (id) => NODES[IDX.get(id)] };
}
