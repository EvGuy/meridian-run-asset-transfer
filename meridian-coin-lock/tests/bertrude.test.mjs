import test from "node:test";
import assert from "node:assert/strict";
import { checkMove } from "../scripts/rules.js";
const user = { isGM: false };
const pc = { id: "pc", type: "character", system: { currency: { gp: 10 } }, testUserPermission: () => true, uuid: "A", flags: {} };
const box = (revealed) => ({ id: "box", uuid: "B", type: "npc", system: { currency: { gp: 5 } }, testUserPermission: () => false,
  flags: { "meridian-bertrude": { isChest: true, revealed } } });
const move = (source, target) => checkMove({ source, target, denom: "gp", amount: 5, user, users: [user], partyId: "p" });
test("revealed Bertrude takes and gives coins", () => {
  assert.equal(move(pc, box(true)), null);
  assert.equal(move(box(true), pc), null);
});
test("hidden Bertrude does neither", () => {
  assert.ok(move(pc, box(false)));
  assert.ok(move(box(false), pc));
});
