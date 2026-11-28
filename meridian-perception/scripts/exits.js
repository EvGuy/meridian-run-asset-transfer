/**
 * Meridian Exits: a clickable symbol on the map that opens a travel window.
 * Self-contained. Loads from another module with:  import "./exits.js";
 *
 * Data: Region flag flags.meridian-perception.exit =
 *   { to: <arrival region id, same scene>, verb: "Climb rope down", dest: "the Round Chamber",
 *     label: "" (optional full override), art: <URL of a ChatGPT-made symbol image; all module art comes from ChatGPT>,
 *     enabled: true }   // false = hidden from players until the GM reveals it
 */
const MOD = "meridian-perception";
const QUERY = `${MOD}.useExit`;
const REACH = 2; // grid squares, token edge to symbol box edge (same as points of interest)

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const exitOf = (region) => region.flags?.[MOD]?.exit ?? null;
const labelOf = (x) => x.label || `${x.verb || "Exit"} to ${x.dest || "the next area"}`;

function rectOf(region) {
  const s = region.shapes?.[0];
  if (!s) return null;
  return { x: s.x, y: s.y, w: s.width, h: s.height, cx: s.x + s.width / 2, cy: s.y + s.height / 2 };
}

function tokenRect(doc, pos = doc) {
  const g = doc.parent.grid.size;
  return { x: pos.x, y: pos.y, w: doc.width * g, h: doc.height * g };
}

function squaresBetween(a, b, g) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.max(dx, dy) / g;
}

const centerInside = (t, r) => {
  const x = t.x + t.w / 2, y = t.y + t.h / 2;
  return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
};

const inReach = (doc, rect) => squaresBetween(tokenRect(doc), rect, doc.parent.grid.size) <= REACH;

/** Tokens this user could send through the exit. */
function travellers(region) {
  const rect = rectOf(region);
  const controlled = canvas.tokens.controlled.map((t) => t.document);
  if (game.user.isGM) return controlled;
  const mine = region.parent.tokens.filter((t) => t.isOwner && !t.hidden);
  const near = mine.filter((t) => inReach(t, rect));
  const picked = near.filter((t) => controlled.includes(t));
  return picked.length ? picked : near;
}

/** Free top-left spots in rings around the arrival symbol, so the symbol stays visible. */
function arrivalSpots(scene, rect, docs) {
  const g = scene.grid.size;
  const moving = new Set(docs.map((d) => d.id));
  const taken = scene.tokens.filter((t) => !moving.has(t.id)).map((t) => tokenRect(t));
  const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const walls = canvas.scene?.id === scene.id;
  const blocked = (to) => walls && CONFIG.Canvas.polygonBackends.move.testCollision(
    { x: rect.cx, y: rect.cy }, to, { type: "move", mode: "any" });
  return docs.map((doc) => {
    const size = tokenRect(doc);
    for (let ring = 1; ring <= 5; ring++) {
      for (let j = -ring; j <= ring; j++) {
        for (let i = -ring; i <= ring; i++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          const c = { x: rect.cx + i * g, y: rect.cy + j * g };
          const spot = { x: c.x - size.w / 2, y: c.y - size.h / 2, w: size.w, h: size.h };
          if (taken.some((o) => overlaps(spot, o)) || blocked(c)) continue;
          taken.push(spot);
          return spot;
        }
      }
    }
    return { x: rect.cx - size.w / 2, y: rect.cy - size.h / 2, w: size.w, h: size.h };
  });
}

/** Runs on the active GM's client. Everything is re-checked here. */
async function performExit({ sceneId, regionId, tokenIds, userId }) {
  const scene = game.scenes.get(sceneId);
  const region = scene?.regions.get(regionId);
  const user = game.users.get(userId);
  const exit = region && exitOf(region);
  const target = exit && scene.regions.get(exit.to);
  if (!user || !target) return { ok: false, reason: "This way leads nowhere yet." };
  if (!user.isGM && exit.enabled === false) return { ok: false, reason: "You can't go that way." };
  if (!user.isGM && game.paused) return { ok: false, reason: "The game is paused." };
  const from = rectOf(region);
  const docs = tokenIds.map((id) => scene.tokens.get(id)).filter((d) =>
    d && (user.isGM || (d.testUserPermission(user, "OWNER") && inReach(d, from))));
  if (!docs.length) return { ok: false, reason: `Get within ${REACH} squares first.` };
  const to = rectOf(target);
  const spots = arrivalSpots(scene, to, docs);
  for (let i = 0; i < docs.length; i++) {
    await docs[i].move([{ x: spots[i].x, y: spots[i].y, action: "displace", snapped: false }],
      { autoRotate: false, showRuler: false, constrainOptions: { ignoreWalls: true, ignoreCost: true } });
  }
  return { ok: true, view: { x: to.cx, y: to.cy } };
}

