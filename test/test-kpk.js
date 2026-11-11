// Kills per kill: node test-kpk.js [--shots]. Terms are hand-worked from the numbers in full-save.json, written out below.
const assert = require('assert'), { start, sleep } = require('./harness');
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').slice(0, 8).join('\n      ')); } };
const near = (a, b, msg, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), (msg || '') + ': ' + a + ' should be ' + b);
const J = JSON.stringify, decay = (n, x1, x2) => x1 * n / (n + x2), P = v => typeof v === 'string' ? JSON.parse(v) : v;
// From full-save.json, by hand:
const STATUE = 1 + (30 + 3 * (2 - 1)) / 100; // RoyalG[0][2] = 2, armory RoyalG[2][45] = 0
const GLUNKO = 1 + 0.2 * 1; // OptLacc[606] = "174,168" with two tokens owned, so its base bonus of 1
const FISH = decay(38, 10, 100); // Spelunk[11][3] = 38
const FAMILY = decay(1329 - 129, 60, 800); // Player1, Death Bringer, class level 1329
const PRAYER = Math.round(30 + 30 * 49 / 10); // PrayOwned[13] = 50
const EXOTIC = 35 * 49 / 1049; // FarmUpg[76] = 49
const LEGEND = 200 * 2, VAULT = 110; // Spelunk[18][16] = 2, UpgVault[64] = 110
const BUBBA = (1 + 20 * 3 / 100) * Math.ceil((21 - 4) / 7); // Bubba[1][3] = 21, Bubba[1][8] = 9, so megaflesh 1, 3 and 6
const W7_ADD = PRAYER + EXOTIC + LEGEND + BUBBA + VAULT;
const W7_TOTAL = (nobisect, extra = 0) => STATUE * GLUNKO * nobisect * (1 + (FISH + FAMILY) / 100) * (1 + (W7_ADD + extra) / 100);
(async () => {
  const h = await start({ noPoll: true }), run = h.run;
  const term = async (slot, id, at) => run(`killsPerKill(${slot}, null, ${at ? J(at) : 'null'}).terms.find(t => t.id === ${J(id)})`);
  const pick = slot => run(`selectPlayer(${slot}); paintAll(); 1`);
  const st = f => `#plannerTasks input[data-stat="${f}"]`, tb = id => `#plannerTasks [data-kpk-term="${id}"]`;
  const val = s => run(`document.querySelector(${J(s)}).value`), blur = () => run('document.activeElement && document.activeElement.blur(); 1');
  const R = s => `rows.find(r => r.slot === ${s})`;
  try {
    await run(`rows.forEach(r => { delete r.mk; delete r.dr; }); Object.keys(rates).forEach(k => { delete rates[k].mk; delete rates[k].dr; delete rates[k].kph; delete rates[k].kpk; delete rates[k].kpkTotal; }); 1`);
    await h.bump(d => { const sp = typeof d.Spelunk === 'string' ? JSON.parse(d.Spelunk) : d.Spelunk; sp[46] = []; sp[17] = []; sp[54] = []; d.Spelunk = sp; }); // hats, nametags and capes have their own tests; these sums are worked by hand without them
    await test('terms from the save, on map 317', async () => {
      const t = async (slot, id, want) => { const got = await term(slot, id); assert.equal(got.from, 'save', id); near(got.value, want, id); };
      await t(1, 'statue', STATUE); await t(1, 'c168', GLUNKO); await t(1, 'world', FISH); await t(1, 'family', FAMILY);
      await t(1, 'prayer', PRAYER); await t(1, 'exotic', EXOTIC); await t(1, 'legend', LEGEND); await t(1, 'bubba', BUBBA); await t(1, 'vault', VAULT);
      await t(1, 'gear96', 1); await t(1, 'gear103', 1); await t(1, 'charm', 0); await t(1, 'friend', 0); await t(1, 'decimator', 0);
      await t(1, 'nobisect', 2); // Divinity[13] = 2
      await t(8, 'nobisect', 2); // Polytheism: SL_8[505] = 92, and 29 gods unlocked
      await t(9, 'prayer', 0); // Prayers_9 has no 13
      await t(10, 'decimator', decay(334, 100, 50)); // SL_10[109] = 334
      near(await run('killsPerKill(1).value'), W7_TOTAL(2), 'whole of slot 1');
      near(await run('killsPerKill(9).value'), STATUE * GLUNKO * (1 + (FISH + FAMILY) / 100) * (1 + (W7_ADD - PRAYER) / 100), 'whole of slot 9');
    });
    await test('what the save can\'t give is missing and neutral, and says what to find', async () => {
      for (const [id, neutral] of [['lab', 1], ['c14', 1], ['c29', 1], ['c154', 1], ['vote', 0], ['mk', 0]]) {
        const got = await term(1, id);
        assert.equal(got.from, 'missing', id); assert.equal(got.value, neutral, id); assert.ok(got.hint, id + ' says what to find');
      }
      assert.equal((await term(4, 'nobisect')).from, 'missing', 'Divinity[16] = 8, and King Doot isn\'t in the save');
      assert.equal((await term(1, 'bubble')).from, 'missing', 'a18 isn\'t equipped, and Sheepie isn\'t in the save');
      assert.match((await term(1, 'bubble')).hint, /63\.7%/, 'a18 at level 409: 70 x 409 / 449');
      const groups = await run(`killsPerKill(1).terms.map(t => t.group)`);
      assert.ok(groups.every(g => g === 'multiply' || g === 'add'));
    });
    await test('map bands: stat talents and the world gear band', async () => {
      const wis = decay(334, 40, 100) * 3789357 / 1e3; // SL_4[531] = 334, WIS from PVStatList_4
      near((await term(4, 'talentWis', { slot: 4, activityKey: 'x', mapIdx: 205 })).value, wis, 'on before World 7');
      assert.equal((await term(4, 'talentWis', { slot: 4, activityKey: 'x', mapIdx: 300 })).value, 0, 'off from map 300');
      near((await term(4, 'talentWis', { slot: 4, activityKey: 'x', mapIdx: 299 })).value, wis, 'on at 299');
      const str = decay(334, 40, 100) * 1915988 / 1e3; // slot 10: SL[141] = 334, STR
      near((await term(10, 'talentStr', { slot: 10, activityKey: 'x', mapIdx: 100 })).value, str);
      const agi = decay(338, 40, 100) * 4007009 / 1e3; // slot 2: SL[366] = 338, AGI
      near((await term(2, 'talentAgi', { slot: 2, activityKey: 'x', mapIdx: 49 })).value, agi);
      assert.equal((await term(4, 'world', { slot: 4, activityKey: 'x', mapIdx: 350 })).value, 0, 'no band from 350');
      assert.equal((await term(4, 'world', { slot: 4, activityKey: 'x', mapIdx: 20 })).value, 0, 'no band below 50');
    });
    await test('gear, charm, friend, bubble, pocket god: changing the save moves them', async () => {
      const kept = {};
      for (const k of ['EquipOrder_2', 'EMm0_2', 'Ninja', 'OptLacc', 'CauldronBubbles', 'Holes']) kept[k] = JSON.parse(JSON.stringify(h.save[k]));
      await h.bump(d => {
        const eq = P(d.EquipOrder_2); eq[0] = { ...eq[0], 15: 'EquipmentGown8', 5: 'EquipmentRings36', 7: 'EquipmentRings34', 14: 'EquipmentNametag27', 12: 'EquipmentCape19' }; d.EquipOrder_2 = JSON.stringify(eq);
        const st = P(d.EMm0_2); st[15] = { ...(st[15] || {}), UQ1val: 10 }; d.EMm0_2 = JSON.stringify(st);
        const n = P(d.Ninja); n[107] = [...n[107]]; n[107][6] = 1; d.Ninja = JSON.stringify(n);
        const o = P(d.OptLacc); o[476] = '6,12000,Neet'; d.OptLacc = JSON.stringify(o);
        const b = P(d.CauldronBubbles); b[2] = [...b[2], 'a18']; d.CauldronBubbles = JSON.stringify(b);
        const dv = P(d.Holes); dv[11] = [...dv[11]]; dv[11][30] = 2; d.Holes = JSON.stringify(dv);
      });
      near((await term(2, 'gear96')).value, 1 + (250 + 10) / 100, 'Arctic Furcoat and a stone; the nametag is left to the Gallery');
      near((await term(2, 'gear103')).value, 1, 'the worn cape is left to the Cape Vine');
      const ringStone = +(P(kept.EMm0_2)[7] || {}).UQ1val || 0;
      near((await term(2, 'world', { slot: 2, activityKey: 'x', mapIdx: 210 })).value, 30 + ringStone, 'a Killer Ring for this world counts, with its stone');
      near((await term(2, 'world', { slot: 2, activityKey: 'x', mapIdx: 110 })).value, 0, 'and not for another');
      near((await term(2, 'charm')).value, 25);
      near((await term(2, 'friend')).value, 10 * (0.25 + 0.5 * 1.5), 'friend level 12000');
      near((await term(2, 'bubble')).value, 70 * 409 / 449, 'now equipped');
      assert.equal((await term(2, 'bubble')).from, 'save');
      assert.equal((await term(5, 'nobisect')).value, 2, 'a pocket god gives it to everyone: the second spot, with two unlocked');
      await h.bump(d => Object.assign(d, kept));
      near(await run('killsPerKill(1).value'), W7_TOTAL(2), 'all back');
    });
    await test('a typed term replaces the save\'s; blank goes back', async () => {
      await pick(1);
      await run(`document.querySelector('.kpk-disclose').open = true; 1`);
      const home = await run(`(selectedRow().slot + '|' + selectedRow().activityKey)`);
      const base = await run('killsPerKill(1).value');
      await h.type(tb('lab'), '2');
      near(await run('killsPerKill(1).value'), base * 2, 'a missing one');
      assert.equal((await term(1, 'lab')).from, 'typed');
      assert.equal(await run(`rates.account.kpk.lab`), '2');
      const gear = (await term(1, 'gear96')).value;
      await h.type(tb('gear96'), '1.5');
      near(await run('killsPerKill(1).value'), base * 2 * 1.5 / gear, 'one the save only has part of');
      await h.type(tb('friend'), '1k');
      near((await term(1, 'friend')).value, 1000, 'parseNum');
      await h.type(tb('friend'), '');
      assert.equal((await term(1, 'friend')).from, 'save');
      await h.type(tb('gear96'), '');
      // one the app has whole has no box, and nothing typed earlier can change it
      assert.equal(await run(`document.querySelector(${J(tb('statue'))}).hidden`), true);
      const clean = await run('killsPerKill(1).value');
      await run(`kpkTermSet(${J(home)}, 'statue', '50'); 1`);
      near(await run('killsPerKill(1).value'), clean, 'an old typed number is ignored');
      assert.equal((await term(1, 'statue')).from, 'save');
      await run(`kpkTermSet(${J(home)}, 'statue', ''); 1`);
      await h.type(tb('lab'), 'abc');
      assert.equal((await term(1, 'lab')).from, 'missing', 'not a number counts as blank');
      assert.equal(await run(`document.querySelector(${J(tb('lab'))}).getAttribute('aria-invalid')`), 'true');
      await h.type(tb('lab'), '0');
      assert.equal((await term(1, 'lab')).from, 'missing', 'a zero multiplier would divide by nothing');
      await h.type(tb('lab'), '');
      await blur();
      near(await run('killsPerKill(1).value'), base, 'all back');
      assert.equal(await run(`rates[${J(home)}] && rates[${J(home)}].kpk`), null, 'nothing left behind');
    });
    await test('multikill: the typed percent is the term; its own box overrides until the Multikill box is typed in', async () => {
      await pick(1);
      await h.type(st('mk'), '892');
      await blur();
      let got = await term(1, 'mk');
      assert.equal(got.from, 'typed'); assert.equal(got.value, 892);
      near(await run('killsPerKill(1).value'), W7_TOTAL(2, 892));
      await h.type(tb('mk'), '100');
      await blur();
      assert.equal((await term(1, 'mk')).value, 100);
      await h.type(st('mk'), '900');
      await blur();
      assert.equal((await term(1, 'mk')).value, 900, 'the newer number');
      assert.equal(await run(`(rates[(selectedRow().slot + '|' + selectedRow().activityKey)].kpk || {}).mk ?? null`), null);
      assert.equal(await val(tb('mk')), '', 'its box is empty again');
      await h.type(st('mk'), '');
      await blur();
      assert.equal((await term(1, 'mk')).from, 'missing');
    });
    await test('the total box wins; blank goes back; its placeholder is the worked value cut to three digits', async () => {
      await pick(1);
      const worked = W7_TOTAL(2);
      near(worked, 35.14, 'by hand', 1e-2);
      assert.equal(await run(`document.querySelector(${J(st('kpkTotal'))}).placeholder`), String(Math.floor(worked * 10) / 10), 'cut');
      await h.type(st('mk'), '100k');
      await blur();
      const ph = await run(`document.querySelector(${J(st('kpkTotal'))}).placeholder`), big = W7_TOTAL(2, 1e5);
      assert.equal(ph, Math.floor(big / 1e3 * 100) / 100 + 'K', 'cut, in thousands: ' + big);
      await h.type(st('mk'), '');
      await h.type(st('kpkTotal'), '12k');
      await blur();
      assert.equal(await run('killsPerKill(1).value'), 12000);
      near(await run('killsPerKill(1).worked'), worked, 'the working stays visible');
      assert.equal(await run(`rates[(selectedRow().slot + '|' + selectedRow().activityKey)].kpkTotal`), '12k');
      await h.type(st('kpkTotal'), '');
      await blur();
      near(await run('killsPerKill(1).value'), worked);
    });
    await test('rate changes in the panel and the editor; crystals don\'t divide', async () => {
      await pick(7);
      await run(`lootNow = null; refreshLootNow = async () => {}; 1`);
      await run(`window.__rowsKept = JSON.stringify(rows); rows.filter(r => r.slot !== 7 && r.monster === rows.find(x => x.slot === 7).monster).forEach(r => { r.monster = ''; r.kind = 'exp'; }); 1`); // only 7 on the card, so its rate is 7's
      const card = await run(`(tasks.find(t => t.type === 'card' && t.monster === rows.find(r => r.slot === 7).monster && taskSection(t) === 'active') || {}).id`);
      assert.ok(card, 'an active card');
      await h.type(st('kph'), '60.5m');
      await h.type(st('dr'), '1615');
      await h.type(st('mk'), '892');
      await blur();
      const chance = await run(`tasks.find(t => t.id === ${J(card)}).chance`), per = await run('killsPerKill(7).value');
      near(per, W7_TOTAL(1, 892));
      const rate = 60.5e6 / per * chance * 1615;
      near(await run(`taskRate(tasks.find(t => t.id === ${J(card)})).rate`), rate, 'card rate');
      await run('panelOpen.more = true; paintAll(); 1'); // an unstarred card nobody is playing folds into More
      const panel = () => run(`(t => { const c = [...document.querySelectorAll('.pc')].find(n => n.textContent.includes(taskTitle(t))); return c ? c.querySelector('.pc-bar-text').textContent : null; })(tasks.find(t => t.id === ${J(card)}))`);
      assert.equal(await run(`document.querySelector('#plannerTasks [data-d="real"] b').textContent`), await run(`fmtRate(${60.5e6 / per}) + '/h'`), 'real kills on the activity');
      const panelBefore = await panel();
      assert.ok(panelBefore, 'the panel shows the card');
      await h.type(st('kpkTotal'), String(per * 100));
      await blur();
      await run('paintAll(); 1');
      near(await run(`taskRate(tasks.find(t => t.id === ${J(card)})).rate`), rate / 100, 'the box moved the rate');
      assert.notEqual(await panel(), panelBefore, 'panel');
      await h.type(st('kpkTotal'), '');
      await blur();
      const item = await run(`(() => { const c = DROPS.Crystal6[0]; return { name: c[0], chance: c[1] }; })()`);
      const crystal = `({ slot: 7, type: 'item', itemName: ${J(item.name)}, monster: 'Crystal6', match: { kind: 'world', world: 6 }, source: 'crystal', chance: ${item.chance} })`;
      await run(`statSet(${crystal}, 'kph', '500'); 1`);
      near(await run(`memberRate(${crystal}, ${item.chance})`), 500 * item.chance * 1615, 'crystals per hour, no division');
      await run(`rows.splice(0, rows.length, ...JSON.parse(window.__rowsKept)); 1`);
    });
    await test('Loot rates Real kills line divides by kills per kill', async () => {
      await pick(7);
      const per = await run('killsPerKill(7).value');
      await run(`window.__refreshLoot = refreshLoot; refreshLoot = async () => {}; showTab('loot'); paintLoot({ active: { slot: 7, afkId: 'w7b9', mapIdx: 323, at: Date.now(), ms: 36e5, items: [{ item: 'kills', gained: 1e9, ms: 36e5, count: 0 }] }, goals: {} }); 1`);
      const line = await run(`$('lootResult').textContent`);
      assert.ok(line.includes('Real kills: ' + await run(`fmtRate(${1e9 / per})`) + ' / hour'), line.slice(0, 300));
      await run(`refreshLoot = window.__refreshLoot; showTab('planner'); 1`);
    });
    await test('team rates: each member\'s own', async () => {
      await h.bump(d => { const c = P(d.Cards0); c.mushG = 8; d.Cards0 = JSON.stringify(c); });
      for (const s of [3, 5]) await h.setActivity(s, 'mushG', { mapIdx: 1, active: false });
      await run(`lootNow = null; ['kph', 'dr'].forEach(f => { setRowStat(${R(3)}, f, f === 'kph' ? '1m' : '2'); setRowStat(${R(5)}, f, f === 'kph' ? '3m' : '1'); }); 1`);
      await run(`setRowStat(${R(3)}, 'kpkTotal', '100'); 1`); // 1m / 100 x 0.002 x 2 = 40
      const per5 = await run('killsPerKill(5).value');
      const card = `tasks.find(t => t.key === 'card|mushG')`; // the account's
      near(await run(`taskRate(${card}).rate`), 40 + 3e6 / per5 * 0.002, 'one typed, one from the save');
      assert.equal(await run(`taskRate(${card}).team.counted`), 2);
      await run(`setRowStat(${R(5)}, 'kpkTotal', '50'); 1`); // 3m / 50 x 0.002 x 1 = 120
      near(await run(`taskRate(${card}).rate`), 160, 'both typed');
    });
    await test('Simulate: a card as the selected player has it; the draft moves the numbers and writes nothing; Reset drops it', async () => {
      const id = await run(`tasks.find(t => t.key === 'card|mushG').id`);
      await pick(3); // the account's card, drafted as player 3 has it
      await run(`showTab('simulate'); simulateTask(${J(id)}); 1`);
      const box = '#simEditor [data-field="kpkTotal"]';
      assert.ok(await run(`!!document.querySelector(${J(box)})`), 'the box is there');
      assert.equal(await run(`document.querySelector(${J(box)}).placeholder`), await run(`fmtRate0(killsPerKill(3, null, cardAsPlayer(tasks.find(t => t.id === ${J(id)}), rows.find(r => r.slot === 3))).worked)`));
      const before = await run('JSON.stringify(rates)'), rate = await run(`taskRate(tasks.find(t => t.id === ${J(id)})).rate`);
      await h.type(box, '1000'); // 1m / 1000 x 0.002 x 2 = 4, + slot 5's 120
      await run('paintAll(); 1');
      assert.equal(await run(`simDraft.kpkTotal`), '1000');
      near(await run(`taskCalc(simOwner.statTask, Date.now(), simDraft).rate`), 124, 'the draft');
      near(await run(`taskRate(tasks.find(t => t.id === ${J(id)})).rate`), rate, 'the task as it was');
      assert.equal(await run('JSON.stringify(rates)'), before, 'rates untouched');
      assert.equal(await run(`document.querySelector('#simEditor .s-rate .big').textContent`), '124', 'the editor shows the draft');
      await blur();
      await h.click('#simReset');
      assert.equal(await run(`Object.keys(simDraft).length`), 0);
      await run(`showTab('planner'); 1`);
    });
    await test('the box and the list aren\'t rebuilt by the tick, and typing survives it', async () => {
      await pick(1);
      await run(`document.querySelector('.kpk-disclose').open = true; document.querySelector(${J(tb('lab'))}).__mark = 1; document.querySelector(${J(st('kpkTotal'))}).__mark = 1; 1`);
      await h.click(tb('vote'));
      await run(`document.querySelector(${J(tb('vote'))}).__mark = 1; 1`);
      await run(`document.activeElement.value = '2.'; 1`);
      await sleep(2300);
      const out = await run(`({ lab: document.querySelector(${J(tb('lab'))}).__mark, total: document.querySelector(${J(st('kpkTotal'))}).__mark, vote: document.querySelector(${J(tb('vote'))}).__mark, focus: document.activeElement === document.querySelector(${J(tb('vote'))}), value: document.activeElement.value, open: document.querySelector('.kpk-disclose').open })`);
      assert.deepEqual(out, { lab: 1, total: 1, vote: 1, focus: true, value: '2.', open: true });
      await run(`document.activeElement.value = ''; document.activeElement.blur(); 1`);
    });
    await test('missing terms stand out; only fighters have the list', async () => {
      await pick(1);
      await run(`document.querySelector('.kpk-disclose').open = true; paintAll(); 1`);
      assert.equal(await run(`document.querySelector('[data-term="lab"]').classList.contains('missing')`), true);
      assert.equal(await run(`document.querySelector('[data-term="statue"]').classList.contains('missing')`), false);
      assert.match(await run(`document.querySelector('[data-term="lab"] .kpk-hint').textContent`), /2 if/);
      assert.equal(await run(`document.querySelector('[data-term="lab"] .kpk-value').textContent`), 'Not in the save');
      assert.match(await run(`document.querySelector('.kpk-sum-count').textContent`), /^\d+ not in the save$/);
      await h.setActivity(6, 'Divinity', { mapIdx: 200, active: false });
      await pick(6);
      await run(`renderPlanner(); 1`);
      assert.equal(await run(`!!document.querySelector('.kpk-how')`), false, 'not on Divinity');
      assert.equal(await run(`!!document.querySelector(${J(st('kpkTotal'))})`), false);
    });
    await test('it survives a reload', async () => {
      await pick(1);
      await h.type(tb('lab'), '2');
      await h.type(st('kpkTotal'), '999');
      await blur();
      const home = await run(`selectedRow().slot + '|' + selectedRow().activityKey`), want = await run('killsPerKill(1).worked');
      const saved = await h.savedSheet();
      assert.equal(saved.rates.account.kpk.lab, '2', 'in the sheet');
      assert.equal(saved.rates[home].kpkTotal, '999');
      await h.reload();
      await pick(1);
      assert.equal(await run('killsPerKill(1).value'), 999);
      near(await run('killsPerKill(1).worked'), want);
      assert.equal(await val(tb('lab')), '2', 'the box has it');
      assert.equal(await val(st('kpkTotal')), '999');
      await h.type(st('kpkTotal'), '');
      await h.type(tb('lab'), '');
      await blur();
    });
    await test('no sideways overflow at 400, with the list open', async () => {
      await pick(1);
      await h.setSize(400, 1400);
      await run(`document.querySelector('.kpk-disclose').open = true; paintAll(); 1`);
      await sleep(100);
      const out = await run(`(() => {
        const box = document.querySelector('.act-pane'), lim = box.getBoundingClientRect();
        const bad = [...box.querySelectorAll('*')].filter(n => { const b = n.getBoundingClientRect(); return b.width && (b.right > lim.right + .5 || b.left < lim.left - .5); }).map(n => n.className || n.tagName);
        return { bad, page: document.documentElement.scrollWidth - innerWidth, inputs: [...box.querySelectorAll('.kpk-row [data-kpk-term]:not([hidden])')].map(i => i.getBoundingClientRect().width) };
      })()`);
      assert.deepEqual(out.bad, []);
      assert.ok(out.page <= 0, 'page ' + out.page);
      assert.ok(out.inputs.every(w => w >= 70), 'inputs usable: ' + out.inputs);
      if (process.argv.includes('--shots')) {
        await run(`document.querySelector('.act-pane').scrollIntoView({ block: 'start' }); 1`);
        await h.shot('kpk-400.png', 400, 1400);
        await h.setSize(1500, 1200);
        await run(`document.querySelector('.act-pane').scrollIntoView({ block: 'start' }); 1`);
        await h.shot('kpk-wide.png', 1500, 1200);
      }
      await h.setSize(1500, 900);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally {
    await h.close();
  }
  const old = await start({ noPoll: true, oldFields: true, build: false }), o = old.run;
  try {
    await test('a save without the fields: multikill only, and it says so', async () => {
      await o(`Object.keys(rates).forEach(k => { delete rates[k].kpk; delete rates[k].kpkTotal; }); selectPlayer(1); document.querySelector('.kpk-disclose').open = true; paintAll(); 1`);
      await old.type('#plannerTasks input[data-stat="mk"]', '892');
      await o('document.activeElement.blur(); paintAll(); 1');
      const c = await o(`(c => ({ value: c.value, fallback: c.fallback, from: c.terms.filter(t => t.id !== 'mk').map(t => t.from) }))(killsPerKill(1))`);
      assert.equal(c.fallback, true);
      near(c.value, 1 + 892 / 100, '1 + mk / 100');
      assert.ok(c.from.every(f => f === 'missing'));
      const note = await o(`(n => n.hidden ? '' : n.textContent)(document.querySelector('.kpk-note'))`);
      assert.match(note, /restart/);
      assert.equal(await o(`document.querySelector('#plannerTasks input[data-stat="kpkTotal"]').placeholder`), await o(`fmtRate(${1 + 892 / 100})`));
      await old.type('#plannerTasks input[data-stat="kpkTotal"]', '500');
      await o('document.activeElement.blur(); 1');
      assert.equal(await o('killsPerKill(1).value'), 500, 'a typed total still wins');
      await old.type('#plannerTasks input[data-stat="kpkTotal"]', '');
      await old.type('#plannerTasks [data-kpk-term="lab"]', '2');
      await o('document.activeElement.blur(); 1');
      near(await o('killsPerKill(1).value'), 2 * (1 + 892 / 100), 'typed terms still count');
    });
    await test('no page errors without the fields', async () => assert.deepEqual(old.pageErrors(), []));
  } finally {
    await old.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})().catch(e => { console.error(e); process.exit(2); });
