import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { apiFetch } from "@/lib/api";

const THREAT_URL = `${import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev"}/threat-engine`;

interface ThreatData {
  tensionIndex: number;
  hormuzClosure: number;
  cyberAttack: number;
  proxyEscalation: number;
  directConfrontation: number;
  sentimentScore: number;
  flightAnomalyIndex: number;
  maritimeAnomalyIndex: number;
  analysisNarrative: string;
  watchcon: string;
  marketDivergences?: string[];
}

interface LiveMetadata {
  articleCount: number;
  milTrackCount: number;
  averageSentiment: number;
  timestamp: string;
  dominantCategory?: string;
}

interface MarketItem {
  id: string;
  question: string;
  yesPrice: number | null;
  volume: number;
}

// Animated counter
const AnimatedNumber = ({ value, suffix = "" }: { value: number; suffix?: string }) => {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);

  useEffect(() => {
    const start = ref.current;
    const diff = value - start;
    const duration = 1200;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + diff * eased;
      setDisplay(current);
      ref.current = current;
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [value]);

  return <>{Math.round(display)}{suffix}</>;
};

// Radial gauge
const RadialGauge = ({ label, value, color, size = 72 }: { label: string; value: number; color: string; size?: number }) => {
  const radius = (size - 8) / 2;
  const circumference = Math.PI * radius; // half circle
  const offset = circumference - (value / 100) * circumference;

  const strokeColor = color === "crimson" ? "hsl(0 85% 55%)" : color === "amber" ? "hsl(38 90% 55%)" : "hsl(185 80% 50%)";
  const textClass = color === "crimson" ? "text-crimson" : color === "amber" ? "text-amber" : "text-primary";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`}>
        {/* Background arc */}
        <path
          d={`M 4 ${size / 2 + 4} A ${radius} ${radius} 0 0 1 ${size - 4} ${size / 2 + 4}`}
          fill="none"
          stroke="hsl(220 15% 15%)"
          strokeWidth="4"
          strokeLinecap="round"
        />
        {/* Value arc */}
        <motion.path
          d={`M 4 ${size / 2 + 4} A ${radius} ${radius} 0 0 1 ${size - 4} ${size / 2 + 4}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          style={{ filter: value > 50 ? `drop-shadow(0 0 4px ${strokeColor})` : "none" }}
        />
        <text x={size / 2} y={size / 2} textAnchor="middle" className={`text-[13px] font-mono font-bold ${textClass}`} fill="currentColor">
          <AnimatedNumber value={value} suffix="%" />
        </text>
      </svg>
      <span className="text-[8px] text-muted-foreground font-mono uppercase text-center leading-tight">{label}</span>
    </div>
  );
};

