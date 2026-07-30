const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SUPPORTED_ANALYSIS_TIMEFRAMES,
  normalizeTimeframe,
  parseAnalysisTimeframes,
  timeframeLabel,
  profileFor,
  completedHigherTimeframes
} = require("../timeframes");
const { signalMessage } = require("../telegram");

test("timeframe aliases normalize to the five supported analysis intervals", () => {
  assert.equal(normalizeTimeframe("M5"), "5");
  assert.equal(normalizeTimeframe("M15"), "15");
  assert.equal(normalizeTimeframe("30m"), "30");
  assert.equal(normalizeTimeframe("1H"), "60");
  assert.equal(normalizeTimeframe("H4"), "240");
  assert.deepEqual(parseAnalysisTimeframes("H4, M5, 30, 60, M15"), SUPPORTED_ANALYSIS_TIMEFRAMES);
});

test("timeframe labels do not show H1 and H4 as minutes", () => {
  assert.equal(timeframeLabel("5"), "M5");
  assert.equal(timeframeLabel("60"), "H1");
  assert.equal(timeframeLabel("240"), "H4");
});

test("a closing M5 candle identifies each higher timeframe completed at that instant", () => {
  assert.deepEqual(completedHigherTimeframes("2026-07-30T07:10:00.000Z"), ["15"]);
  assert.deepEqual(completedHigherTimeframes("2026-07-30T07:25:00.000Z"), ["15", "30"]);
  assert.deepEqual(completedHigherTimeframes("2026-07-30T07:55:00.000Z"), ["15", "30", "60", "240"]);
});

test("each interval has a strict signal profile", () => {
  const m5 = profileFor("5", { minScore: 85, horizonBars: null, cooldownMinutes: null });
  const h4 = profileFor("240", { minScore: 85 });
  assert.equal(m5.label, "M5");
  assert.equal(m5.minScore, 88);
  assert.equal(m5.horizonBars, 6);
  assert.equal(h4.label, "H4");
  assert.equal(h4.minScore, 85);
  assert.equal(h4.horizonBars, 2);
});

test("Telegram signal contains interval, entry, SL and TP1-TP3", () => {
  const message = signalMessage({
    signal: "BUY",
    symbol: "US30",
    timeframe: "240",
    price: 45000,
    sl: 44900,
    tp1: 45150,
    tp2: 45250,
    tp3: 45350,
    score: 90,
    probability: 82
  });
  assert.match(message, /H4/);
  assert.match(message, /Intrare/);
  assert.match(message, /SL/);
  assert.match(message, /TP1/);
  assert.match(message, /TP2/);
  assert.match(message, /TP3/);
});
