// Skilling targets' cards come up as card tasks, as monsters' do. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
const J = JSON.stringify, SKILL_WAIT = 'Measuring from your saves: needs an hour on it';
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    const slot = await run(`rows.find(x => x.slot != null).slot`);
    const card = id => run(`(() => { const t = tasks.find(x => x.type === 'card' && x.monster === ${J(id)}); if (!t) return null; const c = taskCalc(t); return { source: t.source, afkId: t.afkId, title: taskTitle(t), line: c.line, needs: c.needs, active: c.active }; })()`);
    const cards = n => d => { const c = JSON.parse(d.Cards0); Object.assign(c, n); d.Cards0 = J(c); };
    await test('mining Copper makes a Copper card task, timed by a typed or measured rate', async () => {
      await h.bump(d => { d['AFKtarget_' + slot] = 'Copper'; cards({ Copper: 3 })(d); }); await sleep(400);
      const c = await card('Copper');
      assert.ok(c, 'no task');
      assert.equal(c.source, 'skill'); assert.equal(c.afkId, 'Copper'); assert.equal(c.title, 'Copper Card'); assert.equal(c.active, true);
      assert.match(c.line, /of/); assert.equal(c.needs, SKILL_WAIT);
    });
    await test('it is in Add a goal too', async () => {
      assert.ok(await run(`grindOptions(rows.find(x => x.slot === ${slot})).some(o => o.itemName === 'Copper Card' && taskFromOption(rows.find(x => x.slot === ${slot}), o).type === 'card')`));
    });
    await test('Spelunking and Catching have theirs', async () => {
      await h.bump(d => { d['AFKtarget_' + slot] = 'Spelunking0'; cards({ SpelunkingCard0: 2 })(d); }); await sleep(400);
      assert.equal((await card('SpelunkingCard0') || {}).title, 'Fearful Tunnel Card');
      await h.bump(d => { d['AFKtarget_' + slot] = 'Bug1'; cards({ Bug1: 1 })(d); }); await sleep(400);
      assert.equal((await card('Bug1') || {}).title, 'Flies Card');
    });
    await test('planning a target makes its card task', async () => {
      await h.bump(cards({ OakTree: 1 })); await sleep(400);
      const r = await run(`planActivity(${slot}, 'CHOPPIN', { id: 'OakTree', name: 'Oak Tree' }).made.map(t => t.type + ':' + (t.monster || ''))`);
      assert.ok(r.includes('card:OakTree'), J(r));
    });
    await test('a target giving another one\u2019s card at a tiny chance has it; a chance of 0 has none', async () => {
      assert.deepEqual(await run(`['Bug15', 'Tree10', 'Bug11', 'Tree11', 'Bug14', 'Marble', 'Motherlode', 'FishSmall'].map(skillCardOf)`), ['Bug14', 'Tree10', 'Bug10', null, null, null, null, null]);
      await h.bump(d => { d['AFKtarget_' + slot] = 'Bug15'; cards({ Bug14: 1 })(d); }); await sleep(400);
      assert.equal((await card('Bug14') || {}).title, 'Fractalfly Card');
      assert.equal((await card('Bug14') || {}).afkId, 'Bug15');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
