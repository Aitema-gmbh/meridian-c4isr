

# Fix: Replace react-leaflet with Plain Leaflet

## Problem
`react-leaflet` v5 uses React context consumers internally that conflict with Radix UI's `TooltipProvider` (which wraps the entire app in `App.tsx`). This causes `TypeError: render2 is not a function` -- a context consumer collision that cannot be fixed by renaming imports.

## Solution
Rewrite `ThreatMatrix.tsx` to use **plain Leaflet** with `useRef` and `useEffect` instead of `react-leaflet` JSX components. This completely eliminates the React context conflict since Leaflet will manage its own DOM directly.

## Changes

### 1. `src/components/dashboard/ThreatMatrix.tsx` -- Full Rewrite
- Remove all `react-leaflet` imports (`MapContainer`, `TileLayer`, `CircleMarker`, `useMap`)
- Import only `leaflet` directly
- Use a `ref` to a `div` element and initialize the Leaflet map imperatively via `useEffect`
- Add tile layer, circle markers for aircraft and assets all through the Leaflet JS API
- Keep all existing functionality: ADS-B fetch, 30s refresh, tooltips, legend, scanline overlay
- The map will be created once on mount and markers updated on each data refresh

### Technical approach
```text
// Instead of:
<MapContainer><TileLayer /><CircleMarker /></MapContainer>

// Use:
const mapRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  const map = L.map(mapRef.current, { ... });
  L.tileLayer(url).addTo(map);
  // Add markers via L.circleMarker(...)
}, []);
```

This is a single-file change that permanently resolves the context conflict.
