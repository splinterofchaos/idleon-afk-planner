/* ---------- Projects tab: a project's graph, inputs on the left, finished items on the right. Everything is kept in place across the 1 s redraw ---------- */
let pjParts = null, pjId = null, pjNodeId = null, pjLooseId = null, pjHover = null, pjOnlyLeft = true, pjAddOpen = null, pjAddTab = 'item', pjNaming = null, pjCalc = null, pjDetail = null, pjItemsByName = null, pjLastHot = null, pjTouchAt = 0, pjWhoEdit = null;
const pjChipsAll = { blocked: false, ready: false }, PJ_CHIPS = { blocked: 8, ready: 12 };
const pjNodes = new Map(), pjWires = new Map(), pjViews = new Map(), pjOwners = new Map();
const PJ_W = 128, PJ_H = 120, PJ_H_TALL = 144, PJ_PAD = 20, PJ_GAP = 16, PJ_GAP_WIRE = 7, PJ_GAP_GROUP = 34, PJ_GAP_X = 70, PJ_WIRE = 6, PJ_STEM = 7, PJ_HEAD = 9;
const PJ_FIT_MIN = .7, PJ_ZOOM_MIN = .3, PJ_ZOOM_MAX = 1.6, PJ_ZOOM_STEP = 1.2, PJ_MIN_HEIGHT = 170;
const PJ_NS = 'http://www.w3.org/2000/svg', PJ_REFUSED = { cycle: 'That would make a loop.', recipe: 'A recipe sets that link.', missing: 'That node is gone.' };
const PJ_KIND = { needs: 'at the same time', after: 'after this finishes' };
try { pjId = sessionStorage.getItem(LOCAL_KEY + '-project'); } catch { /* storage blocked */ }

function pjButton(cls, text, id) {
  const b = panelButton(cls, text);
  if (id) b.id = id;
  return b;
}
function pjInput(id, label, hint) {
  const i = el('input');
  i.id = id;
  i.autocomplete = 'off';
  i.spellcheck = false;
  if (hint) i.placeholder = hint;
  if (label) i.setAttribute('aria-label', label);
  return i;
}
function pjIcon(box, name) { // only touches the image when the name changes
  if (box.dataset.icon === name) return;
  box.dataset.icon = name;
  box.textContent = '';
  if (!name) return;
  const img = el('img');
  img.alt = '';
  img.src = 'icons/' + name + '.png';
  img.addEventListener('error', () => img.remove());
  box.append(img);
}
function pjHide(node, hide) { if (node.hidden !== hide) node.hidden = hide; }
// Keeps a list's rows by key: paint runs on every row, make only for new ones.
function pjRows(box, list, keyOf, make, paint) {
  const had = box.pjHad || (box.pjHad = new Map()), seen = new Set();
  panelPlace(box, list.map(x => {
    const k = keyOf(x);
    seen.add(k);
    if (!had.has(k)) had.set(k, make(x, k));
    paint(had.get(k), x);
    return had.get(k).node;
  }));
  [...had.keys()].forEach(k => { if (!seen.has(k)) had.delete(k); });
}
// options: [value, text] or [group, [[value, text]]]. An open list is never touched.
function pjFill(select, options) {
  const shown = JSON.stringify(options);
  if (select.pjShown === shown || document.activeElement === select) return;
  const keep = select.value;
  select.pjShown = shown;
  select.textContent = '';
  const one = ([value, text]) => { const o = el('option', '', text); o.value = value; return o; };
  options.forEach(x => {
    if (!Array.isArray(x[1])) return select.append(one(x));
    const g = el('optgroup');
    g.label = x[0];
    x[1].forEach(y => g.append(one(y)));
    select.append(g);
  });
  select.value = keep;
  if (select.selectedIndex < 0) select.selectedIndex = 0;
}
const pjSetName = name => { const s = name.replace(/_SET$/, '').toLowerCase(); return s[0].toUpperCase() + s.slice(1) + ' set'; };
const pjChanged = () => { queueSave(); render(); };
const pjProject = () => projectById(pjId);
const pjWait = h => fmtWait(h, true);
function pjItems() { // what can be asked for by name: anything with a recipe, and the bars
  if (!pjItemsByName) {
    pjItemsByName = new Map();
    [...Object.keys(PROJECT_RECIPES), ...Object.keys(FORGE_BARS)].forEach(raw => { const name = itemName(raw); if (!pjItemsByName.has(name)) pjItemsByName.set(name, raw); });
  }
  return pjItemsByName;
}
function pjOwner(id) { // by id, since setState replaces the task objects
  if (!pjOwners.has(id)) pjOwners.set(id, {
    get task() { return tasks.find(t => t.id === id) || null; },
    sim: false,
    onEdit(name, value) { const t = this.task; if (t) { taskEdit(t, name, value); queueSave(); } },
  });
  return pjOwners.get(id);
}
function pjClose(back) {
  const at = pjNodeId;
  pjNodeId = pjLooseId = null;
  paintProjects();
  if (back && at && pjNodes.has(at)) pjNodes.get(at).node.focus();
}
function pjSelect(id, show) {
  pjNodeId = id;
  pjLooseId = null;
  paintProjects();
  const k = pjNodes.get(id);
  if (k && k.node.isConnected) pjReveal(k, show);
}
function pjPick(id) {
  pjId = id;
  pjNodeId = pjLooseId = pjHover = null;
  pjNaming = pjWhoEdit = null;
  try { sessionStorage.setItem(LOCAL_KEY + '-project', id || ''); } catch { /* storage blocked */ }
}

/* the bar along the top */
function pjName(mode) {
  const p = pjProject();
  pjNaming = mode;
  paintProjects();
  if (!mode) return;
  $('pjNameBox').value = mode === 'rename' && p ? p.name : '';
  $('pjNameBox').focus();
  $('pjNameBox').select();
}
function pjNameDone() {
  const box = $('pjNameBox'), text = box.value.trim();
  if (pjNaming === 'rename') {
    const p = pjProject();
    if (p && text) projectRename(p, text);
    pjNaming = null;
    queueSave();
    render();
    return;
  }
  const p = projectCreate(text);
  pjPick(p.id);
  pjAddOpen = true;
  pjAddTab = 'item';
  box.value = '';
  box.blur();
  queueSave();
  render();
  $('pjItemName').focus();
}
function pjDelete() {
  const p = pjProject();
  if (!p) return;
  const id = p.id, name = p.name, removed = projectDelete(id);
  if (!removed) return;
  pjPick(projects[0] ? projects[0].id : null);
  queueSave();
  render();
  toast('Deleted ' + name, () => { projectRestore(removed); pjPick(id); pjChanged(); });
}
function pjBuildHead() {
  const head = el('div', 'plan-head pj-head'), pick = el('label', 'fld-find pj-pick'), select = el('select');
  select.id = 'pjPick';
  select.addEventListener('change', () => { pjPick(select.value); paintProjects(); });
  pick.append(el('span', 'label', 'Project'), select);
  const add = pjButton('main', 'New project', 'pjNew'), rename = pjButton('', 'Rename', 'pjRename'), del = pjButton('', 'Delete', 'pjDelete'), acts = el('div', 'pj-acts');
  add.addEventListener('click', () => pjName('new'));
  rename.addEventListener('click', () => pjName('rename'));
  del.addEventListener('click', pjDelete);
  acts.append(add, rename, del);
  const form = el('form', 'pj-nameform'), box = pjInput('pjNameBox', 'Project name', 'Armor for LavaFlame'), go = pjButton('main', 'Create', 'pjNameGo'), stop = pjButton('', 'Cancel', 'pjNameStop');
  box.spellcheck = true;
  go.type = 'submit';
  form.noValidate = true;
  form.id = 'pjNameForm';
  form.addEventListener('submit', e => { e.preventDefault(); pjNameDone(); });
  form.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); pjName(null); } });
  stop.addEventListener('click', () => pjName(null));
  form.append(box, go, stop);
  head.append(pick, acts, form);
  return { head, select, pick, acts, rename, del, form, go, stop };
}
function pjPaintHead(q, p) {
  const none = !projects.length;
  pjFill(q.select, projects.map(x => [x.id, x.name]));
  if (p && q.select.value !== p.id && document.activeElement !== q.select) q.select.value = p.id;
  pjHide(q.pick, none);
  pjHide(q.rename, !p);
  pjHide(q.del, !p);
  const naming = pjNaming || (none ? 'new' : null);
  pjHide(q.form, !naming);
  panelPut(q.go, naming === 'rename' ? 'Save' : 'Create');
  pjHide($('pjNew'), none);
  pjHide(q.stop, none);
}

