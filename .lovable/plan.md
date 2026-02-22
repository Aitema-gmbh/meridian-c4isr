

# 10x Upgrade: Live Intel + Real Interactive Map

## Overview
Transform the dashboard from a demo with mock data and a static image into a production-grade intelligence platform with a real interactive map, live OSINT data, and real-time ADS-B military aircraft tracking -- all using free, no-auth-required APIs.

---

## Part 1: Interactive Tactical Map (ThreatMatrix)

**Current state:** Static JPG image with CSS-positioned dots.

**Upgrade:**
- Replace with **Leaflet** (`react-leaflet`) using **CartoDB Dark Matter** tiles -- free, no API key, dark tactical aesthetic
- Center on Persian Gulf / CENTCOM AOR (lat 26.5, lng 53, zoom 5)
- **Live ADS-B military aircraft** from `https://api.adsb.lol/v2/mil` (free, no auth, CORS enabled) -- fetched directly from the browser every 30 seconds
- Each aircraft rendered as a cyan pulsing circle marker with tooltip showing callsign, altitude, speed, aircraft type
- Iranian mock assets rendered as crimson diamond markers (no public API for hostile positions)
- US naval mock assets rendered as larger cyan markers with labels
- Custom dark map styling, no default Leaflet blue markers
- Bounding box filter to show only Persian Gulf region aircraft (lat 20-35, lng 44-65)

**New dependencies:** `leaflet`, `react-leaflet`, `@types/leaflet`

**Files changed:**
- `src/components/dashboard/ThreatMatrix.tsx` -- full rewrite to Leaflet
- `src/index.css` -- add Leaflet CSS import

---

## Part 2: Live OSINT Intel Feed

**Current state:** Hardcoded `MOCK_INTEL_FEED` array, never updates.

**Upgrade:**
- Create new edge function `live-intel` that:
  1. Fetches real articles from **GDELT DOC 2.0 API** (`https://api.gdeltproject.org/api/v2/doc/doc?query=iran%20OR%20hormuz%20OR%20persian%20gulf&mode=artlist&format=json&maxrecords=15`) -- free, no auth
  2. Fetches military aircraft count from **adsb.lol** `/v2/mil` for the Gulf bounding box
  3. Sends GDELT articles to **Gemini Flash** (via Lovable AI Gateway) to:
     - Classify priority (HIGH/MEDIUM/LOW)
     - Extract entities (military units, locations, political figures)
     - Score sentiment (-1 to +1)
     - Summarize each article into a tactical intel brief
  4. Returns structured JSON array matching IntelFeed format plus metadata (aircraft count, article count)

- Update `IntelFeed.tsx` to:
  - Fetch from `live-intel` edge function on mount
  - Auto-refresh every 5 minutes
  - Show manual refresh button
  - Display loading skeleton while fetching
  - Show live data count in header
  - Fall back gracefully if API fails

**Files created:**
- `supabase/functions/live-intel/index.ts`

**Files changed:**
- `src/components/dashboard/IntelFeed.tsx` -- fetch live data instead of mock
- `supabase/config.toml` -- register `live-intel` function

---

## Part 3: Real Threat Engine Indicators

**Current state:** `ThreatEngine.tsx` sends hardcoded indicator values to the threat-engine edge function.

**Upgrade:**
- Create a shared context/state that passes real data from the live intel feed into the Threat Engine
- The `ThreatEngine` component will:
  - Accept real GDELT article count, average sentiment, and ADS-B military track count from the live-intel response
  - Pass these as actual indicators to the existing `threat-engine` edge function
  - The AI then calculates threat probabilities based on **real current data** instead of static numbers

**Files changed:**
- `src/components/dashboard/ThreatEngine.tsx` -- accept and use real indicators
- `src/components/dashboard/Dashboard.tsx` -- lift live intel state up, pass to both IntelFeed and ThreatEngine

---

## Part 4: Live Data Ticker

**Current state:** Hardcoded static ticker items.

**Upgrade:**
- Dashboard ticker shows real counts from live data: actual military tracks, actual GDELT article count, real tension index from threat engine
- Updates dynamically as data refreshes

**Files changed:**
- `src/components/dashboard/Dashboard.tsx` -- dynamic ticker from live state

---

## Part 5: Enhanced AI Assistant Context

**Current state:** The intel-chat edge function has static context in its system prompt.

**Upgrade:**
- Frontend sends current live intel data (latest articles, threat scores, aircraft count) alongside chat messages
- Edge function injects this real context into the system prompt so the AI can reference **actual current intelligence** when answering queries

**Files changed:**
- `src/components/dashboard/AIAssistant.tsx` -- pass live context
- `supabase/functions/intel-chat/index.ts` -- accept and inject live context

---

## Architecture Flow

```text
Browser (ThreatMatrix.tsx)
  |-- Direct fetch: https://api.adsb.lol/v2/mil (every 30s)
  |-- Renders aircraft on Leaflet dark map

Browser (Dashboard.tsx) -- on mount
  |-- Calls edge function: live-intel
  |     |-- Fetches: GDELT DOC 2.0 API (real articles)
  |     |-- Fetches: adsb.lol /v2/mil (aircraft count)
  |     |-- AI: Gemini Flash analyzes + structures articles
  |     |-- Returns: structured intel items + metadata
  |
  |-- Passes intel data to:
        |-- IntelFeed.tsx (displays articles)
        |-- ThreatEngine.tsx (real indicators -> threat-engine edge function)
        |-- AIAssistant.tsx (live context for chat)
        |-- DataTicker (real counts)
```

---

## Free APIs Used (no keys, no accounts)

| API | Endpoint | Data | Rate Limit |
|-----|----------|------|------------|
| adsb.lol | `GET /v2/mil` | Live military aircraft positions worldwide | Generous, community-run |
| GDELT DOC 2.0 | `GET /api/v2/doc/doc?...` | Real-time global conflict news | Unlimited |
| CartoDB | Dark Matter tiles | Map tiles | Free tier |

---

## Summary of All File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/components/dashboard/ThreatMatrix.tsx` | Rewrite | Leaflet map + live ADS-B aircraft |
| `src/components/dashboard/IntelFeed.tsx` | Rewrite | Live GDELT + AI-analyzed feed |
| `src/components/dashboard/ThreatEngine.tsx` | Modify | Accept real indicators from live data |
| `src/components/dashboard/AIAssistant.tsx` | Modify | Pass live context to chat |
| `src/components/dashboard/Dashboard.tsx` | Modify | Lift state, dynamic ticker, pass live data |
| `supabase/functions/live-intel/index.ts` | Create | GDELT + ADS-B + AI analysis edge function |
| `supabase/functions/intel-chat/index.ts` | Modify | Accept live context in system prompt |
| `src/index.css` | Modify | Add Leaflet CSS import |
| `supabase/config.toml` | Modify | Register live-intel function |

No mock data will remain in active use. The `mockData.ts` file stays for fallback/reference but is no longer imported by any live component.
