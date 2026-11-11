/* ---------- kills per kill: how many kills one real kill counts as. Ported from Idleon Toolbox's getKillPerKill ---------- */
// One term per Toolbox term. Terms the save can't give (or that need a big subsystem) are 'missing': neutral until typed.
const KPK_CHAR_FIELDS = ['SL', 'PVStatList', 'Prayers', 'EMm0'], KPK_ACCOUNT_FIELDS = ['Divinity', 'Holes', 'PrayOwned', 'CauldronInfo', 'CauldronBubbles', 'Ninja', 'FarmUpg', 'Bubba', 'UpgVault', 'RoyalG'];
// Gear that gives kills: item -> [what, which UQ line, value]. Stones add to the value.
const KPK_GEAR = (() => {
  const rows = { EquipmentRings31: ['w3', 1, 30], EquipmentRings32: ['w4', 1, 30], EquipmentRings33: ['w2', 1, 30], EquipmentRings34: ['w5', 1, 30], EquipmentRings37: ['w6', 1, 30], EquipmentCape19: ['more', 1, 100], EquipmentGown4: ['kills', 1, 100], EquipmentGown6: ['kills', 2, 150], EquipmentGown8: ['kills', 1, 250], EquipmentHats85: ['kills', 1, 2], EquipmentHats88: ['kills', 1, 1], EquipmentHats110: ['kills', 1, 2], EquipmentHats132: ['kills', 2, 30] };
  [[27, 'kills', 1, 17], [34, 'w6', 1, 25], [36, 'w7', 1, 25], [42, 'w7', 2, 10]].forEach(([n, ...row]) => { rows['EquipmentNametag' + n] = row; rows['EquipmentNametagReplica' + n] = row; });
  return rows;
})();
const KPK_ORGANIC = 2;
const KPK_DECAY = (level, x1, x2) => level > 0 ? x1 * level / (level + x2) : 0;
const kpkParse = v => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
const kpkHasFields = (d, slot) => !!d && [...KPK_CHAR_FIELDS.map(f => f + '_' + slot), ...KPK_ACCOUNT_FIELDS].every(k => d[k] !== undefined);
const KPK_NAMETAG_LEVELS = [1, 1.6, 2, 2.3, 2.5], KPK_EVENT_LETTER = 'D'; // what extra copies of a nametag are worth; the event shop item that adds to the Hat Rack
// What the account's collections add, for a character who has unlocked each.
function kpkCollections(d, cleared, sum, slot) {
  const sp = kpkParse(d.Spelunk) || [], C = kpkCtx(d);
  const add = (row, value) => { sum[row[0]] = (sum[row[0]] || 0) + value; };
  const hats = Array.isArray(sp[46]) ? sp[46] : [], capes = Array.isArray(sp[54]) ? sp[54] : [];
  if (cleared(50)) {
    const multi = scHatRackMulti(C);
    hats.forEach(raw => { if (/Hats/.test(raw) && KPK_GEAR[raw]) add(KPK_GEAR[raw], KPK_GEAR[raw][2] * multi); });
  }
  if (cleared(250) && Array.isArray(sp[17])) {
    const multi = scGalleryMulti(C, slot != null && (scLab(C).chips[slot] || []).includes(16));
    [27, 34, 36, 42].forEach(i => {
      const copies = +sp[17][i] || 0, row = KPK_GEAR['EquipmentNametag' + i];
      if (copies >= 1 && row) add(row, row[2] * KPK_NAMETAG_LEVELS[Math.min(KPK_NAMETAG_LEVELS.length - 1, copies - 1)] * multi);
    });
  }
  if (cleared(100) && capes.length) {
    const { multi, golden } = scVineFacts(C);
    capes.forEach((raw, i) => { if (KPK_GEAR[raw]) add(KPK_GEAR[raw], KPK_GEAR[raw][2] * multi * (i < golden ? 1 : 0.25)); });
  }
}
function kpkWorn(d, slot) { // what the character's worn gear gives. Gallery, Hat Rack and Cape Vine take over from worn items once unlocked
  const order = (kpkParse(d['EquipOrder_' + slot]) || [])[0] || {}, stones = kpkParse(d['EMm0_' + slot]) || {}, kla = kpkParse(d['KLA_' + slot]), sum = {};
  const cleared = m => !Array.isArray(kla) || (Array.isArray(kla[m]) && kla[m][0] <= 0), vine = Array.isArray((kpkParse(d.Spelunk) || [])[54]) && cleared(100);
  Object.keys(order).forEach(i => {
    const raw = order[i], row = KPK_GEAR[raw];
    if (!row) return;
    if ((/Nametag/.test(raw) && cleared(250)) || (/Hats/.test(raw) && cleared(50)) || (+i === 12 && vine)) return;
    sum[row[0]] = (sum[row[0]] || 0) + row[2] + (+((stones[i] || {})['UQ' + row[1] + 'val']) || 0);
  });
  kpkCollections(d, cleared, sum, slot);
  return sum;
}
// A family bonus as this character sees it, the save-order walk Toolbox does: whoever has that class's talent tab, the best so far standing. boost: what this character's own The Family Guy makes of it.
function kpkFamilyWalk(d, slot, cls, from, x1, x2, boost) {
  let stored = 0;
  for (let i = 0; d['CharacterClass_' + i] !== undefined; i++) {
    const own = +d['CharacterClass_' + i];
    if (!(SC_DATA.tabs[own] || [own]).includes(cls)) continue;
    const level = (kpkParse(d['Lv0_' + i]) || [])[0] || 0, bonus = level < from ? 0 : KPK_DECAY(Math.round(level - from), x1, x2);
    if (!(bonus > stored)) continue;
    stored = i === slot ? boost(bonus) : bonus;
  }
  return stored;
}
function kpkFamily(d, slot) { // Death Bringer's
  const guy = (kpkParse(d['SL_' + slot]) || {})[KPK_FAMILY_GUY];
  return kpkFamilyWalk(d, slot, 14, 129, 60, 800, bonus => guy > 0 ? bonus * (1 + KPK_DECAY(guy, 40, 100) / 100) : bonus);
}
// What the account owns: index -> upgrade level, from the game's companion record. Null before the app has read it. Each entry is "index,tradable,,,level", one per copy.
function kpkCompanions() {
  const list = saveForFinder && saveForFinder.companions;
  if (!Array.isArray(list)) return null;
  const owned = new Map();
  list.forEach(entry => { const p = String(entry).split(','), i = +p[0]; if (Number.isInteger(i)) owned.set(i, Math.max(owned.get(i) || 0, +p[4] || 0)); });
  return owned;
}
// These are the same for every character, so they're typed once. Everything else can differ by character or activity.
const KPK_ACCOUNT_HOME = 'account', KPK_SHARED = new Set(['lab', 'vote', 'c14', 'c168', 'c29', 'c154', 'bubble']);
const kpkHomeFor = (t, id) => KPK_SHARED.has(id) ? KPK_ACCOUNT_HOME : kpkHomeOf(t);
const kpkTypedFor = (t, id) => { const box = rates[kpkHomeFor(t, id)]; return box && box.kpk ? box.kpk[id] : undefined; };
// Your say on which unowned companions a Pet Bonus Token covers. Nothing here means the save decides.
const kpkTokenOn = term => { const mine = rates[KPK_ACCOUNT_HOME] && rates[KPK_ACCOUNT_HOME].tokens && rates[KPK_ACCOUNT_HOME].tokens[term.id]; return mine === undefined ? !!term.tokened : !!mine; };
function kpkTokenSet(id, on) {
  const box = rates[KPK_ACCOUNT_HOME] = rates[KPK_ACCOUNT_HOME] || {};
  (box.tokens = box.tokens || {})[id] = !!on;
}
const KPK_NOBISECT_GOD = 7, KPK_ARCTIS_GOD = 2; // the game's numbers
const kpkNobisect = (d, slot) => scDivLink(kpkCtx(d), slot, KPK_NOBISECT_GOD, slot); // 2x when anything hands the character Nobisect's major bonus
const kpkTokened = (opt, index) => { // a Pet Bonus Token grants a companion's base bonus without owning it
  const list = String(opt[606] ?? ''), tokens = Math.min(1, +opt[605] || 0) + Math.min(1, +opt[615] || 0);
  return opt[606] != null && list !== '' && opt[606] !== 0 && list.split(',').length <= tokens + 0.5 && list.split(',').map(Number).includes(index);
};
/* ---------- a talent's real level: base + added + super talent. Ported from Idleon Toolbox's getTalentAddedLevels and applyTalentAddedLevels ---------- */
const KPK_ADDED_ACCOUNT_FIELDS = ['AchieveReg', 'Dream', 'Grimoire', 'Arcane', 'Gaming', 'Research']; // on top of the kills-per-kill fields. PlayerStuff_{slot} is the character's
const kpkTalentBanned = i => (i >= 49 && i <= 59) || i === 149 || i === 374 || i === 505 || i === 539 || i > 614; // game: TalentBannedforAllLV
const kpkRoyalTalent = i => i >= 225 && i <= 239; // their added levels stop at the armory's Talent Reattainment
// Symbols of Beyond sits on the fourth talent tab, so these classes have it: class -> its talent id.
const KPK_SYMBOLS = { 10: 149, 12: 149, 14: 149, 16: 149, 22: 374, 25: 374, 29: 374, 34: 539, 36: 539, 40: 539 };
const KPK_ELEMENTAL_SORCERER = 34, KPK_FAMILY_GUY = 144, KPK_ARCTIS_SLOT = 1, KPK_ARCTIS_MULTI = 15, KPK_BIG_P = 'c21', KPK_TIMMY_LETTER = 'U'; // Timmy_Talented is superbit 47
const KPK_KATTLEKRUK_ARMOR = ['EquipmentHats83', 'EquipmentShirts36', 'EquipmentPants27', 'EquipmentShoes36', 'EquipmentCape13'], KPK_KATTLEKRUK_WEAPONS = ['EquipmentPunching9', 'EquipmentSword7', 'EquipmentBows12', 'EquipmentWands11'];
/* ---------- what prisma bubbles multiply by. Ported from Idleon Toolbox's getPrismaMulti; game: PrismaBonusMult ---------- */
const KPK_PRISMA_FIELDS = ['Arcane', 'ArcadeUpg', 'Sushi', 'Research', 'Spelunk', 'CauldronP2W', 'FarmUpg', 'OptLacc'], KPK_PRISMA_BASE = 2, KPK_PRISMA_MAX = 5;
const KPK_PRISMA_UNREAD = { known: false, value: KPK_PRISMA_BASE, parts: null };
function kpkReadPrisma(d) {
  const [arcane, arcade, sushi, research, sp, p2w, farm, opt] = KPK_PRISMA_FIELDS.map(k => kpkParse(d[k])), owned = kpkCompanions();
  if (!owned || ![arcane, arcade, sushi, research, sp, p2w, farm, opt].every(Array.isArray)) return KPK_PRISMA_UNREAD;
  const has = i => owned.has(i) || kpkTokened(opt, i), legend = (i, per) => Math.round(per * (+((sp[18] || [])[i]) || 0));
  const arcadeLevel = +arcade[54] || 0, stars = +((sp[49] || [])[28]) || 0, petal = KPK_DECAY(+farm[68] || 0, 2, 1000); // Toolbox reads exotics from FarmUpg[20 + index]
  const parts = {
    tesseract: +arcane[45] || 0, // Pinnacle of Prisma: 1 per level
    arcade: KPK_DECAY(arcadeLevel, 10, 100) * scArcadeDouble(arcadeLevel, has(27)), // Spirit Reindeer doubles the shop
    sushi: Array.from({ length: 24 }, (_, i) => ((sushi[5] || [])[i] ?? -1) >= 0).every(Boolean) ? 1 : 0, // once the first 24 sushi are found
    jelly: +((research[7] || [])[9]) > 36 ? 1 : 0, // once 37 obstructions are defeated
    trophy: (Array.isArray(sp[16]) && sp[16].includes(23)) ? 10 : 0, // in the Gallery; its full list of drops is a large field read for this alone
    palette: KPK_DECAY(+((sp[9] || [])[28]) || 0, 6, 25) * (1 + legend(10, 25) / 100) * (1 + ((+((sp[0] || [])[8]) || 0) > 0 ? 0.5 : 0)) * (1 + stars + Math.floor(stars / 2)), // Violet, with Picasso Gaming, lore boss 8 and black stars
    sigils: 0.2 * (p2w[4] || []).filter((state, i) => i % 2 === 1 && (state === 3 || state === 4)).length, // pairs of progress, state; 3 is ethereal and 4 eclectic
    exotic: petal * (((sp[50] || []).map(Number)).includes(48) ? KPK_ORGANIC : 1), // Prisma Petal
    legend: legend(36, 3), // Wowa Woowa
    companion: has(88) ? 50 * (owned.get(88) >= 1 ? 1.5 : 1) : 0, // Rift Hivemind; a token gives the base bonus
  };
  return { known: true, value: Math.min(KPK_PRISMA_MAX, KPK_PRISMA_BASE + Object.values(parts).reduce((a, b) => a + b, 0) / 100), parts };
}
// { known, value, parts }, kept per save. known false: a field or the companions couldn't be read, so it's the base 2x.
function kpkPrismaRead(d) {
  kpkFreshCache();
  const kept = kpkCache.get('prisma');
  if (kept && kept.d === d) return kept;
  let read;
  try { read = d ? kpkReadPrisma(d) : KPK_PRISMA_UNREAD; } catch { read = KPK_PRISMA_UNREAD; }
  const out = { ...read, d };
  kpkCache.set('prisma', out);
  return out;
}
const kpkCtx = d => scCtx(d, saveForFinder && saveForFinder.companions);
const kpkPrismaMulti = d => kpkPrismaRead(d).value;
// Arctis's minor bonus, the only one the game rounds up into talent levels.
function kpkArctisBonus(d, slot, has, opt, skills, level) {
  if (!scDivLink(kpkCtx(d), slot, KPK_ARCTIS_GOD, slot)) return 0;
  const divinity = +level[14] || 0;
  const bubbles = ((kpkParse(d.CauldronBubbles) || [])[slot]) || [], raw = +(((kpkParse(d.CauldronInfo) || [])[3] || [])[21]) || 0, active = has(4) || bubbles.includes(KPK_BIG_P);
  const prisma = active && String(opt[384] ?? '').includes(KPK_BIG_P + ',');
  const bigP = active ? (1 + KPK_DECAY(raw, 0.5, 60)) * (prisma ? kpkPrismaMulti(d) : 1) : 0, coral = Math.round(+opt[430] || 0), factor = divinity > 0 ? divinity / (60 + divinity) : 0;
  return Math.ceil(Math.max(1, bigP) * (1 + coral / 100) * factor * KPK_ARCTIS_MULTI);
}
function kpkKattlekruk(d, opt) { // handed in to the smithy, or worn whole by whoever's being played
  if (String(opt[379] ?? '').split(',').slice(1).includes('KATTLEKRUK_SET')) return 5;
  let played = null, newest = 0;
  for (let i = 0; d['CharacterClass_' + i] !== undefined; i++) if (+d['PTimeAway_' + i] > newest) { newest = +d['PTimeAway_' + i]; played = i; }
  const worn = played == null ? [] : Object.values((kpkParse(d['EquipOrder_' + played]) || [])[0] || {});
  return KPK_KATTLEKRUK_ARMOR.every(x => worn.includes(x)) && KPK_KATTLEKRUK_WEAPONS.some(x => worn.includes(x)) ? 5 : 0;
}
// The Elemental Sorcerer's. guy: this character's The Family Guy, without the family bonus itself.
function kpkSorcererFamily(d, slot, guy) {
  return kpkFamilyWalk(d, slot, KPK_ELEMENTAL_SORCERER, 69, 20, 350, bonus => {
    const multi = guy.base >= 1 ? KPK_DECAY(guy.level + Math.floor(bonus), 40, 100) : 0;
    return multi > 0 ? bonus * (1 + multi / 100) : bonus;
  });
}
// { known, why, value, parts, superTalents, superBonus, royalCap }. known false: a source can't be read, so nothing's added.
function kpkReadAddedLevels(d, slot) {
  const owned = kpkCompanions(), lost = KPK_ADDED_ACCOUNT_FIELDS.filter(k => !Array.isArray(kpkParse(d[k]))), stuff = kpkParse(d['PlayerStuff_' + slot]);
  if (lost.length || !Array.isArray(stuff)) return { known: false, why: 'the app needs a restart to read them.' };
  if (!owned) return { known: false, why: 'the app hasn’t read your companions yet.' };
  const opt = kpkParse(d.OptLacc) || [], sp = kpkParse(d.Spelunk) || [], skills = kpkParse(d['SL_' + slot]) || {}, level = kpkParse(d['Lv0_' + slot]) || [];
  const has = i => owned.has(i) || kpkTokened(opt, i), god = kpkArctisBonus(d, slot, has, opt, skills, level);
  const symbolId = KPK_SYMBOLS[+d['CharacterClass_' + slot]], symbolLevel = symbolId ? +skills[symbolId] || 0 : 0;
  const parts = {
    god,
    symbols: symbolLevel > 0 ? 1 + Math.floor(symbolLevel / 20) : 0, // intervalAdd(level, 1, 20)
    achievement: kpkParse(d.AchieveReg)[291] === -1 ? 1 : 0,
    family: 0,
    companion: has(1) ? (owned.get(1) >= 1 ? 35 : 25) : 0,
    ninja: +opt[232] >= 3 ? 5 : 0,
    equinox: +kpkParse(d.Dream)[12] || 0, // Equinox_Symbols: 1 per level, and upgrades start at Dream[2]
    grimoire: +kpkParse(d.Grimoire)[39] || 0,
    set: kpkKattlekruk(d, opt),
    tesseract: Math.min(5, +kpkParse(d.Arcane)[57] || 0),
    superbit: String(kpkParse(d.Gaming)[12] ?? '').includes(KPK_TIMMY_LETTER) ? Math.max(0, Math.floor(((+level[0] || 0) - 500) / 100)) : 0,
  };
  const sum = () => Object.values(parts).reduce((a, b) => a + b, 0);
  const superTalents = (sp[Math.round(20 + slot + 12 * (+stuff[1] || 0))] || []).filter(x => x != null && x !== -1);
  const superBonus = Math.round(50 + Math.round(10 * (+((sp[18] || [])[7]) || 0)) + Math.floor(+((sp[45] || [])[5]) || 0)); // legend talent 7 and zenith 5
  const royalCap = +((kpkParse(d.RoyalG) || [])[2] || [])[55] || 0;
  const noFamily = sum(), guyBase = +skills[KPK_FAMILY_GUY] || 0, guyLevel = guyBase >= 1 ? Math.floor(guyBase + noFamily + (superTalents.includes(KPK_FAMILY_GUY) ? superBonus : 0)) : guyBase;
  parts.family = Math.floor(kpkSorcererFamily(d, slot, { base: guyBase, level: guyLevel }));
  return { known: true, why: '', value: sum(), noFamily, parts, superTalents, superBonus, royalCap };
}
function kpkAddedLevels(slot) {
  kpkFreshCache();
  const key = 'added|' + slot, d = saveForFinder && saveForFinder.data;
  if (!kpkCache.has(key)) {
    let added;
    try { added = d ? kpkReadAddedLevels(d, slot) : null; } catch { added = null; }
    kpkCache.set(key, added || { known: false, why: 'the save couldn’t be read.' });
  }
  return kpkCache.get(key);
}
// A talent at the level the game uses. whole false: it could be higher than this, so the term keeps its box.
function talentWithAdded(base, skill, addedLevels) {
  if (base < 1 || kpkTalentBanned(skill)) return { level: base, base, added: 0, sup: 0, whole: true };
  const a = addedLevels();
  if (!a.known) return { level: base, base, added: 0, sup: 0, whole: false, why: a.why };
  const added = kpkRoyalTalent(skill) ? Math.min(a.value, a.royalCap) : a.value, sup = a.superTalents.includes(skill) ? a.superBonus : 0;
  return { level: Math.floor(base + added + sup), base, added, sup, whole: true };
}
const kpkTalentLevel = (slot, skill, skills) => talentWithAdded(+skills[skill] || 0, skill, () => kpkAddedLevels(slot));
const kpkTalentHint = t => {
  if (t.base < 1) return '';
  if (!t.added && !t.sup && !t.whole) return 'Level ' + t.base + ', without added talent levels: ' + t.why;
  return 'Level ' + t.level + ': ' + t.base + ' + ' + t.added + ' added' + (t.sup ? ' + ' + t.sup + ' super talent' : '') + '.';
};
// The terms as the save has them, without anything typed. Kept per save, per character and map.
let kpkCacheFor = null, kpkCache = new Map();
function kpkFreshCache() { if (kpkCacheFor !== saveForFinder) { kpkCacheFor = saveForFinder; kpkCache = new Map(); } }
function kpkSaveTerms(slot, mapIdx) {
  kpkFreshCache();
  const key = slot + '|' + mapIdx;
  if (!kpkCache.has(key)) {
    let terms;
    try { terms = kpkReadTerms(slot, mapIdx); } catch { terms = kpkReadTerms(slot, mapIdx, true); }
    kpkCache.set(key, terms);
  }
  return kpkCache.get(key);
}
function kpkReadTerms(slot, mapIdx, unreadable) {
  const d = saveForFinder && saveForFinder.data, have = !unreadable && kpkHasFields(d, slot), list = [], w7 = mapIdx >= 300, notSaved = () => null;
  const push = (id, label, group, fn, hint, more) => {
    const neutral = group === 'multiply' && !(more && more.pool) ? 1 : 0, got = have ? fn() : null, none = got == null;
    const { miss, ...rest } = more || {};
    list.push({ id, label, group, value: none ? neutral : got, from: none ? 'missing' : 'save', hint: none ? (have || fn === notSaved || id[0] === 'c' ? miss || hint || '' : 'Not read yet: the app needs a restart.') : hint || '', ...rest });
  };
    const opt = have ? kpkParse(d.OptLacc) || [] : [], skills = have ? kpkParse(d['SL_' + slot]) || {} : {}, stats = have ? kpkParse(d['PVStatList_' + slot]) || [] : [], worn = have ? kpkWorn(d, slot) : {}, owned = kpkCompanions();
  const companion = (id, index, name, base, upgraded) => push(id, name + ' companion', 'multiply', () => owned && owned.has(index) ? (owned.get(index) >= 1 ? upgraded : base) : kpkTokened(opt, index) ? base : owned ? 1 : null, owned && !owned.has(index) ? 'You don\u2019t own it.' : '', { miss: 'If you own it: ' + base + ', or ' + upgraded + ' upgraded. Otherwise 1.', ...(have && owned && !owned.has(index) ? { tokenBase: base, tokened: kpkTokened(opt, index) } : {}) });
  push('lab', 'Lab: Killer’s Brightside', 'multiply', notSaved, '2 if it’s connected on the Lab board, otherwise 1.');
  companion('c14', 14, 'Rift Jocund', 2, 3);
  push('statue', 'Royal Statue: extra kills', 'multiply', () => {
    const g = kpkParse(d.RoyalG) || [], level = +((g[0] || [])[2]) || 0;
    return level > 0 ? 1 + (1 + (+((g[2] || [])[45]) || 0) / 100) * (30 + 3 * (level - 1)) / 100 : 1;
  });
  companion('c168', 168, 'Crystal Glunko', 1.2, 1.3);
  companion('c29', 29, 'Squirrel', 1.5, 1.75);
  companion('c154', 154, 'Glimbo', 1.6, 2);
  const wornHint = 'Worn gear, Hat Rack, Gallery and Cape Vine. Sushi and Minehead boosts to those aren’t read, so this can be a little low.', worn2 = id => () => 1 + (worn[id] || 0) / 100;
  push('gear96', 'Gear: % bonus kills', 'multiply', worn2('kills'), wornHint);
  push('gear103', 'Gear: % more kills', 'multiply', worn2('more'), wornHint);
  const world = mapIdx >= 350 || !(mapIdx >= 50) ? 0 : Math.floor(mapIdx / 50) + 1;
  push('world', 'Gear: % kills in this world' + (world === 7 ? ', and Big Fish' : ''), 'multiply', () => {
    const fish = world === 7 ? KPK_DECAY(+(((kpkParse(d.Spelunk) || [])[11] || [])[3]) || 0, 10, 100) : 0;
    return (world ? worn['w' + world] || 0 : 0) + fish;
  }, wornHint, { pool: 'world' });
  push('family', 'Death Bringer family bonus', 'multiply', () => kpkFamily(d, slot), '', { pool: 'world' });
  push('vote', 'This week’s vote', 'multiply', notSaved, 'The % on the ballot, if the kills bonus won. Otherwise 0.', { pool: 'world' });
  push('nobisect', 'Nobisect major bonus', 'multiply', () => { if (kpkNobisect(d, slot)) return 2; if (!owned) return null; return owned.has(0) && (+(kpkParse(d['Lv0_' + slot]) || [])[14] || 0) >= 2 ? 2 : 1; }, owned && owned.has(0) ? 'King Doot, with Divinity level 2 or more on this character.' : '', { miss: 'Not linked. 2 if you own King Doot and have Divinity 2 or more, otherwise 1.' });
  const levelOf = skill => have ? kpkTalentLevel(slot, skill, skills) : { level: 0, base: 0, whole: true }, shortOf = t => t.whole ? undefined : { partial: true }; // partial: read from the save, but the box stays
  const talent = (id, name, skill, stat) => { const t = levelOf(skill); push(id, name + ' talent', 'add', () => w7 ? 0 : KPK_DECAY(t.level, 40, 100) * (+stats[stat] || 0) / 1e3, w7 ? 'Off from World 7.' : kpkTalentHint(t), w7 ? undefined : shortOf(t)); };
  talent('talentStr', 'Charred Skulls', 141, 0);
  talent('talentAgi', 'Stacked Skulls', 366, 1);
  talent('talentWis', 'Memorial Skulls', 531, 2);
  const decimator = levelOf(109);
  push('decimator', 'Monster Decimator talent', 'add', () => KPK_DECAY(decimator.level, 100, 50), kpkTalentHint(decimator), shortOf(decimator));
  list.push({ id: 'mk', label: 'Multikill', group: 'add', value: 0, from: 'missing', hint: 'The MULTIKILL line on the game’s AFK Info screen. It isn’t worked out from the save. Common drops come this many more times; rare-table drops don’t.' });
  const a18 = have ? KPK_DECAY(+(((kpkParse(d.CauldronInfo) || [])[1] || [])[18]) || 0, 70, 40) : 0;
  push('bubble', 'Kill Per Kill bubble', 'add', () => ((kpkParse(d.CauldronBubbles) || [])[slot] || []).includes('a18') || (owned && owned.has(4)) ? a18 : owned ? 0 : null, owned && owned.has(4) ? 'Sheepie counts it as equipped for everyone.' : '', { miss: 'Not equipped. With the Sheepie companion it counts anyway: ' + fmtRate0(a18) + '%. Otherwise 0.' });
  push('prayer', 'Fibers of Absence prayer', 'add', () => {
    const on = (kpkParse(d['Prayers_' + slot]) || []).filter(p => p >= 0), level = +((kpkParse(d.PrayOwned) || [])[13]) || 0;
    return !on.length ? null : on.includes(13) && level > 0 ? Math.round(30 + 30 * (level - 1) / 10) : 0;
  }, '', { miss: 'No prayers on, so only Superbits could give it. Otherwise 0.' });
  push('charm', 'Bubblegum Law charm', 'add', () => ((kpkParse(d.Ninja) || [])[107] || [])[6] ? 25 : 0);
  push('exotic', 'Potent Hemlock exotic crop', 'add', () => { const level = +((kpkParse(d.FarmUpg) || [])[76]) || 0, organic = ((kpkParse(d.Spelunk) || [])[50] || []).map(Number).includes(56); return 35 * level / (1000 + level) * (organic ? KPK_ORGANIC : 1); });
  push('legend', 'Thanatos’s Teachings legend talent', 'add', () => Math.round(200 * (+(((kpkParse(d.Spelunk) || [])[18] || [])[16]) || 0)));
  push('bubba', 'Bubba: all kills', 'add', () => {
    const b = (kpkParse(d.Bubba) || [])[1] || [], flesh = +b[8] || 0, owned = i => flesh > i ? (i === 11 ? flesh - 11 : 1) : 0;
    return Math.max(0, (1 + 20 * [1, 3, 6, 9, 11].reduce((sum, i) => sum + owned(i), 0) / 100) * Math.ceil(((+b[3] || 0) - 4) / 7));
  }, 'Santa’s Little Helper companion would multiply this.');
  push('vault', 'Skulltrick vault upgrade', 'add', () => +((kpkParse(d.UpgVault) || [])[64]) || 0);
  push('friend', 'Friend bonus: extra kills', 'add', () => {
    const entry = String(opt[476] ?? '').split(';').map(s => s.split(',')).find(e => e[0] === '6');
    if (!entry) return 0;
    const level = Math.min(30000, Math.max(0, +entry[1] || 0));
    return 10 * Math.min(1.5, 0.25 + level / (level + 12000) * 1.5);
  }, 'Without Mr Pig or Spearfish companions.');
  list.have = have;
  return list;
}
/* card drop chance */
const CARD_DROP_CARDS = { frogBIG: 5, snailZ: 8, stache: 9, EasterEvent1: 1 }, CARD_CHAMP = 'c18', CARDIOVASCULAR = 628;
let cardBonusFor = null, cardBonusCache = new Map();
// { total, parts: { bubble, forge, cards, talent } } for one character. Null until the companion list is read, since the bubble depends on Sheepie.
function cardDropParts(slot) {
  if (cardBonusFor !== saveForFinder) { cardBonusFor = saveForFinder; cardBonusCache = new Map(); }
  if (cardBonusCache.has(slot)) return cardBonusCache.get(slot);
  const d = saveForFinder && saveForFinder.data, owned = kpkCompanions(), f = d ? saveFacts() : null;
  let out = null;
  if (d && owned && f.cards) {
    const opt = kpkParse(d.OptLacc) || [], level = +(((kpkParse(d.CauldronInfo) || [])[3] || [])[18]) || 0, worn = ((kpkParse(d.CauldronBubbles) || [])[slot] || []).includes(CARD_CHAMP) || owned.has(4);
    const prisma = String(opt[384] ?? '').split(',').some(x => x === CARD_CHAMP || x === '0' + CARD_CHAMP), passive = +((kpkParse(d.UpgVault) || [])[44]) >= 1;
    const bubble = worn ? KPK_DECAY(level, 100, 40) * (prisma ? kpkPrismaMulti(d) : 1) : 0, forge = 2 * (+((kpkParse(d.ForgeLV) || [])[5]) || 0), talent = KPK_DECAY(+((kpkParse(d['SL_' + slot]) || {})[CARDIOVASCULAR]) || 0, 60, 60);
    const cards = passive ? Object.entries(CARD_DROP_CARDS).reduce((n, [raw, per]) => { const copies = f.cards[raw] || 0, rank = copies > 0 ? cardRank(raw, copies, f.unlocks) : null; return n + (rank ? per * rank.rank : 0); }, 0) : 0;
    const guild = KPK_DECAY(+(((kpkParse(d.Guild) || [])[0] || [])[12]) || 0, 60, 50); // Card Spotter
    // How these stack isn't published. Forge with cards, and bubble and guild each apart, is the closest fit to real claims that stays under them; the talent says it's multiplicative.
    out = { total: (1 + bubble / 100) * (1 + (forge + cards) / 100) * (1 + guild / 100) * (1 + talent / 100), parts: { bubble, forge, cards, guild, talent } };
  }
  cardBonusCache.set(slot, out);
  return out;
}
const cardDropMulti = t => { if (t.type !== 'card') return 1; const got = cardDropParts(t.slot); return got ? got.total : 1; };
const fmtRate0 = n => n > 0 ? fmtRate(n) : '0';
const kpkHomeOf = t => statHome(t, 'mk');
// Read from the save, but only part of the number: worn gear without Sushi or Minehead boosts, bonuses without their companions. These keep a box. So does a term marked partial: a talent whose added levels can't be read yet.
const KPK_PARTIAL = new Set(['gear96', 'gear103', 'world', 'bubba', 'friend']);
const kpkLocked = term => term.from === 'save' && !term.partial && !KPK_PARTIAL.has(term.id); // the app has the whole number, so there's nothing to type
// A typed number replaces the save's. Blank, or not a number a term can be, goes back to the save's.
function kpkTyped(text, term) {
  if (blankText(text)) return null;
  const n = parseNum(text);
  return n == null || Number.isNaN(n) || (term.group === 'multiply' && !term.pool && !(n > 0)) ? null : n;
}
// { value, worked, terms: [{ id, label, group, pool?, value, from, hint }], fallback, typedTotal, missing }. at: a task, for its activity and map; otherwise what the character's doing now. ov: Simulate's draft.
function killsPerKill(slot, ov, at) {
  const r = rows.find(x => x.slot === slot), t = at || { slot, activityKey: r ? r.activityKey : null };
  const map = t.mapIdx ?? (r ? r.mapIdx : null) ?? (chars[slot] ? chars[slot].mapIdx : null), base = kpkSaveTerms(slot, map), home = kpkHomeOf(t), box = (home && rates[home]) || {}, typed = box.kpk || {};
  let times = 1, world = 0, add = 0, missing = 0;
  const terms = base.map(term => {
    const out = { ...term, saved: term.value };
    const own = kpkLocked(term) ? null : kpkTyped(KPK_SHARED.has(term.id) ? kpkTypedFor(t, term.id) : typed[term.id], term);
    if (term.tokenBase) { out.tokenOn = kpkTokenOn(term); out.value = out.tokenOn ? term.tokenBase : 1; out.saved = out.value; }
    else if (term.id === 'mk') {
      const drafted = ov && 'mk' in ov, n = parseNum(taskField(t, 'mk', ov)), got = drafted || own == null ? n : own;
      if (got > 0 || (got === 0 && (drafted || own != null || !blankText(taskField(t, 'mk', ov))))) { out.value = got; out.from = 'typed'; }
    } else if (own != null) { out.value = own; out.from = 'typed'; }
    if (out.from === 'missing') missing++;
    if (term.pool) world += out.value;
    else if (term.group === 'multiply') times *= out.value;
    else add += out.value;
    return out;
  });
  const worked = times * (1 + world / 100) * (1 + add / 100), text = ov && 'kpkTotal' in ov ? ov.kpkTotal : box.kpkTotal, total = blankText(text) ? null : parseNum(text), typedTotal = total > 0;
  return { value: typedTotal ? total : worked, worked, terms, fallback: !base.have, typedTotal, missing };
}
// Real kills from what the game's kills/hour shows.
const realKills = (kph, slot, ov, at) => kph / killsPerKill(slot, ov, at).value;
function kpkTermSet(home, id, value) {
  if (!home) return;
  const box = rates[home] = rates[home] || {}, typed = box.kpk = box.kpk || {};
  if (blankText(value)) delete typed[id]; else typed[id] = value;
  if (!Object.keys(typed).length) delete box.kpk;
  if (!Object.keys(box).length) delete rates[home];
}
const kpkShown = term => term.from === 'missing' ? 'Not in the save' : term.group === 'multiply' && !term.pool ? '×' + fmtRate0(term.value) : fmtRate0(term.value) + '%';

