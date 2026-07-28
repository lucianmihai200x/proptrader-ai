
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

app.use(express.json({ limit: "600kb" }));
app.use(express.text({ type: "text/plain", limit: "600kb" }));
app.use(express.static(path.join(__dirname, "public")));

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
    ["external_id", "TEXT"],
    ["closed_at", "TIMESTAMPTZ"],
    ["timeframe", "TEXT"],
    ["status", "TEXT NOT NULL DEFAULT 'OPEN'"],
    ["result", "TEXT"],
    ["price", "NUMERIC"],
    ["sl", "NUMERIC"],
    ["tp1", "NUMERIC"],
    ["tp2", "NUMERIC"],
    ["tp3", "NUMERIC"],
    ["exit_price", "NUMERIC"],
    ["pnl_r", "NUMERIC"],
    ["score", "NUMERIC"],
    ["probability", "NUMERIC"],
    ["rsi", "NUMERIC"],
    ["atr", "NUMERIC"],
    ["rr", "NUMERIC"],
    ["trend", "TEXT"],
    ["structure", "TEXT"],
    ["session_name", "TEXT"],
    ["mtf_trend", "TEXT"],
    ["vwap_side", "TEXT"],
    ["order_block", "TEXT"],
    ["bos", "BOOLEAN DEFAULT FALSE"],
    ["choch", "BOOLEAN DEFAULT FALSE"],
    ["fvg", "BOOLEAN DEFAULT FALSE"],
    ["liquidity_sweep", "BOOLEAN DEFAULT FALSE"],
    ["vwap_confirm", "BOOLEAN DEFAULT FALSE"],
    ["mtf_confirm", "BOOLEAN DEFAULT FALSE"],
    ["order_block_confirm", "BOOLEAN DEFAULT FALSE"],
    ["market_phase", "TEXT"],
    ["equal_highs", "BOOLEAN DEFAULT FALSE"],
    ["equal_lows", "BOOLEAN DEFAULT FALSE"],
    ["premium_discount", "TEXT"],
    ["fib_zone", "TEXT"],
    ["fvg_state", "TEXT"],
    ["ob_state", "TEXT"],
    ["kill_zone", "TEXT"],
    ["score_breakdown", "JSONB"],
    ["reason", "TEXT"]
  ];

  for (const [name, type] of columns) {
    await pool.query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS signals_external_id_unique
    ON signals (external_id)
    WHERE external_id IS NOT NULL
  `);
}

const num = (v, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

const bool = v => v === true || v === "true" || v === 1 || v === "1";

function safeBreakdown(v) {
  if (!v) return {};
  if (typeof v === "object" && !Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return {}; }
}

function normalizeSignal(p) {
  const score = Math.max(0, Math.min(100, num(p.score, 50)));
  return {
    external_id: String(p.external_id || p.signal_id || `${Date.now()}-${Math.random().toString(36).slice(2,8)}`).slice(0,120),
    received_at: new Date().toISOString(),
    symbol: String(p.symbol || p.ticker || "N/A").slice(0,30),
    timeframe: String(p.timeframe || p.interval || "").slice(0,20),
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
    trend: String(p.trend || "").slice(0,50),
    structure: String(p.structure || "").slice(0,120),
    session_name: String(p.session || p.session_name || "").slice(0,50),
    mtf_trend: String(p.mtf_trend || "").slice(0,50),
    vwap_side: String(p.vwap_side || "").slice(0,50),
    order_block: String(p.order_block || "").slice(0,100),
    bos: bool(p.bos),
    choch: bool(p.choch),
    fvg: bool(p.fvg),
    liquidity_sweep: bool(p.liquidity_sweep || p.sweep),
    vwap_confirm: bool(p.vwap_confirm),
    mtf_confirm: bool(p.mtf_confirm),
    order_block_confirm: bool(p.order_block_confirm),
    market_phase: String(p.market_phase || "").slice(0,40),
    equal_highs: bool(p.equal_highs),
    equal_lows: bool(p.equal_lows),
    premium_discount: String(p.premium_discount || "").slice(0,40),
    fib_zone: String(p.fib_zone || "").slice(0,60),
    fvg_state: String(p.fvg_state || "").slice(0,50),
    ob_state: String(p.ob_state || "").slice(0,50),
    kill_zone: String(p.kill_zone || "").slice(0,50),
    score_breakdown: safeBreakdown(p.score_breakdown),
    reason: String(p.reason || p.setup || "").slice(0,2200)
  };
}

async function saveSignal(s) {
  if (!pool) {
    if (memorySignals.some(x => x.external_id === s.external_id)) return;
    memorySignals.unshift({ id: Date.now(), ...s });
    return;
  }

  await pool.query(`
    INSERT INTO signals (
      external_id,received_at,symbol,timeframe,signal,status,price,sl,tp1,tp2,tp3,
      score,probability,rsi,atr,rr,trend,structure,session_name,mtf_trend,vwap_side,
      order_block,bos,choch,fvg,liquidity_sweep,vwap_confirm,mtf_confirm,
      order_block_confirm,market_phase,equal_highs,equal_lows,premium_discount,
      fib_zone,fvg_state,ob_state,kill_zone,score_breakdown,reason
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
      $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39
    )
    ON CONFLICT DO NOTHING
  `, [
    s.external_id,s.received_at,s.symbol,s.timeframe,s.signal,s.status,s.price,s.sl,
    s.tp1,s.tp2,s.tp3,s.score,s.probability,s.rsi,s.atr,s.rr,s.trend,s.structure,
    s.session_name,s.mtf_trend,s.vwap_side,s.order_block,s.bos,s.choch,s.fvg,
    s.liquidity_sweep,s.vwap_confirm,s.mtf_confirm,s.order_block_confirm,
    s.market_phase,s.equal_highs,s.equal_lows,s.premium_discount,s.fib_zone,
    s.fvg_state,s.ob_state,s.kill_zone,JSON.stringify(s.score_breakdown),s.reason
  ]);
}

async function listSignals() {
  if (!pool) return memorySignals;
  return (await pool.query("SELECT * FROM signals ORDER BY received_at DESC LIMIT 2500")).rows;
}

function groupStats(data, keyFn) {
  const map = {};
  for (const x of data) {
    const key = keyFn(x) || "N/A";
    if (!map[key]) map[key] = { key, total:0, closed:0, wins:0, losses:0, totalR:0 };
    const g = map[key];
    g.total++;
    if (x.status === "CLOSED") {
      g.closed++;
      const r = Number(x.pnl_r || 0);
      g.totalR += r;
      if (r > 0) g.wins++;
      if (r < 0) g.losses++;
    }
  }
  return Object.values(map).map(g => ({...g, winRate:g.closed ? g.wins/g.closed*100 : 0}));
}

async function analytics() {
  const data = await listSignals();
  const closed = data.filter(x => x.status === "CLOSED");
  const wins = closed.filter(x => Number(x.pnl_r) > 0);
  const losses = closed.filter(x => Number(x.pnl_r) < 0);
  const totalR = closed.reduce((a,x)=>a+Number(x.pnl_r||0),0);
  const grossWin = wins.reduce((a,x)=>a+Number(x.pnl_r||0),0);
  const grossLoss = Math.abs(losses.reduce((a,x)=>a+Number(x.pnl_r||0),0));
  let eq = 0;
  const equityCurve = [...closed]
    .sort((a,b)=>new Date(a.closed_at||a.received_at)-new Date(b.closed_at||b.received_at))
    .map(x=>({time:x.closed_at||x.received_at,equity:(eq+=Number(x.pnl_r||0))}));

  return {
    summary:{
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
    bySymbol:groupStats(data,x=>x.symbol),
    bySession:groupStats(data,x=>x.session_name),
    byMarketPhase:groupStats(data,x=>x.market_phase),
    byPremiumDiscount:groupStats(data,x=>x.premium_discount),
    equityCurve
  };
}

async function closeSignal(payload) {
  const externalId = String(payload.external_id || payload.signal_id || "").slice(0,120);
  const result = String(payload.result || "").toUpperCase();
  if (!externalId) throw new Error("Lipsește external_id");
  if (!["TP1","TP2","TP3","SL","BE","CLOSED"].includes(result)) throw new Error("Rezultat invalid");

  const pnlMap = {TP1:2,TP2:3,TP3:4,SL:-1,BE:0,CLOSED:num(payload.pnl_r,0)};
  const pnlR = result === "CLOSED" ? num(payload.pnl_r,0) : pnlMap[result];

  if (!pool) {
    const item = memorySignals.find(x=>x.external_id===externalId);
    if (!item) throw new Error("Semnal negăsit");
    Object.assign(item,{status:"CLOSED",result,pnl_r:pnlR,closed_at:new Date().toISOString()});
    return item;
  }

  const q = await pool.query(`
    UPDATE signals SET status='CLOSED',result=$1,pnl_r=$2,closed_at=NOW()
    WHERE external_id=$3 RETURNING *
  `,[result,pnlR,externalId]);

  if (!q.rows.length) throw new Error("Semnal negăsit");
  return q.rows[0];
}

app.get("/health",(req,res)=>res.json({
  ok:true,
  version:"7.1.0",
  database:pool?"postgres":"memory",
  adminKeyConfigured:Boolean(ADMIN_KEY),
  time:new Date().toISOString()
}));

app.get("/api/signals",async(req,res)=>{
  try {
    res.json({ok:true,signals:await listSignals(),analytics:await analytics()});
  } catch (e) {
    console.error("GET /api/signals:", e);
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post("/api/test-signal",async(req,res)=>{
  try {
    if (!ADMIN_KEY || req.body?.adminKey !== ADMIN_KEY) {
      return res.status(401).json({ok:false,error:"ADMIN_KEY incorectă"});
    }

    const s = normalizeSignal({
      external_id:`TEST-${Date.now()}`,
      symbol:"US30",timeframe:"5",signal:"BUY",
      price:45000,sl:44920,tp1:45160,tp2:45240,tp3:45320,
      score:91,probability:81,rsi:58.4,atr:72,rr:2,
      trend:"Bullish",structure:"HH + HL + BOS",
      session:"New York",mtf_trend:"M15 bullish",vwap_side:"Above VWAP",
      order_block:"Fresh bullish OB",bos:true,fvg:true,liquidity_sweep:true,
      vwap_confirm:true,mtf_confirm:true,order_block_confirm:true,
      market_phase:"Expansion",equal_lows:true,premium_discount:"Discount",
      fib_zone:"0.618–0.705",fvg_state:"Valid / unfilled",ob_state:"Fresh",
      kill_zone:"New York Open",
      score_breakdown:{trend:15,mtf:15,vwap:10,structure:20,liquidity:10,fvg:8,order_block:8,session:5},
      reason:"Semnal demonstrativ v6.1."
    });

    await saveSignal(s);
    res.json({ok:true,signal:s});
  } catch (e) {
    console.error("POST /api/test-signal:", e);
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post("/api/manual-close",async(req,res)=>{
  try {
    if (!ADMIN_KEY || req.body?.adminKey !== ADMIN_KEY) {
      return res.status(401).json({ok:false,error:"ADMIN_KEY incorectă"});
    }
    res.json({ok:true,closed:await closeSignal(req.body)});
  } catch(e) {
    res.status(400).json({ok:false,error:e.message});
  }
});

app.post("/api/clear",async(req,res)=>{
  try {
    if (!ADMIN_KEY || req.body?.adminKey !== ADMIN_KEY) {
      return res.status(401).json({ok:false,error:"ADMIN_KEY incorectă"});
    }
    if (pool) await pool.query("DELETE FROM signals");
    else memorySignals = [];
    res.json({ok:true});
  } catch(e) {
    res.status(500).json({ok:false,error:e.message});
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const key = req.query.key || req.get("x-webhook-key") || "";

    if (!WEBHOOK_KEY || key !== WEBHOOK_KEY) {
      return res.status(401).json({
        ok: false,
        error: "WEBHOOK_KEY incorectă"
      });
    }

    let payload = req.body;

    // TradingView poate trimite JSON fie ca application/json,
    // fie ca text/plain. Convertim textul în obiect înainte de procesare.
    if (Buffer.isBuffer(payload)) {
      payload = payload.toString("utf8");
    }

    if (typeof payload === "string") {
      const raw = payload.trim();

      if (!raw) {
        return res.status(400).json({
          ok: false,
          error: "Payload webhook gol"
        });
      }

      try {
        payload = JSON.parse(raw);
      } catch (parseError) {
        console.error("Webhook JSON invalid:", raw);
        return res.status(400).json({
          ok: false,
          error: "Payload webhook invalid: mesajul nu este JSON valid"
        });
      }
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({
        ok: false,
        error: "Payload webhook invalid"
      });
    }

    console.log("Webhook primit:", {
      contentType: req.get("content-type") || "",
      event: payload.event || "SIGNAL",
      symbol: payload.symbol || payload.ticker || "N/A",
      signal: payload.signal || payload.side || "WAIT",
      external_id: payload.external_id || payload.signal_id || null
    });

    const event = String(payload.event || "SIGNAL").toUpperCase();

    if (event === "CLOSE") {
      return res.json({
        ok: true,
        closed: await closeSignal(payload)
      });
    }

    const signal = normalizeSignal(payload);
    await saveSignal(signal);

    return res.json({
      ok: true,
      signal
    });
  } catch (e) {
    console.error("POST /webhook:", e);
    return res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

initDb()
  .then(()=>app.listen(PORT,()=>console.log("PropTrader AI v7.1 rulează pe portul "+PORT)))
  .catch(e=>{console.error("DB init failed:",e);process.exit(1)});
