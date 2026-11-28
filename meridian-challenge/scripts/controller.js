/**
 * GM-side controller. Exactly one GM client (the one that started the challenge) holds the
 * authoritative run. It broadcasts a PUBLIC view to everyone; hidden data (the shape
 * requirement, hidden DC modifiers, queued consequences) never leaves this client.
 */
import { MODULE_ID, state } from "./state.js";
import * as store from "./store.js";
import {
  createRun, availableOptions, resolveOption, applyResult, confirmConsequence, dismissConsequence,
  tallyVotes, effectiveDc, bestRoller, ROLL_MODES, DEGREES, DEFAULTS
} from "./engine.js";

const SKILL_KEYS = ["acr", "ani", "arc", "ath", "dec", "his", "ins", "itm", "inv", "med", "nat", "prc", "prf", "per", "rel", "slt", "ste", "sur"];

export const MODE_LABEL = {
  [ROLL_MODES.INDIVIDUAL]: "Individual — one roller",
  [ROLL_MODES.RALLY]: "Group Rally — lead rolls, others support",
  [ROLL_MODES.WEAKEST]: "Weakest Link — lowest roll is the group",
  [ROLL_MODES.SOFT]: "Soft Roll — it works, the roll sets the cost"
};
export const DEGREE_LABEL = {
  [DEGREES.CRIT_SUCCESS]: "Critical success",
  [DEGREES.SUCCESS]: "Success",
  [DEGREES.FAILURE]: "Failure",
  [DEGREES.CRIT_FAILURE]: "Critical failure"
};

const isController = () => !!state.ctl && state.ctl.controllerId === game.user.id;

function freshUi() {
  return { votes: {}, winnerId: null, tie: null, lastResult: null, leadId: "" };
}

function userFor(actor) {
  return game.users.find((u) => !u.isGM && u.character?.id === actor.id) ?? null;
}

function toParty(actor) {
  const skills = {};
  for (const k of SKILL_KEYS) {
    const s = actor.system?.skills?.[k];
    skills[k] = Number(s?.total ?? s?.mod ?? 0);
  }
  const user = userFor(actor);
  return { id: actor.id, name: actor.name, img: actor.img, skills, userId: user?.id ?? null, userName: user?.name ?? null };
}

// ---------------------------------------------------------------------------
// start / stop
// ---------------------------------------------------------------------------

async function pickParty() {
  const candidates = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
  if (!candidates.length) {
    ui.notifications.warn("Meridian Challenge: no player characters found.");
    return null;
  }
  const online = new Set(candidates.filter((a) => userFor(a)?.active).map((a) => a.id));
  const checked = (a) => (online.size ? online.has(a.id) : true);
  const rows = candidates
    .map((a) => {
      const u = userFor(a);
      return `<label style="display:flex;gap:.5rem;align-items:center;margin:.15rem 0;">
        <input type="checkbox" name="actor" value="${a.id}" ${checked(a) ? "checked" : ""}>
        <span>${foundry.utils.escapeHTML(a.name)}</span>
        <em style="opacity:.6;font-size:.8em;">${u ? `${foundry.utils.escapeHTML(u.name)}${u.active ? " (online)" : " (offline)"}` : "no player assigned"}</em></label>`;
    })
    .join("");
  const ids = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Who is in this challenge?" },
    content: `<p style="margin-top:0">Online players are pre-checked. Anyone offline or unassigned is voted for from the GM panel.</p>${rows}`,
    ok: { label: "Start", callback: (event, button) => new FormData(button.form).getAll("actor") },
    rejectClose: false
  });
  if (!ids?.length) return null;
  return ids.map((id) => game.actors.get(id)).filter(Boolean);
}

export async function startChallenge(seqId, actorsOverride) {
  if (!game.user.isGM) return ui.notifications.warn("Only a GM can start a challenge.");
  const seq = store.get(seqId);
  if (!seq) return ui.notifications.error("Meridian Challenge: sequence not found.");
  const actors = actorsOverride ?? (await pickParty());
  if (!actors) return;
  state.ctl = { seq, run: createRun(seq), party: actors.map(toParty), ui: freshUi(), controllerId: game.user.id };
  await broadcast();
}

export async function closeAll() {
  state.ctl = null;
  await state.socket.executeForEveryone("sync", { closed: true });
}

export async function restart() {
  if (!isController()) return;
  const { seq, party } = state.ctl;
  state.ctl = { seq, run: createRun(seq), party, ui: freshUi(), controllerId: game.user.id };
  await broadcast();
}

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------

