import { MODULE_ID } from "./state.js";
import { migrate } from "./engine.js";

const KEY = "sequences";

export function registerSettings() {
  game.settings.register(MODULE_ID, KEY, { scope: "world", config: false, type: Object, default: {} });
}

export function getAll() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, KEY));
}

export function get(id) {
  const s = getAll()[id];
  return s ? migrate(s) : null;
}

export async function save(seq) {
  const clean = migrate(seq);
  if (!clean.id) clean.id = foundry.utils.randomID();
  clean.updatedAt = Date.now();
  if (!clean.nodes?.[clean.startNodeId]) throw new Error("startNodeId does not point at a node");
  const all = getAll();
  all[clean.id] = clean;
  await game.settings.set(MODULE_ID, KEY, all);
  return clean;
}

export async function remove(id) {
  const all = getAll();
  delete all[id];
  await game.settings.set(MODULE_ID, KEY, all);
}
