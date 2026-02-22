import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  // 2026 crisis slugs
  "us-iran-war-2026",
  "us-strikes-iran-nuclear-2026",
  "strait-of-hormuz-closure-2026",
  "iran-regime-change-2026",
  "will-the-us-strike-iran-in-2026",
  "iran-nuclear-weapon-by-end-of-2026",
];

const IRAN_KEYWORDS = ["iran", "iranian", "tehran", "khamenei", "irgc", "hormuz", "persian gulf", "pezeshkian", "larijani", "nuclear deal", "nuclear talks", "midnight hammer", "strike", "war", "fordow", "natanz", "ballistic missile"];

function isIranRelated(text: string): boolean {
  const lower = text.toLowerCase();
  return IRAN_KEYWORDS.some(kw => lower.includes(kw));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[agent-markets] Starting cycle...");

    // Fetch from multiple sources in parallel
    const fetches: Promise<any[]>[] = [];

    for (const slug of IRAN_SLUGS) {
      fetches.push(
        fetch(`https://gamma-api.polymarket.com/events?slug=${slug}&active=true&closed=false`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
      );
    }
    for (const tag of ["iran", "middle-east"]) {
      fetches.push(
        fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20&tag=${tag}`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
      );
    }
    for (const term of ["iran", "iranian", "khamenei", "hormuz"]) {
      fetches.push(
        fetch(`https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20&title_contains=${encodeURIComponent(term)}`)
          .then(r => r.ok ? r.json() : []).catch(() => [])
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
        const title = event.title || "";
        const hasIranTag = event.tags?.some((t: any) => ["iran", "middle-east"].includes(t.slug?.toLowerCase()));

        for (const market of (event.markets || [])) {
          const question = market.question || title;
          if (!isIranRelated(question) && !isIranRelated(title) && !hasIranTag) continue;
          if (market.closed) continue;

          seen.add(id);
          const outcomePrices = market.outcomePrices
            ? (typeof market.outcomePrices === "string" ? JSON.parse(market.outcomePrices) : market.outcomePrices)
            : [];

          markets.push({
            id: market.id || id,
            question,
            yesPrice: outcomePrices[0] ? Math.round(parseFloat(outcomePrices[0]) * 100) : null,
            noPrice: outcomePrices[1] ? Math.round(parseFloat(outcomePrices[1]) * 100) : null,
            volume: parseFloat(market.volume || market.volumeNum || "0"),
            liquidity: parseFloat(market.liquidity || market.liquidityNum || "0"),
            endDate: market.endDate || event.endDate,
            url: `https://polymarket.com/event/${slug}`,
          });
        }

        if (!seen.has(id) && (isIranRelated(title) || hasIranTag)) {
          seen.add(id);
          markets.push({ id, question: title, yesPrice: null, noPrice: null, volume: 0, liquidity: 0, endDate: event.endDate, url: `https://polymarket.com/event/${slug}` });
        }
      }
    }

    markets.sort((a, b) => (b.volume || 0) - (a.volume || 0));
    const topMarkets = markets.slice(0, 25);

    // Get last snapshot for trend detection
    const { data: lastSnapshot } = await supabase
      .from("market_snapshots")
      .select("markets")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    const lastMarkets = (lastSnapshot?.markets as any[]) || [];
    const significantMoves: string[] = [];

    for (const market of topMarkets) {
      if (market.yesPrice == null) continue;
      const prev = lastMarkets.find((m: any) => m.id === market.id || m.question === market.question);
      if (prev?.yesPrice != null) {
        const diff = market.yesPrice - prev.yesPrice;
        if (Math.abs(diff) >= 5) {
          significantMoves.push(`"${market.question.slice(0, 60)}": ${prev.yesPrice}% → ${market.yesPrice}% (${diff > 0 ? "+" : ""}${diff}%)`);
        }
      }
    }

    const summary = `${topMarkets.length} Iran-related markets tracked.${significantMoves.length > 0 ? ` Significant moves: ${significantMoves.join("; ")}` : " No significant price movements."}`;

    await supabase.from("agent_reports").insert({
      agent_name: "markets",
      report_type: "cycle",
      data: { markets: topMarkets, significantMoves, marketCount: topMarkets.length },
      summary,
      threat_level: significantMoves.length * 15 + (topMarkets.some(m => (m.yesPrice || 0) > 50) ? 20 : 0),
      confidence: topMarkets.length > 5 ? "HIGH" : "MEDIUM",
      items_count: topMarkets.length,
    });

    // Backward compat
    await supabase.from("market_snapshots").insert({ markets: topMarkets });

    // Welford baseline update
    const now = new Date();
    const dow = now.getUTCDay();
    const hour = now.getUTCHours();
    await supabase.from("agent_baselines").upsert({
      agent_name: "markets", metric_name: "market_count",
      day_of_week: dow, hour_of_day: hour,
      mean: topMarkets.length, variance: 0, count: 1, updated_at: now.toISOString(),
    }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" });

    console.log("[agent-markets] Report saved.", topMarkets.length, "markets,", significantMoves.length, "moves");
    return new Response(JSON.stringify({ success: true, marketCount: topMarkets.length, moves: significantMoves.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-markets] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
