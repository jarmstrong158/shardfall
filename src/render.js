// Pixel-art renderer (640x360 world, scaled up nearest-neighbour by main.js).
// Layout: rock (left) -> pile height-field (middle) -> stash (right).

import { WORLD, TIERS, SHARD_COLORS, reachRadius } from "./state.js";
import { heightPx } from "./sim.js";
import { clamp, hash01, TAU } from "./util.js";

const { W, H, GROUND, ROCK_X, STASH_X, PILE_L, PILE_R, BINS } = WORLD;
const BINW = (PILE_R - PILE_L) / BINS;

export class Renderer {
  constructor(ctx) {
    this.ctx = ctx;
    this.stars = Array.from({ length: 90 }, (_, i) => ({
      x: hash01(i) * W, y: hash01(i + 9) * (GROUND - 50), s: hash01(i + 7) > 0.9 ? 2 : 1, tw: hash01(i + 3),
    }));
  }

  draw(sim) {
    const ctx = this.ctx;
    const s = sim.state;
    const tier = TIERS[s.tier];
    const tod = Math.sin(sim.time * (TAU / 80)) * 0.5 + 0.5;

    ctx.save();
    if (sim.shake > 0.05) ctx.translate((Math.random() - 0.5) * sim.shake, (Math.random() - 0.5) * sim.shake);

    this.sky(tod);
    this.stars2(tod);
    this.ground(tod);
    this.reachZone(sim);
    this.stash(sim);
    this.rock(sim, tier);
    this.pile(sim);
    this.shards(sim);
    this.drawMotes(sim);
    this.particles(sim);
    this.floats(sim);

    ctx.restore();
  }

