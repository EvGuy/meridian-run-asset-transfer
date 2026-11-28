import { MOD, changesCurrency, playerMayWrite, canTakeFrom, canGiveTo, isPlayerCharacter, checkMove, applyMove } from "./rules.js";

const QUERY = `${MOD}.move`;
const DRAG = "meridian-coin";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const setting = (k) => game.settings.get(MOD, k);
const partyId = () => game.actors.get(setting("partyActor"))?.id ?? game.actors.getName(setting("partyActor"))?.id ?? null;

function warnLocked() {
  ui.notifications.warn("Coins are locked. Drag them from the coin bar, or use a store or loot window.");
}

/* ---------- The lock (runs in the browser that starts the write) ---------- */
function incomingCurrency(changes) {
  const sys = changes.system ?? changes["==system"];
  return { sys, coins: sys?.currency ?? sys?.["==currency"] };
}

function guardUpdate(doc, changes) {
  if (game.user.isGM || !setting("enabled")) return;
  const { sys, coins } = incomingCurrency(changes);
  const wipes = sys && ("currency" in sys) && sys.currency === null || sys && "-=currency" in sys;
  if (!coins && !wipes) return;
  if (!wipes && playerMayWrite(doc.system.currency, coins, CONFIG.DND5E.currencies)) return;
  // Drop only the coin part so the rest of the edit still saves.
  delete sys.currency; delete sys["==currency"]; delete sys["-=currency"];
  if (changes["==system"]) sys.currency = foundry.utils.deepClone(doc._source.system.currency);
  warnLocked();
  setTimeout(() => doc.sheet?.rendered && doc.sheet.render(false), 50);
}

function guardCreate(item) {
  if (game.user.isGM || !setting("enabled") || !item.parent) return;
  if (Object.values(item.system?.currency ?? {}).some((v) => Number(v) > 0)) {
    ui.notifications.warn("That container has coins in it, so it can't be copied or moved this way. Ask the GM.");
    return false;
  }
}

/* ---------- Moves (run on the active GM, one at a time) ---------- */
let queue = Promise.resolve();

function performMove(data) {
  const run = queue.then(() => doMove(data));
  queue = run.catch(() => {});
  return run;
}

async function doMove({ sourceUuid, targetUuid, denom, amount, userId }) {
  const user = game.users.get(userId);
  const source = await fromUuid(sourceUuid), target = await fromUuid(targetUuid);
  if (!user) return { ok: false, reason: "Unknown player." };
  if (!user.isGM && game.paused) return { ok: false, reason: "The game is paused." };
  const reason = checkMove({ source, target, denom, amount, user, users: [...game.users], partyId: partyId() });
  if (reason) return { ok: false, reason };
  await applyMove(source, target, denom, amount);
  await tellGM(`<strong>${esc(user.name)}</strong> moved ${amount} ${esc(denom)}: ${esc(source.name)} → ${esc(target.name)}`);
  return { ok: true };
}

const tellGM = (content) => ChatMessage.create({
  content, whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id), speaker: { alias: "Coin Ledger" }
});

async function askAmount(source, target, denom) {
  const max = Number(source.system.currency[denom]) || 0;
  if (max < 1) return null;
  const value = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Move coins" },
    content: `<p>${esc(source.name)} → ${esc(target.name)}</p>
      <div class="form-group"><label>${esc(denom)} (up to ${max})</label>
      <input type="number" name="amount" min="1" max="${max}" step="1" value="${max}" autofocus></div>`,
    ok: { label: "Move", callback: (ev, button) => button.form.elements.amount.valueAsNumber },
    rejectClose: false
  });
  return Number.isFinite(value) ? value : null;
}

