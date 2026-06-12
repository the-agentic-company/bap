#!/bin/sh
set -eu

: "${APP_VICTORIA_METRICS_HOST:?app victoria metrics host is required}"
: "${APP_ALERTMANAGER_HOST:?app alertmanager host is required}"

alert_env="${APP_ALERT_ENV:-staging}"
case "${alert_env}" in
  staging | prod) ;;
  *)
    echo "Unsupported alert environment ${alert_env}. Use staging or prod." >&2
    exit 1
    ;;
esac

rules_dir="/tmp/vmalert-rules"
mkdir -p "${rules_dir}"
sed "s/__APP_ALERT_ENV__/${alert_env}/g" \
  /etc/vmalert/templates/app-runtime.rules.yml.tpl \
  > "${rules_dir}/app-runtime.rules.yml"

if ls /etc/pyrra/slos/*.yaml >/dev/null 2>&1; then
  pyrra generate \
    --config-files="/etc/pyrra/slos/*.yaml" \
    --prometheus-folder="${rules_dir}" \
    --generic-rules
fi

exec /vmalert-prod \
  -rule="${rules_dir}/*.yml" \
  -rule="${rules_dir}/*.yaml" \
  -datasource.url="http://${APP_VICTORIA_METRICS_HOST}:8428" \
  -remoteWrite.url="http://${APP_VICTORIA_METRICS_HOST}:8428" \
  -remoteRead.url="http://${APP_VICTORIA_METRICS_HOST}:8428" \
  -notifier.url="http://${APP_ALERTMANAGER_HOST}:9093" \
  -evaluationInterval=30s \
  -rule.evalDelay=30s \
  -httpListenAddr=:8880
