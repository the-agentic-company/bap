#!/usr/bin/env bash
set -euo pipefail

# Installs the managed-WAF skip rule needed for CmdClaw routes that accept
# arbitrary user-authored code or markdown. Requires a Cloudflare API token with
# Zone Rulesets edit access.

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN with Zone Rulesets edit access}"
: "${CLOUDFLARE_ZONE_ID:?Set CLOUDFLARE_ZONE_ID for the cmdclaw.ai zone}"

RULE_REF="${RULE_REF:-cmdclaw-api-content-write-waf-skip}"
RULE_DESCRIPTION="${RULE_DESCRIPTION:-CmdClaw: skip managed WAF for content-write RPCs}"
PHASE="http_request_firewall_managed"
API_BASE="https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}"

HOSTS="${CLOUDFLARE_WAF_SKIP_HOSTS:-staging.cmdclaw.ai cmdclaw.ai}"
PATHS="${CLOUDFLARE_WAF_SKIP_PATHS:-/api/rpc/skill/updateFile /api/rpc/skill/addFile}"

build_set() {
  local value
  for value in "$@"; do
    printf '"%s" ' "$value"
  done
}

read -r -a host_array <<< "$HOSTS"
read -r -a path_array <<< "$PATHS"

host_set="$(build_set "${host_array[@]}")"
path_set="$(build_set "${path_array[@]}")"
expression="(http.host in {${host_set}} and http.request.method eq \"POST\" and http.request.uri.path in {${path_set}})"

auth_header="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"

entrypoint_json="$(
  curl -fsS \
    --request GET \
    --header "$auth_header" \
    "${API_BASE}/rulesets/phases/${PHASE}/entrypoint"
)"

entrypoint_id="$(jq -r '.result.id' <<< "$entrypoint_json")"

if jq -e --arg ref "$RULE_REF" '.result.rules // [] | any(.ref == $ref)' <<< "$entrypoint_json" >/dev/null; then
  echo "Cloudflare skip rule already exists: ${RULE_REF}"
  exit 0
fi

payload="$(
  jq -n \
    --arg ref "$RULE_REF" \
    --arg description "$RULE_DESCRIPTION" \
    --arg expression "$expression" \
    '{
      ref: $ref,
      description: $description,
      expression: $expression,
      action: "skip",
      action_parameters: {
        ruleset: "current"
      },
      position: {
        before: ""
      }
    }'
)"

curl -fsS \
  --request POST \
  --header "$auth_header" \
  --header "Content-Type: application/json" \
  --data "$payload" \
  "${API_BASE}/rulesets/${entrypoint_id}/rules" \
  | jq '{success, result: {id: .result.id, ref: .result.ref, description: .result.description, expression: .result.expression}}'
