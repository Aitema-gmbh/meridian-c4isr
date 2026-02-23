import type { Env } from "./lib/anthropic";
import { CORS_HEADERS } from "./lib/cors";

// Routes
import { adsbProxy } from "./routes/adsb-proxy";
import { aisProxy } from "./routes/ais-proxy";
import { intelChat } from "./routes/intel-chat";
import { threatEngine } from "./routes/threat-engine";
import { liveIntel } from "./routes/live-intel";
import { agentFlights } from "./routes/agent-flights";
import { agentHeadAnalyst } from "./routes/agent-head-analyst";
import { agentOsint, agentNaval, agentReddit, agentPentagon, agentCyber, agentMarkets, agentWiki, agentMacro, agentFires, agentPizza, agentThinkTank, agentAis, agentAcled, agentTelegram, agentMetaculus, agentWeather, agentIsw } from "./routes/agents-db";
import { predictionMarkets, redditIntel, intelAgent } from "./routes/simple-proxies";
import { scenarioSim } from "./routes/scenario-sim";
import { apiAgentReports, apiThreatAssessments, apiCountryScores, apiIntelSnapshot, apiMarketSnapshot, apiSignalTimeline, apiMapIntel, apiCalibration, apiTrajectories, apiRunCycle, apiRunSynthesis, apiAnomalies, apiPatternMatch } from "./routes/data-api";
import { apiEntities } from "./routes/entity-api";
import { apiGenerateBriefing, apiBriefings } from "./routes/briefing-gen";

const ROUTES: Record<string, (req: Request, env: Env) => Promise<Response>> = {
  "/adsb-proxy":            adsbProxy,
  "/ais-proxy":             aisProxy,
  "/intel-chat":            intelChat,
  "/threat-engine":         threatEngine,
  "/live-intel":            liveIntel,
  "/agent-flights":         agentFlights,
  "/agent-naval":           agentNaval,
  "/agent-osint":           agentOsint,
  "/agent-reddit":          agentReddit,
  "/agent-pentagon":        agentPentagon,
  "/agent-cyber":           agentCyber,
  "/agent-markets":         agentMarkets,
  "/agent-wiki":            agentWiki,
  "/agent-macro":           agentMacro,
  "/agent-fires":           agentFires,
  "/agent-pizza":           agentPizza,
  "/agent-ais":             agentAis,
  "/agent-acled":           agentAcled,
  "/agent-telegram":        agentTelegram,
  "/agent-thinktank":       agentThinkTank,
  "/agent-head-analyst":    agentHeadAnalyst,
  "/agent-metaculus":        agentMetaculus,
  "/agent-weather":          agentWeather,
  "/agent-isw":              agentIsw,
  "/prediction-markets":    predictionMarkets,
  "/reddit-intel":          redditIntel,
  "/intel-agent":           intelAgent,
  "/scenario-sim":          scenarioSim,
  // Data API (ersetzt direkten Supabase-Zugriff im Frontend)
  "/api/agent-reports":     apiAgentReports,
  "/api/threat-assessments": apiThreatAssessments,
  "/api/country-scores":    apiCountryScores,
  "/api/intel-snapshot":    apiIntelSnapshot,
  "/api/market-snapshot":   apiMarketSnapshot,
  "/api/signal-timeline":   apiSignalTimeline,
  "/api/map-intel":         apiMapIntel,
  "/api/calibration":       apiCalibration,
  "/api/trajectories":      apiTrajectories,
  "/api/run-cycle":          apiRunCycle,
  "/api/run-synthesis":      apiRunSynthesis,
  // v5.0 Endpoints
  "/api/anomalies":          apiAnomalies,
  "/api/pattern-match":      apiPatternMatch,
  "/api/entities":           apiEntities,
  "/api/briefings":          apiBriefings,
  "/api/generate-briefing":  apiGenerateBriefing,
};

