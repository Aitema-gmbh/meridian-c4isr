import { corsError, corsResponse } from "../lib/cors";
import { callClaudeJSON } from "../lib/anthropic";
import { getLatestAgentReport, getAgentHistory, getTensionHistory, insertAgentReport, insertThreatAssessment, insertCountryScores } from "../lib/db";
import { normalizeWatchcon } from "../lib/anthropic";
import type { Env } from "../lib/anthropic";
import { aggregateSignals, aggregateMetricSignals, type AgentSignal } from "../lib/forecasting";

const AGENT_NAMES = ["flights", "naval", "osint", "reddit", "pentagon", "cyber", "markets", "wiki", "macro", "fires", "pizza", "ais", "acled", "telegram", "metaculus", "weather", "isw"];

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
    const recentCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h for latest reports
    const historyCutoff = 72; // 3 days of history

    // Phase 0: Load current + historical data for each agent
    const agentReports: Record<string, { data: Record<string, unknown>; summary: string; threat_level: number }> = {};
    const agentHistories: Record<string, { summary: string; threat_level: number; items_count: number; created_at: string }[]> = {};

    await Promise.all(AGENT_NAMES.map(async (agent) => {
      const [latest, history] = await Promise.all([
        getLatestAgentReport(env.DB, agent, recentCutoff),
        getAgentHistory(env.DB, agent, historyCutoff),
      ]);
      if (latest) agentReports[agent] = latest as { data: Record<string, unknown>; summary: string; threat_level: number };
      if (history.length) agentHistories[agent] = history;
    }));

    const activeAgents = Object.keys(agentReports);
    if (activeAgents.length === 0) {
      return corsResponse({ success: false, reason: "No agent data" });
    }

    // Load 3-day tension history for trend context
    const tensionHistory = await getTensionHistory(env.DB, historyCutoff);

    const lastRow = tensionHistory.length > 0 ? tensionHistory[0] : null;

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

    // Phase 2: Build rich 3-day context for AI analysis
    // Get corroboration data
    const corrobRows = await env.DB.prepare(
      `SELECT agent_name, corroboration_score FROM agent_reports
       WHERE corroboration_score > 1 AND created_at >= ?
       ORDER BY created_at DESC LIMIT 20`
    ).bind(recentCutoff).all<{ agent_name: string; corroboration_score: number }>();
    const corrobMap: Record<string, number> = {};
    for (const r of corrobRows.results) {
      corrobMap[r.agent_name] = Math.max(corrobMap[r.agent_name] || 0, r.corroboration_score);
    }

    // Build per-agent context with 3-day trend
    const contextParts = activeAgents.map((a) => {
      const corrob = corrobMap[a] ? ` [CORROBORATED: ${corrobMap[a]} sources]` : "";
      const history = agentHistories[a];
      let trendLine = "";
      if (history && history.length >= 3) {
        // Show threat level progression over last 3 days
        const levels = history.slice(0, 12).reverse().map(h => h.threat_level);
        const avg = Math.round(levels.reduce((s, v) => s + v, 0) / levels.length);
        const oldest = levels[0];
        const newest = levels[levels.length - 1];
        const delta = newest - oldest;
        const arrow = delta > 5 ? "↑ RISING" : delta < -5 ? "↓ FALLING" : "→ STABLE";
        trendLine = ` | 3D-TREND: ${arrow} (${oldest}→${newest}, avg=${avg}, ${levels.length} readings)`;
      }
      return `${a.toUpperCase()}: ${agentReports[a].summary?.slice(0, 120)} | CURRENT: ${agentReports[a].threat_level}/100${corrob}${trendLine}`;
    });

    // Tension history summary
    let tensionTrend = "";
    if (tensionHistory.length >= 3) {
      const recent = tensionHistory.slice(0, 6).map(t => `TI=${t.tension_index} WC=${t.watchcon}`);
      const oldest = tensionHistory[tensionHistory.length - 1];
      const newest = tensionHistory[0];
      const delta = newest.tension_index - oldest.tension_index;
      tensionTrend = `\n3-DAY TENSION TREND: ${delta > 0 ? "↑" : delta < 0 ? "↓" : "→"} (${oldest.tension_index}→${newest.tension_index} over ${tensionHistory.length} assessments). Recent: ${recent.join(" | ")}`;
    }

    const trendContext = lastRow
      ? `\nPREV: TI=${lastRow.tension_index}, WC=${lastRow.watchcon}`
      : "";
    const mathContext = `\nMATH BASELINE (Geometric Mean of Odds, extremizing d=${mathAgg.extremizingFactor}): TI=${mathAgg.threatLevel}, Hormuz=${hormuzMath.threatLevel}%, Cyber=${cyberMath.threatLevel}%, Proxy=${proxyMath.threatLevel}%, Direct=${directMath.threatLevel}%, Confidence=${mathAgg.confidence}, Convergence=${mathAgg.convergenceScore}`;

    const assessment = await callClaudeJSON<HeadAnalystOutput>(env.CLIPROXY_BASE_URL, {
      model: "gemini-3.1-pro-high",
      max_tokens: 8192,
      system: `You are the HEAD ANALYST at a C4ISR intelligence fusion center monitoring the IRAN/US CRISIS (February 2026).

SITUATION BRIEFING:
- 2 US Carrier Strike Groups (Lincoln, Truman) deployed to Persian Gulf
- B-2 Spirit bombers staged at Diego Garcia with bunker-buster ordnance
- Trump has issued public ultimatum: Iran must halt enrichment or face "overwhelming response"
- Iran enriching to 60%+ at Fordow (underground facility, hardened target)
- IRGC conducting "Great Prophet" naval exercises near Strait of Hormuz
- Houthi attacks on Red Sea shipping continue (Bab el-Mandeb disrupted)
- Iraq/Syria PMF/Kataib Hezbollah attacks on US bases (Al-Asad, Erbil)
- Israel conducting preparatory exercises for potential strike on Iranian nuclear facilities
- Oil prices elevated ($90+ Brent), Gulf states hedging diplomatically

YOUR ROLE: Synthesize 14 collection agents into ONE coherent threat picture.

METHODOLOGY:
1. You receive a MATHEMATICAL BASELINE from Superforecasting aggregation (Geometric Mean of Odds with extremizing). This is your ANCHOR — stay within ±15 unless strong qualitative reasons exist.
2. You receive 3-DAY TREND DATA per agent — watch for CONVERGENT ESCALATION (multiple agents rising simultaneously).
3. Weight HARD SIGNALS (flights, AIS, cyber, pentagon) 3x over SOFT SIGNALS (wiki, reddit, pizza).
4. Your flashReport is the FIRST THING senior decision-makers read — make it count. Be specific: name actors, locations, timeframes.

PROBABILITY CALIBRATION:
- hormuzClosure: What's the probability Iran physically blocks the strait in next 7 days? Base rate: <5% even during crises.
- cyberAttack: Major state-sponsored cyber operation targeting critical infrastructure? Base rate: ~10% during active tensions.
- proxyEscalation: Significant proxy attack (50+ casualties or major infrastructure hit)? Base rate: ~15% given current tempo.
- directConfrontation: Direct US-Iran military exchange? Base rate: <3% even at WATCHCON II.

Be precise, not dramatic. A flashReport that says "tensions remain elevated" is useless. Instead: "IRGC IRIN deployed 3 additional fast-attack craft to Bandar Abbas. Combined with 2 P-8A sorties over Hormuz and CENTCOM's recall of USS Bataan ARG, this suggests preparation for maritime interdiction scenario within 48-72h."

WATCHCON SCALE (same as DEFCON — lower number = HIGHER threat):
- WATCHCON I = MAXIMUM threat (TI > 85) — imminent conflict
- WATCHCON II = HIGH threat (TI 60-85) — crisis posture
- WATCHCON III = ELEVATED (TI 40-60) — increased monitoring
- WATCHCON IV = GUARDED (TI 20-40) — routine enhanced
- WATCHCON V = NORMAL (TI < 20) — baseline

CRITICAL: Call output_head_analyst_assessment with ALL fields. Every number 0-100. watchcon = Roman numeral I-V (I=highest threat, V=lowest).`,
      messages: [{
        role: "user",
        content: `AGENTS (with 3-day trends):\n${contextParts.join("\n")}${trendContext}${tensionTrend}${mathContext}\n\nSynthesize threat assessment. Use math baseline as anchor, adjust with context and 3-day trends.`,
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
    // Also correct WATCHCON if model misinterprets scale (V=lowest, I=highest)
    const ti = Number(assessment.tensionIndex) || 0;
    let wc = normalizeWatchcon(assessment.watchcon);
    // Auto-correct WATCHCON based on TI if model clearly got scale backwards
    if (ti > 85 && wc === "V") wc = "I";
    else if (ti > 60 && (wc === "V" || wc === "IV")) wc = "II";
    else if (ti > 40 && wc === "V") wc = "III";
    else if (ti < 20 && wc === "I") wc = "V";
    const safe = {
      tensionIndex: ti,
      watchcon: wc,
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
