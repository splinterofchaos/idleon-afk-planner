/* ---------- tasks: what each character is tracked doing, saved with the sheet ---------- */
let rates = {}, tasks = [], plannerPick = null, lootNow = null, factsFor = null, facts = null;
const blankText = v => v == null || String(v).trim() === '';
const rowOfTask = t => t.type && t.slot == null ? null : rows.find(r => r.slot === t.slot) || null; // a task with no slot has no row. Hand-typed rows' stats come through here too, with no type
const monsterName = id => { const m = GAME.monsters[id]; return m ? m[0] : String(id ?? '').replace(/_/g, ' '); };
const monsterIdOf = (name, activity) => Object.keys(GAME.monsters).find(id => GAME.monsters[id][0] === name && (!activity || GAME.monsters[id][1] === activity)) || '';
const worldOf = mapIdx => Math.floor(mapIdx / 50);
const STAT_FIELDS = ['kph', 'xph', 'mk', 'dr', 'kpkTotal', 'iph']; // AFK stats: what the game's AFK info and stats screens show, and the typed kills per kill
const ROYAL_GUARDIAN = 16, ROYAL_CASTLE = 43;
// Activities whose AFK gains are a flat rate of what they're aimed at: the target is itself the item. A fishing spot isn't here, since it gives several kinds of fish.
const GATHER = { MINING: 'Ore', CHOPPIN: 'Logs', CATCHING: 'Bugs', SPELUNKING: 'Chapters' };
const gatheredItem = r => r && GATHER[r.activity] && ITEMS[r.monster] ? ITEMS[r.monster] : null;
const gatherWord = t => GATHER[String(t.activityKey || '').split('|')[0]] || 'Amount';
const fmtStars = rank => (rank - 1) + '\u2605'; // a card's rank starts at 1 and the game's stars at 0
const rawCache = new Map();
function rawNamesOf(name) { // every item with that display name
  if (!rawCache.has(name)) rawCache.set(name, Object.keys(ITEMS).filter(k => ITEMS[k] === name));
  return rawCache.get(name);
}
// What the latest save says about holdings and cards. Parsing it is slow and drawing runs each second, so it's kept per save.
function saveFacts() {
  if (factsFor !== saveForFinder || !facts) {
    factsFor = saveForFinder;
    const d = saveForFinder && saveForFinder.data;
    let cards = null;
    try { cards = d && (typeof d.Cards0 === 'string' ? JSON.parse(d.Cards0) : d.Cards0); } catch { /* an unreadable card list counts as unknown */ }
    const unlocks = cardUnlocks(saveForFinder);
    facts = { held: readHoldings(saveForFinder), cards: cards || null, unlocks, at: (saveForFinder && saveForFinder.savedAt) || importedAt || null, stash: readStash(d), forge: readForge(d, cards, unlocks), printer: readPrinter(d) };
  }
  return facts;
}
function taskKey(t) {
  if (t.type === 'item' && t.statueTo) return 'statue|' + t.statueIndex; // a statue level: one goal per statue
  if (t.type === 'item') return 'item|' + t.itemName; // the account's, whoever asked
  if (t.type === 'card') return 'card|' + t.monster; // so is a card
  if (t.type === 'forge') return 'forge|' + t.raw;
  if (t.type === 'portal') return 'portal|' + t.mapIdx;
  if (t.type === 'outpost') return 'outpost|' + t.mapIdx;
  if (t.type === 'craft') return 'craft|' + t.raw + '|' + t.projectId;
  const head = t.slot + '|' + t.type;
  return t.type === 'clear' || t.type === 'exp' ? head + '|' + t.activityKey
    : t.type === 'skill' ? head + '|' + t.skill
    : head;
}
const freshTaskId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
// One task per key: a second one overwrites the first, keeping its id. undefined fields are left alone, so pass '' to blank one.
function upsertTask(given, now = Date.now()) {
  const fields = ACCOUNT_TASK_TYPES.has(given.type) ? { ...given, slot: null } : given;
  const key = fields.key || taskKey(fields), t = tasks.find(x => x.key === key);
  if (!t) {
    const made = { auto: false, starred: false, createdAt: now, editedAt: now, lastActiveAt: null, ...fields, id: fields.id || freshTaskId(), key };
    tasks.push(made);
    return made;
  }
  Object.keys(fields).forEach(k => { if (fields[k] !== undefined && k !== 'id' && k !== 'createdAt') t[k] = fields[k]; });
  if (fields.starred) delete t.hidden; // asked for again
  t.key = key;
  if (fields.editedAt === undefined) t.editedAt = now;
  return t;
}
function deleteTask(id) {
  const at = tasks.findIndex(t => t.id === id);
  return at < 0 ? null : { task: tasks.splice(at, 1)[0], at };
}
function restoreTask(removed) {
  if (removed && !tasks.some(t => t.key === removed.task.key)) tasks.splice(Math.min(removed.at, tasks.length), 0, removed.task);
}
function toggleStar(t) { t.starred = !t.starred; if (t.starred) delete t.hidden; t.editedAt = Date.now(); return t.starred; }

/* being done now */
function taskIsActive(t, r = rowOfTask(t)) {
  if (t.type === 'forge') return forgeTaskRunning(t);
  if (t.type === 'portal') return portalCrew(t.mapIdx).on.length > 0;
  if (t.type === 'outpost') return outpostCalc(t).active;
  if (t.type === 'afkcap') return true; // only kept while it applies
  if (isCollection(t)) { const team = teamOf(t), mine = t.slot != null ? rowOfTask(t) : null; return team ? team.some(x => x !== mine || onSource(t)) : rows.some(x => x.slot != null && rowMatches(t, x)); } // on while anyone is: a player it's seen as counts only when they're on it
  if (!r || r.slot == null || r.slot !== t.slot) return false;
  return rowMatches(t, r);
}
function rowMatches(t, r) {
  const m = t.match || {}, fighting = kindOf(r) === 'kills';
  if (m.kind === 'activity') return m.key != null && r.activityKey === m.key;
  if (m.kind === 'world') return fighting && worldOf(r.mapIdx) === m.world;
  if (m.kind === 'map') return r.mapIdx === m.mapIdx;
  if (m.kind === 'always') return r.classIndex === ROYAL_GUARDIAN;
  if (m.kind === 'played') return r.slot === t.slot && r.slot === activePlayerSlot();
  if (m.kind === 'fighting') return fighting;
  return false;
}
const neverCounted = t => t.type === 'clear' && t.auto && !t.starred && t.clearedSeen && !(t.startValue > 0); // nothing was left to do on a map cleared before it was ever counted
const taskSection = t => neverCounted(t) || t.hidden ? 'archive' : taskIsActive(t) ? 'active' : t.starred ? 'goal' : 'archive';
function taskTitle(t) {
  if (t.title) return t.title;
  if (t.type === 'forge' || t.type === 'craft') return (t.type === 'forge' ? 'Forge ' : 'Craft ') + (blankText(t.amount) ? '' : t.amount + ' ') + itemName(t.raw);
  const target = String(t.activityKey || '').split('|')[1];
  if (t.type === 'clear') return 'Clear ' + (GAME.maps[t.mapIdx] || target || 'map');
  if (t.type === 'portal') return (GAME.maps[t.mapIdx] || 'Map') + ' lock';
  if (t.type === 'outpost') return 'Capture ' + (GAME.maps[t.mapIdx] || 'map') + ' outpost';
  if (t.type === 'afkcap') return 'Unending Energy';
  if (t.type === 'card') return monsterName(t.monster) + ' Card';
  if (t.type === 'item' && t.statueTo) return t.itemName + ' to level ' + fmtNum(t.statueTo);
  if (t.type === 'item') return (blankText(t.amount) ? '' : 'Collect ' + (parseNum(t.amount) > 0 ? fmtNum(parseNum(t.amount), 6) : t.amount) + ' ') + t.itemName;
  if (t.type === 'skill') return EXP_SKILLS[t.skill] || 'Skill';
  if (t.type === 'class') return 'Class level';
  const activity = String(t.activityKey || '').split('|')[0];
  return ACTIVITY[activity] || target || 'EXP';
}
// The icon's file name, without folder or .png. May not exist: drop the image on its error event, as taskIcon does.
function taskIconName(t) {
  const activity = String(t.activityKey || '').split('|')[0], r = rowOfTask(t);
  if (t.type === 'forge' || t.type === 'craft') return t.raw;
  if (t.type === 'portal') return 'task_' + (t.monster || '');
  if (t.type === 'outpost') return 'ClassIcons16';
  if (t.type === 'afkcap') return 'Prayer2';
  if (t.type === 'card') return 'card_' + t.monster;
  if (t.type === 'item') return rawNamesOf(t.itemName)[0] || t.itemName.replace(/\W/g, '_');
  if (t.type === 'class') return 'ClassIcons' + (r && r.classIndex != null ? r.classIndex : 0);
  if (t.type === 'skill' && SKILL_ICON[t.skill]) return SKILL_ICON[t.skill];
  if (t.type === 'skill' && +t.skill === 19) return 'UiSkillSpelunking'; // the target's own icon is the chapter's scroll, which is the collection task's
  return ACTIVITY_ICON[activity] || 'task_' + (t.monster || t.afkId || '');
}

/* who's being looked at */
function activePlayerSlot() {
  let best = null;
  Object.values(chars).forEach(c => { if (c && c.since && (!best || c.since > best.since)) best = c; });
  return best ? best.slot : null;
}
function selectedRow() {
  const live = activePlayerSlot(), find = v => rows.find(r => typeof v === 'string' ? r.id === v : r.slot === v);
  if (plannerPick) {
    const r = plannerPick.live === live ? find(plannerPick.value) : null;
    if (r) return r;
    plannerPick = null;
  }
  return find(live) || rowsInOrder()[0] || null;
}
// A character's slot, or a hand-typed row's id. Null when there are no rows.
function selectedSlot() { const r = selectedRow(); return r ? r.slot ?? r.id : null; }
function selectPlayer(value) { // a manual pick lasts until the game's active character changes
  const v = typeof value === 'string' && /^\d+$/.test(value) ? +value : value;
  plannerOpened = null;
  plannerPick = { value: v, live: activePlayerSlot() };
  render();
}

