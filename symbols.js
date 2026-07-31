"use strict";

const SYMBOL_ALIASES = Object.freeze({
  NAS100: "NAS100",
  US100: "NAS100",
  USTEC: "NAS100",
  USTECH: "NAS100",
  NDX: "NAS100",
  NASDAQ100: "NAS100",
  US100CASH: "NAS100",
  US30: "US30",
  DJ30: "US30",
  DJI: "US30",
  DJIA: "US30",
  DOW30: "US30",
  WALLSTREET: "US30",
  XAUUSD: "XAUUSD",
  GOLD: "XAUUSD",
  GOLDUSD: "XAUUSD"
});

function symbolToken(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  const withoutExchange = raw.includes(":") ? raw.split(":").pop() : raw;
  return withoutExchange.replace(/[^A-Z0-9]/g, "");
}

function canonicalSymbol(value, fallback = "") {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return fallback;
  const token = symbolToken(raw);
  return SYMBOL_ALIASES[token] || raw.slice(0, 30);
}

function aliasSummary() {
  return {
    NAS100: ["NAS100", "US100", "USTEC", "USTECH", "NDX", "NASDAQ100", "US100CASH"],
    US30: ["US30", "DJ30", "DJI", "DJIA", "DOW30", "WALLSTREET"],
    XAUUSD: ["XAUUSD", "GOLD", "GOLDUSD"]
  };
}

module.exports = { SYMBOL_ALIASES, symbolToken, canonicalSymbol, aliasSummary };
