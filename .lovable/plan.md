
# Tiefenanalyse: Was auf GitHub existiert und wie MERIDIAN v3 sie alle schlagen kann

## 1. Die Wettbewerbslandschaft im Detail

### Tier 1: World Monitor (9.3k Stars) -- Der Goldstandard

World Monitor ist mit Abstand das fortschrittlichste Open-Source-Projekt in diesem Bereich. Hier ist was sie haben, das MERIDIAN nicht hat:

**Signalverarbeitung (was World Monitor besser macht):**
- 12 verschiedene Signal-Typen mit praezisen Triggern (Convergence, Triangulation, Velocity Spike, Prediction Leading, Silent Divergence, Flow-Price Divergence, Geographic Convergence, Hotspot Escalation, Military Surge, News Leads Markets, Market Move Explained, Sector Cascade)
- Entity-Aware Correlation mit 600+ Entity Registry (Firmen, Laender, Leaders, Organisationen, Commodities) -- jede Entitaet mit Aliases, Keywords, Sector, Related entities
- Jaccard-Similarity News Clustering mit Inverted Index (O(n) statt O(n^2))
- Signal Deduplication mit TTL pro Signal-Typ (6h fuer Market Signals, 30min fuer News)
- Source Tiering (4 Stufen) + Source Type Classification (Wire, Gov, Intel, Mainstream, Market, Tech)
- Propaganda Risk Indicators fuer State Media

**Country Instability Index (CII) -- ihre beste Innovation:**
- 3-Komponenten Score: Unrest (40%, ACLED+GDELT), Security (30%, Flights+Vessels), Information (30%, News Velocity)
- Scoring Bias Prevention: Log-Dampening fuer high-volume Laender (US bekommt nicht automatisch hohe Scores wegen viel Berichterstattung)
- Conflict Zone Floor Scores (Ukraine mindestens 55, Syria mindestens 50)
- Contextual Score Boosts (Hotspot +10, News Urgency +5, Focal Point +8)
- 20 Laender mit 15-Minuten Learning Mode Warmup
- Server-Side Pre-Computation via /api/risk-scores

**Geographic Convergence Detection:**
- 1-Grad x 1-Grad Grid ueber die gesamte Erde
- 4 Event-Typen: Protests (ACLED/GDELT), Military Flights (OpenSky), Naval Vessels (AIS), Earthquakes (USGS)
- Scoring: type_score = event_types x 25, count_boost = min(25, total_events x 2)
- Alert wenn 3+ verschiedene Event-Typen in derselben Zelle innerhalb 24h

**Infrastructure Cascade Analysis:**
- 279 Infrastruktur-Nodes + 280 Dependency Edges
- Breadth-first Cascade Propagation mit Redundanz-Modelling
- Undersea Cable Activity Monitoring via NGA Maritime Warnings
- Dark Ship Detection (AIS Gaps > 60min)

**Hotspot Escalation (Multi-Component):**
- 4 gewichtete Komponenten: News 35%, CII 25%, Geo Convergence 25%, Military 15%
- 48-Punkt Historie (24h bei 30min Intervallen) mit Linear Regression fuer Trend

**Pentagon Pizza Index (PizzINT):**
- Foot traffic Daten von Restaurants nahe Pentagon, CIA, NSA, State Dept
- DEFCON-Style 5-stufiges Alerting (COCKED PISTOL bis FADE OUT)
- GDELT Tension Pairs (USA-Russia, USA-China, Israel-Iran, etc.)

**Architektur-Vorteil:**
- Desktop App (Tauri) mit OS-Keychain
- 4-stufige LLM Fallback-Kette (OpenAI, Anthropic, Ollama, LM Studio)
- 80+ kuratierte Nachrichtenquellen
- WebSocket AIS Relay ueber Railway
- IndexedDB fuer Client-Side Baseline Storage

### Tier 2: OpenCTI (7k+ Stars) -- Enterprise Cyber Threat Intelligence

- STIX2-konformes Datenmodell
- ElasticSearch-basierte Suche
- 100+ Konnektoren (MISP, VirusTotal, AlienVault, etc.)
- Knowledge Graph Visualisierung
- Playbook Automation
- Nicht vergleichbar mit MERIDIAN (anderes Segment: Cyber IOCs vs. Geopolitik)

