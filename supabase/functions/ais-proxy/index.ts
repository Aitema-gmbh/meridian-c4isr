import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

// Strategically placed vessels in key waterways with slight position drift
const BASE_VESSELS: VesselData[] = [
  // Strait of Hormuz
  { mmsi: "212345001", name: "MAERSK SENTOSA", type: "Container Ship", category: "CARGO", lat: 26.58, lon: 56.25, speed: 14.2, course: 290, heading: 288, flag: "DK", destination: "JEBEL ALI", length: 366, status: "Under way" },
  { mmsi: "311234002", name: "FRONT ALTA", type: "Crude Oil Tanker", category: "TANKER", lat: 26.42, lon: 56.48, speed: 12.8, course: 115, heading: 113, flag: "MH", destination: "FUJAIRAH", length: 336, status: "Under way" },
  { mmsi: "636091003", name: "PACIFIC JEWEL", type: "LNG Carrier", category: "TANKER", lat: 26.35, lon: 56.10, speed: 16.1, course: 305, heading: 303, flag: "LR", destination: "RAS LAFFAN", length: 295, status: "Under way" },
  { mmsi: "538006004", name: "STENA SUPREME", type: "Crude Oil Tanker", category: "TANKER", lat: 26.68, lon: 56.62, speed: 11.5, course: 130, heading: 128, flag: "MH", destination: "SINGAPORE", length: 274, status: "Under way" },
  
  // Persian Gulf
  { mmsi: "477123005", name: "COSCO GALAXY", type: "Container Ship", category: "CARGO", lat: 27.15, lon: 52.40, speed: 15.3, course: 330, heading: 328, flag: "HK", destination: "BANDAR ABBAS", length: 400, status: "Under way" },
  { mmsi: "256789006", name: "KUWAIT PRIDE", type: "Crude Oil Tanker", category: "TANKER", lat: 28.90, lon: 48.85, speed: 0.2, course: 0, heading: 45, flag: "KW", destination: "MINA AL AHMADI", length: 333, status: "At anchor" },
  { mmsi: "422567007", name: "IRAN DENA", type: "General Cargo", category: "CARGO", lat: 27.45, lon: 52.05, speed: 10.2, course: 160, heading: 158, flag: "IR", destination: "BANDAR IMAM", length: 180, status: "Under way" },
  
  // Gulf of Oman
  { mmsi: "371234008", name: "NAVIG8 STANCE", type: "Chemical Tanker", category: "TANKER", lat: 25.30, lon: 57.80, speed: 13.4, course: 240, heading: 238, flag: "PA", destination: "MUSCAT", length: 183, status: "Under way" },
  { mmsi: "538890009", name: "BRITISH PIONEER", type: "Crude Oil Tanker", category: "TANKER", lat: 24.80, lon: 58.50, speed: 14.7, course: 85, heading: 83, flag: "MH", destination: "YANBU", length: 333, status: "Under way" },
  
  // Red Sea / Bab el-Mandeb
  { mmsi: "219345010", name: "MSC AURORA", type: "Container Ship", category: "CARGO", lat: 12.65, lon: 43.35, speed: 18.2, course: 340, heading: 338, flag: "DK", destination: "JEDDAH", length: 399, status: "Under way" },
  { mmsi: "636456011", name: "OVERSEAS CHINOOK", type: "Product Tanker", category: "TANKER", lat: 13.10, lon: 42.90, speed: 13.8, course: 155, heading: 153, flag: "LR", destination: "DJIBOUTI", length: 228, status: "Under way" },
  { mmsi: "477567012", name: "EVER LEGEND", type: "Container Ship", category: "CARGO", lat: 15.20, lon: 42.15, speed: 20.1, course: 335, heading: 333, flag: "HK", destination: "SUEZ", length: 400, status: "Under way" },
  
  // Suez Canal approach
  { mmsi: "241234013", name: "MINERVA HELEN", type: "Crude Oil Tanker", category: "TANKER", lat: 29.85, lon: 32.58, speed: 7.5, course: 0, heading: 358, flag: "GR", destination: "SUEZ CANAL", length: 274, status: "Under way" },
  { mmsi: "311890014", name: "TORM KRISTINA", type: "Product Tanker", category: "TANKER", lat: 29.92, lon: 32.55, speed: 6.8, course: 350, heading: 348, flag: "MH", destination: "SUEZ CANAL", length: 228, status: "Under way" },
  
  // Mediterranean
  { mmsi: "256345015", name: "CMA CGM TITAN", type: "Container Ship", category: "CARGO", lat: 34.50, lon: 28.80, speed: 19.5, course: 280, heading: 278, flag: "MT", destination: "PIRAEUS", length: 366, status: "Under way" },
  
  // Arabian Sea
  { mmsi: "538234016", name: "PACIFIC PARADISE", type: "Bulk Carrier", category: "CARGO", lat: 20.50, lon: 62.30, speed: 12.0, course: 45, heading: 43, flag: "MH", destination: "MUNDRA", length: 292, status: "Under way" },
  
  // Military / Naval
  { mmsi: "338901017", name: "USS EISENHOWER", type: "Aircraft Carrier", category: "NAVAL", lat: 25.10, lon: 57.20, speed: 18.0, course: 270, heading: 268, flag: "US", destination: "PATROL", length: 333, status: "Under way" },
  { mmsi: "338902018", name: "USS MASON", type: "Destroyer", category: "NAVAL", lat: 13.50, lon: 42.60, speed: 22.0, course: 180, heading: 178, flag: "US", destination: "PATROL", length: 155, status: "Under way" },
  { mmsi: "245901019", name: "HNLMS TROMP", type: "Frigate", category: "NAVAL", lat: 12.30, lon: 44.10, speed: 15.0, course: 90, heading: 88, flag: "NL", destination: "PATROL", length: 144, status: "Under way" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Add realistic position drift based on course/speed
    const now = Date.now();
    const driftFactor = (now % 60000) / 60000; // 0-1 over 60 seconds
    
    const vessels = BASE_VESSELS.map(v => {
      const drift = (v.speed / 3600) * driftFactor * 0.01; // tiny position change
      const courseRad = (v.course * Math.PI) / 180;
      return {
        ...v,
        lat: +(v.lat + Math.sin(courseRad) * drift * (0.8 + Math.random() * 0.4)).toFixed(5),
        lon: +(v.lon + Math.cos(courseRad) * drift * (0.8 + Math.random() * 0.4)).toFixed(5),
        speed: +(v.speed + (Math.random() - 0.5) * 0.4).toFixed(1),
        course: +((v.course + (Math.random() - 0.5) * 2) % 360).toFixed(1),
      };
    });

    return new Response(JSON.stringify({ vessels, total: vessels.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ais-proxy error:", e);
    return new Response(
      JSON.stringify({ vessels: [], error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
