/**
 * GET-Endpoints für Frontend-Datenbankabfragen (ersetzt direkten Supabase-Zugriff)
 */
import { corsError, corsResponse } from "../lib/cors";
import type { Env } from "../lib/anthropic";
import { detectCUSUM, classifyTrajectory, holtWinters, ensembleForecast, compoundAnomalyScore, medianAbsoluteDeviation, modifiedZScore, signalVelocity, type CUSUMResult, type TrajectoryResult } from "../lib/forecasting";
import { matchPatterns, CRISIS_TEMPLATES, type DTWMatchResult } from "../lib/dtw";
import { agentOsint, agentNaval, agentReddit, agentPentagon, agentCyber, agentMarkets, agentWiki, agentMacro, agentFires, agentPizza, agentAis, agentAcled, agentTelegram, agentThinkTank } from "./agents-db";
import { agentFlights } from "./agent-flights";
import { agentHeadAnalyst } from "./agent-head-analyst";

// GET /api/agent-reports?hours=2
export async function apiAgentReports(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "2");
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = await env.DB.prepare(
      `SELECT id, agent_name, data, summary, threat_level, confidence, items_count, created_at
       FROM agent_reports WHERE created_at >= ? ORDER BY created_at DESC LIMIT 100`
    ).bind(cutoff).all<Record<string, unknown>>();
    const results = rows.results.map((r) => ({
      ...r,
      data: r.data ? JSON.parse(r.data as string) : {},
    }));
    return corsResponse({ reports: results });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/threat-assessments?limit=24
