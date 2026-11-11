/* World 1 statues: levels, grades, flairs, and how many statues a level takes */
// Per statue: what it boosts, and which marble its flair costs. From the game's statue list, as Idleon Toolbox publishes it.
const STATUE_INFO = [['Base damage', 0], ['Move speed', 0], ['Mining power', 0], ['Food effect', 0], ['Base health', 0], ['Crit damage', 1], ['Choppin power', 0], ['Base defence', 0], ['Fishing power', 1], ['Catchin power', 1], ['Class EXP', 1], ['Product speed', 0], ['Alchemy EXP', 1], ['Crit chance', 1], ['Accuracy', 1], ['Trappin power', 2], ['Worship power', 2], ['Skill EXP', 2], ['Construction EXP', 2], ['Coins', 1], ['Cooking EXP', 3], ['Breeding EXP', 3], ['Damage', 0], ['Divinity EXP', 4], ['Sailing speed', 4], ['Farming EXP', 5], ['Stealth', 5], ['White essence', 5], ['Villager EXP', 4], ['Statue bonus', 3], ['Spelunking EXP', 6], ['Daily coral', 6]];
const STATUE_GRADES = ['Normal', 'Gold', 'Onyx', 'Zenith'];
// The Statues page's "Buy flair before depositing" box. Here, not with the page, since the goals' sync reads it as the save loads.
let statuesFlairFirst = false;
try { statuesFlairFirst = localStorage.getItem(LOCAL_KEY + '-statue-flair') === '1'; } catch { /* storage blocked */ }
const statueRaw = i => 'EquipmentStatues' + (i + 1);
// Statues one level takes, from this level to the next.
const statueLevelCost = lv => Math.round(Math.pow(lv, 1.17) * Math.pow(1.35, lv / 10) + 1);
// game: "SF_bonus" and "StatueEXPmulti": each statue put in counts this many times over.
const statueFlairBonus = lv => 2 * (300 * lv + 100 * Math.floor(lv / 2) + 200 * Math.floor(lv / 3));
// game: "SF_costo", in the statue's marble
const statueFlairCost = (i, lv) => 10 * (i + 1) * Math.pow(5, lv);
// What every statue put in counts for besides its flair, as the wiki has it: +10% for each statue made onyx (zenith ones were onyx first), +25% for each made zenith,
// all added up, then the Skinny 0 Cal vial's chance to count double (at most 100%). Its chance is 2.5% a vial level, times what raises all vials.
// { multi, onyx, zenith, vial }: vial is the double chance in percent, null when the save can't say.
function statueDepositBonus() {
  const s = statueSource(), grades = (s && kpkParse(s.StuG)) || [], C = statueCtx();
  const onyx = grades.filter(g => +g >= 2).length, zenith = grades.filter(g => +g >= 3).length;
  let vial = null;
  try { const lv = parseInt((((C && C.f('CauldronInfo')) || [])[4] || [])[6]) || 0; vial = C ? scGrowth('add', lv, 2.5, 0) * scVials(C) : null; } catch { vial = null; }
  return { multi: (1 + 0.1 * onyx + 0.25 * zenith) * (1 + Math.min(vial || 0, 100) / 100), onyx, zenith, vial };
}
// Where statue levels come from: the save, or before the app asks for them with every sync, what the Printer tab fetched.
function statueSource() {
  const d = saveForFinder && saveForFinder.data, x = printerExtraNow && printerExtraNow.data;
  const has = o => o && Object.keys(o).some(k => /^StatueLevels_\d+$/.test(k));
  return has(d) ? d : has(x) ? { ...x, RoyalG: d && d.RoyalG, Menagerie: d && d.Menagerie } : null;
}
// Every statue, or null without statue levels. Levels are the account's, written to each character: the highest counts.
function statueList() {
  const s = statueSource();
  if (!s) return null;
  const slots = Object.keys(s).map(k => k.match(/^StatueLevels_(\d+)$/)).filter(Boolean).map(m => +m[1]);
  const grades = kpkParse(s.StuG) || [], rg = kpkParse(s.RoyalG), flairs = (Array.isArray(rg) && rg[22]) || [], men = kpkParse(s.Menagerie);
  const flairMax = 3 + (+((men && men[2]) || [])[17] >= 1 ? 1 : 0); // game: "SF_maxLV"
  const levels = slots.map(slot => kpkParse(s['StatueLevels_' + slot]) || []), bonus = statueDepositBonus().multi;
  return STATUE_INFO.map(([effect, shard], i) => {
    const best = levels.map(l => l[i] || [0, 0]).reduce((a, b) => (+b[0] > +a[0] || (+b[0] === +a[0] && +b[1] > +a[1]) ? b : a), [0, 0]);
    const level = +best[0] || 0, progress = +best[1] || 0, grade = Math.min(Math.max(+grades[i] || 0, 0), 3), flair = +flairs[i] || 0;
    const shardRaw = 'RGshard' + shard, flairCost = flair < flairMax ? statueFlairCost(i, flair) : null, shards = ownedCount([shardRaw]);
    return {
      index: i, raw: statueRaw(i), name: itemName(statueRaw(i)), effect, level, progress, next: statueLevelCost(level), grade,
      art: ['Statue', 'StatueG', 'StatueO', 'StatueZ'][grade] + (i + 1),
      flair, flairMax, flairCost, shardRaw, shards, depositBonus: bonus, expMulti: (1 + statueFlairBonus(flair) / 100) * bonus,
      held: ownedCount([statueRaw(i)]) || 0,
    };
  });
}
const statueByIndex = i => { const list = statueList(); return list ? list[i] || null : null; };
// Statues still to put in to reach this level, after what's already in. Null when the save can't say.
function statuesToLevel(i, to, s = statueByIndex(i)) {
  if (!s) return null;
  if (!(to > s.level)) return 0;
  let points = -s.progress;
  for (let lv = s.level; lv < to; lv++) points += statueLevelCost(lv);
  return Math.max(Math.ceil(points / statueDepositMulti(s)), 0);
}
// The flair level the marbles held would buy, from where it is. Each statue is priced as if it had its marbles to itself.
function statueFlairReach(s) {
  let lv = s.flair, left = s.shards || 0;
  while (lv < s.flairMax && statueFlairCost(s.index, lv) <= left) { left -= statueFlairCost(s.index, lv); lv++; }
  return { flair: lv, spent: (s.shards || 0) - left, expMulti: (1 + statueFlairBonus(lv) / 100) * (s.depositBonus || 1) };
}
// What one statue put in counts for: its flair now, or with the Statues page's box ticked, the flair the marbles held would buy first.
const statueDepositMulti = s => statuesFlairFirst ? statueFlairReach(s).expMulti : s.expMulti;
// The level these statues would bring it to, and what would be in toward the next. expMulti: what each counts, if not its flair now.
function statueAfter(i, statues, expMulti, s = statueByIndex(i)) {
  if (!s) return null;
  let lv = s.level, p = s.progress + statues * (expMulti || s.expMulti);
  while (p >= statueLevelCost(lv) && lv < 1e5) { p -= statueLevelCost(lv); lv++; }
  return { level: lv, progress: p, next: statueLevelCost(lv) };
}
// A statue goal is a level, set on the Statues page. It's a parent: the work is a Collect task for the statue, which the AFK planner and the panel show.
function setStatueGoal(i, to) {
  const lv = Math.floor(parseNum(to));
  if (!(lv > 0)) return null;
  const goal = upsertTask({ type: 'item', itemName: itemName(statueRaw(i)), statueIndex: i, statueTo: lv, amount: '', starred: true, ...statueDropSource(i) });
  syncStatueGoals();
  return goal;
}
// The statue's Collect task: the account's one for that item, made by a goal if there wasn't one.
const statueCollectTask = i => tasks.find(t => t.key === taskKey({ type: 'item', itemName: itemName(statueRaw(i)) })) || null;
// Each level goal sets its Collect task's amount: every statue still to put in for that level, those held counted, so it moves when a flair is bought or statues go in.
// The goal is the upper bound: a smaller typed amount stands, a larger one comes down to it. Nothing changes while the statue levels aren't known.
function syncStatueGoals(now = Date.now()) {
  if (!statueList()) return;
  tasks.filter(t => t.type === 'item' && t.statueTo).forEach(g => {
    const need = statuesToLevel(g.statueIndex, g.statueTo);
    if (need == null) return;
    let c = statueCollectTask(g.statueIndex);
    if (!c) c = upsertTask({ type: 'item', itemName: g.itemName, amount: '', auto: false, starred: true, ...statueDropSource(g.statueIndex) }, now);
    c.statueGoalOf = g.statueIndex;
    if (!c.starred) c.starred = true;
    const typed = !c.amountAuto && !blankText(c.amount) ? parseNum(c.amount) : null;
    if (typed > 0 && typed <= need) return;
    const text = fmtNum(need);
    if (c.amount !== text) c.amount = text;
    c.amountAuto = true;
    c.amountExact = need;
  });
}
// A statue goal goes by where the statue drops, as any item goal does: whoever is on a monster that drops it is working on it.
// The first monster in the drop tables stands for them all; the team is found per character from what each is fighting. None when no monster drops it.
function statueDropSource(i) {
  const name = itemName(statueRaw(i));
  for (const [monster, list] of Object.entries(DROPS)) {
    if (/^Crystald/.test(monster)) continue;
    const d = list.find(x => x[0] === name);
    if (d) return { source: 'monster', chance: d[1], monster, afkId: monster, match: { kind: 'activity', key: null } };
  }
  return { source: 'direct', chance: null };
}
// Statue goals made before they carried a drop source get one.
function settleStatueGoals() {
  tasks.forEach(t => { if (t.type === 'item' && t.statueTo && t.source == null) Object.assign(t, statueDropSource(t.statueIndex)); });
}
/* what each statue gives: the game's "StatueBonusGiven", as Idleon Toolbox works it out */
const STATUE_BASE = [3, 0.1, 0.3, 1, 3, 0.4, 0.3, 1, 0.3, 0.3, 0.1, 0.5, 0.5, 0.2, 0.8, 0.3, 0.3, 0.1, 0.5, 1, 0.3, 0.4, 0.2, 1, 0.5, 0.4, 0.3, 0.6, 0.3, 0.2, 0.1, 0.02];
const STATUE_PCT = [false, true, false, true, false, true, false, false, false, false, true, true, true, true, true, false, false, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
// A character's own talents that raise one statue, in Idleon Toolbox's order (parsers/world-1/statues.ts, getStatueBonus): where there are two, the first one the character has counts, not both.
const STATUE_TALENTS = { 0: ['SHIELDIEST_STATUES', 'STRONGEST_STATUES'], 2: ['SHIELDIEST_STATUES', 'STRONGEST_STATUES'], 8: ['STRONGEST_STATUES'], 7: ['SHIELDIEST_STATUES'], 1: ['STRAIGHTSHOT_STATUES', 'SHWIFTY_STATUES'], 11: ['STRAIGHTSHOT_STATUES', 'SHWIFTY_STATUES'], 14: ['STRAIGHTSHOT_STATUES'], 9: ['SHWIFTY_STATUES'], 10: ['STARING_STATUES', 'STUPENDOUS_STATUES'], 6: ['STARING_STATUES', 'STUPENDOUS_STATUES'], 13: ['STARING_STATUES'], 12: ['STUPENDOUS_STATUES'], 17: ['SKILLIEST_STATUE'], 5: ['SKILLIEST_STATUE'], 3: ['SKILLIEST_STATUE'] };
let statueCtxKept = null;
// The save's extra fields (/api/printer-extra): statue levels before the app reads them with every sync, and the artifact, merits and the rest statue effects need.
let printerExtraNow = null;
// The week's vote winners, when the game's server record has come in.
function voteWinners(vars = printerExtraNow && printerExtraNow.vars) {
  const first = key => { const list = vars && vars[key]; return Array.isArray(list) && Number.isFinite(+list[0]) ? +list[0] : null; };
  return { meritocracy: first('voteCat2'), vote: first('voteCategories') };
}
// The sample calc's view of the save, with the Printer tab's extra fields when they've been read. Without them some multipliers count as none: a low estimate.
function statueCtx() {
  const d = saveForFinder && saveForFinder.data, x = printerExtraNow && printerExtraNow.data;
  if (!d) return null;
  if (statueCtxKept && statueCtxKept.d === d && statueCtxKept.x === x) return statueCtxKept.C;
  const C = scCtx(x ? { ...x, ...d } : d, saveForFinder.companions);
  C.setupNow = voteWinners(); // the week's merit bonus reaches statues too
  statueCtxKept = { d, x, C, players: new Map() };
  return C;
}
function statuePlayer(C, slot) {
  const kept = statueCtxKept.players;
  if (!kept.has(slot)) { try { kept.set(slot, scPlayer(C, slot, {})); } catch { kept.set(slot, null); } }
  return kept.get(slot);
}
// { value, plain, own }: what it gives at this level and grade, for this character with their own statue talents, or with nobody's when slot is null.
function statueEffect(i, level, grade, slot = null) {
  const C = statueCtx();
  if (!C || !(level > 0)) return { value: 0, plain: 0, own: 1 };
  const common = scStatueCommon(C, grade);
  if (i === 29) return { value: level * STATUE_BASE[29] * common, plain: level * STATUE_BASE[29] * common, own: 1 };
  const dragon = scStatueRaw(C, 29), vault = [0, 1, 2, 6].includes(i) ? 1 + C.vault(25) / 100 : 1;
  const plain = level * STATUE_BASE[i] * common * dragon * vault, names = STATUE_TALENTS[i];
  const P = names && slot != null && C.slots.includes(slot) ? statuePlayer(C, slot) : null;
  const own = P ? 1 + Math.max(0, names.map(n => scTalent(C, P, SC_DATA.talId[n])).find(v => v) || 0) / 100 : 1;
  return { value: plain * own, plain, own };
}
const statueEffectText = (i, v) => (STATUE_PCT[i] ? '+' + fmtNum(v) + '%' : '+' + fmtNum(v)) + ' ' + STATUE_INFO[i][0].toLowerCase();
