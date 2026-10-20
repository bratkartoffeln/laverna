#!/bin/sh
# Run by the dynv6 image entrypoint, which supplies DYNV6_API_TOKEN securely.
# This process never reads the production Caddyfile or the /data and /config
# volumes. Only the temporary DNS-01 TXT challenge touches the real DNS zone.
set -eu
umask 077

laverna_domain=${LAVERNA_DOMAIN:-flusensieb.dns.navy}
laverna_workdir=''
laverna_caddy_pid=''
laverna_result=''

print_test_log() {
    # Do not put the token into argv or expose it if a provider error echoes it.
    # Match literals, including their JSON-escaped representation, not regexes.
    tail -n 60 "$laverna_workdir/caddy.log" | awk '
        function redact(line, needle, position, result) {
            if (needle == "") return line
            result = ""
            while ((position = index(line, needle)) > 0) {
                result = result substr(line, 1, position - 1) "[TOKEN ENTFERNT]"
                line = substr(line, position + length(needle))
            }
            return result line
        }
        BEGIN {
            token = ENVIRON["DYNV6_API_TOKEN"]
            escaped = ""
            for (i = 1; i <= length(token); i++) {
                char = substr(token, i, 1)
                if (char == "\\" || char == "\"") escaped = escaped "\\"
                escaped = escaped char
            }
        }
        { print redact(redact($0, escaped), token) }
    '
}

cleanup() {
    laverna_exit=$?
    trap - 0
    trap '' HUP INT TERM
    if [ -n "$laverna_caddy_pid" ]; then
        # SIGTERM gives Caddy time to cancel issuance and remove its challenge.
        # The final kill also bounds cleanup if an upstream request is stuck.
        kill -TERM "$laverna_caddy_pid" 2>/dev/null || :
        laverna_stop_wait=0
        while kill -0 "$laverna_caddy_pid" 2>/dev/null && [ "$laverna_stop_wait" -lt 15 ]; do
            sleep 1
            laverna_stop_wait=$((laverna_stop_wait + 1))
        done
        if kill -0 "$laverna_caddy_pid" 2>/dev/null; then
            kill -KILL "$laverna_caddy_pid" 2>/dev/null || :
        fi
        wait "$laverna_caddy_pid" 2>/dev/null || :
        laverna_caddy_pid=''
    fi
    if [ "$laverna_exit" -ne 0 ] && [ -n "$laverna_workdir" ] && [ -f "$laverna_workdir/caddy.log" ]; then
        printf '%s\n' 'Letzte Meldungen des getrennten Staging-Tests:' >&2
        print_test_log >&2 || :
    fi
    if [ -n "$laverna_workdir" ]; then
        rm -rf "$laverna_workdir"
    fi
    if [ -n "$laverna_result" ]; then
        if [ "$laverna_exit" -eq 0 ]; then
            printf '%s\n' "$laverna_result"
        else
            printf '%s\n' "$laverna_result" >&2
        fi
    elif [ "$laverna_exit" -ne 0 ]; then
        printf '%s\n' 'Der DNS-01-Vorabtest konnte nicht abgeschlossen werden.' >&2
    fi
    exit "$laverna_exit"
}
trap cleanup 0
trap 'laverna_result="DNS-01-Vorabtest abgebrochen (SIGHUP)."; exit 129' HUP
trap 'laverna_result="DNS-01-Vorabtest abgebrochen (Strg+C)."; exit 130' INT
trap 'laverna_result="DNS-01-Vorabtest abgebrochen (SIGTERM)."; exit 143' TERM

if [ -z "${DYNV6_API_TOKEN:-}" ]; then
    laverna_result='Der dynv6-HTTP-Token fehlt. Den Test über das DNS-01-Compose-Profil mit eingerichtetem Secret starten.'
    exit 2
fi
case "$DYNV6_API_TOKEN" in
    *[[:space:]]*)
        laverna_result='Der dynv6-HTTP-Token enthält Leerzeichen oder Zeilenumbrüche. Bitte das Secret prüfen.'
        exit 2
        ;;
esac
if ! printf '%s\n' "$laverna_domain" | awk '
    {
        if (NR != 1 || length($0) > 253 || $0 !~ /^[A-Za-z0-9.-]+$/) exit 1
        count = split($0, labels, ".")
        if (count < 2) exit 1
        for (i = 1; i <= count; i++) {
            if (length(labels[i]) < 1 || length(labels[i]) > 63 ||
                labels[i] !~ /^[A-Za-z0-9]/ || labels[i] !~ /[A-Za-z0-9]$/) exit 1
        }
    }
'; then
    laverna_result='LAVERNA_DOMAIN muss ein einzelner DNS-Hostname ohne https://, Port, Pfad oder Wildcard sein.'
    exit 2
