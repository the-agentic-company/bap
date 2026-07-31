FROM debian:latest

WORKDIR /render

ARG TAILSCALE_VERSION
ENV TAILSCALE_VERSION=$TAILSCALE_VERSION

RUN apt-get -qq update \
  && apt-get -qq install --upgrade -y --no-install-recommends \
    apt-transport-https \
    ca-certificates \
    dnsutils \
    jq \
    netcat-openbsd \
    wget \
  > /dev/null \
  && apt-get -qq clean \
  && rm -rf \
    /var/lib/apt/lists/* \
    /tmp/* \
    /var/tmp/* \
  && :

RUN echo "+search +short" > /root/.digrc

COPY run-tailscale.sh /render/
COPY install-tailscale.sh /tmp/

RUN chmod +x /render/run-tailscale.sh /tmp/install-tailscale.sh \
  && /tmp/install-tailscale.sh \
  && rm -rf /tmp/*

CMD ./run-tailscale.sh
