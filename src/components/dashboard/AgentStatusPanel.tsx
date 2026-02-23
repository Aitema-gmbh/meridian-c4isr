import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { apiFetch } from "@/lib/api";

interface AgentStatus {
  name: string;
  label: string;
  threatLevel: number;
  lastRun: string | null;
  itemsCount: number;
  confidence: string;
  minutesAgo: number | null;
  fresh: boolean;
  history: number[]; // threat levels over time for sparkline
}

const AGENT_CONFIG: { name: string; label: string }[] = [
  { name: "flights", label: "ADS-B" },
  { name: "naval", label: "NAVAL" },
  { name: "ais", label: "AIS" },
  { name: "osint", label: "OSINT" },
  { name: "telegram", label: "TGRAM" },
  { name: "acled", label: "ACLED" },
  { name: "reddit", label: "REDDIT" },
  { name: "pentagon", label: "PENT" },
  { name: "cyber", label: "CYBER" },
  { name: "markets", label: "MKTS" },
  { name: "wiki", label: "WIKI" },
  { name: "macro", label: "MACRO" },
  { name: "fires", label: "FIRES" },
  { name: "pizza", label: "PIZZA" },
  { name: "head-analyst", label: "HEAD" },
  { name: "thinktank", label: "THINK" },
];

const threatColor = (level: number) => {
  if (level > 70) return "text-crimson";
  if (level > 40) return "text-amber";
  return "text-tactical-green";
};

const threatBg = (level: number) => {
  if (level > 70) return "bg-crimson/15 border-crimson/30";
  if (level > 40) return "bg-amber/10 border-amber/30";
  return "bg-tactical-green/10 border-tactical-green/30";
};

const threatStroke = (level: number) => {
  if (level > 70) return "hsl(0 85% 55%)";
  if (level > 40) return "hsl(38 90% 55%)";
  return "hsl(185 80% 50%)";
};

const freshnessIcon = (fresh: boolean, minutesAgo: number | null) => {
  if (minutesAgo === null) return <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" title="No data" />;
  if (fresh) return <div className="h-1.5 w-1.5 rounded-full bg-tactical-green animate-pulse" title={`${minutesAgo}m ago`} />;
  return <div className="h-1.5 w-1.5 rounded-full bg-amber" title={`${minutesAgo}m ago — stale`} />;
};

// Mini SVG sparkline — 30x12px
const Sparkline = ({ data, color }: { data: number[]; color: string }) => {
  if (data.length < 2) return null;
  const w = 30, h = 12;
  const max = Math.max(...data, 1);
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (v / max) * h;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="opacity-60">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
};

// Trend arrow
const TrendArrow = ({ history }: { history: number[] }) => {
  if (history.length < 2) return null;
  const latest = history[history.length - 1];
  const prev = history[history.length - 2];
  const diff = latest - prev;
  if (Math.abs(diff) < 3) return <span className="text-[7px] text-muted-foreground">→</span>;
  if (diff > 0) return <span className="text-[7px] text-crimson">↑{Math.round(diff)}</span>;
  return <span className="text-[7px] text-tactical-green">↓{Math.abs(Math.round(diff))}</span>;
};

