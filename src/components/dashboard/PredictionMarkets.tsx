import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { ExternalLink } from "lucide-react";

interface Market {
  id: string;
  question: string;
  category: string;
  yesPrice: number | null;
  noPrice: number | null;
  volume: number;
  liquidity: number;
  endDate: string;
  active: boolean;
  url?: string;
}

interface PredictionMarketsProps {
  markets: Market[];
  loading: boolean;
  onRefresh: () => void;
}

const formatVolume = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const PredictionMarkets = ({ markets, loading, onRefresh }: PredictionMarketsProps) => {
  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${loading ? "bg-amber animate-pulse-glow" : "bg-tactical-green animate-pulse-glow"}`} />
          <span className="text-[11px] font-mono uppercase tracking-wider text-tactical-green">
            Iran Markets
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-muted-foreground font-mono">POLYMARKET LIVE</span>
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
        {loading && markets.length === 0 && (
          <div className="space-y-2 p-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="border border-panel-border rounded-sm p-2.5 space-y-2">
                <Skeleton className="h-4 w-3/4 bg-secondary" />
                <Skeleton className="h-6 w-full bg-secondary" />
              </div>
            ))}
          </div>
        )}

        {markets.map((market, i) => {
          const yp = market.yesPrice ?? 0;
          const isHighRisk = yp >= 60;
          const isMedRisk = yp >= 30 && yp < 60;

          return (
            <motion.div
              key={market.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`border rounded-sm p-2.5 transition-colors hover:border-primary/30 ${
                isHighRisk
                  ? "border-crimson/30 bg-crimson-dim/10"
                  : isMedRisk
                  ? "border-amber/20 bg-amber-dim/10"
                  : "border-panel-border bg-background/50"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                {market.url ? (
                  <a
                    href={market.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-foreground/80 leading-snug flex-1 font-mono hover:text-primary transition-colors group flex items-start gap-1"
                  >
                    {market.question}
                    <ExternalLink className="h-2.5 w-2.5 shrink-0 mt-0.5 opacity-50 group-hover:opacity-100" />
                  </a>
                ) : (
                  <p className="text-[10px] text-foreground/80 leading-snug flex-1 font-mono">
                    {market.question}
                  </p>
                )}
                <span className="text-[8px] text-muted-foreground font-mono shrink-0 bg-secondary/50 px-1 py-0.5 rounded-sm">
                  {market.category}
                </span>
              </div>

              {market.yesPrice !== null && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted-foreground font-mono w-6">YES</span>
                    <div className="flex-1 h-3 bg-secondary/50 rounded-sm overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${yp}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className={`h-full rounded-sm ${
                          isHighRisk ? "bg-crimson/70" : isMedRisk ? "bg-amber/70" : "bg-tactical-green/70"
                        }`}
                      />
                    </div>
                    <span className={`text-[10px] font-mono font-bold w-8 text-right ${
                      isHighRisk ? "text-crimson" : isMedRisk ? "text-amber" : "text-tactical-green"
                    }`}>
                      {yp}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted-foreground font-mono w-6">NO</span>
                    <div className="flex-1 h-3 bg-secondary/50 rounded-sm overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${market.noPrice ?? 0}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="h-full rounded-sm bg-primary/40"
                      />
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">
                      {market.noPrice ?? 0}%
                    </span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[8px] text-muted-foreground/60 font-mono">
                  VOL: {formatVolume(market.volume)}
                </span>
                {market.endDate && (
                  <span className="text-[8px] text-muted-foreground/60 font-mono">
                    ENDS: {new Date(market.endDate).toLocaleDateString()}
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}

        {!loading && markets.length === 0 && (
          <div className="text-center py-8">
            <p className="text-[10px] text-muted-foreground font-mono">NO ACTIVE IRAN MARKETS FOUND</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PredictionMarkets;
