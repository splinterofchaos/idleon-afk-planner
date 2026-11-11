/* ---------- the Forge tab: where each bar's ore comes from, and how bars grow over time ---------- */
const FORGE_RANGES = [['24h', 24], ['7d', 168], ['30d', 720], ['All', null]];
let forgeTabUi = null, forgeData = null, forgeLoadedFor = null, forgeLoadFailed = false, forgeBadge = null;
const forgeChoice = { bar: null, range: '7d', bags: false };
try { Object.assign(forgeChoice, JSON.parse(localStorage.getItem(LOCAL_KEY + '-forge')) || {}); } catch { /* storage blocked */ }
const forgeRemember = () => { try { localStorage.setItem(LOCAL_KEY + '-forge', JSON.stringify(forgeChoice)); } catch { /* storage blocked */ } };

/* the sums */
// [{ t, n }], oldest first. rows are [time, forge, storage, bags].
const forgeSeries = (rows, bags) => rows.map(r => ({ t: r[0], n: r[1] + r[2] + (bags ? r[3] : 0) })).sort((a, b) => a.t - b.t);
// Average bars per hour in each of count equal stretches. Bars gained between two saves are shared out over the time between them, so a closed game or app leaves no hole. A fall means bars were spent or moved, not that the forge went backwards, so that stretch between two saves is left out.
function forgeBuckets(points, from, to, count) {
  const size = (to - from) / count, out = Array.from({ length: count }, (_, i) => ({ from: from + i * size, to: from + (i + 1) * size, bars: 0, hours: 0, rate: null }));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], gained = b.n - a.n, span = b.t - a.t;
    if (span <= 0 || gained < 0) continue;
    out.forEach(k => {
      const overlap = Math.min(k.to, b.t) - Math.max(k.from, a.t);
      if (overlap > 0) { k.bars += gained * overlap / span; k.hours += overlap / 36e5; }
    });
  }
  out.forEach(k => { if (k.hours > 0) k.rate = k.bars / k.hours; });
  return out;
}
function forgeMeasured(buckets) {
  const bars = buckets.reduce((n, k) => n + k.bars, 0), hours = buckets.reduce((n, k) => n + k.hours, 0);
  return hours > 0 ? bars / hours : null;
}

