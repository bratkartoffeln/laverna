package dynv6

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type mockTransport func(*http.Request) (*http.Response, error)

func (f mockTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestZoneLookupUsesAuthenticatedList(t *testing.T) {
	for _, input := range []string{"game.example", "game.example.", "GAME.EXAMPLE."} {
		t.Run(input, func(t *testing.T) {
			old := httpClient
			t.Cleanup(func() { httpClient = old })
			calls := 0
			httpClient = http.Client{Transport: mockTransport(func(r *http.Request) (*http.Response, error) {
				calls++
				if r.Method != http.MethodGet || r.URL.String() != "https://dynv6.com/api/v2/zones" {
					t.Fatalf("unexpected API request: %s %s", r.Method, r.URL)
				}
				if r.Header.Get("Authorization") != "Bearer unit-test-only" {
					t.Fatal("missing bearer authentication")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`[{"id":17,"name":"unrelated.example"},{"id":42,"name":"game.example"}]`)), Request: r}, nil
			})}
			provider := Provider{Token: "unit-test-only"}
			got, err := provider.getZoneByName(context.Background(), input)
			if err != nil || got == nil || got.ID != 42 || calls != 1 {
				t.Fatalf("wrong lookup result: zone=%v error=%v calls=%d", got, err, calls)
			}
		})
	}
}

func TestZoneLookupRejectsMissingZoneBadIDAndAPIFailure(t *testing.T) {
	for _, tc := range []struct{ name, body string; status int }{
		{"missing", `[{"id":17,"name":"unrelated.example"}]`, 200},
		{"invalid-id", `[{"id":0,"name":"game.example"}]`, 200},
		{"api-denied", `{"message":"denied"}`, 403},
		{"invalid-json", `invalid`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			old := httpClient
			t.Cleanup(func() { httpClient = old })
			httpClient = http.Client{Transport: mockTransport(func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.status, Status: http.StatusText(tc.status), Body: io.NopCloser(strings.NewReader(tc.body)), Request: r}, nil
			})}
			provider := Provider{Token: "unit-test-only"}
			if got, err := provider.getZoneByName(context.Background(), "game.example."); err == nil || got != nil {
				t.Fatalf("expected error, got zone=%v error=%v", got, err)
			}
		})
	}
}
