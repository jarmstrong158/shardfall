// The living world. Slammers damage the rock -> shards fall into the pile
// (a height-field) at a distance set by range. The pile leaks back to the rock
// (reclamation) when tall. Runners haul pile shards into the stash (currency).
// Mountaineers stomp the pile flatter to cut reclamation.

import { WORLD, TIERS, SHARD_COLORS, rangeStat, haulCap, shardsPerHit,
  damageMult, collectMult, shardValue, reachRadius, reachRate,
  reclaimCoef } from "./state.js";
import { sfx } from "./audio.js";
import { clamp, rand, randInt, pick, hash01, TAU } from "./util.js";

const { W, GROUND, ROCK_X, STASH_X, PILE_L, PILE_R, BINS } = WORLD;
const BINW = (PILE_R - PILE_L) / BINS;
const SHARD_CAP = 260;           // max visual flying shards
let GID = 1;

const binCenter = (i) => PILE_L + (i + 0.5) * BINW;
const xToBin = (x) => clamp(Math.floor((x - PILE_L) / BINW), 0, BINS - 1);
export const heightPx = (count) => Math.min(330, Math.sqrt(Math.max(0, count)) * 2.4);

class Mote {
  constructor(role) {
    this.id = GID++;
    this.role = role;
    this.h = hash01(this.id);
    this.lane = this.h - 0.5;             // personal offset so they don't stack
    // spread the initial position across the role's work zone (anti-overlap)
    this.x = role === "slammer" ? rand(ROCK_X + 10, ROCK_X + 90)
           : role === "slinger" ? rand(150, 280)
           : role === "bomber" ? rand(200, 360)
           : role === "runner" ? rand(STASH_X - 120, STASH_X - 10)
           : role === "tosser" ? rand(PILE_L + 40, PILE_R - 40)
           : rand(PILE_L + 20, PILE_R - 20);          // mountaineer
    this.y = GROUND;
    this.dir = (role === "slammer" || role === "slinger") ? -1 : 1;
    this.step = rand(0, TAU);
    this.state = "idle";
    this.timer = rand(0, 1.4);            // stagger cadences so they don't act in lockstep
    this.carry = 0;
    this.target = 0;
  }
}

export class Sim {
  constructor(state) {
    this.state = state;
    this.motes = [];
    this.pile = new Float64Array(BINS);
    this.pileColor = new Array(BINS).fill("#ff7a3e");
    this.shards = [];        // flying visuals
    this.particles = [];
    this.floats = [];
    this.time = 0;
    this.shake = 0;
    this.stashFlash = 0;
    this.dmgRate = 0; this.collRate = 0; this.reclRate = 0;
    this._dW = 0; this._cW = 0; this._rW = 0; this._wt = 0;
    this.onTier = null;
    this.sync();
  }

  sync() {
    for (const role of ["slammer", "runner", "mountaineer", "slinger", "tosser", "bomber"]) {
      const want = this.state.roles[role];
      const have = this.motes.filter((g) => g.role === role).length;
      for (let i = have; i < want; i++) this.motes.push(new Mote(role));
      if (have > want) {
        let cut = have - want;
        this.motes = this.motes.filter((g) =>
          g.role === role && cut-- > 0 ? false : true);
      }
    }
  }

  pileTotal() { let t = 0; for (let i = 0; i < BINS; i++) t += this.pile[i]; return t; }
  pilePeak() { let m = 0; for (let i = 0; i < BINS; i++) if (this.pile[i] > m) m = this.pile[i]; return m; }
  surfaceY(x) { return GROUND - heightPx(this.pile[xToBin(x)]); }

