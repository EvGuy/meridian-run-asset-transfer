/* Meridian Recap 1.4.0
 * GM-authored Baldur's Gate 2 style chapter recap. Studio (GM) + overlay player (everyone).
 * Data: JournalEntry in folder "Recaps", flags.meridian-recap.recap.
 */
const MID = "meridian-recap";
const FLAG = "recap";
const FOLDER_NAME = "Recaps";
const MAX_JOIN_SECONDS = 900;
/** per-user master volume (voice + music), 0..1 */
const master = () => { try { return Math.min(1, Math.max(0, Number(game.settings.get(MID, "master")))); } catch (e) { return 1; } };

const DEFAULTS = {
  title: "Chapter Recap",
  pictures: [],
  script: "",
  voice: "",
  music: "",
  musicVolume: 0.5,
  voiceVolume: 1,
  voiceDuration: 0,
  musicLoop: true,
  timingsJson: "",
  leadIn: 4,
  hold: 4,
  fadeOut: 4,
  scrollSeconds: 90,
  tiles: true,
  transition: "mosaic",
  duck: 0.6,
  textScale: 1,
  autoClose: 0,
  tileSize: 56,
  pan: true
};

let socket = null;
let current = null; // active RecapPlayer

/* ------------------------------------------------------------------ helpers */
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FP = () => foundry.applications.apps.FilePicker.implementation;

function normalize(data) {
  const d = foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULTS), data ?? {}, { inplace: false });
  d.pictures = (data?.pictures ?? []).map((p) => ({ src: p.src ?? "", label: p.label ?? "" }));
  return d;
}

/** Duration of an audio element. MediaRecorder WebM files report Infinity; a far seek makes the browser compute the real length. */
async function mediaDuration(audio, timeout = 6000) {
  if (audio.readyState < 1) {
    await new Promise((res) => {
      const t = setTimeout(res, timeout);
      audio.addEventListener("loadedmetadata", () => { clearTimeout(t); res(); }, { once: true });
      audio.addEventListener("error", () => { clearTimeout(t); res(); }, { once: true });
    });
  }
  if (audio.duration === Infinity) {
    await new Promise((res) => {
      const t = setTimeout(res, 4000);
      audio.addEventListener("durationchange", () => { clearTimeout(t); res(); }, { once: true });
      audio.currentTime = 1e7;
    });
    audio.currentTime = 0;
  }
  return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
}

/** Parse the script into clean narration text + scene markers (char index into clean text). */
export function parseScript(script) {
  let raw = String(script ?? "").replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n");
  raw = raw.replace(/\n{3,}/g, "\n\n").trim();
  const re = /\[scene\s+(\d+)(?:\s*@\s*(\d+(?:\.\d+)?))?\s*\]/gi;
  const markers = [];
  let text = "";
  let last = 0;
  let m;
  while ((m = re.exec(raw))) {
    text += raw.slice(last, m.index);
    markers.push({ n: parseInt(m[1], 10), at: text.length, time: m[2] != null ? parseFloat(m[2]) : null });
    last = m.index + m[0].length;
  }
  text += raw.slice(last);
  return { text, markers, paragraphs: text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) };
}

/** ElevenLabs with-timestamps JSON -> {starts, ends} per character of the narration text, or null. */
function parseAlignment(json) {
  if (!json || !String(json).trim()) return null;
  try {
    const o = JSON.parse(json);
    const a = o.alignment ?? o.normalized_alignment ?? o;
    const starts = a.character_start_times_seconds, ends = a.character_end_times_seconds;
    if (Array.isArray(starts) && Array.isArray(ends) && starts.length) return { starts, ends };
  } catch (e) { console.warn(`${MID} | timings JSON is not valid`, e); }
  return null;
}

/* ------------------------------------------------------------------ player */
class RecapPlayer {
  constructor(recap, { startedAt = null, local = false } = {}) {
    this.recap = normalize(recap);
    this.local = local;
    this.startedAt = startedAt ?? game.time.serverTime;
    this.parsed = parseScript(this.recap.script);
    this.align = parseAlignment(this.recap.timingsJson);
    this.scene = 0;
    this.imgCache = new Map();
    this.voice = null; this.music = null;
    this.voiceStarted = false;
    this.raf = null; this.closed = false; this.audioBlocked = false;
    this.D = this.recap.scrollSeconds;
  }

  get leadIn() { return Number(this.recap.leadIn) || 0; }

