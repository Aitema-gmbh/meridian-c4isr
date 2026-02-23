/**
 * Superforecasting Aggregation Module
 *
 * Implements Geometric Mean of Odds with Neyman-Roughgarden extremizing,
 * Bayesian signal weighting, and calibration tracking.
 * Based on Tetlock's Good Judgment Project and Satopaa et al. (2014).
 */

// ---- Math primitives ----

/** Convert probability (0-1) to log-odds */
export function logit(p: number): number {
  const clamped = Math.max(0.001, Math.min(0.999, p));
  return Math.log(clamped / (1 - clamped));
}

/** Convert log-odds back to probability (0-1) */
export function sigmoid(x: number): number {
  if (x > 20) return 0.999;
  if (x < -20) return 0.001;
  return 1 / (1 + Math.exp(-x));
}

/**
 * Neyman-Roughgarden extremizing factor for n forecasters.
 * Converges to ~1.73 for large n.
 * For n=14 (our agent count): ~1.66
 */
export function computeExtremizingFactor(n: number): number {
  if (n <= 1) return 1;
  if (n === 2) return 1.29;
  const numerator = n * (Math.sqrt(3 * n * n - 3 * n + 1) - 2);
  const denominator = n * n - n - 1;
  return Math.max(1, numerator / denominator);
}

// ---- Signal weight categories (Bayesian priors) ----

// Hard signals: directly observable, high information content
const HARD_SIGNAL_AGENTS = new Set(["flights", "ais", "cyber", "pentagon"]);
// Medium signals: structured data, moderate noise
const MEDIUM_SIGNAL_AGENTS = new Set(["osint", "macro", "acled", "naval", "markets"]);
// Soft signals: high noise, indirect indicators
const SOFT_SIGNAL_AGENTS = new Set(["wiki", "reddit", "pizza", "telegram", "fires"]);

function getBaseWeight(agentName: string): number {
  if (HARD_SIGNAL_AGENTS.has(agentName)) return 3.0;
  if (MEDIUM_SIGNAL_AGENTS.has(agentName)) return 2.0;
  if (SOFT_SIGNAL_AGENTS.has(agentName)) return 1.0;
  return 1.5; // unknown agents
}

/** Recency decay: half-life of 60 minutes */
function recencyWeight(minutesAgo: number): number {
  return Math.exp(-0.693 * minutesAgo / 60);
}

// ---- Main aggregation ----

export interface AgentSignal {
  agentName: string;
  threatLevel: number;  // 0-100
  itemsCount: number;
  minutesAgo: number;   // how old the data is
}

export interface AggregationResult {
  /** Aggregated probability (0-1) */
  probability: number;
  /** Aggregated threat level (0-100) */
  threatLevel: number;
  /** Confidence in the aggregate (0-1) */
  confidence: number;
  /** Number of agents included */
  agentCount: number;
  /** Extremizing factor used */
  extremizingFactor: number;
  /** Per-agent weights (for transparency) */
  weights: Record<string, number>;
  /** Convergence: how many agents agree on direction */
  convergenceScore: number;
}

/**
 * Aggregate multiple agent threat levels using Geometric Mean of Odds
 * with Neyman-Roughgarden extremizing.
 *
 * This is the core superforecasting algorithm from Tetlock/GJP.
 *
 * @param signals - Array of agent signals with threat levels
 * @param baseProbability - Prior base rate (default 0.15 for crisis events)
 */
