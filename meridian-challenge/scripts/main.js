import { MODULE_ID, state } from "./state.js";
import * as store from "./store.js";
import * as C from "./controller.js";
import { ChallengeManager, ChallengeWindow, onSync } from "./ui.js";
import { SAMPLE_CHALLENGE } from "./sample-challenge.js";

Hooks.once("init", () => {
  store.registerSettings();
});

Hooks.once("socketlib.ready", () => {
  state.socket = socketlib.registerModule(MODULE_ID);
  state.socket.register("sync", onSync);
  state.socket.register("castVote", C.castVote);
});

Hooks.once("ready", () => {
  let manager = null;
  const openManager = () => {
    if (!game.user.isGM) return ui.notifications.warn("Only a GM can manage challenges.");
    manager ??= new ChallengeManager();
    manager.render({ force: true });
    return manager;
  };
  game.modules.get(MODULE_ID).api = {
    openManager,
    start: (id, actors) => C.startChallenge(id, actors),
    close: () => C.closeAll(),
    store,
    sample: SAMPLE_CHALLENGE,
    get view() { return state.view; },
    get ctl() { return state.ctl; }
  };
});

// A GM-only "Challenges" button in the Journal sidebar header.
Hooks.on("renderJournalDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".mc-open-manager")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "mc-open-manager";
  btn.innerHTML = `<i class="fa-solid fa-route"></i> Challenges`;
  btn.addEventListener("click", () => game.modules.get(MODULE_ID).api.openManager());
  const host = root.querySelector(".directory-header .header-actions") ?? root.querySelector(".directory-header") ?? root;
  host.append(btn);
});

// Re-send the current view when someone connects mid-challenge.
Hooks.on("userConnected", (user, connected) => {
  if (connected && C.controllerActive()) C.broadcast();
});
