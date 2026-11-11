// Projects model: node test-projects.js. Numbers are hand-worked in the comments. Real recipes come from recipes.json, rates from full-save.json.
const assert = require('assert'), { start, sleep } = require('./harness');
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').slice(0, 6).join('\n      ')); } };
const near = (a, b, msg, tol = 1e-6) => assert.ok(a != null && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), (msg || '') + ': ' + a + ' should be ' + b);
const J = JSON.stringify, recipes = require('./fixtures/recipes.json').recipes;
const T0 = Date.now() - 1000, SLOTS = 16;
// A small save, so owned counts are exactly what a test says. forge: [[ore, oreQty, barQty, barrel, barrelQty, progress]], slot by position.
// chars: { slot: { bag: { raw: qty }, bags: [raw, ...] (a slot each), worn: [raw], bagStats, wornStats } }. chestStats: CMm.
function small({ chest = {}, bag = {}, worn = [], forge = [], lv = [16, 0, 0, 0, 0, 0], gems = 0, menagerie = 0, refinery = {}, anvil = [], flurbos = 0, chars = {}, chestStats } = {}) {
  const order = [], qty = [], prog = [];
  for (let i = 0; i < SLOTS; i++) {
    const [ore = 'Blank', oreQty = 0, barQty = 0, barrel = 'Blank', barrelQty = 0, part = 0] = forge[i] || [];
    order.push(ore, barrel, ore === 'Blank' ? 'Blank' : ore + 'Bar');
    qty.push(oreQty, barrelQty, barQty);
    prog.push(part);
  }
  const gemList = []; gemList[104] = gems;
  const men = [[], [], [], []]; men[3][11] = menagerie;
  const opt = []; opt[73] = flurbos;
  const extra = {};
  Object.entries(chars).forEach(([i, c]) => {
    const order = c.bags || Object.keys(c.bag || {}), wornList = c.worn || [];
    Object.assign(extra, { ['Lv0_' + i]: [1], ['InventoryOrder_' + i]: order, ['ItemQTY_' + i]: c.bags ? c.bags.map(() => 1) : Object.values(c.bag || {}), ['EquipOrder_' + i]: [Object.fromEntries(wornList.map((raw, k) => [k, raw])), {}, {}], ['EquipQTY_' + i]: [Object.fromEntries(wornList.map((raw, k) => [k, 1])), {}, {}] });
    if (c.bagStats) extra['IMm_' + i] = c.bagStats;
    if (c.wornStats) extra['EMm0_' + i] = c.wornStats;
  });
  if (chestStats) extra.CMm = chestStats;
  return {
    ...extra,
    Lv0_0: [1], InventoryOrder_0: Object.keys(bag), ItemQTY_0: Object.values(bag), EquipOrder_0: [Object.fromEntries(worn.map((raw, i) => [i, raw])), {}, {}], EquipQTY_0: [Object.fromEntries(worn.map((raw, i) => [i, 1])), {}, {}],
    ChestOrder: Object.keys(chest), ChestQuantity: Object.values(chest), Cards0: {}, Rift: [0], Spelunk: [[]], OptLacc: opt,
    ForgeItemOrder: order, ForgeItemQty: qty, ForgeIntProg: prog, ForgeLV: lv, GemItemsPurchased: gemList, Menagerie: men,
    Refinery: [[], Object.keys(refinery), Object.values(refinery)], AnvilPA_0: anvil,
  };
}
(async () => {
  const h = await start({ noPoll: true }), run = h.run;
  const realSave = () => run(`window.__real = window.__real || saveForFinder; saveForFinder = window.__real; syncTasks(); 1`);
  const use = opts => run(`window.__real = window.__real || saveForFinder; saveForFinder = { data: ${J(small(opts))}, savedAt: ${T0}, fetchedAt: ${T0} }; syncTasks(); 1`);
  const fresh = (name = 'Test') => run(`projectCreate(${J(name)}).id`);
  const P = id => `projectById(${J(id)})`;
  const add = (pid, raw, count = 1) => run(`projectAddItem(${P(pid)}, ${J(raw)}, ${count})`);
  const calc = async (pid, now = T0) => {
    const c = await run(`projectCalc(${P(pid)}, ${now})`);
    c.raw = Object.fromEntries(Object.values(c.nodes).map(n => [n.raw || n.title, n]));
    return c;
  };
  const clean = () => run(`projects.splice(0); tasks.splice(0, tasks.length, ...tasks.filter(t => t.type !== 'forge' && t.type !== 'craft' && !t.test && !t.projectMade)); 1`);
  // A task with a rate: amount / perHour hours by itself, nothing owned.
  const timed = (pid, name, amount, perHour) => run(`projectNewTask(${P(pid)}, { slot: null, type: 'item', itemName: ${J(name)}, source: 'direct', chance: null, match: null, amount: ${J(String(amount))}, perHour: ${J(String(perHour))}, test: true }).id`);
  const edge = (pid, a, b, kind) => run(`projectAddEdge(${P(pid)}, ${J(a)}, ${J(b)}, ${J(kind)})`);
  try {
    // Iron set: hat 20 Iron Bar + 50 Forest1, shirt 25 bars, pants 10 bars. Slots 1, 2, 3 are the players unless a test says.
    const HAT = 'EquipmentHats18', SHIRT = 'EquipmentShirts12', PANTS = 'EquipmentPants3', ALLSET = [HAT, SHIRT, PANTS];
    const forTeam = async (who = [1, 2, 3]) => { const id = await fresh(); await run(`projectAddSet(${P(id)}, 'IRON_SET', { for: ${J(who)} }); 1`); return id; };
    const keys = n => n.spares.map(x => x.key).sort();
    const useCopy = (id, key, on = true, raw = HAT) => run(`projectUseSpare(${P(id)}, ${J(raw)}, ${J(key)}, ${on})`);
    await test('players: worn or in their own bags has it, for that player only', async () => {
      await clean();
      await use({ chars: { 1: { worn: [HAT] }, 2: { bag: { [HAT]: 1 } }, 3: {} } });
      const c = await calc(await forTeam()), hat = c.raw[HAT];
      assert.deepEqual(hat.who.map(w => [w.slot, w.state]), [[1, 'worn'], [2, 'bags'], [3, '']]);
      assert.equal(hat.need, 1, 'only slot 3 lacks it'); assert.equal(hat.have, 0); assert.equal(hat.left, 1); assert.equal(hat.done, false);
      assert.equal(c.raw[SHIRT].need, 3);
      assert.equal(c.raw.IronBar.need, 125); // hat 20*1 + shirt 25*3 + pants 10*3
      assert.equal(c.raw.Forest1.need, 50);
      assert.deepEqual(keys(hat), [], 'a player\'s own copies are not spares');
    });
    await test('spares never reduce need: storage, others\' bags, others\' worn, a player\'s second copy, whatever the equipped tick says', async () => {
      await clean();
      await use({ chest: { [HAT]: 1 }, chars: { 1: { worn: [HAT] }, 2: { bags: [HAT, HAT] }, 3: {}, 4: { bag: { [HAT]: 1 } }, 5: { worn: [HAT] } } });
      const id = await forTeam(), hat = (await calc(id)).raw[HAT];
      assert.equal(hat.need, 1); assert.equal(hat.have, 0); assert.equal(hat.left, 1);
      assert.deepEqual(keys(hat), ['bags:2:1', 'bags:4:0', 'storage::0', 'worn:5:0'], 'not worn:1:0 (a player\'s), not bags:2:0 (theirs)');
      await run(`projectSetEquipped(${P(id)}, true); 1`);
      const ticked = (await calc(id)).raw[HAT];
      assert.equal(ticked.need, 1, 'the tick does not apply'); assert.equal(ticked.left, 1); assert.deepEqual(keys(ticked), keys(hat));
    });
    await test('a stack of two in bags is one theirs, one spare; wearing it makes every bag copy spare', async () => {
      await clean();
      await use({ chars: { 1: { worn: [HAT], bag: { [HAT]: 1 } }, 2: { bag: { [HAT]: 2 } }, 3: { worn: [HAT, HAT] } } });
      const hat = (await calc(await forTeam())).raw[HAT];
      assert.deepEqual(keys(hat), ['bags:1:0', 'bags:2:1']);
      assert.equal(hat.need, 0); assert.equal(hat.done, true);
    });
    await test('Use this copy: need and materials fall, unticking restores, never below nothing', async () => {
      await clean();
      await use({ chest: { [HAT]: 1 }, chars: { 2: {}, 3: {}, 4: { bag: { [HAT]: 1 } } } });
      const id = await forTeam([2, 3]);
      let c = await calc(id);
      assert.equal(c.raw[HAT].need, 2); assert.equal(c.raw.IronBar.need, 110); // 40 + 50 + 20
      assert.equal(await useCopy(id, 'storage::0'), true);
      c = await calc(id);
      assert.equal(c.raw[HAT].need, 1); assert.equal(c.raw[HAT].whoUsed, 1); assert.equal(c.raw.IronBar.need, 90); assert.equal(c.raw.Forest1.need, 50);
      await useCopy(id, 'bags:4:0');
      c = await calc(id);
      assert.equal(c.raw[HAT].need, 0); assert.equal(c.raw[HAT].done, false, 'still to hand over'); assert.deepEqual(c.raw[HAT].move, [{ slot: 2, n: 1 }, { slot: 3, n: 1 }]); assert.equal(c.raw.IronBar.need, 70); assert.equal(c.raw.Forest1, undefined, 'no materials for the hat');
      await useCopy(id, 'bags:4:0', false);
      c = await calc(id);
      assert.equal(c.raw[HAT].need, 1); assert.equal(c.raw.Forest1.need, 50);
      await useCopy(id, 'storage::0', false);
      assert.equal((await calc(id)).raw[HAT].need, 2);
      const one = await forTeam([3]);
      await useCopy(one, 'storage::0'); await useCopy(one, 'bags:4:0');
      c = await calc(one);
      assert.equal(c.raw[HAT].need, 0, 'two copies for one missing'); assert.equal(c.raw[HAT].whoUsed, 1);
    });
    await test('a used copy that has left the save stops counting, without an error', async () => {
      await clean();
      await use({ chest: { [HAT]: 1 }, chars: { 3: {} } });
      const id = await forTeam([3]);
      await useCopy(id, 'storage::0');
      assert.equal((await calc(id)).raw[HAT].need, 0);
      await use({ chars: { 3: {} } });
      const hat = (await calc(id)).raw[HAT];
      assert.equal(hat.need, 1); assert.equal(hat.whoUsed, 0); assert.deepEqual(hat.spares, []);
      await use({ chest: { [HAT]: 1 }, chars: { 3: {} } });
      assert.equal((await calc(id)).raw[HAT].need, 0, 'back, it counts again');
    });
    await test('what the save shows of a copy\'s upgrades', async () => {
      await clean();
      await use({ chest: { Blank: 1, [HAT]: 1 }, chestStats: { 1: { Defence: 5, AGI: 0, Upgrade_Slots_Left: -1, UQ1val: 3, UQ1txt: '%_LUK', UQ2val: 0 } }, chars: { 3: {}, 4: { bags: ['Copper', HAT], bagStats: { 1: { WIS: 2, Upgrade_Slots_Left: 2 } } }, 5: { worn: [HAT], wornStats: { 0: { Defence: 0, Upgrade_Slots_Left: 0 } } }, 6: { bag: { [HAT]: 1 } } } });
      const hat = (await calc(await forTeam([3]))).raw[HAT], of = key => hat.spares.find(x => x.key === key).upgrades;
      assert.deepEqual(of('storage::0'), ['+5 Defence', '+3% luk', '1 upgrade used']);
      assert.deepEqual(of('bags:4:0'), ['+2 WIS', '+2 upgrade slots']);
      assert.deepEqual(of('worn:5:0'), [], 'all zero is nothing');
      assert.deepEqual(of('bags:6:0'), [], 'no map at all is nothing');
    });
    await test('a plain count on top of the players: owned copies only go against that', async () => {
      await clean();
      await use({ chest: { [HAT]: 1 }, chars: { 3: {} } });
      const id = await fresh();
      await run(`projectAddItem(${P(id)}, ${J(HAT)}, 2); projectAddSet(${P(id)}, 'IRON_SET', { for: [3] }); 1`);
      assert.deepEqual(await run(`${P(id)}.targets.find(x => x.raw === ${J(HAT)})`), { raw: HAT, count: 2, for: [3] });
      let hat = (await calc(id)).raw[HAT];
      assert.equal(hat.need, 3); assert.equal(hat.have, 1); assert.equal(hat.left, 2); assert.equal(hat.extra, 2); // 1 for slot 3 + 2 extra, the storage copy fills an extra
      await useCopy(id, 'storage::0');
      hat = (await calc(id)).raw[HAT];
      assert.equal(hat.need, 2); assert.equal(hat.have, 0); assert.equal(hat.left, 2, 'the same copy can\'t do both');
      assert.equal(await run(`projectSetCount(${P(id)}, ${J(HAT)}, '0')`), true, 'an extra can go');
      assert.equal((await calc(id)).raw[HAT].need, 0);
      assert.equal(await run(`projectSetCount(${P(id)}, ${J(SHIRT)}, 'x')`), false);
    });
    await test('adding a set again merges players, and tools stay plain', async () => {
      await clean();
      await use({ chars: { 1: {}, 2: {}, 3: {} } });
      const id = await forTeam([1, 2]);
      await run(`projectAddSet(${P(id)}, 'IRON_SET', { for: [2, 3], tools: ['EquipmentTools3'] }); 1`);
      const list = await run(`${P(id)}.targets`);
      ALLSET.forEach(raw => assert.deepEqual(list.find(x => x.raw === raw), { raw, count: 0, for: [1, 2, 3] }));
      assert.equal(list.length, 3 + (await run(`PROJECT_SETS.find(s => s.name === 'IRON_SET').tools.includes('EquipmentTools3')`) ? 1 : 0));
      assert.equal(await run(`${P(id)}.nodes.filter(n => n.raw === ${J(HAT)}).length`), 1, 'still one box');
      assert.equal(await run(`projectSetRecipients(${P(id)}, ${J(HAT)}, [1])`), true);
      assert.equal((await calc(id)).raw[HAT].need, 1);
    });
    await test('everyone has everything: done, nothing below, and a task follows the requirement', async () => {
      await clean();
      await use({ chars: { 1: { worn: ALLSET }, 2: { bag: Object.fromEntries(ALLSET.map(x => [x, 1])) } } });
      let id = await forTeam([1, 2]), c = await calc(id);
      assert.equal(c.done, true); assert.equal(c.hours, 0); assert.deepEqual(Object.keys(c.raw).sort(), [...ALLSET].sort());
      assert.equal(c.raw[HAT].need, 0); assert.equal(c.raw[HAT].left, 0); assert.equal(c.raw[HAT].role, 'craft');
      await clean();
      await use({ chars: { 2: {}, 4: { bag: { [HAT]: 1 } } } });
      id = await forTeam([2]);
      const k = await run(`(() => { const t = tasks.find(x => x.type === 'craft' && x.raw === ${J(HAT)}); return { left: taskCalc(t).left, have: taskCalc(t).have, done: taskCalc(t).done }; })()`);
      assert.deepEqual(k, { left: 1, have: 0, done: false }, 'someone else\'s copy does not finish the craft task');
    });
    await test('a character not in the save, or a blank list, needs nothing, without an error', async () => {
      await clean();
      await use({ chars: { 3: {} } });
      const gone = await calc(await forTeam([99]));
      assert.equal(gone.raw[HAT].need, 0); assert.equal(gone.raw[HAT].who[0].state, null); assert.equal(gone.raw.IronBar, undefined);
      const blank = await calc(await forTeam([]));
      assert.equal(blank.order.length, 0);
      await run(`(() => { const p = projectCreate('Odd'); p.targets.push({ raw: ${J(HAT)}, count: 0, for: null }, { raw: ${J(SHIRT)}, count: 1, for: 'x', use: 'y' }); projectExpand(p); return projectCalc(p); })()`);
      assert.equal(await run(`projectCalc(projects[projects.length - 1]).order.some(id => projectCalc(projects[projects.length - 1]).nodes[id].raw === ${J(SHIRT)})`), true);
      await run(`saveForFinder = null; 1`);
      const none = (await calc(await forTeam([3]))).raw[HAT];
      assert.equal(none.needs, 'Waiting for game data'); assert.equal(none.done, false);
      await use({ chars: { 3: {} } });
    });
    await test('old-format targets: no players, the equipped tick and the whole stock as before', async () => {
      await clean();
      await use({ chest: { [HAT]: 1 }, chars: { 1: { worn: [HAT] }, 2: { bag: { [HAT]: 1 } } } });
      const id = await fresh();
      await add(id, HAT, 4);
      let hat = (await calc(id)).raw[HAT];
      assert.equal(hat.need, 4); assert.equal(hat.have, 2); assert.equal(hat.left, 2); assert.equal(hat.who, null); assert.deepEqual(hat.spares, []);
      assert.deepEqual(await run(`${P(id)}.targets[0]`), { raw: HAT, count: 4 });
      await run(`projectSetEquipped(${P(id)}, true); 1`);
      hat = (await calc(id)).raw[HAT];
      assert.equal(hat.have, 3); assert.equal(hat.left, 1);
    });
    await test('for and use come back through loading', async () => {
      await clean();
      await use({ chest: { [HAT]: 1 }, chars: { 3: {} } });
      const id = await forTeam([3]);
      await useCopy(id, 'storage::0');
      const back = await run(`cleanProjects(JSON.parse(JSON.stringify(projects)))[0].targets.find(x => x.raw === ${J(HAT)})`);
      assert.deepEqual(back, { raw: HAT, count: 0, for: [3], use: ['storage::0'] });
      await run(`(() => { const p = ${P(id)}; p.targets.forEach(x => { x.for = []; }); return 1; })()`);
      assert.equal(await run(`cleanProjects(JSON.parse(JSON.stringify(projects)))[0].targets.length`), 3, 'a blank list is kept, to tick again');
      await realSave(); await clean();
    });
    await test('the forge from the real save matches the table', async () => {
      assert.equal(await run(`forgeInfo('GodshardBar').speed`), 760); // (100 + 5*90 + 30*7) * 1, Godshard card rank 7, Menagerie[3][11] = 0
      const rates = async bar => run(`forgeInfo(${J(bar)}).slots.map(s => [s.index, s.brimstone, s.rate])`);
      const god = await rates('GodshardBar'); // slots 0, 4, 5, all under the 7 brimstone slots
      assert.deepEqual(god.map(s => s[0]), [0, 4, 5]);
      god.forEach(s => { assert.equal(s[1], true); near(s[2], 4.104, 'Godshard'); }); // 3600*7.6*1.5/10000
      const pre = await rates('PrehistriumBar');
      assert.deepEqual(pre.map(s => s[0]), [1, 2, 3, 6, 7, 8, 9, 10]);
      pre.slice(4).forEach(s => near(s[2], 1.824, 'plain Prehistrium')); // 3600*7.6/15000
      pre.slice(0, 4).forEach(s => near(s[2], 2.736, 'brimstone Prehistrium'));
      (await rates('DreadloBar')).forEach(s => near(s[2], 9.12, 'Dreadlo'));
      near((await rates('IronBar'))[0][2], 912, 'Iron');
      near((await rates('CopperBar'))[0][2], 1824, 'Copper');
      near(await run(`forgeInfo('GodshardBar').rate`), 3 * 4.104, 'slots of one ore add up');
      near(await run(`forgeInfo('IronBar').orePerHour`), 912 * 4, 'ore per hour');
      assert.equal(await run(`forgeInfo('MarbleBar').running`), false);
      assert.equal(await run(`forgeInfo('Copper')`), null);
    });
    await test('speed: forge level, menagerie, barrel and brimstone', async () => {
      await use({ lv: [16, 0, 10, 0, 0, 0], menagerie: 10, gems: 1, forge: [['Iron', 400], ['Iron', 400, 0, 'OilBarrel3', 5], ['Iron', 400, 0, 'OilBarrel3', 0]] });
      assert.equal(await run(`forgeInfo('IronBar').speed`), 165); // round((100 + 50) * 1.1)
      const r = await run(`forgeInfo('IronBar').slots.map(s => s.rate)`);
      near(r[0], 3600 * 1.65 * 1.5 / 30, 'brimstone'); near(r[1], 3600 * 1.65 * 1.3 / 30, 'Radioactive Waste, +30%'); near(r[2], 3600 * 1.65 / 30, 'an empty barrel adds nothing');
      await use({ lv: [1, 0, 0, 0, 0, 0], forge: [['Iron', 400], ['Iron', 400]] });
      assert.equal(await run(`forgeInfo('IronBar').slots.length`), 1, 'a slot not bought yet');
    });
    await test('ownedCount: bags, storage, forge, refinery, anvil, flurbos; equipped only when asked', async () => {
      const anvil = []; for (let j = 0; j < 14; j++) anvil.push([j === 2 ? 7 : 0, 0, 0, 0]);
      await use({ chest: { IronBar: 5, CraftMat6: 3, Refinery1: 2, EquipmentHats18: 1 }, bag: { IronBar: 2 }, worn: ['EquipmentHats18'], forge: [['Iron', 8, 11]], refinery: { Refinery1: 40, Blank: 9 }, anvil, flurbos: 900 });
      assert.equal(await run(`ownedCount(['IronBar'])`), 18); // 5 + 2 + 11 in the forge
      assert.equal(await run(`ownedCount(['Iron'])`), 8);
      assert.equal(await run(`ownedCount(['CraftMat6'])`), 10); // 3 + anvilProducts[2] = 7
      assert.equal(await run(`ownedCount(['Refinery1'])`), 42);
      assert.equal(await run(`ownedCount(['DungCredits2'])`), 900);
      assert.equal(await run(`ownedCount(['EquipmentHats18'])`), 1);
      assert.equal(await run(`ownedCount(['EquipmentHats18'], { equipped: true })`), 2);
      assert.equal(await run(`ownedCount(['IronBar'], { slot: 0 })`), 2);
      assert.deepEqual(await run(`ownedParts(['IronBar'])`), { bags: 2, storage: 5, equipped: 0, forge: 11, refinery: 0, anvil: 0, flurbos: 0 });
    });
    await test('a shared bar sums demand from every recipe, and takes off what\'s owned once', async () => {
      await clean();
      // Iron set: hat 20 bars, shirt 25, pants 10 = 55. Own 5 + 2 in the forge's bar slot = 7, so 48 to make = 192 ore. 30 chest + 20 in the forge = 50 held, so 142 more.
      await use({ chest: { IronBar: 5, Iron: 30 }, forge: [['Iron', 20, 2]] });
      const id = await fresh();
      assert.equal(await run(`projectAddSet(${P(id)}, 'IRON_SET')`), true);
      const c = await calc(id);
      assert.equal(await run(`${P(id)}.nodes.filter(n => n.raw === 'IronBar').length`), 1, 'one node per item');
      assert.equal(Object.keys(c.nodes).length, 8); // 3 pieces, IronBar, Iron, Forest1, JungleTree, CraftMat6
      const bar = c.raw.IronBar, ore = c.raw.Iron;
      assert.equal(bar.need, 55); assert.equal(bar.have, 7); assert.equal(bar.left, 48); assert.equal(bar.role, 'forge');
      assert.equal(bar.dependents.length, 3); assert.deepEqual(bar.inputs, [ore.id]);
      assert.equal(ore.need, 192); assert.equal(ore.have, 50); assert.equal(ore.left, 142); assert.equal(ore.role, 'gather');
      assert.equal(c.raw.Forest1.role, 'drop'); assert.equal(c.raw.JungleTree.role, 'gather'); assert.equal(c.raw.CraftMat6.role, 'count');
      assert.equal(c.raw.Forest1.makeTask, true); assert.equal(c.raw.CraftMat6.noRate, true); assert.equal(c.raw.EquipmentHats18.role, 'craft');
      assert.equal(await run(`tasks.find(t => t.key === 'forge|IronBar').slot`), null);
      assert.equal(await run(`tasks.find(t => t.key === 'forge|IronBar').amountExact`), 55);
    });
    await test('owning a mid-tier piece removes everything beneath it', async () => {
      await clean();
      // Platinum hat = 1 iron hat + 2250 fish + 750 plat bars. Iron hat = 20 iron bars + 50 Forest1.
      await use();
      const id = await fresh();
      await add(id, 'EquipmentHats19', 3);
      let c = await calc(id);
      assert.equal(c.raw.EquipmentHats18.need, 3); assert.equal(c.raw.IronBar.need, 60); assert.equal(c.raw.Iron.need, 240); assert.equal(c.raw.Forest1.need, 150); assert.equal(c.raw.Fish3.need, 6750);
      await use({ chest: { EquipmentHats18: 1 } });
      c = await calc(id);
      assert.equal(c.raw.EquipmentHats18.left, 2); assert.equal(c.raw.IronBar.need, 40); assert.equal(c.raw.Forest1.need, 100); assert.equal(c.raw.PlatBar.need, 2250, 'beside it, unchanged');
      await use({ chest: { EquipmentHats18: 3 } });
      c = await calc(id);
      assert.equal(c.raw.EquipmentHats18.done, true);
      ['IronBar', 'Iron', 'Forest1'].forEach(raw => assert.equal(c.raw[raw], undefined, raw + ' is gone'));
      assert.deepEqual(c.raw.EquipmentHats18.inputs, []);
      assert.equal(await run(`${P(id)}.nodes.some(n => n.raw === 'IronBar')`), true, 'and comes back if it\'s needed again');
      await use({ chest: { EquipmentHats19: 1, EquipmentHats18: 1 } }); // the finished piece counts first: 2 left, so 2 iron hats, 1 owned
      c = await calc(id);
      assert.equal(c.raw.EquipmentHats19.left, 2); assert.equal(c.raw.Fish3.need, 4500); assert.equal(c.raw.EquipmentHats18.left, 1); assert.equal(c.raw.IronBar.need, 20);
    });
    await test('the equipped tick counts gear being worn', async () => {
      await clean();
      await use({ worn: ['EquipmentHats18'] });
      const id = await fresh();
      await add(id, 'EquipmentHats18');
      assert.equal((await calc(id)).raw.EquipmentHats18.done, false);
      await run(`projectSetEquipped(${P(id)}, true); 1`);
      const c = await calc(id);
      assert.equal(c.raw.EquipmentHats18.done, true); assert.equal(c.raw.IronBar, undefined); assert.equal(c.done, true); assert.equal(c.hours, 0);
    });
    await test('long chains: depth and demand go all the way down', async () => {
      await clean();
      await use();
      await run(`for (let i = 0; i < 40; i++) PROJECT_RECIPES['Z' + i] = [{ raw: 'Z' + (i + 1), qty: i < 5 ? 2 : 1 }]; 1`); // Z0..Z39, each made from the next
      const id = await fresh();
      await add(id, 'Z0');
      let c = await calc(id);
      assert.equal(c.raw.Z0.depth, 0); assert.equal(c.raw.Z40.depth, 40); assert.equal(c.raw.Z40.need, 32); assert.equal(c.order.length, 41);
      assert.equal(c.order[0], c.raw.Z40.id, 'inputs come first');
      await run(`for (let i = 0; i < 40; i++) delete PROJECT_RECIPES['Z' + i]; 1`);
      await clean();
      // the deepest real recipe, 12 levels of recipes: worked out separately here
      const depth = raw => recipes[raw] ? 1 + Math.max(...recipes[raw].mats.map(m => depth(m.raw))) : /Bar$/.test(raw) ? 1 : 0;
      const id2 = await fresh();
      await add(id2, 'EquipmentBows15');
      c = await calc(id2);
      assert.equal(Math.max(...Object.values(c.nodes).map(n => n.depth)), depth('EquipmentBows15'));
      assert.ok(depth('EquipmentBows15') >= 12);
    });
    await test('ore running out caps the ETA', async () => {
      await clean();
      // Speed 100%, so an Iron slot makes 120 bars an hour. 40 ore = 10 cycles = 5 minutes.
      await use({ forge: [['Iron', 40]] });
      const eta = (left, now = T0) => run(`forgeEta('IronBar', ${left}, ${now})`);
      near((await eta(6)).hours, 6 / 120, '6 bars');
      near((await eta(10)).hours, 10 / 120, 'the last bar there is ore for');
      const over = await eta(11);
      assert.equal(over.hours, null); assert.equal(over.capped, true); assert.ok(/runs out of ore after 10 more bars/.test(over.needs), over.needs);
      assert.equal(over.runsOutMs, T0 + 10 / 120 * 36e5);
      assert.equal(over.note, 'does not consider extra bar chance');
      // Two slots at 120/h: one has 2 cycles, the other 100. Both run until 4 bars at 1/60 h, then one alone: 6 more at 120/h.
      await use({ forge: [['Iron', 8], ['Iron', 400]] });
      near((await eta(10)).hours, 1 / 60 + 6 / 120, 'a slot stops, the other goes on');
      // Less ore than a cycle: stopped.
      await use({ forge: [['Iron', 3]] });
      const none = await eta(1);
      assert.equal(none.hours, null); assert.equal(none.needs, 'Nothing is forging this bar');
      assert.equal(await run(`forgeInfo('IronBar').oreInForge`), 3);
      // Half way through a cycle already.
      await use({ forge: [['Iron', 40, 0, 'Blank', 0, 15]] });
      near((await eta(1)).hours, 0.5 / 120, 'progress counts');
      // Timed from the save: 2 minutes on, of 6/120 h = 3 minutes, 1 minute and 2 bars are left... but the first half cycle is gone.
      await use({ forge: [['Iron', 40]] });
      const later = await eta(6, T0 + 2 * 6e4);
      near(later.hours, 1 / 60, 'anchored to the save'); near(later.left, 2, 'bars left now');
      assert.equal((await eta(6, T0 + 4 * 6e4)).done, true);
      // Slots refill from storage. 80 ore stored + 40 in the slot = 30 cycles, at 120/h = 15 minutes.
      const chest = await run(`[saveForFinder.data.ChestOrder, saveForFinder.data.ChestQuantity]`);
      await use({ forge: [['Iron', 40]] });
      await run(`(d => { const o = typeof d.ChestOrder === 'string' ? JSON.parse(d.ChestOrder) : d.ChestOrder, q = typeof d.ChestQuantity === 'string' ? JSON.parse(d.ChestQuantity) : d.ChestQuantity; const i = o.indexOf('Iron'); if (i >= 0) q[i] = 80; else { o.push('Iron'); q.push(80); } d.ChestOrder = JSON.stringify(o); d.ChestQuantity = JSON.stringify(q); facts = null; 1; })(saveForFinder.data)`);
      near((await eta(25)).hours, 25 / 120, 'past what the slot alone holds');
      const refilled = await eta(31);
      assert.equal(refilled.hours, null); assert.ok(/Forge and storage run out of ore after 30 more bars/.test(refilled.needs), refilled.needs);
      assert.equal(refilled.runsOutMs, T0 + 30 / 120 * 36e5);
      // A slot short of a cycle still runs while storage holds ore.
      await use({ forge: [['Iron', 3]] });
      await run(`(d => { const o = typeof d.ChestOrder === 'string' ? JSON.parse(d.ChestOrder) : d.ChestOrder, q = typeof d.ChestQuantity === 'string' ? JSON.parse(d.ChestQuantity) : d.ChestQuantity; const i = o.indexOf('Iron'); if (i >= 0) q[i] = 80; else { o.push('Iron'); q.push(80); } d.ChestOrder = JSON.stringify(o); d.ChestQuantity = JSON.stringify(q); facts = null; 1; })(saveForFinder.data)`);
      near((await eta(10)).hours, 10 / 120, 'refilled');
      await run(`(d => { d.ChestOrder = ${JSON.stringify(chest[0])}; d.ChestQuantity = ${JSON.stringify(chest[1])}; facts = null; 1; })(saveForFinder.data)`);
      await use({ forge: [['Iron', 40]] });
      // In a project: a capped forge stops the whole ETA, and says why.
      const id = await fresh();
      await add(id, 'IronBar', 20);
      const c = await calc(id);
      assert.equal(c.raw.IronBar.hours, null); assert.equal(c.raw.IronBar.capped, true); assert.equal(c.hours, null); assert.ok(c.bottleneck.includes(c.raw.IronBar.id));
      assert.equal(c.forgeNote, 'does not consider extra bar chance');
      assert.equal(c.raw.IronBar.note, 'does not consider extra bar chance');
    });
    await test('needs: parallel; after: sequential', async () => {
      await clean();
      await use();
      const id = await fresh(), a = await timed(id, 'A', 10, 5), b = await timed(id, 'B', 30, 10), c = await timed(id, 'C', 4, 4); // 2 h, 3 h, 1 h
      assert.equal((await edge(id, a, c, 'needs')).ok, true);
      let k = await calc(id);
      near(k.nodes[c].hours, 2, 'max(own 1, input 2)'); near(k.hours, 3, 'B is on its own'); assert.deepEqual(k.nodes[c].inputs, [a]); assert.deepEqual(k.nodes[a].dependents, [c]);
      near(k.etaMs, T0 + 3 * 36e5, 'project ETA');
      assert.equal((await run(`projectSetEdgeKind(${P(id)}, ${J(a)}, ${J(c)}, 'after')`)).ok, true);
      k = await calc(id);
      near(k.nodes[c].hours, 3, 'input 2 + own 1');
      assert.equal((await edge(id, b, c, 'needs')).ok, true);
      k = await calc(id);
      near(k.nodes[c].hours, 3, 'max(2 + 1, 3)');
      await run(`tasks.find(t => t.id === ${P(id)}.nodes.find(n => n.id === ${J(b)}).taskId).amount = '50'; 1`); // B now 5 h
      k = await calc(id);
      near(k.nodes[c].hours, 5, 'max(2 + 1, 5)');
      assert.deepEqual(await run(`projectRemoveEdge(${P(id)}, ${J(b)}, ${J(c)})`), { ok: true });
      assert.equal((await edge(id, b, c)).edge.kind, 'after', 'a hand-added edge defaults to after');
      k = await calc(id);
      near(k.nodes[c].hours, 6, 'max(2, 5) + 1');
    });
    await test('a cycle is refused', async () => {
      await clean();
      await use();
      const id = await fresh(), a = await timed(id, 'A', 1, 1), b = await timed(id, 'B', 1, 1), c = await timed(id, 'C', 1, 1);
      await edge(id, a, b); await edge(id, b, c);
      assert.deepEqual(await edge(id, c, a), { ok: false, reason: 'cycle' });
      assert.deepEqual(await edge(id, a, a), { ok: false, reason: 'cycle' });
      assert.equal(await run(`${P(id)}.edges.length`), 2);
      await add(id, 'EquipmentHats18');
      const k = await calc(id), hat = k.raw.EquipmentHats18.id, bar = k.raw.IronBar.id;
      assert.deepEqual(await edge(id, hat, bar), { ok: false, reason: 'cycle' }, 'through a recipe too');
      assert.deepEqual(await run(`projectRemoveEdge(${P(id)}, ${J(bar)}, ${J(hat)})`), { ok: false, reason: 'recipe' });
      assert.deepEqual(await run(`projectSetEdgeKind(${P(id)}, ${J(bar)}, ${J(hat)}, 'after')`), { ok: false, reason: 'recipe' });
      assert.equal(await run(`projectRemoveItem(${P(id)}, 'EquipmentHats18')`), true);
      assert.equal((await calc(id)).raw.IronBar, undefined, 'its nodes go with the item');
      // a hand edge that a recipe would close into a loop is dropped: Q2 waits on Q1 by hand, then Q1 turns out to be made from Q2
      await add(id, 'Q1'); await add(id, 'Q2');
      const q = await calc(id);
      assert.equal((await edge(id, q.raw.Q1.id, q.raw.Q2.id, 'after')).ok, true);
      await run(`PROJECT_RECIPES.Q1 = [{ raw: 'Q2', qty: 3 }]; projectExpand(${P(id)}); 1`);
      const made = await run(`${P(id)}.edges.filter(e => e.from === ${J(q.raw.Q1.id)} || e.to === ${J(q.raw.Q1.id)})`);
      await run(`delete PROJECT_RECIPES.Q1; 1`);
      assert.deepEqual(made, [{ from: q.raw.Q2.id, to: q.raw.Q1.id, kind: 'needs', qty: 3, auto: true }]);
    });
    await test('any task type can be a node, and two nodes never make one task', async () => {
      await clean();
      await realSave();
      const id = await fresh(), now = Date.now();
      const made = await run(`(() => {
        const key = 'FIGHTING|Testmob', out = {};
        const clear = upsertTask({ slot: 1, type: 'clear', activityKey: key, match: { kind: 'activity', key }, test: true }); statSet(clear, 'kph', '50'); clear.left = '100';
        const exp = upsertTask({ slot: 1, type: 'exp', activityKey: 'Laboratory|Test', match: { kind: 'activity', key: 'Laboratory|Test' }, test: true }); statSet(exp, 'xph', '10'); exp.left = '40';
        const skill = upsertTask({ slot: 1, type: 'skill', skill: 3, activityKey: 'Testing|X', match: { kind: 'activity', key: 'Testing|X' }, goal: '400', test: true });
        const cls = upsertTask({ slot: 1, type: 'class', match: { kind: 'fighting' }, goal: '9999', test: true });
        const card = upsertTask({ slot: 1, type: 'card', monster: 'mushG', activityKey: key, match: { kind: 'activity', key }, source: 'monster', test: true });
        const item = upsertTask({ slot: 1, type: 'item', itemName: 'Spore Cap', source: 'direct', chance: null, amount: '999999999', perHour: '1000', match: null, test: true });
        const forge = forgeTask('IronBar'), p = ${P(id)};
        for (const t of [clear, exp, skill, cls, card, item, forge]) out[t.type] = projectAddTask(p, t.id).id;
        out.again = projectAddTask(p, clear.id).id;
        return out;
      })()`);
      assert.equal(made.again, made.clear, 'one node per task');
      const c = await calc(id, now);
      assert.equal(Object.keys(c.nodes).length, 7);
      near(c.nodes[made.clear].hours, 2, 'clear: 100 kills at 50/h');
      near(c.nodes[made.exp].hours, 4, 'exp: 40 at 10/h');
      for (const type of ['skill', 'class', 'card', 'item', 'forge']) {
        const want = await run(`(k => [k.hours, k.done])(taskCalc(tasks.find(t => t.id === ${J(c.nodes[made[type]].taskId)}), ${now}))`);
        assert.deepEqual([c.nodes[made[type]].ownHours, c.nodes[made[type]].done], [want[1] ? 0 : want[0], want[1]], type);
      }
      assert.equal(c.nodes[made.clear].role, 'task');
      assert.equal(c.nodes[made.clear].kind, 'clear');
      assert.equal(await edge(id, made.clear, made.skill).then(e => e.ok), true);
      // a hand-added forge task is the same node an item's bar would use
      await add(id, 'IronBar', 5);
      assert.equal(await run(`${P(id)}.nodes.filter(n => n.taskId === tasks.find(t => t.key === 'forge|IronBar').id).length`), 1);
    });
    await test('drop item: Make task for the account, with team rates and kills per kill', async () => {
      await clean();
      await use();
      const id = await fresh();
      await add(id, 'EquipmentHats18');
      let c = await calc(id);
      const node = c.raw.Forest1.id;
      assert.equal(c.raw.Forest1.needs, 'Make a task'); assert.equal(c.raw.Forest1.need, 50); assert.equal(c.raw.Forest1.hours, null);
      const options = await run(`dropOptions('Forest1')`);
      assert.ok(options.length >= 1 && options[0].chance > 0 && options[0].name);
      const t = await run(`projectMakeTask(${P(id)}, ${J(node)}, { monster: ${J(options[0].monster)} })`);
      assert.equal(t.slot, null); assert.equal(t.amount, '50'); assert.equal(t.amountExact, 50); assert.equal(t.monster, options[0].monster); assert.equal(t.starred, true); assert.equal(t.key, 'item|' + (await run(`itemName('Forest1')`)));
      c = await calc(id);
      assert.equal(c.raw.Forest1.makeTask, false); assert.match(c.raw.Forest1.needs, /^No one is on /);
      // 1000 kills/h, kills per kill 2 = 500 real kills, x chance x drop rate 2
      await run(`(() => { const r = rows.find(x => x.slot === 1), m = GAME.monsters[${J(options[0].monster)}]; r.monster = ${J(options[0].monster)}; r.kind = 'kills'; r.activity = 'FIGHTING'; r.activityKey = m[1] + '|' + m[0]; const a = { slot: 1, activityKey: r.activityKey, source: 'monster' }; statSet(a, 'kph', '1000'); statSet(a, 'dr', '2'); statSet(a, 'kpkTotal', '2'); })(); 1`);
      c = await calc(id);
      const rate = 500 * options[0].chance * 2, counted = await run(`taskRate(tasks.find(x => x.id === ${J(t.id)})).team.counted`);
      assert.equal(counted, 1, 'nobody else on it in this save');
      near(c.raw.Forest1.rate, rate, 'rate'); near(c.raw.Forest1.ownHours, 50 / rate, 'time');
      // the requirement moves the amount it filled in, not a typed one
      await run(`projectSetCount(${P(id)}, 'EquipmentHats18', 2); 1`);
      assert.equal(await run(`tasks.find(x => x.id === ${J(t.id)}).amountExact`), 100);
      near(await run(`taskCalc(tasks.find(x => x.id === ${J(t.id)}), ${T0}).target`), 100, 'the task itself');
      await run(`taskEdit(tasks.find(x => x.id === ${J(t.id)}), 'amount', '77'); projectSetCount(${P(id)}, 'EquipmentHats18', 3); 1`);
      assert.equal(await run(`tasks.find(x => x.id === ${J(t.id)}).amount`), '77');
      assert.equal(await run(`taskCalc(tasks.find(x => x.id === ${J(t.id)}), ${T0}).target`), 77);
      assert.equal((await calc(id)).raw.Forest1.need, 150, 'the node still follows the recipe');
      assert.deepEqual(await run(`(t => [t.id, t.key])(projectMakeTask(${P(id)}, ${J(node)}, {}))`), [t.id, t.key], 'one per item');
      await run(`deleteTask(${J(t.id)}); 1`);
      assert.equal((await calc(id)).raw.Forest1.makeTask, true, 'back to the button if it\'s deleted');
    });
    await test('skill-gathered and count-only nodes take a typed rate', async () => {
      await clean();
      await use({ chest: { JungleTree: 15 } });
      const id = await fresh();
      await add(id, 'EquipmentShirts12'); // 60 JungleTree, 25 IronBar
      let c = await calc(id);
      const node = c.raw.JungleTree.id;
      assert.equal(c.raw.JungleTree.needs, 'Enter amount / hour'); assert.equal(c.raw.JungleTree.left, 45);
      const t = await run(`projectNodeTask(projectNode(${P(id)}, ${J(node)}))`);
      assert.equal(t.slot, null); assert.equal(t.source, 'direct'); assert.equal(t.type, 'item'); assert.equal(t.projectMade, true);
      assert.equal(await run(`projectSetRate(${P(id)}, ${J(node)}, '15')`), true);
      near((await calc(id)).raw.JungleTree.ownHours, 3, '45 at 15/h');
      assert.equal(await run(`projectRateText(projectNode(${P(id)}, ${J(node)}))`), '15');
      await add(id, 'EquipmentPants3'); // 50 CraftMat6, from the anvil
      c = await calc(id);
      const mat = c.raw.CraftMat6;
      assert.equal(mat.role, 'count'); assert.equal(mat.noRate, true); assert.equal(mat.needs, 'No rate'); assert.equal(mat.kind, 'anvil'); assert.equal(mat.hours, null);
      await run(`projectSetRate(${P(id)}, ${J(mat.id)}, '10'); 1`);
      c = await calc(id);
      assert.equal(c.raw.CraftMat6.noRate, false); near(c.raw.CraftMat6.ownHours, 5, '50 at 10/h');
    });
    await test('a player gets the weapon of their class, and only that one', async () => {
      const got = await run(`(() => {
        const set = PROJECT_SETS.find(s => s.name === 'PREHISTORIC_SET'), by = i => classWeapon(set, { classIndex: i });
        const lines = { beginner: by(4), warrior: by(14), guardian: by(16), archer: by(22), walker: by(29), mage: by(34), cultist: by(40), none: by(50) };
        const r = rows.find(x => x.slot != null && x.classIndex >= 19 && x.classIndex <= 30);
        const p = projectCreate('Weapons ' + Date.now());
        projectAddSet(p, 'PREHISTORIC_SET', { for: [r.slot], classWeapons: true });
        const targets = p.targets.filter(t => set.weapons.includes(t.raw)).map(t => [t.raw, t.for]);
        projectAddSet(p, 'PREHISTORIC_SET', { for: [r.slot], classWeapons: true });
        const again = p.targets.filter(t => set.weapons.includes(t.raw)).length;
        const off = projectCreate('No weapons ' + Date.now());
        projectAddSet(off, 'PREHISTORIC_SET', { for: [r.slot] });
        const out = { lines, targets, slot: r.slot, again, offCount: off.targets.filter(t => set.weapons.includes(t.raw)).length, fits: [itemFitsPlayer('EquipmentBows15', { classIndex: 22 }), itemFitsPlayer('EquipmentWands14', { classIndex: 22 }), itemFitsPlayer('EquipmentHats123', { classIndex: 22 })], gold: classWeapon(PROJECT_SETS.find(s => s.name === 'GOLD_SET'), { classIndex: 14 }) };
        projectDelete(p.id); projectDelete(off.id);
        return out;
      })()`);
      assert.deepEqual(got.lines, { beginner: 'EquipmentPunching12', warrior: 'EquipmentSword10', guardian: 'EquipmentSword10', archer: 'EquipmentBows15', walker: 'EquipmentBows15', mage: 'EquipmentWands14', cultist: 'EquipmentWands14', none: null });
      assert.deepEqual(got.targets, [['EquipmentBows15', [got.slot]]]);
      assert.equal(got.again, 1, 'adding again merges');
      assert.equal(got.offCount, 0, 'only when asked');
      assert.deepEqual(got.fits, [true, false, true]);
      assert.equal(got.gold, 'TestObj3', 'an early spear goes by a different name');
    });
    await test('a whole armor set; tools and weapons only when picked', async () => {
      await clean();
      await use();
      const id = await fresh(), set = await run(`PROJECT_SETS.find(s => s.name === 'GOLD_SET')`);
      assert.equal(await run(`projectAddSet(${P(id)}, 'NOPE')`), false);
      await run(`projectAddSet(${P(id)}, 'GOLD_SET', { tools: ${J([set.tools[0], 'NotOfThisSet'])}, weapons: ${J([set.weapons[1]])} }); 1`);
      assert.deepEqual((await run(`${P(id)}.targets.map(x => x.raw)`)).sort(), [...set.armors, set.tools[0], set.weapons[1]].sort());
    });
    await test('bottleneck path', async () => {
      await clean();
      await use();
      const id = await fresh(), a = await timed(id, 'A', 10, 5), b = await timed(id, 'B', 30, 10), c = await timed(id, 'C', 4, 4); // 2 h, 3 h, 1 h
      await edge(id, a, c, 'needs'); await edge(id, b, c, 'needs');
      assert.deepEqual((await calc(id)).bottleneck, [c, b], 'B is the slower material');
      await run(`tasks.find(t => t.id === ${P(id)}.nodes.find(n => n.id === ${J(c)}).taskId).amount = '20'; 1`); // C now 5 h
      assert.deepEqual((await calc(id)).bottleneck, [c], 'its own time decides');
      await run(`tasks.find(t => t.id === ${P(id)}.nodes.find(n => n.id === ${J(c)}).taskId).amount = '4'; projectSetEdgeKind(${P(id)}, ${J(a)}, ${J(c)}, 'after'); 1`);
      let k = await calc(id); // C: max(2 + 1, 3) = 3, a tie: 'after' takes it, since needs doesn't beat it
      near(k.hours, 3); assert.deepEqual(k.bottleneck, [c, a]);
      await run(`projectRemoveEdge(${P(id)}, ${J(b)}, ${J(c)}); 1`); await edge(id, a, b); await edge(id, b, c); await run(`projectRemoveEdge(${P(id)}, ${J(a)}, ${J(c)}); 1`);
      k = await calc(id); // A 2, then B 3, then C 1
      near(k.hours, 6); assert.deepEqual(k.bottleneck, [c, b, a]);
      const x = await run(`projectNewTask(${P(id)}, { slot: null, type: 'item', itemName: 'X', source: 'direct', chance: null, match: null, amount: '5', test: true }).id`);
      await edge(id, x, a);
      k = await calc(id); // X has no rate, so nothing after it has an ETA
      assert.equal(k.hours, null); assert.equal(k.etaMs, null); assert.deepEqual(k.bottleneck, [c, b, a, x]); assert.deepEqual(k.blocked, [x]);
      assert.equal(k.nodes[x].needs, 'Enter amount / hour'); assert.equal(k.nodes[a].needs, 'Waiting on Collect 5 X');
      assert.deepEqual((await run(`(p => { const e = projectCalc(p, ${T0}); return e.done; })(${P(id)})`)), false);
    });
    await test('a task shared by two projects', async () => {
      await clean();
      await use({ forge: [['Iron', 4000]] });
      const one = await fresh('One'), two = await fresh('Two');
      await add(one, 'IronBar', 10); await add(two, 'IronBar', 30);
      const t1 = (await calc(one)).raw.IronBar, t2 = (await calc(two)).raw.IronBar;
      assert.equal(t1.taskId, t2.taskId, 'one forge task');
      near(t1.hours, 10 / 120, 'each project times its own need'); near(t2.hours, 30 / 120);
      assert.equal(await run(`projectsOfTask(${J(t1.taskId)}).length`), 2);
      assert.equal(await run(`tasks.find(t => t.id === ${J(t1.taskId)}).amountExact`), 30, 'its amount is the larger need');
      const removed = await run(`window.__gone = projectDelete(${J(two)}); window.__gone.tasks.length`);
      assert.equal(removed, 0, 'the other project still uses it');
      assert.equal(await run(`tasks.some(t => t.id === ${J(t1.taskId)})`), true);
      const last = await run(`window.__gone2 = projectDelete(${J(one)}); window.__gone2.tasks.length`);
      assert.equal(last, 2, 'its forge and ore tasks go with the last project');
      assert.equal(await run(`tasks.some(t => t.id === ${J(t1.taskId)})`), false);
      await run(`projectRestore(window.__gone2); projectRestore(window.__gone); 1`);
      assert.equal(await run(`projects.length`), 2);
      assert.equal(await run(`tasks.filter(t => t.key === 'forge|IronBar').length`), 1);
      assert.equal(await run(`tasks.find(t => t.key === 'forge|IronBar').id`), t1.taskId);
      await run(`window.__starred = tasks.find(t => t.key === 'forge|IronBar'); toggleStar(window.__starred); delete window.__starred; projectDelete(${J(two)}); projectDelete(${J(one)}); 1`);
      assert.equal(await run(`tasks.some(t => t.key === 'forge|IronBar')`), true, 'a starred one stays');
    });
    await test('deleting a task used by a project', async () => {
      await clean();
      await use({ forge: [['Iron', 4000]] });
      const id = await fresh(), a = await timed(id, 'A', 10, 5), b = await timed(id, 'B', 1, 1);
      await edge(id, a, b);
      const task = (await calc(id)).nodes[a].taskId;
      await run(`window.__removed = deleteTask(${J(task)}); 1`);
      let k = await calc(id);
      assert.equal(k.nodes[a].missing, true); assert.equal(k.nodes[a].needs, 'Task deleted'); assert.equal(k.nodes[a].title, 'Deleted task'); assert.equal(k.hours, null); assert.equal(k.nodes[b].hours, null);
      await run(`restoreTask(window.__removed); 1`);
      near((await calc(id)).nodes[b].hours, 3, 'Undo brings it back: 2 + 1');
      await run(`deleteTask(${J(task)}); 1`);
      assert.deepEqual(await run(`projectRemoveNode(${P(id)}, ${J(a)})`), { ok: true });
      assert.equal(await run(`${P(id)}.edges.length`), 0);
      near((await calc(id)).hours, 1, 'the rest goes on');
      // a generated node's task comes back by itself
      await add(id, 'IronBar', 5);
      const n = (await calc(id)).raw.IronBar;
      assert.deepEqual(await run(`projectRemoveNode(${P(id)}, ${J(n.id)})`), { ok: false, reason: 'recipe' });
      await run(`deleteTask(${J(n.taskId)}); syncTasks(); 1`);
      const again = (await calc(id)).raw.IronBar;
      assert.notEqual(again.taskId, n.taskId);
      assert.equal(await run(`tasks.find(t => t.id === ${J(again.taskId)}).key`), 'forge|IronBar');
    });
    await test('a forge task has no row, and panel, planner and Simulate cope', async () => {
      await clean();
      await realSave();
      const id = await run(`forgeTask('IronBar').id`);
      assert.equal(await run(`rowOfTask(tasks.find(t => t.id === ${J(id)}))`), null);
      await run(`rows.push(migrateRow({ id: 'hand1', name: 'Typed', slot: null })); 1`); // a hand-typed row isn't the task's row
      assert.equal(await run(`rowOfTask(tasks.find(t => t.id === ${J(id)}))`), null);
      assert.equal(await run(`taskSection(tasks.find(t => t.id === ${J(id)}))`), 'active', 'a slot is running that ore');
      await run(`rows.pop(); 1`);
      assert.equal(await run(`tasks.find(t => t.id === ${J(id)}).slot`), null);
      assert.equal(await run(`taskTitle(tasks.find(t => t.id === ${J(id)}))`), 'Forge Iron Bar');
      assert.equal(await run(`taskIconName(tasks.find(t => t.id === ${J(id)}))`), 'IronBar');
      await run(`taskEdit(tasks.find(t => t.id === ${J(id)}), 'amount', '999999999'); render(); 1`); // have 52M bars and rate 912/h; this many bars is already owned
      await run(`tasks.find(t => t.id === ${J(id)}).amount = '1b'; tasks.find(t => t.id === ${J(id)}).starred = true; render(); 1`); // starred, or with no one played it folds under More
      const k = await run(`taskCalc(tasks.find(t => t.id === ${J(id)}))`);
      assert.equal(k.active, true); assert.equal(k.rate, 912); assert.equal(k.note, 'does not consider extra bar chance');
      assert.equal(k.hours, null, 'only ore for 7.68M bars'); assert.ok(/runs? out of ore/.test(k.needs), k.needs);
      const card = `.pc[data-id="${id}"]`;
      await sleep(50);
      assert.equal(await run(`document.querySelector(${J(card + ' .pc-port')}).children.length`), 0, 'no player icon');
      assert.ok((await run(`document.querySelector(${J(card + ' .pc-main')}).title`)).includes('does not consider extra bar chance'), 'hover says it');
      assert.equal(await run(`document.querySelector(${J(card)}).parentNode === panelParts.active`), true);
      await h.click(card + ' .pc-main');
      assert.equal(await run(`$('viewProjects').hidden`), false, 'its card opens the project tab');
      assert.equal(await run(`$('tabProjects').getAttribute('aria-selected')`), 'true');
      assert.equal(await run(`projectFocus === null && (pjLooseId || (pjProject() && projectNode(pjProject(), pjNodeId) || {}).taskId)`), id); // the Projects tab used it
      await run(`renderPlanner(); paintPlanner(Date.now()); showTab('planner'); render(); 1`);
      await run(`simulateTask(${J(id)}); 1`);
      await sleep(50);
      const list = await run(`[...$('simPick').options].map(o => o.textContent)`);
      assert.ok(list.some(x => x.startsWith('Account · Forge')), 'in the Simulate list');
      assert.ok((await run(`document.querySelector('#simEditor .ed-line').textContent`)).includes('does not consider extra bar chance'), 'the editor says it');
      assert.equal(await run(`document.querySelector('#simEditor [data-field="amount"]') != null`), true);
      await run(`simDraft = { amount: '60000000' }; paintAll(); 1`);
      await h.click('#simGo');
      assert.equal(await run(`tasks.find(t => t.id === ${J(id)}).amount`), '60000000');
      assert.equal(await run(`tasks.find(t => t.id === ${J(id)}).slot`), null);
      await run(`showTab('planner'); simPick(''); render(); 1`);
      // a craft task has no time of its own, and no card until it's starred
      const pid = await fresh();
      await add(pid, 'EquipmentHats18');
      const craft = await run(`tasks.find(t => t.key === 'craft|EquipmentHats18|' + ${J(pid)}).id`);
      await run(`render(); 1`);
      assert.equal(await run(`document.querySelector('.pc[data-id="${craft}"]') == null && taskSection(tasks.find(t => t.id === ${J(craft)}))`), 'archive');
      assert.ok(!(await run(`[...$('simPick').options].map(o => o.value)`)).includes(craft), 'nothing to simulate');
      const made = await run(`taskCalc(tasks.find(t => t.id === ${J(craft)}))`);
      assert.equal(made.target, 1); assert.equal(made.rate, 0);
      await run(`toggleStar(tasks.find(t => t.id === ${J(craft)})); render(); 1`);
      assert.equal(await run(`document.querySelector('.pc[data-id="${craft}"]') != null`), true);
      await run(`projectDelete(${J(pid)}); render(); 1`);
      assert.deepEqual(await h.pageErrors(), []);
    });
    await test('recomputes as saves arrive, through the real sync', async () => {
      await clean();
      await realSave();
      await run(`window.__real = null; 1`);
      const id = await fresh(), chest = () => JSON.parse(JSON.stringify(typeof h.save.ChestOrder === 'string' ? JSON.parse(h.save.ChestOrder) : h.save.ChestOrder));
      await run(`projectAddItem(${P(id)}, 'EquipmentHats19', 1); queueSave(); 1`);
      let c = await calc(id, Date.now());
      assert.ok(c.raw.IronBar, 'the mid-tier hat isn\'t owned yet'); // real save: hat 18 in nobody's bags
      const hadHat = await run(`ownedCount(['EquipmentHats18'])`);
      assert.equal(hadHat, 0, 'test data has moved on, this test wants an unowned hat');
      assert.equal(c.raw.EquipmentHats18.need, 1);
      await h.bump(d => {
        const order = chest(), qty = typeof d.ChestQuantity === 'string' ? JSON.parse(d.ChestQuantity) : d.ChestQuantity;
        d.ChestOrder = [...order, 'EquipmentHats18']; d.ChestQuantity = [...qty, 1];
        const q = typeof d.ForgeItemQty === 'string' ? JSON.parse(d.ForgeItemQty) : d.ForgeItemQty;
        d.ForgeItemQty = q.map((v, i) => i === 44 ? 7 : v); // slot 14's Iron bars
      });
      assert.equal(await run(`ownedCount(['EquipmentHats18'])`), 1);
      assert.equal(await run(`forgeInfo('IronBar').barsInForge`), 7);
      c = await calc(id, Date.now());
      assert.equal(c.raw.EquipmentHats18.done, true); assert.equal(c.raw.IronBar, undefined);
      assert.ok(c.raw.PlatBar.need === 750);
      assert.equal(await run(`${P(id)}.targets.length`), 1);
    });
    await test('kept through a reload, without losing tasks or rates', async () => {
      await run(`rates['1|Test|x'] = { kph: '123' }; 1`);
      const id = await fresh('Keep me'), a = await timed(id, 'A', 10, 5), b = await timed(id, 'B', 30, 10);
      await edge(id, a, b, 'needs');
      await add(id, 'EquipmentHats19', 2);
      await run(`queueSave(); 1`);
      const before = await run(`({ tasks: tasks.length, rates: Object.keys(rates).length, project: ${P(id)}, version: tasksVersion })`);
      const sheet = await h.savedSheet();
      assert.ok(sheet.projects.some(p => p.id === id && p.name === 'Keep me'));
      assert.equal(sheet.tasks.length, before.tasks);
      await h.reload();
      const after = await run(`({ tasks: tasks.length, rates: Object.keys(rates).length, project: ${P(id)}, version: tasksVersion })`);
      assert.equal(JSON.stringify(after.project), JSON.stringify(before.project)); assert.deepEqual([after.tasks, after.rates, after.version], [before.tasks, before.rates, before.version]);
      assert.equal(await run(`rates['1|Test|x'].kph`), '123');
      near((await calc(id, Date.now())).nodes[b].ownHours, 3, 'still works');
      // a save from before projects keeps what's held, and a sheet with none starts empty
      assert.equal(await run(`(s => { delete s.projects; setState(s); return projects.length > 0; })(JSON.parse(JSON.stringify(stateNow())))`), true);
      assert.equal(await run(`(s => { s.projects = [{ id: 'bad', nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ from: 'a', to: 'b', kind: 'after' }, { from: 'b', to: 'a', kind: 'after' }, { from: 'a', to: 'zz', kind: 'after' }] }, null]; setState(s); return projects.length === 1 && projects[0].edges.length === 1 && projects[0].targets.length === 0; })(JSON.parse(JSON.stringify(stateNow())))`), true, 'a damaged file can\'t hold a loop');
      assert.deepEqual(await h.pageErrors(), []);
    });
  } finally { await h.close(); }
  await test('before an app restart: forge says so, owned counts still work', async () => {
    const o = await start({ noPoll: true, oldFields: true, build: false });
    try {
      assert.equal(await o.run(`forgeInfo('IronBar').known`), false);
      const id = await o.run(`(() => { const p = projectCreate('Old'); projectAddItem(p, 'IronBar', 1e13); return p.id; })()`);
      const c = await o.run(`projectCalc(projectById(${J(id)}))`), bar = Object.values(c.nodes).find(n => n.raw === 'IronBar');
      assert.equal(bar.needs, 'Forge needs an app restart'); assert.equal(bar.hours, null); assert.equal(c.hours, null);
      assert.equal(await o.run(`taskCalc(forgeTask('IronBar')).needs`), 'Forge needs an app restart');
      await o.run(`taskEdit(forgeTask('IronBar'), 'amount', '1e12'); render(); 1`);
      assert.equal(await o.run(`taskCalc(forgeTask('IronBar')).needs`), 'Forge needs an app restart');
      assert.ok((await o.run(`ownedCount(['IronBar'])`)) >= 0);
      assert.deepEqual(await o.pageErrors(), []);
    } finally { await o.close(); }
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
