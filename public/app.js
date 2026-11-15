// ===================================================================
// Lernwelt – Lern-App für Rafi und Ibrahim
// Reines JavaScript, kein Build-Schritt. Inhalte liegen in /data/*.json
// ===================================================================

const API = "/api";
const app = document.getElementById("app");
const modalRoot = document.getElementById("modal-root");

const LEVEL_TITEL = ["Neuling", "Entdecker", "Abenteurer", "Wortschmied", "Satzprofi", "Textkapitän", "Sprachheld", "Grammatik-Ass", "Wortmagier", "Legende"];

// ---------- kleine Helfer ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date().toLocaleDateString("sv-SE");
const addDays = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("sv-SE"); };
const daysBetween = (a, b) => Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 864e5);
const fmtDate = (d) => new Date(d + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
const fmtDateLong = (d) => new Date(d + "T12:00:00").toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
const fmtTs = (ts) => new Date(ts).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pct = (v) => Math.round(v * 100);
const lsGet = (k, f = null) => { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch { return f; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const starsHtml = (n, max = 3) => Array.from({ length: max }, (_, i) => `<span class="${i < n ? "on" : "off"}">★</span>`).join("");
async function getJSON(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }

// ---------- Zustand ----------
const S = {
  schueler: null, lehrer: "dein Lehrer",
  cur: null, data: null, hw: [], prog: null,
  round: null, texts: null,
  sound: lsGet("lw:sound", true),
  online: true, syncTimer: null,
  queue: [], // Popups (Abzeichen, Level)
};

// ===================================================================
// Level, Serie, Abzeichen
// ===================================================================
function levelInfo(xp) {
  let level = 1, base = 0, need = 150;
  while (xp >= base + need) { base += need; level++; need = 150 + 75 * (level - 1); }
  return { level, into: xp - base, need, titel: LEVEL_TITEL[Math.min(level, LEVEL_TITEL.length) - 1] };
}
function streakInfo(p) {
  let d = today();
  const activeToday = !!p.days[d];
  if (!activeToday) d = addDays(d, -1);
  let n = 0;
  while (p.days[d]) { n++; d = addDays(d, -1); }
  return { n, activeToday };
}

const BASIS_ABZEICHEN = [
  { id: "b-erste", emoji: "🌱", titel: "Erster Schritt", text: "Erste Runde geschafft", test: (p) => p.rounds.length >= 1 },
  { id: "b-perfekt", emoji: "🎯", titel: "Volltreffer", text: "Eine Runde ohne Fehler", test: (p) => p.rounds.some((r) => r.score >= 1) },
  { id: "b-10", emoji: "💪", titel: "Fleißig", text: "10 Runden gespielt", test: (p) => p.rounds.length >= 10 },
  { id: "b-50", emoji: "🏃", titel: "Marathon", text: "50 Runden gespielt", test: (p) => p.rounds.length >= 50 },
  { id: "b-streak3", emoji: "🔥", titel: "Feuer gefangen", text: "3 Tage in Folge geübt", test: (p) => p.bestStreak >= 3 },
  { id: "b-streak7", emoji: "☄️", titel: "Wochen-Flamme", text: "7 Tage in Folge geübt", test: (p) => p.bestStreak >= 7 },
  { id: "b-streak14", emoji: "🌋", titel: "Unaufhaltsam", text: "14 Tage in Folge geübt", test: (p) => p.bestStreak >= 14 },
  { id: "b-hw1", emoji: "📬", titel: "Hausaufgaben-Held", text: "Eine Woche Hausaufgaben komplett", test: (p) => Object.keys(p.hwBonus).length >= 1 },
  { id: "b-puenktlich", emoji: "⏰", titel: "Pünktlich", text: "3 Wochen rechtzeitig fertig", test: (p) => Object.values(p.hwBonus).filter((x) => x.puenktlich).length >= 3 },
  { id: "b-hw8", emoji: "🗓️", titel: "Zuverlässig", text: "8 Wochen Hausaufgaben komplett", test: (p) => Object.keys(p.hwBonus).length >= 8 },
  { id: "b-text1", emoji: "📝", titel: "Erster Text", text: "Ersten Text abgegeben", test: (p) => p.textLog.length >= 1 },
  { id: "b-fixed", emoji: "🔁", titel: "Fehler-Besieger", text: "10 alte Fehler beim Wiederholen richtig", test: (p) => (p.totals.fixed || 0) >= 10 },
  { id: "b-lvl5", emoji: "⭐", titel: "Aufsteiger", text: "Level 5 erreicht", test: (p) => levelInfo(p.xp).level >= 5 },
  { id: "b-lvl10", emoji: "🏆", titel: "Legende", text: "Level 10 erreicht", test: (p) => levelInfo(p.xp).level >= 10 },
];
function alleAbzeichen() {
  const eigene = (S.data?.abzeichen || []).map((a) => ({
    ...a,
    test: (p) => {
      const b = a.bedingung || {};
      if (b.typ === "sterne") return (p.stations[b.station]?.stars || 0) >= b.wert;
      if (b.typ === "texte") return p.textLog.length >= b.wert;
      if (b.typ === "xp") return p.xp >= b.wert;
      if (b.typ === "runden") return p.rounds.length >= b.wert;
      return false;
    },
  }));
  return [...BASIS_ABZEICHEN, ...eigene];
}
function checkBadges() {
  const p = S.prog; const neu = [];
  for (const a of alleAbzeichen()) {
    if (!p.badges[a.id] && a.test(p)) { p.badges[a.id] = today(); neu.push(a); }
  }
  for (const a of neu) { addXP(25); S.queue.push({ kind: "badge", a }); }
  return neu;
}

// ===================================================================
// Fortschritt speichern (lokal + Cloudflare D1)
// ===================================================================
function freshProgress() {
  return { v: 1, xp: 0, days: {}, stations: {}, wrong: {}, badges: {}, hwDone: {}, hwBonus: {}, rounds: [], textLog: [], totals: { answers: 0, correct: 0, fixed: 0 }, avatar: null, bestStreak: 0, seenFeedback: [], onboarded: false, updatedAt: 0, dirty: false, syncedAt: 0 };
}
const lsKey = (id) => `lw:p:${id}`;
function saveLocal(id, p) { lsSet(lsKey(id), p); }

async function loadProgress(id) {
  const local = lsGet(lsKey(id));
  try {
    const j = await getJSON(`${API}/state?s=${encodeURIComponent(id)}`, { cache: "no-store" });
    S.online = true;
    if (j.progress && j.progress.reset && j.updatedAt > (local?.syncedAt || 0)) {
      const p = freshProgress(); p.syncedAt = j.updatedAt; saveLocal(id, p); return p;
    }
    if (local && local.dirty) return Object.assign(freshProgress(), local);
    if (j.progress && !j.progress.reset) {
      const p = Object.assign(freshProgress(), j.progress, { dirty: false, syncedAt: j.updatedAt });
      saveLocal(id, p); return p;
    }
    if (local) { local.dirty = true; return Object.assign(freshProgress(), local); }
    return freshProgress();
  } catch {
    S.online = false;
    return local ? Object.assign(freshProgress(), local) : freshProgress();
  }
}
function save() {
  const p = S.prog; if (!p) return;
  p.dirty = true; p.updatedAt = Date.now();
  if (p.rounds.length > 600) p.rounds = p.rounds.slice(-600);
  saveLocal(S.cur, p);
  clearTimeout(S.syncTimer);
  S.syncTimer = setTimeout(syncNow, 600);
}
async function syncNow() {
  const id = S.cur, p = S.prog; if (!id || !p) return;
  const { dirty, syncedAt, ...body } = p;
  try {
    const r = await fetch(`${API}/state`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ student: id, progress: body }) });
    if (!r.ok) throw new Error();
    const j = await r.json();
    if (S.cur === id && S.prog === p) { p.dirty = false; p.syncedAt = j.updatedAt; saveLocal(id, p); }
    S.online = true;
  } catch { S.online = false; }
  updateSyncDot();
  flushAttempts();
}
function queueAttempts(items) {
  const k = `lw:q:${S.cur}`; const q = lsGet(k, []); q.push(...items); lsSet(k, q.slice(-300));
}
async function flushAttempts() {
  const id = S.cur; if (!id) return;
  const k = `lw:q:${id}`; const q = lsGet(k, []); if (!q.length) return;
  try {
    const r = await fetch(`${API}/attempts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ student: id, items: q.slice(0, 40) }) });
    if (r.ok) { lsSet(k, q.slice(40)); if (q.length > 40) flushAttempts(); }
  } catch {}
}
window.addEventListener("online", () => syncNow());
function updateSyncDot() {
  const d = document.querySelector(".sync");
  if (!d) return;
  d.classList.toggle("off", !S.online);
  d.title = S.online ? "Gespeichert" : "Offline – wird später gespeichert";
}

// ===================================================================
// XP, Sound, Konfetti, Toasts
// ===================================================================
function addXP(n) {
  const p = S.prog; if (!n) return;
  const before = levelInfo(p.xp).level;
  p.xp += n;
  const d = today();
  (p.days[d] ||= { xp: 0, rounds: 0 }).xp += n;
  p.bestStreak = Math.max(p.bestStreak || 0, streakInfo(p).n);
  const after = levelInfo(p.xp).level;
  if (after > before) S.queue.push({ kind: "level", level: after });
}

let audioCtx = null;
function beep(kind) {
  if (!S.sound) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const notes = { ok: [660, 880], no: [220, 180], level: [523, 659, 784, 1047], badge: [784, 988, 1175], tap: [520] }[kind] || [440];
    notes.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = kind === "no" ? "sawtooth" : "triangle"; o.frequency.value = f;
      const t = audioCtx.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(kind === "no" ? 0.06 : 0.14, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.25);
    });
  } catch {}
}

function confetti(ms = 2200) {
  const c = document.getElementById("confetti"); const ctx = c.getContext("2d");
  const W = (c.width = innerWidth * devicePixelRatio), H = (c.height = innerHeight * devicePixelRatio);
  const cols = ["#ff7a45", "#13b5a5", "#ffc23d", "#6c5ce7", "#f2545b", "#22b26b"];
  const parts = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: -Math.random() * H * 0.5, vx: (Math.random() - 0.5) * 6, vy: 4 + Math.random() * 6, r: 5 + Math.random() * 7, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * cols.length) | 0] }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, W, H);
    for (const q of parts) { q.x += q.vx; q.y += q.vy; q.vy += 0.08; q.a += q.va; ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.a); ctx.fillStyle = q.c; ctx.fillRect(-q.r / 2, -q.r / 4, q.r, q.r / 2); ctx.restore(); }
    if (t - t0 < ms) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
  })(t0);
}
function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.innerHTML = msg;
  document.getElementById("toasts").appendChild(t); setTimeout(() => t.remove(), 3000);
}
function floatXP(n, el) {
  if (!n) return;
  const r = (el || document.body).getBoundingClientRect();
  const f = document.createElement("div"); f.className = "xp-float"; f.textContent = `+${n} XP`;
  f.style.left = `${r.left + r.width / 2 - 30}px`; f.style.top = `${Math.max(80, r.top)}px`;
  document.body.appendChild(f); setTimeout(() => f.remove(), 1000);
}

// Popups nacheinander zeigen (Level-Up, Abzeichen)
function showQueue() {
  if (modalRoot.querySelector(".modal-center")) return;
  const next = S.queue.shift(); if (!next) return;
  let html;
  if (next.kind === "level") {
    beep("level"); confetti();
    html = `<span class="emoji">🚀</span><h2>Level ${next.level}!</h2><p>Du bist jetzt <b>${esc(LEVEL_TITEL[Math.min(next.level, LEVEL_TITEL.length) - 1])}</b>.${neueAvatare(next.level)}</p>`;
  } else if (next.kind === "badge") {
    beep("badge");
    html = `<span class="emoji">${next.a.emoji}</span><h2>${esc(next.a.titel)}</h2><p>Neues Abzeichen: ${esc(next.a.text)} · +25 XP</p>`;
  } else if (next.kind === "hw") {
    beep("level"); confetti();
    html = `<span class="emoji">📬</span><h2>Hausaufgaben erledigt!</h2><p>${esc(next.titel)}<br>+100 XP${next.puenktlich ? " · pünktlich ⏰" : ""}</p>`;
  } else if (next.kind === "hello") {
    html = `<span class="emoji">${esc(currentAvatar())}</span><h2>Hallo ${esc(S.data.name)}!</h2><p style="text-align:left">So funktioniert deine Lernwelt:<br><br>🗺️ Auf der <b>Karte</b> spielst du Runden und sammelst bis zu 3 Sterne pro Station.<br>⚡ Jede richtige Antwort gibt <b>XP</b>, damit steigst du im Level auf.<br>🔥 Übe jeden Tag ein bisschen, dann wächst deine <b>Serie</b>.<br>📬 Unter <b>Aufgaben</b> findest du jede Woche deine Hausaufgaben.<br>🏅 Für Ziele gibt es <b>Abzeichen</b>.</p>`;
  }
  modalRoot.innerHTML = `<div class="modal-center"><div class="pop">${html}<button class="btn block" data-ok>Weiter</button></div></div>`;
  modalRoot.querySelector("[data-ok]").onclick = () => { modalRoot.innerHTML = ""; renderTopbarOnly(); setTimeout(showQueue, 150); };
}
function neueAvatare(level) {
  const neu = (S.data.avatare || []).filter((a) => a.level === level);
  return neu.length ? `<br>Neuer Avatar freigeschaltet: ${neu.map((a) => a.emoji).join(" ")}` : "";
}

// ===================================================================
// Inhalte
// ===================================================================
const stationen = () => S.data.stationen;
const stationById = (id) => stationen().find((s) => s.id === id);
function auftragById(id) {
  for (const s of stationen()) for (const a of s.auftraege || []) if (a.id === id) return { a, s };
  return null;
}
const isOpen = (st) => !st.oeffnetAm || st.oeffnetAm <= today();
const exId = (st, ex, i) => ex.id || `${st.id}-${i}`;
const currentAvatar = () => S.prog?.avatar || (S.schueler?.find((x) => x.id === S.cur)?.avatar) || "🙂";

function hwStatus(w, p = S.prog) {
  const items = (w.aufgaben || []).map((a, i) => {
    if (a.art === "station") {
      const st = stationById(a.station);
      const n = p.rounds.filter((r) => r.s === a.station && r.d >= w.start).length;
      return { ...a, i, st, done: n >= (a.runden || 1), have: Math.min(n, a.runden || 1), need: a.runden || 1 };
    }
    if (a.art === "schreiben") {
      const f = auftragById(a.auftrag);
      return { ...a, i, f, done: p.textLog.some((t) => t.a === a.auftrag && t.d >= w.start) };
    }
    return { ...a, i, done: !!p.hwDone[`${w.id}:${i}`] };
  });
  const doneCount = items.filter((x) => x.done).length;
  return { items, doneCount, total: items.length, complete: items.length > 0 && doneCount === items.length };
}
function aktuelleWoche() {
  const t = today();
  const sorted = [...S.hw].sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  return sorted.find((w) => w.start <= t) || sorted[sorted.length - 1] || null;
}
function checkHwBonus() {
  const p = S.prog;
  for (const w of S.hw) {
    if (p.hwBonus[w.id]) continue;
    if (hwStatus(w).complete) {
      const puenktlich = today() <= (w.faellig || "9999");
      p.hwBonus[w.id] = { d: today(), puenktlich };
      addXP(100);
      S.queue.push({ kind: "hw", titel: w.titel, puenktlich });
    }
  }
}
function hwStationTodo() {
  const w = aktuelleWoche(); if (!w) return {};
  const m = {};
  for (const it of hwStatus(w).items) if (it.art === "station" && !it.done) m[it.station] = it.need - it.have;
  for (const it of hwStatus(w).items) if (it.art === "schreiben" && !it.done && it.f) m[it.f.s.id] = (m[it.f.s.id] || 0) + 1;
  return m;
}

// ===================================================================
// Router
// ===================================================================
window.addEventListener("hashchange", route);
const go = (view, extra) => { location.hash = `#/s/${S.cur}/${view}${extra ? "/" + extra : ""}`; };

async function loadSchueler() {
  const j = await getJSON("data/schueler.json", { cache: "no-store" });
  S.schueler = j.schueler; S.lehrer = j.lehrer || "dein Lehrer";
}
async function login(id) {
  const [data, hw] = await Promise.all([
    getJSON(`data/${id}.json`, { cache: "no-cache" }),
    getJSON("data/hausaufgaben.json", { cache: "no-store" }).catch(() => ({})),
  ]);
  S.cur = id; S.data = data; S.hw = hw[id] || []; S.texts = null;
  S.prog = await loadProgress(id);
  applyTheme(data.thema);
  checkBadges(); checkHwBonus();
  if (!S.prog.onboarded) { S.prog.onboarded = true; S.queue.unshift({ kind: "hello" }); }
  save();
  loadTexts(); // im Hintergrund, für Rückmeldungs-Hinweis
}
function applyTheme(t = {}) {
  const r = document.documentElement.style;
  if (t.farbe) r.setProperty("--c1", t.farbe); else r.removeProperty("--c1");
  if (t.farbe2) r.setProperty("--c2", t.farbe2); else r.removeProperty("--c2");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.farbe || "#ff7a45");
}

async function route() {
  modalRoot.innerHTML = "";
  try {
    if (!S.schueler) await loadSchueler();
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (parts[0] === "lehrer") return renderLehrer();
    if (parts[0] !== "s" || !parts[1] || !S.schueler.some((x) => x.id === parts[1])) { S.cur = null; applyTheme({}); return renderStart(); }
    if (S.cur !== parts[1]) await login(parts[1]);
    applyTheme(S.data.thema);
    const view = parts[2] || "karte";
    if (view !== "runde") S.round = null;
    switch (view) {
      case "runde": return S.round ? renderRound() : go("karte");
      case "schreiben": return renderSchreiben(parts[3]);
      case "aufgaben": return renderShell("aufgaben", viewAufgaben());
      case "texte": return renderShell("texte", viewTexte());
      case "erfolge": return renderShell("erfolge", viewErfolge());
      case "fortschritt": return renderShell("fortschritt", viewFortschritt());
      default: return renderShell("karte", viewKarte());
    }
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="start"><div class="card" style="max-width:460px"><h2>Ups, da hat etwas nicht geklappt.</h2><p class="muted">${esc(e.message)}</p><button class="btn" onclick="location.hash='#/';location.reload()">Neu laden</button></div></div>`;
  }
}

// ===================================================================
// Startseite
// ===================================================================
function renderStart() {
  document.title = "Lernwelt";
  const cards = S.schueler.map((s) => {
    const p = lsGet(lsKey(s.id));
    const lv = p ? levelInfo(p.xp || 0) : null;
    const st = p ? streakInfo(Object.assign(freshProgress(), p)) : null;
    return `<button class="who-card" style="--c:${esc(s.farbe)}" data-id="${esc(s.id)}">
      <div class="ava">${esc(p?.avatar || s.avatar)}</div>
      <div class="nm">${esc(s.name)}</div>
      <div class="meta">${esc(s.klasse || "")}</div>
      ${lv ? `<div class="chips"><span class="chip">⭐ Level ${lv.level}</span><span class="chip">🔥 ${st.n}</span></div>` : `<div class="chips"><span class="chip">Los geht's!</span></div>`}
    </button>`;
  }).join("");
  app.innerHTML = `<div class="start">
    <div style="text-align:center"><div class="logo">Lern<span>welt</span></div><p class="lead">Wer lernt heute?</p></div>
    <div class="who">${cards}</div>
    <div class="foot"><a href="#/lehrer">Lehrer-Bereich</a></div>
  </div>`;
  app.querySelectorAll("[data-id]").forEach((b) => (b.onclick = () => { beep("tap"); location.hash = `#/s/${b.dataset.id}/karte`; }));
}

// ===================================================================
// Rahmen mit Kopfzeile und Navigation
// ===================================================================
function topbarHtml() {
  const p = S.prog, lv = levelInfo(p.xp), st = streakInfo(p);
  return `<button class="me" data-nav="erfolge" title="Avatar und Abzeichen">
      <div class="ava">${esc(currentAvatar())}</div>
      <div class="who-txt"><b>${esc(S.data.name)}</b>
        <div class="lvlbar">Lv ${lv.level}<span class="bar"><i style="width:${pct(lv.into / lv.need)}%"></i></span></div></div>
    </button>
    <span class="stat-pill flame ${st.activeToday ? "" : "off"}" title="${st.activeToday ? "Heute schon geübt!" : "Heute noch nicht geübt"}">🔥 ${st.n}</span>
    <span class="stat-pill" title="Erfahrungspunkte">⚡ ${p.xp}</span>
    <span class="sync ${S.online ? "" : "off"}" title="${S.online ? "Gespeichert" : "Offline"}"></span>
    <button class="iconbtn" data-sound title="Ton an/aus">${S.sound ? "🔊" : "🔇"}</button>
    <button class="iconbtn" data-home title="Anderer Schüler">🚪</button>`;
}
function renderTopbarOnly() {
  const tb = document.querySelector(".shell .topbar");
  if (tb) { tb.innerHTML = topbarHtml(); wireTopbar(tb); }
}
function wireTopbar(root) {
  root.querySelector("[data-sound]").onclick = () => { S.sound = !S.sound; lsSet("lw:sound", S.sound); renderTopbarOnly(); };
  root.querySelector("[data-home]").onclick = () => { location.hash = "#/"; };
  root.querySelector("[data-nav]").onclick = () => go("erfolge");
}
function unseenFeedback() {
  if (!S.texts) return 0;
  return S.texts.filter((t) => t.feedback && !S.prog.seenFeedback.includes(t.id)).length;
}
function renderShell(active, inner) {
  document.title = `${S.data.name} · Lernwelt`;
  const tabs = [["karte", "🗺️", "Karte"], ["aufgaben", "📬", "Aufgaben"], ["texte", "📝", "Texte"], ["erfolge", "🏅", "Erfolge"], ["fortschritt", "📈", "Fortschritt"]];
  const w = aktuelleWoche(); const hwOpen = w && !hwStatus(w).complete;
  app.innerHTML = `<div class="shell">
    <header class="topbar">${topbarHtml()}</header>
    <main class="view">${typeof inner === "string" ? inner : ""}</main>
    <nav class="navbar">${tabs.map(([k, ic, l]) => `<button data-tab="${k}" class="${k === active ? "on" : ""}"><span class="ic">${ic}</span>${l}${(k === "aufgaben" && hwOpen) || (k === "texte" && unseenFeedback()) ? '<span class="dot"></span>' : ""}</button>`).join("")}</nav>
  </div>`;
  wireTopbar(app.querySelector(".topbar"));
  app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  if (typeof inner === "function") inner(app.querySelector("main"));
  else wireView(active, app.querySelector("main"));
  window.scrollTo(0, 0);
  setTimeout(showQueue, 300);
}
function wireView(active, main) {
  ({ karte: wireKarte, aufgaben: wireAufgaben, texte: wireTexte, erfolge: wireErfolge, fortschritt: () => {} }[active] || (() => {}))(main);
}

// ===================================================================
// Karte (Lernpfad)
// ===================================================================
const OFFSETS = [0, 24, 0, -24];
function viewKarte() {
  const d = S.data, p = S.prog;
  const w = aktuelleWoche(); const hs = w ? hwStatus(w) : null;
  const todo = hwStationTodo();
  const hero = `<section class="hero">
    <div class="deco">${d.id === "rafi" ? "🧭" : "🏝️"}</div>
    <h1>${esc(d.welt)}</h1><p>${esc(d.untertitel || "")}</p>
    ${w ? `<button class="hw-mini" data-go="aufgaben">
      <div class="ring" style="--p:${pct(hs.doneCount / Math.max(1, hs.total))}"><span>${hs.doneCount}/${hs.total}</span></div>
      <div><b>${hs.complete ? "Hausaufgaben erledigt! 🎉" : "Hausaufgaben dieser Woche"}</b><small>${esc(w.titel)} · bis ${fmtDateLong(w.faellig)}</small></div>
    </button>` : ""}
  </section>`;

  // Stationen nach Phase
  const phasen = [...new Set(stationen().map((s) => s.phase || 1))].sort();
  let firstOpenUndone = stationen().find((s) => isOpen(s) && !(p.stations[s.id]?.stars >= 3) && s.typ !== "schreiben");
  let idx = 0;
  const rows = [];
  const phaseInfo = {
    1: { t: "Phase 1", s: "bis Ende November", after: "🏁 Zwischentest am 06.12." },
    2: { t: "Phase 2", s: "Dezember bis Januar", after: "🏆 Abschlusstest am 24.01." },
  };
  for (const ph of phasen) {
    const info = phaseInfo[ph] || { t: `Phase ${ph}`, s: "" };
    rows.push(`<div class="phase-banner"><b>${info.t}</b><small>${info.s}</small></div>`);
    for (const st of stationen().filter((s) => (s.phase || 1) === ph)) {
      const rec = p.stations[st.id] || {};
      const open = isOpen(st);
      const off = OFFSETS[idx % OFFSETS.length]; idx++;
      const cls = ["node", !open && "locked", rec.stars >= 3 && "done", st.typ === "schreiben" && "write"].filter(Boolean).join(" ");
      const tag = todo[st.id] ? `<span class="hwtag">HA</span>` : "";
      rows.push(`<div class="node-row" data-x="${50 + off}"><button class="${cls}" style="left:${50 + off}%" data-st="${esc(st.id)}" aria-label="${esc(st.titel)}">
        <div class="bubble">${firstOpenUndone === st ? '<span class="pulse"></span>' : ""}${tag}${esc(st.emoji)}</div>
        <div class="lbl">${esc(st.titel)}${st.aufgaben ? `<small class="cnt">${st.aufgaben.length} Übungen</small>` : ""}</div>
        <div class="stars">${open ? starsHtml(rec.stars || 0) : `<small class="muted" style="font-weight:800;font-size:12px">ab ${fmtDate(st.oeffnetAm)}</small>`}</div>
      </button></div>`);
    }
    if (info.after) rows.push(`<div class="milestone"><div>${info.after}</div></div>`);
  }
  return hero + `<div class="path"><svg class="trail" aria-hidden="true"></svg>${rows.join("")}</div>`;
}
function wireKarte(main) {
  main.querySelector("[data-go]")?.addEventListener("click", () => go("aufgaben"));
  main.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => { beep("tap"); openStation(b.dataset.st); }));
  drawTrail(main.querySelector(".path"));
}
function drawTrail(path) {
  const svg = path.querySelector("svg"); const rect = path.getBoundingClientRect();
  const pts = [...path.querySelectorAll(".node-row")].map((r) => {
    const b = r.querySelector(".bubble").getBoundingClientRect();
    return [b.left + b.width / 2 - rect.left, b.top + b.height / 2 - rect.top];
  });
  let dpath = "";
  pts.forEach(([x, y], i) => {
    if (i === 0) { dpath += `M${x},${y}`; return; }
    const [px, py] = pts[i - 1]; const my = (py + y) / 2;
    dpath += ` C${px},${my} ${x},${my} ${x},${y}`;
  });
  svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
  svg.innerHTML = `<path d="${dpath}" fill="none" style="stroke:color-mix(in srgb, var(--c1) 35%, #fff)" stroke-width="10" stroke-linecap="round" stroke-dasharray="2 18"/>`;
}
window.addEventListener("resize", () => { const p = document.querySelector(".path"); if (p) drawTrail(p); });

function openStation(id) {
  const st = stationById(id); const rec = S.prog.stations[id] || {};
  const open = isOpen(st);
  let body = "";
  if (!open) {
    body = `<p class="muted" style="font-weight:700">Diese Station öffnet am <b>${fmtDateLong(st.oeffnetAm)}</b>. Bis dahin: Sterne auf den anderen Stationen sammeln!</p>`;
  } else if (st.typ === "schreiben") {
    const counts = {};
    for (const t of S.prog.textLog) counts[t.a] = (counts[t.a] || 0) + 1;
    body = `<div class="regel">${esc(st.regel)}</div>
      <div class="task-list">${st.auftraege.map((a) => `<button class="task ${counts[a.id] ? "done" : ""}" data-a="${esc(a.id)}">
        <span class="ti">${counts[a.id] ? "✅" : "📝"}</span>
        <span class="tx"><b>${esc(a.titel)}</b><small>${counts[a.id] ? `abgegeben (${counts[a.id]}×)` : `mind. ${a.minWoerter || 0} Wörter`}</small></span>
        <span>›</span></button>`).join("")}</div>`;
  } else {
    body = `<div class="kpis">
        <div class="kpi"><b class="stars">${starsHtml(rec.stars || 0)}</b><small>Sterne</small></div>
        <div class="kpi"><b>${rec.best != null ? pct(rec.best) + " %" : "–"}</b><small>Bestes Ergebnis</small></div>
        <div class="kpi"><b>${rec.rounds || 0}</b><small>Runden</small></div>
      </div>
      <details ${rec.rounds ? "" : "open"}><summary class="linkbtn" style="list-style:none">💡 Merkkasten ${rec.rounds ? "anzeigen" : ""}</summary><div class="regel">${esc(st.regel)}</div></details>
      <p class="muted" style="font-weight:700;font-size:14px">📚 ${st.aufgaben.length} Übungen in dieser Station · jede Runde mischt neu</p>
      <p class="muted" style="font-weight:700;font-size:14px">⭐ ab 50 %  ·  ⭐⭐ ab 75 %  ·  ⭐⭐⭐ ab 90 %</p>
      <button class="btn block" data-start>Runde starten · ${Math.min(st.rundenGroesse || 8, st.aufgaben.length)} Aufgaben</button>`;
  }
  modalRoot.innerHTML = `<div class="backdrop"><div class="sheet" role="dialog" aria-modal="true">
    <div class="sheet-head"><div class="big">${esc(st.emoji)}</div><div><h2>${esc(st.titel)}</h2><div class="muted" style="font-weight:700">${esc(st.kurz || "")}</div></div>
    <button class="iconbtn close" data-close aria-label="Schließen">✕</button></div>
    ${body}</div></div>`;
  const bd = modalRoot.querySelector(".backdrop");
  bd.onclick = (e) => { if (e.target === bd) modalRoot.innerHTML = ""; };
  modalRoot.querySelector("[data-close]").onclick = () => (modalRoot.innerHTML = "");
  modalRoot.querySelector("[data-start]")?.addEventListener("click", () => startRound(id));
  modalRoot.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => go("schreiben", b.dataset.a)));
}

