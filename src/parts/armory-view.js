/* ---------- World: Royal Armory ---------- */
// Every resource node: will it be empty before the daily reset, and if not, how long it really takes.
// Nodes drain only when banked time is collected. A node refills at the reset only if it's empty (+1 grade); otherwise it carries on.
// Rates follow Idleon Toolbox's parse of the game, calculated from the save so an edit shows at once. Only the account bonuses the save doesn't hold
// (companions, sushi, a bubble, the arcade, talents) are one measured number, from your collects; they rarely change. Measured node rates show beside, once a collect covers them.
const armoryList = v => { try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch { return []; } };
const armoryRankNeed = (e, a) => a === 4 ? 1e5 * Math.pow(10, e) : a === 2 ? (50 + 50 * e) * Math.pow(1.8, e) : (10 + 5 * e) * Math.pow(1.3, e);
const armoryRank = (raw, a) => { const x = +raw[3 + a] || 0; let i = 0; while (i < 1e3 && x >= armoryRankNeed(i, a)) i++; return i; };
const armoryNodeSize = (i, grade) => 5 * ARMORY_NODES[i][2] * Math.pow(1.5, grade) * Math.pow(5, Math.floor(i / 20));
const armoryWorldOf = i => 1 + Math.floor(i / 20);
// Each outpost: what it is, what it drains, and its own factor on the account's base rate.
function armoryOutposts(levels, maps) {
  const ey = i => (+levels[i] || 0) * (ARMORY_BPL[i] ?? 0);
  const supported = new Map();
  maps.forEach(e => { if (Array.isArray(e) && e.length >= 3 && +e[10] === 1) [8, 9].forEach(k => { const t = Math.round(+e[k] - 1e3); if (t >= 0) supported.set(t, (supported.get(t) || 0) + 1); }); });
  const support = 200 * (1 + ey(43) / 100), worker = 50 + ey(19), out = [];
  maps.forEach((raw, map) => {
    if (!Array.isArray(raw) || raw.length < 3) return;
    const ranks = [0, 1, 2, 3, 4].map(a => armoryRank(raw, a)), barracks = +raw[0] || 0, logistics = +raw[1] || 0, mode = Math.round(+raw[10]) || 0;
    const units = String(raw[11] ?? '').split('').slice(0, Math.min(7, 1 + barracks)).map(c => Math.round(+c - 2));
    // Units by type, worker, trader, guard, surveyor: the ones stationed, as the outpost's screen shows them, and the free ones every 4 Command ranks
    // (a boosted outpost gets a worker too) that the game counts in the rates but doesn't show
    const counts = [0, 1, 2, 3].map(a => units.filter(u => u === a).length), passive = [0, 1, 2, 3].map(a => Math.ceil(Math.max(0, ranks[2] - a) / 4) + (a === 0 ? Math.min(1, +raw[12] || 0) : 0));
    const workers = counts[0] + passive[0], purified = ranks[4] >= 1;
    const factor = (1 + (200 + ey(1)) * purified / 100) * (1 + support * (supported.get(map) || 0) / 100) * (1 + 5 * logistics / 100) * (1 + ranks[2] * ey(73) / 100) * (1 + worker * workers / 100) * Math.min(5, 1 + 10 * Math.max(0, Math.round(barracks - 6)) / 100);
    const links = mode === 1 ? [] : [8, 9].map(k => Math.round(+raw[k])).filter(n => n >= 0 && n <= 999);
    const supports = mode === 1 ? [8, 9].map(k => Math.round(+raw[k] - 1e3)).filter(n => n >= 0) : [];
    out.push({ map, world: 1 + Math.floor(map / 50), mode, factor, links, supports, purified, counts, passive, command: ranks[2], upgrades: barracks + logistics + (+raw[2] || 0), layout: JSON.stringify([0, 1, 2, 8, 9, 10, 11, 12].map(k => raw[k])) }); // layout: what a collect can't change (rank EXP does)
  });
  return out;
}
const armorySavage = levels => 5 * (1 + (+levels[69] || 0) * ARMORY_BPL[69] / 100);
// What one outpost drains from one node an hour, per unit of base rate.
const armoryPull = (o, grade, savage, asSavage) => o.mode === 1 ? 0 : o.factor * (1 + 0.25 * grade) * (asSavage || o.mode === 2 ? savage : 1);
// Account bonuses the save holds, for the base rate: orblets, Resource Replenish, the Global Decrees on grades, outpost upgrades and purified maps,
// the Royal Guardian's level and the stored resources. acct: { orb, logSum, hundreds } from the save now; they move too slowly to matter between a collect and now.
function armoryAccount(G, rgLevel) {
  const res = G[1] || [], orb = Math.floor(5 * (+(G[23] || [])[1] || 0));
  const logSum = [0, 1, 2, 3, 4, 5, 6, 7].reduce((s, w) => { const x = +res[10 * w] || 0; return s + (x > 1 ? Math.log10(x) : 0); }, 0);
  return { orb, logSum, hundreds: Math.floor(Math.max(0, (rgLevel || 0) - 1000) / 100) };
}
// The same product Idleon Toolbox builds in parsers/class-specific/royalGuardian.ts (armoryBonus 70, 18, 50, 51, 52 and 53).
function armoryKnown(levels, grades, ops, acct) {
  const ey = i => (+levels[i] || 0) * (ARMORY_BPL[i] ?? 0), sum = a => a.reduce((s, x) => s + (+x || 0), 0);
  return (1 + (acct.orb + ey(70)) / 100) * (1 + sum(grades) * ey(18) / 100) * (1 + sum(ops.map(o => o.upgrades)) * ey(50) / 100) * (1 + ops.filter(o => o.purified).length * ey(51) / 100)
    * (1 + acct.hundreds * ey(52) / 100) * (1 + acct.logSum * ey(53) / 100);
}
// The rest of the base rate, from the newest collect that measures it: what each node lost over the time collected, by what its outposts should pull
// and what the save's own bonuses give. The middle of the nodes that agree. Also each node's measured rate, newest first, with the layout it was measured on.
function armoryBase(collects, acct) {
  const measured = {};
  let fit = null;
  for (const c of [...(collects || [])].reverse()) {
    const [lv, bankA, colA, gradeA] = c.before.g, [, bankB, colB, gradeB] = c.after.g;
    const hours = ((+bankA[0] || 0) + (c.after.savedAt - c.before.savedAt) / 1000 - (+bankB[0] || 0)) / 3600;
    if (!(hours > 0.02)) continue;
    const opsA = armoryOutposts(lv, c.before.maps), opsB = armoryOutposts(c.after.g[0], c.after.maps), savage = armorySavage(lv), same = new Map(opsB.map(o => [o.map, o.layout]));
    const known = armoryKnown(lv, gradeA, opsA, acct), est = [];
    ARMORY_NODES.forEach((n, i) => {
      const a = +colA[i], b = +colB[i], grade = +gradeA[i] || 0;
      if (n[3] < 0 || !(a >= 0) || !(b > a) || grade !== (+gradeB[i] || 0)) return; // emptied, refilled or untouched: says nothing about the rate
      const on = opsA.filter(o => o.links.includes(i));
      if (!on.length || on.some(o => same.get(o.map) !== o.layout) || opsB.filter(o => o.links.includes(i)).length !== on.length) return; // moved while collecting
      const pull = on.reduce((s, o) => s + armoryPull(o, grade, savage), 0), rate = (b - a) / hours;
      if (!measured[i]) measured[i] = { rate, at: c.after.savedAt, grade, layout: on.map(o => o.layout).join('|') };
      if (pull > 0) est.push(rate / pull / known);
    });
    if (!est.length || fit) continue;
    est.sort((x, y) => x - y);
    fit = { rest: est[Math.floor(est.length / 2)], nodes: est.length, at: c.after.savedAt };
  }
  return fit ? { ...fit, measured } : null;
}
const armoryRgLevel = () => Math.max(0, ...rows.filter(r => r.classIndex === ROYAL_GUARDIAN).map(r => +r.classLvl || 0));
// Everything the tab shows, from the save, the collects kept by the app, and the time now.
function armoryView(save, collects, now) {
  const d = save && save.data;
  if (!d || !d.RoyalG) return null;
  const G = armoryList(d.RoyalG), maps = armoryList(d.RoyalMaps), levels = G[2] || [], savedAt = save.savedAt || now;
  let away = d.TimeAway; try { away = typeof away === 'string' ? JSON.parse(away) : away; } catch { away = null; }
  const restock = away && Number.isFinite(+away.ShopRestock) ? +away.ShopRestock : null;
  let resetAt = restock != null ? savedAt + restock * 1000 : null, passed = false;
  while (resetAt != null && resetAt <= now) { resetAt += 864e5; passed = true; }
  const banked = Math.max(0, (+(G[3] || [])[0] || 0) / 3600 + (now - savedAt) / 36e5), toReset = resetAt == null ? null : (resetAt - now) / 36e5, avail = toReset == null ? null : banked + toReset;
  const ops = armoryOutposts(levels, maps), acct = armoryAccount(G, armoryRgLevel()), fit = armoryBase(collects, acct), savage = armorySavage(levels);
  const base = fit ? fit.rest * armoryKnown(levels, G[5] || [], ops, acct) : null; // calculated from the save now: an edit or a reset shows at once
  if (fit) fit.base = base;
  const savageAllowed = Math.round((+levels[44] || 0) * ARMORY_BPL[44]), name = m => (GAME.maps[m] || 'Map ' + m);
  const nodes = [];
  ARMORY_NODES.forEach((n, i) => {
    if (n[3] < 0) return;
    const world = armoryWorldOf(i), grade = +(G[5] || [])[i] || 0, col = +(G[4] || [])[i] || 0, max = armoryNodeSize(i, grade), left = col < 0 ? 0 : Math.max(0, max - col);
    const on = ops.filter(o => o.links.includes(i)), pull = on.reduce((s, o) => s + armoryPull(o, grade, savage), 0), drain = base != null ? base * pull : null;
    const r = { i, world, x: n[0], y: n[1], name: ARMORY_NAMES[n[3]] || 'Resource ' + n[3], grade, max, left, drain, by: on.map(o => ({ map: o.map, name: name(o.map), mode: o.mode })) };
    const m = fit && fit.measured[i];
    if (m && m.grade === grade && m.layout === on.map(o => o.layout).join('|')) Object.assign(r, { measured: m.rate, measuredAt: m.at }); // only while the node's outposts are as they were measured
    if (col < 0) return nodes.push({ ...r, status: 'empty' });
    if (!on.length || !(pull > 0)) return nodes.push({ ...r, status: 'idle' });
    if (drain == null || avail == null) return nodes.push({ ...r, status: 'unknown' });
    const need = left / drain;
    Object.assign(r, { need, at: now + Math.max(0, need - banked) * 36e5 });
    if (need <= avail) return nodes.push({ ...r, status: 'today' });
    r.missed = 1 + Math.floor((need - avail) / 24);
    r.short = left / avail / drain - 1;
    const used = ops.filter(o => o.world === world && o.mode === 2).length;
    if (savageAllowed > 0) {
      const best = on.filter(o => o.mode === 0).map(o => ({ o, need: left / (base * (pull - armoryPull(o, grade, savage) + armoryPull(o, grade, savage, true))) })).sort((a, b) => a.need - b.need)[0];
      if (best) r.savage = { name: name(best.o.map), today: best.need <= avail, need: best.need, swap: used >= savageAllowed };
    }
    nodes.push({ ...r, status: 'late' });
  });
  return { now, savedAt, banked, toReset, resetAt, passed, avail, fit, nodes, outposts: ops.map(o => ({ ...o, name: name(o.map), at: ARMORY_OUTPOST_AT[o.map] || null })) };
}

