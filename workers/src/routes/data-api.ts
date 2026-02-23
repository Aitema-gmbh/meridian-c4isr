/**
 * GET-Endpoints für Frontend-Datenbankabfragen (ersetzt direkten Supabase-Zugriff)
 */
import { corsError, corsResponse } from "../lib/cors";
import type { Env } from "../lib/anthropic";
import { detectCUSUM, classifyTrajectory, holtWinters, ensembleForecast, compoundAnomalyScore, medianAbsoluteDeviation, modifiedZScore, signalVelocity, type CUSUMResult, type TrajectoryResult } from "../lib/forecasting";
import { matchPatterns, CRISIS_TEMPLATES, type DTWMatchResult } from "../lib/dtw";
import { agentOsint, agentNaval, agentReddit, agentPentagon, agentCyber, agentMarkets, agentWiki, agentMacro, agentFires, agentPizza, agentAis, agentAcled, agentTelegram, agentThinkTank, agentMetaculus, agentWeather, agentIsw } from "./agents-db";
import { agentFlights } from "./agent-flights";
import { agentHeadAnalyst } from "./agent-head-analyst";

// GET /api/agent-reports?hours=2
export async function apiAgentReports(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "2");
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = await env.DB.prepare(
      `SELECT id, agent_name, data, summary, threat_level, confidence, items_count, created_at
       FROM agent_reports WHERE created_at >= ? ORDER BY created_at DESC LIMIT 100`
    ).bind(cutoff).all<Record<string, unknown>>();
    const results = rows.results.map((r) => ({
      ...r,
      data: r.data ? JSON.parse(r.data as string) : {},
    }));
    return corsResponse({ reports: results });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/threat-assessments?limit=24
