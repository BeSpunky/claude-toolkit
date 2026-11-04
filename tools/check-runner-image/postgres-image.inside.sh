#!/usr/bin/env bash
# The inside of a container built from a project wearing `postgres`, run by tools/check-runner-image/postgres-image.sh as the
# devcontainer's remote user. No `set -e` and no verdicts: every fact is reported for the host to judge, `probe=done` says it
# got to the end. Nothing here is the launcher's: its Node may be a devcontainer feature, which `docker build` does not apply.
# What it asks is whether the image's own tools work, with the launcher's own initdb flags.
#
#   postgres-image.inside.sh <devcontainer.json's PATH, with its tokens>
PATH_TEMPLATE="$1"
IMAGE_PATH="$PATH"
PATH="${PATH_TEMPLATE//\$\{containerEnv:PATH\}/$IMAGE_PATH}"
export PATH

echo "uid=$(id -u)"
echo "home=$HOME"
echo "codename=$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release)"
echo "arch=$(dpkg --print-architecture)"
for tool in postgres psql initdb pg_ctl pg_dump dbmate; do
  echo "path.$tool=$(command -v "$tool")"
done
echo "wrapper.postgres=$(sed -n 2p "$(command -v postgres)" 2>/dev/null)"
echo "version.postgres=$(postgres --version 2>&1 | head -n 1)"
echo "version.psql=$(psql --version 2>&1 | head -n 1)"
echo "version.dbmate=$(dbmate --version 2>&1 | head -n 1)"

DATA="$(mktemp -d)/data"
PORT=55432 # inside this container's own network, which nothing else shares
SOCKETS="$(dirname "$DATA")"
sql() { psql -X -At -h 127.0.0.1 -p "$PORT" -U postgres -d "${2:-postgres}" -c "$1" 2>&1; }

initdb -D "$DATA" -U postgres -A trust -E UTF8 --locale=C.UTF-8 --no-instructions > "$SOCKETS/initdb.log" 2>&1
INIT_RC=$?
echo "initdb.rc=$INIT_RC"
[ "$INIT_RC" -eq 0 ] || sed 's/^/  initdb: /' "$SOCKETS/initdb.log"

pg_ctl -D "$DATA" -w -t 60 -l "$SOCKETS/server.log" -o "-p $PORT -k $SOCKETS -c listen_addresses=127.0.0.1" start > /dev/null 2>&1
echo "boot.rc=$?"
sed 's/^/  server: /' "$SOCKETS/server.log" 2>/dev/null | tail -n 5
echo "server.version=$(sql 'SHOW server_version')"
echo "server.vector=$(sql 'CREATE EXTENSION vector; SELECT extversion FROM pg_extension WHERE extname = $$vector$$' | tail -n 1)"

MIGRATIONS="$SOCKETS/migrations"
mkdir -p "$MIGRATIONS"
printf -- '-- migrate:up\nCREATE TABLE thing (id int PRIMARY KEY);\nINSERT INTO thing VALUES (1);\n\n-- migrate:down\n' > "$MIGRATIONS/20260101000000_thing.sql"
(cd "$SOCKETS" && dbmate --url "postgresql://postgres@127.0.0.1:$PORT/app?sslmode=disable" -d "$MIGRATIONS" --no-dump-schema up) > "$SOCKETS/dbmate.log" 2>&1
MIGRATE_RC=$?
echo "dbmate.rc=$MIGRATE_RC"
[ "$MIGRATE_RC" -eq 0 ] || sed 's/^/  dbmate: /' "$SOCKETS/dbmate.log"
echo "dbmate.row=$(sql 'SELECT count(*) FROM thing' app)"

pg_ctl -D "$DATA" -w -t 30 -m fast stop > /dev/null 2>&1
echo "stop.rc=$?"
[ -e "$DATA/postmaster.pid" ] && echo "stop.pidfile=left" || echo "stop.pidfile=gone"
echo "probe=done"
