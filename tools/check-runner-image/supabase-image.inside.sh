#!/usr/bin/env bash
# The inside of a container built from a project wearing `supabase`, run by tools/check-runner-image/supabase-image.sh as the
# devcontainer's remote user. No `set -e` and no verdicts: every fact is reported for the host to judge, `probe=done` says it got to
# the end. It boots nothing: supabase-image.launcher.sh does, where the image has a Node.
#
#   supabase-image.inside.sh <devcontainer.json's PATH, with its tokens>
PATH_TEMPLATE="$1"
IMAGE_PATH="$PATH"
PATH="${PATH_TEMPLATE//\$\{containerEnv:PATH\}/$IMAGE_PATH}"
export PATH

echo "uid=$(id -u)"
echo "home=$HOME"
echo "codename=$(sed -n 's/^VERSION_CODENAME=//p' /etc/os-release)"
echo "arch=$(dpkg --print-architecture)"
for tool in supabase postgres dbmate psql ps tar; do
  echo "path.$tool=$(command -v "$tool")"
done
echo "version.supabase=$(supabase --version 2>&1 | head -n 1)"
echo "server.anywhere=$(ls /usr/lib/postgresql/*/bin/postgres 2>/dev/null | head -n 1)"
echo "supabase.home=$SUPABASE_HOME"
mkdir -p "$SUPABASE_HOME" 2>/dev/null && [ -w "$SUPABASE_HOME" ] && echo "supabase.home.writable=yes" || echo "supabase.home.writable=no"
echo "probe=done"
