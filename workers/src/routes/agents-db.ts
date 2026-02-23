/**
 * Alle DB-schreibenden Agenten (osint, naval, pentagon, cyber, markets, reddit, wiki, macro, fires, pizza, ais, acled, telegram)
 */
import { corsError, corsResponse } from "../lib/cors";
import { callClaudeJSON } from "../lib/anthropic";
import { insertAgentReport, getLatestAgentReport, getStaleReport } from "../lib/db";
import type { Env } from "../lib/anthropic";

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function fetchGdelt(query: string, max: number): Promise<unknown[]> {
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=${max}&sort=datedesc`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error("GDELT not ok");
    const text = await resp.text();
    if (!text.startsWith("{") && !text.startsWith("[")) throw new Error("GDELT bad response");
    const articles = (JSON.parse(text) as { articles?: unknown[] }).articles?.slice(0, max) || [];
    if (articles.length > 0) return articles;
    throw new Error("GDELT empty");
  } catch {
    // Auto-fallback to Bing News RSS when GDELT is down
    // Strip GDELT syntax to make a simple keyword query
    const simpleQuery = query
      .replace(/\(|\)/g, "")
      .replace(/\bAND\b/gi, " ")
      .replace(/\bOR\b/gi, " ")
      .replace(/"/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 6) // Take first 6 keywords to keep query manageable
      .join(" ");
    return fetchBingNewsRss(simpleQuery, max);
  }
}

/** Bing News RSS — reliable alternative when GDELT is down */
async function fetchBingNewsRss(query: string, max: number): Promise<unknown[]> {
  try {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    return items.slice(0, max).map((item) => {
      const title = (item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
      const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
      const source = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
      return { title, url: link, seendate: pubDate, domain: source || "bing-news", source: "bing-news-rss" };
    });
  } catch { return []; }
}

/** Google News RSS fallback */
async function fetchGoogleNewsRss(query: string, max: number): Promise<unknown[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en&gl=US&ceid=US:en`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "MeridianIntel/1.0" } });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const xml = await resp.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    return items.slice(0, max).map((item) => {
      const title = (item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
      const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
      const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
      const source = (item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
      return { title, url: link, seendate: pubDate, domain: source, source: "google-news-rss" };
    });
  } catch { return []; }
}

/** Fetch with GDELT primary, Bing News + Google News RSS fallback */
async function fetchWithFallback(gdeltQuery: string, rssQuery: string, max: number): Promise<{ articles: unknown[]; source: string }> {
  const gdeltArticles = await fetchGdelt(gdeltQuery, max);
  if (gdeltArticles.length > 0) return { articles: gdeltArticles, source: "GDELT" };
  // Bing News RSS as primary fallback (most reliable from CF Workers)
  const bingArticles = await fetchBingNewsRss(rssQuery, max);
  if (bingArticles.length > 0) return { articles: bingArticles, source: "Bing News RSS" };
  // Google News RSS as secondary fallback
  const rssArticles = await fetchGoogleNewsRss(rssQuery, max);
  return { articles: rssArticles, source: rssArticles.length > 0 ? "Google News RSS" : "none" };
}

/**
 * When all external sources fail, skip writing a 0-report and return the last good one.
 * Agents call this before writing an empty report.
 */