/* the summary */
function pjBuildSummary() {
  const box = el('section', 'sheet pj-sum'), top = el('div', 'pj-sum-top'), when = el('div', 'pj-when-box'), done = el('div', 'pj-done-box'), tick = el('label', 'pj-tick'), eq = el('input');
  box.id = 'pjSummary';
  const s = { box, eta: el('div', 'pj-eta'), by: el('div', 'small pj-by'), note: el('div', 'small pj-note'), count: el('div', 'pj-count'), fill: el('div', 'fill'), path: el('div', 'pj-path'), pathBox: el('div', 'pj-line'), blocked: el('div', 'pj-chips'), blockedBox: el('div', 'pj-line'), ready: el('div', 'pj-chips'), readyBox: el('div', 'pj-line'), next: el('button', 'pj-chip pj-next'), nextBox: el('div', 'pj-line') };
  s.eta.id = 'pjEta'; s.by.id = 'pjBy'; s.note.id = 'pjForgeNote'; s.count.id = 'pjDoneCount'; s.path.id = 'pjPath'; s.blocked.id = 'pjBlocked'; s.ready.id = 'pjReady';
  when.append(s.eta, s.by, s.note);
  const track = el('div', 'track');
  track.append(s.fill);
  done.append(s.count, track);
  eq.id = 'pjEquipped';
  eq.type = 'checkbox';
  eq.addEventListener('change', () => { const p = pjProject(); if (p) { projectSetEquipped(p, eq.checked); pjChanged(); } });
  tick.append(eq, 'Count equipped gear');
  s.equipped = eq;
  s.doneBox = done;
  top.append(when, done, tick);
  s.next.type = 'button';
  s.next.id = 'pjNext';
  s.pathBox.append(el('span', 'label', 'Bottleneck'), s.path);
  ['blocked', 'ready'].forEach(key => {
    const more = s[key + 'More'] = pjButton('pj-link pj-more');
    more.id = 'pjMore-' + key;
    more.addEventListener('click', () => { pjChipsAll[key] = !pjChipsAll[key]; paintProjects(); });
    const line = el('div', 'pj-chip-wrap');
    line.append(s[key], more);
    s[key + 'Box'].append(el('span', key === 'blocked' ? 'label pj-bad' : 'label pj-good', key === 'blocked' ? 'Needs you' : 'Can craft now'), line);
  });
  s.nextBox.append(el('span', 'label', 'Next to finish'), s.next);
  box.append(top, s.blockedBox, s.readyBox, s.nextBox, s.pathBox);
  return s;
}
function pjChip(cls) { return x => { const b = pjButton('pj-chip ' + cls); b.dataset.node = x.id; return { node: b, name: el('b'), why: el('span'), icon: el('span', 'pj-ic') }; }; }
function pjChipPaint(c, n) {
  if (!c.node.firstChild) c.node.append(c.icon, c.name, c.why);
  pjIcon(c.icon, n.icon);
  panelPut(c.name, n.title);
  panelPut(c.why, n.why || '');
  pjHide(c.why, !n.why);
}
function pjFold(s, key, list) {
  const more = s[key + 'More'], cap = PJ_CHIPS[key], long = list.length > cap;
  pjHide(more, !long);
  panelPut(more, pjChipsAll[key] ? 'Show fewer' : 'All ' + list.length);
  return long && !pjChipsAll[key] ? list.slice(0, cap) : list;
}
function pjPaintSummary(s, p, c, now) {
  const list = c.order.map(id => c.nodes[id]), done = list.filter(n => n.done).length, empty = !list.length;
  panelPut(s.eta, empty ? 'Nothing here yet' : c.done ? 'Ready!' : c.hours === 0 ? (list.every(n => n.done || n.move) ? 'Ready to hand out' : 'Ready to craft') : c.hours != null ? pjWait(c.hours) : 'No ETA');
  panelPut(s.by, !empty && !c.done && c.hours > 0 ? 'by ' + fmtClock(c.etaMs, now) : !empty && !c.done && c.blocked.length ? c.blocked.length + (c.blocked.length === 1 ? ' thing needs' : ' things need') + ' you' : '');
  panelPut(s.note, c.forgeNote);
  pjHide(s.note, !c.forgeNote);
  pjHide(s.doneBox, empty);
  panelPut(s.count, done + ' of ' + list.length + ' done');
  const width = (list.length ? done / list.length * 100 : 0).toFixed(1) + '%';
  if (s.fill.style.width !== width) s.fill.style.width = width;
  if (s.equipped.checked !== !!p.equipped) s.equipped.checked = !!p.equipped;
  const blocked = c.blocked.map(id => ({ ...c.nodes[id], why: c.nodes[id].needs })), ready = list.filter(n => n.ready && n.role === 'craft').map(n => ({ ...n, why: '' }));
  const soon = list.filter(n => !n.done && n.ownHours > 0 && n.hours != null).sort((a, b) => a.hours - b.hours)[0];
  const onPath = (a, b) => (c.bottleneck.includes(b.id) ? 1 : 0) - (c.bottleneck.includes(a.id) ? 1 : 0);
  pjRows(s.blocked, pjFold(s, 'blocked', blocked.sort(onPath)), x => x.id, pjChip('stuck'), pjChipPaint);
  pjRows(s.ready, pjFold(s, 'ready', ready), x => x.id, pjChip('ready'), pjChipPaint);
  pjHide(s.blockedBox, !blocked.length);
  pjHide(s.readyBox, !ready.length);
  pjHide(s.nextBox, !soon);
  if (soon) {
    s.next.dataset.node = soon.id;
    panelPut(s.next, soon.title + ' · ' + pjWait(soon.hours) + ' · ' + fmtClock(soon.etaMs, now));
  }
  const path = [...c.bottleneck].reverse().map(id => ({ id, title: c.nodes[id].title }));
  pjRows(s.path, path, x => x.id, x => { const b = pjButton('pj-step'); b.dataset.node = x.id; return { node: b }; }, (r, x) => panelPut(r.node, x.title));
  pjHide(s.pathBox, !path.length);
}

/* the graph's layout. Positions depend only on which nodes and edges there are, never on a number, so a tick or a save can't move anything */
function pjCrossings(layers) {
  let sum = 0;
  layers.forEach(list => {
    const a = [], b = [];
    list.forEach((x, i) => x.rights.forEach(o => { a.push(i); b.push(o.at); }));
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if ((a[i] - a[j]) * (b[i] - b[j]) < 0) sum++;
  });
  return sum;
}
// Barycenter sweeps with adjacent swaps; the fewest crossings seen wins.
function pjOrder(layers, sweeps) {
  const number = list => list.forEach((x, i) => { x.at = i; });
  const mean = (x, i, side) => x[side].length ? x[side].reduce((s, o) => s + o.at, 0) / x[side].length : i;
  const worse = (a, b, side) => { let n = 0; a[side].forEach(u => b[side].forEach(v => { if (u.at > v.at) n++; })); return n; };
  layers.forEach(number);
  let best = layers.map(l => [...l]), least = pjCrossings(layers);
  for (let s = 0; s < sweeps && least; s++) {
    const side = s % 2 ? 'rights' : 'lefts', cols = layers.map((_, c) => c);
    (s % 2 ? cols.reverse() : cols).forEach(c => {
      const w = new Map(layers[c].map((x, i) => [x, mean(x, i, side)]));
      layers[c].sort((a, b) => w.get(a) - w.get(b));
      number(layers[c]);
    });
    layers.forEach(list => {
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i], b = list[i + 1];
        if (worse(a, b, 'lefts') + worse(a, b, 'rights') > worse(b, a, 'lefts') + worse(b, a, 'rights')) { list[i] = b; list[i + 1] = a; a.at = i + 1; b.at = i; }
      }
    });
    const n = pjCrossings(layers);
    if (n < least) { least = n; best = layers.map(l => [...l]); }
  }
  best.forEach((l, c) => { layers[c] = l; number(l); });
  return least;
}
// Moves a layer's items as near their targets as the order and spacing allow (least squares, by merging blocks).
function pjPack(list, target) {
  const stack = [];
  let off = 0;
  list.forEach((x, i) => {
    if (i) off += list[i - 1].h + (x.dummy && list[i - 1].dummy ? PJ_GAP_WIRE : x.dummy || list[i - 1].dummy ? PJ_GAP_WIRE + 4 : PJ_GAP);
    x.off = off;
    const [t, w] = target(x);
    let b = { w, sum: (t - x.h / 2 - off) * w, items: [x] };
    while (stack.length && stack[stack.length - 1].sum / stack[stack.length - 1].w >= b.sum / b.w) { const p = stack.pop(); b = { w: p.w + b.w, sum: p.sum + b.sum, items: p.items.concat(b.items) }; }
    stack.push(b);
  });
  stack.forEach(b => b.items.forEach(x => { x.y = b.sum / b.w + x.off; }));
}
function pjStraighten(layers) {
  const tallest = Math.max(...layers.map(l => l.reduce((s, x) => s + x.h + PJ_GAP, 0)));
  layers.forEach(l => {
    const height = l.reduce((s, x) => s + x.h + PJ_GAP, 0);
    let y = (tallest - height) / 2;
    l.forEach(x => { x.y = y; y += x.h + PJ_GAP; });
  });
  const pull = (x, o) => x.dummy && o.dummy ? 8 : x.dummy || o.dummy ? 2 : 1;
  const towards = sides => x => {
    let sum = 0, w = 0;
    sides.forEach(side => x[side].forEach(o => { const k = pull(x, o); sum += (o.y + o.h / 2) * k; w += k; }));
    return w ? [sum / w, w] : [x.y + x.h / 2, .5];
  };
  const cols = layers.map((_, c) => c), back = [...cols].reverse();
  for (let i = 0; i < 12; i++) {
    cols.forEach(c => pjPack(layers[c], towards(i < 8 ? ['lefts'] : ['lefts', 'rights'])));
    back.forEach(c => pjPack(layers[c], towards(i < 8 ? ['rights'] : ['lefts', 'rights'])));
  }
}
// list: [{ id, key, h }], key decides ties. edges: [{ from, to }]; 'to' waits on 'from', and sits to its right.
function pjLayout(list, edges, sweeps = 16) {
  const items = new Map(list.map(n => [n.id, { ...n, lefts: [], rights: [], dummy: false, col: 0 }]));
  const byKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  const sorted = [...edges].sort((a, b) => byKey(items.get(a.from), items.get(b.from)) || byKey(items.get(a.to), items.get(b.to)));
  const users = new Map([...items.keys()].map(id => [id, []])), depths = new Map();
  sorted.forEach(e => users.get(e.from).push(e.to));
  // Each node sits just before its nearest dependent, so a finished item is at the far right.
  const depth = id => { if (!depths.has(id)) depths.set(id, Math.max(-1, ...users.get(id).map(depth)) + 1); return depths.get(id); };
  items.forEach((x, id) => depth(id));
  const cols = Math.max(0, ...depths.values()) + 1;
  items.forEach((x, id) => { x.col = cols - 1 - depths.get(id); });
  const dummies = new Map(), chains = sorted.map(e => {
    const a = items.get(e.from), b = items.get(e.to), chain = [a];
    for (let c = a.col + 1; c < b.col; c++) { // arrows from one node share their run across the columns, then split
      const key = e.from + '|' + c;
      if (!dummies.has(key)) dummies.set(key, { id: key, key: a.key + '|' + String(c).padStart(3, '0'), h: PJ_WIRE, dummy: true, col: c, lefts: [], rights: [] });
      chain.push(dummies.get(key));
    }
    chain.push(b);
    chain.forEach((x, i) => { if (i && !chain[i - 1].rights.includes(x)) { chain[i - 1].rights.push(x); x.lefts.push(chain[i - 1]); } });
    return { from: e.from, to: e.to, chain };
  });
  // One group per unconnected piece, stacked, biggest on top.
  const groups = [], placed = new Set();
  [...items.values()].sort(byKey).forEach(x => {
    if (placed.has(x)) return;
    const part = [], walk = [x];
    placed.add(x);
    while (walk.length) { const at = walk.pop(); part.push(at); [...at.lefts, ...at.rights].forEach(o => { if (!placed.has(o)) { placed.add(o); walk.push(o); } }); }
    groups.push(part.sort(byKey));
  });
  groups.sort((a, b) => b.length - a.length);
  let top = PJ_PAD, crossings = 0;
  const gaps = Array(Math.max(cols - 1, 0)).fill(0);
  groups.forEach(part => {
    const low = Math.min(...part.map(x => x.col)), high = Math.max(...part.map(x => x.col)), layers = Array.from({ length: high - low + 1 }, () => []), seen = new Set();
    if (sweeps) { // start from a walk back from each finished item, which keeps what belongs together together
      const walk = x => { if (seen.has(x)) return; seen.add(x); layers[x.col - low].push(x); [...x.lefts].sort(byKey).forEach(walk); };
      part.filter(x => !x.rights.length).forEach(walk);
    } else part.forEach(x => layers[x.col - low].push(x));
    crossings += pjOrder(layers, sweeps);
    pjStraighten(layers);
    const least = Math.min(...part.map(x => x.y)), most = Math.max(...part.map(x => x.y + x.h));
    part.forEach(x => { x.y = Math.round(x.y - least + top); });
    part.forEach(x => x.rights.forEach(o => { gaps[x.col] = Math.max(gaps[x.col], Math.abs(o.y + o.h / 2 - x.y - x.h / 2)); }));
    top += Math.ceil(most - least) + PJ_GAP_GROUP;
  });
  // A column gap widens with its steepest arrow, so nothing has to rise like a wall.
  const xs = [PJ_PAD];
  gaps.forEach((dy, c) => xs.push(xs[c] + PJ_W + Math.round(Math.min(PJ_GAP_X + dy * .12, PJ_GAP_X * 2.6))));
  const mid = x => x.y + x.h / 2, curve = (x0, y0, x1, y1) => { const k = (x1 - x0) / 2; return `C${x0 + k} ${y0} ${x1 - k} ${y1} ${x1} ${y1}`; };
  const wires = chains.map(({ from, to, chain }) => {
    const a = chain[0], b = chain[chain.length - 1], tip = xs[b.col], yb = mid(b);
    let x = xs[a.col] + PJ_W + PJ_STEM, y = mid(a), d = `M${xs[a.col] + PJ_W} ${y}L${x} ${y}`;
    chain.slice(1, -1).forEach(o => { const yo = mid(o); d += curve(x, y, xs[o.col], yo) + `L${xs[o.col] + PJ_W} ${yo}`; x = xs[o.col] + PJ_W; y = yo; });
    d += curve(x, y, tip - PJ_STEM * 2.4, yb) + `L${tip - PJ_HEAD} ${yb}`;
    return { from, to, d, head: `M${tip - 1} ${yb}L${tip - PJ_HEAD - 1} ${yb - PJ_HEAD * .62}L${tip - PJ_HEAD - 1} ${yb + PJ_HEAD * .62}Z` };
  });
  const pos = {};
  items.forEach((x, id) => { pos[id] = { x: xs[x.col], y: x.y, h: x.h, col: x.col }; });
  const order = [...items.keys()].sort((a, b) => pos[a].col - pos[b].col || pos[a].y - pos[b].y);
  return { pos, order, wires, crossings, cols, width: xs[Math.max(cols - 1, 0)] + PJ_W + PJ_PAD, height: top - PJ_GAP_GROUP + PJ_PAD };
}

