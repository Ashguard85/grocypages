# Grocy Artikel PWA — v1

Statische, iPhone-first PWA für eine vorhandene Grocy-Installation. Dieses Repository enthält **nur die PWA**; es bringt keinen Docker-Container, kein Flask-Backend und keine SQLite-Datenbank mit.

## Architektur

Eine gemeinsame Vanilla-JavaScript-Oberfläche arbeitet gegen einen austauschbaren Data Provider:

- **ServerProvider** → vorhandene Grocy REST API (`/api/...`)
- **LocalProvider** → IndexedDB auf dem Gerät

Der aktive Modus wird in `localStorage` gespeichert. Strukturierte lokale Daten und Server-Zugangsdaten liegen in IndexedDB. Server- und lokale Daten werden nicht automatisch synchronisiert oder vermischt.

## Funktionsumfang v1

- Bestandsübersicht mit Suche, Niedrigbestand und Fälligkeit
- Einkauf / Einlagern mit Menge, Preis, MHD und Ort
- Verbrauch, Verderb und Öffnen
- Inventur / Bestandskorrektur
- Umlagern
- Einkaufsliste mit Mengen, Erledigt-Status und Einlagern
- Produktstammdaten: anlegen, ändern, löschen; Mindestbestand, Standardort und Einheit
- Barcode-Feld; Kamera-Scan via `BarcodeDetector`, wenn der Browser dies unterstützt
- Direkter API-Test für zusätzliche Grocy-Endpunkte
- Lokaler Modus mit IndexedDB
- Lokales JSON-Backup/Restore
- PWA-App-Shell, Offline-Start und kontrollierte Updates

Grocy selbst stellt seine Funktionen weitgehend über die REST API bereit. Die PWA nutzt die offiziellen Stock- und Generic-Entity-Endpunkte; über „API-Test“ können bei Bedarf auch weitere Grocy-API-Routen angesprochen werden.

## Server-Modus

Im Setup werden lokal gespeichert:

- öffentliche Grocy URL, z. B. `https://grocy.example.com`
- `GROCY-API-KEY`
- optional Cloudflare Access Client ID
- optional Cloudflare Access Client Secret

Die PWA sendet den Grocy-Key als Header `GROCY-API-KEY`. Cloudflare-Tokens werden als `CF-Access-Client-Id` und `CF-Access-Client-Secret` gesendet. Secrets werden nicht in Exporten aufgenommen und nach Speicherung nur als Passwortfelder angezeigt.

### CORS / Cloudflare

Da GitHub Pages und Grocy verschiedene Origins haben, muss die Grocy-/Reverse-Proxy-Seite CORS für **genau die Pages-Origin** erlauben, z. B. `https://USER.github.io` oder die eigene Pages-Domain.

Erforderlich sind typischerweise:

- Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- Request headers: `Content-Type, GROCY-API-KEY, CF-Access-Client-Id, CF-Access-Client-Secret`
- Origin: ausschließlich die konkrete PWA-Origin, nicht `*`

Das API-Ziel muss HTTPS verwenden. Ein HTTPS-GitHub-Pages-Client kann kein unsicheres HTTP-Backend per Mixed Content ansprechen.

**Wichtig:** Ein Service Token oder Grocy API-Key in einer Browser-PWA ist für JavaScript derselben Origin lesbar. Pro Gerät getrennte, eng berechtigte und widerrufbare Tokens verwenden. Keine Drittanbieter-Skripte werden geladen. Die CSP erlaubt nur lokale Scripts/Styles und HTTPS-Verbindungen.

## Lokaler Modus

Der lokale Modus benötigt keinen Grocy-Server. Produkte, Bestand, Einkaufsliste, Orte, Einheiten und Journal werden in IndexedDB gespeichert. Es gibt keine versteckte oder simulierte Synchronisation zum Server.

Lokale Daten können beim Löschen der PWA/Website-Daten oder bei Geräteverlust verloren gehen. Daher regelmäßig „Backup exportieren“ verwenden.

## Datenmodell

Die lokale Struktur lehnt sich an Grocy an:

- `products`: `id`, `name`, `location_id`, `qu_id_stock`, `min_stock_amount`, `barcode`, `active`
- `stock`: `id`, `product_id`, `amount`, `amount_opened`, `best_before_date`
- `shopping`: `id`, `product_id`, `amount`, `done`, `note`
- `locations`: `id`, `name`
- `units`: `id`, `name`, `name_plural`
- `journal`: Buchungstyp, Produkt, Menge, Zeitstempel
- `config`: Server-URL und lokale Zugangsdaten

## Backup / Migration

Lokale Backups sind versionierte JSON-Dateien:

```json
{
  "format": "grocy-article-pwa-backup",
  "version": 1,
  "created_at": "...",
  "data": {}
}
```

API-Keys und Cloudflare-Secrets werden **nicht** exportiert. Restore validiert Format und Version und verlangt eine Bestätigung. IndexedDB verwendet eine eigene Schema-Version (`DB_VERSION`). Bei künftigen Änderungen muss diese erhöht und über `onupgradeneeded` migriert werden.

Serverdaten werden in v1 nicht als vollständiges Grocy-Backup exportiert; dafür bleibt Grocys eigener Backup-/Datenbankmechanismus zuständig.

## Environment-Variablen

Für dieses reine GitHub-Pages-Paket gibt es bewusst **keine serverseitigen Environment-Variablen und keine Repository-Secrets für die Laufzeit**. Konfiguration erfolgt auf dem Gerät im Setup. Damit landen weder Grocy API-Key noch Cloudflare Service Secret im Repository oder im Build-Artefakt.


## Wichtig: Cloudflare Access + GitHub Pages

Da die PWA auf einer anderen Origin als Grocy läuft, erzeugt bereits der Header `GROCY-API-KEY` einen CORS-Preflight (`OPTIONS`). Cloudflare Access blockiert preflighted Requests standardmäßig, wenn die Access-Anwendung dafür nicht konfiguriert wurde.

Für die Grocy-Access-Anwendung muss daher **beides** stimmen:

1. **Service Auth**: Eine Access-Policy mit Action `Service Auth` und Include `Service Token` für genau das Token, dessen Client ID/Secret in der PWA hinterlegt wird.
2. **CORS / OPTIONS**: Unter der Access-Anwendung → Advanced settings → Cross-Origin Resource Sharing entweder `Bypass OPTIONS requests to origin` aktivieren oder Cloudflare so konfigurieren, dass es den Preflight beantwortet.

Wenn Cloudflare den Preflight selbst beantwortet, verwende mindestens:

- Allowed Origin: die exakte GitHub-Pages-Origin, z. B. `https://user.github.io` (bzw. deine Custom Domain)
- Methods: `GET, POST, PUT, DELETE, OPTIONS`
- Headers: `Content-Type`, `GROCY-API-KEY`, `CF-Access-Client-Id`, `CF-Access-Client-Secret`

Grocy selbst besitzt einen OPTIONS/CORS-Handler für `/api/...`. Deshalb ist `Bypass OPTIONS requests to origin` für eine normale Grocy-Installation der einfachste Weg; die eigentlichen GET/POST/PUT/DELETE-Anfragen bleiben weiterhin durch Access geschützt.

### Einrichtungsreihenfolge

1. Grocy im Browser normal unter der öffentlichen HTTPS-URL öffnen.
2. In Grocy einen API-Key erzeugen/kopieren.
3. In Cloudflare ein separates Service Token für dieses Gerät anlegen.
4. In der Access-Anwendung eine `Service Auth`-Policy hinzufügen, die dieses Token einschließt.
5. OPTIONS/CORS wie oben freigeben.
6. In der PWA unter Setup `Server – Grocy API` wählen und **nur die Basis-URL** eintragen, z. B. `https://grocy.example.com`.
7. Grocy API-Key sowie Cloudflare Client ID/Secret eintragen.
8. `Verbindung vollständig prüfen` ausführen. Erst bei grünem Ergebnis speichern.

### Fehlerbilder

- `Netzwerk/CORS-Fehler` → meist OPTIONS-Preflight in Cloudflare Access blockiert.
- `HTTP 403 / Cloudflare Access` → Service-Auth-Policy oder Service Token falsch/fehlt.
- `HTTP 401 / API-Key` → Grocy API-Key falsch.
- HTML statt JSON → Anfrage landet auf einer Login-/Access-Seite statt bei `/api/system/info`.