async function serveStaleOrEmpty(db: D1Database, agentName: string, emptyData: Record<string, unknown>, summary: string): Promise<Response> {
  const stale = await getStaleReport(db, agentName, 12);
  if (stale) {
    // Don't overwrite good data — just return success with stale flag
    return corsResponse({ success: true, stale: true, lastGoodReport: stale.created_at, ...(stale.data as Record<string, unknown>) });
  }
  // No stale data available — write the empty report
  await insertAgentReport(db, {
    agent_name: agentName, report_type: "cycle", data: emptyData,
    summary, threat_level: 0, confidence: "LOW", items_count: 0,
  });
  return corsResponse({ success: true, items: 0, dataSource: "none" });
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── agent-osint ─────────────────────────────────────────────────────────────

const OSINT_STREAMS = [
  { query: '(iran OR hormuz OR "persian gulf" OR IRGC OR houthi OR pezeshkian OR larijani)', tag: "IRAN_GULF", max: 15 },
  { query: '("US military" OR CENTCOM OR deployment OR "5th fleet" OR "Abraham Lincoln" OR "carrier strike" OR "B-2")', tag: "US_MILITARY", max: 12 },
  { query: '("nuclear" OR "uranium enrichment" OR IAEA OR Fordow OR Natanz) AND iran', tag: "NUCLEAR", max: 8 },
  { query: '(Pezeshkian OR Larijani OR "nuclear talks" OR "Midnight Hammer") AND (iran OR US)', tag: "CRISIS_2026", max: 10 },
  { query: '(iran OR hormuz OR "persian gulf" OR IRGC OR houthi) sourcelang:ara', tag: "ARABIC_OSINT", max: 10 },
  { query: '(iran OR hormuz OR sepah OR artesh OR basij) sourcelang:fas', tag: "FARSI_OSINT", max: 10 },
];

const OSINT_RSS_FALLBACKS = [
  { query: "iran nuclear negotiations hormuz IRGC", tag: "IRAN_GULF" },
  { query: "US military CENTCOM deployment carrier strike", tag: "US_MILITARY" },
  { query: "iran uranium enrichment IAEA Fordow Natanz", tag: "NUCLEAR" },
  { query: "iran US crisis talks sanctions 2026", tag: "CRISIS_2026" },
  { query: "iran hormuz IRGC houthi arabic news", tag: "ARABIC_OSINT" },
  { query: "iran sepah pasdaran artesh farsi news", tag: "FARSI_OSINT" },
];

export async function agentOsint(_req: Request, env: Env): Promise<Response> {
  try {
    // Try GDELT first
    const gdeltResults = await Promise.all(OSINT_STREAMS.map((s) => fetchGdelt(s.query, s.max)));
    const seen = new Set<string>();
    // Map stream tag → language for Farsi/Arabic sources
    const STREAM_LANG: Record<string, string> = { "ARABIC_OSINT": "ar", "FARSI_OSINT": "fa" };
    let articles: unknown[] = [];
    gdeltResults.forEach((streamArticles, i) => {
      const tag = OSINT_STREAMS[i].tag;
      const lang = STREAM_LANG[tag];
      for (const a of streamArticles) {
        const article = a as { url?: string; language?: string };
        if (!article.url || seen.has(article.url)) continue;
        seen.add(article.url);
        if (lang) (a as Record<string, unknown>).language = lang;
        articles.push(a);
      }
    });
    let dataSource = "GDELT";

    // Fallback to Bing/Google News RSS if GDELT returns nothing
    if (articles.length === 0) {
      const bingResults = await Promise.all(OSINT_RSS_FALLBACKS.map((s) => fetchBingNewsRss(s.query, 10)));
      bingResults.forEach((streamArticles, i) => {
        const tag = OSINT_RSS_FALLBACKS[i].tag;
        const lang = STREAM_LANG[tag];
        for (const a of streamArticles) {
          const article = a as { url?: string };
          if (!article.url || seen.has(article.url)) continue;
          seen.add(article.url);
          if (lang) (a as Record<string, unknown>).language = lang;
          articles.push(a);
        }
      });
      dataSource = articles.length > 0 ? "Bing News RSS" : "none";
      // If Bing also fails, try Google News RSS
      if (articles.length === 0) {
        const rssResults = await Promise.all(OSINT_RSS_FALLBACKS.map((s) => fetchGoogleNewsRss(s.query, 10)));
        rssResults.forEach((streamArticles, i) => {
          const tag = OSINT_RSS_FALLBACKS[i].tag;
          const lang = STREAM_LANG[tag];
          for (const a of streamArticles) {
            const article = a as { url?: string };
            if (!article.url || seen.has(article.url)) continue;
            seen.add(article.url);
            if (lang) (a as Record<string, unknown>).language = lang;
            articles.push(a);
          }
        });
        dataSource = articles.length > 0 ? "Google News RSS" : "none";
      }
    }

    if (articles.length === 0) {
      return serveStaleOrEmpty(env.DB, "osint", { articles: [], streamCounts: {}, dataSource }, "No OSINT articles found (GDELT + RSS fallback, sources down).");
    }

    // Try AI analysis, fall back to heuristic if AI quota exhausted
    try {
      interface OsintOutput { dominantCategory: string; sentimentScore: number; items: unknown[]; threatLevel: number; summary: string; }
      const analyzed = await callClaudeJSON<OsintOutput>(env.CLIPROXY_BASE_URL, {
        model: "gemini-2.5-flash", max_tokens: 4096,
        system: "You are an OSINT analyst. Analyze geopolitical news about the Iran/US crisis. Extract key intelligence signals. ALWAYS call output_osint_report.",
        messages: [{ role: "user", content: `Analyze these OSINT articles: ${JSON.stringify(articles.slice(0, 15))}` }],
        tools: [{ name: "output_osint_report", description: "Output OSINT analysis", parameters: {
          type: "object", properties: {
            dominantCategory: { type: "string", enum: ["MARITIME", "CYBER", "DIPLOMATIC", "MILITARY", "ECONOMIC", "NUCLEAR"] },
            sentimentScore: { type: "number" }, items: { type: "array", items: { type: "object" } },
            threatLevel: { type: "number" }, summary: { type: "string" },
          }, required: ["dominantCategory", "sentimentScore", "items", "threatLevel", "summary"],
        }}],
        tool_choice: { type: "function", function: { name: "output_osint_report" } },
      });
      await insertAgentReport(env.DB, {
        agent_name: "osint", report_type: "cycle",
        data: { ...analyzed, articles: articles.slice(0, 30), dataSource },
        summary: analyzed.summary, threat_level: analyzed.threatLevel,
        confidence: articles.length > 20 ? "HIGH" : "MEDIUM", items_count: articles.length,
      });
      return corsResponse({ success: true, articlesFound: articles.length, threatLevel: analyzed.threatLevel, dataSource });
    } catch {
      // AI unavailable — heuristic scoring
      const crisisKw = ["strike", "attack", "missile", "nuclear", "enrichment", "sanction", "deploy", "carrier", "escalat", "war", "threat", "houthi", "irgc"];
      const titles = articles.map((a: unknown) => ((a as { title?: string }).title || "").toLowerCase());
      const crisisHits = titles.filter((t) => crisisKw.some((kw) => t.includes(kw))).length;
      const threatLevel = Math.min(80, Math.round((crisisHits / Math.max(1, articles.length)) * 100));
      const summary = `OSINT: ${articles.length} articles via ${dataSource} (AI unavailable, heuristic scoring). ${crisisHits} crisis-keyword matches. Threat: ${threatLevel}/100.`;
      await insertAgentReport(env.DB, {
        agent_name: "osint", report_type: "cycle",
        data: { articles: articles.slice(0, 30), crisisHits, dataSource, aiUnavailable: true },
        summary, threat_level: threatLevel, confidence: articles.length > 15 ? "MEDIUM" : "LOW", items_count: articles.length,
      });
      return corsResponse({ success: true, articlesFound: articles.length, threatLevel, dataSource, aiUnavailable: true });
    }
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-naval ─────────────────────────────────────────────────────────────

const MARITIME_PATROL_TYPES = ["P8", "P-8", "MQ9", "MQ-9", "MH60", "MH-60", "SH60", "SH-60", "EP3", "EP-3"];
const NAVAL_GDELT_QUERIES = [
  { query: '("persian gulf" OR hormuz OR "strait of hormuz") AND (navy OR naval OR warship OR carrier OR destroyer)', tag: "GULF_NAVAL", max: 10 },
  { query: '("red sea" OR "bab el-mandeb" OR houthi) AND (navy OR warship OR destroyer OR frigate)', tag: "RED_SEA", max: 8 },
  { query: '(CENTCOM OR "5th fleet" OR "carrier strike") AND (deploy OR patrol OR transit)', tag: "US_NAVAL", max: 8 },
];

function inNavalAOR(lat: number, lon: number): string | null {
  if (lat >= 23 && lat <= 32 && lon >= 47 && lon <= 60) return "Persian Gulf";
  if (lat >= 11 && lat <= 20 && lon >= 38 && lon <= 45) return "Red Sea";
  if (lat >= 15 && lat <= 26 && lon >= 55 && lon <= 68) return "Arabian Sea";
  return null;
}

const NAVAL_RSS_QUERIES = [
  "persian gulf navy warship carrier destroyer hormuz",
  "red sea houthi navy warship attack vessel",
  "CENTCOM carrier strike group deploy patrol",
];

export async function agentNaval(_req: Request, env: Env): Promise<Response> {
  try {
    // 1. Fetch maritime patrol aircraft from ADS-B
    const adsbResp = await fetch("https://api.adsb.lol/v2/mil").catch(() => null);

    let patrolAircraft: { callsign: string; type: string; region: string; lat: number; lon: number; alt: number }[] = [];
    if (adsbResp?.ok) {
      try {
        const data = await adsbResp.json() as { ac?: Array<{ lat?: number; lon?: number; t?: string; flight?: string; alt_baro?: number; desc?: string }> };
        patrolAircraft = (data.ac || [])
          .filter((ac) => {
            if (ac.lat == null || ac.lon == null) return false;
            if (!inNavalAOR(ac.lat!, ac.lon!)) return false;
            const t = ((ac.t || "") + " " + (ac.desc || "")).toUpperCase();
            return MARITIME_PATROL_TYPES.some((k) => t.includes(k));
          })
          .map((ac) => ({
            callsign: (ac.flight || "").trim(), type: ac.t || "UNKNOWN",
            region: inNavalAOR(ac.lat!, ac.lon!) || "", lat: ac.lat!, lon: ac.lon!, alt: ac.alt_baro || 0,
          }));
      } catch { /* ignore */ }
    }

    // 2. GDELT + RSS fallback for naval OSINT
    const gdeltArticles = (await Promise.all(NAVAL_GDELT_QUERIES.map((q) => fetchGdelt(q.query, q.max)))).flat();
    let navalArticles = gdeltArticles;
    let dataSource = "GDELT";
    if (navalArticles.length === 0) {
      navalArticles = (await Promise.all(NAVAL_RSS_QUERIES.map((q) => fetchGoogleNewsRss(q, 8)))).flat();
      dataSource = navalArticles.length > 0 ? "Google News RSS" : "none";
    }

    // 3. Calculate maritime anomaly index
    const patrolRatio = patrolAircraft.length / 2;
    const articleIntensity = Math.min(30, navalArticles.length * 2);
    const patrolScore = patrolRatio > 3 ? 40 : patrolRatio > 2 ? 30 : patrolRatio > 1 ? 15 : patrolAircraft.length > 0 ? 5 : 0;
    const maritimeAnomalyIndex = Math.min(100, patrolScore + articleIntensity);

    const patrolRegions: Record<string, number> = {};
    patrolAircraft.forEach((a) => { patrolRegions[a.region] = (patrolRegions[a.region] || 0) + 1; });

    const summary = `Maritime Anomaly Index: ${maritimeAnomalyIndex}/100. ${patrolAircraft.length} patrol aircraft (${Object.entries(patrolRegions).map(([r, c]) => `${r}: ${c}`).join(", ") || "none in AOR"}). ${navalArticles.length} articles via ${dataSource}.`;

    await insertAgentReport(env.DB, {
      agent_name: "naval", report_type: "cycle",
      data: { maritimeAnomalyIndex, patrolAircraft, patrolRegions, navalArticleCount: navalArticles.length, dataSource, articles: navalArticles.slice(0, 15) },
      summary, threat_level: maritimeAnomalyIndex,
      confidence: patrolAircraft.length > 0 || navalArticles.length > 5 ? "HIGH" : "MEDIUM",
      items_count: patrolAircraft.length + navalArticles.length,
    });

    return corsResponse({ success: true, maritimeAnomalyIndex, patrolAircraft: patrolAircraft.length, navalArticles: navalArticles.length, dataSource });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-reddit ─────────────────────────────────────────────────────────────

const REDDIT_FEEDS = [
  { url: "https://www.reddit.com/r/geopolitics/search.rss?q=iran+OR+pezeshkian+OR+larijani&sort=new&limit=10&restrict_sr=on&t=week", sub: "r/geopolitics" },
  { url: "https://www.reddit.com/r/worldnews/search.rss?q=iran+OR+hormuz+OR+persian+gulf&sort=new&limit=10&restrict_sr=on&t=week", sub: "r/worldnews" },
  { url: "https://www.reddit.com/r/CredibleDefense/search.rss?q=iran+OR+gulf+OR+CENTCOM&sort=new&limit=8&restrict_sr=on&t=week", sub: "r/CredibleDefense" },
  { url: "https://www.reddit.com/r/iran/.rss?limit=10", sub: "r/iran" },
];

function parseAtomEntries(xml: string): { title: string; url: string; updated: string }[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map((entry) => ({
    title: (entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
    url: entry.match(/<link[^>]*href="([^"]*)"[^>]*\/>/)?.[1] || "",
    updated: entry.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] || "",
  }));
}

export async function agentReddit(_req: Request, env: Env): Promise<Response> {
  try {
    const posts: { title: string; url: string; sub: string; updated: string }[] = [];
    for (const feed of REDDIT_FEEDS) {
      try {
        const resp = await fetch(feed.url, { headers: { "User-Agent": "web:MeridianIntel:v1.0" } });
        if (resp.ok) parseAtomEntries(await resp.text()).forEach((e) => posts.push({ ...e, sub: feed.sub }));
      } catch { /* skip */ }
    }

    const overallSignalStrength = posts.length > 30 ? "HIGH" : posts.length > 15 ? "MEDIUM" : "LOW";
    await insertAgentReport(env.DB, {
      agent_name: "reddit", report_type: "cycle",
      data: { items: posts, overallSignalStrength },
      summary: `${posts.length} Reddit signals. Strength: ${overallSignalStrength}.`,
      threat_level: posts.length > 30 ? 70 : 40, confidence: "MEDIUM", items_count: posts.length,
    });

    return corsResponse({ success: true, postsFound: posts.length, signalStrength: overallSignalStrength });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-pentagon ───────────────────────────────────────────────────────────

const PENTAGON_RSS = [
  "https://www.defense.gov/DesktopModules/ArticleCS/RSS.aspx?ContentType=1&Site=945",
  "https://www.defense.gov/DesktopModules/ArticleCS/RSS.aspx?ContentType=400&Site=945",
];
const IRAN_KW = ["iran", "irgc", "hormuz", "centcom", "houthi", "gulf", "5th fleet", "nuclear", "carrier", "bomber", "midnight hammer", "fordow", "natanz", "sepah", "hormoz", "khaleej", "mushak", "pasdaran", "artesh", "basij"];

function parseRssItems(xml: string): { title: string; link: string; pubDate: string; description: string }[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((item) => ({
    title: item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/)?.[1] || item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "",
    link: item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "",
    pubDate: item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "",
    description: item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1] || "",
  }));
}

export async function agentPentagon(_req: Request, env: Env): Promise<Response> {
  try {
    const allItems: { title: string; link: string; pubDate: string; description: string }[] = [];
    for (const url of PENTAGON_RSS) {
      try {
        const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (resp.ok) allItems.push(...parseRssItems(await resp.text()));
      } catch { /* skip */ }
    }

    // Fallback: Bing News RSS for defense/military news if defense.gov blocked
    if (allItems.length === 0) {
      const bingQueries = [
        "Pentagon Iran CENTCOM military",
        "US military Middle East Gulf deployment",
      ];
      for (const q of bingQueries) {
        const bingItems = await fetchBingNewsRss(q, 15);
        for (const b of bingItems as any[]) {
          allItems.push({ title: b.title || "", link: b.url || "", pubDate: b.seendate || "", description: "" });
        }
      }
    }

    const relevant = allItems.filter((i) => IRAN_KW.some((kw) => (i.title + " " + i.description).toLowerCase().includes(kw)));
    const activityIndex = Math.min(100, relevant.length * 15);
    const nighttimeFlag = new Date().getUTCHours() >= 0 && new Date().getUTCHours() <= 5;

    await insertAgentReport(env.DB, {
      agent_name: "pentagon", report_type: "cycle",
      data: { activityIndex, nighttimeFlag, relevantItems: relevant.slice(0, 20), contractAnomalies: [] },
      summary: `Pentagon Activity Index: ${activityIndex}/100. ${relevant.length} Iran-related items. Nighttime flag: ${nighttimeFlag}.`,
      threat_level: activityIndex, confidence: "HIGH", items_count: relevant.length,
    });

    return corsResponse({ success: true, activityIndex, relevantItems: relevant.length });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-cyber ─────────────────────────────────────────────────────────────

const CYBER_QUERIES = [
  { query: '("cyber attack" OR APT OR ransomware OR "critical infrastructure") AND (iran OR gulf OR "middle east")', tag: "CYBER_GENERAL", max: 12 },
  { query: '("APT33" OR "APT34" OR "APT35" OR "Charming Kitten" OR "MuddyWater" OR "OilRig")', tag: "IRAN_APT", max: 10 },
];

const CYBER_RSS_QUERIES = [
  "cyber attack iran critical infrastructure APT ransomware",
  "APT33 APT34 Charming Kitten MuddyWater OilRig cyber iran",
];

export async function agentCyber(_req: Request, env: Env): Promise<Response> {
  try {
    let articles = (await Promise.all(CYBER_QUERIES.map((q) => fetchGdelt(q.query, q.max)))).flat();
    let dataSource = "GDELT";
    if (articles.length === 0) {
      articles = (await Promise.all(CYBER_RSS_QUERIES.map((q) => fetchGoogleNewsRss(q, 10)))).flat();
      dataSource = articles.length > 0 ? "Google News RSS" : "none";
    }

    const activeAPTs: string[] = [];
    const aptNames = ["APT33", "APT34", "APT35", "Charming Kitten", "MuddyWater", "OilRig", "Peach Sandstorm"];
    articles.forEach((a: unknown) => {
      const t = ((a as { title?: string }).title || "").toLowerCase();
      aptNames.forEach((apt) => { if (t.includes(apt.toLowerCase()) && !activeAPTs.includes(apt)) activeAPTs.push(apt); });
    });

    const cyberThreatLevel = Math.min(100, articles.length * 5 + activeAPTs.length * 15);
    await insertAgentReport(env.DB, {
      agent_name: "cyber", report_type: "cycle",
      data: { cyberThreatLevel, activeAPTs, dataSource, articles: articles.slice(0, 20) },
      summary: `Cyber Threat Level: ${cyberThreatLevel}/100. Active APTs: ${activeAPTs.join(", ") || "none"}. Source: ${dataSource}.`,
      threat_level: cyberThreatLevel, confidence: "MEDIUM", items_count: articles.length,
    });

    return corsResponse({ success: true, cyberThreatLevel, activeAPTs, dataSource });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-markets ────────────────────────────────────────────────────────────

const IRAN_SLUGS = [
  "will-the-iranian-regime-fall-by-the-end-of-2026",
  "will-the-us-invade-iran-by-march-31",
  "iran-strike-on-us-military-by-march-31",
  "us-iran-war-2026",
  "strait-of-hormuz-closure-2026",
  "iran-regime-change-2026",
];

export async function agentMarkets(_req: Request, env: Env): Promise<Response> {
  try {
    const markets: unknown[] = [];
    for (const slug of IRAN_SLUGS) {
      try {
        const resp = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}&active=true&closed=false`);
        if (resp.ok) markets.push(...(await resp.json() as unknown[]));
      } catch { /* skip */ }
    }

    await insertAgentReport(env.DB, {
      agent_name: "markets", report_type: "cycle",
      data: { markets: markets.slice(0, 30), significantMoves: [] },
      summary: `${markets.length} prediction markets found for Iran/US crisis.`,
      threat_level: 50, confidence: "MEDIUM", items_count: markets.length,
    });

    return corsResponse({ success: true, marketsFound: markets.length });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-wiki ────────────────────────────────────────────────────────────

const WIKI_ARTICLES = [
  "Iran", "Islamic_Revolutionary_Guard_Corps", "Strait_of_Hormuz", "Persian_Gulf",
  "Nuclear_program_of_Iran", "Masoud_Pezeshkian", "Ali_Larijani", "Operation_Praying_Mantis",
  "United_States_Fifth_Fleet", "Fordow_Fuel_Enrichment_Plant", "Natanz",
];

export async function agentWiki(_req: Request, env: Env): Promise<Response> {
  try {
    const spikes: { article: string; views: number; ratio: number; zScore: number }[] = [];
    const BASELINE: Record<string, number> = {
      "Iran": 8000, "Islamic_Revolutionary_Guard_Corps": 1500, "Strait_of_Hormuz": 400,
      "Persian_Gulf": 600, "Nuclear_program_of_Iran": 800, "Masoud_Pezeshkian": 300,
      "Ali_Larijani": 150, "Operation_Praying_Mantis": 200, "United_States_Fifth_Fleet": 250,
      "Fordow_Fuel_Enrichment_Plant": 200, "Natanz": 300,
    };
    for (const article of WIKI_ARTICLES) {
      try {
        const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10).replace(/-/g, "") + "00";
        const resp = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${article}/daily/${twoDaysAgo}/${twoDaysAgo}`, {
          headers: { "User-Agent": "MeridianC4ISR/1.0 (OSINT dashboard)" },
        });
        if (resp.ok) {
          const data = await resp.json() as { items?: Array<{ views: number }> };
          const views = data.items?.[0]?.views || 0;
          const base = BASELINE[article] || 300;
          const ratio = views / base;
          const zScore = (views - base) / (base * 0.3);
          // Count as spike if views are 1.5x baseline or z-score > 2
          if (ratio > 1.5 || zScore > 2) spikes.push({ article, views, ratio: Math.round(ratio * 100) / 100, zScore: Math.round(zScore * 10) / 10 });
        }
      } catch { /* skip */ }
    }

    const wikiCrisisIndex = Math.min(100, Math.round(spikes.reduce((sum, s) => sum + Math.min(25, s.zScore * 5), 0)));
    await insertAgentReport(env.DB, {
      agent_name: "wiki", report_type: "cycle",
      data: { topSpikes: spikes, wikiCrisisIndex },
      summary: `Wiki Crisis Index: ${wikiCrisisIndex}/100. ${spikes.length} article spikes detected.`,
      threat_level: wikiCrisisIndex, confidence: "LOW", items_count: spikes.length,
    });

    return corsResponse({ success: true, wikiCrisisIndex, spikes: spikes.length });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-macro ─────────────────────────────────────────────────────────────

export async function agentMacro(_req: Request, env: Env): Promise<Response> {
  try {
    const [oilArticles, goldArticles, sanctionArticles] = await Promise.allSettled([
      fetchGdelt('("oil price" OR "crude oil" OR "brent crude" OR OPEC) AND (iran OR gulf OR "middle east" OR hormuz)', 10),
      fetchGdelt('("gold price" OR "safe haven" OR "risk off" OR "treasury") AND (iran OR "middle east" OR crisis)', 8),
      fetchGdelt('(sanctions OR embargo OR "trade war") AND (iran OR "persian gulf")', 6),
    ]);

    const oil = oilArticles.status === "fulfilled" ? oilArticles.value : [];
    const gold = goldArticles.status === "fulfilled" ? goldArticles.value : [];
    const sanctions = sanctionArticles.status === "fulfilled" ? sanctionArticles.value : [];
    const totalArticles = oil.length + gold.length + sanctions.length;

    const oilScore = Math.min(40, oil.length * 4);
    const safeHavenScore = Math.min(30, gold.length * 4);
    const sanctionScore = Math.min(30, sanctions.length * 5);
    const macroRiskIndex = Math.min(100, oilScore + safeHavenScore + sanctionScore);

    await insertAgentReport(env.DB, {
      agent_name: "macro", report_type: "cycle",
      data: { macroRiskIndex, oilScore, safeHavenScore, sanctionScore, oilArticles: oil.length, goldArticles: gold.length, sanctionArticles: sanctions.length, articles: [...oil, ...gold, ...sanctions].slice(0, 15) },
      summary: `Macro Risk Index: ${macroRiskIndex}/100. Oil: ${oil.length} articles, Safe-haven: ${gold.length}, Sanctions: ${sanctions.length}. Total: ${totalArticles} economic signals.`,
      threat_level: macroRiskIndex, confidence: totalArticles > 10 ? "MEDIUM" : "LOW", items_count: totalArticles,
    });

    return corsResponse({ success: true, macroRiskIndex, oilArticles: oil.length, goldArticles: gold.length, sanctionArticles: sanctions.length });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-fires ─────────────────────────────────────────────────────────────

const STRATEGIC_SITES = [
  { name: "Bandar Abbas Naval Base", lat: 27.18, lon: 56.28 },
  { name: "Bushehr Nuclear Plant", lat: 28.83, lon: 50.89 },
  { name: "Natanz Enrichment", lat: 33.72, lon: 51.73 },
  { name: "Fordow Enrichment Plant", lat: 32.77, lon: 51.56 },
  { name: "Al Udeid Air Base", lat: 25.12, lon: 51.32 },
  { name: "Isfahan Nuclear Complex", lat: 32.65, lon: 51.68 },
  { name: "Kharg Island Oil Terminal", lat: 29.23, lon: 50.32 },
  { name: "Ras Tanura Oil Terminal", lat: 26.64, lon: 50.07 },
];

const FIRE_GDELT_QUERIES = [
  { query: '(explosion OR airstrike OR missile) AND iran', max: 8 },
  { query: '(explosion OR airstrike) AND (iraq OR yemen OR "red sea")', max: 6 },
];

export async function agentFires(_req: Request, env: Env): Promise<Response> {
  try {
    // 1. GDELT: real-time explosion/fire reports near strategic sites
    const gdeltResults = await Promise.allSettled(
      FIRE_GDELT_QUERIES.map((q) => fetchGdelt(q.query, q.max))
    );
    const fireArticles = gdeltResults
      .filter((r): r is PromiseFulfilledResult<unknown[]> => r.status === "fulfilled")
      .flatMap((r) => r.value);

    // Check articles for mentions of strategic sites
    const siteAlerts: { site: string; articleCount: number; articles: string[] }[] = [];
    STRATEGIC_SITES.forEach((site) => {
      const siteKw = site.name.toLowerCase().split(/\s+/);
      const matching = fireArticles.filter((a: unknown) => {
        const art = a as { title?: string };
        const title = (art.title || "").toLowerCase();
        return siteKw.some((kw) => kw.length > 3 && title.includes(kw));
      });
      if (matching.length > 0) {
        siteAlerts.push({
          site: site.name,
          articleCount: matching.length,
          articles: matching.slice(0, 3).map((a) => (a as { title?: string }).title || ""),
        });
      }
    });

    // 2. NASA FIRMS satellite data (if API key available)
    const nearSiteFires: { site: string; distKm: number }[] = [];
    let firmsFireCount = 0;

    if (env.NASA_FIRMS_API_KEY) {
      try {
        // Fetch fires in Middle East region only (more efficient)
        const resp = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_API_KEY}/VIIRS_SNPP_NRT/44,20,65,37/1`);
        if (resp.ok) {
          const text = await resp.text();
          const lines = text.split("\n").slice(1);
          firmsFireCount = lines.length;
          lines.forEach((line) => {
            const parts = line.split(",");
            if (parts.length < 2) return;
            const lat = parseFloat(parts[0]);
            const lon = parseFloat(parts[1]);
            if (isNaN(lat) || isNaN(lon)) return;
            STRATEGIC_SITES.forEach((site) => {
              const dist = haversineKm(lat, lon, site.lat, site.lon);
              if (dist < 100) nearSiteFires.push({ site: site.name, distKm: Math.round(dist) });
            });
          });
        }
      } catch { /* skip */ }
    }

    // 3. Calculate index from combined signals
    const osintScore = Math.min(50, fireArticles.length * 3 + siteAlerts.length * 10);
    const satelliteScore = Math.min(50, nearSiteFires.length * 15);
    const geoThermalIndex = Math.min(100, osintScore + satelliteScore);

    const dataSources = [];
    if (fireArticles.length > 0) dataSources.push(`GDELT: ${fireArticles.length} articles`);
    if (firmsFireCount > 0) dataSources.push(`NASA FIRMS: ${firmsFireCount} hotspots`);
    if (dataSources.length === 0) dataSources.push("No fire/explosion data found");

    const summary = `Geo-Thermal Index: ${geoThermalIndex}/100. ${siteAlerts.length} strategic site alerts (OSINT). ${nearSiteFires.length} satellite hotspots. Sources: ${dataSources.join(", ")}.`;

    await insertAgentReport(env.DB, {
      agent_name: "fires", report_type: "cycle",
      data: { geoThermalIndex, siteAlerts, nearSiteFires, firmsFireCount, osintArticles: fireArticles.length, articles: fireArticles.slice(0, 15) },
      summary, threat_level: geoThermalIndex,
      confidence: nearSiteFires.length > 0 ? "HIGH" : fireArticles.length > 5 ? "MEDIUM" : "LOW",
      items_count: siteAlerts.length + nearSiteFires.length,
    });

    return corsResponse({ success: true, geoThermalIndex, siteAlerts: siteAlerts.length, nearSiteFires: nearSiteFires.length, osintArticles: fireArticles.length });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-pizza (DOUGHCON — Pentagon Pizza Index) ──────────────────────────

// DC-area military facilities for ADS-B monitoring
const DC_FACILITIES = [
  { name: "Pentagon", lat: 38.871, lon: -77.056 },
  { name: "Andrews AFB (JBA)", lat: 38.811, lon: -76.867 },
  { name: "CIA Langley", lat: 38.952, lon: -77.146 },
  { name: "White House", lat: 38.898, lon: -77.036 },
  { name: "Fort Meade (NSA)", lat: 39.109, lon: -76.771 },
];

// VIP/command aircraft types that signal crisis activity
const VIP_TYPES = ["VC25", "VC-25", "C32", "C-32", "C37", "C-37", "C40", "C-40"];
const COMMAND_TYPES = ["E4B", "E-4B", "E4", "E-4", "E6B", "E-6B", "E6", "E-6"];
const LOGISTICS_TYPES = ["C17", "C-17", "C5", "C-5", "C130", "C-130"];
const TANKER_REFUEL = ["KC135", "KC-135", "KC10", "KC-10", "KC46", "KC-46"];

function isNearDC(lat: number, lon: number): { near: boolean; facility?: string; distKm?: number } {
  for (const f of DC_FACILITIES) {
    const dist = haversineKm(lat, lon, f.lat, f.lon);
    if (dist < 80) return { near: true, facility: f.name, distKm: Math.round(dist) };
  }
  return { near: false };
}

function classifyDCaircraft(t: string): "VIP" | "COMMAND" | "LOGISTICS" | "TANKER" | "OTHER" {
  const u = t.toUpperCase();
  if (VIP_TYPES.some((k) => u.includes(k))) return "VIP";
  if (COMMAND_TYPES.some((k) => u.includes(k))) return "COMMAND";
  if (LOGISTICS_TYPES.some((k) => u.includes(k))) return "LOGISTICS";
  if (TANKER_REFUEL.some((k) => u.includes(k))) return "TANKER";
  return "OTHER";
}

export async function agentPizza(_req: Request, env: Env): Promise<Response> {
  try {
    // 1. ADS-B: military flights near DC area
    const [adsbResp, gdeltCrisis, gdeltPentagon] = await Promise.allSettled([
      fetch("https://api.adsb.lol/v2/mil"),
      fetchGdelt('(pentagon OR "white house" OR "situation room") AND (crisis OR emergency OR overnight OR "late night")', 8),
      fetchGdelt('(pentagon OR "joint chiefs" OR "national security council" OR NSC) AND (meeting OR briefing OR convene)', 8),
    ]);

    // Parse DC-area military aircraft
    const dcAircraft: { callsign: string; type: string; category: string; facility: string; distKm: number; lat: number; lon: number; alt: number }[] = [];
    if (adsbResp.status === "fulfilled" && adsbResp.value.ok) {
      try {
        const data = await adsbResp.value.json() as { ac?: Array<{ lat?: number; lon?: number; t?: string; desc?: string; flight?: string; alt_baro?: number }> };
        (data.ac || []).forEach((ac) => {
          if (ac.lat == null || ac.lon == null) return;
          const proximity = isNearDC(ac.lat!, ac.lon!);
          if (!proximity.near) return;
          const t = ((ac.t || "") + " " + (ac.desc || "")).toUpperCase();
          const category = classifyDCaircraft(t);
          dcAircraft.push({
            callsign: (ac.flight || "").trim(),
            type: ac.t || "UNKNOWN",
            category,
            facility: proximity.facility!,
            distKm: proximity.distKm!,
            lat: ac.lat!, lon: ac.lon!,
            alt: ac.alt_baro && String(ac.alt_baro) !== "ground" ? Number(ac.alt_baro) : 0,
          });
        });
      } catch { /* ignore */ }
    }

    // 2. GDELT crisis activity articles
    const crisisArticles = gdeltCrisis.status === "fulfilled" ? gdeltCrisis.value : [];
    const pentagonArticles = gdeltPentagon.status === "fulfilled" ? gdeltPentagon.value : [];
    const totalArticles = crisisArticles.length + pentagonArticles.length;

    // 3. Time-of-day weighting (EST = UTC-5)
    const utcHour = new Date().getUTCHours();
    const estHour = (utcHour - 5 + 24) % 24;
    const isLateNight = estHour >= 22 || estHour <= 6;
    const timeMultiplier = isLateNight ? 1.5 : 1.0;

    // 4. Calculate DOUGHCON composite score
    const vipCount = dcAircraft.filter((a) => a.category === "VIP").length;
    const commandCount = dcAircraft.filter((a) => a.category === "COMMAND").length;
    const logisticsCount = dcAircraft.filter((a) => a.category === "LOGISTICS").length;

    // Weighted signal scores
    const vipSignal = vipCount * 25;       // VIP aircraft = very strong signal
    const commandSignal = commandCount * 20; // E-4B/E-6B = strong signal (nuclear command)
    const logisticsSignal = Math.min(30, logisticsCount * 5); // C-17/C-5 surge
    const articleSignal = Math.min(25, totalArticles * 3);
    const rawScore = (vipSignal + commandSignal + logisticsSignal + articleSignal) * timeMultiplier;
    const pizzaIndex = Math.min(100, Math.round(rawScore));

    // DOUGHCON levels
    let doughcon: string;
    if (pizzaIndex >= 80) doughcon = "DOUGHCON 1";
    else if (pizzaIndex >= 60) doughcon = "DOUGHCON 2";
    else if (pizzaIndex >= 40) doughcon = "DOUGHCON 3";
    else if (pizzaIndex >= 20) doughcon = "DOUGHCON 4";
    else doughcon = "DOUGHCON 5";

    const summary = `Pizza Index: ${pizzaIndex}/100 — ${doughcon}. DC mil aircraft: ${dcAircraft.length} (VIP: ${vipCount}, CMD: ${commandCount}, LOGI: ${logisticsCount}). OSINT: ${totalArticles} crisis articles. ${isLateNight ? "LATE NIGHT HOURS (EST)" : `EST ${estHour}:00`}.`;

    await insertAgentReport(env.DB, {
      agent_name: "pizza", report_type: "cycle",
      data: {
        pizzaIndex, doughcon, estHour, isLateNight, timeMultiplier,
        dcAircraft, vipCount, commandCount, logisticsCount,
        crisisArticles: crisisArticles.length, pentagonArticles: pentagonArticles.length,
        signals: { vipSignal, commandSignal, logisticsSignal, articleSignal, rawScore },
      },
      summary, threat_level: pizzaIndex,
      confidence: dcAircraft.length > 3 || totalArticles > 5 ? "HIGH" : dcAircraft.length > 0 ? "MEDIUM" : "LOW",
      items_count: dcAircraft.length + totalArticles,
    });

    return corsResponse({
      success: true, pizzaIndex, doughcon, isLateNight,
      dcAircraft: dcAircraft.length, vipCount, commandCount,
      crisisArticles: totalArticles,
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── THINK TANK AGENT ────────────────────────────────────────────────────────
// Red Team / Devil's Advocate — contrarian analysis of the current assessment

const THINKTANK_AGENTS = ["flights", "naval", "osint", "reddit", "pentagon", "cyber", "markets", "wiki", "macro", "fires", "pizza", "ais", "acled", "telegram", "head-analyst"];

interface ThinkTankOutput {
  dissentScore: number;
  overallAssessment: string;
  alternativeScenarios: { scenario: string; probability: number; reasoning: string }[];
  blindSpots: string[];
  redFlags: string[];
  historicalAnalogies: { event: string; year: number; relevance: string }[];
  contraryIndicators: string[];
  confidenceInDissent: number;
}

export async function agentThinkTank(_req: Request, env: Env): Promise<Response> {
  try {
    const cutoff = new Date(Date.now() - 120 * 60 * 1000).toISOString();

    // Gather all agent reports
    const agentReports: Record<string, { data: Record<string, unknown>; summary: string; threat_level: number }> = {};
    for (const agent of THINKTANK_AGENTS) {
      const row = await getLatestAgentReport(env.DB, agent, cutoff);
      if (row) agentReports[agent] = row as { data: Record<string, unknown>; summary: string; threat_level: number };
    }

    const activeAgents = Object.keys(agentReports);
    if (activeAgents.length < 3) {
      return corsResponse({ success: false, reason: "Insufficient agent data for contrarian analysis" });
    }

    // Get latest threat assessment for context
    const assessment = await env.DB.prepare(
      `SELECT tension_index, watchcon, hormuz_closure, cyber_attack, proxy_escalation, direct_confrontation, analysis_narrative
       FROM threat_assessments ORDER BY created_at DESC LIMIT 1`
    ).first<Record<string, unknown>>();

    // Build context
    const agentContext = activeAgents.map(a =>
      `${a.toUpperCase()}: ${agentReports[a].summary} | Threat: ${agentReports[a].threat_level}/100`
    ).join("\n");

    const assessmentContext = assessment
      ? `\nCURRENT ASSESSMENT: TI=${assessment.tension_index}, WATCHCON=${assessment.watchcon}, Hormuz=${assessment.hormuz_closure}%, Cyber=${assessment.cyber_attack}%, Proxy=${assessment.proxy_escalation}%, Direct=${assessment.direct_confrontation}%\nNarrative: ${assessment.analysis_narrative}`
      : "\nNo current threat assessment available.";

    const result = await callClaudeJSON<ThinkTankOutput>(env.CLIPROXY_BASE_URL, {
      model: "gemini-2.5-flash",
      max_tokens: 4096,
      system: `You are the DEVIL'S ADVOCATE analyst monitoring the IRAN/US CRISIS (Feb 2026). Challenge the prevailing assessment. Find MISSING signals, ALTERNATIVE SCENARIOS, BLIND SPOTS, RED FLAGS, and HISTORICAL ANALOGIES. Dissent score 0-100 (0=sound, 50=equally plausible alternatives, 100=intelligence failure risk). ALWAYS call output_think_tank_analysis.`,
      messages: [{
        role: "user",
        content: `MULTI-AGENT INTELLIGENCE DIGEST:\n\n${agentContext}${assessmentContext}\n\nProvide your contrarian analysis. Challenge everything. What are we missing?`,
      }],
      tools: [{
        name: "output_think_tank_analysis",
        description: "Output contrarian/red-team analysis",
        parameters: {
          type: "object",
          properties: {
            dissentScore: { type: "number", description: "0-100: how strongly you disagree with the current assessment" },
            overallAssessment: { type: "string", description: "Your contrarian summary — what the mainstream assessment gets wrong" },
            alternativeScenarios: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  scenario: { type: "string" },
                  probability: { type: "number", description: "0-100" },
                  reasoning: { type: "string" },
                },
                required: ["scenario", "probability", "reasoning"],
              },
              description: "2-4 alternative scenarios the main assessment underweights",
            },
            blindSpots: { type: "array", items: { type: "string" }, description: "What we're NOT seeing or collecting" },
            redFlags: { type: "array", items: { type: "string" }, description: "Signals others are dismissing" },
            historicalAnalogies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  event: { type: "string" },
                  year: { type: "number" },
                  relevance: { type: "string" },
                },
                required: ["event", "year", "relevance"],
              },
              description: "Historical parallels that suggest different outcomes",
            },
            contraryIndicators: { type: "array", items: { type: "string" }, description: "Data points that contradict the consensus" },
            confidenceInDissent: { type: "number", description: "0-100: how confident you are in your contrarian view" },
          },
          required: ["dissentScore", "overallAssessment", "alternativeScenarios", "blindSpots", "redFlags", "historicalAnalogies", "contraryIndicators", "confidenceInDissent"],
        },
      }],
      tool_choice: { type: "function", function: { name: "output_think_tank_analysis" } },
    });

    // Write to DB
    await insertAgentReport(env.DB, {
      agent_name: "thinktank",
      report_type: "cycle",
      data: result as unknown as Record<string, unknown>,
      summary: result.overallAssessment,
      threat_level: result.dissentScore,
      confidence: result.confidenceInDissent >= 60 ? "HIGH" : result.confidenceInDissent >= 30 ? "MEDIUM" : "LOW",
      items_count: (result.alternativeScenarios?.length || 0) + (result.blindSpots?.length || 0) + (result.redFlags?.length || 0),
    });

    return corsResponse({
      success: true,
      dissentScore: result.dissentScore,
      confidenceInDissent: result.confidenceInDissent,
      alternativeScenarios: result.alternativeScenarios?.length || 0,
      blindSpots: result.blindSpots?.length || 0,
      redFlags: result.redFlags?.length || 0,
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-ais (Maritime AIS Intelligence — Hormuz & Gulf Shipping) ─────────

const HORMUZ_CHOKEPOINTS = [
  { name: "Strait of Hormuz", latMin: 25.5, latMax: 27.5, lonMin: 55.5, lonMax: 57.5 },
  { name: "Bab el-Mandeb", latMin: 12.0, latMax: 13.5, lonMin: 42.5, lonMax: 44.0 },
  { name: "Suez Canal", latMin: 29.8, latMax: 31.3, lonMin: 32.0, lonMax: 32.8 },
];

const AIS_GDELT_QUERIES = [
  { query: '(tanker OR "oil tanker" OR VLCC OR supertanker) AND (hormuz OR "persian gulf" OR "strait of hormuz")', tag: "TANKER_HORMUZ", max: 10 },
  { query: '(shipping OR vessel OR cargo OR maritime) AND (iran OR "red sea" OR houthi OR blockade)', tag: "MARITIME_THREAT", max: 10 },
  { query: '("ship seizure" OR "vessel detained" OR "maritime incident" OR piracy) AND (gulf OR iran OR yemen)', tag: "MARITIME_INCIDENT", max: 8 },
  { query: '(IRGC OR "iranian navy" OR "revolutionary guard") AND (boat OR vessel OR naval OR maritime)', tag: "IRGC_NAVAL", max: 8 },
];

const AIS_RSS_QUERIES = [
  { query: "tanker oil VLCC hormuz persian gulf strait shipping", tag: "TANKER_HORMUZ", max: 8 },
  { query: "shipping vessel maritime iran red sea houthi blockade", tag: "MARITIME_THREAT", max: 8 },
  { query: "ship seizure vessel detained maritime incident gulf piracy", tag: "MARITIME_INCIDENT", max: 6 },
  { query: "IRGC iranian navy revolutionary guard boat naval", tag: "IRGC_NAVAL", max: 6 },
];

export async function agentAis(_req: Request, env: Env): Promise<Response> {
  try {
    // 1. ADS-B maritime patrol aircraft in Gulf/Hormuz region
    const [adsbResp, ...gdeltResults] = await Promise.allSettled([
      fetch("https://api.adsb.lol/v2/mil"),
      ...AIS_GDELT_QUERIES.map((q) => fetchGdelt(q.query, q.max)),
    ]);

    // Parse maritime patrol aircraft near chokepoints
    // ADS-B uses short codes: H60 (Seahawk), P8 (Poseidon), E6 (Mercury), E2C (Hawkeye), C130 (Hercules)
    const MARITIME_PATROL = ["P8", "P-8", "MQ9", "MQ-9", "H60", "EP3", "EP-3", "E6", "E2C", "C130", "RQ4", "TRITON", "POSEIDON", "ORION"];
    const patrolAircraft: { callsign: string; type: string; chokepoint: string; lat: number; lon: number }[] = [];

    if (adsbResp.status === "fulfilled" && adsbResp.value.ok) {
      try {
        const data = await adsbResp.value.json() as { ac?: Array<{ lat?: number; lon?: number; t?: string; desc?: string; flight?: string }> };
        (data.ac || []).forEach((ac) => {
          if (ac.lat == null || ac.lon == null) return;
          const t = ((ac.t || "") + " " + (ac.desc || "")).toUpperCase();
          if (!MARITIME_PATROL.some((k) => t.includes(k))) return;
          for (const cp of HORMUZ_CHOKEPOINTS) {
            if (ac.lat! >= cp.latMin && ac.lat! <= cp.latMax && ac.lon! >= cp.lonMin && ac.lon! <= cp.lonMax) {
              patrolAircraft.push({ callsign: (ac.flight || "").trim(), type: ac.t || "UNKNOWN", chokepoint: cp.name, lat: ac.lat!, lon: ac.lon! });
              break;
            }
          }
          // Wider Gulf region (not near specific chokepoint)
          if (ac.lat! >= 12 && ac.lat! <= 32 && ac.lon! >= 32 && ac.lon! <= 68) {
            if (!patrolAircraft.some((p) => p.callsign === (ac.flight || "").trim())) {
              patrolAircraft.push({ callsign: (ac.flight || "").trim(), type: ac.t || "UNKNOWN", chokepoint: "Gulf Region", lat: ac.lat!, lon: ac.lon! });
            }
          }
        });
      } catch { /* ignore */ }
    }

    // 2. GDELT maritime OSINT (with Google News RSS fallback)
    const taggedArticles: { tag: string; articles: unknown[] }[] = [];
    let gdeltWorked = false;
    gdeltResults.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value.length > 0) {
        taggedArticles.push({ tag: AIS_GDELT_QUERIES[i].tag, articles: r.value });
        gdeltWorked = true;
      }
    });

    // If GDELT failed or returned nothing, use Google News RSS fallback
    if (!gdeltWorked) {
      const rssResults = await Promise.allSettled(
        AIS_RSS_QUERIES.map((q) => fetchGoogleNewsRss(q.query, q.max))
      );
      rssResults.forEach((r, i) => {
        if (r.status === "fulfilled" && r.value.length > 0) {
          taggedArticles.push({ tag: AIS_RSS_QUERIES[i].tag, articles: r.value });
        }
      });
    }

    const totalArticles = taggedArticles.reduce((n, t) => n + t.articles.length, 0);

    // Incident detection (seizure, detention, attack)
    const incidentKeywords = ["seiz", "detain", "attack", "missile", "intercept", "board", "fire", "collision", "block"];
    const incidentArticles = taggedArticles
      .filter((t) => t.tag === "MARITIME_INCIDENT" || t.tag === "IRGC_NAVAL")
      .flatMap((t) => t.articles)
      .filter((a: unknown) => {
        const title = ((a as { title?: string }).title || "").toLowerCase();
        return incidentKeywords.some((kw) => title.includes(kw));
      });

    // 3. Chokepoint risk scoring — always emit all 3 chokepoints
    const CHOKEPOINT_KEYWORDS: Record<string, string[]> = {
      "Strait of Hormuz": ["hormuz", "strait", "persian gulf", "tanker war"],
      "Bab el-Mandeb": ["bab el-mandeb", "bab al-mandab", "mandeb", "red sea", "houthi", "aden"],
      "Suez Canal": ["suez", "canal", "port said", "ismailia"],
    };
    const chokepointAlerts: { name: string; patrolCount: number; articleCount: number; riskScore: number }[] = [];
    for (const cp of HORMUZ_CHOKEPOINTS) {
      const patrols = patrolAircraft.filter((p) => p.chokepoint === cp.name).length;
      const keywords = CHOKEPOINT_KEYWORDS[cp.name] || [cp.name.toLowerCase()];
      const articles = taggedArticles.flatMap((t) => t.articles).filter((a: unknown) => {
        const title = ((a as { title?: string }).title || "").toLowerCase();
        return keywords.some((kw) => title.includes(kw));
      }).length;
      // Count incidents that match this chokepoint specifically
      const localIncidents = incidentArticles.filter((a: unknown) => {
        const title = ((a as { title?: string }).title || "").toLowerCase();
        return keywords.some((kw) => title.includes(kw));
      }).length;
      const globalIncidentSpill = Math.min(10, (incidentArticles.length - localIncidents) * 2);
      const baseRisk = patrols * 15 + articles * 5 + localIncidents * 15 + globalIncidentSpill;
      // Add ambient risk from total OSINT volume (even without direct keyword match)
      const ambientRisk = Math.min(10, Math.floor(totalArticles / 3));
      const riskScore = Math.min(100, baseRisk + ambientRisk);
      chokepointAlerts.push({ name: cp.name, patrolCount: patrols, articleCount: articles, riskScore });
    }

    // 4. Composite Maritime Threat Index
    const patrolSignal = Math.min(40, patrolAircraft.length * 8);
    const osintSignal = Math.min(30, totalArticles * 2);
    const incidentSignal = Math.min(30, incidentArticles.length * 15);
    const maritimeThreatIndex = Math.min(100, patrolSignal + osintSignal + incidentSignal);

    const summary = `Maritime Threat Index: ${maritimeThreatIndex}/100. ${patrolAircraft.length} patrol aircraft near chokepoints. ${totalArticles} maritime OSINT articles. ${incidentArticles.length} incident reports. Chokepoints: ${chokepointAlerts.map((c) => `${c.name}(${c.riskScore})`).join(", ") || "nominal"}.`;

    await insertAgentReport(env.DB, {
      agent_name: "ais", report_type: "cycle",
      data: {
        maritimeThreatIndex, patrolAircraft, chokepointAlerts, incidentArticles: incidentArticles.length,
        taggedArticles: taggedArticles.map((t) => ({ tag: t.tag, count: t.articles.length })),
        articles: taggedArticles.flatMap((t) => t.articles).slice(0, 20),
      },
      summary, threat_level: maritimeThreatIndex,
      confidence: patrolAircraft.length > 2 || incidentArticles.length > 0 ? "HIGH" : totalArticles > 5 ? "MEDIUM" : "LOW",
      items_count: patrolAircraft.length + totalArticles,
    });

    return corsResponse({
      success: true, maritimeThreatIndex,
      patrolAircraft: patrolAircraft.length, chokepointAlerts: chokepointAlerts.length,
      incidentReports: incidentArticles.length, osintArticles: totalArticles,
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-acled (UCDP Conflict Events — free public API, no key) ───────────

const UCDP_COUNTRIES = [
  { id: 130, name: "Iran" },
  { id: 101, name: "Iraq" },
  { id: 102, name: "Israel" },
  { id: 135, name: "Yemen" },
  { id: 115, name: "Lebanon" },
  { id: 128, name: "Syria" },
  { id: 126, name: "Saudi Arabia" },
];

// UCDP GED (Georeferenced Event Dataset) — free, no key required
// https://ucdpapi.pcr.uu.se/api/gedevents/
async function fetchUcdpEvents(year: number): Promise<unknown[]> {
  try {
    const url = `https://ucdpapi.pcr.uu.se/api/gedevents/${year}?pagesize=100&page=0`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const data = await resp.json() as { Result?: unknown[] };
    return data.Result || [];
  } catch { return []; }
}

// UCDP Candidate events (near real-time, updated daily)
async function fetchUcdpCandidate(): Promise<unknown[]> {
  try {
    const url = "https://ucdpapi.pcr.uu.se/api/candidate?pagesize=100&page=0";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return [];
    const data = await resp.json() as { Result?: unknown[] };
    return data.Result || [];
  } catch { return []; }
}

// Liveuamap RSS as conflict event fallback (free, no key)
async function fetchConflictRss(): Promise<{ title: string; country: string; date: string }[]> {
  const feeds = [
    { url: "https://news.google.com/rss/search?q=airstrike+OR+bombing+iran+OR+iraq+OR+yemen+OR+syria+OR+lebanon&hl=en&gl=US&ceid=US:en", region: "MENA" },
    { url: "https://news.google.com/rss/search?q=%22armed+clash%22+OR+%22military+operation%22+iran+OR+iraq+OR+yemen&hl=en&gl=US&ceid=US:en", region: "MENA" },
  ];
  const results: { title: string; country: string; date: string }[] = [];
  const focusKw = ["iran", "iraq", "yemen", "syria", "lebanon", "israel", "saudi", "houthi", "hezbollah", "gaza"];

  for (const feed of feeds) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(feed.url, { signal: controller.signal, headers: { "User-Agent": "MeridianIntel/1.0" } });
      clearTimeout(timeout);
      if (!resp.ok) continue;
      const xml = await resp.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of items.slice(0, 20)) {
        const title = (item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
        const lower = title.toLowerCase();
        const matchedCountry = focusKw.find((kw) => lower.includes(kw)) || "";
        if (matchedCountry) results.push({ title: title.slice(0, 300), country: matchedCountry, date: pubDate });
      }
    } catch { /* skip */ }
  }
  return results;
}

interface UcdpEvent {
  id?: number;
  country?: string;
  country_id?: number;
  dyad_name?: string;
  type_of_violence?: number; // 1=state, 2=non-state, 3=one-sided
  date_start?: string;
  date_end?: string;
  best?: number; // best estimate of fatalities
  high?: number;
  low?: number;
  latitude?: number;
  longitude?: number;
  where_description?: string;
  source_article?: string;
  source_headline?: string;
}

// ─── ACLED Direct API (free, no key for basic recent data) ───────────────────
// https://api.acleddata.com/acled/read — returns structured conflict events

const ACLED_FOCUS_COUNTRIES = ["Iran", "Iraq", "Israel", "Yemen", "Lebanon", "Syria", "Saudi Arabia"];

interface AcledEvent {
  event_date: string;
  event_type: string;
  sub_event_type: string;
  country: string;
  admin1: string;
  admin2: string;
  location: string;
  fatalities: number;
  notes: string;
  actor1?: string;
  actor2?: string;
  source?: string;
  latitude?: string;
  longitude?: string;
}

/**
 * Fetch recent conflict events from ACLED Direct API.
 * Queries a rolling 3-day window for focus countries (Middle East).
 * Free access, no key required for basic queries.
 */
async function fetchAcledDirect(): Promise<AcledEvent[]> {
  try {
    // Build date range: today and 2 days back (3-day rolling window)
    const now = new Date();
    const dateEnd = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const dateStart = new Date(now.getTime() - 2 * 86400000).toISOString().slice(0, 10);

    const countryParam = ACLED_FOCUS_COUNTRIES.join("|");
    const url = `https://api.acleddata.com/acled/read?event_date=${dateStart}|${dateEnd}&event_date_where=BETWEEN&country=${encodeURIComponent(countryParam)}&limit=200`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000); // 12s timeout — external API
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });
    clearTimeout(timeout);

    if (!resp.ok) return [];
    const body = await resp.json() as { status?: number; count?: number; data?: AcledEvent[] };
    if (!body.data || !Array.isArray(body.data)) return [];

    // Normalize fatalities to numbers
    return body.data.map((e) => ({
      ...e,
      fatalities: typeof e.fatalities === "string" ? parseInt(e.fatalities, 10) || 0 : (e.fatalities || 0),
    }));
  } catch {
    return []; // Graceful degradation — API might be rate-limited or down
  }
}

export async function agentAcled(_req: Request, env: Env): Promise<Response> {
  try {
    // UCDP GED only available up to ~2023-2024; use 2024 as latest + candidate for recent
    const gedYear = 2024;

    // 1. Fetch ACLED Direct API (primary) + UCDP + Google News RSS + GDELT in parallel
    const [acledDirectResult, candidateResult, gedResult, rssResult, ...gdeltResults] = await Promise.allSettled([
      fetchAcledDirect(),
      fetchUcdpCandidate(),
      fetchUcdpEvents(gedYear),
      fetchConflictRss(),
      fetchGdelt('(airstrike OR bombing OR shelling OR "armed clash" OR "military operation") AND (iran OR iraq OR yemen OR lebanon OR syria)', 12),
      fetchGdelt('(casualties OR killed OR wounded OR "civilian deaths") AND (iran OR iraq OR yemen OR syria OR "gaza")', 10),
    ]);

    // ── ACLED Direct API results (primary structured conflict data) ──────────
    const acledEvents = acledDirectResult.status === "fulfilled" ? acledDirectResult.value : [];

    // Analyze ACLED events by country
    const acledByCountry: Record<string, { events: number; fatalities: number; eventTypes: Set<string>; recentEvents: AcledEvent[] }> = {};
    let acledTotalFatalities = 0;
    for (const ev of acledEvents) {
      const country = ev.country || "Unknown";
      if (!acledByCountry[country]) {
        acledByCountry[country] = { events: 0, fatalities: 0, eventTypes: new Set(), recentEvents: [] };
      }
      const cd = acledByCountry[country];
      cd.events++;
      cd.fatalities += ev.fatalities;
      acledTotalFatalities += ev.fatalities;
      if (ev.event_type) cd.eventTypes.add(ev.event_type);
      if (cd.recentEvents.length < 5) cd.recentEvents.push(ev);
    }

    // Detect high-severity ACLED event types (battles, explosions/remote violence, violence against civilians)
    const highSeverityTypes = ["Battles", "Explosions/Remote violence", "Violence against civilians"];
    const acledHighSeverity = acledEvents.filter((e) => highSeverityTypes.includes(e.event_type));

    // ── UCDP results (fallback/supplement for historical data) ───────────────
    const candidateEvents = candidateResult.status === "fulfilled" ? candidateResult.value : [];
    const gedEvents = gedResult.status === "fulfilled" ? gedResult.value : [];
    const rssConflictItems = rssResult.status === "fulfilled" ? rssResult.value : [];

    // 2. Filter UCDP events for focus countries
    const focusCountryIds = new Set(UCDP_COUNTRIES.map((c) => c.id));
    const focusCountryNames = new Set(UCDP_COUNTRIES.map((c) => c.name.toLowerCase()));

    const filterFocusEvents = (events: unknown[]): UcdpEvent[] =>
      (events as UcdpEvent[]).filter((e) =>
        (e.country_id && focusCountryIds.has(e.country_id)) ||
        (e.country && focusCountryNames.has(e.country.toLowerCase()))
      );

    const focusCandidates = filterFocusEvents(candidateEvents);
    const focusGed = filterFocusEvents(gedEvents);

    // 3. Analyze UCDP by country (merged into combined country data)
    const countryConflictData: Record<string, { events: number; fatalities: number; violenceTypes: Set<number>; acledEvents: number; acledFatalities: number; acledEventTypes: string[] }> = {};
    const allFocusEvents = [...focusCandidates, ...focusGed];

    // Seed country data from ACLED first (primary source)
    for (const [country, data] of Object.entries(acledByCountry)) {
      countryConflictData[country] = {
        events: 0, fatalities: 0, violenceTypes: new Set(),
        acledEvents: data.events, acledFatalities: data.fatalities,
        acledEventTypes: [...data.eventTypes],
      };
    }

    // Layer UCDP data on top
    for (const event of allFocusEvents) {
      const country = event.country || "Unknown";
      if (!countryConflictData[country]) {
        countryConflictData[country] = { events: 0, fatalities: 0, violenceTypes: new Set(), acledEvents: 0, acledFatalities: 0, acledEventTypes: [] };
      }
      const cd = countryConflictData[country];
      cd.events++;
      cd.fatalities += event.best || 0;
      if (event.type_of_violence) cd.violenceTypes.add(event.type_of_violence);
    }

    // 4. RSS conflict events by country
    const rssCountryCounts: Record<string, number> = {};
    rssConflictItems.forEach((item) => {
      rssCountryCounts[item.country] = (rssCountryCounts[item.country] || 0) + 1;
    });

    // 5. GDELT supplementary conflict data
    const gdeltConflictArticles = gdeltResults
      .filter((r): r is PromiseFulfilledResult<unknown[]> => r.status === "fulfilled")
      .flatMap((r) => r.value);

    // 6. Compute Conflict Intensity Index (multi-source — ACLED is primary weight)
    const totalUcdpEvents = allFocusEvents.length;
    const totalUcdpFatalities = allFocusEvents.reduce((sum, e) => sum + (e.best || 0), 0);
    const stateViolence = allFocusEvents.filter((e) => e.type_of_violence === 1).length;
    const totalFatalities = acledTotalFatalities + totalUcdpFatalities;

    // ACLED scores (primary — up to 45 points total)
    const acledEventScore = Math.min(20, acledEvents.length * 0.5);       // Volume of events
    const acledFatalityScore = Math.min(15, acledTotalFatalities * 0.3);   // Fatality count
    const acledSeverityScore = Math.min(10, acledHighSeverity.length * 1); // High-severity events

    // UCDP scores (supplementary — up to 25 points)
    const ucdpScore = Math.min(15, totalUcdpEvents * 1.5);
    const ucdpFatalityScore = Math.min(10, totalUcdpFatalities * 0.3);

    // Other source scores (complementary — up to 30 points)
    const stateScore = Math.min(10, stateViolence * 3);
    const rssScore = Math.min(12, rssConflictItems.length * 1.2);
    const gdeltScore = Math.min(8, gdeltConflictArticles.length * 0.8);

    const conflictIntensityIndex = Math.min(100, Math.round(
      acledEventScore + acledFatalityScore + acledSeverityScore +
      ucdpScore + ucdpFatalityScore +
      stateScore + rssScore + gdeltScore
    ));

    const dataSources: string[] = [];
    if (acledEvents.length > 0) dataSources.push(`ACLED: ${acledEvents.length} events/${acledTotalFatalities} fatalities`);
    if (totalUcdpEvents > 0) dataSources.push(`UCDP: ${totalUcdpEvents} events`);
    if (rssConflictItems.length > 0) dataSources.push(`News RSS: ${rssConflictItems.length} conflict reports`);
    if (gdeltConflictArticles.length > 0) dataSources.push(`GDELT: ${gdeltConflictArticles.length} articles`);
    if (dataSources.length === 0) dataSources.push("No conflict data");

    const countrySummaries = Object.entries(countryConflictData)
      .sort((a, b) => (b[1].acledFatalities + b[1].fatalities) - (a[1].acledFatalities + a[1].fatalities))
      .map(([c, d]) => {
        const parts = [];
        if (d.acledEvents > 0) parts.push(`ACLED:${d.acledEvents}ev/${d.acledFatalities}fat`);
        if (d.events > 0) parts.push(`UCDP:${d.events}ev/${d.fatalities}fat`);
        return `${c}(${parts.join(",")})`;
      })
      .join("; ");

    const rssSummary = Object.entries(rssCountryCounts).map(([c, n]) => `${c}(${n})`).join(", ");

    // ACLED event type breakdown for summary
    const acledEventTypeCounts: Record<string, number> = {};
    acledEvents.forEach((e) => { acledEventTypeCounts[e.event_type] = (acledEventTypeCounts[e.event_type] || 0) + 1; });
    const acledTypeSummary = Object.entries(acledEventTypeCounts).map(([t, n]) => `${t}:${n}`).join(", ");

    const summary = `Conflict Intensity Index: ${conflictIntensityIndex}/100. Sources: ${dataSources.join(", ")}. Countries: ${countrySummaries || "none"}.${acledTypeSummary ? ` ACLED types: ${acledTypeSummary}.` : ""} News: ${rssSummary || "none"}.`;

    await insertAgentReport(env.DB, {
      agent_name: "acled", report_type: "cycle",
      data: {
        conflictIntensityIndex, totalFatalities,
        // ACLED Direct API data (primary)
        acledDirect: {
          totalEvents: acledEvents.length,
          totalFatalities: acledTotalFatalities,
          highSeverityEvents: acledHighSeverity.length,
          eventTypeCounts: acledEventTypeCounts,
          byCountry: Object.fromEntries(
            Object.entries(acledByCountry).map(([c, d]) => [c, { events: d.events, fatalities: d.fatalities, eventTypes: [...d.eventTypes] }])
          ),
          recentEvents: acledEvents.slice(0, 20).map((e) => ({
            date: e.event_date, type: e.event_type, subType: e.sub_event_type,
            country: e.country, location: e.location, admin1: e.admin1,
            fatalities: e.fatalities, notes: (e.notes || "").slice(0, 200),
            actor1: e.actor1, actor2: e.actor2,
          })),
        },
        // UCDP data (supplementary)
        totalUcdpEvents, totalUcdpFatalities, stateViolence,
        countryBreakdown: Object.fromEntries(
          Object.entries(countryConflictData).map(([c, d]) => [c, {
            ucdpEvents: d.events, ucdpFatalities: d.fatalities, violenceTypes: [...d.violenceTypes],
            acledEvents: d.acledEvents, acledFatalities: d.acledFatalities, acledEventTypes: d.acledEventTypes,
          }])
        ),
        // RSS + GDELT data
        rssConflictItems: rssConflictItems.length,
        rssCountryCounts,
        rssHeadlines: rssConflictItems.slice(0, 10).map((r) => ({ title: r.title, country: r.country, date: r.date })),
        gdeltArticles: gdeltConflictArticles.length,
        // Score breakdown for transparency
        scoreBreakdown: {
          acledEventScore: Math.round(acledEventScore * 10) / 10,
          acledFatalityScore: Math.round(acledFatalityScore * 10) / 10,
          acledSeverityScore: Math.round(acledSeverityScore * 10) / 10,
          ucdpScore: Math.round(ucdpScore * 10) / 10,
          ucdpFatalityScore: Math.round(ucdpFatalityScore * 10) / 10,
          stateScore: Math.round(stateScore * 10) / 10,
          rssScore: Math.round(rssScore * 10) / 10,
          gdeltScore: Math.round(gdeltScore * 10) / 10,
        },
      },
      summary, threat_level: conflictIntensityIndex,
      confidence:
        acledEvents.length > 20 || (totalUcdpEvents > 10 && acledEvents.length > 0) ? "HIGH" :
        acledEvents.length > 5 || totalUcdpEvents > 3 || rssConflictItems.length > 5 ? "MEDIUM" : "LOW",
      items_count: acledEvents.length + totalUcdpEvents + rssConflictItems.length + gdeltConflictArticles.length,
    });

    return corsResponse({
      success: true, conflictIntensityIndex,
      acledEvents: acledEvents.length, acledFatalities: acledTotalFatalities,
      acledHighSeverity: acledHighSeverity.length,
      ucdpEvents: totalUcdpEvents, ucdpFatalities: totalUcdpFatalities,
      totalFatalities, stateViolence,
      rssConflictItems: rssConflictItems.length,
      gdeltArticles: gdeltConflictArticles.length,
      countries: Object.keys(countryConflictData).length,
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-telegram (Public Telegram Channel OSINT) ─────────────────────────

const TELEGRAM_CHANNELS: { name: string; label: string; lang?: string }[] = [
  { name: "inikiresearch", label: "Iniki Research (OSINT)" },
  { name: "intikiresearch", label: "Intiki Research" },
  { name: "ryaborig", label: "Rybar (Mil Analysis)" },
  { name: "middleeastobserver", label: "Middle East Observer" },
  { name: "theaborigenal", label: "Middle East Intel" },
  { name: "IsraelHayomEN", label: "Israel Hayom EN" },
  { name: "PressTV", label: "PressTV Iran" },
  { name: "AlJazeeraEnglish", label: "Al Jazeera" },
  { name: "TasneemOnline", label: "Tasnim News (Iran Mil)", lang: "fa" },
  { name: "AlMayadeenLive", label: "Al Mayadeen Live (Iran Proxy)", lang: "ar" },
  { name: "IsnaFarsi", label: "ISNA Farsi (Iran Domestic)", lang: "fa" },
  { name: "AlManarTV", label: "Al Manar TV (Hezbollah)", lang: "ar" },
];

const IRAN_KEYWORDS = [
  "iran", "irgc", "hormuz", "houthi", "pezeshkian", "tehran", "natanz", "fordow",
  "nuclear", "centcom", "carrier", "missile", "drone", "airstrike", "sanction",
  "hezbollah", "lebanon", "yemen", "red sea", "gulf", "enrichment", "iaea",
  "proxy", "escalation", "retaliation", "strike", "deployment",
];

interface TelegramPost {
  channel: string;
  channelLabel: string;
  text: string;
  date: string;
  views: string;
  relevanceScore: number;
}

/** Fetch Telegram channel posts via RSSHub public instances (RSS bridge).
 *  Falls back across multiple RSSHub mirrors, then to Bing News RSS. */
const RSSHUB_INSTANCES = [
  "https://rsshub.app",
  "https://rsshub.rssforever.com",
  "https://rsshub-instance.zeabur.app",
];

async function fetchTelegramViaRssHub(channel: string): Promise<{ text: string; date: string; views: string }[]> {
  for (const instance of RSSHUB_INSTANCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(`${instance}/telegram/channel/${channel}`, {
        signal: controller.signal,
        headers: { "User-Agent": "MeridianIntel/1.0" },
      });
      clearTimeout(timeout);
      if (!resp.ok) continue;
      const xml = await resp.text();
      const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      if (items.length === 0) continue;

      const posts: { text: string; date: string; views: string }[] = [];
      for (const item of items.slice(0, 20)) {
        const title = (item.match(/<title>([\s\S]*?)<\/title>/)?.[1] || "")
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
        const desc = (item.match(/<description>([\s\S]*?)<\/description>/)?.[1] || "")
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
        const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";

        const text = (desc || title).trim();
        if (text.length > 20) {
          posts.push({ text: text.slice(0, 500), date: pubDate, views: "0" });
        }
      }
      if (posts.length > 0) return posts;
    } catch { /* try next instance */ }
  }
  return [];
}

/** Fallback: search Bing News RSS for Telegram channel content + keywords */
async function fetchTelegramViaBingNews(channel: string, channelLabel: string): Promise<{ text: string; date: string; views: string }[]> {
  // Search for recent news mentioning this channel or its label + Iran crisis keywords
  const queries = [
    `"${channel}" telegram iran OR nuclear OR missile OR military`,
    `${channelLabel} telegram middle east iran`,
  ];
  const posts: { text: string; date: string; views: string }[] = [];
  for (const q of queries) {
    const items = await fetchBingNewsRss(q, 10) as { title?: string; url?: string; seendate?: string }[];
    for (const item of items) {
      const text = (item.title || "").trim();
      if (text.length > 20 && !posts.some((p) => p.text === text)) {
        posts.push({ text: text.slice(0, 500), date: item.seendate || "", views: "0" });
      }
    }
    if (posts.length >= 5) break;
  }
  return posts;
}

/** Combined fetcher: RSSHub primary, Bing News fallback */
async function fetchTelegramChannel(channel: string, channelLabel: string): Promise<{ text: string; date: string; views: string }[]> {
  const rssPosts = await fetchTelegramViaRssHub(channel);
  if (rssPosts.length > 0) return rssPosts;
  return fetchTelegramViaBingNews(channel, channelLabel);
}

export async function agentTelegram(_req: Request, env: Env): Promise<Response> {
  try {
    // 1. Fetch all channels via RSSHub / Bing News fallback (no direct t.me access from CF Workers)
    const channelResults = await Promise.allSettled(
      TELEGRAM_CHANNELS.map((ch) => fetchTelegramChannel(ch.name, ch.label))
    );

    // 2. Collect and score posts for relevance
    const allPosts: TelegramPost[] = [];
    channelResults.forEach((r, i) => {
      if (r.status !== "fulfilled") return;
      const ch = TELEGRAM_CHANNELS[i];
      r.value.forEach((post) => {
        const lower = post.text.toLowerCase();
        const matchedKeywords = IRAN_KEYWORDS.filter((kw) => lower.includes(kw));
        const relevanceScore = matchedKeywords.length;
        if (relevanceScore > 0) {
          allPosts.push({
            channel: ch.name,
            channelLabel: ch.label,
            text: post.text,
            date: post.date,
            views: post.views,
            relevanceScore,
          });
        }
      });
    });

    // If no posts from any channel, try a broad keyword Bing News RSS sweep as last resort
    if (allPosts.length === 0) {
      const broadQueries = [
        "telegram iran nuclear missile IRGC crisis",
        "telegram channel middle east houthi hezbollah military",
      ];
      for (const q of broadQueries) {
        const items = await fetchBingNewsRss(q, 15) as { title?: string; url?: string; seendate?: string }[];
        for (const item of items) {
          const text = (item.title || "").trim();
          const lower = text.toLowerCase();
          const matchedKeywords = IRAN_KEYWORDS.filter((kw) => lower.includes(kw));
          if (matchedKeywords.length > 0) {
            allPosts.push({
              channel: "bing-news-fallback",
              channelLabel: "Bing News (Telegram fallback)",
              text: text.slice(0, 500),
              date: item.seendate || "",
              views: "0",
              relevanceScore: matchedKeywords.length,
            });
          }
        }
      }
    }

    // Sort by relevance, then by date
    allPosts.sort((a, b) => b.relevanceScore - a.relevanceScore || b.date.localeCompare(a.date));

    // 3. Calculate signal metrics
    const totalRelevant = allPosts.length;
    const highRelevance = allPosts.filter((p) => p.relevanceScore >= 3).length;
    const channelsActive = new Set(allPosts.map((p) => p.channel)).size;
    const channelsScraped = channelResults.filter((r) => r.status === "fulfilled" && r.value.length > 0).length;

    // Keyword frequency analysis
    const keywordFreq: Record<string, number> = {};
    allPosts.forEach((p) => {
      const lower = p.text.toLowerCase();
      IRAN_KEYWORDS.forEach((kw) => {
        if (lower.includes(kw)) keywordFreq[kw] = (keywordFreq[kw] || 0) + 1;
      });
    });
    const topKeywords = Object.entries(keywordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([kw, count]) => ({ keyword: kw, count }));

    // 4. Telegram Signal Strength Index
    const volumeScore = Math.min(30, totalRelevant * 2);
    const intensityScore = Math.min(30, highRelevance * 5);
    const breadthScore = Math.min(20, channelsActive * 5);
    const keywordDiversity = Math.min(20, Object.keys(keywordFreq).length * 2);
    const telegramSignalIndex = Math.min(100, volumeScore + intensityScore + breadthScore + keywordDiversity);

    const summary = `Telegram Signal Index: ${telegramSignalIndex}/100. ${totalRelevant} relevant posts from ${channelsActive}/${channelsScraped} channels. ${highRelevance} high-relevance (3+ keywords). Top signals: ${topKeywords.slice(0, 5).map((k) => `${k.keyword}(${k.count})`).join(", ")}.`;

    await insertAgentReport(env.DB, {
      agent_name: "telegram", report_type: "cycle",
      data: {
        telegramSignalIndex, totalRelevant, highRelevance, channelsActive, channelsScraped,
        topKeywords, keywordFreq,
        posts: allPosts.slice(0, 25).map((p) => ({
          channel: p.channelLabel, text: p.text.slice(0, 300), date: p.date,
          views: p.views, relevanceScore: p.relevanceScore,
        })),
      },
      summary, threat_level: telegramSignalIndex,
      confidence: channelsActive >= 3 && totalRelevant > 10 ? "HIGH" : totalRelevant > 3 ? "MEDIUM" : "LOW",
      items_count: totalRelevant,
    });

    return corsResponse({
      success: true, telegramSignalIndex,
      relevantPosts: totalRelevant, highRelevance,
      channelsActive, channelsScraped,
      topKeywords: topKeywords.slice(0, 5),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// ─── agent-metaculus (Prediction Market / Crowd Forecast Comparison) ─────────

const METACULUS_KEYWORDS: Record<string, string> = {
  "iran": "hormuzClosure",
  "nuclear": "hormuzClosure",
  "cyber": "cyberAttack",
  "war": "directConfrontation",
  "conflict": "proxyEscalation",
  "attack": "cyberAttack",
  "strike": "directConfrontation",
  "escalation": "proxyEscalation",
};

export async function agentMetaculus(_req: Request, env: Env): Promise<Response> {
  try {
    // Fetch open questions related to Iran/geopolitics
    const searches = ["iran", "nuclear iran", "middle east conflict", "strait of hormuz"];
    const allQuestions: Array<{ id: number; title: string; community_prediction?: number; url: string; metric?: string }> = [];

    for (const query of searches) {
      try {
        const resp = await fetch(`https://www.metaculus.com/api2/questions/?search=${encodeURIComponent(query)}&status=open&type=forecast&limit=5`, {
          headers: { "User-Agent": "MeridianC4ISR/1.0" },
        });
        if (!resp.ok) continue;
        const data = await resp.json() as { results?: Array<{ id: number; title: string; community_prediction?: { full?: { q2?: number } }; url?: string }> };
        for (const q of data.results || []) {
          if (allQuestions.some(existing => existing.id === q.id)) continue;
          const pred = q.community_prediction?.full?.q2;
          if (pred == null) continue;
          // Map question to our metric
          const titleLower = q.title.toLowerCase();
          let metric: string | undefined;
          for (const [kw, m] of Object.entries(METACULUS_KEYWORDS)) {
            if (titleLower.includes(kw)) { metric = m; break; }
          }
          allQuestions.push({
            id: q.id,
            title: q.title,
            community_prediction: Math.round(pred * 100),
            url: q.url || `https://www.metaculus.com/questions/${q.id}/`,
            metric,
          });
        }
      } catch { /* skip */ }
    }

    // Compare with our predictions
    const divergences: { question: string; metaculus: number; ours: number; divergence: number; metric: string }[] = [];
    if (allQuestions.length > 0) {
      // Get our latest predictions
      const predRows = await env.DB.prepare(
        `SELECT metric, our_estimate FROM prediction_log WHERE created_at >= ? GROUP BY metric ORDER BY created_at DESC`
      ).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).all<{ metric: string; our_estimate: number }>();

      const ourPredictions: Record<string, number> = {};
      for (const r of predRows.results) {
        ourPredictions[r.metric] = r.our_estimate;
      }

      for (const q of allQuestions) {
        if (q.metric && ourPredictions[q.metric] != null && q.community_prediction != null) {
          const div = Math.abs(ourPredictions[q.metric] - q.community_prediction);
          if (div > 15) {
            divergences.push({
              question: q.title.slice(0, 100),
              metaculus: q.community_prediction,
              ours: Math.round(ourPredictions[q.metric]),
              divergence: Math.round(div),
              metric: q.metric,
            });
          }
        }
      }

      // Write Metaculus predictions to prediction_log
      const now = new Date().toISOString();
      for (const q of allQuestions) {
        if (q.metric && q.community_prediction != null) {
          await env.DB.prepare(
            `INSERT INTO prediction_log (metric, our_estimate, market_price, agent_count, created_at)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(`metaculus_${q.metric}`, q.community_prediction, null, 1, now).run();
        }
      }
    }

    const summary = `Metaculus: ${allQuestions.length} forecast questions found. ${divergences.length} significant divergences (>15%).`;
    await insertAgentReport(env.DB, {
      agent_name: "metaculus",
      report_type: "cycle",
      data: { questions: allQuestions, divergences, questionCount: allQuestions.length },
      summary,
      threat_level: Math.min(100, divergences.length * 20 + allQuestions.length * 3),
      confidence: allQuestions.length > 5 ? "MEDIUM" : "LOW",
      items_count: allQuestions.length,
    });

    return corsResponse({ success: true, questionsFound: allQuestions.length, divergences: divergences.length });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}