/* a box */
function pjBuildNode(id) {
  const k = { id, node: pjButton('pj-node'), icon: el('span', 'pj-ic'), name: el('span', 'pj-name'), have: el('span', 'pj-have'), track: el('span', 'track'), fill: el('span', 'fill'), wait: el('span', 'pj-own'), why: el('span', 'pj-why'), note: el('span', 'pj-card-note'), mark: el('span', 'pj-mark', '✓'), spare: el('span', 'pj-spare-mark'), flag: el('span', 'pj-flag', '!'), tag: el('span', 'pj-tag', 'Bottleneck') };
  const row = el('span', 'pj-row');
  k.node.dataset.node = id;
  k.track.append(k.fill);
  row.append(k.have, k.wait, k.why);
  k.node.append(k.icon, k.name, k.track, row, k.note, k.mark, k.spare, k.flag, k.tag);
  return k;
}
// Who still has to be handed what's already owned: "Give char4 27,584" for food, "Give A, B a spare each" for gear.
const pjMoveText = n => n.whoFood ? 'Give ' + n.move.map(m => pjSlotName(m.slot) + ' ' + fmtNum(m.n)).join(', ') : 'Give ' + n.move.map(m => pjSlotName(m.slot)).join(', ') + (n.move.length === 1 ? ' the spare' : ' a spare each');
function pjHaveText(n) {
  if (n.who && n.need === 0) return n.have == null ? '' : n.move ? fmtNum(n.move.length) + ' of ' + fmtNum(n.who.length) + ' still to hand over' : 'none missing';
  if (n.need == null) return n.have != null ? fmtNum(n.have) : n.left != null ? fmtNum(n.left) + ' left' : '';
  const have = n.role === 'task' || n.left == null ? n.have || 0 : Math.max(n.have || 0, n.need - n.left);
  return fmtNum(have) + ' / ' + fmtNum(n.need);
}
function pjPct(n) {
  if (n.done) return 100;
  if (n.move && n.who && n.who.length) return (n.who.length - n.move.length) / n.who.length * 100;
  if (!(n.need > 0)) return 0;
  const have = n.role === 'task' || n.left == null ? n.have || 0 : Math.max(n.have || 0, n.need - n.left);
  return Math.min(have / n.need * 100, 100);
}
function pjPaintNode(k, n, c) {
  const slow = c.bottleneck.includes(n.id), stuck = !n.done && n.hours == null, makeNow = n.ready && n.role === 'craft', timed = !n.done && !makeNow && n.hours > 0;
  const why = n.done ? '' : n.move && n.hours === 0 ? pjMoveText(n) : makeNow ? 'Can craft now' : stuck && n.ownHours == null ? n.needs || 'No ETA' : '', later = stuck && !why ? n.needs : '';
  const wait = timed ? pjWait(n.ownHours > 0 ? n.ownHours : n.hours) : '', have = pjHaveText(n), note = !n.done && n.note && n.hours != null ? n.note : '', unknown = n.kind === 'UNKNOWN' || n.kind === 'other' || n.missing;
  panelAttr(k.icon, 'data-glyph', unknown ? '?' : (n.title[0] || '?').toUpperCase());
  pjIcon(k.icon, unknown ? '' : n.icon);
  panelPut(k.name, n.title);
  panelPut(k.have, have);
  panelPut(k.wait, wait);
  panelPut(k.why, why);
  panelPut(k.note, note);
  pjHide(k.note, !note);
  pjHide(k.track, n.need == null);
  pjHide(k.mark, !n.done);
  pjHide(k.flag, !(stuck && n.ownHours == null));
  pjHide(k.tag, !slow);
  const spares = n.spares ? n.spares.length : 0;
  panelPut(k.spare, spares ? spares + (spares === 1 ? ' spare' : ' spares') : '');
  pjHide(k.spare, !spares);
  const width = pjPct(n).toFixed(1) + '%';
  if (k.fill.style.width !== width) k.fill.style.width = width;
  panelAttr(k.node, 'title', [n.title, have, wait, why, later, note, pjWhoBrief(n)].filter(Boolean).join('\n'));
  const flag = (name, on) => k.node.classList.toggle(name, !!on);
  flag('done', n.done);
  flag('slow', slow);
  flag('stuck', stuck && n.ownHours == null);
  flag('ready', makeNow);
  flag('running', !n.done && (n.active || (n.role === 'forge' && n.hours != null && n.ownHours > 0)));
  flag('chosen', n.id === pjNodeId);
}

/* who a box is for */
const pjSlotName = slot => { const r = rows.find(x => x.slot === slot), held = saveFacts().held, u = held && held.units.find(x => x.slot === slot); return (r && r.name) || (u && u.name) || 'Player ' + (+slot + 1); };
const PJ_WHO = { '': 'needs this', bags: 'has it (in bags)', worn: 'wearing it' };
const pjFoodLine = w => w.state === 'full' ? 'has a full stack (' + fmtNum(w.cap) + ')' : w.state === 'part' ? 'has ' + fmtNum(w.own) + ' of ' + fmtNum(w.cap) : w.state === '' ? 'needs ' + fmtNum(w.cap) : w.state === 'nocap' ? 'has no food carry cap in the save' : 'isn’t in the save';
const pjWhoLine = w => pjSlotName(w.slot) + ' ' + ('cap' in w ? pjFoodLine(w) : PJ_WHO[w.state] ?? 'isn’t in the save');
const pjWhoShort = w => w.state === '' || w.state === 'part';
// What one player holds of one food against their carry cap, said beside their name.
function pjFoodHas(slot, raw) {
  const held = saveFacts().held, u = held && held.units.find(x => x.slot === slot);
  if (!u) return '';
  if (u.foodCap == null) return 'carry cap unknown';
  const own = foodHeld(u, raw);
  return own >= u.foodCap ? 'full stack' : own > 0 ? fmtNum(own) + ' of ' + fmtNum(u.foodCap) : 'needs ' + fmtNum(u.foodCap);
}
// The same over the foods picked: how many they have a full stack of.
function pjFoodSummary(slot, raws) {
  const held = saveFacts().held, u = held && held.units.find(x => x.slot === slot);
  if (!u) return '';
  if (u.foodCap == null) return 'carry cap unknown';
  const text = 'carries ' + fmtNum(u.foodCap);
  return raws.length ? text + ' · ' + fmtNum(raws.filter(raw => foodHeld(u, raw) >= u.foodCap).length) + ' of ' + fmtNum(raws.length) + ' full' : text;
}
const pjSpareWhere = s => s.place === 'storage' ? 'In storage' : s.place === 'bags' ? 'In ' + pjSlotName(s.slot) + '’s bags' : pjSlotName(s.slot) + ' is wearing it';
function pjWhoBrief(n) {
  if (!n.who) return '';
  const names = state => n.who.filter(w => w.state === state).map(w => pjSlotName(w.slot)).join(', '), part = (head, state) => { const list = names(state); return list ? head + ': ' + list : ''; };
  const spares = n.spares.length, used = n.whoUsed ? fmtNum(n.whoUsed) + (n.whoFood ? ' from storage and other bags' : ' from a spare') : '';
  if (n.whoFood) { const list = test => n.who.filter(test).map(w => pjSlotName(w.slot)).join(', '), short = list(pjWhoShort), full = list(w => w.state === 'full'); return [short ? 'Short: ' + short : '', full ? 'Full: ' + full : '', used].filter(Boolean).join(' · '); }
  return [[part('Needs', ''), part('In bags', 'bags'), part('Wearing', 'worn'), used].filter(Boolean).join(' · '), spares ? fmtNum(spares) + (spares === 1 ? ' possible spare. ' : ' possible spares. ') + SPARE_CAUTION : ''].filter(Boolean).join('\n');
}
// A checklist of every character. on() gives the slots ticked, put(set) changes them, text(slot) is what's said beside a name. Rows are kept, so a tick survives any redraw.
function pjWhoList(id, title, on, put, fits = () => true) {
  const box = el('div', 'pj-who'), head = el('div', 'pj-pool-head'), btns = el('span', 'pj-who-btns'), all = pjButton('pj-link', 'All', id + '-all'), none = pjButton('pj-link', 'None', id + '-none'), list = el('div', 'pj-who-list');
  box.id = id;
  btns.append(all, none);
  head.append(el('span', 'label', title), btns);
  box.append(head, list);
  const people = () => rowsInOrder().filter(r => r.slot != null && fits(r));
  let text = () => '';
  const q = { box, paint(fn) {
    text = fn || text;
    const ticked = on();
    pjRows(list, people(), r => r.slot, r => {
      const row = { node: el('label', 'pj-who-item'), tick: el('input'), port: el('span', 'pj-who-port'), name: el('span', 'pj-who-name'), has: el('span', 'small pj-who-has'), look: null };
      row.tick.type = 'checkbox';
      row.tick.dataset.slot = r.slot;
      row.tick.addEventListener('change', () => { const set = new Set(on()); if (row.tick.checked) set.add(r.slot); else set.delete(r.slot); put(set); q.paint(); });
      row.tick.addEventListener('click', e => { if (e.detail) row.tick.blur(); }); // a tick left focused would hold back the next save
      row.node.append(row.tick, row.port, row.name, row.has);
      return row;
    }, (row, r) => {
      const look = [r.hat, r.classIndex, r.cls, r.tag, r.name].join();
      if (row.look !== look) { row.look = look; row.port.textContent = ''; row.port.append(unitFace(r)); }
      if (row.tick.checked !== ticked.has(r.slot)) row.tick.checked = ticked.has(r.slot);
      panelAttr(row.node, 'title', r.name || 'Unnamed');
      panelPut(row.has, text(r.slot));
    });
  } };
  all.addEventListener('click', () => { put(new Set([...on(), ...people().map(r => r.slot)])); q.paint(); });
  none.addEventListener('click', () => { put(new Set()); q.paint(); });
  return q;
}

