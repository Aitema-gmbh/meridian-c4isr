import { corsError, corsResponse } from "../lib/cors";
import { callClaudeJSON } from "../lib/anthropic";
import { insertIntelSnapshot } from "../lib/db";
import type { Env } from "../lib/anthropic";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Serve latest intel snapshot from D1 when all sources fail */
async function getLatestIntelSnapshot(db: D1Database): Promise<Record<string, unknown> | null> {
  try {
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const row = await db.prepare(
      `SELECT data FROM intel_snapshots WHERE created_at >= ? ORDER BY created_at DESC LIMIT 1`
    ).bind(cutoff).first<{ data: string }>();
    if (row?.data) return JSON.parse(row.data) as Record<string, unknown>;
  } catch { /* ignore */ }
  return null;
}

// ─── Shared types ────────────────────────────────────────────────────────────

interface RawArticle {
  title: string;
  url: string;
  seendate: string;
  domain: string;
  queryTag: string;
  language?: string;
}

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

// ─── URL cleanup helper ─────────────────────────────────────────────────────

/** Clean a URL extracted from XML/RSS: decode &amp; entities and unwrap Bing News redirects */
function cleanUrl(raw: string): string {
  // 1. Decode XML entities
  let url = raw.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // 2. Unwrap Bing News redirect URLs (bing.com/news/apiclick.aspx?...)
  try {
    if (url.includes("bing.com/news/apiclick")) {
      const parsed = new URL(url);
      const realUrl = parsed.searchParams.get("url");
      if (realUrl) {
        url = decodeURIComponent(realUrl);
      }
    }
  } catch { /* malformed URL — return as-is */ }
  return url.trim();
}

// ─── RSS Parser helper ───────────────────────────────────────────────────────

function parseRssItems(xml: string, defaultDomain: string): Array<{ title: string; url: string; seendate: string; domain: string }> {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((item) => {
    const title = (item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const link = cleanUrl(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "");
    const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
    const source = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    return { title: title.trim(), url: link, seendate: pubDate, domain: source || defaultDomain };
  }).filter(a => a.title.length > 15);
}

async function fetchRss(url: string, domain: string, max: number): Promise<Array<{ title: string; url: string; seendate: string; domain: string }>> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": BROWSER_UA } });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const xml = await resp.text();
    return parseRssItems(xml, domain).slice(0, max);
  } catch { return []; }
}

// ─── Source 1: GDELT (global news index — single combined query to avoid rate limit) ─

async function fetchGdelt(): Promise<RawArticle[]> {
  try {
    const query = '(iran OR IRGC OR tehran OR hormuz OR houthi OR hezbollah OR CENTCOM) (military OR nuclear OR sanctions OR strike OR threat OR missile OR drone OR tanker OR "carrier strike")';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    // Only fetch articles from last 48 hours for live intel freshness
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const startdt = cutoff.toISOString().replace(/[-T:]/g, "").slice(0, 14);
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=20&sort=datedesc&startdatetime=${startdt}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const text = await resp.text();
    if (!text.startsWith("{") && !text.startsWith("[")) return [];
    const data = JSON.parse(text) as { articles?: Array<{ title?: string; url?: string; seendate?: string; domain?: string; language?: string }> };
    return (data.articles || []).slice(0, 20).map(a => ({
      title: a.title || "", url: a.url || "", seendate: a.seendate || "",
      domain: a.domain || "gdelt", queryTag: "GDELT", language: a.language,
    })).filter(a => a.title.length > 10);
  } catch { return []; }
}

// ─── Source 2: Google News RSS (multi-language) ──────────────────────────────

