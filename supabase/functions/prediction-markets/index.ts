import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEARCH_KEYWORDS = [
  "iran", "war", "conflict", "middle east", "nuclear", "sanctions",
  "oil", "hormuz", "military", "israel", "strike", "attack",
  "china", "russia", "nato", "missile", "drone", "gaza", "hezbollah",
  "yemen", "houthi", "syria", "lebanon", "geopolitical",
];

function isGeopolitical(text: string): boolean {
  const lower = text.toLowerCase();
  return SEARCH_KEYWORDS.some((kw) => lower.includes(kw));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Search multiple keywords in parallel
    const searchTerms = ["iran", "war", "middle east", "nuclear", "oil crisis", "military conflict", "israel"];

    const results = await Promise.all(
      searchTerms.map((term) =>
        fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=10&title_contains=${encodeURIComponent(term)}`)
          .then((r) => r.ok ? r.json() : [])
          .catch(() => [])
      )
    );

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
          if (!isGeopolitical(question) && !isGeopolitical(title)) continue;

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

        if (eventMarkets.length === 0 && isGeopolitical(title)) {
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

    markets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
    const topMarkets = markets.slice(0, 25);

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
