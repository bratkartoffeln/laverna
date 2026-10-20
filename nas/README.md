# Laverna mit NAS-Synchronisierung

Die Browseranwendung läuft auf QNAS1 unter **https://flusensieb.dns.navy:10443**.
Extern TCP **10443** wird auf NAS TCP **20443** und Caddy **443** weitergeleitet.
Caddy spricht intern den Laverna-Dienst auf Port **3000** an.

Jede Person erhält ein eigenes Laverna-Konto. Notizen, Notizbücher, Tags,
Anhänge und Papierkorb werden auf dem NAS in SQLite gespeichert und zwischen
angemeldeten Geräten abgeglichen. Der Anwendungscontainer enthält Node.js und
SQLite; ein zusätzlicher Datenbankcontainer ist nicht erforderlich.

## Anmeldung und Konten

Auf der Browseradresse anmelden. Auf einem neuen Gerät ist die
NAS-Synchronisierung automatisch aktiviert. Unter **Einstellungen → NAS-Konto** können Benutzer
ihr Passwort ändern oder sich abmelden. Der Administrator kann dort Konten
anlegen, sperren und Passwörter zurücksetzen. Es gibt keine öffentliche Registrierung.
Die Kontoverwaltung ist Teil des gewohnten Laverna-Layouts. Auch der Eintrag
**NAS-Konto** im Seitenmenü und die Adresse `/account` führen zu diesem Reiter.
Am Verschlüsselungsbildschirm ermöglicht **NAS-Anmeldung wechseln** den Kontowechsel,
ohne zuvor die Notizen entsperren zu müssen.
Passwörter benötigen mindestens zwölf Zeichen und werden mit scrypt gespeichert.
Die Anmeldung verwendet ein HttpOnly-Cookie; HTTPS ist für den normalen Betrieb erforderlich.

Der erste Administrator wird einmalig mit einem Einrichtungsschlüssel angelegt.
Der Schlüssel liegt im Container unter /data/setup-token, auf diesem NAS unter
/share/Container/laverna/data/setup-token. Er wird nach erfolgreicher Einrichtung gelöscht.
Alternativ: docker exec -i laverna-laverna-1 node server/admin.mjs create-admin BENUTZER
(Passwort auf der Standardeingabe, nicht als Argument).

## Ansicht

Unter **Einstellungen → Ansicht** lässt sich der **Dark-Modus** einschalten.
Der Schalter **Dark-Modus einschalten/ausschalten** im Seitenmenü unter
**Sonstiges** ändert die Darstellung direkt. Die Auswahl gilt für diesen Browser,
bleibt beim Neuladen und Abmelden erhalten und wird auch für die Anmeldung verwendet.
Notizliste, Editor, Markdown-Vorschau, Dialoge und Kontoverwaltung passen ihre Farben an.

## Abgleich und bestehende Daten

Nach dem Speichern und spätestens alle 15 Sekunden wird das aktive Profil
abgeglichen. Ohne Netzwerk bleiben Bearbeitungen lokal und werden nach
Wiederherstellung der Verbindung erneut übertragen. Bereits geladene Notizen
lassen sich in der geöffneten Anwendung ohne Verbindung bearbeiten; ein neuer
Seitenaufruf benötigt den NAS-Server. Der Status steht im Seitenmenü, der
Synchronisierungsknopf startet einen sofortigen Abgleich.

Gleichzeitige Bearbeitungen erzeugen Konfliktkopien. Eine veraltete Löschung
überschreibt keine neuere Fassung. Der Server hält eine Versionshistorie vor,
auch für endgültig gelöschte Datensätze. Diese Daten liegen deshalb weiterhin
in der NAS-Datenbank und ihren Sicherungen. Anhänge dürfen bis zu 10 MiB groß
sein, einzelne Notizen inklusive JSON bis zu 2 MiB.

Lokale Browserdaten werden pro NAS-Konto getrennt gespeichert. Alte Notizen ohne
Kontozuordnung werden nicht automatisch einem Benutzer zugeschlagen. Unter
**Einstellungen → Synchronisierung → Bisherige lokale Notizen dieses Browsers
übernehmen** kann der Besitzer sie ausdrücklich übernehmen. Alte Daten bleiben
erhalten. Daten von einer anderen Adresse zuerst dort exportieren und anschließend
in das angemeldete NAS-Konto importieren. Für weitere Profile zuerst das entsprechende
Profil anlegen/auswählen; auf dem Server bekannte Profile werden in der Profilliste ergänzt.

