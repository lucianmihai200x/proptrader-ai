"use strict";

const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function rewardRisk(entry, stop, target, side) {
  const risk = Math.abs(finite(entry) - finite(stop));
  if (!(risk > 0)) return 0;
  const direction = String(side || "").toUpperCase() === "SELL" ? -1 : 1;
  return ((finite(target, finite(entry)) - finite(entry)) * direction) / risk;
}

/**
 * Model de management: câte 1/3 din poziție se marchează la TP1, TP2 și TP3,
 * iar restul rămas este protejat la break-even după TP1.
 */
function outcomeR(signal, result, payload = {}) {
  const normalizedResult = String(result || "").toUpperCase();
  if (normalizedResult === "CLOSED") return finite(payload.pnl_r);
  if (["BE", "EXPIRED"].includes(normalizedResult)) return 0;
  if (normalizedResult === "SL") return -1;

  const entry = finite(signal.price);
  const stop = finite(signal.sl);
  const side = signal.signal;
  const rr1 = rewardRisk(entry, stop, signal.tp1, side);
  const rr2 = rewardRisk(entry, stop, signal.tp2, side);
  const rr3 = rewardRisk(entry, stop, signal.tp3, side);

  if (normalizedResult === "TP1") return rr1;
  if (normalizedResult === "TP2") return rr2;
  if (normalizedResult === "TP3") return (rr1 + rr2 + rr3) / 3;
  if (normalizedResult === "TP1_BE") return rr1 / 3;
  if (normalizedResult === "TP2_BE") return (rr1 + rr2) / 3;
  return 0;
}

module.exports = { rewardRisk, outcomeR };