/* what can be grinded here */
function grindOptions(r) {
  if (!r || r.slot == null) return [];
  const list = [], seen = new Set(), push = o => { if (!seen.has(o.itemName)) { seen.add(o.itemName); list.push(o); } };
  if (kindOf(r) === 'kills') {
    (DROPS[r.monster] || []).forEach(([itemName, chance]) => push({ group: monsterName(r.monster) + ' drops', itemName, chance, source: 'monster', match: { kind: 'activity', key: r.activityKey }, monster: r.monster }));
    const world = worldOf(r.mapIdx), crystal = 'Crystal' + world;
    if (DROPS[crystal]) DROPS[crystal].forEach(([itemName, chance]) => push({ group: monsterName(crystal) + ' drops', itemName, chance, source: 'crystal', match: { kind: 'world', world }, monster: crystal }));
  }
  if (gatheredItem(r)) push({ group: monsterName(r.monster), itemName: gatheredItem(r), chance: null, source: 'flat', match: { kind: 'activity', key: r.activityKey }, monster: r.monster });
  const skillCard = kindOf(r) !== 'kills' && skillCardOf(r.monster);
  if (skillCard) push({ group: monsterName(r.monster), itemName: monsterName(skillCard) + ' Card', chance: null, source: 'skill', match: { kind: 'activity', key: r.activityKey }, monster: skillCard });
  if (r.classIndex === ROYAL_GUARDIAN) {
    if (r.mapIdx === ROYAL_CASTLE) push({ group: 'Royal Guardian', itemName: ITEMS.RGenh, chance: null, source: 'direct', match: { kind: 'map', mapIdx: ROYAL_CASTLE } });
    push({ group: 'Royal Guardian', itemName: ITEMS.Orblet, chance: null, source: 'direct', match: { kind: 'always' } });
  }
  return list;
}
// The fields for upsertTask when a player picks a grindOptions entry. A monster's own card becomes a card task.
function taskFromOption(r, o) {
  const onTarget = ['monster', 'flat', 'skill'].includes(o.source), isCard = o.source === 'skill' || (CARD_TIERS[o.monster] && o.itemName === cardDropOf(o.monster)?.[0]), shared = { slot: isCard ? r.slot : null, match: o.match, chance: o.chance, source: o.source, monster: o.monster || '', afkId: onTarget ? r.monster : '', activityKey: onTarget ? r.activityKey : null };
  if (isCard) return { ...shared, type: 'card' };
  return { ...shared, type: 'item', itemName: o.itemName, amount: '' };
}
// The card a skilling target drops, from the game's drop tables. Some drop another target's card at a tiny chance (Litterbug gives Fractalfly's); a chance of 0 never drops, and nor does Equinox Willow's listed Dandelioli card, as seen in the game. Fishing pools have no card in the tables.
const SKILL_CARDS = {"Copper":"Copper","Iron":"Iron","Gold":"Gold","Plat":"Plat","Dementia":"Dementia","Void":"Void","Lustre":"Lustre","Starfire":"Starfire","Dreadlo":"Dreadlo","Godshard":"Godshard","Prehistrium":"Prehistrium","OakTree":"OakTree","BirchTree":"BirchTree","JungleTree":"JungleTree","ForestTree":"ForestTree","PalmTree":"PalmTree","ToiletTree":"ToiletTree","StumpTree":"StumpTree","SaharanFoal":"SaharanFoal","Tree7":"Tree7","AlienTree":"AlienTree","Tree8":"Tree8","Tree9":"Tree9","Tree10":"Tree10","Tree12":"Tree12","Tree13":"Tree13","Tree14":"Tree14","Bug1":"Bug1","Bug2":"Bug2","Bug3":"Bug3","Bug4":"Bug4","Bug5":"Bug5","Bug6":"Bug6","Bug7":"Bug7","Bug8":"Bug8","Bug9":"Bug9","Bug10":"Bug10","Bug11":"Bug10","Bug12":"Bug12","Bug13":"Bug13","Bug15":"Bug14","Spelunking0":"SpelunkingCard0","Spelunking1":"SpelunkingCard1","Spelunking2":"SpelunkingCard2","Spelunking3":"SpelunkingCard3","Spelunking4":"SpelunkingCard4","Spelunking5":"SpelunkingCard5","Spelunking6":"SpelunkingCard6"};
const skillCardOf = target => SKILL_CARDS[target] || null;
function cardDropOf(monster) {
  const list = DROPS[monster] || [];
  return list.find(d => d[0] === monsterName(monster) + ' Card') || list.find(d => / Card$/.test(d[0])) || null;
}

