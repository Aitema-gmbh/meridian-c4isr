import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RSS_FEEDS = [
  { url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.aspx?ContentType=1&Site=945", tag: "RELEASES" },
  { url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.aspx?ContentType=400&Site=945", tag: "CONTRACTS" },
  { url: "https://www.defense.gov/DesktopModules/ArticleCS/RSS.aspx?ContentType=9&Site=945", tag: "ADVISORIES" },
];

const IRAN_KEYWORDS = ["iran", "iranian", "irgc", "hormuz", "persian gulf", "centcom", "houthi", "middle east", "gulf", "5th fleet", "navy", "strait", "tehran", "nuclear"];

function parseRssItems(xml: string): { title: string; link: string; pubDate: string; description: string }[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map(item => ({
    title: item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] || item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "",
    link: item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "",
    pubDate: item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "",
    description: item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] || item.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "",
  }));
}

function isRelevant(text: string): boolean {
  const lower = text.toLowerCase();
  return IRAN_KEYWORDS.some(kw => lower.includes(kw));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[agent-pentagon] Starting cycle...");

    // Fetch Pentagon RSS + CENTCOM via GDELT
    const [rssResults, centcomResp] = await Promise.all([
      Promise.all(RSS_FEEDS.map(async feed => {
        try {
          const resp = await fetch(feed.url);
          if (!resp.ok) return [];
          const text = await resp.text();
          return parseRssItems(text).map(item => ({ ...item, tag: feed.tag }));
        } catch { return []; }
      })),
      fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=domain:centcom.mil&mode=artlist&format=json&maxrecords=10&sort=datedesc`)
        .then(r => r.ok ? r.json() : { articles: [] })
        .catch(() => ({ articles: [] })),
    ]);

    const allRssItems = rssResults.flat();
    const centcomArticles = (centcomResp.articles || []).map((a: any) => ({
      title: a.title, link: a.url, pubDate: a.seendate, description: "", tag: "CENTCOM",
    }));

    const allItems = [...allRssItems, ...centcomArticles];
    const relevantItems = allItems.filter(item => isRelevant(item.title + " " + item.description));

    console.log(`[agent-pentagon] ${allItems.length} total items, ${relevantItems.length} relevant`);

    // Nighttime activity proxy (Pentagon "pizza metric")
    const now = new Date();
    const estHour = (now.getUTCHours() - 5 + 24) % 24;
    const isNighttime = estHour >= 22 || estHour <= 5;
    const recentItems = allItems.filter(item => {
      const pubDate = new Date(item.pubDate);
      return (now.getTime() - pubDate.getTime()) < 6 * 60 * 60 * 1000; // last 6 hours
    });
    const nighttimeReleaseCount = isNighttime ? recentItems.length : 0;

    // Pentagon Activity Index
    let activityIndex = Math.min(100, relevantItems.length * 8 + nighttimeReleaseCount * 15);

    if (relevantItems.length === 0 && allItems.length === 0) {
      await supabase.from("agent_reports").insert({
        agent_name: "pentagon", report_type: "cycle", data: { items: [], activityIndex: 0 },
        summary: "No Pentagon data available.", threat_level: 0, confidence: "LOW", items_count: 0,
      });
      return new Response(JSON.stringify({ success: true, itemCount: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // AI analysis of relevant items
    const itemSummaries = relevantItems.slice(0, 15).map((item, i) =>
      `[${i + 1}] [${item.tag}] "${item.title}" (${item.pubDate})`
    ).join("\n");

    // Also include contract summaries for anomaly detection
    const contractItems = allItems.filter(i => i.tag === "CONTRACTS").slice(0, 10);
    const contractSummaries = contractItems.map((c, i) =>
      `[C${i + 1}] "${c.title}"`
    ).join("\n");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You are a Pentagon analyst. Analyze DoD press releases, contracts, and CENTCOM statements. Identify Iran/Gulf-related activity, unusual contract patterns (large Navy orders, munitions), and overall Pentagon activity level. Respond ONLY via tool call." },
          { role: "user", content: `PENTAGON ANALYSIS\n\nRelevant items (${relevantItems.length}):\n${itemSummaries || "None"}\n\nRecent contracts:\n${contractSummaries || "None"}\n\nMetadata: ${isNighttime ? "NIGHTTIME releases detected (" + nighttimeReleaseCount + ")" : "Normal hours"}. Total items across all feeds: ${allItems.length}.\n\nAnalyze for anomalies and Iran/Gulf relevance.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "output_pentagon_report",
            description: "Output Pentagon activity analysis",
            parameters: {
              type: "object",
              properties: {
                pentagonActivityIndex: { type: "number", description: "0-100 activity level" },
                summary: { type: "string", description: "2-3 sentence assessment" },
                contractAnomalies: { type: "array", items: { type: "string" } },
                keyFindings: { type: "array", items: { type: "string" } },
                nighttimeFlag: { type: "boolean" },
              },
              required: ["pentagonActivityIndex", "summary", "contractAnomalies", "keyFindings", "nighttimeFlag"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "output_pentagon_report" } },
      }),
    });

    let analysis: any = { pentagonActivityIndex: activityIndex, summary: `${relevantItems.length} relevant items found.`, contractAnomalies: [], keyFindings: [], nighttimeFlag: isNighttime };
    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (tc?.function?.arguments) analysis = JSON.parse(tc.function.arguments);
    }

    await supabase.from("agent_reports").insert({
      agent_name: "pentagon",
      report_type: "cycle",
      data: {
        activityIndex: analysis.pentagonActivityIndex,
        relevantItems: relevantItems.slice(0, 15),
        contractAnomalies: analysis.contractAnomalies,
        keyFindings: analysis.keyFindings,
        nighttimeFlag: analysis.nighttimeFlag,
        totalItems: allItems.length,
      },
      summary: analysis.summary,
      threat_level: analysis.pentagonActivityIndex,
      confidence: relevantItems.length > 5 ? "HIGH" : "MEDIUM",
      items_count: relevantItems.length,
    });

    // Welford baseline update
    const now = new Date();
    const dow = now.getUTCDay();
    const hour = now.getUTCHours();
    await supabase.from("agent_baselines").upsert({
      agent_name: "pentagon", metric_name: "activity_index",
      day_of_week: dow, hour_of_day: hour,
      mean: analysis.pentagonActivityIndex, variance: 0, count: 1, updated_at: now.toISOString(),
    }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" });

    console.log("[agent-pentagon] Report saved. Activity:", analysis.pentagonActivityIndex);
    return new Response(JSON.stringify({ success: true, activityIndex: analysis.pentagonActivityIndex }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-pentagon] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
