const ID = "meridian-lockpick";
const DEFAULTS = { dc: 13, minutes: 10 };
const busy = new Set();
let socket;

Hooks.once("socketlib.ready", () => {
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
});

Hooks.once("ready", () => {
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
      content: `<p>The lock is stubborn. Try to pick it with your lockpicks?</p><p>Each attempt takes about ${cfg.minutes} minutes.</p>`,
      yes: { label: "Pick the lock" },
      no: { label: "Leave it" },
      rejectClose: false
    });
    if (!go) return;

    const rolls = await actor.rollToolCheck({ tool: "thief", ability: "dex" }, { configure: false }, { create: true });
    const total = Array.isArray(rolls) ? rolls[0]?.total : rolls?.total;
    if (total === undefined) return;

    await socket.executeAsGM("advance", cfg.minutes * 60);
    const say = (html) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: html });

    if (total >= cfg.dc) {
      await say(`<p><strong>${actor.name}</strong> works at the lock for about ${cfg.minutes} minutes, and it finally clicks open.</p>`);
      await socket.executeAsGM("unlock", pile.uuid);
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
