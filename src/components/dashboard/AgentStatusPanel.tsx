import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

interface AgentStatus {
  name: string;
  label: string;
  threatLevel: number;
  lastRun: string | null;
  itemsCount: number;
  confidence: string;
  minutesAgo: number | null;
  fresh: boolean;
}

const AGENT_CONFIG: { name: string; label: string }[] = [
  { name: "flights", label: "ADS-B" },
  { name: "naval", label: "NAVAL" },
  { name: "osint", label: "OSINT" },
  { name: "reddit", label: "REDDIT" },
  { name: "pentagon", label: "PENT" },
  { name: "cyber", label: "CYBER" },
  { name: "markets", label: "MKTS" },
  { name: "wiki", label: "WIKI" },
  { name: "macro", label: "MACRO" },
  { name: "fires", label: "FIRES" },
  { name: "head-analyst", label: "HEAD" },
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

const freshnessIcon = (fresh: boolean, minutesAgo: number | null) => {
  if (minutesAgo === null) return <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" title="No data" />;
  if (fresh) return <div className="h-1.5 w-1.5 rounded-full bg-tactical-green animate-pulse" title={`${minutesAgo}m ago`} />;
  return <div className="h-1.5 w-1.5 rounded-full bg-amber" title={`${minutesAgo}m ago — stale`} />;
};

const AgentStatusPanel = () => {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [convergenceLevel, setConvergenceLevel] = useState(0);
  const [convergenceAgents, setConvergenceAgents] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      const cutoff = new Date(Date.now() - 120 * 60 * 1000).toISOString(); // 2h window
      const { data: reports } = await supabase
        .from("agent_reports")
        .select("*")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false });

      if (!reports) return;

      // Get latest per agent
      const latest: Record<string, any> = {};
      for (const r of reports) {
        if (!latest[r.agent_name]) latest[r.agent_name] = r;
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

  return (
    <div className="flex flex-col h-full">
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
        <div className="grid grid-cols-4 gap-1">
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
              <p className={`text-sm font-mono font-bold ${threatColor(agent.threatLevel)}`}>
                {agent.threatLevel}
              </p>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[7px] font-mono text-muted-foreground">{agent.itemsCount} items</span>
                {agent.minutesAgo !== null && (
                  <span className="text-[7px] font-mono text-muted-foreground">{agent.minutesAgo}m</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AgentStatusPanel;