  sky(tod) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, lerpHex("#0a0820", "#3d6fb0", tod));
    g.addColorStop(1, lerpHex("#241638", "#bcd0dc", tod));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, GROUND + 4);
  }
  stars2(tod) {
    if (tod > 0.55) return;
    const ctx = this.ctx; const a = (0.55 - tod) * 1.8;
    for (const st of this.stars) { ctx.globalAlpha = clamp(a * (0.3 + 0.7 * st.tw), 0, 1); ctx.fillStyle = "#fff"; ctx.fillRect(st.x | 0, st.y | 0, st.s, st.s); }
    ctx.globalAlpha = 1;
  }
  ground(tod) {
    const ctx = this.ctx;
    ctx.fillStyle = lerpHex("#15101f", "#352c1f", tod); ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = lerpHex("#241c30", "#52462c", tod); ctx.fillRect(0, GROUND, W, 2);
  }

  rock(sim, tier) {
    const ctx = this.ctx;
    const bx = ROCK_X, by = GROUND;
    // glow
    const pulse = 0.55 + 0.45 * Math.sin(sim.time * 2.5);
    const gr = ctx.createRadialGradient(bx, by - 20, 4, bx, by - 20, 70);
    gr.addColorStop(0, hexA(tier.glow || "#9fb4d8", 0.28 * pulse));
    gr.addColorStop(1, hexA(tier.glow || "#9fb4d8", 0));
    ctx.fillStyle = gr; ctx.fillRect(bx - 70, by - 90, 140, 110);
    // small chunky boulder
    ctx.fillStyle = "#e9edf4";
    ctx.beginPath();
    ctx.moveTo(bx - 22, by); ctx.lineTo(bx - 18, by - 26); ctx.lineTo(bx - 6, by - 36);
    ctx.lineTo(bx + 10, by - 30); ctx.lineTo(bx + 22, by - 14); ctx.lineTo(bx + 24, by);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c2c8d6"; // shaded right
    ctx.beginPath();
    ctx.moveTo(bx + 6, by - 30); ctx.lineTo(bx + 22, by - 14); ctx.lineTo(bx + 24, by); ctx.lineTo(bx + 6, by);
    ctx.closePath(); ctx.fill();
    // cyan crown + lime base accents (like the source rock)
    ctx.fillStyle = "#4fe6e6"; ctx.fillRect(bx - 8, by - 36, 8, 3);
    ctx.fillStyle = "#9bff5a"; ctx.fillRect(bx - 16, by - 4, 30, 3);
    // tier veins
    ctx.strokeStyle = hexA(tierColor(sim.state.tier), 0.85); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx - 14, by - 8); ctx.lineTo(bx - 2, by - 22); ctx.stroke();
  }

  pile(sim) {
    const ctx = this.ctx;
    for (let i = 0; i < BINS; i++) {
      const c = sim.pile[i]; if (c <= 0.4) continue;
      const h = heightPx(c);
      const x = Math.round(PILE_L + i * BINW);
      const w = Math.ceil(BINW) + 1;
      const top = Math.round(GROUND - h);
      // body: bright cool-white at the crown, fading to a faint green base
      const g = ctx.createLinearGradient(0, top, 0, GROUND);
      g.addColorStop(0, "#f8fbff");
      g.addColorStop(0.5, "#ebeef6");
      g.addColorStop(1, "#dde9db");
      ctx.fillStyle = g; ctx.fillRect(x, top, w, GROUND - top);
      ctx.fillStyle = "rgba(110,116,144,0.22)"; ctx.fillRect(x + w - 1, top, 1, GROUND - top);
      // yellow crust on the ridge, green rim at the base
      ctx.fillStyle = "#ffd84a"; ctx.fillRect(x, top, w, 1);
      ctx.fillStyle = "#9be07a"; ctx.fillRect(x, GROUND - 1, w, 1);
      // dense, fine, depth-banded shard scatter — reads as buried strata/layers
      for (let yy = top + 2; yy < GROUND - 1; yy += 3) {
        for (let sIdx = 0; sIdx < 2; sIdx++) {
          if (hash01(i * 12.9 + yy * 1.7 + sIdx * 41.3) > 0.32) continue;
          const cx = x + ((hash01(i * 3.3 + yy * 0.7 + sIdx) * (w - 1)) | 0);
          const band = Math.floor((yy - top) / 18);
          ctx.fillStyle = SHARD_COLORS[(i + band * 2 + sIdx) % SHARD_COLORS.length];
          ctx.fillRect(cx, yy, 2, 2);
        }
      }
    }
  }

  reachZone(sim) {
    const rad = reachRadius(sim.state);
    if (rad <= 0) return;
    const ctx = this.ctx;
    const x0 = STASH_X - rad;
    const g = ctx.createLinearGradient(x0, 0, STASH_X, 0);
    g.addColorStop(0, "rgba(90,230,230,0)");
    g.addColorStop(1, "rgba(90,230,230,0.10)");
    ctx.fillStyle = g; ctx.fillRect(x0, 40, rad, GROUND - 40);
    // faint pulse line at the edge of the pull
    ctx.fillStyle = `rgba(120,240,240,${0.18 + 0.12 * Math.sin(sim.time * 4)})`;
    ctx.fillRect(x0, 40, 1, GROUND - 40);
  }

  stash(sim) {
    const ctx = this.ctx;
    const x = STASH_X, by = GROUND, VH = 230, VW = 56;
    const fill = clamp(Math.log10(Math.max(1, sim.state.shards + 1)) * 24, 6, VH - 6);
    // glow
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(sim.time * 3) * 0.3;
    const gr = ctx.createRadialGradient(x + 10, by - fill * 0.5, 6, x + 10, by - fill * 0.5, 110);
    gr.addColorStop(0, "rgba(90,230,230,0.22)"); gr.addColorStop(1, "rgba(90,230,230,0)");
    ctx.fillStyle = gr; ctx.fillRect(x - 40, by - VH - 30, 130, VH + 40);
    ctx.globalAlpha = 1;
    // vault walls
    ctx.strokeStyle = "#cfe6e6"; ctx.lineWidth = 1;
    ctx.strokeRect(x - 2.5, by - VH - 0.5, VW, VH);
    // shard fill (cyan-white glowing hoard)
    for (let r = 0; r < fill; r += 2) {
      ctx.fillStyle = r % 6 === 0 ? "#9bf0f0" : "#e8feff";
      const jitter = (hash01(r) * 5) | 0;
      ctx.fillRect(x + jitter, by - 2 - r, VW - 4 - jitter - (hash01(r + 1) * 5 | 0), 2);
    }
    if (sim.stashFlash > 0.02) {
      // subtle shimmer at the top of the hoard (not a giant disc)
      ctx.globalAlpha = Math.min(sim.stashFlash, 1) * 0.35; ctx.fillStyle = "#eafffe";
      ctx.beginPath(); ctx.arc(x + VW / 2, by - fill, 10, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
    }
    // banner
    ctx.fillStyle = "#5a4a2a"; ctx.fillRect(x + VW / 2, by - VH - 14, 1, 14);
    ctx.fillStyle = "#5ae6e6"; ctx.fillRect(x + VW / 2 + 1, by - VH - 14, 7, 4);
  }

  shards(sim) {
    const ctx = this.ctx;
    for (const sh of sim.shards) {
      const p = sh.t / sh.dur;
      const endY = sh.kind === "reclaim" ? GROUND - 14 : GROUND - 3;
      const x = sh.x + (sh.tx - sh.x) * p;
      const y = (sh.y + (endY - sh.y) * p) - Math.sin(Math.PI * p) * sh.arc;
      ctx.fillStyle = sh.color;
      ctx.fillRect((x - 1) | 0, (y - 1) | 0, 3, 3);
      ctx.fillStyle = "#fff"; ctx.fillRect((x - 1) | 0, (y - 1) | 0, 1, 1);
    }
  }

  drawMotes(sim) {
    const list = [...sim.motes].sort((a, b) => a.y - b.y);
    for (const g of list) this.mote(g);
  }
  // the little ones: rounded white blobs with a simple two-dot face and a
  // role-coloured "belt" — distinguished by a small prop, never a humanoid.
  mote(g) {
    const ctx = this.ctx;
    const x = Math.round(g.x), y = Math.round(g.y);
    const moving = g.state === "toPile" || g.state === "toStash" || g.state === "idle";
    const swing = moving ? (Math.sin(g.step * 2) > 0 ? 1 : 0) : 0;
    const OUT = "#6f7488", EYE = "#241f33";
    const body = g.role === "mountaineer" ? "#d2e4ff"
               : g.role === "tosser" ? "#ecdcff" : "#f4f6fb";
    const belt = { slammer: "#ff8a3e", runner: "#63ec74", mountaineer: "#5aa8ff",
                   slinger: "#ffd84a", tosser: "#c46bff", bomber: "#ff5d2e" }[g.role];
    const d = g.dir;

    // feet (under the body), little 2-frame shuffle while moving
    ctx.fillStyle = EYE;
    ctx.fillRect(x - 2, y - swing, 1, 1);
    ctx.fillRect(x + 1, y - (1 - swing), 1, 1);
    // rounded blob: grey silhouette, white interior inset 1px (reads on the pile)
    ctx.fillStyle = OUT;
    ctx.fillRect(x - 2, y - 6, 5, 6);
    ctx.fillRect(x - 1, y - 7, 3, 1);
    ctx.fillStyle = body;
    ctx.fillRect(x - 1, y - 5, 3, 4);   // interior
    ctx.fillRect(x, y - 6, 1, 1);       // rounded top
    // role-coloured belt
    ctx.fillStyle = belt;
    ctx.fillRect(x - 1, y - 2, 3, 1);
    // two-dot face
    ctx.fillStyle = EYE;
    ctx.fillRect(x - 1, y - 4, 1, 1);
    ctx.fillRect(x + 1, y - 4, 1, 1);

    // role props
    if (g.role === "slammer") {
      const s2 = Math.sin(g.step);
      ctx.strokeStyle = "#cfd3de"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x - 2, y - 4); ctx.lineTo(x - 4, y - 6 - s2 * 2); ctx.stroke();
      ctx.fillStyle = "#9aa0b4"; ctx.fillRect(x - 5, y - 7 - (s2 > 0 ? 1 : 0), 2, 1); // pick head
    } else if (g.role === "slinger") {
      ctx.strokeStyle = "#a9d6ff"; ctx.lineWidth = 1;     // little bow toward the rock
      ctx.beginPath(); ctx.moveTo(x - 3, y - 6); ctx.quadraticCurveTo(x - 5, y - 4, x - 3, y - 2); ctx.stroke();
    } else if (g.role === "tosser") {
      const bobf = Math.sin(g.step * 3) * 1.5;            // shard hovering via telekinesis
      ctx.fillStyle = "#c46bff"; ctx.fillRect(x - 1, (y - 11 + bobf) | 0, 3, 3);
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 1, (y - 11 + bobf) | 0, 1, 1);
    } else if (g.role === "runner" && g.carry > 0) {
      ctx.fillStyle = "#ff7a3e"; ctx.fillRect(x - 1, y - 10, 3, 3);
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 1, y - 10, 1, 1);
    } else if (g.role === "mountaineer") {
      ctx.fillStyle = "#2f6bbf"; ctx.fillRect(x, y - 8, 1, 2); // little summit flag pole
      ctx.fillStyle = "#5aa8ff"; ctx.fillRect(x + 1, y - 8, 2, 1);
    } else if (g.role === "bomber") {
      ctx.fillStyle = "#2a2438"; ctx.fillRect(x - 1, y - 11, 3, 3);   // round bomb held up
      ctx.fillStyle = "#7a6a40"; ctx.fillRect(x + 1, y - 12, 1, 1);   // fuse
      ctx.fillStyle = "#ffd84a"; ctx.fillRect(x + 1, y - 13 - (Math.sin(g.step * 6) > 0 ? 1 : 0), 1, 1); // spark
    }
  }

  particles(sim) {
    const ctx = this.ctx;
    for (const p of sim.particles) { ctx.globalAlpha = clamp(1 - p.t / p.life, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x | 0, p.y | 0, p.size, p.size); }
    ctx.globalAlpha = 1;
  }
  floats(sim) {
    const ctx = this.ctx; ctx.font = "7px monospace"; ctx.textAlign = "center";
    for (const f of sim.floats) { ctx.globalAlpha = clamp(1 - f.t / f.life, 0, 1); ctx.fillStyle = "#000"; ctx.fillText(f.text, f.x + 0.7, f.y + 0.7); ctx.fillStyle = "#ffd84a"; ctx.fillText(f.text, f.x, f.y); }
    ctx.globalAlpha = 1; ctx.textAlign = "left";
  }
}

function tierColor(t) { return ["#9fb4d8", "#d8a6f5", "#ff8b9c", "#7fb0ff", "#ffb55a", "#b89bff"][t] || "#fff"; }
function shadeC(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 255) * f, 0, 255) | 0;
  const g = clamp(((n >> 8) & 255) * f, 0, 255) | 0;
  const b = clamp((n & 255) * f, 0, 255) | 0;
  return `rgb(${r},${g},${b})`;
}
function lerpHex(a, b, t) {
  t = clamp(t, 0, 1);
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  return `rgb(${(ar + (br - ar) * t) | 0},${(ag + (bg - ag) * t) | 0},${(ab + (bb - ab) * t) | 0})`;
}
function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
