// Tabletop: a shared 2D board with 3D minis.
// The GM's browser is the host: it holds the game and checks every change.
// Players connect to it with PeerJS (browser-to-browser), so no server is needed.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { dieKit, dieMaterials, simulate, readDie } from './dice.js?v=51';
import { reachable, lineOfSight, distance, adjacent, cellsOf, BLOCKS_MOVE, STATUSES, DUNGEON_EVENTS, EVENT_INFO, directionFor, lootFor } from './rules.js?v=51';

const VERSION = 51;                              // raised by bump.py on every publish
const $ = id => document.getElementById(id);
const PREFIX = 'tabletop-v1-';                 // keeps our room ids apart from other PeerJS users
const PALETTE = ['#e0a64b', '#4b9be0', '#d9534f', '#5cb85c', '#a66be0', '#e07a4b', '#4be0c8', '#e04b9b'];
const SIZE_CELLS = { '0.7': 1, '1': 1, '2': 2, '3': 3 };
const MAX_CELLS = 12;
// terrain tile types. h = how high a mini stands on it. group = section in the menu.
// link = pieces with the same link join up with their neighbours (walls, fences, roads, rivers).
const TILES = {
  grass: { name: 'Grass', group: 'Floors', color: '#5f8f3e', h: 0.06 },
  stone: { name: 'Stone', group: 'Floors', color: '#8c8f94', h: 0.06, seams: true },
  cobble: { name: 'Cobble', group: 'Floors', color: '#76736d', h: 0.06, cobble: true },
  wood: { name: 'Wood', group: 'Floors', color: '#9a6b3f', h: 0.06, planks: true },
  dirt: { name: 'Dirt', group: 'Floors', color: '#7a5a3a', h: 0.06 },
  sand: { name: 'Sand', group: 'Floors', color: '#d8c38a', h: 0.06 },
  snow: { name: 'Snow', group: 'Floors', color: '#e8eef2', h: 0.06 },
  ice: { name: 'Ice', group: 'Floors', color: '#a9d8ea', h: 0.05, shiny: true },
  swamp: { name: 'Swamp', group: 'Floors', color: '#4b5a35', h: 0.05 },
  carpet: { name: 'Carpet', group: 'Floors', color: '#8a2b2b', h: 0.05, rug: true },
  checker: { name: 'Checker', group: 'Floors', color: '#d9d4c7', h: 0.06, checker: true },
  water: { name: 'Water', group: 'Floors', color: '#3f78b5', h: 0.03, water: true },
  lava: { name: 'Lava', group: 'Floors', color: '#e2531d', h: 0.04, glow: true },
  pit: { name: 'Pit', group: 'Floors', color: '#121315', h: 0.004 },
  wall: { name: 'Wall block', group: 'Walls', color: '#6d6a66', h: 1.0, seams: true, link: 'wall' },
  low: { name: 'Low block', group: 'Walls', color: '#807b73', h: 0.4, seams: true, link: 'wall' },
  thin: { name: 'Thin wall', group: 'Walls', color: '#77746f', h: 1.0, seams: true, link: 'wall', piece: 'thin', thick: 0.3 },
  hedge: { name: 'Hedge', group: 'Walls', color: '#3d6b2c', h: 0.8, link: 'wall', piece: 'thin', thick: 0.45 },
  door: { name: 'Door', group: 'Walls', color: '#77746f', h: 0, link: 'wall', piece: 'door' },
  fence: { name: 'Fence', group: 'Walls', color: '#8b5e34', h: 0, link: 'fence', piece: 'fence' },
  road: { name: 'Road', group: 'Paths', color: '#8a8378', h: 0.04, link: 'road', piece: 'strip', width: 0.6, cobble: true },
  river: { name: 'River', group: 'Paths', color: '#3f78b5', h: 0.02, link: 'river', piece: 'strip', width: 0.75, water: true },
  bridge: { name: 'Bridge', group: 'Paths', color: '#9a6b3f', h: 0.16, link: 'river', piece: 'bridge', planks: true },
  tree: { name: 'Tree', group: 'Props', color: '#2f6b2a', h: 0, piece: 'tree' },
  rock: { name: 'Rock', group: 'Props', color: '#7d7c78', h: 0.45, piece: 'rock' },
  event: { name: '? Event', group: 'Events', color: '#ffd23f', h: 0, piece: 'event' },
  hiddenTrap: { name: 'Hidden trap', group: 'Events', color: '#c0392b', h: 0, piece: 'hiddenTrap' },
  trap: { name: 'Trap', group: 'Events', color: '#4a4d52', h: 0.03, piece: 'trap' },
  camp: { name: 'Enemy camp', group: 'Events', color: '#9b2d2d', h: 0, piece: 'camp' },
  chest: { name: 'Treasure chest', group: 'Events', color: '#8a5a2b', h: 0, piece: 'chest' },
  chestOpen: { name: 'Open chest', group: 'Events', color: '#8a5a2b', h: 0, piece: 'chest', open: true },
  guild: { name: 'Guild flag', group: 'Events', color: '#2d5f9b', h: 0, piece: 'flag' },
  campfire: { name: 'Campfire', group: 'Events', color: '#ff8a1e', h: 0, piece: 'campfire' },
  clue: { name: 'Clue', group: 'Events', color: '#e8d9a8', h: 0, piece: 'clue' },
  goal: { name: 'Dungeon goal', group: 'Events', color: '#5fe0ff', h: 0, piece: 'goal' },
  stairs: { name: 'Stairs', group: 'Events', color: '#9a958c', h: 0, piece: 'stairs', seams: true },
};
const INTERACT = { event: '❔ Interact', chest: '📦 Open chest', clue: '📜 Check clue', goal: '⭐ Dungeon goal' };
const linked = (a, b) => !!(TILES[a]?.link && TILES[a].link === TILES[b]?.link);
// squares a mini covers along the board's x (w) and z (d)
const fp = f => ({ w: f.w || SIZE_CELLS[f.size] || 1, d: f.d || SIZE_CELLS[f.size] || 1 });

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
// models that come with the site; a mini linked to a site character of that species gets it by itself
const BUILTIN = { golett: { name: 'Golett', file: 'models/golett.glb', species: 'Golett' } };
const modelData = new Map();                    // model id -> .glb bytes (ArrayBuffer)
const okColor = c => /^#[0-9a-f]{6}$/i.test(c) ? c : '#888888';

// ?test=1: the GM's own test-player window. It gets its own id (kept, so it's the same player and mini
// every time), so it joins as a real player instead of counting as the GM.
const testWindow = new URLSearchParams(location.search).get('test') === '1';
let clientId = store.get(testWindow ? 'tabletop.testId' : 'tabletop.clientId');
if (!clientId) { clientId = rid(12); store.set(testWindow ? 'tabletop.testId' : 'tabletop.clientId', clientId); }

// ---------- game state (the host's copy is the real one) ----------
let isHost = false, myName = '', roomCode = '', hostId = '';
// GM only: "see what players see". null = normal GM view; { as: clientId or '' } = looking as a player
let preview = null;
const gmView = () => isHost && !preview;
const viewerId = () => (preview ? preview.as : clientId);
let state = freshState();
function freshState() {
  // boards: each is a rectangle of squares on one shared grid; (x, z) = its top-left corner
  // party: exploring (no combat) - all allies move in the same turn. from = where each started this turn
  return { boards: [{ id: 'b1', x: -10, z: -7, cols: 20, rows: 14, grid: true }], maps: {}, figures: {}, party: { turn: 1, from: {}, dash: {} }, players: {}, log: [], gm: '', models: {}, tiles: {},
    combat: null, rules: { diag: 'one', limit: true, autoReveal: true }, explored: 0,
    pending: [], event: null, threat: 0, paused: false,                       // GM-only: events waiting / shown
    attack: null, warp: null, warpUsed: {}, library: {}, boardLib: {},       // attack in progress, warp-out vote, GM's saved minis and boards
    areas: {},                                                               // area shapes on the table (burst / cone / line)
    dungeon: null, bag: {}, fog: null, live: 1, prep: {} };   // live = the layer the team is on; prep = random floors waiting on other layers          // fog = the random floor's squares players haven't seen yet (host only)                                               // bag = the team's items: name -> how many                                                         // the random dungeon: name, floor number, settings, its board
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
    if (saved.state.board && !saved.state.boards) {           // a save from before there were several boards
      const b = saved.state.board, x = -Math.floor(b.cols / 2), z = -Math.floor(b.rows / 2);
      state.boards = [{ id: 'b1', x, z, cols: b.cols, rows: b.rows, grid: b.grid }];
      const tiles = {};
      for (const [k, t] of Object.entries(state.tiles || {})) { const [i, j] = k.split(',').map(Number); tiles[(i + x) + ',' + (j + z)] = t; }
      state.tiles = tiles;
      const old = (await blobs.get('map')) || saved.state.map;
      if (old) state.maps.b1 = old;
      delete state.board; delete state.map;
    }
    for (const b of state.boards) { const m = await blobs.get('map:' + b.id); if (m) state.maps[b.id] = m; }
    for (const id of Object.keys(state.models)) {
      const data = await blobs.get('model:' + id);
      if (data) modelData.set(id, data); else delete state.models[id];
    }
    for (const f of Object.values(state.figures)) if (f.model && !modelData.has(f.model)) f.model = '';
  }
  state.rules.diag = 'one';                     // diagonals always count as 1 square
  state.gm = clientId;
  state.players[clientId] = { name, color: state.players[clientId]?.color || PALETTE[0], online: true, gm: true };
  openPeer(PREFIX + roomCode, 0);
}

