'use strict';
// Idleon AFK Planner. Copyright the planner's authors; licensed under the GNU GPL v3.0 only (see LICENSE). Some formulas are ported from Idleon Toolbox (GPL-3.0-only): see README.
// Local Idleon AFK Planner: serves the planner page on this PC and reads your own game save.
// It only ever reads from the game's servers. Your password goes to the game's login service and is
// never written to disk; the sign-in it returns is stored encrypted for your Windows user.
const http = require('http');
const fs = require('fs');
const zlib = require('zlib');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PORT = Number(process.env.PLANNER_PORT) || 47811;
const DATA_DIR = process.env.PLANNER_DATA || path.join(process.env.APPDATA || os.homedir(), 'IdleonAfkPlanner');
const PAGE = process.env.PLANNER_PAGE || path.join(__dirname, 'idleon-afk-planner.html');
const SHEET_FILE = path.join(DATA_DIR, 'sheet.json');
const SESSION_FILE = path.join(DATA_DIR, 'session.dat');
const LOOT_FILE = path.join(DATA_DIR, 'loot.json');
const FORGE_HISTORY_FILE = path.join(DATA_DIR, 'forge-history.jsonl');
const ARMORY_FILE = path.join(DATA_DIR, 'armory.json');
const MAPS_DIR = path.join(__dirname, 'maps'); // your own screenshots of each world's kingdom map, for the Armory tab
const SNAP_DIR = path.join(DATA_DIR, 'snapshots');
const FORGE_HISTORY_FULL_MS = 30 * 24 * 3600 * 1000; // every save for this long, then one row per hour
const { apiKey, googleClientId, googleClientSecret } = JSON.parse(fs.readFileSync(path.join(__dirname, 'sync-config.json'), 'utf8'));
const API = {
  auth: 'https://identitytoolkit.googleapis.com/v1',
  token: 'https://securetoken.googleapis.com/v1',
  firestore: 'https://firestore.googleapis.com/v1/projects/idlemmo/databases/(default)/documents',
  database: 'https://idlemmo.firebaseio.com',
  steam: 'https://us-central1-idlemmo.cloudfunctions.net/asil',
  google: 'https://oauth2.googleapis.com',
  ...JSON.parse(process.env.PLANNER_ENDPOINTS || '{}'),
};
const STEAM_RETURN = 'https://www.legendsofidleon.com/steamsso/';
const SYNC_EVERY_MS = Number(process.env.PLANNER_SYNC_MS) || 60 * 1000;
const QUIT_AFTER_MS = 5 * 60 * 1000; // no open window for this long: stop running in the background
const LOOT_GAP_MS = 15 * 60 * 1000; // saves further apart than this: the game was probably closed, and AFK loot may have come in
const SAVE_FIELDS = ['Lv0', 'Exp0', 'ExpReq0', 'CurrentMap', 'AFKtarget', 'PTimeAway', 'CharacterClass', 'KLA', 'EquipOrder', 'EquipQTY', 'SL', 'PVStatList', 'Prayers', 'EMm0', 'AnvilPA', 'IMm', 'InventoryOrder', 'ItemQTY', 'PlayerStuff', 'Money', 'MaxCarryCap', 'StatueLevels'];
const ACCOUNT_FIELDS = ['CYObolFragments', 'ChestOrder', 'ChestQuantity', 'Cards0', 'Rift', 'Spelunk', 'OptLacc', 'Divinity', 'Holes', 'PrayOwned', 'CauldronInfo', 'CauldronBubbles', 'Ninja', 'FarmUpg', 'Bubba', 'UpgVault', 'RoyalG', 'RoyalMaps', 'TimeAway', 'ForgeItemOrder', 'ForgeItemQty', 'ForgeIntProg', 'ForgeLV', 'Refinery', 'GemItemsPurchased', 'Menagerie', 'CMm', 'Print', 'PrinterXtra', 'Guild', 'AchieveReg', 'Dream', 'Grimoire', 'Arcane', 'Gaming', 'Research', 'ArcadeUpg', 'Sushi', 'CauldronP2W', 'StuG'];

fs.mkdirSync(DATA_DIR, { recursive: true });
// server.log: when it started and stopped, and why, so a copy that stops with no window to show it leaves a trace. Kept under 1 MB.
const LOG_FILE = path.join(DATA_DIR, 'server.log');
function logLine(...parts) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1e6) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' [' + process.pid + '] ' + parts.map(p => p instanceof Error ? p.stack || p.message : String(p)).join(' ') + '\n');
  } catch { /* nowhere to write: carry on */ }
}
process.on('uncaughtException', err => { logLine('stopped on an error:', err); process.exit(1); });
process.on('unhandledRejection', err => logLine('error, kept running:', err instanceof Error ? err : new Error(String(err)))); // one failed request shouldn't take the app down

/* ---------- keeping the sign-in safe at rest ---------- */
function powershell(script, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], (err, out) => (err ? reject(err) : resolve(out.trim())));
    child.stdin.end(input);
  });
}
const encrypt = text => powershell('$s=[Console]::In.ReadToEnd(); ConvertTo-SecureString $s -AsPlainText -Force | ConvertFrom-SecureString', text);
const decrypt = text => powershell('$s=[Console]::In.ReadToEnd().Trim(); $b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR((ConvertTo-SecureString $s)); [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)', text);

let session = null; // { method, uid, refreshToken }
let idToken = null, idTokenExpires = 0;
let remembered = false;

async function storeSession() {
  try {
    fs.writeFileSync(SESSION_FILE, await encrypt(JSON.stringify(session)));
    remembered = true;
  } catch {
    remembered = false; // stays signed in until the app closes, and nothing unencrypted is written
  }
}
// No file is a first run. One that's there but can't be read is kept aside, before the next save writes over it.
function keepCorrupt(file, e) {
  if (e.code === 'ENOENT') return;
  console.error('Could not read ' + file, e);
  try { fs.copyFileSync(file, file + '.corrupt'); } catch (err) { console.error(err); }
}
async function loadSession() {
  try {
    session = JSON.parse(await decrypt(fs.readFileSync(SESSION_FILE, 'utf8')));
    remembered = true;
  } catch {
    session = null;
  }
}
function forgetSession() {
  session = null; idToken = null; idTokenExpires = 0; names = null; latest = null;
  forgetCompanions();
  remembered = false;
  fs.rmSync(SESSION_FILE, { force: true });
}

