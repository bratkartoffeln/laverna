---
name: commit-publish-merge
description: Änderungen an Laverna mit einer passenden Commit-Nachricht committen, den Versionsbranch veröffentlichen, einen Pull Request nach master erstellen, mit Merge-Commit zusammenführen und auf das aktualisierte master wechseln. Verwenden, wenn dieser Veröffentlichungsablauf angefordert wird; die Bitte, den Skill zu kopieren oder eine Commit-Nachricht zu formulieren, startet ihn nicht.
---

# Commit, Publish und Merge für Laverna

Ein Auftrag für den vollständigen Workflow autorisiert Commit, Push, PR und
Merge. Dafür keine erneute allgemeine Bestätigung verlangen. Technisch
erforderliche Freigaben der Ausführungsumgebung bleiben einzuhalten.
Das bloße Erstellen oder Bearbeiten dieses Skills startet den Workflow nicht.

## Ausgangslage

- `AGENTS.md`, aktiven Branch, NAS-Version in `nas/package.json`, Status,
  gestagte und ungestagte Diffs sowie unversionierte Dateien prüfen.
  Nutzeränderungen und eigene Änderungen unterscheiden; nichts mit Reset,
  Clean oder Stash verwerfen oder verstecken.
- Mit `git remote -v` das Ziel bestimmen. Dieses Projekt verwendet derzeit
  `origin` → `bratkartoffeln/laverna`, Zielbranch `master`. Repository bei
  GitHub-Aufrufen ausdrücklich angeben; vorhandene CLI oder GitHub-Anbindung
  verwenden. Authentifizierungsdaten nicht ausgeben.
- Remote-Referenzen abrufen. Auf einem vorhandenen Arbeitsbranch weiterarbeiten.
  Auf `master` zuerst gemäß `AGENTS.md` einen freien Versionsbranch und die
  nächste NAS-Patchversion anlegen. Dies gilt auch für reine Regel-/Skill- und
  Dokumentationsänderungen. Bei detached HEAD den gewünschten Branch klären.
- Den gesamten Unterschied gegen `origin/master`, lokale unveröffentlichte
  Commits und einen passenden offenen PR prüfen. Vorhandene PRs weiterverwenden;
  keine doppelten Commits oder PRs bei Wiederaufnahme erzeugen.

## Prüfungen für dieses Projekt

- NAS und Server verwenden dieselbe Version in `nas/package.json`,
  `nas/package-lock.json` und `nas/server/package.json`. Die alte
  Wurzel-`package.json` ist keine NAS-Versionsquelle. Die getrennten
  Caddy-/dynv6-Versionen nicht unnötig erhöhen.
- Den tatsächlichen Änderungsumfang prüfen. Für Anwendungsänderungen:
  `npm test --prefix nas` und `node nas/build.js --web-only`; bei
  Browseränderungen zusätzlich `node nas/tests/browser.mjs` und weitere
  betroffene Browserprüfungen. Browser bei Bedarf mit der festgeschriebenen
  Playwright-Core-CLI installieren. Unter Windows kann `LAVERNA_BROWSER`
  auf Edge zeigen. Keine alte Gulp-/Electron-Installation dafür voraussetzen.
- Bei Infrastrukturänderungen die betroffenen Compose-, Docker- und
  Shell-Dateien prüfen. Reine Dokumentations-/Skill-Änderungen brauchen keine
  vollständigen Anwendungstests. Nur tatsächlich ausgeführte Prüfungen melden.
- `.github/workflows/verify.yml` prüft Server/Updater, Frontend-Build, Browser
  und das Produktionsimage. Lokale Tests und GitHub-Prüfungen getrennt benennen.

## Commit und Veröffentlichung

1. Den relevanten Diff vollständig prüfen und eine prägnante Commit-Nachricht
   aus dem tatsächlichen Ergebnis formulieren. Sprache und Stil der bisherigen
   Commits berücksichtigen; einen Body nur bei hilfreicher Begründung ergänzen.
2. Gezielt `git add -- DATEIEN` verwenden und `git diff --cached` prüfen.
   Keine fremden Änderungen, Secrets, `.env`, lokalen NAS-Daten, `.tmp/`,
   `release/` oder ungeprüfte unversionierte Dateien übernehmen. Bereits gestagte
   fremde Änderungen vor dem Commit klären, ohne sie zu verwerfen.
