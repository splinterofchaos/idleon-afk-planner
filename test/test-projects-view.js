// Projects tab, with a real mouse and keyboard: node test-projects-view.js
const assert = require('assert'), { start, sleep } = require('./harness');
let passed = 0, failed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log('  ok  ' + name); } catch (e) { failed++; console.log('FAIL  ' + name + '\n      ' + String(e.message || e).split('\n').slice(0, 6).join('\n      ')); } };
const J = JSON.stringify;
(async () => {
  const h = await start({ noPoll: true, width: 1500, height: 1000 }), run = h.run;
  const text = s => run(`(n => n ? n.textContent : null)(document.querySelector(${J(s)}))`);
  const val = s => run(`document.querySelector(${J(s)}).value`);
  const count = s => run(`document.querySelectorAll(${J(s)}).length`);
  const seen = s => run(`(n => !!n && !n.hidden && n.getClientRects().length > 0)(document.querySelector(${J(s)}))`);
  const hasClass = (s, c) => run(`document.querySelector(${J(s)}).classList.contains(${J(c)})`);
  const calc = () => run(`(() => { const c = projectCalc(pjProject()); return { ...c, list: c.order.map(id => c.nodes[id]) }; })()`);
  const nodeOf = (key, value) => calc().then(c => c.list.find(n => n[key] === value));
  const card = id => `.pj-node[data-node="${id}"]`;
  const pick = (s, value) => run(`(() => { const n = document.querySelector(${J(s)}); n.focus(); n.value = ${J(value)}; if (n.value !== ${J(value)}) throw new Error('no option ' + ${J(value)}); n.dispatchEvent(new Event('change', { bubbles: true })); n.blur(); })()`);
  const hover = async s => {
    const b = await run(`(() => { const n = document.querySelector(${J(s)}); n.scrollIntoView({ block: 'center' }); const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
    await sleep(40);
  };
  const unhover = async () => { await h.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }); await sleep(40); };
  const addItem = async (name, n) => {
    await run(`pjAddOpen = true; pjAddTab = 'item'; paintProjects()`);
    await h.type('#pjItemName', name);
    if (n != null) await h.type('#pjItemCount', String(n));
    await h.key('Enter');
    await sleep(30);
  };
  const fresh = async name => {
    await run(`projects.splice(0); pjPick(null); showTab('projects'); render()`);
    await h.type('#pjNameBox', name);
    await h.key('Enter');
    await sleep(30);
  };
  const noSideways = () => run(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`);
  const setOf = name => run(`(() => { const s = PROJECT_SETS.find(x => x.name === ${J(name)}); projectAddSet(pjProject(), s.name, { tools: s.tools, weapons: s.weapons }); queueSave(); render(); })()`);
  try {
    await test('the tab is in the rail, and an empty page offers a name box', async () => {
      assert.equal(await text('#tabProjects'), 'Projects');
      await h.click('#tabProjects');
      assert.equal(await seen('#viewProjects'), true);
      assert.equal(await seen('#pjNameBox'), true);
      assert.equal(await seen('#pjNoProject'), true);
      assert.equal(await seen('#pjPick'), false);
    });
    await test('create by typing a name, then rename', async () => {
      await h.type('#pjNameBox', 'Armor for LavaFlame');
      await h.key('Enter');
      await sleep(30);
      assert.equal(await run(`projects.length`), 1);
      assert.equal(await run(`pjProject().name`), 'Armor for LavaFlame');
      assert.equal(await run(`document.activeElement.id`), 'pjItemName', 'ready to add an item');
      assert.equal(await seen('#pjNameBox'), false);
      await h.click('#pjRename');
      assert.equal(await val('#pjNameBox'), 'Armor for LavaFlame');
      await h.type('#pjNameBox', 'LavaFlame');
      await h.click('#pjNameGo');
      assert.equal(await run(`pjProject().name`), 'LavaFlame');
      assert.equal(await run(`document.querySelector('#pjPick').selectedOptions[0].textContent`), 'LavaFlame');
    });
    await test('add an item by its name, and a wrong name is refused', async () => {
      await addItem('Not A Real Thing');
      assert.match(await text('#pjItemMsg'), /No craftable item/);
      assert.equal(await run(`pjProject().targets.length`), 0);
      await addItem('Prehistoric Parka', 2);
      assert.equal(await text('#pjItemMsg'), '');
      assert.deepEqual(await run(`pjProject().targets`), [{ raw: 'EquipmentShirts41', count: 2 }]);
      assert.equal(await val('.pj-item-count'), '2');
      assert.ok(await count('.pj-node') >= 1);
    });
    await test('add a bar as an item', async () => {
      await addItem('Iron Bar', 5);
      assert.equal(await run(`pjProject().targets.some(x => x.raw === 'IronBar')`), true);
      await run(`projectRemoveItem(pjProject(), 'IronBar'); render()`);
    });
    await test('add a whole set with picked tools', async () => {
      await h.click('#pjTab-set');
      await pick('#pjSetPick', 'COPPER_SET');
      assert.ok(await count('#pjSetTools input') >= 2);
      assert.match(await text('#pjSetArmor'), /Armor:/);
      const raw = await run(`document.querySelector('#pjSetTools input').value`);
      await h.click('#pjSetTools input');
      assert.equal(await run(`$('pjSetGo').disabled`), true, 'nobody ticked yet');
      await h.click('#pjSetWho input');
      await h.click('#pjSetGo');
      const targets = await run(`pjProject().targets.map(x => x.raw)`), set = await run(`PROJECT_SETS.find(s => s.name === 'COPPER_SET')`);
      set.armors.forEach(a => assert.ok(targets.includes(a), a));
      assert.ok(targets.includes(raw), 'the tool picked');
      assert.equal(set.tools.filter(t => targets.includes(t)).length, 1, 'only that tool');
      assert.equal(await count('.pj-item'), targets.length);
    });
    await test('add any existing task, grouped by section, and create one', async () => {
      await h.click('#pjTab-task');
      assert.ok(await count('#pjTaskPick optgroup') >= 1);
      const labels = await run(`[...document.querySelectorAll('#pjTaskPick optgroup')].map(g => g.label)`);
      assert.ok(labels.every(x => ['Doing now', 'Goals', 'Archive'].includes(x)), labels.join());
      const id = await run(`[...document.querySelectorAll('#pjTaskPick optgroup option')].map(o => o.value).find(v => { const t = tasks.find(x => x.id === v); return t.type === 'clear' || t.type === 'skill'; })`);
      await pick('#pjTaskPick', id);
      await h.click('#pjTaskGo');
      const node = await run(`pjProject().nodes.find(n => n.taskId === ${J(id)})`);
      assert.ok(node && node.hand, 'a hand-added node');
      assert.equal(await seen(card(node.id)), true);
      assert.equal(await seen('#pjDetail'), true, 'it opens for editing');
      await h.click('#pjDetailClose');
      await pick('#pjNewType', 'forge');
      const covered = await run(`pjProject().nodes.find(n => FORGE_BARS[n.raw] && !projectCalc(pjProject()).nodes[n.id]).raw`);
      await pick('#pjNewBar', covered);
      await h.click('#pjNewGo');
      assert.match(await text('#pjNewMsg'), /already covers/);
      assert.equal(await seen('#pjNewGo'), true, 'stays on the form');
      const bar = await run(`Object.keys(FORGE_BARS).find(b => !pjProject().nodes.some(n => n.raw === b))`);
      await pick('#pjNewBar', bar);
      await h.type('#pjNewAmount', '500');
      await h.click('#pjNewGo');
      assert.equal(await text('#pjNewMsg'), '');
      const forge = await run(`(() => { const t = tasks.find(t => t.type === 'forge' && t.raw === ${J(bar)}); return t && { amount: t.amount, inProject: pjProject().nodes.some(n => n.taskId === t.id) }; })()`);
      assert.deepEqual(forge, { amount: '500', inProject: true });
      await h.click('#pjDetailClose');
      await pick('#pjNewType', 'item');
      await h.type('#pjNewName', 'Nonsense Item');
      await h.click('#pjNewGo');
      assert.match(await text('#pjNewMsg'), /No item/);
    });
    await test('one card per item, and a shared node lists both dependents', async () => {
      await fresh('DAG');
      await setOf('PREHISTORIC_SET');
      await run(`pjOnlyLeft = false; paintProjects()`);
      const c = await calc();
      assert.equal(await count('.pj-node'), c.list.length, 'every node shows');
      assert.equal(new Set(c.list.map(n => n.raw)).size, c.list.length, 'no item twice');
      const shared = c.list.find(n => n.dependents.length >= 2 && n.raw), names = shared.dependents.map(id => c.nodes[id].title);
      assert.equal(await count(`#pjGraph .pj-edge[data-from="${shared.id}"]`), names.length, 'an arrow to each');
      await h.click(card(shared.id));
      const listed = await text('#pjUsedList');
      names.forEach(x => assert.ok(listed.includes(x), x + ' in the detail'));
      assert.equal(await run(`Object.values(projectCalc(pjProject()).nodes).every(n => n.inputs.every(x => pjParts.graph.layout.pos[x].x < pjParts.graph.layout.pos[n.id].x))`), true, 'inputs on the left');
      await h.click('#pjDetailClose');
      await run(`pjOnlyLeft = true; paintProjects()`);
    });
    await test('a count change reflows', async () => {
      await fresh('Counts');
      await addItem('Prehistoric Parka', 1);
      const before = (await calc()).list.length;
      await h.type('.pj-item-count', '500');
      assert.equal(await run(`pjProject().targets[0].count`), 1, 'not while typing');
      await h.key('Tab');
      await sleep(30);
      assert.equal(await run(`pjProject().targets[0].count`), 500);
      const after = await calc();
      assert.ok(after.list.length > before, after.list.length + ' nodes after ' + before);
      assert.equal(await count('.pj-node:not(.done)'), after.list.filter(n => !n.done).length);
      await h.type('.pj-item-count', 'abc');
      assert.equal(await run(`document.querySelector('.pj-item-count').getAttribute('aria-invalid')`), 'true');
      await h.key('Tab');
      await sleep(30);
      assert.equal(await val('.pj-item-count'), '500', 'a bad count goes back');
    });
    await test('owning it changes the graph after a save', async () => {
      await fresh('Own');
      await addItem('Prehistoric Parka', 1);
      const raw = 'EquipmentShirts41', before = await nodeOf('raw', raw), list = v => typeof v === 'string' ? JSON.parse(v) : v;
      assert.equal(before.done, false);
      assert.equal(await seen(card(before.id)), true);
      await h.bump(d => {
        const order = list(d.ChestOrder), qty = list(d.ChestQuantity);
        order.push(raw); qty.push(1);
        d.ChestOrder = order; d.ChestQuantity = qty;
      });
      await sleep(1100);
      const c = await calc(), after = c.list.find(n => n.raw === raw);
      assert.equal(after.done, true);
      assert.equal(c.done, true);
      assert.equal(await text('#pjEta'), 'Ready!');
      assert.equal(await text('#pjBy'), '');
      assert.equal(await seen(card(after.id)), false, 'done, so folded');
      assert.equal(await seen('#pjBlocked'), false);
      await h.bump(d => {
        const order = list(d.ChestOrder), qty = list(d.ChestQuantity), at = order.lastIndexOf(raw);
        order.splice(at, 1); qty.splice(at, 1);
        d.ChestOrder = order; d.ChestQuantity = qty;
      });
    });
    await test('links: add, refused loop, kind toggle, remove', async () => {
      await fresh('Links');
      await run(`pjAddTab = 'task'; pjAddOpen = true; paintProjects()`);
      for (const [name, amount] of [['Pearler Shell', '9999T'], ['Hampter', '9999T']]) {
        await h.type('#pjNewName', name);
        await h.type('#pjNewAmount', amount);
        await h.click('#pjNewGo');
        await sleep(30);
        if (await seen('#pjDetailClose')) await h.click('#pjDetailClose');
      }
      const [a, b] = await run(`pjProject().nodes.map(n => n.id)`);
      assert.ok(a && b);
      await h.click(card(b));
      await pick('#pjEdgeWay', 'in');
      await pick('#pjEdgeOther', a);
      await pick('#pjEdgeKind', 'after');
      await h.click('#pjEdgeGo');
      assert.deepEqual(await run(`pjProject().edges.map(e => [e.from, e.to, e.kind])`), [[a, b, 'after']]);
      assert.equal(await text('#pjEdgeMsg'), '');
      assert.match(await text('#pjNeedsList'), /Pearler Shell/);
      assert.match(await text('#pjNeedsList'), /after this finishes/);
      await pick('#pjEdgeWay', 'out');
      await pick('#pjEdgeOther', a);
      await h.click('#pjEdgeGo');
      assert.match(await text('#pjEdgeMsg'), /loop/);
      assert.equal(await run(`pjProject().edges.length`), 1, 'refused');
      await h.click('#pjNeedsList .pj-kind');
      assert.equal(await run(`pjProject().edges[0].kind`), 'needs');
      assert.match(await text('#pjNeedsList .pj-kind'), /at the same time/);
      await h.click('#pjNeedsList .pj-kind');
      assert.equal(await run(`pjProject().edges[0].kind`), 'after');
      assert.equal((await calc()).nodes[b].depth, 0);
      assert.equal((await calc()).nodes[a].depth, 1, 'the input moved a column left');
      assert.equal(await run(`document.querySelector(${J(card(a))}).offsetLeft < document.querySelector(${J(card(b))}).offsetLeft`), true);
      assert.equal(await run(`getComputedStyle(document.querySelector('#pjGraph .pj-edge .pj-wire')).strokeDasharray`), '6px, 5px', 'after is dashed');
      await h.click('#pjNeedsList button.x');
      assert.equal(await run(`pjProject().edges.length`), 0);
      await h.click('#pjDetailClose');
    });
    await test('a recipe link has no controls', async () => {
      await fresh('Recipe');
      await addItem('Prehistoric Parka', 500);
      const c = await calc(), n = c.list.find(x => x.inputs.length);
      await h.click(card(n.id));
      assert.equal(await count('#pjNeedsList .pj-edge'), n.inputs.length);
      assert.equal(await run(`[...document.querySelectorAll('#pjNeedsList .pj-kind')].every(b => b.hidden)`), true);
      assert.match(await text('#pjNeedsList'), /×/);
      assert.equal(await seen('#pjRemoveNode'), false, 'a generated node goes with its item');
      await h.click('#pjDetailClose');
    });
    await test('Make task, with no player to pick', async () => {
      await fresh('Make');
      await setOf('PREHISTORIC_SET');
      const c = await calc(), n = c.list.find(x => x.makeTask && !x.done);
      assert.ok(n, 'an open drop with no task');
      await h.click(`#pjBlocked [data-node="${n.id}"]`);
      assert.equal(await seen('#pjMakeTask'), true);
      assert.equal(await seen('#pjMakeWho'), false);
      await h.click('#pjMakeTask');
      const made = await run(`(() => { const x = projectNode(pjProject(), ${J(n.id)}), t = tasks.find(t => t.id === x.taskId); return t && { slot: t.slot, type: t.type, starred: t.starred, amountAuto: t.amountAuto }; })()`);
      assert.deepEqual(made, { slot: null, type: 'item', starred: true, amountAuto: true });
      assert.equal(await seen('#pjMakeTask'), false);
      assert.equal(await seen('#pjDetail .task-editor'), true, 'its editor replaces the button');
      assert.equal(await seen('#pjOpenPlanner'), true);
      assert.match((await nodeOf('id', n.id)).needs, /^No one is on |AFK stats/);
    });
    await test('the editor edits, and typing lasts through ticks and polls', async () => {
      const box = '#pjDetail [data-field="amount"]';
      assert.equal(await seen(box), true);
      assert.equal(await seen('#pjDetail [data-field="kph"]'), false, 'its rate is each player\'s AFK stats');
      await h.type(box, '12');
      await run(`window.__box = document.querySelector(${J(box)})`);
      await sleep(1300);
      await h.poll();
      await sleep(50);
      assert.equal(await run(`document.activeElement === window.__box && window.__box.isConnected`), true, 'still in the same box');
      assert.equal(await val(box), '12');
      await h.send('Input.insertText', { text: '00' });
      await sleep(1100);
      assert.equal(await val(box), '1200');
      await h.key('Tab');
      const id = await run(`pjNodeId`), t = await run(`projectNodeTask(projectNode(pjProject(), ${J(id)}))`);
      assert.equal(t.amount, '1200');
      assert.ok((await h.savedSheet()).tasks.some(x => x.id === t.id && x.amount === '1200'), 'saved');
    });
    await test('the planner link opens that task', async () => {
      const id = await run(`pjProject().nodes.find(n => n.taskId && tasks.find(t => t.id === n.taskId).type === 'item' && tasks.find(t => t.id === n.taskId).starred).id`);
      await run(`pjSelect(${J(id)}, false)`);
      await h.click('#pjOpenPlanner');
      assert.equal(await seen('#viewPlanner .tcard.jump'), true);
      await h.click('#tabProjects');
      assert.equal(await run(`pjNodeId`), id, 'the pick is still there on the way back');
      await h.click('#pjDetailClose');
    });
    await test('typed rate on a count-only node', async () => {
      await fresh('Rate');
      await setOf('PREHISTORIC_SET');
      await run(`pjProject().targets.forEach(x => { x.count = 400; }); projectExpand(pjProject()); pjChipsAll.blocked = true; render()`);
      const c = await calc(), n = c.list.find(x => x.noRate && !x.done);
      assert.ok(n, 'a count node with no rate');
      assert.equal(await text(card(n.id) + ' .pj-why'), 'No rate');
      await h.click(`#pjBlocked [data-node="${n.id}"]`);
      assert.equal(await seen('#pjRate'), true);
      assert.equal(await hasClass('#pjDetail .pj-detail-in', 'no-rate'), true);
      await h.type('#pjRate', '50');
      await sleep(30);
      const now = await nodeOf('id', n.id);
      assert.equal(now.noRate, false);
      assert.ok(now.ownHours > 0);
      assert.equal(await run(`document.activeElement.id`), 'pjRate');
      assert.equal(await val('#pjRate'), '50');
      assert.match(await text(card(n.id) + ' .pj-own'), /\d/);
      await h.click('#pjDetailClose');
      await run(`pjChipsAll.blocked = false; paintProjects()`);
    });
    await test('long lists of chips fold', async () => {
      const c = await calc();
      assert.ok(c.blocked.length > 8);
      assert.equal(await count('#pjBlocked .pj-chip'), 8);
      await h.click('#pjMore-blocked');
      assert.equal(await count('#pjBlocked .pj-chip'), c.blocked.length);
      await h.click('#pjMore-blocked');
      assert.equal(await count('#pjBlocked .pj-chip'), 8);
    });
    await test('the bottleneck is marked and read out', async () => {
      await fresh('Slow');
      await setOf('PREHISTORIC_SET');
      const c = await calc();
      assert.ok(c.bottleneck.length >= 2);
      assert.equal(await count('.pj-node.slow'), c.bottleneck.length);
      assert.equal(await run(`[...document.querySelectorAll('.pj-node.slow')].every(k => k.querySelector('.pj-tag').textContent === 'Bottleneck')`), true);
      assert.deepEqual(await run(`[...document.querySelectorAll('#pjPath .pj-step')].map(b => b.textContent)`), [...c.bottleneck].reverse().map(id => c.nodes[id].title));
      assert.equal(await run(`getComputedStyle(document.querySelector('#pjPath .pj-step + .pj-step'), '::before').content`), '"→"');
      assert.match(await text('#pjBy'), /need/);
      const links = c.bottleneck.slice(1).map((x, i) => [x, c.bottleneck[i]]);
      for (const [from, to] of links) assert.equal(await hasClass(`#pjGraph .pj-edge[data-from="${from}"][data-to="${to}"]`, 'slow'), true, 'its arrows too');
      assert.equal(await count('#pjGraph .pj-edge.slow'), links.length);
      assert.ok(await run(`parseFloat(getComputedStyle(document.querySelector('#pjGraph .pj-edge.slow .pj-wire')).strokeWidth)`) > await run(`parseFloat(getComputedStyle(document.querySelector('#pjGraph .pj-edge:not(.slow) .pj-wire')).strokeWidth)`), 'and thicker');
    });
    await test('hover and focus light up what a box needs and feeds, and fade the rest', async () => {
      const c = await calc(), n = c.list.find(x => !x.done && x.dependents.some(d => !c.nodes[d].done) && x.inputs.some(i => !c.nodes[i].done));
      assert.ok(n);
      const open = n.inputs.find(i => !c.nodes[i].done), user = n.dependents.find(d => !c.nodes[d].done), wire = (a, b) => `#pjGraph .pj-edge[data-from="${a}"][data-to="${b}"]`;
      const wires = await count('#pjGraph .pj-edge');
      await hover(card(n.id));
      assert.equal(await hasClass('#pjGraph', 'has-hot'), true);
      assert.equal(await hasClass(card(n.id), 'hot'), true);
      assert.equal(await hasClass(card(user), 'hot-out'), true);
      assert.equal(await hasClass(card(open), 'hot-in'), true);
      assert.equal(await hasClass(wire(open, n.id), 'hot-in'), true);
      assert.equal(await hasClass(wire(n.id, user), 'hot-out'), true);
      await sleep(180);
      assert.ok(await run(`+getComputedStyle(document.querySelector('.pj-node:not(.hot):not(.hot-in):not(.hot-out)')).opacity`) < .5, 'the other boxes fade');
      assert.ok(await run(`+getComputedStyle(document.querySelector('.pj-edge:not(.hot-in):not(.hot-out)')).opacity`) < .5, 'the other arrows fade');
      assert.equal(await run(`+getComputedStyle(document.querySelector(${J(wire(open, n.id))})).opacity`), 1);
      assert.equal(await count('#pjGraph .pj-edge'), wires, 'nothing added or taken away');
      await unhover();
      assert.equal(await hasClass('#pjGraph', 'has-hot'), false);
      assert.equal(await hasClass(wire(open, n.id), 'hot-in'), false);
      await sleep(180);
      assert.equal(await run(`getComputedStyle(document.querySelector('#pjGraph .pj-edge')).visibility`), 'visible', 'arrows stay when nothing is hovered');
      await run(`(() => { const all = [...document.querySelectorAll('#pjGraph button')], at = all.indexOf(document.querySelector(${J(card(n.id))})); all[at - 1].focus(); })()`);
      await h.key('Tab');
      assert.equal(await run(`document.activeElement.dataset.node`), n.id);
      assert.equal(await hasClass(card(open), 'hot-in'), true, 'keyboard focus lights it too');
      assert.equal(await hasClass('#pjGraph', 'has-hot'), true);
      await run(`document.activeElement.blur()`);
      assert.equal(await hasClass('#pjGraph', 'has-hot'), false);
    });
    await test('a click held across the tick still lands, on the same element', async () => {
      const c = await calc(), n = c.list.find(x => !x.done);
      await run(`window.__card = document.querySelector(${J(card(n.id))})`);
      await h.click(card(n.id), { hold: 1300 });
      assert.equal(await run(`pjNodeId`), n.id);
      assert.equal(await run(`window.__card === document.querySelector(${J(card(n.id))})`), true);
      assert.equal(await hasClass(card(n.id), 'chosen'), true);
      await h.key('Escape');
      assert.equal(await run(`pjNodeId`), null, 'Escape closes it');
      assert.equal(await run(`document.activeElement === window.__card`), true, 'and goes back to the card');
    });
    await test('the filter hides what is done and nothing unfinished uses, with its arrows and a count', async () => {
      const c = await calc(), left = c.list.filter(n => !n.done), done = c.list.length - left.length, unfinished = new Set(left.map(n => n.id)), stays = c.list.filter(n => n.done && n.dependents.some(d => unfinished.has(d)));
      const shown = new Set([...left, ...stays].map(n => n.id)), both = c.edges.filter(e => shown.has(e.from) && shown.has(e.to));
      assert.ok(done > 0);
      assert.equal(await run(`document.querySelector('#pjOnlyLeft').checked`), true, 'on by default');
      assert.ok(stays.length > 0, 'a resource you have enough of still shows under what uses it');
      for (const n of stays) assert.equal(await hasClass(card(n.id), 'done'), true);
      assert.equal(await count('.pj-node'), shown.size);
      assert.equal(await count('#pjGraph .pj-edge'), both.length, 'only arrows with both ends showing');
      assert.equal(await text('#pjHiddenCount'), c.list.length - shown.size ? c.list.length - shown.size + ' done hidden' : '');
      assert.equal(await count('.pj-done-toggle'), 0, 'the old fold is gone');
      assert.deepEqual(await run(`[...document.querySelectorAll('#pjGraph .pj-edge')].filter(e => !document.querySelector('.pj-node[data-node="' + e.dataset.from + '"]') || !document.querySelector('.pj-node[data-node="' + e.dataset.to + '"]')).length`), 0, 'no orphans');
      await h.click('#pjOnlyLeft');
      assert.equal(await count('.pj-node'), c.list.length);
      assert.equal(await count('#pjGraph .pj-edge'), c.edges.length);
      assert.equal(await text('#pjHiddenCount'), done + ' done');
      const d = c.list.find(n => n.done);
      assert.equal(await seen(card(d.id) + ' .pj-mark'), true, 'a done mark');
      assert.equal(await hasClass(card(d.id), 'done'), true);
      assert.notEqual(await run(`getComputedStyle(document.querySelector(${J(card(d.id))})).borderColor`), await run(`getComputedStyle(document.querySelector(${J(card(left[0].id))})).borderColor`), 'muted');
      await h.click('#pjOnlyLeft');
      assert.equal(await count('.pj-node'), shown.size);
    });
    await test('count equipped gear', async () => {
      await h.click('#pjEquipped');
      assert.equal(await run(`pjProject().equipped`), true);
      assert.equal((await h.savedSheet()).projects[0].equipped, true);
      await h.click('#pjEquipped');
      assert.equal(await run(`pjProject().equipped`), false);
    });
    await test('delete has Undo, for a project and an item', async () => {
      const id = await run(`pjId`), nodes = await run(`pjProject().nodes.length`);
      await h.click('#pjDelete');
      assert.equal(await run(`projectById(${J(id)})`), null);
      assert.equal(await seen('#pjNameBox'), true, 'none left');
      assert.match(await text('#toastText'), /Deleted Slow/);
      await h.click('#undo');
      assert.equal(await run(`pjId`), id);
      assert.equal(await run(`pjProject().nodes.length`), nodes);
      assert.equal(await seen('#pjNameBox'), false);
      const before = await run(`pjProject().targets.length`), raw = await run(`pjProject().targets[0].raw`);
      await run(`pjAddOpen = true; pjAddTab = 'item'; paintProjects()`);
      await h.click('.pj-item button.x');
      assert.equal(await run(`pjProject().targets.length`), before - 1);
      await h.click('#undo');
      assert.equal(await run(`pjProject().targets.some(x => x.raw === ${J(raw)})`), true);
    });
    await test('a deleted task offers Remove', async () => {
      const orphan = await run(`(() => { const p = pjProject(), t = upsertTask({ slot: null, type: 'exp', activityKey: 'x|y', xph: '5', left: '5', auto: false, test: true }), n = projectAddTask(p, t.id); deleteTask(t.id); render(); return n.id; })()`);
      assert.equal(await text(card(orphan) + ' .pj-why'), 'Task deleted');
      await h.click(card(orphan));
      assert.equal(await seen('#pjDetail .task-editor'), false);
      await h.click('#pjRemoveNode');
      assert.equal(await run(`projectNode(pjProject(), ${J(orphan)})`), null);
      assert.equal(await run(`pjNodeId`), null);
    });
    await test('a reload keeps it all, and which project was up', async () => {
      await run(`projectCreate('Other'); render()`);
      const id = await run(`pjId`), name = await run(`pjProject().name`);
      await h.savedSheet();
      await h.reload();
      assert.equal(await run(`$('viewProjects').hidden`), false, 'the tab is remembered');
      assert.equal(await run(`pjId`), id);
      assert.equal(await run(`pjProject().name`), name);
      assert.equal(await val('#pjPick'), id);
      assert.ok(await count('.pj-node') > 0);
      await pick('#pjPick', await run(`projects.find(p => p.name === 'Other').id`));
      assert.equal(await run(`pjProject().name`), 'Other');
      await run(`projectDelete(pjId); pjPick(${J(id)}); queueSave(); render()`);
    });
    await test('a forge card in the activity panel opens the project at that node', async () => {
      await fresh('Forge');
      await setOf('PREHISTORIC_SET');
      const n = await nodeOf('raw', 'GodshardBar');
      assert.ok(n.taskId);
      await h.click('#tabSimulate');
      const here = `.pc[data-id="${n.taskId}"] .pc-main`;
      const task = `tasks.find(t => t.id === ${JSON.stringify(n.taskId)})`;
      if (await run(`taskCalc(${task}).done`)) {
        assert.equal(await seen(here), false, 'bars already owned take no space in the panel');
        await run(`toggleStar(${task}); render(); 1`); // unless it's a goal
      }
      assert.equal(await seen(here), true, 'it has a card');
      await h.click(here);
      assert.equal(await run(`$('viewProjects').hidden`), false);
      assert.equal(await run(`pjNodeId`), n.id);
      assert.equal(await seen(card(n.id)), true, 'even though it is done and was folded');
      assert.match(await text('#pjDetail .pj-forge'), /does not consider extra bar chance/);
      assert.match(await text('#pjDetail .pj-forge'), /slots? · .*bars \/ hour/);
      assert.equal(await seen('#pjDetail [data-field="amount"]'), true);
      await h.click('#pjDetailClose');
    });
    await test('a forge task in no project still opens, and can join one', async () => {
      await fresh('Loose');
      await run(`window.__t = upsertTask({ type: 'forge', slot: null, raw: 'StarfireBar', itemName: itemName('StarfireBar'), auto: false }).id; openTaskInProjects(window.__t)`);
      await sleep(30);
      assert.equal(await seen('#pjDetail .task-editor'), true);
      assert.match(await text('#pjDetail .pj-d-state'), /Not in a project/);
      await h.click('#pjAddLoose');
      assert.ok(await run(`pjProject().nodes.some(n => n.taskId === window.__t)`));
      await h.click('#pjDetailClose');
    });
    await test('a forge ETA has the note beside it', async () => {
      await fresh('Timed');
      await addItem('Godshard Bar', await run(`ownedCount(['GodshardBar']) + 2000`));
      const c = await calc(), n = c.list.find(x => x.raw === 'GodshardBar');
      assert.ok(n.hours > 0, 'it takes time: ' + n.hours);
      assert.equal(await text(card(n.id) + ' .pj-card-note'), 'does not consider extra bar chance');
      assert.equal(await text('#pjForgeNote'), 'does not consider extra bar chance');
      assert.match(await text('#pjEta'), /\d/);
      assert.match(await text('#pjBy'), /^by /);
      assert.equal(await hasClass(card(n.id), 'running'), true);
      await h.shot('projects-forge-timed-1500.png', 1500, 1000);
    });
    await test('90 nodes paint fast, even at 200+', async () => {
      await fresh('Big');
      await setOf('PREHISTORIC_SET');
      await run(`pjOnlyLeft = false; paintProjects()`);
      await run(`pjProject().targets.forEach(x => { x.count = 3; }); projectExpand(pjProject()); render()`);
      const nodes = await count('.pj-node');
      assert.ok(nodes >= 90, nodes + ' boxes');
      const median = x => x.sort((a, b) => a - b)[x.length >> 1];
      const tick = () => run(`(() => { const t = []; for (let i = 0; i < 9; i++) { const a = performance.now(); paintProjects(); t.push(performance.now() - a); } return t.sort((a, b) => a - b)[4]; })()`);
      const place = () => run(`(() => { const t = []; for (let i = 0; i < 5; i++) { pjParts.graph.sig = ''; const a = performance.now(); paintProjects(); document.body.offsetWidth; t.push(performance.now() - a); } return t.sort((a, b) => a - b)[2]; })()`);
      const small = await tick(), smallPlace = await place();
      assert.ok(small < 30, 'a tick took ' + small.toFixed(1) + ' ms');
      assert.ok(smallPlace < 120, 'a re-layout took ' + smallPlace.toFixed(1) + ' ms');
      await run(`pjProject().targets.forEach(x => { x.count = 400; }); projectExpand(pjProject()); render()`);
      const many = await count('.pj-node'), big = await tick(), bigPlace = await place();
      assert.ok(many > 200, many + ' boxes');
      assert.ok(big < 60, 'a tick took ' + big.toFixed(1) + ' ms');
      assert.ok(bigPlace < 250, 'a re-layout took ' + bigPlace.toFixed(1) + ' ms');
      console.log('      ' + nodes + ' boxes: tick ' + small.toFixed(1) + ' ms, re-layout ' + smallPlace.toFixed(1) + ' ms; ' + many + ' boxes: tick ' + big.toFixed(1) + ' ms, re-layout ' + bigPlace.toFixed(1) + ' ms');
      await run(`pjOnlyLeft = true; pjProject().targets.forEach(x => { x.count = 1; }); projectExpand(pjProject()); render()`);
    });
    // Each box, and each arrow sampled along its real curve, in the canvas's own coordinates.
    const shape = () => run(`(() => {
      const box = n => ({ id: n.dataset.node, x: n.offsetLeft, y: n.offsetTop, w: n.offsetWidth, h: n.offsetHeight });
      const wires = [...document.querySelectorAll('#pjGraph .pj-edge')].map(g => { const p = g.querySelector('.pj-wire'), len = p.getTotalLength(), pts = []; for (let d = 0; d <= len; d += 4) { const q = p.getPointAtLength(d); pts.push([q.x, q.y]); } const q = p.getPointAtLength(len); pts.push([q.x, q.y]); return { from: g.dataset.from, to: g.dataset.to, pts }; });
      return { boxes: [...document.querySelectorAll('#pjGraph .pj-node')].map(box), wires };
    })()`);
    const checkShape = ({ boxes, wires }, label) => {
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, label + ': boxes overlap ' + J([a, b]));
      }
      const by = new Map(boxes.map(b => [b.id, b]));
      wires.forEach(w => {
        for (let i = 1; i < w.pts.length; i++) assert.ok(w.pts[i][0] >= w.pts[i - 1][0] - .01, label + ': an arrow turned back');
        assert.ok(by.get(w.from).x < by.get(w.to).x, label + ': arrow runs left');
        assert.ok(Math.abs(w.pts[0][0] - by.get(w.from).x - by.get(w.from).w) < 1, label + ': leaves the right side');
        assert.ok(by.get(w.to).x - w.pts[w.pts.length - 1][0] < 12, label + ': arrives at the left side');
        w.pts.forEach(([x, y]) => boxes.forEach(b => assert.ok(!(x > b.x + .5 && x < b.x + b.w - .5 && y > b.y + .5 && y < b.y + b.h - .5), label + ': an arrow goes through ' + b.id)));
      });
    };
    await test('counts match: a shared box has two arrows out, a merged one two in', async () => {
      await fresh('Graph');
      await setOf('PREHISTORIC_SET');
      await run(`pjOnlyLeft = false; pjProject().targets.forEach(x => { x.count = 3; }); projectExpand(pjProject()); render()`);
      const c = await calc();
      assert.ok(c.list.length >= 90);
      assert.equal(await count('#pjGraph .pj-node'), c.list.length);
      assert.equal(await count('#pjGraph .pj-edge'), c.edges.length);
      assert.equal(await count('#pjGraph .pj-edge .pj-head'), c.edges.length, 'each has a head');
      const shared = c.list.find(n => n.dependents.length >= 2), merged = c.list.find(n => n.inputs.length >= 2);
      assert.equal(await count(`#pjGraph .pj-edge[data-from="${shared.id}"]`), shared.dependents.length);
      assert.equal(await count(`#pjGraph .pj-edge[data-to="${merged.id}"]`), merged.inputs.length);
      const ends = await run(`[...document.querySelectorAll('#pjGraph .pj-edge[data-to="${merged.id}"] .pj-wire')].map(p => { const q = p.getPointAtLength(p.getTotalLength()); return [q.x, q.y]; })`);
      assert.equal(new Set(ends.map(J)).size, 1, 'merging arrows arrive together');
    });
    await test('a big graph opens on its boxes, not an empty corner', async () => {
      const id = await run(`pjId`), other = await run(`(() => { const q = projectCreate('Empty'); pjPick(q.id); paintProjects(); return q.id; })()`);
      await run(`pjPick(${J(id)}); paintProjects()`);
      assert.equal(await run(`(() => { const g = document.querySelector('#pjGraph').getBoundingClientRect(); return [...document.querySelectorAll('.pj-node')].some(n => { const r = n.getBoundingClientRect(); return r.left >= g.left && r.right <= g.right && r.top >= g.top && r.bottom <= g.bottom; }); })()`), true);
      await run(`projectDelete(${J(other)}); render()`);
    });
    await test('layers: every box just before its nearest dependent, finished items at the far right', async () => {
      const c = await calc(), pos = await run(`pjParts.graph.layout.pos`), cols = await run(`pjParts.graph.layout.cols`);
      c.list.forEach(n => assert.equal(pos[n.id].col, cols - 1 - n.depth, n.title));
      c.roots.forEach(id => assert.equal(pos[id].col, cols - 1, 'a finished item'));
      c.list.filter(n => n.dependents.length).forEach(n => assert.equal(pos[n.id].col, Math.min(...n.dependents.map(d => pos[d].col)) - 1));
    });
    await test('no two boxes overlap and no arrow passes through a box', async () => {
      checkShape(await shape(), 'everything');
      await run(`pjOnlyLeft = true; paintProjects()`);
      checkShape(await shape(), 'only left');
      await run(`pjProject().targets.forEach(x => { x.count = 400; }); projectExpand(pjProject()); pjOnlyLeft = false; render()`);
      checkShape(await shape(), '400 of each');
      await run(`pjProject().targets.forEach(x => { x.count = 3; }); projectExpand(pjProject()); render()`);
    });
    await test('ordering: fewer crossings on the Prehistoric set than unordered', async () => {
      const got = await run(`(() => { const out = {}, c = projectCalc(pjProject()); for (const left of [false, true]) { const ids = c.order.filter(id => !left || !c.nodes[id].done), on = new Set(ids), list = ids.map(id => ({ id, key: c.nodes[id].title + '|' + id, h: pjTall(c.nodes[id]) ? PJ_H_TALL : PJ_H })), edges = c.edges.filter(e => on.has(e.from) && on.has(e.to)); out[left ? 'left' : 'all'] = { n: ids.length, e: edges.length, ordered: pjLayout(list, edges).crossings, unordered: pjLayout(list, edges, 0).crossings, again: pjLayout([...list].reverse(), [...edges].reverse()).crossings }; } return out; })()`);
      for (const k of ['all', 'left']) {
        assert.ok(got[k].ordered < got[k].unordered, J(got[k]));
        assert.equal(got[k].again, got[k].ordered, 'the same whatever order they come in');
      }
      console.log('      crossings, ' + got.all.n + ' boxes ' + got.all.e + ' arrows: ' + got.all.ordered + ' (unordered ' + got.all.unordered + '); only what is left, ' + got.left.n + ' boxes ' + got.left.e + ' arrows: ' + got.left.ordered + ' (unordered ' + got.left.unordered + ')');
    });
    await test('the same graph is the same across ticks and saves, on the same elements', async () => {
      const look = () => run(`JSON.stringify({ at: [...document.querySelectorAll('#pjGraph .pj-node')].map(n => [n.dataset.node, n.style.left, n.style.top]), d: [...document.querySelectorAll('#pjGraph .pj-edge')].map(g => [g.dataset.from, g.dataset.to, g.querySelector('.pj-wire').getAttribute('d')]).sort(), scale: pjViewOf(pjId).scale })`);
      await run(`window.__els = [...document.querySelectorAll('#pjGraph .pj-node, #pjGraph .pj-edge, #pjGraph .pj-wire, #pjGraph svg')]; window.__els.forEach(n => { n.__mine = 1; })`);
      const same = () => run(`window.__els.every(n => n.isConnected) && [...document.querySelectorAll('#pjGraph .pj-node, #pjGraph .pj-edge, #pjGraph .pj-wire, #pjGraph svg')].every(n => n.__mine)`);
      const before = await look();
      await sleep(1200);
      assert.equal(await look(), before, 'a tick');
      assert.equal(await same(), true, 'a tick rebuilds nothing');
      const n = (await calc()).list.find(x => x.noRate && !x.done);
      await run(`projectSetRate(pjProject(), ${J(n.id)}, '50'); paintAll(); 1`);
      assert.equal(await look(), before, 'a number changing');
      assert.equal(await same(), true);
      const fill = await nodeOf('id', n.id);
      assert.ok(fill.ownHours > 0);
      await h.bump(d => { d.Lv0_0 = Array.isArray(d.Lv0_0) ? d.Lv0_0 : d.Lv0_0; });
      await sleep(100);
      assert.equal(await look(), before, 'a save');
      assert.equal(await same(), true);
      await run(`projectSetRate(pjProject(), ${J(n.id)}, ''); render(); 1`);
      await run(`pjParts.graph.sig = ''; paintProjects()`);
      assert.equal(await look(), before, 'laid out again from scratch, the same');
    });
    // real mouse
    const mouse = (type, x, y, extra = {}) => h.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
    const drag = async (x0, y0, x1, y1) => {
      await mouse('mouseMoved', x0, y0);
      await mouse('mousePressed', x0, y0);
      for (let i = 1; i <= 4; i++) await mouse('mouseMoved', x0 + (x1 - x0) * i / 4, y0 + (y1 - y0) * i / 4, { button: 'left', buttons: 1 });
      await mouse('mouseReleased', x1, y1);
      await sleep(40);
    };
    // A point in the canvas with nothing on it, away from where the view can scroll to.
    const emptySpot = () => run(`(() => { const g = document.querySelector('#pjGraph'); g.scrollIntoView({ block: 'center' }); const r = g.getBoundingClientRect(); for (let y = r.top + 10; y < r.top + g.clientHeight - 10; y += 6) for (let x = r.left + 10; x < r.left + g.clientWidth - 10; x += 6) { const at = document.elementFromPoint(x, y); if (at && g.contains(at) && !at.closest('.pj-node')) return { x, y }; } return null; })()`);
    const scroll = () => run(`(g => [g.scrollLeft, g.scrollTop])(document.querySelector('#pjGraph'))`);
    await test('drag empty space to pan, by real mouse', async () => {
      await run(`pjFit(pjParts.graph); pjNodeId = null; paintProjects(); pjParts.graph.box.scrollTo(300, 300)`);
      const [l0, t0] = await scroll(), at = await emptySpot();
      assert.ok(at, 'somewhere empty');
      await drag(at.x, at.y, at.x - 60, at.y - 40);
      const [l1, t1] = await scroll();
      assert.equal(Math.round(l1 - l0), 60);
      assert.equal(Math.round(t1 - t0), 40);
      assert.equal(await run(`pjNodeId`), null, 'selects nothing');
      assert.equal(await hasClass('#pjGraph', 'panning'), false);
    });
    await test('a drag from empty space ending on a box does not select it', async () => {
      await run(`pjParts.graph.box.scrollTo(300, 300)`);
      const at = await emptySpot(), to = await run(`(() => { const g = document.querySelector('#pjGraph').getBoundingClientRect(); const n = [...document.querySelectorAll('.pj-node')].map(x => x.getBoundingClientRect()).find(r => r.left > g.left + 10 && r.right < g.right - 10 && r.top > g.top + 10 && r.bottom < g.bottom - 10); return { x: n.left + n.width / 2, y: n.top + n.height / 2 }; })()`);
      await drag(at.x, at.y, to.x, to.y);
      assert.equal(await run(`pjNodeId`), null);
    });
    await test('a click after a small drag on a box still selects it', async () => {
      await run(`pjParts.graph.box.scrollTo(300, 300)`);
      const n = await run(`(() => { const g = document.querySelector('#pjGraph').getBoundingClientRect(); const x = [...document.querySelectorAll('.pj-node')].find(k => { const r = k.getBoundingClientRect(); return r.left > g.left + 10 && r.right < g.right - 10 && r.top > g.top + 10 && r.bottom < g.bottom - 10; }), r = x.getBoundingClientRect(); return { id: x.dataset.node, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      const before = await scroll();
      await drag(n.x, n.y, n.x + 6, n.y + 4);
      assert.equal(await run(`pjNodeId`), n.id, 'selected');
      assert.deepEqual(await scroll(), before, 'and the view stayed');
      assert.equal(await seen('#pjDetail'), true);
      await h.click('#pjDetailClose');
    });
    await test('Ctrl + wheel and the buttons zoom; a plain wheel scrolls; Fit fits', async () => {
      await run(`pjFit(pjParts.graph); pjParts.graph.box.scrollTo(200, 200)`);
      const scale = () => run(`pjViewOf(pjId).scale`), at = await emptySpot(), s0 = await scale();
      const world = () => run(`(() => { const g = pjParts.graph, r = g.box.getBoundingClientRect(), s = pjViewOf(pjId).scale; return [(${at.x} - r.left - g.box.clientLeft + g.box.scrollLeft - g.sizer.offsetLeft) / s, (${at.y} - r.top - g.box.clientTop + g.box.scrollTop - g.sizer.offsetTop) / s]; })()`);
      const w0 = await world();
      const pageZoom = await run(`devicePixelRatio`);
      await mouse('mouseMoved', at.x, at.y);
      await h.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: -240, modifiers: 2 });
      await sleep(80);
      const s1 = await scale(), w1 = await world();
      assert.ok(s1 > s0, s0 + ' to ' + s1);
      assert.ok(Math.abs(w1[0] - w0[0]) < 3 && Math.abs(w1[1] - w0[1]) < 3, 'it zooms about the mouse ' + J([w0, w1]));
      assert.equal(await run(`devicePixelRatio`), pageZoom, 'the page itself does not zoom');
      assert.equal(await text('#pjScale'), Math.round(s1 * 100) + '%');
      assert.equal(await run(`Math.abs(document.querySelector('.pj-node').getBoundingClientRect().width - 128 * pjViewOf(pjId).scale) < 1`), true);
      const before = await scroll();
      await h.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at.x, y: at.y, deltaX: 0, deltaY: 120 });
      await sleep(250);
      assert.equal(await scale(), s1, 'no Ctrl, no zoom');
      assert.ok((await scroll())[1] > before[1], 'it scrolls');
      await h.click('#pjZoomIn');
      const s2 = await scale();
      assert.ok(s2 > s1);
      await h.click('#pjZoomOut');
      await h.click('#pjZoomOut');
      assert.ok(await scale() < s1 + .001);
      for (let i = 0; i < 14; i++) await h.click('#pjZoomOut');
      assert.equal(await scale(), await run(`PJ_ZOOM_MIN`), 'it stops somewhere');
      await h.click('#pjFit');
      assert.equal(await scale(), await run(`PJ_FIT_MIN`), 'Fit stops where it can still be read, and scrolls');
      assert.ok(await run(`(g => g.scrollWidth > g.clientWidth && g.scrollHeight > g.clientHeight)(document.querySelector('#pjGraph'))`));
      const whole = sel => `(() => { const g = document.querySelector('#pjGraph').getBoundingClientRect(), r = document.querySelector(${J(sel)}).getBoundingClientRect(); return r.left >= g.left && r.top >= g.top && r.right <= g.right && r.bottom <= g.bottom; })()`;
      assert.equal(await run(whole('#pjGraph .pj-node')), true, 'and it starts at the left end of the flow, not an empty corner');
    });
    await test('a small graph fits whole, with no scrolling, on first draw', async () => {
      const p = await run(`pjId`);
      await run("pjPick(projectCreate('Small').id); render()");
      await addItem('Iron Helmet', 1e6);
      assert.equal(await run(`pjViewOf(pjId).fitted`), true);
      assert.equal(await run(`pjViewOf(pjId).scale`), 1);
      assert.equal(await run(`(g => g.scrollWidth <= g.clientWidth && g.scrollHeight <= g.clientHeight)(document.querySelector('#pjGraph'))`), true);
      const c = await calc(), root = c.list.find(n => !n.dependents.length);
      assert.ok(root.inputs.length >= 1);
      await run(`pjPick(${J(p)}); projectDelete(projects.find(x => x.name === 'Small').id); render()`);
    });
    await test('Tab walks the boxes and Enter opens one', async () => {
      await run(`pjOnlyLeft = true; pjNodeId = null; paintProjects()`);
      const ids = await run(`[...document.querySelectorAll('#pjGraph .pj-node')].map(n => n.dataset.node)`), pos = await run(`pjParts.graph.layout.pos`);
      ids.slice(1).forEach((id, i) => assert.ok(pos[id].col > pos[ids[i]].col || (pos[id].col === pos[ids[i]].col && pos[id].y > pos[ids[i]].y), 'in reading order'));
      await run(`document.querySelector('#pjFit').focus()`);
      await h.key('Tab');
      assert.equal(await run(`document.activeElement.dataset.node`), ids[0]);
      await h.key('Tab');
      assert.equal(await run(`document.activeElement.dataset.node`), ids[1]);
      assert.equal(await run(`document.activeElement.tagName`), 'BUTTON');
      await h.key('Enter');
      assert.equal(await run(`pjNodeId`), ids[1]);
      await h.key('Escape');
      assert.equal(await run(`pjNodeId`), null);
      assert.equal(await run(`document.activeElement.dataset.node`), ids[1]);
      await run(`document.activeElement.blur()`);
    });
    await test('a far-off box tabbed to scrolls into the canvas', async () => {
      const last = await run(`[...document.querySelectorAll('#pjGraph .pj-node')].pop().dataset.node`);
      await run(`pjParts.graph.box.scrollTo(0, 0); document.querySelector(${J(card(last))}).focus()`);
      await sleep(40);
      assert.equal(await run(`(() => { const r = document.querySelector(${J(card(last))}).getBoundingClientRect(), g = document.querySelector('#pjGraph').getBoundingClientRect(); return r.left >= g.left && r.right <= g.right && r.top >= g.top && r.bottom <= g.bottom; })()`), true);
      await run(`document.activeElement.blur()`);
    });
    await test('a re-layout keeps what is on screen where it was, and never leaves the view empty', async () => {
      const anyShown = `(() => { const g = document.querySelector('#pjGraph').getBoundingClientRect(); return [...document.querySelectorAll('.pj-node')].some(n => { const r = n.getBoundingClientRect(); return r.right > g.left && r.left < g.right && r.bottom > g.top && r.top < g.bottom; }); })()`;
      await run(`pjOnlyLeft = true; pjNodeId = null; pjFit(pjParts.graph); render(); pjParts.graph.box.scrollTo(700, 500)`);
      const box = await run(`(() => { const g = document.querySelector('#pjGraph').getBoundingClientRect(), cx = g.left + g.width / 2, cy = g.top + g.height / 2, x = [...document.querySelectorAll('.pj-node')].map(n => ({ id: n.dataset.node, r: n.getBoundingClientRect() })).sort((a, b) => Math.hypot(a.r.left - cx, a.r.top - cy) - Math.hypot(b.r.left - cx, b.r.top - cy))[0]; return { id: x.id, x: x.r.left, y: x.r.top }; })()`);
      await run(`pjOnlyLeft = false; paintProjects()`);
      const moved = await run(`(r => ({ x: r.left, y: r.top }))(document.querySelector(${J(card(box.id))}).getBoundingClientRect())`);
      assert.ok(Math.hypot(moved.x - box.x, moved.y - box.y) < 200, J([box, moved]));
      assert.equal(await run(anyShown), true);
      await run(`pjParts.graph.box.scrollTo(0, 0); pjParts.graph.sig = ''; paintProjects()`);
      assert.equal(await run(anyShown), true, 'not an empty corner');
      await run(`pjOnlyLeft = true; paintProjects()`);
      assert.equal(await run(anyShown), true);
    });
    await test('the selected box stays in view after a re-layout', async () => {
      const inView = id => run(`(() => { const r = document.querySelector(${J(card(id))}).getBoundingClientRect(), g = document.querySelector('#pjGraph').getBoundingClientRect(); return r.left >= g.left && r.right <= g.right && r.top >= g.top && r.bottom <= g.bottom; })()`);
      const id = await run(`[...document.querySelectorAll('#pjGraph .pj-node')].pop().dataset.node`);
      await run(`pjSelect(${J(id)}, true)`);
      assert.equal(await inView(id), true);
      await h.click('#pjOnlyLeft');
      assert.equal(await inView(id), true, 'with done things shown');
      await h.click('#pjOnlyLeft');
      assert.equal(await inView(id), true, 'and hidden again');
      await run(`pjProject().targets.forEach(x => { x.count = 400; }); projectExpand(pjProject()); render()`);
      assert.equal(await inView(id), true, 'and when the graph grows');
      await run(`pjProject().targets.forEach(x => { x.count = 3; }); projectExpand(pjProject()); render(); pjClose()`);
    });
    await test('marks: ? for no known source, a fallback when an icon fails, ! when it needs you', async () => {
      await fresh('Marks');
      await addItem('Tundra Skills Completion Token', 1e4);
      const c = await calc(), cog = c.list.find(n => n.kind === 'UNKNOWN'), root = c.list.find(n => !n.dependents.length);
      assert.ok(cog && cog.noRate, 'a material with no source');
      assert.equal(await count(card(cog.id) + ' .pj-ic img'), 0);
      assert.equal(await run(`getComputedStyle(document.querySelector(${J(card(cog.id) + ' .pj-ic')}), '::before').content`), '"?"');
      assert.equal(await seen(card(cog.id) + ' .pj-flag'), true, 'needs you');
      assert.equal(await hasClass(card(cog.id), 'stuck'), true);
      assert.equal(await count(card(root.id) + ' .pj-ic img'), 1);
      assert.equal(await run(`getComputedStyle(document.querySelector(${J(card(root.id) + ' .pj-ic img')})).imageRendering`), 'pixelated');
      await run(`new Promise(done => { const i = document.querySelector(${J(card(root.id) + ' .pj-ic img')}); i.addEventListener('error', () => setTimeout(done, 20)); i.src = 'icons/no-such-icon.png'; })`);
      assert.equal(await count(card(root.id) + ' .pj-ic img'), 0, 'removed on error');
      assert.equal(await run(`getComputedStyle(document.querySelector(${J(card(root.id) + ' .pj-ic')}), '::before').content`), J(root.title[0].toUpperCase()));
      await fresh('Marks2');
      await setOf('PREHISTORIC_SET');
      const d = await calc(), make = d.list.find(n => n.makeTask && !n.done);
      assert.equal(await seen(card(make.id) + ' .pj-flag'), true, 'Make a task needs you too');
      assert.equal(await text(card(make.id) + ' .pj-why'), 'Make a task');
    });
    await test('touch: a swipe scrolls, a tap selects', async () => {
      await run(`pjFit(pjParts.graph); pjNodeId = null; paintProjects(); pjHome(pjParts.graph)`);
      await h.setSize(400, 900);
      await h.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      try {
        await run(`document.querySelector('#pjGraph').scrollIntoView({ block: 'center' })`);
        const r = await run(`(r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))(document.querySelector('#pjGraph').getBoundingClientRect())`);
        await h.send('Input.synthesizeScrollGesture', { x: r.x, y: r.y, xDistance: -80, yDistance: -80, speed: 800 });
        await sleep(100);
        const [l, t] = await scroll();
        assert.ok(l > 20 && t > 20, 'scrolled ' + l + ', ' + t);
        const n = await run(`(() => { const g = document.querySelector('#pjGraph').getBoundingClientRect(); const x = [...document.querySelectorAll('.pj-node')].find(k => { const r = k.getBoundingClientRect(); return r.left > g.left && r.right < g.right - 8 && r.top > g.top && r.bottom < g.bottom - 8; }), r = x.getBoundingClientRect(); return { id: x.dataset.node, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await h.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: n.x, y: n.y }] });
        await sleep(40);
        await h.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(300);
        assert.equal(await run(`pjNodeId`), n.id);
        assert.equal(await hasClass('#pjGraph', 'has-hot'), false, 'a tap leaves nothing faded');
        const clear = await run(`document.querySelector(${J(card(n.id))}).getBoundingClientRect().bottom <= document.querySelector('#pjDetail').getBoundingClientRect().top`);
        assert.equal(clear, true, 'not under the sheet');
        await run(`pjClose()`);
      } finally {
        await h.send('Emulation.setTouchEmulationEnabled', { enabled: false });
        await h.setSize(1500, 1000);
      }
    });
    await test('no sideways scroll at any width, in light and dark, with the detail open or shut', async () => {
      await run(`pjOnlyLeft = false; pjProject().targets.forEach(x => { x.count = 3; }); projectExpand(pjProject()); render()`);
      const id = await run(`Object.values(projectCalc(pjProject()).nodes).find(n => !n.done).id`);
      for (const theme of ['light', 'dark']) {
        await run(`document.documentElement.dataset.theme = ${J(theme)}`);
        assert.equal(await run(`getComputedStyle(document.body).backgroundColor`), theme === 'light' ? 'rgb(237, 242, 234)' : 'rgb(20, 28, 26)');
        for (const w of [400, 979, 1500]) {
          await h.setSize(w, 900);
          await sleep(60);
          await run(`pjNodeId = null; paintProjects()`);
          assert.equal(await noSideways(), true, theme + ' ' + w + ' shut');
          assert.equal(await run(`(r => r.left >= 0 && r.right <= innerWidth)(document.querySelector('#pjGraph').getBoundingClientRect())`), true, 'the canvas fits at ' + w);
          await run(`pjSelect(${J(id)}, false)`);
          assert.equal(await noSideways(), true, theme + ' ' + w + ' open');
          assert.equal(await run(`(() => { const b = document.querySelector('#pjDetail').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; })()`), true, 'detail fits at ' + w);
          await run(`pjNodeId = null; paintProjects()`);
        }
      }
      await h.setSize(1500, 1000);
      await run(`delete document.documentElement.dataset.theme; pjOnlyLeft = true; paintProjects()`);
    });
    await test('the detail is a sheet when narrow and a side column when wide', async () => {
      const id = await run(`Object.values(projectCalc(pjProject()).nodes).find(n => !n.done).id`);
      await run(`pjSelect(${J(id)}, false)`);
      assert.equal(await run(`getComputedStyle(document.querySelector('#pjDetail')).position`), 'static');
      await h.setSize(400, 900);
      assert.equal(await run(`getComputedStyle(document.querySelector('#pjDetail')).position`), 'fixed');
      await h.click('#pjDetailClose');
      await h.setSize(1500, 1000);
    });
    await test('other tabs still work', async () => {
      for (const [tab, view] of [['#tabPlanner', 'viewPlanner'], ['#tabFinder', 'viewFinder'], ['#tabLoot', 'viewLoot'], ['#tabSimulate', 'viewSimulate'], ['#tabProjects', 'viewProjects']]) {
        await h.click(tab);
        assert.equal(await run(`$(${J(view)}).hidden`), false, view);
      }
      await run(`paintAll(); render(); 1`);
    });
    await test('no page errors', async () => assert.deepEqual(await h.pageErrors(), []));
    await test('screens: a real Prehistoric set', async () => {
      const face = `Object.values(projectCalc(pjProject()).nodes).find(n => n.makeTask && !n.done).id`;
      await fresh('Prehistoric');
      await setOf('PREHISTORIC_SET');
      await run(`pjAddOpen = true; scrollTo(0, 0)`);
      await h.shot('projects-1500-dark.png', 1500, 1000);
      await run(`document.documentElement.dataset.theme = 'light'`);
      await h.shot('projects-1500-light.png', 1500, 1000);
      await run(`pjSelect(${face}, true)`);
      await h.shot('projects-1500-detail-light.png', 1500, 1000);
      await run(`pjClose(); delete document.documentElement.dataset.theme; pjAddOpen = false; document.getElementById('activityToggle').click(); scrollTo(0, 0)`);
      await h.shot('projects-400-dark.png', 400, 900);
      await run(`document.querySelector('#pjGraph').scrollIntoView()`);
      await h.shot('projects-400-graph-dark.png', 400, 900);
      await run(`pjSelect(${face}, false)`);
      await h.shot('projects-400-detail-dark.png', 400, 900);
      await run(`document.getElementById('activityToggle').click(); pjClose()`);
      await h.setSize(1500, 1000);
    });
    /* who gets a set. Prehistoric in full-save.json, worn pieces by slot: 0 none, 1 hat shirt pants, 2 all, 3 hat, 4 all, 6 and 7 hat shirt pants. Nothing in bags or storage */
    const HAT = 'EquipmentHats123', SHIRT = 'EquipmentShirts41', PANTS = 'EquipmentPants32', SHOES = 'EquipmentShoes41', BAR = 'PrehistriumBar';
    const has = slot => run(`document.querySelector('#pjSetWho input[data-slot="${slot}"]').parentElement.querySelector('.pj-who-has').textContent`);
    const need = async raw => (await nodeOf('raw', raw))?.need;
    const nid = async raw => (await nodeOf('raw', raw)).id;
    const tick = slot => h.click(`#pjSetWho input[data-slot="${slot}"]`);
    const ticked = (box = '#pjSetWho') => run(`[...document.querySelectorAll('${box} input:checked')].map(i => +i.dataset.slot)`);
    const parse = v => typeof v === 'string' ? JSON.parse(v) : v;
    const wear = (d, slot, raw) => { const e = parse(d['EquipOrder_' + slot]), k = Object.keys(e[0]).find(i => i !== 'length' && e[0][i] === 'Blank') ?? '15'; e[0][k] = raw; d['EquipOrder_' + slot] = JSON.stringify(e); };
    const unwear = (d, slot, raw) => { const e = parse(d['EquipOrder_' + slot]); Object.keys(e[0]).forEach(k => { if (e[0][k] === raw) e[0][k] = 'Blank'; }); d['EquipOrder_' + slot] = JSON.stringify(e); };
    const bag = (d, slot, raw) => { const o = parse(d['InventoryOrder_' + slot]), q = parse(d['ItemQTY_' + slot]); o[o.indexOf('Blank')] = raw; q[o.indexOf(raw)] = 1; d['InventoryOrder_' + slot] = JSON.stringify(o); d['ItemQTY_' + slot] = JSON.stringify(q); };
    const openSet = async name => { await fresh(name); await run(`pjAddOpen = true; pjAddTab = 'set'; paintProjects()`); await pick('#pjSetPick', 'PREHISTORIC_SET'); await sleep(30); await run(`paintProjects()`); };
    await test('the set tab lists every character, none ticked, with what they have of the set', async () => {
      await openSet('Team');
      assert.equal(await count('#pjSetWho input'), await run(`rows.filter(r => r.slot != null).length`));
      assert.equal(await count('#pjSetWho .portrait'), await count('#pjSetWho input'));
      assert.deepEqual(await ticked(), []);
      assert.equal(await run(`$('pjSetGo').disabled`), true);
      assert.equal(await has(0), '0 of 4'); assert.equal(await has(1), '3 of 4'); assert.equal(await has(2), '4 of 4'); assert.equal(await has(3), '1 of 4');
      await pick('#pjSetPick', 'COPPER_SET');
      await run(`paintProjects()`);
      assert.match(await has(2), / of 3$/, 'changes with the set');
      await pick('#pjSetPick', 'PREHISTORIC_SET');
      await run(`paintProjects()`);
      assert.equal(await has(2), '4 of 4');
    });
    await test('All, None and ticks, kept across paint ticks and a poll', async () => {
      await h.click('#pjSetWho-all');
      assert.equal((await ticked()).length, await count('#pjSetWho input'));
      assert.equal(await run(`$('pjSetGo').disabled`), false);
      await h.click('#pjSetWho-none');
      assert.deepEqual(await ticked(), []);
      assert.equal(await run(`$('pjSetGo').disabled`), true);
      for (const s of [0, 1, 2]) await tick(s);
      assert.deepEqual(await ticked(), [0, 1, 2]);
      await run(`window.__box = document.querySelector('#pjSetWho input[data-slot="1"]'); window.__go = $('pjSetGo')`);
      assert.equal(await run(`document.activeElement.tagName === 'INPUT'`), false, 'a tick left focused would hold back saves');
      await sleep(1100);
      await h.poll();
      await sleep(30);
      assert.deepEqual(await ticked(), [0, 1, 2]);
      assert.equal(await run(`window.__box === document.querySelector('#pjSetWho input[data-slot="1"]') && window.__go === $('pjSetGo')`), true, 'never rebuilt');
    });
    await test('adding: each piece for those players, one box each, need is who lacks it', async () => {
      await h.click('#pjSetGo', { hold: 1100 });
      assert.deepEqual(await run(`pjProject().targets.find(x => x.raw === ${J(HAT)})`), { raw: HAT, count: 0, for: [0, 1, 2] });
      assert.deepEqual(await ticked(), []);
      assert.equal(await run(`$('pjSetGo').disabled`), true);
      assert.equal(await need(HAT), 1); assert.equal(await need(SHIRT), 1); assert.equal(await need(PANTS), 1); assert.equal(await need(SHOES), 2);
      assert.equal(await need(BAR), 550000); // hat 150k, shirt 100k, pants 100k, shoes 100k * 2
      assert.equal(await run(`pjProject().nodes.filter(n => n.raw === ${J(HAT)}).length`), 1);
      assert.equal(await text(card(await nid(SHOES)) + ' .pj-have'), '0 / 2');
      assert.equal(await text('.pj-item .pj-for'), 'for 3 players');
      assert.equal(await run(`[...document.querySelectorAll('.pj-item-count')].some(b => b.getClientRects().length)`), false, 'no count box');
      assert.equal(await seen(card(await nid(HAT)) + ' .pj-spare-mark'), true);
      assert.match(await text(card(await nid(HAT)) + ' .pj-spare-mark'), /spares?$/);
    });
    await test('the detail says who needs what, the spares, and the caution', async () => {
      const id = await nid(SHOES);
      await h.click(card(id));
      const line = await run(`[...document.querySelectorAll('#pjWhoState .pj-who-line')].map(n => n.textContent)`), name = slot => run(`rows.find(r => r.slot === ${slot}).name`);
      assert.deepEqual(line, [await name(0) + ' needs this', await name(1) + ' needs this', await name(2) + ' wearing it']);
      assert.equal(await seen('#pjSpares'), true);
      assert.match(await text('#pjSpares'), /Possible spares/);
      assert.match(await text('#pjSpares'), /It may carry upgrades only some classes benefit from\. Check it in game before using it\./);
      assert.match(await text('#pjSpares'), new RegExp(await name(4) + ' is wearing it'));
      assert.match(await text('#pjSpares'), /Use this copy/);
      const title = await run(`document.querySelector(${J(card(id))}).title`);
      assert.match(title, /Needs: /); assert.match(title, /Wearing: /); assert.match(title, /possible spare/); assert.match(title, /Check it in game/);
    });
    await test('Use this copy lowers need and materials, unticking restores, and it survives a reload', async () => {
      const box = '#pjSpares input[data-spare="worn:4:0"]';
      assert.equal(await run(`document.querySelector(${J(box)}).checked`), false);
      await run(`window.__spare = document.querySelector(${J(box)})`);
      await h.click(box);
      assert.equal(await need(SHOES), 1); assert.equal(await need(BAR), 450000);
      assert.match(await text('#pjWhoState'), /1 from a spare/);
      await sleep(1100);
      await h.poll();
      await sleep(30);
      assert.equal(await run(`window.__spare === document.querySelector(${J(box)}) && window.__spare.checked`), true, 'kept in place');
      await h.click(box);
      assert.equal(await need(SHOES), 2); assert.equal(await need(BAR), 550000);
      await h.click(box);
      const sheet = await h.savedSheet();
      assert.deepEqual(sheet.projects[0].targets.find(x => x.raw === SHOES), { raw: SHOES, count: 0, for: [0, 1, 2], use: ['worn:4:0'] });
      await h.reload();
      await run(`showTab('projects'); paintProjects()`);
      assert.equal(await need(SHOES), 1);
      await h.click(card(await nid(SHOES)));
      assert.equal(await run(`document.querySelector(${J(box)}).checked`), true);
    });
    await test('a save showing a piece worn, or in bags, drops them off; a used copy gone stops counting', async () => {
      const box = '#pjSpares input[data-spare="worn:4:0"]';
      await h.bump(d => unwear(d, 4, SHOES)); // the copy being used leaves
      assert.equal(await need(SHOES), 2); assert.equal(await need(BAR), 550000);
      assert.equal(await count(box), 0);
      await h.bump(d => wear(d, 0, HAT));
      const hat = await run(`projectCalc(pjProject()).order.map(id => projectCalc(pjProject()).nodes[id]).find(n => n.raw === ${J(HAT)})`);
      assert.equal(hat.need, 0); assert.equal(hat.done, true); assert.equal(hat.who.find(w => w.slot === 0).state, 'worn');
      assert.equal(await need(BAR), 400000); assert.equal(await need('EquipmentHats119'), undefined, 'what it\'s made from goes');
      await h.bump(d => bag(d, 1, SHOES));
      assert.equal(await need(SHOES), 1); assert.equal(await need(BAR), 300000);
      assert.match(await text('#pjWhoState'), /has it \(in bags\)/);
      await h.bump(d => { bag(d, 1, SHOES); }); // a second copy is a spare, not a fill
      assert.equal(await need(SHOES), 1);
      assert.equal(await count('#pjSpares input[data-spare="bags:1:1"]'), 1);
    });
    await test('what a spare\'s upgrades are, from the save', async () => {
      const p = await run(`(() => { projectSetRecipients(pjProject(), ${J(PANTS)}, [0]); render(); return 1; })()`);
      await h.click(card(await nid(PANTS)));
      const row = await run(`document.querySelector('#pjSpares input[data-spare="worn:2:0"]').parentElement.textContent`);
      assert.match(row, /Upgraded: /); assert.match(row, /\+220 Defence/); assert.match(row, /\+165 AGI/); assert.match(row, /11 upgrades used/);
      await h.click('#pjDetailClose');
      await run(`projectSetRecipients(pjProject(), ${J(PANTS)}, [0, 1, 2]); render()`);
    });
    const forBtn = raw => `.pj-for[data-for="${raw}"]`, editBox = raw => '#pjWhoEdit-' + raw;
    await test('editing who gets a piece, with the same checklist', async () => {
      await h.click(forBtn(PANTS));
      assert.equal(await run(`document.querySelector(${J(forBtn(PANTS))}).getAttribute('aria-expanded')`), 'true');
      assert.deepEqual(await ticked(editBox(PANTS)), [0, 1, 2]);
      await h.click(editBox(PANTS) + ' input[data-slot="3"]');
      assert.deepEqual(await run(`pjProject().targets.find(x => x.raw === ${J(PANTS)}).for`), [0, 1, 2, 3]);
      assert.equal(await need(PANTS), 2, 'slots 0 and 3 lack it');
      assert.equal(await text(forBtn(PANTS)), 'for 4 players');
      assert.match(await run(`document.querySelector(${J(editBox(PANTS))} + ' input[data-slot="2"]').parentElement.textContent`), /wearing it/);
      await sleep(1100);
      await h.poll();
      assert.deepEqual(await ticked(editBox(PANTS)), [0, 1, 2, 3]);
      await h.click(editBox(PANTS) + '-none');
      assert.equal(await text(forBtn(PANTS)), 'for 0 players');
      assert.equal(await need(PANTS), undefined, 'a blank list needs nothing, no error');
      await h.click(editBox(PANTS) + '-all');
      assert.equal(await run(`pjProject().targets.find(x => x.raw === ${J(PANTS)}).for.length`), await run(`rows.filter(r => r.slot != null).length`));
      await run(`projectSetRecipients(pjProject(), ${J(PANTS)}, [0, 1, 2]); render()`);
      await h.click(forBtn(PANTS));
      assert.equal(await seen(editBox(PANTS)), false);
    });
    await test('adding the set again merges, a plain count stays on top, typing is kept', async () => {
      await run(`pjAddTab = 'set'; paintProjects()`);
      await pick('#pjSetPick', 'PREHISTORIC_SET');
      await run(`paintProjects()`);
      await tick(5);
      await h.click('#pjSetGo');
      assert.deepEqual(await run(`pjProject().targets.find(x => x.raw === ${J(SHOES)}).for`), [0, 1, 2, 5]);
      assert.equal(await text(forBtn(SHOES)), 'for 4 players');
      const before = await need(SHOES);
      await run(`projectAddItem(pjProject(), ${J(SHOES)}, 2); render()`);
      assert.equal(await need(SHOES), before + 2);
      const count_ = `.pj-item-count[data-count="${SHOES}"]`;
      assert.equal(await seen(count_), true); assert.equal(await val(count_), '2');
      await h.type(count_, '5');
      await sleep(1100);
      await h.poll();
      assert.equal(await val(count_), '5', 'not lost');
      await h.key('Enter');
      assert.equal(await need(SHOES), before + 5);
      await h.type(count_, '0');
      await h.key('Enter');
      assert.equal(await need(SHOES), before);
      await sleep(1100);
      assert.equal(await seen(count_), false);
    });
    await test('removing, undo brings who back; reload keeps it; a plain item keeps its box', async () => {
      await h.click(`.pj-item button.x[data-raw="${SHOES}"]`);
      assert.equal(await run(`pjProject().targets.some(x => x.raw === ${J(SHOES)})`), false);
      await run(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Undo').click()`);
      assert.deepEqual((await run(`pjProject().targets.find(x => x.raw === ${J(SHOES)})`)).for, [0, 1, 2, 5]);
      await run(`projectAddItem(pjProject(), 'IronBar', 5); render()`);
      assert.equal(await seen('.pj-item-count[data-count="IronBar"]'), true);
      assert.equal(await seen(forBtn('IronBar')), false);
      await h.savedSheet();
      await h.reload();
      await run(`showTab('projects'); paintProjects()`);
      assert.equal(await text(forBtn(SHOES)), 'for 4 players');
      assert.equal((await run(`pjProject().targets.find(x => x.raw === 'IronBar')`)).count, 5);
      await run(`projectRemoveItem(pjProject(), 'IronBar'); render()`);
    });
    await test('an old project, saved before any of this, reads as it did', async () => {
      await run(`(() => { const p = projectCreate('Old one'); p.targets.push({ raw: ${J(HAT)}, count: 2 }); projectExpand(p); pjPick(p.id); render(); })()`);
      const n = await nodeOf('raw', HAT);
      assert.equal(n.need, 2); assert.equal(n.who, null); assert.equal(n.have, await run(`ownedCount([${J(HAT)}])`));
      assert.equal(await seen(card(n.id) + ' .pj-spare-mark'), false);
      assert.equal(await seen(`.pj-item-count[data-count="${HAT}"]`), true);
      await run(`projects.splice(projects.findIndex(p => p.name === 'Old one'), 1); pjPick(projects[0].id); render()`);
    });
    await test('armor set: each ticked player gets their class weapon by default, and the list says who gets which', async () => {
      await fresh('Weapons');
      await h.click('#pjTab-set');
      await pick('#pjSetPick', 'PREHISTORIC_SET');
      assert.equal(await run(`$('pjSetClassWeapon').checked`), true);
      assert.equal(await run(`$('pjSetWeapons').hidden`), true, 'no need to pick from the pool');
      await h.click('#pjSetClassWeapon');
      assert.equal(await run(`$('pjSetWeapons').hidden`), false, 'unticked: pick by hand');
      await h.click('#pjSetClassWeapon');
      await h.click('#pjSetWho input');
      const slot = await run(`+document.querySelector('#pjSetWho input:checked').dataset.slot`);
      const want = await run(`classWeapon(PROJECT_SETS.find(s => s.name === 'PREHISTORIC_SET'), rows.find(r => r.slot === ${slot}))`);
      assert.match(await text('#pjSetClassNote'), new RegExp(await run(`itemName(${J(want)})`) + ' for 1'));
      await h.click('#pjSetGo');
      assert.deepEqual(await run(`(t => t && t.for)(pjProject().targets.find(x => x.raw === ${J(want)}))`), [slot]);
      assert.equal(await run(`pjProject().targets.filter(x => PROJECT_SETS.find(s => s.name === 'PREHISTORIC_SET').weapons.includes(x.raw)).length`), 1, 'not the other classes');
    });
    await test('no sideways overflow, no page errors, with the checklist and the detail open', async () => {
      await run(`pjAddOpen = true; pjAddTab = 'set'; paintProjects()`);
      await h.click(forBtn(HAT));
      for (const w of [1500, 979, 400]) {
        await h.setSize(w);
        await sleep(60);
        assert.equal(await noSideways(), true, 'add open at ' + w);
        const id = await nid(SHOES);
        await run(`pjSelect(${J(id)}, false)`);
        await sleep(60);
        assert.equal(await noSideways(), true, 'detail open at ' + w);
        await run(`pjClose()`);
      }
      await run(`pjWhoEdit = null; paintProjects()`);
      await h.setSize(1500, 1000);
      assert.deepEqual(await h.pageErrors(), []);
    });
    await test('pictures', async () => {
      await run(`pjAddOpen = true; pjAddTab = 'set'; paintProjects()`);
      await pick('#pjSetPick', 'PREHISTORIC_SET');
      await run(`document.querySelector('#pjSetWho-all').click(); paintProjects(); scrollTo(0, 0)`);
      await h.shot('team-checklist-1500.png', 1500, 1000);
      await h.setSize(400, 900);
      await run(`document.querySelector('#pjSetWho').scrollIntoView()`);
      await h.shot('team-checklist-400.png', 400, 900);
      await run(`document.querySelector('#pjSetWho-none').click(); pjSelect(${J(await nid(SHOES))}, false); scrollTo(0, 0)`);
      await h.shot('team-detail-400.png', 400, 900);
      await h.setSize(1500, 1000);
      await h.shot('team-project-1500.png', 1500, 1000);
      await h.setSize(400, 900);
      await run(`pjClose(); pjAddOpen = false; paintProjects(); document.querySelector('#pjGraph').scrollIntoView()`);
      await h.shot('team-graph-400.png', 400, 900);
      await h.setSize(1500, 1000);
    });
  } finally {
    await h.close();
  }
  // Before the app restarts with the wider list of save fields
  const old = await start({ noPoll: true, oldFields: true, width: 1500, height: 1000, build: false });
  try {
    await test('before a restart it says so in a few words, and the rest works', async () => {
      await old.run(`showTab('projects'); { const p = projectCreate('Old'); projectAddItem(p, 'GodshardBar', 1e12); projectAddItem(p, 'EquipmentShirts41', 1); } queueSave(); render()`);
      await sleep(50);
      const say = await old.run(`document.querySelector('#pjRestart').textContent`);
      assert.match(say, /Restart the app/);
      assert.ok(say.length < 70, say);
      assert.equal(await old.run(`Object.values(projectCalc(pjProject()).nodes).find(n => n.raw === 'GodshardBar').needs`), 'Forge needs an app restart');
      assert.match(await old.run(`document.querySelector('#pjBlocked').textContent`), /Forge needs an app restart/);
      await old.click('#pjBlocked .pj-chip');
      assert.match(await old.run(`document.querySelector('#pjDetail .pj-forge').textContent`), /app restart/);
      assert.ok(await old.run(`document.querySelectorAll('.pj-node').length`) > 0);
      await old.click('#tabPlanner');
      assert.equal(await old.run(`$('viewPlanner').hidden`), false);
      assert.deepEqual(await old.pageErrors(), []);
    });
  } finally {
    await old.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
