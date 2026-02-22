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
    const keywords = [
      "iran", "war", "conflict", "middle east", "military",
      "oil", "nuclear", "sanctions", "china", "taiwan", "russia", "ukraine",
    ];

    // Fetch multiple searches in parallel
    const queries = keywords.slice(0, 6).map((kw) =>
      fetch(
        `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=5&tag=${encodeURIComponent(kw)}`
      ).then((r) => r.ok ? r.json() : []).catch(() => [])
    );

    const results = await Promise.all(queries);

    // Deduplicate by event id
    const seen = new Set<string>();
    const markets: any[] = [];

    for (const events of results) {
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        const id = event.id || event.slug;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        // Extract market data from the event
        const eventMarkets = event.markets || [];
        for (const market of eventMarkets) {
          const outcomePrices = market.outcomePrices
            ? (typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market.outcomePrices)
            : [];

          const yesPrice = outcomePrices[0] ? parseFloat(outcomePrices[0]) : null;
          const noPrice = outcomePrices[1] ? parseFloat(outcomePrices[1]) : null;

          markets.push({
            id: market.id || id,
            question: market.question || event.title || "Unknown",
            category: event.tags?.[0]?.label || event.category || "Geopolitical",
            yesPrice: yesPrice !== null ? Math.round(yesPrice * 100) : null,
            noPrice: noPrice !== null ? Math.round(noPrice * 100) : null,
            volume: parseFloat(market.volume || market.volumeNum || "0"),
            liquidity: parseFloat(market.liquidity || "0"),
            endDate: market.endDate || event.endDate,
            active: market.active ?? true,
          });
        }

        // If no sub-markets, treat the event itself
        if (eventMarkets.length === 0 && event.title) {
          markets.push({
            id,
            question: event.title,
            category: event.tags?.[0]?.label || "Geopolitical",
            yesPrice: null,
            noPrice: null,
            volume: 0,
            liquidity: 0,
            endDate: event.endDate,
            active: true,
          });
        }
      }
    }

    // Sort by volume descending, take top 15
    markets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
    const topMarkets = markets.slice(0, 15);

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