export function aggregateSignals(
  signals: AgentSignal[],
  baseProbability: number = 0.15
): AggregationResult {
  if (signals.length === 0) {
    return {
      probability: baseProbability,
      threatLevel: Math.round(baseProbability * 100),
      confidence: 0,
      agentCount: 0,
      extremizingFactor: 1,
      weights: {},
      convergenceScore: 0,
    };
  }

  // Step 1: Compute weights for each agent
  const weightMap: Record<string, number> = {};
  let totalWeight = 0;

  for (const s of signals) {
    const base = getBaseWeight(s.agentName);
    const recency = recencyWeight(s.minutesAgo);
    // Data richness bonus: agents with more items get slight boost
    const dataBonus = Math.min(1.5, 1 + Math.log10(Math.max(1, s.itemsCount)) * 0.2);
    const w = base * recency * dataBonus;
    weightMap[s.agentName] = w;
    totalWeight += w;
  }

  // Normalize weights
  for (const key of Object.keys(weightMap)) {
    weightMap[key] /= totalWeight;
  }

  // Step 2: Convert threat levels to probabilities (0-1)
  // Using a sigmoid curve centered at 50 with steepness
  const probabilities = signals.map(s => {
    // Map 0-100 threat level to 0-1 probability
    // Low threat (0-20) → very low probability
    // Medium (30-60) → moderate
    // High (70-100) → high probability
    return Math.max(0.01, Math.min(0.99, s.threatLevel / 100));
  });

  // Step 3: Weighted mean in log-odds space (Geometric Mean of Odds)
  let weightedLogOdds = 0;
  for (let i = 0; i < signals.length; i++) {
    weightedLogOdds += weightMap[signals[i].agentName] * logit(probabilities[i]);
  }

  // Step 4: Extremize relative to base rate
  const n = signals.length;
  const d = computeExtremizingFactor(n);
  const logitBase = logit(baseProbability);
  const logitFinal = d * weightedLogOdds + (1 - d) * logitBase;

  // Step 5: Convert back to probability
  const finalProbability = sigmoid(logitFinal);

  // Step 6: Compute confidence (inverse of variance in log-odds)
  const logits = probabilities.map(p => logit(p));
  const variance = logits.reduce(
    (sum, l) => sum + Math.pow(l - weightedLogOdds, 2),
    0
  ) / n;
  const confidence = 1 / (1 + Math.sqrt(variance));

  // Step 7: Convergence score (how many agents above/below median)
  const median = [...probabilities].sort((a, b) => a - b)[Math.floor(n / 2)];
  const above = probabilities.filter(p => p > median + 0.1).length;
  const below = probabilities.filter(p => p < median - 0.1).length;
  const convergenceScore = 1 - Math.abs(above - below) / n;

  return {
    probability: finalProbability,
    threatLevel: Math.round(finalProbability * 100),
    confidence: Math.round(confidence * 100) / 100,
    agentCount: n,
    extremizingFactor: Math.round(d * 100) / 100,
    weights: Object.fromEntries(
      Object.entries(weightMap).map(([k, v]) => [k, Math.round(v * 1000) / 1000])
    ),
    convergenceScore: Math.round(convergenceScore * 100) / 100,
  };
}

/**
 * Aggregate signals for a specific metric (like "hormuzClosure").
 * Uses domain-specific agent relevance weights.
 */
export function aggregateMetricSignals(
  metric: string,
  signals: AgentSignal[],
  baseProbability: number
): AggregationResult {
  // Domain-specific relevance: some agents are more relevant for certain metrics
  const METRIC_RELEVANCE: Record<string, Record<string, number>> = {
    hormuzClosure: { ais: 2.0, naval: 2.0, flights: 1.5, osint: 1.5, markets: 1.3, macro: 1.3 },
    cyberAttack: { cyber: 3.0, pentagon: 1.5, osint: 1.5, telegram: 1.2 },
    proxyEscalation: { acled: 2.0, osint: 1.5, telegram: 1.5, reddit: 1.2, naval: 1.2 },
    directConfrontation: { flights: 2.0, pentagon: 2.0, naval: 1.5, osint: 1.5, markets: 1.3 },
  };

  const relevance = METRIC_RELEVANCE[metric] || {};

  // Apply metric-specific relevance multipliers to signals
  const adjustedSignals = signals.map(s => ({
    ...s,
    // Boost threat level for relevant agents, reduce for irrelevant ones
    threatLevel: Math.round(s.threatLevel * (relevance[s.agentName] || 0.8)),
  }));

  return aggregateSignals(adjustedSignals, baseProbability);
}

/**
 * Compute Brier score for a single prediction.
 * Lower is better (0 = perfect, 1 = worst).
 */
export function brierScore(predicted: number, actual: 0 | 1): number {
  return Math.pow(predicted - actual, 2);
}

/**
 * Compare our estimates against market prices.
 * Returns Kelly edge and recommended direction.
 */
export function computeKellyEdge(
  ourProbability: number,
  marketPrice: number
): { edge: number; direction: "YES" | "NO" | "HOLD"; kellyFraction: number } {
  const edge = ourProbability - marketPrice;
  const THRESHOLD = 0.05; // minimum 5% edge to signal

  if (edge > THRESHOLD) {
    return {
      edge,
      direction: "YES",
      kellyFraction: 0.25 * (ourProbability - marketPrice) / (1 - marketPrice),
    };
  } else if (edge < -THRESHOLD) {
    return {
      edge,
      direction: "NO",
      kellyFraction: 0.25 * (marketPrice - ourProbability) / marketPrice,
    };
  }

  return { edge, direction: "HOLD", kellyFraction: 0 };
}

