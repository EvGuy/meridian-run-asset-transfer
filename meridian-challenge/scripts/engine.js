/**
 * Meridian Challenge — pure state engine.
 *
 * No DOM, no Foundry calls. Everything takes plain data and an injected rng, so the same
 * file runs in the local preview, in node tests, and (later) inside the Foundry module.
 *
 * Seams kept for later (Grit/Focus, exhaustion): option.pool is stored but unread,
 * run.resources is an empty per-character slot, and every check goes through
 * resolveOption() — the one place a spend window will plug in.
 */

export const SCHEMA_VERSION = 1;

export const ROLL_MODES = {
  INDIVIDUAL: "individual",
  RALLY: "group-rally",
  WEAKEST: "weakest-link",
  SOFT: "soft-roll"
};

export const DEGREES = {
  CRIT_SUCCESS: "critical-success",
  SUCCESS: "success",
  FAILURE: "failure",
  CRIT_FAILURE: "critical-failure"
};

/** Tunable numbers. Values marked (assumed) are not stated in the Notion rules yet. */
export const DEFAULTS = {
  laneMax: 3,
  critMargin: 10,          // (assumed) crit = natural 20/1, or beat/miss DC by 10
  raiseDcAmount: 2,        // (assumed) size of a "Raise DC"
  supportDcOffset: -3,     // (assumed) Group Rally supporters roll against DC - 3
  finalDcPerShortfall: 1,  // (assumed) final stage: +1 DC per missing shape point
  finalDcMetBonus: -1      // (assumed) final stage: -1 DC if shape already met
};

export const SOCIAL_LANES = [
  { key: "T", name: "Trust" },
  { key: "S", name: "Status" },
  { key: "L", name: "Leverage" }
];

export const OUTCOME_TEXT = {
  full: "Full success — the right kind of social capital, and enough of it.",
  partial: "Partial success — the numbers were there but in the wrong currency. They get what they asked for on the audience's terms.",
  failure: "Failure — the social landscape did not move enough. Standing is lost.",
  crisis: "Crisis — something broke that will not easily be repaired.",
  complete: "Sequence complete."
};

// ---------------------------------------------------------------------------
// rng + dice
// ---------------------------------------------------------------------------

/** Small seeded rng (mulberry32) for reproducible tests. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function d20(rng = Math.random) {
  return 1 + Math.floor(rng() * 20);
}

// ---------------------------------------------------------------------------
// schema
// ---------------------------------------------------------------------------

/**
 * Bring any saved sequence up to the current schema. Add a step here whenever the
 * shape changes — saved data is never rewritten by hand.
 */
export function migrate(input) {
  const seq = structuredClone(input);
  if (!seq.schemaVersion) {
    // v0 = the original Storyteller "Rogue-like" shape: no track, no rounds, per-option rollerMode.
    for (const node of Object.values(seq.nodes ?? {})) {
      for (const opt of node.options ?? []) {
        if (opt.rollerMode && !opt.rollMode) {
          opt.rollMode = opt.rollerMode === "party" ? ROLL_MODES.RALLY : ROLL_MODES.INDIVIDUAL;
        }
        delete opt.rollerMode;
      }
    }
    seq.type ??= "custom";
    seq.track ??= null;      // no track = plain branching, scored as "complete"
    seq.rounds ??= 0;        // 0 = no round cap
    seq.schemaVersion = 1;
  }
  return seq;
}

export function isTerminal(node) {
  return !node || !node.options || node.options.length === 0;
}

export function createRun(seq, opts = {}) {
  const lanes = seq.track?.lanes ?? [];
  const track = {};
  for (const lane of lanes) track[lane.key] = seq.track?.start?.[lane.key] ?? 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    sequenceId: seq.id ?? null,
    nodeId: seq.startNodeId,
    round: 0,
    track,
    history: [],
    pending: [],          // consequence prompts waiting on the GM
    dcMod: 0,             // one-shot DC modifier for the next round (from a confirmed Raise DC)
    lockedOptions: [],
    revealed: [],         // shape hints surfaced to players
    crisis: false,
    finished: false,
    outcome: null,
    resources: {},        // per-character pools live here later (Grit/Focus); unused in v1
    ...opts
  };
}