/* numbers */
// AFK stats belong to a player's activity, so all of its tasks share them. Crystals per hour belongs to the world; a crystal or a direct item's drop rate to what the player's doing.
function statHome(t, f) {
  if (t.slot == null) return null; // AFK stats belong to a player
  if (t.source === 'crystal' && f === 'kph') return t.slot + '|world:' + (t.match && t.match.world);
  const r = rowOfTask(t), key = t.source === 'crystal' || t.source === 'direct' || !t.activityKey ? r && r.activityKey : t.activityKey;
  // A level task for a skill this activity doesn't train, like Alchemy while fighting: its EXP isn't the activity's.
  if (f === 'xph' && t.type === 'skill' && key && kindForActivity(String(key).split('|')[0]) !== String(t.skill)) return t.slot + '|kind:' + t.skill;
  return key ? t.slot + '|' + key : null;
}
// Drop rate starts from the character's last one on an activity without its own. Multikill belongs to the map, so it doesn't carry: a blank one is the map's average (statGuess).
function statGet(t, f) {
  const home = statHome(t, f), own = home && rates[home] && rates[home][f], r = rowOfTask(t);
  if (!blankText(own)) return own;
  if (t.skill != null && f === 'xph') { const old = rates[t.slot + '|kind:' + t.skill]; if (old && !blankText(old.xph)) return old.xph; }
  return f === 'dr' && r ? r.dr ?? '' : '';
}
function statSet(t, f, value) {
  const home = statHome(t, f), r = rowOfTask(t);
  if (home) {
    const box = rates[home] = rates[home] || {};
    if (blankText(value)) delete box[f]; else box[f] = value;
    if (f === 'mk' && box.kpk) { delete box.kpk.mk; if (!Object.keys(box.kpk).length) delete box.kpk; } // the Multikill % box is the newer number
    if (!Object.keys(box).length) delete rates[home];
  }
  if ((f === 'dr' || f === 'mk') && r) r[f] = value;
}
const rowStatTask = r => ({ slot: r.slot, activityKey: r.activityKey, skill: isSkill(r) ? +r.kind : null });
const rowStat = (r, f) => statGet(rowStatTask(r), f);
const setRowStat = (r, f, value) => statSet(rowStatTask(r), f, value);
// What a cleared kills left goes back to: the game's count, on a clear being done now.
function gameLeft(t) {
  const c = chars[t.slot];
  return t.type === 'clear' && c && c.portalLeft != null && taskIsActive(t) ? c.portalLeft : null;
}
// A draft that's there and blank is a cleared field, which isn't the same as one not drafted.
// When a box is blank: drop rate is the team's average, multikill the average typed on that map by whoever else has been there.
// A 0 counts as blank. Only the sums use these. The boxes show them as their hint, and any other typed number wins.
let statGuessKept = { at: 0, dr: null, mk: new Map() };
function statGuess(t, f) {
  const now = Date.now();
  if (now - statGuessKept.at > 500) statGuessKept = { at: now, dr: undefined, mk: new Map() }; // worked out at most twice a second
  const avg = list => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
  if (f === 'dr') {
    if (statGuessKept.dr === undefined) statGuessKept.dr = avg(rows.filter(r => r.slot != null).map(r => parseNum(statGet(rowStatTask(r), 'dr'))).filter(n => n > 0));
    return statGuessKept.dr;
  }
  if (f !== 'mk') return null;
  const home = statHome(t, 'mk'), key = home && home.slice(home.indexOf('|') + 1);
  if (!key || !/^FIGHTING\|/.test(key)) return null;
  if (!statGuessKept.mk.has(key)) statGuessKept.mk.set(key, avg(Object.entries(rates).filter(([k, box]) => k.slice(k.indexOf('|') + 1) === key && box && parseNum(box.mk) > 0).map(([, box]) => parseNum(box.mk))));
  return statGuessKept.mk.get(key);
}
function taskField(t, f, ov) {
  const drafted = ov && f in ov, own = drafted ? ov[f] : STAT_FIELDS.includes(f) ? statGet(t, f) : t[f];
  const zero = !drafted && (f === 'dr' || f === 'mk') && !blankText(own) && !(parseNum(own) > 0); // a 0 is one never filled in: the player is likely near the average
  if (!blankText(own) && !zero) return own;
  if (!drafted && (f === 'dr' || f === 'mk')) { const g = statGuess(t, f); if (g > 0) return String(g); }
  if (drafted && f === 'left') { const game = gameLeft(t); return game == null ? '' : fmtNum(game); }
  return '';
}
// Per hour. needs is the prompt when there's no rate. rateSource: 'typed' or 'estimate'. Loot rates' measurements never feed this.
// A task is worked on actively or AFK, not one kind or the other. While its character is being played it gains what Loot rates sees; otherwise the AFK figures apply. A draft asks "what if", so it uses those too.
const CRYSTAL_ACTIVE_ONLY = 'Crystals only drop while playing';
let calcAfkOnly = false; // set while taskCalc works out AFK figures only
function taskRate(t, ov, afkOnly) {
  afkOnly = afkOnly || calcAfkOnly;
  if (t.type === 'forge') return forgeRate(t);
  if (t.type === 'portal' || t.type === 'afkcap' || t.type === 'outpost') return { rate: 0, rateSource: null, needs: '' };
  if (t.type === 'craft') return { rate: 0, rateSource: null, needs: '' };
  const num = f => { const n = parseNum(taskField(t, f, ov)); return n > 0 ? n : 0; }, none = needs => ({ rate: 0, rateSource: null, needs });
  const typed = (rate, needs) => rate ? { rate, rateSource: 'typed', needs: '' } : none(needs);
  const loot = afkOnly || (ov && ['kph', 'dr', 'mk', 'iph', 'perHour', 'kpkTotal'].some(f => f in ov)) ? 0 : lootRate(t), byLoot = { rate: loot, rateSource: 'loot rate', needs: '' };
  if (t.type === 'clear') return loot ? byLoot : typed(num('kph'), 'Enter kills / hour');
  const expLoot = afkOnly || (ov && 'xph' in ov) ? 0 : expLootRate(t);
  if (expLoot) return { rate: expLoot, rateSource: 'loot rate', needs: '' };
  if (t.type === 'skill' || t.type === 'exp') return typed(num('xph'), 'Enter EXP / hour');
  if (t.type === 'class') {
    if (num('xph')) return typed(num('xph'), '');
    const worked = classExpWorked(t, ov);
    return worked ? { rate: worked, rateSource: 'estimate', needs: '' } : none('Enter class EXP / hour');
  }
  if (t.type === 'card' && t.source === 'skill') { // measured from the saves; while being played, Loot rates sees it live
    if (loot) return byLoot;
    const m = skillCardRate(t);
    return m.rate > 0 ? { rate: m.rate, rateSource: 'measured', needs: '' } : none(m.hours >= SKILL_CARD_MIN_HOURS ? 'No cards gained yet while on it' : SKILL_CARD_WAIT);
  }
  const chance = taskChance(t);
  let got;
  if (t.source === 'flat') {
    const ask = 'Enter ' + gatherWord(t).toLowerCase() + ' / hour', on = (teamOf(t) || []).length;
    // Planned, with no one on it yet: what's been typed for the activity says what it would give.
    const home = !on && Object.keys(rates).find(k => k.endsWith('|' + t.activityKey) && parseNum(rates[k].iph) > 0);
    got = t.slot != null ? typed(num('iph'), ask) : home ? typed(parseNum(rates[home].iph), ask) : none(on ? ask : 'No one is on ' + monsterName(t.monster));
  }
  else if (t.source === 'direct' || !chance) got = typed(num('perHour'), 'Enter amount / hour');
  else if (t.source === 'crystal' && (afkOnly || t.slot !== activePlayerSlot()) && !(ov && 'kph' in ov)) got = none(CRYSTAL_ACTIVE_ONLY);
  else if (t.slot == null) got = none((teamOf(t) || []).length ? 'Enter AFK stats for who\'s on it' : 'No one is on ' + monsterName(t.monster));
  else {
    const crystal = t.source === 'crystal', live = !crystal && !afkOnly && !(ov && 'kph' in ov) ? lootKills(t) : 0, kph = live || num('kph'), dr = parseNum(taskField(t, 'dr', ov)); // while being played, the kills Loot rates sees
    if (!kph) got = none(crystal ? 'Enter crystals / hour' : 'Enter kills / hour');
    else if (!(dr > 0)) got = none('Enter drop rate');
    else got = { rate: (crystal ? kph : realKills(kph, t.slot, ov, t) * commonRolls(t, ov)) * chance * dr * cardDropMulti(t) * bundleOf(t), rateSource: 'estimate', needs: '' };
  }
  const own = loot || got.rate, team = teamOf(t);
  if (!team) return loot ? byLoot : got;
  // Drops are shared, so what counts is everyone on it who has drop information.
  const shared = itemIsShared(t);
  let rate = own;
  const counted = own ? [rowOfTask(t)].filter(Boolean) : [];
  team.filter(r => r.slot !== t.slot).forEach(r => {
    const m = { ...t, slot: r.slot, activityKey: r.activityKey, afkId: r.monster, mapIdx: r.mapIdx }, theirs = shared ? itemContribution(t, r, !afkOnly) : (!afkOnly && lootRate(m)) || memberRate(m, chance, !afkOnly); // whoever's being played counts at what they're really getting
    if (!theirs) return;
    rate += theirs;
    counted.push(r);
  });
  if (own && counted.length > 1 && !onSource(t)) { rate -= own; counted.shift(); } // someone's really on it, so it isn't an 'if it started now'
  const out = { team: { counted: counted.length, total: team.length, others: counted.filter(r => r.slot !== t.slot).length, rows: [...counted, ...team.filter(r => !counted.includes(r))] } };
  const played = !afkOnly && team.some(r => (shared ? itemLoot(t, r) : lootRate({ ...t, slot: r.slot, activityKey: r.activityKey, afkId: r.monster, mapIdx: r.mapIdx })) > 0);
  const paid = shared && team.some(r => itemAfkPaid(t, r) != null);
  return rate ? { rate, rateSource: loot || played ? (counted.length > 1 ? 'loot rate + estimate' : 'loot rate') : paid ? 'measured AFK' : t.source === 'flat' ? 'typed' : 'estimate', needs: '', ...out } : { ...got, ...out };
}
// Everyone working on a shared task: their rate, and what's waiting for them to claim. The played character has nothing waiting. Time away isn't capped at the game's AFK limit.
function taskShares(t, now = Date.now()) {
  if (t.type === 'outpost') return outpostShares(t, now);
  const team = teamOf(t); // only who's on a source of it: a collection task has no player of its own
  if (!team || !team.length) return [];
  const live = activePlayerSlot(), chance = taskChance(t);
  return team.map(r => {
    const playing = r.slot === live, rate = itemIsShared(t) ? itemContribution(t, r, playing) : (playing && lootRate({ ...t, slot: r.slot, activityKey: r.activityKey, afkId: r.monster, mapIdx: r.mapIdx })) || memberRate({ ...t, slot: r.slot, activityKey: r.activityKey, afkId: r.monster, mapIdx: r.mapIdx }, chance, playing);
    const away = !playing && r.afkSince ? Math.max(now - r.afkSince, 0) / 36e5 : 0;
    return { slot: r.slot, name: r.name || 'Unnamed', rate, away, waiting: rate * away, playing };
  }).filter(s => s.rate > 0);
}
// A player keeps their colour (slot % 6), unless someone with a lower slot on the same task already has it: then the next free one, so no two on a task match. The militia are grey.
const SHARE_COLORS = 6;
function shareColor(slot, slots) {
  if (slot === 'militia') return 'var(--militia)';
  const used = new Set(), on = [...new Set([...(slots || []), slot].filter(s => s !== 'militia' && s != null))].sort((a, b) => a - b);
  for (const s of on) {
    let c = s % SHARE_COLORS;
    while (used.has(c) && used.size < SHARE_COLORS) c = (c + 1) % SHARE_COLORS;
    used.add(c);
    if (s === slot) return 'var(--share' + c + ')';
  }
  return 'var(--share' + (slot % SHARE_COLORS) + ')';
}
const taskPlaying = t => {
  const live = activePlayerSlot();
  if (t.type === 'portal') return portalCrew(t.mapIdx).on.some(x => x.r.slot === live);
  if (t.type === 'outpost') return outpostPlayedOn(t.mapIdx);
  if (t.type === 'afkcap') return false;
  if (!isCollection(t) || t.slot != null) return t.slot != null && t.slot === live && taskIsActive(t);
  const team = teamOf(t), r = rows.find(x => x.slot === live);
  return team ? team.some(x => x.slot === live) : !!r && rowMatches(t, r);
};
// The kills an hour Loot rates sees while this task's character is being played on its target. 0 otherwise.
function lootKills(t) {
  if (!taskPlaying(t)) return 0;
  const a = lootNow && lootNow.active, seen = a && a.slot === t.slot && (!t.afkId || a.afkId === t.afkId) && (a.items || []).find(it => it.item === 'kills');
  return seen && seen.ms > 0 ? seen.gained / seen.ms * 36e5 : 0;
}
// The EXP Loot rates sees while this level task's character is being played. 0 otherwise.
function expLootRate(t) {
  if ((t.type !== 'class' && t.type !== 'skill') || !taskPlaying(t)) return 0;
  const a = lootNow && lootNow.active, skill = t.type === 'class' ? 0 : +t.skill, seen = a && a.slot === t.slot && (a.exp || []).find(x => x.skill === skill);
  return seen && seen.ms > 0 ? seen.gained / seen.ms * 36e5 : 0;
}
// Class EXP an hour from AFK kills an hour, at what a claim paid this character per kill on this target. Active play pays far more per counted kill (18x on one real character), so it's no guide to AFK: 0 until there's been a claim.
function classExpWorked(t, ov) {
  const kills = parseNum(taskField(t, 'kph', ov)), r = rowOfTask(t), seen = lootNow && lootNow.expPerKill && lootNow.expPerKill[t.slot + '|' + (t.afkId || (r && r.monster))];
  return kills > 0 && seen && seen.from === 'claim' ? kills * seen.perKill : 0;
}
// What Loot rates sees while this task's character is being played on it. 0 otherwise.
function lootRate(t) {
  if (!['clear', 'card', 'item'].includes(t.type) || !taskPlaying(t)) return 0;
  const a = lootNow && lootNow.active;
  if (t.slot == null && (t.type !== 'item' || teamOf(t))) return 0; // a shared item adds each player's own
  if (!a || a.slot !== (t.slot ?? activePlayerSlot()) || (t.afkId && a.afkId !== t.afkId)) return 0;
  const wanted = t.type === 'clear' ? ['kills'] : t.type === 'card' ? ['card:' + t.monster] : rawNamesOf(t.itemName);
  const seen = (a.items || []).filter(it => wanted.includes(it.item) && it.ms > 0).sort((x, y) => y.ms - x.ms)[0];
  return seen ? seen.gained / seen.ms * 36e5 : 0;
}
// The AFK figures, to compare with a loot rate.
function afkPreview(t, now = Date.now()) {
  const c = taskCalc(t, now, null, true);
  if (!(c.rate > 0)) return { needs: String(c.needs || '').toLowerCase() };
  return { rate: c.rate, hours: c.hours, done: c.done };
}
// One character's own AFK rate on a shared collection task, from their AFK stats on what they're doing. Null when the task isn't shared.
function afkOwnRate(t, slot) {
  const r = rows.find(x => x.slot === slot);
  if (!r || !isCollection(t) || !teamOf(t)) return null;
  const here = t.type === 'item' ? itemSourcesFor(t.itemName, r)[0] : null, m = { ...t, ...(here || {}), slot, activityKey: r.activityKey, afkId: r.monster, mapIdx: r.mapIdx };
  const chance = m.chance ?? (t.type === 'card' ? cardDropOf(t.monster)?.[1] : null);
  return chance || m.source === 'flat' ? memberRate(m, chance, false) : 0;
}
function afkPreviewText(t, now) {
  const p = afkPreview(t, now);
  return 'AFK preview: ' + (p.rate ? fmtRate(p.rate) + ' per hour' + (p.hours != null ? ', ' + fmtWait(p.hours) : '') : p.needs);
}
// An account card as one player has it: their slot, and their activity if they're on its monster. Their AFK stats are what it reads.
function cardAsPlayer(t, r) {
  if (!t || t.type !== 'card' || t.slot != null || t.source === 'skill' || !r || r.slot == null) return null;
  return { ...t, slot: r.slot, ...(r.monster === t.monster ? { activityKey: r.activityKey, afkId: r.monster, mapIdx: r.mapIdx } : {}) };
}
// Who's farming what a card or Global item task collects, itself included. Null for what isn't shared: bags-only items, and items with only a typed rate.
// Where this player can get an item right now: the monster they're fighting and, only while being played, their world's crystals (claiming AFK gives no crystal drops). Each has its own chance.
// DROPS holds the rarer drops; the project list has others, as [monster, chance per kill, map].
function itemProjectDrop(itemName, monster) {
  for (const raw of rawNamesOf(itemName)) { const row = (PROJECT_DROPS[raw] || []).find(x => x[0] === monster); if (row) return [itemName, row[1]]; }
  return null;
}
function itemSourcesFor(itemName, r) {
  if (r.slot == null) return [];
  if (gatheredItem(r) === itemName) return [{ source: 'flat', chance: null, monster: r.monster, afkId: r.monster, activityKey: r.activityKey, match: { kind: 'activity', key: r.activityKey }, mapIdx: r.mapIdx }];
  if (kindOf(r) !== 'kills') return [];
  const out = [], world = worldOf(r.mapIdx), crystal = 'Crystal' + world, own = (DROPS[r.monster] || []).find(d => d[0] === itemName) || itemProjectDrop(itemName, r.monster), shard = (DROPS[crystal] || []).find(d => d[0] === itemName);
  if (own) out.push({ source: 'monster', chance: own[1], monster: r.monster, afkId: r.monster, activityKey: r.activityKey, match: { kind: 'activity', key: r.activityKey }, mapIdx: r.mapIdx });
  if (shard && r.slot === activePlayerSlot()) out.push({ source: 'crystal', chance: shard[1], monster: crystal, afkId: '', activityKey: null, match: { kind: 'world', world } });
  return out;
}
// What one player adds to a shared item, from everything they're on.
const itemLoot = (t, r) => lootRate({ ...t, slot: r.slot, match: { kind: 'activity', key: r.activityKey }, afkId: r.monster, activityKey: r.activityKey });
// What this character's AFK really paid in this item on what they're on now, per hour: measured from the times they came back to it. Null before any.
function itemAfkPaid(t, r) {
  const pay = lootNow && lootNow.afkPay && lootNow.afkPay[r.slot + '|' + r.monster], it = pay && rawNamesOf(t.itemName).map(raw => pay[raw]).find(Boolean);
  return it && it.ms > 0 ? it.gained / it.ms * 36e5 : null;
}
const itemContribution = (t, r, useLoot) => {
  const loot = useLoot ? itemLoot(t, r) : 0, paid = itemAfkPaid(t, r);
  return loot || (paid != null ? paid : 0) || itemSourcesFor(t.itemName, r).filter(s => useLoot || s.source !== 'crystal').reduce((sum, s) => sum + memberRate({ ...t, ...s, slot: r.slot }, s.chance), 0); // the AFK figures have no crystals in them
};
const itemIsShared = t => t.type === 'item';
// Tasks that are the account's, with no player of their own.
const ACCOUNT_TASK_TYPES = new Set(['item', 'card', 'portal', 'outpost']), isCollection = t => t.type === 'item' || t.type === 'card';
function taskChance(t) { return t.chance ?? (t.type === 'card' ? cardDropOf(t.monster)?.[1] : null); }
const teamLine = team => team.counted + ' of ' + team.total + ' players';
// Asked many times for each card in a paint: during one, kept by task.
let teamMemo = null;
function teamOf(t) {
  if (!teamMemo) return teamNow(t);
  if (!teamMemo.has(t)) teamMemo.set(t, teamNow(t));
  return teamMemo.get(t);
}
function teamNow(t) {
  if (t.type !== 'card' && t.type !== 'item') return null;
  const chance = taskChance(t);
  if (t.source === 'direct' || (!chance && t.source !== 'flat')) return null;
  const crystal = t.source === 'crystal', mine = rowOfTask(t);
  const on = rows.filter(r => r.slot != null && (itemIsShared(t) ? itemSourcesFor(t.itemName, r).length > 0 : t.source === 'flat' ? r.monster === t.monster : kindOf(r) === 'kills' && (crystal ? worldOf(r.mapIdx) === (t.match && t.match.world) : r.monster === t.monster)));
  return mine && !on.includes(mine) ? [mine, ...on] : on;
}
const onSource = t => { const r = rowOfTask(t); if (t.source === 'flat') return !!r && r.monster === t.monster; return !!r && kindOf(r) === 'kills' && (t.source === 'crystal' ? worldOf(r.mapIdx) === (t.match && t.match.world) : r.monster === t.monster); };
// Drops on a monster's own list roll for every kill multikill counts, so they come (1 + multikill %) times per real kill; drops from a table beneath it roll once per real kill.
// Multikill is the game's figure on the AFK Info screen, typed in the Multikill % box. Checked against claims: within 9% for both kinds.
const dropIsCommon = (monster, itemName) => { const list = COMMON_DROPS[monster]; return !!list && rawNamesOf(itemName).some(raw => list.includes(raw)); };
function commonRolls(m, ov) {
  const item = m.type === 'card' ? (cardDropOf(m.monster) || [])[0] : m.itemName;
  if (!m.monster || !item || !dropIsCommon(m.monster, item)) return 1;
  const mk = parseNum(taskField(m, 'mk', ov));
  return mk > 0 ? 1 + mk / 100 : 1;
}
// live: while being played, the kills Loot rates sees stand in for the typed kills / hour.
function memberRate(m, chance, live) {
  if (m.source === 'flat') { const n = parseNum(statGet(m, 'iph')); return n > 0 ? n : 0; }
  const kph = (live && m.source !== 'crystal' && lootKills(m)) || parseNum(statGet(m, 'kph')), dr = parseNum(taskField(m, 'dr'));
  if (!(kph > 0) || !(dr > 0)) return 0;
  return (m.source === 'crystal' ? kph : realKills(kph, m.slot, null, m) * commonRolls(m)) * chance * dr * cardDropMulti(m) * bundleOf(m) * tableOf(m);
}
/* "2x Statue and Gold Food drops": statues and golden food come in bundles. The AFK claim screen counts them singly; the bags get the bundles.
   game: a 2x drop gives round(2 + (Double Aint Enough + Grey Hardhat for statues) / 100), doubled by the bon_k bundle (Idleon Toolbox's getDoubleDropSize).
   Claims gave 14x for statues where that sum says 7, so the rest isn't known: a statue's boost is what claims measured, bags against these sums (the median), and until one is, the bundle size. Golden food uses its bundle size. Both are low estimates without a claim. */
