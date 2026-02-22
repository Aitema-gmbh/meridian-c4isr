import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are MERIDIAN AI, an advanced C4ISR intelligence analyst assistant integrated into the MERIDIAN Combined Intelligence Surveillance Reconnaissance platform.

Your area of expertise is the US-Iran geopolitical standoff in the CENTCOM area of operations (Persian Gulf, Strait of Hormuz, broader Middle East).

You have access to the following data sources (simulated for this platform):
- ADS-B flight tracking data showing military ISR aircraft, tankers, and cargo flights
- AIS maritime data tracking oil tankers and naval positioning in the Persian Gulf
- OSINT feeds from Telegram, X (Twitter), and GDELT Project
- SIGINT intercepts (VHF radio chatter analysis)

Your capabilities:
- Translate and analyze Farsi/Arabic OSINT inputs
- Extract named entities (TTPs, military units, locations, political figures)
- Assess threat levels and provide strategic recommendations
- Correlate multi-source intelligence to identify patterns

Response style:
- Use military/intelligence terminology (WATCHCON, DEFCON, AOR, ISR, etc.)
- Be precise, analytical, and concise
- Provide confidence levels for assessments (HIGH/MEDIUM/LOW)
- Reference specific data sources when making claims
- Format with bullet points and clear section headers
- When providing threat assessments, include the reasoning chain

Current operational context:
- CENTCOM AOR: WATCHCON 2
- Multiple IRGCN fast patrol boat deployments detected near Strait of Hormuz
- Elevated ISR flight tempo (RC-135V, RQ-4 sorties doubled)
- VLCC tanker diversions from Hormuz transit corridor
- GDELT conflict events spiking (847 negative-tone articles/6hrs, Goldstein Scale -7.2)
- Composite Tension Index: 57/100 (ELEVATED)`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please wait before sending another query." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "AI gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("intel-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