// ---------------------------------------------------------------------------
// option availability + DC
// ---------------------------------------------------------------------------

export function shapeShortfall(seq, run) {
  const shape = seq.hiddenShape ?? {};
  let short = 0;
  for (const [lane, req] of Object.entries(shape)) short += Math.max(0, req - (run.track[lane] ?? 0));
  return short;
}

/**
 * DC breakdown. `visible` mods are shown to players; `hidden` ones (the final-stage
 * shape modifier) would leak the shape requirement, so only the GM sees those.
 */
export function effectiveDc(seq, run, node, option, cfg = DEFAULTS) {
  const visible = [];
  const hidden = [];
  if (run.dcMod) visible.push({ label: "Raised by consequence", value: run.dcMod });
  if (node.needsLane && (run.track[node.needsLane] ?? 0) === 0) {
    visible.push({ label: `${node.needsLane} lane at 0`, value: cfg.raiseDcAmount });
  }
  if (node.finalStage && seq.hiddenShape) {
    const short = shapeShortfall(seq, run);
    const value = short > 0 ? short * cfg.finalDcPerShortfall : cfg.finalDcMetBonus;
    hidden.push({ label: short > 0 ? `Shape short by ${short}` : "Shape met", value });
  }
  const sum = (arr) => arr.reduce((n, m) => n + m.value, 0);
  const base = option.dc ?? 10;
  return {
    base,
    visible,
    hidden,
    shown: base + sum(visible),
    total: base + sum(visible) + sum(hidden)
  };
}

export function availableOptions(seq, run, node, cfg = DEFAULTS) {
  return (node?.options ?? []).map((option) => {
    let locked = false;
    let reason = "";
    if (run.lockedOptions.includes(option.id)) {
      locked = true;
      reason = "Approach closed by an earlier consequence";
    } else if (option.unlock && (run.track[option.unlock.lane] ?? 0) < option.unlock.min) {
      locked = true;
      reason = `Needs ${option.unlock.lane} ${option.unlock.min}`;
    }
    return { option, locked, reason, dc: effectiveDc(seq, run, node, option, cfg) };
  });
}

// ---------------------------------------------------------------------------
// voting
// ---------------------------------------------------------------------------

export function tallyVotes(options, votes) {
  const counts = Object.fromEntries(options.map((o) => [o.id, 0]));
  for (const optId of Object.values(votes)) if (counts[optId] !== undefined) counts[optId]++;
  const max = Math.max(0, ...Object.values(counts));
  const winners = max === 0 ? [] : Object.keys(counts).filter((id) => counts[id] === max);
  return { counts, max, winners };
}

// ---------------------------------------------------------------------------
// rolling
// ---------------------------------------------------------------------------

function modFor(character, option) {
  return character.skills?.[option.skill] ?? 0;
}

function rollFor(character, option, rng) {
  const nat = d20(rng);
  const mod = modFor(character, option);
  return { id: character.id, name: character.name, nat, mod, total: nat + mod };
}

export function bestRoller(party, option) {
  return [...party].sort((a, b) => modFor(b, option) - modFor(a, option))[0];
}

function degreeFor(total, nat, dc, cfg) {
  const success = total >= dc;
  if (success) return nat === 20 || total >= dc + cfg.critMargin ? DEGREES.CRIT_SUCCESS : DEGREES.SUCCESS;
  return nat === 1 || total <= dc - cfg.critMargin ? DEGREES.CRIT_FAILURE : DEGREES.FAILURE;
}

/**
 * Roll one option for the party. This is the single resolve-check step: a later spend
 * window (proactive / reactive / all-in) hooks in here without touching routing or scoring.
 */
