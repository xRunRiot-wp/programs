// Tabletop: a shared 2D board with 3D minis.
// The GM's browser is the host: it holds the game and checks every change.
// Players connect to it with PeerJS (browser-to-browser), so no server is needed.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const $ = id => document.getElementById(id);
const PREFIX = 'tabletop-v1-';                 // keeps our room ids apart from other PeerJS users
const PALETTE = ['#e0a64b', '#4b9be0', '#d9534f', '#5cb85c', '#a66be0', '#e07a4b', '#4be0c8', '#e04b9b'];
const SIZE_CELLS = { '0.7': 1, '1': 1, '2': 2, '3': 3 };

// ---------- small helpers ----------
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
const rollDie = sides => 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % sides);
const clean = (s, n = 24) => String(s ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n);
// big things (map picture, 3D models) live in IndexedDB; localStorage is too small for them
const blobs = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, bad) => {
    const r = indexedDB.open('tabletop', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('b');
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  }));
  const run = (mode, fn) => db().then(d => new Promise((ok, bad) => {
    const t = d.transaction('b', mode), r = fn(t.objectStore('b'));
    t.oncomplete = () => ok(r.result); t.onerror = () => bad(t.error);
  })).catch(() => null);
  return { get: k => run('readonly', s => s.get(k)), set: (k, v) => run('readwrite', s => s.put(v, k)) };
})();
const MAX_MODEL = 15 * 1024 * 1024;
const modelData = new Map();                    // model id -> .glb bytes (ArrayBuffer)
const okColor = c => /^#[0-9a-f]{6}$/i.test(c) ? c : '#888888';

let clientId = store.get('tabletop.clientId');
if (!clientId) { clientId = rid(12); store.set('tabletop.clientId', clientId); }

// ---------- game state (the host's copy is the real one) ----------
let isHost = false, myName = '', roomCode = '', hostId = '';
let state = freshState();
function freshState() {
  return { board: { cols: 20, rows: 14, grid: true }, map: null, figures: {}, players: {}, log: [], gm: '', models: {} };
}

// =====================================================================
// Networking
// =====================================================================
let peer = null, hostConn = null;
const conns = new Map();                       // host only: peerId -> { conn, clientId }

async function startHost(name) {
  isHost = true; myName = name;
  const saved = store.get('tabletop.host');
  roomCode = saved?.code || rid(6);
  if (saved?.state) {
    state = Object.assign(freshState(), saved.state);
    state.map = (await blobs.get('map')) || saved.state.map || null;
    for (const id of Object.keys(state.models)) {
      const data = await blobs.get('model:' + id);
      if (data) modelData.set(id, data); else delete state.models[id];
    }
    for (const f of Object.values(state.figures)) if (f.model && !modelData.has(f.model)) f.model = '';
  }
  state.gm = clientId;
  state.players[clientId] = { name, color: state.players[clientId]?.color || PALETTE[0], online: true, gm: true };
  openPeer(PREFIX + roomCode, 0);
}

function openPeer(id, tries) {
  peer = new Peer(id);
  peer.on('open', () => {
    hostId = id;
    enterGame();
    addLog({ kind: 'sys', text: `Game open. Room code ${roomCode}.` });
  });
  peer.on('connection', conn => {
    conn.on('data', msg => onHostData(conn, msg));
    conn.on('close', () => dropConn(conn));
    conn.on('error', () => dropConn(conn));
  });
  peer.on('error', err => {
    if (err.type === 'unavailable-id' && tries < 5) {     // after a refresh the old id lingers a few seconds
      peer.destroy(); setTimeout(() => openPeer(id, tries + 1), 2500);
      lobbyMsg('That room is still closing, trying again...');
    } else if (err.type === 'unavailable-id') {
      lobbyMsg('This room is already open in another tab or browser.');
    } else if (!$('game').style.display || $('game').style.display === 'none') {
      lobbyMsg('Could not connect: ' + err.type);
    } else status('Connection problem: ' + err.type);
  });
  peer.on('disconnected', () => { status('Reconnecting...'); setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 2000); });
}

function startClient(name, code) {
  isHost = false; myName = name; roomCode = code; hostId = PREFIX + code;
  peer = new Peer();
  peer.on('open', () => connectToHost());
  peer.on('error', err => {
    if (err.type === 'peer-unavailable') {
      if ($('game').style.display === 'block') status('The GM is not online. Trying again...');
      else lobbyMsg('No game with that code is open right now.');
    } else lobbyMsg('Could not connect: ' + err.type);
  });
}

