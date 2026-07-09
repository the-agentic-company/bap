#!/usr/bin/env bash
set -u

cleanup() {
  if [ -n "${opencode_pid:-}" ]; then
    kill "${opencode_pid}" 2>/dev/null || true
    wait "${opencode_pid}" 2>/dev/null || true
  fi
  rm -f /tmp/opencode-warmup.log
}

cleanup_and_exit() {
  cleanup
  exit 0
}

trap cleanup EXIT
trap cleanup_and_exit INT TERM

cd /app || exit 0
export OPENCODE_CONFIG=/app/opencode.json
export OPENCODE_ENABLE_EXPERIMENTAL_MODELS=true

opencode models openai --refresh >/tmp/opencode-model-refresh.log 2>&1 || true

opencode serve --port 4096 --hostname 127.0.0.1 >/tmp/opencode-warmup.log 2>&1 &
opencode_pid=$!

ready=0
for _ in $(seq 1 120); do
  if curl -fsS http://127.0.0.1:4096/health >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.5
done

if [ "${ready}" != "1" ]; then
  echo "[daytona] OpenCode prewarm skipped: health check did not become ready"
  exit 0
fi

if ! curl -fsS --max-time 30 "http://127.0.0.1:4096/mcp?directory=%2Fapp" >/dev/null; then
  echo "[daytona] OpenCode prewarm skipped: MCP initialization did not complete"
fi
