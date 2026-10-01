#!/usr/bin/env bash
# Starts local Postgres and applies schema + policies + seed.
#   pnpm db:up       -- start (no-op if already running)
#   pnpm db:reset    -- destroy and rebuild from scratch
set -euo pipefail

NAME=i3-portal-db
PORT=55432

if [[ "${1:-}" == "--reset" ]]; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  echo "starting postgres on :$PORT ..."
  docker run -d --name "$NAME" \
    -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=i3 \
    -p "$PORT:5432" postgres:16 >/dev/null

  for _ in $(seq 1 60); do
    docker exec "$NAME" pg_isready -U postgres -d i3 >/dev/null 2>&1 && break
    sleep 1
  done
else
  echo "postgres already running"
  exit 0
fi

psql_f() { docker exec -i "$NAME" psql -U postgres -d i3 -q -v ON_ERROR_STOP=1 -f "/$1"; }
for f in 00-local-auth-shim.sql schema.sql policies.sql functions.sql seed.sql; do
  docker cp "db/$f" "$NAME:/$f" >/dev/null
  echo "  applying $f"
  psql_f "$f"
done

echo "ready -> postgresql://i3_app:apppw@localhost:$PORT/i3"
