/* World > Statues: every statue's level, grade and flair, and a goal level for any of them */
let statuesPainted = '', statuesFetching = false, statuesWho = null; // statuesWho: whose statue talents the effects count, null for nobody's
try { const w = localStorage.getItem(LOCAL_KEY + '-statue-who'); statuesWho = w == null || w === '' ? null : +w; } catch { /* storage blocked */ }
const statueGoal = i => tasks.find(t => t.type === 'item' && t.statueTo && t.statueIndex === i) || null;
function showStatues() {
  statuesPainted = '';
  paintStatues();
  // The Printer tab's extra fields: statue levels before the app reads them with every sync, and the artifact, merits and the rest the effects need.
  if (!(printerExtraNow && printerExtraNow.data) && LOCAL_APP && !statuesFetching && typeof printerExtraNow !== 'undefined') {
    statuesFetching = true;
    api('/api/printer-extra').then(x => { if (x && x.data) printerExtraNow = x; }).catch(() => {}).finally(() => { statuesFetching = false; statuesPainted = ''; paintStatues(); });
  }
}
function paintStatues() {
  const box = $('viewStatues');
  if (!box || box.hidden || box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const list = statueList(), goals = tasks.filter(t => t.statueTo).map(t => [t.statueIndex, t.statueTo, t.id]);
  const key = JSON.stringify([statuesWho, statuesFlairFirst, saveForFinder && saveForFinder.fetchedAt, printerExtraNow && printerExtraNow.fetchedAt, goals, !!list, Math.floor(Date.now() / 60000)]);
  if (key === statuesPainted) return;
  statuesPainted = key;
  box.textContent = '';
  const head = el('div', 'st-head');
  head.append(el('h2', 'st-title', 'Statues'));
  box.append(head);
  if (!list) { box.append(el('p', 'small', statuesFetching ? 'Reading statue levels…' : 'No statue levels yet. They come with the next sync.')); return; }
  const counts = [0, 0, 0, 0];
  list.forEach(s => counts[s.grade]++);
  const dep = statueDepositBonus();
  head.append(el('p', 'small st-sum', fmtNum(list.reduce((n, s) => n + s.level, 0)) + ' levels in all · ' + STATUE_GRADES.map((g, i) => counts[i] ? counts[i] + ' ' + g.toLowerCase() : '').filter(Boolean).join(' · ') + ' · each statue put in counts ×' + fmtNum(dep.multi) + ' before flair'));
  head.lastChild.title = '+' + fmtNum(10 * dep.onyx) + '% from ' + dep.onyx + ' onyx statues, +' + fmtNum(25 * dep.zenith) + '% from ' + dep.zenith + ' zenith, ' + (dep.vial == null ? 'Skinny 0 Cal vial unknown' : fmtNum(Math.min(dep.vial, 100)) + '% chance to count double from Skinny 0 Cal (' + fmtNum(dep.vial) + '%, at most 100%)');
  // what the potential rows assume about marbles
  const tick = el('label', 'st-tick'), box2 = document.createElement('input');
  box2.type = 'checkbox'; box2.id = 'statueFlairFirst'; box2.checked = statuesFlairFirst;
  box2.addEventListener('change', () => { statuesFlairFirst = box2.checked; try { localStorage.setItem(LOCAL_KEY + '-statue-flair', box2.checked ? '1' : '0'); } catch { /* storage blocked */ } statuesPainted = ''; box2.blur(); paintStatues(); });
  tick.append(box2, 'Buy flair before depositing');
  tick.title = 'When the marbles you hold cover a flair level, count it as bought before the statues go in, so each one counts for more. Each statue is priced as if it had all the marbles of its kind.';
  // whose own statue talents the effects count: they raise some statues for that character only
  const who = el('label', 'st-tick'), pick = document.createElement('select');
  pick.id = 'statueWho';
  const opt = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; pick.append(o); };
  opt('', 'No character’s talents');
  (statueCtx() ? statueCtx().slots : []).forEach(slot => opt(String(slot), pjSlotName(slot)));
  pick.value = statuesWho == null ? '' : String(statuesWho);
  if (pick.value !== (statuesWho == null ? '' : String(statuesWho))) statuesWho = null;
  pick.addEventListener('change', () => { statuesWho = pick.value === '' ? null : +pick.value; try { localStorage.setItem(LOCAL_KEY + '-statue-who', pick.value); } catch { /* storage blocked */ } statuesPainted = ''; pick.blur(); paintStatues(); });
  who.append('Effects for', pick);
  head.append(who, tick);
  const grid = el('div', 'st-grid');
  grid.append(statueListHead());
  list.forEach(s => { grid.append(statueCard(s)); const pot = statuePotential(s); if (pot) grid.append(statueCard(s, pot)); });
  box.append(grid, el('p', 'small st-foot', 'A level takes round(level^1.17 × 1.35^(level / 10) + 1) statues, each counting 1 + its flair bonus. Some statues are raised by a character’s own talents: pick whose above, or none to leave them out. Flair costs are in the statue’s marble: green when what you hold covers it. A potential row is the statue after putting in all you hold.'));
}
// What putting in every statue held would do, with the flair the marbles buy first if asked. Null when that isn't a level.
// Every statue the account has, wherever it is, and every one waiting in a character's AFK gains: claimed and put in.
function statuePotential(s) {
  const unclaimed = statueUnclaimed(s.index), all = s.held + unclaimed;
  if (!(all > 0)) return null;
  const reach = statuesFlairFirst ? statueFlairReach(s) : { flair: s.flair, spent: 0, expMulti: s.expMulti }, after = statueAfter(s.index, all, reach.expMulti, s);
  return after && after.level > s.level ? { ...after, flair: reach.flair, spent: reach.spent, expMulti: reach.expMulti, all, unclaimed } : null;
}
// What the characters on a monster that drops this statue have waiting to claim, by their AFK rates and time away.
function statueUnclaimed(i) {
  const src = statueDropSource(i);
  if (src.source !== 'monster') return 0;
  return taskShares({ type: 'item', itemName: itemName(statueRaw(i)), slot: null, ...src }).reduce((sum, x) => sum + (x.waiting || 0), 0);
}
// One statue, one row: art, name, level, effect, progress, flair, what's held, goal. The columns line up down the list.
// pot: draws the statue as it would be after putting in what's held, in a row of its own under it.
function statueCard(s, pot) {
  const level = pot ? pot.level : s.level, progress = pot ? pot.progress : s.progress, next = pot ? pot.next : s.next, flairLv = pot ? pot.flair : s.flair;
  const card = el('article', (pot ? 'st-potrow' : 'st-card') + ' st-g' + s.grade), art = document.createElement('img');
  if (!pot) card.dataset.statue = s.index; else card.dataset.potential = s.index;
  art.className = 'st-art'; art.alt = ''; art.src = 'icons/' + s.art + '.png';
  art.addEventListener('error', () => { art.src = 'icons/' + s.raw + '.png'; }, { once: true });
  const who = el('div', 'st-who'), sub = el('div', 'small st-effect');
  if (pot) {
    who.append(el('div', 'st-name st-pot-name', 'Potential'), el('div', 'small st-effect', 'all ' + fmtNum(pot.all) + ' put in' + (pot.unclaimed > 0 ? ', ' + fmtNum(pot.unclaimed) + ' still to claim' : '') + (pot.flair > s.flair ? ', flair ' + pot.flair + ' first' : '')));
  } else {
    sub.append(el('span', 'st-grade', STATUE_GRADES[s.grade]));
    who.append(el('div', 'st-name', s.name.replace(/ Statue$/, '')), sub);
  }
  const lv = el('div', 'st-lv');
  lv.append(el('b', '', fmtNum(level)));
  if (pot) lv.append(el('div', 'small st-gain', '+' + fmtNum(level - s.level)));
  const eff = statueEffect(s.index, level, s.grade, statuesWho), effCell = el('div', 'st-eff');
  effCell.append(el('div', 'st-eff-val', statueEffectText(s.index, eff.value)));
  if (pot) { const now = statueEffect(s.index, s.level, s.grade, statuesWho).value; if (now > 0) effCell.append(el('div', 'small st-gain', '+' + fmtNum((eff.value / now - 1) * 100) + '%')); }
  else if (eff.own > 1) effCell.append(el('div', 'small st-effect', '×' + fmtNum(eff.own) + ' from ' + pjSlotName(statuesWho) + '’s talents'));
  effCell.title = eff.own > 1 ? fmtNum(eff.plain, 6) + ' without their statue talents' : '';
  // the bar: what's in (light), then what the statues held are worth once put in (middle), the numbers inside
  const progCell = el('div', 'st-progcell'), bar = el('div', 'st-bar'), fill = el('span', 'st-fill'), stock = el('span', 'st-stock');
  const reach = !pot && statuesFlairFirst ? statueFlairReach(s) : null, worth = pot ? 0 : s.held * (reach ? reach.expMulti : s.expMulti), have = Math.min(progress / next, 1);
  fill.style.width = (have * 100).toFixed(2) + '%';
  stock.style.left = fill.style.width;
  stock.style.width = (Math.min(worth / next, 1 - have) * 100).toFixed(2) + '%';
  bar.append(fill, stock, el('span', 'st-bar-text', fmtNum(progress) + ' / ' + fmtNum(next)));
  bar.title = fmtNum(progress, 6) + ' of ' + fmtNum(next, 6) + ' to level ' + fmtNum(level + 1) + (worth > 0 ? '\nThe ' + fmtNum(s.held, 6) + ' held are worth ' + fmtNum(worth, 6) + (reach && reach.flair > s.flair ? ', with flair ' + reach.flair + ' bought first' : '') : '');
  progCell.append(bar);
  // the flair, and what its next level costs
  const flair = el('div', 'st-flair'), multi = 1 + statueFlairBonus(flairLv) / 100;
  flair.append(el('span', 'st-key', flairLv + '/' + s.flairMax), el('span', 'small', '×' + fmtNum(multi)));
  if (pot) {
    if (pot.spent > 0) flair.append(el('span', 'st-cost spent', '−' + fmtNum(pot.spent)));
  } else if (s.flairCost != null) {
    const cost = el('span', 'st-cost ' + (s.shards >= s.flairCost ? 'ok' : 'short')), icon = document.createElement('img');
    icon.className = 'st-icon'; icon.alt = ''; icon.src = 'icons/' + s.shardRaw + '.png';
    cost.append(icon, fmtNum(s.flairCost));
    cost.title = itemName(s.shardRaw) + ': ' + fmtNum(s.flairCost, 6) + ' for flair ' + (s.flair + 1) + ', ' + fmtNum(s.shards || 0, 6) + ' held';
    flair.append(cost);
  } else flair.append(el('span', 'st-cost max', 'Max'));
  const heldCell = el('div', 'st-heldcell');
  heldCell.append(el('div', 'st-num', pot ? '0' : s.held > 0 ? fmtNum(s.held) : '–'));
  if (!pot && s.held > 0) { heldCell.append(el('div', 'small st-held', 'worth ' + fmtNum(worth))); heldCell.title = fmtNum(s.held, 6) + ' held, worth ' + fmtNum(worth, 6) + (reach && reach.flair > s.flair ? ' with flair ' + reach.flair + ' bought first' : ''); }
  // statues still to put in for the next level, at what each counts for
  const needCell = el('div', 'st-needcell'), each = pot ? pot.expMulti : reach ? reach.expMulti : s.expMulti, need = Math.max(Math.ceil((next - progress) / each), 0);
  needCell.append(el('div', 'st-num', fmtNum(need)));
  if (!pot && s.held > 0) needCell.append(el('div', 'small ' + (s.held >= need ? 'st-gain' : 'st-held'), s.held >= need ? 'have enough' : fmtNum(need - s.held) + ' short'));
  needCell.title = fmtNum(need, 6) + ' statues for level ' + fmtNum(level + 1) + ', each counting ' + fmtNum(each);
  card.append(art, who, lv, effCell, progCell, flair, heldCell, needCell, pot ? el('div', 'st-goal-wrap') : statueGoalRow(s));
  // a click anywhere but the goal box opens the statue in the item finder, with its tasks
  const name = itemName(s.raw), open = () => openInFinder(name);
  card.classList.add('st-link');
  card.title = 'Open ' + name + ' in the item finder';
  card.addEventListener('click', e => { if (!e.target.closest('form, input, button, select')) open(); });
  if (!pot) {
    const label = card.querySelector('.st-name');
    label.tabIndex = 0; label.setAttribute('role', 'link');
    label.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); open(); } });
  }
  return card;
}
// The list's column heads, on the same columns as the rows.
function statueListHead() {
  const head = el('div', 'st-colhead');
  head.setAttribute('aria-hidden', 'true');
  ['', 'Statue', 'Level', 'Effect', 'To next level', 'Flair · next cost', 'Held', 'Need', 'Goal'].forEach(text => head.append(el('span', 'label', text)));
  return head;
}
function statueGoalRow(s) {
  const t = statueGoal(s.index), row = el('form', 'st-goal'), input = document.createElement('input'), go = el('button', '', t ? 'Change' : 'Set goal');
  input.type = 'text'; input.inputMode = 'numeric'; input.placeholder = 'Goal level'; input.setAttribute('aria-label', s.name + ' goal level');
  if (t) input.value = String(t.statueTo);
  go.type = 'submit';
  row.append(input, go);
  row.addEventListener('submit', e => {
    e.preventDefault();
    const lv = Math.floor(parseNum(input.value));
    if (!(lv > s.level)) { toast('Pick a level above ' + fmtNum(s.level)); return; }
    setStatueGoal(s.index, lv);
    input.blur();
    queueSave(); render(); statuesPainted = ''; paintStatues();
  });
  const wrap = el('div', 'st-goal-wrap');
  wrap.append(row);
  if (t) {
    const k = taskCalc(t), need = statuesToLevel(s.index, t.statueTo, s);
    const line = k.done ? 'enough held: put them in' : fmtNum(Math.max(need - (k.have || 0), 0)) + ' more to collect' + (k.hours != null ? ' · ' + fmtWait(k.hours) : k.needs ? ' · ' + k.needs : '');
    wrap.append(el('div', 'small st-eta' + (k.done ? ' ok' : ''), 'Goal Lv ' + fmtNum(t.statueTo) + ': ' + line));
  }
  return wrap;
}
