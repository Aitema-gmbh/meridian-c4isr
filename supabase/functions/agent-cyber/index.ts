import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GDELT_CYBER_QUERIES = [
  { query: '("cyber attack" OR APT OR ransomware OR "critical infrastructure" OR "power grid") AND (iran OR gulf OR "middle east")', tag: "CYBER_GENERAL", max: 12 },
  { query: '("APT33" OR "APT34" OR "APT35" OR "Charming Kitten" OR "MuddyWater" OR "OilRig" OR "Peach Sandstorm")', tag: "IRAN_APT", max: 10 },
];

async function fetchGdelt(query: string, max: number): Promise<any[]> {
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${max}&sort=datedesc`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const text = await resp.text();
    if (!text.startsWith("{") && !text.startsWith("[")) return [];
    return (JSON.parse(text).articles || []).slice(0, max);
  } catch { return []; }
}

async function fetchOTXPulses(apiKey: string): Promise<any[]> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const resp = await fetch(`https://otx.alienvault.com/api/v1/pulses/subscribed?modified_since=${since}&limit=20`, {
      headers: { "X-OTX-API-KEY": apiKey },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const iranKeywords = ["iran", "apt33", "apt34", "apt35", "charming kitten", "muddywater", "oilrig", "peach sandstorm", "gulf", "middle east"];
    return (data.results || []).filter((p: any) => {
      const text = (p.name + " " + (p.description || "")).toLowerCase();
      return iranKeywords.some(kw => text.includes(kw));
    });
  } catch (e) {
    console.log("[agent-cyber] OTX fetch error:", e);
    return [];
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const OTX_API_KEY = Deno.env.get("OTX_API_KEY");
    console.log("[agent-cyber] Starting cycle... OTX:", OTX_API_KEY ? "enabled" : "disabled");

    // Fetch GDELT + OTX in parallel
    const [gdeltResults, otxPulses] = await Promise.all([
      Promise.all(GDELT_CYBER_QUERIES.map(q => fetchGdelt(q.query, q.max))),
      OTX_API_KEY ? fetchOTXPulses(OTX_API_KEY) : Promise.resolve([]),
    ]);

    const gdeltArticles = gdeltResults.flat();
    // Deduplicate
    const seen = new Set<string>();
    const articles = gdeltArticles.filter(a => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    console.log(`[agent-cyber] ${articles.length} GDELT articles, ${otxPulses.length} OTX pulses`);

    const articleSummaries = articles.slice(0, 15).map((a: any, i: number) =>
      `[${i + 1}] "${a.title}" (${a.domain})`
    ).join("\n");

    const otxSummaries = otxPulses.slice(0, 10).map((p: any, i: number) =>
      `[OTX${i + 1}] "${p.name}" - ${(p.description || "").slice(0, 100)} (indicators: ${p.indicator_count || 0})`
    ).join("\n");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You are a cyber threat intelligence analyst. Analyze GDELT cyber articles and AlienVault OTX threat pulses related to Iran/Gulf region. Identify active APT campaigns, critical infrastructure threats, and overall cyber threat level. Respond ONLY via tool call." },
          { role: "user", content: `CYBER THREAT ANALYSIS\n\nGDELT Articles (${articles.length}):\n${articleSummaries || "None"}\n\nAlienVault OTX Pulses (${otxPulses.length}):\n${otxSummaries || "None (no API key configured)"}\n\nAssess the cyber threat landscape targeting Gulf/Iran infrastructure.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "output_cyber_report",
            description: "Output cyber threat assessment",
            parameters: {
              type: "object",
              properties: {
                cyberThreatLevel: { type: "number", description: "0-100 cyber threat level" },
                summary: { type: "string", description: "2-3 sentence cyber threat assessment" },
                activeAPTs: { type: "array", items: { type: "string" }, description: "Active APT groups" },
                targetSectors: { type: "array", items: { type: "string" }, description: "Targeted sectors" },
                criticalAlerts: { type: "array", items: { type: "string" }, description: "Critical alerts" },
              },
              required: ["cyberThreatLevel", "summary", "activeAPTs", "targetSectors", "criticalAlerts"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "output_cyber_report" } },
      }),
    });

    let analysis: any = { cyberThreatLevel: 30, summary: "Baseline cyber monitoring.", activeAPTs: [], targetSectors: [], criticalAlerts: [] };
    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (tc?.function?.arguments) analysis = JSON.parse(tc.function.arguments);
    } else {
      console.error("[agent-cyber] AI error:", aiResponse.status);
    }

    await supabase.from("agent_reports").insert({
      agent_name: "cyber",
      report_type: "cycle",
      data: {
        cyberThreatLevel: analysis.cyberThreatLevel,
        activeAPTs: analysis.activeAPTs,
        targetSectors: analysis.targetSectors,
        criticalAlerts: analysis.criticalAlerts,
        gdeltCount: articles.length,
        otxCount: otxPulses.length,
        otxEnabled: !!OTX_API_KEY,
      },
      summary: analysis.summary,
      threat_level: analysis.cyberThreatLevel,
      confidence: (articles.length + otxPulses.length) > 5 ? "MEDIUM" : "LOW",
      items_count: articles.length + otxPulses.length,
    });

    console.log("[agent-cyber] Report saved. Threat:", analysis.cyberThreatLevel);
    return new Response(JSON.stringify({ success: true, cyberThreatLevel: analysis.cyberThreatLevel }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-cyber] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
