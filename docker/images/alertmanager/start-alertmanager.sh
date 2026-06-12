#!/bin/sh
set -eu

mkdir -p /etc/alertmanager/secrets
printf '%s' "${SLACK_BOT_TOKEN:-}" > /etc/alertmanager/secrets/slack_bot_token

alert_env="${APP_ALERT_ENV:-staging}"
case "${alert_env}" in
  staging)
    receiver="slack-staging"
    username="Bap Staging"
    ;;
  prod)
    receiver="slack-prod"
    username="Bap Prod"
    ;;
  *)
    echo "Unsupported alert environment ${alert_env}. Use staging or prod." >&2
    exit 1
    ;;
esac

sed \
  -e "s/__APP_ALERT_RECEIVER__/${receiver}/g" \
  -e "s/__APP_ALERT_USERNAME__/${username}/g" \
  -e "s/__APP_ALERT_ENV__/${alert_env}/g" \
  /etc/alertmanager/alertmanager.yml.tpl \
  > /tmp/alertmanager.yml

exec /bin/alertmanager \
  --config.file=/tmp/alertmanager.yml \
  --storage.path=/alertmanager \
  --web.listen-address=:9093
