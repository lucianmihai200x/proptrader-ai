const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_KEY = process.env.WEBHOOK_KEY || "";
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const NEWS_WEBHOOK_KEY = process.env.NEWS_WEBHOOK_KEY || WEBHOOK_KEY;
const DATABASE_URL = process.env.DATABASE_URL || "";
const ARCHIVE_AFTER_HOURS = Math.max(1, Number(process.env.ARCHIVE_AFTER_HOURS || 24));
const PATTERN_MIN_SAMPLES = Math.max(10, Number(process.env.PATTERN_MIN_SAMPLES || 25));
const PATTERN_MIN_PROBABILITY = Math.max(50, Math.min(95, Number(process.env.PATTERN_MIN_PROBABILITY || 68)));
const PATTERN_LOOKBACK_DAYS = Math.max(14, Number(process.env.PATTERN_LOOKBACK_DAYS || 180));
const PATTERN_HORIZON_BARS = Math.max(1, Math.min(12, Number(process.env.PATTERN_HORIZON_BARS || 3)));
const PATTERN_COOLDOWN_MINUTES = Math.max(5, Number(process.env.PATTERN_COOLDOWN_MINUTES || 60));
const FMP_API_KEY = process.env.FMP_API_KEY || "";
const ALPHAVANTAGE_API_KEY = process.env.ALPHAVANTAGE_API_KEY || "";
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || "";
const NEWS_MAX_AGE_HOURS = Math.max(12, Number(process.env.NEWS_MAX_AGE_HOURS || 96));
const NEWS_MIN_RELEVANCE = Math.max(0, Math.min(100, Number(process.env.NEWS_MIN_RELEVANCE || 35)));
const NEWS_AUTO_SYNC_MINUTES = Math.max(15, Number(process.env.NEWS_AUTO_SYNC_MINUTES || 60));
const AUTO_TRACK_TRADES = String(process.env.AUTO_TRACK_TRADES || "true").toLowerCase() !== "false";
const LIVE_MIN_ADAPTIVE_SCORE = Math.max(50, Math.min(95, Number(process.env.LIVE_MIN_ADAPTIVE_SCORE || 72)));
const LEARNING_MIN_SAMPLES = Math.max(10, Number(process.env.LEARNING_MIN_SAMPLES || 30));
const VALIDATION_MIN_TRADES = Math.max(20, Number(process.env.VALIDATION_MIN_TRADES || 60));
const MAX_NEWS_RISK_LIVE = Math.max(0, Math.min(100, Number(process.env.MAX_NEWS_RISK_LIVE || 75)));
const MAX_CONSECUTIVE_LOSSES = Math.max(2, Number(process.env.MAX_CONSECUTIVE_LOSSES || 4));
const NEWS_COUNTRIES = (process.env.NEWS_COUNTRIES || "US").split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
let lastNewsSync = null;
let lastNewsSyncError = "";

const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

let memorySignals = [];
let memoryNews = [];
let memoryBars = [];
let memoryPatterns = [];

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

function safeJson(v, fallback = {}) {
  if (v && typeof v === "object" && !Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return fallback; }
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
    ["confidence_lower", "NUMERIC DEFAULT 0"], ["decision_reason", "TEXT"], ["regime", "TEXT DEFAULT 'UNKNOWN'"]
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
}

function setupKey(p) {
  return [
    clean(p.symbol || "N/A", 30).toUpperCase(), clean(p.signal || p.side || "WAIT", 10).toUpperCase(),
    clean(p.session || p.session_name || "N/A", 40), clean(p.structure || "N/A", 80),
    bool(p.bos) ? "BOS" : "", bool(p.choch) ? "CHOCH" : "", bool(p.fvg) ? "FVG" : "",
    bool(p.liquidity_sweep || p.sweep) ? "SWEEP" : "", bool(p.vwap_confirm) ? "VWAP" : "",
    bool(p.mtf_confirm) ? "MTF" : ""
  ].filter(Boolean).join("|").slice(0, 300);
}

