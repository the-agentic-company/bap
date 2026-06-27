export type WorktreeStackConfig = {
  slot: number;
  slotLabel: string;
  zeroCachePort: number;
  daytonaApiPort: number;
  daytonaProxyPort: number;
  daytonaSshGatewayPort: number;
  daytonaDexPort: number;
  daytonaDbVolume: string;
  daytonaDexVolume: string;
  daytonaRegistryVolume: string;
};

export type SharedStackConfig = {
  composeProjectName: string;
  postgresPort: number;
  redisPort: number;
  minioApiPort: number;
  minioConsolePort: number;
  grafanaPort: number;
  alertmanagerPort: number;
  vectorOtelGrpcPort: number;
  vectorOtelHttpPort: number;
  vectorTracePort: number;
  vectorLogPort: number;
  victoriaMetricsPort: number;
  victoriaLogsPort: number;
  victoriaTracesPort: number;
  vmalertPort: number;
  postgresVolume: string;
  redisVolume: string;
  minioVolume: string;
  alertmanagerVolume: string;
  grafanaVolume: string;
  victoriaMetricsVolume: string;
  victoriaLogsVolume: string;
  victoriaTracesVolume: string;
};

export type WorktreeHostPort = {
  name: string;
  port: number;
};

function assertValidSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > 99) {
    throw new Error(`Worktree stack slot must be an integer between 1 and 99, received ${slot}`);
  }
}

function port(prefix: number, slot: number): number {
  return prefix * 100 + slot;
}

export function formatWorktreeStackSlot(slot: number): string {
  assertValidSlot(slot);
  return String(slot).padStart(2, "0");
}

export function buildWorktreeHostPorts(slot: number): WorktreeHostPort[] {
  const stack = buildWorktreeStackConfig("bap-slot", slot);

  return [
    { name: "app", port: port(37, slot) },
    { name: "ws", port: port(47, slot) },
    { name: "zero-cache", port: stack.zeroCachePort },
    { name: "daytona-api", port: stack.daytonaApiPort },
    { name: "daytona-proxy", port: stack.daytonaProxyPort },
    { name: "daytona-ssh", port: stack.daytonaSshGatewayPort },
    { name: "daytona-dex", port: stack.daytonaDexPort },
  ];
}

export function buildSharedStackConfig(): SharedStackConfig {
  const parsePort = (value: string | undefined, fallback: number): number => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  };

  const composeProjectName = process.env.BAP_COMPOSE_PROJECT?.trim() || "bap-local";

  return {
    composeProjectName,
    postgresPort: parsePort(process.env.BAP_POSTGRES_PORT, 5432),
    redisPort: parsePort(process.env.BAP_REDIS_PORT, 6379),
    minioApiPort: parsePort(process.env.BAP_MINIO_API_PORT, 9000),
    minioConsolePort: parsePort(process.env.BAP_MINIO_CONSOLE_PORT, 9001),
    grafanaPort: parsePort(process.env.BAP_GRAFANA_PORT, 3400),
    alertmanagerPort: parsePort(process.env.BAP_ALERTMANAGER_PORT, 9093),
    vectorOtelGrpcPort: parsePort(process.env.BAP_VECTOR_OTLP_GRPC_PORT, 4317),
    vectorOtelHttpPort: parsePort(process.env.BAP_VECTOR_OTLP_HTTP_PORT, 4318),
    vectorTracePort: parsePort(process.env.BAP_VECTOR_TRACES_PORT, 5318),
    vectorLogPort: parsePort(process.env.BAP_VECTOR_LOG_PORT, 8686),
    victoriaMetricsPort: parsePort(process.env.BAP_VICTORIA_METRICS_PORT, 8428),
    victoriaLogsPort: parsePort(process.env.BAP_VICTORIA_LOGS_PORT, 9428),
    victoriaTracesPort: parsePort(process.env.BAP_VICTORIA_TRACES_PORT, 10428),
    vmalertPort: parsePort(process.env.BAP_VMALERT_PORT, 8880),
    postgresVolume: process.env.BAP_POSTGRES_VOLUME || `${composeProjectName}_bap_postgres_data`,
    redisVolume: process.env.BAP_REDIS_VOLUME || `${composeProjectName}_bap_redis_data`,
    minioVolume: process.env.BAP_MINIO_VOLUME || `${composeProjectName}_bap_minio_data`,
    alertmanagerVolume:
      process.env.BAP_ALERTMANAGER_VOLUME || `${composeProjectName}_bap_alertmanager_data`,
    grafanaVolume: process.env.BAP_GRAFANA_VOLUME || `${composeProjectName}_bap_grafana_data`,
    victoriaMetricsVolume:
      process.env.BAP_VICTORIA_METRICS_VOLUME || `${composeProjectName}_bap_victoria_metrics_data`,
    victoriaLogsVolume:
      process.env.BAP_VICTORIA_LOGS_VOLUME || `${composeProjectName}_bap_victoria_logs_data`,
    victoriaTracesVolume:
      process.env.BAP_VICTORIA_TRACES_VOLUME || `${composeProjectName}_bap_victoria_traces_data`,
  };
}

export function buildWorktreeStackConfig(instanceId: string, slot: number): WorktreeStackConfig {
  assertValidSlot(slot);
  const slotLabel = formatWorktreeStackSlot(slot);

  return {
    slot,
    slotLabel,
    zeroCachePort: port(58, slot),
    daytonaApiPort: port(33, slot),
    daytonaProxyPort: port(40, slot),
    daytonaSshGatewayPort: port(22, slot),
    daytonaDexPort: port(55, slot),
    daytonaDbVolume: `${instanceId}_daytona_db_data`,
    daytonaDexVolume: `${instanceId}_daytona_dex_data`,
    daytonaRegistryVolume: `${instanceId}_daytona_registry_data`,
  };
}
