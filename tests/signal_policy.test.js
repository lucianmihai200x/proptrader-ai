const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signalFamily,
  matchesAnalyticsScope,
  premiumDiscountAligned,
  zoneOverlapRatio
} = require("../signal_policy");

test("signal families keep current SMC separate from legacy and test data", () => {
  assert.equal(signalFamily({ signal_source: "SMC_LIVE" }), "SMC");
  assert.equal(signalFamily({ signal_source: "SMC_SERVER" }), "SMC");
  assert.equal(signalFamily({ external_id: "SMC-LIVE-ABC" }), "SMC");
  assert.equal(signalFamily({ signal_source: "MODEL_ISTORIC" }), "MODEL");
  assert.equal(signalFamily({ external_id: "TEST-123" }), "TEST");
  assert.equal(signalFamily({ signal_source: "WEBHOOK" }), "LEGACY");
  assert.equal(matchesAnalyticsScope({ signal_source: "SMC_LIVE" }, "smc"), true);
  assert.equal(matchesAnalyticsScope({ signal_source: "WEBHOOK" }, "smc"), false);
  assert.equal(matchesAnalyticsScope({ signal_source: "TEST" }, "all"), false);
});

test("SMC premium/discount alignment is directional", () => {
  assert.equal(premiumDiscountAligned("BUY", "DISCOUNT"), true);
  assert.equal(premiumDiscountAligned("BUY", "PREMIUM"), false);
  assert.equal(premiumDiscountAligned("SELL", "PREMIUM"), true);
  assert.equal(premiumDiscountAligned("SELL", "DISCOUNT"), false);
});

test("overlap ratio detects competing order-block zones", () => {
  assert.equal(zoneOverlapRatio({ zone_low: 100, zone_high: 110 }, { zone_low: 105, zone_high: 115 }), 0.5);
  assert.equal(zoneOverlapRatio({ zone_low: 100, zone_high: 110 }, { zone_low: 111, zone_high: 120 }), 0);
  assert.equal(zoneOverlapRatio({ zone_low: 100, zone_high: 120 }, { zone_low: 105, zone_high: 110 }), 1);
});
