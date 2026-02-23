/**
 * Auto-Updating Briefings — generates daily/weekly intelligence briefings.
 * POST /api/generate-briefing — generate a new briefing
 * GET /api/briefings — list recent briefings
 */
import { corsError, corsResponse } from "../lib/cors";
import { callClaudeJSON } from "../lib/anthropic";
import type { Env } from "../lib/anthropic";

interface BriefingOutput {
  title: string;
  executiveSummary: string;
  keyDevelopments: string[];
  threatChanges: { metric: string; previous: number; current: number; change: string }[];
  outlook: string;
  recommendations: string[];
}

// POST /api/generate-briefing?type=daily|weekly
export async function apiGenerateBriefing(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const briefingType = url.searchParams.get("type") || "daily";
    const hoursBack = briefingType === "weekly" ? 168 : 24;
    const periodStart = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
    const periodEnd = new Date().toISOString();

    // Gather data for the briefing period
    const [assessments, agentReports, countryScores] = await Promise.all([
      env.DB.prepare(
        `SELECT tension_index, watchcon, hormuz_closure, cyber_attack, proxy_escalation,
                direct_confrontation, analysis_narrative, created_at
         FROM threat_assessments WHERE created_at >= ? ORDER BY created_at ASC LIMIT 200`
      ).bind(periodStart).all<Record<string, unknown>>(),
      env.DB.prepare(
        `SELECT agent_name, summary, threat_level, created_at
         FROM agent_reports WHERE created_at >= ? ORDER BY created_at DESC LIMIT 100`
      ).bind(periodStart).all<Record<string, unknown>>(),
      env.DB.prepare(
        `SELECT country_code, country_name, cii_score, signal_breakdown, created_at
         FROM country_scores WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50`
      ).bind(periodStart).all<Record<string, unknown>>(),
    ]);

    const ta = assessments.results;
    if (ta.length === 0) {
      return corsError("No data available for briefing period");
    }

    // Calculate period stats
    const latest = ta[ta.length - 1];
    const earliest = ta[0];
    const avgTension = Math.round(ta.reduce((s, r) => s + Number(r.tension_index), 0) / ta.length);
    const maxTension = Math.max(...ta.map(r => Number(r.tension_index)));
    const tensionChange = Number(latest.tension_index) - Number(earliest.tension_index);

    // Get previous briefing for delta detection
    const prevBriefing = await env.DB.prepare(
      `SELECT content, created_at FROM briefings WHERE briefing_type = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(briefingType).first<{ content: string; created_at: string }>();

    // Build context for Claude
    const agentSummaries = agentReports.results
      .slice(0, 30)
      .map(r => `[${r.agent_name}] TL:${r.threat_level} — ${String(r.summary).slice(0, 80)}`)
      .join("\n");

    const deltaContext = prevBriefing
      ? `\nPREVIOUS BRIEFING (${prevBriefing.created_at}):\n${String(prevBriefing.content).slice(0, 500)}`
      : "\nNo previous briefing available.";

    const countryContext = countryScores.results
      .slice(0, 13)
      .map(r => `${r.country_code}: CII=${r.cii_score}`)
      .join(", ");

    const briefing = await callClaudeJSON<BriefingOutput>(env.CLIPROXY_BASE_URL, {
      model: "gemini-2.5-flash",
      max_tokens: 8192,
      system: `You are a senior intelligence analyst generating a ${briefingType.toUpperCase()} BRIEFING for the IRAN/US CRISIS (Feb 2026). Write clear, actionable intelligence summaries for senior decision-makers. Structure: Executive Summary, Key Developments, Threat Changes, Outlook, Recommendations. Highlight what changed since the last briefing. ALWAYS call output_briefing.`,
      messages: [{
        role: "user",
        content: `PERIOD: ${periodStart.slice(0, 16)} → ${periodEnd.slice(0, 16)}
STATS: ${ta.length} assessments, avg TI=${avgTension}, max TI=${maxTension}, change=${tensionChange > 0 ? "+" : ""}${tensionChange}
LATEST: TI=${latest.tension_index}, WC=${latest.watchcon}, Hormuz=${latest.hormuz_closure}%, Cyber=${latest.cyber_attack}%
COUNTRIES: ${countryContext}
AGENT DIGESTS:\n${agentSummaries}${deltaContext}

Generate ${briefingType} intelligence briefing.`,
      }],
      tools: [{
        name: "output_briefing",
        description: "Output structured intelligence briefing",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "Briefing title" },
            executiveSummary: { type: "string", description: "2-3 sentence executive summary" },
            keyDevelopments: { type: "array", items: { type: "string" }, description: "3-7 key developments" },
            threatChanges: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  metric: { type: "string" },
                  previous: { type: "number" },
                  current: { type: "number" },
                  change: { type: "string" },
                },
                required: ["metric", "previous", "current", "change"],
              },
              description: "Threat metric changes since last period",
            },
            outlook: { type: "string", description: "Forward-looking assessment" },
            recommendations: { type: "array", items: { type: "string" }, description: "2-4 recommendations" },
          },
          required: ["title", "executiveSummary", "keyDevelopments", "threatChanges", "outlook", "recommendations"],
        },
      }],
      tool_choice: { type: "function", function: { name: "output_briefing" } },
    });

    // Store briefing
    const content = JSON.stringify(briefing);
    await env.DB.prepare(
      `INSERT INTO briefings (briefing_type, title, content, period_start, period_end, data_sources, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      briefingType,
      briefing.title || `${briefingType} Briefing`,
      content,
      periodStart,
      periodEnd,
      JSON.stringify({ assessments: ta.length, agentReports: agentReports.results.length, countries: countryScores.results.length }),
      new Date().toISOString()
    ).run();

    return corsResponse({ success: true, briefing, type: briefingType });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/briefings?type=daily&limit=5
export async function apiBriefings(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const type = url.searchParams.get("type");
    const limit = parseInt(url.searchParams.get("limit") || "10");

    let rows;
    if (type) {
      rows = await env.DB.prepare(
        `SELECT id, briefing_type, title, content, period_start, period_end, data_sources, created_at
         FROM briefings WHERE briefing_type = ? ORDER BY created_at DESC LIMIT ?`
      ).bind(type, limit).all<Record<string, unknown>>();
    } else {
      rows = await env.DB.prepare(
        `SELECT id, briefing_type, title, content, period_start, period_end, data_sources, created_at
         FROM briefings ORDER BY created_at DESC LIMIT ?`
      ).bind(limit).all<Record<string, unknown>>();
    }

    const briefings = rows.results.map(r => ({
      ...r,
      content: r.content ? JSON.parse(r.content as string) : {},
      data_sources: r.data_sources ? JSON.parse(r.data_sources as string) : {},
    }));

    return corsResponse({ briefings, total: briefings.length });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}
