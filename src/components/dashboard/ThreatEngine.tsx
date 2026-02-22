import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { MOCK_TENSION_HISTORY } from "@/data/mockData";

const THREAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/threat-engine`;

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

const ThreatEngine = ({ liveMetadata, marketData = [] }: { liveMetadata: LiveMetadata | null; marketData?: MarketItem[] }) => {
  const [data, setData] = useState<ThreatData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      // Add market data as additional indicators
      const marketContext = marketData.length > 0
        ? marketData.slice(0, 5).map(m => `"${m.question}": ${m.yesPrice ?? '?'}% YES`).join("; ")
        : null;

      const resp = await fetch(THREAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ indicators, marketContext }),
      });

      if (resp.status === 429) { toast.error("Rate limit exceeded."); setError("Rate limit exceeded. Try again later."); return; }
      if (resp.status === 402) { toast.error("AI credits exhausted. Top up at Settings → Workspace → Usage."); setError("AI credits exhausted. Add credits in Settings → Workspace → Usage."); return; }
      if (!resp.ok) throw new Error("Threat engine error");

      const result = await resp.json();
      setData(result);
    } catch (e) {
      console.error("Threat engine error:", e);
      setError("Failed to calculate threat assessment");
      toast.error("Threat engine unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchThreatData(liveMetadata);
  }, [liveMetadata]);

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
              <div className="flex flex-col items-center gap-1">
                <WatchconBadge level={d.watchcon} />
              </div>
            </div>

            {/* History chart */}
            <div className="h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={MOCK_TENSION_HISTORY}>
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

            {/* Radial gauges */}
            <div className="grid grid-cols-2 gap-2 py-1">
              <RadialGauge label="Hormuz Closure" value={d.hormuzClosure} color={d.hormuzClosure > 50 ? "crimson" : "amber"} size={68} />
              <RadialGauge label="Cyber Attack" value={d.cyberAttack} color={d.cyberAttack > 50 ? "crimson" : "amber"} size={68} />
              <RadialGauge label="Proxy Escalation" value={d.proxyEscalation} color={d.proxyEscalation > 50 ? "crimson" : "amber"} size={68} />
              <RadialGauge label="Direct Confrontation" value={d.directConfrontation} color={d.directConfrontation > 30 ? "amber" : "primary"} size={68} />
            </div>

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
          </>
        )}
      </div>
    </div>
  );
};

export default ThreatEngine;
