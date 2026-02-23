# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MERIDIAN C4ISR — geopolitical OSINT intelligence dashboard monitoring the Iran/US crisis (Feb 2026). Cloudflare Workers backend with D1 database, React/Vite frontend deployed to Cloudflare Pages.

## Build & Deploy

```bash
# Workers (from /workers directory)
wrangler dev              # Local dev server
wrangler deploy           # Deploy to production
wrangler d1 execute meridian-db --file=schema.sql  # Apply DB schema

# Frontend (from root directory)
npm run dev               # Dev server at localhost:8080
npm run build             # Build to /dist
wrangler pages deploy dist --project-name meridian-frontend  # Deploy Pages

# Tests (from root)
npm run test              # vitest run
npm run test:watch        # vitest watch mode
```

## Architecture

### Workers Backend (`/workers/src/`)

Single Cloudflare Worker with URL-path routing in `index.ts`. All routes are POST handlers returning JSON with CORS headers.

**Env bindings** (defined in `lib/anthropic.ts`):
- `env.CLIPROXY_BASE_URL` — Hetzner CLIProxy tunnel URL (AI inference, secret)
- `env.DB` — D1 database binding
- `env.AISSTREAM_API_KEY`, `env.NASA_FIRMS_API_KEY` — optional secrets

**AI calls** go through `lib/anthropic.ts` → `callClaude(baseUrl, req)` / `callClaudeJSON<T>(baseUrl, req)`. Uses OpenAI-compatible `/v1/chat/completions` endpoint with function calling. All agents use `claude-sonnet-4-6` model. The `callClaudeJSON` helper extracts `choices[0].message.tool_calls[0].function.arguments` and parses as JSON.

