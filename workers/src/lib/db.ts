/**
 * D1 Database helpers — ersetzt Supabase
 */

function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 3)
  );
}

/**
 * Compute corroboration score for a report by checking overlap with recent reports from OTHER agents.
 * Score: 1 = single source, 2-5 = multiple independent confirmations.
 */
export async function computeCorroboration(
  db: D1Database,
  agentName: string,
  summary: string,
  reportId: number
): Promise<number> {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const otherReports = await db.prepare(
    `SELECT id, agent_name, summary FROM agent_reports
     WHERE agent_name != ? AND created_at >= ? AND summary IS NOT NULL
     ORDER BY created_at DESC LIMIT 50`
  ).bind(agentName, cutoff).all<{ id: number; agent_name: string; summary: string }>();

  if (!otherReports.results?.length) return 1;

  const myTokens = tokenize(summary);
  let matchingAgents = 0;

  for (const other of otherReports.results) {
    const otherTokens = tokenize(other.summary || "");
    const similarity = jaccardSimilarity(myTokens, otherTokens);
    if (similarity > 0.15) {
      matchingAgents++;
    }
  }

  return Math.min(5, 1 + matchingAgents);
}

export interface AgentReport {
  id?: number;
  agent_name: string;
  report_type: string;
  data: Record<string, unknown>;
  summary: string;
  threat_level: number;
  confidence: string;
  items_count: number;
  created_at?: string;
}

export interface ThreatAssessment {
  id?: number;
  tension_index: number;
  watchcon: string;
  hormuz_closure: number;
  cyber_attack: number;
  proxy_escalation: number;
  direct_confrontation: number;
  analysis_narrative: string;
  market_divergences: string[];
  raw_indicators: Record<string, unknown>;
  created_at?: string;
}

export interface CountryScore {
  country_code: string;
  country_name: string;
  cii_score: number;
  signal_breakdown: Record<string, unknown>;
  trend_24h: number;
  trend_7d: number;
}

export async function insertAgentReport(db: D1Database, report: Omit<AgentReport, "id" | "created_at">): Promise<void> {
  // If this report has 0 items but a recent report with data exists, skip writing
  // to avoid overwriting good data when external sources are temporarily down.
  if (report.items_count === 0 && report.threat_level === 0) {
    const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const existing = await db.prepare(
      `SELECT id FROM agent_reports WHERE agent_name = ? AND items_count > 0 AND created_at >= ? LIMIT 1`
    ).bind(report.agent_name, cutoff).first<{ id: number }>();
    if (existing) {
      console.log(`[${report.agent_name}] Skipping empty report — recent good data exists (id=${existing.id})`);
      return; // Don't overwrite good data with empty report
    }
  }

  await db.prepare(
    `INSERT INTO agent_reports (agent_name, report_type, data, summary, threat_level, confidence, items_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    report.agent_name,
    report.report_type,
    JSON.stringify(report.data),
    report.summary,
    report.threat_level,
    report.confidence,
    report.items_count,
    new Date().toISOString()
  ).run();

  // Compute corroboration score
  try {
    const inserted = await db.prepare(
      `SELECT id FROM agent_reports WHERE agent_name = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(report.agent_name).first<{ id: number }>();
    if (inserted && report.summary) {
      const score = await computeCorroboration(db, report.agent_name, report.summary, inserted.id);
      if (score > 1) {
        await db.prepare(
          `UPDATE agent_reports SET corroboration_score = ? WHERE id = ?`
        ).bind(score, inserted.id).run();
      }
    }
  } catch { /* corroboration is optional */ }

  // Extract and store entities
  try {
    const { extractEntities, extractRelations, storeEntities } = await import("./entities");
    const inserted = await db.prepare(
      `SELECT id FROM agent_reports WHERE agent_name = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(report.agent_name).first<{ id: number }>();
    if (inserted && report.summary) {
      const textToAnalyze = report.summary + " " + JSON.stringify(report.data).slice(0, 2000);
      const entities = extractEntities(textToAnalyze);
      if (entities.length > 0) {
        const relations = extractRelations(entities);
        await storeEntities(db, inserted.id, entities, relations);
      }
    }
  } catch { /* entity extraction is optional */ }
}

export async function getLatestAgentReport(db: D1Database, agentName: string, cutoffIso: string): Promise<AgentReport | null> {
  const row = await db.prepare(
    `SELECT * FROM agent_reports WHERE agent_name = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1`
  ).bind(agentName, cutoffIso).first<Record<string, unknown>>();
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data as string) } as AgentReport;
}

export async function insertThreatAssessment(db: D1Database, a: Omit<ThreatAssessment, "id" | "created_at">): Promise<void> {
  await db.prepare(
    `INSERT INTO threat_assessments
     (tension_index, watchcon, hormuz_closure, cyber_attack, proxy_escalation, direct_confrontation, analysis_narrative, market_divergences, raw_indicators, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    a.tension_index, a.watchcon, a.hormuz_closure, a.cyber_attack,
    a.proxy_escalation, a.direct_confrontation, a.analysis_narrative,
    JSON.stringify(a.market_divergences), JSON.stringify(a.raw_indicators),
    new Date().toISOString()
  ).run();
}

export async function insertCountryScores(db: D1Database, scores: CountryScore[]): Promise<void> {
  const now = new Date().toISOString();
  for (const s of scores) {
    await db.prepare(
      `INSERT INTO country_scores (country_code, country_name, cii_score, signal_breakdown, trend_24h, trend_7d, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(s.country_code, s.country_name, s.cii_score, JSON.stringify(s.signal_breakdown), s.trend_24h, s.trend_7d, now).run();
  }
}

export async function insertIntelSnapshot(db: D1Database, data: Record<string, unknown>): Promise<void> {
  await db.prepare(`INSERT INTO intel_snapshots (data, created_at) VALUES (?, ?)`)
    .bind(JSON.stringify(data), new Date().toISOString()).run();
}

export async function insertMarketSnapshot(db: D1Database, data: Record<string, unknown>): Promise<void> {
  await db.prepare(`INSERT INTO market_snapshots (data, created_at) VALUES (?, ?)`)
    .bind(JSON.stringify(data), new Date().toISOString()).run();
}

export interface PredictionLogEntry {
  id?: number;
  metric: string;
  our_estimate: number;
  market_price: number | null;
  agent_count: number;
  created_at?: string;
}

export async function insertPredictionLog(
  db: D1Database,
  metric: string,
  ourEstimate: number,
  marketPrice: number | null,
  agentCount: number
): Promise<void> {
  await db.prepare(
    `INSERT INTO prediction_log (metric, our_estimate, market_price, agent_count, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(metric, ourEstimate, marketPrice, agentCount, new Date().toISOString()).run();
}

/**
 * If an agent fetched 0 items (all sources down), serve the last good report
 * from D1 instead of writing a new empty report. Returns null if no stale report
 * is available or if the stale report is also 0.
 */
export async function getStaleReport(db: D1Database, agentName: string, maxAgeHours = 12): Promise<AgentReport | null> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
  const row = await db.prepare(
    `SELECT * FROM agent_reports WHERE agent_name = ? AND items_count > 0 AND created_at >= ? ORDER BY created_at DESC LIMIT 1`
  ).bind(agentName, cutoff).first<Record<string, unknown>>();
  if (!row) return null;
  return { ...row, data: JSON.parse(row.data as string) } as AgentReport;
}
