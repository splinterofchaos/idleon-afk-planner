const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const [page = path.join(__dirname, '..', 'dist', 'idleon-afk-planner.html'), dir = path.join(__dirname, 'fixtures', 'toolbox')] = process.argv.slice(2);
const html = fs.readFileSync(page, 'utf8');
const script = html.split('<script>')[1].split('</script>')[0];
new vm.Script(script); // syntax check of the whole page script
const head = script.split('/* ---------- the maths ---------- */')[0].replace(/const \$ = .*\n/, '');
const logic = script.split('/* ---------- the maths ---------- */')[1].split('/* ---------- drawing ---------- */')[0];
const ctx = { location: { hostname: 'file' } };
vm.runInNewContext(head + logic + ';Object.assign(this,{parseNum,calc,fmtNum,fmtWait,expReq,goalLevel,readSave,mergeSave,applyChar,blankRow,migrateRow,calcSkill,classView,rareInfo,DROPS,nudgeText,wornHat,findItems,readHoldings,heldTotal,unitTotal,matchScore,ITEMS});', ctx);
const { parseNum, calc, fmtNum, fmtWait, expReq, readSave, mergeSave, blankRow, migrateRow, calcSkill, classView, rareInfo, DROPS, nudgeText, wornHat, findItems, readHoldings, heldTotal, unitTotal, matchScore, ITEMS } = ctx;
const classCalc = (r, n) => calcSkill(classView(r), n);
const now = 1.8e12, id = () => 'n' + Math.random();

// numbers
assert.equal(parseNum('450k'), 450000); assert.equal(parseNum('1.2M'), 1200000); assert.equal(parseNum('2q'), 2e15);
assert.equal(parseNum('1.5e6'), 1.5e6); assert.equal(parseNum(''), null); assert.ok(Number.isNaN(parseNum('abc')));
assert.equal(fmtNum(1234567), '1.23M'); assert.equal(fmtWait(26, false), '1d 2h');

// kills: number left / rate
let c = calc({ kind: 'kills', kph: '1000', kpc: '50', left: '4000', startedAt: null }, now);
assert.equal(c.left, 4000); assert.equal(c.hours, 4); assert.equal(c.clears, 80);
c = calc({ kind: 'kills', kph: '1000', kpc: '50', left: '4000', startedAt: now - 36e5 }, now);
assert.equal(c.left, 3000); assert.equal(c.hours, 3); assert.equal(c.clears, 60);
c = calc({ kind: 'kills', kph: '1000', left: '4000', startedAt: now - 5 * 36e5 }, now); assert.equal(c.done, true); assert.equal(c.left, 0);
c = calc({ kind: 'kills', kph: '', left: '', startedAt: null }, now); assert.equal(c.hours, null); assert.equal(c.left, null); assert.equal(c.done, false);
c = calc({ kind: 'exp', xph: '10', left: '20', startedAt: null }, now); assert.equal(c.hours, 2); assert.equal(c.clears, null);
// spelunking: EXP left, no clears, and an import gives the exact EXP to the next level
// every Spelunking cost stored in real saves, to the digit the game stores
for (const [t, cost] of [[34, 1355911.9435049952], [45, 5538436.071709199], [280, 1291064554315.8755], [300, 3479256890410.7935], [335, 19116133410891.227], [371, 106553974414407.67], [383, 187689266818612.88], [477, 14471241080760892], [529, 151719834545484830], [587, 2016118356805428700], [2160, 6.242757524431605e+46]]) {
  assert.ok(Math.abs(expReq(19, t) / cost - 1) < 1e-9, 'spelunking cost at ' + t + ': ' + expReq(19, t) + ' vs ' + cost);
}
// Player2's goal: 66.8T into level 383, to level 400, at 10T an hour
let spSum = -66788312796581.22; for (let t = 383; t < 400; t++) spSum += expReq(19, t);
c = calc({ kind: '19', lvl: '383', xp: '66788312796581.22', goal: '400', xph: '10t', scale: 1, startedAt: null }, now);
assert.ok(Math.abs(c.left / spSum - 1) < 1e-9); assert.ok(Math.abs(c.hours - spSum / 1e13) < 1e-6); assert.equal(c.clears, null);
console.log('Spelunking 383 to 400 needs', spSum.toExponential(4), 'EXP');
const spCh = { slot: 0, name: 'S', cls: '', map: '', mapIdx: 0, activity: 'SPELUNKING', target: 'x', since: now - 1000, portalLeft: null, lv: Array(21).fill(1), exp: Array(21).fill(30), req: Array(21).fill(100) };
const sp = mergeSave([], [spCh], now, id).rows[0];
assert.equal(sp.kind, '19'); assert.equal(sp.lvl, '1'); assert.equal(sp.startedAt, now - 1000); assert.equal(sp.offTask, undefined);
const oldSp = migrateRow({ id: 'q', kind: 'exp', expActivity: 'SPELUNKING', task: 'Spelunking', left: '5' }); assert.equal(oldSp.kind, '19'); assert.equal(migrateRow({ id: 'q', kind: 'spelunk', left: '5', leftAuto: true, xph: '1k' }).kind, '19'); assert.equal(migrateRow({ id: 'q', kind: 'spelunk', xph: '1k' }).xph, '1k');
// old sheets
let m = migrateRow({ id: 'a', name: 'x', kph: '1k', goal: '100k', have: '25k' }); assert.equal(m.left, '75000'); assert.equal(m.goal, undefined);
m = migrateRow({ id: 'b', kind: '4', lvl: '100', goal: '120', xph: '1k' }); assert.equal(m.goal, '120');
assert.equal(calc(migrateRow({ kph: '25k', goal: '100k', have: '25k' }), now).hours, 3);

