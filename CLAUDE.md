# CLAUDE.md — MERIDIAN C4ISR v5.0

Development guide for AI assistants and contributors working on this codebase.

## Quick Reference

```bash
# Frontend (root directory)
npm install                  # Install frontend dependencies
npm run dev                  # Dev server on localhost:8080
npm run build                # Production build → /dist
npm run lint                 # ESLint
npm run test                 # Vitest (single run)
npm run test:watch           # Vitest (watch mode)

# Workers backend (workers/ directory)
cd workers && npm install    # Install worker dependencies
npx wrangler dev             # Local worker dev server
npx wrangler deploy          # Deploy to Cloudflare
npx wrangler d1 execute meridian-db --command "SQL"  # Run D1 queries locally
```

## Project Overview

MERIDIAN is a real-time OSINT intelligence dashboard monitoring geopolitical tensions (focused on Iran/US). It aggregates data from 17 autonomous collection agents into a single tactical dashboard with superforecasting aggregation, entity resolution, and AI-driven analysis.

**Stack:** React 18 + Vite + TypeScript (frontend) | Cloudflare Workers + D1 SQLite (backend) | Claude/Gemini via CLIProxy (AI)

## Repository Structure

```
meridian-c4isr/
├── src/                        # React frontend (Vite + SWC)
│   ├── App.tsx                 # Root: QueryClient, Router, Toasters
│   ├── main.tsx                # Entry point
│   ├── index.css               # Global styles + Tailwind + CSS variables
│   ├── components/
│   │   ├── ui/                 # shadcn/ui primitives (45+ components)
│   │   └── dashboard/          # Main dashboard panels
│   │       ├── Dashboard.tsx       # Layout: 50% map | 25% intel | 25% engine
│   │       ├── ThreatMatrix.tsx    # Leaflet map + geocoded events
│   │       ├── ThreatEngine.tsx    # Probability forecasting panel
│   │       ├── AgentStatusPanel.tsx # 4x4 grid of 16 agents
│   │       ├── IntelFeed.tsx       # OSINT articles + sentiment
│   │       ├── AIAssistant.tsx     # Chat interface for queries
│   │       ├── NetworkGraph.tsx    # Entity relationship graph
│   │       ├── PatternMatch.tsx    # DTW historical comparison
│   │       ├── SignalTimeline.tsx   # Multi-agent signal history
│   │       ├── CountryBrief.tsx    # Country Instability Index
│   │       ├── PredictionMarkets.tsx # Polymarket integration
│   │       └── BriefingViewer.tsx  # Auto-generated briefings
│   ├── pages/
│   │   ├── Index.tsx           # Boot animation → Dashboard
│   │   └── NotFound.tsx        # 404 page
│   ├── lib/
│   │   ├── api.ts              # apiFetch<T>() — typed API client
│   │   └── utils.ts            # cn() classname helper
│   ├── hooks/                  # use-toast, use-mobile
│   └── test/
│       ├── setup.ts            # Vitest jsdom + jest-dom setup
│       └── example.test.ts     # Sample test
├── workers/                    # Cloudflare Workers backend
│   ├── wrangler.toml           # Worker config, D1 binding, cron triggers
│   ├── package.json            # Worker dependencies (wrangler, CF types)
│   └── src/
│       ├── index.ts            # Router + cron orchestration
│       ├── lib/
│       │   ├── anthropic.ts    # AI inference (CLIProxy → Claude/Gemini)
│       │   ├── db.ts           # D1 helpers + corroboration scoring
│       │   ├── cors.ts         # CORS headers/responses
│       │   ├── dtw.ts          # Dynamic Time Warping
│       │   ├── forecasting.ts  # Superforecasting aggregation
│       │   └── entities.ts     # Entity extraction + knowledge graph
│       └── routes/
│           ├── agents-db.ts        # 14 collection agents
│           ├── agent-head-analyst.ts # Synthesis: threat assessment
│           ├── agent-flights.ts    # Military aircraft tracking
│           ├── threat-engine.ts    # Probability estimates
│           ├── data-api.ts         # GET endpoints for frontend
│           ├── live-intel.ts       # Real-time GDELT + ADS-B
│           ├── intel-chat.ts       # AI chat interface
│           ├── briefing-gen.ts     # Auto-briefing generation
│           ├── entity-api.ts       # Entity resolution API
│           ├── adsb-proxy.ts       # ADS-B Exchange proxy
│           ├── ais-proxy.ts        # AIS vessel data proxy
│           ├── simple-proxies.ts   # Market/Reddit/misc proxies
│           └── scenario-sim.ts     # Scenario simulation
├── .github/workflows/deploy.yml  # CI/CD: Workers + Pages deploy on push to main
├── docs/                       # PRDs and specs
├── supabase/                   # Legacy migrations (not used in v5)
├── vite.config.ts              # Vite: SWC, port 8080, manual chunks, @ alias
├── vitest.config.ts            # Vitest: jsdom, globals, setup file
├── tailwind.config.ts          # Tactical theme (cyan/amber/crimson)
├── eslint.config.js            # TypeScript ESLint
├── tsconfig.json               # Base TS config (lenient: strict=false)
└── components.json             # shadcn/ui configuration
```

