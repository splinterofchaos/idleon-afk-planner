/* ---------- projects: a graph of tasks, saved with the sheet. An edge { from, to } means "to" waits on "from" ---------- */
let projects = [], projectFocus = null; // projectFocus: { projectId, taskId }, what a card click asked the Projects tab to show
const FORGE_NOTE = 'does not consider extra bar chance', FORGE_RESTART = 'Forge needs an app restart', FORGE_IDLE = 'Nothing is forging this bar';
const projectCalcing = new Set();
const freshProjectPart = head => head + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const projectById = id => projects.find(p => p.id === id) || null;
const projectNode = (p, id) => p.nodes.find(n => n.id === id) || null;
const projectsOfTask = id => projects.filter(p => p.nodes.some(n => n.taskId === id));

/* what the account owns */
// Forge, refinery, anvils and flurbos, as { rawName: { place: amount } }. Kept per save by saveFacts.
function readStash(d) {
  const out = {}, add = (raw, place, n) => { if (raw && raw !== 'Blank' && +n > 0) { const box = out[raw] = out[raw] || {}; box[place] = (box[place] || 0) + +n; } };
  if (!d) return out;
  const order = kpkParse(d.ForgeItemOrder), qty = kpkParse(d.ForgeItemQty), refinery = kpkParse(d.Refinery), opt = kpkParse(d.OptLacc);
  if (Array.isArray(order) && Array.isArray(qty)) order.forEach((raw, i) => add(raw, 'forge', qty[i]));
  if (Array.isArray(refinery) && Array.isArray(refinery[1])) refinery[1].forEach((raw, i) => add(raw, 'refinery', (refinery[2] || [])[i]));
  // AnvilPA_i[j][0] is taken to be finished products waiting at that character's anvil, anvilProducts[j]. Inferred from Toolbox's name for it (currentAmount), not checked in the game.
  Object.keys(d).filter(k => /^AnvilPA_\d+$/.test(k)).forEach(k => {
    const list = kpkParse(d[k]);
    if (Array.isArray(list)) list.forEach((entry, j) => add(ANVIL_PRODUCTS[j], 'anvil', entry && entry[0]));
  });
  if (Array.isArray(opt)) add('DungCredits2', 'flurbos', opt[73]);
  return out;
}
// Where a total comes from: { bags, storage, equipped, forge, refinery, anvil, flurbos }. Null without a save. Equipped is always told, and only ownedCount chooses whether it counts.
function ownedParts(rawNames) {
  const { held, stash } = saveFacts();
  if (!held) return null;
  const sum = (box, key) => rawNames.reduce((n, raw) => n + ((box[raw] && (key ? box[raw][key] : box[raw])) || 0), 0);
  const parts = { bags: 0, storage: sum(held.storage), equipped: 0, forge: sum(stash, 'forge'), refinery: sum(stash, 'refinery'), anvil: sum(stash, 'anvil'), flurbos: sum(stash, 'flurbos') };
  held.units.forEach(u => { parts.bags += sum(u.bags); parts.equipped += sum(u.worn) + sum(u.tools) + sum(u.food); });
  return parts;
}
// opts: equipped (count gear being worn too), slot (only this character's bags). Null without a save.
function ownedCount(rawNames, { equipped = false, slot = null } = {}) {
  const held = saveFacts().held;
  if (!held) return null;
  if (slot != null) { const unit = held.units.find(u => u.slot === slot); return unit ? rawNames.reduce((n, raw) => n + (unit.bags[raw] || 0), 0) : 0; }
  const parts = ownedParts(rawNames);
  return parts.bags + parts.storage + parts.forge + parts.refinery + parts.anvil + parts.flurbos + (equipped ? parts.equipped : 0);
}

