```powershell
$env:GOOS="linux"
$env:GOARCH="amd64"
$env:CGO_ENABLED="0"
go build -o .\dist\footter_proxy_match_linux_amd64 .\cmd\footter_proxy_match

scp .\dist\footter_proxy_match_linux_amd64 root@91.105.196.41:/tmp/footter-proxy-match

ssh root@91.105.196.41 "install -m 755 /tmp/footter-proxy-match /usr/local/bin/footter-proxy-match && mkdir -p /var/lib/footter-proxy-match/certs && printf '[Unit]\nDescription=Footter proxy match\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nEnvironment=ACME_DOMAIN=getsky.tech\nEnvironment=ACME_CACHE_DIR=/var/lib/footter-proxy-match/certs\nExecStart=/usr/local/bin/footter-proxy-match\nRestart=always\nRestartSec=3\n\n[Install]\nWantedBy=multi-user.target\n' > /etc/systemd/system/footter-proxy-match.service && systemctl daemon-reload && systemctl enable footter-proxy-match && systemctl restart footter-proxy-match && systemctl status footter-proxy-match --no-pager"
```
