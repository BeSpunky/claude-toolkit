#!/usr/bin/env bash
# The real launcher, in a container built from a project wearing `postgres`, on the node presets, whose image has its Node:
# boot, migrate, seed, stop, under the real dev engine. Run by tools/check-runner-image/postgres-image.sh as the devcontainer's
# remote user, in a copy of the project's launcher, engine and declaration. No `set -e` and no verdicts: every fact is reported
# for the host to judge, and `probe=done` says it got to the end.
#
#   postgres-image.launcher.sh <the copy> <devcontainer.json's PATH, with its tokens>
DIR="$1"
PATH_TEMPLATE="$2"
IMAGE_PATH="$PATH"
PATH="${PATH_TEMPLATE//\$\{containerEnv:PATH\}/$IMAGE_PATH}"
export PATH DEV_OWNER=postgres-image-e2e
unset CLAUDECODE CI
cd "$DIR" || exit 1

OFFSET=100 # inside this container's own network, which nothing else shares
PORT=$((5432 + OFFSET))
KEY="postgres@$OFFSET"
sql() { psql -X -At -h 127.0.0.1 -p "$PORT" -U postgres -d app -c "$1" 2>&1; }

echo "launcher.node=$(node --version 2>&1)"
git init -q . 2>&1
mkdir -p postgres/migrations postgres/seed/world
printf -- '-- migrate:up\nCREATE TABLE thing (id int PRIMARY KEY, name text);\n\n-- migrate:down\n' > postgres/migrations/20260101000000_thing.sql
printf "INSERT INTO thing VALUES (1, 'seeded');\n" > postgres/seed/world/01_things.sql

node tools/postgres/postgres.mjs start --port-offset="$OFFSET" > start.log 2>&1 &
START=$!
READY=no
for _ in $(seq 1 240); do
  [ -f ".bespunky/run/$KEY/postgres.ready" ] && { READY=yes; break; }
  kill -0 "$START" 2> /dev/null || break
  sleep 0.5
done
echo "launcher.ready=$READY"
echo "launcher.row=$(sql 'SELECT name FROM thing')"
echo "launcher.wal=$(sql 'SHOW wal_level')"
printf -- '-- migrate:up\nALTER TABLE thing ADD COLUMN extra text;\n\n-- migrate:down\n' > postgres/migrations/20260102000000_more.sql
node tools/postgres/postgres.mjs migrate > migrate.log 2>&1
echo "launcher.migrate.rc=$?"
echo "launcher.column=$(sql "SELECT count(*) FROM information_schema.columns WHERE table_name = 'thing' AND column_name = 'extra'")"
tools/dev/dev stop postgres --offset="$OFFSET" > stop.log 2>&1
echo "launcher.stop.rc=$?"
wait "$START"
echo "launcher.exit.rc=$?"
[ "$READY" = yes ] || sed 's/^/  start: /' start.log | tail -n 20
echo "probe=done"
