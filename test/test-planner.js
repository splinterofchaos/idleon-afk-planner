// Planner agent's tests: $env:BUILD_DIST='dist-planner'; node test-planner.js [--shots]
const assert = require('assert'), { start, sleep } = require('./harness');
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').slice(0, 4).join('\n      ')); } };
(async () => {
  const h = await start({ noPoll: true, oldFields: true }), run = h.run;
  const J = JSON.stringify, ed = (id, f) => `.task-editor[data-task="${id}"] [data-field="${f}"]`, one = (id, s) => `.task-editor[data-task="${id}"] ${s}`;
  const taskId = key => run(`(tasks.find(t => t.key === ${J(key)}) || {}).id`);
  const text = s => run(`(document.querySelector(${J(s)}) || {}).textContent`);
  const val = s => run(`document.querySelector(${J(s)}).value`);
  const has = s => run(`!!document.querySelector(${J(s)})`);
  const task = (id, f) => run(`tasks.find(t => t.id === ${J(id)})${f ? '.' + f : ''}`);
  const pick = slot => run(`selectPlayer(${J(slot)}); 1`);
  const pickReal = slot => run(`(() => { const s = $('plannerWho'); s.focus(); s.value = ${J(String(slot))}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const addGoal = async (value, amount = '') => {
    await run(`(() => { const s = $('planAddWhat'); s.value = ${J(value)}; if (s.value !== ${J(value)}) throw new Error('no option ' + ${J(value)}); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    if (amount) await h.type('#planAddAmount', amount);
    await h.click('#planAddGo');
    await sleep(40);
  };
  const options = () => run(`[...$('planAddWhat').querySelectorAll('optgroup')].map(g => [g.label, [...g.querySelectorAll('option')].map(o => o.textContent)])`);
  const fieldsOf = id => run(`[...document.querySelectorAll(${J(`.task-editor[data-task="${id}"] [data-field]`)})].map(n => n.dataset.field)`);
  const labelsOf = id => run(`[...document.querySelectorAll(${J(`.task-editor[data-task="${id}"] .fld .label`)})].map(n => n.textContent)`);
  const groups = () => run(`[...document.querySelectorAll('#playerTasks .plan-group')].map(n => n.textContent.replace(/ · \\d+$/, ''))`);
  const blur = () => run('document.activeElement && document.activeElement.blur(); 1');
  const paint = () => run('paintAll(); 1');
  const st = f => `#playerTasks [data-field="${f}"]`, stat = (id, f) => run(`taskField((t => cardAsPlayer(t, selectedRow()) || t)(tasks.find(t => t.id === ${J(id)})), ${J(f)})`), home = (s, key) => run(`rates[${J(s + '|' + key)}] || {}`);
  try {
    const firstActive = await run('activePlayerSlot()');
    const other = firstActive === 3 ? 4 : 3, third = firstActive === 5 ? 6 : 5;
    await test('dropdown lists everyone and defaults to the active player, marked', async () => {
      assert.equal(await val('#plannerWho'), String(firstActive));
      const opts = await run(`[...$('plannerWho').options].map(o => [o.value, o.textContent])`);
      assert.equal(opts.length, await run('rows.length'));
      const marked = opts.filter(o => /\(active\)/.test(o[1]));
      assert.equal(marked.length, 1); assert.equal(marked[0][0], String(firstActive));
    });
    await test('picking another player stays through the active player\'s own updates', async () => {
      await pickReal(other);
      assert.equal(await run('selectedSlot()'), other);
      assert.equal(await text('#plannerWhoBox .who-name'), await run(`rows.find(r => r.slot === ${other}).name`));
      await h.setActivity(firstActive, 'w7b3', { mapIdx: 317, portalLeft: 700 });
      assert.equal(await run('selectedSlot()'), other, 'pick kept: the active character did not change');
      assert.equal(await val('#plannerWho'), String(other));
    });
    await test('following: a new active character ends the pick', async () => {
      await h.setActivity(other, 'w7b3', { mapIdx: 317, portalLeft: 5000 });
      assert.equal(await run('activePlayerSlot()'), other);
      assert.equal(await run('selectedSlot()'), other);
      await h.setActivity(third, 'w7b3', { mapIdx: 317, portalLeft: 900 });
      assert.equal(await run('selectedSlot()'), third);
      assert.equal(await val('#plannerWho'), String(third), 'the box follows, even though it still has focus');
      await blur();
    });
    const slot = third, mapKey = await run(`rows.find(r => r.slot === ${slot}).activityKey`);
    const clear = await taskId(`${slot}|clear|${mapKey}`);
    await test('head shows who, map and what they are doing', async () => {
      const head = await text('#plannerHead');
      const r = await run(`(r => ({ name: r.name, map: r.map, doing: r.doing, cls: r.cls }))(rows.find(r => r.slot === ${slot}))`);
      [r.name, r.doing, r.map, r.cls].forEach(x => assert.ok(head.includes(x), x));
      assert.ok(await has('#plannerWhoBox .portrait'));
    });
    // The editors are on the Player tab now; the AFK planner shows the activity, further down
    await run(`showTab('player'); 1`);
    await test('an editor per task, first the ones being done; fields per type', async () => {
      assert.ok(clear, 'clear task exists');
      assert.deepEqual(await fieldsOf(clear), ['kph', 'kpc', 'left'], 'its own stats are on it');
      assert.equal((await groups())[0], 'Predictions');
      assert.ok(!(await groups()).includes('Doing now'));
      const archived = await run(`tasks.filter(t => t.slot === ${slot} && taskSection(t) === 'archive').map(t => t.id)`);
      for (const id of archived) assert.ok(!(await has(`#playerTasks > .sheet .task-editor[data-task="${id}"]`)), 'archived only under Archive');
    });
    await test('there is no separate stats box', async () => {
      assert.equal(await has('.stats-box'), false);
      assert.notEqual(await run(`document.querySelector('#playerTasks .task-editor').dataset.task`), 'stats');
    });
    await test('typing kph updates the ETA and taskCalc, leaves the row alone', async () => {
      const rowBefore = await run(`rows.find(r => r.slot === ${slot}).kph`);
      await h.type(st('kph'), '100');
      const c = await run(`(c => ({ hours: c.hours, rate: c.rate, src: c.rateSource }))(taskCalc(tasks.find(t => t.id === ${J(clear)})))`);
      assert.equal(c.rate, 100); assert.equal(c.src, 'typed'); assert.ok(c.hours > 0);
      assert.equal(await run(`fmtWait(taskCalc(tasks.find(t => t.id === ${J(clear)})).hours, true).slice(0, 2)`), (await text(one(clear, '.s-wait .big'))).slice(0, 2));
      await h.type(st('kph'), '200');
      const c2 = await run(`taskCalc(tasks.find(t => t.id === ${J(clear)})).hours`);
      assert.ok(Math.abs(c.hours - c2 - 4.5) < 0.01, c2 + ' should be 4.5 h (900 left) less than ' + c.hours);
      await h.type(st('kph'), '500');
      assert.equal(await text(one(clear, '.s-rate .small')), 'kills / hour · typed');
      assert.equal(await run(`rows.find(r => r.slot === ${slot}).kph`), rowBefore, 'row kph untouched');
    });
    await test('typed kph survives a save and reload, on the activity and not the task', async () => {
      await blur();
      const saved = await h.savedSheet();
      assert.equal(saved.rates[slot + '|' + mapKey].kph, '500');
      assert.equal('kph' in saved.tasks.find(t => t.id === clear), false);
      assert.equal(saved.tasksVersion, 2);
      await h.reload();
      await pick(slot);
      assert.equal(await val(st('kph')), '500');
      assert.equal(await stat(clear, 'kph'), '500');
    });
    let card;
    await test('a typed stat is every task\'s on the activity, the real value in its box; not another player\'s', async () => {
      card = await taskId('card|w7b3'); // the account's
      if (!card) { await run(`upsertTask({ slot: ${slot}, type: 'card', monster: 'w7b3', activityKey: ${J(mapKey)}, match: { kind: 'activity', key: ${J(mapKey)} }, source: 'monster', chance: cardDropOf('w7b3')?.[1] ?? null }); render(); 1`); card = await taskId('card|w7b3'); }
      assert.deepEqual(await fieldsOf(card), ['kph', 'dr', 'mk', 'kpkTotal', 'goal'], 'its stats are on it, being done or not');
      assert.equal(await stat(card, 'kph'), '500');
      assert.equal(await run(`'kph' in tasks.find(t => t.id === ${J(card)})`), false, 'not written to it');
      const theirs = await run(`rowStat(rows.find(r => r.slot === ${other}), 'kph')`), elsewhere = (await home(slot, 'DIVINITY|Divinity')).xph;
      assert.notEqual(theirs, '600');
      await h.type(st('kph'), '600');
      await blur();
      for (const i of [clear, card]) assert.equal(await stat(i, 'kph'), '600', 'both read it');
      assert.equal(await text(one(clear, '.s-rate .big')), await run('fmtRate(600)'));
      await run(`simulateTask(${J(card)}); 1`);
      assert.equal(await val('#simEditor [data-field="kph"]'), '600', 'a real value in the box');
      assert.equal(await run(`document.querySelector('#simEditor [data-field="kph"]').placeholder`), '12k', 'the hint is still only a hint');
      await run(`simPick(''); paintSimulate(); 1`); // else its copy of the editor stays in the page, hidden
      await run(`showTab('player'); 1`);
      assert.equal(await run(`rowStat(rows.find(r => r.slot === ${other}), 'kph')`), theirs, 'another player on the same monster');
      assert.equal((await home(slot, 'DIVINITY|Divinity')).xph, elsewhere, 'another activity');
      await pick(slot);
      assert.equal(await val(st('kph')), '600');
      await h.type(st('kph'), '500');
      await blur();
    });
    await test('clearing the box clears it for all of them, with no number coming back', async () => {
      await h.type(st('kph'), '');
      assert.equal(await stat(clear, 'kph'), '');
      assert.equal(await stat(card, 'kph'), '');
      await blur();
      await paint();
      assert.equal(await val(st('kph')), '');
      assert.equal(await text(one(clear, '.s-wait .pill')), 'Enter kills / hour');
      await h.type(st('kph'), '500');
      await blur();
      await paint();
    });
    await test('dr and mk in the box write the activity and the row; Real kills shows', async () => {
      await h.type(st('dr'), '4');
      await h.type(st('mk'), '100');
      await blur();
      assert.deepEqual(await run(`(r => [r.dr, r.mk])(rows.find(r => r.slot === ${slot}))`), ['4', '100']);
      const box = await home(slot, mapKey);
      assert.deepEqual([box.dr, box.mk], ['4', '100']);
      assert.equal(await stat(card, 'mk'), '100');
      await paint();
      assert.match(await text(one(card, '.s-real')), /^Real kills: .*250 per hour$/);
      assert.equal(await run(`document.querySelector(${J(one(clear, '.s-real'))}).hidden`), false);
    });
    await test('bad numbers are flagged', async () => {
      await h.type(ed(clear, 'kpc'), 'abc');
      assert.equal(await run(`document.querySelector(${J(ed(clear, 'kpc'))}).getAttribute('aria-invalid')`), 'true');
      await h.type(ed(clear, 'kpc'), '40');
      assert.equal(await run(`document.querySelector(${J(ed(clear, 'kpc'))}).getAttribute('aria-invalid')`), 'false');
      await blur();
    });
    await test('blanking kills left goes back to the game count', async () => {
      await h.type(ed(clear, 'left'), '123');
      assert.equal(await task(clear, 'leftAuto'), false);
      await h.type(ed(clear, 'left'), '');
      await blur();
      await paint();
      assert.equal(await val(ed(clear, 'left')), '900');
      assert.equal(await task(clear, 'leftAuto'), true);
    });
    await test('Enter and arrows jump to the same field in the next editor', async () => {
      const where = () => run(`document.activeElement.closest('.task-editor').dataset.task + document.activeElement.dataset.field`);
      const goalOf = (monster, name) => run(`upsertTask({ slot: ${slot}, type: 'clear', monster: ${J(monster)}, afkId: ${J(monster)}, activityKey: ${J('FIGHTING|' + name)}, match: { kind: 'activity', key: ${J('FIGHTING|' + name)} }, left: '1000', starred: true }).id`); // this player's own, each with its kills / hour
      const a = await goalOf('mushG', 'Green Mushroom'), b = await goalOf('frogG', 'Frog');
      await run('render(); 1');
      const [first, second] = await run(`[...document.querySelectorAll('#playerTasks .task-editor')].map(n => n.dataset.task).filter(x => [${J(a)}, ${J(b)}].includes(x))`);
      assert.ok(first && second, 'both goals have editors');
      await h.type(st('kph'), '500');
      await blur();
      await h.type(ed(first, 'kph'), '300');
      await h.key('Enter');
      assert.equal(await where(), second + 'kph', 'from one goal to the next');
      await h.key('ArrowUp');
      assert.equal(await where(), first + 'kph');
      await h.key('ArrowDown');
      assert.equal(await where(), second + 'kph');
      await h.key('Enter');
      assert.equal(await run('document.activeElement === document.body'), true, 'the last one leaves the box');
      assert.equal(await val(ed(first, 'kph')), '300');
      assert.equal(await val(st('kph')), '500', 'the goal’s own activity, not this one');
      await run(`taskEdit(tasks.find(t => t.id === ${J(first)}), 'kph', ''); deleteTask(${J(a)}); deleteTask(${J(b)}); render(); 1`);
      assert.ok(!(await has(`.task-editor[data-task="${a}"]`)));
      await h.type(ed(clear, 'kpc'), '40'); // a box no later editor has: Enter leaves it
      await h.key('Enter');
      assert.equal(await run('document.activeElement === document.body'), true);
    });
    await test('typing is not lost across paint ticks or a forced poll', async () => {
      await h.type(ed(clear, 'kpc'), '77');
      const node = `document.querySelector(${J(ed(clear, 'kpc'))})`;
      await run(`window.__box = ${node}; 1`);
      await sleep(2300);
      await h.poll();
      await h.bump({});
      await run('render(); 1');
      assert.equal(await run(`window.__box === ${node} && document.activeElement === window.__box`), true, 'same box, still focused');
      assert.equal(await val(ed(clear, 'kpc')), '77');
      await run(`document.execCommand('insertText', false, '8'); 1`);
      assert.equal(await val(ed(clear, 'kpc')), '778');
      await sleep(1200);
      assert.equal(await task(clear, 'kpc'), '778');
      await blur();
    });
    await test('typing a stat on a card is not lost across paint ticks, a forced poll, or the game moving on', async () => {
      await h.type(st('kph'), '77');
      const node = `document.querySelector(${J(st('kph'))})`;
      await run(`window.__box = ${node}; 1`);
      await sleep(2300);
      await h.poll();
      await h.bump({});
      await run('render(); 1');
      assert.equal(await run(`window.__box === ${node} && document.activeElement === window.__box`), true, 'same box, still focused');
      assert.equal(await val(st('kph')), '77');
      await h.send('Input.insertText', { text: '8' });
      assert.equal(await val(st('kph')), '778');
      await sleep(1200);
      assert.equal(await stat(clear, 'kph'), '778');
      assert.equal(await run(`window.__box === ${node} && document.activeElement === window.__box`), true, 'after the tick too');
      assert.equal(await text(one(clear, '.s-rate .big')), await run('fmtRate(778)'), 'the task below moved with it');
      await h.setActivity(slot, 'Divinity', { mapIdx: 200 }); // arrives while the box is in use
      assert.equal(await run(`window.__box === ${node} && document.activeElement === window.__box`), true, 'held back');
      await h.send('Input.insertText', { text: '9' });
      assert.equal((await home(slot, mapKey)).kph, '7789', 'the last keys still go to the activity on screen');
      await blur();
      await h.bump({});
      await pick(slot);
      assert.equal(await has(st('xph')), true, 'caught up once left');
      assert.equal((await home(slot, mapKey)).kph, '7789');
      assert.equal(await run(`(rates[${J(slot + '|DIVINITY|Divinity')}] || {}).kph ?? null`), null, 'none of it went to Divinity');
      await h.setActivity(slot, 'w7b3', { mapIdx: 317, portalLeft: 900 });
      await pick(slot);
      assert.equal(await val(st('kph')), '7789', 'a stat survives leaving and coming back');
      await h.type(st('kph'), '500');
      await blur();
      await paint();
    });
    await test('a scrub by real mouse moves the value, and back to zero cancels', async () => {
      await h.type(ed(clear, 'left'), '500');
      await blur();
      const typedAt = await task(clear, 'typedAt');
      await sleep(30);
      const b = await run(`(() => { const n = document.querySelector(${J(one(clear, '[data-scrub]'))}); n.scrollIntoView({ block: 'center' }); const b = n.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      const mouse = (type, x, extra) => h.send('Input.dispatchMouseEvent', { type, x, y: b.y, button: 'left', buttons: 1, ...extra });
      await mouse('mouseMoved', b.x, { button: 'none', buttons: 0 });
      await mouse('mousePressed', b.x, { clickCount: 1 });
      await mouse('mouseMoved', b.x + 30);
      assert.equal(await val(ed(clear, 'left')), '505');
      await sleep(1200); // a paint tick mid-drag
      assert.equal(await val(ed(clear, 'left')), '505');
      assert.equal(await run('!!scrub'), true);
      await mouse('mouseMoved', b.x + 2);
      await mouse('mouseReleased', b.x + 2, { clickCount: 1, buttons: 0 });
      assert.equal(await val(ed(clear, 'left')), '500');
      assert.equal(await task(clear, 'typedAt'), typedAt, 'cancelled as if never touched');
      assert.equal(await run('scrub'), null);
      await mouse('mouseMoved', b.x, { button: 'none', buttons: 0 });
      await mouse('mousePressed', b.x, { clickCount: 1 });
      await mouse('mouseMoved', b.x - 60);
      await mouse('mouseReleased', b.x - 60, { clickCount: 1, buttons: 0 });
      assert.equal(await val(ed(clear, 'left')), '490');
      assert.equal(await task(clear, 'left'), '490');
      await h.type(ed(clear, 'left'), '');
      await blur();
    });
    await test('star from the editor, moves between sections', async () => {
      assert.equal(!!(await task(card, 'starred')), false);
      await h.click(one(card, '[data-star]'));
      assert.equal(await task(card, 'starred'), true);
      assert.equal(await run(`document.querySelector(${J(one(card, '[data-star]'))}).getAttribute('aria-pressed')`), 'true');
      assert.equal(await run(`document.activeElement === document.querySelector(${J(one(card, '[data-star]'))})`), true, 'keeps focus');
      await h.setActivity(slot, 'Divinity', { mapIdx: 200 });
      await pick(slot);
      assert.notEqual(await run(`taskSection(tasks.find(t => t.id === ${J(card)}))`), 'archive', 'the starred card stays, the account\u2019s');
      assert.ok(!(await has(`.task-editor[data-task="${card}"]`)), 'not in the list of a player who isn\u2019t on it');
      assert.ok(!(await has(`#playerTasks > .sheet .task-editor[data-task="${clear}"]`)), 'unstarred clear is archived');
    });
    await test('exp editor on Divinity: EXP / hour and EXP left', async () => {
      const id = await run(`(tasks.find(t => t.slot === ${slot} && t.type === 'exp' && taskIsActive(t)) || {}).id`);
      assert.ok(id, await run(`tasks.filter(t => t.slot === ${slot} && taskIsActive(t)).map(t => t.key).join()`));
      assert.deepEqual(await fieldsOf(id), ['xph', 'left']);
      await h.type(st('xph'), '1k');
      assert.equal(await stat(id, 'xph'), '1k');
      await h.type(ed(id, 'left'), '5k');
      await blur();
      await paint();
      assert.equal(await text(one(id, '.s-left .lvl')), 'EXP');
      assert.ok(/h|m/.test(await text(one(id, '.s-wait .big'))));
    });
    await test('skill editor: +5 locks in on change and shows Lv current to target', async () => {
      await h.setActivity(slot, 'Prehistrium', { mapIdx: 305 });
      await pick(slot);
      const t = await run(`(t => t && ({ id: t.id }))(tasks.find(t => t.slot === ${slot} && t.type === 'skill' && taskIsActive(t)))`);
      assert.ok(t, 'skill task on Prehistrium');
      assert.deepEqual(await fieldsOf(t.id), ['xph', 'goal']);
      const P = `${slot}|MINING|Prehistrium`;
      await run(`delete rates[${J(P)}]; rates[${J(slot + '|kind:1')}] = { xph: '2k' }; paintAll(); 1`); // from a sheet that kept rates by kind
      assert.equal(await stat(t.id, 'xph'), '2k');
      assert.equal(await val(st('xph')), '2k', 'the box shows the rate the task is using');
      await run(`delete rates[${J(slot + '|kind:1')}]; 1`);
      await h.type(st('xph'), '4k');
      assert.equal(await stat(t.id, 'xph'), '4k');
      assert.equal(await run(`'xph' in tasks.find(t => t.id === ${J(t.id)})`), false);
      await blur();
      const level = await run(`taskView(tasks.find(t => t.id === ${J(t.id)})).lvl`);
      await h.type(ed(t.id, 'goal'), '+5');
      assert.equal(await val(ed(t.id, 'goal')), '+5', 'unchanged while typing');
      await h.key('Tab');
      await paint();
      assert.equal(await val(ed(t.id, 'goal')), String(+level + 5));
      assert.equal(await task(t.id, 'goal'), String(+level + 5));
      const shown = await run(`taskCalc(tasks.find(t => t.id === ${J(t.id)})).level`);
      assert.equal(await text(one(t.id, '.s-left .lvl')), 'EXP · Lv ' + shown + ' → ' + (+level + 5));
      await h.type(ed(t.id, 'goal'), '+x');
      assert.equal(await run(`document.querySelector(${J(ed(t.id, 'goal'))}).getAttribute('aria-invalid')`), 'true');
      await h.type(ed(t.id, 'goal'), '');
      await blur();
      await paint();
      assert.ok((await text(one(t.id, '.s-left .lvl'))).endsWith(' → ' + (+level + 1)), 'blank is the next level');
    });
    /* ----- the AFK planner: the activity, its drops and its cards ----- */
    const A = s => '#plannerTasks ' + s, box = f => A(`input[data-stat="${f}"]`), tcard = id => A(`.tcard[data-task="${id}"]`);
    await test('the planner is the activity: its boxes once, its tasks as read-only cards, no editors and no Add a goal box', async () => {
      await h.setActivity(slot, 'w7b3', { mapIdx: 317, portalLeft: 900 });
      await run(`showTab('planner'); 1`);
      await pick(slot);
      await paint();
      assert.ok(await has(A('.act-pane')));
      assert.deepEqual(await run(`[...document.querySelectorAll(${J(A('.act-fields input'))})].map(n => n.dataset.stat)`), ['kph', 'mk', 'dr', 'kpkTotal', 'xph']);
      assert.deepEqual([await val(box('kph')), await val(box('dr')), await val(box('mk'))], ['500', '4', '100'], 'the activity kept them through Divinity and a skill: ' + J([await val(box('kph')), await val(box('dr')), await val(box('mk'))]));
      assert.equal(await has(A('.task-editor')), false, 'no editors here');
      assert.equal(await run(`!!$('planAddWhat')`), false, 'no Add a goal box');
      assert.ok(await has(tcard(clear)), 'the clear task is a card');
      assert.equal(await run(`document.querySelectorAll(${J(tcard(clear) + ' input')}).length`), 0, 'read only');
      assert.equal(await text(A('.plan-group')), 'Tasks on this activity');
    });
    await test('a box is every task’s on the activity: the cards move with it, and one missing points back at it', async () => {
      await h.type(box('kph'), '200');
      await blur();
      await paint();
      assert.equal((await home(slot, mapKey)).kph, '200');
      assert.equal(await stat(clear, 'kph'), '200');
      assert.notEqual(await run(`rows.find(r => r.slot === ${slot}).kph`), '200', 'not the row');
      assert.notEqual(await text(tcard(clear) + ' .tcard-wait'), '–');
      await h.type(box('kph'), '');
      await blur();
      await paint();
      assert.equal(await text(tcard(clear) + ' .tcard-note'), '← Enter kills / hour');
      assert.ok(await run(`document.querySelector(${J(box('kph'))}).closest('.act-fld').classList.contains('want')`), 'the box it needs is marked');
      await h.type(box('kph'), '500');
      await blur();
      await paint();
      assert.ok(!(await run(`document.querySelector(${J(box('kph'))}).closest('.act-fld').classList.contains('want')`)));
      await h.type(box('dr'), 'abc');
      assert.equal(await run(`document.querySelector(${J(box('dr'))}).getAttribute('aria-invalid')`), 'true', 'bad numbers are flagged');
      await h.type(box('dr'), '4');
      await blur();
    });
    await test('kills per kill and real kills follow the boxes', async () => {
      await paint();
      const kpk = await run('killsPerKill(actRow().slot, null, actStat(actRow())).value');
      assert.equal(await run(`document.querySelector(${J(box('kpkTotal'))}).placeholder`), await run(`fmtRate0(killsPerKill(actRow().slot, null, actStat(actRow())).worked)`), 'the worked-out figure until one is typed');
      assert.equal(await text(A('[data-d="real"] b')), await run(`fmtRate(500 / ${kpk}) + '/h'`));
      assert.ok(await has(A('.act-pane .kpk-how')), 'how it’s worked out is on the activity');
    });
    await test('a blank drop rate is the team’s average; a blank or 0 multikill is the average typed on that map', async () => {
      const R = s => `rows.find(r => r.slot === ${s})`, st = `rowStatTask(${R(slot)})`;
      const drs = await run(`rows.filter(r => r.slot != null).map(r => parseNum(rowStat(r, 'dr'))).filter(n => n > 0)`);
      await run(`setRowStat(${R(slot)}, 'dr', ''); ${R(slot)}.dr = ''; statGuessKept.at = 0; 1`);
      const left = await run(`rows.filter(r => r.slot != null).map(r => parseNum(rowStat(r, 'dr'))).filter(n => n > 0)`);
      const avg = left.reduce((a, b) => a + b, 0) / left.length;
      assert.ok(left.length > 0, J(drs));
      assert.ok(Math.abs(+(await run(`taskField(${st}, 'dr')`)) - avg) < 1e-6, 'the sums use the team average');
      assert.equal(await run(`rowStat(${R(slot)}, 'dr')`), '', 'the box stays blank');
      await paint();
      assert.equal(await run(`document.querySelector(${J(box('dr'))}).placeholder`), await run(`fmtRate(${avg})`));
      assert.equal(await text(A('.act-fld[data-stat="dr"] .act-hint')), 'team average');
      // multikill: others on the same map
      const key = await run(`${R(slot)}.activityKey`), others = await run(`rows.filter(r => r.slot != null && r.slot !== ${slot}).slice(0, 2).map(r => r.slot)`);
      await run(`rates[${J(others[0] + '|' + key)}] = { ...(rates[${J(others[0] + '|' + key)}] || {}), mk: '1000' }; rates[${J(others[1] + '|' + key)}] = { ...(rates[${J(others[1] + '|' + key)}] || {}), mk: '3000' }; Object.keys(rates).filter(k => k.endsWith('|' + ${J(key)}) && ![${J(others[0] + '|' + key)}, ${J(others[1] + '|' + key)}].includes(k)).forEach(k => { if (rates[k].mk) rates[k].mk = '0'; }); statGuessKept.at = 0; 1`);
      await run(`setRowStat(${R(slot)}, 'mk', ''); statGuessKept.at = 0; 1`);
      assert.equal(await run(`taskField(${st}, 'mk')`), '2000', 'blank: the map’s average of 1000 and 3000');
      assert.equal(await run(`rowStat(${R(slot)}, 'mk')`), '', 'the box stays blank');
      assert.equal(await run(`statGuess(rowStatTask(${R(slot)}), 'mk')`), 2000);
      await run(`statGuessKept.at = 0; 1`);
      assert.equal(await run(`statGuess({ slot: ${slot}, activityKey: 'FIGHTING|Nobody Here' }, 'mk')`), null, 'a map nobody’s typed: none');
      await h.type(box('dr'), '4');
      await h.type(box('mk'), '0');
      await blur();
      assert.equal(await run(`taskField(${st}, 'mk')`), '2000', 'a 0 counts as not filled in');
      assert.equal(await text(A('.act-fld[data-stat="mk"] .act-hint')), 'map average');
      await h.type(box('mk'), '100');
      await blur();
    });
    await test('drops as the game lists them: most common first, 1 in N rounded up, words from ten million', async () => {
      assert.deepEqual(await run(`[0.00033, 0.001, 1e-7, 5e-9, 1.25e-6, 1e-12].map(dropOdds)`), ['1 in 3,031', '1 in 1,000', '1 in 10 million', '1 in 200 million', '1 in 800,000', '1 in 1 trillion']);
      // multikill: the Dragon statue on the golems' own list rolls per counted kill; their dungeon Temple Torch only per real kill, as a claim showed
      assert.deepEqual(await run(`[dropIsCommon('caveC', 'Dragon Warrior Statue'), dropIsCommon('caveC', 'Temple Torch (Dungeon)')]`), [true, false]);
      const tiles = await run(`[...document.querySelectorAll(${J(A('.act-drops'))})[0].querySelectorAll('.act-drop')].map(n => [n.dataset.item, n.querySelector('.act-odds').textContent])`);
      const want = await run(`[...DROPS.w7b3].sort((a, b) => b[1] - a[1])[0]`);
      assert.deepEqual(tiles[0], [want[0], await run(`dropOdds(${want[1]})`)]);
      assert.match(await text(A(`.act-drop[data-item="${want[0]}"] .act-rate`)), /\/ hr$/, 'a rate from the boxes');
      assert.deepEqual(await run(`[...document.querySelectorAll(${J(A('.act-drops-head .label'))})].map(n => n.textContent)`), ['Drops', 'Rare drop · 1 in 1,000', 'Rarer table inside it · 1 in 200,000', await run('monsterName("Crystal6") + " drops"')], 'the monster’s own, each table beneath it, then the world’s crystals');
      assert.deepEqual(await run(`[...document.querySelectorAll(${J(A('.act-drops'))})[2].querySelectorAll('.act-drop')].map(n => n.dataset.item).sort()`), ['Luckiest Lad', 'Reef Coral Statue'], 'the rarer table on its own');
      assert.equal(await has(A('.act-drop[data-item="Virtuoso Recipe"]')), false, 'a drop that comes only once isn’t listed, as in the game');
    });
    await test('+ Goal on a drop makes a task; its chip changes it; Escape leaves it', async () => {
      const name = await run(`[...DROPS.w7b3].sort((a, b) => b[1] - a[1]).find(d => !/ Card$/.test(d[0]) && !tasks.some(t => t.key === 'item|' + d[0]))[0]`), tile = A(`.act-drop[data-item="${name}"]`);
      await h.click(tile + ' .act-add');
      assert.equal(await run(`document.activeElement === document.querySelector(${J(tile + ' .act-goal-form input')})`), true, 'a box in its place, focused');
      await h.type(tile + ' .act-goal-form input', '50k');
      await h.key('Enter');
      await paint();
      const t = await run(`tasks.find(t => t.key === ${J('item|' + name)})`);
      assert.equal(t.amount, '50k'); assert.equal(t.starred, true); assert.equal(t.source, 'monster'); assert.equal(t.slot, null); assert.equal(t.auto, false);
      assert.equal(await text(tile + ' .act-chip'), await run('fmtNum(50000)'));
      assert.ok(await has(tcard(t.id)), 'its card is in the column');
      assert.equal(await text(tcard(t.id) + ' .tcard-title'), 'Collect 50K ' + name);
      await h.click(tile + ' .act-chip');
      assert.equal(await val(tile + ' .act-goal-form input'), '50k');
      await h.type(tile + ' .act-goal-form input', '60k');
      await h.key('Enter');
      assert.equal(await task(t.id, 'amount'), '60k');
      await h.click(tile + ' .act-chip');
      await h.type(tile + ' .act-goal-form input', '1');
      await h.key('Escape');
      assert.equal(await task(t.id, 'amount'), '60k', 'Escape changes nothing');
      assert.ok(await has(tile + ' .act-chip'));
    });
    await test('a card drop’s goal is its stars; the class level goal sits under Class EXP / hour', async () => {
      const cardName = await run(`cardDropOf('w7b3')[0]`), tile = A(`.act-drop[data-item="${cardName}"]`);
      await h.click(tile + ' .act-chip, ' + tile + ' .act-add');
      await h.type(tile + ' .act-goal-form input', '3');
      await h.key('Enter');
      const c = await run(`tasks.find(t => t.key === 'card|w7b3')`);
      assert.equal(c.goal, await run(`cardGoalLimit('w7b3', '3')`)); assert.equal(c.starred, true);
      assert.equal(await text(tile + ' .act-chip'), c.goal + '★');
      const lvl = await run(`rows.find(r => r.slot === ${slot}).classLvl`), xph = A('.act-fld[data-stat="xph"]');
      await h.click(xph + ' .act-chip, ' + xph + ' .act-add');
      await h.type(xph + ' .act-goal-form input', '+5');
      await h.key('Enter');
      const k = await run(`tasks.find(t => t.key === ${J(slot + '|class')})`);
      assert.equal(k.goal, String(+lvl + 5), '+5 locks in'); assert.equal(k.starred, true);
      assert.equal(await text(xph + ' .act-chip'), 'Lv ' + (+lvl + 5));
      await h.type(box('xph'), '20k');
      await blur();
      assert.equal(await stat(k.id, 'xph'), '20k', 'the class task reads the activity’s box');
    });
    await test('a card click opens the task on the Player tab', async () => {
      await h.click(tcard(clear));
      assert.equal(await run(`$('viewPlayer').hidden`), false);
      assert.ok(await run(`document.querySelector('#playerTasks .task-editor[data-task="${clear}"]').classList.contains('jump')`));
      await run(`showTab('planner'); 1`);
    });
    await test('Royal Guardian: what comes straight to them is a tile without odds', async () => {
      await h.setActivity(7, 'fm_rat', { mapIdx: 43 });
      await pick(7);
      for (const item of [await run('ITEMS.RGenh'), await run('ITEMS.Orblet')]) assert.equal(await text(A(`.act-drop[data-item="${item}"] .act-odds`)), '', item);
      await h.setActivity(7, 'w7b3', { mapIdx: 317 });
      await pick(7);
      assert.ok(await has(A(`.act-drop[data-item="${await run('ITEMS.Orblet')}"]`)), 'Orblets come from anywhere');
      assert.equal(await has(A(`.act-drop[data-item="${await run('ITEMS.RGenh')}"]`)), false, 'Parchment only at the castle');
    });
    await test('short sentences where nothing can be added', async () => {
      await h.setActivity(4, 'Nothing', { active: false });
      await pick(4);
      assert.ok(/idle/.test(await text(A('.act-pane .plan-note'))), await text(A('.act-pane')));
      await run('(window.__s = saveForFinder, saveForFinder = null, actShown = null, render(), 1)');
      assert.ok(/game data/.test(await text(A('.act-pane .plan-note'))), await text(A('.act-pane')));
      await run('(saveForFinder = window.__s, actShown = null, render(), 1)');
      await pick(slot);
      await run(`showTab('player'); 1`);
    });
    await test('a shared card: the editor shows the sum, who counts, and when it finishes', async () => {
      const R = s => `rows.find(r => r.slot === ${s})`, K = id => `tasks.find(t => t.id === ${J(id)})`;
      const stats = (s, kph, dr, mk) => run(`setRowStat(${R(s)}, 'kph', '${kph}'); setRowStat(${R(s)}, 'dr', '${dr}'); setRowStat(${R(s)}, 'mk', '${mk}'); 1`);
      await h.bump(d => { const c = JSON.parse(d.Cards0); c.mushG = 8; d.Cards0 = JSON.stringify(c); }); // chance 0.002; rank 7 at 75645, 75637 to go
      for (const s of [3, 5]) await h.setActivity(s, 'mushG', { mapIdx: 1, active: false });
      await run('lootNow = null; 1'); // the formula's numbers, not the fake game's session
      await stats(3, '1000', '2', '100'); // 1000 / 2 x 0.002 x 2 = 2 / hour
      await stats(5, '6000', '1', '100'); // 6000 / 2 x 0.002 x 1 = 6 / hour (a 0 multikill would be the map's average)
      const a = await taskId('card|mushG'); // the account's
      await run(`taskEdit(${K(a)}, 'goal', '6'); 1`);
      await pick(3);
      await paint();
      const finish = hours => run(`(() => { const now = Date.now(), at = saveFacts().at + ${hours} * 36e5; paintAll(); return fmtClock(at, now); })()`);
      const shown = () => run(`(n => [n.querySelector('.s-rate .big').textContent, n.querySelector('.s-rate .small').textContent, n.querySelector('.s-finish .finish').textContent, n.querySelector('.s-finish .small').textContent])(document.querySelector(${J(`.task-editor[data-task="${a}"]`)}))`);
      let want = await finish(75637 / 8), got = await shown();
      assert.deepEqual(got, ['8', 'cards / hour · estimate · 2 of 2 players', want, '']);
      await run(`setRowStat(${R(3)}, 'kph', ''); 1`); // this player has none now: the other's 6. (A blank drop rate would be the team's average.)
      want = await finish(75637 / 6); got = await shown();
      assert.deepEqual(got, ['6', 'cards / hour · estimate · 1 of 2 players', want, '']);
      await run(`setRowStat(${R(5)}, 'kph', ''); 1`);
      await paint();
      assert.equal(await run(`document.querySelector(${J(`.task-editor[data-task="${a}"] .s-rate`)}).hidden`), true);
      assert.equal(await text(one(a, '.s-wait .pill')), "Enter AFK stats for who's on it"); // the account's card: nobody counts
      await stats(3, '1000', '2', '100'); await stats(5, '6000', '1', '100');
      await run(`toggleStar(${K(a)}); 1`);
      await h.setActivity(3, 'Divinity', { mapIdx: 200, active: false }); // the other still on it
      await pick(3);
      assert.ok(!(await has(`.task-editor[data-task="${a}"]`)), 'the account’s card isn’t in the list of a player who left it');
      await pick(5);
      want = await finish(75637 / 6); got = await shown();
      assert.deepEqual(got, ['6', 'cards / hour · estimate', want, ''], 'only who’s on it, timed from the save');
      await h.setActivity(5, 'frogG', { mapIdx: 3, active: false }); // nobody on it
      assert.equal(await run(`taskCalc(${K(a)}).rate`), 0, 'nobody on it: no rate');
      assert.equal(await run(`taskSection(${K(a)})`), 'goal', 'a starred goal');
      await run('lootNow = null; 1');
      await run(`toggleStar(${K(a)}); taskEdit(${K(a)}, 'goal', ''); 1`);
      await pick(slot);
    });
    await test('hand-typed rows: listed, keep their old line, no activity', async () => {
      await run(`showTab('planner'); 1`);
      const n = await run('rows.length');
      await h.click('#add');
      assert.equal(await run('rows.length'), n + 1);
      const r = await run('selectedRow().id');
      assert.equal(await run('selectedRow().slot == null'), true);
      assert.equal(await val('#plannerWho'), r);
      assert.equal(await run(`document.querySelectorAll('#rows .task').length`), 1);
      assert.equal(await run(`!!document.querySelector('#plannerTasks .act-pane')`), false);
      assert.equal(await run(`$('plannerAdd').childElementCount`), 0);
      await h.type(`#f-${r}-name`, 'Typed');
      await h.type(`#f-${r}-kph`, '100');
      assert.equal(await run(`rows.find(x => x.id === ${J(r)}).kph`), '100');
      await run(`rows.splice(rows.findIndex(x => x.id === ${J(r)}), 1); plannerPick = null; document.activeElement.blur(); render(); queueSave(); 1`);
      assert.equal(await run(`$('plannerWho').options.length`), n);
    });
    await test('select then flash, as a panel card click does', async () => {
      const id = await run(`tasks.find(t => t.slot === 7 && t.type === 'clear' && taskIsActive(t)).id`);
      await run(`selectPlayer(7); flashTask(${J(id)}); 1`);
      assert.equal(await run(`$('viewPlanner').hidden`), false);
      assert.ok(await run(`document.querySelector('#plannerTasks .tcard[data-task="${id}"]').classList.contains('jump')`));
      await run('flashTask(null); 1');
    });
    await test('a Simulate owner: drafts only, no star, same keys and stats', async () => {
      const id = await run(`tasks.find(t => t.slot === 7 && t.type === 'clear' && taskIsActive(t)).id`);
      const before = await run(`JSON.stringify(tasks.find(t => t.id === ${J(id)}))`), rowBefore = await run('JSON.stringify(rows.find(r => r.slot === 7))'), ratesBefore = await run('JSON.stringify(rates)');
      await run(`(() => {
        const box = document.createElement('div'); box.id = 'simBox'; document.querySelector('main').append(box);
        const owner = window.__sim = { task: tasks.find(t => t.id === ${J(id)}), overrides: { kph: '1k' }, sim: true, edits: [], onEdit(f, v) { this.overrides[f] = v; this.edits.push(f); } };
        box.append(buildTaskEditor(owner));
        wireTaskEditors(box, () => window.__sim);
        wireTaskEditors(box, () => null); // a second call changes nothing
        window.__simPaint = setInterval(() => paintTaskEditor(box.firstChild, owner, Date.now()), 200);
      })()`);
      assert.equal(await has('#simBox [data-star]'), false);
      assert.equal(await val('#simBox [data-field="kph"]'), '1k');
      assert.equal(await text('#simBox .s-rate .big'), await run('fmtRate(1000)'));
      await h.type('#simBox [data-field="kph"]', '2k');
      await sleep(250);
      assert.equal(await run('window.__sim.overrides.kph'), '2k');
      assert.equal(await text('#simBox .s-rate .big'), await run('fmtRate(2000)'));
      assert.equal(await val('#simBox [data-field="kph"]'), '2k');
      await h.type('#simBox [data-field="mk"]', '').catch(() => 0);
      assert.equal(await run(`JSON.stringify(tasks.find(t => t.id === ${J(id)}))`), before, 'the task is untouched');
      assert.equal(await run('JSON.stringify(rows.find(r => r.slot === 7))'), rowBefore, 'the row is untouched');
      assert.equal(await run('JSON.stringify(rates)'), ratesBefore, 'the rates are untouched');
      await run(`clearInterval(window.__simPaint); document.activeElement.blur(); $('simBox').remove(); 1`);
    });
    await test('Loot rates Multikill box reads and writes the current activity\'s multikill', async () => {
      const view = `({ active: { slot: 7, afkId: 'w7b3', mapIdx: 317, at: Date.now(), ms: 36e5, items: [{ item: 'kills', gained: 1e6, ms: 36e5, count: 0 }] }, goals: {} })`, box = '#lootResult .loot-mk input';
      await run(`window.__refresh = refreshLoot; refreshLoot = async () => {}; 1`); // the fake backend has no session to show
      await pick(7);
      await run(`setRowStat(rows.find(r => r.slot === 7), 'mk', '100'); 1`);
      await run(`showTab('loot'); paintLoot(${view}); 1`);
      assert.equal(await val(box), '100', 'reads what the stats box has');
      assert.ok(/Real kills: /.test(await text('#lootResult')), 'Real kills uses it');
      await h.type(box, '250');
      await h.key('Tab');
      assert.equal((await home(7, 'FIGHTING|Pirate Underling')).mk, '250', 'the activity\'s');
      assert.equal(await run('rows.find(r => r.slot === 7).mk'), '250', 'and the row\'s');
      await run(`showTab('planner'); 1`);
      await paint();
      await h.setActivity(7, 'frogG', { mapIdx: 3 });
      await pick(7);
      assert.equal(await run(`rowStat(rows.find(r => r.slot === 7), 'mk')`), '', 'multikill is the map’s: a new one starts blank');
      await run(`setRowStat(rows.find(r => r.slot === 7), 'mk', '33'); 1`);
      await run(`showTab('loot'); paintLoot(${view}); 1`);
      assert.equal(await val(box), '33', 'another activity, its own');
      await run(`showTab('planner'); 1`);
      await h.setActivity(7, 'w7b3', { mapIdx: 317 });
      await pick(7);
      await run(`showTab('loot'); paintLoot(${view}); 1`);
      assert.equal(await val(box), '250', 'back again');
      await run(`refreshLoot = window.__refresh; showTab('planner'); 1`);
    });
    await test('stat boxes stay usable at 400', async () => {
      await run(`showTab('planner'); 1`);
      await h.setActivity(slot, 'Prehistrium', { mapIdx: 305, active: false });
      for (const s of [7, slot]) {
        await pick(s);
        await h.setSize(400);
        await paint();
        const out = await run(`[...document.querySelectorAll('#plannerTasks .act-fields input')].map(i => i.getBoundingClientRect().width)`);
        assert.ok(out.length > 0, 'slot ' + s);
        out.forEach(w => assert.ok(w >= 60, 'a box only ' + w + ' wide'));
      }
      await h.setSize(1500);
    });
    await test('no sideways overflow at 400, 979, 1500', async () => {
      for (const slotNow of [7, 3, slot, 1]) {
        await pick(slotNow);
        for (const w of [400, 979, 1500]) {
          await h.setSize(w);
          await paint();
          const out = await run(`(() => {
            const bad = [], de = document.documentElement;
            if (de.scrollWidth > innerWidth) bad.push('page ' + de.scrollWidth);
            document.querySelectorAll('#plannerHead, #plannerTasks, #plannerAdd').forEach(box => {
              const lim = box.getBoundingClientRect().right + .5;
              box.querySelectorAll('*').forEach(n => { const b = n.getBoundingClientRect(); if (b.width && b.right > lim && !n.closest('option, optgroup')) bad.push((n.className || n.tagName) + ' ' + Math.round(b.right) + '>' + Math.round(lim)); });
            });
            document.querySelectorAll('.task-editor .stats .stat, .task-editor .stats .small, .task-editor .fld .label').forEach(n => { if (n.offsetParent && n.scrollWidth > n.clientWidth + 1) bad.push('clip ' + n.className + ' ' + n.textContent); });
            return bad.slice(0, 5);
          })()`);
          assert.deepEqual(out, [], 'slot ' + slotNow + ' at ' + w);
        }
      }
      await h.setSize(1500);
    });
    await test('no page errors', async () => { assert.deepEqual(h.pageErrors(), []); });
    if (process.argv.includes('--shots')) {
      const shot = async (name, slotNow, w, theme, height = 1000) => {
        await run(`document.documentElement.dataset.theme = ${J(theme)}; selectPlayer(${J(slotNow)}); document.activeElement.blur(); 1`);
        await h.setSize(w, height);
        await run(`$('plannerHead').scrollIntoView({ block: 'start' }); paintAll(); 1`);
        console.log(await h.shot(`planner-${name}-${w}-${theme}.png`, w, height));
        if (name === 'exp' && w === 1500) { await run(`selectPlayer(3); $('plannerAdd').scrollIntoView({ block: 'center' }); 1`); console.log(await h.shot(`planner-add-${w}-${theme}.png`, w, 700)); }
      };
      await h.setActivity(3, 'w7b3', { mapIdx: 317, portalLeft: 4000 });
      await h.setActivity(slot, 'Prehistrium', { mapIdx: 305 });
      await run(`(t => { if (t) { taskEdit(t, 'kph', '25k'); taskEdit(t, 'kpc', '40'); taskEdit(t, 'dr', '5.2'); taskEdit(t, 'mk', '40'); } })(tasks.find(t => t.slot === 3 && t.type === 'clear' && taskIsActive(t))); (t => t && (taskEdit(t, 'xph', '4k'), t.goal = '60'))(tasks.find(t => t.slot === ${slot} && t.type === 'skill' && taskIsActive(t))); (t => t && (taskEdit(t, 'xph', '2m'), t.left = '50m'))(tasks.find(t => t.slot === 1 && t.type === 'exp' && taskIsActive(t))); render(); 1`);
      await run(`selectPlayer(3); 1`);
      await addGoal('item:' + await run(`DROPS.w7b3.filter(d => !/ Card$/.test(d[0]))[0][0]`), '50k');
      await sleep(4200);
      for (const theme of ['dark', 'light']) for (const w of [1500, 400]) {
        await shot('fighter', 3, w, theme, w === 400 ? 1700 : 1000);
        await shot('guardian', 7, w, theme, w === 400 ? 2000 : 1000);
        await shot('skill', slot, w, theme);
        await shot('exp', 1, w, theme);
      }
    }
  } finally {
    console.log(`\n${passed} passed, ${failed} failed`);
    await h.close();
    process.exit(failed ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(2); });
