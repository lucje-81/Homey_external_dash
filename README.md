# Homey Web Dashboard in Docker

Je Homey-dashboards in elke browser op je netwerk: pc, tablet aan de muur, tv. Draait als Docker-container naast je
Homey Self-Hosted Server (of gewoon naast een Homey Pro).

De weergave komt van **[Web Dashboard](https://github.com/stefan-schweiger/dev.schweiger.dashboard)** van Stefan
Schweiger (GPL-3.0). Die toont je echte Homey-dashboards, met de ingebouwde widgets én de widgets van apps. Deze
container zet daar een eigen server voor:

| Web Dashboard als Homey-app | Deze Docker-versie |
|---|---|
| Elke gekoppelde browser krijgt de API-sleutel | De sleutel blijft op de server; browsers krijgen hem nooit te zien |
| Eén sleutel voor iedereen; afmelden = sleutel vervangen | Aanmelden met wachtwoord; alle browsers afmelden = één bestand wissen |
| Elke browser heeft een eigen live-verbinding met Homey | Eén verbinding met Homey, gedeeld door alle schermen |
| Draait op je Homey | Draait los van Homey; een firmware-update breekt hem minder snel |
| Alleen via `homeylocal.com` | Eigen adres en poort; later makkelijk achter een reverse proxy met HTTPS |

## Wat je nodig hebt

- Docker met Docker Compose op je pc
- Het lokale adres van je Homey
- Een **API-sleutel** van je Homey

### De API-sleutel

Maak een sleutel aan in [my.homey.app](https://my.homey.app) → **Instellingen → API-sleutels**, met deze rechten:
apparaten (lezen + bedienen), flows (lezen + starten), moods, zones, logica, notificaties, apps (lezen), gebruikers,
insights, energie, systeem (lezen) en **dashboards (lezen)**.

> Het formulier in my.homey.app bood volgens de maker van Web Dashboard geen dashboardrecht aan. Zie je dat recht niet,
> kijk dan op de instellingenpagina van de Web Dashboard-app: daar staat een commando dat een sleutel met precies de
> juiste rechten aanmaakt.

Wil je ook widgets kunnen **bewerken** vanuit de browser (knop *Edit*), geef de sleutel dan `homey.dashboard` in plaats
van `homey.dashboard.readonly`. Geef de sleutel nooit meer rechten dan nodig: iedereen die het dashboard kan openen,
kan alles wat de sleutel mag.

## Installeren

```bash
# 1. In deze map:
cp .env.example .env
# 2. Vul HOMEY_URL, HOMEY_TOKEN en DASHBOARD_PASSWORD in .env in
# 3. Bouwen en starten:
docker compose up -d --build
# 4. Logboek bekijken (je moet "Realtime naar Homey: verbonden" zien):
docker compose logs -f
```

Open daarna `http://<ip-van-je-pc>:8080` in een browser op je netwerk.

Een bepaald dashboard meteen openen: `http://<ip-van-je-pc>:8080/?dashboard=Woonkamer` (naam of id).

### HOMEY_URL

- **Homey Pro:** `https://192-168-1-50.homey.homeylocal.com` (je IP met streepjes) of `http://192.168.1.50`.
- **Self-Hosted Server:** het adres en de poort waarop je je SHS lokaal bereikt.
- Werkt het `homeylocal.com`-adres niet vanuit Docker, dan blokkeert je router of Pi-hole waarschijnlijk DNS-namen die
  naar een intern IP wijzen (*DNS rebinding protection*). Gebruik dan het gewone `http://`-adres.

Snel testen of het adres en de sleutel kloppen, vanaf de pc:

```bash
curl -H "Authorization: Bearer <sleutel>" <HOMEY_URL>/api/manager/system/
```

## Gebruik

- **Wandtablet:** open de pagina in Fully Kiosk Browser (Android) of zet hem als webapp op het beginscherm (iPad: Delen →
  Zet op beginscherm). Zet op een iPad *Automatisch vergrendelen* op *Nooit*. Een tablet blijft standaard 365 dagen
  aangemeld (`SESSION_DAYS`).
- **App-widgets** draaien standaard afgeschermd: ze kunnen niets buiten hun eigen app bereiken. Werkt een widget niet
  goed, open dan *Edit* → widget → *Edit Widget* en kies hoe hij draait:
  - **Sandboxed** (standaard): veiligst.
  - **Sandboxed with storage**: voor widgets die iets in de browser willen bewaren.
  - **Trusted**: zoals in de Homey-app; de widget kan dan alles wat de API-sleutel mag. Alleen voor apps die je vertrouwt.

  Je keuze wordt in `./data/widget-modes.json` bewaard en geldt voor alle schermen.
- **Alle browsers afmelden:** wis `./data/session-secret` en herstart (`docker compose restart`).
- **Fout `EACCES: permission denied` op `/data`:** met deze versie past de container de rechten van `./data` zelf aan.
  Bij een oudere versie: `chown 1000:1000 data` en `docker compose restart`.
- **Gezondheid:** `http://<ip>:8080/healthz` toont of de verbinding met Homey er is.

## Beveiliging

- De container is gemaakt voor je **thuisnetwerk**. Zet poort 8080 niet open in je router.
- Stel altijd een `DASHBOARD_PASSWORD` in, tenzij je iedereen op je wifi (ook gasten) je huis laat bedienen.
- Wijzigingen (`PUT`, `POST`, …) worden alleen aanvaard vanaf de eigen pagina: andere websites kunnen je Homey niet via
  een browser op je netwerk aansturen.
- Wil je het later van buitenaf gebruiken: zet er een reverse proxy met HTTPS voor (Nginx Proxy Manager, Traefik,
  Caddy, of een Cloudflare/Tailscale-tunnel), stel `TRUST_PROXY=true` in en gebruik een sterk wachtwoord.

## Wat (nog) niet werkt

Dit zijn beperkingen van de Web Dashboard-weergave zelf (stand van november 2026):

- Dashboards aanmaken, hernoemen of verwijderen en widgets toevoegen doe je in de Homey-app.
- Een aantal bedieningen ontbreekt nog (moduskiezers, knoppen, de tabbladen sensor/batterij/media van een apparaat).
- Webpagina's die niet ingesloten mogen worden, blijven leeg in een *Web Frame*-widget.
- De weergave is in het Engels.
- De functies die alleen in de Homey-app-versie bestaan (flowkaart *Show a dashboard*, widget uitlichten, automatische
  update) zitten niet in de Docker-versie.

Het formaat van de dashboards is niet officieel gedocumenteerd door Athom. Een Homey-update kan dus iets veranderen.

## Bijwerken

De Web Dashboard-versie staat vast in de `Dockerfile` (`WEB_DASHBOARD_COMMIT`), zodat een update van de maker je
installatie niet onverwacht verandert. Nieuwere versie proberen:

```bash
docker compose build --build-arg WEB_DASHBOARD_COMMIT=<commit-hash> && docker compose up -d
```

Lukt de bouw niet omdat `patches/proxy-mode.patch` niet meer past, dan moet die patch aangepast worden (twee kleine
wijzigingen: widgetmodi via deze server, en bij een verlopen sessie terug naar de aanmeldpagina).

## Hoe het werkt

```
Browser ──► Deze container :8080 ─────────────────────────────► Homey
            ├─ /            Web Dashboard (statische bestanden)
            ├─ /api/*       doorgestuurd mét API-sleutel   ───►  /api/*
            ├─ /socket.io   eigen realtime-server  ◄── één verbinding ──►  Homey realtime
            ├─ /local/*     widgetmodi (./data)
            └─ rest         doorgestuurd zonder sleutel     ───►  app-widgets, iconen
```

## Licentie

GPL-3.0, net als Web Dashboard, waarop dit gebouwd is. Voor eigen gebruik mag je alles aanpassen; deel je een aangepaste
versie, dan valt die ook onder GPL-3.0.
