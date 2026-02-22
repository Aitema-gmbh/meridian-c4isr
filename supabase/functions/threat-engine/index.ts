import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a geopolitical threat analysis engine. Given real-time intelligence indicators and prediction market data, calculate precise threat probabilities. You MUST respond ONLY with a valid JSON object using the tool call provided.

Analyze these factors:
1. OSINT Sentiment Score (-1.0 hostile to +1.0 peaceful)
2. Flight Anomaly Index (0-100)
3. Maritime Anomaly Index (0-100)
4. GDELT Goldstein Scale (-10 to +10)
5. Diplomatic Activity Level
6. Prediction Market Odds (if available) - compare your assessment against market consensus

Algorithm:
- Tension Index = (|sentimentScore| * 30) + (flightAnomaly * 0.25) + (maritimeAnomaly * 0.15) + (|goldsteinScale| * 3)
- Adjust based on diplomatic signals, market data, and historical patterns
- Flag any significant divergences between your calculated probabilities and market prices`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { indicators, marketContext } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let prompt = `Analyze the following real-time intelligence indicators and produce a threat assessment:

CURRENT INDICATORS:
- OSINT Sentiment Score: ${indicators?.sentimentScore ?? -0.63}
- Flight Anomaly Index: ${indicators?.flightAnomalyIndex ?? 72}
- Maritime Anomaly Index: ${indicators?.maritimeAnomalyIndex ?? 45}
- GDELT Goldstein Scale: ${indicators?.goldsteinScale ?? -7.2}
- IRGCN Patrol Boat Deployments: ${indicators?.irgcnDeployments ?? "200% above baseline"}
- Diplomatic Signals: ${indicators?.diplomaticSignals ?? "Iranian FM denies buildup, combative tone"}
- Cyber Indicators: ${indicators?.cyberIndicators ?? "2 APT campaigns detected"}`;

    if (marketContext) {
      prompt += `\n\nPREDICTION MARKET DATA:\n${marketContext}\n\nCompare your threat calculations against these market prices. Flag any significant divergences.`;
    }

    prompt += "\n\nCalculate the threat probabilities now.";

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
                description: "Output the calculated threat assessment with probabilities, analysis, and market divergences",
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
                    analysisNarrative: { type: "string", description: "Brief analytical narrative explaining the threat calculations, key drivers, and any market divergences" },
                    watchcon: { type: "string", description: "Recommended WATCHCON level (1-5)" },
                    marketDivergences: {
                      type: "array",
                      items: { type: "string" },
                      description: "List of significant divergences between AI assessment and prediction market prices"
                    },
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
        return new Response(JSON.stringify({ error: "Rate limit exceeded." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(JSON.stringify({ error: "Threat engine AI error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (toolCall?.function?.arguments) {
      const assessment = JSON.parse(toolCall.function.arguments);
      return new Response(JSON.stringify(assessment), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Failed to parse threat assessment" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("threat-engine error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
