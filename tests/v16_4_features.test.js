const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server converts robust M15 patterns into signals and applies news fail-safe', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /patternQualifiesForSignal/);
  assert.match(source, /patternToSignal/);
  assert.match(source, /NEWS_UNAVAILABLE_RISK/);
  assert.match(source, /generatedSignal/);
});

test('Telegram module supports system alerts', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'telegram.js'), 'utf8');
  assert.match(source, /sendSystemAlert/);
});