export async function apiThreatAssessments(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") || "24");
    const rows = await env.DB.prepare(
      `SELECT id, tension_index, watchcon, hormuz_closure, cyber_attack, proxy_escalation,
              direct_confrontation, analysis_narrative, market_divergences, raw_indicators, created_at
       FROM threat_assessments ORDER BY created_at DESC LIMIT ?`
    ).bind(limit).all<Record<string, unknown>>();
    // JSON-Felder deserialisieren
    const results = rows.results.map((r) => ({
      ...r,
      market_divergences: r.market_divergences ? JSON.parse(r.market_divergences as string) : [],
      raw_indicators: r.raw_indicators ? JSON.parse(r.raw_indicators as string) : {},
    }));
    return corsResponse({ assessments: results });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/country-scores
export async function apiCountryScores(_req: Request, env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(
      `SELECT * FROM country_scores ORDER BY created_at DESC LIMIT 100`
    ).all<Record<string, unknown>>();
    const results = rows.results.map((r) => ({
      ...r,
      signal_breakdown: r.signal_breakdown ? JSON.parse(r.signal_breakdown as string) : {},
    }));
    return corsResponse({ scores: results });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/intel-snapshot (letzter gespeicherter Live-Intel-Snapshot als Fallback)
export async function apiIntelSnapshot(_req: Request, env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      `SELECT data, created_at FROM intel_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first<{ data: string; created_at: string }>();
    if (!row) return corsResponse({ items: [], flashReport: null, metadata: {} });
    return corsResponse({ ...JSON.parse(row.data), snapshotTime: row.created_at });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/market-snapshot
export async function apiMarketSnapshot(_req: Request, env: Env): Promise<Response> {
  try {
    const row = await env.DB.prepare(
      `SELECT data, created_at FROM market_snapshots ORDER BY created_at DESC LIMIT 1`
    ).first<{ data: string; created_at: string }>();
    if (!row) return corsResponse({ markets: [], total: 0 });
    return corsResponse({ ...JSON.parse(row.data), snapshotTime: row.created_at });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// Keyword → Coordinates mapping for OSINT geocoding
// ─── Map Intel: Precise geocoding, deduplication, max 15 events ────────────

const GAZETTEER: Array<{ keywords: string[]; lat: number; lon: number; label: string; priority: number }> = [
  // ─── TIER 10: Nuclear Facilities (highest precision) ───
  { keywords: ["natanz"], lat: 33.72, lon: 51.73, label: "Natanz Nuclear Facility", priority: 10 },
  { keywords: ["fordow"], lat: 34.88, lon: 51.00, label: "Fordow Nuclear Facility", priority: 10 },
  { keywords: ["isfahan nuclear", "esfahan nuclear", "ucf isfahan"], lat: 32.58, lon: 51.68, label: "Isfahan Nuclear Complex", priority: 10 },
  { keywords: ["bushehr nuclear", "bushehr plant"], lat: 28.84, lon: 50.90, label: "Bushehr Nuclear Plant", priority: 10 },
  { keywords: ["parchin"], lat: 35.52, lon: 51.77, label: "Parchin Military Complex", priority: 10 },
  { keywords: ["arak reactor", "arak heavy", "ir-40"], lat: 34.37, lon: 49.24, label: "Arak Heavy Water Reactor", priority: 10 },
  { keywords: ["dimona"], lat: 31.07, lon: 35.14, label: "Dimona (Israel Nuclear)", priority: 10 },
  { keywords: ["saghand", "ardakan"], lat: 32.31, lon: 55.19, label: "Saghand Uranium Mine", priority: 10 },

  // ─── TIER 10: Tehran High-Value Targets ───
  { keywords: ["supreme leader", "khamenei", "beit rahbari", "rahbar"], lat: 35.700, lon: 51.421, label: "Supreme Leader Compound (Tehran)", priority: 10 },
  { keywords: ["majles", "parliament", "iranian parliament"], lat: 35.688, lon: 51.418, label: "Iranian Parliament (Majles)", priority: 10 },
  { keywords: ["ministry of defense", "mod iran"], lat: 35.754, lon: 51.417, label: "Ministry of Defense (Tehran)", priority: 10 },
  { keywords: ["sarallah", "irgc headquarter", "irgc hq"], lat: 35.694, lon: 51.417, label: "IRGC Sarallah HQ (Tehran)", priority: 10 },

  // ─── TIER 9: Strategic Military Bases & Ports ───
  { keywords: ["bandar abbas"], lat: 27.18, lon: 56.27, label: "Bandar Abbas Naval Base", priority: 9 },
  { keywords: ["al udeid", "al-udeid"], lat: 25.12, lon: 51.32, label: "Al Udeid Air Base", priority: 9 },
  { keywords: ["al dhafra", "al-dhafra"], lat: 24.25, lon: 54.55, label: "Al Dhafra Air Base (UAE)", priority: 9 },
  { keywords: ["diego garcia"], lat: -7.32, lon: 72.42, label: "Diego Garcia", priority: 9 },
  { keywords: ["incirlik"], lat: 37.00, lon: 35.43, label: "Incirlik Air Base", priority: 9 },
  { keywords: ["camp arifjan", "arifjan"], lat: 28.93, lon: 48.08, label: "Camp Arifjan (Kuwait)", priority: 9 },
  { keywords: ["ain al-asad", "ain al asad", "al-asad"], lat: 33.80, lon: 42.45, label: "Ain al-Asad Air Base (Iraq)", priority: 9 },
  { keywords: ["camp lemonnier", "lemonnier", "djibouti base"], lat: 11.55, lon: 43.16, label: "Camp Lemonnier (Djibouti)", priority: 9 },
  { keywords: ["nsa bahrain", "5th fleet", "fifth fleet", "navcent", "juffair"], lat: 26.23, lon: 50.59, label: "NSA Bahrain (US 5th Fleet)", priority: 9 },
  { keywords: ["al-tanf", "al tanf"], lat: 33.50, lon: 38.67, label: "Al-Tanf Base (Syria)", priority: 9 },
  { keywords: ["prince sultan", "al kharj"], lat: 24.06, lon: 47.58, label: "Prince Sultan Air Base (Saudi)", priority: 9 },
  { keywords: ["erbil"], lat: 36.24, lon: 43.96, label: "Erbil (US/Kurdistan)", priority: 9 },
  { keywords: ["jask naval", "jask base"], lat: 25.64, lon: 57.77, label: "Jask Naval Base (Iran)", priority: 9 },
  { keywords: ["konarak"], lat: 25.35, lon: 60.38, label: "Konarak Naval Base (Iran)", priority: 9 },
  { keywords: ["mehrabad", "mehrabad air"], lat: 35.689, lon: 51.311, label: "Mehrabad Air Base (Tehran)", priority: 9 },
  { keywords: ["dezful", "vahdati"], lat: 32.43, lon: 48.38, label: "Dezful/Vahdati Air Base", priority: 9 },

  // ─── TIER 9: Iranian Missile Bases ───
  { keywords: ["shahrud missile", "shahrud test"], lat: 36.43, lon: 55.00, label: "Shahrud Missile Test Site", priority: 9 },
  { keywords: ["semnan missile", "semnan space"], lat: 35.23, lon: 53.92, label: "Semnan Space/Missile Center", priority: 9 },
  { keywords: ["tabriz missile", "sayyad"], lat: 38.08, lon: 46.29, label: "Tabriz Missile Garrison", priority: 9 },
  { keywords: ["khorramabad missile", "imam ali base"], lat: 33.49, lon: 48.36, label: "Imam Ali Missile Base (Khorramabad)", priority: 9 },

  // ─── TIER 9: Oil & Energy Infrastructure (Iran) ───
  { keywords: ["kharg island", "kharg oil", "kharg terminal"], lat: 29.23, lon: 50.32, label: "Kharg Island Oil Terminal", priority: 9 },
  { keywords: ["south pars", "assaluyeh", "asaluyeh"], lat: 27.48, lon: 52.60, label: "South Pars Gas Field / Assaluyeh", priority: 9 },
  { keywords: ["lavan island", "lavan oil"], lat: 26.80, lon: 53.36, label: "Lavan Island Oil Terminal", priority: 9 },
  { keywords: ["sirri island", "sirri oil"], lat: 25.90, lon: 54.53, label: "Sirri Island Oil Terminal", priority: 9 },
  { keywords: ["abadan refinery", "abadan oil"], lat: 30.35, lon: 48.30, label: "Abadan Oil Refinery", priority: 9 },
  { keywords: ["bandar imam", "imam khomeini port", "mahshahr"], lat: 30.43, lon: 49.07, label: "Bandar Imam Khomeini Oil Port", priority: 9 },
  { keywords: ["isfahan refinery", "isfahan oil"], lat: 32.68, lon: 51.64, label: "Isfahan Oil Refinery", priority: 9 },
  { keywords: ["tehran refinery"], lat: 35.60, lon: 51.45, label: "Tehran Oil Refinery", priority: 9 },

  // ─── TIER 9: Oil & Energy Infrastructure (Gulf States) ───
  { keywords: ["ras tanura"], lat: 26.64, lon: 50.16, label: "Ras Tanura (Saudi Oil)", priority: 9 },
  { keywords: ["aramco", "abqaiq"], lat: 25.94, lon: 49.68, label: "Abqaiq (Aramco)", priority: 9 },
  { keywords: ["jebel ali"], lat: 25.05, lon: 55.06, label: "Jebel Ali Port", priority: 9 },
  { keywords: ["fujairah terminal", "fujairah oil", "fujairah port"], lat: 25.12, lon: 56.33, label: "Fujairah Oil Terminal (UAE)", priority: 9 },
  { keywords: ["chabahar"], lat: 25.30, lon: 60.64, label: "Chabahar Port", priority: 9 },

  // ─── TIER 8: Strategic Islands & Chokepoints ───
  { keywords: ["hormuz", "strait of hormuz"], lat: 26.57, lon: 56.25, label: "Strait of Hormuz", priority: 8 },
  { keywords: ["bab el-mandeb", "bab al-mandab", "mandeb"], lat: 12.58, lon: 43.33, label: "Bab el-Mandeb", priority: 8 },
  { keywords: ["suez canal", "suez"], lat: 30.46, lon: 32.35, label: "Suez Canal", priority: 8 },
  { keywords: ["qeshm"], lat: 26.85, lon: 55.90, label: "Qeshm Island", priority: 8 },
  { keywords: ["abu musa"], lat: 25.87, lon: 55.03, label: "Abu Musa Island (Disputed)", priority: 8 },
  { keywords: ["farsi island"], lat: 27.03, lon: 50.07, label: "Farsi Island (IRGC Navy)", priority: 8 },
  { keywords: ["larak"], lat: 26.85, lon: 56.35, label: "Larak Island", priority: 8 },
  { keywords: ["tunb", "greater tunb", "lesser tunb"], lat: 26.27, lon: 55.28, label: "Tunb Islands (Disputed)", priority: 8 },

  // ─── TIER 7: Regional Seas ───
  { keywords: ["persian gulf"], lat: 26.80, lon: 52.00, label: "Persian Gulf", priority: 7 },
  { keywords: ["gulf of oman"], lat: 25.00, lon: 58.50, label: "Gulf of Oman", priority: 7 },
  { keywords: ["red sea"], lat: 20.00, lon: 38.00, label: "Red Sea", priority: 7 },
  { keywords: ["gulf of aden", "aden"], lat: 12.80, lon: 45.00, label: "Gulf of Aden", priority: 7 },
  { keywords: ["arabian sea"], lat: 18.00, lon: 62.00, label: "Arabian Sea", priority: 7 },
  { keywords: ["golan", "golan heights"], lat: 33.00, lon: 35.75, label: "Golan Heights", priority: 7 },

  // ─── TIER 7: Iran Protests / Civil Unrest ───
  { keywords: ["protest tehran", "tehran protest", "tehran rally", "students tehran"], lat: 35.713, lon: 51.397, label: "Tehran University (Protests)", priority: 7 },
  { keywords: ["protest isfahan", "isfahan protest"], lat: 32.65, lon: 51.67, label: "Isfahan (Protests)", priority: 7 },
  { keywords: ["protest shiraz", "shiraz protest"], lat: 29.59, lon: 52.58, label: "Shiraz (Protests)", priority: 7 },
  { keywords: ["student protest", "students protest", "university protest", "campus protest"], lat: 35.713, lon: 51.397, label: "Iran Student Protests", priority: 7 },
  { keywords: ["protest iran", "iranian protest", "iran unrest", "iranian unrest"], lat: 35.69, lon: 51.39, label: "Iran Unrest", priority: 6 },

  // ─── TIER 6: Major Cities ───
  { keywords: ["tehran"], lat: 35.69, lon: 51.39, label: "Tehran", priority: 6 },
  { keywords: ["baghdad"], lat: 33.31, lon: 44.37, label: "Baghdad", priority: 6 },
  { keywords: ["beirut"], lat: 33.89, lon: 35.50, label: "Beirut", priority: 6 },
  { keywords: ["damascus"], lat: 33.51, lon: 36.29, label: "Damascus", priority: 6 },
  { keywords: ["riyadh"], lat: 24.71, lon: 46.68, label: "Riyadh", priority: 6 },
  { keywords: ["dubai"], lat: 25.20, lon: 55.27, label: "Dubai", priority: 6 },
  { keywords: ["doha"], lat: 25.29, lon: 51.53, label: "Doha", priority: 6 },
  { keywords: ["muscat"], lat: 23.59, lon: 58.38, label: "Muscat", priority: 6 },
  { keywords: ["tel aviv"], lat: 32.09, lon: 34.78, label: "Tel Aviv", priority: 6 },
  { keywords: ["jerusalem"], lat: 31.77, lon: 35.23, label: "Jerusalem", priority: 6 },
  { keywords: ["sanaa", "sana'a"], lat: 15.37, lon: 44.19, label: "Sanaa", priority: 6 },
  { keywords: ["hodeidah", "hudaydah"], lat: 14.80, lon: 42.95, label: "Hodeidah Port", priority: 6 },
  { keywords: ["aleppo"], lat: 36.20, lon: 37.15, label: "Aleppo", priority: 6 },
  { keywords: ["basra"], lat: 30.51, lon: 47.81, label: "Basra", priority: 6 },
  { keywords: ["mosul"], lat: 36.34, lon: 43.12, label: "Mosul", priority: 6 },
  { keywords: ["amman"], lat: 31.95, lon: 35.93, label: "Amman", priority: 6 },
  { keywords: ["kirkuk"], lat: 35.47, lon: 44.39, label: "Kirkuk", priority: 6 },
  { keywords: ["karbala"], lat: 32.62, lon: 44.02, label: "Karbala", priority: 6 },
  { keywords: ["ahvaz", "ahwaz", "khuzestan"], lat: 31.32, lon: 48.67, label: "Ahvaz (Khuzestan)", priority: 6 },
  { keywords: ["qom"], lat: 34.64, lon: 50.88, label: "Qom", priority: 6 },
  { keywords: ["shiraz"], lat: 29.59, lon: 52.58, label: "Shiraz", priority: 6 },
  { keywords: ["tabriz"], lat: 38.08, lon: 46.29, label: "Tabriz", priority: 6 },
  { keywords: ["mashhad"], lat: 36.30, lon: 59.61, label: "Mashhad", priority: 6 },
  { keywords: ["kerman"], lat: 30.28, lon: 57.08, label: "Kerman", priority: 6 },
  { keywords: ["eilat", "aqaba"], lat: 29.56, lon: 34.95, label: "Eilat/Aqaba", priority: 6 },
  { keywords: ["isfahan", "esfahan"], lat: 32.65, lon: 51.67, label: "Isfahan", priority: 6 },
  { keywords: ["bushehr city", "bushehr port"], lat: 28.97, lon: 50.84, label: "Bushehr", priority: 6 },
  { keywords: ["bandar lengeh"], lat: 26.56, lon: 54.88, label: "Bandar Lengeh", priority: 6 },
  { keywords: ["abadan"], lat: 30.35, lon: 48.30, label: "Abadan", priority: 6 },
  { keywords: ["khorramshahr"], lat: 30.44, lon: 48.17, label: "Khorramshahr", priority: 6 },

  // ─── TIER 6: Proxy Militia Strongholds (ISW key locations) ───
  { keywords: ["dahieh", "dahiyeh", "south beirut"], lat: 33.84, lon: 35.50, label: "Dahieh (Hezbollah HQ)", priority: 6 },
  { keywords: ["baalbek", "bekaa"], lat: 34.01, lon: 36.21, label: "Baalbek (Hezbollah)", priority: 6 },
  { keywords: ["nabatieh", "south lebanon"], lat: 33.38, lon: 35.48, label: "South Lebanon (Hezbollah)", priority: 6 },
  { keywords: ["saada"], lat: 16.94, lon: 43.76, label: "Saada (Houthi Stronghold)", priority: 6 },
  { keywords: ["marib"], lat: 15.45, lon: 45.35, label: "Marib (Frontline)", priority: 6 },
  { keywords: ["taiz"], lat: 13.58, lon: 44.02, label: "Taiz (Contested)", priority: 6 },
  { keywords: ["deir ez-zor", "deir ezzor", "deir al-zor"], lat: 35.34, lon: 40.14, label: "Deir ez-Zor", priority: 6 },
  { keywords: ["abu kamal", "al-bukamal", "bukamal"], lat: 34.45, lon: 40.92, label: "Abu Kamal (Iran Corridor)", priority: 6 },
  { keywords: ["al-qaim", "qaim"], lat: 34.38, lon: 41.07, label: "Al-Qaim (Iraq-Syria Border)", priority: 6 },
  { keywords: ["tikrit"], lat: 34.59, lon: 43.73, label: "Tikrit", priority: 6 },
  { keywords: ["daraa", "deraa"], lat: 32.62, lon: 36.10, label: "Daraa (S. Syria)", priority: 6 },
  { keywords: ["homs", "qusayr"], lat: 34.73, lon: 36.72, label: "Homs", priority: 6 },
  { keywords: ["sinjar"], lat: 36.32, lon: 41.88, label: "Sinjar", priority: 6 },
  { keywords: ["rafah"], lat: 31.28, lon: 34.25, label: "Rafah", priority: 6 },

  // ─── TIER 5: Context-Aware Topic Geocoding ───
  { keywords: ["nuclear site", "nuclear facility", "enrichment", "centrifuge"], lat: 33.72, lon: 51.73, label: "Natanz Nuclear Facility", priority: 5 },
  { keywords: ["nuclear program", "nuclear weapon", "nuclear deal", "jcpoa", "uranium"], lat: 34.88, lon: 51.00, label: "Iran Nuclear Program", priority: 4 },
  { keywords: ["carrier strike", "csg", "abraham lincoln", "uss lincoln", "uss eisenhower", "uss harry truman"], lat: 25.50, lon: 54.00, label: "US CSG (Persian Gulf)", priority: 5 },
  { keywords: ["b-2", "b-52", "bomber task"], lat: -7.32, lon: 72.42, label: "Diego Garcia (USAF)", priority: 5 },
  { keywords: ["centcom", "us central command"], lat: 25.12, lon: 51.32, label: "CENTCOM (Al Udeid)", priority: 5 },
  { keywords: ["pentagon", "us military buildup", "us forces"], lat: 25.50, lon: 54.00, label: "US Forces (Gulf Region)", priority: 3 },
  { keywords: ["irgc navy", "irgc naval", "irgc gunboat", "irgcn"], lat: 27.18, lon: 56.27, label: "IRGC Navy (Bandar Abbas)", priority: 5 },
  { keywords: ["irgc", "revolutionary guard", "sepah", "pasdaran"], lat: 35.69, lon: 51.39, label: "IRGC (Tehran)", priority: 4 },
  { keywords: ["oil tanker", "oil shipment", "oil export iran", "crude oil iran"], lat: 29.23, lon: 50.32, label: "Kharg Island Oil Terminal", priority: 5 },
  { keywords: ["petrochemical", "gas pipeline", "lng iran"], lat: 27.48, lon: 52.60, label: "South Pars / Assaluyeh", priority: 5 },
  { keywords: ["kata'ib hezbollah", "kataib hezbollah", "pmf", "popular mobilization"], lat: 33.31, lon: 44.37, label: "PMF/Kataib (Baghdad)", priority: 5 },
  { keywords: ["ansar allah"], lat: 15.37, lon: 44.19, label: "Ansar Allah (Sanaa)", priority: 5 },

  // ─── TIER 1: Countries (lowest priority — fallback only) ───
  { keywords: ["iran", "iranian"], lat: 32.43, lon: 53.69, label: "Iran", priority: 1 },
  { keywords: ["iraq", "iraqi"], lat: 33.31, lon: 44.37, label: "Iraq", priority: 1 },
  { keywords: ["israel", "idf", "netanyahu"], lat: 31.77, lon: 35.23, label: "Israel", priority: 1 },
  { keywords: ["saudi arabia", "saudi"], lat: 24.71, lon: 46.68, label: "Saudi Arabia", priority: 1 },
  { keywords: ["yemen", "houthi"], lat: 15.37, lon: 44.19, label: "Yemen", priority: 1 },
  { keywords: ["uae", "emirates", "abu dhabi"], lat: 24.45, lon: 54.65, label: "UAE", priority: 1 },
  { keywords: ["qatar"], lat: 25.29, lon: 51.53, label: "Qatar", priority: 1 },
  { keywords: ["lebanon", "hezbollah"], lat: 33.89, lon: 35.50, label: "Lebanon", priority: 1 },
  { keywords: ["syria", "syrian"], lat: 33.51, lon: 36.29, label: "Syria", priority: 1 },
  { keywords: ["oman"], lat: 23.59, lon: 58.38, label: "Oman", priority: 1 },
  { keywords: ["bahrain"], lat: 26.23, lon: 50.59, label: "Bahrain", priority: 1 },
  { keywords: ["kuwait"], lat: 29.38, lon: 47.98, label: "Kuwait", priority: 1 },
  { keywords: ["jordan"], lat: 31.95, lon: 35.93, label: "Jordan", priority: 1 },
  { keywords: ["turkey", "turkish"], lat: 39.93, lon: 32.86, label: "Turkey", priority: 1 },
  { keywords: ["egypt", "egyptian", "cairo"], lat: 30.04, lon: 31.24, label: "Egypt", priority: 1 },
  { keywords: ["djibouti"], lat: 11.59, lon: 43.15, label: "Djibouti", priority: 1 },
  { keywords: ["trump", "white house", "washington"], lat: 38.90, lon: -77.04, label: "Washington DC", priority: 1 },
];

function classifyEventType(title: string): "maritime" | "military" | "diplomatic" | "incident" | "nuclear" | "cyber" | "protest" | "energy" {
  const t = title.toLowerCase();
  // Most specific first → least specific last
  if (["nuclear", "enrichment", "centrifuge", "uranium", "iaea", "jcpoa", "warhead", "fordow", "natanz", "nuclear deal", "nuclear talk", "nuclear program"].some(k => t.includes(k))) return "nuclear";
  if (["cyber", "hack", "malware", "ransomware", "ddos", "breach", "apt", "scada"].some(k => t.includes(k))) return "cyber";
  if (["protest", "demonstrat", "unrest", "rally", "student", "campus", "uprising", "riot", "dissent", "crackdown"].some(k => t.includes(k))) return "protest";
  if (["oil", "refinery", "pipeline", "petrochemical", "lng", "crude", "tanker seizure", "oil terminal", "gas field", "petroleum", "crude oil", "oil price", "oil tanker"].some(k => t.includes(k))) return "energy";
  if (["tanker", "ship", "vessel", "cargo", "maritime", "port", "shipping", "seize", "supertanker", "strait"].some(k => t.includes(k))) return "maritime";
  if (["irgc", "idf", "military", "troops", "army", "navy", "air force", "centcom", "deploy", "carrier", "b-2", "drill", "exercise", "pentagon", "battalion", "missile", "sayyad", "ballistic", "air defense", "s-300", "s-400", "radar", "icbm", "rocket", "launcher"].some(k => t.includes(k))) return "military";
  if (["seizure", "attack", "strike", "explosion", "drone", "intercept", "hit", "shoot", "bomb", "kill", "clash", "assassination", "blast"].some(k => t.includes(k))) return "incident";
  return "diplomatic";
}

function geocodeArticle(title: string): { lat: number; lon: number; label: string; priority: number } | null {
  const t = title.toLowerCase();
  let bestMatch: { lat: number; lon: number; label: string; priority: number } | null = null;

  for (const loc of GAZETTEER) {
    if (loc.keywords.some(k => t.includes(k))) {
      if (!bestMatch || loc.priority > bestMatch.priority) {
        bestMatch = { lat: loc.lat, lon: loc.lon, label: loc.label, priority: loc.priority };
      }
    }
  }
  return bestMatch;
}

// Jaccard-like title similarity for deduplication
function titleSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(w => w.length > 3));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

// ISW theme → location mapping for synthetic geocoded events
const ISW_THEME_LOCATIONS: Record<string, Array<{ lat: number; lon: number; label: string; type: string }>> = {
  "NUCLEAR_TALKS": [
    { lat: 33.72, lon: 51.73, label: "Natanz Nuclear Facility", type: "nuclear" },
    { lat: 34.88, lon: 51.00, label: "Fordow Nuclear Facility", type: "nuclear" },
  ],
  "MILITARY_BUILDUP": [
    { lat: 25.12, lon: 51.32, label: "Al Udeid Air Base", type: "military" },
    { lat: 27.18, lon: 56.27, label: "Bandar Abbas", type: "military" },
  ],
  "PROXY_ACTIVITY": [
    { lat: 33.84, lon: 35.50, label: "Dahieh (Hezbollah HQ)", type: "incident" },
    { lat: 15.37, lon: 44.19, label: "Sanaa", type: "incident" },
    { lat: 15.45, lon: 45.35, label: "Marib (Frontline)", type: "incident" },
  ],
  "CYBER_OPS": [
    { lat: 35.69, lon: 51.39, label: "Tehran", type: "cyber" },
  ],
  "SYRIA": [
    { lat: 35.34, lon: 40.14, label: "Deir ez-Zor", type: "military" },
    { lat: 34.45, lon: 40.92, label: "Abu Kamal (Iran Corridor)", type: "military" },
  ],
  "IRAQ": [
    { lat: 33.31, lon: 44.37, label: "Baghdad", type: "military" },
    { lat: 34.38, lon: 41.07, label: "Al-Qaim (Iraq-Syria Border)", type: "military" },
  ],
  "INTERNAL_IRAN": [
    { lat: 35.69, lon: 51.39, label: "Tehran", type: "diplomatic" },
  ],
};

// GET /api/map-intel — precise geocoded OSINT events + chokepoint risk data + weather
export async function apiMapIntel(_req: Request, env: Env): Promise<Response> {
  try {
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

    // Fetch from ALL relevant agents
    const intelAgents = ["ais", "osint", "naval", "acled", "telegram", "pentagon", "cyber", "reddit", "isw", "weather", "flights"];
    const rows = await env.DB.prepare(
      `SELECT agent_name, data, threat_level, created_at FROM agent_reports
       WHERE agent_name IN (${intelAgents.map(() => "?").join(",")}) AND created_at >= ?
       ORDER BY created_at DESC LIMIT 30`
    ).bind(...intelAgents, cutoff).all<{ agent_name: string; data: string; threat_level: number; created_at: string }>();

    type MapEvent = { lat: number; lon: number; type: string; title: string; source: string; severity: number; label: string; priority: number; timestamp: string; rationale: string };
    const candidates: MapEvent[] = [];
    let chokepoints: Array<{ name: string; riskScore: number; patrolCount: number; articleCount: number }> = [];
    let weatherSummary = "";
    let weatherAlerts: Array<{ location: string; alert: string }> = [];
    let flightActivity: Array<{ region: string; count: number }> = [];
    let conflictZones: Array<{ country: string; intensity: number; fatalities: number }> = [];
    let headAnalystContext = "";

    for (const row of rows.results) {
      let data: Record<string, unknown>;
      try { data = JSON.parse(row.data); } catch { continue; }

      // ─── AIS: Chokepoint risk data ───
      if (row.agent_name === "ais" && data.chokepointAlerts) {
        const alerts = data.chokepointAlerts as Array<Record<string, unknown>>;
        if (alerts.length > 0 && chokepoints.length === 0) {
          chokepoints = alerts.map(a => ({
            name: String(a.name || a.chokepoint || "Unknown"),
            riskScore: Number(a.riskScore ?? 0),
            patrolCount: Number(a.patrolCount ?? 0),
            articleCount: Number(a.articleCount ?? 0),
          }));
        }
      }

      // ─── WEATHER: Summary + alerts for map overlay ───
      if (row.agent_name === "weather") {
        if (data.conditions) weatherSummary = (data.conditions as string[]).join(". ");
        if (data.alerts && Array.isArray(data.alerts)) {
          weatherAlerts = (data.alerts as Array<{ location: string; type: string; details: string }>)
            .map(a => ({ location: a.location, alert: `${a.type}: ${a.details}` }));
        }
      }

      // ─── FLIGHTS: Military flight activity for map ───
      if (row.agent_name === "flights" && data.counts) {
        const counts = data.counts as Record<string, number>;
        flightActivity = Object.entries(counts).map(([region, count]) => ({ region, count }));
        // Add ISR orbits as map events
        if (data.activeIsrOrbits && Array.isArray(data.activeIsrOrbits)) {
          for (const orbit of (data.activeIsrOrbits as Array<{ lat?: number; lon?: number; type?: string; callsign?: string }>)) {
            if (orbit.lat && orbit.lon) {
              candidates.push({
                lat: orbit.lat, lon: orbit.lon, type: "military",
                title: `ISR orbit: ${orbit.callsign || orbit.type || "Unknown"} surveillance pattern`,
                source: "flights", severity: 3, label: "ISR Orbit", priority: 8,
                timestamp: row.created_at, rationale: "Live ADS-B ISR aircraft orbit detected",
              });
            }
          }
        }
      }

      // ─── ACLED: Conflict zone data + country breakdown ───
      if (row.agent_name === "acled") {
        if (data.countryBreakdown && typeof data.countryBreakdown === "object") {
          const breakdown = data.countryBreakdown as Record<string, { events?: number; fatalities?: number }>;
          conflictZones = Object.entries(breakdown).map(([country, stats]) => ({
            country, intensity: stats.events || 0, fatalities: stats.fatalities || 0,
          }));
        }
        // Extract RSS headlines (rssHeadlines array) + GDELT conflict articles
        const rssItems = (data.rssHeadlines || data.rssConflictItems || []);
        const gdeltItems = (data.gdeltConflictArticles || data.gdeltArticles || []);
        const allConflictItems = [
          ...(Array.isArray(rssItems) ? rssItems : []),
          ...(Array.isArray(gdeltItems) ? gdeltItems : []),
        ] as Array<{ title?: string; text?: string }>;
        for (const item of allConflictItems) {
          const title = item.title || item.text || "";
          if (!title || title.length < 15) continue;
          const geo = geocodeArticle(title);
          if (!geo) continue;
          candidates.push({
            lat: geo.lat, lon: geo.lon, type: classifyEventType(title),
            title: title.slice(0, 120), source: "acled", severity: 4,
            label: geo.label, priority: geo.priority, timestamp: row.created_at,
            rationale: "ACLED conflict monitoring",
          });
        }
      }

      // ─── ISW: Theme-based geocoding + takeaway geocoding ───
      if (row.agent_name === "isw") {
        const themes = (data.themes || []) as string[];
        const takeaways = (data.takeaways || []) as string[];

        // Generate events from ISW themes
        for (const theme of themes) {
          const locations = ISW_THEME_LOCATIONS[theme];
          if (!locations) continue;
          // Pick only the first location per theme to avoid flooding
          const loc = locations[0];
          const themeLabel = theme.replace(/_/g, " ").toLowerCase();
          candidates.push({
            lat: loc.lat, lon: loc.lon, type: loc.type,
            title: `ISW: ${themeLabel} activity detected in latest analysis`,
            source: "isw", severity: 4, label: loc.label, priority: 7,
            timestamp: row.created_at, rationale: `ISW theme: ${theme}`,
          });
        }

        // Also geocode takeaways (key findings from ISW reports)
        for (const takeaway of takeaways.slice(0, 3)) {
          if (!takeaway || takeaway.length < 20) continue;
          const geo = geocodeArticle(takeaway);
          if (!geo) continue;
          candidates.push({
            lat: geo.lat, lon: geo.lon, type: classifyEventType(takeaway),
            title: `ISW: ${takeaway.slice(0, 100)}`, source: "isw",
            severity: 4, label: geo.label, priority: Math.max(geo.priority, 6),
            timestamp: row.created_at, rationale: "ISW key takeaway",
          });
        }
      }

      // ─── TELEGRAM: Use text field (not title) for geocoding ───
      if (row.agent_name === "telegram") {
        const posts = (data.posts || data.items || []) as Array<{ text?: string; channel?: string; relevanceScore?: number }>;
        for (const post of posts) {
          const text = post.text || "";
          if (!text || text.length < 20 || (post.relevanceScore !== undefined && post.relevanceScore < 1)) continue;
          const geo = geocodeArticle(text);
          if (!geo) continue;
          candidates.push({
            lat: geo.lat, lon: geo.lon, type: classifyEventType(text),
            title: `[TG/${post.channel || "intel"}] ${text.slice(0, 100)}`, source: "telegram",
            severity: 3, label: geo.label, priority: geo.priority,
            timestamp: row.created_at, rationale: `Telegram channel: ${post.channel || "unknown"}`,
          });
        }
        continue; // Skip generic article extraction for telegram
      }

      // ─── GENERIC: Extract articles/items from all other agents ───
      if (row.agent_name !== "weather" && row.agent_name !== "flights" && row.agent_name !== "acled" && row.agent_name !== "isw" && row.agent_name !== "telegram") {
        const articles = (data.articles || data.items || data.posts || data.reports || data.relevantItems || []) as Array<{ title?: string; text?: string; url?: string }>;
        for (const article of articles) {
          const title = article.title || article.text || "";
          if (!title || title.length < 15) continue;
          const geo = geocodeArticle(title);
          if (!geo) continue;

          const eventType = classifyEventType(title);
          const severity = eventType === "incident" ? 5 : eventType === "nuclear" ? 4 : eventType === "energy" ? 4 : eventType === "protest" ? 3 : eventType === "military" ? 3 : eventType === "maritime" ? 3 : eventType === "cyber" ? 2 : 1;

          candidates.push({
            lat: geo.lat, lon: geo.lon, type: eventType,
            title: title.slice(0, 120), source: row.agent_name, severity,
            label: geo.label, priority: geo.priority, timestamp: row.created_at,
            rationale: `${row.agent_name} OSINT`,
          });
        }
      }
    }

    // ─── Fetch head-analyst context for strategic overlay ───
    try {
      const ha = await env.DB.prepare(
        `SELECT data FROM agent_reports WHERE agent_name = 'head-analyst' ORDER BY created_at DESC LIMIT 1`
      ).first<{ data: string }>();
      if (ha) {
        const haData = JSON.parse(ha.data);
        headAnalystContext = `TI:${haData.tensionIndex || "?"} WATCHCON:${haData.watchcon || "?"} — ${(haData.flashReport || "").slice(0, 150)}`;
      }
    } catch { /* optional */ }

    // === DEDUPLICATION: Keep best article per topic-location cluster ===
    const deduped: MapEvent[] = [];
    for (const candidate of candidates) {
      const isDuplicate = deduped.some(existing =>
        existing.label === candidate.label &&
        existing.type === candidate.type &&
        titleSimilarity(existing.title, candidate.title) > 0.35
      );
      if (!isDuplicate) {
        deduped.push(candidate);
      }
    }

    // === SCORING: severity * priority + source bonus ===
    const sourcesPerLabel: Record<string, Set<string>> = {};
    for (const e of deduped) {
      if (!sourcesPerLabel[e.label]) sourcesPerLabel[e.label] = new Set();
      sourcesPerLabel[e.label].add(e.source);
    }

    const scored = deduped.map(e => ({
      ...e,
      score: e.severity * 2 + e.priority * 2
        + (e.type === "incident" ? 6 : 0)
        + (e.type === "nuclear" ? 4 : 0)
        + (e.type === "energy" ? 3 : 0)
        + (e.type === "protest" ? 3 : 0)
        + ((sourcesPerLabel[e.label]?.size || 1) > 1 ? 4 : 0) // multi-source bonus
        - (e.priority <= 1 ? 20 : 0) // heavy country-level penalty
        - (e.priority <= 3 ? 5 : 0), // moderate penalty for vague locations
    }));
    scored.sort((a, b) => b.score - a.score);

    // === LOCATION DIVERSITY: max 3 events per specific location, max 1 for country-level ===
    const locationCount: Record<string, number> = {};
    const diverse: typeof scored = [];
    for (const event of scored) {
      const locKey = event.label;
      const maxPerLoc = event.priority <= 1 ? 1 : event.priority <= 6 ? 2 : 3;
      locationCount[locKey] = (locationCount[locKey] || 0) + 1;
      if (locationCount[locKey] <= maxPerLoc) {
        diverse.push(event);
      }
    }

    // === FINAL: Max 30 events for comprehensive geographic coverage ===
    const final = diverse.slice(0, 30).map(({ score, priority, ...e }) => e);

    // === STATIC FEATURES: Permanent strategic points always visible on map ===
    const staticFeatures = [
      // ═══════════════════════════════════════════════════════════════
      // TEHRAN CITY — High-Value Targets & Key Infrastructure
      // ═══════════════════════════════════════════════════════════════
      { lat: 35.700, lon: 51.421, label: "Supreme Leader Compound (Beit Rahbari)", category: "hvt", icon: "target" },
      { lat: 35.688, lon: 51.418, label: "Iranian Parliament (Majles)", category: "hvt", icon: "target" },
      { lat: 35.754, lon: 51.417, label: "Ministry of Defense (MODAFL)", category: "hvt", icon: "target" },
      { lat: 35.694, lon: 51.417, label: "IRGC Sarallah HQ", category: "hvt", icon: "target" },
      { lat: 35.699, lon: 51.338, label: "Presidential Palace (Sa'dabad)", category: "hvt", icon: "target" },
      { lat: 35.716, lon: 51.424, label: "Ministry of Intelligence (VAJA)", category: "hvt", icon: "target" },
      { lat: 35.689, lon: 51.389, label: "Ministry of Foreign Affairs", category: "hvt", icon: "target" },
      { lat: 35.689, lon: 51.311, label: "Mehrabad Air Base / Airport", category: "military", icon: "base" },
      { lat: 35.60, lon: 51.45, label: "Tehran Oil Refinery (Shahr-e Rey)", category: "energy", icon: "oil" },
      { lat: 35.713, lon: 51.397, label: "Tehran University (Protest Hub)", category: "civil", icon: "protest" },
      { lat: 35.730, lon: 51.390, label: "Sharif University (Protest Hub)", category: "civil", icon: "protest" },
      { lat: 35.702, lon: 51.353, label: "Evin Prison (Political Prisoners)", category: "civil", icon: "prison" },
      { lat: 35.776, lon: 51.492, label: "Lavizan Tech Complex (suspected nuclear R&D)", category: "nuclear", icon: "nuclear" },
      { lat: 35.763, lon: 51.505, label: "IRGC Aerospace HQ (Bagheri)", category: "military", icon: "base" },
      { lat: 35.673, lon: 51.427, label: "Imam Khomeini Grand Mosallah (state events)", category: "landmark", icon: "landmark" },
      { lat: 35.752, lon: 51.263, label: "Shahid Beheshti Air Defense Base", category: "military", icon: "base" },

      // ═══════════════════════════════════════════════════════════════
      // NUCLEAR FACILITIES
      // ═══════════════════════════════════════════════════════════════
      { lat: 33.72, lon: 51.73, label: "Natanz Enrichment Facility (FEP)", category: "nuclear", icon: "nuclear" },
      { lat: 34.88, lon: 51.00, label: "Fordow Enrichment Facility (FFEP)", category: "nuclear", icon: "nuclear" },
      { lat: 32.58, lon: 51.68, label: "Isfahan Nuclear Tech Center (UCF)", category: "nuclear", icon: "nuclear" },
      { lat: 28.84, lon: 50.90, label: "Bushehr Nuclear Power Plant", category: "nuclear", icon: "nuclear" },
      { lat: 35.52, lon: 51.77, label: "Parchin Military Complex", category: "nuclear", icon: "nuclear" },
      { lat: 34.37, lon: 49.24, label: "Arak Heavy Water Reactor (IR-40)", category: "nuclear", icon: "nuclear" },
      { lat: 32.31, lon: 55.19, label: "Saghand Uranium Mine", category: "nuclear", icon: "nuclear" },
      { lat: 32.65, lon: 51.67, label: "Isfahan Zirconium Production Plant", category: "nuclear", icon: "nuclear" },

      // ═══════════════════════════════════════════════════════════════
      // OIL & ENERGY INFRASTRUCTURE — Iran
      // ═══════════════════════════════════════════════════════════════
      { lat: 29.23, lon: 50.32, label: "Kharg Island Oil Terminal (90% Iran exports)", category: "energy", icon: "oil" },
      { lat: 27.48, lon: 52.60, label: "South Pars / Assaluyeh Gas Complex", category: "energy", icon: "oil" },
      { lat: 26.80, lon: 53.36, label: "Lavan Island Oil Terminal", category: "energy", icon: "oil" },
      { lat: 25.90, lon: 54.53, label: "Sirri Island Oil Terminal", category: "energy", icon: "oil" },
      { lat: 30.35, lon: 48.30, label: "Abadan Oil Refinery", category: "energy", icon: "oil" },
      { lat: 30.43, lon: 49.07, label: "Bandar Imam Khomeini Petrochemical", category: "energy", icon: "oil" },
      { lat: 32.68, lon: 51.64, label: "Isfahan Oil Refinery", category: "energy", icon: "oil" },
      { lat: 27.19, lon: 56.23, label: "Bandar Abbas Oil Refinery", category: "energy", icon: "oil" },
      { lat: 25.30, lon: 60.64, label: "Chabahar Port (India-Iran corridor)", category: "energy", icon: "oil" },

      // ═══════════════════════════════════════════════════════════════
      // OIL & ENERGY INFRASTRUCTURE — Gulf States
      // ═══════════════════════════════════════════════════════════════
      { lat: 26.64, lon: 50.16, label: "Ras Tanura (Saudi Oil Terminal)", category: "energy", icon: "oil" },
      { lat: 25.94, lon: 49.68, label: "Abqaiq Processing (Aramco)", category: "energy", icon: "oil" },
      { lat: 25.12, lon: 56.33, label: "Fujairah Oil Terminal (UAE)", category: "energy", icon: "oil" },
      { lat: 25.05, lon: 55.06, label: "Jebel Ali Port (Dubai)", category: "energy", icon: "oil" },
      { lat: 26.12, lon: 50.09, label: "Bahrain Sitra Refinery", category: "energy", icon: "oil" },
      { lat: 29.34, lon: 47.97, label: "Mina al-Ahmadi (Kuwait Oil)", category: "energy", icon: "oil" },
      { lat: 21.42, lon: 39.17, label: "Yanbu Oil Terminal (Saudi Red Sea)", category: "energy", icon: "oil" },

      // ═══════════════════════════════════════════════════════════════
      // MILITARY BASES — US / Coalition
      // ═══════════════════════════════════════════════════════════════
      { lat: 25.12, lon: 51.32, label: "Al Udeid Air Base (CENTCOM FWD)", category: "military", icon: "base" },
      { lat: 24.25, lon: 54.55, label: "Al Dhafra Air Base (UAE)", category: "military", icon: "base" },
      { lat: 33.80, lon: 42.45, label: "Ain al-Asad Air Base (Iraq)", category: "military", icon: "base" },
      { lat: 26.23, lon: 50.59, label: "NSA Bahrain (US 5th Fleet HQ)", category: "military", icon: "base" },
      { lat: -7.32, lon: 72.42, label: "Diego Garcia (USAF B-2 staging)", category: "military", icon: "base" },
      { lat: 37.00, lon: 35.43, label: "Incirlik Air Base (Turkey)", category: "military", icon: "base" },
      { lat: 28.93, lon: 48.08, label: "Camp Arifjan (Kuwait)", category: "military", icon: "base" },
      { lat: 36.24, lon: 43.96, label: "Erbil (US/Kurd base, Iraq)", category: "military", icon: "base" },
      { lat: 24.06, lon: 47.58, label: "Prince Sultan Air Base (Saudi)", category: "military", icon: "base" },
      { lat: 11.55, lon: 43.16, label: "Camp Lemonnier (Djibouti)", category: "military", icon: "base" },
      { lat: 33.50, lon: 38.67, label: "Al-Tanf Garrison (Syria)", category: "military", icon: "base" },

      // ═══════════════════════════════════════════════════════════════
      // MILITARY BASES — Iran
      // ═══════════════════════════════════════════════════════════════
      { lat: 27.18, lon: 56.27, label: "Bandar Abbas Naval Base (IRIN HQ)", category: "military", icon: "base" },
      { lat: 25.64, lon: 57.77, label: "Jask Naval Base (Iran)", category: "military", icon: "base" },
      { lat: 25.35, lon: 60.38, label: "Konarak Naval Base (Iran)", category: "military", icon: "base" },
      { lat: 32.43, lon: 48.38, label: "Dezful / Vahdati Air Base", category: "military", icon: "base" },
      { lat: 30.74, lon: 49.19, label: "Omidiyeh Air Base (Khuzestan)", category: "military", icon: "base" },
      { lat: 29.54, lon: 52.59, label: "Shiraz Air Base (TAB 6)", category: "military", icon: "base" },
      { lat: 36.21, lon: 57.65, label: "Mashhad Air Base (TAB 12)", category: "military", icon: "base" },
      { lat: 27.03, lon: 50.07, label: "Farsi Island (IRGCN base)", category: "military", icon: "base" },

      // ═══════════════════════════════════════════════════════════════
      // MILITARY BASES — Israel
      // ═══════════════════════════════════════════════════════════════
      { lat: 31.29, lon: 34.27, label: "Nevatim Air Base (F-35I)", category: "military", icon: "base" },
      { lat: 30.62, lon: 34.67, label: "Ramon Air Base (IAF)", category: "military", icon: "base" },
      { lat: 31.07, lon: 35.14, label: "Dimona (Israel Nuclear)", category: "nuclear", icon: "nuclear" },

      // ═══════════════════════════════════════════════════════════════
      // CHOKEPOINTS & STRATEGIC WATERWAYS
      // ═══════════════════════════════════════════════════════════════
      { lat: 26.57, lon: 56.25, label: "Strait of Hormuz", category: "chokepoint", icon: "chokepoint" },
      { lat: 12.58, lon: 43.33, label: "Bab el-Mandeb Strait", category: "chokepoint", icon: "chokepoint" },
      { lat: 30.46, lon: 32.35, label: "Suez Canal", category: "chokepoint", icon: "chokepoint" },

      // ═══════════════════════════════════════════════════════════════
      // STRATEGIC ISLANDS — Persian Gulf
      // ═══════════════════════════════════════════════════════════════
      { lat: 26.85, lon: 55.90, label: "Qeshm Island (IRGCN staging)", category: "military", icon: "base" },
      { lat: 25.87, lon: 55.03, label: "Abu Musa Island (disputed)", category: "military", icon: "base" },
      { lat: 26.27, lon: 55.28, label: "Tunb Islands (disputed)", category: "military", icon: "base" },
      { lat: 26.85, lon: 56.35, label: "Larak Island (IRGCN)", category: "military", icon: "base" },

      // ═══════════════════════════════════════════════════════════════
      // MISSILE BASES — Iran
      // ═══════════════════════════════════════════════════════════════
      { lat: 36.43, lon: 55.00, label: "Shahrud Missile Test Site", category: "missile", icon: "missile" },
      { lat: 35.23, lon: 53.92, label: "Semnan Space/Missile Center", category: "missile", icon: "missile" },
      { lat: 38.08, lon: 46.29, label: "Tabriz Missile Garrison", category: "missile", icon: "missile" },
      { lat: 33.49, lon: 48.36, label: "Imam Ali Missile Base (Khorramabad)", category: "missile", icon: "missile" },
      { lat: 34.85, lon: 48.52, label: "Haj Ahmad Underground Missile Base", category: "missile", icon: "missile" },
      { lat: 33.90, lon: 51.42, label: "Bid Ganeh (IRGC Missile Depot)", category: "missile", icon: "missile" },

      // ═══════════════════════════════════════════════════════════════
      // PROXY / MILITIA HQs
      // ═══════════════════════════════════════════════════════════════
      { lat: 33.84, lon: 35.50, label: "Dahieh (Hezbollah HQ, Beirut)", category: "proxy", icon: "militia" },
      { lat: 34.01, lon: 36.21, label: "Baalbek (Hezbollah, Bekaa)", category: "proxy", icon: "militia" },
      { lat: 33.31, lon: 44.37, label: "Baghdad (PMF / Kataib Hezbollah)", category: "proxy", icon: "militia" },
      { lat: 15.37, lon: 44.19, label: "Sanaa (Ansar Allah / Houthi HQ)", category: "proxy", icon: "militia" },
      { lat: 16.94, lon: 43.76, label: "Saada (Houthi Stronghold)", category: "proxy", icon: "militia" },
      { lat: 35.34, lon: 40.14, label: "Deir ez-Zor (Iran Corridor, Syria)", category: "proxy", icon: "militia" },
      { lat: 34.45, lon: 40.92, label: "Abu Kamal (Iran-Iraq-Syria corridor)", category: "proxy", icon: "militia" },

      // ═══════════════════════════════════════════════════════════════
      // KEY CITIES — Regional Capitals & Strategic Centers
      // ═══════════════════════════════════════════════════════════════
      { lat: 32.65, lon: 51.67, label: "Isfahan", category: "city", icon: "city" },
      { lat: 29.59, lon: 52.58, label: "Shiraz", category: "city", icon: "city" },
      { lat: 36.30, lon: 59.61, label: "Mashhad", category: "city", icon: "city" },
      { lat: 31.32, lon: 48.67, label: "Ahvaz (Khuzestan capital)", category: "city", icon: "city" },
      { lat: 34.64, lon: 50.88, label: "Qom (religious center)", category: "city", icon: "city" },
      { lat: 30.44, lon: 48.17, label: "Khorramshahr (border city)", category: "city", icon: "city" },
    ];

    return corsResponse({
      events: final,
      staticFeatures,
      chokepoints,
      weatherSummary,
      weatherAlerts,
      flightActivity,
      conflictZones,
      headAnalystContext,
      total: final.length,
      candidatesConsidered: candidates.length,
      uniqueLocations: new Set(final.map(e => e.label)).size,
      uniqueSources: new Set(final.map(e => e.source)).size,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/signal-timeline?hours=24
export async function apiSignalTimeline(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "24");
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const rows = await env.DB.prepare(
      `SELECT id, agent_name, summary, threat_level, created_at
       FROM agent_reports WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50`
    ).bind(cutoff).all<Record<string, unknown>>();
    return corsResponse({ timeline: rows.results });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/calibration?metric=hormuzClosure&days=7
export async function apiCalibration(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const metric = url.searchParams.get("metric");
    const days = parseInt(url.searchParams.get("days") || "7");
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    let rows;
    if (metric) {
      rows = await env.DB.prepare(
        `SELECT id, metric, our_estimate, market_price, agent_count, created_at
         FROM prediction_log WHERE metric = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 500`
      ).bind(metric, cutoff).all<Record<string, unknown>>();
    } else {
      // Return all metrics if none specified
      rows = await env.DB.prepare(
        `SELECT id, metric, our_estimate, market_price, agent_count, created_at
         FROM prediction_log WHERE created_at >= ? ORDER BY created_at DESC LIMIT 500`
      ).bind(cutoff).all<Record<string, unknown>>();
    }

    // Compute basic calibration stats per metric
    const byMetric: Record<string, Array<Record<string, unknown>>> = {};
    for (const r of rows.results) {
      const m = r.metric as string;
      if (!byMetric[m]) byMetric[m] = [];
      byMetric[m].push(r);
    }

    const stats: Record<string, { count: number; avgEstimate: number; avgMarketPrice: number | null; avgDivergence: number | null; latest: Record<string, unknown> | null }> = {};
    for (const [m, entries] of Object.entries(byMetric)) {
      const estimates = entries.map(e => e.our_estimate as number);
      const marketPrices = entries.filter(e => e.market_price != null).map(e => e.market_price as number);
      const avgEst = estimates.reduce((a, b) => a + b, 0) / estimates.length;
      const avgMkt = marketPrices.length > 0 ? marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length : null;
      const avgDiv = avgMkt != null ? Math.round((avgEst - avgMkt) * 100) / 100 : null;
      stats[m] = {
        count: entries.length,
        avgEstimate: Math.round(avgEst * 100) / 100,
        avgMarketPrice: avgMkt != null ? Math.round(avgMkt * 100) / 100 : null,
        avgDivergence: avgDiv,
        latest: entries[0] || null,
      };
    }

    return corsResponse({ predictions: rows.results, stats, days, metric: metric || "all" });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/trajectories?hours=168 — CUSUM + trajectory classification from historical data
export async function apiTrajectories(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "168"); // default 7 days
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Fetch threat assessments for the window (oldest first for time series)
    const taRows = await env.DB.prepare(
      `SELECT tension_index, hormuz_closure, cyber_attack, proxy_escalation, direct_confrontation, created_at
       FROM threat_assessments WHERE created_at >= ? ORDER BY created_at ASC LIMIT 500`
    ).bind(cutoff).all<{
      tension_index: number; hormuz_closure: number; cyber_attack: number;
      proxy_escalation: number; direct_confrontation: number; created_at: string;
    }>();

    const ta = taRows.results;
    const tensionValues = ta.map(r => r.tension_index);
    const hormuzValues = ta.map(r => r.hormuz_closure);
    const cyberValues = ta.map(r => r.cyber_attack);
    const proxyValues = ta.map(r => r.proxy_escalation);
    const directValues = ta.map(r => r.direct_confrontation);

    // CUSUM on tension_index
    const cusum: CUSUMResult = detectCUSUM(tensionValues);

    // Trajectory classification for each metric
    const trajectories: Record<string, TrajectoryResult> = {
      tensionIndex: classifyTrajectory(tensionValues),
      hormuzClosure: classifyTrajectory(hormuzValues),
      cyberAttack: classifyTrajectory(cyberValues),
      proxyEscalation: classifyTrajectory(proxyValues),
      directConfrontation: classifyTrajectory(directValues),
    };

    // Country CII trajectories
    const csRows = await env.DB.prepare(
      `SELECT country_code, cii_score FROM country_scores
       WHERE created_at >= ? ORDER BY created_at ASC LIMIT 1000`
    ).bind(cutoff).all<{ country_code: string; cii_score: number }>();

    const byCountry: Record<string, number[]> = {};
    for (const r of csRows.results) {
      if (!byCountry[r.country_code]) byCountry[r.country_code] = [];
      byCountry[r.country_code].push(r.cii_score);
    }

    const countryTrajectories: Record<string, TrajectoryResult> = {};
    for (const [code, vals] of Object.entries(byCountry)) {
      countryTrajectories[code] = classifyTrajectory(vals);
    }

    // Holt-Winters forecasts for tension index
    const hwResult = holtWinters(tensionValues, { seasonLength: Math.min(24, Math.max(4, Math.floor(tensionValues.length / 3))), forecastHorizon: 24 });
    const forecast = ensembleForecast(tensionValues, cusum, hwResult.forecasts);

    return corsResponse({
      cusum,
      trajectories,
      countryTrajectories,
      forecasts: {
        hw: hwResult.forecasts.slice(0, 24),
        ensemble: forecast.ensemble.slice(0, 24),
        method: forecast.method,
        weights: forecast.weights,
      },
      dataPoints: ta.length,
      windowHours: hours,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/anomalies — Z-Score anomaly detection across all signals
export async function apiAnomalies(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "48");
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const taRows = await env.DB.prepare(
      `SELECT tension_index, hormuz_closure, cyber_attack, proxy_escalation, direct_confrontation, created_at
       FROM threat_assessments WHERE created_at >= ? ORDER BY created_at ASC LIMIT 500`
    ).bind(cutoff).all<{
      tension_index: number; hormuz_closure: number; cyber_attack: number;
      proxy_escalation: number; direct_confrontation: number; created_at: string;
    }>();

    const ta = taRows.results;
    const signals: Record<string, number[]> = {
      tensionIndex: ta.map(r => r.tension_index),
      hormuzClosure: ta.map(r => r.hormuz_closure),
      cyberAttack: ta.map(r => r.cyber_attack),
      proxyEscalation: ta.map(r => r.proxy_escalation),
      directConfrontation: ta.map(r => r.direct_confrontation),
    };

    const anomaly = compoundAnomalyScore(signals);

    return corsResponse({
      ...anomaly,
      dataPoints: ta.length,
      windowHours: hours,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// GET /api/pattern-match — DTW pattern matching against historical crises
export async function apiPatternMatch(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "168");
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    const taRows = await env.DB.prepare(
      `SELECT tension_index, created_at FROM threat_assessments WHERE created_at >= ? ORDER BY created_at ASC LIMIT 500`
    ).bind(cutoff).all<{ tension_index: number; created_at: string }>();

    const tensionValues = taRows.results.map(r => r.tension_index);
    const matches = matchPatterns(tensionValues);

    return corsResponse({
      matches,
      templates: CRISIS_TEMPLATES.map(t => ({ name: t.name, description: t.description, year: t.year, phases: t.phases })),
      dataPoints: tensionValues.length,
      windowHours: hours,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}

// POST /api/run-cycle — trigger all collection agents, then head-analyst + thinktank
// Uses waitUntil to run agents in background so the response returns immediately
const COLLECTION_AGENTS: [string, (req: Request, env: Env) => Promise<Response>][] = [
  ["flights", agentFlights],
  ["naval", agentNaval],
  ["ais", agentAis],
  ["osint", agentOsint],
  ["reddit", agentReddit],
  ["pentagon", agentPentagon],
  ["cyber", agentCyber],
  ["markets", agentMarkets],
  ["wiki", agentWiki],
  ["macro", agentMacro],
  ["fires", agentFires],
  ["pizza", agentPizza],
  ["acled", agentAcled],
  ["telegram", agentTelegram],
  ["metaculus", agentMetaculus],
  ["weather", agentWeather],
  ["isw", agentIsw],
];

export async function apiRunCycle(req: Request, env: Env): Promise<Response> {
  const dummyReq = new Request("https://meridian-api.dieter-meier82.workers.dev/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const started = Date.now();
  const results: { agent: string; success: boolean; ms: number }[] = [];

  // Run collection agents in 3 parallel batches to stay within CF limits
  const batches = [];
  for (let i = 0; i < COLLECTION_AGENTS.length; i += 5) {
    batches.push(COLLECTION_AGENTS.slice(i, i + 5));
  }

  for (const batch of batches) {
    const batchResults = await Promise.allSettled(
      batch.map(async ([name, handler]) => {
        const t = Date.now();
        try {
          const resp = await handler(dummyReq.clone(), env);
          const ok = resp.status === 200;
          results.push({ agent: name, success: ok, ms: Date.now() - t });
        } catch {
          results.push({ agent: name, success: false, ms: Date.now() - t });
        }
      })
    );
  }

  const totalMs = Date.now() - started;
  const successCount = results.filter(r => r.success).length;

  return corsResponse({
    success: true,
    totalAgents: results.length,
    successCount,
    totalMs,
    results,
  });
}

// POST /api/run-synthesis — trigger head-analyst + thinktank (separate from collection to avoid subrequest limit)
export async function apiRunSynthesis(_req: Request, env: Env): Promise<Response> {
  const dummyReq = new Request("https://meridian-api.dieter-meier82.workers.dev/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  const started = Date.now();
  const results: { agent: string; success: boolean; ms: number }[] = [];

  for (const [name, handler] of [["head-analyst", agentHeadAnalyst], ["thinktank", agentThinkTank]] as [string, (req: Request, env: Env) => Promise<Response>][]) {
    const t = Date.now();
    try {
      const resp = await handler(dummyReq.clone(), env);
      const body = await resp.clone().text();
      const isSuccess = resp.status === 200 && body.includes('"success"');
      results.push({ agent: name, success: isSuccess, ms: Date.now() - t });
    } catch {
      results.push({ agent: name, success: false, ms: Date.now() - t });
    }
  }

  return corsResponse({
    success: true,
    totalAgents: results.length,
    successCount: results.filter(r => r.success).length,
    totalMs: Date.now() - started,
    results,
  });
}
