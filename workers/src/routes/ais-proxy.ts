import { CORS_HEADERS, corsError } from "../lib/cors";
import type { Env } from "../lib/anthropic";

/**
 * AIS Proxy — Real maritime data from ADS-B patrol aircraft + GDELT naval OSINT.
 * No free real-time AIS vessel tracking API exists, so we use maritime patrol
 * aircraft (P-8, MQ-9, MH-60) as a proxy for naval presence/activity.
 */

const MARITIME_PATROL_TYPES = ["P8", "P-8", "MQ9", "MQ-9", "MH60", "MH-60", "SH60", "SH-60", "EP3", "EP-3", "H60", "RQ4", "RQ-4", "E6", "E-6", "E2C"];
const NAVAL_AIRCRAFT_TYPES = ["E2", "E-2", "C2", "C-2", "V22", "V-22", "MV22", "H60", "C130", "C-130"];

interface PatrolTrack {
  hex: string;
  callsign: string;
  type: string;
  category: "MARITIME_PATROL" | "NAVAL_SUPPORT";
  lat: number;
  lon: number;
  alt: number;
  speed: number;
  heading: number;
  region: string;
}

const REGIONS = [
  { name: "Persian Gulf", latMin: 23, latMax: 32, lonMin: 47, lonMax: 60 },
  { name: "Red Sea", latMin: 11, latMax: 20, lonMin: 38, lonMax: 45 },
  { name: "Arabian Sea", latMin: 15, latMax: 26, lonMin: 55, lonMax: 68 },
  { name: "Eastern Med", latMin: 30, latMax: 37, lonMin: 26, lonMax: 36 },
];

function inRegion(lat: number, lon: number): string | null {
  for (const r of REGIONS) {
    if (lat >= r.latMin && lat <= r.latMax && lon >= r.lonMin && lon <= r.lonMax) return r.name;
  }
  return null;
}

export async function aisProxy(_req: Request, _env: Env): Promise<Response> {
  try {
    const resp = await fetch("https://api.adsb.lol/v2/mil");
    if (!resp.ok) throw new Error(`adsb.lol returned ${resp.status}`);

    const data = await resp.json() as { ac?: Array<{ hex?: string; lat?: number; lon?: number; t?: string; desc?: string; flight?: string; alt_baro?: number; gs?: number; track?: number }> };
    const allAc = data.ac || [];

    const tracks: PatrolTrack[] = [];
    for (const ac of allAc) {
      if (ac.lat == null || ac.lon == null) continue;
      const region = inRegion(ac.lat, ac.lon);
      if (!region) continue;

      const t = ((ac.t || "") + " " + (ac.desc || "")).toUpperCase();
      const isPatrol = MARITIME_PATROL_TYPES.some((k) => t.includes(k));
      const isNavalSupport = NAVAL_AIRCRAFT_TYPES.some((k) => t.includes(k));
      if (!isPatrol && !isNavalSupport) continue;

      tracks.push({
        hex: ac.hex || "",
        callsign: (ac.flight || "").trim(),
        type: ac.t || "UNKNOWN",
        category: isPatrol ? "MARITIME_PATROL" : "NAVAL_SUPPORT",
        lat: ac.lat, lon: ac.lon,
        alt: ac.alt_baro || 0,
        speed: ac.gs || 0,
        heading: ac.track || 0,
        region,
      });
    }

    const regionCounts: Record<string, number> = {};
    tracks.forEach((t) => { regionCounts[t.region] = (regionCounts[t.region] || 0) + 1; });

    return new Response(JSON.stringify({
      tracks,
      regionCounts,
      source: "adsb.lol-maritime-patrol",
      total: tracks.length,
      timestamp: new Date().toISOString(),
      note: "Real-time maritime patrol aircraft positions from ADS-B. Used as proxy for naval presence since no free AIS API is available.",
    }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}
