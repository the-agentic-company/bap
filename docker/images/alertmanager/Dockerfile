FROM prom/alertmanager:v0.33.0

USER root

COPY alertmanager.yml.tpl /etc/alertmanager/alertmanager.yml.tpl
COPY start-alertmanager.sh /usr/local/bin/start-alertmanager.sh

RUN chmod +x /usr/local/bin/start-alertmanager.sh

ENTRYPOINT ["/usr/local/bin/start-alertmanager.sh"]
