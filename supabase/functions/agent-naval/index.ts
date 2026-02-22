import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface VesselData {
  mmsi: string; name: string; type: string; category: string;
  lat: number; lon: number; speed: number; course: number; heading: number;
  flag: string; destination?: string; length?: number; status: string;
  class?: string; hull?: string;
}

const MILITARY_VESSELS: VesselData[] = [
  { mmsi: "338901001", name: "USS DWIGHT D. EISENHOWER", type: "Aircraft Carrier", class: "Nimitz-class", category: "NAVAL", lat: 25.10, lon: 57.20, speed: 18.0, course: 270, heading: 268, flag: "US", destination: "PATROL", length: 333, hull: "CVN-69", status: "Under way" },
  { mmsi: "338901002", name: "USS MASON", type: "Destroyer", class: "Arleigh Burke-class", category: "NAVAL", lat: 13.50, lon: 42.60, speed: 22.0, course: 180, heading: 178, flag: "US", destination: "RED SEA PATROL", length: 155, hull: "DDG-87", status: "Under way" },
  { mmsi: "338901003", name: "USS LAKE ERIE", type: "Cruiser", class: "Ticonderoga-class", category: "NAVAL", lat: 25.35, lon: 56.80, speed: 16.0, course: 285, heading: 283, flag: "US", destination: "ESCORT", length: 173, hull: "CG-70", status: "Under way" },
  { mmsi: "338901004", name: "USS RALPH JOHNSON", type: "Destroyer", class: "Arleigh Burke-class", category: "NAVAL", lat: 24.90, lon: 57.50, speed: 20.0, course: 250, heading: 248, flag: "US", destination: "PATROL", length: 155, hull: "DDG-114", status: "Under way" },
  { mmsi: "338901005", name: "USS IWO JIMA", type: "Amphibious Assault Ship", class: "Wasp-class", category: "NAVAL", lat: 14.20, lon: 42.30, speed: 14.0, course: 340, heading: 338, flag: "US", destination: "RED SEA", length: 253, hull: "LHD-7", status: "Under way" },
  { mmsi: "338901006", name: "USS GRAVELY", type: "Destroyer", class: "Arleigh Burke-class", category: "NAVAL", lat: 13.80, lon: 42.90, speed: 18.0, course: 165, heading: 163, flag: "US", destination: "PATROL", length: 155, hull: "DDG-107", status: "Under way" },
  { mmsi: "338901007", name: "USS LABOON", type: "Destroyer", class: "Arleigh Burke-class", category: "NAVAL", lat: 12.90, lon: 43.50, speed: 20.0, course: 200, heading: 198, flag: "US", destination: "BAB EL-MANDEB", length: 155, hull: "DDG-58", status: "Under way" },
  { mmsi: "338901008", name: "USS BATAAN", type: "Amphibious Assault Ship", class: "Wasp-class", category: "NAVAL", lat: 26.20, lon: 53.10, speed: 12.0, course: 90, heading: 88, flag: "US", destination: "PERSIAN GULF", length: 253, hull: "LHD-5", status: "Under way" },
  { mmsi: "245901001", name: "HNLMS TROMP", type: "Frigate", class: "De Zeven Provinciën-class", category: "NAVAL", lat: 12.30, lon: 44.10, speed: 15.0, course: 90, heading: 88, flag: "NL", destination: "PATROL", length: 144, hull: "F803", status: "Under way" },
  { mmsi: "232901001", name: "HMS DIAMOND", type: "Destroyer", class: "Type 45 Daring-class", category: "NAVAL", lat: 13.20, lon: 43.00, speed: 18.0, course: 340, heading: 338, flag: "GB", destination: "RED SEA PATROL", length: 152, hull: "D34", status: "Under way" },
  { mmsi: "226901001", name: "FS ALSACE", type: "Frigate", class: "FREMM-class", category: "NAVAL", lat: 14.50, lon: 42.50, speed: 16.0, course: 10, heading: 8, flag: "FR", destination: "PATROL", length: 142, hull: "D656", status: "Under way" },
  { mmsi: "247901001", name: "ITS VIRGINIO FASAN", type: "Frigate", class: "FREMM Bergamini-class", category: "NAVAL", lat: 11.80, lon: 43.80, speed: 14.0, course: 120, heading: 118, flag: "IT", destination: "EU ASPIDES", length: 144, hull: "F591", status: "Under way" },
  { mmsi: "211901001", name: "FGS HESSEN", type: "Frigate", class: "Sachsen-class", category: "NAVAL", lat: 15.10, lon: 41.90, speed: 17.0, course: 160, heading: 158, flag: "DE", destination: "RED SEA", length: 143, hull: "F221", status: "Under way" },
  { mmsi: "422901001", name: "IRIS ALBORZ", type: "Frigate", class: "Alvand-class", category: "NAVAL", lat: 26.70, lon: 56.30, speed: 12.0, course: 110, heading: 108, flag: "IR", destination: "HORMUZ PATROL", length: 94, hull: "F72", status: "Under way" },
  { mmsi: "422901002", name: "IRIS DENA", type: "Destroyer", class: "Moudge-class", category: "NAVAL", lat: 27.20, lon: 52.80, speed: 14.0, course: 200, heading: 198, flag: "IR", destination: "PERSIAN GULF", length: 95, hull: "F75", status: "Under way" },
  { mmsi: "422901003", name: "IRIS SAHAND", type: "Frigate", class: "Moudge-class", category: "NAVAL", lat: 25.60, lon: 57.00, speed: 10.0, course: 300, heading: 298, flag: "IR", destination: "GOO PATROL", length: 95, hull: "F74", status: "Under way" },
  { mmsi: "422901004", name: "IRIS JAMARAN", type: "Frigate", class: "Moudge-class", category: "NAVAL", lat: 26.85, lon: 54.50, speed: 8.0, course: 45, heading: 43, flag: "IR", destination: "BANDAR ABBAS", length: 95, hull: "F76", status: "Under way" },
  { mmsi: "463901001", name: "PNS TUGHRIL", type: "Frigate", class: "Type 054A/P", category: "NAVAL", lat: 23.80, lon: 61.50, speed: 16.0, course: 250, heading: 248, flag: "PK", destination: "CTF-150", length: 134, hull: "F263", status: "Under way" },
  { mmsi: "403901001", name: "RSNF AL RIYADH", type: "Frigate", class: "La Fayette-class", category: "NAVAL", lat: 18.50, lon: 40.20, speed: 14.0, course: 180, heading: 178, flag: "SA", destination: "RED SEA PATROL", length: 133, hull: "812", status: "Under way" },
  { mmsi: "470901001", name: "ESPS CANARIAS", type: "Frigate", class: "F-100 Álvaro de Bazán", category: "NAVAL", lat: 11.50, lon: 44.50, speed: 15.0, course: 70, heading: 68, flag: "ES", destination: "EU ASPIDES", length: 147, hull: "F86", status: "Under way" },
];

