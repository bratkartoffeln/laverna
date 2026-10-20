# Projektregeln für Laverna

## Versionsbranches vor Änderungen

- Vor jedem Änderungsauftrag den aktiven Git-Branch, `git status --short` und die NAS-Projektversion in `nas/package.json` prüfen.
- Steht der aktive Branch auf `master`, vor der ersten Änderung einen neuen Versionsbranch anlegen und dorthin wechseln. Dazu die Patchversion um eins erhöhen, zum Beispiel von `2.0.0` auf `2.0.1`. Der Branch heißt exakt wie die neue Version, ohne Präfix.
- Diese Regel gilt für alle Änderungen, auch für Dokumentation, Regeln und Skills. Zusammengehörige Änderungen eines Auftrags bleiben auf demselben Versionsbranch.
- Einen bereits vorhandenen gleichnamigen lokalen oder Remote-Branch weder überschreiben noch löschen. Stattdessen die nächste freie höhere Patchversion verwenden. Vorhandene Remote-Referenzen prüfen, bei Netzwerkzugriff mit `git fetch origin` aktualisieren.
- Auf dem neuen Branch `nas/package.json`, `nas/package-lock.json` (oberstes `version` und `packages[""].version`) sowie `nas/server/package.json` auf dieselbe Version setzen. Aktuelle Anwendungs-/Updater-Image-Tags in `nas/compose.yaml`, `nas/updater/compose.updater.yaml` und `nas/scripts/install-updater.sh` entsprechend pflegen. Das separat versionierte Caddy-Image unverändert lassen, sofern sich dessen Inhalt nicht ändert.
- Aktuelle Versionsangaben in der Dokumentation aktualisieren; bestätigte historische Installationsstände und Testfixtures beibehalten. Die Wurzel-`package.json` beschreibt den alten Laverna-Upstream mit dessen Gulp-/Electron-Werkzeugkette. Deren Upstream-Version nicht allein wegen einer neuen NAS-Ausgabe erhöhen.
- Ist bereits ein anderer Arbeitsbranch aktiv, verursacht diese Regel allein keinen weiteren Branchwechsel oder Versionssprung. Keine Änderungen direkt auf `master` ausführen.

## Entwicklung und Prüfung

- Den vorhandenen Backbone-/Marionette-/RequireJS-Aufbau, die Bootstrap-Komponenten sowie `app/styles/core` und `app/styles/theme-default` weiterverwenden. Benutzerfunktionen in die vorhandene Navigation und das App-Layout integrieren.
- Die NAS-Werkzeuge separat installieren: `npm ci --prefix nas --ignore-scripts`. Die alte Wurzel-Werkzeugkette ist für NAS-Änderungen nicht erforderlich.
- Passende Prüfungen: `npm test --prefix nas`, `node nas/build.js --web-only`, bei Browseränderungen `node nas/tests/browser.mjs` sowie die betroffenen weiteren Browserprüfungen. Unter Windows kann `LAVERNA_BROWSER` auf die installierte Edge-EXE zeigen.
- SQLite-Daten, lokale Konfiguration, Tokens, Zertifikats-Volumes und fremde Änderungen erhalten. Generierte Dateien unter `release/` und `.tmp/` sowie lokale Zugangsdaten nicht committen.

## Commit-Workflow

Der projektspezifische Skill liegt unter [`.agents/skills/commit-publish-merge/SKILL.md`](.agents/skills/commit-publish-merge/SKILL.md). Das Anlegen oder Bearbeiten dieses Skills löst keine Veröffentlichung aus. Bei einem Auftrag für den vollständigen Workflow Commit, Push, Pull Request und Merge gemäß Skill durchführen; bestehende Autorisierung und Repository-Regeln beachten.
