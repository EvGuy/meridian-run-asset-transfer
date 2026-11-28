// Cast, recast and expiry against minimal Foundry mocks.
import test from "node:test";
import assert from "node:assert/strict";
const hooks = {}, chat = [];
let handler, now = 1000, choice = "self";
Date.now = () => now;
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f), off() {} };
globalThis.setInterval = () => 0;
globalThis.socketlib = { registerModule: () => ({ register: (n, f) => (handler = f),
  executeAsGM: (n, a) => handler.call({ socketdata: { userId: "p" } }, a) }) };
globalThis.foundry = { utils: { escapeHTML: s => s }, applications: { api: { DialogV2: { wait: async () => choice } } } };
globalThis.ChatMessage = { create: async m => chat.push(m.content), getSpeaker: () => ({}) };
globalThis.ui = { notifications: { info() {}, warn(m) { chat.push("WARN " + m); }, error() {} } };
const lights = [];
const scene = { id: "s", lights: Object.assign(lights, { get: id => lights.find(l => l.id === id) }), tokens: [],
  async createEmbeddedDocuments(t, d) { lights.push({ id: "L" + Math.random(), ...d[0] }); },
  async deleteEmbeddedDocuments(t, ids) { for (const id of ids) lights.splice(lights.findIndex(l => l.id === id), 1); } };
const flags = {};
let owner = true;
const actor = { uuid: "Actor.a", name: "Dorf", getFlag: (m, k) => flags[k], async setFlag(m, k, v) { flags[k] = v; },
  async unsetFlag(m, k) { delete flags[k]; }, testUserPermission: () => owner };
globalThis.fromUuid = async () => actor;
const scenes = Object.assign([scene], { contents: [scene], get: () => scene });
globalThis.game = { scenes, actors: [actor], user: { id: "gm" }, users: { get: () => ({ id: "p" }), activeGM: { isSelf: true } } };
const { registerSpell, selfSpell, sweepSpells } = await import("../scripts/spell.js");
let syncs = 0;
registerSpell(async () => syncs++);
hooks["socketlib.ready"][0]();
const wait = () => new Promise(r => setTimeout(r, 20));
const cast = async () => { assert.equal(hooks["dnd5e.preUseActivity"][0]({ item: { type: "spell", name: "Light", system: {}, actor } }), false); await wait(); };

test("self cast lasts 30 minutes, then goes out", async () => {
  await cast();
  assert.ok(selfSpell(actor));
  now += 30 * 60 * 1000 - 1; await sweepSpells(); assert.ok(flags.spell);
  now += 1; await sweepSpells();
  assert.equal(flags.spell, undefined);
  assert.match(chat.at(-1), /goes out/);
});
test("a spot cast places one light; casting again replaces it", async () => {
  await handler.call({ socketdata: { userId: "p" } }, { actorUuid: "Actor.a", spot: { sceneId: "s", x: 10, y: 20 } });
  await handler.call({ socketdata: { userId: "p" } }, { actorUuid: "Actor.a", spot: { sceneId: "s", x: 30, y: 40 } });
  assert.equal(lights.length, 1);
  assert.deepEqual([lights[0].x, lights[0].config.bright, lights[0].config.dim], [30, 20, 40]);
  await cast();
  assert.equal(lights.length, 0);
  assert.ok(flags.spell);
});
test("a user who does not own the caster is refused; other spells are left alone", async () => {
  owner = false;
  const r = await handler.call({ socketdata: { userId: "p" } }, { actorUuid: "Actor.a", spot: null });
  assert.equal(r.ok, false);
  assert.equal(hooks["dnd5e.preUseActivity"][0]({ item: { type: "spell", name: "Fire Bolt", system: {}, actor } }), undefined);
});
