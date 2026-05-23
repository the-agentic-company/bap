import { readFileSync } from "node:fs";

const renderConfig = readFileSync(
  new URL("../render.yaml", import.meta.url),
  "utf8",
);

function requireVictoriaMetricsVmalertProxy(
  environment: "staging" | "prod",
): void {
  const serviceName = `cmdclaw-victoria-metrics-${environment}`;
  const serviceHeader = `          - type: pserv
            name: ${serviceName}`;
  const serviceStart = renderConfig.indexOf(serviceHeader);

  if (serviceStart < 0) {
    throw new Error(`Missing Render service ${serviceName}`);
  }

  const afterServiceName = renderConfig.slice(
    serviceStart + serviceHeader.length,
  );
  const nextServiceMatch = afterServiceName.match(/\n          - type: /);
  const serviceEnd = nextServiceMatch
    ? serviceStart + serviceName.length + nextServiceMatch.index!
    : renderConfig.length;
  const serviceBlock = renderConfig.slice(serviceStart, serviceEnd);
  const expectedProxy = `-vmalert.proxyURL=http://cmdclaw-vmalert-${environment}:8880`;

  if (!serviceBlock.includes(expectedProxy)) {
    throw new Error(
      `${serviceName} dockerCommand must include ${expectedProxy}`,
    );
  }
}

requireVictoriaMetricsVmalertProxy("staging");
requireVictoriaMetricsVmalertProxy("prod");

console.log(
  "[render-observability-config] VictoriaMetrics vmalert proxy flags are configured.",
);
