import { motion } from "framer-motion";
import { MOCK_THREAT_METRICS, MOCK_TENSION_HISTORY } from "@/data/mockData";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const ThreatGauge = ({ label, value, color }: { label: string; value: number; color: string }) => {
  const colorClass = color === "crimson" ? "bg-crimson" : color === "amber" ? "bg-amber" : "bg-primary";
  const textClass = color === "crimson" ? "text-crimson" : color === "amber" ? "text-amber" : "text-primary";
  const glowClass = color === "crimson" ? "glow-crimson" : color === "amber" ? "glow-amber" : "glow-cyan";

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-mono uppercase">{label}</span>
        <span className={`text-[11px] font-mono font-bold ${textClass}`}>{value}%</span>
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

const ThreatEngine = () => {
  const m = MOCK_THREAT_METRICS;

  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-crimson animate-pulse-glow" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-crimson">
            Predictive Threat Engine
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">AI-CALCULATED</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Tension Index - big number */}
        <div className="flex items-center justify-center gap-4 py-3">
          <div className="text-center">
            <p className="text-[10px] text-muted-foreground font-mono uppercase tracking-wider mb-1">
              Composite Tension Index
            </p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`text-5xl font-sans font-bold ${
                m.tensionIndex > 70 ? "text-crimson text-glow-crimson" :
                m.tensionIndex > 40 ? "text-amber text-glow-amber" : "text-primary"
              }`}
            >
              {m.tensionIndex}
            </motion.p>
            <p className="text-[9px] text-muted-foreground font-mono mt-1">/ 100 — ELEVATED</p>
          </div>
        </div>

        {/* Tension history chart */}
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
                labelStyle={{ color: "hsl(200 20% 85%)" }}
              />
              <Area type="monotone" dataKey="index" stroke="hsl(38 90% 55%)" fill="url(#tensionGrad)" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Individual threat gauges */}
        <div className="space-y-3">
          <ThreatGauge label="Strait of Hormuz Closure" value={m.hormuzClosure} color="amber" />
          <ThreatGauge label="Cyber Attack Probability" value={m.cyberAttack} color="crimson" />
          <ThreatGauge label="Proxy Escalation Risk" value={m.proxyEscalation} color="amber" />
          <ThreatGauge label="Direct Confrontation" value={m.directConfrontation} color="primary" />
        </div>

        {/* Contributing factors */}
        <div className="border-t border-panel-border pt-3 space-y-2">
          <p className="text-[10px] text-muted-foreground font-mono uppercase">Contributing Factors</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-secondary/30 border border-panel-border rounded-sm p-2">
              <p className="text-[9px] text-muted-foreground font-mono">OSINT Sentiment</p>
              <p className="text-sm font-mono text-amber">{m.sentimentScore.toFixed(2)}</p>
            </div>
            <div className="bg-secondary/30 border border-panel-border rounded-sm p-2">
              <p className="text-[9px] text-muted-foreground font-mono">Flight Anomaly Idx</p>
              <p className="text-sm font-mono text-crimson">{m.flightAnomalyIndex}</p>
            </div>
            <div className="bg-secondary/30 border border-panel-border rounded-sm p-2">
              <p className="text-[9px] text-muted-foreground font-mono">Maritime Anomaly</p>
              <p className="text-sm font-mono text-amber">{m.maritimeAnomalyIndex}</p>
            </div>
            <div className="bg-secondary/30 border border-panel-border rounded-sm p-2">
              <p className="text-[9px] text-muted-foreground font-mono">GDELT Goldstein</p>
              <p className="text-sm font-mono text-crimson">-7.2</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThreatEngine;
