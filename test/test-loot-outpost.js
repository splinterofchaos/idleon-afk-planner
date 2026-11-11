// Loot rates measure Royal Guardian outpost clearing on the map being played. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, realLoot: true, savedAt: Date.now() - 12 * 36e5 }), run = h.run; // room for every save to be 5 minutes on from the last
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    const a0 = (await run(`api('/api/loot')`)).active, slot = a0.slot, map = a0.mapIdx;
    await h.bump(d => { d['CharacterClass_' + slot] = 16; }); await h.poll(); await sleep(300); // a Royal Guardian: only they clear outposts
    const P = v => typeof v === 'string' ? JSON.parse(v) : v;
    // map: what's cleared on the played map; kills: how far the kills counter moves
    const step = (cleared, kills) => h.bump(d => {
      const m = P(d.RoyalMaps) || []; while (m.length <= map) m.push([]); m[map] = cleared == null ? [3, 3, 0, 1, 2, 3, 4, 0, 76, -1, 0, 1, 1] : [cleared]; d.RoyalMaps = JSON.stringify(m);
      const k = P(d['KLA_' + slot]); k[map][0] = (+k[map][0] || 0) - kills; d['KLA_' + slot] = JSON.stringify(k);
    });
    // clearing units (job 4) sent at maps: world 1's units, RoyalG[6] their jobs and RoyalG[7] their maps; the other worlds' none
    const sendUnits = (d, at) => { const g = P(d.RoyalG) || []; while (g.length < 22) g.push([]); for (let w = 0; w < 8; w++) { g[6 + 2 * w] = []; g[7 + 2 * w] = []; } g[6] = at.map(() => 4); g[7] = at; d.RoyalG = JSON.stringify(g); };
    const outpost = async () => (await run(`api('/api/loot')`)).active.items.find(x => x.item === 'outpost');
    await test('a map first seen while cleared isn’t counted as gained', async () => {
      await h.bump(d => { const m = P(d.RoyalMaps); m[map] = []; d.RoyalMaps = JSON.stringify(m); }); // nothing being cleared here yet
      await step(41359237, 0);
      assert.ok(!(await outpost()));
    });
    await test('what’s cleared between saves is counted, and kills each is kills over cleared', async () => {
      await step(41359237 + 240, 4.1e7);
      await step(41359237 + 480, 4.1e7);
      const o = await outpost();
      assert.equal(o.gained, 480); assert.equal(o.count, 41359237 + 480);
      await run(`showTab('loot'); refreshLoot()`); await sleep(500);
      const t = await run(`(() => { const line = [...document.querySelectorAll('#lootResult .found')].find(n => /outpost$/.test(n.querySelector('.who-name').textContent)); return line && line.textContent; })()`);
      assert.ok(t, 'an Outpost clearing row');
      assert.match(t, /41\.3\w* cleared on this map/i);
      assert.match(t, /170\w* kills each/, t); // 8.2e7 kills over 480 cleared
      assert.ok((await run(`[...document.querySelectorAll('#lootResult .label')].map(x => x.textContent)`)).includes('Outpost clearing'));
    });
    await test('a built outpost stops it, and its time isn’t counted', async () => {
      const before = await outpost();
      await step(null, 4.1e7);
      const o = await outpost();
      assert.equal(o.gained, before.gained); assert.equal(o.ms, before.ms);
      await run(`refreshLoot()`); await sleep(400);
      assert.ok(await run(`[...document.querySelectorAll('#lootResult .label')].some(x => x.textContent === 'Outpost clearing')`), 'what was measured still shows');
    });
    await test('soldiers: what the map clears while someone else is played is theirs, and comes off this character’s rate', async () => {
      // soldiers' kills are banked (RoyalG[3][0] seconds) and land in one lump when the kingdom screen is opened
      const setMap = (n, banked) => d => { sendUnits(d, [map, map]); const m = P(d.RoyalMaps); m[map] = [n]; d.RoyalMaps = JSON.stringify(m); if (banked != null) { const g = P(d.RoyalG) || []; while (g.length < 4) g.push([]); g[3] = [banked, ...(Array.isArray(g[3]) ? g[3].slice(1) : [])]; d.RoyalG = JSON.stringify(g); } };
      await h.bump(setMap(5e7, 0));
      const other = await run(`rows.find(r => r.slot != null && r.slot !== ${slot}).slot`);
      await h.setActivity(other, 'Nothing', { mapIdx: 0 }); // someone else is played: the map is the soldiers' alone
      await h.bump(setMap(5e7, 300)); // banked, nothing landed
      await h.bump(setMap(5e7 + 1000, 0)); // collected: 1000 for the 600 seconds banked, 6000 an hour
      const s = (await run(`api('/api/loot')`)).active;
      assert.notEqual(s.slot, slot);
      await h.setActivity(slot, a0.afkId, { mapIdx: map }); // back on it
      await h.bump(setMap(5e7 + 1000, 300)); // first save back: not counted for soldiers or this character
      await step(5e7 + 3000, 1e6);
      await step(5e7 + 5000, 1e6);
      const a = (await run(`api('/api/loot')`)).active;
      assert.equal(a.slot, slot);
      // one collect: 1000 for 10 minutes banked, by two units, so 500 each
      assert.ok(a.soldierUnit && a.soldierUnit.gained === 1000 && a.soldierUnit.ms === 1200e3, JSON.stringify(a.soldierUnit));
      assert.equal(a.soldiers.units, 2);
      const soldiersPerHour = a.soldiers.gained / a.soldiers.ms * 36e5;
      assert.ok(Math.abs(soldiersPerHour - 6000) < 1, String(soldiersPerHour));
      await run(`refreshLoot()`); await sleep(500);
      const t = await run(`[...document.querySelectorAll('#lootResult .found')].find(n => /outpost$/.test(n.querySelector('.who-name').textContent)).textContent`);
      assert.match(t, /6K\s*AFK \/ hour/, t); // the second column: the map while nobody plays it
      // the character's own, in its line: what the map cleared while played, less the soldiers' share of that time
      const o = a.items.find(x => x.item === 'outpost'), mine = (o.gained - soldiersPerHour * o.ms / 36e5) / o.ms * 36e5;
      assert.ok(mine > 0);
      assert.ok(t.includes(' ' + await run(`fmtRate(${mine})`) + ' / hour'), t);
    });
    await test('a Royal Guardian clearing a map gets a capture task by itself: the game’s kills needed, an ETA, and it’s done once built', async () => {
      await h.bump(() => {}); await h.poll(); await sleep(300);
      const t = await run(`(() => { const t = tasks.find(x => x.type === 'outpost' && x.mapIdx === ${map}); if (!t) return null; const k = taskCalc(t); return { title: taskTitle(t), slot: t.slot, starred: t.starred, auto: t.auto, target: k.target, have: k.have, left: k.left, hours: k.hours, rate: k.rate, need: OUTPOST_KILLS_REQ[${map}] }; })()`);
      assert.ok(t, 'made by itself');
      assert.ok(t.need > 0, 'the game says what it needs');
      assert.equal(t.target, t.need); assert.equal(t.left, t.need - t.have, JSON.stringify(t));
      assert.equal(t.slot, null); assert.equal(t.starred, true); assert.equal(t.auto, true);
      assert.match(t.title, /^Capture .* outpost$/);
      assert.equal(await run(`!!document.querySelector('#lootResult input.loot-goal[aria-label$="outpost"]')`), false, 'nothing to type');
      assert.ok(t.rate > 0 && Math.abs(t.hours - t.left / t.rate) < 1e-6 * t.hours, JSON.stringify(t));
      assert.equal(await run('OUTPOST_KILLS_REQ[152]'), 76056908, 'TV Outpost, as the game shows it');
      await step(null, 0); // built
      assert.equal(await run(`taskCalc(tasks.find(x => x.type === 'outpost')).done`), true);
    });
    await test('no row for a map still at 0 (every unbuilt map is, locked worlds too), nor for a character who isn’t a Royal Guardian', async () => {
      await h.bump(d => { d['CharacterClass_' + slot] = 16; const m = P(d.RoyalMaps) || []; while (m.length <= map) m.push([]); m[map] = [0]; d.RoyalMaps = JSON.stringify(m); }); await h.poll(); await sleep(300);
      // as on a map with nothing measured yet, and no capture goal
      await run(`tasks.filter(t => t.type === 'outpost').forEach(t => deleteTask(t.id)); refreshLoot = async () => {}; 1`);
      const fresh = () => run(`(() => { paintLoot({ ...lootNow, active: { ...lootNow.active, items: lootNow.active.items.filter(x => x.item !== 'outpost') } }); return [...document.querySelectorAll('#lootResult .label')].some(x => x.textContent === 'Outpost clearing'); })()`);
      assert.equal(await fresh(), false, 'at 0');
      await h.bump(d => { d['CharacterClass_' + slot] = 7; const m = P(d.RoyalMaps); m[map] = [5000]; d.RoyalMaps = JSON.stringify(m); }); await h.poll(); await sleep(300);
      assert.equal(await fresh(), false, 'not a Royal Guardian');
      await h.bump(d => { d['CharacterClass_' + slot] = 16; }); await h.poll(); await sleep(300);
      assert.equal(await fresh(), true, 'a Royal Guardian on a map under way');
    });
    await test('soldiers: a collect over a stretch where someone on the map was played, though live at neither save, isn’t theirs; nor is a stretch with no collect', async () => {
      const setMap = (n, banked) => d => { d['CharacterClass_' + slot] = 16; sendUnits(d, [map, map]); const m = P(d.RoyalMaps); m[map] = [n]; d.RoyalMaps = JSON.stringify(m); const g = P(d.RoyalG) || []; while (g.length < 4) g.push([]); g[3] = [banked, ...(Array.isArray(g[3]) ? g[3].slice(1) : [])]; d.RoyalG = JSON.stringify(g); };
      await h.setActivity(slot, a0.afkId, { mapIdx: map });
      await h.bump(setMap(6e7, 0));
      const g0 = ((await run(`api('/api/loot')`)).active.soldierUnit || { gained: 0 }).gained;
      const other = await run(`rows.find(r => r.slot != null && r.slot !== ${slot}).slot`);
      await h.setActivity(other, 'Nothing', { mapIdx: 0 }); // someone else is played
      await h.bump(setMap(6e7, 300));
      await h.bump(setMap(6e7 + 500, 600)); // moved with no collect: not the soldiers' lump
      await h.bump(setMap(6e7 + 1500, 0)); // collected: the soldiers' 1000
      await h.bump(setMap(6e7 + 1500, 300));
      await h.bump(d => { setMap(6e7 + 9000, 0)(d); const was = +d['PTimeAway_' + other]; d['PTimeAway_' + slot] = was + 0.01; d['PTimeAway_' + other] = was + 0.02; }); /* the save's AFK times are in thousands of seconds */ // collected, but someone on the map was played in between (and the other is played again since): not theirs
      await h.bump(setMap(6e7 + 9000, 300));
      await h.bump(setMap(6e7 + 9500, 0)); // the soldiers' 500
      await h.bump(setMap(6e7 + 9800, 0)); // the kingdom screen left open: it pays out as it goes, banking nothing, so the 300 over these 5 minutes is theirs
      await h.setActivity(slot, a0.afkId, { mapIdx: map });
      const s = (await run(`api('/api/loot')`)).active.soldierUnit;
      assert.equal(s.gained - g0, 1800, JSON.stringify(s));
    });
    await test('soldiers are kept per unit: moving them moves the rate at once, and a collect while units were being moved isn’t counted', async () => {
      const setMap = (n, banked, at) => d => { d['CharacterClass_' + slot] = 16; sendUnits(d, at); const m = P(d.RoyalMaps); m[map] = [n]; m[map + 1] = [5000]; d.RoyalMaps = JSON.stringify(m); const g = P(d.RoyalG); g[3] = [banked, ...(Array.isArray(g[3]) ? g[3].slice(1) : [])]; d.RoyalG = JSON.stringify(g); };
      const other = await run(`rows.find(r => r.slot != null && r.slot !== ${slot}).slot`);
      await h.setActivity(other, 'Nothing', { mapIdx: 0 });
      const u0 = (await run(`api('/api/loot')`)).active.soldierUnit;
      await h.bump(setMap(7e7, 300, [map, map]));
      await h.bump(setMap(7e7 + 5000, 0, [map + 1, map + 1, map + 1])); // collected, but the units moved in between: not counted
      const u1 = (await run(`api('/api/loot')`)).active.soldierUnit;
      assert.deepEqual(u1, u0);
      await h.poll(); await sleep(300);
      // the capture task: three units on the next map now, none on this one
      const r = await run(`(() => { tasks.forEach(t => { if (t.type === 'outpost') t.rateUnit = 6000 / 2; }); const k = { mapIdx: ${map + 1}, type: 'outpost' }; return { here: outpostSoldierRate({ mapIdx: ${map}, rateUnit: 3000 }), there: outpostSoldierRate({ mapIdx: ${map + 1}, rateUnit: 3000 }) }; })()`);
      assert.deepEqual(r.here, { units: 0, rate: 0, measured: true });
      assert.deepEqual(r.there, { units: 3, rate: 9000, measured: true });
    });
    await test('a capture task is split like a team task: the militia are a grey share, their banked kills what they have waiting, with their own face', async () => {
      const r = await run(`(() => { const t = { id: 'x', type: 'outpost', mapIdx: ${map + 1}, rateUnit: 3000 }; const banked = JSON.parse(saveForFinder.data.RoyalG)[3][0]; return { shares: taskShares(t), banked, color: shareColor('militia'), faces: outpostFaces(outpostCalc(t)) }; })()`);
      assert.equal(r.shares.length, 1, JSON.stringify(r.shares)); // nobody's played there
      const m = r.shares[0];
      assert.equal(m.militia, true); assert.equal(m.units, 3); assert.equal(m.rate, 9000);
      assert.ok(Math.abs(m.waiting - 9000 * r.banked / 3600) < 1e-6, JSON.stringify(m));
      assert.equal(r.color, 'var(--militia)');
      assert.deepEqual(r.faces, [{ militia: true, hat: 'Militia', name: 'Militia ×3' }]);
      assert.ok(await run(`getComputedStyle(document.documentElement).getPropertyValue('--militia').trim().length > 0`), 'a grey of its own');
    });
    await test('the played map is measured too: its jump at a collect less what the player clears between collects', async () => {
      const here = map + 2; // a map nothing's been measured on yet
      const setMap = (n, banked) => d => { d['CharacterClass_' + slot] = 16; sendUnits(d, [here, here]); const m = P(d.RoyalMaps); m[here] = [n]; d.RoyalMaps = JSON.stringify(m); const g = P(d.RoyalG); g[3] = [banked, ...(Array.isArray(g[3]) ? g[3].slice(1) : [])]; d.RoyalG = JSON.stringify(g); };
      await h.setActivity(slot, a0.afkId, { mapIdx: here });
      await h.bump(setMap(8e7, 0));
      const u0 = (await run(`api('/api/loot')`)).active.soldierUnit;
      await h.bump(setMap(8e7 + 100, 300)); // no collect: the player's own, 100 every 5 minutes
      await h.bump(setMap(8e7 + 200, 600));
      await h.bump(setMap(8e7 + 300, 900));
      let a = (await run(`api('/api/loot')`)).active;
      assert.ok(a.clearOwn && Math.abs(a.clearOwn.gained / a.clearOwn.ms * 36e5 - 1200) < 1, JSON.stringify(a.clearOwn));
      await h.bump(setMap(8e7 + 300 + 100 + 3600, 0)); // collected 1200 seconds by two units, 3600 of it theirs, 100 the player's
      a = (await run(`api('/api/loot')`)).active;
      assert.equal(a.soldierUnit.gained - u0.gained, 3600, JSON.stringify(a.soldierUnit));
      assert.equal(a.soldierUnit.ms - u0.ms, 2400e3);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