let openWindow = null;

export async function openExit(region) {
  const exit = exitOf(region);
  const target = exit && region.parent.regions.get(exit.to);
  if (!target || openWindow) return;
  const docs = travellers(region);
  const label = labelOf(exit);
  const names = docs.map((d) => esc(d.name)).join(", ");
  const hint = docs.length ? `<p>Going: <strong>${names}</strong></p>`
    : game.user.isGM ? "<p>No token selected. Select tokens first to send them through.</p>"
    : `<p>You're too far away. Get within ${REACH} squares of it first.</p>`;
  const buttons = [];
  if (docs.length) buttons.push({ action: "go", label, icon: "fa-solid fa-person-walking-arrow-right", default: true });
  if (game.user.isGM) {
    buttons.push({ action: "peek", label: "Look there (GM)", icon: "fa-solid fa-eye" });
    buttons.push({ action: "toggle", icon: "fa-solid fa-lock",
      label: exit.enabled === false ? "Reveal to players" : "Hide from players" });
  }
  buttons.push({ action: "stay", label: "Stay here", icon: "fa-solid fa-xmark" });

  openWindow = true;
  let choice;
  try {
    choice = await foundry.applications.api.DialogV2.wait({
      classes: ["meridian-exit"],
      window: { title: "Travel" }, position: { width: 420 },
      content: `<h2 style="text-align:center">${esc(label)}</h2>${hint}`,
      buttons, rejectClose: false
    });
  } finally { openWindow = null; }

  const to = rectOf(target);
  if (choice === "peek") return canvas.animatePan({ x: to.cx, y: to.cy });
  if (choice === "toggle") return region.update({ [`flags.${MOD}.exit.enabled`]: exit.enabled === false });
  if (choice !== "go") return;

  const data = { sceneId: region.parent.id, regionId: region.id, tokenIds: docs.map((d) => d.id), userId: game.user.id };
  let result;
  try {
    if (game.user.isGM) result = await performExit(data);
    else {
      const gm = game.users.activeGM;
      if (!gm) return ui.notifications.warn("The GM needs to be connected for that.");
      result = await gm.query(QUERY, data, { timeout: 15000 });
    }
  } catch (err) {
    console.error("Meridian Exits", err);
    return ui.notifications.error("That didn't work. Tell the GM.");
  }
  if (!result?.ok) return ui.notifications.warn(result?.reason ?? "That didn't work.");
  await canvas.animatePan({ ...result.view, duration: 900 });
}

/* ---------- Map symbols ---------- */
let layer = null;

function drawSymbol(region) {
  const exit = exitOf(region), rect = rectOf(region), g = canvas.grid.size;
  const hidden = exit.enabled === false;
  const c = new PIXI.Container();
  c.position.set(rect.cx, rect.cy);
  c.regionId = region.id;
  const r = g * 0.5;
  const caption = new foundry.canvas.containers.PreciseText(
    hidden ? `${labelOf(exit)} (hidden)` : labelOf(exit),
    new PIXI.TextStyle({ fontFamily: "Signika", fontSize: Math.round(g * 0.28), fill: 0xffffff,
      stroke: 0x000000, strokeThickness: 5, align: "center" }));
  caption.anchor.set(0.5, 0);
  caption.position.set(0, r + 6);
  c.addChild(caption);
  // No code-drawn stand-in: without art, the label itself is the clickable marker.
  let hasArt = false;
  if (exit.art) {
    foundry.canvas.loadTexture(exit.art).then((texture) => {
      if (!texture || c.destroyed) return;
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.scale.set((r * 2) / Math.max(texture.width, texture.height));
      c.addChildAt(sprite, 0);
      hasArt = true;
      caption.visible = false;
    }).catch((err) => console.warn("Meridian Exits: symbol art failed to load", exit.art, err));
  }
  c.alpha = hidden ? 0.55 : 1;
  c.eventMode = "static";
  c.cursor = "pointer";
  c.hitArea = new PIXI.Rectangle(-r, -r, r * 2, r * 2);
  c.on("pointerover", () => { caption.visible = true; c.scale.set(1.12); });
  c.on("pointerout", () => { caption.visible = !hasArt; c.scale.set(1); });
  c.on("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    openExit(canvas.scene.regions.get(region.id));
  });
  return c;
}