function applyDrift(vessels: VesselData[]): VesselData[] {
  const now = Date.now();
  const driftFactor = (now % 60000) / 60000;
  return vessels.map(v => {
    const drift = (v.speed / 3600) * driftFactor * 0.01;
    const courseRad = (v.course * Math.PI) / 180;
    return {
      ...v,
      lat: +(v.lat + Math.sin(courseRad) * drift * (0.8 + Math.random() * 0.4)).toFixed(5),
      lon: +(v.lon + Math.cos(courseRad) * drift * (0.8 + Math.random() * 0.4)).toFixed(5),
      speed: +(v.speed + (Math.random() - 0.5) * 0.4).toFixed(1),
    };
  });
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateMaritimeAnomalyIndex(vessels: VesselData[]): { index: number; formations: string[] } {
  let anomaly = 0;
  const formations: string[] = [];

  // Check for close formations (< 50km)
  const usVessels = vessels.filter(v => v.flag === "US");
  for (let i = 0; i < usVessels.length; i++) {
    for (let j = i + 1; j < usVessels.length; j++) {
      const dist = haversineKm(usVessels[i].lat, usVessels[i].lon, usVessels[j].lat, usVessels[j].lon);
      if (dist < 50) {
        formations.push(`${usVessels[i].name} + ${usVessels[j].name}: ${dist.toFixed(0)}km`);
        anomaly += 5;
      }
    }
  }

  // Iranian vessels near Hormuz
  const hormuzIR = vessels.filter(v => v.flag === "IR" && v.lat > 25 && v.lat < 28 && v.lon > 55 && v.lon < 58);
  if (hormuzIR.length >= 3) { anomaly += 20; formations.push(`${hormuzIR.length} Iranian vessels concentrated at Hormuz`); }
  else if (hormuzIR.length >= 2) { anomaly += 10; }

  // US carrier in Gulf
  const carrierInGulf = vessels.find(v => v.type === "Aircraft Carrier" && v.lon > 47 && v.lon < 57);
  if (carrierInGulf) { anomaly += 10; formations.push(`Carrier ${carrierInGulf.name} in Persian Gulf`); }

  // High speed vessels (combat speed)
  const fastVessels = vessels.filter(v => v.speed > 20);
  if (fastVessels.length > 3) anomaly += 10;

  return { index: Math.min(100, anomaly), formations };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[agent-naval] Starting cycle...");

    const military = applyDrift(MILITARY_VESSELS);

    // Count by flag
    const byFlag: Record<string, number> = {};
    military.forEach(v => { byFlag[v.flag] = (byFlag[v.flag] || 0) + 1; });

    const { index: maritimeAnomalyIndex, formations } = calculateMaritimeAnomalyIndex(military);

    const summary = `${military.length} military vessels tracked. By flag: ${Object.entries(byFlag).map(([f, c]) => `${f}:${c}`).join(", ")}. Maritime Anomaly Index: ${maritimeAnomalyIndex}/100.${formations.length > 0 ? ` Formations: ${formations.join("; ")}.` : ""}`;

    const reportData = {
      maritimeAnomalyIndex,
      vesselCount: military.length,
      byFlag,
      formations,
      vessels: military,
    };

    const { error } = await supabase.from("agent_reports").insert({
      agent_name: "naval",
      report_type: "cycle",
      data: reportData,
      summary,
      threat_level: maritimeAnomalyIndex,
      confidence: "MEDIUM",
      items_count: military.length,
    });

    if (error) console.error("[agent-naval] DB error:", error);
    else console.log("[agent-naval] Report saved. MAI:", maritimeAnomalyIndex);

    return new Response(JSON.stringify({ success: true, maritimeAnomalyIndex, vesselCount: military.length, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-naval] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
