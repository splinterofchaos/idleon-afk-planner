// Projects: golden food for players, each needing a full stack by their food carry cap. Fake backend only.
const assert = require('assert'), { start, sleep } = require('./harness');
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').slice(0, 6).join('\n      ')); } };
const J = JSON.stringify, CAKE = 'FoodG13';
(async () => {
  const h = await start({ noPoll: true, width: 1500, height: 1000 }), run = h.run;
  const parse = v => typeof v === 'string' ? JSON.parse(v) : v;
  // No cake anywhere, then: caps 1000 / 2000 / 500 for 0-2; 0 eats a full stack, 1 has 500 in bags, 2 none; 3 (not getting any) eats 5000 and has 200 in bags; 300 in storage
  const setup = (caps, storage) => d => {
    Object.keys(d).filter(k => /^(InventoryOrder_|EquipOrder_|ChestOrder$)/.test(k)).forEach(k => { const v = parse(d[k]); const scrub = o => Object.keys(o).forEach(i => { if (o[i] === CAKE) o[i] = 'Blank'; }); if (k.startsWith('Equip')) v.forEach(scrub); else scrub(v); d[k] = typeof d[k] === 'string' ? J(v) : v; });
    caps.forEach((n, slot) => { const c = parse(d['MaxCarryCap_' + slot]) || {}; c.Foods = n; d['MaxCarryCap_' + slot] = J(c); });
    const eat = (slot, n) => { const e = parse(d['EquipOrder_' + slot]), q = parse(d['EquipQTY_' + slot]); e[2]['0'] = CAKE; q[2]['0'] = n; d['EquipOrder_' + slot] = J(e); d['EquipQTY_' + slot] = J(q); };
    const bag = (slot, n) => { const o = parse(d['InventoryOrder_' + slot]), q = parse(d['ItemQTY_' + slot]), at = o.indexOf('Blank'); o[at] = CAKE; q[at] = n; d['InventoryOrder_' + slot] = J(o); d['ItemQTY_' + slot] = J(q); };
    eat(0, 1000); bag(1, 500); eat(3, 5000); bag(3, 200);
    const o = parse(d.ChestOrder), q = parse(d.ChestQuantity); o.push(CAKE); q.push(storage); d.ChestOrder = J(o); d.ChestQuantity = J(q);
  };
  const has = slot => run(`document.querySelector('#pjFoodWho input[data-slot="${slot}"]').parentElement.querySelector('.pj-who-has').textContent`);
  const node = () => run(`(() => { const c = projectCalc(pjProject()); return Object.values(c.nodes).find(n => n.raw === ${J(CAKE)}) || null; })()`);
  const f = n => run(`fmtNum(${n})`);
  try {
    await h.bump(setup([1000, 2000, 500, 3000], 300)); await h.poll(); await sleep(600);
    await test('the tab lists the golden foods and every player, with what they carry', async () => {
      await run(`projects.splice(0); pjPick(null); showTab('projects'); render(); 1`);
      await h.type('#pjNameBox', 'Foods'); await h.key('Enter'); await sleep(30);
      await run(`pjAddOpen = true; pjAddTab = 'food'; paintProjects(); 1`);
      assert.equal(await run(`document.querySelectorAll('#pjFoodPick input').length`), await run(`projectGoldenFoods().length`));
      assert.ok(await run(`projectGoldenFoods().length`) >= 15);
      assert.equal(await run(`$('pjFoodGo').disabled`), true);
      assert.equal(await has(0), 'carries ' + await f(1000));
      await h.click(`#pjFoodPick input[value="${CAKE}"]`); await sleep(30);
      assert.equal(await has(0), 'carries ' + await f(1000) + ' · 1 of 1 full');
      assert.equal(await has(1), 'carries ' + await f(2000) + ' · 0 of 1 full');
      assert.equal(await run(`$('pjFoodGo').disabled`), true, 'nobody ticked yet');
    });
    await test('adding: what each player is short, less storage and others’ bags; what others eat is theirs', async () => {
      for (const s of [0, 1, 2]) await h.click(`#pjFoodWho input[data-slot="${s}"]`);
      await h.click('#pjFoodGo', { hold: 1100 });
      assert.deepEqual(await run(`pjProject().targets.find(x => x.raw === ${J(CAKE)})`), { raw: CAKE, count: 0, for: [0, 1, 2], fill: true });
      assert.equal(await run(`document.querySelectorAll('#pjFoodPick input:checked, #pjFoodWho input:checked').length`), 0, 'cleared for the next');
      const n = await node();
      assert.equal(n.need, 1500, J(n)); // short 0 + 1500 + 500, less 300 storage and 200 in slot 3's bags
      assert.equal(n.whoUsed, 500);
      assert.deepEqual(n.who.map(w => [w.slot, w.state, w.own, w.cap]), [[0, 'full', 1000, 1000], [1, 'part', 500, 2000], [2, '', 0, 500]]);
      await run(`pjSelect(${J(n.id)}, true); 1`); await sleep(50);
      const lines = await run(`[...document.querySelectorAll('#pjWhoState .pj-who-line')].map(x => x.textContent)`);
      assert.ok(/has a full stack/.test(lines[0]) && /has .* of /.test(lines[1]) && /needs /.test(lines[2]), J(lines));
      assert.match(await run(`$('pjWhoState').textContent`), /from storage and other bags/);
    });
    await test('a new save with a higher carry cap, or more in storage, changes it by itself; owned isn’t done until each player holds it', async () => {
      await h.bump(setup([1000, 2000, 1000, 3000], 300)); await sleep(1100);
      assert.equal((await node()).need, 2000);
      await h.bump(setup([1000, 2000, 1000, 3000], 5000)); await sleep(1100);
      const n = await node();
      assert.equal(n.need, 0); assert.equal(n.done, false, 'still to hand over'); assert.equal(n.hours, 0);
      assert.deepEqual(n.move, [{ slot: 1, n: 1500 }, { slot: 2, n: 1000 }]);
      assert.equal(await run(`(() => { const c = projectCalc(pjProject()); return pjMoveText(Object.values(c.nodes).find(n => n.raw === ${J(CAKE)})); })()`), 'Give ' + await run('pjSlotName(1)') + ' ' + await f(1500) + ', ' + await run('pjSlotName(2)') + ' ' + await f(1000));
      await h.bump(d => { setup([1000, 2000, 1000, 3000], 3000)(d); const e = parse(d.EquipOrder_1), q = parse(d.EquipQTY_1); e[2]['1'] = CAKE; q[2]['1'] = 2000; d.EquipOrder_1 = J(e); d.EquipQTY_1 = J(q); const e2 = parse(d.EquipOrder_2), q2 = parse(d.EquipQTY_2); e2[2]['1'] = CAKE; q2[2]['1'] = 1000; d.EquipOrder_2 = J(e2); d.EquipQTY_2 = J(q2); }); await sleep(1100);
      const held = await node();
      assert.equal(held.done, true, J(held)); assert.equal(held.move, null);
      await h.bump(setup([1000, 2000, 1000, 3000], 5000)); await sleep(1100);
    });
    await test('the added list’s players say how full they are', async () => {
      await run(`pjWhoEdit = ${J(CAKE)}; paintProjects(); 1`); await sleep(30);
      const t = await run(`document.querySelector('#pjWhoEdit-${CAKE} input[data-slot="1"]').parentElement.querySelector('.pj-who-has').textContent`);
      assert.equal(t, await f(500) + ' of ' + await f(2000));
      assert.equal(await run(`document.querySelector('#pjWhoEdit-${CAKE} input[data-slot="0"]').parentElement.querySelector('.pj-who-has').textContent`), 'full stack');
    });
    await test('kept with the projects', async () => {
      await run(`queueSave(); 1`); await sleep(300);
      const sheet = await h.savedSheet(), p = (sheet.projects || []).find(x => x.name === 'Foods');
      assert.ok(p && p.targets.some(x => x.raw === CAKE && x.fill === true), J(p && p.targets));
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
