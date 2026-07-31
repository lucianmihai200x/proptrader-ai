"use strict";

function signalFamily(signal = {}) {
  const source = String(signal.signal_source || "").trim().toUpperCase();
  const externalId = String(signal.external_id || "").trim().toUpperCase();
  if (source.startsWith("SMC") || externalId.startsWith("SMC-LIVE-")) return "SMC";
  if (source === "MODEL_ISTORIC" || externalId.startsWith("AUTO-")) return "MODEL";
  if (source === "TEST" || externalId.startsWith("TEST-") || externalId.startsWith("TELEGRAM-TEST-")) return "TEST";
  return "LEGACY";
}

function matchesAnalyticsScope(signal, requestedScope = "SMC") {
  const scope = String(requestedScope || "SMC").trim().toUpperCase();
  if (scope === "ALL") return signalFamily(signal) !== "TEST";
  if (scope === "LEGACY") return signalFamily(signal) === "LEGACY";
  if (scope === "MODEL") return signalFamily(signal) === "MODEL";
  return signalFamily(signal) === "SMC";
}

function premiumDiscountAligned(side, zone) {
  const normalizedSide = String(side || "").trim().toUpperCase();
  const normalizedZone = String(zone || "").trim().toUpperCase();
  if (normalizedSide === "BUY") return normalizedZone === "DISCOUNT";
  if (normalizedSide === "SELL") return normalizedZone === "PREMIUM";
  return false;
}

function zoneOverlapRatio(first = {}, second = {}) {
  const aLow = Number(first.zone_low);
  const aHigh = Number(first.zone_high);
  const bLow = Number(second.zone_low);
  const bHigh = Number(second.zone_high);
  if (![aLow, aHigh, bLow, bHigh].every(Number.isFinite)) return 0;
  const lowA = Math.min(aLow, aHigh);
  const highA = Math.max(aLow, aHigh);
  const lowB = Math.min(bLow, bHigh);
  const highB = Math.max(bLow, bHigh);
  const intersection = Math.max(0, Math.min(highA, highB) - Math.max(lowA, lowB));
  const shortest = Math.min(highA - lowA, highB - lowB);
  if (shortest <= 0) return 0;
  return intersection / shortest;
}

module.exports = {
  signalFamily,
  matchesAnalyticsScope,
  premiumDiscountAligned,
  zoneOverlapRatio
};