## Architecture

### Data Flow

```
External Sources (GDELT, ADS-B, RSS, APIs)
          ↓
  17 Collection Agents (Cloudflare Workers cron, every 10 min)
          ↓
  D1 Database (agent_reports table, JSON data)
          ↓
  Synthesis Agents (Head Analyst + Think Tank)
          ↓
  threat_assessments + country_scores tables
          ↓
  Data API routes (/api/*)
          ↓
  React Frontend (apiFetch<T> → React Query → Components)
```

### Agent System

17 collection agents run every 10 minutes via Cloudflare cron (`*/10 * * * *`), executed in batches of 5 to stay within CF subrequest limits:

| Agent | Source | Key Metric |
|-------|--------|------------|
| flights | ADS-B.lol military API | flightAnomalyIndex |
| naval | ADS-B + GDELT maritime | maritimeAnomalyIndex |
| ais | ADS-B patrol + GDELT | maritimeThreatIndex |
| osint | GDELT news (4 streams) | sentimentScore |
| reddit | 4 subreddit RSS feeds | signalStrength |
| pentagon | DoD press RSS | activityIndex |
| cyber | GDELT cyber queries | cyberThreatLevel |
| markets | Polymarket API | market prices |
| wiki | Wikimedia pageviews | wikiCrisisIndex |
| macro | GDELT oil/gold queries | macroRiskIndex |
| fires | NASA FIRMS satellite | geoThermalIndex |
| pizza | DC-area ADS-B (DOUGHCON) | pizzaIndex |
| acled | UCDP + Google News + GDELT | conflictIntensityIndex |
| telegram | 8 public channels | telegramSignalIndex |
| metaculus | Metaculus forecasts | crowd forecast odds |
| weather | Weather API | condition metrics |
| isw | ISW reports | analysis summary |

**Synthesis agents** (run after collection):
- **head-analyst** — Reads 3-day agent history, computes tensionIndex, WATCHCON level, CII scores. Uses Claude for narrative analysis.
- **thinktank** — Red Team contrarian analysis; produces dissentScore and identifies blind spots.

### Superforecasting Algorithm

Located in `workers/src/lib/forecasting.ts`. Implements **Geometric Mean of Odds** with Neyman-Roughgarden extremizing (Tetlock/GJP methodology):

1. Base weights by signal type: Hard (3.0x: flights, ais, cyber, pentagon), Medium (2.0x: osint, macro, acled, naval, markets), Soft (1.0x: wiki, reddit, pizza, telegram, fires)
2. Recency decay (half-life 60 min)
3. Data richness bonus for item count
4. Weighted mean in log-odds space
5. Extremize relative to base rate
6. Convert back to probability via sigmoid

Also includes: CUSUM change-point detection, Holt-Winters triple exponential smoothing, trajectory classification (OLS regression), compound anomaly scoring (MAD-based Z-scores), Kelly edge calculation.

### AI Integration

All AI calls go through a CLIProxy server (OpenAI-compatible `/v1/chat/completions` endpoint). Configured in `workers/src/lib/anthropic.ts`.

**Model fallback chain:**
```
claude-sonnet-4-6 → gemini-3.1-pro-high → gemini-2.5-flash
```

- On 429/5xx errors, automatically falls to next model
- Gemini models use JSON-in-content fallback instead of tool calling
- Tool calling uses OpenAI function format
- Response parsing handles both tool_calls and content JSON extraction

### Frontend Patterns

