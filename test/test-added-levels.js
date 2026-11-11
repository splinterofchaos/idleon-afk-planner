// Talent added levels: BUILD_DIST=dist-port node test-added-levels.js. Every number is worked by hand from Toolbox's getTalentAddedLevels. Runs in a temp page; no live app.
const assert = require('assert'), { start } = require('./harness');
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').slice(0, 6).join('\n      ')); } };
const J = JSON.stringify, set = (arr, i, v) => { arr[i] = v; return arr; };
const LV_DIV_100 = [60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100]; // class level 60, Divinity 100
// One Elemental Sorcerer in slot 0 with nothing else, under the family bonus's level 69. Each test adds one source.
const base = () => ({
  CharacterClass_0: 34, Lv0_0: [60], SL_0: { 531: 334 }, PVStatList_0: [0, 0, 1000, 0, 0], Prayers_0: [], EMm0_0: {}, EquipOrder_0: [{}], KLA_0: [], PTimeAway_0: 5, PlayerStuff_0: [0, 0],
  Divinity: new Array(30).fill(0).map((_, i) => i >= 12 && i < 24 ? -1 : 0), Holes: [], PrayOwned: [], CauldronInfo: [[], [], [], []], CauldronBubbles: [[]], Ninja: [], FarmUpg: [], Bubba: [], UpgVault: [], RoyalG: [],
  OptLacc: [], Spelunk: [],
  AchieveReg: [], Dream: [], Grimoire: [], Arcane: [], Gaming: [], Research: [[]],
});
const linked = () => { const d = base(); d.Lv0_0 = [...LV_DIV_100]; d.Divinity[12] = 1; return d; }; // Arctis is god slot 1
const elsewhere = () => { const d = base(); d.Lv0_0 = [...LV_DIV_100]; d.Divinity[12] = 8; return d; };

