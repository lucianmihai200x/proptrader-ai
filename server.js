
const express=require("express");
const path=require("path");
const {Pool}=require("pg");
const app=express();
const PORT=process.env.PORT||3000;
const WEBHOOK_KEY=process.env.WEBHOOK_KEY||"";
const ADMIN_KEY=process.env.ADMIN_KEY||"";
const DATABASE_URL=process.env.DATABASE_URL||"";
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}}):null;
let memory=[];

app.use(express.json({limit:"200kb"}));
app.use(express.static(path.join(__dirname,"public")));

async function init(){
 if(!pool)return;
 await pool.query(`CREATE TABLE IF NOT EXISTS signals(
 id BIGSERIAL PRIMARY KEY,
 received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 symbol TEXT NOT NULL,timeframe TEXT,signal TEXT NOT NULL,
 price NUMERIC,sl NUMERIC,tp1 NUMERIC,tp2 NUMERIC,
 score NUMERIC,rsi NUMERIC,atr NUMERIC,rr NUMERIC,reason TEXT)`);
}
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
function norm(p){
 return {
  received_at:new Date().toISOString(),
  symbol:String(p.symbol||p.ticker||"N/A").slice(0,30),
  timeframe:String(p.timeframe||p.interval||"").slice(0,20),
  signal:String(p.signal||p.side||"WAIT").toUpperCase(),
  price:n(p.price??p.close),sl:n(p.sl),tp1:n(p.tp1??p.tp),tp2:n(p.tp2),
  score:Math.max(0,Math.min(100,n(p.score,50))),rsi:n(p.rsi),atr:n(p.atr),rr:n(p.rr),
  reason:String(p.reason||p.setup||"").slice(0,1000)
 };
}
async function save(s){
 if(!pool){memory.unshift({id:Date.now(),...s});memory=memory.slice(0,300);return;}
 await pool.query(`INSERT INTO signals(received_at,symbol,timeframe,signal,price,sl,tp1,tp2,score,rsi,atr,rr,reason)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
 [s.received_at,s.symbol,s.timeframe,s.signal,s.price,s.sl,s.tp1,s.tp2,s.score,s.rsi,s.atr,s.rr,s.reason]);
}
async function list(){
 if(!pool)return memory;
 return (await pool.query(`SELECT * FROM signals ORDER BY received_at DESC LIMIT 200`)).rows;
}
async function clearAll(){if(pool)await pool.query("DELETE FROM signals");else memory=[];}
async function telegram(s){
 const token=process.env.TELEGRAM_BOT_TOKEN,chat=process.env.TELEGRAM_CHAT_ID;
 if(!token||!chat||s.signal==="WAIT")return;
 const icon=s.signal==="BUY"?"🟢":"🔴";
 const text=[`${icon} ${s.symbol} — ${s.signal}`,`Timeframe: ${s.timeframe||"-"}`,
 `Entry: ${s.price}`,`SL: ${s.sl}`,`TP1: ${s.tp1}`,s.tp2?`TP2: ${s.tp2}`:"",
 `Scor: ${s.score}%`,s.rr?`RR: 1:${s.rr}`:"",s.reason?`Motiv: ${s.reason}`:""].filter(Boolean).join("\n");
 await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chat,text})
 });
}
app.get("/health",(req,res)=>res.json({ok:true,database:pool?"postgres":"memory",time:new Date().toISOString()}));
app.get("/api/signals",async(req,res)=>{try{res.json({ok:true,signals:await list()})}catch(e){res.status(500).json({ok:false,error:"Eroare citire"})}});
app.post("/webhook",async(req,res)=>{
 try{
  const key=req.query.key||req.get("x-webhook-key")||"";
  if(!WEBHOOK_KEY||key!==WEBHOOK_KEY)return res.status(401).json({ok:false,error:"Cheie invalidă"});
  const s=norm(req.body);
  if(!["BUY","SELL","WAIT"].includes(s.signal))return res.status(400).json({ok:false,error:"Semnal invalid"});
  await save(s);await telegram(s);res.json({ok:true,signal:s});
 }catch(e){res.status(500).json({ok:false,error:"Eroare webhook"})}
});
app.post("/api/clear",async(req,res)=>{
 try{
  const key=req.body?.adminKey||req.get("x-admin-key")||"";
  if(!ADMIN_KEY||key!==ADMIN_KEY)return res.status(401).json({ok:false,error:"Neautorizat"});
  await clearAll();res.json({ok:true});
 }catch(e){res.status(500).json({ok:false,error:"Eroare ștergere"})}
});
init().then(()=>app.listen(PORT,()=>console.log("PropTrader AI pornit pe "+PORT))).catch(e=>{console.error(e);process.exit(1)});
