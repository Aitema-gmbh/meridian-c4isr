
# Echte AIS-Daten via aisstream.io integrieren

## Datenquelle: aisstream.io (kostenlos)

**aisstream.io** bietet einen kostenlosen WebSocket-Stream mit echten, weltweiten AIS-Schiffsdaten. Man braucht nur einen kostenlosen API-Key (Registrierung unter aisstream.io).

## Architektur

Da WebSocket-Verbindungen nicht direkt aus einer Edge Function aufrechterhalten werden koennen (Edge Functions sind kurzlebig), gibt es zwei Ansaetze:

**Gewaehlt: Hybrid-Ansatz** -- Die Edge Function `ais-proxy` wird umgebaut:
1. Sie verbindet sich bei jedem Aufruf kurz per WebSocket zu aisstream.io
2. Sammelt fuer 3-5 Sekunden AIS-Nachrichten aus den relevanten Regionen (Persischer Golf, Rotes Meer, Suez)
3. Gibt die gesammelten Schiffspositionen als JSON zurueck
4. Fallback: Wenn keine Daten kommen oder kein API-Key vorhanden, werden die bestehenden Mock-Daten zurueckgegeben

## Aenderungen

### 1. API-Key als Secret hinzufuegen
- Der User muss sich bei aisstream.io registrieren (kostenlos)
- API-Key wird als `AISSTREAM_API_KEY` Secret gespeichert

### 2. Edge Function `supabase/functions/ais-proxy/index.ts` umbauen
- WebSocket-Verbindung zu `wss://stream.aisstream.io/v0/stream`
- Subscription-Message mit Bounding Boxes fuer relevante Gebiete:
  - Persischer Golf / Strait of Hormuz: [[23, 47], [30, 60]]
  - Rotes Meer / Bab el-Mandeb: [[11, 40], [30, 45]]
  - Suez-Kanal: [[29, 32], [32, 35]]
- AIS Position Reports (Nachrichtentyp 1, 2, 3, 18) parsen
- Schiffe in das bestehende VesselData-Format mappen (mmsi, name, lat, lon, speed, course, etc.)
- Timeout nach 5 Sekunden, dann Response mit allen gesammelten Schiffen
- Fallback auf Mock-Daten wenn kein API-Key oder Fehler

### 3. Frontend `ThreatMatrix.tsx` -- minimale Aenderungen
- Das Frontend braucht keine Aenderung, da das Datenformat gleich bleibt
- Optional: Anzeige ob "LIVE" oder "SIMULATED" Daten

## Technische Details

### aisstream.io WebSocket Subscription Message
```text
{
  "Apikey": "<KEY>",
  "BoundingBoxes": [
    [[23, 47], [30, 60]],    // Persian Gulf
    [[11, 40], [30, 45]],    // Red Sea
    [[29, 32], [32, 35]]     // Suez
  ]
}
```

### AIS Message Mapping
```text
AIS PositionReport -> VesselData:
  - MessageID -> (filter: only 1,2,3,18)
  - UserID -> mmsi
  - Latitude -> lat
  - Longitude -> lon
  - Sog -> speed (knots)
  - Cog -> course
  - TrueHeading -> heading
  - ShipName (from MetaData) -> name
  - ShipType -> type/category mapping
  - Flag (from MetaData) -> flag
  - Destination (from MetaData) -> destination
```

### Edge Function Ablauf
```text
Request kommt rein
  -> Pruefe AISSTREAM_API_KEY Secret
  -> Wenn vorhanden:
      -> WebSocket oeffnen zu aisstream.io
      -> Subscription senden mit Bounding Boxes
      -> 4 Sekunden lang Nachrichten sammeln
      -> Deduplizieren nach MMSI (neueste Position behalten)
      -> Als VesselData[] zurueckgeben + source: "live"
  -> Wenn nicht vorhanden oder Fehler:
      -> Mock-Daten mit Drift zurueckgeben + source: "simulated"
```

### Dateien die geaendert werden

| Datei | Aenderung |
|-------|-----------|
| `supabase/functions/ais-proxy/index.ts` | Komplett umbauen: WebSocket zu aisstream.io, Fallback auf Mock-Daten |
| `src/components/dashboard/ThreatMatrix.tsx` | Kleiner Zusatz: "LIVE" vs "SIM" Badge im Header anzeigen |

### Voraussetzung
- User muss sich bei aisstream.io registrieren und den API-Key als Secret `AISSTREAM_API_KEY` eingeben