/* the forge. Toolbox's parsers/world-1/forge.ts, without any extra bars */
function readForge(d, cards, unlocks) {
  const order = kpkParse(d && d.ForgeItemOrder), qty = kpkParse(d && d.ForgeItemQty), lv = kpkParse(d && d.ForgeLV);
  if (!Array.isArray(order) || !Array.isArray(qty) || !Array.isArray(lv)) return null;
  const prog = kpkParse(d.ForgeIntProg) || [], gems = kpkParse(d.GemItemsPurchased) || [], men = kpkParse(d.Menagerie) || [];
  const copies = (cards && cards.Godshard) || 0, rank = copies > 0 ? cardRank('Godshard', copies, unlocks) : null, boost = +(men[3] || [])[11] || 0;
  const speed = Math.round((100 + 5 * (+lv[2] || 0) + 30 * (rank ? rank.rank : 0)) * (1 + boost / 100)), brimstone = +gems[104] || 0, slots = [];
  let empty = 0;
  for (let i = 0; i < 16 && (!(lv[0] > 0) || i < lv[0]); i++) {
    const f = FORGE_BARS[order[3 * i] + 'Bar'];
    if (!f) { empty++; continue; }
    const barrel = +qty[3 * i + 1] > 0 ? FORGE_BARRELS[order[3 * i + 1]] : null;
    const rate = 3600 * speed / 100 * (barrel ? 1 + barrel / 100 : 1) * (i < brimstone ? 1.5 : 1) / f.seconds, ore = +qty[3 * i] || 0;
    const cycles = Math.floor(ore / f.orePerBar), part = cycles > 0 ? Math.min(Math.max((+prog[i] || 0) / f.seconds, 0), 1) : 0; // a slot short of one cycle's ore has stopped
    slots.push({ index: i, bar: f.bar, ore: f.ore, oreQty: ore, brimstone: i < brimstone, rate, orePerHour: rate * f.orePerBar, cycles, part, hoursLeft: cycles > 0 ? Math.max(cycles - part, 0) / rate : 0 });
  }
  return { speed, slots, empty };
}
/* the 3D printer. Toolbox's parsers/world-3/printer.ts: after 5 zeros, 14 values per character, and the last 4 are the two samples being printed. The saved number is the "/hr" the game shows */
function readPrinter(d) {
  const list = kpkParse(d && d.Print);
  if (!Array.isArray(list)) return null;
  const rows = list.slice(5), out = {};
  for (let c = 0; c * 14 < rows.length; c++) [10, 12].forEach(j => {
    const raw = rows[c * 14 + j], rate = +rows[c * 14 + j + 1];
    if (raw && raw !== 'Blank' && rate > 0) (out[raw] = out[raw] || []).push({ slot: c, rate });
  });
  return out;
}
const printersOf = raw => (saveFacts().printer || {})[raw] || [];
const printedRate = raw => printersOf(raw).reduce((n, p) => n + p.rate, 0);
// Everything about one bar: rate and ore are the slots still running that ore. Slots refill from storage by themselves, so while it holds any they all keep going, until the ore in both is used up. Ore printed at least as fast as these slots burn it never runs out (unlimited). A slot that has stopped stays stopped until it's refilled, so printing doesn't restart it. Null when it isn't a bar. known is false before the app reads the forge.
function forgeInfo(bar) {
  const f = FORGE_BARS[bar];
  if (!f) return null;
  const { forge, stash, held } = saveFacts(), oreStored = (held && held.storage[f.ore]) || 0, refills = oreStored >= f.orePerBar;
  const slots = forge ? forge.slots.filter(s => s.bar === bar && (s.cycles > 0 || refills)) : [], sum = key => slots.reduce((n, s) => n + s[key], 0);
  const cycles = refills ? Math.floor((sum('oreQty') + oreStored) / f.orePerBar) : sum('cycles'), rate = sum('rate'), printed = printedRate(f.ore), unlimited = rate > 0 && printed >= sum('orePerHour');
  return { ...f, known: !!forge, speed: forge ? forge.speed : null, slots, running: slots.length > 0, rate, orePerHour: sum('orePerHour'), cycles, oreStored, refills, printed, unlimited, oreInForge: ((stash[f.ore] || {}).forge) || 0, barsInForge: ((stash[bar] || {}).forge) || 0, hoursLeft: unlimited ? Infinity : refills && rate > 0 ? Math.max(cycles - sum('part'), 0) / rate : Math.max(0, ...slots.map(s => s.hoursLeft)) };
}
// One row per bar in the forge, for the Forge tab. A warning is something to act on soon: slots already stopped, or ore that isn't being printed and runs out within FORGE_ALERT_HOURS.
const FORGE_ALERT_HOURS = 7 * 24, ITEM_CAP = 1.05e9;
function forgeOverview(now = Date.now()) {
  const { forge, at } = saveFacts();
  if (!forge) return { known: false, bars: [], warnings: [], empty: 0 };
  const names = [...new Set(forge.slots.map(s => s.bar))], since = Math.max(now - (at || now), 0) / 36e5;
  const bars = names.map(bar => {
    const info = forgeInfo(bar), all = forge.slots.filter(s => s.bar === bar), stopped = all.length - info.slots.length;
    const hoursLeft = info.unlimited || !info.running ? null : Math.max(info.hoursLeft - since, 0);
    const warn = stopped > 0 ? stopped + (stopped === 1 ? ' slot is' : ' slots are') + ' out of ' + itemName(info.ore) + '. Refill by hand.' : hoursLeft != null && hoursLeft < FORGE_ALERT_HOURS ? itemName(info.ore) + (info.printed > 0 ? ' is printing slower than the forge burns it' : ' isn\'t being printed') + ' and runs out in ' + fmtWait(hoursLeft) + '. The forge then needs refilling by hand.' : '';
    return { bar, ore: info.ore, slotCount: all.length, stopped, rate: info.rate, orePerHour: info.orePerHour, printed: info.printed, printers: printersOf(info.ore), unlimited: info.unlimited, stored: info.oreStored, full: info.oreStored >= ITEM_CAP, hoursLeft, runsOutMs: hoursLeft == null ? null : now + hoursLeft * 36e5, warn };
  });
  const warnings = bars.filter(b => b.warn).map(b => b.warn);
  if (forge.empty) warnings.push(forge.empty + (forge.empty === 1 ? ' forge slot has' : ' forge slots have') + ' no ore in it.');
  return { known: true, speed: forge.speed, bars, warnings, empty: forge.empty, printerKnown: !!saveFacts().printer };
}
const forgeBarsBy = (slots, h) => slots.reduce((n, s) => n + Math.min(s.part + s.rate * h, s.cycles), 0);
const forgeBarsMade = (info, h) => info.unlimited ? info.slots.reduce((n, s) => n + s.part, 0) + info.rate * h : info.refills ? Math.min(info.slots.reduce((n, s) => n + s.part, 0) + info.rate * h, info.cycles) : forgeBarsBy(info.slots, h);
// Hours from the save until these slots have made that many bars, each stopping when its ore runs out. Null if their ore can't get there.
function forgeHoursFor(slots, bars, info) {
  if (bars <= 0) return 0;
  if (info && info.unlimited) return Math.max((bars - slots.reduce((n, s) => n + s.part, 0)) / info.rate, 0);
  if (info && info.refills) return bars > info.cycles ? null : Math.max((bars - slots.reduce((n, s) => n + s.part, 0)) / info.rate, 0);
  if (bars > slots.reduce((n, s) => n + s.cycles, 0)) return null;
  let h = 0, made = slots.reduce((n, s) => n + s.part, 0), rate = slots.reduce((n, s) => n + s.rate, 0);
  for (const s of [...slots].sort((a, b) => a.hoursLeft - b.hoursLeft)) {
    const reach = made + rate * (s.hoursLeft - h);
    if (reach >= bars) return Math.max(h + (bars - made) / rate, 0);
    made = reach;
    rate -= s.rate;
    h = s.hoursLeft;
  }
  return h;
}
/* measured forge rates */
// The forge on its own is slow, but an archer's kills can push it on, AFK gains included, until that cycle's ore in the forge is used up. So how fast bars really come depends on how often an archer is played, and on candies. Bars per hour are measured from the saves instead: each of the last 12 hours on its own, then a day at a time, and the older a stretch is the less it counts.
const FORGE_RECENT_HOURS = 12, FORGE_DAYS = 7, FORGE_HALF_LIFE_HOURS = 24, FORGE_MEASURED_MIN_HOURS = 1;
const FORGE_MEASURED_NOTE = 'measured from your saves, recent hours counting most';
let forgeHist = {}, forgeHistFor = null, forgeHistBusy = false;
// [{ from, to, label, bars, hours, rate, weight }], newest first. points are [{ t, n }] oldest first. Bars gained between two saves are shared out over the time between them; a fall is bars spent or moved, so that stretch is left out.
function forgeSegments(points, now) {
  const H = 36e5, edges = [];
  for (let i = 0; i < FORGE_RECENT_HOURS; i++) edges.push([now - (i + 1) * H, now - i * H, i === 0 ? 'Last hour' : i + '–' + (i + 1) + ' h ago']);
  for (let d = 0; d < FORGE_DAYS; d++) { const to = now - FORGE_RECENT_HOURS * H - d * 24 * H, a = FORGE_RECENT_HOURS / 24 + d; edges.push([to - 24 * H, to, a + '–' + (a + 1) + ' days ago']); }
  const out = edges.map(([from, to, label]) => ({ from, to, label, bars: 0, hours: 0, rate: null, weight: Math.pow(0.5, (now - (from + to) / 2) / H / FORGE_HALF_LIFE_HOURS) }));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], gained = b.n - a.n, span = b.t - a.t;
    if (span <= 0 || gained < 0) continue;
    out.forEach(k => { const overlap = Math.min(k.to, b.t) - Math.max(k.from, a.t); if (overlap > 0) { k.bars += gained * overlap / span; k.hours += overlap / H; } });
  }
  out.forEach(k => { if (k.hours > 0) k.rate = k.bars / k.hours; });
  return out;
}
// The weighted bars per hour, and each segment's share of it. Null until the saves cover an hour.
function forgeMeasuredRate(bar, now = Date.now()) {
  const points = forgeHist[bar];
  if (!points || points.length < 2) return null;
  const segments = forgeSegments(points, now), hours = segments.reduce((n, k) => n + k.hours, 0), w = segments.reduce((n, k) => n + k.weight * k.hours, 0);
  if (hours < FORGE_MEASURED_MIN_HOURS || !(w > 0)) return null;
  const rate = segments.reduce((n, k) => n + k.weight * k.bars, 0) / w;
  segments.forEach(k => { k.share = k.weight * k.hours / w; });
  return rate > 0 ? { rate, segments, hours } : null;
}
// Every bar in the forge or with a task, fetched again after each new save.
async function forgeHistLoad() {
  if (!LOCAL_APP || forgeHistBusy) return;
  const bars = [...new Set([...forgeOverview().bars.map(b => b.bar), ...tasks.filter(t => t.type === 'forge' && t.raw).map(t => t.raw)])].sort(), key = finderFetched + '|' + bars.join();
  if (key === forgeHistFor) return;
  forgeHistFor = key; // once per save, even if it fails: the formula stands in
  forgeHistBusy = true;
  try {
    const got = {};
    for (const bar of bars) got[bar] = forgeSeries((await api('/api/forge-history?item=' + encodeURIComponent(bar))).rows || [], false);
    forgeHist = got;
    render();
  } catch { /* the formula stands in */ } finally { forgeHistBusy = false; }
}
// Timing for "left" more bars than the save holds. The forge keeps running after the save, so it's anchored there.
function forgeEta(bar, left, now) {
  const info = forgeInfo(bar), out = { rate: info.rate, rateSource: 'forge', hours: null, left: Math.max(left, 0), done: false, needs: '', capped: false, runsOutMs: null, note: FORGE_NOTE };
  if (left <= 0) return { ...out, left: 0, done: true, hours: 0 };
  if (!info.known) return { ...out, needs: FORGE_RESTART };
  if (!info.running) return { ...out, needs: FORGE_IDLE };
  const m = forgeMeasuredRate(bar, now);
  if (m) { // the measured rate, still no more bars than the forge and storage hold ore for
    const at = saveFacts().at || now, since = Math.max(now - at, 0) / 36e5, part = info.slots.reduce((n, s) => n + s.part, 0);
    const cap = info.unlimited ? Infinity : info.refills ? info.cycles : info.slots.reduce((n, s) => n + s.cycles, 0);
    Object.assign(out, { rate: m.rate, rateSource: 'measured', note: FORGE_MEASURED_NOTE, left: Math.max(left - Math.min(part + m.rate * since, cap), 0), runsOutMs: info.unlimited ? null : at + Math.max(cap - part, 0) / m.rate * 36e5 });
    if (left > cap) return { ...out, capped: true, needs: (info.refills ? 'Forge and storage run out of ore after ' : 'Forge runs out of ore after ') + fmtNum(cap) + ' more bars' };
    out.hours = Math.max((left - part) / m.rate - since, 0);
    out.done = out.hours === 0;
    return out;
  }
  const at = saveFacts().at || now, since = Math.max(now - at, 0) / 36e5, whole = forgeHoursFor(info.slots, left, info);
  out.left = Math.max(left - forgeBarsMade(info, since), 0);
  out.runsOutMs = info.unlimited ? null : at + info.hoursLeft * 36e5;
  if (whole == null) return { ...out, capped: true, needs: (info.refills ? 'Forge and storage run out of ore after ' : 'Forge runs out of ore after ') + fmtNum(info.cycles) + ' more bars' };
  out.hours = Math.max(whole - since, 0);
  out.done = out.hours === 0;
  return out;
}
function forgeRate(t) {
  const info = forgeInfo(t.raw), m = info && info.running ? forgeMeasuredRate(t.raw) : null;
  if (m) return { rate: m.rate, rateSource: 'measured', needs: '' };
  return { rate: info ? info.rate : 0, rateSource: info && info.rate ? 'forge' : null, needs: !info || !info.known ? FORGE_RESTART : info.running ? '' : FORGE_IDLE };
}
const taskTarget = (t, ov) => { if (t.statueTo && !(ov && 'amount' in ov)) return statuesToLevel(t.statueIndex, t.statueTo); const n = ov && 'amount' in ov ? parseNum(ov.amount) : t.amountAuto && t.amountExact > 0 ? t.amountExact : parseNum(t.amount); return n > 0 ? n : null; };
const forgeTaskRunning = t => { const info = forgeInfo(t.raw); return !!info && info.running; };
// A task's numbers, for the two types that have no player.
function forgeCalc(t, now, ov) {
  const have = ownedCount([t.raw]), target = taskTarget(t, ov), { rate, rateSource, needs } = forgeRate(t);
  const out = { active: forgeTaskRunning(t), done: false, hours: null, etaMs: null, pct: 0, left: null, have, target, rate, rateSource, team: null, needs: '', line: '', clears: null, level: null, note: rateSource === 'measured' ? FORGE_MEASURED_NOTE : FORGE_NOTE, capped: false, runsOutMs: null };
  if (have == null) { out.needs = out.line = 'Waiting for game data'; return out; }
  if (target == null) {
    out.needs = needs || 'Enter amount';
    out.line = (rate > 0 ? fmtRate(rate) + ' per hour · ' : '') + fmtNum(have);
    return out;
  }
  const go = forgeEta(t.raw, target - have, now);
  Object.assign(out, { hours: go.hours, left: go.left, done: go.done, needs: go.needs, capped: go.capped, runsOutMs: go.runsOutMs });
  out.pct = Math.min(Math.max((target - go.left) / target, 0), 1);
  out.line = fmtNum(have) + ' of ' + fmtNum(target, 6);
  if (go.hours != null) out.etaMs = now + go.hours * 36e5;
  return out;
}
function craftCalc(t, now, ov) {
  const p = projectById(t.projectId), d = p && p.targets.some(x => x.raw === t.raw && projectFor(x).length) ? projectDemand(p) : null; // for players: their own requirement, never what the account holds
  const have = d ? d.have.get(t.raw) ?? null : ownedCount([t.raw], { equipped: !!(p && p.equipped) }), target = d && !(ov && 'amount' in ov) ? d.demand.get(t.raw) || 0 : taskTarget(t, ov);
  const out = { active: false, done: false, hours: null, etaMs: null, pct: 0, left: null, have, target, rate: 0, rateSource: null, team: null, needs: '', line: '', clears: null, level: null };
  if (have == null) { out.needs = out.line = 'Waiting for game data'; return out; }
  if (target == null) { out.line = fmtNum(have); return out; }
  out.left = Math.max(target - have, 0);
  out.done = out.left === 0;
  out.pct = target ? Math.min(have / target, 1) : 1;
  out.line = fmtNum(have) + ' of ' + fmtNum(target, 6);
  if (out.done) { out.hours = 0; out.etaMs = now; return out; }
  const n = p && !projectCalcing.has(p.id) ? Object.values(projectCalc(p, now).nodes).find(x => x.raw === t.raw) : null; // no time of its own: what it waits on
  if (n) { out.hours = n.hours; out.etaMs = n.etaMs; out.needs = n.needs; }
  return out;
}
// Crafts, and what a project made with no player, only show on the Projects tab unless they're starred.
// A statue level goal is a parent: its Collect task is the one listed.
const projectTaskHidden = t => !!t.statueTo || !t.starred && (t.type === 'craft' || (t.projectMade && t.type === 'item') || (t.type === 'forge' && taskCalc(t).done)); // bars already owned needn't take up the panel

