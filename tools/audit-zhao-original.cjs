#!/usr/bin/env node
// Read-only audit: execute only selected, locally reviewed original methods in
// a bounded VM with rendering/event services stubbed. Never boot the game bundle.
const fs = require('node:fs');
const crypto = require('node:crypto');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('../apps/client/node_modules/typescript');

const filename = process.argv[2];
if (!filename) throw new Error('Usage: node tools/audit-zhao-original.cjs <original bundle.js>');
const raw = fs.readFileSync(filename, 'utf8');
const ast = ts.createSourceFile(filename, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declarations = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
    && ['Je', 'hn', 'Ta'].includes(node.name.text)) declarations.set(node.name.text, node.initializer);
  if (ts.isFunctionDeclaration(node) && node.name?.text === '_0xc34') declarations.set('_0xc34', node);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isElementAccessExpression(node.left) && node.left.expression.getText(ast) === 'hn'
    && node.left.argumentExpression.text === 'bO') declarations.set('hn.bO', node.right);
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of ['Je', 'hn', 'Ta', '_0xc34']) assert.ok(declarations.has(name), `Missing ${name}`);
const context = vm.createContext({});
function run(code) { return vm.runInContext(code, context, { timeout: 2000 }); }
run(declarations.get('_0xc34').getText(ast));
// Decoder calls remaining in these selected methods only name UI events.
run(`const _0xa5353b = [], _0x5feedb = [];
const _0x60b = () => 'ui-event', _0xeca8b = () => 'ui-event';
const Gt = { instance: () => ({ jf() {}, ag() {} }) };
const Laya = { Vector2: class {} };
const Je = ${declarations.get('Je').getText(ast)};
const hn = ${declarations.get('hn').getText(ast)};
hn.bO = ${declarations.get('hn.bO').getText(ast)};
const originalAttack = ({${declarations.get('Ta').members.find(m => m.name?.getText(ast) === 'attack').getText(ast)}}).attack;`);
// Use original constructors and original counter/activation functions. Stub only
// phantom allocation/launch and cosmetic events; keep onActive/uC unchanged.
const trigger = run(`(() => {
  const skill = new hn(30), phantoms = [];
  skill.rC = { oC: true, EC: 1, general: {}, cC: {}, event() {} };
  skill.QF = () => ({});
  skill.hO = () => ({ id: phantoms.length });
  skill.iO = p => phantoms.push(p);
  let normalAttacks = 0;
  const unit = { qU: [skill], WU: false, sF() {}, event() {}, lP() { normalAttacks++; } };
  for (let i = 0; i < 29; i++) originalAttack.call(unit);
  const at29 = phantoms.length;
  originalAttack.call(unit);
  const at30 = { count: phantoms.length, active: skill.hC, counter: skill.nC };
  for (let i = 0; i < 30; i++) originalAttack.call(unit);
  return { at29, at30, at60: phantoms.length, retainedFirst: phantoms[0].id === 0,
    normalAttacks, speed: skill.eo, roundTrips: skill.qF, interceptsNormalAttack: skill.mC };
})()`);
assert.equal(trigger.at29, 0);
assert.equal(trigger.at30.count, 1);
assert.equal(trigger.at30.active, false);
assert.equal(trigger.at30.counter, 0);
assert.equal(trigger.at60, 2);
assert.equal(trigger.normalAttacks, 60);
assert.equal(trigger.retainedFirst, true);
assert.equal(trigger.speed, 300);
assert.equal(trigger.roundTrips, 7);

const noTarget = run(`(() => {
  const skill = new hn(30);
  skill.rC = { oC: true, EC: 1, general: {}, cC: {}, event() {} };
  let casts = 0;
  skill.QF = () => null;
  skill.hO = () => ({});
  skill.iO = () => { casts++; };
  for (let i = 0; i < 30; i++) skill.dC();
  return {casts, counter: skill.nC, active: skill.hC};
})()`);
assert.equal(noTarget.casts, 0);
assert.equal(noTarget.counter, 30);