  // ---------- production ----------
  slam(g) {
    const s = this.state;
    const n = Math.max(1, Math.round(shardsPerHit(s) * damageMult(s)));
    const r = rangeStat(s);
    const frac = clamp(0.24 + r * 0.05, 0.1, 0.78);   // higher range -> nearer the stash (never reaches it)
    const bin = clamp(Math.round(frac * (BINS - 1) + rand(-4, 4)), 0, BINS - 1);
    const col = pick(SHARD_COLORS);
    this.pile[bin] += n;
    this.pileColor[bin] = col;
    s.produced += n;
    this._dW += n;
    // a few cosmetic flying shards arcing to that bin
    if (this.shards.length < SHARD_CAP) {
      for (let i = 0; i < 3; i++)
        this.shards.push({ x: ROCK_X + rand(0, 8), y: GROUND - rand(8, 26),
          tx: binCenter(bin) + rand(-6, 6), color: col, t: 0,
          dur: rand(0.35, 0.6), arc: rand(40, 90), kind: "fall", spin: rand(0, TAU) });
    }
    this.dust(ROCK_X + 4, g.y - 8, 3, col);
    this.shake = Math.min(this.shake + 0.4, 3);
    sfx.mine();
  }

  // ---------- collection ----------
  bankShards(units, atX) {
    const s = this.state;
    const v = units * shardValue(s);
    s.shards += v; s.lifetime += v;
    this._cW += units;
    this.stashFlash = 1;
    if (Math.random() < 0.4) this.float(STASH_X + rand(-8, 8), GROUND - rand(10, 28), "+" + fmtMini(v));
    this.dust(STASH_X + rand(-4, 4), GROUND - 6, 2, "#ffd84a");
  }

  rightmostPileBin() {
    for (let i = BINS - 1; i >= 0; i--) if (this.pile[i] > 0.5) return i;
    return -1;
  }
  tallestBin() {
    let m = -1, mv = 0;
    for (let i = 0; i < BINS; i++) if (this.pile[i] > mv) { mv = this.pile[i]; m = i; }
    return m;
  }

  // player clicks/drags the pile to scoop a hand-load toward the stash —
  // roughly what one runner hauls, not the whole pile
  manualCollect(x) {
    const bin = xToBin(x);
    const cap = haulCap(this.state) + 2;
    let grabbed = 0;
    for (let i = bin; i <= bin + 1 && grabbed < cap; i++) {
      if (i < 0 || i >= BINS) continue;
      const take = Math.min(this.pile[i], cap - grabbed);
      this.pile[i] -= take; grabbed += take;
    }
    if (grabbed > 0.01) { this.bankShards(grabbed, x); sfx.deposit(); }
  }

  manualSlam() {
    const s = this.state;
    const n = Math.max(2, Math.round(shardsPerHit(s) * damageMult(s) * 2));
    const r = rangeStat(s);
    const bin = clamp(Math.round(clamp(0.24 + r * 0.05, 0.1, 0.78) * (BINS - 1)), 0, BINS - 1);
    this.pile[bin] += n; s.produced += n; this._dW += n;
    this.pileColor[bin] = pick(SHARD_COLORS);
    this.shake = Math.min(this.shake + 1.2, 4);
    for (let i = 0; i < 6; i++)
      this.particles.push({ x: ROCK_X + rand(-2, 14), y: GROUND - rand(4, 30),
        vx: rand(-30, 120), vy: rand(-120, -30), life: rand(0.3, 0.6), t: 0,
        color: pick(SHARD_COLORS), size: randInt(1, 2) });
    sfx.mine();
  }

  // ---------- helpers ----------
  dust(x, y, n, color) {
    for (let i = 0; i < n; i++)
      this.particles.push({ x, y, vx: rand(-26, 26), vy: rand(-44, -8),
        life: rand(0.25, 0.55), t: 0, color, size: 1 });
  }
  float(x, y, text) { this.floats.push({ x, y, text, t: 0, life: 1.1 }); }

  checkTier() { /* tier-up is a manual shop action; handled in main */ }

  // ---------- main update ----------
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    this.shake *= Math.pow(0.0001, dt);
    this.stashFlash = Math.max(0, this.stashFlash - dt * 3);
    const s = this.state;

