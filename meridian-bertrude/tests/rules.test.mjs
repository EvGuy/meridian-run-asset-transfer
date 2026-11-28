import test from "node:test";
import assert from "node:assert/strict";
import * as r from "../scripts/rules.js";
import { VOICES, pickVoice, line } from "../scripts/voices.js";
const item = (o = {}) => ({ type: "loot", system: { quantity: 1, weight: { value: 10, units: "lb" }, ...o } });

test("weight counts stacks and converts kg", () => {
  assert.equal(r.totalWeight([item({ quantity: 3 })]), 30);
  assert.ok(Math.abs(r.itemWeight(item({ weight: { value: 1, units: "kg" } })) - 2.2046) < 1e-6);
});
test("300 lb is allowed, anything over is refused; held items count", () => {
  const held = { ...item({ weight: { value: 290 } }), flags: { [r.MOD]: { held: {} } } };
  assert.equal(r.checkFits([held], item(), 1, 300), null);
  assert.match(r.checkFits([held], item({ weight: { value: 10.5 } }), 1, 300), /full/);
});
test("containers, bad quantities and identified items are refused", () => {
  assert.ok(r.checkMovable({ type: "container", system: {} }, 1));
  for (const q of [0, -1, 1.5, 2]) assert.ok(r.checkMovable(item(), q));
  assert.ok(r.checkFeed(item({ identified: true })));
  assert.equal(r.checkFeed(item({ identified: false })), null);
});
test("one try per item per day", () => {
  assert.ok(r.canPersuade({ lastTry: 4 }, 4));
  assert.equal(r.canPersuade({ lastTry: 4 }, 5), null);
  assert.ok(r.canPersuade(null, 5));
  assert.equal(r.dayNumber(86400 * 2 + 5, 1), 3);
});
test("success releases; third failed day is the pity release", () => {
  assert.equal(r.resolveAttempt({ fails: 0 }, { total: 13, dc: 13, day: 1 }).released, true);
  const a = r.resolveAttempt({ fails: 0 }, { total: 1, dc: 13, day: 1 });
  const b = r.resolveAttempt(a.held, { total: 1, dc: 13, day: 2 });
  const c = r.resolveAttempt(b.held, { total: 1, dc: 13, day: 3 });
  assert.deepEqual([a.released, b.released, c.released, c.pity], [false, false, true, true]);
});
test("every voice has every line; Hinge is rarest", () => {
  for (const v of Object.keys(VOICES)) for (const k of ["greet","store","hold","refuse","release"]) assert.ok(line(v, k, 0.99).text);
  assert.deepEqual([pickVoice(0.1), pickVoice(0.7), pickVoice(0.9)], ["berty","lady","hinge"]);
});
