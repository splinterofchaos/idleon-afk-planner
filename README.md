# Idleon AFK Planner

A local planner for **Legends of Idleon**. It runs on your PC, reads your own cloud save (read only), and works out when your goals finish: map kills, class and skill levels, cards, items, forge bars, portals, statues and the Royal Guardian's armory. Loot rates are measured from your saves as you play.

It's one page (`idleon-afk-planner.html`) served by a small Node server (`server.js`). There are no dependencies to install.

## Running it

It runs on **Windows**: it stores your sign-in with Windows' own encryption, through PowerShell.

1. Install [Node.js](https://nodejs.org) 18 or newer.
2. Create `sync-config.json` beside `server.js`, shaped like `sync-config.example.json`. It holds the game's sign-in client settings (`apiKey`, `googleClientId`, `googleClientSecret`). They aren't included in this repository.
3. Optional: put item and monster images in `icons/`, one PNG per raw game name (`Copper.png`, `Quest110.png`...), and world maps for the Armory tab in `maps/` (`w1.png`...). Neither is included; the page works without them, just with fewer pictures.
4. Run `node server.js`, or double-click `Start Idleon Planner.cmd` on Windows. It opens the planner at `http://127.0.0.1:47811/`.

Sign in with Google, Steam or email. Your password goes straight to the game's login service and is never written to disk; the sign-in it returns is stored encrypted for your Windows user, in `%APPDATA%\IdleonAfkPlanner`, with the rest of the app's data. Closing the window stops the server after a few minutes. `server.log` in that folder records starts, restarts, stops and crashes.

## Working on it

- `src/base.html` and `src/parts/` are the source. `node src/assemble.js` builds `dist/idleon-afk-planner.html`; copy it over `idleon-afk-planner.html` to use it.
- `test/` holds the tests. Each `test-*.js` runs on its own: `node test/test-armory.js`. They start a copy of the server against a fake game backend and drive the built page in headless Chrome, so they need Chrome installed. **No test contacts the game's servers, or the planner you're running** (port 47811). `node test/check.js` checks the built page against saved test accounts.
- `tools/gen-*.js` regenerate the data tables in `src/parts/` from Idleon Toolbox's data files. They expect a checkout of that data and aren't needed to run or build the app.

## Credits and licenses

This project is licensed under the **GNU General Public License v3.0 only** (see `LICENSE`), because it's built on work from Idleon Toolbox, which is GPL-3.0-only.

- **[Idleon Toolbox](https://github.com/Morta1/IdleonToolbox)** by Morta1 and contributors, GPL-3.0-only. Many of the planner's formulas are ported from Toolbox's parsers: kills per kill, drop chances, card stars, level costs, statue bonuses, account bonuses (bubbles, vials, lab, talents and the rest) and Royal Guardian outpost rates. The game data tables in `src/parts/` (items, monsters, drop tables, recipes, statues, the armory) are generated from Toolbox's data files, as of commit `7a0d489`. `test/fixtures/toolbox/` holds Toolbox's own test saves and card table, unchanged.
- **[IdleOn wiki](https://idleon.wiki)**: which world each gathering spot is in, and the Royal Armory world maps the Armory tab can show (not included here).
- **Legends of Idleon** is made by Lavaflame2. Game names, data and art belong to them. This is a fan project, not affiliated with or endorsed by Lavaflame2.

The test save in `test/fixtures/full-save.json` is a real account with its character names replaced.
