// Builds parts/drop-tables.js: per monster, the drops on its own list (not in a drop table beneath it), by display name. Common drops roll per counted kill.
// Dungeon items (type DUNGEON_EVAPORATE) are left out of COMMON_DROPS: a claim of 193,898 Temple Torches from 449M kills at 68571% multikill matched one roll per real kill (99%), not one per counted kill.
// Also: OWN_DROPS, everything on the monster's own list as the game's monster screen shows it; DROP_TABLES, each table beneath it outermost first, as [chance of reaching it, raw items]; ONCE_DROPS, drops that come only once (anvil recipes).
const fs = require('fs');
const j = JSON.parse(fs.readFileSync('projects-research/dl/d/monsterDrops.json', 'utf8')), out = {}, own = {}, tables = {}, once = new Set();
const add = (o, m, raw) => (o[m] = o[m] || new Set()).add(raw);
const walk = o => {
  if (Array.isArray(o)) return o.forEach(walk);
  if (!o || typeof o !== 'object') return;
  if (!(o.monsterRawName && o.rawName)) return Object.values(o).forEach(walk);
  const path = o.dropTablePath || [];
  if (o.Type === 'ANVIL_RECIPE') once.add(o.rawName);
  if (!path.length && o.rawName !== 'COIN') add(own, o.monsterRawName, o.rawName);
  if (path.length && o.rawName !== 'COIN') {
    const list = tables[o.monsterRawName] = tables[o.monsterRawName] || [], key = path.join('/');
    let t = list.find(x => x.key === key);
    if (!t) list.push(t = { key, depth: path.length, chance: o.tableChance, items: [] });
    if (!t.items.includes(o.rawName)) t.items.push(o.rawName);
  }
  if (!path.length && o.rawName !== 'COIN' && o.Type !== 'DUNGEON_EVAPORATE') add(out, o.monsterRawName, o.rawName);
};
walk(j);
const sets = o => Object.fromEntries(Object.entries(o).map(([m, s]) => [m, [...s]]));
const obj = sets(out);
fs.writeFileSync('parts/drop-tables.js',
  '// What each monster drops from its own list, by raw item name, from the game\'s drop data as Idleon Toolbox publishes it. These roll for every kill multikill counts; drops from a table beneath it roll once per real kill.\n'
  + 'const COMMON_DROPS = ' + JSON.stringify(obj) + ';\n'
  + '// Everything on a monster\'s own list, dungeon items too: the game\'s monster screen shows these, then one Rare Drop tile at RARE_TABLE\'s chance for the table beneath.\n'
  + 'const OWN_DROPS = ' + JSON.stringify(sets(own)) + ', DROP_TABLES = ' + JSON.stringify(Object.fromEntries(Object.entries(tables).map(([m, l]) => [m, l.sort((a, b) => a.depth - b.depth).map(t => [t.chance, t.items])]))) + ';\n'
  + '// Drops that come only once, so the game stops listing them: anvil recipes.\n'
  + 'const ONCE_DROPS = new Set(' + JSON.stringify([...once]) + ');\n');
console.log('monsters', Object.keys(obj).length, 'w7b4 own', JSON.stringify(sets(own).w7b4), 'tables', JSON.stringify(tables.w7b4 && tables.w7b4.map(t => [t.chance, t.items])), 'once', [...once].length);
