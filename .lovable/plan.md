

# AIS-Daten Integration -- Realitaetscheck und Plan

## Wichtige Erkenntnis: OpenShipData funktioniert NICHT fuer euer Gebiet

Nach der Recherche muss ich ehrlich sein: **OpenShipData (MarinePlan)** deckt nur **europaeische Binnengewaesser** ab (hauptsaechlich Niederlande). Fuer den Persischen Golf, Rotes Meer und Suez gibt es dort keine Daten.

Es gibt **keine einzige komplett kostenlose, globale AIS-API ohne API-Key**. Die Optionen sind:

| Quelle | Kosten | API-Key | Abdeckung | Fazit |
|--------|--------|---------|-----------|-------|
| OpenShipData | Frei | Keiner | Nur Europa/NL | Unbrauchbar fuer CENTCOM |
| AISHub | Frei | Ja + eigene AIS-Station | Global | Zu kompliziert |
| aisstream.io | Frei | Ja (kostenlose Registrierung) | Global, Echtzeit | Beste Option |
| BarentsWatch | Frei | Ja | Nur Norwegen | Unbrauchbar |

## Militaerschiffe: Warum sie separat bleiben muessen

Militaerschiffe (USS Eisenhower, USS Mason, etc.) senden in der Realitaet **kein AIS-Signal** oder schalten es bewusst ab. Sie tauchen in keinem freien AIS-Feed auf. Deshalb:

- Militaerschiffe bleiben als **kuratierte, akkurate Datenbank** im Code
- Positionen basieren auf aktuellen OSINT-Quellen (Carrier Strike Group Tracking)
- Sie werden als eigener Layer ueber den Live-Daten angezeigt

## Vorgeschlagener Plan

### Schritt 1: Militaerschiff-Datenbank erweitern und verbessern

Die bestehenden 3 Militaerschiffe werden auf eine **umfassende, akkurate Liste** erweitert:

**US Navy (5th Fleet / CENTCOM):**
- CVN-69 USS Dwight D. Eisenhower (Carrier)
- DDG-87 USS Mason (Destroyer)
- CG-70 USS Lake Erie (Cruiser)
- DDG-114 USS Ralph Johnson (Destroyer)
- LHD-7 USS Iwo Jima (Amphibious)

**Allied Forces:**
- HNLMS Tromp (Netherlands, Frigate)
- HMS Diamond (UK, Destroyer)
- FS Alsace (France, Frigate)
- ITS Virginio Fasan (Italy, Frigate)

**Andere Akteure:**
- IRIS Alborz (Iran, Frigate)
- IRIS Dena (Iran, Destroyer)
- PNS Tughril (Pakistan, Frigate)

Jedes Schiff bekommt akkurate Daten: Typ, Klasse, Heimathafen, Flagge, Laenge, und realistische Patrouillen-Positionen.

### Schritt 2: aisstream.io fuer Live-Handelschiffe (mit API-Key)

Die Edge Function `ais-proxy` wird so umgebaut:

1. **Militaerschiffe**: Immer aus der kuratierten Datenbank (mit leichtem Positions-Drift)
2. **Handelschiffe**: Live von aisstream.io wenn API-Key vorhanden
3. **Fallback**: Mock-Handelschiffe wenn kein API-Key

Das Response-Format:
```text
{
  vessels: [...],           // Alle Schiffe kombiniert
  military: [...],          // Nur Militaer (immer vorhanden)
  commercial: [...],        // Handelschiffe (live oder mock)
  source: "live" | "simulated",
  total: number
}
```

### Schritt 3: Frontend "LIVE/SIM" Badge

Im ThreatMatrix-Header wird angezeigt ob die Handelschiffe live oder simuliert sind.

## Dateien die geaendert werden

| Datei | Aenderung |
|-------|-----------|
| `supabase/functions/ais-proxy/index.ts` | Komplett umgebaut: Erweiterte Militaer-DB + aisstream.io WebSocket + Fallback |
| `src/components/dashboard/ThreatMatrix.tsx` | LIVE/SIM Badge im Header |

## Voraussetzung

- Fuer Live-Handelschiffe: Kostenlose Registrierung bei aisstream.io und API-Key als Secret `AISSTREAM_API_KEY` hinterlegen
- Militaerschiffe funktionieren sofort ohne API-Key

