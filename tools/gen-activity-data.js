// Writes parts/activity-data.js: what can be done in each world. Fighting comes from the game's map list; gathering worlds from the IdleOn wiki's Area columns matched to its Worlds page. Four are inferred (see the comments in the output).
const fs = require('fs');
const G = JSON.parse(/const GAME = (\{.*?\});\r?\n/s.exec(fs.readFileSync('base.html', 'utf8'))[1]);
const s = require('./kpk-src/data/website-data/shared-data.json');
const find = (o, k) => { if (o && typeof o === 'object') for (const K in o) { if (K === k) return o[K]; const r = find(o[K], k); if (r) return r; } };
const enemies = find(s, 'mapEnemiesArray');
const notAfk = /Colosseum|Backyard|Gazebo|Tutorial|PlayerSelect|How Did u|^Z$|Miningg/;
const fighting = {};
enemies.forEach((id, i) => {
  const m = G.monsters[id], world = Math.floor(i / 50) + 1;
  if (!m || m[1] !== 'FIGHTING' || id === 'Z' || notAfk.test(G.maps[i] || '') || world > 7) return;
  (fighting[world] = fighting[world] || []).push([id, i]);
});
// The Hole (map 216) lists no monster of its own: its fighters are in its caverns, so they're added by hand.
const HOLE = 216;
['caveA', 'caveB', 'caveC', 'caveD'].forEach(id => { if (!G.monsters[id] || G.monsters[id][1] !== 'FIGHTING') throw new Error('no cavern monster ' + id); (fighting[Math.floor(HOLE / 50) + 1] = fighting[Math.floor(HOLE / 50) + 1] || []).push([id, HOLE]); });
const gather = {
  MINING: { Copper: [1], Iron: [1], Gold: [1], Plat: [1], Dementia: [1], Void: [1], Lustre: [1], Starfire: [1], Dreadlo: [1], Godshard: [1], Marble: [3], Motherlode: [5], Prehistrium: [7] },
  CHOPPIN: { OakTree: [1], BirchTree: [1], JungleTree: [1], ForestTree: [1], ToiletTree: [1], StumpTree: [1], PalmTree: [2], SaharanFoal: [3], Tree7: [3], Tree11: [3], AlienTree: [4], Tree8: [4, 5], Tree9: [5], Tree10: [5], MotherlodeTREE: [5], Tree12: [6], Tree13: [6], Tree14: [7] },
  FISHING: { FishSmall: [2], FishMed: [2], FishBig: [2], FishEquinox: [3], MotherlodeFISH: [5] }, // the last two aren't on the wiki: Equinox goes with the Equinox Valley targets, Trench with the other Motherlode ones
  CATCHING: { Bug1: [2], Bug2: [2], Bug3: [2], Bug4: [2], Bug5: [3], Bug6: [3], Bug11: [3], Bug7: [4], Bug8: [4], Bug9: [5], Bug10: [5], Bug14: [5], Bug12: [6], Bug13: [6], Bug15: [7] }, // Bug7 isn't on the wiki: its Worker Bee is at Jelly Cube Bridge, and the ids run in world order
  COOKING: { Cooking: [4] },
  LABORATORY: { Laboratory: [4] },
  SPELUNKING: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(i => ['Spelunking' + i, [7]])),
};
for (const k in gather) for (const id in gather[k]) if (!G.monsters[id] || G.monsters[id][1] !== k) {
  const real = Object.entries(G.monsters).find(([, v]) => v[1] === k);
  if (real && (k === 'COOKING' || k === 'LABORATORY')) { gather[k] = { [real[0]]: gather[k][id] }; break; }
  throw new Error('no target ' + k + ' ' + id);
}
for (const k in gather) { const all = Object.entries(G.monsters).filter(([, v]) => v[1] === k).map(([x]) => x), miss = all.filter(x => !gather[k][x]); if (miss.length) throw new Error(k + ' has no world: ' + miss); }
fs.writeFileSync('parts/activity-data.js', '/* ---------- what can be done in each world. Written by gen-activity-data.js ---------- */\nconst WORLD_FIGHTS = ' + JSON.stringify(fighting) + ', WORLD_GATHER = ' + JSON.stringify(gather) + ';\n');
console.log(Object.entries(fighting).map(([w, l]) => w + ':' + l.length).join(' '), JSON.stringify(gather.COOKING), JSON.stringify(gather.LABORATORY));
console.log(fighting[1].map(([id, i]) => G.monsters[id][0] + '@' + G.maps[i]).join(', '));
