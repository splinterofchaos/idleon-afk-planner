// The Player tab: every task one player has, and a search over them. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
const J = JSON.stringify;
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, width: 1400, height: 900 }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(600);
    await run(`showTab('player'); 1`); await sleep(400);
    const slot = await run(`selectedRow().slot`);
    const shownIds = () => run(`[...document.querySelectorAll('#playerTasks .task-editor')].map(n => n.dataset.task).sort()`);
    const search = async q => { await run(`(() => { const s = $('playerSearch'); s.value = ${J(q)}; s.dispatchEvent(new Event('input')); return 1; })()`); await sleep(100); };
    await test('it lists every task the player has, archive included, and nobody else’s', async () => {
      const want = await run(`playerTasksOf(selectedRow()).map(t => t.id).sort()`);
      assert.ok(want.length >= 4, J(want));
      assert.deepEqual(await shownIds(), want);
      assert.ok(await run(`playerTasksOf(selectedRow()).some(t => taskSection(t) === 'archive')`), 'has an archived one');
      assert.ok(await run(`playerTasksOf(selectedRow()).every(t => t.slot === ${slot} || (ACCOUNT_TASK_TYPES.has(t.type) && t.slot == null))`));
      assert.match(await run(`$('playerCount').textContent`), /^\d+ tasks$/);
    });
    await test('the archive starts folded', async () => {
      assert.equal(await run(`document.querySelector('#playerTasks .pv-archive').open`), false);
    });
    await test('a search keeps only what matches, opens the archive, and says how many', async () => {
      const title = await run(`taskTitle(playerTasksOf(selectedRow()).find(t => t.type === 'card'))`), word = title.split(' ')[0].toLowerCase();
      await search(word.toUpperCase() + ' card');
      const ids = await shownIds(), want = await run(`playerTasksOf(selectedRow()).filter(t => playerMatches(t, playerWords(${J(word + ' card')}))).map(t => t.id).sort()`);
      assert.ok(ids.length >= 1); assert.deepEqual(ids, want);
      assert.match(await run(`$('playerCount').textContent`), /^\d+ of \d+ tasks match$/);
      await search('archive');
      assert.equal(await run(`document.querySelector('#playerTasks .pv-archive').open`), true);
      await search('zzqqxx');
      assert.match(await run(`$('playerTasks').innerText`), /No tasks match/);
      await search('');
    });
    await test('changing player shows theirs, and the planner follows', async () => {
      const other = await run(`rowsInOrder().find(r => r.slot != null && r.slot !== ${slot}).slot`);
      await run(`(() => { const s = $('playerWho'); s.value = ${J(String(other))}; s.dispatchEvent(new Event('change')); return 1; })()`); await sleep(200);
      assert.equal(await run(`selectedSlot()`), other);
      assert.deepEqual(await shownIds(), await run(`playerTasksOf(selectedRow()).map(t => t.id).sort()`));
    });
    await test('the editors work here: starring a goal moves it', async () => {
      const id = await run(`(() => { const t = playerTasksOf(selectedRow()).find(t => taskSection(t) === 'archive' && t.type !== 'item' && !t.hidden && !neverCounted(t)); return t ? t.id : null; })()`);
      if (!id) return; // nothing to star on this player
      await run(`document.querySelector('#playerTasks .pv-archive').open = true; 1`); await sleep(100);
      await run(`document.querySelector('#playerTasks .task-editor[data-task=${J(id)}] [data-star]').click(); 1`); await sleep(200);
      assert.notEqual(await run(`taskSection(tasks.find(t => t.id === ${J(id)}))`), 'archive');
    });
    await test('the tab is kept after a reload, and nothing scrolls sideways at phone width', async () => {
      assert.equal(await run(`localStorage.getItem(LOCAL_KEY + '-tab')`), 'player');
      await h.shot('player-tab.png', 1400);
      await h.shot('player-tab-phone.png', 380, 900);
      await h.setSize(380);
      assert.ok(await run(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`), 'no sideways scroll');
      await h.setSize(1400);
    });
    await test('no team sheet on the Player tab', async () => assert.equal(await run(`!!document.querySelector('#teamSheet, .pv-team')`), false));
    await test('a snapshot is kept by itself for the day, and one more when asked', async () => {
      const first = await run(`api('/api/snapshots')`);
      assert.equal(first.filter(s => s.kind === 'auto').length, 1, J(first));
      const made = await run(`api('/api/snapshots', 'POST')`), list = await run(`api('/api/snapshots')`);
      assert.equal(made.kind, 'manual');
      assert.equal(list.length, first.length + 1);
      const snap = await run(`api('/api/snapshots/' + ${J(made.id)})`);
      assert.ok(Object.keys(snap.data).some(k => k.startsWith('Lv0_')), 'holds the save');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
