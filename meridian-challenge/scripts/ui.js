import { MODULE_ID, state } from "./state.js";
import * as C from "./controller.js";
import * as store from "./store.js";
import { SAMPLE_CHALLENGE } from "./sample-challenge.js";

const { ApplicationV2 } = foundry.applications.api;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

// ---------------------------------------------------------------------------
// shared challenge window (players + GMs)
// ---------------------------------------------------------------------------

function trackHtml(v) {
  if (!v.track) return "";
  const total = Object.values(v.trackValues).reduce((a, b) => a + b, 0);
  const lanes = v.track.lanes
    .map((lane) => {
      const val = v.trackValues[lane.key] ?? 0;
      const pips = Array.from({ length: v.track.max }, (_, i) => `<span class="mc-pip ${i < val ? "on" : ""}"></span>`).join("");
      return `<div class="mc-lane"><span class="mc-lane-name">${esc(lane.name)}</span><span class="mc-pips">${pips}</span><span class="mc-lane-val">${val}</span></div>`;
    })
    .join("");
  const rounds = v.rounds ? `<div class="mc-rounds">Round ${Math.min(v.round + (v.finished ? 0 : 1), v.rounds)} of ${v.rounds}</div>` : "";
  return `<div class="mc-track">${lanes}<div class="mc-total">Total ${total} / ${v.track.threshold}</div>${rounds}</div>`;
}

function resultHtml(r) {
  const cls = r.degree == null ? "" : r.success ? "ok" : "bad";
  const line = r.line ? `<div class="mc-line">${esc(r.line)}</div>` : "";
  const verdict = r.degreeLabel ? `<div class="mc-bigverdict ${cls} ${/critical/i.test(r.degreeLabel) ? "crit" : ""}">${esc(r.degreeLabel)}</div>` : "";
  return `<div class="mc-result-big ${cls}"><div class="mc-result-title">${esc(r.label)}</div>${line}${verdict}</div>`;
}

function gmResultHtml(r) {
  const rows = r.rolls
    .map((x) => {
      const tag = x.role === "lead" ? "lead" : x.role === "support" ? (x.ok ? "supports +1" : x.fumble ? "fumbles −1" : "no help") : "";
      return `<tr><td>${esc(x.name)}</td><td>${x.nat}${x.mod >= 0 ? "+" : ""}${x.mod} = <b>${x.total}</b></td><td>${tag}</td></tr>`;
    })
    .join("");
  return `<div class="mc-gm-box mc-gm-result"><b>What happened</b>
    ${r.explanation ? `<p class="mc-gm-expl">${esc(r.explanation)}</p>` : ""}
    ${r.rolls.length ? `<div class="mc-hint">${esc(r.modeLabel)}</div><table class="mc-rolls">${rows}</table><div><b>${r.groupTotal}</b> vs DC ${r.dc} — ${esc(r.degreeLabel)}</div>` : ""}
    ${r.notes.map((n) => `<div class="mc-hint">${esc(n)}</div>`).join("")}${eventsHtml(r.events)}</div>`;
}

