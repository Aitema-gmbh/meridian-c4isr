import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REDDIT_HEADERS = {
  "User-Agent": "MeridianIntel/1.0",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Fetch from 3 subreddits in parallel
    const [geo, world, iran] = await Promise.allSettled([
      fetch("https://www.reddit.com/r/geopolitics/search.json?q=iran&sort=new&limit=10&restrict_sr=on&t=week", { headers: REDDIT_HEADERS }),
      fetch("https://www.reddit.com/r/worldnews/search.json?q=iran+OR+hormuz+OR+persian+gulf&sort=new&limit=10&restrict_sr=on&t=week", { headers: REDDIT_HEADERS }),
      fetch("https://www.reddit.com/r/iran/hot.json?limit=10", { headers: REDDIT_HEADERS }),
    ]);

    const parseReddit = async (resp: PromiseSettledResult<Response>) => {
      if (resp.status !== "fulfilled" || !resp.value.ok) return [];
      try {
        const data = await resp.value.json();
        return (data?.data?.children || []).map((c: any) => ({
          title: c.data.title,
          score: c.data.score,
          comments: c.data.num_comments,
          url: `https://reddit.com${c.data.permalink}`,
          subreddit: c.data.subreddit_name_prefixed,
          created: c.data.created_utc,
          selftext: (c.data.selftext || "").slice(0, 200),
        }));
      } catch { return []; }
    };

    const [geoPosts, worldPosts, iranPosts] = await Promise.all([
      parseReddit(geo), parseReddit(world), parseReddit(iran),
    ]);

    const allPosts = [...geoPosts, ...worldPosts, ...iranPosts]
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    if (allPosts.length === 0) {
      return new Response(
        JSON.stringify({ items: [], metadata: { postCount: 0, timestamp: new Date().toISOString() } }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // AI analysis of Reddit posts
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
        // Return raw posts without AI analysis
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