// ===================================================================
// Runde
// ===================================================================
function startRound(stationId) {
  const st = stationById(stationId); const p = S.prog;
  const pool = st.aufgaben.map((ex, i) => ({ ex, id: exId(st, ex, i) }));
  const size = Math.min(st.rundenGroesse || 8, pool.length);
  const picked = []; const cand = [...pool];
  while (picked.length < size && cand.length) {
    const w = cand.map((c) => 1 + 3 * Math.min(p.wrong[c.id] || 0, 3));
    let r = Math.random() * w.reduce((a, b) => a + b, 0); let k = 0;
    while (k < w.length - 1 && r > w[k]) { r -= w[k]; k++; }
    picked.push(cand.splice(k, 1)[0]);
  }
  S.round = { st, items: picked, i: 0, results: [], combo: 0, maxCombo: 0, xp: 0, done: false, wasWrong: picked.map((x) => (p.wrong[x.id] || 0) > 0) };
  modalRoot.innerHTML = "";
  if (location.hash.endsWith("/runde")) renderRound(); else go("runde");
}

function renderRound() {
  const R = S.round;
  if (R.done) return renderResult();
  const cur = R.items[R.i]; const ex = cur.ex;
  const handler = EX[ex.typ];
  app.innerHTML = `<div class="round">
    <div class="round-top">
      <button class="iconbtn" data-quit aria-label="Runde beenden">✕</button>
      <div class="progress"><i style="width:${pct(R.i / R.items.length)}%"></i></div>
      <div class="combo">${R.combo >= 2 ? `🔥${R.combo}` : ""}</div>
    </div>
    <div class="ex">${handler.html(ex, cur)}</div>
    <div class="footer"><div class="in"><div class="fb"></div><button class="btn block" data-check ${handler.manual ? "" : 'style="display:none"'}>Prüfen</button></div></div>
  </div>`;
  app.querySelector("[data-quit]").onclick = () => {
    if (R.i === 0 || confirm("Runde wirklich abbrechen? Dein Fortschritt in dieser Runde geht verloren.")) { S.round = null; go("karte"); }
  };
  const exEl = app.querySelector(".ex");
  const ctx = { ex, cur, st: R.st, el: exEl, answered: false };
  ctx.finish = (res) => finishItem(res, ctx);
  handler.mount(ctx);
  const checkBtn = app.querySelector("[data-check]");
  checkBtn.onclick = () => { if (!ctx.answered) { const res = handler.check(ctx); if (res) finishItem(res, ctx); } };
  window.scrollTo(0, 0);
}