function currentNode() {
  const { seq, run } = state.ctl;
  return run.nodeId ? seq.nodes[run.nodeId] : null;
}

function votesByActor() {
  return state.ctl.ui.votes;
}

function publicResult(lr) {
  if (!lr) return null;
  const { option, result, events } = lr;
  return {
    label: option.label,
    mode: result?.mode ?? null,
    modeLabel: result ? MODE_LABEL[result.mode] : null,
    rolls: result?.rolls.map((r) => ({ name: r.name, nat: r.nat, mod: r.mod, total: r.total, role: r.role, ok: r.ok, fumble: r.fumble })) ?? [],
    dc: result?.dcInfo.shown ?? null,
    groupTotal: result?.groupTotal ?? null,
    degree: result?.degree ?? null,
    degreeLabel: result ? DEGREE_LABEL[result.degree] : null,
    success: result?.success ?? null,
    notes: result?.notes ?? [],
    events: events.filter((e) => !/CRISIS|Consequence queued/.test(e))
  };
}

export function publicView() {
  const { seq, run, party, ui } = state.ctl;
  const node = currentNode();
  const avail = node && !run.finished ? availableOptions(seq, run, node) : [];
  const counts = node ? tallyVotes(node.options, votesByActor()).counts : {};
  return {
    closed: false,
    controllerId: state.ctl.controllerId,
    name: seq.name,
    track: seq.track ? { lanes: seq.track.lanes, threshold: seq.track.threshold, max: DEFAULTS.laneMax } : null,
    trackValues: run.track,
    rounds: seq.rounds,
    round: run.round,
    finished: run.finished,
    revealed: run.revealed,
    node: node
      ? {
          id: node.id,
          description: node.description,
          image: node.image || "",
          modeLabel: MODE_LABEL[node.rollMode ?? ROLL_MODES.INDIVIDUAL],
          options: avail.map((a) => ({
            id: a.option.id,
            label: a.option.label,
            skill: a.option.skill || "",
            lane: a.option.lane || "",
            requiresRoll: !!a.option.requiresRoll,
            locked: a.locked,
            reason: a.reason,
            dc: a.dc.shown
          }))
        }
      : null,
    counts,
    votes: votesByActor(),
    party: party.map((p) => ({ id: p.id, name: p.name, img: p.img, userId: p.userId, userName: p.userName })),
    tie: !!ui.tie,
    resolved: !!ui.winnerId,
    lastResult: publicResult(ui.lastResult),
    outcome: run.finished ? run.outcome : null
  };
}

/** Controller-only data: never broadcast. */
export function gmView() {
  if (!isController()) return null;
  const { seq, run, party, ui } = state.ctl;
  const node = currentNode();
  let winner = null;
  if (node && ui.winnerId) {
    const option = node.options.find((o) => o.id === ui.winnerId);
    const mode = option.rollMode ?? node.rollMode ?? ROLL_MODES.INDIVIDUAL;
    winner = {
      option,
      mode,
      modeLabel: MODE_LABEL[mode],
      dc: option.requiresRoll ? effectiveDc(seq, run, node, option) : null,
      best: option.skill ? bestRoller(party, option).name : party[0].name,
      canPickLead: option.requiresRoll && mode !== ROLL_MODES.WEAKEST
    };
  }
  return {
    hiddenShape: seq.hiddenShape ?? null,
    revealedLanes: run.revealed.map((r) => r.lane),
    pending: run.pending,
    dcMod: run.dcMod,
    lockedCount: run.lockedOptions.length,
    tieOptions: ui.tie ? ui.tie.map((id) => node.options.find((o) => o.id === id)) : null,
    winner,
    leadId: ui.leadId,
    waitingForVotes: !!node && !run.finished && !ui.lastResult && !ui.winnerId && !ui.tie,
    canVote: !!node && !run.finished && !ui.lastResult,
    options: node && !run.finished ? availableOptions(seq, run, node).map((a) => ({ id: a.option.id, label: a.option.label, locked: a.locked })) : []
  };
}

export async function broadcast() {
  if (!state.ctl) return;
  await state.socket.executeForEveryone("sync", publicView());
}

// ---------------------------------------------------------------------------
// voting
// ---------------------------------------------------------------------------

function updateVoteState() {
  const { run, party, ui } = state.ctl;
  ui.winnerId = null;
  ui.tie = null;
  const node = currentNode();
  if (!node || run.finished) return;
  if (!party.every((p) => ui.votes[p.id])) return;
  const { winners } = tallyVotes(node.options, ui.votes);
  if (winners.length === 1) ui.winnerId = winners[0];
  else if (winners.length > 1) ui.tie = winners;
}

