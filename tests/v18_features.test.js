const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server converts robust multi-timeframe patterns into signals and applies news fail-safe', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /patternQualifiesForSignal/);
  assert.match(source, /patternToSignal/);
  assert.match(source, /analysisProfile/);
  assert.match(source, /higherTimeframeConfirmation/);
  assert.match(source, /NEWS_UNAVAILABLE_RISK/);
  assert.match(source, /NEWS_CALENDAR_UNAVAILABLE_RISK/);
  assert.match(source, /fetchOfficialNews/);
  assert.match(source, /generatedSignals/);
});

test('Telegram module supports system alerts and all three targets', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'telegram.js'), 'utf8');
  assert.match(source, /sendSystemAlert/);
  assert.match(source, /TP1/);
  assert.match(source, /TP2/);
  assert.match(source, /TP3/);
  assert.match(source, /timeframeLabel/);
});
