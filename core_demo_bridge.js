"use strict";

const APP_VERSION = "core-demo-1.0.0";
const DEMO_BASE_URL = "https://demo-api-capital.backend-capital.com/api/v1";
const DEFAULT_EPICS = Object.freeze({ XAUUSD: "GOLD", US30: "US30", US100: "US100" });
const SEARCH_TERMS = Object.freeze({ XAUUSD: "Gold", US30: "US 30", US100: "US Tech 100" });
const MATCH_TOKENS = Object.freeze({
  XAUUSD: ["GOLD", "XAUUSD", "GOLDUSD"],
  US30: ["US30", "DJ30", "DOW30", "WALLSTREET"],
  US100: ["US100", "NAS100", "USTEC", "NASDAQ100"]
});
const DEFAULT_MAX_SIZE = Object.freeze({ XAUUSD: 1, US30: 1, US100: 1 });

const token = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const truthy = value => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeSymbol(value) {
  const t = token(value);
  if (["XAUUSD", "GOLD", "GOLDUSD"].includes(t)) return "XAUUSD";
  if (["US30", "DJ30", "DOW30", "WALLSTREET"].includes(t)) return "US30";
  if (["US100", "NAS100", "USTEC", "NASDAQ100"].includes(t)) return "US100";
  if (["GER40", "DE40", "DAX40", "GERMANY40"].includes(t)) return "GER40";
  if (["USOIL", "WTI", "OILCRUDE", "XTIUSD", "USCRUDE"].includes(t)) return "USOIL";
  return t;
}

function normalizeSide(value) {
  const side = String(value || "").toUpperCase();
  return side === "BUY" || side === "SELL" ? side : "";
}

function roundDown(value, increment) {
  const step = Number(increment);
  if (!(step > 0)) return Number(value);
  const precision = Math.min(10, Math.max(0, (String(step).split(".")[1] || "").length));
  return Number((Math.floor((Number(value) + 1e-12) / step) * step).toFixed(precision));
}

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeMap(value, defaults) {
  const custom = parseJsonObject(value, {});
  return Object.fromEntries(Object.entries({ ...defaults, ...custom }).map(([key, item]) => [normalizeSymbol(key), item]));
}

function validateCorePayload(payload, allowedSymbols = new Set(["XAUUSD", "US30", "US100"])) {
  const event = String(payload.event || "").trim().toUpperCase();
  const setupId = String(payload.setup_id || payload.external_id || "").trim().slice(0, 160);
  const symbol = normalizeSymbol(payload.symbol || payload.ticker);
  const side = normalizeSide(payload.side || payload.signal);

  if (!setupId) return { valid: false, reason: "Lipsește setup_id." };
  if (!allowedSymbols.has(symbol)) return { valid: false, reason: `${symbol || "simbol necunoscut"} este blocat pentru CORE DEMO.` };
  if (!side) return { valid: false, reason: "Direcția trebuie să fie BUY sau SELL." };

  if (!["ENTRY", "TIME_EXIT", "STAGNATION_EXIT"].includes(event)) {
    return { valid: false, reason: `Evenimentul ${event || "gol"} nu este folosit de CORE DEMO.` };
  }

  if (event !== "ENTRY") return { valid: true, event, setupId, symbol, side };

  const entry = Number(payload.entry ?? payload.price);
  const sl = Number(payload.sl);
  const tp2 = Number(payload.tp2 ?? payload.tp);
  const score = Number(payload.score ?? 0);
  const requestedRisk = Number(payload.risk_pct);
  if (![entry, sl, tp2].every(Number.isFinite)) return { valid: false, reason: "ENTRY necesită entry, sl și tp2 numerice." };
  if (side === "BUY" && !(sl < entry && entry < tp2)) return { valid: false, reason: "Pentru BUY trebuie SL < Entry < TP2." };
  if (side === "SELL" && !(sl > entry && entry > tp2)) return { valid: false, reason: "Pentru SELL trebuie SL > Entry > TP2." };
  const riskDistance = Math.abs(entry - sl);
  if (!(riskDistance > 0)) return { valid: false, reason: "Distanța Entry–SL este zero." };

  return { valid: true, event, setupId, symbol, side, entry, sl, tp2, score, requestedRisk, riskDistance };
}

