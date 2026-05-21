import type {
  ExecutionEnvironmentProvider,
  SandboxProviderName,
} from "./execution-environment";
import { DaytonaExecutionEnvironmentProvider } from "./providers/daytona-environment";
import { DockerExecutionEnvironmentProvider } from "./providers/docker-environment";
import { E2BExecutionEnvironmentProvider } from "./providers/e2b-environment";

function resolveDefaultExecutionProvider(): SandboxProviderName {
  const configured = process.env.SANDBOX_DEFAULT;
  if (configured === "docker" || configured === "daytona" || configured === "e2b") {
    return configured;
  }
  throw new Error(`Unsupported SANDBOX_DEFAULT value: ${configured}`);
}

export function createExecutionEnvironmentProvider(
  provider: SandboxProviderName,
): ExecutionEnvironmentProvider {
  if (provider === "docker") {
    return new DockerExecutionEnvironmentProvider();
  }
  if (provider === "daytona") {
    return new DaytonaExecutionEnvironmentProvider();
  }
  return new E2BExecutionEnvironmentProvider();
}

export function createExecutionEnvironmentFactory(input?: {
  defaultProvider?: SandboxProviderName;
}) {
  return {
    providerFor(preference?: SandboxProviderName): ExecutionEnvironmentProvider {
      return createExecutionEnvironmentProvider(
        preference ?? input?.defaultProvider ?? resolveDefaultExecutionProvider(),
      );
    },
  };
}