function connectToHost() {
  hostConn = peer.connect(hostId, { reliable: true });
  hostConn.on('open', () => { status(''); hostConn.send({ t: 'hello', clientId, name: myName }); });
  hostConn.on('data', onClientData);
  hostConn.on('close', () => {
    status('Lost the GM. Trying again...');
    setTimeout(() => { if (peer && !peer.destroyed) connectToHost(); }, 3000);
  });
}

// host: what a player is allowed to see (hidden minis are GM-only)
function viewFor() {
  const figures = {};
  for (const f of Object.values(state.figures)) if (!f.hidden) figures[f.id] = f;
  return { board: state.board, figures, players: state.players, log: state.log.filter(l => !l.to), gm: state.gm, models: state.models };
}

function sendAll(msg, filter) {
  for (const { conn, clientId: cid } of conns.values())
    if (conn.open && (!filter || filter(cid))) conn.send(msg);
}

function dropConn(conn) {
  const c = conns.get(conn.peer);
  if (!c) return;
  conns.delete(conn.peer);
  const still = [...conns.values()].some(x => x.clientId === c.clientId);
  if (!still && state.players[c.clientId]) {
    state.players[c.clientId].online = false;
    addLog({ kind: 'sys', text: `${state.players[c.clientId].name} left.` });
    pushPlayers();
  }
}

function onHostData(conn, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    const cid = clean(msg.clientId, 32) || conn.peer;
    if (cid === state.gm) { conn.close(); return; }     // someone opened the GM's own browser twice
    conns.set(conn.peer, { conn, clientId: cid });
    const p = state.players[cid];
    const name = clean(msg.name) || 'Player';
    const used = Object.values(state.players).map(x => x.color);
    state.players[cid] = { name, color: p?.color || PALETTE.find(c => !used.includes(c)) || PALETTE[Object.keys(state.players).length % PALETTE.length], online: true };
    // first time here: they get their own mini in the middle of the board
    if (!Object.values(state.figures).some(f => f.owner === cid)) {
      const id = rid(8);
      state.figures[id] = { id, name, color: state.players[cid].color, size: '1', owner: cid, hidden: false,
        ...freeSpot(0, 0, '1') };
    }
    conn.send({ t: 'welcome', state: viewFor(), map: state.map });
    for (const [id, data] of modelData) conn.send({ t: 'model', id, name: state.models[id]?.name, data });
    sendAll({ t: 'figs', figures: viewFor().figures });
    addLog({ kind: 'sys', text: `${name} joined.` });
    pushPlayers();
    return;
  }
  const c = conns.get(conn.peer);
  if (c) handle(msg, c.clientId);
}

function onClientData(msg) {
  switch (msg.t) {
    case 'welcome':
      state = Object.assign(freshState(), msg.state);
      state.map = msg.map || null;
      if ($('game').style.display !== 'block') enterGame(); else rebuildAll();
      break;
    case 'fig': upsertFig(msg.fig); break;
    case 'figs': state.figures = msg.figures; syncFigures(); break;
    case 'del': delete state.figures[msg.id]; removeFigMesh(msg.id); break;
    case 'board': state.board = msg.board; buildBoard(); break;
    case 'map': state.map = msg.map; buildBoard(); break;
    case 'model':
      if (msg.data instanceof ArrayBuffer || ArrayBuffer.isView(msg.data)) {
        const d = msg.data instanceof ArrayBuffer ? msg.data : msg.data.buffer.slice(msg.data.byteOffset, msg.data.byteOffset + msg.data.byteLength);
        modelData.set(msg.id, d);
        state.models[msg.id] = { name: msg.name || 'Model' };
        syncFigures();
      }
      break;
    case 'players': state.players = msg.players; renderPlayers(); syncFigures(); break;
    case 'log': state.log.push(msg.entry); renderLogEntry(msg.entry); break;
  }
}

// Every change goes through here. On the host it runs at once; players send it to the host.
function act(msg) {
  if (isHost) handle(msg, clientId);
  else if (hostConn?.open) hostConn.send(msg);
}

