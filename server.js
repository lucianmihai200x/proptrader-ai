
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

let memory = [];

app.use(express.json({ limit: "400kb" }));
app.use(express.static(path.join(__dirname, "public")));

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS signals (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      symbol TEXT NOT NULL,
      timeframe TEXT,
      signal TEXT NOT NULL,
      price NUMERIC,
      sl NUMERIC,
      tp1 NUMERIC,
      tp2 NUMERIC,
      tp3 NUMERIC,
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
    ["mtf_trend", "TEXT"],
    ["vwap_side", "TEXT"],
    ["order_block", "TEXT"],
    ["vwap_confirm", "BOOLEAN DEFAULT FALSE"],
    ["mtf_confirm", "BOOLEAN DEFAULT FALSE"],
    ["order_block_confirm", "BOOLEAN DEFAULT FALSE"]
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

function normalize(p) {
  const score = Math.max(0, Math.min(100, num(p.score, 50)));
  return {
    received_at: new Date().toISOString(),
    symbol: String(p.symbol || p.ticker || "N/A").slice(0, 30),
    timeframe: String(p.timeframe || p.interval || "").slice(0, 20),
    signal: String(p.signal || p.side || "WAIT").toUpperCase(),
    price: num(p.price ?? p.close),
    sl: num(p.sl),
    tp1: num(p.tp1 ?? p.tp),
    tp2: num(p.tp2),
    tp3: num(p.tp3),
    score,
    probability: Math.max(0, Math.min(100, num(p.probability, score))),
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

async function save(s) {
  if (!pool) {
    memory.unshift({ id: Date.now(), ...s });
    memory = memory.slice(0, 600);
    return;
  }

  await pool.query(`
    INSERT INTO signals (
      received_at,symbol,timeframe,signal,price,sl,tp1,tp2,tp3,
      score,probability,rsi,atr,rr,trend,structure,session_name,
      mtf_trend,vwap_side,order_block,bos,choch,fvg,liquidity_sweep,
      vwap_confirm,mtf_confirm,order_block_confirm,reason
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
      $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28
    )
  `, [
    s.received_at,s.symbol,s.timeframe,s.signal,s.price,s.sl,s.tp1,s.tp2,s.tp3,
    s.score,s.probability,s.rsi,s.atr,s.rr,s.trend,s.structure,s.session_name,
    s.mtf_trend,s.vwap_side,s.order_block,s.bos,s.choch,s.fvg,s.liquidity_sweep,
    s.vwap_confirm,s.mtf_confirm,s.order_block_confirm,s.reason
  ]);
}

async function list() {
  if (!pool) return memory;
  return (await pool.query("SELECT * FROM signals ORDER BY received_at DESC LIMIT 400")).rows;
}

async function clearAll() {
  if (pool) await pool.query("DELETE FROM signals");
  else memory = [];
}

app.get("/health", (req, res) => {
  res.json({ ok: true, version: "3.0.0", database: pool ? "postgres" : "memory", time: new Date().toISOString() });
});

app.get("/api/signals", async (req, res) => {
  try {
    res.json({ ok: true, signals: await list() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Nu pot citi semnalele." });
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const key = req.query.key || req.get("x-webhook-key") || "";
    if (!WEBHOOK_KEY || key !== WEBHOOK_KEY) {
      return res.status(401).json({ ok: false, error: "Cheie webhook invalidă." });
    }

    const s = normalize(req.body);
    if (!["BUY", "SELL", "WAIT"].includes(s.signal)) {
      return res.status(400).json({ ok: false, error: "Semnal invalid." });
    }

    await save(s);
    res.json({ ok: true, signal: s });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Eroare webhook." });
  }
});

app.post("/api/test-signal", async (req, res) => {
  const key = req.body?.adminKey || req.get("x-admin-key") || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Neautorizat." });
  }

  const s = normalize({
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
    reason: "Semnal demonstrativ v3."
  });

  await save(s);
  res.json({ ok: true, signal: s });
});

app.post("/api/clear", async (req, res) => {
  const key = req.body?.adminKey || req.get("x-admin-key") || "";
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(401).json({ ok: false, error: "Neautorizat." });
  }
  await clearAll();
  res.json({ ok: true });
});

initDb()
  .then(() => app.listen(PORT, () => console.log(`PropTrader AI v3 rulează pe portul ${PORT}`)))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
