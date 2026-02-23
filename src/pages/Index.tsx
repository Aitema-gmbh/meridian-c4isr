import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Dashboard from "@/components/dashboard/Dashboard";

const DEDICATION = "Dedicated to Manos, Ghassan and Fedo";

const ARMCHAIR_CAPTIONS = [
  "ARMCHAIR GENERAL VERSION",
  "COUCH COMMAND EDITION",
  "PAJAMA WARFARE SUITE",
  "STRATEGIC SOFA DIVISION",
  "THREAT LEVEL: SNACKS LOW",
  "CTRL+ALT+DEPLOY",
  "SITUATION ROOM: LIVING ROOM",
  "CLEARANCE: WIFI PASSWORD",
  "INTEL SOURCE: TRUST ME BRO",
  "OPERATIONAL TEMPO: AFTER COFFEE",
];

const InitScreen = ({ onComplete }: { onComplete: () => void }) => {
  const [phase, setPhase] = useState(0);
  const [captionIdx, setCaptionIdx] = useState(() => Math.floor(Math.random() * ARMCHAIR_CAPTIONS.length));

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 3000),
      setTimeout(() => setPhase(3), 5500),
      setTimeout(() => onComplete(), 8000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCaptionIdx(prev => (prev + 1) % ARMCHAIR_CAPTIONS.length);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background scanline"
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8 }}
    >
      {/* Grid background */}
      <div className="absolute inset-0 opacity-5" style={{
        backgroundImage: `linear-gradient(hsl(185 80% 50% / 0.3) 1px, transparent 1px), linear-gradient(90deg, hsl(185 80% 50% / 0.3) 1px, transparent 1px)`,
        backgroundSize: '60px 60px'
      }} />

      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: phase >= 1 ? 1 : 0, scale: phase >= 1 ? 1 : 0.8 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="flex flex-col items-center gap-6"
      >
        {/* Logo / System ID */}
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded border border-primary/50 flex items-center justify-center glow-cyan">
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-primary" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <h1 className="font-sans text-2xl font-bold tracking-wider text-primary text-glow-cyan">
              MERIDIAN C4ISR
            </h1>
            <p className="text-[10px] tracking-[0.3em] text-muted-foreground">
              COMBINED INTELLIGENCE SURVEILLANCE RECONNAISSANCE
            </p>
          </div>
        </div>

        {/* Armchair General Sticker */}
        <motion.div
          initial={{ opacity: 0, scale: 0, rotate: -15 }}
          animate={{
            opacity: phase >= 1 ? 1 : 0,
            scale: phase >= 1 ? 1 : 0,
            rotate: phase >= 1 ? [0, -3, 3, -2, 0] : -15,
          }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="flex flex-col items-center gap-3"
        >
          <div className="relative">
            <img
              src="/armchair-general.png"
              alt="Armchair General"
              className="h-44 w-auto drop-shadow-[0_0_20px_hsl(185,80%,50%,0.5)]"
            />
            <motion.div
              className="absolute -bottom-1 -right-2 bg-amber-500/90 text-black text-[7px] font-bold px-1.5 py-0.5 rounded-sm rotate-12 font-mono"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              v5.0
            </motion.div>
          </div>
          <AnimatePresence mode="wait">
            <motion.p
              key={captionIdx}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4 }}
              className="text-[10px] font-mono tracking-[0.25em] text-amber-400/80"
            >
              ★ {ARMCHAIR_CAPTIONS[captionIdx]} ★
            </motion.p>
          </AnimatePresence>
        </motion.div>

        {/* Status lines */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          className="flex flex-col items-center gap-1 text-xs text-muted-foreground font-mono"
        >
          <span className="text-primary/70">▸ INITIALIZING THREAT MATRIX...</span>
          <span className="text-primary/70">▸ CONNECTING OSINT PIPELINE...</span>
          <span className="text-primary/70">▸ LOADING CENTCOM AOR DATA...</span>
          <span className="text-tactical-green">▸ SYSTEM ONLINE</span>
        </motion.div>

        {/* Loading bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 2 ? 1 : 0 }}
          className="w-64 h-[2px] bg-secondary rounded-full overflow-hidden mt-2"
        >
          <motion.div
            initial={{ width: "0%" }}
            animate={{ width: phase >= 3 ? "100%" : "60%" }}
            transition={{ duration: 1.5, ease: "easeInOut" }}
            className="h-full bg-primary"
          />
        </motion.div>
      </motion.div>

      {/* Dedication */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 2 ? 0.7 : 0 }}
        transition={{ duration: 1.2 }}
        className="absolute bottom-12 text-sm font-sans italic text-primary/60 tracking-wide"
      >
        {DEDICATION}
      </motion.p>
    </motion.div>
  );
};

const Index = () => {
  const [initialized, setInitialized] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <AnimatePresence mode="wait">
        {!initialized && (
          <InitScreen key="init" onComplete={() => setInitialized(true)} />
        )}
      </AnimatePresence>
      {initialized && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        >
          <Dashboard />
        </motion.div>
      )}
    </div>
  );
};

export default Index;
