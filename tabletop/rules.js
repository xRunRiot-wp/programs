// Dungeon rules helpers (PokéRole-style grid play): what blocks movement and sight, which ground is slow,
// how far a mini can go this turn, line of sight and distance in squares.
// A "world" is { onBoard(i, j), tile(i, j), occupied(i, j) } for grid squares i, j.

export const BLOCKS_MOVE = new Set(['wall', 'low', 'thin', 'hedge', 'fence', 'rock', 'tree', 'pit', 'event']);
export const BLOCKS_SIGHT = new Set(['wall', 'thin', 'hedge', 'door', 'tree']);
export const DIFFICULT = new Set(['swamp', 'water', 'river', 'snow']);   // each square costs 2 movement

export const STATUSES = ['Burn', 'Poison', 'Badly Poisoned', 'Paralysis', 'Frozen', 'Sleep', 'Confused', 'Flinch',
  'Infatuated', 'Disabled', 'Immobilized', 'Slowed', 'Sped Up', 'Petrified', 'Cowering', 'Terrified', 'Whiffer',
  'Sure Shot', 'Blinker', 'Cross-Eyed', 'Muzzled', 'Sealed', 'Wrapped', 'Leech Seed', 'Decoy', 'Invisible',
  'Sleepless', 'Perish Song'];

// what the GM rolls every 2 new dungeon tiles (PMD supplement)
export const DUNGEON_EVENTS = ['', 'Trap or Hazard', 'Enemy Team', 'Treasure', 'Guild Challenge', 'Safe Passage', 'Mission Objective (a clue)'];

// the grid squares a piece covers, from its middle (x, z) and size (w x d squares)
export function cellsOf(x, z, w = 1, d = 1) {
  const out = [], i0 = Math.floor(x - w / 2 + 0.01), j0 = Math.floor(z - d / 2 + 0.01);
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([i0 + i, j0 + j]);
  return out;
}

// squares a mini can move to with this much movement. diag: 'one' (diagonals cost 1),
// 'alt' (1, 2, 1, 2...), 'none' (no diagonal steps). Returns Map "x,z" (middle) -> movement spent.
export function reachable(world, sx, sz, w, d, budget, diag = 'one') {
  const ok = (x, z) => cellsOf(x, z, w, d).every(([i, j]) => world.onBoard(i, j) && !BLOCKS_MOVE.has(world.tile(i, j)));
  const cost = (x, z) => (cellsOf(x, z, w, d).some(([i, j]) => DIFFICULT.has(world.tile(i, j))) ? 2 : 1);
  const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (diag !== 'none') steps.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
  const best = new Map([[`${sx},${sz},0`, 0]]), out = new Map([[`${sx},${sz}`, 0]]);
  const queue = [[0, sx, sz, 0]];
  while (queue.length) {
    let m = 0;
    for (let q = 1; q < queue.length; q++) if (queue[q][0] < queue[m][0]) m = q;
    const [c, x, z, par] = queue.splice(m, 1)[0];
    if (c > (best.get(`${x},${z},${par}`) ?? Infinity)) continue;
    for (const [dx, dz] of steps) {
      const nx = x + dx, nz = z + dz, diagonal = dx && dz;
      if (!ok(nx, nz)) continue;
      if (diagonal && (!ok(x + dx, z) || !ok(x, z + dz))) continue;     // no squeezing past corners
      let step = cost(nx, nz), np = par;
      if (diagonal && diag === 'alt') { step += par; np = 1 - par; }
      const nc = c + step;
      if (nc > budget) continue;
      const k = `${nx},${nz},${np}`;
      if (nc >= (best.get(k) ?? Infinity)) continue;
      best.set(k, nc); queue.push([nc, nx, nz, np]);
      if (nc < (out.get(`${nx},${nz}`) ?? Infinity)) out.set(`${nx},${nz}`, nc);
    }
  }
  // you may pass by other minis but not stop on them
  for (const k of [...out.keys()]) {
    const [x, z] = k.split(',').map(Number);
    if ((x !== sx || z !== sz) && cellsOf(x, z, w, d).some(([i, j]) => world.occupied(i, j))) out.delete(k);
  }
  return out;
}

// can a mini at A see B? Walls, thin walls, hedges, doors and trees block the view.
export function lineOfSight(world, ax, az, bx, bz) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) * 8);
  const a = `${Math.floor(ax)},${Math.floor(az)}`, b = `${Math.floor(bx)},${Math.floor(bz)}`;
  for (let s = 1; s < n; s++) {
    const t = s / n, i = Math.floor(ax + (bx - ax) * t), j = Math.floor(az + (bz - az) * t);
    const k = `${i},${j}`;
    if (k === a || k === b) continue;
    if (BLOCKS_SIGHT.has(world.tile(i, j))) return false;
  }
  return true;
}

// squares between two pieces' edges (0 = side by side), counted the same way as movement
export function gap(a, b) {
  const gx = Math.max(0, Math.round(Math.abs(b.x - a.x) - (a.w + b.w) / 2));
  const gz = Math.max(0, Math.round(Math.abs(b.z - a.z) - (a.d + b.d) / 2));
  return { gx, gz };
}
export function distance(a, b, diag = 'one') {
  const { gx, gz } = gap(a, b);
  if (diag === 'none') return gx + gz + 1;
  if (diag === 'alt') { const lo = Math.min(gx, gz); return Math.max(gx, gz) + Math.floor(lo / 2) + 1; }
  return Math.max(gx, gz) + 1;
}
// next to each other (touching sides or corners; with no diagonals, only sides)
export function adjacent(a, b, diag = 'one') {
  const ox = Math.abs(b.x - a.x) - (a.w + b.w) / 2, oz = Math.abs(b.z - a.z) - (a.d + b.d) / 2;
  if (ox > 0.01 || oz > 0.01) return false;
  if (diag === 'none' && ox > -0.01 && oz > -0.01) return false;   // corner to corner
  return true;
}
