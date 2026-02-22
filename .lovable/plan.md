

# MERIDIAN Multi-Agent Intelligence System v2

## Status Quo

Aktuell gibt es ein monolithisches System:
- `intel-agent`: Macht alles auf einmal (GDELT + Reddit + ADS-B + Polymarket + AI-Analyse + DB-Speicherung)
- `live-intel`: Echtzeit-Version fuer Frontend (GDELT + ADS-B)
- `reddit-intel`: Separate Reddit-Analyse
- `threat-engine`: AI-basierte Threat-Berechnung
- `prediction-markets`: Polymarket Iran-Markets
- `ais-proxy`: Militaer-Schiffsdatenbank + optionale Live-AIS

Das Problem: Alles laeuft reaktiv (Frontend ruft an), es gibt keinen dauerhaften Agenten-Zyklus, und die Datenquellen sind limitiert.

## Recherche-Ergebnisse: Was ist WIRKLICH kostenlos und verfuegbar?

### Verifizierte kostenlose Datenquellen (kein API-Key noetig)

| Quelle | URL | Format | Daten | Limit |
|--------|-----|--------|-------|-------|
| GDELT DOC API v2 | api.gdeltproject.org/api/v2/doc/doc | JSON | Nachrichtenartikel, Sentiment, GKG Themes | Kein offizielles Limit, Fair Use |
| GDELT GKG Themes | Ueber DOC API mit `theme:` Parameter | JSON | Thematische Artikel (TERROR, WMD, MILITARY, etc.) | Wie oben |
| adsb.lol /v2/mil | api.adsb.lol/v2/mil | JSON | Alle Militaerflugzeuge weltweit, Echtzeit | Kein Limit, Open Data (ODbL) |
| adsb.lol /v2/point | api.adsb.lol/v2/point/{lat}/{lon}/{radius} | JSON | Alle Flugzeuge in Radius | Kein offizielles Limit |
| Reddit RSS | reddit.com/r/{sub}/.rss | Atom/XML | Oeffentliche Subreddit-Posts | Rate-limited, Fair Use |
| Polymarket Gamma API | gamma-api.polymarket.com/events | JSON | Prediction Markets, Odds, Volume | Kein offizielles Limit |
| defense.gov RSS | defense.gov/DesktopModules/.../Rss.aspx | RSS/XML | Pentagon Pressemitteilungen, Contracts, Releases | Oeffentlich |
| centcom.mil | centcom.mil/MEDIA/PRESS-RELEASES/ | HTML | CENTCOM Pressemitteilungen | Scraping noetig |
| ACLED | api.acleddata.com | JSON | Konfliktereignisse weltweit, Gewaltdaten | Kostenlos fuer Non-Commercial, braucht Account |

### Quellen die API-Key brauchen (kostenlos registrierbar)

| Quelle | API-Key | Daten |
|--------|---------|-------|
| AlienVault OTX | Ja (kostenlose Registrierung) | 20M+ Threat Indicators/Tag, APT Pulses, IoCs |
| aisstream.io | Ja (kostenlose Registrierung) | Live AIS Schiffspositionen weltweit |

### Quellen die NICHT funktionieren

| Quelle | Warum nicht |
|--------|-------------|
| X/Twitter API | Kein kostenloser Tier mehr seit 2023. Basic $100/Monat |
| Nitter | Tot / instabil seit 2024 |
| Shadowserver | Braucht manuelle Verifikation + ist fuer Netzwerk-Betreiber |
| ACLED | Braucht Account-Beantragung und ist nur non-commercial |
| OpenShipData | Nur europaeische Binnengewaesser |

## Der neue Plan: 7 spezialisierte Agenten + 1 Head Analyst

### Architektur

