import { useState, useEffect, useCallback, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MOCK_ASSETS } from "@/data/mockData";
import AircraftDetailPanel from "./AircraftDetailPanel";

interface AircraftData {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  t?: string;
  category?: string;
  r?: string;
  dbFlags?: number;
}

const GULF_BOUNDS = { latMin: -90, latMax: 90, lngMin: -180, lngMax: 180 };

const getAircraftColor = (type?: string): string => {
  if (!type) return "#ffffff";
  const t = type.toUpperCase();
  if (["C17", "C30J", "C130", "A400", "KC135", "KC10", "KC46", "C5", "C40", "C37", "C32", "C12", "C2"].some(x => t.includes(x))) return "#00d4ff";
  if (["E3", "E8", "RC135", "P8", "EP3", "E6", "E2", "RQ4", "MQ9", "MQ4", "U2", "AWACS"].some(x => t.includes(x))) return "#ffaa00";
  if (["H60", "NH90", "A139", "H53", "H47", "V22", "CH47", "UH60", "AH64", "H1"].some(x => t.includes(x))) return "#44ff88";
  if (["F15", "F16", "F18", "F22", "F35", "FA18", "EF2K", "EUFI", "TYPH", "RFAL", "B1", "B2", "B52"].some(x => t.includes(x))) return "#ff6644";
  return "#ffffff";
};

const getAircraftCategory = (type?: string): string => {
  if (!type) return "UNKNOWN";
  const t = type.toUpperCase();
  if (["C17", "C30J", "C130", "A400", "KC135", "KC10", "KC46", "C5", "C40"].some(x => t.includes(x))) return "TRANSPORT";
  if (["E3", "E8", "RC135", "P8", "EP3", "RQ4", "MQ9", "U2"].some(x => t.includes(x))) return "ISR/TANKER";
  if (["H60", "NH90", "A139", "H53", "H47", "V22", "CH47", "AH64"].some(x => t.includes(x))) return "ROTARY";
  if (["F15", "F16", "F18", "F22", "F35", "B1", "B2", "B52"].some(x => t.includes(x))) return "FIGHTER/BOMBER";
  return "MIL";
};

const createAircraftIcon = (ac: AircraftData): L.DivIcon => {
  const color = getAircraftColor(ac.t);
  const rotation = ac.track ?? 0;
  const callsign = ac.flight?.trim() || "";
  const alt = ac.alt_baro === "ground" ? "GND" : ac.alt_baro ? `${Math.round(Number(ac.alt_baro) / 100)}` : "";

  const html = `
    <div style="position:relative;width:24px;height:24px;cursor:pointer;">
      <svg viewBox="0 0 24 24" width="24" height="24" style="transform:rotate(${rotation}deg);filter:drop-shadow(0 0 3px ${color}80);">
        <path d="M12 2 L15 10 L20 12 L15 14 L15 20 L12 18 L9 20 L9 14 L4 12 L9 10 Z" 
              fill="${color}" fill-opacity="0.9" stroke="${color}" stroke-width="0.5"/>
      </svg>
      ${callsign ? `<span style="position:absolute;left:26px;top:2px;font-family:'JetBrains Mono',monospace;font-size:8px;color:${color};white-space:nowrap;text-shadow:0 0 4px rgba(0,0,0,0.9);opacity:0.85;">${callsign}${alt ? " " + alt : ""}</span>` : ""}
    </div>
  `;

  return L.divIcon({ html, className: "", iconSize: [24, 24], iconAnchor: [12, 12] });
};

const buildAircraftTooltip = (ac: AircraftData) => {
  const color = getAircraftColor(ac.t);
  const cat = getAircraftCategory(ac.t);
  let html = `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;line-height:1.4">`;
  html += `<div style="color:${color};font-weight:600">${ac.flight?.trim() || ac.hex}</div>`;
  html += `<div style="color:#666;font-size:8px">${cat}</div>`;
  if (ac.r) html += `<div style="color:#999">REG: ${ac.r}</div>`;
  if (ac.t) html += `<div style="color:#999">TYPE: ${ac.t}</div>`;
  if (ac.alt_baro) html += `<div style="color:#999">ALT: ${ac.alt_baro === "ground" ? "GND" : `FL${Math.round(Number(ac.alt_baro) / 100)}`}</div>`;
  if (ac.gs) html += `<div style="color:#999">SPD: ${Math.round(ac.gs)} kts</div>`;
  if (ac.track != null) html += `<div style="color:#999">HDG: ${Math.round(ac.track)}°</div>`;
  html += `</div>`;
  return html;
};

const buildAssetTooltip = (name: string, type: string, status: string, color: string, statusColor: string) => {
  return `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;line-height:1.4">
    <div style="color:${color};font-weight:600">${name}</div>
    <div style="color:#999">${type}</div>
    <div style="color:${statusColor}">${status}</div>
  </div>`;
};

export type { AircraftData };
export { getAircraftColor, getAircraftCategory };

