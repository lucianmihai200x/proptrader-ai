const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const { getHistoricalRates } = require("dukascopy-node");
const telegram = require("./telegram");
const { buildBacktest, auditBars, aggregateBars } = require("./backtest");
const { fetchOfficialNews } = require("./news_feeds");
const { findSmcSetups, evaluatePendingSetup } = require("./smc");
const { outcomeR } = require("./trade_management");
const { canonicalSymbol, aliasSummary } = require("./symbols");
const {
  SUPPORTED_ANALYSIS_TIMEFRAMES,
  CONTEXT_TIMEFRAMES,
  normalizeTimeframe,
  parseAnalysisTimeframes,
  timeframeLabel,
  profileFor,
  completedHigherTimeframes
} = require("./timeframes");

const app = express();
const APP_VERSION = "18.2.0";
let lastWebhookAt = null;
let lastWebhookResult = "Niciun webhook primit după pornire";
let lastTelegramAt = null;
let lastTelegramResult = "Niciun mesaj Telegram trimis după pornire";
const PORT = process.env.PORT || 3000;
const WEBHOOK_KEY = process.env.WEBHOOK_KEY || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const NEWS_WEBHOOK_KEY = process.env.NEWS_WEBHOOK_KEY || WEBHOOK_KEY;
const DATABASE_URL = process.env.DATABASE_URL || "";
const ARCHIVE_AFTER_HOURS = Math.max(1, Number(process.env.ARCHIVE_AFTER_HOURS || 24));
const PATTERN_MIN_SAMPLES = Math.max(10, Number(process.env.PATTERN_MIN_SAMPLES || 25));
const PATTERN_MIN_PROBABILITY = Math.max(50, Math.min(95, Number(process.env.PATTERN_MIN_PROBABILITY || 68)));
const PATTERN_LOOKBACK_DAYS = Math.max(14, Number(process.env.PATTERN_LOOKBACK_DAYS || 180));
const PATTERN_HORIZON_BARS_OVERRIDE = process.env.PATTERN_HORIZON_BARS === undefined
  ? null
  : Math.max(1, Math.min(24, Number(process.env.PATTERN_HORIZON_BARS)));
const PATTERN_COOLDOWN_MINUTES_OVERRIDE = process.env.PATTERN_COOLDOWN_MINUTES === undefined
  ? null
  : Math.max(5, Number(process.env.PATTERN_COOLDOWN_MINUTES));
const ANALYSIS_TIMEFRAMES = parseAnalysisTimeframes(process.env.ANALYSIS_TIMEFRAMES);
const requestedPrimaryTimeframe = normalizeTimeframe(process.env.ANALYSIS_TIMEFRAME || "15", "15");
const ANALYSIS_TIMEFRAME = ANALYSIS_TIMEFRAMES.includes(requestedPrimaryTimeframe)
  ? requestedPrimaryTimeframe
  : (ANALYSIS_TIMEFRAMES.includes("15") ? "15" : ANALYSIS_TIMEFRAMES[0]);
const FMP_API_KEY = process.env.FMP_API_KEY || "";
const FMP_ENABLED = String(process.env.FMP_ENABLED || "false").toLowerCase() === "true";
const ALPHAVANTAGE_API_KEY = process.env.ALPHAVANTAGE_API_KEY || "";
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "";
const OFFICIAL_NEWS_ENABLED = String(process.env.OFFICIAL_NEWS_ENABLED || "true").toLowerCase() !== "false";
const NEWS_MAX_AGE_HOURS = Math.max(12, Number(process.env.NEWS_MAX_AGE_HOURS || 96));
const NEWS_MIN_RELEVANCE = Math.max(0, Math.min(100, Number(process.env.NEWS_MIN_RELEVANCE || 35)));
const NEWS_AUTO_SYNC_MINUTES = Math.max(15, Number(process.env.NEWS_AUTO_SYNC_MINUTES || 60));
const AUTO_TRACK_TRADES = String(process.env.AUTO_TRACK_TRADES || "true").toLowerCase() !== "false";
const LIVE_MIN_ADAPTIVE_SCORE = Math.max(50, Math.min(95, Number(process.env.LIVE_MIN_ADAPTIVE_SCORE || 72)));
const LEARNING_MIN_SAMPLES = Math.max(10, Number(process.env.LEARNING_MIN_SAMPLES || 30));
const VALIDATION_MIN_TRADES = Math.max(20, Number(process.env.VALIDATION_MIN_TRADES || 60));
const MAX_NEWS_RISK_LIVE = Math.max(0, Math.min(100, Number(process.env.MAX_NEWS_RISK_LIVE || 75)));
const MAX_CONSECUTIVE_LOSSES = Math.max(2, Number(process.env.MAX_CONSECUTIVE_LOSSES || 4));
const AUTO_PATTERN_SIGNALS = String(process.env.AUTO_PATTERN_SIGNALS || "true").toLowerCase() !== "false";
const PATTERN_SIGNAL_MIN_SAMPLES = Math.max(PATTERN_MIN_SAMPLES, Number(process.env.PATTERN_SIGNAL_MIN_SAMPLES || 50));
const PATTERN_SIGNAL_MIN_PROBABILITY = Math.max(PATTERN_MIN_PROBABILITY, Math.min(95, Number(process.env.PATTERN_SIGNAL_MIN_PROBABILITY || 75)));
const PATTERN_SIGNAL_MIN_SCORE = Math.max(50, Math.min(95, Number(process.env.PATTERN_SIGNAL_MIN_SCORE || 85)));
const WEBHOOK_STALE_MINUTES = Math.max(20, Number(process.env.WEBHOOK_STALE_MINUTES || 35));
const SYSTEM_MONITOR_INTERVAL_MINUTES = Math.max(5, Number(process.env.SYSTEM_MONITOR_INTERVAL_MINUTES || 5));
const TELEGRAM_SYSTEM_ALERTS = String(process.env.TELEGRAM_SYSTEM_ALERTS || "true").toLowerCase() !== "false";
const NEWS_UNAVAILABLE_RISK = Math.max(0, Math.min(100, Number(process.env.NEWS_UNAVAILABLE_RISK || 55)));
const NEWS_CALENDAR_UNAVAILABLE_RISK = Math.max(0, Math.min(100, Number(process.env.NEWS_CALENDAR_UNAVAILABLE_RISK || 35)));
const NEWS_COUNTRIES = (process.env.NEWS_COUNTRIES || "US").split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
const SMC_ENABLED = String(process.env.SMC_ENABLED || "true").toLowerCase() !== "false";
const SMC_MIN_SCORE = Math.max(50, Math.min(95, Number(process.env.SMC_MIN_SCORE || 68)));
const SMC_NOTIFY_PENDING_SCORE = Math.max(SMC_MIN_SCORE, Math.min(95, Number(process.env.SMC_NOTIFY_PENDING_SCORE || 78)));
const SMC_REQUIRE_M5_CONFIRMATION = String(process.env.SMC_REQUIRE_M5_CONFIRMATION || "true").toLowerCase() !== "false";
const SMC_MAX_PENDING_PER_SYMBOL = Math.max(3, Math.min(50, Number(process.env.SMC_MAX_PENDING_PER_SYMBOL || 15)));
const SMC_MIN_BLOCK_SAMPLES = Math.max(5, Number(process.env.SMC_MIN_BLOCK_SAMPLES || 8));
let lastNewsSync = null;
let lastSuccessfulNewsSync = null;
let lastNewsSyncError = "";
let lastNewsProviderResults = [];
let lastSuccessfulCalendarSync = null;
let fmpRuntimeDisabledReason = "";
let lastSystemAlertKey = "";
let lastSystemAlertAt = null;
let lastDbCheckAt = null;
let lastDbCheckOk = null;
let lastDbCheckError = "";
const lastBarAtByTimeframe = {};

const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

let memorySignals = [];
let memoryNews = [];
let memoryBars = [];
let memoryPatterns = [];
let memorySmcSetups = [];

let historyDownloadJob = null;
const HISTORY_CHUNK_DAYS = Math.max(7, Math.min(90, Number(process.env.HISTORY_CHUNK_DAYS || 30)));
const HISTORY_RETRY_ATTEMPTS = Math.max(1, Math.min(8, Number(process.env.HISTORY_RETRY_ATTEMPTS || 4)));
const HISTORY_RETRY_BASE_MS = Math.max(500, Number(process.env.HISTORY_RETRY_BASE_MS || 2000));

app.use(express.json({ limit: "25mb" }));
app.use(express.text({ type: ["text/plain", "application/text"], limit: "25mb" }));
app.use(express.static(path.join(__dirname, "public")));

const num = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};
const bool = v => v === true || v === "true" || v === 1 || v === "1";
const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const hoursAgoIso = h => new Date(Date.now() - h * 3600000).toISOString();

function analysisProfile(timeframe) {
  return profileFor(timeframe, {
    horizonBars: PATTERN_HORIZON_BARS_OVERRIDE,
    cooldownMinutes: PATTERN_COOLDOWN_MINUTES_OVERRIDE,
    minSamples: PATTERN_SIGNAL_MIN_SAMPLES,
    minProbability: PATTERN_SIGNAL_MIN_PROBABILITY,
    minScore: PATTERN_SIGNAL_MIN_SCORE
  });
}

function analysisProfilesPublic() {
  return Object.fromEntries(ANALYSIS_TIMEFRAMES.map(timeframe => {
    const profile = analysisProfile(timeframe);
    return [timeframe, {
      label: profile.label,
      horizonBars: profile.horizonBars,
      cooldownMinutes: profile.cooldownMinutes,
      minSamples: profile.minSamples,
      minProbability: profile.minProbability,
      minScore: profile.minScore,
      stopAtr: profile.stopAtr
    }];
  }));
}

function safeJson(v, fallback = {}) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function minutesSince(value) {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, ms / 60000) : null;
}

function marketExpectedOpen(now = new Date()) {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  if (day === 6) return false;
  if (day === 0 && hour < 22) return false;
  if (day === 5 && hour >= 22) return false;
  return true;
}

function newsCoverageStatus() {
  const ageMinutes = minutesSince(lastSuccessfulNewsSync);
  const calendarAgeMinutes = minutesSince(lastSuccessfulCalendarSync);
  const headlineHealthy = ageMinutes !== null && ageMinutes <= NEWS_MAX_AGE_HOURS * 60;
  const calendarHealthy = calendarAgeMinutes !== null && calendarAgeMinutes <= NEWS_MAX_AGE_HOURS * 60;
  return {
    healthy: headlineHealthy,
    headlineHealthy,
    calendarHealthy,
    lastSuccessfulNewsSync,
    lastSuccessfulCalendarSync,
    ageMinutes: ageMinutes === null ? null : Number(ageMinutes.toFixed(1)),
    calendarAgeMinutes: calendarAgeMinutes === null ? null : Number(calendarAgeMinutes.toFixed(1)),
    unavailableRisk: NEWS_UNAVAILABLE_RISK,
    calendarUnavailableRisk: NEWS_CALENDAR_UNAVAILABLE_RISK,
    providers: lastNewsProviderResults,
    error: lastNewsSyncError || ""
  };
}

async function checkDatabase() {
  lastDbCheckAt = new Date().toISOString();
  if (!pool) {
    lastDbCheckOk = true;
    lastDbCheckError = "";
    return { ok: true, mode: "memory", checkedAt: lastDbCheckAt };
  }
  try {
    await pool.query("SELECT 1");
    lastDbCheckOk = true;
    lastDbCheckError = "";
  } catch (error) {
    lastDbCheckOk = false;
    lastDbCheckError = error.message;
  }
  return { ok: lastDbCheckOk, mode: "postgres", checkedAt: lastDbCheckAt, error: lastDbCheckError || undefined };
}

function systemWarnings() {
  const warnings = [];
  const webhookAge = minutesSince(lastWebhookAt);
  if (!lastWebhookAt) {
    warnings.push({ code: "WEBHOOK_WAITING", severity: "info", message: "Se așteaptă primul webhook după pornire." });
  } else if (marketExpectedOpen() && webhookAge > WEBHOOK_STALE_MINUTES) {
    warnings.push({ code: "WEBHOOK_STALE", severity: "critical", message: `Nu s-a primit nicio lumânare de ${Math.round(webhookAge)} minute.` });
  }
  if (lastDbCheckOk === false) warnings.push({ code: "DATABASE_DOWN", severity: "critical", message: `Baza de date nu răspunde: ${lastDbCheckError}` });
  if (!telegram.status().configured) warnings.push({ code: "TELEGRAM_OFF", severity: "warning", message: "Telegram nu este configurat complet." });
  const news = newsCoverageStatus();
  if (!news.healthy) warnings.push({ code: "NEWS_COVERAGE", severity: "warning", message: lastNewsSyncError ? `Filtrul de știri este degradat: ${lastNewsSyncError}` : "Nu există o sincronizare recentă și reușită a știrilor." });
  else if (!news.calendarHealthy) warnings.push({ code: "NEWS_CALENDAR", severity: "warning", message: `Fluxurile oficiale sunt active, dar calendarul economic anticipat nu este disponibil; se aplică risc de siguranță ${NEWS_CALENDAR_UNAVAILABLE_RISK}/100.` });
  if (telegram.MIN_SCORE > LIVE_MIN_ADAPTIVE_SCORE) warnings.push({ code: "THRESHOLD_GAP", severity: "info", message: `Semnalele LIVE între ${LIVE_MIN_ADAPTIVE_SCORE} și ${telegram.MIN_SCORE - 1} rămân în aplicație, fără notificare Telegram.` });
  return warnings;
}

async function buildSystemStatus() {
  const database = await checkDatabase();
  const webhookAge = minutesSince(lastWebhookAt);
  return {
    ok: database.ok,
    version: APP_VERSION,
    database,
    webhook: {
      lastAt: lastWebhookAt,
      lastResult: lastWebhookResult,
      ageMinutes: webhookAge === null ? null : Number(webhookAge.toFixed(1)),
      staleAfterMinutes: WEBHOOK_STALE_MINUTES,
      marketExpectedOpen: marketExpectedOpen()
    },
    telegram: { ...telegram.status(), lastAt: lastTelegramAt, lastResult: lastTelegramResult },
    news: newsCoverageStatus(),
    autoPatternSignals: {
      enabled: AUTO_PATTERN_SIGNALS,
      minSamples: PATTERN_SIGNAL_MIN_SAMPLES,
      minProbability: PATTERN_SIGNAL_MIN_PROBABILITY,
      minScore: PATTERN_SIGNAL_MIN_SCORE,
      analysisTimeframes: ANALYSIS_TIMEFRAMES,
      profiles: analysisProfilesPublic()
    },
    smc: {
      enabled: SMC_ENABLED,
      minScore: SMC_MIN_SCORE,
      pendingNotificationScore: SMC_NOTIFY_PENDING_SCORE,
      requireM5Confirmation: SMC_REQUIRE_M5_CONFIRMATION,
      contextTimeframes: CONTEXT_TIMEFRAMES
    },
    symbolAliases: aliasSummary(),
    lastBarAtByTimeframe: { ...lastBarAtByTimeframe },
    warnings: systemWarnings(),
    checkedAt: new Date().toISOString()
  };
}

