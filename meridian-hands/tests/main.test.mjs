// Runs main.js against minimal Foundry mocks. This does not replace an in-game test.
import test from "node:test";
import assert from "node:assert/strict";
const hooks = {}, settings = {}, prompts = [];
globalThis.Hooks = { on: (n, f) => (hooks[n] ??= []).push(f), once: (n, f) => (hooks[n] ??= []).push(f) };
const get = (o, p) => p.split(".").reduce((x, k) => x?.[k], o);
globalThis.foundry = {
  utils: { getProperty: get, escapeHTML: s => s, setProperty() {} },
  applications: { api: { DialogV2: { prompt: o => prompts.push(o) } } }
};
globalThis.game = { user: { id: "u" }, users: { activeGM: null }, actors: [], scenes: Object.assign([], { contents: [] }),
  settings: { register: (m, k, o) => (settings[k] = o.default), get: (m, k) => settings[k] } };
globalThis.ui = { notifications: { info() {} } };
await import("../scripts/main.js");
hooks.init[0]();

const token = { actorId: "a", actorLink: true, flags: {}, light: { bright: 0, dim: 0, toObject() { return { bright: 0, dim: 0 }; } },
  getFlag(m, k) { return this.flags[k]; }, async unsetFlag(m, k) { delete this.flags[k]; },
  async update(u) { if (u.light) this.light = { ...u.light, toObject() { return { ...this }; } };
    if (u["flags.meridian-hands.baseLight"]) this.flags.baseLight = u["flags.meridian-hands.baseLight"]; } };
game.scenes.contents.push({ tokens: [token] });
const mk = (id, name, type, eq) => ({ id, name, type, flags: {}, system: { equipped: eq, quantity: 1, type: {}, properties: new Set() } });
const items = [mk("1", "Club", "weapon", true), mk("2", "Dagger", "weapon", true), mk("3", "Torch", "consumable", true)];
const actor = { id: "a", uuid: "Actor.a", name: "Dorf", type: "character", isOwner: true, items,
  async updateEmbeddedDocuments(t, ups) { for (const u of ups) items.find(i => i.id === u._id).system.equipped = u["system.equipped"]; } };
items.forEach(i => (i.actor = actor));
const wait = () => new Promise(r => setTimeout(r, 20));

test("equip torch with full hands, then stow it", async () => {
  await hooks.updateItem[0](items[2], { system: { equipped: true } }, {}, "u"); await wait();
  assert.equal(items.filter(i => i.system.equipped).length, 2);
  assert.equal(token.light.dim, 40);
  items[2].system.equipped = false;
  await hooks.updateItem[0](items[2], { system: { equipped: false } }, {}, "u"); await wait();
  assert.equal(token.light.dim, 0);
  assert.equal(token.flags.baseLight, undefined);
});
test("using an item that is not held is blocked with a prompt", () => {
  const use = hooks["dnd5e.preUseActivity"][0];
  assert.equal(use({ item: items[2] }), false);
  assert.match(prompts[0].content, /You aren't holding this item/);
  items[2].system.equipped = true;
  assert.equal(use({ item: items[2] }), undefined);
  actor.type = "npc"; items[2].system.equipped = false;
  assert.equal(use({ item: items[2] }), undefined);
});
