/**
 * Dynamic Time Warping (DTW) with Sakoe-Chiba band.
 * Matches current signal patterns against historical crisis templates.
 */

export interface CrisisTemplate {
  name: string;
  description: string;
  year: number;
  /** Normalized signal values (0-1), representing the crisis pattern */
  pattern: number[];
  /** Phase boundaries: indices where each phase starts */
  phases: { name: string; startIdx: number }[];
}

export interface DTWMatchResult {
  templateName: string;
  distance: number;
  confidence: number;
  currentPhase: string;
  phaseProgress: number;
  alignmentPath: [number, number][];
}

/**
 * DTW distance with Sakoe-Chiba band constraint.
 * Returns the minimum alignment cost and the optimal warping path.
 */
export function dtwDistance(
  series1: number[],
  series2: number[],
  bandWidth: number = Math.ceil(Math.max(series1.length, series2.length) * 0.2)
): { distance: number; path: [number, number][] } {
  const n = series1.length;
  const m = series2.length;

  // Cost matrix
  const dtw: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(Infinity));
  dtw[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    const jStart = Math.max(1, i - bandWidth);
    const jEnd = Math.min(m, i + bandWidth);
    for (let j = jStart; j <= jEnd; j++) {
      const cost = Math.abs(series1[i - 1] - series2[j - 1]);
      dtw[i][j] = cost + Math.min(dtw[i - 1][j], dtw[i][j - 1], dtw[i - 1][j - 1]);
    }
  }

  // Traceback
  const path: [number, number][] = [];
  let i = n, j = m;
  path.push([i - 1, j - 1]);
  while (i > 1 || j > 1) {
    if (i === 1) { j--; }
    else if (j === 1) { i--; }
    else {
      const candidates = [
        { di: -1, dj: -1, cost: dtw[i - 1][j - 1] },
        { di: -1, dj: 0, cost: dtw[i - 1][j] },
        { di: 0, dj: -1, cost: dtw[i][j - 1] },
      ];
      const best = candidates.reduce((a, b) => a.cost <= b.cost ? a : b);
      i += best.di;
      j += best.dj;
    }
    path.push([i - 1, j - 1]);
  }
  path.reverse();

  return { distance: dtw[n][m], path };
}

/**
 * Normalize a signal array to 0-1 range.
 */
export function normalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return values.map(v => (v - min) / range);
}

// ---- Historical Crisis Templates ----

export const CRISIS_TEMPLATES: CrisisTemplate[] = [
  {
    name: "Soleimani 2020",
    description: "Assassination of Qasem Soleimani -- sudden escalation, retaliatory strikes, rapid de-escalation",
    year: 2020,
    pattern: [
      0.15, 0.18, 0.20, 0.22, 0.19, 0.25, 0.30, // Early signals (intel chatter, drone positioning)
      0.35, 0.45, 0.55, 0.70,                      // Pre-strike escalation
      0.95, 1.00, 0.98, 0.92, 0.88,                // Strike + immediate aftermath (peak)
      0.75, 0.65, 0.55, 0.48,                      // Iran retaliation + cooling
      0.40, 0.35, 0.30, 0.25, 0.22,                // De-escalation
    ],
    phases: [
      { name: "early_warning", startIdx: 0 },
      { name: "escalation", startIdx: 7 },
      { name: "peak", startIdx: 11 },
      { name: "de_escalation", startIdx: 16 },
    ],
  },
  {
    name: "Tanker War 2019",
    description: "Gulf of Oman tanker attacks -- gradual maritime escalation, sustained tension",
    year: 2019,
    pattern: [
      0.10, 0.12, 0.15, 0.18, 0.22,               // JCPOA withdrawal aftermath
      0.28, 0.35, 0.42, 0.48, 0.52,                // First tanker incidents
      0.58, 0.65, 0.70, 0.75, 0.72,                // Peak maritime tension
      0.68, 0.65, 0.60, 0.58, 0.55,                // Sustained elevated
      0.50, 0.48, 0.45, 0.42, 0.38,                // Gradual reduction
    ],
    phases: [
      { name: "early_warning", startIdx: 0 },
      { name: "escalation", startIdx: 5 },
      { name: "peak", startIdx: 10 },
      { name: "de_escalation", startIdx: 15 },
    ],
  },
  {
    name: "Aramco 2019",
    description: "Saudi Aramco drone/missile attack -- proxy-launched, sharp escalation spike",
    year: 2019,
    pattern: [
      0.20, 0.22, 0.25, 0.28, 0.30,               // Baseline Houthi activity
      0.32, 0.35, 0.38, 0.42,                      // Escalating drone campaign
      0.85, 1.00, 0.95, 0.88,                      // Aramco attack + shock
      0.78, 0.70, 0.62, 0.55,                      // International response
      0.48, 0.42, 0.38, 0.35, 0.32, 0.30, 0.28,   // De-escalation
    ],
    phases: [
      { name: "early_warning", startIdx: 0 },
      { name: "escalation", startIdx: 5 },
      { name: "peak", startIdx: 9 },
      { name: "de_escalation", startIdx: 13 },
    ],
  },
];

/**
 * Match current signal pattern against all crisis templates.
 */
export function matchPatterns(currentValues: number[]): DTWMatchResult[] {
  if (currentValues.length < 5) return [];

  const normalizedCurrent = normalize(currentValues);
  const results: DTWMatchResult[] = [];

  for (const template of CRISIS_TEMPLATES) {
    const { distance, path } = dtwDistance(normalizedCurrent, template.pattern);

    // Normalize distance by path length
    const normalizedDistance = distance / path.length;

    // Convert to confidence (0-1): lower distance = higher confidence
    const confidence = Math.max(0, Math.min(1, 1 - normalizedDistance * 2));

    // Determine current phase based on alignment
    const lastAlignment = path[path.length - 1];
    const templateIdx = lastAlignment[1];
    let currentPhase = template.phases[0].name;
    let phaseStartIdx = 0;
    for (const phase of template.phases) {
      if (templateIdx >= phase.startIdx) {
        currentPhase = phase.name;
        phaseStartIdx = phase.startIdx;
      }
    }

    // Phase progress within current phase
    const nextPhaseIdx = template.phases.findIndex(p => p.startIdx > phaseStartIdx);
    const phaseEnd = nextPhaseIdx >= 0 ? template.phases[nextPhaseIdx].startIdx : template.pattern.length;
    const phaseProgress = Math.min(1, (templateIdx - phaseStartIdx) / Math.max(1, phaseEnd - phaseStartIdx));

    results.push({
      templateName: template.name,
      distance: Math.round(normalizedDistance * 1000) / 1000,
      confidence: Math.round(confidence * 100) / 100,
      currentPhase,
      phaseProgress: Math.round(phaseProgress * 100) / 100,
      alignmentPath: path,
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