async function monitorSystem() {
  const status = await buildSystemStatus();
  const critical = status.warnings.filter(item => item.severity === "critical");
  const key = critical.map(item => item.code).sort().join("|");
  if (!TELEGRAM_SYSTEM_ALERTS || !telegram.status().configured) {
    lastSystemAlertKey = key;
    return status;
  }
  if (key && key !== lastSystemAlertKey) {
    const message = critical.map(item => `• ${item.message}`).join("\n");
    const result = await telegram.sendSystemAlert(`⚠️ <b>PropTrader AI — problemă sistem</b>\n\n${message}`);
    lastSystemAlertAt = new Date().toISOString();
    await logTelegram({ status: "SYSTEM_ALERT", messageId: result.message_id, details: message });
  } else if (!key && lastSystemAlertKey) {
    const result = await telegram.sendSystemAlert("✅ <b>PropTrader AI — sistem restabilit</b>\n\nWebhook-ul și baza de date funcționează din nou.");
    lastSystemAlertAt = new Date().toISOString();
    await logTelegram({ status: "SYSTEM_RECOVERY", messageId: result.message_id, details: "Sistem restabilit" });
  }
  lastSystemAlertKey = key;
  return status;
}

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS signals (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      symbol TEXT NOT NULL,
      signal TEXT NOT NULL
    )
  `);

  const columns = [
    ["external_id", "TEXT"], ["closed_at", "TIMESTAMPTZ"], ["archived_at", "TIMESTAMPTZ"],
    ["timeframe", "TEXT"], ["status", "TEXT NOT NULL DEFAULT 'OPEN'"], ["result", "TEXT"],
    ["price", "NUMERIC"], ["sl", "NUMERIC"], ["tp1", "NUMERIC"], ["tp2", "NUMERIC"],
    ["tp3", "NUMERIC"], ["exit_price", "NUMERIC"], ["pnl_r", "NUMERIC"], ["score", "NUMERIC"],
    ["probability", "NUMERIC"], ["adaptive_score", "NUMERIC"], ["learning_adjustment", "NUMERIC DEFAULT 0"],
    ["rsi", "NUMERIC"], ["atr", "NUMERIC"], ["rr", "NUMERIC"], ["trend", "TEXT"],
    ["structure", "TEXT"], ["session_name", "TEXT"], ["mtf_trend", "TEXT"], ["vwap_side", "TEXT"],
    ["order_block", "TEXT"], ["bos", "BOOLEAN DEFAULT FALSE"], ["choch", "BOOLEAN DEFAULT FALSE"],
    ["fvg", "BOOLEAN DEFAULT FALSE"], ["liquidity_sweep", "BOOLEAN DEFAULT FALSE"],
    ["vwap_confirm", "BOOLEAN DEFAULT FALSE"], ["mtf_confirm", "BOOLEAN DEFAULT FALSE"],
    ["order_block_confirm", "BOOLEAN DEFAULT FALSE"], ["market_phase", "TEXT"],
    ["equal_highs", "BOOLEAN DEFAULT FALSE"], ["equal_lows", "BOOLEAN DEFAULT FALSE"],
    ["premium_discount", "TEXT"], ["fib_zone", "TEXT"], ["fvg_state", "TEXT"], ["ob_state", "TEXT"],
    ["kill_zone", "TEXT"], ["score_breakdown", "JSONB"], ["reason", "TEXT"],
    ["news_risk", "INTEGER DEFAULT 0"], ["news_bias", "TEXT DEFAULT 'NEUTRAL'"],
    ["news_summary", "TEXT"], ["setup_key", "TEXT"],
    ["max_favorable_price", "NUMERIC"], ["max_adverse_price", "NUMERIC"], ["auto_closed", "BOOLEAN DEFAULT FALSE"],
    ["execution_mode", "TEXT DEFAULT 'WATCH'"], ["quality_score", "NUMERIC DEFAULT 0"],
    ["confidence_lower", "NUMERIC DEFAULT 0"], ["decision_reason", "TEXT"], ["regime", "TEXT DEFAULT 'UNKNOWN'"],
    ["signal_source", "TEXT DEFAULT 'WEBHOOK'"],
    ["tp1_hit_at", "TIMESTAMPTZ"], ["tp2_hit_at", "TIMESTAMPTZ"], ["tp3_hit_at", "TIMESTAMPTZ"],
    ["best_target", "TEXT"], ["managed_stop", "NUMERIC"]
  ];
  for (const [name, type] of columns) {
    await pool.query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS signals_external_id_unique ON signals (external_id) WHERE external_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS signals_received_idx ON signals (received_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS signals_archive_idx ON signals (archived_at, received_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_events (
      id BIGSERIAL PRIMARY KEY,
      external_id TEXT,
      published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      title TEXT NOT NULL,
      summary TEXT,
      source TEXT,
      url TEXT,
      symbols TEXT[] DEFAULT '{}',
      impact INTEGER NOT NULL DEFAULT 0,
      bias TEXT NOT NULL DEFAULT 'NEUTRAL',
      category TEXT,
      raw JSONB
    )
  `);
  for (const [name, type] of [["provider","TEXT"],["sentiment","NUMERIC"],["relevance","INTEGER DEFAULT 50"],["confidence","INTEGER DEFAULT 50"],["scheduled","BOOLEAN DEFAULT FALSE"]]) {
    await pool.query(`ALTER TABLE news_events ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS news_external_id_unique ON news_events (external_id) WHERE external_id IS NOT NULL`);
  await pool.query(`CREATE INDEX IF NOT EXISTS news_published_idx ON news_events (published_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_bars (
      id BIGSERIAL PRIMARY KEY,
      external_id TEXT UNIQUE,
      bar_time TIMESTAMPTZ NOT NULL,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      open NUMERIC NOT NULL,
      high NUMERIC NOT NULL,
      low NUMERIC NOT NULL,
      close NUMERIC NOT NULL,
      volume NUMERIC DEFAULT 0
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS market_bars_lookup_idx ON market_bars(symbol,timeframe,bar_time DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pattern_signals (
      id BIGSERIAL PRIMARY KEY,
      external_id TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      side TEXT NOT NULL,
      entry NUMERIC NOT NULL,
      sl NUMERIC,
      tp1 NUMERIC,
      tp2 NUMERIC,
      tp3 NUMERIC,
      samples INTEGER NOT NULL,
      probability NUMERIC NOT NULL,
      avg_move_pct NUMERIC NOT NULL,
      median_move_pct NUMERIC NOT NULL,
      time_bucket TEXT NOT NULL,
      weekday INTEGER,
      horizon_bars INTEGER NOT NULL,
      trend_confirmed BOOLEAN DEFAULT FALSE,
      news_risk INTEGER DEFAULT 0,
      status TEXT DEFAULT 'CANDIDATE',
      reason TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS pattern_signals_created_idx ON pattern_signals(created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS smc_setups (
      id BIGSERIAL PRIMARY KEY,
      external_id TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      triggered_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      side TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      entry NUMERIC NOT NULL,
      zone_low NUMERIC NOT NULL,
      zone_high NUMERIC NOT NULL,
      sl NUMERIC NOT NULL,
      tp1 NUMERIC NOT NULL,
      tp2 NUMERIC NOT NULL,
      tp3 NUMERIC NOT NULL,
      current_price NUMERIC,
      score NUMERIC NOT NULL,
      adaptive_score NUMERIC NOT NULL,
      historical_probability NUMERIC,
      learning_samples INTEGER DEFAULT 0,
      news_risk INTEGER DEFAULT 0,
      d1_bias TEXT,
      h4_bias TEXT,
      local_bias TEXT,
      structure_event TEXT,
      broken_level NUMERIC,
      order_block_time TIMESTAMPTZ,
      displacement BOOLEAN DEFAULT FALSE,
      fvg BOOLEAN DEFAULT FALSE,
      fvg_low NUMERIC,
      fvg_high NUMERIC,
      liquidity_sweep BOOLEAN DEFAULT FALSE,
      sweep_level NUMERIC,
      premium_discount TEXT,
      mitigations INTEGER DEFAULT 0,
      touch_count INTEGER DEFAULT 0,
      volume_confirmed BOOLEAN DEFAULT FALSE,
      model_key TEXT,
      score_breakdown JSONB,
      features JSONB,
      reason TEXT,
      pending_notified BOOLEAN DEFAULT FALSE,
      signal_external_id TEXT,
      terminal_reason TEXT
    )
  `);
  for (const [name, type] of [["result", "TEXT"], ["pnl_r", "NUMERIC"]]) {
    await pool.query(`ALTER TABLE smc_setups ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS smc_setups_pending_idx ON smc_setups(symbol,status,expires_at)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS smc_setups_created_idx ON smc_setups(created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS backtest_runs (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      bars INTEGER NOT NULL,
      start_time TIMESTAMPTZ,
      end_time TIMESTAMPTZ,
      settings JSONB,
      summary JSONB,
      results JSONB
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS backtest_runs_created_idx ON backtest_runs(created_at DESC)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS telegram_logs (
      id BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      external_id TEXT,
      symbol TEXT,
      side TEXT,
      status TEXT NOT NULL,
      message_id TEXT,
      details TEXT
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS telegram_logs_created_idx ON telegram_logs(created_at DESC)`);
  const newsState = await pool.query(`SELECT MAX(received_at) AS last_received FROM news_events`);
  if (newsState.rows[0]?.last_received) lastSuccessfulNewsSync = new Date(newsState.rows[0].last_received).toISOString();
  const calendarState = await pool.query(`SELECT MAX(received_at) AS last_received FROM news_events WHERE scheduled=TRUE`);
  if (calendarState.rows[0]?.last_received) lastSuccessfulCalendarSync = new Date(calendarState.rows[0].last_received).toISOString();
}

function setupKey(p) {
  const explicit = clean(p.setup_key || p.model_key, 300);
  if (explicit) return explicit;
  return [
    canonicalSymbol(p.symbol || "N/A", "N/A"), clean(p.signal || p.side || "WAIT", 10).toUpperCase(),
    normalizeTimeframe(p.timeframe || p.interval, "N/A"),
    clean(p.session || p.session_name || "N/A", 40), clean(p.structure || "N/A", 80),
    bool(p.bos) ? "BOS" : "", bool(p.choch) ? "CHOCH" : "", bool(p.fvg) ? "FVG" : "",
    bool(p.liquidity_sweep || p.sweep) ? "SWEEP" : "", bool(p.vwap_confirm) ? "VWAP" : "",
    bool(p.mtf_confirm) ? "MTF" : ""
  ].filter(Boolean).join("|").slice(0, 300);
}

function normalizeSignal(p) {
  const score = Math.max(0, Math.min(100, num(p.score, 50)));
  const externalId = clean(p.external_id || p.signal_id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 120);
  const signalSource = clean(
    p.signal_source ||
      (externalId.startsWith("SMC-LIVE-") ? "SMC_LIVE" :
        externalId.startsWith("AUTO-") ? "MODEL_ISTORIC" :
          (externalId.startsWith("TEST-") || externalId.startsWith("TELEGRAM-TEST-")) ? "TEST" : "WEBHOOK"),
    30
  ).toUpperCase();
  return {
    external_id: externalId,
    signal_source: signalSource,
    received_at: new Date().toISOString(), symbol: canonicalSymbol(p.symbol || p.ticker || "N/A", "N/A"),
    timeframe: normalizeTimeframe(p.timeframe || p.interval, ANALYSIS_TIMEFRAME), signal: clean(p.signal || p.side || "WAIT", 10).toUpperCase(),
    status: "OPEN", price: num(p.price ?? p.close), sl: num(p.sl), tp1: num(p.tp1 ?? p.tp), tp2: num(p.tp2), tp3: num(p.tp3),
    score, probability: Math.max(0, Math.min(100, num(p.probability, score))), adaptive_score: score, learning_adjustment: 0,
    rsi: num(p.rsi), atr: num(p.atr), rr: num(p.rr), trend: clean(p.trend, 50), structure: clean(p.structure, 120),
    session_name: clean(p.session || p.session_name, 50), mtf_trend: clean(p.mtf_trend, 50), vwap_side: clean(p.vwap_side, 50),
    order_block: clean(p.order_block, 100), bos: bool(p.bos), choch: bool(p.choch), fvg: bool(p.fvg),
    liquidity_sweep: bool(p.liquidity_sweep || p.sweep), vwap_confirm: bool(p.vwap_confirm), mtf_confirm: bool(p.mtf_confirm),
    order_block_confirm: bool(p.order_block_confirm), market_phase: clean(p.market_phase, 40), equal_highs: bool(p.equal_highs),
    equal_lows: bool(p.equal_lows), premium_discount: clean(p.premium_discount, 40), fib_zone: clean(p.fib_zone, 60),
    fvg_state: clean(p.fvg_state, 50), ob_state: clean(p.ob_state, 50), kill_zone: clean(p.kill_zone, 50),
    score_breakdown: safeJson(p.score_breakdown), reason: clean(p.reason || p.setup, 2200), setup_key: setupKey(p),
    news_risk: 0, news_bias: "NEUTRAL", news_summary: ""
  };
}

function validateSignalLevels(signal) {
  const side = String(signal.signal || "").toUpperCase();
  const entry = num(signal.price, NaN);
  const sl = num(signal.sl, NaN);
  const tp1 = num(signal.tp1, NaN);
  const tp2 = num(signal.tp2, NaN);
  const tp3 = num(signal.tp3, NaN);
  if (!["BUY", "SELL"].includes(side)) throw new Error("Semnalul trebuie să fie BUY sau SELL");
  if (![entry, sl, tp1, tp2, tp3].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("Semnalul necesită Entry, SL, TP1, TP2 și TP3 pozitive");
  }
  const valid = side === "BUY"
    ? sl < entry && entry < tp1 && tp1 < tp2 && tp2 < tp3
    : sl > entry && entry > tp1 && tp1 > tp2 && tp2 > tp3;
  if (!valid) throw new Error(`Niveluri ${side} invalide: verifică ordinea SL, Entry și TP1–TP3`);
  return signal;
}

function newsSymbols(text) {
  const t = text.toUpperCase();
  const out = new Set();
  if (/DOW|US30|DJIA|WALL STREET|FED|FOMC|CPI|NFP|JOBS|INFLATION|INTEREST RATE/.test(t)) out.add("US30");
  if (/NASDAQ|NAS100|NDX|TECH STOCK|SEMICONDUCTOR/.test(t)) out.add("NAS100");
  if (/GOLD|XAU|BULLION|METAL|FED|FOMC|CPI|INFLATION|DOLLAR|TREASURY/.test(t)) out.add("XAUUSD");
  return [...out];
}

function analyzeNewsText(title, summary = "") {
  const text = `${title} ${summary}`.toLowerCase();
  let impact = 15;
  let category = "GENERAL";
  const high = ["fomc", "federal reserve", "interest rate", "rate decision", "cpi", "inflation", "nonfarm", "nfp", "payroll", "unemployment", "gdp", "pce", "powell", "war", "missile", "sanction", "tariff", "bank crisis"];
  const medium = ["jobless claims", "retail sales", "consumer confidence", "ism", "pmi", "treasury yield", "dollar index", "earnings", "oil price"];
  if (high.some(k => text.includes(k))) impact = 90;
  else if (medium.some(k => text.includes(k))) impact = 60;
  else if (/breaking|unexpected|surprise|emergency|record/.test(text)) impact = 45;

  if (/fomc|federal reserve|interest rate|powell/.test(text)) category = "CENTRAL_BANK";
  else if (/cpi|inflation|pce/.test(text)) category = "INFLATION";
  else if (/nonfarm|nfp|payroll|unemployment|jobless/.test(text)) category = "LABOR";
  else if (/war|missile|sanction|tariff/.test(text)) category = "GEOPOLITICAL";
  else if (/earnings/.test(text)) category = "EARNINGS";

  const positive = ["beats", "stronger", "growth", "rally", "easing", "rate cut", "cooling inflation", "ceasefire", "stimulus"];
  const negative = ["misses", "weaker", "recession", "selloff", "rate hike", "hot inflation", "escalation", "default", "crisis"];
  const pos = positive.filter(k => text.includes(k)).length;
  const neg = negative.filter(k => text.includes(k)).length;
  const bias = pos > neg ? "POSITIVE" : neg > pos ? "NEGATIVE" : "NEUTRAL";
  return { impact, bias, category, symbols: newsSymbols(`${title} ${summary}`) };
}

function normalizeNews(p) {
  const title = clean(p.title || p.headline || p.name || "Știre fără titlu", 500);
  const summary = clean(p.summary || p.description || p.content, 3000);
  const a = analyzeNewsText(title, summary);
  const suppliedImpact = num(p.impact, NaN);
  const publishedAt = new Date(p.published_at || p.publishedAt || p.date || Date.now());
  return {
    external_id: clean(p.external_id || p.id || p.guid || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 180),
    published_at: Number.isNaN(publishedAt.getTime()) ? new Date().toISOString() : publishedAt.toISOString(), title, summary,
    source: clean(p.source?.name || p.source, 150), url: clean(p.url, 1000),
    symbols: Array.isArray(p.symbols) && p.symbols.length ? [...new Set(p.symbols.map(x => canonicalSymbol(x)).filter(Boolean))] : a.symbols,
    impact: Number.isFinite(suppliedImpact) ? Math.max(0, Math.min(100, suppliedImpact)) : a.impact,
    bias: clean(p.bias || a.bias, 20).toUpperCase(), category: clean(p.category || a.category, 50),
    provider: clean(p.provider, 80), sentiment: num(p.sentiment), relevance: Math.max(0, Math.min(100, num(p.relevance, 50))),
    confidence: Math.max(0, Math.min(100, num(p.confidence, 50))), scheduled: bool(p.scheduled), raw: p
  };
}

async function recentNewsRisk(symbol, at = new Date()) {
  symbol = canonicalSymbol(symbol);
  const from = new Date(at.getTime() - 3 * 3600000).toISOString();
  const to = new Date(at.getTime() + 1 * 3600000).toISOString();
  let rows;
  if (!pool) {
    rows = memoryNews.filter(n => new Date(n.published_at) >= new Date(from) && new Date(n.published_at) <= new Date(to));
  } else {
    rows = (await pool.query(`SELECT * FROM news_events WHERE published_at BETWEEN $1 AND $2 ORDER BY impact DESC, published_at DESC LIMIT 20`, [from, to])).rows;
  }
  const relevant = rows.filter(n => !n.symbols?.length || n.symbols.includes(symbol) || (symbol.includes("XAU") && n.symbols.includes("XAUUSD")));
  if (!relevant.length) {
    const coverage = newsCoverageStatus();
    if (!coverage.healthy) return { risk: NEWS_UNAVAILABLE_RISK, bias: "NEUTRAL", summary: `Filtrul de știri nu are acoperire recentă; risc de siguranță ${NEWS_UNAVAILABLE_RISK}/100.` };
    if (!coverage.calendarHealthy) return { risk: NEWS_CALENDAR_UNAVAILABLE_RISK, bias: "NEUTRAL", summary: `Fluxurile oficiale sunt active, dar calendarul economic anticipat nu este disponibil; risc de siguranță ${NEWS_CALENDAR_UNAVAILABLE_RISK}/100.` };
    return { risk: 0, bias: "NEUTRAL", summary: "Fără știri relevante în fereastra ±3h." };
  }
  const max = relevant.reduce((a, n) => Number(n.impact) > Number(a.impact) ? n : a, relevant[0]);
  return { risk: Number(max.impact || 0), bias: max.bias || "NEUTRAL", summary: relevant.slice(0, 3).map(n => n.title).join(" • ").slice(0, 1200) };
}


function normalizeBar(p) {
  const barTime = new Date(p.bar_time || p.time || p.timestamp || Date.now());
  if (Number.isNaN(barTime.getTime())) throw new Error("Timpul lumânării este invalid");
  const symbol = canonicalSymbol(p.symbol || p.ticker);
  const timeframe = normalizeTimeframe(p.timeframe || p.interval);
  const o = num(p.open, NaN), h = num(p.high, NaN), l = num(p.low, NaN), c = num(p.close, NaN);
  if (!symbol || !timeframe || ![o,h,l,c].every(Number.isFinite)) throw new Error("BAR necesită symbol, timeframe, open, high, low și close");
  if (h < Math.max(o, c) || l > Math.min(o, c) || h < l) throw new Error("BAR are valori OHLC invalide");
  return { external_id: clean(p.external_id || `BAR-${symbol}-${timeframe}-${barTime.getTime()}`, 160), bar_time: barTime.toISOString(), symbol, timeframe, open:o, high:h, low:l, close:c, volume:num(p.volume) };
}

async function saveBar(b) {
  b = { ...b, symbol: canonicalSymbol(b.symbol) };
  if (!pool) {
    const duplicate = memoryBars.some(x =>
      x.external_id === b.external_id ||
      (x.symbol === b.symbol && x.timeframe === b.timeframe && new Date(x.bar_time).getTime() === new Date(b.bar_time).getTime())
    );
    if (duplicate) return false;
    memoryBars.push({id:Date.now(),...b});
    memoryBars = memoryBars.filter(x=>new Date(x.bar_time) >= new Date(Date.now()-PATTERN_LOOKBACK_DAYS*86400000)).slice(-30000);
    return true;
  }
  const result = await pool.query(`
    INSERT INTO market_bars(external_id,bar_time,symbol,timeframe,open,high,low,close,volume)
    SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9
    WHERE NOT EXISTS (
      SELECT 1 FROM market_bars WHERE symbol=$3 AND timeframe=$4 AND bar_time=$2
    )
    ON CONFLICT DO NOTHING
    RETURNING id
  `,[b.external_id,b.bar_time,b.symbol,b.timeframe,b.open,b.high,b.low,b.close,b.volume]);
  return result.rowCount > 0;
}


async function openSignalsForSymbol(symbol) {
  if (!pool) return memorySignals.filter(x=>x.symbol===symbol && x.status==="OPEN");
  return (await pool.query(`SELECT * FROM signals WHERE symbol=$1 AND status='OPEN' ORDER BY received_at ASC`,[symbol])).rows;
}

async function trackSignalsWithBar(bar) {
  if (!AUTO_TRACK_TRADES) return [];
  const signals=await openSignalsForSymbol(bar.symbol);
  const updates=[];
  for(const s of signals){
    const side=String(s.signal||"").toUpperCase();
    if(!["BUY","SELL"].includes(side)) continue;
    const hi=num(bar.high), lo=num(bar.low), entry=num(s.price), sl=num(s.sl), tp1=num(s.tp1), tp2=num(s.tp2), tp3=num(s.tp3);
    const favorable=side==="BUY"?hi:lo, adverse=side==="BUY"?lo:hi;
    let result=null, exitPrice=0;
    const slHit=sl>0 && (side==="BUY"?lo<=sl:hi>=sl);
    const beHit=side==="BUY"?lo<=entry:hi>=entry;
    const tp3Hit=tp3>0 && (side==="BUY"?hi>=tp3:lo<=tp3);
    const tp2Hit=tp2>0 && (side==="BUY"?hi>=tp2:lo<=tp2);
    const tp1Hit=tp1>0 && (side==="BUY"?hi>=tp1:lo<=tp1);
    const hadTp1=Boolean(s.tp1_hit_at), hadTp2=Boolean(s.tp2_hit_at);
    const hitAt=new Date().toISOString();
    const targetUpdates={};
    if(tp1Hit&&!hadTp1){targetUpdates.tp1_hit_at=hitAt;targetUpdates.best_target="TP1";targetUpdates.managed_stop=entry;}
    if(tp2Hit&&!hadTp2){targetUpdates.tp1_hit_at=targetUpdates.tp1_hit_at||s.tp1_hit_at||hitAt;targetUpdates.tp2_hit_at=hitAt;targetUpdates.best_target="TP2";targetUpdates.managed_stop=entry;}
    if(tp3Hit){targetUpdates.tp1_hit_at=targetUpdates.tp1_hit_at||s.tp1_hit_at||hitAt;targetUpdates.tp2_hit_at=targetUpdates.tp2_hit_at||s.tp2_hit_at||hitAt;targetUpdates.tp3_hit_at=hitAt;targetUpdates.best_target="TP3";targetUpdates.managed_stop=entry;}
    // Conservator: înainte de primul target, dacă aceeași lumânare atinge și SL și TP, ordinea este necunoscută și se consideră SL.
    if(slHit&&!hadTp1){result="SL";exitPrice=sl;}
    else if(tp3Hit){result="TP3";exitPrice=tp3;}
    else if(hadTp2&&beHit){result="TP2_BE";exitPrice=entry;}
    else if(hadTp1&&beHit){result="TP1_BE";exitPrice=entry;}
    if(!pool){
      const item=memorySignals.find(x=>x.external_id===s.external_id);
      if(item){item.max_favorable_price=side==="BUY"?Math.max(num(item.max_favorable_price,entry),favorable):Math.min(num(item.max_favorable_price,entry),favorable);item.max_adverse_price=side==="BUY"?Math.min(num(item.max_adverse_price,entry),adverse):Math.max(num(item.max_adverse_price,entry),adverse);Object.assign(item,targetUpdates);}
    }else{
      await pool.query(`UPDATE signals SET max_favorable_price=CASE WHEN signal='BUY' THEN GREATEST(COALESCE(max_favorable_price,price),$1) ELSE LEAST(COALESCE(max_favorable_price,price),$1) END,max_adverse_price=CASE WHEN signal='BUY' THEN LEAST(COALESCE(max_adverse_price,price),$2) ELSE GREATEST(COALESCE(max_adverse_price,price),$2) END WHERE external_id=$3`,[favorable,adverse,s.external_id]);
      if(Object.keys(targetUpdates).length){
        await pool.query(`UPDATE signals SET tp1_hit_at=COALESCE(tp1_hit_at,$1),tp2_hit_at=COALESCE(tp2_hit_at,$2),tp3_hit_at=COALESCE(tp3_hit_at,$3),best_target=$4,managed_stop=$5 WHERE external_id=$6`,[targetUpdates.tp1_hit_at||null,targetUpdates.tp2_hit_at||null,targetUpdates.tp3_hit_at||null,targetUpdates.best_target||s.best_target||null,targetUpdates.managed_stop||s.managed_stop||null,s.external_id]);
      }
    }
    if(result){
      const closed=await closeSignal({external_id:s.external_id,result,exit_price:exitPrice});
      if(pool) await pool.query(`UPDATE signals SET auto_closed=TRUE WHERE external_id=$1`,[s.external_id]);
      else {const item=memorySignals.find(x=>x.external_id===s.external_id);if(item)item.auto_closed=true;}
      updates.push(closed);
    }
  }
  return updates;
}

function fmpImpact(importance){
  const x=String(importance||"").toLowerCase();
  if(x.includes("high"))return 90;if(x.includes("medium"))return 60;if(x.includes("low"))return 30;return 45;
}

async function syncOfficialNews() {
  if (!OFFICIAL_NEWS_ENABLED) return { provider: "Fluxuri oficiale SUA", configured: false, disabled: true, received: 0, accepted: 0, saved: 0 };
  const result = await fetchOfficialNews();
  let saved = 0;
  for (const item of result.items) {
    const n = normalizeNews({
      external_id: item.externalId,
      published_at: item.publishedAt,
      title: item.title,
      summary: item.summary,
      source: item.source,
      provider: item.feedId,
      url: item.url,
      relevance: 90,
      confidence: 95,
      scheduled: false,
      raw: item
    });
    await saveNews(n);
    saved++;
  }
  return {
    provider: "Fluxuri oficiale SUA",
    configured: true,
    received: result.items.length,
    accepted: result.items.length,
    saved,
    feeds: result.feeds
  };
}

async function syncFmpCalendar() {
  if(!FMP_ENABLED) return {provider:"FMP",configured:false,disabled:true,keyConfigured:Boolean(FMP_API_KEY),reason:"Oprit implicit; activează FMP_ENABLED numai cu un plan FMP compatibil.",received:0,accepted:0,saved:0};
  if(!FMP_API_KEY) return {provider:"FMP",configured:false,disabled:false,keyConfigured:false,received:0,accepted:0,saved:0};
  if(fmpRuntimeDisabledReason) return {provider:"FMP",configured:false,disabled:true,keyConfigured:true,reason:fmpRuntimeDisabledReason,received:0,accepted:0,saved:0};
  const now=new Date(), from=new Date(now.getTime()-24*3600000), to=new Date(now.getTime()+7*86400000);
  const iso=d=>d.toISOString().slice(0,10);
  const url=`https://financialmodelingprep.com/stable/economic-calendar?from=${iso(from)}&to=${iso(to)}&apikey=${encodeURIComponent(FMP_API_KEY)}`;
  const response=await fetch(url,{headers:{accept:"application/json"}});
  if(response.status === 402) {
    fmpRuntimeDisabledReason = "Dezactivat automat după HTTP 402; fluxurile oficiale gratuite rămân active.";
    return {provider:"FMP",configured:false,disabled:true,keyConfigured:true,reason:fmpRuntimeDisabledReason,httpStatus:402,received:0,accepted:0,saved:0};
  }
  if(!response.ok) throw new Error(`FMP a răspuns cu HTTP ${response.status}`);
  const items=await response.json();
  if(!Array.isArray(items)) throw new Error("Răspuns FMP neașteptat");
  let saved=0, accepted=0;
  for(const item of items){
    const country=String(item.country||item.countryCode||"").toUpperCase();
    if(NEWS_COUNTRIES.length && country && !NEWS_COUNTRIES.includes(country))continue;
    accepted++;
    const title=clean(item.event||item.name||item.title||"Eveniment economic",500);
    const summary=[item.actual!=null?`Actual: ${item.actual}`:"",item.estimate!=null?`Estimare: ${item.estimate}`:"",item.previous!=null?`Anterior: ${item.previous}`:""].filter(Boolean).join(" · ");
    const n=normalizeNews({external_id:`FMP-${item.id||`${item.date}-${title}`}`,published_at:item.date||item.datetime||new Date().toISOString(),title,summary,source:"Financial Modeling Prep",provider:"FMP",impact:fmpImpact(item.impact||item.importance),category:"ECONOMIC_CALENDAR",scheduled:true,relevance:95,confidence:90,raw:item});
    await saveNews(n); saved++;
  }
  lastSuccessfulCalendarSync = new Date().toISOString();
  return {provider:"FMP",configured:true,received:items.length,accepted,saved};
}

function avTime(v){
  const m=String(v||"").match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`).toISOString() : new Date().toISOString();
}

async function syncAlphaVantageNews(){
  if(!ALPHAVANTAGE_API_KEY) return {provider:"Alpha Vantage",configured:false,received:0,accepted:0,saved:0};
  const topics="financial_markets,economy_monetary,economy_macro";
  const url=`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=${encodeURIComponent(topics)}&sort=LATEST&limit=200&apikey=${encodeURIComponent(ALPHAVANTAGE_API_KEY)}`;
  const response=await fetch(url,{headers:{accept:"application/json"}});
  if(!response.ok) throw new Error(`Alpha Vantage a răspuns cu HTTP ${response.status}`);
  const data=await response.json();
  if(data.Note||data.Information) throw new Error(clean(data.Note||data.Information,500));
  const items=Array.isArray(data.feed)?data.feed:[]; let accepted=0,saved=0;
  for(const item of items){
    const title=clean(item.title,500), summary=clean(item.summary,3000);
    const rel=Math.max(...(item.ticker_sentiment||[]).map(x=>num(x.relevance_score)*100),35);
    const inferred=newsSymbols(`${title} ${summary}`);
    if(!inferred.length && rel<NEWS_MIN_RELEVANCE) continue;
    accepted++;
    const score=num(item.overall_sentiment_score,0);
    const n=normalizeNews({external_id:`AV-${item.url||item.time_published||title}`,published_at:avTime(item.time_published),title,summary,source:item.source||"Alpha Vantage",provider:"ALPHA_VANTAGE",url:item.url,symbols:inferred,sentiment:score,bias:score>.12?"POSITIVE":score<-.12?"NEGATIVE":"NEUTRAL",relevance:rel,confidence:70,raw:item});
    await saveNews(n); saved++;
  }
  return {provider:"Alpha Vantage",configured:true,received:items.length,accepted,saved};
}

async function syncFinnhubNews(){
  if(!FINNHUB_API_KEY) return {provider:"Finnhub",configured:false,received:0,accepted:0,saved:0};
  const url=`https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(FINNHUB_API_KEY)}`;
  const response=await fetch(url,{headers:{accept:"application/json"}});
  if(!response.ok) throw new Error(`Finnhub a răspuns cu HTTP ${response.status}`);
  const items=await response.json();
  if(!Array.isArray(items)) throw new Error("Răspuns Finnhub neașteptat");
  let accepted=0,saved=0;
  for(const item of items){
    const title=clean(item.headline,500), summary=clean(item.summary,3000);
    const symbols=newsSymbols(`${title} ${summary}`);
    if(!symbols.length) continue;
    accepted++;
    const n=normalizeNews({external_id:`FH-${item.id||item.url}`,published_at:item.datetime?new Date(item.datetime*1000).toISOString():new Date().toISOString(),title,summary,source:item.source||"Finnhub",provider:"FINNHUB",url:item.url,symbols,relevance:65,confidence:60,raw:item});
    await saveNews(n); saved++;
  }
  return {provider:"Finnhub",configured:true,received:items.length,accepted,saved};
}

async function syncRealNews() {
  const results=[];
  const providers = [
    ["Fluxuri oficiale SUA", syncOfficialNews],
    ["FMP", syncFmpCalendar],
    ["Alpha Vantage", syncAlphaVantageNews],
    ["Finnhub", syncFinnhubNews]
  ];
  for(const [provider,fn] of providers){
    try{results.push(await fn());}catch(e){results.push({provider,configured:true,error:e.message,received:0,accepted:0,saved:0});}
  }
  const received=results.reduce((a,x)=>a+num(x.received),0), accepted=results.reduce((a,x)=>a+num(x.accepted),0), saved=results.reduce((a,x)=>a+num(x.saved),0);
  lastNewsSync=new Date().toISOString();
  if (results.some(x => x.configured && !x.error)) lastSuccessfulNewsSync = lastNewsSync;
  lastNewsProviderResults = results;
  lastNewsSyncError=results.filter(x=>x.error).map(x=>`${x.provider}: ${x.error}`).join(" | ");
  if (!results.some(x => x.configured && !x.error)) throw new Error(lastNewsSyncError || "Nu există nicio sursă de știri activă.");
  return {received,accepted,saved,providers:results,lastNewsSync,lastNewsSyncError};
}

async function recentBars(symbol,timeframe,limit=20000) {
  const cutoff=new Date(Date.now()-PATTERN_LOOKBACK_DAYS*86400000).toISOString();
  if(!pool) return memoryBars.filter(x=>x.symbol===symbol&&x.timeframe===timeframe&&new Date(x.bar_time)>=new Date(cutoff)).sort((a,b)=>new Date(a.bar_time)-new Date(b.bar_time)).slice(-limit);
  return (await pool.query(`SELECT * FROM market_bars WHERE symbol=$1 AND timeframe=$2 AND bar_time >= $3 ORDER BY bar_time ASC LIMIT $4`,[symbol,timeframe,cutoff,limit])).rows;
}

function median(values){if(!values.length)return 0;const a=[...values].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function ema(values,len){if(!values.length)return 0;const k=2/(len+1);let e=values[0];for(let i=1;i<values.length;i++)e=values[i]*k+e*(1-k);return e;}
function atrFromBars(bars,len=14){if(bars.length<2)return 0;const tr=[];for(let i=1;i<bars.length;i++){const h=num(bars[i].high),l=num(bars[i].low),pc=num(bars[i-1].close);tr.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}return tr.slice(-len).reduce((a,x)=>a+x,0)/Math.max(1,Math.min(len,tr.length));}
function bucketFor(date,timeframe){const d=new Date(date);const mins=d.getUTCHours()*60+d.getUTCMinutes();const tf=Math.max(1,parseInt(timeframe)||5);const bucket=Math.floor(mins/tf)*tf;return `${String(Math.floor(bucket/60)).padStart(2,'0')}:${String(bucket%60).padStart(2,'0')} UTC`;}

async function higherTimeframeConfirmation(symbol, timeframe, side) {
  const currentIndex = SUPPORTED_ANALYSIS_TIMEFRAMES.indexOf(String(timeframe));
  const higher = SUPPORTED_ANALYSIS_TIMEFRAMES
    .slice(currentIndex + 1)
    .find(item => ANALYSIS_TIMEFRAMES.includes(item));
  if (!higher) return { available: false, confirmed: true, timeframe: null, trend: "LOCAL" };
  const bars = await recentBars(symbol, higher, 80);
  if (bars.length < 20) return { available: false, confirmed: true, timeframe: higher, trend: "INSUFFICIENT_DATA" };
  const closes = bars.slice(-60).map(item => num(item.close));
  const fast = ema(closes.slice(-40), 20);
  const slow = closes.length >= 50 ? ema(closes, 50) : ema(closes, 20);
  const close = closes[closes.length - 1];
  const trend = close > fast && fast > slow ? "BUY" : close < fast && fast < slow ? "SELL" : "NEUTRAL";
  return { available: true, confirmed: trend === side, timeframe: higher, trend };
}

async function analyzeTimePattern(bar) {
  const profile = analysisProfile(bar.timeframe);
  const horizonBars = profile.horizonBars;
  const bars=await recentBars(bar.symbol,bar.timeframe);
  if(bars.length < Math.max(PATTERN_MIN_SAMPLES, profile.minSamples) + horizonBars + 20) return null;
  const now=new Date(bar.bar_time), targetBucket=bucketFor(now,bar.timeframe), weekday=now.getUTCDay();
  const moves=[];
  for(let i=0;i<bars.length-horizonBars;i++){
    const a=bars[i], dt=new Date(a.bar_time);
    if(bucketFor(dt,bar.timeframe)!==targetBucket) continue;
    // Prioritize the same weekday, but accept all weekdays until the sample threshold is reached.
    const end=bars[i+horizonBars];
    if(!end)continue;
    const move=(num(end.close)-num(a.close))/Math.max(0.000001,num(a.close))*100;
    moves.push({move,sameWeekday:dt.getUTCDay()===weekday});
  }
  let selected=moves.filter(x=>x.sameWeekday).map(x=>x.move);
  if(selected.length<profile.minSamples) selected=moves.map(x=>x.move);
  if(selected.length<profile.minSamples) return null;
  const up=selected.filter(x=>x>0).length, down=selected.filter(x=>x<0).length;
  const upProb=up/selected.length*100, downProb=down/selected.length*100;
  const side=upProb>=downProb?'BUY':'SELL', probability=Math.max(upProb,downProb);
  const directional=selected.filter(x=>side==='BUY'?x>0:x<0).map(Math.abs);
  const avgMove=directional.reduce((a,x)=>a+x,0)/Math.max(1,directional.length), medMove=median(directional);
  const closes=bars.slice(-60).map(x=>num(x.close));
  const e20=ema(closes.slice(-40),20), e50=ema(closes,50);
  const trendConfirmed=side==='BUY'?num(bar.close)>e20&&e20>e50:num(bar.close)<e20&&e20<e50;
  const mtf=await higherTimeframeConfirmation(bar.symbol,bar.timeframe,side);
  const atr=atrFromBars(bars.slice(-30));
  const minMovePct=Math.max(0.03,(atr/Math.max(0.000001,num(bar.close))*100)*0.55);
  if(probability<Math.max(PATTERN_MIN_PROBABILITY, profile.minProbability) || avgMove<minMovePct || !trendConfirmed || (mtf.available&&!mtf.confirmed)) return null;
  const news=await recentNewsRisk(bar.symbol,new Date(bar.bar_time));
  if(news.risk>=80) return null;
  const entry=num(bar.close), risk=Math.max(atr*profile.stopAtr,entry*avgMove/100*0.45);
  const sl=side==='BUY'?entry-risk:entry+risk;
  const tp1=side==='BUY'?entry+risk*1.5:entry-risk*1.5;
  const tp2=side==='BUY'?entry+risk*2.5:entry-risk*2.5;
  const tp3=side==='BUY'?entry+risk*3.5:entry-risk*3.5;
  const bucketMs=profile.cooldownMinutes*60000;
  const ext=`PATTERN-${bar.symbol}-${bar.timeframe}-${side}-${Math.floor(new Date(bar.bar_time).getTime()/bucketMs)}`;
  const mtfText=mtf.available?` Confirmare ${timeframeLabel(mtf.timeframe)}: ${mtf.trend}.`:"";
  return {external_id:ext,created_at:new Date().toISOString(),symbol:bar.symbol,timeframe:bar.timeframe,side,entry,sl,tp1,tp2,tp3,samples:selected.length,probability:Number(probability.toFixed(2)),avg_move_pct:Number(avgMove.toFixed(4)),median_move_pct:Number(medMove.toFixed(4)),time_bucket:targetBucket,weekday,horizon_bars:horizonBars,trend_confirmed:trendConfirmed,mtf_confirmed:mtf.confirmed,mtf_timeframe:mtf.timeframe,mtf_trend:mtf.trend,news_risk:news.risk,status:'CANDIDATE',reason:`Model ${profile.label}: ${side} a apărut în ${probability.toFixed(1)}% din ${selected.length} cazuri; mișcare medie ${avgMove.toFixed(3)}% în următoarele ${horizonBars} lumânări. Confirmare EMA20/EMA50.${mtfText} Risc știri ${news.risk}/100.`};
}

function patternSignalScore(pattern) {
  const profile = analysisProfile(pattern.timeframe);
  const sampleBonus = Math.min(8, Math.max(0, Math.log2(Math.max(1, num(pattern.samples) / profile.minSamples) + 1) * 4));
  const newsPenalty = num(pattern.news_risk) * 0.05;
  const score = Math.min(95, num(pattern.probability) + 6 + sampleBonus - newsPenalty);
  return {
    score: Number(score.toFixed(2)),
    sampleBonus: Number(sampleBonus.toFixed(2)),
    newsPenalty: Number(newsPenalty.toFixed(2)),
    requiredScore: profile.minScore
  };
}

function patternQualifiesForSignal(pattern) {
  if (!pattern) return false;
  const profile = analysisProfile(pattern.timeframe);
  const calculated = patternSignalScore(pattern);
  return Boolean(
    AUTO_PATTERN_SIGNALS && pattern.trend_confirmed &&
    ANALYSIS_TIMEFRAMES.includes(String(pattern.timeframe)) &&
    num(pattern.samples) >= profile.minSamples &&
    num(pattern.probability) >= profile.minProbability &&
    num(pattern.news_risk) <= MAX_NEWS_RISK_LIVE &&
    calculated.score >= profile.minScore
  );
}

function patternToSignal(pattern) {
  const calculated = patternSignalScore(pattern);
  const label = timeframeLabel(pattern.timeframe);
  return normalizeSignal({
    event: "SIGNAL",
    external_id: `AUTO-${pattern.external_id}`,
    symbol: pattern.symbol,
    timeframe: pattern.timeframe,
    signal: pattern.side,
    price: pattern.entry,
    sl: pattern.sl,
    tp1: pattern.tp1,
    tp2: pattern.tp2,
    tp3: pattern.tp3,
    score: calculated.score,
    probability: pattern.probability,
    rr: 3.5,
    trend: pattern.side === "BUY" ? "Bullish" : "Bearish",
    structure: `Model ${label} validat + trend EMA20/EMA50`,
    session: pattern.time_bucket,
    mtf_confirm: pattern.mtf_confirmed !== false,
    mtf_trend: pattern.mtf_timeframe ? `${timeframeLabel(pattern.mtf_timeframe)} ${pattern.mtf_trend}` : "Local",
    market_phase: "Historical edge",
    reason: `Semnal generat automat de server din modelul istoric ${label}. ${pattern.reason}`,
    score_breakdown: {
      historicalProbability: pattern.probability,
      samples: pattern.samples,
      trendConfirmation: 6,
      sampleBonus: calculated.sampleBonus,
      newsPenalty: calculated.newsPenalty,
      requiredScore: calculated.requiredScore
    }
  });
}

async function barsBetween(symbol, timeframe, from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (!pool) {
    return memoryBars
      .filter(item =>
        item.symbol === symbol &&
        item.timeframe === timeframe &&
        new Date(item.bar_time) >= start &&
        new Date(item.bar_time) <= end
      )
      .sort((a, b) => new Date(a.bar_time) - new Date(b.bar_time));
  }
  return (await pool.query(
    `SELECT * FROM market_bars
     WHERE symbol=$1 AND timeframe=$2 AND bar_time BETWEEN $3 AND $4
     ORDER BY bar_time ASC`,
    [symbol, timeframe, start.toISOString(), end.toISOString()]
  )).rows;
}

async function deriveCompletedHigherBars(m5Bar) {
  if (String(m5Bar.timeframe) !== "5") return [];
  const targets = completedHigherTimeframes(
    m5Bar.bar_time,
    "5",
    [...new Set([...ANALYSIS_TIMEFRAMES, ...CONTEXT_TIMEFRAMES])].sort((a, b) => num(a) - num(b))
  );
  const derived = [];
  for (const target of targets) {
    const targetMs = Number(target) * 60000;
    const barStart = new Date(m5Bar.bar_time).getTime();
    const bucketStart = Math.floor(barStart / targetMs) * targetMs;
    const source = await barsBetween(
      m5Bar.symbol,
      "5",
      new Date(bucketStart).toISOString(),
      m5Bar.bar_time
    );
    const aggregated = aggregateBars(source, "5", target, { requireComplete: true });
    if (!aggregated.length) continue;
    const higherBar = aggregated[aggregated.length - 1];
    if (await saveBar(higherBar)) derived.push(higherBar);
  }
  return derived;
}

async function processNewBar(bar, { trackTrades = true } = {}) {
  lastBarAtByTimeframe[bar.timeframe] = bar.bar_time;
  const autoClosed = trackTrades ? await trackSignalsWithBar(bar) : [];
  const smcLifecycle = trackTrades ? await processPendingSmcSetups(bar) : { updates: [], activatedSignals: [] };
  if (!ANALYSIS_TIMEFRAMES.includes(String(bar.timeframe))) {
    return { bar, analyzed: false, autoClosed, pattern: null, generatedSignal: null, smcSetups: [], smcUpdates: smcLifecycle.updates, smcActivatedSignals: smcLifecycle.activatedSignals };
  }
  const smcSetups = await discoverSmcSetupsForBar(bar);
  const pattern = await analyzeTimePattern(bar);
  const patternInserted = pattern ? await savePattern(pattern) : false;
  let generatedSignal = null;
  if (patternInserted && patternQualifiesForSignal(pattern)) {
    const candidate = patternToSignal(pattern);
    const signalInserted = await saveSignal(candidate);
    if (signalInserted) {
      generatedSignal = candidate;
      notifyTelegramSignal(candidate).catch(error => console.error("[TELEGRAM AUTO PATTERN]", error.message));
    }
  }
  return {
    bar,
    analyzed: true,
    autoClosed,
    pattern: patternInserted ? pattern : null,
    generatedSignal,
    smcSetups,
    smcUpdates: smcLifecycle.updates,
    smcActivatedSignals: smcLifecycle.activatedSignals
  };
}

async function savePattern(p) {
  if(!p)return false;
  if(!pool){if(memoryPatterns.some(x=>x.external_id===p.external_id))return false;memoryPatterns.unshift({id:Date.now(),...p});memoryPatterns=memoryPatterns.slice(0,500);return true;}
  const q=await pool.query(`INSERT INTO pattern_signals(external_id,created_at,symbol,timeframe,side,entry,sl,tp1,tp2,tp3,samples,probability,avg_move_pct,median_move_pct,time_bucket,weekday,horizon_bars,trend_confirmed,news_risk,status,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT DO NOTHING RETURNING id`,[p.external_id,p.created_at,p.symbol,p.timeframe,p.side,p.entry,p.sl,p.tp1,p.tp2,p.tp3,p.samples,p.probability,p.avg_move_pct,p.median_move_pct,p.time_bucket,p.weekday,p.horizon_bars,p.trend_confirmed,p.news_risk,p.status,p.reason]);
  return q.rowCount>0;
}

async function listPatterns(limit=100){
  if(!pool)return memoryPatterns.slice(0,limit);
  return (await pool.query(`SELECT * FROM pattern_signals ORDER BY created_at DESC LIMIT $1`,[limit])).rows;
}

async function pendingSmcSetupsForSymbol(symbol) {
  if (!pool) {
    return memorySmcSetups
      .filter(item => item.symbol === symbol && item.status === "PENDING")
      .sort((a, b) => num(b.adaptive_score) - num(a.adaptive_score))
      .slice(0, SMC_MAX_PENDING_PER_SYMBOL);
  }
  return (await pool.query(
    `SELECT * FROM smc_setups
     WHERE symbol=$1 AND status='PENDING'
     ORDER BY adaptive_score DESC, created_at DESC
     LIMIT $2`,
    [symbol, SMC_MAX_PENDING_PER_SYMBOL]
  )).rows;
}

async function listSmcSetups({ status = "", symbol = "", limit = 150 } = {}) {
  const normalizedStatus = clean(status, 20).toUpperCase();
  const normalizedSymbol = canonicalSymbol(symbol);
  const safeLimit = Math.min(500, Math.max(1, num(limit, 150)));
  if (!pool) {
    return memorySmcSetups
      .filter(item => !normalizedStatus || item.status === normalizedStatus)
      .filter(item => !normalizedSymbol || item.symbol === normalizedSymbol)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, safeLimit);
  }
  const conditions = [];
  const values = [];
  if (normalizedStatus) { values.push(normalizedStatus); conditions.push(`status=$${values.length}`); }
  if (normalizedSymbol) { values.push(normalizedSymbol); conditions.push(`symbol=$${values.length}`); }
  values.push(safeLimit);
  return (await pool.query(
    `SELECT * FROM smc_setups ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY created_at DESC LIMIT $${values.length}`,
    values
  )).rows;
}

async function updateSmcSetup(externalId, updates) {
  const allowed = new Set([
    "status", "updated_at", "triggered_at", "closed_at", "touch_count",
    "pending_notified", "signal_external_id", "terminal_reason"
  ]);
  const safe = Object.fromEntries(Object.entries(updates).filter(([key]) => allowed.has(key)));
  if (!Object.keys(safe).length) return null;
  safe.updated_at = safe.updated_at || new Date().toISOString();
  if (!pool) {
    const item = memorySmcSetups.find(setup => setup.external_id === externalId);
    if (!item) return null;
    Object.assign(item, safe);
    return item;
  }
  const entries = Object.entries(safe);
  const values = entries.map(([, value]) => value);
  values.push(externalId);
  const assignments = entries.map(([key], index) => `${key}=$${index + 1}`).join(",");
  return (await pool.query(
    `UPDATE smc_setups SET ${assignments} WHERE external_id=$${values.length} RETURNING *`,
    values
  )).rows[0] || null;
}

async function notifyTelegramPendingSetup(setup) {
  const logSignal = { external_id: setup.external_id, symbol: setup.symbol, signal: setup.side };
  const skip = async reason => {
    lastTelegramAt = new Date().toISOString();
    lastTelegramResult = `OMIS PLAN SMC ${setup.side} ${setup.symbol} ${timeframeLabel(setup.timeframe)}: ${reason}`;
    await logTelegram({ signal: logSignal, status: "SKIPPED", details: lastTelegramResult }).catch(() => {});
    return { skipped: true, reason };
  };
  if (!telegram.status().configured) return skip("Telegram neconfigurat");
  if (num(setup.adaptive_score) < SMC_NOTIFY_PENDING_SCORE) return skip(`scor ${num(setup.adaptive_score)} sub ${SMC_NOTIFY_PENDING_SCORE}`);
  if (num(setup.news_risk) > MAX_NEWS_RISK_LIVE) return skip(`risc știri ${num(setup.news_risk)}/100 peste ${MAX_NEWS_RISK_LIVE}`);
  try {
    const result = await telegram.sendPendingSetup(setup);
    lastTelegramAt = new Date().toISOString();
    lastTelegramResult = `PLAN SMC ${setup.side} ${setup.symbol} ${timeframeLabel(setup.timeframe)}, mesaj ${result.message_id}`;
    await updateSmcSetup(setup.external_id, { pending_notified: true });
    await logTelegram({ status: "SMC_PENDING", messageId: result.message_id, details: lastTelegramResult });
    return { skipped: false, messageId: result.message_id };
  } catch (error) {
    lastTelegramAt = new Date().toISOString();
    lastTelegramResult = `EROARE PLAN SMC: ${error.message}`;
    await logTelegram({ status: "ERROR", details: lastTelegramResult }).catch(() => {});
    throw error;
  }
}

async function saveSmcSetup(setup) {
  const performance = await setupPerformance(setup.model_key);
  const news = await recentNewsRisk(setup.symbol);
  setup.learning_samples = performance.samples;
  setup.historical_probability = performance.samples >= 5 ? Number(performance.weightedWinRate.toFixed(2)) : null;
  setup.adaptive_score = Math.max(0, Math.min(100, Number((setup.score + performance.adjustment).toFixed(2))));
  setup.news_risk = news.risk;
  if (!pool) {
    if (memorySmcSetups.some(item => item.external_id === setup.external_id)) return { inserted: false, setup };
    memorySmcSetups.unshift({ id: Date.now(), pending_notified: false, ...setup });
    memorySmcSetups = memorySmcSetups.slice(0, 2000);
    return { inserted: true, setup: memorySmcSetups[0] };
  }
  const result = await pool.query(`
    INSERT INTO smc_setups (
      external_id,created_at,updated_at,expires_at,symbol,timeframe,side,status,
      entry,zone_low,zone_high,sl,tp1,tp2,tp3,current_price,score,adaptive_score,
      historical_probability,learning_samples,news_risk,d1_bias,h4_bias,local_bias,
      structure_event,broken_level,order_block_time,displacement,fvg,fvg_low,fvg_high,
      liquidity_sweep,sweep_level,premium_discount,mitigations,touch_count,volume_confirmed,
      model_key,score_breakdown,features,reason
    ) VALUES (${Array.from({length:41},(_,index)=>`$${index+1}`).join(",")})
    ON CONFLICT DO NOTHING RETURNING *
  `, [
    setup.external_id,setup.created_at,setup.updated_at,setup.expires_at,setup.symbol,setup.timeframe,setup.side,setup.status,
    setup.entry,setup.zone_low,setup.zone_high,setup.sl,setup.tp1,setup.tp2,setup.tp3,setup.current_price,setup.score,setup.adaptive_score,
    setup.historical_probability,setup.learning_samples,setup.news_risk,setup.d1_bias,setup.h4_bias,setup.local_bias,
    setup.structure_event,setup.broken_level,setup.order_block_time,setup.displacement,setup.fvg,setup.fvg_low,setup.fvg_high,
    setup.liquidity_sweep,setup.sweep_level,setup.premium_discount,setup.mitigations,setup.touch_count,setup.volume_confirmed,
    setup.model_key,JSON.stringify(setup.score_breakdown),JSON.stringify(setup.features),setup.reason
  ]);
  return { inserted: result.rowCount > 0, setup: result.rows[0] || setup };
}

function smcSetupToSignal(setup, activationReason) {
  const confluences = [
    setup.structure_event,
    setup.fvg ? "FVG" : "",
    setup.liquidity_sweep ? "LIQUIDITY_SWEEP" : "",
    setup.premium_discount,
    "ORDER_BLOCK_CONFIRMED"
  ].filter(Boolean).join("+");
  return normalizeSignal({
    external_id: `SMC-LIVE-${setup.external_id}`,
    setup_key: setup.model_key,
    symbol: setup.symbol,
    timeframe: setup.timeframe,
    signal: setup.side,
    price: setup.entry,
    sl: setup.sl,
    tp1: setup.tp1,
    tp2: setup.tp2,
    tp3: setup.tp3,
    score: setup.score,
    probability: setup.historical_probability || 0,
    atr: Math.abs(num(setup.entry) - num(setup.sl)),
    rr: 4,
    trend: `D1 ${setup.d1_bias} / H4 ${setup.h4_bias}`,
    structure: `SMC_${setup.structure_event}_${setup.premium_discount}`,
    session: `SMC ${timeframeLabel(setup.timeframe)}`,
    mtf_confirm: setup.d1_bias === (setup.side === "BUY" ? "BULLISH" : "BEARISH") || setup.h4_bias === (setup.side === "BUY" ? "BULLISH" : "BEARISH"),
    mtf_trend: `D1 ${setup.d1_bias} · H4 ${setup.h4_bias}`,
    order_block: `${setup.zone_low}–${setup.zone_high}`,
    bos: setup.structure_event === "BOS",
    choch: setup.structure_event === "CHOCH",
    fvg: bool(setup.fvg),
    liquidity_sweep: bool(setup.liquidity_sweep),
    order_block_confirm: true,
    market_phase: "SMC_RETRACEMENT",
    premium_discount: setup.premium_discount,
    fvg_state: setup.fvg ? "IMBALANCE_CONFIRMAT" : "FĂRĂ_FVG",
    ob_state: "MITIGAT_CU_CONFIRMĂRE_M5",
    score_breakdown: safeJson(setup.score_breakdown),
    reason: `${setup.reason} Activare: ${activationReason}. Confluențe: ${confluences}. Eșantion propriu pentru acest model: N=${num(setup.learning_samples)}.`
  });
}

async function processPendingSmcSetups(bar) {
  if (!SMC_ENABLED || String(bar.timeframe) !== "5") return { updates: [], activatedSignals: [] };
  const setups = await pendingSmcSetupsForSymbol(bar.symbol);
  const updates = [];
  const activatedSignals = [];
  for (const setup of setups) {
    const evaluation = evaluatePendingSetup(setup, bar, { requireConfirmation: SMC_REQUIRE_M5_CONFIRMATION });
    if (evaluation.action === "KEEP") continue;
    if (evaluation.action === "TOUCH") {
      const updated = await updateSmcSetup(setup.external_id, { touch_count: evaluation.touchCount, terminal_reason: evaluation.reason });
      if (updated) updates.push(updated);
      continue;
    }
    if (evaluation.action === "EXPIRE" || evaluation.action === "CANCEL") {
      const status = evaluation.action === "EXPIRE" ? "EXPIRED" : "CANCELLED";
      const updated = await updateSmcSetup(setup.external_id, { status, closed_at: new Date().toISOString(), terminal_reason: evaluation.reason, touch_count: evaluation.touchCount || setup.touch_count });
      if (updated) updates.push(updated);
      continue;
    }
    if (evaluation.action === "TRIGGER") {
      const candidate = smcSetupToSignal(setup, evaluation.reason);
      const inserted = await saveSignal(candidate);
      const updated = await updateSmcSetup(setup.external_id, {
        status: inserted ? "TRIGGERED" : "DUPLICATE",
        triggered_at: new Date().toISOString(),
        touch_count: evaluation.touchCount,
        signal_external_id: candidate.external_id,
        terminal_reason: evaluation.reason
      });
      if (updated) updates.push(updated);
      if (inserted) {
        activatedSignals.push(candidate);
        notifyTelegramSignal(candidate).catch(error => console.error("[TELEGRAM SMC LIVE]", error.message));
      }
    }
  }
  return { updates, activatedSignals };
}

async function discoverSmcSetupsForBar(bar) {
  if (!SMC_ENABLED || !ANALYSIS_TIMEFRAMES.includes(String(bar.timeframe))) return [];
  const [bars, h4Bars, d1Bars] = await Promise.all([
    recentBars(bar.symbol, bar.timeframe, 600),
    recentBars(bar.symbol, "240", 300),
    recentBars(bar.symbol, "1440", 260)
  ]);
  const candidates = findSmcSetups({
    symbol: bar.symbol,
    timeframe: bar.timeframe,
    bars,
    h4Bars,
    d1Bars,
    now: new Date(),
    config: { minScore: SMC_MIN_SCORE }
  });
  const inserted = [];
  for (const candidate of candidates) {
    const saved = await saveSmcSetup(candidate);
    if (!saved.inserted) continue;
    inserted.push(saved.setup);
    notifyTelegramPendingSetup(saved.setup).catch(error => console.error("[TELEGRAM SMC PENDING]", error.message));
  }
  return inserted;
}

async function archiveOldSignals() {
  const cutoff = hoursAgoIso(ARCHIVE_AFTER_HOURS);
  if (!pool) {
    let count = 0;
    for (const s of memorySignals) if (!s.archived_at && new Date(s.received_at) < new Date(cutoff)) { s.archived_at = new Date().toISOString(); count++; }
    return count;
  }
  const q = await pool.query(`UPDATE signals SET archived_at=NOW() WHERE archived_at IS NULL AND received_at < $1 RETURNING id`, [cutoff]);
  return q.rowCount;
}


function wilsonLowerBound(wins, total, z = 1.2816) {
  if (!total) return 0;
  const p = wins / total, z2 = z * z;
  return (p + z2/(2*total) - z*Math.sqrt((p*(1-p)+z2/(4*total))/total)) / (1 + z2/total);
}
function recentWeightedStats(rows) {
  if (!rows.length) return { weightedWinRate:0, weightedAvgR:0, effectiveSamples:0 };
  let wSum=0, winSum=0, rSum=0;
  rows.forEach((x,i)=>{const w=Math.pow(0.985,i);wSum+=w;rSum+=num(x.pnl_r)*w;if(num(x.pnl_r)>0)winSum+=w;});
  return {weightedWinRate:winSum/wSum*100,weightedAvgR:rSum/wSum,effectiveSamples:wSum};
}
async function consecutiveLosses() {
  let rows;
  if(!pool) rows=memorySignals.filter(x=>x.status==="CLOSED").sort((a,b)=>new Date(b.closed_at)-new Date(a.closed_at)).slice(0,20);
  else rows=(await pool.query(`SELECT pnl_r FROM signals WHERE status='CLOSED' ORDER BY closed_at DESC LIMIT 20`)).rows;
  let n=0; for(const r of rows){if(num(r.pnl_r)<0)n++;else break;} return n;
}
function classifyRegimeFromSignal(s){
  const phase=(s.market_phase||"").toUpperCase(), atrPct=s.price>0?s.atr/s.price*100:0;
  if(phase.includes("RANGE")||phase.includes("CONSOL"))return "RANGE";
  if(atrPct>0.35)return "HIGH_VOL";
  if(s.mtf_confirm&&s.vwap_confirm&&(s.bos||s.choch))return "TREND";
  return "MIXED";
}

async function setupPerformance(key) {
  if (!key) return { samples:0,adjustment:0,winRate:0,avgR:0,lowerBound:0,weightedWinRate:0,weightedAvgR:0 };
  let rows;
  if (!pool) rows = memorySignals.filter(x => x.setup_key === key && x.status === "CLOSED").sort((a,b)=>new Date(b.closed_at)-new Date(a.closed_at)).slice(0, 300);
  else rows = (await pool.query(`SELECT pnl_r,closed_at FROM signals WHERE setup_key=$1 AND status='CLOSED' ORDER BY closed_at DESC LIMIT 300`, [key])).rows;
  const samples=rows.length;
  if(!samples)return {samples:0,adjustment:0,winRate:0,avgR:0,lowerBound:0,weightedWinRate:0,weightedAvgR:0};
  const wins=rows.filter(x=>num(x.pnl_r)>0).length,totalR=rows.reduce((a,x)=>a+num(x.pnl_r),0);
  const winRate=wins/samples*100,avgR=totalR/samples,lowerBound=wilsonLowerBound(wins,samples)*100,weighted=recentWeightedStats(rows);
  const confidence=Math.min(1,samples/LEARNING_MIN_SAMPLES);
  const edge=((lowerBound-50)*0.22)+(weighted.weightedAvgR*5);
  const adjustment=Math.max(-12,Math.min(12,edge*confidence));
  return {samples,adjustment,winRate,avgR,lowerBound,weightedWinRate:weighted.weightedWinRate,weightedAvgR:weighted.weightedAvgR};
}

async function saveSignal(s) {
  validateSignalLevels(s);
  const perf = await setupPerformance(s.setup_key);
  const news = await recentNewsRisk(s.symbol);
  const lossStreak = await consecutiveLosses();
  const newsPenalty = news.risk >= 80 ? -14 : news.risk >= 55 ? -7 : 0;
  const samplePenalty = perf.samples > 0 && perf.samples < LEARNING_MIN_SAMPLES ? -3 : 0;
  const streakPenalty = lossStreak >= MAX_CONSECUTIVE_LOSSES ? -10 : 0;
  s.learning_adjustment = Number(perf.adjustment.toFixed(2));
  s.adaptive_score = Math.max(0, Math.min(100, Number((s.score + perf.adjustment + newsPenalty + samplePenalty + streakPenalty).toFixed(2))));
  s.news_risk = news.risk; s.news_bias = news.bias; s.news_summary = news.summary;
  s.confidence_lower = Number(perf.lowerBound.toFixed(2));
  s.regime = classifyRegimeFromSignal(s);
  const proven = perf.samples >= LEARNING_MIN_SAMPLES && perf.lowerBound >= 50 && perf.weightedAvgR > 0;
  const statisticallyBlocked = perf.samples >= SMC_MIN_BLOCK_SAMPLES && (perf.lowerBound < 38 || perf.weightedAvgR <= -0.15);
  const liveAllowed = s.adaptive_score >= LIVE_MIN_ADAPTIVE_SCORE && news.risk <= MAX_NEWS_RISK_LIVE && lossStreak < MAX_CONSECUTIVE_LOSSES;
  s.execution_mode = liveAllowed && !statisticallyBlocked ? "LIVE" : "WATCH";
  s.quality_score = Math.max(0,Math.min(100,Number((s.adaptive_score + (proven?5:0) - (s.regime==="RANGE"?5:0)).toFixed(2))));
  const reasons=[];
  if(s.adaptive_score<LIVE_MIN_ADAPTIVE_SCORE)reasons.push(`scor sub ${LIVE_MIN_ADAPTIVE_SCORE}`);
  if(news.risk>MAX_NEWS_RISK_LIVE)reasons.push(`risc știri ${news.risk}/100`);
  if(lossStreak>=MAX_CONSECUTIVE_LOSSES)reasons.push(`circuit breaker după ${lossStreak} pierderi consecutive`);
  if(statisticallyBlocked)reasons.push(`model blocat de rezultate slabe: N=${perf.samples}, limită inferioară ${perf.lowerBound.toFixed(1)}%, medie ponderată ${perf.weightedAvgR.toFixed(2)}R`);
  s.decision_reason = reasons.length
    ? reasons.join("; ")
    : perf.samples===0
      ? "Mod inițial: fără istoric propriu; folosește risc redus până la validare."
      : proven
        ? `Model confirmat pe ${perf.samples} rezultate proprii.`
        : `Învățare activă: N=${perf.samples}, ajustare ${perf.adjustment.toFixed(2)} puncte; nu există încă dovadă suficientă pentru eticheta „validat”.`;

  if (!pool) {
    if (memorySignals.some(x => x.external_id === s.external_id)) return false;
    memorySignals.unshift({ id: Date.now(), archived_at: null, ...s });
    return true;
  }
  const inserted = await pool.query(`
    INSERT INTO signals (
      external_id,received_at,symbol,timeframe,signal,status,price,sl,tp1,tp2,tp3,score,probability,
      adaptive_score,learning_adjustment,rsi,atr,rr,trend,structure,session_name,mtf_trend,vwap_side,
      order_block,bos,choch,fvg,liquidity_sweep,vwap_confirm,mtf_confirm,order_block_confirm,market_phase,
      equal_highs,equal_lows,premium_discount,fib_zone,fvg_state,ob_state,kill_zone,score_breakdown,reason,
      news_risk,news_bias,news_summary,setup_key,execution_mode,quality_score,confidence_lower,decision_reason,regime,signal_source
    ) VALUES (${Array.from({length:51},(_,i)=>`$${i+1}`).join(',')}) ON CONFLICT DO NOTHING RETURNING id
  `, [
    s.external_id,s.received_at,s.symbol,s.timeframe,s.signal,s.status,s.price,s.sl,s.tp1,s.tp2,s.tp3,s.score,s.probability,
    s.adaptive_score,s.learning_adjustment,s.rsi,s.atr,s.rr,s.trend,s.structure,s.session_name,s.mtf_trend,s.vwap_side,
    s.order_block,s.bos,s.choch,s.fvg,s.liquidity_sweep,s.vwap_confirm,s.mtf_confirm,s.order_block_confirm,s.market_phase,
    s.equal_highs,s.equal_lows,s.premium_discount,s.fib_zone,s.fvg_state,s.ob_state,s.kill_zone,JSON.stringify(s.score_breakdown),s.reason,
    s.news_risk,s.news_bias,s.news_summary,s.setup_key,s.execution_mode,s.quality_score,s.confidence_lower,s.decision_reason,s.regime,s.signal_source
  ]);
  return inserted.rows.length > 0;
}

async function saveNews(n) {
  if (!pool) {
    if (memoryNews.some(x => x.external_id === n.external_id)) return;
    memoryNews.unshift({ id: Date.now(), received_at: new Date().toISOString(), ...n });
    memoryNews = memoryNews.slice(0, 1000);
    return;
  }
  await pool.query(`INSERT INTO news_events (external_id,published_at,title,summary,source,url,symbols,impact,bias,category,raw,provider,sentiment,relevance,confidence,scheduled)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT DO NOTHING`,
    [n.external_id,n.published_at,n.title,n.summary,n.source,n.url,n.symbols,n.impact,n.bias,n.category,JSON.stringify(n.raw),n.provider,n.sentiment,n.relevance,n.confidence,n.scheduled]);
}

async function listSignals(mode = "active", filters = {}) {
  await archiveOldSignals();
  const limit = Math.min(500, Math.max(1, num(filters.limit, mode === "archive" ? 200 : 100)));
  if (!pool) {
    let arr = memorySignals.filter(x => mode === "archive" ? !!x.archived_at : !x.archived_at);
    if (filters.symbol) arr = arr.filter(x => x.symbol.includes(canonicalSymbol(filters.symbol)));
    if (filters.side) arr = arr.filter(x => x.signal === filters.side.toUpperCase());
    if (filters.status) arr = arr.filter(x => x.status === filters.status.toUpperCase());
    return arr.slice(0, limit);
  }
  const cond = [mode === "archive" ? "archived_at IS NOT NULL" : "archived_at IS NULL"];
  const vals = [];
  const add = (sql, val) => { vals.push(val); cond.push(sql.replace("?", `$${vals.length}`)); };
  if (filters.symbol) add("symbol ILIKE ?", `%${canonicalSymbol(filters.symbol)}%`);
  if (filters.side) add("signal = ?", filters.side.toUpperCase());
  if (filters.status) add("status = ?", filters.status.toUpperCase());
  vals.push(limit);
  return (await pool.query(`SELECT * FROM signals WHERE ${cond.join(" AND ")} ORDER BY received_at DESC LIMIT $${vals.length}`, vals)).rows;
}

async function allSignalsForAnalytics() {
  if (!pool) return memorySignals;
  return (await pool.query("SELECT * FROM signals ORDER BY received_at DESC LIMIT 10000")).rows;
}

function groupStats(data, keyFn) {
  const map = {};
  for (const x of data) {
    const key = keyFn(x) || "N/A";
    if (!map[key]) map[key] = { key, total: 0, closed: 0, wins: 0, losses: 0, totalR: 0 };
    const g = map[key]; g.total++;
    if (x.status === "CLOSED") { g.closed++; const r = num(x.pnl_r); g.totalR += r; if (r > 0) g.wins++; if (r < 0) g.losses++; }
  }
  return Object.values(map).map(g => ({ ...g, winRate: g.closed ? g.wins / g.closed * 100 : 0, avgR: g.closed ? g.totalR / g.closed : 0 }));
}

async function analytics() {
  const data = await allSignalsForAnalytics();
  const closed = data.filter(x => x.status === "CLOSED");
  const wins = closed.filter(x => num(x.pnl_r) > 0), losses = closed.filter(x => num(x.pnl_r) < 0);
  const totalR = closed.reduce((a, x) => a + num(x.pnl_r), 0);
  const grossWin = wins.reduce((a, x) => a + num(x.pnl_r), 0);
  const grossLoss = Math.abs(losses.reduce((a, x) => a + num(x.pnl_r), 0));
  let eq = 0;
  const equityCurve = [...closed].sort((a,b)=>new Date(a.closed_at||a.received_at)-new Date(b.closed_at||b.received_at))
    .map(x=>({time:x.closed_at||x.received_at,equity:(eq+=num(x.pnl_r))}));
  const setups = groupStats(closed, x => x.setup_key).filter(x => x.closed >= 3).sort((a,b) => b.avgR - a.avgR).slice(0, 15);
  return { summary: {
      total:data.length, active:data.filter(x=>!x.archived_at).length, archived:data.filter(x=>x.archived_at).length,
      open:data.filter(x=>x.status==="OPEN").length, closed:closed.length, wins:wins.length, losses:losses.length,
      winRate:closed.length?wins.length/closed.length*100:0, totalR, profitFactor:grossLoss?grossWin/grossLoss:(grossWin>0?null:0),
      avgScore:data.length?data.reduce((a,x)=>a+num(x.score),0)/data.length:0,
      avgAdaptiveScore:data.length?data.reduce((a,x)=>a+num(x.adaptive_score,x.score),0)/data.length:0
    }, bySymbol:groupStats(data,x=>x.symbol), bySession:groupStats(data,x=>x.session_name),
    byMarketPhase:groupStats(data,x=>x.market_phase), topSetups:setups, equityCurve };
}

async function closeSignal(payload) {
  const externalId = clean(payload.external_id || payload.signal_id, 120);
  const result = clean(payload.result, 20).toUpperCase();
  if (!externalId) throw new Error("Lipsește external_id");
  if (!["TP1","TP2","TP3","TP1_BE","TP2_BE","SL","BE","CLOSED","EXPIRED"].includes(result)) throw new Error("Rezultat invalid");
  let signal;
  if (!pool) signal = memorySignals.find(item => item.external_id === externalId);
  else signal = (await pool.query(`SELECT * FROM signals WHERE external_id=$1`, [externalId])).rows[0];
  if (!signal) throw new Error("Semnal negăsit");
  const entry = num(signal.price);
  const sl = num(signal.sl);
  const resultPrice = result === "SL" ? sl
    : result === "TP1" ? num(signal.tp1)
    : result === "TP2" ? num(signal.tp2)
    : result === "TP3" ? num(signal.tp3)
    : num(payload.exit_price, entry);
  const pnlR = outcomeR(signal, result, payload);
  if (!pool) {
    const closedAt = new Date().toISOString();
    Object.assign(signal,{status:"CLOSED",result,pnl_r:pnlR,exit_price:resultPrice,closed_at:closedAt});
    const setup = memorySmcSetups.find(item => item.signal_external_id === externalId);
    if (setup) Object.assign(setup,{status:"CLOSED",result,pnl_r:pnlR,closed_at:closedAt,updated_at:closedAt,terminal_reason:`Rezultat ${result}: ${pnlR.toFixed(2)}R`});
    return signal;
  }
  const q = await pool.query(`UPDATE signals SET status='CLOSED',result=$1,pnl_r=$2,exit_price=$3,closed_at=NOW() WHERE external_id=$4 RETURNING *`,[result,pnlR,resultPrice,externalId]);
  if (!q.rows.length) throw new Error("Semnal negăsit");
  await pool.query(
    `UPDATE smc_setups
     SET status='CLOSED',result=$1,pnl_r=$2,closed_at=NOW(),updated_at=NOW(),terminal_reason=$3
     WHERE signal_external_id=$4`,
    [result,pnlR,`Rezultat ${result}: ${pnlR.toFixed(2)}R`,externalId]
  );
  return q.rows[0];
}

function parseBody(req) {
  let payload = req.body;
  if (Buffer.isBuffer(payload)) payload = payload.toString("utf8");
  if (typeof payload === "string") {
    const raw = payload.trim(); if (!raw) throw new Error("Payload gol");
    try { payload = JSON.parse(raw); } catch { throw new Error("Mesajul nu este JSON valid"); }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Payload invalid");
  return payload;
}

function requireAdmin(req, res) {
  const key = req.body?.adminKey || req.query.adminKey || req.get("x-admin-key") || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) { res.status(401).json({ok:false,error:"ADMIN_KEY incorectă"}); return false; }
  return true;
}


function parseCsvLine(line, delimiter) {
  const out=[]; let value="", quoted=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(quoted && line[i+1]==='"'){value+='"';i++;}
      else quoted=!quoted;
    } else if(ch===delimiter && !quoted){out.push(value.trim());value="";}
    else value+=ch;
  }
  out.push(value.trim()); return out;
}

function normalizeHeader(v){return String(v||"").trim().toLowerCase().replace(/[\s_.-]+/g,"");}
function detectDelimiter(line){const candidates=[",",";","\t","|"];return candidates.sort((a,b)=>(line.split(b).length-line.split(a).length))[0];}
function parseDateValue(dateValue,timeValue=""){
  const raw=`${dateValue||""} ${timeValue||""}`.trim();
  if(!raw) return null;
  let d=new Date(raw);
  if(!Number.isNaN(d.getTime())) return d;
  const m=raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if(m){d=new Date(Date.UTC(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]||0),Number(m[5]||0),Number(m[6]||0)));return d;}
  const unix=Number(dateValue); if(Number.isFinite(unix) && unix>1000000000)return new Date(unix<100000000000?unix*1000:unix);
  return null;
}
function parseHistoricalCsv(csv,{symbol,timeframe,timezoneOffsetMinutes=0}={}){
  const lines=String(csv||"").replace(/^\uFEFF/,"").split(/\r?\n/).filter(x=>x.trim());
  if(lines.length<2) throw new Error("Fișierul CSV nu conține suficiente rânduri");
  const delimiter=detectDelimiter(lines[0]);
  const headers=parseCsvLine(lines[0],delimiter).map(normalizeHeader);
  const find=(...names)=>headers.findIndex(h=>names.includes(h));
  const ix={date:find("date","datetime","timestamp","time","data"),clock:find("clock","hour","ora"),open:find("open","o","deschidere"),high:find("high","h","max","maxim"),low:find("low","l","min","minim"),close:find("close","c","last","inchidere"),volume:find("volume","vol","tickvolume")};
  if(ix.date<0||ix.open<0||ix.high<0||ix.low<0||ix.close<0) throw new Error(`Coloane necesare: Date/Datetime, Open, High, Low, Close. Detectate: ${headers.join(", ")}`);
  const bars=[]; let rejected=0;
  for(let i=1;i<lines.length;i++){
    const cells=parseCsvLine(lines[i],delimiter); const d=parseDateValue(cells[ix.date],ix.clock>=0?cells[ix.clock]:"");
    const o=Number(String(cells[ix.open]).replace(",",".")),h=Number(String(cells[ix.high]).replace(",",".")),l=Number(String(cells[ix.low]).replace(",",".")),c=Number(String(cells[ix.close]).replace(",",".")),v=ix.volume>=0?Number(String(cells[ix.volume]).replace(",",".")):0;
    if(!d||[o,h,l,c].some(x=>!Number.isFinite(x))||h<l||h<Math.max(o,c)||l>Math.min(o,c)){rejected++;continue;}
    d.setUTCMinutes(d.getUTCMinutes()-Number(timezoneOffsetMinutes||0));
    const sym=canonicalSymbol(symbol||"US30"),tf=clean(timeframe||"5",20);
    bars.push({external_id:`CSV-${sym}-${tf}-${d.getTime()}`,bar_time:d.toISOString(),symbol:sym,timeframe:tf,open:o,high:h,low:l,close:c,volume:Number.isFinite(v)?v:0});
  }
  bars.sort((a,b)=>new Date(a.bar_time)-new Date(b.bar_time));
  const dedup=[...new Map(bars.map(x=>[x.external_id,x])).values()];
  if(!dedup.length) throw new Error("Nu am putut interpreta nicio lumânare validă");
  return {bars:dedup,rejected,delimiter,headers};
}
async function saveBarsBatch(bars){
  const normalizedBars=bars.map(b=>({...b,symbol:canonicalSymbol(b.symbol)}));
  if(!pool){let inserted=0;for(const b of normalizedBars)if(await saveBar(b))inserted++;return inserted;}
  let inserted=0;
  for(let i=0;i<normalizedBars.length;i+=2000){
    const chunk=normalizedBars.slice(i,i+2000), values=[], params=[]; let n=1;
    for(const b of chunk){values.push(`($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`);params.push(b.external_id,b.bar_time,b.symbol,b.timeframe,b.open,b.high,b.low,b.close,b.volume);}
    const q=await pool.query(`INSERT INTO market_bars(external_id,bar_time,symbol,timeframe,open,high,low,close,volume) VALUES ${values.join(",")} ON CONFLICT DO NOTHING`,params);inserted+=q.rowCount;
  }
  return inserted;
}
async function getBarsForBacktest(symbol,timeframe,limit=250000){
  if(!pool)return memoryBars.filter(x=>x.symbol===symbol&&x.timeframe===timeframe).sort((a,b)=>new Date(a.bar_time)-new Date(b.bar_time)).slice(-limit);
  return (await pool.query(`SELECT * FROM market_bars WHERE symbol=$1 AND timeframe=$2 ORDER BY bar_time ASC LIMIT $3`,[symbol,timeframe,limit])).rows;
}
async function saveBacktestRun(run){
  if(!pool){global.lastMemoryBacktest=run;return {id:"memory",...run};}
  const settingsJson=JSON.stringify(run.settings ?? {});
  const summaryJson=JSON.stringify(run.summary ?? {});
  const resultsJson=JSON.stringify(Array.isArray(run.results) ? run.results : []);
  const q=await pool.query(
    `INSERT INTO backtest_runs(symbol,timeframe,bars,start_time,end_time,settings,summary,results)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb) RETURNING *`,
    [run.symbol,run.timeframe,run.bars,run.start_time,run.end_time,settingsJson,summaryJson,resultsJson]
  );
  return q.rows[0];
}
async function latestBacktest(){if(!pool)return global.lastMemoryBacktest||null;return (await pool.query(`SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT 1`)).rows[0]||null;}

async function logTelegram({ signal = null, status, messageId = null, details = "" }) {
  const row = { id: Date.now(), created_at: new Date().toISOString(), external_id: signal?.external_id || null, symbol: signal?.symbol || null, side: signal?.signal || null, status, message_id: messageId ? String(messageId) : null, details: clean(details, 1000) };
  if (!pool) { global.memoryTelegramLogs = global.memoryTelegramLogs || []; global.memoryTelegramLogs.unshift(row); global.memoryTelegramLogs = global.memoryTelegramLogs.slice(0, 200); return row; }
  return (await pool.query(`INSERT INTO telegram_logs(external_id,symbol,side,status,message_id,details) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [row.external_id,row.symbol,row.side,row.status,row.message_id,row.details])).rows[0];
}