### Tier 3: IntelOwl (3k+ Stars) -- IOC Analyse

- 150+ Analyzer fuer IOCs (Hashes, IPs, Domains)
- Connectors zu VirusTotal, OTX, Shodan
- API-first Design
- Ebenfalls anderes Segment: IOC-Analyse, nicht Geopolitik

### Tier 4: Spezialisierte Tools

- **AISight** (neu): Vercel-basiertes AIS Vessel Tracking
- **AIS_Tracker**: Zivile Schiffe die Militaermissionen durchfuehren
- **GeoTrackNet**: ML-basierte Maritime Anomaly Detection mit neuronalen Netzen
- **CrisisCast**: Social Media Crisis Detection mit Big Data Pipeline
- **WhatHappenedThere**: Wikipedia Traffic Spikes + Breaking News Korrelation
- **wikiTrends**: Anomaly Detection auf Wikipedia Traffic (akademisch)
- **Polymarket/agents** (2.2k Stars): Autonome AI Trading Agents fuer Prediction Markets
- **PredictOS**: All-in-one Framework fuer Prediction Markets
- **Gnosis/prediction-market-agent**: Gnosis-basierte Prediction Market Agents

### Kostenlose Daten-APIs die niemand voll ausschoepft

| API | Daten | Nutzung im Oekosystem |
|-----|-------|----------------------|
| GDELT Stability Dashboard | Instabilitaet/Konflikt pro Land, 15min Updates | World Monitor nutzt es, MERIDIAN nicht |
| ACLED API | Konflikt-Events global, weoechentlich | World Monitor nutzt es fuer CII |
| VIEWS Forecasting | Konflikt-Prognosen 3-36 Monate | Niemand nutzt es |
| Conflictmeter.org | Civil War Risk Scoring | Niemand nutzt es |
| GDELT GKG Trends | Themen-Trends in Echtzeit | Teilweise genutzt |
| Wikimedia Pageviews | Pageview-Spikes auf Krisenartikeln | MERIDIAN hat es, World Monitor nicht |
| NASA FIRMS | Feuer/Explosionen Satellit | MERIDIAN hat es, World Monitor nutzt NASA EONET |
| USGS Earthquake | Erdbeben global | Beide haben es |

## 2. MERIDIANs einzigartige Staerken (was NIEMAND hat)

| Feature | World Monitor | OpenCTI | IntelOwl | MERIDIAN |
|---------|--------------|---------|----------|----------|
| **Autonome Cron-Agenten** | Nein (client-polling) | Connectors (manuell) | Analyzers (on-demand) | 11 autonome Agenten |
| **AI Head Analyst Synthese** | AI Insights (single LLM) | Nein | Nein | Multi-Agent zu Head Analyst |
| **Agent-Divergenz-Erkennung** | Nein | Nein | Nein | Ja (agentConflicts) |
| **DB-persistente Historie** | IndexedDB (client) | PostgreSQL | PostgreSQL | PostgreSQL (server) |
| **Serverless Backend** | Vercel + Railway | Docker Compose | Docker | Supabase Edge Functions |
| **Prediction Market Integration** | Polymarket (display) | Nein | Nein | Polymarket + AI Divergenz-Analyse |
| **Wikipedia Crisis Correlation** | Nein | Nein | Nein | agent-wiki (mit Baselines) |
| **Macro Safe-Haven Flows** | Partial (FRED) | Nein | Nein | agent-macro (CHF/USD, Oil, VIX) |

## 3. Was MERIDIAN fehlt (und was implementiert werden muss)

### Kritisch (World Monitor hat es, wir nicht)

1. **CII ist leer**: `country_scores` hat 0 Eintraege. Head Analyst berechnet keine CII. Das ist unser groesstes Feature-Gap.

2. **Tension History zeigt Mock-Daten**: `MOCK_TENSION_HISTORY` wird in ThreatEngine.tsx benutzt statt echte `threat_assessments` aus der DB.

3. **Network Graph ist statisch**: `MOCK_NETWORK_NODES/LINKS` statt dynamisch aus agent_reports generiert.

4. **Geographic Convergence fehlt komplett**: Kein 1-Grad Grid, keine Multi-Source Convergence Detection.

5. **News Clustering fehlt**: Keine Jaccard-Similarity, keine Velocity Analysis, keine Source Tiering.

