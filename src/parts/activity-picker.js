/* ---------- plan an activity: world, then skill, then target. It only makes ordinary tasks, which turn active when the save says so ---------- */
// In the game's order. level: which entry of the character's skill levels it shows. The spore is combat, with the class level.
const PICK_SKILLS = [
  { activity: 'FIGHTING', label: 'Combat', icon: 'Grasslands1', level: 0 },
  { activity: 'MINING', label: 'Mining', icon: 'UiSkillMining', level: 1 },
  { activity: 'FISHING', label: 'Fishing', icon: 'UiSkillFishing', level: 4 },
  { activity: 'COOKING', label: 'Cooking', icon: 'UiSkillCooking', level: 10 },
  { activity: 'CHOPPIN', label: 'Chopping', icon: 'UiSkillChopping', level: 3 },
  { activity: 'CATCHING', label: 'Catching', icon: 'UiSkillCatching', level: 6 },
  { activity: 'LABORATORY', label: 'Lab', icon: 'ClassIcons53', level: 12 },
  { activity: 'SPELUNKING', label: 'Spelunking', icon: 'UiSkillSpelunking', level: 19 },
];
const pickState = { world: null, activity: null };
let pickShown = null, pickPlanned = null; // pickPlanned: the activity just planned, so Add a goal can offer what it drops until the save catches up
// [{ id, name, mapIdx? }] for one world and activity.
const PICK_HOLE = 216; // The Hole: its fighters are in its caverns
function pickTargets(world, activity) {
  if (activity === 'FIGHTING') return (WORLD_FIGHTS[world] || []).map(([id, mapIdx]) => ({ id, mapIdx, name: monsterName(id), place: GAME.maps[mapIdx] || '' }));
  return Object.entries(WORLD_GATHER[activity] || {}).filter(([, worlds]) => worlds.includes(world)).map(([id]) => ({ id, name: GAME.monsters[id][0] }));
}
// What's left to kill on that map, from the save. Null when the map has no portal or it isn't known.
function pickPortalLeft(slot, mapIdx) {
  if (!(GAME.portals[mapIdx] > 0)) return null;
  const d = saveForFinder && saveForFinder.data, kla = d && kpkParse(d['KLA_' + slot]), left = parseFloat(kla && kla[mapIdx] && kla[mapIdx][0]);
  return Number.isFinite(left) ? Math.ceil(Math.max(left, 0)) : null;
}
// The same tasks the game's save would make for this activity, inactive until it does: what they hold is only there so the display is right. Same keys, so a later sync lands on them.
function planActivity(slot, activity, target, now = Date.now()) {
  const mon = GAME.monsters[target.id], key = mon[1] + '|' + mon[0], r = rows.find(x => x.slot === slot), kind = kindForActivity(activity);
  const base = { slot, activityKey: key, match: { kind: 'activity', key }, monster: target.id, afkId: target.id, mapIdx: target.mapIdx ?? null, auto: false };
  const made = [], undo = [], put = fields => {
    const had = tasks.find(t => t.key === taskKey(fields));
    undo.push(had ? { id: had.id, before: { ...had } } : null);
    const t = upsertTask(fields, now);
    if (fields.auto === false) delete t.hidden; // asked for again
    if (!had) undo[undo.length - 1] = { id: t.id, before: null };
    made.push(t);
    return t;
  };
  if (kind === 'kills') {
    const left = pickPortalLeft(slot, target.mapIdx), f = saveFacts();
    if (left > 0) feedClear(put({ ...base, type: 'clear' }), { portalLeft: left });
    if (CARD_TIERS[target.id] && f.cards) {
      const rank = cardRank(target.id, f.cards[target.id] || 0, f.unlocks);
      if (rank && rank.nextAt != null) put({ ...base, auto: undefined, type: 'card', source: 'monster', chance: cardDropOf(target.id)?.[1] ?? null }); // collecting a card is only a goal if you star it, and planning leaves one you did star as it is
    }
  } else if (/^\d+$/.test(kind)) {
    // One task per skill. The save may still show another target of this skill, so it's only moved back once the save says something new.
    const t = put({ ...base, type: 'skill', skill: +kind });
    if (r && r.activityKey && r.activityKey !== key && kindOf(r) === kind) t.plannedOver = r.activityKey;
    else delete t.plannedOver;
    const card = skillCardOf(target.id), f = saveFacts();
    if (card && f.cards) {
      const rank = cardRank(card, f.cards[card] || 0, f.unlocks);
      if (rank && rank.nextAt != null) put({ ...base, type: 'card', monster: card, source: 'skill', chance: null });
    }
  } else put({ ...base, type: 'exp' });
  const item = gatheredItem({ activity, monster: target.id });
  if (item && !tasks.some(t => t.key === taskKey({ type: 'item', itemName: item }))) put({ ...base, type: 'item', itemName: item, source: 'flat', chance: null, amount: '' });
  return { made, undo };
}
// The row Add a goal works from: the planned activity if there is one for this player, otherwise what they're doing.
function plannedRow(r) {
  if (!r || !pickPlanned || pickPlanned.slot !== r.slot) return r;
  if (r.activityKey === pickPlanned.row.activityKey) { pickPlanned = null; return r; }
  return { ...r, ...pickPlanned.row };
}
function pickButton(cls, icon, label, on, pressed) {
  const b = el('button', 'pick-btn ' + cls);
  b.type = 'button';
  b.setAttribute('aria-pressed', String(!!pressed));
  b.setAttribute('aria-label', label);
  const img = el('img');
  img.src = 'icons/' + icon + '.png';
  img.alt = '';
  img.addEventListener('error', () => img.remove());
  b.append(img);
  b.addEventListener('click', on);
  return b;
}
function renderActivityPicker(r) {
  const box = $('plannerPick');
  if (!box) return;
  if (!r || r.slot == null) { box.textContent = ''; pickShown = null; return; }
  const c = chars[r.slot], levels = c ? PICK_SKILLS.map(s => c.lv[s.level]) : [], shown = JSON.stringify([r.slot, pickState, levels, !!saveForFinder]);
  if (shown === pickShown) return;
  pickShown = shown;
  box.textContent = '';
  box.className = 'plan-pick';
  box.append(el('h2', 'label plan-group', 'Plan an activity'));
  const sheet = el('div', 'sheet pick-sheet'), worlds = el('div', 'pick-worlds');
  worlds.setAttribute('role', 'group');
  worlds.setAttribute('aria-label', 'World');
  [1, 2, 3, 4, 5, 6, 7].forEach(w => worlds.append(pickButton('pick-world', 'UiWorld' + w, 'World ' + w, () => { pickState.world = pickState.world === w ? null : w; pickState.activity = null; renderActivityPicker(selectedRow()); }, pickState.world === w)));
  sheet.append(worlds);
  if (pickState.world) {
    const grid = el('div', 'pick-skills');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', 'Activity');
    PICK_SKILLS.forEach((s, i) => {
      const count = pickTargets(pickState.world, s.activity).length, b = pickButton('pick-skill', s.icon, s.label, () => { pickState.activity = s.activity; renderActivityPicker(selectedRow()); }, pickState.activity === s.activity);
      b.disabled = !count;
      b.title = count ? s.label : s.label + ' isn\'t in World ' + pickState.world;
      b.append(el('span', 'pick-lv', levels[i] != null ? 'LV ' + levels[i] : ''));
      grid.append(b);
    });
    sheet.append(grid);
  }
  if (pickState.world && pickState.activity) {
    // The Hole's cavern fighters get a group of their own, under the world's maps
    const all = pickTargets(pickState.world, pickState.activity), hole = all.filter(t => t.mapIdx === PICK_HOLE);
    [[all.filter(t => t.mapIdx !== PICK_HOLE), 'Target', ''], [hole, 'The Hole', 'The Hole']].forEach(([targets, aria, title]) => {
      if (!targets.length) return;
      const list = el('div', 'pick-targets' + (title ? ' pick-hole' : ''));
      list.setAttribute('role', 'group');
      list.setAttribute('aria-label', aria);
      targets.forEach(target => {
        const b = pickButton('pick-target', 'task_' + target.id, target.name + (target.place ? ', ' + target.place : ''), () => pickChoose(r.slot, target));
        const words = el('span', 'pick-words');
        words.append(el('span', 'pick-name', target.name));
        if (target.place && !title) words.append(el('span', 'small pick-place', target.place));
        b.append(words);
        list.append(b);
      });
      if (title) sheet.append(el('h3', 'label pick-group', title));
      sheet.append(list);
    });
  }
  box.append(sheet);
}
function pickChoose(slot, target) {
  const activity = pickState.activity, r = rows.find(x => x.slot === slot), { made, undo } = planActivity(slot, activity, target), mon = GAME.monsters[target.id];
  pickPlanned = { slot, name: target.name, row: { monster: target.id, activity, kind: kindForActivity(activity), activityKey: mon[1] + '|' + mon[0], mapIdx: target.mapIdx ?? (r ? r.mapIdx : null) } };
  plannerAddShown = null;
  pickState.world = pickState.activity = null;
  syncTasks();
  queueSave();
  render();
  if (!made.length) { return toast(target.name + ': the map is cleared and the card is maxed. Add a goal from its drops'); }
  flashTask(made[0].id);
  toast('Planned ' + target.name + ' for ' + ((r && r.name) || 'this character') + '. It joins up when the save catches up', () => {
    pickPlanned = null;
    plannerAddShown = null;
    undo.forEach(u => {
      const t = u && tasks.find(x => x.id === u.id);
      if (!t) return;
      if (!u.before) return deleteTask(t.id);
      Object.keys(t).forEach(k => { if (!(k in u.before)) delete t[k]; });
      Object.assign(t, u.before);
    });
    render();
    queueSave();
  });
}
