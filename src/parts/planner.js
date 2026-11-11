/* ---------- task editor: the planner's fields and stats for one task. Simulate reuses it ---------- */
const EDITOR_STAR = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 17l-5.5 2.9 1.2-6.1-4.5-4.2 6.1-.8z"/></svg>';
function editorFields(t, owner) {
  if (t.type === 'craft' || t.type === 'portal' || t.type === 'afkcap' || t.type === 'outpost') return [];
  if (t.type === 'forge') return [{ name: 'amount', label: 'Amount', hint: '50k', aria: 'Bars to have, if you have a goal', scrub: true, wide: true }];
  const one = (name, label, hint, aria, more) => ({ name, label, hint, aria, ...more });
  const kph = one('kph', 'Kills / hour', '12k', 'Kills per hour'), xph = one('xph', 'EXP / hour', '50k', 'EXP per hour');
  const dr = one('dr', 'Drop rate', '5.2', 'Drop rate multiplier from the game'), mk = one('mk', 'Multikill %', '0', 'Multikill percent, from the game’s AFK Info screen. It lowers real kills and multiplies common drops'), kpk = one('kpkTotal', 'Kills per kill', '', 'Kills per kill. Blank is worked out from the save');
  const chance = taskChance(t);
  const drops = t.source === 'flat' ? [one('iph', 'Chapters / hr', '20', 'Chapters per hour')] : t.source === 'direct' || !chance ? [one('perHour', 'Per hour', '20', 'Amount per hour')]
    : t.source === 'crystal' ? [one('kph', 'Crystals / hour', '500', 'Crystals per hour', { wide: true }), dr]
    : [kph, dr, mk, kpk];
  if (t.type === 'clear') return [kph, one('kpc', 'Kills / clear', '40', 'Kills per clear'), one('left', 'Kills left', 'Optional', 'Kills left, if you have a goal', { scrub: true, wide: true })];
  if (t.type === 'card') return [...(t.source === 'skill' || (t.slot == null && !(owner && owner.statTask)) ? [] : drops), one('goal', 'Target stars', 'Next star', 'Target card stars, blank is the next star', { scrub: true, wide: true })];
  if (t.type === 'item') {
    // The item is the account's; the rate here is the selected player's own.
    const st = owner && owner.statTask, word = st && gatherWord(st), mine = !st ? [] : st.source === 'flat' ? [one('iph', word + ' / hr', '20', word + ' per hour')]
      : st.source === 'crystal' ? [one('kph', 'Crystals / hour', '500', 'Crystals per hour', { wide: true }), dr]
      : [kph, dr, mk, kpk];
    return [...(t.source === 'direct' || (!chance && t.source !== 'flat') ? drops : mine), ...(t.statueTo ? [] : [one('amount', 'Amount', '50k', 'Amount to collect, if you have a goal', { scrub: true, wide: true })])];
  }
  if (t.type === 'skill') return [xph, one('goal', 'Goal level', '250 or +5', 'Goal level, or + levels to gain, if you have a goal', { scrub: true, wide: true })];
  if (t.type === 'class') return [one('xph', 'Class EXP / hour', '50k', 'Class EXP per hour', { wide: true }), one('goal', 'Class goal', 'Next level', 'Class level goal, or + levels to gain. Blank is the next level', { scrub: true, wide: true })];
  return [xph, one('left', 'EXP left', 'Optional', 'EXP left, if you have a goal', { scrub: true, wide: true })];
}
// What the box holds: the draft if there is one, then the activity's AFK stats or the task's own number.
function editorValue(owner, name) {
  const t = owner.task, ov = owner.overrides;
  if (ov && name in ov) return ov[name] ?? '';
  return (STAT_FIELDS.includes(name) ? statGet(owner.statTask || t, name) : t[name]) ?? '';
}
// The game's count, which a cleared kills left goes back to in a draft.
function editorAuto(owner, name) {
  const t = owner.task, ov = owner.overrides;
  if (name === 'kpkTotal') { const st = owner.statTask || t; return { value: fmtRate0(killsPerKill(st.slot, ov, st).worked), from: 'Worked out from the save and what you\u2019ve typed' }; }
  if (name === 'xph' && t.type === 'class') { const worked = classExpWorked(t, ov); return worked ? { value: fmtNum(worked), from: 'Worked out from kills per hour and what an AFK claim paid per kill' } : null; }
  if (name !== 'left' || !ov || !('left' in ov) || !blankText(ov.left)) return null;
  const game = gameLeft(t);
  return game == null ? null : { value: fmtNum(game), from: 'The game\u2019s count' };
}
function editorBad(owner, name, text) {
  if (name === 'goal' && owner.task.type !== 'card') return Number.isNaN(goalLevel({ goal: text, lvl: taskView(owner.task, owner.overrides).lvl }));
  return Number.isNaN(parseNum(text));
}
function editorControl(owner, def) {
  const t = owner.task;
  const input = field({ id: (owner.sim ? 'sim-' : '') + t.id, [def.name]: editorValue(owner, def.name) }, def.name, def.hint, def.aria);
  input.dataset.hint = def.hint;
  return labelled(def.label, def.scrub ? scrubbable(input) : input, def.wide);
}
// owner = { task, overrides?, sim, onEdit(field, value) }. Handlers come from wireTaskEditors on the container.
function buildTaskEditor(owner) {
  const t = owner.task, node = el('div', 'task-editor'), head = el('div', 'ed-head'), names = el('div', 'ed-names'), icon = el('img', 'ed-icon');
  node.dataset.task = t.id;
  icon.alt = '';
  icon.src = 'icons/' + taskIconName(t) + '.png';
  icon.addEventListener('error', () => icon.remove());
  names.append(el('div', 'ed-title'), el('div', 'small ed-line'));
  head.append(icon, names);
  if (!owner.sim) {
    const star = el('button', 'ed-star');
    star.type = 'button';
    star.dataset.star = '1';
    star.innerHTML = EDITOR_STAR;
    head.append(star);
  }
  const fields = el('div', 'fields');
  const defs = editorFields(t, owner);
  defs.forEach(def => fields.append(editorControl(owner, def)));
  const stats = el('div', 'stats');
  const earned = statBox('s-earned', 'Earned AFK'), wait = statBox('s-wait', 'AFK wait'), finish = statBox('s-finish', 'Finishes'), left = statBox('s-left', 'Left now'), clears = statBox('s-clears', 'Clears'), rate = statBox('s-rate', 'Rate');
  earned.append(el('div', 'big'), el('div', 'small'));
  wait.append(el('div', 'big'), el('span', 'pill'));
  finish.append(el('div', 'finish'), el('div', 'small'));
  left.append(el('div', 'big'), el('div', 'small lvl'), el('div', 'track'));
  left.querySelector('.track').append(el('div', 'fill'));
  clears.append(el('div', 'big'));
  rate.append(el('div', 'big'), el('div', 'small'));
  stats.append(earned, wait, finish, left, clears, rate, el('div', 'small s-real'));
  const shares = el('div', 'ed-shares');
  shares.hidden = true;
  node.append(head, fields, stats, shares);
  if (t.type === 'portal') node.append(el('div', 'ed-crew'));
  if (!owner.sim && defs.some(def => def.name === 'kpkTotal')) node.append(buildKpkHow(kpkOwnerOf(owner)));
  paintTaskEditor(node, owner, Date.now());
  return node;
}
const editorFew = n => n >= 1e-3 ? fmtRate(n) : n > 0 ? '<0.001' : '0'; // item rates can be tiny
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
function paintEditorFields(node, owner) {
  const t = owner.task;
  node.querySelectorAll('input[data-field]').forEach(input => {
    const name = input.dataset.field, value = String(editorValue(owner, name)), auto = editorAuto(owner, name);
    if (input !== document.activeElement && !(scrub && scrub.input === input) && input.value !== value) input.value = value;
    const hint = auto ? String(auto.value) : input.dataset.hint, from = auto ? auto.from : '';
    if (input.placeholder !== hint) input.placeholder = hint;
    if (input.title !== from) input.title = from;
    input.setAttribute('aria-invalid', String(editorBad(owner, name, input.value)));
  });
}
function paintEditorStats(node, owner, now) {
  const t = owner.sim && owner.statTask ? owner.statTask : owner.task, ov = owner.overrides, c = taskCalc(t, now, ov, true), vt = owner.statTask || t, v = taskView(vt, ov), one = s => node.querySelector(s); // the stats, and when they started, are the player's // AFK figures only. In Simulate, a card is the selected player's, so a draft of their stats moves it
  const running = !!v.startedAt && !c.done, kills = t.type === 'clear' || ((isCollection(t)) && t.source !== 'crystal' && t.source !== 'direct' && !blankText(v.kph));
  const since = v.afkSince || v.startedAt, away = since ? Math.max(now - since, 0) / 36e5 : 0;
  const unit = t.type === 'afkcap' ? 'hours' : t.type === 'portal' ? 'players' : t.type === 'clear' || t.type === 'outpost' ? 'kills' : t.type === 'forge' ? 'bars' : t.type === 'item' || t.type === 'craft' ? 'items' : t.type === 'card' ? 'cards' : 'EXP';
  node.classList.toggle('done', !!c.done);
  node.classList.toggle('afk', running);
  const hasRate = c.rate > 0, earned = one('.s-earned');
  // A shared task's rate is everyone's together: what this character earned is their own share over their own time away
  const shared = c.team && c.team.total > 1 && !owner.sim, mine = shared ? taskShares(t, now).find(s => s.slot === vt.slot) : null;
  earned.hidden = !hasRate || !since || c.done || (shared && !mine);
  if (!earned.hidden) {
    const got = mine ? mine.waiting : c.rate * away;
    setText(earned.querySelector('.big'), isCollection(t) ? editorFew(got) : fmtNum(got));
    setText(earned.querySelector('.small'), unit + ' in ' + fmtWait(away));
  }
  const big = one('.s-wait .big'), pill = one('.s-wait .pill'), when = one('.s-finish .finish'), note = one('.s-finish .small');
  const timed = c.done || c.hours != null;
  one('.s-finish').hidden = !timed;
  if (c.done) {
    setText(big, 'Ready!'); pill.className = 'pill ready'; setText(pill, 'Ready'); pill.hidden = false;
    setText(when, 'Now'); setText(note, '');
  } else if (c.hours != null) {
    const going = running || t.type === 'forge' || (c.team && c.team.others > 0); // someone else farming it is timed from the save too
    setText(big, fmtWait(c.hours, going)); pill.className = 'pill'; pill.hidden = true;
    setText(when, fmtClock(c.etaMs, now)); setText(note, going ? '' : 'if it started now');
  } else {
    setText(big, '–'); pill.className = 'pill needs'; pill.hidden = false;
    setText(pill, c.needs || c.line);
  }
  const leftBox = one('.s-left'), tooFar = c.line === 'Too far', levelled = t.type === 'skill' || t.type === 'class';
  leftBox.hidden = c.left == null && !tooFar;
  if (!leftBox.hidden) {
    setText(leftBox.querySelector('.big'), tooFar ? 'Too far' : fmtNum(c.left));
    const lvl = leftBox.querySelector('.lvl');
    setText(lvl, levelled ? (c.level != null ? 'EXP · Lv ' + c.level + ' → ' + c.target : 'EXP') : t.type === 'clear' ? '' : unit);
    lvl.hidden = !lvl.textContent;
    leftBox.querySelector('.fill').style.width = (c.pct * 100).toFixed(1) + '%';
  }
  one('.s-clears').hidden = c.clears == null;
  setText(one('.s-clears .big'), c.clears == null ? '' : c.clears.toLocaleString());
  const rateBox = one('.s-rate');
  rateBox.hidden = !hasRate;
  if (hasRate) {
    setText(rateBox.querySelector('.big'), editorFew(c.rate));
    setText(rateBox.querySelector('.small'), unit + ' / hour · ' + c.rateSource + (c.team && c.team.total > 1 ? ' · ' + teamLine(c.team) : ''));
  }
  const real = one('.s-real'), kph = parseNum(v.kph), kpk = kills && kph > 0 ? killsPerKill(vt.slot, ov, vt).value : 0;
  real.hidden = !(kpk > 1);
  if (!real.hidden) {
    const per = kph / kpk;
    setText(real, 'Real kills: ' + (since && away > 0 ? fmtRate(per * away) + ' gained · ' : '') + fmtRate(per) + ' per hour');
  }
  setText(one('.ed-line'), isCollection(t) || t.type === 'craft' || t.type === 'portal' || t.type === 'afkcap' || t.type === 'outpost' ? c.line : t.type === 'forge' ? [c.line, c.note].filter(Boolean).join(' · ') : '');
  one('.ed-line').hidden = !one('.ed-line').textContent;
}
function paintTaskEditor(node, owner, now) {
  const t = owner.task;
  if (!t) return;
  setText(node.querySelector('.ed-title'), taskTitle(t));
  const star = node.querySelector('[data-star]');
  if (star) {
    star.setAttribute('aria-pressed', String(!!t.starred));
    const says = t.starred ? 'Remove from goals' : 'Make this a goal';
    if (star.title !== says) { star.title = says; star.setAttribute('aria-label', says + ': ' + taskTitle(t)); }
  }
  paintEditorFields(node, owner);
  paintEditorStats(node, owner, now);
  paintEditorShares(node, t, now);
  paintEditorCrew(node, t, now);
  if (node.querySelector('.kpk-how')) paintKpkHow(node, kpkOwnerOf(owner));
}
const kpkOwnerOf = owner => ({ task: owner.statTask || owner.task }); // whose kills per kill: for an account item, the selected player's
// A multi-character portal: every character, cleared or not, with what's left for those who haven't.
function paintEditorCrew(node, t, now) {
  const box = node.querySelector('.ed-crew');
  if (!box) return;
  const crew = portalCrew(t.mapIdx, now), live = activePlayerSlot();
  const say = x => x.cleared ? 'Cleared' : x.left == null ? 'No data yet' : (x.there ? 'On it · ' : '') + fmtNum(Math.ceil(x.left)) + ' kills left' + (x.there && x.hours === 0 ? ' · cleared by now' : x.there && x.hours != null ? ' · ' + fmtWait(x.hours, true) : x.there && x.needs ? ' · ' + x.needs : '');
  const lists = [['Not cleared yet', crew.all.filter(x => !x.cleared).sort((a, b) => b.there - a.there)], ['Cleared', crew.all.filter(x => x.cleared)]];
  const sig = JSON.stringify(lists.map(([, l]) => l.map(x => [x.r.slot, x.r.name, x.r.hat, x.r.classIndex, say(x), x.r.slot === live])));
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.textContent = '';
  lists.forEach(([title, list]) => {
    if (!list.length) return;
    const group = el('div', 'ed-crew-group');
    group.append(el('div', 'label', title + ' · ' + list.length));
    list.forEach(x => {
      const row = el('div', 'ed-crew-row' + (x.cleared ? ' cleared' : x.there ? ' on' : '')), face = hatFace(x.r);
      row.dataset.slot = x.r.slot;
      if (face) row.append(face);
      const crewName = el('span', 'ed-crew-name');
      crewName.append(nameplate(x.r, true), x.r.slot === live ? ' · playing' : '');
      row.append(crewName, el('span', 'small ed-crew-say', say(x)));
      group.append(row);
    });
    box.append(group);
  });
}
// Who's on a shared task, and how much each would bring in if claimed now.
function paintEditorShares(node, t, now) {
  const box = node.querySelector('.ed-shares');
  if (!box) return;
  const shares = taskSection(t) === 'archive' ? [] : taskShares(t, now), text = shares.map(s => [s.slot, s.name, s.playing, fmtShare(s), (rows.find(x => x.slot === s.slot) || {}).tag].join('|')).join(';');
  box.hidden = !shares.length;
  if (box.dataset.sig === text) return;
  box.dataset.sig = text;
  box.textContent = '';
  if (shares.length) box.append(el('div', 'label', 'By player'));
  shares.forEach(s => {
    const row = el('div', 'ed-share'), dot = el('span', 'pc-dot');
    dot.style.background = shareColor(s.slot, shares.map(x => x.slot));
    row.dataset.slot = s.slot;
    const shareName = el('span', 'ed-share-name');
    shareName.append(slotPlate(s.slot, s.name), s.playing ? ' · playing' : '');
    row.append(dot, shareName, shareLine(s, 'small ed-share-num'));
    box.append(row);
  });
}
const editorLockable = t => t.type === 'skill' || t.type === 'class';
function lockEditorGoal(owner, input) { // "+5" locks in now, so later level updates don't move the goal
  const t = owner.task;
  if (!editorLockable(t) || !/^\+/.test(input.value.trim())) return;
  const level = goalLevel(taskView(t, owner.overrides));
  if (level == null || Number.isNaN(level)) return;
  input.value = String(level);
  owner.onEdit('goal', input.value);
  paintAll();
}
const editorsWired = new WeakSet();
// Handlers for every editor in a container, now or later. ownerOfNode(.task-editor node) gives its owner.
function wireTaskEditors(container, ownerOfNode) {
  if (editorsWired.has(container)) return;
  editorsWired.add(container);
  const ownerAt = n => { const node = n.closest('.task-editor'), o = node && ownerOfNode(node); return o && o.task ? o : null; };
  container.addEventListener('input', e => {
    const name = e.target.dataset.field, owner = name && ownerAt(e.target);
    if (owner && name === 'goal' && owner.task.type === 'card') { const held = cardGoalLimit(owner.task.monster, e.target.value); if (held !== e.target.value) e.target.value = held; } // typed or dragged, it stops at the top
    if (!owner || e.target.value === String(editorValue(owner, name))) return; // nothing actually changed
    owner.onEdit(name, e.target.value);
    paintAll();
  });
  container.addEventListener('change', e => {
    const owner = ownerAt(e.target);
    if (!owner) return;
    if (e.target.dataset.field === 'goal') lockEditorGoal(owner, e.target);
  });
  container.addEventListener('keydown', e => {
    const name = e.target.dataset.field;
    if (!name || !['Enter', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const back = e.key === 'ArrowUp', all = [...container.querySelectorAll('.task-editor')], at = all.indexOf(e.target.closest('.task-editor'));
    for (let i = at + (back ? -1 : 1); i >= 0 && i < all.length; i += back ? -1 : 1) {
      const next = all[i].querySelector('[data-field="' + name + '"]');
      if (next) { next.focus(); next.select(); return; }
    }
    if (e.key === 'Enter') e.target.blur();
  });
  container.addEventListener('pointerdown', e => {
    const handle = e.target.closest('[data-scrub]'), owner = handle && ownerAt(handle);
    if (!owner) return;
    e.preventDefault();
    const input = handle.previousElementSibling, t = owner.task, name = input.dataset.field;
    const empty = name !== 'goal' ? '0' : t.type === 'card' ? taskCalc(t, Date.now(), owner.overrides).rankNow - 1 : taskView(t, owner.overrides).lvl; // an empty goal starts from where the character is
    scrub = { handle, input, owner, startX: e.clientX, steps: 0, base: input.value.trim() || String(empty || '0'), original: input.value, before: { ...t } };
    handle.classList.add('held');
    try { handle.setPointerCapture(e.pointerId); } catch { /* the drag still works while the pointer stays over the page */ }
  });
  container.addEventListener('pointermove', e => {
    if (!scrub || !scrub.owner) return;
    const steps = Math.trunc((e.clientX - scrub.startX) / SCRUB_PX);
    if (steps === scrub.steps) return;
    scrub.steps = steps;
    const next = nudgeText(scrub.base, steps);
    if (next == null) return;
    scrub.input.value = next;
    scrub.input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const endDrag = () => {
    if (!scrub || !scrub.owner) return;
    const { handle, input, owner, original, before, steps } = scrub;
    scrub = null;
    handle.classList.remove('held');
    if (steps !== 0) { input.dispatchEvent(new Event('change', { bubbles: true })); return; } // locks in a goal like +5
    input.value = original; // back where it started, so it's as if it was never touched
    if (owner.sim) owner.onEdit(input.dataset.field, original);
    else {
      const t = owner.task;
      Object.keys(t).forEach(k => { if (!(k in before)) delete t[k]; });
      Object.assign(t, before);
      queueSave();
    }
    paintAll();
  };
  container.addEventListener('pointerup', endDrag);
  container.addEventListener('pointercancel', endDrag);
  container.addEventListener('click', e => {
    const star = e.target.closest('[data-star]'), owner = star && ownerAt(star);
    if (!owner) return;
    const t = owner.task, id = t.id, wasGoal = taskSection(t) === 'goal';
    toggleStar(t);
    queueSave();
    render();
    if (wasGoal) toast(taskTitle(t) + ' moved to the archive', () => { const back = tasks.find(x => x.id === id); if (back) { toggleStar(back); render(); queueSave(); } });
  });
}

/* ---------- the AFK planner tab ---------- */
let plannerFlash = null, plannerFlashTimer = null, plannerAddShown = null, plannerWhoShown = null, plannerOpened = null; // plannerOpened: a task jumped to, which stays in view whatever the selected player is doing
const plannerOwners = new Map();
function plannerOwner(id) { // by id, since setState replaces the task objects
  if (!plannerOwners.has(id)) plannerOwners.set(id, {
    get task() { return tasks.find(t => t.id === id) || null; },
    // An account item has no player of its own, so its AFK stats are the selected player's, on what gets it for them. A planned one goes by the activity it was planned for.
    get statTask() {
      const t = this.task, r = selectedRow();
      if (!t || !isCollection(t) || t.slot != null || t.source === 'direct' || !r || r.slot == null) return null;
      if (t.type === 'card') return cardAsPlayer(t, r); // a card: the selected player on its monster
      const here = itemSourcesFor(t.itemName, r)[0];
      return here ? { ...t, ...here, slot: r.slot } : t.activityKey ? { ...t, slot: r.slot } : null;
    },
    sim: false,
    onEdit(name, value) {
      const t = this.task, st = this.statTask;
      if (!t) return;
      if (st && STAT_FIELDS.includes(name)) statSet(st, name, value); else taskEdit(t, name, value);
      queueSave();
    },
  });
  return plannerOwners.get(id);
}
const plannerBusy = () => scrub || (document.activeElement && document.activeElement.matches('#plannerTasks input:not([type=checkbox]), #plannerAdd input:not([type=checkbox]), #plannerAdd select'));
function paintPlannerHead(r) {
  const box = $('plannerHead');
  if (!r) { box.textContent = ''; plannerWhoShown = null; return; }
  if (!box.firstChild) {
    const pick = el('div', 'fld-find plan-pick'), select = el('select'), who = el('div', 'plan-who');
    select.id = 'plannerWho';
    select.addEventListener('change', () => selectPlayer(select.value));
    select.menu = menuSelect(select, 'Player');
    who.id = 'plannerWhoBox';
    pick.append(el('span', 'label', 'Player'), select.menu.root);
    box.className = 'plan-head';
    box.append(pick, who);
  }
  const select = $('plannerWho'), live = activePlayerSlot(), list = rowsInOrder();
  list.forEach((x, i) => {
    const opt = select.options[i] || select.appendChild(el('option')), value = String(x.slot ?? x.id), text = (x.name || 'Unnamed') + (x.cls ? ' · ' + x.cls : '') + (x.slot != null && x.slot === live ? ' (active)' : '');
    if (opt.value !== value) opt.value = value;
    if (opt.textContent !== text) opt.textContent = text;
  });
  while (select.options.length > list.length) select.lastChild.remove();
  const value = String(selectedSlot());
  if (select.value !== value) select.value = value;
  select.menu.paint(list.map(x => playerMenuItem(x, live)));
  const info = r.slot == null ? [] : [ // the same lines as a sheet row's
    [r.cls, r.map].filter(Boolean).join(' · '),
    r.sideSkill ? r.sideSkill.name + ' Lv ' + r.sideSkill.lvl + (r.sideSkill.cost > 0 ? ' · ' + fmtNum(r.sideSkill.xp || 0) + ' / ' + fmtNum(r.sideSkill.cost) : '') : '',
    isSkill(r) && r.lvl ? SKILLS[r.kind] + ' Lv ' + r.lvl + (r.levelCost ? ' · ' + fmtNum(parseNum(r.xp) || 0) + ' / ' + fmtNum(r.levelCost) : '') : '',
    r.classLvl && r.kind !== '0' ? 'Class level ' + r.classLvl : '',
  ].filter(Boolean);
  const shown = JSON.stringify([r.slot, r.name, r.hat, r.classIndex, r.tag, r.doing, r.activity, r.monster, info]);
  if (shown === plannerWhoShown) return;
  plannerWhoShown = shown;
  const who = $('plannerWhoBox');
  who.textContent = '';
  who.hidden = r.slot == null; // a hand-typed character's line is in the sheet below
  if (r.slot == null) return;
  const face = portrait(r), text = el('div', 'text');
  if (face) who.append(face);
  const named = el('div', 'who-name');
  named.append(nameplate(r, true));
  text.append(named);
  if (r.doing) {
    const doing = el('span', 'doing'), icon = taskIcon(r), words = el('span', '', r.doing);
    if (icon) doing.append(icon);
    words.title = r.doing;
    doing.append(words);
    text.append(doing);
  }
  const lines = el('div', 'plan-lines');
  info.forEach(line => lines.append(el('span', 'char-info level-line', line)));
  text.append(lines);
  who.append(text);
}
function renderPlannerTasks(r) { renderActivity(r); } // the activity and its cards: activity-view.js
function renderPlannerAdd() { const box = $('plannerAdd'); if (box.firstChild) box.textContent = ''; plannerAddShown = null; } // goals are made from the activity's drops and boxes now
// Only when the player or the set of tasks changes, and never under a box being used. A paint tick catches up afterwards.
function renderPlanner() {
  const r = selectedRow();
  paintPlannerHead(r);
  if (plannerBusy()) return;
  renderPlannerTasks(r);
  renderActivityPicker(r);
  renderPlannerAdd(r);
}
function paintPlannerFlash() {
  document.querySelectorAll('#plannerTasks .tcard').forEach(node => node.classList.toggle('jump', node.dataset.task === plannerFlash));
}
function paintPlanner(now) {
  if ($('viewPlanner').hidden) return;
  renderPlanner();
  paintActivity(now);
}
function flashTask(id) {
  if ($('viewPlanner').hidden) showTab('planner');
  plannerOpened = id;
  renderPlanner();
  plannerFlash = id;
  paintPlannerFlash();
  clearTimeout(plannerFlashTimer);
  plannerFlashTimer = setTimeout(() => { plannerFlash = null; paintPlannerFlash(); }, 4000);
  const node = document.querySelector('#plannerTasks .tcard[data-task="' + id + '"]');
  if (node) node.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
