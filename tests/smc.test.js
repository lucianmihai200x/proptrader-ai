const test = require("node:test");
const assert = require("node:assert/strict");
const {
  structureBias,
  findBreakEvents,
  findSmcSetups,
  evaluatePendingSetup,
  targetLevels
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

test("pending retracement remains valid when price is beyond TP1 before entry", () => {
  const sell = evaluatePendingSetup({
    status: "PENDING", side: "SELL", entry: 1035, sl: 1045, tp1: 1010,
    expires_at: "2026-01-02T00:00:00Z"
  }, {
    bar_time: "2026-01-01T10:00:00Z", open: 1020, high: 1025, low: 1008, close: 1012
  });
  const buy = evaluatePendingSetup({
    status: "PENDING", side: "BUY", entry: 52433.65, sl: 52414.05, tp1: 52482.2,
    expires_at: "2026-01-02T00:00:00Z"
  }, {
    bar_time: "2026-01-01T10:25:00Z", open: 52500, high: 52524, low: 52490, close: 52517.9
  });
  assert.equal(sell.action, "KEEP");
  assert.equal(buy.action, "KEEP");
  assert.match(sell.reason, /nu a atins încă intrarea/);
  assert.match(buy.reason, /nu a atins încă intrarea/);
});

test("targets become relevant only after entry confirmation", () => {
  const result = evaluatePendingSetup({
    status: "PENDING", side: "SELL", entry: 1035, sl: 1045, tp1: 1010,
    expires_at: "2026-01-02T00:00:00Z"
  }, {
    bar_time: "2026-01-01T10:00:00Z", open: 1038, high: 1040, low: 1008, close: 1012
  });
  assert.equal(result.action, "TRIGGER");
  assert.match(result.reason, /confirmare M5 SELL/);
});

test("SMC targets remain ordered and separated when TP1 uses a liquidity pool above standard TP2", () => {
  const entry = 28298.65;
  const risk = 31.3;
  const swings = {
    highs: [
      { price: 28375.4 },
      { price: 28448 }
    ],
    lows: []
  };
  const [tp1, tp2, tp3] = targetLevels("BUY", entry, risk, swings);
  assert.equal(tp1, 28375.4);
  assert.ok(tp2 + 1e-6 >= tp1 + risk * 0.35, `TP2 ${tp2} trebuie separat de TP1 ${tp1}`);
  assert.ok(tp3 + 1e-6 >= tp2 + risk * 0.35, `TP3 ${tp3} trebuie separat de TP2 ${tp2}`);
  assert.ok(entry < tp1 && tp1 < tp2 && tp2 < tp3);
});
