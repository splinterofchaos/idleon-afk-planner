// EXP between two saves when the character goes up more than one level. Reads the function out of the app's server.js; no server, no network.
const assert = require('assert'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').match(/function expGained[\s\S]*?\n}/)[0];
const expGained = eval('(' + src + ')');
const cls = t => (15 + Math.pow(t, 1.9) + 11 * t) * Math.pow(1.208 - Math.min(0.164, (0.215 * t) / (t + 100)), t) - 15; // the class EXP curve
let pass = 0, fail = 0;
const test = (name, f) => { try { f(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', e.message); } };
const near = (a, b, tol, m) => assert.ok(Math.abs(a / b - 1) < tol, m + ': ' + a + ' should be ' + b);
test('same level: the difference', () => assert.equal(expGained([5, 1, 10], [5, 4, 10]), 3));
test('one level: rest of the old plus into the new', () => assert.equal(expGained([5, 1, 10], [6, 3, 12]), 12));
test('two levels: the level passed through counts', () => {
  const real = cls(1354) - 1e30 + cls(1355) + 4e29;
  near(expGained([1354, 1e30, cls(1354)], [1356, 4e29, cls(1356)]), real, 1e-6, '1354 to 1356');
});
test('six levels at 1350', () => {
  let real = cls(1350) - 2e30 + 5e29; for (let l = 1351; l < 1356; l++) real += cls(l);
  near(expGained([1350, 2e30, cls(1350)], [1356, 5e29, cls(1356)]), real, 1e-4, '1350 to 1356');
});
test('no costs known: never NaN', () => assert.equal(expGained([5, 1, 0], [7, 2, 0]), 2));
test('level down: nothing', () => assert.equal(expGained([7, 1, 10], [6, 3, 9]), 0));
console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