export async function apiThreatAssessments(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "24");
    const rows = await env.DB.prepare(
      `SELECT id, tension_index, watchcon, hormuz_closure, cyber_attack, proxy_escalation,
              direct_confrontation, analysis_narrative, market_divergences, raw_indicators, created_at
       FROM threat_assessments ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all<Record<string, unknown>>();
    // JSON-Felder deserialisieren
    const results = rows.results.map((r) => ({
      ...r,
      market_divergences: r.market_divergences ? JSON.parse(r.market_divergences as string) : [],
      raw_indicators: r.raw_indicators ? JSON.parse(r.raw_indicators as string) : {},
    }));
    return corsResponse({ assessments: results });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/country-scores
export async function apiCountryScores(_req: Request, env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(
      `SELECT * FROM country_scores ORDER BY created_at DESC LIMIT 100`
    ).all<Record<string, unknown>>();
    const results = rows.results.map((r) => ({
      ...r,
      signal_breakdown: r.signal_breakdown ? JSON.parse(r.signal_breakdown as string) : {},
    }));
    return corsResponse({ scores: results });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/intel-snapshot (letzter gespeicherter Live-Intel-Snapshot als Fallback)
export async function apiIntelSnapshot(_req: Request, env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      `SELECT data, created_at FROM intel_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first<{ data: string; created_at: string }>();
    if (!row) return corsResponse({ items: [], flashReport: null, metadata: {} });
    return corsResponse({ ...JSON.parse(row.data), snapshotTime: row.created_at });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/market-snapshot
export async function apiMarketSnapshot(_req: Request, env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      `SELECT data, created_at FROM market_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first<{ data: string; created_at: string }>();
    if (!row) return corsResponse({ markets: [], total: 0 });
    return corsResponse({ ...JSON.parse(row.data), snapshotTime: row.created_at });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// Keyword → Coordinates mapping for OSINT geocoding
const LOCATION_KEYWORDS: Array<{ keywords: string[]; lat: number; lon: number; label: string }> = [
  // Order matters: more specific locations MUST come before generic country names
  // so "persian gulf" matches before "iran", "tel aviv" before "israel", etc.
  { keywords: ["hormuz", "strait of hormuz"], lat: 26.56, lon: 56.27, label: "Strait of Hormuz" },
  { keywords: ["persian gulf"], lat: 26.8, lon: 52.0, label: "Persian Gulf" },
  { keywords: ["tehran"], lat: 35.69, lon: 51.39, label: "Tehran" },
  { keywords: ["isfahan", "esfahan", "natanz"], lat: 32.65, lon: 51.68, label: "Isfahan" },
  { keywords: ["fordow", "qom"], lat: 34.64, lon: 50.88, label: "Qom" },
  { keywords: ["iran", "iranian"], lat: 35.69, lon: 51.39, label: "Iran" },
  { keywords: ["yemen", "houthi", "sanaa", "sana'a"], lat: 15.37, lon: 44.19, label: "Yemen" },
  { keywords: ["baghdad"], lat: 33.31, lon: 44.37, label: "Baghdad" },
  { keywords: ["iraq", "iraqi"], lat: 33.31, lon: 44.37, label: "Iraq" },
  { keywords: ["beirut", "lebanon", "hezbollah"], lat: 33.89, lon: 35.50, label: "Beirut" },
  { keywords: ["riyadh"], lat: 24.71, lon: 46.68, label: "Riyadh" },
  { keywords: ["saudi", "saudi arabia"], lat: 24.71, lon: 46.68, label: "Saudi Arabia" },
  { keywords: ["dubai"], lat: 25.20, lon: 55.27, label: "Dubai" },
  { keywords: ["uae", "emirates", "abu dhabi"], lat: 24.45, lon: 54.65, label: "UAE" },
  { keywords: ["doha", "qatar"], lat: 25.29, lon: 51.53, label: "Doha" },
  { keywords: ["tel aviv"], lat: 32.09, lon: 34.78, label: "Tel Aviv" },
  { keywords: ["jerusalem"], lat: 31.77, lon: 35.23, label: "Jerusalem" },
  { keywords: ["israel", "idf", "netanyahu"], lat: 31.77, lon: 35.23, label: "Israel" },
  { keywords: ["suez", "canal"], lat: 30.46, lon: 32.35, label: "Suez Canal" },
  { keywords: ["red sea", "bab el-mandeb", "bab al-mandab"], lat: 12.58, lon: 43.33, label: "Bab el-Mandeb" },
  { keywords: ["aden", "gulf of aden"], lat: 12.8, lon: 45.0, label: "Gulf of Aden" },
  { keywords: ["oman", "muscat"], lat: 23.59, lon: 58.38, label: "Oman" },
  { keywords: ["bahrain"], lat: 26.23, lon: 50.59, label: "Bahrain" },
  { keywords: ["kuwait"], lat: 29.38, lon: 47.98, label: "Kuwait" },
  { keywords: ["syria", "syrian", "damascus"], lat: 33.51, lon: 36.29, label: "Syria" },
  { keywords: ["jordan", "amman"], lat: 31.95, lon: 35.93, label: "Jordan" },
];

function classifyEventType(title: string): "maritime" | "military" | "diplomatic" | "incident" {
  const t = title.toLowerCase();
  if (["seizure", "attack", "missile", "strike", "explosion", "drone", "intercept", "hit"].some(k => t.includes(k))) return "incident";
  if (["tanker", "ship", "vessel", "cargo", "maritime", "port", "shipping"].some(k => t.includes(k))) return "maritime";
  if (["irgc", "idf", "military", "troops", "army", "navy", "air force", "centcom", "deploy"].some(k => t.includes(k))) return "military";
  return "diplomatic";
}

function geocodeArticle(title: string): { lat: number; lon: number; label: string } | null {
  const t = title.toLowerCase();
  for (const loc of LOCATION_KEYWORDS) {
    if (loc.keywords.some(k => t.includes(k))) {
      return { lat: loc.lat, lon: loc.lon, label: loc.label };
    }
  }
  return null;
}

// GET /api/map-intel — geocoded OSINT events + chokepoint risk data
export async function apiMapIntel(_req: Request, env: Env): Promise<Response> {
  try {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    // Fetch AIS + OSINT agent reports
    const rows = await env.DB.prepare(
      `SELECT agent_name, data, created_at FROM agent_reports
       WHERE agent_name IN ('ais', 'osint', 'naval') AND created_at >= ?
       ORDER BY created_at DESC LIMIT 10`
    ).bind(cutoff).all<{ agent_name: string; data: string; created_at: string }>();

    const events: Array<{ lat: number; lon: number; type: string; title: string; source: string; severity: number; label: string; timestamp: string }> = [];
    const seenLocations = new Set<string>();
    let chokepoints: Array<{ name: string; riskScore: number; patrolCount: number; articleCount: number }> = [];

    for (const row of rows.results) {
      let data: Record<string, unknown>;
      try { data = JSON.parse(row.data); } catch { continue; }

      // Extract chokepoint data from AIS agent
      if (row.agent_name === "ais" && data.chokepointAlerts) {
        const alerts = data.chokepointAlerts as Array<Record<string, unknown>>;
        if (alerts.length > 0 && chokepoints.length === 0) {
          chokepoints = alerts.map(a => ({
            name: String(a.name || a.chokepoint || "Unknown"),
            riskScore: a.riskScore ?? 0,
            patrolCount: a.patrolCount ?? 0,
            articleCount: a.articleCount ?? 0,
          }));
        }
      }

      // Extract articles for geocoding
      const articles = (data.articles || data.items || []) as Array<{ title?: string; url?: string }>;
      for (const article of articles) {
        if (!article.title) continue;
        const geo = geocodeArticle(article.title);
        if (!geo) continue;

        const locKey = `${geo.lat},${geo.lon}`;
        // Slight offset for duplicate locations
        let lat = geo.lat, lon = geo.lon;
        if (seenLocations.has(locKey)) {
          lat += (Math.random() - 0.5) * 0.4;
          lon += (Math.random() - 0.5) * 0.4;
        }
        seenLocations.add(locKey);

        const eventType = classifyEventType(article.title);
        events.push({
          lat, lon,
          type: eventType,
          title: article.title.slice(0, 120),
          source: row.agent_name,
          severity: eventType === "incident" ? 4 : eventType === "military" ? 3 : eventType === "maritime" ? 2 : 1,
          label: geo.label,
          timestamp: row.created_at,
        });

        if (events.length >= 30) break;
      }
      if (events.length >= 30) break;
    }

    return corsResponse({
      events,
      chokepoints,
      total: events.length,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/signal-timeline?hours=24
export async function apiSignalTimeline(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "24");
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = await env.DB.prepare(
      `SELECT id, agent_name, summary, threat_level, created_at
       FROM agent_reports WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50`
    ).bind(cutoff).all<Record<string, unknown>>();
    return corsResponse({ timeline: rows.results });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/calibration?metric=hormuzClosure&days=7
export async function apiCalibration(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const metric = url.searchParams.get("metric");
    const days = parseInt(url.searchParams.get("days") || "7");
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let rows;
    if (metric) {
      rows = await env.DB.prepare(
        `SELECT id, metric, our_estimate, market_price, agent_count, created_at
         FROM prediction_log WHERE metric = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 500`
      ).bind(metric, cutoff).all<Record<string, unknown>>();
    } else {
      // Return all metrics if none specified
      rows = await env.DB.prepare(
        `SELECT id, metric, our_estimate, market_price, agent_count, created_at
         FROM prediction_log WHERE created_at >= ? ORDER BY created_at DESC LIMIT 500`
      ).bind(cutoff).all<Record<string, unknown>>();
    }

    // Compute basic calibration stats per metric
    const byMetric: Record<string, Array<Record<string, unknown>>> = {};
    for (const r of rows.results) {
      const m = r.metric as string;
      if (!byMetric[m]) byMetric[m] = [];
      byMetric[m].push(r);
    }

    const stats: Record<string, { count: number; avgEstimate: number; avgMarketPrice: number | null; avgDivergence: number | null; latest: Record<string, unknown> | null }> = {};
    for (const [m, entries] of Object.entries(byMetric)) {
      const estimates = entries.map(e => e.our_estimate as number);
      const marketPrices = entries.filter(e => e.market_price != null).map(e => e.market_price as number);
      const avgEst = estimates.reduce((a, b) => a + b, 0) / estimates.length;
      const avgMkt = marketPrices.length > 0 ? marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length : null;
      const avgDiv = avgMkt != null ? Math.round((avgEst - avgMkt) * 100) / 100 : null;
      stats[m] = {
        count: entries.length,
        avgEstimate: Math.round(avgEst * 100) / 100,
        avgMarketPrice: avgMkt != null ? Math.round(avgMkt * 100) / 100 : null,
        avgDivergence: avgDiv,
        latest: entries[0] || null,
      };
    }

    return corsResponse({ predictions: rows.results, stats, days, metric: metric || "all" });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/trajectories?hours=168 — CUSUM + trajectory classification from historical data
export async function apiTrajectories(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "168"); // default 7 days
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Fetch threat assessments for the window (oldest first for time series)
    const taRows = await env.DB.prepare(
      `SELECT tension_index, hormuz_closure, cyber_attack, proxy_escalation, direct_confrontation, created_at
       FROM threat_assessments WHERE created_at >= ? ORDER BY created_at ASC LIMIT 500`
    ).bind(cutoff).all<{
      tension_index: number; hormuz_closure: number; cyber_attack: number;
      proxy_escalation: number; direct_confrontation: number; created_at: string;
    }>();

    const ta = taRows.results;
    const tensionValues = ta.map(r => r.tension_index);
    const hormuzValues = ta.map(r => r.hormuz_closure);
    const cyberValues = ta.map(r => r.cyber_attack);
    const proxyValues = ta.map(r => r.proxy_escalation);
    const directValues = ta.map(r => r.direct_confrontation);

    // CUSUM on tension_index
    const cusum: CUSUMResult = detectCUSUM(tensionValues);

    // Trajectory classification for each metric
    const trajectories: Record<string, TrajectoryResult> = {
      tensionIndex: classifyTrajectory(tensionValues),
      hormuzClosure: classifyTrajectory(hormuzValues),
      cyberAttack: classifyTrajectory(cyberValues),
      proxyEscalation: classifyTrajectory(proxyValues),
      directConfrontation: classifyTrajectory(directValues),
    };

    // Country CII trajectories
    const csRows = await env.DB.prepare(
      `SELECT country_code, cii_score FROM country_scores
       WHERE created_at >= ? ORDER BY created_at ASC LIMIT 1000`
    ).bind(cutoff).all<{ country_code: string; cii_score: number }>();

    const byCountry: Record<string, number[]> = {};
    for (const r of csRows.results) {
      if (!byCountry[r.country_code]) byCountry[r.country_code] = [];
      byCountry[r.country_code].push(r.cii_score);
    }

    const countryTrajectories: Record<string, TrajectoryResult> = {};
    for (const [code, vals] of Object.entries(byCountry)) {
      countryTrajectories[code] = classifyTrajectory(vals);
    }

    // Holt-Winters forecasts for tension index
    const hwResult = holtWinters(tensionValues, { seasonLength: Math.min(24, Math.max(4, Math.floor(tensionValues.length / 3))), forecastHorizon: 24 });
    const forecast = ensembleForecast(tensionValues, cusum, hwResult.forecasts);

    return corsResponse({
      cusum,
      trajectories,
      countryTrajectories,
      forecasts: {
        hw: hwResult.forecasts.slice(0, 24),
        ensemble: forecast.ensemble.slice(0, 24),
        method: forecast.method,
        weights: forecast.weights,
      },
      dataPoints: ta.length,
      windowHours: hours,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/anomalies — Z-Score anomaly detection across all signals
export async function apiAnomalies(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "48");
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const taRows = await env.DB.prepare(
      `SELECT tension_index, hormuz_closure, cyber_attack, proxy_escalation, direct_confrontation, created_at
       FROM threat_assessments WHERE created_at >= ? ORDER BY created_at ASC LIMIT 500`
    ).bind(cutoff).all<{
      tension_index: number; hormuz_closure: number; cyber_attack: number;
      proxy_escalation: number; direct_confrontation: number; created_at: string;
    }>();

    const ta = taRows.results;
    const signals: Record<string, number[]> = {
      tensionIndex: ta.map(r => r.tension_index),
      hormuzClosure: ta.map(r => r.hormuz_closure),
      cyberAttack: ta.map(r => r.cyber_attack),
      proxyEscalation: ta.map(r => r.proxy_escalation),
      directConfrontation: ta.map(r => r.direct_confrontation),
    };

    const anomaly = compoundAnomalyScore(signals);

    return corsResponse({
      ...anomaly,
      dataPoints: ta.length,
      windowHours: hours,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/pattern-match — DTW pattern matching against historical crises
export async function apiPatternMatch(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "168");
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const taRows = await env.DB.prepare(
      `SELECT tension_index, created_at FROM threat_assessments WHERE created_at >= ? ORDER BY created_at ASC LIMIT 500`
    ).bind(cutoff).all<{ tension_index: number; created_at: string }>();

    const tensionValues = taRows.results.map(r => r.tension_index);
    const matches = matchPatterns(tensionValues);

    return corsResponse({
      matches,
      templates: CRISIS_TEMPLATES.map(t => ({ name: t.name, description: t.description, year: t.year, phases: t.phases })),
      dataPoints: tensionValues.length,
      windowHours: hours,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// POST /api/run-cycle — trigger all collection agents, then head-analyst + thinktank
// Uses waitUntil to run agents in background so the response returns immediately
const COLLECTION_AGENTS: [string, (req: Request, env: Env) => Promise<Response>][] = [
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
];

export async function apiRunCycle(req: Request, env: Env): Promise<Response> {
  const dummyReq = new Request("https://meridian-api.dieter-meier82.workers.dev/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const started = Date.now();
  const results: { agent: string; success: boolean; ms: number }[] = [];

  // Run collection agents in 3 parallel batches to stay within CF limits
  const batches = [];
  for (let i = 0; i < COLLECTION_AGENTS.length; i += 5) {
    batches.push(COLLECTION_AGENTS.slice(i, i + 5));
  }

  for (const batch of batches) {
    const batchResults = await Promise.allSettled(
      batch.map(async ([name, handler]) => {
        const t = Date.now();
        try {
          const resp = await handler(dummyReq.clone(), env);
          const ok = resp.status === 200;
          results.push({ agent: name, success: ok, ms: Date.now() - t });
        } catch {
          results.push({ agent: name, success: false, ms: Date.now() - t });
        }
      })
    );
  }

  const totalMs = Date.now() - started;
  const successCount = results.filter(r => r.success).length;

  return corsResponse({
    success: true,
    totalAgents: results.length,
    successCount,
    totalMs,
    results,
  });
}

// POST /api/run-synthesis — trigger head-analyst + thinktank (separate from collection to avoid subrequest limit)
export async function apiRunSynthesis(_req: Request, env: Env): Promise<Response> {
  const dummyReq = new Request("https://meridian-api.dieter-meier82.workers.dev/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const started = Date.now();
  const results: { agent: string; success: boolean; ms: number }[] = [];

  for (const [name, handler] of [["head-analyst", agentHeadAnalyst], ["thinktank", agentThinkTank]] as [string, (req: Request, env: Env) => Promise<Response>][]) {
    const t = Date.now();
    try {
      const resp = await handler(dummyReq.clone(), env);
      const body = await resp.clone().text();
      const isSuccess = resp.status === 200 && body.includes('"success"');
      results.push({ agent: name, success: isSuccess, ms: Date.now() - t });
    } catch {
      results.push({ agent: name, success: false, ms: Date.now() - t });
    }
  }

  return corsResponse({
    success: true,
    totalAgents: results.length,
    successCount: results.filter(r => r.success).length,
    totalMs: Date.now() - started,
    results,
  });
}
