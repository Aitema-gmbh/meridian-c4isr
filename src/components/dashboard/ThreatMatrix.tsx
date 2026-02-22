import { useState, useEffect, useCallback, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MOCK_ASSETS } from "@/data/mockData";

interface AircraftData {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  t?: string;
  category?: string;
  r?: string;
  dbFlags?: number;
}

const GULF_BOUNDS = { latMin: 20, latMax: 35, lngMin: 44, lngMax: 65 };

const buildAircraftTooltip = (ac: AircraftData) => {
  let html = `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;line-height:1.4">`;
  html += `<div style="color:hsl(185 80% 50%);font-weight:600">${ac.flight?.trim() || ac.hex}</div>`;
  if (ac.r) html += `<div style="color:#999">REG: ${ac.r}</div>`;
  if (ac.t) html += `<div style="color:#999">TYPE: ${ac.t}</div>`;
  if (ac.alt_baro) html += `<div style="color:#999">ALT: ${ac.alt_baro === "ground" ? "GND" : `${ac.alt_baro} ft`}</div>`;
  if (ac.gs) html += `<div style="color:#999">SPD: ${Math.round(ac.gs)} kts</div>`;
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

const ThreatMatrix = () => {
  const [trackCount, setTrackCount] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);

  // Initialize map once
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

    // Add static asset markers
    MOCK_ASSETS.us.forEach((asset) => {
      L.circleMarker([asset.lat, asset.lng], {
        radius: 7,
        color: "hsl(185 80% 50%)",
        fillColor: "hsl(185 80% 60%)",
        fillOpacity: 0.5,
        weight: 2,
      })
        .bindTooltip(buildAssetTooltip(asset.name, asset.type, asset.status, "hsl(185 80% 50%)", "hsl(145 70% 45%)"), {
          direction: "top",
          className: "leaflet-tooltip-tactical",
        })
        .addTo(map);
    });

    MOCK_ASSETS.iran.forEach((asset) => {
      L.circleMarker([asset.lat, asset.lng], {
        radius: 5,
        color: "hsl(0 85% 55%)",
        fillColor: "hsl(0 85% 55%)",
        fillOpacity: 0.6,
        weight: 2,
      })
        .bindTooltip(buildAssetTooltip(asset.name, asset.type, asset.status, "hsl(0 85% 55%)", "hsl(0 85% 55% / 0.7)"), {
          direction: "top",
          className: "leaflet-tooltip-tactical",
        })
        .addTo(map);
    });

    setTimeout(() => map.invalidateSize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
    };
  }, []);

  const fetchAircraft = useCallback(async () => {
    try {
      const resp = await fetch("https://api.adsb.lol/v2/mil");
      if (!resp.ok) return;
      const data = await resp.json();
      const ac: AircraftData[] = (data.ac || []).filter(
        (a: AircraftData) =>
          a.lat != null &&
          a.lon != null &&
          a.lat >= GULF_BOUNDS.latMin &&
          a.lat <= GULF_BOUNDS.latMax &&
          a.lon! >= GULF_BOUNDS.lngMin &&
          a.lon! <= GULF_BOUNDS.lngMax
      );

      // Update markers
      if (markersLayerRef.current) {
        markersLayerRef.current.clearLayers();
        ac.forEach((a) => {
          L.circleMarker([a.lat!, a.lon!], {
            radius: 4,
            color: "hsl(185 80% 50%)",
            fillColor: "hsl(185 80% 50%)",
            fillOpacity: 0.7,
            weight: 1,
          })
            .bindTooltip(buildAircraftTooltip(a), {
              direction: "top",
              className: "leaflet-tooltip-tactical",
            })
            .addTo(markersLayerRef.current!);
        });
      }

      setTrackCount(ac.length);
      setLastUpdate(new Date());
    } catch (e) {
      console.error("ADS-B fetch error:", e);
    }
  }, []);

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

        {/* Scanline overlay */}
        <div className="absolute inset-0 scanline pointer-events-none z-[1000]" />

        {/* Legend */}
        <div className="absolute bottom-2 left-2 bg-background/80 border border-panel-border rounded-sm px-2 py-1.5 flex items-center gap-4 z-[1000]">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-[9px] text-primary/70 font-mono">US/ALLIED</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-crimson" />
            <span className="text-[9px] text-crimson/70 font-mono">HOSTILE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-primary opacity-70" />
            <span className="text-[9px] text-primary/50 font-mono">ADS-B MIL</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThreatMatrix;
