# Local dynv6 zone lookup repair

Source: github.com/libdns/dynv6 v1.1.1, downloaded from the Go module proxy.
Upstream license is included unchanged in LICENSE. The production sources,
go.mod and go.sum are retained; upstream live API tests are not included.

Change: getZoneByName uses GET /api/v2/zones and selects the exact DNS name
(case-insensitive, optional final dot), rather than calling /zones/by-name/.
It rejects a missing zone and nonpositive numeric IDs. Existing numeric-ID
record operations and the token authentication mechanism are unchanged.

Reason: on QNAS1 the same token lists flusensieb.dns.navy successfully while
the exact by-name request returns HTTP 404. No new token is required.

zone_lookup_test.go tests the request path/authentication, matching among
other zones, DNS name normalization, missing zones, bad IDs, HTTP errors
and malformed responses without live credentials or DNS writes.

The Docker build tests this module, then xcaddy replaces only this dependency.
RPS continues to use its existing image, configuration and certificate storage.
