import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import ThreatMatrix from "./ThreatMatrix";
import IntelFeed from "./IntelFeed";
import ThreatEngine from "./ThreatEngine";
import NetworkGraph from "./NetworkGraph";
import AIAssistant from "./AIAssistant";
import PredictionMarkets from "./PredictionMarkets";

const DEDICATION = "Dedicated to Manos, Ghassan and Fedo";
const LIVE_INTEL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/live-intel`;
const MARKETS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/prediction-markets`;

interface IntelItem {
  id: number;
  timestamp: string;
  source: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  content: string;
  entities: string[];
  sentiment: number;
  threat_tag?: string;
  confidence?: string;
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
}

interface MarketsData {
  markets: MarketItem[];
  timestamp: string;
}

const DataTicker = ({ liveData, marketsData }: { liveData: LiveIntelData | null; marketsData: MarketsData | null }) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const m = liveData?.metadata;
  const topMarket = marketsData?.markets?.[0];
  const items = [
    "CENTCOM AOR: WATCHCON 2",
    m ? `ADS-B: ${m.milTrackCount} MIL TRACKS ACTIVE` : "ADS-B: ACQUIRING...",
    m ? `GDELT: ${m.articleCount} CONFLICT ARTICLES (3 STREAMS)` : "GDELT: LOADING...",
    m ? `OSINT SENTIMENT: ${m.averageSentiment.toFixed(2)}` : "OSINT: ANALYZING...",
    m?.dominantCategory ? `DOMINANT THREAT: ${m.dominantCategory}` : "THREAT: CALCULATING...",
    topMarket ? `POLYMARKET TOP: ${topMarket.question.slice(0, 40)}... ${topMarket.yesPrice ?? '?'}%` : "POLYMARKET: LOADING...",
    "MARITIME: AIS GAPS DETECTED — HORMUZ WEST",
    "CYBER: APT CAMPAIGNS ACTIVE",
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
          animate={{ x: [0, -2000] }}
          transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
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
        <span className="text-[10px] font-mono text-primary/50">MERIDIAN v3.0</span>
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

  const fetchLiveIntel = useCallback(async () => {
    setIntelLoading(true);
    try {
      const resp = await fetch(LIVE_INTEL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({}),
      });
      if (resp.status === 429) { toast.error("Rate limit exceeded."); return; }
      if (resp.status === 402) { toast.error("AI credits exhausted."); return; }
      if (!resp.ok) throw new Error("Live intel fetch failed");
      const data: LiveIntelData = await resp.json();
      setLiveData(data);
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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
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
    fetchLiveIntel();
    fetchMarkets();
    const intelInterval = setInterval(fetchLiveIntel, 300000);
    const marketsInterval = setInterval(fetchMarkets, 120000);
    return () => { clearInterval(intelInterval); clearInterval(marketsInterval); };
  }, [fetchLiveIntel, fetchMarkets]);

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
      <DataTicker liveData={liveData} marketsData={marketsData} />

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
              MARKETS
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
