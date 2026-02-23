/**
 * Entity Resolution + Knowledge Graph extraction.
 * Keyword-based entity extraction with alias normalization.
 */

interface EntityDef {
  canonical: string;
  type: "person" | "organization" | "location" | "weapon" | "event";
  aliases: string[];
  group: string;
}

const ENTITY_DICTIONARY: EntityDef[] = [
  // Persons
  { canonical: "Ali Khamenei", type: "person", aliases: ["khamenei", "supreme leader"], group: "iran_leadership" },
  { canonical: "Masoud Pezeshkian", type: "person", aliases: ["pezeshkian"], group: "iran_leadership" },
  { canonical: "Ali Larijani", type: "person", aliases: ["larijani"], group: "iran_leadership" },
  { canonical: "Donald Trump", type: "person", aliases: ["trump"], group: "us_leadership" },
  { canonical: "Benjamin Netanyahu", type: "person", aliases: ["netanyahu", "bibi"], group: "israel_leadership" },
  // Organizations
  { canonical: "IRGC", type: "organization", aliases: ["irgc", "irgcn", "islamic revolutionary guard", "revolutionary guard", "sepah", "pasdaran"], group: "iran_military" },
  { canonical: "Hezbollah", type: "organization", aliases: ["hezbollah", "hizballah"], group: "proxy" },
  { canonical: "Houthis", type: "organization", aliases: ["houthi", "houthis", "ansar allah"], group: "proxy" },
  { canonical: "Hamas", type: "organization", aliases: ["hamas"], group: "proxy" },
  { canonical: "PMF", type: "organization", aliases: ["pmf", "hashd", "popular mobilization"], group: "proxy" },
  { canonical: "CENTCOM", type: "organization", aliases: ["centcom", "central command"], group: "us_military" },
  { canonical: "Pentagon", type: "organization", aliases: ["pentagon", "department of defense", "dod"], group: "us_military" },
  { canonical: "IAEA", type: "organization", aliases: ["iaea", "international atomic energy"], group: "international" },
  { canonical: "US Navy", type: "organization", aliases: ["us navy", "5th fleet", "navcent"], group: "us_military" },
  { canonical: "IDF", type: "organization", aliases: ["idf", "israel defense forces"], group: "israel_military" },
  // Locations
  { canonical: "Strait of Hormuz", type: "location", aliases: ["hormuz", "strait of hormuz", "hormoz"], group: "chokepoint" },
  { canonical: "Bab el-Mandeb", type: "location", aliases: ["bab el-mandeb", "bab al-mandab", "mandeb"], group: "chokepoint" },
  { canonical: "Suez Canal", type: "location", aliases: ["suez", "suez canal"], group: "chokepoint" },
  { canonical: "Fordow", type: "location", aliases: ["fordow"], group: "nuclear_site" },
  { canonical: "Natanz", type: "location", aliases: ["natanz"], group: "nuclear_site" },
  { canonical: "Tehran", type: "location", aliases: ["tehran"], group: "capital" },
  // Weapons/Systems
  { canonical: "Shahed Drone", type: "weapon", aliases: ["shahed", "shahed-136", "shahed drone"], group: "weapon" },
  { canonical: "Ballistic Missile", type: "weapon", aliases: ["ballistic missile", "emad", "shahab", "khorramshahr"], group: "weapon" },
  { canonical: "B-2 Spirit", type: "weapon", aliases: ["b-2", "b-2 spirit", "stealth bomber"], group: "weapon" },
];

export interface ExtractedEntity {
  canonical: string;
  type: string;
  group: string;
  mentions: number;
  contextSnippet: string;
}

export interface EntityRelation {
  source: string;
  target: string;
  relationType: string;
  strength: number;
}

/**
 * Extract entities from text using keyword dictionary + alias resolution.
 */
export function extractEntities(text: string): ExtractedEntity[] {
  const lower = text.toLowerCase();
  const found: ExtractedEntity[] = [];

  for (const entity of ENTITY_DICTIONARY) {
    let mentions = 0;
    let contextSnippet = "";
    for (const alias of entity.aliases) {
      const idx = lower.indexOf(alias);
      if (idx >= 0) {
        mentions++;
        if (!contextSnippet) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(text.length, idx + alias.length + 30);
          contextSnippet = text.slice(start, end).trim();
        }
      }
    }
    if (mentions > 0) {
      found.push({
        canonical: entity.canonical,
        type: entity.type,
        group: entity.group,
        mentions,
        contextSnippet,
      });
    }
  }

  return found;
}

/**
 * Extract co-occurrence relations from entity pairs found in the same text.
 */
export function extractRelations(entities: ExtractedEntity[]): EntityRelation[] {
  const relations: EntityRelation[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      relations.push({
        source: entities[i].canonical,
        target: entities[j].canonical,
        relationType: "co-occurrence",
        strength: Math.min(entities[i].mentions, entities[j].mentions),
      });
    }
  }
  return relations;
}

/**
 * Store extracted entities and relations in D1.
 */
export async function storeEntities(
  db: D1Database,
  reportId: number,
  entities: ExtractedEntity[],
  relations: EntityRelation[]
): Promise<void> {
  const now = new Date().toISOString();
  const entityIdMap: Record<string, number> = {};

  for (const entity of entities) {
    // Upsert entity
    let row = await db.prepare(
      `SELECT id FROM entities WHERE canonical_name = ?`
    ).bind(entity.canonical).first<{ id: number }>();

    if (!row) {
      await db.prepare(
        `INSERT INTO entities (canonical_name, entity_type, aliases, group_tag, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        entity.canonical,
        entity.type,
        ENTITY_DICTIONARY.find(d => d.canonical === entity.canonical)?.aliases.join(",") || "",
        entity.group,
        now
      ).run();
      row = await db.prepare(
        `SELECT id FROM entities WHERE canonical_name = ?`
      ).bind(entity.canonical).first<{ id: number }>();
    }

    if (row) {
      entityIdMap[entity.canonical] = row.id;
      // Insert mention
      await db.prepare(
        `INSERT INTO entity_mentions (entity_id, report_id, context_snippet, created_at)
         VALUES (?, ?, ?, ?)`
      ).bind(row.id, reportId, entity.contextSnippet.slice(0, 200), now).run();
    }
  }

  // Store relations
  for (const rel of relations) {
    const sourceId = entityIdMap[rel.source];
    const targetId = entityIdMap[rel.target];
    if (sourceId && targetId) {
      await db.prepare(
        `INSERT INTO entity_relations (source_entity_id, target_entity_id, relation_type, strength, report_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(sourceId, targetId, rel.relationType, rel.strength, reportId, now).run();
    }
  }
}
