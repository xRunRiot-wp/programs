// Physics dice: shapes, numbered faces, a throw simulated on the GM's side, and reading the top face.
// The GM's browser runs the throw once and sends the recorded motion, so every player sees the same roll.
import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';

const PHI = (1 + Math.sqrt(5)) / 2;
export const DIE_RADIUS = 0.36;               // board squares from the middle to a corner

// corner points of each die, before scaling
function cornerPoints(sides) {
  const P = [], v = (x, y, z) => P.push(new THREE.Vector3(x, y, z));
  const each = (fn) => { for (const a of [-1, 1]) for (const b of [-1, 1]) fn(a, b); };
  if (sides === 4) { v(1, 1, 1); v(-1, -1, 1); v(-1, 1, -1); v(1, -1, -1); }
  else if (sides === 6) { for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v(x, y, z); }
  else if (sides === 8) { for (const s of [-1, 1]) { v(s, 0, 0); v(0, s, 0); v(0, 0, s); } }
  else if (sides === 12) {
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v(x, y, z);
    each((a, b) => { v(0, a / PHI, b * PHI); v(a / PHI, b * PHI, 0); v(a * PHI, 0, b / PHI); });
  } else if (sides === 20) {
    each((a, b) => { v(0, a, b * PHI); v(a, b * PHI, 0); v(a * PHI, 0, b); });
  } else if (sides === 10) {
    // pentagonal trapezohedron: two tips and a zig-zag ring; the ring height makes each kite flat
    const flat = a => {
      const T = new THREE.Vector3(0, 1, 0), r = i => new THREE.Vector3(Math.cos(i * Math.PI / 5), i % 2 ? -a : a, Math.sin(i * Math.PI / 5));
      const p0 = r(0).sub(T), p1 = r(1).sub(T), p2 = r(2).sub(T);
      return p0.dot(p1.cross(p2));
    };
    let lo = 0.001, hi = 0.9;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; (flat(lo) * flat(m) <= 0) ? (hi = m) : (lo = m); }
    const a = (lo + hi) / 2;
    v(0, 1, 0); v(0, -1, 0);
    for (let i = 0; i < 10; i++) v(Math.cos(i * Math.PI / 5), i % 2 ? -a : a, Math.sin(i * Math.PI / 5));
  }
  const max = Math.max(...P.map(p => p.length()));
  return P.map(p => p.multiplyScalar(1 / max));
}

// faces of the hull, with flat triangles merged back into the die's real faces
function dieFaces(points) {
  const hull = new ConvexHull().setFromPoints(points);
  const groups = [];
  for (const f of hull.faces) {
    const n = f.normal.clone();
    let g = groups.find(x => x.normal.dot(n) > 0.999);
    if (!g) groups.push(g = { normal: n, pts: [] });
    let e = f.edge;
    do {
      const p = e.head().point;
      if (!g.pts.some(q => q.distanceToSquared(p) < 1e-10)) g.pts.push(p.clone());
      e = e.next;
    } while (e !== f.edge);
  }
  for (const g of groups) {                     // corners in order around the face, counter-clockwise from outside
    const m = g.pts.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / g.pts.length);
    const u = g.pts[0].clone().sub(m).normalize(), w = g.normal.clone().cross(u);
    g.pts.sort((p, q) => Math.atan2(p.clone().sub(m).dot(w), p.clone().sub(m).dot(u)) - Math.atan2(q.clone().sub(m).dot(w), q.clone().sub(m).dot(u)));
    // the face's middle by area (on a d10 kite this sits in the wide part, where real dice print the number)
    const c = new THREE.Vector3(); let area = 0;
    for (let i = 1; i < g.pts.length - 1; i++) {
      const a = g.pts[0], b = g.pts[i], d = g.pts[i + 1];
      const t = b.clone().sub(a).cross(d.clone().sub(a)).length() / 2;
      c.add(a.clone().add(b).add(d).multiplyScalar(t / 3)); area += t;
    }
    c.multiplyScalar(1 / area);
    // which way is "up" for the number: a corner for triangles and pentagons, an edge for squares,
    // the pointed tip for d10 kites
    let up;
    if (g.pts.length === 4 && points.length === 12) up = g.pts.reduce((b, p) => (Math.abs(p.y) > Math.abs(b.y) ? p : b)).clone().sub(c);
    else if (g.pts.length === 4) up = g.pts[0].clone().add(g.pts[1]).multiplyScalar(0.5).sub(c);
    else up = g.pts[0].clone().sub(c);
    up.addScaledVector(g.normal, -up.dot(g.normal)).normalize();
    Object.assign(g, { c, up, right: up.clone().cross(g.normal) });
  }
  return groups;
}

