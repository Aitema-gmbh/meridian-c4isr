import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";

interface IntelItem {
  id: number;
  timestamp: string;
  source: string;
  sourceUrl?: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  content: string;
  entities: string[];
  sentiment: number;
  threat_tag?: string;
  confidence?: string;
  isReddit?: boolean;
  corroboration_score?: number;
}

interface IntelFeedProps {
  items: IntelItem[];
  loading: boolean;
  onRefresh: () => void;
  flashReport?: string | null;
}

const priorityStyles = {
  HIGH: "text-crimson border-crimson/30 bg-crimson-dim/30",
  MEDIUM: "text-amber border-amber/30 bg-amber-dim/30",
  LOW: "text-muted-foreground border-border bg-secondary/30",
};

const tagColors: Record<string, string> = {
  MARITIME: "text-primary bg-primary/10 border-primary/20",
  CYBER: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  DIPLOMATIC: "text-amber bg-amber/10 border-amber/20",
  MILITARY: "text-crimson bg-crimson/10 border-crimson/20",
  ECONOMIC: "text-tactical-green bg-tactical-green/10 border-tactical-green/20",
};

const confidenceColors: Record<string, string> = {
  HIGH: "text-crimson",
  MEDIUM: "text-amber",
  LOW: "text-muted-foreground",
};

const IntelFeed = ({ items = [], loading, onRefresh, flashReport }: IntelFeedProps) => {
  const [entityFilter, setEntityFilter] = useState<string | null>(null);

  // Compute entity frequency and co-occurrences
  const { topEntities, filteredItems } = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const item of items) {
      for (const e of item.entities) {
        freq[e] = (freq[e] || 0) + 1;
      }
    }
    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    const filtered = entityFilter
      ? items.filter(it => it.entities.some(e => e.toLowerCase() === entityFilter.toLowerCase()))
      : items;

    return { topEntities: sorted, filteredItems: filtered };
  }, [items, entityFilter]);

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
          <span className="text-[10px] text-muted-foreground">{entityFilter ? `${filteredItems.length}/${items.length}` : items.length} ITEMS</span>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-[9px] font-mono text-primary/60 hover:text-primary transition-colors disabled:opacity-30"
          >
            {loading ? "FETCHING..." : "↻ REFRESH"}
          </button>
        </div>
      </div>

      {/* Entity Knowledge Bar */}
      {topEntities.length > 0 && (
        <div className="px-2 py-1 border-b border-panel-border/50 bg-secondary/10 shrink-0">
          <div className="flex items-center gap-1 flex-wrap">
            {entityFilter && (
              <button
                onClick={() => setEntityFilter(null)}
                className="text-[7px] font-mono px-1 py-0.5 rounded-sm border border-crimson/30 text-crimson hover:bg-crimson/10 transition-colors mr-0.5"
              >
                CLEAR
              </button>
            )}
            {topEntities.map(([entity, count]) => (
              <button
                key={entity}
                onClick={() => setEntityFilter(entityFilter === entity ? null : entity)}
                className={`text-[7px] font-mono px-1.5 py-0.5 rounded-sm border transition-colors ${
                  entityFilter === entity
                    ? "border-primary/50 text-primary bg-primary/15"
                    : "border-primary/10 text-primary/50 hover:text-primary/80 hover:bg-primary/5"
                }`}
              >
                {entity}
                <span className="ml-0.5 text-muted-foreground/40">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Flash Report Banner */}
        {flashReport && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel-glass border border-amber/30 rounded-sm p-2.5 mb-2"
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[9px] font-mono text-amber animate-pulse-fast px-1.5 py-0.5 border border-amber/40 rounded-sm bg-amber/10">
                ⚡ FLASH REPORT
              </span>
            </div>
            <p className="text-[10px] text-foreground/80 leading-relaxed font-mono">
              {flashReport}
            </p>
          </motion.div>
        )}

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

        {filteredItems.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }}
            className={`border rounded-sm bg-background/50 p-2.5 transition-all hover:border-primary/30 ${
              item.priority === "HIGH" ? "border-crimson/20 hover:border-crimson/40 hover:glow-crimson" : "border-panel-border"
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm border ${priorityStyles[item.priority]}`}>
                  {item.priority}
                </span>
                {item.priority === "HIGH" && (
                  <span className="text-[8px] font-mono text-crimson animate-pulse-fast">⚠ FLASH</span>
                )}
                {item.isReddit && (
                  <span className="text-[8px] font-mono px-1 py-0.5 rounded-sm border text-purple-400 bg-purple-400/10 border-purple-400/20">
                    REDDIT
                  </span>
                )}
                {item.threat_tag && (
                  <span className={`text-[8px] font-mono px-1 py-0.5 rounded-sm border ${tagColors[item.threat_tag] || "text-muted-foreground border-border"}`}>
                    {item.threat_tag}
                  </span>
                )}
                {item.confidence && (
                  <span className={`text-[8px] font-mono ${confidenceColors[item.confidence] || "text-muted-foreground"}`}>
                    CONF:{item.confidence}
                  </span>
                )}
                {item.corroboration_score && item.corroboration_score >= 2 && (
                  <span className="text-[8px] font-mono px-1 py-0.5 rounded-sm border text-tactical-green bg-tactical-green/10 border-tactical-green/20" title={`Confirmed by ${item.corroboration_score} sources`}>
                    CORROB:{item.corroboration_score}
                  </span>
                )}
              </div>
              <span className="text-[9px] text-muted-foreground font-mono">
                {new Date(item.timestamp).toLocaleTimeString("en-US", { hour12: false })}Z
              </span>
            </div>
            <div className="flex items-center gap-1.5 mb-1">
              {item.sourceUrl ? (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[9px] text-primary/70 font-mono hover:text-primary transition-colors flex items-center gap-1 group"
                >
                  {item.source}
                  <ExternalLink className="h-2.5 w-2.5 opacity-50 group-hover:opacity-100 transition-opacity" />
                </a>
              ) : (
                <span className="text-[9px] text-primary/70 font-mono">{item.source}</span>
              )}
            </div>
            <p className="text-[11px] text-foreground/80 leading-relaxed mb-1.5">
              {item.content}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {item.entities.map((entity) => (
                <button
                  key={entity}
                  onClick={() => setEntityFilter(entityFilter === entity ? null : entity)}
                  className={`text-[9px] rounded-sm px-1.5 py-0.5 font-mono border transition-colors ${
                    entityFilter === entity
                      ? "text-primary bg-primary/15 border-primary/30"
                      : "text-primary/60 bg-primary/5 border-primary/10 hover:bg-primary/10"
                  }`}
                >
                  {entity}
                </button>
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