## Optionale Laverna-Verschlüsselung

NAS-Anmeldung und Notizverschlüsselung sind getrennt. Ohne die optionale
Laverna-Verschlüsselung liegen Notizinhalte auf dem NAS im Klartext; Zugriff
auf die API erfordert das jeweilige Konto. Bei aktivierter Verschlüsselung
werden die bereits verschlüsselten Notizen und zusätzlich verschlüsselte
Anhänge übertragen. Das Verschlüsselungspasswort wird nicht an den NAS-Dienst gesendet.

Auf allen Geräten dieselben Laverna-Einstellungen importieren und dasselbe
Verschlüsselungspasswort verwenden. Abweichende Einstellungen blockieren den
Abgleich, um einen gemischten Datenbestand zu verhindern. Die Verschlüsselung
vor dem ersten Upload einrichten. Für einen späteren Wechsel der Verschlüsselung
ein neues Profil verwenden und die Notizen dorthin übernehmen. Einstellungen
und Verschlüsselungspasswort zusätzlich sichern.

## Daten, Sicherungen und Updates

- Anwendung: /share/Container/laverna/laverna-nas
- Dauerhafte Daten: /share/Container/laverna/data/laverna.sqlite
- Konsistente Sicherungen: /share/Container/laverna/data/backups
- Updater-Zustand: /share/Container/laverna/.laverna-updater
- HTTPS-Zertifikate: Volumes laverna_caddy_data und laverna_caddy_config

Konsistente Datenbanksicherung: sh scripts/qnap.sh backup.
Auch bei laufendem Server ausschließlich die SQLite-Backup-Funktion verwenden;
eine alleinige Kopie der geöffneten Datenbankdatei kann WAL-Daten auslassen.
Den gesamten Datenordner regelmäßig mit der NAS-Sicherung sichern.

Der eigene Updater prüft alle fünf Minuten bratkartoffeln/laverna, Branch master.
Nur der neueste erfolgreiche **push**-Lauf von verify.yml für exakt denselben
Commit erlaubt die Installation. Er baut und testet zunächst einen separaten
Container. Zur Aktivierung pausiert er Schreibzugriffe, sichert SQLite und
startet nur den Anwendungsdienst neu. Bei Fehlern stellt er das vorherige Image
und die Datenbank wieder her. Auch unterbrochene Aktivierungen werden beim
Neustart anhand eines Journals zurückgenommen. Proxy, Zertifikate, Token und
andere NAS-Projekte werden beim automatischen Update nicht verändert.

Das Updater-Image enthält die CA-Zertifikate für die Docker-Registry. Die CI
prüft den Registry-Zugriff mit der Docker-CLI im Updater-Container; Node.js
allein würde fehlende Systemzertifikate durch seinen eigenen Zertifikatsspeicher verdecken.

Das öffentliche Repository benötigt für automatische Updates keinen GitHub-Token.
Optional kann ein Token mit lesendem Repository-/Actions-Zugriff lokal unter
.laverna-updater/github-deploy.token liegen (Modus 600); niemals ins Repository eintragen.
Die dynv6-Token-Datei ist ausschließlich für Caddy zuständig.

Details zur Einrichtung: [QNAP-START.md](QNAP-START.md).
Bestätigter Installationsstand: [DEPLOYMENT.md](DEPLOYMENT.md).

## Entwicklung

Node.js 24.14.x, Git und npm verwenden. Die alte Gulp-/Electron-Werkzeugkette
wird für den NAS-Build nicht benötigt.

    npm ci --prefix nas --ignore-scripts
    npm test --prefix nas
    node nas/build.js --web-only
    node nas/node_modules/playwright-core/cli.js install chromium
    npm run test:browser --prefix nas

Auf Windows kann LAVERNA_BROWSER auf die installierte Edge-EXE zeigen.
Ein vollständiges Paket samt ZIP/Prüfsumme erzeugt npm run build:nas.
Dockerfile im Repository baut das Programm für den NAS-Updater aus dem Quellcode.
Die Frontend-Abhängigkeiten sind in nas/vendor-lock.json festgeschrieben.

Technische Grundlagen: [Node.js SQLite](https://nodejs.org/download/release/v24.14.0/docs/api/sqlite.html),
[Docker Compose](https://docs.docker.com/reference/compose-file/services/),
[Caddy DNS-01](https://caddyserver.com/docs/caddyfile/directives/tls).