// host: check and apply a change from a player (or from the GM)
function handle(msg, from) {
  const gm = from === state.gm;
  const f = msg.id ? state.figures[msg.id] : null;
  const mayMove = f && (gm || f.owner === from);
  switch (msg.t) {
    case 'move': {
      if (!mayMove) return;
      const x = +msg.x, z = +msg.z;
      if (!isFinite(x) || !isFinite(z)) return;
      Object.assign(f, msg.snap ? snapPos(x, z, f.size) : clampPos(x, z, f.size));
      pushFig(f, from, !msg.done);
      if (msg.done) save();
      break;
    }
    case 'edit': {
      if (!mayMove) return;
      if (msg.name != null) f.name = clean(msg.name) || f.name;
      if (msg.color != null) f.color = okColor(msg.color);
      if (msg.size != null && SIZE_CELLS[msg.size]) { f.size = msg.size; Object.assign(f, snapPos(f.x, f.z, f.size)); }
      if (gm && msg.owner !== undefined) f.owner = msg.owner && state.players[msg.owner] ? msg.owner : null;
      if (gm && msg.hidden != null) f.hidden = !!msg.hidden;
      if (gm && msg.model !== undefined) f.model = msg.model && state.models[msg.model] ? msg.model : '';
      if (msg.rot != null && isFinite(+msg.rot)) f.rot = ((Math.round(+msg.rot) % 360) + 360) % 360;
      pushFig(f); save();
      break;
    }
    case 'add': {
      if (!gm) return;
      const id = rid(8);
      const owner = msg.owner && state.players[msg.owner] ? msg.owner : null;
      state.figures[id] = { id, name: clean(msg.name) || 'Mini', color: okColor(msg.color), size: '1', owner, hidden: false,
        ...freeSpot(+msg.x || 0, +msg.z || 0, '1') };
      pushFig(state.figures[id]); save();
      return id;
    }
    case 'model': {
      if (!gm || !(msg.data instanceof ArrayBuffer) || msg.data.byteLength > MAX_MODEL || !/^[0-9a-f]{16}$/.test(msg.id)) return;
      if (!modelData.has(msg.id)) {
        modelData.set(msg.id, msg.data);
        state.models[msg.id] = { name: clean(msg.name, 40) || 'Model' };
        blobs.set('model:' + msg.id, msg.data);
        sendAll({ t: 'model', id: msg.id, name: state.models[msg.id].name, data: msg.data });
      }
      const tf = state.figures[msg.figId];
      if (tf) { tf.model = msg.id; pushFig(tf); }
      save();
      break;
    }
    case 'del': {
      if (!gm || !f) return;
      delete state.figures[f.id];
      removeFigMesh(f.id);
      sendAll({ t: 'del', id: f.id });
      save();
      break;
    }
    case 'board': {
      if (!gm) return;
      const cols = Math.max(2, Math.min(80, Math.round(+msg.cols) || 20));
      const rows = Math.max(2, Math.min(80, Math.round(+msg.rows) || 14));
      state.board = { cols, rows, grid: msg.grid !== false };
      for (const fig of Object.values(state.figures)) Object.assign(fig, snapPos(fig.x, fig.z, fig.size));
      buildBoard(); syncFigures();
      sendAll({ t: 'board', board: state.board });
      sendAll({ t: 'figs', figures: viewFor().figures });
      save();
      break;
    }
    case 'map': {
      if (!gm) return;
      state.map = typeof msg.map === 'string' && msg.map.startsWith('data:image/') ? msg.map : null;
      buildBoard();
      sendAll({ t: 'map', map: state.map });
      save();
      break;
    }
    case 'roll': {
      const sides = [4, 6, 8, 10, 12, 20, 100].includes(+msg.sides) ? +msg.sides : 20;
      const n = Math.max(1, Math.min(20, Math.round(+msg.n) || 1));
      const rolls = Array.from({ length: n }, () => rollDie(sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      const text = `rolled ${n}d${sides}: ${n > 1 ? rolls.join(' + ') + ' = ' : ''}${total}`;
      addLog({ kind: 'roll', from, text, to: msg.hidden ? from : null });
      break;
    }
    case 'chat': {
      const text = clean(msg.text, 300);
      if (text) addLog({ kind: 'chat', from, text });
      break;
    }
  }
}

function pushFig(f, skipFor, live) {
  upsertFig(f, live);
  if (f.hidden) sendAll({ t: 'del', id: f.id });
  else sendAll({ t: 'fig', fig: f, live: !!live }, live && skipFor ? cid => cid !== skipFor : null);
}
function pushPlayers() { renderPlayers(); syncFigures(); sendAll({ t: 'players', players: state.players }); save(); }

// host: log entries. "to" = only that player (and the GM) sees it.
function addLog(entry) {
  if (entry.from) { const p = state.players[entry.from]; entry.name = p?.name || '?'; entry.color = p?.color; }
  entry.at = Date.now();
  state.log.push(entry);
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  renderLogEntry(entry);
  if (isHost) sendAll({ t: 'log', entry }, entry.to ? cid => cid === entry.to : null);
  save();
}

let saveTimer = 0;
function save() {
  if (!isHost) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = { ...state, players: {}, map: null };
    for (const [k, p] of Object.entries(state.players)) s.players[k] = { ...p, online: false };
    store.set('tabletop.host', { code: roomCode, state: s });
    if (state.map !== save.map) { save.map = state.map; blobs.set('map', state.map); }
  }, 400);
}