function openPeer(id, tries) {
  peer = new Peer(id);
  peer.on('open', () => {
    hostId = id;
    cannonP ||= import('cannon-es');            // the physics for dice, loaded ahead of the first throw
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
  hostConn.on('open', () => { status(''); hostConn.send({ t: 'hello', clientId, name: myName, test: testWindow }); });
  hostConn.on('data', onClientData);
  hostConn.on('close', () => {
    status('Lost the GM. Trying again...');
    setTimeout(() => { if (peer && !peer.destroyed) connectToHost(); }, 3000);
  });
}

// host: what a player is allowed to see (hidden minis are GM-only)
function viewFor() {
  const figures = {}, tiles = {};
  for (const f of Object.values(state.figures)) if (figVisible(f)) figures[f.id] = f;
  for (const [k, t] of Object.entries(state.tiles)) { const v = playerTile(k, t); if (v) tiles[k] = v; }
  return { boards: state.boards.filter(shown), figures, players: state.players, log: state.log.filter(l => !l.to), gm: state.gm,
    models: state.models, tiles, combat: combatView(), rules: state.rules, explored: state.explored, party: state.party, pending: [], event: null, threat: 0, paused: state.paused,
    attack: state.attack, warp: state.warp, warpUsed: {}, library: {}, boardLib: {}, areas: areasView(), dungeon: state.dungeon, bag: state.bag };
}
// layers: each board sits on one (far apart on the table); players only ever see the team's layer, the GM looks at one at a time
const LAYER_GAP = 200;
let gmLayer = 1;
const layerOf = b => b?.layer || 1;
const shown = b => !!b && !b.hidden && layerOf(b) === (state.live || 1);
const offView = b => !!b && !shown(b);
const gmSees = b => !b || layerOf(b) === gmLayer;
// a random floor's rooms and corridors stay dark to players until an ally gets there (fog.hid: square -> room number, -1 = corridor or wall)
const fogged = k => state.fog?.hid[k] != null;
const figVisible = f => !f.hidden && !offView(boardAt(f.x, f.z)) && (!!f.owner || f.side === 'player' || !fogged(Math.floor(f.x) + ',' + Math.floor(f.z)));   // the team's own minis never vanish into the dark
const tileVisible = k => { const [i, j] = k.split(',').map(Number); return state.tiles[k] !== 'hiddenTrap' && !offView(boardAt(i + 0.5, j + 0.5)) && !fogged(k); };
// what players get for a square: a hidden trap on a random floor looks like the floor round it, an unseen square is darkness
function playerTile(k, t) {
  const D = state.dungeon, [i, j] = k.split(',').map(Number), b = boardAt(i + 0.5, j + 0.5);
  if (offView(b)) return null;
  if (tileVisible(k)) return t;
  if (fogged(k)) return 'pit';
  return t === 'hiddenTrap' && D && b && b.id === D.board ? FLOOR_LOOKS[D.look].floor : null;
}
// players' copy of the turn order leaves out hidden minis (their turn shows as "the GM's turn")
function combatView() {
  const c = state.combat;
  if (!c) return null;
  const order = c.order.filter(o => state.figures[o.id] && figVisible(state.figures[o.id]));
  return { ...c, order, turn: order.findIndex(o => o.id === c.order[c.turn]?.id) };
}
// tiles to players, leaving out squares on hidden boards
function sendTiles(set, clear) {
  const vis = {};
  for (const [k, v] of Object.entries(set)) vis[k] = v ? playerTile(k, v) : null;
  sendAll({ t: 'tiles', set: vis, clear: !!clear });
}
// after boards are hidden or shown: give every player a fresh view of the table
function resyncPlayers() {
  const v = viewFor();
  sendAll({ t: 'boards', boards: v.boards });
  for (const b of v.boards) if (state.maps[b.id]) sendAll({ t: 'map', id: b.id, map: state.maps[b.id] });
  sendAll({ t: 'tiles', set: v.tiles, clear: true });
  sendAll({ t: 'figs', figures: v.figures });
  sendAll({ t: 'combat', combat: v.combat });
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
        ...freeSpot(0, 0, 1, 1) };
    }
    // the GM's test player starts with 1 in every stat (only filled in where nothing is set yet)
    if (msg.test) for (const f of Object.values(state.figures)) if (f.owner === cid) {
      const st = f.st || {};
      for (const k of ['dex', 'alert', 'hp', 'hpMax']) if (st[k] == null) st[k] = 1;
      f.st = st;
    }
    conn.send({ t: 'welcome', state: viewFor() });
    for (const [id, map] of Object.entries(state.maps)) if (!offView(state.boards.find(b => b.id === id))) conn.send({ t: 'map', id, map });
    for (const [id, data] of modelData) conn.send({ t: 'model', id, name: state.models[id]?.name, data });
    sendAll({ t: 'figs', figures: viewFor().figures });
    addLog({ kind: 'sys', text: `${name} joined.` });
    for (const x of Object.values(state.figures)) if (x.owner === cid && state.combat) joinCombat(x);
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
      if ($('game').style.display !== 'block') enterGame(); else rebuildAll();
      break;
    case 'fig': upsertFig(msg.fig); break;
    case 'figs': state.figures = msg.figures; syncFigures(); break;
    case 'del': delete state.figures[msg.id]; removeFigMesh(msg.id); break;
    case 'boards': state.boards = msg.boards; buildBoard(); updateBoardInputs(); break;
    case 'tiles':
      if (msg.clear) state.tiles = {};
      Object.assign(state.tiles, msg.set || {});
      for (const k in msg.set || {}) if (!msg.set[k]) delete state.tiles[k];
      tilesChanged();
      break;
    case 'map': if (msg.map) state.maps[msg.id] = msg.map; else delete state.maps[msg.id]; buildBoard(); break;
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
    case 'dice': showDice(msg); break;
    case 'paused': state.paused = msg.on; renderPause(); break;
    case 'attack': state.attack = msg.attack; renderAttack(); break;
    case 'fx': playFx(msg); break;
    case 'warp': state.warp = msg.warp; renderWarp(); break;
    case 'combat': state.combat = msg.combat; renderCombat(); renderParty(); renderActBar(); break;
    case 'party': state.party = msg.party; renderParty(); renderActBar(); break;
    case 'rules': state.rules = msg.rules; state.explored = msg.explored; renderRules(); buildBoard(); break;
    case 'note': status(msg.text); setTimeout(() => status(''), 4000); break;
    case 'areas': state.areas = msg.areas; renderAreas(); break;
    case 'ping': playPing(msg); break;
    case 'dungeon': state.dungeon = msg.dungeon; renderFloor(msg.fresh); tilesChanged(); break;
    case 'bag': state.bag = msg.bag; renderBag(); break;
  }
  figsVersion++;
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
      if (state.paused && !gm) { pushFig(f); if (msg.done) note(from, 'Paused: the GM is resolving an event.'); return; }
      const x = +msg.x, z = +msg.z;
      if (!isFinite(x) || !isFinite(z)) return;
      const { w, d } = fp(f), ox = f.x, oz = f.z;
      const turn = state.combat && state.combat.order[state.combat.turn];
      const limited = !gm && state.rules.limit && state.combat && state.combat.order.some(o => o.id === f.id);
      const exploring = !gm && state.rules.limit && !state.combat && !!f.owner;    // party turn: from where it started
      if (limited && turn?.id !== f.id) { pushFig(f); note(from, `It's not ${f.name}'s turn.`); return; }
      if (f._from == null) f._from = { x: ox, z: oz };
      if (!gm && !state.combat && f.owner && !state.party.from[f.id]) { state.party.from[f.id] = { x: ox, z: oz }; pushParty(); }
      // players never step onto a square they can't see (standing at an area's open edge reveals it, below)
      let boards = state.boards;
      if (!gm) boards = state.boards.filter(shown);
      if (!gm && !msg.done && fogged(Math.floor(x) + ',' + Math.floor(z))) return;   // dragging over the dark: the mini waits at the edge
      if (!gm && msg.done && (offView(boardAt(x, z)) || fogged(Math.floor(x) + ',' + Math.floor(z)))) {
        Object.assign(f, f._from); delete f._from;
        note(from, `${f.name} can't walk onto a square nobody can see yet.`);
        pushFig(f); return;
      }
      Object.assign(f, msg.snap ? snapPos(x, z, w, d, boards) : clampPos(x, z, w, d, boards));
      if (msg.done && (limited || exploring)) {   // only as far as this turn's movement allows
        const o = limited ? state.combat.from : state.party.from[f.id];
        const budget = moveBudget(f) * (1 + (limited ? state.combat.dash || 0 : state.party.dash[f.id] ? 1 : 0)) - (o.used || 0);
        if (!reachable(worldFor(f), o.x, o.z, w, d, budget, state.rules.diag).has(`${f.x},${f.z}`)) {
          const taken = cellsOf(f.x, f.z, w, d).some(([i, j]) => worldFor(f).occupied(i, j));
          Object.assign(f, f._from);
          note(from, taken ? `${f.name} can't stand on another mini's square.` : `${f.name} can't reach that square this turn (${budget} movement).`);
        }
      }
      if (msg.done) {                             // no standing inside another mini (attached pieces excepted)
        const W = worldFor(f);
        if (cellsOf(f.x, f.z, w, d).some(([i, j]) => W.occupied(i, j))) {
          Object.assign(f, f._from);
          note(from, `${f.name} can't stand on another mini's square.`);
        }
      }
      if (gm && msg.done && f.owner) {            // the GM puts a player's mini somewhere: the rest of its move starts there
        const P = state.party.from[f.id], C = state.combat?.order[state.combat.turn]?.id === f.id && state.combat.from;
        if (P && !state.combat) { state.party.from[f.id] = { ...P, x: f.x, z: f.z }; pushParty(); }
        if (C) { state.combat.from = { ...C, x: f.x, z: f.z }; pushCombat(); }
      }
      if (msg.done) delete f._from;
      if (msg.done && isSmall(f)) {               // sharing a square with another Small: face the same way
        const mate = Object.values(state.figures).find(o => o.id !== f.id && isSmall(o) && Math.floor(o.x) === Math.floor(f.x) && Math.floor(o.z) === Math.floor(f.z));
        if (mate && (mate.rot || 0) !== (f.rot || 0)) f.rot = mate.rot || 0;
      }
      if (msg.done && f.owner) {                  // an ally steps on a trap: a hidden one springs into view
        for (const k of cellsOf(f.x, f.z, w, d).map(([i, j]) => i + ',' + j)) {
          const t = state.tiles[k];
          if (t !== 'hiddenTrap' && t !== 'trap') continue;
          if (t === 'hiddenTrap') { state.tiles[k] = 'trap'; tilesChanged(); sendTiles({ [k]: 'trap' }); }
          addLog({ kind: 'sys', text: `${f.name} sets off a trap!` });
          addLog({ kind: 'sys', text: `Trap sprung by ${f.name}: resolve its effect (Trap or Hazard rules on the event card).`, to: state.gm });
          state.event = { n: 1, who: f.name, trap: true }; renderEvent();
        }
      }
      pushFig(f, from, !msg.done);
      carry(f.id, f.x - ox, f.z - oz, 0, f);
      // exploring something new (a hidden board, or a dark room / corridor of a random floor) uses up the movement spent so far:
      // walking back doesn't hand it out again. Ordinary walking is still measured from where the turn started (Adam).
      const fresh = (msg.done && (f.owner || sideOf(f) === 'player') ? revealFog(f) : false) | (msg.done && f.owner && state.rules.autoReveal ? revealNextTo(f) : false);
      if (fresh && (limited || exploring)) {
        const o = limited ? state.combat.from : state.party.from[f.id];
        const spent = o && reachable(worldFor(f), o.x, o.z, w, d, Infinity, state.rules.diag).get(`${f.x},${f.z}`);
        if (spent) {
          const now = { x: f.x, z: f.z, used: (o.used || 0) + spent };
          if (limited) { state.combat.from = now; pushCombat(); } else { state.party.from[f.id] = now; pushParty(); }
        }
      }
      if (msg.done) save();
      break;
    }
    case 'stats': {
      if (!gm || !f) return;                    // HP, statuses and stats are set by the GM
      const n = (v, hi = 99) => (v === '' || v == null || !isFinite(+v) ? undefined : Math.max(0, Math.min(hi, Math.round(+v))));
      const st = { ...(f.st || {}) };
      for (const k of ['dex', 'alert', 'hp', 'hpMax', 'move']) if (k in msg) st[k] = n(msg[k]);
      if (Array.isArray(msg.status)) st.status = [...new Set(msg.status.filter(x => STATUSES.includes(x)))].slice(0, 10);
      const timers = { ...(st.timers || {}), ...(msg.timers && typeof msg.timers === 'object' ? msg.timers : {}) };
      st.timers = {};                           // rounds left on a status; it drops off by itself at 0
      for (const x of st.status || []) { const r = n(timers[x], 20); if (r > 0) st.timers[x] = r; }
      f.st = st;
      pushFig(f); save();
      if (state.combat) { if (fights(f)) joinCombat(f); pushCombat(); }
      break;
    }
    case 'combatStart': {
      if (!gm) return;
      const fighters = Object.values(state.figures).filter(fights);
      if (!fighters.length) { note(from, 'No minis to fight: players\' minis join by themselves, GM minis need a Dexterity.'); return; }
      const order = fighters.map(rollInit).sort(initOrder);
      const first = state.figures[order[0].id];
      state.combat = { order, turn: 0, round: 1, from: { x: first.x, z: first.z }, dash: 0 };
      const shown = combatView().order.map(o => `${state.figures[o.id].name} ${o.init}`).join(', ');
      addLog({ kind: 'sys', text: `Combat! Initiative (1d6 + Dexterity + Alert): ${shown}.` });
      pushCombat();
      setTab('combat');
      break;
    }
    case 'combatJoin': {                         // GM: add a mini to the fight, or take it out
      const c = state.combat;
      if (!gm || !c || !f) return;
      if (c.order.some(o => o.id === f.id)) {
        const curId = c.order[c.turn]?.id;
        if (curId === f.id) { note(from, 'End its turn first, then take it out.'); return; }
        c.order = c.order.filter(o => o.id !== f.id);
        c.turn = Math.max(0, c.order.findIndex(o => o.id === curId));
        addLog({ kind: 'sys', text: `${f.name} leaves the fight.` });
        pushCombat();
      } else joinCombat(f);
      break;
    }
    case 'combatNext': case 'combatDash': {
      const c = state.combat, cur = c && state.figures[c.order[c.turn]?.id];
      if (!c || !(gm || cur?.owner === from)) return;
      if (state.paused) { note(from, 'Paused: the GM is resolving an event first.'); return; }
      if (msg.t === 'combatDash') {
        if (c.dash) {                           // undo: only while still inside the normal move
          const k = fp(cur);
          if (!reachable(worldFor(cur), c.from.x, c.from.z, k.w, k.d, moveBudget(cur) - (c.from.used || 0), state.rules.diag).has(`${cur.x},${cur.z}`)) {
            note(from, `${cur.name} has already moved further than a normal move, so the Dash stays.`); return;
          }
          c.dash = 0;
          addLog({ kind: 'sys', text: `${cur.name} takes back the Dash.` });
        } else {
          c.dash = 1;
          addLog({ kind: 'sys', text: `${cur?.name || '?'} dashes (an action spent on extra movement).` });
        }
      } else {
        c.order = c.order.filter(o => state.figures[o.id]);
        if (!c.order.length) { state.combat = null; pushCombat(); return; }
        c.turn = (c.turn + 1) % c.order.length;
        if (c.turn === 0) { c.round++; addLog({ kind: 'sys', text: `End of round ${c.round - 1}: Burn, Poison and weather effects happen now. Round ${c.round} begins.` }); countDown(); }
        clearAreas();
        const nx = state.figures[c.order[c.turn].id];
        c.from = { x: nx.x, z: nx.z }; c.dash = 0;
      }
      pushCombat();
      break;
    }
    case 'combatEnd': {
      if (!gm || !state.combat) return;
      state.combat = null;
      addLog({ kind: 'sys', text: 'Combat is over.' });
      state.party = { turn: state.party.turn + 1, from: {}, dash: {} };
      pushCombat(); pushParty();
      break;
    }
    case 'interact': {
      const kind = state.tiles[msg.key];
      if (!mayMove || !f.owner || !INTERACT[kind]) return;
      if (state.combat && state.combat.order[state.combat.turn]?.id !== f.id && !gm) { note(from, `Wait for ${f.name}'s turn.`); return; }
      if (!nextToCell(f, msg.key)) { note(from, `${f.name} has to stand next to it first.`); return; }
      const [ki, kj] = msg.key.split(',').map(Number);
      const what = { event: 'checks the ? - something happens...', chest: 'opens the treasure chest!', clue: 'finds a clue!', goal: 'reaches the Dungeon Goal!' }[kind];
      if (kind === 'chest') { state.tiles[msg.key] = 'chestOpen'; tilesChanged(); sendTiles({ [msg.key]: 'chestOpen' }); }
      else if (kind !== 'goal') { delete state.tiles[msg.key]; tilesChanged(); sendTiles({ [msg.key]: null }); }
      addLog({ kind: 'sys', text: `${f.name} ${what}` });
      state.pending.push({ id: rid(6), kind, key: msg.key, who: f.name, x: ki + 0.5, z: kj + 0.5 });
      addLog({ kind: 'sys', text: `${f.name}: ${INTERACT[kind].slice(2).toLowerCase()} - see Rules & dungeon.`, to: state.gm });
      renderEvent(); save();
      break;
    }
    case 'siteLink': {                          // GM: this mini follows a character from the Voice of the Forest site
      if (!gm || !f) return;
      if (msg.char) { f.link = clean(msg.char, 40); f.sync = {}; if (!SIDES[f.side]) f.side = 'player'; }
      else { delete f.link; delete f.sync; }
      pushFig(f); save();
      syncSite();
      break;
    }
    case 'siteCode': {
      if (!gm) return;
      state.siteCode = clean(msg.code, 24).toUpperCase() || 'VOICE';
      save(); siteFeed();
      break;
    }
    case 'talk': {                              // a player's mini next to an NPC talks to them: everyone sees it, the GM answers
      const npc = state.figures[msg.npc];
      if (!mayMove || !f.owner || !npc || sideOf(npc) !== 'npc' || !figVisible(npc)) return;
      if (!nextToFig(f, npc)) { note(from, `${f.name} has to stand next to ${npc.name} first.`); return; }
      addLog({ kind: 'sys', text: `${f.name} talks to ${npc.name}${npc.job ? ` (${npc.job})` : ''}.` });
      note(state.gm, `${f.name} is talking to ${npc.name}${npc.job ? ` the ${npc.job}` : ''}: answer them in the chat.`);
      save();
      break;
    }
    case 'attack': {                            // a move: accuracy roll, then (on a hit) damage
      const tg = state.figures[msg.target];
      if (!mayMove || !tg || tg.id === f.id || attackBusy) return;
      if (state.paused && !gm) { note(from, 'Paused: the GM is resolving an event.'); return; }
      if (!gm && state.combat && state.combat.order[state.combat.turn]?.id !== f.id) { note(from, `Wait for ${f.name}'s turn.`); return; }
      if (!gm && sideOf(tg) === 'npc') { note(from, `${tg.name} is an NPC: stand next to them and click Talk instead.`); return; }
      const mv = cleanMove(msg.move);
      if (!mv) return;
      const num = v => Math.max(0, Math.min(20, Math.round(+v) || 0));
      f.st = { ...(f.st || {}) }; f.st.attr = { ...(f.st.attr || {}) };
      for (const [k, v] of Object.entries(msg.attr || {})) if (ATTRS.includes(k)) f.st.attr[k] = num(v);
      if (gm && msg.def && ATTRS.includes(msg.def.name)) { tg.st = { ...(tg.st || {}) }; tg.st.attr = { ...(tg.st.attr || {}), [msg.def.name]: num(msg.def.v) }; pushFig(tg); }
      f.st.moves = [mv.name, ...(f.st.moves || []).filter(x => x !== mv.name)].slice(0, 8);
      faceToward(f, tg);
      pushFig(f); save();
      attackRoll(f, tg, mv, msg, from);
      break;
    }
    case 'species': {                           // GM: a Pokémon from the site fills the mini's attributes, HP, types and moves
      if (!gm || !f) return;
      const num = (v, hi = 20) => Math.max(0, Math.min(hi, Math.round(+v) || 0));
      const st = { ...(f.st || {}) };
      st.attr = { ...(st.attr || {}) };
      for (const k of ['Strength', 'Dexterity', 'Vitality', 'Special', 'Insight']) if (msg.attr?.[k] != null) st.attr[k] = num(msg.attr[k]);
      st.species = clean(msg.name, 40);
      st.types = (Array.isArray(msg.types) ? msg.types : []).filter(t => TYPES[t]).slice(0, 2);
      st.learn = (Array.isArray(msg.moves) ? msg.moves : []).map(x => clean(x, 40)).filter(Boolean).slice(0, 40);
      st.dex = st.attr.Dexterity;
      st.hpMax = num(msg.hp, 99) + (st.attr.Vitality || 0);    // PokéRole: HP = base HP + Vitality
      st.hp = st.hpMax;
      f.st = st;
      pushFig(f); save();
      if (state.combat) { if (fights(f)) joinCombat(f); pushCombat(); }
      break;
    }
    case 'attackCancel': {
      if (!state.attack || !(gm || state.attack.by === from)) return;
      state.attack = null; pushAttack();
      break;
    }
    case 'warpVote': {                          // the players' unanimous vote to warp out once the goal is done
      const w = state.warp;
      if (!w || w.result || !w.voters.includes(from)) return;
      w.votes[from] = !!msg.yes;
      if (!msg.yes || w.voters.every(v => w.votes[v])) {
        w.result = msg.yes ? 'out' : 'stay';
        addLog({ kind: 'sys', text: msg.yes ? 'Everyone agreed: the team warps out of the dungeon!' : `${state.players[from]?.name || 'Someone'} chose to stay: the team stays in the dungeon (the warp is used up).` });
      }
      pushWarp();
      break;
    }
    case 'warpClose': {
      if (!gm) return;
      state.warp = null; pushWarp();
      break;
    }
    case 'libSave': {                           // GM: keep a copy of a mini in the saved list (players never see it)
      if (!gm || !f) return;
      const { id: _id, x: _x, z: _z, parent: _p, ...rest } = f;
      state.library[rid(8)] = { ...JSON.parse(JSON.stringify(rest)), group: clean(msg.group, 30) || 'Ungrouped' };
      renderLibrary(); save();
      note(from, `${f.name} saved to your minis list.`);
      break;
    }
    case 'libPlace': {
      const L = gm && state.library[msg.lib];
      if (!L) return;
      const id = rid(8), c = fp(L);
      const { group: _g, ...look } = L;
      state.figures[id] = { ...JSON.parse(JSON.stringify(look)), id, owner: null, hidden: true, ...freeSpot(+msg.x || 0, +msg.z || 0, c.w, c.d) };
      pushFig(state.figures[id]); save();
      return id;
    }
    case 'libEdit': {
      const L = gm && state.library[msg.lib];
      if (!L) return;
      if (msg.name != null) L.name = clean(msg.name) || L.name;
      if (msg.group != null) L.group = clean(msg.group, 30) || 'Ungrouped';
      renderLibrary(); save();
      break;
    }
    case 'libDel': {
      if (!gm || !state.library[msg.lib]) return;
      delete state.library[msg.lib]; renderLibrary(); save();
      break;
    }
    case 'pendingDone': {
      if (!gm) return;
      const pend = state.pending.find(x => x.id === msg.pid);
      if (pend?.kind === 'goal' && msg.tell && !state.warpUsed[pend.key]) startWarp(pend.key);
      state.pending = state.pending.filter(x => x.id !== msg.pid);
      if (msg.tool) handle({ t: 'eventTool', tool: msg.tool, mod: msg.mod }, from);
      if (msg.tell) addLog({ kind: 'sys', text: msg.tell });
      renderEvent(); save();
      break;
    }
    case 'partyNext': {
      if (!gm) return;
      if (state.paused) { note(from, 'Resolve the event first (throw the die / Done).'); return; }
      nextPartyTurn();
      break;
    }
    case 'partyDone': {                         // exploring: a player ends their turn; when every ally is done, the next party turn starts
      if (!mayMove || state.combat || !f.owner) return;
      const P = state.party, done = P.done ||= {};
      if (done[f.id]) { delete done[f.id]; addLog({ kind: 'sys', text: `${f.name} isn't done after all.` }); pushParty(); return; }
      done[f.id] = true;
      addLog({ kind: 'sys', text: `${f.name} ends their turn.` });
      const team = Object.values(state.figures).filter(x => x.owner && !x.parent && figVisible(x));
      if (!state.paused && team.every(x => done[x.id])) nextPartyTurn();
      else pushParty();
      break;
    }
    case 'partyDash': {                         // exploring: Dash for one ally this party turn (press again to undo)
      if (!mayMove || state.combat || !f.owner) return;
      if (state.paused && !gm) { note(from, 'Paused: the GM is resolving an event.'); return; }
      const P = state.party, k = fp(f);
      if (P.dash[f.id]) {
        const o = P.from[f.id] || { x: f.x, z: f.z };
        if (!reachable(worldFor(f), o.x, o.z, k.w, k.d, moveBudget(f) - (o.used || 0), state.rules.diag).has(`${f.x},${f.z}`)) {
          note(from, `${f.name} has already moved further than a normal move, so the Dash stays.`); return;
        }
        delete P.dash[f.id];
        addLog({ kind: 'sys', text: `${f.name} takes back the Dash.` });
      } else {
        P.dash[f.id] = 1;
        if (!P.from[f.id]) P.from[f.id] = { x: f.x, z: f.z };
        addLog({ kind: 'sys', text: `${f.name} dashes (an action spent on extra movement).` });
      }
      pushParty();
      break;
    }
    case 'rules': {
      if (!gm) return;
      if (msg.limit != null) state.rules.limit = !!msg.limit;
      if (msg.autoReveal != null) state.rules.autoReveal = !!msg.autoReveal;
      if (msg.edgeWalls != null) { state.rules.edgeWalls = !!msg.edgeWalls; buildBoard(); }
      pushRules();
      break;
    }
    case 'boardWalls': {                        // ring the board's edge with walls; the GM then paints a Door (or erases one) for the way in
      const b = gm && state.boards.find(x => x.id === msg.id);
      if (!b) return;
      const set = {};
      for (let i = b.x; i < b.x + b.cols; i++) for (let j = b.z; j < b.z + b.rows; j++) {
        if (i !== b.x && i !== b.x + b.cols - 1 && j !== b.z && j !== b.z + b.rows - 1) continue;
        state.tiles[i + ',' + j] = 'wall'; set[i + ',' + j] = 'wall';
      }
      tilesChanged(); sendTiles(set); save();
      break;
    }
    case 'boardHide': {
      const b = gm && state.boards.find(x => x.id === msg.id);
      if (!b) return;
      if (msg.hidden) { b.hidden = true; buildBoard(); updateBoardInputs(); resyncPlayers(); save(); }
      else revealBoard(b);
      break;
    }
    case 'dungeonEvent': {                       // GM throws the hidden event d6 (for a waiting ? or by hand)
      if (!gm) return;
      const pend = msg.pid ? state.pending.find(x => x.id === msg.pid) : null;
      if (pend) state.pending = state.pending.filter(x => x !== pend);
      rollingEvent = true;                      // still paused while the die rolls
      renderEvent();
      rollEvent(from, pend?.who, pend ? { x: pend.x, z: pend.z } : msg.at);
      break;
    }
    case 'eventTool': {                          // GM helper rolls on the event card (only the GM sees them)
      if (!gm) return;
      const d = () => rollDie(6);
      let text = '';
      if (msg.tool === 'direction') {
        const a = d(), b = d(); let dist = d();
        while (dist >= 5) dist = d();
        text = `rolled direction 2d6 = ${a + b} (${directionFor(a + b)}), distance ${dist} tile${dist > 1 ? 's' : ''}`;
      } else if (msg.tool === 'loot') {
        const a = d(), b = d(), mod = Math.max(-1, Math.min(2, Math.round(+msg.mod) || 0)), sum = a + b + mod;
        text = `rolled loot 2d6${mod ? (mod > 0 ? ' + ' + mod : ' - ' + -mod) : ''} = ${sum}: ${lootFor(sum)}`;
      } else if (msg.tool === 'threat') {
        state.threat = Math.max(0, Math.min(6, (state.threat || 0) + (msg.delta || 1)));
        text = `Threat Counter: ${state.threat}/6${state.threat >= 6 ? ' - something disastrous happens!' : ''}`;
        renderEvent();
      } else if (msg.tool === 'tell' && state.event) {
        addLog({ kind: 'sys', text: `Event: ${EVENT_INFO[state.event.n].name}!` });
        break;
      } else if (msg.tool === 'done') {
        state.event = null; renderEvent(); save();
        break;
      } else return;
      addLog({ kind: 'roll', from, text, to: state.gm });
      save();
      break;
    }
    case 'edit': {
      if (!mayMove) return;
      if (!gm) msg = { t: 'edit', id: msg.id, name: msg.name, color: msg.color, turn: msg.turn };   // players: looks only
      if (msg.name != null) f.name = clean(msg.name) || f.name;
      if (msg.color != null) f.color = okColor(msg.color);
      if (msg.size != null && SIZE_CELLS[msg.size]) { f.size = msg.size; f.w = f.d = SIZE_CELLS[msg.size]; }
      if (msg.w != null && msg.d != null) {
        f.w = Math.max(1, Math.min(MAX_CELLS, Math.round(+msg.w) || 1));
        f.d = Math.max(1, Math.min(MAX_CELLS, Math.round(+msg.d) || 1));
        if (f.size === '0.7') f.size = '1';
      }
      let turned = 0;
      if (msg.turn) {                           // square: turn 45 degrees; long piece: 90 and swap its sides
        const c = fp(f);
        turned = c.w === c.d ? 45 : 90;
        turnOne(f, turned);
      }
      if (msg.size != null || msg.w != null || msg.turn) {
        const c = fp(f), ox = f.x, oz = f.z;
        Object.assign(f, snapPos(f.x, f.z, c.w, c.d));
        carry(f.id, f.x - ox, f.z - oz, 0, f);
      }
      if (turned) carry(f.id, 0, 0, turned, f);
      if (gm && msg.owner !== undefined) { f.owner = msg.owner && state.players[msg.owner] ? msg.owner : null; if (f.owner) { f.side = 'player'; joinCombat(f); } }
      if (gm && SIDES[msg.side]) {
        f.side = msg.side;
        if (f.side !== 'player') f.owner = null;
        if (state.combat && !fights(f)) { state.combat.order = state.combat.order.filter(o => o.id !== f.id); pushCombat(); }
      }
      if (gm && msg.job != null) f.job = clean(msg.job, 30);
      if (gm && msg.hidden != null) f.hidden = !!msg.hidden;
      if (gm && msg.model !== undefined) f.model = msg.model && state.models[msg.model] ? msg.model : '';
      pushFig(f); save();
      break;
    }
    case 'add': {
      if (!gm) return;
      const id = rid(8);
      const side = SIDES[msg.side] ? msg.side : msg.owner ? 'player' : 'enemy';
      const owner = side === 'player' && msg.owner && state.players[msg.owner] ? msg.owner : null;
      state.figures[id] = { id, name: clean(msg.name) || 'Mini', color: okColor(msg.color), size: '1', w: 1, d: 1, owner, hidden: false, side,
        job: side === 'npc' ? clean(msg.job, 30) : '', ...freeSpot(+msg.x || 0, +msg.z || 0, 1, 1) };
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
    case 'attach': {
      if (!gm || !f) return;
      let to = msg.to && state.figures[msg.to] ? msg.to : null;
      for (let p = to; p; p = state.figures[p]?.parent) if (p === f.id) { to = null; break; }   // no loops
      f.parent = to;
      pushFig(f); save();
      break;
    }
    case 'tiles': {
      if (!gm) return;
      const set = {};
      if (msg.clear) state.tiles = {};
      for (const [k, v] of Object.entries(msg.set || {})) {
        const [i, j] = k.split(',').map(Number);
        if (!boardAt(i + 0.5, j + 0.5)) continue;
        const t = TILES[v] ? v : null;
        if (t) state.tiles[k] = t; else delete state.tiles[k];
        set[k] = t;
      }
      tilesChanged();
      if (msg.clear) sendTiles(state.tiles, true); else sendTiles(set);
      save();
      break;
    }
    case 'del': {
      if (!gm || !f) return;
      for (const c of Object.values(state.figures)) if (c.parent === f.id) { c.parent = null; pushFig(c); }
      delete state.figures[f.id];
      removeFigMesh(f.id);
      sendAll({ t: 'del', id: f.id });
      save();
      break;
    }
    case 'boardAdd': {
      if (!gm) return;
      const L = Math.max(1, Math.min(20, Math.round(+msg.layer) || gmLayer)), first = !state.boards.some(x => layerOf(x) === L);
      const box = boardsBox(L), cols = clampSize(msg.cols, 12), rows = clampSize(msg.rows, 12);
      const b = { id: 'b' + rid(5), x: first ? (L - 1) * LAYER_GAP - 10 : box.x1, z: first ? -7 : box.z0, cols, rows, grid: true, hidden: !!msg.hidden, layer: L };   // lined up to the right
      state.boards.push(b);
      boardsChanged();
      return b.id;
    }
    case 'boardEdit': {
      const b = gm && state.boards.find(x => x.id === msg.id);
      if (!b) return;
      const old = { ...b };
      if (msg.cols != null) b.cols = clampSize(msg.cols, b.cols);
      if (msg.rows != null) b.rows = clampSize(msg.rows, b.rows);
      if (msg.grid != null) b.grid = !!msg.grid;
      dropTilesOutside(old);
      boardsChanged(true);
      break;
    }
    case 'boardMove': {                         // the board and everything standing on it moves by whole squares
      const b = gm && state.boards.find(x => x.id === msg.id);
      if (!b || !isFinite(+msg.x) || !isFinite(+msg.z)) return;
      const dx = Math.round(+msg.x) - b.x, dz = Math.round(+msg.z) - b.z;
      if (!dx && !dz) return;
      const inside = (x, z) => x >= b.x && x <= b.x + b.cols && z >= b.z && z <= b.z + b.rows;
      const moved = {}, set = {};
      for (const [k, t] of Object.entries(state.tiles)) {
        const [i, j] = k.split(',').map(Number);
        if (inside(i + 0.5, j + 0.5)) { moved[(i + dx) + ',' + (j + dz)] = t; set[k] = null; delete state.tiles[k]; }
      }
      Object.assign(state.tiles, moved); Object.assign(set, moved);
      const riders = Object.values(state.figures).filter(f => inside(f.x, f.z) && !(f.parent && state.figures[f.parent] && inside(state.figures[f.parent].x, state.figures[f.parent].z)));
      b.x += dx; b.z += dz;
      for (const f of riders) { f.x += dx; f.z += dz; pushFig(f); carry(f.id, dx, dz, 0, f); }
      tilesChanged();
      sendTiles(set);
      boardsChanged();
      break;
    }
    case 'boardSave': {                         // GM: keep a copy of a board (size, grid, picture, terrain, GM minis on it) in a labelled group
      const b = gm && state.boards.find(x => x.id === msg.id);
      if (!b) return;
      state.boardLib ||= {};
      const id = rid(8), tiles = {}, figs = [];
      for (const [k, t] of Object.entries(state.tiles)) {
        const [i, j] = k.split(',').map(Number);
        if (boardAt(i + 0.5, j + 0.5) === b) tiles[(i - b.x) + ',' + (j - b.z)] = t;
      }
      for (const f of Object.values(state.figures)) {
        if (f.owner || boardAt(f.x, f.z) !== b) continue;
        const { id: fid, x, z, ...rest } = f;
        figs.push({ ...JSON.parse(JSON.stringify(rest)), old: fid, dx: x - b.x, dz: z - b.z });
      }
      state.boardLib[id] = { name: clean(msg.name, 40) || `Board ${b.cols}x${b.rows}`, group: clean(msg.group, 30) || 'Ungrouped',
        cols: b.cols, rows: b.rows, grid: b.grid, tiles, figs, map: !!state.maps[b.id] };
      if (state.maps[b.id]) blobs.set('boardlib:' + id, state.maps[b.id]);
      renderBoardLib(); save();
      note(from, `Saved "${state.boardLib[id].name}" in ${state.boardLib[id].group}.`);
      break;
    }
    case 'boardPlace': {                        // put a saved board on the table, to the right of the others
      const L = gm && state.boardLib?.[msg.lib];
      if (!L) return;
      const box = boardsBox(gmLayer);
      const b = { id: 'b' + rid(5), x: box.x1, z: box.z0, cols: L.cols, rows: L.rows, grid: L.grid !== false, hidden: !!msg.hidden, layer: gmLayer };
      state.boards.push(b);
      const set = {};
      for (const [k, t] of Object.entries(L.tiles || {})) { const [i, j] = k.split(',').map(Number); set[(i + b.x) + ',' + (j + b.z)] = t; }
      Object.assign(state.tiles, set);
      const ids = new Map((L.figs || []).map(f => [f.old, rid(8)]));
      for (const sf of L.figs || []) {
        const { old, dx, dz, ...rest } = sf;
        const f = { ...JSON.parse(JSON.stringify(rest)), id: ids.get(old), x: b.x + dx, z: b.z + dz, owner: null };
        if (f.parent) f.parent = ids.get(f.parent) || null;
        state.figures[f.id] = f;
      }
      boardsChanged();
      tilesChanged(); sendTiles(Object.fromEntries(Object.entries(set).filter(([k]) => tileVisible(k))));
      for (const id of ids.values()) pushFig(state.figures[id]);
      if (L.map) blobs.get('boardlib:' + msg.lib).then(map => map && handle({ t: 'map', id: b.id, map }, state.gm));
      save();
      return b.id;
    }
    case 'boardLibEdit': {
      const L = gm && state.boardLib?.[msg.lib];
      if (!L) return;
      if (msg.name != null) L.name = clean(msg.name, 40) || L.name;
      if (msg.group != null) L.group = clean(msg.group, 30) || 'Ungrouped';
      renderBoardLib(); save();
      break;
    }
    case 'boardLibDel': {
      if (!gm || !state.boardLib?.[msg.lib]) return;
      delete state.boardLib[msg.lib]; blobs.set('boardlib:' + msg.lib, null);
      renderBoardLib(); save();
      break;
    }
    case 'boardDel': {
      if (!gm || state.boards.length < 2) return;
      const b = state.boards.find(x => x.id === msg.id);
      if (!b) return;
      state.boards = state.boards.filter(x => x !== b);
      delete state.maps[b.id]; blobs.set('map:' + b.id, null);
      sendAll({ t: 'map', id: b.id, map: null });
      dropTilesOutside(b);
      if (state.dungeon?.board === b.id) state.fog = null;
      boardsChanged(true);
      break;
    }
    case 'layerLive': {                         // GM: the team goes to another layer
      if (!gm || !state.boards.some(b => layerOf(b) === +msg.layer)) return;
      addLog({ kind: 'sys', text: 'The team moves on.' });
      goLive(+msg.layer);
      break;
    }
    case 'fogOff': {                            // GM: show players the whole floor at once
      if (!gm || !state.fog) return;
      for (const k of Object.keys(state.fog.hid)) { const [i, j] = k.split(',').map(Number); if (shown(boardAt(i + 0.5, j + 0.5))) delete state.fog.hid[k]; }
      if (!Object.keys(state.fog.hid).length) state.fog = null;
      tilesChanged(); resyncPlayers(); save();
      break;
    }
    case 'map': {
      const b = gm && state.boards.find(x => x.id === msg.id);
      if (!b) return;
      const map = typeof msg.map === 'string' && msg.map.startsWith('data:image/') ? msg.map : null;
      if (map) state.maps[b.id] = map; else delete state.maps[b.id];
      blobs.set('map:' + b.id, map);
      buildBoard();
      if (shown(b)) sendAll({ t: 'map', id: b.id, map });
      save();
      break;
    }
    case 'roll': {
      if (msg.phys) { rollPhysics(msg, from).catch(() => handle({ ...msg, phys: false }, from)); break; }
      const sides = [4, 6, 8, 10, 12, 20, 100].includes(+msg.sides) ? +msg.sides : 20;
      const n = Math.max(1, Math.min(20, Math.round(+msg.n) || 1));
      const rolls = Array.from({ length: n }, () => rollDie(sides));
      const total = rolls.reduce((a, b) => a + b, 0);
      const text = `rolled ${n}d${sides}: ${n > 1 ? rolls.join(' + ') + ' = ' : ''}${total}`;
      addLog({ kind: 'roll', from, text, to: msg.hidden ? from : null });
      break;
    }
    case 'areaAdd': {                           // anyone: show which squares a move hits
      const a = msg.area || {}, kind = AREA_KINDS[a.kind] ? a.kind : null;
      if (!kind || !isFinite(a.x) || !isFinite(a.z)) return;
      const mine = Object.entries(state.areas).filter(([, x]) => x.by === from).map(([k]) => k);
      if (mine.length >= 6) delete state.areas[mine[0]];                    // keep it tidy: 6 each at most
      const id = rid(6), size = Math.max(1, Math.min(10, Math.round(+a.size) || 2)), dir = ((Math.round((+a.dir || 0) / 45) * 45) % 360 + 360) % 360;
      const ar = state.areas[id] = { kind, x: Math.floor(+a.x) + 0.5, z: Math.floor(+a.z) + 0.5, size, dir, by: from, color: state.players[from]?.color || '#ffd23f' };
      const hits = areaHits(ar).filter(figVisible).map(x => x.name);
      addLog({ kind: 'sys', text: `${state.players[from]?.name || '?'}'s ${AREA_KINDS[kind].toLowerCase()} (${size}) ${hits.length ? 'hits ' + hits.join(', ') : 'hits nobody'}.` });
      pushAreas();
      break;
    }
    case 'areaDel': {
      const a = state.areas[msg.area];
      if (!a || !(gm || a.by === from)) return;
      delete state.areas[msg.area]; pushAreas();
      break;
    }
    case 'areaClear': {                         // GM: all of them; a player: their own
      for (const [k, a] of Object.entries(state.areas)) if (gm || a.by === from) delete state.areas[k];
      pushAreas();
      break;
    }
    case 'bagAdd': {                            // anyone: put items in the team's bag (or take them out with a minus n)
      const name = clean(msg.name, 30), n = Math.max(-99, Math.min(99, Math.round(+msg.n) || 1));
      if (!name) return;
      const B = state.bag ||= {}, had = B[name] || 0, now = Math.max(0, Math.min(999, had + n));
      if (now === had) return;
      if (now) B[name] = now; else delete B[name];
      addLog({ kind: 'sys', text: n > 0 ? `${state.players[from]?.name || '?'} puts ${n} ${name} in the bag.` : `${state.players[from]?.name || '?'} takes ${had - now} ${name} out of the bag.` });
      pushBag();
      break;
    }
    case 'action': {                            // a non-move action: rolled for the mini, written in the log
      const a = ACTIONS.find(x => x.key === msg.key);
      if (!a || !mayMove) return;
      if (!a.react && state.combat && state.combat.order[state.combat.turn]?.id !== f.id && !gm) { note(from, `Wait for ${f.name}'s turn.`); return; }
      if (state.paused && !gm) { note(from, 'Paused: the GM is resolving an event.'); return; }
      if (!a.roll) { addLog({ kind: 'sys', text: `${f.name}: ${a.name} - ${a.info}.` }); return; }
      const n = poolOf(f, a), pain = painOf(f);
      rollPhysics({ sides: 6, n, pool: true, at: { x: f.x, z: f.z + 1 }, dir: { x: 0, z: -1 } }, from, (t, parts) => {
        const hits = Math.max(0, parts.filter(v => v >= 4).length - pain);
        return `${f.name}: ${a.name} (${a.roll.join(' + ')}) ${n} ${n === 1 ? 'die' : 'dice'} - ${hits} success${hits === 1 ? '' : 'es'}${pain ? ` (pain: -${pain})` : ''}${a.info ? `. ${a.info[0].toUpperCase() + a.info.slice(1)}.` : ''}`;
      });
      break;
    }
    case 'bagUse': {                            // a player's mini uses an item (the GM applies what it does)
      const name = clean(msg.name, 30), B = state.bag || {};
      if (!mayMove || !B[name]) return;
      if (state.combat && state.combat.order[state.combat.turn]?.id !== f.id && !gm) { note(from, `Wait for ${f.name}'s turn.`); return; }
      if (--B[name] <= 0) delete B[name];
      const what = ITEMS[name];
      addLog({ kind: 'sys', text: `${f.name} uses ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}!${what ? ` (${what})` : ''}` });
      pushBag();
      break;
    }
    case 'floorGen': {                          // GM: rooms and corridors on a board, a new floor of the dungeon
      const b = gm && state.boards.find(x => x.id === msg.board);
      if (!b) return;
      const o = msg.opts || {}, num = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Math.round(+v) || (v === 0 || v === '0' ? 0 : d)));
      const D = { board: b.id, name: clean(o.name, 30) || 'Mystery Dungeon', floor: num(o.floor, 1, 99, 1), look: FLOOR_LOOKS[o.look] ? o.look : 'cave',
        size: FLOOR_SIZES[o.size] ? o.size : '', enemies: num(o.enemies, 0, 12, 3), foes: clean(o.foes, 200), items: num(o.items, 0, 8, 2),
        events: num(o.events, 0, 8, 2), traps: num(o.traps, 0, 10, 2) };
      if (layerOf(b) === (state.live || 1)) state.dungeon = D; else (state.prep ||= {})[layerOf(b)] = D;
      makeFloor(b, D);
      break;
    }
    case 'stairs': {                            // an ally standing on the stairs takes the team to the next floor
      if (!mayMove || !(f.owner || sideOf(f) === 'player')) return;
      const c = fp(f), on = cellsOf(f.x, f.z, c.w, c.d).map(x => x.join(',')).find(k => state.tiles[k] === 'stairs');
      if (!on) { note(from, `${f.name} has to stand on the stairs.`); return; }
      if (state.combat && state.combat.order[state.combat.turn]?.id !== f.id && !gm) { note(from, `Wait for ${f.name}'s turn.`); return; }
      const next = (state.live || 1) + 1;
      if (state.boards.some(x => layerOf(x) === next)) {          // the GM prepared the next layer: the team goes there
        addLog({ kind: 'sys', text: `${f.name} takes the stairs! The team goes down.` });
        goLive(next);
        return;
      }
      const D = state.dungeon, b = D && state.boards.find(x => x.id === D.board);
      const [si, sj] = on.split(',').map(Number);
      if (!b || boardAt(si + 0.5, sj + 0.5) !== b) {
        addLog({ kind: 'sys', text: `${f.name} found the stairs!` });
        addLog({ kind: 'sys', text: 'Stairs only lead somewhere on a random floor: make one under Random floor (Combat tab).', to: state.gm });
        return;
      }
      addLog({ kind: 'sys', text: `${f.name} takes the stairs! The team goes down to ${D.name} B${D.floor + 1}F.` });
      D.floor++;
      makeFloor(b, D);
      break;
    }
    case 'ping': {                              // a flash on a square that everyone sees ("over here!")
      if (!isFinite(msg.x) || !isFinite(msg.z) || !boardAt(msg.x, msg.z)) return;
      const now = Date.now();
      if (now - (pingAt[from] || 0) < 600) return;
      pingAt[from] = now;
      const p = state.players[from], fx = { t: 'ping', x: +msg.x, z: +msg.z, name: p?.name || '?', color: p?.color || '#ffd23f' };
      playPing(fx);
      if (!offView(boardAt(fx.x, fx.z))) sendAll(fx);                       // a ping on a hidden area stays with the GM
      break;
    }
    case 'chat': {
      const text = clean(msg.text, 300);
      if (text) addLog({ kind: 'chat', from, text });
      break;
    }
  }
}

