// Skilling cards are timed by cards per hour measured from the saves, with nothing to type. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
const J = JSON.stringify, H = 36e5;
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 600)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, width: 1400, height: 900 }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    const slot = await run(`rows.find(x => x.slot != null).slot`);
    const cards = n => d => { const c = JSON.parse(d.Cards0); Object.assign(c, n); d.Cards0 = J(c); };
    const task = `tasks.find(x => x.type === 'card' && x.monster === 'Copper')`;
    await test('each new save is logged: the card count, and whether they were on it', async () => {
      await h.bump(d => { d['AFKtarget_' + slot] = 'Copper'; cards({ Copper: 3 })(d); }); await sleep(400);
      await h.bump(cards({ Copper: 5 })); await sleep(300);
      await h.bump(cards({ Copper: 9 })); await sleep(300);
      const log = await run(`${task}.cardLog`);
      assert.ok(log && log.length >= 3, J(log));
      assert.deepEqual(log.slice(-3).map(x => [x.n, x.on]), [[3, true], [5, true], [9, true]]);
      assert.ok(log.slice(-3).every((x, i, a) => !i || x.t > a[i - 1].t));
      await h.bump(() => {}); await sleep(300); // a save with no newer time adds nothing twice
      const n = (await run(`${task}.cardLog`)).length;
      await run(`syncTasks(); 1`);
      assert.equal((await run(`${task}.cardLog`)).length, n);
    });
    await test('under an hour on it, it says it is measuring; there is no rate box, only the target', async () => {
      const k = await run(`(() => { const k = taskCalc(${task}); return { needs: k.needs, rate: k.rate, hours: k.hours }; })()`);
      assert.equal(k.needs, 'Measuring from your saves: needs an hour on it'); assert.equal(k.rate, 0); assert.equal(k.hours, null);
      await run(`showTab('player'); selectPlayer(${slot}); 1`); await sleep(300);
      const id = await run(`${task}.id`);
      assert.deepEqual(await run(`[...document.querySelectorAll('.task-editor[data-task="${id}"] .fld .label')].map(n => n.textContent)`), ['Target stars']);
    });
    await test('the rate counts only time on it, leaves out cards used up, and times the ETA', async () => {
      const r = await run(`(() => { const t = ${task}, now = Date.now(), at = h => now - h * ${H};
        t.cardLog = [
          { t: at(10), n: 100, on: false }, { t: at(8), n: 5000, on: false }, // off it: not counted, however many came in
          { t: at(6), n: 5000, on: true }, { t: at(5), n: 5010, on: true }, { t: at(4), n: 5020, on: true },
          { t: at(3.5), n: 10, on: true }, // cards used up: that stretch is left out
          { t: at(2), n: 25, on: true }, { t: at(0), n: 45, on: true } ];
        const m = skillCardRate(t, now), k = taskCalc(t, now); return { rate: m.rate, hours: m.hours, src: k.rateSource, eta: k.hours, left: k.left, target: k.target, have: k.have }; })()`);
      assert.ok(Math.abs(r.rate - 10) < 0.01, J(r));
      assert.ok(Math.abs(r.hours - 5.5) < 1e-9, J(r));
      assert.equal(r.src, 'measured');
      if (r.left > 0) assert.ok(Math.abs(r.eta - r.left / r.rate) < 0.05, J(r));
    });
    await test('recent hours count most', async () => {
      const r = await run(`(() => { const t = { cardLog: [] }, now = Date.now(), at = h => now - h * ${H};
        t.cardLog = [{ t: at(50), n: 0, on: true }, { t: at(48), n: 4, on: true }, { t: at(47), n: 4, on: false }, { t: at(2), n: 4, on: true }, { t: at(0), n: 24, on: true }];
        return skillCardRate(t, now).rate; })()`);
      // a straight average of the two stretches on it would be 6 an hour; the day-old 2 an hour counts far less
      assert.ok(r > 6 && r < 10, String(r));
    });
    await test('an hour on it with no cards says so, and no ETA', async () => {
      const r = await run(`(() => { const t = ${task}, now = Date.now(); t.cardLog = [{ t: now - 2 * ${H}, n: 50, on: true }, { t: now, n: 50, on: true }]; const k = taskCalc(t, now); return { needs: k.needs, hours: k.hours }; })()`);
      assert.equal(r.needs, 'No cards gained yet while on it'); assert.equal(r.hours, null);
    });
    await test('the details say the rate is measured; the log is kept with the tasks', async () => {
      const id = await run(`(() => { const t = ${task}, now = Date.now(); t.cardLog = [{ t: now - 3 * ${H}, n: 50, on: true }, { t: now - 60000, n: 80, on: true }]; render(); return t.id; })()`);
      await sleep(1300);
      assert.match(await run(`document.querySelector('.task-editor[data-task="${id}"]').innerText`), /cards \/ hour · measured/);
      await run(`queueSave(); 1`);
      const sheet = await h.savedSheet(), saved = (sheet.tasks || []).find(t => t.id === id);
      assert.ok(saved && Array.isArray(saved.cardLog) && saved.cardLog.length === 2, J(saved && saved.cardLog));
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
