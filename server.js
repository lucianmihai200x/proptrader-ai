
const express=require('express');
const path=require('path');
const {Pool}=require('pg');
const app=express(),PORT=process.env.PORT||3000;
const WEBHOOK_KEY=process.env.WEBHOOK_KEY||'',ADMIN_KEY=process.env.ADMIN_KEY||'',DATABASE_URL=process.env.DATABASE_URL||'';
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false}}):null;
let memory=[];
app.use(express.json({limit:'300kb'}));
app.use(express.static(path.join(__dirname,'public')));

async function init(){
 if(!pool)return;
 await pool.query(`CREATE TABLE IF NOT EXISTS signals(
 id BIGSERIAL PRIMARY KEY,received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 symbol TEXT NOT NULL,timeframe TEXT,signal TEXT NOT NULL,price NUMERIC,sl NUMERIC,
 tp1 NUMERIC,tp2 NUMERIC,tp3 NUMERIC,score NUMERIC,probability NUMERIC,rsi NUMERIC,
 atr NUMERIC,rr NUMERIC,trend TEXT,structure TEXT,session_name TEXT,bos BOOLEAN DEFAULT FALSE,
 choch BOOLEAN DEFAULT FALSE,fvg BOOLEAN DEFAULT FALSE,liquidity_sweep BOOLEAN DEFAULT FALSE,reason TEXT)`);
}
const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const bool=v=>v===true||v==='true'||v===1||v==='1';
function norm(p){
 const score=Math.max(0,Math.min(100,num(p.score,50)));
 return {received_at:new Date().toISOString(),symbol:String(p.symbol||p.ticker||'N/A').slice(0,30),
 timeframe:String(p.timeframe||p.interval||'').slice(0,20),signal:String(p.signal||p.side||'WAIT').toUpperCase(),
 price:num(p.price??p.close),sl:num(p.sl),tp1:num(p.tp1??p.tp),tp2:num(p.tp2),tp3:num(p.tp3),
 score,probability:Math.max(0,Math.min(100,num(p.probability,score))),rsi:num(p.rsi),atr:num(p.atr),rr:num(p.rr),
 trend:String(p.trend||'').slice(0,50),structure:String(p.structure||'').slice(0,80),
 session_name:String(p.session||p.session_name||'').slice(0,50),bos:bool(p.bos),choch:bool(p.choch),
 fvg:bool(p.fvg),liquidity_sweep:bool(p.liquidity_sweep||p.sweep),reason:String(p.reason||p.setup||'').slice(0,1500)};
}
async function save(s){
 if(!pool){memory.unshift({id:Date.now(),...s});memory=memory.slice(0,500);return;}
 await pool.query(`INSERT INTO signals(received_at,symbol,timeframe,signal,price,sl,tp1,tp2,tp3,score,probability,rsi,atr,rr,trend,structure,session_name,bos,choch,fvg,liquidity_sweep,reason)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
 [s.received_at,s.symbol,s.timeframe,s.signal,s.price,s.sl,s.tp1,s.tp2,s.tp3,s.score,s.probability,s.rsi,s.atr,s.rr,s.trend,s.structure,s.session_name,s.bos,s.choch,s.fvg,s.liquidity_sweep,s.reason]);
}
async function list(){return pool?(await pool.query('SELECT * FROM signals ORDER BY received_at DESC LIMIT 300')).rows:memory;}
async function clear(){if(pool)await pool.query('DELETE FROM signals');else memory=[];}
async function telegram(s){
 const token=process.env.TELEGRAM_BOT_TOKEN,chat=process.env.TELEGRAM_CHAT_ID;
 if(!token||!chat||s.signal==='WAIT')return;
 const icon=s.signal==='BUY'?'🟢':'🔴';
 const text=[`${icon} ${s.symbol} — ${s.signal}`,`TF: ${s.timeframe}`,`Sesiune: ${s.session_name||'-'}`,
 `Trend: ${s.trend||'-'}`,`Structură: ${s.structure||'-'}`,`Entry: ${s.price}`,`SL: ${s.sl}`,
 `TP1: ${s.tp1}`,s.tp2?`TP2: ${s.tp2}`:'',s.tp3?`TP3: ${s.tp3}`:'',`Scor: ${s.score}%`,
 `Probabilitate estimată: ${s.probability}%`,s.rr?`RR: 1:${s.rr}`:'',s.reason?`Motiv: ${s.reason}`:''].filter(Boolean).join('\n');
 await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text})});
}
app.get('/health',(q,r)=>r.json({ok:true,version:'2.0.0',database:pool?'postgres':'memory',time:new Date().toISOString()}));
app.get('/api/signals',async(q,r)=>{try{r.json({ok:true,signals:await list()})}catch(e){r.status(500).json({ok:false,error:'Eroare citire'})}});
app.post('/webhook',async(q,r)=>{try{
 const key=q.query.key||q.get('x-webhook-key')||'';if(!WEBHOOK_KEY||key!==WEBHOOK_KEY)return r.status(401).json({ok:false,error:'Cheie invalidă'});
 const s=norm(q.body);if(!['BUY','SELL','WAIT'].includes(s.signal))return r.status(400).json({ok:false,error:'Semnal invalid'});
 await save(s);await telegram(s);r.json({ok:true,signal:s});
}catch(e){r.status(500).json({ok:false,error:'Eroare webhook'})}});
app.post('/api/test-signal',async(q,r)=>{try{
 const key=q.body?.adminKey||q.get('x-admin-key')||'';if(!ADMIN_KEY||key!==ADMIN_KEY)return r.status(401).json({ok:false,error:'Neautorizat'});
 const s=norm({symbol:'US30',timeframe:'5',signal:'BUY',price:45000,sl:44920,tp1:45160,tp2:45240,tp3:45320,score:82,probability:74,rsi:58.2,atr:70,rr:2,trend:'Bullish',structure:'BOS bullish',session:'New York',bos:true,fvg:true,liquidity_sweep:true,reason:'Semnal demonstrativ'});
 await save(s);await telegram(s);r.json({ok:true,signal:s});
}catch(e){r.status(500).json({ok:false,error:'Eroare test'})}});
app.post('/api/clear',async(q,r)=>{try{
 const key=q.body?.adminKey||q.get('x-admin-key')||'';if(!ADMIN_KEY||key!==ADMIN_KEY)return r.status(401).json({ok:false,error:'Neautorizat'});
 await clear();r.json({ok:true});
}catch(e){r.status(500).json({ok:false,error:'Eroare ștergere'})}});
init().then(()=>app.listen(PORT,()=>console.log('PropTrader AI v2 pe '+PORT))).catch(e=>{console.error(e);process.exit(1)});