// ---------- physics dice (host throws, everyone watches the same recording) ----------
let cannonP = null;
const diceTotal = (kinds, values) => {
  const parts = [];
  for (let i = 0; i < kinds.length; i++) {
    if (kinds[i] === 'd10t') { parts.push(values[i] * 10 + values[i + 1] || 100); i++; }
    else parts.push(values[i]);
  }
  return parts;
};
async function rollPhysics(msg, from, logText) {
  const sides = [4, 6, 8, 10, 12, 20, 100].includes(+msg.sides) ? +msg.sides : 20;
  const n = Math.max(1, Math.min(sides === 100 ? 5 : 10, Math.round(+msg.n) || 1));
  const kinds = sides === 100 ? Array.from({ length: n }, () => ['d10t', 'd10']).flat() : Array(n).fill('d' + sides);
  const CANNON = await (cannonP ||= import('cannon-es'));
  const num = (v, lo, hi) => Math.max(lo, Math.min(hi, isFinite(+v) ? +v : 0));
  const box = boardsBox(from === state.gm ? gmLayer : state.live || 1);
  const at = { x: num(msg.at?.x, box.x0, box.x1), z: num(msg.at?.z, box.z0, box.z1) };
  const dir = { x: num(msg.dir?.x, -1, 1), z: num(msg.dir?.z, -1, 1) || -1 };
  const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  const { frames, values } = simulate(CANNON, kinds, { from: at, dir, bounds: box, random: rnd });
  const parts = diceTotal(kinds, values), total = parts.reduce((a, c) => a + c, 0);
  const roll = { t: 'dice', id: rid(6), by: from, color: state.players[from]?.color || '#e0a64b', kinds, frames, pool: !!msg.pool && sides === 6, chance: !!msg.chance && sides === 6 };
  const to = msg.hidden ? from : null;
  showDice(roll);
  sendAll(roll, to ? cid => cid === to : null);
  const text = logText ? logText(total, parts) : `rolled ${n}d${sides}: ${n > 1 ? parts.join(' + ') + ' = ' : ''}${total}`;
  await new Promise(ok => setTimeout(ok, frames.length * 1000 / 30 + 250));    // the log waits for the dice to land
  addLog({ kind: 'roll', from, text, to });
  return total;
}

// ---------- dungeon events: a ? is checked -> the GM throws a hidden d6 -> an event card with the rules ----------
let rollingEvent = false;
async function rollEvent(from, who, at) {
  rollingEvent = true;                          // stay paused while the die is in the air
  const r = await rollPhysics({ sides: 6, n: 1, hidden: true, phys: true, at, dir: { x: 0, z: -1 } }, from,
    v => `rolled the dungeon event${who ? ` for ${who}'s ?` : ''}: ${v} = ${DUNGEON_EVENTS[v]}`);
  state.event = { n: r, who: who || '', at: Date.now() };
  rollingEvent = false;
  renderEvent(); save();
}

// ---------- attacks (PokéRole): accuracy = attribute + skill dice, a hit needs 1 success (4-6);
// damage = attribute + the move's Power - the target's defence (Vitality, or Insight vs Special) dice, each success = 1 damage
const ATTRS = ['Strength', 'Dexterity', 'Vitality', 'Special', 'Insight', 'Tough', 'Cool', 'Beauty', 'Clever', 'Cute',
  'Brawl', 'Channel', 'Clash', 'Evasion', 'Alert', 'Athletic', 'Nature', 'Stealth', 'Allure', 'Etiquette', 'Intimidate', 'Perform',
  'Crafts', 'Lore', 'Medicine', 'Science', 'Will', 'Happiness', 'Loyalty'];
const TYPES = { Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c', Grass: '#7ac74c', Ice: '#96d9d6',
  Fighting: '#c22e28', Poison: '#a33ea1', Ground: '#e2bf65', Flying: '#a98ff3', Psychic: '#f95587', Bug: '#a6b91a',
  Rock: '#b6a136', Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746', Steel: '#b7b7ce', Fairy: '#d685ad' };
const defenceFor = cat => (cat === 'Special' ? 'Insight' : 'Vitality');
// attacking type -> [super effective on, not very effective on, no effect on]
const CHART = {
  Normal: ['', 'Rock Steel', 'Ghost'], Fire: ['Grass Ice Bug Steel', 'Fire Water Rock Dragon', ''],
  Water: ['Fire Ground Rock', 'Water Grass Dragon', ''], Electric: ['Water Flying', 'Electric Grass Dragon', 'Ground'],
  Grass: ['Water Ground Rock', 'Fire Grass Poison Flying Bug Dragon Steel', ''], Ice: ['Grass Ground Flying Dragon', 'Fire Water Ice Steel', ''],
  Fighting: ['Normal Ice Rock Dark Steel', 'Poison Flying Psychic Bug Fairy', 'Ghost'], Poison: ['Grass Fairy', 'Poison Ground Rock Ghost', 'Steel'],
  Ground: ['Fire Electric Poison Rock Steel', 'Grass Bug', 'Flying'], Flying: ['Grass Fighting Bug', 'Electric Rock Steel', ''],
  Psychic: ['Fighting Poison', 'Psychic Steel', 'Dark'], Bug: ['Grass Psychic Dark', 'Fire Fighting Poison Flying Ghost Steel Fairy', ''],
  Rock: ['Fire Ice Flying Bug', 'Fighting Ground Steel', ''], Ghost: ['Psychic Ghost', 'Dark', 'Normal'],
  Dragon: ['Dragon', 'Steel', 'Fairy'], Dark: ['Psychic Ghost', 'Fighting Dark Fairy', ''],
  Steel: ['Ice Rock Fairy', 'Fire Water Electric Steel', ''], Fairy: ['Fighting Dragon Dark', 'Fire Poison Steel', ''] };
// her rules: super effective +1 damage per weak type, not very effective -1 per resisting type, immune = no damage
function matchup(type, foeTypes) {
  const [sup, nve, imm] = (CHART[type] || ['', '', '']).map(x => x.split(' '));
  if (foeTypes.some(t => imm.includes(t))) return { immune: true, mod: 0 };
  return { immune: false, mod: foeTypes.filter(t => sup.includes(t)).length - foeTypes.filter(t => nve.includes(t)).length };
}
// pain: at half HP or less 1 success is lost, at 1 HP 2
const painOf = f => { const h = f.st?.hp, m = f.st?.hpMax; return h == null || !m || h <= 0 ? 0 : h <= 1 ? 2 : h <= m / 2 ? 1 : 0; };
function cleanMove(m) {
  if (!m || typeof m !== 'object') return null;
  const name = clean(m.name, 40);
  if (!name) return null;
  const cat = ['Physical', 'Special', 'Status'].includes(m.cat) ? m.cat : 'Physical';
  return { name, type: TYPES[m.type] ? m.type : 'Normal', cat, power: Math.max(0, Math.min(10, Math.round(+m.power) || 0)), effect: clean(m.effect, 300),
    acc: (Array.isArray(m.acc) ? m.acc : []).filter(a => ATTRS.includes(a)).slice(0, 2), dmg: ATTRS.includes(m.dmg) ? m.dmg : '' };
}
// turn a mini to face another (square minis, in 45 degree steps; 0 = facing +z)
function faceToward(f, t) {
  const c = fp(f);
  if (c.w !== c.d || (Math.abs(t.x - f.x) < 0.01 && Math.abs(t.z - f.z) < 0.01)) return;
  const deg = Math.atan2(-(t.x - f.x), t.z - f.z) * 180 / Math.PI;
  const want = ((Math.round(deg / 45) * 45) % 360 + 360) % 360, turn = (want - (f.rot || 0) + 360) % 360;
  if (turn) { turnOne(f, turn); carry(f.id, 0, 0, turn, f); }
}
function pushAttack() { sendAll({ t: 'attack', attack: state.attack }); renderAttack(); save(); }
let attackBusy = false;
async function attackRoll(f, tg, mv, msg, from) {
  const a = f.st.attr || {}, dir = { x: Math.sign(tg.x - f.x) * 0.7, z: Math.sign(tg.z - f.z) * 0.7 || -1 };
  const at = { x: (f.x + tg.x) / 2, z: (f.z + tg.z) / 2 };
  attackBusy = true;
  try {
    if (msg.step !== 'dmg') {
      const n = Math.max(1, mv.acc.reduce((s, k) => s + (a[k] || 0), 0)), pain = painOf(f);
      let hits = 0;
      await rollPhysics({ sides: 6, n, pool: true, at, dir }, from, (t, parts) => {
        hits = Math.max(0, parts.filter(v => v >= 4).length - pain);
        return `${f.name} uses ${mv.name} on ${tg.name}: accuracy ${n} dice (${mv.acc.join(' + ') || 'none set'}) - ${hits} success${hits === 1 ? '' : 'es'}` +
          `${pain ? ` (pain: -${pain})` : ''}, ${hits ? (hits >= 4 && mv.cat !== 'Status' ? 'critical hit!' : 'hit!') : 'miss.'}`;
      });
      if (!hits || mv.cat === 'Status') { const fx = { t: 'fx', kind: mv.cat, miss: !hits, type: mv.type, from: f.id, to: tg.id }; sendAll(fx); playFx(fx); }
      state.attack = hits && mv.cat !== 'Status' ? { id: f.id, target: tg.id, move: mv, by: from, crit: hits >= 4 } : null;
      pushAttack();
      if (hits && mv.cat === 'Status') await chanceRoll(f, tg, mv, from, at, dir);
    } else {
      const A = state.attack;
      if (!A || A.id !== f.id || A.target !== tg.id) return;
      const def = tg.st?.attr?.[defenceFor(mv.cat)] || 0;
      const stab = (f.st.types || []).includes(mv.type) ? 1 : 0, crit = A.crit ? 2 : 0, pain = painOf(f);
      const n = Math.max(1, (a[mv.dmg] || 0) + mv.power - def + stab + crit);
      const mu = matchup(mv.type, tg.st?.types || []);
      let dmg = 0;
      await rollPhysics({ sides: 6, n, pool: true, at, dir }, from, (t, parts) => {
        const rolled = Math.max(0, parts.filter(v => v >= 4).length - pain);
        dmg = mu.immune ? 0 : Math.max(0, rolled + mu.mod);
        const extra = [stab && 'same type +1', crit && 'critical +2'].filter(Boolean).join(', ');
        const eff = mu.immune ? `, but ${tg.name} is immune` : mu.mod > 0 ? `, super effective +${mu.mod}` : mu.mod < 0 ? `, not very effective ${mu.mod}` : '';
        return `${mv.name} damage: ${n} dice (${mv.dmg || '?'} + Power ${mv.power} - ${defenceFor(mv.cat)}${sideOf(tg) === 'enemy' ? '' : ' ' + def}${extra ? ', ' + extra : ''}) - ${rolled} success${rolled === 1 ? '' : 'es'}${pain ? ` (pain: -${pain})` : ''}${eff}: ${dmg} damage to ${tg.name}`;
      });
      const fx = { t: 'fx', kind: mv.cat, type: mv.type, from: f.id, to: tg.id, text: dmg ? `-${dmg}` : 'No damage' };
      sendAll(fx); playFx(fx);
      await new Promise(ok => setTimeout(ok, FX_HIT[mv.cat] || 300));
      if (tg.st?.hp != null && dmg) {
        const hp = Math.max(0, tg.st.hp - dmg);
        tg.st = { ...tg.st, hp };
        pushFig(tg);
        if (!hp) addLog({ kind: 'sys', text: `${tg.name} faints!` });
      }
      state.attack = null; pushAttack();
      await chanceRoll(f, tg, mv, from, at, dir);
    }
  } finally { attackBusy = false; }
}

// "Roll 1 Chance Dice to Burn the foe": after the move lands, any 6 triggers the effect
async function chanceRoll(f, tg, mv, from, at, dir) {
  const m = /Roll (\d+) Chance Dic?e to ([^.]+)/i.exec(mv.effect || '');
  if (!m) return;
  const n = Math.max(1, Math.min(10, +m[1])), what = m[2].trim();
  await new Promise(ok => setTimeout(ok, 600));
  await rollPhysics({ sides: 6, n, chance: true, at, dir }, from, (t, parts) =>
    `${mv.name} chance dice (${n}, a 6 triggers it): ${parts.join(', ')} - ${parts.includes(6) ? `yes! ${what}` : 'no effect'}`);
}

// ---------- characters from the Voice of the Forest site: read only, the site is never changed from here ----------
const SITE_DB = 'https://voiceoftheforest-e071c-default-rtdb.firebaseio.com';
let siteParty = {}, siteES = null, siteCodeOn = '';
function siteFeed() {
  const code = (state.siteCode || 'VOICE').toUpperCase();
  if (!isHost || (siteES && siteCodeOn === code)) return;
  siteES?.close(); siteParty = {}; siteCodeOn = code;
  siteES = new EventSource(`${SITE_DB}/tables/${encodeURIComponent(code)}/party.json`);
  const apply = (ev, merge) => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    const parts = (d.path || '/').split('/').filter(Boolean);
    const setAt = (path, v) => {
      if (!path.length) { siteParty = v && typeof v === 'object' ? v : {}; return; }
      let o = siteParty;
      for (const k of path.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
      if (v == null) delete o[path.at(-1)]; else o[path.at(-1)] = v;
    };
    if (merge) for (const [k, v] of Object.entries(d.data || {})) setAt([...parts, ...k.split('/')], v);
    else setAt(parts, d.data);
    syncSite(); renderSiteChars();
  };
  siteES.addEventListener('put', e => apply(e, false));
  siteES.addEventListener('patch', e => apply(e, true));
}
// what the tabletop takes from a site character
function siteVals(c) {
  const n = v => Math.max(0, Math.min(99, Math.round(+v) || 0));
  const attr = {};
  for (const k of ATTRS) if (c[k] != null && isFinite(+c[k])) attr[k] = n(c[k]);
  const hpMax = n(c.baseHp) + n(c.Vitality);
  return { name: clean(c.nickname || c.pokemon, 24) || 'Mini', attr, hpMax, hp: c.hp == null ? hpMax : n(c.hp),
    dex: attr.Dexterity ?? 0, alert: attr.Alert ?? 0, species: clean(c.pokemon, 40),
    types: [c.type1, c.type2].filter(t => TYPES[t]), learn: (Array.isArray(c.moves) ? c.moves : []).map(x => clean(x, 40)).filter(Boolean).slice(0, 40),
    status: (Array.isArray(c.status) ? c.status : []).filter(x => STATUSES.includes(x)).slice(0, 10) };
}
// only what changed on the site since last time is copied, so HP the GM changes here stays until the site changes it
function syncSite() {
  if (!isHost) return;
  for (const f of Object.values(state.figures)) {
    const c = f.link && siteParty[f.link];
    if (!c) continue;
    const v = siteVals(c), old = f.sync || {};
    let changed = false;
    for (const k of Object.keys(v)) {
      if (JSON.stringify(v[k]) === JSON.stringify(old[k])) continue;
      changed = true;
      if (k === 'name') f.name = v.name;
      else { f.st = { ...(f.st || {}) }; f.st[k] = v[k]; }
    }
    const auto = !f.model && v.species !== old.species && Object.keys(BUILTIN).find(k => BUILTIN[k].species === v.species);
    if (auto) useBuiltin(auto, f.id);
    f.sync = v;
    if (!changed) continue;
    pushFig(f);
    if (state.combat && fights(f)) { joinCombat(f); pushCombat(); }
    save();
  }
}
function renderSiteChars() {
  const sel = $('selSite'), f = selectedId && state.figures[selectedId];
  if (!sel || !isHost) return;
  sel.innerHTML = '<option value="">Not linked</option>';
  const list = Object.entries(siteParty).filter(([, c]) => c && typeof c === 'object').sort((a, b) => String(a[1].nickname).localeCompare(String(b[1].nickname)));
  for (const [id, c] of list) { const o = document.createElement('option'); o.value = id; o.textContent = `${c.nickname || '?'}${c.pokemon && c.pokemon !== c.nickname ? ` (${c.pokemon})` : ''}`; sel.appendChild(o); }
  if (f?.link && !siteParty[f.link]) { const o = document.createElement('option'); o.value = f.link; o.textContent = 'Linked (not found on the site)'; sel.appendChild(o); }
  sel.value = f?.link || '';
  if (document.activeElement !== $('siteCode')) $('siteCode').value = state.siteCode || 'VOICE';
}

// ---------- warp out: once the Dungeon Goal is done, every player votes; all yes = the team warps out ----------
function startWarp(key) {
  const voters = Object.entries(state.players).filter(([id, p]) => id !== state.gm && p.online !== false && Object.values(state.figures).some(f => f.owner === id)).map(([id]) => id);
  if (!voters.length) return;
  state.warpUsed[key] = true;
  state.warp = { voters, votes: {}, result: null };
  addLog({ kind: 'sys', text: 'Dungeon cleared! The team can warp out, but only if everyone agrees (one chance).' });
  pushWarp();
}
function pushWarp() { sendAll({ t: 'warp', warp: state.warp }); renderWarp(); save(); }

const rolls = [];                               // dice on the table right now
function showDice(roll) {
  for (let i = rolls.length - 1; i >= 0; i--) if (rolls[i].by === roll.by) { clearRoll(rolls[i]); rolls.splice(i, 1); }
  const meshes = roll.kinds.map(kind => {
    const kit = dieKit(kind), m = new THREE.Mesh(kit.geo, dieMaterials(kit, roll.color));
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  });
  const last = roll.frames[roll.frames.length - 1];
  const parts = diceTotal(roll.kinds, roll.kinds.map((k, i) => readDie(dieKit(k), last[i].slice(3))));
  rolls.push({ ...roll, meshes, t0: performance.now(), total: parts.reduce((a, c) => a + c, 0), badge: null });
}
function clearRoll(r) {
  for (const m of r.meshes) scene.remove(m);
  if (r.badge) { scene.remove(r.badge); r.badge.material.map.dispose(); r.badge.material.dispose(); }
}
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
function animateDice(now) {
  for (let k = rolls.length - 1; k >= 0; k--) {
    const r = rolls[k], f = (now - r.t0) / (1000 / 30), n = r.frames.length;
    const i = Math.min(n - 1, Math.floor(f)), j = Math.min(n - 1, i + 1), t = Math.min(1, f - i);
    r.meshes.forEach((m, d) => {
      const A = r.frames[i][d], B = r.frames[j][d];
      m.position.set(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
      qa.set(A[3], A[4], A[5], A[6]); qb.set(B[3], B[4], B[5], B[6]);
      m.quaternion.slerpQuaternions(qa, qb, t);
    });
    if (f >= n && !r.badge) {                   // settled: show the total above the dice for a while
      const c = new THREE.Vector3();
      r.meshes.forEach(m => c.add(m.position)); c.multiplyScalar(1 / r.meshes.length);
      let text = String(r.total);
      if (r.pool) {                             // a success pool: 4-6 turn green, 1-3 red, and the badge counts successes
        const last = r.frames[n - 1];
        let ok = 0;
        r.meshes.forEach((m, d) => { const v = readDie(dieKit('d6'), last[d].slice(3)); if (v >= 4) ok++; m.material = dieMaterials(dieKit('d6'), v >= 4 ? '#2fae4f' : '#c8382f'); });
        text = `${ok} success${ok === 1 ? '' : 'es'}`;
      } else if (r.chance) {                    // chance dice: only a 6 counts, so 6s turn green and the badge says if one came up
        const last = r.frames[n - 1];
        let six = 0;
        r.meshes.forEach((m, d) => { const v = readDie(dieKit('d6'), last[d].slice(3)); if (v === 6) six++; m.material = dieMaterials(dieKit('d6'), v === 6 ? '#2fae4f' : '#8a8a8a'); });
        text = six ? 'a 6: it works!' : 'no 6: no effect';
      }
      r.badge = labelSprite(text); r.badge.position.set(c.x, 1.1, c.z); r.badge.scale.set(2.4, 0.6, 1);
      scene.add(r.badge);
      r.doneAt = now;
    }
    if (r.doneAt && now - r.doneAt > 8000) { clearRoll(r); rolls.splice(k, 1); }
  }
}

const clampSize = (v, dflt) => Math.max(2, Math.min(80, Math.round(+v) || dflt));
// host: tiles that were on a board that shrank or went away (and aren't on another board)
function dropTilesOutside(old) {
  const set = {};
  for (const k of Object.keys(state.tiles)) {
    const [i, j] = k.split(',').map(Number), x = i + 0.5, z = j + 0.5;
    if (x > old.x && x < old.x + old.cols && z > old.z && z < old.z + old.rows && !boardAt(x, z)) { delete state.tiles[k]; set[k] = null; }
  }
  if (Object.keys(set).length) { tilesChanged(); sendTiles(set); }
}
// host: boards changed; minis left off the boards are put back on (refit = re-snap everyone)
function boardsChanged(refit) {
  buildBoard(); updateBoardInputs();
  sendAll({ t: 'boards', boards: state.boards.filter(shown) });
  for (const f of Object.values(state.figures)) {
    if (!refit && boardAt(f.x, f.z)) continue;
    const c = fp(f), p = snapPos(f.x, f.z, c.w, c.d);
    if (p.x !== f.x || p.z !== f.z) { Object.assign(f, p); pushFig(f); }
  }
  save();
}

// ---------- area shapes: burst (a square around a point), cone (widens away from the start), line ----------
const AREA_KINDS = { burst: 'Burst', cone: 'Cone', line: 'Line' };
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];   // 0°, 45°, ... (x right, z down)
function areaCells(a) {
  const oi = Math.floor(a.x), oj = Math.floor(a.z), n = a.size, out = [];
  if (a.kind === 'burst') {
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) out.push([oi + i, oj + j]);
    return out;
  }
  const [dx, dz] = DIRS[Math.round(a.dir / 45) % 8];
  if (a.kind === 'line') { for (let k = 1; k <= n; k++) out.push([oi + dx * k, oj + dz * k]); return out; }
  // cone: a quarter turn wide, starting next to the start square
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    if (!i && !j) continue;
    const ok = dx && dz ? i * dx >= 0 && j * dz >= 0 : dx ? i * dx >= Math.abs(j) && i * dx > 0 : j * dz >= Math.abs(i) && j * dz > 0;
    if (ok) out.push([oi + i, oj + j]);
  }
  return out;
}
function areaHits(a) {
  const cells = new Set(areaCells(a).map(c => c.join(',')));
  return Object.values(state.figures).filter(f => { const k = fp(f); return cellsOf(f.x, f.z, k.w, k.d).some(c => cells.has(c.join(','))); });
}
const areasView = () => Object.fromEntries(Object.entries(state.areas || {}).filter(([, a]) => !offView(boardAt(a.x, a.z))));
function pushAreas() { renderAreas(); sendAll({ t: 'areas', areas: areasView() }); save(); }
function clearAreas() { if (Object.keys(state.areas || {}).length) { state.areas = {}; pushAreas(); } }
const pingAt = {};
// status timers: one round off each (end of a combat round, or each party turn); at 0 the status wears off
function countDown() {
  for (const f of Object.values(state.figures)) {
    const t = f.st?.timers;
    if (!t || !Object.keys(t).length) continue;
    const st = { ...f.st, timers: {} }, gone = [];
    for (const [x, r] of Object.entries(t)) {
      if (!(st.status || []).includes(x)) continue;
      if (r > 1) st.timers[x] = r - 1; else gone.push(x);
    }
    st.status = (st.status || []).filter(x => !gone.includes(x));
    f.st = st;
    if (gone.length) addLog({ kind: 'sys', text: `${f.name}: ${gone.join(', ')} wore off.`, ...(figVisible(f) ? {} : { to: state.gm }) });
    pushFig(f);
  }
  save();
}

// ---------- actions besides moves (from the Voice of the Forest rules): a dice pool of attribute + skill, 4-6 = a success ----------
const ACTIONS = [
  { group: 'Combat', key: 'evade', name: 'Evade', roll: ['Dexterity', 'Evasion'], react: true, info: 'more successes than the attacker\'s accuracy = the attack misses. Once a round, costs an action' },
  { group: 'Combat', key: 'clashP', name: 'Clash (physical)', roll: ['Strength', 'Clash'], react: true, info: 'beat the attacker\'s accuracy to cancel it, otherwise both lose 1 HP. Once a round, costs an action' },
  { group: 'Combat', key: 'clashS', name: 'Clash (special)', roll: ['Special', 'Clash'], react: true, info: 'beat the attacker\'s accuracy to cancel it, otherwise both lose 1 HP. Once a round, costs an action' },
  { group: 'Combat', key: 'grapple', name: 'Grapple', roll: ['Dexterity', 'Clash'], info: 'a maneuver to hold or block a foe; the GM decides what happens' },
  { group: 'Combat', key: 'cover', name: 'Search for cover', roll: ['Insight', 'Alert'], info: 'find cover from attacks' },
  { group: 'Combat', key: 'run', name: 'Run away', roll: ['Dexterity', 'Athletic'], info: 'against the foe\'s Dexterity + Athletic' },
  { group: 'Combat', key: 'hold', name: 'Hold', info: 'waits to act later in the round' },
  { group: 'Combat', key: 'help', name: 'Help another', info: 'helps an ally: +1 die on their roll (+2 at most)' },
  { group: 'Explore', key: 'search', name: 'Search / notice clues', roll: ['Insight', 'Alert'] },
  { group: 'Explore', key: 'climb', name: 'Climb, cross, balance', roll: ['Dexterity', 'Athletic'] },
  { group: 'Explore', key: 'lift', name: 'Carry, lift, build', roll: ['Strength', 'Athletic'] },
  { group: 'Explore', key: 'sneak', name: 'Sneak / set an ambush', roll: ['Dexterity', 'Stealth'] },
  { group: 'Explore', key: 'watch', name: 'Endure / keep watch', roll: ['Vitality', 'Alert'] },
  { group: 'Explore', key: 'nature', name: 'Navigate / plants', roll: ['Insight', 'Nature'] },
  { group: 'Talk', key: 'persuade', name: 'Friendly persuasion', roll: ['Beauty', 'Allure'] },
  { group: 'Talk', key: 'comfort', name: 'Comforting appeal', roll: ['Cute', 'Allure'] },
  { group: 'Talk', key: 'polite', name: 'Respectful talk', roll: ['Clever', 'Etiquette'] },
  { group: 'Talk', key: 'inspire', name: 'Inspire / lead', roll: ['Cool', 'Etiquette'] },
  { group: 'Talk', key: 'distract', name: 'Entertain / distract', roll: ['Cool', 'Perform'] },
  { group: 'Talk', key: 'command', name: 'Command / intimidate', roll: ['Tough', 'Intimidate'] },
  { group: 'Talk', key: 'deceive', name: 'Deceive by acting', roll: ['Clever', 'Perform'] },
];
const poolOf = (f, a) => Math.max(1, a.roll.reduce((n, k) => n + (f.st?.attr?.[k] || 0), 0));
function renderActions() {
  const el = $('actList'); if (!el || $('actPanel').style.display === 'none') return;
  const f = actMini(); el.innerHTML = '';
  if (!f) return;
  $('actTitle').textContent = `🎯 Actions: ${f.name}`;
  let group = '';
  for (const a of ACTIONS) {
    if (a.group !== group) { group = a.group; const h = document.createElement('div'); h.className = 'actGroup'; h.textContent = group; el.appendChild(h); }
    const b = document.createElement('button'); b.className = 'fit chip';
    b.textContent = a.roll ? `${a.name} · ${poolOf(f, a)} 🎲` : a.name;
    b.title = (a.roll ? a.roll.join(' + ') : 'no roll') + (a.info ? ': ' + a.info : '');
    b.disabled = !!preview;
    b.onclick = () => { act({ t: 'action', id: f.id, key: a.key }); $('actPanel').style.display = 'none'; };
    el.appendChild(b);
  }
}

// ---------- the team's bag (Mystery Dungeon items; what they do is up to the GM) ----------
const ITEMS = { 'Oran Berry': 'restores some HP', 'Sitrus Berry': 'restores a lot of HP', 'Apple': 'fills the belly', 'Big Apple': 'fills the belly a lot',
  'Pecha Berry': 'cures Poison', 'Cheri Berry': 'cures Paralysis', 'Rawst Berry': 'cures Burn', 'Chesto Berry': 'cures Sleep', 'Aspear Berry': 'cures Frozen',
  'Heal Seed': 'cures every status', 'Reviver Seed': 'revives a fainted ally', 'Blast Seed': 'damages the foe in front', 'Sleep Seed': 'puts a foe to Sleep',
  'Escape Orb': 'the team escapes the dungeon', 'Gravelerock': 'thrown at a foe', 'Max Elixir': 'restores the moves\' PP' };
