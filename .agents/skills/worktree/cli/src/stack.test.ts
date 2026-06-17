import { describe, expect, test } from "vitest";

import {
  buildSharedStackConfig,
  buildWorktreeHostPorts,
  buildWorktreeStackConfig,
  formatWorktreeStackSlot,
} from "./stack";

const SHARED_STACK_ENV_KEYS = [
  "BAP_COMPOSE_PROJECT",
  "BAP_POSTGRES_PORT",
  "BAP_REDIS_PORT",
  "BAP_MINIO_API_PORT",
  "BAP_MINIO_CONSOLE_PORT",
  "BAP_GRAFANA_PORT",
  "BAP_ALERTMANAGER_PORT",
  "BAP_VECTOR_OTLP_GRPC_PORT",
  "BAP_VECTOR_OTLP_HTTP_PORT",
  "BAP_VECTOR_TRACES_PORT",
  "BAP_VECTOR_LOG_PORT",
  "BAP_VICTORIA_METRICS_PORT",
  "BAP_VICTORIA_LOGS_PORT",
  "BAP_VICTORIA_TRACES_PORT",
  "BAP_VMALERT_PORT",
  "BAP_POSTGRES_VOLUME",
  "BAP_REDIS_VOLUME",
  "BAP_MINIO_VOLUME",
  "BAP_ALERTMANAGER_VOLUME",
  "BAP_GRAFANA_VOLUME",
  "BAP_VICTORIA_METRICS_VOLUME",
  "BAP_VICTORIA_LOGS_VOLUME",
  "BAP_VICTORIA_TRACES_VOLUME",
] as const;

describe("worktree stack config", () => {
  test("formats worktree slots as two digits", () => {
    expect(formatWorktreeStackSlot(1)).toBe("01");
    expect(formatWorktreeStackSlot(17)).toBe("17");
    expect(formatWorktreeStackSlot(99)).toBe("99");
  });

  test("derives deterministic docker ports and names from the slot", () => {
    expect(buildWorktreeStackConfig("bap-a1b2c3d4", 7)).toEqual({
      slot: 7,
      slotLabel: "07",
      daytonaApiPort: 3307,
      daytonaProxyPort: 4007,
      daytonaSshGatewayPort: 2207,
      daytonaDexPort: 5507,
      daytonaDbVolume: "bap-a1b2c3d4_daytona_db_data",
      daytonaDexVolume: "bap-a1b2c3d4_daytona_dex_data",
      daytonaRegistryVolume: "bap-a1b2c3d4_daytona_registry_data",
    });
  });

  test("lists every host port reserved by a slot", () => {
    expect(buildWorktreeHostPorts(7)).toEqual([
      { name: "app", port: 3707 },
      { name: "ws", port: 4707 },
      { name: "daytona-api", port: 3307 },
      { name: "daytona-proxy", port: 4007 },
      { name: "daytona-ssh", port: 2207 },
      { name: "daytona-dex", port: 5507 },
    ]);
  });

  test("returns the shared stack ports and volumes", () => {
    const previousEnv = Object.fromEntries(
      SHARED_STACK_ENV_KEYS.map((key) => [key, process.env[key]]),
    );

    try {
      for (const key of SHARED_STACK_ENV_KEYS) {
        delete process.env[key];
      }

      expect(buildSharedStackConfig()).toEqual({
        composeProjectName: "bap-local",
        postgresPort: 5432,
        redisPort: 6379,
        minioApiPort: 9000,
        minioConsolePort: 9001,
        grafanaPort: 3400,
        alertmanagerPort: 9093,
        vectorOtelGrpcPort: 4317,
        vectorOtelHttpPort: 4318,
        vectorTracePort: 5318,
        vectorLogPort: 8686,
        victoriaMetricsPort: 8428,
        victoriaLogsPort: 9428,
        victoriaTracesPort: 10428,
        vmalertPort: 8880,
        postgresVolume: "bap-local_bap_postgres_data",
        redisVolume: "bap-local_bap_redis_data",
        minioVolume: "bap-local_bap_minio_data",
        alertmanagerVolume: "bap-local_bap_alertmanager_data",
        grafanaVolume: "bap-local_bap_grafana_data",
        victoriaMetricsVolume: "bap-local_bap_victoria_metrics_data",
        victoriaLogsVolume: "bap-local_bap_victoria_logs_data",
        victoriaTracesVolume: "bap-local_bap_victoria_traces_data",
      });
    } finally {
      for (const key of SHARED_STACK_ENV_KEYS) {
        const value = previousEnv[key];
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("rejects out-of-range slots", () => {
    expect(() => formatWorktreeStackSlot(0)).toThrow("between 1 and 99");
    expect(() => buildWorktreeStackConfig("bap-a1b2c3d4", 100)).toThrow("between 1 and 99");
  });
});