const BUNDLE_KIND = raw => /^EquipmentStatues\d+$/.test(raw) ? 'statue' : /^FoodG\d+$/.test(raw) ? 'gfood' : null;
const bundleKindOf = m => m && m.type === 'item' && m.itemName ? rawNamesOf(m.itemName).map(BUNDLE_KIND).find(Boolean) || null : null;
function bundleSize(kind) {
  const d = saveForFinder && saveForFinder.data;
  if (!d) return 1;
  const sp = kpkParse(d.Spelunk) || [], legend = Math.round(100 * (+((sp[18] || [])[2]) || 0)), hardhat = kind === 'statue' ? +((sp[5] || [])[48]) || 0 : 0, bundles = kpkParse(d.BundlesReceived) || {};
  return Math.round(2 + (legend + hardhat) / 100) * (+bundles.bon_k > 0 ? 2 : 1);
}
// Kept for 2 seconds, and only while the save and the loot data are the ones they came from: worked out before the save loads, a bundle is 1.
const keptFresh = k => Date.now() - k.at <= 2000 && k.save === saveForFinder && k.loot === lootNow;
const keptNew = by => ({ at: Date.now(), save: saveForFinder, loot: lootNow, by });
let bundleKept = { at: 0, by: {} }, bundleOff = false;
// { multi, from: 'measured' | 'bundle', claims }: what each statue or golden food in the sums counts for.
function bundleMulti(kind) {
  if (!kind || bundleOff) return { multi: 1, from: null, claims: 0 };
  if (!keptFresh(bundleKept)) bundleKept = keptNew({});
  if (bundleKept.by[kind]) return bundleKept.by[kind];
  const ratios = [];
  if (kind !== 'statue') return bundleKept.by[kind] = { multi: bundleSize(kind), from: 'bundle', claims: 0 }; // golden food's 2x chance has other sources, and one claim on guessed stats isn't enough: its bundle size, a low estimate
  bundleOff = true; // the sums the claims are held up against don't have the boost in them
  try {
    Object.entries((lootNow && lootNow.afkPay) || {}).forEach(([key, items]) => {
      const [slotText, afkId] = key.split('|'), slot = +slotText, r = rows.find(x => x.slot === slot), mon = GAME.monsters[afkId];
      if (!r || !mon || mon[1] !== 'FIGHTING') return;
      Object.entries(items || {}).forEach(([raw, it]) => {
        if (BUNDLE_KIND(raw) !== kind || !(it.ms > 0) || !(it.gained > 0)) return;
        const name = itemName(raw), d = (DROPS[afkId] || []).find(x => x[0] === name);
        // only drops on the monster's own list, fought with the stats typed for it: a rare table's statues are far off their sums (458x to 3,287x on a real account), which swamped the median
        if (!d || !dropIsCommon(afkId, name) || r.monster !== afkId) return;
        const m = { type: 'item', itemName: name, source: 'monster', chance: d[1], monster: afkId, afkId, slot, activityKey: mon[1] + '|' + mon[0], mapIdx: r.monster === afkId ? r.mapIdx : null };
        const sum = memberRate(m, d[1], false);
        if (sum > 0) ratios.push(it.gained / it.ms * 36e5 / sum);
      });
    });
  } finally { bundleOff = false; }
  ratios.sort((a, b) => a - b);
  const mid = ratios.length ? ratios[Math.floor((ratios.length - 1) / 2)] : null;
  return bundleKept.by[kind] = mid > 1 ? { multi: mid, from: 'measured', claims: ratios.length } : { multi: bundleSize(kind), from: 'bundle', claims: 0 };
}
const bundleOf = m => bundleMulti(bundleKindOf(m)).multi;
/* Drops from a table beneath a monster's own list come far above chance x drop rate on a real account: 392x to 687x on w7b11's, golden food and statues alike, rising with drop rate. Why isn't known.
   So it's measured, claims against sums (with any bundle in them): the item's own, else the lowest of its table's items; tables with the same items share it, whatever their chances. A low estimate; 1 before any claim. */
