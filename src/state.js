// Game configuration + persistent state.
//
// Core loop (see MECHANICS.md):
//   DAMAGE  — sources hit the rock (left); each shard lands at a distance set by RANGE.
//   PILE    — shards stack on the ground between rock and stash; a tall pile is
//             reclaimed by the rock (exponential, from tier 2 on). Mountaineers spread it.
//   COLLECT — runners (and your clicks) move pile shards into the STASH (right) = currency.
// The game is the tension between Damage/sec and Collection/sec.

// Wide field, 16:9, higher internal resolution (960x540 -> crisp at 1280+).
// Long gap between rock and stash so range and collection genuinely matter.
export const WORLD = {
  W: 960, H: 540, GROUND: 470,
  ROCK_X: 54,        // the rock, far left — everything hits this
  STASH_X: 906,      // the Shard Stash, far right — currency store
  PILE_L: 120, PILE_R: 800,  // the ground span the pile occupies
  BINS: 84,          // pile is a height-field of this many columns
};

// Rock tiers. `mult` is how much each shard is WORTH at that tier (currency on
// deposit), NOT how many shards spawn — so counts stay collectable while income
// scales exponentially with depth. `reclaim` is the max leak fraction near the
// rock; `advance` is the shard COUNT you must mine to crack to the next tier.
export const TIERS = [
  { name: "Surface",  mult: 1,     reclaim: 0,    advance: 0 },
  { name: "Tier II",  mult: 6,     reclaim: 0.05, advance: 250 },
  { name: "Tier III", mult: 40,    reclaim: 0.08, advance: 2000 },
  { name: "Tier IV",  mult: 260,   reclaim: 0.12, advance: 15000 },
  { name: "Tier V",   mult: 1800,  reclaim: 0.17, advance: 100000 },
  { name: "The Core", mult: 13000, reclaim: 0.24, advance: 650000 },
];

export const SHARD_COLORS = [
  "#ff7a3e", "#ff7a3e", "#ff5d2e", "#3ee6ff", "#ff3ea5",
  "#b6ff3e", "#ffffff", "#ffd84a", "#c46bff",
];

// Shop. `kind` drives buy logic in main.js:
//   housing — queues a mote (arrives on a cooldown) into the idle pool
//   assign  — consumes one idle mote + shards to staff a role
//   stat    — pure shard cost
//   tier    — advance the rock a tier (gated by lifetime shards produced)
export const UPGRADES = [
  { id: "housing", key: "1", kind: "housing", name: "Build Housing", icon: "🏠",
    desc: (s) => `Houses a new mote (arrives after a wait). Idle motes: ${s.idle}`,
    base: 12, growth: 1.28 },

  { id: "slammer", key: "2", kind: "assign", name: "Employ Slammer", icon: "🔨",
    desc: (s) => `Slams the rock for damage. Slammers: ${s.roles.slammer}`,
    base: 8, growth: 1.16 },

  { id: "runner", key: "3", kind: "assign", name: "Employ Runner", icon: "🏃",
    desc: (s) => `Hauls pile shards to the stash. Runners: ${s.roles.runner}`,
    base: 8, growth: 1.16 },

  { id: "mountaineer", key: "4", kind: "assign", name: "Employ Mountaineer", icon: "⛰",
    desc: (s) => `Stomps the pile flatter, cutting reclamation. Mountaineers: ${s.roles.mountaineer}`,
    base: 40, growth: 1.22, unlock: (s) => s.tier >= 1 || s.roles.mountaineer > 0 },

  { id: "slinger", key: "5", kind: "assign", name: "Employ Slinger", icon: "🏹",
    desc: (s) => `Shoots the rock from afar — its shards land right by the stash. Slingers: ${s.roles.slinger}`,
    base: 90, growth: 1.2, unlock: (s) => s.tier >= 1 || s.roles.slinger > 0 },

  { id: "tosser", key: "6", kind: "assign", name: "Employ Tosser", icon: "🌀",
    desc: (s) => `Telekinetically lobs pile shards across the gap into the stash. Tossers: ${s.roles.tosser}`,
    base: 130, growth: 1.2, unlock: (s) => s.produced >= 2000 || s.roles.tosser > 0 },

  { id: "bomber", key: "7", kind: "assign", name: "Employ Bomber", icon: "💣",
    desc: (s) => `Lobs bombs that burst a wide spray of shards off the rock. Bombers: ${s.roles.bomber || 0}`,
    base: 600, growth: 1.24, unlock: (s) => s.produced >= 12000 || (s.roles.bomber || 0) > 0 },

  { id: "slampower", key: "8", kind: "stat", name: "Sharper Picks", icon: "✦",
    desc: (s) => `Each hit knocks loose ${1 + s.levels.slampower} shards`,
    base: 50, growth: 1.55, max: 7 },

  { id: "range", key: "9", kind: "stat", name: "Better Range", icon: "»",
    desc: (s) => `Shards land closer to the stash (range ${2 + s.levels.range}) — and out of the rock's reach`,
    base: 45, growth: 1.45, max: 9 },

  { id: "haul", key: "0", kind: "stat", name: "Bigger Satchels", icon: "🎒",
    desc: (s) => `Each runner carries ${3 + s.levels.haul} shards`,
    base: 55, growth: 1.5, max: 12 },

  { id: "slamclub", key: "q", kind: "stat", name: "Slam Club", icon: "🥊",
    desc: (s) => `All damage output x${(1.2 ** s.levels.slamclub).toFixed(2)}`,
    base: 220, growth: 1.5, unlock: (s) => s.produced >= 600 || s.levels.slamclub > 0 },

  { id: "express", key: "w", kind: "stat", name: "The Express", icon: "🚄",
    desc: (s) => `All collection x${(1.2 ** s.levels.express).toFixed(2)}`,
    base: 220, growth: 1.5, unlock: (s) => s.produced >= 600 || s.levels.express > 0 },

  { id: "reach", key: "e", kind: "stat", name: "Stash Reach", icon: "🧲",
    desc: (s) => s.levels.reach > 0
      ? `Stash auto-pulls shards within ${80 + s.levels.reach * 46}px of it`
      : `The stash pulls in nearby shards on its own`,
    base: 150, growth: 1.6, max: 8, unlock: (s) => s.produced >= 1500 || s.levels.reach > 0 },

  { id: "value", key: "r", kind: "stat", name: "Refinement", icon: "💎",
    desc: (s) => `Every shard worth x${(1.28 ** s.levels.value).toFixed(2)} on deposit (capped — depth comes from tiers)`,
    base: 140, growth: 2.05, max: 16 },

  { id: "tierup", key: "t", kind: "tier", name: "Crack Deeper", icon: "⬇",
    desc: (s) => s.tier >= TIERS.length - 1
      ? "The rock is cracked to its core."
      : `Advance to ${TIERS[s.tier + 1].name} — shards worth x${TIERS[s.tier + 1].mult}, but the rock claws back harder`,
    base: 0, growth: 1 },
];

