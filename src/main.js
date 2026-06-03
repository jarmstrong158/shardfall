// Bootstrap: canvas scaling, loop, input, shop wiring, tier-up + prestige.

import { WORLD, TIERS, UPGRADES, upgradeCost, isMaxed, isUnlocked, canTierUp,
  newState, load, save, wipe } from "./state.js";
import { Sim } from "./sim.js";
import { Renderer } from "./render.js";
import * as ui from "./ui.js";
import * as audio from "./audio.js";
import { fmt } from "./util.js";

const { W, H, GROUND, PILE_L, PILE_R, STASH_X } = WORLD;
const HOUSE_COOLDOWN = 3.5; // seconds for a housed mote to arrive

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

let state = load() || newState();
// ?demo — seed a full roster for screenshots / visual checks
if (location.search.includes("demo")) {
  state.started = true; state.shards = 5e5; state.idle = 30; state.tier = 2;
  state.roles = { slammer: 6, runner: 5, mountaineer: 2, slinger: 3, tosser: 3, bomber: 2 };
  state.levels.reach = 3; state.levels.express = 2; state.levels.slamclub = 2;
}
let sim = new Sim(state);
let renderer = new Renderer(ctx);
let scale = 1;
let running = false;
let awaitingAscend = false;

function resize() {
  const vw = window.innerWidth, vh = window.innerHeight;
  scale = Math.max(1, Math.floor(Math.min(vw / W, vh / H) * 100) / 100);
  const cw = W * scale, ch = H * scale;
  canvas.width = W; canvas.height = H;
  canvas.style.width = cw + "px"; canvas.style.height = ch + "px";
  canvas.style.left = ((vw - cw) / 2) + "px"; canvas.style.top = ((vh - ch) / 2) + "px";
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener("resize", resize); resize();

// ---------- buying ----------
function buy(id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || !isUnlocked(u, state) || isMaxed(u, state)) return;
  audio.resume();

  if (u.kind === "tier") {
    if (!canTierUp(state)) { ui.toast("dig the rock deeper first"); return; }
    state.tier++;
    audio.sfx.layer();
    ui.toast(`Cracked into ${TIERS[state.tier].name}!`);
    if (state.tier >= TIERS.length - 1) { awaitingAscend = true; showWin(); }
    ui.updateShop(state); save(state); return;
  }

  const cost = upgradeCost(u, state);
  if (state.shards < cost) { ui.toast("not enough shards"); return; }

  if (u.kind === "housing") {
    state.shards -= cost; state.levels.housing++;
    state.queue.push(HOUSE_COOLDOWN);
    ui.toast("housing built — a mote is on the way");
  } else if (u.kind === "assign") {
    if (state.idle < 1) { ui.toast("no idle motes — build housing"); return; }
    state.shards -= cost; state.idle--; state.roles[id]++;
    sim.sync();
  } else { // stat
    state.shards -= cost; state.levels[id]++;
  }
  audio.sfx.buy();
  ui.updateShop(state); save(state);
}

// ---------- pointer: slam the rock, or shove the pile ----------
function worldFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}
let dragging = false;
canvas.addEventListener("pointerdown", (e) => { if (running) { dragging = true; pointerAct(e); } });
canvas.addEventListener("pointermove", (e) => { if (running && dragging) pointerAct(e); });
window.addEventListener("pointerup", () => { dragging = false; });

function pointerAct(e) {
  audio.resume();
  const p = worldFromEvent(e);
  if (p.y > GROUND - 60 || p.y < GROUND) {
    if (p.x < PILE_L) sim.manualSlam();              // rock zone
    else if (p.x <= PILE_R + 20) sim.manualCollect(p.x); // pile zone -> shove toward stash
  }
}

// ---------- keyboard ----------
window.addEventListener("keydown", (e) => {
  if (!running) return;
  const u = UPGRADES.find((x) => x.key === e.key);
  if (u) { buy(u.id); e.preventDefault(); }
  if (e.key === "m" || e.key === "M") toggleMute();
});

// ---------- win / prestige ----------
function showWin() {
  audio.sfx.ascend();
  const first = !state.completed;
  document.getElementById("winTitle").textContent = first ? "YOU CRACKED THE CORE" : "THE MOTES ASCEND";
  document.getElementById("winBody").innerHTML =
    `${first
      ? "The rock is split to its <b>Core</b>. The motes stand atop an obscene hoard of shards."
      : "Another rock spent. The motes pile their wealth and seek a richer seam."}
     <br><br>Lifetime shards: <b>${fmt(state.lifetime)}</b> · Ascensions: <b>${state.ascensions}</b>
     <br><br>Ascend for a permanent <b>x2.5</b> power bonus and a faster new cycle.`;
  document.getElementById("ascendBtn").textContent = first ? "ASCEND  ✦" : "ASCEND AGAIN  ✦";
  show("winscreen");
}
function ascend() {
  state.resonance *= 2.5; state.ascensions++; state.completed = true;
  state.shards = 0; state.produced = 0; state.tier = 0; state.idle = 2; state.queue = [];
  state.roles = { slammer: 0, runner: 0, mountaineer: 0, slinger: 0, tosser: 0, bomber: 0 };
  for (const k in state.levels) state.levels[k] = 0;
  awaitingAscend = false;
  sim = new Sim(state);
  ui.buildShop(state, buy);
  hide("winscreen"); save(state);
  ui.toast("a new cycle — power x" + fmt(state.resonance));
}

// ---------- screens ----------
const show = (id) => document.getElementById(id).classList.remove("hidden");
const hide = (id) => document.getElementById(id).classList.add("hidden");

function startGame() {
  state.started = true; running = true;
  hide("title");
  document.getElementById("hud").classList.remove("hidden");
  ui.buildShop(state, buy); ui.updateShop(state);
  audio.resume(); audio.setMuted(state.muted);
  save(state);
}
function toggleMute() {
  state.muted = !state.muted; audio.setMuted(state.muted);
  document.getElementById("muteBtn").textContent = state.muted ? "🔇" : "♪"; save(state);
}

document.getElementById("startBtn").addEventListener("click", startGame);
document.getElementById("ascendBtn").addEventListener("click", ascend);
document.getElementById("muteBtn").addEventListener("click", toggleMute);
document.getElementById("resetBtn").addEventListener("click", () => {
  if (confirm("Erase your saved game?")) { wipe(); state = newState(); sim = new Sim(state); ui.toast("save erased"); }
});
document.getElementById("muteBtn").textContent = state.muted ? "🔇" : "♪";

// ---------- loop ----------
let last = performance.now(), acc = 0, saveAcc = 0;
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;
  if (running) {
    sim.update(dt);
    saveAcc += dt; if (saveAcc > 5) { save(state); saveAcc = 0; }
  }
  renderer.draw(sim);
  acc += dt;
  if (acc > 0.1 && running) { ui.updateHUD(sim); ui.updateShop(state); acc = 0; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if (state.started) startGame();
window.__shardfall = { get state() { return state; }, get sim() { return sim; } };