6. **Entity Registry fehlt**: Kein Entity-Aware Correlation System.

7. **Signal System fehlt**: Keine 12 Signal-Typen wie World Monitor.

8. **Baseline System unvollstaendig**: Nur agent-wiki schreibt in agent_baselines. Andere 9 Agenten nicht.

### Mittlere Prioritaet

9. **Source Bias Prevention fehlt**: Keine Log-Dampening, keine Conflict Zone Floors.
10. **Infrastructure Cascade fehlt**: Keine Dependency-Graph Analyse.
11. **Dark Ship Detection fehlt**: Keine AIS Gap Erkennung.
12. **Pentagon Pizza (PizzINT) fehlt**: Wir haben pentagon agent, aber kein Foot Traffic.

## 4. Der MERIDIAN v3 Masterplan (priorisiert)

### Phase 1: Sofort umsetzbar (dieses Gespraech)

**1a. MOCK_TENSION_HISTORY durch echte DB-Daten ersetzen**
- ThreatEngine.tsx: `threat_assessments` aus DB laden (letzte 24h, max 12 Punkte)
- Fallback auf Mock nur wenn DB leer
- Keine AI Credits noetig

**1b. Head Analyst: CII Berechnung einbauen**
- Nach Synthese aller Agenten: CII pro Land berechnen
- Algorithmus basierend auf World Monitor aber vereinfacht:
  - OSINT-Sentiment pro Land (aus agent-osint Artikeln)
  - Militaeraktivitaet (aus agent-flights und agent-naval)
  - Markt-Odds (aus agent-markets)
  - Wikipedia-Spikes (aus agent-wiki)
  - Reddit-Signals (aus agent-reddit)
- In `country_scores` speichern
- 10 Laender: Iran, Israel, Saudi-Arabien, UAE, Yemen, Iraq, Qatar, Bahrain, Oman, Kuwait

**1c. Alle Agenten: Baseline-Daten schreiben**
- Welford's Online Algorithmus in jeden Agenten einbauen
- `agent_baselines` Tabelle fuellen
- Z-Score Berechnung: (current - mean) / sqrt(variance)

**1d. CountryBrief: Echte CII-Daten anzeigen**
- Aus `country_scores` laden statt Platzhalter
- Trend-Pfeile (24h Vergleich)

### Phase 2: Naechste Iteration

**2a. Geographic Convergence Detection**
- Im Head Analyst: Wenn 3+ Agenten erhoehte Werte in derselben Region melden
- Convergence Score als Teil der Synthese
- Neues Frontend-Component: ConvergenceAlert

**2b. Tension History Chart mit echten Daten**
- `threat_assessments` der letzten 7 Tage laden
- Trend-Linie mit Recharts

**2c. Network Graph dynamisch**
- Aus agent_reports Entitaeten extrahieren
- Force-directed Graph aus echten Daten generieren

### Phase 3: Differenzierung

**3a. Entity Registry (vereinfacht)**
- 50 Kern-Entities: Laender, Militaergruppen, Organisationen, Unternehmen
- Aliases und Keywords
- News-Market Korrelation

**3b. Signal System**
- 6 Signal-Typen (statt World Monitors 12, da wir Agenten haben):
  - Agent Convergence (3+ Agenten eskalieren gleichzeitig)
  - Market Divergence (AI vs. Polymarket)
  - Baseline Anomaly (Z-Score > 2.5)
  - CII Spike (Land +10 Punkte in 24h)
  - Wikipedia Crisis (Pageview Spike > 3x)
  - Macro Risk Alert (Safe-Haven Flows aktiviert)

**3c. Source Tiering**
- GDELT, Reddit, Pentagon, Wikipedia nach Autoritaet gewichten
- Head Analyst beruecksichtigt Source Quality

## 5. Technische Umsetzung (Phase 1)

### Aenderungen an bestehenden Dateien

