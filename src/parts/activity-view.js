/* ---------- the AFK planner, activity first ----------
   What a character is doing holds everything typed or measured about it, once: its AFK stats and its drops.
   Its tasks sit beside it as read-only cards that only say what's particular to each. A click on one opens it on the Player tab. */
let actShown = null, actGoalOpen = null, actMoreOpen = false; // actGoalOpen: the goal box being typed in, by its key

// Odds the way the game's monster screen writes them: rounded up, with commas, and in words from ten million.
const ACT_WORDS = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million']];
function dropOdds(p) {
  if (!(p > 0)) return '';
  const n = Math.ceil(1 / p - 1e-9);
  if (n >= 1e7) {
    const [size, word] = ACT_WORDS.find(([s]) => n >= s), v = n / size, places = v >= 100 ? 0 : v >= 10 ? 1 : 2, k = Math.pow(10, places);
    return '1 in ' + String(Math.floor(v * k + 1e-9) / k) + ' ' + word;
  }
  return '1 in ' + n.toLocaleString('en-US');
}
// The stats task for the activity shown: whoever's selected, on what they're doing or what's planned for them.
const actRow = () => { const r = selectedRow(); return r && r.slot != null ? plannedRow(r) : null; };
const actStat = pr => ({ ...rowStatTask(pr), mapIdx: pr.mapIdx, monster: pr.monster, afkId: pr.monster });
const actClassTask = pr => tasks.find(t => t.type === 'class' && t.slot === pr.slot) || null;
const actSkillTask = pr => isSkill(pr) ? tasks.find(t => t.type === 'skill' && t.slot === pr.slot && String(t.skill) === String(kindOf(pr))) || null : null;
const actClearTask = pr => tasks.find(t => t.type === 'clear' && t.slot === pr.slot && (t.mapIdx === pr.mapIdx || (t.mapIdx == null && t.activityKey === pr.activityKey))) || null;
const actLive = t => !!t && taskSection(t) !== 'archive';
// The boxes this activity has. goal: the level task the box's EXP goes to, whose chip sits under it.
function actFields(pr) {
  const kind = kindOf(pr);
  if (kind === 'kills') return [
    { f: 'kph', label: 'Kills / hour', hint: '12k' },
    { f: 'mk', label: 'Multikill %', hint: '0', note: 'AFK Info screen' },
    { f: 'dr', label: 'Drop rate', hint: '5.2' },
    { f: 'kpkTotal', label: 'Kills per kill', hint: '' },
    { f: 'xph', label: 'Class EXP / hour', hint: '50k', goal: 'class' },
  ];
  if (!isSkill(pr)) return [];
  const out = [{ f: 'xph', label: (SKILLS[kind] || 'Skill') + ' EXP / hour', hint: '50k', goal: 'skill' }];
  if (gatheredItem(pr)) out.unshift({ f: 'iph', label: gatherWord({ activityKey: pr.activityKey }) + ' / hour', hint: '20' });
  return out;
}
// What a box shows when nothing's typed: the app's own figure, if it has one.
function actAuto(pr, f) {
  if (f === 'dr' || f === 'mk') { const g = statGuess(actStat(pr), f); return g > 0 ? fmtRate(g) : null; } // the team's drop rate, the map's multikill
  if (f === 'kpkTotal') return fmtRate0(killsPerKill(pr.slot, null, actStat(pr)).worked);
  if (f === 'xph' && kindOf(pr) === 'kills') { const t = actClassTask(pr), worked = t ? classExpWorked(t) : 0; return worked ? fmtNum(worked) : null; }
  return null;
}
// The drops, with each one's task and goal chip.
function actDrops(pr) {
  if (!saveForFinder) return [];
  // the game stops listing a drop that comes only once (an anvil recipe), so it isn't here either
  return grindOptions(pr).filter(o => !rawNamesOf(o.itemName).some(raw => ONCE_DROPS.has(raw))).map(o => {
    const made = taskFromOption(pr, o), key = taskKey(made), own = tasks.find(t => t.key === key), statue = /^EquipmentStatues(\d+)$/.exec(rawNamesOf(o.itemName)[0] || ''), sg = statue ? statueGoal(+statue[1] - 1) : null;
    const t = actLive(own) ? own : null, chip = t ? (made.type === 'card' ? (blankText(t.goal) ? 'Next ★' : t.goal + '★') : blankText(t.amount) ? 'Any' : fmtNum(taskTarget(t) ?? parseNum(t.amount))) : null;
    const m = { ...made, slot: pr.slot, activityKey: pr.activityKey, afkId: pr.monster, mapIdx: pr.mapIdx };
    const live = pr.slot === activePlayerSlot(), rate = o.source === 'skill' || o.source === 'direct' ? 0 : memberRate(m, o.chance, live);
    // No drop rate typed: a low estimate at drop rate 1 beats none, marked as at least
    let low = 0;
    if (!(rate > 0) && o.chance && (o.source === 'monster' || o.source === 'crystal')) {
      const kph = (live && o.source !== 'crystal' && lootKills(m)) || parseNum(statGet(m, 'kph'));
      if (kph > 0) low = (o.source === 'crystal' ? kph : realKills(kph, m.slot, null, m) * commonRolls(m)) * o.chance * cardDropMulti(m) * bundleOf(m);
    }
    return { o, made, key, task: t, statueGoal: sg, chip, rate: rate > 0 ? rate : low, low: !(rate > 0) && low > 0, icon: taskIconName({ ...made, itemName: o.itemName }) };
  }).sort((a, b) => (b.o.chance ?? 2) - (a.o.chance ?? 2)); // the most common first, as the game lists them; gathered things and skill cards before any drop
}
function actOdds(o) {
  if (o.chance) return dropOdds(o.chance);
  return o.source === 'flat' ? 'Gathered' : o.source === 'skill' ? 'Skill card' : '';
}
// The tasks shown: what's being worked on here, then goals not being done now.
function actTaskLists(r) {
  const mine = r && r.slot != null ? tasks.filter(t => !t.statueTo && (t.slot === r.slot || isCollection(t))) : []; // a statue level goal shows as its Collect task
  // A collection task is the account's, so it's here only for whoever's on a source of it, or has it planned. The panel and Projects have the rest.
  const onIt = t => !isCollection(t) || (teamOf(t) ? teamOf(t).includes(r) : rowMatches(t, r)), plan = plannedRow(r);
  const relevant = t => !isCollection(t) || t.id === plannerOpened || (plan !== r && t.activityKey === plan.activityKey);
  const active = mine.filter(t => taskSection(t) === 'active' && onIt(t)), goals = mine.filter(t => taskSection(t) !== 'archive' && !active.includes(t) && relevant(t));
  return { active, goals };
}
function renderActivity(r) {
  const box = $('plannerTasks'), pr = r && r.slot != null ? plannedRow(r) : null;
  if (!pr) { if (actShown !== null) { box.textContent = ''; actShown = null; } return; }
  const { active, goals } = actTaskLists(r), drops = actDrops(pr), fields = actFields(pr);
  const shown = JSON.stringify([pr.slot, r.name, r.tag, pr.activityKey, pr.doing, pr !== r, active.map(t => t.id), goals.map(t => t.id), drops.map(d => [d.o.itemName, d.chip, d.task && d.task.id]), fields.map(x => x.f), actGoalChips(pr), actGoalOpen, actMoreOpen, !!saveForFinder]);
  if (shown === actShown) return;
  actShown = shown;
  const keep = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.stat : null;
  box.textContent = '';
  box.className = 'act';
  const pane = el('section', 'act-pane'), col = el('div', 'act-cards');
  pane.setAttribute('aria-label', 'Activity');
  // the activity: what it is
  const head = el('div', 'act-head'), big = el('span', 'act-big'), icon = taskIcon(pr), names = el('div', 'act-names');
  if (icon) big.append(icon);
  const status = pr !== r ? 'Planned' : pr.slot === activePlayerSlot() ? 'Playing' : pr.afkSince ? 'AFK' : '';
  const title = el('h2', 'act-title', pr !== r ? pickPlanned.name : pr.doing || 'Idle');
  if (status) title.append(el('span', 'act-pill' + (pr !== r ? ' planned' : ''), status));
  const where = el('span', 'small act-where');
  where.append(pr.map ? pr.map + ' · ' : '', nameplate(r, true));
  names.append(title, where);
  head.append(big, names);
  pane.append(head);
  // what's typed about it, once
  if (fields.length) {
    const grid = el('div', 'act-fields');
    fields.forEach(def => {
      const wrap = el('label', 'fld act-fld'), input = el('input'), hint = el('span', 'small act-hint');
      input.dataset.stat = def.f;
      input.dataset.hint = def.hint;
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', def.label);
      wrap.dataset.stat = def.f;
      wrap.append(el('span', 'label', def.label), input, hint);
      if (def.goal) wrap.append(actLevelChip(pr, def.goal));
      grid.append(wrap);
    });
    pane.append(grid);
  }
  // what follows from it
  if (kindOf(pr) === 'kills') {
    const derived = el('div', 'act-derived');
    [['real', 'Real kills'], ['kpc', 'Kills / clear'], ['away', 'AFK for']].forEach(([k, label]) => {
      const cell = el('div', 'act-d');
      cell.dataset.d = k;
      cell.append(el('span', 'label', label), el('b'));
      if (k === 'kpc') { const t = actClearTask(pr); if (actLive(t)) cell.append(el('span', 'act-chip static', 'Clear')); }
      derived.append(cell);
    });
    pane.append(derived, buildKpkHow({ task: actStat(pr) }));
  }
  // its drops, as the game lists them
  if (drops.length) {
    // the monster's own drops first; a world's crystals, which only drop while playing, under their own name
    // As the game's monster screen: the monster's own drops, then each table beneath it (the rare drop, and any rarer table inside that) in a group of its own at the chance of reaching it; a world's crystals last
    const tableOf = d => { if (d.o.source !== 'monster' || typeof DROP_TABLES === 'undefined') return -1; const raws = rawNamesOf(d.o.itemName); return (DROP_TABLES[d.o.monster] || []).findIndex(t => t[1].some(raw => raws.includes(raw))); };
    drops.forEach(d => { d.table = tableOf(d); d.group = d.o.group + (d.table >= 0 ? '|table' + d.table : ''); });
    const rank = g => { const d = drops.find(x => x.group === g); return d.table >= 0 ? 1 + d.table : d.o.source === 'crystal' ? 99 : 0; };
    const groups = [...new Set(drops.map(d => d.group))].sort((a, b) => rank(a) - rank(b)), hidden = [];
    const label = (g, gi) => { const d = drops.find(x => x.group === g); if (d.table < 0) return gi === 0 ? 'Drops' : g; const t = DROP_TABLES[d.o.monster][d.table]; return (d.table === 0 ? 'Rare drop' : 'Rarer table inside it') + ' · ' + dropOdds(t[0]); };
    groups.forEach((g, gi) => {
      const list = drops.filter(d => d.group === g), head2 = el('div', 'act-drops-head'), grid = el('div', 'act-drops');
      list.forEach((d, i) => { if (i >= 6 && !d.task && !d.chip) hidden.push(d); });
      head2.append(el('span', 'label', label(g, gi)));
      list.forEach(d => { if (actMoreOpen || !hidden.includes(d)) grid.append(actTile(pr, d)); });
      if (grid.firstChild) pane.append(head2, grid);
    });
    if (hidden.length) {
      const more = el('button', 'act-more', actMoreOpen ? 'Show fewer drops' : 'Show ' + hidden.length + ' more drop' + (hidden.length === 1 ? '' : 's'));
      more.type = 'button';
      more.addEventListener('click', () => { actMoreOpen = !actMoreOpen; actShown = null; renderActivity(selectedRow()); });
      pane.append(more);
    }
  } else if (!saveForFinder) pane.append(el('p', 'plan-note', 'Drops show once your game data has arrived.'));
  else if (kindOf(pr) === 'idle') pane.append(el('p', 'plan-note', (r.name || 'This character') + ' is idle, so there is nothing to collect.'));
  // its tasks, read only
  const group = (title, list) => {
    if (!list.length) return;
    col.append(el('h2', 'label plan-group', title));
    list.forEach(t => col.append(actCard(t)));
  };
  group(pr !== r ? 'Tasks on ' + pickPlanned.name : 'Tasks on this activity', active);
  group('Goals, not being done now', goals);
  if (!active.length && !goals.length) col.append(el('p', 'plan-note', (r.name || 'This character') + ' has nothing to track right now.'));
  box.append(pane, col);
  paintActivity(Date.now());
  paintPlannerFlash();
  if (keep) { const back = box.querySelector('input[data-stat="' + keep + '"]'); if (back) back.focus(); }
  if (actGoalOpen) { const open = box.querySelector('.act-goal-form input'); if (open) { open.focus(); open.select(); } }
}
// The chips under the EXP box and Kills / clear, for the shown key.
function actGoalChips(pr) {
  const c = actClassTask(pr), s = actSkillTask(pr), k = actClearTask(pr);
  return [actLive(c) && c.goal, actLive(s) && s.goal, actLive(k)];
}
// A goal chip, or the box it opens into. key: what it's for; text: the chip, or null for "+ Goal".
function actGoalChip(key, text, value, placeholder, aria, save) {
  if (actGoalOpen === key) {
    const form = el('form', 'act-goal-form'), input = el('input');
    input.value = value || '';
    input.placeholder = placeholder;
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', aria);
    form.append(input);
    form.addEventListener('submit', e => { e.preventDefault(); actGoalOpen = null; save(input.value.trim()); input.blur(); syncTasks(); queueSave(); render(); });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') { actGoalOpen = null; input.blur(); actShown = null; renderActivity(selectedRow()); } });
    input.addEventListener('blur', () => { if (actGoalOpen === key) setTimeout(() => { if (actGoalOpen === key) { actGoalOpen = null; actShown = null; renderActivity(selectedRow()); } }); });
    return form;
  }
  const b = el('button', text ? 'act-chip' : 'act-add', text || '+ Goal');
  b.type = 'button';
  b.dataset.goal = key;
  b.title = text ? 'Change the goal' : 'Make a task for this';
  b.setAttribute('aria-label', (text ? 'Goal ' + text + ': change it, ' : 'Add a goal: ') + aria);
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); actGoalOpen = key; actShown = null; renderActivity(selectedRow()); });
  return b;
}
// The class or skill level goal under its EXP box.
function actLevelChip(pr, which) {
  const t = which === 'class' ? actClassTask(pr) : actSkillTask(pr), live = actLive(t), lvl = which === 'class' ? pr.classLvl : pr.lvl;
  const shown = live ? (blankText(t.goal) ? 'Next level' : 'Lv ' + (goalLevel(taskView(t)) ?? t.goal)) : null;
  if (!live && which === 'skill') return el('span');
  return actGoalChip(which + '|' + pr.slot, shown, live ? t.goal : '', String((parseNum(lvl) || 0) + 1) + ' or +5', which === 'class' ? 'Class level goal' : (SKILLS[kindOf(pr)] || 'Skill') + ' level goal', text => {
    if (!blankText(text) && Number.isNaN(goalLevel({ goal: text, lvl }))) { toast('Enter a level, or + levels to gain'); return; }
    let task = t;
    if (task) { taskEdit(task, 'goal', text); task.starred = true; task.hidden = false; }
    else task = upsertTask({ slot: pr.slot, type: 'class', match: { kind: 'fighting' }, goal: text, auto: false, starred: true });
    taskLockGoal(task);
  });
}
function actTile(pr, d) {
  const { o, made } = d, tile = el('div', 'act-drop' + (d.task ? ' has-task' : '')), ic = el('span', 'act-drop-ic'), img = el('img'), text = el('span', 'act-drop-t'), side = el('span', 'act-drop-side');
  tile.dataset.item = o.itemName;
  img.alt = ''; img.src = 'icons/' + d.icon + '.png';
  img.addEventListener('error', () => img.remove());
  ic.append(img);
  text.append(el('b', '', o.itemName), el('span', 'act-odds', actOdds(o)));
  const card = made.type === 'card', existing = tasks.find(t => t.key === d.key);
  side.append(actGoalChip('drop|' + d.key, d.chip, d.task && d.task.key === d.key ? (card ? d.task.goal : d.task.amount) : '', card ? 'Stars' : 'Amount', (card ? 'Target stars for ' : 'Amount of ') + o.itemName, text => {
    if (card) {
      const goal = cardGoalLimit(o.monster, text);
      if (existing) { taskEdit(existing, 'goal', goal); existing.starred = true; existing.hidden = false; }
      else upsertTask({ ...made, goal, auto: false, starred: true });
    } else {
      if (!blankText(text) && !(parseNum(text) > 0)) { toast('Enter an amount, or leave it blank for no amount'); return; }
      if (existing) { taskEdit(existing, 'amount', text); existing.starred = true; existing.hidden = false; }
      else upsertTask({ ...made, amount: text, auto: false, starred: true });
    }
  }), el('span', 'act-rate'));
  actPaintRate(side.lastChild, pr, d);
  tile.append(ic, text, side);
  return tile;
}
// A drop's rate, under its goal chip. Repainted each second, so a stat typed above shows at once.
function actPaintRate(span, pr, d) {
  setText(span, d.rate > 0 ? (d.low ? '≥ ' : '') + editorFew(d.rate) + ' / hr' : '–');
  const why = d.low ? 'At least: worked out at drop rate 1' + (blankText(rowStat(pr, 'mk')) ? ' and no multikill' : '') + ', until you type them above' : d.rate > 0 ? 'Per hour from this character’s AFK stats' : d.o.source === 'crystal' ? CRYSTAL_ACTIVE_ONLY : d.o.source === 'skill' ? 'Measured from the saves once a task tracks it' : 'Needs the AFK stats above';
  if (span.title !== why) span.title = why;
}
// One task, read only: the card is its own progress bar, as in the panel.
function actCard(t) {
  const node = el('article', 'tcard'), fill = el('span', 'tcard-fill'), icon = el('img', 'tcard-ic'), top = el('div', 'tcard-top'), names = el('div', 'tcard-names'), when = el('div', 'tcard-when');
  node.dataset.task = t.id;
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.title = 'Open on the Player tab';
  icon.alt = ''; icon.src = 'icons/' + taskIconName(t) + '.png';
  icon.addEventListener('error', () => icon.remove());
  names.append(el('b', 'tcard-title'), el('span', 'small tcard-line'));
  when.append(el('b', 'tcard-wait'), el('span', 'small tcard-eta'));
  top.append(icon, names, when);
  node.append(fill, top, el('div', 'small tcard-note'));
  const open = () => { const x = tasks.find(y => y.id === t.id); if (x) openTaskInPlayer(x); };
  node.addEventListener('click', open);
  node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return node;
}
const ACT_AUTO_WORD = { dr: 'team average', mk: 'map average', kpkTotal: 'worked out', xph: 'worked out' };
const ACT_NEEDS = [['kph', /kills \/ hour|AFK stats/i], ['dr', /drop rate|AFK stats/i], ['xph', /exp \/ hour/i], ['iph', /\/ hour/i]];
function paintActCard(node, t, now) {
  const c = taskCalc(t, now), r = rowOfTask(t), going = (r && r.afkSince) || t.type === 'forge' || (c.team && c.team.others > 0);
  setText(node.querySelector('.tcard-title'), taskTitle(t));
  const goal = t.statueGoalOf != null ? statueGoal(t.statueGoalOf) : null; // a statue's Collect task says which level it's for
  setText(node.querySelector('.tcard-line'), [c.line && c.line !== c.needs ? c.line : '', goal ? 'for level ' + fmtNum(goal.statueTo) : ''].filter(Boolean).join(' · '));
  setText(node.querySelector('.tcard-wait'), c.done ? 'Ready!' : c.hours != null ? fmtWait(c.hours, going) : c.rate > 0 ? editorFew(c.rate) + '/h' : '–');
  setText(node.querySelector('.tcard-eta'), c.done ? 'Now' : c.hours != null && c.etaMs ? fmtClock(c.etaMs, now) : c.rate > 0 && c.team && c.team.total > 1 ? teamLine(c.team) : '');
  const pct = c.done ? 1 : c.pct > 0 ? Math.min(c.pct, 1) : 0;
  node.querySelector('.tcard-fill').style.width = (pct * 100).toFixed(1) + '%';
  node.classList.toggle('done', !!c.done);
  // the one thing particular to it: what it still needs, else who's on it, else what's waiting
  const act = node.closest('.act'), needs = !c.done && c.hours == null && c.needs, fields = needs && act ? ACT_NEEDS.filter(([f, re]) => re.test(needs) && act.querySelector('input[data-stat="' + f + '"]')).map(([f]) => f) : [];
  // A shared task, seen from the character on screen: their own rate and what they have waiting to claim, then how many share it
  const shares = !needs && isCollection(t) ? taskShares(t, now) : [], pr = actRow(), mine = pr && shares.find(s => s.slot === pr.slot);
  const own = mine ? (pr.name || 'This character') + ': ' + editorFew(mine.rate) + ' / hr' + (mine.waiting > 0 ? ' · ' + editorFew(mine.waiting) + ' waiting to claim' : '') : '';
  const note = needs ? (fields.length ? '← ' : '') + needs : shares.length > 1 ? [own, shares.length + ' players on it'].filter(Boolean).join(' · ') : own || c.note || '';
  setText(node.querySelector('.tcard-note'), note);
  node.querySelector('.tcard-note').hidden = !note;
  node.classList.toggle('warn', !!needs);
  return fields;
}
// Each second: the boxes' values, the figures under them, and the cards.
function paintActivity(now) {
  const box = $('plannerTasks'), pr = actRow();
  if (!pr || !box.querySelector('.act-pane')) return;
  const wanted = new Set();
  box.querySelectorAll('.tcard').forEach(node => { const t = tasks.find(x => x.id === node.dataset.task); if (t) paintActCard(node, t, now).forEach(f => wanted.add(f)); });
  box.querySelectorAll('input[data-stat]').forEach(input => {
    const f = input.dataset.stat, value = String(rowStat(pr, f) ?? ''), auto = actAuto(pr, f), hint = auto || input.dataset.hint;
    if (input !== document.activeElement && input.value !== value) input.value = value;
    if (input.placeholder !== hint) input.placeholder = hint;
    input.setAttribute('aria-invalid', String(!blankText(input.value) && Number.isNaN(parseNum(input.value))));
    const wrap = input.closest('.act-fld'), want = wanted.has(f) && blankText(input.value) && !auto;
    wrap.classList.toggle('want', want);
    const def = actFields(pr).find(x => x.f === f);
    setText(wrap.querySelector('.act-hint'), want ? 'A task here needs it' : auto && (blankText(input.value) || ((f === 'dr' || f === 'mk') && !(parseNum(input.value) > 0))) ? ACT_AUTO_WORD[f] || 'worked out' : blankText(input.value) ? (def && def.note) || '' : (def && def.note) || 'typed');
  });
  const tiles = box.querySelectorAll('.act-drop[data-item]');
  if (tiles.length) {
    const by = new Map(actDrops(pr).map(x => [x.o.itemName, x]));
    tiles.forEach(n => { const x = by.get(n.dataset.item), span = n.querySelector('.act-rate'); if (x && span) actPaintRate(span, pr, x); });
  }
  const d = k => box.querySelector('[data-d="' + k + '"] b');
  if (d('real')) {
    const st = actStat(pr), kpk = killsPerKill(pr.slot, null, st).value, kph = parseNum(rowStat(pr, 'kph')), clear = actClearTask(pr), r = selectedRow();
    setText(d('real'), kph > 0 && kpk > 0 ? fmtRate(kph / kpk) + '/h' : '–');
    const kpc = clear ? taskField(clear, 'kpc') : '';
    setText(d('kpc'), blankText(kpc) ? '–' : String(kpc));
    setText(d('away'), pr === r && r.afkSince ? fmtWait(Math.max(now - r.afkSince, 0) / 36e5) : '–');
    paintKpkHow(box.querySelector('.act-pane'), { task: st });
  }
}
// The boxes' handlers, once.
(function wireActivity() {
  const box = $('plannerTasks');
  box.addEventListener('input', e => {
    const f = e.target.dataset.stat, pr = f && actRow();
    if (!pr) return;
    if (e.target.value === String(rowStat(pr, f) ?? '')) return;
    setRowStat(pr, f, e.target.value);
    queueSave();
    paintAll();
  });
  box.addEventListener('keydown', e => {
    if (!e.target.dataset.stat || e.key !== 'Enter') return;
    e.preventDefault();
    e.target.blur();
  });
  wireKpkHow(box, target => { const pr = target.closest('.act-pane') && actRow(); return pr ? { task: actStat(pr) } : null; });
})();
