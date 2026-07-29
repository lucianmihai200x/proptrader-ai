const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server includes v16.3 M15, Telegram, aggregation and integrity backtest', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /version:"16\.3\.0"/);
  assert.match(source, /ANALYSIS_TIMEFRAME/);
  assert.match(source, /api\/history-aggregate/);
  assert.match(source, /auditBars/);
  assert.match(source, /notifyTelegramSignal/);
  assert.match(source, /api\/telegram\/test/);
});

test('frontend contains defensive array handling and M15 controls', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /PropTrader AI v16\.3/);
  assert.match(html, /asArray/);
  assert.match(html, /aggregateM15/);
  assert.match(html, /Backtest Integrity v16\.3/);
  assert.match(html, /Test Telegram/);
});

test('Pine engine is M15 and sends BAR plus selective SIGNAL events', () => {
  const pine = fs.readFileSync(path.join(__dirname, '..', 'PropTrader_AI_v16_3_M15_Signal_Engine.pine'), 'utf8');
  assert.match(pine, /timeframe\.multiplier == 15/);
  assert.match(pine, /event\\\":\\\"BAR/);
  assert.match(pine, /event\\\":\\\"SIGNAL/);
  assert.doesNotMatch(pine, /Analiză automată 30m/);
});