// ---- CUSUM Change-Point Detection ----

export interface CUSUMResult {
  /** Upper cumulative sum (upward shift pressure) */
  upperSum: number;
  /** Lower cumulative sum (downward shift pressure) */
  lowerSum: number;
  /** Whether a regime shift was detected */
  shiftDetected: boolean;
  /** Direction of last detected shift */
  shiftDirection: "escalation" | "de-escalation" | null;
  /** Index in the series where the last shift was detected */
  shiftIndex: number | null;
  /** Current regime classification */
  regime: "baseline" | "elevated" | "crisis";
  /** Reference mean from baseline period */
  referenceMean: number;
  /** Reference standard deviation */
  referenceStd: number;
}

/**
 * CUSUM (Cumulative Sum) change-point detection.
 * Detects regime shifts in a time series of geopolitical tension values.
 *
 * Based on Page (1954). Tracks cumulative deviations from a reference mean;
 * when the cumulative sum exceeds a threshold, a regime shift is flagged.
 *
 * @param values - Time series (oldest first)
 * @param options - Tuning parameters
 */
export function detectCUSUM(
  values: number[],
  options: {
    /** Slack parameter as fraction of stddev. Default: 0.5 */
    slackFactor?: number;
    /** Decision threshold as multiple of stddev. Default: 4 */
    thresholdFactor?: number;
    /** Number of initial values for reference statistics. Default: min(20, len/3) */
    referencePeriod?: number;
  } = {}
): CUSUMResult {
  if (values.length < 5) {
    return {
      upperSum: 0, lowerSum: 0,
      shiftDetected: false, shiftDirection: null, shiftIndex: null,
      regime: "baseline", referenceMean: 0, referenceStd: 0,
    };
  }

  const slackFactor = options.slackFactor ?? 0.5;
  const thresholdFactor = options.thresholdFactor ?? 4;
  const refN = options.referencePeriod ?? Math.min(20, Math.floor(values.length / 3));

  // Reference statistics from baseline period
  const refValues = values.slice(0, Math.max(refN, 3));
  const mean = refValues.reduce((a, b) => a + b, 0) / refValues.length;
  const variance = refValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / refValues.length;
  const std = Math.max(Math.sqrt(variance), 1); // floor at 1

  const k = slackFactor * std; // allowance (slack)
  const h = thresholdFactor * std; // decision interval

  let Sh = 0; // tracks upward shifts
  let Sl = 0; // tracks downward shifts
  let lastShiftIndex: number | null = null;
  let lastShiftDirection: "escalation" | "de-escalation" | null = null;

  for (let i = 0; i < values.length; i++) {
    Sh = Math.max(0, Sh + (values[i] - mean - k));
    Sl = Math.max(0, Sl - (values[i] - mean + k));

    if (Sh > h) {
      lastShiftIndex = i;
      lastShiftDirection = "escalation";
      Sh = 0; // reset after detection
    }
    if (Sl > h) {
      lastShiftIndex = i;
      lastShiftDirection = "de-escalation";
      Sl = 0;
    }
  }

  // Classify current regime from recent values vs reference
  const recentN = Math.min(5, values.length);
  const recentMean = values.slice(-recentN).reduce((a, b) => a + b, 0) / recentN;
  let regime: "baseline" | "elevated" | "crisis";
  if (recentMean > mean + 2 * std) {
    regime = "crisis";
  } else if (recentMean > mean + std) {
    regime = "elevated";
  } else {
    regime = "baseline";
  }

  return {
    upperSum: Math.round(Sh * 100) / 100,
    lowerSum: Math.round(Math.abs(Sl) * 100) / 100,
    shiftDetected: lastShiftIndex !== null,
    shiftDirection: lastShiftDirection,
    shiftIndex: lastShiftIndex,
    regime,
    referenceMean: Math.round(mean * 100) / 100,
    referenceStd: Math.round(std * 100) / 100,
  };
}

// ---- Trajectory Classification ----

export interface TrajectoryResult {
  /** Slope of the linear regression (units per data point) */
  slope: number;
  /** R² goodness of fit (0-1) */
  rSquared: number;
  /** Trend classification */
  classification: "improving" | "stable" | "deteriorating";
  /** Confidence in classification (0-1) */
  confidence: number;
  /** Number of data points used */
  dataPoints: number;
  /** Projected value at next time step */
  projectedNext: number;
}

/**
 * Ordinary Least Squares linear regression.
 * X-values are indices 0..n-1.
 */