- **State management:** React Query (TanStack) for server state; useState for local UI
- **Routing:** React Router v6 (single page at `/`, catch-all 404)
- **Code splitting:** React.lazy() + Suspense for dashboard panels; Vite manual chunks for vendor libs
- **Error isolation:** ErrorBoundary wraps each dashboard panel
- **API client:** `apiFetch<T>(path, params)` in `src/lib/api.ts` — constructs URL from `VITE_API_BASE_URL`
- **Component library:** shadcn/ui (Radix primitives + Tailwind)
- **Styling:** Tailwind CSS with tactical theme (dark mode, CSS variables for cyan/amber/crimson/panel colors)
- **Fonts:** JetBrains Mono (monospace), Inter (sans)
- **Path alias:** `@/` → `./src/`

## Database (Cloudflare D1)

D1 binding: `env.DB` in workers. Database name: `meridian-db`.

### Tables

| Table | Purpose | Retention |
|-------|---------|-----------|
| agent_reports | Raw agent output (JSON data, summary, threat_level, confidence, corroboration_score) | 30 days |
| threat_assessments | Head analyst output (tension_index, watchcon, scenario probabilities, narrative) | 30 days |
| country_scores | Per-country CII scores + signal breakdown | 30 days |
| prediction_log | Our estimates vs market prices | 30 days |
| intel_snapshots | Point-in-time intel snapshots (JSON blob) | 90 days |
| market_snapshots | Point-in-time market data (JSON blob) | 90 days |
| entities | Knowledge graph nodes (name, type, aliases, attributes) | Permanent |
| entity_mentions | Entity ↔ report links | 90 days |
| entity_relations | Graph edges (source, target, relation_type, confidence) | 90 days |
| briefings | Auto-generated briefings (type, content JSON, delta_analysis) | Permanent |

### D1 Conventions

- **JSON fields** are stored as TEXT. Serialize with `JSON.stringify()`, parse in application code.
- **Timestamps** are ISO 8601 strings via `new Date().toISOString()`. Never use SQLite `datetime('now')`.
- **All queries** use raw SQL: `env.DB.prepare("...").bind(...).run()` / `.first()` / `.all()`.
- **Empty report protection:** If an agent fetches 0 items and a recent good report exists (< 12h), the empty report is skipped to avoid overwriting valid data. See `insertAgentReport()` in `db.ts`.
- **Corroboration scoring:** After each agent report insert, Jaccard similarity is computed against reports from other agents in the last 2 hours. Score ranges from 1 (single source) to 5 (multiple confirmations).

## Workers Backend Conventions

### Routing

All routes are registered in `workers/src/index.ts` as a flat `ROUTES` map of `pathname → handler(req, env)`. Route handlers return `Response` objects directly.

```typescript
const ROUTES: Record<string, (req: Request, env: Env) => Promise<Response>> = {
  "/api/agent-reports": apiAgentReports,
  "/agent-flights":     agentFlights,
  // ...
};
```

### API Response Format

Use the CORS helpers from `workers/src/lib/cors.ts`:

```typescript
import { corsResponse, corsError } from "../lib/cors";

// Success
return corsResponse({ data: results });

// Error
return corsError("Something went wrong", 500);
```

All responses include CORS headers (`Access-Control-Allow-Origin: *`). Health check at `/` or `/health`.

### Adding a New Agent

1. Create handler in `workers/src/routes/agents-db.ts` or a new route file
2. Fetch external data, structure report, call `insertAgentReport(env.DB, report)`
3. Register route in `workers/src/index.ts` ROUTES map
4. Add to `runCollectionCycle()` agents array in `index.ts`
5. If relevant, add weight in `forecasting.ts` signal categories

### Env Type

Defined in `workers/src/lib/anthropic.ts`:

```typescript
export interface Env {
  CLIPROXY_BASE_URL: string;
  DB: D1Database;
  AISSTREAM_API_KEY?: string;
  NASA_FIRMS_API_KEY?: string;
}
```

### Secrets Management

```bash
wrangler secret put CLIPROXY_BASE_URL
wrangler secret put NASA_FIRMS_API_KEY
wrangler secret put AISSTREAM_API_KEY
```

## Testing

**Framework:** Vitest 3.2 with jsdom environment

```bash
npm run test          # Single run
npm run test:watch    # Watch mode
```