function normalizeSignal(p) {
  const score = Math.max(0, Math.min(100, num(p.score, 50)));
  return {
    external_id: clean(p.external_id || p.signal_id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 120),
    received_at: new Date().toISOString(), symbol: clean(p.symbol || p.ticker || "N/A", 30).toUpperCase(),
    timeframe: clean(p.timeframe || p.interval, 20), signal: clean(p.signal || p.side || "WAIT", 10).toUpperCase(),
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
  return {
    external_id: clean(p.external_id || p.id || p.guid || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 180),
    published_at: p.published_at || p.publishedAt || p.date || new Date().toISOString(), title, summary,
    source: clean(p.source?.name || p.source, 150), url: clean(p.url, 1000),
    symbols: Array.isArray(p.symbols) && p.symbols.length ? p.symbols.map(x => clean(x, 30).toUpperCase()) : a.symbols,
    impact: Number.isFinite(suppliedImpact) ? Math.max(0, Math.min(100, suppliedImpact)) : a.impact,
    bias: clean(p.bias || a.bias, 20).toUpperCase(), category: clean(p.category || a.category, 50), raw: p
  };
}

async function recentNewsRisk(symbol, at = new Date()) {
  const from = new Date(at.getTime() - 3 * 3600000).toISOString();
  const to = new Date(at.getTime() + 1 * 3600000).toISOString();
  let rows;
  if (!pool) {
    rows = memoryNews.filter(n => new Date(n.published_at) >= new Date(from) && new Date(n.published_at) <= new Date(to));
  } else {
    rows = (await pool.query(`SELECT * FROM news_events WHERE published_at BETWEEN $1 AND $2 ORDER BY impact DESC, published_at DESC LIMIT 20`, [from, to])).rows;
  }
  const relevant = rows.filter(n => !n.symbols?.length || n.symbols.includes(symbol) || (symbol.includes("XAU") && n.symbols.includes("XAUUSD")));
  if (!relevant.length) return { risk: 0, bias: "NEUTRAL", summary: "Fără știri relevante în fereastra ±3h." };
  const max = relevant.reduce((a, n) => Number(n.impact) > Number(a.impact) ? n : a, relevant[0]);
  return { risk: Number(max.impact || 0), bias: max.bias || "NEUTRAL", summary: relevant.slice(0, 3).map(n => n.title).join(" • ").slice(0, 1200) };
}


function normalizeBar(p) {
  const barTime = new Date(p.bar_time || p.time || p.timestamp || Date.now());
  if (Number.isNaN(barTime.getTime())) throw new Error("Timpul lumânării este invalid");
  const symbol = clean(p.symbol || p.ticker, 30).toUpperCase();
  const timeframe = clean(p.timeframe || p.interval, 20);
  const o = num(p.open, NaN), h = num(p.high, NaN), l = num(p.low, NaN), c = num(p.close, NaN);
  if (!symbol || !timeframe || ![o,h,l,c].every(Number.isFinite)) throw new Error("BAR necesită symbol, timeframe, open, high, low și close");
  return { external_id: clean(p.external_id || `BAR-${symbol}-${timeframe}-${barTime.getTime()}`, 160), bar_time: barTime.toISOString(), symbol, timeframe, open:o, high:h, low:l, close:c, volume:num(p.volume) };
}

async function saveBar(b) {
  if (!pool) {
    if (!memoryBars.some(x=>x.external_id===b.external_id)) memoryBars.push({id:Date.now(),...b});
    memoryBars = memoryBars.filter(x=>new Date(x.bar_time) >= new Date(Date.now()-PATTERN_LOOKBACK_DAYS*86400000)).slice(-30000);
    return;
  }
  await pool.query(`INSERT INTO market_bars(external_id,bar_time,symbol,timeframe,open,high,low,close,volume)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,[b.external_id,b.bar_time,b.symbol,b.timeframe,b.open,b.high,b.low,b.close,b.volume]);
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
    const tp3Hit=tp3>0 && (side==="BUY"?hi>=tp3:lo<=tp3);
    const tp2Hit=tp2>0 && (side==="BUY"?hi>=tp2:lo<=tp2);
    const tp1Hit=tp1>0 && (side==="BUY"?hi>=tp1:lo<=tp1);
    // Conservator: dacă aceeași lumânare atinge și SL, și TP, se consideră SL deoarece ordinea intrabar nu este cunoscută.
    if(slHit){result="SL";exitPrice=sl;}
    else if(tp3Hit){result="TP3";exitPrice=tp3;}
    else if(tp2Hit){result="TP2";exitPrice=tp2;}
    else if(tp1Hit){result="TP1";exitPrice=tp1;}
    if(!pool){
      const item=memorySignals.find(x=>x.external_id===s.external_id);
      if(item){item.max_favorable_price=side==="BUY"?Math.max(num(item.max_favorable_price,entry),favorable):Math.min(num(item.max_favorable_price,entry),favorable);item.max_adverse_price=side==="BUY"?Math.min(num(item.max_adverse_price,entry),adverse):Math.max(num(item.max_adverse_price,entry),adverse);}
    }else{
      await pool.query(`UPDATE signals SET max_favorable_price=CASE WHEN signal='BUY' THEN GREATEST(COALESCE(max_favorable_price,price),$1) ELSE LEAST(COALESCE(max_favorable_price,price),$1) END,max_adverse_price=CASE WHEN signal='BUY' THEN LEAST(COALESCE(max_adverse_price,price),$2) ELSE GREATEST(COALESCE(max_adverse_price,price),$2) END WHERE external_id=$3`,[favorable,adverse,s.external_id]);
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

async function syncFmpCalendar() {
  if(!FMP_API_KEY) return {provider:"FMP",configured:false,received:0,accepted:0,saved:0};
  const now=new Date(), from=new Date(now.getTime()-24*3600000), to=new Date(now.getTime()+7*86400000);
  const iso=d=>d.toISOString().slice(0,10);
  const url=`https://financialmodelingprep.com/stable/economic-calendar?from=${iso(from)}&to=${iso(to)}&apikey=${encodeURIComponent(FMP_API_KEY)}`;
  const response=await fetch(url,{headers:{accept:"application/json"}});
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
  if(!FMP_API_KEY && !ALPHAVANTAGE_API_KEY && !FINNHUB_API_KEY) throw new Error("Configurează cel puțin o cheie: FMP_API_KEY, ALPHAVANTAGE_API_KEY sau FINNHUB_API_KEY");
  const results=[];
  for(const fn of [syncFmpCalendar,syncAlphaVantageNews,syncFinnhubNews]){
    try{results.push(await fn());}catch(e){results.push({provider:fn.name,configured:true,error:e.message,received:0,accepted:0,saved:0});}
  }
  const received=results.reduce((a,x)=>a+num(x.received),0), accepted=results.reduce((a,x)=>a+num(x.accepted),0), saved=results.reduce((a,x)=>a+num(x.saved),0);
  lastNewsSync=new Date().toISOString();
  lastNewsSyncError=results.filter(x=>x.error).map(x=>`${x.provider}: ${x.error}`).join(" | ");
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

async function analyzeTimePattern(bar) {
  const bars=await recentBars(bar.symbol,bar.timeframe);
  if(bars.length < PATTERN_MIN_SAMPLES + PATTERN_HORIZON_BARS + 20) return null;
  const now=new Date(bar.bar_time), targetBucket=bucketFor(now,bar.timeframe), weekday=now.getUTCDay();
  const moves=[];
  for(let i=0;i<bars.length-PATTERN_HORIZON_BARS;i++){
    const a=bars[i], dt=new Date(a.bar_time);
    if(bucketFor(dt,bar.timeframe)!==targetBucket) continue;
    // Prioritize the same weekday, but accept all weekdays until the sample threshold is reached.
    const end=bars[i+PATTERN_HORIZON_BARS];
    if(!end)continue;
    const move=(num(end.close)-num(a.close))/Math.max(0.000001,num(a.close))*100;
    moves.push({move,sameWeekday:dt.getUTCDay()===weekday});
  }
  let selected=moves.filter(x=>x.sameWeekday).map(x=>x.move);
  if(selected.length<PATTERN_MIN_SAMPLES) selected=moves.map(x=>x.move);
  if(selected.length<PATTERN_MIN_SAMPLES) return null;
  const up=selected.filter(x=>x>0).length, down=selected.filter(x=>x<0).length;
  const upProb=up/selected.length*100, downProb=down/selected.length*100;
  const side=upProb>=downProb?'BUY':'SELL', probability=Math.max(upProb,downProb);
  const directional=selected.filter(x=>side==='BUY'?x>0:x<0).map(Math.abs);
  const avgMove=directional.reduce((a,x)=>a+x,0)/Math.max(1,directional.length), medMove=median(directional);
  const closes=bars.slice(-60).map(x=>num(x.close));
  const e20=ema(closes.slice(-40),20), e50=ema(closes,50);
  const trendConfirmed=side==='BUY'?num(bar.close)>e20&&e20>e50:num(bar.close)<e20&&e20<e50;
  const atr=atrFromBars(bars.slice(-30));
  const minMovePct=Math.max(0.03,(atr/Math.max(0.000001,num(bar.close))*100)*0.55);
  if(probability<PATTERN_MIN_PROBABILITY || avgMove<minMovePct || !trendConfirmed) return null;
  const news=await recentNewsRisk(bar.symbol,new Date(bar.bar_time));
  if(news.risk>=80) return null;
  const entry=num(bar.close), risk=Math.max(atr*1.1,entry*avgMove/100*0.45);
  const sl=side==='BUY'?entry-risk:entry+risk;
  const tp1=side==='BUY'?entry+risk*1.5:entry-risk*1.5;
  const tp2=side==='BUY'?entry+risk*2.5:entry-risk*2.5;
  const tp3=side==='BUY'?entry+risk*3.5:entry-risk*3.5;
  const bucketMs=PATTERN_COOLDOWN_MINUTES*60000;
  const ext=`PATTERN-${bar.symbol}-${bar.timeframe}-${side}-${Math.floor(new Date(bar.bar_time).getTime()/bucketMs)}`;
  return {external_id:ext,created_at:new Date().toISOString(),symbol:bar.symbol,timeframe:bar.timeframe,side,entry,sl,tp1,tp2,tp3,samples:selected.length,probability:Number(probability.toFixed(2)),avg_move_pct:Number(avgMove.toFixed(4)),median_move_pct:Number(medMove.toFixed(4)),time_bucket:targetBucket,weekday,horizon_bars:PATTERN_HORIZON_BARS,trend_confirmed:trendConfirmed,news_risk:news.risk,status:'CANDIDATE',reason:`Model orar: ${side} a apărut în ${probability.toFixed(1)}% din ${selected.length} cazuri; mișcare medie ${avgMove.toFixed(3)}% în următoarele ${PATTERN_HORIZON_BARS} lumânări. Confirmare EMA20/EMA50 și risc știri ${news.risk}/100.`};
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
  const liveAllowed = s.adaptive_score >= LIVE_MIN_ADAPTIVE_SCORE && news.risk <= MAX_NEWS_RISK_LIVE && lossStreak < MAX_CONSECUTIVE_LOSSES;
  s.execution_mode = liveAllowed && (proven || perf.samples===0) ? "LIVE" : "WATCH";
  s.quality_score = Math.max(0,Math.min(100,Number((s.adaptive_score + (proven?5:0) - (s.regime==="RANGE"?5:0)).toFixed(2))));
  const reasons=[];
  if(s.adaptive_score<LIVE_MIN_ADAPTIVE_SCORE)reasons.push(`scor sub ${LIVE_MIN_ADAPTIVE_SCORE}`);
  if(news.risk>MAX_NEWS_RISK_LIVE)reasons.push(`risc știri ${news.risk}/100`);
  if(lossStreak>=MAX_CONSECUTIVE_LOSSES)reasons.push(`circuit breaker după ${lossStreak} pierderi consecutive`);
  if(perf.samples>0&&!proven)reasons.push(`setup neconfirmat statistic: N=${perf.samples}, limită inferioară ${perf.lowerBound.toFixed(1)}%`);
  s.decision_reason = reasons.length ? reasons.join("; ") : (perf.samples===0 ? "Mod inițial: fără istoric propriu; urmărește cu risc redus." : "Criteriile de calitate sunt îndeplinite.");

  if (!pool) {
    if (memorySignals.some(x => x.external_id === s.external_id)) return;
    memorySignals.unshift({ id: Date.now(), archived_at: null, ...s });
    return;
  }
  await pool.query(`
    INSERT INTO signals (
      external_id,received_at,symbol,timeframe,signal,status,price,sl,tp1,tp2,tp3,score,probability,
      adaptive_score,learning_adjustment,rsi,atr,rr,trend,structure,session_name,mtf_trend,vwap_side,
      order_block,bos,choch,fvg,liquidity_sweep,vwap_confirm,mtf_confirm,order_block_confirm,market_phase,
      equal_highs,equal_lows,premium_discount,fib_zone,fvg_state,ob_state,kill_zone,score_breakdown,reason,
      news_risk,news_bias,news_summary,setup_key,execution_mode,quality_score,confidence_lower,decision_reason,regime
    ) VALUES (${Array.from({length:50},(_,i)=>`$${i+1}`).join(',')}) ON CONFLICT DO NOTHING
  `, [
    s.external_id,s.received_at,s.symbol,s.timeframe,s.signal,s.status,s.price,s.sl,s.tp1,s.tp2,s.tp3,s.score,s.probability,
    s.adaptive_score,s.learning_adjustment,s.rsi,s.atr,s.rr,s.trend,s.structure,s.session_name,s.mtf_trend,s.vwap_side,
    s.order_block,s.bos,s.choch,s.fvg,s.liquidity_sweep,s.vwap_confirm,s.mtf_confirm,s.order_block_confirm,s.market_phase,
    s.equal_highs,s.equal_lows,s.premium_discount,s.fib_zone,s.fvg_state,s.ob_state,s.kill_zone,JSON.stringify(s.score_breakdown),s.reason,
    s.news_risk,s.news_bias,s.news_summary,s.setup_key,s.execution_mode,s.quality_score,s.confidence_lower,s.decision_reason,s.regime
  ]);
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
    if (filters.symbol) arr = arr.filter(x => x.symbol.includes(filters.symbol.toUpperCase()));
    if (filters.side) arr = arr.filter(x => x.signal === filters.side.toUpperCase());
    if (filters.status) arr = arr.filter(x => x.status === filters.status.toUpperCase());
    return arr.slice(0, limit);
  }
  const cond = [mode === "archive" ? "archived_at IS NOT NULL" : "archived_at IS NULL"];
  const vals = [];
  const add = (sql, val) => { vals.push(val); cond.push(sql.replace("?", `$${vals.length}`)); };
  if (filters.symbol) add("symbol ILIKE ?", `%${filters.symbol}%`);
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
      winRate:closed.length?wins.length/closed.length*100:0, totalR, profitFactor:grossLoss?grossWin/grossLoss:grossWin?99:0,
      avgScore:data.length?data.reduce((a,x)=>a+num(x.score),0)/data.length:0,
      avgAdaptiveScore:data.length?data.reduce((a,x)=>a+num(x.adaptive_score,x.score),0)/data.length:0
    }, bySymbol:groupStats(data,x=>x.symbol), bySession:groupStats(data,x=>x.session_name),
    byMarketPhase:groupStats(data,x=>x.market_phase), topSetups:setups, equityCurve };
}

