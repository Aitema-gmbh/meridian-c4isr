/**
 * Einfache Proxy-Routes: prediction-markets, reddit-intel, intel-agent
 */
import { corsError, corsResponse } from "../lib/cors";
import { insertMarketSnapshot } from "../lib/db";
import type { Env } from "../lib/anthropic";

const IRAN_EVENT_SLUGS = [
  "us-strikes-iran-by",
  "will-the-iranian-regime-fall-by-the-end-of-2026",
  "will-the-us-invade-iran-by-march-31",
  "israel-x-iran-ceasefire-broken-by",
  "iran-strike-on-us-military-by-march-31",
  "us-iran-war-2026",
  "strait-of-hormuz-closure-2026",
];

interface PolymarketEvent {
  id?: string;
  title?: string;
  active?: boolean;
  endDate?: string;
  volume?: string | number;
  liquidity?: string | number;
  markets?: Array<{ outcomePrices?: string[]; outcomes?: string[]; question?: string }>;
  tags?: Array<{ label?: string }>;
  slug?: string;
}

function parsePrices(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return []; } }
  return [];
}

export async function predictionMarkets(_req: Request, env: Env): Promise<Response> {
  try {
    const rawEvents: PolymarketEvent[] = [];
    const seenIds = new Set<string>();

    // Fetch all Iran-related events
    const results = await Promise.allSettled(
      IRAN_EVENT_SLUGS.map((slug) =>
        fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`)
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [])
      )
    );
    results.forEach((r) => { if (r.status === "fulfilled") rawEvents.push(...(r.value as PolymarketEvent[])); });

    // Also search Middle East tag
    const tagResult = await fetch("https://gamma-api.polymarket.com/events?tag=Middle+East&active=true&closed=false&limit=50")
      .then((r) => (r.ok ? r.json() : [])).catch(() => []) as PolymarketEvent[];
    const IRAN_FILTER = /iran|hormuz|irgc|houthi|persian.gulf|israel.*iran/i;
    rawEvents.push(...tagResult.filter((e) => IRAN_FILTER.test(e.title || "") || IRAN_FILTER.test(e.slug || "")));

    // Deduplicate events
    const uniqueEvents = rawEvents.filter((e) => {
      const id = e.id || e.slug || "";
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    // For events with many sub-markets (time-based), pick the NEXT upcoming deadline
    const now = new Date();
    interface MarketItem { id: string; question: string; category: string; yesPrice: number | null; noPrice: number | null; volume: number; liquidity: number; endDate: string; active: boolean; url?: string; }
    const markets: MarketItem[] = [];

    for (const e of uniqueEvents) {
      const subMarkets = e.markets || [];
      if (subMarkets.length <= 1) {
        // Single market event — use directly
        const m = subMarkets[0];
        const prices = parsePrices(m?.outcomePrices);
        const yesPrice = prices[0] ? Math.round(parseFloat(prices[0]) * 100) : null;
        const noPrice = prices[1] ? Math.round(parseFloat(prices[1]) * 100) : null;
        markets.push({
          id: e.id || e.slug || "",
          question: e.title || m?.question || "",
          category: e.tags?.[0]?.label || "geopolitics",
          yesPrice, noPrice,
          volume: typeof e.volume === "string" ? parseFloat(e.volume) : (e.volume || 0),
          liquidity: typeof e.liquidity === "string" ? parseFloat(e.liquidity) : (e.liquidity || 0),
          endDate: e.endDate || "",
          active: e.active ?? true,
          url: e.slug ? `https://polymarket.com/event/${e.slug}` : undefined,
        });
      } else {
        // Multi-market event (time-based deadlines) — pick next 2-3 upcoming
        const futureMarkets = subMarkets
          .map((m) => {
            const prices = parsePrices(m.outcomePrices);
            const yesPrice = prices[0] ? Math.round(parseFloat(prices[0]) * 100) : null;
            // Extract date from question like "US strikes Iran by March 15, 2026?"
            const dateMatch = m.question?.match(/by\s+(.+?)[\?]?$/i);
            const endDate = dateMatch ? dateMatch[1].trim() : "";
            const parsedDate = endDate ? new Date(endDate) : null;
            return { question: m.question || "", yesPrice, endDate, parsedDate, prices };
          })
          .filter((m) => m.parsedDate && m.parsedDate > now && m.yesPrice !== null && m.yesPrice > 0 && m.yesPrice < 100)
          .sort((a, b) => (a.parsedDate!.getTime() - b.parsedDate!.getTime()));

        // Take next 3 upcoming deadlines
        for (const fm of futureMarkets.slice(0, 3)) {
          markets.push({
            id: `${e.slug}-${fm.endDate}`,
            question: fm.question,
            category: e.tags?.[0]?.label || "geopolitics",
            yesPrice: fm.yesPrice,
            noPrice: fm.prices[1] ? Math.round(parseFloat(fm.prices[1]) * 100) : null,
            volume: typeof e.volume === "string" ? parseFloat(e.volume) : (e.volume || 0),
            liquidity: typeof e.liquidity === "string" ? parseFloat(e.liquidity) : (e.liquidity || 0),
            endDate: fm.endDate,
            active: true,
            url: e.slug ? `https://polymarket.com/event/${e.slug}` : undefined,
          });
        }
      }
    }

    const data = { markets, timestamp: new Date().toISOString() };
    await insertMarketSnapshot(env.DB, data as unknown as Record<string, unknown>).catch(() => {});
    return corsResponse(data);
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

const REDDIT_RSS = [
  { url: "https://www.reddit.com/r/geopolitics/search.rss?q=iran+OR+pezeshkian&sort=new&limit=10&restrict_sr=on&t=week", sub: "r/geopolitics" },
  { url: "https://www.reddit.com/r/worldnews/search.rss?q=iran+OR+hormuz&sort=new&limit=10&restrict_sr=on&t=week", sub: "r/worldnews" },
  { url: "https://www.reddit.com/r/CredibleDefense/search.rss?q=iran+OR+gulf&sort=new&limit=8&restrict_sr=on&t=week", sub: "r/CredibleDefense" },
];

function parseAtom(xml: string) {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((e) => ({
    title: (e.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || "").replace(/&amp;/g, "&"),
    url: e.match(/<link[^>]*href="([^"]*)"[^>]*\/>/)?.[1] || "",
    updated: e.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] || "",
  }));
}

export async function redditIntel(_req: Request, _env: Env): Promise<Response> {
  try {
    const posts: { title: string; url: string; sub: string; updated: string }[] = [];
    for (const feed of REDDIT_RSS) {
      try {
        const resp = await fetch(feed.url, { headers: { "User-Agent": "web:MeridianIntel:v1.0" } });
        if (resp.ok) parseAtom(await resp.text()).forEach((e) => posts.push({ ...e, sub: feed.sub }));
      } catch { /* skip */ }
    }
    return corsResponse({ posts: posts.slice(0, 50), total: posts.length });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

export async function intelAgent(_req: Request, _env: Env): Promise<Response> {
  // Stub — frontend mostly uses live-intel directly
  return corsResponse({ status: "ok", message: "intel-agent endpoint active" });
}
