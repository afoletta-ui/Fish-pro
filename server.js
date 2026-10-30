// Sea Drive multiplayer server: serves the game, relays players, owns the land, the leaderboard and the chat.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const FILE = path.join(__dirname, 'data.json');
const UR = process.env.UPSTASH_REDIS_REST_URL, UT = process.env.UPSTASH_REDIS_REST_TOKEN;
const COLORS = ['#e8445a', '#2f8ccc', '#3fae5a', '#a85aa8', '#ff8a1e', '#2ee6c8', '#ff6fae', '#9fb4c8'];
const BLOCKS = 12;                      // beachfront blocks, numbered 0-11 left to right
const MASS = [1, 1.5, 3, 6, 12];        // paddleboard, kayak, tinny, boat, yacht
const RAD = [0.9, 1.1, 1.7, 2.3, 3.6];  // collision size of each vessel (metres)

let land = {};    // pid -> { pref, n }  who owns land, remembered while they are offline
let board = [];   // top 5 fish: [{ n, sp, L, kg }]
const owners = {}; // block -> { pid, n, c }  ONLY players who are online right now
const chat = [];   // last 20 chat lines

// ---------- saving (Upstash Redis if set up, otherwise data.json) ----------
async function kvGet(k) {
  const r = await fetch(UR + '/get/' + k, { headers: { Authorization: 'Bearer ' + UT } });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
const kvSet = (k, v) => fetch(UR + '/set/' + k, { method: 'POST', headers: { Authorization: 'Bearer ' + UT }, body: JSON.stringify(v) }).catch(() => {});

async function load() {
  try {
    let d;
    if (UR) d = { land: await kvGet('land'), board: await kvGet('board'), owners: await kvGet('owners') };
    else d = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (d.land) land = d.land;
    else {
      // older versions saved { blockIndex: {pid,n,c} } - turn that into one block per player
      const old = d.owners || (d.board === undefined ? d : null) || {};
      for (const i of Object.keys(old)) {
        const o = old[i];
        if (o && o.pid && +i >= 0 && +i < BLOCKS && !land[o.pid]) land[o.pid] = { pref: +i, n: o.n };
      }
    }
    if (Array.isArray(d.board)) board = d.board.slice(0, 5);
  } catch (e) { /* first run: nothing saved yet */ }
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (UR) { kvSet('land', land); kvSet('board', board); }
    else fs.writeFile(FILE, JSON.stringify({ land, board }), () => {});
  }, 300);
}

// ---------- web page ----------
const page = () => fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')
  .replace('<!--MP-->', '<script>window.MP_ON=true</script>');
const srv = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page());
});

