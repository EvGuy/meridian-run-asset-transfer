// Meridian Perception 1.2.0 (Points of Interest: items are taken, details are investigated)
// Region behavior "Room Perception": first entry by a player character -> secret skill roll -> whisper tiered text.
const ID = "meridian-perception";
const pending = new Set();

function parseTiers(raw) {
  let t = raw;
  if (typeof t === "string") { try { t = JSON.parse(t); } catch (e) { t = []; } }
  if (!Array.isArray(t)) t = [];
  return t.map(x => ({ min: Number(x?.min ?? 0), text: String(x?.text ?? "").trim() }))
    .filter(x => x.text && Number.isFinite(x.min))
    .sort((a, b) => a.min - b.min);
}

async function secretRoll(actor, skill) {
  try {
    if (typeof actor.rollSkill === "function") {
      const rolls = await actor.rollSkill({ skill }, { configure: false }, { create: false });
      const total = Array.isArray(rolls) ? rolls[0]?.total : rolls?.total;
      if (Number.isFinite(total)) return total;
    }
  } catch (e) { console.warn(ID, "rollSkill failed, using fallback", e); }
  const mod = actor.system?.skills?.[skill]?.total ?? 0;
  return (await new Roll("1d20 + @m", { m: mod }).evaluate()).total;
}

function recipients(actor) {
  return game.users.filter(u => !u.isGM && actor.testUserPermission(u, "OWNER")).map(u => u.id);
}