export function resolveOption(seq, run, node, option, party, rng = Math.random, opts = {}, cfg = DEFAULTS) {
  const dcInfo = effectiveDc(seq, run, node, option, cfg);
  const dc = dcInfo.total;
  const mode = option.rollMode ?? node.rollMode ?? ROLL_MODES.INDIVIDUAL;
  const lead = party.find((p) => p.id === opts.leadId) ?? bestRoller(party, option);
  const notes = [];
  let rolls = [];
  let groupTotal;
  let nat;
  let highlights = [];
  let degree;
  let quality = null;

  if (mode === ROLL_MODES.INDIVIDUAL) {
    const r = rollFor(lead, option, rng);
    rolls = [{ ...r, role: "roller" }];
    groupTotal = r.total;
    nat = r.nat;
  } else if (mode === ROLL_MODES.RALLY) {
    const r = rollFor(lead, option, rng);
    rolls = [{ ...r, role: "lead" }];
    const supportDc = option.supportDc ?? dc + cfg.supportDcOffset;
    let bonus = 0;
    for (const p of party.filter((x) => x.id !== lead.id)) {
      const s = rollFor(p, option, rng);
      const ok = s.total >= supportDc;
      const fumble = s.nat === 1;
      if (ok) bonus += 1;
      if (fumble) bonus -= 1;
      rolls.push({ ...s, role: "support", supportDc, ok, fumble });
    }
    groupTotal = r.total + bonus;
    nat = r.nat;
    notes.push(`Support adjusts the lead roll by ${bonus >= 0 ? "+" : ""}${bonus}`);
  } else if (mode === ROLL_MODES.WEAKEST) {
    rolls = party.map((p) => ({ ...rollFor(p, option, rng), role: "all" }));
    const low = rolls.reduce((a, b) => (b.total < a.total ? b : a));
    groupTotal = low.total;
    nat = low.nat;
    highlights = rolls.filter((r) => r.total >= dc && r.id !== low.id).map((r) => r.name);
    if (groupTotal < dc && highlights.length) {
      notes.push(`Personal bonus (extra info or position): ${highlights.join(", ")}`);
    }
  } else if (mode === ROLL_MODES.SOFT) {
    const r = rollFor(lead, option, rng);
    rolls = [{ ...r, role: "roller" }];
    groupTotal = r.total;
    nat = r.nat;
    quality = r.total >= dc ? "clean" : "costly";
    notes.push(quality === "clean" ? "Clean — something better happens" : "Costly — it works, but it takes something small");
  }

  if (mode === ROLL_MODES.SOFT) {
    degree = quality === "clean" && (nat === 20 || groupTotal >= dc + cfg.critMargin) ? DEGREES.CRIT_SUCCESS : DEGREES.SUCCESS;
  } else {
    degree = degreeFor(groupTotal, nat, dc, cfg);
  }

  const success = degree === DEGREES.SUCCESS || degree === DEGREES.CRIT_SUCCESS;
  return { mode, dc, dcInfo, rolls, groupTotal, nat, degree, success, highlights, quality, notes, leadId: lead.id };
}

// ---------------------------------------------------------------------------
// applying a result
// ---------------------------------------------------------------------------

const TAG_KINDS = {
  "Raise DC": "raise-dc",
  "Lock Approach": "lock-approach"
};

function tag(label, sourceOptionId, why) {
  return { id: Math.random().toString(36).slice(2, 9), label, kind: TAG_KINDS[label] ?? "note", sourceOptionId, why };
}

function bump(run, lane, delta, cfg) {
  if (!lane || !(lane in run.track)) return 0;
  const before = run.track[lane];
  run.track[lane] = Math.min(cfg.laneMax, Math.max(0, before + delta));
  return run.track[lane] - before;
}

function revealShapeHint(seq, run) {
  const shape = seq.hiddenShape ?? {};
  const known = new Set(run.revealed.map((r) => r.lane));
  const lane = Object.keys(shape).find((k) => !known.has(k));
  if (!lane) return null;
  const text = seq.shapeHints?.[lane] ?? `This audience cares about ${lane}.`;
  run.revealed.push({ lane, text });
  return { lane, text };
}