function faceValues(sides, faces) {
  // opposite faces add up like real dice (d6: 1-6, 2-5, 3-4); a d10 shows 0-9
  const lo = sides === 10 ? 0 : 1, hi = sides === 10 ? 9 : sides;
  let next = lo;
  for (const f of faces) {
    if (f.value != null) continue;
    f.value = next++;
    const opp = faces.find(g => g !== f && g.value == null && g.normal.dot(f.normal) < -0.999);
    if (opp) opp.value = lo + hi - f.value;
  }
}

function faceTexture(text, color, ink, corners, room) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, S, S);
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  const write = (t, x, y, size, rot) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.font = `bold ${size}px system-ui, sans-serif`;
    g.fillText(t, 0, 0);
    if (t === '6' || t === '9') g.fillRect(-size * 0.22, size * 0.42, size * 0.44, size * 0.08);  // tell 6 from 9
    g.restore();
  };
  if (corners) for (const k of corners) write(k.t, k.x, k.y, 30, k.rot);   // d4: a number at each corner
  else write(text, S / 2, S / 2, Math.min(64, room * (text.length > 1 ? 1.05 : 1.35)), 0);   // room = space to the nearest edge
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

const kits = new Map();
// geometry + faces for one die kind ('d4'...'d20', 'd10t' = the tens die of a d100)
export function dieKit(kind) {
  if (kits.has(kind)) return kits.get(kind);
  const sides = +kind.replace(/\D/g, '');
  const pts = cornerPoints(sides).map(p => p.multiplyScalar(DIE_RADIUS));
  const faces = dieFaces(pts);
  faceValues(sides, faces);
  // d4: numbers belong to corners; the roll is the corner pointing up
  const tips = sides === 4 ? pts.map((p, i) => ({ dir: p.clone().normalize(), value: i + 1, p })) : null;

  const pos = [], nor = [], uv = [], geo = new THREE.BufferGeometry();
  // one scale for every face, so all numbers come out the same size
  const max = Math.max(...faces.flatMap(f => f.pts.map(p => p.clone().sub(f.c).length())));
  faces.forEach((f, fi) => {
    const uvOf = p => { const d = p.clone().sub(f.c); return [0.5 + d.dot(f.right) / max * 0.49, 0.5 + d.dot(f.up) / max * 0.49]; };
    const start = pos.length / 3;
    for (let i = 1; i < f.pts.length - 1; i++) for (const p of [f.pts[0], f.pts[i], f.pts[i + 1]]) {
      pos.push(p.x, p.y, p.z); nor.push(f.normal.x, f.normal.y, f.normal.z); uv.push(...uvOf(p));
    }
    geo.addGroup(start, pos.length / 3 - start, fi);
    f.uvs = f.pts.map(uvOf);
    // distance in texture pixels from the middle to the nearest edge: how big the number may be
    f.room = Math.min(...f.uvs.map((a, i) => {
      const b = f.uvs[(i + 1) % f.uvs.length], ex = b[0] - a[0], ey = b[1] - a[1];
      return Math.abs((0.5 - a[0]) * ey - (0.5 - a[1]) * ex) / Math.hypot(ex, ey);
    })) * 128;
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));

  // the same shape for the physics engine: unique corners + faces as corner lists
  const verts = [], idx = p => {
    let i = verts.findIndex(q => q.distanceToSquared(p) < 1e-10);
    if (i < 0) { verts.push(p); i = verts.length - 1; }
    return i;
  };
  const polys = faces.map(f => f.pts.map(idx));
  const kit = { kind, sides, faces, tips, geo, verts, polys, mats: new Map() };
  kits.set(kind, kit);
  return kit;
}

export function label(kit, value) {
  if (kit.kind === 'd10t') return value === 0 ? '00' : String(value * 10);
  return String(value);
}

export function dieMaterials(kit, color) {
  if (kit.mats.has(color)) return kit.mats.get(color);
  const body = new THREE.Color(color), ink = body.getHSL({}).l > 0.55 ? '#16181d' : '#ffffff';
  const mats = kit.faces.map((f) => {
    let corners = null;
    if (kit.tips) {
      corners = f.pts.map((p, i) => {
        const tip = kit.tips.find(t => t.p.distanceToSquared(p) < 1e-10);
        const [u, v] = f.uvs[i], dx = (u - 0.5), dy = -(v - 0.5);
        return { t: String(tip.value), x: 64 + dx * 128 * 0.62, y: 64 + dy * 128 * 0.62, rot: Math.atan2(dx, -dy) };
      });
    }
    return new THREE.MeshStandardMaterial({ map: faceTexture(label(kit, f.value), color, ink, corners, f.room), roughness: 0.35, metalness: 0.05 });
  });
  kit.mats.set(color, mats);
  return mats;
}