/* drawing */
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, text) {
  const n = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
  if (text != null) n.textContent = text;
  return n;
}
const forgeWhen = (t, span) => {
  const d = new Date(t);
  return span <= 48 * 36e5 ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const forgeWhenLong = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// Three or four round steps from low to high.
function forgeTicks(low, high) {
  const span = high - low || Math.abs(high) || 1, raw = span / 3, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 5, 10].map(x => x * mag).find(x => x >= raw);
  const out = [];
  for (let v = Math.ceil(low / step) * step; v <= high + step * 1e-9; v += step) out.push(v);
  return out;
}
// The frame both graphs share. Returns the scales and the svg to draw in.
function forgeFrame(box, x0, x1, low, high, fmtY) {
  box.textContent = '';
  const W = Math.max(box.clientWidth, 280), H = 210, L = 58, R = 12, T = 12, B = 26;
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const x = t => L + (t - x0) / ((x1 - x0) || 1) * (W - L - R), y = v => T + (high - v) / ((high - low) || 1) * (H - T - B);
  forgeTicks(low, high).forEach(v => {
    svg.append(svgEl('line', { class: 'fg-grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }), svgEl('text', { class: 'fg-axis', x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, fmtY(v)));
  });
  // a short span would print the same time twice: fewer labels, still evenly spaced, until each differs
  const at = n => Array.from({ length: n }, (_, i) => x0 + (x1 - x0) * i / (n - 1));
  let labels = W < 420 ? 3 : 5;
  while (labels > 2 && new Set(at(labels).map(t => forgeWhen(t, x1 - x0))).size < labels) labels--;
  for (let i = 0; i < labels; i++) {
    const t = at(labels)[i];
    if (labels === 2 && i === 1 && forgeWhen(t, x1 - x0) === forgeWhen(x0, x1 - x0)) break;
    svg.append(svgEl('text', { class: 'fg-axis', x: x(t), y: H - 7, 'text-anchor': i === 0 ? 'start' : i === labels - 1 ? 'end' : 'middle' }, forgeWhen(t, x1 - x0)));
  }
  const tip = el('div', 'fg-tip');
  tip.hidden = true;
  box.append(svg, tip);
  const showTip = (px, py, text) => {
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = Math.min(Math.max(px + 12, 0), Math.max(W - tip.offsetWidth - 4, 0)) + 'px';
    tip.style.top = Math.max(py - tip.offsetHeight - 8, 0) + 'px';
  };
  return { svg, x, y, W, H, L, R, T, B, showTip, hideTip: () => { tip.hidden = true; } };
}
function forgeDrawBars(box, points, x0, x1) {
  const ns = points.map(p => p.n), least = Math.min(...ns), most = Math.max(...ns), pad = (most - least) * 0.08 || Math.max(most * 0.01, 1);
  const low = Math.max(least - pad, 0), high = most + pad, ticks = forgeTicks(low, high);
  let digits = 3; // close numbers need more digits, or every label reads the same
  while (digits < 9 && new Set(ticks.map(v => fmtNum(v, digits))).size < ticks.length) digits++;
  const f = forgeFrame(box, x0, x1, low, high, v => fmtNum(v, digits));
  f.svg.setAttribute('aria-label', 'Bars held, from ' + fmtNum(points[0].n) + ' to ' + fmtNum(points[points.length - 1].n));
  f.svg.append(svgEl('polyline', { class: 'fg-line', points: points.map(p => f.x(p.t).toFixed(1) + ',' + f.y(p.n).toFixed(1)).join(' ') }));
  const cross = svgEl('line', { class: 'fg-cross', y1: f.T, y2: f.H - f.B, visibility: 'hidden' }), dot = svgEl('circle', { class: 'fg-dot', r: 4.5, visibility: 'hidden' });
  f.svg.append(cross, dot);
  f.svg.addEventListener('pointermove', e => {
    const px = e.clientX - f.svg.getBoundingClientRect().left;
    const p = points.reduce((best, q) => Math.abs(f.x(q.t) - px) < Math.abs(f.x(best.t) - px) ? q : best, points[0]);
    cross.setAttribute('x1', f.x(p.t));
    cross.setAttribute('x2', f.x(p.t));
    dot.setAttribute('cx', f.x(p.t));
    dot.setAttribute('cy', f.y(p.n));
    cross.setAttribute('visibility', 'visible');
    dot.setAttribute('visibility', 'visible');
    f.showTip(f.x(p.t), f.y(p.n), forgeWhenLong(p.t) + ' · ' + fmtNum(p.n, 6) + ' bars');
  });
  f.svg.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); f.hideTip(); });
}
function forgeDrawRate(box, buckets, formula) {
  const top = Math.max(formula || 0, ...buckets.map(k => k.rate || 0)) * 1.12 || 1;
  const f = forgeFrame(box, buckets[0].from, buckets[buckets.length - 1].to, 0, top, v => fmtRate0(v));
  f.svg.setAttribute('aria-label', 'Bars gained per hour' + (formula ? ', against a forge formula of ' + fmtRate(formula) + ' per hour' : ''));
  const base = f.y(0);
  buckets.forEach(k => {
    if (k.rate == null) return;
    const a = f.x(k.from) + 1, w = Math.max(f.x(k.to) - f.x(k.from) - 2, 1), h = base - f.y(k.rate), r = Math.min(4, w / 2, h);
    if (h > 0) f.svg.append(svgEl('path', { class: 'fg-col', d: `M${a} ${base}V${base - h + r}Q${a} ${base - h} ${a + r} ${base - h}H${a + w - r}Q${a + w} ${base - h} ${a + w} ${base - h + r}V${base}Z` }));
    const hit = svgEl('rect', { class: 'fg-hit', x: f.x(k.from), y: f.T, width: Math.max(f.x(k.to) - f.x(k.from), 1), height: base - f.T });
    hit.addEventListener('pointerenter', () => { hit.classList.add('on'); f.showTip(a, f.y(k.rate), forgeWhenLong(k.from) + ' · ' + fmtRate0(k.rate) + ' bars / hour · +' + fmtNum(k.bars) + ' bars'); });
    hit.addEventListener('pointerleave', () => { hit.classList.remove('on'); f.hideTip(); });
    f.svg.append(hit);
  });
  if (formula > 0) {
    const yy = f.y(formula);
    f.svg.append(svgEl('line', { class: 'fg-ref', x1: f.L, x2: f.W - f.R, y1: yy, y2: yy }), svgEl('text', { class: 'fg-ref-text', x: f.W - f.R - 2, y: yy - 5, 'text-anchor': 'end' }, 'Forge formula ' + fmtRate(formula)));
  }
}

