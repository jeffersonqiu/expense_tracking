#!/usr/bin/env bash
# Runs migrations + RLS tests on a throwaway local Postgres (16+).
set -euo pipefail
cd "$(dirname "$0")/.."
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="$(mktemp -d)"
PORT="${PGPORT_TEST:-55432}"
cleanup() { "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DATA"; }
trap cleanup EXIT
if [ "$(id -u)" = "0" ]; then RUN="runuser -u postgres --"; chown postgres "$DATA"; else RUN=""; fi
$RUN "$PGBIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp" -l "$DATA/log" start -w >/dev/null
PSQL=(psql -h /tmp -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -c "create database app"
"${PSQL[@]}" -d app -f tests/db/auth_stub.sql
for f in supabase/migrations/*.sql; do "${PSQL[@]}" -d app -f "$f"; done
"${PSQL[@]}" -d app -f tests/db/grants.sql
"${PSQL[@]}" -d app -f tests/db/rls_test.sql | tee /dev/stderr | grep -q 'DB TESTS PASSED'