  async start() {
    const r = this.recap;
    this.#build();
    // preload pictures
    await Promise.all(r.pictures.map((p) => this.#image(p.src)));
    // audio
    if (r.voice) {
      this.voice = new Audio(r.voice); this.voice.preload = "auto";
      const dur = await mediaDuration(this.voice);
      if (dur) this.D = dur; else if (r.voiceDuration > 0) this.D = r.voiceDuration;
    }
    if (this.align) this.D = Math.max(this.D, this.align.ends.at(-1) ?? 0);
    if (r.music) { this.music = new Audio(r.music); this.music.loop = !!r.musicLoop; this.music.preload = "auto"; }
    this.#layout();
    this.t0 = performance.now() - ((game.time.serverTime - this.startedAt) / 1000) * 1000;
    if (this.local) this.t0 = performance.now();
    this.endAt = this.leadIn + this.D + (Number(r.hold) || 0) + (Number(r.fadeOut) || 0);
    if (!this.local && this.#elapsed() > this.endAt + (Number(r.autoClose) || 0) + 5) { this.close(); if (current === this) current = null; return; }
    requestAnimationFrame(() => this.el.classList.add("mrecap-in"));
    this.#setScene(1, true);
    await this.#startAudio();
    this.raf = requestAnimationFrame(() => this.#tick());
    this._onResize = () => this.#layout();
    window.addEventListener("resize", this._onResize);
  }

  /* ---- DOM ---- */
  #build() {
    const r = this.recap;
    const el = document.createElement("div");
    el.className = "mrecap-overlay";
    el.innerHTML = `
      <div class="mrecap-frame">
        <i class="mrecap-corner tl"></i><i class="mrecap-corner tr"></i><i class="mrecap-corner bl"></i><i class="mrecap-corner br"></i><i class="mrecap-edge top"></i><i class="mrecap-edge bot"></i>
        <div class="mrecap-picture"><div class="mrecap-stage ${r.pan ? "mrecap-pan" : ""}"><div class="mrecap-base"></div><div class="mrecap-tiles"></div></div><div class="mrecap-vignette"></div></div>
        <div class="mrecap-text"><div class="mrecap-scroll"><h2 class="mrecap-title">${esc(r.title)}</h2><div class="mrecap-body">${this.parsed.paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}</div></div></div>
        <div class="mrecap-controls"></div>
      </div>`;
    el.style.setProperty("--mr-scale", String(clamp(Number(r.textScale) || 1, 0.6, 2)));
    document.body.appendChild(el);
    this.el = el;
    this.$base = el.querySelector(".mrecap-base");
    this.$tiles = el.querySelector(".mrecap-tiles");
    this.$stage = el.querySelector(".mrecap-stage");
    this.$pic = el.querySelector(".mrecap-picture");
    this.$text = el.querySelector(".mrecap-text");
    this.$scroll = el.querySelector(".mrecap-scroll");
    this.$controls = el.querySelector(".mrecap-controls");
    const mk = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "mrecap-btn"; b.textContent = label; b.addEventListener("click", fn); this.$controls.appendChild(b); return b; };
    if (this.local) {
      mk("Close preview", () => closeCurrent());
    } else if (game.user.isGM) {
      mk("Replay", () => api.play(this.recap, { raw: true }));
      mk("Stop for everyone", () => api.stop());
    } else {
      mk("Done", () => closeCurrent());
    }
    // master volume (voice + music), per user, remembered between recaps
    const vol = document.createElement("div"); vol.className = "mrecap-vol";
    const spk = document.createElement("button"); spk.type = "button"; spk.className = "mrecap-btn mrecap-spk"; spk.title = "Mute / unmute";
    const rng = document.createElement("input"); rng.type = "range"; rng.min = "0"; rng.max = "1"; rng.step = "0.05"; rng.title = "Master volume (narration and music)";
    const paint = () => { const v = master(); rng.value = String(v); spk.textContent = v === 0 ? "\u{1F507}" : v < 0.5 ? "\u{1F509}" : "\u{1F50A}"; };
    const setMaster = (v) => { game.settings.set(MID, "master", v).catch(() => {}); if (this.music && !this.audioBlocked) this.music.volume = Math.min(1, clamp(this.recap.musicVolume, 0, 1) * (this.duckLevel ?? 1) * v); if (this.voice) this.voice.volume = clamp(this.recap.voiceVolume ?? 1, 0, 1) * v; };
    rng.addEventListener("input", () => { const v = Number(rng.value); this._lastMaster = v || this._lastMaster; setMaster(v); spk.textContent = v === 0 ? "\u{1F507}" : v < 0.5 ? "\u{1F509}" : "\u{1F50A}"; });
    spk.addEventListener("click", () => { const cur = master(); const nv = cur > 0 ? 0 : (this._lastMaster || 0.7); if (cur > 0) this._lastMaster = cur; rng.value = String(nv); setMaster(nv); spk.textContent = nv === 0 ? "\u{1F507}" : nv < 0.5 ? "\u{1F509}" : "\u{1F50A}"; });
    vol.append(spk, rng); this.$controls.prepend(vol); paint();
    this._keyHandler = (ev) => { if (ev.key === "Escape" && (this.local || !game.user.isGM)) { ev.stopPropagation(); closeCurrent(); } };
    window.addEventListener("keydown", this._keyHandler, true);
  }

  #layout() {
    this.pw = this.$pic.clientWidth; this.ph = this.$pic.clientHeight;
    this.th = this.$text.clientHeight;
    this.ch = this.$scroll.scrollHeight;
    // paragraph geometry for the reading-line scroll
    const ps = [...this.$scroll.querySelectorAll(".mrecap-body p")];
    const text = this.parsed.text; let from = 0;
    this.pmap = this.parsed.paragraphs.map((para, i) => {
      const start = Math.max(0, text.indexOf(para, from)); from = start + para.length;
      const el = ps[i];
      return { start, len: Math.max(1, para.length), top: el ? el.offsetTop : 0, h: el ? el.offsetHeight : 0 };
    });
  }

  /** y offset (inside the scroll block) of the text position c */
  #yAt(c) {
    const m = this.pmap; if (!m?.length) return 0;
    for (let i = 0; i < m.length; i++) {
      const p = m[i], next = m[i + 1];
      if (c < p.start) return p.top;
      if (c <= p.start + p.len || !next) return p.top + clamp((c - p.start) / p.len, 0, 1) * p.h;
      if (c < next.start) return next.top;
    }
    return m.at(-1).top + m.at(-1).h;
  }

