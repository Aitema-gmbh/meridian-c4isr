import { useState, useEffect, memo } from "react";
import { motion } from "framer-motion";
import { apiFetch } from "@/lib/api";

interface TimelineEvent {
  id: string;
  agentName: string;
  summary: string;
  threatLevel: number;
  createdAt: string;
  minutesAgo: number;
}

const agentColors: Record<string, string> = {
  flights: "bg-primary",
  naval: "bg-blue-400",
  osint: "bg-amber",
  reddit: "bg-orange-400",
  pentagon: "bg-crimson",
  cyber: "bg-purple-400",
  markets: "bg-tactical-green",
  wiki: "bg-yellow-400",
  macro: "bg-emerald-400",
  fires: "bg-red-400",
  "head-analyst": "bg-primary",
};

const SignalTimeline = () => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  useEffect(() => {
    const load = async () => {
      const { timeline } = await apiFetch<{ timeline: Record<string, unknown>[] }>("/api/signal-timeline", { hours: "24" });
      if (timeline) {
        setEvents(timeline.map((r: Record<string, unknown>) => ({
          id: String(r.id),
          agentName: String(r.agent_name),
          summary: String(r.summary || ""),
          threatLevel: Number(r.threat_level) || 0,
          createdAt: String(r.created_at),
          minutesAgo: Math.round((Date.now() - new Date(r.created_at as string).getTime()) / 60000),
        })));
      }
    };
    load();
    const interval = setInterval(load, 120000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (mins: number) => {
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.round(mins / 60)}h`;
    return `${Math.round(mins / 1440)}d`;
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-panel-border bg-panel-header shrink-0">
        <span className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground">Signal Timeline (24h)</span>
        <span className="text-[8px] font-mono text-muted-foreground">{events.length} events</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="text-[9px] text-muted-foreground font-mono p-3 text-center">No agent reports in last 24h</p>
        ) : (
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-[18px] top-0 bottom-0 w-px bg-panel-border" />
            {events.map((ev, i) => (
              <motion.div
                key={ev.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02 }}
                className="flex items-start gap-2 px-2 py-1.5 hover:bg-secondary/20 transition-colors"
              >
                {/* Dot */}
                <div className="flex flex-col items-center shrink-0 mt-1">
                  <div className={`h-2 w-2 rounded-full ${agentColors[ev.agentName] || "bg-muted-foreground"}`} />
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[8px] font-mono font-bold text-foreground/70 uppercase">{ev.agentName}</span>
                    <span className={`text-[8px] font-mono ${ev.threatLevel > 50 ? "text-crimson" : "text-muted-foreground"}`}>
                      LVL {ev.threatLevel}
                    </span>
                    <span className="text-[7px] font-mono text-muted-foreground ml-auto shrink-0">{formatTime(ev.minutesAgo)}</span>
                  </div>
                  <p className="text-[8px] text-foreground/60 leading-snug line-clamp-2 mt-0.5">{ev.summary}</p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default memo(SignalTimeline);
