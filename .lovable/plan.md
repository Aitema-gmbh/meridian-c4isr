
# Enhanced Intelligence Platform: Iran-Focused Markets, Source Links, Social Media, Database + Hourly Agent

## Overview
This upgrade addresses 5 key requests: (1) clickable source links on intel items, (2) Polymarket data filtered to Iran/geopolitical relevance, (3) Reddit social media integration, (4) database persistence for all intel, and (5) an automated intelligence agent that re-analyzes every hour via a scheduled job.

Note on X/Twitter: The Twitter API requires paid API keys ($100+/month). Reddit's public API is free and provides similar social signal intelligence. If you want X integration later, we can add it once you have Twitter API credentials.

---

## Part 1: Fix Polymarket -- Iran-Focused Search

**Problem:** Current tag-based queries return irrelevant results (MicroStrategy, deportation stats).

**Fix:** Switch from `GET /events?tag=...` to Polymarket's `/public-search?q=...` endpoint which searches by keyword across event titles.

**Changes to `supabase/functions/prediction-markets/index.ts`:**
- Replace tag-based queries with keyword search queries: "iran", "iran war", "middle east conflict", "strait of hormuz", "oil price", "nuclear deal", "sanctions iran"
- Use `GET https://gamma-api.polymarket.com/public-search?q=iran&events_status=active` 
- Filter results to only geopolitically relevant markets
- Add `url` field to each market pointing to `https://polymarket.com/event/{slug}`

---

## Part 2: Source Links on Intel Items

**Changes to `supabase/functions/live-intel/index.ts`:**
- Pass the original article `url` from GDELT data through to the AI analysis
- Add `sourceUrl` field to each intel item in the tool call schema
- AI preserves the original article URL

**Changes to `src/components/dashboard/IntelFeed.tsx`:**
- Make the source name a clickable link opening in a new tab
- Add a small external link icon next to the source

---

## Part 3: Reddit Social Media Intelligence

**New edge function: `supabase/functions/reddit-intel/index.ts`**
- Fetches from Reddit's free public JSON API (no auth needed):
  - `reddit.com/r/geopolitics/search.json?q=iran&sort=new&limit=10`
  - `reddit.com/r/worldnews/search.json?q=iran+OR+hormuz&sort=new&limit=10`
  - `reddit.com/r/iran/hot.json?limit=10`
- Returns structured social signal data: title, score, comments, url, subreddit
- Runs through AI to extract sentiment and relevance

**New component: Social signals integrated into IntelFeed**
- Reddit posts appear in the intel feed with a "REDDIT" source tag and direct link
- Distinguished by a purple Reddit icon/tag

---

## Part 4: Database Persistence

**New database tables:**

1. **`intel_snapshots`** -- stores each hourly analysis run
   - `id` (uuid, primary key)
   - `created_at` (timestamp)
   - `flash_report` (text)
   - `article_count` (integer)
   - `mil_track_count` (integer)
   - `average_sentiment` (numeric)
   - `dominant_category` (text)
   - `items` (jsonb -- array of intel items)
   - `source_type` (text -- 'gdelt', 'reddit', 'combined')

2. **`market_snapshots`** -- stores Polymarket snapshots
   - `id` (uuid, primary key)
   - `created_at` (timestamp)
   - `markets` (jsonb -- array of market data)

3. **`threat_assessments`** -- stores threat engine results
   - `id` (uuid, primary key)
   - `created_at` (timestamp)
   - `tension_index` (numeric)
   - `watchcon` (text)
   - `hormuz_closure` (numeric)
   - `cyber_attack` (numeric)
   - `proxy_escalation` (numeric)
   - `direct_confrontation` (numeric)
   - `analysis_narrative` (text)
   - `market_divergences` (jsonb)
   - `raw_indicators` (jsonb)

All tables will have RLS disabled since this is public intelligence data with no user-specific access control needed.

---

## Part 5: Hourly Intelligence Agent (Cron Job)

**New edge function: `supabase/functions/intel-agent/index.ts`**
- Orchestrator function that runs every hour
- Calls all data sources in parallel: GDELT (3 queries), ADS-B, Reddit (3 subreddits), Polymarket
- Sends combined data to AI for comprehensive analysis
- Stores results in all 3 database tables
- Generates a comprehensive hourly SITREP stored in `intel_snapshots`

**Cron setup:**
- Uses `pg_cron` + `pg_net` extensions
- Scheduled to run every hour: `0 * * * *`
- Calls the `intel-agent` edge function via HTTP POST

**Dashboard changes:**
- On load, first reads latest data from database (instant)
- Then fetches fresh data in background
- Shows "Last analyzed: X minutes ago" indicator
- Historical data available for trend analysis in ThreatEngine charts

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/prediction-markets/index.ts` | REWRITE | Use `/public-search` for Iran-focused results, add URLs |
| `supabase/functions/live-intel/index.ts` | MODIFY | Add `sourceUrl` to items from GDELT article URLs |
| `supabase/functions/reddit-intel/index.ts` | CREATE | Reddit public API fetcher + AI analysis |
| `supabase/functions/intel-agent/index.ts` | CREATE | Hourly orchestrator that fetches all sources, analyzes, stores |
| `src/components/dashboard/IntelFeed.tsx` | MODIFY | Clickable source links, Reddit items, external link icons |
| `src/components/dashboard/PredictionMarkets.tsx` | MODIFY | Clickable market links to Polymarket, Iran-focused display |
| `src/components/dashboard/Dashboard.tsx` | MODIFY | Load initial data from DB, show last-analyzed time |
| `supabase/config.toml` | MODIFY | Register new edge functions |
| Database migration | CREATE | 3 new tables: `intel_snapshots`, `market_snapshots`, `threat_assessments` |
| pg_cron setup | CREATE | Hourly scheduled job calling `intel-agent` |

---

## Technical Architecture

```text
HOURLY CRON (pg_cron)
  |
  +--> intel-agent edge function
        |
        |-- GDELT x3 (Iran, US-mil, Cyber)
        |-- ADS-B military aircraft
        |-- Reddit x3 (r/geopolitics, r/worldnews, r/iran)
        |-- Polymarket /public-search?q=iran
        |
        +--> AI Analysis (Gemini Flash)
        |     |-- Combines all sources
        |     |-- Generates SITREP + threat assessment
        |
        +--> Store in Database
              |-- intel_snapshots (articles + reddit + flash report)
              |-- market_snapshots (Polymarket odds)
              |-- threat_assessments (probabilities + narrative)

DASHBOARD (loads from DB first, then live)
  |-- IntelFeed: clickable source links, Reddit items
  |-- PredictionMarkets: Iran-focused, links to Polymarket
  |-- ThreatEngine: reads historical assessments for trend charts
  |-- AI Assistant: full context from DB history
```

## Free APIs Used

| API | Auth | Data |
|-----|------|------|
| Polymarket `/public-search` | None | Iran prediction market odds |
| Reddit `.json` endpoints | None | Social signals from r/geopolitics, r/worldnews, r/iran |
| GDELT DOC 2.0 | None | Real-time conflict news |
| adsb.lol | None | Military aircraft positions |
