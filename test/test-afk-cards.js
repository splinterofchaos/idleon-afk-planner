// AFK stats on each card, gathered items tied to the activity, and goals only where they're relevant. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
const J = JSON.stringify;
(async () => {
  const h = await start({ sheet: true, noPoll: true }), run = h.run;
  try {
    await h.setActivity(5, 'OakTree', { mapIdx: 1, active: false });
    await h.setActivity(0, 'Spelunking6', { active: false });
    await sleep(300);
    const pick = async s => { await run(`selectPlayer(${s}); showTab('planner'); render(); 1`); await sleep(100); };
    const itemTask = name => run(`(t => t ? { id: t.id, source: t.source, starred: t.starred, auto: t.auto, slot: t.slot, section: taskSection(t) } : null)(tasks.find(t => t.key === 'item|' + ${J(name)}))`);
    const labels = id => run(`[...document.querySelectorAll('.task-editor[data-task="${id}"] .fld .label')].map(n => n.textContent)`);
    const listed = () => run(`[...document.querySelectorAll('#plannerTasks .tcard')].map(n => n.dataset.task)`);
    const edit = async s => { await run(`selectPlayer(${s}); showTab('player'); render(); 1`); await sleep(100); }; // the editors
    const fields = () => run(`[...document.querySelectorAll('#plannerTasks .act-fld')].map(n => n.querySelector('.label').textContent)`); // the activity's boxes
    const statBox = f => `#plannerTasks input[data-stat="${f}"]`;
    const box = (id, f) => `.task-editor[data-task="${id}"] [data-field="${f}"]`;

    await test('chopping brings up its logs by itself, with a box for the rate', async () => {
      const t = await itemTask('Oak Logs');
      assert.ok(t, 'made by the sync');
      assert.equal(t.source, 'flat'); assert.equal(t.slot, null); assert.equal(t.section, 'active');
      await pick(5);
      assert.ok((await listed()).includes(t.id));
      assert.deepEqual(await fields(), ['Logs / hour', 'Chopping EXP / hour'], 'the rate is the activity’s box');
    });
    await test('typed logs an hour are that player’s on that activity, and give the rate', async () => {
      const t = await itemTask('Oak Logs');
      await h.type(statBox('iph'), '300');
      await run('document.activeElement.blur(); 1');
      assert.equal((await run(`rates['5|CHOPPIN|Oak Tree']`)).iph, '300');
      assert.equal(await run(`taskCalc(tasks.find(x => x.id === ${J(t.id)})).rate`), 300);
      await run(`taskEdit(tasks.find(x => x.id === ${J(t.id)}), 'amount', '1e12'); paintAll(); 1`);
      assert.ok(await run(`taskCalc(tasks.find(x => x.id === ${J(t.id)})).hours > 0`), 'and with a goal, an ETA');
    });
    await test('two players chopping the same tree add up', async () => {
      await h.setActivity(3, 'OakTree', { mapIdx: 1, active: false });
      await run(`rates['3|CHOPPIN|Oak Tree'] = { iph: '100' }; 1`);
      const t = await itemTask('Oak Logs');
      assert.equal(await run(`taskCalc(tasks.find(x => x.id === ${J(t.id)})).rate`), 400);
      await h.setActivity(3, 'Divinity', { mapIdx: 200, active: false });
    });
    await test('spelunking brings up its chapter', async () => {
      const name = await run(`ITEMS.Spelunking6`), t = await itemTask(name);
      assert.ok(t); assert.equal(t.source, 'flat');
      await pick(0);
      assert.ok((await listed()).includes(t.id));
      assert.deepEqual(await fields(), ['Chapters / hour', 'Spelunking EXP / hour']);
      assert.equal(await run(`taskIconName({ type: 'skill', skill: 19, slot: 0, activityKey: 'SPELUNKING|Burned Tunnel', monster: 'Spelunking6' })`), 'UiSkillSpelunking', 'levelling shows the helmet');
      assert.notEqual(await run(`taskIconName(tasks.find(x => x.id === ${J(t.id)}))`), 'UiSkillSpelunking', 'the chapter keeps its own icon');
    });
    await test('mining and catching too; fishing has no single item', async () => {
      assert.equal(await run(`gatheredItem({ activity: 'MINING', monster: 'Copper' })`), 'Copper Ore');
      assert.equal(await run(`gatheredItem({ activity: 'CATCHING', monster: 'Bug1' })`), 'Fly');
      assert.equal(await run(`gatheredItem({ activity: 'FISHING', monster: 'FishSmall' })`), null);
      assert.equal(await run(`gatheredItem({ activity: 'FIGHTING', monster: 'w7b3' })`), null);
    });
    await test('with no one on it and no goal, the item card goes away', async () => {
      await h.setActivity(0, 'Divinity', { mapIdx: 200, active: false });
      const t = await itemTask(await run(`ITEMS.Spelunking6`));
      assert.equal(t.section, 'archive');
    });
    await test('a goal shows only for a player or activity it’s relevant to', async () => {
      const fighter = await run(`rows.find(r => r.slot != null && kindOf(r) === 'kills').slot`), monster = await run(`rows.find(r => r.slot === ${fighter}).monster`);
      const name = await run(`DROPS[${J(monster)}].filter(d => !/ Card$/.test(d[0]))[0][0]`);
      const id = await run(`(() => { const r = rows.find(x => x.slot === ${fighter}), o = grindOptions(r).find(x => x.itemName === ${J(name)}); return upsertTask({ ...taskFromOption(r, o), amount: '50', starred: true }).id; })()`);
      const far = await run(`upsertTask({ type: 'item', itemName: 'Hampter', amount: '50', source: 'monster', chance: 1e-5, monster: 'w5a5', match: { kind: 'activity', key: 'FIGHTING|nobody' }, activityKey: 'FIGHTING|nobody', starred: true }).id`);
      await pick(fighter);
      let ids = await listed();
      assert.ok(ids.includes(id), 'on its source');
      assert.ok(!ids.includes(far), 'nobody here is on it');
      await pick(5);
      ids = await listed();
      assert.ok(!ids.includes(id), 'a chopper has no use for it');
      assert.ok(!ids.includes(far));
      assert.ok(await run(`[...document.querySelectorAll('#panel .pc, .pc')].some(n => n.dataset.id === ${J(far)})`), 'the panel still lists it');
      await run(`flashTask(${J(far)}); 1`); await sleep(100);
      assert.ok((await listed()).includes(far), 'jumped to from the panel, it shows');
      await pick(fighter);
      assert.ok(!(await listed()).includes(far), 'until the player changes');
      await run(`deleteTask(${J(id)}); deleteTask(${J(far)}); render(); 1`);
    });
    await test('a planned activity shows its boxes, and what’s typed stays with it', async () => {
      await run(`(() => { const out = planActivity(5, 'CHOPPIN', { id: 'BirchTree', name: 'Birch Tree' }); pickPlanned = { slot: 5, name: 'Birch Tree', row: { monster: 'BirchTree', activity: 'CHOPPIN', kind: kindForActivity('CHOPPIN'), activityKey: 'CHOPPIN|Birch Tree', mapIdx: 1 } }; render(); return 1; })()`);
      await pick(5);
      const t = await itemTask('Bleach Logs');
      assert.ok(t); assert.equal(t.section, 'archive');
      assert.ok(!(await listed()).includes(t.id), 'inactive, so no card');
      assert.deepEqual(await fields(), ['Logs / hour', 'Chopping EXP / hour'], 'the planned activity’s boxes');
      await h.type(statBox('iph'), '50');
      await run('document.activeElement.blur(); 1');
      assert.equal((await run(`rates['5|CHOPPIN|Birch Tree']`)).iph, '50');
      assert.equal(await run(`taskCalc(tasks.find(x => x.id === ${J(t.id)})).rate`), 50, 'what it would give');
      const skill = await run(`tasks.find(x => x.slot === 5 && x.type === 'skill').id`);
      await h.setActivity(5, 'BirchTree', { mapIdx: 1, active: false });
      const after = await itemTask('Bleach Logs');
      assert.equal(after.id, t.id, 'the save lands on the same card');
      assert.equal(after.section, 'active');
      assert.equal(after.starred, false, 'starred only while planned');
      assert.equal(await run(`taskCalc(tasks.find(x => x.id === ${J(t.id)})).rate`), 50);
      assert.ok(skill);
    });
    await test('a stat typed once on the activity is every one of its tasks’', async () => {
      await h.setActivity(3, 'w7b3', { mapIdx: 317, active: false });
      await pick(3);
      const cards = await run(`[...document.querySelectorAll('#plannerTasks .tcard')].map(n => n.dataset.task).filter(id => (t => t.type === 'clear' || t.type === 'card' || (t.type === 'item' && t.source === 'monster'))(tasks.find(t => t.id === id)))`);
      assert.ok(cards.length >= 2, J(cards));
      await h.type(statBox('kph'), '777');
      await run('document.activeElement.blur(); paintAll(); 1');
      for (const id of cards) assert.equal(await run(`taskField(plannerOwner(${J(id)}).statTask || plannerOwner(${J(id)}).task, 'kph')`), '777', id);
    });
    await test('a card’s target rank stops at the top, typed, dragged or already saved', async () => {
      await edit(3);
      const id = await run(`(tasks.find(t => t.slot === 3 && t.type === 'card' && taskIsActive(t)) || upsertTask({ slot: 3, type: 'card', monster: 'w7b3', activityKey: 'FIGHTING|Pirate Underling', match: { kind: 'activity', key: 'FIGHTING|Pirate Underling' }, source: 'monster', chance: cardDropOf('w7b3')?.[1] ?? null })).id`);
      await run('render(); 1');
      const top = await run(`(t => cardRank(t.monster, saveFacts().cards[t.monster] || 0, saveFacts().unlocks).top - 1)(tasks.find(t => t.id === ${J(id)}))`);
      assert.ok(top <= 6, 'never above 6 stars: ' + top);
      await h.type(box(id, 'goal'), '99');
      assert.equal(await run(`document.querySelector(${J(box(id, 'goal'))}).value`), String(top), 'the box');
      await run('document.activeElement.blur(); 1');
      assert.equal(await run(`tasks.find(t => t.id === ${J(id)}).goal`), String(top), 'the task');
      await h.type(box(id, 'goal'), String(top));
      assert.equal(await run(`document.querySelector(${J(box(id, 'goal'))}).value`), String(top), 'the top itself is allowed');
      await h.type(box(id, 'goal'), '');
      assert.equal(await run(`tasks.find(t => t.id === ${J(id)}).goal`), '', 'blank is still the next rank');
      await run(`document.activeElement.blur(); tasks.find(t => t.id === ${J(id)}).goal = '50'; syncTasks(); 1`);
      assert.equal(await run(`tasks.find(t => t.id === ${J(id)}).goal`), String(top), 'an old saved one comes down');
      await run(`tasks.find(t => t.id === ${J(id)}).goal = ''; render(); 1`);
      const dragged = await run(`(() => { const n = document.querySelector(${J(box(id, 'goal'))}); n.value = nudgeText('${top}', 3); n.dispatchEvent(new Event('input', { bubbles: true })); return n.value; })()`);
      assert.equal(dragged, String(top), 'dragging up');
      await run(`tasks.find(t => t.id === ${J(id)}).goal = ''; 1`);
    });
    await test('every fighter has a Class level card with an EXP box, aimed at the next level by default', async () => {
      const fighter = await run(`rows.find(r => r.slot != null && kindOf(r) === 'kills' && !tasks.some(t => t.slot === r.slot && t.type === 'class' && !t.auto)).slot`);
      await edit(fighter);
      const t = await run(`(t => t && { id: t.id, auto: t.auto, starred: t.starred, section: taskSection(t) })(tasks.find(x => x.slot === ${fighter} && x.type === 'class'))`);
      assert.ok(t, 'made by the sync'); assert.equal(t.auto, true); assert.equal(t.starred, false); assert.equal(t.section, 'active');
      assert.deepEqual(await labels(t.id), ['Class EXP / hour', 'Class goal']);
      assert.equal(await run(`document.querySelector(${J(box(t.id, 'goal'))}).placeholder`), 'Next level');
      await h.type(box(t.id, 'xph'), '1e9');
      await run('document.activeElement.blur(); paintAll(); 1');
      const c = await run(`(c => [c.target, c.level, c.hours > 0, c.rate])(taskCalc(tasks.find(x => x.id === ${J(t.id)})))`);
      assert.equal(c[0], c[1] + 1, 'next level'); assert.equal(c[2], true, 'with an ETA'); assert.equal(c[3], 1e9);
      await h.setActivity(fighter, 'Divinity', { mapIdx: 200, active: false });
      assert.equal(await run(`taskSection(tasks.find(x => x.id === ${J(t.id)}))`), 'archive', 'gone when no longer fighting');
      assert.equal(await run(`tasks.filter(x => x.slot === ${fighter} && x.type === 'class').length`), 1, 'one per character');
    });
    await test('the panel lists what’s starred or being played; the rest folds away', async () => {
      const r = await run(`(() => {
        const live = activePlayerSlot(), idle = rows.find(x => x.slot != null && x.slot !== live && kindOf(x) === 'kills').slot;
        const t = tasks.find(x => x.slot === idle && x.type === 'class'), mine = tasks.find(x => x.slot === live && x.type === 'class');
        t.starred = false; delete t.hidden; panelOpen.more = false; paintPanel();
        const listed = id => [...document.querySelectorAll('.pc')].some(n => n.dataset.id === id), a = listed(t.id), b = mine ? listed(mine.id) : null;
        t.starred = true; paintPanel(); const c = listed(t.id); t.starred = false;
        panelOpen.more = true; paintPanel(); const d = listed(t.id); panelOpen.more = false; paintPanel();
        return { idleUnstarred: a, played: b, idleStarred: c, inTheFold: d };
      })()`);
      assert.equal(r.idleUnstarred, false, 'an idle character’s auto task stays out of the way');
      assert.equal(r.idleStarred, true, 'unless it’s starred');
      assert.equal(r.inTheFold, true, 'it can still be found');
      if (r.played != null) assert.equal(r.played, true, 'the played character’s show');
    });
    await test('a level task with no goal levels again rather than finishing', async () => {
      const r = await run(`(() => {
        const live = activePlayerSlot(), t = tasks.find(x => x.slot === live && x.type === 'class'); const was = t.goal, row = rows.find(x => x.slot === live);
        t.goal = ''; const lvl = Math.floor(parseNum(row.classLvl));
        const home = statHome(t, 'xph'); const box = rates[home] = rates[home] || {}, kept = box.xph; const v0 = taskView(t), hours = Math.max((Date.now() - (v0.startedAt || Date.now() - 36e5)) / 36e5, 1e-3), scale = v0.scale > 0 ? v0.scale : 1, three = [0, 1, 2].reduce((n, i) => n + expReq(0, lvl + i) / scale, 0); if (!v0.startedAt) row.afkSince = Date.now() - 36e5; box.xph = String(three / hours);
        const blank = taskCalc(t); t.goal = String(lvl + 1); const typed = taskCalc(t); t.goal = was; if (kept == null) delete box.xph; else box.xph = kept;
        return { doneBlank: blank.done, targetBlank: blank.target, lvl, doneTyped: typed.done };
      })()`);
      assert.equal(r.doneBlank, false, 'always another level');
      assert.ok(r.targetBlank > r.lvl, JSON.stringify(r));
      assert.equal(r.doneTyped, true, 'a level you typed can still be reached');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