function pushBag() { renderBag(); sendAll({ t: 'bag', bag: state.bag }); save(); }
function renderBag() {
  const el = $('bagList'); if (!el) return;
  el.innerHTML = '';
  const items = Object.entries(state.bag || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (!items.length) { el.innerHTML = '<div style="color:var(--dim)">The bag is empty.</div>'; }
  const me = actMini();
  for (const [name, n] of items) {
    const d = document.createElement('div'); d.className = 'bagRow';
    const t = document.createElement('span'); t.textContent = `${name} ×${n}`; t.title = ITEMS[name] || '';
    const use = document.createElement('button'); use.className = 'fit primary'; use.textContent = 'Use';
    use.disabled = !me || !!preview; use.title = me ? `${me.name} uses it` : 'Pick your mini first';
    use.onclick = () => { const f = actMini(); if (f) act({ t: 'bagUse', id: f.id, name }); };
    const out = document.createElement('button'); out.className = 'fit'; out.textContent = '−'; out.title = 'Take one out (dropped or given away)';
    out.disabled = !!preview;
    out.onclick = () => act({ t: 'bagAdd', name, n: -1 });
    d.append(t, use, out); el.appendChild(d);
  }
  renderActBar();
}
// the mini the bottom bar acts for: your picked mini, else your first one
function actMini() {
  const sel = selectedId && state.figures[selectedId], me = viewerId();
  if (sel && (sel.owner === me || (gmView() && sel.owner))) return sel;
  return Object.values(state.figures).find(f => f.owner && f.owner === me) || null;
}
function renderActBar() {
  const bar = $('actBar'); if (!bar) return;
  const f = actMini();
  bar.style.display = f && !gmView() ? 'flex' : 'none';
  if (!f) return;
  const c = isHost && !gmView() ? combatView() : state.combat, P = state.party || { dash: {} };
  const myTurn = c && c.order[c.turn]?.id === f.id, dashed = c ? myTurn && c.dash : P.dash?.[f.id];
  $('actAttack').disabled = !!preview || (c && !myTurn);
  $('actDash').disabled = !!preview || (c && !myTurn);
  $('actDash').textContent = dashed ? '↩ Undo dash' : '💨 Dash';
  $('actAttack').title = c && !myTurn ? `Wait for ${f.name}'s turn` : `Pick who ${f.name} attacks`;
  const n = Object.values(state.bag || {}).reduce((a, b) => a + b, 0);
  $('actBag').textContent = `🎒 Bag${n ? ` (${n})` : ''}`;
  $('actMore').disabled = !!preview;
  const over = !c && P.done?.[f.id];
  $('actEnd').disabled = !!preview || (c && !myTurn);
  $('actEnd').textContent = over ? '↩ Not done' : '⏭ End turn';
  $('actEnd').title = c ? (myTurn ? `End ${f.name}'s turn` : `Wait for ${f.name}'s turn`) : over ? 'Take it back: you still want to move or act' : 'Done for this party turn: when every player is done, the next one starts';
  renderActions();
}

// ---------- random dungeon floors: rooms joined by corridors, walls round them, darkness beyond ----------
const FLOOR_LOOKS = {
  cave: { name: 'Cave', floor: 'dirt', wall: 'wall', props: ['rock'] },
  forest: { name: 'Forest', floor: 'grass', wall: 'hedge', props: ['tree'] },
  ice: { name: 'Ice', floor: 'ice', wall: 'wall', props: ['rock'] },
  ruins: { name: 'Ruins', floor: 'stone', wall: 'wall', props: ['rock'] },
  volcano: { name: 'Volcano', floor: 'cobble', wall: 'wall', props: ['rock'], pools: 'lava' },
  beach: { name: 'Beach cave', floor: 'sand', wall: 'wall', props: ['rock'], pools: 'water' },
};
const FLOOR_SIZES = { small: [20, 14], medium: [28, 20], large: [36, 26] };
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
function floorPlan(W, H) {
  const rooms = [], want = Math.max(3, Math.min(6, Math.round(W * H / 110)));  // fewer, bigger rooms (Adam)
  const wLo = Math.min(6, W - 4), hLo = Math.min(5, H - 4), wHi = Math.max(wLo, Math.min(11, Math.floor(W / 2.6))), hHi = Math.max(hLo, Math.min(9, Math.floor(H / 2.3)));
  for (let t = 0; t < 800 && rooms.length < want; t++) {
    const w = rint(wLo, wHi), h = rint(hLo, hHi);
    const x = rint(1, W - w - 1), y = rint(1, H - h - 1);
    if (rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
    rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
  }
  rooms.sort((a, b) => a.cx - b.cx || a.cy - b.cy);
  const open = new Set(), hall = new Set();
  for (const r of rooms) for (let i = r.x; i < r.x + r.w; i++) for (let j = r.y; j < r.y + r.h; j++) open.add(i + ',' + j);
  const dig = (a, b) => {                       // an L-shaped corridor between two room middles
    let x = a.cx, y = a.cy;
    const flip = Math.random() < 0.5, step = (k, to) => (k < to ? k + 1 : k - 1);
    const mark = () => { const k = x + ',' + y; if (!open.has(k)) { open.add(k); hall.add(k); } };
    for (const ax of flip ? ['x', 'y'] : ['y', 'x'])
      if (ax === 'x') while (x !== b.cx) { x = step(x, b.cx); mark(); } else while (y !== b.cy) { y = step(y, b.cy); mark(); }
  };
  for (let i = 1; i < rooms.length; i++) dig(rooms[i - 1], rooms[i]);
  if (rooms.length >= 4) dig(rooms[0], rooms[rint(2, rooms.length - 1)]);   // one loop, so it isn't a single line
  return { rooms, open, hall };
}
function makeFloor(b, D) {
  const look = FLOOR_LOOKS[D.look], live = layerOf(b) === (state.live || 1);
  if (D.size) {                                 // the board takes the chosen size
    const old = { ...b };
    [b.cols, b.rows] = FLOOR_SIZES[D.size];
    if (old.cols !== b.cols || old.rows !== b.rows) { dropTilesOutside(old); boardsChanged(true); }
  }
  if (b.hidden && live) { b.hidden = false; resyncPlayers(); }
  const W = b.cols, H = b.rows;
  if (W < 10 || H < 8) { note(state.gm, 'That board is too small for a floor: make it at least 10 x 8.'); return; }
  let plan;
  for (let t = 0; t < 20; t++) { plan = floorPlan(W, H); if (plan.rooms.length >= 3) break; }
  const { rooms, open, hall } = plan;
  if (rooms.length < 2) { note(state.gm, 'Could not fit rooms on that board: try a bigger size.'); return; }
  const set = {}, at = (i, j) => (b.x + i) + ',' + (b.z + j);
  for (const k of Object.keys(state.tiles)) { const [i, j] = k.split(',').map(Number); if (boardAt(i + 0.5, j + 0.5) === b) set[k] = null; }
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
    if (open.has(i + ',' + j)) { set[at(i, j)] = look.floor; continue; }
    let near = false;
    for (let di = -1; di <= 1 && !near; di++) for (let dj = -1; dj <= 1; dj++) if (open.has((i + di) + ',' + (j + dj))) { near = true; break; }
    set[at(i, j)] = near ? look.wall : 'pit';
  }
  // squares inside rooms, away from the walls, so nothing blocks a doorway
  const start = rooms[0], far = rooms.slice(1).sort((a, c) => Math.hypot(c.cx - start.cx, c.cy - start.cy) - Math.hypot(a.cx - start.cx, a.cy - start.cy))[0];
  const used = new Set();
  const inner = r => { const out = []; for (let i = r.x + 1; i < r.x + r.w - 1; i++) for (let j = r.y + 1; j < r.y + r.h - 1; j++) out.push([i, j]); return out; };
  const free = list => { const ok = list.filter(([i, j]) => !used.has(i + ',' + j)); if (!ok.length) return null; const c = pick(ok); used.add(c.join(',')); return c; };
  const tryFree = list => { for (let t = 0; t < 12; t++) { const c = free(list()); if (c) return c; } return null; };   // a full room: try another
  const others = rooms.filter(r => r !== start);
  const startCells = []; for (let i = start.x; i < start.x + start.w; i++) for (let j = start.y; j < start.y + start.h; j++) startCells.push([i, j]);
  for (const c of startCells) used.add(c.join(','));                   // the team's room stays clear
  const st = free(inner(far)) || [far.cx, far.cy];
  set[at(...st)] = 'stairs'; used.add(st.join(','));
  const put = (n, type, list) => { for (let k = 0; k < n; k++) { const c = tryFree(list); if (c) set[at(...c)] = type; } };
  put(D.items, 'chest', () => inner(pick(others)));
  put(D.events, 'event', () => inner(pick(others)));
  put(D.traps, 'hiddenTrap', () => (Math.random() < 0.4 && hall.size ? [...hall].map(k => k.split(',').map(Number)) : inner(pick(others))));
  put(rint(0, 2), pick(look.props), () => inner(pick(others)));
  if (look.pools) put(rint(1, 3), look.pools, () => inner(pick(others)));
  for (const [k, v] of Object.entries(set)) { if (v) state.tiles[k] = v; else delete state.tiles[k]; }
  // players only see the team's room at first: the rest stays dark until an ally gets there
  const F = state.fog ||= { hid: {}, rooms: [] }, base = F.rooms.length;   // other layers keep their own dark squares
  for (const k of Object.keys(F.hid)) { const [i, j] = k.split(',').map(Number); if (boardAt(i + 0.5, j + 0.5) === b) delete F.hid[k]; }
  for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
    const k = at(i, j);
    if (!set[k] || set[k] === 'pit') continue;
    const r = rooms.findIndex(r => i >= r.x && i < r.x + r.w && j >= r.y && j < r.y + r.h);
    F.hid[k] = r < 0 ? -1 : base + r;
  }
  F.rooms.push(...rooms.map(r => ({ x: b.x + r.x, z: b.z + r.y, w: r.w, h: r.h })));
  revealRoom(base + rooms.indexOf(start), {});
  D.start = F.rooms[base + rooms.indexOf(start)];
  tilesChanged(); sendTiles(set, false);
  // everything that isn't on the team leaves the board; the team stands together in the first room
  for (const f of Object.values(state.figures)) {
    if (boardAt(f.x, f.z) !== b || f.owner || sideOf(f) === 'player' || f.parent) continue;
    for (const c of Object.values(state.figures)) if (c.parent === f.id) { c.parent = null; pushFig(c); }
    delete state.figures[f.id]; removeFigMesh(f.id); sendAll({ t: 'del', id: f.id });
  }
  if (live) for (const f of placeTeam(D.start)) revealFog(f);
  // wild Pokémon in the other rooms
  const names = D.foes.split(',').map(x => x.trim()).filter(Boolean), foes = [];
  for (let k = 0; k < D.enemies; k++) {
    const c = tryFree(() => inner(pick(others)));
    if (!c) break;
    const id = rid(8), name = names.length ? pick(names) : 'Wild Pokémon';
    state.figures[id] = { id, name, color: '#e0503c', size: '1', w: 1, d: 1, owner: null, hidden: false, side: 'enemy', job: '', x: b.x + c[0] + 0.5, z: b.z + c[1] + 0.5 };
    pushFig(state.figures[id]); foes.push(id);
  }
  if (live) newFloorStart(D);
  else { addLog({ kind: 'sys', text: `Layer ${layerOf(b)}: ${D.name} B${D.floor}F is ready. The stairs on the team's layer lead here.`, to: state.gm }); renderLayers(); }
  save();
  if (foes.length && names.length) loadIndex().then(({ species }) => {   // names that match a Pokémon on the site get its stats (and model)
    for (const id of foes) {
      const f = state.figures[id], sp = f && species.find(x => x.name.toLowerCase() === f.name.toLowerCase());
      if (!sp) continue;
      handle({ t: 'species', id, name: sp.name, attr: sp.attr, hp: sp.hp, types: sp.types, moves: sp.moves }, state.gm);
      const bi = Object.keys(BUILTIN).find(k => BUILTIN[k].species === sp.name);
      if (bi) useBuiltin(bi, id);
    }
  });
}

// the team stands together in the middle of a rectangle of squares (a floor's first room, or a layer's board)
function placeTeam(S) {
  const team = Object.values(state.figures).filter(f => (f.owner || sideOf(f) === 'player') && !f.parent);
  const cx = S.x + S.w / 2, cz = S.z + S.h / 2, spots = [];
  for (let i = S.x; i < S.x + S.w; i++) for (let j = S.z; j < S.z + S.h; j++) if (!BLOCKS_MOVE.has(state.tiles[i + ',' + j])) spots.push([i, j]);
  if (!spots.length) spots.push([Math.floor(cx), Math.floor(cz)]);
  spots.sort((a, c) => Math.hypot(a[0] + 0.5 - cx, a[1] + 0.5 - cz) - Math.hypot(c[0] + 0.5 - cx, c[1] + 0.5 - cz));
  team.forEach((f, n) => {
    const c = spots[n % spots.length], k = fp(f), x = c[0] + (k.w % 2 ? 0.5 : 1), z = c[1] + (k.d % 2 ? 0.5 : 1);
    const dx = x - f.x, dz = z - f.z;
    f.x = x; f.z = z; pushFig(f); carry(f.id, dx, dz);
  });
  return team;
}
// a fresh start on a floor: no fight, a new party turn, the banner for everyone
function newFloorStart(D) {
  if (state.combat) { state.combat = null; pushCombat(); }
  state.party = { turn: state.party.turn + 1, from: {}, dash: {} }; pushParty();
  state.areas = {}; pushAreas();
  if (D) addLog({ kind: 'sys', text: `${D.name} B${D.floor}F` });
  sendAll({ t: 'dungeon', dungeon: state.dungeon, fresh: !!D }); renderFloor(!!D);
}
// GM (or the stairs): the team moves to layer L. Players now see only that layer; a random floor waiting there starts.
function goLive(L) {
  const boards = state.boards.filter(b => layerOf(b) === L);
  if (!boards.length) return;
  state.live = L;
  const P = state.prep?.[L];
  if (P) delete state.prep[L];
  const b = (P && boards.find(x => x.id === P.board)) || boards[0];
  state.dungeon = P && P.start && b.id === P.board ? P : null;
  gmLayer = L; selBoard = b.id;
  const team = placeTeam(state.dungeon ? state.dungeon.start : { x: b.x, z: b.z, w: b.cols, h: b.rows });
  buildBoard(); tilesChanged(); syncFigures(); updateBoardInputs(); renderLayers();
  resyncPlayers();
  for (const f of team) revealFog(f);
  newFloorStart(state.dungeon);
  if (!state.dungeon) frameBoard();
  save();
}
// GM: look at another layer (players don't notice)
function viewLayer(L) {
  gmLayer = L;
  const b = state.boards.find(x => layerOf(x) === L);
  if (b) selBoard = b.id;
  buildBoard(); tilesChanged(); syncFigures(); updateBoardInputs(); renderLayers(); frameBoard();
}
function renderLayers() {
  const sel = $('layerPick');
  if (!isHost || !sel) return;
  const n = Math.max(1, ...state.boards.map(layerOf));
  sel.innerHTML = '';
  for (let L = 1; L <= n; L++) {
    const o = document.createElement('option'), P = state.prep?.[L], D = state.dungeon;
    o.value = L;
    o.textContent = `Layer ${L}` + (L === (state.live || 1) ? ' · the team is here' + (D ? ` (B${D.floor}F)` : '') : '') + (P ? ` · ${P.name} B${P.floor}F ready` : '') +
      (state.boards.some(b => layerOf(b) === L) ? '' : ' · empty');
    sel.appendChild(o);
  }
  sel.value = gmLayer;
  $('layerLive').disabled = gmLayer === (state.live || 1);
}

// ---------- rules helpers (host) ----------
// is this mini standing next to square "i,j" (sides or corners), not on it?
function nextToCell(f, key) {
  const [ci, cj] = key.split(',').map(Number), c = fp(f);
  const cells = cellsOf(f.x, f.z, c.w, c.d);
  if (cells.some(([i, j]) => i === ci && j === cj)) return false;
  return cells.some(([i, j]) => Math.abs(i - ci) <= 1 && Math.abs(j - cj) <= 1);
}
// enemy, NPC or player (older minis: a player's if someone controls it, else an enemy)
const SIDES = { enemy: { name: 'Enemy', color: '#e0503c' }, npc: { name: 'NPC', color: '#4aa3e0' }, player: { name: 'Player', color: '#46c46a' } };
const sideOf = f => (SIDES[f?.side] ? f.side : f?.owner ? 'player' : 'enemy');
// standing next to another mini (touching, diagonals count)
function nextToFig(a, b) {
  const ca = fp(a), cb = fp(b), B = cellsOf(b.x, b.z, cb.w, cb.d);
  return cellsOf(a.x, a.z, ca.w, ca.d).some(([i, j]) => B.some(([p, q]) => Math.max(Math.abs(i - p), Math.abs(j - q)) === 1));
}
// in a fight: every player's mini, and GM minis once they have a Dexterity (NPCs stay out unless the GM adds them)
const fights = x => sideOf(x) !== 'npc' && (!!x.owner || (x.st && x.st.dex != null));
function rollInit(x) {
  const st = x.st || {}, roll = rollDie(6), sts = st.status || [];
  return { id: x.id, roll, init: roll + (st.dex || 0) + (st.alert || 0), speed: sts.includes('Sped Up') ? 1 : sts.includes('Slowed') ? -1 : 0, dex: st.dex || 0, tie: Math.random() };
}
const initOrder = (a, b) => (b.speed || 0) - (a.speed || 0) || b.init - a.init || (b.dex || 0) - (a.dex || 0) || (b.tie || 0) - (a.tie || 0);
// someone joins a fight already going: roll for them and slot them in by initiative
function joinCombat(x) {
  const c = state.combat;
  if (!c || c.order.some(o => o.id === x.id)) return;
  const curId = c.order[c.turn]?.id, o = rollInit(x);
  c.order.push(o);
  c.order.sort(initOrder);
  c.turn = c.order.findIndex(e => e.id === curId);
  if (figVisible(x)) addLog({ kind: 'sys', text: `${x.name} joins the fight (initiative ${o.init}).` });
  pushCombat();
}
function note(to, text) {
  if (to === state.gm) { status(text); setTimeout(() => status(''), 4000); }
  else sendAll({ t: 'note', text }, cid => cid === to);
}
const ownMove = f => (f.st?.status || []).includes('Immobilized') ? 0 : (f.st?.move ?? (2 + (f.st?.dex || 0)));
// minis attached to each other (riders, what they ride, and so on) all move at the slowest one's speed;
// minis with 0 movement or no speed set (no Dexterity or Move) don't count
function attachedGroup(f) {
  const ids = new Set([f.id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const o of Object.values(state.figures)) {
      if (ids.has(o.id)) { if (o.parent && state.figures[o.parent] && !ids.has(o.parent)) { ids.add(o.parent); changed = true; } }
      else if (o.parent && ids.has(o.parent)) { ids.add(o.id); changed = true; }
    }
  }
  return [...ids].map(id => state.figures[id]);
}
function moveBudget(f) {
  const speeds = attachedGroup(f).filter(o => o.st?.move != null || o.st?.dex != null).map(ownMove).filter(v => v > 0);
  return speeds.length ? Math.min(...speeds) : ownMove(f);
}
// the grid as one mini sees it: other minis' squares are taken (not its own, nor pieces riding on it)
const isSmall = f => f.size === '0.7' && fp(f).w === 1 && fp(f).d === 1;
// the grid as one mini sees it. A square is taken by any other mini, except that two Smalls may share one.
// Its own pieces (riders, or what it rides on) never get in the way.
function worldFor(f) {
  const riders = new Set();
  for (let changed = true; changed;) {
    changed = false;
    for (const o of Object.values(state.figures)) if (!riders.has(o.id) && (o.parent === f.id || riders.has(o.parent))) { riders.add(o.id); changed = true; }
  }
  const full = new Set(), smalls = new Map();
  for (const o of Object.values(state.figures)) {
    if (o.id === f.id || riders.has(o.id) || o.id === f.parent) continue;
    const c = fp(o);
    for (const [i, j] of cellsOf(o.x, o.z, c.w, c.d)) {
      const k = i + ',' + j;
      if (isSmall(o)) smalls.set(k, (smalls.get(k) || 0) + 1); else full.add(k);
    }
  }
  const mine = isSmall(f);
  const occupied = (i, j) => { const k = i + ',' + j; return full.has(k) || (smalls.get(k) || 0) >= (mine ? 2 : 1); };
  const seen = f.owner ? state.boards.filter(shown) : state.boards;   // allies' paths stay on what they can see
  return { onBoard: (i, j) => !!boardAt(i + 0.5, j + 0.5, seen), tile: (i, j) => state.tiles[i + ',' + j], occupied, wall: edgeWall };
}
function nextPartyTurn() {
  state.party = { turn: state.party.turn + 1, from: {}, dash: {}, done: {} };
  addLog({ kind: 'sys', text: `Party turn ${state.party.turn}: everyone can move and act again.` });
  countDown(); clearAreas();
  pushParty();
}
function pushParty() { renderActBar(); renderParty(); sendAll({ t: 'party', party: state.party }); save(); figsVersion++; }
function pushCombat() { renderActBar(); renderCombat(); renderParty(); showSelected(); sendAll({ t: 'combat', combat: combatView() }); save(); figsVersion++; }
function pushRules() { renderRules(); sendAll({ t: 'rules', rules: state.rules, explored: state.explored }); save(); figsVersion++; }
// a hidden board comes into view; every 2 new ones the GM is reminded to roll the dungeon event
function revealBoard(b) {
  if (!b.hidden) return;
  b.hidden = false;
  if (!b.explored) {
    b.explored = true; state.explored++;
    addLog({ kind: 'sys', text: `A new area is revealed (${state.explored} explored).` });
  }
  buildBoard(); updateBoardInputs(); resyncPlayers(); pushRules(); save();
}

// an ally standing right next to an open square of a hidden area (not diagonally, not a wall) reveals that area,
// so a room walled all round with one gap or Door has a one-square entrance
function revealNextTo(f) {
  const { w, d } = fp(f);
  let any = false;
  for (const [i, j] of cellsOf(f.x, f.z, w, d)) {
    for (const [a, c] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      const b = boardAt(a + 0.5, c + 0.5);
      if (b?.hidden && !BLOCKS_MOVE.has(state.tiles[a + ',' + c]) && !edgeWall(i, j, a, c)) { revealBoard(b); any = true; }
    }
  }
  return any;
}

// an ally lights up the corridor squares within 2 of it; stepping into (or next to) a room shows the whole room and its walls
function revealRoom(n, set) {
  const F = state.fog, R = F.rooms[n];
  for (let i = R.x - 1; i <= R.x + R.w; i++) for (let j = R.z - 1; j <= R.z + R.h; j++) {
    const k = i + ',' + j;
    if (F.hid[k] != null) { delete F.hid[k]; set[k] = state.tiles[k] || null; }
  }
}
function revealFog(f) {
  const F = state.fog;
  if (!F) return false;
  const { w, d } = fp(f), set = {};
  for (const [i, j] of cellsOf(f.x, f.z, w, d)) {
    for (const [a, c] of [[i, j], [i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { const r = F.hid[a + ',' + c]; if (r >= 0) revealRoom(r, set); }
    for (let a = i - 2; a <= i + 2; a++) for (let c = j - 2; c <= j + 2; c++) {
      const k = a + ',' + c;
      if (F.hid[k] === -1) { delete F.hid[k]; set[k] = state.tiles[k] || null; }
    }
  }
  if (!Object.keys(set).length) return false;
  if (!Object.keys(F.hid).length) state.fog = null;
  tilesChanged(); sendTiles(set);
  for (const g of Object.values(state.figures)) if ((Math.floor(g.x) + ',' + Math.floor(g.z)) in set) pushFig(g);
  if (state.combat) pushCombat();
  save();
  return true;
}

function turnOne(f, deg) {
  const c = fp(f);
  f.rot = ((f.rot || 0) + deg) % 360;
  if (deg % 180 === 90 && c.w !== c.d) { f.w = c.d; f.d = c.w; }
}

// host: pieces attached to this one go along when it moves (dx, dz) or turns (deg, around the parent's middle)
function carry(id, dx, dz, deg, around) {
  if (!dx && !dz && !deg) return;
  const a = -deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  for (const c of Object.values(state.figures)) {
    if (c.parent !== id) continue;
    if (deg) {
      // turn around the parent, keeping the same number of squares away, then land on a square
      const ox = c.x - around.x, oz = c.z - around.z, r = Math.max(Math.abs(ox), Math.abs(oz));
      let nx = ox * cos - oz * sin, nz = ox * sin + oz * cos;
      const m = Math.max(Math.abs(nx), Math.abs(nz));
      if (m > 1e-6) { nx *= r / m; nz *= r / m; }
      c.x = around.x + nx; c.z = around.z + nz;
      turnOne(c, deg);
    } else { c.x += dx; c.z += dz; }
    const k = fp(c);
    Object.assign(c, deg ? snapPos(c.x, c.z, k.w, k.d) : clampPos(c.x, c.z, k.w, k.d));
    pushFig(c);
    carry(c.id, dx, dz, deg, around);
  }
}

function pushFig(f, skipFor, live) {
  upsertFig(f, live);
  if (!figVisible(f)) sendAll({ t: 'del', id: f.id });
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
    const s = { ...state, players: {}, maps: {} };
    for (const [k, p] of Object.entries(state.players)) s.players[k] = { ...p, online: false };
    store.set('tabletop.host', { code: roomCode, state: s });
  }, 400);
}

// =====================================================================
// Board maths (positions are board units: one square = 1)
// =====================================================================
const boardAt = (x, z, boards = state.boards) => boards.find(b => x >= b.x && x <= b.x + b.cols && z >= b.z && z <= b.z + b.rows);
// ---------- low walls round each board's edge ----------
// Where two boards join, the wall has a one-square gap at the middle of the shared edge.
const edgeWallsOn = () => state.rules.edgeWalls !== false;
const edgeKey = (i, j, ni, nj) => (i < ni || (i === ni && j < nj)) ? `${i},${j}|${ni},${nj}` : `${ni},${nj}|${i},${j}`;
// host: work out each board's gaps (the players' copy of a board carries them, even towards areas they can't see yet)
function computeGaps() {
  for (const b of state.boards) b.gaps = [];
  const B = state.boards;
  for (let p = 0; p < B.length; p++) for (let q = p + 1; q < B.length; q++) {
    const a = B[p], b = B[q];
    let k = null;
    for (const [l, r] of [[a, b], [b, a]]) {
      if (l.x + l.cols === r.x) {                 // side by side: shared edge runs along z
        const lo = Math.max(l.z, r.z), hi = Math.min(l.z + l.rows, r.z + r.rows), j = lo + Math.floor((hi - lo - 1) / 2);
        if (hi > lo) k = edgeKey(r.x - 1, j, r.x, j);
      }
      if (l.z + l.rows === r.z) {                 // one above the other: shared edge runs along x
        const lo = Math.max(l.x, r.x), hi = Math.min(l.x + l.cols, r.x + r.cols), i = lo + Math.floor((hi - lo - 1) / 2);
        if (hi > lo) k = edgeKey(i, r.z - 1, i, r.z);
      }
    }
    if (k) { a.gaps.push(k); b.gaps.push(k); }
  }
}
// is there a board-edge wall between neighbouring squares i,j and ni,nj?
function edgeWall(i, j, ni, nj) {
  if (!edgeWallsOn()) return false;
  const a = boardAt(i + 0.5, j + 0.5), b = boardAt(ni + 0.5, nj + 0.5);
  if (a === b || (!a && !b)) return false;
  const k = edgeKey(i, j, ni, nj);
  return !(a?.gaps || []).includes(k) && !(b?.gaps || []).includes(k);
}
function boardsBox(L) {
  const want = L ?? (!isHost ? null : gmView() ? gmLayer : state.live || 1);
  let B = want == null ? state.boards : state.boards.filter(b => layerOf(b) === want);
  if (!B.length) B = state.boards;
  return { x0: Math.min(...B.map(b => b.x)), z0: Math.min(...B.map(b => b.z)), x1: Math.max(...B.map(b => b.x + b.cols)), z1: Math.max(...B.map(b => b.z + b.rows)) };
}
// a piece w squares wide has its middle on a square's middle (odd) or on a grid line (even)
const gridSnap = (v, cells) => cells % 2 ? Math.floor(v) + 0.5 : Math.round(v);
function snapPos(x, z, w = 1, d = 1, boards = state.boards) {
  const p = clampPos(x, z, w, d, boards);
  if (!snapOn()) return p;
  return clampPos(gridSnap(p.x, w), gridSnap(p.z, d), w, d, boards);
}
// keep a piece on the boards: its middle must be on one; if it's off them all, pull it onto the nearest
function clampPos(x, z, w = 1, d = 1, boards = state.boards) {
  if (boardAt(x, z, boards)) return { x, z };
  let best = null, bd = Infinity;
  for (const b of boards.length ? boards : state.boards) {
    const hw = Math.min(w, b.cols) / 2, hd = Math.min(d, b.rows) / 2;
    const cx = Math.max(b.x + hw, Math.min(b.x + b.cols - hw, x)), cz = Math.max(b.z + hd, Math.min(b.z + b.rows - hd, z));
    const dist = (cx - x) ** 2 + (cz - z) ** 2;
    if (dist < bd) { bd = dist; best = { x: cx, z: cz }; }
  }
  return best;
}
// nearest square where a new mini doesn't stand on another one
function freeSpot(x, z, w = 1, d = 1) {
  const start = snapPos(x, z, w, d);
  const clear = p => Object.values(state.figures).every(f => {
    const c = fp(f);
    return Math.abs(f.x - p.x) > (c.w + w) / 2 - 0.01 || Math.abs(f.z - p.z) > (c.d + d) / 2 - 0.01;
  });
  for (let ring = 0; ring < 40; ring++)
    for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
      const p = snapPos(start.x + i, start.z + j, w, d);
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
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = false;          // pan across the table, not up into the air

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

const mapTextures = new Map();                  // board id -> texture of its map picture
function buildBoard() {
  if (isHost) computeGaps();
  if (!boardGroup) return;
  figsVersion++;
  for (const o of boardGroup.children) { o.geometry?.dispose(); if (o.material && !o.material.map) o.material.dispose(); }
  boardGroup.clear();
  const slabMat = new THREE.MeshStandardMaterial({ color: '#3b2a1c', roughness: 0.8 });
  for (const b of state.boards) {
    if (isHost && (gmView() ? !gmSees(b) : !shown(b))) continue;
    const { cols, rows, grid } = b, cx = b.x + cols / 2, cz = b.z + rows / 2;
    const mat = new THREE.MeshStandardMaterial({ color: '#4d5b47', roughness: 0.95 });
    if (b.hidden) { mat.transparent = true; mat.opacity = 0.45; }
    const src = state.maps[b.id];
    if (src) {
      let tex = mapTextures.get(b.id);
      if (tex?.userData.src !== src) {
        tex?.dispose();
        tex = new THREE.TextureLoader().load(src);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        tex.userData.src = src;
        mapTextures.set(b.id, tex);
      }
      mat.map = tex; mat.color.set('#ffffff');
    }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(cols, rows), mat);
    top.rotation.x = -Math.PI / 2; top.position.set(cx, 0, cz); top.receiveShadow = true;
    top.userData.board = b.id;
    boardGroup.add(top);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(cols + 0.3, 0.5, rows + 0.3), slabMat);
    slab.position.set(cx, -0.26, cz); slab.receiveShadow = true;
    boardGroup.add(slab);
    if (grid) {
      const pts = [];
      for (let i = 0; i <= cols; i++) pts.push(b.x + i, 0, b.z, b.x + i, 0, b.z + rows);
      for (let j = 0; j <= rows; j++) pts.push(b.x, 0, b.z + j, b.x + cols, 0, b.z + j);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 }));
      lines.position.y = 0.003;
      boardGroup.add(lines);
    }
    if (gmView() && b.id === selBoard && state.boards.length > 1) {      // outline the board being edited
      const o = frame(cols + 0.3, rows + 0.3, 0.12, '#e0a64b', 0.9);
      o.position.set(cx, 0.006, cz);
      boardGroup.add(o);
    }
  }
  if (edgeWallsOn()) {                          // the low edge walls: one short block per square of edge
    const segs = new Map();
    for (const b of state.boards) {
      if (isHost && (gmView() ? !gmSees(b) : !shown(b))) continue;
      const add = (i, j, ni, nj, x, z, along) => { if (edgeWall(i, j, ni, nj)) segs.set(edgeKey(i, j, ni, nj), { x, z, along }); };
      for (let i = b.x; i < b.x + b.cols; i++) { add(i, b.z - 1, i, b.z, i + 0.5, b.z, 'x'); add(i, b.z + b.rows - 1, i, b.z + b.rows, i + 0.5, b.z + b.rows, 'x'); }
      for (let j = b.z; j < b.z + b.rows; j++) { add(b.x - 1, j, b.x, j, b.x, j + 0.5, 'z'); add(b.x + b.cols - 1, j, b.x + b.cols, j, b.x + b.cols, j + 0.5, 'z'); }
    }
    if (segs.size) {
      const H = 0.45 / 4, T = 0.14;
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, H, T), new THREE.MeshStandardMaterial({ color: '#7a756e', roughness: 0.9 }), segs.size);
      const o = new THREE.Object3D();
      let n = 0;
      for (const s of segs.values()) {
        o.position.set(s.x, H / 2, s.z); o.rotation.set(0, s.along === 'z' ? Math.PI / 2 : 0, 0); o.updateMatrix();
        m.setMatrixAt(n++, o.matrix);
      }
      m.castShadow = m.receiveShadow = true;
      boardGroup.add(m);
    }
  }
  for (const id of [...mapTextures.keys()]) if (!state.maps[id]) { mapTextures.get(id).dispose(); mapTextures.delete(id); }
  const box = boardsBox(), sun = scene.userData.sun, r = Math.max(box.x1 - box.x0, box.z1 - box.z0) * 0.75 + 4;
  sun.position.set((box.x0 + box.x1) / 2 - 8, 20, (box.z0 + box.z1) / 2 + 10);
  sun.target.position.set((box.x0 + box.x1) / 2, 0, (box.z0 + box.z1) / 2); sun.target.updateMatrixWorld();
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
  if (!buildBoard.framed) { frameBoard(); buildBoard.framed = true; }
}