// =====================================================================
// Board maths (positions are board units: one square = 1)
// =====================================================================
function axisSnap(v, n, cells) {
  const u = v + n / 2;
  const s = cells % 2 ? Math.round(u - 0.5) + 0.5 : Math.round(u);
  return Math.max(cells / 2, Math.min(n - cells / 2, s)) - n / 2;
}
function snapPos(x, z, size) {
  const c = SIZE_CELLS[size] || 1, b = state.board;
  if (!snapOn()) return clampPos(x, z, size);
  return { x: axisSnap(x, b.cols, c), z: axisSnap(z, b.rows, c) };
}
function clampPos(x, z, size) {
  const h = (SIZE_CELLS[size] || 1) / 2, b = state.board;
  return { x: Math.max(-b.cols / 2 + h, Math.min(b.cols / 2 - h, x)), z: Math.max(-b.rows / 2 + h, Math.min(b.rows / 2 - h, z)) };
}
// nearest square where a new mini doesn't stand on another one
function freeSpot(x, z, size) {
  const c = SIZE_CELLS[size] || 1, start = snapPos(x, z, size);
  const clear = p => Object.values(state.figures).every(f => {
    const r = ((SIZE_CELLS[f.size] || 1) + c) / 2 - 0.01;
    return Math.abs(f.x - p.x) > r || Math.abs(f.z - p.z) > r;
  });
  for (let ring = 0; ring < 40; ring++)
    for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      const p = snapPos(start.x + i, start.z + j, size);
      if (clear(p)) return p;
    }
  return start;
}
const snapOn = () => $('snapOn') ? $('snapOn').checked : true;

// =====================================================================
// 3D view
// =====================================================================
let renderer, scene, camera, controls, boardGroup, figRoot;
const figMeshes = new Map();                    // figure id -> THREE.Group
const raycaster = new THREE.Raycaster();
const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let selectedId = null;

function initView() {
  const host = $('view');
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#15171c');
  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  camera.position.set(0, 16, 14);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 3; controls.maxDistance = 120;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  scene.add(new THREE.HemisphereLight('#dfe6ff', '#3a3226', 0.9));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
  sun.position.set(-8, 20, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.userData.sun = sun;

  boardGroup = new THREE.Group(); scene.add(boardGroup);
  figRoot = new THREE.Group(); scene.add(figRoot);

  new ResizeObserver(resize).observe(host);
  resize();
  // capture phase on the wrapper, so a drag on a mini starts before the camera reacts
  host.addEventListener('pointerdown', onDown, true);
  addEventListener('pointermove', onMove);
  addEventListener('pointerup', onUp);
  addEventListener('pointercancel', onUp);
  renderer.setAnimationLoop(tick);
}

function resize() {
  const el = $('view'), w = el.clientWidth || 1, h = el.clientHeight || 1;
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}

let mapTexture = null;
function buildBoard() {
  if (!boardGroup) return;
  boardGroup.clear();
  const { cols, rows, grid } = state.board;
  const mat = new THREE.MeshStandardMaterial({ color: '#4d5b47', roughness: 0.95 });
  if (state.map) {
    if (mapTexture?.userData.src !== state.map) {
      mapTexture?.dispose();
      mapTexture = new THREE.TextureLoader().load(state.map);
      mapTexture.colorSpace = THREE.SRGBColorSpace;
      mapTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      mapTexture.userData.src = state.map;
    }
    mat.map = mapTexture; mat.color.set('#ffffff');
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(cols, rows), mat);
  top.rotation.x = -Math.PI / 2; top.receiveShadow = true;
  boardGroup.add(top);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(cols + 0.6, 0.5, rows + 0.6),
    new THREE.MeshStandardMaterial({ color: '#3b2a1c', roughness: 0.8 }));
  slab.position.y = -0.26; slab.receiveShadow = true;
  boardGroup.add(slab);
  if (grid) {
    const pts = [];
    for (let i = 0; i <= cols; i++) pts.push(i - cols / 2, 0, -rows / 2, i - cols / 2, 0, rows / 2);
    for (let j = 0; j <= rows; j++) pts.push(-cols / 2, 0, j - rows / 2, cols / 2, 0, j - rows / 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 }));
    lines.position.y = 0.003;
    boardGroup.add(lines);
  }
  const sun = scene.userData.sun, r = Math.max(cols, rows) * 0.75 + 4;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
  if (!buildBoard.framed) { frameBoard(); buildBoard.framed = true; }
}