const eventsHtml = (ev) => (ev.length ? `<ul class="mc-events">${ev.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "");

function outcomeHtml(o) {
  const detail = o.total !== undefined ? `<div class="mc-outcome-detail">Total ${o.total} / ${o.threshold} · ${o.shapeMet ? "the right kind of capital" : "the wrong kind of capital"}</div>` : "";
  return `<div class="mc-outcome ${esc(o.kind)}"><div class="mc-outcome-kind">${esc(o.kind.toUpperCase())}</div><div>${esc(o.text)}</div>${detail}</div>`;
}

function myActorId(v) {
  return v.party.find((p) => p.userId === game.user.id)?.id ?? null;
}

function bodyHtml(v, isCtl) {
  const parts = [];
  if (v.lastResult) {
    parts.push(resultHtml(v.lastResult));
    if (v.finished && v.outcome) parts.push(outcomeHtml(v.outcome));
    if (v.finished && v.node) parts.push(`<div class="mc-desc mc-epilogue">${esc(v.node.description)}</div>`);
    if (isCtl) parts.push(`<div class="mc-actions">${v.finished ? `<button data-act="restart">Run again</button><button data-act="close">Close for everyone</button>` : `<button data-act="continue">Continue</button>`}</div>`);
    else if (!v.finished) parts.push(`<div class="mc-wait">Waiting for the GM to continue…</div>`);
    return parts.join("");
  }
  if (v.finished) {
    if (v.outcome) parts.push(outcomeHtml(v.outcome));
    if (isCtl) parts.push(`<div class="mc-actions"><button data-act="restart">Run again</button><button data-act="close">Close for everyone</button></div>`);
    return parts.join("");
  }
  if (!v.node) return "";
  const me = myActorId(v);
  const totalVotes = Object.values(v.votes).filter(Boolean).length;
  const opts = v.node.options
    .map((o, idx) => {
      const n = v.counts[o.id] ?? 0;
      const pct = totalVotes ? Math.round((n / totalVotes) * 100) : 0;
      const mine = me && v.votes[me] === o.id;
      const tags = [];
      if (o.requiresRoll) tags.push(o.skill.toUpperCase());
      return `<button class="mc-vote ${o.locked ? "locked" : ""} ${mine ? "mine" : ""}" data-act="vote" data-id="${o.id}" ${o.locked || !me ? "disabled" : ""}>
        <span class="mc-fill" style="width:${pct}%"></span>
        <span class="mc-num">${idx + 1}:</span><span class="mc-label">${esc(o.label)}${o.locked ? ` <em>(${esc(o.reason)})</em>` : ""}${mine ? " ✓" : ""}</span>
        <span class="mc-tag">${esc(tags.join(" · "))}</span><span class="mc-count">${n}</span></button>`;
    })
    .join("");
  const names = v.party.map((p) => `<span class="mc-voter ${v.votes[p.id] ? "voted" : ""}">${esc(p.name)}</span>`).join("");
  parts.push(`<div class="mc-desc">${esc(v.node.description)}</div>
    <div class="mc-mode-badge">${esc(v.node.modeLabel)}</div><div class="mc-options">${opts}</div>
    <div class="mc-voters">${names}</div>
    ${!me && !isCtl ? `<div class="mc-wait">You are not in this challenge.</div>` : ""}
    ${v.tie ? `<div class="mc-wait">Tied — the GM breaks it.</div>` : ""}`);
  return parts.join("");
}

function gmHtml(v, g) {
  const parts = [];
  if (g.hiddenShape) {
    parts.push(`<div class="mc-gm-box"><b>Hidden shape</b> ${Object.entries(g.hiddenShape).map(([k, n]) => `${k}≥${n}`).join(", ")} <span class="mc-hint">· revealed: ${g.revealedLanes.length ? g.revealedLanes.join(", ") : "nothing yet"}</span></div>`);
  }
  if (g.result) parts.push(gmResultHtml(g.result));
  if (g.dcMod || g.lockedCount) parts.push(`<div class="mc-gm-box">Active: ${g.dcMod ? `DC +${g.dcMod} next round. ` : ""}${g.lockedCount ? `Closed approaches: ${g.lockedCount}` : ""}</div>`);
  if (g.canVote) {
    const rows = v.party
      .map((p) => {
        const label = p.userId ? `${esc(p.name)} <span class="mc-hint">(${esc(p.userName)})</span>` : `${esc(p.name)} <span class="mc-hint">(GM votes)</span>`;
        return `<div class="mc-simrow"><span>${label}</span><select data-act="gmvote" data-actor="${p.id}"><option value="">— no vote —</option>${g.options.map((o) => `<option value="${o.id}" ${o.locked ? "disabled" : ""} ${v.votes[p.id] === o.id ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></div>`;
      })
      .join("");
    parts.push(`<div class="mc-gm-box"><b>Votes</b>${rows}<button data-act="autovote">Auto-vote the rest</button></div>`);
  }
  if (g.tieOptions) {
    parts.push(`<div class="mc-gm-box"><b>Tie — pick the winner</b>${g.tieOptions.map((o) => `<button data-act="tie" data-id="${o.id}">${esc(o.label)}</button>`).join("")}</div>`);
  } else if (g.winner) {
    const w = g.winner;
    const dc = w.dc
      ? `<div class="mc-dc">Base ${w.dc.base}${w.dc.visible.map((m) => `<div>${m.value >= 0 ? "+" : ""}${m.value} ${esc(m.label)} <span class="vis">(players see)</span></div>`).join("")}${w.dc.hidden.map((m) => `<div>${m.value >= 0 ? "+" : ""}${m.value} ${esc(m.label)} <span class="hid">(hidden)</span></div>`).join("")}<div><b>Real DC ${w.dc.total}</b></div></div>`
      : "";
    const lead = w.canPickLead
      ? `<label class="mc-hint">Roller / lead <select data-act="lead"><option value="">Auto (${esc(w.best)})</option>${v.party.map((p) => `<option value="${p.id}" ${g.leadId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>`
      : "";
    parts.push(`<div class="mc-gm-box"><b>${esc(w.option.label)}</b><div class="mc-hint">${esc(w.modeLabel)}</div>${dc}${lead}<button data-act="roll">${w.option.requiresRoll ? "Roll" : "Advance"}</button></div>`);
  } else if (g.waitingForVotes) {
    parts.push(`<div class="mc-gm-box mc-hint">Waiting for every player to vote.</div>`);
  }
  if (g.pending.length) {
    parts.push(`<div class="mc-gm-box"><b>Consequences to confirm</b>${g.pending.map((p) => `<div class="mc-pending"><span class="kind ${p.kind}">${esc(p.label)}</span> <span class="mc-hint">${esc(p.why)}</span><br><button data-act="confirm" data-id="${p.id}">${p.kind === "note" ? "Acknowledge" : "Apply"}</button>${p.kind === "note" ? "" : `<button data-act="dismiss" data-id="${p.id}">Dismiss</button>`}</div>`).join("")}<div class="mc-hint">Raise DC and Lock Approach change the run. Others are reminders for you at the table.</div></div>`);
  }
  return `<div class="mc-gm"><div class="mc-gm-title">GM panel</div>${parts.join("")}</div>`;
}

export class ChallengeWindow extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "meridian-challenge-window",
    classes: ["meridian-challenge", "mc-challenge-window"],
    window: { title: "Challenge", resizable: true },
    position: { width: 1120, height: 1000 }
  };

  get title() {
    return state.view?.name || "Challenge";
  }

  async _renderHTML() {
    const v = state.view;
    if (!v) return "";
    const g = C.gmView();
    const fade = state.lastScene !== v.scene;
    state.lastScene = v.scene;
    const scene = `<div class="mc-scene">${v.scene ? `<img class="${fade ? "mc-fade" : ""}" src="${esc(v.scene)}" alt="">` : ""}</div>`;
    const main = `<div class="mc-main">${trackHtml(v)}${v.revealed.length ? `<div class="mc-learned"><b>What you've read in the room</b>${v.revealed.map((r) => `<div>· ${esc(r.text)}</div>`).join("")}</div>` : ""}${bodyHtml(v, !!g)}</div>`;
    return `<div class="mc-frame"><div class="mc-stone"><div class="mc-card"><div class="mc-card-in">${scene}<div class="mc-wrap">${main}</div></div></div>${g ? gmHtml(v, g) : ""}</div></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender() {
    const el = this.element;
    el.querySelectorAll("[data-act]").forEach((n) => {
      const act = n.dataset.act;
      const evt = n.tagName === "SELECT" ? "change" : "click";
      n.addEventListener(evt, () => handle(act, n));
    });
  }

  async close(options) {
    state.window = null;
    return super.close(options);
  }
}

async function handle(act, n) {
  switch (act) {
    case "vote": {
      const ctl = state.view?.controllerId;
      try {
        if (ctl === game.user.id) return; // a GM never votes through the player route
        await state.socket.executeAsUser("castVote", ctl, game.user.id, n.dataset.id);
      } catch (err) {
        ui.notifications.warn("Meridian Challenge: the GM running this challenge is not connected.");
      }
      return;
    }
    case "gmvote": return C.gmVote(n.dataset.actor, n.value);
    case "autovote": return C.autoVote(true);
    case "tie": return C.breakTie(n.dataset.id);
    case "lead": return C.setLead(n.value);
    case "roll": return C.doRoll();
    case "confirm": return C.confirmPending(n.dataset.id);
    case "dismiss": return C.dismissPending(n.dataset.id);
    case "continue": return C.continueRun();
    case "restart": return C.restart();
    case "close": return C.closeAll();
  }
}

/** socketlib "sync" handler: runs on every client. */
export function onSync(view) {
  if (view?.closed) {
    state.view = null;
    state.window?.close();
    state.window = null;
    return;
  }
  state.view = view;
  if (!state.window) state.window = new ChallengeWindow();
  state.window.render({ force: true });
}

// ---------------------------------------------------------------------------
// GM manager
// ---------------------------------------------------------------------------

async function editJson(seq) {
  const text = JSON.stringify(seq, null, 2);
  const json = await foundry.applications.api.DialogV2.prompt({
    window: { title: seq.name ? `Edit: ${seq.name}` : "New sequence" },
    content: `<textarea name="json" style="width:100%;height:60vh;font:12px ui-monospace,monospace;" spellcheck="false">${esc(text)}</textarea>`,
    ok: { label: "Save", callback: (event, button) => button.form.elements.json.value },
    position: { width: 720 },
    rejectClose: false
  });
  if (!json) return null;
  try {
    return await store.save(JSON.parse(json));
  } catch (err) {
    ui.notifications.error(`Not saved: ${err.message}`);
    return null;
  }
}

export class ChallengeManager extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "meridian-challenge-manager",
    classes: ["meridian-challenge"],
    window: { title: "Challenges", resizable: true },
    position: { width: 560, height: "auto" }
  };

  async _renderHTML() {
    const all = Object.values(store.getAll());
    const rows = all.length
      ? all.map((s) => `<div class="mc-mgr-row"><span class="mc-mgr-name">${esc(s.name || "(untitled)")}<em>${esc(s.type || "")} · ${Object.keys(s.nodes ?? {}).length} nodes</em></span>
          <button data-act="start" data-id="${s.id}">Start</button><button data-act="edit" data-id="${s.id}">Edit JSON</button>
          <button data-act="dup" data-id="${s.id}">Duplicate</button><button data-act="del" data-id="${s.id}">Delete</button></div>`).join("")
      : `<div class="mc-hint" style="padding:.6rem">No sequences yet. Add the sample to try it.</div>`;
    return `<div class="mc-wrap mc-mgr">${rows}
      <div class="mc-actions"><button data-act="sample">+ Add sample challenge</button><button data-act="new">+ New (JSON)</button></div></div>`;
  }

  _replaceHTML(result, content) {
    content.innerHTML = result;
  }

  _onRender() {
    this.element.querySelectorAll("[data-act]").forEach((n) => n.addEventListener("click", () => this.#act(n.dataset.act, n.dataset.id)));
  }

  async #act(act, id) {
    if (act === "start") return void (await C.startChallenge(id));
    if (act === "sample") {
      await store.save({ ...foundry.utils.deepClone(SAMPLE_CHALLENGE), id: foundry.utils.randomID() });
    } else if (act === "new") {
      await editJson({ ...foundry.utils.deepClone(SAMPLE_CHALLENGE), id: null, name: "New challenge" });
    } else if (act === "edit") {
      await editJson(store.get(id));
    } else if (act === "dup") {
      const s = store.get(id);
      await store.save({ ...s, id: foundry.utils.randomID(), name: `${s.name} (copy)` });
    } else if (act === "del") {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete sequence" }, content: "<p>Delete this sequence? This cannot be undone.</p>", rejectClose: false });
      if (ok) await store.remove(id);
    }
    this.render({ force: true });
  }
}
