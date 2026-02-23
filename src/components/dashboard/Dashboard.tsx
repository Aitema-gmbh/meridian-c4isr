import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import IntelFeed from "./IntelFeed";

const ThreatMatrix = lazy(() => import("./ThreatMatrix"));
const ThreatEngine = lazy(() => import("./ThreatEngine"));
const NetworkGraph = lazy(() => import("./NetworkGraph"));
const AIAssistant = lazy(() => import("./AIAssistant"));
const PredictionMarkets = lazy(() => import("./PredictionMarkets"));
const AgentStatusPanel = lazy(() => import("./AgentStatusPanel"));
const SignalTimeline = lazy(() => import("./SignalTimeline"));
const CountryBrief = lazy(() => import("./CountryBrief"));
const PatternMatch = lazy(() => import("./PatternMatch"));
const BriefingViewer = lazy(() => import("./BriefingViewer"));

const DEDICATION = "Dedicated to Manos, Ghassan and Fedo";
const API_BASE = import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev";
const LIVE_INTEL_URL = `${API_BASE}/live-intel`;
const REDDIT_URL = `${API_BASE}/reddit-intel`;
const MARKETS_URL = `${API_BASE}/prediction-markets`;

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
}

interface LiveIntelData {
  items: IntelItem[];
  flashReport?: string | null;
  metadata: {
    articleCount: number;
    milTrackCount: number;
    averageSentiment: number;
    timestamp: string;
    dominantCategory?: string;
  };
}