const ThreatMatrix = () => {
  const [trackCount, setTrackCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<AircraftData | null>(null);
  const [altHistory, setAltHistory] = useState<{ time: string; alt: number }[]>([]);
  const altHistoryRef = useRef<Map<string, { time: string; alt: number }[]>>(new Map());
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [26.5, 53],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
    }).addTo(map);

    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;
    mapRef.current = map;

    MOCK_ASSETS.us.forEach((asset) => {
      L.circleMarker([asset.lat, asset.lng], {
        radius: 7, color: "hsl(185 80% 50%)", fillColor: "hsl(185 80% 60%)", fillOpacity: 0.5, weight: 2,
      }).bindTooltip(buildAssetTooltip(asset.name, asset.type, asset.status, "hsl(185 80% 50%)", "hsl(145 70% 45%)"), {
        direction: "top", className: "leaflet-tooltip-tactical",
      }).addTo(map);
    });

    MOCK_ASSETS.iran.forEach((asset) => {
      L.circleMarker([asset.lat, asset.lng], {
        radius: 5, color: "hsl(0 85% 55%)", fillColor: "hsl(0 85% 55%)", fillOpacity: 0.6, weight: 2,
      }).bindTooltip(buildAssetTooltip(asset.name, asset.type, asset.status, "hsl(0 85% 55%)", "hsl(0 85% 55% / 0.7)"), {
        direction: "top", className: "leaflet-tooltip-tactical",
      }).addTo(map);
    });

    setTimeout(() => map.invalidateSize(), 100);

    return () => { map.remove(); mapRef.current = null; markersLayerRef.current = null; };
  }, []);

  const handleAircraftClick = useCallback((ac: AircraftData) => {
    setSelectedAircraft(ac);
    const history = altHistoryRef.current.get(ac.hex) || [];
    setAltHistory(history);
  }, []);

  const fetchAircraft = useCallback(async () => {
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "akpvedbvrzbeniyhstfu";
      const resp = await fetch(`https://${projectId}.supabase.co/functions/v1/adsb-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const ac: AircraftData[] = (data.ac || []).filter(
        (a: AircraftData) =>
          a.lat != null && a.lon != null &&
          a.lat >= GULF_BOUNDS.latMin && a.lat <= GULF_BOUNDS.latMax &&
          a.lon! >= GULF_BOUNDS.lngMin && a.lon! <= GULF_BOUNDS.lngMax
      );

      // Track altitude history per aircraft
      const now = new Date().toLocaleTimeString("en-US", { hour12: false });
      ac.forEach((a) => {
        const altNum = a.alt_baro === "ground" ? 0 : typeof a.alt_baro === "number" ? a.alt_baro : 0;
        const existing = altHistoryRef.current.get(a.hex) || [];
        existing.push({ time: now, alt: altNum });
        if (existing.length > 20) existing.shift();
        altHistoryRef.current.set(a.hex, existing);
      });

      // Update selected aircraft if still tracked
      if (selectedAircraft) {
        const updated = ac.find(a => a.hex === selectedAircraft.hex);
        if (updated) {
          setSelectedAircraft(updated);
          setAltHistory(altHistoryRef.current.get(updated.hex) || []);
        }
      }

      if (markersLayerRef.current) {
        markersLayerRef.current.clearLayers();
        ac.forEach((a) => {
          const icon = createAircraftIcon(a);
          L.marker([a.lat!, a.lon!], { icon })
            .bindTooltip(buildAircraftTooltip(a), { direction: "top", className: "leaflet-tooltip-tactical" })
            .on("click", () => handleAircraftClick(a))
            .addTo(markersLayerRef.current!);
        });
      }

      setTrackCount(ac.length);
      setLastUpdate(new Date());
    } catch (e) {
      console.error("ADS-B fetch error:", e);
    }
  }, [selectedAircraft, handleAircraftClick]);

  useEffect(() => {
    fetchAircraft();
    const interval = setInterval(fetchAircraft, 30000);
    return () => clearInterval(interval);
  }, [fetchAircraft]);

  return (
    <div className="panel-tactical flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-header">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse-glow" />
          <span className="text-[11px] font-mono uppercase tracking-wider text-primary">
            Global Threat Matrix — CENTCOM AOR
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-primary/70 font-mono">{trackCount} MIL TRACKS</span>
          <span className="text-[10px] text-muted-foreground">
            {lastUpdate ? `${lastUpdate.toLocaleTimeString("en-US", { hour12: false })}Z` : "ACQUIRING..."}
          </span>
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div ref={mapContainerRef} style={{ height: "100%", width: "100%", background: "hsl(220 20% 4%)" }} />
        <div className="absolute inset-0 scanline pointer-events-none z-[1000]" />

        {/* Aircraft Detail Panel */}
        <AircraftDetailPanel
          aircraft={selectedAircraft}
          altHistory={altHistory}
          onClose={() => setSelectedAircraft(null)}
        />

        {/* Legend */}
        <div className="absolute bottom-2 left-2 bg-background/80 border border-panel-border rounded-sm px-2 py-1.5 flex items-center gap-3 z-[1000]">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ background: "#00d4ff" }} />
            <span className="text-[9px] text-primary/70 font-mono">TRANSPORT</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ background: "#ffaa00" }} />
            <span className="text-[9px] font-mono" style={{ color: "#ffaa00aa" }}>ISR/TANKER</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ background: "#44ff88" }} />
            <span className="text-[9px] font-mono" style={{ color: "#44ff88aa" }}>ROTARY</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full" style={{ background: "#ff6644" }} />
            <span className="text-[9px] font-mono" style={{ color: "#ff6644aa" }}>FIGHTER</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-crimson" />
            <span className="text-[9px] text-crimson/70 font-mono">HOSTILE</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThreatMatrix;
