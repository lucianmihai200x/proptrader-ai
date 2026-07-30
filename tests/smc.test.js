const test = require("node:test");
const assert = require("node:assert/strict");
const {
  structureBias,
  findBreakEvents,
  findSmcSetups,
  evaluatePendingSetup
} = require("../smc");

function bar(index, open, high, low, close, timeframe = 5) {
  return {
    bar_time: new Date(Date.UTC(2026, 0, 1, 0, index * timeframe)).toISOString(),
    open, high, low, close, volume: 100
  };
}

function bearishContext(timeframe = 240) {
  const bars = [];
  for (let index = 0; index < 70; index += 1) {
    const close = 1200 - index * 2 + Math.sin(index / 3) * 3;
    bars.push(bar(index, close + 1, close + 2, close - 2, close, timeframe));
  }
  return bars;
}

function bearishSmcSequence() {
  const bars = [];
  for (let index = 0; index < 60; index += 1) {
    const center = 1030 - index * 0.25 + Math.sin(index * Math.PI / 4) * 10;
    const open = center + Math.sin(index) * 1.2;
    const close = center + Math.cos(index) * 1.2;
    bars.push(bar(index, open, Math.max(open, close) + 2, Math.min(open, close) - 2, close));
  }
  let index = 60;
  bars.push(bar(index++, 1004, 1012, 1002, 1010)); // ultima lumânare bullish = bearish OB
  bars.push(bar(index++, 1008, 1009, 978, 981));   // displacement + BOS
  bars.push(bar(index++, 979, 980, 972, 974));     // confirmă FVG bearish
  bars.push(bar(index++, 974, 976, 968, 970));
  bars.push(bar(index++, 970, 972, 966, 968));
  return bars;
}

test("SMC detects bearish structure and a displacement break", () => {
  const bars = bearishSmcSequence();
  assert.equal(structureBias(bars).bias, "BEARISH");
  const events = findBreakEvents(bars).events;
  assert.ok(events.some(event => event.side === "SELL" && event.type === "BOS"));
});

test("SMC creates a future order-block entry instead of using current price", () => {
  const bars = bearishSmcSequence();
  const context = bearishContext();
  const setups = findSmcSetups({
    symbol: "US30",
    timeframe: "5",
    bars,
    h4Bars: context,
    d1Bars: context,
    now: new Date("2026-01-01T06:00:00Z")
  });
  assert.ok(setups.length > 0);
  const setup = setups[0];
  assert.equal(setup.side, "SELL");
  assert.equal(setup.status, "PENDING");
  assert.equal(setup.d1_bias, "BEARISH");
  assert.equal(setup.h4_bias, "BEARISH");
  assert.ok(setup.entry > setup.current_price);
  assert.ok(setup.sl > setup.entry);
  assert.ok(setup.entry > setup.tp1 && setup.tp1 > setup.tp2 && setup.tp2 > setup.tp3);
  assert.ok(setup.fvg || setup.liquidity_sweep);
});

test("pending setup triggers only after touching entry and an M5 rejection", () => {
  const setup = {
    status: "PENDING",
    side: "SELL",
    entry: 1035,
    sl: 1045,
    touch_count: 0,
    expires_at: "2026-01-02T00:00:00Z"
  };
  const untouched = evaluatePendingSetup(setup, {
    bar_time: "2026-01-01T10:00:00Z", open: 1020, high: 1030, low: 1018, close: 1025
  });
  assert.equal(untouched.action, "KEEP");
  const touchedWithoutRejection = evaluatePendingSetup(setup, {
    bar_time: "2026-01-01T10:05:00Z", open: 1032, high: 1038, low: 1030, close: 1037
  });
  assert.equal(touchedWithoutRejection.action, "TOUCH");
  const confirmed = evaluatePendingSetup(setup, {
    bar_time: "2026-01-01T10:10:00Z", open: 1038, high: 1040, low: 1032, close: 1034
  });
  assert.equal(confirmed.action, "TRIGGER");
});

test("ambiguous entry and stop crossing cancels the plan conservatively", () => {
  const result = evaluatePendingSetup({
    status: "PENDING", side: "SELL", entry: 1035, sl: 1045,
    expires_at: "2026-01-02T00:00:00Z"
  }, {
    bar_time: "2026-01-01T10:00:00Z", open: 1030, high: 1048, low: 1028, close: 1032
  });
  assert.equal(result.action, "CANCEL");
  assert.match(result.reason, /ordine intrabar necunoscută/);
});
