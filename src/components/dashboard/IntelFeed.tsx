import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";

interface IntelItem {
  id: number;
  timestamp: string;
  source: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  content: string;
  entities: string[];
  sentiment: number;
}

interface IntelFeedProps {
  items: IntelItem[];
  loading: boolean;
  onRefresh: () => void;
}

const priorityStyles = {
  HIGH: "text-crimson border-crimson/30 bg-crimson-dim/30",
  MEDIUM: "text-amber border-amber/30 bg-amber-dim/30",
  LOW: "text-muted-foreground border-border bg-secondary/30",
};

const IntelFeed = ({ items, loading, onRefresh }: IntelFeedProps) => {
  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${loading ? "bg-amber animate-pulse-glow" : "bg-amber animate-pulse-glow"}`} />
          <span className="text-[11px] font-mono uppercase tracking-wider text-amber">
            Live OSINT Intel Pipeline
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{items.length} ITEMS</span>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-[9px] font-mono text-primary/60 hover:text-primary transition-colors disabled:opacity-30"
          >
            {loading ? "FETCHING..." : "↻ REFRESH"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {loading && items.length === 0 && (
          <div className="space-y-2 p-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border border-panel-border rounded-sm p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-12 bg-secondary" />
                  <Skeleton className="h-3 w-20 bg-secondary" />
                </div>
                <Skeleton className="h-8 w-full bg-secondary" />
                <div className="flex gap-1">
                  <Skeleton className="h-4 w-16 bg-secondary" />
                  <Skeleton className="h-4 w-16 bg-secondary" />
                </div>
              </div>
            ))}
          </div>
        )}

        {items.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.05 }}
            className="border border-panel-border rounded-sm bg-background/50 p-2.5 hover:border-primary/30 transition-colors"
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${priorityStyles[item.priority]}`}>
                  {item.priority}
                </span>
                <span className="text-[10px] text-primary/70 font-mono">{item.source}</span>
              </div>
              <span className="text-[9px] text-muted-foreground font-mono">
                {new Date(item.timestamp).toLocaleTimeString("en-US", { hour12: false })}Z
              </span>
            </div>
            <p className="text-[11px] text-foreground/80 leading-relaxed mb-1.5">
              {item.content}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {item.entities.map((entity) => (
                <span
                  key={entity}
                  className="text-[9px] text-primary/60 bg-primary/5 border border-primary/10 rounded-sm px-1.5 py-0.5 font-mono"
                >
                  {entity}
                </span>
              ))}
              <span className={`text-[9px] font-mono ml-auto ${item.sentiment < -0.6 ? "text-crimson" : item.sentiment < -0.4 ? "text-amber" : "text-muted-foreground"}`}>
                SENT: {item.sentiment.toFixed(2)}
              </span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default IntelFeed;