function finishItem(res, ctx) {
  if (ctx.answered) return; ctx.answered = true;
  const R = S.round; const cur = R.items[R.i]; const p = S.prog;
  const v = clamp(res.value, 0, 1);
  const perfect = v >= 1;
  if (perfect) { R.combo++; R.maxCombo = Math.max(R.maxCombo, R.combo); } else R.combo = 0;
  let xp = Math.round(10 * v) + (perfect && R.combo >= 3 ? 2 : 0);
  R.xp += xp;
  p.totals.answers++; if (perfect) p.totals.correct++;
  if (perfect) { if (p.wrong[cur.id]) { p.wrong[cur.id]--; p.totals.fixed = (p.totals.fixed || 0) + 1; if (!p.wrong[cur.id]) delete p.wrong[cur.id]; } }
  else p.wrong[cur.id] = Math.min((p.wrong[cur.id] || 0) + 1, 5);
  R.results.push({ id: cur.id, value: v, answer: res.answer, solution: res.solution, prompt: res.prompt, typ: cur.ex.typ });
  beep(perfect ? "ok" : "no");

  const footer = app.querySelector(".footer");
  footer.classList.add(perfect ? "ok" : "no");
  const head = perfect ? ["✅", ["Richtig!", "Super!", "Klasse!", "Genau!", "Stark!"][Math.floor(Math.random() * 5)]] : v > 0 ? ["🟡", "Fast!"] : ["❌", "Nicht ganz."];
  footer.querySelector(".fb").innerHTML = `<div class="fb-head">${head[0]} ${head[1]} ${R.combo >= 3 ? `<span style="font-size:16px">🔥 ${R.combo} in Folge!</span>` : ""}</div>
    <div class="fb-txt">${res.feedback || ""}</div>`;
  const btn = footer.querySelector("[data-check]");
  btn.style.display = ""; btn.textContent = R.i + 1 < R.items.length ? "Weiter" : "Ergebnis";
  btn.className = `btn block ${perfect ? "green" : "red"}`;
  btn.onclick = () => { R.i++; if (R.i >= R.items.length) endRound(); else renderRound(); };
  btn.focus();
  floatXP(xp, app.querySelector(".round-top .progress"));
  const comboEl = app.querySelector(".combo"); if (comboEl) { comboEl.textContent = R.combo >= 2 ? `🔥${R.combo}` : ""; comboEl.classList.add("pop-in"); }
  app.querySelector(".progress i").style.width = `${pct((R.i + 1) / R.items.length)}%`;
}