## PWA / Offline-App-Shell

`service-worker.js` cached beim ersten erfolgreichen Online-Start:

- `index.html`
- `app.js`
- `app.css`
- `manifest.webmanifest`
- `offline.html`
- alle Icons

Danach kann die installierte PWA ihre Oberfläche aus dem Cache starten. Im lokalen Modus läuft sie dann ohne Server weiter. Im Server-Modus kann die gecachte App-Shell weiterhin direkt die Grocy API ansprechen, solange diese erreichbar ist.

## Update-Strategie

Cache-Version v4: `grocy-article-pwa-v4`.

Eine neue Service-Worker-Version wird zunächst installiert und wartet. Die laufende Sitzung wird nicht automatisch neu geladen. Die UI zeigt „Neue Version verfügbar“. Nur „Jetzt aktualisieren“ sendet `SKIP_WAITING`; anschließend erfolgt genau ein Reload über ein Session-Flag. Dadurch entstehen keine `controllerchange`-Reload-Schleifen.

Bei jeder neuen Frontend-Version müssen `APP_VERSION` und die Cache-/Service-Worker-Version gemeinsam erhöht werden.

## GitHub ZIP-Import

Das ZIP ist direkt das Root-Verzeichnis des Ziel-Repositories. Der Workflow `.github/workflows/import-zip.yml` reagiert auf ein neu gepushtes ZIP im Repository-Root:

1. ermittelt ZIPs, die im Push neu/aktualisiert wurden,
2. bricht ab, wenn es nicht genau eines ist,
3. prüft auf `.git` und `.github/workflows` im ZIP,
4. entpackt in ein temporäres Verzeichnis,
5. ersetzt alte Release-Dateien per `rsync --delete`, schützt aber `.git` und vorhandene Workflows,
6. entfernt das ZIP,
7. committed und pusht die neue Version.

Das ZIP darf deshalb keine zusätzliche Oberverzeichnisebene besitzen.

## GitHub Pages Deployment

`.github/workflows/deploy-pages.yml` veröffentlicht das Repository nach Push auf `main` mit GitHub Pages Actions. Der Import-Commit löst damit anschließend das Pages-Deployment aus. Die ZIP-Datei selbst wird nach erfolgreichem Import nicht behalten.

Im Repository muss unter **Settings → Pages** als Source „GitHub Actions“ aktiviert sein.

## Teststand v1

Automatisch geprüft:

- JavaScript-Syntax (`node --check`)
- JSON-Syntax des Manifestes
- Vorhandensein aller App-Shell-Dateien und Icons
- ZIP enthält Dateien direkt im Root
- keine Secrets/Beispiel-API-Keys im Paket
- Service-Worker enthält keine automatische Reload-Logik

Nicht innerhalb dieser Build-Umgebung vollständig laufzeitgetestet werden konnten:

- Verbindung zu deiner konkreten Grocy-Instanz
- deren CORS-/Cloudflare-Regeln
- echte Grocy-Buchungen gegen deine Daten
- iOS-Installation und Kamera-Barcodeerkennung auf einem physischen iPhone

Grocy-Versionen können einzelne Felder/Optionen erweitern. Die PWA v1 ist auf die aktuellen offiziellen Stock-/Object-API-Routen ausgelegt; bei ungewöhnlichen Grocy-Konfigurationen sollte zuerst der integrierte API-Test genutzt werden.

## Änderungen v2

- Verbindungstest zeigt jetzt CORS-, Cloudflare-403- und Grocy-401-Fehler getrennt an.
- Cloudflare-Service-Auth/OPTIONS-Einrichtung dokumentiert.
- Grocy Shopping-List API korrigiert (`product_amount`, `list_id`).
- Grocy Transfer API korrigiert (`location_id_from`, `location_id_to`).
- Inventur-Request vereinfacht auf die dokumentierte Pflichtangabe.
- Artikel mit Bestand 0 werden nun ebenfalls angezeigt.
- Server-Einkaufsliste behandelt Grocy-Einträge als offene Liste statt eines nicht vorhandenen `done`-Felds.


## Änderungen v4

