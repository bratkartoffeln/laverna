#!/bin/sh
set -eu

laverna_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
laverna_project_dir=$(CDPATH= cd -- "$laverna_script_dir/.." && pwd)
cd "$laverna_project_dir"

laverna_docker() {
    if ! command -v docker >/dev/null 2>&1 && [ -x /sbin/getcfg ]; then
        laverna_station_dir=$(/sbin/getcfg container-station Install_Path -f /etc/config/qpkg.conf)
        if [ -n "$laverna_station_dir" ] && [ -x "$laverna_station_dir/bin/docker" ]; then
            PATH="$laverna_station_dir/bin:$PATH"
            export PATH
        fi
    fi
    docker "$@"
}

laverna_compose() {
    if [ -f "$laverna_project_dir/../.laverna-updater/active-image.json" ]; then
        laverna_docker compose -p laverna -f compose.yaml -f compose.dns.yaml -f ../.laverna-updater/active-image.json --profile https "$@"
    else
        laverna_docker compose -p laverna -f compose.yaml -f compose.dns.yaml --profile https "$@"
    fi
}

case "${1:-help}" in
    lan)
        laverna_docker compose -p laverna -f compose.yaml config --quiet
        laverna_docker compose -p laverna -f compose.yaml up -d --wait --wait-timeout 120
        laverna_docker compose -p laverna -f compose.yaml ps
        ;;
    check-dns)
        laverna_compose config --quiet
        laverna_compose build caddy
        laverna_compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
        laverna_compose run --rm --no-deps caddy laverna-check-dns
        ;;
    start)
        mkdir -p ../data
        chmod 700 ../data
        chown 1000:1000 ../data
        laverna_compose config --quiet
        laverna_compose up -d --wait --wait-timeout 120
        laverna_compose ps
        ;;
    update)
        printf '%s\n' 'Updates werden vom laverna-updater nach erfolgreicher GitHub-Pruefung ausgerollt.'
        laverna_docker compose -p laverna-updater -f ../.laverna-updater/runtime/compose.updater.yaml logs --tail=25
        ;;
    backup)
        laverna_docker exec laverna-laverna-1 node server/admin.mjs backup
        ;;
    status)
        laverna_compose ps
        ;;
    logs)
        laverna_compose logs --no-color --tail=80
        ;;
    check)
        if [ "$#" -ne 2 ]; then
            printf '%s\n' 'Aufruf: sh scripts/qnap.sh check https://flusensieb.dns.navy:10443' >&2
            exit 2
        fi
        sh "$laverna_script_dir/check-online.sh" "$2"
        ;;
    stop-https)
        laverna_compose stop caddy
        ;;
    stop)
        laverna_compose stop
        ;;
    help|--help|-h)
        printf '%s\n' 'Laverna auf dem QNAP: sh scripts/qnap.sh BEFEHL' \
            '  lan         Nur den LAN-Webserver starten' \
            '  check-dns   Caddy bauen und DNS-01 mit ACME STAGING testen' \
            '  start       Laverna und HTTPS starten' \
            '  update      Status des automatischen Updaters anzeigen' \
            '  backup      Konsistente SQLite-Sicherung erstellen' \
            '  status      Containerstatus anzeigen' \
            '  logs        Letzte Containermeldungen anzeigen' \
            '  check URL   Bereitgestellte Webdateien und Version pruefen' \
            '  stop-https  HTTPS anhalten, LAN weiterlaufen lassen' \
            '  stop        Beide Laverna-Container anhalten'
        ;;
    *)
        printf 'Unbekannter Befehl: %s\n' "$1" >&2
        exit 2
        ;;
esac
