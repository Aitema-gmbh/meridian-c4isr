
-- Create agent_reports table
CREATE TABLE public.agent_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  agent_name TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'cycle',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  threat_level NUMERIC DEFAULT 0,
  confidence TEXT DEFAULT 'MEDIUM',
  items_count INTEGER DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.agent_reports ENABLE ROW LEVEL SECURITY;

-- Public read policy
CREATE POLICY "Allow public read on agent_reports"
  ON public.agent_reports
  FOR SELECT
  USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_reports;

-- Index for fast agent queries
CREATE INDEX idx_agent_reports_agent_name ON public.agent_reports (agent_name, created_at DESC);

-- Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
