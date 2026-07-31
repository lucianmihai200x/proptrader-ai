"use strict";

const FACTOR_LABELS = {
  NEWS_HIGH: "risc ridicat de știri",
  NEWS_MEDIUM: "risc moderat de știri",
  HTF_CONFLICT: "conflict între biasurile D1/H4",
  HTF_NEUTRAL: "context superior neutru",
  NO_MTF_CONFIRM: "lipsă confirmare multi-timeframe",
  RANGE_REGIME: "piață în consolidare",
  HIGH_VOL_REGIME: "volatilitate ridicată",
  NO_FVG: "fără FVG",
  NO_LIQUIDITY_SWEEP: "fără sweep de lichiditate",
  LOW_ADAPTIVE_SCORE: "scor adaptiv apropiat de prag",
  UNVALIDATED_MODEL: "model fără eșantion suficient",
  STRUCTURE_FAILURE: "structura nu a continuat după activare"
};

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function truthy(value) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "da"].includes(String(value || "").toLowerCase());
}

function containsBias(value, bias) {
  return String(value || "").toUpperCase().includes(bias);
}

function parseFactors(value) {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function buildTradeReview(signal, result, pnlR) {
  const normalizedResult = String(result || "").toUpperCase();
  const loss = finite(pnlR) < 0 || normalizedResult === "SL";
  const factors = [];
  const latestContext = parseObject(signal.monitoring_state);
  const newsRisk = finite(latestContext.newsRisk, finite(signal.news_risk));
  const trendContext = `${signal.trend || ""} ${signal.mtf_trend || ""} ${latestContext.d1Bias || ""} ${latestContext.h4Bias || ""} ${latestContext.localBias || ""}`.toUpperCase();
  const hasBullish = containsBias(trendContext, "BULLISH");
  const hasBearish = containsBias(trendContext, "BEARISH");
  const regime = String(signal.regime || "").toUpperCase();

  if (newsRisk >= 80) factors.push("NEWS_HIGH");
  else if (newsRisk >= 55) factors.push("NEWS_MEDIUM");
  if (hasBullish && hasBearish) factors.push("HTF_CONFLICT");
  else if (containsBias(trendContext, "NEUTRAL")) factors.push("HTF_NEUTRAL");
  if (!truthy(signal.mtf_confirm)) factors.push("NO_MTF_CONFIRM");
  if (regime === "RANGE") factors.push("RANGE_REGIME");
  if (regime === "HIGH_VOL") factors.push("HIGH_VOL_REGIME");
  if (!truthy(signal.fvg)) factors.push("NO_FVG");
  if (!truthy(signal.liquidity_sweep)) factors.push("NO_LIQUIDITY_SWEEP");
  if (finite(signal.adaptive_score, finite(signal.score)) < 82) factors.push("LOW_ADAPTIVE_SCORE");
  if (finite(signal.probability) <= 0 || finite(signal.confidence_lower) <= 0) factors.push("UNVALIDATED_MODEL");
  if (loss && factors.length === 0) factors.push("STRUCTURE_FAILURE");

  const uniqueFactors = [...new Set(factors)];
  const labels = uniqueFactors.map(factor => FACTOR_LABELS[factor] || factor);
  const summary = loss
    ? `Analiză SL: ${labels.join(", ")}. Aceste condiții vor penaliza scorul configurațiilor similare după acumularea unui eșantion repetat.`
    : `Rezultat ${normalizedResult}: ${finite(pnlR).toFixed(2)}R. Configurația rămâne în eșantionul modelului pentru recalibrarea probabilității și a scorului.`;

  return {
    reviewedAt: new Date().toISOString(),
    factors: uniqueFactors,
    summary
  };
}

function lossFactorStats(rows) {
  const losses = (Array.isArray(rows) ? rows : []).filter(row => finite(row.pnl_r) < 0);
  const counts = new Map();
  for (const row of losses) {
    for (const factor of new Set(parseFactors(row.review_factors))) {
      counts.set(factor, (counts.get(factor) || 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [dominantFactor = "", dominantCount = 0] = sorted[0] || [];
  const dominantRate = losses.length ? dominantCount / losses.length : 0;
  const repeated = dominantCount >= 3 && dominantRate >= 0.5;
  const penalty = repeated ? Math.min(4, Number((1.25 + (dominantCount - 3) * 0.75).toFixed(2))) : 0;
  return {
    losses: losses.length,
    dominantFactor,
    dominantLabel: FACTOR_LABELS[dominantFactor] || dominantFactor,
    dominantCount,
    dominantRate,
    penalty
  };
}

function buildMonitoringReview(signal, bar) {
  const side = String(signal.signal || "").toUpperCase();
  const direction = side === "SELL" ? -1 : 1;
  const entry = finite(signal.price);
  const stop = finite(signal.sl);
  const close = finite(bar.close, entry);
  const risk = Math.abs(entry - stop);
  const currentR = risk > 0 ? ((close - entry) * direction) / risk : 0;
  const stage = signal.tp2_hit_at ? "TP2_ATINS"
    : signal.tp1_hit_at ? "TP1_ATINS"
      : currentR < -0.5 ? "SUB_PRESIUNE"
        : currentR > 0 ? "FAVORABIL"
          : "LA_INTRARE";
  const summary = stage === "TP2_ATINS"
    ? `Reevaluare activă: TP2 a fost atins; restul poziției este protejat la break-even. Preț curent ${currentR.toFixed(2)}R.`
    : stage === "TP1_ATINS"
      ? `Reevaluare activă: TP1 a fost atins; stopul gestionat este la break-even. Preț curent ${currentR.toFixed(2)}R.`
      : stage === "SUB_PRESIUNE"
        ? `Reevaluare activă: prețul evoluează contra intrării (${currentR.toFixed(2)}R), dar planul rămâne valid până la SL.`
        : `Reevaluare activă: planul este ${currentR >= 0 ? "favorabil" : "aproape de intrare"} la ${currentR.toFixed(2)}R.`;
  return {
    reviewedAt: new Date().toISOString(),
    stage,
    currentR: Number(currentR.toFixed(3)),
    summary
  };
}

module.exports = {
  FACTOR_LABELS,
  buildTradeReview,
  buildMonitoringReview,
  lossFactorStats,
  parseFactors
};
