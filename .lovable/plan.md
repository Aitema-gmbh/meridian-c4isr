
# MERIDIAN: Iran/US-Konflikt Aktualisierung

## Aktueller Kontext (22. Februar 2026)

Die Lage ist HEUTE extrem aktuell:
- **Reuters**: "US and Iran slide towards conflict as military buildup eclipses talks"
- **Al Jazeera**: US groesster Militaeraufmarsch im Nahen Osten seit der Irak-Invasion
- **Trump**: Iran hat "10-15 Tage" fuer einen Deal (Nuklear + Raketen)
- **Pezeshkian**: "Iran wird sich nicht beugen"
- **Larijani**: Uebernimmt Kriegsvorbereitungen laut Berichten
- **2 Traegergruppen + 14 Kriegsschiffe** im Einsatzgebiet
- **Operation Midnight Hammer** war erst vor 8 Monaten

## Was aktualisiert werden muss

### 1. Keywords und Entities -- VERALTET

Mehrere Agenten haben veraltete oder unvollstaendige Keyword-Listen fuer den aktuellen Konflikt:

**Fehlende Schluessel-Begriffe in allen Agenten:**
- "Pezeshkian" (Iran-Praesident -- fehlt ueberall ausser agent-markets)
- "Larijani" (Kriegsvorbereitungen -- fehlt ueberall)
- "Midnight Hammer" / "Operation Midnight Hammer" (US-Angriff Juni 2025)
- "Trump" als Iran-bezogener Keyword
- "nuclear deal" / "nuclear talks" / "JCPOA"
- "USS Abraham Lincoln" (2. Traegergruppe aktuell im Einsatz -- fehlt in Naval)
- "USS Harry S. Truman" (war kuerzlich im Einsatz)
- "B-2 Spirit" Bomber (im Einsatz laut CSIS)
- "Al Udeid" (groesste US-Basis, fehlt in einigen Agenten)
- "Diego Garcia" (B-2 Basis)
- "Fordow" (unterirdische Urananreicherung)
- "Arak" (Schwerwasserreaktor)
- "Parchin" (Militaerkomplex)
- "ballistic missile" / "MRBM" / "Emad" / "Sejjil"

### 2. Naval Agent -- HARDCODED VESSELS VERALTET

Der Naval Agent hat **20 hardcoded Schiffe** die teilweise nicht mehr aktuell sind:
- USS Eisenhower (CVN-69) ist hardcoded -- moeglicherweise nicht mehr im Einsatz
- USS Abraham Lincoln (CVN-72) fehlt als aktives Traegergruppe
- Es fehlen: USS Bataan ARG details, Submarine SSGNs
- Keine Aktualisierung der iranischen Flottenaufstellung

### 3. Wikipedia Watch Articles -- LUECKEN

`agent-wiki` monitort 15 Artikel, aber es fehlen:
- "2026 Iran-United States crisis" (neuer Wikipedia-Artikel zur aktuellen Lage)
- "Operation Midnight Hammer" (US-Angriff Juni 2025)
- "Masoud Pezeshkian" (Iran-Praesident)
- "Ali Larijani" (Kriegsvorbereitungen)
- "Iran nuclear deal framework" / "Joint Comprehensive Plan of Action"
- "Fordow Fuel Enrichment Plant"
- "Natanz" (existiert bereits)
- "Iran ballistic missile program"

### 4. Polymarket Slugs -- TEILWEISE VERALTET

`agent-markets` hat 11 hardcoded Slugs -- einige davon moeglicherweise abgelaufen (Maerz 2025 Deadlines). Fehlende aktuelle Maerkte:
- US strikes on Iran nuclear sites 2026
- Iran nuclear weapon by end of 2026
- US-Iran war 2026
- Strait of Hormuz closure 2026
- Iran regime change 2026

### 5. OSINT Queries -- GUT ABER ERWEITERBAR

`agent-osint` hat 4 GDELT-Streams die gut sind, aber es fehlt:
- Ein dedizierter "Pezeshkian OR Larijani OR nuclear talks" Stream
- "Operation Midnight Hammer" als historischer Kontext

### 6. Fires Agent -- STRATEGISCHE SITES UNVOLLSTAENDIG

`agent-fires` hat 12 strategische Standorte, aber es fehlen:
- **Fordow** (unterirdisch, 32.77N, 51.56E) -- DAS Hauptziel
- **Parchin** (35.52N, 51.77E) -- Militaer/Nuklear
- **Arak** (34.38N, 49.24E) -- Schwerwasser
- **Kharg Island** (29.24N, 50.31E) -- 90% von Irans Oelexport
- **Chabahar Port** (25.30N, 60.64E) -- Iranischer Hafen
- **Imam Ali Base, Syria** (34.44N, 40.55E) -- Iranische Miliz
- **Diego Garcia** (7.32S, 72.41E) -- B-2 Basis

### 7. Head Analyst System Prompt -- NICHT KONTEXTUELL GENUG

