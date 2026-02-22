
-- Enable required extensions for cron
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Table 1: intel_snapshots
CREATE TABLE public.intel_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  flash_report TEXT,
  article_count INTEGER DEFAULT 0,
  mil_track_count INTEGER DEFAULT 0,
  average_sentiment NUMERIC DEFAULT 0,
  dominant_category TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  source_type TEXT DEFAULT 'combined'
);
ALTER TABLE public.intel_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on intel_snapshots" ON public.intel_snapshots FOR SELECT USING (true);

-- Table 2: market_snapshots
CREATE TABLE public.market_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  markets JSONB DEFAULT '[]'::jsonb
);
ALTER TABLE public.market_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on market_snapshots" ON public.market_snapshots FOR SELECT USING (true);

-- Table 3: threat_assessments
CREATE TABLE public.threat_assessments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  tension_index NUMERIC DEFAULT 0,
  watchcon TEXT DEFAULT '3',
  hormuz_closure NUMERIC DEFAULT 0,
  cyber_attack NUMERIC DEFAULT 0,
  proxy_escalation NUMERIC DEFAULT 0,
  direct_confrontation NUMERIC DEFAULT 0,
  analysis_narrative TEXT,
  market_divergences JSONB DEFAULT '[]'::jsonb,
  raw_indicators JSONB DEFAULT '{}'::jsonb
);
ALTER TABLE public.threat_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read on threat_assessments" ON public.threat_assessments FOR SELECT USING (true);

-- Indexes for recent data queries
CREATE INDEX idx_intel_snapshots_created ON public.intel_snapshots(created_at DESC);
CREATE INDEX idx_market_snapshots_created ON public.market_snapshots(created_at DESC);
CREATE INDEX idx_threat_assessments_created ON public.threat_assessments(created_at DESC);
