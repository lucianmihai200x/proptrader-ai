"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCorePayload, normalizeSymbol, roundDown, DEMO_BASE_URL } = require("../core_demo_bridge");

test("CORE bridge is hard-wired to Capital.com DEMO", () => {
  assert.equal(DEMO_BASE_URL, "https://demo-api-capital.backend-capital.com/api/v1");
});

test("normalizes supported TradingView aliases", () => {
  assert.equal(normalizeSymbol("NAS100"), "US100");
  assert.equal(normalizeSymbol("GOLD"), "XAUUSD");
  assert.equal(normalizeSymbol("US30"), "US30");
});

test("accepts a valid BUY entry and uses TP2", () => {
  const signal = validateCorePayload({ event:"ENTRY", setup_id:"abc", symbol:"US30", side:"BUY", entry:100, sl:98, tp2:102, score:50, risk_pct:0.2 });
  assert.equal(signal.valid, true);
  assert.equal(signal.tp2, 102);
  assert.equal(signal.riskDistance, 2);
});

test("rejects GER40 and USOIL", () => {
  for (const symbol of ["GER40", "USOIL"]) {
    const signal = validateCorePayload({ event:"ENTRY", setup_id:"abc", symbol, side:"BUY", entry:100, sl:98, tp2:102 });
    assert.equal(signal.valid, false);
  }
});

test("rejects malformed level ordering", () => {
  const signal = validateCorePayload({ event:"ENTRY", setup_id:"abc", symbol:"XAUUSD", side:"SELL", entry:100, sl:99, tp2:98 });
  assert.equal(signal.valid, false);
});

test("roundDown never rounds risk size upward", () => {
  assert.equal(roundDown(1.29, 0.1), 1.2);
});
