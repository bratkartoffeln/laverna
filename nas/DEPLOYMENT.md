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
| Anwendung / NAS-Paket | `0.7.4-RC1` / `2.0.0` |
| Anwendungscontainer | `laverna-laverna-1`, Node.js 24 + SQLite |
| Updater | `laverna-updater-updater-1`, eigener Compose-Stack |
| Dauerhafte Datenbank | `/share/Container/laverna/data/laverna.sqlite` |
| HTTPS-Container | `laverna-caddy-1`, `laverna-caddy-dynv6:1.1.1` |
| Neustartregel | `unless-stopped` fuer Anwendung, HTTPS und Updater |

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
Adresse sowie die neue Anwendung im isolierten NAS-Container. GitHub prueft
Server, Kontentrennung, Konflikte und Rollback sowie echte Browserablaeufe:
Editor speichern, zwei Geraete, Anhaenge, Offline-Aenderungen, konkurrierende
Bearbeitungen, Neuladen, Kontowechsel und verschluesselte Notizen/Anhaenge.
Die vorhandenen RPS-Container liefen waehrend und nach der Einrichtung weiter.

## Verwaltung

In einer Administrations-SSH-Shell:

```sh
cd /share/Container/laverna/laverna-nas
sh scripts/qnap.sh status
sh scripts/qnap.sh check https://flusensieb.dns.navy:10443
sh scripts/qnap.sh logs
```

Der Updater prueft alle fuenf Minuten den Branch `master`. Nur der neueste
erfolgreiche Push-Prueflauf von `verify.yml` fuer exakt den neuen Commit
erlaubt die Aktivierung. SQLite wird davor konsistent gesichert; bei einem
Fehler werden vorheriges Image und Datenbank wiederhergestellt. Caddy und
seine Zertifikatsspeicher bleiben beim automatischen Anwendungsupdate bestehen.

Updater-Status und konsistente Datenbanksicherung:

```sh
sh scripts/qnap.sh update
sh scripts/qnap.sh backup
```

Die QNAP-Skripte ermitteln den Container-Station-Dockerpfad bei Bedarf selbst.
Die benannten Zertifikats-Volumes bei Updates erhalten; kein `down -v` nutzen.
NAS-Synchronisierung ist fuer angemeldete Konten voreingestellt. Jede Person
hat getrennte Notizen und einen eigenen lokalen Browser-Speicherbereich. Den
ersten Administrator per lokalem Einrichtungsschluessel anlegen; weitere Konten
werden unter `NAS-Konto` verwaltet. Alte Browsernotizen koennen ihre Besitzer
in den Synchronisierungseinstellungen ausdruecklich uebernehmen.
Der aktuell installierte Commit steht in `ready.json` und im Updater-Zustand
unter `/share/Container/laverna/.laverna-updater/state.json`.
