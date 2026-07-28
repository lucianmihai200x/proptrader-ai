
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_KEY = process.env.WEBHOOK_KEY || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL || "";

const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

let memorySignals = [];

app.use(express.json({ limit: "500kb" }));
app.use(express.static(path.join(__dirname, "public")));

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS signals (
      id BIGSERIAL PRIMARY KEY,
      external_id TEXT UNIQUE,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      symbol TEXT NOT NULL,
      timeframe TEXT,
      signal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      result TEXT,
      price NUMERIC,
      sl NUMERIC,
      tp1 NUMERIC,
      tp2 NUMERIC,
      tp3 NUMERIC,
      exit_price NUMERIC,
      pnl_r NUMERIC,
      score NUMERIC,
      probability NUMERIC,
      rsi NUMERIC,
      atr NUMERIC,
      rr NUMERIC,
      trend TEXT,
      structure TEXT,
      session_name TEXT,
      mtf_trend TEXT,
      vwap_side TEXT,
      order_block TEXT,
      bos BOOLEAN DEFAULT FALSE,
      choch BOOLEAN DEFAULT FALSE,
      fvg BOOLEAN DEFAULT FALSE,
      liquidity_sweep BOOLEAN DEFAULT FALSE,
      vwap_confirm BOOLEAN DEFAULT FALSE,
      mtf_confirm BOOLEAN DEFAULT FALSE,
      order_block_confirm BOOLEAN DEFAULT FALSE,
      reason TEXT
    )
  `);

  const additions = [
    ["external_id", "TEXT UNIQUE"],
    ["closed_at", "TIMESTAMPTZ"],
    ["status", "TEXT NOT NULL DEFAULT 'OPEN'"],
    ["result", "TEXT"],
    ["exit_price", "NUMERIC"],
    ["pnl_r", "NUMERIC"]
  ];

  for (const [name, type] of additions) {
    await pool.query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }
}

const num = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};
const bool = v => v === true || v === "true" || v === 1 || v === "1";

function normalizeSignal(p) {
  const score = Math.max(0, Math.min(100, num(p.score, 50)));
  const probability = Math.max(0, Math.min(100, num(p.probability, score)));

  return {
    external_id: String(p.external_id || p.signal_id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 120),
    received_at: new Date().toISOString(),
    symbol: String(p.symbol || p.ticker || "N/A").slice(0, 30),
    timeframe: String(p.timeframe || p.interval || "").slice(0, 20),
    signal: String(p.signal || p.side || "WAIT").toUpperCase(),
    status: "OPEN",
    price: num(p.price ?? p.close),
    sl: num(p.sl),
    tp1: num(p.tp1 ?? p.tp),
    tp2: num(p.tp2),
    tp3: num(p.tp3),
    score,
    probability,
    rsi: num(p.rsi),
    atr: num(p.atr),
    rr: num(p.rr),
    trend: String(p.trend || "").slice(0, 50),
    structure: String(p.structure || "").slice(0, 100),
    session_name: String(p.session || p.session_name || "").slice(0, 50),
    mtf_trend: String(p.mtf_trend || "").slice(0, 50),
    vwap_side: String(p.vwap_side || "").slice(0, 50),
    order_block: String(p.order_block || "").slice(0, 80),
    bos: bool(p.bos),
    choch: bool(p.choch),
    fvg: bool(p.fvg),
    liquidity_sweep: bool(p.liquidity_sweep || p.sweep),
    vwap_confirm: bool(p.vwap_confirm),
    mtf_confirm: bool(p.mtf_confirm),
    order_block_confirm: bool(p.order_block_confirm),
    reason: String(p.reason || p.setup || "").slice(0, 1800)
  };
}

async function saveSignal(s) {
  if (!pool) {
    if (memorySignals.some(x => x.external_id === s.external_id)) return;
    memorySignals.unshift({ id: Date.now(), ...s });
    memorySignals = memorySignals.slice(0, 1000);
    return;
  }

  await pool.query(`
    INSERT INTO signals (
      external_id,received_at,symbol,timeframe,signal,status,price,sl,tp1,tp2,tp3,
      score,probability,rsi,atr,rr,trend,structure,session_name,mtf_trend,vwap_side,
      order_block,bos,choch,fvg,liquidity_sweep,vwap_confirm,mtf_confirm,
      order_block_confirm,reason
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30
    )
    ON CONFLICT (external_id) DO NOTHING
  `, [
    s.external_id,s.received_at,s.symbol,s.timeframe,s.signal,s.status,s.price,s.sl,
    s.tp1,s.tp2,s.tp3,s.score,s.probability,s.rsi,s.atr,s.rr,s.trend,s.structure,
    s.session_name,s.mtf_trend,s.vwap_side,s.order_block,s.bos,s.choch,s.fvg,
    s.liquidity_sweep,s.vwap_confirm,s.mtf_confirm,s.order_block_confirm,s.reason
  ]);
}

async function closeSignal(payload) {
  const externalId = String(payload.external_id || payload.signal_id || "").slice(0, 120);
  if (!externalId) throw new Error("Lipsește external_id");

  const result = String(payload.result || "").toUpperCase();
  if (!["TP1", "TP2", "TP3", "SL", "BE", "CLOSED"].includes(result)) {
    throw new Error("Rezultat invalid");
  }

  const pnlMap = { TP1: 2, TP2: 3, TP3: 4, SL: -1, BE: 0, CLOSED: num(payload.pnl_r, 0) };
  const pnlR = result === "CLOSED" ? num(payload.pnl_r, 0) : pnlMap[result];
  const exitPrice = num(payload.exit_price);

  if (!pool) {
    const item = memorySignals.find(x => x.external_id === externalId);
    if (!item) throw new Error("Semnalul nu a fost găsit");
    item.status = "CLOSED";
    item.result = result;
    item.pnl_r = pnlR;
    item.exit_price = exitPrice;
    item.closed_at = new Date().toISOString();
    return item;
  }

  const resultDb = await pool.query(`
    UPDATE signals
    SET status='CLOSED', result=$1, pnl_r=$2, exit_price=$3, closed_at=NOW()
    WHERE external_id=$4
    RETURNING *
  `, [result, pnlR, exitPrice, externalId]);

  if (!resultDb.rows.length) throw new Error("Semnalul nu a fost găsit");
  return resultDb.rows[0];
}

async function listSignals() {
  if (!pool) return memorySignals;
  return (await pool.query("SELECT * FROM signals ORDER BY received_at DESC LIMIT 1000")).rows;
}

async function stats() {
  const data = await listSignals();
  const closed = data.filter(x => x.status === "CLOSED");
  const wins = closed.filter(x => Number(x.pnl_r) > 0);
  const losses = closed.filter(x => Number(x.pnl_r) < 0);
  const totalR = closed.reduce((a, x) => a + Number(x.pnl_r || 0), 0);
  const grossWin = wins.reduce((a, x) => a + Number(x.pnl_r || 0), 0);
  const grossLoss = Math.abs(losses.reduce((a, x) => a + Number(x.pnl_r || 0), 0));

  return {
    total: data.length,
    open: data.filter(x => x.status === "OPEN").length,
    closed: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? wins.length / closed.length * 100 : 0,
    totalR,
    profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? 99 : 0,
    avgScore: data.length ? data.reduce((a, x) => a + Number(x.score || 0), 0) / data.length : 0,
    avgProbability: data.length ? data.reduce((a, x) => a + Number(x.probability || 0), 0) / data.length : 0
  };
}

async function clearAll() {
  if (pool) await pool.query("DELETE FROM signals");
  else memorySignals = [];
}

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

app.get("/health", (req, res) => {
  res.json({ ok: true, version: "4.0.0", database: pool ? "postgres" : "memory", time: new Date().toISOString() });
});

app.get("/api/signals", async (req, res) => {
  try {
    res.json({ ok: true, signals: await listSignals(), stats: await stats() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Nu pot citi datele." });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const key = req.query.key || req.get("x-webhook-key") || "";
    if (!WEBHOOK_KEY || key !== WEBHOOK_KEY) {
      return res.status(401).json({ ok: false, error: "Cheie webhook invalidă." });
    }

    const event = String(req.body.event || "SIGNAL").toUpperCase();

    if (event === "CLOSE") {
      const closed = await closeSignal(req.body);
      await sendTelegram(`✅ ${closed.symbol} ${closed.signal} închis: ${closed.result} (${closed.pnl_r}R)`);
      return res.json({ ok: true, closed });
    }

    const signal = normalizeSignal(req.body);
    if (!["BUY", "SELL", "WAIT"].includes(signal.signal)) {
      return res.status(400).json({ ok: false, error: "Semnal invalid." });
    }

    await saveSignal(signal);

    if (signal.signal !== "WAIT") {
      const icon = signal.signal === "BUY" ? "🟢" : "🔴";
      await sendTelegram([
        `${icon} ${signal.symbol} — ${signal.signal}`,
        `TF: ${signal.timeframe}`,
        `Entry: ${signal.price}`,
        `SL: ${signal.sl}`,
        `TP1: ${signal.tp1}`,
        `TP2: ${signal.tp2}`,
        `TP3: ${signal.tp3}`,
        `Scor: ${signal.score}%`,
        `Probabilitate estimată: ${signal.probability}%`,
        `ID: ${signal.external_id}`
      ].join("\n"));
    }

    res.json({ ok: true, signal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message || "Eroare webhook." });
  }
});

app.post("/api/manual-close", async (req, res) => {
  try {
    const key = req.body?.adminKey || "";
    if (!ADMIN_KEY || key !== ADMIN_KEY) {
      return res.status(401).json({ ok: false, error: "Neautorizat." });
    }
    res.json({ ok: true, closed: await closeSignal(req.body) });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.post("/api/test-signal", async (req, res) => {
  const key = req.body?.adminKey || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Neautorizat." });
  }

  const signal = normalizeSignal({
    external_id: `TEST-${Date.now()}`,
    symbol: "US30",
    timeframe: "5",
    signal: "BUY",
    price: 45000,
    sl: 44920,
    tp1: 45160,
    tp2: 45240,
    tp3: 45320,
    score: 88,
    probability: 78,
    rsi: 58.4,
    atr: 72,
    rr: 2,
    trend: "Bullish",
    structure: "BOS bullish + FVG",
    session: "New York",
    mtf_trend: "M15 bullish",
    vwap_side: "Above VWAP",
    order_block: "Bullish OB retest",
    bos: true,
    fvg: true,
    liquidity_sweep: true,
    vwap_confirm: true,
    mtf_confirm: true,
    order_block_confirm: true,
    reason: "Semnal demonstrativ v4."
  });

  await saveSignal(signal);
  res.json({ ok: true, signal });
});

app.post("/api/clear", async (req, res) => {
  const key = req.body?.adminKey || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Neautorizat." });
  }
  await clearAll();
  res.json({ ok: true });
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`PropTrader AI v4 rulează pe portul ${PORT}`)))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
