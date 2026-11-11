// Plan an activity: world, skill, target. The tasks it makes are ordinary ones that merge with the save.
const assert = require('assert');
const { start, sleep } = require('./harness');
const J = JSON.stringify;
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, width: 1400, height: 1100 }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    const slot = await run(`(() => { const r = rows.find(x => x.slot != null && x.activity === 'FIGHTING') || rows.find(x => x.slot != null); selectPlayer(r.slot); return r.slot; })()`);
    const key = id => run(`(() => { const m = GAME.monsters[${J(id)}]; return m[1] + '|' + m[0]; })()`);
    const world = n => `#plannerPick button[aria-label="World ${n}"]`, skill = n => `#plannerPick button[aria-label="${n}"]`;
    await sleep(200);

    await test('it starts on the world buttons only', async () => {
      assert.equal(await run(`document.querySelectorAll('#plannerPick .pick-world').length`), 7);
      assert.equal(await run(`document.querySelectorAll('#plannerPick .pick-skill').length`), 0);
    });
    await test('a world shows the skills, with levels, greying what is not there', async () => {
      await h.click(world(1));
      assert.equal(await run(`document.querySelectorAll('#plannerPick .pick-skill').length`), 8);
      assert.equal(await run(`document.querySelector(${J(skill('Mining'))}).disabled`), false);
      assert.equal(await run(`document.querySelector(${J(skill('Lab'))}).disabled`), true);
      assert.equal(await run(`document.querySelector(${J(skill('Spelunking'))}).disabled`), true);
      assert.match(await run(`document.querySelector(${J(skill('Mining'))}).innerText`), /^LV \d+/);
    });
    await test('every target of the seven skills has a world', async () => {
      const r = await run(`(() => { const out = {}; PICK_SKILLS.forEach(s => { if (s.activity === 'FIGHTING') return; const all = Object.entries(GAME.monsters).filter(([, v]) => v[1] === s.activity).map(([k]) => k); out[s.activity] = all.filter(k => ![1,2,3,4,5,6,7].some(w => pickTargets(w, s.activity).some(t => t.id === k))); }); return out; })()`);
      Object.values(r).forEach(miss => assert.deepEqual(miss, []));
      assert.deepEqual(await run(`[1,2,3,4,5,6,7].map(w => pickTargets(w, 'FIGHTING').length > 0)`), Array(7).fill(true));
      assert.deepEqual(await run(`[pickTargets(7,'MINING').map(t => t.id), pickTargets(4,'CHOPPIN').some(t => t.id==='Tree8'), pickTargets(5,'CHOPPIN').some(t => t.id==='Tree8')]`), [['Prehistrium'], true, true]);
    });
    await test('picking a mining target makes a goal, and the fields are there at once', async () => {
      await h.click(skill('Mining'));
      await h.click(`#plannerPick button[aria-label="Gold"]`);
      await sleep(200);
      const t = await run(`(() => { const t = tasks.find(x => x.slot === ${slot} && x.type === 'skill' && x.skill === 1); return { key: t.activityKey, starred: t.starred, section: taskSection(t) }; })()`);
      assert.deepEqual(t, { key: await key('Gold'), starred: false, section: 'archive' });
      assert.equal(await run(`document.querySelectorAll('#plannerPick .pick-skill').length`), 0, 'back to the start');
      assert.match(await run(`$('plannerTasks').innerText`), /Mining EXP/i, 'its boxes, with no goal card');
    });
    await test('typed rates land where the real activity reads them', async () => {
      const home = await run(`(() => { const t = tasks.find(x => x.slot === ${slot} && x.type === 'skill' && x.skill === 1); return statHome(t, 'xph'); })()`);
      assert.equal(home, slot + '|' + await key('Gold'));
    });
    await test('the next save that shows it merges into the same task', async () => {
      const id = await run(`tasks.find(x => x.slot === ${slot} && x.type === 'skill' && x.skill === 1).id`);
      await run(`statSet(tasks.find(x => x.id === ${J(id)}), 'xph', '777'); 1`);
      await h.bump(d => { d['AFKtarget_' + slot] = 'Gold'; });
      await sleep(300);
      const r = await run(`(() => { const list = tasks.filter(x => x.slot === ${slot} && x.type === 'skill' && x.skill === 1), t = list[0]; return { n: list.length, id: t.id, section: taskSection(t), xph: statGet(t, 'xph') }; })()`);
      assert.deepEqual(r, { n: 1, id, section: 'active', xph: '777' });
    });
    await test('another target of the skill being done stays planned until the save moves', async () => {
      const t = () => run(`(() => { const t = tasks.find(x => x.slot === ${slot} && x.type === 'skill' && x.skill === 1); return { key: t.activityKey, section: taskSection(t) }; })()`);
      await run(`pickState.activity = 'MINING'; planActivity(${slot}, 'MINING', { id: 'Copper', name: 'Copper' }); syncTasks(); 1`);
      assert.deepEqual(await t(), { key: await key('Copper'), section: 'archive' }, 'still on Gold in the save');
      await h.bump(() => {});
      await sleep(200);
      assert.deepEqual(await t(), { key: await key('Copper'), section: 'archive' }, 'a save still saying Gold changes nothing');
      await h.bump(d => { d['AFKtarget_' + slot] = 'Copper'; });
      await sleep(200);
      assert.deepEqual(await t(), { key: await key('Copper'), section: 'active' }, 'it arrived');
      await h.bump(d => { d['AFKtarget_' + slot] = 'Iron'; });
      await sleep(200);
      assert.deepEqual(await t(), { key: await key('Iron'), section: 'active' }, 'following the game again');
    });
    await test('combat makes the same clear and card tasks a save would', async () => {
      const r = await run(`(() => {
        const has = x => pickPortalLeft(${slot}, x.mapIdx) > 0 || (CARD_TIERS[x.id] && saveFacts().cards && cardRank(x.id, saveFacts().cards[x.id] || 0, saveFacts().unlocks)?.nextAt != null), t = [1,2,3,4,5,6,7].flatMap(w => pickTargets(w, 'FIGHTING')).find(has), got = planActivity(${slot}, 'FIGHTING', t);
        return { types: got.made.map(x => x.type), sections: got.made.map(taskSection), keys: got.made.map(x => x.key), id: t.id, map: t.mapIdx, left: pickPortalLeft(${slot}, t.mapIdx) };
      })()`);
      assert.ok(r.types.length > 0, 'something to track: ' + J(r));
      r.sections.forEach(s => assert.equal(s, 'archive', 'planning makes nothing a goal'));
      const mk = await key(r.id);
      r.types.forEach((ty, i) => assert.ok(r.keys[i].includes(mk) || ty === 'card', r.keys[i]));
      await h.bump(d => { d['AFKtarget_' + slot] = r.id; d['CurrentMap_' + slot] = r.map; });
      await sleep(300);
      const after = await run(`tasks.filter(x => x.slot === ${slot} && x.activityKey === ${J(mk)} && (x.type === 'clear' || x.type === 'card')).map(x => [x.type, taskSection(x)])`);
      const n = {}; after.forEach(([ty]) => { n[ty] = (n[ty] || 0) + 1; });
      Object.values(n).forEach(c => assert.equal(c, 1, 'no duplicates: ' + J(after)));
      after.forEach(([, s]) => assert.equal(s, 'active', J(after)));
    });
    await test('planning combat never makes its card a goal, and leaves a card you starred alone', async () => {
      const r = await run(`(() => { const has = x => CARD_TIERS[x.id] && saveFacts().cards && cardRank(x.id, saveFacts().cards[x.id] || 0, saveFacts().unlocks)?.nextAt != null, x = [1,2,3,4,5,6,7].flatMap(w => pickTargets(${slot}, 'FIGHTING', w)).find(has); if (!x) return null; tasks = tasks.filter(t => !(t.type === 'card' && t.monster === x.id)); planActivity(${slot}, 'FIGHTING', x); const t = tasks.find(y => y.type === 'card' && y.monster === x.id), fresh = !!t.starred; t.starred = true; planActivity(${slot}, 'FIGHTING', x); const kept = !!t.starred; t.starred = false; t.auto = true; planActivity(${slot}, 'FIGHTING', x); return { fresh, kept, stays: t.starred, auto: t.auto }; })()`);
      assert.deepEqual(r, { fresh: false, kept: true, stays: false, auto: true });
    });
    await test('a cleared map with a maxed card still lets you add a goal from its drops', async () => {
      const r = await run(`(() => {
        const t = [1,2,3,4,5,6,7].flatMap(w => pickTargets(w, 'FIGHTING')).find(x => (DROPS[x.id] || []).some(d => !/ Card$/.test(d[0])) && !(pickPortalLeft(${slot}, x.mapIdx) > 0));
        window.tiersBack = CARD_TIERS[t.id]; delete CARD_TIERS[t.id];
        pickState.world = 1; pickState.activity = 'FIGHTING'; pickChoose(${slot}, t);
        return { id: t.id, name: t.name, drop: [...DROPS[t.id]].sort((a, b) => b[1] - a[1]).find(d => !/ Card$/.test(d[0]))[0] }; // the most common: the rarest fold under Show more
      })()`);
      await sleep(200);
      assert.equal(await run(`document.querySelector('#plannerTasks .act-title').firstChild.textContent`), r.name, 'the planned activity');
      await run(`document.querySelector('#plannerTasks .act-drop[data-item=' + JSON.stringify(${J(r.drop)}) + '] .act-add').click(); 1`);
      await run(`(f => { f.querySelector('input').value = '5k'; f.requestSubmit(); })(document.querySelector('#plannerTasks .act-goal-form')); 1`);
      await sleep(200);
      const t = await run(`(() => { const t = tasks.find(x => x.type === 'item' && x.itemName === ${J(r.drop)}); return { key: t.key, slot: t.slot, starred: t.starred }; })()`);
      assert.deepEqual(t, { key: 'item|' + r.drop, slot: null, starred: true });
      await run(`if (window.tiersBack) CARD_TIERS[${J(r.id)}] = window.tiersBack; pickPlanned = null; plannerAddShown = null; render(); 1`);
    });
    await test('The Hole’s cavern fighters are in World 5, golems included', async () => {
      const hole = await run(`pickTargets(5, 'FIGHTING').filter(t => t.mapIdx === 216).map(t => [t.id, t.name, t.place])`);
      assert.deepEqual(hole.map(x => x[0]), ['caveA', 'caveB', 'caveC', 'caveD']);
      assert.deepEqual(hole[2], ['caveC', 'Ancient Golem', 'The Hole']);
      await run(`pickState.world = 5; pickState.activity = 'FIGHTING'; pickShown = null; showTab('planner'); renderActivityPicker(selectedRow()); 1`);
      assert.deepEqual(await run(`[...document.querySelectorAll('#plannerPick .pick-hole .pick-name')].map(n => n.textContent)`), ['Demon Hound', 'Gloomie Mushroom', 'Ancient Golem', 'Crystal Glunko'], 'in a group of their own');
      assert.equal(await run(`[...document.querySelectorAll('#plannerPick .pick-targets:not(.pick-hole) .pick-name')].some(n => n.textContent === 'Ancient Golem')`), false, 'not with the maps');
      assert.equal(await run(`document.querySelector('#plannerPick .pick-group').textContent`), 'The Hole');
    });
    await test('undo takes a new plan away', async () => {
      await run(`tasks.filter(t => t.slot === ${slot} && t.type === 'exp').forEach(t => deleteTask(t.id)); 1`);
      const count = await run(`tasks.length`);
      await run(`selectPlayer(${slot}); pickState.world = 4; pickState.activity = 'LABORATORY'; pickShown = null; renderActivityPicker(selectedRow()); 1`);
      await sleep(100);
      await h.click(`#plannerPick .pick-target`);
      await sleep(150);
      assert.equal(await run(`tasks.length`), count + 1);
      assert.equal(await run(`tasks.find(t => t.activityKey && t.activityKey.startsWith('LABORATORY') && t.slot === ${slot}).type`), 'exp');
      await run(`$('undo').click(); 1`);
      await sleep(150);
      assert.equal(await run(`tasks.length`), count);
    });
    await test('no sideways overflow on a phone', async () => {
      await run(`pickState.world = 1; pickState.activity = 'FIGHTING'; pickShown = null; renderActivityPicker(selectedRow()); 1`);
      await h.shot('picker-narrow.png', 400, 1100);
      assert.equal(await run(`document.documentElement.scrollWidth - document.documentElement.clientWidth`), 0);
      await h.shot('picker.png', 1400, 1100);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
