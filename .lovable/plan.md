

# E2E Test Results and Fixes Required

## Test Results Summary

| Component | Status | Details |
|-----------|--------|---------|
| Live Intel (GDELT + AI) | WORKING | Returns 12-18 articles with source URLs, flash report, threat tags |
| Threat Engine | WORKING | Returns tension index, WATCHCON, probabilities, market divergences |
| Reddit Intel | BROKEN | Returns 0 items every time (Reddit blocks server-side requests) |
| Prediction Markets | PARTIALLY BROKEN | Returns only 3 China/India results -- NOT Iran-focused, no Iran markets found |
| Intel Agent (hourly) | WORKING (partial) | Runs successfully, stores in DB, but inherits Reddit (0 posts) and GDELT (0 articles from edge function context) issues |
| Database Storage | WORKING | All 3 tables populated after intel-agent run |
| Cron Job | WORKING | Configured hourly at `0 * * * *` |
| ADS-B Map | BROKEN (client) | `api.adsb.lol` blocked by browser CORS -- every request fails with "Load failed" |
| Dashboard UI | WORKING | 3-column layout, tabs, ticker all render |

---

## Issues to Fix

### Issue 1: Prediction Markets -- No Iran Results
**Problem:** Polymarket simply does not have active Iran-specific markets. The tag-based search returns unrelated results (MicroStrategy, Trump deportation). The only geopolitical match is "China x India military clash."

**Fix:** Broaden the search to include all geopolitical/conflict markets (not just Iran). Change the filter to accept any conflict/military/geopolitical market. Also try the `/events` endpoint with `title_contains` parameter for better keyword matching.

### Issue 2: Reddit Intel Returns Empty
**Problem:** Reddit's public JSON API returns 403/429 when called from server-side (edge functions). The `reddit-intel` function fetches 0 posts from all 3 subreddits.

**Fix:** Add proper Reddit OAuth app-only authentication (client credentials) or use a fallback: fetch Reddit data inside the `intel-agent` function which already runs server-side and may have different rate limits. Alternatively, add a `User-Agent` that Reddit accepts and handle the 429 with retry logic.

### Issue 3: ADS-B Blocked by Browser CORS
**Problem:** `api.adsb.lol` does not allow cross-origin requests from the browser. Every 30-second poll fails with "Load failed."

**Fix:** Move the ADS-B fetch to the server side -- either into the `live-intel` edge function or `intel-agent`. The ThreatMatrix component should read aircraft positions from the edge function response rather than calling `api.adsb.lol` directly from the browser.

### Issue 4: Intel Agent Gets 0 GDELT Articles
**Problem:** When the intel-agent runs from the edge function, GDELT returns 0 articles (possibly due to edge function timeout or GDELT rate limiting from the Supabase IP).

**Fix:** Add retry logic and longer timeouts for GDELT calls in the intel-agent. Also add error logging for each individual GDELT response status.

---

## Proposed Changes

### 1. Fix Prediction Markets (`supabase/functions/prediction-markets/index.ts`)
- Use `title_contains` parameter: `GET /events?active=true&closed=false&limit=20&title_contains=iran`
- Also search for: "war", "conflict", "middle east", "nuclear", "sanctions", "oil crisis", "hormuz"
- Run multiple keyword searches in parallel and deduplicate
- If no Iran-specific markets exist, return broader geopolitical conflict markets with a flag

### 2. Fix Reddit Intel (`supabase/functions/reddit-intel/index.ts`)
- Add proper HTTP headers that Reddit accepts (valid User-Agent with contact info)
- Add retry with exponential backoff on 429
- Add detailed error logging per subreddit
- Fallback: if all subreddits fail, return empty with a clear error message

### 3. Fix ADS-B Browser CORS (`src/components/dashboard/ThreatMatrix.tsx`)
- Remove direct `api.adsb.lol` fetch from the browser component
- Create a simple proxy edge function `supabase/functions/adsb-proxy/index.ts` that fetches from `api.adsb.lol` server-side
- ThreatMatrix calls the proxy instead

### 4. Fix Intel Agent GDELT Issue (`supabase/functions/intel-agent/index.ts`)
- Add individual response status logging for each GDELT query
- Add 15-second timeout per request
- Add retry logic for failed GDELT fetches

### 5. Dashboard: Load DB Data on Mount (`src/components/dashboard/Dashboard.tsx`)
- The DB loading already works but tables were empty until first intel-agent run
- No code change needed -- now that data is in DB, it will load on mount

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `supabase/functions/prediction-markets/index.ts` | REWRITE | Use `title_contains` keyword search, broaden to geopolitical markets |
| `supabase/functions/reddit-intel/index.ts` | MODIFY | Better User-Agent, retry logic, error logging |
| `supabase/functions/adsb-proxy/index.ts` | CREATE | Server-side proxy for ADS-B API |
| `src/components/dashboard/ThreatMatrix.tsx` | MODIFY | Use adsb-proxy instead of direct browser fetch |
| `supabase/functions/intel-agent/index.ts` | MODIFY | Add GDELT response logging and retry |
| `supabase/config.toml` | MODIFY | Register adsb-proxy function |

