const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalSymbol } = require("../symbols");

test("broker aliases are stored under one canonical instrument", () => {
  for (const alias of ["NAS100", "US100", "USTEC", "USTECH", "NDX", "CAPITALCOM:US100"]) {
    assert.equal(canonicalSymbol(alias), "NAS100");
  }
  for (const alias of ["US30", "DJ30", "DOW30", "CAPITALCOM:US30"]) {
    assert.equal(canonicalSymbol(alias), "US30");
  }
  for (const alias of ["XAUUSD", "GOLD", "OANDA:XAUUSD"]) {
    assert.equal(canonicalSymbol(alias), "XAUUSD");
  }
});

test("unknown symbols remain available instead of being silently remapped", () => {
  assert.equal(canonicalSymbol("EURUSD"), "EURUSD");
});
