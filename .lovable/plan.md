

# Wettbewerbsanalyse und Verbesserungsplan fuer MERIDIAN

## Was es auf GitHub gibt

### 1. World Monitor (9.2k Stars) -- Der Platzhirsch
- 35+ Datenlayer auf 3D-WebGL-Globe (deck.gl + MapLibre)
- 150+ RSS-Feeds, 8 Live-Videostreams, 19 Live-Webcams
- Country Instability Index (CII) fuer 22 Laender
- Focal Point Detection (Konvergenz mehrerer Signale)
- Temporal Baseline Anomaly Detection (Welford's Algorithm, 90-Tage-Fenster, Z-Score)
- AIS Chokepoint Detection (8 strategische Meerengen)
- Local LLM Support (Ollama/LM Studio) mit 4-stufiger Fallback-Kette
- Desktop-App (Tauri) mit OS-Keychain fuer API-Keys
- Finance-Variante mit 92 Boersen, 13 Zentralbanken
- Schwaeche: Kein autonomes Agentensystem, kein Multi-Agent-Synthese-Loop

### 2. Delta Intelligence (9 Stars, von Anatoly Yakovenko/Solana)
- 15 Live-Signale normalisiert auf 0-100
- Pentagon Pizza Tracker ("PizzINT") -- tatsaechlich implementiert
- Wikipedia-Krisen-Korrelation (Pageviews)
- Safe-Haven-Flows (CHF/USD, JPY/USD)
- Kalshi + Polymarket Integration
- Schwaeche: Kein AI, kein persistenter Speicher, keine Agenten, nur Polling

### 3. GeoSentinel (420 Stars)
- Python/Flask mit YOLO-Objekterkennung
- Live AIS + Flug-Tracking
- Dark-Web-Suche via TOR
- Ollama AI Integration
- Schwaeche: Kein Web-Dashboard, kein Agentensystem, erfordert lokale Installation

### 4. WarAgent (Forschung)
- LLM-basierte Multi-Agent-Simulation von Kriegen
- Akademisch, nicht fuer Echtzeit-Monitoring

### 5. Weitere Projekte
- ADS-B-Military-Analytics: Reine ADS-B-Analyse
- GDELT-GKG Pipeline: Nur GDELT-Datenverarbeitung
- G-APT-Monitor: APT-Visualisierung

## Was MERIDIAN bereits besser macht als alle

- **Autonome Agenten mit Cron**: Kein anderes Projekt hat einen echten Multi-Agent-Loop der im Hintergrund laeuft
- **Head Analyst Synthese**: Keiner hat einen AI-Agent der alle Quellen konsolidiert
- **DB-persistente Reports**: World Monitor cached in Redis, wir persistieren in einer echten DB
- **Agent-Divergenz-Erkennung**: Kein Wettbewerber erkennt wenn Agenten sich widersprechen

## Was die Konkurrenz besser macht (und was wir uebernehmen sollten)

### Von World Monitor lernen
1. **Country Instability Index (CII)**: Composite Score pro Land -- wir haben nur einen globalen Tension Index
2. **Temporal Baseline Anomaly Detection**: Welford's Algorithm mit 90-Tage-Fenster statt fester Schwellwerte
3. **Focal Point / Convergence Detection**: Wenn mehrere Signaltypen im selben geografischen Gebiet spiken
4. **3D Globe mit deck.gl**: Deutlich beeindruckender als Leaflet
5. **35+ togglebare Datenlayer**: Undersea Cables, Pipelines, Nuklearanlagen, Militaerbasen
6. **Data Freshness Monitoring**: Explizite Luecken-Erkennung wenn eine Quelle ausfaellt

### Von Delta Intelligence lernen
1. **Wikipedia Crisis Correlation**: Echtzeit-Pageview-Spikes auf Krisenartikeln (kostenlos, Wikimedia API)
2. **Pentagon Pizza Tracker (PizzINT)**: Die haben es tatsaechlich gebaut
3. **Safe-Haven Currency Flows**: CHF/USD und JPY/USD als Risiko-Proxy
4. **Signal-Normalisierung 0-100**: Einheitliche Skala fuer alle Signale
5. **Trend-Pfeile**: Einfache Visualisierung von Richtungsaenderungen

## Der Verbesserungsplan: MERIDIAN v3

### Phase 1: Neue Datenquellen (3 neue Agenten)

**Agent 9: WIKI CRISIS Agent (`agent-wiki`)**
- Wikimedia Pageview API (kostenlos, kein Key): `wikimedia.org/api/rest_v1/metrics/pageviews`
- Monitort Artikel wie "Strait of Hormuz", "Iran-United States relations", "IRGC", "USS Eisenhower"
- Erkennt Pageview-Spikes vs. 7-Tage-Baseline
- Rein algorithmisch, kein AI noetig

**Agent 10: FOREX/MACRO Agent (`agent-macro`)**
- Yahoo Finance (kostenlos): CHF/USD, JPY/USD, Gold, Oil, VIX
- Erkennt Safe-Haven-Flows und Risikoabneigung
- Berechnet Macro Risk Index
- Rein algorithmisch

**Agent 11: SATELLITE/FIRE Agent (`agent-fires`)**
- NASA FIRMS API (kostenlos): Satellitenbasierte Feuer-/Explosionserkennung
- USGS Earthquake API (kostenlos): Seismische Aktivitaet in der Region
- Erkennt ungewoehnliche Hitzesignaturen nahe Militaerinstallationen
- Rein algorithmisch

### Phase 2: Smarte Anomalie-Erkennung

**Temporal Baseline System**
- Jeder Agent speichert historische Daten in einer neuen `agent_baselines` Tabelle
- Welford's Online-Algorithmus berechnet rolling Mean/Variance pro Agent, Wochentag, Stunde
- Z-Score-Schwellwerte (1.5 = erhoehte Aktivitaet, 2.0 = Warnung, 3.0 = ALERT)
- Statt "72 Flight Anomaly" sagt das System: "Militaerflugverkehr 2.8x ueber Donnerstag-Baseline"

**Convergence Detection**
- Wenn 3+ Agenten gleichzeitig erhoehte Werte melden: automatischer CONVERGENCE ALERT
- Gewichtete Korrelation: Flights + Naval + OSINT = hoechste Konvergenz-Stufe
- Head Analyst bekommt Convergence Score als zusaetzlichen Input

### Phase 3: Country-Level Intelligence

**Country Instability Index (CII)**
- Pro-Land Score (0-100) basierend auf allen Agenten-Daten die das Land betreffen
- Gewichtete Signale: OSINT-Artikel, Militaeraktivitaet, Markt-Odds, Reddit-Sentiment
- Laender: Iran, Israel, Saudi-Arabien, UAE, Yemen, Iraq, Qatar, Bahrain, Oman, Kuwait
- Trend-Erkennung: 24h, 7d, 30d Vergleich

### Phase 4: Frontend-Upgrade

**Dashboard Verbesserungen**
- Agent Status Panel: Echtzeit-Status jedes Agenten (letzter Lauf, Threat Level, Items, Latenz)
- Convergence Alerts: Prominente Anzeige wenn mehrere Agenten gleichzeitig eskalieren
- Signal Timeline: Zeitliche Darstellung aller Agenten-Berichte der letzten 24h
- Data Freshness Indicator: Warnung wenn ein Agent nicht mehr berichtet
- Country Drill-Down: Klick auf ein Land zeigt alle relevanten Signale

## Technische Umsetzung

### Neue DB-Tabellen

```text
agent_baselines
  - id: uuid
  - agent_name: text
  - metric_name: text (z.B. "flight_count", "article_count")
  - day_of_week: int (0-6)
  - hour_of_day: int (0-23)
  - mean: numeric
  - variance: numeric
  - count: integer
  - updated_at: timestamptz

country_scores
  - id: uuid
  - created_at: timestamptz
  - country_code: text (ISO 3166)
  - country_name: text
  - cii_score: numeric (0-100)
  - signal_breakdown: jsonb
  - trend_24h: numeric
  - trend_7d: numeric
```

### Neue Edge Functions

| Funktion | Typ | Frequenz |
|----------|-----|----------|
| `agent-wiki` | Algorithmisch | Alle 30 Min |
| `agent-macro` | Algorithmisch | Alle 15 Min |
| `agent-fires` | Algorithmisch | Alle 30 Min |

### Aenderungen an bestehenden Agenten

- Alle Agenten schreiben zusaetzlich Baseline-Daten in `agent_baselines`
- Head Analyst bekommt Convergence Score und CII als zusaetzliche Inputs
- Head Analyst berechnet und speichert Country Scores

### Frontend-Aenderungen

| Datei | Aenderung |
|-------|-----------|
| `Dashboard.tsx` | Agent Status Panel, Convergence Alerts, Data Freshness |
| `ThreatEngine.tsx` | Country Drill-Down, Baseline-Vergleich |
| Neues Component: `AgentStatusPanel.tsx` | Echtzeit-Status aller Agenten |
| Neues Component: `ConvergenceAlert.tsx` | Konvergenz-Warnungen |
| Neues Component: `CountryBrief.tsx` | Laender-Dossier |
| Neues Component: `SignalTimeline.tsx` | 24h Zeitlinie aller Signale |

### Implementierungsreihenfolge

1. `agent_baselines` + `country_scores` Tabellen erstellen
2. `agent-wiki` implementieren (Wikipedia Pageviews, einfachster neuer Agent)
3. `agent-macro` implementieren (Yahoo Finance Forex/Commodities)
4. `agent-fires` implementieren (NASA FIRMS + USGS)
5. Baseline-System in alle bestehenden Agenten einbauen
6. Head Analyst erweitern: Convergence Detection + CII
7. Frontend: Agent Status Panel + Convergence Alerts
8. Frontend: Country Brief + Signal Timeline

### Was MERIDIAN dann einzigartig macht

| Feature | World Monitor | Delta Intel | GeoSentinel | MERIDIAN v3 |
|---------|--------------|-------------|-------------|-------------|
| Autonome Agenten | Nein | Nein | Nein | 11 Agenten |
| Head Analyst AI | Nein | Nein | Nein | Ja |
| Baseline Anomaly Detection | Ja (Welford) | Nein | Nein | Ja (Welford) |
| Convergence Detection | Ja | Nein | Nein | Ja + AI |
| Country Instability Index | Ja (22 Laender) | Nein | Nein | Ja (10 Laender, Gulf-fokussiert) |
| Wikipedia Crisis | Nein | Ja | Nein | Ja |
| Pentagon Pizza Proxy | Nein | Ja (PizzINT) | Nein | Ja (Nachtaktivitaet) |
| Safe-Haven Flows | Nein | Ja | Nein | Ja |
| Prediction Markets | Ja (Polymarket) | Ja (Poly + Kalshi) | Nein | Ja (Polymarket) |
| Agent Divergences | Nein | Nein | Nein | Ja |
| Persistente DB | Redis-Cache | Nein | Nein | PostgreSQL |
| NASA Fires/USGS | Ja | Ja (EONET) | Nein | Ja (FIRMS) |
| Cyber/APT Tracking | Ja (IOCs) | Nein | Nein | Ja (GDELT + OTX) |
| ADS-B Mil Tracking | Ja | Ja (OpenSky) | Ja | Ja (adsb.lol) |
| AIS Naval Tracking | Ja | Nein | Ja | Ja |
| Dark Web | Nein | Nein | Ja (TOR) | Nein |
| 3D Globe | Ja (deck.gl) | Ja (MapLibre) | Ja | Nein (Leaflet 2D) |

MERIDIAN v3 waere das einzige System mit einem autonomen Multi-Agent-Intelligence-Loop, Baseline-Anomalie-Erkennung UND AI-gesteuerter Synthese -- alles serverless und persistent.

