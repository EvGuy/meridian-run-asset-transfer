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
      image: "modules/meridian-challenge/assets/scenes/cookfire.png",
      description: "Past the wagons, a cookfire crowd of drovers and wagon-hands has gone quiet. They have heard a rumour about you and nobody has asked you a question yet.",
      options: [
        { id: "c-plain", successText: "You talk the way they talk, no polish and no angles. Someone passes you a tin cup. The ring loosens by a hand's width.", failureText: "It comes out sounding rehearsed. A few drovers trade looks, and someone mutters that plain talk is cheap.", label: "Speak plainly, as one of them", requiresRoll: true, skill: "per", lane: "T", dc: 12, successNodeId: "guard", failureNodeId: "sour", failureTags: ["Raise DC"] },
        { id: "c-read", successText: "You let the silence work and read it: the fear is not about you, it is about what the rumour costs them. You know now whose approval matters here.", failureText: "You watch and learn nothing useful, and the pause drags on until it reads as hesitation.", label: "Watch the room before speaking", requiresRoll: true, skill: "ins", lane: "", dc: 11, revealsShape: true, successNodeId: "guard", failureNodeId: "guard", failureTags: [] },
        { id: "c-fear", successText: "One level look and one quiet remark about who spreads rumours when the wagons run short of water. The talk dies. Nobody meets your eye, but nobody repeats the name.", failureText: "The threat lands wrong. You hear it come back to you as a mutter: so that is how it is with them.", label: "Make them think twice about the rumour", requiresRoll: true, skill: "itm", lane: "S", dc: 13, successNodeId: "guard", failureNodeId: "sour", failureTags: ["Lock Approach"] }
      ]
    },
    sour: {
      id: "sour",
      rollMode: ROLL_MODES.WEAKEST,
      image: "modules/meridian-challenge/assets/scenes/sour.png",
      description: "Someone near the back says a name out loud. Heads turn. The mood has shifted and everyone has to hold their face together.",
      options: [
        { id: "s-calm", successText: "You take the moment: hands open, voices low, every one of you giving the same short answer. The mood bleeds out of the circle.", failureText: "You get them quiet, not calm. It is the kind of silence that remembers.", label: "Settle the crowd, all of you together", requiresRoll: true, skill: "per", lane: "T", dc: 13, successNodeId: "guard", failureNodeId: "guard", failureTags: ["Raise DC"] }
      ]
    },
    guard: {
      id: "guard",
      rollMode: ROLL_MODES.INDIVIDUAL,
      image: "modules/meridian-challenge/assets/scenes/guard.png",
      description: "The veteran gate-guard blocks the lantern-lit steps to the muster hall, arms folded. He has seen a lot of people who talked well and carried nothing.",
      options: [
        { id: "g-prove", successText: "You take the veteran's measure and he takes yours. You hand him your end of a heavy crate without being asked. He grunts and steps half aside.", failureText: "He watches you fumble something simple and decides what he thinks of you. He lets you by anyway, unimpressed.", label: "Show you are no liability", requiresRoll: true, skill: "ath", lane: "S", dc: 13, successNodeId: "ledger", failureNodeId: "ledger", failureTags: ["Raise DC"] },
        { id: "g-vouch", successText: "A drover calls up from the cookfire that you are alright. Then another. The guard weighs the voices, and the steps are clear.", failureText: "A voice calls out, thin and half-hearted. It is enough to pass and not enough to matter.", label: "Let the cookfire crowd vouch for you", requiresRoll: true, skill: "per", lane: "S", dc: 11, unlock: { lane: "T", min: 1 }, successNodeId: "ledger", failureNodeId: "ledger" }
      ]
    },
    ledger: {
      id: "ledger",
      rollMode: ROLL_MODES.RALLY,
      needsLane: "L",
      image: "modules/meridian-challenge/assets/scenes/ledger.png",
      description: "Inside, the quartermaster has the supply tallies open on a trestle table. She cares about numbers and nothing else tonight.",
      options: [
        { id: "l-tally", successText: "You turn her own figures back on themselves: a clean sum, a gap closed. She stops writing and looks at you for the first time.", failureText: "Your figures do not reconcile with hers, and she says so, precisely, and moves on.", label: "Lay out the supply tallies", requiresRoll: true, skill: "inv", lane: "L", dc: 13, successNodeId: "master", failureNodeId: "master" },
        { id: "l-route", successText: "You name the old route-ledger and the winter of the washed-out ford. She pulls a stained volume from the shelf. Yes. That is the one.", failureText: "The citation is close but wrong. She corrects you without malice and without much interest.", label: "Cite the old route-ledger", requiresRoll: true, skill: "his", lane: "L", dc: 12, successNodeId: "master", failureNodeId: "master", failureTags: ["Lock Approach"] }
      ]
    },
    master: {
      id: "master",
      rollMode: ROLL_MODES.INDIVIDUAL,
      finalStage: true,
      image: "modules/meridian-challenge/assets/scenes/master.png",
      description: "The caravan master looks up from the table. Everything the hall has seen of you is now on the record. She asks one question.",
      options: [
        { id: "m-case", successText: "You say it straight and in order, with nothing hidden that matters. She holds your gaze a long moment, then nods once.", failureText: "The case holds, barely. She has heard better, and she lets you know she knows it.", label: "Make your case", requiresRoll: true, skill: "per", lane: "T", dc: 14, successNodeId: "end", failureNodeId: "end", failureTags: ["Raise DC"] },
        { id: "m-proof", successText: "You lay what you have gathered on the table piece by piece. Each one lands where it needs to.", failureText: "The pieces are real but they do not join. She leaves them where they lie.", label: "Put what you have gathered on the table", requiresRoll: true, skill: "inv", lane: "L", dc: 14, successNodeId: "end", failureNodeId: "end" }
      ]
    },
    end: {
      id: "end",
      image: "modules/meridian-challenge/assets/scenes/end.png",
      description: "The master closes the ledger.",
      options: []
    }
  }
};
