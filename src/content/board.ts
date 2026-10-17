import type { BoardDef, BoardSpace, SpaceType } from '../core/types';

// The v1 board, drawn in a 480x270 panel. Each segment is a type pattern
// laid out evenly along a polyline. Letters:
//   b blue, r red, d danger, s shop, p repair, t toll, g shortcut gate, f finish

const LETTER: Record<string, SpaceType> = {
  b: 'blue',
  r: 'red',
  d: 'danger',
  s: 'shop',
  p: 'repair',
  t: 'toll',
  g: 'gate',
  f: 'finish',
};

type Pt = [number, number];

/** n points evenly spaced along a polyline, excluding its first point. */
function along(points: Pt[], n: number): Pt[] {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lens.push(l);
    total += l;
  }
  const out: Pt[] = [];
  for (let k = 1; k <= n; k++) {
    let d = (total * k) / n;
    let i = 0;
    while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
    const t = lens[i] === 0 ? 0 : d / lens[i];
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    out.push([Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t)]);
  }
  return out;
}

interface Segment {
  name: string;
  pattern: string;
  path: Pt[];
}

function buildBoard(): BoardDef {
  const spaces: Record<string, BoardSpace> = {};
  const add = (id: string, type: SpaceType, x: number, y: number) => {
    spaces[id] = { id, type, x, y, next: [] };
  };
  const seg = (s: Segment): string[] => {
    const pts = along(s.path, s.pattern.length);
    const ids: string[] = [];
    for (let i = 0; i < s.pattern.length; i++) {
      const id = `${s.name}${i + 1}`;
      add(id, LETTER[s.pattern[i]], pts[i][0], pts[i][1]);
      ids.push(id);
    }
    for (let i = 0; i + 1 < ids.length; i++) spaces[ids[i]].next.push(ids[i + 1]);
    return ids;
  };
  const link = (a: string, b: string) => spaces[a].next.push(b);

  add('S', 'start', 24, 52);
  const A = seg({ name: 'A', pattern: 'bbdbrbsdbb', path: [[24, 52], [240, 52]] });
  // Fork 1: toll route (fast) vs long route.
  const T = seg({ name: 'T', pattern: 'tbdbb', path: [[240, 52], [240, 96], [306, 96]] });
  const L = seg({ name: 'L', pattern: 'bdbrbbpbdbb', path: [[240, 52], [456, 52], [456, 96], [354, 96]] });
  const B = seg({ name: 'B', pattern: 'bdrbbsbdbb', path: [[330, 66], [330, 96], [330, 140], [150, 140]] });
  // Fork 2: normal route vs shortcut gate.
  const N = seg({ name: 'N', pattern: 'bdbrbpdbb', path: [[150, 140], [24, 140], [24, 222], [130, 222]] });
  const SC = seg({ name: 'X', pattern: 'gdbb', path: [[150, 140], [186, 168], [160, 200]] });
  const C = seg({ name: 'C', pattern: 'bdsrbpbdbrbf', path: [[130, 222], [160, 222], [456, 222], [456, 170]] });

  link('S', A[0]);
  link(A[A.length - 1], T[0]);
  link(A[A.length - 1], L[0]);
  link(T[T.length - 1], B[0]);
  link(L[L.length - 1], B[0]);
  link(B[B.length - 1], N[0]);
  link(B[B.length - 1], SC[0]);
  link(N[N.length - 1], C[0]);
  link(SC[SC.length - 1], C[0]);
  // B1 sits between the two fork-1 routes; place it explicitly.
  spaces[B[0]].x = 330;
  spaces[B[0]].y = 96;

  return { spaces, start: 'S', finish: C[C.length - 1] };
}

export const BOARD: BoardDef = buildBoard();

export const STARTING_COINS = 10;
export const BLUE_COINS = 3;
export const RED_COINS = 3;
export const TOLL_COST = 5;
export const GATE_COST = 15;
export const REPAIR_COST = 10;
export const ROUND_CAP = 15;
export const MAX_ITEMS = 3;
export const MAX_PERKS = 2;
export const FIRST_ARRIVAL_BONUS = 2;
