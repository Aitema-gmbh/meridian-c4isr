
-- ============================================
-- MERIDIAN v3: Baseline Anomaly Detection + Country Instability Index
-- ============================================

-- Table: agent_baselines (Welford's online algorithm for rolling stats)
CREATE TABLE public.agent_baselines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  hour_of_day INTEGER NOT NULL CHECK (hour_of_day >= 0 AND hour_of_day <= 23),
  mean NUMERIC NOT NULL DEFAULT 0,
  variance NUMERIC NOT NULL DEFAULT 0,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_name, metric_name, day_of_week, hour_of_day)
);

ALTER TABLE public.agent_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on agent_baselines"
  ON public.agent_baselines FOR SELECT
  USING (true);

-- Table: country_scores (Country Instability Index)
CREATE TABLE public.country_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  cii_score NUMERIC NOT NULL DEFAULT 0,
  signal_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  trend_24h NUMERIC DEFAULT 0,
  trend_7d NUMERIC DEFAULT 0
);

ALTER TABLE public.country_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on country_scores"
  ON public.country_scores FOR SELECT
  USING (true);

-- Index for fast lookups
CREATE INDEX idx_agent_baselines_lookup ON public.agent_baselines (agent_name, metric_name, day_of_week, hour_of_day);
CREATE INDEX idx_country_scores_country ON public.country_scores (country_code, created_at DESC);
CREATE INDEX idx_country_scores_time ON public.country_scores (created_at DESC);
