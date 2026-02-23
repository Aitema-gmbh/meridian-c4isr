import { corsError, corsResponse } from "../lib/cors";
import { callClaudeJSON } from "../lib/anthropic";
import { getLatestAgentReport, insertAgentReport, insertThreatAssessment, insertCountryScores } from "../lib/db";
import { normalizeWatchcon } from "../lib/anthropic";
import type { Env } from "../lib/anthropic";
import { aggregateSignals, aggregateMetricSignals, type AgentSignal } from "../lib/forecasting";

const AGENT_NAMES = ["flights", "naval", "osint", "reddit", "pentagon", "cyber", "markets", "wiki", "macro", "fires", "pizza", "ais", "acled", "telegram"];

const FOCUS_COUNTRIES = [
  { code: "IR", name: "Iran", keywords: ["iran", "iranian", "tehran", "irgc", "khamenei", "hormuz", "pezeshkian", "larijani", "fordow", "natanz"] },
  { code: "IL", name: "Israel", keywords: ["israel", "israeli", "idf", "netanyahu"] },
  { code: "SA", name: "Saudi Arabia", keywords: ["saudi", "riyadh", "mbs", "aramco"] },
  { code: "AE", name: "UAE", keywords: ["uae", "emirates", "abu dhabi", "dubai"] },
  { code: "YE", name: "Yemen", keywords: ["yemen", "houthi", "ansar allah"] },
  { code: "IQ", name: "Iraq", keywords: ["iraq", "iraqi", "baghdad", "pmf"] },
  { code: "QA", name: "Qatar", keywords: ["qatar", "doha", "al udeid"] },
  { code: "LB", name: "Lebanon", keywords: ["lebanon", "hezbollah", "beirut"] },
  { code: "US", name: "United States", keywords: ["us military", "pentagon", "centcom", "trump", "carrier strike", "abraham lincoln", "b-2"] },
];

interface HeadAnalystOutput {
  tensionIndex: number;
  watchcon: string;
  hormuzClosure: number;
  cyberAttack: number;
  proxyEscalation: number;
  directConfrontation: number;
  flashReport: string;
  analysisNarrative: string;
  marketDivergences: string[];
  agentConflicts: string[];
  keyDrivers: string[];
  sentimentScore: number;
}