(async () => {
  const h = await start({ noPoll: true });
  // Runs inside the page against this save, and puts the page's own save back so its timers never see the test's.
  const inPage = (d, companions, expr) => h.run(`(() => { const keep = saveForFinder; saveForFinder = { data: ${J(d)}${companions ? ', companions: ' + J(companions) : ''} }; try { return ${expr}; } finally { saveForFinder = keep; } })()`);
  const added = (d, companions = [], slot = 0, skill = 531) => inPage(d, companions, `({ ...kpkAddedLevels(${slot}), talent: kpkTalentLevel(${slot}, ${skill}, kpkParse(saveForFinder.data.SL_${slot}) || {}) })`);
  const wis = (d, companions = [], map = 100) => inPage(d, companions, `(() => { const x = kpkSaveTerms(0, ${map}).find(t => t.id === 'talentWis'); return { ...x, locked: kpkLocked(x) }; })()`);
  const WIS_334 = 40 * 334 / 434; // 1000 WIS, so stat / 1000 = 1
  try {
    await test('nothing owned: nothing added, the level stays the base', async () => {
      const a = await added(base());
      assert.equal(a.known, true); assert.equal(a.value, 0); assert.equal(a.talent.level, 334); assert.equal(a.talent.whole, true);
    });
    await test('Arctis linked, ceiled: 15 x 100/160 = 9.375, up to 10', async () => assert.equal((await added(linked())).parts.god, 10));
    await test('Arctis with Big P and Coral Kid: 15 x 0.625 x (1 + 0.5 x 60/120) x 1.2 = 14.0625, up to 15', async () => {
      const d = linked(); d.CauldronBubbles = [['c21']]; d.CauldronInfo[3][21] = 60; d.OptLacc[430] = 20;
      assert.equal((await added(d)).parts.god, 15);
    });
    await test('Sheepie counts Big P as equipped', async () => {
      const d = linked(); d.CauldronInfo[3][21] = 60; d.OptLacc[430] = 20;
      assert.equal((await added(d)).parts.god, 12, 'without: 15 x 0.625 x 1.2 = 11.25, up to 12');
      assert.equal((await added(d, ['4,0,,,0'])).parts.god, 15);
    });
    await test('Arctis: another god gives nothing; King Doot, a pocket god and research square 173 each grant it', async () => {
      const d = elsewhere();
      assert.equal((await added(d)).parts.god, 0, 'linked elsewhere');
      assert.equal((await added(d, ['0,0,,,0'])).parts.god, 10, 'King Doot at Divinity 2+');
      const low = base(); low.Lv0_0 = [60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
      assert.equal((await added(low, ['0,0,,,0'])).parts.god, 0, 'King Doot at Divinity 1 does nothing');
      assert.equal((await added({ ...d, Holes: set(set([], 6, [1]), 11, set([], 29, 1)) })).parts.god, 10, 'first pocket spot');
      assert.equal((await added({ ...d, Holes: set(set([], 6, [1]), 11, set([], 30, 1)) })).parts.god, 0, 'second spot, one unlocked');
      assert.equal((await added({ ...d, Holes: set(set([], 6, [2]), 11, set([], 30, 1)) })).parts.god, 10, 'second spot, two unlocked');
      assert.equal((await added({ ...d, Research: [set([], 173, 1)] })).parts.god, 10, 'research square 173');
    });
    await test('Arctis by polytheism: SL 505 = 11 is slot 1, once two gods are unlocked and the character is linked', async () => {
      const d = elsewhere(); d.SL_0[505] = 11; d.Divinity[25] = 2;
      assert.equal((await added(d)).parts.god, 10);
      d.Divinity[25] = 1; assert.equal((await added(d)).parts.god, 0, 'not unlocked');
      d.Divinity[25] = 2; d.Divinity[12] = -1; assert.equal((await added(d)).parts.god, 0, 'no link');
    });
    const arcane45 = () => { const a = Array(46).fill(0); a[45] = 6; return a; };
    await test('a prisma Big P takes the prisma multiplier: 15 x 0.625 x 1.25 x (2 + 6/100) = 24.140625, up to 25, and needs no box', async () => {
      const d = linked(); d.CauldronBubbles = [['c21']]; d.CauldronInfo[3][21] = 60; d.OptLacc[384] = 'c18,c21,a1,';
      Object.assign(d, { Arcane: arcane45(), ArcadeUpg: [], Sushi: [], CauldronP2W: [] });
      const a = await added(d);
      assert.equal(a.parts.god, 25); assert.equal(a.short, undefined); assert.equal(a.talent.whole, true); assert.equal(a.talent.level, 359);
      assert.doesNotMatch(await inPage(d, [], `kpkTalentHint(kpkTalentLevel(0, 531, kpkParse(saveForFinder.data.SL_0)))`), /prisma/);
    });
    await test('a prisma Big P before the multiplier\'s fields are read uses the base 2x: 15 x 0.625 x 1.25 x 2 = 23.4375, up to 24', async () => {
      const d = linked(); d.CauldronBubbles = [['c21']]; d.CauldronInfo[3][21] = 60; d.OptLacc[384] = 'c18,c21,a1,'; d.Arcane = arcane45();
      const a = await added(d);
      assert.equal(a.parts.god, 24); assert.equal(a.talent.level, 358);
    });
    await test('a Big P that isn\'t prisma\'d ignores the multiplier: 15 x 0.625 x 1.25 = 11.72, up to 12', async () => {
      const d = linked(); d.CauldronBubbles = [['c21']]; d.CauldronInfo[3][21] = 60; d.OptLacc[384] = 'c18,a1,';
      Object.assign(d, { Arcane: arcane45(), ArcadeUpg: [], Sushi: [], CauldronP2W: [] });
      assert.equal((await added(d)).parts.god, 12);
    });
    await test('Symbols of Beyond: 1 + floor(324 / 20) = 17, for a class with that tab', async () => {
      const d = base(); d.SL_0[539] = 324;
      assert.equal((await added(d)).parts.symbols, 17);
      const v = base(); v.CharacterClass_0 = 4; v.SL_0[539] = 324;
      assert.equal((await added(v)).parts.symbols, 0, 'Voidwalker');
      const w = base(); w.CharacterClass_0 = 22; w.SL_0[374] = 39;
      assert.equal((await added(w)).parts.symbols, 2, 'archer id: 1 + floor(39 / 20)');
    });
    await test('achievement 291 is done at -1', async () => {
      const d = base(); d.AchieveReg[291] = -1; assert.equal((await added(d)).parts.achievement, 1);
      d.AchieveReg[291] = 3; assert.equal((await added(d)).parts.achievement, 0);
    });
    await test('family from another sorcerer: 20 x 931 / 1281 = 14.54, floored to 14', async () => {
      const d = base(); d.CharacterClass_1 = 34; d.Lv0_1 = [1000]; d.SL_1 = {}; d.PlayerStuff_1 = [0, 0];
      assert.equal((await added(d)).parts.family, 14);
    });
    await test('family with its own Family Guy, using every added level but the family bonus', async () => {
      const d = base(); d.Lv0_0 = [1000]; d.SL_0[144] = 100; d.Grimoire[39] = 30; // level 130 + floor(14.535) = 144: 40 x 144 / 244 = 23.606, and 14.535 x 1.23606 = 17.97
      const a = await added(d);
      assert.equal(a.noFamily, 30); assert.equal(a.parts.family, 17); assert.equal(a.value, 47);
    });
    await test('a Family Guy buffs only its owner’s view of the bonus', async () => {
      const d = base(); d.CharacterClass_1 = 34; d.Lv0_1 = [1000]; d.SL_1 = { 144: 100 }; d.PlayerStuff_1 = [0, 0];
      assert.equal((await added(d, [], 0)).parts.family, 14);
      assert.equal((await added(d, [], 1)).parts.family, 17, 'slot 1: 40 x 114 / 214 = 21.31, and 14.535 x 1.2131 = 17.63');
    });
    await test('companion 1: 25, 35 upgraded, 25 through a pet token', async () => {
      assert.equal((await added(base(), ['1,0,,,0'])).parts.companion, 25);
      assert.equal((await added(base(), ['1,0,,,0', '1,1,,,1'])).parts.companion, 35);
      const d = base(); d.OptLacc[605] = 1; d.OptLacc[606] = '1';
      assert.equal((await added(d)).parts.companion, 25);
    });
    await test('ninja mastery tier 3 or more: 5', async () => {
      const d = base(); d.OptLacc[232] = 2; assert.equal((await added(d)).parts.ninja, 0);
      d.OptLacc[232] = 3; assert.equal((await added(d)).parts.ninja, 5);
    });
    await test('Equinox_Symbols is Dream[12]', async () => {
      const d = base(); d.Dream[11] = 99; d.Dream[12] = 15; d.Dream[13] = 99;
      assert.equal((await added(d)).parts.equinox, 15);
    });
    await test('grimoire 39', async () => {
      const d = base(); d.Grimoire[38] = 99; d.Grimoire[39] = 30;
      assert.equal((await added(d)).parts.grimoire, 30);
    });
    await test('Kattlekruk: handed in, or worn whole by whoever played last', async () => {
      const d = base(); assert.equal((await added(d)).parts.set, 0);
      d.OptLacc[379] = '0,IRON_SET,KATTLEKRUK_SET'; assert.equal((await added(d)).parts.set, 5);
      const w = base(); w.EquipOrder_0 = [{ 0: 'EquipmentHats83', 1: 'EquipmentWands11', 2: 'EquipmentShirts36', 3: 'EquipmentPants27', 4: 'EquipmentShoes36', 5: 'EquipmentCape13' }];
      assert.equal((await added(w)).parts.set, 5);
      delete w.EquipOrder_0[0][1]; assert.equal((await added(w)).parts.set, 0, 'no weapon');
    });
    await test('tesseract 57 stops at 5', async () => {
      const d = base(); d.Arcane[57] = 3; assert.equal((await added(d)).parts.tesseract, 3);
      d.Arcane[57] = 8; assert.equal((await added(d)).parts.tesseract, 5);
    });
    await test('Timmy_Talented: floor((1357 - 500) / 100) = 8, none below level 500', async () => {
      const d = base(); d.Lv0_0 = [1357]; d.Gaming[12] = '_aU'; assert.equal((await added(d)).parts.superbit, 8);
      d.Gaming[12] = '_a'; assert.equal((await added(d)).parts.superbit, 0, 'not unlocked');
      d.Gaming[12] = 'U'; d.Lv0_0 = [400]; assert.equal((await added(d)).parts.superbit, 0, 'not negative');
    });
    await test('super talent: 50 + 10 x 5 + 9 = 109, on the selected preset only', async () => {
      const d = base(); d.Spelunk[18] = set([], 7, 5); d.Spelunk[45] = set([], 5, 9); d.Spelunk[20] = [531, -1]; d.Spelunk[32] = [100];
      const a = await added(d);
      assert.equal(a.superBonus, 109); assert.equal(a.talent.level, 334 + 109); assert.equal(a.talent.sup, 109);
      d.PlayerStuff_0 = [0, 1];
      assert.equal((await added(d)).talent.level, 334, 'preset 1 reads Spelunk[32]');
    });
    await test('banned talents, Royal Guardian talents, and no points', async () => {
      const d = base(); d.Grimoire[39] = 30; d.SL_0[539] = 40; d.SL_0[225] = 7; d.RoyalG = [[], [], set([], 55, 4)]; // 30 + symbols 1 + floor(40 / 20) = 33
      assert.equal((await added(d, [], 0, 539)).talent.level, 40, 'banned');
      assert.equal((await added(d, [], 0, 225)).talent.level, 11, 'Royal Guardian: 7 + armory cap 4');
      assert.equal((await added(d, [], 0, 100)).talent.level, 0, 'no points');
      assert.equal((await added(d, [], 0, 531)).talent.level, 367, 'plain: 334 + 33');
    });
    await test('terms: the full level goes in, the box goes away, the hint says how', async () => {
      const d = base(); d.Grimoire[39] = 30; d.Dream[12] = 16; // 334 + 46 = 380
      const t = await wis(d);
      assert.ok(Math.abs(t.value - 40 * 380 / 480) < 1e-9, t.value); assert.equal(t.from, 'save'); assert.equal(t.locked, true); assert.match(t.hint, /Level 380: 334 \+ 46 added\./);
    });
    await test('terms: a super talent says so', async () => {
      const d = base(); d.Spelunk[20] = [531]; d.Grimoire[39] = 1;
      assert.match((await wis(d)).hint, /Level 385: 334 \+ 1 added \+ 50 super talent\./);
    });
    await test('terms: off from World 7 is exact, whatever fields are missing', async () => {
      const d = base(); delete d.Dream;
      const t = await wis(d, [], 300);
      assert.equal(t.value, 0); assert.equal(t.locked, true); assert.match(t.hint, /World 7/);
    });
    await test('terms: no points is exact, whatever fields are missing', async () => {
      const d = base(); delete d.Dream; d.SL_0 = {};
      const t = await wis(d);
      assert.equal(t.value, 0); assert.equal(t.locked, true);
    });
    for (const lost of ['AchieveReg', 'Dream', 'Grimoire', 'Arcane', 'Gaming', 'Research', 'PlayerStuff_0']) await test('no ' + lost + ': base level, box kept, the hint says restart', async () => {
      const d = base(); delete d[lost];
      const t = await wis(d);
      assert.ok(Math.abs(t.value - WIS_334) < 1e-9, t.value); assert.equal(t.from, 'save'); assert.equal(t.locked, false); assert.match(t.hint, /Level 334, without added talent levels: the app needs a restart/);
    });
    await test('companions not read: base level, box kept, the hint says so', async () => {
      const t = await inPage(base(), null, `(() => { const x = kpkSaveTerms(0, 100).find(t => t.id === 'talentWis'); return { ...x, locked: kpkLocked(x) }; })()`);
      assert.ok(Math.abs(t.value - WIS_334) < 1e-9, t.value); assert.equal(t.locked, false); assert.match(t.hint, /hasn.t read your companions/);
    });
    await test('junk in a new field never throws, and the term falls back', async () => {
      for (const junk of ['{not json', 5, null, { a: 1 }]) {
        const d = base(); d.Gaming = junk;
        const t = await inPage(d, [], `kpkReadTerms(0, 100).find(t => t.id === 'talentWis')`);
        assert.ok(Math.abs(t.value - WIS_334) < 1e-9, J(junk) + ': ' + t.value); assert.equal(t.partial, true); assert.equal(t.from, 'save');
      }
      const d = base(); d.Spelunk = '{not json'; d.CauldronInfo = 7; d.Holes = 'x'; d.OptLacc = 'x'; d.SL_0 = { 531: 334 }; d.Divinity = 5; d.Dream = [];
      const t = await inPage(d, [], `kpkReadTerms(0, 100).find(t => t.id === 'talentWis')`);
      assert.equal(t.from, 'save');
    });
    await test('kept per save: the same save isn’t read twice, a new one is', async () => {
      const r = await h.run(`(() => { const keep = saveForFinder; try { saveForFinder = { data: ${J(base())}, companions: [] }; const a = kpkAddedLevels(0), same = a === kpkAddedLevels(0); saveForFinder = { data: ${J(base())}, companions: [] }; return [same, a === kpkAddedLevels(0)]; } finally { saveForFinder = keep; } })()`);
      assert.deepEqual(r, [true, false]);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