async function notifyTelegramSignal(signal) {
  const effectiveScore = num(signal.adaptive_score ?? signal.score);
  const isSmcActivation = String(signal.external_id || "").startsWith("SMC-LIVE-");
  const notificationThreshold = isSmcActivation ? SMC_NOTIFY_PENDING_SCORE : telegram.MIN_SCORE;
  const skip = async reason => {
    lastTelegramAt = new Date().toISOString();
    lastTelegramResult = `OMIS ${signal.external_id}: ${reason}`;
    await logTelegram({signal,status:"SKIPPED",details:lastTelegramResult}).catch(() => {});
    return {skipped:true,reason:lastTelegramResult};
  };
  if (!telegram.status().configured) return skip("Telegram neconfigurat");
  if (signal.execution_mode !== "LIVE") return skip(`execution_mode=${signal.execution_mode}; ${signal.decision_reason || "filtre server"}`);
  if (effectiveScore < notificationThreshold) return skip(`scor ${effectiveScore} sub ${notificationThreshold}`);
  try {
    const result = await telegram.sendSignal(signal);
    lastTelegramAt = new Date().toISOString();
    lastTelegramResult = `TRIMIS ${telegram.sourceLabel(signal)} ${signal.signal} ${signal.symbol}, mesaj ${result.message_id}`;
    await logTelegram({signal,status:"SENT",messageId:result.message_id,details:lastTelegramResult});
    return {skipped:false,messageId:result.message_id};
  } catch (error) {
    lastTelegramAt = new Date().toISOString();
    lastTelegramResult = `EROARE: ${error.message}`;
    await logTelegram({signal,status:"ERROR",details:error.message});
    throw error;
  }
}

