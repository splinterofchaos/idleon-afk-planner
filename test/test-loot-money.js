// Loot rates also list the coins a character earns, shown as the game shows them. Fake backend only.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true, realLoot: true }), run = h.run;
  try {
    await h.bump(() => {}); await h.poll(); await sleep(500);
    const slot = (await run(`api('/api/loot')`)).active.slot;
    const money = n => h.bump(d => { d['Money_' + slot] = n; });
    const coins = async () => (await run(`api('/api/loot')`)).active.items.find(x => x.item === 'coins');
    await test('coins read the way the game shows them: your screenshot, a gap, and past the last coin', async () => {
      assert.deepEqual(await run(`coinTiers(234289502)`), [[5, 2], [4, 34], [3, 28], [2, 95], [1, 2]]);
      assert.deepEqual(await run(`coinTiers(1500000000)`), [[5, 15]], 'empty coins at the end are left off');
      assert.deepEqual(await run(`coinTiers(2000095)`), [[4, 2], [3, 0], [2, 0], [1, 95]], 'a gap in the middle stays');
      assert.deepEqual((await run(`coinTiers(4.566e40)`)).map(x => x[0]), [21, 20, 19, 18, 17], 'five largest');
      assert.equal((await run(`coinTiers(1e60)`))[0][0], 30);
      assert.deepEqual(await run(`coinTiers(0.5)`), [[1, 0]]);
    });
    await test('what’s gained shows its three largest coins, and a balance its five', async () => {
      assert.deepEqual(await run(`coinTiers(234289502, COINS_GAINED)`), [[5, 2], [4, 34], [3, 28]]);
      assert.deepEqual(await run(`coinTiers(2000095, COINS_GAINED)`), [[4, 2]], 'empty coins at the end are left off');
      assert.equal(await run(`coinsEl(234289502, COINS_GAINED).querySelectorAll('img').length`), 3);
      assert.equal(await run(`coinsEl(234289502).querySelectorAll('img').length`), 5);
    });
    await test('money seen for the first time isn’t counted as earned', async () => {
      await money(5e8);
      const c = await coins();
      assert.ok(!c, JSON.stringify(c));
    });
    await test('what was earned between saves is counted', async () => {
      await money(5e8 + 1000);
      const c = await coins();
      assert.equal(c.gained, 1000); assert.equal(c.count, 5e8 + 1000); assert.ok(c.ms > 0);
    });
    await test('spending leaves that stretch and its time out', async () => {
      const a = await coins();
      await money(1000);
      const c = await coins();
      assert.equal(c.gained, a.gained); assert.equal(c.ms, a.ms);
    });
    await test('a sale far above the usual is left out with its time', async () => {
      await money(2000); await money(3000); await money(4000);
      const a = await coins();
      assert.equal(a.gained, 4000);
      await money(204000);
      const c = await coins();
      assert.equal(c.gained, 4000, JSON.stringify(c)); assert.equal(c.ms, a.ms);
      assert.equal(c.count, 204000);
    });
    await test('coins don’t decide what counts as a claim for other loot', async () => {
      const kept = (await run(`api('/api/loot')`)).active.ms;
      await money(205000);
      assert.ok((await run(`api('/api/loot')`)).active.ms > kept, 'the sale above was not called a claim');
    });
    await test('the tab shows a Money section with coin pictures, and not under Items', async () => {
      await run(`showTab('loot'); refreshLoot()`); await sleep(500);
      const sections = await run(`[...document.querySelectorAll('#lootResult .label')].map(x => x.textContent)`);
      assert.ok(sections.includes('Money'), JSON.stringify(sections));
      assert.equal(await run(`[...document.querySelectorAll('#lootResult .who-name')].filter(x => x.textContent === 'Coins').length`), 1);
      assert.ok(await run(`document.querySelector('#lootResult .found .count .coins img').getAttribute('src').startsWith('icons/Coins')`));
      assert.ok(await run(`[...document.querySelectorAll('#lootResult .found .count .coins')].every(x => x.querySelectorAll('img').length <= 3)`), 'per hour');
      assert.ok(await run(`document.documentElement.scrollWidth <= innerWidth`), 'no sideways scroll');
    });
    await test('Reset clears coins too', async () => {
      await h.api('api/loot/reset', 'POST');
      assert.ok(!(await coins()));
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally { await h.close(); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
