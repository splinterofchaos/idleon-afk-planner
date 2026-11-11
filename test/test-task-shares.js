// Clear and Hide on task cards; each player's share on shared tasks, and asking who to view a task from.
const assert = require('assert');
const { start, sleep } = require('./harness');
const J = JSON.stringify;
let pass = 0, fail = 0;
const test = async (name, f) => { try { if (globalThis.__panelStub) await globalThis.__panelStub(); await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, width: 1400, height: 1000 }), run = h.run;
  globalThis.__panelStub = () => run(`window.__panelPlayedReal = panelPlayed; panelPlayed = group => !(group.every(x => x.auto && !x.starred) && (k => !k.done && !(k.hours != null && !Number.isNaN(k.hours)))(taskCalc(group[0]))); if (!window.__panelStubbed) { window.__panelStubbed = true; paintPanel(); } 1`);
  await globalThis.__panelStub(); // older tests keep the earlier folding, including after a reload
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    await run(`(() => {
      window.P = rows.filter(r => r.slot != null).slice(0, 3);
      const put = (r, id, map) => { const m = GAME.monsters[id]; r.monster = id; r.mapIdx = map; r.kind = 'kills'; r.activity = 'FIGHTING'; r.activityKey = m[1] + '|' + m[0]; r.afkSince = Date.now() - 2 * 36e5; };
      put(P[0], 'w6d3', 264); put(P[1], 'w6d2', 263);
      activePlayerSlot = () => P[2].slot;
      P.slice(0, 2).forEach(r => { const a = { slot: r.slot, activityKey: r.activityKey, source: 'monster' }; statSet(a, 'kph', '1000000000'); statSet(a, 'dr', '100'); });
      tasks.filter(t => t.itemName === 'Golden Dumpling').forEach(t => deleteTask(t.id));
      window.T = upsertTask({ type: 'item', itemName: 'Golden Dumpling', amount: '1e15', starred: true, source: 'monster', chance: 0.0000228, monster: 'w6d3', afkId: 'w6d3', activityKey: P[0].activityKey, match: { kind: 'activity', key: P[0].activityKey }, mapIdx: 264 });
      renderPanel(); return 1;
    })()`);
    await sleep(200);
    const card = `.pc[data-id="${await run('T.id')}"]`;

    await test('shares: each player has a rate, and two hours of it waiting', async () => {
      const s = await run(`taskShares(T)`);
      assert.equal(s.length, 2);
      s.forEach(x => { assert.ok(x.rate > 0); assert.ok(Math.abs(x.waiting - x.rate * 2) < x.rate * 0.01, J(x)); assert.equal(x.playing, false); });
      assert.ok(Math.abs(s.reduce((n, x) => n + x.rate, 0) - await run(`taskRate(T).rate`)) < 1e-6, 'adds up to the task rate');
    });
    await test('the played character has nothing waiting', async () => {
      await run(`activePlayerSlot = () => P[0].slot; 1`);
      const s = await run(`taskShares(T).find(x => x.slot === P[0].slot)`);
      assert.equal(s.playing, true); assert.equal(s.waiting, 0);
      await run(`activePlayerSlot = () => P[2].slot; 1`);
    });
    await test('what the AFK players had waiting by the save counts towards it, so the time left comes down while they are away', async () => {
      const got = await run(`(() => { const was = P.map(r => r.afkSince); P.slice(0, 2).forEach(r => { r.afkSince = saveFacts().at - 3 * 36e5; }); try { const now = Date.now(), at = saveFacts().at, k = taskCalc(T, now), s = taskShares(T, at), pending = s.reduce((n, x) => n + x.waiting, 0);
        return { at, now, pending, kPending: k.pending, hours: k.hours, want: Math.max(at + (k.target - k.have - pending) / k.rate * 36e5 - now, 0) / 36e5, without: Math.max(at + (k.target - k.have) / k.rate * 36e5 - now, 0) / 36e5,
          away: s.map(x => (at - P.find(r => r.slot === x.slot).afkSince) / 36e5) }; } finally { P.forEach((r, i) => { r.afkSince = was[i]; }); } })()`);
      assert.ok(got.pending > 0 && got.away.every(a => a > 1), 'they were away well before the save: ' + J(got));
      assert.ok(Math.abs(got.kPending - got.pending) < got.pending * 1e-9, J(got));
      assert.ok(Math.abs(got.hours - got.want) < 1e-6 && got.hours < got.without, J(got));
    });
    await test('no two players on a task share a colour: slot 2 and slot 8 would both be colour 2, so the higher slot takes the next free one', async () => {
      const c = await run(`[shareColor(2, [2, 8]), shareColor(8, [2, 8]), shareColor(8, [8]), shareColor(8, [0, 1, 2, 3, 8]), shareColor('militia', [2, 'militia'])]`);
      assert.deepEqual(c, ['var(--share2)', 'var(--share3)', 'var(--share2)', 'var(--share4)', 'var(--militia)']);
      const css = await run(`[0, 1, 2, 3, 4, 5].map(i => getComputedStyle(document.documentElement).getPropertyValue('--share' + i).trim())`);
      assert.equal(new Set(css).size, 6, J(css));
      css.forEach(h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); assert.ok(!(g > r && g > b), 'no greens: ' + h); });
    });
    await test('the bar splits what’s left by each player’s share of the rate, in their colour, each filling with what they have waiting', async () => {
      await run(`P.slice(0, 2).forEach(r => statSet({ slot: r.slot, activityKey: r.activityKey, source: 'monster' }, 'kph', '1e16')); T.amount = String(Math.ceil(taskHave(T) + taskRate(T).rate * 20)); renderPanel(); 1`);
      const parts = await run(`[...document.querySelectorAll(${J(card + ' .pc-seg')})].map(x => ({ c: x.style.getPropertyValue('--c'), left: parseFloat(x.style.left), w: parseFloat(x.style.width), fill: parseFloat(x.querySelector('.pc-seg-in').style.width) }))`);
      const want = await run(`(() => { const k = taskCalc(T), s = taskShares(T), sum = s.reduce((n, x) => n + x.rate, 0), left = k.target - k.have; return { base: k.have / k.target * 100, s: s.map(x => ({ w: left * x.rate / sum / k.target * 100, fill: Math.min(x.waiting / (left * x.rate / sum), 1) * 100 })) }; })()`);
      assert.equal(parts.length, 2);
      parts.forEach(p => assert.match(p.c, /--share\d/));
      assert.notEqual(parts[0].c, parts[1].c);
      assert.ok(Math.abs(parts[0].left - want.base) < 0.01, J([parts, want]));
      parts.forEach((p, i) => { assert.ok(Math.abs(p.w - want.s[i].w) < 0.01, J([parts, want])); assert.ok(Math.abs(p.fill - want.s[i].fill) < 0.01 && p.fill > 0, J([parts, want])); });
      assert.ok(Math.abs(parts[1].left - (parts[0].left + parts[0].w)) < 0.01, 'end to end');
      assert.match(await run(`document.querySelector(${J(card + ' .pc-main')}).title`), /% of what’s left .* waiting/);
    });
    await test('a portal splits evenly by the players it needs: cleared full, the rest by their own kills, open parts for who’s missing', async () => {
      const r = await run(`(() => { const map = Object.keys(GAME.portals).find(i => +GAME.portals[i] > 0), kills = +GAME.portals[map], R = n => ({ slot: P[n].slot, name: P[n].name });
        const k = { done: false, crew: { need: 4, known: true, all: [{ r: R(0), cleared: false, there: true, left: kills * 0.25, waiting: kills * 0.1 }, { r: R(1), cleared: true, there: false, left: -5 }, { r: R(2), cleared: false, there: false, left: kills }, { r: { slot: 99, name: 'Away' }, cleared: false, there: false, left: kills * 0.6 }] } };
        return panelSplit({ type: 'portal', mapIdx: +map }, k); })()`);
      // claimed by everyone is one leading section: cleared 1 + 0.75 + 0.4 of 4 parts
      assert.ok(Math.abs(r.base - 53.75) < 1e-9, String(r.base));
      // then what's left of each player's part, filling with what they have unclaimed, then an open part; a cleared player has none
      const R2 = x => Math.round(x * 1000) / 1000;
      assert.deepEqual(r.parts.map(p => [p.slot === 99 ? 'away' : p.slot == null ? 'open' : 'p0', R2(p.left), R2(p.w), R2(p.fill)]), [['p0', 53.75, 6.25, 0.4], ['away', 60, 15, 0], ['open', 75, 25, 0]]);
      assert.match(r.lines.join('\n'), /cleared[\s\S]*of[\s\S]*kills[\s\S]*1 more player needed/);
    });
    await test('a click asks who to view it from, and picking opens that player', async () => {
      await h.click(card + ' .pc-main');
      const names = await run(`[...document.querySelectorAll('.pc-pick-row')].map(b => +b.dataset.slot)`);
      assert.deepEqual(names.sort(), await run(`[P[0].slot, P[1].slot].sort()`));
      const pick = await run(`P[1].slot`);
      await h.click(`.pc-pick-row[data-slot="${pick}"]`);
      await sleep(150);
      assert.equal(await run(`selectedSlot()`), pick);
      assert.equal(await run(`$('viewPlanner').hidden`), false);
      assert.equal(await run(`document.querySelectorAll('.pc-pick').length`), 0);
    });
    await test('the editor lists each player', async () => {
      await sleep(200);
      await run(`showTab('player'); 1`); // the editor, with its By player list, is on the Player tab
      await sleep(200);
      const rows = await run(`[...document.querySelectorAll('#playerTasks .task-editor[data-task="' + T.id + '"] .ed-share')].map(x => [+x.dataset.slot, x.innerText])`);
      // Earned AFK is the selected player's own share over their own time away, not everyone's rate
      const earned = await run(`(n => n.hidden ? null : n.querySelector('.big').textContent)(document.querySelector('#playerTasks .task-editor[data-task="' + T.id + '"] .s-earned'))`);
      const mine = await run(`(s => s ? editorFew(s.waiting) : null)(taskShares(tasks.find(t => t.id === T.id)).find(s => s.slot === selectedSlot()))`);
      assert.equal(earned, mine, 'own share');
      await run(`showTab('planner'); 1`);
      assert.equal(rows.length, 2);
      rows.forEach(r => assert.match(r[1], /\/ hour.*waiting/s));
    });
    await test('whoever is being played reads "active" in green, where the others have what’s waiting', async () => {
      const html = await run(`(() => { const t = tasks.find(t => t.id === T.id), s = { ...taskShares(t)[0], playing: true, waiting: 0 }, n = shareLine(s, 'small'); return { text: n.textContent, green: getComputedStyle(document.body.appendChild(n).querySelector('.share-active')).color === getComputedStyle(document.documentElement).getPropertyValue('--grass').trim() || !!n.querySelector('.share-active') }; })()`);
      assert.match(html.text, / \/ hour · active$/); assert.ok(html.green);
    });
    await test('one character’s own AFK rate is their share, not everyone’s', async () => {
      const r = await run(`(t => { const team = taskCalc(t, Date.now(), null, true).rate, own = teamOf(t).map(x => afkOwnRate(t, x.slot)); return { team, own }; })(tasks.find(t => t.id === T.id))`);
      assert.ok(r.own.length >= 2 && r.own.every(x => x > 0 && x < r.team), JSON.stringify(r));
      assert.ok(Math.abs(r.own.reduce((a, b) => a + b, 0) - r.team) < r.team * 1e-6, 'the shares add up to the whole');
    });
    await test('one player opens straight away', async () => {
      await run(`(() => { const r = P[1]; r.monster = 'noDrops'; DROPS.noDrops = []; renderPanel(); return 1; })()`);
      await sleep(100);
      await h.click(card + ' .pc-main');
      assert.equal(await run(`document.querySelectorAll('.pc-pick').length`), 0);
    });
    await test('Hide moves a task to the archive, and Unhide brings it back', async () => {
      assert.equal(await run(`taskSection(T)`), 'active');
      await h.click(card + ' .pc-hide');
      await sleep(100);
      assert.equal(await run(`taskSection(T)`), 'archive');
      assert.equal(await run(`T.hidden`), true);
      await run(`panelOpen.archive = true; renderPanel(); 1`);
      await sleep(100);
      assert.equal(await run(`document.querySelector(${J(card + ' .pc-hide')}).textContent`), '+');
      await h.click(card + ' .pc-hide');
      await sleep(100);
      assert.notEqual(await run(`taskSection(T)`), 'archive');
    });
    await test('starring a hidden task brings it back', async () => {
      await run(`(() => { T.starred = false; T.hidden = true; toggleStar(T); return 1; })()`);
      assert.equal(await run(`!!T.hidden`), false);
    });
    await test('a finished clear has a Clear button, and it goes for good', async () => {
      const id = await run(`(() => { const r = P[0], t = upsertTask({ slot: r.slot, type: 'clear', activityKey: r.activityKey, match: { kind: 'activity', key: r.activityKey }, monster: r.monster, afkId: r.monster, mapIdx: r.mapIdx, auto: true, cleared: true, left: '0', clearedSeen: true, startValue: 100 }); renderPanel(); return t.id; })()`);
      await sleep(100);
      const done = await run(`taskCalc(tasks.find(t => t.id === ${J(id)})).done`);
      assert.equal(done, true);
      const x = `.pc[data-id="${id}"] .pc-x:not(.pc-hide)`;
      assert.equal(await run(`document.querySelector(${J(x)}).textContent`), '✓');
      assert.equal(await run(`document.querySelector(${J(`.pc[data-id="${id}"] .pc-hide`)}).hidden`), true);
      await h.click(x);
      await sleep(100);
      assert.equal(await run(`tasks.some(t => t.id === ${J(id)})`), false);
    });
    await test('a finished skill task hides, since the game would only make it again', async () => {
      const r = await run(`(() => { const t = upsertTask({ slot: P[2].slot, type: 'skill', skill: 1, activityKey: 'MINING|Gold', match: { kind: 'activity', key: 'MINING|Gold' } }); panelClear(t); return [tasks.includes(t), t.hidden]; })()`);
      assert.deepEqual(r, [true, true]);
    });
    await test('Starred first moves goals up, and is remembered', async () => {
      const order = () => run(`[...panelParts.active.children].map(c => { const t = tasks.find(x => x.id === c.dataset.id); return t && panelGroup(t).some(x => x.starred) ? 1 : 0; })`);
      await run(`tasks.filter(t => taskSection(t) === 'active').slice(-1).forEach(t => { t.starred = true; }); renderPanel(); 1`);
      await h.click('.pn-sort');
      await sleep(100);
      const on = await order();
      assert.ok(on.length > 1 && on[0] === 1, JSON.stringify(on));
      assert.deepEqual(on, [...on].sort((a, b) => b - a), 'starred ones all come first');
      assert.equal(await run(`localStorage.getItem(LOCAL_KEY + '-star-first')`), '1');
      await h.click('.pn-sort');
      assert.equal(await run(`localStorage.getItem(LOCAL_KEY + '-star-first')`), '0');
    });
    await test('ready only by unclaimed AFK gains keeps the players’ colours, each part sized by what they have waiting; claimed, it’s plain done', async () => {
      const r = await run(`(() => { const keep = taskShares; taskShares = () => [{ slot: 0, name: 'A', rate: 5, waiting: 30 }, { slot: 1, name: 'B', rate: 5, waiting: 10 }];
        try { const T = { type: 'item' }, base = { active: true, team: { rows: [] }, target: 100, have: 20, done: true };
          return [panelSplit(T, { ...base, pending: 90 }), panelSplit(T, { ...base, have: 100, pending: 5 }), panelSplit(T, { ...base, pending: 0 })]; } finally { taskShares = keep; } })()`);
      const R2 = x => Math.round(x * 1000) / 1000;
      assert.equal(r[0].base, 20);
      assert.deepEqual(r[0].parts.map(p => [p.slot, R2(p.left), R2(p.w), p.fill]), [[0, 20, 60, 1], [1, 80, 20, 1]]);
      assert.match(r[0].lines.join(' | '), /A: 30 waiting to be claimed/);
      assert.equal(r[1], null, 'already has it: no split');
      assert.equal(r[2], null, 'nothing unclaimed: no split');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