function linearRegression(values: number[]): { slope: number; intercept: number; rSquared: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] ?? 0, rSquared: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, rSquared: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY = sumY / n;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * i + intercept;
    ssRes += (values[i] - predicted) ** 2;
    ssTot += (values[i] - meanY) ** 2;
  }
  const rSquared = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, rSquared };
}

/**
 * Classify a time series trajectory as improving, stable, or deteriorating.
 *
 * Uses linear regression slope normalized by stddev.
 * For geopolitical threat metrics: positive slope = deteriorating (rising tension).
 *
 * @param values - Time series (oldest first)
 * @param options - Configuration
 */
export function classifyTrajectory(
  values: number[],
  options: {
    /** Threshold in stddevs for classification. Default: 0.5 */
    slopeThreshold?: number;
    /** If true, higher values = better (inverts classification). Default: false */
    higherIsBetter?: boolean;
  } = {}
): TrajectoryResult {
  if (values.length < 3) {
    return {
      slope: 0, rSquared: 0,
      classification: "stable",
      confidence: 0, dataPoints: values.length,
      projectedNext: values[values.length - 1] ?? 0,
    };
  }

  const threshold = options.slopeThreshold ?? 0.5;
  const higherIsBetter = options.higherIsBetter ?? false;

  const { slope, intercept, rSquared } = linearRegression(values);

  // Normalize slope by stddev for threshold comparison
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const normalizedSlope = std > 0 ? slope / std : 0;

  let classification: "improving" | "stable" | "deteriorating";
  if (normalizedSlope > threshold) {
    classification = higherIsBetter ? "improving" : "deteriorating";
  } else if (normalizedSlope < -threshold) {
    classification = higherIsBetter ? "deteriorating" : "improving";
  } else {
    classification = "stable";
  }

  // Confidence: R² weighted by data sufficiency
  const dataConfidence = Math.min(1, values.length / 10);
  const confidence = Math.round(rSquared * dataConfidence * 100) / 100;

  return {
    slope: Math.round(slope * 1000) / 1000,
    rSquared: Math.round(rSquared * 1000) / 1000,
    classification,
    confidence,
    dataPoints: values.length,
    projectedNext: Math.round((slope * values.length + intercept) * 100) / 100,
  };
}

// ---- Holt-Winters Triple Exponential Smoothing ----

export interface HoltWintersResult {
  fitted: number[];
  forecasts: number[];
  level: number;
  trend: number;
  seasonal: number[];
}

/**
 * Holt-Winters additive triple exponential smoothing.
 * Produces 6h/12h/24h forward projections accounting for daily seasonality.
 *
 * @param values - Time series (oldest first)
 * @param options - Smoothing parameters
 */
export function holtWinters(
  values: number[],
  options: {
    seasonLength?: number;
    forecastHorizon?: number;
    alpha?: number;
    beta?: number;
    gamma?: number;
  } = {}
): HoltWintersResult {
  const m = options.seasonLength ?? 24;
  const h = options.forecastHorizon ?? 24;
  const alpha = options.alpha ?? 0.3;
  const beta = options.beta ?? 0.1;
  const gamma = options.gamma ?? 0.3;

  const n = values.length;
  if (n < m + 2) {
    return { fitted: [...values], forecasts: Array(h).fill(values[n - 1] || 0), level: values[n - 1] || 0, trend: 0, seasonal: Array(m).fill(0) };
  }

  // Initialize: average of first season as level
  let level = values.slice(0, m).reduce((a, b) => a + b, 0) / m;
  let trend = (values.slice(m, 2 * m).reduce((a, b) => a + b, 0) / m - level) / m;

  // Initialize seasonal indices from first season
  const seasonal = new Array(m);
  for (let i = 0; i < m; i++) {
    seasonal[i] = values[i] - level;
  }

  const fitted: number[] = [];

  // Fit
  for (let t = 0; t < n; t++) {
    const seasonIdx = t % m;
    const prevLevel = level;

    // Update level
    level = alpha * (values[t] - seasonal[seasonIdx]) + (1 - alpha) * (prevLevel + trend);
    // Update trend
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
    // Update seasonal
    seasonal[seasonIdx] = gamma * (values[t] - level) + (1 - gamma) * seasonal[seasonIdx];

    fitted.push(level + trend + seasonal[seasonIdx]);
  }

  // Forecast
  const forecasts: number[] = [];
  for (let i = 1; i <= h; i++) {
    const seasonIdx = (n + i - 1) % m;
    forecasts.push(Math.max(0, Math.min(100, level + trend * i + seasonal[seasonIdx])));
  }

  return { fitted, forecasts, level, trend, seasonal };
}

