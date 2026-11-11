// Panel agent's tests. PowerShell: $env:BUILD_DIST='dist-panel'; node test-panel.js. Real mouse via CDP, fake backend, private temp data.
const assert = require('assert'), { start, sleep } = require('./harness');
let passed = 0, failed = 0;
const test = async (name, fn) => { try { if (globalThis.__panelStub) await globalThis.__panelStub(); await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message).split('\n').slice(0, 6).join('\n      ')); }
};
const main = id => `.pc[data-id="${id}"] .pc-main`, star = id => `.pc[data-id="${id}"] .pc-star`, ex = id => `.pc[data-id="${id}"] .pc-x`;
const scheme = (h, value) => h.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });

(async () => {
  const h = await start({ noPoll: true, oldFields: true }), run = h.run;
  const lists = () => run(`Object.fromEntries(['active','more','goal','archive'].map(k => [k, [...panelParts[k].children].map(c => c.dataset.id)]))`);
  const open = async key => { if (!await run(`panelOpen.${key}`)) await h.click(key === 'more' ? '.pn-toggle:not(.pn-archive)' : '.pn-archive'); };
  const close = async key => { if (await run(`panelOpen.${key}`)) await h.click(key === 'more' ? '.pn-toggle:not(.pn-archive)' : '.pn-archive'); };
  const idOf = key => run(`tasks.find(t => t.key === ${JSON.stringify(key)})?.id`);
  const spies = () => run(`window.calls = []; flashTask = id => calls.push('flash:' + id); simulateTask = id => calls.push('sim:' + id); 1`);
  globalThis.__panelStub = () => run(`window.__panelPlayedReal = panelPlayed; panelPlayed = group => !(group.every(x => x.auto && !x.starred) && (k => !k.done && !(k.hours != null && !Number.isNaN(k.hours)))(taskCalc(group[0]))); if (!window.__panelStubbed) { window.__panelStubbed = true; paintPanel(); } 1`);
const noPortals = () => run(`(() => { if (typeof MAP_CREW === 'undefined') return 0; Object.keys(MAP_CREW).forEach(k => delete MAP_CREW[k]); const had = tasks.some(t => t.type === 'portal'); if (had) { tasks = tasks.filter(t => t.type !== 'portal'); queueSave(); render(); } return 1; })()`); // portals have their own suite
  { const stub = globalThis.__panelStub; globalThis.__panelStub = async () => { await noPortals(); await stub(); }; }
  await globalThis.__panelStub(); // older tests keep the earlier folding, including after a reload
  try {
    await spies();
    await test('sections match taskSection; empty Goals heading hidden; archive behind its toggle', async () => {
      const l = await lists(), want = await run(`tasks.reduce((a, t) => { (a[taskSection(t)] = a[taskSection(t)] || []).push(t.id); return a; }, {})`);
      assert.ok(want.active.length && want.archive.length && !want.goal);
      assert.equal(l.goal.length, 0);
      assert.equal(await run(`panelParts.goalHead.hidden`), true);
      assert.equal(await run(`panelParts.activeHead.hidden`), false);
      assert.equal(l.archive.length, 0, 'archive shut at first');
      assert.equal(await run(`document.querySelector('.pn-archive').textContent`), `Show archive (${want.archive.length})`);
      await open('archive');
      const after = await lists();
      assert.deepEqual([...after.archive].sort(), [...want.archive].sort());
      assert.equal(await run(`document.querySelector('.pn-archive').textContent`), `Hide archive (${want.archive.length})`);
      await close('archive');
      assert.equal((await lists()).archive.length, 0);
      l.active.forEach(id => assert.ok(want.active.includes(id)));
    });
    await test('Active: done first, then soonest ETA, no ETA last', async () => {
      const seq = await run(`[...panelParts.active.children].map(c => { const k = taskCalc(tasks.find(t => t.id === c.dataset.id)); return { done: k.done, eta: k.etaMs }; })`);
      const rank = x => x.done ? -1 : x.eta == null ? 1e20 : x.eta;
      seq.forEach((x, i) => { if (i) assert.ok(rank(seq[i - 1]) <= rank(x) + 1000, 'out of order at ' + i + ': ' + JSON.stringify(seq.slice(i - 1, i + 1))); });
      assert.ok(seq.some(x => x.done) && seq.some(x => !x.done && x.eta));
    });
    await test('auto tasks with no ETA fold; hand-made and starred ones never do; open state is remembered', async () => {
      // One entry per card: shared tasks aiming at the same thing are one, drawn as its lowest slot's.
      const facts = await run(`(() => { const cards = new Map(), merged = []; tasks.filter(t => taskSection(t) === 'active').sort((a, b) => a.slot - b.slot).forEach(t => {
        const key = panelTeamKey(t) || t.id, k = taskCalc(t), had = cards.get(key);
        if (had) { had.auto = had.auto && t.auto; had.starred = had.starred || t.starred; merged.push(t.id); }
        else cards.set(key, { id: t.id, auto: t.auto, starred: t.starred, noEta: !k.done && k.hours == null });
      }); window.mergedIds = merged; return [...cards.values()]; })()`);
      const folded = facts.filter(f => f.auto && !f.starred && f.noEta), l = await lists(), merged = await run('mergedIds');
      // cards and items are one task each now, so the test data may merge nothing; what does merge is on another card
      merged.forEach(id => assert.ok(!l.active.includes(id) && !l.more.includes(id), id + ' is on another card'));
      assert.ok(folded.length > 1, 'test data should fold some');
      assert.equal(l.more.length, 0);
      assert.equal(await run(`document.querySelector('.pn-toggle').textContent`), folded.length + ' more without an ETA');
      facts.filter(f => !folded.includes(f)).forEach(f => assert.ok(l.active.includes(f.id), f.id + ' should be showing'));
      assert.ok(facts.some(f => !f.auto && f.noEta), 'a hand-made one with no ETA stays out');
      await open('more');
      assert.deepEqual((await lists()).more.sort(), folded.map(f => f.id).sort());
      assert.equal(await run(`document.querySelector('.pn-toggle').getAttribute('aria-expanded')`), 'true');
      await sleep(1200);
      assert.equal((await lists()).more.length, folded.length, 'stays open across ticks');
      const first = folded[0].id;
      await h.click(star(first));
      assert.ok((await lists()).active.includes(first), 'starred: leaves the fold');
      assert.ok(!(await lists()).more.includes(first));
      await h.click(star(first));
      assert.ok((await lists()).more.includes(first), 'unstarred: back in the fold');
      await close('more');
    });
    await test('ETA and wait text match taskCalc', async () => {
      const bad = await run(`(() => { const now = Date.now(); paintPanel(now); const out = []; let etas = 0;
        document.querySelectorAll('.pn-list .pc').forEach(c => {
          const t = tasks.find(x => x.id === c.dataset.id), k = taskCalc(t, now), eta = c.querySelector('.pc-eta').textContent, wait = c.querySelector('.pc-bar-text').textContent;
          const w = k.done ? 'Ready!' : k.hours != null ? fmtWait(k.hours, true) : panelNeeds(k.needs) || k.line, e = !k.done && k.hours != null ? fmtClock(k.etaMs, now) : '';
          if (e) etas++;
          if (eta !== e || wait !== w || c.querySelector('.pc-bar-over').textContent !== w) out.push([taskTitle(t), eta, e, wait, w]);
        });
        return { out, etas }; })()`);
      assert.deepEqual(bad.out, []);
      assert.ok(bad.etas >= 3);
    });
    await test('next to finish is the soonest running ETA; a click selects the player on the planner tab', async () => {
      const want = await run(`(() => { const now = Date.now(); const list = tasks.filter(t => taskSection(t) === 'active').map(t => ({ t, k: taskCalc(t, now) })).filter(x => !x.k.done && x.k.hours != null).sort((a, b) => a.k.etaMs - b.k.etaMs); const x = list[0]; return { id: x.t.id, slot: x.t.slot, title: taskTitle(x.t), clock: fmtClock(x.k.etaMs, now) }; })()`);
      const text = await run(`document.querySelector('.pn-next').textContent`);
      assert.ok(text.includes(want.title) && text.includes(want.clock), text);
      await run(`showTab('finder'); selectPlayer(${want.slot === 0 ? 1 : 0}); calls.length = 0; 1`);
      await h.click('.pn-next');
      assert.equal(await run('selectedSlot()'), want.slot);
      assert.equal(await run(`$('viewPlanner').hidden`), false);
      assert.deepEqual(await run('calls'), ['flash:' + want.id]);
    });
    await test('card click, held across a 1 s tick, selects the player and flashes the task', async () => {
      const t = await run(`(() => { const t = [...tasks].reverse().find(t => t.slot != null && taskSection(t) === 'active' && document.querySelector('.pc[data-id="' + t.id + '"]')); /* a player's own task */ return { id: t.id, slot: t.slot }; })()`);
      await run(`showTab('loot'); selectPlayer(${t.slot === 0 ? 1 : 0}); calls.length = 0; 1`);
      await h.click(main(t.id), { hold: 1300 });
      assert.equal(await run('selectedSlot()'), t.slot);
      assert.equal(await run(`$('viewPlanner').hidden`), false);
      assert.deepEqual(await run('calls'), ['flash:' + t.id]);
    });
    await test('star: real click held across a tick toggles only; moves an inactive task between Archive and Goals; persists', async () => {
      await open('archive');
      const id = (await lists()).archive[0], key = await run(`tasks.find(t => t.id === ${JSON.stringify(id)}).key`);
      await run(`calls.length = 0; showTab('planner'); window.pickBefore = selectedSlot(); 1`);
      assert.equal(await run(`document.querySelector(${JSON.stringify(star(id))}).getAttribute('aria-pressed')`), 'false');
      await h.click(star(id), { hold: 1300 });
      let l = await lists();
      assert.ok(l.goal.includes(id) && !l.archive.includes(id), 'in Goals now');
      assert.equal(await run(`panelParts.goalHead.hidden`), false);
      assert.equal(await run(`document.querySelector(${JSON.stringify(star(id))}).getAttribute('aria-pressed')`), 'true');
      assert.deepEqual(await run('calls'), [], 'no card click');
      assert.equal(await run('selectedSlot() === pickBefore'), true);
      assert.match(await run(`document.querySelector(${JSON.stringify(star(id))}).getAttribute('aria-label')`), new RegExp(await run(`taskTitle(tasks.find(t => t.id === ${JSON.stringify(id)}))`)));
      assert.equal((await h.savedSheet()).tasks.find(t => t.key === key).starred, true, 'saved starred');
      await h.reload();
      await spies(); await noPortals();
      assert.ok((await lists()).goal.includes(id), 'Goals after a reload');
      await open('archive');
      await h.click(star(id));
      l = await lists();
      assert.ok(l.archive.includes(id) && !l.goal.includes(id), 'back in Archive');
      assert.equal(await run(`panelParts.goalHead.hidden`), true);
      assert.equal((await h.savedSheet()).tasks.find(t => t.key === key).starred, false, 'saved unstarred');
    });
    await test('star keeps an active task in Active', async () => {
      const id = (await lists()).active[0];
      await h.click(star(id));
      assert.ok((await lists()).active.includes(id));
      await h.click(star(id));
    });
    await test('archived card click opens Simulate with that task, held across a tick', async () => {
      await open('archive');
      const id = (await lists()).archive[0];
      await run(`calls.length = 0; 1`);
      await h.click(main(id), { hold: 1300 });
      assert.equal(await run(`$('viewSimulate').hidden`), false);
      assert.deepEqual(await run('calls'), ['sim:' + id]);
      await run(`showTab('planner'); 1`);
    });
    await test('hover and focus on a card survive ticks, and no card moves', async () => {
      const id = (await lists()).active[2];
      await run(`window.seen = document.querySelector(${JSON.stringify(main(id))}); window.moved = 0; window.mo = new MutationObserver(m => { moved += m.length; }); ['active','more','goal','archive'].forEach(k => mo.observe(panelParts[k], { childList: true })); 1`);
      const box = await run(`(() => { seen.scrollIntoView({ block: 'center' }); seen.focus(); const b = seen.getBoundingClientRect(); return { x: b.left + 80, y: b.top + b.height - 12 }; })()`);
      await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await sleep(2600);
      assert.equal(await run(`seen.isConnected && seen === document.querySelector(${JSON.stringify(main(id))})`), true, 'same node');
      assert.equal(await run(`seen.matches(':hover')`), true, 'hover');
      assert.equal(await run(`seen.closest('.pc').matches(':hover')`), true, 'card hover');
      assert.equal(await run(`document.activeElement === seen`), true, 'focus');
      await run(`render(); paintAll(); 1`);
      await sleep(100);
      assert.equal(await run(`seen.isConnected && document.activeElement === seen && seen.matches(':hover')`), true, 'through render()');
      assert.equal(await run(`moved`), 0, 'lists unchanged');
      await run(`mo.disconnect(); 1`);
    });
    await test('when the order really changes, cards move, keeping node and focus', async () => {
      // the fake save is days old, so its clears have long since finished at their rates: give two of them far more to go
      await run(`(() => { tasks.filter(t => t.type === 'clear' && taskSection(t) === 'active' && !t.cleared).slice(0, 2).forEach((t, i) => taskEdit(t, 'left', String((i + 2) * 1e15))); render(); paintAll(); return 1; })()`);
      await sleep(100);
      const running =await run(`[...panelParts.active.children].map(c => c.dataset.id).filter(id => { const k = taskCalc(tasks.find(t => t.id === id)); return !k.done && k.hours != null && tasks.find(t => t.id === id).type === 'clear'; })`);
      assert.ok(running.length >= 2, 'needs two running clears');
      const id = running[0];
      await run(`window.seen = document.querySelector(${JSON.stringify(main(id))}); seen.focus(); window.oldKph = tasks.find(t => t.id === ${JSON.stringify(id)}).kph; taskEdit(tasks.find(t => t.id === ${JSON.stringify(id)}), 'kph', '1'); paintPanel(); 1`);
      const after = (await lists()).active;
      assert.ok(after.indexOf(id) > after.indexOf(running[1]), 'now later');
      assert.equal(await run(`document.activeElement === seen`), true);
      await run(`taskEdit(tasks.find(t => t.id === ${JSON.stringify(id)}), 'kph', oldKph); paintPanel(); seen.blur(); 1`);
      assert.equal((await lists()).active.indexOf(id) < (await lists()).active.indexOf(running[1]), true);
    });
    await test('keyboard: Tab goes card to star; Enter opens the card and toggles the star', async () => {
      const id = (await lists()).active[0], slot = await run(`tasks.find(t => t.id === ${JSON.stringify(id)}).slot`);
      await run(`selectPlayer(${slot === 0 ? 1 : 0}); document.querySelector(${JSON.stringify(main(id))}).focus(); calls.length = 0; 1`);
      await h.key('Enter');
      await sleep(50);
      assert.equal(await run('selectedSlot()'), slot);
      await h.key('Tab');
      assert.equal(await run(`document.activeElement.className`), 'pc-star');
      await h.key('Enter');
      await sleep(50);
      assert.equal(await run(`tasks.find(t => t.id === ${JSON.stringify(id)}).starred`), true);
      assert.equal(await run(`document.activeElement.className`), 'pc-star', 'focus stays on the star');
      await h.key('Enter');
      await sleep(50);
      assert.equal(await run(`tasks.find(t => t.id === ${JSON.stringify(id)}).starred`), false);
      assert.equal(await run(`document.querySelector('.pc-main button, .pc-main a') === null`), true, 'no nested buttons');
    });
    await test('delete shows on archived and non-auto starred cards only; Undo brings it back; both saved', async () => {
      await open('archive');
      const l = await lists(), id = l.archive[l.archive.length - 1], key = await run(`tasks.find(t => t.id === ${JSON.stringify(id)}).key`);
      const shows = sel => run(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); return !!n && !n.hidden && n.getBoundingClientRect().width > 0; })()`);
      assert.equal(await shows(ex(id)), true, 'archived');
      const auto = await run(`[...panelParts.active.children].map(c => tasks.find(t => t.id === c.dataset.id)).find(t => t.auto && !taskCalc(t).done).id`);
      assert.equal(await shows(ex(auto)), false, 'plain active');
      await run(`toggleStar(tasks.find(t => t.id === ${JSON.stringify(auto)})); paintPanel(); 1`);
      assert.equal(await shows(ex(auto)), false, 'auto starred');
      await run(`toggleStar(tasks.find(t => t.id === ${JSON.stringify(auto)})); paintPanel(); 1`);
      const hand = await run(`tasks.find(t => !t.auto && taskSection(t) === 'active').id`);
      await run(`toggleStar(tasks.find(t => t.id === ${JSON.stringify(hand)})); paintPanel(); 1`);
      assert.equal(await shows(ex(hand)), true, 'hand-made starred');
      await run(`toggleStar(tasks.find(t => t.id === ${JSON.stringify(hand)})); paintPanel(); 1`);
      assert.equal(await shows(ex(hand)), false, 'hand-made not starred');
      const n = await run('tasks.length');
      await h.click(ex(id));
      assert.equal(await run('tasks.length'), n - 1);
      assert.ok(!(await lists()).archive.includes(id));
      assert.equal(await run(`$('toast').hidden`), false);
      assert.match(await run(`$('toastText').textContent`), /Deleted/);
      assert.ok(!(await h.savedSheet()).tasks.some(t => t.key === key), 'gone from the file');
      await h.click('#undo');
      assert.equal(await run('tasks.length'), n);
      assert.ok((await lists()).archive.includes(id));
      assert.ok((await h.savedSheet()).tasks.some(t => t.key === key), 'back in the file');
    });
    await test('a character changing activity moves cards', async () => {
      await close('archive');
      await open('archive');
      const old = await idOf('3|exp|DIVINITY|Divinity');
      assert.ok(old && (await lists()).active.concat((await lists()).more).length);
      await open('more');
      assert.ok((await lists()).active.concat((await lists()).more).includes(old), 'starts Active');
      await h.setActivity(3, 'w7b3', { mapIdx: 317, portalLeft: 5e6 });
      const l = await lists(), now = await idOf('3|clear|FIGHTING|Pirate Underling');
      assert.ok(l.archive.includes(old), 'Divinity is archived');
      assert.ok(now && l.active.concat(l.more).includes(now), 'the new clear is Active');
      await h.setActivity(3, 'Divinity', { mapIdx: 200 });
      const back = await lists();
      assert.ok(back.active.concat(back.more).includes(old), 'Divinity is back');
      assert.ok(back.archive.includes(now), 'the clear is archived');
      await close('more');
    });
    await test('no sideways overflow, card size, ETA and text not cut at 400, 979, 1500', async () => {
      await open('more');
      await open('archive');
      for (const w of [400, 979, 1500]) {
        await h.setSize(w);
        await sleep(100);
        const m = await run(`(() => { const box = $('activityPanel'), cards = [...document.querySelectorAll('.pc')]; return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: box.scrollWidth - box.clientWidth,
          cards: cards.length, heights: [...new Set(cards.map(c => c.offsetHeight))], widths: [...new Set(cards.map(c => c.offsetWidth))],
          etaCut: cards.filter(c => { const e = c.querySelector('.pc-eta'); return e.scrollWidth > e.clientWidth; }).length,
          starInside: cards.every(c => { const a = c.getBoundingClientRect(), b = c.querySelector('.pc-star').getBoundingClientRect(); return b.right <= a.right && b.top >= a.top; }),
          starClear: cards.every(c => { const s = c.querySelector('.pc-star').getBoundingClientRect(), last = c.querySelector('.pc-who').getBoundingClientRect(); return last.right <= s.left + 1; }),
          out: cards.filter(c => c.getBoundingClientRect().right > innerWidth).length,
          ellipsis: cards.every(c => getComputedStyle(c.querySelector('.pc-title')).textOverflow === 'ellipsis'),
          titled: cards.every(c => c.querySelector('.pc-main').title.startsWith(c.querySelector('.pc-title').textContent)),
          left: Math.min(...cards.map(c => c.getBoundingClientRect().left)) }; })()`);
        assert.equal(m.page, 0, w + ' page overflow');
        assert.equal(m.panel, 0, w + ' panel overflow');
        assert.equal(m.out, 0, w + ' card past the edge');
        assert.ok(m.cards > 20, 'cards ' + m.cards);
        m.heights.forEach(x => assert.ok(x >= 60 && x <= 70, w + ' card height ' + x));
        assert.equal(m.etaCut, 0, w + ' ETA cut');
        assert.ok(m.starInside && m.starClear && m.ellipsis && m.titled, w + ' ' + JSON.stringify(m));
        if (w === 400) assert.equal(m.left, 16, 'gutter');
        if (w === 1500) m.widths.forEach(x => assert.ok(x >= 300 && x <= 345, 'width ' + x));
      }
      await h.setSize(1500);
    });
    await test('long ETA formats fit the column; long names ellipsize, keeping the star clear', async () => {
      const m = await run(`(() => { const c = document.querySelector('.pc'), e = c.querySelector('.pc-eta'), t = c.querySelector('.pc-title'), was = [e.textContent, t.textContent, c.querySelector('.pc-who').textContent]; const out = [];
        for (const s of ['Tomorrow 12:59 PM', 'Wed 12:59 PM', 'Dec 18, 2195', 'Far future']) { e.textContent = s; out.push([s, e.getBoundingClientRect().width, e.scrollWidth <= e.clientWidth, c.querySelector('.pc-bar').getBoundingClientRect().width]); }
        t.textContent = 'A very long task title that really cannot fit on one line at all'; c.querySelector('.pc-who').textContent = 'AnEquallyLongPlayerName';
        const cut = t.scrollWidth > t.clientWidth, right = c.querySelector('.pc-who').getBoundingClientRect().right, starLeft = c.querySelector('.pc-star').getBoundingClientRect().left, h = c.offsetHeight;
        e.textContent = was[0]; t.textContent = was[1]; c.querySelector('.pc-who').textContent = was[2]; return { out, cut, right, starLeft, h }; })()`);
      m.out.forEach(([s, , fit, bar]) => { assert.ok(fit, s); assert.ok(bar >= 105, s + ' leaves a bar of ' + bar); });
      assert.ok(m.cut && m.right <= m.starLeft + 1, JSON.stringify(m));
      assert.ok(m.h <= 70);
    });
    await test('the wait is readable on the card and on its fill, light and dark', async () => {
      const contrast = `(() => { const rgba = s => { const n = s.match(/[\\d.]+/g).map(Number); return s.startsWith('color(') ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1]; };
        const lum = c => { const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * r + .7152 * g + .0722 * b; }, ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
        const over = (top, under) => top.slice(0, 3).map((v, i) => v * top[3] + under[i] * (1 - top[3]));
        const css = (n, p) => getComputedStyle(n)[p], out = {}; document.querySelectorAll('.pc').forEach(c => { const text = rgba(css(c.querySelector('.pc-bar-text'), 'color')), card = rgba(css(c, 'backgroundColor')), fill = over(rgba(css(c.querySelector('.pc-bar-over'), 'backgroundColor')), card);
          out[c.className] = { card: ratio(text, card), fill: ratio(text, fill) }; });
        return { out, bg: css(document.body, 'backgroundColor') }; })()`;
      const seen = [];
      for (const mode of ['light', 'dark']) {
        await scheme(h, mode);
        await sleep(100);
        const m = await run(contrast);
        seen.push(m.bg);
        assert.ok(Object.keys(m.out).length > 2);
        Object.entries(m.out).forEach(([k, v]) => assert.ok(v.card >= 4.5 && v.fill >= 4.5, mode + ' ' + k + ' ' + JSON.stringify(v)));
      }
      assert.notEqual(seen[0], seen[1]);
    });
    await test('children of clickable things ignore the pointer', async () => {
      const bad = await run(`[...document.querySelectorAll('.pn-next *, .pc-main *, .pc-star *')].filter(n => getComputedStyle(n).pointerEvents !== 'none').length`);
      assert.equal(bad, 0);
    });
    await test('empty state says so; nothing else shows', async () => {
      const m = await run(`(() => { const keep = tasks; tasks = []; paintPanel(); const box = $('activityPanel'), out = { text: box.innerText.trim(), cards: box.querySelectorAll('.pc').length, nextHidden: panelParts.next.hidden, heads: [panelParts.activeHead.hidden, panelParts.goalHead.hidden, panelParts.archiveBtn.hidden, panelParts.moreBtn.hidden] }; tasks = keep; paintPanel(); return out; })()`);
      assert.match(m.text, /^No tasks yet/);
      assert.equal(m.cards, 0);
      assert.equal(m.nextHidden, true);
      assert.deepEqual(m.heads, [true, true, true, true]);
      assert.ok((await lists()).active.length > 0, 'cards come back');
    });
    /* ----- shared cards and items merge into one card ----- */
    await run(`teamPending = () => 0; 1`); // these characters went AFK long before the save, so all of it would be waiting: what is waiting counting towards a task is tested in test-task-shares
    const R = s => `rows.find(r => r.slot === ${s})`, TK = id => `tasks.find(t => t.id === ${JSON.stringify(id)})`;
    const card = (id, sel) => run(`(n => n ? n.textContent : null)(document.querySelector(${JSON.stringify(`.pc[data-id="${id}"] ${sel}`)}))`);
    const shows = sel => run(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); return !!n && !n.hidden && n.getBoundingClientRect().width > 0; })()`);
    const stats = (s, kph, dr, mk) => run(`setRowStat(${R(s)}, 'kph', '${kph}'); setRowStat(${R(s)}, 'dr', '${dr}'); setRowStat(${R(s)}, 'mk', '${mk}'); 1`);
    const faces = id => run(`document.querySelectorAll(${JSON.stringify(`.pc[data-id="${id}"] .pc-port .portrait`)}).length`);
    const inAny = (l, id) => l.active.concat(l.more, l.goal, l.archive).includes(id);
    const mush = async () => {
      await h.setActivity(3, 'mushG', { mapIdx: 1, active: false });
      await h.setActivity(5, 'mushG', { mapIdx: 1, active: false });
      await run(`paintPanel(); 1`);
    };
    const spore = async s => { await run(`upsertTask({ ...taskFromOption(${R(s)}, grindOptions(${R(s)}).find(o => o.itemName === 'Spore Tee')), amount: '99999999' }); paintPanel(); 1`); return idOf('item|Spore Tee'); };
    await h.bump(d => { const c = JSON.parse(d.Cards0); c.mushG = 8; d.Cards0 = JSON.stringify(c); });
    await close('more'); await close('archive');
    await mush();
    const c3 = await idOf('card|mushG'); // one card task, the account's, whoever's on it
    await run(`taskEdit(${TK(c3)}, 'goal', '6'); 1`); // 8 copies, rank 7 at 75645: 75637 to go
    await stats(3, '1000', '2', '100'); // 1000 / 2 x 0.002 x 2 = 2 / hour
    await stats(5, '6000', '1', '100'); // 6000 / 2 x 0.002 x 1 = 6 / hour
    const shownAt = async (id, hoursFromSave) => {
      const m = await run(`(() => { const now = Date.now(), at = saveFacts().at + ${hoursFromSave} * 36e5; paintPanel(now); return { wait: fmtWait((at - now) / 36e5, true), clock: fmtClock(at, now) }; })()`);
      assert.equal(await card(id, '.pc-bar-text'), m.wait); assert.equal(await card(id, '.pc-bar-over'), m.wait); assert.equal(await card(id, '.pc-eta'), m.clock);
    };
    await test('two players on one monster are one card: the sum, then less, then a prompt', async () => {
      assert.ok(c3);
      await run(`paintPanel(); 1`);
      let l = await lists();
      assert.ok(l.active.includes(c3), 'one card for both');
      assert.equal(await card(c3, '.pc-who'), '2 of 2 players');
      assert.equal(await faces(c3), 2);
      await shownAt(c3, 75637 / 8); // 9454.625 hours from the save
      const names = await run(`[${R(3)}.name, ${R(5)}.name]`), tip = await run(`document.querySelector(${JSON.stringify(main(c3))}).title`);
      names.forEach(n => assert.ok(tip.includes(n), 'the tooltip names ' + n));
      await run(`setRowStat(${R(3)}, 'kph', ''); paintPanel(); 1`); // no kills per hour (a blank drop rate would be the team's average)
      assert.equal(await card(c3, '.pc-who'), '1 of 2 players');
      assert.equal(await faces(c3), 2, 'still both');
      await shownAt(c3, 75637 / 6); // 12606.17 hours: the rate fell
      await run(`setRowStat(${R(5)}, 'kph', ''); paintPanel(); 1`);
      l = await lists();
      assert.ok(!l.active.includes(c3), 'auto, with no ETA: folds'); assert.equal(await run(`panelGroup(${TK(c3)}).length`), 1);
      await open('more');
      assert.equal(await card(c3, '.pc-who'), '0 of 2 players');
      assert.equal(await card(c3, '.pc-bar-text'), '--', 'a card asks for nothing');
      assert.equal(await card(c3, '.pc-eta'), '');
      assert.equal(await run(`document.querySelector(${JSON.stringify(`.pc[data-id="${c3}"]`)}).classList.contains('no-eta')`), true);
      await close('more');
      await stats(3, '1000', '2', '100'); await stats(5, '6000', '1', '100');
      await run(`paintPanel(); 1`);
    });
    await test('portraits stop at 3; whoever counts comes first; the tooltip names everyone', async () => {
      const id = await idOf('card|w7b3');
      await stats(6, '1000', '1', '0'); await stats(1, '1000', '1', '0');
      await run(`[9, 8].forEach(s => setRowStat(rows.find(r => r.slot === s), 'kph', '')); paintPanel(); 1`); // these two don't count: no kills per hour (a blank drop rate would be the team's average)
      const team = await run(`taskCalc(${TK(id)}).team`);
      assert.deepEqual(team.rows.map(r => r.slot).slice(0, 2).sort(), [1, 6]); assert.equal(team.total, 4);
      assert.equal(await card(id, '.pc-who'), '2 of 4 players');
      assert.equal(await faces(id), 3);
      const tip = await run(`document.querySelector(${JSON.stringify(main(id))}).title`), names = await run(`[1, 9, 6, 8].map(s => rows.find(r => r.slot === s).name)`);
      names.forEach(n => assert.ok(tip.includes(n), n));
      assert.equal(await run(`${TK(id)}.slot`), null, 'no player of its own');
    });
    await test('no sideways overflow at 400 with merged cards; text keeps its room', async () => {
      await close('archive');
      const id = await idOf('card|w7b3');
      for (const w of [400, 979, 1500]) {
        await h.setSize(w, 1000);
        await run(`document.querySelector(${JSON.stringify(`.pc[data-id="${id}"]`)}).scrollIntoView({ block: 'center' }); 1`);
        const m = await run(`(() => { const box = $('activityPanel'), c = document.querySelector(${JSON.stringify(`.pc[data-id="${id}"]`)}), R = s => c.querySelector(s).getBoundingClientRect(), who = c.querySelector('.pc-who'); return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: box.scrollWidth - box.clientWidth,
          cardOut: c.getBoundingClientRect().right - innerWidth, h: c.offsetHeight, portRight: R('.pc-port').right, iconLeft: R('.pc-icon').left, lastFace: [...c.querySelectorAll('.portrait')].pop().getBoundingClientRect().right, bar: R('.pc-bar').width,
          whoCut: who.scrollWidth > who.clientWidth, whoRight: R('.pc-who').right, starLeft: R('.pc-star').left, etaCut: c.querySelector('.pc-eta').scrollWidth > c.querySelector('.pc-eta').clientWidth }; })()`);
        assert.equal(m.page, 0, w + ' page'); assert.equal(m.panel, 0, w + ' panel'); assert.ok(m.cardOut <= 0, w + ' card');
        assert.ok(m.h >= 60 && m.h <= 70, w + ' height ' + m.h);
        assert.ok(m.lastFace <= m.iconLeft + 3, w + ' faces clear the icon ' + JSON.stringify(m));
        assert.equal(m.whoCut, false, w + ' who text cut ' + JSON.stringify(m));
        assert.ok(m.whoRight <= m.starLeft + 1, w + ' who clear of the star');
        assert.ok(m.bar >= 90, w + ' leaves a bar of ' + m.bar);
        assert.equal(m.etaCut, false, w + ' ETA');
      }
      await h.shot('team-400.png', 400, 1000);
      await h.setSize(1500);
      await run(`document.querySelector(${JSON.stringify(`.pc[data-id="${id}"]`)}).scrollIntoView({ block: 'center' }); 1`);
      await h.shot('team-1500.png', 1500, 900);
      await h.setSize(1500, 900);
    });
    await test('hover and focus on a shared card survive ticks, and its portraits stay', async () => {
      await run(`window.seen = document.querySelector(${JSON.stringify(main(c3))}); window.face = seen.querySelector('.portrait'); window.moved = 0; window.mo = new MutationObserver(m => { moved += m.length; }); ['active','more','goal','archive'].forEach(k => mo.observe(panelParts[k], { childList: true })); 1`);
      const box = await run(`(() => { seen.scrollIntoView({ block: 'center' }); seen.focus(); const b = seen.getBoundingClientRect(); return { x: b.left + 80, y: b.top + b.height - 12 }; })()`);
      await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      await sleep(2300);
      assert.equal(await run(`seen === document.querySelector(${JSON.stringify(main(c3))}) && seen.contains(face)`), true, 'same nodes');
      assert.equal(await run(`seen.matches(':hover') && seen.closest('.pc').matches(':hover')`), true, 'hover');
      assert.equal(await run(`document.activeElement === seen`), true, 'focus');
      await run(`render(); paintAll(); 1`);
      await sleep(100);
      assert.equal(await run(`seen.isConnected && document.activeElement === seen && seen.matches(':hover') && seen.contains(face)`), true, 'through render()');
      assert.equal(await run(`moved`), 0, 'lists unchanged');
      await run(`mo.disconnect(); seen.blur(); 1`);
    });
    await test('a shared card asks who to view it from, and opens that player’s task', async () => {
      await run(`showTab('finder'); selectPlayer(5); calls.length = 0; 1`);
      await h.click(main(c3));
      await h.click('.pc-pick-row[data-slot="5"]', { hold: 1300 });
      assert.equal(await run('selectedSlot()'), 5); assert.deepEqual(await run('calls'), ['flash:' + c3]); assert.equal(await run(`$('viewPlanner').hidden`), false);
      await run(`showTab('finder'); selectPlayer(9); calls.length = 0; 1`);
      await h.click(main(c3));
      await h.click('.pc-pick-row[data-slot="3"]');
      assert.equal(await run('selectedSlot()'), 3); assert.deepEqual(await run('calls'), ['flash:' + c3]);
    });
    await test('the star persists; auto ones have no x', async () => {
      await h.click(star(c3), { hold: 1300 });
      assert.equal(await run(`${TK(c3)}.starred`), true);
      assert.equal(await run(`document.querySelector(${JSON.stringify(star(c3))}).getAttribute('aria-pressed')`), 'true');
      assert.equal(await shows(ex(c3)), false, 'auto');
      assert.deepEqual((await h.savedSheet()).tasks.filter(t => t.id === c3).map(t => t.starred), [true], 'saved');
      await h.reload();
      await spies();
      assert.equal(await run(`${TK(c3)}.starred`), true, 'after a reload');
      assert.ok((await lists()).active.includes(c3));
      await h.click(star(c3));
      assert.equal(await run(`${TK(c3)}.starred`), false);
      assert.deepEqual((await h.savedSheet()).tasks.filter(t => t.id === c3).map(t => t.starred), [false]);
    });
    await test('delete and Undo', async () => {
      const n = await run('tasks.length'), key = await run(`${TK(c3)}.key`);
      await run(`${TK(c3)}.auto = false; paintPanel(); 1`);
      assert.equal(await card(c3, '.pc-who'), '2 of 2 players');
      assert.equal(await shows(ex(c3)), false, 'not starred');
      await h.click(star(c3));
      assert.equal(await shows(ex(c3)), true, 'hand-made and starred');
      await h.click(ex(c3));
      assert.equal(await run('tasks.length'), n - 1);
      assert.ok(!inAny(await lists(), c3));
      assert.ok(!(await h.savedSheet()).tasks.some(t => t.key === key), 'gone from the file');
      await h.click('#undo');
      assert.equal(await run('tasks.length'), n);
      assert.equal(await run(`${TK(c3)}.key`), key, 'with its id');
      assert.ok(inAny(await lists(), c3));
      assert.equal((await h.savedSheet()).tasks.filter(t => t.key === key && t.starred).length, 1, 'back in the file, starred');
      await run(`${TK(c3)}.auto = true; ${TK(c3)}.starred = false; paintPanel(); 1`);
    });
    await test('one player leaving leaves the card to the other; with nobody on it, it’s a goal with no split', async () => {
      await run(`${TK(c3)}.starred = true; 1`);
      await h.setActivity(5, 'frogG', { mapIdx: 3, active: false });
      await run(`paintPanel(); 1`);
      let l = await lists();
      assert.ok(l.active.includes(c3), 'still being done');
      assert.equal(await faces(c3), 1, 'only who is on it');
      await h.setActivity(3, 'Divinity', { mapIdx: 200, active: false }); // nobody on it
      await run(`paintPanel(); 1`);
      l = await lists();
      assert.ok(l.goal.includes(c3), 'a goal');
      assert.equal(await run(`document.querySelectorAll(${JSON.stringify(`.pc[data-id="${c3}"] .pc-seg`)}).length`), 0, 'nobody on it: no split');
      await run(`${TK(c3)}.starred = false; paintPanel(); 1`);
    });
    await test('an item is one card, whoever asked for it', async () => {
      await h.setActivity(3, 'mushG', { mapIdx: 1, active: false });
      await h.setActivity(5, 'mushG', { mapIdx: 1, active: false });
      const a = await spore(3), b = await spore(5);
      assert.equal(a, b, 'the same task');
      assert.equal(await run(`${TK(a)}.key`), 'item|Spore Tee');
      assert.equal(await run(`${TK(a)}.slot`), null);
      await run(`paintPanel(); 1`);
      assert.equal(await card(a, '.pc-who'), '2 of 2 players');
      assert.ok(await run(`taskRate(${TK(a)}).team.counted`) >= 2);
      await run(`deleteTask(${JSON.stringify(a)}); paintPanel(); 1`);
      await h.setActivity(3, 'Divinity', { mapIdx: 200, active: false });
    });
    await test('a starred card is being done while anyone farms it, and a goal with no rate when nobody does', async () => {
      await run(`teamPending = () => 0; 1`); // again after the reload above: see the top of this section
      await h.setActivity(5, 'mushG', { mapIdx: 1, active: false });
      await run(`${TK(c3)}.starred = true; paintPanel(); 1`);
      assert.equal(await run(`taskSection(${TK(c3)})`), 'active');
      assert.ok((await lists()).active.includes(c3));
      await shownAt(c3, 75637 / 6);
      await h.setActivity(5, 'frogG', { mapIdx: 3, active: false });
      await run(`paintPanel(); 1`);
      assert.equal(await run(`taskSection(${TK(c3)})`), 'goal');
      assert.ok((await lists()).goal.includes(c3));
      assert.equal(await run(`taskCalc(${TK(c3)}).hours`), null, 'nobody on it: nothing to time');
      await run(`${TK(c3)}.starred = false; paintPanel(); 1`);
    });
    await test('screenshots', async () => {
      await close('more');
      await open('archive');
      const a = await run(`(() => { const t = tasks.filter(x => taskSection(x) === 'archive').slice(0, 2); t.forEach(toggleStar); paintPanel(); return t.map(x => x.id); })()`);
      for (const mode of ['dark', 'light']) {
        await scheme(h, mode);
        await run(`document.getElementById('activityPanel').scrollTop = 0; 1`);
        await h.shot(`panel-1500-${mode}.png`, 1500, 900);
        await run(`document.getElementById('activityPanel').scrollTop = 620; 1`);
        await h.shot(`panel-1500-${mode}-lower.png`, 1500, 900);
        await run(`document.getElementById('activityPanel').scrollTop = 0; scrollTo(0, 0); 1`);
        await h.shot(`panel-400-${mode}.png`, 400, 1400);
        await h.shot(`panel-979-${mode}.png`, 979, 800);
      }
      await h.setSize(1500);
      await run(`tasks.filter(x => ${JSON.stringify(a)}.includes(x.id)).forEach(toggleStar); paintPanel(); 1`);
      await scheme(h, 'dark');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally {
    await h.close();
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