// WATCHCON badge
const WatchconBadge = ({ level }: { level: string }) => {
  const num = parseInt(level) || 3;
  const colors: Record<number, string> = {
    1: "bg-crimson text-crimson-foreground border-crimson glow-crimson",
    2: "bg-amber/80 text-background border-amber glow-amber",
    3: "bg-yellow-500/70 text-background border-yellow-500",
    4: "bg-tactical-green/70 text-background border-tactical-green",
    5: "bg-primary/70 text-background border-primary glow-cyan",
  };

  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border text-[10px] font-mono font-bold ${colors[num] || colors[3]}`}
    >
      WATCHCON {level}
    </motion.div>
  );
};

// Trajectory types from /api/trajectories
interface TrajectoryResult {
  slope: number;
  rSquared: number;
  classification: "improving" | "stable" | "deteriorating";
  confidence: number;
  dataPoints: number;
  projectedNext: number;
}

interface CUSUMResult {
  upperSum: number;
  lowerSum: number;
  shiftDetected: boolean;
  shiftDirection: "escalation" | "de-escalation" | null;
  shiftIndex: number | null;
  regime: "baseline" | "elevated" | "crisis";
  referenceMean: number;
  referenceStd: number;
}

interface TrajectoryResponse {
  cusum: CUSUMResult;
  trajectories: Record<string, TrajectoryResult>;
  countryTrajectories: Record<string, TrajectoryResult>;
  dataPoints: number;
  windowHours: number;
}

// Trend arrow next to gauges
const TrendArrow = ({ traj }: { traj?: TrajectoryResult }) => {
  if (!traj) return null;
  const { classification, confidence, slope, rSquared } = traj;
  const tip = `slope ${slope > 0 ? "+" : ""}${slope}/pt, R²=${rSquared}, conf=${Math.round(confidence * 100)}%`;
  if (classification === "deteriorating")
    return <span className="text-crimson text-[9px] font-mono" title={tip}>↗</span>;
  if (classification === "improving")
    return <span className="text-green-400 text-[9px] font-mono" title={tip}>↘</span>;
  return <span className="text-muted-foreground text-[8px] font-mono" title={tip}>→</span>;
};

// CUSUM regime badge
const RegimeBadge = ({ cusum }: { cusum: CUSUMResult }) => {
  const colors: Record<string, string> = {
    crisis: "bg-crimson/20 text-crimson border-crimson/40",
    elevated: "bg-amber/20 text-amber border-amber/40",
    baseline: "bg-green-500/10 text-green-400 border-green-500/30",
  };
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[8px] font-mono font-bold ${colors[cusum.regime] || colors.baseline}`}
    >
      {cusum.shiftDetected && <span className="animate-pulse-fast">◉</span>}
      {cusum.regime.toUpperCase()}
    </motion.div>
  );
};

interface CalibrationStat {
  count: number;
  avgEstimate: number;
  avgMarketPrice: number | null;
  avgDivergence: number | null;
  latest: { our_estimate: number; market_price: number | null; created_at: string } | null;
}

const METRIC_LABELS: Record<string, string> = {
  hormuzClosure: "HORMUZ",
  cyberAttack: "CYBER",
  proxyEscalation: "PROXY",
  directConfrontation: "DIRECT",
};