function frameBoard() {
  const { cols, rows } = state.board, d = Math.max(cols, rows * camera.aspect * 0.8, 8);
  camera.position.set(0, d * 0.85, d * 0.75);
  controls.target.set(0, 0, 0);
}

function labelSprite(text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif';
  const w = Math.min(248, g.measureText(text).width + 24);
  g.fillStyle = 'rgba(10,12,16,0.75)';
  g.beginPath(); g.roundRect((256 - w) / 2, 8, w, 48, 12); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 33, 232);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2, 0.5, 1); s.renderOrder = 10;
  return s;
}

function makeMini(f) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const pawn = new THREE.Group(), holder = new THREE.Group();
  body.add(pawn); body.add(holder);
  const col = new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: '#22252b', roughness: 0.6 });
  const add = (geo, mat, y, to = body) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; to.add(m); return m; };
  add(new THREE.CylinderGeometry(0.42, 0.45, 0.1, 32), dark, 0.05);
  add(new THREE.CylinderGeometry(0.43, 0.43, 0.025, 32), col, 0.1);
  add(new THREE.CylinderGeometry(0.17, 0.28, 0.6, 20), col, 0.42, pawn);
  add(new THREE.SphereGeometry(0.19, 20, 14), col, 0.86, pawn);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.55, 40),
    new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; ring.visible = false;
  body.add(ring);
  const mine = new THREE.Mesh(new THREE.RingGeometry(0.47, 0.51, 40),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
  mine.rotation.x = -Math.PI / 2; mine.position.y = 0.01; mine.visible = false;
  body.add(mine);
  const label = labelSprite(f.name); g.add(label);
  g.userData = { id: f.id, body, pawn, holder, col, dark, ring, mine, label, labelText: f.name, modelId: '', target: new THREE.Vector3(f.x, 0, f.z) };
  g.position.set(f.x, 0, f.z);
  return g;
}

function upsertFig(f, live) {
  state.figures[f.id] = f;
  let g = figMeshes.get(f.id);
  if (!g) { g = makeMini(f); figMeshes.set(f.id, g); figRoot.add(g); }
  const u = g.userData;
  if (dragging?.id !== f.id) u.target.set(f.x, 0, f.z);
  u.col.color.set(f.color);
  const text = f.name + (f.hidden ? ' (hidden)' : '');
  if (u.labelText !== text) {
    g.remove(u.label); u.label.material.map.dispose(); u.label.material.dispose();
    u.label = labelSprite(text); u.labelText = text; g.add(u.label);
  }
  const want = f.model && modelData.has(f.model) ? f.model : '';
  if (u.modelId !== want) setModel(g, want);
  u.holder.rotation.y = u.pawn.rotation.y = -(f.rot || 0) * Math.PI / 180;
  const s = +f.size || 1;
  u.body.scale.setScalar(s);
  u.label.position.y = (u.modelTop || 1.1) * s + 0.35;
  u.mine.visible = f.owner === clientId;
  u.ring.visible = selectedId === f.id;
  for (const m of [u.col, u.dark]) { m.transparent = !!f.hidden; m.opacity = f.hidden ? 0.4 : 1; }
  if (selectedId === f.id && !live) showSelected();
}

// ---------- 3D models (.glb) ----------
const modelScenes = new Map();                  // model id -> Promise of the loaded scene
function modelScene(id) {
  if (!modelScenes.has(id)) modelScenes.set(id, new Promise((ok, bad) =>
    new GLTFLoader().parse(modelData.get(id).slice(0), '', gltf => ok(gltf.scene), bad)));
  return modelScenes.get(id);
}