/* the page */
function forgeBuild() {
  const box = $('viewForge'), u = forgeTabUi = {
    recent: el('div', 'fg-recent'), warn: el('div', 'fg-warnings'), speed: el('p', 'small fg-speed'), table: el('div', 'fg-table-wrap'),
    bar: el('select', 'fg-select'), ranges: el('div', 'fg-ranges'), bags: el('input'), stats: el('div', 'fg-stats'), msg: el('p', 'small fg-msg'),
    barsTitle: el('h3', 'fg-title'), barsBox: el('div', 'fg-chart'), rateTitle: el('h3', 'fg-title', 'Bars gained per hour'), rateBox: el('div', 'fg-chart'), rateNote: el('p', 'small fg-note', 'Above the line means skipped forge time or extra bars. The save doesn\'t say which. Drops from spending or moving bars are left out.'),
    charts: el('div', 'fg-charts'), details: el('details', 'fg-details'), rowsTable: el('div', 'fg-table-wrap'),
  };
  u.bags.type = 'checkbox';
  u.bags.id = 'fgBags';
  const bagsLabel = el('label', 'fg-bags');
  bagsLabel.append(u.bags, el('span', 'small', 'Count bags too'));
  const barLabel = el('div', 'fg-field');
  u.barMenu = menuSelect(u.bar, 'Bar');
  barLabel.append(el('span', 'label', 'Bar'), u.barMenu.root);
  const controls = el('div', 'fg-controls');
  controls.append(barLabel, u.ranges, bagsLabel);
  FORGE_RANGES.forEach(([name]) => {
    const b = el('button', 'fg-range', name);
    b.type = 'button';
    b.dataset.range = name;
    b.addEventListener('click', () => { forgeChoice.range = name; forgeRemember(); forgePaintCharts(); });
    u.ranges.append(b);
  });
  u.bar.addEventListener('change', () => { forgeChoice.bar = u.bar.value; forgeRemember(); forgeLoad(true); });
  u.bags.addEventListener('change', () => { forgeChoice.bags = u.bags.checked; forgeRemember(); forgePaintCharts(); });
  u.details.append(el('summary', 'small', 'Show as a table'), u.rowsTable);
  u.charts.append(u.barsTitle, u.barsBox, u.rateTitle, u.rateBox, u.rateNote, u.details);
  box.append(el('h2', 'fg-h', 'Forge'), u.speed, u.warn, u.table, el('h2', 'fg-h', 'Bars over time'), controls, u.msg, u.stats, u.recent, u.charts);
  if (window.ResizeObserver) { let w = 0; new ResizeObserver(([e]) => { const now = Math.round(e.contentRect.width); if (now && now !== w) { w = now; if (!box.hidden) forgePaintCharts(); } }).observe(box); }
}
function forgeOreText(b) {
  if (b.unlimited) return 'Printing ' + fmtRate(b.printed) + ' / hour';
  if (b.printed > 0) return 'Printing ' + fmtRate(b.printed) + ' / hour, under the ' + fmtRate(b.orePerHour) + ' it burns';
  return 'Not printing';
}
function forgePaintTable(view, now) {
  const u = forgeTabUi;
  panelPut(u.speed, !view.known ? FORGE_RESTART : (view.printerKnown ? '' : 'Printer needs an app restart. ') + 'Forge speed ' + view.speed + '% · ' + FORGE_NOTE);
  u.warn.textContent = '';
  view.warnings.forEach(text => u.warn.append(el('p', 'fg-warn', text)));
  u.warn.hidden = !view.warnings.length;
  u.table.textContent = '';
  if (!view.bars.length) return;
  const t = el('table', 'fg-table'), head = el('tr');
  ['Bar', 'Slots', 'Bars / hour', 'Ore', 'Ore in storage', 'Ore lasts'].forEach(x => head.append(el('th', '', x)));
  t.append(head);
  view.bars.forEach(b => {
    const r = el('tr', b.warn ? 'warned' : '');
    [itemName(b.bar), b.stopped ? (b.slotCount - b.stopped) + ' of ' + b.slotCount : String(b.slotCount), fmtRate0(b.rate), forgeOreText(b), fmtNum(b.stored) + (b.full ? ' (full)' : ''), b.unlimited ? 'While printing' : b.hoursLeft != null ? fmtWait(b.hoursLeft) : 'Stopped'].forEach((x, i) => {
      const c = el('td', '', i ? x : null);
      if (!i) c.append(forgeBarLabel(b.bar));
      if (i === 3 && b.printers.length) c.title = b.printers.map(p => forgeCharName(p.slot) + ': ' + fmtRate(p.rate) + ' / hour').join('\n');
      r.append(c);
    });
    t.append(r);
  });
  u.table.append(t);
}
// A bar's icon and name.
function forgeBarLabel(raw) {
  const line = el('span', 'ms-item'), img = el('img');
  img.alt = '';
  img.src = 'icons/' + raw + '.png';
  img.addEventListener('error', () => img.remove());
  line.append(img, el('span', '', itemName(raw)));
  return line;
}
const forgeCharName = slot => (saveForFinder && saveForFinder.charNames && saveForFinder.charNames[slot]) || 'Character ' + (slot + 1);
function forgeBarOptions() {
  const live = forgeOverview().bars.map(b => b.bar), recorded = ((forgeData && forgeData.items) || []).filter(x => FORGE_BARS[x] && !live.includes(x));
  return [...live, ...recorded];
}
function forgePaintOptions() {
  const u = forgeTabUi, names = forgeBarOptions();
  if (!names.includes(forgeChoice.bar)) forgeChoice.bar = names[0] || null;
  if (u.bar.dataset.names !== names.join()) {
    u.bar.textContent = '';
    names.forEach(raw => { const o = el('option', '', itemName(raw)); o.value = raw; u.bar.append(o); });
    u.bar.dataset.names = names.join();
  }
  if (forgeChoice.bar) u.bar.value = forgeChoice.bar;
  u.barMenu.paint(names.map(raw => ({ value: raw, sig: raw, make: () => forgeBarLabel(raw) })));
  u.bags.checked = !!forgeChoice.bags;
  [...u.ranges.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.range === forgeChoice.range)));
}
function forgePaintCharts() {
  const u = forgeTabUi;
  if (!u) return;
  forgePaintOptions();
  const recent = forgeChoice.bar ? forgeMeasuredRate(forgeChoice.bar) : null;
  forgePaintRecent(recent);
  const hideAll = text => { u.charts.hidden = true; u.stats.textContent = ''; panelPut(u.msg, text); u.msg.hidden = !text; };
  if (forgeLoadFailed) return hideAll('The graphs need an app restart.');
  if (!forgeData) return hideAll('Loading');
  if (!forgeChoice.bar) return hideAll('Nothing is forging, and no bars have been recorded yet.');
  const all = forgeSeries(forgeData.rows || [], forgeChoice.bags), hours = (FORGE_RANGES.find(r => r[0] === forgeChoice.range) || FORGE_RANGES[1])[1];
  const last = all.length ? all[all.length - 1].t : 0, from = hours ? Math.max(last - hours * 36e5, all.length ? all[0].t : 0) : all.length ? all[0].t : 0;
  const shown = all.filter(p => p.t >= from);
  if (all.length < 2 || shown.length < 2 || last <= from) return hideAll(all.length < 2 ? 'Recording. The graphs start after two cloud saves, and only while the app is open.' : 'Only one save in this range. Pick a longer one.');
  u.charts.hidden = false;
  u.msg.hidden = true;
  const info = forgeInfo(forgeChoice.bar), formula = info ? info.rate : 0, buckets = forgeBuckets(all, from, last, u.rateBox.clientWidth && u.rateBox.clientWidth < 420 ? 24 : 48);
  const measured = forgeMeasured(buckets), diff = measured != null && formula > 0 ? Math.trunc((measured / formula - 1) * 100) : null;
  u.stats.textContent = '';
  [['Now', fmtNum(shown[shown.length - 1].n)], ['ETAs use / hour', recent ? fmtRate0(recent.rate) : '—'], ['Measured / hour', measured == null ? '—' : fmtRate0(measured)], ['Forge formula / hour', formula > 0 ? fmtRate(formula) : '—'], ['Difference', diff == null ? '—' : (diff > 0 ? '+' : '') + diff + '%']].forEach(([k, v]) => {
    const s = el('div', 'fg-stat');
    s.append(el('span', 'label', k), el('strong', 'fg-stat-n', v));
    u.stats.append(s);
  });
  panelPut(u.barsTitle, itemName(forgeChoice.bar) + (forgeChoice.bags ? ' in the forge, storage and bags' : ' in the forge and storage'));
  forgeDrawBars(u.barsBox, shown, from, last);
  forgeDrawRate(u.rateBox, buckets, formula);
  u.rowsTable.textContent = '';
  const t = el('table', 'fg-table'), head = el('tr');
  ['From', 'Bars gained', 'Bars / hour'].forEach(x => head.append(el('th', '', x)));
  t.append(head);
  [...buckets].reverse().filter(k => k.rate != null).forEach(k => {
    const r = el('tr');
    [forgeWhenLong(k.from), fmtNum(k.bars), fmtRate0(k.rate)].forEach(x => r.append(el('td', '', x)));
    t.append(r);
  });
  u.rowsTable.append(t);
}
// The segments the ETAs are worked from: the last 12 hours one by one, then days, with how much each counts. Folded away until opened.
let forgeRecentOpen = false;
function forgePaintRecent(m) {
  const u = forgeTabUi;
  u.recent.textContent = '';
  if (!m) return;
  const fold = el('details', 'fg-details');
  fold.open = forgeRecentOpen;
  fold.addEventListener('toggle', () => { forgeRecentOpen = fold.open; });
  fold.append(el('summary', 'small', 'Show the bars per hour the ETAs use'), el('p', 'small fg-note', 'Forge and storage. Each of the last ' + FORGE_RECENT_HOURS + ' hours on its own, then a day at a time. A stretch counts half as much for every ' + FORGE_HALF_LIFE_HOURS + ' hours it is older, so an archer played or a candy used lately shows quickly.'));
  const t = el('table', 'fg-table'), head = el('tr');
  ['When', 'Bars gained', 'Bars / hour', 'Counts for'].forEach(x => head.append(el('th', '', x)));
  t.append(head);
  m.segments.filter(k => k.hours > 0).forEach(k => {
    const r = el('tr');
    [k.label + (k.hours < (k.to - k.from) / 36e5 - 1e-9 ? ' (' + fmtWait(k.hours) + ' seen)' : ''), fmtNum(k.bars), fmtRate0(k.rate), Math.trunc(k.share * 100) + '%'].forEach(x => r.append(el('td', '', x)));
    t.append(r);
  });
  const wrap = el('div', 'fg-table-wrap');
  wrap.append(t);
  fold.append(wrap);
  u.recent.append(fold);
}
async function forgeLoad(force) {
  if (!LOCAL_APP) { forgeLoadFailed = true; return forgePaintCharts(); }
  forgePaintOptions();
  const key = forgeChoice.bar + '|' + finderFetched;
  if (!force && key === forgeLoadedFor) return;
  forgeLoadedFor = key;
  try {
    const got = await api('/api/forge-history?item=' + encodeURIComponent(forgeChoice.bar || ''));
    forgeData = got;
    forgeLoadFailed = false;
  } catch { forgeLoadFailed = true; }
  forgePaintCharts();
}
function showForge() {
  if (!forgeTabUi) forgeBuild();
  forgePaintTable(forgeOverview(), Date.now());
  forgeLoad(true);
}
// Each second: the warning mark on the tab always, and the page when it's open and a new save came in.
function paintForgeTab(now) {
  forgeHistLoad();
  const view = forgeOverview(now), mark = view.warnings.length > 0;
  if (forgeBadge !== mark) {
    forgeBadge = mark;
    const b = $('tabForge');
    b.classList.toggle('warned', mark);
    $('tabWorld').classList.toggle('warned', mark); // the forge is in World now: its warning shows there too
    b.lastChild.textContent = mark ? 'Forge !' : 'Forge'; // the label, after its icon
    b.title = view.warnings.join('\n');
    $('tabWorld').title = b.title;
  }
  if (forgeTabUi && !$('viewForge').hidden) {
    forgePaintTable(view, now);
    forgeLoad(false);
  }
}
