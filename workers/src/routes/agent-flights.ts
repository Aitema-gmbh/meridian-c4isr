import { corsError, corsResponse } from "../lib/cors";
import { insertAgentReport } from "../lib/db";
import type { Env } from "../lib/anthropic";

const REGIONS = [
  { name: "Persian Gulf", latMin: 23, latMax: 32, lonMin: 47, lonMax: 60 },
  { name: "Red Sea", latMin: 11, latMax: 20, lonMin: 38, lonMax: 45 },
  { name: "Arabian Sea", latMin: 15, latMax: 26, lonMin: 55, lonMax: 68 },
  { name: "Eastern Med", latMin: 30, latMax: 37, lonMin: 26, lonMax: 36 },
];
const ISR_TYPES = ["E3","RC135","RC-135","P8","P-8","RQ4","RQ-4","EP3","EP-3","MQ9","MQ-9","U2","AWACS","RIVET"];
const TANKER_TYPES = ["KC135","KC-135","KC10","KC-10","KC46","KC-46"];
const FIGHTER_TYPES = ["F18","F-18","F15","F-15","F16","F-16","F35","F-35","F22","FA18"];
const BOMBER_TYPES = ["B1","B-1","B2","B-2","B52","B-52"];
const TRANSPORT_TYPES = ["C17","C-17","C130","C-130","C5","C-5","C40"];
const HELI_TYPES = ["MH60","MH-60","CH47","CH-47","UH60","AH64","AH-64"];
const BASELINE = { ISR: 3, TANKER: 4, FIGHTER: 6, BOMBER: 0, TRANSPORT: 5, HELI: 3, OTHER: 8 };

function classifyAircraft(ac: { t?: string; desc?: string }): string {
  const t = ((ac.t || "") + " " + (ac.desc || "")).toUpperCase();
  if (ISR_TYPES.some((k) => t.includes(k))) return "ISR";
  if (TANKER_TYPES.some((k) => t.includes(k))) return "TANKER";
  if (FIGHTER_TYPES.some((k) => t.includes(k))) return "FIGHTER";
  if (BOMBER_TYPES.some((k) => t.includes(k))) return "BOMBER";
  if (TRANSPORT_TYPES.some((k) => t.includes(k))) return "TRANSPORT";
  if (HELI_TYPES.some((k) => t.includes(k))) return "HELI";
  return "OTHER";
}

function inRegion(lat: number, lon: number): string | null {
  for (const r of REGIONS) {
    if (lat >= r.latMin && lat <= r.latMax && lon >= r.lonMin && lon <= r.lonMax) return r.name;
  }
  return null;
}

function calculateAnomalyIndex(counts: Record<string, number>): number {
  let score = 0;
  for (const [cat, baseline] of Object.entries(BASELINE)) {
    const actual = counts[cat] || 0;
    if (baseline === 0) { if (actual > 0) score += 30; }
    else {
      const ratio = actual / baseline;
      if (ratio > 2) score += 25;
      else if (ratio > 1.5) score += 15;
      else if (ratio > 1) score += 5;
    }
  }
  const isrRatio = (counts["ISR"] || 0) / BASELINE.ISR;
  if (isrRatio > 3) score += 20;
  return Math.min(100, score);
}

export async function agentFlights(_req: Request, env: Env): Promise<Response> {
  try {
    const resp = await fetch("https://api.adsb.lol/v2/mil");
    if (!resp.ok) throw new Error(`adsb.lol returned ${resp.status}`);

    const data = await resp.json() as { ac?: Array<{ lat?: number; lon?: number; t?: string; desc?: string; hex?: string; flight?: string; alt_baro?: number; alt_geom?: number; gs?: number; track?: number; squawk?: string; dbFlags?: number }> };
    const allAc = data.ac || [];
    const regionalAc = allAc.filter((ac) => ac.lat != null && ac.lon != null && inRegion(ac.lat!, ac.lon!) !== null);

    const counts: Record<string, number> = {};
    const classified = regionalAc.map((ac) => {
      const category = classifyAircraft(ac);
      counts[category] = (counts[category] || 0) + 1;
      return { hex: ac.hex, type: ac.t || "UNKNOWN", category, callsign: (ac.flight || "").trim(), lat: ac.lat, lon: ac.lon, alt: ac.alt_baro || ac.alt_geom, speed: ac.gs, heading: ac.track, region: inRegion(ac.lat!, ac.lon!), squawk: ac.squawk };
    });

    const anomalyIndex = calculateAnomalyIndex(counts);
    const isrByRegion: Record<string, number> = {};
    classified.filter((a) => a.category === "ISR").forEach((a) => {
      if (a.region) isrByRegion[a.region] = (isrByRegion[a.region] || 0) + 1;
    });
    const activeIsrOrbits = Object.entries(isrByRegion).filter(([, c]) => c >= 2).map(([r]) => r);
    const summary = `${classified.length} mil aircraft in CENTCOM AOR. Flight Anomaly Index: ${anomalyIndex}/100.`;

    await insertAgentReport(env.DB, {
      agent_name: "flights", report_type: "cycle",
      data: { anomalyIndex, totalRegional: classified.length, totalGlobal: allAc.length, counts, activeIsrOrbits, topAircraft: classified.slice(0, 50) },
      summary, threat_level: anomalyIndex,
      confidence: classified.length > 10 ? "HIGH" : classified.length > 3 ? "MEDIUM" : "LOW",
      items_count: classified.length,
    });

    return corsResponse({ success: true, anomalyIndex, totalRegional: classified.length, summary });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}