```text
Cron-Scheduler (pg_cron)
    |
    +-- Minute 0:  agent-flights     (adsb.lol, alle 10 Min)
    +-- Minute 2:  agent-naval       (Militaer-DB + AIS, alle 15 Min)
    +-- Minute 5:  agent-osint       (GDELT 3 Streams + GKG Themes, alle 20 Min)
    +-- Minute 8:  agent-reddit      (Reddit RSS, alle 30 Min)
    +-- Minute 10: agent-pentagon    (defense.gov RSS + CENTCOM, alle 60 Min)
    +-- Minute 12: agent-cyber       (GDELT Cyber + OTX wenn Key, alle 30 Min)
    +-- Minute 15: agent-markets     (Polymarket, alle 15 Min)
    +-- Minute 20: agent-head-analyst (Synthese ALLER Reports, alle 30 Min)
    |
    v
  [agent_reports Tabelle]
    |
    v
  Frontend liest aus DB (kein direkter API-Call mehr noetig)
```

### Agent 1: FLIGHT AGENT (`agent-flights`)
**Frequenz:** Alle 10 Minuten
**Datenquellen:**
- `api.adsb.lol/v2/mil` -- alle Militaerflugzeuge weltweit
- Filterung auf CENTCOM AOR (lat 20-35, lon 44-65) + Red Sea (lat 11-20, lon 38-45)

**Was er tut:**
1. Fetcht alle Mil-Tracks von adsb.lol
2. Filtert auf CENTCOM-Region
3. Kategorisiert: ISR/Surveillance (E-3, RC-135, P-8, RQ-4), Tanker (KC-135, KC-10), Fighter (F-18, F-15, F-35), Transport (C-17, C-130), Heli (MH-60, CH-47)
4. Erkennt Anomalien: ISR-Orbits (kreisende Muster), ungewoehnlich hohe Aktivitaet, neue Flugzeugtypen
5. Berechnet Flight Anomaly Index (0-100)
6. Schreibt in `agent_reports`

**Kein AI noetig** -- rein algorithmisch basierend auf Patterns.

### Agent 2: NAVAL AGENT (`agent-naval`)
**Frequenz:** Alle 15 Minuten
**Datenquellen:**
- Kuratierte Militaerschiff-Datenbank (21 Schiffe, bereits in ais-proxy)
- aisstream.io WebSocket (wenn AISSTREAM_API_KEY vorhanden)

**Was er tut:**
1. Laedt Militaerschiff-Positionen (mit realistischem Drift basierend auf Kurs/Geschwindigkeit)
2. Wenn API-Key: sammelt Live-Handelschiffe aus aisstream.io (4 Sek WebSocket)
3. Berechnet Maritime Anomaly Index:
   - AIS-Gaps (Schiffe die ploetzlich verschwinden)
   - Ungewoehnliche Formationen (Kriegsschiffe nahe beieinander)
   - Tanker-Stau an Hormuz
4. Schreibt kombinierte Vessel-Daten + Anomaly-Report in `agent_reports`

**Kein AI noetig** -- algorithmisch.

### Agent 3: OSINT AGENT (`agent-osint`)
**Frequenz:** Alle 20 Minuten
**Datenquellen (alle kostenlos, kein API-Key):**
- GDELT DOC API Stream 1: `(iran OR hormuz OR "persian gulf" OR IRGC OR houthi)` -- 15 Artikel
- GDELT DOC API Stream 2: `("US military" OR CENTCOM OR deployment OR "5th fleet")` -- 12 Artikel
- GDELT DOC API Stream 3: `(theme:WMD OR theme:MILITARY OR theme:TERROR) AND (iran OR gulf)` -- 10 Artikel (GKG Theme-basiert)
- GDELT DOC API Stream 4: `("nuclear" OR "uranium enrichment" OR IAEA) AND iran` -- 8 Artikel

**Was er tut:**
1. Fetcht 4 GDELT-Streams parallel
2. Dedupliziert nach URL
3. AI analysiert alle Artikel: Priority, Threat-Tag, Entities, Sentiment, Confidence
4. Erstellt Flash Report
5. Speichert in `agent_reports` UND `intel_snapshots` (Backward Compatibility)

