// Core agent's tests: node test-core.js. Fake backend, private temp data, headless Chrome.
const assert = require('assert'), fs = require('fs'), path = require('path'), { start, sleep } = require('./harness');
const near = (a, b, msg, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), (msg || '') + ': ' + a + ' vs ' + b);
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('  ok  ' + name); };
const raw = fs.readFileSync(path.join(__dirname, 'testdata', 'sheet.json'), 'utf8'), sheet = JSON.parse(raw);
(async () => {
  const h = await start({ noPoll: true, oldFields: true });
  const run = h.run, T = (slot, type, rest = '') => `tasks.find(t => t.key === ${JSON.stringify(type === 'item' || type === 'card' ? type + '|' + rest : slot + '|' + type + (rest ? '|' + rest : ''))})`; // items and cards are the account's
  const noDups = async () => { const keys = await run('tasks.map(t => t.key)'); assert.equal(new Set(keys).size, keys.length, 'duplicate keys: ' + keys.filter((k, i) => keys.indexOf(k) !== i)); };
  const P = v => typeof v === 'string' ? JSON.parse(v) : v;
  try {
    /* ----- migration, from the sheet as it is on disk, before any save changes it ----- */
    await run(`tasks = []; setState(${raw}); 1`);
    let list = await run('tasks'), homes = await run('rates');
    const stat = (t, f) => `statGet(${t}, ${JSON.stringify(f)})`;
    await test('migration keeps every typed number', () => {
      const has = (r, f, value, key) => {
        const mine = list.filter(t => t.slot === r.slot), box = homes[r.slot + '|' + key] || {};
        if (f === 'cxph' || f === 'xph') return box.xph === value; // a class's EXP/hr is its activity's
        if (f === 'kph') return box.kph === value;
        if (f === 'classGoal') return mine.some(t => t.type === 'class' && t.goal === value);
        return mine.some(t => t[f] === value);
      };
      let checked = 0;
      sheet.rows.forEach(r => {
        ['kph', 'xph', 'left', 'goal', 'kpc', 'cxph', 'classGoal'].forEach(f => {
          if (!r[f] || (f === 'left' && r.leftAuto)) return; // an auto count may already be the game's newer one
          checked++;
          assert.ok(has(r, f, r[f], r.activityKey), r.name + ' row ' + f + ' ' + r[f]);
        });
        Object.entries(r.memo || {}).forEach(([key, m]) => {
          if (key.startsWith('goal:')) { checked++; assert.ok(has(r, 'goal', m), r.name + ' ' + key + ' ' + m); return; }
          ['kph', 'xph', 'left', 'kpc', 'cxph'].forEach(f => {
            if (!m[f]) return;
            if (key === r.activityKey && r[f] && r[f] !== m[f]) return; // the row's own newer number won
            checked++;
            assert.ok(has(r, f, m[f], key), r.name + ' memo ' + key + ' ' + f + ' ' + m[f]);
          });
          if (m.rare) assert.ok(list.some(t => t.slot == null && t.type === 'item' && t.itemName === m.rare), r.name + ' rare');
        });
        if (r.rare) assert.ok(list.some(t => t.slot == null && t.type === 'item' && t.itemName === r.rare && t.amount === ''), r.name + ' current rare');
      });
      assert.ok(checked > 40, 'checked only ' + checked);
      assert.deepEqual(list.filter(t => 'kph' in t || 'xph' in t || 'xphBy' in t).map(t => t.key), [], 'no rate left on a task');
    });
    await test('no memo with nothing typed makes a task; memo tasks get their monster by name', () => {
      const t = list.find(x => x.key === '1|clear|FIGHTING|Pirate Underling');
      assert.equal(homes['1|FIGHTING|Pirate Underling'].kph, '66.1M'); assert.equal(t.afkId, 'w7b3'); assert.equal(t.mapIdx, 317, 'slot 1 is on this map in the fake save, so its task is active and has it');
      const skill = list.find(x => x.key === '1|skill|19'); assert.equal(skill.goal, '394'); assert.equal(homes['1|SPELUNKING|Burned Tunnel'].xph, '326T'); assert.equal(skill.activityKey, 'SPELUNKING|Burned Tunnel');
      assert.equal(homes['7|FIGHTING|Ancientfish'].xph, '5.13e30', 'class EXP goes with its activity');
      assert.equal(list.find(x => x.key === '5|skill|19').left, '91499027892464');
      assert.equal(list.find(x => x.key === '4|clear|FIGHTING|Stiltmole').kpc, '28');
    });
    await noDups();

    /* ----- back to following the game ----- */
    await h.poll();
    await noDups();
    await test('the active character is the newest AFK start', async () => {
      await h.setActivity(7, 'w7b3', { mapIdx: 317, portalLeft: 5e6 });
      assert.equal(await run('activePlayerSlot()'), 7);
      assert.equal(await run('selectedSlot()'), 7);
    });
    await test('auto clear and card tasks appear for fighters', async () => {
      const t = await run(T(7, 'clear', 'FIGHTING|Pirate Underling'));
      assert.ok(t && t.auto && t.afkId === 'w7b3' && t.mapIdx === 317, JSON.stringify(t));
      assert.equal(t.left, '5M'); assert.equal(t.leftAuto, true); assert.equal(t.leftExact, 5e6);
      assert.equal(await run(`taskSection(${T(7, 'clear', 'FIGHTING|Pirate Underling')})`), 'active');
      const c = await run(T(7, 'card', 'w7b3'));
      assert.ok(c && c.auto, 'card task'); assert.equal(c.chance, 0.000005);
    });
    await test('no task for idle, exp task for Laboratory, skill for mining', async () => {
      const n = await run('tasks.filter(t => t.slot === 9).length');
      await h.setActivity(9, 'Nothing', { active: false });
      assert.equal(await run('tasks.filter(t => t.slot === 9).length'), n);
      assert.equal(await run('tasks.filter(t => t.slot === 9 && taskIsActive(t)).length'), 0);
      await h.setActivity(9, 'Laboratory', { active: false });
      assert.ok(await run(T(9, 'exp', 'LABORATORY|Laboratory')));
      assert.equal(await run(`taskSection(${T(9, 'exp', 'LABORATORY|Laboratory')})`), 'active');
      await h.setActivity(9, 'Prehistrium', { active: false });
      const s = await run(T(9, 'skill', '1'));
      assert.ok(s && s.auto && s.match.key === 'MINING|Prehistrium', JSON.stringify(s));
    });

    /* ----- numbers, worked by hand ----- */
    await test('taskCalc: clear', async () => {
      await run(`(() => { const t = ${T(7, 'clear', 'FIGHTING|Pirate Underling')}; t.startValue = 5e6; taskEdit(t, 'kph', '1m'); taskEdit(t, 'kpc', '100'); })()`); // the sheet had seen a bigger count on this monster
      // counting runs from when the game's count was taken: the AFK start, or the last save while it's being played
      const since = await run(`taskView(${T(7, 'clear', 'FIGHTING|Pirate Underling')}).startedAt`);
      const c = await run(`taskCalc(${T(7, 'clear', 'FIGHTING|Pirate Underling')}, ${since + 36e5})`);
      near(c.left, 4e6, 'left'); near(c.hours, 4, 'hours'); assert.equal(c.clears, 40000); near(c.pct, 0.2, 'pct'); assert.equal(c.rate, 1e6);
      assert.equal(c.rateSource, 'typed'); assert.equal(c.active, true); assert.equal(c.done, false); near(c.etaMs, since + 5 * 36e5, 'eta');
      const done = await run(`taskCalc(${T(7, 'clear', 'FIGHTING|Pirate Underling')}, ${since + 6 * 36e5})`);
      assert.equal(done.done, true); assert.equal(done.hours, 0);
    });
    await test('taskCalc: card (next rank, then a typed rank)', async () => {
      await h.bump(d => { const c = P(d.Cards0); c.w7b3 = 1e6; d.Cards0 = JSON.stringify(c); });
      await run(`lootNow = null; rows.find(r => r.slot === 7).dr = '5'; rows.find(r => r.slot === 7).mk = '100'; window.rowsBefore = JSON.stringify(rows); rows.filter(r => r.slot !== 7).forEach(r => { r.monster = ''; r.kind = 'exp'; }); 1`); // the formula, by hand, so nothing measured, and only 7 on it
      await run(`setRowStat(rows.find(r => r.slot === 7), 'kph', '100m'); setRowStat(rows.find(r => r.slot === 7), 'mk', '100'); 1`); // multikill is the map's, so it's typed on the activity
      const at = h.savedAt();
      // tier 500k: rank 2 past 500k, rank 3 past 2m, rank 4 past 4.5m. 100m / 2 x 0.000005 x 5 = 1250 / hour.
      assert.equal(await run('cardNeed("w7b3", 2)'), 5e5); assert.equal(await run('cardNeed("w7b3", 3)'), 2e6); assert.equal(await run('cardNeed("w7b3", 4)'), 4.5e6);
      let c = await run(`taskCalc(${T(7, 'card', 'w7b3')}, ${at})`);
      near(c.rate, 1250, 'rate'); assert.equal(c.rateSource, 'estimate'); assert.equal(c.have, 1e6); assert.equal(c.target, 2e6); near(c.hours, 800, 'hours'); near(c.pct, 1 / 3, 'pct'); assert.equal(c.rankNow, 2);
      c = await run(`taskCalc(${T(7, 'card', 'w7b3')}, ${at + 100 * 36e5})`);
      near(c.hours, 700, 'anchored to the save');
      await run(`taskEdit(${T(7, 'card', 'w7b3')}, 'goal', '3'); 1`);
      c = await run(`taskCalc(${T(7, 'card', 'w7b3')}, ${at})`);
      assert.equal(c.target, 4.5e6); near(c.hours, 3.5e6 / 1250, 'hours to rank 4');
      await run(`taskEdit(${T(7, 'card', 'w7b3')}, 'goal', ''); 1`);
      await h.bump(d => { const c = P(d.Cards0); c.w7b3 = 3e6; d.Cards0 = JSON.stringify(c); });
      c = await run(`taskCalc(${T(7, 'card', 'w7b3')}, ${h.savedAt()})`);
      assert.equal(c.target, 4.5e6, 'blank goal rolls forward'); assert.equal(c.rankNow, 3);
      await run(`rows.splice(0, rows.length, ...JSON.parse(window.rowsBefore)); 1`);
    });
    await test('taskCalc: item, counting all the account holds', async () => {
      const name = 'Pirate Emblem I', raws = await run(`rawNamesOf(${JSON.stringify(name)})`);
      assert.ok(raws.length);
      const count = (d, slotOnly) => {
        const inv = s => { const o = P(d['InventoryOrder_' + s]), q = P(d['ItemQTY_' + s]); return o.reduce((sum, x, i) => sum + (raws.includes(x) ? +q[i] || 1 : 0), 0); };
        if (slotOnly != null) return inv(slotOnly);
        return Array.from({ length: 11 }, (_, s) => inv(s)).reduce((a, b) => a + b, 0) + P(d.ChestOrder).reduce((sum, x, i) => sum + (raws.includes(x) ? +P(d.ChestQuantity)[i] || 1 : 0), 0);
      };
      await h.bump(d => {
        const o = P(d.InventoryOrder_7), q = P(d.ItemQTY_7), i = o.indexOf('Blank') >= 0 ? o.indexOf('Blank') : 0;
        o[i] = raws[0]; q[i] = 300; d.InventoryOrder_7 = JSON.stringify(o); d.ItemQTY_7 = JSON.stringify(q);
        const co = P(d.ChestOrder), cq = P(d.ChestQuantity), j = co.indexOf('Blank');
        co[j] = raws[0]; cq[j] = 1000; d.ChestOrder = JSON.stringify(co); d.ChestQuantity = JSON.stringify(cq);
      });
      const all = count(h.save);
      assert.ok(all >= 1300);
      const amount = all + 5000; // the account holds plenty already
      await run(`window.rowsBefore = JSON.stringify(rows); 1`);
      const opts = await run('grindOptions(rows.find(r => r.slot === 7))'), opt = opts.find(o => o.itemName === name);
      assert.ok(opt && opt.chance === 0.001 && opt.source === 'monster', JSON.stringify(opt));
      await run(`upsertTask({ ...taskFromOption(rows.find(r => r.slot === 7), grindOptions(rows.find(r => r.slot === 7)).find(o => o.itemName === ${JSON.stringify(name)})), amount: '${amount}' }); 1`);
      const it = T(7, 'item', name), at = h.savedAt();
      const on = `rows.find(r => r.slot === 7)`;
      await run(`lootNow = null; rows.filter(r => r.slot !== 7).forEach(r => { r.monster = ''; r.kind = 'exp'; }); setRowStat(${on}, 'kph', '500k'); 1`); // the formula, by hand: 500k / 2 (100% multikill) x 2 (a common drop comes for every kill multikill counts) x 0.001 x 5 = 2500 / hour
      let c = await run(`taskCalc(${it}, ${at + 36e5})`);
      assert.equal(c.have, all); near(c.rate, 2500, 'rate'); near(c.hours, 1, 'global, anchored: 2 hours from the save, 1 gone'); near(c.pct, (amount - 2500) / amount, 'pct');
      await run(`${it}.amount = ''; 1`);
      c = await run(`taskCalc(${it}, ${at})`);
      assert.equal(c.hours, null); assert.equal(c.needs, 'Ready to claim: ' + await run(`fmtNum(${Math.floor(c.pending)})`)); near(c.rate, 2500, 'rate only');
      await run(`${it}.amount = '5000'; 1`); // a round one, to read
      assert.equal(await run(`taskTitle(${it})`), 'Collect 5K ' + name);
      await run(`${it}.amount = '3000000'; 1`);
      assert.equal(await run(`taskTitle(${it})`), 'Collect 3M ' + name, 'short, however it was typed');
      await run(`${it}.amount = '${amount}'; 1`);
      await run(`lootNow = null; setRowStat(${on}, 'kph', ''); 1`);
      c = await run(`taskCalc(${it}, ${at})`);
      assert.equal(c.needs, 'Enter AFK stats for who\'s on it'); assert.equal(c.rate, 0);
      await run(`setRowStat(${on}, 'dr', ''); setRowStat(${on}, 'kph', '1m'); 1`);
      const avg = await run(`statGuess(rowStatTask(${on}), 'dr')`), withAvg = (await run(`taskCalc(${it}, ${at})`)).rate;
      await run(`setRowStat(${on}, 'dr', String(${avg})); 1`);
      near(withAvg, (await run(`taskCalc(${it}, ${at})`)).rate, 'no drop rate: the team’s average');
      await run(`setRowStat(${on}, 'dr', '5'); setRowStat(${on}, 'kph', ''); rows.splice(0, rows.length, ...JSON.parse(window.rowsBefore)); 1`);
    });
    await test('taskCalc: skill', async () => {
      const cost = t => (15 + t * t + 15 * t) * Math.pow(1.225 - Math.min(0.18, (0.135 * t) / (t + 50)), t) - 30;
      await h.bump(d => {
        const lv = P(d.Lv0_5).slice(), ex = P(d.Exp0_5).slice(), rq = P(d.ExpReq0_5).slice();
        lv[1] = 100; ex[1] = 0; rq[1] = cost(100);
        d.Lv0_5 = JSON.stringify(lv); d.Exp0_5 = JSON.stringify(ex); d.ExpReq0_5 = JSON.stringify(rq);
        d.AFKtarget_5 = 'Prehistrium'; d.CurrentMap_5 = 305;
      });
      const it = T(5, 'skill', '1'), since = await run('rows.find(r => r.slot === 5).afkSince');
      await run(`taskEdit(${it}, 'xph', '1000'); ${it}.goal = '103'; 1`);
      let c = await run(`taskCalc(${it}, ${since})`);
      const want = cost(100) + cost(101) + cost(102);
      near(c.left, want, 'left'); near(c.hours, want / 1000, 'hours'); assert.equal(c.target, 103); assert.equal(c.level, 100); assert.equal(c.pct, 0);
      await run(`${it}.goal = ''; 1`);
      c = await run(`taskCalc(${it}, ${since})`);
      assert.equal(c.target, 101, 'blank is the next level'); near(c.hours, cost(100) / 1000, 'next level');
      await run(`${it}.goal = '+5'; 1`);
      assert.equal(await run(`taskLockGoal(${it})`), true);
      assert.equal(await run(`${it}.goal`), '105');
      await run(`${it}.goal = '189'; 1`);
    });
    await test('overrides change the answer and not the task', async () => {
      const it = T(7, 'clear', 'FIGHTING|Pirate Underling'), before = await run(`JSON.stringify(${it})`);
      const c = await run(`taskCalc(${it}, Date.now(), { kph: '2m', left: '4m' })`);
      near(c.hours, 2, 'drafted numbers, counted from now'); near(c.left, 4e6, 'left');
      await run(`window.rowsKept = JSON.stringify(rows); rows.filter(r => r.slot !== 7).forEach(r => { r.monster = ''; r.kind = 'exp'; }); 1`); // only 7 on it: the others would count at the team's drop rate
      const d = await run(`taskRate({ ...${T(7, 'card', 'w7b3')}, slot: 7 }, { kph: '100m', dr: '10', mk: '0' })`); // a card as one player has it, which is what the editor drafts on
      await run(`rows.splice(0, rows.length, ...JSON.parse(window.rowsKept)); 1`);
      near(d.rate, 1e8 * 0.000005 * 10, 'drafted dr and mk');
      assert.equal(await run(`JSON.stringify(${it})`), before);
    });

    /* ----- archive and auto-fill ----- */
    await test('a character switching activity sends tasks to archive, and they come back with their numbers', async () => {
      const clear = T(7, 'clear', 'FIGHTING|Pirate Underling'), card = T(7, 'card', 'w7b3'), othersOn = `rows.some(r => r.slot !== 7 && r.monster === 'w7b3' && kindOf(r) === 'kills')`;
      await run(`taskEdit(${clear}, 'kph', '1m'); taskEdit(${clear}, 'kpc', '100'); taskEdit(${clear}, 'left', '3m'); 1`);
      assert.equal(await run(`${clear}.leftAuto`), false);
      await h.setActivity(7, 'Divinity', { mapIdx: 200 });
      assert.equal(await run(`taskSection(${clear})`), 'archive'); assert.equal(await run(`taskSection(${card})`), await run(othersOn) ? 'active' : 'archive', 'the card is the account’s: it stays while anyone’s on it');
      assert.equal((await run(`taskCalc(${clear})`)).active, false);
      assert.equal(await run(`taskView(${clear}).startedAt`), null);
      assert.ok(await run(T(7, 'exp', 'DIVINITY|Divinity')), 'its Divinity task');
      await noDups();
      await h.setActivity(7, 'w7b3', { mapIdx: 317 });
      assert.equal(await run(`taskSection(${clear})`), 'active');
      assert.equal(await run(stat(clear, 'kph')), '1m'); assert.equal(await run(`${clear}.kpc`), '100');
      assert.equal(await run(`${clear}.left`), '3m', 'typed count lasts while the game count stays');
      assert.equal(await run(`${clear}.leftAuto`), false);
      await h.setActivity(7, 'w7b3', { mapIdx: 317, portalLeft: 4e6 });
      assert.equal(await run(`${clear}.left`), '4M', 'the game’s newer count replaces it'); assert.equal(await run(`${clear}.leftAuto`), true);
      assert.equal((await run(`${clear}.startValue`)) >= 5e6, true, 'largest seen');
    });
    await test('AFK stats are shared by every task on the activity, and only those', async () => {
      const clear = T(7, 'clear', 'FIGHTING|Pirate Underling'), card = `({ ...${T(7, 'card', 'w7b3')}, slot: 7 })`; // the card as player 7 has it
      const otherKph = await run(`rates['2|FIGHTING|Pirate Underling'].kph`), elsewhere = await run(`rates['7|FIGHTING|Ancientfish'].kph`);
      assert.ok(otherKph && elsewhere, 'numbers to compare with');
      await run(`taskEdit(${clear}, 'kph', '77m'); 1`);
      assert.equal(await run(`rates['7|FIGHTING|Pirate Underling'].kph`), '77m');
      assert.equal(await run(stat(card, 'kph')), '77m', 'the card reads it');
      assert.equal(await run(`taskView(${card}).kph`), '77m');
      assert.equal(await run(`'kph' in ${clear} || 'kph' in ${card}`), false, 'neither task holds it');
      assert.equal(await run(`rates['2|FIGHTING|Pirate Underling'].kph`), otherKph, 'another player');
      assert.equal(await run(`rates['7|FIGHTING|Ancientfish'].kph`), elsewhere, 'another activity');
      await run(`taskEdit(${card}, 'kph', '5m'); 1`);
      assert.equal(await run(`taskView(${clear}).kph`), '5m', 'the other way too');
      await h.setActivity(7, 'Divinity', { mapIdx: 200 });
      assert.equal(await run(`taskSection(${clear})`), 'archive');
      assert.equal(await run(stat(card, 'kph')), '5m', 'still there, archived');
      await run(`taskEdit(${T(7, 'exp', 'DIVINITY|Divinity')}, 'xph', '3k'); 1`);
      assert.equal(await run(`rates['7|DIVINITY|Divinity'].xph`), '3k');
      assert.notEqual(await run(`rates['7|FIGHTING|Pirate Underling'].xph`), '3k', 'Divinity is its own');
      await h.setActivity(7, 'w7b3', { mapIdx: 317 });
      assert.equal(await run(`rowStat(rows.find(r => r.slot === 7), 'kph')`), '5m', 'there on return');
      await run(`taskEdit(${card}, 'kph', ''); 1`);
      assert.equal(await run(`taskView(${clear}).kph`), '', 'clearing clears it for all, with nothing to fall back to');
      assert.equal((await run(`taskRate(${clear})`)).needs, 'Enter kills / hour');
      assert.equal(await run(`rates['7|FIGHTING|Pirate Underling']?.kph`), undefined);
      await run(`taskEdit(${clear}, 'kph', '1m'); 1`);
    });
    await test('drop rate carries to a new activity until typed there, multikill is the map’s own; the row has the last ones', async () => {
      const r = 'rows.find(r => r.slot === 7)', card = `({ ...${T(7, 'card', 'w7b3')}, slot: 7 })`, read = async () => [await run(`rowStat(${r}, 'dr')`), await run(`rowStat(${r}, 'mk')`)];
      await run(`taskEdit(${card}, 'dr', '5'); taskEdit(${card}, 'mk', '100'); 1`);
      assert.deepEqual([await run(`${r}.dr`), await run(`${r}.mk`)], ['5', '100'], 'setting them writes the row');
      await h.setActivity(7, 'frogG', { mapIdx: 3 });
      assert.equal(await run(`rates['7|' + ${r}.activityKey].dr`), '5', 'arriving with nothing there keeps a copy of the last one'); assert.equal((await run(`rates['7|' + ${r}.activityKey].mk`)) ?? null, null, 'multikill doesn’t carry: it’s the map’s');
      assert.deepEqual(await read(), ['5', ''], 'drop rate carried');
      await run(`setRowStat(${r}, 'dr', '9'); 1`);
      assert.deepEqual(await read(), ['9', ''], 'typed here');
      assert.equal(await run(`${r}.dr`), '9');
      await h.setActivity(7, 'w7b3', { mapIdx: 317 });
      assert.deepEqual(await read(), ['5', '100'], 'the old activity keeps its own');
      assert.equal(await run(`${r}.dr`), '9', 'the row stays the last one set');
      await run(`setRowStat(${r}, 'dr', '5'); 1`);
      await h.setActivity(7, 'frogG', { mapIdx: 3 });
      assert.deepEqual(await read(), ['9', ''], 'and that activity keeps its own');
      await h.setActivity(7, 'w7b3', { mapIdx: 317 });
    });
    await test('crystals per hour belongs to the world; a skill reads each target\u2019s rate, then an old rate for the skill', async () => {
      const r = 'rows.find(r => r.slot === 7)', opts = await run(`grindOptions(${r}).filter(o => o.source === 'crystal')`);
      assert.ok(opts.length, 'a crystal option');
      const c = `({ slot: 7, source: 'crystal', type: 'item', match: ${JSON.stringify(opts[0].match)} })`, home = await run(`statHome(${c}, 'kph')`);
      assert.equal(home, '7|world:' + opts[0].match.world);
      assert.equal(await run(`statHome(${c}, 'dr')`), await run(`'7|' + ${r}.activityKey`), 'its drop rate is what the player is doing');
      const skill = T(5, 'skill', '1');
      await h.setActivity(5, 'Prehistrium', { mapIdx: 305, active: false });
      await run(`rates['5|kind:1'] = { xph: '2k' }; delete rates['5|MINING|Copper']; 1`);
      await h.setActivity(5, 'Copper', { mapIdx: 305, active: false });
      assert.equal(await run(`taskField(${skill}, 'xph')`), '2k', 'the old rate for the skill');
      assert.equal(await run(`rowStat(rows.find(r => r.slot === 5), 'xph')`), '2k', 'and the stats box says the same');
      await run(`delete rates['5|kind:1']; 1`);
      await h.setActivity(5, 'Prehistrium', { mapIdx: 305, active: false });
    });
    await test('star moves an inactive task to the goal section, never out of Active', async () => {
      const clear = T(7, 'clear', 'FIGHTING|Pirate Underling');
      await run(`toggleStar(${clear}); 1`);
      assert.equal(await run(`taskSection(${clear})`), 'active');
      await h.setActivity(7, 'Divinity', { mapIdx: 200 });
      assert.equal(await run(`taskSection(${clear})`), 'goal');
      await run(`toggleStar(${clear}); 1`);
      assert.equal(await run(`taskSection(${clear})`), 'archive');
      await h.setActivity(7, 'w7b3', { mapIdx: 317 });
    });
    await test('skills keep one task, with a rate per target', async () => {
      await h.setActivity(5, 'Prehistrium', { mapIdx: 305, active: false });
      const it = T(5, 'skill', '1');
      await run(`taskEdit(${it}, 'xph', '18T'); 1`);
      await h.setActivity(5, 'Copper', { mapIdx: 305, active: false });
      assert.equal(await run(`${it}.match.key`), 'MINING|Copper'); assert.equal(await run(stat(it, 'xph')), ''); assert.equal(await run(`${it}.goal`), '189');
      await h.setActivity(5, 'Prehistrium', { mapIdx: 305, active: false });
      assert.equal(await run(stat(it, 'xph')), '18T');
      assert.equal(await run(`'xph' in ${it} || 'xphBy' in ${it}`), false);
      await noDups();
    });
    await test('upsert overwrites one task per key, keeping its id; delete and undo', async () => {
      const name = 'Pirate Emblem I', it = T(7, 'item', name), id = await run(`${it}.id`), n = await run('tasks.length');
      await run(`upsertTask({ slot: 7, type: 'item', itemName: ${JSON.stringify(name)}, amount: '9k' }); 1`); // whoever asks, it's the same task
      assert.equal(await run('tasks.length'), n); assert.equal(await run(`${it}.id`), id); assert.equal(await run(`${it}.amount`), '9k');
      await run(`window.gone = deleteTask(${JSON.stringify(id)}); 1`);
      assert.equal(await run('tasks.length'), n - 1);
      await run('restoreTask(window.gone); 1');
      assert.equal(await run('tasks.length'), n); await noDups();
      assert.equal(await run(`tasks.filter(t => t.key === ${JSON.stringify('item|' + name)}).length`), 1);
    });

    /* ----- what can be grinded ----- */
    await test('Crystal options depend on the map’s world', async () => {
      const groups = async slot => [...new Set((await run(`grindOptions(rows.find(r => r.slot === ${slot}))`)).map(o => o.group))];
      assert.deepEqual(await groups(7), ['Pirate Underling drops', 'Crystal Cuttlefish drops', 'Royal Guardian']);
      await h.setActivity(2, 'w7b3', { mapIdx: 317, active: false });
      assert.deepEqual(await groups(2), ['Pirate Underling drops', 'Crystal Cuttlefish drops'], 'world 6, not a Guardian');
      await h.setActivity(2, 'mushG', { mapIdx: 1, active: false });
      assert.deepEqual(await groups(2), ['Green Mushroom drops', 'Crystal Carrot drops'], 'world 0');
      await h.setActivity(2, 'frogG', { mapIdx: 60, active: false });
      assert.ok((await groups(2)).includes('Crystal Crabal drops'), 'world 1');
      const c = (await run('grindOptions(rows.find(r => r.slot === 2))')).find(o => o.source === 'crystal');
      assert.deepEqual(c.match, { kind: 'world', world: 1 });
      await h.setActivity(2, 'Nothing', { active: false });
      assert.deepEqual(await groups(2), [], 'not fighting');
    });
    await test('crystal rate: kph is crystals an hour, no multikill; match by world', async () => {
      await h.setActivity(2, 'mushG', { mapIdx: 1, active: false });
      await run(`setRowStat(rows.find(r => r.slot === 2), 'dr', '4'); setRowStat(rows.find(r => r.slot === 2), 'mk', '900'); 1`);
      const r = 'rows.find(r => r.slot === 2)', opt = (await run(`grindOptions(${r})`)).find(o => o.source === 'crystal' && !/ Card$/.test(o.itemName)), name = opt.itemName;
      await run(`upsertTask({ ...taskFromOption(${r}, grindOptions(${r}).find(o => o.itemName === ${JSON.stringify(name)} && o.source === 'crystal')) }); 1`);
      const it = T(2, 'item', name);
      const crystals = `({ slot: 2, source: 'crystal', type: 'item', match: { kind: 'world', world: 0 } })`;
      await run(`statSet(${crystals}, 'kph', '100'); 1`);
      await run(`window.realActive = window.realActive || activePlayerSlot; activePlayerSlot = () => 2; 1`);
      near((await run(`taskRate(${it})`)).rate, 100 * opt.chance * 4, 'crystal rate, while played');
      assert.equal(await run(`rates['2|world:0'].kph`), '100');
      assert.equal(await run(`'kph' in ${it}`), false);
      assert.equal(await run(`taskSection(${it})`), 'active', 'being played in that world');
      await h.setActivity(2, 'frogG', { mapIdx: 3, active: false });
      assert.equal(await run(`taskSection(${it})`), 'active', 'same world, other monster');
      assert.equal(await run(`statGet(${crystals}, 'kph')`), '100', 'same crystals an hour');
      await h.setActivity(2, 'w7b3', { mapIdx: 317, active: false });
      assert.equal(await run(`taskSection(${it})`), 'archive', 'other world');
      await h.setActivity(2, 'mushG', { mapIdx: 1, active: false });
      await run(`activePlayerSlot = realActive; 1`);
      assert.equal((await run(`taskRate(${it})`)).needs, 'Crystals only drop while playing');
      assert.equal(await run(`taskSection(${it})`), 'archive', 'AFK: no crystals');
      await h.setActivity(2, 'w7b3', { mapIdx: 317, active: false });
      assert.notEqual(await run(`rowStat(rows.find(r => r.slot === 2), 'kph')`), '100', 'the monster’s kills an hour are another number');
    });
    await test('Royal Guardian: Orblets always, the Parchment only at The Royal Castle', async () => {
      const names = async slot => (await run(`grindOptions(rows.find(r => r.slot === ${slot}))`)).filter(o => o.group === 'Royal Guardian').map(o => o.itemName);
      assert.equal(await run('rows.find(r => r.slot === 7).classIndex'), 16);
      assert.deepEqual(await names(7), ['Orblet']);
      await h.setActivity(7, 'fm_rat', { mapIdx: 43 });
      assert.deepEqual(await names(7), ['Parchment of Enchantment', 'Orblet']);
      const opts = await run('grindOptions(rows.find(r => r.slot === 7))');
      const pa = opts.find(o => o.itemName === 'Parchment of Enchantment'), or = opts.find(o => o.itemName === 'Orblet');
      assert.equal(pa.source, 'direct'); assert.deepEqual(pa.match, { kind: 'map', mapIdx: 43 }); assert.deepEqual(or.match, { kind: 'always' });
      await run(`rows.find(r => r.slot === 7) && grindOptions(rows.find(r => r.slot === 7)).filter(o => o.source === 'direct').forEach(o => upsertTask({ ...taskFromOption(rows.find(r => r.slot === 7), o), perHour: '12' })); 1`);
      assert.equal(await run(`taskSection(${T(7, 'item', 'Parchment of Enchantment')})`), 'active');
      assert.equal(await run(`taskRate(${T(7, 'item', 'Orblet')}).rate`), 12);
      await h.setActivity(7, 'Divinity', { mapIdx: 200 });
      assert.deepEqual(await names(7), ['Orblet'], 'not even fighting');
      assert.equal(await run(`taskSection(${T(7, 'item', 'Orblet')})`), 'active');
      assert.equal(await run(`taskSection(${T(7, 'item', 'Parchment of Enchantment')})`), 'archive');
      assert.deepEqual(await names(2), [], 'not a Guardian');
      await h.setActivity(7, 'w7b3', { mapIdx: 317 });
    });

    /* ----- saving ----- */
    await test('the sheet saved via PUT and reloaded keeps tasks', async () => {
      await run('queueSave(); 1');
      const before = await run('tasks'), homesNow = await run('rates'), disk = await h.savedSheet();
      assert.equal(disk.tasks.length, before.length); assert.equal(disk.tasksVersion, 2);
      assert.deepEqual(disk.rates, homesNow, 'rates are in the file');
      assert.ok(Object.keys(homesNow).length > 10);
      await h.reload();
      assert.deepEqual(await run('rates'), homesNow, 'and come back');
      assert.equal(await run('tasksVersion'), 2);
      const after = await run('tasks');
      assert.equal(after.length, before.length);
      before.forEach(t => {
        const a = after.find(x => x.id === t.id);
        assert.ok(a, 'lost ' + t.key);
        ['key', 'kph', 'kpc', 'left', 'xph', 'goal', 'amount', 'starred'].forEach(f => assert.equal(a[f], t[f], t.key + ' ' + f));
      });
      await noDups();
    });
    await test('a save from the old rows path doesn’t lose tasks', async () => {
      const n = await run('tasks.length');
      await run(`setRowStat(rows.find(r => r.slot === 7), 'mk', '50'); queueSave(); 1`); // what the Loot rates Multikill box does
      const disk = await h.savedSheet(), homesNow = await run('rates');
      assert.equal(disk.tasks.length, n); assert.equal(disk.rows.find(r => r.slot === 7).mk, '50'); assert.equal(disk.rates['7|FIGHTING|Pirate Underling'].mk, '50');
      // an older page's save: rows with no tasks at all
      const { tasks: _t, tasksVersion: _v, rates: _r, ...oldState } = disk;
      const st = await h.api('api/state', 'GET'), rev = st.body.rev, page = await run('pageRev');
      assert.equal((await h.api('api/state?rev=' + encodeURIComponent(rev) + '&page=' + encodeURIComponent(page), 'PUT', oldState)).status, 200);
      assert.equal((await h.savedSheet()).tasks, undefined);
      await run('reloadSheet()');
      assert.equal(await run('tasks.length'), n, 'kept in the page');
      assert.deepEqual(await run('rates'), homesNow, 'rates kept too');
      await sleep(700);
      assert.equal((await h.savedSheet()).tasks.length, n, 'and written back');
      assert.deepEqual((await h.savedSheet()).rates, homesNow, 'rates written back');
      // same again, with the page reloading: its browser copy has them
      const st2 = await h.api('api/state', 'GET');
      assert.equal((await h.api('api/state?rev=' + encodeURIComponent(st2.body.rev) + '&page=' + encodeURIComponent(page), 'PUT', oldState)).status, 200);
      await h.reload();
      assert.equal(await run('tasks.length'), n, 'after a reload');
      assert.deepEqual(await run('rates'), homesNow, 'rates after a reload');
      await sleep(700);
      assert.equal((await h.savedSheet()).tasks.length, n, 'and written back after a reload');
      assert.deepEqual((await h.savedSheet()).rates, homesNow, 'rates written back after a reload');
    });
    await test('a duplicate key in a file is merged on load', async () => {
      const n = await run('tasks.length');
      await run(`(() => { const s = JSON.parse(JSON.stringify(stateNow())); const c = { ...s.tasks[0], id: 'zz', kpc: '', editedAt: 1 }; s.tasks.push(c); setState(s); })(); 1`);
      assert.equal(await run('tasks.length'), n); await noDups();
    });

    /* ----- the page ----- */
    await test('who is selected: a manual pick lasts until the game’s active character changes', async () => {
      await h.setActivity(7, 'w7b3', { mapIdx: 317 });
      assert.equal(await run('selectedSlot()'), 7);
      await run('selectPlayer("2"); 1');
      assert.equal(await run('selectedSlot()'), 2);
      await h.setActivity(8, 'w7b3', { mapIdx: 317, active: false });
      assert.equal(await run('selectedSlot()'), 2, 'same active character');
      await h.setActivity(0, 'w7b3', { mapIdx: 317 });
      assert.equal(await run('selectedSlot()'), 0, 'follows again');
    });
    await test('tabs work with real clicks, and every tab shows the shell', async () => {
      for (const [tab, view] of [['Finder', 'viewFinder'], ['Loot', 'viewLoot'], ['Simulate', 'viewSimulate'], ['Planner', 'viewPlanner']]) {
        await h.click('#tab' + tab);
        assert.equal(await run(`!document.getElementById(${JSON.stringify(view)}).hidden`), true, view);
        assert.equal(await run(`document.getElementById('tab${tab}').getAttribute('aria-selected')`), 'true');
        assert.equal(await run(`document.querySelectorAll('[role=tabpanel]:not([hidden])').length`), 1);
        assert.equal(await run(`document.getElementById('activityPanel').getBoundingClientRect().width > 300`), true);
      }
      await h.click('#tabFinder');
      await h.type('#finderInput', 'Pirate Emblem I');
      await sleep(100);
      assert.ok((await run(`document.getElementById('finderResult').innerText`)).includes('found'), 'the finder finds');
      await h.click('#tabLoot');
      await sleep(400);
      assert.ok(await run(`document.getElementById('lootResult').innerText.length > 0`), 'loot draws');
      await h.click('#tabPlanner');
      assert.equal(await run(`typeof jumpToRow + typeof paintNext`), 'undefinedundefined');
      assert.equal(await run(`['next', 'sort', 'nextGo'].filter(id => document.getElementById(id)).length`), 0);
    });
    await test('layout: panel stuck to the viewport, tabs a strip stuck along the top of the page, with the save status and buttons on it; a row on top under 980 with no sideways scroll', async () => {
      await h.setSize(1500);
      const wide = await run(`(() => { scrollTo(0, 400); const a = document.querySelector('.tabbar').getBoundingClientRect(), b = document.querySelector('.activity').getBoundingClientRect(), m = document.querySelector('.page').getBoundingClientRect(); return { railL: a.left, railTop: a.top, railH: a.height, panelTop: b.top, panelH: b.height, panelL: b.left, railR: a.right, railB: a.bottom, mainL: m.left, mainR: m.right, mainTop: m.top, panelR: b.right, h: innerHeight }; })()`);
      assert.ok(Math.abs(wide.railTop) < 1, 'rail top ' + wide.railTop); assert.ok(Math.abs(wide.panelTop) < 1, 'panel top ' + wide.panelTop); assert.ok(wide.railH > 20 && wide.railH < 80, 'one row of tabs ' + wide.railH); assert.equal(wide.panelH, wide.h);
      assert.ok(wide.panelR <= wide.railL + 1 && Math.abs(wide.railL - wide.mainL) < 1 && Math.abs(wide.railR - wide.mainR) < 1, JSON.stringify(wide)); // the tabs run across the top of the page they switch
      await run('scrollTo(0, 0); 1');
      await h.shot('core-1500.png', 1500);
      for (const w of [979, 700, 400]) {
        await h.setSize(w);
        const n = await run(`(() => { const a = document.querySelector('.tabbar').getBoundingClientRect(), b = document.querySelector('.activity').getBoundingClientRect(), m = document.querySelector('.page').getBoundingClientRect(); return { over: document.documentElement.scrollWidth - innerWidth, tabsAbove: a.bottom <= b.top + 1, panelAbove: b.bottom <= m.top + 1, gutter: m.left + parseFloat(getComputedStyle(document.querySelector('.page')).paddingLeft) - m.left }; })()`);
        assert.ok(n.over <= 0, w + ' scrolls sideways by ' + n.over); assert.ok(n.tabsAbove && n.panelAbove, w + ' ' + JSON.stringify(n)); assert.equal(n.gutter, 16);
      }
      await run(`document.getElementById('activityPanel').textContent = 'panel'; 1`);
      await h.click('#activityToggle');
      assert.equal(await run(`getComputedStyle(document.getElementById('activityPanel')).display`), 'none');
      assert.equal(await run(`document.getElementById('activityToggle').getAttribute('aria-expanded')`), 'false');
      await h.click('#activityToggle');
      assert.equal(await run(`getComputedStyle(document.getElementById('activityPanel')).display === 'none'`), false);
      await run(`document.getElementById('activityPanel').textContent = ''; 1`);
      await h.shot('core-400.png', 400);
      await h.setSize(1500);
    });
    await test('hand-typed rows: only the selected one is drawn, with its old sheet line and handlers', async () => {
      assert.equal(await run(`document.querySelectorAll('#rows .task').length`), 0, 'a synced character has no sheet line');
      assert.equal(await run(`document.getElementById('sheetBox').hidden`), true);
      assert.equal(await run(`document.getElementById('startAll').hidden`), true, 'no hand-typed row yet');
      await h.click('#add');
      const id = await run('rows[rows.length - 1].id');
      assert.equal(await run('selectedSlot()'), id);
      assert.equal(await run(`document.querySelectorAll('#rows .task').length`), 1);
      assert.equal(await run(`document.getElementById('startAll').hidden`), false);
      await h.type(`#f-${id}-kph`, '1000');
      await h.type(`#f-${id}-left`, '4000');
      assert.equal(await run(`rows[rows.length - 1].kph`), '1000');
      await sleep(1100);
      assert.ok((await run(`document.querySelector('#rows .s-wait .big').textContent`)).startsWith('4h'));
      assert.equal(await run(`tasks.filter(t => t.slot == null && !ACCOUNT_TASK_TYPES.has(t.type)).length`), 0, 'no tasks for it'); // the account's own (items, cards, portals, outposts) have no player
      await h.click('#rows [data-act="toggle"]');
      assert.ok(await run('rows[rows.length - 1].startedAt > 0'), 'Start AFK');
      await h.click('#rows [data-act="delete"]');
      assert.equal(await run('rows.some(r => r.id === ' + JSON.stringify(id) + ')'), false);
      assert.equal(await run(`document.querySelectorAll('#rows .task').length`), 0);
      await h.click('#undo');
      assert.equal(await run('rows.some(r => r.id === ' + JSON.stringify(id) + ')'), true);
      await run(`rows = rows.filter(r => r.id !== ${JSON.stringify(id)}); plannerPick = null; render(); queueSave(); 1`);
    });
    await test('typing in a task editor holds back updates', async () => {
      await run(`(() => { const box = el('div', 'task-editor'), i = el('input'); i.id = 'tmpEdit'; box.append(i); document.body.append(box); i.focus(); })(); 1`);
      assert.ok(await run('!!typingInSheet()'));
      await run(`document.getElementById('tmpEdit').parentNode.remove(); 1`);
      assert.ok(!(await run('!!typingInSheet()')));
    });
    await test('every poll refreshes the save and loot, on any tab', async () => {
      await h.click('#tabSimulate');
      await run('lootNow = null; 1');
      const at = await run('saveForFinder.savedAt');
      await h.bump(d => {});
      assert.ok((await run('saveForFinder.savedAt')) > at, 'save refreshed');
      assert.ok(await run('lootNow !== null'), 'loot refreshed');
      await h.click('#tabPlanner');
    });
    /* ----- shared drops: cards and Global items count everyone farming them ----- */
    await run(`teamPending = () => 0; 1`); // these characters went AFK long before the save, so all of it would be waiting: what is waiting counting towards a task is tested in test-task-shares
    const R = s => `rows.find(r => r.slot === ${s})`, C3 = T(3, 'card', 'mushG'), C5 = C3; // one card task for the account, whoever's on it
    const onMush = async () => {
      await h.setActivity(3, 'mushG', { mapIdx: 1, active: false });
      await h.setActivity(5, 'mushG', { mapIdx: 1, active: false });
    };
    const stats = (s, kph, dr, mk) => run(`setRowStat(${R(s)}, 'kph', '${kph}'); setRowStat(${R(s)}, 'dr', '${dr}'); setRowStat(${R(s)}, 'mk', '${mk}'); 1`);
    await test('two fighters on one monster: the rate is the sum, and falls when one has no kills per hour (a blank drop rate is the team’s average)', async () => {
      // Green Mushroom Card: chance 0.002; 8 copies held, the next rank at 20, so 12 to go.
      await h.bump(d => { const c = P(d.Cards0); c.mushG = 8; d.Cards0 = JSON.stringify(c); });
      await onMush();
      await stats(3, '1000', '2', '100'); // 1000 / 2 x 0.002 x 2 = 2 / hour
      await stats(5, '6000', '1', '100'); // 6000 / 2 x 0.002 x 1 = 6 / hour (a 0 multikill would be the map's average)
      const at = h.savedAt();
      for (const card of [C3, C5]) {
        const c = await run(`taskCalc(${card}, ${at})`);
        near(c.rate, 8, 'sum'); assert.equal(c.rateSource, 'estimate'); assert.equal(c.target, 20); near(c.hours, 1.5, '12 / 8'); near(c.etaMs, at + 1.5 * 36e5, 'ETA');
        assert.deepEqual([c.team.counted, c.team.total, c.team.others], [2, 2, 2]); // the card is the account's: everyone on it is "others" assert.equal(c.needs, '');
        assert.deepEqual(c.team.rows.map(r => r.slot).sort(), [3, 5]);
      }
      await run(`setRowStat(${R(3)}, 'kph', ''); 1`);
      let c = await run(`taskCalc(${C5}, ${at})`);
      near(c.rate, 6, 'only slot 5 now'); near(c.hours, 2, '12 / 6'); assert.equal(c.team.counted, 1); assert.equal(c.team.total, 2);
      assert.equal(c.team.rows[0].slot, 5, 'whoever counts comes first');
      c = await run(`taskCalc(${C3}, ${at})`); // mid-flight: this player has no stats, the other has
      near(c.rate, 6, 'from the other player'); near(c.hours, 2); assert.equal(c.rateSource, 'estimate'); assert.equal(c.needs, ''); assert.deepEqual([c.team.counted, c.team.total, c.team.others], [1, 2, 1]);
      await run(`setRowStat(${R(5)}, 'kph', ''); 1`);
      for (const card of [C3, C5]) {
        c = await run(`taskCalc(${card}, ${at})`);
        assert.equal(c.rate, 0); assert.equal(c.hours, null); assert.equal(c.etaMs, null); assert.equal(c.needs, 'Enter AFK stats for who\'s on it', 'the account\'s card: nobody counts'); assert.equal(c.team.counted, 0); assert.equal(c.team.total, 2);
      }
      await run(`setRowStat(${R(5)}, 'kph', ''); 1`);
      assert.equal((await run(`taskCalc(${C5}, ${at})`)).needs, 'Enter AFK stats for who\'s on it', 'the account\'s prompt');
    });
    await test('a card is the account’s: whoever leaves it stops counting, and with nobody on it there’s nothing to time', async () => {
      await stats(3, '1000', '2', '100'); await stats(5, '6000', '1', '100');
      await run(`toggleStar(${C3}); 1`);
      await h.setActivity(3, 'Divinity', { mapIdx: 200, active: false });
      assert.equal(await run(`taskSection(${C3})`), 'active', 'still on while slot 5 is');
      const at = h.savedAt();
      let c = await run(`taskCalc(${C3}, ${at + 36e5})`);
      assert.equal(c.active, true); near(c.rate, 6, 'only who is really on it'); assert.deepEqual([c.team.counted, c.team.total], [1, 1]);
      assert.deepEqual(c.team.rows.map(r => r.slot), [5], 'nobody kept for having asked'); assert.equal(c.rateSource, 'estimate');
      near(c.hours, 1, '2 from the save, 1 gone'); near(c.etaMs, at + 2 * 36e5, 'the same finish');
      assert.deepEqual(await run(`taskShares(${C3}).map(s => s.slot)`), [5], 'a share only for who’s on it');
      await h.setActivity(5, 'frogG', { mapIdx: 3, active: false }); // now nobody's on it
      assert.equal(await run(`taskSection(${C3})`), 'goal', 'starred, nobody on it');
      c = await run(`taskCalc(${C3}, ${at + 36e5})`);
      assert.equal(c.active, false); assert.equal(c.rate, 0); assert.equal(c.hours, null); assert.equal(c.team.total, 0);
      assert.deepEqual(await run(`taskShares(${C3})`), [], 'no shares');
      await run(`toggleStar(${C3}); 1`);
    });
    await test('crystal items only count the character being played, at their crystals per hour', async () => {
      await h.setActivity(3, 'mushG', { mapIdx: 1, active: false }); // slot 5 is on frogG, map 3: another monster, the same world
      await h.setActivity(2, 'frogG', { mapIdx: 60, active: false }); // world 1
      const r3 = R(3), name = 'Book Stamp', it = T(3, 'item', name); // Crystal0: chance 0.00009
      assert.equal(await run(`worldOf(${R(5)}.mapIdx)`), 0); assert.equal(await run(`${R(5)}.monster`), 'frogG');
      await run(`upsertTask({ ...taskFromOption(${r3}, grindOptions(${r3}).find(o => o.itemName === ${JSON.stringify(name)})), amount: '54' }); 1`);
      assert.equal(await run(`${it}.source`), 'crystal');
      await run(`(() => { const w = (s, n) => ({ slot: s, source: 'crystal', type: 'item', match: { kind: 'world', world: n } });
        statSet(w(3, 0), 'kph', '2000'); setRowStat(${r3}, 'dr', '2'); // 2000 x 0.00009 x 2 = 0.36 / hour, multikill or not
        statSet(w(5, 0), 'kph', '1000'); setRowStat(${R(5)}, 'dr', '2'); setRowStat(${R(5)}, 'mk', '900'); // 1000 x 0.00009 x 2 = 0.18 / hour
        statSet(w(5, 1), 'kph', '777'); setRowStat(${R(5)}, 'kph', '888'); // not world 0's number, nor frogG's kills
        statSet(w(2, 1), 'kph', '9000'); setRowStat(${R(2)}, 'dr', '9'); statSet(w(2, 0), 'kph', '9000'); })(); 1`);
      const held = await run(`taskHave(${it})`), at = h.savedAt();
      await run(`window.realActive = window.realActive || activePlayerSlot; activePlayerSlot = () => 3; 1`);
      let c = await run(`taskCalc(${it}, ${at})`);
      near(c.rate, 0.36, 'its own player, being played; slot 5 is AFK'); assert.equal(c.team.counted, 1);
      near(c.hours, (54 - held) / 0.36, 'hours');
      await run(`activePlayerSlot = () => 5; 1`);
      c = await run(`taskCalc(${it}, ${at})`);
      near(c.rate, 0.18, 'the other player, being played in the same world'); assert.equal(c.team.counted, 1);
      await run(`activePlayerSlot = () => 2; 1`);
      c = await run(`taskCalc(${it}, ${at})`);
      assert.equal(c.rate, 0, 'played in another world: no crystals here');
      await run(`activePlayerSlot = realActive; 1`);
    });
    await test('a shared item adds up everyone on it; direct items have no team', async () => {
      await h.setActivity(5, 'mushG', { mapIdx: 1, active: false });
      await stats(3, '1000', '2', '100'); await stats(5, '6000', '1', '100');
      const r3 = R(3), r5 = R(5), name = 'Spore Tee', it = T(3, 'item', name); // chance 0.00035
      for (const r of [r3, r5]) await run(`upsertTask({ ...taskFromOption(${r}, grindOptions(${r}).find(o => o.itemName === ${JSON.stringify(name)})), amount: '99999999' }); 1`);
      let k = await run(`taskRate(${it})`);
      near(k.rate, 2.8, '0.7 + 2.1: both have 100% multikill, and a common drop comes for every kill each counts'); assert.equal(k.team.counted, 2); assert.ok(await run(`panelTeamKey(${it})`));
      // both Royal Guardians, typing rates for the same direct item
      assert.equal(await run(`${r3}.classIndex`), 16); assert.equal(await run('rows.find(r => r.slot === 7).classIndex'), 16);
      await run(`upsertTask({ ...taskFromOption(${r3}, grindOptions(${r3}).find(o => o.itemName === 'Orblet')), perHour: '5' }); upsertTask({ ...taskFromOption(rows.find(r => r.slot === 7), grindOptions(rows.find(r => r.slot === 7)).find(o => o.itemName === 'Orblet')), perHour: '12' }); 1`);
      k = await run(`taskRate(${T(3, 'item', 'Orblet')})`);
      assert.equal(await run(`tasks.filter(t => t.itemName === 'Orblet').length`), 1, 'one task, whoever typed');
      assert.equal(k.rateSource, 'typed'); assert.equal(k.team, undefined); assert.ok(k.rate > 0);
      assert.equal(await run(`teamOf(${T(3, 'item', 'Orblet')})`), null);
    });
    await test('a draft changes only its own player’s share, and writes nothing', async () => {
      const at = h.savedAt(), before = await run('JSON.stringify({ tasks, rates, rows })');
      let c = await run(`taskCalc(cardAsPlayer(${C3}, ${R(3)}), ${at}, { kph: '2000' })`); // 2000 / 2 x 0.002 x 2 = 4, + 6
      near(c.rate, 10); near(c.hours, 1.2, '12 / 10');
      c = await run(`taskCalc(cardAsPlayer(${C3}, ${R(3)}), ${at}, { dr: '4', mk: '0' })`); // 1000 x 0.002 x 4 = 8, + 6
      near(c.rate, 14);
      c = await run(`taskCalc(cardAsPlayer(${C3}, ${R(3)}), ${at}, { kph: '' })`); // cleared: only the other's
      near(c.rate, 6); assert.deepEqual([c.team.counted, c.team.total], [1, 2]);
      near((await run(`taskCalc(cardAsPlayer(${C5}, ${R(5)}), ${at}, { kph: '1000', mk: '0' })`)).rate, 4, '1000 x 0.002 + 2: the same draft, from the other side (a drafted 0 stays 0)');
      near((await run(`taskCalc(${C3}, ${at})`)).rate, 8, 'nothing changed');
      assert.equal(await run('JSON.stringify({ tasks, rates, rows })'), before);
    });
    await test('a v2 state with no rates keeps the ones held', async () => {
      const held = await run('rates');
      assert.ok(Object.keys(held).length > 10);
      await run(`(() => { const s = JSON.parse(JSON.stringify(stateNow())); delete s.rates; window.sentVersion = s.tasksVersion; setState(s); })(); 1`);
      assert.equal(await run('sentVersion'), 2);
      assert.deepEqual(await run('rates'), held);
      near((await run(`taskCalc(${C3}, ${h.savedAt()})`)).rate, 8, 'and the sums still work');
    });
    await test('an activity keeps its own drop rate when one is typed elsewhere', async () => {
      const r = R(3), home = '3|FIGHTING|Green Mushroom', frog = T(3, 'item', 'Frog Goal');
      await run(`delete rates[${JSON.stringify(home)}].dr; ${r}.dr = '2'; 1`);
      await h.bump({});
      assert.equal(await run(`rates[${JSON.stringify(home)}].dr`), '2', 'a sync keeps a copy');
      await run(`upsertTask({ slot: 3, type: 'item', itemName: 'Frog Goal', monster: 'frogG', activityKey: 'FIGHTING|Frog', match: { kind: 'activity', key: 'FIGHTING|Frog' }, source: 'monster', chance: 0.003, amount: '10' }); statSet({ slot: 3, activityKey: 'FIGHTING|Frog', source: 'monster' }, 'dr', '9'); statSet({ slot: 3, activityKey: 'FIGHTING|Frog', source: 'monster' }, 'mk', '50'); 1`);
      assert.equal(await run(`${r}.dr`), '9', 'the row has the last one typed');
      assert.equal(await run(`statGet(cardAsPlayer(${C3}, ${R(3)}), 'dr')`), '2', 'this activity’s number stays');
      assert.equal(await run(`statGet(cardAsPlayer(${C3}, ${R(3)}), 'mk')`), '100');
      near((await run(`taskCalc(${C3}, ${h.savedAt()})`)).rate, 8, 'and so does the rate');
      await h.bump({});
      assert.equal(await run(`statGet(cardAsPlayer(${C3}, ${R(3)}), 'dr')`), '2', 'through a sync');
      assert.equal(await run(`rates['3|FIGHTING|Frog'].dr`), '9');
      await run(`deleteTask(${frog}.id); delete rates['3|FIGHTING|Frog']; 1`);
      await h.setActivity(3, 'Divinity', { mapIdx: 200, active: false }); // not fighting: nothing to keep
      await run(`${r}.dr = '3'; syncTasks(); 1`);
      assert.equal(await run(`(rates['3|DIVINITY|Divinity'] || {}).dr ?? null`), null);
    });
    await test('a cleared map: done wherever the character is, a typed number stands, a never-counted one archives', async () => {
      const got = await run(`(() => {
        const d = saveForFinder.data, was = d.KLA_7, kla = JSON.parse(typeof was === 'string' ? was : JSON.stringify(was)), out = {};
        const make = (key, startValue, starred) => upsertTask({ slot: 7, type: 'clear', activityKey: 'FIGHTING|' + key, match: { kind: 'activity', key: 'FIGHTING|' + key }, mapIdx: 317, left: '5m', kpc: '28', startValue, auto: true, starred });
        const counted = make('TestA', 5e6, true), never = make('TestB', 0, false);
        kla[317][0] = 5000; d.KLA_7 = JSON.stringify(kla); syncTasks();
        out.before = taskCalc(counted).done; out.beforeNever = taskSection(never);
        kla[317][0] = -5; d.KLA_7 = JSON.stringify(kla); syncTasks();
        out.after = taskCalc(counted).done; out.section = taskSection(counted); out.never = taskSection(never); out.kept = tasks.find(t => t.id === never.id).kpc;
        taskEdit(counted, 'left', '100m'); syncTasks(); out.typed = taskCalc(counted).done;
        taskEdit(counted, 'left', ''); out.backToDone = taskCalc(counted).done;
        deleteTask(counted.id); deleteTask(never.id); d.KLA_7 = was; syncTasks();
        return out;
      })()`);
      assert.deepEqual(got, { before: false, beforeNever: 'archive', after: true, section: 'goal', never: 'archive', kept: '28', typed: false, backToDone: true });
    });
    await test('a Spelunking cave: its chapter is a goal at a flat, shared rate, like kills per hour', async () => {
      await h.setActivity(3, 'Spelunking3', { active: false });
      await h.setActivity(5, 'Spelunking3', { active: false });
      const got = await run(`(() => {
        const r = rows.find(x => x.slot === 3), o = grindOptions(r).find(x => x.source === 'flat'), out = { item: o.itemName };
        const t = upsertTask({ ...taskFromOption(r, o), amount: '99999999', auto: false });
        out.section = taskSection(t); out.needs = taskCalc(t).needs;
        setRowStat(r, 'iph', '10');
        out.alone = taskCalc(t).rate; out.source = taskCalc(t).rateSource;
        setRowStat(rows.find(x => x.slot === 5), 'iph', '30');
        out.team = taskCalc(t).rate; out.counted = taskCalc(t).team.counted;
        out.left = taskCalc(t).hours != null;
        out.other = statGet({ slot: 3, activityKey: 'SOMETHING|Else' }, 'iph');
        deleteTask(t.id);
        return out;
      })()`);
      assert.deepEqual(got, { item: "Chapter Four 'No Escape'", section: 'active', needs: 'Enter chapters / hour', alone: 10, source: 'typed', team: 40, counted: 2, left: true, other: '' });
    });
    await test('one task, worked two ways: loot rate while played, AFK figures otherwise', async () => {
      const got = await run(`(() => {
        const out = {}, was = lootNow, slot = activePlayerSlot(), r = rows.find(x => x.slot === slot), other = rows.find(x => x.slot != null && x.slot !== slot);
        const option = { group: 'x', itemName: 'Copper Ore', chance: 0.001, source: 'monster', match: { kind: 'activity', key: r.activityKey }, monster: r.monster };
        const dropsWere = DROPS[r.monster]; DROPS[r.monster] = [...(dropsWere || []), ['Copper Ore', 0.001]];
        const t = upsertTask({ ...taskFromOption(r, option), amount: '99999999', auto: false });
        const session = (s, ms, gained = 100) => ({ active: { slot: s, afkId: r.monster, mapIdx: r.mapIdx, items: [{ item: 'Copper', gained, ms }, { item: 'kills', gained: 5000, ms }] }, goals: {} });
        const keep = rates[slot + '|' + r.activityKey];
        rates[slot + '|' + r.activityKey] = { kph: '1000', dr: '1', mk: '0', kpkTotal: '1' };
        const others = rows.filter(x => x !== r && x.monster === r.monster), wasOn = others.map(x => x.monster); others.forEach(x => { x.monster = ''; }); // nobody else's share in these sums
        const afk = taskRate(t, null, true).rate;
        out.afk = afk;
        out.section = taskSection(t);
        lootNow = session(slot, 36e5);
        let c = taskCalc(t); out.playing = c.playing; out.loot = [c.rate, c.rateSource]; out.preview = /^AFK preview: 1 per hour/.test(afkPreviewText(t));
        lootNow = session(slot, 6e4);
        c = taskCalc(t); out.shortRun = [c.rate, c.rateSource];
        lootNow = session(slot, 36e5);
        const clear = upsertTask({ slot, type: 'clear', activityKey: r.activityKey, match: { kind: 'activity', key: r.activityKey }, monster: r.monster, afkId: r.monster, left: '50000', auto: false });
        out.clear = [taskRate(clear).rate, taskRate(clear).rateSource, taskView(clear).kph];
        const moved = chars[slot].since, had = chars[other.slot].since; chars[slot].since = 1; chars[other.slot].since = Date.now();
        c = taskCalc(t); out.notPlayed = [c.playing, c.active, c.rate, c.rateSource, taskSection(t)];
        chars[slot].since = moved; chars[other.slot].since = had;
        others.forEach((x, i) => { x.monster = wasOn[i]; });
        DROPS[r.monster] = dropsWere;
        deleteTask(t.id); deleteTask(clear.id);
        if (keep) rates[slot + '|' + r.activityKey] = keep; else delete rates[slot + '|' + r.activityKey];
        lootNow = was;
        return out;
      })()`);
      assert.deepEqual(got, { afk: 1, section: 'active', playing: true, loot: [100, 'loot rate'], preview: true, shortRun: [6000, 'loot rate'], clear: [5000, 'loot rate', '5000'], notPlayed: [false, true, 1, 'estimate', 'active'] });
    });
    await test('a goal on Loot rates makes an ordinary task, and an old goal can become one', async () => {
      await h.click('#tabLoot');
      await sleep(600);
      const slot = await run('lootNow.active.slot');
      const name = 'Copper Ore', T = `tasks.find(x => x.type === 'item' && x.itemName === ${JSON.stringify(name)})`;
      await run(`$('lootAddItem').value = ${JSON.stringify(name)}; $('lootAddGoal').value = '50k'; $('lootAdd').requestSubmit(); 1`);
      await sleep(300);
      assert.deepEqual(await run(`(t => t && [t.source !== 'played', t.amount, t.starred])(${T})`), [true, '50K', true]);
      assert.match(await run(`$('lootResult').innerText`), /live \/ hour[\s\S]*AFK \/ hour/); // live, then AFK
      await run(`deleteTask(${T}.id); render(); 1`);
      await h.api('api/loot/goal', 'POST', { item: 'Iron', goal: 300 });
      await run('refreshLoot()');
      await sleep(300);
      const make = `[...document.querySelectorAll('#lootResult button')].find(b => b.textContent === 'Make task')`;
      assert.ok(await run(`!!${make}`), 'an old goal offers Make task');
      await run(`${make}.click(); 1`);
      await sleep(500);
      assert.equal(await run(`(t => t && t.amount)(tasks.find(x => x.type === 'item' && x.itemName === itemName('Iron')))`), '300');
      assert.equal((await h.api('api/loot', 'GET')).body.goals.Iron, undefined, 'and it has left the old list');
      await run(`deleteTask(tasks.find(x => x.type === 'item' && x.itemName === itemName('Iron')).id); render(); showTab('planner'); 1`);
    });
    await test('no duplicate keys, and no page errors, after all that', async () => {
      await noDups();
      assert.deepEqual(h.pageErrors(), []);
      assert.deepEqual(await run(`tasks.filter(t => 'kph' in t || 'xph' in t || 'xphBy' in t).map(t => t.key)`), [], 'no rate crept back onto a task');
      assert.ok((await run(`tasks.every(t => taskCalc(t) && taskTitle(t) && taskIconName(t) != null && taskView(t))`)), 'every task computes');
      const icons = await run('tasks.map(taskIconName)');
      console.log('      ' + icons.length + ' tasks; sections:', JSON.stringify(await run(`tasks.reduce((n, t) => { const s = taskSection(t); n[s] = (n[s] || 0) + 1; return n; }, {})`)));
    });
    console.log(passed + ' tests passed');
  } catch (e) {
    console.error('FAILED after ' + passed + ' passed:\n', e);
    process.exitCode = 1;
  } finally {
    await h.close();
  }
  process.exit();
})().catch(e => { console.error(e); process.exit(1); });
