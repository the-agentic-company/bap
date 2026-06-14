import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

const targets = {
  prod: "DATABASE_URL_PROD",
  staging: "DATABASE_URL_STAGING",
} as const;

type TargetName = keyof typeof targets;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function getTargetName(value: string | undefined, scriptName: string): TargetName {
  if (value === "prod" || value === "staging") {
    return value;
  }

  fail(`Usage: bun scripts/${scriptName} <staging|prod>`);
}

export async function runDbCommandForTarget(commandName: string, scriptName: string): Promise<void> {
  const targetName = getTargetName(process.argv[2], scriptName);
  const envVar = targets[targetName];
  const databaseUrl = process.env[envVar]?.trim();

  if (!databaseUrl) {
    fail(`Missing ${envVar} in the environment.`);
  }

  const proc = spawn(process.execPath, ["run", commandName], {
    cwd: packageRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    },
    stdio: "inherit",
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("exit", resolve);
  });

  process.exit(exitCode ?? 1);
}
