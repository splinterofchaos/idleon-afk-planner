// Companions read from the game, and kills-per-kill numbers shared across characters.
const assert = require('assert');
const { start } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
const term = (h, slot, id) => h.run(`(() => { const x = killsPerKill(${slot}).terms.find(t => t.id === ${JSON.stringify(id)}); return { value: x.value, from: x.from, hint: x.hint }; })()`);
const settle = async h => { await h.bump(() => {}); await h.poll(); await new Promise(r => setTimeout(r, 500)); };

(async () => {
  const h = await start({ sheet: true, noPoll: true, companions: ['4,1,,,0', '4,0,,,0', '14,1,,,1', '29,0,,,0', '0,0,,,0'] });
  try {
    await settle(h);
    const slots = await h.run(`rows.filter(r => r.slot != null).map(r => r.slot)`), [a, b] = slots;
    await test('the app reads the companion list', async () => assert.equal((await h.run(`saveForFinder.companions.length`)), 5));
    await test('owned, upgraded and unowned companions fill themselves in', async () => {
      assert.deepEqual((({ value, from }) => [value, from])(await term(h, a, 'c14')), [3, 'save'], 'upgraded');
      assert.deepEqual((({ value, from }) => [value, from])(await term(h, a, 'c29')), [1.5, 'save'], 'owned');
      const none = await term(h, a, 'c154');
      assert.deepEqual([none.value, none.from], [1, 'save']); assert.match(none.hint, /don.t own/);
    });
    await test('Sheepie gives every character the bubble', async () => {
      const worth = await h.run(`(() => { const c = kpkParse(saveForFinder.data.CauldronInfo)[1][18]; return KPK_DECAY(+c || 0, 70, 40); })()`);
      for (const s of slots) { const x = await term(h, s, 'bubble'); assert.equal(x.from, 'save'); assert.ok(Math.abs(x.value - worth) < 1e-9, s + ': ' + x.value); }
      assert.match((await term(h, a, 'bubble')).hint, /Sheepie/);
    });
    await test('King Doot needs Divinity level 2 on that character', async () => {
      const r = await h.run(`rows.filter(r => r.slot != null).map(r => [r.slot, +(kpkParse(saveForFinder.data['Lv0_' + r.slot])||[])[14] || 0])`);
      for (const [s, lv] of r) { const x = await term(h, s, 'nobisect'); if (x.value === 2 && lv < 2) await h.run(`kpkNobisect(saveForFinder.data, ${s})`).then(y => assert.equal(y, true, 'slot ' + s)); if (lv >= 2) assert.equal(x.value, 2, 'slot ' + s); }
    });
    await test('a companion the app has read has no box, and old typed numbers are ignored', async () => {
      await h.run(`kpkTermSet('account', 'c14', '1'); 1`);
      const x = await term(h, a, 'c14');
      assert.deepEqual([x.value, x.from], [3, 'save']);
      await h.run(`kpkTermSet('account', 'c14', ''); 1`);
    });
    await test('hats, nametags and capes count, each once its map is cleared', async () => {
      const sums = await h.run(`(() => {
        const sp = []; sp[13] = [0, 0, 0, 0, 10]; sp[46] = ['EquipmentHats85', 'EquipmentHats88', 'EquipmentHats1']; sp[17] = []; sp[17][34] = 2; sp[17][36] = 1; sp[17][27] = 0; sp[54] = ['EquipmentCape1', 'EquipmentCape19', 'EquipmentCape2'];
        const d = { Spelunk: JSON.stringify(sp), OptLacc: JSON.stringify(Object.assign([], { 669: 1 })), CauldronInfo: '[]' };
        const run = (allow, patch) => { const sum = {}; kpkCollections({ ...d, ...patch }, m => allow.includes(m), sum); return sum; };

        const late = [...sp]; late[54] = ['EquipmentCape1', 'EquipmentCape2', 'EquipmentCape19'];
        return { all: run([50, 100, 250]), none: run([]), hats: run([50]), tags: run([250]), capes: run([100]), lateCape: run([100], { Spelunk: JSON.stringify(late) }), gallery: 1 + 30 / 100 }; // d has no cards
      })()`);
      const near = (a, b, why) => assert.ok(Math.abs(a - b) < 1e-9, why + ': ' + a + ' vs ' + b);
      assert.deepEqual(sums.none, {}, 'nothing before the maps are cleared');
      near(sums.hats.kills, 3 * 1.03, 'hats: (2 + 1) at 1 + 3 hats / 100');
      assert.deepEqual(Object.keys(sums.hats), ['kills'], 'the hats alone');
      near(sums.tags.w6, 25 * 1.6 * sums.gallery, 'two copies of a nametag are worth 1.6x');
      near(sums.tags.w7, 25 * sums.gallery, 'one copy is worth 1x');
      assert.equal(sums.tags.kills, undefined, 'a nametag not owned gives nothing');
      near(sums.capes.more, 100 * 1.03, 'a cape in a golden vine, full bonus at 1 + 3 capes / 100');
      near(sums.lateCape.more, 100 * 1.03 * 0.25, 'past the golden vines, a quarter');
      near(sums.all.kills, sums.hats.kills, 'together, the same');
    });
    await test('an unowned companion says so and takes a Pet token tick, for everyone', async () => {
      const x = await h.run(`(() => { const t = killsPerKill(${a}).terms.find(t => t.id === 'c154'); return [t.value, t.from, t.hint, t.tokenBase, t.tokenOn]; })()`);
      assert.deepEqual(x, [1, 'save', 'You don\u2019t own it.', 1.6, false]);
      await h.run(`kpkTokenSet('c154', true); 1`);
      for (const s of slots) assert.equal((await term(h, s, 'c154')).value, 1.6, 'slot ' + s);
      assert.match((await term(h, a, 'c154')).hint, /don.t own/, 'still says so');
      await h.run(`kpkTokenSet('c154', false); 1`);
      assert.equal((await term(h, a, 'c154')).value, 1);
      assert.equal(await h.run(`stateNow().rates.account.tokens.c154`), false, 'saved with the sheet');
      assert.equal(await h.run(`killsPerKill(${a}).terms.find(t => t.id === 'c14').tokenBase`), undefined, 'an owned one has no tick');
      await h.run(`delete rates.account.tokens; 1`);
    });
    await test('the save\u2019s token starts the tick on, and your untick wins', async () => {
      const on = await h.run(`(() => { const t = { id: 'c168', tokenBase: 1.2, tokened: true }; const first = kpkTokenOn(t); kpkTokenSet('c168', false); const second = kpkTokenOn(t); delete rates.account.tokens; return [first, second]; })()`);
      assert.deepEqual(on, [true, false]);
    });
    await test('card drop chance multiplies its sources, from the save', async () => {
      const r = await h.run(`(() => {
        const d = saveForFinder.data, ci = kpkParse(d.CauldronInfo), opt = kpkParse(d.OptLacc), f = saveFacts();
        ci[3][18] = 40; d.CauldronInfo = ci; opt[384] = '0c18,a1,'; d.OptLacc = opt;
        const uv = kpkParse(d.UpgVault); uv[44] = 1; d.UpgVault = uv;
        const lv = kpkParse(d.ForgeLV); lv[5] = 60; d.ForgeLV = lv;
        const sl = kpkParse(d['SL_' + ${a}]); sl[628] = 60; d['SL_' + ${a}] = sl;
        d.Guild = [Object.assign(Array(13).fill(0), { 12: 50 })];
        f.cards.frogBIG = 0; f.cards.snailZ = 0; f.cards.stache = 0; f.cards.EasterEvent1 = 0;
        cardBonusFor = null;
        const one = cardDropParts(${a}), multi = kpkPrismaMulti(d);
        f.cards.frogBIG = 1e12; cardBonusFor = null;
        const two = cardDropParts(${a}), rank = cardRank('frogBIG', 1e12, f.unlocks).rank;
        return { one, two, rank, multi };
      })()`);
      // This save without Spirit Reindeer: 6 tesseract + 10 x 19/119 arcade + 1 sushi + 6 x 22/47 x 2.25 x 1.5 palette + 12 x 0.2 sigils + 2 x 24/1024 exotic = 20.5222
      const multi = 2 + (6 + 10 * 19 / 119 + 1 + 6 * 22 / 47 * 2.25 * 1.5 + 2.4 + 2 * 24 / 1024) / 100;
      assert.ok(Math.abs(r.multi - multi) < 1e-9, 'multi: ' + r.multi);
      assert.ok(Math.abs(r.one.parts.bubble - 50 * multi) < 1e-9, 'prisma multiplies the 50% bubble: ' + r.one.parts.bubble);
      assert.deepEqual({ ...r.one.parts, bubble: 0 }, { bubble: 0, forge: 120, cards: 0, guild: 30, talent: 30 }, 'level 60 forge is 120%; level 50 guild is 60 x 50 / 100; talent 60 x 60 / 120');
      assert.ok(Math.abs(r.one.total - (1 + 0.5 * multi) * 2.2 * 1.3 * 1.3) < 1e-9, 'forge with cards; bubble, guild and talent apart: ' + r.one.total);
      assert.equal(r.two.parts.cards, 5 * r.rank);
      assert.ok(Math.abs(r.two.total - (1 + 0.5 * multi) * (2.2 + 5 * r.rank / 100) * 1.3 * 1.3) < 1e-9);
    });
    // Prisma multiplier: each source alone, on a save that has every field and nothing in it.
    const prismaBase = () => ({ Arcane: [], ArcadeUpg: [], Sushi: [], Research: [], Spelunk: [], CauldronP2W: [], FarmUpg: [], OptLacc: [] });
    const prisma = (d, companions = []) => h.run(`(() => { const keep = saveForFinder; saveForFinder = { data: ${JSON.stringify(d)}, companions: ${JSON.stringify(companions)} }; try { const r = kpkPrismaRead(saveForFinder.data); return { known: r.known, value: r.value, parts: r.parts, multi: kpkPrismaMulti(saveForFinder.data) }; } finally { saveForFinder = keep; } })()`);
    const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-9, what + ': ' + got + ', not ' + want);
    const one = async (source, want, make, companions) => { const d = prismaBase(); make(d); const r = await prisma(d, companions); near(r.parts[source], want, source); near(r.value, 2 + want / 100, source + ' total'); assert.equal(r.multi, r.value); };
    await test('prisma: an empty save is the base 2x', async () => { const r = await prisma(prismaBase()); assert.equal(r.known, true); assert.equal(r.value, 2); assert.ok(Object.values(r.parts).every(v => v === 0)); });
    await test('prisma tesseract: level 6 is 6', async () => one('tesseract', 6, d => { d.Arcane[45] = 6; }));
    await test('prisma arcade: decay 10 x 19/119, doubled by Spirit Reindeer, and the Super and Omega levels', async () => {
      await one('arcade', 190 / 119, d => { d.ArcadeUpg[54] = 19; });
      await one('arcade', 380 / 119, d => { d.ArcadeUpg[54] = 19; }, ['27,0,0,52,0']);
      await one('arcade', 10 * 101 / 201 * 2, d => { d.ArcadeUpg[54] = 101; });
      await one('arcade', 10 * 102 / 202 * 6, d => { d.ArcadeUpg[54] = 102; });
    });
    await test('prisma sushi: 1 once the first 24 are found, unbroken', async () => {
      const found = Array(24).fill(0);
      await one('sushi', 1, d => { d.Sushi[5] = found; });
      await one('sushi', 0, d => { d.Sushi[5] = found.slice(0, 23); });
      await one('sushi', 0, d => { d.Sushi[5] = found.map((v, i) => i === 5 ? -1 : v); });
    });
    const at = (i, v) => { const a = Array(i + 1).fill(0); a[i] = v; return a; };
    await test('prisma jelly: 1 at 37 obstructions, 0 at 36', async () => {
      await one('jelly', 1, d => { d.Research[7] = at(9, 37); });
      await one('jelly', 0, d => { d.Research[7] = at(9, 36); });
    });
    await test('prisma trophy: 10 while Trophy23 is in the Gallery', async () => {
      await one('trophy', 10, d => { d.Spelunk[16] = [22, 23]; });
      await one('trophy', 0, d => { d.Spelunk[16] = [22]; });
    });
    await test('prisma palette: 6 x 22/47 = 2.8085, x2.25 with Picasso 5, x1.5 with lore boss 8, x2 and x4 with black stars', async () => {
      const pal = (extra = () => {}) => d => { d.Spelunk[9] = at(28, 22); extra(d); };
      await one('palette', 6 * 22 / 47, pal());
      await one('palette', 6 * 22 / 47 * 2.25, pal(d => { d.Spelunk[18] = at(10, 5); }));
      await one('palette', 6 * 22 / 47 * 1.5, pal(d => { d.Spelunk[0] = at(8, 1); }));
      await one('palette', 6 * 22 / 47 * 2, pal(d => { d.Spelunk[49] = at(28, 1); }));
      await one('palette', 6 * 22 / 47 * 4, pal(d => { d.Spelunk[49] = at(28, 2); }));
    });
    await test('prisma sigils: 0.2 each for ethereal and eclectic; progress equal to 3 or 4 is not a state', async () => one('sigils', 0.4, d => { d.CauldronP2W[4] = [3, 3, 4, 4, 4, 2, 3, -1]; }));
    await test('prisma exotic: 2 x 24/1024, doubled when organic', async () => {
      await one('exotic', 0.046875, d => { d.FarmUpg[68] = 24; });
      await one('exotic', 0.09375, d => { d.FarmUpg[68] = 24; d.Spelunk[50] = ['48']; });
    });
    await test('prisma legend: 3 per level of talent 36', async () => one('legend', 12, d => { d.Spelunk[18] = at(36, 4); }));
    await test('prisma companion: 50 owned or by token, 75 upgraded', async () => {
      await one('companion', 50, () => {}, ['88,0,,,0']);
      await one('companion', 75, () => {}, ['88,0,,,1']);
      await one('companion', 50, d => { d.OptLacc[605] = 1; d.OptLacc[606] = '88'; });
    });
    await test('prisma, all of this account’s sources: 6 + 3.1933 + 1 + 9.4787 + 2.4 + 0.0469 = 22.1189, so 2.2212x and Card Champ at 210%', async () => {
      const d = prismaBase(); d.Arcane[45] = 6; d.ArcadeUpg[54] = 19; d.Sushi[5] = Array(64).fill(1); d.Research[7] = at(9, 25); d.Spelunk[16] = [22];
      d.Spelunk[0] = at(8, 1); d.Spelunk[9] = at(28, 22); d.Spelunk[18] = at(10, 5);
      d.CauldronP2W[4] = Array(24).fill(0).flatMap((_, i) => [1, i < 9 ? 4 : i < 12 ? 3 : 2]); d.FarmUpg[68] = 24;
      const r = await prisma(d, ['27,0,0,52,0']), want = 2 + (6 + 380 / 119 + 1 + 6 * 22 / 47 * 2.25 * 1.5 + 2.4 + 0.046875) / 100;
      near(r.value, want, 'total'); assert.equal(want.toFixed(4), '2.2212'); assert.equal(Math.round(100 * 692 / 732 * r.value), 210);
    });
    await test('prisma stops at the 5x cap', async () => { const d = prismaBase(); d.Arcane[45] = 1000; assert.equal((await prisma(d)).value, 5); });
    await test('prisma falls back to 2x without throwing: a missing or broken field, no companions, no save', async () => {
      for (const field of Object.keys(prismaBase())) {
        const d = prismaBase(); d.Arcane[45] = 6; delete d[field];
        const r = await prisma(d); assert.deepEqual([r.known, r.value], [false, 2], field);
      }
      const broken = prismaBase(); broken.Spelunk = '{not json'; assert.equal((await prisma(broken)).value, 2);
      const odd = prismaBase(); odd.Arcane[45] = 6; odd.CauldronP2W[4] = 7; assert.equal((await prisma(odd)).value, 2, 'a throw inside the read');
      const r = await h.run(`(() => { const keep = saveForFinder; try { saveForFinder = { data: ${JSON.stringify(prismaBase())} }; const noPets = kpkPrismaMulti(saveForFinder.data); saveForFinder = null; return [noPets, kpkPrismaMulti(null)]; } finally { saveForFinder = keep; } })()`);
      assert.deepEqual(r, [2, 2]);
    });
    await test('prisma is kept per save', async () => {
      const r = await h.run(`(() => { const keep = saveForFinder; try { saveForFinder = { data: ${JSON.stringify(prismaBase())}, companions: [] }; const a = kpkPrismaRead(saveForFinder.data), same = a === kpkPrismaRead(saveForFinder.data); saveForFinder = { data: ${JSON.stringify(prismaBase())}, companions: [] }; return [same, a === kpkPrismaRead(saveForFinder.data)]; } finally { saveForFinder = keep; } })()`);
      assert.deepEqual(r, [true, false]);
    });
    await test('Card Champ only takes the multiplier when it is prisma’d', async () => {
      const r = await h.run(`(() => { const d = saveForFinder.data, keepOpt = d.OptLacc, keepInfo = d.CauldronInfo; try { const ci = kpkParse(keepInfo), o = kpkParse(keepOpt); ci[3][18] = 40; d.CauldronInfo = ci; o[384] = 'a1,'; d.OptLacc = o; cardBonusFor = null; return cardDropParts(${a}).parts.bubble; } finally { d.OptLacc = keepOpt; d.CauldronInfo = keepInfo; cardBonusFor = null; } })()`);
      assert.equal(r, 50);
    });
    await test('only cards get it, and it reaches the rate', async () => {
      const r = await h.run(`(() => { const t = { slot: ${a}, type: 'card' }, i = { slot: null, type: 'item' }; return [cardDropMulti(t) === cardDropParts(${a}).total, cardDropMulti(i)]; })()`);
      assert.deepEqual(r, [true, 1]);
    });
    await test('typing a shared term once reaches every character and activity', async () => {
      await h.run(`kpkTermSet(kpkHomeFor({ slot: ${a} }, 'lab'), 'lab', '2'); 1`);
      for (const s of slots) { const x = await term(h, s, 'lab'); assert.deepEqual([x.value, x.from], [2, 'typed'], 'slot ' + s); }
      assert.equal(await h.run(`rates.account.kpk.lab`), '2');
    });
    await test('a personal term stays personal', async () => {
      await h.run(`(() => { const r = rows.find(x => x.slot === ${a}); kpkTermSet(${a} + '|' + r.activityKey, 'gear96', '7'); return 1; })()`);
      assert.equal((await term(h, a, 'gear96')).value, 7);
      assert.notEqual((await term(h, b, 'gear96')).value, 7);
    });
    await test('the box says it is shared', async () => {
      await h.run(`showTab('planner'); document.querySelectorAll('.kpk-disclose').forEach(d => d.open = true); paintAll(); 1`);
      await new Promise(r => setTimeout(r, 300));
      const hint = await h.run(`(() => { const r = document.querySelector('[data-term="lab"] .kpk-hint'); return r ? r.textContent : null; })()`);
      if (hint != null) assert.match(hint, /Shared by all/);
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }

  const o = await start({ sheet: true, noPoll: true, build: false });
  try {
    await settle(o);
    const a = await o.run(`rows.find(r => r.slot != null).slot`);
    await test('without the list, companions stay typed as before', async () => {
      assert.equal(await o.run(`saveForFinder.companions`), null);
      const x = await term(o, a, 'c14');
      assert.equal(x.from, 'missing'); assert.match(x.hint, /If you own it/);
    });
  } finally { await o.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