const ARMORY_STATUS = { late: { label: 'Won’t finish', order: 0, pill: 'won’t finish' }, today: { label: 'Today', order: 1, pill: 'today' }, unknown: { label: 'No rate yet', order: 2, pill: 'no rate yet' }, idle: { label: 'No outpost', order: 3, pill: 'no outpost' }, empty: { label: 'Empty ✓', order: 4, pill: 'already empty' } };
let armoryUi = null, armoryCollects = [], armoryMaps = [], armoryWorld = null, armoryOnly = null, armoryPainted = 0;
const ARMORY_SVG = 'http://www.w3.org/2000/svg', armorySv = (tag, attrs) => { const e = document.createElementNS(ARMORY_SVG, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
function armoryEta(n, v) {
  if (n.status === 'empty') return ['✓', 'refills at the reset, +1 grade'];
  if (n.status === 'idle') return ['—', 'no outpost connected'];
  if (n.status === 'unknown') return ['?', 'rate comes with your next collect'];
  // Always how long, never a clock time, so the map reads one way; the clock time is in the line under it and the hover text.
  if (n.status === 'today') return n.at <= v.now + 6e4 ? ['now', 'collect now to empty it'] : [fmtWait((n.at - v.now) / 36e5), 'empty ' + fmtClock(n.at, v.now) + ' · collect after then'];
  return [fmtWait((n.at - v.now) / 36e5), 'empty ' + fmtClock(n.at, v.now) + ' · misses ' + n.missed + ' reset' + (n.missed > 1 ? 's' : '')];
}
function armoryBuild() {
  const box = $('viewArmory');
  armoryUi = { head: el('div', 'arm-head'), counts: el('div', 'arm-counts'), worlds: el('div', 'arm-worlds'), card: el('div', 'arm-card'), rows: el('div', 'arm-rows') };
  armoryUi.map = armorySv('svg', { class: 'arm-map', role: 'img', 'aria-label': 'Kingdom map' });
  const legend = el('div', 'arm-legend');
  legend.innerHTML = '<span><i class="arm-l"></i>outpost draining</span><span><i class="arm-l sv"></i>Savage Stronghold</span><span><i class="arm-l sup"></i>Support Camp boosting</span><span><i class="arm-lw"></i>outpost doing nothing, or on an empty resource</span><span>Ring and row: how much is drained</span><span>Units: <b class="arm-u u0">worker</b> <b class="arm-u u1">trader</b> <b class="arm-u u2">guard</b> <b class="arm-u u3">surveyor</b></span>';
  armoryUi.worlds.setAttribute('role', 'tablist');
  armoryUi.card.append(armoryUi.map, legend);
  box.replaceChildren(armoryUi.head, armoryUi.counts, armoryUi.worlds, armoryUi.card, armoryUi.rows);
}
async function armoryLoad() {
  if (!LOCAL_APP) return;
  try { const r = await api('/api/armory'); armoryCollects = r.collects || []; armoryMaps = r.maps || []; } catch { /* the planner tab already says when the app has stopped */ }
}
async function showArmory() {
  if (!armoryUi) armoryBuild();
  paintArmory(Date.now());
  await Promise.all([refreshFinder(), armoryLoad()]);
  paintArmory(Date.now());
}
// Each second from the clock: the countdowns move, so the open tab repaints every 30 seconds.
let armorySeen = null;
function tickArmory(now) {
  if (!armoryUi || $('viewArmory').hidden) return;
  const at = saveForFinder && saveForFinder.savedAt;
  if (at && at !== armorySeen) { armorySeen = at; armoryLoad().then(() => paintArmory(Date.now())); } // a new save: a collect may have come with it
  if (now - armoryPainted >= 3e4) paintArmory(now);
}
function paintArmory(now) {
  if (!armoryUi) return;
  armoryPainted = now;
  const v = armoryView(saveForFinder, armoryCollects, now), u = armoryUi;
  u.head.replaceChildren(); u.counts.replaceChildren(); u.worlds.replaceChildren(); u.rows.replaceChildren(); u.map.replaceChildren();
  if (!v) { u.head.append(el('p', 'arm-none', LOCAL_APP ? 'No Royal Armory in this save yet.' : 'The Armory needs the app’s synced save.')); u.card.hidden = true; return; }
  u.card.hidden = false;
  const title = el('div', 'arm-title'); title.append(el('h2', '', 'Royal Armory'), el('p', '', 'Is every node empty before the reset? And if not, how long does it really take?'));
  const tile = (big, small, cls) => { const t = el('div', 'arm-tile' + (cls ? ' ' + cls : '')); t.append(el('b', '', big), el('span', '', small)); return t; };
  const clock = el('div', 'arm-clock');
  clock.append(v.resetAt == null ? tile('Reset time unknown', 'needs a fresh save') : tile('Reset in ' + fmtWait(v.toReset), 'at ' + fmtClock(v.resetAt, now) + (v.passed ? ' · one passed since your last save' : ''), v.passed ? 'warn' : ''),
    tile(v.banked < 1 / 60 ? '0m' : fmtWait(v.banked), 'banked, waiting to collect'),
    v.avail == null ? tile('–', 'of drain left before reset') : tile(fmtWait(v.avail), 'of drain left before reset'),
    v.fit ? tile(fmtNum(v.fit.base), 'base rate / hr, from the save · bonuses outside it measured ' + fmtClock(v.fit.at, now)) : tile('Measuring', 'collect once to set the rates', 'warn'));
  u.head.append(title, clock);
  ['late', 'today', 'unknown', 'empty', 'idle'].forEach(s => {
    const n = v.nodes.filter(x => x.status === s).length;
    if (!n && s === 'unknown') return;
    const b = el('button', 'arm-pill s-' + s); b.type = 'button';
    b.append(el('i'), document.createTextNode(n + ' ' + ARMORY_STATUS[s].pill));
    b.setAttribute('aria-pressed', String(armoryOnly === s));
    b.onclick = () => { armoryOnly = armoryOnly === s ? null : s; paintArmory(Date.now()); };
    u.counts.append(b);
  });
  const worlds = [...new Set(v.nodes.map(n => n.world))].filter(w => v.outposts.some(o => o.world === w) || v.nodes.some(n => n.world === w && n.status !== 'idle'));
  if (!worlds.includes(armoryWorld)) armoryWorld = worlds.find(w => v.nodes.some(n => n.world === w && n.status === 'late')) || worlds[0];
  worlds.forEach(w => {
    const late = v.nodes.filter(n => n.world === w && n.status === 'late').length, b = el('button', 'arm-wtab'); b.type = 'button';
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(w === armoryWorld));
    b.append(el('span', '', 'World ' + w), late ? el('span', 'bad', late + ' won’t finish') : el('span', 'ok', 'all on track'));
    b.onclick = () => { armoryWorld = w; paintArmory(Date.now()); };
    u.worlds.append(b);
  });
  armoryPaintMap(v);
  armoryPaintRows(v);
}
function armoryHighlight(i) { $('viewArmory').querySelectorAll('[data-node]').forEach(e => e.classList.toggle('hl', +e.dataset.node === i)); }
// Why an outpost is wasted, or '' when it isn't: connected to nothing, or draining a resource that's already empty.
function armoryOpIssue(o, nodes) {
  if (o.mode === 1) return o.supports.length ? '' : 'Not supporting any outpost';
  if (!o.links.length) return 'Not connected to any resource';
  const empty = o.links.map(i => nodes.find(n => n.i === i)).filter(n => n && n.status === 'empty');
  return empty.length ? 'Connected to ' + empty.map(n => n.name).join(' and ') + ', already empty: move it to one that isn’t' : '';
}
// An outpost marker's width: room for its unit counts.
function armoryOpWidth(o) {
  const shown = (o.counts || []).filter(n => n > 0);
  return shown.length ? 8 + shown.reduce((s, n, k) => s + String(n).length + (k ? 1 : 0), 0) * 6.2 : 12;
}
// A curved arrow from one marker to another, starting and stopping at their edges. A box is { x, y, r } (a circle) or { x, y, hw, hh } (a rectangle).
function armoryArrow(svg, kind, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 24) return;
  const bend = Math.min(0.22 * len, 46), cx = (a.x + b.x) / 2 - dy / len * bend, cy = (a.y + b.y) / 2 + dx / len * bend; // to the right of travel, on screen
  const at = t => [(1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x, (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y];
  const inside = (p, box) => box.r != null ? Math.hypot(p[0] - box.x, p[1] - box.y) < box.r : Math.abs(p[0] - box.x) < box.hw && Math.abs(p[1] - box.y) < box.hh;
  let t0 = 0, t1 = 1;
  while (t0 < 0.45 && inside(at(t0), a)) t0 += 0.004;
  while (t1 > 0.55 && inside(at(t1), b)) t1 -= 0.004;
  const head = kind === 'sv' ? 13 : 11, tip = at(t1), back = at(t1 - 0.02), ux = (tip[0] - back[0]) / (Math.hypot(tip[0] - back[0], tip[1] - back[1]) || 1), uy = (tip[1] - back[1]) / (Math.hypot(tip[0] - back[0], tip[1] - back[1]) || 1);
  const pts = [];
  for (let k = 0; k <= 24; k++) { const p = at(t0 + (t1 - t0) * k / 24); pts.push(p); }
  const end = [tip[0] - ux * head * 0.8, tip[1] - uy * head * 0.8]; // the line stops inside the head, so its end doesn't show past the point
  pts[pts.length - 1] = end;
  const cls = kind ? ' ' + kind : '';
  svg.append(armorySv('path', { class: 'arm-link' + cls, d: 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L') }));
  const side = head * 0.55, base = [tip[0] - ux * head, tip[1] - uy * head];
  svg.append(armorySv('polygon', { class: 'arm-head' + cls, points: [tip, [base[0] - uy * side, base[1] + ux * side], [base[0] + uy * side, base[1] - ux * side]].map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') }));
}
function armoryPaintMap(v) {
  const svg = armoryUi.map, w = armoryWorld, ns = v.nodes.filter(n => n.world === w), ops = v.outposts.filter(o => o.world === w && o.at), byMap = new Map(v.outposts.map(o => [o.map, o]));
  const X = x => 20 + x, Y = y => 26 + y, fit = ARMORY_MAP_FIT[w], file = armoryMaps[w - 1];
  const xs = [...ns.map(n => X(n.x + 28)), ...ops.map(o => X(o.at[0]))], ys = [...ns.map(n => Y(n.y + 26)), ...ops.map(o => Y(o.at[1]))];
  if (!xs.length) return;
  const x0 = Math.min(...xs) - 40, y0 = Math.min(...ys) - 30, x1 = Math.max(...xs) + 40, y1 = Math.max(...ys) + 44;
  svg.setAttribute('viewBox', [x0, y0, x1 - x0, y1 - y0].join(' '));
  if (fit && file) { // your screenshot of this world, lined up with the game's coordinates
    const [W, H, ox, oy, sx, sy] = fit, at = { x: X(-ox / sx), y: Y(-oy / sy), width: W / sx, height: H / sy };
    svg.append(armorySv('image', { href: 'maps/w' + w + '.' + file, ...at, preserveAspectRatio: 'none' }), armorySv('rect', { ...at, class: 'arm-shade' }));
  }
  // Links are arrows from the outpost to what it works on. Each bends to its right, so two pointing at each other take different paths.
  const opBox = o => ({ x: X(o.at[0]), y: Y(o.at[1]), hw: armoryOpWidth(o) / 2 + 3, hh: 10 }), nodeBox = n => ({ x: X(n.x + 28), y: Y(n.y + 26), r: 20 });
  ops.forEach(o => {
    o.links.forEach(i => { const n = ns.find(x => x.i === i); if (n) armoryArrow(svg, o.mode === 2 ? 'sv' : '', opBox(o), nodeBox(n)); });
    o.supports.forEach(t => { const to = byMap.get(t); if (to && to.at) armoryArrow(svg, 'sup', opBox(o), opBox(to)); });
  });
  ops.forEach(o => {
    // the outpost: a marker with its units inside, each count in its type's colour
    const shown = (o.counts || []).map((n, type) => ({ n, type })).filter(u => u.n > 0), w = armoryOpWidth(o), issue = armoryOpIssue(o, v.nodes);
    if (issue) svg.append(armorySv('rect', { class: 'arm-op-warn', x: X(o.at[0]) - w / 2 - 4, y: Y(o.at[1]) - 11, width: w + 8, height: 22, rx: 7 })); // a red ring: doing nothing, or working on something empty
    svg.append(armorySv('rect', { class: 'arm-op' + (o.mode === 2 ? ' sv' : o.mode === 1 ? ' sup' : ''), x: X(o.at[0]) - w / 2, y: Y(o.at[1]) - 7, width: w, height: 14, rx: 4 }));
    if (shown.length) {
      const line = armorySv('text', { class: 'arm-units', x: X(o.at[0]), y: Y(o.at[1]) + 3.8 }), names = ['worker', 'trader', 'guard', 'surveyor'];
      shown.forEach((u, k) => { const s = armorySv('tspan', { class: 'u' + u.type }); s.textContent = (k ? ' ' : '') + u.n; line.append(s); });
      const free = (o.passive || []).map((n, type) => n > 0 ? n + ' ' + names[type] + (n > 1 ? 's' : '') : '').filter(Boolean);
      const tipU = armorySv('title', {}); tipU.textContent = o.name + ': ' + shown.map(u => u.n + ' ' + names[u.type] + (u.n > 1 ? 's' : '')).join(', ') + (free.length ? '\nAlso free from Command rank ' + o.command + ': ' + free.join(', ') : ''); line.append(tipU);
      svg.append(line);
    }
    const t = armorySv('text', { class: 'arm-opname' + (issue ? ' warn' : ''), x: X(o.at[0]), y: Y(o.at[1]) + (issue ? 21 : 17) }); t.textContent = o.name.length > 16 ? o.name.slice(0, 15) + '…' : o.name;
    const tip = armorySv('title', {}); tip.textContent = o.name + (o.mode === 2 ? ' (Savage Stronghold)' : o.mode === 1 ? ' (Support Camp)' : '') + (issue ? '\n' + issue : ''); t.append(tip); svg.append(t);
  });
  ns.forEach(n => {
    const g = armorySv('g', { class: 'arm-node s-' + n.status + (armoryOnly && n.status !== armoryOnly ? ' dim' : ''), 'data-node': n.i }), cx = X(n.x + 28), cy = Y(n.y + 26), r = 17, C = 2 * Math.PI * (r - 2.5);
    g.append(armorySv('circle', { class: 'bg', cx, cy, r }));
    const frac = n.status === 'empty' ? 1 : n.max > 0 ? Math.min(1, Math.max(0, 1 - n.left / n.max)) : 0; // how much is drained, as the rows fill
    if (frac > 0) g.append(armorySv('circle', { class: 'ring', cx, cy, r: r - 2.5, 'stroke-dasharray': C * frac + ' ' + C, transform: 'rotate(-90 ' + cx + ' ' + cy + ')' }));
    const lbl = armorySv('text', { x: cx, y: cy + 4.5 }); lbl.textContent = n.name.slice(0, 2); g.append(lbl);
    const [big, small] = armoryEta(n, v), eta = armorySv('text', { class: 'eta', x: cx, y: cy + r + 15 }); eta.textContent = big; g.append(eta);
    const tip = armorySv('title', {}); tip.textContent = n.name + ' · grade ' + n.grade + ' · ' + big + ', ' + small; g.append(tip);
    g.addEventListener('click', () => { const row = armoryUi.rows.querySelector('[data-node="' + n.i + '"]'); if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); armoryHighlight(n.i); } });
    svg.append(g);
  });
}
function armoryPaintRows(v) {
  const ns = v.nodes.filter(n => n.world === armoryWorld && (!armoryOnly || n.status === armoryOnly)).sort((a, b) => ARMORY_STATUS[a.status].order - ARMORY_STATUS[b.status].order || (b.at || 0) - (a.at || 0));
  ns.forEach(n => {
    const row = el('div', 'arm-row s-' + n.status); row.dataset.node = n.i;
    row.addEventListener('mouseenter', () => armoryHighlight(n.i)); row.addEventListener('mouseleave', () => armoryHighlight(-1));
    const nm = el('div', 'arm-nm'); nm.append(el('b', '', n.name), el('div', '', 'Grade ' + n.grade + ' · node ' + n.i));
    // Progress is the row's background, as on the task cards: filled by how much is drained.
    const done = n.status === 'empty' ? 1 : n.max > 0 ? Math.min(1, Math.max(0, 1 - n.left / n.max)) : 0, fill = el('span', 'arm-fill'); fill.style.width = (100 * done) + '%';
    const left = el('div', 'arm-left'); left.append(el('b', '', n.status === 'empty' ? 'Drained' : fmtNum(n.left) + ' left'), el('div', '', n.status === 'empty' ? 'all ' + fmtNum(n.max) : 'of ' + fmtNum(n.max) + ' · ' + Math.floor(100 * done) + '% drained'));
    const by = el('div', 'arm-by');
    if (n.by.length) {
      by.append(el('div', 'src', n.drain != null ? fmtNum(n.drain) + ' / hr' : 'rate after your next collect'));
      if (n.measured != null) { const m = el('div', 'arm-meas', 'measured ' + fmtNum(n.measured) + ' / hr · ' + fmtClock(n.measuredAt, v.now)); m.title = 'What it drained over your last collect, with its outposts as they are now'; by.append(m); }
      const who = el('div'); n.by.forEach((o, k) => { if (k) who.append(', '); who.append(el('span', o.mode === 2 ? 'sv' : '', o.name + (o.mode === 2 ? ' (Savage)' : ''))); }); by.append(who);
    } else by.append(el('div', '', 'no outpost connected'));
    const [big, small] = armoryEta(n, v), eta = el('div', 'arm-eta'); eta.append(el('b', '', big), el('div', '', small));
    row.append(fill, el('span', 'arm-chip', ARMORY_STATUS[n.status].label), nm, left, by, eta);
    if (n.status === 'late') {
      const fix = el('div', 'arm-fix'), a = el('span');
      a.append('Needs ', el('b', '', '+' + fmtNum(Math.ceil(n.short * 100)) + '%'), ' more drain to finish before this reset (' + fmtNum(n.drain * (1 + n.short)) + ' / hr)'); fix.append(a);
      if (n.savage) { const s = el('span'); s.append((n.savage.swap ? 'Moving this world’s Savage Stronghold to ' : 'A Savage Stronghold at ') + n.savage.name + ': ', el('b', '', n.savage.today ? 'finishes it today' : 'cuts it to ' + fmtWait(Math.max(0, n.savage.need - v.banked)))); fix.append(s); }
      row.append(fix);
    }
    armoryUi.rows.append(row);
  });
}
