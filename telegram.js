"use strict";

const { timeframeLabel } = require("./timeframes");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const ENABLED = String(process.env.TELEGRAM_ENABLED || "true").toLowerCase() !== "false";
const MIN_SCORE = Math.max(0, Math.min(100, Number(process.env.TELEGRAM_MIN_SCORE || 85)));
const MAX_RETRIES = Math.max(0, Math.min(5, Number(process.env.TELEGRAM_MAX_RETRIES || 2)));
const TIMEOUT_MS = Math.max(2000, Number(process.env.TELEGRAM_TIMEOUT_MS || 10000));

function status() {
  return {
    enabled: ENABLED,
    configured: Boolean(ENABLED && TOKEN && CHAT_ID),
    tokenConfigured: Boolean(TOKEN),
    chatConfigured: Boolean(CHAT_ID),
    minScore: MIN_SCORE,
    maxRetries: MAX_RETRIES
  };
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fmt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 2 }).format(n);
}

function signalMessage(s) {
  const side = String(s.signal || s.side || "").toUpperCase();
  const icon = side === "BUY" ? "🟢" : "🔴";
  const score = Number(s.adaptive_score ?? s.score ?? 0);
  const reason = String(s.decision_reason || s.reason || "").trim();
  const entry = Number(s.price ?? s.entry);
  const sl = Number(s.sl);
  const risk = Math.abs(entry - sl);
  const targetR = value => risk > 0 ? Math.abs(Number(value) - entry) / risk : 0;
  const probability = Number(s.probability);
  return [
    `<b>🚨 PropTrader AI</b>`,
    "",
    `<b>${icon} ${esc(side)} ${esc(s.symbol || "US30")}</b>`,
    `⏱ Interval analizat: <b>${esc(timeframeLabel(s.timeframe || "15"))}</b>`,
    "",
    `💰 Intrare: <b>${fmt(entry)}</b>`,
    `🛑 SL: <b>${fmt(s.sl)}</b>`,
    `🎯 TP1: <b>${fmt(s.tp1)}</b> (${fmt(targetR(s.tp1))}R)`,
    `🎯 TP2: <b>${fmt(s.tp2)}</b> (${fmt(targetR(s.tp2))}R)`,
    `🎯 TP3: <b>${fmt(s.tp3)}</b> (${fmt(targetR(s.tp3))}R)`,
    "",
    `📊 Scor adaptiv: <b>${fmt(score)}%</b>`,
    probability > 0 ? `🧠 Probabilitate istorică: <b>${fmt(probability)}%</b>` : "🧠 Probabilitate istorică: <b>NEVALIDATĂ</b>",
    s.session_name ? `🕒 Sesiune: <b>${esc(s.session_name)}</b>` : "",
    s.structure ? `📈 Structură: <b>${esc(s.structure)}</b>` : "",
    reason ? "" : "",
    reason ? `<b>Explicație:</b>\n${esc(reason).slice(0, 1200)}` : "",
    "",
    `<i>${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}</i>`
  ].filter(Boolean).join("\n");
}

function pendingSetupMessage(s) {
  const side = String(s.side || s.signal || "").toUpperCase();
  const icon = side === "BUY" ? "🟢" : "🔴";
  const risk = Math.abs(Number(s.entry) - Number(s.sl));
  const targetR = value => risk > 0 ? Math.abs(Number(value) - Number(s.entry)) / risk : 0;
  const probability = Number(s.historical_probability);
  return [
    "<b>🗺️ PLAN SMC — INTRARE ÎN AȘTEPTARE</b>",
    "",
    `<b>${icon} ${esc(side)} ${esc(s.symbol || "US30")}</b> · ${esc(timeframeLabel(s.timeframe || "15"))}`,
    "⚠️ <b>NU intra la prețul curent.</b> Așteaptă retragerea în order block.",
    "",
    `Preț la analiză: <b>${fmt(s.current_price)}</b>`,
    `Zonă order block: <b>${fmt(s.zone_low)} – ${fmt(s.zone_high)}</b>`,
    `Intrare planificată: <b>${fmt(s.entry)}</b>`,
    `SL: <b>${fmt(s.sl)}</b>`,
    `TP1: <b>${fmt(s.tp1)}</b> (${fmt(targetR(s.tp1))}R)`,
    `TP2: <b>${fmt(s.tp2)}</b> (${fmt(targetR(s.tp2))}R)`,
    `TP3: <b>${fmt(s.tp3)}</b> (${fmt(targetR(s.tp3))}R)`,
    "",
    `Bias: <b>D1 ${esc(s.d1_bias)} · H4 ${esc(s.h4_bias)}</b>`,
    `Structură: <b>${esc(s.structure_event)}</b>${s.fvg ? " · FVG" : ""}${s.liquidity_sweep ? " · sweep lichiditate" : ""}`,
    `Scor SMC adaptiv: <b>${fmt(s.adaptive_score)}%</b>`,
    probability > 0
      ? `Rezultate model: <b>N=${fmt(s.learning_samples)} · ${fmt(probability)}% win ponderat</b>`
      : `Rezultate model: <b>NEVALIDAT (N=${fmt(s.learning_samples)})</b>`,
    "",
    "Serverul va trimite separat semnalul LIVE numai dacă prețul atinge zona și apare confirmarea M5.",
    s.reason ? `<i>${esc(s.reason).slice(0, 900)}</i>` : "",
    "",
    `<i>${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}</i>`
  ].filter(Boolean).join("\n");
}

function testMessage() {
  return [
    "<b>✅ PropTrader AI — test Telegram reușit</b>",
    "",
    "Notificările automate sunt configurate corect.",
    "Semnalele LIVE validate vor fi trimise în acest chat.",
    "",
    `<i>${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })}</i>`
  ].join("\n");
}

async function request(method, payload) {
  if (!status().configured) throw new Error("Telegram nu este configurat complet în Render Environment");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.description || `Telegram HTTP ${response.status}`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

async function send(text) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await request("sendMessage", {
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      });
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function sendTest() { return send(testMessage()); }
async function sendSignal(signal) { return send(signalMessage(signal)); }
async function sendPendingSetup(setup) { return send(pendingSetupMessage(setup)); }
async function sendSystemAlert(html) { return send(String(html || "")); }

module.exports = { status, sendTest, sendSignal, sendPendingSetup, sendSystemAlert, signalMessage, pendingSetupMessage, MIN_SCORE };
