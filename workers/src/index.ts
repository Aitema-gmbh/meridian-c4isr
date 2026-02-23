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
import { agentOsint, agentNaval, agentReddit, agentPentagon, agentCyber, agentMarkets, agentWiki, agentMacro, agentFires, agentPizza, agentThinkTank, agentAis, agentAcled, agentTelegram, agentMetaculus } from "./routes/agents-db";
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
};