async function fetchGoogleNews(query: string, hl: string, tag: string, max: number): Promise<RawArticle[]> {
  const items = await fetchRss(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=US&ceid=US:${hl}`,
    "google-news", max
  );
  return items.map(a => ({ ...a, queryTag: tag, language: hl }));
}

// ─── Source 3: Major News Outlet RSS feeds ───────────────────────────────────

const OUTLET_FEEDS: Array<{ url: string; domain: string; tag: string; lang?: string }> = [
  // English
  { url: "https://www.aljazeera.com/xml/rss/all.xml", domain: "Al Jazeera", tag: "OUTLET_AJ" },
  { url: "http://feeds.bbci.co.uk/news/world/middle_east/rss.xml", domain: "BBC World", tag: "OUTLET_BBC" },
  { url: "https://www.france24.com/en/middle-east/rss", domain: "France 24", tag: "OUTLET_F24" },
  { url: "https://rss.dw.com/xml/rss-en-mid", domain: "Deutsche Welle", tag: "OUTLET_DW" },
  { url: "https://www.timesofisrael.com/feed/", domain: "Times of Israel", tag: "OUTLET_TOI" },
  { url: "https://www.theguardian.com/world/middleeast/rss", domain: "The Guardian", tag: "OUTLET_GUARDIAN" },
  // Farsi / Arabic
  { url: "https://www.presstv.ir/RSS", domain: "PressTV (Iran)", tag: "OUTLET_PRESSTV", lang: "fa" },
  { url: "https://english.alarabiya.net/tools/rss", domain: "Al Arabiya", tag: "OUTLET_ALARABIYA", lang: "ar" },
];

const IRAN_KEYWORDS = [
  "iran", "irgc", "hormuz", "houthi", "tehran", "natanz", "fordow", "nuclear",
  "centcom", "carrier", "missile", "drone", "airstrike", "sanction", "hezbollah",
  "lebanon", "yemen", "red sea", "gulf", "enrichment", "iaea", "proxy", "escalation",
  "persian", "strait", "rouhani", "pezeshkian", "khamenei", "quds", "pasdaran",
  "strike", "military", "navy", "deployment", "tanker", "shipping",
];

function isIranRelevant(title: string): boolean {
  const t = title.toLowerCase();
  return IRAN_KEYWORDS.some(k => t.includes(k));
}

async function fetchOutletFeeds(): Promise<RawArticle[]> {
  const results = await Promise.allSettled(
    OUTLET_FEEDS.map(feed => fetchRss(feed.url, feed.domain, 15))
  );
  const articles: RawArticle[] = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const feed = OUTLET_FEEDS[i];
    for (const item of r.value) {
      if (isIranRelevant(item.title)) {
        articles.push({ ...item, queryTag: feed.tag, language: feed.lang || "en" });
      }
    }
  });
  return articles;
}

// ─── Source 4: Reddit (Atom format, requires specific UA) ────────────────────

const REDDIT_FEEDS = [
  { url: "https://www.reddit.com/r/geopolitics/search.rss?q=iran+OR+pezeshkian+OR+hormuz+OR+IRGC&sort=new&limit=15&restrict_sr=on&t=week", sub: "r/geopolitics", tag: "REDDIT_GEO" },
  { url: "https://www.reddit.com/r/worldnews/search.rss?q=iran+OR+hormuz+OR+persian+gulf+OR+IRGC&sort=new&limit=15&restrict_sr=on&t=week", sub: "r/worldnews", tag: "REDDIT_WORLD" },
  { url: "https://www.reddit.com/r/CredibleDefense/search.rss?q=iran+OR+gulf+OR+CENTCOM&sort=new&limit=10&restrict_sr=on&t=week", sub: "r/CredibleDefense", tag: "REDDIT_CREDDEF" },
  { url: "https://www.reddit.com/r/iran/.rss?limit=15", sub: "r/iran", tag: "REDDIT_IRAN" },
];

/** Reddit returns Atom XML (not RSS) — parse <entry> tags */
function parseAtomEntries(xml: string): Array<{ title: string; url: string; seendate: string }> {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map(entry => ({
    title: (entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim(),
    url: cleanUrl(entry.match(/<link\s+href="([^"]+)"/)?.[1] || ""),
    seendate: entry.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] || "",
  })).filter(e => e.title.length > 10);
}

async function fetchRedditFeeds(): Promise<RawArticle[]> {
  const articles: RawArticle[] = [];
  // Sequential to avoid Reddit rate-limiting, with Reddit-required UA format
  for (const feed of REDDIT_FEEDS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(feed.url, {
        signal: controller.signal,
        headers: { "User-Agent": "web:MeridianIntel:v1.0" },
      });
      clearTimeout(timeout);
      if (!resp.ok) continue;
      const entries = parseAtomEntries(await resp.text());
      for (const entry of entries) {
        if (isIranRelevant(entry.title)) {
          articles.push({
            title: entry.title, url: entry.url, seendate: entry.seendate,
            domain: feed.sub, queryTag: feed.tag, language: "en",
          });
        }
      }
    } catch { /* skip */ }
  }
  return articles;
}

// ─── Source 5: Bing News RSS (as additional source, not just fallback) ───────

async function fetchBingNews(query: string, tag: string, max: number): Promise<RawArticle[]> {
  const items = await fetchRss(
    `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`,
    "bing-news", max
  );
  return items.map(a => ({ ...a, queryTag: tag }));
}

// ─── Deduplication by title similarity ───────────────────────────────────────

function deduplicateArticles(articles: RawArticle[]): RawArticle[] {
  const seen: string[] = [];
  return articles.filter(a => {
    const normalized = a.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    if (normalized.length < 15) return false;
    // Check if too similar to existing
    for (const s of seen) {
      const words1 = new Set(normalized.split(/\s+/).filter(w => w.length > 3));
      const words2 = new Set(s.split(/\s+/).filter(w => w.length > 3));
      const intersection = [...words1].filter(w => words2.has(w)).length;
      const union = new Set([...words1, ...words2]).size;
      if (union > 0 && intersection / union > 0.5) return false; // >50% overlap → duplicate
    }
    seen.push(normalized);
    return true;
  });
}

// ─── Main Live Intel handler ─────────────────────────────────────────────────

export async function liveIntel(_req: Request, env: Env): Promise<Response> {
  try {
    // Fetch all sources in parallel (GDELT single query, Reddit sequential inside its function)
    const [
      gdeltResult,
      googleEN, googleAR, googleFA,
      outletsResult,
      redditResult,
      bingEN, bingME, bingMilitary,
      adsbResp,
    ] = await Promise.allSettled([
      fetchGdelt(),
      fetchGoogleNews("iran nuclear military IRGC crisis", "en", "GOOGLE_EN", 8),
      fetchGoogleNews("إيران عسكري نووي هجوم", "ar", "GOOGLE_AR", 5),
      fetchGoogleNews("ایران نظامی هسته‌ای سپاه", "fa", "GOOGLE_FA", 5),
      fetchOutletFeeds(),
      fetchRedditFeeds(),
      fetchBingNews("iran nuclear IRGC military crisis 2026", "BING_EN", 8),
      fetchBingNews("iran strait hormuz houthi hezbollah", "BING_ME", 6),
      fetchBingNews("CENTCOM iran strike carrier deployment", "BING_MIL", 5),
      fetch("https://api.adsb.lol/v2/mil"),
    ]);

    // Collect all articles
    const allArticles: RawArticle[] = [];
    const pushFulfilled = (r: PromiseSettledResult<RawArticle[]>) => {
      if (r.status === "fulfilled") allArticles.push(...r.value);
    };
    pushFulfilled(gdeltResult);
    [googleEN, googleAR, googleFA].forEach(pushFulfilled);
    pushFulfilled(outletsResult);
    pushFulfilled(redditResult);
    [bingEN, bingME, bingMilitary].forEach(pushFulfilled);

    // Deduplicate
    const unique = deduplicateArticles(allArticles);

    // Count source types for metadata
    const sourceCounts: Record<string, number> = {};
    for (const a of unique) {
      const sourceType = a.queryTag.split("_")[0];
      sourceCounts[sourceType] = (sourceCounts[sourceType] || 0) + 1;
    }

    // Military tracks
    let milTrackCount = 0;
    if (adsbResp.status === "fulfilled" && adsbResp.value.ok) {
      try {
        const adsbData = await adsbResp.value.json() as { ac?: Array<{ lat?: number; lon?: number }> };
        milTrackCount = (adsbData.ac || []).filter(
          (a) => a.lat != null && a.lon != null && a.lat >= 20 && a.lat <= 35 && a.lon >= 44 && a.lon <= 65
        ).length;
      } catch { /* ignore */ }
    }

    if (unique.length === 0) {
      const cached = await getLatestIntelSnapshot(env.DB);
      if (cached && (cached.items as unknown[] || []).length > 0) {
        return corsResponse({ ...cached, metadata: { ...(cached.metadata as Record<string, unknown> || {}), fromCache: true, milTrackCount } });
      }
      return corsResponse({
        items: [], flashReport: null,
        metadata: { articleCount: 0, milTrackCount, timestamp: new Date().toISOString(), dominantCategory: "NONE", sourceCounts },
      });
    }

    // Limit to 40 best articles for AI analysis (budget-friendly)
    const topArticles = unique.slice(0, 40);

    const articleSummaries = topArticles
      .map((a, i) => `[${i + 1}] [${a.queryTag}] "${a.title}" (${a.domain}, ${a.seendate || "recent"}) URL: ${a.url || "N/A"}`)
      .join("\n");

    const analyzed = await callClaudeJSON<IntelOutput>(env.CLIPROXY_BASE_URL, {
      model: "gemini-2.5-flash",
      max_tokens: 8192,
      system: `You are a senior intelligence analyst producing a LIVE INTELLIGENCE FEED for the IRAN/US CRISIS (Feb 2026).

SOURCES: ${Object.keys(sourceCounts).length} source types: ${Object.entries(sourceCounts).map(([k, v]) => `${k}(${v})`).join(", ")}.

SITUATION: 2 US CSGs in Gulf. Trump ultimatum on Iran nuclear program. IRGC exercises near Hormuz. Houthi disrupting Red Sea. PMF attacking US bases. Oil $90+. Iran enriching 60%+ at Fordow.

RELEVANCE FILTER — INCLUDE:
- Military movements (naval, air, ground deployments, exercises)
- Nuclear program developments (enrichment, IAEA, negotiations)
- Maritime incidents (tanker seizures, naval confrontations, shipping disruptions)
- Cyber operations (state-sponsored attacks, infrastructure targeting)
- Diplomatic signals (negotiations, ultimatums, sanctions, back-channels)
- Proxy actions (Hezbollah, Houthis, PMF, Palestinian groups)
- Economic warfare (sanctions, oil embargoes, SWIFT, trade restrictions)
- Regional military (Israel, Saudi, UAE posture changes)

REJECT: Domestic politics unrelated to crisis, sports, entertainment, weather, generic Middle East coverage without crisis nexus.

PRIORITY CLASSIFICATION:
HIGH: Direct military action, weapons test, diplomatic breakdown, major incident, imminent threat
MEDIUM: Exercises, posturing, diplomatic meetings, sanctions updates, proxy skirmishes
LOW: Analysis pieces, historical context, economic ripple effects

FLASH REPORT: 3 sentences. Lead with the single most significant development. Include specific actors, locations, and timeframes. This is what decision-makers read first.

For non-English articles: translate title and key content to English. Preserve original source.
You MUST respond using the output_intel_items tool.`,
      messages: [{
        role: "user",
        content: `Analyze these ${topArticles.length} articles from ${Object.keys(sourceCounts).length} OSINT source types and produce intel briefs:\n\n${articleSummaries}\n\nFor each article: classify priority, assign threat_tag, set confidence, extract entities, score sentiment, write tactical summary, preserve sourceUrl.`,
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
        articleCount: unique.length,
        rawArticleCount: allArticles.length,
        milTrackCount,
        averageSentiment: analyzed.averageSentiment ?? -0.5,
        timestamp: new Date().toISOString(),
        dominantCategory: analyzed.dominantCategory || "MILITARY",
        sourceCounts,
      },
    };
    await insertIntelSnapshot(env.DB, responseData as unknown as Record<string, unknown>).catch(() => {});
    return corsResponse(responseData);
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown error");
  }
}
