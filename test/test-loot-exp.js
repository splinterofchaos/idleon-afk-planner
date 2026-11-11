// Loot rates also lists EXP earned while playing, worked out from the save's levels and EXP. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
const list = v => typeof v === 'string' ? JSON.parse(v) : v;
(async () => {
  const h = await start({ sheet: true, noPoll: true, realLoot: true }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    const slot = (await run(`api('/api/loot')`)).active.slot, MINING = 1;
    const set = (level, exp, need) => h.bump(d => {
      const lv = list(d['Lv0_' + slot]), xp = list(d['Exp0_' + slot]), req = list(d['ExpReq0_' + slot]);
      lv[MINING] = level; xp[MINING] = exp; req[MINING] = need;
      d['Lv0_' + slot] = lv; d['Exp0_' + slot] = xp; d['ExpReq0_' + slot] = req;
    });
    const mining = async () => (await run(`api('/api/loot')`)).active.exp.find(x => x.skill === MINING);
    await test('EXP is what was earned between saves, and a skill that stood still isn’t listed', async () => {
      await set(50, 9000, 10000); // the first save with these numbers: nothing to compare yet
      await set(50, 9600, 10000);
      const m = await mining(), all = (await run(`api('/api/loot')`)).active.exp;
      assert.equal(m.gained, 600, JSON.stringify(m));
      assert.ok(m.ms >= 5 * 6e4 && m.ms % (5 * 6e4) === 0, 'whole stretches between saves: ' + m.ms);
      assert.equal(m.level, 50);
      assert.deepEqual(all.map(x => x.skill), [MINING], 'only what moved');
    });
    await test('a level-up counts the rest of the old level and what’s into the new', async () => {
      await set(51, 200, 12000);
      assert.equal((await mining()).gained, 600 + 400 + 200);
    });
    await test('an EXP jump far above the usual is a claim, and is taken out with its time', async () => {
      const before = await mining();
      await set(51, 700, 12000); await set(51, 1200, 12000);
      await set(51, 11000, 12000); // ~20x a usual stretch
      await set(51, 11500, 12000);
      const m = await mining();
      assert.equal(m.gained, before.gained + 500 + 500 + 500, JSON.stringify(m));
    });
    await test('the tab lists it with the next level, and it can be hidden and brought back', async () => {
      await run(`showTab('loot'); refreshLoot()`); await sleep(500);
      const text = await run(`$('lootResult').innerText`);
      assert.match(text, /Mining EXP/);
      const row = await run(`[...document.querySelectorAll('#lootResult .found')].find(n => n.querySelector('.who-name').textContent === 'Mining EXP').innerText`);
      assert.match(row, /Lv 5\d → 5\d/, row); // the next level is its goal (Lv 51 in the save; the test's huge rate may have rolled it on since)
      assert.match(row, /live \/ hour\s+\d/, row); // with how long, live
      assert.equal(await run(`expLootName('exp:20')`), 'Research EXP');
      assert.equal(await run(`expLootName('exp:0')`), 'Class EXP');
      await run(`document.querySelector('[aria-label="Hide Mining EXP"]').click(); 1`);
      assert.equal(await run(`lootFilter['exp:1']`), 'hide');
      assert.match(await run(`document.querySelector('.loot-hidden-row[data-item="exp:1"]').textContent`), /You hid this/);
      await run(`document.querySelector('[aria-label="Show Mining EXP"]').click(); 1`);
      assert.equal(await run(`'exp:1' in lootFilter`), false);
      assert.ok(await run(`!!document.querySelector('[aria-label="Hide Mining EXP"]')`));
    });
    await test('a played character runs on from the save, not from an older AFK start; anyone else keeps theirs', async () => {
      const others = await run(`rows.filter(r => r.slot !== ${slot} && r.slot != null).map(r => r.slot)`), other = others[0];
      await h.bump((d, at) => { d['PTimeAway_' + slot] = (at - 36e5) / 1e6; d['PTimeAway_' + other] = (at - 72e5) / 1e6; });
      await h.poll(); await sleep(500);
      const seen = await run(`(() => { const pick = s => tasks.find(t => t.slot === s && (t.type === 'class' || t.type === 'skill')); const a = pick(${slot}), b = pick(${other}); return { playing: taskPlaying(a), at: saveFacts().at, mine: taskView(a).startedAt, active: taskIsActive(b), theirs: b && taskView(b).startedAt, since: rows.find(r => r.slot === ${other}).afkSince }; })()`);
      assert.equal(seen.playing, true, JSON.stringify(seen));
      assert.equal(seen.mine, seen.at, JSON.stringify(seen));
      if (seen.active) assert.equal(seen.theirs, seen.since, JSON.stringify(seen));
    });
    await test('Reset clears EXP too', async () => {
      await h.api('api/loot/reset', 'POST');
      assert.deepEqual((await run(`api('/api/loot')`)).active.exp, []);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
    await run(`showTab('loot'); 1`);
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