interface MarketItem {
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

interface MarketsData {
  markets: MarketItem[];
  timestamp: string;
}

interface TickerAssessment {
  tension_index: number;
  watchcon: string;
  hormuz_closure: number;
  created_at: string;
}

const LazyFallback = ({ label }: { label: string }) => (
  <div className="h-full flex items-center justify-center bg-background scanline">
    <div className="flex flex-col items-center gap-2">
      <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      <span className="text-[9px] font-mono text-primary/60 tracking-widest uppercase">{label}</span>
      <div className="w-16 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
    </div>
  </div>
);

const DataTicker = ({ liveData, marketsData, lastAnalyzed }: { liveData: LiveIntelData | null; marketsData: MarketsData | null; lastAnalyzed: string | null }) => {
  const [time, setTime] = useState(new Date());
  const [assessment, setAssessment] = useState<TickerAssessment | null>(null);
  const [agentCount, setAgentCount] = useState(0);
  const [alertItems, setAlertItems] = useState<string[]>([]);

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch latest assessment + agent stats for ticker
  useEffect(() => {
    const loadTickerData = async () => {
      try {
        const [assessRes, reportsRes] = await Promise.allSettled([
          apiFetch<{ assessments: Record<string, unknown>[] }>("/api/threat-assessments", { limit: "1" }),
          apiFetch<{ reports: Record<string, unknown>[] }>("/api/agent-reports", { hours: "3" }),
        ]);

        if (assessRes.status === "fulfilled" && assessRes.value.assessments?.[0]) {
          const a = assessRes.value.assessments[0];
          setAssessment({
            tension_index: Number(a.tension_index) || 0,
            watchcon: String(a.watchcon || "?"),
            hormuz_closure: Number(a.hormuz_closure) || 0,
            created_at: String(a.created_at || ""),
          });
        }

        if (reportsRes.status === "fulfilled" && reportsRes.value.reports) {
          const reports = reportsRes.value.reports;
          const agents = new Set(reports.map((r: Record<string, unknown>) => r.agent_name));
          setAgentCount(agents.size);

          // Find elevated agents
          const elevated = reports.filter((r: Record<string, unknown>) =>
            Number(r.threat_level) > 60 && r.agent_name !== "head-analyst"
          );
          const uniqueElevated = [...new Set(elevated.map((r: Record<string, unknown>) => String(r.agent_name)))];
          if (uniqueElevated.length >= 3) {
            setAlertItems([`CONVERGENCE: ${uniqueElevated.length} AGENTS ELEVATED (${uniqueElevated.map(n => n.toUpperCase()).join(", ")})`]);
          }
        }
      } catch {}
    };
    loadTickerData();
    const interval = setInterval(loadTickerData, 60000);
    return () => clearInterval(interval);
  }, []);

  const m = liveData?.metadata;
  const topMarket = marketsData?.markets?.[0];
  const agoMinutes = lastAnalyzed ? Math.round((Date.now() - new Date(lastAnalyzed).getTime()) / 60000) : null;
  const ti = assessment?.tension_index || 0;
  const wc = assessment?.watchcon || "?";

  const items = [
    `TENSION INDEX: ${ti}/100 | WATCHCON ${wc}`,
    `AGENTS: ${agentCount}/15 ACTIVE`,
    agoMinutes !== null ? `LAST INTEL: ${agoMinutes}m AGO` : "INTEL: AWAITING",
    ...alertItems,
    m ? `ADS-B: ${m.milTrackCount} MIL TRACKS` : "ADS-B: ACQUIRING",
    m ? `GDELT: ${m.articleCount} ARTICLES` : "GDELT: LOADING",
    m ? `SENTIMENT: ${(m.averageSentiment ?? 0).toFixed(2)}` : "",
    topMarket?.question ? `MKT: ${topMarket.question.slice(0, 35)}... ${topMarket.yesPrice ?? '?'}%` : "",
    `HORMUZ: ${assessment?.hormuz_closure || 0}%`,
    `14 SOURCES: ADS-B | GDELT | POLYMARKET | REDDIT | TELEGRAM | ACLED | PENTAGON | CYBER | WIKIMEDIA | FIRMS | MACRO`,
  ].filter(Boolean);

  const wcColor = parseInt(wc) <= 2 ? "text-crimson" : parseInt(wc) <= 3 ? "text-amber" : "text-tactical-green";

  return (
    <div className="flex items-center h-7 bg-panel border-b border-panel-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 border-r border-panel-border shrink-0">
        <div className={`h-1.5 w-1.5 rounded-full ${ti > 70 ? "bg-crimson animate-pulse" : "bg-tactical-green"}`} />
        <span className={`text-[10px] font-mono font-bold ${wcColor}`}>WC-{wc}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <motion.div
          className="flex items-center gap-8 whitespace-nowrap"
          animate={{ x: [0, -3000] }}
          transition={{ duration: 50, repeat: Infinity, ease: "linear" }}
        >
          {[...items, ...items].map((item, i) => (
            <span key={i} className={`text-[10px] font-mono ${
              item.includes("CONVERGENCE") ? "text-crimson font-bold" :
              item.includes("TENSION") ? (ti > 70 ? "text-crimson" : "text-amber") :
              "text-muted-foreground"
            }`}>
              ▸ {item}
            </span>
          ))}
        </motion.div>
      </div>
      <div className="flex items-center gap-3 px-3 border-l border-panel-border shrink-0">
        <span className={`text-[10px] font-mono font-bold ${ti > 70 ? "text-crimson" : ti > 40 ? "text-amber" : "text-tactical-green"}`}>
          TI:{ti}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground">
          {time.toLocaleTimeString("en-US", { hour12: false })}Z
        </span>
        <span className="text-[10px] font-mono text-primary/50">v5.0</span>
      </div>
    </div>
  );
};

type TabView = "map" | "agents" | "timeline" | "countries" | "patterns";
type RightTab = "threat" | "markets";

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState<TabView>("map");
  const [rightTab, setRightTab] = useState<RightTab>("threat");
  const [liveData, setLiveData] = useState<LiveIntelData | null>(null);
  const [marketsData, setMarketsData] = useState<MarketsData | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<string | null>(null);
  const [apiHealthy, setApiHealthy] = useState<boolean | null>(null);
  const [showBriefing, setShowBriefing] = useState(false);

