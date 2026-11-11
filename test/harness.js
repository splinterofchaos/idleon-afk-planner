// Fake game backend + test server + headless Chrome on the built page. Never touches the real servers, port 47811 or %APPDATA%.
//   const h = await require('./harness').start({ sheet: true, noPoll: false, width: 1500, height: 900 });
//   await h.run('tasks.length'); await h.click('#tabSimulate'); await h.shot('name.png', 1500);
//   await h.bump({ AFKtarget_3: 'w7b3' }); await h.setActivity(3, 'Divinity', { mapIdx: 200 }); await h.close();
const net = require('net'), crypto = require('crypto'), http = require('http'), fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
const BUILD = __dirname, APP = path.join(__dirname, '..'), FORBIDDEN = 47811, PAGE = path.join(APP, process.env.BUILD_DIST || 'dist', 'idleon-afk-planner.html');
const FIELDS = /^(Lv0|Exp0|ExpReq0|CurrentMap|AFKtarget|PTimeAway|CharacterClass|KLA|EquipOrder|EquipQTY|InventoryOrder|ItemQTY|SL|PVStatList|Prayers|EMm0|IMm|AnvilPA|PlayerStuff|Money|MaxCarryCap|StatueLevels)_\d+$|^(CYObolFragments|StuG|ChestOrder|ChestQuantity|CMm|Print|PrinterXtra|Guild|Cards0|Rift|Spelunk|OptLacc|Divinity|Holes|PrayOwned|CauldronInfo|CauldronBubbles|Ninja|FarmUpg|Bubba|UpgVault|RoyalG|TimeAway|RoyalMaps|ForgeItemOrder|ForgeItemQty|ForgeIntProg|ForgeLV|Refinery|GemItemsPurchased|Menagerie|AchieveReg|Dream|Grimoire|Arcane|Gaming|Research|ArcadeUpg|Sushi|CauldronP2W)$/;
const OLD_FIELDS = /^(Lv0|Exp0|ExpReq0|CurrentMap|AFKtarget|PTimeAway|CharacterClass|KLA|EquipOrder|EquipQTY|InventoryOrder|ItemQTY)_\d+$|^(ChestOrder|ChestQuantity|Cards0|Rift|Spelunk|OptLacc)$/; // what the app reads before it's restarted with the wider list
const sleep = ms => new Promise(r => setTimeout(r, ms));
const encode = v => v === null || v === undefined ? { nullValue: null } : typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { booleanValue: v } : Array.isArray(v) ? { arrayValue: v.length ? { values: v.map(encode) } : {} } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
const json = v => typeof v === 'string' ? JSON.parse(v) : v;
async function freePort() {
  for (;;) {
    const port = await new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
    if (port !== FORBIDDEN) return port;
  }
}
function connect(wsUrl) {
  const u = new URL(wsUrl), sock = net.connect(+u.port, u.hostname);
  let buf = Buffer.alloc(0), upgraded = false, nextId = 1, parts = [];
  const pending = new Map(), events = [];
  const send = obj => {
    const body = Buffer.from(JSON.stringify(obj)), mask = crypto.randomBytes(4);
    const head = body.length < 126 ? Buffer.from([0x81, 0x80 | body.length]) : body.length < 65536 ? Buffer.from([0x81, 0xfe, body.length >> 8, body.length & 255]) : (() => { const x = Buffer.alloc(10); x[0] = 0x81; x[1] = 0xff; x.writeBigUInt64BE(BigInt(body.length), 2); return x; })();
    const masked = Buffer.from(body); for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    sock.write(Buffer.concat([head, mask, masked]));
  };
  return new Promise((resolve, reject) => {
    sock.on('error', reject);
    sock.on('connect', () => sock.write(`GET ${u.pathname} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        upgraded = true; buf = buf.slice(end + 4);
        resolve({ events, sock, call: (method, params = {}) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej, method }); send({ id, method, params }); }) });
      }
      for (;;) {
        if (buf.length < 2) return;
        let len = buf[1] & 127, at = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
        if (buf.length < at + len) return;
        const fin = buf[0] & 0x80, op = buf[0] & 15, body = buf.slice(at, at + len);
        buf = buf.slice(at + len);
        if (op === 1 || op === 0) {
          parts.push(body);
          if (fin) {
            const msg = JSON.parse(Buffer.concat(parts).toString('utf8')); parts = [];
            if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(p.method + ': ' + msg.error.message)) : p.res(msg.result); }
            else events.push(msg);
          }
        }
      }
    });
  });
}
// Options: sheet (true = temp copy of testdata/sheet.json, false = none, or a state object), noPoll (the 20 s poll never fires, so a test calls h.poll() itself), width, height, build (default true: runs assemble.js first), oldFields (the save as an app not yet restarted reads it).
async function start(opts = {}) {
  const { sheet = true, noPoll = false, width = 1500, height = 900, build = true } = opts;
  if (build) execFileSync(process.execPath, [path.join(APP, 'src', 'assemble.js')], { stdio: 'ignore' });
  const tmpRoot = path.join(BUILD, 'tmp');
  fs.mkdirSync(tmpRoot, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(tmpRoot, 'run-')), data = path.join(tmp, 'data'), profile = path.join(tmp, 'chrome');
  fs.mkdirSync(data); fs.mkdirSync(profile);
  if (opts.dataFrom) fs.readdirSync(opts.dataFrom).forEach(f => { if (fs.statSync(path.join(opts.dataFrom, f)).isFile()) fs.copyFileSync(path.join(opts.dataFrom, f), path.join(data, f)); }); // a copy of a real data folder, never the folder itself
  const sheetFile = path.join(data, 'sheet.json');
  if (sheet === true) fs.copyFileSync(path.join(BUILD, 'testdata', 'sheet.json'), sheetFile);
  else if (sheet) fs.writeFileSync(sheetFile, JSON.stringify(sheet));
  const save = opts.saveData || JSON.parse(fs.readFileSync(path.join(BUILD, 'fixtures', 'full-save.json'), 'utf8')).data;
  if (!opts.saveData && !opts.printer) { delete save.Print; delete save.PrinterXtra; } // hand-worked forge sums expect ore to run out; a test that wants the printer passes printer: true
  let savedAt = opts.savedAt || Date.now() - 3 * 36e5;
  const doc = () => ({ fields: Object.fromEntries(Object.entries(save).filter(([k]) => (opts.oldFields ? OLD_FIELDS : FIELDS).test(k)).map(([k, v]) => [k, encode(v)])), updateTime: new Date(savedAt).toISOString() });
  const mockState = { uid: 'uid1', down: false }; // h.mock: who signs in, and whether the game's save can be read
  let h_extraReads = 0;
  globalThis.__printerExtraReads = () => h_extraReads;
  const mock = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), out = (c, j) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (u.pathname.endsWith('accounts:signInWithPassword')) return out(200, { idToken: 'i', refreshToken: 'r', localId: mockState.uid, expiresIn: '3600' });
      if (u.pathname === '/token/token') return out(200, { id_token: 'i2', refresh_token: 'r', expires_in: '3600' });
      if (u.pathname.startsWith('/database/_uid/')) return out(200, Array.from({ length: 11 }, (_, i) => 'char' + i));
      if (u.pathname.startsWith('/database/_comp/')) return out(200, opts.companions ? { l: opts.companions } : null);
      if (u.pathname === '/firestore/_vars/_vars') return opts.serverVars ? out(200, { fields: Object.fromEntries(Object.entries(opts.serverVars).map(([k, v]) => [k, encode(v)])) }) : out(404, {});
      if (u.pathname.startsWith('/firestore/_data/') && u.searchParams.getAll('mask.fieldPaths').includes('Meals')) { const asked = new Set(u.searchParams.getAll('mask.fieldPaths')); h_extraReads++; return mockState.down ? out(503, {}) : out(200, { fields: Object.fromEntries(Object.entries(save).filter(([k]) => asked.has(k)).map(([k, v]) => [k, encode(v)])), updateTime: new Date(savedAt).toISOString() }); }
      if (u.pathname.startsWith('/firestore/_data/')) return mockState.down ? out(503, {}) : out(200, doc());
      out(404, {});
    });
  });
  const mockPort = await freePort(), port = await freePort(), debugPort = await freePort();
  await new Promise(r => mock.listen(mockPort, '127.0.0.1', r));
  const m = `http://127.0.0.1:${mockPort}`, base = `http://127.0.0.1:${port}/`;
  const server = spawn(process.execPath, [path.join(APP, 'server.js')], { env: { ...process.env, PLANNER_PORT: String(port), PLANNER_DATA: data, PLANNER_PAGE: PAGE, PLANNER_NO_WINDOW: '1', PLANNER_SYNC_MS: '86400000', PLANNER_ENDPOINTS: JSON.stringify({ auth: m + '/auth', token: m + '/token', firestore: m + '/firestore', database: m + '/database', steam: m + '/steam', google: m + '/google' }) }, stdio: opts.serverLog ? ['ignore', fs.openSync(opts.serverLog, 'w'), fs.openSync(opts.serverLog, 'a')] : 'ignore' });
  const api = async (p, method = 'POST', body) => {
    const res = await fetch(base + p.replace(/^\//, ''), { method, headers: { 'x-planner': '1', 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  for (let i = 0; i < 100; i++) { try { await fetch(base + 'api/ping'); break; } catch { await sleep(100); } }
  await api('api/login/email', 'POST', { email: 'a@b.c', password: 'test' });
  await api('api/sync');
  const chrome = spawn(path.join(process.env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'), ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 80 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(t => t.type === 'page'); } catch { /* still starting */ } }
  if (!target) throw new Error('Chrome did not start');
  const cdp = await connect(target.webSocketDebuggerUrl), send = (name, params) => cdp.call(name, params);
  await send('Runtime.enable'); await send('Page.enable');
  // The fake game's saves would make the played character's tasks run on loot rates, so hand-worked sums use the AFK figures unless a test sets lootNow itself or passes realLoot.
  if (!opts.realLoot) await send('Page.addScriptToEvaluateOnNewDocument', { source: "const realFetch = window.fetch; window.fetch = async (u, o) => { const res = await realFetch(u, o); if (!String(u).startsWith('/api/loot') || !res.ok) return res; const v = await res.clone().json(); if (v.active) v.active.items = []; v.active.exp = []; return new Response(JSON.stringify(v), { status: res.status, headers: { 'Content-Type': 'application/json' } }); };" });
  if (noPoll) await send('Page.addScriptToEvaluateOnNewDocument', { source: 'const realInterval = window.setInterval; window.setInterval = (fn, ms, ...a) => ms === 20000 ? 0 : realInterval(fn, ms, ...a);' });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  // Runs an expression in the page (awaits promises, returns JSON-able values). Top-level functions and lets such as rows, tasks are in scope. Throws what the page throws.
  const run = async code => {
    const r = await send('Runtime.evaluate', { expression: code, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n  in: ' + code.slice(0, 200));
    return r.result.value;
  };
  const ready = async () => { for (let i = 0; i < 100; i++) { await sleep(100); try { if (await run('document.readyState === "complete" && typeof finderFetched !== "undefined" && finderFetched !== null')) return; } catch { /* navigating */ } } throw new Error('page never got its first save' + (typeof cdp !== 'undefined' ? ': ' + JSON.stringify(cdp.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)).slice(0, 1500) : '')); };
  await send('Page.navigate', { url: base });
  await ready();
  await sleep(200);
  const h = {
    run, send, api, base, data, tmp, save, mock: mockState,
    savedAt: () => savedAt,
    // Screenshot into build/shots. Width stays set afterwards, height is 900 unless given.
    async shot(name, w = width, hgt = height) {
      await send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      const dir = path.join(BUILD, 'shots'); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, /\.png$/.test(name) ? name : name + '.png');
      fs.writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', {})).data, 'base64'));
      return file;
    },
    async setSize(w, hgt = height) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: hgt, deviceScaleFactor: 1, mobile: false }); await sleep(200); },
    // Real mouse events at the element's centre. { hold: ms } keeps the button down that long, to prove a click survives the 1 s redraw.
    async click(selector, { hold = 0 } = {}) {
      const box = await run(`(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; n.scrollIntoView({ block: 'center' }); const b = n.getBoundingClientRect(); return b.width && b.height ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null; })()`);
      if (!box) throw new Error('nothing visible to click: ' + selector);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      if (hold) await sleep(hold);
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
      await sleep(60);
    },
    // Clicks an input, replaces its text with real keyboard input, and fires what typing fires. Doesn't leave the field: use h.key('Tab') for that.
    async type(selector, text) {
      await h.click(selector);
      await run(`document.querySelector(${JSON.stringify(selector)}).select()`);
      if (text === '') await h.key('Delete'); else await send('Input.insertText', { text });
      await sleep(30);
    },
    async key(name) {
      const codes = { Tab: 9, Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40, Delete: 46, Backspace: 8 }, base2 = { key: name, code: name, windowsVirtualKeyCode: codes[name], nativeVirtualKeyCode: codes[name] };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base2, ...(name === 'Enter' ? { text: '\r' } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base2 });
      await sleep(30);
    },
    // Changes the fake game save and re-syncs. saveChanges is an object of save keys to set, or a function given the save to change. A new cloud-save time goes with it. Then the page polls.
    async bump(saveChanges) {
      savedAt = Math.min(savedAt + 5 * 6e4, Date.now() - 1000);
      if (typeof saveChanges === 'function') saveChanges(save, savedAt); else if (saveChanges) Object.assign(save, saveChanges);
      await api('api/sync');
      await h.poll();
    },
    // Puts a character on an activity in the fake save and re-syncs; they become the active character (newest PTimeAway) unless { active: false }.
    // mapIdx: the map. portalLeft: kills left on that map's portal. afkId is a GAME.monsters id: 'w7b3', 'Divinity', 'Laboratory', 'Prehistrium', 'Nothing'...
    async setActivity(slot, afkId, { mapIdx, portalLeft, active = true } = {}) {
      await h.bump((d, at) => {
        d['AFKtarget_' + slot] = afkId;
        if (mapIdx != null) d['CurrentMap_' + slot] = mapIdx;
        if (active) d['PTimeAway_' + slot] = at / 1e6;
        if (portalLeft != null) { const k = json(d['KLA_' + slot]).map(x => x.slice()), i = +d['CurrentMap_' + slot]; k[i] = [portalLeft, ...(k[i] || []).slice(1)]; d['KLA_' + slot] = JSON.stringify(k); }
      });
    },
    poll: () => run('pollStatus()'),
    // Waits for pending page saves to reach the server, then returns the sheet on disk.
    async savedSheet() { for (let i = 0; i < 40; i++) { if (await run('!saveTimer && !saving')) break; await sleep(100); } return JSON.parse(fs.readFileSync(sheetFile, 'utf8')); },
    async reload() { await send('Page.reload'); await sleep(300); await ready(); await sleep(150); },
    pageErrors: () => cdp.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text),
    async close() {
      try { await Promise.race([send('Browser.close'), sleep(1000)]); } catch { /* already gone */ }
      cdp.sock.destroy();
      try { chrome.kill(); } catch { /* already gone */ }
      try { server.kill(); } catch { /* already gone */ }
      await new Promise(r => mock.close(r));
      mock.closeAllConnections?.();
      await sleep(400);
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    },
  };
  return h;
}
module.exports = { start, sleep, BUILD };
