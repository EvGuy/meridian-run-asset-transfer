export const VOICES = {
  berty: {
    name: "Berty",
    greet: ["WHAT?! WHAT DO YOU WANT NOW?!", "OH GOOD. VISITORS. WIPE YOUR HANDS."],
    store: ["YOU PUT A WET SOCK IN ME! WHO RAISED YOU?!", "AGAIN WITH THE LUGGAGE?!"],
    hold: ["MINE NOW! YOU WANT IT BACK? ASK NICELY!"],
    refuse: ["NO! AND ANOTHER THING! NO!"],
    release: ["FINE! TAKE IT! IT WAS GIVING ME GAS!"]
  },
  lady: {
    name: "Lady Bertrude",
    greet: ["You may approach. Not that closely.", "I have held crown jewels. And now... is this cheese?"],
    store: ["I suppose someone must mind your little things."],
    hold: ["This stays with me until I am asked properly."],
    refuse: ["With manners like those? Certainly not."],
    release: ["Very well. Do try not to smudge it."]
  },
  hinge: {
    name: "The Hinge",
    greet: ["Give it a try. It doesn't really matter, as I'll likely swallow you whole as you sleep..."],
    store: ["Sweet dreams. Leave your boots off. They're chewy."],
    hold: ["I'll keep this. We should talk about what it's worth to you."],
    refuse: ["No. Sleep lightly."],
    release: ["Take it. I know where you keep it."]
  }
};

/** Berty most, the Hinge least. */
export function pickVoice(random = Math.random()) {
  return random < 0.55 ? "berty" : random < 0.85 ? "lady" : "hinge";
}

export function line(voice, kind, random = Math.random()) {
  const list = VOICES[voice][kind];
  return { speaker: VOICES[voice].name, text: list[Math.floor(random * list.length)] };
}