async function handleDrop(drag, target) {
  const source = await fromUuid(drag.sourceUuid);
  if (!source || !target || source.uuid === target.uuid) return;
  if (!canGiveTo(target, game.user, [...game.users], partyId())) {
    return ui.notifications.warn("Coins can only go to a player character or party loot.");
  }
  const amount = await askAmount(source, target, drag.denom);
  if (amount === null) return;
  const data = { sourceUuid: source.uuid, targetUuid: target.uuid, denom: drag.denom, amount, userId: game.user.id };
  let result;
  try {
    if (game.user.isActiveGM) result = await performMove(data);
    else {
      const gm = game.users.activeGM;
      if (!gm) return ui.notifications.warn("The GM needs to be connected to move coins.");
      result = await gm.query(QUERY, data, { timeout: 15000 });
    }
  } catch (err) {
    console.error(MOD, err);
    return ui.notifications.error("The move may not have finished. Check both coin totals with the GM.");
  }
  if (!result?.ok) ui.notifications.warn(result?.reason ?? "That didn't work.");
}

const readDrag = (event) => {
  try {
    const d = JSON.parse(event.dataTransfer.getData("text/plain"));
    return d?.type === DRAG ? d : null;
  } catch { return null; }
};

/* ---------- Coin bar on character, party and loot windows ---------- */
function windowActor(app) {
  const name = app.constructor.name;
  if (/Merchant|Dialog|Manager|Config|Settings/i.test(name)) return null;
  if (!/Sheet|ItemPile/i.test(name)) return null;
  const actor = app.actor ?? app.document ?? app.options?.svelte?.props?.actor;
  if (actor?.documentName !== "Actor" || !actor.system?.currency) return null;
  return actor;
}

function buildBar(actor) {
  const bar = document.createElement("div");
  bar.className = "mcl-bar";
  bar.dataset.actorUuid = actor.uuid;
  const takeable = canTakeFrom(actor, game.user, [...game.users], partyId());
  if (!takeable) return null;
  const label = document.createElement("span");
  label.textContent = "Drag coins:";
  bar.append(label);
  for (const denom of Object.keys(CONFIG.DND5E.currencies)) {
    const count = Number(actor.system.currency[denom]) || 0;
    const chip = document.createElement("span");
    chip.className = "mcl-coin";
    chip.textContent = `${count} ${denom}`;
    chip.draggable = count > 0;
    if (!count) chip.classList.add("mcl-empty");
    chip.addEventListener("dragstart", (ev) => {
      ev.stopPropagation();
      ev.dataTransfer.setData("text/plain", JSON.stringify({ type: DRAG, sourceUuid: actor.uuid, denom }));
    });
    bar.append(chip);
  }
  // Players can't open each other's sheets, so give them name tags to drop coins on.
  const users = [...game.users], pid = partyId();
  const others = game.actors.filter((a) => a.id !== actor.id && (a.id === pid || isPlayerCharacter(a, users, pid)));
  if (others.length) {
    const to = document.createElement("span");
    to.textContent = "Drop on:";
    bar.append(to);
    for (const other of others) {
      const tag = document.createElement("span");
      tag.className = "mcl-target";
      tag.textContent = other.name;
      tag.dataset.mclTarget = other.uuid;
      bar.append(tag);
    }
  }
  return bar;
}

const openWindows = new Map(); // app -> actor

function decorate(app, html) {
  if (!setting("enabled")) return;
  const actor = windowActor(app);
  if (!actor) return;
  const el = app.element instanceof HTMLElement ? app.element : app.element?.[0] ?? html?.[0] ?? html;
  if (!el?.querySelector) return;
  openWindows.set(app, actor);
  el.querySelector(":scope > .mcl-bar")?.remove();
  const bar = buildBar(actor);
  const content = el.querySelector(":scope > .window-content");
  if (bar) content ? el.insertBefore(bar, content) : el.prepend(bar);
  if (el.dataset.mclDrop) return;
  el.dataset.mclDrop = "1";
  // Capture phase, so the sheet's own drop handler never sees a coin.
  el.addEventListener("drop", async (ev) => {
    const drag = readDrag(ev);
    if (!drag) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const tag = ev.target.closest?.("[data-mcl-target]");
    handleDrop(drag, tag ? await fromUuid(tag.dataset.mclTarget) : openWindows.get(app));
  }, true);
  el.addEventListener("dragover", (ev) => ev.preventDefault());
}

