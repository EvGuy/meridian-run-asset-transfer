import test from "node:test";
import assert from "node:assert/strict";
import { handsOf, lightOf, itemsToRelease, bestLight } from "../scripts/logic.js";
let n = 0;
const it = (name, type, o = {}) => ({ id: "i" + n++, name, type,
  system: { equipped: !!o.eq, quantity: 1, type: { value: o.sub ?? "" }, properties: new Set(o.props ?? []) },
  flags: { "meridian-hands": { heldAt: o.at, ...o.flags } } });
const names = a => a.map(i => i.name);

test("hand costs", () => {
  assert.equal(handsOf(it("Greataxe", "weapon", { props: ["two"] })), 2);
  assert.equal(handsOf(it("Longsword", "weapon", { props: ["ver"] })), 1);
  assert.equal(handsOf(it("Shield", "equipment", { sub: "shield" })), 1);
  assert.equal(handsOf(it("Studded Leather", "equipment", { sub: "light" })), 0);
  assert.equal(handsOf(it("Torch", "consumable", { sub: "trinket" })), 1);
  assert.equal(handsOf(it("Potion of Healing", "consumable", { sub: "potion" })), 0);
  assert.equal(handsOf(it("Unarmed Strike", "weapon")), 0);
  assert.equal(handsOf(it("Bite", "weapon", { sub: "natural" })), 0);
  assert.equal(handsOf({ name: "Rope", type: "loot", system: {} }), 0);
});
test("light weapons do not glow", () => {
  assert.equal(lightOf(it("Dagger", "weapon", { props: ["lgt"] })), null);
  assert.equal(lightOf(it("Studded Leather", "equipment", { sub: "light" })), null);
});
test("light presets match PHB 2024 (outer dim radius)", () => {
  const want = { "Torch": [20, 40], "Candle": [5, 10], "Lamp": [15, 45], "Hooded Lantern": [30, 60], "Bullseye Lantern": [60, 120] };
  for (const [name, [b, d]] of Object.entries(want)) {
    const l = lightOf(it(name, "consumable"));
    assert.deepEqual([l.bright, l.dim], [b, d], name);
  }
  assert.equal(lightOf(it("Torch", "consumable")).dim, 40);
  assert.equal(lightOf(it("Hooded Lantern", "consumable")).bright, 30);
  assert.equal(lightOf(it("Bullseye Lantern", "consumable")).angle, 53);
  assert.equal(lightOf(it("Torch", "consumable", { flags: { light: "none" } })), null);
  assert.equal(lightOf(it("Glowing Rock", "equipment", { flags: { light: "custom", custom: { bright: 10, dim: 25 } } })).dim, 25);
});
test("third one-hander releases the oldest, or newest by setting", () => {
  const a = it("Sword", "weapon", { eq: true, at: 1 }), b = it("Torch", "consumable", { eq: true, at: 2 });
  const c = it("Dagger", "weapon", { eq: true, at: 3 });
  assert.deepEqual(names(itemsToRelease([a, b, c], c)), ["Sword"]);
  assert.deepEqual(names(itemsToRelease([a, b, c], c, "newest")), ["Torch"]);
});
test("two-hander releases both; one-hander releases a two-hander", () => {
  const a = it("Sword", "weapon", { eq: true, at: 1 }), b = it("Torch", "consumable", { eq: true, at: 2 });
  const big = it("Greataxe", "weapon", { eq: true, at: 3, props: ["two"] });
  assert.deepEqual(names(itemsToRelease([a, b, big], big)), ["Sword", "Torch"]);
  assert.deepEqual(names(itemsToRelease([big, b], b)), ["Greataxe"]);
});
test("free hand and armor release nothing", () => {
  const a = it("Sword", "weapon", { eq: true }), s = it("Shield", "equipment", { sub: "shield", eq: true });
  const armor = it("Chain Mail", "equipment", { sub: "heavy", eq: true });
  assert.deepEqual(itemsToRelease([a, s], s), []);
  assert.deepEqual(itemsToRelease([a, s, armor], armor), []);
});
test("brightest held light wins", () => {
  const items = [it("Torch", "consumable", { eq: true }), it("Hooded Lantern", "consumable", { eq: true }), it("Bullseye Lantern", "consumable")];
  assert.equal(bestLight(items).dim, 60);
  assert.equal(bestLight([it("Torch", "consumable")]), null);
});
