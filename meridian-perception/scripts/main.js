// Meridian Perception 1.0.0
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
    const region = behavior.parent;
    const label = cfg.roomCode ? `${cfg.roomCode} ${region?.name ?? ""}`.trim() : (region?.name ?? "Room");
    if (lines.length) {
      const to = recipients(actor);
      const whisper = to.length ? to : game.users.filter(u => u.isGM).map(u => u.id);
      await ChatMessage.create({
        speaker: { alias: "You notice" },
        whisper,
        content: `<div class="meridian-perception">${lines.map(l => `<p>${l.text}</p>`).join("")}</div>`,
        flags: { [ID]: { actorId: actor.id, region: region?.uuid } }
      });
    }
    if (cfg.showGM) {
      await ChatMessage.create({
        speaker: { alias: "Room Perception" },
        whisper: game.users.filter(u => u.isGM).map(u => u.id),
        content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> entered <em>${foundry.utils.escapeHTML(label)}</em>. ${skill.toUpperCase()} <strong>${total}</strong>. ${lines.length ? `Whispered ${lines.length} of ${tiers.length} tiers.` : "Noticed nothing; nothing whispered."}</p>`
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

Hooks.once("ready", () => {
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
    parseTiers
  };
});