/* who a target is for. Target.for: [slot]. Target.use: keys of spare copies the user has said to use */
const SPARE_CAUTION = 'It may carry upgrades only some classes benefit from. Check it in game before using it.';
const projectFor = x => Array.isArray(x.for) ? [...new Set(x.for)] : [];
// What the save's stat map says was done to one copy, as text. Empty when nothing. It holds stats only: nothing says which class did it.
function copyUpgrades(m) {
  if (!m || typeof m !== 'object') return [];
  const out = [], slots = +m.Upgrade_Slots_Left || 0, unique = k => { const v = +m['UQ' + k + 'val'], txt = m['UQ' + k + 'txt']; if (v) out.push('+' + fmtNum(v) + (txt && txt !== 0 ? String(txt).replace(/_/g, ' ').toLowerCase() : ' special')); };
  [['Weapon_Power', 'Weapon Power'], ['Defence', 'Defence'], ['STR', 'STR'], ['AGI', 'AGI'], ['WIS', 'WIS'], ['LUK', 'LUK'], ['Power', 'Power'], ['Speed', 'Speed'], ['Reach', 'Reach']].forEach(([k, text]) => { if (+m[k]) out.push('+' + fmtNum(+m[k]) + ' ' + text); });
  unique(1);
  unique(2);
  if (slots < 0) out.push(fmtNum(-slots) + (slots === -1 ? ' upgrade used' : ' upgrades used'));
  else if (slots > 0) out.push('+' + fmtNum(slots) + (slots === 1 ? ' upgrade slot' : ' upgrade slots'));
  return out;
}
// Every copy of an item in storage, bags and worn, kept per save. key: place, holder, and which copy of theirs this is, so moving it around a bag doesn't lose it.
function itemCopies(raw) {
  const f = saveFacts(), box = f.copies || (f.copies = new Map());
  if (box.has(raw)) return box.get(raw);
  const out = [], d = saveForFinder && saveForFinder.data, list = v => { const x = kpkParse(v); return x && typeof x === 'object' ? x : {}; };
  const scan = (place, slot, order, qty, stats) => {
    let n = 0;
    Object.keys(order).forEach(k => {
      if (order[k] !== raw) return;
      for (let i = Math.min(parseFloat(qty[k]) > 0 ? parseFloat(qty[k]) : 1, 50); i > 0; i--) out.push({ key: place + ':' + (slot ?? '') + ':' + n++, place, slot, upgrades: copyUpgrades(stats[k]) });
    });
  };
  if (d && f.held) {
    scan('storage', null, list(d.ChestOrder), list(d.ChestQuantity), list(d.CMm));
    f.held.units.forEach(u => {
      scan('bags', u.slot, list(d['InventoryOrder_' + u.slot]), list(d['ItemQTY_' + u.slot]), list(d['IMm_' + u.slot]));
      const worn = list(d['EquipOrder_' + u.slot])[0], qty = list(d['EquipQTY_' + u.slot])[0];
      scan('worn', u.slot, worn && typeof worn === 'object' ? worn : {}, qty && typeof qty === 'object' ? qty : {}, list(d['EMm0_' + u.slot]));
    });
  }
  box.set(raw, out);
  return out;
}
// 'worn', 'bags', '' (hasn't got it), or null when that character isn't in the save.
function slotHolds(slot, raw) {
  const held = saveFacts().held, u = held && held.units.find(x => x.slot === slot);
  return !u ? null : u.worn[raw] > 0 ? 'worn' : u.bags[raw] > 0 ? 'bags' : '';
}
// How a target's players stand. Null when it's for nobody, or there's no save. Copies elsewhere never fill a need by themselves, since an upgrade may only suit some classes: they're spares, and count once the user says so.
function projectWho(x) {
  if (x.fill) return projectFoodWho(x);
  const who = projectFor(x);
  if (!who.length || !saveFacts().held) return null;
  const list = who.map(slot => ({ slot, state: slotHolds(slot, x.raw) })), holds = new Map(list.map(w => [w.slot, w.state])), use = Array.isArray(x.use) ? x.use : [];
  const spares = itemCopies(x.raw).filter(c => {
    if (c.place === 'storage' || !holds.has(c.slot)) return true;
    return c.place === 'bags' && (holds.get(c.slot) === 'worn' || !c.key.endsWith(':0')); // their first bag copy is theirs, and a player's worn gear is never a spare
  }).map(c => ({ ...c, used: use.includes(c.key) }));
  const missing = list.filter(w => w.state === '').length, used = Math.min(spares.filter(c => c.used).length, missing);
  return { list, spares, missing, used, need: missing - used, free: spares.filter(c => !c.used && c.place !== 'worn').length };
}

