const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server includes v18 predictive SMC, multi-timeframe analysis, monitoring and Telegram', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /APP_VERSION = "18\.4\.0"/);
  assert.match(source, /ANALYSIS_TIMEFRAMES/);
  assert.match(source, /deriveCompletedHigherBars/);
  assert.match(source, /api\/history-aggregate-all/);
  assert.match(source, /auditBars/);
  assert.match(source, /notifyTelegramSignal/);
  assert.match(source, /api\/telegram\/test/);
  assert.match(source, /AUTO_PATTERN_SIGNALS/);
  assert.match(source, /patternToSignal/);
  assert.match(source, /api\/system-status/);
  assert.match(source, /monitorSystem/);
  assert.match(source, /syncOfficialNews/);
  assert.match(source, /OFFICIAL_NEWS_ENABLED/);
  assert.match(source, /FMP_ENABLED/);
  assert.match(source, /fmpRuntimeDisabledReason/);
  assert.match(source, /canonicalSymbol/);
  assert.match(source, /discoverSmcSetupsForBar/);
  assert.match(source, /processPendingSmcSetups/);
  assert.match(source, /revalidateSmcSetupAtEntry/);
  assert.match(source, /prepareSignalDecision/);
  assert.match(source, /buildTradeReview/);
  assert.match(source, /buildMonitoringReview/);
  assert.match(source, /reassessOpenSignalContext/);
  assert.match(source, /api\/smc-setups/);
  assert.match(source, /SMC_REQUIRE_M5_CONFIRMATION/);
});

test('frontend contains SMC plans, defensive array handling and M5-D1 aggregation controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /PropTrader AI v18\.4/);
  assert.match(html, /asArray/);
  assert.match(html, /aggregateAllTimeframes/);
  assert.match(html, /M5 · M15 · M30 · H1 · H4/);
  assert.match(html, /Backtest Integrity v18\.4/);
  assert.match(html, /Planuri SMC/);
  assert.match(html, /Construiește M15 · M30 · H1 · H4 · D1/);
  assert.match(html, /PropTrader_AI_v18_4_SMC_Visual\.pine/);
  assert.match(html, /Test semnal complet/);
  assert.match(html, /Stare sistem/);
});

test('Pine collector runs on M5 and sends closed BAR events', () => {
  const pine = fs.readFileSync(path.join(__dirname, '..', 'PropTrader_AI_v17_M5_H4_Collector.pine'), 'utf8');
  assert.match(pine, /timeframe\.multiplier == 5/);
  assert.match(pine, /barstate\.isconfirmed/);
  assert.match(pine, /\{\\"event\\":\\"BAR\\"/);
  assert.match(pine, /Colector M5 — webhook fără notificări/);
  assert.match(pine, /\{\{ticker\}\}/);
  assert.match(pine, /\{\{time\}\}/);
  assert.match(pine, /\{\{open\}\}/);
  assert.doesNotMatch(pine, /\balert\s*\(/);
  assert.match(pine, /M5 · M15 · M30 · H1 · H4/);
});

test('Pine SMC visual draws entry zone, SL and TP1-TP3 without creating alerts', () => {
  const pine = fs.readFileSync(path.join(__dirname, '..', 'PropTrader_AI_v18_4_SMC_Visual.pine'), 'utf8');
  assert.match(pine, /SMC Visual M5–H4/);
  assert.match(pine, /request\.security\(syminfo\.tickerid, "1D"/);
  assert.match(pine, /request\.security\(syminfo\.tickerid, "240"/);
  assert.match(pine, /box\.new/);
  assert.match(pine, /ENTRY /);
  assert.match(pine, /SL /);
  assert.match(pine, /TP1 /);
  assert.match(pine, /TP2 /);
  assert.match(pine, /TP3 /);
  assert.match(pine, /m5EntryTouched/);
  assert.match(pine, /m5Tp1Reached/);
  assert.match(pine, /visualTpStage/);
  assert.match(pine, /scoreKey5/);
  assert.match(pine, /planStatus == 2 and targetCompleted/);
  assert.match(pine, /visualStatus == 2 and m5TargetCompleted/);
  assert.doesNotMatch(pine, /visualStatus == 1 and m5Tp1Reached/);
  assert.match(pine, /telegramEligible/);
  assert.doesNotMatch(pine, /ULTIMUL PLAN/);
  assert.doesNotMatch(pine, /keepLastPlan/);
  assert.doesNotMatch(pine, /\balertcondition\s*\(/);
  assert.doesNotMatch(pine, /\balert\s*\(/);
});
