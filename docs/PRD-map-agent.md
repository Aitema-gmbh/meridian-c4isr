# PRD-9: Map Intelligence Agent (`agent-map`)

**Version:** 1.0 | **Date:** 2026-02-23 | **Status:** Draft

---

## Problem Statement

1. **Brittle geocoding** — `/api/map-intel` uses static keyword-to-coordinate matching. Events about "Iran nuclear program" map to Tehran regardless of actual location.
2. **No maritime vessel data** — Frontend has `VesselData` interface and rendering code ready, but no real AIS vessel data feeds it.
3. **No editorial intelligence** — Map shows everything that matches a keyword, with no filtering for signal importance.
4. **Static infrastructure** — Naval bases, chokepoints, shipping lanes are all hardcoded.

## Solution

A new **Map Agent** (#17) that:
- Reads all other agents' reports from D1
- Applies LLM-powered geocoding (gemini-2.5-flash) for precise event placement
- Fetches live AIS vessel positions (AISstream.io)
- Applies editorial judgment (max 15-20 high-signal items)
- Writes structured `map_items` output to `agent_reports`

## User Stories

| ID | Story |
|----|-------|
| US-1 | As analyst, I want events placed at precise incident location (port-level, not country centroid) |
| US-2 | As analyst, I want actual commercial/military vessels on the map |
| US-3 | As analyst, I want only high-signal events (max 15-20), each with "why it matters" annotation |
| US-4 | As analyst, I want events to appear/update/expire based on developments, not just age |
| US-5 | As Head Analyst, I want Map Agent to produce mapSignalIndex for threat assessment |
| US-6 | As analyst, I want chokepoint transit monitoring with deviation alerts |

## Acceptance Criteria

| ID | Criterion |
|----|-----------|
| AC-1 | Events geocoded within 50km of actual location |
| AC-2 | At least 5 vessel positions in Gulf/Red Sea |
| AC-3 | Max 20 map items at any time |
| AC-4 | Each event has `rationale` field (1 sentence) |
| AC-5 | Events > 6h without updates auto-expired |
| AC-6 | Map Agent writes to agent_reports with agent_name: "map" |
| AC-7 | Runs in collection cycle with other 14 agents |
| AC-8 | Frontend backward compatible (aircraft, naval bases, chokepoints unchanged) |
| AC-9 | Vessel markers use existing VesselData interface |
| AC-10 | Response latency < 15 seconds |

## Technical Approach

### Geocoding Strategy (3-tier)
1. **LLM geocoding** (primary) — gemini-2.5-flash knows coordinates for cities, ports, bases
2. **Curated gazetteer** (validation) — ~100 entries with port-level precision, validates LLM output
3. **Nominatim API** (fallback) — OpenStreetMap geocoder for misses

### AIS Vessel Data
Priority: AISstream.io (env binding exists) > MarineTraffic > Scrape > Synthetic

### Map Agent Output Schema
```typescript
{
  mapItems: [{
    lat, lon, location_name, type, title, rationale, severity, source_agent, expires_at
  }],
  vessels: [{
    mmsi, name, type, lat, lon, speed, heading, destination, flag
  }],
  hotspots: [{
    name, lat, lon, radius_km, event_count, assessment
  }],
  vesselAnomalies: [{
    mmsi, name, anomaly_type, description
  }],
  mapSignalIndex: number,
  editorialSummary: string
}
```

## File Ownership

| File | Change |
|------|--------|
| `workers/src/routes/agent-map.ts` | **NEW** — Map Agent |
| `workers/src/routes/data-api.ts` | MODIFY — Rewrite apiMapIntel |
| `workers/src/index.ts` | MODIFY — Add route |
| `src/components/dashboard/ThreatMatrix.tsx` | MODIFY — Consume vessels, rationale, ships legend |

## Task Breakdown

### Phase 1: Backend Core
| # | Task | Size |
|---|------|------|
| T1 | Create agent-map.ts scaffold, register route | S |
| T2 | Event extraction from agent reports | M |
| T3 | LLM geocoding + editorial selection | L |
| T4 | Geocoding validation layer (gazetteer + Nominatim) | M |
| T5 | AIS vessel fetching (AISstream.io) | L |
| T6 | Merge, prioritize, write to DB | M |
| T7 | Vessel anomaly detection | S |

### Phase 2: API Rewrite
| # | Task | Size |
|---|------|------|
| T8 | Rewrite /api/map-intel to read from Map Agent | S |
| T9 | Stale-data fallback (legacy geocoding) | S |

### Phase 3: Frontend
| # | Task | Size |
|---|------|------|
| T10 | Vessel rendering in ThreatMatrix | M |
| T11 | Event tooltips with rationale | S |
| T12 | Header stats + legend update | S |
| T13 | Hotspot visualization (circles + pulse) | M |
| T14 | Event expiration handling | S |

### Phase 4: Integration
| # | Task | Size |
|---|------|------|
| T15 | Add Map Agent to Head Analyst context | S |
| T16 | Update CLAUDE.md documentation | S |
| T17 | End-to-end testing | M |

**Total: 15 tasks (~25h): 7S + 6M + 2L**