// skill: sum of level costs, hand-summed from the same formula
const fish = (t) => (15 + t * t + 15 * t) * Math.pow(1.225 - Math.min(0.18, (0.135 * t) / (t + 50)), t) - 30;
const r = { kind: '4', lvl: '100', xp: '0', goal: '103', xph: '1000', scale: 1, startedAt: null };
c = calc(r, now);
const want = fish(100) + fish(101) + fish(102);
assert.ok(Math.abs(c.left - want) < 1e-6 * want); assert.equal(c.clears, null); assert.ok(Math.abs(c.hours - want / 1000) < 1);

// "+5" and already-reached goals
c = calc({ ...r, goal: '+5' }, now); assert.equal(c.target, 105);
c = calc({ ...r, goal: '100' }, now); assert.equal(c.done, true);
c = calc({ ...r, goal: '+5', lvl: '' }, now); assert.equal(c.hours, null);

// scale halves the cost; EXP already in the level comes off; the timer walks levels
c = calc({ ...r, scale: 2 }, now); assert.ok(Math.abs(c.left - want / 2) < 1e-6 * want);
c = calc({ ...r, xp: String(fish(100) / 2) }, now); assert.ok(Math.abs(c.left - (want - fish(100) / 2)) < 1e-6 * want);
c = calc({ ...r, startedAt: now - 36e5, xph: String(fish(100) + 1) }, now); assert.equal(c.level, 101); assert.ok(c.left > 0);

// huge goals don't produce nonsense
c = calc({ ...r, lvl: '10', goal: '100000' }, now); assert.ok(c.tooFar || Number.isFinite(c.hours) || c.hours === null);

