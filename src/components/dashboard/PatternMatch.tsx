import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import { apiFetch } from "@/lib/api";

interface DTWMatch {
  templateName: string;
  distance: number;
  confidence: number;
  currentPhase: string;
  phaseProgress: number;
  alignmentPath: [number, number][];
}

interface TemplateInfo {
  name: string;
  description: string;
  year: number;
  phases: { name: string; startIdx: number }[];
}

interface PatternMatchResponse {
  matches: DTWMatch[];
  templates: TemplateInfo[];
  dataPoints: number;
  windowHours: number;
  timestamp: string;
}

const PHASE_COLORS: Record<string, string> = {
  early_warning: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  escalation: "bg-amber/20 text-amber border-amber/40",
  peak: "bg-crimson/20 text-crimson border-crimson/40",
  de_escalation: "bg-green-500/15 text-green-400 border-green-500/30",
};

const PHASE_LABELS: Record<string, string> = {
  early_warning: "EARLY WARNING",
  escalation: "ESCALATION",
  peak: "PEAK",
  de_escalation: "DE-ESCALATION",
};

// Known template patterns for overlay chart
const TEMPLATE_PATTERNS: Record<string, number[]> = {
  "Soleimani 2020": [
    0.15, 0.18, 0.20, 0.22, 0.19, 0.25, 0.30,
    0.35, 0.45, 0.55, 0.70,
    0.95, 1.00, 0.98, 0.92, 0.88,
    0.75, 0.65, 0.55, 0.48,
    0.40, 0.35, 0.30, 0.25, 0.22,
  ],
  "Tanker War 2019": [
    0.10, 0.12, 0.15, 0.18, 0.22,
    0.28, 0.35, 0.42, 0.48, 0.52,
    0.58, 0.65, 0.70, 0.75, 0.72,
    0.68, 0.65, 0.60, 0.58, 0.55,
    0.50, 0.48, 0.45, 0.42, 0.38,
  ],
  "Aramco 2019": [
    0.20, 0.22, 0.25, 0.28, 0.30,
    0.32, 0.35, 0.38, 0.42,
    0.85, 1.00, 0.95, 0.88,
    0.78, 0.70, 0.62, 0.55,
    0.48, 0.42, 0.38, 0.35, 0.32, 0.30, 0.28,
  ],
};