async function closeSignal(payload) {
  const externalId = clean(payload.external_id || payload.signal_id, 120);
  const result = clean(payload.result, 20).toUpperCase();
  if (!externalId) throw new Error("Lipsește external_id");
  if (!["TP1","TP2","TP3","SL","BE","CLOSED","EXPIRED"].includes(result)) throw new Error("Rezultat invalid");
  const pnlMap = {TP1:1.5,TP2:2.5,TP3:3.5,SL:-1,BE:0,EXPIRED:0};
  const pnlR = result === "CLOSED" ? num(payload.pnl_r) : pnlMap[result];
  if (!pool) {
    const item = memorySignals.find(x=>x.external_id===externalId); if (!item) throw new Error("Semnal negăsit");
    Object.assign(item,{status:"CLOSED",result,pnl_r:pnlR,exit_price:num(payload.exit_price),closed_at:new Date().toISOString()}); return item;
  }
  const q = await pool.query(`UPDATE signals SET status='CLOSED',result=$1,pnl_r=$2,exit_price=$3,closed_at=NOW() WHERE external_id=$4 RETURNING *`,[result,pnlR,num(payload.exit_price),externalId]);
  if (!q.rows.length) throw new Error("Semnal negăsit"); return q.rows[0];
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
    const sym=clean(symbol||"US30",30).toUpperCase(),tf=clean(timeframe||"5",20);
    bars.push({external_id:`CSV-${sym}-${tf}-${d.getTime()}`,bar_time:d.toISOString(),symbol:sym,timeframe:tf,open:o,high:h,low:l,close:c,volume:Number.isFinite(v)?v:0});
  }
  bars.sort((a,b)=>new Date(a.bar_time)-new Date(b.bar_time));
  const dedup=[...new Map(bars.map(x=>[x.external_id,x])).values()];
  if(!dedup.length) throw new Error("Nu am putut interpreta nicio lumânare validă");
  return {bars:dedup,rejected,delimiter,headers};
}
async function saveBarsBatch(bars){
  if(!pool){for(const b of bars)await saveBar(b);return bars.length;}
  let inserted=0;
  for(let i=0;i<bars.length;i+=500){
    const chunk=bars.slice(i,i+500), values=[], params=[]; let n=1;
    for(const b of chunk){values.push(`($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`);params.push(b.external_id,b.bar_time,b.symbol,b.timeframe,b.open,b.high,b.low,b.close,b.volume);}
    const q=await pool.query(`INSERT INTO market_bars(external_id,bar_time,symbol,timeframe,open,high,low,close,volume) VALUES ${values.join(",")} ON CONFLICT DO NOTHING`,params);inserted+=q.rowCount;
  }
  return inserted;
}
function wilsonLower(wins,n,z=1.96){if(!n)return 0;const p=wins/n,z2=z*z;return ((p+z2/(2*n))-z*Math.sqrt((p*(1-p)+z2/(4*n))/n))/(1+z2/n)*100;}
function performanceStats(returns){
  const n=returns.length,wins=returns.filter(x=>x>0),losses=returns.filter(x=>x<0),sum=returns.reduce((a,x)=>a+x,0),grossWin=wins.reduce((a,x)=>a+x,0),grossLoss=Math.abs(losses.reduce((a,x)=>a+x,0));
  let equity=0,peak=0,maxDD=0;for(const r of returns){equity+=r;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);}
  return {trades:n,wins:wins.length,winRate:n?wins.length/n*100:0,lowerBound:wilsonLower(wins.length,n),avgReturnPct:n?sum/n:0,totalReturnPct:sum,profitFactor:grossLoss?grossWin/grossLoss:(grossWin>0?99:0),maxDrawdownPct:maxDD};
}
function buildBacktest(bars,{horizonBars=3,minSamples=25,minProbability=60}={}){
  const groups=new Map();
  for(let i=0;i<bars.length-horizonBars;i++){
    const b=bars[i],end=bars[i+horizonBars],bucket=bucketFor(b.bar_time,b.timeframe),weekday=new Date(b.bar_time).getUTCDay(),move=(num(end.close)-num(b.close))/Math.max(0.000001,num(b.close))*100,key=`${weekday}|${bucket}`;
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({time:b.bar_time,move});
  }
  const results=[];
  for(const [key,obs] of groups){
    if(obs.length<minSamples)continue;obs.sort((a,b)=>new Date(a.time)-new Date(b.time));const cut=Math.max(1,Math.floor(obs.length*.8)),train=obs.slice(0,cut),test=obs.slice(cut);
    if(test.length<5)continue;const up=train.filter(x=>x.move>0).length,down=train.filter(x=>x.move<0).length,side=up>=down?"BUY":"SELL",prob=Math.max(up,down)/train.length*100;
    if(prob<minProbability)continue;const signed=x=>side==="BUY"?x.move:-x.move,trainStats=performanceStats(train.map(signed)),testStats=performanceStats(test.map(signed));
    const [weekday,bucket]=key.split("|");const robust=testStats.avgReturnPct>0&&testStats.profitFactor>=1.1&&testStats.lowerBound>=45;
    results.push({weekday:Number(weekday),timeBucket:bucket,side,samples:obs.length,train:trainStats,test:testStats,trainProbability:prob,robust});
  }
  results.sort((a,b)=>(Number(b.robust)-Number(a.robust))||(b.test.avgReturnPct-a.test.avgReturnPct)||(b.test.trades-a.test.trades));
  const robust=results.filter(x=>x.robust);
  return {summary:{patternsTested:results.length,robustPatterns:robust.length,best:robust[0]||results[0]||null},results:results.slice(0,300)};
}
async function getBarsForBacktest(symbol,timeframe,limit=250000){
  if(!pool)return memoryBars.filter(x=>x.symbol===symbol&&x.timeframe===timeframe).sort((a,b)=>new Date(a.bar_time)-new Date(b.bar_time)).slice(-limit);
  return (await pool.query(`SELECT * FROM market_bars WHERE symbol=$1 AND timeframe=$2 ORDER BY bar_time ASC LIMIT $3`,[symbol,timeframe,limit])).rows;
}
async function saveBacktestRun(run){
  if(!pool){global.lastMemoryBacktest=run;return {id:"memory",...run};}
  const q=await pool.query(`INSERT INTO backtest_runs(symbol,timeframe,bars,start_time,end_time,settings,summary,results) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[run.symbol,run.timeframe,run.bars,run.start_time,run.end_time,run.settings,run.summary,run.results]);return q.rows[0];
}
async function latestBacktest(){if(!pool)return global.lastMemoryBacktest||null;return (await pool.query(`SELECT * FROM backtest_runs ORDER BY created_at DESC LIMIT 1`)).rows[0]||null;}

app.get("/health", (req,res)=>res.json({ok:true,version:"13.0.0",database:pool?"postgres":"memory",archiveAfterHours:ARCHIVE_AFTER_HOURS,adminKeyConfigured:Boolean(ADMIN_KEY),newsWebhookConfigured:Boolean(NEWS_WEBHOOK_KEY),fmpConfigured:Boolean(FMP_API_KEY),alphaVantageConfigured:Boolean(ALPHAVANTAGE_API_KEY),finnhubConfigured:Boolean(FINNHUB_API_KEY),autoTrackTrades:AUTO_TRACK_TRADES,lastNewsSync,lastNewsSyncError,patternMinSamples:PATTERN_MIN_SAMPLES,patternMinProbability:PATTERN_MIN_PROBABILITY,patternHorizonBars:PATTERN_HORIZON_BARS,liveMinAdaptiveScore:LIVE_MIN_ADAPTIVE_SCORE,learningMinSamples:LEARNING_MIN_SAMPLES,maxNewsRiskLive:MAX_NEWS_RISK_LIVE,maxConsecutiveLosses:MAX_CONSECUTIVE_LOSSES,time:new Date().toISOString()}));

app.get("/api/signals", async(req,res)=>{ try { const mode=req.query.mode==="archive"?"archive":"active"; res.json({ok:true,mode,signals:await listSignals(mode,req.query),analytics:await analytics()}); } catch(e){ console.error(e); res.status(500).json({ok:false,error:e.message}); } });
app.get("/api/analytics", async(req,res)=>{ try { res.json({ok:true,analytics:await analytics()}); } catch(e){res.status(500).json({ok:false,error:e.message});} });
app.post("/api/archive-now", async(req,res)=>{ if(!requireAdmin(req,res))return; try{res.json({ok:true,archived:await archiveOldSignals()});}catch(e){res.status(500).json({ok:false,error:e.message});} });

app.get("/api/news", async(req,res)=>{ try {
  const limit=Math.min(200,Math.max(1,num(req.query.limit,50))); let rows;
  if(!pool) rows=memoryNews.slice(0,limit); else rows=(await pool.query("SELECT * FROM news_events WHERE published_at >= NOW() - ($2 * INTERVAL '1 hour') OR scheduled = TRUE ORDER BY published_at DESC LIMIT $1",[limit,NEWS_MAX_AGE_HOURS])).rows;
  res.json({ok:true,news:rows});
} catch(e){res.status(500).json({ok:false,error:e.message});} });

app.get("/api/news-status",(req,res)=>res.json({ok:true,fmpConfigured:Boolean(FMP_API_KEY),alphaVantageConfigured:Boolean(ALPHAVANTAGE_API_KEY),finnhubConfigured:Boolean(FINNHUB_API_KEY),lastNewsSync,lastNewsSyncError,autoSyncMinutes:NEWS_AUTO_SYNC_MINUTES,maxAgeHours:NEWS_MAX_AGE_HOURS,minRelevance:NEWS_MIN_RELEVANCE}));

app.post("/api/news-sync",async(req,res)=>{if(!requireAdmin(req,res))return;try{res.json({ok:true,...await syncRealNews()});}catch(e){lastNewsSyncError=e.message;res.status(400).json({ok:false,error:e.message});}});

app.post("/api/news", async(req,res)=>{ if(!requireAdmin(req,res))return; try{ const list=Array.isArray(req.body.items)?req.body.items:[req.body]; const saved=[]; for(const p of list){const n=normalizeNews(p);await saveNews(n);saved.push(n);}res.json({ok:true,saved}); }catch(e){res.status(400).json({ok:false,error:e.message});} });

app.post("/news-webhook", async(req,res)=>{ try{
  const key=req.query.key||req.get("x-news-key")||""; if(!NEWS_WEBHOOK_KEY||key!==NEWS_WEBHOOK_KEY)return res.status(401).json({ok:false,error:"NEWS_WEBHOOK_KEY incorectă"});
  const payload=parseBody(req); const list=Array.isArray(payload)?payload:(Array.isArray(payload.items)?payload.items:[payload]); const saved=[];
  for(const p of list){const n=normalizeNews(p);await saveNews(n);saved.push(n);} res.json({ok:true,count:saved.length,saved});
}catch(e){res.status(400).json({ok:false,error:e.message});} });

app.post("/api/test-signal",async(req,res)=>{ if(!requireAdmin(req,res))return; try{
  const price=num(req.body.price,NaN); if(!Number.isFinite(price)||price<=0)throw new Error("Introdu un preț curent valid pentru test");
  const atr=Math.max(price*0.0015,num(req.body.atr,0)); const risk=atr*1.1;
  const side=clean(req.body.side||"BUY",10).toUpperCase()==="SELL"?"SELL":"BUY";
  const s=normalizeSignal({external_id:`TEST-${Date.now()}`,symbol:clean(req.body.symbol||"US30",30),timeframe:"5",signal:side,price,
    sl:side==="BUY"?price-risk:price+risk,tp1:side==="BUY"?price+risk*1.5:price-risk*1.5,tp2:side==="BUY"?price+risk*2.5:price-risk*2.5,tp3:side==="BUY"?price+risk*3.5:price-risk*3.5,
    score:88,probability:79,rsi:58.4,atr,rr:3.5,trend:side==="BUY"?"Bullish":"Bearish",structure:`${side} test`,session:"New York",bos:true,fvg:true,liquidity_sweep:true,vwap_confirm:true,mtf_confirm:true,market_phase:"Expansion",premium_discount:side==="BUY"?"Discount":"Premium",reason:"Semnal demonstrativ v9.1 la preț introdus manual."});
  await saveSignal(s);res.json({ok:true,signal:s});
}catch(e){res.status(400).json({ok:false,error:e.message});} });

app.post("/api/test-news",async(req,res)=>{ if(!requireAdmin(req,res))return; try{const n=normalizeNews({external_id:`NEWS-${Date.now()}`,title:"FOMC interest rate decision and Powell press conference",summary:"High-impact Federal Reserve event may increase volatility in US indices and gold.",source:"PropTrader test",symbols:["US30","NAS100","XAUUSD"],impact:90});await saveNews(n);res.json({ok:true,news:n});}catch(e){res.status(500).json({ok:false,error:e.message});} });

app.post("/api/manual-close",async(req,res)=>{if(!requireAdmin(req,res))return;try{res.json({ok:true,closed:await closeSignal(req.body)});}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.post("/api/clear",async(req,res)=>{if(!requireAdmin(req,res))return;try{if(pool){await pool.query("DELETE FROM signals");await pool.query("DELETE FROM news_events");await pool.query("DELETE FROM pattern_signals");await pool.query("DELETE FROM market_bars");}else{memorySignals=[];memoryNews=[];memoryBars=[];memoryPatterns=[];}res.json({ok:true});}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.get("/api/patterns",async(req,res)=>{try{res.json({ok:true,patterns:await listPatterns(Math.min(300,Math.max(1,num(req.query.limit,100)))),settings:{minSamples:PATTERN_MIN_SAMPLES,minProbability:PATTERN_MIN_PROBABILITY,lookbackDays:PATTERN_LOOKBACK_DAYS,horizonBars:PATTERN_HORIZON_BARS}});}catch(e){res.status(500).json({ok:false,error:e.message});}});


app.get("/api/validation",async(req,res)=>{try{
  const rows=await allSignalsForAnalytics();
  const closed=rows.filter(x=>x.status==="CLOSED").sort((a,b)=>new Date(a.closed_at)-new Date(b.closed_at));
  const split=Math.max(1,Math.floor(closed.length*0.8)),train=closed.slice(0,split),test=closed.slice(split);
  const summarize=a=>{const wins=a.filter(x=>num(x.pnl_r)>0).length,total=a.length,totalR=a.reduce((z,x)=>z+num(x.pnl_r),0),grossWin=a.filter(x=>num(x.pnl_r)>0).reduce((z,x)=>z+num(x.pnl_r),0),grossLoss=Math.abs(a.filter(x=>num(x.pnl_r)<0).reduce((z,x)=>z+num(x.pnl_r),0));return {trades:total,winRate:total?wins/total*100:0,lowerBound:wilsonLowerBound(wins,total)*100,avgR:total?totalR/total:0,profitFactor:grossLoss?grossWin/grossLoss:grossWin?99:0,totalR};};
  const t=summarize(train),v=summarize(test),all=summarize(closed);
  let peak=0,eq=0,maxDD=0;for(const x of closed){eq+=num(x.pnl_r);peak=Math.max(peak,eq);maxDD=Math.max(maxDD,peak-eq);}
  const calibrated=closed.filter(x=>Number.isFinite(num(x.probability,NaN)));
  const brier=calibrated.length?calibrated.reduce((a,x)=>{const pr=num(x.probability)/100,y=num(x.pnl_r)>0?1:0;return a+(pr-y)**2},0)/calibrated.length:null;
  const ready=closed.length>=VALIDATION_MIN_TRADES&&v.trades>=10&&v.avgR>0&&v.lowerBound>=45&&maxDD<=Math.max(6,all.totalR*0.8+4);
  res.json({ok:true,validation:{ready,requiredTrades:VALIDATION_MIN_TRADES,all,train:t,test:v,maxDrawdownR:maxDD,brierScore:brier,closedTrades:closed.length,message:ready?"Există dovezi preliminare pe segmentul de validare. Continuă monitorizarea și controlul riscului.":"Date insuficiente sau validarea pe date nevăzute nu confirmă încă avantajul statistic."}});
}catch(e){res.status(500).json({ok:false,error:e.message});}});


app.post("/api/history-import",async(req,res)=>{if(!requireAdmin(req,res))return;try{
  const parsed=parseHistoricalCsv(req.body.csv,{symbol:req.body.symbol,timeframe:req.body.timeframe,timezoneOffsetMinutes:req.body.timezoneOffsetMinutes});
  const inserted=await saveBarsBatch(parsed.bars);const first=parsed.bars[0],last=parsed.bars[parsed.bars.length-1];
  res.json({ok:true,parsed:parsed.bars.length,inserted,rejected:parsed.rejected,first:first.bar_time,last:last.bar_time,symbol:first.symbol,timeframe:first.timeframe});
}catch(e){res.status(400).json({ok:false,error:e.message});}});

app.post("/api/backtest",async(req,res)=>{if(!requireAdmin(req,res))return;try{
  const symbol=clean(req.body.symbol||"US30",30).toUpperCase(),timeframe=clean(req.body.timeframe||"5",20),settings={horizonBars:Math.max(1,Math.min(24,num(req.body.horizonBars,3))),minSamples:Math.max(20,num(req.body.minSamples,40)),minProbability:Math.max(50,Math.min(90,num(req.body.minProbability,60)))};
  const bars=await getBarsForBacktest(symbol,timeframe);if(bars.length<settings.minSamples+settings.horizonBars+20)throw new Error(`Istoric insuficient: ${bars.length} lumânări. Importă mai multe date.`);
  const report=buildBacktest(bars,settings),run=await saveBacktestRun({symbol,timeframe,bars:bars.length,start_time:bars[0].bar_time,end_time:bars[bars.length-1].bar_time,settings,summary:report.summary,results:report.results});res.json({ok:true,run});
}catch(e){res.status(400).json({ok:false,error:e.message});}});
app.get("/api/backtest/latest",async(req,res)=>{try{res.json({ok:true,run:await latestBacktest()});}catch(e){res.status(500).json({ok:false,error:e.message});}});
app.get("/api/history-status",async(req,res)=>{try{let rows;if(!pool){const m=new Map();for(const b of memoryBars){const k=`${b.symbol}|${b.timeframe}`;if(!m.has(k))m.set(k,{symbol:b.symbol,timeframe:b.timeframe,bars:0,start_time:b.bar_time,end_time:b.bar_time});const x=m.get(k);x.bars++;if(b.bar_time<x.start_time)x.start_time=b.bar_time;if(b.bar_time>x.end_time)x.end_time=b.bar_time;}rows=[...m.values()];}else rows=(await pool.query(`SELECT symbol,timeframe,COUNT(*)::int bars,MIN(bar_time) start_time,MAX(bar_time) end_time FROM market_bars GROUP BY symbol,timeframe ORDER BY symbol,timeframe`)).rows;res.json({ok:true,datasets:rows});}catch(e){res.status(500).json({ok:false,error:e.message});}});

app.get("/api/export.csv",async(req,res)=>{try{const rows=await allSignalsForAnalytics();const cols=["received_at","archived_at","symbol","timeframe","signal","status","result","price","sl","tp1","tp2","tp3","score","adaptive_score","learning_adjustment","news_risk","news_bias","pnl_r","session_name","structure","reason"];const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;const csv=[cols.join(','),...rows.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\n');res.setHeader("content-type","text/csv; charset=utf-8");res.setHeader("content-disposition",'attachment; filename="proptrader-journal.csv"');res.send('\ufeff'+csv);}catch(e){res.status(500).send(e.message);}});

app.post("/webhook", async(req,res)=>{try{
  const key=req.query.key||req.get("x-webhook-key")||""; if(!WEBHOOK_KEY||key!==WEBHOOK_KEY)return res.status(401).json({ok:false,error:"WEBHOOK_KEY incorectă"});
  const payload=parseBody(req); const event=clean(payload.event||"SIGNAL",20).toUpperCase();
  if(event==="CLOSE")return res.json({ok:true,closed:await closeSignal(payload)});
  if(event==="BAR"){
    const bar=normalizeBar(payload); await saveBar(bar); const closed=await trackSignalsWithBar(bar); const pattern=await analyzeTimePattern(bar); const created=pattern?await savePattern(pattern):false;
    return res.json({ok:true,event:"BAR",bar,autoClosed:closed,pattern:created?pattern:null});
  }
  const signal=normalizeSignal(payload);await saveSignal(signal);return res.json({ok:true,signal});
}catch(e){console.error("POST /webhook:",e);return res.status(400).json({ok:false,error:e.message});}});

initDb().then(async()=>{
  await archiveOldSignals();
  setInterval(()=>archiveOldSignals().catch(e=>console.error("Auto-archive:",e)),15*60*1000).unref();
  if(FMP_API_KEY||ALPHAVANTAGE_API_KEY||FINNHUB_API_KEY){syncRealNews().catch(e=>{lastNewsSyncError=e.message;console.error("News sync:",e.message)});setInterval(()=>syncRealNews().catch(e=>{lastNewsSyncError=e.message;console.error("News sync:",e.message)}),NEWS_AUTO_SYNC_MINUTES*60000).unref();}
  app.listen(PORT,()=>console.log(`PropTrader AI v12.0 rulează pe portul ${PORT}`));
}).catch(e=>{console.error("DB init failed:",e);process.exit(1)});
