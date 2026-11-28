// Pure rules: no Foundry globals, so they can be tested with node.
export const ID = "meridian-hands";

// Distances in feet. "dim" is the outer radius (bright + extra dim).
export const PRESETS = {
  torch:    { label: "Torch",           bright: 20, dim: 40,  angle: 360, color: "#ff9329", animation: "torch" },
  candle:   { label: "Candle",          bright: 5,  dim: 10,  angle: 360, color: "#ffb04d", animation: "torch" },
  lamp:     { label: "Lamp",            bright: 15, dim: 45,  angle: 360, color: "#ffab40", animation: "torch" },
  hooded:   { label: "Hooded lantern",  bright: 30, dim: 60,  angle: 360, color: "#ffc16b", animation: "torch" },
  hoodlow:  { label: "Hooded lantern, hood lowered", bright: 0, dim: 5, angle: 360, color: "#ffc16b", animation: "torch" },
  bullseye: { label: "Bullseye lantern",bright: 60, dim: 120, angle: 53,  color: "#ffc16b", animation: "torch" }
};

const own = item => item?.flags?.[ID] ?? {};
const props = item => {
  const p = item?.system?.properties;
  return new Set(p ? Array.from(p) : []);
};
export const canBeHeld = item => typeof item?.system?.equipped === "boolean";

export function presetFromName(name = "") {
  const n = name.trim().toLowerCase().replace(/\s*\(.*\)$/, "");
  if (/bullseye lantern$/.test(n)) return "bullseye";
  if (/lantern$|^lantern of revealing$/.test(n)) return "hooded";
  if (/torch$/.test(n)) return "torch";
  if (/candle$/.test(n)) return "candle";
  if (/^lamp$/.test(n)) return "lamp";
  return null;
}

// The light an item gives when held, or null. NOT the dnd5e "lgt" weapon property.
export function lightOf(item) {
  if (!canBeHeld(item)) return null;
  const choice = own(item).light ?? "auto";
  if (choice === "none") return null;
  if (choice === "custom") {
    const c = own(item).custom ?? {};
    const bright = Math.max(0, Number(c.bright) || 0);
    const dim = Math.max(bright, Number(c.dim) || 0);
    return dim > 0 ? { bright, dim, angle: 360, color: c.color || "#ff9329", animation: "torch" } : null;
  }
  const key = choice === "auto" ? presetFromName(item.name) : choice;
  return PRESETS[key] ?? null;
}

// The Light cantrip (PHB 2024): 20 ft bright plus 20 ft dim. The table rule is 30 real minutes.
export const SPELL_LIGHT = { bright: 20, dim: 40, angle: 360, color: "#fff2cc", animation: "pulse" };
export const SPELL_MS = 30 * 60 * 1000;
export const isLightSpell = item => item?.type === "spell"
  && (item.system?.identifier === "light" || item.name?.trim().toLowerCase() === "light");
export const spellRunning = (data, now) => !!data && Number(data.expires) > now;

// The spell wins a tie with a held light of the same reach.
export const brighter = (spell, held) => (spell && (!held || spell.dim >= held.dim)) ? spell : held;

// How many hands an item takes: 0, 1 or 2.
export function handsOf(item) {
  if (!canBeHeld(item)) return 0;
  const o = own(item).hands;
  if (o !== undefined && o !== "auto") return Number(o);
  const sub = item.system?.type?.value;
  if (item.type === "weapon") {
    if (sub === "natural" || /unarmed/i.test(item.name)) return 0;
    return props(item).has("two") ? 2 : 1;
  }
  if (item.type === "equipment" && sub === "shield") return 1;
  if (item.type === "consumable" && (sub === "wand" || sub === "rod")) return 1;
  if (item.type === "equipment" && (sub === "wand" || sub === "rod")) return 1;
  return lightOf(item) ? 1 : 0;
}

// Which held items must be put away so that `incoming` fits in two hands.
export function itemsToRelease(items, incoming, order = "oldest") {
  const need = handsOf(incoming);
  if (!need) return [];
  const held = items.filter(i => i.id !== incoming.id && i.system.equipped && handsOf(i) > 0);
  const when = i => Number(own(i).heldAt) || 0;
  held.sort((a, b) => order === "newest" ? when(b) - when(a) : when(a) - when(b));
  let used = held.reduce((n, i) => n + handsOf(i), 0);
  const out = [];
  while (held.length && used + need > 2) {
    const i = held.shift();
    used -= handsOf(i);
    out.push(i);
  }
  return out;
}

// The brightest light among held items.
export function bestLight(items) {
  let best = null;
  for (const i of items) {
    if (!i.system?.equipped || i.system?.quantity === 0) continue;
    const l = lightOf(i);
    if (l && (!best || l.dim > best.dim)) best = l;
  }
  return best;
}
