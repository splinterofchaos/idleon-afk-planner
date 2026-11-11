/* ---------- the Player tab: every task one player has, and a search over them ---------- */
let playerShown = null, playerWhoShown = null, playerArchiveOpen = false;
const playerBusy = () => scrub || (document.activeElement && document.activeElement.matches('#playerTasks input:not([type=checkbox]), #playerTasks select'));
// The player's own tasks, and the account's collection tasks they're on, could be on, or have planned.
function playerTasksOf(r) {
  if (!r || r.slot == null) return [];
  const plan = plannedRow(r);
  return tasks.filter(t => !t.statueTo).filter(t => t.slot === r.slot || t.type === 'portal' || (isCollection(t) && t.slot == null && ((teamOf(t) || []).includes(r) || rowMatches(t, r) || (plan && plan !== r && t.activityKey && t.activityKey === plan.activityKey))));
}
const PLAYER_KIND = { card: 'card', clear: 'clear map kills', class: 'class level', skill: 'skill level', exp: 'exp level', item: 'collect item', forge: 'forge bar', craft: 'craft', portal: 'portal unlock players', afkcap: 'collect afk gains unending energy prayer cap' };
// Everything a search can hit: the title, what it's on and what kind of task it is.
function playerHaystack(t) {
  const activity = String(t.activityKey || '').split('|')[0];
  return [taskTitle(t), t.itemName, t.monster && monsterName(t.monster), t.raw && itemName(t.raw), GAME.maps[t.mapIdx], ACTIVITY[activity], EXP_SKILLS[t.skill], PLAYER_KIND[t.type], t.starred ? 'starred' : '', taskSection(t)].filter(Boolean).join(' ').toLowerCase();
}
const playerWords = q => q.toLowerCase().split(/\s+/).filter(Boolean);
const playerMatches = (t, words) => { const hay = playerHaystack(t); return words.every(w => hay.includes(w)); };
function paintPlayerHead(r) {
  const box = $('playerHead');
  if (!box.firstChild) {
    const pick = el('div', 'fld-find plan-pick'), select = el('select'), find = el('label', 'fld-find pv-find'), search = el('input');
    select.id = 'playerWho';
    select.addEventListener('change', () => selectPlayer(select.value));
    select.menu = menuSelect(select, 'Player');
    search.id = 'playerSearch';
    search.type = 'search';
    search.placeholder = 'Card, map, item…';
    search.autocomplete = 'off';
    search.spellcheck = false;
    search.addEventListener('input', () => renderPlayer());
    pick.append(el('span', 'label', 'Player'), select.menu.root);
    find.append(el('span', 'label', 'Search tasks'), search);
    const count = el('span', 'small pv-count');
    count.id = 'playerCount';
    count.setAttribute('role', 'status');
    box.append(pick, find, count);
  }
  const select = $('playerWho'), live = activePlayerSlot(), list = rowsInOrder();
  const shown = JSON.stringify([list.map(x => [x.slot ?? x.id, x.name, x.cls, x.hat, x.classIndex, x.tag]), live, selectedSlot()]);
  if (shown === playerWhoShown) return;
  playerWhoShown = shown;
  list.forEach((x, i) => {
    const opt = select.options[i] || select.appendChild(el('option')), value = String(x.slot ?? x.id), text = (x.name || 'Unnamed') + (x.cls ? ' · ' + x.cls : '') + (x.slot != null && x.slot === live ? ' (active)' : '');
    if (opt.value !== value) opt.value = value;
    if (opt.textContent !== text) opt.textContent = text;
  });
  while (select.options.length > list.length) select.lastChild.remove();
  const value = String(selectedSlot());
  if (select.value !== value) select.value = value;
  select.menu.paint(list.map(x => playerMenuItem(x, live)));
}
function renderPlayer() {
  if ($('viewPlayer').hidden) return;
  const r = selectedRow();
  paintPlayerHead(r);
  if (playerBusy()) return;
  const query = $('playerSearch').value.trim(), words = playerWords(query), all = playerTasksOf(r), hits = all.filter(t => playerMatches(t, words));
  const by = s => hits.filter(t => taskSection(t) === s);
  const groups = [['Predictions', by('active')], ['Goals, not being done now', by('goal')], ['Archive', by('archive')]];
  const shown = JSON.stringify([r && (r.slot ?? r.id), query, groups.map(([, list]) => list.map(t => { const st = plannerOwner(t.id).statTask; return [t.id, t.type, t.source, st && st.source]; }))]);
  if (shown === playerShown) return;
  playerShown = shown;
  const box = $('playerTasks');
  box.textContent = '';
  $('playerCount').textContent = !all.length ? '' : words.length ? hits.length + ' of ' + all.length + ' tasks match' : all.length + ' tasks';
  if (!r || r.slot == null) { box.append(el('p', 'plan-note', r ? 'A hand-typed character has no tasks. Its line is on the AFK planner tab.' : 'No characters yet.')); return; }
  if (!all.length) { box.append(el('p', 'plan-note', (r.name || 'This character') + ' has no tasks yet.')); return; }
  if (!hits.length) { box.append(el('p', 'plan-note', 'No tasks match “' + query + '”.')); return; }
  groups.forEach(([title, list]) => {
    if (!list.length) return;
    const sheet = el('div', 'sheet');
    list.forEach(t => sheet.append(buildTaskEditor(plannerOwner(t.id))));
    if (title !== 'Archive') { box.append(el('h2', 'label plan-group', title + ' · ' + list.length), sheet); return; }
    const fold = el('details', 'pv-archive'), head = el('summary', 'label plan-group', 'Archive · ' + list.length);
    fold.open = playerArchiveOpen || words.length > 0; // a search shows what it found
    fold.addEventListener('toggle', () => { if (!words.length) playerArchiveOpen = fold.open; });
    fold.append(head, sheet);
    box.append(fold);
  });
}
function paintPlayer(now) {
  if ($('viewPlayer').hidden) return;
  renderPlayer();
  document.querySelectorAll('#playerTasks .task-editor').forEach(node => {
    if (node.closest('details:not([open])')) return;
    const owner = plannerOwner(node.dataset.task);
    if (owner.task) paintTaskEditor(node, owner, now);
  });
}
// From the panel: the Player tab on someone on it (or whoever's picked), scrolled to it and lit up a moment.
let playerFlashTimer = null;
function openTaskInPlayer(t) {
  const on = t.type === 'portal' ? portalCrew(t.mapIdx).on.map(x => x.r) : [], who = on.find(x => x.slot === selectedSlot()) || on.find(x => x.slot === activePlayerSlot()) || on[0];
  if (who && who.slot !== selectedSlot()) selectPlayer(who.slot);
  showTab('player');
  const search = $('playerSearch');
  if (search && search.value) { search.value = ''; renderPlayer(); }
  const node = document.querySelector('#playerTasks .task-editor[data-task="' + t.id + '"]');
  if (!node) return;
  const fold = node.closest('details');
  if (fold) fold.open = true;
  document.querySelectorAll('#playerTasks .task-editor.jump').forEach(n => n.classList.remove('jump'));
  node.classList.add('jump');
  clearTimeout(playerFlashTimer);
  playerFlashTimer = setTimeout(() => node.classList.remove('jump'), 4000);
  node.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
function showPlayer() { playerShown = null; playerWhoShown = null; renderPlayer(); paintPlayer(Date.now()); }
wireTaskEditors($('playerTasks'), node => plannerOwner(node.dataset.task));
wireKpkHow($('playerTasks'), target => { const node = target.closest('.task-editor'); return node ? kpkOwnerOf(plannerOwner(node.dataset.task)) : null; });
