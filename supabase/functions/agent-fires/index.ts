import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Gulf region bounding box (approx)
const GULF_BBOX = { minLat: 12, maxLat: 40, minLon: 32, maxLon: 63 };

// Known military installations / strategic sites (approx coords)
const STRATEGIC_SITES = [
  { name: "Bandar Abbas Naval Base", lat: 27.18, lon: 56.28, country: "IR" },
  { name: "Bushehr Nuclear Plant", lat: 28.83, lon: 50.89, country: "IR" },
  { name: "Isfahan Nuclear Facility", lat: 32.65, lon: 51.68, country: "IR" },
  { name: "Natanz Enrichment", lat: 33.72, lon: 51.73, country: "IR" },
  { name: "Al Udeid Air Base", lat: 25.12, lon: 51.32, country: "QA" },
  { name: "Al Dhafra Air Base", lat: 24.25, lon: 54.55, country: "AE" },
  { name: "Bahrain Naval Support", lat: 26.21, lon: 50.59, country: "BH" },
  { name: "Camp Arifjan", lat: 29.17, lon: 48.08, country: "KW" },
  { name: "Nevatim Air Base", lat: 31.21, lon: 34.84, country: "IL" },
  { name: "Hmeimim Air Base", lat: 35.41, lon: 35.95, country: "SY" },
  { name: "Aden Port", lat: 12.79, lon: 45.01, country: "YE" },
  { name: "Hodeidah Port", lat: 14.80, lon: 42.95, country: "YE" },
];

interface FirePoint {
  lat: number;
  lon: number;
  brightness: number;
  confidence: string;
  acq_date: string;
  nearSite?: string;
  distKm?: number;
}

interface EarthquakeEvent {
  place: string;
  mag: number;
  lat: number;
  lon: number;
  time: string;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function fetchFIRMS(): Promise<FirePoint[]> {
  try {
    // NASA FIRMS API - VIIRS active fires, last 24h, in Gulf region
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/OPEN_API_KEY/VIIRS_SNPP_NRT/${GULF_BBOX.minLon},${GULF_BBOX.minLat},${GULF_BBOX.maxLon},${GULF_BBOX.maxLat}/1`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.log("[agent-fires] FIRMS API returned", resp.status, "- using FIRMS open endpoint");
      // Fallback: use the open CSV endpoint  
      const fallbackUrl = `https://firms.modaps.eosdis.nasa.gov/usfs/api/area/csv/OPEN_API_KEY/VIIRS_SNPP_NRT/${GULF_BBOX.minLon},${GULF_BBOX.minLat},${GULF_BBOX.maxLon},${GULF_BBOX.maxLat}/1`;
      const fallbackResp = await fetch(fallbackUrl);
      if (!fallbackResp.ok) return [];
      return parseFIRMScsv(await fallbackResp.text());
    }
    return parseFIRMScsv(await resp.text());
  } catch (e) {
    console.error("[agent-fires] FIRMS error:", e);
    return [];
  }
}

function parseFIRMScsv(csv: string): FirePoint[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const latIdx = header.indexOf("latitude");
  const lonIdx = header.indexOf("longitude");
  const brIdx = header.indexOf("bright_ti4");
  const confIdx = header.indexOf("confidence");
  const dateIdx = header.indexOf("acq_date");

  if (latIdx < 0 || lonIdx < 0) return [];

  const points: FirePoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const lat = parseFloat(cols[latIdx]);
    const lon = parseFloat(cols[lonIdx]);
    if (isNaN(lat) || isNaN(lon)) continue;

    const point: FirePoint = {
      lat, lon,
      brightness: parseFloat(cols[brIdx]) || 0,
      confidence: cols[confIdx] || "unknown",
      acq_date: cols[dateIdx] || "",
    };

    // Check proximity to strategic sites
    for (const site of STRATEGIC_SITES) {
      const dist = haversineKm(lat, lon, site.lat, site.lon);
      if (dist < 50) { // within 50km
        point.nearSite = site.name;
        point.distKm = Math.round(dist * 10) / 10;
        break;
      }
    }

    points.push(point);
  }
  return points;
}

