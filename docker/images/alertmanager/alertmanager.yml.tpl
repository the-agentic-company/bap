global:
  resolve_timeout: 5m

route:
  receiver: __APP_ALERT_RECEIVER__
  group_by:
    - alertname
    - alertgroup
  group_wait: 30s
  group_interval: 10m
  repeat_interval: 4h

inhibit_rules:
  - source_matchers:
      - severity="critical"
    target_matchers:
      - severity="warning"
    equal:
      - alertname
      - service_name
      - queue

receivers:
  - name: __APP_ALERT_RECEIVER__
    slack_configs:
      - api_url: https://slack.com/api/chat.postMessage
        channel: "#ops-telemetry-alerts"
        http_config:
          authorization:
            credentials_file: /etc/alertmanager/secrets/slack_bot_token
        send_resolved: true
        username: __APP_ALERT_USERNAME__
        icon_emoji: ":rotating_light:"
        title: >-
          [{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}
        text: >-
          {{ range .Alerts -}}
          *Summary:* {{ .Annotations.summary }}
          *Description:* {{ .Annotations.description }}
          *Severity:* {{ .Labels.severity }}
          *Environment:* __APP_ALERT_ENV__
          {{ if .Labels.service_name }}*Service:* {{ .Labels.service_name }}{{ end }}
          {{ if .Labels.queue }}*Queue:* {{ .Labels.queue }}{{ end }}
          {{ if .Labels.component_id }}*Component:* {{ .Labels.component_id }}{{ end }}
          {{ if .Annotations.dashboard_url }}*Dashboard:* {{ .Annotations.dashboard_url }}{{ end }}

          {{ end -}}
