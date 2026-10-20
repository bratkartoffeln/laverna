# Laverna auf QNAS1 einrichten

Ziel: https://flusensieb.dns.navy:10443, extern TCP10443 → NAS TCP20443 → Caddy443.
RPS und Slide-a-Llama behalten ihre eigenen Container und Zertifikatsspeicher.

## Erstinstallation

Das Paket nach /share/Container/laverna/laverna-nas entpacken. Darin liegen
web, server, deploy, scripts, updater und die Compose-/Caddy-Dateien.
Die Datenbank liegt daneben in /share/Container/laverna/data und darf beim
Ersetzen der Programmdateien nicht gelöscht werden.

In einer Administrations-SSH-Shell:

    cd /share/Container/laverna/laverna-nas
    docker compose -p laverna -f compose.yaml build laverna
    sh scripts/qnap.sh check-dns
    sh scripts/qnap.sh start
    sh scripts/qnap.sh check https://flusensieb.dns.navy:10443

Bei einer bereits eingerichteten Installation Caddy nicht erneut bauen oder
seine Zertifikats-Volumes ersetzen. Der dynv6-Token bleibt unter
/share/Container/rps-arena/rps-remake/secrets/dynv6_api_token und wird nur als
schreibgeschütztes Secret eingebunden. Die lokale .env enthält ausschließlich
Pfade und Konfigurationswerte. Port18081 bleibt zur LAN-Diagnose erreichbar;
für Benutzerkonten die öffentliche HTTPS-Adresse verwenden.

Ersten Administrator im Browser mit dem lokalen Einrichtungsschlüssel anlegen,
oder per Passwort-Standardeingabe an server/admin.mjs create-admin.
Anschließend weitere Personen unter NAS-Konto anlegen.

## Automatische Updates aktivieren

    sh scripts/install-updater.sh
    docker compose -p laverna-updater -f ../.laverna-updater/runtime/compose.updater.yaml ps
    docker compose -p laverna-updater -f ../.laverna-updater/runtime/compose.updater.yaml logs --tail=30

Der Updater bindet ausschließlich seinen Laverna-Projektordner sowie den
QNAP-Docker-Client, das Compose-Plugin und den Docker-Socket ein. Er läuft als
eigener Container mit Neustartregel. Beim ersten Start wird der beobachtete
Git-Stand als Ausgangspunkt erfasst; ein installierter Commit wird nur dann
vermerkt, wenn laufendes Image und Bereitschaftsantwort ihn bestätigen.

Die GitHub-Prüfung baut und testet Server, Konfliktbehandlung, Rücknahme nach
fehlgeschlagenen Updates und den Browserabgleich mit getrennten Konten. Pushes
auf master werden nach erfolgreicher Prüfung innerhalb des nächsten
Fünf-Minuten-Intervalls installiert. Pull Requests und unvollständige/fehlgeschlagene
Prüfungen werden nicht ausgerollt. Ein fehlgeschlagener Programmstand wird bis
zum nächsten Commit zurückgestellt; vorübergehende Netzwerkfehler werden
beim nächsten Intervall erneut versucht. Pro NAS darf nur ein Laverna-Updater laufen.

Automatische Updates ersetzen nur das Anwendungsimage. Neue Compose- oder
Caddy-Konfiguration und der Updater selbst werden gezielt separat aktualisiert.
Der aktuelle Image-Override liegt in .laverna-updater/active-image.json;
qnap.sh berücksichtigt ihn auch bei manuellen Starts/Statusaufrufen.

## Betrieb und Wiederherstellung

    sh scripts/qnap.sh status
    sh scripts/qnap.sh logs
    sh scripts/qnap.sh backup
    sh scripts/qnap.sh update

Die Backup-Datei wird unter /data/backups im Container erstellt. Bei einer
manuellen Wiederherstellung zuerst Updater und Laverna-Anwendung anhalten,
dann die konsistente Sicherung als data/laverna.sqlite einsetzen, vorhandene
laverna.sqlite-wal und laverna.sqlite-shm entfernen und Eigentümer1000:1000
sicherstellen. Das verwendete Anwendungsimage muss das Datenbankschema unterstützen.
Danach über qnap.sh start starten. Zertifikats-Volumes bleiben bestehen.

Passwort vergessen: per Administrations-SSH das CLI server/admin.mjs
reset-password BENUTZER aufrufen und das neue Passwort auf der Standardeingabe
übergeben. Bisherige Sitzungen dieses Kontos werden abgemeldet.

Mehr zu Import, Verschlüsselung und Dateigrenzen: [README.md](README.md).