function setModel(g, id) {
  const u = g.userData;
  u.modelId = id;
  u.holder.clear();
  u.pawn.visible = !id;
  u.modelTop = 0;
  if (!id) return;
  modelScene(id).then(scene => {
    if (u.modelId !== id) return;
    const m = cloneSkinned(scene);
    // fit it on the base: no wider than the square, at most ~1.6 squares tall
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m, true), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = Math.min(0.85 / Math.max(size.x, size.z, 1e-6), 1.6 / Math.max(size.y, 1e-6));
    m.scale.multiplyScalar(k);
    m.position.set(-c.x * k, 0.11 - box.min.y * k, -c.z * k);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    u.holder.add(m);
    u.modelTop = 0.11 + size.y * k;
    if (state.figures[u.id]) upsertFig(state.figures[u.id], true);
  }).catch(() => { if (u.modelId === id) { u.pawn.visible = true; status('A 3D model could not be loaded.'); setTimeout(() => status(''), 4000); } });
}

async function modelId(buf) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

function removeFigMesh(id) {
  const g = figMeshes.get(id);
  if (g) { figRoot.remove(g); g.traverse(m => { m.geometry?.dispose(); m.material?.map?.dispose(); m.material?.dispose(); }); figMeshes.delete(id); }
  if (selectedId === id) select(null);
}

function syncFigures() {
  for (const id of [...figMeshes.keys()]) if (!state.figures[id]) removeFigMesh(id);
  for (const f of Object.values(state.figures)) upsertFig(f);
}

function rebuildAll() { buildBoard(); syncFigures(); renderPlayers(); renderLog(); updateBoardInputs(); }

function tick() {
  for (const g of figMeshes.values()) {
    const t = g.userData.target;
    g.position.lerp(t, dragging?.id === g.userData.id ? 1 : 0.25);
  }
  controls.update();
  renderer.render(scene, camera);
}

// ---------- picking and dragging ----------
let dragging = null, lastSend = 0;
function ndc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
function figAt(e) {
  raycaster.setFromCamera(ndc(e), camera);
  const hit = raycaster.intersectObjects(figRoot.children, true)[0];
  let o = hit?.object;
  while (o && !o.userData.id) o = o.parent;
  return o?.userData.id || null;
}
function floorAt(e) {
  raycaster.setFromCamera(ndc(e), camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(floor, p) ? p : null;
}
const canMove = f => f && (isHost || f.owner === clientId);

function onDown(e) {
  if (e.button !== 0 || e.target !== renderer.domElement) return;
  const id = figAt(e);
  if (!id) { select(null); return; }
  const f = state.figures[id];
  select(canMove(f) ? id : null);
  if (!canMove(f)) return;
  e.stopPropagation();                          // the camera stays put while a mini is dragged
  const p = floorAt(e);
  dragging = { id, dx: p ? f.x - p.x : 0, dz: p ? f.z - p.z : 0, moved: false };
  figMeshes.get(id).userData.target.y = 0.35;   // lift it a little while held
}

function onMove(e) {
  if (!dragging) return;
  const p = floorAt(e);
  if (!p) return;
  const f = state.figures[dragging.id];
  const pos = clampPos(p.x + dragging.dx, p.z + dragging.dz, f.size);
  dragging.moved = true;
  figMeshes.get(dragging.id).userData.target.set(pos.x, 0.35, pos.z);
  const now = performance.now();
  if (now - lastSend > 60) { lastSend = now; act({ t: 'move', id: dragging.id, x: pos.x, z: pos.z }); }
}

function onUp() {
  if (!dragging) return;
  const d = dragging, g = figMeshes.get(d.id);
  dragging = null;
  if (!g) return;
  const t = g.userData.target;
  const f = state.figures[d.id];
  const pos = snapOn() ? snapPos(t.x, t.z, f.size) : clampPos(t.x, t.z, f.size);
  t.set(pos.x, 0, pos.z);
  if (d.moved) act({ t: 'move', id: d.id, x: pos.x, z: pos.z, snap: snapOn(), done: true });
}

// =====================================================================
// Side panel
// =====================================================================
function select(id) {
  const prev = selectedId; selectedId = id;
  if (prev && figMeshes.get(prev)) figMeshes.get(prev).userData.ring.visible = false;
  if (id && figMeshes.get(id)) figMeshes.get(id).userData.ring.visible = true;
  showSelected();
}

function ownerOptions(sel, value) {
  sel.innerHTML = '';
  const add = (v, t) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); };
  add('', 'GM only (NPC / monster)');
  for (const [cid, p] of Object.entries(state.players)) if (cid !== state.gm) add(cid, p.name + (p.online ? '' : ' (away)'));
  sel.value = value || '';
}