// real saves: every formula level cost, through the page's own reader
for (const name of ['latest', 'highend', 'first', 'fresh']) {
  const text = fs.readFileSync(path.join(dir, name + '.json'), 'utf8');
  const list = readSave(text), support = readSave(JSON.stringify({ ...JSON.parse(text), extraData: {} })), rawOnly = readSave(JSON.stringify(JSON.parse(text).data));
  assert.ok(list.length > 0); assert.equal(rawOnly.length, list.length); // "Copy raw data" gives the data block alone
  assert.equal(rawOnly[0].name, '');
  assert.ok(support[0].name && support[0].name === JSON.parse(text).charNames[0], 'Copy for support carries names');
  const first = mergeSave([], rawOnly, now, id).rows; assert.ok(/^Character \d+$/.test(first[0].name));
  const renamed = mergeSave(first, support, now, id).rows; assert.equal(renamed.length, first.length);
  assert.equal(renamed[0].name, support[0].name, 'placeholder names get replaced');
  const mine = first.map(r => ({ ...r, name: 'My Own Name' })); assert.equal(mergeSave(mine, support, now, id).rows[0].name, 'My Own Name');
  list.forEach(ch => {
    assert.ok(ch.since === null || (ch.since > 1.5e12 && ch.since < 2.2e12), 'AFK time looks like a date: ' + ch.since);
    assert.ok(ch.cls, 'class name'); assert.ok(ch.map, 'map name');
    assert.equal(ch.lv.length, 21);
  });
  const merged = mergeSave([{ id: 'x', example: true, name: 'Warrior' }], rawOnly, now, id);
  assert.equal(merged.rows.length, list.length); assert.equal(merged.added, list.length);
  merged.rows.forEach(row => assert.ok(row.name && row.slot != null && row.doing));
  // re-import keeps rates and goals, and adds nothing
  merged.rows[0].kph = '5k'; merged.rows[0].xph = '7k'; merged.rows[0].goal = '999';
  const again = mergeSave(merged.rows, rawOnly, now, id);
  assert.equal(again.added, 0); assert.equal(again.rows[0].kph, '5k'); assert.equal(again.rows[0].goal, '999');
  // a fishing goal on a slot: level + EXP + stored next cost come through, and the next level costs what the game says
  const ch = rawOnly.find(x => x.lv[4] > 1 && x.req[4] > 0);
  if (ch) {
    const row = { ...blankRow('f'), kind: '4', slot: ch.slot, goal: '+1', xph: '1k' };
    const m2 = mergeSave([row], [{ ...ch, activity: 'FISHING', since: null }], now, id).rows[0];
    assert.equal(+m2.goal, ch.lv[4] + 1);
    const res = calc({ ...m2, xp: '' }, now);
    assert.ok(Math.abs(res.left / ch.req[4] - 1) < 1e-6, 'next-level cost matches save: ' + res.left + ' vs ' + ch.req[4]);
  }
  console.log(name, 'ok,', list.length, 'chars, doing e.g.', list.map(x => x.activity).slice(0, 4).join('/'), 'portalLeft e.g.', list[0].portalLeft);
}
// rows follow what the character is doing, and each activity remembers its numbers
const base = { slot: 0, name: 'S', cls: '', map: '', mapIdx: 0, since: now - 36e5, portalLeft: null, lv: Array(21).fill(100), exp: Array(21).fill(0), req: Array(21).fill(1000) };
const chop = { ...base, activity: 'CHOPPIN', target: 'Ancient Seaweed' }, fight = { ...base, activity: 'FIGHTING', target: 'Glowfish', portalLeft: 500 }, fight2 = { ...fight, target: 'Mantaray', portalLeft: 900 };
let row = mergeSave([{ ...blankRow('s'), kind: 'spelunk', slot: 0, left: '91t', leftAuto: true }], [chop], now, id).rows[0];
assert.equal(row.kind, '3', 'a Spelunking row follows the character to Chopping'); assert.equal(row.doing, 'Chopping Ancient Seaweed'); assert.equal(row.left, ''); assert.equal(row.offTask, undefined);
assert.equal(row.startedAt, now - 36e5);
row.xph = '5k'; row.goal = '300';
row = mergeSave([row], [fight], now, id).rows[0];
assert.equal(row.kind, 'kills'); assert.equal(row.xph, ''); assert.equal(row.goal, ''); assert.equal(row.left, '500'); assert.equal(row.leftAuto, true); assert.equal(row.task, 'Glowfish');
row.kph = '12k'; row.kpc = '40';
row = mergeSave([row], [fight2], now, id).rows[0];
assert.equal(row.kph, '', 'a different monster has its own rate'); assert.equal(row.left, '900');
row = mergeSave([row], [fight], now, id).rows[0];
assert.equal(row.kph, '12k', 'the monster\'s rate comes back'); assert.equal(row.kpc, '40'); assert.equal(row.left, '500');
row = mergeSave([row], [chop], now, id).rows[0];
assert.equal(row.kind, '3'); assert.equal(row.xph, '5k', 'the skill rate comes back'); assert.equal(row.goal, '300', 'the skill goal comes back');
row = mergeSave([row], [{ ...base, activity: 'Nothing', target: 'Nothing' }], now, id).rows[0];
assert.equal(row.kind, 'idle'); assert.equal(row.startedAt, null); assert.equal(calc(row, now).hasGoal, false);
row = mergeSave([row], [{ ...base, activity: 'Paying_Respect', target: 'Altar' }], now, id).rows[0];
assert.equal(row.kind, 'exp');
// a goal is optional: no goal, no wait
row = mergeSave([], [{ ...base, activity: 'FISHING', target: 'Goldfish' }], now, id).rows[0]; row.xph = '1k';
assert.equal(calc(row, now).hasGoal, false); assert.equal(calc(row, now).hours, null);
// extra rows for one character collapse into one, keeping their numbers
const two = mergeSave([{ ...blankRow('a'), slot: 0, kind: 'kills', kph: '1k' }, { ...blankRow('b'), slot: 0, kind: '3', xph: '2k', goal: '250' }], [chop], now, id);
assert.equal(two.rows.length, 1); assert.equal(two.rows[0].xph, '2k'); assert.equal(two.rows[0].goal, '250');
// a number typed after the save keeps counting from when it was typed
row = mergeSave([], [fight], now, id).rows[0]; row.left = '50'; row.leftAuto = false; row.startedAt = now - 1000;
row = mergeSave([row], [fight], now, id).rows[0]; assert.equal(row.left, '50'); assert.equal(row.startedAt, now - 1000);
// class EXP on fighters: same level maths as skill slot 0, goal stays on the character
const clsCh = { ...fight, since: null, lv: [120, ...Array(20).fill(1)], exp: [0, ...Array(20).fill(0)], req: [expReq(0, 120), ...Array(20).fill(0)] };
let f1 = mergeSave([], [clsCh], now, id).rows[0];
f1.cxph = String(expReq(0, 120)); f1.classGoal = '+1';
f1 = mergeSave([f1], [clsCh], now, id).rows[0];
assert.equal(f1.classGoal, '121', '+1 locks to a level');
let cc = classCalc(f1, now);
assert.ok(Math.abs(cc.hours - 1) < 1e-9, 'one level at one level per hour: ' + cc.hours);
assert.equal(cc.target, 121);
f1.afkSince = now - 2 * 36e5; assert.equal(classCalc(f1, now).done, true);
const f2 = mergeSave([f1], [{ ...clsCh, activity: 'CHOPPIN', target: 'x' }], now, id).rows[0];
assert.equal(f2.classGoal, '121', 'class goal stays when the activity changes');
// rare drops, with Toolbox's numbers: kills / (1 + mk) x chance x dr; x2 at 2 / that
assert.ok(DROPS && DROPS.mushP, 'drop table present');
const cardChance = DROPS.mushP.find(d => d[0] === 'Purp Mushroom Card');
assert.equal(cardChance[1], 0.00002);
assert.ok(!DROPS.mushP.some(d => d[0] === 'Purple Mush Cap' || /Dungeon/.test(d[0])), 'common drops and credits stay out');
const rr = { kind: 'kills', slot: 0, monster: 'mushP', rare: 'Purp Mushroom Card', kph: '100k', dr: '5', mk: '100', afkSince: now - 36e5 };
let ri = rareInfo(rr, now);
assert.ok(Math.abs(ri.perHour - 5) < 1e-9, 'per hour ' + ri.perHour); assert.ok(Math.abs(ri.hoursEach - 0.2) < 1e-9); assert.ok(Math.abs(ri.guaranteedHours - 0.4) < 1e-9); assert.ok(Math.abs(ri.soFar - 5) < 1e-9);
assert.equal(rareInfo({ ...rr, dr: '' }, now).perHour, null);
assert.equal(rareInfo({ ...rr, rare: '' }, now), null);
assert.equal(rareInfo({ ...rr, monster: 'nope' }, now), null);
// each monster keeps its own chosen drop
let f3 = mergeSave([], [{ ...fight, afkId: 'mushP' }], now, id).rows[0]; f3.rare = 'Purp Mushroom Card'; f3.dr = '5';
f3 = mergeSave([f3], [{ ...fight2, afkId: 'frogP' }], now, id).rows[0]; assert.equal(f3.rare, ''); assert.equal(f3.dr, '5', 'drop rate belongs to the character'); assert.equal(f3.monster, 'frogP');
f3 = mergeSave([f3], [{ ...fight, afkId: 'mushP' }], now, id).rows[0]; assert.equal(f3.rare, 'Purp Mushroom Card');
// the hat you see: premium slot first, then the regular one
const worn = (a, b) => JSON.stringify([{ 0: a, 8: b, length: 16 }, {}]);
assert.equal(wornHat(worn('EquipmentHats53', 'EquipmentHats109')), 'EquipmentHats109');
assert.equal(wornHat(worn('EquipmentHats53', 'Blank')), 'EquipmentHats53');
assert.equal(wornHat(worn('Blank', 'Blank')), null);
assert.equal(wornHat(worn('../evil', 'EquipmentHats1.png')), null);
assert.equal(wornHat('not json'), null); assert.equal(wornHat(undefined), null);
const firstSave = readSave(fs.readFileSync(path.join(dir, 'first.json'), 'utf8'));
assert.equal(firstSave[0].hat, 'EquipmentHats109'); assert.equal(firstSave[0].classIndex, 10); assert.equal(firstSave[1].hat, null);
for (const s of firstSave) { if (s.hat) assert.ok(fs.existsSync(path.join(path.dirname(page), 'icons', s.hat + '.png')), s.hat); assert.ok(fs.existsSync(path.join(path.dirname(page), 'icons', 'ClassIcons' + s.classIndex + '.png')), 'class ' + s.classIndex); }
const hatRow = mergeSave([], [firstSave[0]], now, id).rows[0]; assert.equal(hatRow.hat, 'EquipmentHats109'); assert.equal(hatRow.classIndex, 10);
// goal handle: moves the last written digit
for (const [raw, steps, want] of [['400',1,'401'],['400',-1,'399'],['1000',-1,'999'],['9',1,'10'],['2.4e10',1,'2.5e10'],['2.4e10',-3,'2.1e10'],['2.9e10',1,'3.0e10'],['2.4E+10',1,'2.5E+10'],['1.2m',1,'1.3m'],['24k',-1,'23k'],['2.50b',1,'2.51b'],['+5',1,'+6'],['0',-1,'0'],['0.1',-5,'0.0'],['.5',1,'0.6'],['1,000',1,'1001'],['120900954022032',1,'120900954022033'],['abc',1,null],['',1,null]]) assert.equal(nudgeText(raw, steps), want, raw + ' ' + steps);
// the game's own number is never treated as typed, and gets repaired; a really typed number stays
let healed = mergeSave([{ ...blankRow('h'), slot: 0, kind: 'kills', activityKey: 'FIGHTING|Glowfish', left: '161745334', leftAuto: false }], [{ ...fight, portalLeft: 161745334 }], now, id).rows[0];
assert.equal(healed.left, '161M'); assert.equal(healed.leftAuto, true); assert.equal(healed.leftExact, 161745334);
// a typed number keeps counting from when it was typed while the game's count hasn't moved...
const typedAt = now - 60000, afkFrom = now - 36e5;
let kept = mergeSave([{ ...blankRow('k'), slot: 0, kind: 'kills', activityKey: 'FIGHTING|Glowfish', left: '195.5M', leftAuto: false, leftSeen: 161745334, startedAt: typedAt }], [{ ...fight, portalLeft: 161745334, since: afkFrom }], now, id).rows[0];
assert.equal(kept.left, '195.5M'); assert.equal(kept.leftAuto, false); assert.equal(kept.leftExact, 161745334); assert.equal(kept.startedAt, typedAt);
// ...and the game's next count replaces it, counting from the game's AFK start
let replaced = mergeSave([kept], [{ ...fight, portalLeft: 90000000, since: now - 1000 }], now, id).rows[0];
assert.equal(replaced.left, '90M'); assert.equal(replaced.leftAuto, true); assert.equal(replaced.leftExact, 90000000); assert.equal(replaced.startedAt, now - 1000);
// rows from before this rule take the game's count once
let oldTyped = mergeSave([{ ...blankRow('o'), slot: 0, kind: 'kills', activityKey: 'FIGHTING|Glowfish', left: '134901K', leftAuto: false, leftExact: 96109873, startedAt: typedAt }], [{ ...fight, portalLeft: 96109873, since: afkFrom }], now, id).rows[0];
assert.equal(oldTyped.left, '96.1M'); assert.equal(oldTyped.leftAuto, true); assert.equal(oldTyped.startedAt, afkFrom);
// typed again after that lasts until the next change; a map with no portal count keeps what's typed
let again = { ...oldTyped, left: '50M', leftAuto: false, startedAt: typedAt };
again = mergeSave([again], [{ ...fight, portalLeft: 96109873, since: afkFrom }], now, id).rows[0]; assert.equal(again.left, '50M');
let noPortal = mergeSave([{ ...blankRow('n'), slot: 0, kind: 'kills', activityKey: 'FIGHTING|Glowfish', left: '50M', leftAuto: false }], [{ ...fight, portalLeft: null }], now, id).rows[0];
assert.equal(noPortal.left, '50M'); assert.equal(noPortal.leftSeen, null);
noPortal = mergeSave([noPortal], [{ ...fight, portalLeft: null }], now, id).rows[0]; assert.equal(noPortal.left, '50M');
// Divinity, Lab and Worship rows show their level from the save, and nobody else's row does
const sideLv = Array(21).fill(1); sideLv[14] = 465; sideLv[12] = 461; sideLv[9] = 160;
const sideExp = Array(21).fill(0); sideExp[14] = 282629060; const sideReq = Array(21).fill(0); sideReq[14] = 305889063;
let divRow = mergeSave([], [{ ...base, activity: 'DIVINITY', target: 'Divinity', lv: sideLv, exp: sideExp, req: sideReq }], now, id).rows[0];
assert.deepEqual(JSON.parse(JSON.stringify(divRow.sideSkill)), { name: 'Divinity', lvl: 465, xp: 282629060, cost: 305889063 });
divRow = mergeSave([divRow], [{ ...base, activity: 'LABORATORY', target: 'Laboratory', lv: sideLv, exp: sideExp, req: sideReq }], now, id).rows[0];
assert.equal(divRow.sideSkill.name, 'Laboratory'); assert.equal(divRow.sideSkill.lvl, 461);
divRow = mergeSave([divRow], [{ ...base, activity: 'Paying_Respect', target: 'Altar', lv: sideLv, exp: sideExp, req: sideReq }], now, id).rows[0];
assert.equal(divRow.sideSkill.name, 'Worship');
divRow = mergeSave([divRow], [{ ...fight, lv: sideLv, exp: sideExp, req: sideReq }], now, id).rows[0];
assert.equal(divRow.sideSkill, null, 'fighters have no side skill line');
divRow = mergeSave([divRow], [{ ...base, activity: 'DIVINITY', target: 'Divinity', lv: Array(21).fill(0), exp: sideExp, req: sideReq }], now, id).rows[0];
assert.equal(divRow.sideSkill, null, 'an unlearned skill shows no level');
// auto-filled numbers: at most three digits, cut rather than rounded, with the exact count kept for the wait
for (const [n, want] of [[400809220, '400M'], [105200000, '105M'], [1230000, '1.23M'], [1299999, '1.29M'], [999999, '999K'], [1000, '1K'], [161745334, '161M'], [999, '999']]) assert.equal(fmtNum(n), want);
let autoRow = mergeSave([], [{ ...fight, portalLeft: 400809220 }], now, id).rows[0];
assert.equal(autoRow.left, '400M'); assert.equal(autoRow.leftExact, 400809220);
assert.equal(calc({ ...autoRow, startedAt: null }, now).left, 400809220, 'wait uses the exact count');
assert.equal(calc({ ...autoRow, startedAt: null, leftAuto: false, left: '400M' }, now).left, 4e8, 'a typed number is used as typed');
// item finder: spelling slips, and every holding counted against a hand count of the raw save
assert.equal(ITEMS.Quest79, 'Halloween Treat');
assert.equal(findItems('Holloween treat', null)[0].name, 'Halloween Treat', 'forgives the typo');
assert.equal(findItems('halloween treat', null)[0].name, 'Halloween Treat');
assert.equal(findItems('Quest79', null)[0].name, 'Halloween Treat', 'raw names work');
assert.equal(findItems('treat', null).some(g => g.name === 'Halloween Treat'), true);
assert.equal(findItems('zzzzqqq', null).length, 0);
assert.equal(findItems('', null).length, 0);
const nametag = findItems('Spooky Scary Nametag', null)[0]; assert.equal(nametag.rawNames.length, 2, 'same-named items count together');
for (const name of ['latest', 'highend', 'first']) {
  const save = JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8')), d = save.data, P = v => typeof v === 'string' ? JSON.parse(v) : v;
  const held = readHoldings(save);
  assert.ok(held.hasStorage && held.hasBags);
  const chest = P(d.ChestOrder), qty = P(d.ChestQuantity);
  chest.forEach((raw, i) => { if (raw !== 'Blank' && raw !== 'LockedInvSpace') { const want = chest.reduce((s, r, j) => s + (r === raw ? (parseFloat(qty[j]) > 0 ? parseFloat(qty[j]) : 1) : 0), 0); assert.equal(held.storage[raw], want, raw); } });
  held.units.forEach(u => {
    const inv = P(d['InventoryOrder_' + u.slot]), iq = P(d['ItemQTY_' + u.slot]);
    inv.forEach(raw => { if (raw !== 'Blank' && raw !== 'LockedInvSpace') assert.equal(u.bags[raw], inv.reduce((s, r, j) => s + (r === raw ? (parseFloat(iq[j]) > 0 ? parseFloat(iq[j]) : 1) : 0), 0), raw); });
    assert.ok(!('Blank' in u.bags) && !('Blank' in u.worn) && !('length' in u.worn));
    const worn = P(d['EquipOrder_' + u.slot])[0];
    Object.keys(worn).filter(k => k !== 'length' && worn[k] !== 'Blank').forEach(k => assert.ok(u.worn[worn[k]] >= 1, worn[k]));
  });
}
const tiny = readHoldings({ charNames: ['A', 'B'], data: { Lv0_0: '[1]', Lv0_1: '[1]', InventoryOrder_0: '["Quest79","Blank","Quest79"]', ItemQTY_0: '[3,0,2]', InventoryOrder_1: '["Blank"]', ItemQTY_1: '[0]', EquipOrder_1: JSON.stringify([{ 0: 'Blank', length: 1 }, { 0: 'Blank', length: 1 }, { 0: 'Quest79', length: 1 }]), EquipQTY_1: JSON.stringify([{ 0: 0 }, { 0: 0 }, { 0: 7 }]), ChestOrder: '["Quest79","Blank"]', ChestQuantity: '[11,0]' } });
assert.equal(tiny.units[0].bags.Quest79, 5); assert.equal(tiny.units[1].food.Quest79, 7); assert.equal(tiny.storage.Quest79, 11); assert.equal(heldTotal(tiny, ['Quest79']), 23);
assert.equal(unitTotal(tiny.units[1], ['Quest79']), 7);
assert.equal(readHoldings(null), null);
assert.equal(readSave('{"hello":1}'), null); assert.equal(readSave('not json'), null);
console.log('all checks passed');
