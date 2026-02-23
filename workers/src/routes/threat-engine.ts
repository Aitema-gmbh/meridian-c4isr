import { corsError, corsResponse } from "../lib/cors";
import { callClaudeJSON } from "../lib/anthropic";
import { getLatestAgentReport, insertPredictionLog } from "../lib/db";
import { normalizeWatchcon } from "../lib/anthropic";
import type { Env } from "../lib/anthropic";

const SYSTEM_PROMPT = `You are a geopolitical threat analysis engine for the IRAN/US CRISIS (Feb 2026). You receive real-time data from 14 intelligence collection agents and must produce calibrated probability estimates.

CRITICAL: You MUST call the output_threat_assessment tool with ALL required fields. Every numeric field must be a number. Do NOT put analysis in text — use the tool call.

SIGNAL FUSION ALGORITHM (Bayesian-weighted):
1. HARD SIGNALS (weight 3x): flights, AIS/maritime, cyber, pentagon — direct military/operational indicators
2. MEDIUM SIGNALS (weight 2x): OSINT sentiment, macro economics, ACLED conflict data — correlated indicators
3. SOFT SIGNALS (weight 1x): wiki, reddit, pizza, telegram — social/proxy indicators
4. CALIBRATION: prediction markets provide external probability anchor

Tension Index formula:
- Base = weighted_average(all_agent_threat_levels)
- Hard_signal_boost = if 3+ hard signals > 50 → +15
- Convergence_boost = if 8+ agents > 30 → +10
- Market_anchor = blend 30% toward market-implied probability
- Historical_damping = if previous TI was much lower, cap single-cycle increase at +25

WATCHCON levels:
- I: Imminent threat (TI > 85, multiple hard signals maxed)
- II: Elevated threat (TI 60-85, hard signal convergence)
- III: Increased monitoring (TI 40-60)
- IV: Routine monitoring (TI 20-40)
- V: Baseline (TI < 20)

Probability calibration: Use base rates. A "50% chance of Hormuz closure" means you'd bet even money. Most geopolitical events have <10% probability even during crises. Be precise, not dramatic.`;

interface ThreatAssessment {
  tensionIndex: number;
  hormuzClosure: number;
  cyberAttack: number;
  proxyEscalation: number;
  directConfrontation: number;
  sentimentScore: number;
  flightAnomalyIndex: number;
  maritimeAnomalyIndex: number;
  analysisNarrative: string;
  watchcon: string;
  marketDivergences?: string[];
}

