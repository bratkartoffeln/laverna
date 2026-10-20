#!/bin/sh
set -eu
laverna_base=/share/Container/laverna
laverna_state="$laverna_base/.laverna-updater"
laverna_runtime="$laverna_state/runtime"
laverna_source=$(CDPATH= cd -- "$(dirname -- "$0")/../updater" && pwd)
if ! command -v docker >/dev/null 2>&1; then
    laverna_station=$(/sbin/getcfg container-station Install_Path -f /etc/config/qpkg.conf)
    PATH="$laverna_station/bin:$PATH"
    export PATH
fi
mkdir -p "$laverna_runtime"
chmod 700 "$laverna_state"
for laverna_file in core.mjs main.mjs Dockerfile compose.updater.yaml; do
    cp "$laverna_source/$laverna_file" "$laverna_runtime/$laverna_file"
done
docker build -t laverna-updater:2.0.2 "$laverna_runtime"
docker compose -p laverna-updater -f "$laverna_runtime/compose.updater.yaml" up -d --wait --wait-timeout 240
