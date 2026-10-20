ARG LAVERNA_CADDY_SOURCE=builder
FROM caddy:2.11.7-builder-alpine AS builder

# Gleiche dynv6-Korrektur wie im bereits geprueften Slide-a-Llama-Deployment.
COPY libdns-dynv6 /build/libdns-dynv6
RUN cd /build/libdns-dynv6 && go test ./...
RUN xcaddy build v2.11.7 \
    --with github.com/caddy-dns/dynv6@v0.0.0-20251101220214-71fad600afb2 \
    --with github.com/libdns/dynv6=/build/libdns-dynv6

# Optional kann beim NAS-Erstaufbau das dort bereits gepruefte Caddy-Image
# als Binaerquelle dienen. Der Standard baut inklusive Provider-Tests selbst.
FROM ${LAVERNA_CADDY_SOURCE} AS caddy_binary

FROM caddy:2.11.7-alpine
COPY --from=caddy_binary /usr/bin/caddy /usr/bin/caddy
COPY entrypoint.sh /usr/local/bin/laverna-caddy-entrypoint
COPY check-dns.sh /usr/local/bin/laverna-check-dns
RUN chmod 755 /usr/local/bin/laverna-caddy-entrypoint /usr/local/bin/laverna-check-dns

ENTRYPOINT ["/usr/local/bin/laverna-caddy-entrypoint"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
