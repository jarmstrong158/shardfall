// DOM HUD: top bar (the Damage vs Collection balance), pile/tier readout, shop.

import { UPGRADES, TIERS, upgradeCost, isMaxed, isUnlocked, canTierUp } from "./state.js";
import { fmt } from "./util.js";

const $ = (id) => document.getElementById(id);
let els = {};

export function buildShop(state, onBuy) {
  const list = $("shopList"); list.innerHTML = ""; els = {};
  for (const u of UPGRADES) {
    const item = document.createElement("div");
    item.className = "shop-item";
    item.innerHTML = `
      <div class="si-head"><span class="key">${u.key}</span><span class="name">${u.icon} ${u.name}</span></div>
      <div class="cost"></div>`;
    item.addEventListener("click", () => onBuy(u.id));
    list.appendChild(item);
    els[u.id] = { root: item, cost: item.querySelector(".cost") };
  }
}

export function updateShop(state) {
  for (const u of UPGRADES) {
    const e = els[u.id]; if (!e) continue;
    const unlocked = isUnlocked(u, state);
    const maxed = isMaxed(u, state);
    e.root.title = unlocked ? u.desc(state) : "??? — keep mining to unlock";
    e.root.classList.toggle("locked", !unlocked);
    e.root.classList.toggle("maxed", maxed);

    if (u.kind === "tier") {
      if (state.tier >= TIERS.length - 1) { e.cost.textContent = "MAX"; e.root.classList.remove("affordable"); }
      else if (canTierUp(state)) { e.cost.textContent = "CRACK"; e.root.classList.add("affordable"); e.cost.classList.remove("cant"); }
      else { e.cost.textContent = fmt(TIERS[state.tier + 1].advance) + " dug"; e.root.classList.remove("affordable"); e.cost.classList.add("cant"); }
      continue;
    }
    if (maxed) { e.cost.textContent = "MAX"; e.root.classList.remove("affordable"); continue; }
    if (!unlocked) { e.cost.textContent = "—"; e.root.classList.remove("affordable"); continue; }

    const cost = upgradeCost(u, state);
    const needMote = u.kind === "assign" && state.idle < 1;
    e.cost.innerHTML = needMote ? "need&nbsp;mote" : fmt(cost);
    const afford = state.shards >= cost && !needMote;
    e.root.classList.toggle("affordable", afford);
    e.cost.classList.toggle("cant", !afford);
  }
}

export function updateHUD(sim) {
  const s = sim.state;
  $("bank").textContent = fmt(s.shards);
  const dmg = sim.dmgRate, coll = sim.collRate, recl = sim.reclRate;
  $("rate").textContent = fmt(dmg) + "/s";
  $("coll").textContent = fmt(coll) + "/s";
  $("recl").textContent = fmt(recl) + "/s";

  // pile rising (dmg outpacing collection+reclaim) -> warn
  const net = dmg - coll - recl;
  $("coll").style.color = coll < dmg * 0.6 && dmg > 0 ? "var(--bad)" : "var(--good)";

  $("pile").textContent = fmt(sim.pileTotal());
  $("tier").textContent = TIERS[s.tier].name;
  const employed = Object.values(s.roles).reduce((a, b) => a + (b || 0), 0);
  $("motes").textContent = `${s.idle} idle · ${employed} working`;
  $("mult").textContent = "x" + fmt(Math.pow(1.28, s.levels.value) * s.resonance);
  $("asc").textContent = s.ascensions;

  // tier progress
  const last = s.tier >= TIERS.length - 1;
  const goal = last ? TIERS[s.tier].advance : TIERS[s.tier + 1].advance;
  const prev = s.tier > 0 ? TIERS[s.tier].advance : 0;
  const pct = last ? 100 : Math.min(100, ((s.produced - prev) / (goal - prev)) * 100);
  $("layerBar").style.width = pct.toFixed(1) + "%";
  $("layerHint").textContent = last
    ? `Core reached — ${fmt(s.produced)} dug`
    : `${fmt(s.produced)} / ${fmt(goal)} dug → ${TIERS[s.tier + 1].name}`;
}

let toastTimer = null;
export function toast(text) {
  const t = $("toast"); t.textContent = text; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2000);
}
