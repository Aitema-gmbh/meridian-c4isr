import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing required environment variables");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[intel-agent] Starting hourly analysis run...");

    // ===== PHASE 1: Fetch all data sources in parallel =====
    const [gdelt1, gdelt2, gdelt3, adsbResp, reddit1, reddit2, reddit3, polymarket] = await Promise.allSettled([
      fetch("https://api.gdeltproject.org/api/v2/doc/doc?query=(iran OR hormuz OR \"persian gulf\" OR IRGC)&mode=artlist&format=json&maxrecords=12&sort=datedesc"),
      fetch("https://api.gdeltproject.org/api/v2/doc/doc?query=(\"US military\" OR CENTCOM OR deployment OR pentagon)&mode=artlist&format=json&maxrecords=10&sort=datedesc"),
      fetch("https://api.gdeltproject.org/api/v2/doc/doc?query=(\"cyber attack\" OR \"critical infrastructure\" OR APT OR ransomware)&mode=artlist&format=json&maxrecords=8&sort=datedesc"),
      fetch("https://api.adsb.lol/v2/mil"),
      fetch("https://www.reddit.com/r/geopolitics/search.json?q=iran&sort=new&limit=8&restrict_sr=on&t=week", { headers: { "User-Agent": "MeridianAgent/1.0" } }),
      fetch("https://www.reddit.com/r/worldnews/search.json?q=iran+OR+hormuz&sort=new&limit=8&restrict_sr=on&t=week", { headers: { "User-Agent": "MeridianAgent/1.0" } }),
      fetch("https://www.reddit.com/r/iran/hot.json?limit=8", { headers: { "User-Agent": "MeridianAgent/1.0" } }),
      fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=8&title_contains=${encodeURIComponent("iran")}`),
    ]);

    // Parse helpers
    const parseGdelt = async (resp: PromiseSettledResult<Response>) => {
      if (resp.status !== "fulfilled" || !resp.value.ok) return [];
      try { const t = await resp.value.text(); if (!t.startsWith("{") && !t.startsWith("[")) return []; return JSON.parse(t).articles || []; } catch { return []; }
    };
    const parseReddit = async (resp: PromiseSettledResult<Response>) => {
      if (resp.status !== "fulfilled" || !resp.value.ok) return [];
      try { const d = await resp.value.json(); return (d?.data?.children || []).map((c: any) => ({ title: c.data.title, score: c.data.score, subreddit: c.data.subreddit_name_prefixed, url: `https://reddit.com${c.data.permalink}` })); } catch { return []; }
    };

    const [arts1, arts2, arts3] = await Promise.all([parseGdelt(gdelt1), parseGdelt(gdelt2), parseGdelt(gdelt3)]);
    const [rPosts1, rPosts2, rPosts3] = await Promise.all([parseReddit(reddit1), parseReddit(reddit2), parseReddit(reddit3)]);

    const taggedArticles = [
      ...arts1.slice(0, 12).map((a: any) => ({ ...a, queryTag: "IRAN_GULF" })),
      ...arts2.slice(0, 10).map((a: any) => ({ ...a, queryTag: "US_MILITARY" })),
      ...arts3.slice(0, 8).map((a: any) => ({ ...a, queryTag: "CYBER" })),
    ];

    const redditPosts = [...rPosts1, ...rPosts2, ...rPosts3].sort((a: any, b: any) => b.score - a.score).slice(0, 15);

    // ADS-B
    let milTrackCount = 0;
    if (adsbResp.status === "fulfilled" && adsbResp.value.ok) {
      try { const d = await adsbResp.value.json(); milTrackCount = (d.ac || []).filter((a: any) => a.lat >= 20 && a.lat <= 35 && a.lon >= 44 && a.lon <= 65).length; } catch {}
    }

    // Polymarket
    const marketsList: any[] = [];
    if (polymarket.status === "fulfilled" && polymarket.value.ok) {
      try {
        const events = await polymarket.value.json();
        for (const ev of (Array.isArray(events) ? events : [])) {
          for (const m of (ev.markets || [])) {
            const op = m.outcomePrices ? (typeof m.outcomePrices === "string" ? JSON.parse(m.outcomePrices) : m.outcomePrices) : [];
            marketsList.push({ question: m.question || ev.title, yesPrice: op[0] ? Math.round(parseFloat(op[0]) * 100) : null, volume: parseFloat(m.volume || "0"), url: `https://polymarket.com/event/${ev.slug || ev.id}` });
          }
        }
      } catch {}
    }

    console.log(`[intel-agent] Data: ${taggedArticles.length} articles, ${redditPosts.length} reddit, ${milTrackCount} mil tracks, ${marketsList.length} markets`);

    // ===== PHASE 2: AI Analysis =====
    const articleSummaries = taggedArticles.map((a: any, i: number) => `[${i + 1}] [${a.queryTag}] "${a.title}" (${a.domain}) URL: ${a.url || 'N/A'}`).join("\n");
    const redditSummaries = redditPosts.map((p: any, i: number) => `[R${i + 1}] [${p.subreddit}] "${p.title}" (score: ${p.score})`).join("\n");
    const marketSummaries = marketsList.map((m: any) => `"${m.question}": ${m.yesPrice ?? '?'}% YES`).join("\n");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: `You are a senior intelligence analyst conducting an hourly SITREP. Analyze OSINT articles, Reddit social signals, military tracking data, and prediction market odds. Produce: (1) intel items with source URLs, (2) a comprehensive FLASH REPORT, (3) threat probabilities, (4) WATCHCON level. Compare your threat assessment against prediction market prices and flag divergences.` },
          { role: "user", content: `HOURLY INTELLIGENCE ANALYSIS\n\n=== GDELT ARTICLES (${taggedArticles.length}) ===\n${articleSummaries}\n\n=== REDDIT SOCIAL SIGNALS (${redditPosts.length}) ===\n${redditSummaries}\n\n=== ADS-B MILITARY ===\n${milTrackCount} military aircraft tracks in Gulf AOR\n\n=== POLYMARKET ODDS ===\n${marketSummaries || "No markets found"}\n\nProduce a comprehensive hourly analysis.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "output_hourly_analysis",
            description: "Output the comprehensive hourly intelligence analysis",
            parameters: {
              type: "object",
              properties: {
                flashReport: { type: "string", description: "5-sentence comprehensive SITREP" },
                dominantCategory: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC"] },
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
                      threat_tag: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC"] },
                      confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                      isReddit: { type: "boolean" },
                    },
                    required: ["priority", "content", "source", "entities", "sentiment", "threat_tag", "confidence"],
                    additionalProperties: false,
                  },
                },
                tensionIndex: { type: "number" },
                hormuzClosure: { type: "number" },
                cyberAttack: { type: "number" },
                proxyEscalation: { type: "number" },
                directConfrontation: { type: "number" },
                watchcon: { type: "string" },
                analysisNarrative: { type: "string" },
                marketDivergences: { type: "array", items: { type: "string" } },
              },
              required: ["flashReport", "dominantCategory", "averageSentiment", "items", "tensionIndex", "hormuzClosure", "cyberAttack", "proxyEscalation", "directConfrontation", "watchcon", "analysisNarrative"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "output_hourly_analysis" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("[intel-agent] AI error:", aiResponse.status, errText);
      throw new Error(`AI analysis failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("No tool call from AI");

    const analysis = JSON.parse(toolCall.function.arguments);
    const items = (analysis.items || []).map((item: any, i: number) => ({
      id: i + 1,
      timestamp: new Date(Date.now() - i * 300000).toISOString(),
      ...item,
    }));

    // ===== PHASE 3: Store in database =====
    const [intelResult, marketResult, threatResult] = await Promise.allSettled([
      supabase.from("intel_snapshots").insert({
        flash_report: analysis.flashReport,
        article_count: taggedArticles.length,
        mil_track_count: milTrackCount,
        average_sentiment: analysis.averageSentiment ?? -0.5,
        dominant_category: analysis.dominantCategory || "MILITARY",
        items: items,
        source_type: "combined",
      }),
      supabase.from("market_snapshots").insert({
        markets: marketsList,
      }),
      supabase.from("threat_assessments").insert({
        tension_index: analysis.tensionIndex ?? 50,
        watchcon: analysis.watchcon || "3",
        hormuz_closure: analysis.hormuzClosure ?? 0,
        cyber_attack: analysis.cyberAttack ?? 0,
        proxy_escalation: analysis.proxyEscalation ?? 0,
        direct_confrontation: analysis.directConfrontation ?? 0,
        analysis_narrative: analysis.analysisNarrative || "",
        market_divergences: analysis.marketDivergences || [],
        raw_indicators: {
          articleCount: taggedArticles.length,
          milTrackCount,
          redditPostCount: redditPosts.length,
          marketCount: marketsList.length,
        },
      }),
    ]);

    console.log("[intel-agent] Storage results:",
      intelResult.status === "fulfilled" ? "intel OK" : "intel FAIL",
      marketResult.status === "fulfilled" ? "markets OK" : "markets FAIL",
      threatResult.status === "fulfilled" ? "threat OK" : "threat FAIL"
    );

    return new Response(
      JSON.stringify({
        success: true,
        items,
        flashReport: analysis.flashReport,
        metadata: {
          articleCount: taggedArticles.length,
          milTrackCount,
          averageSentiment: analysis.averageSentiment,
          dominantCategory: analysis.dominantCategory,
          redditPostCount: redditPosts.length,
          marketCount: marketsList.length,
          timestamp: new Date().toISOString(),
        },
        threat: {
          tensionIndex: analysis.tensionIndex,
          watchcon: analysis.watchcon,
          hormuzClosure: analysis.hormuzClosure,
          cyberAttack: analysis.cyberAttack,
          proxyEscalation: analysis.proxyEscalation,
          directConfrontation: analysis.directConfrontation,
          analysisNarrative: analysis.analysisNarrative,
          marketDivergences: analysis.marketDivergences,
        },
        markets: marketsList,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[intel-agent] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
