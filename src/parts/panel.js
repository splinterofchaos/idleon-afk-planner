/* ---------- activity panel: every task as a card, kept in place across the 1 s redraw ---------- */
let panelParts = null, panelSig = null, panelNextId = null;
const panelOpen = { more: false, archive: false }; // for this session only
const panelCards = new Map(); // task id -> its card. Tasks get replaced on setState, so nothing here holds a task object.
const panelStarIcon = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 17l-5.5 2.9 1.2-6.1-4.5-4.2 6.1-.8z"/></svg>';
function panelButton(cls, text) {
  const b = el('button', cls, text);
  b.type = 'button';
  return b;
}
function panelPut(node, text) { if (node.textContent !== text) node.textContent = text; }
function panelAttr(node, name, value) { if (node.getAttribute(name) !== value) node.setAttribute(name, value); }

const panelGroup = t => [t]; // a task has its own card
// Tasks everyone on them shares show as one card, while they aim at the same thing.
function panelTeamKey(t) {
  if (!teamOf(t)) return null;
  return t.type === 'card' ? 'card|' + t.monster + '|' + String(t.goal ?? '').trim() : 'item|' + t.itemName + '|' + String(t.amount ?? '').trim();
}
// Finished: gone, unless the game would just make it again, when it's hidden instead.
function panelClear(t) {
  if (t.type === 'skill' || t.type === 'exp') return panelHide(t);
  panelDelete(t);
}
function panelHide(t) {
  const group = panelGroup(t), hide = !group.some(x => x.hidden);
  group.forEach(x => { if (hide) x.hidden = true; else delete x.hidden; });
  queueSave();
  render();
  if (hide) toast('Hidden ' + taskTitle(t) + '. It\u2019s in the archive', () => { group.forEach(x => { delete x.hidden; }); queueSave(); render(); });
}
function panelOpenOn(picked, slot) {
  const t = panelGroup(picked).find(x => x.slot === slot) || picked;
  selectPlayer(slot);
  showTab('planner');
  flashTask(t.id);
}
// Which player to view a shared task from.
let panelPickOpen = null;
function panelPickClose() {
  if (panelPickOpen) panelPickOpen.remove();
  panelPickOpen = null;
}
function panelPick(picked, shares, now) {
  const c = panelCards.get(picked.id), had = panelPickOpen && panelPickOpen.dataset.task === picked.id;
  panelPickClose();
  if (!c || had) return;
  const menu = panelPickOpen = el('div', 'pc-pick');
  menu.dataset.task = picked.id;
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'View this task from');
  menu.append(el('div', 'small pc-pick-head', 'View from'));
  shares.forEach(s => {
    const b = panelButton('pc-pick-row'), dot = el('span', 'pc-dot');
    dot.style.background = shareColor(s.slot, shares.map(x => x.slot));
    b.dataset.slot = s.slot;
    const pickName = el('span', 'pc-pick-name');
    pickName.append(slotPlate(s.slot, s.name), s.playing ? ' · playing' : '');
    b.append(dot, pickName, shareLine(s, 'small'));
    b.addEventListener('click', () => { panelPickClose(); panelOpenOn(picked, s.slot); });
    menu.append(b);
  });
  c.node.append(menu);
  menu.querySelector('button').focus();
}
const fmtShare = s => editorFew(s.rate) + ' / hour' + (s.waiting > 0 ? ' · ' + editorFew(s.waiting) + ' waiting' : '');
// A player's line: their rate, then what's waiting, or for whoever's being played, "active" in green: nothing waits for them
function shareLine(s, cls) {
  const line = el('span', cls, fmtShare(s));
  if (s.playing) line.append(' · ', el('span', 'share-active', 'active'));
  return line;
}
document.addEventListener('click', e => { if (panelPickOpen && !e.target.closest('.pc-pick, .pc-main')) panelPickClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') panelPickClose(); });
function panelStar(t) {
  const group = panelGroup(t), on = !group.some(x => x.starred);
  group.forEach(x => { if (!!x.starred !== on) toggleStar(x); });
  queueSave();
  render();
}
function panelOpenTask(picked) {
  const shares = taskSection(picked) === 'archive' ? [] : taskShares(picked).filter(s => !s.militia); // the militia aren't a player to view it from
  if (shares.length > 1) return panelPick(picked, shares);
  panelPickClose();
  if (picked.type === 'item' && taskSection(picked) !== 'archive') { // the account's: open it on someone working on it
    const team = teamOf(picked) || [], who = team.find(x => x.slot === selectedSlot()) || team[0];
    if (who) selectPlayer(who.slot);
    showTab('planner');
    flashTask(picked.id);
    return;
  }
  if (picked.type === 'portal') return openTaskInPlayer(picked); // everyone's part in it is in its details there
  if (picked.slot == null && picked.type !== 'item') return openTaskInProjects(picked.id); // no player to open it on
  const t = panelGroup(picked).find(x => x.slot === selectedSlot()) || picked;
  if (taskSection(t) === 'archive') {
    showTab('simulate');
    if (typeof simulateTask === 'function') simulateTask(t.id);
    return;
  }
  selectPlayer(t.slot);
  showTab('planner');
  flashTask(t.id);
}
function panelDelete(t) {
  const removed = panelGroup(t).map(x => deleteTask(x.id)).filter(Boolean);
  if (!removed.length) return;
  queueSave();
  render();
  toast('Deleted ' + taskTitle(t), () => { removed.forEach(restoreTask); queueSave(); render(); });
}
function panelToggle(key) {
  panelOpen[key] = !panelOpen[key];
  paintPanel(Date.now());
}
function panelBuild() {
  const box = $('activityPanel'), wrap = el('div', 'pn'), p = { wrap };
  p.next = panelButton('pn-next');
  p.nextLabel = el('span', 'pn-next-label', 'Next to finish');
  p.nextWhen = el('span', 'pn-next-when');
  p.nextWhat = el('span', 'pn-next-what');
  p.next.append(p.nextLabel, p.nextWhen, p.nextWhat);
  p.next.addEventListener('click', () => { const t = tasks.find(x => x.id === panelNextId); if (t) panelOpenTask(t); });
  p.empty = el('p', 'pn-empty', 'No tasks yet. They appear here when a character starts fighting or training a skill.');
  const head = text => { const h = el('h3', 'pn-head', text); h.hidden = true; return h; };
  p.activeHead = head('Active');
  p.sort = panelButton('pn-sort', 'Starred first');
  p.sort.setAttribute('aria-pressed', String(panelStarFirst));
  p.sort.addEventListener('click', () => {
    panelStarFirst = !panelStarFirst;
    p.sort.setAttribute('aria-pressed', String(panelStarFirst));
    try { localStorage.setItem(LOCAL_KEY + '-star-first', panelStarFirst ? '1' : '0'); } catch { /* storage blocked */ }
    paintPanel(Date.now());
  });
  p.goalHead = head('Goals (inactive)');
  ['active', 'more', 'goal', 'archive'].forEach(k => { p[k] = el('div', 'pn-list'); });
  p.moreBtn = panelButton('pn-toggle');
  p.moreBtn.setAttribute('aria-expanded', 'false');
  p.moreBtn.addEventListener('click', () => panelToggle('more'));
  p.archiveBtn = panelButton('pn-toggle pn-archive');
  p.archiveBtn.setAttribute('aria-expanded', 'false');
  p.archiveBtn.addEventListener('click', () => panelToggle('archive'));
  wrap.append(p.next, p.empty, p.sort, p.activeHead, p.active, p.moreBtn, p.more, p.goalHead, p.goal, p.archiveBtn, p.archive);
  box.textContent = '';
  box.append(wrap);
  return p;
}
// Monster sprites carry a lot of blank space, so a bigger box barely shows. Zooms the image until what's drawn fills it. Any image it can't read stays as it is.
const panelIconFits = new Map();
function panelFillIcon(img) {
  const src = img.src;
  if (!panelIconFits.has(src)) {
    let fit = '';
    try {
      const w = img.naturalWidth, h = img.naturalHeight, canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, w, h).data;
      let left = w, top = h, right = -1, bottom = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 16) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
      if (right >= 0) {
        const long = Math.max(w, h), zoom = long / Math.max(right - left + 1, bottom - top + 1);
        fit = 'scale(' + zoom + ') translate(' + (w / 2 - (left + right + 1) / 2) / long * 100 + '%, ' + (h / 2 - (top + bottom + 1) / 2) / long * 100 + '%)';
      }
    } catch (e) { fit = ''; }
    panelIconFits.set(src, fit);
  }
  img.style.transform = panelIconFits.get(src);
}
function panelCard(id) {
  const c = { node: el('div', 'pc'), main: panelButton('pc-main'), port: el('span', 'pc-port'), icon: el('span', 'pc-icon'), title: el('span', 'pc-title'), who: el('span', 'pc-who'), live: el('span', 'pc-live'), bar: el('span', 'pc-bar'), under: el('span', 'pc-bar-text'), over: el('span', 'pc-bar-over'), eta: el('span', 'pc-eta'), star: panelButton('pc-star'), x: panelButton('x pc-x', '×'), face: null, iconName: null };
  const text = el('span', 'pc-body'), top = el('span', 'pc-top'), row = el('span', 'pc-row'), task = fn => () => { const t = tasks.find(x => x.id === id); if (t) fn(t); };
  c.node.dataset.id = id;
  c.over.setAttribute('aria-hidden', 'true');
  c.star.innerHTML = panelStarIcon;
  top.append(c.title, c.who, c.live);
  c.bar.append(c.over); // the fill, behind everything; its text is never seen
  row.append(c.under, c.eta);
  text.append(top, row);
  c.main.append(c.port, c.icon, text);
  c.hide = panelButton('pc-x pc-hide', '–');
  c.parts = el('span', 'pc-bar-parts');
  c.bar.prepend(c.parts);
  c.node.append(c.bar, c.main, c.star, c.x, c.hide);
  c.main.addEventListener('click', task(panelOpenTask));
  c.star.addEventListener('click', task(panelStar));
  c.x.addEventListener('click', task(t => { const k = taskCalc(t); return k.done && taskSection(t) !== 'archive' ? panelClear(t) : panelDelete(t); }));
  c.hide.addEventListener('click', task(panelHide));
  return c;
}
// The parts of a shared or portal task's bar: { base: % in hand, parts: [{ slot, left, w, fill 0-1, full }], lines: tooltip text }, or null for a one-player task.
function panelSplit(t, k, now) {
  if (k.done && !(k.pending > 0 && k.have < k.target)) return null; // done only once it's claimed: until then each player keeps their part
  if (t.type === 'portal') {
    const crew = k.crew, need = crew && crew.need, kills = +GAME.portals[t.mapIdx] || 0;
    if (!crew || !crew.known || !(need > 0)) return null;
    const progress = x => x.cleared ? 1 : kills > 0 && x.left != null ? Math.min(Math.max(1 - x.left / kills, 0), 1) : 0, unclaimed = x => x.cleared || !(kills > 0) ? 0 : Math.min((x.waiting || 0) / kills, 1 - progress(x));
    const who = crew.all.filter(x => x.cleared || x.there || progress(x) > 0).sort((a, b) => progress(b) - progress(a)).slice(0, need), w = 100 / need, parts = [], lines = [];
    const base = who.reduce((n, x) => n + progress(x), 0) * w;
    let at = base;
    for (let i = 0; i < need; i++) {
      const x = who[i], rest = x ? 1 - progress(x) : 1;
      if (rest > 1e-9) { parts.push({ slot: x ? x.r.slot : null, left: at, w: rest * w, fill: x ? unclaimed(x) / rest : 0 }); at += rest * w; }
      if (x) lines.push((x.r.name || 'Unnamed') + ': ' + (x.cleared ? 'cleared' : kills > 0 && x.left != null ? fmtNum(Math.max(kills - x.left, 0)) + ' of ' + fmtNum(kills) + ' kills' + (x.waiting > 0 ? ' · ' + fmtNum(x.waiting) + ' waiting' : '') : 'on it'));
    }
    if (who.length < need) lines.push(fmtNum(need - who.length) + (need - who.length === 1 ? ' more player needed' : ' more players needed'));
    return { base, parts, lines };
  }
  const outpost = t.type === 'outpost'; // split between whoever's played on it and the militia, or the militia's alone
  if (!k.active || !(k.team || outpost) || !(k.target > 0) || k.have == null) return null; // nobody on it: nothing to split
  const shares = taskShares(t, now), sum = shares.reduce((n, s) => n + s.rate, 0);
  if (shares.length < (outpost ? 1 : 2) || !(sum > 0)) return null;
  const base = Math.min(k.have / k.target * 100, 100), left = Math.max(k.target - k.have, 0), parts = [], lines = [];
  let at = base;
  const ready = !!k.done, held = shares.reduce((n, s) => n + s.waiting, 0); // ready but unclaimed: each part is what that player has waiting
  if (ready && !(held > 0)) return null;
  shares.forEach(s => {
    if (ready) {
      const w = (100 - base) * s.waiting / held;
      if (w > 0) parts.push({ slot: s.slot, left: at, w, fill: 1 });
      lines.push(s.name + ': ' + fmtNum(s.waiting) + ' waiting to be claimed');
      at += w;
      return;
    }
    const share = left * s.rate / sum, w = share / k.target * 100, full = s.waiting >= share;
    parts.push({ slot: s.slot, left: at, w, fill: share > 0 ? Math.min(s.waiting / share, 1) : 0 });
    lines.push(s.name + ': ' + Math.round(s.rate / sum * 100) + '% of what’s left (' + fmtNum(share) + ') · ' + fmtNum(s.waiting) + (s.militia ? ' banked' : ' waiting') + (full ? ', enough for their part' : ''));
    at += w;
  });
  return { base, parts, lines };
}
function panelPaintCard(c, { t, calc: k, section, has }, now) {
  const r = rowOfTask(t), title = taskTitle(t), group = panelGroup(t), iconName = taskIconName(t);
  const portal = t.type === 'portal', outpost = t.type === 'outpost', members = portal ? (k.crew ? k.crew.on.map(x => x.r) : []) : outpost ? outpostFaces(k) : k.team ? k.team.rows : [r].filter(Boolean), team = !portal && members.length > 1, faces = members.slice(0, 3);
  const who = outpost ? (k.done ? '' : k.units ? k.units + ' militia' : k.playing ? 'playing' : '') : portal ? (k.crew && k.crew.known ? k.crew.cleared + ' of ' + k.crew.need + ' cleared' : '') : team ? k.team.counted + ' of ' + members.length + ' players' : r ? (k.playing ? 'playing' : '') : '', named = !portal && faces.length <= 2, face = (portal ? 'hat:' : named ? 'tag:' : '') + faces.map(x => x.hat + '|' + x.classIndex + (named ? '|' + x.tag + '|' + x.name : '')).join(','); // the name is on the nametag under the face
  if (c.face !== face) {
    c.face = face;
    c.port.textContent = '';
    c.port.classList.toggle('many', faces.length > 1 && !named);
    c.port.classList.toggle('named', named && faces.length > 0);
    c.port.classList.toggle('pair', named && faces.length > 1);
    faces.forEach(x => { const pic = portal ? hatFace(x) : named ? unitFace(x) : portrait(x); if (pic) c.port.append(pic); });
  }
  if (c.iconName !== iconName) {
    c.iconName = iconName;
    c.icon.textContent = '';
    const img = el('img');
    img.alt = '';
    img.src = 'icons/' + iconName + '.png';
    img.addEventListener('error', () => img.remove());
    img.addEventListener('load', () => panelFillIcon(img));
    c.icon.append(img);
  }
  const wait = k.done ? 'Ready!' : k.wait ? k.wait : has ? fmtWait(k.hours, true) : panelNeeds(k.needs) || k.line || 'No ETA', pct = k.done ? 100 : Math.round((k.pct || 0) * 1000) / 10, idle = section !== 'active';
  panelPut(c.title, title);
  const live = !outpost && k.playing && k.rateSource === 'loot rate' && k.rate > 0 && !(k.team && k.team.counted > 1); // measured from this play session alone
  panelPut(c.who, live ? fmtRate(k.rate) + ' / hr' : who);
  panelPut(c.live, live ? 'live' : '');
  panelPut(c.under, wait);
  panelPut(c.over, wait);
  panelPut(c.eta, !k.done && has ? fmtClock(k.etaMs, now) : '');
  // Split bars: each player's part of what's left, filling with their own progress.
  const split = panelSplit(t, k, now), base = split ? split.base : pct, partSig = split ? split.parts.map(x => [x.slot, x.left.toFixed(1), x.w.toFixed(1), x.fill.toFixed(3)].join(':')).join() : '';
  if (c.partSig !== partSig) {
    c.partSig = partSig;
    c.parts.textContent = '';
    (split ? split.parts : []).forEach(x => {
      const s = el('span', 'pc-seg'), fill = el('span', 'pc-seg-in');
      s.style.left = x.left + '%'; s.style.width = x.w + '%';
      if (x.slot != null) s.style.setProperty('--c', shareColor(x.slot, split.parts.map(y => y.slot)));
      fill.style.width = (x.fill * 100) + '%';
      s.append(fill);
      c.parts.append(s);
    });
  }
  const clip = 'inset(0 ' + (100 - base) + '% 0 0)';
  if (c.over.style.clipPath !== clip) c.over.style.clipPath = clip;
  c.node.classList.toggle('idle', idle);
  c.node.classList.toggle('done', !!k.done);
  // Being worked on by whoever's being played, not AFK. An item with no known source only counts once it's really coming in, since "any fighter" says nothing about this monster.
  c.node.classList.toggle('playing', !k.done && section === 'active' && panelPlayed(group));
  c.node.classList.toggle('no-eta', !k.done && !has);
  const starred = group.some(x => x.starred), canDelete = section === 'archive' || (starred && group.every(x => !x.auto));
  const clearable = !!k.done && section !== 'archive', showX = canDelete || clearable, isHidden = group.some(x => x.hidden), showHide = (section !== 'archive' && !k.done) || isHidden;
  c.node.classList.toggle('has-x', showX || showHide);
  c.node.classList.toggle('has-both', showX && showHide);
  if (c.x.hidden === showX) c.x.hidden = !showX;
  if (c.hide.hidden === showHide) c.hide.hidden = !showHide;
  panelPut(c.x, clearable ? '✓' : '×');
  panelPut(c.hide, isHidden ? '+' : '–');
  panelAttr(c.hide, 'title', isHidden ? 'Bring this back' : 'Hide this');
  panelAttr(c.hide, 'aria-label', (isHidden ? 'Unhide ' : 'Hide ') + title);
  panelAttr(c.x, 'title', clearable ? 'Clear this finished task' : 'Delete');
  panelAttr(c.main, 'title', title + (who ? ' · ' + who : '') + (team || (portal && members.length) ? '\n' + (portal ? 'On it: ' : '') + members.map(x => x.name || 'Unnamed').join(', ') : '') + (k.line ? '\n' + k.line : '') + (k.note ? '\n' + k.note : '') + (split && split.lines.length ? '\n' + split.lines.join('\n') : '') + (idle && has && !k.done && !(k.team && k.team.others > 0) ? '\nIf started now' : ''));
  panelAttr(c.star, 'aria-pressed', String(starred));
  panelAttr(c.star, 'aria-label', 'Goal: ' + title + (who ? ', ' + who : ''));
  panelAttr(c.star, 'title', starred ? 'Remove from goals' : 'Make this a goal');
  panelAttr(c.x, 'aria-label', (clearable ? 'Clear ' : 'Delete ') + title + (who ? ', ' + who : ''));
}
// Soonest first, done before that, no ETA last. Whole seconds, so sums that differ only in rounding can't swap two cards back and forth.
// A card can't take a rate, so it doesn't ask for one. Other messages, like what's ready to claim, still show.
const panelNeeds = text => /^Enter (.+ \/ hour|AFK stats|drop rate)/.test(text || '') ? '--' : text;
function panelPlayed(group) { return group.some(x => taskPlaying(x) && (x.type !== 'item' || teamOf(x) || lootRate(x) > 0)); }
function panelEntry(t, section, now) {
  const k = taskCalc(t, now), has = k.hours != null && !Number.isNaN(k.hours);
  return { t, section, calc: k, has, order: has && k.etaMs != null ? Math.round(k.etaMs / 1000) : Infinity };
}
let panelStarFirst = false;
try { panelStarFirst = localStorage.getItem(LOCAL_KEY + '-star-first') === '1'; } catch { /* storage blocked */ }
function panelOrder(a, b) {
  const star = e => panelGroup(e.t).some(x => x.starred) ? 1 : 0;
  return (panelStarFirst ? star(b) - star(a) : 0) || (b.calc.done ? 1 : 0) - (a.calc.done ? 1 : 0) || (a.order === b.order ? 0 : a.order < b.order ? -1 : 1) || a.t.slot - b.t.slot || (a.t.id < b.t.id ? -1 : 1);
}
// Puts a list's cards in order, touching only what's out of place.
function panelPlace(list, nodes) {
  nodes.forEach((n, i) => { if (list.children[i] !== n) list.insertBefore(n, list.children[i] || null); });
  while (list.children.length > nodes.length) list.lastChild.remove();
}
function renderPanel() { paintPanel(Date.now()); }
function paintPanel(now = Date.now()) {
  const p = panelParts || (panelParts = panelBuild()), active = [], goal = [], archive = [];
  tasks.forEach(t => {
    if (projectTaskHidden(t)) return;
    const section = taskSection(t);
    (section === 'active' ? active : section === 'goal' ? goal : archive).push(t);
  });
  const entries = (list, section) => list.map(t => panelEntry(t, section, now)).sort(panelOrder);
  const ran = entries(active, 'active'), goals = entries(goal, 'goal');
  const folds = e => { const group = panelGroup(e.t); return !group.some(x => x.starred) && !panelPlayed(group); };
  const shown = { active: ran.filter(e => !folds(e)), more: panelOpen.more ? ran.filter(folds) : [], goal: goals, archive: [] };
  const foldCount = ran.length - shown.active.length;
  if (panelOpen.archive) shown.archive = archive.sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0) || (a.id < b.id ? -1 : 1)).map(t => panelEntry(t, 'archive', now));

  // Cards only move when the order or a section really changed.
  const sig = Object.keys(shown).map(k => k + ':' + shown[k].map(e => e.t.id).join(',')).join('|');
  if (sig !== panelSig) {
    panelSig = sig;
    const focused = document.activeElement, seen = new Set();
    Object.keys(shown).forEach(k => {
      panelPlace(p[k], shown[k].map(e => {
        const id = e.t.id;
        seen.add(id);
        if (!panelCards.has(id)) panelCards.set(id, panelCard(id));
        return panelCards.get(id).node;
      }));
    });
    [...panelCards.keys()].forEach(id => { if (!seen.has(id)) panelCards.delete(id); });
    if (focused && focused !== document.activeElement && focused.isConnected) focused.focus({ preventScroll: true });
  }
  Object.values(shown).forEach(list => list.forEach(e => panelPaintCard(panelCards.get(e.t.id), e, now)));

  const none = !tasks.length, next = shown.active.find(e => !e.calc.done && e.has);
  p.empty.hidden = !none;
  p.next.hidden = none;
  p.next.disabled = !next;
  panelNextId = next ? next.t.id : null;
  if (next) {
    const r = rowOfTask(next.t), title = taskTitle(next.t), shared = next.calc.team && next.calc.team.total > 1, who = shared ? teamLine(next.calc.team) : r ? r.name || 'Unnamed' : '', what = title + (who ? ' · ' + who : '');
    panelPut(p.nextWhen, (next.calc.wait || fmtWait(next.calc.hours, true)) + ' · ' + fmtClock(next.calc.etaMs, now));
    panelPut(p.nextWhat, what);
    panelAttr(p.next, 'title', what);
  } else {
    panelPut(p.nextWhen, '');
    panelPut(p.nextWhat, 'Nothing with an ETA');
    p.next.removeAttribute('title');
  }
  p.activeHead.hidden = !ran.length;
  p.goalHead.hidden = !goals.length;
  p.moreBtn.hidden = !foldCount;
  panelPut(p.moreBtn, foldCount + ' more without an ETA');
  panelAttr(p.moreBtn, 'aria-expanded', String(panelOpen.more));
  p.archiveBtn.hidden = !archive.length;
  panelPut(p.archiveBtn, (panelOpen.archive ? 'Hide' : 'Show') + ' archive (' + archive.length + ')');
  panelAttr(p.archiveBtn, 'aria-expanded', String(panelOpen.archive));
}