const AgentStatusPanel = () => {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [convergenceLevel, setConvergenceLevel] = useState(0);
  const [convergenceAgents, setConvergenceAgents] = useState<string[]>([]);
  const [cycleRunning, setCycleRunning] = useState(false);
  const [lastCycle, setLastCycle] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      // Fetch agent reports and timeline in parallel
      const [reportsData, timelineData] = await Promise.all([
        apiFetch<{ reports: Record<string, unknown>[] }>("/api/agent-reports", { hours: "6" }),
        apiFetch<{ timeline: Record<string, unknown>[] }>("/api/signal-timeline", { hours: "24" }).catch(() => ({ timeline: [] })),
      ]);

      const reports = reportsData?.reports;
      if (!reports) return;

      // Get latest per agent
      const latest: Record<string, any> = {};
      for (const r of reports) {
        if (!latest[r.agent_name]) latest[r.agent_name] = r;
      }

      // Build history per agent from timeline
      const historyMap: Record<string, number[]> = {};
      const timeline = timelineData?.timeline || [];
      for (const entry of timeline) {
        const name = entry.agent_name as string;
        if (!historyMap[name]) historyMap[name] = [];
        historyMap[name].push(Number(entry.threat_level) || 0);
      }
      // Reverse so oldest first (timeline comes newest-first)
      for (const name of Object.keys(historyMap)) {
        historyMap[name].reverse();
      }

      const statuses: AgentStatus[] = AGENT_CONFIG.map(cfg => {
        const r = latest[cfg.name];
        const minutesAgo = r ? Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000) : null;
        return {
          name: cfg.name,
          label: cfg.label,
          threatLevel: r ? Number(r.threat_level) || 0 : 0,
          lastRun: r?.created_at || null,
          itemsCount: r?.items_count || 0,
          confidence: r?.confidence || "—",
          minutesAgo,
          fresh: minutesAgo !== null && minutesAgo < 60,
          history: historyMap[cfg.name] || [],
        };
      });

      setAgents(statuses);

      // Convergence detection: 3+ agents with threat > 50
      const elevated = statuses.filter(s => s.threatLevel > 50 && s.name !== "head-analyst" && s.fresh);
      setConvergenceLevel(elevated.length);
      setConvergenceAgents(elevated.map(s => s.label));
    };

    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, []);

  const runCycle = async () => {
    if (cycleRunning) return;
    setCycleRunning(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev";
      // Phase 1: Collection agents
      const resp = await fetch(`${API_BASE}/api/run-cycle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      let totalOk = 0, totalAgents = 0, totalMs = 0;
      if (resp.ok) {
        const data = await resp.json() as { successCount: number; totalAgents: number; totalMs: number };
        totalOk = data.successCount;
        totalAgents = data.totalAgents;
        totalMs = data.totalMs;
      }
      // Phase 2: Synthesis agents (separate request to avoid subrequest limit)
      const synResp = await fetch(`${API_BASE}/api/run-synthesis`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (synResp.ok) {
        const synData = await synResp.json() as { successCount: number; totalAgents: number; totalMs: number };
        totalOk += synData.successCount;
        totalAgents += synData.totalAgents;
        totalMs += synData.totalMs;
      }
      setLastCycle(`${totalOk}/${totalAgents} OK (${Math.round(totalMs / 1000)}s)`);
    } catch (e) {
      console.error("Cycle error:", e);
    } finally {
      setCycleRunning(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header with Run Cycle button */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-panel-border bg-panel-header shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Agent Status</span>
          {lastCycle && <span className="text-[7px] font-mono text-tactical-green">{lastCycle}</span>}
        </div>
        <button
          onClick={runCycle}
          disabled={cycleRunning}
          className={`text-[8px] font-mono px-2 py-0.5 rounded-sm border transition-colors ${
            cycleRunning
              ? "border-amber/30 text-amber bg-amber/10 animate-pulse"
              : "border-primary/30 text-primary hover:bg-primary/10"
          }`}
        >
          {cycleRunning ? "RUNNING CYCLE..." : "\u21BB RUN ALL"}
        </button>
      </div>

      {/* Convergence Alert */}
      {convergenceLevel >= 3 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-2 mt-2 px-2 py-1.5 rounded-sm border border-crimson/50 bg-crimson/10"
        >
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-crimson animate-pulse" />
            <span className="text-[9px] font-mono text-crimson font-bold">CONVERGENCE ALERT</span>
          </div>
          <p className="text-[8px] font-mono text-crimson/80 mt-0.5">
            {convergenceLevel} agents elevated: {convergenceAgents.join(", ")}
          </p>
        </motion.div>
      )}

      {/* Agent grid */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-4 gap-1 auto-rows-min">
          {agents.map(agent => (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`border rounded-sm p-1.5 ${threatBg(agent.threatLevel)}`}
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[8px] font-mono font-bold text-foreground/80">{agent.label}</span>
                {freshnessIcon(agent.fresh, agent.minutesAgo)}
              </div>
              <div className="flex items-center justify-between">
                <p className={`text-sm font-mono font-bold ${threatColor(agent.threatLevel)}`}>
                  {agent.threatLevel}
                </p>
                <Sparkline data={agent.history} color={threatStroke(agent.threatLevel)} />
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[7px] font-mono text-muted-foreground">{agent.itemsCount} items</span>
                <TrendArrow history={agent.history} />
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AgentStatusPanel;
