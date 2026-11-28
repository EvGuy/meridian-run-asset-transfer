// Sample content for the preview + tests. Placeholder fiction, not canon.
import { SOCIAL_LANES, ROLL_MODES } from "./engine.js";

export const SAMPLE_PARTY = [
  { id: "envoy",  name: "Envoy",  skills: { per: 6, dec: 5, ins: 3, itm: 1, inv: 2, his: 1, ath: 0 } },
  { id: "guard",  name: "Guard",  skills: { ath: 5, itm: 5, per: 1, ins: 2, inv: 1, his: 0, dec: 0 } },
  { id: "vizier", name: "Vizier", skills: { his: 6, inv: 6, per: 2, ins: 4, itm: 0, ath: 0, dec: 1 } }
];

export const SAMPLE_CHALLENGE = {
  schemaVersion: 1,
  id: "sample-muster-hearing",
  name: "Sample: The Muster Hall Hearing",
  type: "social",
  rounds: 4,
  track: { lanes: SOCIAL_LANES, start: { T: 0, S: 0, L: 0 }, threshold: 3 },
  hiddenShape: { T: 2 },
  shapeHints: { T: "They don't want the best argument. They want someone they believe." },
  outcomeText: {
    full: "The hall believes you. The caravan master signs the passage terms as written.",
    partial: "You get the passage — on the master's terms, with a debt attached.",
    failure: "The hall turns away. You leave with less standing than you arrived with.",
    crisis: "Something said tonight will not be forgotten, and not in your favour."
  },
  startNodeId: "cookfire",
  nodes: {
    cookfire: {
      id: "cookfire",
      rollMode: ROLL_MODES.RALLY,
      image: "",
      description: "Past the wagons, a cookfire crowd of drovers and wagon-hands has gone quiet. They have heard a rumour about you and nobody has asked you a question yet.",
      options: [
        { id: "c-plain", label: "Speak plainly, as one of them", requiresRoll: true, skill: "per", lane: "T", dc: 12, successNodeId: "guard", failureNodeId: "sour", failureTags: ["Raise DC"] },
        { id: "c-read", label: "Watch the room before speaking", requiresRoll: true, skill: "ins", lane: "", dc: 11, revealsShape: true, successNodeId: "guard", failureNodeId: "guard", failureTags: [] },
        { id: "c-fear", label: "Make them think twice about the rumour", requiresRoll: true, skill: "itm", lane: "S", dc: 13, successNodeId: "guard", failureNodeId: "sour", failureTags: ["Lock Approach"] }
      ]
    },
    sour: {
      id: "sour",
      rollMode: ROLL_MODES.WEAKEST,
      image: "",
      description: "Someone near the back says a name out loud. Heads turn. The mood has shifted and everyone has to hold their face together.",
      options: [
        { id: "s-calm", label: "Settle the crowd, all of you together", requiresRoll: true, skill: "per", lane: "T", dc: 13, successNodeId: "guard", failureNodeId: "guard", failureTags: ["Raise DC"] }
      ]
    },
    guard: {
      id: "guard",
      rollMode: ROLL_MODES.INDIVIDUAL,
      image: "",
      description: "The veteran gate-guard blocks the lantern-lit steps to the muster hall, arms folded. He has seen a lot of people who talked well and carried nothing.",
      options: [
        { id: "g-prove", label: "Show you are no liability", requiresRoll: true, skill: "ath", lane: "S", dc: 13, successNodeId: "ledger", failureNodeId: "ledger", failureTags: ["Raise DC"] },
        { id: "g-vouch", label: "Let the cookfire crowd vouch for you", requiresRoll: true, skill: "per", lane: "S", dc: 11, unlock: { lane: "T", min: 1 }, successNodeId: "ledger", failureNodeId: "ledger" }
      ]
    },
    ledger: {
      id: "ledger",
      rollMode: ROLL_MODES.RALLY,
      needsLane: "L",
      image: "",
      description: "Inside, the quartermaster has the supply tallies open on a trestle table. She cares about numbers and nothing else tonight.",
      options: [
        { id: "l-tally", label: "Lay out the supply tallies", requiresRoll: true, skill: "inv", lane: "L", dc: 13, successNodeId: "master", failureNodeId: "master" },
        { id: "l-route", label: "Cite the old route-ledger", requiresRoll: true, skill: "his", lane: "L", dc: 12, successNodeId: "master", failureNodeId: "master", failureTags: ["Lock Approach"] }
      ]
    },
    master: {
      id: "master",
      rollMode: ROLL_MODES.INDIVIDUAL,
      finalStage: true,
      image: "",
      description: "The caravan master looks up from the table. Everything the hall has seen of you is now on the record. She asks one question.",
      options: [
        { id: "m-case", label: "Make your case", requiresRoll: true, skill: "per", lane: "T", dc: 14, successNodeId: "end", failureNodeId: "end", failureTags: ["Raise DC"] },
        { id: "m-proof", label: "Put what you have gathered on the table", requiresRoll: true, skill: "inv", lane: "L", dc: 14, successNodeId: "end", failureNodeId: "end" }
      ]
    },
    end: {
      id: "end",
      image: "",
      description: "The master closes the ledger.",
      options: []
    }
  }
};
