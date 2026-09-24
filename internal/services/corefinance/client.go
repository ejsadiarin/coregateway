package corefinance

import (
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
)

// Client is an HTTP client for the corefinance-api microservice.
// It provides a streaming reverse proxy that avoids buffering request/response bodies.
type Client struct {
	target *url.URL
}

// New creates a new corefinance client from a base URL string (e.g. "http://corefinance-api:6969").
func New(baseURL string) *Client {
	target, err := url.Parse(baseURL)
	if err != nil {
		slog.Error("corefinance: invalid base URL", "url", baseURL, "error", err)
		panic("corefinance: invalid COREFINANCE_URL")
	}

	return &Client{target: target}
}

// Proxy returns an http.Handler that streams requests to corefinance-api.
// The request path is passed through as-is (both services use /api/budget/...).
// Identity travels exclusively as the internal JWT minted at the edge
// (Authorization: Bearer, set by EdgeIdentity); X-Request-ID is propagated
// by ForwardHeaders for correlation. X-User-ID is never set, forwarded,
// or trusted on this path.
func (c *Client) Proxy() http.Handler {
	proxy := &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.Out.URL.Host = c.target.Host
			r.Out.URL.Scheme = c.target.Scheme
			r.Out.Host = c.target.Host
		},
	}

	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		slog.Error("corefinance: proxy error",
			"method", r.Method,
			"path", r.URL.Path,
			"error", err,
		)
		http.Error(w, "downstream service unavailable", http.StatusBadGateway)
	}

	return proxy
}
