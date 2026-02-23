import { useState, useEffect, useCallback, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
// All data is now live from ADS-B and GDELT APIs
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

interface VesselData {
  mmsi: string;
  name: string;
  type: string;
  category: string;
  lat: number;
  lon: number;
  speed: number;
  course: number;
  heading: number;
  flag: string;
  destination?: string;
  length?: number;
  status: string;
}

const GULF_BOUNDS = { latMin: -90, latMax: 90, lngMin: -180, lngMax: 180 };

// Aircraft type classification — exact Set.has() matching to avoid false positives
const AC_TRANSPORT = new Set(["C17","C130","C30J","C5","C40","C37","C32","C12","C2","A400","C295","C27J","CN35","A124","AN26","AN32","DHC6","D228","PC12","AT76","AT45","DH8D","DH8C","B190","SW4","E121"]);
const AC_ISR = new Set(["E3","E3TF","E3CF","E8","RC135","R135","P8","EP3","E6","E2","RQ4","MQ9","Q9","MQ4","U2","P3","KC135","K35R","KC10","KC46","B350","BE20"]);
const AC_ROTARY = new Set(["H60","NH90","A139","A169","H53","H53S","H47","V22","CH47","UH60","AH64","H64","H1","EC35","AS32","AS3B","B06"]);
const AC_FIGHTER = new Set(["F15","F16","F18","F22","F35","FA18","EF2K","EUFI","TYPH","RFAL","B1","B2","B52","HAWK"]);
const AC_TRAINER = new Set(["TEX2","PC21","PC7","PC9","G115","F260","G12T","DA42","SR20","Z42"]);
const AC_VIP = new Set(["GLF5","GLF4","GL5T","GLF6","FA7X","CL60","LJ60","LJ35","C560","E50P","E390","P180","TBM7","TBM9","DG1T"]);
const AC_AIRLINER = new Set(["A319","A320","A321","A332","A359","B737","B38M"]);

const getAircraftColor = (type?: string): string => {
  if (!type) return "#ffffff";
  const t = type.toUpperCase().trim();
  if (AC_TRANSPORT.has(t)) return "#00d4ff";
  if (AC_ISR.has(t)) return "#ffaa00";
  if (AC_ROTARY.has(t)) return "#44ff88";
  if (AC_FIGHTER.has(t)) return "#ff6644";
  if (AC_TRAINER.has(t)) return "#cccc00";
  if (AC_VIP.has(t)) return "#aa88ff";
  if (AC_AIRLINER.has(t)) return "#667788";
  if (t === "TWR") return "#555555";
  // Prefix fallbacks for unknown variants
  if (t.startsWith("KC") || t.startsWith("K35") || t.startsWith("RC") || t.startsWith("EP") || t.startsWith("MQ") || t.startsWith("RQ")) return "#ffaa00";
  if (t.startsWith("H6") || t.startsWith("H5") || t.startsWith("H4") || t.startsWith("CH") || t.startsWith("UH") || t.startsWith("AH") || t.startsWith("NH") || t.startsWith("EC") || t.startsWith("AS")) return "#44ff88";
  if (t.startsWith("F1") || t.startsWith("F2") || t.startsWith("F3") || t.startsWith("FA1")) return "#ff6644";
  if (t.startsWith("AN")) return "#00d4ff";
  if (t.startsWith("GLF") || t.startsWith("GL5") || t.startsWith("LJ") || t.startsWith("CL6")) return "#aa88ff";
  return "#ffffff";
};

const getAircraftCategory = (type?: string): string => {
  if (!type) return "UNKNOWN";
  const t = type.toUpperCase().trim();
  if (AC_TRANSPORT.has(t)) return "TRANSPORT";
  if (AC_ISR.has(t)) return "ISR/TANKER";
  if (AC_ROTARY.has(t)) return "ROTARY";
  if (AC_FIGHTER.has(t)) return "FIGHTER/BOMBER";
  if (AC_TRAINER.has(t)) return "TRAINER";
  if (AC_VIP.has(t)) return "VIP/UTILITY";
  if (AC_AIRLINER.has(t)) return "AIRLINER";
  if (t === "TWR") return "GROUND";
  if (t.startsWith("KC") || t.startsWith("K35") || t.startsWith("RC") || t.startsWith("EP") || t.startsWith("MQ") || t.startsWith("RQ")) return "ISR/TANKER";
  if (t.startsWith("H6") || t.startsWith("H5") || t.startsWith("H4") || t.startsWith("CH") || t.startsWith("UH") || t.startsWith("AH") || t.startsWith("NH") || t.startsWith("EC") || t.startsWith("AS")) return "ROTARY";
  if (t.startsWith("F1") || t.startsWith("F2") || t.startsWith("F3") || t.startsWith("FA1")) return "FIGHTER/BOMBER";
  if (t.startsWith("AN")) return "TRANSPORT";
  if (t.startsWith("GLF") || t.startsWith("GL5") || t.startsWith("LJ") || t.startsWith("CL6")) return "VIP/UTILITY";
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

const getVesselColor = (category: string): string => {
  switch (category) {
    case "TANKER": return "#ff9500";
    case "CARGO": return "#00bfff";
    case "NAVAL": return "#ff4466";
    default: return "#aaaaaa";
  }
};

const createVesselIcon = (v: VesselData): L.DivIcon => {
  const color = getVesselColor(v.category);
  const rotation = v.course ?? 0;
  const html = `
    <div style="position:relative;width:20px;height:20px;cursor:pointer;">
      <svg viewBox="0 0 24 24" width="20" height="20" style="transform:rotate(${rotation}deg);filter:drop-shadow(0 0 3px ${color}80);">
        <path d="M12 2 L16 10 L16 20 L12 22 L8 20 L8 10 Z" fill="${color}" fill-opacity="0.85" stroke="${color}" stroke-width="0.5"/>
        <line x1="8" y1="14" x2="16" y2="14" stroke="${color}" stroke-width="0.8" opacity="0.5"/>
      </svg>
      <span style="position:absolute;left:22px;top:2px;font-family:'JetBrains Mono',monospace;font-size:7px;color:${color};white-space:nowrap;text-shadow:0 0 4px rgba(0,0,0,0.9);opacity:0.8;">${v.name}</span>
    </div>
  `;
  return L.divIcon({ html, className: "", iconSize: [20, 20], iconAnchor: [10, 10] });
};

const buildVesselTooltip = (v: VesselData) => {
  const color = getVesselColor(v.category);
  let html = `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;line-height:1.4">`;
  html += `<div style="color:${color};font-weight:600">⚓ ${v.name}</div>`;
  html += `<div style="color:#666;font-size:8px">${v.type}</div>`;
  html += `<div style="color:#999">FLAG: ${v.flag}</div>`;
  html += `<div style="color:#999">SPD: ${v.speed} kts | CRS: ${Math.round(v.course)}°</div>`;
  if (v.destination) html += `<div style="color:#999">DEST: ${v.destination}</div>`;
  if (v.length) html += `<div style="color:#999">LOA: ${v.length}m</div>`;
  html += `<div style="color:${v.status === "Under way" ? "#44ff88" : "#ffaa00"};font-size:8px">${v.status.toUpperCase()}</div>`;
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

export type { AircraftData, VesselData };
export { getAircraftColor, getAircraftCategory, getVesselColor };

// --- Shipping Lane coordinates ---
const SHIPPING_LANES: Array<{ name: string; coords: [number, number][] }> = [
  {
    name: "Gulf Route (Tanker Highway)",
    coords: [[26.56, 56.27], [26.8, 54.5], [27.5, 52.0], [28.5, 50.0], [29.4, 48.5], [29.8, 48.0]],
  },
  {
    name: "Red Sea Route",
    coords: [[12.58, 43.33], [14.0, 42.5], [16.0, 41.5], [20.0, 38.5], [24.0, 36.0], [28.0, 33.5], [30.46, 32.35]],
  },
  {
    name: "Arabian Sea",
    coords: [[26.56, 56.27], [25.5, 57.5], [24.0, 59.0], [22.0, 61.0], [19.0, 63.0], [16.0, 65.0]],
  },
];

// --- Naval Base positions ---
const NAVAL_BASES: Array<{ name: string; lat: number; lon: number; side: "US" | "IRAN" }> = [
  { name: "Al Udeid", lat: 25.12, lon: 51.31, side: "US" },
  { name: "5th Fleet HQ", lat: 26.23, lon: 50.65, side: "US" },
  { name: "Diego Garcia", lat: -7.32, lon: 72.42, side: "US" },
  { name: "Camp Lemonnier", lat: 11.55, lon: 43.15, side: "US" },
  { name: "Bandar Abbas", lat: 27.18, lon: 56.28, side: "IRAN" },
  { name: "Jask", lat: 25.64, lon: 57.77, side: "IRAN" },
  { name: "Abu Musa Is.", lat: 25.87, lon: 55.03, side: "IRAN" },
  { name: "Chabahar", lat: 25.29, lon: 60.64, side: "IRAN" },
];

// --- Chokepoint polygon boundaries ---
const CHOKEPOINT_POLYGONS: Record<string, [number, number][]> = {
  "Strait of Hormuz": [[26.0, 55.5], [27.2, 56.0], [27.0, 57.2], [26.2, 57.0], [25.8, 56.3]],
  "Bab el-Mandeb": [[12.0, 42.8], [13.2, 43.0], [13.0, 44.0], [12.2, 43.8], [11.8, 43.2]],
  "Suez Canal": [[29.8, 31.8], [30.8, 32.0], [31.0, 32.8], [30.2, 32.6], [29.6, 32.2]],
};

function chokepointColor(riskScore: number): string {
  if (riskScore < 30) return "#22c55e"; // green
  if (riskScore < 60) return "#f59e0b"; // amber
  return "#dc2626"; // crimson
}

interface MapIntelEvent {
  lat: number;
  lon: number;
  type: "maritime" | "military" | "diplomatic" | "incident";
  title: string;
  source: string;
  severity: number;
  label: string;
  timestamp: string;
}

interface ChokepointData {
  name: string;
  riskScore: number;
  patrolCount: number;
  articleCount: number;
}

const eventTypeColor = (type: string): string => {
  switch (type) {
    case "incident": return "#ff0044";
    case "maritime": return "#ff9500";
    case "military": return "#ff4466";
    case "diplomatic": return "#00d4ff";
    default: return "#888888";
  }
};

const ThreatMatrix = () => {
  const [trackCount, setTrackCount] = useState(0);
  const [patrolCount, setPatrolCount] = useState(0);
  const [osintCount, setOsintCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [selectedAircraft, setSelectedAircraft] = useState<AircraftData | null>(null);
  const [altHistory, setAltHistory] = useState<{ time: string; alt: number }[]>([]);
  const altHistoryRef = useRef<Map<string, { time: string; alt: number }[]>>(new Map());
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const vesselsLayerRef = useRef<L.LayerGroup | null>(null);
  const shippingLanesLayerRef = useRef<L.LayerGroup | null>(null);
  const chokepointsLayerRef = useRef<L.LayerGroup | null>(null);
  const navalBasesLayerRef = useRef<L.LayerGroup | null>(null);
  const osintEventsLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [26.5, 53],
      zoom: 5,
      zoomControl: false,
      attributionControl: false,
    });

    // Layer 1: Tiles
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
    }).addTo(map);

    // Layer 2: Shipping Lanes (subtle polylines)
    const shippingLanesLayer = L.layerGroup().addTo(map);
    SHIPPING_LANES.forEach((lane) => {
      L.polyline(lane.coords, {
        color: "#00d4ff",
        weight: 1.5,
        opacity: 0.25,
        dashArray: "8,12",
      }).bindTooltip(`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;color:#00d4ff;">${lane.name}</div>`, { sticky: true, className: "leaflet-tooltip-tactical" })
        .addTo(shippingLanesLayer);
    });
    shippingLanesLayerRef.current = shippingLanesLayer;

    // Layer 3: Chokepoint Risk Zones (filled later by fetch)
    const chokepointsLayer = L.layerGroup().addTo(map);
    chokepointsLayerRef.current = chokepointsLayer;

    // Layer 4: Naval Bases (static circles)
    const navalBasesLayer = L.layerGroup().addTo(map);
    NAVAL_BASES.forEach((base) => {
      const color = base.side === "US" ? "#00d4ff" : "#dc2626";
      L.circleMarker([base.lat, base.lon], {
        radius: 4,
        color,
        fillColor: color,
        fillOpacity: 0.7,
        weight: 1.5,
      }).bindTooltip(`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;">
        <div style="color:${color};font-weight:600">${base.name}</div>
        <div style="color:#999;font-size:8px">${base.side === "US" ? "US INSTALLATION" : "IRANIAN INSTALLATION"}</div>
      </div>`, { direction: "top", className: "leaflet-tooltip-tactical" })
        .addTo(navalBasesLayer);
      // Small text label
      L.marker([base.lat, base.lon], {
        icon: L.divIcon({
          html: `<span style="font-family:'JetBrains Mono',monospace;font-size:7px;color:${color}99;white-space:nowrap;">${base.name}</span>`,
          className: "",
          iconSize: [60, 10],
          iconAnchor: [-6, 4],
        }),
        interactive: false,
      }).addTo(navalBasesLayer);
    });
    navalBasesLayerRef.current = navalBasesLayer;

    // Layer 5: OSINT Event Markers (filled by fetch)
    const osintEventsLayer = L.layerGroup().addTo(map);
    osintEventsLayerRef.current = osintEventsLayer;

    // Layer 6: Patrol Aircraft (circle markers)
    const vesselsLayer = L.layerGroup().addTo(map);
    vesselsLayerRef.current = vesselsLayer;

    // Layer 7: Military Aircraft (SVG markers, on top)
    const markersLayer = L.layerGroup().addTo(map);
    markersLayerRef.current = markersLayer;

    mapRef.current = map;

    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      vesselsLayerRef.current = null;
      shippingLanesLayerRef.current = null;
      chokepointsLayerRef.current = null;
      navalBasesLayerRef.current = null;
      osintEventsLayerRef.current = null;
    };
  }, []);

  const handleAircraftClick = useCallback((ac: AircraftData) => {
    setSelectedAircraft(ac);
    const history = altHistoryRef.current.get(ac.hex) || [];
    setAltHistory(history);
  }, []);

  const fetchAircraft = useCallback(async () => {
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev";
      const resp = await fetch(`${apiBase}/adsb-proxy`, {
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

  const fetchPatrolTracks = useCallback(async () => {
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev";
      const resp = await fetch(`${apiBase}/ais-proxy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const tracks: Array<{ hex: string; callsign: string; type: string; category: string; lat: number; lon: number; alt: number; speed: number; heading: number; region: string }> = data.tracks || [];

      if (vesselsLayerRef.current) {
        vesselsLayerRef.current.clearLayers();
        tracks.forEach((t) => {
          const color = t.category === "MARITIME_PATROL" ? "#ff9500" : "#00bfff";
          L.circleMarker([t.lat, t.lon], {
            radius: 5, color, fillColor: color, fillOpacity: 0.7, weight: 2,
          }).bindTooltip(`<div style="font-family:'JetBrains Mono',monospace;font-size:10px;">
            <div style="color:${color};font-weight:600">${t.callsign || t.hex}</div>
            <div style="color:#999">${t.type} — ${t.category}</div>
            <div style="color:#999">REGION: ${t.region}</div>
            <div style="color:#999">ALT: FL${Math.round(t.alt / 100)} | SPD: ${Math.round(t.speed)} kts</div>
          </div>`, { direction: "top", className: "leaflet-tooltip-tactical" })
            .addTo(vesselsLayerRef.current!);
        });
      }

      setPatrolCount(tracks.length);
    } catch (e) {
      console.error("Patrol tracks fetch error:", e);
    }
  }, []);

  // Fetch OSINT events + chokepoint data
  const fetchMapIntel = useCallback(async () => {
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || "https://meridian-api.dieter-meier82.workers.dev";
      const resp = await fetch(`${apiBase}/api/map-intel`);
      if (!resp.ok) return;
      const data = await resp.json() as { events: MapIntelEvent[]; chokepoints: ChokepointData[] };

      // Update chokepoint risk zones
      if (chokepointsLayerRef.current) {
        chokepointsLayerRef.current.clearLayers();
        (data.chokepoints || []).forEach((cp) => {
          const polyCoords = CHOKEPOINT_POLYGONS[cp.name];
          if (!polyCoords) return;
          const color = chokepointColor(cp.riskScore);
          L.polygon(polyCoords, {
            color,
            fillColor: color,
            fillOpacity: 0.15,
            weight: 1.5,
            className: cp.riskScore >= 60 ? "chokepoint-pulse" : "",
          }).bindTooltip(`<div style="font-family:'JetBrains Mono',monospace;font-size:10px;">
            <div style="color:${color};font-weight:600">${cp.name}</div>
            <div style="color:#999">RISK: <span style="color:${color}">${cp.riskScore}/100</span></div>
            <div style="color:#999">PATROLS: ${cp.patrolCount} | ARTICLES: ${cp.articleCount}</div>
          </div>`, { direction: "top", className: "leaflet-tooltip-tactical" })
            .addTo(chokepointsLayerRef.current!);
        });
      }

      // Update OSINT event markers
      if (osintEventsLayerRef.current) {
        osintEventsLayerRef.current.clearLayers();
        const events = data.events || [];
        events.forEach((ev) => {
          const color = eventTypeColor(ev.type);
          const isPulsing = ev.type === "incident";
          const html = `<div style="width:8px;height:8px;transform:rotate(45deg);background:${color};${isPulsing ? "animation:osint-pulse 2s ease-in-out infinite;" : ""}box-shadow:0 0 4px ${color}80;"></div>`;
          L.marker([ev.lat, ev.lon], {
            icon: L.divIcon({
              html,
              className: "",
              iconSize: [8, 8],
              iconAnchor: [4, 4],
            }),
          }).bindTooltip(`<div style="font-family:'JetBrains Mono',monospace;font-size:9px;max-width:200px;">
            <div style="color:${color};font-weight:600">${ev.label}</div>
            <div style="color:#ccc;font-size:8px;word-wrap:break-word;">${ev.title}</div>
            <div style="color:#666;font-size:7px;margin-top:2px">${ev.type.toUpperCase()} | ${ev.source.toUpperCase()}</div>
          </div>`, { direction: "top", className: "leaflet-tooltip-tactical" })
            .addTo(osintEventsLayerRef.current!);
        });
        setOsintCount(events.length);
      }
    } catch (e) {
      console.error("Map intel fetch error:", e);
    }
  }, []);

  useEffect(() => {
    fetchAircraft();
    fetchPatrolTracks();
    fetchMapIntel();
    const acInterval = setInterval(fetchAircraft, 30000);
    const patrolInterval = setInterval(fetchPatrolTracks, 60000);
    const intelInterval = setInterval(fetchMapIntel, 120000);
    return () => { clearInterval(acInterval); clearInterval(patrolInterval); clearInterval(intelInterval); };
  }, [fetchAircraft, fetchPatrolTracks, fetchMapIntel]);

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
          <span className="text-[10px] text-primary/70 font-mono">{trackCount} AIR{patrolCount > 0 ? ` | ${patrolCount} PATROL` : ""}{osintCount > 0 ? ` | ${osintCount} OSINT` : ""}</span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">● LIVE ADS-B</span>
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
        <div className="absolute bottom-2 left-2 bg-background/90 border border-panel-border rounded-sm px-2 py-1.5 flex flex-col gap-1 z-[1000]">
          {/* Row 1: Aircraft types */}
          <div className="flex items-center gap-2">
            {[
              { color: "#00d4ff", label: "TRNS" },
              { color: "#ffaa00", label: "ISR" },
              { color: "#44ff88", label: "HELO" },
              { color: "#ff6644", label: "FTR" },
              { color: "#cccc00", label: "TRN" },
              { color: "#aa88ff", label: "VIP" },
              { color: "#667788", label: "CIV" },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-0.5">
                <div className="h-1.5 w-1.5 rounded-full" style={{ background: item.color }} />
                <span className="text-[7px] font-mono" style={{ color: `${item.color}aa` }}>{item.label}</span>
              </div>
            ))}
          </div>
          {/* Row 2: Map layers */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-0.5">
              <div className="h-1.5 w-1.5 rounded-full" style={{ background: "#ff9500" }} />
              <span className="text-[7px] font-mono" style={{ color: "#ff9500aa" }}>PATROL</span>
            </div>
            <div className="flex items-center gap-0.5">
              <div className="h-1.5 w-1.5 rounded-sm" style={{ background: "#00d4ff", opacity: 0.5 }} />
              <span className="text-[7px] font-mono" style={{ color: "#00d4ff99" }}>US</span>
            </div>
            <div className="flex items-center gap-0.5">
              <div className="h-1.5 w-1.5 rounded-sm" style={{ background: "#dc2626", opacity: 0.5 }} />
              <span className="text-[7px] font-mono" style={{ color: "#dc262699" }}>IR</span>
            </div>
            <div className="flex items-center gap-0.5">
              <div className="h-1.5 w-1.5" style={{ background: "#ff0044", transform: "rotate(45deg)" }} />
              <span className="text-[7px] font-mono" style={{ color: "#ff004499" }}>OSINT</span>
            </div>
            <div className="flex items-center gap-0.5">
              <div className="h-1.5 w-3 rounded-sm" style={{ background: "#f59e0b", opacity: 0.3 }} />
              <span className="text-[7px] font-mono" style={{ color: "#f59e0b99" }}>CHOKE</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThreatMatrix;