/* ---------- signing in ---------- */
class UserError extends Error {}
const LOGIN_MESSAGES = {
  EMAIL_NOT_FOUND: 'Wrong email or password.',
  INVALID_PASSWORD: 'Wrong email or password.',
  INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.',
  INVALID_EMAIL: 'That email address doesn’t look right.',
  USER_DISABLED: 'This game account is disabled.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many sign-in attempts. Wait a while, then try again.',
};
async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new UserError('Couldn’t reach the game’s login service. Check your internet connection.');
  }
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, json };
}
// Steam's sign-in response has no localId, so the account id comes from the token itself.
function uidFromToken(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return claims.user_id || claims.sub || null;
  } catch {
    return null;
  }
}
async function finishSignIn(method, r) {
  if (!r.ok || !r.json?.idToken) {
    const code = String(r.json?.error?.message || '').split(' ')[0];
    throw new UserError(LOGIN_MESSAGES[code] || 'The game’s login service refused this sign-in' + (code ? ' (' + code + ').' : '.'));
  }
  const uid = r.json.localId || uidFromToken(r.json.idToken);
  if (!uid) throw new UserError('The game’s login service didn’t say which account this is.');
  idToken = r.json.idToken;
  idTokenExpires = Date.now() + Number(r.json.expiresIn || 3600) * 1000;
  session = { method, uid, refreshToken: r.json.refreshToken };
  names = null;
  forgetCompanions();
  await storeSession();
}
const SIGN_IN_OVER = new Set(['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'USER_DISABLED', 'USER_NOT_FOUND']);
async function signInEmail(email, password) {
  if (!email || !password) throw new UserError('Enter your email and password.');
  await finishSignIn('email', await postJson(`${API.auth}/accounts:signInWithPassword?key=${apiKey}`, { email, password, returnSecureToken: true }));
}
async function signInSteam(input) {
  let url = String(input || '').trim();
  if (/^(www\.)?legendsofidleon\.com\/steamsso\//.test(url)) url = 'https://www.' + url.replace(/^www\./, '');
  if (!url.startsWith(STEAM_RETURN)) throw new UserError('Paste the full legendsofidleon.com/steamsso address from your browser.');
  const p = new URL(url).searchParams;
  const steamId = (p.get('openid.claimed_id') || '').match(/\/(\d+)$/)?.[1];
  if (!steamId || !p.get('openid.response_nonce') || !p.get('openid.sig') || !p.get('openid.signed')) {
    throw new UserError('That address is incomplete. Copy all of it from your browser’s address bar.');
  }
  const r = await postJson(API.steam, { data: {
    claimedId: steamId, nonce: p.get('openid.response_nonce'), assocHandle: p.get('openid.assoc_handle'), sig: p.get('openid.sig'), signed: p.get('openid.signed'),
  } });
  const token = r.json?.result;
  if (!r.ok || typeof token !== 'string' || !token) throw new UserError('Steam’s sign-in was refused. These addresses work once, so sign in through Steam again.');
  await finishSignIn('steam', await postJson(`${API.auth}/accounts:signInWithCustomToken?key=${apiKey}`, { token, returnSecureToken: true }));
}
// Google's device sign-in: you enter a short code on Google's own page while this app waits for the answer.
let googleLogin = null; // { userCode, verifyUrl } while waiting, { error } if it failed
async function postForm(url, fields) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  return res.json().catch(() => ({}));
}
async function startGoogle() {
  let code;
  try {
    code = await postForm(`${API.google}/device/code`, { client_id: googleClientId, scope: 'email profile' });
  } catch {
    throw new UserError('Couldn’t reach Google. Check your internet connection.');
  }
  if (!code.device_code || !code.user_code) throw new UserError('Google wouldn’t start the sign-in' + (code.error ? ' (' + code.error + ').' : '.'));
  const run = { userCode: code.user_code, verifyUrl: code.verification_url || code.verification_uri };
  googleLogin = run;
  waitForGoogle(run, code.device_code, Number(code.interval) || 5, Date.now() + (Number(code.expires_in) || 1800) * 1000);
}
async function waitForGoogle(run, deviceCode, interval, expires) {
  const fail = message => { if (googleLogin === run) googleLogin = { error: message }; };
  while (googleLogin === run) {
    await new Promise(r => setTimeout(r, interval * 1000));
    if (googleLogin !== run) return;
    if (Date.now() > expires) return fail('That Google code expired. Start the sign-in again.');
    let answer;
    try {
      answer = await postForm(`${API.google}/token`, {
        client_id: googleClientId, client_secret: googleClientSecret, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      });
    } catch {
      continue; // a network blip shouldn't lose the code you're typing in
    }
    if (answer.error === 'authorization_pending') continue;
    if (answer.error === 'slow_down') { interval += 5; continue; }
    if (answer.error === 'access_denied') return fail('Google sign-in was cancelled.');
    if (!answer.id_token) return fail('Google refused this sign-in' + (answer.error ? ' (' + answer.error + ').' : '.'));
    try {
      await finishSignIn('google', await postJson(`${API.auth}/accounts:signInWithIdp?key=${apiKey}`, {
        postBody: new URLSearchParams({ id_token: answer.id_token, providerId: 'google.com' }).toString(), requestUri: 'http://localhost', returnSecureToken: true,
      }));
    } catch (e) {
      return fail(e instanceof UserError ? e.message : 'Something went wrong finishing the Google sign-in.');
    }
    if (googleLogin === run) googleLogin = null;
    lastError = null;
    return syncNow();
  }
}
async function freshToken(force) {
  if (!session) throw new UserError('Sign in first.');
  if (!force && idToken && Date.now() < idTokenExpires - 60000) return idToken;
  let res;
  try {
    res = await fetch(`${API.token}/token?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
    });
  } catch {
    throw new UserError('Couldn’t reach the game’s servers. Will try again.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.id_token) {
    if (SIGN_IN_OVER.has(String(json?.error?.message || '').split(' ')[0])) { // anything else, such as a rate limit, passes
      forgetSession();
      throw new UserError('Your sign-in has expired. Sign in again.');
    }
    throw new UserError('The game’s servers had a problem. Will try again.');
  }
  idToken = json.id_token;
  idTokenExpires = Date.now() + Number(json.expires_in || 3600) * 1000;
  if (json.refresh_token && json.refresh_token !== session.refreshToken) {
    session.refreshToken = json.refresh_token;
    await storeSession();
  }
  return idToken;
}

/* ---------- reading the save ---------- */
function decodeValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = decodeValue(v);
  return out;
}
let names = null, namesAt = 0, latest = null, lastError = null, syncing = false;
const NAMES_EVERY_MS = 60 * 60 * 1000;
const MAX_SLOTS = 20;
const NO_SAVE = 'No characters found for this sign-in. If you play with a different login, sign out and use that one.';
// The database hands back a list, or an object keyed by slot when a slot number is missing.
function nameList(value) {
  if (Array.isArray(value)) return value.map(n => n || '');
  if (!value || typeof value !== 'object') return [];
  const list = [];
  for (const [slot, name] of Object.entries(value)) list[Number(slot)] = name;
  return Array.from(list, n => n || '');
}
async function authedGet(url, makeHeaders) {
  for (const force of [false, true]) {
    const token = await freshToken(force);
    let res;
    try {
      res = await fetch(makeHeaders ? url : `${url}${url.includes('?') ? '&' : '?'}auth=${token}`, makeHeaders ? { headers: { Authorization: 'Bearer ' + token } } : {});
    } catch {
      throw new UserError('Couldn’t reach the game’s servers. Will try again.');
    }
    if (res.status === 401 || res.status === 403) { if (force) throw new UserError('The game’s servers refused to share this save (' + res.status + ').'); continue; }
    if (res.status === 404) throw new UserError(NO_SAVE);
    if (!res.ok) throw new UserError('The game’s servers had a problem (' + res.status + '). Will try again.');
    return res.json();
  }
  return null;
}
// Which companions the account owns: the game keeps them apart from the save. Only the list is asked for, and rarely, since it hardly ever changes. A failure keeps what was known.
const COMPANIONS_EVERY_MS = 10 * 60 * 1000;
const COMPANIONS_RETRY_MS = 2 * 60 * 1000;
let companions = null, companionsAt = 0, companionsFailed = false;
function forgetCompanions() { companions = null; companionsAt = 0; companionsFailed = false; }
async function readCompanions(uid) {
  if (Date.now() - companionsAt < (companionsFailed ? COMPANIONS_RETRY_MS : COMPANIONS_EVERY_MS)) return;
  companionsAt = Date.now();
  try {
    const fields = (await authedGet(`${API.database}/_comp/${uid}.json`, false)) || {};
    if (Array.isArray(fields.l)) companions = fields.l;
    companionsFailed = false;
  } catch { companionsFailed = true; } // the kills per kill boxes stay typed
}
// What only the Printer tab needs: asked for when that tab opens, at most every so often, rather than with every sync. Slow-changing, so nothing is lost by it. The week's vote winners are in the game's server record.
const PRINTER_CHAR_FIELDS = ['AttackLoadout', 'BuffsActive', 'CSetEq', 'CardEquip', 'EMm1', 'ObolEqMAP', 'ObolEqO0', 'POu', 'PVFishingToolkit', 'PVFishingSpotIndex', 'PVtStarSign'];
const PRINTER_ACCOUNT_FIELDS = ['Atoms', 'Breeding', 'BribeStatus', 'BundlesReceived', 'Compass', 'CookMaster', 'DungUpg', 'FamValMinigameHiscores', 'Lab', 'MapBon', 'Meals', 'ObolEqMAPz1', 'ObolEqO1', 'Ribbon', 'Sailing', 'SaltLick', 'Shrine', 'StampLv', 'StarSg', 'Summon', 'TaskZZ2'];
const PRINTER_EXTRA_EVERY_MS = 15 * 60 * 1000, PRINTER_EXTRA_FORCED_MS = 60 * 1000;
let printerExtra = null, printerExtraReading = null;
function readPrinterExtra(force) {
  if (printerExtraReading) return printerExtraReading; // the Printer and Statues tabs ask separately
  return printerExtraReading = fetchPrinterExtra(force).finally(() => { printerExtraReading = null; });
}
async function fetchPrinterExtra(force) {
  if (!session) return { data: null };
  const age = printerExtra ? Date.now() - printerExtra.fetchedAt : Infinity;
  if (printerExtra && printerExtra.uid === session.uid && age < (force || !printerExtra.vars ? PRINTER_EXTRA_FORCED_MS : PRINTER_EXTRA_EVERY_MS)) return printerExtra;
  const uid = encodeURIComponent(session.uid), slots = Array.from({ length: names?.length || MAX_SLOTS }, (_, i) => i);
  const mask = [...slots.flatMap(i => PRINTER_CHAR_FIELDS.map(f => f + '_' + i)), ...PRINTER_ACCOUNT_FIELDS].map(f => 'mask.fieldPaths=' + f).join('&');
  const doc = await authedGet(`${API.firestore}/_data/${uid}?${mask}`, true);
  const vars = await authedGet(`${API.firestore}/_vars/_vars?mask.fieldPaths=voteCategories&mask.fieldPaths=voteCat2`, true).catch(() => null); // the tab says so when these are missing
  printerExtra = { uid: session.uid, data: decodeFields(doc.fields || {}), vars: vars ? decodeFields(vars.fields || {}) : null, fetchedAt: Date.now(), savedAt: Date.parse(doc.updateTime) || null };
  return printerExtra;
}
/* The game's servers have other customers: while the save isn't changing, or they're failing, ask less often. Well under LOOT_GAP_MS, or the loot stretches would be thrown away. */
const SYNC_MAX_WAIT_MS = 5 * 60 * 1000;
let syncQuiet = 0, syncFails = 0, nextSyncAt = 0;
const syncWait = () => Math.min(SYNC_EVERY_MS * 2 ** (syncFails || Math.floor(syncQuiet / 3)), Math.max(SYNC_MAX_WAIT_MS, SYNC_EVERY_MS)); // doubles for each 3 unchanged in a row, or each failure
async function syncNow() {
  if (!session || syncing) return;
  syncing = true;
  let failed = false;
  try {
    const uid = encodeURIComponent(session.uid);
    if (!names || Date.now() - namesAt > NAMES_EVERY_MS) { // a failure keeps the list there was
      const list = authedGet(`${API.database}/_uid/${uid}.json`, false);
      names = nameList(await (names ? list.catch(() => names) : list));
      namesAt = Date.now();
    }
    // Asks only for the fields the planner uses, not the whole save. Names are optional: the save decides which characters exist.
    const slots = Array.from({ length: names.length || MAX_SLOTS }, (_, i) => i);
    const mask = [...slots.flatMap(i => SAVE_FIELDS.map(f => f + '_' + i)), ...ACCOUNT_FIELDS].map(f => 'mask.fieldPaths=' + f).join('&');
    const doc = await authedGet(`${API.firestore}/_data/${uid}?${mask}`, true);
    const savedAt = Date.parse(doc.updateTime) || null;
    await readCompanions(uid);
    if (savedAt && latest && latest.uid === session.uid && latest.savedAt === savedAt) { // the same save: nothing new to read or record
      Object.assign(latest, { charNames: names, companions, fetchedAt: Date.now() });
      syncQuiet++;
      lastError = null;
      return;
    }
    syncQuiet = 0;
    const data = decodeFields(doc.fields || {});
    if (!Object.keys(data).some(k => k.startsWith('Lv0_'))) throw new UserError(NO_SAVE);
    latest = { uid: session.uid, data, charNames: names, companions, fetchedAt: Date.now(), savedAt };
    try { trackLoot(data, savedAt); } catch (e) { console.error(e); }
    try { recordForge(session.uid, data, latest.savedAt); } catch (e) { console.error(e); } // the graphs never get in the way of syncing
    try { trackArmory(session.uid, data, savedAt); } catch (e) { console.error(e); }
    recordDayStart().catch(e => console.error(e));
    lastError = null;
  } catch (e) {
    failed = true;
    lastError = e instanceof UserError ? e.message : 'Something went wrong reading your save. Will try again.';
    if (!(e instanceof UserError)) console.error(e);
  } finally {
    syncing = false;
    syncFails = failed ? syncFails + 1 : 0;
    nextSyncAt = Date.now() + syncWait();
  }
}

/* ---------- forge history, for the Forge tab's graphs ---------- */
// One row per cloud save: { t, u, c: { item: [in forge, in storage, in bags] } }, for bars and the ore in the forge. Older rows are thinned when the app starts.
let forgeHistory = [];
try {
  const all = fs.readFileSync(FORGE_HISTORY_FILE, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const cutoff = Date.now() - FORGE_HISTORY_FULL_MS, seen = new Set();
  forgeHistory = all.filter(r => {
    if (r.t >= cutoff) return true;
    const hour = r.u + '|' + Math.floor(r.t / 36e5);
    if (seen.has(hour)) return false;
    seen.add(hour);
    return true;
  });
  if (forgeHistory.length !== all.length) {
    fs.writeFileSync(FORGE_HISTORY_FILE + '.tmp', forgeHistory.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.renameSync(FORGE_HISTORY_FILE + '.tmp', FORGE_HISTORY_FILE);
  }
} catch { /* first run */ }
/* ---------- Royal Armory: the saves either side of each collect ---------- */
// Nodes only drain when banked time is collected, so a collect is where the rates show. Each one keeps the save before and after it; the page measures from them.
const ARMORY_KEEP = 8;
let armory = { uid: null, last: null, collects: [] };
try { armory = JSON.parse(fs.readFileSync(ARMORY_FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') keepCorrupt(ARMORY_FILE, e); }
function armoryState(data, savedAt) {
  const g = parsedList(data.RoyalG);
  return { savedAt, g: [g[2] || [], g[3] || [], g[4] || [], g[5] || []], maps: parsedList(data.RoyalMaps) };
}
function trackArmory(uid, data, savedAt) {
  if (!data.RoyalG || !savedAt) return;
  if (armory.uid !== uid) armory = { uid, last: null, collects: [] };
  const now = armoryState(data, savedAt), was = armory.last;
  if (was && savedAt <= was.savedAt) return;
  if (was && JSON.stringify(was.g[2]) !== JSON.stringify(now.g[2])) { armory.collects.push({ before: was, after: now }); armory.collects = armory.collects.slice(-ARMORY_KEEP); }
  armory.last = now;
  fs.writeFileSync(ARMORY_FILE + '.tmp', JSON.stringify(armory));
  fs.renameSync(ARMORY_FILE + '.tmp', ARMORY_FILE);
}
function recordForge(uid, data, savedAt) {
  if (!savedAt || forgeHistory.some(r => r.u === uid && r.t >= savedAt)) return;
  const c = {}, add = (item, place, n) => { if (+n > 0) (c[item] = c[item] || [0, 0, 0])[place] += +n; };
  const order = parsedList(data.ForgeItemOrder), qty = parsedList(data.ForgeItemQty), ores = new Set();
  order.forEach((item, i) => { if (i % 3 === 0 && item && item !== 'Blank') ores.add(item); });
  const wanted = item => /Bar$/.test(item) || ores.has(item);
  order.forEach((item, i) => { if (i % 3 !== 1 && wanted(item)) add(item, 0, qty[i]); });
  const chest = parsedList(data.ChestOrder), chestQty = parsedList(data.ChestQuantity);
  chest.forEach((item, i) => { if (wanted(item)) add(item, 1, chestQty[i]); });
  for (const k of Object.keys(data)) {
    const slot = k.match(/^InventoryOrder_(\d+)$/)?.[1];
    if (slot == null) continue;
    for (const [item, n] of Object.entries(bagCounts(data, slot))) if (wanted(item)) add(item, 2, n);
  }
  for (const item of Object.keys(c)) c[item] = c[item].map(n => Math.floor(n));
  const row = { t: savedAt, u: uid, c };
  forgeHistory.push(row);
  fs.appendFileSync(FORGE_HISTORY_FILE, JSON.stringify(row) + '\n');
}
// { items: every item recorded, rows: [[time, forge, storage, bags]] for one item }
function forgeHistoryView(item) {
  const mine = forgeHistory.filter(r => r.u === session?.uid), items = new Set();
  mine.forEach(r => Object.keys(r.c).forEach(k => items.add(k)));
  return { saves: mine.length, items: [...items], rows: mine.filter(r => r.c[item]).map(r => [r.t, ...r.c[item]]) };
}

/* ---------- team snapshots, for the Player tab's sheet ---------- */
// One gzipped file each: the save plus the Printer tab's extra fields, so the page can work out any value from it, new ones included. One by itself at the first save of each day, and one whenever asked.
const SNAP_NAME = /^(auto|manual)-([0-9]+)-([a-zA-Z0-9]+)[.]json[.]gz$/;
const snapUid = uid => String(uid).replace(/[^a-zA-Z0-9]/g, '');
const localDay = t => new Date(t).toDateString();
function snapList() {
  const mine = snapUid(session?.uid);
  let files = [];
  try { files = fs.readdirSync(SNAP_DIR); } catch { /* none yet */ }
  return files.flatMap(f => { const m = f.match(SNAP_NAME); return m && m[3] === mine ? [{ id: f.slice(0, -'.json.gz'.length), kind: m[1], t: +m[2] }] : []; }).sort((a, b) => a.t - b.t);
}
async function takeSnapshot(kind) {
  if (!latest?.savedAt || !session) throw new UserError('No save to snapshot yet.');
  const save = latest; // the sync may replace it while the extra fields are read
  const extra = await readPrinterExtra(true).catch(() => printerExtra);
  const id = kind + '-' + save.savedAt + '-' + snapUid(session.uid);
  fs.mkdirSync(SNAP_DIR, { recursive: true });
  const file = path.join(SNAP_DIR, id + '.json.gz');
  fs.writeFileSync(file + '.tmp', zlib.gzipSync(JSON.stringify({ t: save.savedAt, data: save.data, extra: extra?.data || null, vars: extra?.vars || null, companions: save.companions })));
  fs.renameSync(file + '.tmp', file);
  return { id, kind, t: save.savedAt };
}
let snapshotting = false;
async function recordDayStart() {
  if (snapshotting || !latest?.savedAt || snapList().some(s => s.kind === 'auto' && localDay(s.t) === localDay(latest.savedAt))) return;
  snapshotting = true;
  try { await takeSnapshot('auto'); } finally { snapshotting = false; }
}
function readSnapshot(id) {
  if (!snapList().some(s => s.id === id)) throw new UserError('No such snapshot.');
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(SNAP_DIR, id + '.json.gz'))));
}

/* ---------- active loot rates ---------- */
// One record per character and activity, so coming back to an activity carries on where its rates left off.
// Only time between two saves in a row of the same character doing the same thing counts.
let loot = { uid: null, activeKey: null, sessions: {} }, lootUndo = null;
try { loot = JSON.parse(fs.readFileSync(LOOT_FILE, 'utf8')); } catch (e) { keepCorrupt(LOOT_FILE, e); }
function saveLoot() {
  fs.writeFileSync(LOOT_FILE + '.tmp', JSON.stringify(loot));
  fs.renameSync(LOOT_FILE + '.tmp', LOOT_FILE);
}
const parsedList = v => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch { return []; } };
// The game only keeps moving the time stamp of the character being played.
function activeSlot(data) {
  let best = null, newest = -Infinity;
  for (const k of Object.keys(data)) {
    const slot = k.match(/^PTimeAway_(\d+)$/)?.[1], stamp = slot ? parseFloat(data[k]) : NaN;
    if (stamp > newest) { newest = stamp; best = +slot; }
  }
  return best;
}
// Each of these items across every character's bags and storage.
function accountCounts(data, items) {
  const want = new Set(items), out = {}, add = (item, n) => { if (want.has(item)) out[item] = (out[item] || 0) + (parseFloat(n) > 0 ? parseFloat(n) : 1); };
  items.forEach(item => { out[item] = 0; });
  const chest = parsedList(data.ChestOrder), chestQty = parsedList(data.ChestQuantity);
  chest.forEach((item, i) => add(item, chestQty[i]));
  Object.keys(data).forEach(k => { const slot = k.match(/^InventoryOrder_(\d+)$/)?.[1]; if (slot == null) return; const qty = parsedList(data['ItemQTY_' + slot]); parsedList(data[k]).forEach((item, i) => add(item, qty[i])); });
  return out;
}
function bagCounts(data, slot) {
  const order = parsedList(data['InventoryOrder_' + slot]), qty = parsedList(data['ItemQTY_' + slot]), counts = {};
  order.forEach((item, i) => {
    if (!item || item === 'Blank' || item === 'LockedInvSpace') return;
    const n = parseFloat(qty[i]);
    counts[item] = (counts[item] || 0) + (n > 0 ? n : 1);
  });
  return counts;
}
// Cards go straight to the account's collection, by monster, and never into bags.
function cardCounts(data) {
  let cards;
  try { cards = typeof data.Cards0 === 'string' ? JSON.parse(data.Cards0) : data.Cards0; } catch { return {}; }
  const counts = {};
  for (const [monster, n] of Object.entries(cards || {})) if (parseFloat(n) > 0) counts['card:' + monster] = parseFloat(n);
  return counts;
}
// Obol fragments, the account's: obols auto-trashed while fighting turn into them. A running total, so only its moves count.
function obolFragCount(data) {
  const n = parseFloat(data.CYObolFragments);
  return n >= 0 ? { ObolFrag: n } : {};
}
// A map's kills-left counter keeps falling past zero once its portal is open, so it counts kills on any map.
function mapKills(data, slot, mapIdx) {
  const left = parseFloat(parsedList(data['KLA_' + slot])[mapIdx]?.[0]);
  return Number.isFinite(left) ? { kills: -left } : {};
}
// [level, EXP into that level, EXP that level needs] for each of a character's skills, the class level first.
function skillStates(data, slot) {
  const lv = parsedList(data['Lv0_' + slot]), req = parsedList(data['ExpReq0_' + slot]);
  return parsedList(data['Exp0_' + slot]).map((x, i) => [parseFloat(lv[i]), parseFloat(x), parseFloat(req[i])]);
}
// EXP earned between two saves. Over a level-up it's the rest of the old level, every level passed clean through, and what's into the new one.
// The save only holds the cost of the level it's on, so the levels between are filled in on the curve between the old cost and the new:
// the costs grow by close to the same factor each level, which puts this within 0.1% of the game's formula past level 200.
function expGained(before, after) {
  if (!before || !after) return 0;
  const [level0, exp0, need0] = before, [level1, exp1, need1] = after;
  if (![level0, exp0, level1, exp1].every(Number.isFinite)) return 0;
  if (level1 === level0) return Math.max(exp1 - exp0, 0);
  if (level1 < level0) return 0;
  const steps = level1 - level0, from = need0 > 0 ? need0 : need1 > 0 ? need1 : 0, to = need1 > 0 ? need1 : from;
  let between = 0;
  for (let k = 1; from > 0 && k < steps && k < 1000; k++) between += from * Math.pow(to / from, k / steps);
  return (need0 > 0 ? Math.max(need0 - exp0, 0) : 0) + between + Math.max(exp1, 0);
}
// A character's coins, in the smallest coin. Like kills, it's a running total rather than a count from zero.
function coinCount(data, slot) {
  const n = parseFloat(data['Money_' + slot]);
  return n >= 0 ? { coins: n } : {};
}
// Royal Guardian outposts: how much of this map is cleared towards its outpost. Only while it's being cleared; a built outpost's entry is a long list.
function outpostClearing(data, mapIdx) {
  const e = parsedList(data.RoyalMaps)[mapIdx], n = Array.isArray(e) && e.length === 1 ? parseFloat(e[0]) : NaN;
  return Number.isFinite(n) && n >= 0 ? { outpost: n } : {};
}
const LOOT_COUNTERS = new Set(['kills', 'coins', 'outpost', 'ObolFrag']);
// Soldiers don't clear as they go: their kills are banked (RoyalG[3][0] counts the seconds) and land on each map in one lump when the kingdom screen is opened.
// So they're measured at a collect: between two saves in a row where the banked seconds went back down, each map's jump over the time that was banked is its soldiers' rate.
// Every clearing unit clears at the same rate, so it's kept per unit: the jump over the banked time, over the units sent there (the same at both saves). A map's rate is that times the units there now.
// The map being played is measured too, its jump less what the player cleared there over the same time, from stretches without a collect. A map someone else was played on in between is left out.
const OUTPOST_BG_STRETCHES = 20;
// Clearing units (job 4) sent at each map: for each world's units, RoyalG[6 + 2w] are their jobs and RoyalG[7 + 2w] their maps.
function clearingUnits(data) {
  const g = parsedList(data.RoyalG), out = {};
  for (let w = 0; w < 8; w++) {
    const jobs = g[6 + 2 * w], maps = g[7 + 2 * w];
    if (!Array.isArray(jobs) || !Array.isArray(maps)) continue;
    jobs.forEach((job, k) => { const m = Math.round(parseFloat(maps[k])); if (Math.round(parseFloat(job)) === 4 && m >= 0) out[m] = (out[m] || 0) + 1; });
  }
  return out;
}
function trackOutpostSoldiers(data, savedAt, live) {
  const banked = parseFloat((parsedList(data.RoyalG)[3] || [])[0]);
  const maps = parsedList(data.RoyalMaps), liveMap = live == null ? null : +data['CurrentMap_' + live], counts = {}, away = {};
  maps.forEach((e, i) => { const n = Array.isArray(e) && e.length === 1 ? parseFloat(e[0]) : NaN; if (Number.isFinite(n) && n >= 0) counts[i] = n; });
  // Who is on each map, and when they last went AFK. Being played moves that, so a change between two saves means someone was active in between, even if neither save caught them live.
  Object.keys(data).forEach(k => { const slot = k.match(/^CurrentMap_(\d+)$/)?.[1]; if (slot == null) return; const m = +data[k]; (away[m] = away[m] || {})[slot] = parseFloat(data['PTimeAway_' + slot]) || 0; });
  const units = clearingUnits(data);
  const bg = loot.outpostBg = loot.outpostBg || { at: null, counts: null, liveMap: null, away: null, banked: null, units: null, perUnit: [], own: {} };
  const playedBetween = i => { const a = (bg.away && bg.away[i]) || {}, b = away[i] || {}; return [...new Set([...Object.keys(a), ...Object.keys(b)])].some(s => a[s] !== b[s]); }; // someone arrived, left, or was played
  if (bg.at != null && savedAt <= bg.at) return;
  // collected in between: the banked seconds went down, or stayed at 0 because the kingdom screen was open and paid out as it went
  const collected = Number.isFinite(banked) && Number.isFinite(bg.banked) && (banked < bg.banked || (banked === 0 && bg.banked === 0));
  if (bg.at != null && collected && savedAt - bg.at <= LOOT_GAP_MS) {
    // what was banked when it paid out: the last save's, plus the time to the collect. Since the collect it's counted up again to what this save has
    const paidFor = (bg.banked + (savedAt - bg.at) / 1000 - banked) * 1000;
    if (paidFor > 0) for (const i of Object.keys(counts)) {
      const n = units[i] || 0;
      if (!n || (bg.units && bg.units[i]) !== n || bg.counts[i] == null || counts[i] < bg.counts[i]) continue;
      let gained = counts[i] - bg.counts[i];
      if (+i === liveMap || +i === bg.liveMap) {
        // played: take off what the player clears there, measured between collects; not until that's known, nor across a change of who's played
        const own = bg.own[i];
        if (+i !== liveMap || +i !== bg.liveMap || !own || !own.length) continue;
        gained -= own.reduce((s, x) => s + x[1], 0) / own.reduce((s, x) => s + x[0], 0) * (savedAt - bg.at);
        if (gained <= 0) continue;
      } else if (playedBetween(i)) continue;
      bg.perUnit.push([paidFor * n, gained]);
      if (bg.perUnit.length > OUTPOST_BG_STRETCHES) bg.perUnit.shift();
    }
  } else if (bg.at != null && liveMap != null && liveMap === bg.liveMap && savedAt - bg.at <= LOOT_GAP_MS && counts[liveMap] != null && bg.counts[liveMap] != null && counts[liveMap] >= bg.counts[liveMap]) {
    // no collect: what the played map moved is the player's own
    const own = bg.own[liveMap] = bg.own[liveMap] || [];
    own.push([savedAt - bg.at, counts[liveMap] - bg.counts[liveMap]]);
    if (own.length > OUTPOST_BG_STRETCHES * 3) own.shift();
  }
  bg.at = savedAt; bg.counts = counts; bg.liveMap = liveMap; bg.away = away; bg.units = units; bg.banked = Number.isFinite(banked) ? banked : null;
}
// What one clearing unit clears, { gained, ms }, or null before a collect's been measured.
function outpostUnitRate() {
  const list = loot.outpostBg?.perUnit;
  if (!list || !list.length) return null;
  return { gained: list.reduce((n, x) => n + x[1], 0), ms: list.reduce((n, x) => n + x[0], 0) };
}
// { gained, ms } the player clears on a map they're played on, between collects, or null before it's been measured.
function outpostOwn(mapIdx) {
  const list = loot.outpostBg?.own?.[mapIdx];
  if (!list || !list.length) return null;
  return { gained: list.reduce((n, x) => n + x[1], 0), ms: list.reduce((n, x) => n + x[0], 0) };
}
// { gained, ms, units } of a map's soldiers: one unit's, times the units sent there now. Null before anything's been measured.
function outpostSoldiers(mapIdx) {
  const one = outpostUnitRate(), n = (loot.outpostBg?.units || {})[mapIdx] || 0;
  return one && { gained: one.gained * n, ms: one.ms, units: n };
}
function trackLoot(data, savedAt) {
  const slot = activeSlot(data);
  if (slot == null || !savedAt || !session) return;
  if (loot.uid !== session.uid) loot = { uid: session.uid, activeKey: null, sessions: {} };
  trackOutpostSoldiers(data, savedAt, slot);
  trackAfkClaims(data, savedAt);
  const afkId = data['AFKtarget_' + slot] ?? '', mapIdx = +data['CurrentMap_' + slot];
  const key = [slot, afkId, mapIdx].join('|');
  const s = loot.sessions[key] = loot.sessions[key] || { slot, afkId, mapIdx, ms: 0, items: {}, at: null, counts: null, startAfter: 0 };
  const carriedOn = loot.activeKey === key;
  loot.activeKey = key;
  if (savedAt < s.startAfter || (s.at != null && savedAt <= s.at)) return saveLoot(); // a reset waits for a save made after it
  const counts = { ...bagCounts(data, slot), ...cardCounts(data), ...obolFragCount(data), ...mapKills(data, slot, mapIdx), ...coinCount(data, slot), ...outpostClearing(data, mapIdx) }, passed = savedAt - s.at, skills = skillStates(data, slot);
  if (carriedOn && s.at != null && passed <= LOOT_GAP_MS) {
    s.ms += passed;
    const stretch = { ms: passed, gains: {} };
    (s.stretches = s.stretches || []).push(stretch);
    if (s.stretches.length > 300) s.stretches.shift();
    if (s.skills) { // EXP has its own clock, since records from before it was tracked have time on theirs already
      s.expMs = (s.expMs || 0) + passed;
      s.exp = s.exp || {};
      stretch.exp = {};
      skills.forEach((state, i) => { const gain = expGained(s.skills[i], state); if (gain > 0) { stretch.exp[i] = gain; s.exp[i] = (s.exp[i] || 0) + gain; } });
    }
    for (const item of new Set([...Object.keys(counts), ...Object.keys(s.counts)])) {
      if (LOOT_COUNTERS.has(item) && (counts[item] == null || s.counts[item] == null)) { // a counter, not a count from zero: only time it was seen moving counts
        const it = s.items[item] = s.items[item] || { gained: 0, skipMs: 0 };
        it.skipMs = it.gained ? it.skipMs + passed : s.ms;
        continue;
      }
      const change = (counts[item] || 0) - (s.counts[item] || 0);
      if (!change) continue;
      const it = s.items[item] = s.items[item] || { gained: 0, skipMs: 0 };
      if (change > 0) { it.gained += change; stretch.gains[item] = change; }
      else it.skipMs += passed; // put away: drops in this stretch can't be told apart, so it says nothing about the rate
    }
    // outpost clearing: the kills made over the same stretches, so kills each compares like with like
    if (counts.outpost != null && s.counts.outpost != null && counts.outpost >= s.counts.outpost && counts.kills != null && s.counts.kills != null && counts.kills >= s.counts.kills && s.items.outpost) s.items.outpost.kills = (s.items.outpost.kills || 0) + counts.kills - s.counts.kills;
  }
  s.at = savedAt;
  s.counts = counts;
  s.skills = skills;
  saveLoot();
}
// Claiming AFK lands everything from the time away in one stretch, which isn't what playing gains. It stands out: far above the usual stretch, once there are enough to know what's usual.
// Usual is what the stretches around it gained, not the whole session's: a claim is one spike, while getting stronger (more multikill, say) lifts every stretch from then on, and those all count.
const CLAIM_TIMES_USUAL = 10, CLAIM_MIN_STRETCHES = 3, CLAIM_NEIGHBOURS = 5;
function claimStretches(s) {
  const list = s.stretches || [];
  if (list.length < CLAIM_MIN_STRETCHES) return [];
  // A claim lands loot and EXP together, but either alone gives it away: an activity may drop almost nothing. They're judged apart, as EXP's numbers would swamp the loot's.
  const pace = x => Object.entries(x.gains).reduce((a, [item, n]) => item === 'coins' ? a : a + n, 0) / x.ms;
  const nearOf = (all, i) => [...all.slice(Math.max(i - CLAIM_NEIGHBOURS, 0), i), ...all.slice(i + 1, i + 1 + CLAIM_NEIGHBOURS)];
  const median = near => near.sort((a, b) => a - b)[Math.floor(near.length / 2)];
  const spike = (value, near) => { const usual = median(near); return usual > 0 && value > usual * CLAIM_TIMES_USUAL; };
  // EXP goes by the skills the activity keeps moving: one that turns up a stretch or two from elsewhere, with numbers far past the rest, isn't a claim
  const steady = i => { const near = nearOf(list, i), skills = new Set(near.flatMap(x => Object.keys(x.exp || {}))); return [...skills].filter(k => near.filter(x => (x.exp || {})[k] > 0).length * 2 >= near.length); };
  const expPace = (x, skills) => skills.reduce((a, k) => a + ((x.exp || {})[k] || 0), 0) / x.ms;
  const paces = list.map(pace);
  return list.filter((x, i) => { const skills = steady(i); return spike(paces[i], nearOf(paces, i)) || spike(expPace(x, skills), nearOf(list, i).map(y => expPace(y, skills))); });
}
// AFK pay, measured at claims. PTimeAway is when a character was last loaded, so the newest is the one being played, and a character is left AFK when another is loaded after it.
// Every save, each character's bags are kept; from when another is loaded they're held as they were, so whatever lands before the claim shows, even in a save that comes before its time stamp moves.
// At the claim (its time stamp moves on), what its bags gained over that, counted only as far as the whole account gained it, over the time from being left to being loaded again, is what AFK paid on that target.
const AFK_CLAIMS_KEPT = 20;
function trackAfkClaims(data, savedAt) {
  const stamps = {};
  for (const k of Object.keys(data)) { const slot = k.match(/^PTimeAway_(\d+)$/)?.[1]; if (slot != null && parseFloat(data[k]) > 0) stamps[slot] = parseFloat(data[k]) * 1e6; }
  const box = loot.afkSlots = loot.afkSlots || {}, claims = loot.afkClaims = loot.afkClaims || {};
  for (const [slot, stamp] of Object.entries(stamps)) {
    const target = data['AFKtarget_' + slot] ?? '', mapIdx = +data['CurrentMap_' + slot], bags = bagCounts(data, slot), prev = box[slot];
    // when it was left: the first character loaded after it (one loaded again since only shows its later time, so this can come out late, and the time away short)
    const after = Object.entries(stamps).filter(([s, v]) => s !== slot && v > stamp).map(([, v]) => v), leftAt = after.length ? Math.min(...after) : null;
    // Only a time away that was seen start counts: the character was the one being played in a save, then another was loaded. First seen already away, it can't be told how long.
    if (prev && stamp > prev.stamp && prev.leftAt != null && prev.seen && prev.target === target && prev.mapIdx === mapIdx) {
      const totals = accountCounts(data, Object.keys(bags)), gains = {};
      for (const item of Object.keys(bags)) {
        if (prev.bags[item] == null || prev.totals[item] == null) continue;
        const gain = Math.min(bags[item] - prev.bags[item], totals[item] - prev.totals[item]);
        if (gain > 0) gains[item] = gain;
      }
      const ms = stamp - prev.leftAt;
      if (ms > 0 && Object.keys(gains).length) { const list = claims[slot + '|' + target] = claims[slot + '|' + target] || []; list.push({ ms, at: savedAt, gains }); if (list.length > AFK_CLAIMS_KEPT) list.shift(); }
    }
    // played, or just loaded: its bags follow along. Once another is loaded after it, they're held as they were then until it's loaded again.
    if (!prev || stamp > prev.stamp || prev.leftAt == null) box[slot] = { stamp, target, mapIdx, bags, totals: accountCounts(data, Object.keys(bags)), leftAt, seen: leftAt == null || !!(prev && (stamp > prev.stamp || prev.seen)) }; // loaded since the last save, or played in one: when it was left is known
  }
}
// What each character's AFK paid in items, by what they were on: { 'slot|afkId': { item: { gained, ms, claims } } }.
function afkPayView() {
  const out = {};
  if (!session || loot.uid !== session.uid) return out;
  for (const [key, list] of Object.entries(loot.afkClaims || {})) {
    const box = out[key] = {};
    list.forEach(c => Object.entries(c.gains).forEach(([item, n]) => { const it = box[item] = box[item] || { gained: 0, ms: 0, claims: 0 }; it.gained += n; it.ms += c.ms; it.claims++; }));
  }
  return out;
}
// Class EXP per kill as the game counts kills, multikill included, for each character and target. A claim is what AFK really pays, so claims are used once there are any.
function expPerKillView() {
  const out = {};
  if (!session || loot.uid !== session.uid) return out;
  for (const s of Object.values(loot.sessions)) {
    const both = (s.stretches || []).filter(x => x.exp?.[0] > 0 && x.gains.kills > 0);
    if (!both.length) continue;
    const claims = claimStretches(s).filter(x => both.includes(x)), used = claims.length ? claims : both, kills = used.reduce((n, x) => n + x.gains.kills, 0);
    const key = s.slot + '|' + s.afkId, had = out[key];
    if (!had || kills > had.kills) out[key] = { perKill: used.reduce((n, x) => n + x.exp[0], 0) / kills, kills, from: claims.length ? 'claim' : 'play' };
  }
  return out;
}
// Coins jump for reasons of their own, such as selling to a shop. A stretch far above the usual is left out with its time, along with claims.
function coinStretchesOut(s, claims) {
  const earning = (s.stretches || []).filter(x => x.gains.coins > 0), pace = x => x.gains.coins / x.ms;
  const paces = earning.map(pace).sort((a, b) => a - b), usual = paces[Math.floor(paces.length / 2)];
  return earning.filter(x => claims.includes(x) || (paces.length >= CLAIM_MIN_STRETCHES && pace(x) > usual * CLAIM_TIMES_USUAL));
}
function lootView() {
  const s = session && loot.uid === session.uid ? loot.sessions[loot.activeKey] : null;
  const goals = loot.goals || {}, expPerKill = expPerKillView();
  const afkPay = afkPayView();
  if (!s) return { active: null, goals, expPerKill, afkPay };
  const claims = claimStretches(s), claimMs = claims.reduce((n, x) => n + x.ms, 0), coinsOut = coinStretchesOut(s, claims), left = item => item === 'coins' ? coinsOut : claims, claimed = item => left(item).reduce((n, x) => n + (x.gains[item] || 0), 0);
  const items = Object.entries(s.items).filter(([item, it]) => it.gained - claimed(item) > 0)
    .map(([item, it]) => ({ item, gained: it.gained - claimed(item), ms: s.ms - it.skipMs - left(item).reduce((n, x) => n + x.ms, 0), count: s.counts?.[item] || 0, ...(it.kills ? { kills: it.kills } : {}) }));
  const expClaims = claims.filter(x => x.exp), expMs = (s.expMs || 0) - expClaims.reduce((n, x) => n + x.ms, 0);
  const exp = Object.entries(s.exp || {}).map(([i, gained]) => ({ skill: +i, gained: gained - expClaims.reduce((n, x) => n + (x.exp[i] || 0), 0), ms: expMs, level: s.skills?.[i]?.[0], into: s.skills?.[i]?.[1], need: s.skills?.[i]?.[2] })).filter(x => x.gained > 0 && x.ms > 0);
  return { active: { slot: s.slot, name: names?.[s.slot] || '', afkId: s.afkId, mapIdx: s.mapIdx, soldiers: outpostSoldiers(s.mapIdx), soldierUnit: outpostUnitRate(), clearOwn: outpostOwn(s.mapIdx), ms: s.ms - claimMs, at: s.at, waiting: s.at == null, items, exp }, goals, expPerKill, afkPay};
}
function setLootGoal(item, goal) {
  if (typeof item !== 'string' || !/^[A-Za-z0-9_]+$/.test(item)) throw new UserError('That item isn’t recognised.');
  loot.goals = loot.goals || {};
  if (goal > 0 && Number.isFinite(goal)) loot.goals[item] = goal;
  else delete loot.goals[item];
  saveLoot();
}
function resetLoot() {
  const s = loot.sessions[loot.activeKey];
  if (!s) return;
  lootUndo = { key: loot.activeKey, session: s };
  loot.sessions[loot.activeKey] = { slot: s.slot, afkId: s.afkId, mapIdx: s.mapIdx, ms: 0, items: {}, at: null, counts: null, startAfter: Date.now() };
  saveLoot();
}
function undoLootReset() {
  if (!lootUndo) return;
  loot.sessions[lootUndo.key] = lootUndo.session;
  lootUndo = null;
  saveLoot();
}

function status() {
  return {
    signedIn: !!session, method: session?.method || null, remembered, error: lastError,
    fetchedAt: latest?.fetchedAt || null, savedAt: latest?.savedAt || null, everyMs: SYNC_EVERY_MS, google: googleLogin, sheetRev: sheetRev(), pageRev: fs.statSync(PAGE).mtimeMs,
    steamUrl: 'https://steamcommunity.com/openid/login?openid.ns=http://specs.openid.net/auth/2.0&openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select&openid.identity=http://specs.openid.net/auth/2.0/identifier_select&openid.return_to=' + STEAM_RETURN + '&openid.realm=' + STEAM_RETURN + '&openid.mode=checkid_setup',
  };
}

/* ---------- the local web server ---------- */
const SHELL_HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
let lastSeen = Date.now();
function sheetRev() {
  try { return String(fs.statSync(SHEET_FILE).mtimeMs); } catch { return '0'; }
}
// One copy per day, from just before that day's first change, keeping the latest two weeks.
function backupSheet() {
  try {
    const name = 'sheet-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    if (!fs.existsSync(SHEET_FILE) || fs.existsSync(path.join(DATA_DIR, name))) return;
    fs.copyFileSync(SHEET_FILE, path.join(DATA_DIR, name));
    const old = fs.readdirSync(DATA_DIR).filter(f => /^sheet-backup-.*\.json$/.test(f)).sort().slice(0, -14);
    old.forEach(f => fs.rmSync(path.join(DATA_DIR, f), { force: true }));
  } catch (e) {
    console.error(e); // a failed backup shouldn't stop the save itself
  }
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 2e6) { reject(new UserError('That’s too much data.')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new UserError('Bad request.')); }
    });
  });
}
const server = http.createServer(async (req, res) => {
  try {
    // Only this PC's own page may talk to this server, never a website you happen to have open.
    const allowed = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
    if (!allowed.includes(req.headers.host)) return send(res, 403, { error: 'Forbidden' });
    const origin = req.headers.origin;
    if (origin && !allowed.some(a => origin === 'http://' + a)) return send(res, 403, { error: 'Forbidden' });
    const url = new URL(req.url, 'http://local');
    const route = req.method + ' ' + url.pathname;

    if (route === 'GET /') {
      res.setHeader('Content-Security-Policy', CSP);
      return send(res, 200, SHELL_HEAD.replace('<head>', '<head><meta name=page-rev content="' + fs.statSync(PAGE).mtimeMs + '">') + fs.readFileSync(PAGE, 'utf8') + '</body></html>', 'text/html; charset=utf-8');
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
    const icon = req.method === 'GET' && url.pathname.match(/^\/icons\/([A-Za-z0-9_]+\.png)$/);
    if (icon) {
      let png;
      try { png = fs.readFileSync(path.join(__dirname, 'icons', icon[1])); } catch { return send(res, 404, { error: 'Not found' }); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return res.end(png);
    }
    const map = req.method === 'GET' && url.pathname.match(/^\/maps\/(w[1-8])\.(webp|png|jpg)$/);
    if (map) {
      let img;
      try { img = fs.readFileSync(path.join(MAPS_DIR, map[1] + '.' + map[2])); } catch { return send(res, 404, { error: 'Not found' }); }
      res.writeHead(200, { 'Content-Type': map[2] === 'jpg' ? 'image/jpeg' : 'image/' + map[2], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      return res.end(img);
    }
    if (route === 'GET /api/ping') return send(res, 200, { app: 'idleon-afk-planner', started: STARTED, pid: process.pid });
    if (req.method !== 'GET' && req.headers['x-planner'] !== '1') return send(res, 403, { error: 'Forbidden' });

    if (route === 'GET /api/status') { lastSeen = Date.now(); return send(res, 200, status()); }
    if (route === 'GET /api/latest') return send(res, 200, latest || {});
    if (route === 'GET /api/printer-extra') return send(res, 200, await readPrinterExtra(false));
    if (route === 'POST /api/printer-extra') return send(res, 200, await readPrinterExtra(true));
    if (route === 'GET /api/snapshots') return send(res, 200, snapList());
    if (route === 'POST /api/snapshots') return send(res, 200, await takeSnapshot('manual'));
    if (req.method === 'GET' && url.pathname.startsWith('/api/snapshots/')) return send(res, 200, readSnapshot(url.pathname.slice('/api/snapshots/'.length)));
    if (route === 'GET /api/forge-history') return send(res, 200, forgeHistoryView(url.searchParams.get('item')));
    if (route === 'GET /api/state') {
      let state = null;
      try { state = JSON.parse(fs.readFileSync(SHEET_FILE, 'utf8')); } catch { /* first run */ }
      return send(res, 200, { state, rev: sheetRev() });
    }
    if (route === 'PUT /api/state') {
      const body = await readBody(req);
      if (!Array.isArray(body.rows)) throw new UserError('Bad request.');
      // A window holding an older copy must not overwrite what another window saved.
      if (url.searchParams.get('rev') !== sheetRev()) return send(res, 409, { error: 'The sheet changed in another window.' });
      // A window still running an older version of the page mustn't write its older idea of the rows.
      if (url.searchParams.get('page') !== String(fs.statSync(PAGE).mtimeMs)) return send(res, 409, { error: 'This window is out of date.' });
      backupSheet();
      fs.writeFileSync(SHEET_FILE + '.tmp', JSON.stringify(body));
      fs.renameSync(SHEET_FILE + '.tmp', SHEET_FILE);
      return send(res, 200, { ok: true, rev: sheetRev() });
    }
    if (route === 'GET /api/loot') return send(res, 200, lootView());
    if (route === 'GET /api/armory') return send(res, 200, { collects: session && armory.uid === session.uid ? armory.collects : [], maps: ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'].map(w => ['webp', 'png', 'jpg'].find(x => fs.existsSync(path.join(MAPS_DIR, w + '.' + x))) || null) });
    if (route === 'POST /api/loot/reset') { resetLoot(); return send(res, 200, lootView()); }
    if (route === 'POST /api/loot/goal') { const { item, goal } = await readBody(req); setLootGoal(item, goal); return send(res, 200, lootView()); }
    if (route === 'POST /api/loot/undo') { undoLootReset(); return send(res, 200, lootView()); }
    if (route === 'POST /api/login/email') {
      const { email, password } = await readBody(req);
      await signInEmail(email, password);
      await syncNow();
      return send(res, 200, status());
    }
    if (route === 'POST /api/login/steam') {
      const body = await readBody(req);
      await signInSteam(body.url);
      await syncNow();
      return send(res, 200, status());
    }
    if (route === 'POST /api/login/google') { await startGoogle(); return send(res, 200, status()); }
    if (route === 'POST /api/login/google/cancel') { googleLogin = null; return send(res, 200, status()); }
    if (route === 'POST /api/signout') { forgetSession(); googleLogin = null; lastError = null; return send(res, 200, status()); }
    if (route === 'POST /api/sync') { await syncNow(); return send(res, 200, status()); }
    if (route === 'POST /api/restart') { send(res, 200, { restarting: true, started: STARTED }); restart(); return; }
    return send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e instanceof UserError) return send(res, 400, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Something went wrong in the planner app.' });
  }
});

// Restart: let go of the port, start a fresh copy of this app on it (with the newest server.js), and stop. The open window stays and reconnects, so the new copy opens none.
const STARTED = Date.now();
let restarting = false;
function restart() {
  if (restarting) return;
  restarting = true;
  server.close(() => {
    let out = 'ignore';
    try { out = fs.openSync(LOG_FILE, 'a'); } catch { /* no log */ }
    const child = spawn(process.execPath, process.argv.slice(1), { cwd: process.cwd(), env: { ...process.env, PLANNER_RESTARTED: '1' }, detached: true, stdio: ['ignore', out, out], windowsHide: true }); // its output, and any crash, go to server.log
    child.unref();
    logLine('restarting: started pid', child.pid);
    process.exit(0);
  });
  setTimeout(() => server.closeAllConnections && server.closeAllConnections(), 200); // after the reply has gone out
}
function openWindow() {
  if (process.env.PLANNER_NO_WINDOW || process.env.PLANNER_RESTARTED) return;
  const target = `http://127.0.0.1:${PORT}/`;
  const browsers = [
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  const app = browsers.find(b => fs.existsSync(b));
  if (app) spawn(app, ['--app=' + target, '--window-size=1500,900'], { detached: true, stdio: 'ignore' }).unref();
  else spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
}
server.on('error', async err => {
  if (err.code !== 'EADDRINUSE') throw err;
  // Already running: just show another window.
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/ping`);
    if ((await r.json()).app === 'idleon-afk-planner') { openWindow(); process.exit(0); }
  } catch { /* something else has the port */ }
  console.error(`Port ${PORT} is being used by another program.`);
  logLine('stopped: port', PORT, 'is being used by another program');
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', async () => {
  console.log(`Idleon AFK Planner is running at http://127.0.0.1:${PORT}/ . Closing the window stops it after a few minutes.`);
  logLine('started' + (process.env.PLANNER_RESTARTED ? ' by a restart' : ''), 'node', process.version);
  await loadSession();
  openWindow();
  if (session) syncNow();
  setInterval(() => { if (session && Date.now() - lastSeen < QUIT_AFTER_MS && Date.now() >= nextSyncAt - 1000) syncNow(); }, SYNC_EVERY_MS);
  setInterval(() => { if (Date.now() - lastSeen > QUIT_AFTER_MS) { logLine('stopped: no open window for 5 minutes'); process.exit(0); } }, 30000);
});
