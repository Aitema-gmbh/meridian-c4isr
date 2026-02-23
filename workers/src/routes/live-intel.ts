import { corsError, corsResponse } from "../lib/cors";
import { callClaudeJSON } from "../lib/anthropic";
import { insertIntelSnapshot } from "../lib/db";
import type { Env } from "../lib/anthropic";

interface IntelItem {
  id: number;
  timestamp: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  content: string;
  source: string;
  sourceUrl?: string;
  entities: string[];
  sentiment: number;
  threat_tag: string;
  confidence: string;
}

interface IntelOutput {
  flashReport: string;
  dominantCategory: string;
  items: Array<Omit<IntelItem, "id" | "timestamp">>;
  averageSentiment: number;
}

async function fetchGdelt(query: string, max: number): Promise<unknown[]> {
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${max}&sort=datedesc`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const text = await resp.text();
    if (!text.startsWith("{") && !text.startsWith("[")) return [];
    const data = JSON.parse(text) as { articles?: unknown[] };
    return (data.articles || []).slice(0, max);
  } catch { return []; }
}

export async function liveIntel(_req: Request, env: Env): Promise<Response> {
  try {
    const [arts1, arts2, arts3, arts4, adsbResp] = await Promise.allSettled([
      fetchGdelt('(iran OR IRGC OR "persian gulf" OR hormuz OR tehran) (military OR nuclear OR sanctions OR strike OR threat)', 10),
      fetchGdelt('(CENTCOM OR "carrier strike" OR "B-2" OR "USS") (iran OR gulf OR hormuz OR "middle east")', 6),
      fetchGdelt('(houthi OR hezbollah OR "proxy war" OR "strait of hormuz" OR tanker) (iran OR attack OR missile)', 6),
      fetchGdelt('(iran OR IRGC) (cyber OR nuclear OR enrichment OR IAEA OR sanctions)', 4),
      fetch("https://api.adsb.lol/v2/mil"),
    ]);

    const taggedArticles = [
      ...(arts1.status === "fulfilled" ? arts1.value.slice(0, 10) : []).map((a) => ({ ...(a as Record<string, unknown>), queryTag: "IRAN_CRISIS" })),
      ...(arts2.status === "fulfilled" ? arts2.value.slice(0, 6) : []).map((a) => ({ ...(a as Record<string, unknown>), queryTag: "US_MILITARY_GULF" })),
      ...(arts3.status === "fulfilled" ? arts3.value.slice(0, 6) : []).map((a) => ({ ...(a as Record<string, unknown>), queryTag: "PROXY_MARITIME" })),
      ...(arts4.status === "fulfilled" ? arts4.value.slice(0, 4) : []).map((a) => ({ ...(a as Record<string, unknown>), queryTag: "IRAN_NUCLEAR_CYBER" })),
    ];

    let milTrackCount = 0;
    if (adsbResp.status === "fulfilled" && adsbResp.value.ok) {
      try {
        const adsbData = await adsbResp.value.json() as { ac?: Array<{ lat?: number; lon?: number }> };
        milTrackCount = (adsbData.ac || []).filter(
          (a) => a.lat != null && a.lon != null && a.lat >= 20 && a.lat <= 35 && a.lon >= 44 && a.lon <= 65
        ).length;
      } catch { /* ignore */ }
    }

    if (taggedArticles.length === 0) {
      return corsResponse({
        items: [], flashReport: null,
        metadata: { articleCount: 0, milTrackCount, timestamp: new Date().toISOString(), dominantCategory: "NONE" },
      });
    }

    const articleSummaries = taggedArticles
      .map((a, i) => { const art = a as { queryTag: string; title?: string; domain?: string; seendate?: string; url?: string }; return `[${i + 1}] [${art.queryTag}] "${art.title}" (${art.domain}, ${art.seendate}) URL: ${art.url || "N/A"}`; })
      .join("\n");

    const analyzed = await callClaudeJSON<IntelOutput>(env.CLIPROXY_BASE_URL, {
      model: "gemini-2.5-flash",
      max_tokens: 4096,
      system: "You are a senior intelligence analyst monitoring the Iran/US crisis in the Persian Gulf (Feb 2026). CRITICAL: ONLY include articles directly relevant to Iran, US-Iran tensions, Persian Gulf security, Strait of Hormuz, IRGC, Houthis, Hezbollah, US military deployments to the Gulf, Iran nuclear program, or Iran-related sanctions/cyber operations. REJECT any article not related to this crisis (e.g. domestic politics of other countries, sports, finance, unrelated regional news). For each relevant article produce an intel brief. Also generate a 3-sentence FLASH REPORT executive summary focused on the Iran/US crisis. You MUST respond using the output_intel_items tool.",
      messages: [{
        role: "user",
        content: `Analyze these ${taggedArticles.length} articles from 3 OSINT streams and produce intel briefs:\n\n${articleSummaries}\n\nFor each article: classify priority, assign threat_tag, set confidence, extract entities, score sentiment, write tactical summary, preserve sourceUrl.`,
      }],
      tools: [{
        name: "output_intel_items",
        description: "Output structured intelligence items with flash report",
        parameters: {
          type: "object",
          properties: {
            flashReport: { type: "string" },
            dominantCategory: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC"] },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  priority: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                  content: { type: "string" },
                  source: { type: "string" },
                  sourceUrl: { type: "string" },
                  entities: { type: "array", items: { type: "string" } },
                  sentiment: { type: "number" },
                  threat_tag: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC"] },
                  confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
                },
                required: ["priority", "content", "source", "entities", "sentiment", "threat_tag", "confidence"],
              },
            },
            averageSentiment: { type: "number" },
          },
          required: ["flashReport", "dominantCategory", "items", "averageSentiment"],
        },
      }],
      tool_choice: { type: "function", function: { name: "output_intel_items" } },
    });

    const items = (analyzed.items || []).map((item, i) => ({
      id: i + 1,
      timestamp: new Date(Date.now() - i * 300000).toISOString(),
      ...item,
    }));

    const responseData = {
      items,
      flashReport: analyzed.flashReport || null,
      metadata: {
        articleCount: taggedArticles.length,
        milTrackCount,
        averageSentiment: analyzed.averageSentiment ?? -0.5,
        timestamp: new Date().toISOString(),
        dominantCategory: analyzed.dominantCategory || "MILITARY",
      },
    };
    // Snapshot für Frontend-Fallback speichern
    await insertIntelSnapshot(env.DB, responseData as unknown as Record<string, unknown>).catch(() => {});
    return corsResponse(responseData);
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown error");
  }
}