- Update-Hinweis zeigt nur noch einen tatsächlich neueren wartenden Service Worker an.
- Wenn Seiten-Code und wartender Service Worker bereits dieselbe Version haben, wird der Worker still aktiviert und der Banner bleibt verborgen.
- Update-Button wird während der Aktivierung deaktiviert; nach `controllerchange` wird der Hinweis sofort ausgeblendet.
- Versionsabgleich zwischen App und Service Worker verhindert den dauerhaft sichtbaren falschen Update-Hinweis auf iOS/Safari.

## Neuer GitHub-Pages-Repository-Start (v12)

Dieses Release enthält die beiden Bootstrap-Workflows unter `.github/workflows/`.
Bei einem **neuen** Repository muss der Inhalt dieses ZIPs einmalig entpackt und als
Repository-Inhalt committed werden. Nur die ZIP-Datei selbst in ein leeres Repository
zu laden reicht beim ersten Mal nicht, weil dort noch kein Import-Workflow existiert.

Danach gilt für normale Releases:

1. Genau **eine** neue `*.zip` ins Root des Repository hochladen.
2. `Import uploaded ZIP` prüft und entpackt das Release.
3. `.git` und `.github/workflows/` werden dabei niemals ersetzt.
4. Die hochgeladene ZIP wird nach erfolgreichem Import entfernt.
5. Der Workflow committed die Release-Dateien und deployt GitHub Pages direkt.
6. Normale Nicht-ZIP-Commits werden von `Deploy GitHub Pages` veröffentlicht.

GitHub Pages muss einmalig unter **Settings → Pages → Build and deployment → Source → GitHub Actions** aktiviert werden.

### Warum zwei Workflows?

Der Commit des ZIP-Importers wird mit `GITHUB_TOKEN` erzeugt. GitHub startet daraus
absichtlich keinen weiteren `push`-Workflow. Darum deployt `Import uploaded ZIP` das
importierte Release selbst. `Deploy GitHub Pages` ist für normale direkte Änderungen
im Repository zuständig.


## v8
- Artikelansicht: horizontal wischen. Nach rechts = Einlagern, nach links = Verbrauchen. Vertikales Scrollen bleibt aktiv.
- Neuer Filter **Nur vorrätige** (Bestand > 0).


## v9

- Swipe-Karten auf iOS auf volle Breite stabilisiert.
- Swipe-Aktionsflächen sind im Ruhezustand unsichtbar und erscheinen nur während einer horizontalen Wischgeste.
- Lange Artikelnamen werden sauber gekürzt, ohne die Kartenbreite zu verändern.


## v12

- Swipe-Weg in der Artikelansicht auf bis zu ca. 52 % der Kartenbreite bzw. 190 px erweitert.
- Aktionsbeschriftungen „Einlagern“ und „Verbrauchen“ sind dadurch beim Wischen vollständig sichtbar.
- Auslöseschwelle bleibt deutlich kleiner als der maximale Reveal-Weg, damit die Aktion auf dem iPhone angenehm bedienbar bleibt.


### v12
- iOS Swipe→Verbrauch: Pointer-Capture wird vor dem Ansichtswechsel freigegeben.
- Ansichtswechsel nach Swipe wird um zwei Animation-Frames verzögert; kein Autofokus auf Menge.
- Buchen-Button wird während der laufenden Buchung gesperrt, um Doppelbuchungen zu verhindern.


## v12 – iOS Swipe → Buchen
Die Artikelkarte ist beim Wischen kein natives Button-Element mehr. Dadurch bleibt nach der Geste kein Safari-Touch/Fokuszustand hängen. Der Verbrauchsbutton verarbeitet Touch über einen sauberen Pointer-up-Pfad, damit der erste bewusste Tipp direkt bucht.


## v13 – Lagerstand bei Abbuchungen

In der Verbrauchsansicht wird für den ausgewählten Artikel der aktuelle Lagerstand inklusive Bestandseinheit angezeigt. Das gilt auch beim Öffnen der Verbrauchsansicht per Swipe. Nach einer erfolgreichen Abbuchung wird der neue Lagerstand sofort aus den frisch geladenen Grocy-Daten angezeigt und zusätzlich in der Erfolgsmeldung genannt.
