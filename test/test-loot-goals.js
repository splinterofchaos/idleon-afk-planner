// Loot rates: AFK stats on top, goals on cards and EXP, active kills for cards, stars. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(300);
    const slot = await run(`activePlayerSlot()`), mon = await run(`rows.find(r => r.slot === ${slot}).monster`), map = await run(`rows.find(r => r.slot === ${slot}).mapIdx`);
    const view = `({ active: { slot: ${slot}, name: 'x', afkId: ${JSON.stringify(mon)}, mapIdx: ${map}, ms: 36e5, at: Date.now(), items: [{ item: 'kills', gained: 5e6, ms: 36e5, count: 0 }, { item: ${JSON.stringify('card:' + mon)}, gained: 10, ms: 36e5, count: 1000 }], exp: [{ skill: 5, gained: 9e12, ms: 36e5, level: 100, into: 1, need: 5e12 }, { skill: 0, gained: 1e9, ms: 36e5, level: 100, into: 1, need: 1e12 }, { skill: 3, gained: 1e8, ms: 36e5, level: 50, into: 1, need: 1e10 }] }, goals: {} })`;
    await run(`window.__refresh = refreshLoot; refreshLoot = async () => {}; showTab('loot'); window.V = ${view}; lootNow = V; paintLoot(V); 1`);
    const box = label => `document.querySelector('#lootResult input[aria-label=${JSON.stringify(label)}]')`;
    await test('AFK stats sit at the top, and write the activity’s numbers', async () => {
      assert.ok(await run(`$('lootResult').firstElementChild.classList.contains('loot-stats-box')`));
      assert.deepEqual(await run(`[...document.querySelectorAll('.loot-stats .label')].map(n => n.textContent)`), ['AFK kills / hr', 'Multikill %', 'Drop rate', 'EXP / hr', 'Applies to'], 'class and Chopping are both rising here');
      await h.type(`#lootResult input[aria-label="AFK kills / hr"]`, '777k'); await h.key('Tab');
      await run(`refreshLoot = async () => {}; 1`);
      assert.equal(await run(`rowStat(rows.find(r => r.slot === ${slot}), 'kph')`), '777k');
      await run(`paintLoot(V); 1`);
    });
    await test('with two skills rising, the EXP box writes nothing until it’s told which', async () => {
      const xph = sk => run(`(t => statGet(t, 'xph'))(lootExpShape(rows.find(r => r.slot === ${slot}), ${sk}))`), before = await xph(0);
      assert.deepEqual(await run(`[...$('lootExpWhich').options].map(o => o.textContent)`), ['Choose', 'Class EXP', 'Chopping EXP'], 'always-on skills aren’t offered');
      assert.match(await run(`document.querySelector('.loot-stats-box .note').textContent`), /choose which/);
      await h.type('#lootResult input[aria-label="EXP per hour"]', '5e9'); await h.key('Tab');
      assert.equal(await xph(0), before, 'not written');
      assert.equal(await xph(3), '', 'nor to the other');
      await run(`(() => { const s = $('lootExpWhich'); s.value = '3'; s.dispatchEvent(new Event('change', { bubbles: true })); paintLoot(V); })()`);
      assert.equal(await xph(3), '5e9', 'chosen, so it lands');
      assert.equal(await xph(0), before, 'the class number is untouched');
      assert.equal(await run(`document.querySelector('#lootResult input[aria-label="EXP per hour"]').value`), '5e9');
      assert.equal(await run(`!!document.querySelector('.loot-stats-box .note')`), false);
    });
    await test('with one skill rising, there’s no choice to make', async () => {
      await run(`paintLoot({ ...V, active: { ...V.active, exp: V.active.exp.filter(x => x.skill !== 3) } }); 1`);
      assert.equal(await run(`!!$('lootExpWhich')`), false);
      assert.ok((await run(`[...document.querySelectorAll('.loot-stat .label')].map(n => n.textContent)`)).includes('Class EXP / hr'));
      await h.type('#lootResult input[aria-label="EXP per hour"]', '7e9'); await h.key('Tab');
      assert.equal(await run(`rowStat(rows.find(r => r.slot === ${slot}), 'xph')`), '7e9');
      await run(`paintLoot(V); 1`);
    });
    await test('EXP list: what the activity levels first; the always-on skills after', async () => {
      assert.deepEqual(await run(`[...document.querySelectorAll('#lootResult .found .who-name')].map(n => n.textContent).filter(t => / EXP$/.test(t))`), ['Class EXP', 'Chopping EXP', 'Alchemy EXP']);
    });
    await test('a card with no goal aims at its next star: live then AFK, with no task made', async () => {
      const before = await run(`tasks.length`);
      await run(`paintLoot(V); 1`);
      const r = await run(`(() => { const name = cardName(${JSON.stringify('card:' + mon)}), line = [...document.querySelectorAll('#lootResult .found')].find(n => n.querySelector('.who-name').textContent === name); return line && { text: line.querySelector('.text').innerText, live: line.querySelector('.count:not(.loot-afk)').innerText, afk: line.querySelector('.count.loot-afk') && line.querySelector('.count.loot-afk').innerText, tasks: tasks.filter(t => t.type === 'card' && t.monster === ${JSON.stringify(mon)}).length }; })()`);
      assert.ok(r, 'a card row');
      assert.match(r.text, /★ → .*★ · .* of /, JSON.stringify(r));
      assert.doesNotMatch(r.text, /gained over/, 'no extra detail');
      assert.match(r.live, /live \/ hour/); assert.match(r.afk || '', /AFK \/ hour/);
      assert.equal(await run(`tasks.length`), before, 'nothing added');
    });
    await test('a card goal from its row: stars, with the top as the limit', async () => {
      await h.type(`#lootResult input[aria-label="Goal for ` + await run(`cardName(${JSON.stringify('card:' + mon)})`) + `"]`, '99'); await h.key('Tab');
      const t = await run(`(t => t && { goal: t.goal, starred: t.starred, auto: t.auto, type: t.type })(lootCardTask(${slot}, ${JSON.stringify(mon)}))`), top = await run(`cardRank(${JSON.stringify(mon)}, saveFacts().cards[${JSON.stringify(mon)}] || 0, saveFacts().unlocks).top - 1`);
      assert.equal(t.goal, String(top)); assert.equal(t.starred, true); assert.equal(t.type, 'card');
      await run(`paintLoot(V); 1`);
      assert.match(await run(`$('lootResult').textContent`), /★/, 'in stars');
      assert.doesNotMatch(await run(`$('lootResult').textContent`), /Rank \d/);
    });
    await test('card rate: what’s been seen, otherwise active kills; the AFK figures stay separate', async () => {
      const r = await run(`(() => {
        const kept = JSON.stringify(rows); rows.filter(x => x.slot !== ${slot} && x.monster === ${JSON.stringify(mon)}).forEach(x => { x.monster = ''; x.kind = 'exp'; }); // only this character on it: others would count at the team's drop rate
        lootNow = V; const t = lootCardTask(${slot}, ${JSON.stringify(mon)}), row = rows.find(x => x.slot === ${slot}), rate = () => taskRate(t).rate; setRowStat(row, 'dr', '2'); setRowStat(row, 'kph', '1000');
        const seen = rate(); lootNow = { active: { ...V.active, items: V.active.items.filter(i => i.item === 'kills') } };
        const active = rate(), afk = taskRate(t, null, true).rate; lootNow = { active: { ...V.active, items: [] } }; const typed = rate(); lootNow = V; rows.splice(0, rows.length, ...JSON.parse(kept));
        return { seen, active, afk, typed };
      })()`);
      assert.ok(Math.abs(r.seen - 10) < 1e-9, 'the cards seen: ' + r.seen);
      assert.ok(r.active > r.afk && r.active / r.afk > 4000, JSON.stringify(r));
      assert.ok(Math.abs(r.typed - r.afk) < 1e-6, 'with no active kills, the AFK figures');
    });
    await test('a level goal from the EXP list', async () => {
      await h.type(`#lootResult input[aria-label="Goal for Chopping EXP"]`, '60'); await h.key('Tab');
      const t = await run(`(t => t && { type: t.type, skill: t.skill, goal: t.goal, starred: t.starred, title: taskTitle(t) })(lootLevelTask(${slot}, 3))`);
      assert.deepEqual(t, { type: 'skill', skill: 3, goal: '60', starred: true, title: 'Chopping' });
      await h.type(`#lootResult input[aria-label="Goal for Class EXP"]`, '+5'); await h.key('Tab');
      const c = await run(`(t => ({ type: t.type, goal: t.goal, starred: t.starred }))(lootLevelTask(${slot}, 0))`), lvl = await run(`rows.find(r => r.slot === ${slot}).classLvl`);
      assert.equal(c.type, 'class'); assert.equal(c.goal, String(+lvl + 5), '+5 locks in'); assert.equal(c.starred, true);
      await h.type(`#lootResult input[aria-label="Goal for Alchemy EXP"]`, '150'); await h.key('Tab');
      assert.equal(await run(`taskTitle(lootLevelTask(${slot}, 5))`), 'Alchemy');
      await run(`paintLoot(V); 1`);
      assert.equal(await run(`${box('Goal for Chopping EXP')}.value`), '60', 'the box shows it');
    });
    await test('Alchemy, Lab, Construction and Research have their skill icons', async () => {
      const r = await run(`[5, 12, 8, 20].map(skill => taskIconName({ type: 'skill', skill, slot: 0, activityKey: 'FIGHTING|x', monster: 'w7b3' }))`);
      assert.deepEqual(r, ['ClassIcons46', 'ClassIcons53', 'ClassIcons49', 'ClassIcons61']);
      const icons = await run(`[...document.querySelectorAll('#lootResult .found')].filter(n => /Alchemy EXP/.test(n.textContent)).map(n => n.querySelector('img').getAttribute('src'))`);
      assert.deepEqual(icons, ['icons/ClassIcons46.png'], 'on the EXP list');
      assert.equal(await run(`PICK_SKILLS.find(s => s.activity === 'LABORATORY').icon`), 'ClassIcons53', 'and the activity picker');
    });
    await test('an Alchemy goal is active while its character is played, on anything, and goes by the rate seen', async () => {
      const other = await run(`rows.find(r => r.slot != null && r.slot !== ${slot}).slot`);
      const r = await run(`(() => {
        const t = lootLevelTask(${slot}, 5), them = { slot: ${other}, type: 'skill', skill: 5, match: { kind: 'played' }, activityKey: 'FIGHTING|x', key: 'y' };
        lootNow = V;
        return { match: t.match.kind, section: taskSection(t), rate: taskRate(t).rate, source: taskRate(t).rateSource, theirs: taskIsActive(them) };
      })()`);
      assert.equal(r.match, 'played'); assert.equal(r.section, 'active', 'though nothing about the activity says so');
      assert.ok(Math.abs(r.rate - 9e12) < 1, 'the measured rate: ' + r.rate); assert.equal(r.source, 'loot rate');
      assert.equal(r.theirs, false, 'not while someone else is being played');
    });
    await test('blank takes a goal away', async () => {
      await h.type(`#lootResult input[aria-label="Goal for Chopping EXP"]`, ''); await h.key('Tab');
      assert.equal(await run(`lootLevelTask(${slot}, 3).goal`), '');
    });
    await test('Sync now says how long ago the last sync was', async () => {
      await run(`lastSyncAt = Date.now() - 42e3; paintLastSync(Date.now()); 1`);
      assert.equal(await run(`$('lastSync').textContent`), 'Synced 42s ago');
      assert.equal(await run(`$('lastSync').hidden`), false);
      assert.equal(await run(`$('lastSync').nextElementSibling.id`), 'topSync', 'right beside the button');
      await run(`lastSaveAt = Date.now() - 190e3; paintLastSync(Date.now()); 1`);
      assert.equal(await run(`$('lastSave').textContent`), 'Game saved 3m ago', 'when the game last saved, a guide to the next sync');
      assert.equal(await run(`$('lastSave').hidden`), false);
      assert.equal(await run(`$('lastSave').nextElementSibling.id`), 'lastSync');
      assert.equal(await run(`syncAgo(5 * 6e4 + 1000)`), '5m ago');
      assert.equal(await run(`syncAgo(2 * 36e5 + 6e4)`), '2h 1m ago');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
