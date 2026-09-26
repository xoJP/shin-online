/* SHIN online server — serves the game and relays lobbies + inputs between players.
   Zero dependencies: plain Node.js (18+). Start with `node server.js` (or `npm start`).
   Env: PORT (default 8080). */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const PUB = path.join(__dirname, 'public');
const MAX_MSG = 16 * 1024;          // biggest message a client may send
const MAX_PRES = 8 * 1024;          // biggest presence object a client may hold
const DIRECT = new Set(['in', 'ck']); // per-tick fight data: only the opponent gets it
const GRACE_MS = 5000;              // a dropped connection keeps its seat this long
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

/* ---------- static files ---------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok ' + clients.size); return; }
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(PUB, p));
  if (!file.startsWith(PUB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
});

/* ---------- a tiny WebSocket implementation (RFC 6455, text frames) ---------- */
function frame(str) {
  const data = Buffer.from(str);
  const n = data.length;
  let head;
  if (n < 126) head = Buffer.from([0x81, n]);
  else if (n < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([head, data]);
}
function control(op, payload = Buffer.alloc(0)) { return Buffer.concat([Buffer.from([0x80 | op, payload.length]), payload]); }

class Conn {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.frag = []; this.open = true; this.alive = true;
    this.onmessage = null; this.onclose = null;
    sock.setNoDelay(true);
    sock.on('data', d => this.data(d));
    sock.on('close', () => this.closed());
    sock.on('error', () => this.closed());
  }
  send(str) { if (this.open) { try { this.sock.write(frame(str)); } catch (e) { this.closed(); } } }
  ping() { if (this.open) this.sock.write(control(0x9)); }
  close() { if (this.open) { try { this.sock.write(control(0x8)); this.sock.end(); } catch (e) {} } this.closed(); }
  closed() { if (!this.open) return; this.open = false; try { this.sock.destroy(); } catch (e) {} if (this.onclose) this.onclose(); }
  data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    if (this.buf.length > MAX_MSG * 2) return this.close();
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) return this.close(); len = Number(big); off = 10; }
      if (!masked || len > MAX_MSG) return this.close();          // clients must mask; no huge frames
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (op === 0x8) return this.close();
      if (op === 0x9) { this.sock.write(control(0xA, payload.subarray(0, 125))); continue; }
      if (op === 0xA) { this.alive = true; continue; }
      if (op === 0x1 || op === 0x0) {
        this.frag.push(payload);
        if (this.frag.reduce((s, x) => s + x.length, 0) > MAX_MSG) return this.close();
        if (fin) { const msg = Buffer.concat(this.frag).toString('utf8'); this.frag = []; if (this.onmessage) this.onmessage(msg); }
        continue;
      }
      return this.close();                                          // binary or unknown: not ours
    }
  }
}

server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  attach(new Conn(sock));
});

/* ---------- the room: everyone's presence, relayed ---------- */
const clients = new Map(); // id -> {conn, pres, grace}
const rid = () => crypto.randomBytes(9).toString('base64').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12).padEnd(12, 'x');
const pub = p => { const o = {}; for (const k in p) if (!DIRECT.has(k)) o[k] = p[k]; return o; };
function sendTo(id, m) { const c = clients.get(id); if (c && c.conn) c.conn.send(JSON.stringify(m)); }
function broadcast(m, except) { const s = JSON.stringify(m); for (const [id, c] of clients) if (id !== except && c.conn) c.conn.send(s); }
function partner(id) {                         // the one other player this client is in a lobby with
  const c = clients.get(id); if (!c) return null;
  const p = c.pres;
  if (p.lob && typeof p.lob.g === 'string') return p.lob.g;
  if (typeof p.jn === 'string') for (const [k, o] of clients) if (o.pres.lob && o.pres.lob.c === p.jn && o.pres.lob.g === id) return k;
  return null;
}

function attach(conn) {
  let id = null, tokens = 300, last = Date.now();
  conn.onmessage = raw => {
    const now = Date.now(); tokens = Math.min(300, tokens + (now - last) * 0.3); last = now;   // ~300 messages/s, bursts allowed
    if (tokens < 1) return; tokens--;
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (!id) {                                    // first message: who are you?
      if (m.t !== 'hi') return;
      let want = typeof m.id === 'string' && /^[a-z0-9]{8,24}$/.test(m.id) ? m.id : rid();
      const old = clients.get(want);
      if (old && old.conn && old.conn !== conn) want = rid();          // that seat is taken by a live tab
      id = want;
      let c = clients.get(id); const resumed = !!c;
      if (!c) { c = { pres: {} }; clients.set(id, c); }
      if (c.grace) { clearTimeout(c.grace); c.grace = null; }
      c.conn = conn;
      conn.send(JSON.stringify({ t: 'hello', id, peers: [...clients].filter(([k]) => k !== id).map(([k, o]) => ({ peer: k, presence: pub(o.pres) })) }));
      if (!resumed) broadcast({ t: 'up', peer: id, presence: {} }, id);
      return;
    }
    if (m.t === 'p' && m.patch && typeof m.patch === 'object' && !Array.isArray(m.patch)) {
      const c = clients.get(id); if (!c) return;
      const next = Object.assign({}, c.pres); let pubChanged = false, dir = null;
      for (const k of Object.keys(m.patch).slice(0, 32)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        const v = m.patch[k];
        if (v === null) delete next[k]; else next[k] = v;
        if (DIRECT.has(k)) (dir || (dir = {}))[k] = v; else pubChanged = true;
      }
      if (JSON.stringify(next).length > MAX_PRES) return;               // too big: ignored
      c.pres = next;
      if (pubChanged) broadcast({ t: 'up', peer: id, presence: pub(next) }, id);
      if (dir) { const pt = partner(id); if (pt) sendTo(pt, { t: 'dir', peer: id, f: dir }); }
    }
  };
  conn.onclose = () => {
    if (!id) return;
    const c = clients.get(id); if (!c || c.conn !== conn) return;
    c.conn = null;
    c.grace = setTimeout(() => { if (!c.conn) { clients.delete(id); broadcast({ t: 'left', peer: id }); } }, GRACE_MS);
  };
}

setInterval(() => {                               // drop connections that stopped answering
  for (const c of clients.values()) {
    const k = c.conn; if (!k) continue;
    if (!k.alive) { k.closed(); continue; }
    k.alive = false; k.ping();
  }
}, 15000);

server.listen(PORT, () => console.log('SHIN server on http://localhost:' + PORT));
