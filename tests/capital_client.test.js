"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCapitalClient, validLevels, roundDown } = require("../capital_client");

function response(data, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function signal(overrides = {}) {
  return {
    external_id: "SMC-LIVE-SMC-US30-TEST",
    signal_source: "SMC_LIVE",
    execution_mode: "LIVE",
    symbol: "US30",
    signal: "BUY",
    price: 54000,
    sl: 53900,
    tp1: 54150,
    tp2: 54250,
    tp3: 54400,
    adaptive_score: 90,
    news_risk: 20,
    ...overrides
  };
}

function demoEnv(overrides = {}) {
  return {
    CAPITAL_AUTO_TRADING_ENABLED: "true",
    CAPITAL_ENVIRONMENT: "DEMO",
    CAPITAL_API_KEY: "api-key",
    CAPITAL_API_IDENTIFIER: "user@example.test",
    CAPITAL_API_PASSWORD: "custom-password",
    CAPITAL_RISK_PERCENT: "0.2",
    CAPITAL_MIN_ADAPTIVE_SCORE: "85",
    CAPITAL_EPIC_MAP: JSON.stringify({ US30: "US30" }),
    CAPITAL_MAX_SIZE_BY_SYMBOL: JSON.stringify({ US30: 2 }),
    ...overrides
  };
}

function successfulBroker({ failPositionNumber = 0 } = {}) {
  const calls = [];
  let positionNumber = 0;
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname;
    const method = options.method || "GET";
    calls.push({ path, method, body: options.body ? JSON.parse(options.body) : null });
    if (path.endsWith("/session") && method === "POST") {
      return response({ currentAccountId: "account-1234", accountInfo: { balance: 10000 }, currencyIsoCode: "USD" }, { headers: { CST: "cst", "X-SECURITY-TOKEN": "security" } });
    }
    if (path.endsWith("/accounts")) {
      return response({ accounts: [{ accountId: "account-1234", preferred: true, currency: "USD", balance: { balance: 10000, available: 9000 } }] });
    }
    if (path.endsWith("/positions") && method === "GET") return response({ positions: [] });
    if (path.endsWith("/markets/US30")) {
      return response({
        instrument: { epic: "US30" },
        snapshot: { marketStatus: "TRADEABLE", bid: 53999, offer: 54001 },
        dealingRules: {
          minDealSize: { value: 0.01, unit: "POINTS" },
          minSizeIncrement: { value: 0.01, unit: "POINTS" },
          maxDealSize: { value: 100, unit: "POINTS" },
          minStopOrProfitDistance: { value: 0.01, unit: "PERCENTAGE" }
        }
      });
    }
    if (path.endsWith("/positions") && method === "POST") {
      positionNumber++;
      if (positionNumber === failPositionNumber) return response({ errorCode: "error.market.closed" }, { status: 400 });
      return response({ dealReference: `order-${positionNumber}` });
    }
    if (path.includes("/confirms/order-")) {
      const number = path.split("order-")[1];
      return response({ dealStatus: "ACCEPTED", dealId: `deal-${number}`, level: 54001, affectedDeals: [{ dealId: `deal-${number}`, status: "OPENED" }] });
    }
    if (path.includes("/positions/deal-") && method === "DELETE") {
      const number = path.split("deal-")[1];
      return response({ dealReference: `close-${number}` });
    }
    if (path.includes("/confirms/close-")) {
      const number = path.split("close-")[1];
      return response({ dealStatus: "ACCEPTED", dealId: `deal-${number}`, affectedDeals: [{ dealId: `deal-${number}`, status: "CLOSED" }] });
    }
    throw new Error(`Rută mock neașteptată: ${method} ${path}`);
  };
  return { fetchImpl, calls };
}

test("validLevels acceptă doar niveluri ordonate corect", () => {
  assert.equal(validLevels(signal()).valid, true);
  assert.equal(validLevels(signal({ sl: 54010 })).valid, false);
  assert.equal(validLevels(signal({ signal: "SELL", sl: 54100, tp1: 53850, tp2: 53750, tp3: 53600 })).valid, true);
});

test("roundDown nu mărește dimensiunea peste riscul calculat", () => {
  assert.equal(roundDown(0.069, 0.01), 0.06);
  assert.equal(roundDown(1.27, 0.1), 1.2);
});

test("un semnal SMC LIVE deschide exact trei poziții TP1–TP3", async () => {
  const broker = successfulBroker();
  const client = createCapitalClient({ env: demoEnv(), fetchImpl: broker.fetchImpl });
  const result = await client.executeSignal(signal(), { dailyExecutedCount: 0 });
  assert.equal(result.status, "EXECUTED");
  assert.deepEqual(result.deals.map(item => item.target), ["TP1", "TP2", "TP3"]);
  assert.equal(broker.calls.filter(item => item.method === "POST" && item.path.endsWith("/positions")).length, 3);
  assert.ok(result.preview.estimatedRiskAmount <= result.preview.riskAmountLimit);
});

test("cererile paralele folosesc o singură sesiune Capital.com", async () => {
  const broker = successfulBroker();
  const client = createCapitalClient({ env: demoEnv(), fetchImpl: broker.fetchImpl });
  const result = await client.testConnection();
  assert.equal(result.ok, true);
  assert.equal(broker.calls.filter(item => item.method === "POST" && item.path.endsWith("/session")).length, 1);
});

test("dacă o felie e respinsă, pozițiile deja deschise sunt închise", async () => {
  const broker = successfulBroker({ failPositionNumber: 2 });
  const client = createCapitalClient({ env: demoEnv(), fetchImpl: broker.fetchImpl });
  const result = await client.executeSignal(signal());
  assert.equal(result.status, "ROLLED_BACK");
  assert.equal(result.opened.length, 1);
  assert.equal(result.rollback[0].status, "CLOSED");
  assert.equal(broker.calls.filter(item => item.method === "DELETE").length, 1);
});

test("planurile PENDING, semnalele test și scorurile sub prag nu se execută", async () => {
  const broker = successfulBroker();
  const client = createCapitalClient({ env: demoEnv(), fetchImpl: broker.fetchImpl });
  const pending = await client.executeSignal(signal({ external_id: "SMC-PENDING-1" }));
  assert.equal(pending.status, "REJECTED");
  const lowScore = await client.executeSignal(signal({ adaptive_score: 80 }));
  assert.equal(lowScore.status, "REJECTED");
  assert.equal(broker.calls.filter(item => item.path.endsWith("/positions") && item.method === "POST").length, 0);
});

test("modul LIVE rămâne blocat fără confirmarea explicită", async () => {
  const broker = successfulBroker();
  const client = createCapitalClient({ env: demoEnv({ CAPITAL_ENVIRONMENT: "LIVE" }), fetchImpl: broker.fetchImpl });
  const result = await client.executeSignal(signal());
  assert.equal(result.status, "LIVE_LOCKED");
  assert.equal(broker.calls.length, 0);
});