/** Returns a new run (input untouched) plus a list of human-readable events for the log. */
export function applyResult(seq, runIn, node, option, result, cfg = DEFAULTS) {
  const run = structuredClone(runIn);
  const events = [];
  const lane = option.lane || null;
  run.dcMod = 0; // a confirmed Raise DC only ever lasts one round

  let nextId;
  if (!option.requiresRoll || !result) {
    nextId = option.nextNodeId;
    const gained = bump(run, lane, option.laneDelta ?? 0, cfg);
    if (gained) events.push(`${lane} ${gained > 0 ? "+" : ""}${gained}`);
  } else {
    const d = result.degree;
    nextId = result.success ? option.successNodeId : option.failureNodeId;
    if (d === DEGREES.SUCCESS) {
      const g = bump(run, lane, 1, cfg);
      if (lane) events.push(g ? `${lane} +1` : `${lane} already at max`);
    } else if (d === DEGREES.CRIT_SUCCESS) {
      const g = bump(run, lane, 2, cfg);
      if (lane) events.push(g ? `${lane} +${g}` : `${lane} already at max`);
      const hint = revealShapeHint(seq, run);
      if (hint) events.push(`Read the room: ${hint.text}`);
    } else if (d === DEGREES.FAILURE || d === DEGREES.CRIT_FAILURE) {
      for (const label of option.failureTags ?? ["Raise DC"]) {
        run.pending.push(tag(label, option.id, `Failed: ${option.label}`));
        events.push(`Consequence queued: ${label}`);
      }
      if (d === DEGREES.CRIT_FAILURE) {
        for (const label of option.critFailureTags ?? ["Gain Exhaustion"]) {
          run.pending.push(tag(label, option.id, `Critical failure: ${option.label}`));
          events.push(`Consequence queued: ${label}`);
        }
        if (lane) {
          if ((run.track[lane] ?? 0) === 0) {
            run.crisis = true; // would drop below zero
            events.push(`${lane} would go negative — CRISIS`);
          } else {
            bump(run, lane, -1, cfg);
            events.push(`${lane} -1`);
            if (run.track[lane] === 0 && node.needsLane === lane) {
              run.pending.push(tag("Raise DC", option.id, `${lane} dropped to 0 on a stage that needed it`));
              events.push("Raise DC queued (lane hit 0 on a stage that needed it)");
            }
          }
        }
      }
    }
    if (option.revealsShape && result.success) {
      const hint = revealShapeHint(seq, run);
      if (hint) events.push(`Read the room: ${hint.text}`);
    }
  }

  run.round += 1;
  run.history.push({
    round: run.round,
    nodeId: node.id,
    optionId: option.id,
    label: option.label,
    mode: result?.mode ?? null,
    dc: result?.dc ?? null,
    degree: result?.degree ?? null,
    total: result?.groupTotal ?? null,
    events: [...events],
    trackAfter: { ...run.track }
  });

  const nextNode = nextId ? seq.nodes[nextId] : null;
  const capped = seq.rounds > 0 && run.round >= seq.rounds;
  run.nodeId = nextNode ? nextNode.id : null;
  if (!nextNode || isTerminal(nextNode) || capped) {
    run.finished = true;
    run.outcome = scoreOutcome(seq, run);
  }
  return { run, events };
}

/** GM confirms a queued consequence. Only Raise DC and Lock Approach change engine state in v1. */
export function confirmConsequence(seq, runIn, pendingId, cfg = DEFAULTS) {
  const run = structuredClone(runIn);
  const i = run.pending.findIndex((p) => p.id === pendingId);
  if (i < 0) return { run, applied: null };
  const [p] = run.pending.splice(i, 1);
  if (p.kind === "raise-dc") run.dcMod += cfg.raiseDcAmount;
  if (p.kind === "lock-approach" && !run.lockedOptions.includes(p.sourceOptionId)) run.lockedOptions.push(p.sourceOptionId);
  return { run, applied: p };
}

export function dismissConsequence(runIn, pendingId) {
  const run = structuredClone(runIn);
  run.pending = run.pending.filter((p) => p.id !== pendingId);
  return run;
}

// ---------------------------------------------------------------------------
// scoring
// ---------------------------------------------------------------------------

export function scoreOutcome(seq, run) {
  if (!seq.track) return { kind: "complete", text: OUTCOME_TEXT.complete };
  const total = Object.values(run.track).reduce((a, b) => a + b, 0);
  const threshold = seq.track.threshold ?? 0;
  const shape = seq.hiddenShape ?? {};
  const shapeMet = Object.entries(shape).every(([lane, req]) => (run.track[lane] ?? 0) >= req);
  const totalMet = total >= threshold;
  let kind;
  if (run.crisis) kind = "crisis";
  else if (totalMet && shapeMet) kind = "full";
  else if (totalMet) kind = "partial";
  else kind = "failure";
  return { kind, total, threshold, totalMet, shapeMet, text: seq.outcomeText?.[kind] ?? OUTCOME_TEXT[kind] };
}
