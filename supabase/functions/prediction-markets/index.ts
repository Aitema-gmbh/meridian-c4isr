import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Known Iran-related event slugs on Polymarket
const IRAN_SLUGS = [
  "will-the-iranian-regime-fall-by-the-end-of-2026",
  "will-the-us-invade-iran-by-march-31",
  "iran-strike-on-us-military-by-march-31",
  "khamenei-out-as-supreme-leader-of-iran-by-december-31-2026",
  "will-the-iranian-regime-fall-by-june-30",
  "will-the-us-strike-iran-in-2025",
  "us-iran-war-2025",
  "iran-nuclear-weapon-2025",
  "iran-nuclear-weapon-2026",
  "us-strikes-iran-nuclear",
  "will-iran-get-a-nuclear-weapon-in-2025",
];

// Iran-specific keywords for filtering
const IRAN_KEYWORDS = [
  "iran", "iranian", "tehran", "khamenei", "irgc", "hormuz",
  "persian gulf", "raisi", "pezeshkian",
];

function isIranRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return IRAN_KEYWORDS.some((kw) => lower.includes(kw));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Strategy: fetch by known slugs + search by tag "iran" + keyword searches
    const fetches: Promise<any[]>[] = [];

    // 1. Fetch each known slug
    for (const slug of IRAN_SLUGS) {
      fetches.push(
        fetch(`https://gamma-api.polymarket.com/events?slug=${slug}&active=true&closed=false`)
          .then((r) => r.ok ? r.json() : [])
          .catch(() => [])
      );
    }

    // 2. Search by tag
    for (const tag of ["iran", "middle-east"]) {
      fetches.push(
        fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20&tag=${tag}`)
          .then((r) => r.ok ? r.json() : [])
          .catch(() => [])
      );
    }

    // 3. Keyword searches that might catch Iran markets
    for (const term of ["iran", "iranian", "khamenei", "hormuz", "tehran"]) {
      fetches.push(
        fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20&title_contains=${encodeURIComponent(term)}`)
          .then((r) => r.ok ? r.json() : [])
          .catch(() => [])
      );
    }

    const results = await Promise.all(fetches);

    const seen = new Set<string>();
    const markets: any[] = [];

    for (const events of results) {
      if (!Array.isArray(events)) continue;
      for (const event of events) {
        const id = event.id || event.slug;
        if (!id || seen.has(id)) continue;

        const slug = event.slug || id;
        const url = `https://polymarket.com/event/${slug}`;
        const title = event.title || "";

        // Check if event has Iran tag
        const hasIranTag = event.tags?.some((t: any) =>
          ["iran", "middle-east", "israel"].includes(t.slug?.toLowerCase())
        );

        const eventMarkets = event.markets || [];
        let addedFromEvent = false;

        for (const market of eventMarkets) {
          const question = market.question || title;
          // Only include if Iran-related (by text or tag)
          if (!isIranRelated(question) && !isIranRelated(title) && !hasIranTag) continue;
          // Skip closed sub-markets
          if (market.closed) continue;

          seen.add(id);
          addedFromEvent = true;

          const outcomePrices = market.outcomePrices
            ? (typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market.outcomePrices)
            : [];

          const yesPrice = outcomePrices[0] ? parseFloat(outcomePrices[0]) : null;
          const noPrice = outcomePrices[1] ? parseFloat(outcomePrices[1]) : null;

          markets.push({
            id: market.id || id,
            question,
            category: event.tags?.find((t: any) => t.slug === "iran")?.label || "Iran",
            yesPrice: yesPrice !== null ? Math.round(yesPrice * 100) : null,
            noPrice: noPrice !== null ? Math.round(noPrice * 100) : null,
            volume: parseFloat(market.volume || market.volumeNum || "0"),
            liquidity: parseFloat(market.liquidity || market.liquidityNum || "0"),
            endDate: market.endDate || event.endDate,
            active: market.active ?? true,
            url,
          });
        }

        // If no sub-markets but event is Iran-related
        if (!addedFromEvent && eventMarkets.length === 0 && (isIranRelated(title) || hasIranTag)) {
          seen.add(id);
          markets.push({
            id,
            question: title,
            category: "Iran",
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