/* the panel's width: drag its right edge, or focus the edge and use the arrow keys. Double-click puts it back */
const PANEL_W = { min: 260, def: 356, step: 16 };
const panelWMax = () => Math.max(PANEL_W.min, Math.min(1100, innerWidth - 480));
let panelWanted = PANEL_W.def;
function setPanelWidth(w, keep) {
  panelWanted = Math.round(Math.min(Math.max(w, PANEL_W.min), 1100));
  return applyPanelWidth(keep);
}
function applyPanelWidth(keep) {
  const v = Math.min(panelWanted, panelWMax());
  if (keep) panelWanted = v; // what you dragged to is what you see
  document.documentElement.style.setProperty('--panel-w', v + 'px');
  const grip = $('panelGrip');
  if (grip) { grip.setAttribute('aria-valuenow', String(v)); grip.setAttribute('aria-valuemax', String(panelWMax())); }
  if (keep) { try { localStorage.setItem(LOCAL_KEY + '-panel-w', String(v)); } catch { /* the width just isn't kept */ } }
  return v;
}
(() => {
  const box = $('activityBox'), grip = el('div', 'panel-grip');
  grip.id = 'panelGrip';
  grip.tabIndex = 0;
  grip.setAttribute('role', 'separator');
  grip.setAttribute('aria-orientation', 'vertical');
  grip.setAttribute('aria-label', 'Panel width');
  grip.setAttribute('aria-valuemin', String(PANEL_W.min));
  grip.title = 'Drag to resize · double-click to reset';
  box.append(grip);
  let saved = null;
  try { saved = parseFloat(localStorage.getItem(LOCAL_KEY + '-panel-w')); } catch { /* none kept */ }
  setPanelWidth(saved > 0 ? saved : PANEL_W.def, false);
  const now = () => box.getBoundingClientRect().width;
  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const x0 = e.clientX, w0 = now();
    grip.setPointerCapture(e.pointerId);
    document.documentElement.classList.add('panel-resizing');
    const move = ev => setPanelWidth(w0 + ev.clientX - x0, false);
    const up = ev => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); document.documentElement.classList.remove('panel-resizing'); setPanelWidth(w0 + ev.clientX - x0, true); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('dblclick', () => setPanelWidth(PANEL_W.def, true));
  grip.addEventListener('keydown', e => {
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
    if (e.key === 'Home') { e.preventDefault(); setPanelWidth(PANEL_W.min, true); }
    else if (e.key === 'End') { e.preventDefault(); setPanelWidth(panelWMax(), true); }
    else if (d) { e.preventDefault(); setPanelWidth(now() + d * PANEL_W.step * (e.shiftKey ? 4 : 1), true); }
  });
  addEventListener('resize', () => applyPanelWidth(false));
})();
