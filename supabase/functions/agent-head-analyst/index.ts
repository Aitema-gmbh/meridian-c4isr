import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AGENT_NAMES = ["flights", "naval", "osint", "reddit", "pentagon", "cyber", "markets"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!LOVABLE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing env vars");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    console.log("[agent-head-analyst] Starting synthesis...");

    // Get latest report from each agent (last 90 minutes)
    const cutoff = new Date(Date.now() - 90 * 60 * 1000).toISOString();

    const agentReports: Record<string, any> = {};
    for (const agent of AGENT_NAMES) {
      const { data } = await supabase
        .from("agent_reports")
        .select("*")
        .eq("agent_name", agent)
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (data) agentReports[agent] = data;
    }

    const activeAgents = Object.keys(agentReports);
    console.log("[agent-head-analyst] Active agents:", activeAgents.join(", "));

    if (activeAgents.length === 0) {
      console.log("[agent-head-analyst] No recent agent reports. Skipping.");
      return new Response(JSON.stringify({ success: false, reason: "No agent data" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get last threat assessment for trend comparison
    const { data: lastAssessment } = await supabase
      .from("threat_assessments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Build comprehensive context for AI
    const contextParts: string[] = [];

    if (agentReports.flights) {
      const fd = agentReports.flights.data;
      contextParts.push(`FLIGHT AGENT: ${agentReports.flights.summary}\nFlight Anomaly Index: ${fd.anomalyIndex}/100. Regional aircraft: ${fd.totalRegional}. ISR orbits: ${(fd.activeIsrOrbits || []).join(", ") || "none"}.`);
    }
    if (agentReports.naval) {
      const nd = agentReports.naval.data;
      contextParts.push(`NAVAL AGENT: ${agentReports.naval.summary}\nMaritime Anomaly Index: ${nd.maritimeAnomalyIndex}/100. Formations: ${(nd.formations || []).join("; ") || "none"}.`);
    }
    if (agentReports.osint) {
      const od = agentReports.osint.data;
      contextParts.push(`OSINT AGENT: ${agentReports.osint.summary}\nDominant category: ${od.dominantCategory || "UNKNOWN"}. Items: ${(od.items || []).length}.`);
    }
    if (agentReports.reddit) {
      const rd = agentReports.reddit.data;
      contextParts.push(`REDDIT AGENT: ${agentReports.reddit.summary}\nSignal strength: ${rd.overallSignalStrength || "UNKNOWN"}. Relevant signals: ${(rd.items || []).length}.`);
    }
    if (agentReports.pentagon) {
      const pd = agentReports.pentagon.data;
      contextParts.push(`PENTAGON AGENT: ${agentReports.pentagon.summary}\nActivity Index: ${pd.activityIndex}/100. Nighttime flag: ${pd.nighttimeFlag ? "YES" : "no"}. Contract anomalies: ${(pd.contractAnomalies || []).length}.`);
    }
    if (agentReports.cyber) {
      const cd = agentReports.cyber.data;
      contextParts.push(`CYBER AGENT: ${agentReports.cyber.summary}\nCyber Threat Level: ${cd.cyberThreatLevel}/100. Active APTs: ${(cd.activeAPTs || []).join(", ") || "none"}.`);
    }
    if (agentReports.markets) {
      const md = agentReports.markets.data;
      const topMarkets = (md.markets || []).slice(0, 8).map((m: any) => `"${(m.question || "").slice(0, 50)}": ${m.yesPrice ?? "?"}%`).join("; ");
      contextParts.push(`MARKETS AGENT: ${agentReports.markets.summary}\nTop markets: ${topMarkets}. Significant moves: ${(md.significantMoves || []).length}.`);
    }

    const trendContext = lastAssessment
      ? `\nPREVIOUS ASSESSMENT (${lastAssessment.created_at}): Tension=${lastAssessment.tension_index}, WATCHCON=${lastAssessment.watchcon}, Hormuz=${lastAssessment.hormuz_closure}%, Cyber=${lastAssessment.cyber_attack}%, Proxy=${lastAssessment.proxy_escalation}%, Direct=${lastAssessment.direct_confrontation}%`
      : "\nNo previous assessment available.";

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: `You are the HEAD ANALYST of a multi-source intelligence fusion center. You receive reports from 7 specialized agents (flights, naval, OSINT, Reddit, Pentagon, cyber, markets). Your job is to synthesize all inputs into a unified threat assessment. Calculate probabilities based on ALL available evidence. Compare your analysis against prediction market prices and flag divergences. If agents contradict each other, note it. Be precise and data-driven.` },
          { role: "user", content: `MULTI-AGENT INTELLIGENCE SYNTHESIS\n\n${contextParts.join("\n\n")}${trendContext}\n\nSynthesize all agent reports into a unified threat assessment. Calculate precise probabilities. Identify divergences between your assessment and market prices. Note any inter-agent conflicts.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "output_head_analyst_assessment",
            description: "Output the unified threat assessment",
            parameters: {
              type: "object",
              properties: {
                tensionIndex: { type: "number", description: "Composite 0-100" },
                watchcon: { type: "string", description: "WATCHCON 1-5" },
                hormuzClosure: { type: "number", description: "Probability 0-100" },
                cyberAttack: { type: "number", description: "Probability 0-100" },
                proxyEscalation: { type: "number", description: "Probability 0-100" },
                directConfrontation: { type: "number", description: "Probability 0-100" },
                flashReport: { type: "string", description: "5-sentence FLASH REPORT" },
                analysisNarrative: { type: "string", description: "Detailed analytical narrative" },
                marketDivergences: { type: "array", items: { type: "string" }, description: "Divergences between AI and market" },
                agentConflicts: { type: "array", items: { type: "string" }, description: "Conflicting signals between agents" },
                keyDrivers: { type: "array", items: { type: "string" }, description: "Top 3-5 threat drivers" },
                sentimentScore: { type: "number", description: "Overall sentiment -1 to 1" },
              },
              required: ["tensionIndex", "watchcon", "hormuzClosure", "cyberAttack", "proxyEscalation", "directConfrontation", "flashReport", "analysisNarrative", "marketDivergences", "agentConflicts", "keyDrivers", "sentimentScore"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "output_head_analyst_assessment" } },
      }),
    });

    if (!aiResponse.ok) {
      console.error("[agent-head-analyst] AI error:", aiResponse.status);
      return new Response(JSON.stringify({ success: false, error: "AI failed" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const tc = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!tc?.function?.arguments) throw new Error("No tool call from AI");

    const assessment = JSON.parse(tc.function.arguments);

    // Save to agent_reports
    await supabase.from("agent_reports").insert({
      agent_name: "head-analyst",
      report_type: "cycle",
      data: {
        ...assessment,
        agentsCovered: activeAgents,
        agentThreatLevels: Object.fromEntries(activeAgents.map(a => [a, agentReports[a].threat_level])),
      },
      summary: assessment.flashReport,
      threat_level: assessment.tensionIndex,
      confidence: activeAgents.length >= 5 ? "HIGH" : activeAgents.length >= 3 ? "MEDIUM" : "LOW",
      items_count: activeAgents.length,
    });

    // Save to threat_assessments (backward compat)
    await supabase.from("threat_assessments").insert({
      tension_index: assessment.tensionIndex,
      watchcon: assessment.watchcon,
      hormuz_closure: assessment.hormuzClosure,
      cyber_attack: assessment.cyberAttack,
      proxy_escalation: assessment.proxyEscalation,
      direct_confrontation: assessment.directConfrontation,
      analysis_narrative: assessment.analysisNarrative,
      market_divergences: assessment.marketDivergences || [],
      raw_indicators: {
        agentsCovered: activeAgents,
        agentThreatLevels: Object.fromEntries(activeAgents.map(a => [a, agentReports[a].threat_level])),
        keyDrivers: assessment.keyDrivers,
        agentConflicts: assessment.agentConflicts,
        sentimentScore: assessment.sentimentScore,
      },
    });

    // Also save flash report to intel_snapshots
    await supabase.from("intel_snapshots").insert({
      flash_report: assessment.flashReport,
      article_count: agentReports.osint?.items_count || 0,
      mil_track_count: agentReports.flights?.data?.totalRegional || 0,
      average_sentiment: assessment.sentimentScore,
      dominant_category: "SYNTHESIS",
      items: assessment.keyDrivers?.map((d: string, i: number) => ({ id: i + 1, content: d, priority: "HIGH", source: "HEAD-ANALYST" })) || [],
      source_type: "head-analyst",
    });

    console.log("[agent-head-analyst] Assessment saved. Tension:", assessment.tensionIndex, "WATCHCON:", assessment.watchcon);

    return new Response(JSON.stringify({
      success: true,
      tensionIndex: assessment.tensionIndex,
      watchcon: assessment.watchcon,
      agentsCovered: activeAgents.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[agent-head-analyst] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