function endRound() {
  const R = S.round; const p = S.prog; const st = R.st;
  const score = R.results.reduce((a, r) => a + r.value, 0) / R.results.length;
  const stars = score >= 0.9 ? 3 : score >= 0.75 ? 2 : score >= 0.5 ? 1 : 0;
  const rec = (p.stations[st.id] ||= { best: 0, stars: 0, rounds: 0 });
  const newStars = Math.max(0, stars - (rec.stars || 0));
  rec.best = Math.max(rec.best || 0, score); rec.stars = Math.max(rec.stars || 0, stars); rec.rounds = (rec.rounds || 0) + 1; rec.last = today();
  const bonus = (score >= 0.5 ? 20 : 10) + newStars * 15;
  R.xp += bonus;
  addXP(R.xp);
  p.rounds.push({ s: st.id, d: today(), score: Math.round(score * 100) / 100 });
  (p.days[today()] ||= { xp: 0, rounds: 0 }).rounds++;
  queueAttempts(R.results.map((r) => ({ station: st.id, exercise: r.id, prompt: r.prompt, answer: r.answer, solution: r.solution, score: r.value })));
  checkBadges(); checkHwBonus();
  save();
  Object.assign(R, { done: true, score, stars, newStars, bonus });
  renderResult();
}

function renderResult() {
  const R = S.round;
  const msg = R.stars === 3 ? "Perfekt gemacht!" : R.stars === 2 ? "Richtig gut!" : R.stars === 1 ? "Geschafft!" : "Weiter üben, du schaffst das!";
  const wrong = R.results.filter((r) => r.value < 1);
  app.innerHTML = `<div class="result">
    <div class="bigstars">${[0, 1, 2].map((i) => `<span class="${i < R.stars ? "" : "off"}">⭐</span>`).join("")}</div>
    <h1>${msg}</h1>
    <div class="muted" style="font-weight:800">${esc(R.st.emoji)} ${esc(R.st.titel)}${R.newStars ? ` · ${R.newStars} neue${R.newStars > 1 ? "" : "r"} Stern${R.newStars > 1 ? "e" : ""}!` : ""}</div>
    <div class="res-kpis">
      <div><b>${pct(R.score)} %</b><small>richtig</small></div>
      <div><b>+${R.xp}</b><small>XP</small></div>
      <div><b>${R.maxCombo}</b><small>beste Serie</small></div>
    </div>
    ${wrong.length ? `<div class="review"><h3>📌 Das schauen wir uns nochmal an</h3>${wrong.map((r) => `<div class="it">${esc(r.prompt)}<br>${r.answer ? `<span class="ans">${esc(r.answer)}</span> → ` : ""}<span class="sol">${esc(r.solution)}</span></div>`).join("")}<p class="muted" style="font-weight:700;font-size:14px">Diese Aufgaben kommen in den nächsten Runden öfter dran.</p></div>` : ""}
    <div class="row-btns">
      <button class="btn ghost" data-again>Nochmal</button>
      <button class="btn" data-map>Zur Karte</button>
    </div>
  </div>`;
  if (R.stars >= 2) setTimeout(() => confetti(), 300);
  app.querySelector("[data-again]").onclick = () => startRound(R.st.id);
  app.querySelector("[data-map]").onclick = () => { S.round = null; go("karte"); };
  setTimeout(showQueue, 1200);
}

// ---------- Übungstypen ----------
function satzHtml(s, fill) {
  let h = esc(s);
  h = h.replace(/\[([^\]]+)\]/g, "<mark>$1</mark>");
  h = h.replace(/___/g, () => `<span class="blank ${fill ? "filled " + fill.cls : ""}">${fill ? esc(fill.text) : "____"}</span>`);
  return h.replace(/\n/g, "<br>");
}
const plainSatz = (s) => (s || "").replace(/\[([^\]]+)\]/g, "$1");
const norm = (s) => String(s || "").normalize("NFC").replace(/[„“”"]/g, '"').replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "").trim();
const sameLoose = (a, b) => norm(a).toLocaleLowerCase("de") === norm(b).toLocaleLowerCase("de");
const UMLAUTE = ["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü"];
function wireKeys(el, inp) {
  el.querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
    const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s;
    inp.value = inp.value.slice(0, s) + b.dataset.k + inp.value.slice(e);
    inp.focus(); inp.setSelectionRange(s + 1, s + 1);
  }));
}
const keysHtml = () => `<div class="keys">${UMLAUTE.map((k) => `<button type="button" data-k="${k}">${k}</button>`).join("")}</div>`;