    // housing cooldowns deliver motes to the idle pool
    if (s.queue.length) {
      for (let i = s.queue.length - 1; i >= 0; i--) {
        s.queue[i] -= dt;
        if (s.queue[i] <= 0) { s.queue.splice(i, 1); s.idle += 1; }
      }
    }

    // motes
    for (const g of this.motes) {
      if (g.role === "slammer") this.updateSlammer(g, dt);
      else if (g.role === "runner") this.updateRunner(g, dt);
      else if (g.role === "mountaineer") this.updateMountaineer(g, dt);
      else if (g.role === "slinger") this.updateSlinger(g, dt);
      else if (g.role === "tosser") this.updateTosser(g, dt);
      else this.updateBomber(g, dt);
    }

    // reclamation: the rock claws shards back HARDEST near itself and barely at
    // all near the stash. So shards close to the rock (low range) are at risk;
    // pushing them rightward (range/slingers) or collecting fast keeps them.
    const coef = reclaimCoef(s);
    if (coef > 0) {
      for (let i = 0; i < BINS; i++) {
        const c = this.pile[i];
        if (c <= 0) continue;
        const prox = 1 - (i / (BINS - 1)) * 0.88;   // 1.0 at rock -> 0.12 at stash
        // leak a FRACTION of the column per second, scaled by how TALL it is
        // (normalised 0..1 so it can't explode at high tiers). Short/far piles barely leak.
        const tall = Math.pow(heightPx(c) / 330, 1.3);
        let leak = c * coef * prox * tall * dt;
        if (leak > c) leak = c;
        this.pile[i] -= leak;
        this._rW += leak;
        if (Math.random() < leak * 0.015 && this.shards.length < SHARD_CAP)
          this.shards.push({ x: binCenter(i), y: this.surfaceY(binCenter(i)),
            tx: ROCK_X, color: "#7a6a8c", t: 0, dur: rand(0.4, 0.7), arc: 40,
            kind: "reclaim", spin: 0 });
      }
    }

    // shards settle: only STEEP slopes slump (gentle), so piles still grow tall
    // and peaky — leaving real work for mountaineers to flatten and cut reclaim
    for (let i = 0; i < BINS - 1; i++) {
      const diff = this.pile[i] - this.pile[i + 1];
      if (Math.abs(diff) < 60) continue;
      const flow = diff * 0.35 * dt;
      this.pile[i] -= flow; this.pile[i + 1] += flow;
    }

    // Stash Reach: the stash auto-pulls shards sitting within its radius
    const rad = reachRadius(s);
    if (rad > 0) {
      const rate = reachRate(s);
      for (let i = BINS - 1; i >= 0; i--) {
        if (this.pile[i] <= 0) continue;
        if (STASH_X - binCenter(i) > rad) break;     // bins are left-to-right; stop once out of range
        const pull = Math.min(this.pile[i], this.pile[i] * rate * dt + 0.5);
        this.pile[i] -= pull;
        this.bankShards(pull, binCenter(i));
      }
    }

    // flying shard visuals (lerp along an arc to target x)
    for (const sh of this.shards) {
      sh.t += dt;
      sh.spin += dt * 8;
    }
    this.shards = this.shards.filter((sh) => sh.t < sh.dur);

    for (const p of this.particles) { p.t += dt; p.vy += 120 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.particles = this.particles.filter((p) => p.t < p.life);
    for (const f of this.floats) { f.t += dt; f.y -= 16 * dt; }
    this.floats = this.floats.filter((f) => f.t < f.life);

    // rate readouts (per 0.5s window)
    this._wt += dt;
    if (this._wt >= 0.5) {
      this.dmgRate = this.dmgRate * 0.5 + (this._dW / this._wt) * 0.5;
      this.collRate = this.collRate * 0.5 + (this._cW / this._wt) * 0.5;
      this.reclRate = this.reclRate * 0.5 + (this._rW / this._wt) * 0.5;
      this._dW = this._cW = this._rW = 0; this._wt = 0;
    }
  }