// Golden food: each player carries a full stack, as many as their food carry cap holds, in food slots or bags.
// Every copy is the same, so storage, others' bags and a player's extra above their cap fill the gaps without asking. Food others are eating stays theirs.
const projectGoldenFoods = () => (Array.isArray(SC_DATA.gfoods) ? SC_DATA.gfoods : []);
const foodHeld = (u, raw) => (u.food[raw] || 0) + (u.bags[raw] || 0);
function projectFoodWho(x) {
  const who = projectFor(x), held = saveFacts().held;
  if (!who.length || !held) return null;
  const on = new Set(who), raw = x.raw;
  let pool = held.storage[raw] || 0, short = 0;
  held.units.forEach(u => { if (!on.has(u.slot)) pool += u.bags[raw] || 0; });
  const list = who.map(slot => {
    const u = held.units.find(v => v.slot === slot);
    if (!u) return { slot, state: null, cap: null, own: 0, left: 0 };
    const own = foodHeld(u, raw), cap = u.foodCap;
    if (cap == null) return { slot, state: 'nocap', cap: null, own, left: 0 };
    const left = Math.max(cap - own, 0);
    short += left;
    pool += Math.max(own - cap, 0);
    return { slot, state: left === 0 ? 'full' : own > 0 ? 'part' : '', cap, own, left };
  });
  const used = Math.min(pool, short);
  return { food: true, list, spares: [], missing: list.filter(w => w.left > 0).length, used, need: short - used, free: pool - used };
}

