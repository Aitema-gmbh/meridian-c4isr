import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api";

interface BriefingContent {
  title: string;
  executiveSummary: string;
  keyDevelopments: string[];
  threatChanges: { metric: string; previous: number; current: number; change: string }[];
  outlook: string;
  recommendations: string[];
}

interface Briefing {
  id: number;
  briefing_type: string;
  title: string;
  content: BriefingContent;
  period_start: string;
  period_end: string;
  created_at: string;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev";

const BriefingViewer = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [selected, setSelected] = useState<Briefing | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadBriefings = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiFetch<{ briefings: Briefing[] }>("/api/briefings", { limit: "10" });
      if (resp.briefings) {
        setBriefings(resp.briefings);
        if (resp.briefings.length > 0 && !selected) setSelected(resp.briefings[0]);
      }
    } catch (e) {
      console.error("Briefings load error:", e);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    if (isOpen) loadBriefings();
  }, [isOpen, loadBriefings]);

  const generateBriefing = async (type: "daily" | "weekly") => {
    setGenerating(true);
    try {
      const resp = await fetch(`${API_BASE}/api/generate-briefing?type=${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (resp.ok) {
        await loadBriefings();
      }
    } catch (e) {
      console.error("Briefing generation error:", e);
    } finally {
      setGenerating(false);
    }
  };

  if (!isOpen) return null;

  const b = selected?.content;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="w-[90vw] max-w-4xl h-[80vh] bg-background border border-panel-border rounded-sm overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-panel-border bg-panel-header shrink-0">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-primary">Intelligence Briefings</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => generateBriefing("daily")}
                  disabled={generating}
                  className="text-[9px] font-mono px-2 py-1 border border-primary/30 rounded-sm text-primary hover:bg-primary/10 disabled:opacity-30"
                >
                  {generating ? "GENERATING..." : "GEN DAILY"}
                </button>
                <button
                  onClick={() => generateBriefing("weekly")}
                  disabled={generating}
                  className="text-[9px] font-mono px-2 py-1 border border-amber/30 rounded-sm text-amber hover:bg-amber/10 disabled:opacity-30"
                >
                  GEN WEEKLY
                </button>
              </div>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-1 overflow-hidden">
            {/* Sidebar: briefing list */}
            <div className="w-48 border-r border-panel-border overflow-y-auto shrink-0">
              {loading && briefings.length === 0 && (
                <div className="p-3 text-[9px] font-mono text-muted-foreground">Loading...</div>
              )}
              {briefings.map((br) => (
                <button
                  key={br.id}
                  onClick={() => setSelected(br)}
                  className={`w-full text-left px-3 py-2 border-b border-panel-border/50 transition-colors ${
                    selected?.id === br.id ? "bg-primary/10 text-primary" : "hover:bg-secondary/20 text-muted-foreground"
                  }`}
                >
                  <div className="text-[9px] font-mono font-bold">{br.title || br.briefing_type}</div>
                  <div className="text-[8px] font-mono text-muted-foreground/60 mt-0.5">
                    {new Date(br.created_at).toLocaleDateString()} {br.briefing_type.toUpperCase()}
                  </div>
                </button>
              ))}
              {briefings.length === 0 && !loading && (
                <div className="p-3 text-[9px] font-mono text-muted-foreground">
                  No briefings yet. Generate one above.
                </div>
              )}
            </div>

            {/* Main content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {b ? (
                <>
                  <div>
                    <h2 className="text-sm font-mono font-bold text-foreground mb-1">{b.title}</h2>
                    <div className="text-[9px] font-mono text-muted-foreground">
                      {selected?.period_start?.slice(0, 16)} → {selected?.period_end?.slice(0, 16)} | {selected?.briefing_type?.toUpperCase()}
                    </div>
                  </div>

                  {/* Executive Summary */}
                  <div className="border border-primary/20 rounded-sm p-3 bg-primary/5">
                    <h3 className="text-[10px] font-mono font-bold text-primary uppercase mb-1">Executive Summary</h3>
                    <p className="text-[11px] text-foreground/80 leading-relaxed">{b.executiveSummary}</p>
                  </div>

                  {/* Key Developments */}
                  {b.keyDevelopments?.length > 0 && (
                    <div>
                      <h3 className="text-[10px] font-mono font-bold text-amber uppercase mb-1.5">Key Developments</h3>
                      <ul className="space-y-1">
                        {b.keyDevelopments.map((dev, i) => (
                          <li key={i} className="text-[10px] text-foreground/70 leading-relaxed flex gap-2">
                            <span className="text-amber shrink-0">▸</span>
                            <span>{dev}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Threat Changes */}
                  {b.threatChanges?.length > 0 && (
                    <div>
                      <h3 className="text-[10px] font-mono font-bold text-crimson uppercase mb-1.5">Threat Changes</h3>
                      <div className="space-y-1">
                        {b.threatChanges.map((tc, i) => {
                          const delta = tc.current - tc.previous;
                          const color = delta > 5 ? "text-crimson" : delta < -5 ? "text-tactical-green" : "text-muted-foreground";
                          return (
                            <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                              <span className="w-24 text-foreground/60">{tc.metric}</span>
                              <span className="text-muted-foreground">{tc.previous}</span>
                              <span className={color}>→ {tc.current}</span>
                              <span className={`${color} text-[9px]`}>({delta > 0 ? "+" : ""}{delta})</span>
                              <span className="text-[8px] text-muted-foreground/50">{tc.change}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Outlook */}
                  {b.outlook && (
                    <div>
                      <h3 className="text-[10px] font-mono font-bold text-foreground/60 uppercase mb-1">Outlook</h3>
                      <p className="text-[10px] text-foreground/70 leading-relaxed">{b.outlook}</p>
                    </div>
                  )}

                  {/* Recommendations */}
                  {b.recommendations?.length > 0 && (
                    <div>
                      <h3 className="text-[10px] font-mono font-bold text-tactical-green uppercase mb-1.5">Recommendations</h3>
                      <ul className="space-y-1">
                        {b.recommendations.map((rec, i) => (
                          <li key={i} className="text-[10px] text-foreground/70 leading-relaxed flex gap-2">
                            <span className="text-tactical-green shrink-0">{i + 1}.</span>
                            <span>{rec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-[10px] font-mono text-muted-foreground">
                  Select a briefing or generate a new one
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default BriefingViewer;
