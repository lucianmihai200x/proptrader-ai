const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('server includes v16 health and resilient history downloader', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(source, /version:"16\.0\.0"/);
  assert.match(source, /HISTORY_RETRY_ATTEMPTS/);
  assert.match(source, /normalizeDukascopyRows/);
  assert.match(source, /resumeFrom/);
});

test('frontend contains history and backtest page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(html, /data-page="history"/);
  assert.match(html, /Istoric & Backtest/);
});
