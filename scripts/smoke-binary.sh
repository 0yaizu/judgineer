#!/usr/bin/env bash
# ビルドした単体バイナリ (linux-x64) が、マイグレーションとフロント配信を含めて動くか確かめる。
#   bun run build && bun scripts/build-binary.ts linux-x64 && scripts/smoke-binary.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/dist-bin/judgineer-linux-x64"
export JUDGINEER_HOME="$(mktemp -d)"
export JUDGINEER_NO_OPEN=1
export PORT="${PORT:-3999}"
trap '"$BIN" stop >/dev/null 2>&1 || true; rm -rf "$JUDGINEER_HOME"' EXIT

fail() { echo "NG: $*" >&2; exit 1; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

"$BIN" help | grep -q start || fail "help"
"$BIN" load "$ROOT/samples/a_company_api" >/dev/null || fail "load (マイグレーションか起動に失敗。$JUDGINEER_HOME/run/server.log)"
[ "$(status "localhost:$PORT/")" = 200 ] || fail "GUI (/) が返らない"
[ "$(status "localhost:$PORT/p/deep-link")" = 200 ] || fail "SPA の深いパスが返らない"
curl -s "localhost:$PORT/api/targets" | grep -q a_company_api || fail "/api/targets に読み込んだフォルダがない"
"$BIN" stop | grep -q 止めました || fail "stop"
echo "OK"