  walk(g, tx, dt, speed) {
    const dx = tx - g.x;
    const step = speed * dt;
    if (Math.abs(dx) <= step) { g.x = tx; return true; }
    g.x += Math.sign(dx) * step;
    g.dir = dx < 0 ? -1 : 1;
    g.step += step * 0.5;
    return false;
  }

  updateSlammer(g, dt) {
    // spread along a wide strip at the rock base so they don't stack
    const home = ROCK_X + 12 + g.h * 78;
    if (this.walk(g, home, dt, 60)) {
      g.timer -= dt;
      g.step += dt * 5;
      if (g.timer <= 0) { this.slam(g); g.timer = 0.9 * (0.8 + g.h * 0.4); }
    }
  }

  // ranged damage: shoots the rock; its shards land high-range (right by the stash)
  updateSlinger(g, dt) {
    const s = this.state;
    const home = 120 + g.h * 110;
    g.dir = -1;
    if (this.walk(g, home, dt, 55)) {
      g.timer -= dt; g.step += dt * 2;
      if (g.timer <= 0) {
        g.timer = 1.3 * (0.8 + g.h * 0.4);
        const n = Math.max(1, Math.round(shardsPerHit(s) * damageMult(s)));
        const bin = clamp(Math.round(0.9 * (BINS - 1) + rand(-2, 2)), 0, BINS - 1); // near stash
        const col = pick(SHARD_COLORS);
        this.pile[bin] += n; this.pileColor[bin] = col;
        s.produced += n; this._dW += n;
        if (this.shards.length < SHARD_CAP) {
          this.shards.push({ x: ROCK_X + 4, y: GROUND - 18, tx: binCenter(bin),
            color: col, t: 0, dur: rand(0.4, 0.6), arc: rand(60, 110), kind: "fall", spin: 0 });
          this.shards.push({ x: g.x, y: GROUND - 8, tx: ROCK_X, color: "#cfe0ff",
            t: 0, dur: 0.18, arc: 6, kind: "fall", spin: 0 }); // arrow streak
        }
      }
    }
  }

  // telekinetic collection: lobs pile shards across the gap into the stash
  updateTosser(g, dt) {
    const s = this.state;
    const home = PILE_L + 60 + g.h * (PILE_R - PILE_L - 120);
    this.walk(g, home, dt, 55); g.step += dt * 1.2;
    g.timer -= dt;
    if (g.timer <= 0) {
      g.timer = 0.7 * (0.85 + g.h * 0.3);
      // grab from the nearest non-empty bin
      const here = xToBin(g.x);
      let bin = -1, best = 1e9;
      for (let i = 0; i < BINS; i++) {
        if (this.pile[i] <= 0.5) continue;
        const d = Math.abs(i - here);
        if (d < best) { best = d; bin = i; }
      }
      if (bin < 0) return;
      const take = Math.min((haulCap(s) * 0.7 + 1) * collectMult(s), this.pile[bin]);
      this.pile[bin] -= take;
      this.bankShards(take, STASH_X);
      if (this.shards.length < SHARD_CAP)
        this.shards.push({ x: binCenter(bin), y: this.surfaceY(binCenter(bin)) - 4,
          tx: STASH_X, color: this.pileColor[bin], t: 0, dur: rand(0.35, 0.55), arc: rand(50, 90), kind: "fall", spin: rand(0, TAU) });
    }
  }