app.get("/health", (req,res)=>res.json({ok:true,version:APP_VERSION,database:pool?"postgres":"memory",archiveAfterHours:ARCHIVE_AFTER_HOURS,adminKeyConfigured:Boolean(ADMIN_KEY),newsWebhookConfigured:Boolean(NEWS_WEBHOOK_KEY),officialNewsEnabled:OFFICIAL_NEWS_ENABLED,fmpEnabled:FMP_ENABLED,fmpKeyConfigured:Boolean(FMP_API_KEY),fmpConfigured:FMP_ENABLED&&Boolean(FMP_API_KEY)&&!fmpRuntimeDisabledReason,fmpRuntimeDisabledReason,alphaVantageConfigured:Boolean(ALPHAVANTAGE_API_KEY),finnhubConfigured:Boolean(FINNHUB_API_KEY),autoTrackTrades:AUTO_TRACK_TRADES,lastNewsSync,lastSuccessfulNewsSync,lastNewsSyncError,newsProviders:lastNewsProviderResults,newsCoverage:newsCoverageStatus(),patternMinSamples:PATTERN_MIN_SAMPLES,patternMinProbability:PATTERN_MIN_PROBABILITY,analysisTimeframe:ANALYSIS_TIMEFRAME,analysisTimeframes:ANALYSIS_TIMEFRAMES,analysisProfiles:analysisProfilesPublic(),contextTimeframes:CONTEXT_TIMEFRAMES,symbolAliases:aliasSummary(),lastBarAtByTimeframe:{...lastBarAtByTimeframe},autoPatternSignals:AUTO_PATTERN_SIGNALS,patternSignalMinSamples:PATTERN_SIGNAL_MIN_SAMPLES,patternSignalMinProbability:PATTERN_SIGNAL_MIN_PROBABILITY,patternSignalMinScore:PATTERN_SIGNAL_MIN_SCORE,smcEnabled:SMC_ENABLED,smcMinScore:SMC_MIN_SCORE,smcNotifyPendingScore:SMC_NOTIFY_PENDING_SCORE,smcRequireM5Confirmation:SMC_REQUIRE_M5_CONFIRMATION,liveMinAdaptiveScore:LIVE_MIN_ADAPTIVE_SCORE,learningMinSamples:LEARNING_MIN_SAMPLES,maxNewsRiskLive:MAX_NEWS_RISK_LIVE,maxConsecutiveLosses:MAX_CONSECUTIVE_LOSSES,webhookStaleMinutes:WEBHOOK_STALE_MINUTES,telegramSystemAlerts:TELEGRAM_SYSTEM_ALERTS,telegram:telegram.status(),lastTelegramAt,lastTelegramResult,lastSystemAlertAt,lastWebhookAt,lastWebhookResult,warnings:systemWarnings(),time:new Date().toISOString()}));
app.get("/api/system-status", async(req,res)=>{try{res.json(await buildSystemStatus());}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.get("/api/signals", async(req,res)=>{ try { const mode=req.query.mode==="archive"?"archive":"active"; res.json({ok:true,mode,signals:await listSignals(mode,req.query),analytics:await analytics()}); } catch(e){ console.error(e); res.status(500).json({ok:false,error:e.message}); } });
app.get("/api/analytics", async(req,res)=>{ try { res.json({ok:true,analytics:await analytics()}); } catch(e){res.status(500).json({ok:false,error:e.message});} });
app.post("/api/archive-now", async(req,res)=>{ if(!requireAdmin(req,res))return; try{res.json({ok:true,archived:await archiveOldSignals()});}catch(e){res.status(500).json({ok:false,error:e.message});} });

app.get("/api/news", async(req,res)=>{ try {
  const limit=Math.min(200,Math.max(1,num(req.query.limit,50))); let rows;
  if(!pool) rows=memoryNews.slice(0,limit); else rows=(await pool.query("SELECT * FROM news_events WHERE published_at >= NOW() - ($2 * INTERVAL '1 hour') OR scheduled = TRUE ORDER BY published_at DESC LIMIT $1",[limit,NEWS_MAX_AGE_HOURS])).rows;
  res.json({ok:true,news:rows});
} catch(e){res.status(500).json({ok:false,error:e.message});} });

app.get("/api/news-status",(req,res)=>res.json({ok:true,officialNewsEnabled:OFFICIAL_NEWS_ENABLED,fmpEnabled:FMP_ENABLED,fmpKeyConfigured:Boolean(FMP_API_KEY),fmpConfigured:FMP_ENABLED&&Boolean(FMP_API_KEY)&&!fmpRuntimeDisabledReason,fmpRuntimeDisabledReason,alphaVantageConfigured:Boolean(ALPHAVANTAGE_API_KEY),finnhubConfigured:Boolean(FINNHUB_API_KEY),providerResults:lastNewsProviderResults,lastNewsSync,lastSuccessfulNewsSync,lastSuccessfulCalendarSync,lastNewsSyncError,coverage:newsCoverageStatus(),autoSyncMinutes:NEWS_AUTO_SYNC_MINUTES,maxAgeHours:NEWS_MAX_AGE_HOURS,minRelevance:NEWS_MIN_RELEVANCE}));

app.post("/api/news-sync",async(req,res)=>{if(!requireAdmin(req,res))return;try{res.json({ok:true,...await syncRealNews()});}catch(e){lastNewsSyncError=e.message;res.status(400).json({ok:false,error:e.message});}});

app.post("/api/news", async(req,res)=>{ if(!requireAdmin(req,res))return; try{ const list=Array.isArray(req.body.items)?req.body.items:[req.body]; const saved=[]; for(const p of list){const n=normalizeNews(p);await saveNews(n);saved.push(n);}lastSuccessfulNewsSync=new Date().toISOString();if(saved.some(n=>n.scheduled))lastSuccessfulCalendarSync=lastSuccessfulNewsSync;res.json({ok:true,saved}); }catch(e){res.status(400).json({ok:false,error:e.message});} });

app.post("/news-webhook", async(req,res)=>{ try{
  const key=req.query.key||req.get("x-news-key")||""; if(!NEWS_WEBHOOK_KEY||key!==NEWS_WEBHOOK_KEY)return res.status(401).json({ok:false,error:"NEWS_WEBHOOK_KEY incorectă"});
  const payload=parseBody(req); const list=Array.isArray(payload)?payload:(Array.isArray(payload.items)?payload.items:[payload]); const saved=[];
  for(const p of list){const n=normalizeNews(p);await saveNews(n);saved.push(n);} lastSuccessfulNewsSync=new Date().toISOString(); if(saved.some(n=>n.scheduled))lastSuccessfulCalendarSync=lastSuccessfulNewsSync; res.json({ok:true,count:saved.length,saved});
}catch(e){res.status(400).json({ok:false,error:e.message});} });

app.get("/api/telegram/status", async(req,res)=>{try{let logs;if(!pool)logs=(global.memoryTelegramLogs||[]).slice(0,20);else logs=(await pool.query(`SELECT * FROM telegram_logs ORDER BY created_at DESC LIMIT 20`)).rows;res.json({ok:true,telegram:telegram.status(),lastTelegramAt,lastTelegramResult,logs});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.post("/api/telegram/test", async(req,res)=>{if(!requireAdmin(req,res))return;try{const result=await telegram.sendTest();lastTelegramAt=new Date().toISOString();lastTelegramResult=`TEST TRIMIS, mesaj ${result.message_id}`;await logTelegram({status:"TEST",messageId:result.message_id,details:lastTelegramResult});res.json({ok:true,messageId:result.message_id});}catch(e){lastTelegramAt=new Date().toISOString();lastTelegramResult=`EROARE TEST: ${e.message}`;await logTelegram({status:"ERROR",details:e.message}).catch(()=>{});res.status(400).json({ok:false,error:e.message});}});
app.post("/api/telegram/test-signal", async(req,res)=>{if(!requireAdmin(req,res))return;try{
  const price=num(req.body.price,NaN);if(!Number.isFinite(price)||price<=0)throw new Error("Introdu un preț valid");
  const side=clean(req.body.side||"BUY",10).toUpperCase()==="SELL"?"SELL":"BUY";
  const timeframe=normalizeTimeframe(req.body.timeframe||ANALYSIS_TIMEFRAME,ANALYSIS_TIMEFRAME);
  const risk=Math.max(price*0.0015,num(req.body.atr,0))*1.1;
  const signal={external_id:`TELEGRAM-TEST-${Date.now()}`,signal_source:"TEST",symbol:canonicalSymbol(req.body.symbol||"US30"),timeframe,signal:side,price,sl:side==="BUY"?price-risk:price+risk,tp1:side==="BUY"?price+risk*1.5:price-risk*1.5,tp2:side==="BUY"?price+risk*2.5:price-risk*2.5,tp3:side==="BUY"?price+risk*3.5:price-risk*3.5,score:92,adaptive_score:92,probability:86,execution_mode:"LIVE",session_name:"TEST",structure:"Test traseu complet",decision_reason:"Mesaj demonstrativ; nu reprezintă o recomandare de tranzacționare."};
  const result=await telegram.sendSignal(signal);lastTelegramAt=new Date().toISOString();lastTelegramResult=`TEST SIGNAL TRIMIS ${side} ${signal.symbol}, mesaj ${result.message_id}`;await logTelegram({signal,status:"TEST_SIGNAL",messageId:result.message_id,details:lastTelegramResult});res.json({ok:true,messageId:result.message_id,signal});
}catch(e){lastTelegramAt=new Date().toISOString();lastTelegramResult=`EROARE TEST SIGNAL: ${e.message}`;await logTelegram({status:"ERROR",details:e.message}).catch(()=>{});res.status(400).json({ok:false,error:e.message});}});

app.post("/api/test-signal",async(req,res)=>{ if(!requireAdmin(req,res))return; try{
  const price=num(req.body.price,NaN); if(!Number.isFinite(price)||price<=0)throw new Error("Introdu un preț curent valid pentru test");
  const atr=Math.max(price*0.0015,num(req.body.atr,0)); const risk=atr*1.1;
  const side=clean(req.body.side||"BUY",10).toUpperCase()==="SELL"?"SELL":"BUY";
  const timeframe=normalizeTimeframe(req.body.timeframe||ANALYSIS_TIMEFRAME,ANALYSIS_TIMEFRAME);
  const s=normalizeSignal({external_id:`TEST-${Date.now()}`,signal_source:"TEST",symbol:canonicalSymbol(req.body.symbol||"US30"),timeframe,signal:side,price,
    sl:side==="BUY"?price-risk:price+risk,tp1:side==="BUY"?price+risk*1.5:price-risk*1.5,tp2:side==="BUY"?price+risk*2.5:price-risk*2.5,tp3:side==="BUY"?price+risk*3.5:price-risk*3.5,
    score:88,probability:79,rsi:58.4,atr,rr:3.5,trend:side==="BUY"?"Bullish":"Bearish",structure:`${side} test`,session:"New York",bos:true,fvg:true,liquidity_sweep:true,vwap_confirm:true,mtf_confirm:true,market_phase:"Expansion",premium_discount:side==="BUY"?"Discount":"Premium",reason:`Semnal demonstrativ v18 ${timeframeLabel(timeframe)} la preț introdus manual.`});
  await saveSignal(s);res.json({ok:true,signal:s});
}catch(e){res.status(400).json({ok:false,error:e.message});} });

app.post("/api/test-news",async(req,res)=>{ if(!requireAdmin(req,res))return; try{const n=normalizeNews({external_id:`NEWS-${Date.now()}`,title:"FOMC interest rate decision and Powell press conference",summary:"High-impact Federal Reserve event may increase volatility in US indices and gold.",source:"PropTrader test",symbols:["US30","NAS100","XAUUSD"],impact:90});await saveNews(n);res.json({ok:true,news:n});}catch(e){res.status(500).json({ok:false,error:e.message});} });

app.post("/api/manual-close",async(req,res)=>{if(!requireAdmin(req,res))return;try{res.json({ok:true,closed:await closeSignal(req.body)});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.post("/api/clear",async(req,res)=>{if(!requireAdmin(req,res))return;try{if(pool){await pool.query("DELETE FROM signals");await pool.query("DELETE FROM news_events");await pool.query("DELETE FROM pattern_signals");await pool.query("DELETE FROM smc_setups");await pool.query("DELETE FROM market_bars");}else{memorySignals=[];memoryNews=[];memoryBars=[];memoryPatterns=[];memorySmcSetups=[];}res.json({ok:true});}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.get("/api/patterns",async(req,res)=>{try{res.json({ok:true,patterns:await listPatterns(Math.min(300,Math.max(1,num(req.query.limit,100)))),settings:{minSamples:PATTERN_MIN_SAMPLES,minProbability:PATTERN_MIN_PROBABILITY,lookbackDays:PATTERN_LOOKBACK_DAYS,analysisTimeframes:ANALYSIS_TIMEFRAMES,profiles:analysisProfilesPublic()}});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/smc-setups",async(req,res)=>{try{
  const setups=await listSmcSetups({status:req.query.status,symbol:req.query.symbol,limit:req.query.limit});
  const counts=setups.reduce((out,item)=>{out[item.status]=(out[item.status]||0)+1;return out;},{});
  res.json({ok:true,setups,counts,settings:{enabled:SMC_ENABLED,minScore:SMC_MIN_SCORE,pendingNotificationScore:SMC_NOTIFY_PENDING_SCORE,requireM5Confirmation:SMC_REQUIRE_M5_CONFIRMATION,analysisTimeframes:ANALYSIS_TIMEFRAMES,contextTimeframes:CONTEXT_TIMEFRAMES}});
}catch(e){res.status(500).json({ok:false,error:e.message});}});


app.get("/api/validation",async(req,res)=>{try{
  const rows=await allSignalsForAnalytics();
  const closed=rows.filter(x=>x.status==="CLOSED").sort((a,b)=>new Date(a.closed_at)-new Date(b.closed_at));
  const split=Math.max(1,Math.floor(closed.length*0.8)),train=closed.slice(0,split),test=closed.slice(split);
  const summarize=a=>{const wins=a.filter(x=>num(x.pnl_r)>0).length,total=a.length,totalR=a.reduce((z,x)=>z+num(x.pnl_r),0),grossWin=a.filter(x=>num(x.pnl_r)>0).reduce((z,x)=>z+num(x.pnl_r),0),grossLoss=Math.abs(a.filter(x=>num(x.pnl_r)<0).reduce((z,x)=>z+num(x.pnl_r),0));return {trades:total,winRate:total?wins/total*100:0,lowerBound:wilsonLowerBound(wins,total)*100,avgR:total?totalR/total:0,profitFactor:grossLoss?grossWin/grossLoss:(grossWin>0?null:0),totalR};};
  const t=summarize(train),v=summarize(test),all=summarize(closed);
  let peak=0,eq=0,maxDD=0;for(const x of closed){eq+=num(x.pnl_r);peak=Math.max(peak,eq);maxDD=Math.max(maxDD,peak-eq);}
  const calibrated=closed.filter(x=>Number.isFinite(num(x.probability,NaN)));
  const brier=calibrated.length?calibrated.reduce((a,x)=>{const pr=num(x.probability)/100,y=num(x.pnl_r)>0?1:0;return a+(pr-y)**2},0)/calibrated.length:null;
  const ready=closed.length>=VALIDATION_MIN_TRADES&&v.trades>=10&&v.avgR>0&&v.lowerBound>=45&&maxDD<=Math.max(6,all.totalR*0.8+4);
  res.json({ok:true,validation:{ready,requiredTrades:VALIDATION_MIN_TRADES,all,train:t,test:v,maxDrawdownR:maxDD,brierScore:brier,closedTrades:closed.length,message:ready?"Există dovezi preliminare pe segmentul de validare. Continuă monitorizarea și controlul riscului.":"Date insuficiente sau validarea pe date nevăzute nu confirmă încă avantajul statistic."}});
}catch(e){res.status(500).json({ok:false,error:e.message});}});



const DUKASCOPY_INSTRUMENTS = {
  US30: { instrument: "usa30idxusd", label: "US30 / USA 30 Index" },
  XAUUSD: { instrument: "xauusd", label: "Gold / XAUUSD" },
  NAS100: { instrument: "usatechidxusd", label: "NAS100 / US 100 Tech" }
};
const DUKASCOPY_TIMEFRAMES = {"1":"m1","5":"m5","15":"m15","30":"m30","60":"h1","240":"h4","1440":"d1"};
function dateOnlyUtc(d){return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));}
function addUtcDays(d,n){const x=new Date(d);x.setUTCDate(x.getUTCDate()+n);return x;}
function historyJobPublic(){
  if(!historyDownloadJob)return null;
  const {id,status,symbol,timeframe,priceType,from,to,startedAt,finishedAt,currentFrom,currentTo,chunksDone,chunksTotal,downloaded,inserted,duplicates,error,retries,lastSuccessfulTo,log}=historyDownloadJob;
  return {id,status,symbol,timeframe,priceType,from,to,startedAt,finishedAt,currentFrom,currentTo,chunksDone,chunksTotal,downloaded,inserted,duplicates,error,retries,lastSuccessfulTo,log:(log||[]).slice(-40),progress:chunksTotal?Math.min(100,Math.round(chunksDone/chunksTotal*100)):0};
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function normalizeDukascopyRows(data){
  if(Array.isArray(data))return data;
  if(data&&Array.isArray(data.data))return data.data;
  if(data&&Array.isArray(data.rows))return data.rows;
  if(data&&Array.isArray(data.candles))return data.candles;
  return [];
}
async function fetchDukascopyChunk(options,job){
  let lastError;
  for(let attempt=1;attempt<=HISTORY_RETRY_ATTEMPTS;attempt++){
    try{
      if(attempt>1){job.retries++;job.log.push(`${new Date().toISOString()} Retry ${attempt}/${HISTORY_RETRY_ATTEMPTS}`);}
      return await getHistoricalRates(options);
    }catch(e){
      lastError=e;job.log.push(`${new Date().toISOString()} Eroare încercarea ${attempt}: ${e.message||e}`);
      if(attempt<HISTORY_RETRY_ATTEMPTS)await sleep(HISTORY_RETRY_BASE_MS*Math.pow(2,attempt-1));
    }
  }
  throw lastError||new Error("Descărcarea lotului a eșuat");
}
async function runDukascopyDownload(job){
  try{
    const cfg=DUKASCOPY_INSTRUMENTS[job.symbol],tf=DUKASCOPY_TIMEFRAMES[job.timeframe];
    let cursor=new Date(job.resumeFrom||job.from), finalTo=new Date(job.to);
    while(cursor<finalTo){
      const chunkTo=new Date(Math.min(addUtcDays(cursor,HISTORY_CHUNK_DAYS).getTime(),finalTo.getTime()));
      job.currentFrom=cursor.toISOString();job.currentTo=chunkTo.toISOString();job.error="";
      job.log.push(`${new Date().toISOString()} Lot ${job.chunksDone+1}/${job.chunksTotal}: ${job.currentFrom} → ${job.currentTo}`);
      const data=await fetchDukascopyChunk({instrument:cfg.instrument,dates:{from:cursor,to:chunkTo},timeframe:tf,format:"json",priceType:job.priceType},job);
      const sourceRows=normalizeDukascopyRows(data);
      const rows=sourceRows.filter(x=>x&&Number.isFinite(Number(x.timestamp))&&Number.isFinite(Number(x.open))&&Number.isFinite(Number(x.high))&&Number.isFinite(Number(x.low))&&Number.isFinite(Number(x.close))).map(x=>({
        external_id:`DUKA-${cfg.instrument}-${tf}-${job.priceType}-${Number(x.timestamp)}`,
        bar_time:new Date(Number(x.timestamp)).toISOString(),symbol:job.symbol,timeframe:job.timeframe,
        open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume||0)
      }));
      const added=rows.length?await saveBarsBatch(rows):0;
      job.downloaded+=rows.length;job.inserted+=added;job.duplicates+=Math.max(0,rows.length-added);job.chunksDone++;job.lastSuccessfulTo=chunkTo.toISOString();
      job.log.push(`${new Date().toISOString()} Salvat: ${added}; duplicate: ${Math.max(0,rows.length-added)}`);
      cursor=chunkTo;
    }
    job.status="COMPLETED";job.finishedAt=new Date().toISOString();job.currentFrom=null;job.currentTo=null;job.error="";
  }catch(e){job.status="FAILED";job.error=e.message||String(e);job.resumeFrom=job.lastSuccessfulTo||job.currentFrom||job.from;job.finishedAt=new Date().toISOString();job.log.push(`${new Date().toISOString()} FAILED: ${job.error}`);console.error("Dukascopy history download:",e);}
}
app.post("/api/history-download",async(req,res)=>{if(!requireAdmin(req,res))return;try{
  if(historyDownloadJob&&historyDownloadJob.status==="RUNNING")throw new Error("Există deja o descărcare în curs. Așteaptă finalizarea ei.");
  const symbol=canonicalSymbol(req.body.symbol||"US30");if(!DUKASCOPY_INSTRUMENTS[symbol])throw new Error("Instrument neacceptat. Alege US30, XAUUSD sau NAS100.");
  const timeframe=clean(req.body.timeframe||"5",10);if(!DUKASCOPY_TIMEFRAMES[timeframe])throw new Error("Timeframe neacceptat.");
  const priceType=clean(req.body.priceType||"bid",10).toLowerCase()==="ask"?"ask":"bid";
  const years=Math.max(1,Math.min(10,Math.floor(num(req.body.years,5))));
  const to=dateOnlyUtc(new Date());const from=new Date(to);from.setUTCFullYear(from.getUTCFullYear()-years);
  const chunksTotal=Math.ceil((to-from)/(HISTORY_CHUNK_DAYS*86400000));
  const previous=historyDownloadJob&&historyDownloadJob.symbol===symbol&&historyDownloadJob.timeframe===timeframe&&historyDownloadJob.priceType===priceType?historyDownloadJob:null;
  const resumeFrom=(previous&&previous.status==="FAILED"&&previous.lastSuccessfulTo)?previous.lastSuccessfulTo:from.toISOString();
  const alreadyDone=Math.max(0,Math.floor((new Date(resumeFrom)-from)/(HISTORY_CHUNK_DAYS*86400000)));
  historyDownloadJob={id:`HIST-${Date.now()}`,status:"RUNNING",symbol,timeframe,priceType,from:from.toISOString(),to:to.toISOString(),resumeFrom,startedAt:new Date().toISOString(),finishedAt:null,currentFrom:null,currentTo:null,chunksDone:alreadyDone,chunksTotal,downloaded:0,inserted:0,duplicates:0,retries:0,lastSuccessfulTo:resumeFrom,error:"",log:[`${new Date().toISOString()} Pornire${alreadyDone?`/reluare de la lotul ${alreadyDone+1}`:""}`]};
  setImmediate(()=>runDukascopyDownload(historyDownloadJob));
  res.status(202).json({ok:true,job:historyJobPublic()});
}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.get("/api/history-download/status",(req,res)=>res.json({ok:true,job:historyJobPublic(),instruments:DUKASCOPY_INSTRUMENTS,timeframes:DUKASCOPY_TIMEFRAMES}));

app.post("/api/history-import",async(req,res)=>{if(!requireAdmin(req,res))return;try{
  const parsed=parseHistoricalCsv(req.body.csv,{symbol:req.body.symbol,timeframe:req.body.timeframe,timezoneOffsetMinutes:req.body.timezoneOffsetMinutes});
  const inserted=await saveBarsBatch(parsed.bars);const first=parsed.bars[0],last=parsed.bars[parsed.bars.length-1];
  res.json({ok:true,parsed:parsed.bars.length,inserted,rejected:parsed.rejected,first:first.bar_time,last:last.bar_time,symbol:first.symbol,timeframe:first.timeframe});
}catch(e){res.status(400).json({ok:false,error:e.message});}});

app.post("/api/history-aggregate",async(req,res)=>{if(!requireAdmin(req,res))return;try{
  const symbol=canonicalSymbol(req.body.symbol||"US30");
  const sourceTimeframe=clean(req.body.sourceTimeframe||"5",20);
  const targetTimeframe=clean(req.body.targetTimeframe||ANALYSIS_TIMEFRAME,20);
  const sourceRaw=await getBarsForBacktest(symbol,sourceTimeframe,500000);
  const sourceBars=Array.isArray(sourceRaw)?sourceRaw:(sourceRaw&&Array.isArray(sourceRaw.rows)?sourceRaw.rows:[]);
  if(!sourceBars.length)throw new Error(`Nu există date ${symbol} M${sourceTimeframe} pentru agregare.`);
  const aggregated=aggregateBars(sourceBars,sourceTimeframe,targetTimeframe,{requireComplete:true});
  if(!aggregated.length)throw new Error("Nu s-au putut construi lumânări complete pentru timeframe-ul țintă.");
  const inserted=await saveBarsBatch(aggregated);
  res.json({ok:true,symbol,sourceTimeframe,targetTimeframe,generated:aggregated.length,inserted,duplicates:aggregated.length-inserted,first:aggregated[0].bar_time,last:aggregated[aggregated.length-1].bar_time});
}catch(e){res.status(400).json({ok:false,error:e.message});}});

app.post("/api/history-aggregate-all",async(req,res)=>{if(!requireAdmin(req,res))return;try{
  const symbol=canonicalSymbol(req.body.symbol||"US30");
  const sourceTimeframe="5";
  const sourceRaw=await getBarsForBacktest(symbol,sourceTimeframe,500000);
  const sourceBars=Array.isArray(sourceRaw)?sourceRaw:(sourceRaw&&Array.isArray(sourceRaw.rows)?sourceRaw.rows:[]);
  if(!sourceBars.length)throw new Error(`Nu există date ${symbol} M5 pentru agregare.`);
  const results=[];
  for(const targetTimeframe of [...new Set([...ANALYSIS_TIMEFRAMES, ...CONTEXT_TIMEFRAMES])].filter(item=>item!=="5").sort((a,b)=>num(a)-num(b))){
    const aggregated=aggregateBars(sourceBars,sourceTimeframe,targetTimeframe,{requireComplete:true});
    const inserted=aggregated.length?await saveBarsBatch(aggregated):0;
    results.push({
      targetTimeframe,
      label:timeframeLabel(targetTimeframe),
      generated:aggregated.length,
      inserted,
      duplicates:aggregated.length-inserted,
      first:aggregated[0]?.bar_time||null,
      last:aggregated[aggregated.length-1]?.bar_time||null
    });
  }
  res.json({ok:true,symbol,sourceTimeframe,analysisTimeframes:ANALYSIS_TIMEFRAMES,results});
}catch(e){res.status(400).json({ok:false,error:e.message});}});

app.post("/api/backtest",async(req,res)=>{if(!requireAdmin(req,res))return;try{
  const symbol=canonicalSymbol(req.body.symbol||"US30");
  const timeframe=clean(req.body.timeframe||ANALYSIS_TIMEFRAME,20);
  const settings={
    horizonBars:Math.max(1,Math.min(24,num(req.body.horizonBars,3))),
    minSamples:Math.max(30,num(req.body.minSamples,60)),
    minProbability:Math.max(40,Math.min(90,num(req.body.minProbability,55))),
    costBps:Math.max(0,Math.min(50,num(req.body.costBps,2))),
    slippageBps:Math.max(0,Math.min(25,num(req.body.slippageBps,0.5))),
    walkForwardFolds:Math.max(3,Math.min(10,num(req.body.walkForwardFolds,5))),
    stopAtr:Math.max(0.5,Math.min(4,num(req.body.stopAtr,1.2))),
    targetR:Math.max(0.75,Math.min(5,num(req.body.targetR,1.5)))
  };
  const barsRaw=await getBarsForBacktest(symbol,timeframe);
  const normalized=Array.isArray(barsRaw)?barsRaw:(barsRaw&&Array.isArray(barsRaw.rows)?barsRaw.rows:[]);
  const audited=auditBars(normalized,timeframe);
  const bars=audited.bars;
  if(bars.length<settings.minSamples+settings.horizonBars+60)throw new Error(`Istoric insuficient: ${bars.length} lumânări valide. Importă sau generează mai multe date.`);
  const report=buildBacktest(bars,settings);
  report.summary.dataAudit=audited.audit;
  const run=await saveBacktestRun({symbol,timeframe,bars:bars.length,start_time:bars[0].bar_time,end_time:bars[bars.length-1].bar_time,settings,summary:report.summary,results:report.results});
  res.json({ok:true,run});
}catch(e){console.error("[BACKTEST] EROARE:",e);res.status(400).json({ok:false,error:e.message});}});
app.get("/api/backtest/latest",async(req,res)=>{try{res.json({ok:true,run:await latestBacktest()});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/history-status",async(req,res)=>{try{
  let rows;
  if(!pool){
    const m=new Map();
    for(const b of memoryBars){const k=`${b.symbol}|${b.timeframe}`;if(!m.has(k))m.set(k,{symbol:b.symbol,timeframe:b.timeframe,bars:0,start_time:b.bar_time,end_time:b.bar_time});const x=m.get(k);x.bars++;if(b.bar_time<x.start_time)x.start_time=b.bar_time;if(b.bar_time>x.end_time)x.end_time=b.bar_time;}
    rows=[...m.values()];
  }else{
    const queryResult=await pool.query(`SELECT symbol,timeframe,COUNT(*)::int bars,MIN(bar_time) start_time,MAX(bar_time) end_time FROM market_bars GROUP BY symbol,timeframe ORDER BY symbol,timeframe`);
    rows=Array.isArray(queryResult?.rows)?queryResult.rows:[];
  }
  const datasets=Array.isArray(rows)?rows:[];
  res.json({ok:true,datasets});
}catch(e){res.status(500).json({ok:false,error:e.message,datasets:[]});}});

app.get("/api/export.csv",async(req,res)=>{try{const rows=await allSignalsForAnalytics();const cols=["received_at","archived_at","symbol","timeframe","signal","status","result","price","sl","tp1","tp2","tp3","score","adaptive_score","learning_adjustment","news_risk","news_bias","pnl_r","session_name","structure","reason"];const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;const csv=[cols.join(','),...rows.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\n');res.setHeader("content-type","text/csv; charset=utf-8");res.setHeader("content-disposition",'attachment; filename="proptrader-journal.csv"');res.send('\ufeff'+csv);}catch(e){res.status(500).send(e.message);}});

app.post("/webhook", async(req,res)=>{try{
  lastWebhookAt = new Date().toISOString();
  const key=req.query.key||req.get("x-webhook-key")||"";
  if(!WEBHOOK_KEY||key!==WEBHOOK_KEY){ lastWebhookResult="RESPINS: WEBHOOK_KEY incorectă"; console.warn(`[WEBHOOK] ${lastWebhookResult}`); return res.status(401).json({ok:false,error:"WEBHOOK_KEY incorectă"}); }
  const payload=parseBody(req); const event=clean(payload.event||"SIGNAL",20).toUpperCase();
  console.log(`[WEBHOOK] primit event=${event} symbol=${payload.symbol||payload.ticker||"N/A"} side=${payload.signal||payload.side||"N/A"} tf=${payload.timeframe||payload.interval||"N/A"}`);
  if(event==="CLOSE"){const closed=await closeSignal(payload);lastWebhookResult=`ACCEPTAT CLOSE ${payload.external_id||payload.signal_id||""}`;return res.json({ok:true,closed});}
  if(event==="BAR"){
    const bar=normalizeBar(payload);
    const inserted=await saveBar(bar);
    if(!inserted){
      lastWebhookResult=`DUPLICAT BAR ${bar.symbol} ${timeframeLabel(bar.timeframe)}`;
      return res.json({ok:true,event:"BAR",duplicate:true,bar,analysisTimeframes:ANALYSIS_TIMEFRAMES});
    }
    const derived=await deriveCompletedHigherBars(bar);
    const analyses=[await processNewBar(bar,{trackTrades:true})];
    for(const higherBar of derived)analyses.push(await processNewBar(higherBar,{trackTrades:false}));
    const generatedSignals=analyses.flatMap(item=>[item.generatedSignal,...(Array.isArray(item.smcActivatedSignals)?item.smcActivatedSignals:[])]).filter(Boolean);
    const plannedSetups=analyses.flatMap(item=>Array.isArray(item.smcSetups)?item.smcSetups:[]);
    const labels=analyses.filter(item=>item.analyzed).map(item=>timeframeLabel(item.bar.timeframe)).join(", ");
    lastWebhookResult=`ACCEPTAT BAR ${bar.symbol} ${timeframeLabel(bar.timeframe)} · analizate ${labels||"niciun interval"}${derived.length?` · agregate ${derived.map(item=>timeframeLabel(item.timeframe)).join(", ")}`:""}${plannedSetups.length?` · ${plannedSetups.length} plan(uri) SMC noi`:""}${generatedSignals.length?` · ${generatedSignals.length} semnal(e) activ(e)`:""}`;
    return res.json({ok:true,event:"BAR",bar,analysisTimeframes:ANALYSIS_TIMEFRAMES,derivedBars:derived,analyses,plannedSetups,generatedSignals});
  }
  const signal=normalizeSignal(payload); if(!["BUY","SELL"].includes(signal.signal)) throw new Error("Semnalul trebuie să fie BUY sau SELL"); const inserted=await saveSignal(signal); if(inserted) notifyTelegramSignal(signal).catch(e=>console.error("[TELEGRAM]",e.message)); lastWebhookResult=`ACCEPTAT ${signal.signal} ${signal.symbol} ${signal.timeframe} la ${signal.price}`; console.log(`[WEBHOOK] ${lastWebhookResult}`); return res.json({ok:true,signal});
}catch(e){lastWebhookResult=`RESPINS: ${e.message}`;console.error("POST /webhook:",e);return res.status(400).json({ok:false,error:e.message});}});

initDb().then(async()=>{
  await archiveOldSignals();
  setInterval(()=>archiveOldSignals().catch(e=>console.error("Auto-archive:",e)),15*60*1000).unref();
  if(OFFICIAL_NEWS_ENABLED||(FMP_ENABLED&&FMP_API_KEY)||ALPHAVANTAGE_API_KEY||FINNHUB_API_KEY){syncRealNews().catch(e=>{lastNewsSyncError=e.message;console.error("News sync:",e.message)});setInterval(()=>syncRealNews().catch(e=>{lastNewsSyncError=e.message;console.error("News sync:",e.message)}),NEWS_AUTO_SYNC_MINUTES*60000).unref();}
  setTimeout(()=>monitorSystem().catch(e=>console.error("System monitor:",e.message)),15000).unref();
  setInterval(()=>monitorSystem().catch(e=>console.error("System monitor:",e.message)),SYSTEM_MONITOR_INTERVAL_MINUTES*60000).unref();
  app.listen(PORT,()=>console.log(`PropTrader AI v18.2 rulează pe portul ${PORT}`));
}).catch(e=>{console.error("DB init failed:",e);process.exit(1)});
