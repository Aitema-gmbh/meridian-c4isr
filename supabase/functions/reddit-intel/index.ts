import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REDDIT_HEADERS = {
  "User-Agent": "web:MeridianIntel:v1.0 (by /u/meridian_osint)",
  "Accept": "application/json",
};

async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const resp = await fetch(url, { headers: REDDIT_HEADERS });
      if (resp.ok) return resp;
      if (resp.status === 429 && i < maxRetries) {
        console.log(`[reddit-intel] 429 on ${url}, retry ${i + 1}...`);
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      console.log(`[reddit-intel] ${url} returned ${resp.status}`);
      return resp;
    } catch (e) {
      console.log(`[reddit-intel] fetch error on ${url}:`, e);
      if (i < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Max retries exceeded");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Use Reddit RSS feeds (always public, no auth needed)
    const rssUrls = [
      "https://www.reddit.com/r/geopolitics/search.rss?q=iran&sort=new&limit=10&restrict_sr=on&t=week",
      "https://www.reddit.com/r/worldnews/search.rss?q=iran+OR+hormuz+OR+persian+gulf&sort=new&limit=10&restrict_sr=on&t=week",
      "https://www.reddit.com/r/iran/.rss?limit=10",
    ];

    const allResults: any[] = [];
    for (const url of rssUrls) {
      try {
        const resp = await fetchWithRetry(url);
        if (resp.ok) {
          const text = await resp.text();
          // Parse RSS/Atom XML for entries
          const entries = text.match(/<entry>[\s\S]*?<\/entry>/g) || [];
          const posts = entries.map((entry) => {
            const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/);
            const linkMatch = entry.match(/<link[^>]*href="([^"]*)"[^>]*\/>/);
            const updatedMatch = entry.match(/<updated>([\s\S]*?)<\/updated>/);
            const categoryMatch = entry.match(/<category[^>]*term="([^"]*)"[^>]*\/>/);
            return {
              title: (titleMatch?.[1] || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
              score: 0,
              comments: 0,
              url: linkMatch?.[1] || "",
              subreddit: categoryMatch?.[1] ? `r/${categoryMatch[1]}` : url.split("/r/")[1]?.split("/")[0] || "unknown",
              created: updatedMatch?.[1] ? Math.floor(new Date(updatedMatch[1]).getTime() / 1000) : Math.floor(Date.now() / 1000),
              selftext: "",
            };
          });
          allResults.push(...posts);
          console.log(`[reddit-intel] RSS: ${posts.length} posts from ${url.split("/r/")[1]?.split("/")[0] || url}`);
        } else {
          console.log(`[reddit-intel] RSS ${url.split("/r/")[1]?.split("/")[0]}: ${resp.status}`);
        }
      } catch (e) {
        console.log(`[reddit-intel] RSS fetch failed:`, e);
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    const allPosts = allResults
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    console.log(`[reddit-intel] Total posts collected: ${allPosts.length}`);

    if (allPosts.length === 0) {
      return new Response(
        JSON.stringify({ items: [], metadata: { postCount: 0, timestamp: new Date().toISOString() } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // AI analysis
    const postSummaries = allPosts
      .map((p, i) => `[${i + 1}] [${p.subreddit}] "${p.title}" (score: ${p.score}, comments: ${p.comments})`)
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
            content: `You are a social media intelligence analyst. Analyze Reddit posts about Iran/geopolitics. For each relevant post, produce a brief intel assessment. Filter out irrelevant posts. Respond ONLY via the tool call.`,
          },
          {
            role: "user",
            content: `Analyze these ${allPosts.length} Reddit posts for intelligence relevance:\n\n${postSummaries}\n\nFor each relevant post: classify priority (HIGH/MEDIUM/LOW), assign threat_tag (MARITIME/CYBER/DIPLOMATIC/MILITARY/ECONOMIC), extract key entities, score sentiment (-1 to 1), and write a 1-sentence summary. Only include genuinely relevant posts.`,
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "output_reddit_intel",
              description: "Output analyzed Reddit intelligence items",
              parameters: {
                type: "object",
                properties: {
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        postIndex: { type: "number", description: "1-based index of the original post" },
                        priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                        content: { type: "string", description: "1-sentence intel summary" },
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
                required: ["items"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "output_reddit_intel" } },
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429 || aiResponse.status === 402) {
        const rawItems = allPosts.slice(0, 10).map((p, i) => ({
          id: 1000 + i,
          timestamp: new Date(p.created * 1000).toISOString(),
          source: p.subreddit,
          sourceUrl: p.url,
          priority: p.score > 100 ? "HIGH" : p.score > 30 ? "MEDIUM" : "LOW" as const,
          content: p.title,
          entities: [],
          sentiment: 0,
          threat_tag: "DIPLOMATIC",
          confidence: "LOW",
          isReddit: true,
        }));
        return new Response(
          JSON.stringify({ items: rawItems, metadata: { postCount: allPosts.length, timestamp: new Date().toISOString() } }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error("AI analysis failed");
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) throw new Error("No tool call from AI");

    const analyzed = JSON.parse(toolCall.function.arguments);
    const items = (analyzed.items || []).map((item: any, i: number) => {
      const post = allPosts[item.postIndex - 1] || allPosts[0];
      return {
        id: 1000 + i,
        timestamp: new Date(post.created * 1000).toISOString(),
        source: post.subreddit,
        sourceUrl: post.url,
        priority: item.priority,
        content: item.content,
        entities: item.entities,
        sentiment: item.sentiment,
        threat_tag: item.threat_tag,
        confidence: item.confidence,
        isReddit: true,
      };
    });

    return new Response(
      JSON.stringify({
        items,
        metadata: { postCount: allPosts.length, timestamp: new Date().toISOString() },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("reddit-intel error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", items: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
