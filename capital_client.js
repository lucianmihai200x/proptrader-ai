"use strict";

const DEFAULT_EPICS = Object.freeze({
  US30: "US30",
  NAS100: "US100",
  XAUUSD: "GOLD",
  GER40: "DE40",
  USOIL: "OIL_CRUDE"
});

const SEARCH_TERMS = Object.freeze({
  US30: "US 30",
  NAS100: "US Tech 100",
  XAUUSD: "Gold",
  GER40: "Germany 40",
  USOIL: "Oil Crude"
});

const MATCH_TOKENS = Object.freeze({
  US30: ["US30", "DJ30", "DOW30", "WALLSTREET"],
  NAS100: ["US100", "NAS100", "USTEC", "NASDAQ100"],
  XAUUSD: ["GOLD", "XAUUSD", "GOLDUSD"],
  GER40: ["DE40", "GER40", "DAX40", "GERMANY40"],
  USOIL: ["OILCRUDE", "USOIL", "WTI", "XTIUSD", "USCRUDE"]
});

const DEFAULT_MAX_SIZE = Object.freeze({
  US30: 1,
  NAS100: 1,
  XAUUSD: 1,
  GER40: 1,
  USOIL: 10
});

const clamp = (value, min, max, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
};

const truthy = value => ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
const token = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function jsonObject(value, fallback = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeMap(value, defaults) {
  const custom = jsonObject(value);
  return Object.fromEntries(Object.entries({ ...defaults, ...custom }).map(([key, item]) => [token(key), item]));
}

function roundDown(value, increment) {
  const step = Number(increment);
  if (!(step > 0)) return Number(value);
  const precision = Math.min(10, Math.max(0, (String(step).split(".")[1] || "").length));
  return Number((Math.floor((Number(value) + 1e-12) / step) * step).toFixed(precision));
}

function maskedAccount(accountId) {
  const value = String(accountId || "");
  return value ? `••••${value.slice(-4)}` : "—";
}

function validLevels(signal) {
  const side = String(signal.signal || signal.side || "").toUpperCase();
  const entry = Number(signal.price ?? signal.entry);
  const stop = Number(signal.sl);
  const targets = [Number(signal.tp1), Number(signal.tp2), Number(signal.tp3)];
  if (![entry, stop, ...targets].every(Number.isFinite)) return { valid: false, reason: "Entry, SL și TP1–TP3 trebuie să fie numerice." };
  if (side === "BUY" && !(stop < entry && entry < targets[0] && targets[0] < targets[1] && targets[1] < targets[2])) {
    return { valid: false, reason: "Nivelurile BUY nu sunt ordonate SL < Entry < TP1 < TP2 < TP3." };
  }
  if (side === "SELL" && !(stop > entry && entry > targets[0] && targets[0] > targets[1] && targets[1] > targets[2])) {
    return { valid: false, reason: "Nivelurile SELL nu sunt ordonate SL > Entry > TP1 > TP2 > TP3." };
  }
  if (!["BUY", "SELL"].includes(side)) return { valid: false, reason: "Direcția trebuie să fie BUY sau SELL." };
  return { valid: true, side, entry, stop, targets, riskDistance: Math.abs(entry - stop) };
}

function createCapitalClient(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || global.fetch;
  const now = options.now || (() => Date.now());
  if (typeof fetchImpl !== "function") throw new Error("Runtime-ul nu oferă fetch pentru Capital.com.");

  const environment = String(env.CAPITAL_ENVIRONMENT || "DEMO").trim().toUpperCase() === "LIVE" ? "LIVE" : "DEMO";
  const enabled = truthy(env.CAPITAL_AUTO_TRADING_ENABLED);
  const liveConfirmed = String(env.CAPITAL_LIVE_TRADING_CONFIRMED || "") === "I_UNDERSTAND_LIVE_RISK";
  const apiKey = String(env.CAPITAL_API_KEY || "").trim();
  const identifier = String(env.CAPITAL_API_IDENTIFIER || "").trim();
  const password = String(env.CAPITAL_API_PASSWORD || "");
  const accountId = String(env.CAPITAL_ACCOUNT_ID || "").trim();
  const allowedSymbols = new Set(String(env.CAPITAL_ALLOWED_SYMBOLS || "US30,NAS100,XAUUSD,GER40,USOIL").split(",").map(token).filter(Boolean));
  const epicMap = normalizeMap(env.CAPITAL_EPIC_MAP, DEFAULT_EPICS);
  const maxSizeMap = normalizeMap(env.CAPITAL_MAX_SIZE_BY_SYMBOL, DEFAULT_MAX_SIZE);
  const minScore = clamp(env.CAPITAL_MIN_ADAPTIVE_SCORE, 50, 99, 85);
  const maxNewsRisk = clamp(env.CAPITAL_MAX_NEWS_RISK, 0, 100, 75);
  const riskPercent = clamp(env.CAPITAL_RISK_PERCENT, 0.01, 1, 0.2);
  const maxDailyOrders = Math.floor(clamp(env.CAPITAL_MAX_DAILY_SIGNALS, 1, 50, 3));
  const maxOpenPositions = Math.floor(clamp(env.CAPITAL_MAX_OPEN_POSITIONS, 3, 100, 12));
  const maxEntrySlippageR = clamp(env.CAPITAL_MAX_ENTRY_SLIPPAGE_R, 0.01, 1, 0.15);
  const maxSpreadR = clamp(env.CAPITAL_MAX_SPREAD_R, 0.01, 1, 0.1);
  const guaranteedStop = truthy(env.CAPITAL_GUARANTEED_STOP);
  const configured = Boolean(apiKey && identifier && password);
  const baseUrl = environment === "LIVE"
    ? "https://api-capital.backend-capital.com/api/v1"
    : "https://demo-api-capital.backend-capital.com/api/v1";

  let session = null;
  // Capital.com limitează POST /session la o cerere pe secundă. Mai multe
  // operații pot avea nevoie simultan de prima sesiune (de exemplu conturi și
  // poziții), de aceea toate așteaptă aceeași autentificare în curs.
  let sessionPromise = null;
  let lastConnectionAt = null;
  let lastExecutionAt = null;
  let lastResult = "Nicio conexiune Capital.com după pornire.";
  let lastError = "";
  const marketCache = new Map();
  const inFlightSignals = new Set();

  function publicStatus() {
    const liveGateOpen = environment === "DEMO" || liveConfirmed;
    return {
      provider: "Capital.com",
      enabled,
      configured,
      environment,
      liveConfirmed,
      canTrade: enabled && configured && liveGateOpen,
      allowedSymbols: [...allowedSymbols],
      minAdaptiveScore: minScore,
      maxNewsRisk,
      riskPercent,
      maxDailySignals: maxDailyOrders,
      maxOpenPositions,
      splitTargets: ["TP1", "TP2", "TP3"],
      lastConnectionAt,
      lastExecutionAt,
      lastResult,
      lastError
    };
  }

  async function rawRequest(path, { method = "GET", body, headers = {}, timeoutMs = 9000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers: { accept: "application/json", ...headers, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const text = await response.text();
      let data = {};
      if (text) {
        try { data = JSON.parse(text); }
        catch { data = { message: text.slice(0, 300) }; }
      }
      if (!response.ok) {
        const code = data.errorCode || data.error || data.message || `HTTP ${response.status}`;
        const error = new Error(`Capital.com: ${code}`);
        error.status = response.status;
        error.code = data.errorCode || "CAPITAL_HTTP_ERROR";
        throw error;
      }
      return { data, headers: response.headers, status: response.status };
    } catch (error) {
      if (error.name === "AbortError") throw new Error("Capital.com nu a răspuns în intervalul de siguranță.");
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
    if (!cst || !securityToken) throw new Error("Capital.com nu a returnat tokenurile sesiunii.");
    session = {
      cst,
      securityToken,
      createdAt: now(),
      lastUsedAt: now(),
      currentAccountId: response.data.currentAccountId || "",
      accountInfo: response.data.accountInfo || {},
      currency: response.data.currencyIsoCode || ""
    };
    if (accountId && session.currentAccountId !== accountId) {
      await authenticatedRequest("/session", { method: "PUT", body: { accountId }, retryAuth: false });
      session.currentAccountId = accountId;
    }
    lastConnectionAt = new Date(now()).toISOString();
    lastError = "";
    return session;
  }

  async function ensureSession() {
    if (session && now() - session.lastUsedAt < 8 * 60 * 1000) return session;
    if (sessionPromise) return sessionPromise;
    sessionPromise = createSession();
    try {
      return await sessionPromise;
    } finally {
      sessionPromise = null;
    }
  }

  async function authenticatedRequest(path, { method = "GET", body, retryAuth = true, timeoutMs } = {}) {
    await ensureSession();
    try {
      const response = await rawRequest(path, {
        method,
        body,
        timeoutMs,
        headers: { CST: session.cst, "X-SECURITY-TOKEN": session.securityToken }
      });
      session.lastUsedAt = now();
      return response;
    } catch (error) {
      if (retryAuth && [401, 403].includes(error.status) && ["GET", "PUT"].includes(method)) {
        session = null;
        await createSession();
        return authenticatedRequest(path, { method, body, retryAuth: false, timeoutMs });
      }
      throw error;
    }
  }

  async function accountContext() {
    const [accountsResponse, positionsResponse] = await Promise.all([
      authenticatedRequest("/accounts"),
      authenticatedRequest("/positions")
    ]);
    const accounts = Array.isArray(accountsResponse.data.accounts) ? accountsResponse.data.accounts : [];
    const selected = accounts.find(item => item.accountId === (accountId || session.currentAccountId))
      || accounts.find(item => item.preferred)
      || accounts[0];
    if (!selected) throw new Error("Capital.com nu a returnat niciun cont activ.");
    const balance = Number(selected.balance?.balance);
    const available = Number(selected.balance?.available);
    if (!(balance > 0)) throw new Error("Soldul contului Capital.com nu permite calculul riscului.");
    return {
      accountId: selected.accountId,
      accountLabel: maskedAccount(selected.accountId),
      currency: selected.currency || "",
      balance,
      available: Number.isFinite(available) ? available : 0,
      positions: Array.isArray(positionsResponse.data.positions) ? positionsResponse.data.positions : []
    };
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
      } catch (error) {
        if (error.status !== 404 && error.status !== 400) throw error;
      }
    }
    const searchTerm = SEARCH_TERMS[symbol] || symbol;
    const found = await authenticatedRequest(`/markets?searchTerm=${encodeURIComponent(searchTerm)}`);
    const markets = Array.isArray(found.data.markets) ? found.data.markets : [];
    const ranked = markets.map(market => ({ market, score: marketScore(symbol, market) })).sort((a, b) => b.score - a.score);
    if (!ranked.length || ranked[0].score < 10) {
      throw new Error(`Nu s-a putut identifica fără ambiguitate instrumentul Capital.com pentru ${symbol}. Configurează CAPITAL_EPIC_MAP.`);
    }
    const epic = ranked[0].market.epic;
    const details = await authenticatedRequest(`/markets/${encodeURIComponent(epic)}`);
    const result = { epic, ...details.data };
    marketCache.set(symbol, result);
    return result;
  }

  function validateSignalEligibility(signal) {
    const externalId = String(signal.external_id || "");
    const source = String(signal.signal_source || "").toUpperCase();
    const symbol = token(signal.symbol);
    const score = Number(signal.adaptive_score ?? signal.score);
    const newsRisk = Number(signal.news_risk || 0);
    if (!externalId.startsWith("SMC-LIVE-") || !source.startsWith("SMC")) return { valid: false, reason: "Execuția automată acceptă exclusiv activări SMC LIVE." };
    if (String(signal.execution_mode || "").toUpperCase() !== "LIVE") return { valid: false, reason: "Semnalul nu este eligibil LIVE." };
    if (!allowedSymbols.has(symbol)) return { valid: false, reason: `${symbol} nu este în lista instrumentelor permise.` };
    if (!(score >= minScore)) return { valid: false, reason: `Scorul ${Number.isFinite(score) ? score.toFixed(2) : "0"} este sub pragul Capital.com ${minScore}.` };
    if (newsRisk > maxNewsRisk) return { valid: false, reason: `Riscul de știri ${newsRisk}/100 depășește limita ${maxNewsRisk}.` };
    const levels = validLevels(signal);
    if (!levels.valid) return levels;
    return { valid: true, symbol, score, newsRisk, ...levels };
  }

  function distanceAllowed(rule, distance, referencePrice) {
    if (!rule || !Number.isFinite(Number(rule.value))) return true;
    const required = String(rule.unit || "").toUpperCase() === "PERCENTAGE"
      ? Math.abs(referencePrice) * Number(rule.value) / 100
      : Number(rule.value);
    return distance + 1e-12 >= required;
  }

  async function previewSignal(signal, { dailyExecutedCount = 0 } = {}) {
    const eligibility = validateSignalEligibility(signal);
    if (!eligibility.valid) throw new Error(eligibility.reason);
    if (Number(dailyExecutedCount) >= maxDailyOrders) throw new Error(`Limita de ${maxDailyOrders} semnale executate astăzi a fost atinsă.`);

    const [account, market] = await Promise.all([accountContext(), resolveMarket(eligibility.symbol)]);
    const instrument = market.instrument || market.market || {};
    const snapshot = market.snapshot || market.market || {};
    const rules = market.dealingRules || {};
    const epic = market.epic || instrument.epic;
    const marketStatus = snapshot.marketStatus || instrument.marketStatus || market.marketStatus;
    if (marketStatus && marketStatus !== "TRADEABLE") throw new Error(`${eligibility.symbol} nu este tranzacționabil acum (${marketStatus}).`);
    if (account.positions.length + 3 > maxOpenPositions) throw new Error(`Ar fi depășită limita de ${maxOpenPositions} poziții Capital.com deschise.`);
    const sameMarket = account.positions.some(item => String(item.market?.epic || "") === String(epic));
    if (sameMarket) throw new Error(`Există deja o poziție Capital.com deschisă pe ${eligibility.symbol}.`);

    const brokerEntry = eligibility.side === "BUY" ? Number(snapshot.offer) : Number(snapshot.bid);
    if (!Number.isFinite(brokerEntry)) throw new Error(`Capital.com nu a returnat un preț executabil pentru ${eligibility.symbol}.`);
    const bid = Number(snapshot.bid), offer = Number(snapshot.offer);
    const spread = Number.isFinite(bid) && Number.isFinite(offer) ? Math.max(0, offer - bid) : 0;
    if (spread > eligibility.riskDistance * maxSpreadR) throw new Error(`Spreadul Capital.com este prea mare (${spread.toFixed(5)}, peste ${maxSpreadR}R).`);
    const entryDifferenceR = Math.abs(brokerEntry - eligibility.entry) / eligibility.riskDistance;
    if (entryDifferenceR > maxEntrySlippageR) throw new Error(`Prețul brokerului s-a îndepărtat cu ${entryDifferenceR.toFixed(2)}R de Entry; ordinul este anulat.`);
    if (!distanceAllowed(rules.minStopOrProfitDistance, Math.abs(brokerEntry - eligibility.stop), brokerEntry)) {
      throw new Error("SL-ul este mai apropiat decât distanța minimă permisă de Capital.com.");
    }
    for (const target of eligibility.targets) {
      if (!distanceAllowed(rules.minStopOrProfitDistance, Math.abs(brokerEntry - target), brokerEntry)) {
        throw new Error("Cel puțin un TP este mai apropiat decât distanța minimă permisă de Capital.com.");
      }
    }

    const minDealSize = Math.max(0, Number(rules.minDealSize?.value || 0));
    const increment = Math.max(0.000001, Number(rules.minSizeIncrement?.value || minDealSize || 0.001));
    const brokerMax = Number(rules.maxDealSize?.value);
    const configuredMax = Number(maxSizeMap[eligibility.symbol]);
    const maxSize = Math.min(
      Number.isFinite(brokerMax) && brokerMax > 0 ? brokerMax : Number.POSITIVE_INFINITY,
      Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : Number.POSITIVE_INFINITY
    );
    const riskAmountLimit = account.balance * riskPercent / 100;
    const rawTotalSize = Math.min(riskAmountLimit / eligibility.riskDistance, maxSize);
    const sliceSize = roundDown(rawTotalSize / 3, increment);
    if (!(sliceSize >= minDealSize && sliceSize > 0)) {
      throw new Error(`Mărimea calculată nu permite trei poziții TP1–TP3 peste minimul brokerului ${minDealSize}. Semnalul nu este executat.`);
    }
    const totalSize = Number((sliceSize * 3).toFixed(10));
    const estimatedRiskAmount = totalSize * eligibility.riskDistance;
    if (estimatedRiskAmount > riskAmountLimit * 1.001) throw new Error("Mărimea rotunjită depășește riscul maxim permis.");

    return {
      externalId: String(signal.external_id),
      symbol: eligibility.symbol,
      side: eligibility.side,
      score: eligibility.score,
      newsRisk: eligibility.newsRisk,
      epic,
      signalEntry: eligibility.entry,
      brokerEntry,
      stopLevel: eligibility.stop,
      targets: eligibility.targets,
      sliceSize,
      totalSize,
      riskPercent,
      riskAmountLimit,
      estimatedRiskAmount,
      accountId: account.accountId,
      accountLabel: account.accountLabel,
      accountCurrency: account.currency,
      balance: account.balance,
      spread,
      entryDifferenceR,
      guaranteedStop
    };
  }

  async function confirmDeal(dealReference) {
    let confirmation = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await sleep(250 * attempt);
      const response = await authenticatedRequest(`/confirms/${encodeURIComponent(dealReference)}`, { retryAuth: false });
      confirmation = response.data;
      if (confirmation.dealStatus) break;
    }
    if (!confirmation || confirmation.dealStatus !== "ACCEPTED") {
      throw new Error(`Capital.com a respins ordinul ${dealReference}: ${confirmation?.reason || confirmation?.dealStatus || "confirmare absentă"}.`);
    }
    const dealId = confirmation.dealId || confirmation.affectedDeals?.find(item => item.status === "OPENED")?.dealId || confirmation.affectedDeals?.[0]?.dealId;
    if (!dealId) throw new Error(`Capital.com a acceptat ${dealReference}, dar nu a furnizat dealId.`);
    return { ...confirmation, dealId };
  }

  async function openSlice(preview, target, targetName) {
    const response = await authenticatedRequest("/positions", {
      method: "POST",
      retryAuth: false,
      body: {
        epic: preview.epic,
        direction: preview.side,
        size: preview.sliceSize,
        guaranteedStop: preview.guaranteedStop,
        stopLevel: preview.stopLevel,
        profitLevel: target
      }
    });
    const dealReference = response.data.dealReference;
    if (!dealReference) throw new Error(`Capital.com nu a returnat dealReference pentru ${targetName}.`);
    const confirmation = await confirmDeal(dealReference);
    return {
      target: targetName,
      targetLevel: target,
      size: preview.sliceSize,
      dealReference,
      dealId: confirmation.dealId,
      acceptedLevel: Number(confirmation.level),
      dealStatus: confirmation.dealStatus
    };
  }

  async function closePosition(dealId) {
    const response = await authenticatedRequest(`/positions/${encodeURIComponent(dealId)}`, { method: "DELETE", retryAuth: false });
    const reference = response.data.dealReference;
    if (reference) await confirmDeal(reference).catch(() => null);
    return response.data;
  }

  async function updateStop(dealId, stopLevel) {
    const response = await authenticatedRequest(`/positions/${encodeURIComponent(dealId)}`, {
      method: "PUT",
      retryAuth: false,
      body: { guaranteedStop, stopLevel: Number(stopLevel) }
    });
    const reference = response.data.dealReference;
    if (reference) await confirmDeal(reference);
    return { dealId, stopLevel: Number(stopLevel), dealReference: reference || null };
  }

  async function executeSignal(signal, context = {}) {
    const externalId = String(signal.external_id || "");
    if (!enabled) return { status: "DISABLED", externalId, reason: "CAPITAL_AUTO_TRADING_ENABLED este false." };
    if (!configured) return { status: "NOT_CONFIGURED", externalId, reason: "Credențialele API Capital.com nu sunt configurate complet." };
    if (environment === "LIVE" && !liveConfirmed) return { status: "LIVE_LOCKED", externalId, reason: "Pentru LIVE lipsește confirmarea explicită CAPITAL_LIVE_TRADING_CONFIRMED." };
    if (inFlightSignals.has(externalId)) return { status: "DUPLICATE", externalId, reason: "Semnalul este deja în curs de execuție." };

    inFlightSignals.add(externalId);
    const opened = [];
    try {
      const preview = await previewSignal(signal, context);
      for (let index = 0; index < preview.targets.length; index++) {
        opened.push(await openSlice(preview, preview.targets[index], `TP${index + 1}`));
      }
      lastExecutionAt = new Date(now()).toISOString();
      lastResult = `${preview.side} ${preview.symbol} executat ${preview.totalSize} în 3 poziții, risc estimat ${preview.estimatedRiskAmount.toFixed(2)} ${preview.accountCurrency}.`;
      lastError = "";
      return { status: "EXECUTED", executedAt: lastExecutionAt, environment, preview, deals: opened };
    } catch (error) {
      const rollback = [];
      for (const deal of [...opened].reverse()) {
        try { await closePosition(deal.dealId); rollback.push({ dealId: deal.dealId, status: "CLOSED" }); }
        catch (closeError) { rollback.push({ dealId: deal.dealId, status: "ERROR", error: closeError.message }); }
      }
      lastExecutionAt = new Date(now()).toISOString();
      lastError = error.message;
      lastResult = `Execuție anulată pentru ${externalId || "semnal fără ID"}: ${error.message}`;
      return { status: opened.length ? "ROLLED_BACK" : "REJECTED", executedAt: lastExecutionAt, environment, externalId, reason: error.message, opened, rollback };
    } finally {
      inFlightSignals.delete(externalId);
    }
  }

  async function testConnection() {
    try {
      const account = await accountContext();
      lastConnectionAt = new Date(now()).toISOString();
      lastResult = `Conexiune ${environment} reușită: cont ${account.accountLabel}, ${account.positions.length} poziții deschise.`;
      lastError = "";
      return {
        ok: true,
        environment,
        account: account.accountLabel,
        currency: account.currency,
        balance: account.balance,
        available: account.available,
        openPositions: account.positions.length,
        tradingEnabled: enabled,
        liveConfirmed
      };
    } catch (error) {
      lastConnectionAt = new Date(now()).toISOString();
      lastError = error.message;
      lastResult = `Conexiune eșuată: ${error.message}`;
      throw error;
    }
  }

  return {
    status: publicStatus,
    testConnection,
    previewSignal,
    executeSignal,
    updateStop,
    closePosition,
    validateSignalEligibility
  };
}

module.exports = {
  createCapitalClient,
  validLevels,
  roundDown,
  DEFAULT_EPICS,
  DEFAULT_MAX_SIZE
};
