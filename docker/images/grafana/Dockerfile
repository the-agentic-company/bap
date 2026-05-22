FROM grafana/grafana:13.0.1

USER root

COPY --chown=472:0 provisioning /etc/grafana/provisioning
COPY --chown=472:0 dashboards /var/lib/grafana/dashboards

USER 472