export async function agentHeadAnalyst(_req: Request, env: Env): Promise<Response> {
  try {
    const cutoff = new Date(Date.now() - 90 * 60 * 1000).toISOString();

    const agentReports: Record<string, { data: Record<string, unknown>; summary: string; threat_level: number }> = {};
    for (const agent of AGENT_NAMES) {
      const row = await getLatestAgentReport(env.DB, agent, cutoff);
      if (row) agentReports[agent] = row as { data: Record<string, unknown>; summary: string; threat_level: number };
    }

    const activeAgents = Object.keys(agentReports);
    if (activeAgents.length === 0) {
      return corsResponse({ success: false, reason: "No agent data" });
    }

    const lastRow = await env.DB.prepare(
      `SELECT tension_index, watchcon FROM threat_assessments ORDER BY created_at DESC LIMIT 1`
    ).first<{ tension_index: number; watchcon: string }>();

    // Phase 1: Mathematical aggregation (Superforecasting / Geometric Mean of Odds)
    const now = Date.now();
    const agentSignals: AgentSignal[] = activeAgents.map(a => ({
      agentName: a,
      threatLevel: agentReports[a].threat_level,
      itemsCount: (agentReports[a].data as any)?.items_count || 0,
      minutesAgo: Math.round((now - new Date((agentReports[a] as any).created_at || new Date().toISOString()).getTime()) / 60000),
    }));

    const mathAgg = aggregateSignals(agentSignals, 0.15);
    const hormuzMath = aggregateMetricSignals("hormuzClosure", agentSignals, 0.08);
    const cyberMath = aggregateMetricSignals("cyberAttack", agentSignals, 0.12);
    const proxyMath = aggregateMetricSignals("proxyEscalation", agentSignals, 0.15);
    const directMath = aggregateMetricSignals("directConfrontation", agentSignals, 0.05);

    // Phase 2: AI-powered contextual analysis (informed by math baseline)
    // Get corroboration data for context
    const corrobRows = await env.DB.prepare(
      `SELECT agent_name, corroboration_score FROM agent_reports
       WHERE corroboration_score > 1 AND created_at >= ?
       ORDER BY created_at DESC LIMIT 20`
    ).bind(cutoff).all<{ agent_name: string; corroboration_score: number }>();
    const corrobMap: Record<string, number> = {};
    for (const r of corrobRows.results) {
      corrobMap[r.agent_name] = Math.max(corrobMap[r.agent_name] || 0, r.corroboration_score);
    }

    const contextParts = activeAgents.map((a) => {
      const corrob = corrobMap[a] ? ` [CORROBORATED: ${corrobMap[a]} sources]` : "";
      return `${a.toUpperCase()}: ${agentReports[a].summary?.slice(0, 100)} | ${agentReports[a].threat_level}/100${corrob}`;
    });
    const trendContext = lastRow
      ? `\nPREV: TI=${lastRow.tension_index}, WC=${lastRow.watchcon}`
      : "";
    const mathContext = `\nMATH BASELINE (Geometric Mean of Odds, extremizing d=${mathAgg.extremizingFactor}): TI=${mathAgg.threatLevel}, Hormuz=${hormuzMath.threatLevel}%, Cyber=${cyberMath.threatLevel}%, Proxy=${proxyMath.threatLevel}%, Direct=${directMath.threatLevel}%, Confidence=${mathAgg.confidence}, Convergence=${mathAgg.convergenceScore}`;

    const assessment = await callClaudeJSON<HeadAnalystOutput>(env.CLIPROXY_BASE_URL, {
      model: "gemini-2.5-flash",
      max_tokens: 4096,
      system: `You are the HEAD ANALYST of an intelligence fusion center monitoring the IRAN/US CRISIS (Feb 2026). 2 US CSGs in Gulf. Trump ultimatum. B-2s at Diego Garcia. You receive a MATHEMATICAL BASELINE from Superforecasting aggregation (Geometric Mean of Odds with Neyman-Roughgarden extremizing). Use this as your starting point but adjust based on contextual analysis. Your final numbers should stay within ±15 of the math baseline unless you have strong qualitative reasons. CRITICAL: Call output_head_analyst_assessment with ALL fields. Every number 0-100. watchcon = Roman numeral I-V.`,
      messages: [{
        role: "user",
        content: `AGENTS:\n${contextParts.join("\n")}${trendContext}${mathContext}\n\nSynthesize threat assessment. Use math baseline as anchor, adjust with context.`,
      }],
      tools: [{
        name: "output_head_analyst_assessment",
        description: "Output unified threat assessment",
        parameters: {
          type: "object",
          properties: {
            tensionIndex: { type: "number" }, watchcon: { type: "string" },
            hormuzClosure: { type: "number" }, cyberAttack: { type: "number" },
            proxyEscalation: { type: "number" }, directConfrontation: { type: "number" },
            flashReport: { type: "string" }, analysisNarrative: { type: "string" },
            marketDivergences: { type: "array", items: { type: "string" } },
            agentConflicts: { type: "array", items: { type: "string" } },
            keyDrivers: { type: "array", items: { type: "string" } },
            sentimentScore: { type: "number" },
          },
          required: ["tensionIndex", "watchcon", "hormuzClosure", "cyberAttack", "proxyEscalation", "directConfrontation", "flashReport", "analysisNarrative", "marketDivergences", "agentConflicts", "keyDrivers", "sentimentScore"],
        },
      }],
      tool_choice: { type: "function", function: { name: "output_head_analyst_assessment" } },
    });

    // Sanitize — Gemini may return undefined/null for some fields
    const safe = {
      tensionIndex: Number(assessment.tensionIndex) || 0,
      watchcon: normalizeWatchcon(assessment.watchcon),
      hormuzClosure: Number(assessment.hormuzClosure) || 0,
      cyberAttack: Number(assessment.cyberAttack) || 0,
      proxyEscalation: Number(assessment.proxyEscalation) || 0,
      directConfrontation: Number(assessment.directConfrontation) || 0,
      flashReport: assessment.flashReport || "Assessment generated.",
      analysisNarrative: assessment.analysisNarrative || "",
      marketDivergences: assessment.marketDivergences || [],
      agentConflicts: assessment.agentConflicts || [],
      keyDrivers: assessment.keyDrivers || [],
      sentimentScore: Number(assessment.sentimentScore) || 0,
    };

    await Promise.all([
      insertAgentReport(env.DB, {
        agent_name: "head-analyst", report_type: "cycle",
        data: { ...safe, agentsCovered: activeAgents },
        summary: safe.flashReport,
        threat_level: safe.tensionIndex,
        confidence: activeAgents.length >= 5 ? "HIGH" : "MEDIUM",
        items_count: activeAgents.length,
      }),
      insertThreatAssessment(env.DB, {
        tension_index: safe.tensionIndex,
        watchcon: safe.watchcon,
        hormuz_closure: safe.hormuzClosure,
        cyber_attack: safe.cyberAttack,
        proxy_escalation: safe.proxyEscalation,
        direct_confrontation: safe.directConfrontation,
        analysis_narrative: safe.analysisNarrative,
        market_divergences: safe.marketDivergences,
        raw_indicators: {
          agentsCovered: activeAgents,
          keyDrivers: safe.keyDrivers,
          sentimentScore: safe.sentimentScore,
          mathBaseline: {
            tensionIndex: mathAgg.threatLevel,
            hormuzClosure: hormuzMath.threatLevel,
            cyberAttack: cyberMath.threatLevel,
            proxyEscalation: proxyMath.threatLevel,
            directConfrontation: directMath.threatLevel,
            confidence: mathAgg.confidence,
            convergence: mathAgg.convergenceScore,
            extremizingFactor: mathAgg.extremizingFactor,
            weights: mathAgg.weights,
          },
        },
      }),
    ]);

    // CII: Country Instability Index — multi-source scoring
    const countryScores = FOCUS_COUNTRIES.map((country) => {
      const matchText = (text: string) => country.keywords.some((k) => text.toLowerCase().includes(k));

      // OSINT articles mentioning this country
      let osintScore = 0;
      if (agentReports.osint?.data?.articles) {
        osintScore = Math.min(25, (agentReports.osint.data.articles as { title?: string }[]).filter((a) => matchText(a.title || "")).length * 6);
      }

      // ACLED/conflict data for this country
      let conflictScore = 0;
      if (agentReports.acled?.data?.countryBreakdown) {
        const breakdown = agentReports.acled.data.countryBreakdown as Record<string, { events: number; fatalities: number }>;
        for (const [c, data] of Object.entries(breakdown)) {
          if (matchText(c)) conflictScore = Math.min(25, data.events * 3 + data.fatalities * 0.5);
        }
      }
      if (agentReports.acled?.data?.rssCountryCounts) {
        const rss = agentReports.acled.data.rssCountryCounts as Record<string, number>;
        for (const [c, n] of Object.entries(rss)) {
          if (matchText(c)) conflictScore = Math.max(conflictScore, Math.min(25, n * 5));
        }
      }

      // AIS/maritime signals — boost for Iran (Hormuz), Yemen (Bab el-Mandeb)
      let maritimeScore = 0;
      if (agentReports.ais?.data?.chokepointAlerts) {
        const alerts = agentReports.ais.data.chokepointAlerts as { name: string; riskScore: number }[];
        for (const alert of alerts) {
          if (country.code === "IR" && alert.name.toLowerCase().includes("hormuz")) maritimeScore = Math.min(20, alert.riskScore * 0.2);
          if (country.code === "YE" && alert.name.toLowerCase().includes("mandeb")) maritimeScore = Math.min(20, alert.riskScore * 0.2);
        }
      }

      // Cyber signals — boost for IR, US
      let cyberScore = 0;
      if (agentReports.cyber && (country.code === "IR" || country.code === "US")) {
        cyberScore = Math.min(15, (agentReports.cyber.threat_level || 0) * 0.15);
      }

      // Reddit/telegram social signals
      let socialScore = 0;
      const socialAgents = ["reddit", "telegram"];
      for (const sa of socialAgents) {
        if (agentReports[sa]?.data) {
          const posts = (agentReports[sa].data.posts || agentReports[sa].data.items || []) as { text?: string; title?: string }[];
          const matches = posts.filter(p => matchText((p.text || "") + " " + (p.title || ""))).length;
          socialScore += Math.min(8, matches * 2);
        }
      }
      socialScore = Math.min(15, socialScore);

      const cii = Math.min(100, Math.round(osintScore + conflictScore + maritimeScore + cyberScore + socialScore));

      return {
        country_code: country.code,
        country_name: country.name,
        cii_score: cii,
        signal_breakdown: { osint: osintScore, conflict: conflictScore, maritime: maritimeScore, cyber: cyberScore, social: socialScore },
        trend_24h: 0,
        trend_7d: 0,
      };
    });

    // Calculate trends by comparing to previous scores
    try {
      const prevScores = await env.DB.prepare(
        `SELECT country_code, cii_score, created_at FROM country_scores WHERE created_at >= ? ORDER BY created_at DESC`
      ).bind(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).all<{ country_code: string; cii_score: number; created_at: string }>();

      if (prevScores.results?.length) {
        const now = Date.now();
        for (const cs of countryScores) {
          const prev = prevScores.results.filter(r => r.country_code === cs.country_code);
          // 24h trend
          const prev24h = prev.find(r => (now - new Date(r.created_at).getTime()) > 20 * 60 * 60 * 1000 && (now - new Date(r.created_at).getTime()) < 28 * 60 * 60 * 1000);
          if (prev24h) cs.trend_24h = cs.cii_score - prev24h.cii_score;
          // 7d trend
          const prev7d = prev.find(r => (now - new Date(r.created_at).getTime()) > 6 * 24 * 60 * 60 * 1000);
          if (prev7d) cs.trend_7d = cs.cii_score - prev7d.cii_score;
        }
      }
    } catch { /* trends are optional */ }

    await insertCountryScores(env.DB, countryScores);

    return corsResponse({ success: true, tensionIndex: assessment.tensionIndex, watchcon: assessment.watchcon, agentsCovered: activeAgents.length });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}