function refreshBars(actor) {
  for (const [app, a] of openWindows) {
    if (!app.rendered) openWindows.delete(app);
    else if (a.uuid === actor.uuid) decorate(app);
  }
}

/* ---------- GM backstop: report any coin change made from a player's browser ---------- */
const ledger = new Map();
const snapshot = (doc) => foundry.utils.deepClone(doc.system?.currency ?? null);

function seedLedger() {
  for (const a of game.actors) {
    ledger.set(a.uuid, snapshot(a));
    for (const i of a.items) if (i.system?.currency) ledger.set(i.uuid, snapshot(i));
  }
  for (const s of game.scenes) for (const t of s.tokens) {
    if (!t.actorLink && t.actor) ledger.set(t.actor.uuid, snapshot(t.actor));
  }
}

function audit(doc, changes, options, userId) {
  const { coins } = incomingCurrency(changes);
  if (!coins) return;
  const before = ledger.get(doc.uuid);
  const after = snapshot(doc);
  ledger.set(doc.uuid, after);
  if (!game.user.isActiveGM || !setting("enabled") || game.users.get(userId)?.isGM) return;
  if (before && playerMayWrite(before, after, CONFIG.DND5E.currencies)) return;
  const show = (c) => c ? Object.entries(c).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(", ") || "none" : "unknown";
  tellGM(`<strong>Check this:</strong> ${esc(game.users.get(userId)?.name)}'s browser changed coins on
    ${esc(doc.name)}.<br>Before: ${esc(show(before))}<br>After: ${esc(show(after))}`);
}

Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(MOD, key, { scope: "world", config: true, ...data });
  reg("enabled", { name: "Lock player coins", type: Boolean, default: true, requiresReload: true });
  reg("partyActor", { name: "Party loot actor (name or id)", type: String, default: "Party" });
  reg("disableTrading", {
    name: "Turn off Item Piles player trading", type: Boolean, default: true, requiresReload: true,
    hint: "Item Piles writes trade coins from the player's browser, which the lock blocks, so a trade could finish without payment."
  });
  CONFIG.queries[QUERY] = performMove;

  Hooks.on("preUpdateActor", guardUpdate);
  Hooks.on("preUpdateItem", guardUpdate);
  Hooks.on("preCreateItem", guardCreate);
  Hooks.on("updateActor", (doc, changes, options, userId) => {
    audit(doc, changes, options, userId);
    if (incomingCurrency(changes).coins) refreshBars(doc);
  });
  Hooks.on("updateItem", audit);
  Hooks.on("renderApplicationV2", decorate);
  Hooks.on("renderApplication", decorate);
  Hooks.on("renderApplicationV1", decorate);
  Hooks.on("closeApplicationV2", (app) => openWindows.delete(app));
  Hooks.on("closeApplication", (app) => openWindows.delete(app));

  // Dropping a coin on a token (for example the Party Loot Chest) also works.
  Hooks.on("dropCanvasData", (cv, data) => {
    if (data?.type !== DRAG) return;
    const token = cv.tokens.placeables.find((t) => t.visible && t.bounds.contains(data.x, data.y));
    if (token?.actor) handleDrop(data, token.actor);
    return false;
  });
});

Hooks.once("ready", async () => {
  seedLedger();
  if (!game.user.isGM) document.body.classList.toggle("mcl-locked", setting("enabled"));
  if (game.user.isActiveGM && setting("enabled") && setting("disableTrading") && game.modules.get("item-piles")?.active) {
    if (game.settings.get("item-piles", "enableTrading")) await game.settings.set("item-piles", "enableTrading", false);
  }
  game.modules.get(MOD).api = { move: performMove };
});

// Read-only look for players on any sheet that names its coin fields.
const COIN_FIELDS = 'input[name^="system.currency."], input[data-tidy-field^="system.currency."]';
document.addEventListener("focusin", (ev) => {
  if (document.body.classList.contains("mcl-locked") && ev.target.matches?.(COIN_FIELDS)) ev.target.readOnly = true;
}, true);
