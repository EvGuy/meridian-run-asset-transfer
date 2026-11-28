/** Pure rules, no UI. */
export const MOD = "meridian-coin-lock";

const num = (v) => Number(v) || 0;

/** True if an update would alter any coin count. */
export function changesCurrency(current = {}, incoming) {
  return Object.entries(incoming ?? {}).some(([k, v]) => num(v) !== num(current[k]));
}

/** The exact result of dnd5e's Convert button, or null if it can't be computed. */
export function converted(current, config) {
  const list = Object.entries(config).filter(([, c]) => c.conversion)
    .sort((a, b) => a[1].conversion - b[1].conversion);
  if (!list.length) return null;
  const smallest = list.at(-1)[1].conversion;
  let amount = list.reduce((n, [d, c]) => n + num(current[d]) * (smallest / c.conversion), 0);
  const out = { ...current };
  for (const [d, c] of list) {
    const ratio = smallest / c.conversion;
    out[d] = Math.floor(amount / ratio);
    amount -= out[d] * ratio;
  }
  return out;
}

/** A player write is allowed only if it changes nothing, or is exactly a Convert. */
export function playerMayWrite(current, incoming, config) {
  if (!changesCurrency(current, incoming)) return true;
  const target = converted(current, config);
  if (!target) return false;
  const next = { ...current, ...incoming };
  return Object.keys(next).every((k) => num(next[k]) === num(target[k]));
}

export const pileData = (actor) => actor?.flags?.["item-piles"]?.data ?? null;

export const isParty = (actor, partyId) => !!actor && !actor.isToken && actor.id === partyId;

export function isPlayerCharacter(actor, users, partyId) {
  if (actor?.type !== "character" || isParty(actor, partyId) || pileData(actor)?.enabled) return false;
  return users.some((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
}

/** An unlocked Item Piles loot pile or chest that this player can actually get at. Never a merchant. */
export function isOpenLoot(actor, user) {
  const d = pileData(actor);
  if (!d?.enabled || d.locked) return false;
  if (!["pile", "container", undefined].includes(d.type)) return false;
  const token = actor.token;
  if (token) return !token.hidden && token.parent?.id === user.viewedScene;
  return actor.testUserPermission(user, "OBSERVER");
}

export function canTakeFrom(actor, user, users, partyId) {
  if (!actor) return false;
  if (user.isGM) return true;
  if (isParty(actor, partyId)) return actor.testUserPermission(user, "OBSERVER");
  if (isPlayerCharacter(actor, users, partyId)) return actor.testUserPermission(user, "OWNER");
  return isOpenLoot(actor, user);
}

export function canGiveTo(actor, user, users, partyId) {
  if (!actor) return false;
  if (user.isGM) return true;
  return isParty(actor, partyId) || isPlayerCharacter(actor, users, partyId);
}

/** Returns a refusal reason, or null if the move is legal. */
export function checkMove({ source, target, denom, amount, user, users, partyId }) {
  if (!source?.system?.currency || !target?.system?.currency) return "That can't hold coins.";
  if (source.uuid === target.uuid) return "Those coins are already there.";
  if (!Object.hasOwn(source.system.currency, denom) || !Object.hasOwn(target.system.currency, denom)) return "Unknown coin.";
  if (!Number.isSafeInteger(amount) || amount < 1) return "Enter a whole number of 1 or more.";
  if (!canTakeFrom(source, user, users, partyId)) return "You can't take coins from there.";
  if (!canGiveTo(target, user, users, partyId)) return "Coins can only go to a player character or party loot.";
  if (amount > num(source.system.currency[denom])) return "There aren't that many coins there.";
  return null;
}

/** Take from source, give to target; puts the coins back if the second write fails. */
export async function applyMove(source, target, denom, amount) {
  const path = `system.currency.${denom}`;
  const had = num(source.system.currency[denom]);
  await source.update({ [path]: had - amount });
  try {
    await target.update({ [path]: num(target.system.currency[denom]) + amount });
  } catch (err) {
    await source.update({ [path]: had });
    throw err;
  }
}