const tableItemsOf = monster => { const l = DROP_TABLES[monster]; return l && l.length ? l : null; };
const tableKeyOf = monster => { const l = tableItemsOf(monster); return l ? l.map(x => x[1].join(',')).join('|') : null; };
const inTable = (monster, itemName) => { const l = tableItemsOf(monster); return !!l && !dropIsCommon(monster, itemName) && rawNamesOf(itemName).some(raw => l.some(x => x[1].includes(raw))); };
const TABLE_MIN_GAINED = 20; // fewer than this in a stretch is too few to measure from
let tableKept = { at: 0, by: null }, tableOff = false;
// { key: { raw: [ratio per character], ... } } from the AFK claims.
function tableRatios() {
  if (tableKept.by && keptFresh(tableKept)) return tableKept.by;
  const by = {}, bundles = { statue: bundleMulti('statue').multi, gfood: bundleMulti('gfood').multi }; // the bundles first, then sums without them, so a bundle part-way through being measured can't drop out
  tableOff = bundleOff = true; // the sums the claims are held up against don't have this in them
  try {
    Object.entries((lootNow && lootNow.afkPay) || {}).forEach(([key, items]) => {
      const [slotText, afkId] = key.split('|'), slot = +slotText, r = rows.find(x => x.slot === slot), mon = GAME.monsters[afkId], tk = tableKeyOf(afkId);
      if (!r || !mon || mon[1] !== 'FIGHTING' || r.monster !== afkId || !tk) return;
      Object.entries(items || {}).forEach(([raw, it]) => {
        if (!(it.ms > 0) || !(it.gained >= TABLE_MIN_GAINED)) return;
        const name = itemName(raw), d = (DROPS[afkId] || []).find(x => x[0] === name);
        if (!d || !inTable(afkId, name)) return;
        const sum = memberRate({ type: 'item', itemName: name, source: 'monster', chance: d[1], monster: afkId, afkId, slot, activityKey: mon[1] + '|' + mon[0], mapIdx: r.mapIdx }, d[1], false);
        if (sum > 0) ((by[tk] = by[tk] || {})[raw] = by[tk][raw] || []).push(it.gained / it.ms * 36e5 / sum / (bundles[BUNDLE_KIND(raw)] || 1));
      });
    });
  } finally { tableOff = bundleOff = false; }
  return (tableKept = keptNew(by)).by;
}
// { multi, from: 'item' | 'table' | null }: what a table drop's sum is short by.
function tableMulti(monster, itemName) {
  if (tableOff || bundleOff || !inTable(monster, itemName)) return { multi: 1, from: null }; // bundleOff: the statue bundle's being measured, against sums with nothing measured in them
  const got = tableRatios()[tableKeyOf(monster)];
  if (!got) return { multi: 1, from: null };
  const own = rawNamesOf(itemName).map(raw => got[raw]).find(l => l && l.length), all = own || [].concat(...Object.values(got)), low = Math.min(...all);
  return low > 1 ? { multi: low, from: own ? 'item' : 'table' } : { multi: 1, from: null };
}
const tableOf = m => m && m.source === 'monster' && m.monster && m.type !== 'card' && m.itemName ? tableMulti(m.monster, m.itemName).multi : 1;

