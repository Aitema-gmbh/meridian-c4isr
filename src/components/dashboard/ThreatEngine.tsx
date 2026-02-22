import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
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
}

interface LiveMetadata {
  articleCount: number;
  milTrackCount: number;
  averageSentiment: number;
  timestamp: string;
}

const ThreatGauge = ({ label, value, color }: { label: string; value: number; color: string }) => {
  const colorClass = color === "crimson" ? "bg-crimson" : color === "amber" ? "bg-amber" : "bg-primary";
  const textClass = color === "crimson" ? "text-crimson" : color === "amber" ? "text-amber" : "text-primary";
  const glowClass = color === "crimson" ? "glow-crimson" : color === "amber" ? "glow-amber" : "glow-cyan";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-mono uppercase">{label}</span>
        <span className={`text-[11px] font-mono font-bold ${textClass}`}>{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1.5, ease: "easeOut" }}
          className={`h-full rounded-full ${colorClass} ${value > 50 ? glowClass : ""}`}
        />
      </div>
    </div>
  );
};

const ThreatEngine = ({ liveMetadata }: { liveMetadata: LiveMetadata | null }) => {
  const [data, setData] = useState<ThreatData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThreatData = async (meta: LiveMetadata | null) => {
    setLoading(true);
    setError(null);
    try {
      // Use real data from live-intel if available, otherwise defaults
      const indicators = meta
        ? {
            sentimentScore: meta.averageSentiment,
            flightAnomalyIndex: Math.min(meta.milTrackCount * 3, 100),
            maritimeAnomalyIndex: 45,
            goldsteinScale: meta.averageSentiment * 10,
            irgcnDeployments: "200% above baseline",
            diplomaticSignals: `${meta.articleCount} GDELT conflict articles in latest fetch. Sentiment avg: ${meta.averageSentiment.toFixed(2)}`,
            cyberIndicators: "2 APT campaigns detected targeting Gulf energy infrastructure",
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

      const resp = await fetch(THREAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ indicators }),
      });

      if (resp.status === 429) { toast.error("Rate limit exceeded."); return; }
      if (resp.status === 402) { toast.error("AI credits exhausted."); return; }
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

  // Re-fetch when live metadata changes
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

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
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
            {/* Tension Index */}
            <div className="flex items-center justify-center gap-4 py-3">
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mb-1">
                  Composite Tension Index
                </p>
                <motion.p
                  key={d.tensionIndex}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`text-5xl font-sans font-bold ${
                    d.tensionIndex > 70 ? "text-crimson text-glow-crimson" :
                    d.tensionIndex > 40 ? "text-amber text-glow-amber" : "text-primary"
                  }`}
                >
                  {Math.round(d.tensionIndex)}
                </motion.p>
                <p className="text-[9px] text-muted-foreground font-mono mt-1">
                  / 100 — WATCHCON {d.watchcon}
                </p>
              </div>
            </div>

            {/* History chart */}
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={MOCK_TENSION_HISTORY}>
                  <defs>
                    <linearGradient id="tensionGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(38 90% 55%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(38 90% 55%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: "hsl(200 10% 45%)" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[30, 80]} hide />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(220 18% 7%)",
                      border: "1px solid hsl(220 15% 14%)",
                      borderRadius: "2px",
                      fontSize: "10px",
                      fontFamily: "'JetBrains Mono', monospace",
                    }}
                  />
                  <Area type="monotone" dataKey="index" stroke="hsl(38 90% 55%)" fill="url(#tensionGrad)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Threat gauges */}
            <div className="space-y-3">
              <ThreatGauge label="Strait of Hormuz Closure" value={d.hormuzClosure} color={d.hormuzClosure > 50 ? "crimson" : "amber"} />
              <ThreatGauge label="Cyber Attack Probability" value={d.cyberAttack} color={d.cyberAttack > 50 ? "crimson" : "amber"} />
              <ThreatGauge label="Proxy Escalation Risk" value={d.proxyEscalation} color={d.proxyEscalation > 50 ? "crimson" : "amber"} />
              <ThreatGauge label="Direct Confrontation" value={d.directConfrontation} color={d.directConfrontation > 30 ? "amber" : "primary"} />
            </div>

            {/* Contributing factors */}
            <div className="border-t border-panel-border pt-3 space-y-2">
              <p className="text-[10px] text-muted-foreground font-mono uppercase">Contributing Factors</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-secondary/30 border border-panel-border rounded-sm p-2">
                  <p className="text-[9px] text-muted-foreground font-mono">OSINT Sentiment</p>
                  <p className="text-sm font-mono text-amber">{d.sentimentScore.toFixed(2)}</p>
                </div>
                <div className="bg-secondary/30 border border-panel-border rounded-sm p-2">
                  <p className="text-[9px] text-muted-foreground font-mono">Flight Anomaly Idx</p>
                  <p className="text-sm font-mono text-crimson">{d.flightAnomalyIndex}</p>
                </div>
                <div className="bg-secondary/30 border border-panel-border rounded-sm p-2">
                  <p className="text-[9px] text-muted-foreground font-mono">Maritime Anomaly</p>
                  <p className="text-sm font-mono text-amber">{d.maritimeAnomalyIndex}</p>
                </div>
                <div className="bg-secondary/30 border border-panel-border rounded-sm p-2">
                  <p className="text-[9px] text-muted-foreground font-mono">WATCHCON</p>
                  <p className="text-sm font-mono text-crimson">{d.watchcon}</p>
                </div>
              </div>
            </div>

            {/* AI Narrative */}
            {d.analysisNarrative && (
              <div className="border-t border-panel-border pt-3">
                <p className="text-[10px] text-muted-foreground font-mono uppercase mb-1">AI Analysis</p>
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
