// The Light cantrip: on the caster, or on a spot on the map, for 30 real minutes.
import { ID, SPELL_LIGHT, SPELL_MS, isLightSpell, spellRunning } from "./logic.js";

let socket = null;
let sync = () => {};

export const selfSpell = actor => spellRunning(actor?.getFlag?.(ID, "spell"), Date.now()) ? SPELL_LIGHT : null;

export function registerSpell(queueSync) {
  sync = queueSync;

  Hooks.once("socketlib.ready", () => {
    socket = globalThis.socketlib.registerModule(ID);
    socket.register("castLight", gmCast);
  });

  // Replace the system's own Light activity with our two-choice cast.
  Hooks.on("dnd5e.preUseActivity", activity => {
    const item = activity?.item;
    if (!isLightSpell(item) || !item.actor) return;
    startCast(item.actor).catch(e => {
      console.error(`${ID} |`, e);
      ui.notifications.error("The Light spell failed. Make sure the GM is connected and try again.");
    });
    return false;
  });

  Hooks.once("ready", () => setInterval(() => sweepSpells(sync), 15000));
}

async function startCast(actor) {
  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Light" },
    position: { width: 440 },
    content: "<p>Where do you cast it? It lasts 30 minutes. Casting again ends your last Light.</p>",
    buttons: [
      { action: "self", label: "On myself", default: true },
      { action: "spot", label: "A spot on the map" }
    ],
    rejectClose: false
  });
  if (choice !== "self" && choice !== "spot") return;
  let spot = null;
  if (choice === "spot") {
    spot = await pickSpot(actor);
    if (!spot) return;
  }
  if (!socket) throw new Error("socketlib is not ready");
  const result = await socket.executeAsGM("castLight", { actorUuid: actor.uuid, spot });
  if (!result?.ok) ui.notifications.warn(result?.reason ?? "The Light spell failed.");
}

// Waits for one left click on the map. Esc cancels. The sheet is minimized so it is not in the way.
async function pickSpot(actor) {
  if (!canvas?.ready) { ui.notifications.warn("Open a map first."); return null; }
  const sheet = actor.sheet?.rendered ? actor.sheet : null;
  await sheet?.minimize();
  const view = canvas.app.canvas ?? canvas.app.view;
  const sceneId = canvas.scene.id;
  ui.notifications.info("Click the spot for your Light. Press Esc to cancel.");
  const spot = await new Promise(resolve => {
    const done = value => {
      view.removeEventListener("pointerdown", click, true);
      window.removeEventListener("keydown", key, true);
      Hooks.off("canvasTearDown", tearDown);
      resolve(value);
    };
    const click = event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
      done({ sceneId, levelId: canvas.level?.id ?? null, x: Math.round(point.x), y: Math.round(point.y) });
    };
    const key = event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      done(null);
    };
    const tearDown = Hooks.once("canvasTearDown", () => done(null));
    view.addEventListener("pointerdown", click, true);
    window.addEventListener("keydown", key, true);
  });
  await sheet?.maximize();
  return spot;
}

// Runs on the GM client. Players cannot create lights themselves.
async function gmCast({ actorUuid, spot }) {
  const sender = game.users.get(this?.socketdata?.userId) ?? game.user;
  const actor = await fromUuid(actorUuid);
  if (!actor || !actor.testUserPermission(sender, "OWNER")) return { ok: false, reason: "You can't cast for that character." };
  let scene = null;
  if (spot) {
    scene = game.scenes.get(spot.sceneId);
    if (!scene || !Number.isFinite(spot.x) || !Number.isFinite(spot.y)) return { ok: false, reason: "That spot isn't on the map." };
  }

  await endSpell(actor);
  const expires = Date.now() + SPELL_MS;
  if (spot) {
    const data = {
      x: spot.x, y: spot.y,
      config: {
        bright: SPELL_LIGHT.bright, dim: SPELL_LIGHT.dim, color: SPELL_LIGHT.color, alpha: 0.25,
        animation: { type: SPELL_LIGHT.animation, speed: 3, intensity: 3 }
      },
      flags: { [ID]: { spell: { actorUuid, name: actor.name, expires } } }
    };
    if (spot.levelId && scene.levels?.get(spot.levelId)) data.levels = [spot.levelId];
    await scene.createEmbeddedDocuments("AmbientLight", [data]);
  } else {
    await actor.setFlag(ID, "spell", { expires });
  }
  await sync(actor);
  await say(actor, `${foundry.utils.escapeHTML(actor.name)} casts <strong>Light</strong> ${spot ? "on a spot on the map" : "on themselves"}. It lasts 30 minutes.`);
  return { ok: true };
}

const placedLights = test => game.scenes.contents.flatMap(scene => {
  const ids = scene.lights.filter(l => { const d = l.flags?.[ID]?.spell; return d && test(d); }).map(l => l.id);
  return ids.length ? [{ scene, ids }] : [];
});

// Removes every Light this actor has running.
async function endSpell(actor) {
  for (const { scene, ids } of placedLights(d => d.actorUuid === actor.uuid)) {
    await scene.deleteEmbeddedDocuments("AmbientLight", ids);
  }
  if (actor.getFlag(ID, "spell")) {
    await actor.unsetFlag(ID, "spell");
    await sync(actor);
  }
}

const say = (actor, content) => ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<p>${content}</p>` });

let sweeping = false;
// The active GM puts out spells whose 30 minutes are up, including ones that ran out while nobody was on.
export async function sweepSpells(queueSync = sync) {
  if (sweeping || !game.users.activeGM?.isSelf) return;
  sweeping = true;
  try {
    const now = Date.now();
    for (const { scene, ids } of placedLights(d => !spellRunning(d, now))) {
      const names = ids.map(id => scene.lights.get(id).flags[ID].spell.name);
      await scene.deleteEmbeddedDocuments("AmbientLight", ids);
      for (const name of names) {
        await ChatMessage.create({ content: `<p>${foundry.utils.escapeHTML(name)}'s Light spell goes out.</p>` });
      }
    }
    const actors = new Map();
    for (const a of game.actors) actors.set(a.uuid, a);
    for (const s of game.scenes) for (const t of s.tokens) if (!t.actorLink && t.actor) actors.set(t.actor.uuid, t.actor);
    for (const actor of actors.values()) {
      const data = actor.getFlag(ID, "spell");
      if (!data || spellRunning(data, now)) continue;
      await actor.unsetFlag(ID, "spell");
      await queueSync(actor);
      await say(actor, `${foundry.utils.escapeHTML(actor.name)}'s Light spell goes out.`);
    }
  } catch (e) {
    console.error(`${ID} |`, e);
  } finally {
    sweeping = false;
  }
}
