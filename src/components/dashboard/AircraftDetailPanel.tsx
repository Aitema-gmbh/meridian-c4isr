import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Camera } from "lucide-react";
import { type AircraftData, getAircraftColor, getAircraftCategory } from "./ThreatMatrix";

interface AircraftDetailPanelProps {
  aircraft: AircraftData | null;
  altHistory: { time: string; alt: number }[];
  onClose: () => void;
}

const AircraftDetailPanel = ({ aircraft, altHistory, onClose }: AircraftDetailPanelProps) => {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoCredit, setPhotoCredit] = useState<string>("");
  const [photoLoading, setPhotoLoading] = useState(false);

  useEffect(() => {
    if (!aircraft) { setPhotoUrl(null); return; }
    setPhotoLoading(true);
    setPhotoUrl(null);
    const hex = aircraft.hex;
    fetch(`https://api.planespotters.net/pub/photos/hex/${hex}`)
      .then(r => r.json())
      .then(data => {
        if (data.photos?.length > 0) {
          setPhotoUrl(data.photos[0].thumbnail_large?.src || data.photos[0].thumbnail?.src || null);
          setPhotoCredit(data.photos[0].photographer || "");
        }
      })
      .catch(() => {})
      .finally(() => setPhotoLoading(false));
  }, [aircraft?.hex]);

  if (!aircraft) return null;

  const color = getAircraftColor(aircraft.t);
  const category = getAircraftCategory(aircraft.t);
  const callsign = aircraft.flight?.trim() || aircraft.hex;
  const altFt = aircraft.alt_baro === "ground" ? 0 : typeof aircraft.alt_baro === "number" ? aircraft.alt_baro : 0;
  const maxAlt = Math.max(...altHistory.map(h => h.alt), altFt, 1000);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: 300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 300, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="absolute top-0 right-0 bottom-0 w-[260px] z-[1001] bg-background/95 border-l border-panel-border backdrop-blur-sm overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" width="16" height="16" style={{ transform: `rotate(${aircraft.track ?? 0}deg)`, filter: `drop-shadow(0 0 3px ${color}80)` }}>
              <path d="M12 2 L15 10 L20 12 L15 14 L15 20 L12 18 L9 20 L9 14 L4 12 L9 10 Z" fill={color} fillOpacity={0.9} stroke={color} strokeWidth="0.5" />
            </svg>
            <span className="text-[11px] font-mono font-bold" style={{ color }}>{callsign}</span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Aircraft Photo */}
        <div className="border-b border-panel-border">
          {photoLoading ? (
            <div className="h-[100px] flex items-center justify-center bg-muted/20">
              <Camera className="h-4 w-4 text-muted-foreground animate-pulse" />
            </div>
          ) : photoUrl ? (
            <div className="relative">
              <img src={photoUrl} alt={callsign} className="w-full h-[100px] object-cover" />
              {photoCredit && (
                <span className="absolute bottom-0.5 right-1 text-[7px] font-mono text-white/60 bg-black/50 px-1 rounded">
                  © {photoCredit}
                </span>
              )}
            </div>
          ) : (
            <div className="h-[60px] flex items-center justify-center bg-muted/10">
              <span className="text-[8px] font-mono text-muted-foreground">NO PHOTO AVAILABLE</span>
            </div>
          )}
        </div>

        {/* Info rows */}
        <div className="px-3 py-2 space-y-1.5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-2">AIRCRAFT DATA</div>
          <InfoRow label="CALLSIGN" value={callsign} color={color} />
          <InfoRow label="HEX" value={aircraft.hex.toUpperCase()} />
          <InfoRow label="CATEGORY" value={category} color={color} />
          {aircraft.t && <InfoRow label="TYPE" value={aircraft.t} />}
          {aircraft.r && <InfoRow label="REGISTRATION" value={aircraft.r} />}
        </div>

        <div className="border-t border-panel-border px-3 py-2 space-y-1.5">
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-2">FLIGHT DATA</div>
          <InfoRow label="ALTITUDE" value={aircraft.alt_baro === "ground" ? "GROUND" : `FL${Math.round(altFt / 100)} (${altFt.toLocaleString()} ft)`} />
          {aircraft.gs != null && <InfoRow label="GROUND SPEED" value={`${Math.round(aircraft.gs)} kts`} />}
          {aircraft.track != null && <InfoRow label="HEADING" value={`${Math.round(aircraft.track)}°`} />}
          {aircraft.lat != null && <InfoRow label="POSITION" value={`${aircraft.lat.toFixed(4)}° ${aircraft.lon?.toFixed(4)}°`} />}
        </div>

        {/* Altitude History Chart */}
        {altHistory.length > 1 && (
          <div className="border-t border-panel-border px-3 py-2">
            <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-2">ALTITUDE HISTORY</div>
            <div className="h-[80px] relative bg-background/50 border border-panel-border rounded-sm p-1">
              <svg viewBox={`0 0 ${altHistory.length * 12} 70`} className="w-full h-full" preserveAspectRatio="none">
                {/* Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                  <line key={pct} x1="0" y1={70 - pct * 65} x2={altHistory.length * 12} y2={70 - pct * 65}
                    stroke="hsl(var(--muted-foreground))" strokeOpacity="0.15" strokeWidth="0.5" />
                ))}
                {/* Line */}
                <polyline
                  fill="none"
                  stroke={color}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  points={altHistory.map((h, i) => `${i * 12 + 6},${70 - (h.alt / maxAlt) * 65}`).join(" ")}
                />
                {/* Area fill */}
                <polygon
                  fill={color}
                  fillOpacity="0.1"
                  points={`0,70 ${altHistory.map((h, i) => `${i * 12 + 6},${70 - (h.alt / maxAlt) * 65}`).join(" ")} ${(altHistory.length - 1) * 12 + 6},70`}
                />
                {/* Current point */}
                <circle
                  cx={(altHistory.length - 1) * 12 + 6}
                  cy={70 - (altHistory[altHistory.length - 1].alt / maxAlt) * 65}
                  r="2.5" fill={color}
                />
              </svg>
              {/* Labels */}
              <div className="absolute top-0 right-1 text-[7px] font-mono text-muted-foreground">
                FL{Math.round(maxAlt / 100)}
              </div>
              <div className="absolute bottom-0 right-1 text-[7px] font-mono text-muted-foreground">
                0
              </div>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[7px] font-mono text-muted-foreground">{altHistory[0]?.time}</span>
              <span className="text-[7px] font-mono text-muted-foreground">{altHistory[altHistory.length - 1]?.time}</span>
            </div>
          </div>
        )}

        {/* Status */}
        <div className="border-t border-panel-border px-3 py-2">
          <div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground mb-1">STATUS</div>
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: color }} />
            <span className="text-[10px] font-mono" style={{ color }}>TRACKING — LIVE ADS-B</span>
          </div>
          <p className="text-[8px] text-muted-foreground mt-1 font-mono">
            Updates every 30s • {altHistory.length} data points collected
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

const InfoRow = ({ label, value, color }: { label: string; value: string; color?: string }) => (
  <div className="flex justify-between items-baseline">
    <span className="text-[9px] font-mono text-muted-foreground">{label}</span>
    <span className="text-[10px] font-mono font-medium" style={color ? { color } : undefined}>
      {value}
    </span>
  </div>
);

export default AircraftDetailPanel;