/**
 * Ensemble forecast: combines Holt-Winters with CUSUM regime awareness.
 * During stable regime: Holt-Winters weighted 80%
 * During regime change: CUSUM-adjusted weights 70%
 */
export function ensembleForecast(
  values: number[],
  cusum: CUSUMResult,
  hwForecasts: number[]
): { ensemble: number[]; method: string; weights: { hw: number; cusum: number } } {
  const isRegimeChange = cusum.shiftDetected || cusum.regime === "crisis";
  const hwWeight = isRegimeChange ? 0.3 : 0.8;
  const cusumWeight = 1 - hwWeight;

  // CUSUM-adjusted forecasts: project from current regime level
  const recentMean = values.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, values.length);
  const cusumProjection = hwForecasts.map(() => recentMean);

  const ensemble = hwForecasts.map((hw, i) =>
    Math.max(0, Math.min(100, Math.round((hw * hwWeight + cusumProjection[i] * cusumWeight) * 100) / 100))
  );

  return {
    ensemble,
    method: isRegimeChange ? "cusum-dominant" : "hw-dominant",
    weights: { hw: hwWeight, cusum: cusumWeight },
  };
}

// ---- Z-Score Anomaly Detection ----

/**
 * Median Absolute Deviation — robust alternative to standard deviation.
 */
export function medianAbsoluteDeviation(values: number[]): { median: number; mad: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[Math.floor(n / 2)];
  const deviations = values.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = n % 2 === 0 ? (deviations[n / 2 - 1] + deviations[n / 2]) / 2 : deviations[Math.floor(n / 2)];
  return { median, mad };
}

/**
 * Modified Z-Score using MAD for robust outlier detection.
 * z > 3.5 is typically considered an outlier (Iglewicz & Hoaglin).
 */
export function modifiedZScore(values: number[]): number[] {
  if (values.length < 3) return values.map(() => 0);
  const { median, mad } = medianAbsoluteDeviation(values);
  const CONSISTENCY_CONSTANT = 0.6745; // for normal distribution
  if (mad === 0) return values.map(v => v === median ? 0 : Infinity);
  return values.map(v => (CONSISTENCY_CONSTANT * (v - median)) / mad);
}

/**
 * Signal velocity — first derivative over sliding window.
 */
export function signalVelocity(values: number[], windowSize: number = 3): number[] {
  if (values.length < 2) return [0];
  const velocities: number[] = [0];
  for (let i = 1; i < values.length; i++) {
    const start = Math.max(0, i - windowSize);
    const delta = values[i] - values[start];
    const steps = i - start;
    velocities.push(Math.round((delta / steps) * 100) / 100);
  }
  return velocities;
}

export interface AnomalyResult {
  compoundScore: number;
  anomalousSignals: string[];
  signalZScores: Record<string, number>;
  signalVelocities: Record<string, number>;
  crossSignalCorrelation: boolean;
}

/**
 * Compound anomaly score: aggregates modified Z-Scores + velocities across all metrics.
 * Flags cross-signal correlation when 3+ signals are simultaneously anomalous.
 */
export function compoundAnomalyScore(
  signals: Record<string, number[]>
): AnomalyResult {
  const signalZScores: Record<string, number> = {};
  const signalVelocities: Record<string, number> = {};
  const anomalousSignals: string[] = [];
  const ANOMALY_THRESHOLD = 2.5;

  for (const [name, values] of Object.entries(signals)) {
    if (values.length < 5) continue;
    const zScores = modifiedZScore(values);
    const lastZ = zScores[zScores.length - 1];
    signalZScores[name] = Math.round(lastZ * 100) / 100;

    const velocities = signalVelocity(values);
    const lastV = velocities[velocities.length - 1];
    signalVelocities[name] = lastV;

    if (Math.abs(lastZ) > ANOMALY_THRESHOLD) {
      anomalousSignals.push(name);
    }
  }

  const crossSignalCorrelation = anomalousSignals.length >= 3;
  const avgZScore = Object.values(signalZScores).length > 0
    ? Object.values(signalZScores).reduce((a, b) => a + Math.abs(b), 0) / Object.values(signalZScores).length
    : 0;
  const crossBonus = crossSignalCorrelation ? 20 : 0;
  const compoundScore = Math.min(100, Math.round(avgZScore * 15 + crossBonus));

  return { compoundScore, anomalousSignals, signalZScores, signalVelocities, crossSignalCorrelation };
}
