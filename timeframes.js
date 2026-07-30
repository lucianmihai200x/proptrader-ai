"use strict";

const SUPPORTED_ANALYSIS_TIMEFRAMES = Object.freeze(["5", "15", "30", "60", "240"]);

const TIMEFRAME_PROFILES = Object.freeze({
  "5": Object.freeze({
    label: "M5",
    horizonBars: 6,
    cooldownMinutes: 30,
    minSamples: 80,
    minProbability: 78,
    minScore: 88,
    stopAtr: 1.15
  }),
  "15": Object.freeze({
    label: "M15",
    horizonBars: 4,
    cooldownMinutes: 60,
    minSamples: 60,
    minProbability: 76,
    minScore: 86,
    stopAtr: 1.2
  }),
  "30": Object.freeze({
    label: "M30",
    horizonBars: 3,
    cooldownMinutes: 90,
    minSamples: 50,
    minProbability: 75,
    minScore: 85,
    stopAtr: 1.25
  }),
  "60": Object.freeze({
    label: "H1",
    horizonBars: 3,
    cooldownMinutes: 180,
    minSamples: 50,
    minProbability: 75,
    minScore: 85,
    stopAtr: 1.35
  }),
  "240": Object.freeze({
    label: "H4",
    horizonBars: 2,
    cooldownMinutes: 480,
    minSamples: 50,
    minProbability: 75,
    minScore: 85,
    stopAtr: 1.5
  })
});

function normalizeTimeframe(value, fallback = "") {
  const raw = String(value ?? "").trim().toUpperCase();
  const aliases = {
    M5: "5",
    M15: "15",
    M30: "30",
    H1: "60",
    "1H": "60",
    H4: "240",
    "4H": "240"
  };
  const normalized = aliases[raw] || raw.replace(/[^0-9]/g, "");
  return normalized || fallback;
}

function parseAnalysisTimeframes(value) {
  const requested = String(value || SUPPORTED_ANALYSIS_TIMEFRAMES.join(","))
    .split(/[,\s;|]+/)
    .map(item => normalizeTimeframe(item))
    .filter(item => SUPPORTED_ANALYSIS_TIMEFRAMES.includes(item));
  const unique = [...new Set(requested)];
  return unique.length ? SUPPORTED_ANALYSIS_TIMEFRAMES.filter(item => unique.includes(item)) : [...SUPPORTED_ANALYSIS_TIMEFRAMES];
}

function timeframeLabel(value) {
  const normalized = normalizeTimeframe(value);
  return TIMEFRAME_PROFILES[normalized]?.label || (normalized ? `M${normalized}` : "N/A");
}

function profileFor(value, overrides = {}) {
  const normalized = normalizeTimeframe(value);
  const base = TIMEFRAME_PROFILES[normalized] || TIMEFRAME_PROFILES["15"];
  const horizonOverride = overrides.horizonBars === null || overrides.horizonBars === undefined
    ? NaN
    : Number(overrides.horizonBars);
  const cooldownOverride = overrides.cooldownMinutes === null || overrides.cooldownMinutes === undefined
    ? NaN
    : Number(overrides.cooldownMinutes);
  return {
    ...base,
    timeframe: normalized || "15",
    horizonBars: Number.isFinite(horizonOverride) ? Math.max(1, Math.min(24, horizonOverride)) : base.horizonBars,
    cooldownMinutes: Number.isFinite(cooldownOverride) ? Math.max(5, cooldownOverride) : base.cooldownMinutes,
    minSamples: Math.max(base.minSamples, Number(overrides.minSamples) || 0),
    minProbability: Math.max(base.minProbability, Number(overrides.minProbability) || 0),
    minScore: Math.max(base.minScore, Number(overrides.minScore) || 0)
  };
}

function completedHigherTimeframes(barTime, sourceTimeframe = "5", targets = SUPPORTED_ANALYSIS_TIMEFRAMES) {
  const sourceMinutes = Number(normalizeTimeframe(sourceTimeframe));
  const start = new Date(barTime).getTime();
  if (!Number.isFinite(sourceMinutes) || sourceMinutes <= 0 || !Number.isFinite(start)) return [];
  const end = start + sourceMinutes * 60000;
  return targets
    .map(item => normalizeTimeframe(item))
    .filter(item => {
      const minutes = Number(item);
      return minutes > sourceMinutes && minutes % sourceMinutes === 0 && end % (minutes * 60000) === 0;
    });
}

module.exports = {
  SUPPORTED_ANALYSIS_TIMEFRAMES,
  TIMEFRAME_PROFILES,
  normalizeTimeframe,
  parseAnalysisTimeframes,
  timeframeLabel,
  profileFor,
  completedHigherTimeframes
};
