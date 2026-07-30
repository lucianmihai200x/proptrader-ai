const test = require("node:test");
const assert = require("node:assert/strict");
const { rewardRisk, outcomeR } = require("../trade_management");

const buy = {
  signal: "BUY",
  price: 100,
  sl: 90,
  tp1: 115,
  tp2: 125,
  tp3: 140
};

test("calculează R din nivelurile reale, nu din constante", () => {
  assert.equal(rewardRisk(100, 90, 115, "BUY"), 1.5);
  assert.equal(rewardRisk(100, 110, 75, "SELL"), 2.5);
});

test("managementul pe trei tranșe păstrează rezultatul TP1/TP2 înainte de break-even", () => {
  assert.equal(outcomeR(buy, "TP1_BE"), 0.5);
  assert.equal(outcomeR(buy, "TP2_BE"), (1.5 + 2.5) / 3);
  assert.equal(outcomeR(buy, "TP3"), (1.5 + 2.5 + 4) / 3);
  assert.equal(outcomeR(buy, "SL"), -1);
});
