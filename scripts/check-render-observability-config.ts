import { appendFileSync, readFileSync } from "node:fs";

const renderConfig = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");

const renderServicePrefix = "bap";
const renderPrivateHostPrefix = "cmdclaw";

type Environment = "staging" | "prod";

type VictoriaMetricsRenderConfig = {
  imageUrl: string;
  dockerCommand: string;
};

function readArg(name: string): string | null {
  const prefix = `${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  if (value) {
    return value.slice(prefix.length);
  }

  const index = process.argv.indexOf(name);
  if (index >= 0) {
    return process.argv[index + 1] ?? null;
  }

  return null;
}

function fail(message: string): never {
  console.error(`[render-observability-config] ${message}`);
  process.exit(1);
}

function parseEnvironment(value: string | null): Environment {
  if (value === "staging" || value === "prod") {
    return value;
  }

  fail("Missing or unsupported --environment. Expected staging or prod.");
}

function getServiceBlock(serviceName: string): string {
  const serviceHeader = `          - type: pserv
            name: ${serviceName}`;
  const serviceStart = renderConfig.indexOf(serviceHeader);

  if (serviceStart < 0) {
    throw new Error(`Missing Render service ${serviceName}`);
  }

  const afterServiceHeader = renderConfig.slice(serviceStart + serviceHeader.length);
  const nextServiceMatch = afterServiceHeader.match(/\n          - type: /);
  const serviceEnd = nextServiceMatch
    ? serviceStart + serviceHeader.length + nextServiceMatch.index!
    : renderConfig.length;

  return renderConfig.slice(serviceStart, serviceEnd);
}

function requireField(serviceBlock: string, fieldName: "url" | "dockerCommand"): string {
  const match = serviceBlock.match(new RegExp(`\\n\\s+${fieldName}:\\s+(.+)`));
  const value = match?.[1]?.trim();

  if (!value) {
    throw new Error(`Missing VictoriaMetrics ${fieldName} in render.yaml`);
  }

  return value;
}

function getVictoriaMetricsRenderConfig(environment: Environment): VictoriaMetricsRenderConfig {
  const serviceName = `${renderServicePrefix}-victoria-metrics-${environment}`;
  const serviceBlock = getServiceBlock(serviceName);

  return {
    imageUrl: requireField(serviceBlock, "url"),
    dockerCommand: requireField(serviceBlock, "dockerCommand"),
  };
}

function requireVictoriaMetricsVmalertProxy(environment: "staging" | "prod"): void {
  const serviceName = `${renderServicePrefix}-victoria-metrics-${environment}`;
  const { dockerCommand } = getVictoriaMetricsRenderConfig(environment);
  const expectedProxy = `-vmalert.proxyURL=http://${renderPrivateHostPrefix}-vmalert-${environment}:8880`;

  if (!dockerCommand.includes(expectedProxy)) {
    throw new Error(`${serviceName} dockerCommand must include ${expectedProxy}`);
  }
}

function writeGithubEnv(name: string, value: string): void {
  const githubEnv = process.env.GITHUB_ENV;
  if (githubEnv) {
    appendFileSync(githubEnv, `${name}=${value}\n`);
  }
  console.log(`${name}=${value}`);
}

function check(): void {
  requireVictoriaMetricsVmalertProxy("staging");
  requireVictoriaMetricsVmalertProxy("prod");

  console.log("[render-observability-config] VictoriaMetrics vmalert proxy flags are configured.");
}

function writeVictoriaMetricsEnv(): void {
  const environment = parseEnvironment(readArg("--environment"));
  const config = getVictoriaMetricsRenderConfig(environment);

  requireVictoriaMetricsVmalertProxy(environment);
  writeGithubEnv("RENDER_IMAGE_URL", config.imageUrl);
  writeGithubEnv("RENDER_DOCKER_COMMAND", config.dockerCommand);
}

const command = process.argv[2] ?? "check";

if (command === "check") {
  check();
} else if (command === "victoria-metrics-env") {
  writeVictoriaMetricsEnv();
} else {
  fail(
    "Usage: bun scripts/check-render-observability-config.ts [check|victoria-metrics-env --environment <staging|prod>]",
  );
}
