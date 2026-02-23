# MERIDIAN C4ISR v5.0

**Combined Intelligence Surveillance Reconnaissance Platform for Geopolitical Crisis Monitoring**

Built by [aitema GmbH](https://aitema.de) | Live: [meridian-frontend-dpv.pages.dev](https://meridian-frontend-dpv.pages.dev)

---

## What is MERIDIAN?

MERIDIAN is a real-time OSINT (Open Source Intelligence) dashboard that monitors the Iran/US geopolitical crisis in the Persian Gulf region. It aggregates data from 15+ external sources, runs 16 autonomous intelligence agents, and synthesizes everything into a unified threat assessment using AI analysis.

Think of it as a C4ISR (Command, Control, Communications, Computers, Intelligence, Surveillance, and Reconnaissance) system — but built as a modern web application running entirely on Cloudflare's edge infrastructure.

**This is the "Armchair General Version"** — a demonstration of what's possible when you combine freely available OSINT data sources with AI-powered analysis into a cohesive intelligence picture.

---

## Architecture

### Backend: Cloudflare Workers + D1

A single Cloudflare Worker handles all API routing. The backend is structured as:

- **16 autonomous agents** that each fetch from different external data sources on scheduled intervals
- **Head Analyst agent** that synthesizes all agent reports into a unified threat assessment
- **Think Tank agent** (Red Team / Devil's Advocate) that challenges the Head Analyst's conclusions
- **Threat Engine** that produces calibrated probability estimates for key scenarios
- **D1 SQLite database** storing agent reports, threat assessments, country scores, and prediction logs

### Frontend: React + Vite + Tailwind

A responsive dashboard with:
- **Interactive threat map** (Leaflet) showing real-time military flights, naval bases, chokepoints, and OSINT events geocoded to actual locations
- **Agent Status Panel** displaying all 16 agents in a 4x4 grid with threat levels, freshness indicators, and convergence alerts
- **Threat Engine** with tension index history, CUSUM change detection, Holt-Winters forecasting, and calibrated probability estimates
- **Intel Feed** with AI-analyzed OSINT articles from GDELT, prioritized and tagged by threat category
- **Prediction Markets** integration showing live Polymarket odds for Iran-related events
- **Signal Timeline** for historical trend analysis
- **Country Instability Index** for 9 focus countries
- **AI Assistant** for natural language queries about the intelligence picture
- **Pattern Matching** (DTW) comparing current signals to historical crisis templates
- **Auto-Briefings** generating executive summaries with delta tracking

---

## The 16 Intelligence Agents

| # | Agent | Data Source | What It Monitors |
|---|-------|-------------|------------------|
| 1 | **OSINT** | GDELT Project (4 query streams) | Iran/US news articles, translated from EN/AR/FA |
| 2 | **Naval** | ADS-B Exchange + GDELT | Maritime patrol aircraft (P-8 Poseidon, MQ-9 Reaper) |
| 3 | **AIS** | ADS-B Exchange + GDELT Maritime | Chokepoint monitoring (Hormuz, Bab el-Mandeb, Suez) |
| 4 | **Flights** | ADS-B.lol Military API | Military aircraft in the Gulf region (20-35N, 44-65E) |
| 5 | **Telegram** | 12 public channels (EN/AR/FA) | Farsi/Arabic OSINT from TasneemOnline, AlMayadeen, etc. |
| 6 | **ACLED** | UCDP + Google News + GDELT | Armed conflict events across 7 countries |
| 7 | **Reddit** | 4 subreddits via RSS | r/geopolitics, r/worldnews, r/CredibleDefense, r/iran |
| 8 | **Pentagon** | DoD Press RSS | Official US military press releases and statements |
| 9 | **Cyber** | GDELT Cyber queries | Iran-related cyber operations and threats |
| 10 | **Markets** | Polymarket API | Prediction market odds for Iran/US scenarios |
| 11 | **Wiki** | Wikimedia Pageviews | Crisis indicator via Wikipedia article traffic spikes |
| 12 | **Macro** | GDELT + Oil/Gold queries | Oil price disruption signals, sanctions impact |
| 13 | **Fires** | NASA FIRMS Satellite | Thermal anomalies in Iran/Gulf region |
| 14 | **DOUGHCON** | ADS-B DC-area + GDELT | Washington DC pizza delivery proxy for late-night crisis activity |
| 15 | **Metaculus** | Metaculus Forecasting API | Crowd forecast comparison and calibration |
| 16 | **Think Tank** | All agent reports | Red Team / Devil's Advocate contrarian analysis |

Plus the **Head Analyst** synthesis layer that reads all 14 collection agents and produces:
- **Tension Index** (0-100)
- **WATCHCON Level** (I-V)
- **Dominant Threat Category** (MILITARY, MARITIME, CYBER, DIPLOMATIC, ECONOMIC)
- **Country Instability Scores** for IR, IL, SA, AE, YE, IQ, QA, LB, US

---

## v5.0 Enhancements

Version 5.0 adds 8 major features developed in parallel:

1. **Farsi/Arabic Sources** — GDELT queries in `sourcelang:ara`/`sourcelang:fas`, 4 new Telegram channels, transliterated keywords (sepah, hormoz, khaleej, pasdaran)
2. **Multi-Source Corroboration** — Jaccard similarity + entity overlap detects when multiple agents report the same event, scored 1-5
3. **Holt-Winters Forecasting** — Triple exponential smoothing with 24h seasonality for 6h/12h/24h tension projections
4. **Z-Score Anomaly Detection** — Modified Z-Score with MAD for robust outlier detection, compound anomaly scoring across all signals
5. **Historical Pattern Templates (DTW)** — Dynamic Time Warping comparing current signals to Soleimani 2020, Tanker War 2019, Aramco 2019 crisis patterns
6. **Metaculus Integration** — Crowd forecast comparison with divergence flagging at >15% deviation
7. **Entity Resolution / Knowledge Graph** — Automatic entity extraction with alias resolution (IRGC = Islamic Revolutionary Guard Corps = Sepah)
8. **Auto-Updating Briefings** — AI-generated daily/weekly executive briefings with delta tracking

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Backend | Cloudflare Workers (TypeScript) |
| Database | Cloudflare D1 (SQLite at the edge) |
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Maps | Leaflet + React Leaflet |
| Charts | Recharts |
| AI Inference | Claude / Gemini via CLIProxy |
| Deployment | Cloudflare Pages (frontend) + Workers (API) |
| Scheduling | Cloudflare Cron Triggers |

---

## Data Sources

All data sources used are **freely available public APIs** with no authentication required (except NASA FIRMS which uses a free API key):

- [GDELT Project](https://www.gdeltproject.org/) — Global news monitoring
- [ADS-B Exchange / ADS-B.lol](https://www.adsb.lol/) — Live military aircraft transponder data
- [Polymarket](https://polymarket.com/) — Prediction market prices
- [UCDP](https://ucdp.uu.se/) — Armed conflict data
- [Wikimedia Pageviews](https://pageviews.wmcloud.org/) — Wikipedia traffic
- [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/) — Satellite fire/thermal data
- [Reddit RSS](https://www.reddit.com/) — Subreddit feeds
- [Telegram](https://t.me/) — Public channel scraping via `t.me/s/` HTML
- [Metaculus](https://www.metaculus.com/) — Crowd forecasting platform

---

## Map Accuracy

The threat map uses precise geocoding for all key locations:

- **Strait of Hormuz**: Centered on actual narrows (26.56N, 56.27E)
- **Persian Gulf events**: Maritime events geocoded to the Gulf, not inland
- **Nuclear facilities**: Isfahan/Natanz (32.65N, 51.68E), Fordow/Qom (34.64N, 50.88E)
- **Naval bases**: All 8 bases verified within <1km of real coordinates
- **Military aircraft**: Live ADS-B transponder data (not hardcoded)
- **Chokepoint polygons**: Risk zones for Hormuz, Bab el-Mandeb, Suez
- **Shipping lanes**: Aligned with real maritime routes

---

## Local Development

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- Cloudflare account with D1 access

### Setup

```bash
# Clone
git clone https://github.com/Aitema-gmbh/meridian-c4isr.git
cd meridian-c4isr

# Install dependencies
npm install
cd workers && npm install && cd ..

# Frontend dev server
npm run dev

# Workers dev server (separate terminal)
cd workers && wrangler dev
```

### Environment Variables

**Workers** (`workers/wrangler.toml`):
- `CLIPROXY_BASE_URL` — AI inference proxy URL (Cloudflare secret)
- `DB` — D1 database binding
- `AISSTREAM_API_KEY` — Optional AIS stream key
- `NASA_FIRMS_API_KEY` — NASA FIRMS API key

**Frontend** (`.env`):
- `VITE_API_BASE_URL` — Workers API URL

### Deploy

```bash
# Deploy Workers
cd workers && npx wrangler deploy

# Build and deploy frontend
npm run build
npx wrangler pages deploy dist --project-name meridian-frontend
```

---

## API Endpoints

The Workers API exposes 20+ endpoints:

### Agent Triggers (POST)
`/agent-osint`, `/agent-naval`, `/agent-ais`, `/agent-flights`, `/agent-telegram`, `/agent-acled`, `/agent-reddit`, `/agent-pentagon`, `/agent-cyber`, `/agent-markets`, `/agent-wiki`, `/agent-macro`, `/agent-fires`, `/agent-pizza`, `/agent-metaculus`, `/agent-thinktank`, `/agent-head-analyst`

### Data APIs (POST)
- `/api/agent-reports` — Recent agent reports with metrics
- `/api/threat-assessments` — Threat assessment history
- `/api/country-scores` — Country Instability Index
- `/api/signal-timeline` — Signal history for charts
- `/api/map-intel` — Geocoded events for threat map
- `/api/calibration` — Prediction calibration data
- `/api/trajectories` — Tension trajectory with forecasts
- `/api/anomalies` — Z-Score anomaly detection
- `/api/pattern-match` — DTW historical pattern matching
- `/api/entities` — Entity resolution knowledge graph
- `/api/briefings` — Auto-generated briefings
- `/api/generate-briefing` — Trigger briefing generation

### Orchestration
- `/run-cycle` — Run all 14 collection agents + head analyst
- `/live-intel` — Real-time GDELT + ADS-B + AI analysis
- `/prediction-markets` — Live Polymarket data
- `/threat-engine` — AI probability estimates

---

## Database Schema

10 tables in Cloudflare D1:

- `agent_reports` — All agent output with metrics and summaries
- `threat_assessments` — Head Analyst synthesis results
- `country_scores` — Per-country instability tracking
- `prediction_log` — Threat Engine probability estimates
- `intel_snapshots` — Cached OSINT data
- `market_snapshots` — Cached market data
- `entities` — Resolved entity knowledge graph
- `entity_mentions` — Entity-to-report mapping
- `entity_relations` — Entity relationship graph
- `briefings` — Auto-generated intelligence briefings

---

## Disclaimer

This is a demonstration project for educational and research purposes. It aggregates publicly available data sources and should not be used as the sole basis for any real-world decision-making. The "Armchair General Version" label is intentional — this is a technology demonstration, not an operational intelligence system.

---

## License

MIT License. See [LICENSE](LICENSE) for details.

Built by [aitema GmbH](https://aitema.de) — AI Innovation for Education, Public Sector & Social Impact.
