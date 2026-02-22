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

    // Fetch GDELT articles and ADS-B military count in parallel
    const [gdeltResp, adsbResp] = await Promise.allSettled([
      fetch(
        "https://api.gdeltproject.org/api/v2/doc/doc?query=(iran OR hormuz OR \"persian gulf\" OR IRGC)&mode=artlist&format=json&maxrecords=12&sort=datedesc"
      ),
      fetch("https://api.adsb.lol/v2/mil"),
    ]);

    // Parse GDELT
    let articles: { title: string; url: string; seendate: string; domain: string; source?: string }[] = [];
    if (gdeltResp.status === "fulfilled" && gdeltResp.value.ok) {
      try {
        const text = await gdeltResp.value.text();
        // GDELT sometimes returns error text instead of JSON
        if (text.startsWith("{") || text.startsWith("[")) {
          const gdeltData = JSON.parse(text);
          articles = (gdeltData.articles || []).slice(0, 12);
        } else {
          console.error("GDELT returned non-JSON:", text.substring(0, 200));
        }
      } catch (e) {
        console.error("GDELT parse error:", e);
      }
    }

    // Parse ADS-B for Gulf region aircraft count
    let milTrackCount = 0;
    if (adsbResp.status === "fulfilled" && adsbResp.value.ok) {
      try {
        const adsbData = await adsbResp.value.json();
        const gulfAc = (adsbData.ac || []).filter(
          (a: any) =>
            a.lat != null && a.lon != null &&
            a.lat >= 20 && a.lat <= 35 &&
            a.lon >= 44 && a.lon <= 65
        );
        milTrackCount = gulfAc.length;
      } catch {
        console.error("ADS-B parse error");
      }
    }

    // If no articles, return empty with metadata
    if (articles.length === 0) {
      return new Response(
        JSON.stringify({
          items: [],
          metadata: { articleCount: 0, milTrackCount, timestamp: new Date().toISOString() },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send articles to Gemini Flash for analysis
    const articleSummaries = articles
      .map((a, i) => `[${i + 1}] "${a.title}" (${a.domain}, ${a.seendate})`)
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
            content: `You are an intelligence analyst. Analyze news articles about Iran/Persian Gulf/military activity. For each article, produce a structured intel brief. Respond ONLY via the tool call.`,
          },
          {
            role: "user",
            content: `Analyze these ${articles.length} articles and produce intel briefs:\n\n${articleSummaries}\n\nFor each article, classify priority, extract entities, score sentiment, and write a 1-2 sentence tactical summary.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "output_intel_items",
              description: "Output structured intelligence items from analyzed articles",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                        content: { type: "string", description: "1-2 sentence tactical intel summary" },
                        source: { type: "string", description: "Source identifier like OSINT/GDELT, OSINT/Reuters, etc." },
                        entities: {
                          type: "array",
                          items: { type: "string" },
                          description: "Key entities: military units, locations, political figures",
                        },
                        sentiment: { type: "number", description: "Sentiment score -1 to 1" },
                      },
                      required: ["priority", "content", "source", "entities", "sentiment"],
                      additionalProperties: false,
                    },
                  },
                  averageSentiment: { type: "number", description: "Average sentiment across all items" },
                },
                required: ["items", "averageSentiment"],
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
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      throw new Error("AI analysis failed");
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall?.function?.arguments) {
      throw new Error("No tool call response from AI");
    }

    const analyzed = JSON.parse(toolCall.function.arguments);

    // Add IDs and timestamps
    const items = (analyzed.items || []).map((item: any, i: number) => ({
      id: i + 1,
      timestamp: new Date(Date.now() - i * 300000).toISOString(),
      ...item,
    }));

    return new Response(
      JSON.stringify({
        items,
        metadata: {
          articleCount: articles.length,
          milTrackCount,
          averageSentiment: analyzed.averageSentiment ?? -0.5,
          timestamp: new Date().toISOString(),
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