  /** narrated character position at narration time tau */
  #charAt(tau) {
    const total = this.parsed.text.length;
    if (tau <= 0) return 0;
    if (tau >= this.D) return total;
    if (this.align) {
      const a = this.align.starts; let lo = 0, hi = a.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid] <= tau) lo = mid; else hi = mid - 1; }
      return lo;
    }
    return (tau / this.D) * total;
  }

  async #image(src) {
    if (!src) return null;
    if (this.imgCache.has(src)) return this.imgCache.get(src);
    const p = new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
    this.imgCache.set(src, p);
    return p;
  }

  async #setScene(n, instant = false) {
    const pics = this.recap.pictures;
    if (!pics.length) return;
    n = clamp(n, 1, pics.length);
    if (n === this.scene) return;
    this.scene = n;
    const src = pics[n - 1].src;
    const img = await this.#image(src);
    if (this.closed || this.scene !== n) return;
    const url = `url("${src}")`;
    if (instant || !this.$base.style.backgroundImage) { this.$base.style.backgroundImage = url; this.$tiles.replaceChildren(); return; }
    // mosaic dissolve
    const W = this.pw, H = this.ph;
    this.$tiles.replaceChildren();
    const mode = this.recap.transition ?? (this.recap.tiles ? "mosaic" : "fade");
    if (mode === "cut") { this.$base.style.backgroundImage = url; this.$tiles.replaceChildren(); return; }
    const useTiles = mode === "mosaic" && img;
    const size = useTiles ? Math.max(24, Number(this.recap.tileSize) || 56) : Math.max(W, H);
    const cols = Math.max(1, Math.ceil(W / size)), rows = Math.max(1, Math.ceil(H / size));
    const tw = W / cols, th = H / rows;
    let bgW = W, bgH = H;
    if (img) { const s = Math.max(W / img.naturalWidth, H / img.naturalHeight); bgW = img.naturalWidth * s; bgH = img.naturalHeight * s; }
    this.$tiles.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    this.$tiles.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    const tiles = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const t = document.createElement("div");
      t.className = "mrecap-tile";
      t.style.backgroundImage = url;
      t.style.backgroundSize = `${bgW}px ${bgH}px`;
      t.style.backgroundPosition = `${(W - bgW) / 2 - c * tw}px ${(H - bgH) / 2 - r * th}px`;
      t.style.transitionDelay = `${useTiles ? Math.random() * 900 : 0}ms`;
      if (!useTiles) t.style.transitionDuration = "1.4s";
      this.$tiles.appendChild(t); tiles.push(t);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => tiles.forEach((t) => t.classList.add("mrecap-show"))));
    await sleep(useTiles ? 1600 : 1500);
    if (this.closed || this.scene !== n) return;
    this.$base.style.backgroundImage = url;
    this.$tiles.replaceChildren();
  }

  /* ---- audio ---- */
  async #startAudio() {
    const t = this.#elapsed();
    const jobs = [];
    if (this.music) {
      this.music.volume = clamp(this.recap.musicVolume, 0, 1) * master();
      if (Number.isFinite(this.music.duration) && this.music.duration > 0 && t > 0) this.music.currentTime = t % this.music.duration;
      jobs.push(this.music.play());
    }
    if (this.voice && t >= this.leadIn) {
      this.voice.currentTime = Math.max(0, t - this.leadIn);
      this.voice.volume = clamp(this.recap.voiceVolume ?? 1, 0, 1) * master();
      jobs.push(this.voice.play().then(() => { this.voiceStarted = true; }));
    }
    const res = await Promise.allSettled(jobs);
    if (res.some((x) => x.status === "rejected") && !this.audioBlocked) this.#showGate();
  }

  #showGate() {
    this.audioBlocked = true;
    const b = document.createElement("button");
    b.type = "button"; b.className = "mrecap-btn mrecap-gate"; b.textContent = "Click to start sound";
    b.addEventListener("click", async () => {
      b.remove(); this.audioBlocked = false; this.voiceStarted = false;
      if (this.music) { this.music.currentTime = this.music.duration ? this.#elapsed() % this.music.duration : 0; try { await this.music.play(); } catch (e) { console.warn(e); } }
      // voice is (re)started by the tick loop once its time has come
    });
    this.el.querySelector(".mrecap-frame").appendChild(b);
  }

  /* ---- timeline ---- */
  #elapsed() {
    if (this.voice && this.voiceStarted && !this.voice.paused && !this.voice.ended) {
      this.t0 = performance.now() - (this.leadIn + this.voice.currentTime) * 1000;
    }
    return (performance.now() - this.t0) / 1000;
  }

  #charTime(i) {
    const total = Math.max(1, this.parsed.text.length);
    if (this.align) {
      const a = this.align.starts;
      return a[clamp(i, 0, a.length - 1)] ?? 0;
    }
    return (i / total) * this.D;
  }

  #sceneAt(tau) {
    let n = 1, best = -Infinity;
    for (const m of this.parsed.markers) {
      const when = m.time != null ? m.time : this.#charTime(m.at);
      if (when <= tau && when >= best) { best = when; n = m.n; }
    }
    return n;
  }

  #tick() {
    if (this.closed) return;
    const t = this.#elapsed();
    const tau = t - this.leadIn;
    const r = this.recap;

    if (this.voice && !this.voiceStarted && !this.audioBlocked && t >= this.leadIn && !this.voice.ended) {
      this.voiceStarted = true;
      this.voice.currentTime = clamp(tau, 0, this.voice.duration || tau);
      this.voice.volume = clamp(this.recap.voiceVolume ?? 1, 0, 1) * master();
      this.voice.play().catch(() => { this.voiceStarted = false; if (!this.audioBlocked) this.#showGate(); });
    }

    this.#setScene(this.#sceneAt(tau));

    // scroll: the text being read sits on a fixed reading line; the title rides in from the bottom during the lead-in
    const readY = this.th * 0.5;
    const c = this.#charAt(tau);
    let ty = readY - this.#yAt(c);
    if (t < this.leadIn) {
      const p = clamp(t / Math.max(0.5, this.leadIn), 0, 1), e = p * p * (3 - 2 * p);
      const start = this.th * 0.98, end = readY - this.#yAt(0);
      ty = start + (end - start) * e;
    } else if (tau >= this.D) {
      ty -= clamp((tau - this.D) / Math.max(1, r.hold), 0, 1) * this.th * 0.22;
    }
    this.$scroll.style.transform = `translateY(${ty}px)`;

    if (this.voice && this.voiceStarted) this.voice.volume = clamp(r.voiceVolume ?? 1, 0, 1) * master();
    // music fade after the narration + hold, ducked while the voice speaks
    if (this.music) {
      const over = tau - this.D - r.hold;
      const speaking = this.voice && !this.voice.paused && !this.voice.ended;
      const duckTarget = speaking ? clamp(r.duck ?? 0.6, 0, 1) : 1;
      this.duckLevel = (this.duckLevel ?? 1) + (duckTarget - (this.duckLevel ?? 1)) * 0.05;
      const base = clamp(r.musicVolume, 0, 1) * this.duckLevel * master();
      if (over > 0) {
        const k = clamp(1 - over / Math.max(0.1, r.fadeOut), 0, 1);
        this.music.volume = base * k;
        if (k === 0 && !this.music.paused) this.music.pause();
      } else if (!this.audioBlocked) this.music.volume = base;
    }
    if (tau >= this.D) this.$controls.classList.add("mrecap-end");
    if (r.autoClose > 0 && t > this.endAt + r.autoClose && !this.closing) {
      this.closing = true;
      if (game.user.isGM && !this.local) game.settings.set(MID, "active", null).catch(() => {});
      closeCurrent(); return;
    }

    this.raf = requestAnimationFrame(() => this.#tick());
  }

  state() {
    const t = this.#elapsed();
    return {
      t: +t.toFixed(2), tau: +(t - this.leadIn).toFixed(2), D: +this.D.toFixed(2), scene: this.scene,
      voice: this.voice ? { playing: !this.voice.paused && !this.voice.ended, time: +this.voice.currentTime.toFixed(2), dur: this.voice.duration } : null,
      music: this.music ? { playing: !this.music.paused, time: +this.music.currentTime.toFixed(2), vol: +this.music.volume.toFixed(3), dur: this.music.duration } : null,
      audioBlocked: this.audioBlocked, charPos: Math.round(this.#charAt(t - this.leadIn)), chars: this.parsed.text.length
    };
  }

  seek(t) {
    this.t0 = performance.now() - t * 1000;
    if (this.music && this.music.duration) this.music.currentTime = t % this.music.duration;
    if (this.voice) { this.voice.currentTime = Math.max(0, t - this.leadIn); }
  }

  close() {
    this.closed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("keydown", this._keyHandler, true);
    for (const a of [this.voice, this.music]) { if (a) { try { a.pause(); a.src = ""; } catch { /* ignore */ } } }
    const el = this.el;
    if (el) { el.classList.remove("mrecap-in"); setTimeout(() => el.remove(), 1200); }
  }
}

function closeCurrent() { if (current) { current.close(); current = null; } }

async function startPlayer(recap, opts) {
  closeCurrent();
  current = new RecapPlayer(recap, opts);
  try { await current.start(); } catch (e) { console.error(`${MID} | failed to start`, e); ui.notifications?.error("Meridian Recap failed to start. See console."); closeCurrent(); }
}

/* ------------------------------------------------------------------ storage */
function allRecaps() { return game.journal.filter((j) => j.getFlag(MID, FLAG)); }
function findRecap(idOrName) { return game.journal.get(idOrName) ?? allRecaps().find((j) => j.name === idOrName) ?? null; }
function dataOf(doc) { return normalize(doc.getFlag(MID, FLAG)); }

let folderPromise = null;
async function ensureFolder() {
  folderPromise ??= makeFolder().finally(() => { folderPromise = null; });
  return folderPromise;
}
async function makeFolder() {
  let f = game.folders.find((x) => x.type === "JournalEntry" && x.name === FOLDER_NAME);
  if (!f) f = await Folder.create({ name: FOLDER_NAME, type: "JournalEntry" });
  return f;
}

async function saveRecap(id, data) {
  const folder = await ensureFolder();
  const html = parseScript(data.script).paragraphs.map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("") || "<p></p>";
  let doc = id ? game.journal.get(id) : null;
  if (!doc) {
    doc = await JournalEntry.create({
      name: data.title || "Recap", folder: folder.id, ownership: { default: 0 },
      flags: { [MID]: { [FLAG]: data } },
      pages: [{ name: "Recap Script", type: "text", text: { content: html, format: 1 } }]
    });
  } else {
    await doc.update({ name: data.title || doc.name, [`flags.${MID}.${FLAG}`]: data });
    const page = doc.pages.find((p) => p.name === "Recap Script");
    if (page) await page.update({ "text.content": html });
    else await doc.createEmbeddedDocuments("JournalEntryPage", [{ name: "Recap Script", type: "text", text: { content: html, format: 1 } }]);
  }
  return doc;
}

/* ------------------------------------------------------------------ api */
const api = {
  open(id) { new RecapStudio(id).render(true); },
  async play(idOrName, { raw = false } = {}) {
    if (!game.user.isGM) return ui.notifications.warn("Only the GM can play a recap for everyone.");
    let recap;
    if (raw) recap = normalize(idOrName);
    else { const doc = findRecap(idOrName); if (!doc) return ui.notifications.error(`Recap not found: ${idOrName}`); recap = dataOf(doc); }
    const startedAt = game.time.serverTime + 2000; // lets every client preload first
    await game.settings.set(MID, "active", { recap, startedAt });
    await socket.executeForEveryone("play", { recap, startedAt });
  },
  async stop() {
    if (!game.user.isGM) return;
    await game.settings.set(MID, "active", null);
    await socket.executeForEveryone("stop");
  },
  async preview(idOrName, { raw = false } = {}) {
    let recap;
    if (raw) recap = normalize(idOrName);
    else { const doc = findRecap(idOrName); if (!doc) return ui.notifications.error(`Recap not found: ${idOrName}`); recap = dataOf(doc); }
    await startPlayer(recap, { local: true });
  },
  state: () => current?.state() ?? null,
  seek: (t) => current?.seek(t),
  parseScript
};

/* ------------------------------------------------------------------ studio */
const { ApplicationV2 } = foundry.applications.api;

class RecapStudio extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "meridian-recap-studio",
    tag: "div",
    classes: ["meridian-recap-studio"],
    window: { title: "Recap Studio", icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 780, height: 820 }
  };

  constructor(id = null, options = {}) {
    super(options);
    this.docId = id;
    const doc = id ? game.journal.get(id) : null;
    this.data = doc ? dataOf(doc) : normalize({});
    this.rec = null; // active recording
  }

  async _renderHTML() {
    const d = this.data;
    const recaps = allRecaps();
    const opts = [`<option value="">New recap</option>`, ...recaps.map((j) => `<option value="${j.id}" ${j.id === this.docId ? "selected" : ""}>${esc(j.name)}</option>`)].join("");
    const pics = d.pictures.map((p, i) => `
      <div class="mrs-pic" data-i="${i}">
        <span class="mrs-num">${i + 1}</span>
        <img src="${esc(p.src)}" alt="">
        <input type="text" name="pic-src" value="${esc(p.src)}" placeholder="image path">
        <button type="button" data-action="browsePic" title="Choose file"><i class="fa-solid fa-folder-open"></i></button>
        <input type="text" name="pic-label" value="${esc(p.label)}" placeholder="label" style="max-width:130px">
        <button type="button" data-action="insertMarker" title="Insert [scene ${i + 1}] at the script cursor"><i class="fa-solid fa-location-arrow"></i></button>
        <button type="button" data-action="picUp" title="Move up"><i class="fa-solid fa-arrow-up"></i></button>
        <button type="button" data-action="picDown" title="Move down"><i class="fa-solid fa-arrow-down"></i></button>
        <button type="button" data-action="picDel" title="Remove"><i class="fa-solid fa-trash"></i></button>
      </div>`).join("");
    return `<div class="mrs">
      <div class="mrs-row"><label>Recap</label><select name="recapPick">${opts}</select>
        <button type="button" data-action="delRecap" ${this.docId ? "" : "disabled"}><i class="fa-solid fa-trash"></i> Delete</button></div>
      <div class="mrs-row"><label>Title</label><input type="text" name="title" value="${esc(d.title)}"></div>

      <fieldset><legend>Pictures (picture 1 shows from the start)</legend>
        ${pics || `<p class="mrs-hint">No pictures yet.</p>`}
        <div class="mrs-row"><button type="button" data-action="addPic"><i class="fa-solid fa-plus"></i> Add picture</button></div>
      </fieldset>

      <fieldset><legend>Text</legend>
        <textarea name="script" placeholder="A blank line starts a paragraph.&#10;[scene 2] switches to picture 2 at that point.&#10;[scene 3 @12.5] pins the switch to 12.5 s into the voice.">${esc(d.script)}</textarea>
        <p class="mrs-hint">Markers are not spoken or shown. "Copy narration text" gives the exact words to send to the voice generator.</p>
      </fieldset>

      <fieldset><legend>Voice-over</legend>
        <div class="mrs-row"><input type="text" name="voice" value="${esc(d.voice)}" placeholder="audio file">
          <button type="button" data-action="browseVoice"><i class="fa-solid fa-folder-open"></i> Browse</button>
          <button type="button" class="mrs-rec" data-action="recVoice" data-kind="voice"><i class="fa-solid fa-microphone"></i> <span>Record</span></button>
          <button type="button" data-action="clearVoice" title="Clear"><i class="fa-solid fa-xmark"></i></button></div>
        ${d.voice ? `<audio controls src="${esc(d.voice)}"></audio>` : ""}
        <div class="mrs-row"><label>Voice volume</label><input type="range" name="voiceVolume" min="0" max="1" step="0.05" value="${d.voiceVolume}"></div>
        <div class="mrs-row"><label>Timings JSON</label><button type="button" data-action="browseTimings"><i class="fa-solid fa-folder-open"></i> Load file</button>
          <span class="mrs-hint">Optional ElevenLabs with-timestamps JSON for exact sync.</span></div>
        <textarea class="mrs-small" name="timingsJson" placeholder="paste ElevenLabs with-timestamps JSON (optional)">${esc(d.timingsJson)}</textarea>
      </fieldset>

      <fieldset><legend>Music / sound</legend>
        <div class="mrs-row"><input type="text" name="music" value="${esc(d.music)}" placeholder="audio file">
          <button type="button" data-action="browseMusic"><i class="fa-solid fa-folder-open"></i> Browse</button>
          <button type="button" class="mrs-rec" data-action="recMusic" data-kind="music"><i class="fa-solid fa-microphone"></i> <span>Record</span></button>
          <button type="button" data-action="clearMusic" title="Clear"><i class="fa-solid fa-xmark"></i></button></div>
        ${d.music ? `<audio controls src="${esc(d.music)}"></audio>` : ""}
        <div class="mrs-row"><label>Volume</label><input type="range" name="musicVolume" min="0" max="1" step="0.05" value="${d.musicVolume}">
          <label><input type="checkbox" name="musicLoop" ${d.musicLoop ? "checked" : ""}> Loop</label></div>
      </fieldset>

      <fieldset><legend>Timing and look</legend>
        <div class="mrs-row"><label>Lead-in (s)</label><input type="number" name="leadIn" min="0" step="0.5" value="${d.leadIn}">
          <label>Hold at end (s)</label><input type="number" name="hold" min="0" step="0.5" value="${d.hold}">
          <label>Music fade-out (s)</label><input type="number" name="fadeOut" min="0" step="0.5" value="${d.fadeOut}"></div>
        <div class="mrs-row"><label>Text size</label><input type="range" name="textScale" min="0.7" max="1.6" step="0.05" value="${d.textScale}">
          <label>Music dips to</label><input type="range" name="duck" min="0" max="1" step="0.05" value="${d.duck}"><span class="mrs-hint">while the voice speaks</span></div>
        <div class="mrs-row"><label>Auto-close after (s)</label><input type="number" name="autoClose" min="0" step="1" value="${d.autoClose}"><span class="mrs-hint">0 = stays until Done / Stop</span></div>
        <div class="mrs-row"><label>Scroll length (s)</label><input type="number" name="scrollSeconds" min="5" step="5" value="${d.scrollSeconds}"><span class="mrs-hint">used when there is no voice</span></div>
        <div class="mrs-row"><label>Picture change</label><select name="transition">${["mosaic:Mosaic tile dissolve", "fade:Soft fade", "cut:Instant cut"].map((o) => { const [v, l] = o.split(":"); return `<option value="${v}" ${(d.transition ?? "mosaic") === v ? "selected" : ""}>${l}</option>`; }).join("")}</select>
          <label>Tile size (px)</label><input type="number" name="tileSize" min="24" step="4" value="${d.tileSize}">
          <label><input type="checkbox" name="pan" ${d.pan ? "checked" : ""}> Slow pan</label></div>
      </fieldset>

      <div class="mrs-actions">
        <button type="button" data-action="copyNarration"><i class="fa-solid fa-copy"></i> Copy narration text</button>
        <button type="button" data-action="save"><i class="fa-solid fa-floppy-disk"></i> Save</button>
        <button type="button" data-action="preview"><i class="fa-solid fa-eye"></i> Preview (only me)</button>
        <button type="button" data-action="playAll"><i class="fa-solid fa-play"></i> Play for everyone</button>
        <button type="button" data-action="stopAll"><i class="fa-solid fa-stop"></i> Stop for everyone</button>
      </div></div>`;
  }

  _replaceHTML(result, content) {
    const top = content.scrollTop;
    content.innerHTML = result;
    content.scrollTop = top;
    this.#wire(content);
  }

  #wire(root) {
    this.$root = root;
    if (root.dataset.mrsWired) { this.#wireSelect(root); return; }
    root.dataset.mrsWired = "1";
    root.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-action]");
      if (!b) return;
      ev.preventDefault();
      const i = Number(b.closest(".mrs-pic")?.dataset.i);
      this.#action(b.dataset.action, i, b);
    });
    root.addEventListener("input", (ev) => {
      if (ev.target.matches('[name="pic-src"]')) { const img = ev.target.closest(".mrs-pic").querySelector("img"); img.src = ev.target.value; }
    });
    this.#wireSelect(root);
  }

  #wireSelect(root) {
    root.querySelector('[name="recapPick"]').addEventListener("change", (ev) => {
      if (this.rec) return ui.notifications.warn("Stop the recording first.");
      this.docId = ev.target.value || null;
      const doc = this.docId ? game.journal.get(this.docId) : null;
      this.data = doc ? dataOf(doc) : normalize({});
      this.render();
    });
  }

  /** Read the form back into this.data. */
  #collect() {
    const r = this.$root; if (!r) return;
    const g = (n) => r.querySelector(`[name="${n}"]`);
    const d = this.data;
    d.title = g("title").value.trim() || "Recap";
    d.script = g("script").value;
    d.voice = g("voice").value.trim();
    d.music = g("music").value.trim();
    d.timingsJson = g("timingsJson").value;
    d.musicVolume = Number(g("musicVolume").value);
    d.voiceVolume = Number(g("voiceVolume").value);
    d.musicLoop = g("musicLoop").checked;
    d.leadIn = Number(g("leadIn").value) || 0;
    d.hold = Number(g("hold").value) || 0;
    d.fadeOut = Number(g("fadeOut").value) || 0;
    d.scrollSeconds = Number(g("scrollSeconds").value) || 90;
    d.transition = g("transition").value;
    d.tiles = d.transition === "mosaic";
    d.textScale = Number(g("textScale").value) || 1;
    d.duck = Number(g("duck").value);
    d.autoClose = Number(g("autoClose").value) || 0;
    d.tileSize = Number(g("tileSize").value) || 56;
    d.pan = g("pan").checked;
    d.pictures = [...r.querySelectorAll(".mrs-pic")].map((row) => ({
      src: row.querySelector('[name="pic-src"]').value.trim(),
      label: row.querySelector('[name="pic-label"]').value.trim()
    }));
  }

  async #pick(type, current = "") {
    return new Promise((resolve) => {
      new (FP())({ type, current, callback: (path) => resolve(path) }).render(true);
    });
  }

  async #save() {
    if (this.saving) return this.saving;
    this.saving = this.#doSave().finally(() => { this.saving = null; });
    return this.saving;
  }

  async #doSave() {
    this.#collect();
    const doc = await saveRecap(this.docId, this.data);
    this.docId = doc.id;
    ui.notifications.info(`Recap saved: ${doc.name}`);
    return doc;
  }

  async #action(action, i, btn) {
    const d = this.data;
    const rerender = () => { this.#collect(); return this.render(); };
    switch (action) {
      case "addPic": this.#collect(); d.pictures.push({ src: "", label: "" }); return this.render();
      case "browsePic": { this.#collect(); const p = await this.#pick("image", d.pictures[i].src); if (p) { d.pictures[i].src = p; } return this.render(); }
      case "insertMarker": {
        const ta = this.$root.querySelector('[name="script"]');
        const tag = `[scene ${i + 1}]`; const s = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, s) + tag + ta.value.slice(ta.selectionEnd ?? s);
        ta.focus(); ta.selectionStart = ta.selectionEnd = s + tag.length; return;
      }
      case "picUp": if (i > 0) { this.#collect(); [d.pictures[i - 1], d.pictures[i]] = [d.pictures[i], d.pictures[i - 1]]; return this.render(); } return;
      case "picDown": if (i < d.pictures.length - 1) { this.#collect(); [d.pictures[i + 1], d.pictures[i]] = [d.pictures[i], d.pictures[i + 1]]; return this.render(); } return;
      case "picDel": this.#collect(); d.pictures.splice(i, 1); return this.render();
      case "browseVoice": { this.#collect(); const p = await this.#pick("audio", d.voice); if (p) { d.voice = p; d.voiceDuration = 0; } return this.render(); }
      case "browseMusic": { this.#collect(); const p = await this.#pick("audio", d.music); if (p) d.music = p; return this.render(); }
      case "clearVoice": this.#collect(); d.voice = ""; d.voiceDuration = 0; return this.render();
      case "clearMusic": this.#collect(); d.music = ""; return this.render();
      case "browseTimings": {
        this.#collect(); const p = await this.#pick("any", "");
        if (p) { try { d.timingsJson = await (await fetch(p)).text(); } catch (e) { ui.notifications.error("Could not read that file."); } }
        return this.render();
      }
      case "recVoice": return this.#toggleRecord("voice", btn);
      case "recMusic": return this.#toggleRecord("music", btn);
      case "copyNarration": {
        this.#collect();
        await navigator.clipboard.writeText(parseScript(d.script).text);
        return ui.notifications.info("Narration text copied.");
      }
      case "save": return this.#save();
      case "preview": this.#collect(); return api.preview(d, { raw: true });
      case "playAll": { const doc = await this.#save(); return api.play(doc.id); }
      case "stopAll": return api.stop();
      case "delRecap": {
        if (!this.docId) return;
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete recap" }, content: `<p>Delete "${esc(d.title)}"? This cannot be undone.</p>` });
        if (!ok) return;
        await game.journal.get(this.docId)?.delete();
        this.docId = null; this.data = normalize({}); return this.render();
      }
    }
  }

  /* ---- in-studio recording (microphone) ---- */
  async #toggleRecord(kind, btn) {
    if (this.rec) {
      if (this.rec.kind !== kind) return ui.notifications.warn("Another recording is running. Stop it first.");
      this.rec.recorder.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return ui.notifications.error("This browser cannot record audio.");
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: kind === "voice" ? { echoCancellation: true, noiseSuppression: true } : { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) { return ui.notifications.error("Microphone access was blocked. Allow it in the browser address bar and try again."); }
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = []; const started = Date.now();
    const label = btn.querySelector("span");
    btn.classList.add("mrs-live");
    const timer = setInterval(() => { const s = Math.floor((Date.now() - started) / 1000); label.textContent = `Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 250);
    label.textContent = "Stop 0:00";
    this.rec = { kind, recorder };
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); this.rec = null;
      btn.classList.remove("mrs-live"); label.textContent = "Uploading...";
      try {
        const type = recorder.mimeType || "audio/webm";
        const ext = type.includes("ogg") ? "ogg" : "webm";
        const slug = (this.data.title || "recap").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "recap";
        const file = new File([new Blob(chunks, { type })], `${slug}-${kind}-${Date.now()}.${ext}`, { type });
        const dir = "meridian-recap/recordings";
        for (const p of ["meridian-recap", dir]) { try { await FP().createDirectory("data", p); } catch { /* exists */ } }
        const res = await FP().upload("data", dir, file, {}, { notify: false });
        const path = res?.path;
        if (!path) throw new Error("upload returned no path");
        this.#collect(); this.data[kind] = path;
        if (kind === "voice") this.data.voiceDuration = +((Date.now() - started) / 1000).toFixed(2);
        ui.notifications.info(`Recording saved: ${path}`);
      } catch (e) {
        console.error(`${MID} | recording upload failed`, e);
        ui.notifications.error("Recording could not be uploaded. See console.");
      }
      this.render();
    };
    recorder.start(1000);
  }

  async close(options) {
    if (this.rec) { try { this.rec.recorder.stop(); } catch { /* ignore */ } }
    return super.close(options);
  }
}

/* ------------------------------------------------------------------ hooks */
Hooks.once("init", () => {
  game.settings.register(MID, "active", { scope: "world", config: false, type: Object, default: null });
  game.settings.register(MID, "master", { scope: "client", config: false, type: Number, default: 1 });
});

Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule(MID);
  socket.register("play", (payload) => startPlayer(payload.recap, { startedAt: payload.startedAt }));
  socket.register("stop", () => closeCurrent());
});

Hooks.once("ready", async () => {
  game.modules.get(MID).api = api;
  // late joiner / refresh catch-up
  try {
    const active = game.settings.get(MID, "active");
    if (active?.recap && (game.time.serverTime - active.startedAt) / 1000 < MAX_JOIN_SECONDS && !current) {
      await startPlayer(active.recap, { startedAt: active.startedAt });
    }
  } catch (e) { console.warn(`${MID} | catch-up skipped`, e); }
});

function addStudioButton(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".meridian-recap-btn")) return;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "meridian-recap-btn";
  btn.innerHTML = `<i class="fa-solid fa-scroll"></i> Recap Studio`;
  btn.addEventListener("click", () => api.open());
  const host = root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root.querySelector("header");
  host?.appendChild(btn);
}
Hooks.on("renderJournalDirectory", addStudioButton);

function contextOption() {
  return {
    name: "Open in Recap Studio", icon: '<i class="fa-solid fa-scroll"></i>',
    condition: (li) => { const el = li instanceof HTMLElement ? li : li[0]; const id = el?.dataset?.entryId ?? el?.dataset?.documentId; return game.user.isGM && !!game.journal.get(id)?.getFlag(MID, FLAG); },
    callback: (li) => { const el = li instanceof HTMLElement ? li : li[0]; api.open(el.dataset.entryId ?? el.dataset.documentId); }
  };
}
for (const hook of ["getJournalEntryContextOptions", "getJournalDirectoryEntryContext"]) {
  Hooks.on(hook, (app, options) => { options.push(contextOption()); });
}
