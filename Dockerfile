FROM golang:1.23-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY cmd ./cmd

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /out/footter-proxy-match \
    ./cmd/footter_proxy_match

FROM alpine:3.20

WORKDIR /app
COPY --from=build /out/footter-proxy-match /usr/local/bin/footter-proxy-match

RUN mkdir -p /var/lib/footter-proxy-match/certs

EXPOSE 80 443 8080

ENTRYPOINT ["/usr/local/bin/footter-proxy-match"]