// ---------- terrain tiles ----------
let tileGroup = null, tilesDirty = false;
const tileKit = {};                             // type -> { geo, mat }
function tileTexture(t) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), base = new THREE.Color(t.color);
  g.fillStyle = t.color; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 260; i++) {               // speckles so flat colours don't look plastic
    const k = 0.82 + Math.random() * 0.3, col = base.clone().multiplyScalar(k);
    g.fillStyle = '#' + col.getHexString(); g.fillRect(Math.random() * 64, Math.random() * 64, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
  if (t.seams) { g.strokeRect(1, 1, 62, 62); g.beginPath(); g.moveTo(0, 32); g.lineTo(64, 32); g.moveTo(32, 0); g.lineTo(32, 32); g.moveTo(16, 32); g.lineTo(16, 64); g.moveTo(48, 32); g.lineTo(48, 64); g.stroke(); }
  if (t.planks) { g.beginPath(); for (const y of [0, 16, 32, 48]) { g.moveTo(0, y); g.lineTo(64, y); } g.stroke(); }
  if (t.cobble) for (let y = 0; y < 64; y += 16) for (let x = (y / 16 % 2) * 8; x < 72; x += 16) { g.beginPath(); g.ellipse(x, y + 8, 7, 6, 0, 0, 7); g.stroke(); }
  if (t.checker) { g.fillStyle = 'rgba(30,30,34,0.85)'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32); }
  if (t.rug) { g.strokeStyle = '#d8b25a'; g.lineWidth = 3; g.strokeRect(5, 5, 54, 54); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const LOOKS = { trunk: { color: '#5a3d22', planks: true }, metal: { color: '#4a4d52', seams: true }, spike: { color: '#b9bdc4', shiny: true },
  gold: { color: '#d8a83a', shiny: true }, pole: { color: '#5a3d22' }, flame: { color: '#ff8a1e', fire: true },
  crystal: { color: '#5fe0ff', crystal: true }, paper: { color: '#e8d9a8' } };
function kit(type) {
  if (!tileKit[type]) {
    const t = TILES[type] || LOOKS[type];
    const mat = new THREE.MeshStandardMaterial({ map: tileTexture(t), roughness: t.water || t.shiny ? 0.15 : 0.9 });
    if (t.water) { mat.transparent = true; mat.opacity = 0.85; mat.metalness = 0.1; }
    if (t.piece === 'event') { mat.emissive = new THREE.Color('#ffb000'); mat.emissiveIntensity = 0.9; }
    if (t.fire) { mat.emissive = new THREE.Color('#ff6a00'); mat.emissiveIntensity = 1.2; }
    if (t.crystal) { mat.emissive = new THREE.Color('#2fb8e0'); mat.emissiveIntensity = 0.8; mat.transparent = true; mat.opacity = 0.85; }
    if (t.piece === 'hiddenTrap') { mat.transparent = true; mat.opacity = 0.55; }
    if (t.glow) { mat.emissive = new THREE.Color('#ff5a1a'); mat.emissiveIntensity = 0.8; mat.emissiveMap = mat.map; }
    tileKit[type] = { geo: new THREE.BoxGeometry(1, t.h || 0.05, 1), mat };
  }
  return tileKit[type];
}
function tilesChanged() { tilesDirty = true; tilesVersion++; }
function buildTiles() {
  tilesDirty = false;
  if (!tileGroup) { tileGroup = new THREE.Group(); scene.add(tileGroup); }
  for (const m of tileGroup.children) m.dispose?.();
  tileGroup.clear();
  const byType = {}, parts = new Map();
  const mtx = new THREE.Matrix4();
  const D = state.dungeon, under = D && FLOOR_LOOKS[D.look]?.floor, db = D && state.boards.find(b => b.id === D.board);
  for (const [k, t] of Object.entries(state.tiles)) {
    if (isHost && gmView()) { const [i, j] = k.split(',').map(Number); if (!gmSees(boardAt(i + 0.5, j + 0.5))) continue; }
    // on a random floor, props / events / hidden traps stand on the floor (so a hidden trap's square looks like any other)
    if (under && TILES[t].piece && !TILES[t].link) { const [i, j] = k.split(',').map(Number); if (boardAt(i + 0.5, j + 0.5) === db) (byType[under] ||= []).push(k); }
    if (isHost && !gmView() && !tileVisible(k)) continue;
    if (!TILES[t].piece) { (byType[t] ||= []).push(k); continue; }
    const [i, j] = k.split(',').map(Number);
    const near = (di, dj) => linked(t, state.tiles[(i + di) + ',' + (j + dj)]);
    piecesFor(t, i + 0.5, j + 0.5, { n: near(0, -1), s: near(0, 1), e: near(1, 0), w: near(-1, 0) }, i * 7919 + j * 104729,
      (shape, look, m) => { const key = shape + '|' + look; if (!parts.has(key)) parts.set(key, []); parts.get(key).push(m.clone()); });
  }
  for (const [type, keys] of Object.entries(byType)) {
    const { geo, mat } = kit(type), h = TILES[type].h;
    const im = new THREE.InstancedMesh(geo, mat, keys.length);
    keys.forEach((k, n) => { const [i, j] = k.split(',').map(Number); im.setMatrixAt(n, mtx.makeTranslation(i + 0.5, h / 2 + 0.001, j + 0.5)); });
    im.castShadow = h > 0.2; im.receiveShadow = true;
    tileGroup.add(im);
  }
  for (const [key, list] of parts) {
    const [shape, look] = key.split('|');
    const im = new THREE.InstancedMesh(SHAPES[shape], kit(look).mat, list.length);
    list.forEach((m, n) => im.setMatrixAt(n, m));
    im.castShadow = true; im.receiveShadow = true;
    tileGroup.add(im);
  }
  const SIGNS = { event: ['?', '#ff2b2b', '#ffd23f'], clue: ['!', '#e8d9a8', '#ffffff'], goal: ['★', '#5fe0ff', '#ffffff'] };
  for (const [k, t] of Object.entries(state.tiles)) {             // floating signs over event squares
    if (!SIGNS[t] || (isHost && !gmView() && !tileVisible(k))) continue;
    if (isHost && gmView() && !gmSees(boardAt(+k.split(',')[0] + 0.5, +k.split(',')[1] + 0.5))) continue;
    const [i, j] = k.split(',').map(Number);
    const q = new THREE.Sprite(signMat(...SIGNS[t])); q.position.set(i + 0.5, t === 'goal' ? 1.45 : 0.75, j + 0.5); q.scale.set(0.6, 0.6, 1);
    q.userData.bob = t === 'goal' ? 1.45 : 0.75;
    tileGroup.add(q);
  }
  for (const g of figMeshes.values()) { const f = state.figures[g.userData.id]; if (f) upsertFig(f, true); }
}
const signMats = new Map();
// round sign: a character in a coloured ring (the ? is a yellow ? in a red ring)
function signMat(ch, ring, fill) {
  const key = ch + ring + fill;
  if (signMats.has(key)) return signMats.get(key);
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(30,22,0,0.75)'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill();
  g.strokeStyle = ring; g.lineWidth = 6; g.stroke();
  g.fillStyle = fill; g.font = 'bold 84px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, 64, 70);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.SpriteMaterial({ map: tex, depthWrite: false });
  signMats.set(key, m);
  return m;
}
// unit shapes, stretched into place for each part of a piece
const SHAPES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  post: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
  cone: new THREE.ConeGeometry(0.5, 1, 9),
  rock: new THREE.DodecahedronGeometry(0.5, 0),
  tent: new THREE.ConeGeometry(0.5, 1, 4),
};
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler();
// rot turns around the up axis; tilt leans it over (logs lying down, an open lid)
const place = (x, y, z, sx, sy, sz, rot = 0, tilt = 0) => new THREE.Matrix4().compose(_p.set(x, y, z),
  tilt ? _q.setFromEuler(_e.set(tilt, rot, 0, 'YXZ')) : _q.setFromAxisAngle(_y, rot), _s.set(sx, sy, sz));

// the parts of one connecting piece / prop. links = which neighbours it joins (n s e w). put(shape, look, matrix)
function piecesFor(type, x, z, links, seed, put) {
  const t = TILES[type], arms = [['n', 0, -1], ['s', 0, 1], ['e', 1, 0], ['w', -1, 0]].filter(a => links[a[0]]);
  const rand = k => { const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  switch (t.piece) {
    case 'thin': {                              // a pillar in the middle with an arm out to each joined neighbour
      const th = t.thick;
      put('box', type, place(x, t.h / 2, z, th + 0.04, t.h, th + 0.04));
      for (const [, dx, dz] of arms) put('box', type, place(x + dx * 0.25, t.h / 2, z + dz * 0.25, dx ? 0.5 : th, t.h, dz ? 0.5 : th));
      break;
    }
    case 'fence': {
      put('post', 'fence', place(x, 0.35, z, 0.12, 0.7, 0.12));
      for (const [, dx, dz] of arms) for (const y of [0.3, 0.58])
        put('box', 'fence', place(x + dx * 0.25, y, z + dz * 0.25, dx ? 0.5 : 0.05, 0.06, dz ? 0.5 : 0.05));
      break;
    }
    case 'door': {                              // sits in a wall line: runs east-west unless the wall comes from north/south
      const ew = links.e || links.w || !(links.n || links.s);
      const at = (ox, oy, sx, sy, sz, look) => put('box', look, place(x + (ew ? ox : 0), oy, z + (ew ? 0 : ox), ew ? sx : sz, sy, ew ? sz : sx));
      at(-0.4, 0.5, 0.2, 1.0, 0.3, 'thin'); at(0.4, 0.5, 0.2, 1.0, 0.3, 'thin');
      at(0, 0.9, 0.6, 0.2, 0.3, 'thin');
      at(0, 0.4, 0.58, 0.8, 0.08, 'wood');
      break;
    }
    case 'strip': {                             // road / river: a band that runs on to each joined neighbour
      const wd = t.width;
      put('box', type, place(x, t.h / 2, z, wd, t.h, wd));
      for (const [, dx, dz] of arms) put('box', type, place(x + dx * (0.25 + wd / 4), t.h / 2, z + dz * (0.25 + wd / 4), dx ? 0.5 - wd / 2 + 0.001 : wd, t.h, dz ? 0.5 - wd / 2 + 0.001 : wd));
      break;
    }
    case 'bridge': {                            // river underneath, planks across it, rails on the sides
      piecesFor('river', x, z, links, seed, put);
      const along = links.e || links.w;         // river flows east-west, so the bridge crosses north-south
      put('box', 'bridge', place(x, 0.12, z, along ? 0.8 : 1.0, 0.08, along ? 1.0 : 0.8));
      for (const side of [-0.42, 0.42])
        put('box', 'bridge', place(x + (along ? side : 0), 0.32, z + (along ? 0 : side), along ? 0.06 : 1.0, 0.06, along ? 1.0 : 0.06));
      break;
    }
    case 'tree': {
      const k = 0.85 + rand(1) * 0.35, ox = (rand(2) - 0.5) * 0.2, oz = (rand(3) - 0.5) * 0.2;
      put('post', 'trunk', place(x + ox, 0.25 * k, z + oz, 0.18 * k, 0.5 * k, 0.18 * k));
      put('cone', 'tree', place(x + ox, 0.85 * k, z + oz, 0.85 * k, 0.9 * k, 0.85 * k, rand(4) * 6));
      put('cone', 'tree', place(x + ox, 1.25 * k, z + oz, 0.6 * k, 0.65 * k, 0.6 * k, rand(5) * 6));
      break;
    }
    case 'event':                               // a glowing disc; the floating "?" is a sprite (see buildTiles)
      put('post', 'event', place(x, 0.02, z, 0.7, 0.04, 0.7));
      break;
    case 'hiddenTrap':                          // only the GM sees this: a faint red cross
      put('box', 'hiddenTrap', place(x, 0.015, z, 0.85, 0.02, 0.12, Math.PI / 4));
      put('box', 'hiddenTrap', place(x, 0.015, z, 0.85, 0.02, 0.12, -Math.PI / 4));
      break;
    case 'trap':                                // a sprung spike plate
      put('box', 'metal', place(x, 0.02, z, 0.82, 0.04, 0.82));
      for (const [dx, dz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2], [0, 0]])
        put('cone', 'spike', place(x + dx, 0.14, z + dz, 0.12, 0.22, 0.12));
      break;
    case 'camp':                                // a red tent and a banner
      put('tent', 'camp', place(x - 0.05, 0.36, z, 0.85, 0.72, 0.85, Math.PI / 4));
      put('post', 'pole', place(x + 0.36, 0.45, z - 0.3, 0.05, 0.9, 0.05));
      put('box', 'camp', place(x + 0.24, 0.75, z - 0.3, 0.24, 0.2, 0.02));
      break;
    case 'chest': {                             // wooden chest with gold bands; open = lid standing up at the back
      put('box', 'chest', place(x, 0.17, z, 0.62, 0.3, 0.42));
      put('box', 'gold', place(x, 0.17, z, 0.64, 0.06, 0.44));
      if (t.open) put('box', 'chest', place(x, 0.42, z - 0.2, 0.62, 0.24, 0.05, 0, -0.35));
      else put('box', 'chest', place(x, 0.36, z, 0.62, 0.1, 0.42));
      break;
    }
    case 'flag':                                // your guild's flag on a pole
      put('post', 'pole', place(x, 0.6, z, 0.06, 1.2, 0.06));
      put('box', 'guild', place(x + 0.2, 1.0, z, 0.38, 0.26, 0.02));
      put('post', 'gold', place(x, 0.04, z, 0.3, 0.08, 0.3));
      break;
    case 'campfire':                            // ring of stones, crossed logs, a flame
      for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; put('rock', 'rock', place(x + Math.cos(a) * 0.3, 0.05, z + Math.sin(a) * 0.3, 0.14, 0.1, 0.14, a)); }
      put('post', 'trunk', place(x, 0.07, z, 0.08, 0.5, 0.08, 0.6, Math.PI / 2));
      put('post', 'trunk', place(x, 0.1, z, 0.08, 0.5, 0.08, -0.6, Math.PI / 2));
      put('cone', 'flame', place(x, 0.28, z, 0.22, 0.34, 0.22));
      break;
    case 'clue':                                // a rolled-up note on a small stone
      put('rock', 'rock', place(x, 0.08, z, 0.4, 0.16, 0.35, rand(2) * 6));
      put('post', 'paper', place(x, 0.2, z, 0.08, 0.32, 0.08, rand(3) * 6, Math.PI / 2));
      break;
    case 'stairs':                              // a stone slab with steps climbing to the north
      put('box', 'stairs', place(x, 0.03, z, 0.96, 0.06, 0.96));
      for (let k = 0; k < 3; k++) put('box', 'stairs', place(x, 0.04 + k * 0.04, z + 0.27 - k * 0.27, 0.8, 0.08 + k * 0.08, 0.26));
      break;
    case 'goal':                                // a tall glowing crystal
      put('rock', 'crystal', place(x, 0.55, z, 0.42, 1.1, 0.42, rand(1) * 6));
      put('rock', 'rock', place(x, 0.06, z, 0.7, 0.14, 0.7));
      break;
    case 'rock':
      put('rock', 'rock', place(x + (rand(1) - 0.5) * 0.15, 0.2, z + (rand(2) - 0.5) * 0.15, 0.75 + rand(3) * 0.2, 0.5 + rand(4) * 0.2, 0.7 + rand(5) * 0.2, rand(6) * 6));
      break;
  }
}

// height of the ground under a piece (it stands on the highest tile it covers)
function groundAt(x, z, w = 1, d = 1) {
  let top = 0;
  const i0 = Math.floor(x - w / 2 + 0.01), i1 = Math.ceil(x + w / 2 - 0.01);
  const j0 = Math.floor(z - d / 2 + 0.01), j1 = Math.ceil(z + d / 2 - 0.01);
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) { const t = state.tiles[i + ',' + j]; if (t) top = Math.max(top, TILES[t].h); }
  return top;
}
const cellAt = p => {
  const i = Math.floor(p.x), j = Math.floor(p.z);
  return boardAt(i + 0.5, j + 0.5) ? i + ',' + j : null;
};

function frameBoard() {
  const b = boardsBox(), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const d = Math.max(b.x1 - b.x0, (b.z1 - b.z0) * camera.aspect * 0.8, 8);
  camera.position.set(cx, d * 0.85, cz + d * 0.75);
  controls.target.set(cx, 0, cz);
}

function labelSprite(text, extra) {
  const tags = extra?.tags?.join(' · ') || '', bar = extra?.hpMax > 0;
  const H = 64 + (bar ? 22 : 0) + (tags ? 30 : 0);
  const c = document.createElement('canvas'); c.width = 256; c.height = H;
  const g = c.getContext('2d');
  g.font = 'bold 30px system-ui, sans-serif';
  let w = g.measureText(text).width + 24;
  g.font = 'bold 20px system-ui, sans-serif';
  if (tags) w = Math.max(w, g.measureText(tags).width + 20);
  if (bar) w = Math.max(w, 150);
  w = Math.min(248, w);
  g.fillStyle = 'rgba(10,12,16,0.75)';
  g.beginPath(); g.roundRect((256 - w) / 2, 8, w, H - 16, 12); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 30px system-ui, sans-serif';
  g.fillText(text, 128, 33, 232);
  let y = 56;
  if (bar) {                                    // HP bar: green, yellow under half, red under a quarter
    const k = Math.max(0, Math.min(1, (extra.hp ?? extra.hpMax) / extra.hpMax)), bw = w - 28;
    g.fillStyle = '#2a2d33'; g.fillRect(128 - bw / 2, y, bw, 12);
    g.fillStyle = k > 0.5 ? '#5cb85c' : k > 0.25 ? '#e0c04b' : '#d9534f'; g.fillRect(128 - bw / 2, y, bw * k, 12);
    y += 22;
  }
  if (tags) { g.font = 'bold 20px system-ui, sans-serif'; g.fillStyle = '#ffd27a'; g.fillText(tags, 128, y + 8, 236); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2, 2 * H / 256, 1); s.renderOrder = 10;
  s.center.set(0.5, 32 / H);                    // keep the name line where it always was
  return s;
}
// what a mini's label shows besides its name
function labelExtra(f) {
  const st = f.st || {}, tags = (st.status || []).filter(x => !st.timers?.[x]);
  if (engaged.has(f.id)) tags.unshift('Engaged');
  return { hp: st.hp, hpMax: st.hpMax, tags };
}

// status countdowns over a mini's head: each status with a gold disc showing the rounds left
function timerSprite(list) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 52;
  const g = c.getContext('2d');
  g.font = 'bold 20px system-ui, sans-serif';
  const parts = list.map(([x, r]) => ({ x, r, w: g.measureText(x).width + 38 }));
  const w = Math.min(248, parts.reduce((a, b) => a + b.w, 0) + 12 + (parts.length - 1) * 6);
  g.fillStyle = 'rgba(40,24,6,0.82)';
  g.beginPath(); g.roundRect((256 - w) / 2, 6, w, 40, 12); g.fill();
  let x = (256 - w) / 2 + 8;
  g.textBaseline = 'middle';
  for (const p of parts) {
    g.fillStyle = '#ffd27a'; g.textAlign = 'left'; g.font = 'bold 20px system-ui, sans-serif';
    g.fillText(p.x, x, 27, 200);
    const cx = x + p.w - 17;
    g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(cx, 26, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a1a04'; g.textAlign = 'center'; g.font = 'bold 19px system-ui, sans-serif';
    g.fillText(String(p.r), cx, 27);
    x += p.w + 6;
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2, 2 * 52 / 256, 1); sp.renderOrder = 10; sp.center.set(0.5, 0);
  return sp;
}

// flat rectangle outline (selection / "yours" marker) for a w x d footprint
function frame(w, d, t, color, opacity) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, -d / 2); sh.lineTo(w / 2, -d / 2); sh.lineTo(w / 2, d / 2); sh.lineTo(-w / 2, d / 2); sh.lineTo(-w / 2, -d / 2);
  const hole = new THREE.Path();
  hole.moveTo(-w / 2 + t, -d / 2 + t); hole.lineTo(-w / 2 + t, d / 2 - t); hole.lineTo(w / 2 - t, d / 2 - t); hole.lineTo(w / 2 - t, -d / 2 + t); hole.lineTo(-w / 2 + t, -d / 2 + t);
  sh.holes.push(hole);
  const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  return m;
}

function makeMini(f) {
  const g = new THREE.Group();
  const base = new THREE.Group(), pawn = new THREE.Group(), holder = new THREE.Group();
  g.add(base); g.add(pawn); g.add(holder);
  const col = new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: '#22252b', roughness: 0.6 });
  for (const [geo, y] of [[new THREE.CylinderGeometry(0.17, 0.28, 0.6, 20), 0.42], [new THREE.SphereGeometry(0.19, 20, 14), 0.86]]) {
    const m = new THREE.Mesh(geo, col); m.position.y = y; m.castShadow = true; m.receiveShadow = true; pawn.add(m);
  }
  const label = labelSprite(f.name); g.add(label);
  g.userData = { id: f.id, base, pawn, holder, col, dark, label, labelText: f.name, modelKey: '', baseKey: '', target: new THREE.Vector3(f.x, 0, f.z) };
  g.position.set(f.x, 0, f.z);
  return g;
}

