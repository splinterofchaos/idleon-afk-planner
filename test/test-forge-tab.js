// The printer, unlimited ore, the recorder and the Forge tab's sums and graphs.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { start, BUILD } = require('./harness');
const J = JSON.stringify;
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 400)); } };
const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), why + ': ' + a + ' vs ' + b);
// 5 zeros, then 14 per character.
const print = (...chars) => [0, 0, 0, 0, 0, ...chars.flatMap(([a, ar, b, br]) => [...Array(10).fill('Blank').map((x, i) => i % 2 ? 0 : x), a, ar, b, br])];

(async () => {
  const save = JSON.parse(fs.readFileSync(path.join(BUILD, 'fixtures', 'full-save.json'), 'utf8')).data;
  save.ForgeItemOrder = ['Iron', 'Blank', 'IronBar', 'Iron', 'Blank', 'IronBar', 'Godshard', 'Blank', 'GodshardBar', 'Blank', 'Blank', 'Blank'];
  save.ForgeItemQty = [4000, 0, 100, 4000, 0, 50, 1e7, 0, 7, 0, 0, 0];
  save.ForgeIntProg = [0, 0, 0, 0];
  save.ForgeLV = [4, 50, 10, 0, 0, 0];
  save.Print = print(['Blank', 0, 'Iron', 1e9], ['Blank', 0, 'Blank', 0]);
  const order = typeof save.ChestOrder === 'string' ? JSON.parse(save.ChestOrder) : save.ChestOrder, qty = typeof save.ChestQuantity === 'string' ? JSON.parse(save.ChestQuantity) : save.ChestQuantity;
  ['IronBar', 'GodshardBar', 'Iron', 'Godshard'].forEach(raw => { const i = order.indexOf(raw); if (i >= 0) qty[i] = 0; });
  order.push('IronBar'); qty.push(1000);
  save.ChestOrder = order; save.ChestQuantity = qty;
  const h = await start({ sheet: true, saveData: save, noPoll: true, width: 1300, height: 1000 });
  const run = h.run;
  try {
    await h.bump(() => {});
    await h.poll();
    await new Promise(r => setTimeout(r, 500));

    await test('printing slots are read per character', async () => {
      assert.deepEqual(await run(`saveFacts().printer`), { Iron: [{ slot: 0, rate: 1e9 }] });
      assert.equal(await run(`printedRate('Copper')`), 0);
    });
    await test('printed ore never runs out, unprinted ore does', async () => {
      const iron = await run(`(() => { const i = forgeInfo('IronBar'); return { unlimited: i.unlimited, printed: i.printed }; })()`);
      assert.deepEqual(iron, { unlimited: true, printed: 1e9 });
      const eta = await run(`forgeEta('IronBar', 1e7, Date.now())`);
      assert.equal(eta.capped, false);
      assert.ok(eta.hours > 0);
      assert.equal(eta.runsOutMs, null);
      assert.equal(await run(`forgeInfo('GodshardBar').unlimited`), false);
      assert.equal((await run(`forgeEta('GodshardBar', 1e9, Date.now())`)).capped, true);
    });
    await test('too little printing is not unlimited', async () => {
      await h.bump({ Print: print(['Iron', 1, 'Blank', 0]) });
      assert.equal(await run(`forgeInfo('IronBar').unlimited`), false);
      assert.match(await run(`forgeOverview().bars.find(b => b.bar === 'IronBar').warn`), /printing slower/);
      await h.bump({ Print: print(['Blank', 0, 'Iron', 1e9]) });
    });
    await test('a save without the printer still works', async () => {
      await h.bump(d => { delete d.Print; });
      assert.equal(await run(`saveFacts().printer`), null);
      assert.equal(await run(`forgeInfo('IronBar').unlimited`), false);
      await h.bump({ Print: print(['Blank', 0, 'Iron', 1e9]) });
    });
    await test('warnings: soon-empty ore, stopped slots, empty slots', async () => {
      const few = 5 * await run(`FORGE_BARS.GodshardBar.orePerBar`);
      await h.bump(d => { d.ForgeItemQty = [4000, 0, 100, 4000, 0, 50, few, 0, 7, 0, 0, 0]; });
      const v = await run(`forgeOverview()`);
      assert.equal(v.empty, 1);
      assert.ok(v.warnings.some(x => /Godshard.*isn't being printed.*refilling by hand/.test(x)), J(v.warnings));
      assert.ok(v.warnings.some(x => /1 forge slot has no ore/.test(x)), J(v.warnings));
      assert.ok(!v.warnings.some(x => /Iron/.test(x)), 'printed ore has no warning: ' + J(v.warnings));
      await h.bump(d => { d.ForgeItemQty = [4000, 0, 100, 4000, 0, 50, 0, 0, 7, 0, 0, 0]; });
      const w = await run(`forgeOverview()`);
      assert.ok(w.warnings.some(x => /1 slot is out of .*Refill by hand/.test(x)), J(w.warnings));
      await h.bump(d => { d.ForgeItemQty = [4000, 0, 100, 4000, 0, 50, 1e7, 0, 7, 0, 0, 0]; });
    });
    await test('the tab is marked when something needs doing', async () => {
      await new Promise(r => setTimeout(r, 1200));
      assert.equal(await run(`$('tabForge').textContent`), 'Forge !');
    });
    await test('bucket sums share gains over the gap and skip falls', async () => {
      const b = await run(`forgeBuckets([{t:0,n:0},{t:72e5,n:20},{t:108e5,n:5},{t:144e5,n:15}], 0, 144e5, 4)`);
      near(b[0].rate, 10, 'first hour pair'); near(b[1].rate, 10, 'second');
      assert.equal(b[2].rate, null, 'the fall is left out');
      near(b[3].rate, 10, 'after the fall');
      near(await run(`forgeMeasured(forgeBuckets([{t:0,n:0},{t:36e5,n:30}], 0, 36e5, 3))`), 30, 'measured');
    });
    await test('series counts forge and storage, bags on request', async () => {
      assert.deepEqual(await run(`forgeSeries([[2,1,2,4],[1,1,1,1]], false)`), [{ t: 1, n: 2 }, { t: 2, n: 3 }]);
      assert.equal((await run(`forgeSeries([[2,1,2,4]], true)`))[0].n, 7);
    });
    await test('the server records one row per save', async () => {
      const r = await run(`api('/api/forge-history?item=IronBar')`);
      assert.ok(r.saves >= 5, 'saves ' + r.saves);
      const lastRow = r.rows[r.rows.length - 1];
      assert.deepEqual(lastRow.slice(1, 3), [150, 1000], 'forge bars, then storage');
      assert.ok(r.items.includes('Iron') && r.items.includes('GodshardBar'), J(r.items));
      await run(`api('/api/sync', 'POST')`);
      assert.equal((await run(`api('/api/forge-history?item=IronBar')`)).saves, r.saves, 'the same save again adds nothing');
    });
    await test('tab shows the table and both graphs', async () => {
      await h.bump(d => { d.ForgeItemQty = [4000, 0, 160, 4000, 0, 60, 1e7, 0, 7, 0, 0, 0]; });
      await run(`showTab('forge'); 1`);
      await new Promise(r => setTimeout(r, 900));
      const t = await run(`$('viewForge').innerText`);
      assert.match(t, /Printing 1B \/ hour/);
      assert.match(t, /While printing/);
      assert.match(t, /Not printing/);
      assert.equal(await run(`document.querySelectorAll('#viewForge .fg-chart svg').length`), 2);
      assert.equal(await run(`document.querySelectorAll('#viewForge .fg-line').length`), 1);
      assert.ok(await run(`document.querySelectorAll('#viewForge .fg-col').length`) > 0);
      assert.match(await run(`document.querySelector('#viewForge .fg-ref-text').textContent`), /Forge formula/);
    });
    await test('bags box and ranges redraw without errors', async () => {
      await run(`$('fgBags').click(); document.querySelector('.fg-range[data-range="All"]').click(); 1`);
      assert.match(await run(`document.querySelector('#viewForge .fg-title').textContent`), /bags/);
      assert.equal(await run(`document.querySelector('.fg-range[data-range="All"]').getAttribute('aria-pressed')`), 'true');
      await run(`$('fgBags').click(); 1`);
    });
    await test('a project treats printed ore as supplied', async () => {
      const r = await run(`(() => {
        const p = projectCreate('Print trial');
        projectAddItem(p, 'IronBar', 1e7);
        const c = projectCalc(p), raw = Object.values(c.nodes).reduce((a, n) => { a[n.raw] = n; return a; }, {});
        return { ore: raw.Iron && { done: raw.Iron.done, own: raw.Iron.ownHours, note: raw.Iron.note, src: raw.Iron.rateSource }, bar: { capped: raw.IronBar.capped, own: raw.IronBar.ownHours > 0 } };
      })()`);
      assert.equal(r.bar.capped, false);
      assert.ok(r.bar.own);
      if (r.ore) { assert.equal(r.ore.done, true); assert.equal(r.ore.src, 'printer'); assert.match(r.ore.note, /counted as unlimited/); }
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }

  await test('old rows are thinned to one an hour when the app starts', async () => {
    const os = require('os'), { spawn } = require('child_process');
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-hist-')), file = path.join(data, 'forge-history.jsonl'), old = Date.now() - 60 * 24 * 36e5;
    const rows = [0, 10, 20, 70, 80].map(m => ({ t: Math.floor(old / 36e5) * 36e5 + m * 6e4, u: 'x', c: {} })).concat([0, 1].map(m => ({ t: Date.now() - m * 6e4, u: 'x', c: {} })));
    fs.writeFileSync(file, rows.map(r => J(r)).join('\n') + '\n');
    const p = spawn(process.execPath, [require('path').join(__dirname, '..', 'server.js')], { env: { ...process.env, PLANNER_PORT: '47977', PLANNER_DATA: data, PLANNER_NO_WINDOW: '1' }, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    p.kill();
    const kept = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    assert.equal(kept.length, 4, 'two old hours plus two new rows, got ' + kept.length);
    fs.rmSync(data, { recursive: true, force: true });
  });
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
