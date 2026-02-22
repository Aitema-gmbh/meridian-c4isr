import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RSS_FEEDS = [
  { url: "https://www.reddit.com/r/geopolitics/search.rss?q=iran+OR+pezeshkian+OR+larijani&sort=new&limit=10&restrict_sr=on&t=week", sub: "r/geopolitics" },
  { url: "https://www.reddit.com/r/worldnews/search.rss?q=iran+OR+hormuz+OR+persian+gulf+OR+pezeshkian&sort=new&limit=10&restrict_sr=on&t=week", sub: "r/worldnews" },
  { url: "https://www.reddit.com/r/CredibleDefense/search.rss?q=iran+OR+gulf+OR+CENTCOM+OR+carrier+OR+B-2&sort=new&limit=8&restrict_sr=on&t=week", sub: "r/CredibleDefense" },
  { url: "https://www.reddit.com/r/OSINT/search.rss?q=iran+OR+military+OR+hormuz&sort=new&limit=8&restrict_sr=on&t=week", sub: "r/OSINT" },
  { url: "https://www.reddit.com/r/iran/.rss?limit=10", sub: "r/iran" },
  { url: "https://www.reddit.com/r/NonCredibleDefense/search.rss?q=iran+OR+carrier+OR+B-2+OR+hormuz&sort=new&limit=8&restrict_sr=on&t=week", sub: "r/NCD" },
  { url: "https://www.reddit.com/r/LessCredibleDefence/search.rss?q=iran+OR+gulf+OR+strike&sort=new&limit=8&restrict_sr=on&t=week", sub: "r/LessCredibleDefence" },
];

const HEADERS = { "User-Agent": "web:MeridianIntel:v1.0 (by /u/meridian_osint)", Accept: "application/json" };

function parseAtomEntries(xml: string): { title: string; url: string; updated: string }[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map(entry => {
    const title = (entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    const url = entry.match(/<link[^>]*href="([^"]*)"[^>]*\/>/)?.[1] || "";
    const updated = entry.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] || "";
    return { title, url, updated };
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[agent-reddit] Starting cycle...");

    const allPosts: { title: string; url: string; sub: string; updated: string }[] = [];

    for (const feed of RSS_FEEDS) {
      try {
        const resp = await fetch(feed.url, { headers: HEADERS });
        if (resp.ok) {
          const text = await resp.text();
          const entries = parseAtomEntries(text);
          entries.forEach(e => allPosts.push({ ...e, sub: feed.sub }));
          console.log(`[agent-reddit] ${entries.length} posts from ${feed.sub}`);
        } else {
          console.log(`[agent-reddit] ${feed.sub}: ${resp.status}`);
        }
      } catch (e) {
        console.log(`[agent-reddit] ${feed.sub} fetch failed:`, e);
      }
      await new Promise(r => setTimeout(r, 600)); // Rate limit respect
    }

    console.log(`[agent-reddit] Total: ${allPosts.length} posts`);

    if (allPosts.length === 0) {
      await supabase.from("agent_reports").insert({
        agent_name: "reddit", report_type: "cycle", data: { posts: [] },
        summary: "No Reddit posts found.", threat_level: 0, confidence: "LOW", items_count: 0,
      });
      return new Response(JSON.stringify({ success: true, postCount: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const postSummaries = allPosts.slice(0, 25).map((p, i) =>
      `[${i + 1}] [${p.sub}] "${p.title}"`
    ).join("\n");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You are a social media intelligence analyst. Analyze Reddit posts for geopolitical intelligence signals about Iran/Gulf region. Filter irrelevant posts. Rate signal quality. Respond ONLY via tool call." },
          { role: "user", content: `Analyze these ${Math.min(allPosts.length, 25)} Reddit posts:\n\n${postSummaries}\n\nFor each relevant post: classify priority, assign threat_tag, extract entities, score sentiment, write 1-sentence intel summary. Skip irrelevant posts.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "output_reddit_intel",
            description: "Output analyzed Reddit intelligence",
            parameters: {
              type: "object",
              properties: {
                overallSignalStrength: { type: "string", enum: ["STRONG", "MODERATE", "WEAK", "NOISE"] },
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      postIndex: { type: "number" },
                      priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                      content: { type: "string" },
                      entities: { type: "array", items: { type: "string" } },
                      sentiment: { type: "number" },
                      threat_tag: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC"] },
                      confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                    },
                    required: ["postIndex", "priority", "content", "entities", "sentiment", "threat_tag", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["overallSignalStrength", "items"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "output_reddit_intel" } },
      }),
    });

    let analyzed: any = { items: [], overallSignalStrength: "NOISE" };
    if (aiResponse.ok) {
      const aiData = await aiResponse.json();
      const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (tc?.function?.arguments) analyzed = JSON.parse(tc.function.arguments);
    } else {
      console.error("[agent-reddit] AI error:", aiResponse.status);
    }

    const items = (analyzed.items || []).map((item: any, i: number) => {
      const post = allPosts[item.postIndex - 1] || allPosts[0];
      return { id: i + 1, source: post.sub, sourceUrl: post.url, isReddit: true, ...item };
    });

    const threatLevel = analyzed.overallSignalStrength === "STRONG" ? 70 :
      analyzed.overallSignalStrength === "MODERATE" ? 45 :
      analyzed.overallSignalStrength === "WEAK" ? 20 : 10;

    await supabase.from("agent_reports").insert({
      agent_name: "reddit",
      report_type: "cycle",
      data: { items, overallSignalStrength: analyzed.overallSignalStrength, totalPosts: allPosts.length },
      summary: `${items.length} relevant signals from ${allPosts.length} Reddit posts. Signal: ${analyzed.overallSignalStrength}.`,
      threat_level: threatLevel,
      confidence: allPosts.length > 15 ? "MEDIUM" : "LOW",
      items_count: items.length,
    });

    // Welford baseline update
    const now = new Date();
    const dow = now.getUTCDay();
    const hour = now.getUTCHours();
    await supabase.from("agent_baselines").upsert({
      agent_name: "reddit", metric_name: "signal_count",
      day_of_week: dow, hour_of_day: hour,
      mean: items.length, variance: 0, count: 1, updated_at: now.toISOString(),
    }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" });

    console.log("[agent-reddit] Report saved.", items.length, "signals");
    return new Response(JSON.stringify({ success: true, signalCount: items.length, signal: analyzed.overallSignalStrength }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-reddit] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
