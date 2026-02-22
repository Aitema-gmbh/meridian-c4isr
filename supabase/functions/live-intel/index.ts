import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // 3 parallel GDELT queries + ADS-B
    const [gdelt1, gdelt2, gdelt3, adsbResp] = await Promise.allSettled([
      fetch("https://api.gdeltproject.org/api/v2/doc/doc?query=(iran OR hormuz OR \"persian gulf\" OR IRGC)&mode=artlist&format=json&maxrecords=12&sort=datedesc"),
      fetch("https://api.gdeltproject.org/api/v2/doc/doc?query=(\"US military\" OR CENTCOM OR deployment OR pentagon)&mode=artlist&format=json&maxrecords=10&sort=datedesc"),
      fetch("https://api.gdeltproject.org/api/v2/doc/doc?query=(\"cyber attack\" OR \"critical infrastructure\" OR APT OR ransomware)&mode=artlist&format=json&maxrecords=8&sort=datedesc"),
      fetch("https://api.adsb.lol/v2/mil"),
    ]);

    const parseGdelt = async (resp: PromiseSettledResult<Response>) => {
      if (resp.status !== "fulfilled" || !resp.value.ok) return [];
      try {
        const text = await resp.value.text();
        if (!text.startsWith("{") && !text.startsWith("[")) return [];
        const data = JSON.parse(text);
        return (data.articles || []);
      } catch { return []; }
    };

    const [arts1, arts2, arts3] = await Promise.all([
      parseGdelt(gdelt1), parseGdelt(gdelt2), parseGdelt(gdelt3)
    ]);

    const taggedArticles = [
      ...arts1.slice(0, 12).map((a: any) => ({ ...a, queryTag: "IRAN_GULF" })),
      ...arts2.slice(0, 10).map((a: any) => ({ ...a, queryTag: "US_MILITARY" })),
      ...arts3.slice(0, 8).map((a: any) => ({ ...a, queryTag: "CYBER" })),
    ];

    let milTrackCount = 0;
    if (adsbResp.status === "fulfilled" && adsbResp.value.ok) {
      try {
        const adsbData = await adsbResp.value.json();
        const gulfAc = (adsbData.ac || []).filter(
          (a: any) => a.lat != null && a.lon != null && a.lat >= 20 && a.lat <= 35 && a.lon >= 44 && a.lon <= 65
        );
        milTrackCount = gulfAc.length;
      } catch { console.error("ADS-B parse error"); }
    }

    if (taggedArticles.length === 0) {
      return new Response(
        JSON.stringify({
          items: [], flashReport: null,
          metadata: { articleCount: 0, milTrackCount, timestamp: new Date().toISOString(), dominantCategory: "NONE" },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Include URL in article summaries for AI to preserve
    const articleSummaries = taggedArticles
      .map((a: any, i: number) => `[${i + 1}] [${a.queryTag}] "${a.title}" (${a.domain}, ${a.seendate}) URL: ${a.url || 'N/A'}`)
      .join("\n");

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content: `You are a senior intelligence analyst. Analyze news articles from multiple intelligence streams (Iran/Gulf, US Military, Cyber). For each article produce an intel brief with threat_tag classification and confidence level. Preserve the original article URL as sourceUrl. Also generate a 3-sentence FLASH REPORT executive summary. Respond ONLY via the tool call.`,
          },
          {
            role: "user",
            content: `Analyze these ${taggedArticles.length} articles from 3 OSINT streams and produce intel briefs:\n\n${articleSummaries}\n\nFor each article: classify priority, assign a threat_tag (MARITIME, CYBER, DIPLOMATIC, MILITARY, ECONOMIC), set confidence (HIGH/MEDIUM/LOW), extract entities, score sentiment, write a 1-2 sentence tactical summary, and preserve the sourceUrl from the article.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "output_intel_items",
              description: "Output structured intelligence items with flash report",
              parameters: {
                type: "object",
                properties: {
                  flashReport: { type: "string", description: "3-sentence executive flash report" },
                  dominantCategory: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC"] },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                        content: { type: "string" },
                        source: { type: "string" },
                        sourceUrl: { type: "string", description: "Original article URL" },
                        entities: { type: "array", items: { type: "string" } },
                        sentiment: { type: "number" },
                        threat_tag: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC"] },
                        confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                      },
                      required: ["priority", "content", "source", "entities", "sentiment", "threat_tag", "confidence"],
                      additionalProperties: false,
                    },
                  },
                  averageSentiment: { type: "number" },
                },
                required: ["flashReport", "dominantCategory", "items", "averageSentiment"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "output_intel_items" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      throw new Error("AI analysis failed");
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("No tool call response from AI");

    const analyzed = JSON.parse(toolCall.function.arguments);
    const items = (analyzed.items || []).map((item: any, i: number) => ({
      id: i + 1,
      timestamp: new Date(Date.now() - i * 300000).toISOString(),
      ...item,
    }));

    return new Response(
      JSON.stringify({
        items,
        flashReport: analyzed.flashReport || null,
        metadata: {
          articleCount: taggedArticles.length,
          milTrackCount,
          averageSentiment: analyzed.averageSentiment ?? -0.5,
          timestamp: new Date().toISOString(),
          dominantCategory: analyzed.dominantCategory || "MILITARY",
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("live-intel error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
