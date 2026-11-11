// Experiment: cards that are their own progress bar, and a panel whose width can be dragged. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 600)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, width: 1400, height: 900 }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(800);
    const panelW = () => run(`Math.round($('activityBox').getBoundingClientRect().width)`);
    await test('the fill covers the whole card, behind its text, as wide as the progress', async () => {
      const r = await run(`(() => { const out = []; document.querySelectorAll('.pc').forEach(c => { const bar = c.querySelector('.pc-bar').getBoundingClientRect(), box = c.getBoundingClientRect(), over = c.querySelector('.pc-bar-over'); out.push({ cover: Math.abs(bar.width - (box.width - 2)) < 2 && Math.abs(bar.height - (box.height - 2)) < 2, clip: over.style.clipPath, under: getComputedStyle(c.querySelector('.pc-bar')).zIndex, text: c.querySelector('.pc-bar-text').textContent, eta: c.querySelector('.pc-eta').textContent }); }); return out; })()`);
      assert.ok(r.length > 3);
      assert.ok(r.every(x => x.cover), JSON.stringify(r.find(x => !x.cover)));
      assert.ok(r.every(x => /^inset\(0(px)? [\d.]+%/.test(x.clip)), JSON.stringify(r.map(x => x.clip)));
      assert.ok(r.every(x => x.text), 'every card says its wait');
    });
    await h.shot('cards-356.png', 1400);
    await test('dragging the edge widens the panel, and it is kept after a reload', async () => {
      const w0 = await panelW(), g = await run(`(() => { const b = $('panelGrip').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 300 }; })()`);
      await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x, y: g.y });
      await h.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: g.x, y: g.y, button: 'left', clickCount: 1 });
      for (let i = 1; i <= 5; i++) await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g.x + i * 60, y: g.y, button: 'left', buttons: 1 });
      await h.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: g.x + 300, y: g.y, button: 'left', clickCount: 1 });
      await sleep(200);
      const w1 = await panelW();
      assert.ok(Math.abs(w1 - (w0 + 300)) <= 2, w0 + ' → ' + w1);
      assert.equal(await run(`localStorage.getItem(LOCAL_KEY + '-panel-w')`), String(w1));
      await h.reload(); await sleep(400);
      assert.ok(Math.abs(await panelW() - w1) <= 1);
      assert.ok(await run(`(() => { const l = [...document.querySelectorAll('#activityPanel .pn-list')].find(x => x.children.length > 1); const a = l.children[0].getBoundingClientRect(), b = l.children[1].getBoundingClientRect(); return a.top < b.top && Math.abs(a.width - (l.getBoundingClientRect().width)) < 1; })()`), 'one card a row, as wide as the list');
      await h.shot('cards-656.png', 1400);
    });
    await test('arrow keys move it, it stops at its limits, and double-click resets it', async () => {
      await run(`$('panelGrip').focus(); 1`);
      const w = await panelW();
      await run(`$('panelGrip').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); 1`);
      assert.equal(await panelW(), w - 16);
      await run(`$('panelGrip').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })); 1`);
      assert.equal(await panelW(), 260);
      await run(`setPanelWidth(5000, false); 1`);
      assert.equal(await panelW(), 1400 - 480);
      await run(`$('panelGrip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); 1`);
      assert.equal(await panelW(), 356);
    });
    await test('at phone width there is no edge and nothing scrolls sideways; a wide window gets the chosen width back', async () => {
      await run(`setPanelWidth(500, true); 1`);
      await h.setSize(380); await sleep(200);
      assert.equal(await run(`getComputedStyle($('panelGrip')).display`), 'none');
      assert.ok(await run(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
      await h.shot('cards-phone.png', 380, 900);
      await h.setSize(979); await sleep(150);
      await h.setSize(1400); await sleep(200);
      assert.equal(await panelW(), 500);
      await h.setSize(900 + 0); await sleep(150); await h.setSize(1100); await sleep(200);
      assert.equal(await panelW(), 500, 'not shrunk by a narrow window');
      await h.setSize(1400);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
