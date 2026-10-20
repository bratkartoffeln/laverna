# Bestaetigter NAS-Stand am 20.10.2026

Laverna ist per SSH auf QNAS1 eingerichtet und gestartet.

| Einstellung | Installierter Wert |
| --- | --- |
| Oeffentliche Adresse | https://flusensieb.dns.navy:10443 |
| NAS-Adresse | 192.168.1.5 |
| HTTPS-Zuordnung | extern TCP 10443 → NAS TCP 20443 → Caddy 443 |
| Direkter LAN-Zugang | http://192.168.1.5:18081/ |
| Projektverzeichnis | `/share/Container/laverna/laverna-nas` |
| Compose-Projekt | `laverna` |
| Anwendung / NAS-Paket | `0.7.4-RC1` / `1.1.1` |
| Webcontainer | `laverna-laverna-1`, nginx, healthy |
| HTTPS-Container | `laverna-caddy-1`, `laverna-caddy-dynv6:1.1.1` |
| Neustartregel | `unless-stopped` fuer beide Container |

DNS-01 mit Let's Encrypt Staging und die produktive Zertifikatsausstellung
sind erfolgreich. Das produktive Zertifikat wurde fuer `flusensieb.dns.navy`
ausgestellt und ist bis 18.01.2027 gueltig; Caddy verwaltet die Erneuerung.
Die Zertifikate liegen in `laverna_caddy_data` und `laverna_caddy_config`.

Der vorhandene dynv6-Token wird ausschliesslich auf dem NAS als
schreibgeschuetztes Secret aus dieser Datei eingebunden:

```text
/share/Container/rps-arena/rps-remake/secrets/dynv6_api_token
```

Die alte Provider-Abfrage `/zones/by-name/` lieferte bei der Einrichtung HTTP
404. Der installierte Proxy verwendet die auf demselben NAS bereits bei
Slide-a-Llama bestaetigte Korrektur ueber die Zonenliste. Fuer die erste
Laverna-Imageerstellung wurde dessen bereits gebautes Caddy-Binary in ein
eigenes Laverna-Image kopiert. Spaetere Standardbuilds bauen selbst aus den
mitgelieferten Providerquellen und fuehren dessen Tests aus.
Sicherung der vorherigen Konfiguration: `/share/Container/laverna/backups/`.

Geprueft wurden TLS samt Zertifikatsvertrauen ueber LAN und die oeffentliche
Adresse, die ausgelieferte Anwendungsversion und der echte Browserablauf:
Ersteinrichtung, Markdown-Notiz anlegen, speichern, neu laden und erneut
oeffnen. Die Testnotiz lag nur in einem getrennten temporaeren Browserprofil.
Die vorhandenen RPS-Container liefen waehrend und nach der Einrichtung weiter.

## Verwaltung

In einer Administrations-SSH-Shell:

```sh
cd /share/Container/laverna/laverna-nas
sh scripts/qnap.sh status
sh scripts/qnap.sh check https://flusensieb.dns.navy:10443
sh scripts/qnap.sh logs
```

Nach Uebernahme neuer Paketdateien, unter Beibehaltung der eigenen `.env`:

```sh
sh scripts/qnap.sh update
```

Die QNAP-Skripte ermitteln den Container-Station-Dockerpfad bei Bedarf selbst.
Die benannten Zertifikats-Volumes bei Updates erhalten; kein `down -v` nutzen.
Die Notizen bleiben im Browser des jeweiligen Geraets und sollten mit Laverna
exportiert werden; das NAS-Hosting richtet keine zentrale Notizablage ein.