const route = run(`(() => {
  const skill = new hn(30), phantom = {}, state = { oO: 5, Kg: 0 };
  skill.sO = Array.from({length: 18}, (_, x) => ({x, y: 0}));
  skill.eO = () => state;
  let enemyIndex = 5, removed = 0;
  skill.QF = () => enemyIndex == null ? null : { index: enemyIndex };
  skill.yO = enemy => enemy.index;
  skill.EO = () => 5;
  skill.JF = () => { removed++; };
  const out = [];
  skill.mO(phantom);
  out.push({phase: 'launch', next: state._m, turnAt: state.rO, dir: state.dir});
  // Arrival callbacks are the original MO, with the same path-index inputs.
  for (let round = 0; round < 7; round++) {
    state._m = state.rO; state.dir = 1;
    skill.MO(phantom, state);
    out.push({phase: 'returned', trips: state.Kg, removed});
    if (removed) break;
    enemyIndex = 3;
    state._m = 0; state.dir = -1;
    skill.MO(phantom, state);
    out.push({phase: 'retarget', turnAt: state.rO, dir: state.dir});
  }
  enemyIndex = null;
  const missingTargetFallback = skill.AO(phantom, false);
  return {out, removed, missingTargetFallback, fallbackTurnAt: state.rO};
})()`);
assert.equal(route.out[0].turnAt, 0); // First leg goes back to spawn.
assert.equal(route.out[0].next, 5);
assert.ok(route.out.filter(x => x.phase === 'retarget').every(x => x.turnAt === 3));
assert.equal(route.removed, 1);
assert.equal(route.out.filter(x => x.phase === 'returned').at(-1).trips, 7);
assert.equal(route.fallbackTurnAt, 5);

// Advance the original wO/MO/AO movement methods at 60 Hz, not a rewritten model.
const movement = run(`(() => {
  const results = [];
  for (const targetIndex of [3, 5, 17]) {
    const skill = new hn(30), state = { oO: targetIndex, Kg: 0 },
      phantom = { x: targetIndex * 80 + 40, y: 40, scale() {} };
    skill.sO = Array.from({length: 18}, (_, x) => ({x, y: 0}));
    skill.ew = { map: { aa: 80, gridHei: 80 } };
    skill.eO = () => state;
    skill.QF = () => ({index: targetIndex});
    skill.yO = enemy => enemy.index;
    skill.EO = () => Math.floor(phantom.x / 80);
    let removals = 0;
    skill.JF = p => { removals++; skill.HF.delete(p); };
    skill.mO(phantom); skill.HF.add(phantom);
    let ticks = 0, maxX = phantom.x;
    while (skill.HF.size && ticks < 12000) {
      skill.wO(1000 / 60); ticks++; maxX = Math.max(maxX, phantom.x);
    }
    results.push({targetIndex, ticks, movementSeconds: ticks / 60,
      trips: state.Kg, removals, maxX});
  }
  return results;
})()`);
for (const result of movement) {
  assert.equal(result.removals, 1);
  assert.equal(result.trips, 7);
  assert.ok(result.maxX <= result.targetIndex * 80 + 45);
}
assert.ok(movement[1].movementSeconds < movement[2].movementSeconds / 2);

console.log(JSON.stringify({ source: filename,
  sha256: crypto.createHash('sha256').update(raw).digest('hex'),
  trigger, noTarget, route, movement, assertions: 'PASS',
  limits: 'Method-level execution, not a full original-game visual or timing replay.' }, null, 2));

// Compact review excerpts with original identifiers. No decoded full bundle saved.
for (const [name, wanted] of [['Je', ['activate', 'uC', 'dC']],
  ['hn', ['onActive', 'lC', 'mO', 'AO', 'MO']], ['Ta', ['attack']]]) {
  for (const member of declarations.get(name).members) {
    if (!wanted.includes(member.name?.getText(ast))) continue;
    const source = member.getText(ast)
      .replace(/_0xc34\(\[[\d,]+\],\d+\)/g, call => String(run(call)))
      .replace(/\b(\d+)\^(\d+)\b/g, (_, a, b) => String(Number(a) ^ Number(b)))
      .replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi, (_, a, b) => String.fromCharCode(parseInt(a || b, 16)));
    console.log(`\n${name}.${member.name.getText(ast)} (original offset ${member.getStart(ast)}):\n${source}`);
  }
}
