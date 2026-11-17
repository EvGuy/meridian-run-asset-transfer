const ID = "meridian-lockpick";
const DEFAULTS = { dc: 13, seconds: 20, minutes: 10 };
const busy = new Set();
let socket;

function setupSocket() {
  if (socket || typeof socketlib === "undefined") return;
  socket = socketlib.registerModule(ID);
  socket.register("unlock", async (actorUuid) => {
    const API = game.itempiles.API;
    const actor = await fromUuid(actorUuid);
    if (!actor) return false;
    await API.unlockItemPile(actor);
    await API.openItemPile(actor);
    return true;
  });
  socket.register("advance", async (seconds) => {
    if (game.time.advance) await game.time.advance(seconds);
    else await game.time.advanceTime(seconds);
    return true;
  });
}
Hooks.once("socketlib.ready", setupSocket);
Hooks.once("init", setupSocket);
Hooks.once("setup", setupSocket);

Hooks.once("ready", () => {
  setupSocket();
  game.modules.get(ID).api = {
    // game.modules.get("meridian-lockpick").api.setLock(tokenOrActor, { dc: 15, minutes: 10 })
    setLock: async (target, cfg = {}) => {
      const actor = target?.actor ?? target;
      await actor.setFlag(ID, "lock", { ...DEFAULTS, ...cfg });
      return actor.getFlag(ID, "lock");
    }
  };
});

// Fires on the clicking player's own client when a locked pile is clicked.
Hooks.on("item-piles-preRattleItemPile", (pileActor, pileData, interacting) => {
  attempt(pileActor, interacting).catch((e) => console.error(ID, e));
});

async function countdown(seconds) {
  let cancelled = false;
  const dlg = new foundry.applications.api.DialogV2({
    window: { title: "Picking the lock", icon: "fa-solid fa-lock" },
    content: `<div style="text-align:center"><p>You work at the lock. Keep steady.</p><p class="mlp-count" style="font-size:3em;margin:0.2em 0">${seconds}</p><progress class="mlp-bar" max="${seconds}" value="0" style="width:100%"></progress></div>`,
    buttons: [{ action: "stop", label: "Stop", default: true, callback: () => { cancelled = true; } }],
    rejectClose: false
  });
  await dlg.render({ force: true });
  let left = seconds;
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (!dlg.rendered) { cancelled = true; clearInterval(iv); resolve(); return; }
      left -= 1;
      const el = dlg.element;
      const c = el?.querySelector(".mlp-count"); if (c) c.textContent = String(Math.max(left, 0));
      const b = el?.querySelector(".mlp-bar"); if (b) b.value = seconds - Math.max(left, 0);
      if (left <= 0) { clearInterval(iv); resolve(); }
    }, 1000);
  });
  if (dlg.rendered) await dlg.close();
  return !cancelled;
}

async function gm(fn, ...args) {
  try { return await socket.executeAsGM(fn, ...args); }
  catch (e) { console.warn(ID, "GM call failed", fn, e); return undefined; }
}

async function attempt(pile, interacting) {
  if (game.user.isGM) return;
  const actor = interacting || game.user.character || canvas.tokens.controlled[0]?.actor;
  if (!actor || !actor.isOwner) {
    ui.notifications.warn("Select your character to try the lock.");
    return;
  }
  if (busy.has(pile.uuid)) return;
  busy.add(pile.uuid);
  try {
    const cfg = Object.assign({}, DEFAULTS, pile.getFlag(ID, "lock") || {});
    const pick = actor.items.find((i) => /lock\s*pick/i.test(i.name) && (i.system?.quantity ?? 0) > 0);
    if (!pick) {
      ui.notifications.info("The lock needs lockpicks, and you have none.");
      return;
    }
    const go = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Locked" },
      content: `<p>The lock is stubborn. Try to pick it with your lockpicks?</p><p>Each attempt takes about ${cfg.seconds} seconds.</p>`,
      yes: { label: "Pick the lock" },
      no: { label: "Leave it" },
      rejectClose: false
    });
    if (!go) return;

    const stayed = await countdown(cfg.seconds);
    if (!stayed) return;

    const rolls = await actor.rollToolCheck({ tool: "thief", ability: "dex" }, { configure: false }, { create: true });
    const total = Array.isArray(rolls) ? rolls[0]?.total : rolls?.total;
    if (total === undefined) return;

    await gm("advance", cfg.minutes * 60);
    const say = (html) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: html });

    if (total >= cfg.dc) {
      await say(`<p><strong>${actor.name}</strong> works at the lock for about ${cfg.minutes} minutes, and it finally clicks open.</p>`);
      let opened = false;
      try { await game.itempiles.API.unlockItemPile(pile); await game.itempiles.API.openItemPile(pile); opened = true; } catch (e) { console.warn(ID, "direct unlock failed", e); }
      if (!opened) opened = !!(await gm("unlock", pile.uuid));
      if (!opened) ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id), content: "The lock on " + pile.name + " was picked but could not be opened automatically. Unlock it by hand." });
    } else if (total <= cfg.dc - 10) {
      const qty = pick.system.quantity ?? 1;
      if (qty <= 1) await pick.delete();
      else await pick.update({ "system.quantity": qty - 1 });
      await say(`<p><strong>${actor.name}</strong> works at the lock for about ${cfg.minutes} minutes. A lockpick snaps in the mechanism, and the lock holds.</p>`);
    } else {
      await say(`<p><strong>${actor.name}</strong> works at the lock for about ${cfg.minutes} minutes. It holds.</p>`);
    }
  } finally {
    busy.delete(pile.uuid);
  }
}
