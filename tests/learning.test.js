const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTradeReview, buildMonitoringReview, lossFactorStats } = require("../learning");

test("SL review records concrete context factors", () => {
  const review = buildTradeReview({
    news_risk: 65,
    trend: "D1 BEARISH / H4 BULLISH",
    mtf_confirm: false,
    regime: "RANGE",
    fvg: false,
    liquidity_sweep: true,
    adaptive_score: 77,
    probability: 0
  }, "SL", -1);
  assert.match(review.summary, /Analiză SL/);
  assert.ok(review.factors.includes("NEWS_MEDIUM"));
  assert.ok(review.factors.includes("HTF_CONFLICT"));
  assert.ok(review.factors.includes("RANGE_REGIME"));
  assert.ok(review.factors.includes("LOW_ADAPTIVE_SCORE"));
});

test("repeated loss factor creates a bounded penalty for similar setups", () => {
  const rows = Array.from({ length: 5 }, () => ({
    pnl_r: -1,
    review_factors: ["HTF_CONFLICT", "NO_FVG"]
  }));
  const stats = lossFactorStats(rows);
  assert.equal(stats.dominantFactor, "HTF_CONFLICT");
  assert.ok(stats.penalty > 0);
  assert.ok(stats.penalty <= 4);
});

test("active trade monitoring reports target progress", () => {
  const review = buildMonitoringReview({
    signal: "BUY", price: 100, sl: 90, tp1_hit_at: "2026-01-01T00:00:00Z"
  }, { close: 112 });
  assert.equal(review.stage, "TP1_ATINS");
  assert.match(review.summary, /break-even/);
});
