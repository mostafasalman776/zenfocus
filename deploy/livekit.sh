#!/usr/bin/env bash
# Voice for ZenFocus: LiveKit SFU in Docker + Nginx vhost for rtc.zenfocus.datagris.com.
# Safe to re-run. Only adds ZenFocus things (container "zenfocus-livekit", one vhost,
# one certificate) and never touches the firewall: open these in aaPanel → Security:
#   7881/tcp, 7882/udp, 3478/udp
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RTC_DOMAIN="rtc.zenfocus.datagris.com"
ENV_FILE="$APP_DIR/apps/api/.env"
CONF="$APP_DIR/deploy/livekit.yaml"
SSL_DIR="$APP_DIR/deploy/ssl"
WEBROOT="$APP_DIR/deploy/acme-webroot"
VHOST="/www/server/panel/vhost/nginx/$RTC_DOMAIN.conf"
NGINX="/www/server/nginx/sbin/nginx"
ACME="/root/.acme.sh/acme.sh"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

write_vhost() {
  [ -f "$VHOST" ] && cp "$VHOST" "$VHOST.bak.$(date +%s)"
  cat > "$VHOST"
  if "$NGINX" -t; then "$NGINX" -s reload; else
    echo "nginx -t failed: removing $VHOST so other sites are unaffected" >&2
    rm -f "$VHOST"; exit 1
  fi
}

# ---------- 1. API keys (generated here) ----------
if ! grep -q '^LIVEKIT_API_KEY=.\+' "$ENV_FILE"; then
  log "Generating LiveKit keys"
  KEY="ZF$(openssl rand -hex 8)"
  SECRET="$(openssl rand -hex 32)"
  sed -i '/^LIVEKIT_/d' "$ENV_FILE"
  printf 'LIVEKIT_URL=wss://%s\nLIVEKIT_API_KEY=%s\nLIVEKIT_API_SECRET=%s\n' "$RTC_DOMAIN" "$KEY" "$SECRET" >> "$ENV_FILE"
fi
KEY="$(grep '^LIVEKIT_API_KEY=' "$ENV_FILE" | cut -d= -f2)"
SECRET="$(grep '^LIVEKIT_API_SECRET=' "$ENV_FILE" | cut -d= -f2)"

# ---------- 2. LiveKit config + container ----------
log "LiveKit config"
cat > "$CONF" <<EOF
port: 7880
bind_addresses: ["127.0.0.1"]
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
turn:
  enabled: true
  udp_port: 3478
  domain: $RTC_DOMAIN
keys:
  $KEY: $SECRET
room:
  max_participants: 20
  empty_timeout: 300
logging:
  level: info
EOF
chmod 600 "$CONF"

log "LiveKit container"
docker rm -f zenfocus-livekit >/dev/null 2>&1 || true
docker run -d --name zenfocus-livekit --restart unless-stopped --network host \
  --memory 512m --cpus 1 \
  -v "$CONF:/etc/livekit.yaml:ro" \
  livekit/livekit-server:latest --config /etc/livekit.yaml
for i in $(seq 1 20); do curl -fsS http://127.0.0.1:7880 >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:7880 && echo " livekit up"

# ---------- 3. Certificate (Let's Encrypt via webroot; rtc is DNS-only, not behind Cloudflare) ----------
mkdir -p "$WEBROOT" "$SSL_DIR"
if [ ! -f "$SSL_DIR/rtc.crt" ]; then
  log "HTTP vhost for the ACME challenge"
  write_vhost <<EOF
server {
    listen 80;
    server_name $RTC_DOMAIN;
    location /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 404; }
}
EOF
  log "Issuing certificate"
  "$ACME" --issue --server letsencrypt -d "$RTC_DOMAIN" -w "$WEBROOT" || [ $? -eq 2 ]
  "$ACME" --install-cert -d "$RTC_DOMAIN" \
    --key-file "$SSL_DIR/rtc.key" --fullchain-file "$SSL_DIR/rtc.crt" \
    --reloadcmd "$NGINX -s reload"
fi

# ---------- 4. HTTPS vhost proxying LiveKit signalling ----------
log "HTTPS vhost $VHOST"
write_vhost <<EOF
server {
    listen 80;
    server_name $RTC_DOMAIN;
    location /.well-known/acme-challenge/ { root $WEBROOT; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name $RTC_DOMAIN;
    ssl_certificate $SSL_DIR/rtc.crt;
    ssl_certificate_key $SSL_DIR/rtc.key;
    access_log /www/wwwlogs/$RTC_DOMAIN.log;
    error_log /www/wwwlogs/$RTC_DOMAIN.error.log;
    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

# ---------- 5. Let the API hand out voice tokens ----------
log "Reloading API"
pm2 reload zenfocus-api --update-env
log "Voice ready at wss://$RTC_DOMAIN (after the firewall ports are open)"
