import { corsError, corsResponse } from "../lib/cors";
import { callClaudeJSON } from "../lib/anthropic";
import { getLatestAgentReport } from "../lib/db";
import type { Env } from "../lib/anthropic";

const SYSTEM_PROMPT = `You are a geopolitical scenario simulation engine for the IRAN/US CRISIS (Feb 2026). You receive a hypothetical scenario and real-time intelligence context from 14 collection agents and must produce a rigorous cascading effects analysis.

CRITICAL: You MUST call the output_scenario_analysis tool with ALL required fields. Every numeric field must be a number. Do NOT put analysis in text — use the tool call.

ANALYSIS FRAMEWORK:
1. PROBABILITY ESTIMATION: Use base rates and current intelligence to estimate scenario likelihood (0-100). Most geopolitical events have <10% base rate even during crises.
2. CASCADING EFFECTS: Identify 5-8 first-order effects across domains (military, economic, diplomatic, cyber, humanitarian, energy, intelligence).
3. SECOND-ORDER EFFECTS: Chain reactions from first-order effects (2-3 steps out).
4. HISTORICAL ANALOGS: Find 2-4 historical parallels with similarity assessment.
5. ADJUSTED THREAT LEVELS: Recalculate all threat probabilities assuming the scenario occurs.

DOMAINS for cascading effects:
- Military: force posture, deployments, readiness changes
- Economic: oil prices, sanctions, trade disruption, market impact
- Diplomatic: alliance shifts, UN action, backchannel changes
- Cyber: retaliatory cyber ops, infrastructure targeting
- Humanitarian: refugee flows, civilian impact, aid disruption
- Energy: supply chain disruption, strategic reserves, pricing
- Intelligence: collection priorities, denied areas, SIGINT changes
- Proxy: militia activation, asymmetric response vectors

SEVERITY SCALE (1-5):
1 = Minimal / Easily contained
2 = Notable / Requires response
3 = Significant / Alters regional dynamics
4 = Severe / Potential for escalation spiral
5 = Critical / Systemic disruption

CALIBRATION: Ground your analysis in current intelligence context. If agents show elevated signals in a domain, cascading effects in that domain should reflect the compounding risk.`;

interface CascadingEffect {
  domain: string;
  impact: string;
  severity: number;
  timeframe: string;
}

interface HistoricalAnalog {
  event: string;
  year: number;
  similarity: string;
}

interface AdjustedThreatLevels {
  tensionIndex: number;
  hormuzClosure: number;
  cyberAttack: number;
  proxyEscalation: number;
  directConfrontation: number;
}

interface ScenarioAnalysis {
  scenario: string;
  probability: number;
  timeframe: string;
  cascadingEffects: CascadingEffect[];
  secondOrderEffects: string[];
  historicalAnalogs: HistoricalAnalog[];
  recommendations: string[];
  adjustedThreatLevels: AdjustedThreatLevels;
}

