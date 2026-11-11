// A collection task counts anyone on any source of the item, not just its own monster.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, realLoot: true }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    await run(`(() => {
      window.P = rows.filter(r => r.slot != null).slice(0, 3);
      const put = (r, id, map) => { const m = GAME.monsters[id]; r.monster = id; r.mapIdx = map; r.kind = 'kills'; r.activity = 'FIGHTING'; r.activityKey = m[1] + '|' + m[0]; };
      rows.filter(r => r.slot != null).forEach(r => { r.kind = 'exp'; r.monster = ''; r.activity = 'LABORATORY'; r.activityKey = 'LABORATORY|Laboratory'; });
      put(P[0], 'w6d3', 264); put(P[1], 'w6d2', 263); put(P[2], 'w7b3', 317);
      P.forEach(r => { const a = { slot: r.slot, activityKey: r.activityKey, source: 'monster' }; statSet(a, 'kph', '1000000'); statSet(a, 'dr', '100'); });
      tasks.filter(t => t.itemName === 'Golden Dumpling').forEach(t => deleteTask(t.id));
      window.T = upsertTask({ type: 'item', itemName: 'Golden Dumpling', amount: '1000', starred: true, source: 'monster', chance: 0.0000228, monster: 'w6d3', afkId: 'w6d3', activityKey: P[0].activityKey, match: { kind: 'activity', key: P[0].activityKey }, mapIdx: 264 });
      return 1;
    })()`);
    await test('a player on a different monster that drops it counts', async () => {
      const k = await run(`(() => { const k = taskRate(T); return { rate: k.rate, counted: k.team.counted, ids: k.team.rows.map(r => r.slot) }; })()`);
      const a = await run(`itemContribution(T, P[0], false)`), b = await run(`itemContribution(T, P[1], false)`);
      assert.ok(a > 0 && b > 0, a + ' ' + b);
      assert.ok(Math.abs(k.rate - a - b) < 1e-6, k.rate + ' vs ' + (a + b));
      assert.equal(k.counted, 2);
      assert.deepEqual(k.ids.sort(), await run(`[P[0].slot, P[1].slot].sort()`));
    });
    await test('a player on something that does not drop it does not', async () => {
      assert.equal(await run(`itemSourcesFor('Golden Dumpling', P[2]).length`), 0);
    });
    await test('crystals count anywhere in that world, with their own stat, only while played', async () => {
      await run(`window.realActive = activePlayerSlot; activePlayerSlot = () => P[0].slot; 1`);
      const before = await run(`taskRate(T).rate`);
      await run(`(() => { const r = P[2]; DROPS.noDrops = []; r.monster = 'noDrops'; r.mapIdx = 280; r.activityKey = 'FIGHTING|Nothing here'; statSet({ slot: r.slot, source: 'crystal', match: { kind: 'world', world: 5 } }, 'kph', '1000'); statSet({ slot: r.slot, activityKey: r.activityKey, source: 'monster' }, 'dr', '100'); return 1; })()`);
      assert.deepEqual(await run(`itemSourcesFor('Golden Dumpling', P[2]).map(s => s.source)`), [], 'AFK: no crystals');
      assert.equal(await run(`taskRate(T).rate`), before, 'AFK adds nothing');
      await run(`activePlayerSlot = () => P[2].slot; 1`);
      assert.deepEqual(await run(`itemSourcesFor('Golden Dumpling', P[2]).map(s => s.source)`), ['crystal']);
      const after = await run(`taskRate(T).rate`), share = await run(`1000 * DROPS.Crystal5.find(d => d[0] === 'Golden Dumpling')[1] * 100 * bundleMulti('gfood').multi`); // golden food comes in bundles, crystals too
      assert.ok(Math.abs(after - before - share) < 1e-6, after + ' - ' + before + ' vs ' + share);
    });
    await test('a player moving to another source of the item keeps counting', async () => {
      await run(`(() => { const r = P[0], m = GAME.monsters.w6a1; r.monster = 'w6a1'; r.mapIdx = 250; r.activityKey = m[1] + '|' + m[0]; const a = { slot: r.slot, activityKey: r.activityKey, source: 'monster' }; statSet(a, 'kph', '1000000'); statSet(a, 'dr', '100'); return 1; })()`);
      const k = await run(`(() => { const k = taskRate(T); return { rate: k.rate, counted: k.team.counted }; })()`);
      const sum = await run(`P.reduce((n, r) => n + itemContribution(T, r, true), 0)`); // P[2] is being played, so its crystals count
      assert.ok(Math.abs(k.rate - sum) < 1e-6, k.rate + ' vs ' + sum);
      assert.equal(k.counted, 3);
    });
    await test('a crystal task asks for nothing while AFK, and works while played', async () => {
      const c = await run(`(() => {
        const r = P[2], t = { slot: null, type: 'item', itemName: 'Golden Dumpling', source: 'crystal', chance: DROPS.Crystal5.find(d => d[0] === 'Golden Dumpling')[1], monster: 'Crystal5', match: { kind: 'world', world: 5 } };
        activePlayerSlot = () => P[0].slot;
        const afk = taskRate(t);
        activePlayerSlot = () => r.slot;
        const on = taskRate(t), preview = taskRate(t, null, true);
        activePlayerSlot = () => P[0].slot;
        const crystalOnly = { ...t, itemName: 'Crystal Only X' };
        DROPS.Crystal5 = [...DROPS.Crystal5, ['Crystal Only X', 0.01]];
        activePlayerSlot = () => r.slot;
        const justPreview = taskRate(crystalOnly, null, true), justOn = taskRate(crystalOnly);
        activePlayerSlot = () => P[0].slot;
        DROPS.Crystal5 = DROPS.Crystal5.filter(d => d[0] !== 'Crystal Only X');
        return { afk: [afk.rate, afk.needs], on: on.rate, preview: preview.rate, onlyPreview: [justPreview.rate, justPreview.needs], onlyOn: justOn.rate };
      })()`);
      assert.ok(c.on > 0, 'played: ' + c.on);
      assert.ok(c.preview < c.on, 'the AFK preview leaves out the crystal share');
      assert.deepEqual(c.onlyPreview, [0, 'Crystals only drop while playing'], 'an item only crystals drop has no AFK rate');
      assert.ok(c.onlyOn > 0, 'but it has one while played');
      await run(`activePlayerSlot = realActive; 1`);
    });
    await test('a drop only the project list knows still counts who is on it', async () => {
      const got = await run(`(() => { const r = { ...P[1], monster: 'jarSand', kind: 'kills' }, row = PROJECT_DROPS.DesertA1.find(x => x[0] === 'jarSand'); return { inDrops: (DROPS.jarSand || []).some(d => d[0] === 'Pocket Sand'), sources: itemSourcesFor('Pocket Sand', r).map(s => [s.source, s.chance]), chance: row[1] }; })()`);
      assert.equal(got.inDrops, false);
      assert.deepEqual(got.sources, [['monster', got.chance]]);
    });
    await test('a card still only counts its own monster', async () => {
      const r = await run(`teamOf({ slot: P[1].slot, type: 'card', monster: 'w6d2', source: 'monster', chance: 1e-5 }).map(x => x.monster)`);
      r.forEach(m => assert.equal(m, 'w6d2'));
    });
    await test('an AFK claim is not counted as active loot', async () => {
      const slot = (await run(`api('/api/loot')`)).active.slot, list = v => typeof v === 'string' ? JSON.parse(v) : v;
      const gain = n => h.bump(d => { const o = list(d['InventoryOrder_' + slot]), q = list(d['ItemQTY_' + slot]), at = o.indexOf('FoodG12') >= 0 ? o.indexOf('FoodG12') : 0; o[at] = 'FoodG12'; q[at] = (at === o.indexOf('FoodG12') && +q[at] > 0 ? +q[at] : 0) + n; d['InventoryOrder_' + slot] = o; d['ItemQTY_' + slot] = q; });
      await gain(0); await gain(10); await gain(12); await gain(100000); await gain(11); await gain(9);
      const it = (await run(`api('/api/loot')`)).active, mace = it.items.find(x => x.item === 'FoodG12');
      assert.equal(mace.gained, 42, JSON.stringify(mace));
      assert.ok(mace.ms > 0 && mace.ms <= 5 * 5 * 6e4, 'the claim stretch is out of the time too: ' + mace.ms);
    });
    await test('dropping more from then on (a stronger character) is not a claim, though it is far above what came before', async () => {
      const slot = (await run(`api('/api/loot')`)).active.slot, list = v => typeof v === 'string' ? JSON.parse(v) : v;
      const gain = n => h.bump(d => { const o = list(d['InventoryOrder_' + slot]), q = list(d['ItemQTY_' + slot]), at = o.indexOf('FoodG12'); q[at] = +q[at] + n; d['ItemQTY_' + slot] = q; });
      for (let i = 0; i < 6; i++) await gain(500);
      const mace = (await run(`api('/api/loot')`)).active.items.find(x => x.item === 'FoodG12');
      assert.equal(mace.gained, 42 + 6 * 500, 'the earlier claim is still out, every stretch since counts: ' + JSON.stringify(mace));
    });
    await test('obol fragments: the account total counts as it rises, not what was there before, and spending is no loss', async () => {
      const frag = n => h.bump(d => { d.CYObolFragments = n; });
      const had = h.save.CYObolFragments; // the test save's own total: there before, so never a gain
      await frag(had); await frag(had + 50); await frag(had + 120); await frag(had - 1000); await frag(had - 970);
      const it = (await run(`api('/api/loot')`)).active, f = it.items.find(x => x.item === 'ObolFrag');
      assert.ok(f, 'tracked: ' + it.items.map(x => x.item).join(','));
      assert.equal(f.gained, 150, 'what was there before is not a gain, and spending 1120 on jellies is not either: ' + JSON.stringify(f));
      assert.equal(await run(`lootCanGive(lootNow.active)('ObolFrag')`), true, 'any fight can give fragments');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
