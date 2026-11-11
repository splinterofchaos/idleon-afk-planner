/* ---------- Simulate: other numbers on a task. Nothing is kept until Set Goal ---------- */
let simParts = null, simId = null, simDraft = {}, simListShown = null, simEditorShown = null, simWhoShown = null;
const simTask = () => tasks.find(t => t.id === simId) || null;
const simTyping = () => document.activeElement && document.activeElement.matches('#viewSimulate .task-editor input');
function simLeaveBox() { if (simTyping()) document.activeElement.blur(); } // a +5 locks in as it's left
function simUnchanged(t, name, value) {
  const own = STAT_FIELDS.includes(name) ? statGet(simOwner.statTask || t, name) : t[name]; // a card's stats are the selected player's
  return String(own ?? '') === String(value ?? '');
}
const simOwner = { // by id, since setState replaces the task objects
  get task() { return simTask(); },
  get overrides() { return simDraft; },
  get statTask() { return cardAsPlayer(simTask(), selectedRow()); }, // an account card: drafted as the selected player has it
  sim: true,
  onEdit(name, value) { // a box put back to the task's own value is no longer a draft. A cleared one is: '' stays in the draft
    const t = simTask();
    if (!t) return;
    if (simUnchanged(t, name, value)) delete simDraft[name];
    else simDraft[name] = value;
  },
};
function simPick(id) {
  const next = id || null;
  if (next === simId) return; // the same task again keeps what's been tried on it
  simLeaveBox();
  simId = next;
  simDraft = {};
}
function simulateTask(id) {
  simPick(id);
  if ($('viewSimulate').hidden) showTab('simulate');
  else paintSimulate(Date.now());
  const top = $('viewSimulate').getBoundingClientRect().top;
  if (top < 0 || top > innerHeight / 2) $('viewSimulate').scrollIntoView({ block: 'start' });
}
function showSimulate() { paintSimulate(Date.now()); }
function simList() {
  const name = t => { const r = rowOfTask(t); return t.slot == null ? 'Account' : (r && r.name) || 'Unnamed'; };
  const order = (a, b) => a.slot - b.slot || taskTitle(a).localeCompare(taskTitle(b));
  const of = s => tasks.filter(t => t.type !== 'craft' && t.type !== 'portal' && t.type !== 'afkcap' && t.type !== 'outpost' && !projectTaskHidden(t) && taskSection(t) === s);
  return [['Doing now', of('active').sort(order)], ['Goals', of('goal').sort(order)], ['Archive', of('archive').sort((a, b) => (b.lastActiveAt || 0) - (a.lastActiveAt || 0) || order(a, b))]]
    .filter(g => g[1].length).map(([group, list]) => [group, list.map(t => [t.id, name(t) + ' · ' + taskTitle(t)])]);
}
function paintSimList(p) {
  const select = p.select, focused = document.activeElement === select; // an open list has focus, and can't change under the mouse
  const want = simTask() ? simId : '', list = simList(), shown = JSON.stringify(list);
  select.disabled = !tasks.length;
  if (shown !== simListShown && !focused) {
    simListShown = shown;
    select.querySelectorAll('optgroup').forEach(g => g.remove());
    list.forEach(([group, items]) => {
      const g = el('optgroup');
      g.label = group;
      items.forEach(([id, label]) => { const o = el('option', '', label); o.value = id; g.append(o); });
      select.append(g);
    });
  }
  if (!focused && select.value !== want) select.value = want;
}
function paintSimWho(p, t) {
  const r = rowOfTask(t), shown = JSON.stringify([t.slot == null, r ? [r.slot, r.name, r.hat, r.classIndex, r.tag] : null]);
  if (shown !== simWhoShown) {
    simWhoShown = shown;
    p.who.textContent = '';
    const face = r && portrait(r), text = el('div', 'text');
    if (face) p.who.append(face);
    p.whoName = el('div', 'who-name');
    if (t.slot == null) p.whoName.textContent = 'Account';
    else p.whoName.append(nameplate(r, true));
    p.whoLine = el('div', 'char-info');
    text.append(p.whoName, p.whoLine);
    p.who.append(text);
  }
  const section = taskSection(t);
  setText(p.whoLine, [r && r.cls, section === 'active' ? 'Doing this now' : section === 'goal' ? 'A goal, not being done now' : 'Archived'].filter(Boolean).join(' · '));
}
function simCompare(t, now) {
  if (!Object.keys(simDraft).length) return '';
  const as = simOwner.statTask || t, a = taskCalc(as, now), b = taskCalc(as, now, simDraft);
  const say = c => c.done ? 'Ready!' : c.hours == null ? 'No ETA' : fmtWait(c.hours);
  if (say(a) === say(b)) return '';
  const gap = a.hours == null || b.hours == null ? 0 : a.hours - b.hours;
  return ['Now ' + say(a), 'Simulated ' + say(b), gap ? fmtWait(Math.abs(gap)) + (gap > 0 ? ' sooner' : ' later') : ''].filter(Boolean).join(' · ');
}
function paintSimulate(now = Date.now()) {
  if ($('viewSimulate').hidden) return;
  const p = simParts || (simParts = simBuild()), t = simTask();
  paintSimList(p);
  setText(p.none, simId && !t ? 'That task has been deleted. Pick another one.' : tasks.length ? 'Pick a task to try other numbers on it.' : 'No tasks yet. They appear when a character starts fighting or training a skill.');
  p.none.hidden = !!t;
  p.who.hidden = p.body.hidden = !t;
  if (!t) { simEditorShown = simWhoShown = null; p.host.textContent = ''; return; }
  paintSimWho(p, t);
  const shown = JSON.stringify([t.id, t.type, t.source, t.chance]);
  if (shown !== simEditorShown && !scrub && !simTyping()) {
    simEditorShown = shown;
    p.host.textContent = '';
    p.host.append(buildTaskEditor(simOwner));
  }
  const node = p.host.firstChild;
  if (node && node.dataset.task === t.id) paintTaskEditor(node, simOwner, now);
  const gap = simCompare(t, now);
  setText(p.compare, gap);
  p.compare.hidden = !gap;
}
function simReset() {
  simLeaveBox();
  simDraft = {};
  paintAll();
}
function simSetGoal() {
  simLeaveBox();
  const t = simTask();
  if (!t) return;
  const bad = simParts.host.querySelector('[aria-invalid="true"]');
  if (bad) { bad.focus(); bad.select(); return; }
  const st = simOwner.statTask, id = t.id, slot = st ? st.slot : t.slot, r = rowOfTask(st || t), now = Date.now(), before = JSON.parse(JSON.stringify(t)), rowBefore = {}, ratesBefore = JSON.parse(JSON.stringify(rates));
  ['dr', 'mk'].forEach(f => { if (r && f in r) rowBefore[f] = r[f]; });
  const sharedStats = Object.keys(simDraft).some(f => STAT_FIELDS.includes(f));
  const kept = upsertTask({ slot: t.slot, type: t.type, key: t.key, starred: true }, now);
  Object.entries(simDraft).forEach(([name, value]) => { if (st && STAT_FIELDS.includes(name)) { kept.editedAt = now; statSet(st, name, value); } else taskEdit(kept, name, value, now); }); // a card's stats are its player's
  taskLockGoal(kept);
  simDraft = {};
  queueSave();
  render();
  toast(sharedStats ? 'Added to goals. AFK stats saved for the whole activity' : 'Added to goals', () => {
    const back = tasks.find(x => x.id === id), row = rows.find(x => x.slot === slot);
    if (!back) return;
    Object.keys(back).forEach(k => { if (!(k in before)) delete back[k]; });
    Object.assign(back, before);
    if (row) ['dr', 'mk'].forEach(f => { if (f in rowBefore) row[f] = rowBefore[f]; else delete row[f]; });
    rates = ratesBefore;
    queueSave();
    render();
  });
}
function simBuild() {
  const box = $('viewSimulate'), head = el('div', 'plan-head'), pick = el('label', 'fld-find sim-pick'), select = el('select'), first = el('option', '', 'Choose a task');
  const p = { select, who: el('div', 'plan-who'), none: el('p', 'plan-note sim-none'), body: el('div', 'sim-body'), host: el('div', 'sheet'), compare: el('p', 'sim-compare'), whoName: null, whoLine: null };
  const actions = el('div', 'sim-actions'), reset = el('button', 'sim-reset', 'Reset'), go = el('button', 'main sim-go', 'Set Goal');
  select.id = 'simPick';
  first.value = '';
  select.append(first);
  select.addEventListener('change', () => { simPick(select.value); paintAll(); });
  pick.append(el('span', 'label', 'Task'), select);
  head.append(pick, p.who);
  reset.type = go.type = 'button';
  reset.id = 'simReset';
  go.id = 'simGo';
  reset.addEventListener('click', simReset);
  go.addEventListener('click', simSetGoal);
  actions.append(go, reset);
  p.host.id = 'simEditor';
  p.compare.id = 'simCompare';
  p.none.id = 'simNone';
  p.body.append(el('p', 'sim-note', 'Changes here don’t touch the task until you press Set Goal.'), p.host, p.compare, actions);
  box.append(head, p.none, p.body);
  wireTaskEditors(p.host, () => simOwner);
  return p;
}