  updateRunner(g, dt) {
    const s = this.state;
    const speed = (155 + s.levels.haul * 8) * (1 + 0.12 * s.levels.express);
    if (g.state === "idle" || g.state === "toPile") {
      if (g.carry > 0) { g.state = "toStash"; return; }
      const bin = this.rightmostPileBin();   // clear stash-side first (range matters)
      if (bin < 0) { // nothing to haul; wait in a spread-out line near the stash
        this.walk(g, STASH_X - 16 - g.h * 50, dt, speed); g.step += dt * 1.5; return;
      }
      g.target = bin; g.state = "toPile";
      const tx = binCenter(bin) + g.lane * 12;   // personal lane so they don't stack
      if (this.walk(g, tx, dt, speed)) {
        const take = Math.min(haulCap(s) * collectMult(s), this.pile[bin]);
        this.pile[bin] -= take; g.carry = take;
        g.state = "toStash";
      }
    } else if (g.state === "toStash") {
      if (this.walk(g, STASH_X - 8 - g.h * 10, dt, speed)) {
        if (g.carry > 0) this.bankShards(g.carry, STASH_X);
        g.carry = 0; g.state = "idle";
      }
    }
  }

  updateMountaineer(g, dt) {
    // walk to the tallest bin and shove its shards onto the neighbours
    const bin = this.tallestBin();
    if (bin < 0 || this.pile[bin] < 4) { this.walk(g, binCenter(BINS >> 1) + g.lane * 50, dt, 55); g.step += dt * 1.2; g.y = this.surfaceY(g.x); return; }
    const tx = binCenter(bin) + g.lane * 12;
    g.y = this.surfaceY(g.x);
    if (this.walk(g, tx, dt, 65)) {
      g.timer -= dt; g.step += dt * 7;
      if (g.timer <= 0) {
        g.timer = 0.25;
        const move = this.pile[bin] * 0.34;
        this.pile[bin] -= move;
        const l = Math.max(0, bin - 1), r = Math.min(BINS - 1, bin + 1);
        this.pile[l] += move * 0.5; this.pile[r] += move * 0.5;
        this.dust(tx, this.surfaceY(tx) - 2, 3, "#ffffff");
        this.shake = Math.min(this.shake + 0.3, 2);
      }
    }
  }

  // burst damage: lobs a bomb that explodes and sprays many shards across a wide
  // arc of bins — lots of shards fast, but scattered (some land in the rock's reach)
  updateBomber(g, dt) {
    const s = this.state;
    const home = 200 + g.h * 160;
    this.walk(g, home, dt, 50); g.step += dt * 1.5;
    g.timer -= dt;
    if (g.timer <= 0) {
      g.timer = 2.6 * (0.85 + g.h * 0.3);
      const burst = Math.max(4, Math.round(shardsPerHit(s) * damageMult(s) * 5));
      const lo = clamp(Math.round(0.2 * (BINS - 1)), 0, BINS - 1);
      const hi = clamp(Math.round(0.85 * (BINS - 1)), 0, BINS - 1);
      const per = Math.ceil(burst / 9);
      for (let k = 0; k < 9; k++) {
        const bin = clamp(lo + Math.round(rand(0, hi - lo)), 0, BINS - 1);
        this.pile[bin] += per; this.pileColor[bin] = pick(SHARD_COLORS);
        if (this.shards.length < SHARD_CAP)
          this.shards.push({ x: g.x, y: GROUND - 26, tx: binCenter(bin),
            color: pick(SHARD_COLORS), t: 0, dur: rand(0.4, 0.7), arc: rand(80, 150), kind: "fall", spin: rand(0, TAU) });
      }
      s.produced += burst; this._dW += burst;
      // explosion puff
      for (let k = 0; k < 10; k++)
        this.particles.push({ x: g.x + rand(-6, 6), y: GROUND - 26 + rand(-6, 6),
          vx: rand(-70, 70), vy: rand(-90, 10), life: rand(0.3, 0.6), t: 0, color: pick(SHARD_COLORS), size: randInt(1, 2) });
      this.shake = Math.min(this.shake + 1, 3);
    }
  }
}

function fmtMini(n) {
  if (n < 1000) return Math.round(n).toString();
  const t = Math.floor(Math.log10(n) / 3);
  const sfx = ["", "K", "M", "B", "T", "Qa", "Qi"][t] || "e" + t * 3;
  return (n / Math.pow(1000, t)).toFixed(1) + sfx;
}
