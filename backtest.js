"use strict";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function timeframeMinutes(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  if (/^\d+$/.test(raw)) return Math.max(1, Number(raw));
  const match = raw.match(/^(\d+)(M|H|D)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "M" ? amount : match[2] === "H" ? amount * 60 : amount * 1440;
}

function bucketFor(date, timeframe) {
  const d = new Date(date);
  const tf = timeframeMinutes(timeframe) || 15;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  const bucket = Math.floor(minutes / tf) * tf;
  return `${String(Math.floor(bucket / 60)).padStart(2, "0")}:${String(bucket % 60).padStart(2, "0")} UTC`;
}

function wilsonLower(wins, total, z = 1.96) {
  if (!total) return 0;
  const p = wins / total;
  const z2 = z * z;
  return ((p + z2 / (2 * total)) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) /
    (1 + z2 / total) * 100;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function performanceStats(returnsR) {
  const returns = returnsR.filter(Number.isFinite);
  const trades = returns.length;
  const wins = returns.filter(value => value > 1e-9);
  const losses = returns.filter(value => value < -1e-9);
  const breakeven = trades - wins.length - losses.length;
  const totalR = returns.reduce((sum, value) => sum + value, 0);
  const grossWinR = wins.reduce((sum, value) => sum + value, 0);
  const grossLossR = Math.abs(losses.reduce((sum, value) => sum + value, 0));

  let equity = 0;
  let peak = 0;
  let maxDrawdownR = 0;
  let lossStreak = 0;
  let maxLossStreak = 0;
  for (const value of returns) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdownR = Math.max(maxDrawdownR, peak - equity);
    if (value < 0) {
      lossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      lossStreak = 0;
    }
  }

  const expectancyR = trades ? totalR / trades : 0;
  const variance = trades > 1
    ? returns.reduce((sum, value) => sum + Math.pow(value - expectancyR, 2), 0) / (trades - 1)
    : 0;
  const standardDeviationR = Math.sqrt(Math.max(0, variance));

  return {
    trades,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    winRate: trades ? wins.length / trades * 100 : 0,
    lowerBound: wilsonLower(wins.length, trades),
    expectancyR,
    avgReturnR: expectancyR,
    medianR: median(returns),
    totalR,
    grossWinR,
    grossLossR,
    // null is deliberate: an infinite PF is not converted into a fake value such as 99.
    profitFactor: grossLossR > 0 ? grossWinR / grossLossR : null,
    maxDrawdownR,
    maxLossStreak,
    standardDeviationR,
    systemQuality: standardDeviationR > 0 ? expectancyR / standardDeviationR * Math.sqrt(trades) : 0
  };
}

function emaSeries(values, period) {
  const output = new Array(values.length).fill(null);
  if (!values.length) return output;
  const multiplier = 2 / (period + 1);
  let ema = values[0];
  output[0] = ema;
  for (let index = 1; index < values.length; index += 1) {
    ema = values[index] * multiplier + ema * (1 - multiplier);
    output[index] = ema;
  }
  return output;
}

function rsiSeries(values, period = 14) {
  const output = new Array(values.length).fill(null);
  if (values.length <= period) return output;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index += 1) {
    const delta = values[index] - values[index - 1];
    gain += Math.max(0, delta);
    loss += Math.max(0, -delta);
  }
  gain /= period;
  loss /= period;
  output[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let index = period + 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    gain = (gain * (period - 1) + Math.max(0, delta)) / period;
    loss = (loss * (period - 1) + Math.max(0, -delta)) / period;
    output[index] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return output;
}

function atrSeries(bars, period = 14) {
  const trueRange = bars.map((bar, index) => {
    const high = finite(bar.high);
    const low = finite(bar.low);
    if (index === 0) return high - low;
    const previousClose = finite(bars[index - 1].close);
    return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  });
  return emaSeries(trueRange, period);
}

function enrichBars(bars) {
  const closes = bars.map(bar => finite(bar.close));
  const ema20 = emaSeries(closes, 20);
  const ema50 = emaSeries(closes, 50);
  const rsi14 = rsiSeries(closes, 14);
  const atr14 = atrSeries(bars, 14);
  return bars.map((bar, index) => ({
    ...bar,
    ema20: ema20[index],
    ema50: ema50[index],
    rsi14: rsi14[index],
    atr14: atr14[index]
  }));
}

function auditBars(inputBars, timeframe) {
  const expectedMinutes = timeframeMinutes(timeframe);
  const valid = [];
  let rejected = 0;
  for (const row of Array.isArray(inputBars) ? inputBars : []) {
    const time = new Date(row.bar_time);
    const open = finite(row.open, NaN);
    const high = finite(row.high, NaN);
    const low = finite(row.low, NaN);
    const close = finite(row.close, NaN);
    if (Number.isNaN(time.getTime()) || ![open, high, low, close].every(Number.isFinite) ||
        high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      rejected += 1;
      continue;
    }
    valid.push({ ...row, bar_time: time.toISOString(), open, high, low, close, volume: finite(row.volume) });
  }
  valid.sort((a, b) => new Date(a.bar_time) - new Date(b.bar_time));

  const byTime = new Map();
  for (const bar of valid) byTime.set(bar.bar_time, bar);
  const deduplicated = [...byTime.values()].sort((a, b) => new Date(a.bar_time) - new Date(b.bar_time));
  const duplicatesRemoved = valid.length - deduplicated.length;

  let gaps = 0;
  let largestGapMinutes = 0;
  if (expectedMinutes) {
    for (let index = 1; index < deduplicated.length; index += 1) {
      const deltaMinutes = (new Date(deduplicated[index].bar_time) - new Date(deduplicated[index - 1].bar_time)) / 60000;
      // Ignore normal weekend closures while still reporting unusual intraday gaps.
      if (deltaMinutes > expectedMinutes * 1.5 && deltaMinutes < 36 * 60) gaps += 1;
      largestGapMinutes = Math.max(largestGapMinutes, deltaMinutes);
    }
  }

  return {
    bars: deduplicated,
    audit: {
      received: Array.isArray(inputBars) ? inputBars.length : 0,
      valid: deduplicated.length,
      rejected,
      duplicatesRemoved,
      intradayGaps: gaps,
      largestGapMinutes: Number(largestGapMinutes.toFixed(2)),
      chronological: true
    }
  };
}

function simulateTrade(enrichedBars, signalIndex, side, settings) {
  const signalBar = enrichedBars[signalIndex];
  const entryBar = enrichedBars[signalIndex + 1];
  if (!entryBar) return null;

  const entry = finite(entryBar.open, NaN);
  const atr = finite(signalBar.atr14, NaN);
  if (!Number.isFinite(entry) || !Number.isFinite(atr) || atr <= 0) return null;

  const riskDistance = atr * settings.stopAtr;
  const stop = side === "BUY" ? entry - riskDistance : entry + riskDistance;
  const target = side === "BUY" ? entry + riskDistance * settings.targetR : entry - riskDistance * settings.targetR;
  const lastIndex = Math.min(enrichedBars.length - 1, signalIndex + settings.horizonBars);

  let grossR = null;
  let exitReason = "TIME";
  let exitPrice = finite(enrichedBars[lastIndex].close);

  for (let index = signalIndex + 1; index <= lastIndex; index += 1) {
    const bar = enrichedBars[index];
    const stopHit = side === "BUY" ? finite(bar.low) <= stop : finite(bar.high) >= stop;
    const targetHit = side === "BUY" ? finite(bar.high) >= target : finite(bar.low) <= target;

    // Conservative policy: when both are touched in one candle, count the stop first.
    if (stopHit) {
      grossR = -1;
      exitReason = targetHit ? "SL_AMBIGUOUS" : "SL";
      exitPrice = stop;
      break;
    }
    if (targetHit) {
      grossR = settings.targetR;
      exitReason = "TP";
      exitPrice = target;
      break;
    }
  }

  if (grossR === null) {
    const signedMove = (side === "BUY" ? exitPrice - entry : entry - exitPrice) / riskDistance;
    grossR = clamp(signedMove, -1, settings.targetR);
  }

  const roundTripCostPoints = entry * settings.costBps / 10000;
  const slippagePoints = entry * settings.slippageBps / 10000;
  const costR = (roundTripCostPoints + slippagePoints) / riskDistance;
  const netR = grossR - costR;

  return {
    entryTime: entryBar.bar_time,
    entry,
    stop,
    target,
    riskDistance,
    grossR,
    costR,
    returnR: netR,
    returnPct: netR * riskDistance / entry * 100,
    exitReason,
    exitPrice
  };
}

function signalCandidates(enrichedBars, index) {
  const bar = enrichedBars[index];
  const previous = enrichedBars[index - 1];
  const prior20 = enrichedBars.slice(index - 20, index);
  if (!previous || prior20.length < 20) return [];

  const close = finite(bar.close);
  const atr = Math.max(1e-9, finite(bar.atr14));
  const priorHigh = Math.max(...prior20.map(item => finite(item.high)));
  const priorLow = Math.min(...prior20.map(item => finite(item.low)));
  const candidates = [];

  // TIME tests both directions. The future move is never used to choose BUY or SELL.
  candidates.push(["TIME", "BUY"], ["TIME", "SELL"]);

  const emaSlopeUp = bar.ema20 != null && enrichedBars[index - 2]?.ema20 != null && bar.ema20 > enrichedBars[index - 2].ema20;
  const emaSlopeDown = bar.ema20 != null && enrichedBars[index - 2]?.ema20 != null && bar.ema20 < enrichedBars[index - 2].ema20;
  if (bar.ema20 != null && bar.ema50 != null) {
    if (close > bar.ema20 && bar.ema20 > bar.ema50 && emaSlopeUp && bar.rsi14 >= 50 && bar.rsi14 <= 75) candidates.push(["TREND", "BUY"]);
    if (close < bar.ema20 && bar.ema20 < bar.ema50 && emaSlopeDown && bar.rsi14 <= 50 && bar.rsi14 >= 25) candidates.push(["TREND", "SELL"]);
  }

  if (previous.ema20 != null && bar.ema20 != null && bar.ema50 != null) {
    if (finite(previous.close) <= previous.ema20 && close > bar.ema20 && bar.ema20 > bar.ema50 && bar.rsi14 >= 50) candidates.push(["PULLBACK", "BUY"]);
    if (finite(previous.close) >= previous.ema20 && close < bar.ema20 && bar.ema20 < bar.ema50 && bar.rsi14 <= 50) candidates.push(["PULLBACK", "SELL"]);
  }

  if (close > priorHigh + atr * 0.05) candidates.push(["BREAKOUT", "BUY"]);
  if (close < priorLow - atr * 0.05) candidates.push(["BREAKOUT", "SELL"]);

  const bullishSweep = finite(bar.low) < priorLow && close > priorLow && close > finite(bar.open);
  const bearishSweep = finite(bar.high) > priorHigh && close < priorHigh && close < finite(bar.open);
  if (bullishSweep) candidates.push(["LIQUIDITY_SWEEP", "BUY"]);
  if (bearishSweep) candidates.push(["LIQUIDITY_SWEEP", "SELL"]);

  return candidates;
}

function buildObservations(bars, rawSettings = {}) {
  const settings = {
    horizonBars: clamp(Math.floor(finite(rawSettings.horizonBars, 3)), 1, 24),
    costBps: clamp(finite(rawSettings.costBps, 2), 0, 50),
    slippageBps: clamp(finite(rawSettings.slippageBps, 0.5), 0, 25),
    stopAtr: clamp(finite(rawSettings.stopAtr, 1.2), 0.5, 4),
    targetR: clamp(finite(rawSettings.targetR, 1.5), 0.75, 5)
  };
  const enriched = enrichBars(bars);
  const observations = [];

  for (let index = 55; index < enriched.length - settings.horizonBars - 1; index += 1) {
    const bar = enriched[index];
    const weekday = new Date(bar.bar_time).getUTCDay();
    const bucket = bucketFor(bar.bar_time, bar.timeframe);
    const candidates = signalCandidates(enriched, index);
    for (const [strategy, side] of candidates) {
      const trade = simulateTrade(enriched, index, side, settings);
      if (!trade) continue;
      observations.push({
        time: bar.bar_time,
        signalIndex: index,
        weekday,
        bucket,
        strategy,
        side,
        atrPct: finite(bar.atr14) / Math.max(1e-9, finite(bar.close)) * 100,
        ...trade
      });
    }
  }
  return observations;
}

function anchoredWalkForward(observations, folds = 5, minimumTraining = 30) {
  const sorted = [...observations].sort((a, b) => new Date(a.time) - new Date(b.time));
  const foldResults = [];
  const minTrain = Math.max(minimumTraining, Math.floor(sorted.length * 0.5));
  const remaining = sorted.length - minTrain;
  if (remaining < folds * 3) {
    return {
      folds: [],
      totalFolds: 0,
      positiveFolds: 0,
      stability: 0,
      oos: performanceStats([]),
      train: performanceStats(sorted.slice(0, minTrain).map(item => item.returnR))
    };
  }

  const outOfSample = [];
  for (let fold = 0; fold < folds; fold += 1) {
    const testStart = minTrain + Math.floor(remaining * fold / folds);
    const testEnd = minTrain + Math.floor(remaining * (fold + 1) / folds);
    const training = sorted.slice(0, testStart);
    const test = sorted.slice(testStart, testEnd);
    if (test.length < 3) continue;
    const trainStats = performanceStats(training.map(item => item.returnR));
    const testStats = performanceStats(test.map(item => item.returnR));
    outOfSample.push(...test.map(item => item.returnR));
    foldResults.push({
      index: fold + 1,
      trainTrades: training.length,
      testTrades: test.length,
      train: trainStats,
      test: testStats,
      positive: trainStats.expectancyR > 0 && testStats.expectancyR > 0 &&
        (testStats.profitFactor === null || testStats.profitFactor > 1)
    });
  }

  const positiveFolds = foldResults.filter(result => result.positive).length;
  return {
    folds: foldResults,
    totalFolds: foldResults.length,
    positiveFolds,
    stability: foldResults.length ? positiveFolds / foldResults.length * 100 : 0,
    oos: performanceStats(outOfSample),
    train: performanceStats(sorted.slice(0, minTrain).map(item => item.returnR))
  };
}

function candidateKey(strategy, weekday, bucket, side) {
  return `${strategy}|${weekday}|${bucket}|${side}`;
}

function finiteProfitFactor(stats) {
  return stats.profitFactor === null ? (stats.losses === 0 && stats.wins > 0 ? 4 : 0) : stats.profitFactor;
}

function buildBacktest(bars, rawSettings = {}) {
  const settings = {
    horizonBars: clamp(Math.floor(finite(rawSettings.horizonBars, 3)), 1, 24),
    minSamples: Math.max(30, Math.floor(finite(rawSettings.minSamples, 60))),
    minProbability: clamp(finite(rawSettings.minProbability, 55), 40, 90),
    costBps: clamp(finite(rawSettings.costBps, 2), 0, 50),
    slippageBps: clamp(finite(rawSettings.slippageBps, 0.5), 0, 25),
    walkForwardFolds: clamp(Math.floor(finite(rawSettings.walkForwardFolds, 5)), 3, 10),
    stopAtr: clamp(finite(rawSettings.stopAtr, 1.2), 0.5, 4),
    targetR: clamp(finite(rawSettings.targetR, 1.5), 0.75, 5),
    testFraction: clamp(finite(rawSettings.testFraction, 0.25), 0.2, 0.4)
  };

  const observations = buildObservations(bars, settings);
  const groups = new Map();
  for (const observation of observations) {
    const key = candidateKey(observation.strategy, observation.weekday, observation.bucket, observation.side);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(observation);
  }

  const testedBeforeFilter = groups.size;
  const multipleTestingPenalty = Number(Math.min(20, Math.log2(Math.max(2, testedBeforeFilter)) * 1.5).toFixed(2));
  const results = [];
  for (const [key, group] of groups) {
    if (group.length < settings.minSamples) continue;
    group.sort((a, b) => new Date(a.time) - new Date(b.time));
    const testCount = Math.max(12, Math.ceil(group.length * settings.testFraction));
    if (group.length - testCount < 25) continue;
    const train = group.slice(0, group.length - testCount);
    const test = group.slice(group.length - testCount);
    const trainStats = performanceStats(train.map(item => item.returnR));
    const testStats = performanceStats(test.map(item => item.returnR));
    if (trainStats.winRate < settings.minProbability || trainStats.expectancyR <= 0) continue;

    const walkForward = anchoredWalkForward(group, settings.walkForwardFolds, Math.max(25, Math.floor(group.length * 0.4)));
    const [strategy, weekday, bucket, side] = key.split("|");
    const testProfitFactor = finiteProfitFactor(testStats);
    const oosProfitFactor = finiteProfitFactor(walkForward.oos);
    const enoughAdverseCases = testStats.losses >= 2;
    const robustBase = enoughAdverseCases &&
      testStats.expectancyR > 0.03 &&
      testProfitFactor >= 1.2 &&
      testStats.lowerBound >= 42 &&
      testStats.maxDrawdownR <= 10 &&
      walkForward.totalFolds >= 3 &&
      walkForward.stability >= 60 &&
      walkForward.oos.expectancyR > 0 &&
      oosProfitFactor >= 1.1;

    const breakEvenWinRate = 100 / (1 + settings.targetR);
    const winComponent = clamp((testStats.winRate - breakEvenWinRate) / 25 * 100, 0, 100);
    const expectancyComponent = clamp(testStats.expectancyR / 0.35 * 100, 0, 100);
    const profitFactorComponent = clamp((testProfitFactor - 1) / 1.5 * 100, 0, 100);
    const stabilityComponent = clamp(walkForward.stability, 0, 100);
    const sampleComponent = clamp(testStats.trades / 50 * 100, 0, 100);
    const drawdownComponent = clamp(100 - testStats.maxDrawdownR / 10 * 100, 0, 100);
    const rawScore = 0.2 * winComponent + 0.25 * expectancyComponent + 0.2 * profitFactorComponent +
      0.15 * stabilityComponent + 0.1 * sampleComponent + 0.1 * drawdownComponent;
    const adjustedScore = Number(Math.max(0, rawScore - multipleTestingPenalty).toFixed(2));
    const robust = robustBase && adjustedScore >= 50;

    results.push({
      strategy,
      weekday: Number(weekday),
      timeBucket: bucket,
      side,
      samples: group.length,
      train: trainStats,
      test: testStats,
      walkForward,
      trainProbability: trainStats.winRate,
      robust,
      score: Number(rawScore.toFixed(2)),
      adjustedScore,
      costBps: settings.costBps,
      slippageBps: settings.slippageBps,
      stopAtr: settings.stopAtr,
      targetR: settings.targetR,
      audit: {
        lookAheadSafe: true,
        signalDataEndsAt: "bar close",
        executionAt: "next bar open",
        ambiguousIntrabar: "SL first",
        profitFactorCap: null
      }
    });
  }

  results.sort((a, b) => Number(b.robust) - Number(a.robust) || b.score - a.score || b.test.expectancyR - a.test.expectancyR);
  const robustResults = results.filter(result => result.robust);
  results.sort((a, b) => Number(b.robust) - Number(a.robust) || b.adjustedScore - a.adjustedScore || b.test.expectancyR - a.test.expectancyR);

  return {
    summary: {
      candidatesGenerated: testedBeforeFilter,
      patternsTested: results.length,
      robustPatterns: robustResults.length,
      best: results.find(result => result.robust) || results[0] || null,
      costBps: settings.costBps,
      slippageBps: settings.slippageBps,
      walkForwardFolds: settings.walkForwardFolds,
      stopAtr: settings.stopAtr,
      targetR: settings.targetR,
      multipleTestingPenalty,
      integrity: {
        lookAheadBiasRemoved: true,
        entry: "următoarea lumânare, la open",
        intrabarPolicy: "SL are prioritate când SL și TP sunt atinse în aceeași lumânare",
        profitFactor: "necenzurat; fără pierderi este afișat ca infinit, nu 99",
        validation: "ultimul segment nevăzut + walk-forward ancorat"
      },
      warning: "Backtestul este conservator și elimină direcția aleasă cu informație din viitor. Rezultatele istorice nu garantează performanță viitoare."
    },
    results: results.slice(0, 500)
  };
}

function aggregateBars(inputBars, sourceTimeframe, targetTimeframe, options = {}) {
  const sourceMinutes = timeframeMinutes(sourceTimeframe);
  const targetMinutes = timeframeMinutes(targetTimeframe);
  if (!sourceMinutes || !targetMinutes || targetMinutes <= sourceMinutes || targetMinutes % sourceMinutes !== 0) {
    throw new Error("Timeframe-ul țintă trebuie să fie un multiplu mai mare al timeframe-ului sursă");
  }
  const expectedBars = targetMinutes / sourceMinutes;
  const requireComplete = options.requireComplete !== false;
  const { bars } = auditBars(inputBars, sourceTimeframe);
  const groups = new Map();
  const targetMs = targetMinutes * 60000;

  for (const bar of bars) {
    const timestamp = new Date(bar.bar_time).getTime();
    const bucketTimestamp = Math.floor(timestamp / targetMs) * targetMs;
    if (!groups.has(bucketTimestamp)) groups.set(bucketTimestamp, []);
    groups.get(bucketTimestamp).push(bar);
  }

  const aggregated = [];
  for (const [bucketTimestamp, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    group.sort((a, b) => new Date(a.bar_time) - new Date(b.bar_time));
    if (requireComplete && group.length !== expectedBars) continue;
    const symbol = String(group[0].symbol || "US30").toUpperCase();
    aggregated.push({
      external_id: `AGG-${symbol}-${targetMinutes}-${bucketTimestamp}`,
      bar_time: new Date(bucketTimestamp).toISOString(),
      symbol,
      timeframe: String(targetMinutes),
      open: finite(group[0].open),
      high: Math.max(...group.map(bar => finite(bar.high))),
      low: Math.min(...group.map(bar => finite(bar.low))),
      close: finite(group[group.length - 1].close),
      volume: group.reduce((sum, bar) => sum + finite(bar.volume), 0),
      source_bars: group.length
    });
  }
  return aggregated;
}

module.exports = {
  timeframeMinutes,
  bucketFor,
  wilsonLower,
  performanceStats,
  auditBars,
  buildObservations,
  anchoredWalkForward,
  buildBacktest,
  aggregateBars,
  simulateTrade
};