// A row-shaped object, with this task's effective numbers, for calc, calcSkill, classCalc and paintRow. Overrides are drafts (Simulate); they change nothing.
function taskView(t, ov) {
  const r = rowOfTask(t) || { slot: t.slot }, active = taskIsActive(t, r), c = chars[t.slot], since = r.afkSince || null;
  const v = {
    ...r, taskId: t.id, task: taskTitle(t), rare: '', goal: '', left: '', leftAuto: false, leftExact: null,
    kph: taskField(t, 'kph', ov), kpc: taskField(t, 'kpc', ov), xph: taskField(t, 'xph', ov), perHour: taskField(t, 'perHour', ov),
    dr: taskField(t, 'dr', ov), mk: taskField(t, 'mk', ov), monster: t.monster || r.monster,
    afkSince: active ? since : null,
    startedAt: !active ? null : t.typedAt && (!since || t.typedAt > since) ? t.typedAt : since,
  };
  if (t.type === 'clear' || t.type === 'exp') {
    const cleared = ov && 'left' in ov && blankText(ov.left), game = cleared ? gameLeft(t) : null, drafted = ov && 'left' in ov && !cleared && ov.left !== t.left;
    v.kind = t.type === 'clear' ? 'kills' : 'exp';
    v.left = taskField(t, 'left', ov);
    v.leftAuto = cleared ? game != null : !drafted && !!t.leftAuto;
    v.leftExact = cleared ? game : t.leftExact ?? null;
    if (drafted) v.startedAt = null; // a drafted number means "this is my number right now"
    else if (cleared) v.startedAt = active ? since : null; // the game's count runs from the AFK start, as a cleared box does
    if (t.type === 'clear' && !calcAfkOnly && !(ov && 'kph' in ov)) { const loot = lootRate(t); if (loot) v.kph = String(loot); }
    if (t.type === 'clear') { const cl = tasks.find(x => x.slot === t.slot && x.type === 'class'); v.classGoal = cl ? cl.goal ?? '' : ''; v.cxph = cl ? statGet(cl, 'xph') : ''; }
  } else if (t.type === 'skill') {
    const s = +t.skill, level = c && c.lv ? (c.lv[s] >= 1 ? c.lv[s] : 1) : parseNum(r.lvl);
    v.kind = String(s);
    v.lvl = level == null ? '' : String(level);
    v.xp = c && c.exp && c.exp[s] ? String(c.exp[s]) : '';
    v.levelCost = c && c.req && c.req[s] > 0 ? c.req[s] : null;
    v.scale = v.levelCost && level > 1 ? expReq(s, level) / v.levelCost : 1;
    const goal = taskField(t, 'goal', ov);
    v.goal = blankText(goal) && level >= 1 ? String(level + 1) : goal; // blank is the next level, so it rolls forward
    v.goalBlank = blankText(goal);
    const rate = taskRate(t, ov).rate;
    if (rate) v.xph = String(rate);
  } else if (t.type === 'class') {
    v.kind = '0';
    v.lvl = v.classLvl = r.classLvl;
    v.xp = v.classXp = c && c.exp && c.exp[0] ? String(c.exp[0]) : r.classXp;
    v.scale = v.classScale = r.classScale;
    const classGoal = taskField(t, 'goal', ov), classLevel = parseNum(r.classLvl);
    v.goal = v.classGoal = blankText(classGoal) && classLevel >= 1 ? String(Math.floor(classLevel) + 1) : classGoal; // blank is the next level, so it rolls forward
    v.goalBlank = blankText(classGoal);
    const rate = taskRate(t, ov).rate;
    if (rate) v.xph = String(rate);
    v.cxph = v.xph;
    v.startedAt = active ? since : null;
  } else {
    v.kind = 'kills';
    v.rare = t.itemName || '';
  }
  // While a character is played, the save already holds what they've gained up to when it was made, and their AFK start can be well before that. Running on from the start would count that stretch twice.
  const saved = saveFacts().at;
  if (v.startedAt && saved > v.startedAt && (t.type === 'class' || t.type === 'skill' || (t.type === 'clear' && v.leftAuto)) && taskPlaying(t)) v.startedAt = saved;
  return v;
}
function taskHave(t, ov) { // items only: how many count towards this task, from the last save
  const held = saveFacts().held;
  if (!held) return null;
  const raws = rawNamesOf(t.itemName);
  return ownedCount(raws, { equipped: true });
}
// What the AFK characters on a shared item or card had gathered by the save without claiming it: the save doesn't hold it yet, and from the save on it's in the rate. 0 without a save or a team.
function teamPending(t) {
  const at = saveFacts().at;
  if (!at || !teamOf(t)) return 0;
  return taskShares(t, at).reduce((n, s) => s.playing ? n : n + s.rate * (afkCapApplies(rows.find(r => r.slot === s.slot)) ? Math.min(s.away, AFK_CAP_HOURS) : s.away), 0); // Unending Energy stops gains 10 hours in
}
// Items and cards count from the save, so a running one finishes (what's left) / rate after the save. One not running is timed from now.
function towards(have, target, rate, active, now) {
  if (have >= target) return { done: true, hours: 0, left: 0 };
  if (!(rate > 0)) return { done: false, hours: null, left: target - have };
  const at = active ? saveFacts().at || now : now, hours = Math.max(at + (target - have) / rate * 36e5 - now, 0) / 36e5;
  return { done: hours === 0, hours, left: Math.min(rate * hours, target - have) };
}
// The game's count for a map falls to zero once its portal is earned, and stays there whoever is on the map now. Null when the save can't say.
function portalCleared(t) {
  const d = saveForFinder && saveForFinder.data;
  if (!d || t.mapIdx == null || !(GAME.portals[t.mapIdx] > 0)) return null;
  let kla;
  try { kla = typeof d['KLA_' + t.slot] === 'string' ? JSON.parse(d['KLA_' + t.slot]) : d['KLA_' + t.slot]; } catch { return null; }
  const left = parseFloat(kla && kla[t.mapIdx] && kla[t.mapIdx][0]);
  return Number.isFinite(left) ? left <= 0 : null;
}
// afkOnly: what it comes to AFK, leaving out what Loot rates sees while it's played.
function taskCalc(t, now = Date.now(), ov, afkOnly) {
  if (afkOnly && !calcAfkOnly) { calcAfkOnly = true; try { return taskCalc(t, now, ov); } finally { calcAfkOnly = false; } }
  const out = taskCalcOf(t, now, ov), bonus = t.type === 'card' && t.source !== 'skill' && t.slot != null ? cardDropParts(t.slot) : null;
  if (bonus && !out.note) out.note = 'Card drop bonus ×' + fmtRate(bonus.total) + ': a low estimate, since how these bonuses stack isn’t fully known';
  return out;
}
function taskCalcOf(t, now = Date.now(), ov) {
  if (t.type === 'forge') return forgeCalc(t, now, ov);
  if (t.type === 'craft') return craftCalc(t, now, ov);
  if (t.type === 'portal') return portalCalc(t, now);
  if (t.type === 'outpost') return outpostCalc(t, now);
  if (t.type === 'afkcap') return afkCapCalc(t, now);
  const active = taskIsActive(t), { rate, rateSource, needs: rateNeeds, team } = taskRate(t, ov), counting = active || (team && team.others > 0);
  const out = { active, playing: taskPlaying(t), done: false, hours: null, etaMs: null, pct: 0, left: null, have: null, target: null, rate, rateSource, team: team || null, needs: '', line: '', clears: null, level: null };
  const finish = () => {
    if (out.hours != null) out.etaMs = now + out.hours * 36e5;
    if (out.done) { out.needs = ''; out.hours = 0; out.etaMs = now; }
    return out;
  };
  if (t.type === 'clear' && t.cleared && !(ov && 'left' in ov && !blankText(ov.left))) {
    Object.assign(out, { done: true, left: 0, pct: 1, line: 'Ready!' });
    return finish();
  }
  if (t.type === 'clear' || t.type === 'exp') {
    const v = taskView(t, ov), c = calc(v, now), kills = t.type === 'clear', start = v.leftAuto && v.leftExact > 0 ? v.leftExact : parseNum(v.left);
    Object.assign(out, { done: c.done, hours: c.hours, left: c.left, clears: c.clears });
    out.needs = !c.hasGoal ? (kills ? 'Enter kills left' : 'Enter EXP left') : rate ? '' : rateNeeds;
    const most = Math.max(t.startValue || 0, start > 0 ? start : 0);
    out.pct = !c.hasGoal ? 0 : most > 0 ? Math.min(Math.max(1 - c.left / most, 0), 1) : 1;
    out.line = c.done ? 'Ready!' : out.needs || fmtNum(c.left) + (kills ? ' kills left' : ' EXP left');
    return finish();
  }
  if (t.type === 'skill' || t.type === 'class') {
    const v = taskView(t, ov), name = t.type === 'class' ? 'Enter class goal' : 'Waiting for game data';
    let c = calcSkill(v, now), rolled = false;
    // With no goal of its own, the aim is always the next level: it levels again rather than finishing.
    for (let i = 0; v.goalBlank && c.done && i < 500; i++) { v.goal = String(c.target + 1); c = calcSkill(v, now); rolled = true; }
    Object.assign(out, { done: !!c.done, hours: c.hours, left: c.left, pct: c.pct || 0, have: c.level, target: c.target ?? null, level: c.level });
    if (rolled && c.hasGoal && !c.done) { const cost = expReq(+v.kind, c.level) / (v.scale > 0 ? v.scale : 1); out.pct = cost > 0 ? Math.min(Math.max(c.pool / cost, 0), 1) : 0; }
    out.needs = c.tooFar ? '' : !c.hasGoal ? name : rate ? '' : rateNeeds;
    out.line = c.done ? 'Reached Lv ' + c.target : c.tooFar ? 'Too far' : out.needs || 'Lv ' + c.level + ' → ' + c.target;
    return finish();
  }
  if (t.type === 'card') {
    const { cards, unlocks } = saveFacts();
    if (!cards) { out.needs = out.line = 'Waiting for game data'; return out; }
    const count = cards[t.monster] || 0, rank = cardRank(t.monster, count, unlocks);
    out.have = count;
    if (!rank) { out.line = monsterName(t.monster) + ' has no card ranks'; return out; }
    const goalText = ov && 'goal' in ov ? ov.goal : t.goal, stars = parseNum(goalText); // the goal is in stars
    const wanted = !blankText(goalText) && stars >= 0 ? Math.floor(stars) + 1 : rank.rank + 1;
    if (wanted <= rank.rank) { Object.assign(out, { done: true, pct: 1, target: cardNeed(t.monster, wanted), left: 0, line: fmtStars(rank.rank) + ', goal reached' }); return finish(); }
    if (rank.rank >= rank.top) { Object.assign(out, { pct: 1, line: fmtStars(rank.rank) + ', the highest you can reach' }); return out; }
    const aim = Math.min(wanted, rank.top), target = cardNeed(t.monster, aim), from = cardNeed(t.monster, rank.rank), pending = counting ? teamPending(t) : 0, go = towards(count + pending, target, rate, counting, now);
    Object.assign(out, go, { target, rankNow: rank.rank, rankGoal: aim, pending });
    out.pct = Math.min(Math.max((target - go.left - from) / (target - from), 0), 1);
    out.needs = go.hours == null ? rateNeeds : '';
    out.line = fmtStars(rank.rank) + ' → ' + fmtStars(aim) + ' · ' + fmtNum(count) + ' of ' + fmtNum(target);
    return finish();
  }
  // item
  const have = taskHave(t, ov), target = taskTarget(t, ov);
  Object.assign(out, { have, target });
  if (have == null) { out.needs = out.line = 'Waiting for game data'; return out; }
  if (target == null) {
    out.pending = counting ? teamPending(t) : 0;
    out.needs = rateNeeds || 'Ready to claim: ' + fmtNum(Math.floor(out.pending)); // no amount to aim for, so what's waiting is the news
    out.line = (rate > 0 ? fmtRate(rate) + ' per hour · ' : '') + fmtNum(have);
    return out;
  }
  const pending = counting ? teamPending(t) : 0, go = towards(have + pending, target, rate, counting, now); // what's waiting to be claimed counts towards it
  Object.assign(out, go, { pending });
  out.pct = Math.min(Math.max((target - go.left) / target, have / target), 1);
  out.needs = go.hours == null ? rateNeeds : '';
  out.line = fmtNum(have) + ' of ' + fmtNum(target, 6);
  return finish();
}

/* multi-character portals */
// Every synced character on one multi-character map: kills left there, whether they've cleared it, and whether they're on it now. on: there and not cleared yet, so they count towards it.
function portalCrew(mapIdx, now = Date.now()) {
  const need = MAP_CREW[mapIdx] || 0, all = [];
  rowsInOrder().forEach(r => {
    const c = r.slot != null && chars[r.slot];
    if (!c) return;
    const left = c.crew ? c.crew[mapIdx] ?? null : null, cleared = left != null && left <= 0, there = kindOf(r) === 'kills' && r.mapIdx === mapIdx;
    const clear = there && !cleared ? tasks.find(x => x.type === 'clear' && x.slot === r.slot && x.activityKey === r.activityKey) : null, k = clear ? taskCalc(clear, now) : null;
    const v = clear ? taskView(clear) : null, since = v && (v.afkSince || v.startedAt), waiting = k && !k.done && k.rate > 0 && since && r.slot !== activePlayerSlot() ? k.rate * Math.max(now - since, 0) / 36e5 : 0; // AFK kills not claimed yet
    all.push({ r, left, cleared, there, waiting, hours: k ? (k.done ? 0 : k.hours) : null, needs: k ? k.needs : '' });
  });
  return { need, all, known: all.some(x => x.left != null), cleared: all.filter(x => x.cleared).length, on: all.filter(x => x.there && !x.cleared) };
}
// Open once enough characters have cleared it. The ETA is when the last clear it needs from who's there finishes.
function portalCalc(t, now) {
  const crew = portalCrew(t.mapIdx, now), live = activePlayerSlot();
  const out = { active: crew.on.length > 0, playing: crew.on.some(x => x.r.slot === live), done: false, hours: null, etaMs: null, pct: 0, left: null, have: crew.cleared, target: crew.need, rate: 0, rateSource: null, team: null, needs: '', line: '', clears: null, level: null, crew };
  if (!crew.known) { out.needs = out.line = 'Waiting for game data'; return out; }
  out.left = Math.max(crew.need - crew.cleared, 0);
  out.pct = crew.need ? Math.min(crew.cleared / crew.need, 1) : 1;
  out.line = crew.cleared + ' of ' + crew.need + ' players cleared';
  if (!out.left) { Object.assign(out, { done: true, hours: 0, etaMs: now, line: 'Portal open' }); return out; }
  const times = crew.on.map(x => x.hours).filter(h => h != null && Number.isFinite(h)).sort((a, b) => a - b), short = out.left - crew.on.length;
  if (short > 0) out.needs = 'Needs ' + short + ' more player' + (short > 1 ? 's' : '') + ' on this map';
  else if (times.length < out.left) out.needs = 'Enter kills / hour for who’s on it';
  else { out.hours = times[out.left - 1]; out.etaMs = now + out.hours * 36e5; }
  return out;
}