  // Keyboard shortcuts: 1-5 to switch tabs
  useEffect(() => {
    const tabKeys: Record<string, TabView> = {
      "1": "map",
      "2": "agents",
      "3": "timeline",
      "4": "countries",
      "5": "patterns",
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in input/textarea/contenteditable
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      const tab = tabKeys[e.key];
      if (tab) setActiveTab(tab);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // API health check: ping every 30s
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await apiFetch<{ assessments: Record<string, unknown>[] }>("/api/threat-assessments", { limit: "1" });
        setApiHealthy(!!res?.assessments);
      } catch {
        setApiHealthy(false);
      }
    };
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  // Load latest data from DB on mount (instant)
  const loadFromDB = useCallback(async () => {
    try {
      const snap = await apiFetch<{ items?: IntelItem[]; flashReport?: string | null; metadata?: Record<string, unknown>; snapshotTime?: string }>("/api/intel-snapshot").catch(() => null);
      if (snap?.items?.length) {
        setLiveData({
          items: snap.items,
          flashReport: snap.flashReport ?? null,
          metadata: {
            articleCount: Number((snap.metadata as Record<string, unknown>)?.articleCount) || 0,
            milTrackCount: Number((snap.metadata as Record<string, unknown>)?.milTrackCount) || 0,
            averageSentiment: Number((snap.metadata as Record<string, unknown>)?.averageSentiment) || -0.5,
            timestamp: String((snap.metadata as Record<string, unknown>)?.timestamp || snap.snapshotTime || ""),
            dominantCategory: String((snap.metadata as Record<string, unknown>)?.dominantCategory || ""),
          },
        });
        if (snap.snapshotTime) setLastAnalyzed(snap.snapshotTime);
      }

      // Skip DB fallback for markets — stale data causes irrelevant threat analysis
      // Markets are only loaded from fresh API calls
    } catch (e) {
      console.error("DB load error:", e);
    }
  }, []);

  const fetchLiveIntel = useCallback(async () => {
    setIntelLoading(true);
    try {
      // Try fetching fresh data, but don't fail if credits exhausted
      const [intelResp, redditResp] = await Promise.allSettled([
        fetch(LIVE_INTEL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ""}` },
          body: JSON.stringify({}),
        }),
        fetch(REDDIT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ""}` },
          body: JSON.stringify({}),
        }),
      ]);

      let data: LiveIntelData | null = null;

      if (intelResp.status === "fulfilled") {
        const resp = intelResp.value;
        if (resp.status === 429) { toast.error("Rate limit exceeded. Using cached data."); }
        else if (resp.status === 402) { toast.error("AI credits exhausted. Showing cached intel from database."); }
        else if (resp.ok) data = await resp.json();
      }

      // Merge Reddit items (Reddit doesn't need AI credits)
      if (redditResp.status === "fulfilled" && redditResp.value.ok) {
        try {
          const redditData = await redditResp.value.json();
          const redditItems = (redditData.items || []) as IntelItem[];
          if (data) {
            data.items = [...data.items, ...redditItems];
          } else if (redditItems.length > 0) {
            data = {
              items: redditItems,
              flashReport: null,
              metadata: { articleCount: 0, milTrackCount: 0, averageSentiment: 0, timestamp: new Date().toISOString() },
            };
          }
        } catch {}
      }

      // Only update if we got fresh data; otherwise keep DB-loaded data
      if (data) setLiveData(data);
    } catch (e) {
      console.error("Live intel error:", e);
      // Don't show error toast - we already have DB data
    } finally {
      setIntelLoading(false);
    }
  }, []);

  const fetchMarkets = useCallback(async () => {
    setMarketsLoading(true);
    try {
      const resp = await fetch(MARKETS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ""}` },
        body: JSON.stringify({}),
      });
      if (!resp.ok) throw new Error("Markets fetch failed");
      const data: MarketsData = await resp.json();
      setMarketsData(data);
    } catch (e) {
      console.error("Markets error:", e);
    } finally {
      setMarketsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Load DB data first (instant, no credits needed), then try live API as enhancement
    loadFromDB().then(() => {
      fetchLiveIntel();
      fetchMarkets();
    });
    const intelInterval = setInterval(fetchLiveIntel, 300000);
    const marketsInterval = setInterval(fetchMarkets, 120000);
    return () => { clearInterval(intelInterval); clearInterval(marketsInterval); };
  }, [loadFromDB, fetchLiveIntel, fetchMarkets]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between h-10 px-4 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            <span className="font-sans text-sm font-bold tracking-wider text-primary">MERIDIAN</span>
          </div>
          <div className="h-4 w-px bg-panel-border" />
          <span className="text-[10px] font-mono text-muted-foreground tracking-widest">C4ISR INTELLIGENCE PLATFORM</span>
        </div>

        <div className="flex items-center gap-2">
          {([
            { key: "map", label: "THREAT MATRIX", shortcut: "1" },
            { key: "agents", label: "AGENTS", shortcut: "2" },
            { key: "timeline", label: "TIMELINE", shortcut: "3" },
            { key: "countries", label: "CII", shortcut: "4" },
            { key: "patterns", label: "PATTERNS", shortcut: "5" },
          ] as { key: TabView; label: string; shortcut: string }[]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`text-[10px] font-mono px-3 py-1 rounded-sm border transition-colors ${
                activeTab === tab.key
                  ? "border-primary/50 text-primary bg-primary/10"
                  : "border-panel-border text-muted-foreground hover:text-foreground"
              }`}
              title={`${tab.label} (${tab.shortcut})`}
            >
              {tab.label}
            </button>
          ))}
          <div className="h-4 w-px bg-panel-border ml-1" />
          <button
            onClick={() => setShowBriefing(true)}
            className="text-[9px] font-mono px-2 py-0.5 rounded-sm border border-amber/30 text-amber hover:bg-amber/10 transition-colors ml-1"
            title="Intelligence Briefings"
          >
            BRIEFINGS
          </button>
          <div className="h-4 w-px bg-panel-border ml-1" />
          <div className="flex items-center gap-1.5 ml-1" title={apiHealthy === null ? "API: checking..." : apiHealthy ? "API: healthy" : "API: unreachable"}>
            <div className={`h-2 w-2 rounded-full ${
              apiHealthy === null
                ? "bg-muted-foreground animate-pulse"
                : apiHealthy
                  ? "bg-tactical-green"
                  : "bg-crimson animate-pulse"
            }`} />
            <span className="text-[9px] font-mono text-muted-foreground">API</span>
          </div>
        </div>
      </div>

      {/* Data ticker */}
      <DataTicker liveData={liveData} marketsData={marketsData} lastAnalyzed={lastAnalyzed} />

      {/* Main content - 3 column layout */}
      <div className="flex-1 grid grid-cols-12 gap-px bg-panel-border overflow-hidden">
        {/* Left: Main view (50%) */}
        <div className="col-span-6 bg-background">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="h-full"
            >
              <Suspense fallback={<LazyFallback label="LOADING MODULE" />}>
                <ErrorBoundary fallbackLabel={activeTab.toUpperCase()}>
                  {activeTab === "map" && <ThreatMatrix />}
                  {activeTab === "agents" && <AgentStatusPanel />}
                  {activeTab === "timeline" && <SignalTimeline />}
                  {activeTab === "countries" && <CountryBrief />}
                  {activeTab === "patterns" && <PatternMatch />}
                </ErrorBoundary>
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Center: Intel Feed (25%) */}
        <div className="col-span-3 bg-background overflow-hidden">
          <IntelFeed
            items={liveData?.items || []}
            loading={intelLoading}
            onRefresh={fetchLiveIntel}
            flashReport={liveData?.flashReport}
          />
        </div>

        {/* Right: Panels (25%) */}
        <div className="col-span-3 flex flex-col bg-background overflow-hidden">
          {/* Sub-tabs for right panel top section */}
          <div className="flex items-center border-b border-panel-border bg-panel-header shrink-0">
            <button
              onClick={() => setRightTab("threat")}
              className={`flex-1 text-[9px] font-mono py-1.5 transition-colors ${
                rightTab === "threat"
                  ? "text-crimson border-b border-crimson bg-crimson/5"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              THREAT ENGINE
            </button>
            <button
              onClick={() => setRightTab("markets")}
              className={`flex-1 text-[9px] font-mono py-1.5 transition-colors ${
                rightTab === "markets"
                  ? "text-tactical-green border-b border-tactical-green bg-tactical-green/5"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              IRAN MARKETS
            </button>
          </div>

          {/* Top right: Threat Engine or Markets */}
          <div className="flex-1 overflow-hidden min-h-0">
            <Suspense fallback={<LazyFallback label="LOADING" />}>
              <AnimatePresence mode="wait">
                {rightTab === "threat" ? (
                  <motion.div key="threat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                    <ErrorBoundary fallbackLabel="THREAT ENGINE">
                      <ThreatEngine liveMetadata={liveData?.metadata || null} marketData={marketsData?.markets || []} />
                    </ErrorBoundary>
                  </motion.div>
                ) : (
                  <motion.div key="markets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                    <ErrorBoundary fallbackLabel="MARKETS">
                      <PredictionMarkets markets={marketsData?.markets || []} loading={marketsLoading} onRefresh={fetchMarkets} />
                    </ErrorBoundary>
                  </motion.div>
                )}
              </AnimatePresence>
            </Suspense>
          </div>

          {/* Bottom right: AI Assistant */}
          <div className="h-[40%] border-t border-panel-border overflow-hidden">
            <Suspense fallback={<LazyFallback label="AI ASSISTANT" />}>
              <ErrorBoundary fallbackLabel="AI ASSISTANT">
                <AIAssistant liveData={liveData} marketsData={marketsData} />
              </ErrorBoundary>
            </Suspense>
          </div>
        </div>
      </div>

      {/* Dedication watermark */}
      <div className="fixed bottom-2 right-3 z-50">
        <span className="text-[9px] font-sans italic text-primary/30 tracking-wide">
          {DEDICATION}
        </span>
      </div>

      {/* Briefing Modal */}
      <Suspense fallback={null}>
        <BriefingViewer isOpen={showBriefing} onClose={() => setShowBriefing(false)} />
      </Suspense>
    </div>
  );
};

export default Dashboard;
