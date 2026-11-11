// Names on their equipped nametag, under the unit icon. Fake backend only.
const assert = require('assert'), { start, sleep } = require('./harness');
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').slice(0, 6).join('\n      ')); } };
const J = JSON.stringify;
(async () => {
  const h = await start({ noPoll: true, width: 1400, height: 1000 }), run = h.run;
  const parse = v => typeof v === 'string' ? JSON.parse(v) : v;
  const wearTag = (slot, raw) => d => { const e = parse(d['EquipOrder_' + slot]); e[0]['14'] = raw; d['EquipOrder_' + slot] = J(e); };
  try {
    const slot = await run(`rows.find(x => x.slot != null).slot`);
    await h.bump(wearTag(slot, 'EquipmentNametagReplica18')); await sleep(1200);
    const card = `[...document.querySelectorAll('#activityPanel .pc')].find(c => { const t = tasks.find(x => x.id === c.dataset.id); return t && t.slot === ${slot} && !(t.type === 'portal') && c.querySelector('.pc-port.named:not(.pair)'); })`;
    await test('the nametag is read from its gear slot', async () => {
      assert.equal(await run(`rows.find(x => x.slot === ${slot}).tag`), 'EquipmentNametagReplica18');
    });
    await test('a one-player card: the name is on the tag under the face, in the tag’s colour, and not beside the title', async () => {
      const r = await run(`(() => { const c = ${card}; if (!c) return null; const p = c.querySelector('.nametag'), port = c.querySelector('.pc-port').getBoundingClientRect(), face = c.querySelector('.portrait').getBoundingClientRect(), tag = p.getBoundingClientRect();
        return { name: p.textContent, emblem: !!p.querySelector('img'), bg: getComputedStyle(p).backgroundColor, under: tag.top >= face.bottom - 1, who: c.querySelector('.pc-who').textContent, max: parseFloat(getComputedStyle(p).maxWidth), rowName: rows.find(x => x.slot === ${slot}).name }; })()`);
      assert.ok(r, 'a card for that player');
      assert.equal(r.name, r.rowName); assert.ok(r.emblem); assert.ok(r.under, J(r));
      assert.notEqual(r.bg, 'rgb(74, 82, 78)', 'coloured from the tag');
      assert.ok(r.who === '' || r.who === 'playing', r.who);
      assert.equal(r.max, 70);
    });
    await test('white text on the plate is readable', async () => {
      const bg = await run(`getComputedStyle((${card}).querySelector('.nametag')).backgroundColor`);
      const [r, g, b] = bg.match(/\d+/g).map(Number), lin = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
      assert.ok(1.05 / (.2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b) + .05) >= 4.5, bg);
    });
    await test('a long name is cut, with the whole name in the tooltip', async () => {
      const r = await run(`(() => { const p = nameplate({ name: 'AnExtremelyLongPlayerName', tag: null }); document.body.append(p); const n = p.querySelector('.nametag-name'), out = { cut: n.scrollWidth > n.clientWidth, w: p.getBoundingClientRect().width, title: p.title, plain: p.classList.contains('plain') }; p.remove(); return out; })()`);
      assert.ok(r.cut && r.w <= 70.5 && r.title === 'AnExtremelyLongPlayerName' && r.plain, J(r));
    });
    await test('taking the nametag off leaves a plain name', async () => {
      await h.bump(wearTag(slot, 'Blank')); await sleep(1200);
      assert.equal(await run(`rows.find(x => x.slot === ${slot}).tag`), null);
      assert.equal(await run(`(${card}).querySelector('.nametag').classList.contains('plain')`), true);
    });
    await test('Projects player lists show the face with its nametag', async () => {
      await run(`projects.splice(0); pjPick(null); showTab('projects'); render(); 1`);
      await h.type('#pjNameBox', 'Tags'); await h.key('Enter'); await sleep(30);
      await run(`pjAddOpen = true; pjAddTab = 'food'; paintProjects(); 1`);
      const r = await run(`[...document.querySelectorAll('#pjFoodWho .pj-who-item')].map(n => ({ tag: n.querySelector('.pj-who-port .nametag-name')?.textContent, slot: +n.querySelector('input').dataset.slot }))`);
      const names = await run(`Object.fromEntries(rows.filter(x => x.slot != null).map(x => [x.slot, x.name || 'Unnamed']))`);
      assert.ok(r.length > 1 && r.every(x => x.tag === names[x.slot]), J(r));
      assert.ok(await run(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`));
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
    await test('the player menu shows faces and nametags, and picking one selects that player', async () => {
      await h.bump(wearTag(slot, 'EquipmentNametagReplica18')); await sleep(1200);
      await run("showTab('planner'); render(); 1"); await sleep(300);
      const r = await run("(() => { const name = rows.find(x => x.slot === " + slot + ").name, b = document.querySelector('#plannerHead .ms-btn'), list = document.querySelector('#plannerHead .ms-list'); b.click(); const open = !list.hidden, opts = [...list.children], one = opts.find(o => o.querySelector('.nametag').textContent === name), faces = opts.filter(o => o.querySelector('.portrait')).length, emblem = !!one.querySelector('.nametag img'); one.click(); return { open, extra: opts.length - rows.length, noFace: opts.length - faces, emblem, closed: list.hidden, picked: selectedSlot(), onButton: b.querySelector('.nametag').textContent === name }; })()");
      assert.deepEqual(r, { open: true, extra: 0, noFace: 0, emblem: true, closed: true, picked: slot, onButton: true });
    });
    await test('Escape closes the menu without changing the player', async () => {
      const r = await run("(() => { const was = selectedSlot(), b = document.querySelector('#plannerHead .ms-btn'), list = document.querySelector('#plannerHead .ms-list'); b.click(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return { closed: list.hidden, same: selectedSlot() === was }; })()");
      assert.deepEqual(r, { closed: true, same: true });
    });
    await test('a card shows a live rate in place of a prompt, marked live, and -- with none', async () => {
      const r = await run("(() => { const real = taskCalc, c = document.querySelector('.pc'), id = c.dataset.id, read = () => ({ who: c.querySelector('.pc-who').textContent, live: c.querySelector('.pc-live').textContent, under: c.querySelector('.pc-bar-text').textContent }); const as = extra => { taskCalc = (t, ...a) => { const k = real(t, ...a); return t.id === id ? { ...k, done: false, wait: '', hours: null, etaMs: null, team: null, ...extra } : k; }; paintPanel(); return read(); }; const out = [as({ playing: true, rate: 907500, rateSource: 'loot rate', needs: 'Waiting' }), as({ playing: true, rate: 0, rateSource: null, needs: 'Enter kills / hour' }), as({ playing: false, rate: 0, rateSource: null, needs: 'Ready to claim: 42' })]; taskCalc = real; paintPanel(); return out; })()");
      assert.deepEqual(r[0], { who: '907K / hr', live: 'live', under: 'Waiting' });
      assert.equal(r[1].live, ''); assert.equal(r[1].under, '--');
      assert.equal(r[2].live, ''); assert.equal(r[2].under, 'Ready to claim: 42');
    });
    await test('a bar shows its icon', async () => {
      assert.match(await run("forgeBarLabel('IronBar').querySelector('img').src"), /icons\/IronBar[.]png$/);
    });
  } finally { await h.close(); }
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
