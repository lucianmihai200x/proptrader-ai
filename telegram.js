"use strict";

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
  return [
    `<b>🚨 PropTrader AI</b>`,
    "",
    `<b>${icon} ${esc(side)} ${esc(s.symbol || "US30")}</b>`,
    `⏱ Timeframe: <b>${esc(s.timeframe || "15")}m</b>`,
    "",
    `💰 Intrare: <b>${fmt(s.price ?? s.entry)}</b>`,
    `🛑 SL: <b>${fmt(s.sl)}</b>`,
    `🎯 TP1: <b>${fmt(s.tp1)}</b>`,
    s.tp2 ? `🎯 TP2: <b>${fmt(s.tp2)}</b>` : "",
    s.tp3 ? `🎯 TP3: <b>${fmt(s.tp3)}</b>` : "",
    "",
    `📊 Scor adaptiv: <b>${fmt(score)}%</b>`,
    `🧠 Estimare Pine: <b>${fmt(s.probability ?? s.score)}%</b>`,
    s.session_name ? `🕒 Sesiune: <b>${esc(s.session_name)}</b>` : "",
    s.structure ? `📈 Structură: <b>${esc(s.structure)}</b>` : "",
    reason ? "" : "",
    reason ? `<b>Explicație:</b>\n${esc(reason).slice(0, 1200)}` : "",
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
async function sendSystemAlert(html) { return send(String(html || "")); }

module.exports = { status, sendTest, sendSignal, sendSystemAlert, signalMessage, MIN_SCORE };