const EX = {
  // Multiple Choice: Antwort tippen = sofort prüfen
  mc: {
    manual: false,
    html(ex) {
      const opts = ex.optionen.length >= 4 && !ex.optionen.every((o) => /^\d+$/.test(o)) ? shuffle(ex.optionen) : ex.optionen;
      const two = opts.length === 2 && opts.every((o) => o.length < 12);
      return `<span class="typ">Auswählen</span><div class="q">${esc(ex.frage)}</div>
        ${ex.satz ? `<div class="satz">${satzHtml(ex.satz)}</div>` : ""}
        <div class="opts ${two ? "two" : ""}">${opts.map((o) => `<button class="opt" data-o="${esc(o)}">${esc(o)}</button>`).join("")}</div>`;
    },
    mount(ctx) {
      const { ex, el } = ctx;
      el.querySelectorAll("[data-o]").forEach((b) => (b.onclick = () => {
        if (ctx.answered) return;
        const choice = b.dataset.o, ok = choice === ex.loesung;
        el.querySelectorAll("[data-o]").forEach((x) => { x.disabled = true; if (x.dataset.o === ex.loesung) x.classList.add("ok"); });
        if (!ok) b.classList.add("no");
        if (ex.satz && ex.satz.includes("___")) el.querySelector(".satz").innerHTML = satzHtml(ex.satz, { text: ex.loesung, cls: ok ? "ok" : "no" });
        ctx.finish({
          value: ok ? 1 : 0, answer: choice, solution: ex.loesung,
          prompt: `${ex.frage} ${plainSatz(ex.satz || "")}`.trim(),
          feedback: `${ok ? "" : `Richtig ist: <span class="sol">${esc(ex.loesung)}</span><br>`}${esc(ex.erklaerung || "")}`,
        });
      }));
    },
  },

  // Eingabe: Wort oder Form eintippen
  eingabe: {
    manual: true,
    html(ex) {
      return `<span class="typ">Schreiben</span><div class="q">${esc(ex.frage)}</div>
        <div class="satz">${satzHtml(ex.satz)}</div>
        <input class="inp" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Deine Antwort …" aria-label="Antwort">
        ${keysHtml()}`;
    },
    mount(ctx) {
      const inp = ctx.el.querySelector(".inp"); wireKeys(ctx.el, inp);
      setTimeout(() => inp.focus(), 50);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") app.querySelector("[data-check]").click(); });
    },
    check(ctx) {
      const { ex, el } = ctx; const inp = el.querySelector(".inp");
      const val = inp.value; if (!norm(val)) { inp.focus(); return null; }
      const sols = Array.isArray(ex.loesung) ? ex.loesung : [ex.loesung];
      const egal = ex.egalGross || ctx.st?.egalGross;
      const ok = sols.some((s) => norm(s) === norm(val) || (egal && sameLoose(s, val)));
      const nearCase = !ok && sols.some((s) => sameLoose(s, val));
      inp.classList.add(ok ? "ok" : "no"); inp.disabled = true;
      ctx.el.querySelectorAll("[data-k]").forEach((b) => (b.disabled = true));
      return {
        value: ok ? 1 : 0, answer: val, solution: sols[0], prompt: `${ex.frage} ${plainSatz(ex.satz)}`,
        feedback: `${ok ? "" : `${nearCase ? "Achte auf Groß- und Kleinschreibung! " : ""}Richtig ist: <span class="sol">${esc(sols[0])}</span><br>`}${esc(ex.erklaerung || "")}`,
      };
    },
  },

  // Diktat: vorlesen lassen und schreiben
  diktat: {
    manual: true,
    html(ex) {
      const tts = canSpeak();
      return `<span class="typ">Diktat</span><div class="q">${tts ? "Hör zu und schreib, was du hörst." : "Schau dir das Wort an, merk es dir und schreib es auswendig."}</div>
        ${ex.tipp ? `<p class="muted" style="font-weight:800;margin-top:-8px">Tipp: ${esc(ex.tipp)}</p>` : ""}
        ${tts ? `<div class="speak"><button data-say title="Anhören">🔊</button><button class="slow" data-slow title="Langsam anhören">🐢</button></div>`
              : `<div class="memo" data-memo>${esc(ex.text)}</div><button class="btn ghost block" data-hide>Ich hab's mir gemerkt</button><div style="height:12px"></div>`}
        <input class="inp" ${tts ? "" : "disabled"} autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Hier schreiben …" aria-label="Antwort">
        ${keysHtml()}`;
    },
    mount(ctx) {
      const { ex, el } = ctx; const inp = el.querySelector(".inp"); wireKeys(el, inp);
      inp.addEventListener("keydown", (e) => { if (e.key === "Enter") app.querySelector("[data-check]").click(); });
      if (canSpeak()) {
        el.querySelector("[data-say]").onclick = () => speak(ex.text, 0.85);
        el.querySelector("[data-slow]").onclick = () => speak(ex.text, 0.55);
        setTimeout(() => { speak(ex.text, 0.85); inp.focus(); }, 300);
      } else {
        el.querySelector("[data-hide]").onclick = (e) => { el.querySelector("[data-memo]").style.visibility = "hidden"; e.target.remove(); inp.disabled = false; inp.focus(); };
      }
    },
    check(ctx) {
      const { ex, el } = ctx; const inp = el.querySelector(".inp");
      const val = inp.value; if (!norm(val)) { inp.focus(); return null; }
      const ok = norm(val) === norm(ex.text);
      inp.classList.add(ok ? "ok" : "no"); inp.disabled = true;
      const memo = el.querySelector("[data-memo]"); if (memo) memo.style.visibility = "visible";
      return {
        value: ok ? 1 : 0, answer: val, solution: ex.text, prompt: `Diktat: ${ex.text}`,
        feedback: ok ? esc(ex.tipp ? `Richtig geschrieben: ${ex.text}` : "") : `${sameLoose(val, ex.text) ? "Achte auf Groß- und Kleinschreibung! " : ""}Richtig ist: <span class="sol">${esc(ex.text)}</span>`,
      };
    },
  },

  // Fehler finden: falsche Wörter antippen
  fehler: {
    manual: true,
    html(ex, cur) {
      const toks = parseFehler(ex.text); cur._toks = toks;
      const n = toks.filter((t) => t.err).length;
      return `<span class="typ">Fehler finden</span><div class="q">Tippe alle ${n} Fehler an.</div>
        <div class="tokens">${toks.map((t, i) => (t.space ? t.text : t.click ? `<button class="tok" data-t="${i}">${esc(t.text)}</button>` : esc(t.text))).join("")}</div>
        <p class="muted" style="font-weight:700;font-size:14px;margin-top:10px">Nochmal tippen hebt die Markierung auf.</p>`;
    },
    mount(ctx) {
      ctx.el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { if (!ctx.answered) { b.classList.toggle("sel"); beep("tap"); } }));
    },
    check(ctx) {
      const toks = ctx.cur._toks; const el = ctx.el;
      let found = 0, fp = 0; const n = toks.filter((t) => t.err).length;
      const missed = [];
      el.querySelectorAll("[data-t]").forEach((b) => {
        const t = toks[+b.dataset.t]; const sel = b.classList.contains("sel"); b.disabled = true;
        b.classList.remove("sel");
        if (t.err && sel) { found++; b.classList.add("found"); b.innerHTML = `${esc(t.text)}<span class="fix">${esc(t.fix)}</span>`; }
        else if (t.err) { missed.push(t); b.classList.add("missed"); b.innerHTML = `${esc(t.text)}<span class="fix">${esc(t.fix)}</span>`; }
        else if (sel) { fp++; b.classList.add("fp"); }
      });
      const value = n ? Math.max(0, found - fp) / n : 1;
      return {
        value, answer: `${found}/${n} gefunden, ${fp} falsch markiert`, solution: toks.filter((t) => t.err).map((t) => `${t.text} → ${t.fix}`).join(", "),
        prompt: `Fehlertext: ${toks.map((t) => t.text).join("").slice(0, 120)}…`,
        feedback: `Du hast <b>${found} von ${n}</b> Fehlern gefunden${fp ? ` und <b>${fp}</b> richtige Wörter markiert (das zählt als Fehler)` : ""}.${missed.length ? `<br>Übersehen: ${missed.map((t) => `<span class="sol">${esc(t.text)} → ${esc(t.fix)}</span>`).join(" ")}` : ""}`,
      };
    },
  },

  // Kommas setzen: Lücken antippen
  komma: {
    manual: true,
    html(ex, cur) {
      const words = ex.satz.split(/\s+/);
      const need = new Set(); const clean = words.map((w, i) => { if (w.endsWith("|")) { need.add(i); return w.slice(0, -1); } return w; });
      cur._k = { words: clean, need };
      return `<span class="typ">Kommas</span><div class="q">Setze die fehlenden Kommas. Tippe auf die Lücke zwischen zwei Wörtern.</div>
        <div class="satz komma-words">${clean.map((w, i) => `${esc(w)}${i < clean.length - 1 ? ` <button class="gap" data-g="${i}" aria-label="Komma nach ${esc(w)}"></button> ` : ""}`).join("")}</div>
        <p class="muted" style="font-weight:700;font-size:14px">Manchmal ist auch gar kein Komma richtig!</p>`;
    },
    mount(ctx) {
      ctx.el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => { if (ctx.answered) return; b.classList.toggle("on"); b.textContent = b.classList.contains("on") ? "," : ""; beep("tap"); }));
    },
    check(ctx) {
      const { words, need } = ctx.cur._k; let hit = 0, wrong = 0; const chosen = new Set();
      ctx.el.querySelectorAll("[data-g]").forEach((b) => {
        const i = +b.dataset.g; const on = b.classList.contains("on"); if (on) chosen.add(i); b.disabled = true;
        b.classList.remove("on");
        if (need.has(i) && on) { hit++; b.classList.add("right"); b.textContent = ","; }
        else if (need.has(i)) { b.classList.add("missing"); b.textContent = ","; }
        else if (on) { wrong++; b.classList.add("wrong"); b.textContent = "✕"; }
      });
      const value = need.size ? Math.max(0, hit - wrong) / need.size : chosen.size ? 0 : 1;
      const correct = words.map((w, i) => w + (need.has(i) ? "," : "")).join(" ");
      const mine = words.map((w, i) => w + (chosen.has(i) ? "," : "")).join(" ");
      return { value, answer: mine, solution: correct, prompt: `Kommas: ${words.join(" ")}`, feedback: `${value < 1 ? `Richtig: <span class="sol">${esc(correct)}</span><br>` : ""}${esc(ctx.ex.erklaerung || "")}` };
    },
  },
};

function parseFehler(text) {
  const toks = [];
  for (const part of text.split(/(\{[^}]+\})/)) {
    if (!part) continue;
    const m = part.match(/^\{([^|]*)\|([^}]*)\}$/);
    if (m) { toks.push({ text: m[1], fix: m[2], err: true, click: true }); continue; }
    for (const p of part.split(/(\s+)/)) {
      if (!p) continue;
      if (/^\s+$/.test(p)) toks.push({ text: p, space: true });
      else toks.push({ text: p, click: /[\p{L}\d]/u.test(p) });
    }
  }
  return toks;
}

// Sprachausgabe für Diktate
let deVoice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  deVoice = vs.find((v) => v.lang === "de-DE" && /google|anna|petra|helena|katja|neural/i.test(v.name)) || vs.find((v) => v.lang?.startsWith("de")) || null;
}
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
const canSpeak = () => "speechSynthesis" in window && (deVoice || speechSynthesis.getVoices().length === 0);
function speak(text, rate = 0.85) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.lang = "de-DE"; u.rate = rate; if (deVoice) u.voice = deVoice;
    speechSynthesis.speak(u);
  } catch {}
}

// ===================================================================
// Hausaufgaben
// ===================================================================
function viewAufgaben() {
  if (!S.hw.length) return `<div class="empty"><span class="e">📭</span>Noch keine Hausaufgaben eingetragen.</div>`;
  const t = today();
  const byStart = (a, b) => (a.start || "").localeCompare(b.start || "");
  const isDone = (w) => hwStatus(w).complete;
  const cur = aktuelleWoche();
  // Gruppen: diese Woche (falls offen), ältere offene Wochen, kommende Wochen, erledigte Wochen
  const offenAlt = S.hw.filter((w) => w !== cur && w.start <= t && !isDone(w)).sort(byStart).reverse(); // neueste zuerst
  const zukunft = S.hw.filter((w) => w.start > t).sort(byStart); // nächste Woche zuerst
  const erledigt = S.hw.filter((w) => (w === cur || w.start <= t) && isDone(w)).sort(byStart).reverse();
  const dueHtml = (w, hs) => {
    const left = daysBetween(t, w.faellig);
    return hs.complete ? `<span class="due ok">✅ erledigt</span>` : left < 0 ? `<span class="due late">überfällig seit ${-left} Tag${left === -1 ? "" : "en"}</span>` : left <= 1 ? `<span class="due soon">fällig ${left === 0 ? "heute" : "morgen"}</span>` : `<span class="due">fällig ${fmtDateLong(w.faellig)}<br><span class="muted">noch ${left} Tage</span></span>`;
  };
  const head = (w, hs) => `<div class="week-head"><div><h3>${esc(w.titel)}</h3><div class="muted" style="font-weight:700;font-size:14px">${fmtDate(w.start)} bis ${fmtDate(w.faellig)}</div></div>${dueHtml(w, hs)}</div>`;
  // Offene Woche: offene Aufgaben zeigen, erledigte eingeklappt darunter
  const card = (w, withNote) => {
    const hs = hwStatus(w);
    const todo = hs.items.filter((it) => !it.done), done = hs.items.filter((it) => it.done);
    return `<div class="card week">
      ${head(w, hs)}
      ${withNote && w.notiz ? `<div class="note"><div class="t-ava">👨‍🏫</div><div class="bub"><small>${esc(S.lehrer)}</small>${esc(w.notiz)}</div></div>` : ""}
      <div class="week-progress"><div class="meter"><i style="width:${hs.total ? Math.round((hs.doneCount / hs.total) * 100) : 0}%"></i></div><small>${hs.doneCount} von ${hs.total} erledigt</small></div>
      <div class="task-list">${todo.map((it) => taskHtml(w, it)).join("")}</div>
      ${done.length ? `<details class="done-tasks"><summary>✓ ${done.length} erledigt anzeigen</summary><div class="task-list">${done.map((it) => taskHtml(w, it)).join("")}</div></details>` : ""}
      ${hs.total ? `<div class="bonus">🎁 Alles erledigt = +100 XP Bonus</div>` : ""}
    </div>`;
  };
  // Kommende Woche: nur kurze Vorschau, Runden zählen erst ab dem Start
  const preview = (w) => `<div class="card week week-soon">
      <div class="week-head"><div><h3>${esc(w.titel)}</h3><div class="muted" style="font-weight:700;font-size:14px">${fmtDate(w.start)} bis ${fmtDate(w.faellig)} · ${(w.aufgaben || []).length} Aufgaben</div></div><span class="due">ab ${fmtDateLong(w.start)}</span></div>
    </div>`;
  // Erledigte Woche: eine Zeile
  const doneRow = (w) => {
    const bonus = S.prog.hwBonus[w.id];
    return `<div class="week-done"><span>✅</span><div><b>${esc(w.titel)}</b><small>${fmtDate(w.start)} bis ${fmtDate(w.faellig)}${bonus ? ` · +100 XP${bonus.puenktlich ? " · pünktlich ⏰" : ""}` : ""}</small></div></div>`;
  };
  const curOpen = cur && cur.start <= t && !isDone(cur);
  const curDone = cur && cur.start <= t && isDone(cur);
  const next = zukunft[0];
  return `<div class="section-title" style="margin-top:4px"><h2>📬 Deine Hausaufgaben</h2></div>
    ${curOpen ? card(cur, true) : ""}
    ${curDone ? `<div class="card week all-done"><span class="e">🎉</span><div><b>Diese Woche ist alles erledigt!</b><small>${esc(cur.titel)}${next ? ` · Die nächste Woche startet ${fmtDateLong(next.start)}` : ""}</small></div></div>` : ""}
    ${!curOpen && !curDone && !offenAlt.length && !zukunft.length ? `<div class="empty"><span class="e">🎉</span>Alles erledigt!</div>` : ""}
    ${offenAlt.length ? `<div class="section-title"><h2>Noch nicht fertig</h2><span class="muted">${offenAlt.length} Woche${offenAlt.length > 1 ? "n" : ""}</span></div>${offenAlt.map((w) => card(w, false)).join("")}` : ""}
    ${zukunft.length ? `<div class="section-title"><h2>Demnächst</h2></div>${zukunft.map(preview).join("")}` : ""}
    ${erledigt.length ? `<details class="old-weeks"><summary>Erledigte Wochen (${erledigt.length})</summary>${erledigt.map(doneRow).join("")}</details>` : ""}`;
}
function taskHtml(w, it) {
  if (it.art === "station") {
    const st = it.st;
    return `<button class="task ${it.done ? "done" : ""}" data-hw-st="${esc(it.station)}">
      <span class="check">${it.done ? "✓" : ""}</span><span class="ti">${esc(st?.emoji || "🎯")}</span>
      <span class="tx"><b>${it.need} Runde${it.need > 1 ? "n" : ""}: ${esc(st?.titel || it.station)}</b><small>${it.have} von ${it.need} geschafft</small></span><span>›</span></button>`;
  }
  if (it.art === "schreiben") {
    return `<button class="task ${it.done ? "done" : ""}" data-hw-a="${esc(it.auftrag)}">
      <span class="check">${it.done ? "✓" : ""}</span><span class="ti">📝</span>
      <span class="tx"><b>Text: ${esc(it.f?.a.titel || it.auftrag)}</b><small>${it.done ? "abgegeben" : "in der App schreiben und abgeben"}</small></span><span>›</span></button>`;
  }
  return `<button class="task ${it.done ? "done" : ""}" data-hw-x="${esc(w.id)}:${it.i}">
    <span class="check">${it.done ? "✓" : ""}</span><span class="ti">✏️</span>
    <span class="tx"><b>${esc(it.text)}</b><small>${it.done ? "erledigt" : "selbst abhaken, wenn du fertig bist"}</small></span></button>`;
}
function wireAufgaben(main) {
  main.querySelectorAll("[data-hw-st]").forEach((b) => (b.onclick = () => openStation(b.dataset.hwSt)));
  main.querySelectorAll("[data-hw-a]").forEach((b) => (b.onclick = () => go("schreiben", b.dataset.hwA)));
  main.querySelectorAll("[data-hw-x]").forEach((b) => (b.onclick = () => {
    const k = b.dataset.hwX; const p = S.prog;
    if (p.hwDone[k]) delete p.hwDone[k]; else { p.hwDone[k] = today(); addXP(10); beep("ok"); floatXP(10, b); }
    checkBadges(); checkHwBonus(); save();
    renderShell("aufgaben", viewAufgaben());
  }));
}

// ===================================================================
// Schreiben
// ===================================================================
function renderSchreiben(auftragId) {
  const f = auftragById(auftragId);
  if (!f) return go("karte");
  const { a, s } = f; const d = S.data;
  const draftKey = `lw:draft:${S.cur}:${a.id}`;
  const checks = d.schreibCheck || [];
  renderShell("texte", (main) => {
    main.innerHTML = `<button class="linkbtn" data-back>‹ Zurück</button>
      <div class="writer">
        <div class="sheet-head" style="margin-top:6px"><div class="big">${esc(s.emoji)}</div><div><h2>${esc(a.titel)}</h2><div class="muted" style="font-weight:700">${esc(s.titel)} · mind. ${a.minWoerter || 0} Wörter</div></div></div>
        <div class="auftrag">${esc(a.auftrag)}</div>
        <textarea placeholder="Hier schreibst du deinen Text …" spellcheck="false" aria-label="Dein Text">${esc(lsGet(draftKey, ""))}</textarea>
        <div class="counters"></div><ul class="hint-list"></ul>
        ${checks.length ? `<h3 style="margin-top:18px">✔️ Checkliste vor dem Abgeben</h3><div class="checklist">${checks.map((c, i) => `<label><input type="checkbox" data-c="${i}"> ${esc(c)}</label>`).join("")}</div>` : ""}
        <button class="btn green block" data-submit>Text abgeben</button>
        <p class="muted" style="font-weight:700;font-size:13px;text-align:center">Dein Entwurf wird automatisch gespeichert.</p>
      </div>`;
    main.querySelector("[data-back]").onclick = () => history.back();
    const ta = main.querySelector("textarea"); const btn = main.querySelector("[data-submit]");
    const update = () => {
      lsSet(draftKey, ta.value);
      const words = (ta.value.match(/\S+/g) || []).length; const min = a.minWoerter || 0;
      const auto = d.autoChecks || ["woerter"]; const counters = []; const hints = [];
      counters.push(`<span class="counter ${words >= min ? "ok" : ""}">📏 ${words} / ${min} Wörter</span>`);
      if (auto.includes("dann")) {
        const saetze = ta.value.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim().replace(/^[„"»]/, "")).filter(Boolean);
        const dann = saetze.filter((x) => /^(und\s+)?dann\b/i.test(x)).length;
        const undDann = (ta.value.match(/\bund dann\b/gi) || []).length;
        counters.push(`<span class="counter ${dann > 1 ? "warn" : dann === 0 && words > 20 ? "ok" : ""}">🚫 Sätze mit „Dann“: ${dann}</span>`);
        if (dann > 1) hints.push("Mehr als ein Satz beginnt mit „Dann“. Probier: Plötzlich … / Kurz darauf … / Im selben Moment … / Zum Glück …");
        if (undDann > 1) hints.push(`„und dann“ kommt ${undDann}× vor. Mach lieber einen Punkt und einen neuen Satzanfang.`);
      }
      main.querySelector(".counters").innerHTML = counters.join("");
      main.querySelector(".hint-list").innerHTML = hints.map((h) => `<li>${esc(h)}</li>`).join("");
      const allChecked = [...main.querySelectorAll("[data-c]")].every((c) => c.checked);
      btn.disabled = words < min || !allChecked;
      btn.textContent = words < min ? `Noch ${min - words} Wörter` : !allChecked ? "Erst Checkliste abhaken" : "Text abgeben";
    };
    ta.oninput = update; main.querySelectorAll("[data-c]").forEach((c) => (c.onchange = update)); update();
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Wird gesendet …";
      try {
        const r = await fetch(`${API}/texts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ student: S.cur, task: a.id, title: a.titel, body: ta.value }) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.status);
        const p = S.prog; const first = !p.textLog.some((t) => t.a === a.id);
        p.textLog.push({ a: a.id, d: today() });
        const distinct = new Set(p.textLog.filter((t) => s.auftraege.some((x) => x.id === t.a)).map((t) => t.a)).size;
        const rec = (p.stations[s.id] ||= { best: 0, stars: 0, rounds: 0 }); rec.stars = Math.max(rec.stars || 0, Math.min(3, distinct)); rec.last = today();
        const xp = first ? 50 : 20; addXP(xp);
        checkBadges(); checkHwBonus(); save(); lsSet(draftKey, ""); S.texts = null; loadTexts();
        confetti(); beep("level");
        modalRoot.innerHTML = `<div class="modal-center"><div class="pop"><span class="emoji">📨</span><h2>Abgegeben!</h2><p>${esc(S.lehrer)} liest deinen Text und schreibt dir eine Rückmeldung. +${xp} XP</p><button class="btn block" data-ok>Super</button></div></div>`;
        modalRoot.querySelector("[data-ok]").onclick = () => { modalRoot.innerHTML = ""; go("texte"); };
      } catch (e) {
        btn.disabled = false; btn.textContent = "Nochmal versuchen";
        toast("Keine Verbindung. Dein Text ist gespeichert – versuch es gleich nochmal.");
      }
    };
  });
}

