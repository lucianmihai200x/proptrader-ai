"use strict";

const DEFAULTS = Object.freeze({
  swingSpan: 2,
  scanBars: 96,
  maxSetupAgeBars: 48,
  orderBlockSearchBars: 8,
  displacementBodyAtr: 0.9,
  displacementRangeAtr: 1.15,
  maxMitigations: 1,
  maxEntryDistanceAtr: 8,
  minScore: 68,
  requireFvgOrSweep: true,
  expiryBars: Object.freeze({ "5": 72, "15": 48, "30": 36, "60": 30, "240": 18 })
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function normalizeBars(input) {
  return (Array.isArray(input) ? input : [])
    .map(item => {
      const time = new Date(item.bar_time || item.time || item.timestamp);
      return {
        ...item,
        bar_time: Number.isNaN(time.getTime()) ? "" : time.toISOString(),
        open: number(item.open, NaN),
        high: number(item.high, NaN),
        low: number(item.low, NaN),
        close: number(item.close, NaN),
        volume: number(item.volume)
      };
    })
    .filter(item =>
      item.bar_time &&
      [item.open, item.high, item.low, item.close].every(Number.isFinite) &&
      item.high >= Math.max(item.open, item.close) &&
      item.low <= Math.min(item.open, item.close)
    )
    .sort((a, b) => new Date(a.bar_time) - new Date(b.bar_time));
}

function ema(values, length) {
  if (!values.length) return 0;
  const alpha = 2 / (Math.max(1, length) + 1);
  let current = number(values[0]);
  for (let index = 1; index < values.length; index += 1) {
    current = number(values[index]) * alpha + current * (1 - alpha);
  }
  return current;
}

function atr(bars, length = 14, endIndex = bars.length - 1) {
  const start = Math.max(1, endIndex - length + 1);
  const ranges = [];
  for (let index = start; index <= endIndex; index += 1) {
    const current = bars[index];
    const previous = bars[index - 1];
    if (!current || !previous) continue;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }
  return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0;
}

function findSwings(input, span = DEFAULTS.swingSpan) {
  const bars = normalizeBars(input);
  const highs = [];
  const lows = [];
  for (let index = span; index < bars.length - span; index += 1) {
    const neighborhood = bars.slice(index - span, index + span + 1);
    const high = bars[index].high;
    const low = bars[index].low;
    if (neighborhood.every(item => high >= item.high) && neighborhood.some(item => high > item.high)) {
      highs.push({ type: "HIGH", index, price: high, time: bars[index].bar_time, confirmedAt: index + span });
    }
    if (neighborhood.every(item => low <= item.low) && neighborhood.some(item => low < item.low)) {
      lows.push({ type: "LOW", index, price: low, time: bars[index].bar_time, confirmedAt: index + span });
    }
  }
  return { highs, lows };
}

function structureBias(input, span = DEFAULTS.swingSpan) {
  const bars = normalizeBars(input);
  if (bars.length < 12) return { bias: "NEUTRAL", confidence: 0, reason: "date insuficiente", swings: { highs: [], lows: [] } };
  const swings = findSwings(bars, span);
  const highs = swings.highs.slice(-2);
  const lows = swings.lows.slice(-2);
  if (highs.length === 2 && lows.length === 2) {
    if (highs[1].price > highs[0].price && lows[1].price > lows[0].price) {
      return { bias: "BULLISH", confidence: 90, reason: "HH + HL", swings };
    }
    if (highs[1].price < highs[0].price && lows[1].price < lows[0].price) {
      return { bias: "BEARISH", confidence: 90, reason: "LH + LL", swings };
    }
  }
  const closes = bars.slice(-60).map(item => item.close);
  const fast = ema(closes.slice(-40), 20);
  const slow = closes.length >= 50 ? ema(closes, 50) : ema(closes, 20);
  const close = closes[closes.length - 1];
  if (close > fast && fast > slow) return { bias: "BULLISH", confidence: 65, reason: "close > EMA20 > EMA50", swings };
  if (close < fast && fast < slow) return { bias: "BEARISH", confidence: 65, reason: "close < EMA20 < EMA50", swings };
  return { bias: "NEUTRAL", confidence: 35, reason: "structură mixtă", swings };
}

function sideBias(side) {
  return side === "BUY" ? "BULLISH" : "BEARISH";
}

function latestPriorSwing(swings, type, index) {
  const list = type === "HIGH" ? swings.highs : swings.lows;
  return [...list].reverse().find(item => item.confirmedAt < index) || null;
}

function findBreakEvents(input, config = {}) {
  const options = { ...DEFAULTS, ...config };
  const bars = normalizeBars(input);
  const swings = findSwings(bars, options.swingSpan);
  const events = [];
  const start = Math.max(15, bars.length - options.scanBars);
  for (let index = start; index < bars.length; index += 1) {
    const current = bars[index];
    const previous = bars[index - 1];
    const currentAtr = atr(bars, 14, index);
    if (!currentAtr) continue;
    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;
    const displaced = body >= currentAtr * options.displacementBodyAtr && range >= currentAtr * options.displacementRangeAtr;
    if (!displaced) continue;
    const priorHigh = latestPriorSwing(swings, "HIGH", index);
    const priorLow = latestPriorSwing(swings, "LOW", index);
    let side = null;
    let brokenSwing = null;
    if (priorHigh && previous.close <= priorHigh.price && current.close > priorHigh.price) {
      side = "BUY";
      brokenSwing = priorHigh;
    } else if (priorLow && previous.close >= priorLow.price && current.close < priorLow.price) {
      side = "SELL";
      brokenSwing = priorLow;
    }
    if (!side) continue;
    const preStructure = structureBias(bars.slice(0, index), options.swingSpan);
    const eventType = preStructure.bias === "NEUTRAL" || preStructure.bias === sideBias(side) ? "BOS" : "CHOCH";
    events.push({
      index,
      side,
      type: eventType,
      bar: current,
      brokenSwing,
      atr: currentAtr,
      bodyAtr: body / currentAtr,
      rangeAtr: range / currentAtr
    });
  }
  return { bars, swings, events };
}

function findOrderBlock(bars, event, searchBars = DEFAULTS.orderBlockSearchBars) {
  const bullish = event.side === "BUY";
  for (let index = event.index - 1; index >= Math.max(0, event.index - searchBars); index -= 1) {
    const bar = bars[index];
    const opposite = bullish ? bar.close < bar.open : bar.close > bar.open;
    if (!opposite) continue;
    return {
      index,
      time: bar.bar_time,
      low: bar.low,
      high: bar.high,
      bodyLow: Math.min(bar.open, bar.close),
      bodyHigh: Math.max(bar.open, bar.close),
      entry: (bar.open + bar.close) / 2
    };
  }
  return null;
}

function findFvg(bars, side, eventIndex) {
  for (let middle = Math.max(1, eventIndex - 1); middle <= Math.min(bars.length - 2, eventIndex + 2); middle += 1) {
    const first = bars[middle - 1];
    const third = bars[middle + 1];
    if (side === "BUY" && third.low > first.high) {
      return { found: true, low: first.high, high: third.low, middleTime: bars[middle].bar_time };
    }
    if (side === "SELL" && third.high < first.low) {
      return { found: true, low: third.high, high: first.low, middleTime: bars[middle].bar_time };
    }
  }
  return { found: false, low: null, high: null, middleTime: null };
}

function findLiquiditySweep(bars, side, event, swings, lookback = 8) {
  for (let index = event.index - 1; index >= Math.max(2, event.index - lookback); index -= 1) {
    const bar = bars[index];
    if (side === "BUY") {
      const prior = latestPriorSwing(swings, "LOW", index);
      if (prior && bar.low < prior.price && bar.close > prior.price) {
        return { found: true, time: bar.bar_time, level: prior.price, sweptPrice: bar.low };
      }
    } else {
      const prior = latestPriorSwing(swings, "HIGH", index);
      if (prior && bar.high > prior.price && bar.close < prior.price) {
        return { found: true, time: bar.bar_time, level: prior.price, sweptPrice: bar.high };
      }
    }
  }
  return { found: false, time: null, level: null, sweptPrice: null };
}

function mitigationState(bars, eventIndex, orderBlock, side, buffer) {
  let mitigations = 0;
  let touching = false;
  for (let index = eventIndex + 2; index < bars.length; index += 1) {
    const bar = bars[index];
    const intersects = bar.high >= orderBlock.low && bar.low <= orderBlock.high;
    if (intersects && !touching) mitigations += 1;
    touching = intersects;
    if (side === "BUY" && bar.close < orderBlock.low - buffer) return { invalidated: true, mitigations };
    if (side === "SELL" && bar.close > orderBlock.high + buffer) return { invalidated: true, mitigations };
  }
  return { invalidated: false, mitigations };
}

function premiumDiscount(bars, eventIndex, entry, side) {
  const range = bars.slice(Math.max(0, eventIndex - 60), eventIndex + 1);
  const high = Math.max(...range.map(item => item.high));
  const low = Math.min(...range.map(item => item.low));
  const equilibrium = (high + low) / 2;
  const zone = entry >= equilibrium ? "PREMIUM" : "DISCOUNT";
  return { zone, aligned: side === "SELL" ? zone === "PREMIUM" : zone === "DISCOUNT", high, low, equilibrium };
}

function targetLevels(side, entry, risk, swings) {
  const multipliers = [1.5, 2.5, 4];
  const pools = side === "BUY"
    ? swings.highs.map(item => item.price).filter(price => price > entry).sort((a, b) => a - b)
    : swings.lows.map(item => item.price).filter(price => price < entry).sort((a, b) => b - a);
  let previous = entry;
  return multipliers.map((multiple, targetIndex) => {
    const threshold = side === "BUY" ? entry + risk * multiple : entry - risk * multiple;
    const pool = pools.find(price => {
      const beyondThreshold = side === "BUY" ? price >= threshold : price <= threshold;
      const beyondPrevious = side === "BUY" ? price > previous + risk * 0.35 : price < previous - risk * 0.35;
      const notExcessive = Math.abs(price - entry) <= risk * (multiple + 1.25 + targetIndex * 0.5);
      return beyondThreshold && beyondPrevious && notExcessive;
    });
    const target = pool || threshold;
    previous = target;
    return round(target);
  });
}

function biasScore(side, d1, h4, local) {
  const desired = sideBias(side);
  const breakdown = { d1: 0, h4: 0, local: 0 };
  breakdown.d1 = d1 === desired ? 16 : d1 === "NEUTRAL" ? 2 : -14;
  breakdown.h4 = h4 === desired ? 13 : h4 === "NEUTRAL" ? 2 : -11;
  breakdown.local = local === desired ? 7 : local === "NEUTRAL" ? 1 : -5;
  return { score: breakdown.d1 + breakdown.h4 + breakdown.local, breakdown };
}

function setupReason(setup) {
  const confirmations = [
    setup.structure_event,
    "order block",
    setup.fvg ? "FVG" : "",
    setup.liquidity_sweep ? "sweep de lichiditate" : "",
    setup.premium_discount === "PREMIUM" ? "premium" : "discount",
    setup.mitigations === 0 ? "zonă fresh" : `mitigări ${setup.mitigations}`
  ].filter(Boolean).join(" + ");
  return `Plan SMC ${setup.side} ${setup.timeframe_label}: bias D1 ${setup.d1_bias}, H4 ${setup.h4_bias}; ${confirmations}. Așteaptă revenirea în zona ${round(setup.zone_low)}–${round(setup.zone_high)} și confirmarea M5; nu este intrare la prețul curent.`;
}

function findSmcSetups({
  symbol,
  timeframe,
  bars: inputBars,
  d1Bars = [],
  h4Bars = [],
  now = new Date(),
  config = {}
}) {
  const options = {
    ...DEFAULTS,
    ...config,
    expiryBars: { ...DEFAULTS.expiryBars, ...(config.expiryBars || {}) }
  };
  const { bars, swings, events } = findBreakEvents(inputBars, options);
  if (bars.length < 35 || !events.length) return [];
  const localStructure = structureBias(bars, options.swingSpan);
  const d1Structure = structureBias(d1Bars, options.swingSpan);
  const h4Structure = structureBias(h4Bars, options.swingSpan);
  const current = bars[bars.length - 1];
  const currentAtr = atr(bars, 14);
  if (!currentAtr) return [];
  const results = [];
  for (const event of events.slice(-12).reverse()) {
    if (event.index < bars.length - options.maxSetupAgeBars) continue;
    const orderBlock = findOrderBlock(bars, event, options.orderBlockSearchBars);
    if (!orderBlock) continue;
    const fvg = findFvg(bars, event.side, event.index);
    const sweep = findLiquiditySweep(bars, event.side, event, swings);
    if (options.requireFvgOrSweep && !fvg.found && !sweep.found) continue;
    const mitigation = mitigationState(bars, event.index, orderBlock, event.side, event.atr * 0.12);
    if (mitigation.invalidated || mitigation.mitigations > options.maxMitigations) continue;
    const pd = premiumDiscount(bars, event.index, orderBlock.entry, event.side);
    const distanceAtr = Math.abs(orderBlock.entry - current.close) / currentAtr;
    if (distanceAtr > options.maxEntryDistanceAtr) continue;
    const desired = sideBias(event.side);
    const d1Bias = d1Structure.bias;
    const h4Bias = h4Structure.bias;
    const localBias = localStructure.bias;
    if (d1Bias !== "NEUTRAL" && h4Bias !== "NEUTRAL" && d1Bias !== desired && h4Bias !== desired) continue;
    const stopBuffer = Math.max(event.atr * 0.18, Math.abs(orderBlock.high - orderBlock.low) * 0.08);
    const sl = event.side === "BUY" ? orderBlock.low - stopBuffer : orderBlock.high + stopBuffer;
    const risk = Math.abs(orderBlock.entry - sl);
    if (!risk || risk > current.close * 0.05) continue;
    const [tp1, tp2, tp3] = targetLevels(event.side, orderBlock.entry, risk, swings);
    const bias = biasScore(event.side, d1Bias, h4Bias, localBias);
    const volumeWindow = bars.slice(Math.max(0, event.index - 20), event.index);
    const averageVolume = volumeWindow.reduce((sum, item) => sum + item.volume, 0) / Math.max(1, volumeWindow.length);
    const volumeConfirmed = averageVolume > 0 && event.bar.volume >= averageVolume * 1.15;
    const scoreBreakdown = {
      base: 36,
      ...bias.breakdown,
      displacement: Math.min(12, 7 + event.bodyAtr * 2.5),
      fvg: fvg.found ? 8 : 0,
      liquiditySweep: sweep.found ? 9 : 0,
      premiumDiscount: pd.aligned ? 7 : -5,
      freshness: mitigation.mitigations === 0 ? 7 : 2,
      volume: volumeConfirmed ? 3 : 0,
      distance: -Math.min(8, distanceAtr * 1.25)
    };
    const score = Math.max(0, Math.min(95, Object.values(scoreBreakdown).reduce((sum, value) => sum + number(value), 0)));
    if (score < options.minScore) continue;
    const timeframeMinutes = Math.max(5, number(timeframe, 5));
    const expiresAt = new Date(new Date(now).getTime() + timeframeMinutes * 60000 * (options.expiryBars[String(timeframe)] || 24));
    const setup = {
      external_id: `SMC-${symbol}-${timeframe}-${event.side}-${new Date(orderBlock.time).getTime()}`,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      expires_at: expiresAt.toISOString(),
      symbol: String(symbol || "").toUpperCase(),
      timeframe: String(timeframe),
      timeframe_label: String(timeframe) === "240" ? "H4" : String(timeframe) === "60" ? "H1" : `M${timeframe}`,
      side: event.side,
      status: "PENDING",
      entry: round(orderBlock.entry),
      zone_low: round(orderBlock.low),
      zone_high: round(orderBlock.high),
      sl: round(sl),
      tp1,
      tp2,
      tp3,
      risk: round(risk),
      rr: 4,
      score: round(score, 2),
      adaptive_score: round(score, 2),
      historical_probability: null,
      learning_samples: 0,
      current_price: round(current.close),
      distance_atr: round(distanceAtr, 2),
      d1_bias: d1Bias,
      h4_bias: h4Bias,
      local_bias: localBias,
      structure_event: event.type,
      broken_level: round(event.brokenSwing.price),
      order_block_time: orderBlock.time,
      displacement: true,
      fvg: fvg.found,
      fvg_low: fvg.found ? round(fvg.low) : null,
      fvg_high: fvg.found ? round(fvg.high) : null,
      liquidity_sweep: sweep.found,
      sweep_level: sweep.found ? round(sweep.level) : null,
      premium_discount: pd.zone,
      mitigations: mitigation.mitigations,
      touch_count: 0,
      volume_confirmed: volumeConfirmed,
      model_key: `SMC|${String(symbol || "").toUpperCase()}|${event.side}|${timeframe}|${event.type}|${fvg.found ? "FVG" : "NO_FVG"}|${sweep.found ? "SWEEP" : "NO_SWEEP"}|D1_${d1Bias}|H4_${h4Bias}`,
      score_breakdown: Object.fromEntries(Object.entries(scoreBreakdown).map(([key, value]) => [key, round(value, 2)])),
      features: {
        eventIndex: event.index,
        eventTime: event.bar.bar_time,
        bodyAtr: round(event.bodyAtr, 2),
        rangeAtr: round(event.rangeAtr, 2),
        equilibrium: round(pd.equilibrium),
        orderBlockBodyLow: round(orderBlock.bodyLow),
        orderBlockBodyHigh: round(orderBlock.bodyHigh)
      }
    };
    setup.reason = setupReason(setup);
    results.push(setup);
  }
  const unique = [...new Map(results.map(item => [item.external_id, item])).values()];
  return unique.sort((a, b) => b.score - a.score || new Date(b.order_block_time) - new Date(a.order_block_time)).slice(0, 3);
}

function evaluatePendingSetup(setup, inputBar, { requireConfirmation = true, maxTouches = 3 } = {}) {
  const bar = normalizeBars([inputBar])[0];
  if (!bar) return { action: "KEEP", reason: "lumânare invalidă" };
  if (setup.status !== "PENDING") return { action: "KEEP", reason: "setup inactiv" };
  if (setup.expires_at && new Date(bar.bar_time) > new Date(setup.expires_at)) {
    return { action: "EXPIRE", reason: "fereastra setup-ului a expirat" };
  }
  const side = String(setup.side).toUpperCase();
  const entry = number(setup.entry);
  const sl = number(setup.sl);
  const touched = bar.low <= entry && bar.high >= entry;
  const invalidated = side === "BUY" ? bar.low <= sl : bar.high >= sl;
  if (invalidated) {
    return { action: "CANCEL", reason: touched ? "intrarea și SL au fost traversate în aceeași lumânare; ordine intrabar necunoscută" : "order block invalidat înainte de confirmare" };
  }
  if (!touched) return { action: "KEEP", reason: "prețul nu a atins încă intrarea" };
  const touchCount = number(setup.touch_count) + 1;
  const confirmed = side === "BUY"
    ? bar.close >= entry && bar.close > bar.open
    : bar.close <= entry && bar.close < bar.open;
  if (!requireConfirmation || confirmed) {
    return { action: "TRIGGER", reason: `atingere order block + confirmare M5 ${side}`, touchCount };
  }
  if (touchCount >= maxTouches) return { action: "CANCEL", reason: "zona a fost testată repetat fără confirmare", touchCount };
  return { action: "TOUCH", reason: "order block atins; se așteaptă lumânare de confirmare", touchCount };
}

module.exports = {
  DEFAULTS,
  normalizeBars,
  ema,
  atr,
  findSwings,
  structureBias,
  findBreakEvents,
  findSmcSetups,
  evaluatePendingSetup,
  targetLevels
};
