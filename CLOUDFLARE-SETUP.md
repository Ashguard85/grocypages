# Cloudflare Access für die Grocy PWA

## Ziel

GitHub-Pages-PWA → HTTPS → Cloudflare Access → Grocy `/api/...`

Die PWA sendet bei Serverzugriff:

- `GROCY-API-KEY`
- optional `Content-Type: application/json`
- `CF-Access-Client-Id`
- `CF-Access-Client-Secret`

## 1. Service Token

Cloudflare Zero Trust → Access → Service credentials → Service Tokens.

Erstelle möglichst ein eigenes Token pro Gerät/PWA-Installation.

## 2. Service-Auth-Policy

In der Access-Anwendung, die die öffentliche Grocy-Domain schützt, eine Policy hinzufügen:

- Action: **Service Auth**
- Include: **Service Token**
- Value: das zuvor erstellte Token

Eine normale Allow-/OTP-Policy alleine reicht für den Service Token nicht.

## 3. CORS / OPTIONS

Ein Browser sendet vor den Grocy-API-Aufrufen einen OPTIONS-Preflight, weil Custom Headers benutzt werden. Cloudflare Access muss diesen Preflight zulassen.

Einfachste Variante für Grocy:

Access → Applications → Grocy → Configure → Advanced settings → Cross-Origin Resource Sharing (CORS) → **Bypass OPTIONS requests to origin**.

Grocy beantwortet `/api/...` OPTIONS selbst. Die eigentlichen Datenrequests bleiben weiter durch Access geschützt.

Alternativ kann Cloudflare den Preflight selbst beantworten. Dann exakt konfigurieren:

- Origin: deine Pages-Origin/Custom Domain
- Methods: `GET, POST, PUT, DELETE, OPTIONS`
- Headers: `Content-Type, GROCY-API-KEY, CF-Access-Client-Id, CF-Access-Client-Secret`

## 4. PWA

Setup → Server – Grocy API

- Grocy URL: `https://grocy.example.com`
- Grocy API-Key: aus Grocy
- Client ID: aus Cloudflare Service Token
- Client Secret: aus Cloudflare Service Token

Dann **Verbindung vollständig prüfen**.

Der Test ruft `https://grocy.example.com/api/system/info` auf.

## 5. Diagnose

- Netzwerk/CORS/Preflight: Cloudflare OPTIONS-Konfiguration prüfen.
- 403 Cloudflare: Service-Auth-Policy/Token prüfen.
- 401 Grocy: API-Key prüfen.
- HTML statt JSON: Access-/Login-Seite fängt die Anfrage ab.