async function fetchUSGS(): Promise<EarthquakeEvent[]> {
  try {
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minlatitude=${GULF_BBOX.minLat}&maxlatitude=${GULF_BBOX.maxLat}&minlongitude=${GULF_BBOX.minLon}&maxlongitude=${GULF_BBOX.maxLon}&starttime=${new Date(Date.now() - 7 * 86400000).toISOString()}&minmagnitude=2.5`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.features || []).map((f: any) => ({
      place: f.properties?.place || "Unknown",
      mag: f.properties?.mag || 0,
      lat: f.geometry?.coordinates?.[1] || 0,
      lon: f.geometry?.coordinates?.[0] || 0,
      time: new Date(f.properties?.time || 0).toISOString(),
    }));
  } catch (e) {
    console.error("[agent-fires] USGS error:", e);
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[agent-fires] Starting fire/seismic scan...");

    const [fires, earthquakes] = await Promise.all([fetchFIRMS(), fetchUSGS()]);

    // Analyze fires near strategic sites
    const nearSiteFires = fires.filter(f => f.nearSite);
    const highBrightness = fires.filter(f => f.brightness > 350);
    const highConfidence = fires.filter(f => f.confidence === "high" || f.confidence === "h");

    // Significant earthquakes
    const significantQuakes = earthquakes.filter(e => e.mag >= 4.0);

    // Geo-Thermal Anomaly Index (0-100)
    const fireScore = Math.min(
      (nearSiteFires.length * 15) + (highBrightness.length * 5) + (fires.length * 0.5),
      60
    );
    const seismicScore = Math.min(
      significantQuakes.reduce((sum, q) => sum + q.mag * 3, 0),
      40
    );
    const geoThermalIndex = Math.round(Math.min(fireScore + seismicScore, 100));

    const summary = [
      `Geo-Thermal Index: ${geoThermalIndex}/100.`,
      `${fires.length} fire detections in Gulf AOR (${nearSiteFires.length} near strategic sites).`,
      nearSiteFires.length > 0 ? `Near-site fires: ${nearSiteFires.map(f => `${f.nearSite} (${f.distKm}km)`).join(", ")}.` : "",
      `${earthquakes.length} seismic events (${significantQuakes.length} significant M4+).`,
      significantQuakes.length > 0 ? `Largest: M${significantQuakes[0]?.mag} ${significantQuakes[0]?.place}.` : "",
    ].filter(Boolean).join(" ");

    // Update baselines
    const now = new Date();
    const dow = now.getUTCDay();
    const hour = now.getUTCHours();

    await Promise.all([
      supabase.from("agent_baselines").upsert({
        agent_name: "fires",
        metric_name: "fire_count",
        day_of_week: dow,
        hour_of_day: hour,
        mean: fires.length,
        variance: 0,
        count: 1,
        updated_at: now.toISOString(),
      }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" }),
      supabase.from("agent_baselines").upsert({
        agent_name: "fires",
        metric_name: "quake_count",
        day_of_week: dow,
        hour_of_day: hour,
        mean: earthquakes.length,
        variance: 0,
        count: 1,
        updated_at: now.toISOString(),
      }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" }),
    ]);

    // Save report
    await supabase.from("agent_reports").insert({
      agent_name: "fires",
      report_type: "cycle",
      data: {
        geoThermalIndex,
        totalFires: fires.length,
        nearSiteFires: nearSiteFires.map(f => ({
          site: f.nearSite,
          distKm: f.distKm,
          brightness: f.brightness,
          lat: f.lat,
          lon: f.lon,
        })),
        highBrightnessCount: highBrightness.length,
        earthquakes: earthquakes.slice(0, 10),
        significantQuakes: significantQuakes.length,
        bbox: GULF_BBOX,
      },
      summary,
      threat_level: geoThermalIndex,
      confidence: (fires.length > 0 || earthquakes.length > 0) ? "HIGH" : "MEDIUM",
      items_count: nearSiteFires.length + significantQuakes.length,
    });

    console.log(`[agent-fires] Done. Index: ${geoThermalIndex}, Fires: ${fires.length}, Near-site: ${nearSiteFires.length}, Quakes: ${earthquakes.length}`);

    return new Response(JSON.stringify({
      success: true,
      geoThermalIndex,
      fires: fires.length,
      nearSiteFires: nearSiteFires.length,
      earthquakes: earthquakes.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-fires] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