/** Runs one behavior for one token. GM client only. Returns a summary object or null. */
async function run(behavior, tokenDoc, { force = false } = {}) {
  const actor = tokenDoc?.actor;
  if (!actor || actor.type !== "character" || !actor.hasPlayerOwner) return null;
  if (tokenDoc.hidden && !force) return null;
  const cfg = behavior.system;
  const tiers = parseTiers(cfg.tiers);
  if (!tiers.length) return null;
  const key = `${behavior.uuid}:${actor.id}`;
  if (pending.has(key)) return null;
  const seen = behavior.getFlag(ID, "seen") ?? [];
  if (cfg.once && !force && seen.includes(actor.id)) return null;
  pending.add(key);
  try {
    if (cfg.once) await behavior.setFlag(ID, "seen", [...new Set([...seen, actor.id])]);
    const skill = cfg.skill || "prc";
    const total = await secretRoll(actor, skill);
    const matched = tiers.filter(t => total >= t.min);
    const lines = cfg.stack ? matched : matched.slice(-1);
    let found = 0;
    try { found = await revealPois(actor, tokenDoc.parent, cfg.roomCode, total); } catch (e) { console.warn(ID, "poi reveal failed", e); }
    const region = behavior.parent;
    const label = cfg.roomCode ? `${cfg.roomCode} ${region?.name ?? ""}`.trim() : (region?.name ?? "Room");
    if (lines.length || found) {
      const to = recipients(actor);
      const whisper = to.length ? to : game.users.filter(u => u.isGM).map(u => u.id);
      await ChatMessage.create({
        speaker: { alias: "You notice" },
        whisper,
        content: `<div class="meridian-perception">${lines.map(l => `<p>${l.text}</p>`).join("")}${found ? `<p><em>Something here is worth a closer look. Look for the red outline.</em></p>` : ""}</div>`,
        flags: { [ID]: { actorId: actor.id, region: region?.uuid } }
      });
    }
    if (cfg.showGM) {
      await ChatMessage.create({
        speaker: { alias: "Room Perception" },
        whisper: game.users.filter(u => u.isGM).map(u => u.id),
        content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> entered <em>${foundry.utils.escapeHTML(label)}</em>. ${skill.toUpperCase()} <strong>${total}</strong>. ${lines.length ? `Whispered ${lines.length} of ${tiers.length} tiers.${found ? ` Revealed ${found} point(s) of interest.` : ""}` : "Noticed nothing; nothing whispered."}</p>`
      });
    }
    return { actor: actor.name, total, delivered: lines.length, tiers: tiers.length };
  } finally { pending.delete(key); }
}

const fields = foundry.data.fields;
class RoomPerceptionBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["BEHAVIOR.TYPES.meridian-perception.room"];
  static defineSchema() {
    return {
      roomCode: new fields.StringField({ required: false, blank: true, initial: "", label: "Room code", hint: "For your own reference, e.g. 2A." }),
      skill: new fields.StringField({ required: true, blank: false, initial: "prc", label: "Skill", hint: "dnd5e skill key. prc = Perception, inv = Investigation, sur = Survival." }),
      stack: new fields.BooleanField({ initial: true, label: "Stack tiers", hint: "A roll receives every tier at or below its total. Off: only the highest tier." }),
      once: new fields.BooleanField({ initial: true, label: "Once per character", hint: "Each character is whispered only the first time they enter." }),
      showGM: new fields.BooleanField({ initial: true, label: "GM summary", hint: "Whisper the GM who rolled what." }),
      tiers: new fields.JSONField({ initial: [{ min: 1, text: "" }], label: "Tiers", hint: "JSON list: [{\"min\": 12, \"text\": \"What a careful character notices.\"}]. Higher min = harder to notice." })
    };
  }
  static events = { [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: this.#onMoveIn };
  static async #onMoveIn(event) {
    if (!game.user.isActiveGM) return;
    const tokenDoc = event.data?.token;
    if (!tokenDoc) return;
    try { await run(this.parent, tokenDoc); } catch (e) { console.error(ID, e); }
  }
}

Hooks.once("init", () => {
  CONFIG.RegionBehavior.dataModels[`${ID}.room`] = RoomPerceptionBehavior;
  CONFIG.RegionBehavior.typeIcons ??= {};
  CONFIG.RegionBehavior.typeIcons[`${ID}.room`] = "fa-solid fa-eye";
});

function behaviorsOf(region) {
  return region.behaviors.filter(b => b.type === `${ID}.room`);
}


// ---------------------------------------------------------------------------
// Points of Interest. A Region carrying flags.meridian-perception.poi:
// { id, room, name, kind: "detail"|"item", reveal, image, basic, tiers:[{min,text}], seconds, skill }
// Perception total >= reveal (in the room whose roomCode == poi.room) reveals it to that character
// (actor flag "revealed"). The owner sees a red outline, clicks it, reads the basic text, may investigate:
// timer, secret roll, stacked tiers. Result recorded in actor flag "done".
// ---------------------------------------------------------------------------
const poiOf = (region) => region.getFlag(ID, "poi");
const pkey = (scene, poi) => `${scene.id}_${poi.id}`;

async function revealPois(actor, scene, roomCode, total) {
  if (!roomCode || !scene) return 0;
  const cur = actor.getFlag(ID, "revealed") ?? {};
  const add = {}; let n = 0;
  for (const r of scene.regions) {
    const p = poiOf(r);
    if (!p || p.room !== roomCode || total < Number(p.reveal ?? 0)) continue;
    const k = pkey(scene, p);
    if (cur[k]) continue;
    add[k] = true; n++;
  }
  if (n) await actor.setFlag(ID, "revealed", { ...cur, ...add });
  return n;
}

function regionBounds(region) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sh of region.shapes) {
    if (sh.type === "rectangle") { x0 = Math.min(x0, sh.x); y0 = Math.min(y0, sh.y); x1 = Math.max(x1, sh.x + sh.width); y1 = Math.max(y1, sh.y + sh.height); }
    else if (sh.type === "polygon") { for (let i = 0; i < sh.points.length; i += 2) { x0 = Math.min(x0, sh.points[i]); x1 = Math.max(x1, sh.points[i]); y0 = Math.min(y0, sh.points[i + 1]); y1 = Math.max(y1, sh.points[i + 1]); } }
    else if (sh.type === "circle" || sh.type === "ellipse") { const rx = sh.radius ?? sh.radiusX, ry = sh.radius ?? sh.radiusY; x0 = Math.min(x0, sh.x - rx); x1 = Math.max(x1, sh.x + rx); y0 = Math.min(y0, sh.y - ry); y1 = Math.max(y1, sh.y + ry); }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function myActors() {
  return canvas.tokens.placeables.filter(t => t.isOwner && t.actor?.type === "character").map(t => t.actor)
    .filter((a, i, arr) => arr.indexOf(a) === i);
}

function imageHtml(region, poi) {
  if (poi.image) return `<img src="${poi.image}" style="display:block;width:100%;max-height:62vh;object-fit:contain;border:1px solid #555;border-radius:4px">`;
  const sc = region.parent, bg = sc?.background?.src, b = regionBounds(region);
  if (!bg || !(b.w > 0)) return "";
  const pad = Math.max(b.w, b.h) * 0.6, rx = b.x - pad, ry = b.y - pad, rw = b.w + 2 * pad, rh = b.h + 2 * pad;
  const R = sc.dimensions.sceneRect, W = R.width, H = R.height;
  const px = Math.min(Math.max(rx - R.x, 0), W - rw), py = Math.min(Math.max(ry - R.y, 0), H - rh);
  return `<div style="width:100%;aspect-ratio:${rw}/${rh};max-height:62vh;margin:auto;border:1px solid #555;border-radius:4px;background-image:url('${bg}');background-repeat:no-repeat;background-size:${(W / rw) * 100}% ${(H / rh) * 100}%;background-position:${(px / Math.max(W - rw, 1)) * 100}% ${(py / Math.max(H - rh, 1)) * 100}%"></div>`;
}

async function countdownPoi(poi, img, seconds) {
  let state = "run";
  const dlg = new foundry.applications.api.DialogV2({
    window: { title: poi.name, icon: "fa-solid fa-magnifying-glass" },
    position: { width: 660 },
    content: `<div style="text-align:center">${img}<p class="mpoi-count" style="font-size:2.6em;margin:0.2em 0">${seconds}</p><progress class="mpoi-bar" max="${seconds}" value="0" style="width:100%"></progress><p style="opacity:.7">You study it closely.</p></div>`,
    buttons: [{ action: "done", label: "Done early", default: true, callback: () => { state = "early"; } }],
    rejectClose: false
  });
  await dlg.render({ force: true });
  let left = seconds;
  await new Promise((resolve) => {
    const iv = setInterval(() => {
      if (!dlg.rendered) { if (state === "run") state = "cancel"; clearInterval(iv); resolve(); return; }
      if (state === "early") { clearInterval(iv); resolve(); return; }
      left -= 1;
      const el = dlg.element;
      const c = el?.querySelector(".mpoi-count"); if (c) c.textContent = String(Math.max(left, 0));
      const bar = el?.querySelector(".mpoi-bar"); if (bar) bar.value = seconds - Math.max(left, 0);
      if (left <= 0) { clearInterval(iv); resolve(); }
    }, 1000);
  });
  if (dlg.rendered) await dlg.close();
  return state !== "cancel";
}


let socket;
function setupSocket() {
  if (socket || typeof socketlib === "undefined") return;
  socket = socketlib.registerModule(ID);
  socket.register("takeItem", async (actorUuid, regionUuid, names) => {
    const actor = await fromUuid(actorUuid), region = await fromUuid(regionUuid);
    if (!actor || !region) return { ok: false, reason: "missing" };
    if (region.getFlag(ID, "taken")) return { ok: false, reason: "taken" };
    const docs = [];
    for (const n of names) {
      const it = game.items.getName(n);
      if (it) docs.push(it.toObject()); else console.warn(ID, "world item not found", n);
    }
    if (!docs.length) return { ok: false, reason: "noitem" };
    await region.setFlag(ID, "taken", actor.id);
    await actor.createEmbeddedDocuments("Item", docs);
    return { ok: true, names: docs.map(d => d.name) };
  });
}
Hooks.once("socketlib.ready", setupSocket);
Hooks.once("init", setupSocket);
Hooks.once("setup", setupSocket);

const busyPoi = new Set();
async function openPoi(region) {
  const poi = poiOf(region), scene = region.parent;
  if (!poi) return;
  const sel = canvas.tokens.controlled.map(t => t.actor).find(a => a && a.isOwner && a.type === "character");
  const mine = myActors();
  const actor = sel ?? mine.find(a => (a.getFlag(ID, "revealed") ?? {})[pkey(scene, poi)]) ?? mine[0];
  if (!actor) { ui.notifications.warn("Select your character first."); return; }
  const key = pkey(scene, poi), lock = `${actor.id}${key}`;
  if (busyPoi.has(lock)) return;
  busyPoi.add(lock);
  try {
    const img = imageHtml(region, poi);
    if (poi.kind === "item") {
      if (region.getFlag(ID, "taken")) { refreshPois(); return; }
      const first = parseTiers(poi.tiers).find(t => t.min <= 1);
      const names = poi.items?.length ? poi.items : [poi.item].filter(Boolean);
      const take = await foundry.applications.api.DialogV2.confirm({
        window: { title: poi.name, icon: "fa-solid fa-hand" }, position: { width: 660 },
        content: `<div>${img}<p style="margin-top:.6em">${poi.basic ?? ""}</p>${first ? `<p>${first.text}</p>` : ""}</div>`,
        yes: { label: "Take it" }, no: { label: "Leave it" }, rejectClose: false
      });
      if (!take) return;
      let res;
      if (game.user.isGM) {
        const docs = names.map(n => game.items.getName(n)?.toObject()).filter(Boolean);
        if (region.getFlag(ID, "taken")) res = { ok: false, reason: "taken" };
        else if (!docs.length) res = { ok: false, reason: "noitem" };
        else { await region.setFlag(ID, "taken", actor.id); await actor.createEmbeddedDocuments("Item", docs); res = { ok: true, names: docs.map(d => d.name) }; }
      } else res = await socket?.executeAsGM("takeItem", actor.uuid, region.uuid, names);
      if (res?.ok) {
        const to = [...new Set([game.user.id, ...game.users.filter(u => u.isGM).map(u => u.id)])];
        await ChatMessage.create({ speaker: { alias: "You take" }, whisper: to, content: `<div class="meridian-perception"><p>${res.names.join(", ")} added to ${foundry.utils.escapeHTML(actor.name)}'s inventory.</p></div>` });
      } else ui.notifications.warn(res?.reason === "taken" ? "Someone already took it." : "That item could not be added.");
      refreshPois();
      return;
    }
    const done = (actor.getFlag(ID, "done") ?? {})[key];
    const basic = `<div>${img}<p style="margin-top:.6em">${poi.basic ?? ""}</p></div>`;
    if (done !== undefined) {
      const prior = parseTiers(poi.tiers).filter(t => done >= t.min);
      const txt = prior.length ? prior.map(t => `<p>${t.text}</p>`).join("") : `<p>You found nothing more.</p>`;
      await foundry.applications.api.DialogV2.prompt({ window: { title: poi.name }, position: { width: 660 }, content: `${img}<p style="margin-top:.6em">${poi.basic ?? ""}</p><hr>${txt}`, ok: { label: "Close" }, rejectClose: false });
      return;
    }
    const go = await foundry.applications.api.DialogV2.confirm({
      window: { title: poi.name, icon: "fa-solid fa-magnifying-glass" }, position: { width: 660 },
      content: `${basic}<p>Investigate it? Takes about ${poi.seconds ?? 20} seconds.</p>`,
      yes: { label: "Investigate" }, no: { label: "Leave it" }, rejectClose: false
    });
    if (!go) return;
    const ok = await countdownPoi(poi, img, Number(poi.seconds ?? 20));
    if (!ok) return;
    const total = await secretRoll(actor, poi.skill || "inv");
    const tiers = parseTiers(poi.tiers).filter(t => total >= t.min);
    await actor.setFlag(ID, "done", { ...(actor.getFlag(ID, "done") ?? {}), [key]: total });
    const text = tiers.length ? tiers.map(t => `<p>${t.text}</p>`).join("") : `<p>You turn it over and find nothing more.</p>`;
    const to = [...new Set([game.user.id, ...game.users.filter(u => u.isGM).map(u => u.id)])];
    await ChatMessage.create({ speaker: { alias: `You investigate: ${poi.name}` }, whisper: to, content: `<div class="meridian-perception">${text}</div>` });
    await ChatMessage.create({ speaker: { alias: "Point of Interest" }, whisper: game.users.filter(u => u.isGM).map(u => u.id), content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> investigated <em>${foundry.utils.escapeHTML(poi.name)}</em>. Investigation <strong>${total}</strong>. ${tiers.length} of ${parseTiers(poi.tiers).length} tiers.</p>` });
    await foundry.applications.api.DialogV2.prompt({ window: { title: poi.name }, position: { width: 660 }, content: `${img}<div style="margin-top:.6em">${text}</div>`, ok: { label: "Close" }, rejectClose: false });
    refreshPois();
  } finally { busyPoi.delete(lock); }
}

let poiLayer = null, poiTick = null;
function clearPois() {
  if (poiTick) { canvas.app.ticker.remove(poiTick); poiTick = null; }
  if (poiLayer) { poiLayer.destroy({ children: true }); poiLayer = null; }
}
function refreshPois() {
  clearPois();
  const scene = canvas.scene; if (!scene || !canvas.ready) return;
  const isGM = game.user.isGM, actors = myActors(), gfxs = [];
  const sel = canvas.tokens.controlled.map(t => t.actor);
  for (const region of scene.regions) {
    const poi = poiOf(region); if (!poi) continue;
    const key = pkey(scene, poi);
    if (region.getFlag(ID, "taken")) continue;
    const seen = actors.some(a => (a.getFlag(ID, "revealed") ?? {})[key]);
    if (!seen && !isGM) continue;
    const done = actors.some(a => (a.getFlag(ID, "done") ?? {})[key] !== undefined);
    const b = regionBounds(region); if (!(b.w > 0)) continue;
    const g = new PIXI.Graphics();
    const col = done ? 0x55aa55 : 0xff2222, a = (!seen && isGM) ? 0.3 : 1;
    g.lineStyle(5, col, a).beginFill(col, 0.08 * a).drawRoundedRect(b.x, b.y, b.w, b.h, 10).endFill();
    g.eventMode = "static"; g.cursor = "pointer"; g.hitArea = new PIXI.Rectangle(b.x, b.y, b.w, b.h);
    g.on("pointerdown", (ev) => { ev.stopPropagation(); openPoi(region).catch(e => console.error(ID, e)); });
    (poiLayer ??= new PIXI.Container()).addChild(g); gfxs.push([g, a]);
  }
  if (!poiLayer) return;
  poiLayer.eventMode = "passive";
  canvas.interface.addChild(poiLayer);
  let t = 0;
  poiTick = (dt) => { t += dt.deltaTime ?? dt; const pulse = 0.65 + 0.35 * Math.sin(t / 12); for (const [g, a] of gfxs) g.alpha = pulse * a; };
  canvas.app.ticker.add(poiTick);
}
for (const h of ["canvasReady", "updateActor", "controlToken", "updateRegion", "createRegion", "deleteRegion", "updateToken"]) Hooks.on(h, () => { try { refreshPois(); } catch (e) { console.warn(ID, e); } });
Hooks.on("canvasTearDown", clearPois);

Hooks.once("ready", () => {
  setupSocket();
  game.modules.get(ID).api = {
    /** GM: trigger a region's perception for tokens already inside it. Defaults to controlled tokens. */
    async trigger(region, tokens, { force = true } = {}) {
      const docs = (tokens ?? canvas.tokens.controlled).map(t => t.document ?? t);
      const out = [];
      for (const b of behaviorsOf(region)) for (const t of docs) out.push(await run(b, t, { force }));
      return out;
    },
    /** GM: forget who has been through a region so everyone gets it again. */
    async reset(region) { for (const b of behaviorsOf(region)) await b.unsetFlag(ID, "seen"); return true; },
    async resetScene(scene = canvas.scene) { for (const r of scene.regions) await this.reset(r); return scene.regions.size; },
    parseTiers,
    /** GM: add/replace a point of interest on a region. */
    async setPoi(region, poi) { await region.setFlag(ID, "poi", poi); return poi; },
    /** GM: forget reveals/investigations for every character. */
    async resetPois(scene = canvas.scene) { for (const a of game.actors) { await a.unsetFlag(ID, "revealed"); await a.unsetFlag(ID, "done"); } for (const r of scene?.regions ?? []) await r.unsetFlag(ID, "taken"); return true; },
    refreshPois
  };
});
