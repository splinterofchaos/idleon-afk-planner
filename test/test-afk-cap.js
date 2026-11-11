// Unending Energy caps AFK gains at 10 hours: a task to collect them, only for characters wearing it who aren't being played. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
const J = JSON.stringify;
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 600)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, width: 1400, height: 900 }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(600);
    // Three characters doing something who aren't the one being played, and the one being played.
    const live = await run(`activePlayerSlot()`);
    const [a, b, c] = await run(`rows.filter(r => r.slot != null && r.slot !== ${live} && kindOf(r) !== 'idle').map(r => r.slot).slice(0, 3)`);
    assert.ok(c != null, 'need three busy characters in the fake save');
    const now = Date.now() / 1e6, H = 36e5 / 1e6; // the save keeps this in thousands of seconds
    await h.bump(d => {
      Object.keys(d).filter(k => /^Prayers_\d+$/.test(k)).forEach(k => { d[k] = J([0, 1, -1, -1, -1]); }); // nobody wears it
      [a, b, live].forEach(s => { d['Prayers_' + s] = J([1, 2, -1, -1, -1]); });
      d['PTimeAway_' + a] = now - 3 * H; // 7 hours left
      d['PTimeAway_' + b] = now - 11 * H; // past the cap
      d['PTimeAway_' + live] = now; // still the one being played
    }); await sleep(600);
    const cap = s => run(`(() => { const t = tasks.find(x => x.type === 'afkcap' && x.slot === ${s}); if (!t) return null; const k = taskCalc(t); return { id: t.id, title: taskTitle(t), section: taskSection(t), hours: k.hours, capped: !!k.capped, line: k.line, wait: k.wait || '' }; })()`);
    await test('someone wearing Unending Energy, not being played, gets a task timed to the 10-hour cap', async () => {
      const t = await cap(a);
      assert.ok(t, 'no task');
      assert.equal(t.title, 'Unending Energy'); assert.equal(t.section, 'active');
      assert.ok(Math.abs(t.hours - 7) < 0.05, J(t)); assert.equal(t.capped, false);
      assert.match(t.line, /stops AFK gains at 10 hours/); assert.equal(await run(`taskIconName(tasks.find(x => x.id === ${J(t.id)}))`), 'Prayer2');
    });
    await test('past the cap it says to collect now, and comes first', async () => {
      const t = await cap(b);
      assert.ok(t, 'no task'); assert.equal(t.capped, true); assert.equal(t.hours, 0); assert.equal(t.wait, 'Ready!');
      const cards = await run(`[...document.querySelectorAll('.pc')].map(n => n.dataset.id)`), ia = cards.indexOf((await cap(a)).id), ib = cards.indexOf(t.id);
      assert.ok(ib >= 0 && ia >= 0, J({ ia, ib }));
      assert.ok(ib < ia, 'capped one first');
      assert.match(await run(`document.querySelector('.pc[data-id="${t.id}"]').textContent`), /Ready!/);
    });
    await test('no task without the prayer, or for whoever is being played', async () => {
      assert.equal(await cap(c), null);
      assert.equal(await cap(live), null);
      assert.equal(await run(`tasks.filter(t => t.type === 'afkcap').length`), 2);
    });
    await test('it is on that player’s Player tab and searchable, and not in Simulate', async () => {
      await run(`selectPlayer(${a}); showTab('player'); 1`); await sleep(300);
      const id = (await cap(a)).id;
      await run(`(() => { const s = $('playerSearch'); s.value = 'unending'; s.dispatchEvent(new Event('input')); return 1; })()`); await sleep(150);
      assert.deepEqual(await run(`[...document.querySelectorAll('#playerTasks .task-editor')].map(n => n.dataset.task)`), [id]);
      assert.match(await run(`document.querySelector('#playerTasks .task-editor').innerText`), /10 hours/);
      await run(`(() => { const s = $('playerSearch'); s.value = ''; s.dispatchEvent(new Event('input')); return 1; })()`);
      await h.shot('afk-cap.png', 1400);
      await run(`showTab('simulate'); 1`); await sleep(300);
      assert.ok(!(await run(`$('viewSimulate').innerText`)).includes('Unending Energy'));
    });
    await test('switching to them takes theirs away, and the one left behind gets one', async () => {
      await h.bump(d => { d['PTimeAway_' + a] = Date.now() / 1e6; }); await sleep(600);
      assert.equal(await run(`activePlayerSlot()`), a);
      assert.equal(await cap(a), null);
      const left = await run(`(() => { const r = rows.find(x => x.slot === ${live}); return kindOf(r) !== 'idle'; })()`);
      if (left) assert.ok(await cap(live), 'the one switched away from');
    });
    await test('taking the prayer off takes the task away', async () => {
      await h.bump(d => { d['Prayers_' + b] = J([1, -1, -1, -1, -1]); }); await sleep(600);
      assert.equal(await cap(b), null);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
