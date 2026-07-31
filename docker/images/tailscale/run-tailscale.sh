#!/usr/bin/env bash
set -euo pipefail

/render/tailscaled \
  --state=/var/lib/tailscale/tailscaled.state \
  --tun=userspace-networking \
  --socks5-server=localhost:1055 &
pid=$!

hostname=${TAILSCALE_HOSTNAME:-${RENDER_SERVICE_NAME}}
oauth_marker=/var/lib/tailscale/oauth-registered

if [[ -n "${TAILSCALE_TAG:-}" ]]; then
  tailscale_tag=${TAILSCALE_TAG}
elif [[ "${RENDER_SERVICE_NAME}" == *-staging ]]; then
  tailscale_tag=tag:bap-staging
elif [[ "${RENDER_SERVICE_NAME}" == *-prod ]]; then
  tailscale_tag=tag:bap-prod
else
  echo "Cannot derive a Tailscale tag from service name: ${RENDER_SERVICE_NAME}" >&2
  exit 1
fi

backend_state=""
for attempt in $(seq 1 30); do
  if status_json=$(/render/tailscale status --json 2>/dev/null); then
    backend_state=$(printf '%s' "${status_json}" | jq -r '.BackendState // empty')
    if [[ -n "${backend_state}" && "${backend_state}" != "NoState" ]]; then
      break
    fi
  fi

  echo "Waiting for tailscaled (${attempt}/30)..."
  sleep 1
done

if [[ -z "${backend_state}" || "${backend_state}" == "NoState" ]]; then
  echo "tailscaled did not become ready" >&2
  exit 1
fi

if [[ "${backend_state}" == "Running" && ! -f "${oauth_marker}" ]]; then
  echo "Migrating the persisted Tailscale identity to OAuth ownership"
  /render/tailscale logout
  backend_state=NeedsLogin
fi

if [[ "${backend_state}" == "NeedsLogin" ]]; then
  oauth_secret=${TAILSCALE_OAUTH_CLIENT_SECRET:?Tailscale OAuth client secret is required for first registration}
  auth_key="${oauth_secret}?ephemeral=false&preauthorized=true"
  up_args=(
    up
    --auth-key="${auth_key}"
    --advertise-tags="${tailscale_tag}"
    --hostname="${hostname}"
  )

  if [[ -n "${ADVERTISE_ROUTES:-}" ]]; then
    up_args+=(--advertise-routes="${ADVERTISE_ROUTES}")
  fi

  connected=false
  for delay in 1 2 4 8 16 30; do
    if /render/tailscale "${up_args[@]}"; then
      connected=true
      break
    fi

    echo "Tailscale registration failed; retrying in ${delay}s" >&2
    sleep "${delay}"
  done

  if [[ "${connected}" != "true" ]]; then
    echo "Tailscale registration failed after 6 attempts" >&2
    exit 1
  fi

  touch "${oauth_marker}"
elif [[ "${backend_state}" != "Running" ]]; then
  echo "Unexpected Tailscale backend state: ${backend_state}" >&2
  exit 1
fi

export ALL_PROXY=socks5://localhost:1055/
tailscale_ip=$(/render/tailscale ip)
echo "Tailscale is up at IP ${tailscale_ip}"

if [[ -n "${TAILSCALE_SERVE_TARGET_HOST:-}" ]]; then
  target_scheme=${TAILSCALE_SERVE_TARGET_SCHEME:-http}
  target_port=${TAILSCALE_SERVE_TARGET_PORT:?tailscale serve target port is required}
  target_path=${TAILSCALE_SERVE_TARGET_PATH:-}
  serve_https_port=${TAILSCALE_SERVE_HTTPS_PORT:-443}
  target_url="${target_scheme}://${TAILSCALE_SERVE_TARGET_HOST}:${target_port}${target_path}"

  /render/tailscale serve reset >/dev/null 2>&1 || true
  /render/tailscale serve --yes --bg --https="${serve_https_port}" "${target_url}"
  /render/tailscale serve status
fi

if [[ -n "${TAILSCALE_TCP_FORWARD_TARGET_HOST:-}" ]]; then
  tcp_forwards=${TAILSCALE_TCP_FORWARD_PORTS:?tailscale tcp forward ports are required}

  /render/tailscale serve reset >/dev/null 2>&1 || true

  IFS=',' read -ra forwards <<< "${tcp_forwards}"
  for forward in "${forwards[@]}"; do
    if [[ "${forward}" != *:* ]]; then
      echo "Invalid TCP forward '${forward}', expected listen_port:target_port" >&2
      exit 1
    fi

    listen_port=${forward%%:*}
    target_port=${forward#*:}

    if [[ -z "${listen_port}" || -z "${target_port}" ]]; then
      echo "Invalid TCP forward '${forward}', expected listen_port:target_port" >&2
      exit 1
    fi

    until nc -z "${TAILSCALE_TCP_FORWARD_TARGET_HOST}" "${target_port}"; do
      echo "Waiting for ${TAILSCALE_TCP_FORWARD_TARGET_HOST}:${target_port}" >&2
      sleep 1
    done

    /render/tailscale serve --yes --bg --tcp="${listen_port}" "tcp://${TAILSCALE_TCP_FORWARD_TARGET_HOST}:${target_port}"
  done

  /render/tailscale serve status
fi

wait "${pid}"