/* Royal Guardian outposts */
// The save's entry for a map: the count cleared while it's being cleared, a long list once the outpost is built.
function outpostBuilt(mapIdx) {
  const d = saveForFinder && saveForFinder.data;
  let list;
  try { list = d && (typeof d.RoyalMaps === 'string' ? JSON.parse(d.RoyalMaps) : d.RoyalMaps); } catch { return false; }
  const e = Array.isArray(list) ? list[mapIdx] : null;
  return Array.isArray(e) && e.length > 1;
}
const outpostPlayedOn = mapIdx => { const r = rows.find(x => x.slot === activePlayerSlot()); return !!(r && kindOf(r) === 'kills' && r.mapIdx === mapIdx); };
// Clearing units (job 4) the save has sent at a map: for each world's units, RoyalG[6 + 2w] are their jobs and RoyalG[7 + 2w] their maps.
function outpostUnits(mapIdx) {
  const d = saveForFinder && saveForFinder.data;
  let g;
  try { g = d && (typeof d.RoyalG === 'string' ? JSON.parse(d.RoyalG) : d.RoyalG); } catch { return 0; }
  let n = 0;
  for (let w = 0; Array.isArray(g) && w < 8; w++) {
    const jobs = g[6 + 2 * w], maps = g[7 + 2 * w];
    if (Array.isArray(jobs) && Array.isArray(maps)) jobs.forEach((job, k) => { if (Math.round(+job) === 4 && Math.round(+maps[k]) === mapIdx) n++; });
  }
  return n;
}
// What Loot rates measured, kept on the tasks: one clearing unit's rate (the same everywhere), and on the played map what the player clears there between collects, and the rate while played.
function outpostRemember(view) {
  const a = view && view.active;
  if (!a) return;
  const unit = a.soldierUnit && a.soldierUnit.ms > 0 ? a.soldierUnit.gained / a.soldierUnit.ms * 36e5 : null;
  if (unit != null) tasks.forEach(x => { if (x.type === 'outpost') x.rateUnit = unit; });
  const t = tasks.find(x => x.type === 'outpost' && x.mapIdx === a.mapIdx), it = a.items && a.items.find(x => x.item === 'outpost');
  if (!t) return;
  if (it && it.ms > 0 && it.gained > 0) t.ratePlayed = it.gained / it.ms * 36e5;
  if (a.clearOwn && a.clearOwn.ms > 0) t.rateOwn = a.clearOwn.gained / a.clearOwn.ms * 36e5;
}
// The soldiers' rate on a map: one unit's, times the units sent there now, so moving them shows at once.
function outpostSoldierRate(t) {
  const units = outpostUnits(t.mapIdx), unit = +t.rateUnit || +(tasks.find(x => x.type === 'outpost' && +x.rateUnit > 0) || {}).rateUnit || 0;
  return { units, rate: units * unit, measured: unit > 0 };
}
// The kills the militia have banked, landing at the next collect: RoyalG[3][0] seconds since the last, at their rate now.
function outpostBanked(rate) {
  const d = saveForFinder && saveForFinder.data;
  let g;
  try { g = d && (typeof d.RoyalG === 'string' ? JSON.parse(d.RoyalG) : d.RoyalG); } catch { return 0; }
  const s = parseFloat(Array.isArray(g) && Array.isArray(g[3]) ? g[3][0] : NaN);
  return s > 0 ? rate * s / 3600 : 0;
}
// An outpost's shares, like a team task's: whoever's played on it, then the militia (not players, so grey). What the militia have banked is their waiting.
function outpostShares(t, now) {
  const k = outpostCalc(t, now), sold = outpostSoldierRate(t), out = [], r = k.playing && rows.find(x => x.slot === activePlayerSlot());
  if (k.done) return out;
  if (r) out.push({ slot: r.slot, name: r.name || 'Unnamed', rate: Math.max(k.rate - sold.rate, 0), away: 0, waiting: 0, playing: true });
  if (sold.units) out.push({ slot: 'militia', militia: true, name: 'Militia', units: sold.units, rate: sold.rate, away: 0, waiting: outpostBanked(sold.rate), playing: false });
  return out.filter(s => s.rate > 0);
}
// The faces on an outpost's card: whoever's played on it, and the militia if any are sent there.
function outpostFaces(k) {
  if (k.done) return [];
  const r = k.playing && rows.find(x => x.slot === activePlayerSlot());
  return [r, k.units > 0 && { militia: true, hat: 'Militia', name: 'Militia ×' + k.units }].filter(Boolean);
}
// Captured once what's cleared reaches what it needs, or the outpost's built.
// While played: the player's own between collects plus the soldiers'; before the player's own is measured, the rate while played or the soldiers' alone, whichever is more. Otherwise the soldiers' alone, so a low estimate.
function outpostCalc(t, now = Date.now()) {
  const have = outpostClearing(saveForFinder, t.mapIdx), total = OUTPOST_KILLS_REQ[t.mapIdx] || +t.total || 0, played = outpostPlayedOn(t.mapIdx); // what the game needs; a typed total only for a map it doesn't list
  const sold = outpostSoldierRate(t);
  const rate = !played ? sold.rate : +t.rateOwn > 0 ? +t.rateOwn + sold.rate : Math.max(+t.ratePlayed || 0, sold.rate);
  const out = { active: played || rate > 0, playing: played, done: false, hours: null, etaMs: null, pct: 0, left: null, have, target: total, rate, rateSource: rate ? 'loot rate' : null, team: null, needs: '', line: '', clears: null, level: null, units: sold.units };
  if (outpostBuilt(t.mapIdx) || (have != null && total > 0 && have >= total)) { Object.assign(out, { done: true, active: false, hours: 0, etaMs: now, pct: 1, left: 0, line: 'Outpost captured' }); return out; }
  if (have == null || !(total > 0)) { out.needs = out.line = 'Waiting for game data'; return out; }
  out.left = total - have;
  out.pct = Math.min(have / total, 1);
  out.line = fmtNum(out.left) + ' kills needed';
  out.line += ' · ' + (sold.units ? sold.units + ' clearing unit' + (sold.units > 1 ? 's' : '') + (sold.rate ? ' ' + fmtRate(sold.rate) + ' / hour' : '') : 'no clearing units');
  if (!rate) out.needs = played ? 'Measuring on Loot rates' : !sold.units ? 'No clearing units sent here' : 'Soldiers measured at the next collect';
  else { out.hours = out.left / rate; out.etaMs = now + out.hours * 36e5; }
  return out;
}

/* Unending Energy's 10-hour AFK cap */
// Wearing it, AFK on something, and not the one being played: their gains stop growing 10 hours after they went AFK.
function afkCapApplies(r) {
  const c = r && r.slot != null && chars[r.slot];
  return !!(c && c.afkCap && c.since && kindOf(r) !== 'idle' && r.slot !== activePlayerSlot());
}
function afkCapCalc(t, now) {
  const c = chars[t.slot], since = c && c.since, out = { active: true, playing: false, done: false, hours: null, etaMs: null, pct: 0, left: null, have: null, target: null, rate: 0, rateSource: null, team: null, needs: '', line: '', clears: null, level: null };
  if (!since) { out.needs = out.line = 'Waiting for game data'; return out; }
  const capAt = since + AFK_CAP_HOURS * 36e5, capped = now >= capAt;
  out.hours = Math.max(capAt - now, 0) / 36e5;
  out.etaMs = capAt;
  out.pct = Math.min(Math.max((now - since) / (AFK_CAP_HOURS * 36e5), 0), 1);
  out.capped = capped;
  if (capped) out.wait = 'Ready!';
  out.line = (capped ? 'Hit the ' : 'Unending Energy stops AFK gains at ') + AFK_CAP_HOURS + ' hours' + (capped ? ' of AFK at ' : ': ') + fmtClock(capAt, now) + (capped ? '. Gains have stopped' : '');
  return out;
}

/* skilling cards, measured */
// One entry per save: the account's count of the card, and whether this task's character was on its target. Only time between two saves with them on it counts, recent hours counting most.
const SKILL_CARD_DAYS = 7, SKILL_CARD_HALF_LIFE_HOURS = 24, SKILL_CARD_MIN_HOURS = 1, SKILL_CARD_WAIT = 'Measuring from your saves: needs an hour on it';
function logSkillCard(t, r) {
  const f = saveFacts(), at = f.at, n = f.cards ? f.cards[t.monster] : undefined;
  if (!at || !f.cards) return;
  const log = t.cardLog || (t.cardLog = []), last = log[log.length - 1];
  if (last && at <= last.t) return;
  log.push({ t: at, n: +n || 0, on: t.slot == null ? taskIsActive(t) : !!r && r.slot === t.slot && taskIsActive(t, r) });
  const cut = at - SKILL_CARD_DAYS * 864e5;
  while (log.length > 2 && log[1].t < cut) log.shift();
  if (log.length > 2000) log.splice(0, log.length - 2000);
}
function skillCardRate(t, now = Date.now()) {
  const log = Array.isArray(t.cardLog) ? t.cardLog : [];
  let w = 0, gain = 0, hours = 0;
  for (let i = 1; i < log.length; i++) {
    const a = log[i - 1], b = log[i], h = (b.t - a.t) / 36e5, got = b.n - a.n;
    if (!a.on || !b.on || !(h > 0) || got < 0) continue; // off the target, or cards used up: left out
    const k = Math.pow(0.5, (now - (a.t + b.t) / 2) / 36e5 / SKILL_CARD_HALF_LIFE_HOURS);
    w += k * h; gain += k * got; hours += h;
  }
  return { rate: hours >= SKILL_CARD_MIN_HOURS && w > 0 ? gain / w : 0, hours };
}

/* typing into a task */
function feedClear(t, c) { // the rule applyChar has for a row's kills left
  const portal = c.portalLeft ?? null;
  const gameCount = portal != null && parseNum(t.left) === portal, newCount = portal != null && t.leftSeen !== portal;
  if (blankText(t.left) || t.leftAuto || gameCount || newCount) {
    if (!blankText(t.left) && !t.leftAuto) t.typedAt = null;
    t.left = portal != null ? fmtNum(portal) : '';
    t.leftAuto = portal != null;
  }
  t.leftExact = portal;
  t.leftSeen = portal;
  if (portal > (t.startValue || 0)) t.startValue = portal;
}
// Target stars can't go past the highest this card can reach: 6 at most, less while the account hasn't unlocked it.
function cardGoalLimit(monster, text) {
  const f = saveFacts(), rank = f.cards ? cardRank(monster, f.cards[monster] || 0, f.unlocks) : null, top = rank ? rank.top - 1 : 6;
  return parseNum(text) > top ? String(top) : text;
}
// Every edit of a task's field goes here. AFK stats go to the activity.
function taskEdit(t, f, value, now = Date.now()) {
  const r = rowOfTask(t);
  t.editedAt = now;
  if (STAT_FIELDS.includes(f)) { statSet(t, f, value); return; }
  if (f === 'goal' && t.type === 'card') { value = cardGoalLimit(t.monster, value); }
  t[f] = value;
  if (f === 'amount') { t.amountAuto = false; delete t.amountExact; }
  if (f === 'left') {
    t.leftAuto = false;
    t.typedAt = blankText(value) ? null : now; // a typed number means "this is my number right now"
    if (t.type === 'clear') t.cleared = blankText(value) ? !!t.clearedSeen : false;
    const n = parseNum(value);
    if (n > (t.startValue || 0)) t.startValue = n;
    const c = chars[t.slot];
    if (blankText(value) && t.type === 'clear' && c && taskIsActive(t, r)) feedClear(t, c); // clearing it goes back to the game's count
  }
}
function taskLockGoal(t) { // "+5" locks in, so later level updates don't move the goal
  if (!/^\+/.test(String(t.goal ?? '').trim()) || (t.type !== 'skill' && t.type !== 'class')) return false;
  const level = goalLevel(taskView(t));
  if (level == null || Number.isNaN(level)) return false;
  t.goal = String(level);
  return true;
}

