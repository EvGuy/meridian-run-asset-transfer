/** Pure rules, no Foundry globals. */
export const MOD = "meridian-bertrude";
export const PITY_AT = 3;
const PHYSICAL = ["weapon", "equipment", "consumable", "tool", "loot"];

export const heldData = (item) => item?.flags?.[MOD]?.held ?? null;

/** Pounds for a whole stack. Coins are never items, so they never count. */
export function itemWeight(item, quantity = item.system?.quantity ?? 1) {
  const w = item.system?.weight;
  const each = Number(typeof w === "object" ? w?.value : w) || 0;
  const lb = w?.units === "kg" ? each * 2.2046 : each;
  return lb * quantity;
}

export const totalWeight = (items) => [...items].reduce((n, i) => n + itemWeight(i), 0);

export function checkMovable(item, quantity) {
  if (!item) return "That item isn't there any more.";
  if (item.type === "container") return "No bags inside the chest. Take the things out first.";
  if (!PHYSICAL.includes(item.type)) return "That isn't something he can hold.";
  const have = item.system?.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > have) return "There aren't that many.";
  return null;
}

export function checkFits(chestItems, item, quantity, limit) {
  const after = totalWeight(chestItems) + itemWeight(item, quantity);
  return after > limit + 1e-9 ? "I'm *full*. Do you want me to split a hinge?" : null;
}

export function checkFeed(item) {
  if (item?.system?.identified !== false) return "He only tastes unidentified magic items.";
  return null;
}

export const dayNumber = (worldTime, offset = 0) => Math.floor(worldTime / 86400) + offset;

export function canPersuade(held, day) {
  if (!held) return "He isn't holding that one.";
  if (held.lastTry === day) return "You've had your one try for this item today.";
  return null;
}

/** Result of one attempt. The third failed day releases the item anyway. */
export function resolveAttempt(held, { total, dc, day }) {
  if (total >= dc) return { released: true, pity: false, held: null };
  const fails = (held.fails ?? 0) + 1;
  if (fails >= PITY_AT) return { released: true, pity: true, held: null };
  return { released: false, pity: false, held: { fails, lastTry: day } };
}
