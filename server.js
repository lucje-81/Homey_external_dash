'use strict';

// Homey Web Dashboard proxy
//
// Serves the Web Dashboard frontend (github.com/stefan-schweiger/dev.schweiger.dashboard) and sits between the
// browsers and Homey:
//   - /api/*        is forwarded to Homey with the API key added here; the key never reaches a browser.
//   - /socket.io    is this server's own socket.io: it speaks Homey's realtime handshake to the browsers and relays
//                   the events of the URIs they subscribe to over ONE connection that this server keeps with Homey.
//   - /local/*      widget modes (sandboxed / storage / trusted), kept in /data.
//   - other GETs    (app widgets' HTML, icons, images) are forwarded to Homey without a key, as Homey serves them
//                   to anyone on the network anyway.
// With DASHBOARD_PASSWORD set, browsers sign in once and get a long-lived session cookie.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const httpProxy = require('http-proxy');
const { Server } = require('socket.io');
// Homey's socket.io server speaks v4 (it serves the v4 browser client the frontend uses: onAny, socket.active).
const { io: ioClient } = require('socket.io-client');

// ---------------------------------------------------------------------------------------------------------------
// Configuration

const config = {
  homeyUrl: (process.env.HOMEY_URL || '').trim().replace(/\/+$/, ''),
  token: (process.env.HOMEY_TOKEN || '').trim(),
  port: Number(process.env.PORT || 8080),
  password: process.env.DASHBOARD_PASSWORD || '',
  sessionDays: Number(process.env.SESSION_DAYS || 365),
  trustProxy: process.env.TRUST_PROXY === 'true',
  dataDir: process.env.DATA_DIR || '/data',
  publicDir: process.env.PUBLIC_DIR || path.join(__dirname, 'public'),
  insecureTls: process.env.HOMEY_INSECURE_TLS === 'true',
};

function fail(message) {
  console.error(`Configuratiefout: ${message}`);
  process.exit(1);
}

if (!/^https?:\/\/[^/]+$/.test(config.homeyUrl)) fail('HOMEY_URL ontbreekt of is ongeldig (bv. https://192-168-1-50.homey.homeylocal.com of http://192.168.1.50).');
if (!config.token) fail('HOMEY_TOKEN (de API-sleutel) ontbreekt.');
if (!fs.existsSync(path.join(config.publicDir, 'index.html'))) fail(`Geen frontend gevonden in ${config.publicDir}.`);
fs.mkdirSync(config.dataDir, { recursive: true });
try {
  fs.accessSync(config.dataDir, fs.constants.W_OK);
} catch {
  fail(`Kan niet schrijven in ${config.dataDir}. Geef de map op je pc aan gebruiker 1000: chown 1000:1000 data`);
}

const log = (...args) => console.log(new Date().toISOString(), ...args);

// ---------------------------------------------------------------------------------------------------------------
// Small JSON store in /data

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.dataDir, file), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const target = path.join(config.dataDir, file);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2));
  fs.renameSync(`${target}.tmp`, target);
}

// ---------------------------------------------------------------------------------------------------------------
// Sessions: a signed, HttpOnly cookie. Deleting /data/session-secret signs out every browser.

const COOKIE = 'hwd_session';

const sessionSecret = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(config.dataDir, 'session-secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
})();

const sign = (value) => crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');

function safeEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
  const cookies = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function isAuthenticated(req) {
  if (!config.password) return true;
  const value = parseCookies(req.headers.cookie)[COOKIE];
  if (!value) return false;
  const [issued, signature] = value.split('.');
  if (!issued || !signature || !safeEqual(signature, sign(issued))) return false;
  return Date.now() - Number(issued) < config.sessionDays * 86400000;
}

function sessionCookie(req) {
  const issued = String(Date.now());
  const secure = requestOrigin(req).startsWith('https:') ? '; Secure' : '';
  return `${COOKIE}=${issued}.${sign(issued)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionDays * 86400}${secure}`;
}

// Login throttling: 5 wrong passwords per address, then a minute's wait.
const attempts = new Map();