async function runCollectionCycle(env: Env): Promise<{ success: number; failed: number }> {
  const dummyReq = new Request("https://meridian-api.dieter-meier82.workers.dev/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const agents: [string, (req: Request, env: Env) => Promise<Response>][] = [
    ["flights", agentFlights],
    ["naval", agentNaval],
    ["ais", agentAis],
    ["osint", agentOsint],
    ["reddit", agentReddit],
    ["pentagon", agentPentagon],
    ["cyber", agentCyber],
    ["markets", agentMarkets],
    ["wiki", agentWiki],
    ["macro", agentMacro],
    ["fires", agentFires],
    ["pizza", agentPizza],
    ["acled", agentAcled],
    ["telegram", agentTelegram],
    ["metaculus", agentMetaculus],
    ["weather", agentWeather],
    ["isw", agentIsw],
  ];

  let success = 0;
  let failed = 0;

  // Run in 3 batches of 5 to stay within CF subrequest limits
  for (let i = 0; i < agents.length; i += 5) {
    const batch = agents.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async ([name, handler]) => {
        try {
          const resp = await handler(dummyReq.clone(), env);
          if (resp.status === 200) { success++; } else { failed++; console.error(`[cron] ${name} returned ${resp.status}`); }
        } catch (e) {
          failed++;
          console.error(`[cron] ${name} error:`, e);
        }
      })
    );
  }

  console.log(`[cron] Collection cycle: ${success} success, ${failed} failed`);
  return { success, failed };
}

async function runSynthesis(env: Env): Promise<void> {
  const dummyReq = new Request("https://meridian-api.dieter-meier82.workers.dev/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  for (const [name, handler] of [["head-analyst", agentHeadAnalyst], ["thinktank", agentThinkTank]] as [string, (req: Request, env: Env) => Promise<Response>][]) {
    try {
      const resp = await handler(dummyReq.clone(), env);
      console.log(`[cron] ${name}: ${resp.status}`);
    } catch (e) {
      console.error(`[cron] ${name} error:`, e);
    }
  }
}

async function dataRetention(env: Env): Promise<void> {
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    // Keep 30 days of reports and assessments
    const r1 = await env.DB.prepare("DELETE FROM agent_reports WHERE created_at < ?").bind(cutoff30d).run();
    const r2 = await env.DB.prepare("DELETE FROM threat_assessments WHERE created_at < ?").bind(cutoff30d).run();
    const r3 = await env.DB.prepare("DELETE FROM country_scores WHERE created_at < ?").bind(cutoff30d).run();
    const r4 = await env.DB.prepare("DELETE FROM prediction_log WHERE created_at < ?").bind(cutoff30d).run();

    // Keep 90 days of snapshots and entities
    const r5 = await env.DB.prepare("DELETE FROM intel_snapshots WHERE created_at < ?").bind(cutoff90d).run();
    const r6 = await env.DB.prepare("DELETE FROM market_snapshots WHERE created_at < ?").bind(cutoff90d).run();
    const r7 = await env.DB.prepare("DELETE FROM entity_mentions WHERE created_at < ?").bind(cutoff90d).run();
    const r8 = await env.DB.prepare("DELETE FROM entity_relations WHERE created_at < ?").bind(cutoff90d).run();

    console.log(`[cron] Data retention cleanup done. Cutoff: 30d=${cutoff30d}, 90d=${cutoff90d}`);
  } catch (e) {
    console.error("[cron] Data retention error:", e);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (path === "/" || path === "/health") {
      return new Response(JSON.stringify({ status: "ok", service: "meridian-api", timestamp: new Date().toISOString() }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const handler = ROUTES[path];
    if (!handler) {
      return new Response(JSON.stringify({ error: "Not found", path }), {
        status: 404,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    try {
      return await handler(request, env);
    } catch (e) {
      console.error(`[${path}] Unhandled error:`, e);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    const minute = now.getUTCMinutes();
    const hour = now.getUTCHours();
    console.log(`[cron] Triggered at ${now.toISOString()} (UTC ${hour}:${minute})`);

    ctx.waitUntil((async () => {
      // Every 30 min: run all collection agents
      const result = await runCollectionCycle(env);
      console.log(`[cron] Collection done: ${result.success}/${result.success + result.failed} agents`);

      // After collection: always run synthesis (head analyst + thinktank)
      await runSynthesis(env);
      console.log("[cron] Synthesis done");

      // Daily at ~03:00 UTC: data retention cleanup
      if (hour === 3 && minute < 30) {
        await dataRetention(env);
        console.log("[cron] Data retention done");
      }
    })());
  },
};