/* what a project's items add up to */
const projectMats = raw => PROJECT_RECIPES[raw] || (FORGE_BARS[raw] ? [{ raw: FORGE_BARS[raw].ore, qty: FORGE_BARS[raw].orePerBar }] : []);
// Every item reachable from these, each before anything it's made from.
function projectWalk(raws) {
  const seen = new Set(), post = [], visit = raw => {
    if (seen.has(raw)) return;
    seen.add(raw);
    projectMats(raw).forEach(m => visit(m.raw));
    post.push(raw);
  };
  raws.forEach(visit);
  return post.reverse();
}
// All the demand on an item is summed before what's owned comes off, and only the rest goes on down.
function projectDemand(p) {
  const order = projectWalk(p.targets.map(x => x.raw)), demand = new Map(), have = new Map(), who = new Map(), add = (raw, n) => demand.set(raw, (demand.get(raw) || 0) + n);
  p.targets.forEach(x => {
    const w = projectWho(x);
    if (w) who.set(x.raw, w);
    add(x.raw, (x.count || 0) + (w ? w.need : 0));
  });
  order.forEach(raw => {
    const w = who.get(raw), ask = demand.get(raw) || 0; // what's owned only goes against a plain count on top of the players
    const got = w ? Math.min(ask - w.need, w.free) : ownedCount([raw], { equipped: !!p.equipped }), rest = Math.max(ask - (got || 0), 0);
    have.set(raw, got);
    if (rest > 0) projectMats(raw).forEach(m => add(m.raw, rest * m.qty));
  });
  return { order, demand, have, who };
}
function projectRole(raw) {
  if (PROJECT_RECIPES[raw]) return 'craft';
  if (FORGE_BARS[raw]) return 'forge';
  const kind = PROJECT_KINDS[raw];
  return kind === 'drop' ? 'drop' : ['mining', 'choppin', 'fishing', 'catching', 'trapping', 'worship'].includes(kind) ? 'gather' : 'count';
}
const projectKind = raw => PROJECT_RECIPES[raw] ? 'craft' : FORGE_BARS[raw] ? 'forge' : PROJECT_KINDS[raw] || 'other';
// The task a node stands for. A material can use any task already collecting it. Null when there's none.
function projectNodeTask(n) {
  const own = n.taskId && tasks.find(t => t.id === n.taskId);
  if (own) return own;
  if (n.role === 'drop' || n.role === 'gather') { const name = itemName(n.raw); return tasks.find(t => t.type === 'item' && t.itemName === name) || null; }
  return null;
}
function setAutoAmount(t, need) {
  if (!blankText(t.amount) && !t.amountAuto) return; // a typed amount stands
  const text = fmtNum(need);
  if (t.amount !== text) t.amount = text;
  t.amountAuto = true;
  t.amountExact = need;
}
function forgeTask(bar, now = Date.now(), made = false) {
  const fields = { type: 'forge', slot: null, raw: bar, itemName: itemName(bar), auto: false, ...(made ? { projectMade: true } : {}) };
  return tasks.find(t => t.key === taskKey(fields)) || upsertTask(fields, now);
}
function ensureNodeTask(p, n, now) {
  const had = projectNodeTask(n);
  if (had) return had;
  if (n.role === 'forge') return forgeTask(n.raw, now, true);
  if (n.role === 'craft') { const fields = { type: 'craft', slot: null, raw: n.raw, projectId: p.id, itemName: itemName(n.raw), auto: false, projectMade: true }; return tasks.find(t => t.key === taskKey(fields)) || upsertTask(fields, now); }
  if (n.role === 'gather') return upsertTask({ type: 'item', slot: null, itemName: itemName(n.raw), source: 'direct', chance: null, match: null, monster: '', afkId: '', activityKey: null, auto: false, projectMade: true }, now);
  return null;
}
// After every save, and every change to a project: what's needed gets a task, and amounts nobody typed follow the requirement.
function syncProjects(now = Date.now()) {
  if (!projects.length || !saveFacts().held) return; // nothing is known to be needed until the save is here
  const wanted = new Map();
  projects.forEach(p => {
    const { demand, have, who } = projectDemand(p);
    p.nodes.forEach(n => {
      const need = n.raw ? demand.get(n.raw) || 0 : 0;
      if (!(need > 0)) return;
      const t = ensureNodeTask(p, n, now);
      if (!t) return;
      if (n.taskId !== t.id) n.taskId = t.id;
      const held = t.type === 'item' && who.has(n.raw) ? heldTotal(saveFacts().held, rawNamesOf(t.itemName)) - (have.get(n.raw) || 0) : 0; // an item task counts all the account holds, players' own copies too
      wanted.set(t.id, Math.max(wanted.get(t.id) || 0, need + held));
    });
  });
  tasks.forEach(t => { if (wanted.has(t.id)) setAutoAmount(t, wanted.get(t.id)); });
}