const SAVE_KEY = "shardfall-save-v2";

export function newState() {
  return {
    shards: 0,             // currency in the stash
    idle: 2,               // unemployed motes ready to assign
    queue: [],             // housing cooldowns (seconds remaining) for incoming motes
    roles: { slammer: 0, runner: 0, mountaineer: 0, slinger: 0, tosser: 0, bomber: 0 },
    levels: { housing: 0, slampower: 0, range: 0, haul: 0, value: 0,
              slamclub: 0, express: 0, reach: 0 },
    tier: 0,
    produced: 0,           // lifetime shards produced this run (drives tier-up gating)
    ascensions: 0,
    resonance: 1,          // permanent global multiplier from prestige
    lifetime: 0,
    completed: false,
    muted: false,
    started: false,
  };
}

// ---- derived ----
// COUNT side (kept moderate so collection can always keep up):
export const rangeStat    = (s) => 2 + s.levels.range;            // 2..11
export const haulCap      = (s) => 3 + s.levels.haul;
export const shardsPerHit = (s) => 1 + s.levels.slampower;        // physical shards per strike
export const damageMult   = (s) => Math.pow(1.2, s.levels.slamclub);   // Slam Club
export const collectMult  = (s) => Math.pow(1.2, s.levels.express);    // The Express
export const reachRadius  = (s) => s.levels.reach > 0 ? 80 + s.levels.reach * 46 : 0;
export const reachRate    = (s) => s.levels.reach > 0 ? (0.45 + s.levels.reach * 0.22) * collectMult(s) : 0;
// VALUE side (where all the exponential growth lives):
export const shardValue   = (s) => TIERS[s.tier].mult * Math.pow(1.28, s.levels.value) * s.resonance;
export const reclaimCoef  = (s) => TIERS[s.tier].reclaim;
export const canTierUp    = (s) =>
  s.tier < TIERS.length - 1 && s.produced >= TIERS[s.tier + 1].advance;

export function upgradeCost(u, s) {
  if (u.kind === "tier") return 0;
  const lvl = u.kind === "assign" ? s.roles[u.id] : s.levels[u.id];
  return Math.ceil(u.base * Math.pow(u.growth, lvl));
}
export function isMaxed(u, s) {
  return u.max !== undefined && s.levels[u.id] >= u.max;
}
export function isUnlocked(u, s) { return !u.unlock || u.unlock(s); }

// ---- save / load ----
export function save(s) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {}
}
export function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = newState();
    Object.assign(s, JSON.parse(raw));
    const fresh = newState();
    s.roles = Object.assign({}, fresh.roles, s.roles || {});
    s.levels = Object.assign({}, fresh.levels, s.levels || {});
    if (!Array.isArray(s.queue)) s.queue = [];
    return s;
  } catch (e) { return null; }
}
export function wipe() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