/* the canvas */
const pjViewOf = id => pjViews.get(id) || (pjViews.set(id, { scale: 1, fitted: true }), pjViews.get(id));
function pjShowScale(g) {
  const v = pjViewOf(pjId), lay = g.layout;
  if (!lay) return;
  g.world.style.transform = 'scale(' + v.scale + ')';
  g.sizer.style.width = Math.ceil(lay.width * v.scale) + 'px';
  g.sizer.style.height = Math.ceil(lay.height * v.scale) + 'px';
  panelPut(g.scale, Math.round(v.scale * 100) + '%');
}
const pjMaxHeight = g => Math.max(PJ_MIN_HEIGHT, Math.round(innerHeight * (g.box.offsetWidth < 620 ? .62 : .8)));
function pjSizeBox(g) {
  const h = Math.min(pjMaxHeight(g), Math.max(PJ_MIN_HEIGHT, Math.ceil(g.layout.height * pjViewOf(pjId).scale) + 2)) + 'px';
  if (g.box.style.height !== h) g.box.style.height = h;
}
// The largest scale that shows it all, but never so small it can't be read: past that, it scrolls.
function pjFit(g) {
  const v = pjViewOf(pjId), lay = g.layout, w = g.box.offsetWidth;
  if (!lay || !w) return;
  v.fitted = true;
  v.scale = Math.max(PJ_FIT_MIN, Math.min(1, (w - 2) / lay.width, (pjMaxHeight(g) - 2) / lay.height));
  g.fitWidth = w;
  pjShowScale(g);
  pjSizeBox(g);
}
function pjZoom(g, next, cx, cy) {
  const v = pjViewOf(pjId), box = g.box, r = box.getBoundingClientRect(), px = cx == null ? box.clientWidth / 2 : cx - r.left - box.clientLeft, py = cy == null ? box.clientHeight / 2 : cy - r.top - box.clientTop;
  const wx = (box.scrollLeft + px - g.sizer.offsetLeft) / v.scale, wy = (box.scrollTop + py - g.sizer.offsetTop) / v.scale;
  v.scale = Math.max(PJ_ZOOM_MIN, Math.min(PJ_ZOOM_MAX, next));
  v.fitted = false;
  pjShowScale(g);
  box.scrollLeft = wx * v.scale + g.sizer.offsetLeft - px;
  box.scrollTop = wy * v.scale + g.sizer.offsetTop - py;
}
// Scrolls the canvas only as far as it takes to show this box.
function pjKeepInView(k) {
  const box = pjParts.graph.box, b = box.getBoundingClientRect(), r = k.node.getBoundingClientRect(), edge = 14;
  const left = b.left + box.clientLeft + edge, right = b.left + box.clientLeft + box.clientWidth - edge, top = b.top + box.clientTop + edge, bottom = b.top + box.clientTop + box.clientHeight - edge;
  if (r.left < left) box.scrollLeft -= left - r.left; else if (r.right > right) box.scrollLeft += Math.min(r.right - right, r.left - left);
  if (r.top < top) box.scrollTop -= top - r.top; else if (r.bottom > bottom) box.scrollTop += Math.min(r.bottom - bottom, r.top - top);
}
// When the detail is a bottom sheet, the page moves so the box isn't under it.
function pjClearSheet(k) {
  const side = pjParts.side;
  if (side.hidden || getComputedStyle(side).position !== 'fixed') return;
  const over = k.node.getBoundingClientRect().bottom + 10 - side.getBoundingClientRect().top;
  if (over > 0) scrollBy(0, over);
}
function pjReveal(k, center) {
  if (center) k.node.scrollIntoView({ block: 'center', inline: 'center' });
  else pjKeepInView(k);
  pjClearSheet(k);
}
// The left end of the top of the flow. A big graph's corner can be empty, so never start there.
function pjHome(g) {
  const s = pjViewOf(pjId).scale, at = g.layout.pos[g.layout.order[0]];
  g.box.scrollTo(at.x * s + g.sizer.offsetLeft - 16, at.y * s + g.sizer.offsetTop - 26);
}
function pjViewEmpty(g) {
  const s = pjViewOf(pjId).scale, box = g.box, x0 = g.sizer.offsetLeft - box.scrollLeft, y0 = g.sizer.offsetTop - box.scrollTop;
  return !g.layout.order.some(id => { const at = g.layout.pos[id], x = at.x * s + x0, y = at.y * s + y0; return x < box.clientWidth && y < box.clientHeight && x + PJ_W * s > 0 && y + at.h * s > 0; });
}
function pjPlaceGraph(g, p, c, ids, edges, sig) {
  const focused = document.activeElement, fresh = g.project !== p.id, view = pjViewOf(p.id), box = g.box, old = !fresh && g.layout, was = view.scale, left = box.scrollLeft, top = box.scrollTop, ox = g.sizer.offsetLeft, oy = g.sizer.offsetTop;
  const lay = g.layout = pjLayout(ids.map(id => ({ id, key: c.nodes[id].title + '|' + id, h: pjTall(c.nodes[id]) ? PJ_H_TALL : PJ_H })), edges);
  g.sig = sig;
  g.project = p.id;
  panelPlace(g.nodes, lay.order.map(id => {
    if (!pjNodes.has(id)) pjNodes.set(id, pjBuildNode(id));
    const k = pjNodes.get(id), at = lay.pos[id];
    k.node.style.left = at.x + 'px';
    k.node.style.top = at.y + 'px';
    k.node.style.height = at.h + 'px';
    return k.node;
  }));
  if (focused && focused !== document.activeElement && focused.isConnected) focused.focus({ preventScroll: true });
  [...pjNodes.keys()].forEach(id => { if (!c.nodes[id]) pjNodes.delete(id); });
  const keep = new Set();
  lay.wires.forEach(w => {
    const key = w.from + '>' + w.to;
    keep.add(key);
    if (!pjWires.has(key)) {
      const v = { from: w.from, to: w.to, node: document.createElementNS(PJ_NS, 'g'), line: document.createElementNS(PJ_NS, 'path'), head: document.createElementNS(PJ_NS, 'path'), cls: '' };
      v.line.setAttribute('class', 'pj-wire');
      v.head.setAttribute('class', 'pj-head');
      v.node.dataset.from = w.from;
      v.node.dataset.to = w.to;
      v.node.append(v.line, v.head);
      g.svg.append(v.node);
      pjWires.set(key, v);
    }
    const v = pjWires.get(key);
    v.line.setAttribute('d', w.d);
    v.head.setAttribute('d', w.head);
  });
  [...pjWires.keys()].forEach(key => { if (!keep.has(key)) { pjWires.get(key).node.remove(); pjWires.delete(key); } });
  g.world.style.width = lay.width + 'px';
  g.world.style.height = lay.height + 'px';
  g.svg.setAttribute('width', lay.width);
  g.svg.setAttribute('height', lay.height);
  if (view.fitted) pjFit(g);
  else { pjShowScale(g); pjSizeBox(g); }
  // What's on screen stays where it was: the box nearest the middle, or the one picked.
  const screen = (at, s, x0, y0, l, t) => [at.x * s + x0 - l, at.y * s + y0 - t], mid = [box.clientWidth / 2 - PJ_W * was / 2, box.clientHeight / 2 - PJ_H * was / 2];
  let anchor = old && pjNodeId && old.pos[pjNodeId] && lay.pos[pjNodeId] ? pjNodeId : null, near = Infinity;
  if (old && !anchor) lay.order.forEach(id => { if (!old.pos[id]) return; const [x, y] = screen(old.pos[id], was, ox, oy, left, top), d = Math.hypot(x - mid[0], y - mid[1]); if (d < near) { near = d; anchor = id; } });
  if (anchor) {
    const [x, y] = screen(old.pos[anchor], was, ox, oy, left, top);
    box.scrollTo(lay.pos[anchor].x * view.scale + g.sizer.offsetLeft - x, lay.pos[anchor].y * view.scale + g.sizer.offsetTop - y);
  }
  if (fresh || pjViewEmpty(g)) pjHome(g);
  if (pjNodeId && lay.pos[pjNodeId]) pjKeepInView(pjNodes.get(pjNodeId));
}
const pjTall = n => n.role === 'forge' || n.kind === 'forge';
function pjPaintGraph(g, p, c) {
  const shown = id => { const n = c.nodes[id]; return !n.done || id === pjNodeId || n.dependents.some(d => c.nodes[d] && !c.nodes[d].done); }; // a resource stays while something unfinished still uses it, even with enough of it
  const ids = c.order.filter(id => !pjOnlyLeft || shown(id)), on = new Set(ids), edges = c.edges.filter(e => on.has(e.from) && on.has(e.to));
  const doneCount = c.order.filter(id => c.nodes[id].done).length, hiddenCount = c.order.length - ids.length;
  panelPut(g.hidden, !pjOnlyLeft ? (doneCount ? doneCount + ' done' : '') : hiddenCount ? hiddenCount + ' done hidden' : '');
  pjHide(g.none, c.order.length > 0);
  pjHide(g.allDone, !c.order.length || ids.length > 0);
  pjHide(g.box, !ids.length);
  pjHide(g.tools, !ids.length);
  pjHide(g.hint, !ids.length);
  if (!ids.length) { g.sig = ''; pjPaintHot(); return; }
  const sig = p.id + '#' + ids.map(id => id + (pjTall(c.nodes[id]) ? '+' : '')).sort().join() + '#' + edges.map(e => e.from + '>' + e.to).sort().join();
  if (sig !== g.sig) pjPlaceGraph(g, p, c, ids, edges, sig);
  ids.forEach(id => pjPaintNode(pjNodes.get(id), c.nodes[id], c));
  pjPaintHot();
}
// What's lit: the box hovered or keyboard-focused, which fades the rest, otherwise the one picked.
function pjPaintHot() {
  const g = pjParts.graph, c = pjCalc, live = pjHover && c && c.nodes[pjHover] && pjNodes.has(pjHover) && pjNodes.get(pjHover).node.isConnected ? pjHover : null, id = live || (pjNodeId && c && c.nodes[pjNodeId] ? pjNodeId : null), n = id ? c.nodes[id] : null;
  if (g.box.classList.contains('has-hot') !== !!live) g.box.classList.toggle('has-hot', !!live);
  const shown = JSON.stringify([id, g.sig]);
  if (shown !== pjLastHot) {
    pjLastHot = shown;
    pjNodes.forEach((k, key) => {
      k.node.classList.toggle('hot', key === id);
      k.node.classList.toggle('hot-in', !!n && n.inputs.includes(key));
      k.node.classList.toggle('hot-out', !!n && n.dependents.includes(key));
    });
  }
  if (!c) return;
  const slow = new Set(c.bottleneck.slice(1).map((x, i) => x + '>' + c.bottleneck[i])), kinds = new Map(c.edges.map(e => [e.from + '>' + e.to, e.kind]));
  pjWires.forEach((v, key) => {
    const on = slow.has(key), lit = v.to === id ? ' hot-in' : v.from === id ? ' hot-out' : '', from = c.nodes[v.from];
    const cls = 'pj-edge' + (kinds.get(key) === 'after' ? ' after' : '') + (from && from.done ? ' done' : '') + (on ? ' slow' : '') + lit;
    if (v.cls === cls) return;
    v.cls = cls;
    v.node.setAttribute('class', cls);
    if (on || lit) g.svg.append(v.node); // on top of what it crosses
  });
}