function showSelected() {
  const f = selectedId && state.figures[selectedId];
  $('selSec').style.display = f ? 'block' : 'none';
  if (!f) return;
  if (document.activeElement !== $('selName')) $('selName').value = f.name;
  $('selColor').value = f.color;
  $('selSize').value = f.size;
  if (isHost) {
    const sm = $('selModel'); sm.innerHTML = '<option value="">Pawn (no model)</option>';
    for (const [id, m] of Object.entries(state.models)) { const o = document.createElement('option'); o.value = id; o.textContent = m.name; sm.appendChild(o); }
    sm.value = f.model || '';
  }
  if (isHost) { ownerOptions($('selOwner'), f.owner); $('selHide').textContent = f.hidden ? 'Show to players' : 'Hide from players'; }
}

function renderPlayers() {
  const el = $('players'); el.innerHTML = '';
  for (const [cid, p] of Object.entries(state.players)) {
    const d = document.createElement('div');
    d.innerHTML = `<span class="dot"></span><span></span>`;
    d.firstChild.style.background = p.color;
    d.lastChild.textContent = p.name + (cid === state.gm ? ' (GM)' : '') + (cid === clientId ? ' - you' : '') + (p.online === false ? ' - away' : '');
    if (p.online === false) d.style.opacity = 0.5;
    el.appendChild(d);
  }
  if (isHost) ownerOptions($('newOwner'), $('newOwner').value);
}

function renderLogEntry(e) {
  const el = $('log'), d = document.createElement('div');
  d.className = e.kind;
  if (e.kind === 'sys') d.textContent = e.text;
  else {
    const n = document.createElement('b'); n.textContent = e.name + (e.kind === 'chat' ? ': ' : ' ');
    if (e.color) n.style.color = e.color;
    d.appendChild(n); d.appendChild(document.createTextNode(e.text + (e.to ? ' (hidden)' : '')));
  }
  const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  el.appendChild(d);
  while (el.children.length > 200) el.firstChild.remove();
  if (atEnd) el.scrollTop = el.scrollHeight;
}
function renderLog() { $('log').innerHTML = ''; state.log.forEach(renderLogEntry); }

function updateBoardInputs() {
  $('cols').value = state.board.cols; $('rows').value = state.board.rows; $('gridOn').checked = state.board.grid;
}

function status(t) { $('status').textContent = t; $('status').style.display = t ? 'block' : 'none'; }
function lobbyMsg(t) { $('lobbyMsg').textContent = t; }

// downscale a picked map so it travels quickly to every player
function readMap(file) {
  return new Promise((ok, bad) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 2048 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      ok({ data: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height });
    };
    img.onerror = bad;
    img.src = URL.createObjectURL(file);
  });
}

function enterGame() {
  $('lobby').style.display = 'none';
  $('game').style.display = 'block';
  document.body.classList.toggle('gm', isHost);
  $('roomCode').textContent = roomCode;
  $('whoAmI').textContent = isHost ? `You are the GM (${myName}). You can move everything.` : `You are ${myName}. You can move your own mini (white ring).`;
  if (!renderer) { initView(); wirePanel(); }
  rebuildAll();
}

