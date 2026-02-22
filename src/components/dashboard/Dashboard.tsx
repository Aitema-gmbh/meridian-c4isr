import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import ThreatMatrix from "./ThreatMatrix";
import IntelFeed from "./IntelFeed";
import ThreatEngine from "./ThreatEngine";
import NetworkGraph from "./NetworkGraph";
import AIAssistant from "./AIAssistant";

const DEDICATION = "Dedicated to Manos, Ghassan and Fedo";

const DataTicker = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const items = [
    "CENTCOM AOR: WATCHCON 2",
    "HORMUZ TRANSIT: 3 VLCC DIVERTED",
    "ADS-B: 14 MIL TRACKS ACTIVE",
    "CYBER: 2 APT CAMPAIGNS DETECTED",
    "OSINT: 847 CONFLICT EVENTS/6HR",
    "MARITIME: AIS GAPS DETECTED — HORMUZ WEST",
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
          animate={{ x: [0, -1500] }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
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
        <span className="text-[10px] font-mono text-primary/50">MERIDIAN v2.6.1</span>
      </div>
    </div>
  );
};

type TabView = "map" | "network";

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState<TabView>("map");

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
      <DataTicker />

      {/* Main content */}
      <div className="flex-1 grid grid-cols-12 gap-px bg-panel-border overflow-hidden">
        {/* Left: Main view */}
        <div className="col-span-7 bg-background">
          {activeTab === "map" ? <ThreatMatrix /> : <NetworkGraph />}
        </div>

        {/* Right panels */}
        <div className="col-span-5 flex flex-col bg-background">
          <div className="flex-1 grid grid-rows-2 gap-px bg-panel-border">
            {/* Intel Feed */}
            <div className="bg-background overflow-hidden">
              <IntelFeed />
            </div>
            {/* Bottom right: Threat Engine + AI */}
            <div className="bg-background grid grid-cols-2 gap-px bg-panel-border overflow-hidden">
              <div className="bg-background overflow-hidden">
                <ThreatEngine />
              </div>
              <div className="bg-background overflow-hidden">
                <AIAssistant />
              </div>
            </div>
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