// the base matches the footprint: a round disc for 1x1 / 2x2 / 3x3, a rounded slab for long pieces
function buildBase(u, w, d, small) {
  for (const o of [...u.base.children]) { o.geometry.dispose(); if (o.material !== u.col && o.material !== u.dark) o.material.dispose(); }
  u.base.clear();
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = true; m.receiveShadow = true; u.base.add(m); return m; };
  if (w === d) {
    const r = 0.42 * (small ? 0.7 : w);
    add(new THREE.CylinderGeometry(r, r + 0.03, 0.1, 40), u.dark, 0.05);
    add(new THREE.CylinderGeometry(r + 0.01, r + 0.01, 0.025, 40), u.col, 0.1);
    for (const [a, b, color, op, y, key] of [[r + 0.05, r + 0.13, '#ffd23f', 0.95, 0.012, 'ring'], [r + 0.05, r + 0.09, '#ffffff', 0.6, 0.01, 'mine'], [r + 0.03, r + 0.08, '#ffffff', 0.9, 0.008, 'side']]) {
      const m = new THREE.Mesh(new THREE.RingGeometry(a, b, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.y = y; u.base.add(m); u[key] = m;
    }
  } else {
    add(new THREE.BoxGeometry(w - 0.12, 0.1, d - 0.12), u.dark, 0.05);
    add(new THREE.BoxGeometry(w - 0.16, 0.025, d - 0.16), u.col, 0.1);
    u.ring = frame(w - 0.02, d - 0.02, 0.08, '#ffd23f', 0.95); u.ring.position.y = 0.012; u.base.add(u.ring);
    u.mine = frame(w - 0.02, d - 0.02, 0.04, '#ffffff', 0.6); u.mine.position.y = 0.01; u.base.add(u.mine);
    u.side = frame(w - 0.06, d - 0.06, 0.05, '#ffffff', 0.9); u.side.position.y = 0.008; u.base.add(u.side);
  }
}

function upsertFig(f, live) {
  state.figures[f.id] = f;
  figsVersion++;
  let g = figMeshes.get(f.id);
  if (!g) { g = makeMini(f); figMeshes.set(f.id, g); figRoot.add(g); }
  const u = g.userData;
  if (dragging?.id !== f.id) { const c = fp(f); u.target.set(f.x, groundAt(f.x, f.z, c.w, c.d), f.z); }
  u.col.color.set(f.color);
  const text = f.name + (sideOf(f) === 'npc' && f.job ? ` · ${f.job}` : '') + (f.hidden ? ' (hidden)' : ''), extra = labelExtra(f), key = text + JSON.stringify(extra);
  if (u.labelText !== key) {
    g.remove(u.label); u.label.material.map.dispose(); u.label.material.dispose();
    u.label = labelSprite(text, extra); u.labelText = key; g.add(u.label);
  }
  const timed = Object.entries(f.st?.timers || {}).filter(([x]) => (f.st.status || []).includes(x)), tkey = JSON.stringify(timed);
  if (u.timerKey !== tkey) {
    if (u.timer) { g.remove(u.timer); u.timer.material.map.dispose(); u.timer.material.dispose(); u.timer = null; }
    if (timed.length) { u.timer = timerSprite(timed); g.add(u.timer); }
    u.timerKey = tkey;
  }
  const { w, d } = fp(f), small = f.size === '0.7' && w === 1 && d === 1;
  const baseKey = `${w}x${d}${small ? 's' : ''}`;
  if (u.baseKey !== baseKey) { buildBase(u, w, d, small); u.baseKey = baseKey; }
  const rot = (f.rot || 0) * Math.PI / 180;
  u.holder.rotation.y = u.pawn.rotation.y = -rot;
  // the model's own frame: a long piece turned 90 degrees has its sides swapped on the board
  const sideways = w !== d && (f.rot || 0) % 180 === 90;
  const lw = sideways ? d : w, ld = sideways ? w : d;
  const want = f.model && modelData.has(f.model) ? f.model : '';
  const modelKey = want && `${want}|${lw}x${ld}`;
  if (u.modelKey !== modelKey) setModel(g, want, lw, ld, modelKey);
  const sc = small ? 0.7 : Math.min(w, d);
  u.pawn.scale.setScalar(sc);
  u.labelY = u.label.position.y = (want ? (u.modelTop || 1.1) : 1.1 * sc) + 0.35;
  u.mine.visible = !!viewerId() && f.owner === viewerId();
  u.side.material.color.set(SIDES[sideOf(f)].color);
  g.visible = !isHost || (gmView() ? gmSees(boardAt(f.x, f.z)) : figVisible(f));
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

function setModel(g, id, lw, ld, key) {
  const u = g.userData;
  u.modelKey = key;
  u.holder.clear();
  u.pawn.visible = !id;
  u.modelTop = 0;
  if (!id) return;
  modelScene(id).then(scene => {
    if (u.modelKey !== key) return;
    const m = cloneSkinned(scene);
    // fit it on the base: inside its squares, at most ~1.6 squares tall (by its narrow side)
    m.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m, true), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = Math.min(0.85 * lw / Math.max(size.x, 1e-6), 0.85 * ld / Math.max(size.z, 1e-6), 1.6 * Math.min(lw, ld) / Math.max(size.y, 1e-6));
    m.scale.multiplyScalar(k);
    m.position.set(-c.x * k, 0.11 - box.min.y * k, -c.z * k);
    m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    u.holder.add(m);
    u.modelTop = 0.11 + size.y * k;
    if (state.figures[u.id]) upsertFig(state.figures[u.id], true);
  }).catch(() => { if (u.modelKey === key) { u.pawn.visible = true; status('A 3D model could not be loaded.'); setTimeout(() => status(''), 4000); } });
}

async function useBuiltin(key, figId) {
  const b = BUILTIN[key];
  if (!b) return;
  try {
    const data = await (await fetch(b.file)).arrayBuffer();
    act({ t: 'model', id: await modelId(data), name: b.name, data, figId });
  } catch { status('That model could not be loaded.'); setTimeout(() => status(''), 4000); }
}

// many Sketchfab .glb files need the old "specular-glossiness" materials, which three.js no longer reads:
// turn them into normal ones (diffuse colour/texture -> base colour) so the upload just works
function fixGlb(buf) {
  const dv = new DataView(buf);
  if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(16, true) !== 0x4e4f534a) return buf;
  const n = dv.getUint32(12, true), SG = 'KHR_materials_pbrSpecularGlossiness';
  let j;
  try { j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, n))); } catch { return buf; }
  if (!(j.extensionsUsed || []).includes(SG)) return buf;
  for (const m of j.materials || []) {
    const sg = m.extensions?.[SG];
    if (!sg) continue;
    m.pbrMetallicRoughness = { baseColorFactor: sg.diffuseFactor || [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 - (sg.glossinessFactor ?? 0.2) };
    if (sg.diffuseTexture) m.pbrMetallicRoughness.baseColorTexture = sg.diffuseTexture;
    delete m.extensions[SG];
    if (!Object.keys(m.extensions).length) delete m.extensions;
  }
  for (const k of ['extensionsUsed', 'extensionsRequired']) if (j[k]) { j[k] = j[k].filter(x => x !== SG); if (!j[k].length) delete j[k]; }
  let text = new TextEncoder().encode(JSON.stringify(j));
  const pad = (4 - text.length % 4) % 4, rest = new Uint8Array(buf, 20 + n);
  const out = new Uint8Array(20 + text.length + pad + rest.length), ov = new DataView(out.buffer);
  ov.setUint32(0, 0x46546c67, true); ov.setUint32(4, 2, true); ov.setUint32(8, out.length, true);
  ov.setUint32(12, text.length + pad, true); ov.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + text.length + pad); out.set(rest, 20 + text.length + pad);
  return out.buffer;
}
async function modelId(buf) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(h.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

function removeFigMesh(id) {
  const g = figMeshes.get(id);
  if (g) {
    figRoot.remove(g);
    g.remove(g.userData.holder);                // model parts are shared with other minis
    g.traverse(m => { m.geometry?.dispose(); m.material?.map?.dispose(); m.material?.dispose(); });
    figMeshes.delete(id);
  }
  if (selectedId === id) select(null);
}

function syncFigures() {
  for (const id of [...figMeshes.keys()]) if (!state.figures[id]) removeFigMesh(id);
  for (const f of Object.values(state.figures)) upsertFig(f);
}

function rebuildAll() { buildBoard(); buildTiles(); syncFigures(); renderPlayers(); renderLog(); updateBoardInputs(); renderCombat(); renderRules(); renderParty(); renderEvent(); renderPause(); renderWarp(); renderAttack(); renderLibrary(); renderBoardLib(); renderAreas(); renderFloor(); renderBag(); if (isHost) { siteFeed(); renderSiteChars(); } }

let figsVersion = 0, tilesVersion = 0, overlayKey = '', engaged = new Set(), hoverId = null, share = new Map();
let rangeMesh = null, turnMarker = null, losLine = null, losLabel = null;
const ruleWorld = f => worldFor(f);              // the same grid view the GM uses, from this browser's copy
const box = f => ({ x: f.x, z: f.z, ...fp(f) });
function updateOverlays() {
  const key = `${preview ? 'p' + preview.as : 'g'}|${selectedId}|${figsVersion}|${tilesVersion}|${dragging ? dragging.id : ''}|${JSON.stringify(state.combat && [state.combat.turn, state.combat.dash])}|${JSON.stringify(state.party)}|${state.rules.diag}|${hoverId}`;
  if (key === overlayKey) return;
  overlayKey = key;
  // Engaged: a player's mini next to a GM mini (both with stats)
  const fighters = Object.values(state.figures).filter(f => f.st && f.st.dex != null && (!isHost || gmView() || figVisible(f)));
  const now = new Set();
  for (const a of fighters) for (const b of fighters)
    if (a !== b && !!a.owner !== !!b.owner && adjacent(box(a), box(b), state.rules.diag)) now.add(a.id);
  const changed = [...now].some(id => !engaged.has(id)) || [...engaged].some(id => !now.has(id));
  engaged = now;
  const bySquare = new Map();
  for (const f of Object.values(state.figures)) if (isSmall(f)) { const k = Math.floor(f.x) + ',' + Math.floor(f.z); bySquare.set(k, [...(bySquare.get(k) || []), f.id]); }
  share = new Map();
  for (const ids of bySquare.values()) if (ids.length > 1) ids.sort().forEach((id, n) => share.set(id, n ? 0.2 : -0.2));
  if (changed) for (const f of Object.values(state.figures)) upsertFig(f, true);
  // movement range of the picked mini (yours, or any for the GM) once it has a Dexterity
  if (rangeMesh) { scene.remove(rangeMesh); rangeMesh.dispose(); rangeMesh = null; }
  const f = selectedId && state.figures[selectedId];
  const fighting = f && state.combat?.order.some(o => o.id === f.id);
  if (f && (f.st?.dex != null || fighting) && (canMove(f) || (preview && f.owner === preview.as))) {
    const c = state.combat, myTurn = c && c.order[c.turn]?.id === f.id, P = state.party, party = !c && f.owner;
    const from = myTurn ? c.from : party && P.from[f.id] ? P.from[f.id] : dragging?.id === f.id ? dragging.from : { x: f.x, z: f.z };
    const budget = moveBudget(f) * (1 + (myTurn ? c.dash || 0 : party && P.dash[f.id] ? 1 : 0)) - (from.used || 0);
    const { w, d } = fp(f);
    const cells = reachable(ruleWorld(f), from.x, from.z, w, d, budget, state.rules.diag);
    rangeMesh = new THREE.InstancedMesh(rangeGeo, rangeMat, cells.size);
    let n = 0;
    for (const k of cells.keys()) {
      const [x, z] = k.split(',').map(Number);
      rangeMesh.setMatrixAt(n++, place(x, groundAt(x, z, w, d) + 0.012, z, w - 0.08, 1, d - 0.08));
    }
    rangeMesh.renderOrder = 2;
    scene.add(rangeMesh);
  }
  // line of sight from the picked mini to the one under the mouse
  if (losLine) { scene.remove(losLine); losLine.material.dispose(); losLine = null; }
  if (losLabel) { scene.remove(losLabel); losLabel.material.map.dispose(); losLabel.material.dispose(); losLabel = null; }
  const h = hoverId && hoverId !== selectedId && state.figures[hoverId];
  if (f && h) {
    const clear = lineOfSight(ruleWorld(f), f.x, f.z, h.x, h.z), dist = distance(box(f), box(h), state.rules.diag);
    const y = 0.6;
    // a thin rod from one mini to the other: green = in sight, red = blocked
    const len = Math.hypot(h.x - f.x, h.z - f.z);
    losLine = new THREE.Mesh(losGeo, new THREE.MeshBasicMaterial({ color: clear ? '#5cdc6c' : '#ff5a4f', depthTest: false, transparent: true, opacity: 0.9 }));
    losLine.position.set((f.x + h.x) / 2, y, (f.z + h.z) / 2);
    losLine.scale.set(1, len, 1);
    losLine.rotation.set(0, Math.atan2(h.x - f.x, h.z - f.z), 0, 'YXZ'); losLine.rotateX(Math.PI / 2);
    losLine.renderOrder = 11;
    scene.add(losLine);
    const adj = adjacent(box(f), box(h), state.rules.diag);
    losLabel = labelSprite(`${adj ? 'Adjacent' : dist + ' sq'} · ${clear ? 'in sight' : 'blocked'}`);
    losLabel.position.set((f.x + h.x) / 2, 1.0, (f.z + h.z) / 2);
    scene.add(losLabel);
  }
}
const rangeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const losGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 8);
const rangeMat = new THREE.MeshBasicMaterial({ color: '#4b9be0', transparent: true, opacity: 0.32, depthWrite: false });

// an "Interact" button over each ? that one of your minis (or, for the GM, the picked ally) stands next to
function updatePrompts() {
  const box = $('prompts'), seen = new Set();
  let mine = gmView() ? [state.figures[selectedId]].filter(f => f?.owner) : Object.values(state.figures).filter(f => f.owner && f.owner === viewerId());
  const c = isHost && !gmView() ? combatView() : state.combat;
  if (c) mine = mine.filter(f => c.order[c.turn]?.id === f.id);          // in combat: only on your own turn
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
  for (const [k, t] of Object.entries(state.tiles)) {
    if (!INTERACT[t]) continue;
    const who = mine.find(f => nextToCell(f, k));
    if (!who) continue;
    seen.add(k);
    let b = box.querySelector(`[data-key="${k}"]`);
    if (!b) {
      b = document.createElement('button'); b.className = 'prompt'; b.dataset.key = k;
      b.onclick = () => act({ t: 'interact', id: b.dataset.who, key: k });
      box.appendChild(b);
    }
    b.dataset.who = who.id;
    b.textContent = INTERACT[t];
    b.disabled = !!preview;
    const [i, j] = k.split(',').map(Number);
    v.set(i + 0.5, 1.15, j + 0.5).project(camera);
    b.style.left = (r.width * (v.x + 1) / 2) + 'px';
    b.style.top = (r.height * (1 - v.y) / 2) + 'px';
    b.style.display = v.z < 1 ? '' : 'none';
  }
  for (const [k, t] of Object.entries(state.tiles)) {             // standing on the stairs
    if (t !== 'stairs') continue;
    const who = mine.find(f => { const c = fp(f); return cellsOf(f.x, f.z, c.w, c.d).some(x => x.join(',') === k); });
    if (!who) continue;
    seen.add('st:' + k);
    let b = box.querySelector(`[data-key="st:${k}"]`);
    if (!b) {
      b = document.createElement('button'); b.className = 'prompt stairs'; b.dataset.key = 'st:' + k;
      b.onclick = () => act({ t: 'stairs', id: b.dataset.who });
      box.appendChild(b);
    }
    b.dataset.who = who.id;
    b.textContent = '⬇ Go to the next floor';
    b.disabled = !!preview;
    const [i, j] = k.split(',').map(Number);
    v.set(i + 0.5, 1.9, j + 0.5).project(camera);
    b.style.left = (r.width * (v.x + 1) / 2) + 'px';
    b.style.top = (r.height * (1 - v.y) / 2) + 'px';
    b.style.display = v.z < 1 ? '' : 'none';
  }
  for (const npc of Object.values(state.figures)) {
    if (sideOf(npc) !== 'npc' || (isHost && !gmView() && !figVisible(npc))) continue;
    const who = mine.find(f => f.id !== npc.id && nextToFig(f, npc));
    if (!who) continue;
    const k = 'npc:' + npc.id;
    seen.add(k);
    let b = box.querySelector(`[data-key="${k}"]`);
    if (!b) {
      b = document.createElement('button'); b.className = 'prompt talk'; b.dataset.key = k;
      b.onclick = () => act({ t: 'talk', id: b.dataset.who, npc: npc.id });
      box.appendChild(b);
    }
    b.dataset.who = who.id;
    b.textContent = `💬 Talk to ${npc.name}${npc.job ? ` (${npc.job})` : ''}`;
    b.disabled = !!preview;
    v.set(npc.x, 1.9, npc.z).project(camera);
    b.style.left = (r.width * (v.x + 1) / 2) + 'px';
    b.style.top = (r.height * (1 - v.y) / 2) + 'px';
    b.style.display = v.z < 1 ? '' : 'none';
  }
  for (const b of [...box.children]) if (!seen.has(b.dataset.key)) b.remove();
}

// ---------- attack effects: physical = lunge + claw marks, special = an orb flying over, status = rings; coloured by type ----------
const fxList = [];
function fxMesh(geo, color, opacity = 1) {
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  scene.add(m); return m;
}
const dropMesh = m => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); };
const FX_HIT = { Physical: 150, Special: 450, Status: 250 };   // ms until the move reaches the target
function playFx(fx) {
  const tg = state.figures[fx.to], src = state.figures[fx.from], color = TYPES[fx.type] || '#ffffff';
  if (!tg || !scene) return;
  const T = new THREE.Vector3(tg.x, 0.6, tg.z), t0 = performance.now();
  const lb = figMeshes.get(tg.id)?.userData.label, head = lb ? lb.position.y + lb.scale.y * (1 - lb.center.y) + 0.2 : 1.6;
  const add = (ms, step, end) => fxList.push({ t0, ms, step, end });
  const burst = (delay, n = 10) => {
    const bits = Array.from({ length: n }, () => {
      const m = fxMesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), color);
      m.visible = false; m.userData.v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).multiplyScalar(2.4);
      return m;
    });
    add(delay + 600, k => {
      const u = Math.max(0, (k * (delay + 600) - delay) / 600);
      for (const b of bits) { b.visible = u > 0; b.position.copy(T).addScaledVector(b.userData.v, u * 0.6); b.position.y -= u * u * 0.4; b.material.opacity = 1 - u; b.rotation.x += 0.2; }
    }, () => bits.forEach(dropMesh));
  };
  const floatText = (text, col, delay = 0) => {                         // over the target's name tag
    const sp = labelSprite(text); sp.position.copy(T).setY(head); sp.visible = !delay; scene.add(sp);
    if (col) sp.material.color.set(col);
    const ms = 1500 + delay;
    add(ms, k => { const u = Math.max(0, (k * ms - delay) / 1500); sp.visible = k * ms >= delay; sp.position.y = head + u * 0.8; sp.material.opacity = 1 - Math.max(0, u - 0.6) / 0.4; },
      () => { scene.remove(sp); sp.material.map.dispose(); sp.material.dispose(); });
  };
  if (fx.miss) floatText('Miss!', null, FX_HIT[fx.kind] || 300);
  else if (fx.text) floatText(fx.text, '#ff8a80', FX_HIT[fx.kind] || 300);
  if (fx.kind === 'miss') { floatText('Miss!'); return; }   // sent by an older version
  if (fx.kind === 'dmg') return;
  if (fx.kind === 'Physical') {
    const g = src && figMeshes.get(src.id);
    if (g) g.position.lerp(new THREE.Vector3(tg.x, g.position.y, tg.z), 0.45);   // lunge; it glides back by itself
    const claws = [-0.18, 0, 0.18].map(o => {
      const m = fxMesh(new THREE.PlaneGeometry(0.07, 0.9), color);
      m.position.copy(T); m.lookAt(camera.position); m.translateX(o); m.rotateZ(0.6); m.scale.y = 0.01;
      return m;
    });
    add(500, k => claws.forEach(m => { m.scale.y = Math.min(1, k * 3); m.material.opacity = 1 - k; }), () => claws.forEach(dropMesh));
    burst(80);
  } else if (fx.kind === 'Special') {
    const S = src ? new THREE.Vector3(src.x, 0.8, src.z) : T.clone().setY(3);
    const orb = fxMesh(new THREE.SphereGeometry(0.2, 16, 12), color), glow = fxMesh(new THREE.SphereGeometry(0.34, 16, 12), color, 0.35);
    add(450, k => { orb.position.lerpVectors(S, T, k); orb.position.y += Math.sin(k * Math.PI) * 0.6; glow.position.copy(orb.position); glow.scale.setScalar(1 + Math.sin(k * 20) * 0.15); },
      () => [orb, glow].forEach(dropMesh));
    const ring = fxMesh(new THREE.RingGeometry(0.3, 0.42, 40), color); ring.visible = false; ring.rotation.x = -Math.PI / 2;
    add(950, k => { const u = Math.max(0, (k * 950 - 450) / 500); ring.visible = u > 0; ring.position.copy(T).setY(0.3); ring.scale.setScalar(1 + u * 2.5); ring.material.opacity = 1 - u; },
      () => dropMesh(ring));
    burst(450, 14);
  } else {
    const rings = [0, 1].map(() => { const m = fxMesh(new THREE.RingGeometry(0.5, 0.58, 40), color); m.rotation.x = -Math.PI / 2; return m; });
    add(900, k => rings.forEach((m, i) => { const u = Math.min(1, Math.max(0, k * 1.4 - i * 0.3)); m.position.copy(T).setY(0.05 + u * 1.2); m.material.opacity = 1 - u; }),
      () => rings.forEach(dropMesh));
  }
}
function animateFx(now) {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const e = fxList[i], k = Math.min(1, (now - e.t0) / e.ms);
    e.step(k);
    if (k >= 1) { e.end(); fxList.splice(i, 1); }
  }
}

// ---------- area shapes on the table + the one being placed ----------
let areaGroup = null, areaKey = '', areaRings = [], areaDraft = null, pingArm = false, draftGroup = null;
const areaGeo = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
function shownAreas() { return isHost && !gmView() ? areasView() : state.areas || {}; }
function areaMesh(list, opacity) {
  const grp = new THREE.Group(), cells = [];
  for (const a of list) for (const [i, j] of areaCells(a)) if (boardAt(i + 0.5, j + 0.5)) cells.push([i, j, a]);
  if (!cells.length) return grp;
  const m = new THREE.InstancedMesh(areaGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false }), cells.length);
  const col = new THREE.Color();
  cells.forEach(([i, j, a], n) => {
    m.setMatrixAt(n, place(i + 0.5, groundAt(i + 0.5, j + 0.5) + 0.02, j + 0.5, 1, 1, 1));
    m.setColorAt(n, col.set(a.color || '#ffd23f'));
  });
  m.renderOrder = 3; grp.add(m);
  for (const a of list) {                          // a faint square marks where a cone or line starts
    if (a.kind === 'burst') continue;
    const o = new THREE.Mesh(areaGeo, new THREE.MeshBasicMaterial({ color: a.color || '#ffd23f', transparent: true, opacity: 0.18, depthWrite: false }));
    o.position.set(a.x, groundAt(a.x, a.z) + 0.018, a.z); o.scale.setScalar(0.6); o.renderOrder = 3;
    grp.add(o);
  }
  return grp;
}
function dropGroup(grp) { if (!grp) return; scene.remove(grp); grp.traverse(o => { if (o.isMesh) { if (o.geometry !== areaGeo) o.geometry.dispose(); o.material.dispose(); } }); }
function renderAreas() {
  areaKey = '';
  const el = $('areaList'); if (!el) return;
  el.innerHTML = '';
  for (const [id, a] of Object.entries(shownAreas())) {
    const d = document.createElement('div'); d.className = 'areaRow';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = a.color;
    const t = document.createElement('span'); t.textContent = `${state.players[a.by]?.name || '?'}: ${AREA_KINDS[a.kind]} ${a.size}`;
    d.append(dot, t);
    if (gmView() || (!isHost && a.by === clientId)) {
      const x = document.createElement('button'); x.className = 'fit'; x.textContent = '×'; x.title = 'Remove';
      x.onclick = () => act({ t: 'areaDel', area: id }); d.appendChild(x);
    }
    el.appendChild(d);
  }
}
function updateAreas() {
  const list = Object.values(shownAreas());
  const key = `${figsVersion}|${tilesVersion}|${JSON.stringify(list)}|${preview ? preview.as : ''}`;
  if (key === areaKey) return;
  areaKey = key;
  dropGroup(areaGroup); areaRings = [];
  areaGroup = areaMesh(list, 0.38); scene.add(areaGroup);
  const seen = new Set();
  for (const a of list) for (const f of areaHits(a)) {                  // minis caught in it get a pulsing ring
    const g = figMeshes.get(f.id);
    if (seen.has(f.id) || !g?.visible) continue;
    seen.add(f.id);
    const k = fp(f), r = 0.42 * Math.max(k.w, k.d) + 0.16;
    const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.09, 40), new THREE.MeshBasicMaterial({ color: a.color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(f.x, groundAt(f.x, f.z, k.w, k.d) + 0.03, f.z); m.renderOrder = 4;
    areaGroup.add(m); areaRings.push(m);
  }
}
// the shape follows the mouse while it's being placed
function draftArea(p) {
  dropGroup(draftGroup); draftGroup = null;
  if (!areaDraft || !p) return null;
  const d = areaDraft, from = d.from || p, ang = Math.atan2(p.z - from.z, p.x - from.x) * 180 / Math.PI;
  const a = { kind: d.kind, size: d.size, x: Math.floor(d.kind === 'burst' ? p.x : from.x) + 0.5, z: Math.floor(d.kind === 'burst' ? p.z : from.z) + 0.5,
    dir: ((Math.round(ang / 45) * 45) % 360 + 360) % 360, color: state.players[clientId]?.color || '#ffd23f' };
  if (d.kind !== 'burst' && !d.from) return a;     // waiting for the start square
  draftGroup = areaMesh([a], 0.25); scene.add(draftGroup);
  return a;
}
function startAreaDraft() {
  const kind = $('areaKind').value, size = Math.max(1, Math.min(10, Math.round(+$('areaSize').value) || 2));
  const f = selectedId && state.figures[selectedId];
  areaDraft = { kind, size, from: kind !== 'burst' && f ? { x: f.x, z: f.z } : null };
  pingArm = false;
  const name = AREA_KINDS[kind].toLowerCase();
  status(kind === 'burst' ? 'Click the square in the middle of the burst (Esc to cancel)'
    : areaDraft.from ? `Point the ${name} away from ${f.name} and click (Esc to cancel)` : `Click where the ${name} starts, then click the way it points (Esc to cancel)`);
}
function endAreaDraft() { areaDraft = null; dropGroup(draftGroup); draftGroup = null; status(''); }
// a ping: rings spreading out on the square and a beam of light, in the pinger's colour
function playPing(msg) {
  if (!scene) return;
  const y = groundAt(msg.x, msg.z) + 0.03, t0 = performance.now(), col = msg.color || '#ffd23f';
  const rings = [0, 1, 2].map(() => { const m = fxMesh(new THREE.RingGeometry(0.3, 0.4, 40), col); m.rotation.x = -Math.PI / 2; m.position.set(msg.x, y, msg.z); m.visible = false; return m; });
  const beam = fxMesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 12), col, 0.6); beam.position.set(msg.x, y + 1.5, msg.z);
  const tag = labelSprite('📍 ' + msg.name); tag.position.set(msg.x, y + 1.4, msg.z); scene.add(tag);
  fxList.push({ t0, ms: 2400, step: k => {
    rings.forEach((m, i) => { const u = Math.min(1, Math.max(0, (k * 2400 - i * 350) / 1200)); m.visible = u > 0 && u < 1; m.scale.setScalar(1 + u * 3); m.material.opacity = 1 - u; });
    beam.material.opacity = 0.6 * (1 - k); beam.scale.x = beam.scale.z = 1 + Math.sin(k * 30) * 0.2;
    tag.position.y = y + 1.4 + k * 0.4; tag.material.opacity = k < 0.7 ? 1 : (1 - k) / 0.3;
  }, end: () => { rings.forEach(dropMesh); dropMesh(beam); scene.remove(tag); tag.material.map.dispose(); tag.material.dispose(); } });
}

// ---------- floor name: a big banner on a new floor (like the games), then a small tag in the corner ----------
function renderFloor(fresh) {
  const D = state.dungeon, tag = $('floorTag');
  if (!tag) return;
  tag.style.display = D ? '' : 'none';
  if (!D) return;
  tag.textContent = `${D.name} · B${D.floor}F`;
  if ($('floorName') && document.activeElement !== $('floorName')) $('floorName').value = D.name;
  if ($('floorNum') && document.activeElement !== $('floorNum')) $('floorNum').value = D.floor;
  if (!fresh) return;
  const ban = $('floorBanner');
  ban.innerHTML = '';
  const a = document.createElement('div'); a.textContent = D.name;
  const n = document.createElement('div'); n.className = 'fl'; n.textContent = `B${D.floor}F`;
  ban.append(a, n);
  ban.classList.remove('show'); void ban.offsetWidth; ban.classList.add('show');
  const b = state.boards.find(x => x.id === D.board);
  if (b && camera) {                             // look at the new floor
    const cx = b.x + b.cols / 2, cz = b.z + b.rows / 2, d = Math.max(b.cols, b.rows * camera.aspect * 0.8, 8);
    camera.position.set(cx, d * 0.85, cz + d * 0.75); controls.target.set(cx, 0, cz);
  }
}

