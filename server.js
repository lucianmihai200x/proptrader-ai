
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
}

const num = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};
const bool = v => v === true || v === "true" || v === 1 || v === "1";

function normalizeSignal(p) {
  const score = Math.max(0, Math.min(100, num(p.score, 50)));
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

async function saveSignal(s) {
  if (!pool) {
    if (memorySignals.some(x => x.external_id === s.external_id)) return;
    memorySignals.unshift({ id: Date.now(), ...s });
    memorySignals = memorySignals.slice(0, 2000);
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
  const result = String(payload.result || "").toUpperCase();
  if (!externalId) throw new Error("Lipsește external_id");
  if (!["TP1","TP2","TP3","SL","BE","CLOSED"].includes(result)) throw new Error("Rezultat invalid");

  const pnlMap = {TP1:2, TP2:3, TP3:4, SL:-1, BE:0, CLOSED:num(payload.pnl_r,0)};
  const pnlR = result === "CLOSED" ? num(payload.pnl_r,0) : pnlMap[result];
  const exitPrice = num(payload.exit_price);

  if (!pool) {
    const item = memorySignals.find(x => x.external_id === externalId);
    if (!item) throw new Error("Semnal negăsit");
    Object.assign(item,{status:"CLOSED",result,pnl_r:pnlR,exit_price:exitPrice,closed_at:new Date().toISOString()});
    return item;
  }

  const q = await pool.query(`
    UPDATE signals SET status='CLOSED',result=$1,pnl_r=$2,exit_price=$3,closed_at=NOW()
    WHERE external_id=$4 RETURNING *
  `,[result,pnlR,exitPrice,externalId]);

  if (!q.rows.length) throw new Error("Semnal negăsit");
  return q.rows[0];
}

async function listSignals() {
  if (!pool) return memorySignals;
  return (await pool.query("SELECT * FROM signals ORDER BY received_at DESC LIMIT 2000")).rows;
}

function groupStats(data, keyFn) {
  const map = {};
  for (const x of data) {
    const key = keyFn(x) || "N/A";
    if (!map[key]) map[key] = { key, total:0, closed:0, wins:0, losses:0, totalR:0, avgScore:0, avgProbability:0 };
    const g = map[key];
    g.total++;
    g.avgScore += Number(x.score || 0);
    g.avgProbability += Number(x.probability || 0);
    if (x.status === "CLOSED") {
      g.closed++;
      const r = Number(x.pnl_r || 0);
      g.totalR += r;
      if (r > 0) g.wins++;
      if (r < 0) g.losses++;
    }
  }
  return Object.values(map).map(g => ({
    ...g,
    avgScore: g.total ? g.avgScore / g.total : 0,
    avgProbability: g.total ? g.avgProbability / g.total : 0,
    winRate: g.closed ? g.wins / g.closed * 100 : 0
  }));
}

async function analytics() {
  const data = await listSignals();
  const closed = data.filter(x => x.status === "CLOSED");
  const wins = closed.filter(x => Number(x.pnl_r) > 0);
  const losses = closed.filter(x => Number(x.pnl_r) < 0);
  const totalR = closed.reduce((a,x)=>a+Number(x.pnl_r||0),0);
  const grossWin = wins.reduce((a,x)=>a+Number(x.pnl_r||0),0);
  const grossLoss = Math.abs(losses.reduce((a,x)=>a+Number(x.pnl_r||0),0));

  const byHour = groupStats(data, x => {
    const d = new Date(x.received_at);
    return String(d.getUTCHours()).padStart(2,"0") + ":00 UTC";
  }).sort((a,b)=>a.key.localeCompare(b.key));

  const bySession = groupStats(data, x => x.session_name || "N/A");
  const bySymbol = groupStats(data, x => x.symbol || "N/A");
  const byTimeframe = groupStats(data, x => x.timeframe || "N/A");

  let equity = 0;
  const equityCurve = [...closed]
    .sort((a,b)=>new Date(a.closed_at||a.received_at)-new Date(b.closed_at||b.received_at))
    .map(x => {
      equity += Number(x.pnl_r || 0);
      return { time:x.closed_at || x.received_at, equity };
    });

  return {
    summary: {
      total:data.length,
      open:data.filter(x=>x.status==="OPEN").length,
      closed:closed.length,
      wins:wins.length,
      losses:losses.length,
      winRate:closed.length?wins.length/closed.length*100:0,
      totalR,
      profitFactor:grossLoss?grossWin/grossLoss:grossWin?99:0,
      avgScore:data.length?data.reduce((a,x)=>a+Number(x.score||0),0)/data.length:0,
      avgProbability:data.length?data.reduce((a,x)=>a+Number(x.probability||0),0)/data.length:0
    },
    byHour, bySession, bySymbol, byTimeframe, equityCurve
  };
}

async function clearAll() {
  if (pool) await pool.query("DELETE FROM signals");
  else memorySignals = [];
}

app.get("/health",(req,res)=>res.json({ok:true,version:"5.0.0",database:pool?"postgres":"memory",time:new Date().toISOString()}));

app.get("/api/signals",async(req,res)=>{
  try{res.json({ok:true,signals:await listSignals(),analytics:await analytics()})}
  catch(e){console.error(e);res.status(500).json({ok:false,error:"Nu pot citi datele."})}
});

app.get("/api/export.csv",async(req,res)=>{
  try{
    const rows = await listSignals();
    const header = ["external_id","received_at","closed_at","symbol","timeframe","signal","status","result","price","sl","tp1","tp2","tp3","exit_price","pnl_r","score","probability","session_name","trend","structure"];
    const esc = v => `"${String(v ?? "").replaceAll('"','""')}"`;
    const csv = [header.join(","), ...rows.map(x=>header.map(h=>esc(x[h])).join(","))].join("\n");
    res.setHeader("content-type","text/csv; charset=utf-8");
    res.setHeader("content-disposition",'attachment; filename="proptrader_signals.csv"');
    res.send("\ufeff"+csv);
  }catch(e){res.status(500).send("Eroare export")}
});

app.post("/webhook",async(req,res)=>{
  try{
    const key=req.query.key||req.get("x-webhook-key")||"";
    if(!WEBHOOK_KEY||key!==WEBHOOK_KEY)return res.status(401).json({ok:false,error:"Cheie invalidă"});
    const event=String(req.body.event||"SIGNAL").toUpperCase();
    if(event==="CLOSE")return res.json({ok:true,closed:await closeSignal(req.body)});
    const s=normalizeSignal(req.body);
    if(!["BUY","SELL","WAIT"].includes(s.signal))return res.status(400).json({ok:false,error:"Semnal invalid"});
    await saveSignal(s);res.json({ok:true,signal:s});
  }catch(e){res.status(500).json({ok:false,error:e.message||"Eroare webhook"})}
});

app.post("/api/manual-close",async(req,res)=>{
  try{
    if(!ADMIN_KEY||req.body?.adminKey!==ADMIN_KEY)return res.status(401).json({ok:false,error:"Neautorizat"});
    res.json({ok:true,closed:await closeSignal(req.body)});
  }catch(e){res.status(400).json({ok:false,error:e.message})}
});

app.post("/api/test-signal",async(req,res)=>{
  if(!ADMIN_KEY||req.body?.adminKey!==ADMIN_KEY)return res.status(401).json({ok:false,error:"Neautorizat"});
  const s=normalizeSignal({
    external_id:`TEST-${Date.now()}`,symbol:"US30",timeframe:"5",signal:"BUY",
    price:45000,sl:44920,tp1:45160,tp2:45240,tp3:45320,score:88,probability:78,
    rsi:58.4,atr:72,rr:2,trend:"Bullish",structure:"BOS bullish + FVG",
    session:"New York",mtf_trend:"M15 bullish",vwap_side:"Above VWAP",
    order_block:"Bullish OB retest",bos:true,fvg:true,liquidity_sweep:true,
    vwap_confirm:true,mtf_confirm:true,order_block_confirm:true,reason:"Semnal demonstrativ v5."
  });
  await saveSignal(s);res.json({ok:true,signal:s});
});

app.post("/api/clear",async(req,res)=>{
  if(!ADMIN_KEY||req.body?.adminKey!==ADMIN_KEY)return res.status(401).json({ok:false,error:"Neautorizat"});
  await clearAll();res.json({ok:true});
});

initDb().then(()=>app.listen(PORT,()=>console.log("PropTrader AI v5 pe "+PORT))).catch(e=>{console.error(e);process.exit(1)});