/** Players see a symbol only if revealed and in their current sight. */
function updateVisibility() {
  if (!layer || layer.destroyed) return;
  for (const c of layer.children) {
    c.visible = game.user.isGM || canvas.visibility.testVisibility({ x: c.x, y: c.y }, { tolerance: canvas.grid.size / 2 });
  }
}

export function refreshExits() {
  if (layer && !layer.destroyed) layer.destroy({ children: true });
  layer = null;
  if (!canvas.ready) return;
  layer = canvas.controls.addChild(new PIXI.Container());
  layer.eventMode = "passive";
  for (const region of canvas.scene.regions) {
    const exit = exitOf(region);
    if (!exit || !rectOf(region) || (!game.user.isGM && exit.enabled === false)) continue;
    layer.addChild(drawSymbol(region));
  }
  updateVisibility();
}

/* Walking onto a symbol opens the same window for whoever moved the token.
 * Foundry reports one drag in several segments, so remember what was entered
 * and open only if the token finishes the move there. */
const entered = new Map(); // token id -> region id
function onMove(doc, movement, operation, user) {
  if (user.id !== game.user.id || doc.parent.id !== canvas.scene?.id) return;
  const points = movement.passed?.waypoints ?? [];
  if (points.some((p) => p.action === "displace")) return entered.delete(doc.id); // our travel, or a teleport
  const before = tokenRect(doc, movement.origin);
  const after = tokenRect(doc, movement.destination);
  for (const region of doc.parent.regions) {
    const exit = exitOf(region), rect = exit && rectOf(region);
    if (!rect || (!game.user.isGM && exit.enabled === false)) continue;
    if (centerInside(after, rect) && !centerInside(before, rect)) entered.set(doc.id, region.id);
  }
  if (movement.pending?.waypoints?.length) return;
  const region = doc.parent.regions.get(entered.get(doc.id));
  entered.delete(doc.id);
  if (!region || !centerInside(after, rectOf(region))) return;
  doc.object?.control({ releaseOthers: false });
  setTimeout(() => openExit(region), 600);
}

/** GM helper: make an exit on a region, or a new square region centred on (x, y). */
export async function makeExit(scene, { name, x, y, size = scene.grid.size * 2, levels }) {
  const [region] = await scene.createEmbeddedDocuments("Region", [{
    name: `Exit — ${name}`, levels: levels ?? [scene.levels.contents[0].id],
    shapes: [{ type: "rectangle", x: x - size / 2, y: y - size / 2, width: size, height: size }]
  }]);
  return region;
}

export const setExit = (region, exit) => region.update({ [`flags.${MOD}.exit`]: exit });

export function registerExits() {
  const css = document.createElement("style"); // layout only: one full-width button per row
  css.textContent = ".meridian-exit .form-footer{flex-direction:column;align-items:stretch}" +
    ".meridian-exit .form-footer button{flex:0 0 auto;width:100%;height:auto;min-height:2.4em}";
  document.head.appendChild(css);
  CONFIG.queries[QUERY] = performExit;
  Hooks.on("canvasReady", refreshExits);
  Hooks.on("sightRefresh", updateVisibility);
  Hooks.on("moveToken", onMove);
  for (const h of ["createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(h, (region) => { if (region.parent?.id === canvas.scene?.id) refreshExits(); });
  }
  globalThis.MeridianExits = { openExit, refreshExits, makeExit, setExit };
  if (globalThis.canvas?.ready) refreshExits();
}

if (globalThis.game?.ready) registerExits();
else Hooks.once("init", registerExits);