function clientAddress(req) {
  if (config.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress;
}

// ---------------------------------------------------------------------------------------------------------------
// Request helpers

function requestOrigin(req) {
  const proto = (config.trustProxy && req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http');
  const host = (config.trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
  return `${String(proto).split(',')[0].trim()}://${String(host).split(',')[0].trim()}`;
}

// Cross-site requests must not reach Homey through a browser on the network: an Origin, when sent, must be ours.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (origin == null) return true; // same-origin GETs and non-browser clients
  return origin === requestOrigin(req); // also refuses "null", the origin of sandboxed frames
}

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string';
  res.writeHead(status, {
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Login page

const loginPage = (error = '') => `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Homey Dashboard – aanmelden</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; }
  form { display: grid; gap: 12px; width: min(320px, 90vw); }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  input, button { font: inherit; padding: 10px 12px; border-radius: 10px; border: 1px solid #8884; }
  button { background: #2a7de1; color: #fff; border: 0; cursor: pointer; }
  p { margin: 0; color: #d33; }
</style></head>
<body><form method="post" action="/login">
  <h1>Homey Dashboard</h1>
  <input type="password" name="password" placeholder="Wachtwoord" autofocus autocomplete="current-password" required>
  <button type="submit">Aanmelden</button>
  ${error ? `<p>${error}</p>` : ''}
</form></body></html>`;

async function handleLogin(req, res) {
  if (!config.password) return send(res, 302, '', { Location: '/' });
  if (req.method === 'GET') return send(res, 200, loginPage());
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });

  const address = clientAddress(req);
  const entry = attempts.get(address) ?? { count: 0, until: 0 };
  if (entry.until > Date.now()) return send(res, 429, loginPage('Te veel pogingen. Probeer het over een minuut opnieuw.'));

  let password = '';
  try {
    password = new URLSearchParams(await readBody(req, 4096)).get('password') ?? '';
  } catch {
    return send(res, 400, loginPage('Ongeldige aanvraag.'));
  }

  if (!safeEqual(password, config.password)) {
    entry.count += 1;
    if (entry.count >= 5) Object.assign(entry, { count: 0, until: Date.now() + 60000 });
    attempts.set(address, entry);
    log(`Mislukte aanmelding vanaf ${address}`);
    return send(res, 401, loginPage('Verkeerd wachtwoord.'));
  }
  attempts.delete(address);
  log(`Aangemeld vanaf ${address}`);
  send(res, 302, '', { Location: '/', 'Set-Cookie': sessionCookie(req) });
}

// ---------------------------------------------------------------------------------------------------------------
// Proxy to Homey

const proxy = httpProxy.createProxyServer({
  target: config.homeyUrl,
  changeOrigin: true,
  secure: !config.insecureTls,
  xfwd: false,
  proxyTimeout: 60000,
});

proxy.on('proxyReq', (proxyReq, req) => {
  // Nothing of the browser's own credentials goes to Homey; only the key added here.
  proxyReq.removeHeader('cookie');
  proxyReq.removeHeader('authorization');
  proxyReq.removeHeader('origin');
  proxyReq.removeHeader('referer');
  if (req.withHomeyKey) proxyReq.setHeader('Authorization', `Bearer ${config.token}`);
});

proxy.on('proxyRes', (proxyRes, req) => {
  // Homey's own cookies have no business on this origin.
  delete proxyRes.headers['set-cookie'];
  if (req.withHomeyKey) proxyRes.headers['cache-control'] = proxyRes.headers['cache-control'] ?? 'no-store';
});

proxy.on('error', (error, req, res) => {
  log(`Homey niet bereikbaar voor ${req.method} ${req.url}: ${error.message}`);
  if (res && !res.headersSent && typeof res.writeHead === 'function') send(res, 502, { error: 'Homey is niet bereikbaar' });
  else res?.destroy?.();
});

// ---------------------------------------------------------------------------------------------------------------
// One realtime connection to Homey, shared by every browser

class HomeyRealtime extends EventEmitter {
  constructor() {
    super();
    this.counts = new Map(); // uri -> number of browsers subscribed
    this.handlers = new Map(); // uri -> listener on the api socket
    this.api = null;
    this.connected = false;
    this.lastError = null;
    this.lastErrorAt = 0;
  }

  start() {
    this.root = ioClient(config.homeyUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      rejectUnauthorized: !config.insecureTls,
    });
    this.root.on('connect', () => this.handshake());
    this.root.on('disconnect', (reason) => this.setConnected(false, `verbinding verbroken (${reason})`));
    this.root.on('connect_error', (error) => {
      this.setConnected(false, 'kan niet verbinden');
      // Also while never connected: say why, but not on every retry.
      const reason = [error.message, error.description?.message ?? error.description, error.context?.statusText]
        .filter(Boolean)
        .join(' – ');
      if (reason !== this.lastError || Date.now() - this.lastErrorAt > 60000) {
        log(`Realtime: kan niet verbinden met ${config.homeyUrl}: ${reason || error}`);
        this.lastError = reason;
        this.lastErrorAt = Date.now();
      }
    });
  }

  handshake() {
    this.root.emit('handshakeClient', { token: config.token }, (error, result) => {
      if (error) {
        log(`Realtime: Homey weigerde de sleutel (${error.error_description ?? error.error ?? JSON.stringify(error)})`);
        setTimeout(() => this.root.connected && this.handshake(), 10000);
        return;
      }
      if (this.api == null) {
        this.api = this.root.io.socket(result.namespace);
        this.api.on('connect', () => {
          for (const uri of this.counts.keys()) this.subscribeOnHomey(uri);
          this.setConnected(true, `verbonden (${result.namespace})`);
        });
        this.api.on('disconnect', (reason) => this.setConnected(false, `namespace verbroken (${reason})`));
        // The namespace can be refused when it raced a reconnect; shake hands again.
        const retry = () => setTimeout(() => {
          if (this.root.connected && !this.api.active) this.handshake();
        }, 2000);
        this.api.on('connect_error', retry);
        for (const uri of this.counts.keys()) this.listen(uri);
      }
      // Not when it is already connecting (a second connect packet makes Homey drop the connection).
      if (!this.api.active) this.api.connect();
    });
  }

  setConnected(connected, why) {
    if (this.connected === connected) return;
    this.connected = connected;
    log(`Realtime naar Homey: ${why}`);
    this.emit(connected ? 'up' : 'down');
  }

  listen(uri) {
    if (this.api == null || this.handlers.has(uri)) return;
    const handler = (event, data) => this.emit('event', uri, event, data);
    this.handlers.set(uri, handler);
    this.api.on(uri, handler);
  }

  subscribeOnHomey(uri) {
    this.api.emit('subscribe', uri, (error) => {
      if (error) log(`Realtime: abonneren op ${uri} mislukt: ${error.message ?? JSON.stringify(error)}`);
    });
  }

  retain(uri) {
    const count = this.counts.get(uri) ?? 0;
    this.counts.set(uri, count + 1);
    if (count > 0) return;
    this.listen(uri);
    if (this.api?.connected) this.subscribeOnHomey(uri);
  }

  release(uri) {
    const count = (this.counts.get(uri) ?? 1) - 1;
    if (count > 0) {
      this.counts.set(uri, count);
      return;
    }
    this.counts.delete(uri);
    const handler = this.handlers.get(uri);
    if (handler) {
      this.api?.off(uri, handler);
      this.handlers.delete(uri);
    }
    if (this.api?.connected) this.api.emit('unsubscribe', uri);
  }
}

const homey = new HomeyRealtime();

// ---------------------------------------------------------------------------------------------------------------
// Widget modes (sandboxed by default; 'storage' and 'trusted' chosen per widget in the dashboard's widget settings)

const LOCAL_URI = 'homey:local:webdashboard';
const WIDGET_MODES = ['sandboxed', 'storage', 'trusted'];
let widgetModes = readJson('widget-modes.json', {});

async function handleLocal(req, res, pathname) {
  if (!isAuthenticated(req)) return send(res, 401, { error: 'Niet aangemeld' });
  if (pathname === '/local/widget-modes' && req.method === 'GET') return send(res, 200, widgetModes);

  const match = pathname.match(/^\/local\/widget-modes\/([^/]+)$/);
  if (match && req.method === 'PUT') {
    if (!req.headers.authorization || !isSameOrigin(req)) return send(res, 403, { error: 'Forbidden' });
    let body;
    try {
      body = JSON.parse(await readBody(req, 4096));
    } catch {
      return send(res, 400, { error: 'Ongeldige JSON' });
    }
    const widgetId = decodeURIComponent(match[1]);
    if (!WIDGET_MODES.includes(body?.mode) || !/^[\w-]{1,64}$/.test(widgetId)) return send(res, 400, { error: 'Ongeldige modus' });
    const next = { ...widgetModes };
    if (body.mode === WIDGET_MODES[0]) delete next[widgetId];
    else next[widgetId] = body.mode;
    widgetModes = next;
    writeJson('widget-modes.json', widgetModes);
    realtimeNamespace.to(LOCAL_URI).emit(LOCAL_URI, 'widget-modes', widgetModes);
    log(`Widget ${widgetId}: modus ${body.mode}`);
    return send(res, 200, widgetModes);
  }
  send(res, 404, { error: 'Not found' });
}

// ---------------------------------------------------------------------------------------------------------------
// Static frontend

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const publicRoot = path.resolve(config.publicDir);

function staticFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.resolve(publicRoot, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!file.startsWith(publicRoot + path.sep)) return null;
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

function serveStatic(req, res, file) {
  const isIndex = path.basename(file) === 'index.html';
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    // The frontend has no build step or hashed names, so browsers check for a newer file every time.
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    ...(isIndex ? { 'Referrer-Policy': 'same-origin' } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------------------------------------------
// Routing

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://local');

  if (pathname === '/healthz') return send(res, 200, { ok: true, homeyRealtime: homey.connected });
  if (pathname === '/login') return handleLogin(req, res);
  if (pathname === '/logout') {
    return send(res, 302, '', { Location: config.password ? '/login' : '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` });
  }

  // The frontend's standalone mode reads its connection from config.json: Homey is "this server", and the token is a
  // placeholder (the real key is added by the proxy). `proxy: true` turns on widget modes kept by this server.
  if (pathname === '/config.json') {
    if (!isAuthenticated(req)) return send(res, 401, { error: 'Niet aangemeld' });
    return send(res, 200, { homeyUrl: requestOrigin(req), token: 'proxy', proxy: true });
  }

  if (pathname.startsWith('/local/')) return handleLocal(req, res, pathname);

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    if (!isAuthenticated(req)) return send(res, 401, { error: 'Niet aangemeld' });
    // Changes need the frontend's Authorization header (which a cross-site form or image can't send) and our Origin.
    const reads = req.method === 'GET' || req.method === 'HEAD';
    if (!reads && (!req.headers.authorization || !isSameOrigin(req))) return send(res, 403, { error: 'Forbidden' });
    req.withHomeyKey = true;
    return proxy.web(req, res);
  }

  const file = staticFile(pathname);
  if (file) {
    if (path.basename(file) === 'index.html' && !isAuthenticated(req)) return send(res, 302, '', { Location: '/login' });
    return serveStatic(req, res, file);
  }

  // Everything else Homey serves to anyone on the network (app widgets' pages, icons): forwarded without a key.
  if (req.method === 'GET' || req.method === 'HEAD') return proxy.web(req, res);
  send(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    log(`Fout bij ${req.method} ${req.url}: ${error.stack ?? error}`);
    if (!res.headersSent) send(res, 500, { error: 'Interne fout' });
    else res.destroy();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Realtime for the browsers: Homey's handshake, answered here

const io = new Server(server, {
  serveClient: true,
  transports: ['websocket', 'polling'],
  // While this server has no connection to Homey, browsers can't connect either: they show "Offline" and, once
  // Homey is back, reconnect and reload the dashboard (the frontend's own reconnect handling).
  allowRequest: (req, callback) => callback(null, isAuthenticated(req) && isSameOrigin(req) && homey.connected),
});

io.on('connection', (socket) => {
  socket.on('handshakeClient', (_data, ack) => {
    if (typeof ack === 'function') ack(null, { namespace: '/realtime' });
  });
});

const realtimeNamespace = io.of('/realtime');

realtimeNamespace.on('connection', (socket) => {
  const uris = new Set();

  socket.on('subscribe', (uri, ack) => {
    if (typeof uri === 'string' && uri.length < 256 && !uris.has(uri)) {
      uris.add(uri);
      socket.join(uri);
      if (uri !== LOCAL_URI) homey.retain(uri);
    }
    if (typeof ack === 'function') ack(null);
  });

  socket.on('unsubscribe', (uri, ack) => {
    if (uris.delete(uri)) {
      socket.leave(uri);
      if (uri !== LOCAL_URI) homey.release(uri);
    }
    if (typeof ack === 'function') ack(null);
  });

  socket.on('disconnect', () => {
    for (const uri of uris) if (uri !== LOCAL_URI) homey.release(uri);
    uris.clear();
  });
});

homey.on('event', (uri, event, data) => realtimeNamespace.to(uri).emit(uri, event, data));

homey.on('down', () => {
  // Drop the browsers' connections (not a socket.io "server disconnect", which they wouldn't retry) so they reconnect
  // and refresh once Homey is back.
  for (const client of Object.values(io.engine.clients)) client.close();
});

// ---------------------------------------------------------------------------------------------------------------

server.listen(config.port, () => {
  log(`Homey Web Dashboard op poort ${config.port} → ${config.homeyUrl}`);
  if (!config.password) log('Let op: geen DASHBOARD_PASSWORD ingesteld; iedereen op je netwerk kan het dashboard openen en bedienen.');
  homey.start();
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('Afsluiten…');
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