function wirePanel() {
  for (const s of [4, 6, 8, 10, 12, 20, 100]) {
    const b = document.createElement('button'); b.textContent = 'd' + s;
    b.onclick = () => act({ t: 'roll', sides: s, n: +$('diceN').value || 1, hidden: $('diceHidden').checked });
    $('dice').appendChild(b);
  }
  const sendChat = () => { const t = $('chatIn').value.trim(); if (t) { act({ t: 'chat', text: t }); $('chatIn').value = ''; } };
  $('chatSend').onclick = sendChat;
  $('chatIn').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
  $('copyLink').onclick = async () => {
    const link = location.origin + location.pathname + '?room=' + roomCode;
    try { await navigator.clipboard.writeText(link); $('copyLink').textContent = 'Copied!'; }
    catch { prompt('Invite link:', link); }
    setTimeout(() => $('copyLink').textContent = 'Copy invite link', 1500);
  };
  $('toggleSide').onclick = () => $('side').classList.toggle('open');

  $('selName').onchange = () => selectedId && act({ t: 'edit', id: selectedId, name: $('selName').value });
  $('selColor').oninput = () => selectedId && act({ t: 'edit', id: selectedId, color: $('selColor').value });
  $('selSize').onchange = () => selectedId && act({ t: 'edit', id: selectedId, size: $('selSize').value });
  $('selOwner').onchange = () => selectedId && act({ t: 'edit', id: selectedId, owner: $('selOwner').value || null });
  $('selHide').onclick = () => selectedId && act({ t: 'edit', id: selectedId, hidden: !state.figures[selectedId].hidden });
  $('selTurn').onclick = () => selectedId && act({ t: 'edit', id: selectedId, rot: (state.figures[selectedId].rot || 0) + 45 });
  $('selModel').onchange = () => selectedId && act({ t: 'edit', id: selectedId, model: $('selModel').value });
  $('modelFile').onchange = async () => {
    const file = $('modelFile').files[0];
    $('modelFile').value = '';
    if (!file || !selectedId) return;
    if (file.size > MAX_MODEL) { alert('That model is too big (over 15 MB). Try a smaller or simplified one.'); return; }
    const data = await file.arrayBuffer();
    try { await new Promise((ok, bad) => new GLTFLoader().parse(data.slice(0), '', ok, bad)); }
    catch { alert('That file could not be read as a 3D model. Use a .glb file.'); return; }
    act({ t: 'model', id: await modelId(data), name: file.name.replace(/\.glb$/i, ''), data, figId: selectedId });
  };
  $('selDel').onclick = () => { if (selectedId && confirm('Delete this mini?')) act({ t: 'del', id: selectedId }); };

  $('addFig').onclick = () => {
    const t = controls.target;
    const id = handle({ t: 'add', name: $('newName').value, color: $('newColor').value, owner: $('newOwner').value || null, x: t.x, z: t.z }, clientId);
    if (id) select(id);
  };
  $('applyBoard').onclick = () => act({ t: 'board', cols: $('cols').value, rows: $('rows').value, grid: $('gridOn').checked });
  $('gridOn').onchange = () => act({ t: 'board', cols: state.board.cols, rows: state.board.rows, grid: $('gridOn').checked });
  $('mapFile').onchange = async () => {
    const file = $('mapFile').files[0];
    if (!file) return;
    try {
      const m = await readMap(file);
      // keep the squares square: match the rows to the picture's shape
      const rows = Math.max(2, Math.min(80, Math.round(state.board.cols * m.h / m.w)));
      act({ t: 'board', cols: state.board.cols, rows, grid: state.board.grid });
      act({ t: 'map', map: m.data });
      updateBoardInputs();
    } catch { alert('Could not read that picture.'); }
    $('mapFile').value = '';
  };
  $('clearMap').onclick = () => act({ t: 'map', map: null });
  addEventListener('keydown', e => {
    if (e.key === 'Delete' && isHost && selectedId && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) act({ t: 'del', id: selectedId });
  });
}

// ---------- lobby ----------
const params = new URLSearchParams(location.search);
$('nameIn').value = store.get('tabletop.name') || '';
if (params.get('room')) { $('codeIn').value = params.get('room').toUpperCase(); $('createBtn').style.display = 'none'; $('joinBtn').classList.add('primary'); }
const needName = () => {
  const n = clean($('nameIn').value);
  if (!n) { lobbyMsg('Type your name first.'); $('nameIn').focus(); return null; }
  store.set('tabletop.name', n); return n;
};
$('createBtn').onclick = () => { const n = needName(); if (n) { lobbyMsg('Opening the game...'); startHost(n); } };
$('joinBtn').onclick = () => {
  const n = needName(); if (!n) return;
  const code = clean($('codeIn').value, 8).toUpperCase();
  if (!code) { lobbyMsg('Type the room code.'); return; }
  lobbyMsg('Joining...'); startClient(n, code);
};
$('codeIn').onkeydown = e => { if (e.key === 'Enter') $('joinBtn').click(); };
$('nameIn').onkeydown = e => { if (e.key === 'Enter') (params.get('room') ? $('joinBtn') : $('createBtn')).click(); };

// for testing in a browser console
window.tabletop = { get state() { return state; }, act, get isHost() { return isHost; }, clientId, get view() { return { camera, controls }; },
  async addModel(data, name, figId) { act({ t: 'model', id: await modelId(data), name, data, figId }); } };
