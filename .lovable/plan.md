

# 10x Intelligence Upgrade: Prediction Markets, Multi-Source OSINT, Visual Overhaul

## Overview
Massively expand the dashboard with real Polymarket prediction market data, richer multi-query OSINT intelligence, AI-generated situation reports, and a visually stunning UI overhaul with animated threat gauges, glassmorphism panels, and more data density.

---

## Part 1: Polymarket Prediction Markets Panel (NEW)

**What:** A new "PREDICTION MARKETS" panel showing real-time prediction market odds for geopolitical events from Polymarket's free public API.

**How:**
- Create new edge function `prediction-markets` that:
  1. Fetches from `https://gamma-api.polymarket.com/events?active=true&closed=false&limit=20` with tag search for Iran, war, conflict, Middle East, military, oil
  2. Also queries specific slugs if known (e.g., iran-war, us-iran, oil-price)
  3. Returns structured market data: question, outcome prices (YES/NO %), volume, liquidity
  4. No API key needed -- Polymarket Gamma API is fully public

- Create new component `PredictionMarkets.tsx`:
  - Displays each market as a card with the question, YES/NO probability bars, volume
  - Color-coded: red for high-probability negative outcomes, green for positive
  - Auto-refresh every 2 minutes
  - Animated probability bars with framer-motion
  - Shows "POLYMARKET LIVE" indicator

**Files:**
- `supabase/functions/prediction-markets/index.ts` -- NEW
- `src/components/dashboard/PredictionMarkets.tsx` -- NEW
- `supabase/config.toml` -- register function

---

## Part 2: Enhanced Live Intel Edge Function (10x more data)

**What:** Massively expand the `live-intel` edge function to pull from multiple GDELT queries and produce richer analysis.

**Changes to `supabase/functions/live-intel/index.ts`:**
- Run 3 parallel GDELT queries instead of 1:
  1. Iran + Hormuz + Persian Gulf (current)
  2. US military + CENTCOM + deployment
  3. Cyber attack + critical infrastructure + APT
- Increase max articles from 12 to 30
- Add a "FLASH REPORT" field: AI generates a 3-sentence executive summary of the overall situation
- Add "threat_tags" to each item: MARITIME, CYBER, DIPLOMATIC, MILITARY, ECONOMIC
- Add "confidence" score to each item (HIGH/MEDIUM/LOW)
- Return richer metadata: top entities across all items, dominant threat category

---

## Part 3: AI Situation Report Generator (NEW)

**What:** Add a "GENERATE SITREP" button that produces a full AI-generated intelligence situation report.

**Changes to `src/components/dashboard/AIAssistant.tsx`:**
- Add a "SITREP" quick-action button above the chat input
- When clicked, sends all current live intel items + threat engine data + prediction market data to the AI
- AI generates a structured SITREP with sections: SITUATION, THREAT ASSESSMENT, KEY INDICATORS, PREDICTION MARKET SIGNALS, RECOMMENDED ACTIONS
- Displayed in a formatted card with section headers

---

## Part 4: Visual Overhaul -- Stunning UI Upgrade

### 4a. Dashboard Layout Redesign (`Dashboard.tsx`)
- Change to a 3-column layout: Map (left, 50%) | Intel Feed (center, 25%) | Threat Engine + Markets + AI (right, 25%)
- Add a second tab row: SITREP | MARKETS alongside existing THREAT MATRIX | NETWORK GRAPH
- Animated panel transitions with framer-motion

### 4b. Enhanced Intel Feed (`IntelFeed.tsx`)
- Add threat_tag colored chips (MARITIME = blue, CYBER = purple, DIPLOMATIC = amber, MILITARY = red)
- Add confidence badge on each item
- Add "FLASH" animated badge for HIGH priority items with a pulsing red glow
- Subtle card hover animations with border glow
- Show the AI-generated flash report at the top of the feed as a highlighted banner

### 4c. Enhanced Threat Engine (`ThreatEngine.tsx`)
- Replace simple progress bars with animated radial/arc gauges for the top 4 threat probabilities
- Add animated number counters that count up to the value
- Add a "WATCHCON" badge with color-coded background (1=red, 2=amber, 3=yellow, 4=green, 5=blue)
- Sparkline mini-charts next to each gauge showing trend direction

### 4d. CSS/Styling Upgrades (`src/index.css`, `tailwind.config.ts`)
- Add glassmorphism panel variant with backdrop-blur
- Add animated gradient border effect for HIGH threat panels
- Add new keyframe animations: `threat-flash`, `count-up`, `border-glow`
- Add `animate-pulse-fast` for urgent indicators

---

## Part 5: Prediction Markets Integration into Threat Engine

**What:** Feed Polymarket odds into the Threat Engine for more accurate assessments.

**Changes:**
- Dashboard fetches prediction market data and passes it to ThreatEngine alongside live intel metadata
- ThreatEngine edge function receives Polymarket odds as additional indicators
- AI compares its calculated probabilities against market consensus and flags divergences

---

## Architecture

```text
Dashboard.tsx (orchestrator)
  |
  |-- fetchLiveIntel() -> live-intel edge function
  |     |-- 3x GDELT queries (Iran, US-mil, Cyber)
  |     |-- ADS-B military count
  |     |-- AI: Gemini Flash analyzes 30 articles
  |     |-- Returns: items + flash report + metadata
  |
  |-- fetchMarkets() -> prediction-markets edge function
  |     |-- Polymarket Gamma API (public, no auth)
  |     |-- Returns: market odds for geopolitical events
  |
  |-- Passes all data to:
        |-- IntelFeed (articles + flash report)
        |-- ThreatEngine (indicators + market odds)
        |-- PredictionMarkets (market data)
        |-- AIAssistant (full context for chat + SITREP)
```

---

## All File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/prediction-markets/index.ts` | CREATE | Polymarket Gamma API fetcher |
| `src/components/dashboard/PredictionMarkets.tsx` | CREATE | Prediction markets panel |
| `supabase/functions/live-intel/index.ts` | REWRITE | 3x GDELT queries, 30 articles, flash report, tags |
| `src/components/dashboard/Dashboard.tsx` | MODIFY | New layout, fetch markets, pass data everywhere |
| `src/components/dashboard/IntelFeed.tsx` | MODIFY | Tags, confidence, flash banner, visual polish |
| `src/components/dashboard/ThreatEngine.tsx` | MODIFY | Radial gauges, WATCHCON badge, market integration |
| `src/components/dashboard/AIAssistant.tsx` | MODIFY | SITREP generator, market context |
| `supabase/functions/threat-engine/index.ts` | MODIFY | Accept market odds as indicators |
| `src/index.css` | MODIFY | New animations, glassmorphism, glow effects |
| `tailwind.config.ts` | MODIFY | New animation keyframes |
| `supabase/config.toml` | MODIFY | Register prediction-markets function |

---

## Free APIs Used

| API | Endpoint | Data |
|-----|----------|------|
| Polymarket Gamma | `GET /events?active=true&...` | Live prediction market odds |
| GDELT DOC 2.0 | `GET /api/v2/doc/doc?...` (x3 queries) | Real-time conflict news |
| adsb.lol | `GET /v2/mil` | Military aircraft positions |
| CartoDB | Dark Matter tiles | Map tiles |

All free, no API keys required.