// which number is up for a die resting with this rotation
export function readDie(kit, q) {
  const quat = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
  if (kit.tips) return kit.tips.reduce((b, t) => (t.dir.clone().applyQuaternion(quat).y > b.y ? { y: t.dir.clone().applyQuaternion(quat).y, v: t.value } : b), { y: -9, v: 1 }).v;
  return kit.faces.reduce((b, f) => (f.normal.clone().applyQuaternion(quat).y > b.y ? { y: f.normal.clone().applyQuaternion(quat).y, v: f.value } : b), { y: -9, v: 0 }).v;
}

// Run a throw. kinds: list of die kinds. from/dir: where it's thrown from and which way (board units).
// bounds: the table's edges { x0, x1, z0, z1 }; the dice bounce off them.
// Returns recorded frames (30 per second) of [x,y,z,qx,qy,qz,qw] per die, and each die's number.
export function simulate(CANNON, kinds, { from, dir, bounds, random = Math.random, blocks = [] }) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -38, 0) });
  world.allowSleep = true;
  world.broadphase = new CANNON.NaiveBroadphase();
  world.defaultContactMaterial.friction = 0.25;
  world.defaultContactMaterial.restitution = 0.35;
  const wall = (normal, offset) => {
    const b = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
    // a plane faces +z; turn it to face the given direction
    b.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(...normal));
    b.position.set(-normal[0] * offset, -normal[1] * offset, -normal[2] * offset);
    world.addBody(b);
  };
  wall([0, 1, 0], 0);
  wall([1, 0, 0], -bounds.x0); wall([-1, 0, 0], bounds.x1);
  wall([0, 0, 1], -bounds.z0); wall([0, 0, -1], bounds.z1);
  // minis and walls on the table are solid, so dice bounce off them instead of landing inside (x, z = middle, w x d squares, h tall)
  // a mini (round) = straight sides, so a die settles flat next to it, with a ball on top, so a die rolls off instead of resting up there
  for (const k of blocks) {
    const b = new CANNON.Body({ mass: 0 });
    if (k.round) {
      b.addShape(new CANNON.Box(new CANNON.Vec3(0.42, 0.35, 0.42)), new CANNON.Vec3(0, 0.35, 0));
      b.addShape(new CANNON.Sphere(0.45), new CANNON.Vec3(0, 0.75, 0));
      b.position.set(k.x, 0, k.z);
    } else {
      b.addShape(new CANNON.Box(new CANNON.Vec3(k.w / 2, k.h / 2, k.d / 2)));
      b.position.set(k.x, k.h / 2, k.z);
    }
    world.addBody(b);
  }

  const len = Math.hypot(dir.x, dir.z) || 1, dx = dir.x / len, dz = dir.z / len;
  const bodies = kinds.map((kind, i) => {
    const kit = dieKit(kind);
    const shape = new CANNON.ConvexPolyhedron({ vertices: kit.verts.map(p => new CANNON.Vec3(p.x, p.y, p.z)), faces: kit.polys });
    const b = new CANNON.Body({ mass: 1, shape, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.3, angularDamping: 0.1, linearDamping: 0.05 });
    const side = (i - (kinds.length - 1) / 2) * 0.8;
    b.position.set(
      Math.max(bounds.x0 + 0.5, Math.min(bounds.x1 - 0.5, from.x - dx * 2.5 - dz * side)),
      2.2 + random() * 0.8,
      Math.max(bounds.z0 + 0.5, Math.min(bounds.z1 - 0.5, from.z - dz * 2.5 + dx * side)));
    b.quaternion.setFromEuler(random() * 6.28, random() * 6.28, random() * 6.28);
    const speed = 7 + random() * 4;
    b.velocity.set(dx * speed + (random() - 0.5) * 2, -1 - random() * 2, dz * speed + (random() - 0.5) * 2);
    b.angularVelocity.set((random() - 0.5) * 30, (random() - 0.5) * 30, (random() - 0.5) * 30);
    world.addBody(b);
    return b;
  });

  const frames = [], r = n => Math.round(n * 1000) / 1000;
  for (let step = 0; step < 60 * 7; step++) {
    world.step(1 / 60);
    if (step % 2 === 0) frames.push(bodies.map(b => [r(b.position.x), r(b.position.y), r(b.position.z), r(b.quaternion.x), r(b.quaternion.y), r(b.quaternion.z), r(b.quaternion.w)]));
    if (step > 40 && bodies.every(b => b.sleepState === CANNON.Body.SLEEPING)) break;
  }
  const last = frames[frames.length - 1];
  const values = kinds.map((kind, i) => readDie(dieKit(kind), last[i].slice(3)));
  return { frames, values };
}
