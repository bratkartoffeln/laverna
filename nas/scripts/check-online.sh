#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
    printf '%s\n' 'Aufruf: sh scripts/check-online.sh https://flusensieb.dns.navy:10443' >&2
    exit 2
fi
laverna_base=${1%/}
case "$laverna_base" in
    https://*|http://*) ;;
    *) printf '%s\n' 'Die Adresse muss mit http:// oder https:// beginnen.' >&2; exit 2 ;;
esac

laverna_workdir=$(mktemp -d /tmp/laverna-online.XXXXXX)
cleanup() {
    case "$laverna_workdir" in
        /tmp/laverna-online.*) rm -rf -- "$laverna_workdir" ;;
    esac
}
trap cleanup 0
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

if command -v curl >/dev/null 2>&1; then
    laverna_downloader=curl
elif command -v wget >/dev/null 2>&1; then
    laverna_downloader=wget
else
    printf '%s\n' 'Fuer die Onlinepruefung wird curl oder wget benoetigt.' >&2
    exit 2
fi

fetch() {
    laverna_relative=$1
    laverna_destination=$2
    printf 'Pruefe %s\n' "$laverna_relative"
    if [ "$laverna_downloader" = curl ]; then
        curl --fail --silent --show-error --max-time 20 --output "$laverna_destination" "$laverna_base/$laverna_relative"
    else
        wget -q -T 20 -O "$laverna_destination" "$laverna_base/$laverna_relative"
    fi
    if [ ! -s "$laverna_destination" ]; then
        printf 'Leere Antwort: %s\n' "$laverna_relative" >&2
        exit 1
    fi
}

fetch account "$laverna_workdir/index"
grep -q 'Laverna' "$laverna_workdir/index"
fetch ready.json "$laverna_workdir/ready"
grep -q '"application"[[:space:]]*:[[:space:]]*"Laverna"' "$laverna_workdir/ready"
grep -q '"version"[[:space:]]*:[[:space:]]*"__LAVERNA_VERSION__"' "$laverna_workdir/ready"
grep -q '"nasPackage"[[:space:]]*:[[:space:]]*"__NAS_VERSION__"' "$laverna_workdir/ready"

for laverna_asset in \
    scripts/main.js \
    bower_components/requirejs/require.js \
    bower_components/modernizr/modernizr.js \
    bower_components/dropbox/dropbox.js \
    scripts/workers/localForage.js \
    scripts/modules/markdown/workers/markdown.js \
    styles/core.css \
    styles/theme-default.css \
    styles/core/fontello/font/fontello.woff
do
    fetch "$laverna_asset" "$laverna_workdir/asset"
    if grep -q '<!DOCTYPE html>' "$laverna_workdir/asset"; then
        printf 'HTML statt Asset: %s\n' "$laverna_asset" >&2
        exit 1
    fi
done

printf 'Onlinepruefung bestanden: Laverna __LAVERNA_VERSION__, NAS-Paket __NAS_VERSION__ unter %s\n' "$laverna_base"