async function loadTexts() {
  try {
    const j = await getJSON(`${API}/texts?s=${encodeURIComponent(S.cur)}`, { cache: "no-store" });
    S.texts = j.texts || [];
    const navDot = document.querySelector('[data-tab="texte"]');
    if (navDot && unseenFeedback() && !navDot.querySelector(".dot")) navDot.insertAdjacentHTML("beforeend", '<span class="dot"></span>');
    const main = document.querySelector("main.view[data-texte]"); if (main) { main.innerHTML = viewTexte(); wireTexte(main); }
  } catch { S.texts = S.texts || null; }
}
function viewTexte() {
  const schreibSt = stationen().filter((s) => s.typ === "schreiben");
  const list = S.texts;
  setTimeout(() => document.querySelector("main.view")?.setAttribute("data-texte", ""), 0);
  const auftraege = schreibSt.flatMap((s) => s.auftraege.map((a) => ({ a, s, open: isOpen(s) })));
  let html = `<div class="section-title" style="margin-top:4px"><h2>📝 Meine Texte</h2></div>`;
  if (list == null) html += `<div class="empty">Texte werden geladen …</div>`;
  else if (!list.length) html += `<div class="empty"><span class="e">✍️</span>Du hast noch keinen Text abgegeben.</div>`;
  else html += list.map((t) => {
    const isNew = t.feedback && !S.prog.seenFeedback.includes(t.id);
    return `<div class="card textcard"><div class="tt"><b>${esc(t.title || t.task)}</b><span class="muted" style="font-weight:700;font-size:13px">${fmtTs(t.created_at)} · ${t.words} Wörter ${isNew ? '<span class="newtag">NEU</span>' : ""}</span></div>
      <pre>${esc(t.body)}</pre>
      ${t.feedback ? `<div class="feedback"><b>💬 Rückmeldung von ${esc(S.lehrer)}</b>${esc(t.feedback)}</div>` : `<div class="muted" style="font-weight:700;font-size:14px">⏳ Noch keine Rückmeldung</div>`}</div>`;
  }).join("");
  html += `<div class="section-title"><h2>Neuer Text</h2></div><div class="task-list">${auftraege.map(({ a, open }) => `<button class="task" data-a="${esc(a.id)}" ${open ? "" : "disabled"}><span class="ti">📝</span><span class="tx"><b>${esc(a.titel)}</b><small>mind. ${a.minWoerter || 0} Wörter</small></span><span>›</span></button>`).join("")}</div>`;
  return html;
}
function wireTexte(main) {
  main.querySelectorAll("[data-a]").forEach((b) => (b.onclick = () => go("schreiben", b.dataset.a)));
  if (S.texts) {
    const ids = S.texts.filter((t) => t.feedback).map((t) => t.id);
    const neu = ids.filter((id) => !S.prog.seenFeedback.includes(id));
    if (neu.length) { S.prog.seenFeedback.push(...neu); save(); document.querySelector('[data-tab="texte"] .dot')?.remove(); }
  } else loadTexts();
}