/* adding things */
function pjBuildAdd() {
  const a = { box: el('section', 'sheet pj-add'), toggle: pjButton('pn-toggle pj-add-toggle', '', 'pjAddToggle'), body: el('div', 'pj-add-body'), tabs: el('div', 'pj-tabs'), items: el('div', 'pj-items'), itemForm: el('form', 'pj-form'), setForm: el('form', 'pj-form'), foodForm: el('form', 'pj-form'), taskForm: el('div', 'pj-form') };
  a.items.id = 'pjItems';
  a.toggle.addEventListener('click', () => { pjAddOpen = !pjAddOpen; paintProjects(); });
  [['item', 'Item'], ['set', 'Armor set'], ['food', 'Golden food'], ['task', 'Any task']].forEach(([key, text]) => {
    const b = pjButton('', text, 'pjTab-' + key);
    b.addEventListener('click', () => { pjAddTab = key; paintProjects(); });
    a.tabs.append(b);
  });
  pjBuildItemForm(a);
  pjBuildSetForm(a);
  pjBuildFoodForm(a);
  pjBuildTaskForm(a);
  a.body.append(a.tabs, a.itemForm, a.setForm, a.foodForm, a.taskForm, a.items);
  a.box.append(a.toggle, a.body);
  a.items.addEventListener('change', e => {
    const raw = e.target.dataset.count, p = pjProject();
    if (!raw || !p) return;
    if (projectSetCount(p, raw, e.target.value)) { e.target.removeAttribute('aria-invalid'); pjChanged(); }
    else { const had = p.targets.find(x => x.raw === raw); e.target.value = had ? had.count : ''; e.target.removeAttribute('aria-invalid'); }
  });
  a.items.addEventListener('input', e => {
    const raw = e.target.dataset.count, p = pjProject(), had = raw && p && p.targets.find(x => x.raw === raw), n = raw ? parseNum(e.target.value) : 0;
    if (raw) e.target.setAttribute('aria-invalid', String(!(n > 0 || (n === 0 && had && had.for))));
  });
  a.items.addEventListener('keydown', e => { if (e.target.dataset.count && e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  return a;
}
function pjBuildItemForm(a) {
  const name = pjInput('pjItemName', '', 'Prehistoric Parka'), count = pjInput('pjItemCount', '', '1'), go = pjButton('main', 'Add', 'pjItemGo'), list = el('datalist'), msg = el('p', 'pj-msg');
  list.id = 'pjItemNames';
  list.append(...[...pjItems().keys()].sort().map(x => { const o = el('option'); o.value = x; return o; }));
  name.type = 'search';
  name.setAttribute('list', 'pjItemNames');
  count.inputMode = 'decimal';
  go.type = 'submit';
  msg.id = 'pjItemMsg';
  msg.setAttribute('role', 'status');
  const row = el('div', 'pj-form-row');
  row.append(labelled('Count', count));
  row.append(go);
  const which = el('label', 'fld-find');
  which.append(el('span', 'label', 'Item to make'), name);
  a.itemForm.noValidate = true;
  a.itemForm.append(which, row, msg, list);
  a.itemForm.addEventListener('submit', e => {
    e.preventDefault();
    const p = pjProject(), raw = pjItems().get(name.value.trim()), n = count.value.trim() === '' ? 1 : parseNum(count.value);
    name.setAttribute('aria-invalid', String(!raw));
    count.setAttribute('aria-invalid', String(!(n > 0)));
    panelPut(msg, !raw ? 'No craftable item has that name.' : n > 0 ? '' : 'Enter a count.');
    if (!p || !raw || !(n > 0)) return;
    projectAddItem(p, raw, n);
    name.value = count.value = '';
    pjChanged();
  });
}
function pjSetChecks(box, title, raws, need) {
  box.textContent = '';
  box.hidden = !raws.length;
  if (!raws.length) return;
  const head = el('div', 'pj-pool-head'), all = pjButton('pj-link', 'All');
  all.dataset.all = '1';
  head.append(el('span', 'label', title + (need ? ' · bonus needs ' + need : '')), all);
  box.append(head);
  raws.forEach(raw => {
    const line = el('label', 'pj-pool-item'), tick = el('input'), icon = el('span', 'pj-ic');
    tick.type = 'checkbox';
    tick.value = raw;
    pjIcon(icon, raw);
    line.append(tick, icon, el('span', '', itemName(raw)));
    box.append(line);
  });
}
function pjBuildSetForm(a) {
  const select = el('select'), armor = el('p', 'small pj-armor'), tools = el('div', 'pj-pool'), weapons = el('div', 'pj-pool'), go = pjButton('main', 'Add set', 'pjSetGo'), pick = el('label', 'fld-find'), on = new Set();
  const classBox = el('div', 'pj-pool'), classLine = el('label', 'pj-pool-item'), classTick = el('input'), classNote = el('p', 'small pj-armor');
  const paintClassNote = () => {
    const s = PROJECT_SETS.find(x => x.name === select.value), counts = new Map();
    let without = 0;
    if (!s) return;
    on.forEach(slot => { const raw = classWeapon(s, rows.find(r => r.slot === slot)); if (raw) counts.set(raw, (counts.get(raw) || 0) + 1); else without++; });
    const list = [...counts].map(([raw, n]) => itemName(raw) + ' for ' + n);
    panelPut(classNote, !classTick.checked ? '' : !on.size ? 'Tick players to see who gets which.' : [list.join(', '), without ? 'this set has none for ' + without : ''].filter(Boolean).join('; '));
  };
  const who = pjWhoList('pjSetWho', 'Who gets it', () => on, set => { on.clear(); set.forEach(x => on.add(x)); paintClassNote(); paintProjects(); });
  classBox.id = 'pjSetClass';
  classTick.type = 'checkbox';
  classTick.id = 'pjSetClassWeapon';
  classTick.checked = true;
  classNote.id = 'pjSetClassNote';
  classLine.append(classTick, el('span', '', 'Each player gets their class’s weapon'));
  classBox.append(classLine, classNote);
  a.setWho = who;
  a.setOn = on;
  a.setGo = go;
  a.setPick = select;
  select.id = 'pjSetPick';
  tools.id = 'pjSetTools';
  weapons.id = 'pjSetWeapons';
  armor.id = 'pjSetArmor';
  go.type = 'submit';
  PROJECT_SETS.forEach(s => { const o = el('option', '', pjSetName(s.name)); o.value = s.name; select.append(o); });
  const show = () => {
    const s = PROJECT_SETS.find(x => x.name === select.value);
    armor.textContent = 'Armor: ' + s.armors.map(itemName).join(', ');
    pjSetChecks(tools, 'Tools', s.tools, s.requiredTools);
    pjSetChecks(weapons, 'Weapons', s.weapons, s.requiredWeapon);
    classBox.hidden = !s.weapons.length;
    weapons.hidden = !s.weapons.length || classTick.checked;
    paintClassNote();
  };
  select.addEventListener('change', show);
  classTick.addEventListener('change', () => { weapons.hidden = classTick.checked || !PROJECT_SETS.find(x => x.name === select.value).weapons.length; paintClassNote(); });
  classTick.addEventListener('click', e => { if (e.detail) classTick.blur(); }); // a tick left focused would hold back the next save
  pick.append(el('span', 'label', 'Set'), select);
  [tools, weapons].forEach(box => box.addEventListener('click', e => {
    if (!e.target.dataset.all) return;
    const ticks = [...box.querySelectorAll('input')], on = !ticks.every(t => t.checked);
    ticks.forEach(t => { t.checked = on; });
  }));
  a.setForm.noValidate = true;
  a.setForm.append(pick, armor, who.box, tools, classBox, weapons, go);
  a.setForm.addEventListener('submit', e => {
    e.preventDefault();
    const p = pjProject(), ticked = box => [...box.querySelectorAll('input:checked')].map(t => t.value);
    if (!p || !on.size) return;
    projectAddSet(p, select.value, { tools: ticked(tools), weapons: classTick.checked ? [] : ticked(weapons), classWeapons: classTick.checked, for: [...on] });
    on.clear();
    show();
    pjChanged();
  });
  show();
}
function pjBuildFoodForm(a) {
  const foods = el('div', 'pj-pool'), go = pjButton('main', 'Add foods', 'pjFoodGo'), on = new Set(), note = el('p', 'small pj-armor', 'Each player gets a full stack: as many as they can carry. What’s in their food slots and bags counts, then storage and others’ bags fill the rest.');
  const who = pjWhoList('pjFoodWho', 'Who gets them', () => on, set => { on.clear(); set.forEach(x => on.add(x)); paintProjects(); });
  foods.id = 'pjFoodPick';
  pjSetChecks(foods, 'Golden foods', projectGoldenFoods());
  foods.addEventListener('click', e => {
    if (!e.target.dataset.all) return;
    const ticks = [...foods.querySelectorAll('input')], all = !ticks.every(t => t.checked);
    ticks.forEach(t => { t.checked = all; });
    paintProjects();
  });
  foods.addEventListener('change', () => paintProjects());
  go.type = 'submit';
  a.foodWho = who;
  a.foodOn = on;
  a.foodGo = go;
  a.foodPick = foods;
  a.foodForm.noValidate = true;
  a.foodForm.append(note, foods, who.box, go);
  a.foodForm.addEventListener('submit', e => {
    e.preventDefault();
    const p = pjProject(), raws = [...foods.querySelectorAll('input:checked')].map(t => t.value);
    if (!p || !on.size || !raws.length) return;
    projectAddFoods(p, raws, [...on]);
    on.clear();
    foods.querySelectorAll('input').forEach(t => { t.checked = false; });
    pjChanged();
  });
}
// A task an item here already covers gives back that item's node, which has no card while what's owned is enough.
function pjAdded(p, n, msg) {
  const shown = n && projectCalc(p).nodes[n.id];
  panelPut(msg, n && !shown ? 'An item here already covers that, and you have enough.' : '');
  if (shown) pjNodeId = n.id;
  pjChanged();
}
function pjBuildTaskForm(a) {
  const pick = el('select'), add = pjButton('main', 'Add', 'pjTaskGo'), row = el('div', 'pj-form-row pj-wide'), which = el('label', 'fld-find');
  pick.id = 'pjTaskPick';
  which.append(el('span', 'label', 'A task you already have'), pick);
  row.append(which, add);
  add.addEventListener('click', () => {
    const p = pjProject();
    if (!p || !pick.value) return;
    const n = projectAddTask(p, pick.value);
    pick.value = '';
    pjAdded(p, n, msg);
  });
  const form = el('form', 'pj-form pj-new'), type = el('select'), bar = el('select'), name = pjInput('pjNewName', '', 'Pearler Shell'), amount = pjInput('pjNewAmount', '', '50k'), go = pjButton('', 'Create and add', 'pjNewGo'), msg = el('p', 'pj-msg');
  type.id = 'pjNewType';
  bar.id = 'pjNewBar';
  name.type = 'search';
  name.setAttribute('list', 'finderNames');
  amount.inputMode = 'decimal';
  go.type = 'submit';
  msg.id = 'pjNewMsg';
  msg.setAttribute('role', 'status');
  [['item', 'Collect an item'], ['forge', 'Wait on the forge']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; type.append(o); });
  Object.keys(FORGE_BARS).forEach(raw => { const o = el('option', '', itemName(raw)); o.value = raw; bar.append(o); });
  const wrap = (label, c) => { const box = el('label', 'fld-find'); box.append(el('span', 'label', label), c); return box; };
  const typeBox = wrap('New task', type), barBox = wrap('Bar', bar), nameBox = wrap('Item', name), amountBox = wrap('Amount', amount);
  const kind = () => { barBox.hidden = type.value !== 'forge'; nameBox.hidden = type.value === 'forge'; };
  type.addEventListener('change', kind);
  kind();
  form.noValidate = true;
  form.append(typeBox, barBox, nameBox, amountBox, go, msg);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const p = pjProject(), text = amount.value.trim(), bad = !blankText(text) && !(parseNum(text) > 0), item = name.value.trim();
    if (!p) return;
    amount.setAttribute('aria-invalid', String(bad));
    if (bad) return panelPut(msg, 'Enter an amount.');
    let n;
    if (type.value === 'forge') {
      const t = forgeTask(bar.value);
      if (text) taskEdit(t, 'amount', text);
      n = projectAddTask(p, t.id);
    } else {
      if (!rawNamesOf(item).length) return panelPut(msg, 'No item has that name.');
      const drops = rawNamesOf(item).map(dropOptions).find(list => list.length) || [];
      n = projectNewTask(p, { type: 'item', itemName: item, ...itemSourceFields(bestDropOption(drops)), amount: text, ...(text ? { amountAuto: false } : {}), starred: true });
    }
    name.value = amount.value = '';
    pjAdded(p, n, msg);
  });
  a.taskForm.append(row, form);
  a.taskPick = pick;
}
function pjPaintAdd(a, p, c) {
  if (pjAddOpen == null) pjAddOpen = !p.targets.length || $('viewProjects').clientWidth >= 860;
  const hand = p.nodes.filter(n => n.hand && !n.raw), count = p.targets.length + hand.length;
  panelPut(a.toggle, 'Add to this project' + (count ? ' · ' + count + ' added' : ''));
  panelAttr(a.toggle, 'aria-expanded', String(pjAddOpen));
  pjHide(a.body, !pjAddOpen);
  if (!pjAddOpen) return;
  ['item', 'set', 'food', 'task'].forEach(key => panelAttr($('pjTab-' + key), 'aria-pressed', String(pjAddTab === key)));
  pjHide(a.itemForm, pjAddTab !== 'item');
  pjHide(a.setForm, pjAddTab !== 'set');
  pjHide(a.foodForm, pjAddTab !== 'food');
  pjHide(a.taskForm, pjAddTab !== 'task');
  if (pjAddTab === 'set') {
    const armors = PROJECT_SETS.find(s => s.name === a.setPick.value).armors;
    a.setWho.paint(slot => fmtNum(armors.filter(raw => slotHolds(slot, raw)).length) + ' of ' + fmtNum(armors.length));
    if (a.setGo.disabled !== !a.setOn.size) a.setGo.disabled = !a.setOn.size;
  }
  if (pjAddTab === 'food') {
    const raws = [...a.foodPick.querySelectorAll('input:checked')].map(t => t.value), off = !a.foodOn.size || !raws.length;
    a.foodWho.paint(slot => pjFoodSummary(slot, raws));
    if (a.foodGo.disabled !== off) a.foodGo.disabled = off;
  }
  if (pjAddTab === 'task') {
    pjFill(a.taskPick, [['', 'Choose a task'], ...simList()]);
  }
  const list = [...p.targets.map(x => ({ key: 't:' + x.raw, raw: x.raw, count: x.count || 0, who: Array.isArray(x.for) ? projectFor(x) : null, fill: !!x.fill, title: itemName(x.raw), icon: x.raw })), ...hand.map(n => ({ key: 'n:' + n.id, id: n.id, title: c.nodes[n.id] ? c.nodes[n.id].title : projectTitle(n), icon: c.nodes[n.id] ? c.nodes[n.id].icon : '' }))];
  pjRows(a.items, list, x => x.key, x => {
    const r = { node: el('div', 'pj-item'), icon: el('span', 'pj-ic'), name: el('span', 'pj-item-name'), box: null, x: pjButton('x', '×'), forBtn: pjButton('pj-link pj-for'), plus: el('span', 'small pj-plus', '+'), edit: null };
    r.node.append(r.icon, r.name);
    if (x.raw) {
      r.forBtn.dataset.for = x.raw;
      r.forBtn.addEventListener('click', () => { pjWhoEdit = pjWhoEdit === x.raw ? null : x.raw; paintProjects(); });
      r.node.append(r.forBtn, r.plus);
      r.box = pjInput('', 'Count of ' + x.title);
      r.box.dataset.count = x.raw;
      r.box.inputMode = 'decimal';
      r.box.className = 'pj-item-count';
      r.node.append(r.box);
    } else if (x.id) r.name.dataset.node = x.id;
    r.x.dataset.raw = x.raw || '';
    r.x.setAttribute('aria-label', 'Remove ' + x.title);
    r.x.addEventListener('click', () => pjRemoveAdded(x));
    r.node.append(r.x);
    return r;
  }, (r, x) => {
    pjIcon(r.icon, x.icon);
    panelPut(r.name, x.title);
    panelAttr(r.name, 'title', x.title);
    const text = fmtNum(x.count, 6);
    if (r.box && document.activeElement !== r.box && r.box.value !== text) r.box.value = text;
    if (!x.raw) return;
    const open = !!x.who && pjWhoEdit === x.raw;
    pjHide(r.forBtn, !x.who);
    if (x.who) { panelPut(r.forBtn, 'for ' + fmtNum(x.who.length) + (x.who.length === 1 ? ' player' : ' players')); panelAttr(r.forBtn, 'aria-expanded', String(open)); panelAttr(r.forBtn, 'title', x.who.map(pjSlotName).join(', ') || 'Nobody yet'); }
    const extra = x.count > 0 || document.activeElement === r.box;
    pjHide(r.plus, !x.who || !extra);
    pjHide(r.box, !!x.who && !extra);
    panelAttr(r.box, 'title', x.who ? 'Extra, on top of the players' : '');
    if (open && !r.edit) {
      const own = () => { const q = pjProject(); return q && q.targets.find(y => y.raw === x.raw); };
      r.edit = pjWhoList('pjWhoEdit-' + x.raw, 'Who gets it', () => new Set(own() ? projectFor(own()) : []), set => { const q = pjProject(); if (q && projectSetRecipients(q, x.raw, [...set])) pjChanged(); }, r => itemFitsPlayer(x.raw, r));
      r.edit.box.classList.add('pj-who-edit');
      r.node.append(r.edit.box);
    }
    if (r.edit) {
      pjHide(r.edit.box, !open);
      if (open) r.edit.paint(slot => { if (x.fill) return pjFoodHas(slot, x.raw); const at = slotHolds(slot, x.raw); return at === 'worn' ? 'wearing it' : at === 'bags' ? 'in bags' : 'needs it'; });
    }
  });
}
function pjRemoveAdded(x) {
  const p = pjProject();
  if (!p) return;
  if (x.raw) {
    const had = p.targets.find(y => y.raw === x.raw);
    projectRemoveItem(p, x.raw);
    queueSave();
    render();
    toast('Removed ' + x.title, () => { const q = pjProject(); if (q && had && projectRestoreItem(q, had)) pjChanged(); });
    return;
  }
  projectRemoveNode(p, x.id);
  if (pjNodeId === x.id) pjNodeId = null;
  pjChanged();
}

