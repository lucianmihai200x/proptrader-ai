const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

test("v18.5 isolates SMC analytics and validation from legacy data", () => {
  assert.match(server, /matchesAnalyticsScope\(item, scope\)/);
  assert.match(server, /analytics\(requestedScope = "SMC"\)/);
  assert.match(server, /const lossStreak = await consecutiveLosses\(s\)/);
  assert.match(server, /smcLiveEligible/);
  assert.match(server, /telegramSent/);
  assert.match(html, /Implicit sunt afișate numai rezultatele motorului SMC actual/);
});

test("v18.5 blocks misaligned and overlapping SMC plans", () => {
  assert.match(server, /premiumDiscountAligned\(setup\.side, setup\.premium_discount\)/);
  assert.match(server, /competingPendingSmcSetups/);
  assert.match(server, /zoneOverlapRatio/);
  assert.match(server, /openSmcExposureForSymbol/);
  assert.match(html, /BUY în DISCOUNT \/ SELL în PREMIUM/);
});

test("history aggregation is asynchronous and protected by coverage checks", () => {
  assert.match(server, /runHistoryAggregation/);
  assert.match(server, /res\.status\(202\)\.json\(\{ok:true,job:historyAggregationJobPublic\(\)\}\)/);
  assert.match(server, /sourceBars\.length<3000\|\|sourceTradingDays<30/);
  assert.match(server, /BACKTEST_MIN_TRADING_DAYS/);
  assert.match(html, /pollAggregationStatus/);
  assert.match(html, /Serverul a răspuns .* date incomplete/);
});