const PatternMatch = () => {
  const [data, setData] = useState<PatternMatchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPatterns = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiFetch<PatternMatchResponse>("/api/pattern-match", { hours: "168" });
      if (resp.matches) setData(resp);
    } catch (e) {
      console.error("Pattern match load error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPatterns();
    const interval = setInterval(loadPatterns, 5 * 60 * 1000); // refresh every 5min
    return () => clearInterval(interval);
  }, [loadPatterns]);

  const bestMatch = data?.matches?.[0];
  const templatePattern = bestMatch ? TEMPLATE_PATTERNS[bestMatch.templateName] : null;

  // Build overlay chart data — normalize both to same index length
  const chartData = (() => {
    if (!templatePattern || !bestMatch) return [];
    const patLen = templatePattern.length;
    return templatePattern.map((val, idx) => {
      // Determine how many alignment path entries map to this template index
      const mapped = bestMatch.alignmentPath.filter(([, tIdx]) => tIdx === idx);
      const currentVal = mapped.length > 0
        ? mapped.reduce((sum, [cIdx]) => {
            // We don't have the raw current values here, so we use alignment progress
            const progress = cIdx / Math.max(1, bestMatch.alignmentPath[bestMatch.alignmentPath.length - 1][0]);
            return sum + progress;
          }, 0) / mapped.length
        : null;
      return {
        idx: idx + 1,
        template: Math.round(val * 100),
        current: currentVal !== null ? Math.round(currentVal * 100) : undefined,
      };
    });
  })();

  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${loading ? "bg-amber animate-pulse-glow" : "bg-primary animate-pulse-glow"}`} />
          <span className="text-[11px] font-mono uppercase tracking-wider text-primary">
            DTW Pattern Match
          </span>
        </div>
        <button
          onClick={loadPatterns}
          disabled={loading}
          className="text-[9px] font-mono text-primary/60 hover:text-primary transition-colors disabled:opacity-30"
        >
          {loading ? "MATCHING..." : "REFRESH"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && !data && (
          <div className="flex items-center justify-center py-6">
            <div className="text-center">
              <div className="h-6 w-6 border border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-2" />
              <p className="text-[9px] text-muted-foreground font-mono">PATTERN MATCHING...</p>
            </div>
          </div>
        )}

        {data && data.matches.length === 0 && (
          <div className="text-center py-6">
            <p className="text-[9px] text-muted-foreground font-mono">Insufficient data for pattern matching (need 5+ datapoints)</p>
          </div>
        )}

        {bestMatch && (
          <>
            {/* Best match header */}
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-mono font-bold text-foreground">{bestMatch.templateName}</p>
                  <p className="text-[7px] font-mono text-muted-foreground mt-0.5">
                    {data.templates.find(t => t.name === bestMatch.templateName)?.description || ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-[14px] font-mono font-bold ${
                    bestMatch.confidence > 0.7 ? "text-crimson" :
                    bestMatch.confidence > 0.4 ? "text-amber" : "text-primary"
                  }`}>
                    {Math.round(bestMatch.confidence * 100)}%
                  </p>
                  <p className="text-[7px] font-mono text-muted-foreground">CONFIDENCE</p>
                </div>
              </div>

              {/* Phase badge */}
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[8px] font-mono font-bold ${PHASE_COLORS[bestMatch.currentPhase] || PHASE_COLORS.early_warning}`}>
                  {PHASE_LABELS[bestMatch.currentPhase] || bestMatch.currentPhase.toUpperCase()}
                </span>
                <div className="flex-1 h-1.5 bg-secondary/30 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${bestMatch.phaseProgress * 100}%` }}
                    transition={{ duration: 1, ease: "easeOut" }}
                    className={`h-full rounded-full ${
                      bestMatch.currentPhase === "peak" ? "bg-crimson/60" :
                      bestMatch.currentPhase === "escalation" ? "bg-amber/60" :
                      bestMatch.currentPhase === "de_escalation" ? "bg-green-500/40" : "bg-yellow-500/40"
                    }`}
                  />
                </div>
                <span className="text-[7px] font-mono text-muted-foreground">
                  {Math.round(bestMatch.phaseProgress * 100)}%
                </span>
              </div>
            </motion.div>

            {/* Overlay chart: template vs current signal */}
            {chartData.length > 0 && (
              <div className="h-28 mt-1">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
                    <XAxis
                      dataKey="idx"
                      tick={{ fontSize: 7, fill: "hsl(200 10% 45%)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 7, fill: "hsl(200 10% 45%)" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        background: "hsl(220 18% 7%)",
                        border: "1px solid hsl(220 15% 14%)",
                        borderRadius: "2px",
                        fontSize: "8px",
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "7px", fontFamily: "'JetBrains Mono', monospace" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="template"
                      stroke="hsl(200 10% 50%)"
                      strokeWidth={1}
                      strokeDasharray="4 2"
                      dot={false}
                      name="Template"
                    />
                    <Line
                      type="monotone"
                      dataKey="current"
                      stroke="hsl(38 90% 55%)"
                      strokeWidth={1.5}
                      dot={false}
                      name="Current"
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* All matches */}
            <div className="space-y-1 border-t border-panel-border pt-2">
              <p className="text-[8px] font-mono text-muted-foreground uppercase mb-1">All Template Matches</p>
              {data.matches.map((match) => {
                const confColor = match.confidence > 0.7 ? "text-crimson" :
                                  match.confidence > 0.4 ? "text-amber" : "text-muted-foreground";
                return (
                  <div key={match.templateName} className="flex items-center gap-2 text-[7px] font-mono">
                    <span className="flex-1 text-foreground/70 truncate">{match.templateName}</span>
                    <span className={`inline-flex items-center px-1 py-0.5 rounded-sm border text-[6px] ${PHASE_COLORS[match.currentPhase] || PHASE_COLORS.early_warning}`}>
                      {PHASE_LABELS[match.currentPhase] || match.currentPhase}
                    </span>
                    <span className={`w-8 text-right font-bold ${confColor}`}>
                      {Math.round(match.confidence * 100)}%
                    </span>
                    <span className="text-muted-foreground/50 w-10 text-right">d={match.distance}</span>
                  </div>
                );
              })}
            </div>

            {/* Metadata */}
            <div className="flex items-center gap-2 text-[6px] font-mono text-muted-foreground/40 border-t border-panel-border pt-1.5">
              <span>n={data.dataPoints}</span>
              <span>{data.windowHours}h window</span>
              <span>DTW Sakoe-Chiba</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default PatternMatch;