/* projects, nodes and edges. These change the data only: call queueSave() and render() after */
function projectCreate(name, now = Date.now()) {
  const p = { id: freshProjectPart('p'), name: String(name ?? '').trim() || 'New project', createdAt: now, editedAt: now, equipped: false, targets: [], nodes: [], edges: [] };
  projects.push(p);
  return p;
}
function projectRename(p, name) { p.name = String(name ?? '').trim() || p.name; p.editedAt = Date.now(); }
function projectSetEquipped(p, on) { p.equipped = !!on; p.editedAt = Date.now(); syncProjects(); }
// Tasks only this project made go with it. Anything starred stays.
function projectUnmake(p, list) {
  return list.filter(t => t && !t.starred && t.projectMade && !projects.some(o => o !== p && o.nodes.some(n => n.taskId === t.id))).map(t => deleteTask(t.id)).filter(Boolean);
}
function projectDelete(id) {
  const at = projects.findIndex(p => p.id === id);
  if (at < 0) return null;
  const project = projects[at], removedTasks = projectUnmake(project, project.nodes.map(n => tasks.find(t => t.id === n.taskId)));
  projects.splice(at, 1);
  return { project, at, tasks: removedTasks };
}
function projectRestore(removed) {
  if (!removed || projectById(removed.project.id)) return;
  projects.splice(Math.min(removed.at, projects.length), 0, removed.project);
  removed.tasks.forEach(restoreTask);
  syncProjects();
}
// Would "to waits on from" close a loop? Yes if "from" already waits on "to".
function projectWouldCycle(p, from, to) {
  if (from === to) return true;
  const seen = new Set(), stack = [to];
  while (stack.length) {
    const at = stack.pop();
    if (at === from) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    p.edges.forEach(e => { if (e.from === at) stack.push(e.to); });
  }
  return false;
}
// { ok: true, edge } or { ok: false, reason: 'cycle'|'missing'|'recipe' }. A second edge between the same two nodes changes the kind of the first.
function projectAddEdge(p, from, to, kind = 'after') {
  if (!projectNode(p, from) || !projectNode(p, to)) return { ok: false, reason: 'missing' };
  const had = p.edges.find(e => e.from === from && e.to === to);
  if (had) return had.auto ? { ok: false, reason: 'recipe' } : (had.kind = kind === 'needs' ? 'needs' : 'after', { ok: true, edge: had });
  if (projectWouldCycle(p, from, to)) return { ok: false, reason: 'cycle' };
  const edge = { from, to, kind: kind === 'needs' ? 'needs' : 'after' };
  p.edges.push(edge);
  p.editedAt = Date.now();
  return { ok: true, edge };
}
function projectSetEdgeKind(p, from, to, kind) {
  const e = p.edges.find(x => x.from === from && x.to === to);
  if (!e) return { ok: false, reason: 'missing' };
  if (e.auto) return { ok: false, reason: 'recipe' };
  e.kind = kind === 'needs' ? 'needs' : 'after';
  p.editedAt = Date.now();
  return { ok: true, edge: e };
}
function projectRemoveEdge(p, from, to) {
  const at = p.edges.findIndex(e => e.from === from && e.to === to);
  if (at < 0) return { ok: false, reason: 'missing' };
  if (p.edges[at].auto) return { ok: false, reason: 'recipe' };
  p.edges.splice(at, 1);
  p.editedAt = Date.now();
  return { ok: true };
}
const projectMatchesRaw = (t, raw) => !!t && ((t.type === 'forge' && t.raw === raw) || (t.type === 'item' && t.itemName === itemName(raw)));
// Any task as a node. A task that's already here, or is what an item here needs, gives back that node.
function projectAddTask(p, taskId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return null;
  const there = p.nodes.find(n => n.taskId === taskId) || p.nodes.find(n => n.raw && projectMatchesRaw(t, n.raw));
  if (there) { if (!there.taskId) there.taskId = taskId; return there; }
  const n = { id: freshProjectPart('n'), role: 'task', taskId, hand: true };
  p.nodes.push(n);
  p.editedAt = Date.now();
  return n;
}
function projectNewTask(p, fields, now = Date.now()) { return projectAddTask(p, upsertTask({ auto: false, ...fields }, now).id); }
// Rebuilds the nodes and edges items bring. Hand-added edges stay, unless a recipe now runs the other way.
function projectExpand(p, now = Date.now()) {
  const order = projectWalk(p.targets.map(x => x.raw)), keep = new Set(order), gone = [];
  p.nodes = p.nodes.filter(n => {
    if (!n.raw || keep.has(n.raw)) return true;
    if (n.hand) { delete n.raw; n.role = 'task'; return true; }
    gone.push(tasks.find(t => t.id === n.taskId));
    return false;
  });
  order.forEach(raw => {
    if (p.nodes.some(n => n.raw === raw)) return;
    const mine = p.nodes.find(n => !n.raw && projectMatchesRaw(tasks.find(t => t.id === n.taskId), raw));
    if (mine) Object.assign(mine, { raw, role: projectRole(raw) });
    else p.nodes.push({ id: freshProjectPart('n'), raw, role: projectRole(raw) });
  });
  const idOf = raw => p.nodes.find(n => n.raw === raw).id, ids = new Set(p.nodes.map(n => n.id)), hand = p.edges.filter(e => !e.auto && ids.has(e.from) && ids.has(e.to));
  p.edges = [];
  order.forEach(raw => projectMats(raw).forEach(m => p.edges.push({ from: idOf(m.raw), to: idOf(raw), kind: 'needs', qty: m.qty, auto: true })));
  hand.forEach(e => { if (!projectWouldCycle(p, e.from, e.to)) p.edges.push(e); });
  const left = projectUnmake(p, gone);
  p.editedAt = now;
  syncProjects(now);
  return left;
}
// Adding an item that's there already adds to its count.
function projectAddItem(p, raw, count = 1, now = Date.now()) {
  const n = parseNum(count);
  if (!(n > 0) || !raw) return false;
  const had = p.targets.find(x => x.raw === raw);
  if (had) had.count += n; else p.targets.push({ raw, count: n });
  projectExpand(p, now);
  return true;
}
function projectSetCount(p, raw, count, now = Date.now()) {
  const had = p.targets.find(x => x.raw === raw), n = parseNum(count);
  if (!had || !(n > 0 || (n === 0 && had.for))) return false; // with players, what's typed is an extra on top, and can go
  had.count = n;
  projectExpand(p, now);
  return true;
}
function projectRemoveItem(p, raw, now = Date.now()) {
  const at = p.targets.findIndex(x => x.raw === raw);
  if (at < 0) return false;
  p.targets.splice(at, 1);
  projectExpand(p, now);
  return true;
}
// A set's armor, plus whichever of its tools and weapons were picked (raw names).
// The weapon a class fights with goes by its line. It matches what each class wields in a real save.
const weaponLineOf = i => i >= 1 && i <= 6 ? /^EquipmentPunching/ : i >= 7 && i <= 18 ? /^(EquipmentSword|TestObj)/ : i >= 19 && i <= 30 ? /^EquipmentBows/ : i >= 31 && i <= 41 ? /^EquipmentWands/ : null;
function classWeapon(set, r) { const line = r && weaponLineOf(r.classIndex); return line ? set.weapons.find(x => line.test(x)) || null : null; }
// Whether this player could use this item: only a weapon has a class.
function itemFitsPlayer(raw, r) {
  if (!PROJECT_SETS.some(s => s.weapons.includes(raw))) return true;
  const line = weaponLineOf(r.classIndex);
  return !line || line.test(raw);
}
function projectAddSet(p, setName, { count = 1, tools = [], weapons = [], for: who = null, classWeapons = false } = {}, now = Date.now()) {
  const set = PROJECT_SETS.find(s => s.name === setName);
  if (!set) return false;
  const plain = raw => { const had = p.targets.find(x => x.raw === raw); if (had) had.count += count; else p.targets.push({ raw, count }); };
  // With players the armor's for them: on top of any count already there, and adding again adds to who.
  const forThem = (raw, slots) => {
    const had = p.targets.find(x => x.raw === raw);
    if (had) had.for = [...new Set([...projectFor(had), ...slots])]; else p.targets.push({ raw, count: 0, for: [...new Set(slots)] });
  };
  set.armors.forEach(raw => { if (who) forThem(raw, who); else plain(raw); });
  if (who && classWeapons) who.forEach(slot => { const raw = classWeapon(set, rows.find(r => r.slot === slot)); if (raw) forThem(raw, [slot]); });
  [...tools.filter(x => set.tools.includes(x)), ...weapons.filter(x => set.weapons.includes(x))].forEach(plain);
  projectExpand(p, now);
  return true;
}
// Golden foods for these players: each gets a full stack. Adding again adds to who.
function projectAddFoods(p, raws, slots, now = Date.now()) {
  const foods = raws.filter(raw => projectGoldenFoods().includes(raw)), who = [...new Set(slots)];
  if (!foods.length || !who.length) return false;
  foods.forEach(raw => {
    const had = p.targets.find(x => x.raw === raw);
    if (had) { had.for = [...new Set([...projectFor(had), ...who])]; had.fill = true; } else p.targets.push({ raw, count: 0, for: who, fill: true });
  });
  projectExpand(p, now);
  return true;
}
function projectSetRecipients(p, raw, slots, now = Date.now()) {
  const had = p.targets.find(x => x.raw === raw);
  if (!had) return false;
  had.for = [...new Set(slots)];
  projectExpand(p, now);
  return true;
}
// "Use this copy" of a spare, or not.
function projectUseSpare(p, raw, key, on, now = Date.now()) {
  const had = p.targets.find(x => x.raw === raw);
  if (!had || !had.for) return false;
  const use = new Set(Array.isArray(had.use) ? had.use : []);
  if (on) use.add(key); else use.delete(key);
  had.use = [...use];
  p.editedAt = now;
  syncProjects(now);
  return true;
}
// Undo for projectRemoveItem.
function projectRestoreItem(p, target, now = Date.now()) {
  if (p.targets.some(x => x.raw === target.raw)) return false;
  p.targets.push(target);
  projectExpand(p, now);
  return true;
}
// Only what a hand added: an item's own nodes go when the item does.
function projectRemoveNode(p, id) {
  const n = projectNode(p, id);
  if (!n) return { ok: false, reason: 'missing' };
  if (n.raw) return { ok: false, reason: 'recipe' };
  p.nodes = p.nodes.filter(x => x !== n);
  p.edges = p.edges.filter(e => e.from !== id && e.to !== id);
  p.editedAt = Date.now();
  return { ok: true };
}
function dropOptions(raw) {
  const name = itemName(raw);
  return (PROJECT_DROPS[raw] || []).map(([monster, perKill, mapIdx]) => {
    const own = (DROPS[monster] || []).find(d => d[0] === name);
    return { monster, name: monsterName(monster), chance: own ? own[1] : perKill, mapIdx };
  });
}
// What an item task needs to know about where it drops. o is one of dropOptions, or nothing.
function itemSourceFields(o) {
  const m = o && GAME.monsters[o.monster], key = m ? m[1] + '|' + m[0] : null, world = o && /^Crystal(\d)$/.test(o.monster) ? +o.monster.slice(7) : null;
  return !o ? { source: 'direct', chance: null, match: null, monster: '', afkId: '', activityKey: null }
    : world != null ? { source: 'crystal', chance: o.chance, match: { kind: 'world', world }, monster: o.monster, afkId: '', activityKey: null }
    : { source: 'monster', chance: o.chance, match: { kind: 'activity', key }, monster: o.monster, afkId: o.monster, activityKey: key };
}
// The drop someone is on, then the best one.
function bestDropOption(options) {
  const on = x => rows.some(y => y.slot != null && y.monster === x.monster);
  return options.find(on) || options[0];
}
// The "Make task" button: an item task with amount = the requirement. monster is one of dropOptions; default what's being fought, then the best one.
function projectMakeTask(p, nodeId, { monster } = {}, now = Date.now()) {
  const n = projectNode(p, nodeId);
  if (!n || !n.raw) return null;
  const name = itemName(n.raw), options = dropOptions(n.raw), o = options.find(x => x.monster === monster) || bestDropOption(options);
  let t = tasks.find(x => x.key === taskKey({ type: 'item', itemName: name }));
  if (!t) t = upsertTask({ type: 'item', itemName: name, amount: '', auto: false, starred: true, ...itemSourceFields(o) }, now);
  n.taskId = t.id;
  syncProjects(now);
  return t;
}
// The typed per hour of a skill-gathered or count-only node.
function projectSetRate(p, nodeId, text, now = Date.now()) {
  const n = projectNode(p, nodeId);
  if (!n) return false;
  const t = n.role === 'count' ? null : projectNodeTask(n);
  if (t) taskEdit(t, 'perHour', text, now);
  else n.perHour = text;
  p.editedAt = now;
  return true;
}
function projectRateText(n) { const t = n.role === 'count' ? null : projectNodeTask(n); return (t ? t.perHour : n.perHour) ?? ''; }
function openTaskInProjects(taskId) {
  const p = projectsOfTask(taskId)[0];
  projectFocus = { projectId: p ? p.id : null, taskId };
  showTab('projects');
}

