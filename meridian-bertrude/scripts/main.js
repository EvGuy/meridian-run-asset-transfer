import { MOD, heldData, totalWeight, checkMovable, checkFits, checkFeed, dayNumber, canPersuade, resolveAttempt } from "./rules.js";
import { pickVoice, line } from "./voices.js";

const QUERY = `${MOD}.act`;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const get = (k) => game.settings.get(MOD, k);
const chest = () => game.actors.find((a) => a.getFlag(MOD, "isChest")) ?? null;
const revealed = () => !!chest()?.getFlag(MOD, "revealed");
const today = () => dayNumber(game.time.worldTime, get("dayOffset"));

async function say(kind, extra = "") {
  const l = line(pickVoice(), kind);
  await ChatMessage.create({ speaker: { alias: l.speaker }, content: `<p><em>${esc(l.text)}</em></p>${extra}` });
}

/* ---------- Actions: always run on the active GM, one at a time ---------- */
let queue = Promise.resolve();
function perform(data) {
  // userId comes from the calling browser (same trust level as Coin Lock).
  const run = queue.then(() => act(data));
  queue = run.catch(() => {});
  return run;
}
const no = (reason) => ({ ok: false, reason });

async function move(item, to, quantity, flags) {
  const data = item.toObject();
  delete data._id;
  data.system.quantity = quantity;
  data.system.equipped &&= false;
  data.system.attuned &&= false;
  delete data.system.container;
  delete data.flags?.[MOD];
  if (flags) foundry.utils.setProperty(data, `flags.${MOD}`, flags);
  const [made] = await to.createEmbeddedDocuments("Item", [data]);
  try {
    const left = (item.system.quantity ?? 1) - quantity;
    if (left > 0) await item.update({ "system.quantity": left });
    else await item.delete();
  } catch (err) {
    await made.delete();
    throw err;
  }
  return made;
}

async function act({ type, actorId, itemId, quantity = 1, userId }) {
  const user = game.users.get(userId), box = chest(), pc = game.actors.get(actorId);
  if (!user || !box) return no("Bertrude isn't available.");
  if (!user.isGM && !revealed()) return no("Bertrude isn't available.");
  if (!user.isGM && game.paused) return no("The game is paused.");
  if (!pc || pc === box || !pc.testUserPermission(user, "OWNER")) return no("Pick one of your own characters.");

  if (type === "store" || type === "feed") {
    const item = pc.items.get(itemId);
    const qty = type === "feed" ? 1 : quantity;
    const reason = checkMovable(item, qty) ?? (type === "feed" ? checkFeed(item) : null)
      ?? checkFits(box.items, item, qty, get("limit"));
    if (reason) return no(reason);
    if (type === "store") {
      await move(item, box, qty);
      await say("store");
    } else {
      const made = await move(item, box, 1, { held: { fails: 0, lastTry: null } });
      await made.update({ "system.identified": true });
      await say("hold", `<p><strong>Taste Test: ${esc(made.name)}</strong></p>${made.system.description?.value ?? ""}`);
    }
    return { ok: true };
  }

  const item = box.items.get(itemId);
  if (type === "take") {
    if (heldData(item)) return no("He's holding that one. Persuade him.");
    const reason = checkMovable(item, quantity);
    if (reason) return no(reason);
    await move(item, pc, quantity);
    return { ok: true };
  }

  if (type === "persuade") {
    const held = heldData(item), day = today();
    const reason = canPersuade(held, day);
    if (reason) return no(reason);
    const advantage = get("nextAdvantage");
    const rolls = await pc.rollSkill({ skill: "per", advantage }, { configure: false },
      { data: { flavor: `Persuading Bertrude: ${item.name}` } });
    if (!rolls?.length) return no("The roll was cancelled.");
    if (advantage) await game.settings.set(MOD, "nextAdvantage", false);
    const result = resolveAttempt(held, { total: rolls[0].total, dc: get("dc"), day });
    if (result.released) {
      await item.unsetFlag(MOD, "held");
      await say("release", result.pity ? "<p>He spits it out, slimy and complaining.</p>"
        : `<p>He lets go of ${esc(item.name)}.</p>`);
    } else {
      await item.setFlag(MOD, "held", result.held);
      await say("refuse");
    }
    return { ok: true };
  }
  return no("Unknown action.");
}

async function send(data) {
  try {
    let result;
    if (game.user.isActiveGM) result = await perform({ ...data, userId: game.user.id });
    else {
      const gm = game.users.activeGM;
      if (!gm) return ui.notifications.warn("The GM needs to be connected.");
      result = await gm.query(QUERY, { ...data, userId: game.user.id }, { timeout: 20000 });
    }
    if (!result?.ok) ui.notifications.warn(result?.reason ?? "That didn't work.");
  } catch (err) {
    console.error(MOD, err);
    ui.notifications.error("That may not have finished. Check with the GM before trying again.");
  }
}

/* ---------- Window ---------- */
let win = null;
const refresh = () => win?.rendered && win.render();

