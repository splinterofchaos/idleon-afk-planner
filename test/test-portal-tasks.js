// Portals several characters must clear: an automatic, starred task per map, with who's on it and who has cleared it. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
const J = JSON.stringify;
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 600)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, width: 1400, height: 900 }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(800);
    const portal = m => run(`(() => { const t = tasks.find(x => x.key === 'portal|${m}'); if (!t) return null; const k = taskCalc(t); return { id: t.id, starred: t.starred, auto: t.auto, slot: t.slot, title: taskTitle(t), section: taskSection(t), line: k.line, needs: k.needs, done: k.done, hours: k.hours, on: k.crew.on.map(x => x.r.slot), cleared: k.crew.cleared, need: k.crew.need, icon: taskIconName(t) }; })()`);
    // The fake save: Pirate Upper Deck (317) needs 6, none cleared, 4 on it. Molten Edge (324) needs 7, one cleared. Coralcave Outskirts (311) is open. Pirate Mess Hall (325): no one has started.
    await test('a map with players on it gets a starred task for its portal', async () => {
      const p = await portal(317);
      assert.ok(p, 'no task');
      assert.equal(p.starred, true); assert.equal(p.auto, true); assert.equal(p.slot, null);
      assert.equal(p.title, 'Pirate Upper Deck lock'); // named after the map it's on assert.equal(p.section, 'active');
      assert.equal(p.cleared, 0); assert.equal(p.need, 6); assert.equal(p.on.length, 4);
      assert.equal(p.line, '0 of 6 players cleared');
      assert.equal(p.needs, 'Needs 2 more players on this map');
      assert.match(p.icon, /^task_./);
    });
    await test('an open portal, and one no one has started, get none', async () => {
      assert.equal(await portal(311), null);
      assert.equal(await portal(325), null);
      assert.ok(await portal(324), 'Molten Edge, one cleared');
    });
    await test('the ETA is when the last clear it needs finishes', async () => {
      const r = await run(`(() => {
        const t = tasks.find(x => x.key === 'portal|324'), crew = portalCrew(324), on = crew.on.map(x => x.r);
        return { need: crew.need - crew.cleared, on: on.length };
      })()`);
      assert.ok(r.on < r.need, J(r));
      // Everyone on Pirate Upper Deck clearing, with typed kill rates: 6 needed, 4 there, so still short.
      await h.bump(d => { Object.keys(d).filter(k => /^CurrentMap_\d+$/.test(k)).slice(0, 7).forEach(k => { d[k] = 317; d['AFKtarget_' + k.split('_')[1]] = d['AFKtarget_' + k.split('_')[1]]; }); }); await sleep(600);
      const p = await portal(317);
      assert.equal(p.needs === '' || /Enter kills|more player/.test(p.needs), true, J(p));
      const typed = await run(`(() => { const crew = portalCrew(317); crew.on.forEach((x, i) => { const c = tasks.find(t => t.type === 'clear' && t.slot === x.r.slot && t.activityKey === x.r.activityKey); if (c) { c.kph = String((i + 1) * 1e6); } }); return crew.on.map(x => x.r.slot); })()`);
      const q = await run(`(() => { const t = tasks.find(x => x.key === 'portal|317'), k = taskCalc(t), crew = portalCrew(317), hrs = crew.on.map(x => x.hours).filter(h => h != null).sort((a, b) => a - b); return { hours: k.hours, needs: k.needs, hrs, left: k.left }; })()`);
      if (q.hrs.length >= q.left) assert.ok(Math.abs(q.hours - q.hrs[q.left - 1]) < 1e-4, J(q)); // read a moment apart
      else assert.ok(q.needs, J(q));
      assert.ok(typed.length >= 1);
    });
    await test('the panel card shows only who is on it, as hats, and the count cleared', async () => {
      const c = await run(`(() => { const t = tasks.find(x => x.key === 'portal|317'), n = document.querySelector('.pc[data-id="' + t.id + '"]'); if (!n) return null; return { who: n.querySelector('.pc-who').textContent, faces: n.querySelectorAll('.pc-port .portrait').length, cls: n.querySelectorAll('.pc-port .cls-icon').length, hats: [...n.querySelectorAll('.pc-port .hat')].map(i => i.getAttribute('src')), on: portalCrew(317).on.length, hatsOn: portalCrew(317).on.filter(x => x.r.hat).slice(0, 3).length }; })()`);
      assert.ok(c, 'no card');
      assert.match(c.who, /^\d+ of 6 cleared$/);
      assert.equal(c.faces, Math.min(c.on, 3));
      assert.equal(c.hats.length, c.hatsOn, J(c)); assert.ok(c.hats.every(s => /EquipmentHats/.test(s)), J(c));
    });
    await test('opening it shows its details on the Player tab: who has and has not cleared it', async () => {
      const id = (await portal(324)).id;
      await run(`document.querySelector('.pc[data-id="${id}"] .pc-main').click(); 1`); await sleep(500);
      assert.equal(await run(`$('viewPlayer').hidden`), false);
      const d = await run(`(() => { const n = document.querySelector('#playerTasks .task-editor[data-task="${id}"]'); if (!n) return null; return { groups: [...n.querySelectorAll('.ed-crew-group > .label')].map(x => x.textContent), rows: n.querySelectorAll('.ed-crew-row').length, cleared: [...n.querySelectorAll('.ed-crew-row.cleared .ed-crew-say')].map(x => x.textContent), hats: n.querySelectorAll('.ed-crew-row .hat').length, jump: n.classList.contains('jump'), fields: n.querySelectorAll('input[data-field]').length, all: rows.filter(r => r.slot != null).length }; })()`);
      assert.ok(d, 'not on the Player tab');
      assert.deepEqual(d.groups, ['Not cleared yet · ' + (d.all - 1), 'Cleared · 1']);
      assert.equal(d.rows, d.all); assert.deepEqual(d.cleared, ['Cleared']);
      assert.ok(d.hats >= 1); assert.equal(d.jump, true); assert.equal(d.fields, 0);
      await h.shot('portal-details.png', 1400);
    });
    await test('once enough have cleared, it is done', async () => {
      await h.bump(d => { Object.keys(d).filter(k => /^KLA_\d+$/.test(k)).forEach(k => { const a = JSON.parse(d[k]); a[324][0] = -5; d[k] = J(a); }); }); await sleep(600);
      const p = await portal(324);
      assert.equal(p.done, true); assert.equal(p.line, 'Portal open');
    });
    await test('it is in every player’s list on the Player tab, and not in Simulate', async () => {
      assert.ok(await run(`rows.filter(r => r.slot != null).every(r => playerTasksOf(r).some(t => t.type === 'portal'))`));
      await run(`showTab('simulate'); 1`); await sleep(300);
      assert.equal(await run(`document.querySelectorAll('#viewSimulate [data-task^="t"]').length >= 0 && ![...document.querySelectorAll('#viewSimulate *')].some(n => / lock$/.test(n.textContent) && n.children.length === 0)`), true);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