export async function scenarioSim(req: Request, env: Env): Promise<Response> {
  try {
    const { scenario } = await req.json() as { scenario?: string };

    if (!scenario || typeof scenario !== "string" || scenario.trim().length === 0) {
      return corsError("Missing or empty 'scenario' field", 400);
    }

    // Pull latest agent reports from D1 for context
    const cutoff = new Date(Date.now() - 180 * 60 * 1000).toISOString(); // last 3 hours
    const AGENTS = ["osint", "flights", "naval", "cyber", "markets", "ais", "macro", "wiki", "pentagon", "fires", "pizza", "acled", "reddit", "telegram"];
    const agentResults = await Promise.all(
      AGENTS.map(name => getLatestAgentReport(env.DB, name, cutoff))
    );
    const agents: Record<string, { data: Record<string, unknown>; threat_level: number; items_count: number; summary: string }> = {};
    AGENTS.forEach((name, i) => { if (agentResults[i]) agents[name] = agentResults[i] as any; });

    const d = (name: string) => (agents[name]?.data || {}) as Record<string, unknown>;
    const tl = (name: string) => agents[name]?.threat_level ?? 0;

    // Build current intelligence context summary
    const agentSummaries: string[] = [];
    for (const [name, report] of Object.entries(agents)) {
      agentSummaries.push(`${name.toUpperCase()} [${report.threat_level}/100]: ${report.summary?.slice(0, 120) || "No data"}`);
    }

    // Pull latest threat assessment for baseline
    const latestThreat = await env.DB.prepare(
      `SELECT tension_index, watchcon, hormuz_closure, cyber_attack, proxy_escalation, direct_confrontation, created_at
       FROM threat_assessments ORDER BY created_at DESC LIMIT 1`
    ).first<{ tension_index: number; watchcon: string; hormuz_closure: number; cyber_attack: number; proxy_escalation: number; direct_confrontation: number; created_at: string }>();

    let prompt = `SCENARIO: "${scenario}"

INTEL CONTEXT (${Object.keys(agents).length}/14 agents):
${agentSummaries.join("\n") || "NO DATA"}

INDICATORS: OSINT=${d("osint").sentimentScore ?? "?"}, Flights=${d("flights").anomalyIndex ?? "?"}, Naval=${d("naval").maritimeAnomalyIndex ?? "?"}, AIS=${d("ais").maritimeThreatIndex ?? "?"}, Cyber=${d("cyber").cyberThreatLevel ?? "?"}, ACLED=${d("acled").conflictIntensityIndex ?? "?"}, Macro=${d("macro").macroRiskIndex ?? "?"}, Pentagon=${d("pentagon").activityIndex ?? "?"}, DOUGHCON=${d("pizza").pizzaIndex ?? "?"}`;

    if (latestThreat) {
      prompt += `\nBASELINE: TI=${latestThreat.tension_index}, WC=${latestThreat.watchcon}, Hormuz=${latestThreat.hormuz_closure}%, Cyber=${latestThreat.cyber_attack}%, Proxy=${latestThreat.proxy_escalation}%, Direct=${latestThreat.direct_confrontation}%`;
    }

    prompt += `\nSimulate cascading effects. Be calibrated.`;

    const analysis = await callClaudeJSON<ScenarioAnalysis>(env.CLIPROXY_BASE_URL, {
      model: "gemini-2.5-flash",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      tools: [{
        name: "output_scenario_analysis",
        description: "Output the complete scenario simulation analysis with cascading effects, historical analogs, recommendations, and adjusted threat levels",
        parameters: {
          type: "object",
          properties: {
            scenario: { type: "string", description: "The input scenario being analyzed" },
            probability: { type: "number", description: "Estimated probability of scenario occurring (0-100)" },
            timeframe: { type: "string", description: "Expected timeline for scenario to unfold" },
            cascadingEffects: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  domain: { type: "string", description: "Affected domain (military, economic, diplomatic, cyber, humanitarian, energy, intelligence, proxy)" },
                  impact: { type: "string", description: "Description of the impact in this domain" },
                  severity: { type: "number", description: "Severity rating 1-5" },
                  timeframe: { type: "string", description: "When this effect would manifest" },
                },
                required: ["domain", "impact", "severity", "timeframe"],
              },
            },
            secondOrderEffects: {
              type: "array",
              items: { type: "string" },
              description: "Second and third order chain reactions",
            },
            historicalAnalogs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  event: { type: "string", description: "Historical event name" },
                  year: { type: "number", description: "Year of the event" },
                  similarity: { type: "string", description: "How this analog relates to the scenario" },
                },
                required: ["event", "year", "similarity"],
              },
            },
            recommendations: {
              type: "array",
              items: { type: "string" },
              description: "Actionable recommendations for decision-makers",
            },
            adjustedThreatLevels: {
              type: "object",
              properties: {
                tensionIndex: { type: "number", description: "Adjusted tension index (0-100)" },
                hormuzClosure: { type: "number", description: "Adjusted Hormuz closure probability (0-100)" },
                cyberAttack: { type: "number", description: "Adjusted cyber attack probability (0-100)" },
                proxyEscalation: { type: "number", description: "Adjusted proxy escalation probability (0-100)" },
                directConfrontation: { type: "number", description: "Adjusted direct confrontation probability (0-100)" },
              },
              required: ["tensionIndex", "hormuzClosure", "cyberAttack", "proxyEscalation", "directConfrontation"],
            },
          },
          required: ["scenario", "probability", "timeframe", "cascadingEffects", "secondOrderEffects", "historicalAnalogs", "recommendations", "adjustedThreatLevels"],
        },
      }],
      tool_choice: { type: "function", function: { name: "output_scenario_analysis" } },
    });

    // Sanitize — ensure all fields are properly typed
    const safe: ScenarioAnalysis = {
      scenario: analysis.scenario || scenario,
      probability: Math.max(0, Math.min(100, Number(analysis.probability) || 0)),
      timeframe: analysis.timeframe || "Unknown",
      cascadingEffects: Array.isArray(analysis.cascadingEffects)
        ? analysis.cascadingEffects.map(e => ({
            domain: String(e.domain || "unknown"),
            impact: String(e.impact || ""),
            severity: Math.max(1, Math.min(5, Number(e.severity) || 1)),
            timeframe: String(e.timeframe || ""),
          }))
        : [],
      secondOrderEffects: Array.isArray(analysis.secondOrderEffects)
        ? analysis.secondOrderEffects.map(e => String(e))
        : [],
      historicalAnalogs: Array.isArray(analysis.historicalAnalogs)
        ? analysis.historicalAnalogs.map(a => ({
            event: String(a.event || ""),
            year: Number(a.year) || 0,
            similarity: String(a.similarity || ""),
          }))
        : [],
      recommendations: Array.isArray(analysis.recommendations)
        ? analysis.recommendations.map(r => String(r))
        : [],
      adjustedThreatLevels: {
        tensionIndex: Number(analysis.adjustedThreatLevels?.tensionIndex) || 0,
        hormuzClosure: Number(analysis.adjustedThreatLevels?.hormuzClosure) || 0,
        cyberAttack: Number(analysis.adjustedThreatLevels?.cyberAttack) || 0,
        proxyEscalation: Number(analysis.adjustedThreatLevels?.proxyEscalation) || 0,
        directConfrontation: Number(analysis.adjustedThreatLevels?.directConfrontation) || 0,
      },
    };

    return corsResponse(safe);
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown error");
  }
}
