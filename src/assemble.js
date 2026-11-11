// Builds ../dist/idleon-afk-planner.html: base.html with each marker replaced by the matching parts file.
const fs = require('fs'), path = require('path');
const dir = __dirname, read = f => fs.existsSync(path.join(dir, 'parts', f)) ? fs.readFileSync(path.join(dir, 'parts', f), 'utf8') : '';
let html = fs.readFileSync(path.join(dir, 'base.html'), 'utf8');
for (const [marker, files] of Object.entries({
  '/*@@CSS@@*/': ['panel.css', 'planner.css', 'simulate.css', 'kpk.css', 'projects.css', 'forge.css', 'activity-picker.css', 'player.css', 'statues.css', 'activity-view.css', 'armory.css'],
  '/*@@JS_CORE@@*/': ['kpk.js', 'tasks.js', 'projects-data.js', 'projects.js', 'activity-data.js', 'drop-tables.js', 'sample-calc.js', 'statues.js', 'armory-data.js'],
  '/*@@JS_VIEWS@@*/': ['panel.js', 'planner.js', 'activity-view.js', 'simulate.js', 'projects-view.js', 'forge-view.js', 'activity-picker.js', 'player-view.js', 'statues-view.js', 'armory-view.js'],
})) {
  if (html.split(marker).length > 2) throw new Error('marker twice: ' + marker);
  html = html.split(marker).join(files.map(read).join('\n'));
}
fs.mkdirSync(path.join(dir, '..', process.env.BUILD_DIST || 'dist'), { recursive: true });
const distName = process.env.BUILD_DIST || 'dist', out = path.join(dir, '..', distName, 'idleon-afk-planner.html');
if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== html) fs.writeFileSync(out, html); // an open test page reloads when this file's time changes
const icons = path.join(dir, '..', 'dist', 'icons'), iconsFrom = path.join(dir, '..', 'icons'); // check.js looks beside the page; the server uses its own folder
if (!fs.existsSync(icons) && fs.existsSync(iconsFrom)) fs.cpSync(iconsFrom, icons, { recursive: true });
console.log('built', html.length);
