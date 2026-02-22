import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GDELT_STREAMS = [
  { query: '(iran OR hormuz OR "persian gulf" OR IRGC OR houthi OR pezeshkian OR larijani)', tag: "IRAN_GULF", max: 15 },
  { query: '("US military" OR CENTCOM OR deployment OR "5th fleet" OR "Abraham Lincoln" OR "carrier strike" OR "B-2" OR "Al Udeid" OR "Diego Garcia")', tag: "US_MILITARY", max: 12 },
  { query: '(theme:WMD OR theme:MILITARY OR theme:TERROR) AND (iran OR gulf)', tag: "GKG_THEMES", max: 10 },
  { query: '("nuclear" OR "uranium enrichment" OR IAEA OR Fordow OR Natanz OR Arak OR Parchin) AND iran', tag: "NUCLEAR", max: 8 },
  { query: '(Pezeshkian OR Larijani OR "nuclear talks" OR "nuclear deal" OR "Midnight Hammer" OR "JCPOA") AND (iran OR US)', tag: "CRISIS_2026", max: 10 },
];

async function fetchGdelt(stream: typeof GDELT_STREAMS[0]): Promise<any[]> {
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(stream.query)}&mode=artlist&format=json&maxrecords=${stream.max}&sort=datedesc`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const text = await resp.text();
    if (!text.startsWith("{") && !text.startsWith("[")) return [];
    const data = JSON.parse(text);
    return (data.articles || []).slice(0, stream.max).map((a: any) => ({ ...a, queryTag: stream.tag }));
  } catch { return []; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[agent-osint] Starting cycle...");

    // Fetch all GDELT streams in parallel
    const results = await Promise.all(GDELT_STREAMS.map(fetchGdelt));
    const allArticles = results.flat();

    // Deduplicate by URL
    const seen = new Set<string>();
    const articles = allArticles.filter(a => {
      if (!a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    console.log(`[agent-osint] ${articles.length} unique articles from ${GDELT_STREAMS.length} streams`);

    if (articles.length === 0) {
      await supabase.from("agent_reports").insert({
        agent_name: "osint", report_type: "cycle", data: { articles: [], streamCounts: {} },
        summary: "No GDELT articles found in this cycle.", threat_level: 0, confidence: "LOW", items_count: 0,
      });
      return new Response(JSON.stringify({ success: true, articleCount: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const articleSummaries = articles.map((a: any, i: number) =>
      `[${i + 1}] [${a.queryTag}] "${a.title}" (${a.domain}, ${a.seendate}) URL: ${a.url || "N/A"}`
    ).join("\n");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You are a senior OSINT analyst. Analyze articles from 4 intelligence streams (Iran/Gulf, US Military, GKG Themes, Nuclear). For each article produce an intel brief. Generate a 3-sentence FLASH REPORT. Respond ONLY via the tool call." },
          { role: "user", content: `Analyze these ${articles.length} articles from 4 OSINT streams:\n\n${articleSummaries}\n\nFor each: classify priority, assign threat_tag, extract entities, score sentiment, write tactical summary, preserve sourceUrl.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "output_osint_report",
            description: "Output structured OSINT intelligence report",
            parameters: {
              type: "object",
              properties: {
                flashReport: { type: "string" },
                dominantCategory: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC", "NUCLEAR"] },
                averageSentiment: { type: "number" },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                      content: { type: "string" },
                      source: { type: "string" },
                      sourceUrl: { type: "string" },
                      entities: { type: "array", items: { type: "string" } },
                      sentiment: { type: "number" },
                      threat_tag: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC", "NUCLEAR"] },
                      confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                    },
                    required: ["priority", "content", "source", "entities", "sentiment", "threat_tag", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["flashReport", "dominantCategory", "averageSentiment", "items"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "output_osint_report" } },
      }),
    });

    if (!aiResponse.ok) {
      console.error("[agent-osint] AI error:", aiResponse.status);
      // Save raw data even if AI fails
      await supabase.from("agent_reports").insert({
        agent_name: "osint", report_type: "cycle",
        data: { articles: articles.slice(0, 20), aiError: true },
        summary: `${articles.length} articles collected but AI analysis failed.`,
        threat_level: 30, confidence: "LOW", items_count: articles.length,
      });
      return new Response(JSON.stringify({ success: false, error: "AI failed" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("No tool call from AI");

    const analyzed = JSON.parse(toolCall.function.arguments);
    const items = (analyzed.items || []).map((item: any, i: number) => ({
      id: i + 1,
      timestamp: new Date(Date.now() - i * 300000).toISOString(),
      ...item,
    }));

    const streamCounts: Record<string, number> = {};
    articles.forEach((a: any) => { streamCounts[a.queryTag] = (streamCounts[a.queryTag] || 0) + 1; });

    // Save to agent_reports
    await supabase.from("agent_reports").insert({
      agent_name: "osint",
      report_type: "cycle",
      data: { items, flashReport: analyzed.flashReport, dominantCategory: analyzed.dominantCategory, streamCounts },
      summary: analyzed.flashReport || `${items.length} intel items analyzed.`,
      threat_level: Math.abs((analyzed.averageSentiment ?? -0.5) * 100),
      confidence: items.length > 10 ? "HIGH" : "MEDIUM",
      items_count: items.length,
    });

    // Backward compat: also save to intel_snapshots
    await supabase.from("intel_snapshots").insert({
      flash_report: analyzed.flashReport,
      article_count: articles.length,
      mil_track_count: 0,
      average_sentiment: analyzed.averageSentiment ?? -0.5,
      dominant_category: analyzed.dominantCategory || "MILITARY",
      items,
      source_type: "agent-osint",
    });

    // Welford baseline update
    const now = new Date();
    const dow = now.getUTCDay();
    const hour = now.getUTCHours();
    await Promise.all([
      supabase.from("agent_baselines").upsert({
        agent_name: "osint", metric_name: "article_count",
        day_of_week: dow, hour_of_day: hour,
        mean: articles.length, variance: 0, count: 1, updated_at: now.toISOString(),
      }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" }),
      supabase.from("agent_baselines").upsert({
        agent_name: "osint", metric_name: "threat_level",
        day_of_week: dow, hour_of_day: hour,
        mean: Math.abs((analyzed.averageSentiment ?? -0.5) * 100), variance: 0, count: 1, updated_at: now.toISOString(),
      }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" }),
    ]);

    console.log("[agent-osint] Report saved.", items.length, "items");
    return new Response(JSON.stringify({ success: true, itemCount: items.length, flashReport: analyzed.flashReport }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-osint] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
