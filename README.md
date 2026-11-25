# Homey Web Dashboard in Docker

Je Homey-dashboards in elke browser op je netwerk: pc, tablet aan de muur, tv. Draait als Docker-container naast je
Homey Self-Hosted Server (of gewoon naast een Homey Pro).

De weergave is een fork van **[Web Dashboard](https://github.com/stefan-schweiger/dev.schweiger.dashboard)** van
Stefan Schweiger (GPL-3.0, versie 1.4.1, zie `frontend/UPSTREAM.md`). Die toont je echte Homey-dashboards, met de
ingebouwde widgets én de widgets van apps. Deze versie vult aan wat er nog ontbrak, en zet er een eigen server voor:

**Bijgebouwd in deze fork**
- Nederlandse interface (volgt de taal van je Homey)
- Apparaatvenster met alle tabbladen: moduskiezer, knoppen, sensoren, batterij en media
- Bewerken in de browser: widgets toevoegen (ingebouwde en app-widgets), kolommen toevoegen en verwijderen, dashboards
  aanmaken, hernoemen en verwijderen, de tekst van notities aanpassen
- Webpagina-widgets die inbedden weigeren, toont de server alsnog
- Flows kunnen een dashboard tonen of een widget uitlichten, op één scherm of op alle

**De server**

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

Wil je ook kunnen **bewerken** vanuit de browser (knop *Bewerken*: widgets, kolommen, dashboards), geef de sleutel dan
`homey.dashboard` in plaats van `homey.dashboard.readonly`. Geef de sleutel nooit meer rechten dan nodig: iedereen die het dashboard kan openen,
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
- **Bewerken:** *Bewerken* rechtsboven. Elke widget krijgt een menu (•••) om hem te verplaatsen, in te stellen of te
  verwijderen; onder elke kolom staat *Widget toevoegen* en een prullenbak (alleen voor een lege kolom), naast de laatste
  kolom *Kolom toevoegen*. Dashboards aanmaken, hernoemen en verwijderen doe je via de naam linksboven. Alles wordt
  meteen op je Homey bewaard en is dus ook in de Homey-app te zien. Zones, camera's, webpagina's, sensoren en
  zonebediening voeg je (nog) toe in de Homey-app; hun instellingen wijzig je daar ook.
- **App-widgets** draaien standaard afgeschermd: ze kunnen niets buiten hun eigen app bereiken. Werkt een widget niet
  goed, open dan *Bewerken* → widget → *Widget bewerken* en kies hoe hij draait:
  - **Afgeschermd** (standaard): veiligst.
  - **Afgeschermd met opslag**: voor widgets die iets in de browser willen bewaren.
  - **Vertrouwd**: zoals in de Homey-app; de widget kan dan alles wat de API-sleutel mag. Alleen voor apps die je vertrouwt.

  Je keuze wordt in `./data/widget-modes.json` bewaard en geldt voor alle schermen.
- **Taal:** de taal van je Homey. Een andere kiezen kan met `DASHBOARD_LANGUAGE` (`nl` of `en`) in `.env`. Teksten in
  app-widgets komen van de app zelf.
- **Webpagina-widgets:** weigert een pagina om ingebed te worden (zoals veel routers en Google), dan haalt de server ze
  op en toont ze afgeschermd. Dat werkt voor eenvoudige pagina's; pagina's waarvoor je moet inloggen werken zo meestal
  niet. Alleen adressen die in een webpagina-widget staan, worden opgehaald.
- **Afmelden:** *Instellingen* → *Afmelden*. **Alle browsers afmelden:** wis `./data/session-secret` en herstart (`docker compose restart`).
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

## Flows: dashboard tonen of widget uitlichten

Elke browser die het dashboard opent, meldt zich als **scherm**. De naam zie en wijzig je in *Instellingen* → *Dit
scherm* (bv. "Gangtablet"). Een Homey-flow stuurt de schermen aan met een HTTP-verzoek naar de container. Daarvoor heb
je een flowkaart voor HTTP-verzoeken nodig; heb je die nog niet, zoek dan in de Homey App Store op "HTTP request".

De **flow-sleutel** staat bij het starten in het logboek (`docker compose logs | grep Flow-sleutel`) en in
`./data/flow-key`. Je kunt ook zelf een kiezen met `FLOW_KEY` in `.env`.

| Wat | Adres (GET of POST) |
|---|---|
| Dashboard tonen | `http://<ip>:8080/flow/show-dashboard?key=<sleutel>&dashboard=Woonkamer&screen=Gangtablet` |
| Widget uitlichten | `http://<ip>:8080/flow/highlight?key=<sleutel>&dashboard=Woonkamer&widget=Laadpaal&size=large&seconds=60&screen=all` |
| Uitlichten sluiten | `http://<ip>:8080/flow/close-highlight?key=<sleutel>&screen=all` |
| Schermen opvragen | `http://<ip>:8080/flow/screens?key=<sleutel>` |

- `dashboard`: naam of id. `widget`: de titel van de widget, of de naam van het apparaat of de zone die hij toont.
- `screen`: de naam van een scherm, of `all` (standaard).
- `size`: `large` (standaard, met rand) of `fullscreen`. `seconds`: na hoeveel seconden het vanzelf sluit (leeg = blijft).
- Een fout (onbekend dashboard, widget of scherm) geeft een melding met wat er wel bestaat.
- Wie op een scherm het uitlichten sluit, sluit het op alle schermen.

## Wat (nog) niet werkt

- Zones, camera's, webpagina's, sensoren en zonebediening als **nieuwe** widget toevoegen, en de instellingen van die
  widgets wijzigen: dat doe je in de Homey-app.
- De widget met dynamische stroomprijzen is niet getest.
- Een flow starten wanneer iemand een uitgelichte widget sluit (de app-versie heeft daar een kaart voor).
- De pictogrammen van de bedieningen zijn eigen tekeningen, niet die van Athom.

Het formaat van de dashboards is niet officieel gedocumenteerd door Athom. Een Homey-update kan dus iets veranderen.
Nieuwe widgets en notitieteksten worden bewaard zoals de Homey-app ze verwacht, maar controleer de eerste keer of ze in
de Homey-app goed verschijnen.

## Bijwerken

```bash
git pull
docker compose up -d --build
```

Nieuwere versies van Web Dashboard worden niet automatisch overgenomen: de frontend staat in `frontend/` en wijkt
intussen af. `frontend/UPSTREAM.md` beschrijft hoe je wijzigingen van de maker samenvoegt.

## Hoe het werkt

```
Browser ──► Deze container :8080 ─────────────────────────────► Homey
            ├─ /            Web Dashboard (statische bestanden)
            ├─ /api/*       doorgestuurd mét API-sleutel   ───►  /api/*
            ├─ /socket.io   eigen realtime-server  ◄── één verbinding ──►  Homey realtime
            ├─ /local/*     widgetmodi, schermen, uitlichten, webpagina's (./data)
            ├─ /flow/*      aanroepen vanuit Homey-flows (met flow-sleutel)
            └─ rest         doorgestuurd zonder sleutel     ───►  app-widgets, iconen
```

## Licentie

GPL-3.0, net als Web Dashboard, waarop dit gebouwd is. Voor eigen gebruik mag je alles aanpassen; deel je een aangepaste
versie, dan valt die ook onder GPL-3.0.
