const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server includes v17 multi-timeframe analysis, monitoring, Telegram and integrity backtest', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /version:"17\.0\.0"/);
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
});

test('frontend contains defensive array handling and M5-H4 controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /PropTrader AI v17\.0/);
  assert.match(html, /asArray/);
  assert.match(html, /aggregateAllTimeframes/);
  assert.match(html, /M5 · M15 · M30 · H1 · H4/);
  assert.match(html, /Backtest Integrity v17\.0/);
  assert.match(html, /Test semnal complet/);
  assert.match(html, /Stare sistem/);
});

test('Pine collector runs on M5 and sends closed BAR events', () => {
  const pine = fs.readFileSync(path.join(__dirname, '..', 'PropTrader_AI_v17_M5_H4_Collector.pine'), 'utf8');
  assert.match(pine, /timeframe\.multiplier == 5/);
  assert.match(pine, /barstate\.isconfirmed/);
  assert.match(pine, /event\\\":\\\"BAR/);
  assert.doesNotMatch(pine, /event\\\":\\\"SIGNAL/);
  assert.match(pine, /M5 · M15 · M30 · H1 · H4/);
});
