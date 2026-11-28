import { ID, PRESETS, canBeHeld, handsOf, itemsToRelease, bestLight, brighter } from "./logic.js";
import { registerSpell, selfSpell, sweepSpells } from "./spell.js";

const setting = k => game.settings.get(ID, k);
const limitApplies = actor => actor?.type === "character" && setting("enforceHands");

Hooks.once("init", () => {
  const reg = (key, name, hint, extra) =>
    game.settings.register(ID, key, { name, hint, scope: "world", config: true, ...extra });
  reg("enforceHands", "Two-hand limit", "Player characters can hold two hands' worth of items.",
    { type: Boolean, default: true });
  reg("release", "When hands are full", "Which held item is put away first.",
    { type: String, default: "oldest", choices: { oldest: "Put away the one held longest", newest: "Put away the one picked up most recently" } });
  reg("lights", "Held lights glow", "Tokens give off light while a light source is held.",
    { type: Boolean, default: true, onChange: () => syncAll() });
});

/* ---------- Hands ---------- */

Hooks.on("preUpdateItem", (item, changes) => {
  if (foundry.utils.getProperty(changes, "system.equipped") === true && !item.system.equipped) {
    foundry.utils.setProperty(changes, `flags.${ID}.heldAt`, Date.now());
  }
});

// Runs only on the client that made the change, which has permission on the actor.
Hooks.on("updateItem", async (item, changes, options, userId) => {
  const actor = item.actor;
  if (!actor) return;
  const equipped = foundry.utils.getProperty(changes, "system.equipped");
  if (userId === game.user.id && equipped === true && limitApplies(actor)) {
    const release = itemsToRelease(Array.from(actor.items), item, setting("release"));
    if (release.length) {
      await actor.updateEmbeddedDocuments("Item", release.map(i => ({ _id: i.id, "system.equipped": false })));
      ui.notifications.info(`${actor.name} puts away ${release.map(i => i.name).join(" and ")} to hold ${item.name}.`);
    }
  }
  queueSync(actor);
});

Hooks.on("dnd5e.preUseActivity", activity => {
  const item = activity?.item;
  if (!item || !limitApplies(item.actor)) return;
  if (!handsOf(item) || item.system.equipped) return;
  const name = foundry.utils.escapeHTML(item.name);
  foundry.applications.api.DialogV2.prompt({
    window: { title: "Not in hand" },
    position: { width: 420 },
    content: `<p>You aren't holding this item.</p><p><strong>${name}</strong></p>`,
    ok: { label: "OK" },
    rejectClose: false
  });
  return false;
});

/* ---------- Light ---------- */

const queues = new Map();
function queueSync(actor) {
  // One GM client writes the tokens. With no GM online, the owner who is first in line does it.
  const gm = game.users.activeGM;
  if (gm ? gm.id !== game.user.id : !actor.isOwner) return;
  const prev = queues.get(actor.uuid) ?? Promise.resolve();
  const next = prev.then(() => syncActor(actor)).catch(e => console.error(`${ID} |`, e));
  queues.set(actor.uuid, next);
  return next;
}

function tokensOf(actor) {
  if (actor.isToken) return [actor.token];
  return game.scenes.contents.flatMap(s => s.tokens.filter(t => t.actorLink && t.actorId === actor.id));
}

async function syncActor(actor) {
  const held = setting("lights") ? bestLight(Array.from(actor.items)) : null;
  const light = brighter(selfSpell(actor), held);
  for (const token of tokensOf(actor)) await syncToken(token, light);
}

async function syncToken(token, light) {
  const saved = token.getFlag(ID, "baseLight");
  if (light) {
    const want = {
      bright: light.bright, dim: light.dim, angle: light.angle, color: light.color,
      alpha: 0.25, animation: { type: light.animation, speed: 3, intensity: 3 }
    };
    const update = { light: want };
    if (!saved) update[`flags.${ID}.baseLight`] = token.light.toObject();
    const now = token.light;
    if (saved && now.bright === want.bright && now.dim === want.dim && now.angle === want.angle
      && String(now.color) === want.color && now.animation?.type === want.animation.type) return;
    await token.update(update);
  } else if (saved) {
    // Put back whatever light the token had before.
    await token.update({ light: saved });
    await token.unsetFlag(ID, "baseLight");
  }
}

function syncAll() {
  if (!game.users.activeGM?.isSelf) return;
  const actors = new Map();
  for (const a of game.actors) actors.set(a.uuid, a);
  for (const s of game.scenes) for (const t of s.tokens) if (t.actor) actors.set(t.actor.uuid, t.actor);
  for (const a of actors.values()) {
    // Only touch actors that hold a light now, or whose token still carries one from us.
    if (selfSpell(a) || bestLight(Array.from(a.items)) || tokensOf(a).some(t => t.getFlag(ID, "baseLight"))) queueSync(a);
  }
}

Hooks.once("ready", () => { syncAll(); sweepSpells(queueSync); });
registerSpell(queueSync);
Hooks.on("createItem", item => item.actor && queueSync(item.actor));
Hooks.on("deleteItem", item => item.actor && queueSync(item.actor));
Hooks.on("createToken", token => {
  const a = token.actor;
  if (a && (selfSpell(a) || bestLight(Array.from(a.items)) || token.getFlag(ID, "baseLight"))) queueSync(a);
});

/* ---------- GM item settings ---------- */

Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {
  const item = app.document;
  if (!game.user.isGM || item?.documentName !== "Item" || !canBeHeld(item)) return;
  controls.push({ action: "meridianHands", icon: "fa-solid fa-fire", label: "Hands & Light", onClick: () => configure(item) });
});

async function configure(item) {
  const f = item.flags?.[ID] ?? {};
  const c = f.custom ?? {};
  const opts = (list, current) => list.map(([v, l]) =>
    `<option value="${v}" ${String(current) === v ? "selected" : ""}>${l}</option>`).join("");
  const lightChoices = [["auto", "Automatic (by item name)"], ["none", "No light"],
    ...Object.entries(PRESETS).map(([k, p]) => [k, `${p.label} (${p.bright} / ${p.dim} ft)`]),
    ["custom", "Custom (values below)"]];
  const handChoices = [["auto", "Automatic"], ["0", "Does not use a hand"], ["1", "One hand"], ["2", "Two hands"]];
  const row = (label, control) => `<div class="form-group"><label>${label}</label><div class="form-fields">${control}</div></div>`;
  const content =
    row("Light source", `<select name="light">${opts(lightChoices, f.light ?? "auto")}</select>`) +
    row("Hands", `<select name="hands">${opts(handChoices, f.hands ?? "auto")}</select>`) +
    row("Custom bright (ft)", `<input type="number" name="bright" min="0" value="${Number(c.bright) || 20}">`) +
    row("Custom outer dim (ft)", `<input type="number" name="dim" min="0" value="${Number(c.dim) || 40}">`) +
    row("Custom color", `<input type="color" name="color" value="${/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#ff9329"}">`);
  const data = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Hands & Light" },
    position: { width: 500 },
    content,
    ok: { label: "Save", callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object },
    rejectClose: false
  });
  if (!data) return;
  await item.update({ [`flags.${ID}`]: {
    light: data.light, hands: data.hands,
    custom: { bright: data.bright, dim: data.dim, color: data.color }
  } });
  if (item.actor) queueSync(item.actor);
}
