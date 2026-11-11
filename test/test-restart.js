// The Restart button: the app starts a fresh copy of itself on the same port with the same data, and the page reloads onto it. Fake backend only; the copy it leaves is stopped at the end.
const assert = require('assert');
const { start, sleep } = require('./harness');
let pass = 0, fail = 0, child = null;
const test = async (name, f) => { try { await f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', String(e.message).slice(0, 500)); } };
(async () => {
  const h = await start({ sheet: true, noPoll: true }), run = h.run;
  const ping = async () => (await fetch(h.base + 'api/ping')).json();
  try {
    await h.bump(() => {}); await h.poll(); await sleep(300);
    await test('the button is there on the app, by Sync now', async () => {
      assert.equal(await run(`$('topRestart').hidden`), false);
      assert.equal(await run(`$('topRestart').previousElementSibling.id`), 'topSync');
    });
    await test('a click restarts the app: a new process on the same port, the same data, and the page reloads onto it', async () => {
      const before = await ping(), rows = await run('rows.length');
      await run(`window.__old = 1; $('topRestart').click(); 1`);
      let after = null;
      for (let i = 0; i < 60 && !(after && after.pid !== before.pid); i++) { await sleep(250); try { after = await ping(); } catch { /* down for a moment */ } }
      assert.ok(after && after.pid !== before.pid && after.started > before.started, JSON.stringify([before, after]));
      child = after.pid;
      for (let i = 0; i < 40; i++) { await sleep(250); try { if (await run('window.__old === undefined && typeof rows !== "undefined" && rows.length > 0')) break; } catch { /* reloading */ } }
      assert.equal(await run('window.__old'), undefined, 'the page reloaded');
      assert.equal(await run('rows.length'), rows, 'the same data');
      assert.equal(await run(`$('topRestart').textContent`), 'Restart');
      assert.equal((await h.api('api/status', 'GET')).status, 200, 'it answers');
    });
    await test('no page errors', async () => assert.deepEqual(h.pageErrors(), []));
  } finally {
    if (child) try { process.kill(child); } catch { /* already gone */ }
    await h.close();
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { if (child) try { process.kill(child); } catch {} console.error(e); process.exit(1); });