function createCoreDemoBridge(options = {}) {
  const express = options.express || require("express");
  const Pool = options.Pool || require("pg").Pool;
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || global.fetch;
  const now = options.now || (() => Date.now());
  if (typeof fetchImpl !== "function") throw new Error("Runtime-ul Node nu oferă fetch.");

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.text({ type: ["text/plain", "application/text"], limit: "1mb" }));

  const webhookKey = String(env.WEBHOOK_KEY || "").trim();
  const enabled = truthy(env.CORE_DEMO_ENABLED);
  const apiKey = String(env.CAPITAL_API_KEY || "").trim();
  const identifier = String(env.CAPITAL_API_IDENTIFIER || "").trim();
  const password = String(env.CAPITAL_API_PASSWORD || "");
  const accountId = String(env.CAPITAL_ACCOUNT_ID || "").trim();
  const allowedSymbols = new Set(String(env.CORE_DEMO_ALLOWED_SYMBOLS || "XAUUSD,US30,US100").split(",").map(normalizeSymbol).filter(Boolean));
  for (const item of [...allowedSymbols]) if (!["XAUUSD", "US30", "US100"].includes(item)) allowedSymbols.delete(item);
  const epicMap = normalizeMap(env.CAPITAL_EPIC_MAP, DEFAULT_EPICS);
  const maxSizeMap = normalizeMap(env.CORE_DEMO_MAX_SIZE_BY_SYMBOL || env.CAPITAL_MAX_SIZE_BY_SYMBOL, DEFAULT_MAX_SIZE);
  const riskPercentCap = 0.20;
  const configuredRiskPercent = clamp(env.CORE_DEMO_RISK_PERCENT, 0.01, riskPercentCap, 0.20);
  const maxDailyOrders = Math.floor(clamp(env.CORE_DEMO_MAX_DAILY_ORDERS, 1, 20, 3));
  const maxOpenPositions = Math.floor(clamp(env.CORE_DEMO_MAX_OPEN_POSITIONS, 1, 10, 3));
  const maxSlippageR = clamp(env.CORE_DEMO_MAX_ENTRY_SLIPPAGE_R, 0.01, 0.50, 0.15);
  const maxSpreadR = clamp(env.CORE_DEMO_MAX_SPREAD_R, 0.01, 0.50, 0.10);
  const minScore = clamp(env.CORE_DEMO_MIN_SCORE, 0, 100, 0);
  const guaranteedStop = truthy(env.CAPITAL_GUARANTEED_STOP);
  const configured = Boolean(apiKey && identifier && password);
  const pool = env.DATABASE_URL ? new Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

  let session = null;
  let sessionPromise = null;
  let lastConnectionAt = null;
  let lastExecutionAt = null;
  let lastResult = "Nicio execuție CORE DEMO după pornire.";
  let lastError = "";
  const marketCache = new Map();
  const inFlight = new Set();
  const dealBySetup = new Map();

  function parseBody(req) {
    let body = req.body;
    if (Buffer.isBuffer(body)) body = body.toString("utf8");
    if (typeof body === "string") {
      const raw = body.trim();
      if (!raw) throw new Error("Payload gol.");
      try { body = JSON.parse(raw); } catch { throw new Error("Mesajul TradingView nu este JSON valid."); }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Payload invalid.");
    return body;
  }

  async function initDb() {
    if (!pool) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS core_demo_executions (
        id BIGSERIAL PRIMARY KEY,
        setup_id TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        event TEXT NOT NULL,
        status TEXT NOT NULL,
        epic TEXT,
        deal_id TEXT,
        deal_reference TEXT,
        signal_entry NUMERIC,
        broker_entry NUMERIC,
        sl NUMERIC,
        tp2 NUMERIC,
        size NUMERIC,
        risk_percent NUMERIC,
        estimated_risk NUMERIC,
        account_currency TEXT,
        details JSONB,
        error TEXT
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS core_demo_executions_created_idx ON core_demo_executions(created_at DESC)`);
  }

  async function rawRequest(path, { method = "GET", body, headers = {}, timeoutMs = 9000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${DEMO_BASE_URL}${path}`, {
        method,
        headers: { accept: "application/json", ...headers, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      let data = {};
      if (text) {
        try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; }
      }
      if (!response.ok) {
        const code = data.errorCode || data.error || data.message || `HTTP ${response.status}`;
        const error = new Error(`Capital.com DEMO: ${code}`);
        error.status = response.status;
        throw error;
      }
      return { data, headers: response.headers, status: response.status };
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Capital.com DEMO nu a răspuns în intervalul de siguranță.");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function createSession() {
    if (!configured) throw new Error("Lipsesc CAPITAL_API_KEY, CAPITAL_API_IDENTIFIER sau CAPITAL_API_PASSWORD.");
    const response = await rawRequest("/session", {
      method: "POST",
      headers: { "X-CAP-API-KEY": apiKey },
      body: { identifier, password, encryptedPassword: false }
    });
    const cst = response.headers.get("cst");
    const securityToken = response.headers.get("x-security-token");
    if (!cst || !securityToken) throw new Error("Capital.com DEMO nu a returnat CST/X-SECURITY-TOKEN.");
    session = { cst, securityToken, currentAccountId: response.data.currentAccountId || "", createdAt: now(), lastUsedAt: now() };
    if (accountId && session.currentAccountId !== accountId) {
      await authenticatedRequest("/session", { method: "PUT", body: { accountId }, retryAuth: false });
      session.currentAccountId = accountId;
    }
    lastConnectionAt = new Date(now()).toISOString();
    return session;
  }

  async function ensureSession() {
    if (session && now() - session.lastUsedAt < 8 * 60 * 1000) return session;
    if (sessionPromise) return sessionPromise;
    sessionPromise = createSession();
    try { return await sessionPromise; } finally { sessionPromise = null; }
  }

  async function authenticatedRequest(path, { method = "GET", body, retryAuth = true, timeoutMs } = {}) {
    await ensureSession();
    try {
      const response = await rawRequest(path, { method, body, timeoutMs, headers: { CST: session.cst, "X-SECURITY-TOKEN": session.securityToken } });
      session.lastUsedAt = now();
      return response;
    } catch (error) {
      if (retryAuth && [401, 403].includes(error.status) && ["GET", "PUT", "DELETE"].includes(method)) {
        session = null;
        await createSession();
        return authenticatedRequest(path, { method, body, retryAuth: false, timeoutMs });
      }
      throw error;
    }
  }

  async function accountContext() {
    const [accountsResponse, positionsResponse] = await Promise.all([authenticatedRequest("/accounts"), authenticatedRequest("/positions")]);
    const accounts = Array.isArray(accountsResponse.data.accounts) ? accountsResponse.data.accounts : [];
    const selected = accounts.find(item => item.accountId === (accountId || session.currentAccountId)) || accounts.find(item => item.preferred) || accounts[0];
    if (!selected) throw new Error("Capital.com DEMO nu a returnat niciun cont activ.");
    const balance = Number(selected.balance?.balance);
    if (!(balance > 0)) throw new Error("Soldul DEMO nu permite calculul riscului.");
    return { accountId: selected.accountId, currency: selected.currency || "", balance, available: Number(selected.balance?.available || 0), positions: Array.isArray(positionsResponse.data.positions) ? positionsResponse.data.positions : [] };
  }

  function marketScore(symbol, market) {
    const values = [market.epic, market.symbol, market.instrumentName].map(token);
    return (MATCH_TOKENS[symbol] || []).reduce((score, expected) => {
      if (values[0] === expected || values[1] === expected) return score + 100;
      return score + (values.some(value => value.includes(expected)) ? 10 : 0);
    }, market.marketStatus === "TRADEABLE" ? 5 : 0);
  }

  async function resolveMarket(symbol) {
    if (marketCache.has(symbol)) return marketCache.get(symbol);
    const configuredEpic = String(epicMap[symbol] || "").trim();
    if (configuredEpic) {
      try {
        const exact = await authenticatedRequest(`/markets/${encodeURIComponent(configuredEpic)}`);
        const result = { epic: configuredEpic, ...exact.data };
        marketCache.set(symbol, result);
        return result;
      } catch (error) { if (![400, 404].includes(error.status)) throw error; }
    }
    const found = await authenticatedRequest(`/markets?searchTerm=${encodeURIComponent(SEARCH_TERMS[symbol] || symbol)}`);
    const markets = Array.isArray(found.data.markets) ? found.data.markets : [];
    const ranked = markets.map(market => ({ market, score: marketScore(symbol, market) })).sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score < 10) throw new Error(`Instrumentul Capital.com pentru ${symbol} nu a putut fi identificat fără ambiguitate.`);
    const epic = ranked[0].market.epic;
    const details = await authenticatedRequest(`/markets/${encodeURIComponent(epic)}`);
    const result = { epic, ...details.data };
    marketCache.set(symbol, result);
    return result;
  }

  function distanceAllowed(rule, distance, referencePrice) {
    if (!rule || !Number.isFinite(Number(rule.value))) return true;
    const required = String(rule.unit || "").toUpperCase() === "PERCENTAGE" ? Math.abs(referencePrice) * Number(rule.value) / 100 : Number(rule.value);
    return distance + 1e-12 >= required;
  }

  async function dailyExecutedCount() {
    if (!pool) return 0;
    const result = await pool.query(`SELECT COUNT(*)::int AS n FROM core_demo_executions WHERE status='EXECUTED' AND created_at >= date_trunc('day', NOW())`);
    return Number(result.rows[0]?.n || 0);
  }

  async function setupAlreadySeen(setupId) {
    if (!pool) return dealBySetup.has(setupId);
    const result = await pool.query(`SELECT status,deal_id FROM core_demo_executions WHERE setup_id=$1 LIMIT 1`, [setupId]);
    return result.rows[0] || null;
  }

  async function saveExecution(row) {
    if (!pool) return;
    await pool.query(`
      INSERT INTO core_demo_executions (setup_id,symbol,side,event,status,epic,deal_id,deal_reference,signal_entry,broker_entry,sl,tp2,size,risk_percent,estimated_risk,account_currency,details,error)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
      ON CONFLICT (setup_id) DO UPDATE SET updated_at=NOW(),status=EXCLUDED.status,epic=COALESCE(EXCLUDED.epic,core_demo_executions.epic),deal_id=COALESCE(EXCLUDED.deal_id,core_demo_executions.deal_id),deal_reference=COALESCE(EXCLUDED.deal_reference,core_demo_executions.deal_reference),broker_entry=COALESCE(EXCLUDED.broker_entry,core_demo_executions.broker_entry),size=COALESCE(EXCLUDED.size,core_demo_executions.size),estimated_risk=COALESCE(EXCLUDED.estimated_risk,core_demo_executions.estimated_risk),details=EXCLUDED.details,error=EXCLUDED.error
    `, [row.setupId,row.symbol,row.side,row.event,row.status,row.epic||null,row.dealId||null,row.dealReference||null,row.signalEntry??null,row.brokerEntry??null,row.sl??null,row.tp2??null,row.size??null,row.riskPercent??null,row.estimatedRisk??null,row.accountCurrency||null,JSON.stringify(row.details||{}),row.error||null]);
  }

  async function confirmDeal(dealReference) {
    let confirmation = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt) await sleep(250 * attempt);
      const response = await authenticatedRequest(`/confirms/${encodeURIComponent(dealReference)}`, { retryAuth: false });
      confirmation = response.data;
      if (confirmation.dealStatus) break;
    }
    if (!confirmation || confirmation.dealStatus !== "ACCEPTED") throw new Error(`Capital.com DEMO a respins ${dealReference}: ${confirmation?.reason || confirmation?.dealStatus || "confirmare absentă"}.`);
    const dealId = confirmation.dealId || confirmation.affectedDeals?.find(item => item.status === "OPENED")?.dealId || confirmation.affectedDeals?.[0]?.dealId;
    if (!dealId) throw new Error(`Ordinul ${dealReference} a fost acceptat, dar lipsește dealId.`);
    return { ...confirmation, dealId };
  }

  async function previewEntry(signal) {
    if (signal.score < minScore) throw new Error(`Scorul ${signal.score} este sub pragul CORE DEMO ${minScore}.`);
    const count = await dailyExecutedCount();
    if (count >= maxDailyOrders) throw new Error(`Limita CORE DEMO de ${maxDailyOrders} ordine/zi a fost atinsă.`);
    const [account, market] = await Promise.all([accountContext(), resolveMarket(signal.symbol)]);
    const instrument = market.instrument || market.market || {};
    const snapshot = market.snapshot || market.market || {};
    const rules = market.dealingRules || {};
    const epic = market.epic || instrument.epic;
    const marketStatus = snapshot.marketStatus || instrument.marketStatus || market.marketStatus;
    if (marketStatus && marketStatus !== "TRADEABLE") throw new Error(`${signal.symbol} nu este tranzacționabil acum (${marketStatus}).`);
    if (account.positions.length >= maxOpenPositions) throw new Error(`Sunt deja ${account.positions.length} poziții; limita CORE DEMO este ${maxOpenPositions}.`);
    if (account.positions.some(item => String(item.market?.epic || "") === String(epic))) throw new Error(`Există deja o poziție Capital.com deschisă pe ${signal.symbol}.`);

    const brokerEntry = signal.side === "BUY" ? Number(snapshot.offer) : Number(snapshot.bid);
    if (!Number.isFinite(brokerEntry)) throw new Error(`Capital.com DEMO nu a returnat preț executabil pentru ${signal.symbol}.`);
    const bid = Number(snapshot.bid), offer = Number(snapshot.offer);
    const spread = Number.isFinite(bid) && Number.isFinite(offer) ? Math.max(0, offer - bid) : 0;
    if (spread > signal.riskDistance * maxSpreadR) throw new Error(`Spread prea mare: ${(spread / signal.riskDistance).toFixed(2)}R.`);
    const slippageR = Math.abs(brokerEntry - signal.entry) / signal.riskDistance;
    if (slippageR > maxSlippageR) throw new Error(`Prețul s-a deplasat ${slippageR.toFixed(2)}R față de Entry; semnal respins.`);
    if (signal.side === "BUY" && !(signal.sl < brokerEntry && brokerEntry < signal.tp2)) throw new Error("Prețul brokerului a ieșit din intervalul SL–TP2 pentru BUY.");
    if (signal.side === "SELL" && !(signal.sl > brokerEntry && brokerEntry > signal.tp2)) throw new Error("Prețul brokerului a ieșit din intervalul SL–TP2 pentru SELL.");
    if (!distanceAllowed(rules.minStopOrProfitDistance, Math.abs(brokerEntry - signal.sl), brokerEntry)) throw new Error("SL prea apropiat pentru regulile Capital.com.");
    if (!distanceAllowed(rules.minStopOrProfitDistance, Math.abs(brokerEntry - signal.tp2), brokerEntry)) throw new Error("TP2 prea apropiat pentru regulile Capital.com.");

    const minDealSize = Math.max(0, Number(rules.minDealSize?.value || 0));
    const increment = Math.max(0.000001, Number(rules.minSizeIncrement?.value || minDealSize || 0.001));
    const brokerMax = Number(rules.maxDealSize?.value);
    const configuredMax = Number(maxSizeMap[signal.symbol]);
    const maxSize = Math.min(Number.isFinite(brokerMax) && brokerMax > 0 ? brokerMax : Number.POSITIVE_INFINITY,Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : Number.POSITIVE_INFINITY);
    const requested = Number.isFinite(signal.requestedRisk) && signal.requestedRisk > 0 ? signal.requestedRisk : configuredRiskPercent;
    const riskPercent = Math.min(riskPercentCap, configuredRiskPercent, requested);
    const riskAmountLimit = account.balance * riskPercent / 100;
    const lotSize = Math.max(0.000001, Number(instrument.lotSize || market.lotSize || 1));
    const brokerRiskDistance = Math.abs(brokerEntry - signal.sl);
    const riskPerSize = brokerRiskDistance * lotSize;
    const rawSize = Math.min(riskAmountLimit / riskPerSize, maxSize);
    const size = roundDown(rawSize, increment);
    if (!(size >= minDealSize && size > 0)) throw new Error(`Mărimea calculată ${size} este sub minimul brokerului ${minDealSize}.`);
    const estimatedRisk = size * riskPerSize;
    if (estimatedRisk > riskAmountLimit * 1.001) throw new Error("Mărimea rotunjită depășește riscul maxim CORE DEMO.");
    return { ...signal, epic, brokerEntry, spread, slippageR, size, lotSize, riskPercent, riskAmountLimit, estimatedRisk, accountCurrency: account.currency, balance: account.balance };
  }

  async function executeEntry(signal) {
    if (!enabled) return { status: "DISABLED", reason: "CORE_DEMO_ENABLED este false." };
    if (!configured) return { status: "NOT_CONFIGURED", reason: "Credențialele Capital.com DEMO nu sunt complete." };
    const duplicate = await setupAlreadySeen(signal.setupId);
    if (duplicate) return { status: "DUPLICATE", reason: `setup_id ${signal.setupId} a fost deja procesat.`, previous: duplicate };
    if (inFlight.has(signal.setupId)) return { status: "DUPLICATE", reason: "Semnal deja în curs de procesare." };
    inFlight.add(signal.setupId);
    try {
      const preview = await previewEntry(signal);
      const response = await authenticatedRequest("/positions", { method: "POST", retryAuth: false, body: { epic: preview.epic, direction: preview.side, size: preview.size, guaranteedStop, stopLevel: preview.sl, profitLevel: preview.tp2 } });
      const dealReference = response.data.dealReference;
      if (!dealReference) throw new Error("Capital.com DEMO nu a returnat dealReference.");
      const confirmation = await confirmDeal(dealReference);
      dealBySetup.set(preview.setupId, { dealId: confirmation.dealId, symbol: preview.symbol, epic: preview.epic });
      lastExecutionAt = new Date(now()).toISOString();
      lastError = "";
      lastResult = `${preview.side} ${preview.symbol} DEMO: size ${preview.size}, SL ${preview.sl}, TP2 ${preview.tp2}, risc estimat ${preview.estimatedRisk.toFixed(2)} ${preview.accountCurrency}.`;
      await saveExecution({ setupId: preview.setupId, symbol: preview.symbol, side: preview.side, event: "ENTRY", status: "EXECUTED", epic: preview.epic, dealId: confirmation.dealId, dealReference, signalEntry: preview.entry, brokerEntry: preview.brokerEntry, sl: preview.sl, tp2: preview.tp2, size: preview.size, riskPercent: preview.riskPercent, estimatedRisk: preview.estimatedRisk, accountCurrency: preview.accountCurrency, details: { spread: preview.spread, slippageR: preview.slippageR, lotSize: preview.lotSize } });
      return { status: "EXECUTED", environment: "DEMO", setupId: preview.setupId, dealId: confirmation.dealId, preview: { symbol: preview.symbol, side: preview.side, epic: preview.epic, brokerEntry: preview.brokerEntry, sl: preview.sl, tp2: preview.tp2, size: preview.size, riskPercent: preview.riskPercent, estimatedRisk: preview.estimatedRisk, accountCurrency: preview.accountCurrency, spread: preview.spread, slippageR: preview.slippageR } };
    } catch (error) {
      lastExecutionAt = new Date(now()).toISOString();
      lastError = error.message;
      lastResult = `ENTRY respins: ${error.message}`;
      await saveExecution({ setupId: signal.setupId, symbol: signal.symbol, side: signal.side, event: "ENTRY", status: "REJECTED", signalEntry: signal.entry, sl: signal.sl, tp2: signal.tp2, error: error.message }).catch(() => {});
      return { status: "REJECTED", environment: "DEMO", setupId: signal.setupId, reason: error.message };
    } finally { inFlight.delete(signal.setupId); }
  }

  async function closeTimedExit(signal) {
    if (!enabled) return { status: "DISABLED", reason: "CORE_DEMO_ENABLED este false." };
    const tracked = dealBySetup.get(signal.setupId);
    if (!tracked?.dealId) return { status: "IGNORED", reason: "Poziția nu este mapată în memoria acestui proces; SL/TP2 broker rămân active. Nu închid alte poziții prin presupunere." };
    const response = await authenticatedRequest(`/positions/${encodeURIComponent(tracked.dealId)}`, { method: "DELETE", retryAuth: false });
    const dealReference = response.data.dealReference;
    if (dealReference) await confirmDeal(dealReference).catch(() => null);
    dealBySetup.delete(signal.setupId);
    lastExecutionAt = new Date(now()).toISOString();
    lastResult = `${signal.event} ${signal.symbol}: poziția DEMO ${tracked.dealId} închisă.`;
    if (pool) await pool.query(`UPDATE core_demo_executions SET updated_at=NOW(),status=$1,details=COALESCE(details,'{}'::jsonb)||$2::jsonb WHERE setup_id=$3`, [signal.event, JSON.stringify({ exitDealReference: dealReference || null }), signal.setupId]).catch(() => {});
    return { status: "CLOSED", environment: "DEMO", setupId: signal.setupId, event: signal.event, dealId: tracked.dealId };
  }

  async function testConnection() {
    const account = await accountContext();
    lastConnectionAt = new Date(now()).toISOString();
    lastError = "";
    lastResult = `Conexiune DEMO reușită: ${account.currency} ${account.balance}, ${account.positions.length} poziții deschise.`;
    return { ok: true, environment: "DEMO", accountId: account.accountId ? `••••${String(account.accountId).slice(-4)}` : "—", currency: account.currency, balance: account.balance, available: account.available, openPositions: account.positions.length };
  }

  function status() {
    return { ok: true, version: APP_VERSION, environment: "DEMO", hardLiveLock: true, enabled, configured, allowedSymbols: [...allowedSymbols], blockedSymbols: ["GER40", "USOIL"], executionModel: "ONE_POSITION_SL_TP2", riskPercentCap, configuredRiskPercent, maxDailyOrders, maxOpenPositions, lastConnectionAt, lastExecutionAt, lastResult, lastError };
  }

  app.get("/health", (req, res) => res.json(status()));
  app.get("/status", (req, res) => res.json(status()));
  app.post("/test-connection", async (req, res) => {
    try {
      const key = req.query.key || req.get("x-webhook-key") || "";
      if (!webhookKey || key !== webhookKey) return res.status(401).json({ ok: false, error: "WEBHOOK_KEY incorectă." });
      return res.json(await testConnection());
    } catch (error) { lastError = error.message; return res.status(400).json({ ok: false, error: error.message }); }
  });
  app.post("/core-webhook", async (req, res) => {
    try {
      const key = req.query.key || req.get("x-webhook-key") || "";
      if (!webhookKey || key !== webhookKey) return res.status(401).json({ ok: false, error: "WEBHOOK_KEY incorectă." });
      const payload = parseBody(req);
      const signal = validateCorePayload(payload, allowedSymbols);
      if (!signal.valid) {
        const event = String(payload.event || "").toUpperCase();
        if (["TP1", "TP2", "TP3", "SL"].includes(event)) return res.json({ ok: true, status: "IGNORED", event, reason: "Managementul CORE DEMO este broker-side: SL + TP2." });
        return res.status(400).json({ ok: false, error: signal.reason });
      }
      const result = signal.event === "ENTRY" ? await executeEntry(signal) : await closeTimedExit(signal);
      const code = ["EXECUTED", "CLOSED", "DUPLICATE", "IGNORED", "DISABLED", "NOT_CONFIGURED"].includes(result.status) ? 200 : 400;
      return res.status(code).json({ ok: code === 200, ...result });
    } catch (error) { lastError = error.message; lastResult = `Webhook respins: ${error.message}`; return res.status(400).json({ ok: false, error: error.message }); }
  });

  return { app, initDb, status, testConnection, validateCorePayload: payload => validateCorePayload(payload, allowedSymbols) };
}

if (require.main === module) {
  const port = process.env.PORT || 3000;
  const bridge = createCoreDemoBridge();
  bridge.initDb().then(() => bridge.app.listen(port, () => console.log(`PropTrader CORE DEMO ${APP_VERSION} rulează pe portul ${port}`))).catch(error => { console.error("CORE DEMO init failed:", error); process.exit(1); });
}

module.exports = { createCoreDemoBridge, validateCorePayload, normalizeSymbol, roundDown, DEMO_BASE_URL };
