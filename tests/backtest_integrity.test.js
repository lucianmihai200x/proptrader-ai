const test = require('node:test');
const assert = require('node:assert/strict');

const {
  performanceStats,
  aggregateBars,
  buildObservations,
  simulateTrade,
  auditBars,
  buildBacktest
} = require('../backtest');

function syntheticBars(count = 180, timeframe = '15') {
  const start = Date.UTC(2025, 0, 2, 8, 0, 0);
  const step = Number(timeframe) * 60_000;
  const bars = [];
  let close = 42_000;
  for (let index = 0; index < count; index += 1) {
    const drift = index % 12 < 8 ? 8 : -5;
    const open = close;
    close = open + drift + Math.sin(index / 4) * 3;
    bars.push({
      external_id: `SYN-${index}`,
      bar_time: new Date(start + index * step).toISOString(),
      symbol: 'US30',
      timeframe,
      open,
      high: Math.max(open, close) + 12,
      low: Math.min(open, close) - 12,
      close,
      volume: 100 + index
    });
  }
  return bars;
}

test('profit factor is not replaced by an artificial value when there are no losses', () => {
  const stats = performanceStats([1.5, 0.8, 1.1]);
  assert.equal(stats.profitFactor, null);
  assert.notEqual(stats.profitFactor, 99);
  assert.equal(stats.losses, 0);
});

test('M5 candles aggregate into complete M15 candles with correct OHLC', () => {
  const source = [
    ['2025-01-02T08:00:00.000Z', 100, 104, 99, 103],
    ['2025-01-02T08:05:00.000Z', 103, 106, 102, 105],
    ['2025-01-02T08:10:00.000Z', 105, 108, 101, 102],
    ['2025-01-02T08:15:00.000Z', 102, 105, 100, 104],
    ['2025-01-02T08:20:00.000Z', 104, 110, 103, 109],
    ['2025-01-02T08:25:00.000Z', 109, 111, 107, 108]
  ].map((row, index) => ({
    external_id: `M5-${index}`,
    bar_time: row[0],
    symbol: 'US30',
    timeframe: '5',
    open: row[1], high: row[2], low: row[3], close: row[4], volume: 1
  }));

  const result = aggregateBars(source, '5', '15');
  assert.equal(result.length, 2);
  assert.deepEqual(
    [result[0].open, result[0].high, result[0].low, result[0].close, result[0].volume],
    [100, 108, 99, 102, 3]
  );
});

test('TIME strategy tests BUY and SELL independently instead of reading future direction', () => {
  const observations = buildObservations(syntheticBars(), {
    horizonBars: 3,
    costBps: 0,
    slippageBps: 0,
    stopAtr: 1,
    targetR: 1.5
  });
  const firstTime = observations.find(item => item.strategy === 'TIME').time;
  const timeRows = observations.filter(item => item.strategy === 'TIME' && item.time === firstTime);
  assert.deepEqual(timeRows.map(item => item.side).sort(), ['BUY', 'SELL']);
  assert.ok(timeRows.every(item => new Date(item.entryTime) > new Date(item.time)));
});

test('ambiguous candle is evaluated conservatively with SL first', () => {
  const bars = [
    { bar_time: '2025-01-02T08:00:00.000Z', open: 100, high: 101, low: 99, close: 100, atr14: 10 },
    { bar_time: '2025-01-02T08:15:00.000Z', open: 100, high: 120, low: 85, close: 110, atr14: 10 }
  ];
  const trade = simulateTrade(bars, 0, 'BUY', {
    horizonBars: 1,
    costBps: 0,
    slippageBps: 0,
    stopAtr: 1,
    targetR: 1.5
  });
  assert.equal(trade.exitReason, 'SL_AMBIGUOUS');
  assert.equal(trade.returnR, -1);
});

test('data audit removes duplicate timestamps and invalid OHLC rows', () => {
  const bars = syntheticBars(5);
  const duplicate = { ...bars[2], external_id: 'duplicate' };
  const invalid = { ...bars[3], external_id: 'invalid', high: bars[3].low - 1 };
  const audited = auditBars([...bars, duplicate, invalid], '15');
  assert.equal(audited.audit.duplicatesRemoved, 1);
  assert.equal(audited.audit.rejected, 1);
  assert.equal(audited.bars.length, 5);
});

test('backtest report declares its integrity rules', () => {
  const report = buildBacktest(syntheticBars(1200), {
    horizonBars: 3,
    minSamples: 30,
    minProbability: 40,
    costBps: 1,
    slippageBps: 0.5,
    walkForwardFolds: 5,
    stopAtr: 1.2,
    targetR: 1.5
  });
  assert.equal(report.summary.integrity.lookAheadBiasRemoved, true);
  assert.match(report.summary.integrity.entry, /următoarea lumânare/);
  assert.ok(report.results.every(result => result.test.profitFactor !== 99));
});