function optionOpen(optionId) {
  const node = currentNode();
  const a = availableOptions(state.ctl.seq, state.ctl.run, node).find((x) => x.option.id === optionId);
  return !!a && !a.locked;
}

/** Runs on the controller; players reach it through socketlib executeAsUser. */
export async function castVote(userId, optionId) {
  if (!isController()) return;
  const { party, ui, run } = state.ctl;
  if (run.finished || ui.lastResult) return;
  const member = party.find((p) => p.userId && p.userId === userId);
  if (!member || !optionOpen(optionId)) return;
  ui.votes[member.id] = optionId;
  updateVoteState();
  await broadcast();
}

export async function gmVote(actorId, optionId) {
  if (!isController()) return;
  const { ui, run } = state.ctl;
  if (run.finished || ui.lastResult) return;
  if (!optionId) delete ui.votes[actorId];
  else if (optionOpen(optionId)) ui.votes[actorId] = optionId;
  updateVoteState();
  await broadcast();
}

export async function autoVote(onlyUnvoted = true) {
  if (!isController()) return;
  const { party, ui } = state.ctl;
  const node = currentNode();
  const open = availableOptions(state.ctl.seq, state.ctl.run, node).filter((a) => !a.locked);
  if (!open.length) return;
  for (const p of party) {
    if (onlyUnvoted && ui.votes[p.id]) continue;
    ui.votes[p.id] = open[Math.floor(Math.random() * open.length)].option.id;
  }
  updateVoteState();
  await broadcast();
}

export async function breakTie(optionId) {
  if (!isController()) return;
  state.ctl.ui.winnerId = optionId;
  state.ctl.ui.tie = null;
  await broadcast();
}

export async function setLead(leadId) {
  if (isController()) state.ctl.ui.leadId = leadId;
}

// ---------------------------------------------------------------------------
// rolling
// ---------------------------------------------------------------------------

const rng = () => (CONFIG.Dice?.randomUniform ? CONFIG.Dice.randomUniform() : Math.random());

function chatCard(node, option, result, events, run) {
  const esc = foundry.utils.escapeHTML;
  const rows = result
    ? result.rolls.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.nat}${r.mod >= 0 ? "+" : ""}${r.mod} = <b>${r.total}</b></td><td>${r.role === "lead" ? "lead" : r.role === "support" ? (r.ok ? "supports +1" : r.fumble ? "fumbles −1" : "no help") : ""}</td></tr>`).join("")
    : "";
  const shown = events.filter((e) => !/CRISIS|Consequence queued/.test(e));
  return `<div class="mc-chat">
    <h3>${esc(option.label)}</h3>
    ${result ? `<div class="mc-chat-mode">${esc(MODE_LABEL[result.mode])}</div><table>${rows}</table>
    <p><b>${result.groupTotal}</b> vs DC ${result.dcInfo.shown} — <b>${DEGREE_LABEL[result.degree]}</b></p>` : ""}
    ${shown.length ? `<ul>${shown.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    ${run.finished ? `<p><b>${esc(run.outcome.kind.toUpperCase())}</b> — ${esc(run.outcome.text)}</p>` : ""}
  </div>`;
}

export async function doRoll() {
  if (!isController()) return;
  const { seq, run, party, ui } = state.ctl;
  const node = currentNode();
  const option = node?.options.find((o) => o.id === ui.winnerId);
  if (!option) return;
  const result = option.requiresRoll ? resolveOption(seq, run, node, option, party, rng, { leadId: ui.leadId || undefined }) : null;
  const { run: next, events } = applyResult(seq, run, node, option, result);
  state.ctl.run = next;
  state.ctl.ui = { ...freshUi(), lastResult: { node, option, result, events } };
  await ChatMessage.create({ content: chatCard(node, option, result, events, next), speaker: { alias: seq.name || "Challenge" } });
  await broadcast();
}

export async function confirmPending(id) {
  if (!isController()) return;
  state.ctl.run = confirmConsequence(state.ctl.seq, state.ctl.run, id).run;
  await broadcast();
}

export async function dismissPending(id) {
  if (!isController()) return;
  state.ctl.run = dismissConsequence(state.ctl.run, id);
  await broadcast();
}

export async function continueRun() {
  if (!isController()) return;
  state.ctl.ui.lastResult = null;
  await broadcast();
}

export const controllerActive = isController;