/* the box's "How it's worked out" list. Built once with the AFK stats box; the 1s tick only fills it in */
let kpkOpen = false;
function buildKpkHow(owner) {
  const t = owner.task, c = killsPerKill(t.slot, null, t), wrap = el('div', 'kpk-how'), note = el('p', 'small kpk-note'), how = el('details', 'kpk-disclose'), sum = el('summary'), list = el('div', 'kpk-list');
  how.open = kpkOpen;
  how.addEventListener('toggle', () => { kpkOpen = how.open; });
  sum.append(el('span', 'kpk-sum-text', 'How it’s worked out'), el('span', 'small kpk-sum-count'));
  c.terms.forEach(term => {
    const row = el('label', 'kpk-row'), box = el('input');
    row.dataset.term = term.id;
    const words = el('div', 'kpk-words');
    words.append(el('span', 'kpk-label', term.label), el('span', 'small kpk-hint'));
    box.dataset.kpkTerm = term.id;
    box.inputMode = 'decimal';
    box.autocomplete = 'off';
    box.setAttribute('aria-label', term.label);
    const token = el('span', 'kpk-token'), tick = el('input'), tickText = el('span', 'small', 'Pet token');
    tick.type = 'checkbox';
    tick.dataset.kpkToken = term.id;
    tick.setAttribute('aria-label', 'Pet token: ' + term.label);
    tickText.addEventListener('click', e => { e.preventDefault(); tick.click(); });
    token.append(tick, tickText);
    token.hidden = true;
    row.append(words, el('span', 'kpk-value'), token, box);
    list.append(row);
  });
  how.append(sum, list);
  wrap.append(note, how);
  return wrap;
}
function paintKpkHow(node, owner) {
  const t = owner.task, wrap = node.querySelector('.kpk-how');
  if (!t || !wrap) return;
  const c = killsPerKill(t.slot, null, t), home = kpkHomeOf(t), typed = (home && rates[home] && rates[home].kpk) || {}, note = wrap.querySelector('.kpk-note');
  setText(note, c.fallback ? 'Only multikill for now: the app needs a restart.' : '');
  note.hidden = !c.fallback;
  setText(wrap.querySelector('.kpk-sum-count'), c.missing ? c.missing + ' not in the save' : '');
  c.terms.forEach(term => {
    const row = wrap.querySelector('[data-term="' + term.id + '"]');
    if (!row) return;
    const box = row.querySelector('[data-kpk-term]'), locked = kpkLocked(term), shared = KPK_SHARED.has(term.id), text = String((shared ? kpkTypedFor(t, term.id) : typed[term.id]) ?? ''), hint0 = [term.hint, shared ? 'Shared by all your characters.' : ''].filter(Boolean).join(' ');
    row.classList.toggle('missing', term.from === 'missing');
    box.hidden = locked;
    const token = row.querySelector('.kpk-token'), tick = token.querySelector('input');
    token.hidden = !term.tokenBase;
    if (term.tokenBase && tick.checked !== term.tokenOn) tick.checked = term.tokenOn;
    setText(row.querySelector('.kpk-value'), kpkShown(term));
    setText(row.querySelector('.kpk-hint'), hint0);
    row.querySelector('.kpk-hint').hidden = !hint0;
    if (box !== document.activeElement && box.value !== text) box.value = text;
    const hint = term.id === 'mk' && term.from === 'typed' ? fmtRate0(term.value) : fmtRate0(term.saved);
    if (box.placeholder !== hint) box.placeholder = hint;
    const bad = !blankText(box.value) && kpkTyped(box.value, term) == null;
    box.setAttribute('aria-invalid', String(bad));
  });
}
const kpkWired = new WeakSet();
function wireKpkHow(container, ownerOf) {
  if (kpkWired.has(container)) return;
  kpkWired.add(container);
  container.addEventListener('input', e => {
    const id = e.target.dataset.kpkTerm, owner = id && ownerOf(e.target);
    if (!owner || !owner.task) return;
    kpkTermSet(kpkHomeFor(owner.task, id), id, e.target.value);
    queueSave();
    paintAll();
  });
  container.addEventListener('change', e => {
    if (!e.target.dataset.kpkToken) return;
    kpkTokenSet(e.target.dataset.kpkToken, e.target.checked);
    queueSave();
    paintAll();
  });
  container.addEventListener('keydown', e => {
    if (e.target.dataset.kpkTerm && e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
}
