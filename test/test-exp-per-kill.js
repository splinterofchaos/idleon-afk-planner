// Class EXP worked out from kills, and level tasks using the EXP Loot rates measures. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
const list = v => typeof v === 'string' ? JSON.parse(v) : v;
const near = (a, b, m) => assert.ok(Math.abs(a / b - 1) < 1e-6, (m || '') + ': ' + a + ' should be ' + b);
(async () => {
  const h = await start({ sheet: true, noPoll: true, realLoot: true }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(300);
    const a = (await run(`api('/api/loot')`)).active, slot = a.slot, map = a.mapIdx;
    const step = (kills, exp) => h.bump(d => {
      const k = list(d['KLA_' + slot]), x = list(d['Exp0_' + slot]);
      k[map][0] = +k[map][0] - kills; x[0] = +x[0] + exp;
      d['KLA_' + slot] = k; d['Exp0_' + slot] = x;
    });
    const base = await run(`+chars[${slot}].exp[0]`), unit = Math.max(base / 1e3, 1000); // large enough to register against the class EXP total
    const loot = () => run(`api('/api/loot')`);
    const key = slot + '|' + a.afkId;
    await test('EXP per kill counts kills as the game does, from saves where both moved', async () => {
      await step(0, 0); await step(100, 100 * unit); await step(200, 200 * unit);
      const seen = (await loot()).expPerKill[key];
      assert.ok(seen, 'recorded');
      near(seen.perKill, unit, 'per kill'); assert.equal(seen.from, 'play');
    });
    await test('EXP per kill from active play alone gives no AFK estimate', async () => {
      const worked = await run(`(async () => { lootNow = await api('/api/loot'); const r = rows.find(x => x.slot === ${slot}); setRowStat(r, 'kph', '1000'); return classExpWorked({ slot: ${slot}, type: 'class', activityKey: r.activityKey, afkId: r.monster }); })()`);
      assert.equal(worked, 0);
    });
    await test('a claim sets what AFK pays per kill', async () => {
      await step(100, 100 * unit); await step(100, 100 * unit);
      await step(100000, 100000 * unit * 3); // far above the usual stretch: pays 3x per kill
      await step(100, 100 * unit);
      const seen = (await loot()).expPerKill[key];
      assert.equal(seen.from, 'claim'); near(seen.perKill, 3 * unit, 'the claim only');
    });
    await test('a class goal gets its rate from kills per hour with nothing typed', async () => {
      const id = await run(`(() => { const r = rows.find(x => x.slot === ${slot}); return upsertTask({ slot: ${slot}, type: 'class', match: { kind: 'fighting' }, activityKey: r.activityKey, afkId: r.monster, goal: String(r.classLvl + 1), starred: true }).id; })()`);
      await run(`(async () => { lootNow = await api('/api/loot'); lootNow.active = null; })()`);
      await run(`setRowStat(rows.find(x => x.slot === ${slot}), 'xph', ''); setRowStat(rows.find(x => x.slot === ${slot}), 'kph', '1000'); selectPlayer(${slot}); render(); showTab('player'); paintAll(); 1`);
      const r = await run(`(k => [k.rate, k.rateSource, k.hours > 0])(taskCalc(tasks.find(t => t.id === '${id}')))`);
      near(r[0], 3000 * unit, 'kills x what a claim paid per kill'); assert.equal(r[1], 'estimate'); assert.equal(r[2], true, 'and an ETA');
      assert.equal(await run(`document.querySelector('.task-editor[data-task="${id}"] [data-field="xph"]').value`), '', 'the box stays blank');
      assert.equal(await run(`document.querySelector('.task-editor[data-task="${id}"] [data-field="xph"]').placeholder`), await run(`fmtNum(${3000 * unit})`), 'and shows the worked number');
      await run(`setRowStat(rows.find(x => x.slot === ${slot}), 'xph', '5'); 1`);
      assert.equal(await run(`taskRate(tasks.find(t => t.id === '${id}')).rate`), 5, 'a typed number wins');
      await run(`setRowStat(rows.find(x => x.slot === ${slot}), 'xph', ''); setRowStat(rows.find(x => x.slot === ${slot}), 'kph', ''); 1`);
      assert.equal(await run(`taskRate(tasks.find(t => t.id === '${id}')).needs`), 'Enter class EXP / hour', 'with no kills an hour, it still asks');
    });
    await test('while played, a level task goes by the EXP Loot rates sees', async () => {
      const r = await run(`(async () => {
        lootNow = await api('/api/loot');
        const t = tasks.find(x => x.slot === ${slot} && x.type === 'class'), c = taskCalc(t), seen = lootNow.active.exp.find(x => x.skill === 0);
        return { rate: c.rate, source: c.rateSource, want: seen.gained / seen.ms * 36e5, playing: c.playing, afk: taskRate(t, null, true).rateSource };
      })()`);
      assert.equal(r.playing, true); assert.equal(r.source, 'loot rate'); near(r.rate, r.want, 'measured');
    });
    await test('a draft asks "what if", so it goes by the number typed', async () => {
      assert.equal(await run(`taskRate(tasks.find(x => x.slot === ${slot} && x.type === 'class'), { xph: '7' }).rate`), 7);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