// ===================================================================
// Erfolge
// ===================================================================
function viewErfolge() {
  const p = S.prog; const lv = levelInfo(p.xp);
  const all = alleAbzeichen(); const have = all.filter((a) => p.badges[a.id]).length;
  return `<div class="card" style="text-align:center">
      <div style="font-size:64px;line-height:1">${esc(currentAvatar())}</div>
      <h2 style="margin-top:6px">${esc(S.data.name)}</h2>
      <div class="muted" style="font-weight:800">Level ${lv.level} · ${esc(lv.titel)}</div>
      <div class="lvlbar" style="justify-content:center;margin-top:8px"><span class="bar" style="width:200px"><i style="width:${pct(lv.into / lv.need)}%"></i></span> ${lv.into}/${lv.need} XP</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:center;margin-top:12px;flex-wrap:wrap">
      <button class="btn small ghost" data-snd style="text-transform:none">${S.sound ? "🔊 Ton ist an" : "🔇 Ton ist aus"}</button>
      <button class="btn small ghost" data-switch style="text-transform:none">🚪 Schüler wechseln</button>
    </div>
    <div class="section-title"><h2>Avatar wählen</h2><span class="muted">neue Avatare mit höherem Level</span></div>
    <div class="card"><div class="avatars">${(S.data.avatare || []).map((a) => `<button data-av="${esc(a.emoji)}" class="${currentAvatar() === a.emoji ? "on" : ""}" ${lv.level >= a.level ? "" : "disabled"} title="ab Level ${a.level}">${esc(a.emoji)}${lv.level >= a.level ? "" : `<small>Lv ${a.level}</small>`}</button>`).join("")}</div></div>
    <div class="section-title"><h2>🏅 Abzeichen</h2><span class="muted">${have} von ${all.length}</span></div>
    <div class="badges">${all.map((a) => { const d = p.badges[a.id]; return `<div class="badge ${d ? "" : "lock"}"><div class="be">${esc(a.emoji)}</div><b>${esc(a.titel)}</b><small>${esc(a.text)}${d ? `<br>✓ ${fmtDate(d)}` : ""}</small></div>`; }).join("")}</div>`;
}
function wireErfolge(main) {
  main.querySelector("[data-snd]").onclick = () => { S.sound = !S.sound; lsSet("lw:sound", S.sound); renderShell("erfolge", viewErfolge()); };
  main.querySelector("[data-switch]").onclick = () => { location.hash = "#/"; };
  main.querySelectorAll("[data-av]").forEach((b) => (b.onclick = () => { S.prog.avatar = b.dataset.av; save(); beep("tap"); renderShell("erfolge", viewErfolge()); }));
}

// ===================================================================
// Fortschritt
// ===================================================================
function viewFortschritt() {
  const p = S.prog; const lv = levelInfo(p.xp); const st = streakInfo(p);
  const quote = p.totals.answers ? pct(p.totals.correct / p.totals.answers) : 0;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today(), i - 13));
  const max = Math.max(50, ...days.map((d) => p.days[d]?.xp || 0));
  const bars = days.map((d) => { const v = p.days[d]?.xp || 0; return `<div class="b"><em>${v || ""}</em><i class="${v ? "" : "zero"}" style="height:${v ? Math.max(4, (v / max) * 100) : 3}%"></i><span>${new Date(d + "T12:00:00").toLocaleDateString("de-DE", { weekday: "narrow" })}</span></div>`; }).join("");
  const rows = stationen().filter((s) => s.typ !== "schreiben").map((s) => {
    const r = p.stations[s.id] || {};
    return `<div class="st-row"><span class="e">${esc(s.emoji)}</span><div class="n"><b>${esc(s.titel)}</b><div class="meter"><i style="width:${pct(r.best || 0)}%"></i></div></div><div style="text-align:right"><div class="stars">${starsHtml(r.stars || 0)}</div><small class="muted" style="font-weight:800">${r.rounds ? `${pct(r.best)} % · ${r.rounds}×` : isOpen(s) ? "noch offen" : `ab ${fmtDate(s.oeffnetAm)}`}</small></div></div>`;
  }).join("");
  const goals = (S.data.ziele || []).map((g) => { const r = p.stations[g.station] || {}; return `<div class="goal">🎯 ${esc(g.text)}<span class="gs stars">${starsHtml(r.stars || 0)}</span></div>`; }).join("");
  return `<div class="tiles">
      <div class="tile"><div class="tl">Level</div><div class="tv">${lv.level}</div><div class="ts">${esc(lv.titel)}</div></div>
      <div class="tile"><div class="tl">XP gesamt</div><div class="tv">${p.xp}</div><div class="ts">noch ${lv.need - lv.into} bis Level ${lv.level + 1}</div></div>
      <div class="tile"><div class="tl">Serie</div><div class="tv">🔥 ${st.n}</div><div class="ts">Rekord: ${p.bestStreak || 0} ${(p.bestStreak || 0) === 1 ? "Tag" : "Tage"}</div></div>
      <div class="tile"><div class="tl">Trefferquote</div><div class="tv">${quote} %</div><div class="ts">${p.totals.correct} von ${p.totals.answers} Antworten</div></div>
    </div>
    <div class="section-title"><h2>Die letzten 14 Tage</h2><span class="muted">XP pro Tag</span></div>
    <div class="card"><div class="bars">${bars}</div></div>
    <div class="section-title"><h2>Deine Ziele bis Ende Januar</h2></div>
    <div class="card">${goals || '<span class="muted">Keine Ziele eingetragen.</span>'}</div>
    <div class="section-title"><h2>Stationen</h2><span class="muted">bestes Ergebnis</span></div>
    <div class="card">${rows}</div>`;
}

