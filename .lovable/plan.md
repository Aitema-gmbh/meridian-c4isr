
# Fix Runtime Crash: `averageSentiment.toFixed` on undefined

## Problem
The app crashes with `TypeError: undefined is not an object (evaluating 'm.averageSentiment.toFixed')` in the DataTicker component. This happens because the metadata object exists but `averageSentiment` can be `undefined` or `null` (e.g., from database snapshots or API responses that omit it).

The same unsafe access pattern exists in 3 files.

## Fix
Add safe fallback (`?? 0`) before calling `.toFixed()` in all 3 locations:

### 1. `src/components/dashboard/Dashboard.tsx` (line 77)
Change:
```
m.averageSentiment.toFixed(2)
```
to:
```
(m.averageSentiment ?? 0).toFixed(2)
```

### 2. `src/components/dashboard/ThreatEngine.tsx` (lines 142, 144)
Add safe fallback for `meta.averageSentiment`:
- Line 142: `(meta.averageSentiment ?? 0) * 10`
- Line 144: `(meta.averageSentiment ?? 0).toFixed(2)`

### 3. `src/components/dashboard/AIAssistant.tsx` (line 35)
Change:
```
m.averageSentiment.toFixed(2)
```
to:
```
(m.averageSentiment ?? 0).toFixed(2)
```

These are simple one-line null-safety fixes that will prevent the crash.