**AI-Modell:** google/gemini-2.5-flash-lite (schnellstes, guenstigstes)

### Agent 4: REDDIT AGENT (`agent-reddit`)
**Frequenz:** Alle 30 Minuten
**Datenquellen (kostenlos, kein API-Key):**
- r/geopolitics RSS (Suche: iran)
- r/worldnews RSS (Suche: iran OR hormuz OR persian gulf)
- r/CredibleDefense RSS (Suche: iran OR gulf OR CENTCOM)
- r/OSINT RSS (Suche: iran OR military)
- r/iran RSS (allgemein)

**Was er tut:**
1. Fetcht RSS-Feeds mit Retry + Rate-Limit-Respekt
2. Parsed Atom-XML (kein externer Parser noetig)
3. AI filtert relevante Posts, bewertet Signalqualitaet
4. Speichert in `agent_reports`

**AI-Modell:** google/gemini-2.5-flash-lite

### Agent 5: PENTAGON AGENT (`agent-pentagon`)
**Frequenz:** Alle 60 Minuten
**Datenquellen (alle kostenlos, kein API-Key):**
- defense.gov Contracts RSS: `https://www.defense.gov/DesktopModules/ArticleCS/RSS.aspx?ContentType=400&Site=945`
- defense.gov Releases RSS: `https://www.defense.gov/DesktopModules/ArticleCS/RSS.aspx?ContentType=1&Site=945`
- defense.gov Advisories RSS: `https://www.defense.gov/DesktopModules/ArticleCS/RSS.aspx?ContentType=9&Site=945`
- CENTCOM Press Releases: GDELT DOC API mit `domain:centcom.mil` Filter

**Was er tut:**
1. Fetcht alle Pentagon RSS-Feeds parallel
2. Parsed RSS-XML
3. Filtert auf Iran/Gulf/CENTCOM-relevante Eintraege
4. AI analysiert: Contract-Anomalien (grosse Navy-Auftraege, Munitionsbestellungen), ungewoehnliche Presseerklaerungen, Aktivitaetsniveau
5. Berechnet Pentagon Activity Index (0-100)
6. Speichert in `agent_reports`

**Zur "Pizza-Metrik":** Die echte Pentagon-Pizza-Korrelation ist historisch real (erhoehte Pizzalieferungen = Krisenstab tagt nachts), aber es gibt keine freie API um das zu tracken. Stattdessen nutzen wir als Proxy: Haeufigkeit/Zeitpunkt von Pentagon-Pressemitteilungen (naechtliche Releases = erhoehte Aktivitaet).

**AI-Modell:** google/gemini-2.5-flash-lite

### Agent 6: CYBER AGENT (`agent-cyber`)
**Frequenz:** Alle 30 Minuten
**Datenquellen:**
- GDELT DOC API Cyber-Stream: `("cyber attack" OR APT OR ransomware OR "critical infrastructure" OR "power grid") AND (iran OR gulf OR "middle east")`
- GDELT DOC API Cyber-Stream 2: `("APT33" OR "APT34" OR "APT35" OR "Charming Kitten" OR "MuddyWater" OR "OilRig")` -- bekannte iranische APT-Gruppen
- AlienVault OTX Pulses API: `https://otx.alienvault.com/api/v1/pulses/subscribed?modified_since=...` (wenn OTX_API_KEY vorhanden)

**Was er tut:**
1. GDELT Cyber-Artikel fetchen (immer verfuegbar)
2. Wenn OTX_API_KEY: Aktive Threat Pulses mit Iran/Gulf-Bezug laden
3. AI bewertet: Aktive APT-Kampagnen, Cyber Threat Level, kritische Infrastruktur-Bedrohungen
4. Speichert in `agent_reports`

**AI-Modell:** google/gemini-2.5-flash-lite