**Database** uses raw D1 SQL via `env.DB.prepare(...).bind(...).run()`. Helpers in `lib/db.ts`. All timestamps are explicit `new Date().toISOString()` (NOT SQLite's `datetime('now')` which uses space-separated format incompatible with JS ISO string comparison).

### Agent System (`routes/agents-db.ts` + specialized routes)

16 agents that each fetch from external sources, optionally run AI analysis, and write to `agent_reports` table:

| Agent | Source | AI? | Key Metric |
|-------|--------|-----|------------|
| osint | GDELT news (4 streams) | Yes | threatLevel, sentimentScore |
| naval | ADS-B maritime patrol + GDELT | No | maritimeAnomalyIndex |
| ais | ADS-B patrol near chokepoints + GDELT maritime/tanker/incident | No | maritimeThreatIndex |
| flights | ADS-B.lol military API | No | flightAnomalyIndex |
| telegram | Public Telegram channel scraping (t.me/s/) + keyword relevance | No | telegramSignalIndex |
| acled | UCDP conflict events API + Google News RSS conflict feed + GDELT | No | conflictIntensityIndex |
| reddit | Reddit RSS (4 subs) | No | signalStrength |
| pentagon | DoD press RSS | No | activityIndex |
| cyber | GDELT cyber queries | No | cyberThreatLevel |
| markets | Polymarket events API | No | market prices |
| wiki | Wikimedia pageviews | No | wikiCrisisIndex |
| macro | GDELT oil/gold queries | No | macroRiskIndex |
| fires | NASA FIRMS satellite + GDELT | No | geoThermalIndex |
| pizza | DOUGHCON — ADS-B DC-area + GDELT crisis activity | No | pizzaIndex |
| thinktank | Red Team / Devil's Advocate over all agents | Yes | dissentScore |
| head-analyst | All agent reports | Yes | tensionIndex, WATCHCON, CII scores |

**New agents (v4.1):**
- **ais**: Monitors 3 chokepoints (Strait of Hormuz, Bab el-Mandeb, Suez Canal) using maritime patrol aircraft (P-8, MQ-9, EP-3) from ADS-B + GDELT maritime OSINT (tanker, shipping, seizure, IRGC naval). Produces per-chokepoint risk scores.
- **acled**: Multi-source conflict data — UCDP GED events (free API, no key, but only up to ~2024), UCDP Candidate events (near real-time), Google News RSS conflict feed (always available), GDELT conflict queries. Country breakdown for IR, IQ, IL, YE, LB, SY, SA.
- **telegram**: Scrapes 8 public Telegram channels via `t.me/s/` HTML preview pages. Keyword relevance scoring against 25 Iran/US crisis keywords. Produces top-keyword frequency analysis.

**Head Analyst** (`agent-head-analyst.ts`) is the synthesis layer: reads last 90min of agent_reports from all 14 collection agents, calls Claude for unified threat assessment, writes to `threat_assessments` and `country_scores` tables.

**Think Tank** (`agents-db.ts → agentThinkTank`) is the Red Team/Devil's Advocate: reads all agent reports + latest threat assessment, produces contrarian analysis with alternative scenarios, blind spots, red flags, and historical analogies.

**Threat Engine** (`threat-engine.ts`) runs independently: feeds live metadata + market data through Claude to produce probability estimates (hormuzClosure, cyberAttack, proxyEscalation, directConfrontation).

### Data API (`routes/data-api.ts`)

GET endpoints consumed by the frontend:
- `/api/agent-reports?hours=2` — recent agent reports
- `/api/threat-assessments?limit=24` — threat assessment history
- `/api/country-scores` — Country Instability Index
- `/api/intel-snapshot` — cached live-intel data
- `/api/market-snapshot` — cached market data
- `/api/signal-timeline?hours=24` — signal history for graphs

### Frontend (`/src/`)

React 18 + Vite + Tailwind + shadcn-ui. Main entry: `pages/Index.tsx` → boot animation → `Dashboard.tsx`.

Dashboard layout: 3-column grid (50% ThreatMatrix/NetworkGraph/Agents/Timeline/CII | 25% IntelFeed | 25% ThreatEngine+Markets+AIAssistant).

Agent Status Panel shows 4x4 grid of all 16 agents with threat levels, freshness indicators, and convergence alerts.

Frontend calls Workers API via `lib/api.ts` → `apiFetch<T>(path, params)`. Base URL from `VITE_API_BASE_URL` env var.

## D1 Database Schema

5 tables in `schema.sql`: `agent_reports`, `threat_assessments`, `country_scores`, `intel_snapshots`, `market_snapshots`. All use TEXT for JSON fields (parsed in app code). Indexes on `(agent_name, created_at DESC)` and `(created_at DESC)`.

## Key Conventions

- **Tool calling format**: OpenAI-compatible — tools wrapped as `{ type: "function", function: { name, description, parameters } }`, tool_choice as `{ type: "function", function: { name } }`
- **max_tokens**: Use 4096 for complex tool outputs (Head Analyst, Threat Engine, OSINT, Live Intel). Lower values cause truncated responses without tool_calls.
- **CORS**: All responses use `corsResponse()` / `corsError()` from `lib/cors.ts`
- **Timestamps**: Always use `new Date().toISOString()` for D1 inserts, never `datetime('now')`
- **Focus countries**: IR, IL, SA, AE, YE, IQ, QA, LB, US (keywords in `agent-head-analyst.ts`)
- **Telegram scraping**: Uses `t.me/s/{channel}` public preview HTML, no API key needed
- **UCDP API**: GED events only available up to ~2024, use Candidate API for recent + Google News RSS as fallback
- **Agent naming**: DB `agent_name` must match the route suffix (e.g. `/agent-ais` → `agent_name: "ais"`)

## Production URLs

- Worker: `https://meridian-api.dieter-meier82.workers.dev`
- Frontend: `https://meridian-frontend-dpv.pages.dev`
- D1 Database: `meridian-db` (ID: `9c976bbc-bc9a-4af7-a501-05b5e194823a`)

## AI Backend (CLIProxy)

Runs on Hetzner server (49.13.15.44) via Cloudflare Quick Tunnel as systemd service `meridian-cliproxy-tunnel`. Exposes OpenAI-compatible API with models: `gemini-2.5-flash`, `gemini-2.5-pro`, `claude-sonnet-4-6`, `claude-opus-4-6-thinking`. If tunnel URL changes after server restart:
```bash
ssh -i ~/.ssh/id_aitema root@49.13.15.44 "journalctl -u meridian-cliproxy-tunnel -n 20 | grep trycloudflare.com"
echo "NEW_URL" | wrangler secret put CLIPROXY_BASE_URL
```
