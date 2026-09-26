# SHIN – Spiel + Online-Server

Dieser Ordner ist das komplette Spiel inklusive eigenem Online-Server.
Wer die Adresse des Servers öffnet, kann sofort spielen – auch online gegen Freunde
(Lobby erstellen, Code teilen, beitreten, öffentliche Lobbys, Rematch).

```
server.js          der Server (reines Node.js, keine Pakete nötig)
package.json       Startbefehl für Hoster
public/index.html  das Spiel
```

## Lokal testen

1. Node.js installieren (Version 18 oder neuer): https://nodejs.org
2. Im Ordner ein Terminal öffnen und starten:
   ```
   node server.js
   ```
3. Im Browser `http://localhost:8080` öffnen – zweimal (zwei Tabs), dann kannst du gegen dich selbst online testen.

## Kostenlos online stellen (Render.com)

1. **GitHub:** Auf https://github.com ein Konto anlegen → oben rechts **+ → New repository** →
   Name z. B. `shin` → **Create repository** → **uploading an existing file** →
   alle Dateien aus diesem Ordner hineinziehen (auch den Ordner `public`) → **Commit changes**.
2. **Render:** Auf https://render.com mit GitHub anmelden → **New + → Web Service** →
   dein Repository `shin` auswählen.
3. Einstellungen:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Create Web Service** klicken und 1–2 Minuten warten.
5. Oben steht deine Adresse, z. B. `https://shin-xxxx.onrender.com` – das ist dein Spiel.
   Schick den Link deinen Freunden: PLAY → ONLINE → Lobby erstellen / beitreten.

Hinweis zum Gratis-Plan: Nach ca. 15 Minuten ohne Besucher schläft der Server ein.
Der erste Aufruf danach dauert dann etwa eine Minute, danach läuft alles normal.

**Updates:** Neue Version von `public/index.html` auf GitHub hochladen (Datei ersetzen) –
Render baut automatisch neu.

## Spiel woanders hosten (z. B. itch.io)

Das Spiel kann auch auf einer anderen Seite liegen und trotzdem deinen Server benutzen:

1. In `public/index.html` nach `const SHIN_SERVER=''` suchen.
2. Deine Server-Adresse eintragen – mit `wss://` statt `https://` und `/ws` am Ende:
   ```
   const SHIN_SERVER='wss://shin-xxxx.onrender.com/ws';
   ```
3. Die Datei (als ZIP, Name `index.html`) bei itch.io als HTML-Spiel hochladen.

## Wie Online funktioniert

Der Server leitet nur Lobby-Infos und Eingaben weiter. Beide Spieler berechnen den Kampf
exakt gleich (gleicher Zufall, gleiche Eingaben, Bild für Bild). Deshalb ist der Server
winzig und kostet fast nichts – aber: Wechselt ein Spieler den Tab, wartet der andere,
und online gibt es keine Pause.
