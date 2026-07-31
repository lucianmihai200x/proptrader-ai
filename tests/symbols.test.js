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
  for (const alias of ["GER40", "DE40", "DAX40", "GERMANY40", "CAPITALCOM:DE40", "DUKASCOPY:DEU.IDX/EUR"]) {
    assert.equal(canonicalSymbol(alias), "GER40");
  }
  for (const alias of ["USOIL", "WTI", "XTIUSD", "OIL_CRUDE", "CAPITALCOM:OIL_CRUDE", "DUKASCOPY:LIGHT.CMD/USD"]) {
    assert.equal(canonicalSymbol(alias), "USOIL");
  }
});

test("unknown symbols remain available instead of being silently remapped", () => {
  assert.equal(canonicalSymbol("EURUSD"), "EURUSD");
});
