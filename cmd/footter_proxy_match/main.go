package main

import (
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"golang.org/x/crypto/acme/autocert"
)

const (
	defaultListenAddr = ":8080"
	defaultTLSAddr    = ":443"
	defaultHTTPAddr   = ":80"
	defaultCacheDir   = "certs"
	maxBodySize       = 8 << 20
)

var httpClient = &http.Client{
	Timeout: 20 * time.Second,
}

func main() {
	domain := strings.TrimSpace(os.Getenv("ACME_DOMAIN"))
	if domain != "" {
		runTLSServer(domain)
		return
	}

	listenAddr := os.Getenv("LISTEN_ADDR")
	if listenAddr == "" {
		listenAddr = defaultListenAddr
	}

	server := &http.Server{
		Addr:              listenAddr,
		Handler:           newServeMux(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Printf("footter proxy listening on http://%s", listenAddr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func runTLSServer(domain string) {
	tlsAddr := os.Getenv("TLS_ADDR")
	if tlsAddr == "" {
		tlsAddr = defaultTLSAddr
	}

	httpAddr := os.Getenv("HTTP_ADDR")
	if httpAddr == "" {
		httpAddr = defaultHTTPAddr
	}

	cacheDir := os.Getenv("ACME_CACHE_DIR")
	if cacheDir == "" {
		cacheDir = defaultCacheDir
	}

	mux := newServeMux()
	certManager := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		Cache:      autocert.DirCache(cacheDir),
		HostPolicy: autocert.HostWhitelist(domain),
	}

	go func() {
		log.Printf("footter proxy ACME challenge server listening on http://%s", httpAddr)
		if err := http.ListenAndServe(httpAddr, certManager.HTTPHandler(healthOrRedirect(mux))); err != nil {
			log.Fatal(err)
		}
	}()

	server := &http.Server{
		Addr:              tlsAddr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		TLSConfig: &tls.Config{
			MinVersion:     tls.VersionTLS12,
			GetCertificate: certManager.GetCertificate,
		},
	}

	log.Printf("footter proxy listening on https://%s", domain)
	if err := server.ListenAndServeTLS("", ""); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func newServeMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/footter_proxy_match", handleProxy)
	mux.HandleFunc("/healthz", handleHealthz)
	return mux
}

func redirectToHTTPS() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		target := "https://" + r.Host + r.URL.RequestURI()
		http.Redirect(w, r, target, http.StatusMovedPermanently)
	})
}

func healthOrRedirect(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			mux.ServeHTTP(w, r)
			return
		}
		redirectToHTTPS().ServeHTTP(w, r)
	})
}

func handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeCORSHeaders(w)
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func handleProxy(w http.ResponseWriter, r *http.Request) {
	writeCORSHeaders(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	target, err := parseTargetURL(r.URL.Query().Get("url"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		http.Error(w, "failed to create upstream request", http.StatusInternalServerError)
		return
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; FootterProxyMatch/1.0; +https://getsky.tech)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "ru,en;q=0.8")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("Pragma", "no-cache")

	resp, err := httpClient.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("upstream request failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, fmt.Sprintf("upstream returned status %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	bodyReader := io.LimitReader(resp.Body, maxBodySize+1)
	body, err := io.ReadAll(bodyReader)
	if err != nil {
		http.Error(w, "failed to read upstream body", http.StatusBadGateway)
		return
	}

	if int64(len(body)) > maxBodySize {
		http.Error(w, "upstream body too large", http.StatusBadGateway)
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "text/html; charset=utf-8"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "public, max-age=60")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func writeCORSHeaders(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Vary", "Origin")
}

func parseTargetURL(raw string) (*url.URL, error) {
	if raw == "" {
		return nil, errors.New("missing url query parameter")
	}

	target, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("invalid target url")
	}

	if target.Scheme != "https" {
		return nil, errors.New("only https targets are allowed")
	}

	host := strings.ToLower(target.Hostname())
	if host != "footter.com" && host != "www.footter.com" {
		return nil, errors.New("target host is not allowed")
	}

	path := strings.TrimSuffix(target.EscapedPath(), "/")
	if !strings.HasPrefix(path, "/match/") && !strings.HasPrefix(path, "/match_log/") {
		return nil, errors.New("target path is not allowed")
	}

	target.Fragment = ""
	return target, nil
}