export async function threatEngine(req: Request, env: Env): Promise<Response> {
  try {
    const { indicators, marketContext } = await req.json() as { indicators?: Record<string, unknown>; marketContext?: string };

    // Pull real indicators from ALL agent reports in D1
    const cutoff = new Date(Date.now() - 180 * 60 * 1000).toISOString(); // last 3 hours
    const AGENTS = ["osint", "flights", "naval", "cyber", "markets", "ais", "macro", "wiki", "pentagon", "fires", "pizza", "acled", "reddit", "telegram"];
    const agentResults = await Promise.all(
      AGENTS.map(name => getLatestAgentReport(env.DB, name, cutoff))
    );
    const agents: Record<string, { data: Record<string, unknown>; threat_level: number; items_count: number }> = {};
    AGENTS.forEach((name, i) => { if (agentResults[i]) agents[name] = agentResults[i] as any; });

    const d = (name: string) => (agents[name]?.data || {}) as Record<string, unknown>;
    const tl = (name: string) => agents[name]?.threat_level ?? 0;

    // Extract key signals from all agents
    const sentimentScore = indicators?.sentimentScore ?? d("osint").sentimentScore ?? 0;
    const flightAnomalyIndex = indicators?.flightAnomalyIndex ?? d("flights").anomalyIndex ?? 0;
    const maritimeAnomalyIndex = indicators?.maritimeAnomalyIndex ?? d("naval").maritimeAnomalyIndex ?? 0;
    const cyberThreatLevel = d("cyber").cyberThreatLevel ?? 0;
    const activeAPTs = (d("cyber").activeAPTs as string[]) || [];
    const marketsCount = agents.markets?.items_count ?? 0;
    const aisMaritime = d("ais").maritimeThreatIndex ?? 0;
    const macroRisk = d("macro").macroRiskIndex ?? 0;
    const wikiCrisis = d("wiki").wikiCrisisIndex ?? 0;
    const pentagonActivity = d("pentagon").activityIndex ?? 0;
    const conflictIntensity = d("acled").conflictIntensityIndex ?? 0;
    const pizzaIndex = d("pizza").pizzaIndex ?? 0;
    const redditSignal = d("reddit").signalStrength ?? tl("reddit");

    const dataSources: string[] = [];
    for (const [name, report] of Object.entries(agents)) {
      dataSources.push(`${name.toUpperCase()} (threat:${report.threat_level}, items:${report.items_count})`);
    }

    let prompt = `Analyze the following REAL-TIME intelligence from ${Object.keys(agents).length} active agent streams and produce a calibrated threat assessment:

DATA SOURCES (${Object.keys(agents).length}/14 agents reporting):
${dataSources.join("\n") || "NONE — using baseline estimates"}

CORE INDICATORS:
- OSINT Sentiment Score: ${sentimentScore} ${agents.osint ? "(LIVE)" : "(no data)"}
- Flight Anomaly Index: ${flightAnomalyIndex}/100 ${agents.flights ? "(LIVE ADS-B)" : "(no data)"}
- Maritime Anomaly (Naval): ${maritimeAnomalyIndex}/100, AIS Maritime Threat: ${aisMaritime}/100
- Cyber Threat Level: ${cyberThreatLevel}/100, Active APTs: ${activeAPTs.join(", ") || "none detected"}
- Prediction Markets: ${marketsCount} active contracts

EXPANDED SIGNALS:
- Macro Risk Index: ${macroRisk}/100 (oil/gold/sanctions economic indicators)
- Wiki Crisis Index: ${wikiCrisis}/100 (Wikipedia article surge detection)
- Pentagon Activity: ${pentagonActivity}/100 (DoD press tempo)
- Conflict Intensity (ACLED): ${conflictIntensity}/100 (UCDP + GDELT conflict events)
- DOUGHCON (Pizza Index): ${pizzaIndex}/100 (DC-area activity proxy)
- Reddit Signal: ${redditSignal}/100 (social sentiment)

SIGNAL FUSION GUIDANCE:
- Weight hard signals (flights, AIS, cyber) higher than soft signals (reddit, wiki, pizza)
- Convergence of 5+ elevated signals warrants WATCHCON upgrade
- Market data provides external calibration — divergence from your estimates = flag it
- Consider base rates: Hormuz closure historically <5%/month, cyber attack on infrastructure ~10%/quarter`;

    // Add historical trend from previous assessments
    const prevAssessments = await env.DB.prepare(
      `SELECT tension_index, watchcon, hormuz_closure, cyber_attack, proxy_escalation, direct_confrontation, created_at
       FROM threat_assessments ORDER BY created_at DESC LIMIT 5`
    ).all<{ tension_index: number; watchcon: string; hormuz_closure: number; cyber_attack: number; proxy_escalation: number; direct_confrontation: number; created_at: string }>();

    if (prevAssessments.results?.length) {
      const trend = prevAssessments.results.map(r =>
        `${r.created_at.slice(11,16)} TI:${r.tension_index} W:${r.watchcon} H:${r.hormuz_closure} C:${r.cyber_attack} P:${r.proxy_escalation} D:${r.direct_confrontation}`
      ).join("\n");
      prompt += `\n\nHISTORICAL TREND (last ${prevAssessments.results.length} assessments, newest first):\n${trend}\n\nUse this trend to calibrate — avoid overreaction to single-cycle noise.`;
    }

    if (marketContext) {
      prompt += `\n\nPREDICTION MARKET DATA:\n${marketContext}\n\nCompare your threat calculations against these market prices. Flag any significant divergences.`;
    }
    prompt += "\n\nCalculate the threat probabilities now. Be precise and calibrated.";

    const assessment = await callClaudeJSON<ThreatAssessment>(env.CLIPROXY_BASE_URL, {
      model: "gemini-2.5-flash",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      tools: [{
        name: "output_threat_assessment",
        description: "Output the calculated threat assessment with probabilities, analysis, and market divergences",
        parameters: {
          type: "object",
          properties: {
            tensionIndex: { type: "number" },
            hormuzClosure: { type: "number" },
            cyberAttack: { type: "number" },
            proxyEscalation: { type: "number" },
            directConfrontation: { type: "number" },
            sentimentScore: { type: "number" },
            flightAnomalyIndex: { type: "number" },
            maritimeAnomalyIndex: { type: "number" },
            analysisNarrative: { type: "string" },
            watchcon: { type: "string" },
            marketDivergences: { type: "array", items: { type: "string" } },
          },
          required: ["tensionIndex", "hormuzClosure", "cyberAttack", "proxyEscalation", "directConfrontation", "sentimentScore", "flightAnomalyIndex", "maritimeAnomalyIndex", "analysisNarrative", "watchcon"],
        },
      }],
      tool_choice: { type: "function", function: { name: "output_threat_assessment" } },
    });

    // Sanitize — Gemini fallback may return undefined/null for some fields
    const safe = {
      tensionIndex: Number(assessment.tensionIndex) || 0,
      hormuzClosure: Number(assessment.hormuzClosure) || 0,
      cyberAttack: Number(assessment.cyberAttack) || 0,
      proxyEscalation: Number(assessment.proxyEscalation) || 0,
      directConfrontation: Number(assessment.directConfrontation) || 0,
      sentimentScore: Number(assessment.sentimentScore) || 0,
      flightAnomalyIndex: Number(assessment.flightAnomalyIndex) || Number(flightAnomalyIndex) || 0,
      maritimeAnomalyIndex: Number(assessment.maritimeAnomalyIndex) || Number(maritimeAnomalyIndex) || 0,
      analysisNarrative: assessment.analysisNarrative || "",
      watchcon: normalizeWatchcon(assessment.watchcon),
      marketDivergences: assessment.marketDivergences || [],
    };

    // --- Prediction calibration logging ---
    const agentCount = Object.keys(agents).length;

    // Extract Polymarket prices from market agent data if available
    const marketData = d("markets") as Record<string, unknown>;
    const marketContracts = (marketData.contracts || marketData.events || marketData.items || []) as Array<Record<string, unknown>>;
    const findMarketPrice = (keywords: string[]): number | null => {
      for (const c of marketContracts) {
        const title = ((c.title || c.question || "") as string).toLowerCase();
        if (keywords.some(k => title.includes(k))) {
          const price = Number(c.outcomePrices?.[0] ?? c.bestBid ?? c.lastTradePrice ?? c.price);
          return isNaN(price) ? null : price * (price <= 1 ? 100 : 1); // normalize 0-1 to 0-100
        }
      }
      return null;
    };

    const predictionMetrics: Array<{ metric: string; estimate: number; keywords: string[] }> = [
      { metric: "hormuzClosure", estimate: safe.hormuzClosure, keywords: ["hormuz", "strait", "shipping", "blockade"] },
      { metric: "cyberAttack", estimate: safe.cyberAttack, keywords: ["cyber", "hack", "infrastructure"] },
      { metric: "proxyEscalation", estimate: safe.proxyEscalation, keywords: ["proxy", "hezbollah", "houthi", "militia"] },
      { metric: "directConfrontation", estimate: safe.directConfrontation, keywords: ["war", "strike", "military", "confrontation", "iran us"] },
    ];

    // Fire-and-forget — don't let logging failures block the response
    const logPromises = predictionMetrics.map(({ metric, estimate, keywords }) =>
      insertPredictionLog(env.DB, metric, estimate, findMarketPrice(keywords), agentCount)
        .catch(err => console.error(`[prediction_log] Failed to log ${metric}:`, err))
    );
    await Promise.all(logPromises);

    return corsResponse(safe);
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown error");
  }
}
