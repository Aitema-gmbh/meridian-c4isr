/**
 * Entity API — serves entity graph data to the frontend.
 */
import { corsError, corsResponse } from "../lib/cors";
import type { Env } from "../lib/anthropic";

// GET /api/entities — entity graph (nodes + relations + mention counts)
export async function apiEntities(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url);
    const hours = parseInt(url.searchParams.get("hours") || "48");
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // Get entities with mention counts
    const entities = await env.DB.prepare(`
      SELECT e.id, e.canonical_name, e.entity_type, e.group_tag, e.aliases,
             COUNT(em.id) as mention_count
      FROM entities e
      LEFT JOIN entity_mentions em ON em.entity_id = e.id AND em.created_at >= ?
      GROUP BY e.id
      HAVING mention_count > 0
      ORDER BY mention_count DESC
      LIMIT 50
    `).bind(cutoff).all<{
      id: number; canonical_name: string; entity_type: string; group_tag: string;
      aliases: string; mention_count: number;
    }>();

    // Get relations
    const relations = await env.DB.prepare(`
      SELECT er.source_entity_id, er.target_entity_id, er.relation_type,
             SUM(er.strength) as total_strength, COUNT(er.id) as occurrence_count
      FROM entity_relations er
      WHERE er.created_at >= ?
      GROUP BY er.source_entity_id, er.target_entity_id
      ORDER BY total_strength DESC
      LIMIT 200
    `).bind(cutoff).all<{
      source_entity_id: number; target_entity_id: number; relation_type: string;
      total_strength: number; occurrence_count: number;
    }>();

    // Build graph format
    const nodes = entities.results.map(e => ({
      id: e.id,
      label: e.canonical_name,
      type: e.entity_type,
      group: e.group_tag,
      mentions: e.mention_count,
      val: Math.min(25, 6 + e.mention_count * 2),
    }));

    const nodeIds = new Set(nodes.map(n => n.id));
    const links = relations.results
      .filter(r => nodeIds.has(r.source_entity_id) && nodeIds.has(r.target_entity_id))
      .map(r => ({
        source: r.source_entity_id,
        target: r.target_entity_id,
        type: r.relation_type,
        strength: r.total_strength,
        count: r.occurrence_count,
      }));

    return corsResponse({
      nodes,
      links,
      totalEntities: entities.results.length,
      totalRelations: links.length,
      windowHours: hours,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return corsError(e instanceof Error ? e.message : "Unknown");
  }
}