// ---------- the attack panel (pick a move, then roll accuracy and, on a hit, damage) ----------
// moves come from the Voice of the Forest site's public index (read only)
let indexP = null, attackFor = null, atk = null;
const INDEX_URL = 'https://xrunriot-wp.github.io/thevoiceoftheforest/data/index.json';
function loadIndex() {
  return indexP ||= fetch(INDEX_URL).then(r => r.json()).then(E => {
    const moves = E.filter(e => e.kind === 'Move' && e.mv).map(e => ({ name: e.name, ...e.mv, text: e.trigger || '' })).sort((a, b) => a.name.localeCompare(b.name));
    const species = E.filter(e => e.kind === 'Species').map(parseSpecies).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    return { moves, species };
  }).catch(() => { indexP = null; return { moves: [], species: [] }; });
}
const loadMoves = () => loadIndex().then(x => x.moves);
// "Attributes (start/max): Str 3/7, Dex 1/2, ..." + "Grass/Ice type. Base HP 5." + "Starter: Leer, Powder Snow | Beginner: ..."
function parseSpecies(e) {
  const at = {}, names = { Str: 'Strength', Dex: 'Dexterity', Vit: 'Vitality', Spe: 'Special', Ins: 'Insight' };
  for (const [, k, v] of (e.roll || '').matchAll(/(Str|Dex|Vit|Spe|Ins) (\d+)\//g)) at[names[k]] = +v;
  if (!Object.keys(at).length) return null;
  const types = ((e.outcome || '').match(/([A-Za-z]+(?:\/[A-Za-z]+)?) type\./) || [, ''])[1].split('/').filter(t => TYPES[t]);
  const hp = +((e.outcome || '').match(/Base HP (\d+)/) || [, 0])[1];
  const moves = (e.learn || '').split('|').flatMap(r => r.replace(/^[^:]*:/, '').split(',')).map(x => x.trim()).filter(Boolean);
  return { name: e.name, attr: at, types, hp, moves };
}
async function openAttack(id, target) {
  atk = { id, target, move: null };
  $('atkPanel').style.display = 'block';
  $('atkMove').value = '';
  renderAttack();
  const list = await loadMoves(), f = state.figures[id];
  const dl = $('atkMoves'); dl.innerHTML = '';
  const recent = [...new Set([...(f?.st?.moves || []), ...(f?.st?.learn || [])])];
  for (const m of list) { const o = document.createElement('option'); o.value = m.name; dl.appendChild(o); }
  const own = $('atkOwn'); own.innerHTML = '';
  for (const n of recent) {
    const m = list.find(x => x.name.toLowerCase() === n.toLowerCase());
    const b = document.createElement('button'); b.className = 'fit chip'; b.textContent = m ? m.name : `${n} (not found)`;
    b.disabled = !m;
    if (m) { b.style.borderColor = TYPES[m.type] || ''; b.onclick = () => { $('atkMove').value = m.name; pickMove(); }; }
    own.appendChild(b);
  }
  if (!list.length) $('atkInfo').textContent = 'Could not load the moves from the Voice of the Forest site. Check the connection and try again.';
  else if (recent[0]) { $('atkMove').value = list.find(x => x.name.toLowerCase() === recent[0].toLowerCase())?.name || ''; pickMove(); }
}
async function pickMove() {
  const list = await loadMoves(), m = list.find(x => x.name.toLowerCase() === $('atkMove').value.trim().toLowerCase());
  if (!atk || (atk.move?.name === m?.name && m)) return;
  atk.move = m || null;
  for (const b of $('atkOwn').children) b.classList.toggle('on', b.textContent === m?.name);
  renderAttack();
}
function renderAttack() {
  const P = $('atkPanel');
  if (!P) return;
  if (!atk) { P.style.display = 'none'; return; }
  const f = state.figures[atk.id], tg = state.figures[atk.target];
  if (!f || !tg) { atk = null; P.style.display = 'none'; return; }
  const m = atk.move, A = state.attack, rolledHit = !!(A && A.id === f.id && A.target === tg.id);
  $('atkTitle').textContent = `${f.name} attacks ${tg.name}`;
  $('atkInfo').innerHTML = '';
  if (m) {
    const c = document.createElement('span'); c.className = 'typechip'; c.textContent = m.type; c.style.background = TYPES[m.type] || '#888';
    $('atkInfo').append(c, ` ${m.cat}${m.cat !== 'Status' ? ` · Power ${m.power}` : ''}${m.effect && m.effect !== '-' ? ' · ' + m.effect : ''}`);
  }
  const a = f.st?.attr || {}, rows = $('atkRows');
  const hideDef = !gmView() && sideOf(tg) === 'enemy';   // players never see an enemy's Vitality / Insight (Adam)
  const keep = new Map([...rows.querySelectorAll('input')].map(i => [i.dataset.key + '|' + i.dataset.own, i.value]));
  rows.innerHTML = '';
  const field = (label, key, val, own) => {
    const d = document.createElement('div'), l = document.createElement('label'), i = document.createElement('input');
    l.textContent = label; i.type = 'number'; i.min = 0; i.max = 20;
    i.dataset.key = key; i.dataset.own = own ? '1' : '';
    i.value = keep.get(key + '|' + i.dataset.own) ?? val ?? '';
    i.oninput = calc;
    d.append(l, i); rows.appendChild(d);
    return i;
  };
  if (m) {
    for (const k of m.acc) field(`${f.name}'s ${k}`, k, a[k], true);
    if (m.cat !== 'Status') {
      if (m.dmg && !m.acc.includes(m.dmg)) field(`${f.name}'s ${m.dmg}`, m.dmg, a[m.dmg], true);
      if (!hideDef) field(`${tg.name}'s ${defenceFor(m.cat)}`, defenceFor(m.cat), tg.st?.attr?.[defenceFor(m.cat)], false).disabled = !gmView();
    }
  }
  function calc() {
    if (!m) { $('atkSum').textContent = 'Pick a move.'; return; }
    const val = (k, own) => +([...rows.querySelectorAll('input')].find(i => i.dataset.key === k && !!i.dataset.own === own)?.value) || 0;
    const acc = Math.max(1, m.acc.reduce((s, k) => s + val(k, true), 0));
    const stab = (f.st?.types || []).includes(m.type) ? 1 : 0, mu = matchup(m.type, tg.st?.types || []), pain = painOf(f);
    const dmg = Math.max(1, val(m.dmg, true) + m.power - val(defenceFor(m.cat), false) + stab);
    const notes = [stab && 'same type +1 die', mu.immune ? `${tg.name} is immune` : mu.mod > 0 ? `super effective +${mu.mod}` : mu.mod < 0 ? `not very effective ${mu.mod}` : '',
      pain && `pain -${pain} success${pain > 1 ? 'es' : ''}`].filter(Boolean);
    $('atkSum').textContent = `Accuracy: ${acc} dice, a hit needs 1 success (4-6; 4+ = critical, +2 damage dice)` +
      (m.cat !== 'Status' ? ` · Damage: ${dmg} dice${hideDef ? ` minus ${tg.name}'s ${defenceFor(m.cat)}` : ''}, each success = 1 damage` : '') + (notes.length ? ` · ${notes.join(' · ')}` : '');
  }
  calc();
  $('atkAcc').disabled = !m || !!preview;
  $('atkDmg').disabled = !!preview;
  $('atkDmg').style.display = rolledHit ? '' : 'none';
  $('atkAcc').style.display = rolledHit ? 'none' : '';
}
function attackMsg(step) {
  const m = atk?.move;
  if (!m) return;
  const attr = {};
  let def = null;
  for (const i of $('atkRows').querySelectorAll('input')) { if (i.dataset.own) attr[i.dataset.key] = i.value; else def = { name: i.dataset.key, v: i.value }; }
  act({ t: 'attack', id: atk.id, target: atk.target, step, move: m, attr, def });
}
function closeAttack() {
  if (atk && state.attack && state.attack.id === atk.id) act({ t: 'attackCancel' });
  atk = null; $('atkPanel').style.display = 'none';
}

// ---------- warp-out vote ----------
function renderWarp() {
  const box = $('warpBox'), w = state.warp;
  if (!box) return;
  if (!w) { box.style.display = 'none'; return; }
  box.style.display = 'block';
  const me = viewerId(), voted = w.votes[me] != null, n = Object.keys(w.votes).length;
  const name = id => state.players[id]?.name || '?';
  box.innerHTML = '<div class="evt">Warp out of the dungeon?</div><div class="evx"></div><div class="row evb"></div>';
  const x = box.querySelector('.evx'), row = box.querySelector('.evb');
  if (w.result === 'out') x.innerHTML = 'Everyone agreed: <b>the team warps out!</b>';
  else if (w.result === 'stay') x.textContent = 'Not everyone agreed, so the team stays in the dungeon. The warp is used up.';
  else x.innerHTML = `The Dungeon Goal is done. The team can warp out now, but only if <b>everyone</b> says yes. This chance comes once.<br>Voted: ${n} of ${w.voters.length}` +
    (n ? ' (' + Object.keys(w.votes).map(name).join(', ').replace(/[<>&]/g, '') + ')' : '');
  const btn = (t, cls, fn) => { const b = document.createElement('button'); b.textContent = t; if (cls) b.className = cls; b.onclick = fn; row.appendChild(b); };
  if (!w.result && w.voters.includes(me) && !voted && !preview) { btn('Warp out', 'primary', () => act({ t: 'warpVote', yes: true })); btn('Stay', '', () => act({ t: 'warpVote', yes: false })); }
  else if (!w.result && voted) row.append('Waiting for the others...');
  if (gmView()) btn(w.result ? 'Close' : 'Cancel the vote', '', () => act({ t: 'warpClose' }));
  else if (w.result) btn('OK', '', () => { box.style.display = 'none'; });
}

// ---------- the GM's saved boards, in labelled groups ----------
const openGroups = new Set();
function renderBoardLib() {
  const box = $('boardLibList');
  if (!box || !isHost) return;
  const L = Object.entries(state.boardLib || {}), groups = [...new Set(L.map(([, b]) => b.group))].sort();
  const dl = $('boardGroups'); dl.innerHTML = '';
  for (const g of groups) { const o = document.createElement('option'); o.value = g; dl.appendChild(o); }
  box.innerHTML = '';
  if (!L.length) { box.innerHTML = '<div style="color:var(--dim);font-size:12px">None yet. Pick a board, give it a name and a group, and click <b>Save picked board</b>.</div>'; return; }
  for (const g of groups) {
    const items = L.filter(([, b]) => b.group === g).sort((a, b) => a[1].name.localeCompare(b[1].name));
    const head = document.createElement('div'); head.className = 'libgroup';
    head.textContent = `${openGroups.has(g) ? '▾' : '▸'} ${g} (${items.length})`;
    head.onclick = () => { openGroups.has(g) ? openGroups.delete(g) : openGroups.add(g); renderBoardLib(); };
    box.appendChild(head);
    if (!openGroups.has(g)) continue;
    for (const [id, b] of items) {
      const r = document.createElement('div'); r.className = 'row librow';
      const n = document.createElement('span'); n.style.flex = '1'; n.textContent = `${b.name} `;
      const sz = document.createElement('span'); sz.style.color = 'var(--dim)'; sz.textContent = `${b.cols}x${b.rows}`; n.appendChild(sz);
      const bt = (t, title, fn, cls = 'fit') => { const x = document.createElement('button'); x.className = cls; x.textContent = t; x.title = title; x.onclick = fn; return x; };
      r.append(n,
        bt('Place', 'Put it on the table, to the right of the other boards', () => { const nid = handle({ t: 'boardPlace', lib: id }, clientId); if (nid) pickBoard(nid); }),
        bt('Hidden', 'Put it on the table as a hidden area players have to find', () => { const nid = handle({ t: 'boardPlace', lib: id, hidden: true }, clientId); if (nid) pickBoard(nid); }),
        bt('✎', 'Rename or move to another group', () => {
          const name = prompt('Name', b.name); if (name == null) return;
          const group = prompt('Group (type a new one to make it)', b.group); if (group == null) return;
          openGroups.add(group.trim() || 'Ungrouped'); act({ t: 'boardLibEdit', lib: id, name, group });
        }),
        bt('×', 'Remove from saved boards', () => confirm(`Remove "${b.name}" from your saved boards?`) && act({ t: 'boardLibDel', lib: id }), 'fit danger'));
      box.appendChild(r);
    }
  }
}

// ---------- the GM's saved minis ----------
function renderLibrary() {
  const box = $('libList');
  if (!box || !isHost) return;
  const L = Object.entries(state.library || {}), grp = m => m.group || 'Ungrouped', groups = [...new Set(L.map(([, m]) => grp(m)))].sort();
  const dl = $('miniGroups'); dl.innerHTML = '';
  for (const g of groups) { const o = document.createElement('option'); o.value = g; dl.appendChild(o); }
  box.innerHTML = '';
  if (!L.length) { box.innerHTML = '<div style="color:var(--dim);font-size:12px">None yet. Pick a mini and click <b>Save to list</b> (it goes in the group typed above).</div>'; return; }
  for (const g of groups) {
    const items = L.filter(([, m]) => grp(m) === g).sort((a, b) => a[1].name.localeCompare(b[1].name)), key = 'm:' + g;
    const head = document.createElement('div'); head.className = 'libgroup';
    head.textContent = `${openGroups.has(key) ? '▾' : '▸'} ${g} (${items.length})`;
    head.onclick = () => { openGroups.has(key) ? openGroups.delete(key) : openGroups.add(key); renderLibrary(); };
    box.appendChild(head);
    if (!openGroups.has(key)) continue;
    for (const [id, m] of items) {
      const r = document.createElement('div'); r.className = 'row librow';
      const dot = document.createElement('span'); dot.style.cssText = `width:12px;height:12px;border-radius:50%;flex:0 0 12px;background:${okColor(m.color)}`;
      const n = document.createElement('span'); n.textContent = m.name + (m.st?.species ? ` (${m.st.species})` : ''); n.style.flex = '1';
      const bt = (t, title, fn, cls = 'fit') => { const x = document.createElement('button'); x.className = cls; x.textContent = t; x.title = title; x.onclick = fn; return x; };
      r.append(dot, n,
        bt('Place', 'Put a copy on the table, hidden from players until you show it', () => { const t = controls.target, nid = handle({ t: 'libPlace', lib: id, x: t.x, z: t.z }, clientId); if (nid) select(nid); }),
        bt('✎', 'Rename or move to another group', () => {
          const name = prompt('Name', m.name); if (name == null) return;
          const group = prompt('Group (type a new one to make it)', grp(m)); if (group == null) return;
          openGroups.add('m:' + (group.trim() || 'Ungrouped')); act({ t: 'libEdit', lib: id, name, group });
        }),
        bt('×', 'Remove from the list', () => confirm(`Remove ${m.name} from your saved minis?`) && act({ t: 'libDel', lib: id }), 'fit danger'));
      box.appendChild(r);
    }
  }
}

const _shareT = new THREE.Vector3();
// keep the graphics card free for everything else (Adam: a video on his other monitor stalled with the GM and test windows open):
// at most 60 frames a second, 30 in a window without focus while dice or moves play, 12 while it just sits there
let lastFrame = 0;
function tick(now) {
  const fps = document.hasFocus() ? 60 : rolls.length || fxList.length || dragging ? 30 : 12;
  if (now - lastFrame < 1000 / fps - 2) return;
  lastFrame = now;
  animateDice(performance.now());
  animateFx(performance.now());
  updatePrompts();
  if (tileGroup) { const b = Math.sin(performance.now() / 400) * 0.06; for (const o of tileGroup.children) if (o.userData.bob) o.position.y = o.userData.bob + b; }
  updateOverlays();
  // a bobbing marker over whoever's turn it is
  const shownCombat = isHost && !gmView() ? combatView() : state.combat;
  const cur = shownCombat && figMeshes.get(shownCombat.order[shownCombat.turn]?.id);
  if (cur) {
    if (!turnMarker) {
      turnMarker = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.32, 16).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#7a5a00' }));
      scene.add(turnMarker);
    }
    turnMarker.visible = true;
    const lb = cur.userData.label, top = lb.position.y + lb.scale.y * (1 - lb.center.y) + (cur.userData.timer ? cur.userData.timer.scale.y + 0.04 : 0);   // just above the name tag
    turnMarker.position.set(cur.position.x, cur.position.y + top + 0.3 + Math.sin(performance.now() / 250) * 0.06, cur.position.z);
    turnMarker.rotation.y += 0.03;
  } else if (turnMarker) turnMarker.visible = false;
  if (tilesDirty) buildTiles();
  for (const g of figMeshes.values()) {
    const t = g.userData.target, off = dragging?.id === g.userData.id ? 0 : share.get(g.userData.id) || 0;
    _shareT.set(t.x + off, t.y, t.z + off);       // side by side across the square's diagonal
    g.position.lerp(_shareT, dragging?.id === g.userData.id ? 1 : 0.25);
    g.scale.setScalar(g.scale.x + ((off ? 0.8 : 1) - g.scale.x) * 0.25);   // squeezed in next to another Small
    if (g.userData.labelY != null) g.userData.label.position.y = g.userData.labelY + (off < 0 ? 0.5 : 0);   // name tags one above the other (the back one higher)
    const lb = g.userData.label, tm = g.userData.timer;
    if (tm) tm.position.y = lb.position.y + lb.scale.y * (1 - lb.center.y) + 0.04;
  }
  updateAreas();
  if (areaRings.length) { const k = 0.55 + Math.sin(performance.now() / 180) * 0.35; for (const m of areaRings) m.material.opacity = k; }
  controls.update();
  // keep the near plane in step with the zoom, so thin layers (grid, terrain) don't flicker through each other from far away
  const near = Math.max(0.05, camera.position.distanceTo(controls.target) * 0.03);
  if (Math.abs(near - camera.near) > near * 0.05) { camera.near = near; camera.updateProjectionMatrix(); }
  renderer.render(scene, camera);
}

// ---------- picking and dragging ----------
let dragging = null, lastSend = 0, clickMove = null;
function ndc(e) {
  const r = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}
function figAt(e) {
  raycaster.setFromCamera(ndc(e), camera);
  for (const hit of raycaster.intersectObjects(figRoot.children, true)) {
    let o = hit.object;
    while (o && !o.userData.id) o = o.parent;
    if (o?.visible) return o.userData.id;      // minis hidden in player view can't be picked
  }
  return null;
}
function floorAt(e) {
  raycaster.setFromCamera(ndc(e), camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(floor, p) ? p : null;
}
const canMove = f => f && (gmView() || (!isHost && f.owner === clientId));

let painting = false, paintMode = false, paintType = 'stone', attachFor = null;
let moveBoards = false, boardDrag = null, selBoard = 'b1';
function paintAt(e) {
  const p = floorAt(e), k = p && cellAt(p);
  if (!k) return;
  const want = paintType === 'erase' ? null : paintType;
  if ((state.tiles[k] || null) !== want) act({ t: 'tiles', set: { [k]: want } });
}

let rightClick = null;
const touchy = matchMedia('(pointer: coarse)').matches;
const hintText = () => touchy
  ? 'Drag a mini to move it · hold a mini to turn it · tap an enemy for line of sight · one finger pans · two fingers zoom and rotate'
  : 'Drag a mini to move it · right-click a mini to turn it · right-drag to rotate · drag empty space to pan · scroll to zoom';
function onDown(e) {
  if (e.button === 2 && e.target === renderer.domElement) {
    const id = figAt(e);
    rightClick = id && canMove(state.figures[id]) ? { id, x: e.clientX, y: e.clientY } : null;
    return;                                     // the camera still turns if you drag
  }
  if (e.button !== 0 || e.target !== renderer.domElement) return;
  if (areaDraft) {
    e.stopPropagation();
    const p = floorAt(e);
    if (!p) return;
    if (areaDraft.kind !== 'burst' && !areaDraft.from) { areaDraft.from = { x: Math.floor(p.x) + 0.5, z: Math.floor(p.z) + 0.5 }; status(`Now click the way the ${AREA_KINDS[areaDraft.kind].toLowerCase()} points (Esc to cancel)`); return; }
    const a = draftArea(p);
    endAreaDraft();
    if (a && !preview) act({ t: 'areaAdd', area: a });
    return;
  }
  if (pingArm || e.altKey) {
    e.stopPropagation();
    pingArm = false; status('');
    const p = floorAt(e);
    if (p && !preview) act({ t: 'ping', x: p.x, z: p.z });
    return;
  }
  if (attackFor) {                              // picking who the selected mini attacks
    const to = figAt(e), id = attackFor;
    attackFor = null; status('');
    e.stopPropagation();
    if (to && to !== id) openAttack(id, to);
    select(id);
    return;
  }
  if (attachFor) {                              // picking what the selected piece attaches to
    const to = figAt(e), id = attachFor;
    attachFor = null; status('');
    e.stopPropagation();
    if (to && to !== id) act({ t: 'attach', id, to });
    select(id);
    return;
  }
  if (paintMode && isHost) { e.stopPropagation(); painting = true; paintAt(e); return; }
  if (moveBoards && isHost) {
    const p = floorAt(e), b = p && boardAt(p.x, p.z);
    if (b) { e.stopPropagation(); boardDrag = { id: b.id, sx: p.x, sz: p.z, bx: b.x, bz: b.z }; pickBoard(b.id); }
    return;
  }
  const id = figAt(e);
  if (!id) {                                    // a click (not a drag) on a square sends the selected mini there (Adam)
    const sel = selectedId && state.figures[selectedId];
    if (sel && canMove(sel) && !preview) clickMove = { id: sel.id, x: e.clientX, y: e.clientY, p: floorAt(e) };
    else select(null);
    return;
  }
  const f = state.figures[id];
  const yours = canMove(f) || (preview && preview.as && f.owner === preview.as);
  if (!yours && selectedId && state.figures[selectedId]) { hoverId = hoverId === id ? null : id; return; }
  select(yours ? id : null);
  if (!canMove(f)) return;
  e.stopPropagation();                          // the camera stays put while a mini is dragged
  const p = floorAt(e);
  dragging = { id, dx: p ? f.x - p.x : 0, dz: p ? f.z - p.z : 0, moved: false, from: { x: f.x, z: f.z }, sx: e.clientX, sy: e.clientY };
  figMeshes.get(id).userData.target.y += 0.35;  // lift it a little while held
  if (e.pointerType === 'touch') dragging.hold = setTimeout(() => {
    const d = dragging;
    if (!d || d.id !== id || d.far) return;
    dragging = null;                            // held still: turn it instead of moving it
    const g = figMeshes.get(id), c = fp(f);
    if (g) g.userData.target.set(f.x, groundAt(f.x, f.z, c.w, c.d), f.z);
    act({ t: 'edit', id, turn: true });
    navigator.vibrate?.(25);
  }, 550);
}

function onMove(e) {
  if (painting) { paintAt(e); return; }
  if (boardDrag) {
    const p = floorAt(e), b = state.boards.find(x => x.id === boardDrag.id);
    if (!p || !b) return;
    const x = boardDrag.bx + Math.round(p.x - boardDrag.sx), z = boardDrag.bz + Math.round(p.z - boardDrag.sz);
    if (x !== b.x || z !== b.z) act({ t: 'boardMove', id: b.id, x, z });
    return;
  }
  if (areaDraft) { draftArea(floorAt(e)); return; }
  if (!dragging) {
    if (e.pointerType === 'mouse' && e.target === renderer?.domElement) { const h = figAt(e); if (h !== hoverId) hoverId = h; }
    return;
  }
  if (!dragging.far) {                          // a little wobble isn't a drag (matters for hold-to-turn)
    if (Math.hypot(e.clientX - dragging.sx, e.clientY - dragging.sy) < 8) return;
    dragging.far = true; clearTimeout(dragging.hold);
  }
  const p = floorAt(e);
  if (!p) return;
  const f = state.figures[dragging.id];
  // players may step off the edge onto a hidden area; the GM decides where they end up
  const c = fp(f), pos = isHost ? clampPos(p.x + dragging.dx, p.z + dragging.dz, c.w, c.d) : { x: p.x + dragging.dx, z: p.z + dragging.dz };
  dragging.moved = true;
  figMeshes.get(dragging.id).userData.target.set(pos.x, groundAt(pos.x, pos.z, c.w, c.d) + 0.35, pos.z);
  const now = performance.now();
  if (now - lastSend > 60) { lastSend = now; act({ t: 'move', id: dragging.id, x: pos.x, z: pos.z }); }
}

function onUp(e) {
  if (rightClick && e?.button === 2) {          // a right-click without dragging turns the mini
    if (Math.hypot(e.clientX - rightClick.x, e.clientY - rightClick.y) < 6) { act({ t: 'edit', id: rightClick.id, turn: true }); select(rightClick.id); }
    rightClick = null;
  }
  painting = false; boardDrag = null;
  const cm = clickMove; clickMove = null;
  if (cm && e && Math.hypot(e.clientX - cm.x, e.clientY - cm.y) < 6 && cm.p && state.figures[cm.id]) {   // didn't pan the camera: move
    const c = fp(state.figures[cm.id]);
    const pos = isHost ? snapPos(cm.p.x, cm.p.z, c.w, c.d) : { x: gridSnap(cm.p.x, c.w), z: gridSnap(cm.p.z, c.d) };
    act({ t: 'move', id: cm.id, x: pos.x, z: pos.z, snap: true, done: true });
    return;
  }
  if (!dragging) return;
  clearTimeout(dragging.hold);
  const d = dragging, g = figMeshes.get(d.id);
  dragging = null;
  if (!g) return;
  const t = g.userData.target;
  const f = state.figures[d.id];
  const c = fp(f);
  const pos = isHost ? (snapOn() ? snapPos(t.x, t.z, c.w, c.d) : clampPos(t.x, t.z, c.w, c.d))
    : (snapOn() ? { x: gridSnap(t.x, c.w), z: gridSnap(t.z, c.d) } : { x: t.x, z: t.z });
  t.set(pos.x, groundAt(pos.x, pos.z, c.w, c.d), pos.z);
  if (d.moved) act({ t: 'move', id: d.id, x: pos.x, z: pos.z, snap: snapOn(), done: true });
}

// =====================================================================
// Side panel
// =====================================================================
function select(id) {
  const prev = selectedId; selectedId = id;
  if (typeof renderParty === 'function' && $('partySec')) renderParty();
  if (prev && figMeshes.get(prev)) figMeshes.get(prev).userData.ring.visible = false;
  if (id && figMeshes.get(id)) figMeshes.get(id).userData.ring.visible = true;
  showSelected(); renderBag();
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
  const c = fp(f), preset = c.w === c.d && SIZE_CELLS[f.size] === c.w;
  $('selSize').value = preset ? f.size : 'custom';
  $('selCustom').style.display = preset ? 'none' : 'flex';
  if (document.activeElement !== $('selW')) $('selW').value = c.w;
  if (document.activeElement !== $('selD')) $('selD').value = c.d;
  const st = f.st || {};
  for (const k of ['dex', 'alert', 'hp', 'hpMax']) if (document.activeElement !== $('st_' + k)) $('st_' + k).value = st[k] ?? '';
  $('stMove').textContent = st.dex != null ? `Moves ${moveBudget(f)} squares a turn (${moveBudget(f) !== ownMove(f) ? 'the slowest of its attached minis' : '2 + Dexterity' + ((st.status || []).includes('Immobilized') ? ', Immobilized' : '')}).` : 'Set Dexterity to see how far it can move.';
  const chips = $('stChips'); chips.innerHTML = '';
  for (const x of st.status || []) {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = x + (st.timers?.[x] ? ` ⏳${st.timers[x]}` : '') + ' ×'; b.title = 'Remove';
    b.onclick = () => act({ t: 'stats', id: f.id, status: (f.st?.status || []).filter(y => y !== x) });
    chips.appendChild(b);
  }
  // players change name, colour and facing; the GM everything; in player view nothing
  const look = gmView() || (!isHost && f.owner === clientId), all = gmView();
  $('selAttack').style.display = look ? '' : 'none';
  $('speciesRow').style.display = all ? '' : 'none';
  if (document.activeElement !== $('selSpecies')) $('selSpecies').value = st.species || '';
  $('speciesInfo').textContent = st.species ? `${(st.types || []).join('/')}${st.types?.length ? ' · ' : ''}` + ['Strength', 'Dexterity', 'Vitality', 'Special', 'Insight'].map(k => `${k.slice(0, 3)} ${st.attr?.[k] ?? '-'}`).join(' · ') : '';
  for (const id of ['selName', 'selColor', 'selTurn']) $(id).disabled = !look;
  $('selSizeBox').style.display = all ? '' : 'none';
  if (!all) $('selCustom').style.display = 'none';
  for (const id of ['st_dex', 'st_alert', 'st_hp', 'st_hpMax', 'hpDown', 'hpUp', 'stStatus', 'stRounds', 'stAdd']) $(id).disabled = !all;
  $('stEditRow').style.display = $('stStatusRow').style.display = all ? 'flex' : 'none';
  for (const b of chips.children) b.disabled = !all;
  if (!all) for (const b of chips.children) b.textContent = b.textContent.replace(' ×', '');
  if (isHost) {
    const sm = $('selModel'); sm.innerHTML = '<option value="">Pawn (no model)</option>';
    for (const [id, m] of Object.entries(state.models)) { const o = document.createElement('option'); o.value = id; o.textContent = m.name; sm.appendChild(o); }
    const have = new Set(Object.values(state.models).map(m => m.name));
    for (const [key, b] of Object.entries(BUILTIN)) if (!have.has(b.name)) { const o = document.createElement('option'); o.value = 'builtin:' + key; o.textContent = b.name; sm.appendChild(o); }
    sm.value = f.model || '';
  }
  if (isHost) {
    const par = f.parent && state.figures[f.parent];
    $('selParent').textContent = par ? par.name : 'nothing';
    $('selDetach').style.display = par ? '' : 'none';
  }
  if (isHost) {
    const inFight = state.combat?.order.some(o => o.id === f.id);
    $('selFight').style.display = state.combat ? '' : 'none';
    $('selFight').textContent = inFight ? 'Take out of turn order' : 'Add to turn order';
  }
  if (isHost) { ownerOptions($('selOwner'), f.owner); $('selHide').textContent = f.hidden ? 'Show to players' : 'Hide from players'; }
  if (isHost) renderSiteChars();
  renderActBar();
  if (isHost) {
    const sd = sideOf(f);
    $('selSide').value = sd;
    $('selJobRow').style.display = sd === 'npc' ? '' : 'none';
    $('selOwnerRow').style.display = sd === 'player' ? '' : 'none';
    if (document.activeElement !== $('selJob')) $('selJob').value = f.job || '';
  }
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
function renderLog() { $('log').innerHTML = ''; state.log.filter(e => !e.to || !isHost || gmView() || e.to === viewerId()).forEach(renderLogEntry); }

function updateBoardInputs() {
  if (!isHost || !$('boardList')) return;
  setTimeout(updateFoldNotes);
  if (!state.boards.some(b => b.id === selBoard && gmSees(b))) selBoard = (state.boards.find(gmSees) || state.boards[0]).id;
  const list = $('boardList'); list.innerHTML = '';
  state.boards.filter(gmSees).forEach((b, n) => {
    const btn = document.createElement('button');
    btn.textContent = `Board ${n + 1} (${b.cols}×${b.rows})`;
    btn.classList.toggle('on', b.id === selBoard);
    btn.onclick = () => pickBoard(b.id);
    list.appendChild(btn);
  });
  const b = state.boards.find(x => x.id === selBoard);
  if (document.activeElement !== $('cols')) $('cols').value = b.cols;
  if (document.activeElement !== $('rows')) $('rows').value = b.rows;
  $('gridOn').checked = b.grid;
  $('delBoard').disabled = state.boards.length < 2;
  renderRules(); renderLayers();
}
function pickBoard(id) { selBoard = id; updateBoardInputs(); buildBoard(); }
const curBoard = () => state.boards.find(x => x.id === selBoard) || state.boards[0];

function renderCombat() {
  const c = isHost && !gmView() ? combatView() : state.combat;
  $('combatSec').style.display = c ? 'block' : 'none';
  if (isHost) { $('combatStart').style.display = c ? 'none' : ''; $('combatEndBtn').style.display = c ? '' : 'none'; }
  if (!c) return;
  $('combatRound').textContent = `Round ${c.round}`;
  const list = $('turnList'); list.innerHTML = '';
  c.order.forEach((o, n) => {
    const f = state.figures[o.id];
    if (!f) return;
    const d = document.createElement('div');
    d.className = 'turn' + (n === c.turn ? ' now' : '');
    d.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="ini"></span>';
    d.children[0].style.background = f.color;
    d.children[1].textContent = f.name + (f.st?.hpMax ? `  ${f.st.hp ?? f.st.hpMax}/${f.st.hpMax} HP` : '');
    d.children[2].textContent = o.init;
    d.onclick = () => { select(canMove(f) ? f.id : null); controls.target.set(f.x, 0, f.z); };
    list.appendChild(d);
  });
  const me = viewerId();
  const cur = state.figures[c.order[c.turn]?.id], mine = cur && (gmView() || (!!me && cur.owner === me));
  $('turnBtns').style.display = mine ? 'flex' : 'none';
  $('turnWho').textContent = cur ? (me && cur.owner === me ? `Your turn (${cur.name})` : `${cur.name}'s turn`) + (c.dash ? ' · dashed (action used)' : '') : "The GM's turn";
  $('turnDash').textContent = c.dash ? 'Undo dash' : 'Dash';
  $('turnDash').title = c.dash ? 'Take the Dash back (only if you are still within your normal move)' : 'Spend your action on extra movement (once a turn)';
  $('turnDash').disabled = $('turnEnd').disabled = !!preview;   // looking only
}

// exploring: the party's turn, with a Dash for your mini (or the picked one, for the GM)
function partyMini() {
  const sel = selectedId && state.figures[selectedId];
  if (sel?.owner && canMove(sel)) return sel;
  return Object.values(state.figures).find(f => f.owner && f.owner === viewerId());
}
function renderParty() {
  const P = state.party || { turn: 1, from: {}, dash: {} }, on = !state.combat;
  $('partySec').style.display = on ? 'block' : 'none';
  if (!on) return;
  $('partyTurn').textContent = `Party turn ${P.turn}`;
  const f = partyMini(), look = !!preview;
  $('partyDash').style.display = f ? '' : 'none';
  if (f) {
    $('partyDash').textContent = P.dash[f.id] ? `Undo dash (${f.name})` : `Dash (${f.name})`;
    $('partyDash').disabled = look;
  }
  $('partyNext').style.display = gmView() ? '' : 'none';
}

// the GM's panel tabs (remembered per browser)
let gmTab = 'minis';
function setTab(t) {
  if (t === 'table') t = 'combat';               // Combat and Table are one tab now
  gmTab = t;
  for (const b of document.querySelectorAll('#gmTabs button')) b.classList.toggle('on', b.dataset.tab === t);
  for (const sec of document.querySelectorAll('section[data-tab]')) sec.classList.toggle('tabOn', sec.dataset.tab.split(' ').includes(t));
  try { localStorage.setItem('tabletop.gmTab', t); } catch {}
}

function pickPaint(type) {
  setTab('terrain');
  const b = $('tileTypes').querySelector(`[data-type=${type}]`);
  const sec = document.querySelector('[data-fold=terrain]');
  if (sec && !sec.classList.contains('open')) sec.firstElementChild.click();
  b?.click();
  status(`Click the board to place: ${TILES[type].name} (turn Paint off when done)`); setTimeout(() => status(''), 5000);
}

function renderEvent() {
  if (!isHost) return;
  const paused = !!((state.pending || []).length || state.event || rollingEvent);
  if (paused !== state.paused) {
    state.paused = paused;
    sendAll({ t: 'paused', on: paused });
    addLog({ kind: 'sys', text: paused ? '⏸ Paused while the GM resolves an event.' : '▶ The event is resolved: play on.' });
  }
  renderPause();
  $('eventBox').style.display = gmView() && ((state.pending || []).length || state.event) ? '' : 'none';
  const box = $('eventBox'), P = state.pending || [], E = state.event;
  box.innerHTML = '';
  for (const p of P) {
    const kind = p.kind || 'event', d = document.createElement('div'); d.className = 'evwait';
    const label = { event: `${p.who} checked a ?`, chest: `${p.who} opened a chest`, clue: `${p.who} found a clue`, goal: `${p.who} reached the Dungeon Goal` }[kind];
    d.innerHTML = '<span></span><span class="evbtns"></span>';
    d.firstChild.textContent = label;
    const add = (t, fn, cls) => { const b = document.createElement('button'); b.textContent = t; if (cls) b.className = cls; b.onclick = fn; d.lastChild.appendChild(b); };
    if (kind === 'event') add('🎲 Throw the event d6', () => act({ t: 'dungeonEvent', pid: p.id }), 'primary big');
    if (kind === 'chest') add('Roll loot (2d6)', () => act({ t: 'pendingDone', pid: p.id, tool: 'loot', mod: +prompt('Floor modifier? (top third -1, bottom third +1, final floor/vault +2, else 0)', '0') || 0 }), 'primary');
    if (kind === 'clue') {
      add('Next clue: roll where', () => act({ t: 'pendingDone', pid: p.id, tool: 'direction' }), 'primary');
      add('It leads to the goal', () => act({ t: 'pendingDone', pid: p.id, tell: `The clue points the way to the Dungeon Goal!` }));
    }
    if (kind === 'goal') add('Mission complete!', () => act({ t: 'pendingDone', pid: p.id, tell: `${p.who} reached the Dungeon Goal: mission complete!` }), 'primary');
    if (kind !== 'event') add('Dismiss', () => act({ t: 'pendingDone', pid: p.id }));
    box.appendChild(d);
  }
  if (E) {
    const info = EVENT_INFO[E.n], card = document.createElement('div'); card.className = 'evcard';
    card.innerHTML = '<div class="evt"></div><div class="evx"></div><div class="row evb"></div>';
    card.querySelector('.evt').textContent = E.trap ? `Trap sprung by ${E.who}` : `${E.n} = ${info.name}` + (E.who ? ` (${E.who}'s ?)` : '');
    card.querySelector('.evx').textContent = info.text;
    const btns = card.querySelector('.evb');
    const add = (label, fn, cls) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.onclick = fn; btns.appendChild(b); };
    if (info.tools.includes('direction')) add('Roll direction + distance', () => act({ t: 'eventTool', tool: 'direction' }));
    if (info.tools.includes('loot')) add('Roll loot (2d6)', () => act({ t: 'eventTool', tool: 'loot', mod: +prompt('Floor modifier? (top third -1, bottom third +1, final floor/vault +2, else 0)', '0') || 0 }));
    if (info.tools.includes('threat')) { add(`Threat ${state.threat || 0}/6  +1`, () => act({ t: 'eventTool', tool: 'threat', delta: 1 })); add('−1', () => act({ t: 'eventTool', tool: 'threat', delta: -1 })); }
    if (info.tools.includes('combat') && !state.combat) add('Start combat', () => act({ t: 'combatStart' }));
    const prop = { 1: ['hiddenTrap', 'Place a hidden trap'], 2: ['camp', 'Place enemy camp'], 3: ['chest', 'Place treasure chest'],
      4: ['guild', 'Place guild flag'], 5: ['campfire', 'Place campfire'], 6: ['clue', 'Place clue'] }[E.n];
    if (prop) add(prop[1], () => pickPaint(prop[0]));
    add('Tell the players', () => act({ t: 'eventTool', tool: 'tell' }));
    add('Done', () => act({ t: 'eventTool', tool: 'done' }), 'primary');
    box.appendChild(card);
  }
}

// everyone sees the pause; turn buttons wait
function renderPause() {
  $('pauseBar').style.display = state.paused ? '' : 'none';
  $('pauseBar').textContent = isHost && gmView() ? '⏸ Paused for players until you resolve the event (throw the die, then Done on the card).'
    : '⏸ Paused: the GM is resolving an event.';
  for (const id of ['turnEnd', 'turnDash', 'partyDash']) if ($(id)) $(id).classList.toggle('waiting', !!state.paused);
}

function renderRules() {
  if (!isHost) return;
  $('ruleLimit').checked = state.rules.limit;
  $('ruleReveal').checked = state.rules.autoReveal;
  $('ruleEdgeWalls').checked = state.rules.edgeWalls !== false;
  $('explored').textContent = state.explored;
  const b = curBoard();
  $('hideBoard').textContent = b?.hidden ? 'Show to players' : 'Hide from players';
}

function setPreview(on, as = '') {
  preview = on ? { as } : null;
  document.body.classList.toggle('gm', gmView());
  document.body.classList.toggle('previewing', !!preview);
  select(null);
  $('previewAs').innerHTML = '<option value="">Any player</option>';
  for (const [cid, p] of Object.entries(state.players)) if (cid !== state.gm) { const o = document.createElement('option'); o.value = cid; o.textContent = p.name; $('previewAs').appendChild(o); }
  $('previewAs').value = as;
  overlayKey = '';
  rebuildAll();
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
  $('hint').textContent = hintText();
  document.body.classList.toggle('gm', isHost);
  $('roomCode').textContent = roomCode;
  $('whoAmI').textContent = isHost ? `You are the GM (${myName}). You can move everything.` : `You are ${myName}. You can move your own mini (white ring).`;
  if (!renderer) { initView(); wirePanel(); }
  rebuildAll();
}

// a newer version was published: offer a reload (the GM's game and the players' minis come back as they were)
async function checkVersion() {
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (r.ok && (await r.json()).v > VERSION) $('updateBar').style.display = 'flex';
  } catch { /* offline or opened from a file: nothing to check */ }
}

for (const b of document.querySelectorAll('#gmTabs button')) b.onclick = () => setTab(b.dataset.tab);
{ let t = 'minis'; try { t = localStorage.getItem('tabletop.gmTab') || t; } catch {} setTab(t); }
// Terrain and Boards fold away: click the title to open or close (remembered per browser)
function wireFolds() {
  for (const sec of document.querySelectorAll('section.fold')) {
    const body = document.createElement('div'); body.className = 'foldBody';
    for (const el of [...sec.children].slice(1)) body.appendChild(el);
    sec.appendChild(body);
    const key = 'tabletop.fold.' + sec.dataset.fold;
    if (store.get(key)) sec.classList.add('open');
    sec.firstElementChild.onclick = () => store.set(key, sec.classList.toggle('open'));
  }
}
function updateFoldNotes() {
  $('terrainNow').textContent = (paintMode ? 'painting · ' : '') + (paintType === 'erase' ? 'Eraser' : TILES[paintType]?.name || '');
  const b = curBoard(), n = state.boards.indexOf(b) + 1;
  $('boardsNow').textContent = b ? `Board ${n} of ${state.boards.length}` + (b.hidden ? ' · hidden' : '') : '';
}

function wirePanel() {
  wireFolds();
  $('verLabel').textContent = 'v' + VERSION;
  $('updateReload').onclick = () => location.reload();
  checkVersion(); setInterval(checkVersion, 120000);
  for (const s of [4, 6, 8, 10, 12, 20, 100]) {
    const b = document.createElement('button'); b.textContent = 'd' + s;
    b.onclick = () => {
      // throw from where you're looking, away from your camera
      const t = controls.target, dir = t.clone().sub(camera.position);
      act({ t: 'roll', sides: s, n: +$('diceN').value || 1, hidden: $('diceHidden').checked,
        phys: $('dice3d').checked, at: { x: t.x, z: t.z }, dir: { x: dir.x / (Math.hypot(dir.x, dir.z) || 1), z: dir.z / (Math.hypot(dir.x, dir.z) || 1) } });
    };
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
  $('selSize').onchange = () => {
    if (!selectedId) return;
    if ($('selSize').value === 'custom') { $('selCustom').style.display = 'flex'; return; }
    act({ t: 'edit', id: selectedId, size: $('selSize').value });
  };
  $('selW').onchange = $('selD').onchange = () => selectedId && act({ t: 'edit', id: selectedId, w: $('selW').value, d: $('selD').value });
  $('selOwner').onchange = () => selectedId && act({ t: 'edit', id: selectedId, owner: $('selOwner').value || null });
  $('selSide').onchange = () => selectedId && act({ t: 'edit', id: selectedId, side: $('selSide').value });
  $('selSite').onchange = () => selectedId && act({ t: 'siteLink', id: selectedId, char: $('selSite').value });
  $('siteCode').onchange = () => act({ t: 'siteCode', code: $('siteCode').value });
  $('selJob').onchange = () => selectedId && act({ t: 'edit', id: selectedId, job: $('selJob').value });
  const newSide = () => {
    const sd = $('newSide').value;
    $('newJob').style.display = sd === 'npc' ? '' : 'none';
    $('newOwner').style.display = sd === 'player' ? '' : 'none';
  };
  $('newSide').onchange = newSide; newSide();
  $('selHide').onclick = () => selectedId && act({ t: 'edit', id: selectedId, hidden: !state.figures[selectedId].hidden });
  $('selTurn').onclick = () => selectedId && act({ t: 'edit', id: selectedId, turn: true });
  $('selModel').onchange = () => {
    const v = $('selModel').value;
    if (!selectedId) return;
    if (v.startsWith('builtin:')) useBuiltin(v.slice(8), selectedId);
    else act({ t: 'edit', id: selectedId, model: v });
  };
  $('modelFile').onchange = async () => {
    const file = $('modelFile').files[0];
    $('modelFile').value = '';
    if (!file || !selectedId) return;
    if (file.size > MAX_MODEL) { alert('That model is too big (over 15 MB). Try a smaller or simplified one.'); return; }
    const data = fixGlb(await file.arrayBuffer());
    try { await new Promise((ok, bad) => new GLTFLoader().parse(data.slice(0), '', ok, bad)); }
    catch { alert('That file could not be read as a 3D model. Use a .glb file.'); return; }
    act({ t: 'model', id: await modelId(data), name: file.name.replace(/\.glb$/i, ''), data, figId: selectedId });
  };
  $('selAttach').onclick = () => {
    if (!selectedId) return;
    attachFor = selectedId;
    status(`Click the piece to attach ${state.figures[selectedId].name} to (Esc to cancel)`);
  };
  $('selDetach').onclick = () => selectedId && act({ t: 'attach', id: selectedId, to: null });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && (attachFor || attackFor)) { attachFor = attackFor = null; status(''); }
    if (e.key === 'Escape' && (areaDraft || pingArm)) { pingArm = false; endAreaDraft(); }
    else if (e.key === 'Escape' && selectedId && !attachFor && !attackFor && document.activeElement?.tagName !== 'INPUT') select(null);
  });
  $('areaPlace').onclick = startAreaDraft;
  const floorOpts = () => ({ name: $('floorName').value, floor: $('floorNum').value, look: $('floorLook').value, size: $('floorSize').value,
    enemies: $('floorFoes').value, foes: $('floorFoeNames').value, items: $('floorItems').value, events: $('floorEvents').value, traps: $('floorTraps').value });
  $('floorMake').onclick = () => {
    const b = curBoard();
    if (!b || !confirm(`Make a random floor on board "${b.name || b.id}"? Its terrain and every mini on it except the players' are replaced.`)) return;
    act({ t: 'floorGen', board: b.id, opts: floorOpts() });
  };
  $('floorNext').onclick = () => {
    const D = state.dungeon;
    if (!D) { alert('Make a floor first.'); return; }
    act({ t: 'floorGen', board: D.board, opts: { ...floorOpts(), floor: D.floor + 1 } });
  };
  $('floorShow').onclick = () => {
    if (!state.fog || !Object.keys(state.fog.hid).some(k => { const [i, j] = k.split(',').map(Number); return shown(boardAt(i + 0.5, j + 0.5)); })) { alert('The players can already see the whole floor.'); return; }
    if (confirm('Show the players every room on this floor now?')) act({ t: 'fogOff' });
  };
  $('areaClear').onclick = () => act({ t: 'areaClear' });
  $('pingBtn').onclick = () => { endAreaDraft(); pingArm = true; status('Click a square to ping it for everyone (Esc to cancel)'); };
  $('selAttack').onclick = () => {
    if (!selectedId) return;
    attackFor = selectedId;
    status(`${touchy ? 'Tap' : 'Click'} the mini ${state.figures[selectedId].name} attacks (Esc to cancel)`);
  };
  $('atkMove').oninput = () => pickMove();
  $('actAttack').onclick = () => {
    const f = actMini(); if (!f) return;
    select(f.id); attackFor = f.id;
    status(`${touchy ? 'Tap' : 'Click'} the mini ${f.name} attacks (Esc to cancel)`);
  };
  $('actDash').onclick = () => { const f = actMini(); if (!f) return; act(state.combat ? { t: 'combatDash' } : { t: 'partyDash', id: f.id }); };
  $('actEnd').onclick = () => { const f = actMini(); if (!f) return; act(state.combat ? { t: 'combatNext' } : { t: 'partyDone', id: f.id }); };
  $('actBag').onclick = () => { const b = $('bagPanel'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; $('actPanel').style.display = 'none'; renderBag(); };
  $('bagClose').onclick = () => { $('bagPanel').style.display = 'none'; };
  $('actMore').onclick = () => { const b = $('actPanel'); b.style.display = b.style.display === 'none' ? 'block' : 'none'; $('bagPanel').style.display = 'none'; renderActions(); };
  $('actClose').onclick = () => { $('actPanel').style.display = 'none'; };
  for (const name of Object.keys(ITEMS)) { const o = document.createElement('option'); o.value = name; $('bagItems').appendChild(o); }
  $('bagAddBtn').onclick = () => { const name = $('bagName').value.trim(); if (name) act({ t: 'bagAdd', name, n: +$('bagN').value || 1 }); $('bagName').value = ''; $('bagN').value = '1'; };
  $('atkAcc').onclick = () => attackMsg('acc');
  $('atkDmg').onclick = () => attackMsg('dmg');
  $('atkClose').onclick = () => closeAttack();
  $('libSave').onclick = () => {
    if (!selectedId) return;
    const group = $('miniGroup').value.trim() || 'Ungrouped';
    openGroups.add('m:' + group);
    act({ t: 'libSave', id: selectedId, group });
  };
  $('boardSave').onclick = () => {
    const b = curBoard(), group = $('boardGroup').value.trim() || 'Ungrouped';
    if (!b) return;
    openGroups.add(group);
    act({ t: 'boardSave', id: b.id, name: $('boardSaveName').value, group });
    $('boardSaveName').value = '';
  };
  $('selSpecies').onfocus = async () => {
    const dl = $('speciesList');
    if (dl.childElementCount) return;
    for (const sp of (await loadIndex()).species) { const o = document.createElement('option'); o.value = sp.name; dl.appendChild(o); }
  };
  $('selSpecies').onchange = async () => {
    const name = $('selSpecies').value.trim().toLowerCase(), sp = (await loadIndex()).species.find(x => x.name.toLowerCase() === name);
    if (sp && selectedId) act({ t: 'species', id: selectedId, name: sp.name, attr: sp.attr, hp: sp.hp, types: sp.types, moves: sp.moves });
  };

  let lastGroup = '';
  for (const [type, t] of [...Object.entries(TILES), ['erase', { name: 'Eraser', color: 'transparent', group: 'Tools' }]]) {
    if (t.group !== lastGroup) {
      lastGroup = t.group;
      const hd = document.createElement('div'); hd.className = 'tilehead'; hd.textContent = t.group;
      $('tileTypes').appendChild(hd);
    }
    const b = document.createElement('button');
    b.dataset.type = type;
    b.innerHTML = '<i></i><span></span>';
    b.firstChild.style.background = type === 'erase' ? 'repeating-linear-gradient(45deg,#555 0 4px,#222 4px 8px)' : t.color;
    b.lastChild.textContent = t.name;
    b.onclick = () => {
      paintType = type;
      for (const x of $('tileTypes').querySelectorAll('button')) x.classList.toggle('on', x === b);
      updateFoldNotes();
      setPaint(true);
    };
    $('tileTypes').appendChild(b);
  }
  $('tileTypes').querySelector('[data-type=stone]').classList.add('on');
  const setPaint = on => {
    paintMode = on;
    if (on) setMoveBoards(false);
    $('paintBtn').textContent = on ? 'Paint: ON' : 'Paint: off';
    $('paintBtn').classList.toggle('on', on);
    updateFoldNotes();
    $('hint').textContent = on ? (touchy ? 'Painting: tap or drag to place tiles · two fingers to zoom and rotate' : 'Painting: click or drag to place tiles · right-drag to rotate · scroll to zoom')
      : hintText();
  };
  $('paintBtn').onclick = () => setPaint(!paintMode);
  $('fillTiles').onclick = () => {
    if (paintType === 'erase') return;
    const set = {};
    const b = curBoard();                      // fills the board picked under Boards
    for (let i = 0; i < b.cols; i++) for (let j = 0; j < b.rows; j++) set[(b.x + i) + ',' + (b.z + j)] = paintType;
    act({ t: 'tiles', set });
  };
  $('clearTiles').onclick = () => { if (confirm('Remove all terrain?')) act({ t: 'tiles', set: {}, clear: true }); };
  $('selFight').onclick = () => selectedId && act({ t: 'combatJoin', id: selectedId });
  $('selDel').onclick = () => { if (selectedId && confirm('Delete this mini?')) act({ t: 'del', id: selectedId }); };
  // a real player window next to the GM's: moves, End turn and Dash all work there
  $('previewBtn').onclick = () => window.open(location.origin + location.pathname + '?room=' + roomCode + '&test=1', 'tabletop-test-player', 'width=1100,height=750');
  $('peekBtn').onclick = () => setPreview(true);
  $('previewBack').onclick = () => setPreview(false);
  $('previewAs').onchange = () => setPreview(true, $('previewAs').value);
  for (const k of ['dex', 'alert', 'hp', 'hpMax']) $('st_' + k).onchange = () => selectedId && act({ t: 'stats', id: selectedId, [k]: $('st_' + k).value });
  for (const x of STATUSES) { const o = document.createElement('option'); o.value = o.textContent = x; $('stStatus').appendChild(o); }
  $('stAdd').onclick = () => {
    const f = selectedId && state.figures[selectedId], x = $('stStatus').value;
    const r = Math.round(+$('stRounds').value);
    if (f && x) act({ t: 'stats', id: f.id, status: [...(f.st?.status || []), x], timers: { [x]: r > 0 ? r : 0 } });
    $('stStatus').value = ''; $('stRounds').value = '';
  };
  $('hpDown').onclick = () => { const f = state.figures[selectedId]; if (f?.st?.hpMax) act({ t: 'stats', id: f.id, hp: Math.max(0, (f.st.hp ?? f.st.hpMax) - 1) }); };
  $('hpUp').onclick = () => { const f = state.figures[selectedId]; if (f?.st?.hpMax) act({ t: 'stats', id: f.id, hp: Math.min(f.st.hpMax, (f.st.hp ?? f.st.hpMax) + 1) }); };
  $('turnEnd').onclick = () => act({ t: 'combatNext' });
  $('partyDash').onclick = () => { const f = partyMini(); if (f) act({ t: 'partyDash', id: f.id }); };
  $('partyNext').onclick = () => act({ t: 'partyNext' });
  $('turnDash').onclick = () => act({ t: 'combatDash' });
  $('combatStart').onclick = () => act({ t: 'combatStart' });
  $('combatEndBtn').onclick = () => { if (confirm('End combat?')) act({ t: 'combatEnd' }); };
  $('ruleLimit').onchange = () => act({ t: 'rules', limit: $('ruleLimit').checked });
  $('ruleEdgeWalls').onchange = () => act({ t: 'rules', edgeWalls: $('ruleEdgeWalls').checked });
  $('ruleReveal').onchange = () => act({ t: 'rules', autoReveal: $('ruleReveal').checked });
  $('eventRoll').onclick = () => { const t = controls.target; act({ t: 'dungeonEvent', at: { x: t.x, z: t.z } }); };
  $('wallBoard').onclick = () => { const b = curBoard(); if (b) act({ t: 'boardWalls', id: b.id }); };
  $('hideBoard').onclick = () => { const b = curBoard(); act({ t: 'boardHide', id: b.id, hidden: !b.hidden }); };
  $('addHiddenBoard').onclick = () => { const b = curBoard(); const id = handle({ t: 'boardAdd', cols: b.cols, rows: b.rows, hidden: true }, clientId); if (id) pickBoard(id); };

  $('addFig').onclick = () => {
    const t = controls.target;
    const id = handle({ t: 'add', name: $('newName').value, color: $('newColor').value, side: $('newSide').value, job: $('newJob').value,
      owner: $('newOwner').value || null, x: t.x, z: t.z }, clientId);
    if (id && $('newHidden').checked) handle({ t: 'edit', id, hidden: true }, clientId);
    if (id) select(id);
  };
  $('applyBoard').onclick = () => act({ t: 'boardEdit', id: curBoard().id, cols: $('cols').value, rows: $('rows').value });
  $('gridOn').onchange = () => act({ t: 'boardEdit', id: curBoard().id, grid: $('gridOn').checked });
  $('addBoard').onclick = () => { const b = curBoard(); const id = handle({ t: 'boardAdd', cols: b.cols, rows: b.rows, layer: gmLayer }, clientId); if (id) pickBoard(id); };
  $('layerPick').onchange = () => viewLayer(+$('layerPick').value);
  $('layerNew').onclick = () => {
    const L = Math.max(...state.boards.map(layerOf)) + 1;
    gmLayer = L;
    const id = handle({ t: 'boardAdd', cols: 28, rows: 20, layer: L, hidden: false }, clientId);
    if (id) viewLayer(L);
  };
  $('layerLive').onclick = () => {
    if (confirm(`Move the team to layer ${gmLayer}? Players will only see that layer from now on.`)) handle({ t: 'layerLive', layer: gmLayer }, clientId);
  };
  $('delBoard').onclick = () => { if (state.boards.length > 1 && confirm('Delete this board (and the terrain on it)?')) act({ t: 'boardDel', id: curBoard().id }); };
  function setMoveBoards(on) {
    moveBoards = on;
    $('moveBoards').textContent = on ? 'Move boards: ON' : 'Move boards: off';
    $('moveBoards').classList.toggle('on', on);
    if (on && paintMode) $('paintBtn').click();
    $('hint').textContent = on ? 'Moving boards: drag a board to move it (it snaps to whole squares) · ' + (touchy ? 'two fingers to zoom and rotate' : 'right-drag to rotate · scroll to zoom')
      : hintText();
  }
  $('moveBoards').onclick = () => setMoveBoards(!moveBoards);
  addEventListener('keydown', e => {            // Esc: stop painting / moving boards (Adam)
    if (e.key !== 'Escape' || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    painting = false; boardDrag = null;
    if (paintMode) setPaint(false);
    if (moveBoards) setMoveBoards(false);
  });
  $('mapFile').onchange = async () => {
    const file = $('mapFile').files[0];
    if (!file) return;
    try {
      const m = await readMap(file);
      // keep the squares square: match the rows to the picture's shape
      const b = curBoard(), rows = Math.max(2, Math.min(80, Math.round(b.cols * m.h / m.w)));
      act({ t: 'boardEdit', id: b.id, rows });
      act({ t: 'map', id: b.id, map: m.data });
      updateBoardInputs();
    } catch { alert('Could not read that picture.'); }
    $('mapFile').value = '';
  };
  $('clearMap').onclick = () => act({ t: 'map', id: curBoard().id, map: null });
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
  if (!testWindow) store.set('tabletop.name', n);
  return n;
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
if (testWindow && params.get('room')) { $('nameIn').value = 'Test player'; $('joinBtn').click(); }   // straight in

// for testing in a browser console
window.tabletop = { get state() { return state; }, act, get isHost() { return isHost; }, clientId, get view() { return { camera, controls, scene, renderer }; }, get overlays() { return { range: rangeMesh?.count ?? 0, los: losLabel ? 1 : 0, engaged: [...engaged] }; },
  hover(id) { hoverId = id; },
  get areaView() { return { rings: areaRings.length, cells: areaGroup?.children[0]?.count || 0, fx: fxList.length, draft: !!draftGroup }; },
  timerOn(id) { return !!figMeshes.get(id)?.userData.timer; },
  attackPanel(id, target) { return openAttack(id, target); },
  pick(id) { select(id); },
  async addModel(data, name, figId) { act({ t: 'model', id: await modelId(data), name, data, figId }); } };
