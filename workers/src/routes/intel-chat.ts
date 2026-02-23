import { CORS_HEADERS, corsError } from "../lib/cors";
import { callClaude } from "../lib/anthropic";
import type { Env } from "../lib/anthropic";

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

export async function intelChat(req: Request, env: Env): Promise<Response> {
  try {
    const { messages, liveContext } = await req.json() as { messages: Array<{ role: string; content: string }>; liveContext?: string };

    const systemContent = SYSTEM_PROMPT + (liveContext || "");

    const resp = await callClaude(env.CLIPROXY_BASE_URL, {
      model: "gemini-2.5-flash",
      max_tokens: 8192,
      system: systemContent,
      messages: messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      stream: true,
    });

    if (!resp.ok) {
      if (resp.status === 429) return corsError("Rate limit exceeded. Please wait.", 429);
      if (resp.status === 402) return corsError("AI credits exhausted.", 402);
      return corsError("AI gateway error", 500);
    }

    // Stream SSE back to client
    return new Response(resp.body, {
      headers: { ...CORS_HEADERS, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown error");
  }
}
