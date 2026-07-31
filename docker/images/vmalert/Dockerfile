FROM ghcr.io/pyrra-dev/pyrra:v0.10.1 AS pyrra

FROM victoriametrics/vmalert:v1.140.0

USER root

COPY --from=pyrra /usr/bin/pyrra /usr/local/bin/pyrra
COPY pyrra /etc/pyrra
COPY templates /etc/vmalert/templates
COPY start-vmalert.sh /usr/local/bin/start-vmalert.sh

RUN chmod +x /usr/local/bin/start-vmalert.sh

ENTRYPOINT ["/usr/local/bin/start-vmalert.sh"]