/* keeping tasks up with the game */
function retarget(t, key) { t.activityKey = key; } // skills and class EXP keep one task, and read the stats of whatever target they're on now
const taskNoStamp = () => JSON.stringify([tasks, projects], (k, v) => k === 'lastActiveAt' ? undefined : v);
// Creates auto tasks, feeds in counts and stamps what's being done. Says whether anything worth saving changed.
function syncTasks(now = Date.now()) {
  const before = taskNoStamp();
  tasks.forEach(t => { // a typed number stands until the game's answer changes
    if (t.type === 'clear' && t.mapIdx == null) { const known = tasks.find(x => x.activityKey === t.activityKey && x.mapIdx != null); if (known) t.mapIdx = known.mapIdx; } // numbers from before tasks don't say which map
    const cleared = t.type === 'clear' ? portalCleared(t) : null;
    if (cleared == null || cleared === t.clearedSeen) return;
    t.clearedSeen = cleared;
    t.cleared = cleared;
  });
  const ensure = fields => tasks.find(x => x.key === taskKey(fields)) || upsertTask({ ...fields, auto: true }, now);
  rows.forEach(r => {
    const c = chars[r.slot];
    if (r.slot == null || !c) return;
    if (r.mapIdx === undefined) r.mapIdx = c.mapIdx;
    const key = r.activityKey, kind = kindOf(r);
    if (!key) return; // the row's first update from a save comes first
    const base = { slot: r.slot, activityKey: key, match: { kind: 'activity', key }, monster: r.monster, afkId: r.monster, mapIdx: r.mapIdx };
    if (kind === 'kills') {
      ensure({ slot: r.slot, type: 'class', match: { kind: 'fighting' }, activityKey: key, afkId: r.monster, monster: r.monster, mapIdx: r.mapIdx }); // every fighter has somewhere for class EXP
      ['dr'].forEach(f => { const home = r.slot + '|' + key; if (!blankText(r[f]) && blankText(rates[home] && rates[home][f])) (rates[home] = rates[home] || {})[f] = r[f]; }); // an activity keeps the drop rate it started with. Multikill is the map's: a new one starts blank, at the map's average
      if (c.portalLeft > 0) ensure({ ...base, type: 'clear' });
      const clear = tasks.find(x => x.key === taskKey({ ...base, type: 'clear' }));
      if (clear) feedClear(clear, c);
      const f = saveFacts();
      if (CARD_TIERS[r.monster] && f.cards) {
        const rank = cardRank(r.monster, f.cards[r.monster] || 0, f.unlocks);
        if (rank && rank.nextAt != null) ensure({ ...base, type: 'card', source: 'monster', chance: cardDropOf(r.monster)?.[1] ?? null });
      }
    } else if (isSkill(r)) {
      const t = ensure({ ...base, type: 'skill', skill: +r.kind });
      if (t.plannedOver !== key) { // planned for another target of this skill, and the save hasn't caught up: it stays what was planned
        delete t.plannedOver;
        retarget(t, key);
        t.match = { kind: 'activity', key };
      }
    } else if (kind === 'exp') ensure({ ...base, type: 'exp' });
    const skillCard = kind !== 'kills' && skillCardOf(r.monster), facts = skillCard && saveFacts();
    if (skillCard && facts.cards) { // the drop chance is per gather, and how many gathers an hour isn't known: Loot rates or a typed rate time it
      const rank = cardRank(skillCard, facts.cards[skillCard] || 0, facts.unlocks);
      if (rank && rank.nextAt != null) ensure({ ...base, type: 'card', monster: skillCard, source: 'skill', chance: null });
    }
    const gathered = gatheredItem(r);
    if (gathered) { // what the activity gives comes up by itself. A goal typed before it had a source takes this one
      const fields = { type: 'item', itemName: gathered, source: 'flat', chance: null, match: { kind: 'activity', key }, monster: r.monster, afkId: r.monster, activityKey: key };
      const had = tasks.find(x => x.key === taskKey(fields));
      if (!had) ensure({ ...fields, amount: '' });
      else if (had.source === 'direct' && blankText(had.perHour)) Object.assign(had, fields);
    }
    tasks.forEach(t => {
      if (t.slot !== r.slot) return;
      if (t.type === 'class' && kind === 'kills') retarget(t, key);
      if (!taskIsActive(t, r)) return;
      t.lastActiveAt = now;
      if (t.match && t.match.kind === 'activity') { t.mapIdx = r.mapIdx; t.afkId = r.monster; if ((t.type !== 'item' && t.source !== 'skill') || !t.monster) t.monster = r.monster; } // a skilling card keeps its card's name
      taskLockGoal(t);
    });
  });
  tasks.forEach(t => { if (t.type === 'card' && !blankText(t.goal)) t.goal = cardGoalLimit(t.monster, t.goal); }); // one typed before there was a limit
  tasks.forEach(t => { if (t.type === 'card' && t.source === 'skill') logSkillCard(t, null); }); // skilling cards are timed from the saves
  rows.forEach(r => { if (afkCapApplies(r)) ensure({ slot: r.slot, type: 'afkcap', starred: true }).lastActiveAt = now; }); // Unending Energy: collect before the cap
  for (let i = tasks.length - 1; i >= 0; i--) { const x = tasks[i]; if (x.type === 'afkcap' && !afkCapApplies(rows.find(r => r.slot === x.slot))) tasks.splice(i, 1); } // not wearing it, or being played: none
  rows.forEach(r => { // a Royal Guardian on a map being cleared toward an outpost: capturing it is a goal from the start, as a portal lock is
    if (r.slot == null || r.classIndex !== ROYAL_GUARDIAN || kindOf(r) !== 'kills' || !(OUTPOST_KILLS_REQ[r.mapIdx] > 0) || !(outpostClearing(saveForFinder, r.mapIdx) > 0)) return; // at 0 nothing is under way: every unbuilt map reads 0
    const had = tasks.find(x => x.type === 'outpost' && x.mapIdx === r.mapIdx);
    if (!had) upsertTask({ type: 'outpost', mapIdx: r.mapIdx, monster: r.monster || '', auto: true, starred: true }, now);
    else had.lastActiveAt = now;
  });
  Object.keys(MAP_CREW).forEach(m => { // a portal several characters must clear: main progression, so a goal from the start, once someone has begun on it
    const mapIdx = +m, crew = portalCrew(mapIdx, now), monster = (crew.all.find(x => x.there) || {}).r?.monster || (tasks.find(x => x.type === 'clear' && x.mapIdx === mapIdx && x.monster) || {}).monster;
    const had = tasks.find(x => x.key === 'portal|' + mapIdx);
    if (!had && crew.known && crew.cleared < crew.need && (crew.cleared > 0 || crew.on.length > 0)) upsertTask({ type: 'portal', slot: null, mapIdx, monster: monster || '', auto: true, starred: true }, now);
    else if (had && monster && !had.monster) had.monster = monster;
    if (had && crew.on.length) had.lastActiveAt = now;
  });
  tasks.forEach(t => {
    if (!isCollection(t) || t.slot != null || !taskIsActive(t)) return;
    t.lastActiveAt = now;
    if (t.type === 'card') taskLockGoal(t);
    if (t.plannedOnly) { delete t.plannedOnly; if (blankText(t.amount)) t.starred = false; } // starred only to show while planned. With no goal of its own, it goes when the activity does
  });
  if (typeof syncStatueGoals === 'function') syncStatueGoals(now); // a statue level goal sets its Collect task's amount
  syncProjects(now);
  return taskNoStamp() !== before;
}

function cleanTasks(list) { // never two tasks with one key, however the file came to hold them
  const out = [], byKey = new Map();
  list.forEach(t => {
    if (!t || typeof t !== 'object' || !t.type) return;
    const key = t.key || taskKey(t), had = byKey.get(key);
    if (!had) { const copy = { ...t, key, id: t.id || freshTaskId() }; byKey.set(key, copy); out.push(copy); return; }
    const [keep, other] = (t.editedAt || 0) > (had.editedAt || 0) ? [{ ...had, ...t, id: had.id, key }, had] : [{ ...t, ...had, key }, t];
    Object.keys(other).forEach(k => { if (blankText(keep[k]) && !blankText(other[k])) keep[k] = other[k]; });
    Object.assign(had, keep);
  });
  return out;
}
const tasksVersion = 2; // the shape of the saved sheet
// Runs from setState. A state with no tasks (another window's older page saved it) keeps the tasks held here.
function loadTasks(s) {
  loadProjects(s);
  if (Array.isArray(s.tasks)) {
    tasks = cleanTasks(s.tasks);
    if (s.rates && typeof s.rates === 'object') rates = s.rates;
    lootFilter = s.lootFilter && typeof s.lootFilter === 'object' ? s.lootFilter : {};
  }
  settleStatueGoals();
  syncTasks();
}
let lootNowSave = null;
async function refreshLootNow(status) {
  if (!LOCAL_APP || (status && status.savedAt && lootNow && lootNowSave === status.savedAt)) return; // it only changes with a save
  try { lootNow = await api('/api/loot'); lootNowSave = status ? status.savedAt : null; } catch { /* the planner tab already says when the app has stopped */ }
}