Der System-Prompt des Head Analyst erwaehnt den Iran/US-Kontext nicht explizit. Er sagt nur "multi-source intelligence fusion center" -- kein Hinweis auf die aktuelle Eskalation.

### 8. Reddit Subreddits -- GUT ABER ERWEITERBAR

`agent-reddit` monitort 5 Subreddits, aber es fehlen:
- r/NCD (NonCredibleDefense -- sehr aktiv bei Militaereskalationen)
- r/LessCredibleDefence
- r/MilitaryPorn (fuer Truppenverlegungen)

### 9. Country Scores -- LEER

`country_scores` hat 0 Eintraege. Der Head Analyst berechnet CII aber hat noch nie gelaufen (AI Credits). Die CII-Laenderliste ist gut (10 Golf-Laender), aber es fehlen:
- **SY** (Syrien -- iranische Milizen, Imam Ali Base)
- **LB** (Libanon -- Hezbollah)
- **US** (fuer Domestic-Stimmung und Militaeraufmarsch)

## Implementierungsplan

### Schritt 1: Keyword-Updates in allen Agenten

**agent-osint**: Neuen 5. GDELT-Stream hinzufuegen:
- `(Pezeshkian OR Larijani OR "nuclear talks" OR "nuclear deal" OR "Midnight Hammer") AND (iran OR US)`

**agent-reddit**: 2 Subreddits hinzufuegen:
- r/NCD (NonCredibleDefense)
- r/LessCredibleDefence

**agent-wiki**: 8 neue Watch-Artikel:
- "2026_Iran%E2%80%93United_States_crisis"
- "Masoud_Pezeshkian"
- "Ali_Larijani"
- "Joint_Comprehensive_Plan_of_Action"
- "Fordow_Fuel_Enrichment_Plant"
- "Iran_ballistic_missile_program"
- "2025_strikes_on_Iran" (Operation Midnight Hammer)
- "Kharg_Island"

**agent-markets**: Keywords erweitern + neue Slugs:
- Keywords: + "pezeshkian", "larijani", "nuclear deal", "nuclear talks", "midnight hammer", "strike", "war"
- Slugs: + aktuellere 2026-bezogene Slugs

**agent-pentagon**: Keywords erweitern:
- + "pezeshkian", "larijani", "nuclear", "midnight hammer", "strike", "armada", "carrier", "b-2", "bomber"

**agent-cyber**: Queries erweitern:
- + "Shahid Hemmat" (Iran Cyber), "CyberAv3ngers"

### Schritt 2: Fires Agent -- Strategische Sites erweitern

7 neue Sites hinzufuegen:
- Fordow, Parchin, Arak, Kharg Island, Chabahar, Imam Ali Base (Syria), Diego Garcia

### Schritt 3: Naval Agent -- Vessel-Liste aktualisieren

- USS Abraham Lincoln (CVN-72) hinzufuegen (aktuell 2. Traeger im Einsatz)
- Positionen basierend auf aktuellen Berichten aktualisieren
- USS Harry S. Truman ergaenzen

### Schritt 4: Head Analyst System Prompt aktualisieren

Den System-Prompt kontextualisieren:
- Aktueller Iran/US-Konfliktkontext
- Erwaehnung der 2 Traegergruppen
- Pezeshkian/Larijani als Schluesselakteure
- Eskalationsdynamik seit Operation Midnight Hammer

### Schritt 5: CII-Laenderliste erweitern

3 Laender hinzufuegen:
- SY (Syrien), LB (Libanon), US (fuer Domestic-Dimension)

### Schritt 6: Network Graph aktualisieren

Mock-Daten aktualisieren mit aktuellen Akteuren:
- Pezeshkian (IR Praesident)
- Larijani (Kriegskoordinator)
- Trump (POTUS -- bereits vorhanden als "POTUS NCA")
- USS Abraham Lincoln CSG
- B-2 Spirit Bomber Squadron

### Schritt 7: Deploy und Test

Alle geaenderten Edge Functions deployen und testen.

## Technische Details

### Dateien die geaendert werden

| Datei | Aenderung |
|-------|-----------|
| `agent-osint/index.ts` | 5. GDELT-Stream hinzufuegen |
| `agent-reddit/index.ts` | 2 neue Subreddits |
| `agent-wiki/index.ts` | 8 neue Watch-Artikel |
| `agent-markets/index.ts` | Keywords + Slugs erweitern |
| `agent-pentagon/index.ts` | Keywords erweitern |
| `agent-cyber/index.ts` | Queries erweitern |
| `agent-fires/index.ts` | 7 neue strategische Sites |
| `agent-naval/index.ts` | USS Abraham Lincoln + aktuelle Positionen |
| `agent-head-analyst/index.ts` | System-Prompt + 3 neue CII-Laender |
| `mockData.ts` | Network Graph Nodes/Links aktualisieren |
| `CountryBrief.tsx` | 3 neue Laender-Flags (SY, LB, US) |

### Keine neuen Tabellen oder Migrationen noetig
Alle Aenderungen sind Code-Updates in bestehenden Edge Functions und Frontend-Komponenten.
