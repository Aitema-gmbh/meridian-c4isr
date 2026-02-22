import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Keywords that indicate Iran/geopolitical relevance
const IRAN_KEYWORDS = [
  "iran", "iranian", "hormuz", "persian gulf", "irgc", "tehran",
  "nuclear", "jcpoa", "hezbollah", "houthi", "strait",
  "middle east", "israel", "us iran", "sanction",
  "oil", "crude", "opec", "war", "conflict", "military",
  "strike", "attack", "bomb", "missile", "drone",
  "gaza", "lebanon", "syria", "yemen", "gulf",
];

function isRelevant(text: string): boolean {
  const lower = text.toLowerCase();
  return IRAN_KEYWORDS.some((kw) => lower.includes(kw));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Fetch a large batch of active events across geopolitical tags
    const tags = ["iran", "middle-east", "geopolitics", "oil", "war", "military", "nuclear", "israel"];
    
    const results = await Promise.all(
      tags.map((tag) =>
        fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=15&tag=${encodeURIComponent(tag)}`)
          .then((r) => r.ok ? r.json() : [])
          .catch(() => [])
      )
    );

    // Deduplicate and filter for Iran relevance
    const seen = new Set<string>();
    const markets: any[] = [];

    for (const events of results) {
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        const id = event.id || event.slug;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const slug = event.slug || id;
        const url = `https://polymarket.com/event/${slug}`;
        const title = event.title || "";

        const eventMarkets = event.markets || [];
        for (const market of eventMarkets) {
          const question = market.question || title;
          // Filter: must be Iran/geopolitically relevant
          if (!isRelevant(question) && !isRelevant(title)) continue;

          const outcomePrices = market.outcomePrices
            ? (typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market.outcomePrices)
            : [];

          const yesPrice = outcomePrices[0] ? parseFloat(outcomePrices[0]) : null;
          const noPrice = outcomePrices[1] ? parseFloat(outcomePrices[1]) : null;

          markets.push({
            id: market.id || id,
            question,
            category: event.tags?.[0]?.label || event.category || "Geopolitical",
            yesPrice: yesPrice !== null ? Math.round(yesPrice * 100) : null,
            noPrice: noPrice !== null ? Math.round(noPrice * 100) : null,
            volume: parseFloat(market.volume || market.volumeNum || "0"),
            liquidity: parseFloat(market.liquidity || "0"),
            endDate: market.endDate || event.endDate,
            active: market.active ?? true,
            url,
          });
        }

        // If event title is relevant but has no sub-markets
        if (eventMarkets.length === 0 && isRelevant(title)) {
          markets.push({
            id,
            question: title,
            category: event.tags?.[0]?.label || "Geopolitical",
            yesPrice: null,
            noPrice: null,
            volume: 0,
            liquidity: 0,
            endDate: event.endDate,
            active: true,
            url,
          });
        }
      }
    }

    // Sort by volume descending
    markets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
    const topMarkets = markets.slice(0, 20);

    return new Response(
      JSON.stringify({ markets: topMarkets, timestamp: new Date().toISOString() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("prediction-markets error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error", markets: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
