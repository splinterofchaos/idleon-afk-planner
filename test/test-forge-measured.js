// Forge ETAs from measured bars per hour: 12 hourly segments, then days, recent ones counting most. Fake backend only.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { start, BUILD, sleep } = require('./harness');
const J = JSON.stringify;
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), why + ': ' + a + ' vs ' + b);
(async () => {
  const save = JSON.parse(fs.readFileSync(path.join(BUILD, 'fixtures', 'full-save.json'), 'utf8')).data;
  save.ForgeItemOrder = ['Iron', 'Blank', 'IronBar', 'Blank', 'Blank', 'Blank', 'Blank', 'Blank', 'Blank', 'Blank', 'Blank', 'Blank'];
  save.ForgeItemQty = [4000, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  save.ForgeIntProg = [0, 0, 0, 0];
  save.ForgeLV = [4, 50, 10, 0, 0, 0];
  delete save.Print;
  const h = await start({ sheet: true, saveData: save, noPoll: true }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    const H = 36e5;
    await test('segments: twelve hours, then seven days, newest first, older counting less', async () => {
      const s = await run(`forgeSegments([], 1e12)`);
      assert.equal(s.length, 19);
      assert.equal(s[0].label, 'Last hour'); assert.equal(s[11].to - s[11].from, H); assert.equal(s[12].to - s[12].from, 24 * H);
      assert.equal(s[12].to, s[11].from, 'no gap');
      near(s[12].weight, Math.pow(0.5, 24 / 24), 'a day centred 24 h back counts half');
      assert.ok(s.every((k, i) => i === 0 || k.weight < s[i - 1].weight));
    });
    await test('a burst lately pulls the rate up far more than the same burst days ago', async () => {
      const now = 1e12;
      const steady = Array.from({ length: 8 * 24 + 1 }, (_, i) => ({ t: now - (8 * 24 - i) * H, n: i * 10 }));
      const burst = (hoursAgo) => steady.map(p => ({ ...p, n: p.n + (p.t >= now - hoursAgo * H ? 5000 : 0) }));
      const rate = pts => run(`(() => { forgeHist.X = ${J(pts)}; return forgeMeasuredRate('X', ${now}).rate; })()`);
      near(await rate(steady), 10, 'steady');
      const recent = await rate(burst(2)), old = await rate(burst(5 * 24));
      assert.ok(recent > old * 1.5, recent + ' vs ' + old);
      assert.ok(old > 10);
    });
    await test('spending bars leaves that stretch out', async () => {
      const now = 1e12, pts = [{ t: now - 3 * H, n: 0 }, { t: now - 2 * H, n: 10 }, { t: now - H, n: 0 }, { t: now, n: 10 }];
      near(await run(`(() => { forgeHist.X = ${J(pts)}; return forgeMeasuredRate('X', ${now}).rate; })()`), 10, 'rate');
    });
    await test('ETAs use it, and still stop at the ore there is', async () => {
      const r = await run(`(() => {
        const now = Date.now(), at = saveFacts().at, pts = [{ t: at - 10 * 36e5, n: 0 }, { t: at, n: 1000 }];
        forgeHist.IronBar = pts;
        const info = forgeInfo('IronBar'), e = forgeEta('IronBar', 10, now), big = forgeEta('IronBar', 1e9, now);
        return { rate: e.rate, src: e.rateSource, note: e.note, hours: e.hours, capped: big.capped, needs: big.needs, formula: info.rate };
      })()`);
      near(r.rate, 100, 'rate'); assert.equal(r.src, 'measured'); assert.match(r.note, /measured/);
      assert.ok(r.hours < 0.2, 'hours ' + r.hours);
      assert.equal(r.capped, true, J(r)); assert.match(r.needs, /run out of ore/);
    });
    await test('without enough saves, the forge formula stands', async () => {
      const r = await run(`(() => { forgeHist.IronBar = [{ t: 1, n: 0 }]; const e = forgeEta('IronBar', 10, Date.now()); return { src: e.rateSource, rate: e.rate, formula: forgeInfo('IronBar').rate }; })()`);
      assert.equal(r.src, 'forge'); near(r.rate, r.formula, 'formula');
    });
    await test('the app loads the history for each bar by itself', async () => {
      await run(`forgeHistFor = null; forgeHist = {}; 1`); await sleep(1500);
      assert.ok(await run(`Array.isArray(forgeHist.IronBar)`));
    });
    await test('the Forge tab lists the segments', async () => {
      await h.bump(d => { d.ForgeItemQty = [4000, 0, 160, 0, 0, 0, 0, 0, 0, 0, 0, 0]; }); await sleep(1500);
      await run(`showTab('forge'); 1`); await sleep(900);
      await run(`(() => { const at = Date.now(); forgeHist.IronBar = [{ t: at - 30 * 36e5, n: 0 }, { t: at - 5 * 36e5, n: 500 }, { t: at, n: 900 }]; forgePaintCharts(); return 1; })()`);
      const text = await run(`$('viewForge').innerText`);
      assert.match(text, /Show the bars per hour the ETAs use/);
      assert.equal(await run(`document.querySelector('#viewForge .fg-recent details').open`), false, 'folded away');
      assert.ok(await run(`document.querySelectorAll('#viewForge .fg-recent tr').length`) >= 2);
      assert.ok(await run(`document.documentElement.scrollWidth <= innerWidth`), 'no sideways scroll');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