/* the side detail of one node */
function pjBuildDetail(key) {
  const d = { key, box: el('div', 'pj-detail-in'), head: el('div', 'pj-d-head'), icon: el('span', 'pj-ic'), title: el('div', 'pj-d-title'), state: el('div', 'small pj-d-state'), close: pjButton('x pj-d-close', '×', 'pjDetailClose'), nums: el('dl', 'pj-nums-list'), parts: el('p', 'small pj-d-parts'), open: pjButton('pj-link pj-d-open', 'Open on AFK planner', 'pjOpenPlanner'), forge: el('div', 'pj-d-block pj-forge'), make: el('form', 'pj-d-block pj-make'), rate: el('div', 'pj-d-block pj-rate'), who: el('div', 'pj-d-block pj-who-state'), whoList: el('div', 'pj-who-lines'), whoMore: el('p', 'small'), spare: el('div', 'pj-d-block pj-spares'), spareList: el('div', 'pj-spare-list'), host: el('div', 'sheet pj-editor'), edges: el('div', 'pj-d-block pj-edges'), remove: pjButton('', 'Remove from project', 'pjRemoveNode'), removeItem: pjButton('', 'Remove this item', 'pjRemoveItem'), addHere: pjButton('main', 'Add to this project', 'pjAddLoose'), editorShown: null };
  const names = el('div', 'pj-d-names');
  names.append(d.title, d.state);
  d.close.setAttribute('aria-label', 'Close details');
  d.close.addEventListener('click', () => pjClose(true));
  d.head.append(d.icon, names, d.close);
  d.who.id = 'pjWhoState';
  d.who.append(el('h4', 'label', 'Players'), d.whoList, d.whoMore);
  d.spare.id = 'pjSpares';
  d.spare.append(el('h4', 'label', 'Possible spares'), el('p', 'small pj-caution', SPARE_CAUTION), d.spareList);
  // forge
  d.forgeLine = el('p', 'pj-d-line');
  d.forgeOre = el('p', 'small');
  d.forgeOut = el('p', 'small pj-d-warn');
  d.forgeSlots = el('div', 'pj-slots');
  d.forge.append(el('h4', 'label', 'Forge'), d.forgeLine, d.forgeOre, d.forgeOut, d.forgeSlots, el('p', 'small pj-note', 'does not consider extra bar chance'));
  // make a task
  d.makeFrom = el('select');
  d.makeFrom.id = 'pjMakeFrom';
  d.makeFromBox = el('label', 'fld-find');
  d.makeFromBox.append(el('span', 'label', 'From'), d.makeFrom);
  const makeGo = pjButton('main', 'Make task', 'pjMakeTask');
  makeGo.type = 'submit';
  d.make.noValidate = true;
  d.make.append(d.makeFromBox, makeGo);
  d.make.addEventListener('submit', e => {
    e.preventDefault();
    const p = pjProject();
    if (!p) return;
    if (projectMakeTask(p, pjNodeId, { monster: d.makeFrom.value || undefined })) pjChanged();
  });
  // typed rate
  d.rateBox = pjInput('pjRate', 'Amount per hour', '20');
  d.rateBox.inputMode = 'decimal';
  d.rate.append(labelled('Per hour', d.rateBox, true), el('p', 'small', 'Nothing in the save says how fast this comes. Type a rate to time it.'));
  d.rateBox.addEventListener('input', () => {
    const p = pjProject();
    d.rateBox.setAttribute('aria-invalid', String(Number.isNaN(parseNum(d.rateBox.value))));
    if (p) { projectSetRate(p, pjNodeId, d.rateBox.value); queueSave(); paintAll(); }
  });
  d.rateBox.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); d.rateBox.blur(); } });
  // links
  d.inHead = el('h4', 'label', 'Needs');
  d.inList = el('div', 'pj-edge-list');
  d.outHead = el('h4', 'label', 'Used by');
  d.outList = el('div', 'pj-edge-list');
  d.inList.id = 'pjNeedsList';
  d.outList.id = 'pjUsedList';
  d.edgeWay = el('select');
  d.edgeWay.id = 'pjEdgeWay';
  d.edgeWay.setAttribute('aria-label', 'Which way');
  [['in', 'This waits on'], ['out', 'This holds up']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; d.edgeWay.append(o); });
  d.edgeOther = el('select');
  d.edgeOther.id = 'pjEdgeOther';
  d.edgeOther.setAttribute('aria-label', 'Other node');
  d.edgeKind = el('select');
  d.edgeKind.id = 'pjEdgeKind';
  d.edgeKind.setAttribute('aria-label', 'When');
  Object.entries(PJ_KIND).reverse().forEach(([v, t]) => { const o = el('option', '', t); o.value = v; d.edgeKind.append(o); });
  const addEdge = pjButton('', 'Add link', 'pjEdgeGo'), form = el('form', 'pj-edge-form');
  addEdge.type = 'submit';
  d.edgeMsg = el('p', 'pj-msg');
  d.edgeMsg.id = 'pjEdgeMsg';
  d.edgeMsg.setAttribute('role', 'status');
  form.noValidate = true;
  form.append(d.edgeWay, d.edgeOther, d.edgeKind, addEdge);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const p = pjProject(), other = d.edgeOther.value;
    if (!p || !other) return;
    const inward = d.edgeWay.value === 'in', got = projectAddEdge(p, inward ? other : pjNodeId, inward ? pjNodeId : other, d.edgeKind.value);
    panelPut(d.edgeMsg, got.ok ? '' : PJ_REFUSED[got.reason] || 'That can’t be linked.');
    if (got.ok) { d.edgeOther.value = ''; pjChanged(); }
  });
  d.edges.append(d.inHead, d.inList, d.outHead, d.outList, form, d.edgeMsg);
  d.remove.addEventListener('click', () => {
    const p = pjProject(), id = pjNodeId;
    if (!p) return;
    const got = projectRemoveNode(p, id);
    if (got.ok) { pjNodeId = null; pjChanged(); }
  });
  d.removeItem.addEventListener('click', () => {
    const p = pjProject(), n = p && projectNode(p, pjNodeId);
    if (n && n.raw) { pjNodeId = null; pjRemoveAdded({ raw: n.raw, title: itemName(n.raw) }); }
  });
  d.open.addEventListener('click', () => { const t = pjDetailTask(); if (t) panelOpenTask(t); });
  d.addHere.addEventListener('click', () => {
    const p = pjProject(), id = pjLooseId;
    if (!p || !id) return;
    const n = projectAddTask(p, id);
    pjLooseId = null;
    pjNodeId = n ? n.id : null;
    pjChanged();
  });
  const foot = el('div', 'pj-d-foot');
  foot.append(d.remove, d.removeItem, d.addHere);
  d.box.append(d.head, d.nums, d.who, d.spare, d.parts, d.open, d.forge, d.make, d.rate, d.host, d.edges, foot);
  wireTaskEditors(d.host, node => pjOwner(node.dataset.task));
  return d;
}
function pjDetailTask() {
  if (pjLooseId) return tasks.find(t => t.id === pjLooseId) || null;
  const p = pjProject(), n = p && pjNodeId && projectNode(p, pjNodeId);
  return n ? projectNodeTask(n) : null;
}
function pjNum(d, key, label, text) {
  d.numRows = d.numRows || {};
  if (!d.numRows[key]) {
    const row = el('div'), value = el('dd');
    row.append(el('dt', '', label), value);
    row.dataset.num = key;
    d.nums.append(row);
    d.numRows[key] = { row, value };
  }
  pjHide(d.numRows[key].row, text == null || text === '');
  panelPut(d.numRows[key].value, text ?? '');
}
function pjEdgeRow(dir) {
  return x => {
    const r = { node: el('div', 'pj-edge'), name: pjButton('pj-step pj-edge-name'), kind: pjButton('pj-kind'), x: pjButton('x', '×'), fixed: el('span', 'small') };
    r.name.dataset.node = x.id;
    r.kind.addEventListener('click', () => {
      const p = pjProject(), [from, to] = dir === 'in' ? [x.id, pjNodeId] : [pjNodeId, x.id], now = p && p.edges.find(e => e.from === from && e.to === to);
      if (now) { projectSetEdgeKind(p, from, to, now.kind === 'needs' ? 'after' : 'needs'); pjChanged(); }
    });
    r.x.addEventListener('click', () => {
      const p = pjProject(), [from, to] = dir === 'in' ? [x.id, pjNodeId] : [pjNodeId, x.id];
      if (p && projectRemoveEdge(p, from, to).ok) pjChanged();
    });
    r.x.setAttribute('aria-label', 'Remove link');
    r.node.append(r.name, r.fixed, r.kind, r.x);
    return r;
  };
}
function pjEdgePaint(r, x) {
  panelPut(r.name, x.title + (x.done ? ' ✓' : ''));
  panelAttr(r.name, 'title', x.title);
  pjHide(r.kind, x.auto);
  pjHide(r.x, x.auto);
  pjHide(r.fixed, !x.auto);
  panelPut(r.fixed, x.auto ? (x.qty ? '×' + fmtNum(x.qty) : 'recipe') : '');
  panelPut(r.kind, PJ_KIND[x.kind] || '');
}
function pjPaintForge(d, n, t, now) {
  const raw = (n && n.role !== 'task' && n.raw) || (t && t.type === 'forge' ? t.raw : null), info = raw && forgeInfo(raw), on = !!info;
  pjHide(d.forge, !on);
  if (!on) return;
  const k = n || taskCalc(t, now), slots = info.slots;
  panelPut(d.forgeLine, !info.known ? FORGE_RESTART : !info.running ? FORGE_IDLE : slots.length + (slots.length === 1 ? ' slot' : ' slots') + ' · ' + fmtRate(info.rate) + ' bars / hour');
  panelPut(d.forgeOre, info.known ? fmtNum(info.oreInForge) + ' ' + itemName(info.ore) + ' at the forge · ' + fmtNum(info.barsInForge) + ' bars waiting' : '');
  const out = info.unlimited ? 'Printing ' + fmtRate(info.printed) + ' ' + itemName(info.ore) + ' / hour, so ore never runs out' : k.capped ? 'Ore runs out first' + (k.runsOutMs ? ', ' + fmtClock(k.runsOutMs, now) : '') + '. Add ore to finish.' : k.runsOutMs ? 'Ore lasts until ' + fmtClock(k.runsOutMs, now) : '';
  panelPut(d.forgeOut, out);
  d.forgeOut.classList.toggle('capped', !!k.capped);
  pjHide(d.forgeOut, !out);
  pjRows(d.forgeSlots, slots, s => s.index, () => ({ node: el('div', 'small pj-slot') }), (r, s) => panelPut(r.node, 'Slot ' + (s.index + 1) + ' · ' + fmtRate(s.rate) + ' / hour · ' + fmtNum(s.oreQty) + ' ore' + (info.unlimited ? '' : ' · ' + fmtWait(s.hoursLeft)) + (s.brimstone ? ' · brimstone' : '')));
}
function pjPaintWho(d, p, n) {
  const who = n && n.who, spares = who ? n.spares : [];
  pjHide(d.who, !who);
  pjHide(d.spare, !spares.length);
  if (!who) return;
  pjRows(d.whoList, who, w => w.slot, () => ({ node: el('p', 'small pj-who-line') }), (r, w) => { panelPut(r.node, pjWhoLine(w)); r.node.classList.toggle('needs', pjWhoShort(w)); });
  const more = [n.whoUsed ? fmtNum(n.whoUsed) + (n.whoFood ? ' from storage and other bags' : ' from a spare') : '', n.extra ? fmtNum(n.extra) + ' extra on top' : ''].filter(Boolean).join(' · ');
  panelPut(d.whoMore, more);
  pjHide(d.whoMore, !more);
  const raw = n.raw;
  pjRows(d.spareList, spares, s => s.key, s => {
    const r = { node: el('label', 'pj-spare'), tick: el('input'), text: el('span', 'pj-spare-text'), where: el('span', 'pj-spare-where'), use: el('span', 'small', 'Use this copy'), up: el('span', 'small pj-spare-up') };
    r.tick.type = 'checkbox';
    r.tick.dataset.spare = s.key;
    r.tick.addEventListener('change', () => { const q = pjProject(); if (q && projectUseSpare(q, raw, s.key, r.tick.checked)) pjChanged(); });
    r.tick.addEventListener('click', e => { if (e.detail) r.tick.blur(); });
    r.text.append(r.where, r.use, r.up);
    r.node.append(r.tick, r.text);
    return r;
  }, (r, s) => {
    if (r.tick.checked !== s.used) r.tick.checked = s.used;
    panelPut(r.where, pjSpareWhere(s));
    panelPut(r.up, s.upgrades.length ? 'Upgraded: ' + s.upgrades.join(', ') : '');
    pjHide(r.up, !s.upgrades.length);
  });
}
function pjPaintDetail(p, c, now) {
  const side = pjParts.side, n = pjNodeId ? c.nodes[pjNodeId] : null, loose = pjLooseId && tasks.find(t => t.id === pjLooseId);
  if (pjNodeId && !n) pjNodeId = null;
  const key = n ? n.id : loose ? 'task:' + loose.id : null;
  pjParts.sideBox.classList.toggle('has-node', !!key);
  pjParts.sideBox.parentElement.classList.toggle('side-shut', !key && !pjAddOpen); // the graph gets the room when nothing's open beside it
  if (!key) {
    if (pjDetail) { pjDetail.box.remove(); pjDetail = null; }
    pjHide(side, true);
    return;
  }
  pjHide(side, false);
  if (!pjDetail || pjDetail.key !== key) {
    if (pjDetail) pjDetail.box.remove();
    pjDetail = pjBuildDetail(key);
    side.append(pjDetail.box);
  }
  const d = pjDetail, t = n ? projectNodeTask(projectNode(p, n.id)) : loose;
  pjIcon(d.icon, n ? n.icon : taskIconName(t));
  panelPut(d.title, n ? n.title : taskTitle(t));
  const state = !n ? 'Not in a project yet' : n.done ? 'Ready!' : n.hours == null ? n.needs || 'No ETA' : n.ready && n.role === 'craft' ? 'Can craft now' : n.hours > 0 ? pjWait(n.hours) + ' · ' + fmtClock(n.etaMs, now) : 'After what it needs is crafted';
  panelPut(d.state, state);
  const parts = n && n.raw ? ownedParts([n.raw]) : null;
  const where = parts ? Object.entries(parts).filter(([, v]) => v > 0).map(([k, v]) => k + ' ' + fmtNum(v)).join(' · ') : '';
  panelPut(d.parts, where ? 'Held: ' + where + (parts.equipped > 0 && !p.equipped && !n.whoFood ? ' (equipped not counted)' : '') : '');
  pjHide(d.parts, !where);
  if (n) {
    pjNum(d, 'need', 'Need', n.need != null ? fmtNum(n.need) : '');
    pjNum(d, 'have', 'Have', n.have != null ? fmtNum(n.have) : '');
    pjNum(d, 'left', 'Left', !n.done && n.left != null ? fmtNum(n.left) : '');
    pjNum(d, 'rate', 'Rate', n.rate > 0 ? fmtRate(n.rate) + ' / hour' + (n.rateSource ? ' · ' + n.rateSource : '') : '');
    pjNum(d, 'own', 'Own wait', !n.done && n.ownHours > 0 ? pjWait(n.ownHours) : '');
    pjNum(d, 'finish', 'Finishes', !n.done && n.hours != null && n.hours > 0 ? fmtClock(n.etaMs, now) : '');
  }
  pjHide(d.nums, !n);
  pjPaintWho(d, p, n);
  const edited = !!(t && t.type !== 'craft' && !(n && n.missing));
  if (n && edited) ['left', 'rate', 'finish'].forEach(key => pjHide(d.numRows[key].row, true));
  pjHide(d.open, !t || (t.slot == null && t.type !== 'item'));
  pjPaintForge(d, n, t, now);
  // make a task
  const canMake = !!(n && n.makeTask);
  pjHide(d.make, !canMake);
  if (canMake) {
    const from = dropOptions(n.raw);
    pjFill(d.makeFrom, from.map(o => [o.monster, o.name + (o.chance ? ' · 1 in ' + fmtNum(1 / o.chance) : '')]));
    pjHide(d.makeFromBox, from.length < 2);
  }
  // a typed rate: count nodes, and a gathered one before it has a task
  const typed = !!(n && (n.role === 'count' || (n.role === 'gather' && !t)));
  pjHide(d.rate, !typed);
  d.box.classList.toggle('no-rate', !!(n && n.noRate && !n.done));
  if (typed && document.activeElement !== d.rateBox) { const text = String(projectRateText(projectNode(p, n.id))); if (d.rateBox.value !== text) d.rateBox.value = text; }
  // the planner's editor
  const shown = t && !(n && n.missing) ? JSON.stringify([t.id, t.type, t.source, t.chance]) : null, inHost = document.activeElement && document.activeElement.closest('.pj-editor');
  if (shown !== d.editorShown && !scrub && !inHost) {
    d.editorShown = shown;
    d.host.textContent = '';
    if (t && shown) {
      const editor = buildTaskEditor(pjOwner(t.id));
      editor.querySelectorAll('input[id]').forEach(i => { i.id = 'pj-' + i.id; });
      editor.classList.toggle('pj-bare', t.type === 'craft');
      d.host.append(editor);
    }
  }
  const node = d.host.firstChild;
  pjHide(d.host, !node);
  if (node && t && node.dataset.task === t.id) paintTaskEditor(node, pjOwner(t.id), now);
  // links
  pjHide(d.edges, !n);
  if (n) {
    const edge = (id, from, to) => { const e = c.edges.find(x => x.from === from && x.to === to) || {}; return { id, title: c.nodes[id].title, done: c.nodes[id].done, auto: !!e.auto, kind: e.kind, qty: e.qty }; };
    const inputs = n.inputs.map(id => edge(id, id, n.id)), users = n.dependents.map(id => edge(id, n.id, id));
    pjHide(d.inHead, !inputs.length);
    pjHide(d.outHead, !users.length);
    pjRows(d.inList, inputs, x => x.id, pjEdgeRow('in'), pjEdgePaint);
    pjRows(d.outList, users, x => x.id, pjEdgeRow('out'), pjEdgePaint);
    pjFill(d.edgeOther, [['', 'Choose'], ...c.order.filter(id => id !== n.id).map(id => [id, c.nodes[id].title]).sort((a, b) => a[1].localeCompare(b[1]))]);
  }
  const own = n && projectNode(p, n.id);
  pjHide(d.remove, !own || !!own.raw);
  pjHide(d.removeItem, !(own && own.raw && p.targets.some(x => x.raw === own.raw)));
  pjHide(d.addHere, !!n || !p);
}

