import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Tickers to monitor for safe-haven flows and risk signals
const TICKERS = [
  { symbol: "CHFUSD=X", name: "CHF/USD", type: "safe-haven" },
  { symbol: "JPYUSD=X", name: "JPY/USD", type: "safe-haven" },
  { symbol: "GC=F", name: "Gold", type: "safe-haven" },
  { symbol: "CL=F", name: "Crude Oil", type: "commodity" },
  { symbol: "BZ=F", name: "Brent Crude", type: "commodity" },
  { symbol: "^VIX", name: "VIX", type: "volatility" },
];

interface TickerResult {
  symbol: string;
  name: string;
  type: string;
  price: number;
  change24h: number;
  changePct: number;
  zScore: number;
}

async function fetchYahooQuote(symbol: string): Promise<{ price: number; prevClose: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "MERIDIAN-OSINT/1.0" },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const result = data.chart?.result?.[0];
    if (!result) return null;

    const closes = result.indicators?.quote?.[0]?.close || [];
    const validCloses = closes.filter((c: number | null) => c !== null);
    if (validCloses.length < 2) return null;

    return {
      price: validCloses[validCloses.length - 1],
      prevClose: validCloses[validCloses.length - 2],
    };
  } catch (e) {
    console.error(`[agent-macro] Yahoo fetch failed for ${symbol}:`, e);
    return null;
  }
}

// Get 30-day historical for z-score calculation
async function fetchHistorical(symbol: string): Promise<number[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "MERIDIAN-OSINT/1.0" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    const closes = data.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    return closes.filter((c: number | null) => c !== null);
  } catch {
    return [];
  }
}

function welfordStats(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  let n = 0, mean = 0, m2 = 0;
  for (const x of values) {
    n++;
    const delta = x - mean;
    mean += delta / n;
    const delta2 = x - mean;
    m2 += delta * delta2;
  }
  return { mean, stddev: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0 };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[agent-macro] Starting macro/forex scan...");

    const results: TickerResult[] = [];

    // Fetch all tickers in parallel
    const tickerData = await Promise.all(
      TICKERS.map(async (ticker) => {
        const [quote, historical] = await Promise.all([
          fetchYahooQuote(ticker.symbol),
          fetchHistorical(ticker.symbol),
        ]);
        return { ticker, quote, historical };
      })
    );

    for (const { ticker, quote, historical } of tickerData) {
      if (!quote) continue;

      const change24h = quote.price - quote.prevClose;
      const changePct = (change24h / quote.prevClose) * 100;
      const { mean, stddev } = welfordStats(historical);
      const zScore = stddev > 0 ? (quote.price - mean) / stddev : 0;

      results.push({
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        price: Math.round(quote.price * 100) / 100,
        change24h: Math.round(change24h * 10000) / 10000,
        changePct: Math.round(changePct * 100) / 100,
        zScore: Math.round(zScore * 100) / 100,
      });
    }

    // Calculate Macro Risk Index (0-100)
    const safeHavens = results.filter(r => r.type === "safe-haven");
    const commodities = results.filter(r => r.type === "commodity");
    const vix = results.find(r => r.type === "volatility");

    // Safe-haven flow score: positive moves in CHF, JPY, Gold indicate risk-off
    const safeHavenScore = safeHavens.reduce((sum, r) => sum + Math.max(r.zScore, 0), 0) / Math.max(safeHavens.length, 1);

    // Oil spike score: large moves in oil indicate geopolitical risk
    const oilScore = commodities.reduce((sum, r) => sum + Math.abs(r.zScore), 0) / Math.max(commodities.length, 1);

    // VIX score
    const vixScore = vix ? Math.max(vix.zScore, 0) : 0;

    // Composite: weighted sum, clamped 0-100
    const macroRiskIndex = Math.round(Math.min(
      (safeHavenScore * 25) + (oilScore * 25) + (vixScore * 20) + 15, // base 15
      100
    ));

    const significantMoves = results.filter(r => Math.abs(r.zScore) > 1.5);

    const summary = significantMoves.length > 0
      ? `Macro Risk Index: ${macroRiskIndex}/100. ${significantMoves.length} significant moves: ${significantMoves.map(r => `${r.name} ${r.changePct > 0 ? "+" : ""}${r.changePct}% (Z=${r.zScore})`).join(", ")}.`
      : `Macro Risk Index: ${macroRiskIndex}/100. Markets nominal. No significant safe-haven flows or commodity spikes detected.`;

    // Update baselines
    const now = new Date();
    const dow = now.getUTCDay();
    const hour = now.getUTCHours();

    for (const r of results) {
      await supabase.from("agent_baselines").upsert({
        agent_name: "macro",
        metric_name: r.name,
        day_of_week: dow,
        hour_of_day: hour,
        mean: r.price,
        variance: 0,
        count: 30,
        updated_at: now.toISOString(),
      }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" });
    }

    // Save report
    await supabase.from("agent_reports").insert({
      agent_name: "macro",
      report_type: "cycle",
      data: {
        macroRiskIndex,
        tickers: results,
        safeHavenScore: Math.round(safeHavenScore * 100) / 100,
        oilScore: Math.round(oilScore * 100) / 100,
        vixScore: Math.round(vixScore * 100) / 100,
        significantMoves: significantMoves.map(r => `${r.name}: ${r.changePct > 0 ? "+" : ""}${r.changePct}%`),
      },
      summary,
      threat_level: macroRiskIndex,
      confidence: results.length >= 4 ? "HIGH" : "MEDIUM",
      items_count: significantMoves.length,
    });

    console.log(`[agent-macro] Done. Macro Risk Index: ${macroRiskIndex}, Significant moves: ${significantMoves.length}`);

    return new Response(JSON.stringify({ success: true, macroRiskIndex, moves: significantMoves.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-macro] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