// ---------- players ----------
const wss = new WebSocketServer({ server: srv });
const players = new Map(); // ws -> player
let nextId = 1;
const cd = new Map();      // cooldowns for rams / punches
const num = v => (Number.isFinite(v) ? v : 0);
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const all = o => { for (const w of wss.clients) send(w, o); };
const others = (me, o) => { for (const w of wss.clients) if (w !== me) send(w, o); };
const byId = id => { for (const p of players.values()) if (p.id === id && p.pid) return p; return null; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const cleanName = (n, id) => String(n || '').toUpperCase().replace(/[^A-Z0-9 _.!?-]/g, '').trim().slice(0, 14) || 'PLAYER' + id;
const online = pid => [...players.values()].some(p => p.pid === pid);

// your land only shows while you're online; if someone online took your spot you get the first free one
function placeLand(p) {
  const L = land[p.pid];
  if (!L) return;
  for (const i in owners) if (owners[i].pid === p.pid) return;
  let i = L.pref >= 0 && L.pref < BLOCKS && !owners[L.pref] ? L.pref : -1;
  if (i < 0) for (let k = 0; k < BLOCKS; k++) if (!owners[k]) { i = k; break; }
  if (i < 0) return; // every block is in use by people online right now
  if (i !== L.pref) { L.pref = i; save(); send(p.ws, { t: 'moved', i }); }
  owners[i] = { pid: p.pid, n: p.n, c: p.c };
  all({ t: 'own', i, o: owners[i] });
}
function removeLand(pid) {
  for (const i of Object.keys(owners)) if (owners[i].pid === pid) { delete owners[i]; all({ t: 'own', i: +i, o: null }); }
}

wss.on('connection', ws => {
  const id = nextId++;
  const p = { id, ws, n: 'PLAYER' + id, c: COLORS[id % COLORS.length], x: 0, z: -6, h: 0, w: 1, v: -1, s: 0, st: 0, pid: null };
  players.set(ws, p);

  ws.on('message', raw => {
    let d; try { d = JSON.parse(raw); } catch (e) { return; }

    if (d.t === 'hi') {
      p.n = cleanName(d.n, id);
      p.pid = crypto.createHash('sha1').update(String(d.tok || id)).digest('hex').slice(0, 8);
      if (land[p.pid] && land[p.pid].n !== p.n) { land[p.pid].n = p.n; save(); }
      placeLand(p);
      send(ws, { t: 'init', id, pid: p.pid, c: p.c, owners, board, chat, now: Date.now(),
        players: [...players.values()].filter(q => q !== p && q.pid).map(q => ({ id: q.id, n: q.n, c: q.c, x: q.x, z: q.z, h: q.h, w: q.w, v: q.v, st: q.st })) });
      others(ws, { t: 'join', id, n: p.n, c: p.c });
      return;
    }
    if (!p.pid) return;

    if (d.t === 'pos') {
      p.x = num(d.x); p.z = num(d.z); p.h = num(d.h); p.w = d.w ? 1 : 0;
      const v = Math.trunc(num(d.v)); p.v = v >= -1 && v <= 4 ? v : -1;
      p.s = Math.max(0, Math.min(1, num(d.s))); p.st = Math.trunc(num(d.st)) & 15;

    } else if (d.t === 'buy') {
      const i = Math.trunc(num(d.i));
      const why = !(i >= 0 && i < BLOCKS) ? 'NO SUCH BLOCK' : owners[i] ? 'SOMEONE ALREADY OWNS THAT BLOCK' : land[p.pid] ? 'YOU ALREADY OWN A BLOCK' : '';
      if (why) return send(ws, { t: 'buyres', i, ok: 0, why });
      land[p.pid] = { pref: i, n: p.n };
      owners[i] = { pid: p.pid, n: p.n, c: p.c };
      save();
      send(ws, { t: 'buyres', i, ok: 1 });
      all({ t: 'own', i, o: owners[i] });

    } else if (d.t === 'ram') {
      // attacker says they hit someone; check it's believable, then work out the damage
      const q = byId(Math.trunc(num(d.id)));
      if (!q || q === p || p.w || q.w || p.v < 0 || q.v < 0 || (p.st & 8) || (q.st & 8)) return;
      const k = p.id + '>' + q.id;
      if ((cd.get(k) || 0) > Date.now()) return;
      if (dist(p, q) > RAD[p.v] + RAD[q.v] + 8) return;
      cd.set(k, Date.now() + 1400);
      const sf = Math.max(0, Math.min(1, num(d.s)));
      const toThem = Math.min(0.85, 0.14 * (MASS[p.v] / MASS[q.v]) * (0.4 + 0.6 * sf)); // never more than 85% in one hit
      const toMe = Math.min(0.5, 0.05 * (MASS[q.v] / MASS[p.v]));
      send(q.ws, { t: 'hit', d: toThem, by: p.n, x: p.x, z: p.z });
      send(p.ws, { t: 'hit', d: toMe, by: q.n, x: q.x, z: q.z, self: 1 });

    } else if (d.t === 'punch') {
      const q = byId(Math.trunc(num(d.id)));
      if (!q || q === p || !p.w || !q.w) return;
      const k = 'punch' + p.id;
      if ((cd.get(k) || 0) > Date.now() || dist(p, q) > 4) return;
      cd.set(k, Date.now() + 500);
      send(q.ws, { t: 'punched', by: p.n, x: p.x, z: p.z });

    } else if (d.t === 'fuel') {
      const q = byId(Math.trunc(num(d.id)));
      if (!q || q === p || dist(p, q) > 16) return;
      send(q.ws, { t: 'gotfuel', by: p.n });

    } else if (d.t === 'chat') {
      const now = Date.now();
      if (now - (p.lastChat || 0) < 600) return;
      p.lastChat = now;
      const m = String(d.m || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
      if (!m) return;
      const line = { t: 'chat', id: p.id, n: p.n, c: p.c, m };
      chat.push(line); if (chat.length > 20) chat.shift();
      all(line);

    } else if (d.t === 'catch') {
      const kg = num(d.kg), L = num(d.L);
      if (!(kg > 0 && kg < 5000 && L > 0 && L < 1000)) return;
      if (board.length >= 5 && kg <= board[4].kg) return;
      board.push({ n: p.n, sp: String(d.sp || 'FISH').toUpperCase().slice(0, 20), L: Math.round(L), kg: Math.round(kg * 10) / 10 });
      board.sort((a, b) => b.kg - a.kg);
      board = board.slice(0, 5);
      save();
      all({ t: 'board', b: board });

    } else if (d.t === 'die') {
      // boat exploded: they lose everything, including their land
      delete land[p.pid];
      removeLand(p.pid);
      save();
      others(ws, { t: 'boom', x: p.x, z: p.z });
    }
  });

  ws.on('close', () => {
    players.delete(ws);
    others(ws, { t: 'leave', id });
    if (p.pid && !online(p.pid)) removeLand(p.pid); // land disappears when you log off
  });
});

const r2 = v => Math.round(v * 100) / 100;
setInterval(() => {
  if (players.size < 2) return;
  const snap = [...players.values()].filter(p => p.pid).map(p => [p.id, r2(p.x), r2(p.z), r2(p.h), p.w, p.v, p.st]);
  for (const w of wss.clients) send(w, { t: 'snap', p: snap });
}, 100);
setInterval(() => { for (const w of wss.clients) if (w.readyState === 1) w.ping(); }, 30000); // keep free hosts from dropping idle sockets
// the server's clock is the game clock: time of day and tides are worked out from it, so everyone matches
setInterval(() => all({ t: 'clock', now: Date.now() }), 30000);
setInterval(() => { const now = Date.now(); for (const [k, v] of cd) if (v < now) cd.delete(k); }, 60000);

load().then(() => srv.listen(PORT, () => console.log('Sea Drive running on port ' + PORT)));
