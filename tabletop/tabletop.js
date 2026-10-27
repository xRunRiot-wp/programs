// Tabletop: a shared 2D board with 3D minis.
// The GM's browser is the host: it holds the game and checks every change.
// Players connect to it with PeerJS (browser-to-browser), so no server is needed.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { dieKit, dieMaterials, simulate, readDie } from './dice.js?v=26';
import { reachable, lineOfSight, distance, adjacent, cellsOf, BLOCKS_MOVE, STATUSES, DUNGEON_EVENTS, EVENT_INFO, directionFor, lootFor } from './rules.js?v=26';

const VERSION = 26;                              // raised by bump.py on every publish
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
    pending: [], event: null, threat: 0, paused: false };                     // GM-only: events waiting / shown
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
  for (const [k, t] of Object.entries(state.tiles)) if (tileVisible(k)) tiles[k] = t;
  return { boards: state.boards.filter(b => !b.hidden), figures, players: state.players, log: state.log.filter(l => !l.to), gm: state.gm,
    models: state.models, tiles, combat: combatView(), rules: state.rules, explored: state.explored, party: state.party, pending: [], event: null, threat: 0, paused: state.paused };
}
const figVisible = f => !f.hidden && !boardAt(f.x, f.z)?.hidden;
const tileVisible = k => { const [i, j] = k.split(',').map(Number); return state.tiles[k] !== 'hiddenTrap' && !boardAt(i + 0.5, j + 0.5)?.hidden; };
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
  for (const [k, v] of Object.entries(set)) vis[k] = tileVisible(k) ? v : null;
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
    for (const [id, map] of Object.entries(state.maps)) if (!state.boards.find(b => b.id === id)?.hidden) conn.send({ t: 'map', id, map });
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
    case 'combat': state.combat = msg.combat; renderCombat(); renderParty(); break;
    case 'party': state.party = msg.party; renderParty(); break;
    case 'rules': state.rules = msg.rules; state.explored = msg.explored; renderRules(); break;
    case 'note': status(msg.text); setTimeout(() => status(''), 4000); break;
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
      if (!state.combat && f.owner && !state.party.from[f.id]) { state.party.from[f.id] = { x: ox, z: oz }; pushParty(); }
      // players never step onto a square they can't see (standing at an area's open edge reveals it, below)
      let boards = state.boards;
      if (!gm) boards = state.boards.filter(b => !b.hidden);
      if (!gm && msg.done && boardAt(x, z)?.hidden) {
        Object.assign(f, f._from); delete f._from;
        note(from, `${f.name} can't walk onto a square nobody can see yet.`);
        pushFig(f); return;
      }
      Object.assign(f, msg.snap ? snapPos(x, z, w, d, boards) : clampPos(x, z, w, d, boards));
      if (msg.done && (limited || exploring)) {   // only as far as this turn's movement allows
        const o = limited ? state.combat.from : state.party.from[f.id];
        const budget = moveBudget(f) * (1 + (limited ? state.combat.dash || 0 : state.party.dash[f.id] ? 1 : 0));
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
      if (msg.done && f.owner && state.rules.autoReveal) revealNextTo(f);
      if (msg.done) save();
      break;
    }
    case 'stats': {
      if (!gm || !f) return;                    // HP, statuses and stats are set by the GM
      const n = (v, hi = 99) => (v === '' || v == null || !isFinite(+v) ? undefined : Math.max(0, Math.min(hi, Math.round(+v))));
      const st = { ...(f.st || {}) };
      for (const k of ['dex', 'alert', 'hp', 'hpMax', 'move']) if (k in msg) st[k] = n(msg[k]);
      if (Array.isArray(msg.status)) st.status = [...new Set(msg.status.filter(x => STATUSES.includes(x)))].slice(0, 10);
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
          if (!reachable(worldFor(cur), c.from.x, c.from.z, k.w, k.d, moveBudget(cur), state.rules.diag).has(`${cur.x},${cur.z}`)) {
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
        if (c.turn === 0) { c.round++; addLog({ kind: 'sys', text: `End of round ${c.round - 1}: Burn, Poison and weather effects happen now. Round ${c.round} begins.` }); }
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
      state.pending.push({ id: rid(6), kind, who: f.name, x: ki + 0.5, z: kj + 0.5 });
      addLog({ kind: 'sys', text: `${f.name}: ${INTERACT[kind].slice(2).toLowerCase()} - see Rules & dungeon.`, to: state.gm });
      renderEvent(); save();
      break;
    }
    case 'pendingDone': {
      if (!gm) return;
      state.pending = state.pending.filter(x => x.id !== msg.pid);
      if (msg.tool) handle({ t: 'eventTool', tool: msg.tool, mod: msg.mod }, from);
      if (msg.tell) addLog({ kind: 'sys', text: msg.tell });
      renderEvent(); save();
      break;
    }
    case 'partyNext': {
      if (!gm) return;
      if (state.paused) { note(from, 'Resolve the event first (throw the die / Done).'); return; }
      state.party = { turn: state.party.turn + 1, from: {}, dash: {} };
      addLog({ kind: 'sys', text: `Party turn ${state.party.turn}: everyone can move and act again.` });
      pushParty();
      break;
    }
    case 'partyDash': {                         // exploring: Dash for one ally this party turn (press again to undo)
      if (!mayMove || state.combat || !f.owner) return;
      if (state.paused && !gm) { note(from, 'Paused: the GM is resolving an event.'); return; }
      const P = state.party, k = fp(f);
      if (P.dash[f.id]) {
        const o = P.from[f.id] || { x: f.x, z: f.z };
        if (!reachable(worldFor(f), o.x, o.z, k.w, k.d, moveBudget(f), state.rules.diag).has(`${f.x},${f.z}`)) {
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
      if (gm && msg.owner !== undefined) { f.owner = msg.owner && state.players[msg.owner] ? msg.owner : null; if (f.owner) joinCombat(f); }
      if (gm && msg.hidden != null) f.hidden = !!msg.hidden;
      if (gm && msg.model !== undefined) f.model = msg.model && state.models[msg.model] ? msg.model : '';
      pushFig(f); save();
      break;
    }
    case 'add': {
      if (!gm) return;
      const id = rid(8);
      const owner = msg.owner && state.players[msg.owner] ? msg.owner : null;
      state.figures[id] = { id, name: clean(msg.name) || 'Mini', color: okColor(msg.color), size: '1', w: 1, d: 1, owner, hidden: false,
        ...freeSpot(+msg.x || 0, +msg.z || 0, 1, 1) };
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
      const box = boardsBox(), cols = clampSize(msg.cols, 12), rows = clampSize(msg.rows, 12);
      const b = { id: 'b' + rid(5), x: box.x1, z: box.z0, cols, rows, grid: true, hidden: !!msg.hidden };   // lined up to the right
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
    case 'boardDel': {
      if (!gm || state.boards.length < 2) return;
      const b = state.boards.find(x => x.id === msg.id);
      if (!b) return;
      state.boards = state.boards.filter(x => x !== b);
      delete state.maps[b.id]; blobs.set('map:' + b.id, null);
      sendAll({ t: 'map', id: b.id, map: null });
      dropTilesOutside(b);
      boardsChanged(true);
      break;
    }
    case 'map': {
      const b = gm && state.boards.find(x => x.id === msg.id);
      if (!b) return;
      const map = typeof msg.map === 'string' && msg.map.startsWith('data:image/') ? msg.map : null;
      if (map) state.maps[b.id] = map; else delete state.maps[b.id];
      blobs.set('map:' + b.id, map);
      buildBoard();
      if (!b.hidden) sendAll({ t: 'map', id: b.id, map });
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
  const box = boardsBox();
  const at = { x: num(msg.at?.x, box.x0, box.x1), z: num(msg.at?.z, box.z0, box.z1) };
  const dir = { x: num(msg.dir?.x, -1, 1), z: num(msg.dir?.z, -1, 1) || -1 };
  const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  const { frames, values } = simulate(CANNON, kinds, { from: at, dir, bounds: box, random: rnd });
  const parts = diceTotal(kinds, values), total = parts.reduce((a, c) => a + c, 0);
  const roll = { t: 'dice', id: rid(6), by: from, color: state.players[from]?.color || '#e0a64b', kinds, frames };
  const to = msg.hidden ? from : null;
  showDice(roll);
  sendAll(roll, to ? cid => cid === to : null);
  const text = logText ? logText(total) : `rolled ${n}d${sides}: ${n > 1 ? parts.join(' + ') + ' = ' : ''}${total}`;
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
      r.badge = labelSprite(String(r.total)); r.badge.position.set(c.x, 1.1, c.z); r.badge.scale.set(2.4, 0.6, 1);
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
  sendAll({ t: 'boards', boards: state.boards.filter(b => !b.hidden) });
  for (const f of Object.values(state.figures)) {
    if (!refit && boardAt(f.x, f.z)) continue;
    const c = fp(f), p = snapPos(f.x, f.z, c.w, c.d);
    if (p.x !== f.x || p.z !== f.z) { Object.assign(f, p); pushFig(f); }
  }
  save();
}

// ---------- rules helpers (host) ----------
// is this mini standing next to square "i,j" (sides or corners), not on it?
function nextToCell(f, key) {
  const [ci, cj] = key.split(',').map(Number), c = fp(f);
  const cells = cellsOf(f.x, f.z, c.w, c.d);
  if (cells.some(([i, j]) => i === ci && j === cj)) return false;
  return cells.some(([i, j]) => Math.abs(i - ci) <= 1 && Math.abs(j - cj) <= 1);
}
// in a fight: every player's mini, and GM minis once they have a Dexterity
const fights = x => !!x.owner || (x.st && x.st.dex != null);
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
const moveBudget = f => (f.st?.status || []).includes('Immobilized') ? 0 : (f.st?.move ?? (2 + (f.st?.dex || 0)));
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
  const seen = f.owner ? state.boards.filter(b => !b.hidden) : state.boards;   // allies' paths stay on what they can see
  return { onBoard: (i, j) => !!boardAt(i + 0.5, j + 0.5, seen), tile: (i, j) => state.tiles[i + ',' + j], occupied };
}
function pushParty() { renderParty(); sendAll({ t: 'party', party: state.party }); save(); figsVersion++; }
function pushCombat() { renderCombat(); renderParty(); showSelected(); sendAll({ t: 'combat', combat: combatView() }); save(); figsVersion++; }
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
  for (const [i, j] of cellsOf(f.x, f.z, w, d)) {
    for (const [a, c] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      const b = boardAt(a + 0.5, c + 0.5);
      if (b?.hidden && !BLOCKS_MOVE.has(state.tiles[a + ',' + c])) revealBoard(b);
    }
  }
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
function boardsBox() {
  const B = state.boards;
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
  if (!boardGroup) return;
  for (const o of boardGroup.children) { o.geometry?.dispose(); if (o.material && !o.material.map) o.material.dispose(); }
  boardGroup.clear();
  const slabMat = new THREE.MeshStandardMaterial({ color: '#3b2a1c', roughness: 0.8 });
  for (const b of state.boards) {
    if (b.hidden && isHost && !gmView()) continue;
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
  for (const [k, t] of Object.entries(state.tiles)) {
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
  const st = f.st || {}, tags = [...(st.status || [])];
  if (engaged.has(f.id)) tags.unshift('Engaged');
  return { hp: st.hp, hpMax: st.hpMax, tags };
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
    for (const [a, b, color, op, y, key] of [[r + 0.05, r + 0.13, '#ffd23f', 0.95, 0.012, 'ring'], [r + 0.05, r + 0.09, '#ffffff', 0.6, 0.01, 'mine']]) {
      const m = new THREE.Mesh(new THREE.RingGeometry(a, b, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.y = y; u.base.add(m); u[key] = m;
    }
  } else {
    add(new THREE.BoxGeometry(w - 0.12, 0.1, d - 0.12), u.dark, 0.05);
    add(new THREE.BoxGeometry(w - 0.16, 0.025, d - 0.16), u.col, 0.1);
    u.ring = frame(w - 0.02, d - 0.02, 0.08, '#ffd23f', 0.95); u.ring.position.y = 0.012; u.base.add(u.ring);
    u.mine = frame(w - 0.02, d - 0.02, 0.04, '#ffffff', 0.6); u.mine.position.y = 0.01; u.base.add(u.mine);
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
  const text = f.name + (f.hidden ? ' (hidden)' : ''), extra = labelExtra(f), key = text + JSON.stringify(extra);
  if (u.labelText !== key) {
    g.remove(u.label); u.label.material.map.dispose(); u.label.material.dispose();
    u.label = labelSprite(text, extra); u.labelText = key; g.add(u.label);
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
  g.visible = !isHost || gmView() || figVisible(f);
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

function rebuildAll() { buildBoard(); buildTiles(); syncFigures(); renderPlayers(); renderLog(); updateBoardInputs(); renderCombat(); renderRules(); renderParty(); renderEvent(); renderPause(); }

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
    const budget = moveBudget(f) * (1 + (myTurn ? c.dash || 0 : party && P.dash[f.id] ? 1 : 0));
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
  for (const b of [...box.children]) if (!seen.has(b.dataset.key)) b.remove();
}

const _shareT = new THREE.Vector3();
function tick() {
  animateDice(performance.now());
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
    const lb = cur.userData.label, top = lb.position.y + lb.scale.y * (1 - lb.center.y);   // just above the name tag
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
  if (!id) { select(null); return; }
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
  const c = fp(f), preset = c.w === c.d && SIZE_CELLS[f.size] === c.w;
  $('selSize').value = preset ? f.size : 'custom';
  $('selCustom').style.display = preset ? 'none' : 'flex';
  if (document.activeElement !== $('selW')) $('selW').value = c.w;
  if (document.activeElement !== $('selD')) $('selD').value = c.d;
  const st = f.st || {};
  for (const k of ['dex', 'alert', 'hp', 'hpMax']) if (document.activeElement !== $('st_' + k)) $('st_' + k).value = st[k] ?? '';
  $('stMove').textContent = st.dex != null ? `Moves ${moveBudget(f)} squares a turn (2 + Dexterity${(st.status || []).includes('Immobilized') ? ', Immobilized' : ''}).` : 'Set Dexterity to see how far it can move.';
  const chips = $('stChips'); chips.innerHTML = '';
  for (const x of st.status || []) {
    const b = document.createElement('button'); b.className = 'chip'; b.textContent = x + ' ×'; b.title = 'Remove';
    b.onclick = () => act({ t: 'stats', id: f.id, status: (f.st?.status || []).filter(y => y !== x) });
    chips.appendChild(b);
  }
  // players change name, colour and facing; the GM everything; in player view nothing
  const look = gmView() || (!isHost && f.owner === clientId), all = gmView();
  for (const id of ['selName', 'selColor', 'selTurn']) $(id).disabled = !look;
  $('selSizeBox').style.display = all ? '' : 'none';
  if (!all) $('selCustom').style.display = 'none';
  for (const id of ['st_dex', 'st_alert', 'st_hp', 'st_hpMax', 'hpDown', 'hpUp', 'stStatus', 'stAdd']) $(id).disabled = !all;
  $('stEditRow').style.display = $('stStatusRow').style.display = all ? 'flex' : 'none';
  for (const b of chips.children) b.disabled = !all;
  if (!all) for (const b of chips.children) b.textContent = b.textContent.replace(' ×', '');
  if (isHost) {
    const sm = $('selModel'); sm.innerHTML = '<option value="">Pawn (no model)</option>';
    for (const [id, m] of Object.entries(state.models)) { const o = document.createElement('option'); o.value = id; o.textContent = m.name; sm.appendChild(o); }
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
  if (!state.boards.some(b => b.id === selBoard)) selBoard = state.boards[0].id;
  const list = $('boardList'); list.innerHTML = '';
  state.boards.forEach((b, n) => {
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
  renderRules();
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

function pickPaint(type) {
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
  $('selHide').onclick = () => selectedId && act({ t: 'edit', id: selectedId, hidden: !state.figures[selectedId].hidden });
  $('selTurn').onclick = () => selectedId && act({ t: 'edit', id: selectedId, turn: true });
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
  $('selAttach').onclick = () => {
    if (!selectedId) return;
    attachFor = selectedId;
    status(`Click the piece to attach ${state.figures[selectedId].name} to (Esc to cancel)`);
  };
  $('selDetach').onclick = () => selectedId && act({ t: 'attach', id: selectedId, to: null });
  addEventListener('keydown', e => { if (e.key === 'Escape' && attachFor) { attachFor = null; status(''); } });

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
    if (f && x) act({ t: 'stats', id: f.id, status: [...(f.st?.status || []), x] });
    $('stStatus').value = '';
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
  $('ruleReveal').onchange = () => act({ t: 'rules', autoReveal: $('ruleReveal').checked });
  $('eventRoll').onclick = () => { const t = controls.target; act({ t: 'dungeonEvent', at: { x: t.x, z: t.z } }); };
  $('wallBoard').onclick = () => { const b = curBoard(); if (b) act({ t: 'boardWalls', id: b.id }); };
  $('hideBoard').onclick = () => { const b = curBoard(); act({ t: 'boardHide', id: b.id, hidden: !b.hidden }); };
  $('addHiddenBoard').onclick = () => { const b = curBoard(); const id = handle({ t: 'boardAdd', cols: b.cols, rows: b.rows, hidden: true }, clientId); if (id) pickBoard(id); };

  $('addFig').onclick = () => {
    const t = controls.target;
    const id = handle({ t: 'add', name: $('newName').value, color: $('newColor').value, owner: $('newOwner').value || null, x: t.x, z: t.z }, clientId);
    if (id) select(id);
  };
  $('applyBoard').onclick = () => act({ t: 'boardEdit', id: curBoard().id, cols: $('cols').value, rows: $('rows').value });
  $('gridOn').onchange = () => act({ t: 'boardEdit', id: curBoard().id, grid: $('gridOn').checked });
  $('addBoard').onclick = () => { const b = curBoard(); const id = handle({ t: 'boardAdd', cols: b.cols, rows: b.rows }, clientId); if (id) pickBoard(id); };
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
window.tabletop = { get state() { return state; }, act, get isHost() { return isHost; }, clientId, get view() { return { camera, controls, scene }; }, get overlays() { return { range: rangeMesh?.count ?? 0, los: losLabel ? 1 : 0, engaged: [...engaged] }; },
  hover(id) { hoverId = id; },
  async addModel(data, name, figId) { act({ t: 'model', id: await modelId(data), name, data, figId }); } };