/* the page */
function pjBuild() {
  const box = $('viewProjects'), q = pjBuildHead(), s = pjBuildSummary(), a = pjBuildAdd();
  const page = el('div', 'pj-page'), body = el('div', 'pj-body'), main = el('div', 'pj-col'), sideBox = el('div', 'pj-sidebox'), side = el('aside', 'sheet pj-detail'), bar = el('div', 'pj-bar'), only = el('label', 'pj-tick'), tick = el('input');
  const restart = el('p', 'banner pj-restart'), noProject = el('p', 'plan-note pj-noproject', 'A project is anything you’re working towards: items to craft, ores in the forge, any task. Name one to start.');
  restart.id = 'pjRestart';
  noProject.id = 'pjNoProject';
  tick.id = 'pjOnlyLeft';
  tick.type = 'checkbox';
  tick.checked = pjOnlyLeft;
  tick.addEventListener('change', () => { pjOnlyLeft = tick.checked; paintProjects(); });
  only.append(tick, 'Only what’s left');
  const hidden = el('span', 'small pj-hidden'), tools = el('div', 'pj-zoom'), out = pjButton('pj-zoom-b', '−', 'pjZoomOut'), scale = el('span', 'small pj-scale'), inn = pjButton('pj-zoom-b', '+', 'pjZoomIn'), fit = pjButton('pj-zoom-b', 'Fit', 'pjFit');
  hidden.id = 'pjHiddenCount';
  scale.id = 'pjScale';
  out.setAttribute('aria-label', 'Zoom out');
  inn.setAttribute('aria-label', 'Zoom in');
  fit.title = 'Fit to the view';
  tools.append(out, scale, inn, fit);
  bar.append(only, hidden, tools);
  const graph = el('div', 'pj-graph'), sizer = el('div', 'pj-sizer'), world = el('div', 'pj-world'), svg = document.createElementNS(PJ_NS, 'svg'), nodes = el('div', 'pj-nodes'), none = el('p', 'plan-note pj-empty', 'Add an item, a set or a task to see what it takes.'), allDone = el('p', 'plan-note pj-empty', 'Nothing left to do here.'), hint = el('p', 'small pj-hint', 'Each arrow runs from what’s needed to what it makes. Dashed: starts after. Drag empty space to move, Ctrl + wheel to zoom.');
  graph.id = 'pjGraph';
  svg.setAttribute('class', 'pj-lines');
  svg.setAttribute('aria-hidden', 'true');
  world.append(svg, nodes);
  sizer.append(world);
  graph.append(sizer);
  main.append(bar, none, allDone, graph, hint);
  side.id = 'pjDetail';
  side.hidden = true;
  sideBox.append(a.box, side);
  body.append(main, sideBox);
  page.append(s.box, body);
  box.append(q.head, restart, noProject, page);
  const parts = { q, s, a, page, restart, noProject, side, sideBox, graph: { box: graph, sizer, world, svg, nodes, none, allDone, hidden, tools, scale, hint, sig: '', layout: null, project: null, fitWidth: 0 }, bar, tick };
  const g = parts.graph;
  out.addEventListener('click', () => pjZoom(g, pjViewOf(pjId).scale / PJ_ZOOM_STEP));
  inn.addEventListener('click', () => pjZoom(g, pjViewOf(pjId).scale * PJ_ZOOM_STEP));
  fit.addEventListener('click', () => { pjFit(g); pjHome(g); if (pjNodeId && pjNodes.has(pjNodeId) && pjNodes.get(pjNodeId).node.isConnected) pjKeepInView(pjNodes.get(pjNodeId)); });
  graph.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); pjZoom(g, pjViewOf(pjId).scale * Math.exp(-e.deltaY * .002), e.clientX, e.clientY); }, { passive: false });
  // Dragging empty space moves the view. A press on a box is left alone, so its click still lands.
  let drag = null;
  graph.addEventListener('pointerdown', e => {
    if (e.button || e.pointerType !== 'mouse' || e.target.closest('.pj-node')) return;
    const r = graph.getBoundingClientRect();
    if (e.clientX - r.left - graph.clientLeft >= graph.clientWidth || e.clientY - r.top - graph.clientTop >= graph.clientHeight) return; // its scrollbars
    drag = { x: e.clientX, y: e.clientY, left: graph.scrollLeft, top: graph.scrollTop, id: e.pointerId, moved: false };
    graph.setPointerCapture(e.pointerId);
  });
  graph.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved) { drag.moved = true; graph.classList.add('panning'); }
    graph.scrollLeft = drag.left - dx;
    graph.scrollTop = drag.top - dy;
  });
  const dropped = () => { drag = null; graph.classList.remove('panning'); };
  graph.addEventListener('pointerup', dropped);
  graph.addEventListener('pointercancel', dropped);
  // Anything marked with a node lights it up, and a click picks it. A tap's made-up mouse events don't count as hovering.
  const hoverAt = t => { const at = t && t.closest && t.closest('[data-node]'); return at ? at.dataset.node : null; };
  const setHover = next => { if (next !== pjHover) { pjHover = next; pjPaintHot(); } };
  box.addEventListener('touchstart', () => { pjTouchAt = Date.now(); }, { passive: true });
  box.addEventListener('mouseover', e => { if (Date.now() - pjTouchAt > 1000) setHover(hoverAt(e.target)); });
  box.addEventListener('mouseleave', () => setHover(null));
  box.addEventListener('focusin', e => { if (e.target.matches(':focus-visible')) setHover(hoverAt(e.target)); });
  box.addEventListener('focusout', () => setHover(null));
  box.addEventListener('click', e => {
    const at = e.target.closest('[data-node]');
    if (at) pjSelect(at.dataset.node, !at.closest('.pj-node'));
  });
  box.addEventListener('keydown', e => { if (e.key === 'Escape' && (pjNodeId || pjLooseId) && !e.target.closest('.pj-nameform')) pjClose(true); });
  // Fitted stays fitted as the column changes width. A page scrollbar coming and going can't start it flapping.
  if (window.ResizeObserver) new ResizeObserver(() => { const w = graph.offsetWidth; if (w && pjViewOf(pjId).fitted && (w < g.fitWidth || w > g.fitWidth + 20)) { pjFit(g); if (g.layout && pjViewEmpty(g)) pjHome(g); } }).observe(graph);
  return parts;
}
function renderProjects() {
  if (projectFocus) {
    const { projectId, taskId } = projectFocus;
    projectFocus = null;
    if (projectId && projectById(projectId)) pjPick(projectId);
    const p = pjProject(), n = p && p.nodes.find(x => x.taskId === taskId), c = n && projectCalc(p);
    if (c && c.nodes[n.id]) { pjNodeId = n.id; pjLooseId = null; paintProjects(); const k = pjNodes.get(n.id); if (k) pjReveal(k, true); return; }
    pjNodeId = null;
    pjLooseId = taskId;
  }
  paintProjects();
}
function paintProjects(now = Date.now()) {
  const box = $('viewProjects');
  if (box.hidden) return;
  const q = pjParts || (pjParts = pjBuild()), p = pjProject() || projects[0] || null;
  if (p && pjId !== p.id) pjPick(p.id);
  pjPaintHead(q.q, p);
  const facts = saveFacts(), say = !facts.held ? 'Waiting for game data.' : !facts.forge ? 'Restart the app to read the forge. Everything else works.' : '';
  panelPut(q.restart, say);
  pjHide(q.restart, !say);
  pjHide(q.noProject, !!p || !!pjLooseId);
  pjHide(q.page, !p && !pjLooseId);
  if (!p) {
    pjCalc = null;
    pjHide(q.graph.none, true);
    pjHide(q.graph.box, true);
    pjHide(q.graph.hint, true);
    q.graph.sig = '';
    if (pjLooseId) { pjHide(q.s.box, true); q.a.box.hidden = true; pjHide(q.bar, true); pjPaintDetail(null, { nodes: {}, order: [], edges: [] }, now); }
    return;
  }
  pjHide(q.s.box, false);
  q.a.box.hidden = false;
  pjHide(q.bar, false);
  const c = pjCalc = projectCalc(p, now);
  if (q.tick.checked !== pjOnlyLeft) q.tick.checked = pjOnlyLeft;
  pjPaintSummary(q.s, p, c, now);
  pjPaintAdd(q.a, p, c);
  pjPaintDetail(p, c, now);
  pjPaintGraph(q.graph, p, c);
}
