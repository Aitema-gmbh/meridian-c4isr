

# FlightRadar-Style Aircraft Visualization + Stale Data Fix

## Problem 1: Aircraft are tiny circles, not FlightRadar-style
Currently aircraft appear as radius-4 circle dots. The ADS-B data already includes `track` (heading), `alt_baro`, `gs` (speed), `flight` (callsign), `t` (aircraft type like C17, B737, H60) -- but none of this is used visually.

## Problem 2: Stale market data in DB
The `market_snapshots` table still contains old MicroStrategy/Trump data. The threat engine receives this stale data on its second call, producing irrelevant analysis.

---

## Changes

### 1. FlightRadar-style aircraft markers (`src/components/dashboard/ThreatMatrix.tsx`)

Replace `L.circleMarker` with `L.divIcon` using an SVG airplane icon rotated to match the aircraft's heading direction.

- Use an airplane SVG shape (triangle/arrow) rotated via CSS `transform: rotate(${track}deg)`
- Color-code by aircraft type: transport (C17, C130, C30J) = cyan, fighters = yellow, helicopters (H60, NH90) = green, unknown = white
- Show persistent callsign label next to each aircraft icon
- Add `track` field to AircraftData interface
- Larger, more visible icons (20x20px vs 4px radius dots)
- Tooltip keeps existing info (reg, type, altitude, speed) but adds heading

### 2. Clear stale market data from DB
- The Dashboard's `loadFromDB` loads stale MicroStrategy markets on mount, which gets passed to the threat engine
- Fix: Only use fresh API data for markets, not DB fallback. Or update the `intel-agent` function to store Iran-only markets.
- Simpler fix in Dashboard: don't pass DB-loaded markets to ThreatEngine -- only pass fresh `marketsData` from the API call.

---

## Technical Details

### Aircraft Icon Implementation
```text
For each aircraft marker:
1. Create SVG airplane icon (simple triangle pointing up)
2. Wrap in L.divIcon with inline style: transform: rotate(Xdeg)
3. Size: 20x20px, color based on type
4. Permanent tooltip showing callsign (e.g., "RCH578")
```

### Color scheme for aircraft types:
- Transport (C17, C30J, C130, A400, KC135): cyan (#00d4ff)
- Tanker/ISR (E3, E8, RC135, P8): amber (#ffaa00)  
- Helicopter (H60, NH90, A139): green (#44ff88)
- Fighter/other: white

### Files to modify:
| File | Change |
|------|--------|
| `src/components/dashboard/ThreatMatrix.tsx` | Replace circleMarker with rotated airplane divIcon, add callsign labels, color-code by type |
| `src/components/dashboard/Dashboard.tsx` | Fix stale market data: only pass fresh API markets to ThreatEngine, not DB fallback |