3. Commit erstellen. Mehrzeilige Nachrichten als UTF-8-Datei mit
   `git commit -F DATEI` übergeben. Ohne neue Änderungen keinen leeren Commit
   erzeugen; gegebenenfalls nur vorhandene Commits veröffentlichen.
4. Mit `git push -u REMOTE BRANCH` veröffentlichen. Kein Force-Push und kein
   Umschreiben bereits veröffentlichter Commits. Abweichende Remote-Historie
   untersuchen, statt sie zu überschreiben.

## Pull Request und Merge

1. PR nach `master` mit dem Arbeitsbranch als Head anlegen oder aktualisieren.
   Titel und Beschreibung am gesamten PR-Diff ausrichten: konkretes Problem,
   Verhalten nach der Änderung und ausgeführte Prüfungen. Für mehrzeilige
   Beschreibungen strukturierte Tool-Argumente oder `gh ... --body-file DATEI`
   verwenden.
2. PR-URL, Base, Head und aktuelle Head-SHA kontrollieren. Auf die aktuellen
   CI-Prüfungen dieser SHA warten. Sind keine Checks sichtbar, auch die
   Workflow-Läufe der SHA prüfen. In beobachtbaren Abschnitten warten und
   bei längerer Laufzeit Status geben.
3. Erst nach erfolgreichen erforderlichen Prüfungen und erfüllten
   Repository-Vorgaben mit **Merge-Commit** zusammenführen. Per GitHub-Tool
   `merge_method: merge` und die erwartete Head-SHA angeben; mit `gh`:
   `gh pr merge NUMMER --repo OWNER/REPO --merge --match-head-commit HEAD_SHA`.
   Kein Squash, Rebase, Admin-Bypass oder Abschalten von Branch-Regeln.
   Arbeitsbranches nur auf gesonderten Wunsch löschen.
4. Den tatsächlichen Zustand `MERGED` und den Merge-Commit bestätigen.
   Bei geänderter Head-SHA Diff und Prüfungen erneut betrachten. Ein
   eingeplanter Auto-Merge allein bestätigt keinen erfolgten Merge.

## NAS und Abschluss

- Ein Merge nach `master` stößt den vorhandenen NAS-Updater an. Dieser pollt
  alle fünf Minuten und installiert erst nach dem neuesten erfolgreichen
  **push**-Lauf von `verify.yml` für exakt denselben Commit. Ein erfolgreicher
  PR-Lauf ersetzt diese Freigabe nicht.
- Bei angefordertem NAS-Rollout den tatsächlichen Stand über
  `https://flusensieb.dns.navy:10443/ready.json` prüfen: `ok`, `sync`,
  `nasPackage` und `sourceRevision` müssen zum Merge-Commit passen. Ein
  erfolgreicher GitHub-Merge allein bedeutet noch keine NAS-Aktivierung.
  SQLite, Konten, `.env`, dynv6-Token und Caddy-Zertifikate erhalten. Keine
  zusätzliche SSH-/Tokenkopie für einen normalen automatischen Rollout anlegen.
- Nach bestätigtem Merge und ohne auftragsbezogene offene Änderungen lokal
  `git switch master`, `git fetch REMOTE` und
  `git merge --ff-only REMOTE/master` ausführen. Mit
  `git merge-base --is-ancestor MERGE_SHA HEAD` die Übernahme bestätigen.
  Bekannte unberührte lokale Dateien erhalten und offen benennen.
- Bei fehlender Authentifizierung, Konflikten, fehlgeschlagenen Prüfungen,
  fehlendem Review oder Rechten am betroffenen Schritt anhalten, den konkreten
  Zustand mit Branch/Commit/PR nennen und keine Regeln umgehen. Unverändert
  fehlgeschlagene Aktionen nicht endlos wiederholen; ausbleibenden CI-Fortschritt
  untersuchen und einen offenen Zustand ehrlich melden.
- Zum Abschluss Commit, PR-Link, Merge-Commit, ausgeführte Prüfungen und
  tatsächlich aktiven Branch nennen. NAS-Erfolg nur nach eigener Prüfung melden.
