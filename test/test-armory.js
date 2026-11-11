// The Royal Armory tab: drain rates, the base rate measured from a collect, ETAs against the daily reset, and what the server keeps.
const assert = require('assert'), fs = require('fs'), path = require('path');
const { start, sleep, BUILD } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 600)); } };
// The game's save from 8:57 AM on Nov 10, with 4h 31m to the reset as the Royal Guardian Calculator read it, and its W1 outpost rates.
const save = JSON.parse(fs.readFileSync(path.join(BUILD, 'fixtures', 'full-save.json'), 'utf8')).data;
Object.assign(save, JSON.parse(fs.readFileSync(path.join(BUILD, 'testdata', 'armory-save.json'), 'utf8')));
const away = typeof save.TimeAway === 'string' ? JSON.parse(save.TimeAway) : save.TimeAway;
save.TimeAway = JSON.stringify({ ...away, ShopRestock: 4 * 3600 + 31 * 60 });
const W1 = { 1: 3.52e12, 2: 5.95e12, 6: 25.53e12, 7: 10.24e12, 10: 4.18e12, 11: 5.80e12, 12: 7.26e12, 13: 9.12e12, 14: 10.56e12, 15: 6.00e12, 16: 5.89e12, 17: 1.46e12, 18: 6.96e12, 19: 11.46e12, 24: 20.76e12, 26: 9.86e12, 27: 7.20e12, 28: 6.40e12, 30: 4.02e12, 31: 14.59e12, 32: 10.07e12, 42: 4.04e12 }, BASE = 77.37e9;
(async () => {
  const h = await start({ noPoll: true, saveData: save, savedAt: Date.now() - 6e4 }), run = h.run;
  try {
    await h.bump(() => {}); await sleep(300);
    // A collect made from the save: an hour of banked time, with one node drained exactly at BASE.
    await run(`(() => { const d = saveForFinder.data, G = armoryList(d.RoyalG), maps = armoryList(d.RoyalMaps), at = saveForFinder.savedAt;
      const before = { savedAt: at - 36e5, g: [G[2], [3600], G[4].slice(), G[5]], maps }, after = { savedAt: at - 36e5, g: [G[2], [0], G[4].slice(), G[5]], maps };
      const ops = armoryOutposts(G[2], maps), pull = ops.filter(o => o.links.includes(3)).reduce((s, o) => s + armoryPull(o, +G[5][3], armorySavage(G[2])), 0);
      before.g[2][3] = +G[4][3] - ${BASE} * pull; window.T = { collect: { before, after }, ops, maps }; return 1; })()`);
    await test('each W1 outpost’s rate is the calculator’s, from one base rate', async () => {
      const r = await run(`T.ops.filter(o => o.world === 1).map(o => [o.map, o.factor])`);
      assert.equal(r.length, 22);
      r.forEach(([map, factor]) => assert.ok(Math.abs(factor * BASE / W1[map] - 1) < 0.006, map + ': ' + factor * BASE + ' vs ' + W1[map]));
    });
    await test('units by type, as each outpost’s screen shows them: Jar Bridge 4 traders and 2 surveyors, Tunnels Entrance 3 workers, 2 traders, 2 surveyors', async () => {
      assert.deepEqual(await run(`T.ops.find(o => o.map === 51).counts`), [0, 4, 0, 2]);
      const tunnels = [7, 5, 26, 1097438.7, 235219.5, 40244.7, 16270.2, 0, 5, -1, 0, 553322211, 0]; // as saved on Nov 10 after a rearrange; its screen shows 3 workers, 2 traders, 2 surveyors
      assert.deepEqual(await run(`armoryOutposts(armoryList(saveForFinder.data.RoyalG)[2], Object.assign([], { 6: ${JSON.stringify(tunnels)} })).find(o => o.map === 6).counts`), [3, 2, 0, 2]);
      assert.deepEqual(await run(`T.ops.find(o => o.map === 51).passive`), [1, 0, 0, 0], 'the free worker from Command rank 1 still counts in the rate');
    });
    await test('the base rate comes back from a collect, and not from one where the node’s outpost moved', async () => {
      const fit = await run(`(() => { const v = armoryView(saveForFinder, [T.collect], saveForFinder.savedAt), n = v.nodes.find(n => n.i === 3); return { base: v.fit.base, nodes: v.fit.nodes, measured: n.measured, drain: n.drain }; })()`);
      assert.ok(Math.abs(fit.base / BASE - 1) < 1e-9 && fit.nodes === 1, JSON.stringify(fit));
      assert.ok(Math.abs(fit.measured / fit.drain - 1) < 1e-9, 'the node’s measured rate shows beside the calculated one: ' + JSON.stringify(fit));
      const acct = `armoryAccount(armoryList(saveForFinder.data.RoyalG), armoryRgLevel())`;
      const moved = await run(`(() => { const m = JSON.parse(JSON.stringify(T.maps)), o = T.ops.find(o => o.links.includes(3)); m[o.map][8] = 999; return armoryBase([{ before: T.collect.before, after: { ...T.collect.after, maps: m } }], ${acct}); })()`);
      assert.equal(moved, null);
      assert.equal(await run(`armoryBase([], ${acct})`), null);
    });
    await test('an edit or a reset shows at once, calculated, with no new collect; a measured rate goes once its outposts change', async () => {
      const r = await run(`(() => { const s = JSON.parse(JSON.stringify(saveForFinder)), G = armoryList(s.data.RoyalG), M = armoryList(s.data.RoyalMaps);
        const before = armoryView(saveForFinder, [T.collect], saveForFinder.savedAt), o = T.ops.find(o => o.links.includes(3));
        G[5] = G[5].map((g, i) => i < 60 ? +g + 1 : g); // a reset: 60 nodes a grade up
        M[o.map][1] = +M[o.map][1] + 1; // and Advanced Logistics a level up on node 3's outpost
        s.data.RoyalG = JSON.stringify(G); s.data.RoyalMaps = JSON.stringify(M);
        const after = armoryView(s, [T.collect], saveForFinder.savedAt), a = before.nodes.find(n => n.i === 3), b = after.nodes.find(n => n.i === 3);
        const ey = i => (+G[2][i] || 0) * ARMORY_BPL[i], grades = n => n.reduce((x, y) => x + (+y || 0), 0);
        return { base: after.fit.base / before.fit.base, want: (1 + grades(G[5]) * ey(18) / 100) / (1 + (grades(G[5]) - 60) * ey(18) / 100) * (1 +(T.ops.reduce((x, o) => x + o.upgrades, 0) + 1) * ey(50) / 100) / (1 + T.ops.reduce((x, o) => x + o.upgrades, 0) * ey(50) / 100), node: b.drain / a.drain, measured: b.measured };
      })()`);
      assert.ok(Math.abs(r.base / r.want - 1) < 1e-9, JSON.stringify(r));
      assert.ok(r.node > r.base, 'the outpost’s own upgrade shows too: ' + JSON.stringify(r));
      assert.equal(r.measured, undefined);
    });
    await test('at the save: as many nodes empty by the reset as the calculator counts, and the rest say how long', async () => {
      const v = await run(`(() => { const v = armoryView(saveForFinder, [T.collect], saveForFinder.savedAt), c = s => v.nodes.filter(n => n.status === s).length; return { today: c('today'), late: c('late'), empty: c('empty'), toReset: v.toReset, late1: v.nodes.filter(n => n.status === 'late').map(n => ({ n: n.name, missed: n.missed, short: n.short, savage: n.savage })) }; })()`);
      assert.equal(v.today, 17); assert.equal(v.late, 5); assert.equal(v.empty, 45);
      assert.ok(Math.abs(v.toReset - 4.5167) < 0.01, v.toReset);
      const berries = v.late1.find(n => n.n === 'Berries');
      assert.equal(berries.missed, 2); assert.ok(berries.short > 8 && berries.short < 9.2, berries.short);
      assert.ok(v.late1.some(n => n.savage && n.savage.today), 'a Savage Stronghold would finish at least one today');
    });
    await test('time moves on: banked time grows, and once the reset passes it says so', async () => {
      const v = await run(`(() => { const a = armoryView(saveForFinder, [T.collect], saveForFinder.savedAt + 36e5), b = armoryView(saveForFinder, [T.collect], saveForFinder.savedAt + 5 * 36e5); return { banked: a.banked, toReset: a.toReset, passed: b.passed, next: b.toReset }; })()`);
      assert.ok(Math.abs(v.banked - 1) < 1e-6 && Math.abs(v.toReset - 3.5167) < 0.01, JSON.stringify(v));
      assert.ok(v.passed && v.next > 23, JSON.stringify(v));
    });
    await test('the server keeps the saves either side of a collect, and nothing for a save without one', async () => {
      const g = () => JSON.parse(save.RoyalG);
      await h.bump(d => { d.Lv0_0 = d.Lv0_0; }); // no change to the nodes
      assert.equal((await run(`api('/api/armory')`)).collects.length, 0);
      await h.bump(d => { const G = g(); G[4][3] = +G[4][3] + 1e12; d.RoyalG = JSON.stringify(G); });
      const r = await run(`api('/api/armory')`);
      assert.equal(r.collects.length, 1);
      assert.ok(r.collects[0].after.g[2][3] - r.collects[0].before.g[2][3] === 1e12);
      assert.equal(r.maps[0], 'png', 'the W1 map from the wiki is served');
    });
    await test('the tab: counts, worlds, map and list, and a count filters both', async () => {
      await run(`armoryCollects = [T.collect]; showTab('armory'); 1`); await sleep(600);
      await run(`armoryCollects = [T.collect]; paintArmory(Date.now()); 1`);
      const r = await run(`(() => { const v = $('viewArmory'); return { pills: [...v.querySelectorAll('.arm-pill')].map(b => b.textContent), worlds: v.querySelectorAll('.arm-wtab').length, nodes: v.querySelectorAll('.arm-node').length, rows: v.querySelectorAll('.arm-row').length, img: !!v.querySelector('.arm-map image'), units: v.querySelectorAll('.arm-units tspan').length, boxes: v.querySelectorAll('.arm-units rect').length, selected: v.querySelector('.arm-wtab[aria-selected=true]').textContent }; })()`);
      assert.ok(r.pills.some(p => /won’t finish/.test(p)), r.pills.join(' | '));
      assert.equal(r.worlds, 4); assert.ok(r.img); assert.ok(r.units > 10 && r.boxes === 0, 'unit counts by the outposts, as text: ' + JSON.stringify(r)); assert.ok(r.nodes >= 15 && r.rows === r.nodes, JSON.stringify(r));
      assert.match(r.selected, /World 1/, 'opens on a world with a node that won’t finish');
      await run(`[...$('viewArmory').querySelectorAll('.arm-pill')].find(b => /won’t finish/.test(b.textContent)).click(); 1`);
      const f = await run(`({ rows: [...$('viewArmory').querySelectorAll('.arm-row')].map(r => r.className), fixes: $('viewArmory').querySelectorAll('.arm-fix').length })`);
      assert.ok(f.rows.length && f.rows.every(c => /s-late/.test(c)), f.rows.join(' '));
      assert.equal(f.fixes, f.rows.length);
      await run(`[...$('viewArmory').querySelectorAll('.arm-pill')].find(b => /won’t finish/.test(b.textContent)).click(); 1`); // the filter off again: every row
      const fills = await run(`(() => { const v = armoryView(saveForFinder, armoryCollects, Date.now()); return [...$('viewArmory').querySelectorAll('.arm-row')].map(r => { const n = v.nodes.find(x => x.i === +r.dataset.node); return [parseFloat(r.querySelector('.arm-fill').style.width), n.status === 'empty' ? 100 : 100 * (1 - n.left / n.max)]; }); })()`);
      fills.forEach(([w, want]) => assert.ok(Math.abs(w - want) < 0.01, w + ' vs ' + want + ': the row fills by how much is drained'));
      assert.ok(fills.some(([w]) => w > 95), 'a nearly drained node is nearly full');
      await h.shot('armory.png', 1300, 1400);
    });
    await test('links are curved arrows: two pointing at each other take different paths, and each head is at its target', async () => {
      const r = await run(`(() => {
        const svg = armorySv('svg', {}), a = { x: 0, y: 0, hw: 12, hh: 10 }, b = { x: 200, y: 0, hw: 12, hh: 10 };
        armoryArrow(svg, 'sup', a, b); armoryArrow(svg, 'sup', b, a);
        const paths = [...svg.querySelectorAll('path')].map(p => p.getAttribute('d')), heads = [...svg.querySelectorAll('polygon')].map(p => p.getAttribute('points').split(' ')[0].split(',').map(Number));
        const mid = d => d.slice(1).split(' L').map(s => s.split(' ').map(Number))[12];
        const v = $('viewArmory');
        return { paths: paths.length, mids: paths.map(mid), heads, onMap: v.querySelectorAll('.arm-map path.arm-link').length, mapHeads: v.querySelectorAll('.arm-map polygon.arm-head').length, lines: v.querySelectorAll('.arm-map line').length };
      })()`);
      assert.equal(r.paths, 2);
      assert.ok(Math.abs(r.mids[0][1] - r.mids[1][1]) > 40, 'the two bend apart: ' + JSON.stringify(r.mids));
      assert.ok(Math.abs(r.heads[0][0] - 188) < 2 && Math.abs(r.heads[0][1]) < 6, 'A to B ends at the edge of B: ' + r.heads[0]);
      assert.ok(Math.abs(r.heads[1][0] - 12) < 2 && Math.abs(r.heads[1][1]) < 6, 'B to A ends at the edge of A: ' + r.heads[1]);
      assert.ok(r.onMap > 5 && r.mapHeads === r.onMap && r.lines === 0, 'every link on the map is an arrow: ' + JSON.stringify(r));
      await h.shot('armory-arrows.png', 1300, 1000);
    });
    await test('the map says how long, never a clock time; the hover text and the list say when', async () => {
      const r = await run(`(() => { const v = $('viewArmory');
        return { map: [...v.querySelectorAll('.arm-node text.eta')].map(t => t.textContent), tips: [...v.querySelectorAll('.arm-node')].filter(g => /s-(today|late)/.test(g.getAttribute('class'))).map(g => g.querySelector('title').textContent),
          rows: [...v.querySelectorAll('.arm-row')].filter(r => /s-(today|late)/.test(r.className)).map(r => [r.querySelector('.arm-eta b').textContent, r.querySelector('.arm-eta div').textContent]) }; })()`);
      assert.ok(r.map.length > 5 && r.map.every(t => !/\d:\d\d/.test(t)), 'no clock times on the map: ' + r.map.join(' | '));
      assert.ok(r.tips.length && r.tips.every(t => /\d:\d\d/.test(t)), 'the hover text says when: ' + r.tips.join(' | '));
      assert.ok(r.rows.length && r.rows.every(([big, small]) => !/\d:\d\d/.test(big) && /^empty .*\d:\d\d/.test(small)), 'the list: how long, then when: ' + JSON.stringify(r.rows));
    });
    await test('an outpost doing nothing, or on an empty resource, is ringed in red and says why', async () => {
      const r = await run(`(() => {
        const nodes = [{ i: 1, name: 'Wheat', status: 'empty' }, { i: 2, name: 'Leaf', status: 'today' }];
        const issues = [armoryOpIssue({ mode: 0, links: [], supports: [] }, nodes), armoryOpIssue({ mode: 0, links: [1, 2], supports: [] }, nodes), armoryOpIssue({ mode: 2, links: [2], supports: [] }, nodes), armoryOpIssue({ mode: 1, links: [], supports: [] }, nodes), armoryOpIssue({ mode: 1, links: [], supports: [60] }, nodes)];
        const v = armoryView(saveForFinder, armoryCollects, Date.now()), flagged = v.outposts.filter(o => o.at && armoryOpIssue(o, v.nodes)), m = $('viewArmory');
        if (flagged.length) { armoryWorld = flagged[0].world; paintArmory(Date.now()); }
        const want = flagged.filter(o => o.world === armoryWorld).length;
        return { issues, want, flagged: flagged.map(o => o.world + ' ' + o.name + ': ' + armoryOpIssue(o, v.nodes)), rings: m.querySelectorAll('.arm-map .arm-op-warn').length, names: m.querySelectorAll('.arm-map .arm-opname.warn').length };
      })()`);
      assert.equal(r.issues[0], 'Not connected to any resource');
      assert.match(r.issues[1], /Wheat, already empty/);
      assert.equal(r.issues[2], '', 'one on a resource still draining is fine');
      assert.equal(r.issues[3], 'Not supporting any outpost');
      assert.equal(r.issues[4], '');
      assert.ok(r.want > 0 && r.rings === r.want && r.names === r.want, 'the map rings each one: ' + JSON.stringify(r));
      await h.shot('armory-idle.png', 1300, 1000);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
