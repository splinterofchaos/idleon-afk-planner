// Item tasks for the whole account, made on the Projects tab.
const assert = require('assert');
const { start } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, width: 1500, height: 1100 }), run = h.run;
  try {
    await h.bump(() => {});
    await h.poll();
    await new Promise(r => setTimeout(r, 500));
    await run(`tasks.filter(t => t.itemName === 'Guardian Mace').forEach(t => deleteTask(t.id)); 1`);
    const setup = `(() => { const p = projects[0] || projectCreate('Trial'); if (!projects.includes(p)) projects.push(p); projectAddItem(p, 'w7A12', 1e12); syncProjects(); return [p.id, p.nodes.find(n => n.raw === 'w7A12').id]; })()`;
    const [pid, nid] = await run(setup);
    await run(`showTab("projects"); pjId = ${JSON.stringify(pid)}; pjNodeId = ${JSON.stringify(nid)}; renderProjects(); 1`);
    await new Promise(r => setTimeout(r, 500));

    await test('Make task has no player to choose', async () => {
      assert.equal(await run(`!!$('pjMakeWho')`), false);
      assert.equal(await run(`!!$('pjNewWho')`), false);
    });
    await test('it makes a task with no player', async () => {
      await h.click('#pjMakeTask');
      await new Promise(r => setTimeout(r, 300));
      const t = await run(`(() => { const t = tasks.find(x => x.itemName === 'Guardian Mace'); return { slot: t.slot, type: t.type, hasGlobal: 'global' in t, key: t.key, source: t.source, amount: t.amount, monster: t.monster }; })()`);
      assert.equal(t.slot, null); assert.equal(t.type, 'item'); assert.equal(t.hasGlobal, false); assert.equal(t.key, 'item|Guardian Mace'); assert.equal(t.amount, '1T');
      assert.ok(t.source === 'monster' || t.source === 'crystal' || t.source === 'direct', t.source);
    });
    await test('it counts everything the account holds', async () => {
      assert.deepEqual(await run(`(() => { const t = tasks.find(x => x.itemName === 'Guardian Mace'), k = taskCalc(t, Date.now()); return [k.have, k.target]; })()`), await run(`[ownedCount(['w7A12'], { equipped: true }), 1e12]`));
    });
    await test('nobody on it says so, and it asks for no kills per hour', async () => {
      const r = await run(`(() => { const t = tasks.find(x => x.itemName === 'Guardian Mace'); rows.forEach(r => { if (r.monster === t.monster) r.monster = ''; }); const k = taskRate(t); return { active: taskIsActive(t), rate: k.rate, needs: k.needs, fields: editorFields(t).map(f => f.name) }; })()`);
      assert.equal(r.active, false); assert.equal(r.rate, 0); assert.match(r.needs, /^No one is on /); assert.deepEqual(r.fields, ['amount']);
    });
    await test('its rate adds up everyone on the drop, from their own AFK stats', async () => {
      const r = await run(`(() => {
        const t = tasks.find(x => x.itemName === 'Guardian Mace'), who = rows.filter(r => r.slot != null).slice(0, 2);
        who.forEach(r => { r.monster = t.monster; r.mapIdx = t.mapIdx ?? r.mapIdx; r.activityKey = t.activityKey; r.doing = 'FIGHTING'; });
        const before = JSON.stringify(rates);
        const none = taskRate(t);
        who.forEach(r => { const m = { slot: r.slot, activityKey: t.activityKey, source: 'monster' }; statSet(m, 'kph', '1000'); statSet(m, 'dr', '2'); });
        const one = memberRate({ ...t, slot: who[0].slot, activityKey: who[0].activityKey, afkId: who[0].monster, mapIdx: who[0].mapIdx }, t.chance), two = memberRate({ ...t, slot: who[1].slot, activityKey: who[1].activityKey, afkId: who[1].monster, mapIdx: who[1].mapIdx }, t.chance), k = taskRate(t);
        return { none: none.needs, one, two, rate: k.rate, counted: k.team && k.team.counted, active: taskIsActive(t), keys: Object.keys(rates).filter(x => x.startsWith('null|')) };
      })()`);
      assert.match(r.none, /AFK stats/); assert.ok(r.one > 0 && r.two > 0, JSON.stringify(r));
      assert.ok(Math.abs(r.rate - r.one - r.two) < 1e-9, JSON.stringify(r)); assert.equal(r.counted, 2); assert.equal(r.active, true); assert.deepEqual(r.keys, []);
    });
    await test('the activity card and the project box draw it', async () => {
      await run(`paintAll(); renderProjects(); 1`);
      await new Promise(r => setTimeout(r, 300));
      assert.match(await run(`$('activityPanel').innerText`), /Guardian Mace/);
      assert.match(await run(`$('viewProjects').innerText`), /Guardian Mace/);
    });
    await test('Create and add with no player uses the drop table', async () => {
      const r = await run(`(() => { const raw = 'w7A14'; const opts = dropOptions(raw); return opts.length; })()`);
      assert.ok(r >= 0);
      await run(`pjAddOpen = true; pjAddTab = 'task'; renderProjects(); 1`);
      const made = await run(`(() => { const t = upsertTask({ slot: null, type: 'item', itemName: itemName('w7A12') + ' x' }); deleteTask(t.id); return itemSourceFields(bestDropOption(dropOptions('w7A12'))).source; })()`);
      assert.notEqual(made, 'direct');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