### Agent 7: MARKETS AGENT (`agent-markets`)
**Frequenz:** Alle 15 Minuten
**Datenquellen (kostenlos, kein API-Key):**
- Polymarket Gamma API: Events mit Tag "iran", "middle-east"
- Polymarket Gamma API: Keyword-Suche fuer "iran", "war", "military conflict", "nuclear"
- Bekannte Slug-Liste (bereits implementiert)

**Was er tut:**
1. Fetcht Iran-bezogene Markets (bestehende Logik aus prediction-markets)
2. Vergleicht aktuelle Odds mit letztem Snapshot (Trend-Erkennung)
3. Erkennt signifikante Preisbewegungen (>5% in 15 Min)
4. Speichert in `agent_reports` UND `market_snapshots`

**Kein AI noetig** -- rein algorithmisch.

### Agent 8: HEAD ANALYST (`agent-head-analyst`)
**Frequenz:** Alle 30 Minuten (nachdem andere Agenten gelaufen sind)
**Datenquellen:**
- Alle `agent_reports` der letzten 60 Minuten aus der DB
- Letzte `threat_assessments` fuer Trend-Vergleich

**Was er tut:**
1. Laedt Reports aller 7 Agenten aus der DB
2. Erstellt umfassenden Kontext fuer AI:
   - Flight Anomaly Index + aktive ISR-Orbits
   - Maritime Anomaly Index + Schiffspositionen
   - OSINT Sentiment + Top-Artikel
   - Reddit Social Signals
   - Pentagon Activity Index
   - Cyber Threat Level + aktive APTs
   - Market Odds + Preisbewegungen
3. AI berechnet:
   - Gesamt-Tension-Index (0-100)
   - WATCHCON Level (1-5)
   - Einzelwahrscheinlichkeiten (Hormuz, Cyber, Proxy, Direct)
   - FLASH REPORT (5 Saetze)
   - Divergenzen (AI-Bewertung vs. Polymarket-Odds)
   - Agenten-Konflikte (wenn Agenten sich widersprechen)
4. Speichert in `threat_assessments` UND `intel_snapshots`

**AI-Modell:** google/gemini-2.5-flash (staerker als lite, fuer Synthese)

## Datenbank-Aenderungen

### Neue Tabelle: `agent_reports`

```text
agent_reports
  - id: uuid (PK, default gen_random_uuid())
  - created_at: timestamptz (default now())
  - agent_name: text NOT NULL (z.B. "flights", "naval", "osint", "reddit", "pentagon", "cyber", "markets", "head-analyst")
  - report_type: text NOT NULL ("cycle" | "alert")
  - data: jsonb NOT NULL (Agent-spezifische Daten)
  - summary: text (1-Absatz Zusammenfassung)
  - threat_level: numeric (0-100)
  - confidence: text ("HIGH" | "MEDIUM" | "LOW")
  - items_count: integer DEFAULT 0
```

RLS: Public read (wie bestehende Tabellen), Service-Role write (Agenten schreiben mit Service Role Key).

Realtime aktiviert fuer Live-Updates im Frontend.

### Bestehende Tabellen bleiben
- `intel_snapshots` -- weiterhin beschrieben von OSINT + Head Analyst
- `market_snapshots` -- weiterhin beschrieben von Markets Agent
- `threat_assessments` -- weiterhin beschrieben von Head Analyst

## Frontend-Aenderungen

### Dashboard.tsx
- Statt `live-intel` und `reddit-intel` direkt aufzurufen, laedt das Dashboard aus der DB (`agent_reports`, `intel_snapshots`, `market_snapshots`)
- Realtime-Subscription auf `agent_reports` fuer Live-Updates
- Data Ticker zeigt Status jedes Agenten (letzte Laufzeit, Threat Level)
- Agenten laufen im Hintergrund via Cron -- Frontend ist nur noch Viewer