function makeClass() {
  const { ApplicationV2 } = foundry.applications.api;
  return class BertrudeWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "meridian-bertrude", classes: ["meridian-bertrude-window"], window: { title: "Bertrude", resizable: true },
      position: { width: 620, height: 640 }
    };
    actorId = game.user.character?.id ?? null;
    get actor() { return chest(); } // lets Coin Lock add its coin bar

    async _renderHTML() {
      const box = chest();
      const mine = game.actors.filter((a) => a.type === "character" && a !== box && a.testUserPermission(game.user, "OWNER"));
      const pc = mine.find((a) => a.id === this.actorId) ?? mine[0];
      this.actorId = pc?.id ?? null;
      const row = (label, buttons) => `<div class="mbt-row"><span>${label}</span>${buttons}</div>`;
      const button = (type, item, label) => `<button type="button" data-type="${type}" data-item="${item.id}">${label}</button>`;
      const label = (i) => `${esc(i.name)}${(i.system.quantity ?? 1) > 1 ? ` ×${i.system.quantity}` : ""}`;
      const inside = box.items.filter((i) => !checkMovable(i, 1)).map((i) => heldData(i)
        ? row(`${label(i)} (held)`, canPersuade(heldData(i), today()) ? "<em>Try again tomorrow</em>" : button("persuade", i, "Persuade"))
        : row(label(i), button("take", i, "Take"))).join("") || "<p>Empty. Suspiciously clean.</p>";
      const carried = (pc?.items.filter((i) => !checkMovable(i, 1)) ?? []).map((i) => row(label(i),
        button("store", i, "Store") + (checkFeed(i) ? "" : button("feed", i, "Taste Test")))).join("");
      const options = mine.map((a) => `<option value="${a.id}" ${a === pc ? "selected" : ""}>${esc(a.name)}</option>`).join("");
      const gm = game.user.isGM ? row(`GM: ${revealed() ? "players can use him" : "hidden from players"}`,
        `<button type="button" data-gm="reveal">${revealed() ? "Hide" : "Reveal"}</button>
         <button type="button" data-gm="adv">${get("nextAdvantage") ? "Advantage set" : "Give advantage"}</button>
         <button type="button" data-gm="day">New day</button>`) : "";
      return `${gm}<p><strong>${totalWeight(box.items).toFixed(1)} / ${get("limit")} lb</strong></p>
        <h3>Inside</h3>${inside}<h3>Carried by</h3><select name="actor">${options}</select>${carried}`;
    }

    _replaceHTML(html, content) {
      content.classList.add("mbt");
      content.innerHTML = html;
      content.querySelector("select").addEventListener("change", (ev) => { this.actorId = ev.target.value; this.render(); });
      for (const b of content.querySelectorAll("button")) b.addEventListener("click", async () => {
        const { type, item, gm } = b.dataset;
        if (gm === "reveal") await chest().setFlag(MOD, "revealed", !revealed());
        else if (gm === "adv") await game.settings.set(MOD, "nextAdvantage", !get("nextAdvantage"));
        else if (gm === "day") await game.settings.set(MOD, "dayOffset", get("dayOffset") + 1);
        else {
          b.disabled = true;
          const source = type === "take" ? chest() : game.actors.get(this.actorId);
          const have = source?.items.get(item)?.system.quantity ?? 1;
          let quantity = 1;
          if ((type === "store" || type === "take") && have > 1) {
            quantity = await foundry.applications.api.DialogV2.prompt({
              window: { title: "How many?" }, position: { width: 360 },
              content: `<input type="number" name="n" min="1" max="${have}" value="${have}">`,
              ok: { label: "OK", callback: (e, btn) => btn.form.elements.n.valueAsNumber }, rejectClose: false
            });
          }
          if (quantity) await send({ type, itemId: item, quantity, actorId: this.actorId });
        }
        this.render();
      });
    }
  };
}

let Window, greeted = false;
async function open() {
  if (!chest()) return ui.notifications.warn("No actor is set up as Bertrude yet.");
  if (!game.user.isGM && !revealed()) return;
  Window ??= makeClass();
  win ??= new Window();
  await win.render({ force: true });
  if (!greeted) { greeted = true; await say("greet"); }
}

Hooks.once("init", () => {
  const reg = (key, data) => game.settings.register(MOD, key, { scope: "world", config: false, onChange: refresh, ...data });
  reg("limit", { name: "Weight limit (lb)", type: Number, default: 300, config: true });
  reg("dc", { name: "Persuasion DC", type: Number, default: 13, config: true });
  reg("nextAdvantage", { type: Boolean, default: false });
  reg("dayOffset", { type: Number, default: 0 });
  CONFIG.queries[QUERY] = perform;
  Hooks.on("updateActor", (a) => a.getFlag(MOD, "isChest") && refresh());
  for (const hook of ["createItem", "updateItem", "deleteItem", "updateWorldTime"]) Hooks.on(hook, refresh);
});

Hooks.once("ready", () => {
  game.modules.get(MOD).api = {
    open,
    /** GM: mark an actor as the chest. */
    setChest: (actor) => game.user.isGM && actor.setFlag(MOD, "isChest", true)
  };
});

// Double-clicking his token opens the chest window instead of a sheet.
Hooks.once("canvasReady", () => {
  const proto = CONFIG.Token.objectClass.prototype;
  const original = proto._onClickLeft2, canView = proto._canView;
  const isBox = (t) => t.actor?.getFlag(MOD, "isChest") && !game.user.isGM && revealed();
  proto._canView = function (...args) { return isBox(this) || canView.apply(this, args); };
  proto._onClickLeft2 = function (...args) { return isBox(this) ? open() : original.apply(this, args); };
});
