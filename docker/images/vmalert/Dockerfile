FROM ghcr.io/pyrra-dev/pyrra:v0.9.5 AS pyrra

FROM victoriametrics/vmalert:v1.144.0

USER root

COPY --from=pyrra /usr/bin/pyrra /usr/local/bin/pyrra
COPY pyrra /etc/pyrra
COPY templates /etc/vmalert/templates
COPY start-vmalert.sh /usr/local/bin/start-vmalert.sh

RUN chmod +x /usr/local/bin/start-vmalert.sh

ENTRYPOINT ["/usr/local/bin/start-vmalert.sh"]