/* the sums */
const projectTitle = n => { const t = n.taskId && tasks.find(x => x.id === n.taskId); return n.raw ? itemName(n.raw) : t ? taskTitle(t) : 'Deleted task'; };
// One node's own numbers: how much, and how long it takes by itself.
function projectOwn(n, role, need, have, now) {
  const t = projectNodeTask(n), base = { need, have, left: null, rate: 0, rateSource: null, ownHours: null, done: false, needs: '', noRate: false, makeTask: false, missing: false, capped: false, runsOutMs: null, note: '', active: t ? taskIsActive(t) : false };
  if (role === 'task') {
    if (!t) return { ...base, need: null, missing: true, needs: 'Task deleted' };
    const k = taskCalc(t, now);
    return { ...base, need: k.target ?? null, have: k.have ?? null, left: k.left ?? null, rate: k.rate || 0, rateSource: k.rateSource || null, ownHours: k.done ? 0 : k.hours, done: !!k.done, needs: k.done ? '' : k.needs || (k.hours == null ? k.line : ''), note: k.note || '', capped: !!k.capped, runsOutMs: k.runsOutMs ?? null };
  }
  if (have == null) return { ...base, left: need, needs: 'Waiting for game data' };
  if (!(need > 0)) return { ...base, left: 0, ownHours: 0, done: true };
  const rest = Math.max(need - have, 0);
  if (role === 'craft') return { ...base, left: rest, ownHours: 0, done: rest === 0 };
  if (role === 'forge') { const go = forgeEta(n.raw, rest, now); return { ...base, ...go, ownHours: go.hours, hours: undefined }; }
  const printed = printedRate(n.raw);
  if (printed > 0) return { ...base, left: rest, rate: printed, rateSource: 'printer', ownHours: 0, done: true, note: 'Printing ' + fmtRate(printed) + ' / hour, counted as unlimited' };
  let rate = 0, rateSource = null, prompt = '', counting = false;
  if (role === 'count') {
    const typed = parseNum(n.perHour);
    rate = typed > 0 ? typed : 0;
    rateSource = rate ? 'typed' : null;
    prompt = 'No rate';
  } else if (t) {
    const got = taskRate(t);
    ({ rate, rateSource, needs: prompt } = got);
    counting = base.active || !!(got.team && got.team.others > 0);
  } else prompt = role === 'drop' ? 'Make a task' : 'Enter amount / hour';
  const go = towards(have, need, rate, counting, now);
  return { ...base, left: go.left, rate, rateSource, ownHours: go.hours, done: !!go.done, needs: go.hours == null ? prompt : '', noRate: role === 'count' && !rate, makeTask: role === 'drop' && !t };
}
// { id, nodes: { id: {...} }, order, edges, roots, hours, etaMs, done, bottleneck, blocked, forgeNote }. Only nodes with something to do are in it: owning a mid-tier item takes everything beneath it out.
// A node: { id, raw, taskId, role, kind, title, icon, need, have, left, rate, rateSource, ownHours, hours, etaMs, done, ready, needs, noRate, makeTask, missing, capped, runsOutMs, note, active, inputs, dependents, depth }.
function projectCalc(p, now = Date.now()) {
  const fresh = !projectCalcing.has(p.id);
  projectCalcing.add(p.id);
  try {
    const { demand, have, who } = projectDemand(p), nodes = {}, forSome = new Set(p.targets.filter(x => projectFor(x).length).map(x => x.raw));
    p.nodes.forEach(n => {
      const need = n.raw ? demand.get(n.raw) || 0 : null, kept = forSome.has(n.raw); // a box for players stays, and is done once nobody's missing it
      if (n.raw && !(need > 0) && !n.hand && !kept) return;
      const role = !n.raw || (!(need > 0) && !kept) ? 'task' : n.role, t = projectNodeTask(n), w = n.raw ? who.get(n.raw) : null, target = w && p.targets.find(x => x.raw === n.raw);
      nodes[n.id] = { id: n.id, raw: n.raw || null, taskId: t ? t.id : null, role, kind: n.raw ? projectKind(n.raw) : t ? t.type : null, title: projectTitle(n), icon: n.raw || (t ? taskIconName(t) : ''), ...projectOwn(n, role, need, n.raw ? have.get(n.raw) ?? null : null, now), inputs: [], dependents: [], depth: 0, hours: null, etaMs: null, ready: false, who: w ? w.list : null, spares: w ? w.spares : [], whoUsed: w ? w.used : 0, whoFood: !!(w && w.food), extra: w ? target.count || 0 : 0, move: null };
      // what's owned covers everyone, but someone still has to hand it over: not done until they hold it
      const node = nodes[n.id];
      if (w && w.used > 0 && node.done) Object.assign(node, { done: false, ownHours: 0, left: 0, move: w.food ? w.list.filter(x => x.left > 0).map(x => ({ slot: x.slot, n: x.left })) : w.list.filter(x => x.state === '').map(x => ({ slot: x.slot, n: 1 })) });
    });
    const edges = p.edges.filter(e => nodes[e.from] && nodes[e.to]);
    edges.forEach(e => { nodes[e.to].inputs.push(e.from); nodes[e.from].dependents.push(e.to); });
    // inputs first
    const count = new Map(Object.keys(nodes).map(id => [id, nodes[id].inputs.length])), order = Object.keys(nodes).filter(id => !count.get(id));
    for (let i = 0; i < order.length; i++) nodes[order[i]].dependents.forEach(d => { count.set(d, count.get(d) - 1); if (!count.get(d)) order.push(d); });
    const kindOfEdge = (from, to) => edges.find(e => e.from === from && e.to === to).kind;
    const parts = {}; // start: when its 'after' inputs are through. needsAt: when its 'needs' inputs are
    order.forEach(id => {
      const n = nodes[id], worst = list => list.some(x => nodes[x].hours == null) ? null : Math.max(0, ...list.map(x => nodes[x].hours));
      const start = worst(n.inputs.filter(x => kindOfEdge(x, id) === 'after')), needsAt = worst(n.inputs.filter(x => kindOfEdge(x, id) === 'needs'));
      parts[id] = { start, needsAt };
      if (n.done) n.hours = 0;
      else n.hours = n.ownHours == null || start == null || needsAt == null ? null : Math.max(start + n.ownHours, needsAt);
      if (n.hours != null) n.etaMs = now + n.hours * 36e5;
      n.ready = !n.done && n.inputs.every(x => nodes[x].done);
      if (!n.done && !n.needs && n.hours == null) { const stuck = n.inputs.find(x => nodes[x].hours == null); if (stuck) n.needs = 'Waiting on ' + nodes[stuck].title; }
    });
    [...order].reverse().forEach(id => { nodes[id].inputs.forEach(x => { nodes[x].depth = Math.max(nodes[x].depth, nodes[id].depth + 1); }); });
    const list = order.map(id => nodes[id]), open = list.filter(n => !n.done), blockedAt = open.some(n => n.hours == null);
    const hours = blockedAt ? null : list.length ? Math.max(0, ...list.map(n => n.hours)) : 0, done = !open.length && list.length > 0;
    return {
      id: p.id, now, nodes, order, edges, roots: order.filter(id => !nodes[id].dependents.length), hours, etaMs: hours == null ? null : now + hours * 36e5, done,
      bottleneck: projectBottleneck(open, nodes, parts, kindOfEdge),
      blocked: open.filter(n => n.ownHours == null).map(n => n.id),
      forgeNote: list.some(n => n.note === FORGE_NOTE) ? FORGE_NOTE : '',
    };
  } finally { if (fresh) projectCalcing.delete(p.id); }
}
// The chain that sets the finish, last node first: from the latest (or stuck) node, back through whichever input held it up.
function projectBottleneck(open, nodes, parts, kindOfEdge) {
  if (!open.length) return [];
  const stuck = open.filter(n => n.hours == null), pool = stuck.length ? stuck : open;
  const late = (a, b) => a.depth - b.depth || (b.hours ?? 0) - (a.hours ?? 0);
  let at = stuck.length ? [...pool].sort(late)[0] : [...pool].sort((a, b) => b.hours - a.hours || a.depth - b.depth)[0];
  const path = [at.id];
  for (;;) {
    const inputs = at.inputs.map(x => nodes[x]).filter(x => !x.done);
    let next = null;
    if (at.hours == null) next = at.ownHours == null ? null : inputs.find(x => x.hours == null) || null;
    else {
      const { start, needsAt } = parts[at.id], ownEnd = start + at.ownHours;
      if (needsAt > ownEnd) next = inputs.find(x => kindOfEdge(x.id, at.id) === 'needs' && x.hours === needsAt) || null;
      else if (start > 0) next = inputs.find(x => kindOfEdge(x.id, at.id) === 'after' && x.hours === start) || null;
    }
    if (!next || path.includes(next.id)) return path;
    path.push(next.id);
    at = next;
  }
}

/* loading */
function cleanProjects(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter(p => p && typeof p === 'object' && p.id && !seen.has(p.id) && seen.add(p.id)).map(p => {
    const copy = { ...p, targets: (Array.isArray(p.targets) ? p.targets : []).filter(x => x && x.raw && (x.count > 0 || Array.isArray(x.for))), nodes: (Array.isArray(p.nodes) ? p.nodes : []).filter(n => n && n.id), edges: [] };
    const ids = new Set(copy.nodes.map(n => n.id));
    (Array.isArray(p.edges) ? p.edges : []).forEach(e => { if (e && ids.has(e.from) && ids.has(e.to) && !copy.edges.some(x => x.from === e.from && x.to === e.to) && !projectWouldCycle(copy, e.from, e.to)) copy.edges.push(e); });
    return copy;
  });
}
// Runs from setState. A state with no projects (an older page saved it) keeps those held here.
function loadProjects(s) { if (Array.isArray(s.projects)) projects = cleanProjects(s.projects); }
