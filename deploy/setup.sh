#!/usr/bin/env bash
# ZenFocus production setup / update for the shared aaPanel server.
# Safe to re-run. Only ADDS things that belong to ZenFocus:
#   - Postgres role + database "zenfocus" (nothing else is touched)
#   - PM2 process "zenfocus-api"
#   - Nginx vhost /www/server/panel/vhost/nginx/zenfocus.datagris.com.conf (then `nginx -t` + reload)
# It never restarts Nginx/Postgres and never edits other sites or firewall rules.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="zenfocus.datagris.com"
PORT=5090
API_DIR="$APP_DIR/apps/api"
ENV_FILE="$API_DIR/.env"
VHOST="/www/server/panel/vhost/nginx/$DOMAIN.conf"
NGINX="/www/server/nginx/sbin/nginx"

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

# ---------- 1. Environment file (secrets generated here, never typed) ----------
if [ ! -f "$ENV_FILE" ]; then
  log "Creating $ENV_FILE"
  DB_PASS="$(openssl rand -hex 24)"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
APP_ORIGIN=https://$DOMAIN
DATABASE_URL=postgres://zenfocus:$DB_PASS@127.0.0.1:5432/zenfocus
UPLOAD_DIR=$API_DIR/uploads
IMAGE_SECRET=$(openssl rand -hex 32)
ACCEL_REDIRECT_PREFIX=/_zf_uploads/
ADMIN_USERNAMES=
# Paste these from Google Cloud Console, then: pm2 reload zenfocus-api --update-env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
EOF
  chmod 600 "$ENV_FILE"
fi
DB_PASS="$(grep '^DATABASE_URL=' "$ENV_FILE" | sed -E 's#.*zenfocus:([^@]+)@.*#\1#')"

# ---------- 2. Database ----------
log "Postgres role and database"
psql_admin() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "$1"; }
if [ "$(psql_admin "select 1 from pg_roles where rolname='zenfocus'")" != "1" ]; then
  psql_admin "create role zenfocus login password '$DB_PASS'"
else
  psql_admin "alter role zenfocus password '$DB_PASS'"
fi
if [ "$(psql_admin "select 1 from pg_database where datname='zenfocus'")" != "1" ]; then
  psql_admin "create database zenfocus owner zenfocus"
  psql_admin "revoke connect on database zenfocus from public"
fi

# ---------- 3. Build ----------
log "Installing and building"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
mkdir -p "$API_DIR/uploads"

# ---------- 4. API process ----------
log "PM2 process zenfocus-api"
if pm2 describe zenfocus-api >/dev/null 2>&1; then
  pm2 reload zenfocus-api --update-env
else
  pm2 start "$API_DIR/dist/index.js" --name zenfocus-api --cwd "$API_DIR" \
    --node-args="--env-file=$ENV_FILE" --max-memory-restart 400M
fi
pm2 save
for i in $(seq 1 20); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/api/health" && echo

# ---------- 5. Origin certificate (Cloudflare "Full" mode accepts self-signed) ----------
SSL_DIR="$APP_DIR/deploy/ssl"
if [ ! -f "$SSL_DIR/server.crt" ]; then
  log "Self-signed origin certificate"
  mkdir -p "$SSL_DIR"
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 -subj "/CN=$DOMAIN" \
    -keyout "$SSL_DIR/server.key" -out "$SSL_DIR/server.crt" >/dev/null 2>&1
  chmod 600 "$SSL_DIR/server.key"
fi

# ---------- 6. Nginx vhost ----------
log "Nginx vhost $VHOST"
NEW_VHOST="$(mktemp)"
sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__DOMAIN__#$DOMAIN#g" -e "s#__PORT__#$PORT#g" \
  "$APP_DIR/deploy/nginx.conf" > "$NEW_VHOST"
if [ -f "$VHOST" ] && cmp -s "$NEW_VHOST" "$VHOST"; then
  echo "vhost unchanged"
else
  [ -f "$VHOST" ] && cp "$VHOST" "$VHOST.bak.$(date +%s)"
  cp "$NEW_VHOST" "$VHOST"
  if "$NGINX" -t; then
    "$NGINX" -s reload
    echo "nginx reloaded"
  else
    echo "nginx -t failed: removing the ZenFocus vhost so other sites are unaffected" >&2
    rm -f "$VHOST"
    exit 1
  fi
fi
rm -f "$NEW_VHOST"

log "Done: https://$DOMAIN"
