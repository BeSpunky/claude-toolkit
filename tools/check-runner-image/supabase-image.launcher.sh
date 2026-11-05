#!/usr/bin/env bash
# The real launcher, in a container built from a project wearing `supabase`, on the node presets, whose image has its Node: the real
# stack on the native runtime, boot, migrate, seed, stop, under the real dev engine. Run by tools/check-runner-image/supabase-image.sh
# as the devcontainer's remote user, in a copy of the project's launcher, engine, config and seeds. No `set -e` and no verdicts: every
# fact is reported for the host to judge, and `probe=done` says it got to the end.
#
#   supabase-image.launcher.sh <the copy> <devcontainer.json's PATH, with its tokens>
DIR="$1"
PATH_TEMPLATE="$2"
IMAGE_PATH="$PATH"
PATH="${PATH_TEMPLATE//\$\{containerEnv:PATH\}/$IMAGE_PATH}"
export PATH DEV_OWNER=supabase-image-e2e PGPASSWORD=postgres
unset CLAUDECODE CI
cd "$DIR" || exit 1

OFFSET=28000 # above what the native runtime keeps for itself; inside this container's own network, which nothing else shares
PORT=$((5432 + OFFSET))
KEY="postgres@$OFFSET"
# No step here may hang past what the job can say about it: every failure below prints why.
report() { [ -f "$2" ] && sed "s/^/  $1: /" "$2" | tail -n 30; }
sql() { timeout 60 psql -X -At -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -c "$1" 2>&1; }

echo "launcher.node=$(node --version 2>&1)"
mkdir -p supabase/migrations postgres/seed/world
printf -- '-- migrate:up\nCREATE TABLE public.thing (id int PRIMARY KEY, name text);\n\n-- migrate:down\n' > supabase/migrations/20260101000000_thing.sql
printf "INSERT INTO public.thing VALUES (1, 'seeded');\n" > postgres/seed/world/01_things.sql
printf '.bespunky/run\n' > .gitignore
git init -q -b work . 2>&1
git add -A > /dev/null 2>&1
git -c user.email=probe@localhost -c user.name=probe commit -qm probe 2>&1

node tools/postgres/postgres.mjs start --port-offset="$OFFSET" > start.log 2>&1 &
START=$!
READY=no
# A first start downloads the stack's artifacts: the same bound the layer's own declaration gives it.
for _ in $(seq 1 1200); do
  [ -f ".bespunky/run/$KEY/postgres.ready" ] && { READY=yes; break; }
  kill -0 "$START" 2> /dev/null || break
  sleep 0.5
done
echo "launcher.ready=$READY"
echo "launcher.major=$(sql 'SHOW server_version_num' | cut -c1-2)"
echo "launcher.row=$(sql 'SELECT name FROM public.thing')"
echo "launcher.ledger=$(sql 'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version LIMIT 1')"
printf -- '-- migrate:up\nALTER TABLE public.thing ADD COLUMN extra text;\n\n-- migrate:down\n' > supabase/migrations/20260102000000_more.sql
timeout 300 node tools/postgres/postgres.mjs migrate > migrate.log 2>&1
rc=$?
echo "launcher.migrate.rc=$rc"
[ "$rc" -eq 0 ] || report migrate migrate.log
echo "launcher.column=$(sql "SELECT count(*) FROM information_schema.columns WHERE table_name = 'thing' AND column_name = 'extra'")"
timeout 300 node tools/postgres/postgres.mjs gen-types > types.log 2>&1
if grep -q 'export type Database' supabase/types/database.ts 2> /dev/null && grep -q thing supabase/types/database.ts; then echo "launcher.types=1"; else echo "launcher.types=0"; report types types.log; fi
timeout 300 node tools/postgres/postgres.mjs new-function --name=hello > function.log 2>&1
timeout 60 supabase status --output-format json --agent no > status.json 2> /dev/null
echo "launcher.function=$(API="$((5435 + OFFSET))" node -e '
  const key = JSON.parse(require("fs").readFileSync("status.json", "utf8")).env.PUBLISHABLE_KEY;
  fetch(`http://127.0.0.1:${process.env.API}/functions/v1/hello`, { method: "POST", headers: { Authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" }, body: JSON.stringify({ name: "Image" }), signal: AbortSignal.timeout(120000) })
    .then(async (response) => console.log(response.status, JSON.parse(await response.text()).message))
    .catch((error) => console.log(0, String(error)));
' 2>&1)"
sed 's/^/  function: /' function.log | tail -n 3
timeout 300 tools/dev/dev stop postgres --offset="$OFFSET" > stop.log 2>&1
echo "launcher.stop.rc=$?"
( sleep 120; kill "$START" 2> /dev/null ) & BOUND=$!
wait "$START"
echo "launcher.exit.rc=$?"
(exec 3<> "/dev/tcp/127.0.0.1/$PORT") 2> /dev/null && echo "launcher.port=open" || echo "launcher.port=closed"
# By its state, since an exited daemon stays a zombie where PID 1 reaps nothing.
echo "launcher.left=$(ps -eo stat=,args= | awk '$1 !~ /^Z/ && $3 ~ /^__supabase_stack_/' | head -n 1 | cut -c1-120)"
kill "$BOUND" 2> /dev/null
if [ "$READY" != yes ]; then
  report start start.log
  # The stack's own logs die with this container (--rm).
  find "$SUPABASE_HOME/stacks" -name '*.log' -type f 2> /dev/null | head -n 12 | while read -r file; do report "$(basename "$file")" "$file"; done
fi
sed 's/^/  stop: /' stop.log | tail -n 5
echo "probe=done"
