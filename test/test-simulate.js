// Simulate agent's tests, and the real joins between panel, planner and Simulate: node test-simulate.js
const assert = require('assert'), { start, sleep } = require('./harness');
let passed = 0, failed = 0;
const test = async (name, fn) => { try { if (globalThis.__panelStub) await globalThis.__panelStub(); await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').slice(0, 5).join('\n      ')); } };
const near = (a, b, what, within = 1e-6) => assert.ok(Math.abs(a - b) <= within, `${what || 'value'}: ${a} should be ${b}`);
(async () => {
  const h = await start({ noPoll: true, oldFields: true }), run = h.run, J = JSON.stringify;
  const F = f => `#simEditor [data-field="${f}"]`, S = s => `#simEditor ${s}`;
  const id = key => run(`(tasks.find(t => t.key === ${J(key)}) || {}).id`);
  const text = s => run(`(n => n ? n.textContent : null)(document.querySelector(${J(s)}))`);
  const val = s => run(`document.querySelector(${J(s)}).value`);
  const hidden = s => run(`(n => !n || n.hidden || !n.getClientRects().length)(document.querySelector(${J(s)}))`);
  const T = i => `tasks.find(t => t.id === ${J(i)})`;
  const draft = () => run('simDraft');
  const calc = i => run(`(t => taskCalc((simTask() === t && simOwner.statTask) || t, Date.now(), simDraft))(${T(i)})`); // a card is drafted as the selected player has it
  const blur = () => run('document.activeElement && document.activeElement.blur(); 1');
  const paint = () => run('paintAll(); 1');
  const snap = () => run(`JSON.stringify({ tasks, rows, rates })`);
  const stat = (i, f) => run(`statGet((t => cardAsPlayer(t, selectedRow()) || t)(${T(i)}), ${J(f)})`); // a card's stats are the selected player's
  const spy = () => run(`(() => { if (window.__qs != null) return; window.__qs = 0; const real = queueSave; queueSave = function () { window.__qs++; return real(); }; })()`);
  const saves = () => run('window.__qs');
  const pick = async i => { // what picking in the list does; a native popup can't be clicked headless
    await run(`(() => { const s = $('simPick'); s.focus(); s.value = ${J(i)}; if (s.value !== ${J(i)}) throw new Error('no option ' + ${J(i)}); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await blur();
  };
  const noDups = async () => { const keys = await run('tasks.map(t => t.key)'), ids = await run('tasks.map(t => t.id)'); assert.equal(new Set(keys).size, keys.length, 'duplicate key'); assert.equal(new Set(ids).size, ids.length, 'duplicate id'); };
  const drag = async (sel, moves) => {
    const b = await run(`(() => { const n = document.querySelector(${J(sel)}); n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const m = (type, x, extra = {}) => h.send('Input.dispatchMouseEvent', { type, x, y: b.y, ...extra });
    await m('mouseMoved', b.x); await m('mousePressed', b.x, { button: 'left', clickCount: 1 });
    for (const dx of moves) { await m('mouseMoved', b.x + dx, { button: 'left', buttons: 1 }); await sleep(30); }
    await m('mouseReleased', b.x + moves[moves.length - 1], { button: 'left', clickCount: 1 });
    await sleep(60);
  };
  globalThis.__panelStub = () => run(`window.__panelPlayedReal = panelPlayed; panelPlayed = group => !(group.every(x => x.auto && !x.starred) && (k => !k.done && !(k.hours != null && !Number.isNaN(k.hours)))(taskCalc(group[0]))); if (!window.__panelStubbed) { window.__panelStubbed = true; paintPanel(); } 1`);
const noPortals = () => run(`(() => { if (typeof MAP_CREW === 'undefined') return 0; Object.keys(MAP_CREW).forEach(k => delete MAP_CREW[k]); const had = tasks.some(t => t.type === 'portal'); if (had) { tasks = tasks.filter(t => t.type !== 'portal'); queueSave(); render(); } return 1; })()`); // portals have their own suite
  { const stub = globalThis.__panelStub; globalThis.__panelStub = async () => { await noPortals(); await stub(); }; }
  await globalThis.__panelStub(); // older tests keep the earlier folding, including after a reload
  try {
    await spy();
    const name = slot => run(`rows.find(r => r.slot === ${slot}).name`);

    // A known world: slot 1 and 5 leave their activities, so their tasks are "if it started now". The emblem is held only where this test puts it.
    const emblemRaw = await run(`rawNamesOf('Pirate Emblem I')`);
    assert.equal(emblemRaw.length, 1);
    const raw = emblemRaw[0], clean = v => typeof v === 'string' ? JSON.parse(v) : v.slice();
    await run(`(() => { const r = rows.find(x => x.slot === 1), o = grindOptions(r).find(x => x.itemName === 'Pirate Emblem I'); upsertTask({ ...taskFromOption(r, o), amount: '2045' }); })()`);
    await h.bump(d => {
      Object.keys(d).filter(k => /^InventoryOrder_\d+$/.test(k)).forEach(k => { d[k] = clean(d[k]).map(x => x === raw ? 'Blank' : x); });
      d.ChestOrder = clean(d.ChestOrder).map(x => x === raw ? 'Blank' : x);
      const put = (order, qty, n) => { const o = clean(d[order]), q = clean(d[qty]), at = o.indexOf('Blank') >= 0 ? o.indexOf('Blank') : o.length; o[at] = raw; q[at] = n; d[order] = o; d[qty] = q; };
      put('InventoryOrder_1', 'ItemQTY_1', 40); put('InventoryOrder_9', 'ItemQTY_9', 5); put('ChestOrder', 'ChestQuantity', 1000);
      const cards = JSON.parse(d.Cards0); cards.w7b3 = 1e6; d.Cards0 = JSON.stringify(cards);
    });
    await h.setActivity(1, 'Divinity', { mapIdx: 200, active: false });
    await h.setActivity(5, 'Divinity', { mapIdx: 200, active: false });
    for (const s of await run(`rows.filter(r => r.slot != null && r.monster === 'w7b3').map(r => r.slot)`)) await h.setActivity(s, 'Divinity', { mapIdx: 200, active: false }); // nobody on the Pirate Underling: its card is archived
    const underling = await run(`rows.find(r => r.slot != null && ![1, 4, 5].includes(r.slot)).slot`); // who the item test puts on it
    const clearId = await id('1|clear|FIGHTING|Pirate Underling'), cardId = await id('card|w7b3'), itemId = await id('item|Pirate Emblem I'), skillId = await id('5|skill|1');
    const activeCard = await id('card|w7b9'), activeClear = await id('4|clear|FIGHTING|Ancientfish');
    await run(`(() => { const t = ${T(clearId)}; taskEdit(t, 'kph', '250'); taskEdit(t, 'left', '1000'); taskEdit(t, 'kpc', '40'); })()`);
    await run(`queueSave(); 1`);
    await h.savedSheet();

    await test('the tab opens with a sentence until a task is picked; the list has three groups', async () => {
      await h.click('#tabSimulate');
      assert.equal(await run(`$('viewSimulate').hidden`), false);
      assert.equal(await text('#simNone'), 'Pick a task to try other numbers on it.');
      assert.ok(await hidden('.sim-body'));
      assert.equal(await val('#simPick'), '');
      await run(`toggleStar(${T(await id('item|Reef Coral Statue'))}); render(); 1`);
      await run(`(() => { const t = ${T(skillId)}; t.starred = true; render(); })()`);
      const groups = await run(`[...$('simPick').querySelectorAll('optgroup')].map(g => g.label)`);
      assert.deepEqual(groups, ['Doing now', 'Goals', 'Archive']);
      const same = await run(`[...$('simPick').querySelectorAll('optgroup')].every(g => [...g.children].every(o => { const t = tasks.find(x => x.id === o.value), want = { 'Doing now': 'active', Goals: 'goal', Archive: 'archive' }[g.label], r = rowOfTask(t) || { name: 'Account' }; return taskSection(t) === want && o.textContent === r.name + ' · ' + taskTitle(t); }))`);
      assert.ok(same, 'labels and groups');
      const stamps = await run(`[...$('simPick').querySelectorAll('optgroup[label="Archive"] option')].map(o => tasks.find(t => t.id === o.value).lastActiveAt || 0)`);
      assert.deepEqual(stamps, [...stamps].sort((a, b) => b - a), 'newest active first');
      assert.equal(await run(`$('simPick').options.length - 1`), await run('tasks.length'), 'every task once');
      await run(`(() => { const t = ${T(skillId)}; t.starred = false; render(); })()`);
    });

    await test('picks: active, goal and archived tasks each show who, the note and the same stats as the planner', async () => {
      await run(`${T(skillId)}.starred = true; render(); 1`);
      for (const [i, slot, section] of [[activeClear, 4, 'active'], [skillId, 5, 'goal'], [clearId, 1, 'archive']]) {
        assert.equal(await run(`taskSection(${T(i)})`), section);
        await pick(i);
        await sleep(30);
        assert.equal(await run(`document.querySelector('#simEditor .task-editor').dataset.task`), i);
        assert.equal(await text('#viewSimulate .plan-who .who-name'), await name(slot));
        assert.ok(await run(`!!document.querySelector('#viewSimulate .plan-who .portrait')`), 'portrait');
        assert.equal(await text('.sim-note'), 'Changes here don’t touch the task until you press Set Goal.');
        assert.ok(await run(`!!document.querySelector('.sim-body .sheet .task-editor')`), 'in a sheet');
        assert.ok(!(await run(`!!document.querySelector('#simEditor [data-star]')`)), 'no star');
        assert.ok(await run(`[...document.querySelectorAll('#simEditor input[id]')].every(n => n.id.includes('sim-'))`), 'ids prefixed');
        assert.ok(await hidden('#simCompare'), 'nothing to compare yet');
      }
      await run(`${T(skillId)}.starred = false; render(); 1`);
      await run(`selectPlayer(4); 1`);
      await pick(activeClear);
      // the planner shows the activity now; the same editor is on the Player tab
      const read = s => run(`(() => { paintAll(); return [...document.querySelectorAll(${J(s)} + ' .stat')].filter(n => !n.hidden).map(n => n.className + ':' + n.textContent); })()`);
      const a = await read('#simEditor .task-editor');
      await run(`showTab('player'); 1`);
      const b = await read(`#playerTasks .task-editor[data-task="${activeClear}"]`);
      await run(`showTab('simulate'); 1`);
      assert.ok(a.length >= 2);
      assert.deepEqual(a, b, 'same stats on both tabs');
    });

    await test('clear, by hand: 1000 left at 250/h is 4h; a draft of 500/h is 2h, 2h sooner, "if it started now"', async () => {
      await pick(clearId);
      assert.equal(await val(F('kph')), '250');
      assert.equal(await val(F('left')), '1000');
      assert.equal(await text(S('.s-wait .big')), '4h');
      assert.equal(await text(S('.s-finish .small')), 'if it started now');
      await h.type(F('kph'), '500');
      assert.equal(await text(S('.s-wait .big')), '2h');
      assert.equal(await text('#simCompare'), 'Now 4h · Simulated 2h · 2h sooner');
      assert.equal(await text(S('.s-finish .small')), 'if it started now');
      assert.equal(await text(S('.s-rate .big')), '500');
      await h.type(F('kpc'), '100');
      assert.equal(await text(S('.s-clears .big')), '10');
      await h.type(F('left'), '250');
      assert.equal(await text('#simCompare'), 'Now 4h · Simulated 30m · 3h 30m sooner');
      await h.type(F('kph'), '125');
      assert.equal(await text('#simCompare'), 'Now 4h · Simulated 2h · 2h sooner');
      await h.type(F('left'), '2000');
      assert.equal(await text('#simCompare'), 'Now 4h · Simulated 16h · 12h later');
      assert.deepEqual(await draft(), { kph: '125', kpc: '100', left: '2000' });
      await h.click('#simReset');
      assert.deepEqual(await draft(), {});
      assert.equal(await val(F('kph')), '250');
      assert.equal(await val(F('left')), '1000');
      assert.ok(await hidden('#simCompare'));
    });

    await test('card, by hand: 1M owned, rank 3 needs 2M, 100m kph at 100% multikill and 10x drops is 2500/h', async () => {
      await run('selectPlayer(1); 1'); // drafted as player 1 has it
      await pick(cardId);
      assert.equal(await run(`cardRank('w7b3', 1e6, cardUnlocks(saveForFinder)).rank`), 2);
      await h.type(F('kph'), '100m');
      await h.type(F('mk'), '100');
      await h.type(F('dr'), '10');
      const c = await calc(cardId);
      near(c.rate, 2500, 'rate');
      near(c.hours, 400, 'to the next rank');
      assert.equal(await text(S('.s-wait .big')), '16d 16h');
      assert.equal(c.target, 2e6);
      await h.type(F('goal'), '3'); // 3 stars, 4.5M
      const d = await calc(cardId);
      assert.equal(d.target, 4.5e6);
      near(d.hours, 1400, 'to rank 4');
      assert.equal(await text(S('.s-wait .big')), '58d 8h');
      assert.equal(await text(S('.ed-line')), '1\u2605 → 3\u2605 · 1M of 4.5M');
      await h.click('#simReset');
    });

    await test('item, by hand: 2045 wanted, 1045 held across the account, 100/h is 10h; only the amount is drafted', async () => {
      await pick(itemId);
      assert.deepEqual(await run(`[...document.querySelectorAll(${J(S('[data-field]'))})].map(n => n.dataset.field)`), ['amount'], 'its rate is each player\'s AFK stats');
      assert.equal(await run(`!!document.querySelector(${J(S('[data-tick]'))})`), false, 'no Global tick');
      await h.setActivity(underling, 'w7b3', { mapIdx: 317, active: false }); // someone on the Pirate Underling
      const ratesWere = await run('JSON.stringify(rates)'), who = await run(`teamOf(${T(itemId)}).map(r => r.slot)`), at = await run('saveFacts().at');
      assert.ok(who.length > 0, 'someone is on the Pirate Underling');
      await run(`${J(who)}.forEach((s, i) => { const on = { slot: s, activityKey: rows.find(r => r.slot === s).activityKey, source: 'monster' }; statSet(on, 'kph', i ? '' : '50k'); statSet(on, 'mk', '100'); statSet(on, 'dr', '2'); }); 1`);
      await run('window.realPending = teamPending; teamPending = () => 0; 1'); // these sums are from what's held; unclaimed AFK gains have their own tests
      const c = await run(`taskCalc(${T(itemId)}, ${at}, simDraft)`);
      near(c.rate, 100, 'rate: 50k / 2 x 2 (Pirate Emblem I is a common drop: it comes for every kill multikill counts) x 0.001 x 2');
      assert.equal(c.have, 1045);
      near(c.hours, 10, 'hours, from the save');
      const before = await snap();
      await h.type(F('amount'), '3045');
      near((await run(`taskCalc(${T(itemId)}, ${at}, simDraft)`)).hours, 20, 'amount drafted');
      assert.equal(await snap(), before, 'a draft writes nothing');
      await h.click('#simReset');
      await run(`rates = JSON.parse(${J(ratesWere)}); paintAll(); 1`);
      await h.setActivity(underling, 'Divinity', { mapIdx: 200, active: false }); // and off it again
    });

    await test('skill, by hand: next level costs ExpReq - Exp from the save', async () => {
      await pick(skillId);
      const lv = h.save.Lv0_5[1], exp = h.save.Exp0_5[1], req = h.save.ExpReq0_5[1], need = req - exp;
      assert.ok(need > 0, 'needs a level to gain');
      await h.type(F('goal'), '');
      await h.type(F('xph'), String(Math.round(need / 2)));
      const c = await calc(skillId);
      assert.equal(c.target, lv + 1);
      near(c.hours, 2, 'hours', 0.01);
      near(c.left, need, 'left', need * 1e-6);
      assert.ok(/^2h( 1m)?$/.test(await text(S('.s-wait .big'))), await text(S('.s-wait .big')));
      assert.equal(await text(S('.s-finish .small')), 'if it started now');
      await h.type(F('goal'), '+5');
      await h.key('Tab');
      assert.equal((await draft()).goal, String(lv + 5), '+5 locks into the draft');
      assert.equal(await run(`${T(skillId)}.goal`), '189', 'not the task');
      await h.click('#simReset');
    });

    await test('clearing a field is not the same as leaving it, on clear, card and item', async () => {
      await pick(clearId);
      assert.ok(!('left' in await draft()));
      await h.type(F('left'), '');
      assert.deepEqual(await draft(), { left: '' });
      assert.equal(await val(F('left')), '');
      assert.equal(await text(S('.s-wait .pill')), 'Enter kills left');
      assert.equal(await text('#simCompare'), 'Now 4h · Simulated No ETA');
      await paint();
      assert.equal(await val(F('left')), '', 'stays empty across a paint');
      await h.click('#simReset');

      // the box has the activity's real number, typed on another of its tasks; a cleared one is cleared, in the draft only
      await run(`taskEdit(${T(activeClear)}, 'kph', '5m'); selectPlayer(4); 1`); // the card as slot 4 has it
      await pick(activeCard);
      assert.equal(await val(F('kph')), '5m', 'the real value, not a hint');
      assert.equal(await run(`'kph' in ${T(activeCard)}`), false);
      await h.type(F('kph'), '');
      assert.equal(await val(F('kph')), '');
      assert.equal(await run(`document.querySelector(${J(F('kph'))}).placeholder`), '12k', 'only the hint');
      assert.ok((await calc(activeCard)).rate < await run('taskCalc(simOwner.statTask).rate'), "slot 4's own share is gone; anyone else on it still counts");
      assert.equal(await run(`taskField(simOwner.statTask, 'kph', simDraft)`), '');
      assert.equal(await stat(activeClear, 'kph'), '5m', 'the activity keeps its number');
      await h.click('#simReset');

      // a cleared drop rate is cleared: it doesn't come back from the row
      assert.equal(await val(F('dr')), '2400');
      await h.type(F('dr'), '');
      assert.equal(await run(`taskField(simOwner.statTask, 'dr', simDraft)`), '');
      assert.ok((await calc(activeCard)).rate < await run('taskCalc(simOwner.statTask).rate'), "slot 4's own share is gone");
      assert.equal(await run(`rows.find(r => r.slot === 4).dr`), '2400');
      await h.click('#simReset');

      // a cleared amount
      await pick(itemId);
      await h.type(F('amount'), '');
      assert.equal(await run(`(c => c.target)(taskCalc(${T(itemId)}, Date.now(), simDraft))`), null);
      assert.equal(await run(`${T(itemId)}.amount`), '2045');
      await h.click('#simReset');

      // a cleared kills left on a clear being done goes back to the game's count, the hint says so, and it runs from the AFK start
      await run(`(() => { const t = ${T(activeClear)}; taskEdit(t, 'left', '5000'); })()`);
      await pick(activeClear);
      const game = await run(`chars[4].portalLeft`), shown = await run(`fmtNum(chars[4].portalLeft)`);
      assert.ok(game > 0, 'slot 4 has a portal count');
      await h.type(F('left'), '');
      assert.equal(await val(F('left')), '');
      assert.equal(await run(`document.querySelector(${J(F('left'))}).placeholder`), shown);
      const view = await run(`(v => ({ left: v.left, auto: v.leftAuto, exact: v.leftExact, started: v.startedAt, since: v.afkSince }))(taskView(${T(activeClear)}, simDraft))`);
      assert.deepEqual([view.left, view.auto, view.exact, view.started], [shown, true, game, view.since]);
      await h.click('#simReset');
      await run(`(() => { const t = ${T(activeClear)}; taskEdit(t, 'left', ''); })()`); // puts it back as it was
    });

    await test('a scrub moves the draft, and dragged back to zero leaves nothing', async () => {
      await pick(clearId);
      const before = await snap();
      await drag(S('[data-scrub]'), [30, 60]);
      assert.equal((await draft()).left, '1010');
      assert.equal(await val(F('left')), '1010');
      await h.click('#simReset');
      await drag(S('[data-scrub]'), [60, 30, 0]);
      assert.deepEqual(await draft(), {});
      assert.equal(await val(F('left')), '1000');
      assert.equal(await snap(), before);
    });

    await test('drafts never touch the task, the row or the saved sheet', async () => {
      await run('queueSave(); 1');
      const file = J((await h.savedSheet()));
      const before = await snap(), calls = await saves();
      for (const [i, edits] of [[clearId, { kph: '9', kpc: '8', left: '7' }], [cardId, { kph: '9', dr: '8', mk: '7', goal: '5' }], [itemId, { amount: '9' }], [skillId, { xph: '9', goal: '300' }], [activeCard, { kph: '', dr: '', mk: '' }]]) {
        await pick(i);
        for (const [f, v] of Object.entries(edits)) await h.type(F(f), v);
        await blur();
        await paint();
        assert.equal(await snap(), before, 'after editing ' + i);
      }
      await sleep(700); // a save would have gone out by now
      assert.equal(await saves(), calls, 'queueSave not called');
      assert.equal(await run('!!saveTimer'), false);
      assert.equal(J(await h.savedSheet()), file, 'sheet file unchanged');
      await h.click('#simReset');
    });

    await test('a draft survives ticks, a sync while typing, a new set of task objects and a tab change', async () => {
      await pick(clearId);
      await h.type(F('kph'), '12');
      await sleep(1200);
      assert.equal(await val(F('kph')), '12', 'through a tick');
      const stamp = await run('saveStamp');
      await h.bump({}); // arrives while the box has focus
      assert.equal(await run(`document.activeElement.dataset.field`), 'kph', 'focus kept');
      assert.equal(await val(F('kph')), '12', 'not clobbered');
      await h.send('Input.insertText', { text: '3' });
      assert.equal(await val(F('kph')), '123', 'can carry on typing');
      await blur();
      await h.bump({});
      assert.notEqual(await run('saveStamp'), stamp, 'the save came in once the box was left');
      assert.equal((await draft()).kph, '123');
      assert.equal(await val(F('kph')), '123');
      await run(`setState(JSON.parse(JSON.stringify(stateNow()))); render(); 1`); // what a sheet reload does
      assert.equal(await val(F('kph')), '123');
      assert.equal((await calc(clearId)).rate, 123);
      await h.click('#tabPlanner');
      await h.click('#tabSimulate');
      assert.equal(await val('#simPick'), clearId, 'still picked');
      assert.equal(await val(F('kph')), '123', 'still drafted');
      await h.click('#simReset');
    });

    await test('picking starts a fresh draft; the same task again keeps it', async () => {
      await pick(clearId);
      await h.type(F('kph'), '77');
      await blur();
      await run(`simulateTask(${J(clearId)}); 1`);
      assert.equal((await draft()).kph, '77');
      await pick(cardId);
      assert.deepEqual(await draft(), {});
      await pick(clearId);
      assert.equal(await val(F('kph')), '250');
    });

    await test('real keyboard picks in the list; it only rebuilds when the tasks change, and never under focus', async () => {
      await run(`$('simPick').focus(); 1`);
      const at = await run(`$('simPick').selectedIndex`);
      await h.key('ArrowDown');
      await sleep(40);
      assert.equal(await run(`$('simPick').selectedIndex`), at + 1, 'arrow moves the pick');
      const picked = await val('#simPick');
      assert.equal(await run('simId'), picked);
      assert.equal(await run(`document.querySelector('#simEditor .task-editor').dataset.task`), picked);
      await run(`window.__first = $('simPick').querySelector('optgroup'); 1`);
      await paint();
      assert.ok(await run(`window.__first === $('simPick').querySelector('optgroup')`), 'not rebuilt when nothing changed');
      const count = await run(`$('simPick').options.length`);
      const extra = await run(`(() => { const fresh = x => grindOptions(x).find(o => taskFromOption(x, o).type === 'item' && !tasks.some(y => y.key === 'item|' + o.itemName)), r = rows.find(x => x.slot != null && fresh(x)), o = fresh(r); return upsertTask({ ...taskFromOption(r, o), amount: '5' }).id; })()`);
      await paint();
      assert.equal(await run(`$('simPick').options.length`), count, 'not while focused');
      await blur();
      await paint();
      assert.equal(await run(`$('simPick').options.length`), count + 1, 'catches up');
      assert.equal(await val('#simPick'), picked, 'selection kept');
      await run(`deleteTask(${J(extra)}); paintAll(); 1`);
      await pick(clearId);
    });

    await test('a bad number stops Set Goal and writes nothing', async () => {
      await pick(clearId);
      const before = await snap();
      await h.type(F('kph'), 'abc');
      assert.equal(await run(`document.querySelector(${J(F('kph'))}).getAttribute('aria-invalid')`), 'true');
      await h.click('#simGo');
      assert.equal(await snap(), before);
      assert.equal(await run(`document.activeElement.dataset.field`), 'kph');
      await h.click('#simReset');
    });

    let undoBefore;
    await test('Set Goal with no edits stars an archived task, into Goals, same id, one per key', async () => {
      await pick(cardId);
      assert.equal(await run(`taskSection(${T(cardId)})`), 'archive');
      assert.equal(await run(`$('simGo').disabled`), false);
      const count = await run('tasks.length'), before = await run(`JSON.stringify(${T(cardId)})`), calls = await saves();
      await h.click('#simGo');
      const t = await run(T(cardId));
      assert.equal(t.starred, true);
      assert.equal(await run('tasks.length'), count);
      assert.equal(await run(`taskSection(${T(cardId)})`), 'goal');
      assert.equal(await run(`panelCards.get(${J(cardId)}).node.parentNode === panelParts.goal`), true, 'in the Goals section of the panel');
      assert.equal(await text('#toastText'), 'Added to goals');
      assert.ok(await saves() > calls, 'saved');
      await noDups();
      await h.click('#undo');
      assert.equal(await run(`JSON.stringify(${T(cardId)})`), before, 'Undo');
      assert.equal(await run(`taskSection(${T(cardId)})`), 'archive');
    });

    await test('Set Goal writes the draft as if typed, drafted stats to the activity with dr and mk on the row too, persists through a reload', async () => {
      const A = '1|FIGHTING|Pirate Underling', box = () => run(`rates[${J(A)}]`), ratesNow = () => run('JSON.stringify(rates)');
      await run('selectPlayer(1); 1'); // the card as player 1 has it
      await pick(clearId);
      undoBefore = { task: await run(`JSON.stringify(${T(clearId)})`), row: await run(`JSON.stringify(rows.find(r => r.slot === 1))`), rates: await ratesNow() };
      const elsewhere = await run(`JSON.stringify([rates['2|FIGHTING|Pirate Underling'], rates['1|FIGHTING|Ancientfish']])`);
      const t0 = await run('Date.now()');
      await h.type(F('kph'), '500');
      await h.type(F('left'), '750');
      await h.click('#simGo');
      const t = await run(T(clearId));
      assert.deepEqual([t.left, t.kpc, t.starred, t.leftAuto], ['750', '40', true, false]);
      assert.equal('kph' in t, false, 'not on the task');
      assert.equal((await box()).kph, '500', 'on the activity');
      for (const i of [clearId, cardId]) assert.equal(await stat(i, 'kph'), '500', 'every task on it reads it');
      assert.equal(await run(`JSON.stringify([rates['2|FIGHTING|Pirate Underling'], rates['1|FIGHTING|Ancientfish']])`), elsewhere, 'not another player or activity');
      assert.ok(t.typedAt >= t0 && t.editedAt >= t0, 'typed now');
      assert.deepEqual(await draft(), {}, 'draft resets');
      assert.equal(await val(F('kph')), '500', 'to the new values');
      assert.ok(await hidden('#simCompare'));
      assert.equal(await run(`taskSection(${T(clearId)})`), 'goal');
      await h.click('#undo');
      assert.equal(await run(`JSON.stringify(${T(clearId)})`), undoBefore.task, 'Undo restores all of it');
      assert.equal(await ratesNow(), undoBefore.rates, 'and the rates');
      assert.equal(await val(F('kph')), '250');

      await run('selectPlayer(1); 1'); // the card as player 1 has it
      await pick(cardId);
      const rowBefore = await run(`JSON.stringify(rows.find(r => r.slot === 1))`), ratesBefore = await ratesNow();
      assert.equal(await val(F('kph')), '250', 'the clear\'s number is the card\'s');
      await h.type(F('kph'), '100m');
      await h.type(F('dr'), '10');
      await h.type(F('mk'), '100');
      await h.type(F('goal'), '4');
      await h.click('#simGo');
      assert.deepEqual(await run(`(r => [r.dr, r.mk])(rows.find(r => r.slot === 1))`), ['10', '100']);
      assert.deepEqual((({ kph, dr, mk }) => [kph, dr, mk])(await box()), ['100m', '10', '100']);
      assert.deepEqual(await run(`(t => [t.goal, t.starred])(${T(cardId)})`), ['4', true]);
      assert.equal(await run(`taskSection(${T(cardId)})`), 'goal');
      await h.click('#undo');
      assert.equal(await run(`JSON.stringify(rows.find(r => r.slot === 1))`), rowBefore, 'row back, keys and all');
      assert.equal(await ratesNow(), ratesBefore, 'rates back');
      await pick(cardId);
      await h.type(F('kph'), '100m');
      await h.type(F('dr'), '10');
      await h.type(F('mk'), '100');
      await h.type(F('goal'), '4');
      await h.click('#simGo');
      const saved = await h.savedSheet();
      const onDisk = saved.tasks.find(x => x.id === cardId);
      assert.deepEqual([onDisk.goal, onDisk.starred], ['4', true]);
      assert.deepEqual((({ kph, dr, mk }) => [kph, dr, mk])(saved.rates[A]), ['100m', '10', '100']);
      assert.deepEqual((r => [r.dr, r.mk])(saved.rows.find(r => r.slot === 1)), ['10', '100']);
      await h.reload();
      await spy();
      await sleep(50);
      assert.equal(await run(`$('viewSimulate').hidden`), false, 'the tab comes back');
      assert.equal(await text('#simNone'), 'Pick a task to try other numbers on it.');
      await run('selectPlayer(1); 1'); // a reload selects whoever is played; the card's stats here are player 1's
      const back = await run(T(cardId));
      assert.deepEqual([await stat(cardId, 'kph'), await stat(clearId, 'kph'), back.goal, back.starred, back.id], ['100m', '100m', '4', true, cardId]);
      assert.equal(await run(`taskSection(${T(cardId)})`), 'goal');
      await run(`panelOpen.archive = true; paintAll(); 1`);
      assert.equal(await run(`panelCards.get(${J(cardId)}).node.parentNode === panelParts.goal`), true);
      await noDups();
    });

    await test('Set Goal on a task being done stays in Active, starred; cleared fields clear; Undo restores task and row precisely', async () => {
      await run(`selectPlayer(4); taskEdit(${T(activeClear)}, 'left', '5000'); taskEdit(${T(activeClear)}, 'kph', '5m'); queueSave(); 1`); // the card as slot 4 has it
      await pick(activeCard);
      const taskB = await run(`JSON.stringify(${T(activeCard)})`), rowB = await run(`JSON.stringify(rows.find(r => r.slot === 4))`), ratesB = await run('JSON.stringify(rates)');
      await h.type(F('kph'), '');
      await h.type(F('dr'), '');
      await h.type(F('mk'), '50');
      await h.type(F('goal'), '3');
      await h.click('#simGo');
      const t = await run(T(activeCard)), r = await run(`rows.find(r => r.slot === 4)`);
      assert.deepEqual([await stat(activeCard, 'kph'), t.goal, t.starred], ['', '3', true]);
      assert.equal(await stat(activeClear, 'kph'), '', 'cleared for the whole activity');
      assert.deepEqual([r.dr, r.mk], ['', '50']);
      assert.deepEqual([await stat(activeCard, 'dr'), await stat(activeCard, 'mk')], ['', '50']);
      assert.equal(await run(`taskSection(${T(activeCard)})`), 'active', 'a star does not push it out of Active');
      assert.equal(await run(`panelCards.get(${J(activeCard)}).node.parentNode === panelParts.active`), true);
      assert.equal(await val(F('kph')), '', 'new value');
      await h.click('#undo');
      assert.equal(await run(`JSON.stringify(${T(activeCard)})`), taskB);
      assert.equal(await run(`JSON.stringify(rows.find(r => r.slot === 4))`), rowB);
      assert.equal(await run('JSON.stringify(rates)'), ratesB, 'rates back');
      assert.equal(await stat(activeClear, 'kph'), '5m');
      await run('queueSave(); 1');
      const saved = await h.savedSheet();
      assert.equal(saved.rows.find(x => x.slot === 4).dr, '2400', 'Undo reached the file');

      // cleared kills left: back to the game's count on the task, as the planner's box does
      await pick(activeClear);
      assert.equal(await val(F('left')), '5000');
      await h.type(F('left'), '');
      await h.click('#simGo');
      const c = await run(T(activeClear)), game = await run('chars[4].portalLeft');
      assert.deepEqual([c.left, c.leftAuto, c.typedAt, c.leftExact], [await run(`fmtNum(${game})`), true, null, game]);
      await h.click('#undo');
      assert.equal(await run(`${T(activeClear)}.left`), '5000');
    });

    await test('Set Goal: a skill\'s drafted EXP goes to its target, a crystal\'s to its world; Undo takes them back', async () => {
      await pick(skillId);
      const target = await run(`${T(skillId)}.activityKey`), xphBefore = await stat(skillId, 'xph');
      await h.type(F('xph'), '7k');
      assert.equal(await stat(skillId, 'xph'), xphBefore, 'a draft until Set Goal');
      await h.click('#simGo');
      assert.equal(await run(`rates[${J('5|' + target)}].xph`), '7k');
      assert.equal(await run(`'xph' in ${T(skillId)}`), false);
      await h.click('#undo');
      assert.equal(await stat(skillId, 'xph'), xphBefore);
      await h.setActivity(9, 'mushG', { mapIdx: 1, active: false }); // world 0's crystal has drops of its own
      const crystal = await run(`(() => { const r = rows.find(x => x.slot === 9), o = grindOptions(r).find(x => x.source === 'crystal' && / Card$/.test(x.itemName)); return upsertTask(taskFromOption(r, o)).id; })()`);
      await run('paintAll(); 1');
      await run('selectPlayer(9); 1'); // the card as player 9 has it
      await pick(crystal);
      const CP = `cardAsPlayer(${T(crystal)}, rows.find(r => r.slot === 9))`;
      const world = await run(`statHome(${CP}, 'kph')`), fight = await run(`rowOfTask(${CP}).slot + '|' + rowOfTask(${CP}).activityKey`), fightKph = await run(`(rates[${J(fight)}] || {}).kph ?? null`);
      assert.ok(/\|world:\d+$/.test(world), world);
      await h.type(F('kph'), '700');
      await h.click('#simGo');
      assert.equal(await run(`rates[${J(world)}].kph`), '700');
      assert.equal(await run(`(rates[${J(fight)}] || {}).kph ?? null`), fightKph, 'not the monster\'s kills per hour');
      await h.click('#undo');
      assert.equal(await run(`rates[${J(world)}]?.kph ?? null`), null);
      await run(`deleteTask(${J(crystal)}); paintAll(); 1`);
    });

    await test('Set Goal with a skill +5 locks; a cleared amount clears', async () => {
      await pick(skillId);
      const lv = await run(`parseNum(taskView(${T(skillId)}).lvl)`);
      await h.type(F('goal'), '+5');
      await h.click('#simGo'); // leaving the box locks it
      assert.equal(await run(`${T(skillId)}.goal`), String(lv + 5));
      await h.click('#undo');
      assert.equal(await run(`${T(skillId)}.goal`), '189');
      await pick(itemId);
      await h.type(F('amount'), '');
      await h.click('#simGo');
      assert.deepEqual(await run(`(t => [t.amount, t.starred])(${T(itemId)})`), ['', true]);
      await h.click('#undo');
      assert.deepEqual(await run(`(t => [t.amount, t.starred])(${T(itemId)})`), ['2045', false]);
    });

    await test('the real panel: an archived card opens in Simulate, and a same-tab click on another swaps it', async () => {
      await h.click('#tabPlanner');
      if (!(await run('panelOpen.archive'))) await h.click('.pn-archive');
      await h.click(`.pc[data-id="${clearId}"] .pc-main`);
      assert.equal(await run(`$('viewSimulate').hidden`), false);
      assert.equal(await run(`$('tabSimulate').getAttribute('aria-selected')`), 'true');
      assert.equal(await val('#simPick'), clearId);
      assert.equal(await run(`document.querySelector('#simEditor .task-editor').dataset.task`), clearId);
      assert.equal(await text(S('.s-finish .small')), 'if it started now');
      const other = await run(`tasks.find(t => t.id !== ${J(clearId)} && taskSection(t) === 'archive' && panelCards.has(t.id)).id`);
      await h.click(`.pc[data-id="${other}"] .pc-main`, { hold: 1100 }); // held across a redraw
      assert.equal(await val('#simPick'), other);
      assert.equal(await run(`document.querySelector('#simEditor .task-editor').dataset.task`), other);
    });

    await test('the real panel: a card click flashes that card on the planner and selects the player', async () => {
      const active = await id('4|clear|FIGHTING|Ancientfish');
      await h.click(`.pc[data-id="${active}"] .pc-main`);
      assert.equal(await run(`$('viewPlanner').hidden`), false);
      assert.equal(await run('selectedSlot()'), 4);
      assert.equal(await run(`document.querySelector('#plannerTasks .tcard[data-task="${active}"]').classList.contains('jump')`), true);
      assert.equal(await run(`document.querySelectorAll('#plannerTasks .tcard.jump').length`), 1);
      await h.shot('integration-flash.png', 1500);
      await sleep(1200);
      assert.equal(await run(`document.querySelector('#plannerTasks .tcard[data-task="${active}"]').classList.contains('jump')`), true, 'survives a tick');
    });

    await test('the real panel: starring an active task leaves its planner card in place', async () => {
      const active = await id('4|clear|FIGHTING|Ancientfish'), node = `#plannerTasks .tcard[data-task="${active}"]`;
      await run(`window.__ed = document.querySelector(${J(node)}); 1`);
      const was = await run(`${T(active)}.starred`);
      await h.click(`.pc[data-id="${active}"] .pc-star`, { hold: 1100 });
      assert.equal(await run(`${T(active)}.starred`), !was);
      assert.ok(await run(`window.__ed === document.querySelector(${J(node)})`), 'same node');
      assert.equal(await run(`$('viewPlanner').hidden`), false, 'star only toggles');
      await h.click(`.pc[data-id="${active}"] .pc-star`, { hold: 1100 });
      assert.equal(await run(`${T(active)}.starred`), was, 'and back');
      assert.ok(await run(`window.__ed === document.querySelector(${J(node)})`), 'same node');
    });

    await test('a picked task deleted shows a sentence; Undo brings it back', async () => {
      await h.click('#tabSimulate');
      await pick(clearId);
      await h.type(F('kph'), '321');
      await blur();
      if (!(await run('panelOpen.archive'))) await h.click('.pn-archive');
      assert.equal(await run(`taskSection(${T(clearId)})`), 'archive');
      await h.click(`.pc[data-id="${clearId}"] .pc-x`);
      assert.equal(await text('#simNone'), 'That task has been deleted. Pick another one.');
      assert.ok(await hidden('.sim-body'));
      assert.equal(await val('#simPick'), '');
      await h.click('#undo');
      assert.equal(await val('#simPick'), clearId);
      assert.equal(await val(F('kph')), '321');
      await h.click('#simReset');
    });

    await test('no tasks at all: a sentence and no list to use', async () => {
      await run(`window.__all = tasks; tasks = []; paintAll(); 1`);
      assert.equal(await text('#simNone'), 'That task has been deleted. Pick another one.');
      await run(`simPick(''); paintAll(); 1`);
      assert.equal(await text('#simNone'), 'No tasks yet. They appear when a character starts fighting or training a skill.');
      assert.equal(await run(`$('simPick').disabled`), true);
      await h.shot('sim-none-1500-light.png', 1500);
      await run(`tasks = window.__all; paintAll(); 1`);
      assert.equal(await run(`$('simPick').disabled`), false);
    });

    await test('no duplicate keys or ids; nothing changed the task count', async () => { await noDups(); });

    await test('a draft on a shared card changes only its own player\u2019s share, and writes nothing', async () => {
      await run('teamPending = () => 0; 1'); // a reload above took the earlier stand-in away
      const R = s => `rows.find(r => r.slot === ${s})`;
      const stats = (s, kph, dr, mk) => run(`setRowStat(${R(s)}, 'kph', '${kph}'); setRowStat(${R(s)}, 'dr', '${dr}'); setRowStat(${R(s)}, 'mk', '${mk}'); 1`);
      await h.bump(d => { const c = JSON.parse(d.Cards0); c.mushG = 8; d.Cards0 = JSON.stringify(c); }); // chance 0.002; rank 7 at 75645, 75637 to go
      for (const s of [3, 5]) await h.setActivity(s, 'mushG', { mapIdx: 1, active: false });
      for (const s of await run(`rows.filter(r => r.monster === 'mushG' && r.slot !== 3 && r.slot !== 5).map(r => r.slot)`)) await h.setActivity(s, 'Divinity', { mapIdx: 200, active: false }); // just these two
      await stats(3, '1000', '2', '100'); // 1000 / 2 x 0.002 x 2 = 2 / hour
      await stats(5, '6000', '1', '100'); // 6000 / 2 x 0.002 x 1 = 6 / hour
      const a = await id('card|mushG'), b = a; // one card, the account's
      await run(`taskEdit(${T(a)}, 'goal', '6'); queueSave(); 1`);
      await h.savedSheet();
      await run('selectPlayer(3); 1'); // the card as player 3 has it
      await h.click('#tabSimulate');
      await pick(a);
      await spy();
      const before = await snap(), calls = await saves(), rate = () => text(S('.s-rate .big')), small = () => text(S('.s-rate .small'));
      await paint();
      assert.equal(await rate(), '8'); assert.equal(await small(), 'cards / hour · estimate · 2 of 2 players');
      await h.type(F('kph'), '2000'); // 2000 / 2 x 0.002 x 2 = 4, + 6
      await blur(); await paint();
      assert.equal(await rate(), '10'); assert.equal(await small(), 'cards / hour · estimate · 2 of 2 players');
      assert.ok(Math.abs((await calc(a)).hours - ((await run('saveFacts().at')) + 75637 / 10 * 36e5 - Date.now()) / 36e5) < 0.01, 'the ETA goes with it');
      assert.equal((await run(`taskRate(${T(a)})`)).rate, 8, 'its own numbers are untouched');
      await h.type(F('dr'), '4'); // 2000 / 2 x 0.002 x 4 = 8, + 6
      await blur(); await paint();
      assert.equal(await rate(), '14');
      await h.type(F('kph'), ''); // cleared: nothing of its own, the other's 6 stands
      await blur(); await paint();
      assert.equal(await rate(), '6'); assert.equal(await small(), 'cards / hour · estimate · 1 of 2 players');
      assert.equal(await snap(), before, 'nothing written');
      assert.equal(await saves(), calls, 'nothing saved');
      await h.click('#simReset');
      await paint();
      assert.equal(await rate(), '8');
      await h.type(F('kph'), '2000');
      await blur();
      await h.click('#simGo');
      assert.equal(await text('#toastText'), 'Added to goals. AFK stats saved for the whole activity');
      assert.equal(await run(`rates['3|FIGHTING|Green Mushroom'].kph`), '2000');
      assert.equal(await run(`rates['5|FIGHTING|Green Mushroom'].kph`), '6000', 'only this player\u2019s');
      assert.equal((await run(`taskRate(${T(b)})`)).rate, 10, 'and now it is everyone\u2019s sum');
      await h.click('#undo');
      assert.equal(await run(`rates['3|FIGHTING|Green Mushroom'].kph`), '1000', 'Undo');
      await run(`taskEdit(${T(a)}, 'goal', ''); 1`);
      await pick(clearId);
    });
    const shoot = async (i, tag, draftIt) => {
      await pick(i);
      if (draftIt) { for (const [f, v] of Object.entries(draftIt)) await h.type(F(f), v); await blur(); }
      for (const w of [400, 979, 1500]) {
        await h.setSize(w);
        await paint();
        const over = await run(`(() => { const lim = innerWidth, off = [...document.querySelectorAll('#viewSimulate *')].filter(n => n.tagName !== 'OPTION' && n.tagName !== 'OPTGROUP' && n.getClientRects().length && n.getBoundingClientRect().right > lim + .5).map(n => n.className || n.tagName); return { page: document.documentElement.scrollWidth - lim, off }; })()`);
        assert.ok(over.page <= 0, `${tag} at ${w} scrolls by ${over.page}`);
        assert.deepEqual(over.off, [], `${tag} at ${w} sticks out`);
        for (const theme of ['light', 'dark']) {
          await run(`document.documentElement.dataset.theme = ${J(theme)}; scrollTo(0, 0); 1`);
          if (w < 980) await run(`document.getElementById('viewSimulate').scrollIntoView({ block: 'start' }); 1`);
          if (w === 1500 || tag === 'clear' || tag === 'item') await h.shot(`sim-${tag}-${w}-${theme}.png`, w);
        }
      }
      await h.click('#simReset');
    };
    await test('no sideways overflow at 400, 979, 1500; shots, light and dark', async () => {
      await run(`panelOpen.archive = false; $('activityBox').classList.add('closed'); paintAll(); 1`);
      await shoot(clearId, 'clear', { kph: '500', left: '750' });
      await shoot(cardId, 'card', { kph: '200m', goal: '5' });
      await shoot(itemId, 'item', { amount: '3045' });
      await shoot(skillId, 'skill', { xph: '30T', goal: '200' });
      await shoot(await id('3|exp|DIVINITY|Divinity'), 'exp', { xph: '5m', left: '100m' });
      await run(`delete document.documentElement.dataset.theme; $('activityBox').classList.remove('closed'); 1`);
      await h.setSize(1500);
    });

    await test('no page errors', async () => { assert.deepEqual(h.pageErrors(), []); });
  } finally {
    await h.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
