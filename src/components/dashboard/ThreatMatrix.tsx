import { motion } from "framer-motion";
import tacticalGlobe from "@/assets/tactical-globe.jpg";
import { MOCK_ASSETS } from "@/data/mockData";

const ThreatMatrix = () => {
  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse-glow" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-primary">
            Global Threat Matrix — CENTCOM AOR
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground">GEOINT / LIVE</span>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {/* Globe image */}
        <img
          src={tacticalGlobe}
          alt="Tactical Globe - CENTCOM AOR"
          className="w-full h-full object-cover opacity-80"
        />

        {/* Overlay grid */}
        <div className="absolute inset-0 scanline pointer-events-none" />

        {/* US Asset markers */}
        {MOCK_ASSETS.us.map((asset, i) => (
          <motion.div
            key={asset.id}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 + i * 0.15 }}
            className="absolute group"
            style={{
              left: `${30 + i * 12}%`,
              top: `${35 + (i % 3) * 15}%`,
            }}
          >
            <div className="relative">
              <div className="h-3 w-3 rounded-full bg-primary border border-primary/50 glow-cyan" />
              <div className="absolute -inset-2 rounded-full border border-primary/20 animate-ping" style={{ animationDuration: '3s' }} />
              <div className="absolute left-4 top-[-4px] hidden group-hover:block z-10 bg-panel border border-panel-border px-2 py-1 rounded-sm whitespace-nowrap">
                <p className="text-[10px] text-primary font-mono">{asset.name}</p>
                <p className="text-[9px] text-muted-foreground">{asset.type}</p>
                <p className="text-[9px] text-tactical-green">{asset.status}</p>
              </div>
            </div>
          </motion.div>
        ))}

        {/* Iran Asset markers */}
        {MOCK_ASSETS.iran.map((asset, i) => (
          <motion.div
            key={asset.id}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.8 + i * 0.15 }}
            className="absolute group"
            style={{
              left: `${55 + i * 8}%`,
              top: `${30 + (i % 4) * 12}%`,
            }}
          >
            <div className="relative">
              <div className="h-3 w-3 rotate-45 bg-crimson border border-crimson/50 glow-crimson" />
              <div className="absolute left-4 top-[-4px] hidden group-hover:block z-10 bg-panel border border-panel-border px-2 py-1 rounded-sm whitespace-nowrap">
                <p className="text-[10px] text-crimson font-mono">{asset.name}</p>
                <p className="text-[9px] text-muted-foreground">{asset.type}</p>
                <p className="text-[9px] text-crimson/70">{asset.status}</p>
              </div>
            </div>
          </motion.div>
        ))}

        {/* Legend */}
        <div className="absolute bottom-2 left-2 bg-background/80 border border-panel-border rounded-sm px-2 py-1.5 flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-[9px] text-primary/70 font-mono">US/ALLIED</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rotate-45 bg-crimson" />
            <span className="text-[9px] text-crimson/70 font-mono">HOSTILE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-amber" />
            <span className="text-[9px] text-amber/70 font-mono">UNVERIFIED</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThreatMatrix;