fi
laverna_domain=$(printf '%s' "$laverna_domain" | tr '[:upper:]' '[:lower:]')
if ! command -v caddy >/dev/null 2>&1; then
    laverna_result='Caddy fehlt. Bitte den DNS-01-Vorabtest im dafür gebauten Caddy-Container ausführen.'
    exit 2
fi

# An explicit /tmp template ignores an externally supplied TMPDIR. Caddy's
# storage and every XDG path are isolated even when Compose mounts /data.
laverna_workdir=$(mktemp -d /tmp/laverna-dns-check.XXXXXX)
export XDG_DATA_HOME="$laverna_workdir/xdg-data"
export XDG_CONFIG_HOME="$laverna_workdir/xdg-config"
export XDG_CACHE_HOME="$laverna_workdir/xdg-cache"
export XDG_RUNTIME_DIR="$laverna_workdir/xdg-runtime"
mkdir -p "$laverna_workdir/storage" "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_RUNTIME_DIR"

cat > "$laverna_workdir/Caddyfile" <<EOF
{
    admin off
    persist_config off
    auto_https disable_redirects
    grace_period 5s
    storage file_system "$laverna_workdir/storage"
    log {
        output stderr
        format json
        level INFO
    }
    servers {
        protocols h1 h2
    }
}

https://$laverna_domain:20443 {
    bind 127.0.0.1
    tls {
        issuer acme {
            dir https://acme-staging-v02.api.letsencrypt.org/directory
            test_dir https://acme-staging-v02.api.letsencrypt.org/directory
            timeout 4m
            disable_http_challenge
            disable_tlsalpn_challenge
            dns dynv6 {env.DYNV6_API_TOKEN}
            propagation_timeout 4m
            resolvers 1.1.1.1 8.8.8.8
        }
    }
    respond "LAVERNA DNS-01 staging check"
}
EOF

certificate_obtained() {
    # Fresh storage plus a single DNS-only staging issuer makes this a real
    # DNS-01 issuance check. A generic server-start or another domain is not OK.
    awk -v expected="$laverna_domain" '
        /"logger"[[:space:]]*:[[:space:]]*"tls.obtain"/ &&
        /"msg"[[:space:]]*:[[:space:]]*"certificate obtained successfully"/ {
            compact = $0
            gsub(/[[:space:]]/, "", compact)
            if (index(compact, "\"identifier\":\"" expected "\"")) obtained = 1
        }
        END { exit !obtained }
    ' "$laverna_workdir/caddy.log"
}

success() {
    laverna_result="DNS-01-Vorabtest für $laverna_domain erfolgreich: Let's Encrypt STAGING hat das Testzertifikat ausgestellt.
Dies ist kein im Browser vertrauenswürdiges Zertifikat und aktiviert noch kein produktives HTTPS.
Der Testprozess wurde beendet und der temporäre Zertifikatsspeicher entfernt. Bestehende produktive Zertifikate und Volumes wurden nicht verändert."
    exit 0
}

printf 'DNS-01-Vorabtest für %s mit Let\047s Encrypt STAGING.\n' "$laverna_domain"
printf '%s\n' 'Die Ausstellung wird bis zu 300 Sekunden geprüft. Es werden keine Host-Ports benötigt.'
: > "$laverna_workdir/caddy.log"
caddy run --config "$laverna_workdir/Caddyfile" --adapter caddyfile > "$laverna_workdir/caddy.log" 2>&1 &
laverna_caddy_pid=$!

# Fixed iteration count stays bounded even if the NAS wall clock changes.
laverna_waited=0
while [ "$laverna_waited" -lt 300 ]; do
    if certificate_obtained; then success; fi
    if ! kill -0 "$laverna_caddy_pid" 2>/dev/null; then
        laverna_caddy_status=0
        wait "$laverna_caddy_pid" || laverna_caddy_status=$?
        laverna_caddy_pid=''
        if certificate_obtained; then success; fi
        laverna_result="DNS-01-Vorabtest fehlgeschlagen: Caddy wurde vor der Zertifikatsausstellung beendet (Status $laverna_caddy_status). Prüfe die Meldungen, den HTTP-Token und seine TXT-Schreibrechte für die Zone."
        exit 1
    fi
    sleep 1
    laverna_waited=$((laverna_waited + 1))
done
if certificate_obtained; then success; fi
laverna_result='DNS-01-Vorabtest nach 300 Sekunden ohne bestätigte Ausstellung beendet. Das ist kein Erfolg. Prüfe Token, TXT-Schreibrechte und DNS-Erreichbarkeit anhand der Meldungen.'
exit 124
