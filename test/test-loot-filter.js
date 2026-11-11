// Loot rates only lists what the current activity can give.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true }), run = h.run;
  const can = (afkId, mapIdx, slot, item) => run(`lootCanGive({ slot: ${slot}, afkId: ${JSON.stringify(afkId)}, mapIdx: ${mapIdx} })(${JSON.stringify(item)})`);
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    const slot = await run(`rows.find(r => r.slot != null && r.classIndex !== ROYAL_GUARDIAN).slot`), rg = await run(`(rows.find(r => r.classIndex === ROYAL_GUARDIAN) || {}).slot ?? null`);
    await test('a monster: its own table and its world’s crystals, nothing else', async () => {
      assert.equal(await can('w6d3', 264, slot, 'FoodG12'), true, 'Golden Dumpling');
      assert.equal(await can('w6d3', 264, slot, 'Copper'), false, 'printed ore');
      assert.equal(await can('w6d3', 264, slot, 'Fish1'), false);
      const crystal = await run(`LOOT_TABLE.Crystal5.find(x => !(LOOT_TABLE.w6d3 || []).includes(x))`);
      assert.equal(await can('w6d3', 264, slot, crystal), true, 'crystal drop in world 6');
      assert.equal(await can('w6d3', 20, slot, crystal), false, 'not in another world');
    });
    await test('skilling: what it gathers and its own table', async () => {
      assert.equal(await can('Copper', 6, slot, 'Copper'), true, 'the ore');
      assert.equal(await can('Copper', 6, slot, 'Iron'), false, 'another ore');
      assert.equal(await can('Copper', 6, slot, 'FoodG4'), true, 'its table');
      assert.equal(await can('OakTree', 1, slot, 'OakTree'), true);
      assert.equal(await can('OakTree', 1, slot, 'Leaf1'), true);
      assert.equal(await can('FishSmall', 54, slot, 'Fish1'), true);
      assert.equal(await can('Bug1', 60, slot, 'Bug1'), true);
      assert.equal(await can('Laboratory', 150, slot, 'Copper'), false, 'the lab gives nothing');
    });
    await test('Spelunking: the cave’s chapter', async () => {
      const name = await run(`Object.keys(ITEMS).includes('Spelunking4')`);
      if (name) assert.equal(await can('Spelunking4', 317, slot, 'Spelunking4'), true);
    });
    await test('Royal Guardian special cases', async () => {
      if (rg == null) return;
      const parchment = await run(`rawNamesOf(ITEMS.RGenh)[0]`), orblet = await run(`rawNamesOf(ITEMS.Orblet)[0]`);
      assert.equal(await can('w6d3', 43, rg, parchment), true, 'Parchment on The Royal Castle');
      assert.equal(await can('w6d3', 264, rg, parchment), false, 'not elsewhere');
      assert.equal(await can('w6d3', 264, rg, orblet), true, 'Orblets anywhere');
      assert.equal(await can('w6d3', 43, slot, parchment), false, 'only a Royal Guardian');
    });
    await test('a captured outpost: anything there can drop its world’s marble', async () => {
      const r = await run(`(() => { const was = saveForFinder, maps = []; maps[152] = [4, 0, 0, 59949]; maps[153] = [33617154]; saveForFinder = { data: { RoyalMaps: JSON.stringify(maps) } };
        const can = (afkId, mapIdx, item) => lootCanGive({ slot: ${slot}, afkId, mapIdx })(item);
        try { return [can('w4a2', 152, 'RGshard3'), can('w4a2', 152, 'RGshard2'), can('w4a3', 153, 'RGshard3'), can('Copper', 152, 'RGshard3')]; } finally { saveForFinder = was; } })()`);
      assert.deepEqual(r, [true, false, false, false], 'Sparkly on a built W4 outpost; not another world’s, not one being cleared, not skilling');
    });
    await test('Zenith Cluster Farming on: any fight can give clusters; off, or skilling, none', async () => {
      const r = await run(`(() => { const was = saveForFinder, opts = on => { const o = []; o[487] = on; return { data: { OptLacc: JSON.stringify(o) } }; };
        const can = (afkId, mapIdx) => lootCanGive({ slot: ${slot}, afkId, mapIdx })('Quest110');
        try { saveForFinder = opts(1); const on = [can('w4a2', 152), can('w7b12', 326), can('Copper', 152)]; saveForFinder = opts(0); return [...on, can('w4a2', 152)]; } finally { saveForFinder = was; } })()`);
      assert.deepEqual(r, [true, true, false, false], 'clusters while fighting with farming on; not skilling, not with it off');
    });
    await test('the hand filter: hide, see why, bring back, and override the drop tables', async () => {
      await run(`(() => {
        const a = { slot: ${slot}, afkId: 'w6d3', mapIdx: 264, ms: 36e5, at: Date.now(), name: 'x', items: [{ item: 'FoodG12', gained: 100, ms: 36e5, count: 5 }, { item: 'Copper', gained: 50, ms: 36e5, count: 5 }] };
        window.V = { active: a, goals: {} };
        showTab('loot');
        return 1;
      })()`);
      await sleep(500);
      await run(`lootNow = V; lootFilter = {}; lootHiddenOpen = true; paintLoot(V); 1`);
      const shown = () => run(`[...document.querySelectorAll('#viewLoot .loot-hide')].map(b => b.getAttribute('aria-label'))`);
      const name = await run(`itemName('FoodG12')`), ore = await run(`itemName('Copper')`);
      assert.deepEqual((await shown()).sort(), ['Hide ' + name, 'Show ' + ore].sort(), 'a drop is listed, printed ore is tucked away');
      await run(`document.querySelector('[aria-label="Hide ${name}"]').click(); 1`);
      assert.equal(await run(`lootFilter.FoodG12`), 'hide');
      assert.deepEqual((await shown()).sort(), ['Show ' + name, 'Show ' + ore].sort());
      assert.match(await run(`document.querySelector('.loot-hidden-row[data-item="FoodG12"]').innerText`), /You hid this/);
      assert.match(await run(`document.querySelector('.loot-hidden-row[data-item="Copper"]').innerText`), /Not in this activity/);
      await run(`document.querySelector('[aria-label="Show ${name}"]').click(); 1`);
      assert.equal(await run(`'FoodG12' in lootFilter`), false, 'back to the drop tables, which allow it');
      await run(`document.querySelector('[aria-label="Show ${ore}"]').click(); 1`);
      assert.equal(await run(`lootFilter.Copper`), 'show', 'your say beats the drop tables');
      assert.deepEqual((await shown()).sort(), ['Hide ' + name, 'Hide ' + ore].sort());
      assert.equal(await run(`stateNow().lootFilter.Copper`), 'show', 'saved with the sheet');
    });
    await test('goals list only what this activity can feed', async () => {
      await run(`(() => {
        lootFilter = {}; tasks.filter(t => t.type === 'item').forEach(t => deleteTask(t.id));
        upsertTask({ type: 'item', itemName: itemName('FoodG12'), amount: '1e12', source: 'monster', chance: 1e-5, monster: 'w6d3', match: null });
        upsertTask({ type: 'item', itemName: itemName('Copper'), amount: '1e12', source: 'direct', chance: null, match: null });
        upsertTask({ type: 'item', itemName: 'Hampter', amount: '1e12', source: 'monster', chance: 1e-5, monster: 'w5a5', match: null });
        paintLoot({ active: { ...V.active, items: [{ item: 'Copper', gained: 50, ms: 36e5, count: 5 }] }, goals: {} });
        return 1;
      })()`);
      const names = await run(`[...document.querySelectorAll('#viewLoot .loot-goal')].map(b => b.getAttribute('aria-label')).filter(n => !/ outpost$/.test(n))`); // an outpost's capture goal is its own
      assert.deepEqual(names, ['Goal for ' + await run(`itemName('FoodG12')`)], 'a goal from elsewhere isn’t listed: ' + JSON.stringify(names));
      assert.match(await run(`document.querySelector('.loot-hidden-row[data-item="Copper"]').innerText`), /Not in this activity/, 'a printed goal item that changed is under Hidden');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
