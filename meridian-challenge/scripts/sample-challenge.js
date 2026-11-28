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
        { id: "c-plain", successLine: "They let you in.", failureLine: "They didn't buy it.", successText: "You talk the way they talk: no polish, no angles. Someone passes you a tin cup, and the ring of drovers loosens by a hand's width. In play: the crowd now sees you as one of them. Trust goes up, and the way to the gate-guard is open with the cookfire at your back.", failureText: "It comes out sounding rehearsed. A few drovers trade looks and someone mutters that plain talk is cheap. In play: the mood sours, the next roll gets harder, and the scene moves to the crowd turning on the name that was spoken. Play it as a cold shoulder, not a threat.", label: "Speak plainly, as one of them", requiresRoll: true, skill: "per", lane: "T", dc: 12, successNodeId: "guard", failureNodeId: "sour", failureTags: ["Raise DC"] },
        { id: "c-read", successLine: "You read the room.", failureLine: "You missed the signs.", successText: "You let the silence work and read it: the fear is not about you, it is about what the rumour costs them. You now know whose approval matters here. In play: give the table one true detail about who is driving the whispering, and a hint at the shape of what the master will ask for later.", failureText: "You watch and learn nothing useful, and the pause drags on until it reads as hesitation. In play: nothing is revealed, nothing is lost, and the party moves on to the gate-guard slightly behind where they hoped to be.", label: "Watch the room before speaking", requiresRoll: true, skill: "ins", lane: "", dc: 11, revealsShape: true, successNodeId: "guard", failureNodeId: "guard", failureTags: [] },
        { id: "c-fear", successLine: "They backed off.", failureLine: "They didn't scare.", successText: "One level look and one quiet remark about who spreads rumours when the wagons run short of water. The talk dies. Nobody meets your eye, but nobody repeats the name. In play: Status goes up, but people will remember you used it. Do not give them warmth for this.", failureText: "The threat lands wrong. You hear it come back to you as a mutter: so that is how it is with them. In play: that approach is closed for the rest of the hearing, and the crowd turns sour before the party can leave.", label: "Make them think twice about the rumour", requiresRoll: true, skill: "itm", lane: "S", dc: 13, successNodeId: "guard", failureNodeId: "sour", failureTags: ["Lock Approach"] }
      ]
    },
    sour: {
      id: "sour",
      rollMode: ROLL_MODES.WEAKEST,
      image: "modules/meridian-challenge/assets/scenes/sour.png",
      description: "Someone near the back says a name out loud. Heads turn. The mood has shifted and everyone has to hold their face together.",
      options: [
        { id: "s-calm", successLine: "The room settles.", failureLine: "The mood holds.", successText: "Hands open, voices low, every one of you giving the same short answer. The mood bleeds out of the circle and the drovers drift back to their fire. In play: Trust goes up and the gate-guard is only a short walk away.", failureText: "You get them quiet, not calm. It is the kind of silence that remembers. In play: the party passes through, but the next roll is harder and the guard will have heard the story before you reach him.", label: "Settle the crowd, all of you together", requiresRoll: true, skill: "per", lane: "T", dc: 13, successNodeId: "guard", failureNodeId: "guard", failureTags: ["Raise DC"] }
      ]
    },
    guard: {
      id: "guard",
      rollMode: ROLL_MODES.INDIVIDUAL,
      image: "modules/meridian-challenge/assets/scenes/guard.png",
      description: "The veteran gate-guard blocks the lantern-lit steps to the muster hall, arms folded. He has seen a lot of people who talked well and carried nothing.",
      options: [
        { id: "g-prove", successLine: "He steps aside.", failureLine: "He's not impressed.", successText: "You take the veteran's measure and he takes yours. You hand him your end of a heavy crate without being asked, and he grunts and steps half aside. In play: Status goes up. He will speak well of you to the quartermaster in a grudging way.", failureText: "He watches you fumble something simple and decides what he thinks of you. He lets you by anyway, unimpressed. In play: no gain in Status, and the next roll is harder because he warns the quartermaster.", label: "Show you are no liability", requiresRoll: true, skill: "ath", lane: "S", dc: 13, successNodeId: "ledger", failureNodeId: "ledger", failureTags: ["Raise DC"] },
        { id: "g-vouch", successLine: "They spoke for you.", failureLine: "Nobody spoke up.", successText: "A drover calls up from the cookfire that you are alright. Then another. The guard weighs the voices and the steps are clear. In play: Status goes up on the back of the Trust you built earlier. Name the drover who spoke first.", failureText: "A voice calls out, thin and half-hearted. It is enough to pass and not enough to matter. In play: the party reaches the quartermaster with no standing gained.", label: "Let the cookfire crowd vouch for you", requiresRoll: true, skill: "per", lane: "S", dc: 11, unlock: { lane: "T", min: 1 }, successNodeId: "ledger", failureNodeId: "ledger" }
      ]
    },
    ledger: {
      id: "ledger",
      rollMode: ROLL_MODES.RALLY,
      needsLane: "L",
      image: "modules/meridian-challenge/assets/scenes/ledger.png",
      description: "Inside, the quartermaster has the supply tallies open on a trestle table. She cares about numbers and nothing else tonight.",
      options: [
        { id: "l-tally", successLine: "The numbers held.", failureLine: "The numbers didn't add up.", successText: "You turn her own figures back on themselves: a clean sum, a gap closed. She stops writing and looks at you for the first time. In play: Leverage goes up and the master will hear that your numbers were honest.", failureText: "Your figures do not reconcile with hers, and she says so, precisely, and moves on. In play: no Leverage gained, and the master will hear that the party's sums were sloppy.", label: "Lay out the supply tallies", requiresRoll: true, skill: "inv", lane: "L", dc: 13, successNodeId: "master", failureNodeId: "master" },
        { id: "l-route", successLine: "She knew the book.", failureLine: "Wrong book.", successText: "You name the old route-ledger and the winter of the washed-out ford. She pulls a stained volume from the shelf and says: yes, that is the one. In play: Leverage goes up. Give the table the actual entry she reads out.", failureText: "The citation is close but wrong. She corrects you without malice and without much interest. In play: no Leverage gained, and that line of argument is closed for the rest of the hearing.", label: "Cite the old route-ledger", requiresRoll: true, skill: "his", lane: "L", dc: 12, successNodeId: "master", failureNodeId: "master", failureTags: ["Lock Approach"] }
      ]
    },
    master: {
      id: "master",
      rollMode: ROLL_MODES.INDIVIDUAL,
      finalStage: true,
      image: "modules/meridian-challenge/assets/scenes/master.png",
      description: "The caravan master looks up from the table. Everything the hall has seen of you is now on the record. She asks one question.",
      options: [
        { id: "m-case", successLine: "She believed you.", failureLine: "She didn't believe you.", successText: "You say it straight and in order, with nothing hidden that matters. She holds your gaze a long moment, then nods once. In play: the passage terms are signed as you asked, and the master speaks of you as a person she has already decided on.", failureText: "The case holds, barely. She has heard better, and she lets you know she knows it. In play: the terms are signed, but worse than hoped. Let the table feel the gap between what they asked for and what they get.", label: "Make your case", requiresRoll: true, skill: "per", lane: "T", dc: 14, successNodeId: "end", failureNodeId: "end", failureTags: ["Raise DC"] },
        { id: "m-proof", successLine: "It all fit.", failureLine: "It didn't fit.", successText: "You lay what you have gathered on the table piece by piece. Each one lands where it needs to. In play: the master reads the whole record and signs the full terms. Use what the party actually gathered earlier.", failureText: "The pieces are real but they do not join. She leaves them where they lie. In play: the terms are signed on her reading, not yours. Remember which pieces she skipped.", label: "Put what you have gathered on the table", requiresRoll: true, skill: "inv", lane: "L", dc: 14, successNodeId: "end", failureNodeId: "end" }
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
