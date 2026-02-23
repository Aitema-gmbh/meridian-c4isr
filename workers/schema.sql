CREATE TABLE IF NOT EXISTS agent_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_name TEXT NOT NULL,
  report_type TEXT DEFAULT 'cycle',
  data TEXT NOT NULL,
  summary TEXT,
  threat_level INTEGER DEFAULT 0,
  confidence TEXT DEFAULT 'MEDIUM',
  items_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS threat_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tension_index REAL,
  watchcon TEXT,
  hormuz_closure REAL,
  cyber_attack REAL,
  proxy_escalation REAL,
  direct_confrontation REAL,
  analysis_narrative TEXT,
  market_divergences TEXT,
  raw_indicators TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS country_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT,
  country_name TEXT,
  cii_score REAL,
  signal_breakdown TEXT,
  trend_24h REAL DEFAULT 0,
  trend_7d REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS intel_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS prediction_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric TEXT NOT NULL, -- 'hormuzClosure', 'cyberAttack', etc.
  our_estimate REAL NOT NULL, -- our probability 0-100
  market_price REAL, -- Polymarket price 0-100 (null if unavailable)
  agent_count INTEGER, -- how many agents contributed
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_reports_name_time ON agent_reports(agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_threat_assessments_time ON threat_assessments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_country_scores_time ON country_scores(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prediction_log_metric ON prediction_log(metric, created_at DESC);

-- v5.0: Corroboration scoring (E2)
-- ALTER TABLE agent_reports ADD COLUMN corroboration_score REAL DEFAULT NULL;
-- (run as separate migration since ALTER TABLE cannot be in IF NOT EXISTS)

-- v5.0: Entity Resolution / Knowledge Graph (E7)
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_name TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  aliases TEXT,
  group_tag TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER REFERENCES entities(id),
  report_id INTEGER REFERENCES agent_reports(id),
  context_snippet TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_entity_id INTEGER REFERENCES entities(id),
  target_entity_id INTEGER REFERENCES entities(id),
  relation_type TEXT,
  strength REAL DEFAULT 1,
  report_id INTEGER REFERENCES agent_reports(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_report ON entity_mentions(report_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_source ON entity_relations(source_entity_id);

-- v5.0: Auto-Updating Briefings (E8)
CREATE TABLE IF NOT EXISTS briefings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  briefing_type TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  period_start TEXT,
  period_end TEXT,
  data_sources TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_briefings_type ON briefings(briefing_type, created_at DESC);