- Test files: `src/**/*.{test,spec}.{ts,tsx}`
- Setup: `src/test/setup.ts` (jest-dom matchers, matchMedia mock)
- Globals enabled (no need to import `describe`, `it`, `expect`)
- Uses `@testing-library/react` for component tests
- Path alias `@/` works in tests via vitest config

## TypeScript Configuration

The project uses **lenient TypeScript** settings intentionally:

- `strict: false`
- `noImplicitAny: false`
- `strictNullChecks: false`
- `noUnusedLocals: false`
- `@typescript-eslint/no-unused-vars: off`

This is a deliberate choice for rapid prototyping. Do not enable strict mode without explicit instruction.

## Deployment

CI/CD runs on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`):

1. **Workers backend** → `npx wrangler deploy` (from `workers/` dir)
2. **Frontend** → `npm run build` then `npx wrangler pages deploy dist --project-name meridian-frontend`

**Required CI secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

**Production URLs:**
- API: `https://meridian-api.dieter-meier82.workers.dev`
- Frontend: Cloudflare Pages (project: `meridian-frontend`)

**Environment variable:** `VITE_API_BASE_URL` — set at build time; defaults to the production worker URL.

### Cron Schedule

Configured in `workers/wrangler.toml`: `*/10 * * * *` (every 10 minutes)

- Collection: All 17 agents in batches of 5
- Synthesis: Head Analyst + Think Tank (after collection)
- Cleanup: Daily at 03:00 UTC — deletes data beyond retention limits

## Code Style

- **Formatting:** No Prettier configured. Follow existing code style.
- **Linting:** ESLint with typescript-eslint. Run `npm run lint`.
- **Imports:** Use `@/` path alias for frontend imports (maps to `src/`).
- **UI components:** Use shadcn/ui from `@/components/ui/`. Add new components with the shadcn CLI conventions (see `components.json`).
- **Tailwind classes:** Use the tactical color tokens (`cyan`, `amber`, `crimson`, `tactical-green`, `panel`) defined in `tailwind.config.ts`. Use `cn()` from `@/lib/utils` for conditional classes.
- **No unused exports cleanup:** The eslint config intentionally turns off unused-vars warnings. Don't add lint rules without instruction.

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/components/dashboard/Dashboard.tsx` | Main layout, lazy-loads all panels |
| `src/lib/api.ts` | `apiFetch<T>()` — all frontend API calls go through here |
| `workers/src/index.ts` | Route table + cron orchestration |
| `workers/src/lib/anthropic.ts` | AI client, model fallback chain, response parsing |
| `workers/src/lib/db.ts` | D1 helpers, report insertion, corroboration |
| `workers/src/lib/forecasting.ts` | Superforecasting math (aggregation, CUSUM, Holt-Winters) |
| `workers/src/routes/agents-db.ts` | All 14 collection agent handlers |
| `workers/src/routes/agent-head-analyst.ts` | Synthesis: threat assessment generation |
| `workers/src/routes/data-api.ts` | API endpoints consumed by the frontend |
| `workers/wrangler.toml` | Worker config, D1 binding, cron schedule |
| `tailwind.config.ts` | Tactical theme colors and animations |

## Common Pitfalls

- **D1 JSON columns:** Always `JSON.stringify()` before inserting, `JSON.parse()` after reading. D1 has no native JSON type.
- **Timestamps:** Use `new Date().toISOString()` in JS, not SQLite datetime functions. D1 doesn't support `datetime('now')` reliably.
- **CORS:** Every response from workers must include CORS headers. Use `corsResponse()` / `corsError()` helpers.
- **Agent batching:** Collection agents run in batches of 5 (CF subrequest limit). If adding agents, account for batch sizing in `runCollectionCycle()`.
- **AI model naming:** Models are referenced by their CLIProxy names (e.g., `claude-sonnet-4-6`), not native Anthropic/Google model IDs.
- **Empty reports:** The `insertAgentReport()` function silently skips empty reports (0 items, 0 threat) when a recent good report exists. This is intentional — don't remove this guard.
- **Supabase directory:** The `supabase/` directory and `src/integrations/supabase/` are legacy from v4. The current backend uses Cloudflare D1 exclusively.
- **Frontend env:** `VITE_API_BASE_URL` must be set at build time (Vite inlines it). It cannot be changed at runtime.