// ===================================================================
// Lehrer-Bereich
// ===================================================================
async function renderLehrer() {
  applyTheme({ farbe: "#23263a", farbe2: "#13b5a5" });
  document.title = "Lehrer · Lernwelt";
  const key = lsGet("lw:teacher", "");
  const shell = (inner) => `<div class="shell teacher"><header class="topbar"><b class="display" style="font-size:19px;flex:1">👨‍🏫 Lehrer-Bereich</b><a href="#/" class="btn small ghost" style="text-transform:none">Zur Startseite</a>${key ? '<button class="btn small ghost" data-logout style="text-transform:none">Abmelden</button>' : ""}</header><main class="view">${inner}</main></div>`;
  if (!key) {
    app.innerHTML = shell(`<div class="card login-box"><h2>Anmelden</h2><p class="muted" style="font-weight:700">Gib den Lehrer-Schlüssel ein, den du in Cloudflare als <code>TEACHER_KEY</code> gespeichert hast.</p>
      <input class="inp" type="password" placeholder="Lehrer-Schlüssel" data-key><div style="height:12px"></div><button class="btn block" data-login>Anmelden</button></div>`);
    const inp = app.querySelector("[data-key]");
    const doLogin = () => { const v = inp.value.trim(); if (!v) return inp.focus(); lsSet("lw:teacher", v); renderLehrer(); };
    setTimeout(() => inp.focus(), 50);
    app.querySelector("[data-login]").onclick = doLogin; inp.onkeydown = (e) => { if (e.key === "Enter") doLogin(); };
    return;
  }
  app.innerHTML = shell(`<div class="empty">Lade Daten …</div>`);
  app.querySelector("[data-logout]").onclick = () => { localStorage.removeItem("lw:teacher"); renderLehrer(); };
  let ov;
  try {
    const r = await fetch(`${API}/teacher/overview`, { headers: { "x-teacher-key": key }, cache: "no-store" });
    const j = await r.json();
    if (r.status === 401) { localStorage.removeItem("lw:teacher"); toast("Falscher Schlüssel"); return renderLehrer(); }
    if (!r.ok) throw new Error(j.error || r.status);
    ov = j;
  } catch (e) {
    // Gespeicherten Schlüssel verwerfen, damit das Eingabefeld wieder erscheint
    localStorage.removeItem("lw:teacher");
    app.querySelector("main").innerHTML = `<div class="card login-box"><h2>Anmeldung hat nicht geklappt</h2><p class="muted" style="font-weight:700">${esc(e.message)}</p><button class="btn block" data-retry>Schlüssel neu eingeben</button></div>`;
    app.querySelector("[data-retry]").onclick = () => renderLehrer();
    return;
  }
  const hwAll = await getJSON("data/hausaufgaben.json", { cache: "no-store" }).catch(() => ({}));
  const sections = [];
  for (const s of S.schueler) {
    const data = await getJSON(`data/${s.id}.json`).catch(() => null); if (!data) continue;
    const entry = ov.progress.find((x) => x.student === s.id);
    const p = Object.assign(freshProgress(), entry?.progress?.reset ? {} : entry?.progress || {});
    // Kontext kurz umschalten, damit die Hilfsfunktionen die richtigen Daten sehen
    const saved = { data: S.data, hw: S.hw }; S.data = data; S.hw = hwAll[s.id] || [];
    const lv = levelInfo(p.xp); const st = streakInfo(p);
    const lastDay = Object.keys(p.days).sort().pop();
    const weeks = [...S.hw].sort((a, b) => (b.start || "").localeCompare(a.start || "")).slice(0, 4);
    const hwRows = weeks.map((w) => { const hs = hwStatus(w, p); return `<tr><td><b>${esc(w.titel)}</b><br><small class="muted">${fmtDate(w.start)}–${fmtDate(w.faellig)}</small></td><td>${hs.items.map((it) => `<span class="tag ${it.done ? "g" : "r"}">${it.done ? "✓" : "✗"} ${esc(it.art === "station" ? `${it.st?.titel || it.station} ${it.have}/${it.need}` : it.art === "schreiben" ? `Text ${it.f?.a.titel || it.auftrag}` : it.text)}</span>`).join(" ")}</td><td>${hs.doneCount}/${hs.total}${p.hwBonus[w.id]?.puenktlich ? " ⏰" : ""}</td></tr>`; }).join("");
    const stRows = data.stationen.map((x) => { const r = p.stations[x.id] || {}; const recent = p.rounds.filter((q) => q.s === x.id).slice(-3).map((q) => pct(q.score) + "%").join(", "); return `<tr><td>${esc(x.emoji)} ${esc(x.titel)}</td><td class="stars">${starsHtml(r.stars || 0)}</td><td>${r.best != null && x.typ !== "schreiben" ? pct(r.best) + " %" : "–"}</td><td>${r.rounds || 0}</td><td><small>${recent || ""}</small></td></tr>`; }).join("");
    const wrong = ov.wrong.filter((w) => w.student === s.id).slice(0, 12);
    const wrongRows = wrong.map((w) => `<tr><td><small>${esc(stationById(w.station)?.emoji || "")}</small> ${esc(w.prompt || w.exercise)}</td><td><b>${esc(w.solution || "")}</b></td><td><span class="tag r">${w.misses}/${w.tries}</span></td></tr>`).join("");
    const recent = ov.recentWrong.filter((w) => w.student === s.id).slice(0, 10);
    const recentRows = recent.map((w) => `<tr><td><small class="muted">${fmtTs(w.created_at)}</small><br>${esc(w.prompt || "")}</td><td><span style="color:#a8242a;font-weight:800">${esc(w.answer || "")}</span></td><td><b>${esc(w.solution || "")}</b></td></tr>`).join("");
    const texts = ov.texts.filter((t) => t.student === s.id);
    const textHtml = texts.map((t) => `<div class="card textcard fbbox" style="box-shadow:none;border:2px solid var(--line)"><div class="tt"><b>${esc(t.title || t.task)}</b><span class="muted" style="font-weight:700;font-size:13px">${fmtTs(t.created_at)} · ${t.words} Wörter</span></div><pre>${esc(t.body)}</pre>
      <textarea data-fb="${t.id}" placeholder="Rückmeldung an ${esc(s.name)} …">${esc(t.feedback || "")}</textarea><div style="display:flex;gap:8px;align-items:center;margin-top:8px"><button class="btn small alt" data-save="${t.id}">Rückmeldung speichern</button>${t.feedback_at ? `<small class="muted">gespeichert ${fmtTs(t.feedback_at)}</small>` : ""}</div></div>`).join("");
    S.data = saved.data; S.hw = saved.hw;
    sections.push(`<section class="card" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div style="font-size:42px">${esc(p.avatar || s.avatar)}</div><div style="flex:1"><h2>${esc(s.name)} <small class="muted" style="font-size:15px">${esc(s.klasse || "")}</small></h2>
        <div class="muted" style="font-weight:800">Level ${lv.level} · ${p.xp} XP · 🔥 ${st.n} (Rekord ${p.bestStreak || 0}) · Trefferquote ${p.totals.answers ? pct(p.totals.correct / p.totals.answers) : 0} % · zuletzt aktiv: ${lastDay ? fmtDateLong(lastDay) : "noch nie"}</div></div>
        <a class="btn small ghost" style="text-transform:none" href="#/s/${esc(s.id)}/karte">Als ${esc(s.name)} ansehen</a></div>
      <div class="tgrid two" style="margin-top:14px">
        <div><h3>📬 Hausaufgaben</h3><table class="t"><tr><th>Woche</th><th>Aufgaben</th><th>Stand</th></tr>${hwRows || '<tr><td colspan="3" class="muted">keine</td></tr>'}</table></div>
        <div><h3>🗺️ Stationen</h3><table class="t"><tr><th>Station</th><th>Sterne</th><th>Best</th><th>Runden</th><th>Letzte</th></tr>${stRows}</table></div>
        <div><h3>🔁 Häufigste Fehler (60 Tage)</h3><table class="t"><tr><th>Aufgabe</th><th>Lösung</th><th>Fehler</th></tr>${wrongRows || '<tr><td colspan="3" class="muted">noch keine</td></tr>'}</table></div>
        <div><h3>🕒 Letzte falsche Antworten</h3><table class="t"><tr><th>Aufgabe</th><th>Antwort</th><th>Richtig</th></tr>${recentRows || '<tr><td colspan="3" class="muted">noch keine</td></tr>'}</table></div>
      </div>
      <h3 style="margin-top:16px">📝 Texte</h3>${textHtml || '<p class="muted">Noch keine Texte abgegeben.</p>'}
      <div style="margin-top:14px;text-align:right"><button class="linkbtn" style="color:var(--bad)" data-reset="${esc(s.id)}">Fortschritt von ${esc(s.name)} zurücksetzen</button></div>
    </section>`);
  }
  app.querySelector("main").innerHTML = `<p class="muted" style="font-weight:700">Stand: ${fmtTs(Date.now())} · <button class="linkbtn" data-reload>aktualisieren</button></p>${sections.join("")}`;
  app.querySelector("[data-reload]").onclick = () => renderLehrer();
  app.querySelectorAll("[data-save]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.save; const txt = app.querySelector(`[data-fb="${id}"]`).value;
    b.disabled = true;
    const r = await fetch(`${API}/teacher/feedback`, { method: "POST", headers: { "content-type": "application/json", "x-teacher-key": key }, body: JSON.stringify({ id: +id, feedback: txt }) }).catch(() => null);
    b.disabled = false; toast(r?.ok ? "Rückmeldung gespeichert ✓" : "Speichern fehlgeschlagen");
  }));
  app.querySelectorAll("[data-reset]").forEach((b) => (b.onclick = async () => {
    const id = b.dataset.reset;
    if (!confirm(`Wirklich ALLE Fortschritte von ${id} löschen (XP, Sterne, Abzeichen, Fehlerliste)? Texte bleiben erhalten.`)) return;
    const r = await fetch(`${API}/teacher/reset`, { method: "POST", headers: { "content-type": "application/json", "x-teacher-key": key }, body: JSON.stringify({ student: id }) }).catch(() => null);
    if (r?.ok) { localStorage.removeItem(lsKey(id)); localStorage.removeItem(`lw:q:${id}`); if (S.cur === id) S.cur = null; toast("Zurückgesetzt"); renderLehrer(); } else toast("Fehlgeschlagen");
  }));
}

route();
