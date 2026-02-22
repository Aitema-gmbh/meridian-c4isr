import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Wikipedia articles to monitor for crisis signals
const WATCH_ARTICLES = [
  "Strait_of_Hormuz",
  "Iran–United_States_relations",
  "Islamic_Revolutionary_Guard_Corps",
  "Iran–Israel_proxy_conflict",
  "Houthi_movement",
  "Persian_Gulf",
  "USS_Abraham_Lincoln_(CVN-72)",
  "United_States_Central_Command",
  "Iranian_nuclear_program",
  "Iran–Saudi_Arabia_relations",
  "Yemen_crisis_(2011–present)",
  "Hezbollah",
  "Islamic_Republic_of_Iran_Navy",
  "Gulf_of_Oman",
  "Bab-el-Mandeb",
  // 2026 Iran/US crisis additions
  "Masoud_Pezeshkian",
  "Ali_Larijani",
  "Joint_Comprehensive_Plan_of_Action",
  "Fordow_Fuel_Enrichment_Plant",
  "Iran_ballistic_missile_program",
  "Kharg_Island",
  "Natanz",
  "2025_strikes_on_Iran",
];

interface PageviewResult {
  article: string;
  todayViews: number;
  baselineViews: number;
  spikeRatio: number;
  zScore: number;
}

async function getPageviews(article: string, days: number): Promise<number[]> {
  const results: number[] = [];
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400000);

  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(article)}/daily/${fmt(start)}/${fmt(end)}`;

  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "MERIDIAN-OSINT/1.0 (intelligence-platform)" },
    });
    if (!resp.ok) return results;
    const data = await resp.json();
    for (const item of data.items || []) {
      results.push(item.views || 0);
    }
  } catch (e) {
    console.error(`[agent-wiki] Failed to get views for ${article}:`, e);
  }
  return results;
}

// Welford's online algorithm for mean/variance
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
    console.log("[agent-wiki] Starting Wikipedia crisis scan...");

    const results: PageviewResult[] = [];
    let totalSpikeScore = 0;

    // Fetch pageviews for all articles (parallel, batched)
    const batchSize = 5;
    for (let i = 0; i < WATCH_ARTICLES.length; i += batchSize) {
      const batch = WATCH_ARTICLES.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (article) => {
          const views = await getPageviews(article, 8); // 8 days: 7 baseline + today
          if (views.length < 2) return null;

          const todayViews = views[views.length - 1];
          const baseline = views.slice(0, -1);
          const { mean, stddev } = welfordStats(baseline);
          const zScore = stddev > 0 ? (todayViews - mean) / stddev : 0;
          const spikeRatio = mean > 0 ? todayViews / mean : 1;

          return { article, todayViews, baselineViews: Math.round(mean), spikeRatio: Math.round(spikeRatio * 100) / 100, zScore: Math.round(zScore * 100) / 100 };
        })
      );
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    // Calculate composite score
    const spikes = results.filter(r => r.zScore > 1.5);
    const alerts = results.filter(r => r.zScore > 2.5);
    const maxSpike = results.reduce((max, r) => Math.max(max, r.zScore), 0);

    // Wiki Crisis Index: 0-100 based on spike severity and breadth
    const breadthScore = Math.min((spikes.length / WATCH_ARTICLES.length) * 100, 50);
    const intensityScore = Math.min(maxSpike * 10, 50);
    const wikiCrisisIndex = Math.round(breadthScore + intensityScore);

    const topSpikes = results
      .filter(r => r.zScore > 1.0)
      .sort((a, b) => b.zScore - a.zScore)
      .slice(0, 5);

    const summary = topSpikes.length > 0
      ? `Wikipedia crisis signal: ${topSpikes.length} articles spiking. Top: ${topSpikes[0].article.replace(/_/g, " ")} at ${topSpikes[0].spikeRatio}x baseline (Z=${topSpikes[0].zScore}). Crisis Index: ${wikiCrisisIndex}/100.`
      : `Wikipedia monitoring nominal. No significant pageview spikes detected across ${results.length} watched articles. Crisis Index: ${wikiCrisisIndex}/100.`;

    // Update baselines
    const now = new Date();
    const dow = now.getUTCDay();
    const hour = now.getUTCHours();

    for (const r of results) {
      await supabase.from("agent_baselines").upsert({
        agent_name: "wiki",
        metric_name: r.article,
        day_of_week: dow,
        hour_of_day: hour,
        mean: r.baselineViews,
        variance: 0, // simplified for pageviews
        count: 7,
        updated_at: now.toISOString(),
      }, { onConflict: "agent_name,metric_name,day_of_week,hour_of_day" });
    }

    // Save report
    await supabase.from("agent_reports").insert({
      agent_name: "wiki",
      report_type: "cycle",
      data: {
        wikiCrisisIndex,
        articlesMonitored: results.length,
        spikesDetected: spikes.length,
        alertsDetected: alerts.length,
        maxZScore: maxSpike,
        topSpikes: topSpikes.map(s => ({
          article: s.article.replace(/_/g, " "),
          views: s.todayViews,
          baseline: s.baselineViews,
          ratio: s.spikeRatio,
          zScore: s.zScore,
        })),
        allResults: results,
      },
      summary,
      threat_level: wikiCrisisIndex,
      confidence: results.length >= 10 ? "HIGH" : "MEDIUM",
      items_count: spikes.length,
    });

    console.log(`[agent-wiki] Done. Crisis Index: ${wikiCrisisIndex}, Spikes: ${spikes.length}, Alerts: ${alerts.length}`);

    return new Response(JSON.stringify({ success: true, wikiCrisisIndex, spikes: spikes.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-wiki] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
