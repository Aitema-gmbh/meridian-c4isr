import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import ThreatMatrix from "./ThreatMatrix";
import IntelFeed from "./IntelFeed";
import ThreatEngine from "./ThreatEngine";
import NetworkGraph from "./NetworkGraph";
import AIAssistant from "./AIAssistant";
import PredictionMarkets from "./PredictionMarkets";

const DEDICATION = "Dedicated to Manos, Ghassan and Fedo";
const LIVE_INTEL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/live-intel`;
const REDDIT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reddit-intel`;
const MARKETS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/prediction-markets`;

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

const DataTicker = ({ liveData, marketsData, lastAnalyzed }: { liveData: LiveIntelData | null; marketsData: MarketsData | null; lastAnalyzed: string | null }) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const m = liveData?.metadata;
  const topMarket = marketsData?.markets?.[0];
  const agoMinutes = lastAnalyzed ? Math.round((Date.now() - new Date(lastAnalyzed).getTime()) / 60000) : null;
  const items = [
    "CENTCOM AOR: WATCHCON 2",
    agoMinutes !== null ? `LAST AGENT RUN: ${agoMinutes}m AGO` : "AGENT: AWAITING FIRST RUN",
    m ? `ADS-B: ${m.milTrackCount} MIL TRACKS ACTIVE` : "ADS-B: ACQUIRING...",
    m ? `GDELT: ${m.articleCount} CONFLICT ARTICLES (3 STREAMS)` : "GDELT: LOADING...",
    m ? `OSINT SENTIMENT: ${(m.averageSentiment ?? 0).toFixed(2)}` : "OSINT: ANALYZING...",
    m?.dominantCategory ? `DOMINANT THREAT: ${m.dominantCategory}` : "THREAT: CALCULATING...",
    topMarket ? `POLYMARKET: ${topMarket.question.slice(0, 40)}... ${topMarket.yesPrice ?? '?'}%` : "POLYMARKET: LOADING...",
    "MARITIME: AIS GAPS DETECTED — HORMUZ WEST",
    "CYBER: APT CAMPAIGNS ACTIVE",
    "REDDIT: SOCIAL SIGNALS MONITORED",
  ];

  return (
    <div className="flex items-center h-7 bg-panel border-b border-panel-border overflow-hidden">
      <div className="flex items-center gap-2 px-3 border-r border-panel-border shrink-0">
        <div className="h-1.5 w-1.5 rounded-full bg-tactical-green" />
        <span className="text-[10px] font-mono text-tactical-green">LIVE</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <motion.div
          className="flex items-center gap-8 whitespace-nowrap"
          animate={{ x: [0, -2400] }}
          transition={{ duration: 45, repeat: Infinity, ease: "linear" }}
        >
          {[...items, ...items].map((item, i) => (
            <span key={i} className="text-[10px] font-mono text-muted-foreground">
              ▸ {item}
            </span>
          ))}
        </motion.div>
      </div>
      <div className="flex items-center gap-3 px-3 border-l border-panel-border shrink-0">
        <span className="text-[10px] font-mono text-muted-foreground">
          {time.toLocaleTimeString("en-US", { hour12: false })}Z
        </span>
        <span className="text-[10px] font-mono text-primary/50">MERIDIAN v4.0</span>
      </div>
    </div>
  );
};

type TabView = "map" | "network";
type RightTab = "threat" | "markets";

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState<TabView>("map");
  const [rightTab, setRightTab] = useState<RightTab>("threat");
  const [liveData, setLiveData] = useState<LiveIntelData | null>(null);
  const [marketsData, setMarketsData] = useState<MarketsData | null>(null);
  const [intelLoading, setIntelLoading] = useState(false);
  const [marketsLoading, setMarketsLoading] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState<string | null>(null);

  // Load latest data from DB on mount (instant)
  const loadFromDB = useCallback(async () => {
    try {
      const [intelSnap, marketSnap] = await Promise.all([
        supabase.from("intel_snapshots").select("*").order("created_at", { ascending: false }).limit(1),
        supabase.from("market_snapshots").select("*").order("created_at", { ascending: false }).limit(1),
      ]);

      if (intelSnap.data?.[0]) {
        const snap = intelSnap.data[0] as any;
        setLiveData({
          items: (snap.items || []) as IntelItem[],
          flashReport: snap.flash_report,
          metadata: {
            articleCount: snap.article_count || 0,
            milTrackCount: snap.mil_track_count || 0,
            averageSentiment: Number(snap.average_sentiment) || -0.5,
            timestamp: snap.created_at,
            dominantCategory: snap.dominant_category,
          },
        });
        setLastAnalyzed(snap.created_at);
      }

      if (marketSnap.data?.[0]) {
        const snap = marketSnap.data[0] as any;
        setMarketsData({
          markets: (snap.markets || []) as MarketItem[],
          timestamp: snap.created_at,
        });
      }
    } catch (e) {
      console.error("DB load error:", e);
    }
  }, []);

  const fetchLiveIntel = useCallback(async () => {
    setIntelLoading(true);
    try {
      // Fetch GDELT intel + Reddit in parallel
      const [intelResp, redditResp] = await Promise.allSettled([
        fetch(LIVE_INTEL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: JSON.stringify({}),
        }),
        fetch(REDDIT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: JSON.stringify({}),
        }),
      ]);

      let data: LiveIntelData | null = null;

      if (intelResp.status === "fulfilled") {
        const resp = intelResp.value;
        if (resp.status === 429) { toast.error("Rate limit exceeded."); return; }
        if (resp.status === 402) { toast.error("AI credits exhausted."); return; }
        if (resp.ok) data = await resp.json();
      }

      // Merge Reddit items
      if (redditResp.status === "fulfilled" && redditResp.value.ok) {
        try {
          const redditData = await redditResp.value.json();
          const redditItems = (redditData.items || []) as IntelItem[];
          if (data) {
            data.items = [...data.items, ...redditItems];
          } else {
            data = {
              items: redditItems,
              flashReport: null,
              metadata: { articleCount: 0, milTrackCount: 0, averageSentiment: 0, timestamp: new Date().toISOString() },
            };
          }
        } catch {}
      }

      if (data) setLiveData(data);
    } catch (e) {
      console.error("Live intel error:", e);
      toast.error("Failed to fetch live intelligence.");
    } finally {
      setIntelLoading(false);
    }
  }, []);

  const fetchMarkets = useCallback(async () => {
    setMarketsLoading(true);
    try {
      const resp = await fetch(MARKETS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
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
    // Fetch fresh data immediately, load DB in parallel as fallback
    fetchLiveIntel();
    fetchMarkets();
    loadFromDB(); // fills in if live fetches are slow
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
          <span className="text-[10px] font-mono text-muted-foreground">C4ISR INTELLIGENCE PLATFORM</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("map")}
            className={`text-[10px] font-mono px-3 py-1 rounded-sm border transition-colors ${
              activeTab === "map"
                ? "border-primary/50 text-primary bg-primary/10"
                : "border-panel-border text-muted-foreground hover:text-foreground"
            }`}
          >
            THREAT MATRIX
          </button>
          <button
            onClick={() => setActiveTab("network")}
            className={`text-[10px] font-mono px-3 py-1 rounded-sm border transition-colors ${
              activeTab === "network"
                ? "border-primary/50 text-primary bg-primary/10"
                : "border-panel-border text-muted-foreground hover:text-foreground"
            }`}
          >
            NETWORK GRAPH
          </button>
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
              {activeTab === "map" ? <ThreatMatrix /> : <NetworkGraph />}
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
            <AnimatePresence mode="wait">
              {rightTab === "threat" ? (
                <motion.div key="threat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                  <ThreatEngine liveMetadata={liveData?.metadata || null} marketData={marketsData?.markets || []} />
                </motion.div>
              ) : (
                <motion.div key="markets" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full">
                  <PredictionMarkets markets={marketsData?.markets || []} loading={marketsLoading} onRefresh={fetchMarkets} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Bottom right: AI Assistant */}
          <div className="h-[40%] border-t border-panel-border overflow-hidden">
            <AIAssistant liveData={liveData} marketsData={marketsData} />
          </div>
        </div>
      </div>

      {/* Dedication watermark */}
      <div className="fixed bottom-2 right-3 z-50">
        <span className="text-[9px] font-sans italic text-primary/30 tracking-wide">
          {DEDICATION}
        </span>
      </div>
    </div>
  );
};

export default Dashboard;