| Datei | Aenderung |
|-------|-----------|
| `ThreatEngine.tsx` | MOCK_TENSION_HISTORY ersetzen durch DB-Query auf threat_assessments |
| `agent-head-analyst/index.ts` | CII-Berechnung + country_scores INSERT |
| `agent-flights/index.ts` | Baseline-Schreibung hinzufuegen |
| `agent-naval/index.ts` | Baseline-Schreibung hinzufuegen |
| `agent-osint/index.ts` | Baseline-Schreibung hinzufuegen |
| `agent-reddit/index.ts` | Baseline-Schreibung hinzufuegen |
| `agent-pentagon/index.ts` | Baseline-Schreibung hinzufuegen |
| `agent-cyber/index.ts` | Baseline-Schreibung hinzufuegen |
| `agent-markets/index.ts` | Baseline-Schreibung hinzufuegen |
| `agent-macro/index.ts` | Baseline-Schreibung hinzufuegen |
| `agent-fires/index.ts` | Baseline-Schreibung hinzufuegen |
| `CountryBrief.tsx` | Echte country_scores laden |
| `mockData.ts` | MOCK_TENSION_HISTORY als Fallback behalten |

### Head Analyst CII Algorithmus (vereinfacht)

```text
Fuer jedes Land in [IR, IL, SA, AE, YE, IQ, QA, BH, OM, KW]:

  osint_score = Anzahl OSINT-Artikel die das Land erwaehnen * 8 (max 30)
  reddit_score = Anzahl Reddit-Signals mit Land-Bezug * 5 (max 20)
  military_score = flight_anomaly_near_country * 0.3 (max 25)
  market_score = relevante_market_probability * 0.2 (max 15)
  wiki_score = wiki_pageview_spike_ratio * 5 (max 10)

  raw_cii = osint_score + reddit_score + military_score + market_score + wiki_score
  cii = min(100, raw_cii)

  trend_24h = cii - letzte_cii_vor_24h
```

### Baseline Welford Algorithmus (fuer alle Agenten)

```text
// Welford's Online Algorithm fuer streaming mean/variance
function updateBaseline(agent, metric, value, dayOfWeek, hour):
  existing = SELECT FROM agent_baselines
    WHERE agent_name = agent AND metric_name = metric
    AND day_of_week = dayOfWeek AND hour_of_day = hour

  if existing:
    count = existing.count + 1
    delta = value - existing.mean
    newMean = existing.mean + delta / count
    delta2 = value - newMean
    newVariance = existing.variance + delta * delta2

    UPDATE agent_baselines SET
      mean = newMean,
      variance = newVariance,
      count = count
  else:
    INSERT INTO agent_baselines
      (agent, metric, dayOfWeek, hour, mean=value, variance=0, count=1)
```

### Implementierungsreihenfolge

1. ThreatEngine.tsx: Echte Tension History aus DB
2. Alle 10 Agenten: Baseline-Schreibung (Welford)
3. Head Analyst: CII-Berechnung + country_scores
4. CountryBrief.tsx: Echte Daten anzeigen
5. Deploy + Test aller Agenten

## 6. Zusammenfassung: Wo MERIDIAN nach Phase 1 steht

```text
Feature                    | World Monitor | MERIDIAN v3
Autonome Agenten           | Nein          | 11 Agenten mit Cron
AI Head Analyst            | Single LLM    | Multi-Agent Synthese
CII Score                  | 20 Laender    | 10 Laender (Golf-Fokus)
Baseline Anomaly Detection | IndexedDB     | PostgreSQL (Welford)
Geographic Convergence     | 1-Grad Grid   | Agent-Level (Phase 2)
Tension History            | Client-Cache  | DB-persistiert
Agent Divergences          | Nein          | Ja
Wiki Crisis Correlation    | Nein          | Ja
Macro Safe-Haven           | FRED only     | Forex + Commodities
NASA Fires                 | EONET         | FIRMS (praeziser)
Prediction Markets         | Display only  | AI Divergenz-Analyse
Signal System              | 12 Typen      | 6 Typen (Phase 3)
Entity Registry            | 600+ Entities | Geplant (Phase 3)
Infrastructure Cascade     | 279 Nodes     | Nicht geplant
News Clustering            | Jaccard       | Nicht geplant
Desktop App                | Tauri         | Web-only
3D Globe                   | deck.gl       | Leaflet 2D
```

MERIDIAN differenziert sich durch das **autonome Multi-Agent-System** -- kein anderes Projekt hat Agenten die im Hintergrund laufen, Daten sammeln, und dann von einem AI Head Analyst synthetisiert werden. Das ist das Alleinstellungsmerkmal. Phase 1 schliesst die kritischen Luecken (CII, echte Daten, Baselines) und macht das System produktionsreif.
