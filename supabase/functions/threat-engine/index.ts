import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a geopolitical threat analysis engine. Given the following real-time intelligence indicators, calculate precise threat probabilities. You MUST respond ONLY with a valid JSON object using the tool call provided. Do not include any other text.

Analyze these factors:
1. OSINT Sentiment Score (scale: -1.0 hostile to +1.0 peaceful)
2. Flight Anomaly Index (0-100, baseline military ISR flights vs current)  
3. Maritime Anomaly Index (0-100, tanker diversions and AIS gaps)
4. GDELT Goldstein Scale (range -10 to +10, current conflict tone)
5. Diplomatic Activity Level (recent statements, UN sessions, back-channel signals)

Output a mathematically weighted threat assessment. Your algorithm:
- Tension Index = (|sentimentScore| * 30) + (flightAnomaly * 0.25) + (maritimeAnomaly * 0.15) + (|goldsteinScale| * 3)
- Adjust based on diplomatic signals and historical patterns
- Each probability must be justified by specific data points`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { indicators } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const prompt = `Analyze the following real-time intelligence indicators and produce a threat assessment:

CURRENT INDICATORS:
- OSINT Sentiment Score: ${indicators?.sentimentScore ?? -0.63}
- Flight Anomaly Index: ${indicators?.flightAnomalyIndex ?? 72} (ISR sorties doubled in 12hrs)
- Maritime Anomaly Index: ${indicators?.maritimeAnomalyIndex ?? 45} (3 VLCCs diverted, AIS gaps detected)
- GDELT Goldstein Scale: ${indicators?.goldsteinScale ?? -7.2} (847 conflict events in 6hrs)
- IRGCN Patrol Boat Deployments: ${indicators?.irgcnDeployments ?? "200% above baseline"}
- Recent Diplomatic Signals: ${indicators?.diplomaticSignals ?? "Iranian FM denies buildup, combative tone"}
- Cyber Indicators: ${indicators?.cyberIndicators ?? "2 APT campaigns detected targeting Gulf infrastructure"}

Calculate the threat probabilities now.`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "output_threat_assessment",
                description: "Output the calculated threat assessment with probabilities and analysis",
                parameters: {
                  type: "object",
                  properties: {
                    tensionIndex: { type: "number", description: "Composite tension index 0-100" },
                    hormuzClosure: { type: "number", description: "Probability of Strait of Hormuz closure 0-100" },
                    cyberAttack: { type: "number", description: "Probability of major cyberattack 0-100" },
                    proxyEscalation: { type: "number", description: "Probability of proxy force escalation 0-100" },
                    directConfrontation: { type: "number", description: "Probability of direct military confrontation 0-100" },
                    sentimentScore: { type: "number", description: "Analyzed OSINT sentiment -1 to 1" },
                    flightAnomalyIndex: { type: "number", description: "Flight anomaly score 0-100" },
                    maritimeAnomalyIndex: { type: "number", description: "Maritime anomaly score 0-100" },
                    analysisNarrative: { type: "string", description: "Brief analytical narrative explaining the threat calculations and key drivers" },
                    watchcon: { type: "string", description: "Recommended WATCHCON level (1-5)" },
                  },
                  required: [
                    "tensionIndex", "hormuzClosure", "cyberAttack",
                    "proxyEscalation", "directConfrontation", "sentimentScore",
                    "flightAnomalyIndex", "maritimeAnomalyIndex", "analysisNarrative", "watchcon"
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "output_threat_assessment" } },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "Threat engine AI error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    
    if (toolCall?.function?.arguments) {
      const assessment = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(assessment), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Failed to parse threat assessment" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("threat-engine error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
