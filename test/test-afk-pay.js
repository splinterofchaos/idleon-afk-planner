// AFK pay measured at claims: a character back on the same target after time away shows what AFK paid, and item goals use it. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
const J = JSON.stringify, P = v => typeof v === 'string' ? JSON.parse(v) : v, RAW = 'EquipmentStatues30';
(async () => {
  const h = await start({ sheet: true, noPoll: true, realLoot: true }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(300);
    const slots = await run('rows.filter(r => r.slot != null).map(r => r.slot)'), lava = slots[0], other = slots[1];
    // n Dragon statues in lava's bags (and nowhere else), plus what's in storage
    const bag = (n, storage = 0) => d => {
      Object.keys(d).filter(k => /^InventoryOrder_\d+$/.test(k)).forEach(k => { const o = P(d[k]); o.forEach((r, i) => { if (r === RAW) o[i] = 'Blank'; }); d[k] = J(o); });
      { const o = P(d.ChestOrder); o.forEach((r, i) => { if (r === RAW) o[i] = 'Blank'; }); d.ChestOrder = J(o); }
      const o = P(d['InventoryOrder_' + lava]), q = P(d['ItemQTY_' + lava]), at = o.indexOf('Blank'); o[at] = RAW; q[at] = n; d['InventoryOrder_' + lava] = J(o); d['ItemQTY_' + lava] = J(q);
      if (storage) { const co = P(d.ChestOrder), cq = P(d.ChestQuantity); co.push(RAW); cq.push(storage); d.ChestOrder = J(co); d.ChestQuantity = J(cq); }
    };
    const pay = async () => (await run(`api('/api/loot')`)).afkPay;
    await test('back on the same target after time away: what came in over the gap, over the time, is what AFK paid', async () => {
      await h.setActivity(lava, 'caveC', { mapIdx: 216 });
      await h.bump(bag(1000)); await h.bump(bag(1010)); // played
      await h.setActivity(other, 'Nothing', { mapIdx: 0 }); // left on golems
      const away = await run(`api('/api/latest')`).then(l => l.savedAt);
      for (let i = 0; i < 6; i++) await h.bump(bag(1010)); // 30 minutes away: nothing lands until the claim
      bag(1010 + 100000)(h.save); // the claim lands in the save made on coming back
      await h.setActivity(lava, 'caveC', { mapIdx: 216 });
      await h.bump(bag(1010 + 100000));
      const p = (await pay())[lava + '|caveC'];
      assert.ok(p && p[RAW], J(await pay()));
      assert.equal(p[RAW].gained, 100000); assert.equal(p[RAW].claims, 1);
      assert.ok(p[RAW].ms >= 30 * 6e4, String(p[RAW].ms));
    });
    await test('statues moved in from storage aren’t pay', async () => {
      await h.bump(bag(101010, 5000));
      await h.setActivity(other, 'Nothing', { mapIdx: 0 });
      await h.bump(bag(101010, 5000)); await h.bump(bag(101010, 5000)); await h.bump(bag(101010, 5000)); await h.bump(bag(101010, 5000));
      bag(106010, 0)(h.save); // the 5000 from storage, nothing else
      await h.setActivity(lava, 'caveC', { mapIdx: 216 });
      const p = (await pay())[lava + '|caveC'][RAW];
      assert.equal(p.claims, 1, J(p)); assert.equal(p.gained, 100000);
    });
    await test('the game’s lag: what a claim brings can land a save before the time stamp moves, and still counts once it does', async () => {
      await h.setActivity(other, 'Nothing', { mapIdx: 0 }); // lava left again
      await h.bump(bag(106010)); await h.bump(bag(106010));
      await h.bump(bag(106010 + 7000)); // the claim's statues, with lava's time stamp not moved yet
      let p = (await pay())[lava + '|caveC'][RAW];
      assert.equal(p.claims, 1, 'nothing yet: ' + J(p)); // the storage move brought nothing, so it isn't a claim
      await h.setActivity(lava, 'caveC', { mapIdx: 216 });
      p = (await pay())[lava + '|caveC'][RAW];
      assert.equal(p.claims, 2, J(p)); assert.equal(p.gained, 107000);
    });
    await test('an item goal’s AFK rate for that character is the measured pay, said so', async () => {
      await run(`(async () => { lootNow = await api('/api/loot'); return 1; })()`);
      await run(`setStatueGoal(29, 400); 1`);
      const k = await run(`(() => { const t = tasks.find(x => x.statueIndex === 29), r = rows.find(x => x.slot === ${lava}); return { paid: itemAfkPaid(t, r), afk: taskCalc(t, Date.now(), null, true).rate, src: taskCalc(t, Date.now(), null, true).rateSource }; })()`);
      const p = (await pay())[lava + '|caveC'][RAW];
      assert.ok(Math.abs(k.paid - p.gained / p.ms * 36e5) < 1e-6, J(k));
      assert.ok(k.afk >= k.paid - 1e-6, J(k));
      assert.equal(k.src, 'measured AFK');
    });
    await test('a character first seen already away isn’t measured: how long it was away can’t be told', async () => {
      const third = slots[2];
      await h.bump(d => { const o = P(d['InventoryOrder_' + third]), q = P(d['ItemQTY_' + third]), at = o.indexOf('Blank'); o[at] = 'w7B3'; q[at] = 5; d['InventoryOrder_' + third] = J(o); d['ItemQTY_' + third] = J(q); });
      const before = J(await pay());
      h.save['ItemQTY_' + third] = J(P(h.save['ItemQTY_' + third]).map((n, i) => P(h.save['InventoryOrder_' + third])[i] === 'w7B3' ? 5 + 999 : n));
      await h.setActivity(third, h.save['AFKtarget_' + third] || 'w7b3', { mapIdx: +h.save['CurrentMap_' + third] });
      assert.equal(J(await pay()), before, 'nothing measured for it');
    });
    await test('common drops (the monster’s own list) come (1 + multikill %) times per real kill; rare-table drops once', async () => {
      assert.equal(await run(`dropIsCommon('w7b3', 'Pirate Emblem I')`), true);
      assert.equal(await run(`dropIsCommon('w7b11', 'Golden Saltwater Taffy')`), false, 'in a table beneath it');
      const r = await run(`(() => { const slot = rows.find(x => x.slot != null).slot, key = slot + '|FIGHTING|Pirate Underling'; rates[key] = { kph: '80M', dr: '1591', mk: '698' };
        const m = t => ({ type: 'item', source: 'monster', slot, monster: 'w7b3', afkId: 'w7b3', activityKey: 'FIGHTING|Pirate Underling', itemName: t });
        const common = memberRate(m('Pirate Emblem I'), 0.001), rare = memberRate(m('Golden Saltwater Taffy'), 4e-7);
        return [commonRolls(m('Pirate Emblem I')), commonRolls(m('Golden Saltwater Taffy')), common / 0.001 / (rare / 4e-7 / bundleMulti('gfood').multi)]; })()`); // the taffy is golden food: its bundle aside
      assert.deepEqual(r.map(x => Math.round(x * 1000) / 1000), [7.98, 1, 7.98]);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
