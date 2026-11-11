// World > Statues: levels from the save, grade art, flair costs against marbles held, and a statue level goal. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
const J = JSON.stringify, P = v => typeof v === 'string' ? JSON.parse(v) : v;
(async () => {
  const h = await start({ sheet: true, noPoll: true, width: 1400, height: 1000 }), run = h.run;
  // Dragon (29): level 10, 5 in; Coral (31): level 96 on one character, 95 on another; flair 2 on Power (0); grades: Power zenith, Speed onyx, Mining gold
  const setup = (more = () => {}) => h.bump(d => {
    const slots = Object.keys(d).map(k => k.match(/^Lv0_(\d+)$/)).filter(Boolean).map(m => +m[1]);
    slots.forEach((s, n) => { const l = Array.from({ length: 32 }, () => [0, 0]); l[29] = [10, 5]; l[31] = n === 1 ? [96, 2532.5] : [95, 10]; l[0] = [3, 0]; d['StatueLevels_' + s] = J(l); });
    d.StuG = J([3, 2, 1]);
    const g = P(d.RoyalG) || []; while (g.length < 23) g.push([]); g[22] = [2]; d.RoyalG = J(g);
    // nothing of the marble or the Dragon statue anywhere but what's put here
    Object.keys(d).filter(k => /^InventoryOrder_\d+$/.test(k)).forEach(k => { const o = P(d[k]); o.forEach((r, i) => { if (r === 'RGshard0' || r === 'EquipmentStatues30') o[i] = 'Blank'; }); d[k] = J(o); });
    { const o = P(d.ChestOrder); o.forEach((r, i) => { if (r === 'RGshard0' || r === 'EquipmentStatues30') o[i] = 'Blank'; }); d.ChestOrder = J(o); }
    const o = P(d.ChestOrder), q = P(d.ChestQuantity); o.push('RGshard0', 'EquipmentStatues30'); q.push(300, 40); d.ChestOrder = J(o); d.ChestQuantity = J(q);
    more(d);
  });
  try {
    await setup(); await h.poll(); await sleep(400);
    // the flair and level sums first, with nothing else raising what a statue counts for; the deposit bonus has its own test
    await run(`window.__deposit = statueDepositBonus; statueDepositBonus = () => ({ multi: 1, onyx: 0, zenith: 0, vial: 0 }); 1`);
    await test('the formula: what each level takes', async () => {
      assert.deepEqual(await run(`[0, 1, 10, 96, 100].map(statueLevelCost)`), [1, 2, 21, 3720, 4400]);
    });
    await test('levels are the highest any character has; grade, flair and art come from the save', async () => {
      const s = await run(`(() => { const l = statueList(); return [l[31].level, l[31].progress, l[29].level, l[0].grade, l[0].art, l[1].art, l[2].art, l[3].art, l[0].flair, l[0].expMulti, l[29].held]; })()`);
      assert.deepEqual(s, [96, 2532.5, 10, 3, 'StatueZ1', 'StatueO2', 'StatueG3', 'Statue4', 2, 1 + 2 * (600 + 100) / 100, 40]);
    });
    await test('statues to a level: what the levels take less what is in, over the flair multiplier', async () => {
      assert.equal(await run('statuesToLevel(29, 12)'), 21 + 24 - 5); // levels 10 and 11
      assert.equal(await run('statuesToLevel(29, 10)'), 0);
      assert.equal(await run('statuesToLevel(0, 4)'), Math.ceil((Math.round(Math.pow(3, 1.17) * Math.pow(1.35, .3) + 1)) / 17));
      assert.deepEqual(await run('statueAfter(31, 2528)'), { level: 97, progress: 2528 + 2532.5 - 3720, next: 3880 });
    });
    await test('World holds Statues, Forge and Armory, and no Printer; its own row of tabs shows only there', async () => {
      await run(`showTab('world'); 1`); await sleep(200);
      assert.equal(await run(`$('worldNav').hidden`), false);
      assert.equal(await run(`$('tabWorld').getAttribute('aria-selected')`), 'true');
      assert.equal(await run(`!$('viewStatues').hidden && $('viewForge').hidden && !$('viewPrinter') && !$('tabPrinter')`), true);
      await h.click('#tabForge'); await sleep(200);
      assert.equal(await run(`!$('viewForge').hidden && $('viewStatues').hidden && $('tabWorld').getAttribute('aria-selected') === 'true' && $('tabForge').getAttribute('aria-selected') === 'true'`), true);
      await h.click('#tabPlanner'); await sleep(100);
      assert.equal(await run(`$('worldNav').hidden`), true);
      await h.click('#tabWorld'); await sleep(200);
      assert.equal(await run(`!$('viewForge').hidden`), true, 'World opens on the last of its tabs');
      await h.click('#tabStatues'); await sleep(300);
    });
    await test('a card per statue, the art by grade, and the flair cost green when the marbles held cover it', async () => {
      assert.equal(await run(`document.querySelectorAll('.st-card').length`), 32);
      assert.equal(await run(`document.querySelector('[data-statue="0"] .st-art').getAttribute('src')`), 'icons/StatueZ1.png');
      const cost = await run(`[...document.querySelectorAll('[data-statue="0"] .st-cost, [data-statue="1"] .st-cost')].map(c => [c.className, c.textContent])`);
      assert.deepEqual(cost, [['st-cost ok', await run('fmtNum(250)')], ['st-cost ok', await run('fmtNum(20)')]], J(cost)); // Power: 10·1·5² = 250 of 300 held; Speed: 10·2 = 20
      await setup(d => { const q = P(d.ChestQuantity); q[q.length - 2] = 100; d.ChestQuantity = J(q); }); await h.poll(); await sleep(400);
      await run(`statuesPainted = ''; paintStatues(); 1`);
      assert.equal(await run(`document.querySelector('[data-statue="0"] .st-cost').className`), 'st-cost short', '100 held');
    });
    await test('a goal level: an account task, the statues it takes with those held counted, and its ETA from the rate', async () => {
      await run(`(() => { const f = document.querySelector('[data-statue="29"] .st-goal'); f.querySelector('input').value = '12'; f.requestSubmit(); })(); 1`); await sleep(300);
      const t = await run(`(() => { const t = tasks.find(x => x.statueTo); const k = taskCalc(t); return { title: taskTitle(t), key: t.key, slot: t.slot, starred: t.starred, target: k.target, have: k.have }; })()`);
      assert.deepEqual(t, { title: 'Dragon Warrior Statue to level 12', key: 'statue|29', slot: null, starred: true, target: 40, have: 40 });
      assert.equal(await run(`taskCalc(tasks.find(x => x.statueTo)).done`), true, '40 held covers 40');
      await run(`(() => { const t = tasks.find(x => x.statueTo); t.statueTo = 20; t.perHour = '100'; t.source = 'direct'; 1; })()`);
      const k = await run(`(() => { const k = taskCalc(tasks.find(x => x.statueTo)); return { target: k.target, hours: k.hours, rate: k.rate }; })()`);
      assert.equal(k.target, await run('statuesToLevel(29, 20)'));
      assert.ok(k.rate === 100 && Math.abs(k.hours - (k.target - 40) / 100) < 0.01, J(k));
      assert.deepEqual(await run(`tasks.filter(x => x.type === 'item' && x.itemName === 'Dragon Warrior Statue').map(x => x.key).sort()`), ['item|Dragon Warrior Statue', 'statue|29'], 'the level goal and its Collect task, not merged');
    });
    await test('a level goal sets its Collect task: the statues still to put in, moving with flair; a smaller typed amount stands', async () => {
      await run(`(t => { t.source = 'monster'; delete t.perHour; Object.assign(t, statueDropSource(29)); })(tasks.find(x => x.statueTo)); syncTasks(); 1`);
      const c = () => run(`(t => ({ amount: t.amount, exact: t.amountExact, auto: t.amountAuto, starred: t.starred, of: t.statueGoalOf, target: taskTarget(t) }))(statueCollectTask(29))`);
      const need = await run('statuesToLevel(29, 20)');
      assert.deepEqual(await c(), { amount: await run(`fmtNum(${need})`), exact: need, auto: true, starred: true, of: 29, target: need });
      // a flair bought (here: the 300 Dragon marbles held, counted as spent first) makes each statue count for more
      await setup(d => { const o = P(d.ChestOrder), q = P(d.ChestQuantity); o.push('RGshard3'); q.push(300); d.ChestOrder = J(o); d.ChestQuantity = J(q); }); await h.poll(); await sleep(300);
      await run(`statuesFlairFirst = true; syncTasks(); 1`);
      const less = await run('statuesToLevel(29, 20)');
      assert.ok(less < need, 'flair bought first: fewer to collect: ' + less + ' vs ' + need);
      assert.equal((await c()).target, less, 'the Collect task follows');
      await run(`statuesFlairFirst = false; taskEdit(statueCollectTask(29), 'amount', '30'); syncTasks(); 1`);
      assert.equal((await c()).target, 30, 'a smaller typed amount stands');
      await run(`taskEdit(statueCollectTask(29), 'amount', '1e9'); syncTasks(); 1`);
      assert.equal((await c()).target, need, 'a larger one comes down to the goal');
      // the goal is the parent: the panel, the AFK planner and the Player tab list the Collect task
      const goalId = await run(`tasks.find(x => x.statueTo).id`), collectId = await run(`statueCollectTask(29).id`);
      assert.equal(await run(`projectTaskHidden(tasks.find(x => x.id === ${J(goalId)}))`), true, 'not in the panel');
      assert.equal(await run(`playerTasksOf(rows.find(r => r.slot != null)).some(t => t.id === ${J(goalId)})`), false, 'not on the Player tab');
      const fighter = await run(`rows.find(r => r.slot != null).slot`);
      await h.setActivity(fighter, 'caveC', { mapIdx: 216 }); await sleep(300);
      await run(`selectPlayer(${fighter}); showTab('planner'); paintAll(); 1`); await sleep(200);
      const lists = await run(`(l => [...l.active, ...l.goals].map(t => t.id))(actTaskLists(selectedRow()))`);
      assert.ok(lists.includes(collectId) && !lists.includes(goalId), 'the planner shows the Collect task');
      assert.match(await run(`document.querySelector('#plannerTasks .tcard[data-task="${collectId}"] .tcard-line').textContent`), / · for level 20$/, 'and what it’s for');
      await run(`showTab('statues'); 1`);
    });
    await test('enough held for a level: a potential row, and with the tick, the flair the marbles buy goes first', async () => {
      await setup(d => { const o = P(d.ChestOrder), q = P(d.ChestQuantity); Object.keys(d).filter(k => /^InventoryOrder_d+$/.test(k)).forEach(k => { const v = P(d[k]); v.forEach((r, i) => { if (r === 'RGshard3') v[i] = 'Blank'; }); d[k] = J(v); }); o.forEach((r, i) => { if (r === 'RGshard3') o[i] = 'Blank'; }); o.push('RGshard3'); q.push(300); d.ChestOrder = J(o); d.ChestQuantity = J(q); }); await h.poll(); await sleep(300);
      await run(`statuesFlairFirst = false; statuesPainted = ''; paintStatues(); 1`);
      const pot = () => run(`(n => n ? [n.previousElementSibling.dataset.statue, n.querySelector('.st-lv b').textContent, n.querySelector('.st-lv .st-gain').textContent, n.querySelector('.st-flair').textContent, n.querySelector('.st-who').textContent] : null)(document.querySelector('[data-potential="29"]'))`);
      assert.deepEqual(await pot(), ['29', '12', '+2', '0/3×1', 'Potentialall 40 put in']); // 40 held: 21 and 24 from 5 in, a row of its own under the statue
      assert.deepEqual(await run(`statueList().filter(s => !(s.held > 0) || statueAfter(s.index, s.held).level === s.level).filter(s => document.querySelector('[data-potential="' + s.index + '"]')).map(s => s.index)`), [], 'no row without a level in hand');
      await h.click('#statueFlairFirst'); await sleep(200);
      const want = await run(`statueAfter(29, 40, 7).level`); // 300 marbles buy flair 1 (10 × 30): each counts 7
      assert.deepEqual(await pot(), ['29', String(want), '+' + (want - 10), '1/3×7−300', 'Potentialall 40 put in, flair 1 first']);
      await h.click('#statueFlairFirst'); await sleep(200);
      assert.deepEqual(await pot(), ['29', '12', '+2', '0/3×1', 'Potentialall 40 put in']);
    });
    await test('each statue’s effect: level × base × the account’s multipliers, the most any character gets; a potential row shows the effect at its level', async () => {
      const e = await run(`(() => { const a = statueEffect(29, 10, 0), b = statueEffect(29, 12, 0), p = statueEffect(0, 3, 3); return [a.value, b.value, p.value === p.plain, p.plain > 0, p.own]; })()`);
      assert.ok(e[0] > 0 && Math.abs(e[1] / e[0] - 1.2) < 1e-9, 'linear in level: ' + e);
      assert.ok(e[2] && e[3] && e[4] === 1, 'no character: none of their talents ' + e);
      // a character's own statue talent raises only theirs: as if they had 50% from Strongest Statues
      const mine = await run(`(() => { const C = statueCtx(), slot = C.slots[0]; statuePlayer(C, slot); const real = scTalent; scTalent = (C2, P, id) => id === SC_DATA.talId.STRONGEST_STATUES ? 50 : real(C2, P, id); try { const p = statueEffect(0, 3, 3, slot), q = statueEffect(4, 3, 3, slot); return [p.own, p.value / p.plain, q.own]; } finally { scTalent = real; } })()`);
      assert.deepEqual(mine, [1.5, 1.5, 1], 'Power takes Strongest Statues; Health takes no talent');
      // with both of Power's talents, only the first it has counts, as in Toolbox: Shieldiest 20%, Strongest 50% gives 1.2, not 1.8
      const both = await run(`(() => { const C = statueCtx(), slot = C.slots[0]; statuePlayer(C, slot); const real = scTalent; scTalent = (C2, P, id) => id === SC_DATA.talId.STRONGEST_STATUES ? 50 : id === SC_DATA.talId.SHIELDIEST_STATUES ? 20 : real(C2, P, id); try { return statueEffect(0, 3, 3, slot).own; } finally { scTalent = real; } })()`);
      assert.ok(Math.abs(both - 1.2) < 1e-9, 'one talent, not both: ' + both);
      await run(`(() => { const s = $('statueWho'); s.value = String(statueCtx().slots[1]); s.dispatchEvent(new Event('change')); })(); 1`); await sleep(200);
      assert.equal(await run('statuesWho'), await run('statueCtx().slots[1]'));
      assert.equal(await run(`localStorage.getItem(LOCAL_KEY + '-statue-who')`), String(await run('statueCtx().slots[1]')));
      await run(`(() => { const s = $('statueWho'); s.value = ''; s.dispatchEvent(new Event('change')); })(); 1`); await sleep(200);
      assert.equal(await run('statuesWho'), null);
      assert.equal(await run(`document.querySelector('[data-potential="29"] .st-eff-val').textContent`), await run('statueEffectText(29, statueEffect(29, 12, 0).value)'));
      assert.match(await run(`document.querySelector('[data-statue="29"] .st-eff-val').textContent`), /^\+[\d.,]+[KMBTQ]?% statue bonus$/);
    });
    await test('the bar: what is in, then what the statues held are worth, the numbers inside; the box buys flair first, and goals count it too', async () => {
      await run(`statuesFlairFirst = false; statuesPainted = ''; paintStatues(); 1`);
      const bar = () => run(`(b => [b.querySelector('.st-bar-text').textContent, parseFloat(b.querySelector('.st-fill').style.width), parseFloat(b.querySelector('.st-stock').style.width)])(document.querySelector('[data-statue="31"] .st-bar'))`);
      const off = await bar(), s = await run('(s => [s.progress, s.next, s.held, s.expMulti])(statueByIndex(31))');
      assert.equal(off[0], await run(`fmtNum(${s[0]}) + ' / ' + fmtNum(${s[1]})`));
      assert.ok(Math.abs(off[1] - s[0] / s[1] * 100) < 0.01, String(off));
      assert.ok(Math.abs(off[2] - Math.min(s[2] * s[3] / s[1], 1 - s[0] / s[1]) * 100) < 0.01, String(off));
      // Dragon: 300 marbles buy flair 1, so each held counts 7 with the box ticked
      const goalOff = await run('statuesToLevel(29, 20)');
      await h.click('#statueFlairFirst'); await sleep(200);
      assert.equal(await run('statuesFlairFirst'), true);
      assert.equal(await run('statuesToLevel(29, 20)'), Math.ceil(goalOff / 7), 'the goal counts statues at 7 each');
      assert.equal(await run(`document.querySelector('[data-statue="29"] .st-held').textContent`), 'worth 280'); // 40 at 7 each
      assert.match(await run(`document.querySelector('[data-statue="29"] .st-heldcell').title`), / with flair 1 bought first$/);
      assert.equal(await run(`document.querySelector('[data-statue="29"] .st-needcell .st-num').textContent`), await run('fmtNum(Math.ceil((statueByIndex(29).next - statueByIndex(29).progress) / 7))'), 'need: statues for the next level at 7 each');
      await h.click('#statueFlairFirst'); await sleep(200);
      assert.equal(await run('statuesToLevel(29, 20)'), goalOff);
    });
    await test('what a statue counts for besides flair: +10% an onyx statue, +25% a zenith one, added, then Skinny 0 Cal doubles (at most 100%)', async () => {
      await run(`statueDepositBonus = window.__deposit; 1`);
      await setup(d => { d.StuG = J([3, 3, 2, 2, 2, 1, 0]); const c = P(d.CauldronInfo); c[4] = { ...(Array.isArray(c[4]) ? Object.fromEntries(c[4].map((v, i) => [i, v])) : c[4]), 6: 0 }; d.CauldronInfo = J(c); }); await h.poll(); await sleep(300);
      const b = await run('statueDepositBonus()');
      assert.deepEqual([b.onyx, b.zenith, b.vial], [5, 2, 0]);
      assert.ok(Math.abs(b.multi - (1 + 0.5 + 0.5)) < 1e-9, JSON.stringify(b)); // 5 onyx or better, 2 of them zenith, no vial
      await setup(d => { d.StuG = J([3, 3, 2, 2, 2, 1, 0]); const c = P(d.CauldronInfo); c[4] = { ...(Array.isArray(c[4]) ? Object.fromEntries(c[4].map((v, i) => [i, v])) : c[4]), 6: 13 }; d.CauldronInfo = J(c); }); await h.poll(); await sleep(300);
      const v = await run('statueDepositBonus()'), want = await run('scGrowth("add", 13, 2.5, 0) * scVials(statueCtx())');
      assert.ok(Math.abs(v.vial - want) < 1e-9 && Math.abs(v.multi - 2 * (1 + Math.min(want, 100) / 100)) < 1e-9, JSON.stringify(v));
      assert.ok(Math.abs(await run('statueByIndex(0).expMulti') - (1 + 2 * (600 + 100) / 100) * v.multi) < 1e-9, 'flair × the rest');
    });
    await test('a statue goal goes by the statue’s drops: a character on a monster that drops it is working on it, and goals made before that get the source', async () => {
      // an earlier test typed a rate into this one: as a goal made before sources, it has none
      await run(`(t => { delete t.source; delete t.chance; delete t.monster; delete t.perHour; settleStatueGoals(); })(tasks.find(x => x.statueIndex === 29)); 1`);
      const t0 = await run(`(t => ({ source: t.source, chance: t.chance, monster: t.monster }))(tasks.find(x => x.statueIndex === 29))`);
      assert.deepEqual(t0, { source: 'monster', chance: 0.00001, monster: 'caveC' });
      const slot = await run('rows.find(r => r.slot != null).slot');
      await h.setActivity(slot, 'caveC', { mapIdx: 216 }); await sleep(300);
      assert.ok(await run(`(teamOf(tasks.find(x => x.statueIndex === 29)) || []).some(r => r.slot === ${slot})`), 'on Ancient Golems: in the team');
      await run(`(t => { delete t.source; delete t.chance; delete t.monster; settleStatueGoals(); })(tasks.find(x => x.statueIndex === 29)); 1`);
      assert.equal(await run(`tasks.find(x => x.statueIndex === 29).chance`), 0.00001, 'filled in');
      assert.deepEqual(await run(`statueDropSource(0).source`), 'monster');
    });
    await test('a click on a statue opens it in the item finder, with its collection tasks, and an amount or level goal can be made there', async () => {
      await run(`showTab('statues'); 1`); await sleep(300);
      const name = await run('itemName(statueRaw(29))');
      await h.click('[data-statue="29"] .st-art'); await sleep(300);
      assert.equal(await run(`$('viewFinder').hidden`), false, 'the finder is showing');
      assert.equal(await run(`$('finderInput').value`), name);
      const goalId = await run(`tasks.find(x => x.statueIndex === 29).id`);
      assert.ok(await run(`!!document.querySelector('#finderResult .finder-task[data-task="${goalId}"]')`), 'the level goal is listed');
      const forms = await run(`[...document.querySelectorAll('#finderResult .finder-make .label')].map(x => x.textContent)`);
      assert.deepEqual(forms, ['Collect', 'Raise to level']);
      // a click inside the goal box doesn't leave the statues page
      await run(`showTab('statues'); 1`); await sleep(300);
      await h.click('[data-statue="29"] .st-goal input'); await sleep(200);
      assert.equal(await run(`$('viewStatues').hidden`), false);
      await run(`document.activeElement.blur(); openInFinder(${JSON.stringify(name)}); 1`); await sleep(300);
      await run(`(f => { f.querySelector('input').value = '5000'; f.requestSubmit(); })(document.querySelector('#finderResult .finder-make')); 1`); await sleep(300);
      const t = await run(`(t => t && { amount: t.amount, source: t.source, statue: !!t.statueTo })(tasks.find(x => x.key === taskKey({ type: 'item', itemName: ${JSON.stringify(name)} })))`);
      assert.deepEqual(t, { amount: '5K', source: 'monster', statue: false }, 'an amount task from where it drops');
      assert.equal(await run(`document.querySelectorAll('#finderResult .finder-task').length`), 2, 'both listed');
      assert.equal(await run(`document.querySelector('#finderResult .finder-make button').textContent`), 'Change');
    });
    await test('statues and golden food come in bundles: the 2x drop size from the save, then what claims measured', async () => {
      const size = await run(`(() => { const sp = kpkParse(saveForFinder.data.Spelunk) || [], b = kpkParse(saveForFinder.data.BundlesReceived) || {}; return Math.round(2 + (100 * (+((sp[18] || [])[2]) || 0) + (+((sp[5] || [])[48]) || 0)) / 100) * (+b.bon_k > 0 ? 2 : 1); })()`);
      assert.equal(await run(`bundleSize('statue')`), size);
      await run(`lootNow = { afkPay: {} }; bundleKept.at = 0; 1`);
      assert.deepEqual(await run(`bundleMulti('statue')`), { multi: size, from: 'bundle', claims: 0 }, 'no claim yet: the bundle size');
      // a claim on Ancient Golems: the bag got 14x what the sums give
      const slot = await run(`rows.find(r => r.slot != null).slot`);
      await h.setActivity(slot, 'caveC', { mapIdx: 216 }); await sleep(200);
      await run(`(r => { setRowStat(r, 'kph', '1m'); setRowStat(r, 'dr', '2'); })(rows.find(x => x.slot === ${slot})); 1`);
      const sum = await run(`(() => { bundleOff = true; try { const r = rows.find(x => x.slot === ${slot}); return memberRate({ type: 'item', itemName: 'Dragon Warrior Statue', source: 'monster', chance: 1e-5, monster: 'caveC', afkId: 'caveC', slot: ${slot}, activityKey: 'FIGHTING|Ancient Golem', mapIdx: 216 }, 1e-5, false); } finally { bundleOff = false; } })()`);
      assert.ok(sum > 0, 'the stats give a rate: ' + sum);
      await run(`lootNow = { afkPay: { '${slot}|caveC': { EquipmentStatues30: { gained: ${sum} * 14, ms: 36e5, claims: 1 } } } }; bundleKept.at = 0; 1`);
      const b = await run(`bundleMulti('statue')`);
      assert.ok(Math.abs(b.multi - 14) < 1e-6 && b.from === 'measured' && b.claims === 1, JSON.stringify(b));
      // statues from the rare tables beneath, as on a real account (Spelunky came in at 458x to 3,287x its sums): not measured from, even outnumbering the rest
      const pirate = await run(`rows.find(r => r.slot != null && r.slot !== ${slot}).slot`);
      await h.setActivity(pirate, 'w7b11', { mapIdx: 325 }); await sleep(200);
      await run(`(r => { setRowStat(r, 'kph', '1m'); setRowStat(r, 'dr', '2'); })(rows.find(x => x.slot === ${pirate})); 1`);
      await run(`lootNow = { afkPay: { '${slot}|caveC': { EquipmentStatues30: { gained: ${sum} * 14, ms: 36e5, claims: 1 } }, '${pirate}|w7b11': { EquipmentStatues31: { gained: 5e6, ms: 36e5, claims: 1 }, EquipmentStatues32: { gained: 5e5, ms: 36e5, claims: 1 } } } }; bundleKept.at = 0; 1`);
      assert.ok(await run(`(() => { bundleOff = true; try { return memberRate({ type: 'item', itemName: 'Spelunky Statue', source: 'monster', chance: 8e-7, monster: 'w7b11', afkId: 'w7b11', slot: ${pirate}, activityKey: 'FIGHTING|Pirate Deckhand', mapIdx: 325 }, 8e-7, false) > 0; } finally { bundleOff = false; } })()`), 'the rare statue has a sum, so it would count');
      const kept = await run(`bundleMulti('statue')`);
      assert.ok(Math.abs(kept.multi - 14) < 1e-6 && kept.claims === 1, JSON.stringify(kept));
      const t = `({ type: 'item', itemName: 'Dragon Warrior Statue', source: 'monster', chance: 1e-5, monster: 'caveC', afkId: 'caveC', slot: ${slot}, activityKey: 'FIGHTING|Ancient Golem', mapIdx: 216 })`;
      assert.ok(Math.abs(await run(`memberRate(${t}, 1e-5, false)`) - sum * 14) < sum * 1e-6, 'the sums count each statue 14 times');
      assert.equal((await run(`bundleMulti('gfood')`)).from, 'bundle', 'golden food: its bundle size');
      assert.equal(await run(`bundleOf({ type: 'item', itemName: 'Ancient Golem Card' })`), 1, 'nothing else');
      await run(`lootNow = null; bundleKept.at = 0; 1`);
    });
    await test('a rare table beneath a monster: what claims measured over its sums, per item, else the table’s lowest; a character on something else is not measured from', async () => {
      const slot = await run(`rows.find(r => r.slot != null).slot`), pirate = await run(`rows.find(r => r.slot != null && r.slot !== ${slot}).slot`);
      await h.setActivity(slot, 'caveC', { mapIdx: 216 }); await h.setActivity(pirate, 'w7b11', { mapIdx: 325 }); await sleep(200);
      await run(`[${slot}, ${pirate}].forEach(s => { const r = rows.find(x => x.slot === s); setRowStat(r, 'kph', '100b'); setRowStat(r, 'dr', '2000'); }); 1`); // enough that a claim's past the fewest measured from
      const m = (name, chance, mon = 'w7b11') => `({ type: 'item', itemName: '${name}', source: 'monster', chance: ${chance}, monster: '${mon}', afkId: '${mon}', slot: ${pirate}, activityKey: 'FIGHTING|Pirate Deckhand', mapIdx: 325 })`;
      const raw = (name, chance) => run(`(() => { bundleOff = tableOff = true; try { return memberRate(${m(name, chance)}, ${chance}, false); } finally { bundleOff = tableOff = false; } })()`);
      const spel = await raw('Spelunky Statue', 8e-7), taffy = await raw('Golden Saltwater Taffy', 4e-7), food = await run(`bundleSize('gfood')`), statue = await run(`bundleSize('statue')`);
      assert.ok(spel * 2 >= 20 && taffy * 2 >= 20, 'the stats give sums big enough to measure: ' + spel + ', ' + taffy);
      await run(`lootNow = { afkPay: {} }; bundleKept.at = 0; tableKept.at = 0; 1`);
      assert.equal(await run(`tableMulti('w7b11', 'Spelunky Statue').multi`), 1, 'no claim yet: the sum as it is');
      // the bags got 30x the sum (with its bundle) in Spelunky, 50x in taffy; a character fighting Golems claimed Spelunky at 2x, which isn't measured from
      await run(`lootNow = { afkPay: { '${pirate}|w7b11': { EquipmentStatues31: { gained: ${spel} * ${statue} * 30, ms: 36e5, claims: 1 }, FoodG14: { gained: ${taffy} * ${food} * 50, ms: 36e5, claims: 1 } }, '${slot}|w7b11': { EquipmentStatues31: { gained: ${spel} * ${statue} * 2, ms: 36e5, claims: 1 } } } }; bundleKept.at = 0; tableKept.at = 0; 1`);
      const near = (a, b) => Math.abs(a - b) < b * 1e-6;
      const s = await run(`tableMulti('w7b11', 'Spelunky Statue')`), f = await run(`tableMulti('w7b11', 'Golden Saltwater Taffy')`), reef = await run(`tableMulti('w7b11', 'Reef Coral Statue')`);
      assert.ok(near(s.multi, 30) && s.from === 'item', 'Spelunky: its own ' + JSON.stringify(s));
      assert.ok(near(f.multi, 50) && f.from === 'item', 'taffy: its own ' + JSON.stringify(f));
      assert.ok(near(reef.multi, 30) && reef.from === 'table', 'Reef Coral, never claimed: the table’s lowest ' + JSON.stringify(reef));
      assert.ok(near((await run(`tableMulti('w7c3', 'Spelunky Statue')`)).multi, 30), 'another monster with the same table shares it');
      assert.ok(near(await run(`memberRate(${m('Spelunky Statue', 8e-7)}, 8e-7, false)`), spel * statue * 30), 'the estimate: sum × bundle × table');
      assert.equal(await run(`tableMulti('caveC', 'Dragon Warrior Statue').multi`), 1, 'a drop on the monster’s own list: nothing');
      await run(`lootNow = null; bundleKept.at = 0; tableKept.at = 0; 1`);
    });
    await test('the potential puts in every statue held, and every one still waiting in AFK gains', async () => {
      const slot = await run(`rows.find(r => r.slot != null && r.slot !== activePlayerSlot()).slot`);
      await h.setActivity(slot, 'caveC', { mapIdx: 216, active: false }); await sleep(200);
      await run(`(r => { setRowStat(r, 'kph', '1m'); setRowStat(r, 'dr', '2'); r.afkSince = Date.now() - 36e5; })(rows.find(x => x.slot === ${slot})); lootNow = null; bundleKept.at = 0; 1`);
      const u = await run('statueUnclaimed(29)'), held = await run('statueByIndex(29).held');
      assert.ok(u > 0, 'an hour away on Ancient Golems leaves some to claim: ' + u);
      const pot = await run('(p => p && { all: p.all, unclaimed: p.unclaimed })(statuePotential(statueByIndex(29)))');
      assert.ok(pot && Math.abs(pot.all - (held + u)) < 1e-3 * pot.all && Math.abs(pot.unclaimed - u) < 1e-3 * u, JSON.stringify(pot));
      await run(`showTab('statues'); statuesPainted = ''; paintStatues(); 1`); await sleep(200);
      assert.match(await run(`document.querySelector('[data-potential="29"] .st-effect').textContent`), / still to claim/);
    });
    await test('the week\u2019s merit bonus reaches a statue, and only when statues won the vote', async () => {
      const r = await run(`(() => { const was = printerExtraNow, of = vars => { printerExtraNow = { data: {}, vars }; return statueEffect(0, 10, 0); };
        try { return [of({}), of({ voteCat2: [26] }), of({ voteCat2: [3] }), voteWinners().meritocracy]; } finally { printerExtraNow = was; statueCtxKept = null; } })()`);
      assert.ok(r[1].value > r[0].value, JSON.stringify(r));
      assert.equal(r[2].value, r[0].value, 'another merit: no change');
      assert.equal(r[3], 3);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