### ThreatEngine.tsx
- Liest direkt aus `threat_assessments` (letzte Head Analyst Bewertung)
- Kein eigener API-Call mehr an `threat-engine` noetig
- Zeigt Agent-Divergenzen und Konflikte an

## Cron-Jobs (pg_cron + pg_net)

Gestaffelte Ausfuehrung um die Edge Functions nicht zu ueberlasten:

```text
*/10 * * * *  -> agent-flights       (alle 10 Min)
2-59/15 * * * * -> agent-naval       (alle 15 Min, Offset 2)
4-59/20 * * * * -> agent-osint       (alle 20 Min, Offset 4)
8-59/30 * * * * -> agent-reddit      (alle 30 Min, Offset 8)
10 * * * *    -> agent-pentagon      (jede Stunde, Minute 10)
12-59/30 * * * * -> agent-cyber      (alle 30 Min, Offset 12)
5-59/15 * * * * -> agent-markets     (alle 15 Min, Offset 5)
20-59/30 * * * * -> agent-head-analyst (alle 30 Min, Offset 20)
```

## Dateien die erstellt/geaendert werden

| Datei | Aktion |
|-------|--------|
| `supabase/functions/agent-flights/index.ts` | NEU |
| `supabase/functions/agent-naval/index.ts` | NEU (uebernimmt Logik aus ais-proxy) |
| `supabase/functions/agent-osint/index.ts` | NEU (uebernimmt + erweitert live-intel) |
| `supabase/functions/agent-reddit/index.ts` | NEU (uebernimmt + erweitert reddit-intel) |
| `supabase/functions/agent-pentagon/index.ts` | NEU |
| `supabase/functions/agent-cyber/index.ts` | NEU |
| `supabase/functions/agent-markets/index.ts` | NEU (uebernimmt prediction-markets Logik) |
| `supabase/functions/agent-head-analyst/index.ts` | NEU |
| DB Migration | NEU: `agent_reports` Tabelle + Realtime |
| `supabase/config.toml` | Update: alle neuen Functions registrieren (verify_jwt = false) |
| `src/components/dashboard/Dashboard.tsx` | Umbauen: DB-basiertes Laden + Realtime |
| `src/components/dashboard/ThreatEngine.tsx` | Umbauen: Liest aus DB statt API-Call |

Alte Edge Functions (`live-intel`, `reddit-intel`, `prediction-markets`, `intel-agent`) bleiben vorerst erhalten fuer Backward Compatibility, werden aber nicht mehr vom Frontend aufgerufen.

## Voraussetzungen / Secrets

| Secret | Wofuer | Pflicht? | Status |
|--------|--------|----------|--------|
| LOVABLE_API_KEY | AI-Analysen in 4 Agenten | Ja | Bereits vorhanden |
| SUPABASE_URL | DB-Zugriff | Ja | Bereits vorhanden |
| SUPABASE_SERVICE_ROLE_KEY | DB-Schreibzugriff | Ja | Bereits vorhanden |
| AISSTREAM_API_KEY | Live-AIS Handelschiffe | Nein | Optional |
| OTX_API_KEY | AlienVault Cyber Threat Intel | Nein | Optional (kostenlose Registrierung) |

Alle Agenten funktionieren ohne optionale Keys -- sie nutzen dann nur die kostenlosen Quellen.

## Implementierungsreihenfolge

1. DB-Migration: `agent_reports` Tabelle + RLS + Realtime
2. Agent-flights + Agent-naval (kein AI, schnell testbar)
3. Agent-osint + Agent-reddit (AI-basiert, basieren auf bestehender Logik)
4. Agent-pentagon + Agent-cyber (neue Quellen)
5. Agent-markets (Polymarket, basiert auf bestehender Logik)
6. Agent-head-analyst (Synthese)
7. Frontend umbauen (DB-basiert + Realtime)
8. Cron-Jobs einrichten
9. Alte Functions aufraeuemen