const ThreatEngine = ({ liveMetadata, marketData = [] }: { liveMetadata: LiveMetadata | null; marketData?: MarketItem[] }) => {
  const [data, setData] = useState<ThreatData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tensionHistory, setTensionHistory] = useState<{ time: string; index: number; sentiment: number; flights: number }[]>([]);
  const [calibration, setCalibration] = useState<Record<string, CalibrationStat> | null>(null);
  const [mathBaseline, setMathBaseline] = useState<{
    tensionIndex: number; hormuzClosure: number; cyberAttack: number;
    proxyEscalation: number; directConfrontation: number;
    confidence: number; convergence: number; extremizingFactor: number;
  } | null>(null);
  const [trajectoryData, setTrajectoryData] = useState<TrajectoryResponse | null>(null);
  const [anomalyData, setAnomalyData] = useState<{ compoundScore: number; anomalousSignals: string[]; crossSignalCorrelation: boolean } | null>(null);
  const dbLoaded = useRef(false);

  // Load tension history from DB
  const loadTensionHistory = useCallback(async () => {
    try {
      const { assessments } = await apiFetch<{ assessments: Record<string, unknown>[] }>("/api/threat-assessments", { limit: "24" });
      if (assessments && assessments.length >= 3) {
        const sorted = [...assessments].reverse();
        setTensionHistory(sorted.map((r: Record<string, unknown>) => {
          const d = new Date(r.created_at as string);
          return {
            time: `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`,
            index: Number(r.tension_index) || 0,
            sentiment: 0,
            flights: 0,
          };
        }));
      }
    } catch (e) {
      console.error("Tension history load error:", e);
    }
  }, []);

  // Load latest threat assessment from DB (no AI credits needed)
  const loadFromDB = useCallback(async () => {
    try {
      const { assessments } = await apiFetch<{ assessments: Record<string, unknown>[] }>("/api/threat-assessments", { limit: "1" });
      if (assessments?.[0]) {
        const r = assessments[0];
        const raw = (r.raw_indicators as Record<string, unknown>) || {};
        setData({
          tensionIndex: Number(r.tension_index) || 0,
          hormuzClosure: Number(r.hormuz_closure) || 0,
          cyberAttack: Number(r.cyber_attack) || 0,
          proxyEscalation: Number(r.proxy_escalation) || 0,
          directConfrontation: Number(r.direct_confrontation) || 0,
          sentimentScore: Number(raw.sentimentScore) || 0,
          flightAnomalyIndex: Number(raw.flightAnomalyIndex) || 0,
          maritimeAnomalyIndex: Number(raw.maritimeAnomalyIndex) || 0,
          analysisNarrative: String(r.analysis_narrative || ""),
          watchcon: String(r.watchcon || "V"),
          marketDivergences: (r.market_divergences as string[]) || [],
        });
        dbLoaded.current = true;
        // Extract math baseline from raw_indicators
        const mb = raw.mathBaseline as Record<string, unknown> | undefined;
        if (mb) {
          setMathBaseline({
            tensionIndex: Number(mb.tensionIndex) || 0,
            hormuzClosure: Number(mb.hormuzClosure) || 0,
            cyberAttack: Number(mb.cyberAttack) || 0,
            proxyEscalation: Number(mb.proxyEscalation) || 0,
            directConfrontation: Number(mb.directConfrontation) || 0,
            confidence: Number(mb.confidence) || 0,
            convergence: Number(mb.convergence) || 0,
            extremizingFactor: Number(mb.extremizingFactor) || 1,
          });
        }
      }
    } catch (e) {
      console.error("DB threat load error:", e);
    }
  }, []);

  const loadCalibration = useCallback(async () => {
    try {
      const resp = await apiFetch<{ stats: Record<string, CalibrationStat> }>("/api/calibration", { days: "7" });
      if (resp.stats && Object.keys(resp.stats).length > 0) {
        setCalibration(resp.stats);
      }
    } catch (e) {
      console.error("Calibration load error:", e);
    }
  }, []);

  const loadTrajectories = useCallback(async () => {
    try {
      const resp = await apiFetch<TrajectoryResponse>("/api/trajectories", { hours: "168" });
      if (resp.cusum) setTrajectoryData(resp);
    } catch (e) {
      console.error("Trajectory load error:", e);
    }
  }, []);

  const loadAnomalies = useCallback(async () => {
    try {
      const resp = await apiFetch<{ compoundScore: number; anomalousSignals: string[]; crossSignalCorrelation: boolean }>("/api/anomalies", { hours: "48" });
      if (resp.compoundScore != null) setAnomalyData(resp);
    } catch {}
  }, []);

  const fetchThreatData = async (meta: LiveMetadata | null) => {
    setLoading(true);
    setError(null);
    try {
      const indicators = meta
        ? {
            sentimentScore: meta.averageSentiment,
            flightAnomalyIndex: Math.min(meta.milTrackCount * 3, 100),
            maritimeAnomalyIndex: 45,
            goldsteinScale: (meta.averageSentiment ?? 0) * 10,
            irgcnDeployments: "200% above baseline",
            diplomaticSignals: `${meta.articleCount} GDELT conflict articles across 3 streams. Dominant: ${meta.dominantCategory || "MILITARY"}. Sentiment: ${(meta.averageSentiment ?? 0).toFixed(2)}`,
            cyberIndicators: "APT campaigns detected targeting Gulf energy infrastructure",
          }
        : {
            sentimentScore: -0.63,
            flightAnomalyIndex: 72,
            maritimeAnomalyIndex: 45,
            goldsteinScale: -7.2,
            irgcnDeployments: "200% above baseline",
            diplomaticSignals: "Iranian FM denies buildup, combative tone.",
            cyberIndicators: "2 APT campaigns detected targeting Gulf infrastructure",
          };

      const marketContext = marketData.length > 0
        ? marketData.slice(0, 5).map(m => `"${m.question}": ${m.yesPrice ?? '?'}% YES`).join("; ")
        : null;

      const resp = await fetch(THREAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ""}`,
        },
        body: JSON.stringify({ indicators, marketContext }),
      });

      if (resp.status === 429) { toast.error("Rate limit exceeded."); if (!dbLoaded.current) setError("Rate limit exceeded."); return; }
      if (resp.status === 402) { toast.error("AI credits exhausted. Showing cached assessment."); if (!dbLoaded.current) setError("AI credits exhausted."); return; }
      if (!resp.ok) throw new Error("Threat engine error");

      const result = await resp.json();
      // Sanitize API response (Gemini fallback may return partial data)
      setData({
        tensionIndex: Number(result.tensionIndex) || 0,
        hormuzClosure: Number(result.hormuzClosure) || 0,
        cyberAttack: Number(result.cyberAttack) || 0,
        proxyEscalation: Number(result.proxyEscalation) || 0,
        directConfrontation: Number(result.directConfrontation) || 0,
        sentimentScore: Number(result.sentimentScore) || 0,
        flightAnomalyIndex: Number(result.flightAnomalyIndex) || 0,
        maritimeAnomalyIndex: Number(result.maritimeAnomalyIndex) || 0,
        analysisNarrative: String(result.analysisNarrative || ""),
        watchcon: String(result.watchcon || "V"),
        marketDivergences: result.marketDivergences || [],
      });
    } catch (e) {
      console.error("Threat engine error:", e);
      if (!dbLoaded.current) {
        setError("Failed to calculate threat assessment");
        toast.error("Threat engine unavailable.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Load DB first (instant), then try live API
    loadTensionHistory();
    loadCalibration();
    loadTrajectories();
    loadAnomalies();
    loadFromDB().then(() => fetchThreatData(liveMetadata));
  }, [liveMetadata, loadFromDB, loadTensionHistory, loadCalibration, loadTrajectories, loadAnomalies]);

  const d = data;

  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${loading ? "bg-amber animate-pulse-glow" : "bg-crimson animate-pulse-glow"}`} />
          <span className="text-[11px] font-mono uppercase tracking-wider text-crimson">
            Predictive Threat Engine
          </span>
        </div>
        <button
          onClick={() => fetchThreatData(liveMetadata)}
          disabled={loading}
          className="text-[9px] font-mono text-primary/60 hover:text-primary transition-colors disabled:opacity-30"
        >
          {loading ? "CALCULATING..." : "↻ RECALCULATE"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && !d && (
          <div className="flex items-center justify-center py-8">
            <div className="text-center">
              <div className="h-8 w-8 border border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-2" />
              <p className="text-[10px] text-muted-foreground font-mono">AI THREAT ANALYSIS IN PROGRESS...</p>
            </div>
          </div>
        )}

        {error && !d && (
          <div className="text-center py-8">
            <p className="text-[10px] text-crimson font-mono">{error}</p>
            <button onClick={() => fetchThreatData(liveMetadata)} className="text-[10px] text-primary font-mono mt-2 hover:underline">
              RETRY
            </button>
          </div>
        )}

        {d && (
          <>
            {/* Tension Index + WATCHCON */}
            <div className="flex items-center justify-between py-2">
              <div className="text-center flex-1">
                <p className="text-[9px] text-muted-foreground font-mono uppercase tracking-wider mb-1">
                  Tension Index
                </p>
                <motion.p
                  key={d.tensionIndex}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`text-4xl font-sans font-bold ${
                    d.tensionIndex > 70 ? "text-crimson text-glow-crimson" :
                    d.tensionIndex > 40 ? "text-amber text-glow-amber" : "text-primary"
                  }`}
                >
                  <AnimatedNumber value={d.tensionIndex} />
                </motion.p>
                <p className="text-[9px] text-muted-foreground font-mono mt-0.5">/ 100</p>
              </div>
              <div className="flex flex-col items-center gap-1.5">
                <WatchconBadge level={d.watchcon} />
                {trajectoryData?.cusum && <RegimeBadge cusum={trajectoryData.cusum} />}
              </div>
            </div>

            {/* History chart */}
            <div className="h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={tensionHistory}>
                  <defs>
                    <linearGradient id="tensionGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(38 90% 55%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(38 90% 55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 8, fill: "hsl(200 10% 45%)" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[30, 80]} hide />
                  <RechartsTooltip
                    contentStyle={{
                      background: "hsl(220 18% 7%)",
                      border: "1px solid hsl(220 15% 14%)",
                      borderRadius: "2px",
                      fontSize: "9px",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  />
                  <Area type="monotone" dataKey="index" stroke="hsl(38 90% 55%)" fill="url(#tensionGrad)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Anomaly Alert Badge */}
            {anomalyData && anomalyData.compoundScore > 50 && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 bg-crimson/15 border border-crimson/30 rounded-sm px-2.5 py-1.5"
              >
                <span className="text-crimson animate-pulse-fast text-[12px]">&#x26A0;</span>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono font-bold text-crimson uppercase">Anomaly Alert</span>
                    <span className="text-[8px] font-mono text-crimson/80">Score: {anomalyData.compoundScore}/100</span>
                  </div>
                  {anomalyData.anomalousSignals.length > 0 && (
                    <p className="text-[7px] font-mono text-crimson/60 mt-0.5">
                      {anomalyData.anomalousSignals.join(", ")}
                      {anomalyData.crossSignalCorrelation && " | CROSS-SIGNAL CORRELATION"}
                    </p>
                  )}
                </div>
              </motion.div>
            )}

            {/* Radial gauges with trajectory indicators */}
            <div className="grid grid-cols-2 gap-2 py-1">
              {([
                { key: "hormuzClosure", label: "Hormuz Closure", value: d.hormuzClosure, high: 50, mid: 25 },
                { key: "cyberAttack", label: "Cyber Attack", value: d.cyberAttack, high: 50, mid: 25 },
                { key: "proxyEscalation", label: "Proxy Escalation", value: d.proxyEscalation, high: 50, mid: 25 },
                { key: "directConfrontation", label: "Direct Confrontation", value: d.directConfrontation, high: 30, mid: 15 },
              ] as const).map(({ key, label, value, high, mid }) => (
                <div key={key} className="relative">
                  <RadialGauge label={label} value={value} color={value > high ? "crimson" : value > mid ? "amber" : "primary"} size={68} />
                  <div className="absolute top-0 right-1">
                    <TrendArrow traj={trajectoryData?.trajectories?.[key]} />
                  </div>
                </div>
              ))}
            </div>

            {/* CUSUM + Trajectory Analysis */}
            {trajectoryData && (
              <div className="border-t border-panel-border pt-2">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="text-[9px] text-muted-foreground font-mono uppercase">Trend Analysis</span>
                  <span className="text-[7px] font-mono text-primary/60">7d CUSUM + OLS</span>
                </div>
                <div className="space-y-0.5">
                  {([
                    { key: "tensionIndex", label: "TI" },
                    { key: "hormuzClosure", label: "HMZ" },
                    { key: "cyberAttack", label: "CYB" },
                    { key: "proxyEscalation", label: "PRX" },
                    { key: "directConfrontation", label: "DIR" },
                  ] as const).map(({ key, label }) => {
                    const traj = trajectoryData.trajectories[key];
                    if (!traj) return null;
                    const classColor = traj.classification === "deteriorating" ? "text-crimson" :
                                       traj.classification === "improving" ? "text-green-400" : "text-muted-foreground";
                    const arrow = traj.classification === "deteriorating" ? "↗" :
                                  traj.classification === "improving" ? "↘" : "→";
                    return (
                      <div key={key} className="flex items-center gap-1 text-[7px] font-mono">
                        <span className="w-5 text-muted-foreground">{label}</span>
                        <span className={`w-3 ${classColor}`}>{arrow}</span>
                        <div className="flex-1 h-1.5 bg-secondary/30 rounded-full relative overflow-hidden">
                          <div
                            className={`absolute h-full rounded-full ${
                              traj.classification === "deteriorating" ? "bg-crimson/40" :
                              traj.classification === "improving" ? "bg-green-500/40" : "bg-primary/20"
                            }`}
                            style={{ width: `${Math.min(100, traj.rSquared * 100)}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground/60 w-12 text-right">R²={traj.rSquared.toFixed(2)}</span>
                        <span className={`w-12 text-right ${classColor}`}>
                          {traj.slope > 0 ? "+" : ""}{traj.slope.toFixed(1)}/pt
                        </span>
                      </div>
                    );
                  })}
                </div>
                {trajectoryData.cusum.shiftDetected && (
                  <div className="mt-1.5 flex items-center gap-1.5 bg-crimson/10 border border-crimson/20 rounded-sm px-2 py-1">
                    <span className="text-crimson animate-pulse-fast text-[10px]">◉</span>
                    <span className="text-[8px] font-mono text-crimson/80">
                      REGIME SHIFT: {trajectoryData.cusum.shiftDirection?.toUpperCase()} — baseline μ={trajectoryData.cusum.referenceMean} σ={trajectoryData.cusum.referenceStd}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1 text-[6px] font-mono text-muted-foreground/40">
                  <span>n={trajectoryData.dataPoints}</span>
                  <span>{trajectoryData.windowHours}h window</span>
                  <span className="flex items-center gap-0.5"><span className="inline-block w-3 h-1 bg-primary/20 rounded-sm" /> R² fit</span>
                </div>
              </div>
            )}

            {/* Superforecasting Baseline */}
            {mathBaseline && (
              <div className="border-t border-panel-border pt-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] text-muted-foreground font-mono uppercase">Math vs AI</span>
                  <span className="text-[7px] font-mono text-primary/60">GMO+Extremize d={mathBaseline.extremizingFactor}</span>
                </div>
                <div className="space-y-0.5">
                  {[
                    { label: "TI", math: mathBaseline.tensionIndex, ai: d.tensionIndex },
                    { label: "HMZ", math: mathBaseline.hormuzClosure, ai: d.hormuzClosure },
                    { label: "CYB", math: mathBaseline.cyberAttack, ai: d.cyberAttack },
                    { label: "PRX", math: mathBaseline.proxyEscalation, ai: d.proxyEscalation },
                    { label: "DIR", math: mathBaseline.directConfrontation, ai: d.directConfrontation },
                  ].map(({ label, math, ai }) => {
                    const diff = ai - math;
                    const diffColor = Math.abs(diff) > 10 ? "text-amber" : "text-muted-foreground";
                    return (
                      <div key={label} className="flex items-center gap-1 text-[7px] font-mono">
                        <span className="w-5 text-muted-foreground">{label}</span>
                        <div className="flex-1 h-1.5 bg-secondary/30 rounded-full relative overflow-hidden">
                          <div className="absolute h-full bg-primary/40 rounded-full" style={{ width: `${math}%` }} />
                          <div className="absolute h-full w-0.5 bg-amber" style={{ left: `${ai}%` }} />
                        </div>
                        <span className="text-primary/60 w-5 text-right">{math}</span>
                        <span className={`w-7 text-right ${diffColor}`}>{diff > 0 ? "+" : ""}{diff}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[6px] font-mono text-muted-foreground">CONF {Math.round(mathBaseline.confidence * 100)}%</span>
                  <span className="text-[6px] font-mono text-muted-foreground">CONV {Math.round(mathBaseline.convergence * 100)}%</span>
                </div>
              </div>
            )}

            {/* Market Divergences */}
            {d.marketDivergences && d.marketDivergences.length > 0 && (
              <div className="border-t border-panel-border pt-2">
                <p className="text-[9px] text-muted-foreground font-mono uppercase mb-1">Market Divergences</p>
                <div className="space-y-1">
                  {d.marketDivergences.slice(0, 2).map((div, i) => (
                    <p key={i} className="text-[8px] text-amber/80 font-mono leading-tight">
                      ▸ {div.length > 120 ? div.slice(0, 120) + "..." : div}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Contributing factors */}
            <div className="border-t border-panel-border pt-2 space-y-1.5">
              <p className="text-[9px] text-muted-foreground font-mono uppercase">Factors</p>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-secondary/30 border border-panel-border rounded-sm p-1.5">
                  <p className="text-[8px] text-muted-foreground font-mono">OSINT SENT</p>
                  <p className="text-xs font-mono text-amber">{d.sentimentScore.toFixed(2)}</p>
                </div>
                <div className="bg-secondary/30 border border-panel-border rounded-sm p-1.5">
                  <p className="text-[8px] text-muted-foreground font-mono">FLIGHT IDX</p>
                  <p className="text-xs font-mono text-crimson">{d.flightAnomalyIndex}</p>
                </div>
                <div className="bg-secondary/30 border border-panel-border rounded-sm p-1.5">
                  <p className="text-[8px] text-muted-foreground font-mono">MARITIME</p>
                  <p className="text-xs font-mono text-amber">{d.maritimeAnomalyIndex}</p>
                </div>
                <div className="bg-secondary/30 border border-panel-border rounded-sm p-1.5">
                  <p className="text-[8px] text-muted-foreground font-mono">WATCHCON</p>
                  <p className="text-xs font-mono text-crimson">{d.watchcon}</p>
                </div>
              </div>
            </div>

            {/* AI Narrative */}
            {d.analysisNarrative && (
              <div className="border-t border-panel-border pt-2">
                <p className="text-[9px] text-muted-foreground font-mono uppercase mb-1">AI Analysis</p>
                <p className="text-[10px] text-foreground/70 leading-relaxed">{d.analysisNarrative}</p>
              </div>
            )}

            {/* Calibration Tracking */}
            {calibration && Object.keys(calibration).length > 0 && (
              <div className="border-t border-panel-border pt-2">
                <p className="text-[9px] text-muted-foreground font-mono uppercase mb-1.5">Calibration vs Markets</p>
                <div className="space-y-1">
                  {Object.entries(calibration).map(([metric, stat]) => {
                    const label = METRIC_LABELS[metric] || metric;
                    const hasMarket = stat.avgMarketPrice !== null;
                    const div = stat.avgDivergence || 0;
                    const divAbs = Math.abs(div);
                    const divColor = divAbs > 15 ? "text-crimson" : divAbs > 5 ? "text-amber" : "text-tactical-green";
                    return (
                      <div key={metric} className="flex items-center gap-2 bg-secondary/20 rounded-sm p-1 border border-panel-border/50">
                        <span className="text-[7px] font-mono font-bold text-foreground/60 w-12 shrink-0">{label}</span>
                        <div className="flex-1 flex items-center gap-1">
                          <div className="flex-1 h-2 bg-panel-header rounded-sm overflow-hidden relative">
                            {/* Our estimate bar */}
                            <div
                              className="absolute inset-y-0 left-0 bg-primary/60 rounded-sm"
                              style={{ width: `${Math.min(100, stat.avgEstimate)}%` }}
                            />
                            {/* Market price marker */}
                            {hasMarket && (
                              <div
                                className="absolute inset-y-0 w-0.5 bg-amber"
                                style={{ left: `${Math.min(100, stat.avgMarketPrice!)}%` }}
                              />
                            )}
                          </div>
                          <span className="text-[7px] font-mono text-foreground/60 w-8 text-right">{Math.round(stat.avgEstimate)}%</span>
                        </div>
                        {hasMarket && (
                          <span className={`text-[7px] font-mono font-bold ${divColor} w-10 text-right`}>
                            {div > 0 ? "+" : ""}{Math.round(div)}
                          </span>
                        )}
                        <span className="text-[6px] font-mono text-muted-foreground/40">n={stat.count}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[6px] font-mono text-muted-foreground/40">
                  <span className="flex items-center gap-0.5"><span className="inline-block w-3 h-1 bg-primary/60 rounded-sm" /> Our Est</span>
                  <span className="flex items-center gap-0.5"><span className="inline-block w-0.5 h-2 bg-amber" /> Market</span>
                  <span className="flex items-center gap-0.5">+/- Divergence (7d avg)</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ThreatEngine;
