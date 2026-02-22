import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// CENTCOM AOR bounding boxes
const REGIONS = [
  { name: "Persian Gulf", latMin: 23, latMax: 32, lonMin: 47, lonMax: 60 },
  { name: "Red Sea", latMin: 11, latMax: 20, lonMin: 38, lonMax: 45 },
  { name: "Arabian Sea", latMin: 15, latMax: 26, lonMin: 55, lonMax: 68 },
  { name: "Eastern Med", latMin: 30, latMax: 37, lonMin: 26, lonMax: 36 },
];

// Aircraft type classification
const ISR_TYPES = ["E3", "E-3", "RC135", "RC-135", "P8", "P-8", "RQ4", "RQ-4", "EP3", "EP-3", "MQ9", "MQ-9", "U2", "U-2", "AWACS", "JSTARS", "E8", "RIVET"];
const TANKER_TYPES = ["KC135", "KC-135", "KC10", "KC-10", "KC46", "KC-46", "STRATOTANKER"];
const FIGHTER_TYPES = ["F18", "F-18", "F15", "F-15", "F16", "F-16", "F35", "F-35", "F22", "F-22", "FA18", "HORNET", "EAGLE", "VIPER", "RAPTOR"];
const TRANSPORT_TYPES = ["C17", "C-17", "C130", "C-130", "C5", "C-5", "C40", "C-40", "GLOBEMASTER", "HERCULES"];
const BOMBER_TYPES = ["B1", "B-1", "B2", "B-2", "B52", "B-52", "LANCER", "SPIRIT", "STRATOFORTRESS"];
const HELI_TYPES = ["MH60", "MH-60", "CH47", "CH-47", "UH60", "UH-60", "AH64", "AH-64", "HAWK", "CHINOOK", "APACHE"];

function classifyAircraft(ac: any): string {
  const t = ((ac.t || "") + " " + (ac.desc || "")).toUpperCase();
  if (ISR_TYPES.some(k => t.includes(k))) return "ISR";
  if (TANKER_TYPES.some(k => t.includes(k))) return "TANKER";
  if (FIGHTER_TYPES.some(k => t.includes(k))) return "FIGHTER";
  if (BOMBER_TYPES.some(k => t.includes(k))) return "BOMBER";
  if (TRANSPORT_TYPES.some(k => t.includes(k))) return "TRANSPORT";
  if (HELI_TYPES.some(k => t.includes(k))) return "HELI";
  return "OTHER";
}

function inRegion(lat: number, lon: number): string | null {
  for (const r of REGIONS) {
    if (lat >= r.latMin && lat <= r.latMax && lon >= r.lonMin && lon <= r.lonMax) return r.name;
  }
  return null;
}

// Baseline activity counts (average peacetime)
const BASELINE = { ISR: 3, TANKER: 4, FIGHTER: 6, BOMBER: 0, TRANSPORT: 5, HELI: 3, OTHER: 8 };

function calculateAnomalyIndex(counts: Record<string, number>): number {
  let anomalyScore = 0;
  let factors = 0;

  for (const [cat, baseline] of Object.entries(BASELINE)) {
    const actual = counts[cat] || 0;
    if (baseline === 0) {
      if (actual > 0) { anomalyScore += 30; factors++; } // bombers = big deal
    } else {
      const ratio = actual / baseline;
      if (ratio > 2) { anomalyScore += 25; factors++; }
      else if (ratio > 1.5) { anomalyScore += 15; factors++; }
      else if (ratio > 1) { anomalyScore += 5; factors++; }
    }
  }

  // ISR heavy weight — most important signal
  const isrRatio = (counts["ISR"] || 0) / (BASELINE.ISR || 1);
  if (isrRatio > 3) anomalyScore += 20;

  return Math.min(100, anomalyScore);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[agent-flights] Starting cycle...");

    const resp = await fetch("https://api.adsb.lol/v2/mil");
    if (!resp.ok) throw new Error(`adsb.lol returned ${resp.status}`);

    const data = await resp.json();
    const allAc = data.ac || [];

    // Filter to CENTCOM AOR
    const regionalAc = allAc.filter((ac: any) => {
      if (ac.lat == null || ac.lon == null) return false;
      return inRegion(ac.lat, ac.lon) !== null;
    });

    // Classify and count
    const counts: Record<string, number> = {};
    const classified = regionalAc.map((ac: any) => {
      const category = classifyAircraft(ac);
      counts[category] = (counts[category] || 0) + 1;
      return {
        hex: ac.hex,
        type: ac.t || "UNKNOWN",
        category,
        callsign: (ac.flight || "").trim(),
        lat: ac.lat,
        lon: ac.lon,
        alt: ac.alt_baro || ac.alt_geom,
        speed: ac.gs,
        heading: ac.track,
        region: inRegion(ac.lat, ac.lon),
        squawk: ac.squawk,
        flag: ac.dbFlags,
      };
    });

    const anomalyIndex = calculateAnomalyIndex(counts);
    const totalRegional = classified.length;
    const totalGlobal = allAc.length;

    // Detect ISR orbits (simplified: multiple ISR in same region)
    const isrByRegion: Record<string, number> = {};
    classified.filter((a: any) => a.category === "ISR").forEach((a: any) => {
      if (a.region) isrByRegion[a.region] = (isrByRegion[a.region] || 0) + 1;
    });
    const activeIsrOrbits = Object.entries(isrByRegion).filter(([, c]) => c >= 2).map(([r]) => r);

    const summary = `${totalRegional} mil aircraft in CENTCOM AOR (${totalGlobal} global). Categories: ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(", ")}. Flight Anomaly Index: ${anomalyIndex}/100.${activeIsrOrbits.length > 0 ? ` Active ISR orbits: ${activeIsrOrbits.join(", ")}.` : ""}${counts["BOMBER"] ? " ALERT: Bomber activity detected." : ""}`;

    const threatLevel = anomalyIndex;
    const confidence = totalRegional > 10 ? "HIGH" : totalRegional > 3 ? "MEDIUM" : "LOW";

    const reportData = {
      anomalyIndex,
      totalRegional,
      totalGlobal,
      counts,
      activeIsrOrbits,
      topAircraft: classified.slice(0, 50), // top 50 for storage
      byRegion: REGIONS.map(r => ({
        name: r.name,
        count: classified.filter((a: any) => a.region === r.name).length,
      })),
    };

    const { error } = await supabase.from("agent_reports").insert({
      agent_name: "flights",
      report_type: "cycle",
      data: reportData,
      summary,
      threat_level: threatLevel,
      confidence,
      items_count: totalRegional,
    });

    if (error) console.error("[agent-flights] DB insert error:", error);
    else console.log("[agent-flights] Report saved. Anomaly:", anomalyIndex);

    // Welford baseline update
    const now = new Date();
    const dow = now.getUTCDay();
    const hour = now.getUTCHours();
    await Promise.all([
      supabase.from("agent_baselines").upsert({
        agent_name: "flights", metric_name: "anomaly_index",
        day_of_week: dow, hour_of_day: hour,
        mean: anomalyIndex, variance: 0, count: 1, updated_at: now.toISOString(),
      }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" }),
      supabase.from("agent_baselines").upsert({
        agent_name: "flights", metric_name: "regional_count",
        day_of_week: dow, hour_of_day: hour,
        mean: totalRegional, variance: 0, count: 1, updated_at: now.toISOString(),
      }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" }),
    ]);

    return new Response(JSON.stringify({ success: true, anomalyIndex, totalRegional, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-flights] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
